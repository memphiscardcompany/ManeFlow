# Security implementation record

Date: 2026-07-28
Scope: local canonical ManeFlow candidate

## Implemented

- Authentication is required by default.
- Public signup always creates a collector, never an administrator or owner.
- Email verification is required by default.
- Registration does not create a session before verification.
- Session cookies are `HttpOnly`, `SameSite=Lax`, production `Secure`, and
  `Priority=High`.
- Cookie-authenticated mutations require a session-derived CSRF token.
- Sign-out-all-devices support is available.
- Legacy administrator bearer tokens are disabled by default and forbidden in
  production.
- Production validation rejects guest writes, disabled authentication,
  disabled email verification, disabled CSRF, local JSON storage, insecure
  cookies, missing email delivery, and development token exposure.
- `/api/release` exposes non-secret release provenance.
- Platform owner authorization requires:
  - an authenticated user session;
  - an immutable internal user ID on a server-side allowlist;
  - an MFA verification timestamp;
  - recent reauthentication for sensitive operations.
- Email, ordinary roles, service credentials, subscription data, and
  client-shaped identity objects cannot create `platform_owner`.
- Meta operations default to kill-switched and outbound-disabled.
- Production Meta outbound cannot be enabled without exact app, business, Page,
  and Instagram account allowlists plus the platform-owner allowlist.
- The Meta database migration applies `ENABLE` and `FORCE ROW LEVEL SECURITY`
  to owner authority, assets, events, conversations, messages, drafts,
  outbound jobs, and audits.
- The Meta audit table is not updateable by the runtime role.
- Provider tokens are intentionally absent from the database migration.

## Verified by automated tests

- Public signup cannot self-assign owner authority.
- Login fails until email verification.
- Signed-out private routes fail closed.
- Cookie mutations fail without CSRF.
- Session revoke-all invalidates the session.
- User A cannot access User B's collection.
- Legacy administrator tokens are rejected when disabled.
- Meta signatures, verification challenge, replay identifiers, timestamps, and
  asset allowlists fail closed.
- Kill switch takes precedence over all Meta modes.
- Owner access requires the immutable user ID, MFA, and recent reauthentication.

## Not yet production-verified

- MFA enrollment/recovery provider and real owner enrollment
- Production PostgreSQL migration and adversarial live RLS checks
- Private object storage and signed-object authorization
- Production email delivery
- Durable queue and worker restart behavior
- Secret-manager integration
- Real Meta tokens, permissions, subscriptions, and signed events
- A production-safe owner console
- Exact-once outbound delivery and provider delivery receipts
- Backup restoration and deployment rollback

The system remains fail-closed for these areas. No production credentials were
requested, printed, copied, or committed.
