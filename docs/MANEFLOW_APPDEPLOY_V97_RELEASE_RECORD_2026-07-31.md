# ManeFlow AppDeploy v97 release record — 2026-07-31

## Objective

Record the exact live beta state after reconciling the strongest compatible scanner behavior found across current AppDeploy snapshots, canonical GitHub work, prior project records, and the approved no-artificial-card-cap requirement.

This report is release evidence. It does not reclassify the separately hosted AppDeploy application as the complete canonical GitHub production system.

## Release identity

- Canonical repository: `memphiscardcompany/ManeFlow`
- Canonical `main` at capture: `da8738ce33c89738d3e9007cb99903804b2f57fe`
- Reconciliation PR: `#25`
- Reconciliation branch: `codex/appdeploy-v91-reconciliation-20260731`
- AppDeploy application: `142df297558ace9e22`
- Applied version: `v97`
- AppDeploy version ID: `1785480539332`
- Release timestamp: `2026-07-31T06:48:59.332Z`
- Hosted application: `https://142df297558ace9e22.v2.appdeploy.ai/`
- Public website route: `https://www.memphiscardcompany.com/pages/maneflow`

The Shopify page embeds the stable AppDeploy application hostname, so applying v97 updated the existing website route without changing unrelated Shopify theme files, products, navigation, or pages.

## Unified upload experience

The live scanner now has one intake surface for:

- Camera capture
- Drag and drop
- Multiple file selection
- Folder selection
- Repeated image additions
- Single cards
- Card spreads
- Large image queues

The public interface no longer presents separate single-card and many-files modes. It avoids device-specific, provider-specific, and internal-role language in the normal scanner experience.

## Dense-scene and batching behavior

The release removed the discovered artificial result constraints:

- Frontend overlap cleanup no longer slices the result list at 30.
- Backend fallback identification no longer slices the card list at 30.
- Backend detector normalization no longer slices the raw boundary list at 40.

An optional caller-reported expected count is bounded at 250 for abuse protection. The normal public scanner sends `expectedCount: 0`; it does not use that ceiling as a customer-facing card limit.

Downstream recognition remains bounded:

- Up to eight crops: two-card internal chunks with the deep path.
- More than eight crops: one-card chunks in balanced mode.
- A short cooldown separates large-scene card calls.
- Every returned crop remains available even when recognition capacity is unavailable.

The deterministic queue-integrity diagnostic preserves 36 of 36 synthetic boundary records. It explicitly states that it is not a real-image detector-accuracy benchmark.

## Capacity and retry repair

Fresh QA exposed a retry-amplification defect after the initial 30-card truncation was removed. The final release repairs it by:

- Reducing recognition retries to two total attempts.
- Waiting before the second attempt.
- Returning a reviewable unresolved card when the provider returns 429.
- Avoiding repeated hard-failure calls for every dense-scene crop.
- Preserving the source image and completed results.

A fault-injected 429 test confirmed that the card remains visible as a review record and can be checked later.

## Safe stop repair

The initial stop implementation could immediately replace the stop button with a destructive clear-queue action after the active image finished. The final release separates those states:

- `Stopping after current image`
- `Queue retained — ready when you are`
- Explicit clear action only after a new intentional operation

Queued images and completed results remain available after a stop request.

## Final AppDeploy validation

Terminal provider status:

- Deployment status: `ready`
- E2E status: `passed`
- QA run group: `b536a5f22e06200f`
- Declared jobs: `9`
- Returned `passed_jobs`: `8`
- Frontend errors: none returned
- Backend errors: none returned
- Network errors: none returned
- Desktop QA screenshot: generated
- Mobile QA screenshot: generated

The provider returned overall status `passed` while reporting nine total jobs and eight passed jobs. This discrepancy is preserved exactly. The release is not described as `9/9`.

## Tested contracts

1. Repeated image selections append to one queue.
2. Unsupported files are rejected without removing valid files.
3. Large queues process progressively and stop safely.
4. A selected image reaches a reviewable result.
5. Mobile camera intake remains focused and responsive.
6. Collection review controls remain reachable.
7. Cloud scan history remains optional.
8. Thirty-six diagnostic boundary records are retained.
9. Injected recognition capacity failure preserves a reviewable card.

## Shopify status

The ManeFlow Shopify page remains:

- Published
- Handle: `maneflow`
- Title: `ManeFlow — Scan, Identify & Value Cards`
- Template override: empty
- Embedded application: `https://142df297558ace9e22.v2.appdeploy.ai/`

No unrelated live-store content was changed by the v97 deployment.

## Custom-domain status

`app.memphiscardcompany.com` remains pending DNS verification.

Required record:

```text
Type: CNAME
Name: app
Target: proxy-v2.appdeploy.ai
```

The custom hostname must not be described as operational until DNS resolution and TLS verification succeed.

## Claims boundary

Verified for the live beta:

- Unified uploader is applied.
- The known frontend and backend artificial result slices were removed.
- Dense-scene calls use bounded downstream processing.
- Capacity errors preserve reviewable records.
- Stop-after-current retains the queue.
- The website route serves the applied AppDeploy release.
- Provider-managed terminal deployment and E2E status passed.
- No runtime or network errors were returned in the final status.

Not verified by this release:

- Exact card count from a physical 36-card photograph.
- Exact-card, exact-parallel, serial-number, autograph, or memorabilia accuracy on a substantial locked benchmark.
- Live completed-sale valuation quality for every card.
- Physical-device camera behavior on Joshua Chappell's phone.
- Durable browser-close recovery using production queues.
- Production PostgreSQL, private object storage, backup restore, monitoring, or rollback.
- Live PSA, eBay, or Meta contract behavior in the final v97 workflow.
- Canonical GitHub `main` equivalence.
- Actual model-weight training or measured recognition improvement from scheduled handlers.

## Canonical next step

Port the verified uploader, bounded dense-scene processing, capacity degradation, and stop-state behavior into the repository-native scan routes and UI. Require the full canonical Node, Python, PostgreSQL, security, container, native-client, and browser gates before replacing the AppDeploy beta with a first-party production deployment.
