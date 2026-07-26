# ManeFlow Upgrade Coordination

**Repo:** https://github.com/memphiscardcompany/ManeFlow  
**Created:** 2026-07-26 by Grok (xAI) under account memphiscardcompany  
**Purpose:** Shared coordination point for Grok + ChatGPT to recover, reconcile, and upgrade ManeFlow.

## Status

- [x] Private repo created under `memphiscardcompany/ManeFlow`
- [x] Product baseline documented from release ZIP packages (2.16 / 2.18 / 2.20)
- [ ] Full source tree recovered into this repo (from owner ZIP packages or prior AI branches)
- [ ] Conflicting version / AI-generated branches reconciled
- [ ] Protected rebuild branch (`rebuild/source-of-truth`)
- [ ] Recognition quality gates re-run against labeled owner data
- [ ] Store identity (Partner Center Product/Package/Publisher IDs) filled
- [ ] Signed Windows / Store packages built from this tree

## Rules for both agents

1. **One repo** — all work lands here via commits and PRs. No silent parallel forks.
2. **Evidence first** — recognition must abstain when identity/grade/pricing evidence is missing.
3. **No secrets in git** — PSA, eBay, OpenAI, Roboflow keys only in private `.env` / secret stores.
4. **No proprietary weights committed** unless owner explicitly authorizes and license allows.
5. **Pricing is gated** — never present active BIN or model guess as confirmed sold value.
6. **PR review** — material changes open a PR; leave a short note in Issues for cross-agent handoff.

## Recovered facts (Grok, 2026-07-26)

### From START-HERE / 2.18 package
- Extract-and-run Windows beta; Node 22 + Python 3.11/3.12
- Configure via `Configure-ManeFlow.cmd` → local `.env`
- Start: `Start-ManeFlow.cmd` → http://127.0.0.1:4321
- Vision adapters present; weights optional via `CARD_DETECTOR_MODEL_PATH` / `MANEFLOW_EMBEDDING_MODEL_PATH`
- Postgres mode: `DATABASE_URL`, `npm run db:migrate`, `STORAGE_MODE=postgres`

### From 2.16 recognition benchmark
- 67-image accessible project set
- Scene precision 46% → 100%; F1 62% → 91%; whole-image false fallbacks 15 → 0
- Deliberate recall tradeoff (abstain on tiny screenshot thumbnails)

### From Windows Store RC 2.20.0
- Hosted PWA package target
- `Build-Store-Package.cmd` uses Microsoft Store Developer CLI (`msstore`)
- External gate: Partner Center Product ID / Package ID / Publisher ID required before truthful MSIX
- Listing drafts, icons, 4 screenshots, privacy/terms drafts included in kit

### Segmenter contract
- Task: instance-segmentation
- Classes: raw_card, graded_slab, toploader, one_touch, sealed_pack, card_stack
- Providers: roboflow-hosted | roboflow-inference | onnx-local | tensorrt-local

## Suggested next PRs

1. **Import strongest source tree** from owner 2.18 Ready-To-Install package (sans secrets, sans weights).
2. **Branch `rebuild/source-of-truth`** and freeze baseline SHA.
3. **Recognition harness** + owner-labeled folder benchmark docs.
4. **Store identity placeholders** in `STORE-IDENTITY-REQUIRED.json` with clear TODOs.
5. **CI:** `npm run verify:beta` on push (Node 22).

## Handoff log

| Date | Agent | Note |
|------|-------|------|
| 2026-07-26 | Grok | Created repo; seeded README + this coordination doc from ZIP packages. ChatGPT could not see a prior repo under this account (0 public repos). |

Agents: append a row when you land meaningful work.
