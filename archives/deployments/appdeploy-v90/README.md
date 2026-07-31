# ManeFlow AppDeploy v90 — Deployed Beta Source Capsule

## Status

- **Origin:** AppDeploy application `142df297558ace9e22`
- **Snapshot version:** `1785476302989`
- **AppDeploy display version:** v90
- **Built:** 2026-07-31T05:38:22.989Z
- **Hosted URL:** `https://142df297558ace9e22.v2.appdeploy.ai/`
- **Website route:** `https://www.memphiscardcompany.com/pages/maneflow`
- **Deployment status:** Deployed beta
- **Canonical production status:** Not canonical production infrastructure
- **Source-of-truth status:** Archived here for provenance and future reconciliation into the canonical ManeFlow implementation

This capsule preserves the exact customer-facing source files changed for the v90 release. It does not replace the canonical application architecture on `main`, and it must not be treated as proof that production PostgreSQL, private object storage, queues, workers, monitoring, backups, provider integrations, GPU inference, or first-party hosting are complete.

## Verified release behavior

The AppDeploy release reported:

- 7 of 7 browser E2E tests passed
- no reported frontend errors
- no reported backend errors
- no reported network errors
- desktop and mobile QA snapshots generated

The published Shopify page was read back through the Admin GraphQL API and confirmed to:

- remain published
- use handle `maneflow`
- embed the v90 AppDeploy application
- have an empty template suffix, preventing the obsolete theme template from overriding the page body

## v90 user-facing changes

- Replaced separate scanner modes with one unified intake surface.
- Added camera capture, multi-file selection, folder selection, and drag-and-drop.
- Removed the artificial 100-image front-end cap.
- Processes large selections progressively instead of sending one oversized browser request.
- Added visible queue count, aggregate size, progress, safe stop-after-current behavior, and queue clearing.
- Preserves repeated image selections because alternate angles and repeated views can be legitimate evidence.
- Rejects unsupported files without creating fabricated card records.
- Preserves card-spread detection and reviewable fallback records.
- Removed provider-specific and internal-role wording from the public scanner UI.
- Removed the private Meta inbox from public customer navigation without deleting its protected implementation.
- Reduced install and cloud-history controls to compact customer-facing panels.
- Retained calibrated uncertainty, human correction, and local-device saving.

## Custom-domain state

`app.memphiscardcompany.com` was removed from the obsolete AppDeploy beta and attached to application `142df297558ace9e22`.

Current state: **pending DNS**.

Required DNS record:

```text
Type: CNAME
Host: app
Target: proxy-v2.appdeploy.ai
```

Until DNS is created and verified, the supported first-party entry point remains:

`https://www.memphiscardcompany.com/pages/maneflow`

## Reconciliation requirements

Before promoting this code beyond archived deployed-beta provenance:

1. Map each retained component into the canonical PWA or web client architecture.
2. Replace AppDeploy-specific client dependencies with canonical service abstractions where required.
3. Preserve the unified uploader UX and progressive queue semantics.
4. Add canonical unit, integration, browser, mobile, security, and performance tests.
5. Verify server-side authentication, tenant isolation, private storage, persistence, queue behavior, rate limits, audit logging, monitoring, backups, and rollback.
6. Prove completed-sale valuation and certification-provider behavior using authorized production credentials without exposing secrets.
7. Measure card-detection and exact-identification performance on rights-cleared benchmark data.
8. Keep uncertain identities in review or abstain rather than forcing a match.

## Files in this capsule

- `src/CardScannerV2.tsx`
- `src/InstallManeFlow.tsx`
- `src/ScanArchivePanel.tsx`
- `src/MccVaultDeploy.tsx`
- `tests/tests.txt`
- `manifest.json`

## Verification boundaries

The E2E suite verifies the hosted customer workflow and UI behaviors represented in `tests/tests.txt`. It does not establish card-recognition accuracy, market-value accuracy, provider uptime, data durability, native desktop functionality, or production readiness of the canonical repository.