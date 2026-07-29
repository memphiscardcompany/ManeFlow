# ManeFlow 2.12.0-beta.1

## Consolidation

This release keeps the original ManeFlow business application as the canonical product and integrates the newer Python imaging and lot-analysis engine behind it. It does not create a separate scanner application.

## New in this build

- Registered JustTCG and SportsCardsPro providers in the live provider registry.
- Added server-side JustTCG TCG variant/current-market context.
- Added SportsCardsPro sports-card guide and retail context with penny-to-dollar normalization and one-request-per-second protection.
- Added production eBay client credential settings and optional seller OAuth token storage.
- Preserved active listings, current guide values, and TCG market snapshots as non-sold context.
- Strengthened eBay title normalization for exact alphanumeric card-number boundaries such as `US1` versus `US10`.
- Added post-rectification parallel/refractor surface-family analysis.
- Added center/edge/corner pre-grading estimates.
- Displayed imaging estimates in single-card and lot workflows with explicit confirmation warnings.
- Added a Windows extract-and-run launcher that starts and health-checks both the Node core and Python imaging service.
- Added separate stop and imaging-repair utilities.
- Updated desktop and mobile release contracts to one version.

## Accepted engineering upgrades

- Surface/colorway analysis: useful as evidence and candidate re-ranking input.
- Micro-patch texture analysis: useful for parallel-family narrowing.
- Centering and visible wear estimate: useful as pre-grading decision support.
- Strict title scrubber and exact card-number matching: major pricing-quality upgrade.
- Official API adapters and provider separation: major data-trust upgrade.

## Deliberately not made mandatory

- TensorRT/CUDA is not a hard dependency for the consumer beta. It would exclude most user PCs and adds driver/model-export failure modes. GPU execution remains an optional production acceleration path after trained ONNX models and benchmark hardware are available.
- Heuristic surface classification does not overwrite an exact catalog parallel. It supplies a separate confidence-bearing evidence signal.
- Centering/whitening output is not represented as a professional grade guarantee.

## Release verification

- 165/165 Node tests passed.
- 44/44 Python tests passed.
- Integrated core + vision + Ricoh + consent + curation smoke passed.
- Mobile and desktop configuration checks passed.
- Credential-pattern scan passed.
