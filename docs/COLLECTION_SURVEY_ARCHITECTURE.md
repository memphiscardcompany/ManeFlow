# ManeFlow Collection Survey Architecture

## Status

Implemented as a feature-flag-ready, conservative survey workflow in the canonical web application. The current release provides authenticated/user-scoped persistence, an environment ontology, capacity-based and direct-count estimation, duplicate-review keys, quality warnings, valuation tiers, human-review gates, and audit events.

## Boundary

This release does **not** claim a trained room-scale storage-object detector, automatic camera-pose reconstruction, or measured room-scale accuracy. Uploaded images are inspected in the browser for dimensions, brightness, and a lightweight detail/blur signal. Users confirm object type, fullness, content format, and stable scene labels. Those confirmations feed an explainable low/expected/high estimate.

## Components

- `src/services/collection-survey.js`: ontology, capacity knowledge base, estimation engine, duplicate-review graph, valuation tiers, persistence.
- `src/router.js`: user-scoped Collection Survey API.
- `public/app.js`: mobile-first guided capture and review workflow.
- `tests/collection-survey.test.js`: range, exclusion, deduplication, persistence, and audit regression coverage.

## Future verified upgrades

1. Add a licensed/authorized storage-object training dataset.
2. Train and benchmark container, stack, binder, slab, sealed-product, supply, and non-inventory detection.
3. Add geometric multi-view matching and camera-pose-assisted scene mapping.
4. Route visible card crops through the existing recognition pipeline.
5. Add completed-sale-backed survey valuation and report exports.
