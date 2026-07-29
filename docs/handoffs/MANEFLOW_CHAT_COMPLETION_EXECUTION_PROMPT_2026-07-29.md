# ManeFlow + ManeBrain — Finish All Work From the July 29 Chat

Owner: Joshua Chappell  
Business: Memphis Card Company LLC  
Canonical repository: `memphiscardcompany/ManeFlow`

## Mission

Continue from the newest verified canonical `main` and complete every safe, reversible, technically supportable ManeFlow and ManeBrain task developed in the July 29 chat. This is an implementation assignment, not an audit-only report, mockup, speculative architecture document, or another prompt-writing exercise.

Do not restart or replace working architecture. Reconcile the strongest verified implementation from all merged history, open pull requests, AppDeploy generations, uploaded handoffs, and recovered packages. Preserve useful history and archive superseded work.

## Current verified repository state to inspect first

- PR #4 merged: canonical consolidation, recognition safety, Meta foundations, release provenance.
- PR #6 merged: governed CPU/CUDA execution, benchmark/data/model registry controls.
- PR #7 merged: best-of-version reconciliation, restored reranker and product-mode safety.
- PR #10 merged: Meta attachment, outbound channel, reconciliation, queue visibility hardening.
- PR #11 merged: verified Meta hardening release record.
- PR #12 merged: durable resumable folder scan jobs and browser retry-storm repair.
- Inspect any newer open or recently closed continuation PRs before adding overlapping changes.

Treat these statements as navigation hints, not proof. Verify exact branch, SHA, diff, CI, tests, and deployment state.

## Immediate priorities

### 1. Finish durable folder/image intake

Eliminate the observed retry storm from the 856-image upload workflow.

Required behavior:

- Drag-and-drop files and folders.
- Recursive folder picker where the browser supports it.
- Stable client job and item IDs.
- Server-owned durable jobs.
- Idempotent uploads and processing.
- SHA-256 payload integrity.
- JPEG, PNG, WebP signature validation.
- HEIC/HEIF only after a tested conversion path exists.
- Bounded browser upload concurrency.
- Bounded server processing concurrency.
- Strict transient retry classification and attempt ceilings.
- Permanent failures never retried automatically.
- Restart recovery and resumability.
- Progressive counts and paginated draft results.
- Safe cancellation preserving completed results.
- Private source storage and documented retention/deletion.
- No filenames or folder names used as identity evidence.
- No arbitrary 15-card cap; process valid detections in bounded batches.

Run the largest authorized endurance test available and report exact image count, completed count, failed count, retry count, throughput, p50, p95, restart recovery, and memory behavior. Do not claim the 856-image test passed unless it actually ran.

### 2. Complete ManeFlow Lite

The public beta workflow must be:

`create account → verify email → sign in → upload/scan → detect cards → identify conservatively → estimate value from authorized completed sales → review/correct/unresolved → save to private collection → sign out/in → reopen saved collection`

Prove server-side authentication, CSRF protection, session security, tenant isolation, private image access, collection persistence, export/delete controls, and cross-user denial.

### 3. Finish recognition and evidence fusion

Preserve the evidence-bounded selective matcher and abstention behavior.

Pipeline:

1. card/slab boundary detection;
2. non-card and empty-pocket rejection;
3. parallel crop processing;
4. visual candidate retrieval;
5. OCR after narrowing;
6. checklist and card-number constraints;
7. slab-label and cert extraction;
8. authoritative PSA verification when successful;
9. front/back and geometric agreement;
10. calibrated confidence, conflicts, and second-pass verification;
11. human confirmation or abstention.

Never invent identity, grade, cert, parallel, serial number, or value. Marketplace titles are not final identity evidence. Verified PSA data is authoritative for the PSA fields returned.

Run protected real-image benchmarks before accepting recognition changes. Record exact identity, cert accuracy, variation accuracy, false-confidence rate, abstention, calibration, latency, device, model hashes, and dataset provenance.

### 4. GPU development path

Use the governed `cpu`, `cuda`, and `auto` policy already merged.

On Joshua's workstation, when available:

- run the GPU doctor;
- verify the physical RTX 2070 SUPER and CUDA runtime;
- record VRAM, utilization, fallback reason, and execution provider;
- audit the owner-controlled image corpus before training;
- quarantine images with unclear rights or labels;
- lock train/validation/test splits by physical card;
- benchmark the unchanged baseline;
- train only a small justified component when the rights, labels, and expected VRAM fit are proven;
- promote no model without held-out benchmark improvement and rollback metadata.

Joshua's PC is development infrastructure only. It must never receive customer production jobs.

### 5. Pricing, PSA, eBay, and collection actions

Keep identity and pricing evidence separate.

- Use authorized completed sales, not active asking prices.
- Preserve exact sale history while explaining outliers.
- Filter wrong cards, sets, parallels, grades, lots, packs, boxes, reprints, duplicates, and unrelated records.
- Show exact versus adjacent evidence separately.
- Preserve PSA population, official images, cert URL, estimate fields, and timestamps only when the authorized provider actually returns them.
- Keep `Add to Collection` and reviewable eBay listing drafts.
- Never auto-publish a listing.
- Raw cards remain raw; graded-value scenarios are hypothetical.

### 6. ManeBrain and Meta integration

Preserve one ManeBrain authority layer and strict separation from ordinary ManeFlow users.

Complete the code-side owner console and Meta path while remaining fail-closed:

- exact asset allowlists;
- signed webhook verification;
- replay protection and deduplication;
- durable inbound/outbound persistence;
- bounded attachment retrieval to private storage;
- normalized Messenger, Instagram DM, comment, reply, and mention events only where the exact provider contract is verified;
- owner-only draft generation, editing, approval, queueing, sending, retry, delivery state, reconciliation, audit, dead-letter inspection, and kill switch;
- MFA and recent reauthentication for Joshua's immutable owner account;
- no automatic prices, offers, purchases, payments, refunds, inventory changes, or customer messages.

Keep `MANEBRAIN_META_KILL_SWITCH=true`, intake disabled, and outbound disabled until the authenticated Meta dashboard, exact permissions, Page/Instagram linkage, subscriptions, App Review/business verification requirements, public HTTPS callback, token health, one signed inbound event per channel, one owner-approved controlled outbound event, and rollback evidence are proven.

### 7. Professional first-party deployment

Replace numeric AppDeploy URLs as the public destination with a first-party domain such as `app.memphiscardcompany.com` or `maneflow.memphiscardcompany.com` after deployment gates pass.

Preferred manageable production split:

- frontend/PWA on Vercel or equivalent;
- managed PostgreSQL/Supabase;
- private S3/R2-compatible storage;
- Redis/managed queue;
- persistent API and worker services on Render/Railway or equivalent;
- cloud CPU/GPU workers;
- GitHub Actions tied to exact release SHAs;
- monitoring, backups, restore tests, rollback, and `/release` provenance.

AppDeploy may remain temporary preview/staging infrastructure, but it is not the long-term million-user architecture and must not be the canonical source of truth.

Do not deploy production until CI, migrations, backup/restore, security, browser, physical-device, provider, domain, and rollback gates pass. Do not overwrite the live Shopify theme without a staged preview and rollback.

## Security and privacy

Never commit or expose secrets, tokens, passwords, private certificates, webhook secrets, database credentials, customer data, private messages, or cost basis.

Use secret managers and sanitized environment-variable names.

Require least privilege, signed webhooks, rate limits, input validation, private storage, encrypted transport, immutable audits, tenant isolation, backups, and clear development/staging/production separation.

## Validation sequence

For each coherent change:

1. inspect existing implementation;
2. state objective and constraints;
3. make the smallest safe change;
4. add/update tests;
5. run focused tests;
6. run full Node verification;
7. run Python vision tests;
8. run static validation, secret scan, mobile typecheck/config, desktop config, build/package, PostgreSQL/pgvector integration, migration smoke, and release provenance checks;
9. inspect the final diff;
10. commit and push to a reviewable branch;
11. update or open a draft PR;
12. use exact CI results as authoritative evidence.

Never merge or deploy a failing branch. Never report test totals from a different SHA.

## Completion criteria

Continue until every safe repository-side task is complete and all remaining work is genuinely external, credential-gated, hardware-gated, provider-gated, or billing-gated.

The final report must state:

- Completed
- Verified
- Not verified
- Blocked
- Files changed
- Tests performed
- Branch
- Commit SHA
- Pull request
- CI run IDs and conclusions
- Deployment status and exact release SHA
- Remaining risks
- Next highest-priority action

Never claim fixed, trained, connected, deployed, live, production-ready, accurate, fast, or completed without direct evidence.
