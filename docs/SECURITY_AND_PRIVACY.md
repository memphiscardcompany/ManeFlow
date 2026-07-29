# Security and Privacy

ManeFlow v1.6 maintains the existing security posture and extends it to shops, embeds, and desktop.

## Core controls

- no secrets in shipped package
- no `.env` included
- no runtime database included
- secure session tokens
- rate limits
- security headers
- signed provider webhook support
- demo/production boundaries

## Shop privacy

Personal Vault data and shop inventory are isolated. Users only see shop data through organization membership. Shop actions are audit logged.

## Widget privacy

Public widgets expose only public-safe card and valuation fields. Private Vault data, shop inventory, users, provider credentials, and tokens are never exposed by widget routes. Allowed-origin checks protect mutation endpoints.

## Desktop shell

The desktop shell uses context isolation, disabled Node renderer integration, sandboxing, and external-link handling. It contains no production secrets.
## v1.7 Hardening

- Production configuration validation fails closed for unsafe settings.
- `/healthz`, `/readyz`, and admin system-health routes expose operational status without credentials.
- Billing webhooks require Stripe signature verification when Stripe mode is enabled.
- Provider credential status is reported without exposing secrets.
- Account deletion removes related usage, billing, scan session, invite, and membership records.
- Public widgets and public valuation APIs expose only public-safe card/value/comp summaries.

## v1.9 Hardening

- Owner Data Ops Workbench routes remain admin-only.
- Acquisition checks fail closed for unknown or unapproved sources.
- Manual evidence is review-only until approved and promoted.
- Public valuation pages and widgets expose only public-safe fields.
- Merchant decision routes are server-gated by plan entitlements.
- Mobile release config is checked for HTTPS production/staging URLs and secret-shaped values.
