# Production Deployment

ManeFlow v1.7 adds runtime validation and health checks for production deployment.

## Health Routes

```text
GET /healthz
GET /readyz
GET /api/admin/system/health
```

`/healthz` confirms the process is alive. `/readyz` checks runtime configuration, storage mode, and market-data readiness. The admin system-health endpoint adds provider and count summaries without exposing secrets.

## Production Requirements

- HTTPS `PUBLIC_BASE_URL`
- strong `MANEFLOW_ADMIN_TOKEN`
- strong `PROVIDER_WEBHOOK_SECRET`
- explicit `ALLOWED_ORIGINS`
- `MANEFLOW_EXPOSE_DEV_TOKENS=false`
- production email provider
- production billing provider if paid plans are enabled
- authorized completed-sale feeds before public market-value claims

## Fail Closed

Unsafe production configuration returns validation errors and should block launch. PostgreSQL and Stripe modes require their own environment variables before they can be enabled.
