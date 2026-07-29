from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import settings

_LOCK = threading.RLock()


def owner_manifest_path() -> Path:
    path = settings.data_dir / 'training' / 'owner-authorized' / 'manifest.jsonl'
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def register_owner_authorized_images(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Append owner-authorized image facts without inventing identity labels."""
    manifest = owner_manifest_path()
    with _LOCK:
        existing: dict[str, dict[str, Any]] = {}
        if manifest.is_file():
            for line in manifest.read_text(encoding='utf-8').splitlines():
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get('sha256'):
                    existing[str(row['sha256'])] = row

        added = 0
        now = datetime.now(timezone.utc).isoformat()
        for record in records:
            sha = str(record.get('sha256') or '').strip()
            image_path = str(record.get('path') or '').strip()
            if not sha or not image_path or sha in existing:
                continue
            existing[sha] = {
                'schema_version': '1.1',
                'sha256': sha,
                'path': image_path,
                'original_filename': str(record.get('original_filename') or Path(image_path).name),
                'rights_basis': 'owner_authorized_local_folder_upload',
                'commercial_training_allowed': True,
                'identity_label_status': 'automatic_resolution_required',
                'allowed_uses': ['detection', 'ocr', 'retrieval', 'benchmark', 'derived_model_improvement'],
                'excluded_uses': ['private_pricing', 'customer_data', 'inventory_cost', 'marketplace_training'],
                'card_side': record.get('card_side') or 'unknown',
                'physical_group_id': record.get('physical_group_id'),
                'captured_at': record.get('captured_at'),
                'registered_at': now,
            }
            added += 1

        manifest.write_text(
            ''.join(json.dumps(existing[key], sort_keys=True) + '\n' for key in sorted(existing)),
            encoding='utf-8',
        )
    return {'manifest': str(manifest), 'total': len(existing), 'added': added}
