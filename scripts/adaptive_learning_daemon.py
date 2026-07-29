#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def manifest_hash(path: Path) -> str:
    if not path.is_file():
        return ''
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_command(args: list[str], log) -> int:
    completed = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    log.write(completed.stdout or '')
    log.flush()
    return completed.returncode


def cycle(data_dir: Path, log_path: Path, force: bool = False) -> dict:
    training = data_dir / 'training'
    owner = training / 'owner-authorized'
    manifest = owner / 'manifest.jsonl'
    state_file = training / 'daemon-state.json'
    training.mkdir(parents=True, exist_ok=True)
    previous = {}
    if state_file.is_file():
        try:
            previous = json.loads(state_file.read_text(encoding='utf-8'))
        except json.JSONDecodeError:
            previous = {}
    current_hash = manifest_hash(manifest)
    now = datetime.now(timezone.utc).isoformat()
    if not current_hash:
        state = {
            'updated_at': now,
            'status': 'paused_no_owner_authorized_images',
            'manifest_hash': '',
            'last_successful_hash': previous.get('last_successful_hash', ''),
            'empty_cycles_skipped': int(previous.get('empty_cycles_skipped', 0)) + 1,
        }
        state_file.write_text(json.dumps(state, indent=2), encoding='utf-8')
        return state
    if not force and current_hash == previous.get('last_successful_hash'):
        state = {**previous, 'updated_at': now, 'status': 'idle_no_new_images', 'unchanged_cycles_skipped': int(previous.get('unchanged_cycles_skipped', 0)) + 1}
        state_file.write_text(json.dumps(state, indent=2), encoding='utf-8')
        return state

    calibration = training / 'grouping-calibration.json'
    label_report = training / 'automatic-label-report.json'
    learning_state = training / 'training-state.json'
    log_path.parent.mkdir(parents=True, exist_ok=True)
    exit_codes = {}
    with log_path.open('a', encoding='utf-8') as log:
        log.write(f'\n[{now}] ManeFlow adaptive learning cycle for corpus {current_hash}\n')
        exit_codes['grouping_calibration'] = run_command([
            sys.executable, 'scripts/train_grouping_calibration.py',
            '--input', str(owner / 'images'), '--output', str(calibration),
        ], log)
        exit_codes['automatic_labeling'] = run_command([
            sys.executable, 'scripts/auto_resolve_owner_labels.py',
            '--manifest', str(manifest), '--report', str(label_report),
        ], log)
        exit_codes['adaptive_training'] = run_command([
            sys.executable, 'scripts/run_adaptive_training.py',
            '--owner-manifest', str(manifest), '--state', str(learning_state),
        ], log)

    success = all(code == 0 for code in exit_codes.values())
    state = {
        'updated_at': datetime.now(timezone.utc).isoformat(),
        'status': 'cycle_completed' if success else 'cycle_failed_no_promotion',
        'manifest_hash': manifest_hash(manifest),
        'last_successful_hash': manifest_hash(manifest) if success else previous.get('last_successful_hash', ''),
        'exit_codes': exit_codes,
        'calibration_path': str(calibration),
        'automatic_label_report': str(label_report),
        'training_state': str(learning_state),
        'promotion_requires_locked_benchmark': True,
    }
    state_file.write_text(json.dumps(state, indent=2), encoding='utf-8')
    return state


def main() -> int:
    parser = argparse.ArgumentParser(description='Run ManeFlow learning only when new owner-authorized images exist.')
    parser.add_argument('--interval-seconds', type=int, default=1800)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    data_dir = Path(os.getenv('MANEFLOW_DATA_DIR', ROOT / 'data')).expanduser().resolve()
    log_path = data_dir / 'training' / 'adaptive-learning.log'
    while True:
        state = cycle(data_dir, log_path, force=args.force)
        print(json.dumps(state, indent=2), flush=True)
        if args.once:
            return 0
        time.sleep(max(300, args.interval_seconds))
        args.force = False


if __name__ == '__main__':
    raise SystemExit(main())
