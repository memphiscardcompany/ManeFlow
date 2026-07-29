# GPU Performance Report

**Status:** No owner-workstation CUDA benchmark has been run.

## Implemented instrumentation

- ONNX embedding results record execution provider and selected device.
- Ultralytics detector readiness records compute decision.
- Doctor records NVIDIA telemetry and framework capability.
- Benchmark/experiment artifacts retain device and provider information.
- OOM fallback is explicit and test-covered.

## Required comparison

For each representative workload, compare unchanged inputs and model checksum on CPU and CUDA:

| Workload | Required measures |
|---|---|
| Single card | cold/warm P50, P95, RAM, VRAM |
| Nine-card binder page | detection and total latency, count recall |
| 36 cards / four images | throughput and peak VRAM |
| 100 cards | total time, retries, queue behavior |
| Embedding batch | images/sec, transfer time, provider |
| OCR batch | fields/sec, accuracy, provider |

The RTX 2070 Super performance targets remain engineering targets, not achieved benchmarks.
