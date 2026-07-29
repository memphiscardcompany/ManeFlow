# ManeFlow Meta hardening validation plan

## Required CI gates

Run from the exact pull-request head:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm run security:scan
npm run vision:test
```

Run PostgreSQL integration with all migrations, including `008_manebrain_delivery_reconciliation.sql`:

```bash
npm run db:migrate
npm run db:verify
npm run db:test:rls
```

## Focused Node tests

```bash
node --test \
  tests/meta-attachment-fetcher.test.js \
  tests/meta-delivery-repository.test.js \
  tests/meta-graph-client.test.js \
  tests/meta-intake.test.js \
  tests/meta-outbound-query-repository.test.js \
  tests/production-readiness.test.js
```

## Acceptance criteria

- Every command exits zero.
- No secret-scanner findings are introduced.
- Attachment retrieval rejects non-allowlisted hosts before network access.
- Every redirect is independently validated.
- Oversized and unsupported attachment responses are rejected.
- Comment replies cannot dispatch unless explicitly listed in `MANEBRAIN_META_OUTBOUND_CHANNELS`.
- Provider tokens, explicit Graph API version, exact owner UUID, and exact assets are required before production outbound can start.
- Local provider preflight failures are definite pre-acceptance rejections.
- Network ambiguity remains terminal `DELIVERY_UNKNOWN`.
- Outbound queue inspection is owner-scoped and keyset paginated.
- Signed provider echoes update only owner-scoped `SENT` jobs with the matching provider message ID.
- Production deployment remains disabled.

## External staging test

Do not run until the source gates are green and an owner-controlled first-party staging environment exists.

1. Keep outbound disabled and verify the Meta callback challenge.
2. Enable signed intake only and receive one authorized Messenger event and one authorized Instagram event.
3. Confirm replay deduplication and ordinary-user denial.
4. Create a draft, approve exact text, and queue it in separate owner actions.
5. Enable only the single reviewed direct-message channel.
6. Dispatch one controlled test reply.
7. Record the provider message ID and signed echo timestamp.
8. Confirm the kill switch stops intake and outbound processing.
9. Return the environment to fail-closed mode.
