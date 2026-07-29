# ManeFlow 2.16 Accessible-Image Recognition Benchmark

## Scope

This benchmark uses every meaningful source image currently accessible in the ManeFlow project workspace:

- 33 user/project images, including raw cards, graded slabs, a sealed pack, a card held in hand, software screenshots, hardware photographs, and unrelated negatives.
- 34 Kronozio help and reference assets, including flatbed card spreads, card-photo examples, software interfaces, storage boxes, banners, and sports-background negatives.

The 67-image set is manually labeled only for **scene-level card-content presence**. It does not establish exact player, set, card number, parallel, grade, object-count, or pricing accuracy.

## Scene-level detector comparison

| Metric | ManeFlow 2.15 classical fallback | ManeFlow 2.16 guarded fallback |
|---|---:|---:|
| Images | 67 | 67 |
| True positives | 23 | 20 |
| True negatives | 16 | 43 |
| False positives | 27 | 0 |
| False negatives | 1 | 4 |
| Precision | 46.0% | **100.0%** |
| Recall | 95.8% | **83.3%** |
| F1 | 62.2% | **90.9%** |
| Accuracy | 58.2% | **94.0%** |
| Whole-image fallbacks | 15 | **0** |
| Mean detector latency | 35.3 ms | 39.3 ms |
| P95 detector latency | 80.3 ms | 87.0 ms |

The 2.16 change intentionally favors abstention over false confidence. The previous detector frequently interpreted browser windows, software panels, scanner controls, storage boxes, sports banners, and unrelated rectangular objects as cards. The guarded detector rejects those cases.

## User/project image subset

The 33 user/project images contain 13 card-positive scenes and 20 negative scenes.

| Metric | ManeFlow 2.15 | ManeFlow 2.16 |
|---|---:|---:|
| Precision | 43.3% | **100.0%** |
| Recall | 100.0% | **100.0%** |
| F1 | 60.5% | **100.0%** |
| Accuracy | 48.5% | **100.0%** |

This small subset is useful as a regression test, not as a public accuracy claim.

## Kronozio reference-asset subset

The 34 Kronozio assets contain 11 scenes manually labeled as having visible card content and 23 negative UI/storage/banner scenes.

| Metric | ManeFlow 2.15 | ManeFlow 2.16 |
|---|---:|---:|
| Precision | 50.0% | **100.0%** |
| Recall | 90.9% | 63.6% |
| F1 | 64.5% | **77.8%** |
| Accuracy | 67.6% | **88.2%** |

The four 2.16 false negatives are low-resolution software screenshots where individual card thumbnails are too small or embedded in dense UI. These cases should be handled by the trained Roboflow instance-segmentation model rather than by expanding the classical fallback and reintroducing false positives.

## Full local vision-stage smoke test

All 67 images were also processed through the local quality, detection, surface-family, centering, and barcode stages.

| Stage | Result |
|---|---:|
| Images decoded | 67 / 67 |
| Image-level runtime failures | 0 |
| Detected crops | 24 |
| Surface analyses completed | 23 |
| Surface low-resolution skips | 1 |
| Centering analyses completed | 23 |
| Centering low-resolution skips | 1 |
| Unexpected downstream stage errors | 0 |
| Barcode values decoded | 0 |
| Mean full local pipeline latency | 49.8 ms per source image |
| P50 full local pipeline latency | 40.5 ms |
| P95 full local pipeline latency | 121.2 ms |
| Maximum full local pipeline latency | 218.6 ms |

Barcode decoding returned zero because the optional `zxing-cpp` runtime is not installed in this build environment. The application already treats that as an optional capability and does not invent certification data.

## 2.16 engineering changes driven by this benchmark

1. Added a card-appearance evidence gate using grayscale entropy, saturation, gradient density, flat-region fraction, color diversity, and edge orientation.
2. Disabled whole-image fallback in lot/general-scene mode.
3. Kept a stricter, explicit whole-image fallback only for single-card capture and reference normalization.
4. Rejected image-frame contours that previously converted entire screenshots or unrelated photographs into card detections.
5. Added conservative handling for ultra-wide banners and splash panels.
6. Expanded perspective tolerance for heavily skewed cards while requiring stronger area and rectangularity evidence.
7. Added regression tests for screenshots, blank images, full-frame single cards, and textured multi-card spreads.
8. Replaced an expensive color-count operation with a 512-bin quantized histogram, reducing detector latency while preserving results.
9. Bounded surface analysis to 384 pixels and centering analysis to 512 pixels, preserving source-space centering distances while substantially reducing processing time.
10. Added reproducible scene-level and full-pipeline benchmark tools and evidence files.

## Remaining limitation

The classical fallback still cannot reliably separate every card in dense flatbed grids, overlapping table spreads, binder pages, or low-resolution software screenshots. The next accuracy step remains the private Roboflow instance-segmentation model and a large authorized reference-image/embedding catalog.
