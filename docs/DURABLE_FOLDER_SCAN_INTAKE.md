# Durable folder scan intake

## Objective

Replace browser-owned bulk retry loops with server-owned, authenticated, idempotent scan jobs.

This implementation addresses the failure mode where a large folder can process only a few images while the browser repeatedly retries requests. It does **not** claim that an unverified deployment, GPU worker, provider, or production storage system is live.

## Customer workflow

```text
Choose folder or drag and drop images
→ confirm processing rights
→ create one idempotent scan job
→ optimize and upload each image in bounded client concurrency
→ commit the complete upload set
→ process images in bounded server concurrency
→ poll durable progress
→ review completed and failed items
→ manually retry retained failed items when appropriate
```

The browser stores only the active job identifier in local storage. It does not store authentication tokens, image bytes, scan results, or private pricing data there.

## Supported formats

- JPEG
- PNG
- WebP

HEIC/HEIF is not represented as supported by this release. It requires a separately tested conversion path before it may be accepted.

## API

All routes require a verified ManeFlow user session. Service, API, and legacy administrator tokens are not accepted as substitutes for a customer session.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/scan-jobs` | Create or safely reuse an idempotent job |
| `GET` | `/api/scan-jobs` | List the signed-in user's jobs |
| `POST` | `/api/scan-jobs/:id/items` | Add or safely reuse one image item |
| `POST` | `/api/scan-jobs/:id/commit` | Close uploads and queue processing |
| `GET` | `/api/scan-jobs/:id` | Read owner-scoped progress and paginated items |
| `POST` | `/api/scan-jobs/:id/retry-failed` | Requeue retained failed payloads through the bounded policy |
| `POST` | `/api/scan-jobs/:id/cancel` | Cancel queued work without deleting completed evidence |

Mutations require allowed-origin validation and CSRF protection when cookie authentication is used.

## Idempotency

### Job boundary

The browser computes a non-identity batch key from:

- relative upload path;
- file byte size;
- file modification timestamp.

The key prevents the same selected folder batch from creating duplicate jobs during an accidental repeat submission. It is not used as card identity evidence.

### Item boundary

Each image receives an item key derived from the same upload metadata. Repeating an item upload returns the existing item rather than creating another scan.

### Payload integrity

The server calculates SHA-256 over decoded image bytes and verifies the stored payload hash before inference.

## Retry policy

There are two distinct retry boundaries.

### Browser-to-server upload

A single item upload receives at most one automatic network retry, and only for a network failure, rate limit, timeout, or server error. The browser does not recursively restart the folder.

### Server-side scan processing

The default maximum is two total attempts per image. A retry occurs only for evidence of a temporary failure, such as:

- timeout;
- connection reset;
- temporary provider failure;
- rate limit;
- HTTP 5xx response.

Unsupported input, validation failure, identity abstention, and other permanent outcomes do not create automatic retry storms.

## Processing concurrency

Defaults:

```text
client upload concurrency: 2
server scan concurrency: 2
maximum server attempts per image: 2
maximum images per job: 1,000
```

These are configuration defaults, not achieved performance benchmarks. Production values must be selected from load tests measuring throughput, queue depth, CPU/GPU utilization, memory, provider limits, and P95 latency.

## Persistence model

The current implementation stores each job in a private server directory:

```text
MANEFLOW_SCAN_JOB_DIR/
└── <job UUID>/
    ├── job.json
    └── payloads/
        └── <item UUID>.json
```

Writes use a temporary file and atomic rename. Directories and files are created with restrictive modes where the operating system supports them.

Successful item payloads are deleted after processing. Failed payloads remain available only through the configured retention window so an explicit owner-scoped retry may occur.

## Restart recovery

At startup, the server:

1. loads valid job manifests;
2. changes interrupted `processing` and `retry_wait` items to `queued`;
3. resumes queued jobs;
4. leaves terminal results unchanged;
5. removes expired terminal jobs according to retention policy.

Incomplete or invalid directories are ignored rather than guessed into a valid job.

## Image rights and training

Job creation requires explicit confirmation that the signed-in user owns the images or has permission to process them.

Training consent is separate and optional. Training consent alone does not automatically promote images into a training dataset. A permanent training artifact still requires:

- recorded provenance;
- rights review;
- ground-truth review;
- deduplication;
- split-integrity controls;
- benchmark approval;
- model-registry evidence.

Folder names and filenames are never final card identity evidence.

## Production release gate

Local development may use `.runtime/scan-jobs`.

Production refuses to start unless:

```text
MANEFLOW_SCAN_JOB_STORAGE_DURABLE=true
```

That flag may be enabled only after `MANEFLOW_SCAN_JOB_DIR` is mounted on private persistent storage and the following are verified:

- application restart recovery;
- deployment restart recovery;
- access controls;
- encryption in transit and at rest where applicable;
- retention and deletion;
- storage capacity alarms;
- backup and restore;
- rollback compatibility;
- no public object exposure;
- no cross-tenant access.

The flag is an operator attestation, not automatic proof. Deployment evidence must identify the exact mount, release commit, environment, and test run.

## Current limitations

- The implementation is a private persistent filesystem spool, not a horizontally distributed queue.
- Multiple application replicas must not share this spool without a verified lease/fencing design.
- Production object storage and a distributed worker queue remain separate infrastructure work.
- HEIC/HEIF conversion is not implemented here.
- GPU acceleration is used only when the configured vision worker actually selects and records a supported GPU execution provider.
- Recognition accuracy and throughput are unchanged until benchmark evidence proves otherwise.
- No live AppDeploy, Shopify, Meta, PSA, eBay, domain, or production environment is modified by this source change.

## Promotion path

The next scale step is to preserve the same API and state model while replacing local scheduling with:

```text
private object storage
+ PostgreSQL job/item records
+ durable queue
+ fenced worker leases
+ autoscaled CPU/GPU workers
+ dead-letter and replay controls
```

The current implementation deliberately fixes the browser retry storm first without claiming that distributed production infrastructure already exists.
