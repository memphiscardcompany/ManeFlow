# ManeFlow Upgrade Analysis — 2.18.0-beta.1 package (Grok, 2026-07-26)

Source analyzed: `ManeFlow-v2.18.0-beta.1-Ready-To-Install-Windows.zip` (~13.4 MB archive, ~17 MB extracted, 158 JS files under test, 202 Node tests + 57 Python vision tests reported green in package test report).

Cross-checked against: Windows Store RC 2.20.0 kit, 2.16 recognition benchmark artifacts, ChatGPT live-deploy handoff (2026-07-26).

---

## 1. What is true right now

### Package truth (2.18.0-beta.1)
| Area | Status |
|------|--------|
| Version | `2.18.0-beta.1` (`package.json`) |
| Server | Node 22 ESM, `server.js`, local `http://127.0.0.1:4321` |
| Vision | Python FastAPI worker; OpenCV classical + optional Roboflow instance-seg + optional ONNX embeddings |
| Tests in package report | 202/202 Node, 57/57 Python, secret scan pass, smoke pass |
| Scene detector (2.16 bar) | Precision 100%, F1 90.9%, whole-image false fallbacks 0 on 67-image set |
| PSA | Partner API path with nested response normalization; desktop secure storage for key |
| Store path | Separate 2.20.0 kit packages **hosted PWA** → MSIX; not a full native rewrite |

### Live deploy (ChatGPT handoff, 2026-07-26)
| Item | Value |
|------|--------|
| Live app | https://142df297558ace9e22.v2.appdeploy.ai/ |
| Newest deployed source snapshot | `1784893687340` |
| Training schedules | **stopped** |
| Ohtani-specific benchmark | **removed** |
| Generic Benchmark Lab | retained, evaluation only |
| Recognition model | zero-input: user uploads photos; groups + identifies automatically |

### Honest boundaries (from package docs — keep these)
- Bundled data is demo / identity only — not universal live market value
- Active BIN = context only, never sold comps
- No proprietary weights or live provider credentials in archives
- Cert extraction ≠ authentication / grade guarantee
- Public real-time pricing requires authorized completed-sale feeds + production deploy

---

## 2. Architecture snapshot (2.18 tree)

```
apps/mobile-expo/     Expo client (bundle IDs com.memphiscardcompany.maneflow)
apps/desktop-electron/ (referenced in scripts/CI)
src/                  Node core: router, providers, db adapters, services, OCR
vision-worker/        Python FastAPI + OpenCV + optional ML backends
db/                   Postgres migrations / RLS / pgvector path
benchmarks/           2.15 baseline + 2.16 results (67 images)
docs/                 Extensive gates, roadmaps, release notes
public/               PWA / static assets
scripts/              verify, doctor, package, recognition benchmarks
```

**Providers present (adapters):** eBay, PSA path, JustTCG, SportsCardsPro, TCGPlayer (+ partner stubs), demo, Heritage/Goldin/Fanatics/COMC/Whatnot/CardLadder partner stubs.

**Vision ontology (v1):** `raw_card`, `graded_slab`, `toploader`, `one_touch`, `sealed_pack`, `card_stack`.

---

## 3. Gaps vs production / Store (prioritized)

### P0 — Must clear before claiming production or Store
1. **Partner Center identity** — Product ID / Package ID / Publisher ID still placeholders in 2.20 kit (`STORE-IDENTITY-REQUIRED.json`). No truthful MSIX without these.
2. **Live secrets out of git** — ensure production `.env` / secret store only; `security:scan` stays in CI.
3. **Source of truth in this repo** — 2.18 tree is still only in ZIPs; this GitHub repo has docs only until full import.
4. **Deployed snapshot vs package drift** — live snapshot `1784893687340` may differ from 2.18 ZIP; need explicit reconcile commit.

### P1 — Recognition / product quality
5. **Trained segmenter not in package** — Roboflow endpoint + weights are external gates (`ROBOFLOW_*`, `docs/ROBOFLOW_MODEL_GATE.md`). Classical fallback is strong on negatives but weaker on dense scenes / tiny cards (deliberate FN tradeoff).
6. **Exact identity still evidence-gated** — OCR + catalog + PSA cert path; no fabricated exact match. Improve top-1 with authorized catalog embeddings (SigLIP2 encoder gate already documented).
7. **Training schedules stopped** — if private-beta learning was intended, re-enable only with opt-in correction pipeline and no private pricing in training set.
8. **Benchmark expansion** — 67 images is scene-presence only. Need labeled exact-identity set (player/set/number/parallel/grade) for top-1/top-3 metrics.

### P2 — Platform hardening (from CODEX_HANDOFF + PRODUCTION_ROADMAP)
9. Default production storage: Postgres + pgvector (JSON mode fine for local beta).
10. Redis sessions / rate limits / job queue.
11. Verified email, password reset, account deletion flows.
12. Provider workers: cursoring, idempotency, retries, contract tests.
13. Billing / entitlements / metering if monetizing.
14. Observability, backups, staged CI deploy.

### P3 — Store / mobile polish
15. Privacy policy + Terms at **stable public HTTPS URLs** (drafts exist; must publish).
16. Expo EAS production builds with real Apple/Google credentials.
17. Four screenshots + listing already in 2.20 kit — keep in sync with live UI.

---

## 4. Recommended upgrade sequence (PRs)

| PR | Branch | Goal |
|----|--------|------|
| A | `import/2.18-source-tree` | Import 2.18 source **without** secrets, sample PII, or model weights; `.gitignore` hardened |
| B | `rebuild/source-of-truth` | Tag baseline SHA matching imported tree + document live snapshot ID |
| C | `feat/ci-verify-beta` | GitHub Actions: `npm run verify:beta` on Node 22 |
| D | `feat/store-identity-todos` | Fill STORE-IDENTITY placeholders structure; link Partner Center checklist |
| E | `feat/recognition-identity-benchmark` | Scaffold labels schema for exact-identity benchmark (not only scene presence) |
| F | `feat/reconcile-live-snapshot` | Diff live deploy `1784893687340` vs imported 2.18; merge forward |

---

## 5. What Grok will / will not do

**Will:** analysis, repo structure, import planning, CI, docs gates, PR reviews, recognition harness design, Store checklist, evidence-first product rules.

**Will not:** invent PSA/eBay credentials; commit proprietary weights without license; claim live market prices from demo data; train on private inventory/pricing; ship unsigned Store identity.

---

## 6. Immediate next action

1. ChatGPT or owner: push or attach the **newest deployed source** (snapshot `1784893687340`) into this repo if it is newer than the 2.18 ZIP.
2. Grok: after import, open PR A/B and freeze `rebuild/source-of-truth`.
3. Owner: paste Partner Center IDs into `STORE-IDENTITY-REQUIRED.json` when reserved.
