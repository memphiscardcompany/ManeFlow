import pytest

from app.core.compute import (
    ComputeDeviceError,
    ComputeProbe,
    NvidiaGpu,
    is_cuda_out_of_memory,
    select_compute_device,
)


def probe(*, torch_cuda=False, onnx_cuda=False, free_mb=7000):
    providers = ("CUDAExecutionProvider", "CPUExecutionProvider") if onnx_cuda else ("CPUExecutionProvider",)
    return ComputeProbe(
        torch_installed=True,
        torch_version="test",
        torch_cuda_available=torch_cuda,
        torch_cuda_version="12.1" if torch_cuda else None,
        torch_device_count=1 if torch_cuda else 0,
        torch_device_name="Test GPU" if torch_cuda else None,
        torch_compute_capability="7.5" if torch_cuda else None,
        onnxruntime_installed=True,
        onnxruntime_version="test",
        onnx_providers=providers,
        nvidia_smi_available=torch_cuda or onnx_cuda,
        nvidia_gpus=(
            NvidiaGpu(
                index=0,
                name="Test GPU",
                driver_version="test",
                memory_total_mb=8192,
                memory_free_mb=free_mb,
                temperature_c=50.0,
                utilization_percent=10.0,
                power_draw_watts=40.0,
            ),
        ) if torch_cuda or onnx_cuda else (),
    )


def test_explicit_cpu_never_initializes_cuda():
    selected = select_compute_device(
        workload="test",
        required_runtime="torch",
        requested_device="cpu",
        probe=probe(torch_cuda=True),
    )
    assert selected.selected_device == "cpu"
    assert selected.torch_device == "cpu"
    assert selected.fallback_used is False


def test_auto_selects_cuda_for_beneficial_torch_workload():
    selected = select_compute_device(
        workload="detector",
        required_runtime="torch",
        requested_device="auto",
        probe=probe(torch_cuda=True),
    )
    assert selected.selected_device == "cuda"
    assert selected.ultralytics_device == "0"
    assert selected.mixed_precision is True


def test_auto_selects_cpu_when_cuda_runtime_is_unavailable():
    selected = select_compute_device(
        workload="embedding",
        required_runtime="onnx",
        requested_device="auto",
        probe=probe(),
    )
    assert selected.selected_device == "cpu"
    assert "no compatible CUDA" in selected.reason


def test_explicit_cuda_fails_when_fallback_is_disabled():
    with pytest.raises(ComputeDeviceError, match="CPU fallback is disabled"):
        select_compute_device(
            workload="detector",
            required_runtime="torch",
            requested_device="cuda",
            allow_cpu_fallback=False,
            probe=probe(),
        )


def test_explicit_cuda_records_fallback_when_allowed():
    selected = select_compute_device(
        workload="detector",
        required_runtime="torch",
        requested_device="cuda",
        allow_cpu_fallback=True,
        probe=probe(),
    )
    assert selected.selected_device == "cpu"
    assert selected.fallback_used is True
    assert "fell back" in selected.reason


def test_auto_does_not_force_gpu_for_nonbeneficial_work():
    selected = select_compute_device(
        workload="sha256 hashing",
        required_runtime="any",
        beneficial=False,
        requested_device="auto",
        probe=probe(torch_cuda=True, onnx_cuda=True),
    )
    assert selected.selected_device == "cpu"
    assert "not expected to benefit" in selected.reason


def test_low_free_vram_prevents_auto_cuda_selection():
    selected = select_compute_device(
        workload="detector",
        required_runtime="torch",
        requested_device="auto",
        probe=probe(torch_cuda=True, free_mb=256),
    )
    assert selected.selected_device == "cpu"
    assert "free" in selected.reason


def test_cuda_oom_detection_is_explicit():
    assert is_cuda_out_of_memory(RuntimeError("CUDA out of memory")) is True
    assert is_cuda_out_of_memory(RuntimeError("ordinary failure")) is False
