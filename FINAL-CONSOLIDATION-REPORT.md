# ManeFlow Final Consolidation Report

## Consolidated inputs

This build was assembled from the accessible local ManeFlow release archives and project information, including:

- ManeFlow v2.18 ready-to-install Windows source as the stable base
- Later Windows Store release-candidate assets
- Historical ManeFlow requirements and architecture from the project conversation context
- Existing Electron, Expo, Node, FastAPI, PostgreSQL/pgvector, PSA, eBay, pricing, inventory, and bulk-intake implementations
- The most recent eight accessible screenshots from the local screenshots collection, which confirmed the local source-package structure, provider setup state, Python dependency installation, and the desktop offline failure screen
- Owner-authorized card images already available in the workspace

The GitHub connector returned no accessible repositories. Therefore, no claim is made that an unseen GitHub repository was imported. The screenshots confirmed that source packages existed on the computer, and the accessible local archives were used as the source of truth.

## Major consolidation work

### Recognition

- Added zero-input identity decisions: Exact, Likely, or Unresolved
- Removed filename and upload-order identity leakage
- Added match-score gap handling so saturated confidence values do not block valid evidence separation
- Preserved conservative unknown rejection

### Any-order folders

- Added `/v1/intake/photos/import-folder`
- Added Node proxy and desktop UI workflow
- Added order-invariant SHA-based analysis scheduling
- Added front/back/unknown view selection
- Added content-hash, cert, serial, identity, capture-time, and adaptive visual grouping
- Preserved all additional foil/refractor angles as evidence

### Adaptive learning

- Added owner-authorized manifest ingestion
- Added Hugging Face collector with fail-closed license routing
- Added automatic identity-resolution gate
- Added self-supervised multi-view calibration
- Added adaptive learning daemon that skips empty/unchanged corpora
- Added strict reference promotion and external-trainer promotion gates
- Integrated the learning monitor into Windows startup and shutdown

### Reliability

- Added offline recovery UI
- Synchronized core, mobile, desktop, CI, API, and configuration versions
- Preserved secrets outside release archives
- Removed Ohtani-specific benchmark/training schedules

## Current learning state

- Eligible owner-authorized images: 20
- Verified exact identity labels: 0
- Provisional automatic labels: 0
- Multi-view grouping calibration: trained and active
- Neural model weights changed: no
- Reference memory changed: no
- Empty/unchanged training cycles: skipped automatically

This is real improvement to the photo-grouping subsystem, but it is not represented as a newly trained universal card-identification model.

## Test results

- Node: 204 passed, 0 failed
- Python: 58 passed, 0 failed
- Configuration validation: passed
- Smoke test: passed
- Mobile check: passed
- Desktop check: passed
- Secret scan: passed

## Release position

ManeFlow 2.22.0-beta.1 is a consolidated private-beta engineering release. It is ready for local Windows testing and owner-photo ingestion. Commercial universal-recognition claims remain blocked until a large rights-cleared catalog, verified labels, external model training, and a locked benchmark are completed.
