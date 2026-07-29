from __future__ import annotations

from dataclasses import dataclass
import logging
import math
from pathlib import Path
import threading
from typing import Any, Callable, Protocol, Sequence

import cv2
import numpy as np

from app.core.config import settings
from maneflow_vision.gpu.runtime import (
    ComputeDecision,
    ComputeDeviceError,
    preferred_onnx_providers,
    resolve_compute_device,
)

LOGGER = logging.getLogger(__name__)
_EXPECTED_DIMENSIONS = 1152


class SessionInput(Protocol):
    name: str
    shape: Sequence[Any]
    type: str


class SessionOutput(Protocol):
    name: str
    shape: Sequence[Any]
    type: str


class InferenceSessionLike(Protocol):
    def get_inputs(self) -> list[SessionInput]: ...
    def get_outputs(self) -> list[SessionOutput]: ...
    def get_providers(self) -> list[str]: ...
    def run(self, output_names: list[str] | None, input_feed: dict[str, np.ndarray]) -> list[np.ndarray]: ...


@dataclass(frozen=True)
class EmbeddingResult:
    vector: list[float]
    model_name: str
    provider: str
    dimensions: int
    normalized: bool
    requested_device: str = "auto"
    selected_device: str = "cpu"
    selection_reason: str = ""
    fallback_used: bool = False
    fallback_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "vector": self.vector,
            "model_name": self.model_name,
            "provider": self.provider,
            "dimensions": self.dimensions,
            "normalized": self.normalized,
            "requested_device": self.requested_device,
            "selected_device": self.selected_device,
            "selection_reason": self.selection_reason,
            "fallback_used": self.fallback_used,
            "fallback_reason": self.fallback_reason,
        }


@dataclass(frozen=True)
class EmbeddingReadiness:
    enabled: bool
    configured: bool
    ready: bool
    model_path: str | None
    model_name: str
    providers: list[str]
    compute: dict[str, Any] | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "ready": self.ready,
            "model_path": self.model_path,
            "model_name": self.model_name,
            "providers": self.providers,
            "compute": self.compute,
            "error": self.error,
        }


class EmbeddingEngineError(RuntimeError):
    """Raised when local embedding inference cannot safely produce a valid vector."""


SessionFactory = Callable[[str, list[Any], Any], InferenceSessionLike]


def _load_onnxruntime() -> Any:
    try:
        import onnxruntime as ort  # type: ignore[import-not-found]
    except ImportError as exc:
        raise EmbeddingEngineError(
            "onnxruntime is not installed; install onnxruntime-gpu for NVIDIA or onnxruntime for CPU."
        ) from exc
    return ort


def _provider_configuration(ort: Any) -> tuple[list[Any], ComputeDecision]:
    legacy = settings.embedding_execution_provider.strip().lower()
    requested = settings.maneflow_compute_device
    if requested.strip().lower() == "auto" and legacy in {"cpu", "cuda"}:
        requested = legacy
    try:
        decision = resolve_compute_device(
            "embedding",
            requested_device=requested,
            gpu_device_id=settings.maneflow_gpu_device_id,
            allow_cpu_fallback=settings.maneflow_gpu_allow_cpu_fallback,
            ort_module=ort,
        )
        providers = preferred_onnx_providers(
            ort,
            decision,
            enable_tensorrt=(
                settings.maneflow_onnx_tensorrt_enabled or legacy == "tensorrt"
            ),
            engine_cache_path=str(settings.embedding_engine_cache_dir),
        )
        return providers, decision
    except ComputeDeviceError as exc:
        raise EmbeddingEngineError(str(exc)) from exc


def _default_session_factory(model_path: str, providers: list[Any], ort: Any) -> InferenceSessionLike:
    options = ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.intra_op_num_threads = max(1, settings.embedding_intra_op_threads)
    options.inter_op_num_threads = 1
    options.enable_mem_pattern = True
    options.enable_cpu_mem_arena = True
    options.log_severity_level = 3
    return ort.InferenceSession(model_path, sess_options=options, providers=providers)


def _resolve_spatial_size(shape: Sequence[Any], fallback: int) -> tuple[int, int, bool]:
    normalized = list(shape)
    if len(normalized) != 4:
        raise EmbeddingEngineError(f"Expected a four-dimensional image input, received shape {shape!r}.")

    channel_first = normalized[1] in (3, "3") or normalized[1] is None
    if channel_first:
        height = normalized[2] if isinstance(normalized[2], int) and normalized[2] > 0 else fallback
        width = normalized[3] if isinstance(normalized[3], int) and normalized[3] > 0 else fallback
    else:
        height = normalized[1] if isinstance(normalized[1], int) and normalized[1] > 0 else fallback
        width = normalized[2] if isinstance(normalized[2], int) and normalized[2] > 0 else fallback
    return int(height), int(width), channel_first


def _letterbox(image: np.ndarray, target_height: int, target_width: int) -> np.ndarray:
    if image.ndim != 3 or image.shape[2] not in (3, 4):
        raise EmbeddingEngineError("Embedding input must be a BGR/BGRA color image.")
    bgr = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR) if image.shape[2] == 4 else image
    source_height, source_width = bgr.shape[:2]
    if source_height <= 0 or source_width <= 0:
        raise EmbeddingEngineError("Embedding input image has invalid dimensions.")

    scale = min(target_width / source_width, target_height / source_height)
    resized_width = max(1, int(round(source_width * scale)))
    resized_height = max(1, int(round(source_height * scale)))
    resized = cv2.resize(bgr, (resized_width, resized_height), interpolation=cv2.INTER_AREA)

    canvas = np.full((target_height, target_width, 3), 127, dtype=np.uint8)
    offset_x = (target_width - resized_width) // 2
    offset_y = (target_height - resized_height) // 2
    canvas[offset_y : offset_y + resized_height, offset_x : offset_x + resized_width] = resized
    return cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)


def _preprocess(image: np.ndarray, input_meta: SessionInput) -> np.ndarray:
    target_height, target_width, channel_first = _resolve_spatial_size(
        input_meta.shape, settings.embedding_input_size
    )
    rgb = _letterbox(image, target_height, target_width).astype(np.float32) / 255.0
    mean = np.asarray(settings.embedding_channel_mean, dtype=np.float32).reshape((1, 1, 3))
    std = np.asarray(settings.embedding_channel_std, dtype=np.float32).reshape((1, 1, 3))
    if np.any(std <= 0):
        raise EmbeddingEngineError("Embedding channel standard deviations must be positive.")
    normalized = (rgb - mean) / std
    if channel_first:
        normalized = np.transpose(normalized, (2, 0, 1))
    tensor = np.expand_dims(normalized, axis=0)
    input_type = str(input_meta.type).lower()
    return tensor.astype(np.float16 if "float16" in input_type else np.float32, copy=False)


def _extract_vector(outputs: list[np.ndarray], output_meta: list[SessionOutput]) -> np.ndarray:
    if not outputs:
        raise EmbeddingEngineError("The embedding model returned no outputs.")

    preferred_name = settings.embedding_output_name.strip()
    selected: np.ndarray | None = None
    if preferred_name:
        for index, meta in enumerate(output_meta):
            if meta.name == preferred_name and index < len(outputs):
                selected = np.asarray(outputs[index])
                break
        if selected is None:
            raise EmbeddingEngineError(
                f"Configured embedding output '{preferred_name}' was not returned by the model."
            )
    else:
        candidates = [np.asarray(value) for value in outputs]
        selected = next(
            (value for value in candidates if value.size == _EXPECTED_DIMENSIONS),
            candidates[0],
        )

    value = np.asarray(selected, dtype=np.float32)
    if value.ndim >= 3:
        value = value[0]
        if value.ndim == 2 and value.shape[-1] == _EXPECTED_DIMENSIONS:
            value = value[0] if value.shape[0] > 1 else value.reshape(-1)
        else:
            value = np.mean(value, axis=tuple(range(value.ndim - 1)))
    value = value.reshape(-1)
    if value.size != _EXPECTED_DIMENSIONS:
        raise EmbeddingEngineError(
            f"Embedding output has {value.size} dimensions; {_EXPECTED_DIMENSIONS} are required."
        )
    if not np.all(np.isfinite(value)):
        raise EmbeddingEngineError("Embedding output contains non-finite values.")
    norm = float(np.linalg.norm(value))
    if not math.isfinite(norm) or norm <= 1e-12:
        raise EmbeddingEngineError("Embedding output has zero or invalid magnitude.")
    return value / norm


class LocalEmbeddingEngine:
    def __init__(
        self,
        *,
        model_path: str | Path | None = None,
        session_factory: SessionFactory | None = None,
        ort_module: Any | None = None,
    ) -> None:
        configured_path = model_path or settings.embedding_model_path
        self._model_path = Path(configured_path).expanduser().resolve() if configured_path else None
        self._session_factory = session_factory
        self._ort_module = ort_module
        self._session: InferenceSessionLike | None = None
        self._lock = threading.RLock()
        self._initialization_error: str | None = None
        self._compute_decision: ComputeDecision | None = None

    @property
    def enabled(self) -> bool:
        return settings.embedding_enabled

    def _initialize(self) -> InferenceSessionLike:
        with self._lock:
            if self._session is not None:
                return self._session
            if not self.enabled:
                raise EmbeddingEngineError("Local embedding extraction is disabled.")
            if self._model_path is None:
                raise EmbeddingEngineError("No local embedding ONNX model path is configured.")
            if not self._model_path.is_file():
                raise EmbeddingEngineError(f"Embedding model does not exist: {self._model_path}")

            try:
                ort = self._ort_module or _load_onnxruntime()
                providers, decision = _provider_configuration(ort)
                factory = self._session_factory or _default_session_factory
                session = factory(str(self._model_path), providers, ort)
                inputs = session.get_inputs()
                if len(inputs) != 1:
                    raise EmbeddingEngineError(
                        f"Embedding model must expose exactly one image input; received {len(inputs)}."
                    )
                self._session = session
                self._compute_decision = decision
                self._initialization_error = None
                return session
            except Exception as exc:
                self._initialization_error = str(exc)
                if isinstance(exc, EmbeddingEngineError):
                    raise
                raise EmbeddingEngineError(f"Failed to initialize local embedding model: {exc}") from exc

    def extract(self, image: np.ndarray) -> EmbeddingResult:
        session = self._initialize()
        input_meta = session.get_inputs()[0]
        tensor = _preprocess(image, input_meta)
        try:
            outputs = session.run(None, {input_meta.name: tensor})
        except Exception as exc:
            raise EmbeddingEngineError(f"Local embedding inference failed: {exc}") from exc
        vector = _extract_vector(outputs, session.get_outputs())
        providers = session.get_providers()
        provider = providers[0] if providers else "unknown"
        decision = self._compute_decision or resolve_compute_device(
            "embedding", cuda_available=provider in {"CUDAExecutionProvider", "TensorrtExecutionProvider"}
        )
        actual_device = (
            "cuda"
            if provider in {"CUDAExecutionProvider", "TensorrtExecutionProvider"}
            else "cpu"
        )
        return EmbeddingResult(
            vector=[float(value) for value in vector.tolist()],
            model_name=settings.embedding_model_name,
            provider=provider,
            dimensions=_EXPECTED_DIMENSIONS,
            normalized=True,
            requested_device=decision.requested_device,
            selected_device=actual_device,
            selection_reason=decision.reason,
            fallback_used=decision.fallback_used,
            fallback_reason=decision.fallback_reason,
        )

    def readiness(self, *, initialize: bool = False) -> EmbeddingReadiness:
        configured = self._model_path is not None and self._model_path.is_file()
        if initialize and self.enabled and configured and self._session is None:
            try:
                self._initialize()
            except EmbeddingEngineError:
                LOGGER.warning("Local embedding engine readiness initialization failed", exc_info=True)
        providers = self._session.get_providers() if self._session is not None else []
        return EmbeddingReadiness(
            enabled=self.enabled,
            configured=configured,
            ready=self._session is not None,
            model_path=str(self._model_path) if self._model_path else None,
            model_name=settings.embedding_model_name,
            providers=providers,
            compute=self._compute_decision.to_dict() if self._compute_decision else None,
            error=self._initialization_error,
        )


embedding_engine = LocalEmbeddingEngine()
