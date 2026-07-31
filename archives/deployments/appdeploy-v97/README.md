# ManeFlow AppDeploy v97 provenance capsule

## Classification

**Deployed and provider-tested public beta snapshot. Not yet the canonical first-party production application.**

This capsule records the applied ManeFlow AppDeploy release that is served by the existing Shopify iframe at `https://www.memphiscardcompany.com/pages/maneflow`.

## Release identity

- AppDeploy app ID: `142df297558ace9e22`
- Version: `v97`
- Version ID: `1785480539332`
- Created: `2026-07-31T06:48:59.332Z`
- Hosted URL: `https://142df297558ace9e22.v2.appdeploy.ai/`
- Website route: `https://www.memphiscardcompany.com/pages/maneflow`
- Canonical GitHub `main` at capture: `da8738ce33c89738d3e9007cb99903804b2f57fe`

## Customer-facing scanner

The live scanner provides one intake surface for:

- Camera capture
- Drag and drop
- Multi-file selection
- Folder selection
- Repeated additions to the same queue
- Progressive processing
- Safe stop after the active image
- Human review and correction
- Local collection use before optional cloud sign-in

The previous single-card-versus-many-files mode split is absent. Public copy avoids provider-specific, device-specific, and internal-role wording.

## Dense-scene corrections

The final release removes three artificial result constraints found during source audit:

1. Frontend overlap cleanup no longer returns only the first 30 boundaries.
2. Backend fallback identification no longer returns only the first 30 card records.
3. Backend detector normalization no longer returns only the first 40 raw boundary records.

An optional caller-provided expected count is bounded at 250 as an abuse-protection ceiling, not used as the normal scanner product limit. The public scanner submits `expectedCount: 0` and processes every returned non-overlapping boundary in bounded internal batches.

For more than eight crops, identification runs serially in balanced mode with a short inter-card cooldown. Small scans retain deeper processing and limited parallelism.

## Capacity and retry safety

The release contains:

- Two-attempt maximum recognition retry behavior
- Delay before the second attempt
- 429 capacity degradation that returns a reviewable unresolved record
- No retry storm after repeated capacity errors
- Preservation of queued files and completed results
- A persistent non-destructive stop state

The injected 429 QA test confirmed that capacity failure leaves a visible review record rather than discarding the image.

## Queue-integrity diagnostic

`?diagnostics=dense` opens an in-app diagnostic that calls the backend queue-integrity route and verifies that 36 synthetic boundary records remain 36 records after grid regularization.

This test proves only that the result container and regularization path do not truncate the records. It does not measure card detection, identity, parallel, or pricing accuracy from a real photograph.

## Deployment evidence

AppDeploy reported:

- Deployment: `ready`
- E2E: `passed`
- Declared jobs: `9`
- Returned `passed_jobs`: `8`
- Frontend errors: none reported
- Backend errors: none reported
- Network errors: none reported
- QA run group: `b536a5f22e06200f`

The apparent `9` versus `8` discrepancy is preserved exactly because the provider still returned the overall run as passed. It is not rewritten as an unsupported `9/9` claim.

## Boundaries

This release does not prove:

- Real-world exact count recall on 31, 36, 100, or more cards
- Universal exact identity or exact-parallel accuracy
- Live completed-sale valuation correctness
- Physical iPhone or Android behavior
- Browser-close recovery backed by a durable cloud queue
- Production PostgreSQL, private object storage, backups, or restore
- Deployment equivalence with canonical GitHub `main`
- Actual model training or recognition improvement from scheduled handlers

## Canonical integration rule

Preserve this snapshot as deployment evidence. Port compatible scanner behavior into the repository-native application rather than replacing the canonical architecture wholesale. Canonical promotion still requires the repository's Node, Python, PostgreSQL, security, container, native-client, and browser gates.
