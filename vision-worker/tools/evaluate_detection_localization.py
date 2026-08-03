#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import statistics
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app.services.imaging.card_detector import decode_image
from app.services.imaging.detector_router import detect_card_objects

_ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass(frozen=True)
class GroundTruthRegion:
    region_id: str
    polygon_normalized: tuple[tuple[float, float], ...]
    visibility: str = "full"


@dataclass(frozen=True)
class ManifestItem:
    path: str
    group: str
    regions: tuple[GroundTruthRegion, ...]
    notes: str = ""


@dataclass(frozen=True)
class Match:
    ground_truth_id: str
    prediction_index: int
    iou: float


@dataclass(frozen=True)
class EvaluationRow:
    path: str
    group: str
    expected_regions: int
    predicted_regions: int
    matched_regions: int
    missed_regions: int
    false_regions: int
    duplicate_regions: int
    mean_matched_iou: float | None
    minimum_matched_iou: float | None
    scene_complete: bool
    latency_ms: float
    matches: tuple[Match, ...]
    notes: str
    error: str | None = None


def _validate_polygon(raw: Any, *, label: str) -> tuple[tuple[float, float], ...]:
    if not isinstance(raw, list) or len(raw) < 3:
        raise ValueError(f"{label} must contain at least three normalized points.")
    points: list[tuple[float, float]] = []
    for index, point in enumerate(raw):
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError(f"{label}[{index}] must be [x, y].")
        x, y = point
        if isinstance(x, bool) or isinstance(y, bool) or not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            raise ValueError(f"{label}[{index}] coordinates must be numeric.")
        if not 0.0 <= float(x) <= 1.0 or not 0.0 <= float(y) <= 1.0:
            raise ValueError(f"{label}[{index}] coordinates must be normalized to 0..1.")
        points.append((float(x), float(y)))
    return tuple(points)


def load_manifest(path: Path) -> tuple[dict[str, Any], tuple[ManifestItem, ...]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError("Manifest must be an object containing an items array.")

    items: list[ManifestItem] = []
    for item_index, raw in enumerate(payload["items"]):
        if not isinstance(raw, dict):
            raise ValueError(f"Manifest item {item_index} must be an object.")
        relative = str(raw.get("path", "")).strip()
        if not relative:
            raise ValueError(f"Manifest item {item_index} is missing path.")
        regions_raw = raw.get("regions")
        if not isinstance(regions_raw, list):
            raise ValueError(f"Manifest item {item_index} regions must be an array.")
        regions: list[GroundTruthRegion] = []
        seen_ids: set[str] = set()
        for region_index, region_raw in enumerate(regions_raw):
            if not isinstance(region_raw, dict):
                raise ValueError(f"Manifest item {item_index} region {region_index} must be an object.")
            region_id = str(region_raw.get("id", "")).strip()
            if not region_id or region_id in seen_ids:
                raise ValueError(f"Manifest item {item_index} region IDs must be unique and non-empty.")
            seen_ids.add(region_id)
            visibility = str(region_raw.get("visibility", "full")).strip().lower()
            if visibility not in {"full", "partial"}:
                raise ValueError("Region visibility must be full or partial.")
            regions.append(GroundTruthRegion(
                region_id=region_id,
                polygon_normalized=_validate_polygon(
                    region_raw.get("polygon"),
                    label=f"items[{item_index}].regions[{region_index}].polygon",
                ),
                visibility=visibility,
            ))
        items.append(ManifestItem(
            path=relative,
            group=str(raw.get("group", "ungrouped")).strip() or "ungrouped",
            regions=tuple(regions),
            notes=str(raw.get("notes", "")).strip(),
        ))
    return payload, tuple(items)


def _polygon_mask(polygon: tuple[tuple[float, float], ...], width: int, height: int) -> np.ndarray:
    points = np.array([
        [min(width - 1, max(0, round(x * width))), min(height - 1, max(0, round(y * height)))]
        for x, y in polygon
    ], dtype=np.int32)
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [points], 1)
    return mask


def polygon_iou(
    first: tuple[tuple[float, float], ...],
    second: tuple[tuple[float, float], ...],
    *,
    raster_size: int = 1024,
) -> float:
    first_mask = _polygon_mask(first, raster_size, raster_size)
    second_mask = _polygon_mask(second, raster_size, raster_size)
    intersection = int(np.count_nonzero(first_mask & second_mask))
    union = int(np.count_nonzero(first_mask | second_mask))
    return intersection / union if union else 0.0


def match_regions(
    ground_truth: tuple[GroundTruthRegion, ...],
    predictions: tuple[tuple[tuple[float, float], ...], ...],
    *,
    iou_threshold: float = 0.5,
) -> tuple[tuple[Match, ...], int, int, int]:
    if not 0.0 < iou_threshold <= 1.0:
        raise ValueError("iou_threshold must be within (0, 1].")

    candidates: list[tuple[float, int, int]] = []
    for gt_index, gt in enumerate(ground_truth):
        for prediction_index, prediction in enumerate(predictions):
            iou = polygon_iou(gt.polygon_normalized, prediction)
            if iou >= iou_threshold:
                candidates.append((iou, gt_index, prediction_index))
    candidates.sort(reverse=True)

    matched_gt: set[int] = set()
    matched_predictions: set[int] = set()
    matches: list[Match] = []
    for iou, gt_index, prediction_index in candidates:
        if gt_index in matched_gt or prediction_index in matched_predictions:
            continue
        matched_gt.add(gt_index)
        matched_predictions.add(prediction_index)
        matches.append(Match(
            ground_truth_id=ground_truth[gt_index].region_id,
            prediction_index=prediction_index,
            iou=round(iou, 6),
        ))

    duplicate_predictions = 0
    for prediction_index, prediction in enumerate(predictions):
        if prediction_index in matched_predictions:
            continue
        if any(
            polygon_iou(gt.polygon_normalized, prediction) >= iou_threshold
            for gt_index, gt in enumerate(ground_truth)
            if gt_index in matched_gt
        ):
            duplicate_predictions += 1

    misses = len(ground_truth) - len(matched_gt)
    false_regions = len(predictions) - len(matched_predictions) - duplicate_predictions
    return tuple(matches), misses, false_regions, duplicate_predictions


def _normalize_prediction_polygon(polygon_px: np.ndarray, width: int, height: int) -> tuple[tuple[float, float], ...]:
    return tuple(
        (float(point[0]) / width, float(point[1]) / height)
        for point in np.asarray(polygon_px).reshape(-1, 2)
    )


def evaluate_item(root: Path, item: ManifestItem, *, iou_threshold: float) -> EvaluationRow:
    resolved_root = root.resolve()
    candidate = (resolved_root / item.path).resolve()
    try:
        candidate.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError(f"Manifest path escapes benchmark root: {item.path}") from exc
    if candidate.suffix.lower() not in _ALLOWED_SUFFIXES:
        return EvaluationRow(
            path=item.path,
            group=item.group,
            expected_regions=len(item.regions),
            predicted_regions=0,
            matched_regions=0,
            missed_regions=len(item.regions),
            false_regions=0,
            duplicate_regions=0,
            mean_matched_iou=None,
            minimum_matched_iou=None,
            scene_complete=False,
            latency_ms=0.0,
            matches=(),
            notes=item.notes,
            error="Unsupported image extension.",
        )

    started = time.perf_counter()
    try:
        image = decode_image(candidate.read_bytes())
        height, width = image.shape[:2]
        detections = detect_card_objects(image)
        predictions = tuple(
            _normalize_prediction_polygon(detection.polygon_px, width, height)
            for detection in detections
        )
        matches, misses, false_regions, duplicates = match_regions(
            item.regions,
            predictions,
            iou_threshold=iou_threshold,
        )
        ious = [match.iou for match in matches]
        return EvaluationRow(
            path=item.path,
            group=item.group,
            expected_regions=len(item.regions),
            predicted_regions=len(predictions),
            matched_regions=len(matches),
            missed_regions=misses,
            false_regions=false_regions,
            duplicate_regions=duplicates,
            mean_matched_iou=round(statistics.fmean(ious), 6) if ious else None,
            minimum_matched_iou=round(min(ious), 6) if ious else None,
            scene_complete=not misses and not false_regions and not duplicates,
            latency_ms=round((time.perf_counter() - started) * 1000.0, 3),
            matches=matches,
            notes=item.notes,
        )
    except Exception as exc:
        return EvaluationRow(
            path=item.path,
            group=item.group,
            expected_regions=len(item.regions),
            predicted_regions=0,
            matched_regions=0,
            missed_regions=len(item.regions),
            false_regions=0,
            duplicate_regions=0,
            mean_matched_iou=None,
            minimum_matched_iou=None,
            scene_complete=False,
            latency_ms=round((time.perf_counter() - started) * 1000.0, 3),
            matches=(),
            notes=item.notes,
            error=f"{type(exc).__name__}: {exc}",
        )


def summarize(rows: tuple[EvaluationRow, ...]) -> dict[str, Any]:
    valid = [row for row in rows if row.error is None]
    expected = sum(row.expected_regions for row in valid)
    predicted = sum(row.predicted_regions for row in valid)
    matched = sum(row.matched_regions for row in valid)
    missed = sum(row.missed_regions for row in valid)
    false_regions = sum(row.false_regions for row in valid)
    duplicates = sum(row.duplicate_regions for row in valid)
    precision_denominator = matched + false_regions + duplicates
    precision = matched / precision_denominator if precision_denominator else 1.0
    recall = matched / expected if expected else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    matched_ious = [match.iou for row in valid for match in row.matches]
    latencies = [row.latency_ms for row in valid]
    return {
        "images": len(rows),
        "valid_images": len(valid),
        "errors": len(rows) - len(valid),
        "expected_physical_cards": expected,
        "predicted_regions": predicted,
        "one_to_one_matches": matched,
        "missed_cards": missed,
        "false_regions": false_regions,
        "duplicate_regions": duplicates,
        "localization_precision": round(precision, 6),
        "localization_recall": round(recall, 6),
        "localization_f1": round(f1, 6),
        "mean_matched_iou": round(statistics.fmean(matched_ious), 6) if matched_ious else None,
        "minimum_matched_iou": round(min(matched_ious), 6) if matched_ious else None,
        "scene_complete_images": sum(row.scene_complete for row in valid),
        "scene_complete_rate": round(sum(row.scene_complete for row in valid) / len(valid), 6) if valid else None,
        "mean_latency_ms": round(statistics.fmean(latencies), 3) if latencies else 0.0,
        "p95_latency_ms": round(sorted(latencies)[min(len(latencies) - 1, math.ceil(len(latencies) * 0.95) - 1)], 3) if latencies else 0.0,
        "release_gate": "one_to_one_localization",
        "count_only_metrics_are_diagnostic": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate one-to-one physical-card localization from polygon labels.")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--iou-threshold", type=float, default=0.5)
    args = parser.parse_args()

    payload, items = load_manifest(args.manifest)
    rows = tuple(evaluate_item(args.root, item, iou_threshold=args.iou_threshold) for item in items)
    result = {
        "manifest_version": payload.get("version"),
        "benchmark_name": payload.get("name"),
        "iou_threshold": args.iou_threshold,
        "overall": summarize(rows),
        "rows": [asdict(row) for row in rows],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result["overall"], indent=2))


if __name__ == "__main__":
    main()
