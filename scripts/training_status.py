#!/usr/bin/env python3
import json
from pathlib import Path

path = Path('data/training/training-state.json')
if not path.is_file():
    print(json.dumps({'status': 'not_started', 'model_weights_changed': False}, indent=2))
else:
    print(path.read_text(encoding='utf-8'))
