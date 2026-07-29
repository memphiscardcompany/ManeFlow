# ManeFlow 2.16.0-beta.1 Release Notes

## Recognition safety and image benchmark release

ManeFlow 2.16 is an evidence-driven vision update built from a 67-image project benchmark covering all currently accessible user/project photos and Kronozio reference assets.

### Improvements

- Card-appearance evidence gate for the OpenCV fallback
- General-scene whole-image fallback disabled
- Explicit guarded fallback retained for single-card scans
- Screenshot, browser-window, hardware-control, storage-box, and sports-banner rejection
- Skewed-card tolerance without relaxing small square-object rejection
- Faster quantized color diversity analysis
- Surface analysis capped at a 384-pixel working resolution
- Centering analysis capped at 512 pixels with measurements mapped back to source pixels
- Reproducible scene-level benchmark manifest and evaluator
- Reproducible local full-pipeline benchmark tool
- Additional detector and API regression tests

### Measured result on the accessible 67-image benchmark

- Scene precision: 46.0% → 100.0%
- Scene recall: 95.8% → 83.3%
- Scene F1: 62.2% → 90.9%
- Scene accuracy: 58.2% → 94.0%
- Whole-image false fallback detections: 15 → 0
- Full local pipeline mean latency: 49.8 ms per source image after bounded analysis optimizations

The recall reduction is deliberate: ManeFlow now abstains on several tiny card thumbnails embedded in software screenshots rather than misclassifying unrelated rectangles. The trained instance-segmentation model remains the correct solution for those cases.
