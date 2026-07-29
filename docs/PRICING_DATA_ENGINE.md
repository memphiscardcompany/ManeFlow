# ManeFlow Pricing Data Engine

ManeFlow v2.4 includes a production-oriented pricing data acquisition layer. It lets a solo operator import and manage authorized completed-sale data without weakening ManeFlow's core trust boundary.

## What the engine does

The Pricing Data Engine sits before valuation:

1. Accepts authorized pricing rows from CSV, admin batch imports, provider webhooks, and eBay provider imports.
2. Validates source metadata: provider, source mode, authorization basis, data rights status, and refresh policy.
3. Smart-matches rows to the canonical ManeFlow card catalog when a `cardId` is not supplied.
4. Normalizes rows into ManeFlow's completed-sale shape.
5. Runs every normalized comp through `comp-quality.js` before the data can affect values.
6. Upserts records idempotently by `id` or `provider + rawProviderId`.
7. Records provider ingest summaries for the Owner Control Room.
8. Exposes source-quality reports through admin and user-safe endpoints.

## Core files

```text
src/services/pricing-data.js
src/providers/ebay.js
src/services/comp-quality.js
src/services/provider-registry.js
```

## Approved production authorization bases

Production pricing data must declare one of:

- `official_api`
- `ebay_api`
- `written_license`
- `commercial_partner`
- `user_authorized_export`
- `user_csv`

Rows without an approved authorization basis are rejected before they can enter production pricing data.

## eBay integration

ManeFlow supports three clearly separated eBay paths:

1. `eBay Marketplace Insights` completed-sale imports when approved limited-release sold-history access is configured.
2. `eBay Seller Orders` import for the authenticated seller's own sales.
3. `eBay Browse` active Buy It Now context, which is never used as completed-sale valuation data.

Admin endpoints:

```text
GET  /api/admin/ebay/status
POST /api/admin/ebay/import-completed
POST /api/admin/ebay/import-seller-orders
```

See `docs/EBAY_INTEGRATION.md` for the full provider contract.

## Demo boundary

Demo records stay source-labeled as demo data. Demo comps may be used for local demonstrations, but they are blocked from production valuation when demo mode is disabled.

## Completed-sale boundary

Active listings and asking prices are not allowed to become completed-sale comps. They may be displayed as active-market context, but `comp-quality.js` excludes them from `valuationUse`.

v2.4 adds `src/services/asking-price-context.js`. It summarizes active fixed-price listings into:

- median ask
- ask range
- spread
- source count
- active ask compared with completed-sale alignment
- pricing confidence
- pricing rating
- new-release usefulness
- warnings

These fields can inform listing strategy, merchant decision tools, and new-release pricing confidence. They do not change `value`, which remains based on completed-sale comps only.

## Key endpoints

Public/account-scoped:

- `GET /api/pricing-data/template.csv`
- `POST /api/pricing-data/validate`
- `GET /api/pricing-data/report`

Admin-only:

- `GET /api/admin/pricing-data/report`
- `POST /api/admin/pricing-data/import`
- `GET /api/admin/ebay/status`
- `POST /api/admin/ebay/import-completed`
- `POST /api/admin/ebay/import-seller-orders`
- `POST /api/admin/provider-ingest`

Provider webhook imports require either an admin session or a valid `x-maneflow-signature` HMAC using `PROVIDER_WEBHOOK_SECRET`.

## Required data for best accuracy

For high confidence, rows should include:

- Provider/source name
- Authorization basis
- Raw provider ID
- Source URL when allowed
- Sold date
- All-in price components: price, shipping, buyer premium
- Sale type and listing type
- Player, year, brand, set, card number, parallel
- Grader and grade when applicable
- Card ID when available
- Rights notes

## Limitations

This engine does not grant marketplace access by itself. eBay, Fanatics Collect, Goldin, Heritage, Whatnot, TCGplayer, COMC, Card Ladder, and similar sources still require official API access, user-authorized exports, written permission, or commercial agreements. ManeFlow records source rights and prevents unsupported data from being presented as verified public market values.

## v1.6 production controls

v1.6 adds import job definitions, import run history, provider freshness summaries, and partner-feed stubs. These controls help the owner prepare scheduled imports without claiming live coverage before credentials and agreements exist.

Admin endpoints:

- `GET /api/admin/import-jobs`
- `POST /api/admin/import-jobs`
- `POST /api/admin/import-jobs/:id/runs`

Production values still require authorized completed-sale data. Active listings are context only.
## v1.7 Operational Upgrade

ManeFlow v1.7 persists the scored sale record, not only the normalized sale. Stored pricing records now retain:

- providerRunId
- providerBatchId
- qualityScore
- confidenceScore
- inclusionStatus
- reviewStatus
- valuationUse
- reasons
- warnings
- publicExplanation
- adminExplanation
- sourceMode
- authorizationBasis
- dataRightsStatus

Admin imports can run in dry-run mode. Dry-runs validate and score records but do not write sales or provider-ingest state. Bad live imports can be rolled back by provider run ID or provider batch ID.

Active listings, demo data in production, missing prices, missing sale dates, future dates, and unauthorized data-rights statuses cannot affect valuation.

## v1.9 Dealer-Grade UX + Data Ops

v1.9 brings the pricing-data workflow into the main owner and customer experience:

- Owner Control Room shows source rights, acquisition authorization, evidence parsing, and manual comp review.
- Card detail pages show dealer-grade action guidance from only comp-quality-eligible valuations.
- Public valuation pages and website widgets consume the public-safe value endpoint.
- Native mobile source now surfaces scan confidence, graded cert evidence, and value trust summaries.

These UX upgrades do not change the core market-data rule: only source-authorized completed-sale records with `valuationUse=true` can affect value.

## v2.4 BIN Context Upgrade

Current Buy It Now listings from eBay Browse can be fetched for a card page or dealer decision when eBay client credentials are configured. ManeFlow stores and displays this as asking-price context only:

```text
sourceType=active_listing
listingType=buy_it_now_asking
saleType=asking
dataRightsStatus=active_listings_only_not_for_valuation
valuationUse=false
```

`valuation.value` and `valuation.confidence` remain completed-sale based. `valuation.pricingConfidence`, `valuation.pricingRating`, and `valuation.askingPriceContext` are separate decision-support fields for listing strategy and new-release cards.
