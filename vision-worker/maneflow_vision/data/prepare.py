from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any

import cv2

from app.services.imaging.detector_router import detect_card_objects, detector_readiness


def _read_manifest(path: Path) -> list[dict[str, Any]]:
    records = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        record = json.loads(line)
        if record.get("authorization_state") in {"PROHIBITED", "QUARANTINED_PENDING_REVIEW"}:
            continue
        records.append(record)
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description="Build versioned ManeFlow card crops without modifying source images.")
    parser.add_argument("--input-root", required=True)
    parser.add_argument("--manifest", default="../artifacts/private/dataset-manifest.jsonl")
    parser.add_argument("--output", default="../artifacts/crops")
    parser.add_argument("--metadata-out", default="../artifacts/dataset-audit/prepared-crops.jsonl")
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default=None)
    args = parser.parse_args()

    if args.device:
        from app.core.config import settings
        settings.maneflow_compute_device = args.device

    root = Path(args.input_root).expanduser().resolve()
    records = _read_manifest(Path(args.manifest))
    output = Path(args.output)
    metadata_path = Path(args.metadata_out)
    output.mkdir(parents=True, exist_ok=True)
    metadata_path.parent.mkdir(parents=True, exist_ok=True)

    written: list[dict[str, Any]] = []
    failures = 0
    for record in records:
        source = root / record["relative_path"]
        image = cv2.imread(str(source), cv2.IMREAD_COLOR)
        if image is None:
            failures += 1
            written.append({"asset_id": record["asset_id"], "error": "image_decode_failed"})
            continue
        detections = detect_card_objects(image, allow_whole_image_fallback=False)
        for index, detection in enumerate(detections):
            crop_digest = hashlib.sha256(
                f"{record['sha256']}|{detection.detector_name}|{index}".encode()
            ).hexdigest()[:20]
            destination = output / f"{record['asset_id']}-{index:03d}-{crop_digest}.jpg"
            if detection.crop is None or detection.crop.size == 0:
                failures += 1
                continue
            if not destination.exists():
                cv2.imwrite(str(destination), detection.crop, [cv2.IMWRITE_JPEG_QUALITY, 95])
            written.append({
                "asset_id": record["asset_id"],
                "source_relative_path": record["relative_path"],
                "crop_path": destination.as_posix(),
                "crop_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                "detection_index": index,
                "detector": detection.detector_name,
                "kind_hint": detection.kind_hint,
                "confidence": detection.confidence,
                "bounding_box_px": list(detection.bounding_box_px),
                "authorization_state": record["authorization_state"],
                "allowed_uses": record["allowed_uses"],
            })

    metadata_path.write_text(
        "".join(json.dumps(item, sort_keys=True) + "\n" for item in written),
        encoding="utf-8",
    )
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "manifest": str(Path(args.manifest)),
        "source_records": len(records),
        "output_records": len(written),
        "failures": failures,
        "detector_readiness": detector_readiness(),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
