# ManeBrain Meta hardening record — 2026-07-29

## Objective

Close the remaining code-side safety gaps around Meta attachments, outbound-channel activation, outbound queue inspection, and signed provider-echo reconciliation without enabling production sending.

## Confirmed current implementation

- Meta intake remains protected by the global kill switch and disabled by default.
- Meta outbound remains disabled by default and requires owner approval, exact-text hashing, a separate queue action, durable PostgreSQL leases, bounded retries, and terminal ambiguous-delivery handling.
- Only channels listed in `MANEBRAIN_META_OUTBOUND_CHANNELS` may reach the provider client. The sanitized default is `messenger,instagram_dm`; comment replies remain disabled unless explicitly added after provider-contract review.
- Provider attachment retrieval is bounded by exact HTTPS host allowlists, redirect revalidation, response-size limits, content-type controls, and timeouts.
- Owner-only outbound queue inspection supports status counts and bounded keyset pagination without exposing message bodies or credentials.
- Signed Meta message echoes are normalized as outbound evidence and can reconcile provider acceptance through `provider_echo_at` without converting provider acceptance into a guarantee of final delivery.
- Migration `008_manebrain_delivery_reconciliation.sql` adds the reconciliation timestamp and index.

## Security boundaries

- No live Meta credentials, verification tokens, customer data, or message contents are stored in this document or committed configuration.
- Graph API base URLs must be credential-free HTTPS origins.
- Provider tokens are required before production outbound can start and are read only from deployment secrets.
- Comment channels produce a production warning and must remain absent from the outbound allowlist until their exact permissions and provider contracts are verified.
- Ambiguous provider results are never retried automatically.
- Ordinary ManeFlow users remain outside the owner-only Meta routes and PostgreSQL row-level-security context.

## Tested implementation

The branch contains focused Node tests for:

- attachment host rejection before network access;
- redirect revalidation;
- byte and content-type limits;
- explicit channel activation;
- local provider preflight rejection;
- owner-scoped outbound queue inspection;
- signed echo normalization;
- owner-scoped provider-echo reconciliation;
- production configuration gates for owner UUID, assets, tokens, Graph API version, endpoints, and channels.

GitHub Actions on the exact pull-request head is the authoritative verification record. No passing result is claimed in this document until CI completes.

## Not verified

- Public HTTPS webhook deployment.
- Meta dashboard callback challenge.
- Exact Page and Instagram professional-account subscriptions.
- Current access-token health and expiry.
- Business Verification or App Review approval.
- Joshua's production owner MFA and recent-reauthentication flow.
- Private object-storage persistence and deletion for retrieved attachments.
- Real signed Messenger and Instagram events.
- One real owner-approved provider send and signed echo round trip.
- Final delivery beyond provider acceptance/echo observation.

## Blocked external work

Authenticated Meta dashboard work and production infrastructure are required before activation. Keep:

```text
MANEBRAIN_META_KILL_SWITCH=true
MANEBRAIN_META_INTAKE_ENABLED=false
MANEBRAIN_META_OUTBOUND_ENABLED=false
```

until every external release gate has direct evidence.
