# AppDeploy v97 — Account-Gated Customer Scanner Release

**Release date:** 2026-07-31 04:03 CDT  
**AppDeploy application ID:** `142df297558ace9e22`  
**Stable hosted URL:** `https://142df297558ace9e22.v2.appdeploy.ai/`  
**AppDeploy release:** `v97`  
**Snapshot/version ID:** `1785488592515`

## Objective

Correct the public-beta access and presentation defects without replacing the existing hosted application:

1. Require an authenticated ManeFlow account before camera, file, folder, drag-and-drop, card detection, card identification, correction, PSA lookup, or private collection access.
2. Remove internal recognition, provider, OCR, evidence-pipeline, calibration, and diagnostic language from collector-facing screens.
3. Improve ordinary multi-image queue throughput with bounded concurrency while preserving source ordering, safe abstention, and dense-scene stability.
4. Keep uncertain scans reviewable instead of forcing an identity.

## Deployed behavior

### Signed-out access

Signed-out visitors receive an account-access screen. Scanner controls and private collection data are not rendered as usable customer features.

The hosted backend also requires authentication for:

- card detection;
- single-card identification;
- multi-card identification;
- duplicate legacy identify routes;
- mobile identification and assistant requests;
- PSA status and certification lookups.

Internal diagnostics, calibration data, and benchmark routes require both authentication and the Memphis Card Company administrative email allowlist.

### Customer-facing scan results

Collector screens now use plain-language result and value states. They do not display raw backend notes or specialist evidence terminology. Active listings are labeled as reference context and are not presented as completed-sale valuation evidence.

The result remains a draft until reviewed. ManeFlow does not authenticate cards, assign grades, or guarantee market value.

### Performance change

For ordinary queues of up to eight source images, the hosted client uses two bounded workers. Completion buckets preserve source order. Larger queues retain the more conservative sequential/cooldown behavior to reduce provider pressure and memory risk.

This is a throughput optimization, not a claimed measured latency benchmark. No quantum-computing or theoretical-physics mechanism is represented as part of the deployed implementation.

## Automated validation

AppDeploy QA group: `01594fcb7d8b995e`

| Test | Result |
|---|---|
| Anonymous visitors see the account gate and no scanner controls | Passed |
| Signed-in collector can scan and save a card | Passed |
| Customer results hide internal system language | Passed |
| Four-image queue finishes with identified, review, or unresolved results | Passed |
| Injected capacity failure preserves a reviewable result without a retry storm | Passed |
| Mobile signed-out visitors cannot reach camera or upload controls | Passed |
| Signing out immediately removes private application access | Passed |

**Total:** 7 passed, 0 failed.

The release status reported `ready`, with no frontend or backend errors in the final QA snapshot.

## Evidence boundaries

Verified by the hosted release gate:

- account gate behavior in automated desktop and mobile sessions;
- authenticated scan and save workflow;
- customer-copy suppression of named internal terms;
- bounded retry behavior under an injected HTTP 429 response;
- immediate concealment of private UI after sign-out;
- final AppDeploy release status and automated test totals.

Not verified by this record:

- physical iPhone camera behavior;
- production identification accuracy on Joshua Chappell's owner-authorized benchmark corpus;
- exact real-world latency improvement;
- live PSA partner-field coverage;
- live eBay completed-sale valuation quality;
- first-party PostgreSQL/object-storage production deployment;
- direct Shopify-customer-session federation with the hosted AppDeploy identity.

## Rollback

AppDeploy retains previous snapshots. The immediate pre-release snapshots are:

- `v96` / `1785488327903` — same application changes before the QA wording correction;
- `v95` / `1785488187265` — initial account-gate and customer-copy patch;
- `v94` / `1785480539332` — pre-fix build that allowed signed-out local scanning.

Rollback must not restore `v94` to customer traffic because it contains the reported anonymous-scanning defect.

## Canonical follow-through

The permanent repository must retain server-side authentication on all scan and upload APIs. The standalone canonical intake page must also conceal its scanner markup until `/api/auth/me` confirms an authenticated session; client-side redirects alone are not sufficient as a polished customer boundary.
