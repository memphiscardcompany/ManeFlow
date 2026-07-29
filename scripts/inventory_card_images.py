"""Create a rights-aware, read-only inventory of Joshua's Card Images folder.

The source directory is never modified. The manifest deliberately does not infer
card identity or training rights from filenames or local possession.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError


SUPPORTED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".heif",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def difference_hash(image: Image.Image, size: int = 8) -> str:
    grayscale = ImageOps.exif_transpose(image).convert("L").resize(
        (size + 1, size),
        Image.Resampling.LANCZOS,
    )
    pixels = list(grayscale.getdata())
    bits = []
    for row in range(size):
        offset = row * (size + 1)
        bits.extend(
            pixels[offset + column] > pixels[offset + column + 1]
            for column in range(size)
        )
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return f"{value:0{size * size // 4}x}"


def orientation_name(exif_orientation: int | None) -> str:
    return {
        1: "normal",
        2: "mirrored_horizontal",
        3: "rotated_180",
        4: "mirrored_vertical",
        5: "mirrored_horizontal_rotated_270",
        6: "rotated_90",
        7: "mirrored_horizontal_rotated_90",
        8: "rotated_270",
    }.get(exif_orientation, "unknown")


def inspect_image(path: Path) -> dict:
    try:
        with Image.open(path) as image:
            exif = image.getexif()
            orientation = exif.get(274) if exif else None
            return {
                "decode_status": "decoded",
                "detected_format": image.format,
                "width": image.width,
                "height": image.height,
                "exif_orientation": orientation,
                "orientation": orientation_name(orientation),
                "perceptual_hash_dhash64": difference_hash(image),
                "assessment_status": "not_evaluated",
                "blur_indicator": None,
                "glare_indicator": None,
                "crop_indicator": None,
                "rotation_indicator": orientation not in (None, 1),
                "occlusion_indicator": None,
                "compression_indicator": None,
            }
    except (UnidentifiedImageError, OSError, ValueError) as error:
        return {
            "decode_status": "unsupported_or_unreadable",
            "decode_error_type": type(error).__name__,
            "detected_format": None,
            "width": None,
            "height": None,
            "exif_orientation": None,
            "orientation": "unverified",
            "perceptual_hash_dhash64": None,
            "assessment_status": "not_evaluated",
            "blur_indicator": None,
            "glare_indicator": None,
            "crop_indicator": None,
            "rotation_indicator": None,
            "occlusion_indicator": None,
            "compression_indicator": None,
        }


def stable_asset_id(sha256: str) -> str:
    return f"mcc-card-image-{sha256[:24]}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--summary", required=True, type=Path)
    args = parser.parse_args()

    source = args.source.resolve(strict=True)
    output = args.output.resolve()
    summary = args.summary.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    summary.parent.mkdir(parents=True, exist_ok=True)

    paths = sorted(
        (
            path
            for path in source.rglob("*")
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
        ),
        key=lambda item: str(item.relative_to(source)).lower(),
    )

    records = []
    hashes = defaultdict(list)
    perceptual_hashes = defaultdict(list)
    extension_counts = Counter()
    decode_counts = Counter()
    total_bytes = 0
    generated_at = datetime.now(timezone.utc).isoformat()

    for path in paths:
        relative_path = path.relative_to(source).as_posix()
        file_hash = sha256_file(path)
        stat = path.stat()
        inspection = inspect_image(path)
        record = {
            "asset_id": stable_asset_id(file_hash),
            "sha256": file_hash,
            "original_relative_path": relative_path,
            "source_root_name": source.name,
            "file_extension": path.suffix.lower(),
            "size_bytes": stat.st_size,
            "modified_at_utc": datetime.fromtimestamp(
                stat.st_mtime, timezone.utc
            ).isoformat(),
            **inspection,
            "exact_duplicate_group": None,
            "near_duplicate_group": None,
            "media_class": "card_image_candidate",
            "provenance": "owner_local_google_drive_transfer",
            "authorization_status": "review_required",
            "training_eligible": False,
            "evaluation_eligible": False,
            "label_status": "unverified_no_filename_inference",
            "privacy_status": "private_owner_material",
            "lineage": {
                "original_is_immutable": True,
                "derived_asset": False,
                "inventory_generated_at": generated_at,
            },
        }
        records.append(record)
        hashes[file_hash].append(record)
        if inspection["perceptual_hash_dhash64"]:
            perceptual_hashes[inspection["perceptual_hash_dhash64"]].append(record)
        extension_counts[path.suffix.lower()] += 1
        decode_counts[inspection["decode_status"]] += 1
        total_bytes += stat.st_size

    duplicate_index = 0
    for group in hashes.values():
        if len(group) < 2:
            continue
        duplicate_index += 1
        group_id = f"exact-{duplicate_index:04d}"
        for record in group:
            record["exact_duplicate_group"] = group_id

    near_duplicate_index = 0
    for group in perceptual_hashes.values():
        distinct_hashes = {record["sha256"] for record in group}
        if len(group) < 2 or len(distinct_hashes) < 2:
            continue
        near_duplicate_index += 1
        group_id = f"visual-exact-dhash-{near_duplicate_index:04d}"
        for record in group:
            record["near_duplicate_group"] = group_id

    with output.open("w", encoding="utf-8", newline="\n") as stream:
        for record in records:
            stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True))
            stream.write("\n")

    exact_duplicate_files = sum(
        len(group) for group in hashes.values() if len(group) > 1
    )
    near_duplicate_files = sum(
        len(group)
        for group in perceptual_hashes.values()
        if len(group) > 1 and len({record["sha256"] for record in group}) > 1
    )
    summary_text = f"""# Card Images read-only inventory

Generated: {generated_at}

Source: `{source}`

The source directory was read only. No original was moved, renamed, converted,
uploaded, labeled, or used for training. Local possession and filenames were not
treated as authorization or identity evidence.

## Counts

- Media files inventoried: {len(records)}
- Total bytes: {total_bytes}
- Decoded: {decode_counts.get("decoded", 0)}
- Unsupported or unreadable: {decode_counts.get("unsupported_or_unreadable", 0)}
- Exact duplicate groups: {duplicate_index}
- Files in exact duplicate groups: {exact_duplicate_files}
- Same-dHash visual groups: {near_duplicate_index}
- Files in same-dHash visual groups: {near_duplicate_files}

## Extensions

{os.linesep.join(f"- `{extension}`: {count}" for extension, count in sorted(extension_counts.items()))}

## Rights and quality status

- Authorization: `review_required`
- Training eligibility: `false`
- Evaluation eligibility: `false`
- Labels: `unverified_no_filename_inference`
- Privacy: `private_owner_material`
- Blur, glare, crop, occlusion, and compression: `not_evaluated`
- HEIC/HEIF dimensions and visual hashes remain unverified when the local decoder
  cannot open them.

The manifest is metadata only. Raw images do not belong in ordinary Git.
"""
    summary.write_text(summary_text, encoding="utf-8", newline="\n")
    print(
        json.dumps(
            {
                "ok": True,
                "files": len(records),
                "bytes": total_bytes,
                "decoded": decode_counts.get("decoded", 0),
                "unsupported": decode_counts.get("unsupported_or_unreadable", 0),
                "manifest": str(output),
                "summary": str(summary),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
