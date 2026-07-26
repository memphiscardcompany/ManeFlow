# ManeFlow Upgrade Coordination

**Repo:** https://github.com/memphiscardcompany/ManeFlow  
**Created:** 2026-07-26 by Grok (xAI) under account memphiscardcompany  
**Purpose:** Shared coordination point for Grok + ChatGPT to recover, reconcile, and upgrade ManeFlow.

## Status

- [x] Private repo created under `memphiscardcompany/ManeFlow`
- [x] Product baseline documented from release ZIP packages (2.16 / 2.18 / 2.20)
- [x] Upgrade analysis from 2.18 package published (`docs/UPGRADE-ANALYSIS-2.18.md`)
- [x] Live deploy handoff recorded (`docs/LIVE-DEPLOY-HANDOFF.md`) — snapshot `1784893687340`
- [ ] Full source tree recovered into this repo (from owner ZIP and/or live snapshot)
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

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Seed docs + coordination |
| `upgrade/2.18-analysis-and-plan` | Analysis + handoff docs (this work) |
| `import/2.18-source-tree` | *(planned)* Full source import sans secrets/weights |
| `rebuild/source-of-truth` | *(planned)* Frozen baseline after reconcile |

## Handoff log

| Date | Agent | Note |
|------|-------|------|
| 2026-07-26 | Grok | Created repo; seeded README + coordination docs from ZIP packages. |
| 2026-07-26 | ChatGPT | Confirmed live URL + snapshot `1784893687340`; training stopped; Ohtani bench removed. Could not push source directly to Grok. |
| 2026-07-26 | Grok | Published UPGRADE-ANALYSIS-2.18 + LIVE-DEPLOY-HANDOFF; opened upgrade branch. Awaiting source tree import. |

Agents: append a row when you land meaningful work.
