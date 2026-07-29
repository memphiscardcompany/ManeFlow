# Launch Checklist - ManeFlow v2.5

## Product Package

- [x] Node.js 22 backend
- [x] PWA
- [x] Expo native source
- [x] Electron desktop shell
- [x] multi-shop organization model
- [x] shop inventory isolation
- [x] website embed kit
- [x] scan confidence pipeline
- [x] elite scan pipeline with front/back/cert confidence and correction learning
- [x] Cert Accuracy Engine 2.0
- [x] cert accuracy extraction page and API
- [x] smart catalog lookup from loaded checklist rows
- [x] owned/export-derived checklist import
- [x] approved public checklist collector for identity data only
- [x] Pokemon TCG API, TCGdex, Scryfall bulk, Lorcast, YGOPRODeck, sports checklist, and generic authorized TCG CSV importers
- [x] duplicate-aware Vault and shop inventory quantity updates
- [x] manual Vault and shop inventory entry with safe unmatched-card handling
- [x] reliable card image fallback in search, detail, Vault, mobile, and public value pages
- [x] configurable remote image source resolver
- [x] lawful image enrichment dry-run/import/rollback and coverage reports
- [x] stronger vision prompt and confidence-weighted catalog matching
- [x] internal recognition benchmark lab for lawful real-world photo datasets and owner test images
- [x] high-value low-confidence scan confirmation gate
- [x] active BIN asking-price context separated from completed-sale value
- [x] merchant pricing center
- [x] bulk intake/show mode
- [x] provider import job controls
- [x] Owner Data Ops Workbench
- [x] public-safe valuation page
- [x] mobile release config checker
- [x] store distribution readiness checker
- [x] mobile store metadata drafts
- [x] desktop Microsoft Store metadata draft
- [x] tests and docs

## Owner Activation

- [ ] deploy to `https://mane.memphiscardcompany.com`
- [ ] configure `ALLOWED_ORIGINS`
- [ ] configure `MANEFLOW_WIDGET_ALLOWED_ORIGINS`
- [ ] configure transactional email
- [ ] connect authorized completed-sale data feeds
- [ ] configure approved remote card-image hosts or accept identity-only placeholders
- [ ] import image enrichment rows only from approved media sources or licensed CDNs
- [ ] import or license comprehensive catalog/checklist data for production-grade set autocomplete
- [ ] run recognition benchmarks against owner photos and approved/open datasets before store beta
- [ ] complete legal/data-license review
- [ ] set production `MANEFLOW_DEMO_MODE=false` only after authorized comps exist
- [ ] configure Apple, Google, Expo, and signing accounts
- [ ] run TestFlight / Google closed testing
- [ ] prepare desktop signing, MSIX, Microsoft Partner Center, and notarization if distributing installers
- [ ] configure Stripe, Apple, or Google billing before paid public launch

## Data Trust Gates

- [ ] run provider imports in dry-run mode before writing live data
- [ ] confirm comp-quality included/excluded counts in Owner Control Room
- [ ] confirm cert extraction shows `cert_locked` only when barcode/label evidence has no conflicts
- [ ] confirm cert results say `parsed_not_officially_verified` unless an official verifier is actually connected
- [ ] confirm card images either load from approved configured hosts or show the ManeFlow placeholder with rights metadata
- [ ] confirm image enrichment dry-runs before imports and rollback works by provider batch ID
- [ ] confirm high-value cards with less-than-elite scan confidence require manual confirmation
- [ ] confirm recognition benchmarks show acceptable top-1, top-3, field, and false-confident metrics across raw, slabbed, table, and binder photos
- [ ] confirm manual add autocomplete shows loaded set coverage and does not invent missing checklist rows
- [ ] confirm the Owner Data Ops Workbench shows source policies, acquisition runs, and manual comp review state
- [ ] confirm manual evidence remains review-only until approved and promoted
- [ ] confirm active listings never appear as completed-sale valuation comps
- [ ] confirm active BIN listings appear only as `askingPriceContext` and listing guidance
- [ ] confirm every public value page displays demo/live mode, included comp counts, and value disclaimers
- [ ] confirm real-time pricing claims are disabled until authorized live feeds are connected and observed healthy

## Production Gates

- [ ] confirm `/readyz` returns ready before routing production traffic
- [ ] confirm `MANEFLOW_EXPOSE_DEV_TOKENS=false`
- [ ] confirm public widget origins are restricted
- [ ] confirm dealer-decision routes are Merchant/Enterprise gated
- [ ] confirm `node scripts/check-mobile.js`
- [ ] confirm `node scripts/check-desktop.js`
- [ ] confirm `node scripts/check-store-readiness.js`
- [ ] verify the release ZIP with `node scripts/verify-release.js`

## Store Distribution Gates

- [ ] review `docs/STORE_DISTRIBUTION_CHECKLIST.md`
- [ ] review `docs/MOBILE_RELEASE_PIPELINE.md`
- [ ] review `docs/DESKTOP_RELEASE_PIPELINE.md`
- [ ] review `docs/PRIVACY_DISCLOSURES.md`
- [ ] add final screenshots and store graphics
- [ ] add production privacy, terms, and support URLs
- [ ] prepare app reviewer demo account
- [ ] run `npm run store:check`

## Claims Discipline

Do not claim real-time market coverage until scheduled imports or provider APIs are authorized, configured, and observed healthy. Demo data remains visibly labeled. Values are estimates, not appraisals, guarantees, authentication, grading opinions, tax advice, legal advice, or investment advice.
