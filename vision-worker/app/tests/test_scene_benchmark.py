import json

import pytest

from tools.evaluate_scene_detector_manifest import (
    EvaluationRow,
    ManifestItem,
    _metrics,
    evaluate,
    load_manifest,
)


def _row(*, expected: int | None, detected: int) -> EvaluationRow:
    missed = max(0, expected - detected) if expected is not None else None
    excess = max(0, detected - expected) if expected is not None else None
    recall = min(detected, expected) / expected if expected else None
    return EvaluationRow(
        path="scene.jpg",
        group="dense",
        contains_card_content=True,
        predicted_card_content=detected > 0,
        detection_count=detected,
        expected_card_count=expected,
        count_missed=missed,
        count_excess=excess,
        card_count_recall_proxy=recall,
        fallback_count=0,
        maximum_confidence=0.9,
        quality_score=90,
        latency_ms=10.0,
        outcome="true_positive" if detected else "false_negative",
        notes="",
    )


def test_metrics_report_card_count_recall_separately_from_scene_recall():
    metrics = _metrics([
        _row(expected=13, detected=2),
        _row(expected=8, detected=8),
    ])

    assert metrics["recall"] == 1.0
    assert metrics["positive_images"] == 2
    assert metrics["negative_images"] == 0
    assert metrics["binary_metrics_cover_both_classes"] is False
    assert metrics["expected_cards"] == 21
    assert metrics["count_credited_detections"] == 10
    assert metrics["count_missed_cards"] == 11
    assert metrics["card_count_recall_proxy"] == pytest.approx(10 / 21, abs=1e-6)
    assert metrics["exact_count_rate"] == 0.5


def test_manifest_rejects_invalid_expected_card_count(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({
        "items": [{
            "path": "scene.jpg",
            "contains_card_content": True,
            "group": "dense",
            "expected_card_count": -1,
        }]
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="expected_card_count"):
        load_manifest(manifest)


def test_manifest_rejects_non_boolean_content_label(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({
        "items": [{
            "path": "scene.jpg",
            "contains_card_content": "false",
            "group": "negative",
        }]
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="contains_card_content"):
        load_manifest(manifest)


def test_unsupported_extension_is_preserved_as_benchmark_error(tmp_path):
    rows = evaluate(tmp_path, [ManifestItem(
        path="scene.txt",
        contains_card_content=True,
        group="invalid",
        expected_card_count=2,
    )])

    assert len(rows) == 1
    assert rows[0].outcome == "error"
    assert rows[0].expected_card_count == 2
    assert rows[0].count_missed == 2


def test_metrics_mark_mixed_positive_and_negative_coverage():
    positive = _row(expected=1, detected=1)
    negative = EvaluationRow(
        path="negative.png",
        group="negative",
        contains_card_content=False,
        predicted_card_content=False,
        detection_count=0,
        expected_card_count=0,
        count_missed=0,
        count_excess=0,
        card_count_recall_proxy=1.0,
        fallback_count=0,
        maximum_confidence=0.0,
        quality_score=90,
        latency_ms=5.0,
        outcome="true_negative",
        notes="",
    )

    metrics = _metrics([positive, negative])

    assert metrics["positive_images"] == 1
    assert metrics["negative_images"] == 1
    assert metrics["binary_metrics_cover_both_classes"] is True
