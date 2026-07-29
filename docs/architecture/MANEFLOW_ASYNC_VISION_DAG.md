# ManeFlow Asynchronous Vision DAG

Status: approved target architecture; core DAG primitives implemented, production wiring pending.

## Upgrade verdict

This is a genuine production upgrade under ManeFlow's expected workload: multi-image uploads, binder pages, folder intake, and a catalog large enough that exact flat vector scans may become costly.

Two corrections are important:

1. The canonical repository already has pgvector HNSW indexes for front and back 1152-dimensional embeddings.
2. The canonical Node query path already sets `hnsw.ef_search` and `hnsw.iterative_scan`.

The missing production improvement is a durable asynchronous recognition DAG. The current FastAPI `/v1/scan` path remains mostly sequential after detection: surface analysis, centering, embedding extraction, barcode/OCR/identity, PSA enrichment, and pricing execute in one request lifecycle.

## Target DAG

```text
upload session
  -> ingest/validate/store
  -> decode and quality analysis
  -> detect card/slab objects
  -> normalize each crop
       -> OCR/barcode branch -----------\
       -> SigLIP2 embedding branch -> HNSW retrieval -> OCR/visual fusion
                                                    -> confidence calibration
                                                    -> optional adjudication
                                                    -> PSA verification when applicable
                                                    -> completed-sale pricing after identity acceptance
                                                    -> review or save
```

## Sequential boundaries

The following remain sequential because downstream inputs do not exist safely before them:

1. authentication, authorization, upload validation, hashing, and private storage;
2. image decode and orientation normalization;
3. card/slab detection;
4. crop extraction and perspective normalization;
5. vector retrieval after the embedding exists;
6. reranking after retrieval and OCR branch completion or explicit branch timeout;
7. official cert verification after cert evidence exists;
8. valuation after identity reaches an eligible evidence tier;
9. collection save after user confirmation when required.

## Parallel boundaries

After a normalized crop is durable, run independently:

- OCR and field parsing;
- barcode/cert extraction;
- SigLIP2 embedding extraction;
- optional quality, surface, and centering evidence;
- independent crops from the same image;
- independent images from the same job, bounded by queue and device capacity.

OCR failure must not cancel embedding. Embedding failure must not cancel OCR. Both failing yields controlled retry or manual review, never a forced identity.

## Worker responsibilities

### Ingest worker

Validates MIME/size, hashes bytes, removes exact duplicates inside the job, stores originals privately, writes `recognition_assets`, and enqueues detection.

### Detection worker

Decodes once, analyzes quality, detects every valid card/slab object, rejects empty holders/non-cards, and emits one normalized-crop task per detection.

### Normalization worker

Perspective-corrects, rotates, colorspace-normalizes, writes normalized derivative, calculates normalized SHA-256, and creates parallel OCR and embedding tasks.

### OCR worker

Runs targeted OCR on front/back/label/card-number/serial regions and returns raw text, bounding boxes, parser output, confidence, and conflicts.

### Embedding worker

Runs the registered SigLIP2 model through ONNX Runtime or the approved runtime, L2-normalizes the vector, records requested/selected device and model hash, and writes the embedding artifact.

### Retrieval worker

Queries the active embedding model/version using cosine HNSW, overfetches candidates, and returns candidate IDs plus distances. It never accepts identity.

### Fusion/rerank worker

Combines visual similarity, OCR/card-number/year/set/player evidence, front/back agreement, checklist constraints, and hard conflicts. It returns exact variant, card family, candidate, unresolved, insufficient evidence, or non-card.

### Adjudication worker

Runs only for unresolved or conflicting cases. A multimodal model may explain or remove unsupported fields, but cannot override official cert data or invent evidence.

### Pricing worker

Runs only after identity is verified or user-confirmed. It uses eligible completed sales and returns unpriced when evidence is insufficient.

## Idempotency

Every work item uses a SHA-256 idempotency key over:

- job ID;
- scope type and scope ID;
- normalized input hash;
- task type;
- model name/version;
- policy version;
- relevant parameters.

A duplicate key returns the existing work item or artifact. Model or policy changes intentionally produce a new key.

## Retry and failure isolation

Retry only classified transient failures:

- provider 429/5xx/timeouts: bounded retry with provider-aware backoff;
- expired lease/worker crash: lease recovery;
- GPU OOM: retry with smaller batch or explicit CPU fallback when policy permits;
- invalid/corrupt image: permanent failure;
- missing model/credentials/configuration: block, do not retry storm;
- malformed evidence: one controlled parse retry, then review/dead letter.

Each branch stores its own status and error. A partially successful crop may proceed to fusion with lower confidence when policy permits.

## HNSW strategy

The current schema already provides:

- front HNSW cosine index;
- back HNSW cosine partial index;
- model name/version filter;
- configurable `hnsw.ef_search`;
- iterative strict-order scan.

Production changes:

1. use one active embedding model/version per retrieval profile;
2. retain old versions for reproducibility, but do not mix spaces;
3. set `ef_search` per request profile and benchmark recall/latency;
4. overfetch candidates before metadata filtering and final reranking;
5. inspect query plans and index hit rate on representative catalog sizes;
6. partition or separate embedding tables by model/version only when multiple large embedding spaces materially reduce filtered HNSW recall or query efficiency;
7. rebuild indexes during model migrations outside the request path;
8. keep exact metadata B-tree indexes for card-number/year/set filtering and hard constraints.

No HNSW parameter or speedup is accepted without measured recall and latency.

## Fusion scoring

Suggested initial calibrated feature set:

- visual cosine similarity and margin;
- exact normalized card number;
- exact year;
- exact set code;
- set-name token similarity;
- player/subject token similarity;
- brand/manufacturer agreement;
- language agreement;
- front/back agreement;
- cert verification;
- serial-number evidence;
- variant/parallel evidence;
- image quality and OCR confidence;
- hard conflicts.

Exact card-number and set/year conflicts are hard penalties or rejection conditions when OCR confidence is high. Player-name agreement is useful but not enough for exact identity because many cards share a player.

A general model's self-reported confidence is not ManeFlow confidence. Calibrate thresholds on a rights-cleared held-out benchmark and track false-confident exact matches.

## EVGA RTX 2070 SUPER role

Recommended for owner-authorized development only:

- local detector/segmentation inference: yes;
- SigLIP2 ONNX embedding extraction: yes, likely a strong fit if the model fits in approximately 8 GB VRAM;
- OCR: conditionally, when using a GPU-backed OCR model; classical OCR may remain CPU-bound;
- local feature extraction and optical experiments: yes;
- detector or small classifier fine-tuning: yes, with conservative batch sizes, mixed precision, gradient accumulation, and OOM handling;
- large foundation-model training: no;
- production customer requests: no.

Benchmark CPU, CUDA, ONNX Runtime CUDA, FP32/FP16, batch size, VRAM, throughput, p50/p95 latency, and fallback. Do not assume a gain before measurement.

## Implemented in this continuation

- pure Node DAG construction, readiness, job-stage derivation, idempotency, and failure classification;
- Python parallel OCR/embedding execution with branch failure isolation;
- PostgreSQL migration for assets, crops, work items, dependencies, candidates, and decisions;
- tests proving OCR and embedding become ready in parallel and branch failures do not cancel the other branch.

## Pending production wiring

- repository methods for leasing work with `FOR UPDATE SKIP LOCKED`;
- durable worker process and heartbeat recovery;
- `/scan-jobs` create/status/cancel/resume APIs;
- object-storage direct uploads;
- realtime progress events;
- actual OCR adapter wiring;
- HNSW retrieval profile telemetry;
- integration of the restored visual candidate reranker;
- load tests, real-image benchmark, physical GPU validation, and rollback rehearsal.
