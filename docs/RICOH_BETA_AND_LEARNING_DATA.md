# Ricoh Bulk Beta and In-House Recognition Data

## Purpose

The Ricoh workflow turns bulk duplex scans into ordered physical-card records. Tester corrections can improve ManeFlow over time without turning private inventory data into a shared dataset.

## Recommended scanner output

- 300–600 DPI depending on throughput and text size
- color mode
- lossless TIFF/PNG or high-quality JPEG
- duplex front/back
- no automatic filename reuse
- consistent orientation
- one physical card per scanner pass during the first beta

ManeFlow accepts JPEG, PNG, WebP, TIFF, and TIF. Auto pairing detects common `front/back` filename markers; otherwise use alternating order.

## Consent scopes

| Scope | Local inventory | Labels contributed | Images contributed | Reference candidate |
|---|---:|---:|---:|---:|
| Private | Yes | No | No | No |
| Labels only | Yes | Yes | No | No |
| Images + labels | Yes | Yes | Yes | No |
| Reference catalog | Yes | Yes | Yes | After owner approval |

## Review is the ground-truth step

A prediction is not training data. A card becomes eligible only after the tester marks it confirmed or corrected and the consent scope permits contribution. Imported packs then require a second owner approval.

## Fields allowed into recognition data

- year
- brand
- set and insert
- player/subject
- team and sport
- card number
- parallel
- serial number
- rookie/autograph/memorabilia flags
- language
- grader, grade, cert number
- sanitized recognition evidence and image-quality signals

## Fields prohibited from recognition data

- acquisition cost
- market value
- asking price or offer
- seller name
- customer identity
- inventory location
- private notes
- profitability analysis

## Dataset quality controls

- content hashes deduplicate repeated scans
- owner rejection excludes a record
- local revocation excludes that contributor's records
- exact-image matches require owner-approved reference scope
- transformed matches require local-feature and geometric verification
- stable SHA-based train/validation/test assignment prevents evaluation leakage
- the locked test split must never be used to fit models or thresholds

## Tester-to-owner transfer

Tester PC:

1. Review/correct the batch.
2. Export **consented review pack**.
3. Send the ZIP privately to the owner.

Owner PC:

1. Import the learning pack.
2. Review every pending example.
3. Approve only identities checked against the card image/back/cert/checklist.
4. Reject uncertain labels.
5. Export the approved dataset manifest for model evaluation/training preparation.

## Revocation during beta

Local revocation is automatic. A pack already transferred to another PC cannot receive an automatic remote revocation in this beta. A tester who withdraws permission must notify the owner, who must reject/remove the imported records before the next dataset release. A synchronized revocation registry is a post-beta requirement.
