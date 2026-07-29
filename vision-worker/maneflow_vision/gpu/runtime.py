from __future__ import annotations

from dataclasses import asdict, dataclass
import logging
import os
from typing import Any, Callable, Iterable

LOGGER = logging.getLogger(__name__)
_GPU_WORKLOADS = {
    "card_detection",
    "segmentation",
    "ocr",
    "embedding",
    "training",
    "evaluation",
    "augmentation",
    "batch_inference",
}


class ComputeDeviceError(RuntimeError):
    """Raised when the requested compute device cannot be selected safely."""


@dataclass(frozen=True)
class ComputeDecision:
    requested_device: str
    selected_device: str
    workload: str
    reason: str
    gpu_device_id: int = 0
    fallback_used: bool = False
    fallback_reason: str | None = None
    execution_provider: str | None = None

    @property
    def is_cuda(self) -> bool:
        return self.selected_device == "cuda"

    @property
    def torch_device(self) -> str:
        return f"cuda:{self.gpu_device_id}" if self.is_cuda else "cpu"

    @property
    def ultralytics_device(self) -> str:
        return str(self.gpu_device_id) if self.is_cuda else "cpu"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def normalize_requested_device(value: str | None) -> str:
    requested = str(value or "auto").strip().lower()
    if requested not in {"auto", "cuda", "cpu"}:
        raise ComputeDeviceError(
            "MANEFLOW_COMPUTE_DEVICE must be one of: auto, cuda, cpu."
        )
    return requested


def _available_onnx_providers(ort_module: Any | None = None) -> set[str]:
    try:
        if ort_module is None:
            import onnxruntime as ort_module  # type: ignore[import-not-found]
        return set(ort_module.get_available_providers())
    except Exception:
        return set()


def _torch_cuda_probe(torch_module: Any | None = None) -> tuple[bool, str | None]:
    try:
        if torch_module is None:
            import torch as torch_module  # type: ignore[import-not-found]
        available = bool(torch_module.cuda.is_available())
        if not available:
            return False, None
        return True, str(torch_module.cuda.get_device_name(0))
    except Exception:
        return False, None


def detect_cuda_capability(
    *,
    torch_module: Any | None = None,
    ort_module: Any | None = None,
) -> dict[str, Any]:
    torch_available, torch_name = _torch_cuda_probe(torch_module)
    providers = _available_onnx_providers(ort_module)
    return {
        "torch_cuda_available": torch_available,
        "torch_gpu_name": torch_name,
        "onnx_providers": sorted(providers),
        "onnx_cuda_available": "CUDAExecutionProvider" in providers,
        "onnx_tensorrt_available": "TensorrtExecutionProvider" in providers,
    }


def resolve_compute_device(
    workload: str,
    *,
    requested_device: str | None = None,
    gpu_device_id: int | None = None,
    allow_cpu_fallback: bool | None = None,
    cuda_available: bool | None = None,
    torch_module: Any | None = None,
    ort_module: Any | None = None,
) -> ComputeDecision:
    """Resolve a deterministic CPU/CUDA decision without silently hiding fallback."""
    from app.core.config import settings

    requested = normalize_requested_device(
        requested_device if requested_device is not None else settings.maneflow_compute_device
    )
    device_id = int(
        settings.maneflow_gpu_device_id if gpu_device_id is None else gpu_device_id
    )
    fallback_allowed = bool(
        settings.maneflow_gpu_allow_cpu_fallback
        if allow_cpu_fallback is None
        else allow_cpu_fallback
    )
    normalized_workload = str(workload or "unspecified").strip().lower()
    beneficial = normalized_workload in _GPU_WORKLOADS

    if requested == "cpu":
        return ComputeDecision(
            requested_device=requested,
            selected_device="cpu",
            workload=normalized_workload,
            reason="CPU was explicitly requested.",
            gpu_device_id=device_id,
        )

    if cuda_available is None:
        capability = detect_cuda_capability(
            torch_module=torch_module,
            ort_module=ort_module,
        )
        cuda_available = bool(
            capability["torch_cuda_available"] or capability["onnx_cuda_available"]
        )

    if requested == "auto" and not beneficial:
        return ComputeDecision(
            requested_device=requested,
            selected_device="cpu",
            workload=normalized_workload,
            reason="This workload is I/O-bound or lightweight and is not expected to benefit from CUDA.",
            gpu_device_id=device_id,
        )

    if cuda_available:
        return ComputeDecision(
            requested_device=requested,
            selected_device="cuda",
            workload=normalized_workload,
            reason="A compatible CUDA execution path is available for this workload.",
            gpu_device_id=device_id,
        )

    reason = "A compatible CUDA execution path is unavailable."
    if requested == "cuda" and not fallback_allowed:
        raise ComputeDeviceError(
            f"CUDA was explicitly requested for {normalized_workload}, but it is unavailable and CPU fallback is disabled."
        )
    return ComputeDecision(
        requested_device=requested,
        selected_device="cpu",
        workload=normalized_workload,
        reason="CPU selected because CUDA is unavailable.",
        gpu_device_id=device_id,
        fallback_used=requested == "cuda",
        fallback_reason=reason if requested == "cuda" else None,
    )


def configure_torch_memory(torch_module: Any, decision: ComputeDecision) -> None:
    """Apply a conservative per-process CUDA memory fraction when supported."""
    if not decision.is_cuda:
        return
    from app.core.config import settings

    fraction = float(settings.maneflow_gpu_memory_fraction)
    if not 0.1 <= fraction <= 0.95:
        raise ComputeDeviceError(
            "MANEFLOW_GPU_MEMORY_FRACTION must be between 0.10 and 0.95."
        )
    setter = getattr(getattr(torch_module, "cuda", None), "set_per_process_memory_fraction", None)
    if callable(setter):
        setter(fraction, decision.gpu_device_id)


def is_out_of_memory_error(error: BaseException) -> bool:
    text = str(error).lower()
    return "out of memory" in text or "cuda error: out of memory" in text


def clear_cuda_cache(torch_module: Any | None = None) -> None:
    try:
        if torch_module is None:
            import torch as torch_module  # type: ignore[import-not-found]
        cuda = getattr(torch_module, "cuda", None)
        if cuda is not None and callable(getattr(cuda, "empty_cache", None)):
            cuda.empty_cache()
    except Exception:
        LOGGER.debug("CUDA cache cleanup was unavailable.", exc_info=True)


def run_with_oom_recovery(
    operation: Callable[[ComputeDecision], Any],
    decision: ComputeDecision,
    *,
    allow_cpu_fallback: bool,
) -> tuple[Any, ComputeDecision]:
    """Run once on the selected device and make an explicit CPU retry after CUDA OOM."""
    try:
        return operation(decision), decision
    except Exception as error:
        if not decision.is_cuda or not is_out_of_memory_error(error):
            raise
        clear_cuda_cache()
        if not allow_cpu_fallback:
            raise ComputeDeviceError(
                "CUDA ran out of memory and CPU fallback is disabled."
            ) from error
        fallback = ComputeDecision(
            requested_device=decision.requested_device,
            selected_device="cpu",
            workload=decision.workload,
            reason="CPU retry selected after CUDA out-of-memory failure.",
            gpu_device_id=decision.gpu_device_id,
            fallback_used=True,
            fallback_reason=str(error)[:500],
        )
        LOGGER.warning(
            "ManeFlow CUDA OOM for %s; retrying explicitly on CPU.",
            decision.workload,
        )
        return operation(fallback), fallback


def preferred_onnx_providers(
    ort_module: Any,
    decision: ComputeDecision,
    *,
    enable_tensorrt: bool = False,
    engine_cache_path: str | None = None,
) -> list[Any]:
    """Build an ONNX Runtime provider list consistent with the central device policy."""
    available = set(ort_module.get_available_providers())
    providers: list[Any] = []

    if decision.is_cuda:
        if enable_tensorrt and "TensorrtExecutionProvider" in available:
            providers.append(
                (
                    "TensorrtExecutionProvider",
                    {
                        "trt_fp16_enable": True,
                        "trt_engine_cache_enable": True,
                        "trt_engine_cache_path": engine_cache_path or "",
                        "trt_timing_cache_enable": True,
                        "trt_timing_cache_path": engine_cache_path or "",
                    },
                )
            )
        if "CUDAExecutionProvider" in available:
            providers.append(
                (
                    "CUDAExecutionProvider",
                    {
                        "device_id": decision.gpu_device_id,
                        "arena_extend_strategy": "kNextPowerOfTwo",
                        "cudnn_conv_algo_search": "HEURISTIC",
                        "do_copy_in_default_stream": True,
                    },
                )
            )
        elif not decision.fallback_used:
            raise ComputeDeviceError(
                "CUDA was selected but ONNX Runtime does not expose CUDAExecutionProvider."
            )

    if "CPUExecutionProvider" in available:
        providers.append(("CPUExecutionProvider", {"arena_extend_strategy": "kSameAsRequested"}))
    if not providers:
        raise ComputeDeviceError("No compatible ONNX Runtime execution provider is available.")
    return providers


def environment_overrides() -> dict[str, str]:
    """Return sanitized compute-related environment settings for diagnostics."""
    names: Iterable[str] = (
        "MANEFLOW_COMPUTE_DEVICE",
        "MANEFLOW_GPU_DEVICE_ID",
        "MANEFLOW_GPU_MEMORY_FRACTION",
        "MANEFLOW_GPU_ALLOW_CPU_FALLBACK",
        "MANEFLOW_GPU_MIXED_PRECISION",
        "MANEFLOW_GPU_MAX_BATCH_SIZE",
        "MANEFLOW_GPU_EXECUTION_PROFILE",
        "MANEFLOW_ONNX_TENSORRT_ENABLED",
    )
    return {name: os.getenv(name, "") for name in names}
