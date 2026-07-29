# ManeFlow durable scan intake hardening — 2026-07-29

## Objective

Harden the server-owned folder intake merged through PR #12 without replacing its direct owner-scoped scan pipeline or claiming unmeasured recognition speed.

## Added controls

### Real file-signature validation

The API no longer trusts a data URL MIME label alone. JPEG, PNG, and WebP bytes must match their declared formats. Declared MIME type and byte count must agree with the encoded payload.

### Idempotency conflict detection

A repeated item key is reused only when the new payload has the same SHA-256 as the stored item. The same key with different image content fails with `409 SCAN_ITEM_ID_CONFLICT`.

### Complete-manifest enforcement

`expectedItems` must be a positive integer within the configured job ceiling. A job cannot enter processing until its stored item count exactly equals the declared manifest. An incomplete folder returns `409 SCAN_JOB_UPLOAD_INCOMPLETE` and remains resumable.

### Account-deletion cleanup

After account deletion succeeds, ManeFlow cancels unfinished owner jobs, prevents further persistence for the deleted owner, removes the owner’s private spool directories, and removes the jobs from the spool index.

### Upload request timeout

`MANEFLOW_HTTP_REQUEST_TIMEOUT_MS` controls the HTTP upload/request timeout with a 30–600 second bounded range and a 180-second default. Vision processing remains server owned and does not depend on the browser request remaining open.

## Preserved controls

- authenticated real-user sessions;
- CSRF and origin validation;
- mutation rate limiting;
- explicit image-processing authorization;
- separate optional training consent;
- owner-scoped job access;
- bounded browser and server concurrency;
- bounded transient retries;
- atomic spool persistence and restart recovery;
- direct owner-scoped scan-pipeline execution;
- fail-closed Meta boundaries;
- DRAFT-only recognition results.

## Tests added or updated

- MIME label versus real byte-signature mismatch;
- identical idempotency key and identical content reuse;
- same item key and conflicting content rejection;
- incomplete manifest rejection;
- zero, fractional, and over-limit manifest counts;
- owner job/payload deletion;
- signature-valid HTTP integration fixture.

## Release status

This source change does not prove a hosted deployment, backup/restore, physical-device behavior, production GPU throughput, provider quotas, the 856-image endurance result, or deployment at `app.memphiscardcompany.com`. Those remain release gates and must be reported with exact evidence rather than inferred from source code.
