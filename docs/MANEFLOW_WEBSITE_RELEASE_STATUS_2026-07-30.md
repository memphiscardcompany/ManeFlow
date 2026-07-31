# ManeFlow website release status — 2026-07-30

## Objective

Publish ManeFlow through a professional first-party address while preserving the canonical GitHub implementation, Shopify account gate, backend authentication, release provenance, and rollback controls.

## Confirmed current implementation

- Canonical repository: `memphiscardcompany/ManeFlow`
- Canonical branch: `main`
- Shopify page: `/pages/maneflow`
- Shopify page ID: `gid://shopify/Page/706823258482`
- Shopify page status: published
- Shopify page template suffix: `maneflow`
- Current live Shopify theme: `READY — MATCHES LIVE + MANE MADE LINK FIX`
- Current live Shopify theme ID: `gid://shopify/OnlineStoreTheme/192162333042`
- Reviewed application hostname: `https://app.memphiscardcompany.com`
- Shopify unpublished review theme: `MANEFLOW ACCOUNT-GATED — REVIEW BEFORE PUBLISH`
- Shopify unpublished review theme ID: `gid://shopify/OnlineStoreTheme/192162431346`
- Current beta deployment app ID: `50bb824255c843ef9a`
- Current beta deployment URL: `https://50bb824255c843ef9a.v2.appdeploy.ai/`
- Current beta deployment version ID observed during verification: `1785323847697`

The reviewed Shopify implementation is stored under `integrations/shopify/` and has been written to the unpublished review theme.

## Verified live-store drift

The published `/pages/maneflow` page already uses the `maneflow` template, but the current live theme still contains the older ManeFlow section. Its launch button targets the numeric AppDeploy URL directly:

```text
https://50bb824255c843ef9a.v2.appdeploy.ai/
```

The live theme files are not the reviewed first-party launch files:

| Theme | File | Current MD5 |
|---|---|---|
| Live `192162333042` | `sections/maneflow-beta.liquid` | `5b0e5c38c42c55665409fc13e4ff64ed` |
| Live `192162333042` | `templates/page.maneflow.json` | `c530fe168aad14a6e345d0543304b8bb` |
| Unpublished review `192162431346` | `sections/maneflow-beta.liquid` | `f037bfcd8a4c525f576b764dc29caf57` |
| Unpublished review `192162431346` | `templates/page.maneflow.json` | `2f6bca9f7f249de15cccebb9c829c459` |

Do not describe the reviewed launch surface as live until the verified replacement theme is deliberately published or the equivalent reviewed files are promoted through an approved rollback-safe procedure.

## Reviewed Shopify behavior

The unpublished review page is intentionally a first-party launch surface rather than an iframe:

- Signed-out visitors receive login and account-creation actions.
- Signed-in customers receive a direct launch action to `app.memphiscardcompany.com`.
- The page states that ManeFlow performs pricing from completed-sale evidence.
- Results remain drafts until confirmed or corrected.
- Privacy, terms, support, deletion-request, and beta limitations remain visible.
- No AppDeploy numeric hostname is embedded in the reviewed source.

The Shopify customer gate is a storefront boundary only. The application must continue enforcing its own server-side authentication and tenant isolation.

## Domain status

The hostname is registered with the current beta deployment provider. Verification on 2026-07-30 returned `pending_dns` because no matching CNAME chain was found.

Required DNS record:

```text
Type: CNAME
Name: app
Target: proxy-v2.appdeploy.ai
```

Do not publish the reviewed Shopify launch page until:

1. DNS resolves correctly.
2. HTTPS certificate issuance succeeds.
3. The application at the hostname passes authenticated signup/login/scan/save/relogin tests.
4. The deployed release is tied to an exact Git commit and release manifest.

The same hostname may later be moved from the beta provider to the canonical first-party container deployment without changing the Shopify page.

## Current beta deployment evidence

The connected deployment provider reports the current numeric beta as ready and its automated end-to-end test suite as passed. This verifies the provider-managed beta state only; it does not establish that the full canonical GitHub application is deployed.

No deployment secrets were configured when inspected. Therefore, live PSA, eBay, JustTCG, SportsCardsPro, or other credential-dependent production behavior is not verified on this beta deployment.

The beta deployment is also not yet tied to an exact canonical Git commit in the available deployment evidence.

## Release safety

- Do not expose the broad experimental dashboard as production.
- Do not use an iframe for the final authenticated workflow.
- Do not publish an older provider build over a newer canonical GitHub release.
- Do not present Shopify customer-state Liquid as the only authorization boundary.
- Do not enable Meta outbound during website publication.
- Keep `MANEBRAIN_META_KILL_SWITCH=true` and outbound disabled until the independent Meta release gates pass.
- Do not put secrets, access tokens, customer images, cost basis, or private pricing data in Shopify theme files.
- Do not publish the reviewed theme while its launch destination fails DNS or TLS verification.

## Completed

- Professional mobile-first Shopify launch section created.
- Account-gated logged-in and logged-out states created.
- Direct canonical hostname used instead of numeric provider URL in the reviewed source.
- Canonical source copy and automated drift test added.
- Unpublished Shopify theme updated and read back successfully.
- Current Shopify page, live theme, unpublished theme, deployment app, and custom-domain state reconciled against connected systems.

## Verified

- The ManeFlow Shopify page exists, is published, and uses template suffix `maneflow`.
- Shopify accepted both reviewed theme files.
- Unpublished theme processing completed without failure.
- The reviewed theme remains unpublished.
- The current live theme still uses the older numeric AppDeploy launch URL.
- The reviewed section contains no iframe or numeric AppDeploy hostname.
- The numeric beta deployment is reported ready by its provider.
- The custom hostname remains `pending_dns`.

## Not verified

- DNS resolution for `app.memphiscardcompany.com`.
- TLS certificate issuance for the hostname.
- Physical iPhone account, camera, folder-upload, and collection workflow.
- Exact deployed Git commit behind the numeric beta or future custom hostname.
- Full canonical GitHub application deployment.
- Live PSA/eBay provider behavior on the final deployment.
- Production backup, restore, monitoring, and rollback evidence.
- CI status for the latest `main` commit; no associated status checks were returned during this verification.

## Blocked

Public launch of the reviewed first-party experience is blocked by:

1. The missing DNS CNAME.
2. Custom-domain TLS verification.
3. Exact release-to-commit provenance.
4. End-to-end authenticated release testing on the custom hostname.
5. Credential-dependent provider configuration and verification where those providers are required for the release claim.
6. Final preview and deliberate publication of the unpublished Shopify theme.

These are release gates, not evidence that the reviewed code or theme files are absent.

## Publication procedure

1. Add the DNS CNAME.
2. Verify the custom domain with the deployment provider.
3. Deploy an exact approved canonical release or explicitly document the bounded beta release being used.
4. Configure required provider secrets through the deployment secret manager without exposing them in source or chat.
5. Run the authenticated desktop and physical-mobile release test matrix.
6. Preview the unpublished Shopify theme on desktop and mobile.
7. Confirm the live-theme rollback point and exact file checksums.
8. Publish only after the owner approves the verified preview and rollback procedure.
9. Run post-publication checks against `/pages/maneflow`, the custom hostname, authentication, scan, pricing, save, sign-out, sign-in, and collection persistence.
