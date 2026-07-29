# Asking Price Context

ManeFlow v2.5 can consider current Buy It Now listings for pricing context without treating them as completed-sale value.

## Purpose

Active asking prices are useful when:

- a set is brand new
- completed comps are thin
- a shop needs a listing anchor
- a dealer wants to see whether current asks agree with sold comps
- a card has market movement before enough sales settle

They are not useful as market value by themselves. Sellers can ask any price, and active listings do not prove buyer demand.

## Files

```text
src/services/asking-price-context.js
src/providers/ebay.js
src/services/valuation.js
src/services/dealer-decision.js
```

## Data Boundary

Active BIN records use:

```text
sourceType=active_listing
listingType=buy_it_now_asking
saleType=asking
dataRightsStatus=active_listings_only_not_for_valuation
valuationUse=false
```

`valuation.value` remains completed-sale only.

`valuation.askingPriceContext` adds:

- listing count
- low, p25, median ask, p75, high
- spread
- source count
- ask-versus-value alignment
- pricing confidence
- pricing rating
- new-release usefulness
- public warnings

`valuation.pricingConfidence` and `valuation.pricingRating` may use active BIN context. They are decision-support fields, not market value fields.

## Dealer Use

Merchant Pricing Center can use BIN context for:

- fair-list price
- patient-list price
- new-release starter listing guidance
- risk warnings
- pricing confidence

Cash-buy targets still require completed-sale value. If no completed-sale value exists, ManeFlow recommends manual research before buy decisions.

## Legal And Trust Rules

- Do not scrape unauthorized sources.
- Use official APIs, authorized account data, partner feeds, or owner-approved imports.
- Do not store or expose provider credentials.
- Do not present active listings as completed sales.
- Do not call BIN context an appraisal, guarantee, or public market value.
