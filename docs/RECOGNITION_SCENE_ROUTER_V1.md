# Recognition Scene Router v1

## Status

Experimental implementation on a review branch. It is not wired into production recognition and must not be described as deployed.

## Objective

Provide a deterministic, inexpensive routing decision before expensive OCR, retrieval, certification, or pricing work. The router converts detector and quality evidence into one specialized processing plan while failing closed when support is insufficient.

## Routes

- `single_raw`
- `single_slab`
- `multi_card`
- `binder_page`
- `mixed_raw_slab`
- `partial_card`
- `stack`
- `sealed_product`
- `collection_overview`
- `no_card`
- `uncertain`

## Safety invariants

- An unsupported full-frame image is not automatically one card.
- `no_card`, `collection_overview`, and `uncertain` routes cannot create card records.
- Slabs use a certification-first plan.
- Binder pages use pocket detection and empty-pocket rejection.
- Dense scenes retain the full detector count and route to tiled microbatches.
- Partial cards remain reviewable but do not become exact identities through routing alone.
- Routing does not authorize pricing.

## Integration gate

Before the router may replace or precede the existing recognition classification path:

1. Run the complete Node and Python validation suites.
2. Add contract integration to the canonical recognition engine and worker result schemas.
3. Compare against the current classifier on a rights-cleared benchmark.
4. Measure route accuracy, non-card false positives, card-count preservation, and latency.
5. Confirm that detector-confirmed unresolved cards remain reviewable.
6. Add feature-flag rollback.
7. Run physical iPhone tests against the deployed scanner.

## Claims boundary

This module is a routing subsystem, not a trained object detector. It does not by itself improve exact-card identity, card-number OCR, parallel classification, or real-image detection recall. Those improvements require dedicated models, authorized benchmark data, and measured integration.
