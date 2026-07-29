# Engineering handoff after v1.2

The release already includes accounts, isolated Vaults, front/back scans, secure native sessions, valuation, watchlists, imports, listing drafts, provider ingestion, EAS profiles, integration tests, and security controls.

Next engineering priorities:

1. Replace the single-instance state store with PostgreSQL migrations and repository adapters.
2. Add Redis-backed shared sessions, rate limits, valuation cache, and background jobs.
3. Add verified email, password reset, account deletion, and administrative user controls.
4. Implement approved provider workers with cursoring, idempotency, retry queues, and contract tests.
5. Connect a licensed catalog and visual embedding index.
6. Add exact candidate confirmation and correction feedback to the native app.
7. Add push notifications and scheduled watch evaluation.
8. Add merchant organizations, staff permissions, inventory states, and marketplace connections.
9. Add billing, plan entitlements, merchant API keys, and usage metering.
10. Add observability, database backups, SLOs, load testing, security scanning, and staged deployment CI.
