# ManeFlow Comp Quality Engine

ManeFlow v1.4 includes an auditable comp-quality layer between source ingestion and valuation. Every comparable sale is scored before it can influence market value.

## Scored fields

Each comp receives:

- `qualityScore`
- `matchScore`
- `sourceTrustScore`
- `freshnessScore`
- `priceReliabilityScore`
- `dataCompletenessScore`
- `inclusionStatus`
- `reviewStatus`
- `valuationUse`
- `reasons[]`
- `warnings[]`
- `auditTrail[]`
- `sourceMode`
- `authorizationBasis`
- `scoredAt`

## Inclusion statuses

- `included`
- `needs_review`
- `excluded_duplicate`
- `excluded_outlier`
- `excluded_active_listing`
- `excluded_wrong_card`
- `excluded_wrong_grade`
- `excluded_wrong_parallel`
- `excluded_unverified_source`
- `excluded_demo_in_production`
- `excluded_missing_price`
- `excluded_missing_sale_date`

## Rules

- Active listings are never used as completed-sale comps.
- Demo comps are excluded when production mode is enabled.
- Completed sales must have a valid all-in price and sale date.
- Official APIs, written licenses, commercial partners, user-authorized exports, and user CSVs are eligible data-access bases.
- Low source trust or low match confidence routes a comp to review instead of valuation.
- Duplicate and IQR outlier exclusions are visible on the comp record.
- Data-completeness issues create warnings and lower quality scores without breaking backward-compatible legacy/test imports unless other hard-exclusion rules apply.
- Admin review overrides are audited and persisted.

## Services

- `src/services/comp-quality.js` scores and explains comps.
- `src/services/valuation.js` consumes only `valuationUse=true` comps.
- `src/services/data-health.js` summarizes provider, catalog, and valuation readiness.
- `src/services/pricing-data.js` validates and imports authorized pricing data before it reaches valuation.
- `src/services/normalizer.js` preserves source-rights metadata from imports.
- `src/router.js` exposes user-safe comp transparency endpoints and admin review endpoints.

## Public promise

ManeFlow shows why every comp was included or excluded. Values are estimates, not appraisals, authentication, grade guarantees, or investment advice.
