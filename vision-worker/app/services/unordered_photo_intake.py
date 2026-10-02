from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from PIL import ExifTags, Image

from app.core.config import settings
from app.core.security import resolve_import_folder
from app.models.schemas import PredictedCard
from app.services.bulk_intake_repository import bulk_intake_repository
from app.services.identity_engine import IdentityResult, identity_engine
from app.services.owner_learning import register_owner_authorized_images
from app.services.imaging.barcode import decode_barcodes
from app.services.imaging.card_detector import decode_image
from app.services.imaging.fingerprint import difference_hash
from app.services.imaging.quality import QualityResult, analyze_image_quality
from app.services.imaging.reconciliation import PhysicalItemReconciler

SUPPORTED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _media_type(path: Path) -> str:
    return {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.tif': 'image/tiff',
        '.tiff': 'image/tiff',
    }.get(path.suffix.lower(), 'application/octet-stream')


def _capture_time(path: Path) -> datetime | None:
    """Read original phone/camera capture time without relying on file order."""
    try:
        with Image.open(path) as image:
            exif = image.getexif()
            if not exif:
                return None
            values = {ExifTags.TAGS.get(key, key): value for key, value in exif.items()}
            raw = values.get('DateTimeOriginal') or values.get('DateTimeDigitized') or values.get('DateTime')
            if not raw:
                return None
            return datetime.strptime(str(raw), '%Y:%m:%d %H:%M:%S')
    except (OSError, ValueError, TypeError):
        return None


def _side_hint(path: Path, result: IdentityResult) -> str:
    side = str(result.card_side or 'unknown').lower()
    if side in {'front', 'back'}:
        return side
    stem = path.stem.lower()
    if any(token in stem for token in ('back', 'reverse', 'rear')):
        return 'back'
    if any(token in stem for token in ('front', 'obverse')):
        return 'front'
    return 'unknown'


@dataclass
class Observation:
    source_path: Path
    managed_path: Path
    sha256: str
    fingerprint: str
    quality: QualityResult
    result: IdentityResult
    side: str
    group_id: str
    grouping_method: str
    grouping_confidence: float
    captured_at: datetime | None

    @property
    def score(self) -> float:
        return (self.quality.quality_score / 100.0) * 0.4 + self.result.identity_confidence * 0.6


class UnorderedPhotoIntakeService:
    """Import a folder of single-card photos without relying on file order.

    Images are analyzed independently, then grouped using cert/serial evidence,
    conservative visual fingerprinting, and corroborated front/back identity.
    Ambiguous same-card copies stay separate rather than being silently merged.
    """

    async def import_folder(self, request: dict[str, Any]) -> dict[str, Any]:
        folder = resolve_import_folder(request['folder_path'])
        if not folder.exists() or not folder.is_dir():
            raise ValueError('The selected photo folder does not exist or is not a directory.')

        files = [
            path for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
        ]
        if not files:
            raise ValueError('No supported card photos were found in the selected folder.')
        if len(files) > int(request.get('max_images', 10000)):
            raise ValueError('The folder exceeds the configured photo-import limit.')

        blob_dir = settings.images_dir / 'card-blobs'
        if request.get('copy_into_maneflow', True):
            blob_dir.mkdir(parents=True, exist_ok=True)

        def managed_copy(source: Path, sha256: str) -> Path:
            if not request.get('copy_into_maneflow', True):
                return source
            bucket = blob_dir / sha256[:2]
            bucket.mkdir(parents=True, exist_ok=True)
            target = bucket / f'{sha256}{source.suffix.lower()}'
            if not target.exists():
                temporary = target.with_suffix(target.suffix + '.tmp')
                shutil.copy2(source, temporary)
                temporary.replace(target)
            return target

        reconciler = PhysicalItemReconciler()
        observations: list[Observation] = []
        warnings: list[str] = []

        # Deliberately sort by content hash rather than filename or capture order.
        # This makes the result invariant to upload ordering.
        prepared: list[tuple[str, Path]] = []
        for path in files:
            prepared.append((_sha256(path), path))
        prepared.sort(key=lambda item: item[0])

        for sha256, source in prepared:
            managed = managed_copy(source, sha256)
            try:
                image_bytes = managed.read_bytes()
                image = decode_image(image_bytes)
                fingerprint = difference_hash(image)
                quality = analyze_image_quality(image)
                barcodes = decode_barcodes(image)
                result = await identity_engine.identify(
                    image_bytes,
                    media_type=_media_type(managed),
                    barcode_values=barcodes,
                )
                side = _side_hint(source, result)
                captured_at = _capture_time(source)
                decision = reconciler.register(
                    source_image_id=uuid4(),
                    fingerprint=fingerprint,
                    card=result.card,
                    identity_confidence=result.identity_confidence,
                    card_side=side,
                    content_hash=sha256,
                    image_path=managed,
                    captured_at=captured_at,
                )
                observations.append(
                    Observation(
                        source_path=source,
                        managed_path=managed,
                        sha256=sha256,
                        fingerprint=fingerprint,
                        quality=quality,
                        result=result,
                        side=side,
                        group_id=decision.group_id,
                        grouping_method=decision.method,
                        grouping_confidence=decision.confidence,
                        captured_at=captured_at,
                    )
                )
            except Exception as exc:
                warnings.append(f'{source.name}: {type(exc).__name__}: {exc}')

        if not observations:
            raise ValueError('No photos could be analyzed safely.')

        grouped: dict[str, list[Observation]] = {}
        for observation in observations:
            grouped.setdefault(observation.group_id, []).append(observation)

        items: list[dict[str, Any]] = []
        for sequence_no, (group_id, members) in enumerate(sorted(grouped.items()), start=1):
            fronts = sorted((item for item in members if item.side == 'front'), key=lambda item: item.score, reverse=True)
            backs = sorted((item for item in members if item.side == 'back'), key=lambda item: item.score, reverse=True)
            unknowns = sorted((item for item in members if item.side == 'unknown'), key=lambda item: item.score, reverse=True)

            front = fronts[0] if fronts else (unknowns[0] if unknowns else (backs[0] if backs else None))
            back = backs[0] if backs and backs[0] is not front else None
            if front is None:
                continue

            final_result = front.result
            if back is not None:
                try:
                    final_result = await identity_engine.identify_pair(
                        front.managed_path.read_bytes(),
                        back.managed_path.read_bytes(),
                        front_media_type=_media_type(front.managed_path),
                        back_media_type=_media_type(back.managed_path),
                        front_barcode_values=front.result.barcode_values,
                        back_barcode_values=back.result.barcode_values,
                    )
                except Exception as exc:
                    warnings.append(f'{group_id}: front/back merge failed safely: {type(exc).__name__}: {exc}')

            additional = [item for item in members if item is not front and item is not back]
            group_methods = sorted({item.grouping_method for item in members})
            group_confidence = min((item.grouping_confidence for item in members), default=1.0)
            if len(members) == 1:
                group_confidence = 1.0
            if group_confidence < 0.85:
                warnings.append(
                    f'{group_id}: grouping confidence {group_confidence:.2f}; kept conservative and reviewable.'
                )

            items.append({
                'id': str(uuid4()),
                'sequence_no': sequence_no,
                'front_image_path': str(front.managed_path),
                'back_image_path': str(back.managed_path) if back else None,
                'front_sha256': front.sha256,
                'back_sha256': back.sha256 if back else None,
                'predicted': final_result.card.model_dump(mode='json'),
                'identity_confidence': final_result.identity_confidence,
                'variant_confidence': final_result.variant_confidence,
                'evidence': {
                    'source': 'unordered_single_card_folder',
                    'physical_group_id': group_id,
                    'grouping_order_independent': True,
                    'grouping_methods': group_methods,
                    'grouping_confidence': round(group_confidence, 4),
                    'primary_front_filename': front.source_path.name,
                    'primary_back_filename': back.source_path.name if back else None,
                    'primary_front_captured_at': front.captured_at.isoformat() if front.captured_at else None,
                    'primary_back_captured_at': back.captured_at.isoformat() if back and back.captured_at else None,
                    'additional_views': [
                        {
                            'filename': item.source_path.name,
                            'managed_path': str(item.managed_path),
                            'sha256': item.sha256,
                            'side': item.side,
                            'fingerprint': item.fingerprint,
                            'quality': item.quality.to_dict(),
                            'identity_confidence': item.result.identity_confidence,
                            'variant_confidence': item.result.variant_confidence,
                            'provider': item.result.provider,
                            'captured_at': item.captured_at.isoformat() if item.captured_at else None,
                        }
                        for item in additional
                    ],
                    'all_source_files': [item.source_path.name for item in members],
                    'front_quality': front.quality.to_dict(),
                    'back_quality': back.quality.to_dict() if back else None,
                    'provider': final_result.provider,
                    'card_side': final_result.card_side,
                    'visible_text': final_result.visible_text,
                    'barcode_values': final_result.barcode_values,
                    'warnings': final_result.warnings,
                },
            })

        if not items:
            raise ValueError('No physical card groups could be created.')

        learning_registration = {'added': 0, 'total': 0, 'manifest': None}
        if request.get('owner_authorized_learning', False):
            learning_registration = register_owner_authorized_images([
                {
                    'sha256': observation.sha256,
                    'path': str(observation.managed_path),
                    'original_filename': observation.source_path.name,
                    'card_side': observation.side,
                    'physical_group_id': observation.group_id,
                    'captured_at': observation.captured_at.isoformat() if observation.captured_at else None,
                }
                for observation in observations
            ])

        batch = bulk_intake_repository.create_batch(
            {
                'id': str(uuid4()),
                'contributor_id': str(request['contributor_id']) if request.get('contributor_id') else None,
                'batch_name': request.get('batch_name') or folder.name,
                'scanner_model': request.get('capture_device') or 'Phone / camera folder',
                'source_folder': str(folder),
                'pairing_strategy': 'unordered_evidence_clustering',
                'status': 'review',
                'file_count': len(files),
                'warnings': warnings,
                'metadata': {
                    'copy_into_maneflow': bool(request.get('copy_into_maneflow', True)),
                    'storage_layout': 'content_addressed_sha256',
                    'supported_extensions': sorted(SUPPORTED_EXTENSIONS),
                    'order_used_as_identity_evidence': False,
                    'images_analyzed': len(observations),
                    'physical_groups': len(items),
                    'unprocessed_images': len(files) - len(observations),
                    'owner_authorized_learning': bool(request.get('owner_authorized_learning', False)),
                    'learning_images_added': int(learning_registration.get('added') or 0),
                    'learning_manifest_total': int(learning_registration.get('total') or 0),
                },
            },
            items,
        )
        batch['grouping_summary'] = {
            'images': len(files),
            'analyzed': len(observations),
            'physical_cards': len(items),
            'multi_view_groups': sum(1 for members in grouped.values() if len(members) > 1),
            'order_independent': True,
            'owner_learning_images_added': int(learning_registration.get('added') or 0),
        }
        return batch


unordered_photo_intake_service = UnorderedPhotoIntakeService()
