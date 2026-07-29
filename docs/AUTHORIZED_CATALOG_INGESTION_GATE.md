# External Gate 3 — Authorized Million-Card Catalog

ManeFlow 2.15 adds a resumable, transaction-safe NDJSON catalog ingestion pipeline designed for
large official API exports and licensed bulk files.

## Input format

One JSON object per line:

```json
{"card":{"canonicalKey":"pokemon:sv4:123:base:en","sportOrGame":"Pokemon","releaseYear":2023,"manufacturer":"Pokemon","setName":"Paradox Rift","setCode":"SV4","cardNumber":"123","subjectName":"Example","parallelName":"BASE","languageCode":"en","sourceRecordId":"provider-id"},"referenceImages":[{"side":"front","uri":"https://authorized.example/card.jpg","authorizationBasis":"licensed_api","commercialUseAllowed":true,"trainingUseAllowed":false,"canonicalDisplayAllowed":true}]}
```

Only authorized image references should be marked for commercial display or embedding generation.
Source rights are stored per image and are not inferred from metadata availability.

## Import

```bash
node scripts/import-authorized-catalog-ndjson.mjs \
  --file /data/catalog.ndjson \
  --source justtcg-partner \
  --authorization licensed_partner_api \
  --model-name siglip2-so400m-card-front-v1 \
  --model-version 1 \
  --batch-size 2000 \
  --resume
```

The importer:

- hashes the source file;
- records a durable sync job;
- resumes from an atomic checkpoint;
- upserts as many as 5,000 cards per transaction;
- records image-level usage rights;
- queues only commercially authorized front/back references for embedding;
- rolls back the complete batch on any database error;
- never stores API credentials in the import file or checkpoint.

A million-card catalog is an operational data acquisition project, not an application binary.
The database schema and importer are ready; actual ingestion requires authorized provider exports,
partner terms, quotas, and enough storage for the resulting images and embeddings.
