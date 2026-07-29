from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from app.core.config import settings
from app.services.bulk_intake_repository import bulk_intake_repository
from app.services.identity_engine import identity_engine
from app.services.imaging.barcode import decode_barcodes
from app.services.imaging.card_detector import decode_image
from app.services.imaging.fingerprint import difference_hash
from app.services.imaging.quality import analyze_image_quality


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
_FRONT_MARKERS = {"front", "f", "obverse", "a"}
_BACK_MARKERS = {"back", "b", "reverse", "r"}
_MARKER_RE = re.compile(r"(?i)(?:^|[_\-.\s])(front|back|obverse|reverse|f|b|a|r)(?:$|[_\-.\s])")
_NATURAL_PART_RE = re.compile(r"(\d+)")


def _natural_key(path: Path) -> tuple:
    return tuple(
        int(part) if part.isdigit() else part.lower()
        for part in _NATURAL_PART_RE.split(path.name)
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_name(path: Path) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", path.name)


def _marker_and_base(path: Path) -> tuple[str | None, str]:
    stem = path.stem
    matches = list(_MARKER_RE.finditer(stem))
    if not matches:
        return None, re.sub(r"[^a-z0-9]+", "", stem.lower())
    marker = matches[-1].group(1).lower()
    side = "front" if marker in _FRONT_MARKERS else "back"
    start, end = matches[-1].span()
    base = (stem[:start] + stem[end:]).strip(" _-.")
    return side, re.sub(r"[^a-z0-9]+", "", base.lower())


def _filename_pairs(files: list[Path]) -> tuple[list[tuple[Path, Path | None]], list[str]]:
    groups: dict[str, dict[str, list[Path]]] = {}
    unmarked: list[Path] = []
    warnings: list[str] = []
    for path in files:
        side, base = _marker_and_base(path)
        if not side:
            unmarked.append(path)
            continue
        groups.setdefault(base or path.stem.lower(), {"front": [], "back": []})[side].append(path)

    pairs: list[tuple[Path, Path | None]] = []
    for base in sorted(groups):
        fronts = sorted(groups[base]["front"], key=_natural_key)
        backs = sorted(groups[base]["back"], key=_natural_key)
        count = max(len(fronts), len(backs))
        for index in range(count):
            front = fronts[index] if index < len(fronts) else None
            back = backs[index] if index < len(backs) else None
            if front is None and back is not None:
                front, back = back, None
                warnings.append(f"Back-only file treated as front for group {base}: {front.name}")
            if front is not None:
                pairs.append((front, back))
        if len(fronts) != len(backs):
            warnings.append(
                f"Uneven front/back count for group {base}: {len(fronts)} front, {len(backs)} back."
            )

    if unmarked:
        warnings.append(f"{len(unmarked)} file(s) did not include a front/back filename marker.")
    return pairs, warnings


def _alternating_pairs(files: list[Path]) -> tuple[list[tuple[Path, Path | None]], list[str]]:
    pairs: list[tuple[Path, Path | None]] = []
    ordered = sorted(files, key=_natural_key)
    for index in range(0, len(ordered), 2):
        pairs.append((ordered[index], ordered[index + 1] if index + 1 < len(ordered) else None))
    warnings = []
    if len(ordered) % 2:
        warnings.append("Odd number of scan files; final item has no back image.")
    return pairs, warnings


def pair_scan_files(files: list[Path], strategy: str) -> tuple[list[tuple[Path, Path | None]], list[str], str]:
    if strategy == "filename":
        pairs, warnings = _filename_pairs(files)
        return pairs, warnings, "filename"
    if strategy == "alternating":
        pairs, warnings = _alternating_pairs(files)
        return pairs, warnings, "alternating"

    marked_pairs, marked_warnings = _filename_pairs(files)
    marked_file_count = sum(1 + int(back is not None) for front, back in marked_pairs)
    if marked_pairs and marked_file_count >= max(2, int(len(files) * 0.6)):
        covered = {front.resolve() for front, _ in marked_pairs}
        covered.update(back.resolve() for _, back in marked_pairs if back)
        remaining = [path for path in files if path.resolve() not in covered]
        extra_pairs, extra_warnings = _alternating_pairs(remaining) if remaining else ([], [])
        return marked_pairs + extra_pairs, marked_warnings + extra_warnings, "auto_filename"

    pairs, warnings = _alternating_pairs(files)
    warnings.insert(0, "Auto pairing selected sequential duplex order because filenames lacked reliable side markers.")
    return pairs, warnings, "auto_alternating"


class BulkIntakeService:
    def import_ricoh_folder(self, request: dict[str, Any]) -> dict[str, Any]:
        folder = Path(request["folder_path"]).expanduser().resolve()
        if not folder.exists() or not folder.is_dir():
            raise ValueError("The selected Ricoh scan folder does not exist or is not a directory.")

        files = [
            path for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
        ]
        files.sort(key=_natural_key)
        if not files:
            raise ValueError("No supported Ricoh scan images were found in the selected folder.")
        if len(files) > int(request.get("max_items", 5000)) * 2:
            raise ValueError("The folder exceeds the configured bulk intake item limit.")

        pairs, warnings, selected_strategy = pair_scan_files(files, request.get("pairing_strategy") or "auto")
        if not pairs:
            raise ValueError("No front/back scan pairs could be created.")

        batch_id = uuid4()
        blob_dir = settings.images_dir / "card-blobs"
        if request.get("copy_into_maneflow", True):
            blob_dir.mkdir(parents=True, exist_ok=True)

        def managed_copy(source: Path, sha256: str) -> Path:
            bucket = blob_dir / sha256[:2]
            bucket.mkdir(parents=True, exist_ok=True)
            extension = source.suffix.lower() if source.suffix.lower() in SUPPORTED_EXTENSIONS else ".img"
            target = bucket / f"{sha256}{extension}"
            if not target.exists():
                temporary = target.with_suffix(target.suffix + ".tmp")
                shutil.copy2(source, temporary)
                temporary.replace(target)
            return target

        items: list[dict[str, Any]] = []
        for sequence_no, (front, back) in enumerate(pairs, start=1):
            front_hash = _sha256(front)
            back_hash = _sha256(back) if back else None
            front_path = managed_copy(front, front_hash) if request.get("copy_into_maneflow", True) else front
            back_path = managed_copy(back, back_hash) if back and request.get("copy_into_maneflow", True) else back

            try:
                front_dhash = difference_hash(decode_image(front_path.read_bytes()))
            except Exception:
                front_dhash = None
            try:
                back_dhash = difference_hash(decode_image(back_path.read_bytes())) if back_path else None
            except Exception:
                back_dhash = None

            items.append({
                "id": str(uuid4()),
                "sequence_no": sequence_no,
                "front_image_path": str(front_path),
                "back_image_path": str(back_path) if back_path else None,
                "front_sha256": front_hash,
                "back_sha256": back_hash,
                "evidence": {
                    "source": "ricoh_duplex_folder",
                    "original_front_filename": front.name,
                    "original_back_filename": back.name if back else None,
                    "pairing_strategy": selected_strategy,
                    "front_dhash": front_dhash,
                    "back_dhash": back_dhash,
                },
            })

        batch = bulk_intake_repository.create_batch(
            {
                "id": str(batch_id),
                "contributor_id": str(request["contributor_id"]) if request.get("contributor_id") else None,
                "batch_name": request.get("batch_name") or folder.name,
                "scanner_model": request.get("scanner_model") or "Ricoh duplex scanner",
                "source_folder": str(folder),
                "pairing_strategy": selected_strategy,
                "status": "imported",
                "file_count": len(files),
                "warnings": warnings,
                "metadata": {
                    "copy_into_maneflow": bool(request.get("copy_into_maneflow", True)),
                    "storage_layout": "content_addressed_sha256",
                    "supported_extensions": sorted(SUPPORTED_EXTENSIONS),
                },
            },
            items,
        )
        return batch

    async def process_batch(self, batch_id: UUID, *, limit: int | None = None) -> dict[str, Any]:
        batch = bulk_intake_repository.get_batch(batch_id, include_items=True)
        bulk_intake_repository.update_batch_status(batch_id, "processing")
        processed = 0
        failures: list[str] = []

        for item in batch["items"]:
            if limit is not None and processed >= limit:
                break
            front_path = Path(item["front_image_path"])
            try:
                front_bytes = front_path.read_bytes()
                front_image = decode_image(front_bytes)
                front_quality = analyze_image_quality(front_image)
                front_barcodes = decode_barcodes(front_image)

                back_path = Path(item["back_image_path"]) if item.get("back_image_path") else None
                back_bytes = back_path.read_bytes() if back_path and back_path.is_file() else None
                back_quality = None
                back_barcodes: list[str] = []
                if back_bytes:
                    back_image = decode_image(back_bytes)
                    back_quality = analyze_image_quality(back_image)
                    back_barcodes = decode_barcodes(back_image)

                identity = await identity_engine.identify_pair(
                    front_bytes,
                    back_bytes,
                    front_media_type=self._media_type(front_path),
                    back_media_type=self._media_type(back_path) if back_path else "image/jpeg",
                    front_barcode_values=front_barcodes,
                    back_barcode_values=back_barcodes,
                )
                evidence = {
                    **(item.get("evidence") or {}),
                    "front_quality": front_quality.to_dict(),
                    "back_quality": back_quality.to_dict() if back_quality else None,
                    "barcode_values": identity.barcode_values,
                    "visible_text": identity.visible_text,
                    "provider": identity.provider,
                    "processed_remotely": identity.processed_remotely,
                    "card_side": identity.card_side,
                    "warnings": identity.warnings,
                }
                bulk_intake_repository.update_item_prediction(
                    UUID(item["id"]),
                    {
                        "predicted": identity.card.model_dump(mode="json"),
                        "evidence": evidence,
                        "identity_confidence": identity.identity_confidence,
                        "variant_confidence": identity.variant_confidence,
                    },
                )
                processed += 1
            except Exception as exc:
                failures.append(f"Item {item['sequence_no']}: {type(exc).__name__}: {exc}")

        updated = bulk_intake_repository.get_batch(batch_id, include_items=True)
        status = "review" if processed else "imported"
        bulk_intake_repository.update_batch_status(batch_id, status)
        updated = bulk_intake_repository.get_batch(batch_id, include_items=True)
        updated["processing_summary"] = {
            "processed": processed,
            "failed": len(failures),
            "failures": failures[:100],
        }
        return updated

    @staticmethod
    def _media_type(path: Path) -> str:
        return {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
            ".tif": "image/tiff",
            ".tiff": "image/tiff",
        }.get(path.suffix.lower(), "application/octet-stream")


bulk_intake_service = BulkIntakeService()
