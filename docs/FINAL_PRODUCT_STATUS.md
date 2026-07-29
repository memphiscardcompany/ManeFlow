# ManeFlow v2.5 Final Product Status

Release: **ManeFlow v2.5 State-of-the-Art Recognition Final**

ManeFlow v2.5 upgrades v2.4 with a scene-aware card recognition system that treats scans as real-world hobby images: single cards, table layouts, binder pages, mixed raw/slab groups, sealed packs/boxes, and cert-label closeups. It keeps v2.4's deeper scan trust, Cert Accuracy Engine 2.0, lawful image enrichment operations, stronger sports/TCG catalog coverage, and current Buy It Now asking-price context that informs listing strategy without changing completed-sale value.

Post-candidate portfolio upgrade: ManeFlow now includes Portfolio Decision Intelligence, a completed-sale-only action layer that makes the Vault and shop inventory views feel closer to a stock app or advanced collection-pricing dashboard.

Daily-experience polish pass: the core scan, search, card detail, Vault, mobile row, and desktop connection flows now surface clearer loading, empty, error, image-source, cert-status, and scan-confidence language without adding new product scope.

Data-driven recognition hardening pass: ManeFlow now has explicit lawful-data source policies for the public/API datasets discussed, TCGdex and YGOPRODeck catalog/image import support, and an internal recognition benchmark lab for real-world photo datasets.

Live-listing scanner QA pass: owner-supplied eBay Shohei lot images were staged in the excluded runtime benchmark workspace and used to validate the folder benchmark workflow. ManeFlow also now includes an official eBay Browse API image-discovery tool for creating future internal scanner benchmark manifests without scraping listing pages.

## Complete In This Release

- Elite Scan Pipeline with front/back/cert evidence, field-level confidence, top candidates, explanations, retake guidance, and correction-learning records.
- State-of-the-Art Recognition Engine with scene classification, multi-card region payloads, normalized bounding boxes, fast/accurate path selection, region-level trust summaries, and correction-learning re-ranking.
- Sealed product recognition for packs, hobby boxes, blasters, retail boxes, booster boxes, tins, ETBs, and sealed cases using product name, product type, configuration, SKU, UPC, brand, set, and year.
- Cert Accuracy Engine 2.0 with PSA, BGS, SGC, and CGC cert/barcode/label parsing, conflict detection, and parsed-vs-official labels.
- Remote Card Image Resolver: `src/services/card-images.js`.
- Universal Lawful Image Enrichment: `src/services/image-enrichment.js`.
- Built-in image source profiles for Pokemon TCG API, Scryfall, Lorcast, approved TCGplayer media, authorized eBay API image context, and owner-configured licensed CDNs.
- Built-in image source profiles now also include TCGdex and YGOPRODeck remote image hosts.
- Public-safe image source status and coverage endpoints: `GET /api/card-images/sources`, `GET /api/card-images/coverage`.
- Admin image enrichment dry-run, import, rollback, and audit routes.
- Search, autocomplete, detail, Vault, inventory, public value, and mobile rows use resilient card-image fallbacks.
- Vision prompt returns scene understanding, detected card regions, structured facts, field confidence, visual markers, image-quality analysis, slab/cert fields, and uncertainty reasons.
- Vision output feeds the catalog matcher with confidence-weighted terms.
- Scan Confidence uses blur, glare, crop, lighting, angle, back-image, cert, parallel, rookie/auto/relic, and high-value gates.
- Sports checklist importer and stronger TCG catalog import coverage reporting.
- TCG catalog importers now cover Pokemon TCG API, TCGdex, Scryfall, Lorcast, YGOPRODeck, and generic authorized TCG CSV exports.
- Recognition Benchmark Lab: `src/services/recognition-benchmark.js`, `scripts/run-recognition-benchmark.mjs`, `GET /api/admin/recognition-benchmarks`, and `POST /api/admin/recognition-benchmarks/run`.
- Folder Recognition Benchmark Runner: `scripts/run-recognition-folder-benchmark.mjs` with field-level, scene-level, multi-card/binder, failure-pattern, and scaffold-aware reporting.
- eBay Browse Benchmark Image Discovery: `scripts/discover-ebay-benchmark-images.mjs` creates internal QA manifests and label scaffolds from official API listing image URLs.
- Data Rights Registry now explicitly separates catalog/image/benchmark/pricing-context/valuation eligibility for open datasets, TCG APIs, commercial APIs, Apify actor output, TCDB, and COMC.
- Current BIN asking-price context engine for new-release/listing strategy.
- Valuation exposes completed-sale confidence separately from pricing confidence.
- Portfolio Decision Intelligence: market movement, valuation confidence, liquidity, momentum, relative strength, and Sell now / Hold / Buy more / Wait recommendations per owned card.
- Shop inventory action queues: list candidates, hold candidates, reprice candidates, and review-first candidates.
- Daily workflow polish across search/autocomplete, scan confirmation, card detail image-source labeling, Vault empty/manual-review states, native card rows, and desktop offline handling.
- PostgreSQL storage mode now fails closed until a full production store adapter is implemented.
- New tests cover scene-aware recognition, binder/table region matching, ambiguous parallels, correction-learning ranking, card image resolution, public-safe image payloads, image enrichment, sports/TCG imports, vision-to-catalog ranking, scan quality warnings, cert parsing, active BIN context, and high-value scan gates.

## Operational Systems Retained

- Smart Catalog Autocomplete and checklist intelligence.
- Owned/export checklist importer.
- Approved public checklist collector for identity data only.
- Pokemon TCG API, Scryfall bulk, Lorcast API, and generic authorized TCG CSV import support.
- TCGdex and YGOPRODeck import support for Pokemon and Yu-Gi-Oh catalog/image coverage.
- Internal benchmark support for owner photos and approved/open recognition datasets.
- Cert Accuracy Intelligence and graded-card cert extraction.
- Current BIN asking-price context for listing strategy only.
- Comp Quality Engine and valuationUse enforcement.
- Pricing Data Engine with dry-run, rollback, idempotent imports, and source tracking.
- eBay approved API and seller-order integration paths.
- Legal Data Acquisition Workbench and Data Rights Registry.
- Portfolio and Inventory Intelligence.
- Completed-sale-only portfolio decision support.
- Multi-shop organizations, roles, inventory, invites, and audit logs.
- Merchant Pricing Center and Bulk Intake / Show Mode.
- Website Integration Kit.
- Owner Control Room.
- Expo native source and Electron desktop shell.
- Docker, backup/restore, doctor scripts, OpenAPI, and release packaging.

## Still External

The package does not include live marketplace credentials, marketplace data contracts, production DNS, Stripe keys, Apple/Google/Expo signing accounts, transactional email credentials, production database credentials, remote image licenses, or legal approvals.

ManeFlow can display bundled demo art, configured remote images, TCG provider images, admin-enriched rights-approved images, and the ManeFlow placeholder. It does not claim universal card-image rights.

ManeFlow can benchmark lawful image datasets locally. Benchmark data improves recognition testing only; it does not become public card image coverage, completed-sale evidence, or market value. eBay Browse listing images discovered or supplied for scanner QA are internal benchmark inputs only and are excluded from release packaging.

Public real-time pricing claims still require authorized live completed-sale feeds and production deployment.

## Honest Boundary

Bundled data is demonstration data. Catalog/checklist rows are identity data only. Active listings are context only. Manual and screenshot evidence starts as review-only. Cert extraction supports identity review and does not guarantee authenticity, holder integrity, grade accuracy, or card value. Values are estimates, not appraisals, guarantees, authentication, grading opinions, tax advice, legal advice, or investment advice.
