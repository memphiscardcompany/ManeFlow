from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np
from PIL import Image, ImageOps

AUTHORIZATION_STATES = {
    "AUTHORIZED_TRAINING",
    "AUTHORIZED_EVALUATION_ONLY",
    "AUTHORIZED_RETRIEVAL_ONLY",
    "QUARANTINED_PENDING_REVIEW",
    "PROHIBITED",
}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp", ".heic", ".heif"}


@dataclass
class DatasetAsset:
    asset_id: str
    relative_path: str
    sha256: str
    perceptual_hash: str
    source: str
    authorization_state: str
    allowed_uses: list[str]
    width: int
    height: int
    format: str
    card_count: int | None = None
    front_back_state: str = "unknown"
    raw_graded_state: str = "unknown"
    label_state: str = "unverified"
    duplicate_group: str | None = None
    split: str | None = None
    corrupt: bool = False
    blur_score: float | None = None
    exposure_mean: float | None = None
    exposure_clipped_dark: float | None = None
    exposure_clipped_bright: float | None = None
    glare_fraction: float | None = None
    aspect_ratio: float | None = None
    error: str | None = None


def allowed_uses(state: str) -> list[str]:
    return {
        "AUTHORIZED_TRAINING": ["training", "evaluation", "retrieval"],
        "AUTHORIZED_EVALUATION_ONLY": ["evaluation"],
        "AUTHORIZED_RETRIEVAL_ONLY": ["retrieval"],
        "QUARANTINED_PENDING_REVIEW": [],
        "PROHIBITED": [],
    }[state]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dhash(image: Image.Image, hash_size: int = 16) -> str:
    gray = ImageOps.grayscale(image).resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
    values = np.asarray(gray, dtype=np.int16)
    bits = values[:, 1:] > values[:, :-1]
    integer = 0
    for bit in bits.reshape(-1):
        integer = (integer << 1) | int(bit)
    return f"{integer:0{hash_size * hash_size // 4}x}"


def hamming_hex(left: str, right: str) -> int:
    return (int(left, 16) ^ int(right, 16)).bit_count()


def quality_metrics(image: Image.Image) -> dict[str, float]:
    rgb = np.asarray(image.convert("RGB"))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mean = float(gray.mean())
    dark = float(np.mean(gray <= 5))
    bright = float(np.mean(gray >= 250))
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    glare = float(np.mean((hsv[:, :, 2] >= 245) & (hsv[:, :, 1] <= 45)))
    return {
        "blur_score": round(blur, 4),
        "exposure_mean": round(mean, 4),
        "exposure_clipped_dark": round(dark, 6),
        "exposure_clipped_bright": round(bright, 6),
        "glare_fraction": round(glare, 6),
    }


def discover_images(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def audit_asset(path: Path, root: Path, state: str, source: str) -> DatasetAsset:
    relative = path.relative_to(root).as_posix()
    digest = sha256_file(path)
    asset_id = hashlib.sha256(f"{source}|{relative}|{digest}".encode()).hexdigest()[:32]
    try:
        with Image.open(path) as opened:
            opened.verify()
        with Image.open(path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            width, height = image.size
            metrics = quality_metrics(image)
            return DatasetAsset(
                asset_id=asset_id,
                relative_path=relative,
                sha256=digest,
                perceptual_hash=dhash(image),
                source=source,
                authorization_state=state,
                allowed_uses=allowed_uses(state),
                width=width,
                height=height,
                format=(opened.format or path.suffix.lstrip(".")).upper(),
                aspect_ratio=round(width / height, 6) if height else None,
                **metrics,
            )
    except Exception as error:
        return DatasetAsset(
            asset_id=asset_id,
            relative_path=relative,
            sha256=digest,
            perceptual_hash="",
            source=source,
            authorization_state=state,
            allowed_uses=allowed_uses(state),
            width=0,
            height=0,
            format=path.suffix.lstrip(".").upper(),
            corrupt=True,
            error=str(error)[:500],
        )


def _union_find_groups(assets: list[DatasetAsset], max_hamming: int) -> dict[int, list[int]]:
    parent = list(range(len(assets)))

    def find(value: int) -> int:
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    def union(left: int, right: int) -> None:
        a, b = find(left), find(right)
        if a != b:
            parent[b] = a

    exact: dict[str, int] = {}
    valid_indices = [index for index, asset in enumerate(assets) if not asset.corrupt]
    for index in valid_indices:
        digest = assets[index].sha256
        if digest in exact:
            union(index, exact[digest])
        else:
            exact[digest] = index

    for offset, left in enumerate(valid_indices):
        left_hash = assets[left].perceptual_hash
        if not left_hash:
            continue
        for right in valid_indices[offset + 1 :]:
            right_hash = assets[right].perceptual_hash
            if right_hash and hamming_hex(left_hash, right_hash) <= max_hamming:
                union(left, right)

    groups: dict[int, list[int]] = {}
    for index in range(len(assets)):
        groups.setdefault(find(index), []).append(index)
    return groups


def assign_groups_and_splits(
    assets: list[DatasetAsset],
    *,
    near_duplicate_hamming: int = 6,
    assign_splits: bool = False,
) -> None:
    groups = _union_find_groups(assets, near_duplicate_hamming)
    for indices in groups.values():
        group_material = "|".join(sorted(assets[index].sha256 for index in indices))
        group_id = "dup-" + hashlib.sha256(group_material.encode()).hexdigest()[:16]
        split = None
        if assign_splits:
            bucket = int(hashlib.sha256(group_id.encode()).hexdigest()[:8], 16) % 100
            split = "training" if bucket < 70 else "validation" if bucket < 85 else "locked_test"
        for index in indices:
            assets[index].duplicate_group = group_id
            assets[index].split = split


def validate_no_split_leakage(assets: Iterable[DatasetAsset]) -> list[str]:
    groups: dict[str, set[str]] = {}
    for asset in assets:
        if asset.duplicate_group and asset.split:
            groups.setdefault(asset.duplicate_group, set()).add(asset.split)
    return [
        f"{group} appears in multiple splits: {sorted(splits)}"
        for group, splits in groups.items()
        if len(splits) > 1
    ]


def audit_folder(
    input_root: Path,
    *,
    state: str = "QUARANTINED_PENDING_REVIEW",
    source: str = "owner-local-folder-unverified",
    assign_splits: bool = False,
    near_duplicate_hamming: int = 6,
) -> tuple[list[DatasetAsset], dict[str, Any]]:
    root = input_root.expanduser().resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Dataset folder does not exist: {root}")
    if state not in AUTHORIZATION_STATES:
        raise ValueError(f"Unknown authorization state: {state}")
    images = discover_images(root)
    assets = [audit_asset(path, root, state, source) for path in images]
    assign_groups_and_splits(
        assets,
        near_duplicate_hamming=near_duplicate_hamming,
        assign_splits=assign_splits,
    )
    leakage = validate_no_split_leakage(assets)
    summary = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input_root": str(root),
        "source": source,
        "authorization_state": state,
        "allowed_uses": allowed_uses(state),
        "files_discovered": len(images),
        "valid_images": sum(not asset.corrupt for asset in assets),
        "corrupt_images": sum(asset.corrupt for asset in assets),
        "exact_duplicate_files": len(assets) - len({asset.sha256 for asset in assets}),
        "duplicate_groups": len({asset.duplicate_group for asset in assets if asset.duplicate_group}),
        "split_counts": {
            split: sum(asset.split == split for asset in assets)
            for split in ("training", "validation", "locked_test")
        },
        "split_leakage": leakage,
        "training_permitted": state == "AUTHORIZED_TRAINING",
        "warnings": [
            "Authorization state applies to the folder as supplied and must be backed by owner-controlled provenance.",
            "Near-duplicate grouping is a screening aid and does not prove physical-card identity.",
            "Unknown rights default to quarantine and produce no training eligibility.",
        ],
    }
    return assets, summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit a rights-classified ManeFlow image folder.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--authorization-state", default="QUARANTINED_PENDING_REVIEW", choices=sorted(AUTHORIZATION_STATES))
    parser.add_argument("--source", default="owner-local-folder-unverified")
    parser.add_argument("--manifest-out", default="../artifacts/private/dataset-manifest.jsonl")
    parser.add_argument("--summary-out", default="../artifacts/dataset-audit.json")
    parser.add_argument("--assign-splits", action="store_true")
    parser.add_argument("--near-duplicate-hamming", type=int, default=6)
    parser.add_argument("--owner-approved-training", action="store_true")
    args = parser.parse_args()

    if args.authorization_state == "AUTHORIZED_TRAINING" and not args.owner_approved_training:
        parser.error("AUTHORIZED_TRAINING requires --owner-approved-training and documented provenance.")

    assets, summary = audit_folder(
        Path(args.input),
        state=args.authorization_state,
        source=args.source,
        assign_splits=args.assign_splits,
        near_duplicate_hamming=args.near_duplicate_hamming,
    )
    manifest = Path(args.manifest_out)
    report = Path(args.summary_out)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text("".join(json.dumps(asdict(asset), sort_keys=True) + "\n" for asset in assets), encoding="utf-8")
    report.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 1 if summary["split_leakage"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
