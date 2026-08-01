# Vision Single-Flight and Provider Retry V1

## Objective

Reduce duplicate scan work and make transient vision-worker capacity failures recover without restarting completed cards or reusing consumed multipart bodies.

## Behavior

For `scanDataUrl`:

1. Decode the data URL once.
2. Compute a SHA-256 digest of the image bytes.
3. Use the digest as an in-process single-flight key.
4. Share one active promise among concurrent identical scan requests.
5. Attach the digest as an idempotency key for the worker boundary.
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
- SHA-256 digests are used as request coordination keys, not identity evidence.
- No customer image bytes are written to logs or shared storage by this change.

## Tests

The focused test coverage verifies:

- numeric `Retry-After` parsing;
- HTTP-date `Retry-After` parsing;
- delay bounding;
- a fresh multipart body on retry;
- stable idempotency key across attempts;
- one worker request for concurrent identical scans;
- existing error and evidence-contract behavior.

## Claims boundary

This change can reduce duplicated concurrent work and improve recovery from temporary worker limits. It does not establish adaptive global concurrency, durable distributed single-flight, production throughput gains, recognition-accuracy gains, or deployment status. Those require protected load tests and an exact deployed artifact.
