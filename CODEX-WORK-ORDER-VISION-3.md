# ManeFlow Vision 3.0 — Active Codex Work Order

## Mission
Make ManeFlow's card recognition materially better for the owner's real workflow than CardSight's public product surface, without copying CardSight code/data or making unverified marketing claims.

## Immediate priority
The current Python worker can detect several card-shaped objects, but `/v1/scan` selects only the strongest detection for identity analysis. Fix that junction first.

### Required first milestone
One clear photo/frame containing 1, 9, or many visible cards must:
1. decode once;
2. detect all physical card regions;
3. reject nested artwork/duplicate regions;
4. rectify every accepted card crop;
5. process every region independently;
6. batch expensive feature extraction where possible;
7. return one result per physical card;
8. integrate those regions into the Node recognition engine;
9. surface uncertainty rather than inventing identities.

Do NOT require multiple angles. Do NOT require a back image. Do NOT require several video frames for ordinary recognition.

## Architecture target
```
ONE IMAGE / ONE VIDEO FRAME
  -> scene detector
  -> N physical card regions
  -> crop + perspective rectify
  -> batch OCR / embeddings / barcode evidence
  -> structured catalog candidate retrieval
  -> candidate reranking + parallel/variant evidence
  -> N exact identities OR explicit abstentions
  -> market / inventory / listing actions
```

## Existing components to reuse
Inspect and reuse before creating replacements:
- `vision-worker/app/services/imaging/detector_router.py`
- `card_detector.py`
- `high_recall_recovery.py`
- `rectify.py`
- `embedding_engine.py`
- `barcode.py`
- `quality.py`
- `surface_classifier.py`
- `reference_matcher.py`
- `reconciliation.py`
- `src/services/recognition-pipeline.js`
- `src/services/recognition-scene-router.js`
- `src/services/recognition-engine.js`
- `src/services/vision-worker-client.js`
- mobile Expo camera code

## Phase 1 — benchmark before claims
Create/extend held-out, owner-authorized benchmark coverage for:
- single raw
- single slab
- 2–5 loose cards
- 9-card binder page
- 10–30 card tabletop
- mixed raw/slab
- mixed sports/TCG
- sleeves/toploaders
- glare/perspective/rotation
- duplicates and two separate copies of same design
- subtle parallel/variation cases
- images where exact parallel is impossible from visible evidence

Measure:
- detection recall/precision
- exact physical-card count
- top-1 exact ID
- top-3
- card-number accuracy
- parallel accuracy
- slab/grade/cert accuracy
- confident-wrong rate
- abstention rate
- p50/p95 latency
- cards/sec

Never use competitor output as ground truth.

## Phase 2 — true local multi-card scene API
Implement a backward-compatible scene endpoint or contract, e.g. `POST /v1/scan/scene`.

Return per region:
- region_id
- polygon/bbox
- detector confidence
- rectified crop reference
- quality
- barcode/QR evidence
- OCR evidence
- embedding metadata
- identity result
- top candidates
- field confidences
- variant confidence
- warnings / abstention reason

Existing `POST /v1/scan` must remain compatible.

## Phase 3 — Node integration
Add/extend `VisionWorkerClient` so local multi-region worker results populate the same normalized structure consumed by the Node recognition pipeline.

Local detector evidence must be sufficient for multi-card scene recognition. Remote general-purpose vision may be an escalation path, not a prerequisite.

## Phase 4 — exact one-view identity cascade
For each crop:
1. category/domain classification;
2. embedding retrieval;
3. targeted OCR;
4. structured catalog constraints;
5. visual reranking;
6. parallel/variation analysis;
7. evidence fusion;
8. calibrated accept/abstain decision.

One clear view is the default contract.

## Phase 5 — parallel/variation engine
Make parallel recognition first-class. Use visible color/foil/surface pattern, serial numbering, design geometry, OCR, card number, release/checklist constraints, and existing surface analysis.

If evidence cannot distinguish the exact parallel, return `parallel_status: unresolved` with candidates. Never guess.

## Phase 6 — live video
After single-frame multi-card recognition is correct, run that same engine continuously.

Video is for convenience, not because recognition requires many frames.

Tracking should primarily:
- avoid duplicate events;
- stabilize UI boxes;
- count each physical card once.

Temporal fusion may opportunistically improve confidence, but normal ID must not depend on it.

## Phase 7 — listing-ready imaging
For each detected card, generate faithful derivative images:
- crop
- rotate
- perspective-correct
- dewarp
- exposure/white-balance normalization
- high-quality JPEG/PNG

Never generatively repair corners, edges, scratches, print defects, or other condition evidence. Preserve original hash and derivative provenance.

## Phase 8 — workflow advantage
Connect recognized cards directly to ManeFlow actions:
- Vault
- pricing/comps
- shop intake
- grading review
- listing draft
- cost basis
- show inventory

Recognition should lead directly to action rather than ending at a card name.

## One-view release requirement
A normal user should be able to point the camera once at:
- one card,
- a nine-card binder page,
- or a tabletop spread,

and receive one independently processed result for every visible physical card from that single view.

Additional views are optional only when the card itself does not expose enough information for exact differentiation.

## Required verification
After every meaningful phase:
- `npm run verify`
- `npm run security:scan`
- CPU vision pytest suite
- mobile typecheck when mobile code changes

Also run relevant focused tests during development.

Do not weaken failing gates to obtain green output.

## Git discipline
- Work only on `codex/maneflow-vision-3`.
- Do not force-push.
- Do not edit `main`.
- Preserve PR #45 security hardening.
- Commit coherent milestones with clear messages.
- Keep a running implementation/benchmark report in the branch.

## Status vocabulary
Use only:
- VERIFIED
- FIXED
- IMPLEMENTED
- TESTED
- BENCHMARKED
- UNVERIFIED
- BLOCKED_EXTERNAL

## First action now
Recover/open the real ManeFlow repository, check out `codex/maneflow-vision-3`, inspect current HEAD and PR #45 differences, then implement the local multi-card scene path. Do not spend the session producing another roadmap.
