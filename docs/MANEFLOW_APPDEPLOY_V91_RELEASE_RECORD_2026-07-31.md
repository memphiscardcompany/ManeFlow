# ManeFlow AppDeploy v91 release record — 2026-07-31

## Objective

Preserve exact evidence for the bounded public-beta scanner deployment while the canonical first-party backend remains the permanent source of truth.

This record does not claim that the AppDeploy application is the full canonical GitHub production release.

## Canonical baseline

- Repository: `memphiscardcompany/ManeFlow`
- Base branch: `main`
- Base commit when this record branch was created: `da8738ce33c89738d3e9007cb99903804b2f57fe`
- Reconciliation branch: `codex/appdeploy-v91-reconciliation-20260731`

The canonical repository already contains stronger server-owned intake, durable scan-job persistence, bounded retries, file-integrity controls, first-party staging, signed-container release controls, completed-sale pricing, and reviewed Shopify launch work. The AppDeploy application remains a separately hosted beta implementation and must not replace those controls silently.

## Deployed beta

- AppDeploy application ID: `142df297558ace9e22`
- Applied release: `v91`
- AppDeploy version ID: `1785478189041`
- Release timestamp: `2026-07-31T06:09:49.041Z`
- Public beta URL: `https://142df297558ace9e22.v2.appdeploy.ai/`
- Previous rollback release: `v90`
- Previous rollback version ID: `1785476302989`

## Customer-facing behavior retained

The active scanner uses `src/CardScannerV2.tsx` through `src/MccVaultDeploy.tsx` and provides one intake surface for:

- Camera capture
- Multi-file selection
- Folder selection
- Drag and drop
- Repeated image selections
- Progressive queue processing
- Safe stop after the current image
- Human review and correction
- Local use before optional sign-in

The scanner UI does not expose the earlier single-versus-batch mode split.

## Defect corrected in v91

The v90 scanner claimed that it had no artificial item-count cap, but its per-image detection cleanup still returned:

```ts
return output.slice(0, 30)
```

That silently discarded every valid non-overlapping card boundary after the thirtieth detection in one image.

v91 now returns the complete overlap-deduplicated detection list:

```ts
return output
```

The existing overlap suppression remains in place. Per-card recognition remains bounded in two-card internal batches, so removing the result truncation does not convert the scan into one unbounded AI request.

## Deployment validation

The deployment provider reported:

- Deployment status: `ready`
- End-to-end status: `passed`
- Declared E2E jobs: `8`
- Returned `passed_jobs` field: `7`
- Frontend runtime errors: none returned
- Backend runtime errors: none returned
- Network errors: none returned
- Desktop and mobile QA screenshots generated

The mismatch between `total_jobs: 8` and `passed_jobs: 7` is preserved as returned provider evidence. It must not be rewritten as an unsupported `8/8` claim.

The updated test contract includes a dense-scene regression requirement stating that valid non-overlapping detections must not stop at 30.

## Custom-domain status

`app.memphiscardcompany.com` remains associated with the current AppDeploy application but is not verified live. The last connected status remained `pending_dns`.

Required DNS record:

```text
Type: CNAME
Name: app
Target: proxy-v2.appdeploy.ai
```

Do not describe the custom hostname as operational until DNS resolution and TLS verification succeed.

## Release boundaries

Verified for this beta release:

- Unified uploader remains active.
- The hidden 30-card result truncation was removed.
- AppDeploy accepted and applied v91.
- Provider-managed deployment and E2E status reached a passing terminal state.
- No frontend, backend, or network runtime errors were returned in the release status.

Not verified by this release:

- A physical 31-plus-card photograph processed end to end.
- Exact identity accuracy for a dense scene.
- HEIC/HEIF conversion on physical Apple devices.
- Canonical PostgreSQL and private-object-storage persistence in AppDeploy.
- Exact deployment equivalence with canonical GitHub `main`.
- Production provider contracts or credentials.
- Physical mobile camera, save, logout, login, and collection-recovery workflow.
- Custom-domain DNS or TLS.
- Full canonical container publication.

## Reconciliation requirement

The durable canonical scanner and the public AppDeploy scanner must be converged through a reviewed implementation rather than copying either application wholesale:

1. Preserve canonical server-owned durable jobs, ownership checks, idempotency, private persistence, bounded retry, cancellation, and recovery.
2. Preserve the v91 unified mobile-first intake and review experience.
3. Preserve repeated image intake while preventing duplicate collection records through content-aware save idempotency.
4. Preserve resource-based safety ceilings rather than arbitrary card-count truncation.
5. Run the canonical Node, Python, PostgreSQL, security, browser, container, and release gates before first-party promotion.

## Rollback

If v91 introduces a confirmed regression, AppDeploy release `v90` (`1785476302989`) is the immediate provider rollback point. Rolling back restores the hidden 30-card truncation, so rollback should be temporary and documented.
