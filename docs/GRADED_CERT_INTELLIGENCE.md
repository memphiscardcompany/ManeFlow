# Graded Cert Intelligence

ManeFlow v2.4 turns graded-card cert extraction into Cert Accuracy Engine 2.0. The scanner, standalone cert page, and `/api/cert/extract` endpoint can read barcode/QR payloads, visible slab text, optional cert-label images, and AI vision facts, then compare those evidence streams before a graded card is treated as trusted.

## Core Services

- `src/services/barcode-parser.js`
- `src/services/cert-accuracy.js`
- `src/services/cert-verification.js`
- `src/services/graded-cert.js`
- `src/services/scan-confidence.js`
- `src/services/identification.js`

## What It Extracts

- grader
- cert number
- raw cert number before OCR normalization
- QR/barcode payload
- official cert URL
- grade and grade label
- card identity fields
- serial number
- useful slab-label lines
- match agreement score
- cert confidence
- extraction completeness score
- extraction tier
- verification status
- verification label
- parsed-vs-official state
- evidence conflicts
- public-safe warnings

Supported graders:

- PSA
- BGS / Beckett
- SGC
- CGC / CSG legacy

v2.4 includes grader-specific parsers for PSA, BGS, SGC, and CGC. If no barcode is available, visible cert text can still produce parsed cert evidence.

## Evidence Model

Every cert result separates the evidence streams instead of blending them too early:

- `barcode_or_qr`
- `visible_label`
- `vision`
- `direct_input`

ManeFlow normalizes common OCR mistakes in numeric certs, such as `O` to `0`, `I` to `1`, `S` to `5`, and `B` to `8`. It then checks whether the cert shape is plausible for the detected grading company.

If a barcode cert and visible-label cert disagree, ManeFlow records a conflict and prevents the extraction from becoming `cert_locked`.

## Extraction Tiers

- `cert_locked`: strong readable cert evidence, no conflicts, high completeness
- `strong_review`: usable evidence but still worth confirming
- `needs_review`: partial evidence; user should improve the scan or enter the cert manually
- `insufficient`: not enough reliable cert evidence

## Verification Statuses

- `decoded`
- `cert_number_extracted`
- `official_verified`
- `manual_verify_recommended`
- `lookup_blocked_by_policy`
- `mismatch_detected`
- `failed`
- `unsupported_grader`
- `not_graded_detected`

Public-facing labels:

- `officially_verified`: only when an official connected source verifies the cert
- `parsed_not_officially_verified`: readable cert evidence, but no official lookup confirmation
- `conflict_needs_review`: barcode/QR and visible label disagree
- `parsed_lookup_blocked_by_policy`: lookup was not run because source rights or configuration do not permit it
- `not_graded_detected`: the evidence does not indicate a graded slab

Direct automated cert lookup is controlled by the Source Rights Engine. If lookup is not approved or no fetch adapter is provided, ManeFlow returns an official cert link and recommends manual verification.

## User Experience

Users can now:

- scan front/back/cert-label images in the scanner
- paste barcode or QR payloads
- enter visible cert label text
- use the standalone Cert Accuracy page at `#/cert`
- call `/api/cert/extract` for cert-only extraction
- see cert evidence candidates, conflicts, extraction tier, and official cert link

## Safety Boundary

Cert extraction supports identity review. It is not card authentication, a grading guarantee, an appraisal, or proof that a holder has not been tampered with. High-value graded cards should still be verified on the official grading-company page before buying, selling, listing, consigning, or adding to inventory.
