# ManeFlow Private Dense-Scene Benchmark — 2026-08-01

## Purpose

This benchmark measures local card-object discovery before OCR, catalog retrieval, identity resolution, and pricing. It was created because the former scene-level metric treated a 14-card image with only two detections as a successful scene. The benchmark now records human card counts, missed-count and excess-count totals, and an explicitly limited count-recall proxy.

It does **not** establish universal recall, localization precision, exact identity accuracy, or production readiness.

## Corpus and rights

- Source: private, owner-controlled Google Drive corpus.
- Training use: prohibited for this run; every image is evaluation/calibration only.
- Retention: ignored local artifacts under `artifacts/private/drive-corpus`; no source image is committed or published.
- Original five-image asset-manifest SHA-256: `101090b2b05ad87aabbd6df95fa0d7c70c9ffd6763f56bd77564985a81662eaf`.
- Original five-scene label-manifest SHA-256: `3e8a260635d3f90a7ce042efd7f07068f3a6c56a2bacaac8596753a9f241180a`.
- Final untouched ten-scene label-manifest SHA-256: `dbf5b2b4b8e654f3c1a2413d22290e2521b7c1c5d18e98789cb6e7b9f2156b7f`.
- The raw media, provider IDs, and API credentials remain outside version control.

## Baseline and candidate

Baseline source was the verified GitHub main head `30cd465fe980d0f583bc70f29d3f210075f6929a`, evaluated from a detached worktree. Candidate detector source SHA-256 was `8e1ccb3678afbdb85e2a76b207ae531ae2713a29b6180150a1d6423f5642ea36` at evaluation time and identifies itself as `opencv_contour_v2.17_multimap`.

| Evaluation set | Images | Human-counted cards | Baseline credited | Candidate credited | Missed | Excess | Exact-count images |
|---|---:|---:|---:|---:|---:|---:|---:|
| Original calibration | 5 | 66 | 5 (7.6%) | 58 (87.9%) | 8 | 0 | 2 / 5 |
| Promoted calibration A | 4 | 38 | not run | 30 (78.9%) | 8 | 2 | 1 / 4 |
| Promoted calibration B | 4 | 20 | not run | 17 (85.0%) | 3 | 1 | 1 / 4 |
| Combined calibration | 13 | 124 | not comparable | 105 (84.7%) | 19 | 3 | 4 / 13 |
| Final untouched evaluation | 10 | 17 | not run | 17 (100.0%) | 0 | 3 | 8 / 10 |

The final untouched set included one unseen eight-card mixed-holder grid plus nine difficult single-card/slab images spanning blur, glare, foil, sleeves, rotation, and holders. It was human-counted before inference, evaluated exactly once, and was not used for subsequent detector tuning.

## Full local pipeline

The final candidate ran the five original calibration scenes through detection, crop rectification, surface analysis, centering analysis, and barcode decoding:

- 5 / 5 images decoded.
- 58 crops produced from 66 expected cards.
- 58 surface analyses and 58 centering analyses completed.
- 0 unexpected stage errors.
- 0 barcode values decoded from this dense-scene subset.
- Mean end-to-end local latency: 550.6 ms per image; p95: 876.5 ms on this Windows host.

Four bundled non-card application assets produced zero detections. Synthetic regression coverage also rejects blank card-ratio panels and a generic desktop screenshot. This is supplemental negative evidence, not a representative natural-image false-positive study.

## What changed

- Multi-map proposals now combine the original close/Canny map with raw edges, a smaller close, adaptive thresholding, and a brightness map.
- Appearance validation runs before non-maximum suppression so invalid large contours cannot erase valid nested card proposals.
- Confidence-first proposal ordering and tighter duplicate suppression prevent connected rows from outranking individual cards.
- Large scene containers are suppressed when they contain at least three independent plausible card-scale anchors.
- The benchmark now exposes expected-count, missed-count, excess-count, exact-count, positive/negative class coverage, and count-metric scope.
- Recognition benchmark tools now load the same demo, Memphis-owner-authorized, and imported TCG catalogs as production instead of silently using only eight demo cards.

## Limitations and release decision

The count-recall metric credits `min(detections, expected_count)` per image. Without per-card polygons or boxes, it cannot prove one-to-one localization and can hide a duplicate plus a miss within the same scene. The final set also contained only 17 cards and no labeled negative scenes; therefore its binary precision/recall figures are not release-grade.

The detector still missed 19 human-counted cards across calibration and produced three excess detections on the final untouched set. Exact identity on the private corpus was not run because exporting those images to a remote vision provider requires explicit owner approval. The authorized local catalog currently loads 75 records, including 17 Ohtani records, and is not comprehensive enough to identify every possible card.

Result: the candidate is a substantial local-detection improvement and is safe to preserve behind existing review/abstention controls, but it does **not** satisfy a claim that ManeFlow detects and identifies every card in every image. Production promotion remains blocked pending larger localization-labeled positive and negative corpora, identity benchmarks, and the canonical release gates.

## Reproduction

From `vision-worker`, with the private ignored artifacts already materialized:

```powershell
$env:PYTHONPATH='.'
..\.venv-vision\Scripts\python.exe tools\evaluate_scene_detector_manifest.py `
  --root ..\artifacts\private\drive-corpus `
  --manifest ..\artifacts\private\drive-corpus\ohtani-scene-manifest.json `
  --json-output ..\artifacts\private\drive-corpus\candidate-final-calibration-scene.json `
  --csv-output ..\artifacts\private\drive-corpus\candidate-final-calibration-scene.csv

..\.venv-vision\Scripts\python.exe tools\benchmark_full_vision_pipeline.py `
  --root ..\artifacts\private\drive-corpus `
  --manifest ..\artifacts\private\drive-corpus\ohtani-scene-manifest.json `
  --output ..\artifacts\private\drive-corpus\candidate-final-full-pipeline.json
```
