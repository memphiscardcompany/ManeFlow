from copy import deepcopy

import pytest

from tools.evaluate_identity_release import GROUPS, evaluate


COMMIT = "a" * 40
HASH = "b" * 64
BOX = [0.1, 0.1, 0.3, 0.4]


def fixture():
    manifest = {
        "schema_version": "maneflow-identity-release-v1",
        "split": "locked_test",
        "rights_policy": {"ground_truth_policy": "independent_labels_only", "competitor_output_policy": "never_ground_truth"},
        "items": [],
    }
    predictions = {"source_commit": COMMIT, "items": []}
    for group in sorted(GROUPS):
        label = {"id": "physical-1", "bbox": BOX, "catalog_card_id": "catalog-1", "exact_visible": True}
        prediction = {"bbox": BOX, "card_id": "catalog-1", "needs_manual_confirmation": False,
                      "parallel": "Gold", "identity_confidence": 0.98, "variant_confidence": 0.94}
        if group == "parallel_variation":
            label["parallel"] = "Gold"
        if group == "negative":
            label = None
            prediction = None
        manifest["items"].append({"asset_id": group, "group": group, "sha256": HASH,
                                  "rights_status": "owner-controlled", "training_use_allowed": False,
                                  "locked": True, "physical_card_group_id": group,
                                  "regions": [label] if label else []})
        predictions["items"].append({"asset_id": group, "sha256": HASH,
                                     "regions": [prediction] if prediction else []})
    return manifest, predictions


def test_complete_labeled_coverage_can_pass_with_exact_head_and_one_to_one_identity():
    manifest, predictions = fixture()
    result = evaluate(manifest, predictions, source_commit=COMMIT, minimum_per_group=1)
    assert result["release_gate_passed"] is True
    assert result["metrics"]["exact_recall"] == 1.0
    assert result["metrics"]["parallel_accuracy"] == 1.0


def test_duplicate_detection_and_missed_card_fail_even_when_counts_match():
    manifest, predictions = fixture()
    index = next(i for i, item in enumerate(manifest["items"]) if item["group"] == "multi_card")
    manifest["items"][index]["regions"].append({"id": "physical-2", "bbox": [0.6, 0.1, 0.3, 0.4],
                                                    "catalog_card_id": "catalog-2", "exact_visible": True})
    predictions["items"][index]["regions"].append(deepcopy(predictions["items"][index]["regions"][0]))
    result = evaluate(manifest, predictions, source_commit=COMMIT, minimum_per_group=1)
    assert result["metrics"]["expected_cards"] == result["metrics"]["predicted_regions"]
    assert result["metrics"]["localization_recall"] < 1
    assert result["metrics"]["false_regions"] == 1
    assert result["release_gate_passed"] is False



def test_missed_exact_parallel_card_counts_against_end_to_end_accuracy():
    manifest, predictions = fixture()
    index = next(i for i, item in enumerate(manifest["items"]) if item["group"] == "parallel_variation")
    manifest["items"][index]["regions"].append({
        "id": "physical-2",
        "bbox": [0.6, 0.1, 0.3, 0.4],
        "catalog_card_id": "catalog-2",
        "exact_visible": True,
        "parallel": "Blue",
    })
    result = evaluate(manifest, predictions, source_commit=COMMIT, minimum_per_group=1)
    assert result["metrics"]["exact_visible"] == 8
    assert result["metrics"]["exact_correct"] == 7
    assert result["metrics"]["exact_recall"] == 0.875
    assert result["metrics"]["parallel_labeled"] == 2
    assert result["metrics"]["parallel_correct"] == 1
    assert result["metrics"]["parallel_accuracy"] == 0.5
    assert result["release_gate_passed"] is False


def test_confident_identity_on_false_region_counts_as_confident_wrong():
    manifest, predictions = fixture()
    index = next(i for i, item in enumerate(manifest["items"]) if item["group"] == "negative")
    predictions["items"][index]["regions"].append({
        "bbox": BOX,
        "card_id": "hallucinated-card",
        "needs_manual_confirmation": False,
        "identity_confidence": 0.99,
        "variant_confidence": 0.99,
    })
    result = evaluate(manifest, predictions, source_commit=COMMIT, minimum_per_group=1)
    assert result["metrics"]["false_regions"] == 1
    assert result["metrics"]["accepted_identities"] == 8
    assert result["metrics"]["confident_wrong"] == 1
    assert result["metrics"]["confident_wrong_rate"] == 0.125
    assert result["release_gate_passed"] is False

def test_confident_wrong_parallel_and_review_id_leak_fail_closed():
    manifest, predictions = fixture()
    index = next(i for i, item in enumerate(manifest["items"]) if item["group"] == "parallel_variation")
    predictions["items"][index]["regions"][0]["card_id"] = "wrong-card"
    predictions["items"][index]["regions"][0]["parallel"] = "Base"
    result = evaluate(manifest, predictions, source_commit=COMMIT, minimum_per_group=1)
    assert result["metrics"]["confident_wrong"] == 1
    assert result["metrics"]["parallel_accuracy"] == 0
    assert result["release_gate_passed"] is False
    predictions["items"][index]["regions"][0]["needs_manual_confirmation"] = True
    result = evaluate(manifest, predictions, source_commit=COMMIT, minimum_per_group=1)
    assert result["metrics"]["review_id_leaks"] == 1
    assert result["release_gate_passed"] is False


def test_missing_real_coverage_rights_or_exact_commit_cannot_pass():
    manifest, predictions = fixture()
    assert evaluate(manifest, predictions, source_commit=COMMIT)["release_gate_passed"] is False
    with pytest.raises(ValueError, match="exact evaluated source commit"):
        evaluate(manifest, predictions, source_commit="c" * 40, minimum_per_group=1)
    manifest["items"][0]["rights_status"] = "terms-unclear"
    with pytest.raises(ValueError, match="Rights are not cleared"):
        evaluate(manifest, predictions, source_commit=COMMIT, minimum_per_group=1)
