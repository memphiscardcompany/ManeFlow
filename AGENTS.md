# ManeFlow Codex Instructions

You are working on the ManeFlow repository for Memphis Card Company.

## Workspace recovery
If Codex was launched in a folder that does not contain this repository, do not stop at "projectless workspace".
1. Search the user's accessible workspace for an existing clone whose remote is `memphiscardcompany/ManeFlow`.
2. If found, use that clone.
3. If no clone exists, clone `https://github.com/memphiscardcompany/ManeFlow.git` into the current accessible workspace.
4. Fetch all branches and check out `codex/maneflow-vision-3`.
5. If local uncommitted work exists in another ManeFlow clone, preserve it; do not overwrite or reset it.

## Current work order
Read `CODEX-WORK-ORDER-VISION-3.md` before changing code.

## Truth rule
Never claim working/fixed/tested/deployed without command output proving it. Preserve security hardening from PR #45. Never edit main directly or force-push.

## Product rule
Normal identification must work from ONE clear image/frame. Multiple angles, flipping, or temporal accumulation are optional fallbacks only when the visible evidence is genuinely insufficient.
