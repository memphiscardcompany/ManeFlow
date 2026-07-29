from __future__ import annotations

import argparse
import os
from pathlib import Path
import runpy
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the canonical ManeFlow full vision benchmark.")
    parser.add_argument("--profile", choices=["baseline", "candidate"], required=True)
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    parser.add_argument("benchmark_args", nargs="*")
    args = parser.parse_args()
    os.environ["MANEFLOW_COMPUTE_DEVICE"] = args.device
    os.environ["MANEFLOW_BENCHMARK_PROFILE"] = args.profile
    script = Path(__file__).resolve().parents[2] / "tools" / "benchmark_full_vision_pipeline.py"
    if not script.is_file():
        raise FileNotFoundError(f"Canonical benchmark script not found: {script}")
    sys.argv = [str(script), *args.benchmark_args]
    try:
        runpy.run_path(str(script), run_name="__main__")
    except SystemExit as exit_error:
        return int(exit_error.code or 0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
