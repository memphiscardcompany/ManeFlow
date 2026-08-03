# Detector Localization Release Gate

## Decision

Scene-level card counts are useful diagnostics, but they are not sufficient evidence for detector promotion.

A detector can return the correct total count while:

- missing one physical card;
- detecting another physical card twice;
- replacing a valid card with a false region;
- merging neighboring cards;
- returning one large binder or page container plus several correct regions.

Therefore, no detector may become canonical or be represented as release-grade based only on `expected_card_count`, scene recall, or `min(detections, expected_count)` credit.

## Required release evidence

Protected detector benchmarks must label each visible physical card with a stable region ID and normalized polygon. Labels may identify the object only as a physical card; player or card identity is not required for the detection benchmark.

The release evaluator must perform one-to-one prediction-to-ground-truth matching and report:

- expected physical cards;
- predicted regions;
- one-to-one matches;
- missed cards;
- false regions;
- duplicate regions;
- localization precision;
- localization recall;
- localization F1;
- mean and minimum matched IoU;
- complete-scene rate;
- per-image latency;
- every runtime or decode error.

A complete scene requires:

```text
missed_cards = 0
false_regions = 0
duplicate_regions = 0
```

Count-only results remain available as exploratory diagnostics but cannot authorize rollout.

## Generality

This contract is subject-independent. A benchmark may contain Wayne Gretzky cards, Shohei Ohtani cards, Pokémon cards, mixed players, slabs, raw cards, or no cards. No player, set, identity, or card number is programmed into the detector.

The benchmark should cover ordinary operating conditions, including:

- binder pages;
- loose tabletop spreads;
- repeated card designs;
- mixed subjects;
- glare and plastic sleeves;
- rotated cards;
- partially visible edge cards;
- slabs and raw cards;
- negative images;
- dense and sparse scenes.

## Privacy

Owner-controlled benchmark images and annotations remain in private ignored storage or an approved private benchmark store. Image bytes are not committed to GitHub. The repository contains only the reusable evaluator, schema expectations, tests, and release policy.

## Tool

```text
vision-worker/tools/evaluate_detection_localization.py
```

Example:

```bash
python tools/evaluate_detection_localization.py \
  --root artifacts/private/detector-benchmark \
  --manifest artifacts/private/detector-benchmark/localization-manifest.json \
  --output artifacts/private/detector-benchmark/localization-result.json \
  --iou-threshold 0.5
```

## Promotion policy

A detector replacement must outperform or equal the current canonical detector on the protected localization benchmark without:

- additional silent drops;
- increased duplicate detections;
- increased false regions;
- material latency regression without a justified accuracy gain;
- regression on no-card negatives;
- loss of source accounting.

Shadow comparison and immediate rollback remain required before production promotion.
