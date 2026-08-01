# Adaptive Vision Batch Processing V1

## Objective

Provide a canonical server-side batch primitive that processes multiple scan sources concurrently, adapts to transient capacity pressure, preserves every source, and emits progressive source-of-truth counters.

This implementation does not replace the detector, identity engine, or UI. It gives those systems a reliable orchestration contract.

## Default policy

```text
initial concurrency: 4
minimum concurrency: 1
maximum concurrency: 8
healthy completion window: 20
```

Healthy windows increase concurrency additively by one. Transient capacity faults and explicit memory-pressure signals reduce concurrency multiplicatively by half, bounded by the minimum.

Transient classes include:

```text
408
425
429
502
503
504
timeouts
connection resets
```

The existing scan-level retry policy remains responsible for bounded retries and `Retry-After`. The adaptive controller receives transient-fault notifications so the next sources are launched at lower concurrency rather than continuing at the previous pressure level.

## Source states

Each input source receives one immutable source ID and exactly one terminal state:

```text
detected
review_required
insufficient_evidence
rejected_no_card
failed_retryable
failed_permanent
canceled
```

In-progress states are:

```text
queued
processing
```

The scheduler never removes an item from accounting because detection, OCR, identity, or a provider failed.

## Summary invariants

Every progress and completion summary exposes:

```text
source_image_count
processed_count
active_count
queued_count
detected_count
review_required_count
insufficient_evidence_count
rejected_count
failed_count
retryable_failed_count
permanent_failed_count
canceled_count
unresolved_count
silently_dropped_sources
scene_complete
```

Required invariants:

```text
processed_count + active_count + queued_count == source_image_count
silently_dropped_sources == 0
scene_complete == (processed_count == source_image_count)
```

Source-image count remains distinct from card-region count. A binder page may be one source with several card regions.

## VisionWorkerClient integration

`VisionWorkerClient.scanDataUrls()` accepts strings or objects containing:

```json
{
  "sourceId": "stable-source-id",
  "filename": "card.jpg",
  "dataUrl": "data:image/jpeg;base64,..."
}
```

It uses the existing single-image scan endpoint, scan single-flight, scoped idempotency, provider-aware retry, and result-contract validation. It classifies worker output conservatively:

- detector-confirmed source with strong identity evidence: `detected`;
- detector-confirmed source without sufficient identity evidence: `review_required`;
- identity evidence without detector count: `review_required`;
- explicit no-card response: `rejected_no_card`;
- no physical-card or identity evidence: `insufficient_evidence`.

This classification does not promote an exact card identity. It only assigns a source processing state.

## Cancellation

A `shouldStop` callback implements stop-after-current behavior:

1. Active work finishes.
2. No additional source begins.
3. Remaining queued sources become `canceled`.
4. Completed results remain intact.
5. The batch still reaches `scene_complete=true` with no silent drops.

## Claims boundary

This implementation establishes orchestration contracts and automated behavior tests. It does not prove:

- faster production scans;
- improved detector recall;
- improved exact-card identity;
- stable operation at eight workers;
- distributed scheduling;
- multi-instance backpressure;
- live AppDeploy or Shopify activation.

Those claims require production-equivalent load tests, protected image benchmarks, exact artifact deployment, and physical-device validation.
