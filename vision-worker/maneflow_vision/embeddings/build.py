from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any

import cv2

from app.core.config import settings
from app.services.imaging.embedding_engine import EmbeddingEngineError, embedding_engine


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _records(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate versioned local embeddings for authorized prepared crops.")
    parser.add_argument("--prepared", default="../artifacts/dataset-audit/prepared-crops.jsonl")
    parser.add_argument("--manifest", default="../artifacts/private/dataset-manifest.jsonl")
    parser.add_argument("--output", default="../artifacts/embeddings/embeddings.jsonl")
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default=None)
    args = parser.parse_args()

    if args.device:
        settings.maneflow_compute_device = args.device

    prepared_path = Path(args.prepared)
    manifest_path = Path(args.manifest)
    output_path = Path(args.output)
    if not prepared_path.is_file():
        raise FileNotFoundError(f"Prepared crop metadata was not found: {prepared_path}")
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Dataset manifest was not found: {manifest_path}")

    readiness = embedding_engine.readiness(initialize=True)
    if not readiness.ready:
        raise EmbeddingEngineError(
            f"Embedding engine is not ready: {readiness.error or 'configure EMBEDDING_MODEL_PATH and dependencies'}"
        )

    manifest_hash = file_sha256(manifest_path)
    model_checksum = file_sha256(Path(readiness.model_path)) if readiness.model_path else None
    output_path.parent.mkdir(parents=True, exist_ok=True)
    outputs: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []

    for record in _records(prepared_path):
        uses = set(record.get("allowed_uses") or [])
        if not uses.intersection({"training", "evaluation", "retrieval"}):
            continue
        crop_path = Path(record["crop_path"])
        image = cv2.imread(str(crop_path), cv2.IMREAD_COLOR)
        if image is None:
            failures.append({"crop_path": str(crop_path), "error": "image_decode_failed"})
            continue
        try:
            result = embedding_engine.extract(image)
        except Exception as error:
            failures.append({"crop_path": str(crop_path), "error": str(error)[:500]})
            continue
        outputs.append({
            "asset_id": record["asset_id"],
            "crop_path": record["crop_path"],
            "crop_sha256": record["crop_sha256"],
            "vector": result.vector,
            "dimensions": result.dimensions,
            "normalized": result.normalized,
            "model_identifier": result.model_name,
            "model_checksum": model_checksum,
            "preprocessing_version": "maneflow-letterbox-normalize-v1",
            "dataset_manifest_hash": manifest_hash,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "execution_provider": result.provider,
            "requested_device": result.requested_device,
            "selected_device": result.selected_device,
            "selection_reason": result.selection_reason,
            "fallback_used": result.fallback_used,
            "fallback_reason": result.fallback_reason,
        })

    output_path.write_text(
        "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in outputs),
        encoding="utf-8",
    )
    summary_path = output_path.with_suffix(".summary.json")
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "output": str(output_path),
        "embeddings": len(outputs),
        "failures": failures,
        "model_identifier": settings.embedding_model_name,
        "model_checksum": model_checksum,
        "dataset_manifest_hash": manifest_hash,
        "readiness": readiness.to_dict(),
    }
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
