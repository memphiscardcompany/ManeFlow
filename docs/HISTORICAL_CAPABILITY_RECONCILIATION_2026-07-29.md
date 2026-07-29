# ManeFlow Historical Capability Reconciliation — 2026-07-29

Owner: Joshua Chappell  
Business: Memphis Card Company LLC  
Product: ManeFlow  
Private operating layer: ManeBrain  
Canonical repository: `memphiscardcompany/ManeFlow`  
Continuation branch: `codex/maneflow-continuation-20260729-0614`  
Main baseline after canonical consolidation: `635693653975efaecac22c2ae67d6e801c8ccadc`

## Objective

Build the final ManeFlow from the strongest **verified, compatible, rights-compliant, secure, maintainable, and user-centered** capability found across every recovered package, deployment, audit, handoff, and project decision.

Historical packages are evidence sources. They do not automatically replace the canonical repository. A capability is promoted only when its implementation is inspected, its provenance is recorded, its security and data-rights boundaries remain valid, and its applicable tests pass in the continuation branch.

The immediate customer product remains ManeFlow Lite:

1. upload one image, many images, or a folder;
2. detect every valid card and reject empty/non-card regions;
3. identify each card conservatively;
4. verify PSA slabs through official data where authorized;
5. estimate value from eligible completed-sale evidence;
6. allow Confirm, Correct, or Unresolved;
7. save verified results to a private collection.

Broader merchant, grading, portfolio, show, organization, listing, billing, Meta, mobile, desktop, analytics, and automation capabilities remain part of the architecture but must not destabilize the core flow.

## Source integrity

| Source | SHA-256 | Classification |
|---|---|---|
| `ManeFlow-Canonical-Consolidation-2026-07-26-FINAL.zip` | `bf8b5b637457a1d16e05cf6d51500f62f4ecc4d13d3711c58cc718f45f4f88a2` | Canonical historical consolidation |
| `ManeFlow-Canonical-Consolidation-2026-07-26-FINAL.bundle` | `828be96363ceb76ed2804405bcf78a05955a9bbe7f9c4b5a10fabcc56b44eec5` | Git-history source; inspected |
| `ManeFlow-v1.4-Pricing-Portfolio-Intelligence-Final.zip` | `5e86a13da1dceb4f7c602e79178d69d837353546b93f6145e90a32273666bde9` | Verified historical package |
| `ManeFlow-v2.6-PSA-Market-Intelligence.zip` | `cab6196a1dd2fb7234a8cc3116cd61e4b27d92deac57acfc2ba770dbe93353ea` | Verified historical package |
| `ManeFlow-v2.7-Imaging-Lot-Intelligence.zip` | `300b3981667a6d83d00e9317f045c0df19f3c811204be244c41bb7d4e28b36fd` | Verified imaging continuation package |
| `ManeFlow-v2.21.0-beta.1-State-of-the-Art-Vision-Source.zip` | `57fa0bce420c4e250a84a30131f5e31ac4a58f152affd93ce1ac269ddf36431b` | Verified vision source package |
| `maneflow-dealer-os-v3.zip` | `f2b678b83ff599a51fe23081fd921e99a2da98c26faa5d5c90c6aa701c28d46c` | Superseded historical draft |
| `maneflow-dealer-os-v3-build.zip` | `bdf1fc3326d7ba19211ae5f0726f698d380b35639472d4f1221fe6ab1805941f` | Verified historical build |
| `maneflow-dealer-os-v3.3-audited.zip` | `45d3a7fbd18e52371590af2cb8651ecbbfb2329453b5309bee90f8bc72dd028c` | Verified audited Dealer OS source |
| `ManeFlow_Website_Handoff_Package_2026-07-26.zip` | `011c53441290fca10f92c3603baba0d5f407812e71cd46f537571825c4b4b869` | Website handoff evidence |

## Executed verification evidence

The following checks were executed in the recovery environment on Node.js `v22.16.0` and the available Python runtime:

| Package | Command scope | Result |
|---|---|---|
| ManeFlow v1.4 | `npm run verify` | 44/44 tests passed; check and smoke passed |
| ManeFlow v2.6 | `npm run verify` | 186/186 tests passed; check, smoke, mobile, and desktop validation passed |
| ManeFlow v2.7 | `python -m pytest -q` in `backend` | 31/31 tests passed |
| ManeFlow v2.21 Node | `npm test` | 225/225 tests passed |
| ManeFlow v2.21 vision worker | `python -m pytest -q` | 54/54 tests passed |
| ManeFlow v2.21 additional gates | check, credential scan, smoke, mobile, desktop, integrated beta smoke | all passed |
| Dealer OS v3.2 build | `npm run build && npm test` | build passed; 4/4 tests passed |
| Dealer OS v3.3 audited | `npm run verify` | typecheck and build passed; 12/12 tests passed |
| Dealer OS v3.0 | `npm run build` | failed because dependencies and Node types were absent; deprecated by v3.3 |

These results prove package-local behavior only. They do not prove current production deployment, live-provider access, physical-device performance, or large-scale capacity.

## Selection doctrine

For each recovered capability:

1. Prefer the newest implementation that preserves compatible behavior.
2. Prefer deterministic evidence and explicit contracts over model self-confidence.
3. Prefer server-owned durable jobs over browser-bound loops.
4. Prefer official provider data over OCR or marketplace titles.
5. Prefer completed-sale evidence over asking prices.
6. Prefer calibrated abstention over fabricated exact matches.
7. Prefer private, user-scoped storage and least privilege.
8. Preserve useful superseded work in history or archive; do not silently delete it.
9. Mark theoretical systems `EXPERIMENTAL` until protected benchmarks prove improvement.
10. Never let advanced future features block the reliable ManeFlow Lite workflow.

## Best verified capability by generation

### ManeFlow v1.4 — pricing and portfolio foundation

Promote or preserve:

- completed-sale normalization;
- duplicate controls and IQR outlier filtering;
- value range, trend, liquidity, freshness, source diversity, and confidence;
- Comp Quality gating before valuation use;
- portfolio value, cost basis, ROI, allocation, concentration, liquid-value, and scenario analysis;
- collection CSV import/export;
- account isolation, sessions, password recovery, export, and deletion;
- provider contracts, signed ingestion, authorization basis, backup, restore, doctor, CI, Docker, PWA, and Expo foundations.

Do not promote demo catalog or synthetic sales into production evidence.

### ManeFlow v2.6 — PSA and market-intelligence foundation

Promote or preserve:

- official PSA cert verification separated from valuation;
- bounded PSA timeouts, retries, rate-limit handling, cert normalization, and redacted status;
- stale-while-refresh market data coordinator;
- demand-aware comp refresh without blocking recognition;
- local image and scene intelligence;
- recognition learning that excludes raw images, notes, email, private identifiers, and valuation data;
- visual retrieval as candidate evidence only;
- catalog autocomplete, data-rights registry, source policy, manual comp review, organizations, merchant pricing, and desktop/mobile validation.

Review before promotion:

- the standalone PSA provider must be reconciled with the newer canonical PSA partner adapter and current authorization contract;
- the historical comp-refresh coordinator must move to the durable queue rather than remain single-process;
- historical visual retrieval based on marketplace-title consensus cannot become final identity evidence.

### ManeFlow v2.7 — imaging and lot foundation

Promote or preserve:

- dedicated card/slab/container detection contract;
- optional learned instance segmentation with OpenCV fallback;
- perspective rectification;
- separate detection, visibility, grouping, identity, variant, and pricing confidence;
- cross-image repeated-view grouping with same-photo anti-merge safeguards;
- single-card, multi-card, binder, tabletop, mixed holder, sealed-product, and listing-photo scene support;
- conservative lot economics using only verified prices;
- correction propagation across physical-item groups;
- barcode extraction, image quality, glare, blur, exposure, crop, and resolution warnings;
- hard-negative training classes for non-card rectangles.

Historical smoke evidence remains limited: the included 20-image classical-CV benchmark found candidates in 17/17 labeled card scenes but produced a false-positive scene in 1/3 known non-card scenes. It is not identity-accuracy evidence.

### ManeFlow v2.21 — advanced recognition and visual-search foundation

Promote or preserve:

- dedicated vision worker and GPU-ready architecture;
- PostgreSQL/pgvector catalog and embedding interfaces;
- front/back vector fusion;
- visual candidate reranking with metadata weights, hard conflicts, candidate margins, card-family ambiguity, and explicit out-of-catalog behavior;
- distinct scan product modes for catalog identification, marketplace visual search, inventory batch, and official graded-cert lookup;
- marketplace visual search explicitly prohibited from setting identity or value;
- local OCR field parser;
- release gates, benchmark schemas, store boundaries, Windows packaging, mobile and desktop checks;
- legal image-data policy and competitor-study documentation.

Material omissions discovered in the 2.22 consolidation and approved for reconciliation:

- `src/services/visual-candidate-reranker.js`;
- `src/services/scan-product-modes.js`;
- `integrations/visual-search-v3.schema.json` and compatibility schema;
- associated tests;
- the v2.21 architecture, legal-image policy, and competitor-study records.

Generated caches and `__pycache__` files are excluded.

### Canonical v2.22 consolidation and GPU branch

Preserve as canonical baseline:

- PostgreSQL tenancy, row-level security, pgvector, HNSW, catalog ingestion, and application-state compatibility;
- ManeBrain owner/Meta schema, durable outbox, inbound indexes, signature verification, replay controls, idempotency, owner authority, attachment policy, and outbound policy;
- device policy for CPU/CUDA/auto;
- dataset audit, split isolation, model registry, experiment registry, benchmark comparison, and promotion policy;
- owner-controlled training-corpus tooling and locked benchmark rules;
- PSA partner contract tests and live validation gate;
- native, PWA, desktop, installer, CI, release metadata, and rollback controls.

### Dealer OS v3.3 audited

Promote through reviewed adapters, not wholesale replacement:

- ambiguity-aware intent classification;
- idempotent Meta event claiming;
- normalized attachment evidence;
- bounded provider retry/timeout and pricing provenance;
- buying decisions with no-data and exact-match safeguards;
- knowledge graph with evidence-returning answers;
- draft-enforced offers, purchase orders, replies, shipping, and payments;
- read-only Meta ownership verification;
- weekly content-opportunity analysis.

Preserve the draft-only safety boundary. No automatic reply, offer, purchase, payment, refund, posting, blocking, or inventory mutation may bypass owner approval.

### AppDeploy deployments

Current discovered deployments:

- `50bb824255c843ef9a` — focused account-gated ManeFlow Lite beta; v37 contains the retry-storm repair, typed provider failures, circuit breaker, bounded retry, folder upload, recursive drag-and-drop, and confidence ceiling.
- `142df297558ace9e22` — advanced historical card-intelligence workspace; v87 now restricts Meta Inbox and manual learning controls to `memphiscardcompany@gmail.com`, keeps signed webhook intake public, requires explicit `META_OUTBOUND_ENABLED=true`, and passed AppDeploy QA after the owner-boundary repair.
- `68640e2182c1d39066` — historical eBay/PSA image-retrieval utility; retain as evidence until its provider contracts and data rights are reconciled.

The AppDeploy systems are not the canonical source and must not drift outside GitHub.

## User-experience target

The final product must feel simpler than its architecture:

```text
Upload Cards
→ ManeFlow prepares and detects everything
→ draft results appear progressively
→ conflicts and uncertainty are obvious
→ user confirms or corrects
→ ManeFlow prices automatically
→ user saves to Collection
```

Required experience qualities:

- one primary upload control that opens camera, photos, files, or folder selection where supported;
- drag-and-drop for files and folders;
- persistent, resumable batch jobs;
- progress based on durable work units rather than cosmetic percentages;
- no empty-card records;
- no fabricated exact matches or prices;
- clear evidence, confidence tier, conflicts, and next action;
- fast correction without exposing unnecessary technical complexity;
- polished mobile-first Memphis Card Company visual language;
- accessible typography, contrast, focus, touch targets, keyboard flow, screen-reader semantics, reduced motion, and error recovery;
- public ManeFlow and private ManeBrain separated visibly and technically.

## Theoretical and experimental upgrade register

The following ideas are approved for controlled design and prototyping. None may be described as implemented or better until benchmarked.

### Vision and optical evidence

- multi-frame glare separation and low-glare pixel fusion;
- holder-plane versus card-plane defect separation;
- layout fingerprints using border, artwork, logo, and text geometry;
- finish analysis from controlled reflection movement;
- frequency-domain print and moiré analysis;
- synthetic glare, sleeve, slab, binder, occlusion, compression, and lighting factory;
- active-learning hard-negative mining;
- open-set out-of-catalog detector;
- uncertainty-aware mixture of detector, OCR, retrieval, geometry, cert, and multimodal adjudicator;
- per-card provenance graph connecting source image, crop, OCR region, candidate, cert, checklist, comp, correction, and model version.

### Performance

- direct-to-object-storage resumable uploads;
- image hashing before upload;
- duplicate and near-duplicate reuse;
- WebAssembly preprocessing where it beats server upload cost;
- batched GPU detector, OCR, embedding, and geometric verification;
- adaptive batch sizing from GPU VRAM and provider health;
- queue backpressure, circuit breakers, leases, dead-letter queues, and idempotent resume;
- model distillation, ONNX, TensorRT, FP16, and quantization only after accuracy gates;
- region-of-interest OCR rather than whole-image OCR;
- cache keys tied to normalized image hash, model hash, catalog version, and policy version.

### Product intelligence

- explanation-first valuation with exact comp inclusion/exclusion reasons;
- liquidity-adjusted value and confidence intervals;
- portfolio risk, aging, concentration, and sell/grade/hold scenarios;
- dealer-mode offer sheets and show intake;
- provenance-backed customer correction learning;
- owner-controlled Meta drafts with customer context and exact-once sends;
- knowledge graph that cites internal records and refuses unsupported conclusions.

### Growth and usage

- frictionless guest trial with strict limits and account conversion at save;
- shareable verified collection views with private-by-default controls;
- saved scan history, watchlists, alerts, and collection milestones;
- transparent referral and ambassador loops;
- embeddable valuation/intake widgets with signed origin controls;
- SEO pages based on authorized catalog metadata, never fabricated card images or prices;
- fast onboarding that demonstrates one successful scan before exposing advanced features.

## Promotion gates for theoretical work

Every experimental upgrade must include:

1. a written hypothesis;
2. an implementation or reproducible prototype;
3. a rights-cleared protected benchmark;
4. baseline and candidate model hashes;
5. accuracy, false-confidence, latency, memory, and cost measurements;
6. device/provider/runtime metadata;
7. regression results for non-card rejection, exact variant, and tenant isolation;
8. rollback instructions;
9. an explicit decision: promote, continue experiment, or reject.

## Explicit exclusions

Do not promote:

- browser-only retry storms;
- one general multimodal request per image as the permanent large-batch architecture;
- marketplace titles as authoritative identity;
- active listings as final value;
- eBay or other unlicensed marketplace imagery as a permanent training corpus;
- self-reported model percentages as calibrated confidence;
- raw-card cert or grade invention;
- automatic Meta sending or business actions without owner approval;
- local owner hardware as customer-serving infrastructure;
- generated mock cards presented as real products or evidence;
- secrets, customer data, private pricing, or absolute workstation paths.

## Immediate promotion sequence

1. Preserve the AppDeploy v37 retry-storm repair and v87 owner-only Meta boundary in GitHub.
2. Restore the verified v2.21 visual reranker, product-mode policy, schemas, tests, and documentation.
3. Review and port the v2.6 PSA provider, comp-refresh coordinator, local image/scene intelligence, recognition-learning privacy model, and visual retrieval where they are stronger than current canonical modules.
4. Port Dealer OS v3.3 intent, knowledge, buying, and Meta adapter behavior through current ManeBrain security and persistence contracts.
5. Build the durable server-owned scan-job architecture.
6. Benchmark the current vision worker on rights-cleared images and the actual RTX 2070 SUPER.
7. Promote only measured improvements.
8. reconcile the focused public UI with the canonical backend and use the first-party hostname after DNS verification.

## Current evidence-based status

- **Confirmed current implementation:** canonical main includes the 2.22 consolidation and governed GPU branch; AppDeploy v37 and v87 are deployed.
- **Tested implementation:** historical package test results listed above; canonical PR checks previously passed; AppDeploy v87 QA passed.
- **Deployed implementation:** AppDeploy beta deployments only. This does not prove production scale or complete provider connectivity.
- **Approved planned work:** reconciliation and durable scan-job architecture.
- **Experimental work:** optical evidence engine, model optimizations, and unbenchmarked theoretical upgrades.
- **Unverified claims:** perfect accuracy, 100× speed, millions-user capacity, automatic learning improvement, complete Meta production permissions, and permanent AppDeploy suitability.
- **Blocked work:** first-party custom domain pending DNS; account-side Meta app review/token/subscription actions; physical GPU benchmark; production provider credentials and infrastructure; production release approval.
