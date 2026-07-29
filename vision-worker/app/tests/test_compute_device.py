from __future__ import annotations

import pytest

from maneflow_vision.gpu.runtime import (
    ComputeDeviceError,
    resolve_compute_device,
    run_with_oom_recovery,
)


class FakeCuda:
    def __init__(self, available: bool):
        self._available = available

    def is_available(self):
        return self._available

    def get_device_name(self, index):
        return "Fake NVIDIA GPU"


class FakeTorch:
    def __init__(self, available: bool):
        self.cuda = FakeCuda(available)


class FakeOrt:
    def __init__(self, providers):
        self.providers = providers

    def get_available_providers(self):
        return self.providers


def test_explicit_cpu_never_initializes_cuda():
    decision = resolve_compute_device(
        "embedding",
        requested_device="cpu",
        torch_module=FakeTorch(True),
        ort_module=FakeOrt(["CUDAExecutionProvider", "CPUExecutionProvider"]),
    )
    assert decision.selected_device == "cpu"
    assert decision.fallback_used is False


def test_auto_uses_cuda_for_supported_neural_workload():
    decision = resolve_compute_device(
        "card_detection",
        requested_device="auto",
        torch_module=FakeTorch(True),
        ort_module=FakeOrt(["CUDAExecutionProvider", "CPUExecutionProvider"]),
    )
    assert decision.selected_device == "cuda"
    assert decision.torch_device == "cuda:0"


def test_auto_keeps_lightweight_hashing_on_cpu_even_when_cuda_exists():
    decision = resolve_compute_device(
        "file_hashing",
        requested_device="auto",
        torch_module=FakeTorch(True),
    )
    assert decision.selected_device == "cpu"
    assert "not expected to benefit" in decision.reason


def test_explicit_cuda_fails_clearly_without_fallback():
    with pytest.raises(ComputeDeviceError, match="explicitly requested"):
        resolve_compute_device(
            "training",
            requested_device="cuda",
            allow_cpu_fallback=False,
            cuda_available=False,
        )


def test_explicit_cuda_records_cpu_fallback_when_allowed():
    decision = resolve_compute_device(
        "evaluation",
        requested_device="cuda",
        allow_cpu_fallback=True,
        cuda_available=False,
    )
    assert decision.selected_device == "cpu"
    assert decision.fallback_used is True
    assert decision.fallback_reason


def test_cuda_oom_recovery_retries_once_on_cpu():
    attempts = []

    def operation(decision):
        attempts.append(decision.selected_device)
        if decision.is_cuda:
            raise RuntimeError("CUDA out of memory")
        return "ok"

    decision = resolve_compute_device(
        "card_detection",
        requested_device="cuda",
        cuda_available=True,
    )
    result, actual = run_with_oom_recovery(operation, decision, allow_cpu_fallback=True)
    assert result == "ok"
    assert attempts == ["cuda", "cpu"]
    assert actual.fallback_used is True
