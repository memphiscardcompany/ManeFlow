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

from maneflow_vision.gpu.runtime import (
    detect_cuda_capability,
    environment_overrides,
    resolve_compute_device,
)


def _command(command: list[str], timeout: int = 8) -> dict[str, Any]:
    executable = shutil.which(command[0])
    if not executable:
        return {"available": False, "command": command, "stdout": "", "stderr": "not found", "returncode": None}
    try:
        result = subprocess.run(
            [executable, *command[1:]],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return {
            "available": True,
            "command": command,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
            "returncode": result.returncode,
        }
    except Exception as error:
        return {"available": True, "command": command, "stdout": "", "stderr": str(error), "returncode": None}


def _package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _memory_total_bytes() -> int | None:
    try:
        pages = os.sysconf("SC_PHYS_PAGES")
        size = os.sysconf("SC_PAGE_SIZE")
        return int(pages * size)
    except (AttributeError, ValueError, OSError):
        return None


def collect_environment() -> dict[str, Any]:
    cwd = Path.cwd()
    disk = shutil.disk_usage(cwd)
    capability = detect_cuda_capability()
    try:
        decision = resolve_compute_device("evaluation").to_dict()
    except Exception as error:
        decision = {"error": str(error)}

    nvidia_summary = _command([
        "nvidia-smi",
        "--query-gpu=name,uuid,driver_version,memory.total,memory.free,temperature.gpu,utilization.gpu,power.draw,pstate",
        "--format=csv,noheader,nounits",
    ])
    nvidia_processes = _command([
        "nvidia-smi",
        "--query-compute-apps=gpu_uuid,pid,process_name,used_memory",
        "--format=csv,noheader,nounits",
    ])
    nvidia_full = _command(["nvidia-smi"])
    nvcc = _command(["nvcc", "--version"])
    node = _command(["node", "--version"])
    docker = _command(["docker", "--version"])

    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "working_directory": str(cwd),
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python": sys.version.split()[0],
            "python_executable": sys.executable,
            "wsl": bool(os.getenv("WSL_DISTRO_NAME") or "microsoft" in platform.release().lower()),
        },
        "resources": {
            "logical_cpu_count": os.cpu_count(),
            "ram_total_bytes": _memory_total_bytes(),
            "disk_total_bytes": disk.total,
            "disk_free_bytes": disk.free,
        },
        "frameworks": {
            "torch": _package_version("torch"),
            "tensorflow": _package_version("tensorflow"),
            "onnxruntime": _package_version("onnxruntime"),
            "onnxruntime_gpu": _package_version("onnxruntime-gpu"),
            "ultralytics": _package_version("ultralytics"),
            "opencv": _package_version("opencv-python-headless") or _package_version("opencv-python"),
            "paddleocr": _package_version("paddleocr"),
            "paddlepaddle_gpu": _package_version("paddlepaddle-gpu"),
        },
        "cuda_capability": capability,
        "selected_compute": decision,
        "commands": {
            "node": node,
            "docker": docker,
            "nvcc": nvcc,
            "nvidia_smi_summary": nvidia_summary,
            "nvidia_smi_processes": nvidia_processes,
            "nvidia_smi_full": nvidia_full,
        },
        "compute_environment": environment_overrides(),
        "limitations": [
            "This report describes only the machine on which the doctor command was executed.",
            "No GPU driver, CUDA toolkit, clock, voltage, fan, BIOS, or power settings are modified.",
            "CUDA availability is not proof that a ManeFlow workload executed on CUDA; benchmark artifacts must record the actual provider.",
        ],
    }


def _markdown(report: dict[str, Any]) -> str:
    platform_info = report["platform"]
    resources = report["resources"]
    frameworks = report["frameworks"]
    cuda = report["cuda_capability"]
    selected = report["selected_compute"]
    nvidia = report["commands"]["nvidia_smi_summary"]
    gib = 1024 ** 3
    lines = [
        "# ManeFlow GPU Environment Report",
        "",
        f"Generated: `{report['generated_at']}`",
        "",
        "## Host",
        "",
        f"- OS: `{platform_info['system']} {platform_info['release']}`",
        f"- Architecture: `{platform_info['machine']}`",
        f"- CPU: `{platform_info['processor'] or 'not reported by platform API'}`",
        f"- Logical CPUs: `{resources['logical_cpu_count']}`",
        f"- RAM: `{round((resources['ram_total_bytes'] or 0) / gib, 2)} GiB`" if resources["ram_total_bytes"] else "- RAM: `not detected`",
        f"- Free disk: `{round(resources['disk_free_bytes'] / gib, 2)} GiB`",
        f"- Python: `{platform_info['python']}`",
        f"- Node: `{report['commands']['node']['stdout'] or 'not detected'}`",
        f"- WSL: `{platform_info['wsl']}`",
        "",
        "## GPU and CUDA",
        "",
        f"- NVIDIA telemetry available: `{nvidia['available'] and nvidia['returncode'] == 0}`",
        f"- GPU summary: `{nvidia['stdout'] or nvidia['stderr'] or 'not detected'}`",
        f"- PyTorch CUDA available: `{cuda['torch_cuda_available']}`",
        f"- PyTorch GPU: `{cuda['torch_gpu_name'] or 'not detected'}`",
        f"- ONNX Runtime providers: `{', '.join(cuda['onnx_providers']) or 'none detected'}`",
        f"- Selected compute: `{json.dumps(selected, sort_keys=True)}`",
        "",
        "## Framework versions",
        "",
    ]
    lines.extend(f"- {name}: `{version or 'not installed'}`" for name, version in frameworks.items())
    lines.extend([
        "",
        "## Safety and interpretation",
        "",
        "- GPU use is enabled only when a compatible execution provider is available and the workload is expected to benefit.",
        "- Explicit CUDA failures are reported. CPU fallback is recorded rather than hidden.",
        "- This command does not install or update drivers and does not change clocks, voltage, fan curves, BIOS, or power limits.",
        "- Model training remains prohibited until dataset rights, labels, split integrity, and baseline evidence are verified.",
        "",
        "## Commands used",
        "",
        "```text",
        "nvidia-smi",
        "nvidia-smi --query-gpu=name,uuid,driver_version,memory.total,memory.free,temperature.gpu,utilization.gpu,power.draw,pstate --format=csv,noheader,nounits",
        "nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader,nounits",
        "nvcc --version",
        "node --version",
        "docker --version",
        "```",
        "",
    ])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect ManeFlow GPU readiness without modifying the host.")
    parser.add_argument("--json-out", default="artifacts/gpu-environment.json")
    parser.add_argument("--markdown-out", default="docs/GPU_ENVIRONMENT_REPORT.md")
    parser.add_argument("--stdout", action="store_true")
    args = parser.parse_args()

    report = collect_environment()
    json_path = Path(args.json_out)
    markdown_path = Path(args.markdown_out)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    markdown_path.write_text(_markdown(report), encoding="utf-8")
    if args.stdout:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f"Wrote {json_path} and {markdown_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
