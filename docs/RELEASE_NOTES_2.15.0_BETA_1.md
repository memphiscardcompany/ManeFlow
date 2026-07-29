# ManeFlow 2.15.0-beta.1 Release Notes

## Release purpose

This release implements the repository-side work for the eight external production gates identified by the ManeFlow Development Roadmap. External artifacts, hardware, accounts, and approvals are not falsely represented as complete.

## 1. Trained instance-segmentation gate

Added:

- Private Roboflow instance-segmentation adapter
- Server-side endpoint and key handling
- Local learned model → Roboflow → classical fallback routing
- Strict fail-closed Roboflow mode
- Polygon/class normalization into ManeFlow's detection contract
- COCO seed-dataset builder with deterministic group-aware splits
- Negative-image support
- Segmentation evaluation for precision, recall, F1, per-class results, latency, and failures
- Versioned model manifest schema

External action still required: label, train, review, and approve the private Roboflow model before enabling it as authoritative.

## 2. Licensed 1,152-dimensional encoder gate

Added:

- SigLIP 2 So400m fixed-resolution ONNX export tool
- Dynamic batch axis
- 1,152-dimensional normalized output validation
- ONNX model checking and parity comparison
- License, source, checksum, and preprocessing manifest
- Local ONNX Runtime provider selection for TensorRT, CUDA, Core ML, DirectML, OpenVINO, and CPU

External action still required: download/export the approved model artifact, verify licensing, benchmark it, and install it in the protected model directory.

## 3. Authorized large-scale catalog gate

Added:

- Catalog reference-image rights registry
- Embedding work queue with leases, retries, and status
- Catalog synchronization jobs
- Atomic card/reference/job batch ingestion
- Streaming NDJSON importer
- Resumable checkpoints and source-file SHA-256
- Transaction rollback on any reference or queue failure

External action still required: obtain and ingest authorized catalog/reference sources. ManeFlow does not scrape or redistribute unauthorized image libraries.

## 4. Live PostgreSQL validation gate

Added:

- Versioned production migrations through migration 004
- pgvector `vector(1152)` storage and HNSW cosine search
- Forced RLS and restricted runtime role
- Live schema/HNSW/RLS verification
- Cross-tenant RLS and vector-query integration test
- GitHub Actions PostgreSQL/pgvector service workflow

External action still required: execute the migration and load tests against the selected managed production database.

## 5. Ricoh hardware gate

Added:

- Physical-folder benchmark tool
- Front/back pairing coverage measurement
- Decode, resolution, DPI, blur, glare, exposure, and quality measurements
- Duplicate and identical front/back detection
- Optional detector latency measurement
- Physical cards-per-minute calculation
- JSON and CSV evidence output
- 25/250/1,000-card hardware validation runbook

External action still required: perform the documented physical runs on the target Ricoh scanner and computer.

## 6. Human-labeled benchmark gate

Added:

- Versioned benchmark manifest schema
- Integrity-checked evidence files
- `private_beta`, `production`, and `superiority_claim` profiles
- Required metrics for detection, slab/cert, segmentation, identity, variants, false confidence, duplicate grouping, and latency
- Release-blocking scorer with explicit failures
- Head-to-head requirement before any named competitor superiority claim

External action still required: build the labeled corpus. The superiority profile requires at least 10,000 human-labeled images plus a contemporaneous identical-input comparison.

## 7. Windows code-signing gate

Added:

- Signed Windows release workflow
- `forceCodeSigning` build path
- Certificate-secret checks
- Authenticode publisher and timestamp verification
- Optional Microsoft Store AppX build
- SHA-256 generation
- Certificate and Azure Trusted Signing documentation

External action still required: obtain an approved Memphis Card Company LLC signing identity and configure protected CI secrets.

## 8. Microsoft, Apple, and Google publication gate

Added:

- EAS production build/submission workflow for iOS and Android
- Signed Microsoft Store package path
- External release-state manifest and checker
- HTTPS, privacy, terms, support, signing, testing, and review checklist
- Explicit rule that artifact creation is not store approval

External action still required: activate developer identities, create store records, configure credentials, deploy production infrastructure, complete disclosures, and pass platform review.

## Verification

- 155 JavaScript/configuration files validated
- 194/194 Node tests passed
- 50/50 Python vision tests passed
- Core smoke test passed
- Node-to-FastAPI integration passed
- Ricoh intake/consent/curation integration passed
- Ricoh benchmark tool smoke-tested on a complete front/back pair
- Mobile configuration passed
- Electron desktop configuration passed
- Store metadata validation passed
- Credential scan passed

This build remains a private engineering beta until the external model, catalog, database, hardware, benchmark, signing, and store gates are completed with real evidence.
