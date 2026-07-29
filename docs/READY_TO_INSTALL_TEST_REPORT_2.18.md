# ManeFlow 2.18.0-beta.1 Ready-to-Install Test Report

Generated: 2026-07-23

## Release package

This Windows beta installs ManeFlow into the current user's local application directory, creates Desktop and Start Menu shortcuts, starts the local core and vision services, and opens ManeFlow in an app-style Edge or Chrome window. An optional script builds the native Electron NSIS installer and portable executable on Windows.

## Automated verification

- JavaScript source/config validation: passed (158 files/manifests checked)
- Node test suite: passed (202/202)
- Python vision test suite: passed (57/57)
- Secret-pattern release scan: passed
- Core smoke test: passed
- Desktop Electron configuration check: passed
- User-image decode/detection pipeline: passed (20/20 images decoded)
- Full FastAPI `/v1/scan` request: HTTP 200, one card object detected on the sampled image

## PSA partner upgrade

- Supports `PSA_API_KEY` and legacy `PSA_API_TOKEN` environment names.
- PSA base URL and authorization scheme are configurable server-side.
- Nested PSA cert responses are normalized into the ManeFlow card identity schema.
- A verified PSA response can authoritatively enrich player, year, brand/set, card number, grade, and cert number.
- PSA cert enrichment is activated when a PSA cert URL/value is decoded from a slab or when a configured identity provider returns a PSA cert.
- The Electron desktop settings page stores the PSA credential using Windows-backed secure storage and includes a live cert test control.
- The Windows installer imports an existing private `.env` from the extracted package, a prior installation, or a ManeFlow folder under Downloads/Documents/Desktop.

## Image test result interpretation

All 20 supplied images decoded successfully. Fourteen produced at least one conservative card boundary detection; six were accepted and processed using whole-image/manual-review behavior. This is expected for screenshots, tightly cropped cards, unusual backgrounds, or images where a rectangular contour is not sufficiently isolated.

Exact raw-card identification still requires sufficient visible/OCR/reference evidence or a configured vision identity provider. The app does not fabricate an exact identity or price when evidence is missing. PSA slabs with a decodable cert and a valid PSA partner credential can be verified through PSA.

## External conditions not tested in this environment

- The user's live PSA credential was not present in the uploaded release archive, so no live authenticated PSA request was executed here.
- eBay production keys were not available.
- The final NSIS `.exe` must be compiled on Windows by `Build-Native-ManeFlow-Installer.cmd`; this release includes the complete automated Windows build path.
- The unsigned private beta can trigger Microsoft SmartScreen until a code-signing certificate is applied.
