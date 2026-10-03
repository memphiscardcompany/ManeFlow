"""Gate exact card identity on independently labeled, rights-cleared held-out scenes.

The input predictions must come from the exact commit being evaluated. This scorer
never creates labels from a model output and never treats a count-only match as
one-to-one localization. Video frames use the same item/region shape as images.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any


GROUPS = {
    "single_raw", "slab", "parallel_variation", "multi_card",
    "clutter", "sleeve_toploader", "video", "negative",
}
_SHA = re.compile(r"^[a-f0-9]{64}$")
_COMMIT = re.compile(r"^[a-f0-9]{40}$")


def _box(value: Any) -> tuple[float, float, float, float]:
    if not isinstance(value, list) or len(value) != 4 or any(
        isinstance(number, bool) or not isinstance(number, (int, float)) for number in value
    ):
        raise ValueError("Every region requires a normalized [x, y, width, height] box.")
    x, y, width, height = map(float, value)
    if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < width <= 1 and 0 < height <= 1
            and x + width <= 1.000001 and y + height <= 1.000001):
        raise ValueError("Region box lies outside the image or has zero area.")
    return x, y, width, height


def _iou(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    lx, ly, lw, lh = left
    rx, ry, rw, rh = right
    width = max(0.0, min(lx + lw, rx + rw) - max(lx, rx))
    height = max(0.0, min(ly + lh, ry + rh) - max(ly, ry))
    intersection = width * height
    union = lw * lh + rw * rh - intersection
    return intersection / union if union else 0.0


def _matching(labels: list[dict], predictions: list[dict]) -> list[tuple[int, int]]:
    candidates = sorted((
        (_iou(_box(label["bbox"]), _box(prediction.get("bbox", prediction.get("bounding_box")))), i, j)
        for i, label in enumerate(labels)
        for j, prediction in enumerate(predictions)
    ), reverse=True)
    assigned_labels: set[int] = set()
    assigned_predictions: set[int] = set()
    matches = []
    for iou, label_index, prediction_index in candidates:
        if iou < 0.5:
            break
        if label_index not in assigned_labels and prediction_index not in assigned_predictions:
            matches.append((label_index, prediction_index))
            assigned_labels.add(label_index)
            assigned_predictions.add(prediction_index)
    return matches


def evaluate(manifest: dict, predictions: dict, *, source_commit: str, minimum_per_group: int = 10) -> dict:
    if not _COMMIT.fullmatch(source_commit) or predictions.get("source_commit") != source_commit:
        raise ValueError("Predictions must declare the exact evaluated source commit.")
    if manifest.get("schema_version") != "maneflow-identity-release-v1" or manifest.get("split") != "locked_test":
        raise ValueError("A locked test manifest is required.")
    policy = manifest.get("rights_policy") or {}
    if policy.get("ground_truth_policy") != "independent_labels_only" or policy.get("competitor_output_policy") != "never_ground_truth":
        raise ValueError("Independent ground-truth policy is required.")
    items = manifest.get("items")
    outputs = predictions.get("items")
    if not isinstance(items, list) or not items or not isinstance(outputs, list):
        raise ValueError("Non-empty manifest and prediction items are required.")
    by_id = {item.get("asset_id"): item for item in outputs if isinstance(item, dict)}
    if len(by_id) != len(outputs):
        raise ValueError("Prediction asset IDs must be unique.")
    seen: set[str] = set()
    seen_groups: set[str] = set()
    group_counts = {group: 0 for group in GROUPS}
    totals = {key: 0 for key in (
        "expected_cards", "predicted_regions", "localized_cards", "false_regions",
        "exact_visible", "exact_correct", "parallel_labeled", "parallel_correct",
        "accepted_identities", "confident_wrong", "abstentions", "review_id_leaks",
    )}
    rows = []
    for item in items:
        asset_id = item.get("asset_id")
        if not isinstance(asset_id, str) or not asset_id or asset_id in seen:
            raise ValueError("Manifest asset IDs must be unique and non-empty.")
        seen.add(asset_id)
        group = item.get("group")
        if group not in GROUPS:
            raise ValueError(f"Unsupported benchmark group: {group}.")
        seen_groups.add(group)
        if item.get("rights_status") not in {"owner-controlled", "explicitly-licensed", "partner-approved", "public-domain", "permissive-open-license"}:
            raise ValueError(f"Rights are not cleared for {asset_id}.")
        if item.get("training_use_allowed") is not False or item.get("locked") is not True:
            raise ValueError(f"Locked test asset {asset_id} cannot be used for training.")
        if not _SHA.fullmatch(str(item.get("sha256", ""))):
            raise ValueError(f"Missing asset SHA-256 for {asset_id}.")
        output = by_id.get(asset_id)
        if output is None or output.get("sha256") != item["sha256"]:
            raise ValueError(f"Prediction is missing or has a different asset hash: {asset_id}.")
        labels = item.get("regions")
        predicted = output.get("regions", output.get("tracks"))
        if not isinstance(labels, list) or not isinstance(predicted, list):
            raise ValueError(f"Regions must be arrays for {asset_id}.")
        if group == "negative" and labels:
            raise ValueError("Negative scenes cannot contain card labels.")
        if group == "parallel_variation" and any(not label.get("parallel") for label in labels):
            raise ValueError("Parallel benchmark labels must name the exact parallel or variation.")
        for label in labels:
            _box(label.get("bbox"))
            if label.get("exact_visible") and not label.get("catalog_card_id"):
                raise ValueError(f"Visible exact identity lacks an independent catalog label in {asset_id}.")
        for prediction in predicted:
            _box(prediction.get("bbox", prediction.get("bounding_box")))
        matches = _matching(labels, predicted)
        group_counts[group] += 1
        totals["expected_cards"] += len(labels)
        totals["predicted_regions"] += len(predicted)
        totals["localized_cards"] += len(matches)
        totals["false_regions"] += len(predicted) - len(matches)
        for label_index, prediction_index in matches:
            label = labels[label_index]
            prediction = predicted[prediction_index]
            identity = prediction.get("identity") or prediction
            card = identity.get("card") or identity
            card_id = card.get("card_id") or identity.get("catalog_card_id")
            review = bool(identity.get("needs_manual_confirmation", True))
            if card_id and review:
                totals["review_id_leaks"] += 1
            accepted = bool(card_id and not review)
            if accepted:
                totals["accepted_identities"] += 1
            else:
                totals["abstentions"] += 1
            exact_visible = bool(label.get("exact_visible"))
            if exact_visible:
                totals["exact_visible"] += 1
                if accepted and str(card_id) == str(label.get("catalog_card_id")):
                    totals["exact_correct"] += 1
            if accepted and (not exact_visible or str(card_id) != str(label.get("catalog_card_id"))):
                totals["confident_wrong"] += 1
            if label.get("parallel"):
                totals["parallel_labeled"] += 1
                if accepted and str(card.get("parallel") or "").casefold() == str(label["parallel"]).casefold():
                    totals["parallel_correct"] += 1
        rows.append({"asset_id": asset_id, "group": group, "expected": len(labels),
                     "predicted": len(predicted), "localized": len(matches)})
    if set(by_id) != seen:
        raise ValueError("Predictions contain assets absent from the locked manifest.")
    required_coverage = {group: group_counts[group] >= minimum_per_group for group in GROUPS}
    ratio = lambda numerator, denominator: round(numerator / denominator, 6) if denominator else None
    metrics = {
        **totals,
        "localization_recall": ratio(totals["localized_cards"], totals["expected_cards"]),
        "localization_precision": ratio(totals["localized_cards"], totals["predicted_regions"]),
        "exact_recall": ratio(totals["exact_correct"], totals["exact_visible"]),
        "parallel_accuracy": ratio(totals["parallel_correct"], totals["parallel_labeled"]),
        "confident_wrong_rate": ratio(totals["confident_wrong"], totals["accepted_identities"]),
    }
    passes = all(required_coverage.values()) and totals["review_id_leaks"] == 0
    passes = passes and totals["false_regions"] == 0 and (metrics["localization_recall"] or 0) >= 0.95
    passes = passes and (metrics["exact_recall"] or 0) >= 0.90 and (metrics["parallel_accuracy"] or 0) >= 0.90
    passes = passes and (metrics["confident_wrong_rate"] or 0) <= 0.01
    return {"source_commit": source_commit, "release_gate_passed": passes,
            "required_coverage": required_coverage, "minimum_scenes_per_group": minimum_per_group,
            "metrics": metrics, "rows": rows}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--predictions", required=True, type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = evaluate(json.loads(args.manifest.read_text(encoding="utf-8")),
                      json.loads(args.predictions.read_text(encoding="utf-8")), source_commit=args.source_commit)
    if args.output.exists():
        raise ValueError("Refusing to overwrite an existing release result.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "rows"}, indent=2))
    if not result["release_gate_passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
