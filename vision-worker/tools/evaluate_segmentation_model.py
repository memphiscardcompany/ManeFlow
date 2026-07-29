from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from app.services.imaging.card_detector import decode_image
from app.services.imaging.detector_router import detect_card_objects


@dataclass(frozen=True)
class GroundTruthObject:
    category: str
    polygon: np.ndarray


@dataclass(frozen=True)
class PredictionObject:
    category: str
    confidence: float
    polygon: np.ndarray


def _mask_iou(left: np.ndarray, right: np.ndarray, width: int, height: int) -> float:
    left_mask = np.zeros((height, width), dtype=np.uint8)
    right_mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(left_mask, [left.astype(np.int32)], 1)
    cv2.fillPoly(right_mask, [right.astype(np.int32)], 1)
    intersection = int(np.count_nonzero(left_mask & right_mask))
    union = int(np.count_nonzero(left_mask | right_mask))
    return intersection / union if union else 0.0


def _normalize_category(value: str) -> str:
    aliases = {
        "slab": "graded_slab",
        "unknown_card_object": "raw_card",
        "partial_card": "raw_card",
    }
    return aliases.get(value, value)


def _load_coco(path: Path) -> tuple[dict[int, dict[str, Any]], dict[int, list[GroundTruthObject]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    categories = {int(row["id"]): str(row["name"]) for row in payload.get("categories", [])}
    images = {int(row["id"]): row for row in payload.get("images", [])}
    objects: dict[int, list[GroundTruthObject]] = defaultdict(list)
    for annotation in payload.get("annotations", []):
        segmentation = annotation.get("segmentation") or []
        if not segmentation or not isinstance(segmentation[0], list):
            continue
        values = np.asarray(segmentation[0], dtype=np.float32)
        if values.size < 6 or values.size % 2:
            continue
        objects[int(annotation["image_id"])].append(
            GroundTruthObject(
                category=_normalize_category(categories[int(annotation["category_id"])]),
                polygon=values.reshape(-1, 2),
            )
        )
    return images, objects


def evaluate(dataset_dir: Path, *, iou_threshold: float, output_path: Path | None) -> dict[str, Any]:
    annotation_path = dataset_dir / "_annotations.coco.json"
    if not annotation_path.is_file():
        raise FileNotFoundError(f"COCO annotation file was not found: {annotation_path}")
    images, ground_truth_by_image = _load_coco(annotation_path)

    totals = {"true_positive": 0, "false_positive": 0, "false_negative": 0}
    per_class: dict[str, dict[str, int]] = defaultdict(
        lambda: {"true_positive": 0, "false_positive": 0, "false_negative": 0}
    )
    failures: list[dict[str, Any]] = []
    latency_ms: list[float] = []

    for image_id, metadata in images.items():
        image_path = dataset_dir / metadata["file_name"]
        image = decode_image(image_path.read_bytes())
        height, width = image.shape[:2]
        start = cv2.getTickCount()
        detections = detect_card_objects(image)
        elapsed = (cv2.getTickCount() - start) * 1000.0 / cv2.getTickFrequency()
        latency_ms.append(float(elapsed))
        predictions = [
            PredictionObject(
                category=_normalize_category(item.kind_hint),
                confidence=item.confidence,
                polygon=np.asarray(item.polygon_px, dtype=np.float32),
            )
            for item in detections
            if not item.fallback_whole_image
        ]
        truths = list(ground_truth_by_image.get(image_id, []))
        candidate_pairs: list[tuple[float, int, int]] = []
        for truth_index, truth in enumerate(truths):
            for prediction_index, prediction in enumerate(predictions):
                if truth.category != prediction.category:
                    continue
                iou = _mask_iou(truth.polygon, prediction.polygon, width, height)
                if iou >= iou_threshold:
                    candidate_pairs.append((iou, truth_index, prediction_index))
        candidate_pairs.sort(reverse=True)
        matched_truths: set[int] = set()
        matched_predictions: set[int] = set()
        for _, truth_index, prediction_index in candidate_pairs:
            if truth_index in matched_truths or prediction_index in matched_predictions:
                continue
            matched_truths.add(truth_index)
            matched_predictions.add(prediction_index)
            totals["true_positive"] += 1
            per_class[truths[truth_index].category]["true_positive"] += 1

        missed = [truth for index, truth in enumerate(truths) if index not in matched_truths]
        extras = [prediction for index, prediction in enumerate(predictions) if index not in matched_predictions]
        for truth in missed:
            totals["false_negative"] += 1
            per_class[truth.category]["false_negative"] += 1
        for prediction in extras:
            totals["false_positive"] += 1
            per_class[prediction.category]["false_positive"] += 1
        if missed or extras:
            failures.append(
                {
                    "file_name": metadata["file_name"],
                    "missed": [item.category for item in missed],
                    "false_positives": [item.category for item in extras],
                }
            )

    tp = totals["true_positive"]
    fp = totals["false_positive"]
    fn = totals["false_negative"]
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    class_metrics: dict[str, Any] = {}
    for category, counts in sorted(per_class.items()):
        class_tp = counts["true_positive"]
        class_fp = counts["false_positive"]
        class_fn = counts["false_negative"]
        class_precision = class_tp / (class_tp + class_fp) if class_tp + class_fp else 1.0
        class_recall = class_tp / (class_tp + class_fn) if class_tp + class_fn else 1.0
        class_metrics[category] = {
            **counts,
            "precision": round(class_precision, 6),
            "recall": round(class_recall, 6),
        }

    report = {
        "iou_threshold": iou_threshold,
        "images": len(images),
        "totals": totals,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
        "latency_ms": {
            "mean": round(float(np.mean(latency_ms)), 3) if latency_ms else 0.0,
            "p95": round(float(np.percentile(latency_ms, 95)), 3) if latency_ms else 0.0,
            "max": round(max(latency_ms), 3) if latency_ms else 0.0,
        },
        "per_class": class_metrics,
        "failure_count": len(failures),
        "failures": failures[:100],
    }
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate the configured ManeFlow segmenter against COCO masks.")
    parser.add_argument("--dataset", type=Path, required=True, help="A train/valid/test folder containing _annotations.coco.json.")
    parser.add_argument("--iou", type=float, default=0.50, help="Minimum mask IoU for a true positive.")
    parser.add_argument("--output", type=Path, default=None, help="Optional JSON report path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not 0.05 <= args.iou <= 0.95:
        raise ValueError("--iou must be between 0.05 and 0.95.")
    report = evaluate(
        args.dataset.expanduser().resolve(),
        iou_threshold=args.iou,
        output_path=args.output.expanduser().resolve() if args.output else None,
    )
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
