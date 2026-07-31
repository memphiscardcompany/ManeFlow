# ManeFlow AppDeploy v97 release record — 2026-07-31

## Objective

Record the live beta state after reconciling the strongest compatible scanner behavior found across current AppDeploy snapshots, canonical GitHub work, prior project records, and the approved no-artificial-card-cap requirement.

This report is release evidence. It does not reclassify the separately hosted AppDeploy application as the complete canonical GitHub production system.

## Release identity

- Canonical repository: `memphiscardcompany/ManeFlow`
- Reconciliation branch: `release/appdeploy-v97-record`
- AppDeploy application: `142df297558ace9e22`
- Applied version: `v97`
- AppDeploy version ID: `1785480539332`
- Release timestamp: `2026-07-31T06:48:59.332Z`
- Hosted application: `https://142df297558ace9e22.v2.appdeploy.ai/`
- Public website route: `https://www.memphiscardcompany.com/pages/maneflow`

The Shopify page embeds the stable application hostname, so applying v97 updated the existing website route without changing unrelated theme files, products, navigation, or pages.

## Unified intake

The live scanner now has one intake surface for camera capture, drag and drop, multiple files, folders, repeated additions, single cards, card spreads, and large image queues. The public interface does not present separate single-card and many-files modes and avoids provider-specific, device-specific, and internal-role wording.

## Dense-scene processing

The release removed the discovered frontend 30-result slice, backend 30-result fallback slice, and backend 40-boundary detector slice. An optional caller-provided expected count is bounded at 250 for abuse protection; the normal scanner sends `expectedCount: 0`.

Downstream recognition remains bounded:

- Up to eight crops: two-card internal chunks with deeper processing.
- More than eight crops: one-card chunks in balanced mode.
- A short cooldown separates large-scene calls.
- Every crop remains reviewable when recognition capacity is unavailable.

The queue-integrity diagnostic preserves 36 of 36 synthetic boundary records and explicitly states that it is not a real-image detection benchmark.

## Capacity repair

Fresh QA exposed retry amplification after the initial truncation was removed. The final release reduces recognition retries, delays the second attempt, degrades 429 responses to reviewable unresolved results, preserves source images and completed results, and avoids repeated hard-failure calls for dense scenes.

The injected 429 test confirmed that a card remains visible as a review record and can be checked later.

## Safe stop repair

The final release separates the stop and destructive-clear states:

- `Stopping after current image`
- `Queue retained — ready when you are`
- Explicit clear only after a separate intentional action

Queued images and completed results remain available after stopping.

## Final validation

AppDeploy returned:

- Deployment: `ready`
- E2E: `passed`
- QA run group: `b536a5f22e06200f`
- Declared jobs: `9`
- Returned `passed_jobs`: `8`
- Frontend errors: none
- Backend errors: none
- Network errors: none
- Desktop and mobile screenshots generated

The provider returned overall status `passed` while reporting nine total jobs and eight passed jobs. This discrepancy is preserved exactly and is not described as `9/9`.

## Tested contracts

1. Repeated selections append to one queue.
2. Unsupported files are rejected without removing valid files.
3. Large queues process progressively and stop safely.
4. A selected image reaches a reviewable result.
5. Mobile camera intake remains responsive.
6. Collection review controls remain reachable.
7. Cloud scan history is optional.
8. Thirty-six diagnostic boundary records are retained.
9. Injected capacity failure preserves a reviewable card.

## Website state

The Shopify ManeFlow page remains published with handle `maneflow`, title `ManeFlow — Scan, Identify & Value Cards`, no template override, and an iframe targeting `https://142df297558ace9e22.v2.appdeploy.ai/`.

## Custom-domain state

`app.memphiscardcompany.com` remains pending DNS verification. Required record:

```text
Type: CNAME
Name: app
Target: proxy-v2.appdeploy.ai
```

Do not describe the hostname as operational until DNS and TLS verification succeed.

## Claims boundary

Verified: the unified uploader is applied; known artificial result slices were removed; dense scenes use bounded downstream processing; capacity errors preserve review records; stop-after-current retains the queue; the website route serves v97; provider-managed deployment and E2E reached passing terminal status; no runtime or network errors were returned.

Not verified: real 36-card count recall; exact identity and exact parallel accuracy on a substantial locked benchmark; live completed-sale valuation quality for every card; physical-device camera testing; durable browser-close recovery; production PostgreSQL/private storage/backup restore; live PSA/eBay/Meta contract behavior; canonical `main` equivalence; or actual model-weight improvement from scheduled handlers.

## Canonical next step

Port the verified uploader, bounded dense-scene processing, capacity degradation, and safe stop behavior into the repository-native scan routes and UI. Require the canonical Node, Python, PostgreSQL, security, container, native-client, and browser gates before replacing the hosted beta with a first-party production release.
