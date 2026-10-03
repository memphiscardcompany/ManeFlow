# Canonical Recognition Governance

Issue #47 and `CODEX-WORK-ORDER-VISION-3.md` define the acceptance contract. This document maps that contract to runtime owners and promotion evidence. A green unit suite alone does not establish exact-card accuracy.

## Runtime owners

| Responsibility | Canonical path |
| --- | --- |
| Physical card localization and crop rectification | `vision-worker/app/services/imaging/detector_router.py` and its detector/rectifier modules |
| Crop identity and reference evidence | `vision-worker/app/services/identity_engine.py` |
| Still image scene API | `vision-worker/app/api/scan.py` |
| Video tracking and crop calls into the same identity engine | `vision-worker/app/services/live_session.py` |
| Worker to catalog scene handoff | `src/services/vision-worker-client.js` |
| Catalog matching, selective decision, and abstention | `src/services/recognition-engine.js` and `src/services/recognition-decision.js` |
| Customer scan HTTP path | `src/router.js` and `src/services/scan-pipeline.js` |

Every detected crop must retain its own bounds, text, identity fields, field confidence, variant confidence, warnings, and manual review state. Image-level text and a top-ranked detection must not stand in for other card regions. A whole-image fallback is a review candidate, not a confirmed physical card. Remote scene analysis may provide a fallback when the local worker does not return physical regions; it may not replace a valid local multi-card scene.

Pricing, inventory, and listing actions require a confirmed canonical catalog identity. Provider confidence or extracted text without a canonical card ID is insufficient. Review or abstention must survive every Python-to-Node handoff and every temporal update.

## Promotion evidence

Before a recognition change is promoted, record the exact Git commit, commands and exit codes, benchmark manifest digest, split, rights status, coverage by scene type, one-to-one localization metrics, exact identity and parallel accuracy, false-confident exact rate, abstention rate, and p50/p95 latency. The locked benchmark must include single raw cards, slabs, subtle parallels, multi-card spreads, clutter or sleeves, and video. The same physical card group must not appear in both train/calibration and locked test. Synthetic tests verify contracts but do not substitute for real-card evidence.

The one-to-one detector evaluator in `vision-worker/tools/evaluate_detection_localization.py` is the localization gate. Count-only scene metrics remain diagnostics. Video replay uses `vision-worker/replay_live_sequence.py`; any reported canonical card ID must satisfy the same evidence threshold as still images. A benchmark result is **unverified** if media, independent labels, rights, or exact commit provenance are missing.

## Consolidation rule

PR #46 is the active recognition lineage based on `codex/maneflow-vision-3`. PR #43's localization gate and PR #44's live market refresh were recovered into that lineage after focused verification. Keep other historical branches for audit until their unique behavior has been compared with this lineage. Remove duplicate runtime paths only after their callers are migrated, tests prove the replacement, and the branch diff shows no unique capability is lost. Never force-push or edit `main` directly.

CI must keep the Node, Python vision, security, native/mobile, container, and provenance gates enabled. A failed advisory or unavailable external benchmark is reported as a failed or unverified gate, never reclassified as success.
The pull request workflow checks out `github.event.pull_request.head.sha` and verifies `git rev-parse HEAD` before each job; container revision labels use that same source SHA. GitHub's temporary merge commit is a separate integration signal and must not be cited as an exact-head test.
