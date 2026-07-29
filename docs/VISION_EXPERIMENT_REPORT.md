# Vision Experiment Report

## Current status

No model parameters were trained or fine-tuned in this change. No new checkpoint is claimed. The owner image folder and owner GPU were not accessible in this execution environment.

## Implemented experiment controls

- Allowlisted Python-module experiment runner.
- JSON or YAML configuration with checksum.
- Requested-device propagation.
- Start/end environment snapshots.
- stdout/stderr capture.
- Framework versions and return code.
- Default promotion state `REVIEW_REQUIRED`; execution failure becomes `REJECTED_EXECUTION_FAILED`.
- Immutable model versions in the local registry.

## Required promotion evidence

A future detector/OCR/retrieval experiment must include rights-cleared dataset hashes, protected split hashes, exact Git commit, base-model source/license, seed, hyperparameters, GPU/provider, peak resources, metrics, limitations, artifact checksum, and rollback target.
