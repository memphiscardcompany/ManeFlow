# External Gate 2 — Licensed 1,152-D Encoder

ManeFlow standardizes production visual retrieval on the fixed-resolution
`google/siglip2-so400m-patch16-384` vision tower. Its published model card declares Apache-2.0
licensing and its vision projection is 1,152 dimensions, matching the PostgreSQL `vector(1152)`
schema.

The checkpoint is several gigabytes and is not embedded in the source or portable beta archive.
Build it on a controlled workstation or CI runner:

```bash
cd vision-worker
python -m venv .model-export
.model-export/Scripts/activate       # Windows
# source .model-export/bin/activate  # Linux/macOS
pip install -r requirements-model-export.txt
python tools/export_siglip2_encoder.py \
  --output ../models/siglip2-so400m-card-front-v1 \
  --device cpu
```

The exporter:

- downloads the official model checkpoint;
- exports a batch-dynamic ONNX vision encoder;
- verifies the graph with ONNX Checker;
- compares ONNX Runtime output against PyTorch output;
- requires a 1,152-dimensional L2-normalized vector;
- writes the artifact SHA-256 and source-license manifest.

Configure ManeFlow after validation:

```env
EMBEDDING_ENABLED=true
EMBEDDING_MODEL_PATH=/absolute/path/siglip2-so400m-card-front-1152.onnx
EMBEDDING_MODEL_NAME=siglip2-so400m-card-front-v1
EMBEDDING_INPUT_SIZE=384
EMBEDDING_OUTPUT_NAME=image_embedding
EMBEDDING_EXECUTION_PROVIDER=auto
```

Do not distribute the 4+ GB upstream checkpoint inside the mobile application. Desktop/server
installers may download the approved artifact after consent and verify its SHA-256 before use.
