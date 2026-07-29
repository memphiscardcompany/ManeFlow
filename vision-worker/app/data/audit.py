from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".heic", ".heif"}
AUTHORIZATION_STATES = {
    "AUTHORIZED_TRAINING",
    "AUTHORIZED_EVALUATION_ONLY",
    "AUTHORIZED_RETRIEVAL_ONLY",
    "QUARANTINED_PENDING_REVIEW",
    "PROHIBITED",
}


class DatasetAuditError(RuntimeError):
    """Raised when a dataset audit cannot proceed safely."""


class UnionFind:
    def __init__(self, values: Iterable[int]) -> None:
        self.parent = {value: value for value in values}

    def find(self, value: int) -> int:
        root = value
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[value] != value:
            parent = self.parent[value]
            self.parent[value] = root
            value = parent
        return root

    def union(self, left: int, right: int) -> None:
        root_left = self.find(left)
        root_right = self.find(right)
        if root_left != root_right:
            self.parent[root_right] = root_left


@dataclass
class AssetRecord:
    asset_id: str
    relative_path: str
    sha256: str | None
    perceptual_hash: str | None
    source: str
    authorization_state: str
    allowed_uses: list[str]
    width: int
    height: int
    format: str
    bytes: int
    card_count: int | None
    front_back_state: str
    raw_graded_state: str
    label_state: str
    duplicate_group: str | None
    split: str | None
    corrupt: bool
    error: str | None
    quality: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _average_hash(image: Image.Image) -> str:
    grayscale = image.convert("L").resize((8, 8), Image.Resampling.LANCZOS)
    pixels = np.asarray(grayscale, dtype=np.float32)
    bits = pixels >= float(pixels.mean())
    value = 0
    for bit in bits.reshape(-1):
        value = (value << 1) | int(bool(bit))
    return f"{value:016x}"


def _hamming(left: str, right: str) -> int:
    return (int(left, 16) ^ int(right, 16)).bit_count()


def _quality_metrics(rgb: np.ndarray) -> dict[str, Any]:
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    blur_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mean_luminance = float(gray.mean())
    dark_fraction = float(np.mean(gray <= 12))
    clipped_high_fraction = float(np.mean(gray >= 248))
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    likely_glare = (value >= 245) & (saturation <= 38)
    glare_fraction = float(np.mean(likely_glare))
    return {
        "blur_variance": round(blur_variance, 4),
        "likely_blurry": blur_variance < 55.0,
        "mean_luminance": round(mean_luminance, 4),
        "dark_fraction": round(dark_fraction, 6),
        "clipped_high_fraction": round(clipped_high_fraction, 6),
        "glare_fraction": round(glare_fraction, 6),
        "likely_low_light": mean_luminance < 45.0 or dark_fraction > 0.20,
        "likely_overexposed": clipped_high_fraction > 0.18,
        "likely_high_glare": glare_fraction > 0.08,
    }


def _allowed_uses(state: str) -> list[str]:
    if state == "AUTHORIZED_TRAINING":
        return ["training", "validation", "evaluation", "retrieval"]
    if state == "AUTHORIZED_EVALUATION_ONLY":
        return ["evaluation"]
    if state == "AUTHORIZED_RETRIEVAL_ONLY":
        return ["retrieval"]
    return []


def _discover(input_path: Path) -> list[Path]:
    if not input_path.exists():
        raise DatasetAuditError(f"Dataset input does not exist: {input_path}")
    if input_path.is_file():
        return [input_path]
    return sorted(
        path
        for path in input_path.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def _read_asset(
    path: Path,
    *,
    root: Path,
    source: str,
    authorization_state: str,
) -> AssetRecord:
    relative = path.name if root.is_file() else path.relative_to(root).as_posix()
    stable_id = hashlib.sha256(relative.encode("utf-8")).hexdigest()[:24]
    try:
        digest = _sha256(path)
    except OSError as exc:
        return AssetRecord(
            asset_id=stable_id,
            relative_path=relative,
            sha256=None,
            perceptual_hash=None,
            source=source,
            authorization_state=authorization_state,
            allowed_uses=_allowed_uses(authorization_state),
            width=0,
            height=0,
            format=path.suffix.lower().lstrip(".") or "unknown",
            bytes=0,
            card_count=None,
            front_back_state="unknown",
            raw_graded_state="unknown",
            label_state="unverified",
            duplicate_group=None,
            split=None,
            corrupt=True,
            error=f"read_failed: {exc}",
            quality={},
        )
    try:
        with Image.open(path) as image:
            image.load()
            rgb_image = image.convert("RGB")
            rgb = np.asarray(rgb_image)
            width, height = rgb_image.size
            image_format = (image.format or path.suffix.lower().lstrip(".") or "unknown").lower()
            phash = _average_hash(rgb_image)
            quality = _quality_metrics(rgb)
            quality.update(
                {
                    "aspect_ratio": round(width / height, 6) if height else None,
                    "orientation": "landscape" if width > height else "portrait" if height > width else "square",
                    "likely_low_resolution": min(width, height) < 600,
                    "screenshot_state": "unverified",
                    "orientation_detection": "metadata_dimensions_only",
                }
            )
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        return AssetRecord(
            asset_id=stable_id,
            relative_path=relative,
            sha256=digest,
            perceptual_hash=None,
            source=source,
            authorization_state=authorization_state,
            allowed_uses=_allowed_uses(authorization_state),
            width=0,
            height=0,
            format=path.suffix.lower().lstrip(".") or "unknown",
            bytes=path.stat().st_size,
            card_count=None,
            front_back_state="unknown",
            raw_graded_state="unknown",
            label_state="unverified",
            duplicate_group=None,
            split=None,
            corrupt=True,
            error=f"decode_failed: {exc}",
            quality={},
        )
    return AssetRecord(
        asset_id=stable_id,
        relative_path=relative,
        sha256=digest,
        perceptual_hash=phash,
        source=source,
        authorization_state=authorization_state,
        allowed_uses=_allowed_uses(authorization_state),
        width=width,
        height=height,
        format=image_format,
        bytes=path.stat().st_size,
        card_count=None,
        front_back_state="unknown",
        raw_graded_state="unknown",
        label_state="unverified",
        duplicate_group=None,
        split=None,
        corrupt=False,
        error=None,
        quality=quality,
    )


def _group_duplicates(records: list[AssetRecord], *, near_duplicate_distance: int) -> None:
    valid_indices = [index for index, record in enumerate(records) if not record.corrupt and record.sha256]
    groups = UnionFind(valid_indices)
    by_sha: dict[str, list[int]] = defaultdict(list)
    for index in valid_indices:
        by_sha[records[index].sha256 or ""].append(index)
    for indices in by_sha.values():
        for index in indices[1:]:
            groups.union(indices[0], index)

    # Near-duplicate grouping is intentionally conservative. It uses a small
    # average-hash distance and comparable aspect ratio, and never labels the
    # images as the same physical card without human review.
    for offset, left_index in enumerate(valid_indices):
        left = records[left_index]
        if left.perceptual_hash is None or left.height <= 0:
            continue
        left_ratio = left.width / left.height
        for right_index in valid_indices[offset + 1 :]:
            right = records[right_index]
            if right.perceptual_hash is None or right.height <= 0:
                continue
            right_ratio = right.width / right.height
            if abs(left_ratio - right_ratio) > 0.03:
                continue
            if _hamming(left.perceptual_hash, right.perceptual_hash) <= near_duplicate_distance:
                groups.union(left_index, right_index)

    members: dict[int, list[int]] = defaultdict(list)
    for index in valid_indices:
        members[groups.find(index)].append(index)
    for member_indices in members.values():
        identity = hashlib.sha256(
            "|".join(sorted(records[index].sha256 or "" for index in member_indices)).encode("utf-8")
        ).hexdigest()[:20]
        group_id = f"dup-{identity}"
        for index in member_indices:
            records[index].duplicate_group = group_id


def _split_for_group(group_id: str) -> str:
    bucket = int(hashlib.sha256(group_id.encode("utf-8")).hexdigest()[:8], 16) % 100
    if bucket < 70:
        return "train"
    if bucket < 85:
        return "validation"
    return "locked_test"


def _assign_splits(records: list[AssetRecord], authorization_state: str) -> None:
    for record in records:
        if record.corrupt or not record.duplicate_group:
            record.split = None
        elif authorization_state == "AUTHORIZED_TRAINING":
            record.split = _split_for_group(record.duplicate_group)
        elif authorization_state == "AUTHORIZED_EVALUATION_ONLY":
            record.split = "locked_test"
        else:
            record.split = None


def audit_dataset(
    input_path: Path,
    *,
    source: str,
    authorization_state: str = "QUARANTINED_PENDING_REVIEW",
    near_duplicate_distance: int = 4,
) -> tuple[list[AssetRecord], dict[str, Any]]:
    if authorization_state not in AUTHORIZATION_STATES:
        raise DatasetAuditError(
            f"Unsupported authorization state {authorization_state!r}; expected one of {sorted(AUTHORIZATION_STATES)}"
        )
    resolved = input_path.expanduser().resolve()
    files = _discover(resolved)
    records = [
        _read_asset(
            path,
            root=resolved,
            source=source,
            authorization_state=authorization_state,
        )
        for path in files
    ]
    _group_duplicates(records, near_duplicate_distance=max(0, near_duplicate_distance))
    _assign_splits(records, authorization_state)
    exact_counts = Counter(record.sha256 for record in records if record.sha256)
    duplicate_groups = Counter(record.duplicate_group for record in records if record.duplicate_group)
    summary = {
        "schema_version": 1,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "input": str(resolved),
        "source": source,
        "authorization_state": authorization_state,
        "allowed_uses": _allowed_uses(authorization_state),
        "files_discovered": len(files),
        "records": len(records),
        "valid_images": sum(not record.corrupt for record in records),
        "corrupt_images": sum(record.corrupt for record in records),
        "exact_duplicate_files": sum(count - 1 for count in exact_counts.values() if count > 1),
        "duplicate_groups": sum(1 for count in duplicate_groups.values() if count > 1),
        "split_counts": dict(Counter(record.split or "unassigned" for record in records)),
        "format_counts": dict(Counter(record.format for record in records)),
        "quality_flags": {
            "likely_blurry": sum(bool(record.quality.get("likely_blurry")) for record in records),
            "likely_low_light": sum(bool(record.quality.get("likely_low_light")) for record in records),
            "likely_high_glare": sum(bool(record.quality.get("likely_high_glare")) for record in records),
            "likely_low_resolution": sum(bool(record.quality.get("likely_low_resolution")) for record in records),
        },
        "safety": {
            "original_files_modified": False,
            "training_permitted": authorization_state == "AUTHORIZED_TRAINING",
            "unknown_rights_default": "QUARANTINED_PENDING_REVIEW",
            "automatic_identity_labels_created": False,
            "private_exif_persisted": False,
        },
        "limitations": [
            "Perceptual duplicate groups require human review before being treated as the same physical card.",
            "Card count, front/back, raw/graded, identity, and labels remain unknown until supported evidence is reviewed.",
            "This audit performs CPU file and image analysis only; neural crop, OCR, and embedding stages are separate approved jobs.",
        ],
    }
    return records, summary


def _write_jsonl(path: Path, records: list[AssetRecord]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record.to_dict(), sort_keys=True) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit an authorized or quarantined ManeFlow image dataset.")
    parser.add_argument("--input", required=True, help="Folder or image file to audit without modifying it.")
    parser.add_argument("--source", default="owner_local_candidate")
    parser.add_argument(
        "--authorization-state",
        choices=sorted(AUTHORIZATION_STATES),
        default="QUARANTINED_PENDING_REVIEW",
    )
    parser.add_argument("--manifest-out", default="../data/dataset-manifest.jsonl")
    parser.add_argument("--report-out", default="../artifacts/dataset-audit.json")
    parser.add_argument("--near-duplicate-distance", type=int, default=4)
    args = parser.parse_args()
    records, report = audit_dataset(
        Path(args.input),
        source=args.source,
        authorization_state=args.authorization_state,
        near_duplicate_distance=args.near_duplicate_distance,
    )
    manifest_path = Path(args.manifest_out).expanduser().resolve()
    report_path = Path(args.report_out).expanduser().resolve()
    _write_jsonl(manifest_path, records)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    print(f"Manifest: {manifest_path}")
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
