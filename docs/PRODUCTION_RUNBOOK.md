# Production Runbook

## Before Launch

1. Configure production environment variables.
2. Run `npm run doctor:strict`.
3. Run `npm run verify`.
4. Import authorized completed-sale data using dry-run first.
5. Review Data Health and Provider Trust panels.
6. Confirm demo labels are not used for public market claims.
7. Configure backups and restoration procedure.
8. Complete legal, billing, app-store, and data-license review.

## During Operations

- Use provider dry-runs before live imports.
- Quarantine low-confidence provider records.
- Use rollback by provider run or batch if bad data enters the system.
- Review comp-quality queues daily when live data is active.
- Monitor `/readyz` and `/api/admin/system/health`.

## Incident Response

If bad pricing data appears:

1. Pause the provider/import job.
2. Record the provider run or batch ID.
3. Use admin pricing rollback.
4. Clear caches by restarting the app if needed.
5. Re-run Data Health.
6. Document the incident in owner notes.
