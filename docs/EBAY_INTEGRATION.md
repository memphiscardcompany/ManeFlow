# ManeFlow eBay Integration

ManeFlow v1.5 adds an eBay provider that can ingest real eBay-originated completed-sale data when the required authorization exists.

## Supported eBay paths

### 1. Marketplace Insights completed sales

Provider method:

```text
EbayProvider.searchCompletedSales(options)
```

Admin endpoint:

```text
POST /api/admin/ebay/import-completed
```

This uses:

```text
GET /buy/marketplace_insights/v1_beta/item_sales/search
```

The provider supports keyword, category ID, date, condition, and price filters. Results are normalized into ManeFlow sale records with:

```text
provider=eBay Marketplace Insights
authorizationBasis=ebay_api
sourceMode=production
dataRightsStatus=ebay_marketplace_insights_limited_release
isCompletedSale=true
```

Important: Marketplace Insights sold-history access is limited/restricted. Set `EBAY_MARKETPLACE_INSIGHTS_ENABLED=true` only after eBay approves the application for this access. If it is not enabled, the endpoint fails closed and does not create comps.

### 2. Seller account orders

Provider method:

```text
EbayProvider.fetchSellerOrders(options)
```

Admin endpoint:

```text
POST /api/admin/ebay/import-seller-orders
```

This uses authenticated seller order data. It is valid for the connected seller's own sales history, not market-wide sold-comp coverage.

Normalized records use:

```text
provider=eBay Seller Orders
authorizationBasis=ebay_api
sourceMode=production
dataRightsStatus=seller_account_authorized_orders_only
isCompletedSale=true
```

### 3. Browse active BIN listings

Provider method:

```text
EbayProvider.searchActiveListings(options)
```

Browse results are active-market context only. ManeFlow requests fixed-price Buy It Now listings where supported and labels them:

```text
sourceType=active_listing
listingType=buy_it_now_asking
saleType=asking
dataRightsStatus=active_listings_only_not_for_valuation
valuationUse=false
```

Active listings are never allowed to affect completed-sale valuation. v2.4 summarizes them through `src/services/asking-price-context.js` so current BIN prices can inform listing strategy, pricing confidence, and new-release context without becoming market value.

## Required environment variables

```text
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
EBAY_MARKETPLACE_INSIGHTS_ENABLED=false
EBAY_USER_ACCESS_TOKEN=
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_ENVIRONMENT=production
EBAY_REQUEST_TIMEOUT_MS=15000
EBAY_MAX_RETRIES=3
EBAY_MIN_BACKOFF_MS=400
```

## Import flow

1. Admin triggers eBay import from Owner Control Room or admin API.
2. `src/providers/ebay.js` fetches eBay data with retry/backoff and timeout controls.
3. eBay records are normalized into ManeFlow sale records.
4. `pricing-data.js` validates source rights and idempotently upserts by `provider + rawProviderId`.
5. `comp-quality.js` scores each comp.
6. `valuation.js`, Portfolio Intelligence, alerts, and card pages use only `valuationUse=true` comps.
7. Provider ingest summaries appear in the Owner Control Room.

## Security model

- eBay credentials are server-side environment variables only.
- Admin routes require administrator authorization.
- A one-time seller access token may be supplied to the admin endpoint, but it is not persisted or returned.
- Provider credentials are never exposed through public APIs.
- Import activity is recorded in provider-ingest and audit logs without storing secrets.

## Data-quality rules

The Comp Quality Engine excludes eBay records from valuation when they are:

- active listings
- missing sold date
- missing price
- future-dated
- duplicate provider raw IDs
- wrong grade
- wrong parallel
- wrong mapped card
- unapproved or unidentified data-rights source

## Production claim boundary

ManeFlow may show eBay-originated comps after authorized import. It must not claim comprehensive real-time eBay market coverage unless the configured eBay access and refresh cadence actually support that claim.
## v2.4 eBay Operations

eBay imports now flow through the scored pricing-data pipeline and persist comp-quality fields when written to storage.

Marketplace Insights completed-sale imports remain gated behind approved eBay access. Seller-order imports represent the authenticated seller account only. Browse active BIN listings are still separated from completed-sale comps and are not valuation inputs.

Use dry-run import and provider run IDs before live operations. If a bad eBay import is written, use pricing batch rollback by provider run or batch ID.
