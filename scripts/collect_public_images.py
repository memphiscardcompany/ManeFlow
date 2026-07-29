#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import sys
from pathlib import Path
from typing import Any

SOURCE_POLICIES = {
    'GotThatData/sports-cards': {
        'image_license': 'CC BY-NC-SA 4.0',
        'commercial_training': False,
        'allowed_splits': {'evaluation_noncommercial', 'quarantine_noncommercial'},
        'note': 'Dataset metadata may be MIT, but the image license is noncommercial/share-alike.',
    },
}


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Collect public card images with fail-closed rights controls.')
    parser.add_argument('--source', choices=['huggingface'], required=True)
    parser.add_argument('--hf-dataset')
    parser.add_argument('--max-images', type=int, default=2000)
    parser.add_argument('--product-type', default='singles')
    parser.add_argument('--split', default='quarantine_review')
    parser.add_argument('--output', default='data/public-image-corpus')
    parser.add_argument('--dataset-config', default=None)
    parser.add_argument('--dataset-split', default='train')
    return parser.parse_args()


def policy_for(dataset: str) -> dict[str, Any]:
    return SOURCE_POLICIES.get(dataset, {
        'image_license': 'unknown',
        'commercial_training': False,
        'allowed_splits': {'quarantine_review'},
        'note': 'Unknown image rights. Manual review is required before any training or reference use.',
    })


def safe_output_split(requested: str, policy: dict[str, Any]) -> str:
    allowed = set(policy['allowed_splits'])
    if requested in allowed:
        return requested
    if policy['commercial_training']:
        return requested
    replacement = 'quarantine_noncommercial' if 'quarantine_noncommercial' in allowed else 'quarantine_review'
    print(
        f"Refusing split '{requested}': image rights do not permit commercial reference/model training. "
        f"Writing to '{replacement}' instead.",
        file=sys.stderr,
    )
    return replacement


def image_bytes(value: Any) -> tuple[bytes, str] | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        return value, 'image/jpeg'
    if isinstance(value, dict):
        if isinstance(value.get('bytes'), bytes):
            return value['bytes'], value.get('mime_type') or 'image/jpeg'
        path = value.get('path')
        if path and Path(path).is_file():
            payload = Path(path).read_bytes()
            return payload, mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
    if hasattr(value, 'save'):
        import io
        buf = io.BytesIO()
        value.save(buf, format='PNG')
        return buf.getvalue(), 'image/png'
    return None


def main() -> int:
    args = parse_args()
    if args.source != 'huggingface' or not args.hf_dataset:
        raise SystemExit('--hf-dataset is required for Hugging Face collection.')

    policy = policy_for(args.hf_dataset)
    target_split = safe_output_split(args.split, policy)
    output = Path(args.output) / target_split / args.hf_dataset.replace('/', '__')
    image_dir = output / 'images'
    image_dir.mkdir(parents=True, exist_ok=True)

    try:
        from datasets import load_dataset
    except ImportError as exc:
        raise SystemExit(
            'The optional datasets package is required. Install with: '
            'python -m pip install datasets huggingface_hub Pillow'
        ) from exc

    dataset = load_dataset(args.hf_dataset, args.dataset_config, split=args.dataset_split, streaming=True)
    manifest_path = output / 'manifest.jsonl'
    seen: set[str] = set()
    written = 0
    with manifest_path.open('w', encoding='utf-8') as manifest:
        for row_index, row in enumerate(dataset):
            if written >= max(0, args.max_images):
                break
            candidates = []
            for key, value in row.items():
                if key.lower() in {'image', 'images', 'front', 'back', 'photo', 'photos'}:
                    candidates.extend(value if isinstance(value, list) else [value])
            for candidate in candidates:
                parsed = image_bytes(candidate)
                if not parsed:
                    continue
                payload, mime_type = parsed
                digest = sha256_bytes(payload)
                if digest in seen:
                    continue
                seen.add(digest)
                suffix = mimetypes.guess_extension(mime_type) or '.img'
                target = image_dir / f'{digest}{suffix}'
                target.write_bytes(payload)
                record = {
                    'schema_version': '1.0',
                    'source': 'huggingface',
                    'dataset': args.hf_dataset,
                    'dataset_split': args.dataset_split,
                    'row_index': row_index,
                    'sha256': digest,
                    'path': str(target),
                    'mime_type': mime_type,
                    'product_type': args.product_type,
                    'requested_split': args.split,
                    'effective_split': target_split,
                    'image_license': policy['image_license'],
                    'commercial_training_allowed': bool(policy['commercial_training']),
                    'rights_note': policy['note'],
                    'promotion_allowed': bool(policy['commercial_training']),
                }
                manifest.write(json.dumps(record, ensure_ascii=False) + '\n')
                written += 1
                if written >= args.max_images:
                    break

    summary = {
        'dataset': args.hf_dataset,
        'requested_max': args.max_images,
        'written': written,
        'effective_split': target_split,
        'commercial_training_allowed': bool(policy['commercial_training']),
        'image_license': policy['image_license'],
        'manifest': str(manifest_path),
    }
    (output / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
