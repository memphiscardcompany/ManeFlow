# ManeFlow Ultimate Product Architecture

Status: **Approved target architecture; implementation status varies by component**  
Owner: Joshua Chappell  
Canonical repository: `memphiscardcompany/ManeFlow`

## North-star product standard

ManeFlow should become the fastest, easiest, most accurate, most trustworthy, and most visually polished card-intelligence product without hiding uncertainty or fabricating evidence.

The customer experience is intentionally narrow:

```text
Upload Cards
→ ManeFlow processes every valid card
→ draft identity and value appear progressively
→ user confirms, corrects, or leaves unresolved
→ verified records save to Collection
```

Everything else exists to make this flow more reliable, not more complicated.

## Quality hierarchy

When goals conflict, use this order:

1. user privacy and security;
2. evidence integrity and abstention;
3. preservation of user work;
4. correct physical-card separation;
5. exact identity accuracy;
6. valuation evidence quality;
7. latency and throughput;
8. simplicity and visual polish;
9. feature breadth;
10. growth optimization.

A faster fabricated answer is worse than a slower honest draft. A durable partial result is better than a fast batch that loses most images.

## Reference architecture

```text
Customer web/PWA/native app
  ├─ authenticated upload session
  ├─ camera/photos/files/folder selector
  ├─ client image normalization and hashing
  └─ realtime progress and review UI
          │
          ▼
Edge/API gateway
  ├─ authentication and recent-session checks
  ├─ tenant authorization
  ├─ request validation and rate limits
  ├─ signed upload creation
  └─ idempotency keys
          │
          ▼
Private object storage + PostgreSQL
  ├─ original media objects
  ├─ normalized derivatives
  ├─ scan jobs and work units
  ├─ evidence ledger
  ├─ catalog and vector indexes
  ├─ provider records and pricing comps
  └─ collections and audit logs
          │
          ▼
Durable queue and workers
  ├─ decode/quality worker
  ├─ card-boundary detector
  ├─ rectification and grouping worker
  ├─ OCR/barcode/cert worker
  ├─ visual retrieval worker
  ├─ evidence-fusion worker
  ├─ pricing worker
  └─ notification/realtime worker
          │
          ▼
Draft results
  ├─ exact verified
  ├─ likely card family
  ├─ candidate set
  ├─ unresolved
  ├─ insufficient evidence
  └─ non-card rejected
```

Customer production jobs run only on managed cloud infrastructure. Joshua’s RTX workstation is restricted to owner-authorized development, benchmarking, targeted training, model export, and regression analysis.

## Durable intake architecture

### Required behavior

- One upload session per user action.
- Files may arrive from camera, photo library, ordinary files, folder selection, or recursive drag-and-drop.
- The browser computes stable hashes before upload where feasible.
- Exact duplicates are not uploaded or processed twice.
- Images upload directly to private storage through short-lived signed requests.
- A server-owned scan job persists independently of the browser.
- Every image and derived crop is an idempotent work unit.
- Closing or refreshing the page does not lose progress.
- Failed work units may resume without reprocessing completed units.
- The UI reports files selected, uploaded, decoded, rejected, crops detected, identities completed, pricing completed, deferred, and failed separately.
- Provider throttling pauses the queue rather than triggering a retry storm.

### Job contract

```ts
export type ScanJobStatus =
  | 'created'
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'paused_provider'
  | 'review_ready'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ScanJob {
  id: string;
  userId: string;
  organizationId: string | null;
  status: ScanJobStatus;
  source: 'camera' | 'photos' | 'files' | 'folder' | 'drag_drop' | 'scanner';
  fileCount: number;
  imageCount: number;
  detectedCardCount: number;
  completedCardCount: number;
  unresolvedCardCount: number;
  rejectedImageCount: number;
  permanentFailureCount: number;
  policyVersion: string;
  createdAt: string;
  updatedAt: string;
}
```

### Work-unit idempotency

```text
idempotency_key = SHA256(
  normalized_image_hash
  + crop_geometry
  + detector_model_hash
  + recognition_policy_version
  + catalog_version
)
```

A repeated request with the same key returns the existing work-unit result.

## ManeFlow Vision architecture

### Stage 1 — decode and image quality

Normalize EXIF orientation, HEIC/HEIF, JPEG, PNG, WebP, TIFF where supported, scanner formats, screenshots, and phone images. Record dimensions, decoded bytes, blur, glare, exposure, compression, rotation, crop completeness, and OCR readability.

### Stage 2 — physical-object detection

The detector identifies:

- raw card;
- partial card;
- PSA slab;
- other graded slab;
- slab label;
- toploader;
- penny sleeve;
- one-touch;
- binder pocket;
- card stack;
- sealed pack;
- sealed box;
- empty holder;
- empty pocket;
- non-card rectangle.

Instance segmentation is preferred when objects overlap. OpenCV contour detection remains an explicit fallback with lower confidence and stronger review requirements.

### Stage 3 — rectification and physical-card grouping

- Perspective-correct every valid card region.
- Preserve source image and crop provenance.
- Group front, back, reflective angle, burst, and video frames conservatively.
- Never merge two lookalike copies from the same image.
- Keep all views of one physical card in the same dataset split.

### Stage 4 — deterministic evidence extraction

Run targeted OCR and barcode/QR parsing on selected regions rather than the full image. Store raw text, normalized value, bounding box, orientation, confidence, parser version, and conflicts.

Important fields:

- player or subject text;
- year evidence;
- manufacturer and set;
- card number;
- subset/insert;
- parallel wording;
- serial stamp;
- grader, grade, and cert;
- autograph and memorabilia markers;
- language and regional edition.

### Stage 5 — candidate retrieval

Use separate authorized embeddings for:

- full front;
- full back;
- artwork region;
- border/layout;
- logos and marks;
- text regions;
- slab labels;
- finish appearance where lawful and validated.

Candidate retrieval produces possibilities, not truth.

### Stage 6 — geometric verification

Rerank candidates using local feature matching, homography stability, border alignment, artwork alignment, logo alignment, and text-region agreement. Reject candidates that violate directly observed card number, year, set, language, cert, or serial evidence.

### Stage 7 — evidence fusion

```ts
export interface EvidenceFusionInput {
  detector: DetectorEvidence;
  quality: QualityEvidence;
  ocr: OcrEvidence[];
  barcode: BarcodeEvidence[];
  cert: OfficialCertEvidence | null;
  retrieval: VisualCandidate[];
  geometry: GeometricMatch[];
  checklist: ChecklistConstraint[];
  frontBackAgreement: number | null;
  policyVersion: string;
}

export interface IdentityDecision {
  level:
    | 'official_verified'
    | 'exact_variant'
    | 'card_family'
    | 'candidate'
    | 'unresolved'
    | 'insufficient_evidence'
    | 'non_card';
  confidence: number;
  calibrated: boolean;
  candidateIds: string[];
  acceptedFields: Record<string, unknown>;
  withheldFields: string[];
  conflicts: EvidenceConflict[];
  nextAction: 'confirm' | 'choose_candidate' | 'add_back' | 'retake' | 'manual_search' | 'none';
}
```

Official PSA data is authoritative for a successfully verified PSA cert. Marketplace titles and active listing prices are never final identity evidence.

### Stage 8 — second-pass adjudication

Run an expensive multimodal adjudicator only when deterministic and retrieval evidence remains below the acceptance threshold or conflicts. The adjudicator may remove unsupported fields, explain conflicts, or request better evidence. It may not override official cert data or invent missing values.

## Confidence calibration

Never expose a model’s self-reported percentage as ManeFlow confidence.

Confidence combines:

- official verification;
- OCR agreement;
- checklist compatibility;
- visual retrieval score and margin;
- geometric evidence;
- front/back agreement;
- variant support;
- conflict count;
- image quality;
- open-set/out-of-catalog probability;
- historical calibration on protected data.

Track Expected Calibration Error, Brier score, false-confident exact matches, abstention rate, and correction rate.

## Optical Evidence Engine — experimental

The following modules remain `EXPERIMENTAL` until benchmarked:

- multi-frame glare separation;
- low-glare pixel fusion;
- holder-plane versus card-plane defect separation;
- reflection-motion finish analysis;
- layout fingerprinting;
- frequency-domain print and moiré analysis;
- synthetic holder/glare/occlusion generation;
- burst-frame super-resolution for text regions;
- uncertainty-aware active capture guidance.

The engine may support identity and image-quality decisions. It must not claim authentication, grading, counterfeit detection, or alteration detection beyond measured scope.

## Valuation architecture

Identification evidence and pricing evidence are separate graphs.

A comp is valuation-eligible only when it passes:

- completed-sale status;
- exact or explicitly adjacent identity match;
- grader and grade match where applicable;
- parallel/variation match;
- serial relevance;
- sale-date validity;
- lot/pack/box/reprint contamination rejection;
- duplicate-sale detection;
- source authorization;
- currency and fee normalization;
- outlier handling;
- provenance retention.

```ts
export interface ValuationResult {
  status: 'verified' | 'insufficient_comps' | 'unpriced';
  currency: string;
  low: number | null;
  midpoint: number | null;
  high: number | null;
  liquidity: number | null;
  confidence: number;
  saleCount: number;
  dateRange: { first: string | null; last: string | null };
  includedCompIds: string[];
  rejected: Array<{ compId: string; reasons: string[] }>;
  explanation: string;
  calculatedAt: string;
}
```

Active listings may provide asking-price context, candidate discovery, or listing strategy. They never set market value.

## Built-in AI system boundaries

ManeFlow’s AI systems should operate continuously only where real infrastructure exists:

- scheduled rights/provenance validation;
- queued correction review;
- benchmark execution;
- candidate index refresh;
- provider-health monitoring;
- draft Meta replies;
- owner notifications.

The system must never imply that a training worker, GPU process, or agent is running merely because a prompt or schedule exists. Every worker exposes health, last run, last success, failure reason, input version, output artifact, and commit/model hash.

## Local GPU development lane

Device policy:

```text
MANEFLOW_COMPUTE_DEVICE=cpu|cuda|auto
MANEFLOW_GPU_ALLOW_CPU_FALLBACK=true|false
```

CPU responsibilities:

- decoding, hashing, manifests, database operations, queue orchestration, provider calls.

GPU responsibilities:

- detector inference/fine-tuning;
- segmentation;
- OCR model inference where beneficial;
- embedding generation;
- local feature extraction where supported;
- optical experiments;
- benchmark batches.

Benchmark FP32, FP16, ONNX Runtime CUDA, TensorRT where compatible, batch sizes, pinned memory, warmup, VRAM, p50/p95 latency, throughput, OOM recovery, and CPU fallback. Joshua’s computer must never receive production customer work.

## ManeBrain and Meta architecture

```text
Meta webhook
→ raw-body signature verification
→ replay and duplicate check
→ normalized event
→ durable inbound queue
→ attachment authorization and private storage
→ intent and card-image analysis
→ customer-context retrieval
→ draft response
→ Joshua review/edit/reject
→ approved outbox job
→ exact-once guarded send
→ delivery receipt and audit
```

Public ManeFlow users cannot view Memphis Card Company Meta data.

Owner controls require immutable internal owner identity, MFA, recent reauthentication, audit logs, session listing, individual revocation, revoke all, and kill switches.

Automatic outbound customer actions, offers, refunds, inventory changes, deletion, hiding, blocking, or account changes are prohibited without explicit approved policy and owner authorization.

## Website and UI architecture

### Design language

The public website and app share one visual system:

- deep navy/charcoal surfaces;
- restrained Memphis blue accents;
- warm gold only for verified/high-value emphasis;
- premium card-vault depth without excessive gradients;
- high-contrast typography;
- consistent rounded geometry and shadows;
- authentic card imagery only;
- no fake graded cards or fabricated values.

### Navigation

Public customer navigation should prioritize:

1. Scan;
2. Collection;
3. Card detail/search;
4. Account.

Merchant, grading, show, staff, analytics, and ManeBrain tools appear only when entitled and authorized.

### Upload experience

The upload surface says **Upload Cards**. On mobile it opens the operating-system chooser for camera, photos, or files. Desktop adds folder selection and drag-and-drop. Advanced controls remain hidden unless needed.

### Result card

Every result shows:

- source thumbnail and crop;
- evidence tier;
- accepted identity fields;
- unresolved fields;
- conflicts;
- automatic value or unpriced status;
- Confirm, Correct, or Unresolved;
- Add to Collection.

### Accessibility and responsiveness

Require WCAG-oriented color contrast, semantic headings, labeled controls, keyboard navigation, visible focus, 44px touch targets, screen-reader status updates, reduced-motion behavior, responsive image sizing, and no horizontal overflow.

### Shopify boundary

Shopify may link or launch the app, but Liquid gating is not backend authentication. The external application independently validates sessions and tenant access. Direct URL bypass is tested. Use `app.memphiscardcompany.com` after DNS and deployment verification.

## Growth architecture

Product growth must come from user value rather than deceptive friction:

- successful first scan before advanced onboarding;
- guest trial with strict limits and account conversion at save;
- collection milestones and watchlists;
- private-by-default shareable collection views;
- referral/ambassador attribution;
- signed embed widgets;
- authorized catalog SEO pages;
- fast support and transparent correction workflows;
- measurable activation, time-to-first-result, correction rate, save rate, return rate, and retention.

## Scalability and reliability

Prepare for horizontal scaling through:

- stateless API nodes;
- PostgreSQL primary plus managed replicas where justified;
- private object storage;
- durable queues;
- CPU and GPU worker pools;
- per-provider circuit breakers;
- job leases and heartbeat recovery;
- dead-letter queues;
- idempotent provider calls and sends;
- structured logs and distributed traces;
- SLOs for upload, detection, identification, pricing, and save;
- backup, restore, rollback, and disaster-recovery tests;
- per-tenant quotas and cost attribution.

Do not claim millions-user readiness before measured load tests, provider quotas, queue capacity, database capacity, storage economics, GPU capacity, support operations, and incident response are established.

## Release gates

Production requires evidence for:

- clean canonical Git state;
- deterministic Node and Python tests;
- lint, typecheck, and builds;
- secret and dependency scans;
- migration smoke tests;
- tenant-isolation and authentication tests;
- owner/MFA tests;
- upload validation and private-storage authorization;
- Meta signature, replay, kill-switch, and exact-once tests;
- PSA and pricing contract tests;
- protected real-image benchmark;
- confidence-calibration gate;
- physical mobile test;
- physical GPU benchmark where promoted;
- backup, restore, rollback, and deployment smoke tests;
- owner approval.

## Success metrics

### User experience

- median time to first draft result;
- time to first saved card;
- upload abandonment;
- correction effort;
- mobile completion rate;
- accessibility defect rate.

### Vision

- detection precision/recall;
- non-card false positives;
- top-1 and top-5 identity;
- exact variant accuracy;
- cert extraction/verification;
- false-confident exact matches;
- abstention and correction rates;
- p50/p95 latency and cost.

### Valuation

- comp match precision;
- contamination rejection;
- duplicate suppression;
- value stability;
- sale count and liquidity coverage;
- user correction/dispute rate.

### Reliability

- job completion rate;
- provider retry amplification;
- queue age;
- error budget;
- restore and rollback time;
- tenant-isolation failures, target zero.

This document defines the target. Individual components remain implemented, tested, deployed, experimental, or blocked according to the current handoff and release reports.
