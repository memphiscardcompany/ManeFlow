from __future__ import annotations

from pathlib import Path
from uuid import UUID

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.services.bulk_intake import pair_scan_files


client = TestClient(app)


def _write_card(path: Path) -> None:
    canvas = np.full((900, 700, 3), 245, dtype=np.uint8)
    cv2.rectangle(canvas, (70, 60), (630, 840), (25, 25, 25), 8)
    cv2.putText(canvas, "TEST CARD", (145, 450), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 0), 3)
    assert cv2.imwrite(str(path), canvas)


def test_filename_pairing(tmp_path: Path):
    front = tmp_path / "0001_front.jpg"
    back = tmp_path / "0001_back.jpg"
    _write_card(front)
    _write_card(back)
    pairs, warnings, method = pair_scan_files([back, front], "auto")
    assert method == "auto_filename"
    assert pairs == [(front, back)]
    assert not any("Odd number" in warning for warning in warnings)


def test_ricoh_import_and_opt_in_training(tmp_path: Path):
    _write_card(tmp_path / "card-001-front.jpg")
    _write_card(tmp_path / "card-001-back.jpg")

    consent = client.post(
        "/v1/contributors/consent",
        json={"display_name": "Beta Scanner", "consent_scope": "labels_only"},
    )
    assert consent.status_code == 200
    contributor_id = consent.json()["contributor_id"]

    response = client.post(
        "/v1/intake/ricoh/import-folder",
        json={
            "folder_path": str(tmp_path),
            "batch_name": "Ricoh test",
            "contributor_id": contributor_id,
            "pairing_strategy": "auto",
            "process_immediately": False,
        },
    )
    assert response.status_code == 200, response.text
    batch = response.json()
    assert batch["item_count"] == 1
    assert batch["pairing_strategy"] == "auto_filename"
    item = batch["items"][0]

    reviewed = client.post(
        f"/v1/intake/items/{item['id']}/review",
        json={
            "review_status": "corrected",
            "confirmed_fields": {
                "player_name": "Shohei Ohtani",
                "year": 2018,
                "brand": "Topps",
                "set_name": "Update",
                "card_number": "US1",
            },
        },
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["confirmed"]["player_name"] == "Shohei Ohtani"

    stats = client.get("/v1/contributions/stats")
    assert stats.status_code == 200
    assert stats.json()["contributed_examples"] >= 1
    assert stats.json()["approved_examples"] == 0
    assert stats.json()["curation_pending"] >= 1
    assert stats.json()["labels_only"] >= 1

    revoked = client.post(f"/v1/contributors/{contributor_id}/revoke")
    assert revoked.status_code == 200
    assert revoked.json()["revoked_at"] is not None


def test_batch_csv_export(tmp_path: Path):
    _write_card(tmp_path / "001.jpg")
    _write_card(tmp_path / "002.jpg")
    response = client.post(
        "/v1/intake/ricoh/import-folder",
        json={
            "folder_path": str(tmp_path),
            "pairing_strategy": "alternating",
            "process_immediately": False,
        },
    )
    assert response.status_code == 200
    batch_id = UUID(response.json()["id"])
    exported = client.get(f"/v1/intake/batches/{batch_id}/export.csv")
    assert exported.status_code == 200
    assert "sequence_no" in exported.text


def test_owner_curated_reference_can_identify_repeated_scan(tmp_path: Path):
    front = tmp_path / "unique-reference-front.jpg"
    back = tmp_path / "unique-reference-back.jpg"
    canvas = np.full((913, 697, 3), 232, dtype=np.uint8)
    cv2.rectangle(canvas, (41, 37), (655, 874), (12, 12, 12), 9)
    cv2.circle(canvas, (230, 280), 91, (80, 130, 210), -1)
    cv2.putText(canvas, "REFERENCE 7729", (90, 640), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 3)
    assert cv2.imwrite(str(front), canvas)
    cv2.flip(canvas, 1, canvas)
    assert cv2.imwrite(str(back), canvas)

    contributor = client.post(
        "/v1/contributors/consent",
        json={"display_name": "Reference beta", "consent_scope": "reference_catalog"},
    ).json()
    batch = client.post(
        "/v1/intake/ricoh/import-folder",
        json={
            "folder_path": str(tmp_path),
            "contributor_id": contributor["contributor_id"],
            "pairing_strategy": "filename",
            "process_immediately": False,
        },
    ).json()
    item = batch["items"][0]
    client.post(
        f"/v1/intake/items/{item['id']}/review",
        json={
            "review_status": "corrected",
            "confirmed_fields": {
                "player_name": "Reference Player 7729",
                "year": 2026,
                "brand": "ManeFlow Test",
                "set_name": "Curated Reference",
                "card_number": "R7729",
            },
        },
    )

    pending = client.get("/v1/contributions/examples?curation_status=pending&limit=5000").json()
    example = next(row for row in pending if row.get("source_item_id") == item["id"])
    curated = client.post(
        f"/v1/contributions/examples/{example['id']}/curate",
        json={"curation_status": "approved", "notes": "Verified during beta fixture test"},
    )
    assert curated.status_code == 200

    with front.open("rb") as handle:
        scan = client.post(
            "/v1/scan",
            files={"image": (front.name, handle, "image/jpeg")},
        )
    assert scan.status_code == 200, scan.text
    payload = scan.json()
    assert payload["predicted_card"]["player_name"] == "Reference Player 7729"
    assert payload["identity_provider"].startswith("in_house_reference")
    assert payload["identity_confidence"] >= 0.98


def test_alternating_pairing_uses_natural_numeric_filename_order(tmp_path: Path):
    paths = []
    for name in ["scan1.jpg", "scan2.jpg", "scan10.jpg", "scan11.jpg"]:
        path = tmp_path / name
        _write_card(path)
        paths.append(path)
    pairs, _, method = pair_scan_files(paths, "alternating")
    assert method == "alternating"
    assert [(front.name, back.name if back else None) for front, back in pairs] == [
        ("scan1.jpg", "scan2.jpg"),
        ("scan10.jpg", "scan11.jpg"),
    ]


def test_training_contribution_excludes_private_financial_fields(tmp_path: Path):
    _write_card(tmp_path / "privacy-front.jpg")
    _write_card(tmp_path / "privacy-back.jpg")
    contributor = client.post(
        "/v1/contributors/consent",
        json={"display_name": "Privacy tester", "consent_scope": "labels_only"},
    ).json()
    batch = client.post(
        "/v1/intake/ricoh/import-folder",
        json={
            "folder_path": str(tmp_path),
            "contributor_id": contributor["contributor_id"],
            "pairing_strategy": "filename",
            "process_immediately": False,
        },
    ).json()
    item = batch["items"][0]
    client.post(
        f"/v1/intake/items/{item['id']}/review",
        json={
            "review_status": "corrected",
            "confirmed_fields": {
                "player_name": "Privacy Player",
                "year": 2026,
                "acquisition_cost": 123.45,
                "market_value": 999.99,
                "seller_name": "Private Seller",
                "inventory_notes": "Do not export",
            },
        },
    )
    rows = client.get("/v1/contributions/examples?curation_status=pending&limit=5000").json()
    example = next(row for row in rows if row.get("source_item_id") == item["id"])
    assert example["label"]["player_name"] == "Privacy Player"
    assert example["label"]["year"] == 2026
    for forbidden in ("acquisition_cost", "market_value", "seller_name", "inventory_notes"):
        assert forbidden not in example["label"]


def test_approved_dataset_manifest_is_private_and_stably_split(tmp_path: Path):
    front = tmp_path / "dataset-front.jpg"
    back = tmp_path / "dataset-back.jpg"
    _write_card(front)
    _write_card(back)
    contributor = client.post(
        "/v1/contributors/consent",
        json={"display_name": "Dataset tester", "consent_scope": "images_and_labels"},
    ).json()
    batch = client.post(
        "/v1/intake/ricoh/import-folder",
        json={
            "folder_path": str(tmp_path),
            "contributor_id": contributor["contributor_id"],
            "pairing_strategy": "filename",
            "process_immediately": False,
        },
    ).json()
    item = batch["items"][0]
    client.post(
        f"/v1/intake/items/{item['id']}/review",
        json={
            "review_status": "corrected",
            "confirmed_fields": {
                "player_name": "Dataset Player",
                "year": 2025,
                "brand": "ManeFlow Test",
                "card_number": "DS1",
                "acquisition_cost": 500,
                "market_value": 750,
                "seller_name": "Never export",
            },
        },
    )
    pending = client.get("/v1/contributions/examples?curation_status=pending&limit=5000").json()
    example = next(row for row in pending if row.get("source_item_id") == item["id"])
    approved = client.post(
        f"/v1/contributions/examples/{example['id']}/curate",
        json={"curation_status": "approved", "notes": "ground truth checked"},
    )
    assert approved.status_code == 200

    manifest_one = client.get("/v1/contributions/dataset-manifest")
    manifest_two = client.get("/v1/contributions/dataset-manifest")
    assert manifest_one.status_code == 200
    assert manifest_two.status_code == 200
    rows_one = manifest_one.json()["examples"]
    rows_two = manifest_two.json()["examples"]
    row_one = next(row for row in rows_one if row["example_id"] == example["id"])
    row_two = next(row for row in rows_two if row["example_id"] == example["id"])
    assert row_one["split"] in {"train", "validation", "test"}
    assert row_one["split"] == row_two["split"]
    assert row_one["label"]["player_name"] == "Dataset Player"
    assert row_one["front_image_available"] is True
    assert "display_name" not in row_one
    assert "contributor_id" not in row_one
    for forbidden in ("acquisition_cost", "market_value", "seller_name"):
        assert forbidden not in row_one["label"]
    summary = manifest_one.json()["summary"]
    assert summary["approved_examples"] == summary["train"] + summary["validation"] + summary["test"]
