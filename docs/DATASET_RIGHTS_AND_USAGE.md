# Dataset Rights and Usage

## Governing rule

Unknown rights are `QUARANTINED_PENDING_REVIEW`. Marketplace images, transient provider images, and private customer uploads are not training data by default.

## States

| State | Training | Evaluation | Retrieval | Persistence |
|---|---:|---:|---:|---|
| `AUTHORIZED_TRAINING` | Yes | Yes | Yes | Owner/license policy |
| `AUTHORIZED_EVALUATION_ONLY` | No | Yes | No | Controlled benchmark |
| `AUTHORIZED_RETRIEVAL_ONLY` | No | No | Yes | Contract-dependent |
| `QUARANTINED_PENDING_REVIEW` | No | No | No | Isolated only |
| `PROHIBITED` | No | No | No | Do not retain |

## Owner image folder

The approximately 800 images referenced by Joshua are not present in the canonical repository or this execution environment. No location, ownership record, or authorization basis was guessed. The audit command must be pointed at the actual local folder.

```powershell
cd vision-worker
python -m maneflow_vision.data.audit `
  --input "<owner-authorized-folder>" `
  --authorization-state AUTHORIZED_TRAINING `
  --source "Joshua Chappell owner-controlled collection photographs" `
  --owner-approved-training `
  --assign-splits
```

The working manifest is written under ignored `artifacts/private/`. Source images are never moved, renamed, modified, or committed.

## Audit coverage

- Format validation and corrupt-image detection.
- SHA-256 and perceptual hash.
- Exact and near-duplicate screening.
- Width, height, format, aspect ratio.
- Blur, exposure clipping, and glare estimates.
- Deterministic group-level split assignment.
- Split-leakage validation.

Near-duplicate grouping does not prove two photos show the same physical card. Cert numbers, inventory IDs, OCR identity, and human review must strengthen physical-card grouping before a locked test is considered defensible.
