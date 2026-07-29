# Portfolio & Inventory Intelligence Engine

ManeFlow includes a dedicated intelligence layer for collectors and shops. The engine converts trustworthy card valuations into portfolio, tax, scenario, inventory, and action insights without becoming a marketplace or auction system.

## Files

- `src/services/portfolio-intelligence.js`
- `src/services/portfolio-decisions.js`
- `tests/portfolio-intelligence.test.js`
- `tests/portfolio-decisions.test.js`
- `src/services/portfolio.js` compatibility wrapper
- `router.js` personal and admin portfolio endpoints
- `public/app.js` Vault, card-detail, and Owner Control Room panels

## Core functions

- `calculatePortfolioMetrics(collection, options)`
- `calculateROI(collection, options)`
- `generateAllocationBreakdown(collection, options)`
- `generateTaxEstimate(collection, options)`
- `runScenarioAnalysis(collection, scenario, options)`
- `getInventoryHealth(collection, options)`
- `getSmartRecommendations(collection, options)`
- `getPortfolioTrends(collection, period, options)`
- `buildPortfolioIntelligence(collection, options)`
- `buildPortfolioDecisionSupport(collection, options)`
- `buildCardDecisionSignal(holding, options)`
- `buildShopInventoryDecisionSupport(inventory, options)`

## How values are calculated

The engine does not calculate prices directly from raw sales. It calls `valuation.js`, which uses `comp-quality.js`. That means portfolio values are based only on comps that pass the existing inclusion rules and have `valuationUse=true`.

Excluded comps do not affect portfolio metrics. This preserves the product boundary established by the Comp Quality Engine:

- active listings are excluded
- missing all-in prices are excluded
- missing sale dates are excluded
- wrong-card, wrong-grade, and wrong-parallel comps are excluded or sent to review
- demo comps are blocked from production value use
- outliers and duplicates are visible but excluded from valuation use
- active BIN/ask prices are secondary context only and are never mixed into completed-sale averages

## Collector intelligence

Collector-facing dashboards include:

- current value
- cost basis
- unrealized gain/loss
- realized gain/loss when sold records include sale price
- estimated liquid value
- ROI by player, set, year, sport, and grade tier
- concentration risk
- low-confidence value count
- stale-value count
- top gainers, top decliners, and most-liquid holdings
- smart recommendations
- market movement tracking
- valuation confidence, separate from scan confidence
- liquidity signals
- momentum and relative-strength indicators
- action recommendations: Sell now, Hold, Buy more, or Wait

## Portfolio Decision Intelligence

`portfolio-decisions.js` turns valuation evidence into action support. Each owned card receives:

- `movement`: current value, 30-day/90-day estimated change, completed-sale trend, and sale-window stats
- `valuationConfidence`: confidence based on completed-sale volume, comp quality, source trust, match quality, diversity, and freshness
- `liquidity`: 90-day volume, monthly velocity, last-sale age, and liquidity label
- `momentum`: 30-day/90-day movement, short momentum, and relative strength versus the portfolio
- `recommendation`: Sell now, Hold, Buy more, or Wait, with reasons, risks, and conviction

The decision system is intentionally conservative. Thin data, stale comps, weak source diversity, low confidence, or unclear movement pushes cards to `Wait` instead of inventing certainty.

Current BIN/ask data can appear as a labeled secondary context object when it was supplied through approved asking-price paths. It does not affect market value, ROI, portfolio movement, confidence, or true action scores.

## Scenario modeling

The scenario endpoint models what could happen if:

- selected cards are sold
- the market drops by a user-entered percentage
- the market rises by a user-entered percentage
- selling fees reduce proceeds

Scenario outputs are projections. They are not guarantees.

## Tax-ready summaries

Tax reports include:

- total cost basis
- realized short-term gains
- realized long-term gains
- unrealized short-term gains
- unrealized long-term gains
- estimated tax on realized gains
- estimated tax if the portfolio were liquidated

These reports are organizational tools only. They are not tax advice. The engine does not account for every possible tax treatment, state tax, business inventory accounting method, deduction, or individual filing situation.

## Shop inventory intelligence

Merchant and Enterprise accounts can export inventory health reports. Owner/admin can view shop summaries in the Control Room.

Inventory Health includes:

- inventory value
- active listed items
- grading items
- consigned items
- average inventory age
- aging low-liquidity stock
- low-stock alerts
- suggested reorder points
- velocity leaders
- stale-pricing flags
- list candidates
- hold candidates
- reprice candidates
- review-first candidates

## Privacy and access control

Personal portfolio intelligence is calculated only from the authenticated user's private Vault. Users cannot query another user's collection.

Shop-level inventory intelligence requires a Merchant or Enterprise entitlement for user export routes. Administrator routes summarize portfolio and shop inventory data only for owner operations.

## Required data for best accuracy

The most useful metrics require:

- accurate card identity and catalog matching
- quantity
- purchase price / cost basis
- purchase date
- status, such as owned, listed, consigned, sold, or grading
- sold price for realized gain reporting
- high-quality production comps from authorized sources

## Limitations

ManeFlow Intelligence is decision support, not financial, tax, legal, appraisal, authentication, or grading advice. Values are estimates based on included comps, user-entered cost records, source freshness, and comp-quality confidence.
