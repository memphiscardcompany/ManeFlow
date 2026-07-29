# State-of-the-Art Card Recognition

ManeFlow's recognition stack is designed for real inventory work: single cards, table layouts, binder pages, mixed raw/slab photos, sealed packs/boxes, and cert-label closeups.

## Architecture

The scan flow now runs through a scene-aware recognition pipeline:

```text
Image or manual evidence
-> Scene analysis
-> Detected card regions
-> Fast catalog matching
-> Accurate path for hard cards
-> Scan confidence and cert intelligence
-> User confirmation and correction learning
-> Vault, shop inventory, pricing, watchlist, consignment, or listing action
```

## Scene Understanding

The recognition engine classifies scans as:

- `single_card`
- `multi_card_table`
- `binder_page`
- `mixed_raw_slab`
- `sealed_product`
- `cert_label`
- `manual_text`
- `unknown`

When AI vision is configured, ManeFlow asks the model to detect every visible card-like region and return normalized bounding boxes. Without AI vision, ManeFlow degrades honestly to single-card/manual-text recognition and does not claim multi-card detection.

## Dual-Path Recognition

Each detected region is evaluated with:

- **Fast path**: catalog ranking from extracted fields, visible text, file hints, and cert evidence.
- **Accurate path**: required when identity is ambiguous, image quality is weak, the card may be high value, the card is slabbed, or the parallel/card number is uncertain.
- **Dual path**: used for hard scenes such as binder pages, group table photos, and mixed raw/slab layouts.
- **Sealed product path**: used when the image is a pack, box, blaster, hobby box, retail box, tin, ETB, booster box, or sealed case. It extracts product configuration instead of forcing a single-card identity.

## Extracted Fields

Every region can carry:

- player or subject
- team
- sport or game
- year
- brand
- set and subset
- card number
- parallel or variation
- product name
- product type or sealed type
- sealed product configuration
- SKU or UPC
- serial number
- rookie indicator
- autograph indicator
- relic/patch/memorabilia indicator
- grader
- grade
- cert number
- barcode or QR payload
- visible text
- field-level confidence

## Trust Layer

ManeFlow prefers uncertainty over wrong certainty.

The engine returns:

- scan confidence
- image quality score
- field-level confidence
- top candidate matches
- why the match was made
- uncertain fields
- better-photo guidance
- mandatory confirmation reasons
- scene-level detection summary
- correction-learning signals

Manual confirmation is required when:

- scan confidence is below the release threshold
- the card may be high value
- the parallel or variation is uncertain
- the card number is weak
- slab/cert details conflict
- image quality is too poor
- multiple close catalog candidates exist

## Correction Learning

When a user confirms a different card or corrects fields, ManeFlow stores the correction in scan history. Future recognition calls can use those correction signals to re-rank close candidates without hiding the audit trail.

## Benchmark Lab

ManeFlow includes an internal benchmark harness for real-world recognition testing:

```bash
npm run recognition:benchmark -- --file ./benchmark.json --source "GotThatData Sports Cards Dataset" --out ./recognition-report.json
```

The runner can consume JSON, CSV, owner-photo labels, and dataset-style rows with JSON metadata. It reports scene accuracy, top-1/top-3 candidate accuracy, field accuracy, false-confident rate, and manual-confirmation rate.

Folder benchmark command:

```bash
npm run recognition:benchmark:folder -- --images ./card-photos --labels ./card-photos/labels.json --source "Owner Phone Photos" --out ./reports/folder-recognition.json --summary
```

Official eBay Browse image discovery for internal QA:

```bash
npm run recognition:discover:ebay -- --url "https://www.ebay.com/sch/i.html?_nkw=shohei+lot" --out ./.runtime/recognition-benchmarks/ebay-shohei-lot --limit 50
```

The eBay tool creates a manifest and label scaffold from official API results. Fill expected labels manually before treating the set as an accuracy benchmark.

Owner Control Room endpoints:

```text
GET  /api/admin/recognition-benchmarks
POST /api/admin/recognition-benchmarks/run
```

Benchmark datasets are internal testing evidence only. They can improve scan prompts, catalog ranking, confidence calibration, and correction workflows, but they do not create completed-sale comps or public market values.

## Important Limits

- Recognition is not authentication.
- Cert parsing is not official verification unless an official verification source is connected.
- Images are processed remotely only when the owner configures an AI vision provider and the user submits a scan.
- Completed-sale valuation still comes only from included, scored completed-sale comps.
- Active listings remain secondary context only.
- eBay active-listing images can be used as internal scanner QA inputs through the official Browse API, but they are not catalog images, not completed-sale comps, and not redistributable release assets.
- ManeFlow does not invent catalog identities when evidence is insufficient.
