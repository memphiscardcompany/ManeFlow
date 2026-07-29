# ManeBrain Meta hardening record — 2026-07-29

## Objective

Close the remaining code-side safety gaps around Meta attachments, outbound-channel activation, outbound queue inspection, and signed provider-echo reconciliation without enabling production sending.

## Confirmed implementation

- Meta intake remains protected by the global kill switch and disabled by default.
- Meta outbound remains disabled by default and requires owner approval, exact-text hashing, a separate queue action, durable PostgreSQL leases, bounded retries, and terminal ambiguous-delivery handling.
- Only channels listed in `MANEBRAIN_META_OUTBOUND_CHANNELS` may reach the provider client. The sanitized default is `messenger,instagram_dm`; comment replies remain disabled unless explicitly added after provider-contract review.
- Provider attachment retrieval is bounded by exact HTTPS host allowlists, redirect revalidation, response-size limits, content-type controls, and timeouts.
- Owner-only outbound queue inspection supports status counts and bounded keyset pagination without returning approved message bodies or credentials.
- Signed Meta message echoes are normalized as outbound evidence and reconcile provider acceptance through `provider_echo_at` without treating provider acceptance or echo observation as guaranteed final delivery.
- Migration `008_manebrain_delivery_reconciliation.sql` adds the reconciliation timestamp and index.

## Security boundaries

- No live Meta credentials, verification tokens, customer data, or message contents are committed.
- Graph API base URLs must be credential-free HTTPS origins.
- Provider tokens are required before production outbound can start and are read only from deployment secrets.
- Comment channels emit a production warning and must remain absent from the outbound allowlist until their exact permissions and contracts are verified.
- Ambiguous provider results are never retried automatically.
- Ordinary ManeFlow users remain outside owner-only Meta routes and PostgreSQL row-level-security context.

## Not verified

- Public HTTPS webhook deployment and callback challenge.
- Exact Page and Instagram professional-account subscriptions.
- Current production token health and expiry.
- Business Verification or App Review approval.
- Joshua's production owner MFA and recent-reauthentication flow.
- Private object-storage persistence and deletion for attachments.
- Real signed Messenger and Instagram events.
- One real owner-approved provider send and signed echo round trip.

## Safe current mode

```text
MANEBRAIN_META_KILL_SWITCH=true
MANEBRAIN_META_INTAKE_ENABLED=false
MANEBRAIN_META_OUTBOUND_ENABLED=false
```
