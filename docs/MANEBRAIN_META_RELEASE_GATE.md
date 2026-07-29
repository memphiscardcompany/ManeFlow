# ManeBrain Meta release gate

Last verified from the owner-controlled Meta developer dashboard: 2026-07-29.

This record contains no secrets, access tokens, client tokens, verification tokens, or customer data.

## Verified external state

- A ManeFlow Meta developer application exists under the Memphis Card Company business portfolio.
- The application is in Development/Unpublished mode.
- Messenger and Instagram use cases are present.
- The Instagram setup is incomplete.
- No production webhook callback URL or verification token is configured.
- No valid OAuth redirect URI is configured.
- No application domain is configured.
- App Review and publishing requirements are incomplete.
- The dashboard is currently configured for Graph API v25.0.
- Exact Facebook Page and Instagram professional-account linkage, subscriptions, token health, and a signed end-to-end delivery are not verified.

## Code controls present

- Raw-body SHA-256 signature verification for exact string, `Buffer`, and `Uint8Array` bytes.
- Verification-token challenge validation.
- Timestamp-window validation and stable replay-key construction.
- Immutable platform-owner allowlist with MFA and recent-reauthentication checks.
- Exact Meta app, business, Page, and Instagram account allowlists.
- Emergency kill switch enabled by default.
- Meta outbound disabled by default.
- Owner-approved text is bound to its SHA-256 digest.
- Attachment URLs require HTTPS and an exact configured host allowlist on the initial URL and every redirect.
- Changed drafts, non-owner actors, disabled outbound, exhausted retries, and replayed queue transitions fail closed.
- PostgreSQL owner-only tables use forced row-level security and idempotency constraints.
- Signed inbound events are normalized without synthetic provider IDs or timestamps.
- Durable inbound persistence is set-based, replay-safe, owner-scoped, and audit-chained.
- Conversation listing uses bounded keyset pagination instead of unbounded offset scans.
- High-throughput inbound, conversation, message, draft, and outbound queue access paths have explicit indexes.

## Implemented but not live

- The canonical API contains a signed webhook challenge and intake route.
- Accepted events can be persisted to durable owner-isolated conversation state.
- Owner-only conversation status, list, and detail routes are present and fail closed through immutable owner authority, MFA, and recent reauthentication.
- The Evidence-Bounded Selective Matcher can attach conservative recognition evidence to later processing without treating vector similarity as observed identity evidence.
- Durable outbound jobs support leases, fencing, bounded retries, terminal ambiguous-delivery state, and exact provider-message recording.

These controls are staging foundations. There is no verified public webhook deployment, production Meta token, background conversation worker, production attachment retriever, live owner-console session with enrolled MFA, or real outbound provider round trip. The Meta subsystem must not be described as live.

## Release-blocking evidence still required

1. Deploy one public HTTPS webhook endpoint from the canonical commit.
2. Configure the verification token in the production secret manager and in Meta without recording its value here.
3. Verify the webhook challenge and an exact raw-body signature from Meta.
4. Verify the exact Memphis Card Company Page and Instagram professional account and place their IDs in the server-side allowlist.
5. Add only the minimum permissions shown by the current Meta dashboard for the selected login model.
6. Configure exact OAuth callback, application domain, Privacy Policy, Terms, and data-deletion handling.
7. Complete account linkage, Page/account subscriptions, Business Verification, and App Review as required by Meta for the claimed features.
8. Receive a real authorized test event, deduplicate it, create a draft, and display it only in the owner console.
9. Prove edit/approve/reject and one owner-approved send exactly once with delivery state and immutable audit evidence.
10. Prove ordinary ManeFlow users cannot discover or invoke any Meta route, API, queue, search, cache, export, notification, or storage object.
11. Prove the kill switch and token/session revocation halt processing and outbound actions.
12. Confirm `/release` metadata matches the deployed canonical commit.
13. Add the durable background worker, bounded provider attachment retrieval, dead-letter inspection, and delivery-echo reconciliation.
14. Enroll and verify Joshua's owner MFA and recent-reauthentication path without weakening the current fail-closed gate.

## Safe current mode

`MANEBRAIN_META_KILL_SWITCH=true`

`MANEBRAIN_META_INTAKE_ENABLED=false`

`MANEBRAIN_META_OUTBOUND_ENABLED=false`

Do not publish the Meta app or enable outbound sending until every release-blocking item above has direct evidence.
