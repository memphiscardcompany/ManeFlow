# eBay live market pricing

## Status

ManeFlow supports two separate official eBay market-data paths and must never mix their meanings:

1. **Marketplace Insights completed sales** — valuation-eligible only when the connected eBay application has approved access and `EBAY_MARKETPLACE_INSIGHTS_ENABLED=true`.
2. **Browse active listings** — live asking-price context only. Active listings never set ManeFlow market value.

Seller Fulfillment order imports are seller-authorized transaction history for the connected seller account. They are not a substitute for market-wide completed-sale history.

## Customer pricing flow

After an exact card identity is confirmed, ManeFlow's automatic pricing engine:

1. builds an identity-specific eBay query from year, brand, set/product, subject, card number, parallel/variation, grader, and grade;
2. refreshes authorized completed-sale evidence when stale or explicitly forced;
3. ingests returned sales through the canonical pricing-data normalization, rights, matching, duplicate, and comp-quality controls;
4. calculates value only from eligible completed-sale evidence;
5. retrieves live Buy It Now listings separately as asking-price context;
6. returns **Valuation unavailable.** when completed-sale evidence is insufficient.

## Explicit live refresh

Authenticated clients can request the freshest authorized snapshot with:

```text
GET /api/pricing/cards/:cardId?refresh=1
```

The response includes both `pricing` and `liveMarket`. `liveMarket` exposes whether completed-sale evidence is available, whether the current request actually performed a completed-sale refresh, active-listing count, provider refresh state, and the strict valuation/asking-price usage boundary.

A normal request without `refresh=1` keeps the existing bounded cache/staleness behavior so repeated card views do not unnecessarily consume provider quota.

## Configuration

Required for eBay Browse active listings:

```text
EBAY_CLIENT_ID
EBAY_CLIENT_SECRET
EBAY_ENVIRONMENT=production
EBAY_MARKETPLACE_ID=EBAY_US
```

Additionally required for Marketplace Insights completed sales:

```text
EBAY_MARKETPLACE_INSIGHTS_ENABLED=true
```

Setting the flag does not grant eBay entitlement. The connected application must actually be approved for the limited-release Marketplace Insights endpoint. Provider errors are surfaced and fail closed; ManeFlow must not relabel Browse asking prices as sold comps.

## Release verification

Before production claims of live eBay sold pricing:

- verify the deployed eBay application credentials without exposing them;
- make a real Marketplace Insights request for a human-confirmed card;
- confirm a successful authorized response and provider timestamp;
- confirm exact card/grade/parallel comp filtering;
- confirm active listings have `valuationUse=false`;
- confirm insufficient completed-sale evidence renders `Valuation unavailable.`;
- run the complete repository CI gate;
- deploy an exact canonical Git commit and record release provenance.
