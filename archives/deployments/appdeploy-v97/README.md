# ManeFlow AppDeploy v97 provenance capsule

## Classification

**Deployed and provider-tested public beta snapshot. Not yet the canonical first-party production application.**

This capsule records the applied ManeFlow AppDeploy release served by `https://www.memphiscardcompany.com/pages/maneflow`.

## Release identity

- AppDeploy app ID: `142df297558ace9e22`
- Version: `v97`
- Version ID: `1785480539332`
- Created: `2026-07-31T06:48:59.332Z`
- Hosted URL: `https://142df297558ace9e22.v2.appdeploy.ai/`
- Website route: `https://www.memphiscardcompany.com/pages/maneflow`
- Canonical GitHub `main` at capture: `da8738ce33c89738d3e9007cb99903804b2f57fe`

## Customer-facing scanner

The live scanner provides one intake surface for camera capture, drag and drop, multi-file selection, folder selection, repeated additions, progressive processing, safe stop, human review, and local use before optional sign-in. Public copy avoids provider-specific, device-specific, and internal-role wording.

## Dense-scene corrections

The release removes three artificial result constraints:

1. Frontend overlap cleanup no longer returns only the first 30 boundaries.
2. Backend fallback identification no longer returns only the first 30 card records.
3. Backend detector normalization no longer returns only the first 40 raw boundary records.

An optional expected count is bounded at 250 as an abuse-protection ceiling. The normal scanner submits `expectedCount: 0`. More than eight crops are identified serially in balanced mode with a short cooldown; smaller scans retain limited parallelism and deeper processing.

## Capacity and retry safety

The release contains two-attempt maximum recognition retries, a delay before the second attempt, safe 429 degradation to a reviewable unresolved record, queue/result preservation, and a persistent non-destructive stop state. An injected 429 QA test confirmed that capacity failure leaves a visible review record rather than discarding the image.

## Queue-integrity diagnostic

`?diagnostics=dense` verifies that 36 synthetic boundary records remain 36 records after grid regularization. This proves container preservation only; it does not measure real-image detection or identification accuracy.

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

The `9` versus `8` discrepancy is preserved exactly because the provider still returned the overall run as passed. It is not rewritten as an unsupported `9/9` claim.

## Boundaries

This release does not prove real-world count recall, universal exact identity or parallel accuracy, completed-sale valuation correctness, physical phone behavior, browser-close recovery through a durable cloud queue, production database/storage/backup operation, canonical GitHub equivalence, or actual model-weight improvement.

## Canonical integration rule

Preserve this snapshot as deployment evidence. Port compatible behavior into the repository-native application and require the canonical Node, Python, PostgreSQL, security, container, native-client, and browser gates before first-party production promotion.
