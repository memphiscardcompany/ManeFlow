# GPU and Vision Rollback and Recovery

## Configuration rollback

Set:

```text
MANEFLOW_COMPUTE_DEVICE=cpu
MANEFLOW_ONNX_TENSORRT_ENABLED=false
CARD_DETECTOR_BACKEND=classical
EMBEDDING_ENABLED=false
```

Restart only the affected vision worker through the documented local/staging runbook. Do not restart unrelated Codex or development processes.

## Model rollback

- Model artifacts are immutable and checksum-addressed.
- Registry entries record promotion status and rollback target.
- Never overwrite an existing checkpoint.
- Repoint the configured model path to the last validated artifact.
- Run CPU smoke, locked benchmark, and readiness checks before restoring traffic.

## OOM recovery

- Clear the framework CUDA cache.
- Retry once with a smaller job or explicit CPU fallback when allowed.
- Preserve experiment logs and checkpoints.
- Do not alter clocks, voltage, BIOS, fan curves, or power limits.

## Repository rollback

Use a normal Git revert of the feature commit. Do not reset, rebase, force-push, clean, or rewrite canonical history. Production deployment remains disabled until separate release approval.
