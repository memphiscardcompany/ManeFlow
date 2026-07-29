# Scan Confidence v2.5

Scan Confidence v2 sits inside the scene-aware recognition pipeline between vision, identification, cert intelligence, catalog matching, and valuation. It does not calculate values. It evaluates whether each detected card region is good enough to trust the match.

## Signals

- front image status
- back image status
- cert/slab status
- image quality score
- field-level confidence for player, year, set, card number, parallel, serial number, grade company, grade, and cert
- rookie, autograph, relic, and variation confidence
- scene type and detected region count
- recognition path: fast path, accurate path, or dual path
- warnings for missing back image, parallel uncertainty, and cert/grade uncertainty
- AI-reported blur, glare, crop, lighting, and camera angle
- high-value low-confidence safety gate
- top candidate match explanations
- manual confirmation reasons
- user correction records for future matching improvement

Low-confidence scans require manual confirmation before being treated as confirmed card identity.

## v2.5 Vision Contract

The vision service now requests strict JSON with:

- scene type
- per-card region bounding boxes
- structured card facts
- field-level confidence
- visual markers such as logos, borders, fonts, foil/refractor pattern, set symbols, and slab label type
- image-quality observations
- slab/cert facts
- top candidate descriptions
- uncertainty reasons

Those facts are not accepted blindly. ManeFlow feeds the high-confidence fields into the catalog matcher so loaded checklist data can correct or re-rank the AI result. Binder pages and table layouts return one recognition item per visible card region.

If the vision result says the image is blurry, glary, cropped, dim, overexposed, or severely angled, scan confidence is lowered and the user is asked to retake or confirm.

## Cert Accuracy Engine 2.0 Rules

Graded cards now receive a dedicated cert extraction review before scan confidence is finalized.

- `cert_locked` cert evidence can raise cert-number confidence.
- `needs_review` or `insufficient` cert extraction lowers confidence and asks for a closer slab-label capture or manual cert entry.
- barcode/QR and visible-label conflicts force manual confirmation.
- high-value low-confidence graded cards should not be listed, consigned, or added to shop inventory without user confirmation.
- PSA, BGS, SGC, and CGC cert evidence is parsed by grader-specific normalization.
- Cert labels distinguish `parsed_not_officially_verified` from `officially_verified`.
- ManeFlow never claims official cert verification unless an official source is actually connected.

Cert evidence improves card identity confidence. It is not authentication or a grade guarantee.

## State-of-the-Art Recognition

The full recognition architecture is documented in:

```text
docs/STATE_OF_THE_ART_RECOGNITION.md
```
