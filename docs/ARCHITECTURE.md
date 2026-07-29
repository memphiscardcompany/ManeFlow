# ManeFlow v1.2 architecture

## Clients

### PWA
- Responsive phone/desktop interface
- Camera frame capture and photo uploads
- Client-side image resizing
- HttpOnly session-cookie authentication
- Installable manifest and offline application shell
- Search, scan, market detail, Vault, selling, sources, and account screens

### Native Expo app
- iOS and Android source
- Native camera and image picker
- SecureStore session token
- Front/back scan workflow
- Market details, Vault, selling, and account screens
- EAS development, preview, and production profiles

## API

The Node 22 server uses built-in runtime modules for the web/API service. It provides:

- account and session endpoints
- catalog search and card detail
- scan orchestration
- completed-sale normalization and valuation
- per-user Vault, watchlist, scan, listing, import, and preference endpoints
- collection export
- provider status
- signed provider ingestion
- administrator status and audit records

## Identity and storage

Passwords are derived with scrypt and unique salts. Random session tokens are persisted only as SHA-256 hashes. Web clients use HttpOnly cookies; native clients use SecureStore bearer tokens. User-owned records are stored under isolated user IDs.

The included atomic local store is designed for one-instance launch testing. The public scaling target is managed PostgreSQL for durable relational data, Redis for shared sessions/rate limits/jobs, and object storage only where image retention is explicitly required.

## Card identity flow

1. User captures or uploads a front image and optionally a back image.
2. Browser/mobile compresses the image.
3. If configured, the server sends the submitted images to the image-understanding provider.
4. Structured visual facts are merged with filename, manual, and OCR text.
5. Catalog candidates are ranked by exact metadata and token coverage.
6. ManeFlow presents multiple candidates unless confidence and separation are high.
7. The user confirms exact number, parallel, grade, cert, and condition before acting.

## Market intelligence flow

1. Approved sales enter through normalized CSV or signed provider ingestion.
2. Records preserve provider, sale type, date, all-in components, card identity, verification, confidence, and source reference.
3. Duplicate records are removed.
4. Extreme prices are marked using IQR controls.
5. Recency, verification, source confidence, and auction context weight the estimate.
6. ManeFlow calculates windows, trends, range, freshness, liquidity, and confidence.
7. Active listings are displayed separately from completed sales.

## Security boundaries

- Provider and AI keys remain server-side.
- Mutating browser requests are origin-checked.
- API, authentication, and scan paths have independent request limits.
- Provider pushes require administrator authorization or body HMAC.
- Every provider ingest documents its authorization basis.
- Scan images are not persisted by the included server.
