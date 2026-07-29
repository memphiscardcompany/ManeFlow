#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def load_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    rows = []
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description='Run ManeFlow rights-gated adaptive learning.')
    parser.add_argument('--owner-manifest', default='data/training/owner-authorized/manifest.jsonl')
    parser.add_argument('--state', default='data/training/training-state.json')
    parser.add_argument('--min-images', type=int, default=20)
    parser.add_argument('--promotion-min-labeled', type=int, default=500)
    args = parser.parse_args()

    manifest_path = Path(args.owner_manifest)
    rows = [row for row in load_jsonl(manifest_path) if row.get('commercial_training_allowed')]
    labeled = [row for row in rows if row.get('identity_label_status') == 'verified']
    provisional = [row for row in rows if row.get('identity_label_status') == 'provisional_auto']
    state_path = Path(args.state)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    state = {
        'schema_version': '1.0',
        'updated_at': now,
        'eligible_owner_images': len(rows),
        'verified_identity_labels': len(labeled),
        'provisional_automatic_labels': len(provisional),
        'min_images_to_prepare': args.min_images,
        'min_labeled_to_promote': args.promotion_min_labeled,
        'model_weights_changed': False,
        'reference_memory_changed': False,
        'grouping_calibration_changed': False,
        'adaptive_systems_updated': [],
        'status': 'paused_no_eligible_images',
        'next_action': 'Add owner-authorized or commercially licensed card images.',
    }

    if len(rows) >= args.min_images:
        corpus_hash = hashlib.sha256('\n'.join(sorted(row['sha256'] for row in rows)).encode()).hexdigest()
        calibration_path = state_path.parent / 'grouping-calibration.json'
        calibration = {}
        if calibration_path.is_file():
            try:
                calibration = json.loads(calibration_path.read_text(encoding='utf-8'))
            except json.JSONDecodeError:
                calibration = {}
        grouping_updated = calibration.get('status') == 'trained_owner_corpus_calibration'
        systems = ['any_order_multi_view_grouping'] if grouping_updated else []
        state.update({
            'status': 'adaptive_calibration_active_waiting_for_verified_identity_labels' if grouping_updated else 'corpus_prepared_waiting_for_automatic_labels',
            'corpus_hash': corpus_hash,
            'grouping_calibration_changed': grouping_updated,
            'grouping_calibration': calibration if grouping_updated else None,
            'adaptive_systems_updated': systems,
            'next_action': 'Continue automatic OCR/checklist/cert resolution. Neural model promotion remains blocked until verified labels and a locked benchmark exist.',
        })

    trainer_command = os.environ.get('MANEFLOW_TRAINER_COMMAND', '').strip()
    if trainer_command and len(labeled) >= args.promotion_min_labeled:
        completed = subprocess.run(shlex.split(trainer_command), check=False)
        state['trainer_exit_code'] = completed.returncode
        state['status'] = 'trainer_completed_candidate' if completed.returncode == 0 else 'trainer_failed_candidate_not_promoted'
        state['model_weights_changed'] = completed.returncode == 0
        state['next_action'] = 'Run locked benchmark and promotion gate before production activation.'

    state_path.write_text(json.dumps(state, indent=2), encoding='utf-8')
    print(json.dumps(state, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
