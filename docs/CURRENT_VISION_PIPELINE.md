# Current ManeFlow Vision Pipeline

## Confirmed current implementation

```text
Upload / camera / scanner image
  -> decode and quality analysis (local CPU)
  -> detector router
       -> optional local Ultralytics model (CPU/CUDA through central policy)
       -> optional authorized Roboflow endpoint
       -> OpenCV contour fallback (CPU)
  -> perspective rectification and per-card crops (CPU/OpenCV)
  -> barcode/cert extraction and evidence parsing (local)
  -> optional local ONNX embedding model (CPU/CUDA/TensorRT opt-in)
  -> reference matching and identity evidence fusion
  -> PSA verification where configured
  -> canonical Node pricing and business rules
  -> confidence, conflicts, abstention, and human review
```

## Stage classification

| Stage | Local | CPU | GPU eligible | Cloud/API | Permanent artifact |
|---|---:|---:|---:|---:|---:|
| Decode, hash, metadata | Yes | Yes | No | No | Manifest only |
| Quality scoring | Yes | Yes | Possible future model | No | Metrics |
| OpenCV detection | Yes | Yes | No | No | Benchmark result |
| Ultralytics detection | Yes | Fallback | Yes | No | Model-dependent |
| Roboflow detection | No | N/A | Provider-managed | Yes | Response metadata |
| Rectification/crops | Yes | Yes | Not currently | No | Generated/ignored |
| Barcode/cert parsing | Yes | Yes | No | No | Evidence |
| PSA verification | No | N/A | No | Yes | Verified evidence record |
| ONNX embeddings | Yes | Yes | Yes | No | Versioned/ignored index |
| Reference matching | Yes | Yes | Partly via embeddings | No | Candidate evidence |
| Pricing | Node service | Yes | No | Provider-dependent | Audit/pricing record |

## Tested implementation

- Detector router safely falls back to classical detection without weights.
- Local embeddings validate 1,152 dimensions and unit normalization.
- CPU/CUDA selection and explicit fallback are unit-tested.
- Dataset rights quarantine, corrupt-image handling, duplicate grouping, and split leakage are unit-tested.

## Not verified

- A trained ManeFlow detector checkpoint on the owner image corpus.
- Production local OCR on GPU.
- Real RTX 2070 Super runtime.
- Large authorized catalog and dense reference index.
- Exact-identity, variant, and latency improvement from this change.
