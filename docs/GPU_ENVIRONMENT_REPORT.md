# ManeFlow GPU Environment Report

**Status:** Owner workstation execution not yet verified from this repository session.

This file is intentionally evidence-bounded. The repository now contains a non-destructive doctor command, but the exact EVGA/NVIDIA model, driver, CUDA runtime, VRAM, motherboard, Windows version, active GPU processes, thermals, power draw, and owner image-folder location must be captured by running the command on Joshua Chappell's workstation.

## Required owner-workstation command

```powershell
cd <ManeFlow repository>\vision-worker
python -m maneflow_vision.gpu.doctor `
  --json-out ..\artifacts\gpu-environment.json `
  --markdown-out ..\docs\GPU_ENVIRONMENT_REPORT.md
```

The doctor records sanitized output from:

```text
nvidia-smi
nvidia-smi --query-gpu=name,uuid,driver_version,memory.total,memory.free,temperature.gpu,utilization.gpu,power.draw,pstate --format=csv,noheader,nounits
nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader,nounits
nvcc --version
node --version
docker --version
```

It also records Python, PyTorch, TensorFlow, ONNX Runtime providers, Ultralytics, PaddleOCR, WSL detection, RAM, CPU count, and disk availability.

## Verified in source

- Central device policy accepts `auto`, `cuda`, and `cpu`.
- Explicit CUDA failure is surfaced; fallback is recorded rather than hidden.
- GPU memory fraction defaults to `0.85` to retain desktop headroom.
- Mixed precision defaults on only for CUDA neural inference.
- Ultralytics detection and ONNX embeddings use the central policy.
- CUDA out-of-memory errors can trigger one explicit CPU retry when permitted.
- The doctor does not install drivers or alter clocks, voltage, BIOS, fan curves, or power limits.

## Not verified

- The owner's believed RTX 2070 Super model and 8 GB VRAM.
- NVIDIA driver and supported CUDA version.
- CUDA-enabled PyTorch or ONNX Runtime installation on the owner PC.
- Real CUDA execution, utilization, peak VRAM, thermals, power, or speedup.
- Motherboard, PSU, second-GPU, or storage constraints.

No statement that ManeFlow used the owner's GPU is valid until `artifacts/gpu-environment.json` and benchmark results record an actual CUDA execution provider.
