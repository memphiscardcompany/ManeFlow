from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np

from app.services.imaging.card_detector import decode_image, detect_cards
from app.services.imaging.detector_router import detect_card_objects


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
CATEGORIES = [
    {"id": 1, "name": "raw_card", "supercategory": "card_item"},
    {"id": 2, "name": "graded_slab", "supercategory": "card_item"},
    {"id": 3, "name": "toploader", "supercategory": "card_item"},
    {"id": 4, "name": "one_touch", "supercategory": "card_item"},
    {"id": 5, "name": "sealed_pack", "supercategory": "card_item"},
    {"id": 6, "name": "card_stack", "supercategory": "card_item"},
]
CATEGORY_ID_BY_KIND = {
    "raw_card": 1,
    "unknown_card_object": 1,
    "partial_card": 1,
    "slab": 2,
    "graded_slab": 2,
    "toploader": 3,
    "one_touch": 4,
    "sealed_pack": 5,
    "card_stack": 6,
}


@dataclass(frozen=True)
class BuildSummary:
    images: int
    annotations: int
    negatives: int
    skipped: int
    split_counts: dict[str, int]

    def to_dict(self) -> dict[str, Any]:
        return {
            "images": self.images,
            "annotations": self.annotations,
            "negatives": self.negatives,
            "skipped": self.skipped,
            "split_counts": self.split_counts,
        }


def _iter_images(root: Path) -> Iterable[Path]:
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES:
            yield path


def _group_key(path: Path, root: Path) -> str:
    relative = path.relative_to(root).as_posix().lower()
    stem = re.sub(
        r"(?:[_\-. ](?:front|back|obverse|reverse|img|image|photo|scan|page)[_\-. ]*\d*)+$",
        "",
        Path(relative).stem,
        flags=re.IGNORECASE,
    )
    parent = Path(relative).parent.as_posix()
    return f"{parent}/{stem}" if parent != "." else stem


def _split_for_group(group_key: str) -> str:
    digest = hashlib.sha256(group_key.encode("utf-8")).digest()
    bucket = int.from_bytes(digest[:4], "big") % 100
    if bucket < 70:
        return "train"
    if bucket < 90:
        return "valid"
    return "test"


def _load_image(path: Path) -> np.ndarray:
    return decode_image(path.read_bytes())


def _polygon_coordinates(points: np.ndarray) -> list[float]:
    return [round(float(value), 2) for point in points for value in point]


def build_dataset(
    *,
    input_dir: Path,
    output_dir: Path,
    detector: str,
    include_whole_image_fallback: bool,
    copy_mode: str,
) -> BuildSummary:
    if not input_dir.is_dir():
        raise FileNotFoundError(f"Input directory does not exist: {input_dir}")
    if detector not in {"classical", "configured"}:
        raise ValueError("detector must be 'classical' or 'configured'.")
    if copy_mode not in {"copy", "hardlink"}:
        raise ValueError("copy_mode must be 'copy' or 'hardlink'.")

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    documents: dict[str, dict[str, Any]] = {
        split: {"images": [], "annotations": [], "categories": CATEGORIES}
        for split in ("train", "valid", "test")
    }
    image_ids = {"train": 1, "valid": 1, "test": 1}
    annotation_ids = {"train": 1, "valid": 1, "test": 1}
    split_counts = {"train": 0, "valid": 0, "test": 0}
    negatives = 0
    skipped = 0
    annotation_count = 0

    detector_fn = detect_cards if detector == "classical" else detect_card_objects

    for source_path in _iter_images(input_dir):
        try:
            image = _load_image(source_path)
        except (OSError, ValueError, cv2.error):
            skipped += 1
            continue

        detections = detector_fn(image)
        if not include_whole_image_fallback:
            detections = [item for item in detections if not item.fallback_whole_image]
        if not detections:
            negatives += 1

        group_key = _group_key(source_path, input_dir)
        split = _split_for_group(group_key)
        split_dir = output_dir / split
        split_dir.mkdir(parents=True, exist_ok=True)
        destination_name = f"{hashlib.sha1(source_path.relative_to(input_dir).as_posix().encode()).hexdigest()[:12]}_{source_path.name}"
        destination_path = split_dir / destination_name
        if copy_mode == "hardlink":
            try:
                destination_path.hardlink_to(source_path)
            except OSError:
                shutil.copy2(source_path, destination_path)
        else:
            shutil.copy2(source_path, destination_path)

        image_id = image_ids[split]
        image_ids[split] += 1
        split_counts[split] += 1
        height, width = image.shape[:2]
        documents[split]["images"].append(
            {
                "id": image_id,
                "file_name": destination_name,
                "width": int(width),
                "height": int(height),
                "maneflow_group_key": group_key,
                "maneflow_source_path": source_path.relative_to(input_dir).as_posix(),
                "maneflow_annotation_status": "draft_requires_human_review",
            }
        )

        for detection in detections:
            polygon = np.asarray(detection.polygon_px, dtype=np.float32).reshape(-1, 2)
            if len(polygon) < 3:
                continue
            area = abs(float(cv2.contourArea(polygon)))
            if area < 4.0:
                continue
            x, y, bbox_width, bbox_height = cv2.boundingRect(polygon.astype(np.int32))
            category_id = CATEGORY_ID_BY_KIND.get(detection.kind_hint, 1)
            documents[split]["annotations"].append(
                {
                    "id": annotation_ids[split],
                    "image_id": image_id,
                    "category_id": category_id,
                    "segmentation": [_polygon_coordinates(polygon)],
                    "area": round(area, 2),
                    "bbox": [int(x), int(y), int(bbox_width), int(bbox_height)],
                    "iscrowd": 0,
                    "maneflow_detector": detection.detector_name,
                    "maneflow_detector_confidence": detection.confidence,
                    "maneflow_review_required": True,
                }
            )
            annotation_ids[split] += 1
            annotation_count += 1

    for split, document in documents.items():
        split_dir = output_dir / split
        split_dir.mkdir(parents=True, exist_ok=True)
        (split_dir / "_annotations.coco.json").write_text(
            json.dumps(document, indent=2) + "\n",
            encoding="utf-8",
        )

    summary = BuildSummary(
        images=sum(split_counts.values()),
        annotations=annotation_count,
        negatives=negatives,
        skipped=skipped,
        split_counts=split_counts,
    )
    (output_dir / "dataset-build-summary.json").write_text(
        json.dumps(summary.to_dict(), indent=2) + "\n",
        encoding="utf-8",
    )
    (output_dir / "REVIEW-BEFORE-UPLOAD.md").write_text(
        """# ManeFlow Roboflow Seed Dataset\n\n"
        "These COCO segmentation annotations are **draft pre-annotations**, not ground truth.\n\n"
        "Before training:\n\n"
        "1. Review every mask in Roboflow.\n"
        "2. Correct holder classes; classical geometry cannot reliably distinguish holders.\n"
        "3. Add missed overlapping and partially hidden cards.\n"
        "4. Delete false positives on rectangular background objects.\n"
        "5. Keep related front/back and lot images in the generated split.\n"
        "6. Do not train until the review queue is complete.\n"
        """,
        encoding="utf-8",
    )
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a Roboflow-ready COCO instance-segmentation seed dataset from card images."
    )
    parser.add_argument("--input", type=Path, required=True, help="Folder containing source images.")
    parser.add_argument("--output", type=Path, required=True, help="Destination dataset folder.")
    parser.add_argument(
        "--detector",
        choices=("classical", "configured"),
        default="classical",
        help="Use conservative classical draft masks or the configured ManeFlow detector.",
    )
    parser.add_argument(
        "--include-whole-image-fallback",
        action="store_true",
        help="Include whole-image fallback detections. Disabled by default to reduce false labels.",
    )
    parser.add_argument("--copy-mode", choices=("copy", "hardlink"), default="copy")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    summary = build_dataset(
        input_dir=args.input.expanduser().resolve(),
        output_dir=args.output.expanduser().resolve(),
        detector=args.detector,
        include_whole_image_fallback=args.include_whole_image_fallback,
        copy_mode=args.copy_mode,
    )
    print(json.dumps(summary.to_dict(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
