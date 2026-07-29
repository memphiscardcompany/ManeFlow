## Objective

Harden ManeBrain's Meta integration without enabling production sending or weakening the owner-only approval boundary.

## Changes

- Bounded attachment retrieval with exact HTTPS host allowlists, redirect revalidation, timeout, content-type, and byte limits.
- Explicit `MANEBRAIN_META_OUTBOUND_CHANNELS` allowlist. Messenger and Instagram direct messages are the safe default; comment replies remain disabled unless separately reviewed and activated.
- Production configuration gates for exact owner UUID, assets, provider tokens, explicit Graph API version, and credential-free HTTPS origins.
- Owner-only outbound queue inspection with status counts and bounded keyset pagination.
- Signed provider-echo normalization and reconciliation through migration `008` and `provider_echo_at`.
- PostgreSQL schema verification for the reconciliation column and index.
- Focused tests and a complete owner-dashboard/test handoff package.

## Safety

- Kill switch defaults to enabled.
- Meta intake and outbound default to disabled.
- No live secrets, customer data, or message contents are committed.
- Ambiguous provider outcomes remain terminal and are never automatically retried.
- Production deployment remains disabled.

## External blockers

- Authenticated Meta dashboard setup and subscriptions.
- First-party staging deployment with PostgreSQL, secret manager, and private object storage.
- Owner MFA and recent reauthentication.
- Real signed Messenger/Instagram events and one controlled owner-approved outbound round trip.
- Business Verification and App Review where required.

## Validation

GitHub Actions on the exact pull-request head are authoritative. Do not claim this change verified until both repository verification and PostgreSQL integration workflows pass.
