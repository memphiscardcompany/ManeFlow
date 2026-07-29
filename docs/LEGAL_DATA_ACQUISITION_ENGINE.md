# Legal Data Acquisition Engine

ManeFlow v1.9 exposes the internal acquisition system through the Owner Data Ops Workbench for turning legally usable market evidence into reviewed pricing intelligence.

This is not an unrestricted scraping system. It is a rights-aware workflow for official APIs, seller-authorized data, user exports, partner feeds, signed webhooks, admin-captured comps, screenshots, receipts, invoices, and approved public sources.

## Source Rights First

Every acquisition path is checked by `src/services/acquisition-gate.js` before it can run.

The gate verifies:

- source is registered
- legal review is approved
- owner approval is approved
- URL is not login/private/paywall/CAPTCHA/admin/checkout
- source path is allowed
- robots text allows the path when supplied
- crawl delay and rate budgets are respected
- valuation/display/storage eligibility is known

Unknown sources fail closed.

## Manual Evidence

Admins can capture visible comps through:

- `POST /api/admin/manual-comps`
- `POST /api/admin/evidence/parse`
- `POST /api/admin/manual-comps/:id/review`
- `POST /api/admin/manual-comps/:id/promote`

Manual comps always start as `needs_review` and `valuationUse=false`. Promotion is blocked until an admin approves the evidence with `valuationUse=true`.

## Public Collection

`src/services/public-web-collector.js` exists for approved public sources only. It uses a transparent user agent:

```text
ManeFlowDataBot/1.0 (+https://mane.memphiscardcompany.com/data-policy)
```

It does not bypass logins, paywalls, CAPTCHA, bot controls, private pages, or disallowed paths. Output is quarantined for review.

## Marketplace Boundaries

- eBay Marketplace Insights requires approved access.
- eBay Seller Orders are seller-account data only.
- eBay Browse is active listing context only.
- TCGplayer and Whatnot require approved/API/user-authorized paths.
- Goldin, Heritage, Fanatics Collect, COMC, and Card Ladder require written license, partner feed, user export, or manual/review workflow.
- TCDB and COMC are blocked by default in the data-rights registry unless written permission, partner access, or owner-authorized exports are recorded.
- Apify actor output is not automatically usable; the target website's terms and permission still control whether the data can be imported.

## Catalog and Benchmark Boundaries

ManeFlow supports official/API or authorized catalog sources for identity and image URLs:

- Pokemon TCG API
- TCGdex
- Scryfall
- Lorcast
- YGOPRODeck
- authorized sports checklist CSV/JSON
- authorized TCG CSV

Catalog rows are identity data only. They improve search, autocomplete, scan matching, cert matching, and inventory logging, but they do not create market values.

Internal recognition benchmarks can use lawful owner photos or approved/open datasets through:

```text
GET  /api/admin/recognition-benchmarks
POST /api/admin/recognition-benchmarks/run
```

Benchmark data measures scanner accuracy only. It is not completed-sale evidence and must not become public pricing data.

## Valuation Rule

Only records with completed sale, valid price, valid date, source rights, accepted match, comp-quality approval, and `valuationUse=true` can affect market value.

This documentation is operational guidance, not legal advice. Owner/legal review is required before enabling a new automated public source.
