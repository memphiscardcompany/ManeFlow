# ManeFlow

Card-intelligence platform for collectors, dealers, and card shops.
**Publisher:** Memphis Card Company LLC  
**Contact:** memphiscardcompany@gmail.com  
**Site:** https://memphiscardcompany.com

## What ManeFlow does

- Scan / identify single cards, slabs, multi-card spreads, and lots
- Evidence-first matches: **Exact / Likely / Unresolved** (abstain when unsupported)
- Authorized PSA cert verification (server-side secrets only)
- Private vault, grading workflow, shop operations
- Pricing gates — no unverified model guess presented as sold value
- Windows desktop beta, hosted PWA, Microsoft Store packaging path, Expo mobile

## Current known versions (from release packages)

| Package | Notes |
|---------|--------|
| **2.20.0** Windows Store RC | Hosted PWA → MSIX kit; `https://142df297558ace9e22.v2.appdeploy.ai/` |
| **2.18.0-beta.1** Ready-To-Install Windows | Full extract-and-run beta; vision/lot/Ricoh/pgvector upgrades |
| **2.16.0-beta.1** Full Windows Beta | Recognition safety + 67-image scene benchmark |

## Stack (from packages)

- **Server:** Node 22, local `http://127.0.0.1:4321`
- **Vision worker:** Python 3.11/3.12, OpenCV, optional Roboflow instance-seg, optional ONNX embeddings
- **Mobile:** Expo (`com.memphiscardcompany.maneflow`)
- **Desktop:** Electron Windows beta / Store PWA
- **Data:** JSON mode default; optional PostgreSQL + pgvector + HNSW

## Vision ontology (approved v1)

`raw_card` · `graded_slab` · `toploader` · `one_touch` · `sealed_pack` · `card_stack`

No proprietary trained weights ship in the public packages. Model promotion requires human-reviewed test set + commercial-use authorization.

## Coordination

See [docs/UPGRADE-COORDINATION.md](docs/UPGRADE-COORDINATION.md).

This private repo is the single source of truth for Grok + ChatGPT collaboration on upgrades.
