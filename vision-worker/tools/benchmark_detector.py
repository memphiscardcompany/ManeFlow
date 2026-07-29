#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2

from app.services.imaging.card_detector import decode_image
from app.services.imaging.detector_router import detect_card_objects
from app.services.imaging.quality import analyze_image_quality


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark ManeFlow card-object detection on a folder.")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--output", type=Path, default=Path("detector_benchmark.json"))
    args = parser.parse_args()

    rows = []
    for path in sorted(args.folder.rglob("*")):
        if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        try:
            image = decode_image(path.read_bytes())
            quality = analyze_image_quality(image)
            detections = detect_card_objects(image)
            rows.append(
                {
                    "filename": str(path),
                    "width": quality.width,
                    "height": quality.height,
                    "quality_score": quality.quality_score,
                    "detections": len(detections),
                    "fallbacks": sum(1 for item in detections if item.fallback_whole_image),
                    "confidences": [item.confidence for item in detections],
                    "error": None,
                }
            )
        except Exception as exc:
            rows.append({"filename": str(path), "error": str(exc)})

    args.output.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"Wrote {len(rows)} rows to {args.output}")


if __name__ == "__main__":
    main()
