# External Gate 4 — Live PostgreSQL Migration Validation

The repository includes a dedicated GitHub Actions workflow that starts the official pgvector
PostgreSQL container, applies every migration, verifies the schema and HNSW indexes, and executes
cross-tenant RLS tests through the restricted `maneflow_app` role.

Workflow: `.github/workflows/postgres-integration.yml`

Local equivalent:

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://postgres:<admin-password>@127.0.0.1:5432/maneflow \
MANEFLOW_DATABASE_APP_PASSWORD=<app-password> npm run db:migrate

DATABASE_URL=postgresql://postgres:<admin-password>@127.0.0.1:5432/maneflow \
npm run db:verify

DATABASE_ADMIN_URL=postgresql://postgres:<admin-password>@127.0.0.1:5432/maneflow \
DATABASE_APP_URL=postgresql://maneflow_app:<app-password>@127.0.0.1:5432/maneflow \
npm run db:test:rls
```

The RLS test proves:

- Shop A can read only Shop A inventory.
- Shop B can read only Shop B inventory.
- Shop A cannot insert inventory under Shop B.
- Vector candidate retrieval aggregates inventory quantities only for the transaction-local shop.

This environment does not expose a Docker daemon or PostgreSQL server, so the live container gate
must execute on GitHub Actions, the operator's workstation, or the production database staging
project. Static and unit checks do not replace that run.
