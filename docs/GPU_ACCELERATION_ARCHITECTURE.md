# ManeFlow GPU Acceleration Architecture

## Objective

Use GPU acceleration where it produces measured throughput or latency benefit while preserving deterministic CPU execution, honest fallback, and the existing ManeFlow evidence and abstention rules.

## Central policy

```text
MANEFLOW_COMPUTE_DEVICE=auto
MANEFLOW_GPU_DEVICE_ID=0
MANEFLOW_GPU_MEMORY_FRACTION=0.85
MANEFLOW_GPU_ALLOW_CPU_FALLBACK=true
MANEFLOW_GPU_MIXED_PRECISION=true
MANEFLOW_GPU_MAX_BATCH_SIZE=auto
MANEFLOW_GPU_EXECUTION_PROFILE=interactive
MANEFLOW_ONNX_TENSORRT_ENABLED=false
```

### Device semantics

| Requested | Behavior |
|---|---|
| `cpu` | Never initialize CUDA. |
| `cuda` | Require CUDA unless explicit fallback is enabled; record any fallback. |
| `auto` | Select CUDA only for compatible neural workloads; use CPU for hashing, file I/O, and lightweight deterministic operations. |

Every learned result records requested device, selected device, provider, reason, and fallback state.

## GPU-eligible stages

- Ultralytics card/slab/holder detection and segmentation.
- ONNX visual embeddings and retrieval-index preparation.
- Future local OCR when a CUDA-capable, benchmarked OCR provider is configured.
- Approved training, fine-tuning, augmentation, and evaluation.
- Batched inference and model export benchmarks.

## CPU stages

- File discovery and format checks.
- SHA-256 and metadata extraction.
- Database transactions and audit logging.
- Lightweight perceptual hashing.
- Pricing, authorization, and evidence-policy decisions.
- Classical OpenCV fallback where GPU setup overhead would not help.

## Memory and stability controls

- Per-process CUDA allocation fraction capped at 0.85 by default.
- Mixed precision is limited to CUDA inference and must preserve benchmark quality.
- CUDA OOM causes cache cleanup and at most one explicit CPU retry when allowed.
- No automatic long-running training.
- TensorRT remains opt-in because engine compatibility and maintenance must be measured.
- Model weights and large generated artifacts are excluded from Git.

## Execution profiles

| Profile | Intended use |
|---|---|
| `interactive` | Small batches, desktop headroom, Codex/browser coexistence. |
| `benchmark` | Reproducible evaluation; no model updates. |
| `training` | Explicit invocation, checkpointing, high utilization, thermal monitoring. |
| `background_preparation` | Resumable low-priority crops, embeddings, and indexing. |

The profile is recorded but is not used to start jobs automatically.
