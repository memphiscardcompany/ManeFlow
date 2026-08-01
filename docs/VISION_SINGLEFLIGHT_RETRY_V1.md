# Vision Single-Flight and Provider Retry V1

## Objective

Reduce duplicate scan work and make transient vision-worker capacity failures recover without restarting completed cards or reusing consumed multipart bodies.

## Behavior

For `scanDataUrl`:

1. Decode the data URL once.
2. Compute an in-process SHA-256 digest for single-flight coordination.
3. Share one active promise among concurrent identical scan requests.
4. Derive a scoped HMAC-SHA-256 idempotency key from the image bytes.
5. Send the HMAC value—not the raw image digest—across the worker boundary.
6. Rebuild multipart form data for each retry attempt.
7. Retry only transient `429`, `502`, `503`, and `504` responses.
8. Honor numeric or HTTP-date `Retry-After` values.
9. Apply a bounded shared cooldown to prevent concurrent retries from immediately hitting the same capacity limit.
10. Remove the single-flight entry after success or failure.

Completed results are not cached by this subsystem. Persistent, tenant-aware result caching remains separate work.

## Safety boundaries

- Default maximum retries: 2.
- Retry delays are capped at 15 seconds.
- Non-transient errors fail immediately.
- Other mutation endpoints are not automatically retried.
- Multipart request bodies are reconstructed for every attempt.
- Raw SHA-256 digests stay in process and are used only as request-coordination keys.
- The worker-facing idempotency value is an HMAC scoped by a process- or tenant-specific secret.
- Different scopes produce different idempotency values for identical image bytes.
- HMAC values and digests are coordination metadata, not card-identity evidence.
- No customer image bytes are written to logs or shared storage by this change.

## Tests

The focused test coverage verifies:

- numeric `Retry-After` parsing;
- HTTP-date `Retry-After` parsing;
- delay bounding;
- a fresh multipart body on retry;
- a stable scoped idempotency key across attempts;
- different idempotency scopes for identical image bytes;
- one worker request for concurrent identical scans;
- existing error and evidence-contract behavior.

## Claims boundary

This change can reduce duplicated concurrent work and improve recovery from temporary worker limits. It does not establish adaptive global concurrency, durable distributed single-flight, production throughput gains, recognition-accuracy gains, or deployment status. Those require protected load tests and an exact deployed artifact.
