# ManeFlow 2.14.0-beta.1 Release Notes

## Release objective

Preserve the complete ManeFlow product while replacing the weakest infrastructure layers identified during the 2.13 audit: flat-file-only storage, absent vector retrieval, cloud-dependent text extraction, disconnected lot pricing, and unsafe OAuth state handling.

## Added

### Database and tenancy

- PostgreSQL 15+ schema and migration runner
- pgvector 1152-dimensional card embeddings
- HNSW cosine indexes for front and back references
- Row-Level Security for shop-owned inventory and operational data
- Non-`BYPASSRLS` application role
- Transaction-safe inventory vector repository
- Transaction-safe catalog and embedding repositories
- Protected catalog/embedding batch-ingestion API
- Transactional PostgreSQL compatibility state store
- Schema verification command

### Recognition and OCR

- Shared versioned Node/Python vision contract
- Optional local native OCR adapter and structured card-field parser
- OCR readiness endpoint and safe fallback
- Local 1152-dimensional ONNX embedding engine
- TensorRT/CUDA, CoreML, DirectML, OpenVINO, and CPU provider selection
- Embedding normalization and contract validation
- pgvector candidate retrieval in the scan workflow

### Pricing and lots

- Authenticated Python-to-Node pricing bridge
- Canonical valuation engine used for lot-item pricing
- Safe unpriced result when identity or completed-sale evidence is insufficient

### eBay security

- Signed OAuth state
- Actor binding
- State expiration
- One-time consumption
- Replay protection
- Equivalent protection in the Electron seller-connect workflow

### Deployment

- pgvector/Redis/vision/API Docker Compose stack
- Versioned migration container
- Hardened service definitions
- Windows workflow updated for 2.14
- Electron runtime upgraded

## Preserved

- ManeFlow v2.5 interface and tested business workflows
- Vault and collection management
- Shop inventory and permissions
- Grading and consignment
- Dealer offers and listing recommendations
- Ricoh intake and front/back pairing
- eBay lot analysis
- Provider integrations
- Correction and permissioned learning-data workflows
- Conservative price and identity abstention

## Verification

- 188/188 Node tests passed
- 47/47 Python vision tests passed
- Core smoke test passed
- Integrated Node/FastAPI/Ricoh/curation test passed
- Mobile and desktop configuration checks passed
- Credential-pattern scan passed

## Beta boundary

This release contains production adapters and contracts, not proprietary model weights or a million-card image catalog. The learned detector and 1152-D ONNX embedding engine become active only when approved model files are configured. Public store distribution also requires external signing and store-review credentials.
