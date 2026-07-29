# Baseline Vision Report

**Status:** Baseline tooling exists; the owner 800-image baseline has not been executed.

## Preserved baseline requirement

No learned model behavior may be promoted until the unchanged canonical pipeline is run against a rights-cleared evaluation set and records:

- detection recall and false detections;
- exact identity, top-1, and top-5;
- year, manufacturer, set, card number, variant, serial, grader, grade, and cert accuracy;
- abstention, correct abstention, and false-confidence rate;
- P50/P95/P99 latency and per-stage timing;
- CPU, RAM, GPU utilization, and peak VRAM;
- subgroup results for raw, slab, front, back, binder, multi-card, glare, blur, rotation, low light, and mixed scenes.

## Previously verified project evidence

The canonical consolidation PR reports 248 Node tests and successful CI, but behavioral tests are not a real-image recognition benchmark. The older supplied source snapshot passes 204 Node tests and 58 Python tests before this GPU change. These totals establish regression scaffolding only.

## Current baseline artifact

`artifacts/baseline-results.json` is a sanitized `NOT_RUN` record. It must not be replaced with example or synthetic accuracy values.
