from __future__ import annotations

from pathlib import Path

import pytest

from maneflow_vision.experiments.registry import (
    ModelRecord,
    load_registry,
    register_model,
    sha256_file,
)


def _record(artifact: Path, checksum: str) -> ModelRecord:
    return ModelRecord(
        model_id="card-detector",
        semantic_version="0.1.0",
        task="card_detection",
        base_model="licensed-base",
        base_model_source="owner-approved-source",
        license="documented-test-license",
        training_dataset_manifest="manifest-hash",
        training_code_commit="commit-sha",
        training_configuration="config.yaml",
        validation_metrics={"recall": 0.9},
        locked_test_metrics={"recall": 0.88},
        known_limitations=["test fixture only"],
        supported_input_types=["jpeg"],
        hardware_requirements={"device": "cpu_or_cuda"},
        artifact_path=str(artifact),
        artifact_checksum=checksum,
    )


def test_model_registry_appends_without_overwriting_versions(tmp_path: Path):
    artifact = tmp_path / "model.onnx"
    artifact.write_bytes(b"model")
    registry_path = tmp_path / "registry.json"
    record = _record(artifact, sha256_file(artifact))
    register_model(registry_path, record)
    registry = load_registry(registry_path)
    assert len(registry["models"]) == 1
    assert registry["models"][0]["promotion_status"] == "EXPERIMENTAL"
    with pytest.raises(ValueError, match="already exists"):
        register_model(registry_path, record)


def test_model_registry_rejects_checksum_mismatch(tmp_path: Path):
    artifact = tmp_path / "model.onnx"
    artifact.write_bytes(b"model")
    with pytest.raises(ValueError, match="checksum"):
        register_model(tmp_path / "registry.json", _record(artifact, "0" * 64))
