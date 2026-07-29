# Collection Survey API

- `GET /api/collection-surveys` — list the current user’s surveys.
- `POST /api/collection-surveys/estimate` — produce an unsaved conservative estimate.
- `POST /api/collection-surveys` — save a survey and create an audit event.
- `PATCH /api/collection-surveys/:id` — update a survey owned by the current user.

All mutations require an authenticated actor unless the existing development configuration explicitly allows guest writes. Cross-user access is rejected by query scope.
