#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

SUPPORTED = {'.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'}


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description='Prepare owner-authorized ManeFlow images for safe learning.')
    parser.add_argument('--input', default='sample-images/user-uploaded-card-tests')
    parser.add_argument('--output', default='data/training/owner-authorized')
    args = parser.parse_args()
    source = Path(args.input).resolve()
    output = Path(args.output).resolve()
    images = output / 'images'
    images.mkdir(parents=True, exist_ok=True)
    if not source.is_dir():
        raise SystemExit(f'Input folder not found: {source}')

    records = []
    seen = set()
    for path in sorted(source.iterdir()):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED:
            continue
        sha = digest(path)
        if sha in seen:
            continue
        seen.add(sha)
        target = images / f'{sha}{path.suffix.lower()}'
        if not target.exists():
            shutil.copy2(path, target)
        records.append({
            'schema_version': '1.0',
            'sha256': sha,
            'path': str(target.relative_to(Path.cwd().resolve())) if target.is_relative_to(Path.cwd().resolve()) else str(target),
            'original_filename': path.name,
            'rights_basis': 'owner_authorized_chatgpt_upload',
            'commercial_training_allowed': True,
            'identity_label_status': 'automatic_resolution_required',
            'allowed_uses': ['detection', 'ocr', 'retrieval', 'benchmark', 'derived_model_improvement'],
            'excluded_uses': ['private_pricing', 'customer_data', 'inventory_cost'],
        })

    manifest = output / 'manifest.jsonl'
    manifest.write_text(''.join(json.dumps(record) + '\n' for record in records), encoding='utf-8')
    summary = {
        'images': len(records),
        'manifest': str(manifest),
        'rights_basis': 'owner_authorized_chatgpt_upload',
        'exact_identity_labels': 0,
        'status': 'ready_for_unsupervised_and_automatic-labeling_stages' if records else 'paused_no_images',
    }
    (output / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
