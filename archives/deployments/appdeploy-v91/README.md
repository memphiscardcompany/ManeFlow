# AppDeploy v91 provenance capsule

## Classification

**Deployed AppDeploy snapshot — tested by AppDeploy QA — not yet reconciled as the canonical production application.**

This directory records the smallest verified delta from AppDeploy v90 to the applied v91 snapshot for app `142df297558ace9e22`.

## Snapshot

- AppDeploy app ID: `142df297558ace9e22`
- Version name: `v91`
- Version ID: `1785478189041`
- Created: `2026-07-31T06:09:49.041Z`
- Live AppDeploy URL: `https://142df297558ace9e22.v2.appdeploy.ai/`
- v90 base version ID: `1785476302989`
- Canonical GitHub `main` at capture: `da8738ce33c89738d3e9007cb99903804b2f57fe`

The Memphis Card Company Shopify ManeFlow page embeds the AppDeploy app hostname rather than a version-specific URL. Once v91 became the applied snapshot, the existing website route began serving v91 without another Shopify page mutation.

## Verified v91 delta

v90 contained this hidden limit:

```ts
return output.slice(0, 30)
```

v91 retains every non-overlapping detector boundary:

```ts
return output
```

The identification stage remains bounded internally in chunks of two crops. This removes an artificial product cap without attempting one unbounded inference request.

The v91 QA specification also adds a dense-scene test that requires at least 31 visible cards to remain in the result set.

## AppDeploy deployment evidence

The applied v91 snapshot reached `ready` and AppDeploy reported:

- E2E status: `passed`
- Frontend errors: none reported
- Backend errors: none reported
- Network errors: none reported
- Desktop and mobile QA screenshots generated

AppDeploy returned `total_jobs: 8` and `passed_jobs: 7` in the terminal response while also returning overall E2E status `passed`. This capsule preserves both values rather than rewriting them into an unsupported `8/8` claim.

## What this does not prove

This snapshot does not prove:

- perfect card detection above 30 cards;
- measured count recall on a locked dense-scene image set;
- exact-card or exact-parallel accuracy;
- completed-sale valuation correctness;
- durable browser-close recovery;
- production PostgreSQL, private storage, queues, backups, or rollback;
- live provider contract behavior;
- that v91 was built from canonical GitHub `main`;
- that scheduled learning handlers changed model weights or improved recognition.

## Canonical integration rule

Do not merge AppDeploy application source wholesale into the canonical runtime. Port the user-facing scanner improvements into the current GitHub architecture, connect them to the repository-native durable scan jobs and valuation services, and require the normal Node, Python, PostgreSQL, security, build, and browser gates.

## Contents

- `manifest.json` — immutable release metadata and claims boundary.
- `CardScannerV2.v90-to-v91.patch` — exact verified scanner delta.
- `tests/tests.txt` — v91 AppDeploy QA specification.
