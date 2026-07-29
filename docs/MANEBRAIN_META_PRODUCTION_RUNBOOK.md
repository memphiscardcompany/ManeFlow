# ManeBrain Meta Production Runbook

## Status classification

This runbook describes the production activation sequence. Source code, migrations, and tests are not evidence that the Meta account is connected.

A Meta integration is **live and verified** only after all of the following exist for the exact deployed ManeFlow release:

1. immutable platform-owner account provisioned;
2. owner MFA and recent-reauthentication flows verified;
3. PostgreSQL migrations applied and RLS tests passed;
4. exact app, business, Page, and Instagram professional-account IDs allowlisted;
5. HTTPS webhook callback verification succeeds;
6. a real signed Messenger event is accepted exactly once;
7. a real signed Instagram event is accepted exactly once;
8. owner-only inbox reads those durable events;
9. AI or manual reply is stored as a draft;
10. Joshua approves the exact reply text;
11. the separate queue action succeeds;
12. the provider accepts one controlled test reply and returns a message identifier;
13. delivery state and audit records reconcile;
14. kill-switch rollback is tested.

Until those gates pass, keep Meta in `DRAFT_ONLY` or `KILL_SWITCHED` mode.

## Public callback

```text
${PUBLIC_BASE_URL}/api/webhooks/meta
```

The callback must be an exact HTTPS URL. The same route handles:

- `GET` verification challenge using `META_WEBHOOK_VERIFY_TOKEN`;
- `POST` webhook delivery using the exact raw request bytes and `X-Hub-Signature-256`.

Never place the app secret or access tokens in URLs, source, logs, screenshots, support tickets, or documentation.

## Required secret names

Store values only in the deployment secret manager:

```text
META_APP_SECRET
META_WEBHOOK_VERIFY_TOKEN
META_PAGE_ACCESS_TOKEN
META_INSTAGRAM_ACCESS_TOKEN
OPENAI_API_KEY
DATABASE_URL
```

## Required non-secret settings

```text
PUBLIC_BASE_URL=https://app.memphiscardcompany.com
MANEFLOW_PLATFORM_OWNER_USER_IDS=<immutable-owner-user-uuid>
META_APP_ID=<approved-app-id>
META_BUSINESS_ID=<approved-business-portfolio-id>
META_PAGE_ID=<approved-facebook-page-id>
META_INSTAGRAM_ACCOUNT_ID=<approved-instagram-professional-account-id>
META_GRAPH_API_VERSION=<explicit-tested-version>
META_ATTACHMENT_ALLOWED_HOSTS=<exact-approved-hosts>
MANEBRAIN_DRAFT_MODEL=<approved-server-side-model>
```

Do not configure `META_GRAPH_API_VERSION=latest`. Pin and test an explicit Meta Graph API version.

## Fail-closed activation sequence

### Stage 1 — Database and owner authority

Keep:

```text
MANEBRAIN_META_INTAKE_ENABLED=false
MANEBRAIN_META_KILL_SWITCH=true
MANEBRAIN_META_OUTBOUND_ENABLED=false
```

Apply all migrations through the recorded release migration version. Provision `platform_owner_authority` for Joshua's immutable application user ID. Verify RLS denies every other user and service context.

### Stage 2 — Webhook challenge only

Configure the callback and verify token in the Meta developer dashboard. Keep intake and outbound disabled. Complete the GET challenge. This verifies routing only; it does not prove signatures, permissions, subscriptions, tokens, or message delivery.

### Stage 3 — Signed observation mode

Set:

```text
MANEBRAIN_META_KILL_SWITCH=false
MANEBRAIN_META_INTAKE_ENABLED=true
MANEBRAIN_META_OUTBOUND_ENABLED=false
```

Subscribe only the approved Page and Instagram professional account to the required messaging/comment fields. Send one controlled Messenger event and one controlled Instagram event. Verify:

- signature accepted;
- exact account allowlist accepted;
- replay accepted zero additional times;
- payload-hash mismatch rejected;
- conversation and message persisted under owner RLS;
- ordinary users receive no owner data;
- no outbound provider call occurs.

### Stage 4 — Draft and approval

Use the owner-only API:

```text
POST /api/owner/meta/conversations/{conversationId}/drafts
POST /api/owner/meta/drafts/{draftId}/approve
POST /api/owner/meta/outbound/{jobId}/queue
GET  /api/owner/meta/outbound/{jobId}
```

Draft creation may be manual or AI-assisted. AI requests use `store: false`; the response remains a draft. Approval requires MFA, recent reauthentication, CSRF validation, and an exact approved-text hash. Queueing is deliberately separate from approval.

### Stage 5 — Controlled provider dispatch

Only after Stages 1–4 pass, set:

```text
MANEBRAIN_META_OUTBOUND_ENABLED=true
```

Run one bounded cycle:

```bash
npm run meta:dispatch:once
```

Do not start the continuous worker until one Messenger DM, one Instagram DM, and the approved comment-reply channels have passed their controlled contract tests under the exact permissions granted to the app.

The dispatcher behavior is:

- provider acceptance with message ID → `SENT`;
- definite transient rejection → `RETRY_WAIT` with bounded attempts;
- definite permanent rejection → `DEAD_LETTER`;
- timeout, connection reset, missing acceptance ID, or expired lease → terminal `DELIVERY_UNKNOWN` and human reconciliation.

Ambiguous delivery is never retried automatically.

### Stage 6 — Continuous worker

After controlled dispatch passes:

```bash
npm run meta:dispatch:worker
```

Run it as an independently supervised worker with:

- one exact release image;
- bounded restart policy;
- no public listener;
- structured logs without message bodies or tokens;
- queue depth, retry, dead-letter, and delivery-unknown alerts;
- deployment rollback tied to the same commit SHA as the web/API release.

## Meta dashboard actions requiring authenticated account access

These actions cannot be completed from source code or CI:

1. confirm the ManeFlow app belongs to the correct Memphis Card Company business portfolio;
2. confirm the Facebook Page and Instagram professional account are linked to that portfolio;
3. add the exact webhook callback and verify token;
4. subscribe the app to the approved Page/account and fields;
5. request and receive the required Messenger and Instagram permissions/access levels;
6. complete business verification and App Review where required;
7. create/rotate the correct Page and Instagram tokens;
8. move the app from development to live only after the controlled release gate;
9. send real test events from accounts permitted by the current app mode;
10. inspect Meta delivery/error dashboards during the signed round trip.

Record only IDs, permission names, timestamps, and redacted evidence. Never copy token values into GitHub or chat.

## Emergency rollback

The fastest stop is:

```text
MANEBRAIN_META_KILL_SWITCH=true
MANEBRAIN_META_OUTBOUND_ENABLED=false
MANEBRAIN_META_INTAKE_ENABLED=false
```

Then stop the outbound worker. Do not delete evidence while diagnosing.

If a provider response was ambiguous, leave the job `DELIVERY_UNKNOWN`; check the Meta conversation directly before any manual retry.

If credentials may be compromised:

1. rotate/revoke tokens in Meta;
2. replace deployment secrets;
3. invalidate active worker tasks;
4. preserve audit logs;
5. verify no token appeared in source or logs;
6. rerun signed-webhook and controlled-send gates.

## Required release evidence

Record:

- repository and branch;
- full commit SHA;
- deployment release ID;
- migration version;
- callback hostname;
- explicit Graph API version;
- permission names and access level;
- asset IDs, redacted as appropriate;
- token issue and expiry timestamps, never values;
- signed-event timestamps and provider event IDs;
- duplicate/replay test result;
- owner authorization/MFA result;
- approved-text hash;
- provider message ID;
- final delivery state;
- kill-switch rollback result.
