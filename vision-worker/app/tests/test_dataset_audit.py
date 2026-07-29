from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from maneflow_vision.data.audit import (
    audit_folder,
    validate_no_split_leakage,
)


def _card(path: Path, marker: int = 0):
    image = Image.new("RGB", (300, 420), (30, 40, 70))
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 10, 290, 410), outline=(245, 245, 245), width=8)
    draw.ellipse((80 + marker, 120, 220 + marker, 260), fill=(200, 80, 40))
    image.save(path)


def test_unknown_rights_default_to_quarantine(tmp_path: Path):
    _card(tmp_path / "card.jpg")
    assets, summary = audit_folder(tmp_path)
    assert len(assets) == 1
    assert assets[0].authorization_state == "QUARANTINED_PENDING_REVIEW"
    assert assets[0].allowed_uses == []
    assert summary["training_permitted"] is False


def test_duplicate_images_remain_in_one_split(tmp_path: Path):
    _card(tmp_path / "front-a.png")
    (tmp_path / "front-b.png").write_bytes((tmp_path / "front-a.png").read_bytes())
    _card(tmp_path / "different.png", marker=20)
    assets, summary = audit_folder(
        tmp_path,
        state="AUTHORIZED_TRAINING",
        source="owner-controlled-test-fixture",
        assign_splits=True,
    )
    duplicates = [asset for asset in assets if asset.relative_path in {"front-a.png", "front-b.png"}]
    assert duplicates[0].duplicate_group == duplicates[1].duplicate_group
    assert duplicates[0].split == duplicates[1].split
    assert validate_no_split_leakage(assets) == []
    assert summary["training_permitted"] is True


def test_corrupt_image_is_recorded_not_crashed(tmp_path: Path):
    (tmp_path / "broken.jpg").write_bytes(b"not an image")
    assets, summary = audit_folder(tmp_path)
    assert assets[0].corrupt is True
    assert assets[0].error
    assert summary["corrupt_images"] == 1
