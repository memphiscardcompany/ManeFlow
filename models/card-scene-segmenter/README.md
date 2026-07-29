# ManeFlow Card Scene Segmenter

This directory stores the acceptance contract for the trained Roboflow instance-segmentation model.
It intentionally does not contain model weights or credentials.

Required classes, in the approved Version 1 ontology:

1. `raw_card`
2. `graded_slab`
3. `toploader`
4. `one_touch`
5. `sealed_pack`
6. `card_stack`

After Roboflow training:

1. Export the test metrics and complete `model-manifest.json` against `model-manifest.schema.json`.
2. Copy the exact deployed model endpoint into `ROBOFLOW_MODEL_ENDPOINT`.
3. Store the private API key only in the server/desktop secret store as `ROBOFLOW_API_KEY`.
4. Enable `ROBOFLOW_DETECTION_ENABLED=true`.
5. Set `CARD_DETECTOR_BACKEND=roboflow` for strict validation or `auto` for local/remote/classical fallback.
6. Run `python tools/evaluate_segmentation_model.py --dataset <test-folder> --output report.json`.

No model may be promoted to production without a human-reviewed test set and commercial-use authorization.
