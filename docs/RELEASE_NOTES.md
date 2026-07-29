# ManeFlow v2.8.1-beta.2 Release Notes

## Unified application

The historical ManeFlow v2.5 business core and the newer imaging/lot system are now organized as one desktop application. The Electron shell starts both local services and presents one interface.

## Added

- Local FastAPI vision worker integrated with the ManeFlow core
- Single-card, multi-card, mixed-scene, and eBay-lot analysis
- Ricoh duplex bulk scan import and front/back pairing
- ordered high-volume review workflow
- content-addressed image storage and restart-safe SQLite state
- front/back identity evidence fusion
- local owner-approved reference matching
- tester consent scopes and revocation
- sanitized recognition contribution packs
- owner curation queue
- stable train/validation/locked-test dataset manifest
- secure desktop credential storage for OpenAI, PSA, and eBay settings
- Windows embedded Python + electron-builder packaging pipeline
- integrated beta smoke test

## Preserved from v2.5

- verified-comp trust boundaries
- active-listing separation from sold comps
- collection/Vault operations
- grading and merchant workflows
- catalog lookup and autocomplete
- portfolio and dealer decision intelligence
- user/shop isolation
- correction history
- existing regression coverage

## Safety and data boundaries

- no filename-only identity guessing
- no face-only real-person identification
- no invented price when verified comps are absent
- no private cost/value/seller/inventory fields in recognition datasets
- imported tester examples are never auto-approved
- rejected and revoked examples are excluded from matching/training use

## Beta limitation

A Windows build runner must create the distributable installer. The Linux source-validation environment cannot truthfully produce or execute the final Windows `.exe`.
