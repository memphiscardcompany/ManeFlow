import json

import pytest

from tools.evaluate_detection_localization import (
    GroundTruthRegion,
    EvaluationRow,
    Match,
    load_manifest,
    match_regions,
    summarize,
)


def _region(region_id: str, x1: float, y1: float, x2: float, y2: float) -> GroundTruthRegion:
    return GroundTruthRegion(
        region_id=region_id,
        polygon_normalized=((x1, y1), (x2, y1), (x2, y2), (x1, y2)),
    )


def _prediction(x1: float, y1: float, x2: float, y2: float):
    return ((x1, y1), (x2, y1), (x2, y2), (x1, y2))


def test_one_duplicate_and_one_miss_cannot_pass_as_exact_count():
    ground_truth = (
        _region("card-1", 0.0, 0.0, 0.4, 0.4),
        _region("card-2", 0.6, 0.0, 1.0, 0.4),
    )
    predictions = (
        _prediction(0.0, 0.0, 0.4, 0.4),
        _prediction(0.01, 0.01, 0.39, 0.39),
    )

    matches, misses, false_regions, duplicates = match_regions(
        ground_truth,
        predictions,
        iou_threshold=0.5,
    )

    assert len(predictions) == len(ground_truth)
    assert len(matches) == 1
    assert misses == 1
    assert false_regions == 0
    assert duplicates == 1


def test_false_region_is_separate_from_duplicate_region():
    ground_truth = (_region("card-1", 0.0, 0.0, 0.4, 0.4),)
    predictions = (
        _prediction(0.0, 0.0, 0.4, 0.4),
        _prediction(0.6, 0.6, 0.9, 0.9),
    )

    matches, misses, false_regions, duplicates = match_regions(
        ground_truth,
        predictions,
        iou_threshold=0.5,
    )

    assert len(matches) == 1
    assert misses == 0
    assert false_regions == 1
    assert duplicates == 0


def test_manifest_supports_full_and_partial_visible_cards(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({
        "version": "1",
        "items": [{
            "path": "binder.jpg",
            "group": "binder",
            "regions": [
                {
                    "id": "full-card",
                    "visibility": "full",
                    "polygon": [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]],
                },
                {
                    "id": "partial-card",
                    "visibility": "partial",
                    "polygon": [[0.7, 0.8], [1.0, 0.8], [1.0, 1.0], [0.7, 1.0]],
                },
            ],
        }],
    }), encoding="utf-8")

    _, items = load_manifest(manifest)
    assert len(items) == 1
    assert [region.visibility for region in items[0].regions] == ["full", "partial"]


def test_manifest_rejects_duplicate_region_ids(tmp_path):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({
        "items": [{
            "path": "binder.jpg",
            "regions": [
                {"id": "same", "polygon": [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]]},
                {"id": "same", "polygon": [[0.5, 0.5], [0.9, 0.5], [0.9, 0.9], [0.5, 0.9]]},
            ],
        }],
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="unique"):
        load_manifest(manifest)


def test_summary_uses_one_to_one_matches_not_raw_count():
    row = EvaluationRow(
        path="binder.jpg",
        group="binder",
        expected_regions=2,
        predicted_regions=2,
        matched_regions=1,
        missed_regions=1,
        false_regions=0,
        duplicate_regions=1,
        mean_matched_iou=0.9,
        minimum_matched_iou=0.9,
        scene_complete=False,
        latency_ms=20.0,
        matches=(Match("card-1", 0, 0.9),),
        notes="",
    )

    result = summarize((row,))
    assert result["localization_recall"] == 0.5
    assert result["localization_precision"] == 0.5
    assert result["scene_complete_rate"] == 0.0
    assert result["count_only_metrics_are_diagnostic"] is True
