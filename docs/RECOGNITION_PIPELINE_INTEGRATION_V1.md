# Recognition Pipeline Integration V1

Status: Experimental, feature-flagged, not deployed

Version: `recognition-pipeline-v1.0`

## Purpose

`src/services/recognition-pipeline.js` is the single integration boundary for the existing recognition engine, the evidence-bounded scene router, and the image-quality gate.

It prevents production callers from wiring these subsystems together differently and provides a rollback-safe path to staged activation.

## Feature flag

Dedicated routing is disabled by default.

Enable for controlled tests with either:

```text
MANEFLOW_DEDICATED_RECOGNITION_ROUTING=true
```

or the per-call option:

```js
runRecognitionPipeline({
  featureFlags: { dedicatedRecognitionRouting: true },
  // existing recognition input
});
```

When disabled, the wrapper returns the existing `recognizeCardScene` result unchanged under `recognition` and reports `mode: legacy_safe_fallback`.

## Safety behavior

When enabled:

1. Detector and scene evidence are normalized for the scene router.
2. No-card, collection-overview, and uncertain routes create no card record.
3. Region quality is evaluated before an exact result is accepted.
4. Insufficient or non-fast quality prevents exact acceptance and requires review.
5. Existing evidence-ledger, selective-decision, correction, and candidate logic remains authoritative.
6. Pricing is not enabled by this integration.

## Claims boundary

This integration does not prove:

- a trained detector;
- improved exact-card accuracy;
- improved parallel accuracy;
- real-image latency improvement;
- AppDeploy source equivalence;
- live deployment.

It creates one tested orchestration contract required before those capabilities can be promoted.

## Required next validation

- Full GitHub `Verify ManeFlow` workflow.
- Real detector-output fixtures.
- Binder, dense-scene, slab, raw-card, partial-card, overview, and unrelated-image benchmark cases.
- Feature-flag shadow comparison against the existing pipeline.
- Physical iPhone Safari testing after deployment to staging.
- Exact commit and rollback metadata for any production activation.
