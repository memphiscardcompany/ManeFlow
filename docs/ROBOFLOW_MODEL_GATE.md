# External Gate 1 — Trained Card Scene Segmenter

ManeFlow now includes a production adapter for a private Roboflow instance-segmentation endpoint,
a COCO seed-dataset builder, an evaluation harness, and a model-manifest contract.

## Build a seed dataset

From `vision-worker`:

```bash
python tools/build_roboflow_seed_dataset.py \
  --input /path/to/approved/card-images \
  --output /path/to/maneflow-roboflow-dataset
```

The generated annotations are drafts and must be reviewed in Roboflow before training.
Related images are assigned deterministically to the same train/validation/test split.

## Configure a trained model

Copy the exact instance-segmentation endpoint from Roboflow's deployment page:

```env
CARD_DETECTOR_BACKEND=roboflow
ROBOFLOW_DETECTION_ENABLED=true
ROBOFLOW_MODEL_ENDPOINT=https://outline.roboflow.com/<project>/<version>
ROBOFLOW_API_KEY=<private-server-side-key>
ROBOFLOW_MODEL_NAME=maneflow-card-scene-segmenter-v1
ROBOFLOW_CONFIDENCE=0.35
ROBOFLOW_OVERLAP=30
ROBOFLOW_FAIL_OPEN=false
```

For ordinary beta use, `CARD_DETECTOR_BACKEND=auto` allows the classical detector to remain a
fallback. For acceptance testing, use `roboflow` and `ROBOFLOW_FAIL_OPEN=false` so a model failure
cannot be hidden by the fallback.

## Evaluate

```bash
python tools/evaluate_segmentation_model.py \
  --dataset /path/to/maneflow-roboflow-dataset/test \
  --iou 0.50 \
  --output /path/to/segmentation-test-report.json
```

Initial promotion targets:

- Single-item recall: 0.98 or greater
- Multi-item recall: 0.95 or greater
- Dense/overlap recall: 0.90 or greater
- Negative-image false-positive rate: below 0.05
- Correct holder class: 0.95 or greater

These metrics must come from human-reviewed, previously unseen images.
