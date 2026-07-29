from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import shlex
import subprocess
import sys
import time
from typing import Any

from maneflow_vision.gpu.doctor import collect_environment

ALLOWED_MODULE_PREFIXES = ("maneflow_vision.", "app.")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_config(path: Path) -> dict[str, Any]:
    if path.suffix.lower() == ".json":
        return json.loads(path.read_text(encoding="utf-8"))
    try:
        import yaml  # type: ignore[import-not-found]
    except ImportError as error:
        raise RuntimeError("YAML experiment configs require PyYAML from requirements-training-tools.txt") from error
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a reproducible allowlisted ManeFlow experiment module.")
    parser.add_argument("--config", required=True)
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    parser.add_argument("--output-root", default="artifacts/experiments")
    args = parser.parse_args()

    config_path = Path(args.config).resolve()
    config = load_config(config_path)
    module = str(config.get("module") or "").strip()
    if not module.startswith(ALLOWED_MODULE_PREFIXES):
        raise ValueError(f"Experiment module must start with one of {ALLOWED_MODULE_PREFIXES}")
    module_args = [str(value) for value in config.get("args", [])]
    experiment_id = str(config.get("experiment_id") or f"experiment-{int(time.time())}")
    output_dir = Path(args.output_root) / experiment_id
    output_dir.mkdir(parents=True, exist_ok=False)

    started = datetime.now(timezone.utc)
    before = collect_environment()
    command = [sys.executable, "-m", module, *module_args]
    import os
    environment = dict(os.environ)
    environment["MANEFLOW_COMPUTE_DEVICE"] = args.device
    result = subprocess.run(command, capture_output=True, text=True, check=False, env=environment)
    ended = datetime.now(timezone.utc)
    after = collect_environment()

    record = {
        "schema_version": 1,
        "experiment_id": experiment_id,
        "configuration_path": str(config_path),
        "configuration_sha256": sha256_file(config_path),
        "git_commit": config.get("git_commit"),
        "branch": config.get("branch"),
        "dataset_manifest_hash": config.get("dataset_manifest_hash"),
        "training_split_hash": config.get("training_split_hash"),
        "validation_split_hash": config.get("validation_split_hash"),
        "test_split_hash": config.get("test_split_hash"),
        "model_name": config.get("model_name"),
        "base_model_license": config.get("base_model_license"),
        "random_seed": config.get("random_seed"),
        "requested_device": args.device,
        "command": command,
        "command_display": shlex.join(command),
        "start_time": started.isoformat(),
        "end_time": ended.isoformat(),
        "duration_seconds": (ended - started).total_seconds(),
        "returncode": result.returncode,
        "stdout_path": "stdout.log",
        "stderr_path": "stderr.log",
        "environment_before": before,
        "environment_after": after,
        "python": platform.python_version(),
        "framework_versions": {
            name: (importlib.metadata.version(name) if _installed(name) else None)
            for name in ("torch", "onnxruntime", "onnxruntime-gpu", "ultralytics", "opencv-python-headless")
        },
        "promotion_decision": "REVIEW_REQUIRED" if result.returncode == 0 else "REJECTED_EXECUTION_FAILED",
    }
    (output_dir / "stdout.log").write_text(result.stdout, encoding="utf-8")
    (output_dir / "stderr.log").write_text(result.stderr, encoding="utf-8")
    (output_dir / "experiment.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(record, indent=2, sort_keys=True))
    return result.returncode


def _installed(name: str) -> bool:
    try:
        importlib.metadata.version(name)
        return True
    except importlib.metadata.PackageNotFoundError:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
