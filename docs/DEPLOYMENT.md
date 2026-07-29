# Deployment - ManeFlow v1.9

1. Deploy the Node server behind HTTPS.
2. Set `PUBLIC_BASE_URL=https://mane.memphiscardcompany.com`.
3. Set `ALLOWED_ORIGINS=https://mane.memphiscardcompany.com,https://memphiscardcompany.com,https://www.memphiscardcompany.com`.
4. Set `MANEFLOW_WIDGET_ALLOWED_ORIGINS=https://memphiscardcompany.com,https://www.memphiscardcompany.com`.
5. Configure `MANEFLOW_ADMIN_TOKEN`, `PROVIDER_WEBHOOK_SECRET`, email webhook, and authorized provider credentials.
6. Keep `MANEFLOW_DEMO_MODE=true` until approved completed-sale data is ingested and data-health blockers are cleared.
7. Confirm the Owner Data Ops Workbench shows source rights, acquisition checks, and manual comp review state.
8. Run `npm run doctor:strict`.
9. Run `npm run verify`.
10. Run `npm run verify:release`.
11. Build native apps and desktop installers from owner-controlled signing machines.

Production launch requires owner-controlled hosting, DNS, TLS, transactional email, billing accounts, marketplace/data agreements, app-store accounts, and legal review.
