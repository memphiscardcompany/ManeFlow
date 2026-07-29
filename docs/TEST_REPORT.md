# ManeFlow v2.8.1-beta.2 Verification Report

## Authoritative command

```bash
npm run verify:beta
```

## Coverage

### Node core

- legacy ManeFlow pricing, catalog, Vault, account, merchant, grading, source-rights, and recognition contracts
- worker client and safe failure behavior
- multipart scan forwarding
- contribution example listing/curation
- approved dataset manifest client

### Python vision worker

- single and lot APIs
- conservative pricing fallback
- card detection and quality metrics
- front/back evidence fusion
- Ricoh filename and alternating pairing
- natural numeric ordering
- batch import/process/review/export
- private-field sanitization
- contribution pack import/export
- owner curation
- approved reference matching
- ORB/RANSAC geometric verification
- deterministic train/validation/test dataset manifest

### Integrated services

The integration test launches isolated Node and FastAPI services, creates contributor consent, imports a temporary Ricoh folder, reviews a card, verifies sanitization, owner-approves the example, checks contribution statistics, and shuts down cleanly.

### Desktop

- Electron source syntax
- context isolation
- renderer sandbox
- no Node integration
- local service paths
- embedded worker package path
- Windows installer and portable build configuration

## Current verified counts

Latest completed full verification:

- 155 Node tests passed
- 40 Python tests passed
- Node smoke test passed
- integrated beta smoke test passed
- Electron configuration check passed
- 125 JavaScript/JSON/release files passed source validation

## Windows-only validation still required

- embedded Windows Python and vision-worker boot on Windows 11
- NSIS install/update/uninstall
- portable executable launch
- clean-PC dependency check
- Defender/SmartScreen behavior
- large Ricoh batch soak test
