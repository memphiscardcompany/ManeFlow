# ManeFlow 2.22.0-beta.1

ManeFlow is Memphis Card Company's unified card-intelligence platform for collectors, dealers, and card shops. This release preserves the complete ManeFlow v2.5 business interface while adding the production database, local OCR, vector-search, imaging, bulk-intake, market-provider, and security foundations developed afterward.

## Fastest Windows beta test

1. Extract the entire ZIP to a normal writable folder.
2. Install Node.js 22 LTS and Python 3.11 or 3.12.
3. Double-click `Configure-ManeFlow.cmd` once.
4. Double-click `Start-ManeFlow.cmd`.
5. The first start creates an isolated Python environment and installs vision dependencies.
6. ManeFlow opens at `http://127.0.0.1:4321`.
7. Use `Stop-ManeFlow.cmd` before moving or deleting the folder.

The portable ZIP avoids the unknown-publisher online bootstrap that was used in an earlier test. A signed Windows installer still requires a Windows signing identity and Windows build runner.

## Major consolidated capabilities

### PostgreSQL, tenancy, and vector retrieval

- PostgreSQL 15+ production schema
- pgvector `vector(1152)` front/back embeddings
- HNSW cosine indexes
- Transaction-local shop context using `app.current_shop_id`
- `ENABLE` and `FORCE ROW LEVEL SECURITY`
- Runtime role configured without `BYPASSRLS`
- Transaction-safe catalog and embedding upserts
- Approximate nearest-neighbor visual retrieval with `<=>`
- Transactional compatibility state store for staged migration away from flat files
- Versioned migration runner with checksums and an advisory lock

Run PostgreSQL migrations:

```bash
npm install --omit=optional
npm run db:migrate
npm run db:verify
```

Set `STORAGE_MODE=postgres` only after migration and verification succeed.

### Recognition and imaging

- Any-order phone/camera folder intake: upload one folder without renaming or sequencing files
- Automatic front/back/angle classification and physical-card grouping
- EXIF capture time is a weak grouping signal; upload order and filenames are never identity evidence
- Owner-corpus-calibrated multi-view matching for foil/refractor angle changes
- Exact / Likely / Unresolved confidence outcomes with safe abstention

- Single cards, slabs, toploaders, one-touches, packs, stacks, and mixed scenes
- Multi-card and eBay-lot image analysis
- Perspective rectification and image-quality gates
- Ricoh duplex intake and front/back pairing
- Barcode and cert evidence
- PSA verification adapter
- Parallel/refractor surface-family evidence
- Centering and visible edge/corner wear estimates
- Separate detection, identity, variant, image-quality, and pricing confidence
- Safe abstention rather than invented identity or price

A trained instance-segmentation model can be supplied with `CARD_DETECTOR_MODEL_PATH`. Without trained weights, ManeFlow uses the conservative OpenCV fallback and must not be marketed as a production universal detector.

### Local OCR and embeddings

- Optional local `@arcships/light-ocr` adapter
- Structured OCR field parser for names, set/card numbers, certs, grades, and serial evidence
- OCR readiness endpoint and timeout/queue controls
- 1152-dimensional local ONNX embedding engine
- TensorRT/CUDA, CoreML, DirectML, OpenVINO, and CPU provider selection with safe fallback
- Strict shared JSON contract between Node.js and Python
- Protected catalog and embedding ingestion endpoints

The ONNX model itself is not distributed in source packages. Configure a rights-cleared model through `MANEFLOW_EMBEDDING_MODEL_PATH`. After the normal beta starts successfully, `Install-ManeFlow-Accelerators.cmd` can install the CUDA, DirectML, or CPU ML runtime profile.


### Rights-gated adaptive learning

- Owner-authorized photos enter a commercial-use-safe learning manifest automatically
- A background learning monitor runs only when the owner corpus changes
- Self-supervised synthetic-view calibration improves any-order multi-view grouping without user labels
- Automatic OCR/vision/cert resolution attempts identity labels; only strict verified evidence enters reference memory
- eBay and other marketplace images remain excluded from training
- Empty or unchanged corpora are skipped, so ManeFlow does not claim progress from no data
- Neural model promotion remains blocked until verified labels, an external trainer, and a locked benchmark are available

Run one learning cycle manually:

```bash
npm run training:cycle
```

View the current state:

```bash
npm run training:status
```

### Pricing and providers

- Canonical Node valuation engine connected to the Python lot worker
- Completed-sale comps separated from active asking prices
- Listing-title spam scrubber and strict card-number/grade checks
- IQR outlier controls and price abstention
- eBay Browse active-listing context
- eBay seller OAuth, refresh-token support, order import, and signed one-time OAuth state
- JustTCG SDK/REST market context
- SportsCardsPro guide/catalog context
- PSA cert verification

JustTCG and SportsCardsPro guide values remain distinct from verified completed-sale comps. Leave `EBAY_MARKETPLACE_INSIGHTS_ENABLED=false` unless eBay explicitly grants that restricted API.

### Shop, collection, and bulk operations

- Vault and collection management
- Shop inventory, roles, and permissions
- Grading and consignment workflows
- Dealer cash/list recommendations
- Portfolio intelligence
- Batch review and corrections
- Permissioned recognition-data contribution
- Owner curation and stable train/validation/test manifests
- Private costs, seller details, and pricing strategy excluded from learning exports


## External production-gate tools

ManeFlow 2.15 includes executable tooling for every remaining external gate:

- `npm run vision:dataset:seed` — prepare a reviewed Roboflow seed dataset
- `npm run vision:segmentation:evaluate` — evaluate segmentation masks
- `npm run vision:encoder:export` — export and validate the approved 1,152-D encoder
- `npm run catalog:import:ndjson` — ingest authorized catalog/reference records
- `npm run db:migrate`, `db:verify`, and `db:test:rls` — execute database gates
- `npm run vision:ricoh:benchmark` — measure a physical Ricoh batch
- `npm run vision:gate` — enforce labeled accuracy and latency thresholds
- `npm run store:external-gates` — report signing and store-account readiness

See `docs/RELEASE_NOTES_2.22.0_BETA_1.md` and `FINAL-CONSOLIDATION-REPORT.md` for the consolidated release scope and remaining external gates.

## Complete local verification

```bash
npm run verify:beta
```

The release gate runs:

- JavaScript syntax/configuration validation
- Secret-pattern scan
- Node core and API regression tests
- Live core smoke test
- Python vision tests
- Node-to-FastAPI integration test
- Ricoh intake and learning-data integration test
- Mobile configuration check
- Electron desktop configuration check

## Docker production-foundation stack

The included `docker-compose.yml` starts:

- PostgreSQL with pgvector
- Redis
- Versioned database migration job
- Python vision worker
- ManeFlow Node API

Copy `.env.example` to `.env`, generate strong service/admin/OAuth secrets, then run:

```bash
docker compose up --build
```

This stack is a production foundation, not a managed public launch. Public deployment still requires TLS, backups, monitoring, object storage, signing, privacy/legal configuration, and store review.

## Desktop and mobile projects

- Electron desktop: `apps/desktop-electron`
- Expo mobile: `apps/mobile-expo`
- Windows CI build: `.github/workflows/windows-beta-build.yml`

The Windows workflow produces an NSIS installer, portable executable, and SHA-256 checksums on a Windows runner after all gates pass. Microsoft Store, Apple App Store, and Google Play publishing require the owner's external signing identities, store accounts, legal metadata, and review approval.

## Credentials

Provider credentials are server-side configuration. The source package and release archives contain no provider secrets. The portable beta reads a local `.env`; the Electron shell can store credentials with operating-system secure storage.

See:

- `START-HERE.txt`
- `docs/RELEASE_NOTES_2.22.0_BETA_1.md`
- `FINAL-CONSOLIDATION-REPORT.md`
- `docs/PRODUCTION_UPGRADE_2.14.md`
- `docs/BETA_TESTING_RUNBOOK.md`
- `docs/RICOH_BETA_AND_LEARNING_DATA.md`
## Roboflow card-scene model

ManeFlow 2.15 adds a private Roboflow instance-segmentation adapter and dataset/evaluation tools.
See `docs/ROBOFLOW_MODEL_GATE.md`. The Roboflow key and exact model endpoint are server-side
configuration and are never included in release archives.


- `docs/RECOGNITION_BENCHMARK_RESULTS_2.16.md`
