#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from app.services.imaging.card_detector import decode_image
from app.services.imaging.detector_router import detect_card_objects
from app.services.imaging.quality import analyze_image_quality

_ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass(frozen=True)
class ManifestItem:
    path: str
    contains_card_content: bool
    group: str
    notes: str = ""


@dataclass(frozen=True)
class EvaluationRow:
    path: str
    group: str
    contains_card_content: bool
    predicted_card_content: bool
    detection_count: int
    fallback_count: int
    maximum_confidence: float
    quality_score: int | None
    latency_ms: float
    outcome: str
    notes: str
    error: str | None = None


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * percentile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] + ((ordered[upper] - ordered[lower]) * fraction)


def _classification(expected: bool, predicted: bool) -> str:
    if expected and predicted:
        return "true_positive"
    if expected and not predicted:
        return "false_negative"
    if not expected and predicted:
        return "false_positive"
    return "true_negative"


def _metrics(rows: list[EvaluationRow]) -> dict[str, Any]:
    valid = [row for row in rows if row.error is None]
    counts = {
        "true_positive": 0,
        "true_negative": 0,
        "false_positive": 0,
        "false_negative": 0,
    }
    for row in valid:
        counts[row.outcome] += 1

    tp = counts["true_positive"]
    tn = counts["true_negative"]
    fp = counts["false_positive"]
    fn = counts["false_negative"]
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    f1 = (2 * precision * recall / (precision + recall)) if precision + recall else 0.0
    accuracy = (tp + tn) / len(valid) if valid else 0.0
    latencies = [row.latency_ms for row in valid]

    return {
        "images": len(rows),
        "valid_images": len(valid),
        "decode_or_runtime_errors": len(rows) - len(valid),
        **counts,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
        "accuracy": round(accuracy, 6),
        "mean_latency_ms": round(statistics.fmean(latencies), 3) if latencies else 0.0,
        "p50_latency_ms": round(_percentile(latencies, 0.50), 3),
        "p95_latency_ms": round(_percentile(latencies, 0.95), 3),
        "maximum_latency_ms": round(max(latencies), 3) if latencies else 0.0,
        "total_detections": sum(row.detection_count for row in valid),
        "whole_image_fallbacks": sum(row.fallback_count for row in valid),
    }


def load_manifest(path: Path) -> tuple[dict[str, Any], list[ManifestItem]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError("Manifest must be an object containing an items array.")

    items: list[ManifestItem] = []
    for index, raw in enumerate(payload["items"]):
        if not isinstance(raw, dict):
            raise ValueError(f"Manifest item {index} must be an object.")
        relative = str(raw.get("path", "")).strip()
        if not relative:
            raise ValueError(f"Manifest item {index} is missing path.")
        items.append(
            ManifestItem(
                path=relative,
                contains_card_content=bool(raw.get("contains_card_content")),
                group=str(raw.get("group", "ungrouped")).strip() or "ungrouped",
                notes=str(raw.get("notes", "")).strip(),
            )
        )
    return payload, items


def evaluate(root: Path, items: list[ManifestItem]) -> list[EvaluationRow]:
    resolved_root = root.resolve()
    rows: list[EvaluationRow] = []

    for item in items:
        candidate = (resolved_root / item.path).resolve()
        try:
            candidate.relative_to(resolved_root)
        except ValueError as exc:
            raise ValueError(f"Manifest path escapes the benchmark root: {item.path}") from exc

        if candidate.suffix.lower() not in _ALLOWED_SUFFIXES:
            rows.append(
                EvaluationRow(
                    path=item.path,
                    group=item.group,
                    contains_card_content=item.contains_card_content,
                    predicted_card_content=False,
                    detection_count=0,
                    fallback_count=0,
                    maximum_confidence=0.0,
                    quality_score=None,
                    latency_ms=0.0,
                    outcome="error",
                    notes=item.notes,
                    error="Unsupported image extension.",
                )
            )
            continue

        started = time.perf_counter()
        try:
            image = decode_image(candidate.read_bytes())
            quality = analyze_image_quality(image)
            detections = detect_card_objects(image)
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            predicted = bool(detections)
            rows.append(
                EvaluationRow(
                    path=item.path,
                    group=item.group,
                    contains_card_content=item.contains_card_content,
                    predicted_card_content=predicted,
                    detection_count=len(detections),
                    fallback_count=sum(1 for detection in detections if detection.fallback_whole_image),
                    maximum_confidence=max((detection.confidence for detection in detections), default=0.0),
                    quality_score=quality.quality_score,
                    latency_ms=round(elapsed_ms, 3),
                    outcome=_classification(item.contains_card_content, predicted),
                    notes=item.notes,
                )
            )
        except Exception as exc:  # benchmark must preserve every failure in the evidence file
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            rows.append(
                EvaluationRow(
                    path=item.path,
                    group=item.group,
                    contains_card_content=item.contains_card_content,
                    predicted_card_content=False,
                    detection_count=0,
                    fallback_count=0,
                    maximum_confidence=0.0,
                    quality_score=None,
                    latency_ms=round(elapsed_ms, 3),
                    outcome="error",
                    notes=item.notes,
                    error=f"{type(exc).__name__}: {exc}",
                )
            )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate ManeFlow scene-level card detection from a labeled manifest.")
    parser.add_argument("--root", type=Path, required=True, help="Root directory containing manifest image paths.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--json-output", type=Path, required=True)
    parser.add_argument("--csv-output", type=Path)
    args = parser.parse_args()

    manifest_payload, items = load_manifest(args.manifest)
    rows = evaluate(args.root, items)
    groups = sorted({row.group for row in rows})
    summary = {
        "manifest_version": manifest_payload.get("version"),
        "benchmark_name": manifest_payload.get("name"),
        "scope": manifest_payload.get("scope"),
        "overall": _metrics(rows),
        "groups": {group: _metrics([row for row in rows if row.group == group]) for group in groups},
        "rows": [asdict(row) for row in rows],
    }

    args.json_output.parent.mkdir(parents=True, exist_ok=True)
    args.json_output.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    if args.csv_output:
        args.csv_output.parent.mkdir(parents=True, exist_ok=True)
        with args.csv_output.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(asdict(rows[0]).keys()) if rows else [])
            if rows:
                writer.writeheader()
                writer.writerows(asdict(row) for row in rows)

    print(json.dumps(summary["overall"], indent=2))


if __name__ == "__main__":
    main()
