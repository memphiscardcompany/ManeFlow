from __future__ import annotations

from dataclasses import asdict, dataclass
import importlib.util
import json
import logging
import shutil
import subprocess
from typing import Any, Literal

from app.core.config import settings

LOGGER = logging.getLogger(__name__)

RequestedDevice = Literal["auto", "cuda", "cpu"]
RuntimeKind = Literal["any", "torch", "onnx"]


class ComputeDeviceError(RuntimeError):
    """Raised when the requested compute device cannot be used safely."""


@dataclass(frozen=True)
class NvidiaGpu:
    index: int
    name: str
    driver_version: str | None
    memory_total_mb: int | None
    memory_free_mb: int | None
    temperature_c: float | None
    utilization_percent: float | None
    power_draw_watts: float | None


@dataclass(frozen=True)
class ComputeProbe:
    torch_installed: bool
    torch_version: str | None
    torch_cuda_available: bool
    torch_cuda_version: str | None
    torch_device_count: int
    torch_device_name: str | None
    torch_compute_capability: str | None
    onnxruntime_installed: bool
    onnxruntime_version: str | None
    onnx_providers: tuple[str, ...]
    nvidia_smi_available: bool
    nvidia_gpus: tuple[NvidiaGpu, ...]
    errors: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ComputeSelection:
    requested_device: RequestedDevice
    selected_device: Literal["cuda", "cpu"]
    reason: str
    workload: str
    required_runtime: RuntimeKind
    gpu_device_id: int | None
    fallback_allowed: bool
    fallback_used: bool
    mixed_precision: bool
    gpu_profile: str
    torch_device: str
    ultralytics_device: str
    onnx_providers: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)



def _safe_float(value: str) -> float | None:
    text = value.strip()
    if not text or text.lower() in {"n/a", "nan", "[not supported]"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None



def _safe_int(value: str) -> int | None:
    parsed = _safe_float(value)
    return int(parsed) if parsed is not None else None



def _probe_nvidia_smi() -> tuple[bool, tuple[NvidiaGpu, ...], list[str]]:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return False, (), []
    command = [
        executable,
        "--query-gpu=index,name,driver_version,memory.total,memory.free,temperature.gpu,utilization.gpu,power.draw",
        "--format=csv,noheader,nounits",
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=8, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        return True, (), [f"nvidia-smi query failed: {exc}"]
    if completed.returncode != 0:
        message = completed.stderr.strip() or f"exit status {completed.returncode}"
        return True, (), [f"nvidia-smi query failed: {message}"]
    gpus: list[NvidiaGpu] = []
    errors: list[str] = []
    for line_number, line in enumerate(completed.stdout.splitlines(), start=1):
        if not line.strip():
            continue
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 8:
            errors.append(f"nvidia-smi returned {len(parts)} fields on line {line_number}; expected 8")
            continue
        index = _safe_int(parts[0])
        if index is None:
            errors.append(f"nvidia-smi returned an invalid GPU index on line {line_number}")
            continue
        gpus.append(
            NvidiaGpu(
                index=index,
                name=parts[1],
                driver_version=parts[2] or None,
                memory_total_mb=_safe_int(parts[3]),
                memory_free_mb=_safe_int(parts[4]),
                temperature_c=_safe_float(parts[5]),
                utilization_percent=_safe_float(parts[6]),
                power_draw_watts=_safe_float(parts[7]),
            )
        )
    return True, tuple(gpus), errors



def probe_compute() -> ComputeProbe:
    errors: list[str] = []
    torch_installed = importlib.util.find_spec("torch") is not None
    torch_version: str | None = None
    torch_cuda_available = False
    torch_cuda_version: str | None = None
    torch_device_count = 0
    torch_device_name: str | None = None
    torch_compute_capability: str | None = None
    if torch_installed:
        try:
            import torch  # type: ignore[import-not-found]

            torch_version = str(torch.__version__)
            torch_cuda_available = bool(torch.cuda.is_available())
            torch_cuda_version = str(torch.version.cuda) if torch.version.cuda else None
            if torch_cuda_available:
                torch_device_count = int(torch.cuda.device_count())
                device_id = min(max(0, settings.maneflow_gpu_device_id), max(0, torch_device_count - 1))
                torch_device_name = str(torch.cuda.get_device_name(device_id))
                capability = torch.cuda.get_device_capability(device_id)
                torch_compute_capability = f"{capability[0]}.{capability[1]}"
        except Exception as exc:  # pragma: no cover - runtime/hardware dependent
            errors.append(f"PyTorch CUDA probe failed: {exc}")

    onnxruntime_installed = importlib.util.find_spec("onnxruntime") is not None
    onnxruntime_version: str | None = None
    onnx_providers: tuple[str, ...] = ()
    if onnxruntime_installed:
        try:
            import onnxruntime as ort  # type: ignore[import-not-found]

            onnxruntime_version = str(ort.__version__)
            onnx_providers = tuple(str(item) for item in ort.get_available_providers())
        except Exception as exc:  # pragma: no cover - optional provider dependent
            errors.append(f"ONNX Runtime provider probe failed: {exc}")

    nvidia_smi_available, nvidia_gpus, nvidia_errors = _probe_nvidia_smi()
    errors.extend(nvidia_errors)
    return ComputeProbe(
        torch_installed=torch_installed,
        torch_version=torch_version,
        torch_cuda_available=torch_cuda_available,
        torch_cuda_version=torch_cuda_version,
        torch_device_count=torch_device_count,
        torch_device_name=torch_device_name,
        torch_compute_capability=torch_compute_capability,
        onnxruntime_installed=onnxruntime_installed,
        onnxruntime_version=onnxruntime_version,
        onnx_providers=onnx_providers,
        nvidia_smi_available=nvidia_smi_available,
        nvidia_gpus=nvidia_gpus,
        errors=tuple(errors),
    )



def _normalized_requested(value: str | None) -> RequestedDevice:
    requested = (value or settings.maneflow_compute_device).strip().lower()
    if requested not in {"auto", "cuda", "cpu"}:
        raise ComputeDeviceError(
            f"Unsupported MANEFLOW_COMPUTE_DEVICE={requested!r}; expected auto, cuda, or cpu."
        )
    return requested  # type: ignore[return-value]



def _runtime_cuda_available(probe: ComputeProbe, runtime: RuntimeKind) -> bool:
    if runtime == "torch":
        return probe.torch_cuda_available
    if runtime == "onnx":
        return "CUDAExecutionProvider" in probe.onnx_providers or "TensorrtExecutionProvider" in probe.onnx_providers
    return probe.torch_cuda_available or "CUDAExecutionProvider" in probe.onnx_providers or "TensorrtExecutionProvider" in probe.onnx_providers



def _free_vram_is_adequate(probe: ComputeProbe, device_id: int) -> tuple[bool, str | None]:
    matching = next((gpu for gpu in probe.nvidia_gpus if gpu.index == device_id), None)
    if matching is None or matching.memory_free_mb is None:
        return True, None
    required = max(0, settings.maneflow_gpu_min_free_vram_mb)
    if matching.memory_free_mb < required:
        return False, f"GPU {device_id} has {matching.memory_free_mb} MB free; {required} MB is required by policy"
    return True, None



def select_compute_device(
    *,
    workload: str,
    required_runtime: RuntimeKind = "any",
    beneficial: bool = True,
    requested_device: str | None = None,
    allow_cpu_fallback: bool | None = None,
    probe: ComputeProbe | None = None,
) -> ComputeSelection:
    requested = _normalized_requested(requested_device)
    fallback_allowed = (
        settings.maneflow_gpu_allow_cpu_fallback
        if allow_cpu_fallback is None
        else bool(allow_cpu_fallback)
    )
    detected = probe or probe_compute()
    gpu_device_id = max(0, settings.maneflow_gpu_device_id)
    cuda_available = _runtime_cuda_available(detected, required_runtime)
    adequate_vram, vram_reason = _free_vram_is_adequate(detected, gpu_device_id)

    selected: Literal["cuda", "cpu"]
    reason: str
    fallback_used = False
    if requested == "cpu":
        selected = "cpu"
        reason = "CPU was explicitly requested."
    elif requested == "auto" and not beneficial:
        selected = "cpu"
        reason = f"CPU selected because workload {workload!r} is not expected to benefit from GPU execution."
    elif cuda_available and adequate_vram:
        selected = "cuda"
        reason = f"CUDA selected for {workload!r}; compatible {required_runtime} runtime is available."
    else:
        failure_reason = vram_reason or f"no compatible CUDA {required_runtime} runtime is available"
        if requested == "cuda" and not fallback_allowed:
            raise ComputeDeviceError(
                f"CUDA was explicitly requested for {workload!r}, but {failure_reason}. CPU fallback is disabled."
            )
        selected = "cpu"
        fallback_used = requested == "cuda"
        prefix = "Explicit CUDA request fell back to CPU" if fallback_used else "Auto policy selected CPU"
        reason = f"{prefix} because {failure_reason}."

    onnx_providers = (
        ("TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider")
        if selected == "cuda"
        else ("CPUExecutionProvider",)
    )
    selection = ComputeSelection(
        requested_device=requested,
        selected_device=selected,
        reason=reason,
        workload=workload,
        required_runtime=required_runtime,
        gpu_device_id=gpu_device_id if selected == "cuda" else None,
        fallback_allowed=fallback_allowed,
        fallback_used=fallback_used,
        mixed_precision=bool(settings.maneflow_gpu_mixed_precision and selected == "cuda"),
        gpu_profile=settings.maneflow_gpu_profile.strip().lower() or "interactive",
        torch_device=f"cuda:{gpu_device_id}" if selected == "cuda" else "cpu",
        ultralytics_device=str(gpu_device_id) if selected == "cuda" else "cpu",
        onnx_providers=onnx_providers,
    )
    LOGGER.info("ManeFlow compute selection: %s", json.dumps(selection.to_dict(), sort_keys=True))
    return selection



def is_cuda_out_of_memory(error: BaseException) -> bool:
    text = str(error).lower()
    return "cuda out of memory" in text or "cudnn_status_alloc_failed" in text or "cudaerroroutofmemory" in text
