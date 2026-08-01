# ManeFlow Private Benchmark Manifest V1

## Objective

Create a reproducible, rights-aware inventory of owner-controlled or otherwise authorized card images without committing private image bytes to GitHub.

The manifest is the control plane for later detection, OCR, retrieval, calibration, and release benchmarks. It is not a training dataset by itself and it does not establish recognition accuracy.

## Command

```bash
node scripts/build-benchmark-manifest.mjs \
  --root /private/path/to/authorized-images \
  --output /private/path/manifests/drive-corpus-v1.jsonl \
  --rights-status owner-controlled \
  --split unassigned
```

Add `--training-use-allowed` only after the rights status and intended use have been explicitly confirmed. The command refuses training use for transient evaluation, unclear-rights, and prohibited sources.

Generated files are created with private owner permissions where the operating system supports them:

```text
<output>.jsonl
<output>.jsonl.summary.json
```

The summary records the manifest SHA-256 and bounded counts. The manifest records relative source paths rather than absolute workstation paths.

## Row identity and duplicate handling

Each source observation receives a deterministic `asset_id` derived from:

```text
raw image SHA-256 + relative source path
```

Exact duplicate bytes therefore remain separate source observations while sharing:

```text
sha256
physical_card_group_id seeded from the exact content hash
```

This allows duplicate files to be measured, reviewed, and removed without losing provenance.

Exact hashing is only the first grouping stage. Fronts, backs, alternate angles, screenshots, burst frames, holder photographs, and rescans of the same physical card require human-reviewed or benchmarked perceptual grouping before train, validation, calibration, and locked-test assignment.

## Leakage prevention

All observations assigned to one `physical_card_group_id` must remain in one non-unassigned split. The validator rejects a physical-card group that appears in more than one of:

```text
train
validation
calibration
test
locked_test
```

A locked acceptance set such as the original Ohtani batch must never be used for training, pseudo-labeling, threshold selection, retrieval-index fitting, or confidence calibration.

## Rights and retention

Supported rights states are:

```text
owner-controlled
explicitly-licensed
partner-approved
public-domain
permissive-open-license
transient-evaluation
terms-unclear
prohibited
```

The manifest builder does not infer rights from file location, filename, marketplace origin, or prior discussion. The caller must supply the classification.

Customer images remain excluded from training unless explicit recorded consent and an approved rights record exist.

Marketplace or certification images used under transient-evaluation rules may retain limited provenance and test output, but their image bytes must be deleted according to the applicable policy and must not enter a persistent training corpus.

## Privacy boundary

This implementation:

- reads files from a caller-supplied private directory;
- writes only the requested private manifest and summary;
- does not upload images;
- does not commit image bytes;
- does not persist OCR or inferred identities;
- does not treat filenames as visual or identity evidence.

Private manifests should normally remain outside the repository. Only schemas, tools, redacted examples, aggregate benchmark reports, and non-sensitive checksums belong in GitHub.

## Current limitations

The first implementation provides:

- recursive deterministic inventory;
- SHA-256 hashing;
- exact-duplicate grouping;
- basic PNG, JPEG, and WebP dimension extraction;
- rights and retention controls;
- split-leakage validation;
- deterministic JSONL and manifest digest generation.

It does not yet provide:

- Google Drive API enumeration;
- EXIF normalization;
- HEIC/TIFF dimension decoding;
- perceptual hashing;
- front/back grouping;
- human annotation UI;
- immutable object-storage publication;
- Ohtani-18 selection and locked acceptance execution;
- accuracy or latency measurements.

Those remain separate, testable implementation milestones.
