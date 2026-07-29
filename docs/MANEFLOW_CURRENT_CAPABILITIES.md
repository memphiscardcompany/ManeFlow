# ManeFlow Current Capabilities

## Confirmed current implementation

- Card search, scan, collection, pricing evidence, account isolation, organizations, shop inventory, bulk intake, PSA/eBay provider boundaries, and recognition review.
- Collection Survey guided workflow with multi-image metadata, capture-quality warnings, collection-environment ontology, direct count, stack estimate input, container/binder capacity estimation, low/expected/high ranges, duplicate-review keys, non-inventory exclusion, valuation tiers, human-review state, user-scoped persistence, and audit events.

## Tested implementation

The Collection Survey release passes unit coverage for conservative ranges, non-inventory exclusion, duplicate-view prevention, and persistence/auditing. The full Node suite, static checks, smoke test, secret scan, mobile configuration check, and desktop configuration check pass.

## Experimental or feature-gated

- Automatic storage-object and sealed-product detection at room scale.
- Camera-pose-assisted scene graphs.
- Automatic stack-height measurement.
- Representative-sample valuation across a collection.
- Survey PDF/CSV/acquisition/insurance exports.
- Showcase Price Review and completed Deal Evaluation.

## Requires third-party approval or credentials

- Production Meta/Instagram/Messenger image intake.
- Authorized completed-sale providers beyond currently configured sources.
- PSA/eBay live-provider behavior in each deployment environment.
