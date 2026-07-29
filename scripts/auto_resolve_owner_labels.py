#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT / 'vision-worker'))

from app.services.bulk_intake_repository import bulk_intake_repository
from app.services.identity_engine import identity_engine
from app.services.imaging.barcode import decode_barcodes
from app.services.imaging.card_detector import decode_image


def read_manifest(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows = []
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def media_type(path: Path) -> str:
    return {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
    }.get(path.suffix.lower(), 'application/octet-stream')


def populated(card: dict, *keys: str) -> int:
    return sum(card.get(key) not in (None, '') for key in keys)


def strict_verified(result) -> tuple[bool, str]:
    card = result.card.model_dump(mode='json')
    provider = str(result.provider or '')
    if 'psa_partner_verified' in provider and card.get('cert_number'):
        return True, 'psa_partner_cert_verified'
    core = populated(card, 'player_name', 'year', 'brand', 'set_name', 'card_number')
    exact_key = bool(card.get('card_number')) and bool(card.get('player_name')) and bool(card.get('year'))
    visible_support = len(result.visible_text or []) >= 2
    if (
        result.identity_confidence >= 0.985
        and result.variant_confidence >= 0.90
        and core >= 4
        and exact_key
        and visible_support
        and result.card_side in {'front', 'back'}
        and provider not in {'unconfigured', 'provider_error'}
    ):
        return True, 'high_confidence_visible_multifield_agreement'
    return False, 'insufficient_verified_evidence'


async def run(args) -> dict:
    manifest = Path(args.manifest).resolve()
    rows = read_manifest(manifest)
    output_rows = []
    counts = {'verified': 0, 'provisional': 0, 'unresolved': 0, 'missing': 0, 'imported_references': 0}
    now = datetime.now(timezone.utc).isoformat()
    source_pack_id = f'owner-auto-resolve:{now[:10]}'

    for row in rows:
        path = Path(str(row.get('path') or '')).expanduser()
        if not path.is_absolute():
            path = (ROOT / path).resolve()
        if not path.is_file():
            row.update({'identity_label_status': 'missing_image', 'automatic_resolution_at': now})
            counts['missing'] += 1
            output_rows.append(row)
            continue
        try:
            image_bytes = path.read_bytes()
            image = decode_image(image_bytes)
            barcodes = decode_barcodes(image)
            result = await identity_engine.identify(
                image_bytes,
                media_type=media_type(path),
                barcode_values=barcodes,
            )
            card = result.card.model_dump(mode='json')
            verified, verification_basis = strict_verified(result)
            core = populated(card, 'player_name', 'year', 'brand', 'set_name', 'card_number')
            provisional = (
                not verified
                and result.identity_confidence >= 0.75
                and core >= 3
                and result.provider not in {'unconfigured', 'provider_error'}
            )
            status = 'verified' if verified else 'provisional_auto' if provisional else 'automatic_resolution_required'
            counts['verified' if verified else 'provisional' if provisional else 'unresolved'] += 1
            row.update({
                'identity_label_status': status,
                'automatic_label': card if (verified or provisional) else None,
                'automatic_resolution_at': now,
                'automatic_resolution_provider': result.provider,
                'automatic_identity_confidence': result.identity_confidence,
                'automatic_variant_confidence': result.variant_confidence,
                'automatic_card_side': result.card_side,
                'automatic_visible_text': result.visible_text,
                'automatic_barcode_values': result.barcode_values,
                'automatic_warnings': result.warnings,
                'verification_basis': verification_basis,
            })
            if verified:
                imported = bulk_intake_repository.import_training_example(
                    {
                        'consent_scope': 'reference_catalog',
                        'front_image_path': str(path) if result.card_side != 'back' else None,
                        'back_image_path': str(path) if result.card_side == 'back' else None,
                        'front_sha256': row.get('sha256') if result.card_side != 'back' else None,
                        'back_sha256': row.get('sha256') if result.card_side == 'back' else None,
                        'label': card,
                        'evidence': {
                            'source': row.get('rights_basis'),
                            'provider': result.provider,
                            'visible_text': result.visible_text,
                            'barcode_values': result.barcode_values,
                            'card_side': result.card_side,
                            'warnings': result.warnings,
                        },
                        'reference_eligible': True,
                    },
                    source_pack_id=source_pack_id,
                )
                if imported:
                    latest = bulk_intake_repository.list_training_examples(limit=1)[0]
                    bulk_intake_repository.curate_training_example(
                        __import__('uuid').UUID(latest['id']),
                        'approved',
                        f'Automatically approved: {verification_basis}',
                    )
                    counts['imported_references'] += 1
        except Exception as exc:
            row.update({
                'identity_label_status': 'automatic_resolution_required',
                'automatic_resolution_at': now,
                'automatic_warnings': [f'{type(exc).__name__}: {exc}'],
            })
            counts['unresolved'] += 1
        output_rows.append(row)

    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(''.join(json.dumps(row, sort_keys=True) + '\n' for row in output_rows), encoding='utf-8')
    report = {
        'schema_version': '1.0',
        'updated_at': now,
        'manifest': str(manifest),
        'images': len(rows),
        **counts,
        'user_labels_required': False,
        'promotion_policy': 'PSA verified or strict multi-field visible evidence only',
        'model_weights_changed': False,
    }
    report_path = Path(args.report).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    return report


def main() -> int:
    default_data = Path(os.getenv('MANEFLOW_DATA_DIR', ROOT / 'data'))
    parser = argparse.ArgumentParser(description='Automatically resolve owner-authorized card images without user labels.')
    parser.add_argument('--manifest', default=str(default_data / 'training' / 'owner-authorized' / 'manifest.jsonl'))
    parser.add_argument('--report', default=str(default_data / 'training' / 'automatic-label-report.json'))
    args = parser.parse_args()
    asyncio.run(run(args))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
