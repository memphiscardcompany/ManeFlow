# ManeFlow 2.22.0-beta.1 Consolidated Release Notes

## Purpose

This release consolidates the strongest available ManeFlow local source packages, project requirements, historical design decisions, mobile/desktop work, and the latest accessible screenshots into one Windows/mobile/web beta codebase.

## Zero-input recognition workflow

The collector supplies card photographs only. ManeFlow automatically performs card detection, crop/rectification, raw-versus-slab analysis, front/back/unknown classification, OCR and visible-text extraction, local/reference retrieval, PSA cert verification when available, candidate ranking, and Exact/Likely/Unresolved confidence gating.

Camera filenames, UUIDs, upload order, and folder position are never identity evidence.

## Any-order photo folders

The new phone/camera intake accepts fronts, backs, and additional foil/refractor angles in any file order. It groups views using, in priority order:

1. Exact image content hashes
2. PSA certification numbers
3. Unique serial-number and identity agreement
4. Conservative visual evidence supported by original capture timestamps
5. Calibrated local-feature/homography evidence for angle and glare changes
6. High-confidence opposite-side identity agreement

Ambiguous images remain separate rather than being silently merged. Two pristine copies of the same unnumbered card may be visually indistinguishable; ManeFlow keeps grouping conservative when physical-copy evidence is insufficient.

## Adaptive learning now active

Twenty owner-authorized historical images were prepared as the initial rights-cleared corpus. ManeFlow completed a self-supervised synthetic-view calibration for any-order multi-view grouping:

- Owner images: 20
- Positive transformed-view pairs: 80
- Negative cross-image pairs: 190
- Calibration true-positive rate on generated pairs: 98.75%
- Calibration false-positive rate on generated pairs: 0%
- User identity labels used: 0

These are calibration-set measurements, not universal card-identification accuracy claims.

The background adaptive-learning monitor:

- Runs only when the owner manifest changes
- Skips empty and unchanged corpora
- Recalibrates multi-view grouping
- Attempts automatic OCR/vision/PSA identity resolution
- Promotes only strict verified labels to reference memory
- Runs the model-training gate only when enough verified labels and a configured trainer exist
- Requires a locked benchmark before any production model promotion

At release time, 20 images are eligible, zero exact identity labels have passed the strict verification gate, and neural model weights have not changed. The grouping calibration has changed and is active.

## Rights and privacy

Allowed:

- Owner-authorized original card photos
- Explicitly licensed commercial-training sources
- Automatically derived crops, OCR, embeddings, and synthetic transformations from those sources

Blocked:

- eBay listing images/content for AI training
- Noncommercial datasets in the commercial reference split
- Private pricing, cost basis, customer records, seller notes, and inventory strategy
- Unverified pseudo-labels as exact training truth

## Offline recovery

The desktop UI no longer collapses to a blank generic failure screen when local services are unavailable. It shows a local recovery screen with retry, home, photo-intake, diagnostics, and reload actions while preserving local data.

## Platform versions

- Core: 2.22.0-beta.1
- Electron: 2.22.0-beta.1
- Expo package: 2.22.0-beta.1
- Expo app version: 2.22.0

## Verification

- 204/204 Node tests passed
- 58/58 Python tests passed
- JavaScript/JSON/release validation passed
- Core smoke test passed
- Mobile Expo configuration passed
- Electron configuration passed
- Credential-pattern scan passed

## Remaining external gates

- Large rights-cleared exact-identity corpus
- Production segmentation and embedding model artifacts
- External GPU trainer/model registry
- Locked human-audited accuracy benchmark at meaningful scale
- Physical Ricoh/phone fleet validation
- Managed PostgreSQL production execution
- Code signing and store publication
