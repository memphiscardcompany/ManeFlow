# ManeFlow 2.14 Production Foundation

## Scope

ManeFlow 2.14 moves the application from a flat-file-only beta toward a transaction-safe, multi-tenant production architecture while preserving the existing tested business workflows.

## Data architecture

### PostgreSQL and pgvector

Migrations under `db/migrations/` create:

- shops and memberships
- canonical catalog cards
- 1152-dimensional front/back embeddings
- HNSW cosine indexes
- tenant-isolated inventory
- price evidence
- recognition jobs and evidence
- OAuth nonce records
- transactional compatibility application state

The migration runner records a SHA-256 checksum for every applied migration and takes a PostgreSQL advisory lock so two deployments cannot apply schema changes concurrently.

### Tenant boundary

Inventory and operational tenant tables use native PostgreSQL RLS. Each application transaction registers:

```sql
SELECT set_config('app.current_shop_id', $1, true);
```

The third argument makes the setting transaction-local. Runtime access uses a non-superuser, non-`BYPASSRLS` role. `FORCE ROW LEVEL SECURITY` prevents ordinary owner-role bypass.

### Staged state migration

The existing store API is preserved behind a PostgreSQL JSONB compatibility repository. This prevents a disruptive rewrite of every business workflow in one release while replacing local-file serialization with transactional updates. Domain tables become the source of truth incrementally.

## Recognition architecture

### Image isolation

The vision worker supports a learned detector interface and a conservative OpenCV fallback. Production recognition requires trained card-scene instance-segmentation weights. The fallback is retained for beta continuity and cannot support a universal-accuracy claim.

### Local OCR

The Node application includes an optional native local OCR service with:

- bounded queueing
- timeouts
- readiness reporting
- structured field parsing
- no cloud requirement
- clean disable/fallback behavior when the optional native module is unavailable

### Embeddings and search

The Python worker includes a 1152-dimensional ONNX image-embedding engine with provider selection for:

- TensorRT/CUDA
- CoreML
- DirectML
- OpenVINO
- CPU

Vectors are validated, normalized, transferred through a strict JSON contract, and searched through pgvector's HNSW index. Catalog/embedding writes use protected server-to-server APIs and transaction-safe repositories.

## Pricing integration

The Python lot worker no longer owns a competing pricing algorithm. It requests pricing from the canonical Node valuation engine through an authenticated internal contract. The Node engine retains completed-sale verification, title normalization, duplicate controls, IQR filtering, confidence thresholds, and abstention rules.

## Security upgrades

- Signed, actor-bound, expiring, one-time eBay OAuth state
- Replay rejection
- Service-token protection on internal pricing, vector, and catalog routes
- Provider secrets excluded from client bundles and release archives
- Secret-pattern scanning in the release gate
- Updated Electron runtime
- PostgreSQL RLS and restricted runtime role

## Deployment profiles

### Portable local beta

Runs the Node API and Python worker on the user's PC. JSON state is the default for ease of testing. PostgreSQL can be enabled separately.

### Docker production foundation

Runs PostgreSQL/pgvector, Redis, migrations, vision worker, and Node API as separate services. This profile still requires deployment-specific TLS, backups, monitoring, object storage, and secret management.

### Store builds

Electron and Expo projects are present, but signed public releases require external Microsoft, Apple, and Google credentials and review.

## Remaining external capability gates

The following are not source-code-only tasks and are not falsely marked complete:

1. Train and approve a card-scene instance-segmentation model.
2. Export and approve a rights-cleared 1152-D image encoder.
3. Ingest a licensed or otherwise authorized large catalog and reference-image corpus.
4. Run migrations and load testing against a managed PostgreSQL deployment.
5. Build a large human-labeled recognition benchmark.
6. Obtain code-signing and app-store distribution identities.
