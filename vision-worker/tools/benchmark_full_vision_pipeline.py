#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path
from typing import Any

from app.services.centering_engine import assess_centering
from app.services.imaging.barcode import decode_barcodes
from app.services.imaging.card_detector import decode_image
from app.services.imaging.detector_router import detect_card_objects
from app.services.imaging.quality import analyze_image_quality
from app.services.imaging.surface_classifier import analyze_surface
from tools.evaluate_scene_detector_manifest import load_manifest


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * percentile))))
    return ordered[index]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run ManeFlow's local vision stages over a labeled image manifest.")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    _, items = load_manifest(args.manifest)
    root = args.root.resolve()
    rows: list[dict[str, Any]] = []
    image_errors = 0
    crop_count = 0
    surface_successes = 0
    surface_skips = 0
    centering_successes = 0
    centering_skips = 0
    barcode_values_found = 0
    stage_errors: list[dict[str, str]] = []

    for item in items:
        path = (root / item.path).resolve()
        started = time.perf_counter()
        try:
            path.relative_to(root)
            image = decode_image(path.read_bytes())
            quality = analyze_image_quality(image)
            detections = detect_card_objects(image)
            crops: list[dict[str, Any]] = []

            for detection in detections:
                crop_count += 1
                crop_payload: dict[str, Any] = {
                    "confidence": detection.confidence,
                    "area_fraction": detection.area_fraction,
                    "detector_name": detection.detector_name,
                    "width": int(detection.crop.shape[1]),
                    "height": int(detection.crop.shape[0]),
                }

                try:
                    crop_payload["surface"] = analyze_surface(detection.crop).to_dict()
                    surface_successes += 1
                except ValueError as exc:
                    surface_skips += 1
                    crop_payload["surface_skip"] = str(exc)
                except Exception as exc:
                    stage_errors.append({"stage": "surface", "path": item.path, "error": f"{type(exc).__name__}: {exc}"})
                    crop_payload["surface_error"] = f"{type(exc).__name__}: {exc}"

                try:
                    crop_payload["centering"] = assess_centering(detection.crop).to_dict()
                    centering_successes += 1
                except ValueError as exc:
                    centering_skips += 1
                    crop_payload["centering_skip"] = str(exc)
                except Exception as exc:
                    stage_errors.append({"stage": "centering", "path": item.path, "error": f"{type(exc).__name__}: {exc}"})
                    crop_payload["centering_error"] = f"{type(exc).__name__}: {exc}"

                try:
                    decoded_values = decode_barcodes(detection.crop)
                    barcode_values_found += len(decoded_values)
                    crop_payload["barcodes"] = decoded_values
                except Exception as exc:
                    stage_errors.append({"stage": "barcode", "path": item.path, "error": f"{type(exc).__name__}: {exc}"})
                    crop_payload["barcode_error"] = f"{type(exc).__name__}: {exc}"

                crops.append(crop_payload)

            rows.append(
                {
                    "path": item.path,
                    "quality": quality.to_dict(),
                    "detection_count": len(detections),
                    "crops": crops,
                    "latency_ms": round((time.perf_counter() - started) * 1000.0, 3),
                    "error": None,
                }
            )
        except Exception as exc:
            image_errors += 1
            rows.append(
                {
                    "path": item.path,
                    "error": f"{type(exc).__name__}: {exc}",
                    "latency_ms": round((time.perf_counter() - started) * 1000.0, 3),
                }
            )

    latencies = [float(row["latency_ms"]) for row in rows]
    summary = {
        "images": len(rows),
        "decoded_images": len(rows) - image_errors,
        "image_errors": image_errors,
        "detected_crops": crop_count,
        "surface_successes": surface_successes,
        "surface_low_resolution_skips": surface_skips,
        "centering_successes": centering_successes,
        "centering_low_resolution_skips": centering_skips,
        "barcode_values_found": barcode_values_found,
        "unexpected_stage_errors": len(stage_errors),
        "mean_total_latency_ms": round(statistics.fmean(latencies), 3) if latencies else 0.0,
        "p50_total_latency_ms": round(_percentile(latencies, 0.50), 3),
        "p95_total_latency_ms": round(_percentile(latencies, 0.95), 3),
        "maximum_total_latency_ms": round(max(latencies), 3) if latencies else 0.0,
    }
    payload = {"summary": summary, "stage_errors": stage_errors, "rows": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
