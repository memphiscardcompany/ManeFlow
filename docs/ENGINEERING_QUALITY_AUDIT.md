# ManeFlow Engineering Quality Audit

Release: **ManeFlow v2.5 State-of-the-Art Recognition Final**

## Solid Systems

- Comp Quality, Pricing Data, and Valuation form a strong trust pipeline: active listings, demo-only production data, bad dates, bad prices, duplicate comps, outliers, and source-rights failures are kept out of valuation use.
- Smart Catalog Autocomplete is practical and tested for PSA-style inventory/collection logging, long checklists, TCG numbering, serial-numbered cards, 1/1s, error variants, punctuation, accents, and duplicate-aware quantity updates.
- Cert Accuracy Intelligence extracts grader, grade, cert number, barcode/QR payloads, slab text, official cert URLs, and conflicts before scan confidence is calculated.
- Multi-shop inventory, organization roles, invites, and audit logs are real enough for controlled beta use.
- Website widgets and public value endpoints enforce origin and public-safe data boundaries.
- Verification tooling covers syntax, tests, smoke, mobile config, desktop config, and release ZIP safety.

## Fixed In v2.4

- Scan sessions now preserve top candidates, match explanations, manual confirmation reasons, and user correction records.
- Cert status labels now clearly separate parsed evidence from official verification.
- PSA, BGS, SGC, and CGC cert parsing has dedicated coverage.
- Image enrichment is now an auditable admin workflow with dry-run, import, rollback, rights metadata, coverage reporting, and host allow-listing.
- Catalog coverage reports now include sport/game/year/set depth and image-readiness signals.
- Sports checklist CSV/JSON imports are first-class catalog import paths.
- Current Buy It Now asking prices now produce a separate pricing context and pricing-confidence signal for new releases and listing strategy.
- Active BIN listings remain `valuationUse=false` and cannot change completed-sale value.
- PostgreSQL mode now fails closed because a complete JsonStore-compatible Postgres adapter is not shipped in this package.

## Remaining Gaps

- Public real-time pricing claims still require authorized live completed-sale feeds and production deployment.
- eBay Marketplace Insights access remains credential and approval dependent; seller-order imports cover only authorized seller data.
- eBay Browse BIN context requires eBay client credentials and should be treated as active asking context only.
- Partner provider modules are readiness stubs until written agreements or approved APIs are connected.
- JsonStore is suitable for local, demo, and controlled beta operation. A real production database adapter remains future work.
- Redis/job-runner infrastructure is not a full production queue in this package.
- Native mobile is a strong companion client but does not yet expose every owner/shop/admin workflow from the PWA.
- Electron is a hardened shell, not a full native desktop product.
- Image preprocessing is lightweight browser normalization, not a full OpenCV crop/deskew pipeline.

## Fixed In Data-Driven Recognition Pass

- Added TCGdex and YGOPRODeck catalog importers so Pokemon and Yu-Gi-Oh coverage can come from documented API exports instead of ad hoc files.
- Added built-in remote image host allow-list entries for TCGdex and YGOPRODeck.
- Added explicit source policies for open/internal recognition datasets, commercial recognition APIs, pricing-context vendors, Apify actor output, TCDB, and COMC.
- Added `src/services/recognition-benchmark.js` for internal real-world scanner evaluation across JSON, CSV, and dataset-style labels.
- Added `scripts/run-recognition-benchmark.mjs` and `npm run recognition:benchmark` for repeatable local scan-accuracy reports.
- Added admin-only recognition benchmark history and run endpoints.
- Added an Owner Control Room Recognition Benchmark Lab panel.
- Added tests proving benchmark data remains internal testing evidence and cannot create public market values.

## Next Highest-ROI Work

1. Connect the first approved completed-sale feed or seller-authorized data source and run it through the existing pricing pipeline.
2. Run recognition benchmarks against owner phone photos and approved/open datasets, then use the weakest fields to tune prompts, catalog ranking, and confirmation thresholds.
3. Add a complete production database adapter or deploy a managed service that implements the same store contract.
4. Deepen camera preprocessing with real card boundary detection, crop, deskew, and label close-up guidance.
5. Bring the most important merchant workflows from the PWA into mobile shop mode.
