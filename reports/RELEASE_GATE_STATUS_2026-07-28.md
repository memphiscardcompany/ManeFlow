# Release gate status

Date: 2026-07-28
Candidate: ManeFlow `2.22.0-beta.1` reconciled local tree
Decision: **do not deploy**

## Passing local gates

- Node application tests: 217 passed, 0 failed, 0 skipped
- Python vision tests: 58 passed, 0 failed, 0 skipped
- JavaScript/JSON/release checks: passed
- Credential-pattern scan: passed
- npm production dependency audit: 19 packages audited, 0 vulnerabilities
- Root dependency lockfile created and committed
- Local smoke test: passed
- Expo mobile configuration check: passed
- Electron desktop configuration check: passed
- Read-only image inventory: 856 files, 1,160,565,792 bytes

## Public ManeFlow release gates

| Gate | Status | Reason |
|---|---|---|
| Private canonical repo/commit | Blocked | Local candidate exists; private connector/push unavailable |
| Production authentication | Not verified | Local tests pass; email, DB, domain, and production sessions not configured |
| Cross-user isolation | Partially verified | Local tests pass; production PostgreSQL RLS not exercised |
| Durable DB/storage/queue/workers | Blocked | No approved production infrastructure configuration |
| Mobile camera/photo upload | Not verified | No physical-device production smoke test |
| Scan → draft → value/abstain → Vault | Partially verified | Local test coverage; universal model/provider access unavailable |
| Privacy/consent/retention/Terms | Failed | Published deletion page says no account is required; privacy page says unreleased |
| Secret scan | Passed locally | Production secret manager not configured |
| Browser/device evidence | Blocked | Physical iPhone, Android, Safari/macOS unavailable to this run |
| `/release` commit match | Blocked | No deployment |

## ManeBrain/Meta release gates

| Gate | Status | Reason |
|---|---|---|
| Exact MCC Meta assets allowlisted | Blocked | IDs not securely configured |
| Required permissions approved | Blocked | App Review/business verification not verified |
| Real signed inbound event | Blocked | No production callback deployment |
| Owner console | Blocked | Production-safe console is not implemented |
| Owner MFA | Blocked | Authorization gate exists; enrollment not configured |
| Normal-user Meta isolation | Tested in core policy only | No complete deployed console/API to attack |
| Exact-once approved outbound | Blocked | Worker/provider delivery not implemented and outbound remains off |
| Kill switch | Tested locally | Production operations not deployed |

## Deployment decision

Publishing the current candidate would violate the explicit release gates.
Therefore:

- no production application was deployed;
- no DNS was changed;
- no live Shopify theme was changed;
- no old beta was removed or redirected;
- no Meta event subscription or outbound permission was enabled;
- no customer message, comment, offer, or price was sent.

The next safe external action is granting the GitHub connector access to the
private `memphiscardcompany/ManeFlow` repository so this clean candidate can be
reviewed and pushed to a non-production branch. Production remains separately
gated by database, storage, queue, email, MFA, provider, browser/device, and
Meta approvals.
