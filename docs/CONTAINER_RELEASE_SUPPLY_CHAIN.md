# ManeFlow signed container release supply chain

## Objective

Produce private application and vision-worker container images that are tied to one exact, merged, fully verified Git commit.

This workflow publishes release candidates. It does not deploy staging or production and does not enable Meta, providers, customer messaging, billing, or model training.

## Publication trigger

The workflow is:

```text
.github/workflows/publish-containers.yml
```

Automatic publication occurs only after the `Verify ManeFlow` workflow completes successfully for a `push` event on `main`.

A manual rerun requires:

- a full 40-character commit SHA;
- proof that the commit is an ancestor of current `main`;
- an existing successful `Verify ManeFlow` push run for that exact commit.

Pull-request events cannot publish packages.

## Verification before publication

The ordinary `Verify ManeFlow` workflow now includes a `container-build` job. It builds both Dockerfiles from the exact checked-out commit and verifies:

- the application image builds;
- the vision-worker image builds;
- the application runtime user is `node`;
- the vision runtime user is `maneflow`;
- packaged Node entry points pass syntax checks;
- the packaged Python vision application imports successfully in CPU-safe mode;
- image labels and sizes are recorded in CI.

The release workflow does not substitute for this gate. It consumes only a commit that already passed the complete verification workflow.

## Registry and naming

Private images are published to GitHub Container Registry:

```text
ghcr.io/memphiscardcompany/maneflow
ghcr.io/memphiscardcompany/maneflow-vision
```

The workflow creates a source traceability tag:

```text
sha-<40-character Git commit>
```

Tags are not deployment identities. Every deployment manifest must use the immutable form:

```text
<image name>@sha256:<64 hexadecimal characters>
```

The staging Compose contract already rejects image references that are not digest pinned.

## Build metadata

Both images receive OCI labels for:

- source repository;
- exact Git revision;
- image title;
- source-derived version.

Docker BuildKit is instructed to generate:

- maximum build provenance;
- an SBOM attestation;
- one Linux AMD64 release image per service.

A future multi-architecture release requires separate physical-device and platform validation. It must not be added merely by changing the platform list.

## Signing

Both image digests are signed with Cosign keyless signing through the GitHub Actions OpenID Connect identity.

Expected certificate identity:

```text
https://github.com/memphiscardcompany/ManeFlow/.github/workflows/publish-containers.yml@refs/heads/main
```

Expected issuer:

```text
https://token.actions.githubusercontent.com
```

The workflow immediately verifies both signatures against that exact identity and issuer.

Keyless signing writes signature metadata to Sigstore's public transparency service. It does not expose ManeFlow source code, container layers, runtime secrets, private customer data, or image contents. It does publicly record cryptographic release metadata such as artifact digest and signing identity.

## Release manifest

Every successful publication generates:

```text
container-release-manifest.json
container-release-manifest.sigstore.json
SHA256SUMS
```

The JSON manifest records:

- source repository and commit;
- source verification workflow run;
- container publication workflow run;
- exact application image and digest;
- exact vision image and digest;
- target platform;
- SBOM and provenance policy;
- signature identity and issuer;
- explicit statement that deployment was not performed;
- explicit absence of secrets, customer data, training images, and model weights.

The manifest itself is signed with Cosign keyless blob signing, verified in the workflow, checksummed, and retained as a private GitHub Actions artifact.

## Permissions

The publication workflow receives only:

```text
contents: read
actions: read
packages: write
id-token: write
```

It does not receive:

- repository contents write;
- deployments write;
- pull-request write;
- issue write;
- environment secrets;
- SSH credentials;
- cloud deployment credentials.

The workflow contains no SSH, SCP, Kubernetes, Docker Compose deployment, DNS, Shopify, Meta, or production mutation step.

## Package visibility and host access

The workflow publishes through the repository-scoped GitHub token. Package visibility and repository linkage must be reviewed in the GitHub Packages interface after the first run.

The staging host needs a separate read-only package credential or GitHub App installation capable of pulling the two private images. That credential belongs only in the host secret store. It must not be committed or pasted into chat.

The host must pull exact digests from the signed release manifest. It must never deploy `latest`, `main`, a branch tag, or a mutable semantic tag.

## Release verification on a host

Before deployment, verify both signatures:

```bash
identity='https://github.com/memphiscardcompany/ManeFlow/.github/workflows/publish-containers.yml@refs/heads/main'
issuer='https://token.actions.githubusercontent.com'

cosign verify \
  --certificate-identity "$identity" \
  --certificate-oidc-issuer "$issuer" \
  'ghcr.io/memphiscardcompany/maneflow@sha256:REPLACE'

cosign verify \
  --certificate-identity "$identity" \
  --certificate-oidc-issuer "$issuer" \
  'ghcr.io/memphiscardcompany/maneflow-vision@sha256:REPLACE'
```

Also verify the downloaded release-manifest bundle and `SHA256SUMS` before copying the digest references into `.release.staging`.

## Current evidence boundary

Source-level implementation and tests can prove that the workflow is structurally fail-closed. A successful workflow run is still required to prove:

- GitHub Packages write authorization;
- actual image digests;
- actual BuildKit provenance and SBOM attachments;
- successful OIDC issuance;
- successful Cosign signature upload;
- signature verification;
- release-manifest artifact creation;
- private package visibility.

No image is represented as published until an exact completed workflow run provides that evidence.

## Relationship to staging

The first-party staging runbook consumes the resulting immutable references. The release workflow deliberately does not deploy them.

The approved sequence is:

```text
merged commit
→ full Verify ManeFlow success
→ signed private container publication
→ owner reviews manifest and signatures
→ owner provisions host secrets and DNS
→ approval-gated first-party staging deployment
→ physical-device acceptance
→ production release review
```

This separation prevents a successful code merge from silently becoming a public deployment.
