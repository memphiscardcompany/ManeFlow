# ManeFlow website release status — 2026-07-30

## Objective

Publish ManeFlow through a professional first-party address while preserving the canonical GitHub implementation, Shopify account gate, backend authentication, release provenance, and rollback controls.

## Confirmed current implementation

- Canonical repository: `memphiscardcompany/ManeFlow`
- Canonical branch: `main`
- Shopify page: `/pages/maneflow`
- Reviewed application hostname: `https://app.memphiscardcompany.com`
- Shopify unpublished review theme: `MANEFLOW ACCOUNT-GATED — REVIEW BEFORE PUBLISH`
- Shopify theme ID: `gid://shopify/OnlineStoreTheme/192162431346`
- ManeFlow page ID: `gid://shopify/Page/134221627762`

The reviewed Shopify implementation is stored under `integrations/shopify/` and must be copied to the unpublished theme before publication.

## Shopify behavior

The page is intentionally a first-party launch surface rather than an iframe:

- Signed-out visitors receive login and account-creation actions.
- Signed-in customers receive a direct launch action to `app.memphiscardcompany.com`.
- The page states that ManeFlow performs pricing from completed-sale evidence.
- Results remain drafts until confirmed or corrected.
- Privacy, terms, support, deletion-request, and beta limitations remain visible.
- No AppDeploy numeric hostname is embedded in the reviewed source.

The Shopify customer gate is a storefront boundary only. The application must continue enforcing its own server-side authentication and tenant isolation.

## Domain status

The hostname is registered with the current beta deployment provider but is not verified until DNS is configured.

Required DNS record:

```text
Type: CNAME
Name: app
Target: proxy-v2.appdeploy.ai
```

Do not publish the Shopify launch page until:

1. DNS resolves correctly.
2. HTTPS certificate issuance succeeds.
3. The application at the hostname passes authenticated signup/login/scan/save/relogin tests.
4. The deployed release is tied to an exact Git commit and release manifest.

The same hostname may later be moved from the beta provider to the canonical first-party container deployment without changing the Shopify page.

## Release safety

- Do not expose the broad experimental dashboard as production.
- Do not use an iframe for the final authenticated workflow.
- Do not publish an older provider build over a newer canonical GitHub release.
- Do not enable Meta outbound during website publication.
- Keep `MANEBRAIN_META_KILL_SWITCH=true` and outbound disabled until the independent Meta release gates pass.
- Do not put secrets, access tokens, customer images, cost basis, or private pricing data in Shopify theme files.

## Completed

- Professional mobile-first Shopify launch section created.
- Account-gated logged-in and logged-out states created.
- Direct canonical hostname used instead of numeric provider URL.
- Canonical source copy and automated drift test added.
- Unpublished Shopify theme updated and read back successfully.

## Verified

- Shopify accepted both theme files.
- Theme processing completed without failure.
- The theme remains unpublished.
- The live theme was not modified.
- The reviewed section contains no iframe or numeric AppDeploy hostname.

## Not verified

- DNS resolution for `app.memphiscardcompany.com`.
- TLS certificate issuance for the hostname.
- Physical iPhone account, camera, folder-upload, and collection workflow.
- Exact deployed Git commit behind the hostname.
- Live PSA/eBay provider behavior on the final deployment.
- Production backup, restore, monitoring, and rollback evidence.

## Blocked

Public website publication is blocked by DNS and end-to-end deployment verification. This is an external release gate, not a code-completeness claim.

## Publication procedure

1. Add the DNS CNAME.
2. Verify the custom domain with the deployment provider.
3. Deploy the exact approved canonical release.
4. Run the authenticated release test matrix.
5. Preview the unpublished Shopify theme on desktop and mobile.
6. Assign the `maneflow` template to the ManeFlow page.
7. Publish only after the owner approves the verified preview and rollback point.
