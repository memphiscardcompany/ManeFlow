# ManeFlow Release Provenance V2

## Objective

Make every environment prove exactly what source, artifacts, models, catalog, benchmark manifest, database schema, and deployment record it is running.

The public endpoint is:

```text
GET /api/release
HEAD /api/release
```

It is intentionally unauthenticated, read-only, non-cacheable, and contains no credentials or customer data.

## Contract

The endpoint returns `maneflow-release-provenance-v2` with:

- product and application version;
- canonical repository;
- environment and release channel;
- exact 40-character Git commit SHA;
- Git ref and dirty-build state;
- deployment provider and timestamp;
- AppDeploy identifiers when applicable;
- application and vision image identifiers and SHA-256 digests;
- release-manifest and SBOM digests;
- detector, OCR, and encoder model identities, versions, and digests;
- identity-policy and calibration versions;
- catalog, benchmark-manifest, and knowledge-runtime versions;
- database schema version;
- missing provenance fields;
- whether the release is complete enough to support a production claim.

## Fail-closed behavior

Malformed or absent values become `null`. The endpoint never converts placeholders such as `unverified`, invalid dates, short commit IDs, or malformed digests into verified release evidence.

A production claim is permitted only when:

1. the environment is `production`;
2. the build is not marked dirty;
3. an exact Git SHA exists;
4. a valid deployment timestamp exists;
5. application and vision image digests exist;
6. detector model version and digest exist;
7. catalog version exists;
8. a valid benchmark-manifest digest exists.

The endpoint exposes all missing required fields in `verification.missing`.

## Required production variables

```text
MANEFLOW_GIT_SHA
MANEFLOW_GIT_REF
MANEFLOW_DEPLOYED_AT
MANEFLOW_RELEASE_ENVIRONMENT
MANEFLOW_DEPLOYMENT_PROVIDER
MANEFLOW_APP_IMAGE_ID
MANEFLOW_APP_IMAGE_DIGEST
MANEFLOW_VISION_IMAGE_ID
MANEFLOW_VISION_IMAGE_DIGEST
MANEFLOW_DETECTOR_MODEL_ID
MANEFLOW_DETECTOR_MODEL_VERSION
MANEFLOW_DETECTOR_MODEL_SHA256
MANEFLOW_CATALOG_VERSION
MANEFLOW_BENCHMARK_MANIFEST_SHA256
MANEFLOW_SCHEMA_VERSION
```

Recommended additional variables:

```text
MANEFLOW_RELEASE_MANIFEST_SHA256
MANEFLOW_SBOM_SHA256
MANEFLOW_OCR_MODEL_ID
MANEFLOW_OCR_MODEL_VERSION
MANEFLOW_OCR_MODEL_SHA256
MANEFLOW_ENCODER_MODEL_ID
MANEFLOW_ENCODER_MODEL_VERSION
MANEFLOW_ENCODER_MODEL_SHA256
MANEFLOW_IDENTITY_POLICY_VERSION
MANEFLOW_CALIBRATION_VERSION
MANEFLOW_KNOWLEDGE_RUNTIME_VERSION
MANEFLOW_APPDEPLOY_APP_ID
MANEFLOW_APPDEPLOY_SNAPSHOT
```

## Verification commands

```bash
curl -fsS https://app.memphiscardcompany.com/api/release | jq .
curl -fsSI https://app.memphiscardcompany.com/api/release
```

Required headers include:

```text
Cache-Control: no-store, max-age=0
X-ManeFlow-Git-Sha: <exact SHA or unverified>
X-ManeFlow-Provenance-Complete: true|false
```

## Deployment rule

A deployment command, AppDeploy version, container tag, Shopify page, screenshot, or passing generic smoke test is not enough to establish canonical deployment.

The production endpoint must match the approved release manifest before traffic is promoted. A mismatch in Git SHA, application digest, vision digest, detector model, catalog, benchmark manifest, or schema version blocks release or triggers rollback.

## Privacy and security

The contract must never expose:

- API keys or tokens;
- database URLs;
- storage credentials;
- hostnames or internal IP addresses;
- customer identifiers;
- image hashes tied to customer records;
- certification numbers;
- raw OCR;
- provider response bodies.

## Legacy behavior

The canonical server now handles `/api/release` through the provenance router before the historical core route. The legacy route remains temporarily in place for backward source compatibility but is unreachable in the standard server composition. It may be removed in a later narrow cleanup after all deployment consumers use V2.
