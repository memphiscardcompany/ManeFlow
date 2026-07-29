# Production Database

ManeFlow v2.4 keeps JsonStore fully operational for local, demo, private beta, and controlled single-server use.

## Current Supported Mode

```text
STORAGE_MODE=json
MANEFLOW_STATE_FILE=.runtime/state.json
```

Json mode is the shipped runtime store for this release.

## PostgreSQL Boundary

`STORAGE_MODE=postgres` is intentionally fail-closed in v2.4.

The earlier adapter boundary remains in the codebase, but this package does not ship a complete JsonStore-compatible PostgreSQL implementation. Starting with `STORAGE_MODE=postgres` now fails clearly instead of connecting to a database and then breaking later when store methods are called.

Before enabling PostgreSQL, a production adapter must fully implement the same domains and service contract used by JsonStore.

## Required Domains For A Future Adapter

- users
- sessions
- account tokens
- outbox messages
- Vaults and collection holdings
- custom catalog rows
- custom pricing data
- comp reviews and corrections
- providers and provider ingests
- organizations
- shop inventory
- shop members and invites
- scan sessions
- scan corrections
- card image enrichment overrides
- card image audit logs
- intake batches
- watchlists and alerts
- consignment requests
- listing drafts
- usage records
- billing entitlements
- public value pages
- source policies
- manual comps and evidence
- audit logs

## Boundary

This package does not ship a live database, production database credentials, migrations for a managed production schema, or runtime state.
