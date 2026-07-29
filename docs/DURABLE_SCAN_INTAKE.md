# ManeFlow durable high-volume scan intake

## Objective

Replace browser-bound sequential scanning and compounded retry behavior with an authenticated, server-owned intake job that can accept a folder, preserve progress, process images with bounded concurrency, and expose draft results incrementally.

This implementation addresses the observed failure mode in which a large browser folder processed only a few images while repeatedly retrying. It does not claim a measured 100x recognition-speed improvement. Throughput must be benchmarked on the exact hosted CPU/GPU deployment and image corpus.

## Customer flow

```text
Sign in
→ open /intake.html
→ drag a folder or choose images
→ browser creates a deterministic manifest
→ server creates or reuses an account-scoped job
→ images upload with stable item identifiers
→ server starts only after the complete manifest is stored
→ bounded workers call the canonical scan pipeline
→ draft results stream into the job record
→ user confirms, corrects, or leaves unresolved
```

Supported browser intake formats:

- JPEG
- PNG
- WebP

HEIC/HEIF remains dependent on a separately tested conversion path and is not accepted by this endpoint yet.

## Why the previous path stalled

The canonical `/api/scan` endpoint performs OCR, vision-worker inference, optional remote vision, vector retrieval, evidence fusion, market context, and persistence synchronously. The previous server request timeout was 30 seconds. A browser attempting hundreds of independent scans could therefore multiply temporary timeouts into repeated work.

The new job path changes the transport and orchestration boundary without replacing the tested recognition and pricing logic.

## API

All routes require an authenticated, email-verified ManeFlow account. Mutations enforce the normal origin and CSRF controls.

```text
GET    /api/scan-jobs
POST   /api/scan-jobs
GET    /api/scan-jobs/:jobId
GET    /api/scan-jobs/:jobId/items
POST   /api/scan-jobs/:jobId/items
POST   /api/scan-jobs/:jobId/start
POST   /api/scan-jobs/:jobId/cancel
```

### Create job

```json
{
  "clientJobId": "browser-folder-v1-<manifest-sha256>",
  "totalItems": 856,
  "autoStart": true
}
```

A repeated `clientJobId` for the same user returns the existing job instead of duplicating it.

### Upload item

```json
{
  "clientItemId": "image-v1-<stable-metadata-sha256>",
  "index": 42,
  "fileName": "Card Images/box-03/image-0043.jpg",
  "dataUrl": "data:image/jpeg;base64,..."
}
```

A repeated `clientItemId` with identical image bytes is reused. The same identifier with different bytes fails with `409 SCAN_ITEM_ID_CONFLICT`.

## Retry policy

There are two independent, bounded layers:

### Browser upload

- Maximum two retries after the initial request.
- Retries only network failures, HTTP 408, 425, 429, and 5xx responses.
- Uses exponential delay and respects a bounded `Retry-After` value.
- Permanent 4xx validation failures do not retry.

### Server processing

- Default maximum: two retries after the initial processing attempt.
- Retries only errors explicitly marked transient or HTTP 408, 409, 425, 429, and 5xx conditions.
- Default backoff: 750 ms, 1.5 s.
- A permanent image/provider rejection becomes one terminal failed item rather than a retry storm.

## Job integrity and recovery

- JPEG, PNG, and WebP MIME types are checked against file signatures.
- Every stored upload receives SHA-256 verification before processing.
- Source files are written through a private temporary file and atomic rename.
- File and directory permissions are restricted where supported.
- `processing` jobs and items return to `queued` after a server restart.
- The server refuses to start an incomplete manifest.
- Cancelling aborts in-flight work and marks remaining items cancelled without deleting completed drafts.
- Source uploads are deleted after terminal item processing unless an explicit retention policy enables retention.
- Account deletion cancels owned jobs, removes job metadata, and removes the account’s remaining source directory.

## Resource controls

Default configuration:

```text
MANEFLOW_HTTP_REQUEST_TIMEOUT_MS=180000
MANEFLOW_SCAN_JOB_MAX_ITEMS=2000
MANEFLOW_SCAN_JOB_MAX_IMAGE_BYTES=30000000
MANEFLOW_SCAN_JOB_CONCURRENT_JOBS=1
MANEFLOW_SCAN_JOB_CONCURRENT_ITEMS=2
MANEFLOW_SCAN_JOB_MAX_RETRIES=2
MANEFLOW_SCAN_JOB_RETRY_BASE_DELAY_MS=750
MANEFLOW_SCAN_JOB_RETAIN_UPLOADS=false
```

These are safe starting controls, not verified optimal production values. Increase concurrency only after measuring CPU, GPU, RAM, VRAM, provider rate limits, queue latency, and p95 processing latency.

There is no 15-card application limit. The 2,000-image job ceiling is an abuse and resource guard. It does not silently truncate a job: excess selection is rejected before upload.

## Persistence boundary

Job metadata is stored through ManeFlow’s selected state store. In PostgreSQL mode, this uses the existing transactional compatibility state while normalized job tables are completed.

Source image bytes currently use a private server filesystem directory. Hosted deployments must mount a persistent private volume at `MANEFLOW_SCAN_JOB_UPLOAD_DIR`. The Docker Compose foundation now includes `maneflow_scan_jobs` for that purpose.

This filesystem implementation is not a substitute for production private object storage across horizontally scaled API and worker nodes. Before multi-node or high-availability production release, replace it with an encrypted, private S3-compatible object-storage adapter using short-lived access and lifecycle deletion.

## Security boundaries

- Public or guest job creation is denied.
- Job lookup returns `404` across user boundaries.
- Browser-provided user IDs are ignored.
- The internal worker requires `MANEFLOW_SERVICE_TOKEN` from the deployment secret manager.
- Real tokens and provider credentials are never stored in source or returned through job APIs.
- Results remain draft and do not automatically save, list, message, price, buy, sell, or grade a card.
- Images are excluded from training unless a separate authorization and data-governance record permits it.

## Performance expectations

This change should materially reduce wasted work, browser timeout coupling, and duplicate retries. It also allows the upload phase and processing phase to proceed independently.

It does not by itself guarantee:

- 100x faster exact identification
- GPU execution
- better recognition accuracy
- universal catalog coverage
- live completed-sale pricing
- production-scale multi-user capacity

Those require the trained detector, rights-cleared catalog and embedding index, operational OCR, cloud GPU workers where beneficial, provider validation, and locked real-image benchmarks already defined by the broader ManeFlow vision architecture.

## Release gates

Before deployment:

1. Exact branch CI passes Node, static, secret, packaging, mobile, desktop, and CPU-vision gates.
2. PostgreSQL/pgvector migration CI passes.
3. A persistent private volume is provisioned and backup behavior is documented.
4. `MANEFLOW_SERVICE_TOKEN` is set only in the deployment secret manager.
5. Browser tests cover folder selection, directory drag/drop, interrupted upload, reselect-and-resume, cancellation, and account isolation.
6. A staged endurance test processes at least the intended 856-image owner-authorized folder with exact request, retry, failure, and latency evidence.
7. No production performance claim is published before that evidence exists.

## Current implementation status

### Implemented in source

- Server-owned queue
- Resumable/idempotent manifests and items
- Bounded upload and processing retries
- Private temporary file handling
- Restart recovery
- Cancellation
- Account isolation
- Account-deletion cleanup
- Progressive job/result API
- Browser folder selection and recursive Chrome directory drag/drop
- Persistent Docker volume foundation

### Requires external verification

- Exact 856-image endurance result
- Hosted persistent-volume behavior
- Physical iPhone/Android browser behavior
- Multi-instance object-storage execution
- Production GPU throughput
- Production provider latency and quotas
- Deployment at `app.memphiscardcompany.com`
