# ManeFlow and ManeBrain source reconciliation

Date: 2026-07-28
Status: local canonical candidate; not deployed

## Reconciliation rule

Source code and tests outrank filenames, ZIP titles, screenshots, generated
prompts, chat claims, and deployment names. A component is not classified as
live unless a traceable commit, deployment, runtime check, and applicable
end-to-end evidence agree.

## Selected source base

The selected source base is the ManeFlow `2.22.0-beta.1` tree recovered from the
July 27 audit package inside:

`drive-download-20260729T012322Z-1-001.zip`

Outer archive SHA-256:

`108DD3E2FAB94350AEB8177EC66969540BC6E9D8817A03F9C0CA53A5158B12C0`

The archive was extracted with a path-traversal-safe local script. The original
archive and the original mixed OneDrive directory were not changed.

## Direct local sources inspected

- `C:\Users\Joshua\OneDrive\Desktop\Memphis Card Company`
- The nested July 27 ManeFlow audit package
- The actual ManeBrain JavaScript implementation under the mixed source tree
- The incomplete standalone `ManeBrain` repository under OneDrive Documents
- Local release ZIPs, checksums, reports, migrations, tests, and build scripts
- The local `Card Images` directory, inventoried read-only
- The supplied execution prompt, SHA-256
  `3A4E39FFBD9AB92FEF1496E4E790BDB8A94FE7693FCBBDCE8E34AA89A0E49AA6`

The local file named `INSTAGRAM-2FA-RecoveryCodes.txt` was excluded by name and
was not opened, copied, indexed, or committed.

## Newer chats and projects inspected

The following Codex/ChatGPT tasks were used as untrusted provenance and
requirements evidence:

- `6a5eb8c6-6358-83ea-93d7-bed51e2e371b` — Getting started
- `6a696c6f-3228-5f28-b33f-30fd1e081a7c` — Branch · Getting started
- `6a6715b6-62ee-518e-b437-4884f0d46274` — ManeBrain Overview
- `6a671d4f-77a2-5890-9bc9-4babf6b025c9` — Inbox System Deployment Status
- `6a672bfe-fc22-5c5d-a135-00d420061994` — ManeBrain Upgrade and Meta Integration
- `019fa317-5d0b-7e12-b905-2783bbacbf1b` — Codex ManeBrain upgrade task
- `019fa304-4907-7d30-a389-a77765ad0bd9` — Codex continuation
- `6a66e3c5-e44b-5c13-b274-4b5eb0d1b390` — ManeFlow Website Handoff
- `6a607fc4-c105-57f9-97da-d5250fa47f9f` — ManeFlow Upgrade Plan
- `6a671546-7f86-542f-9268-f5f45558b4f6` — ManeBrain Implementation Steps
- `6a66c4fa-84d1-54dd-aa4d-ab1e71558283` — ManeFlow Meta Inbox Integration
- `6a66e306-00aa-598b-8662-cba1343add9f` — ManeFlow Project Organization
- `6a674395-8368-564d-a5c7-08ae9025745a` — Tools for ManeBrain
- `6a6778a6-eb98-5cb9-9988-f8549b8624ed` — Branch · Tools for ManeBrain
- `6a674fea-a2c1-5dd0-b8b4-9600d85919c5` — ManeFlow Beta Availability
- `6a4eb07d-1e11-554f-81f4-8de150256b62` — Standalone Website Package
- `6a4db0c4-c0f8-5dfe-8d4d-a548c6f9e3b5` — Website Optimization Complete

These tasks establish design decisions and point to later deployment work, but
they do not prove source lineage or production readiness.

## Later AppDeploy implementation

AppDeploy application `142df297558ace9e22`, version `1785126743742`, contains
useful webhook persistence and draft-inbox work. Its source was inspected
read-only.

It was rejected as the canonical production base because:

- Meta operator routes were not protected by immutable owner authorization.
- Owner-like navigation was visible in the ordinary application.
- Administrator status was inferred from an email string.
- Customer cards used browser local storage.
- Meta attachments were collapsed to a placeholder.
- Approval used the hard-coded actor `local-operator`.
- There was no verified exact-once outbound worker.
- Demo conversation seeding and public Meta routes were present.

The useful design ideas remain provenance. The unsafe authorization model was
not copied.

## Connected Drive findings

The connected Memphis Card Company Drive contains a ManeFlow folder with
`01 Source Packages`, `02 Product Docs`, and `03 Brand Assets`. The two source
and product-document folders returned no files in the connected account.

The retrieved ManeFlow Development Roadmap is an architecture/audit document,
not newer runnable source. It records that real universal recognition, trained
segmentation, catalog coverage, and production sold-comp coverage were not yet
proven at that point.

## GitHub findings

`memphiscardcompany/ManeFlow` was verified in Chrome as private. The remote
repository currently exposes only the earlier documentation-scale history on
`main`. The GitHub connector did not have private-repository access, and a
read-only Git network check did not complete. No push was attempted.

The previously reported local consolidation commit `86ee5c1` and the exact July
26 canonical bundle/ZIP were not found in the accessible filesystem. They are
therefore recorded as unavailable, not assumed to be lost or superseded.

## Component classification

| Component | Classification | Evidence |
|---|---|---|
| ManeFlow 2.22 source | Tested locally | 217 Node tests and 58 Python tests pass |
| Account verification/session flow | Tested locally | HTTP and security regression tests |
| Production PostgreSQL migration | Confirmed source; not live-verified | Versioned SQL and verifier; no production `DATABASE_URL` used |
| Owner-only authority | Tested locally, fail-closed | Immutable user-ID allowlist, MFA timestamp, recent reauth |
| Meta webhook security | Tested locally | HMAC, verification challenge, replay key, timestamp checks |
| Meta assets | Unverified | Exact IDs and permissions were not entered or approved |
| Owner Meta console | Approved planned | No production-safe UI/runtime exists in this source |
| Meta outbound delivery | Blocked | Kill switch on; outbound off; permissions/token/worker not verified |
| Universal recognition | Experimental/unverified | Production detector weights and rights-cleared catalog unavailable |
| Pricing | Partially tested | Filtering and abstention tested; live provider access unverified |
| Public web deployment | Existing older deployment only | No canonical commit-to-release lineage |
| Shopify replacement | Blocked by release gates | No staged change or publish performed |
| Local Card Images corpus | Inventoried, not authorized for training | 856 metadata records; training/evaluation false |

Shopify Admin read-only inventory identified the live theme as
`gid://shopify/OnlineStoreTheme/192162333042` and the account-gated draft as
`gid://shopify/OnlineStoreTheme/192162431346`. No Shopify mutation was made.
