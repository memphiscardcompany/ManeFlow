from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Any

PROMOTION_STATES = {
    "EXPERIMENTAL", "CANDIDATE", "VALIDATED", "STAGING", "PRODUCTION", "REJECTED", "RETIRED"
}


@dataclass(frozen=True)
class ModelRecord:
    model_id: str
    semantic_version: str
    task: str
    base_model: str
    base_model_source: str
    license: str
    training_dataset_manifest: str
    training_code_commit: str
    training_configuration: str
    validation_metrics: dict[str, Any]
    locked_test_metrics: dict[str, Any]
    known_limitations: list[str]
    supported_input_types: list[str]
    hardware_requirements: dict[str, Any]
    artifact_path: str
    artifact_checksum: str
    promotion_status: str = "EXPERIMENTAL"
    rollback_target: str | None = None
    created_at: str = ""

    def validated(self) -> "ModelRecord":
        if self.promotion_status not in PROMOTION_STATES:
            raise ValueError(f"Unknown promotion status: {self.promotion_status}")
        if not self.model_id or not self.semantic_version or not self.task:
            raise ValueError("model_id, semantic_version, and task are required")
        if not self.artifact_checksum or len(self.artifact_checksum) != 64:
            raise ValueError("artifact_checksum must be a SHA-256 digest")
        return self


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_registry(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": 1, "models": []}
    registry = json.loads(path.read_text(encoding="utf-8"))
    if registry.get("schema_version") != 1 or not isinstance(registry.get("models"), list):
        raise ValueError("Unsupported model registry format")
    return registry


def write_registry(path: Path, registry: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(registry, indent=2, sort_keys=True) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent) as stream:
        stream.write(content)
        temporary = Path(stream.name)
    os.replace(temporary, path)


def register_model(path: Path, record: ModelRecord, *, verify_artifact: bool = True) -> dict[str, Any]:
    record.validated()
    artifact = Path(record.artifact_path)
    if verify_artifact:
        if not artifact.is_file():
            raise FileNotFoundError(f"Model artifact does not exist: {artifact}")
        actual = sha256_file(artifact)
        if actual != record.artifact_checksum:
            raise ValueError("Model artifact checksum does not match the registry record")
    registry = load_registry(path)
    key = (record.model_id, record.semantic_version)
    if any((entry.get("model_id"), entry.get("semantic_version")) == key for entry in registry["models"]):
        raise ValueError(f"Model version already exists: {record.model_id}@{record.semantic_version}")
    payload = asdict(record)
    if not payload["created_at"]:
        payload["created_at"] = datetime.now(timezone.utc).isoformat()
    registry["models"].append(payload)
    write_registry(path, registry)
    return payload
