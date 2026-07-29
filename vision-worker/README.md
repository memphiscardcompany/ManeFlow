# ManeFlow API — v2.7 Imaging + Lot Intelligence

## What is implemented

- Single-card image upload with safe abstention
- Multi-image lot analysis endpoint
- Classical OpenCV card-object detection and perspective correction
- Image quality scoring for blur, glare, exposure, and resolution
- Perceptual hashing and cross-image near-duplicate grouping
- Item-level confidence separation
- Lot acquisition, fee, resale, profit, ROI, and max-purchase calculations
- User correction endpoint
- Local SQLite persistence for development
- Supabase migrations for scan sessions, scanner profiles, lot jobs, detections,
  identity candidates, recognition evidence, and opportunities

The detector is a working baseline, not the final learned model. It should later be
combined with a trained detector/segmenter, OCR, visual embeddings, checklist data,
and cert verification.

## Run

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

API docs: `http://localhost:8000/docs`

## Multi-card lot request

```bash
curl -X POST http://localhost:8000/v1/lots/analyze \
  -F 'images=@listing-1.jpg' \
  -F 'images=@listing-2.jpg' \
  -F 'listing_price=425' \
  -F 'inbound_shipping=18' \
  -F 'source_type=ebay_listing'
```

The system will detect card-shaped objects and create an item list. When no real
identity or verified comp provider is configured, it returns `unpriced` instead
of inventing values.

## Test

```bash
pytest app/tests -q
```

## Benchmark a folder

```bash
PYTHONPATH=. python tools/benchmark_detector.py /path/to/images --output benchmark.json
```

## Kronozio-derived workflow improvements implemented

- Local/offline persistence
- Front/back and scan-session database foundations
- 300-DPI scanner profile default
- Independent image-intake, identification, pricing, and marketplace-state tables
- Per-image quality checks before recognition
- Explicit correction and reconciliation records

No proprietary Kronozio data or private service access is used.
