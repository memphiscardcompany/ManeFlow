# ManeFlow v2.8.0 Beta Build Status

## Current canonical line

**ManeFlow v2.8.1-beta.2 Unified Desktop**

This line merges the tested v2.5 ManeFlow core with the newer local FastAPI imaging worker, Ricoh bulk intake, eBay-lot analysis, and opt-in recognition-learning pipeline.

## Implemented

### Unified desktop

- Electron desktop shell
- Local Node.js core service
- Local FastAPI vision worker
- Automatic service startup and restart
- Local-only loopback ports
- Windows secure credential storage
- Data/log folder access
- NSIS installer and portable targets
- embedded Windows Python vision runtime

### Recognition and imaging

- Single-card scan API
- Multi-card and mixed-container lot analysis
- Raw card, slab, toploader, one-touch, pack, stack, bag, box, and partial-card object classes
- Perspective correction and crop normalization
- Quality metrics for blur, glare, brightness, exposure, and resolution
- Barcode/cert evidence path
- Front/back evidence fusion
- Conservative unresolved/no-price behavior
- Owner-approved local reference matching with exact SHA and ORB/RANSAC geometric verification

### Ricoh bulk workflow

- Duplex folder import
- JPEG/PNG/WebP/TIFF support
- Natural numeric ordering
- Filename and alternating pairing
- Content-addressed image storage
- Ordered batch processing
- 100-item review pages
- Corrections and confirmations
- CSV export
- Restart-safe SQLite state

### Consent and learning

- Private, labels-only, images-and-labels, and reference-catalog scopes
- Revocation on the contributor's local database
- Private financial/inventory fields stripped from recognition examples
- Portable contribution ZIP export/import
- Owner approval/rejection queue
- Only owner-approved records used for reference matching
- Stable 80/10/10 content-hash train/validation/test dataset manifest
- Contributor identity omitted from the approved dataset manifest

## Verified in the current source environment

- Node core test suite
- Python worker test suite
- Node live smoke test
- Node ↔ FastAPI integration
- Ricoh import and pairing
- correction → contribution → owner curation flow
- private-field exclusion
- stable dataset splitting
- Electron security and package configuration

Run the authoritative check:

```bash
npm run verify:beta
```

## Requires Windows runner before distribution

- embedded Windows Python runtime boot
- Electron NSIS installer
- Electron portable executable
- clean Windows 11 install test
- Windows Defender/SmartScreen behavior test
- signed installer, if a code-signing certificate is obtained

## External configuration still required for full live value

- rotated PSA API credential
- eBay production application credentials
- server-side vision credential/model selection
- authorized completed-sale pricing feed
- production/reference catalog rights

No provider credential is embedded in source or installer artifacts.
