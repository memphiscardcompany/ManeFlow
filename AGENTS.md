# ManeFlow Codex Instructions

You are working on the ManeFlow repository for Memphis Card Company.

## Workspace recovery
If Codex was launched in a folder that does not contain this repository, do not stop at "projectless workspace".
1. Search the user's accessible workspace for an existing clone whose remote is `memphiscardcompany/ManeFlow`.
2. If found, use that clone.
3. If no clone exists, clone `https://github.com/memphiscardcompany/ManeFlow.git` into the current accessible workspace.
4. Fetch all branches and check out `codex/fix-real-card-identification-20261003` (or its explicitly designated successor from issue #47).
5. If local uncommitted work exists in another ManeFlow clone, preserve it; do not overwrite or reset it.

## Current work order
Read `CODEX-WORK-ORDER-VISION-3.md` and GitHub issue #47 before changing code. Issue #47 is the canonical consolidation contract.

## Truth rule
Never claim working/fixed/tested/deployed without command output proving it. Preserve security hardening from PR #45. Never edit main directly or force-push.

## Product rule
Normal identification must work from ONE clear image/frame. Multiple angles, flipping, or temporal accumulation are optional fallbacks only when the visible evidence is genuinely insufficient.


## Canonical development rule
- Maintain one canonical implementation for each capability.
- Before adding a replacement, search current code and recovered branches for an existing verified implementation.
- Prefer the strongest tested implementation; port only unique useful deltas from stale branches.
- Delete obsolete duplicate runtime paths only after tests prove the canonical replacement and references are removed.
- Do not create parallel "v2", "new", "final", "ultimate", or experimental production paths when the canonical path can be improved in place.
- Temporary experiments must be isolated, clearly named, benchmarked, and removed or promoted after evaluation.
- CI/security failures are defects or explicit external blockers; never suppress them to obtain green status.

## Recognition release rule
Recognition is release-critical. Unit tests are necessary but insufficient. Exact-card claims require held-out real-card evidence. The primary flow is one clear front image/frame -> localization -> independent per-card identity -> exact attributes/variant when supported -> confidence/evidence -> abstention when uncertain. Multi-card and video must use this same canonical identity engine.
