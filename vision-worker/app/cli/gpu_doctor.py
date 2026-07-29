from __future__ import annotations

import argparse
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from typing import Any

from app.core.compute import probe_compute, select_compute_device


def _command_version(command: list[str]) -> str | None:
    executable = shutil.which(command[0])
    if not executable:
        return None
    try:
        completed = subprocess.run(
            [executable, *command[1:]], capture_output=True, text=True, timeout=8, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return None
    output = (completed.stdout or completed.stderr).strip()
    return output.splitlines()[0] if output else None


def _package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _total_ram_bytes() -> int | None:
    if os.name == "posix" and hasattr(os, "sysconf"):
        try:
            page_size = int(os.sysconf("SC_PAGE_SIZE"))
            page_count = int(os.sysconf("SC_PHYS_PAGES"))
            return page_size * page_count
        except (OSError, ValueError):
            return None
    return None


def _active_gpu_processes() -> list[dict[str, Any]]:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return []
    command = [
        executable,
        "--query-compute-apps=gpu_uuid,pid,process_name,used_memory",
        "--format=csv,noheader,nounits",
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=8, check=False)
    except (OSError, subprocess.SubprocessError):
        return []
    if completed.returncode != 0:
        return []
    records: list[dict[str, Any]] = []
    for line in completed.stdout.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 4:
            continue
        records.append(
            {
                "gpu_uuid": parts[0],
                "pid": int(parts[1]) if parts[1].isdigit() else None,
                "process_name": Path(parts[2]).name,
                "used_memory_mb": int(float(parts[3])) if parts[3] not in {"", "N/A"} else None,
            }
        )
    return records


def collect_environment() -> dict[str, Any]:
    probe = probe_compute()
    selection = select_compute_device(
        workload="GPU readiness diagnostic",
        required_runtime="any",
        beneficial=True,
        probe=probe,
    )
    disk = shutil.disk_usage(Path.cwd())
    return {
        "schema_version": 1,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "operating_system": {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "wsl": bool(os.getenv("WSL_DISTRO_NAME")),
        },
        "cpu": {
            "processor": platform.processor() or None,
            "logical_cores": os.cpu_count(),
        },
        "memory": {"total_bytes": _total_ram_bytes()},
        "disk": {
            "path": str(Path.cwd().anchor or Path.cwd()),
            "total_bytes": disk.total,
            "free_bytes": disk.free,
        },
        "runtimes": {
            "python": sys.version.splitlines()[0],
            "node": _command_version(["node", "--version"]),
            "docker": _command_version(["docker", "--version"]),
            "nvidia_smi": _command_version(["nvidia-smi", "--version"]),
        },
        "frameworks": {
            "torch": _package_version("torch"),
            "tensorflow": _package_version("tensorflow"),
            "onnxruntime": _package_version("onnxruntime-gpu") or _package_version("onnxruntime"),
            "ultralytics": _package_version("ultralytics"),
            "opencv": _package_version("opencv-python-headless") or _package_version("opencv-python"),
        },
        "compute_probe": probe.to_dict(),
        "selection": selection.to_dict(),
        "active_gpu_processes": _active_gpu_processes(),
        "limitations": [
            "This report does not install or modify GPU drivers, CUDA, cuDNN, clocks, power limits, or fan curves.",
            "CUDA is considered usable only when a supported execution runtime reports it, not merely because nvidia-smi exists.",
        ],
    }


def _markdown(report: dict[str, Any]) -> str:
    selection = report["selection"]
    probe = report["compute_probe"]
    gpu_lines = []
    for gpu in probe.get("nvidia_gpus", []):
        gpu_lines.append(
            f"- GPU {gpu['index']}: {gpu['name']}; {gpu.get('memory_total_mb')} MB VRAM; "
            f"{gpu.get('memory_free_mb')} MB free; {gpu.get('temperature_c')} °C; "
            f"{gpu.get('utilization_percent')}% utilization; {gpu.get('power_draw_watts')} W"
        )
    if not gpu_lines:
        gpu_lines.append("- No NVIDIA GPU telemetry was returned.")
    return "\n".join(
        [
            "# ManeFlow GPU Environment Report",
            "",
            f"Captured: `{report['captured_at']}`",
            "",
            "## Environment",
            "",
            f"- OS: `{report['operating_system']['system']} {report['operating_system']['release']}`",
            f"- Machine: `{report['operating_system']['machine']}`",
            f"- Python: `{report['runtimes']['python']}`",
            f"- Node: `{report['runtimes']['node']}`",
            f"- Docker: `{report['runtimes']['docker']}`",
            f"- Logical CPU cores: `{report['cpu']['logical_cores']}`",
            f"- Free disk bytes: `{report['disk']['free_bytes']}`",
            "",
            "## GPU telemetry",
            "",
            *gpu_lines,
            "",
            "## Framework compatibility",
            "",
            f"- PyTorch: `{report['frameworks']['torch']}`",
            f"- PyTorch CUDA available: `{probe['torch_cuda_available']}`",
            f"- PyTorch CUDA runtime: `{probe['torch_cuda_version']}`",
            f"- ONNX Runtime: `{report['frameworks']['onnxruntime']}`",
            f"- ONNX providers: `{', '.join(probe['onnx_providers'])}`",
            f"- Ultralytics: `{report['frameworks']['ultralytics']}`",
            "",
            "## Device decision",
            "",
            f"- Requested: `{selection['requested_device']}`",
            f"- Selected: `{selection['selected_device']}`",
            f"- Reason: {selection['reason']}",
            f"- Fallback used: `{selection['fallback_used']}`",
            f"- Mixed precision: `{selection['mixed_precision']}`",
            "",
            "## Safety",
            "",
            "No drivers, CUDA toolkits, clocks, voltage, power limits, fan curves, or running processes were changed.",
            "",
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect ManeFlow GPU readiness without changing the workstation.")
    parser.add_argument("--json-out", default="../artifacts/gpu-environment.json")
    parser.add_argument("--markdown-out", default="../docs/GPU_ENVIRONMENT_REPORT.md")
    parser.add_argument("--stdout", action="store_true")
    args = parser.parse_args()
    report = collect_environment()
    json_path = Path(args.json_out).expanduser().resolve()
    markdown_path = Path(args.markdown_out).expanduser().resolve()
    json_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    markdown_path.write_text(_markdown(report), encoding="utf-8")
    if args.stdout:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f"Wrote {json_path}")
        print(f"Wrote {markdown_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
