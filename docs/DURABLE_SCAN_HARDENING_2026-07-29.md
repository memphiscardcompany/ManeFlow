# ManeFlow durable scan intake hardening — 2026-07-29

## Objective

Harden the server-owned folder intake merged through PR #12 without replacing its direct owner-scoped scan pipeline or claiming unmeasured recognition speed.

The merged implementation already established:

- authenticated server-owned jobs;
- atomic spool persistence and restart recovery;
- job and item idempotency;
- bounded browser uploads and server inference;
- strict attempt ceilings;
- account isolation, CSRF, origin checks, and mutation rate limiting;
- explicit processing authorization and separate optional training consent;
- drag-and-drop and folder-picker UI;
- production fail-closed storage attestation;
- verified GitHub Actions coverage.

This hardening layer addresses the remaining release risks discovered during reconciliation.

## Added controls

### Real file-signature validation

The API no longer trusts a data URL MIME label alone.

Accepted signatures:

- JPEG: `FF D8 FF`
- PNG: `89 50 4E 47 0D 0A 1A 0A`
- WebP: `RIFF....WEBP`

A payload whose bytes do not match its declared type fails with:

```text
415 SCAN_IMAGE_SIGNATURE_MISMATCH
```

The declared `mimeType`, data URL MIME type, and declared byte count must agree.

### Idempotency conflict detection

A repeated item key may be reused only when the SHA-256 of the new bytes matches the stored item.

The same key with different content fails with:

```text
409 SCAN_ITEM_ID_CONFLICT
```

This prevents a changed or corrupted image from being silently treated as an already uploaded item.

### Complete-manifest enforcement

`expectedItems` must be a positive integer within the configured job limit.

A job cannot enter processing until:

```text
stored item count == expectedItems
```

An incomplete folder returns:

```text
409 SCAN_JOB_UPLOAD_INCOMPLETE
```

The job remains in `accepting` state so reselecting the same folder can safely reuse completed uploads.

### Account-deletion cleanup

When account deletion succeeds, ManeFlow now:

1. cancels nonterminal jobs;
2. blocks further persistence for the deleted owner;
3. removes all owner job directories and retained payloads;
4. removes the jobs from the in-memory spool index.

This closes the privacy gap between the primary account store and the separate scan-job spool.

### Persistent container volume

The Compose foundation now mounts:

```text
maneflow_scan_jobs:/app/.runtime/scan-jobs
```

and sets:

```text
MANEFLOW_SCAN_JOB_DIR=/app/.runtime/scan-jobs
MANEFLOW_SCAN_JOB_STORAGE_DURABLE=true
```

The attestation is valid for this named persistent volume only after the actual host backup, restore, access-control, retention, deletion, and rollback behavior is tested. It is not evidence of a deployed production volume.

### Upload request timeout

The server request timeout is configurable through:

```text
MANEFLOW_HTTP_REQUEST_TIMEOUT_MS
```

Default: 180 seconds. Valid runtime range: 30–600 seconds.

This affects browser upload/API transport only. Vision processing remains a server-owned job and should not depend on a browser request staying open.

## Tests added

- MIME label versus byte-signature mismatch
- Same idempotency key with identical content
- Same idempotency key with conflicting content
- Incomplete manifest rejection
- Invalid expected-item counts
- Owner-spool deletion
- Signature-valid HTTP integration fixture

## Status

### Confirmed in source

- Hardening code is implemented on a dedicated review branch.
- The existing direct scan pipeline remains owner-scoped.
- Meta remains fail-closed.
- No provider secrets, customer images, or private prices were added.

### Requires CI

- Full Node/static/smoke/mobile/desktop verification
- CPU vision regression verification
- Packaging and secret scan
- PostgreSQL/pgvector integration when the workflow applies

### Requires deployment evidence

- Persistent volume restart test
- Backup and restore test
- Account deletion during active inference
- Browser refresh and folder re-selection
- Physical desktop/mobile browser coverage
- The owner-authorized 856-image endurance run
- Exact throughput, p50, p95, retry, and failure measurements
- Deployment at `app.memphiscardcompany.com`

No 100x speed, production readiness, accuracy improvement, or live deployment is claimed by this document.
