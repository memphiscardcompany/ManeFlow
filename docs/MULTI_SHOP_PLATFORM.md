# Multi-Shop Platform

ManeFlow v1.6 adds organizations for Memphis Card Company and future shops.

## Roles

- owner: full shop control
- manager: staff/invite/inventory management
- staff: inventory and intake operations
- viewer: read-only shop access

## Privacy model

Personal Vault data and shop inventory are separated. One shop cannot see another shop's inventory, staff, provider settings, exports, or audit log. Platform admins can review platform-wide health; shop owners control their own shop workspace.

## Core routes

- `GET /api/organizations`
- `POST /api/organizations`
- `GET /api/organizations/:id`
- `POST /api/organizations/:id/invites`
- `POST /api/organizations/invites/:code/accept`
- `GET /api/organizations/:id/dashboard`
- `GET /api/organizations/:id/inventory`
- `POST /api/organizations/:id/inventory`
- `PATCH /api/organizations/:id/inventory/:itemId`

Shop actions write audit log entries.
## v1.7 Shop Lifecycle

ManeFlow v1.7 adds operational shop lifecycle controls:

- profile and brand updates
- invite revocation
- staff role changes
- staff removal
- shop deactivation/reactivation state
- permission-level checks
- audit events for shop-sensitive actions

Disabled shops cannot continue normal access through stale memberships.
