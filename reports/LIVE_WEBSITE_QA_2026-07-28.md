# Live website QA

Date: 2026-07-28

URL tested:

`https://memphiscardcompany.com/pages/maneflow`

## Verified

- The Shopify page returns and renders publicly.
- The page title is `ManeFlow — Upload Card Images – Memphis Card Company`.
- The page embeds `https://50bb824255c843ef9a.v2.appdeploy.ai/`.
- The embedded screen advertises multi-card vision, market evidence, and a
  private Vault.
- The only application control is `Create account / Sign in`.
- Activating that control produced no navigation, form, dialog, or visible
  state change.
- The page text below the embed says drafts remain in the browser, which
  conflicts with the embedded promise that scans and collection data remain
  attached to an account.
- ManeFlow is absent from the primary navigation.
- The AppDeploy overlay remains visible in the embedded product.

## Shopify Admin read-only inventory

- Live theme:
  `gid://shopify/OnlineStoreTheme/192162333042`,
  `READY — MATCHES LIVE + MANE MADE LINK FIX`
- Account-gated draft theme:
  `gid://shopify/OnlineStoreTheme/192162431346`,
  `MANEFLOW ACCOUNT-GATED — REVIEW BEFORE PUBLISH`
- Live ManeFlow page:
  `gid://shopify/Page/706823258482`, handle `maneflow`
- The account-gated theme remains unpublished.
- The published Data Deletion page currently says ManeFlow does not require an
  account. That statement is incompatible with the required account-gated
  release and must be corrected before launch.
- The published Privacy Policy describes ManeFlow as unreleased, which must be
  reconciled with the actual beta state before launch.

## Result

The live page is an older embedded placeholder, not the reconciled candidate
and not a working account-gated ManeFlow release. Account creation, email
verification, sign-in, scanning, pricing, Vault persistence, cross-user
isolation, release metadata, and ManeBrain are not reachable from this page.

No live website mutation was made. The old embed must remain until a first-party
replacement passes the release gates and has a verified rollback.
