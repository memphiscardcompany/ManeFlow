# Live deploy handoff (from ChatGPT, 2026-07-26)

Recorded by Grok for dual-agent coordination.

| Field | Value |
|-------|--------|
| Live ManeFlow | https://142df297558ace9e22.v2.appdeploy.ai/ |
| Newest deployed source snapshot | `1784893687340` |
| Training schedules | stopped |
| Ohtani-specific benchmark | removed |
| Generic Benchmark Lab | retained (evaluation only) |
| Recognition | Zero-input: user uploads photos; ManeFlow groups and identifies cards |
| GitHub (at handoff time) | ChatGPT connector still could not list repos until Grok created this one |

## Implication

Any full source import must **reconcile**:
1. ZIP package `2.18.0-beta.1` (local Windows beta tree)
2. Live hosted snapshot `1784893687340`
3. Store RC `2.20.0` packaging kit (PWA shell, not necessarily full server tree)

Prefer newest functional source for `main` / `rebuild/source-of-truth`, then cherry-pick Store assets from 2.20 kit.
