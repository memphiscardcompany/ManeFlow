# ManeFlow first-party staging runbook

## Objective

Deploy an exact, tested ManeFlow release to a first-party hostname such as:

```text
app.memphiscardcompany.com
```

This replaces the numbered AppDeploy address as the intended customer-facing staging entry point. It does not represent that DNS, hosting, certificates, credentials, or a live deployment have already been completed.

## Architecture

```text
Internet
  → app.memphiscardcompany.com
  → Caddy TLS proxy
  → ManeFlow API/PWA
      → PostgreSQL + pgvector
      → Redis
      → private durable scan-job volume
      → ManeFlow vision worker
```

Only Caddy exposes host ports. PostgreSQL, Redis, ManeFlow, and the vision worker remain on a private Docker network.

The stack is appropriate for controlled single-host staging. It is not the final multi-region architecture for millions of users.

## Files

```text
deploy/Caddyfile
deploy/compose.staging.yml
deploy/.env.staging.example
deploy/.release.staging.example
deploy/deploy-staging.sh
deploy/backup-staging.sh
deploy/rollback-staging.sh
deploy/smoke-staging.mjs
```

## Required external prerequisites

These are owner or infrastructure-provider actions and cannot be proved by source code alone:

1. A Linux staging host with current Docker Engine and the Compose plugin.
2. Firewall access for TCP 80/443 and UDP 443.
3. DNS `A` and/or `AAAA` records for the selected subdomain pointing to the staging host.
4. A container registry capable of storing private digest-addressed images.
5. Approved transactional staging email service.
6. Encrypted host backup destination or off-host backup system.
7. Owner approval for the exact staging release.

Do not expose this stack using production customer data until access, backups, monitoring, retention, and rollback have been verified.

## Recommended hostname

Use:

```text
app.memphiscardcompany.com
```

This is clearer and more extensible than a numbered deployment-host URL. `maneflow.memphiscardcompany.com` remains a valid alternative, but one canonical hostname should be selected to avoid split cookies, OAuth callbacks, indexing, and analytics.

## Build and image gate

Build application and vision images only from the exact merged Git commit that passed CI.

Record:

- source commit SHA;
- build workflow run;
- image digest;
- dependency lockfile hash;
- test summary;
- build timestamp;
- release IDs.

The staging compose file accepts only image references containing `@sha256:`. Mutable `latest`, branch, or version tags are insufficient as deployment evidence.

The application Dockerfile uses the committed root `package-lock.json` and `npm ci --omit=dev --ignore-scripts`.

## Host layout

```bash
sudo install -d -m 0750 -o deploy -g deploy /srv/maneflow
sudo install -d -m 0700 -o deploy -g deploy /srv/maneflow/backups
sudo install -d -m 0700 -o deploy -g deploy /srv/maneflow/releases
```

Copy the `deploy/` directory from the exact release commit into `/srv/maneflow/`.

## Secret configuration

```bash
cd /srv/maneflow
cp .env.staging.example .env.staging
cp .release.staging.example .release.staging
chmod 0600 .env.staging .release.staging
```

Populate `.env.staging` directly on the host or through an approved secret manager. Never paste secrets into chat, commit them, include them in screenshots, or place them in deployment logs.

Every secret value must be independent. Do not reuse the PostgreSQL password as an API, service, webhook, email, or OAuth-state secret.

`.release.staging` contains only immutable non-secret release metadata and digest-pinned image references. Preserve each approved version in the host `releases/` directory.

## DNS and TLS

Create the selected subdomain record at the authoritative DNS provider. Wait until public DNS resolves to the staging host before running the deployment.

Caddy obtains and renews the certificate using ACME. The Caddy configuration:

- removes its administrative API;
- redirects and serves HTTPS through Caddy's normal automatic HTTPS behavior;
- applies HSTS;
- applies restrictive content, referrer, frame, and permissions headers;
- caps request bodies at 32 MB;
- proxies only to ManeFlow's private port;
- emits structured access logs.

Do not place Cloudflare, another CDN, or a load balancer in front until trusted-proxy and client-IP behavior are reviewed and tested.

## Initial staging deployment

From `/srv/maneflow`:

```bash
bash deploy-staging.sh .env.staging .release.staging
```

The procedure:

1. rejects placeholder values;
2. requires the secret file to use mode `0600`;
3. requires full release commit provenance;
4. requires digest-pinned images;
5. validates Docker Compose;
6. preserves the previous release manifest;
7. pulls the exact images;
8. starts PostgreSQL and Redis;
9. creates a pre-migration backup on upgrades;
10. runs migrations once;
11. starts the vision worker, ManeFlow, and Caddy;
12. waits for public HTTPS health;
13. verifies the folder-intake page;
14. verifies the deployed commit and release IDs;
15. proves unauthenticated durable scan-job creation is rejected.

The script does not publish or modify Shopify.

## Backup

Manual verified backup:

```bash
bash backup-staging.sh .env.staging .release.staging backups
```

It creates:

- PostgreSQL custom-format dump;
- compressed durable scan-job volume archive;
- SHA-256 manifest;
- immediate checksum verification.

Backups stay private on the staging host by default. For meaningful disaster recovery, copy them to encrypted off-host storage and run a restore drill in an isolated environment.

A backup is not verified merely because a file exists. Restore testing must prove:

- the dump opens;
- migrations are compatible;
- account isolation remains intact;
- durable jobs recover without duplicate processing;
- retained source images are still private;
- release provenance remains traceable.

## Rollback

Application rollback:

```bash
bash rollback-staging.sh .env.staging releases/PREVIOUS_RELEASE.env
```

The procedure switches application and vision image references to the previous recorded release, then reruns health and provenance smoke tests.

It intentionally does **not** reverse database migrations. A release may be rolled back only when the prior application version is documented as compatible with the current schema. Destructive database rollback requires a separate approved restore procedure.

## Required manual acceptance test

After automated smoke tests pass, verify from a physical iPhone and desktop browser:

1. Open the exact HTTPS first-party URL.
2. Create a staging account and verify email.
3. Sign out and sign back in.
4. Open Folder intake.
5. Select a small authorized folder first.
6. Confirm selected count.
7. Start intake.
8. Refresh the page while processing.
9. Confirm the same job resumes.
10. Confirm every uploaded item reaches a terminal status.
11. Confirm only temporary failures retry and attempts remain bounded.
12. Confirm failed items can be explicitly retried.
13. Confirm another account cannot read the job URL.
14. Confirm completed scan drafts require human verification.
15. Confirm collection saving and reopening work.
16. Confirm source payload deletion and retention policy with server evidence.

Only after a small batch passes should an 856-image folder be attempted. Record:

- exact release SHA;
- image count and total bytes;
- upload duration;
- processing duration;
- completed, failed, retried, and unresolved counts;
- CPU, memory, disk, queue, and vision-worker metrics;
- P50/P95 item latency;
- browser and device versions;
- any lost or duplicated items.

## GPU policy

The staging example defaults to CPU and classical detection. A cloud GPU may be enabled only after:

- compatible driver/runtime evidence;
- exact image digest and model manifest;
- rights-cleared model/data provenance;
- CPU-versus-GPU benchmark;
- VRAM and concurrency limits;
- safe CPU fallback policy;
- rollback test.

Joshua's local RTX 2070 SUPER remains an opt-in development resource. Customer staging or production traffic must never depend on his home PC.

## Meta policy

The staging compose file keeps:

```text
MANEBRAIN_META_INTAKE_ENABLED=false
MANEBRAIN_META_KILL_SWITCH=true
MANEBRAIN_META_OUTBOUND_ENABLED=false
```

Meta may be configured only after the first-party HTTPS callback is live and the exact owner account, MFA, app/business/Page/Instagram assets, permissions, tokens, signed webhook event, approval workflow, and kill-switch rollback are verified.

## Shopify integration

The historical Shopify work is isolated in an unpublished theme. A theme page or link may point to the first-party staging hostname only after the authenticated end-to-end workflow passes. The current live theme must not be changed without preview, rollback, and owner approval.

An iframe is not the preferred final experience because camera permissions, cookies, account state, accessibility, and mobile navigation are more reliable when the first-party app opens directly. The Memphis Card Company site should present a polished ManeFlow landing page and launch the authenticated app on the canonical subdomain.

## Promotion beyond staging

Production remains blocked until staging proves:

- exact release provenance;
- authentication and email verification;
- tenant isolation;
- persistent PostgreSQL behavior;
- durable scan-job restart recovery;
- private image storage and deletion;
- backup and restore;
- load and endurance behavior;
- monitoring and alerting;
- provider credentials and rate limits;
- physical-device behavior;
- accessibility and browser coverage;
- incident rollback;
- privacy, terms, and deletion disclosures.

For millions of users, replace single-host scheduling and volumes with managed PostgreSQL, private object storage, a durable queue, autoscaled stateless API replicas, fenced CPU/GPU workers, multi-zone backups, observability, and tested capacity controls. The single-host staging stack is a controlled verification step—not the final scale claim.
