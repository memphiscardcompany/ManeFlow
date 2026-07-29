import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

function serviceBlock(compose, service, nextService = null) {
  const marker = `  ${service}:\n`;
  const start = compose.indexOf(marker);
  assert.notEqual(start, -1, `Missing Compose service: ${service}`);
  const end = nextService
    ? compose.indexOf(`  ${nextService}:\n`, start + marker.length)
    : compose.indexOf('\nnetworks:', start + marker.length);
  return compose.slice(start, end === -1 ? undefined : end);
}

test('application container uses the committed lockfile and a non-root runtime', async () => {
  const dockerfile = await read('Dockerfile');
  assert.match(dockerfile, /COPY package\.json package-lock\.json/);
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /\/var\/lib\/maneflow\/scan-jobs/);
  assert.doesNotMatch(dockerfile, /npm install/);
});

test('local compose persists scan jobs without claiming a public production release', async () => {
  const compose = await read('docker-compose.yml');
  assert.match(compose, /NODE_ENV: development/);
  assert.match(compose, /MANEFLOW_SCAN_JOB_STORAGE_DURABLE: "true"/);
  assert.match(compose, /maneflow_scan_jobs:\/var\/lib\/maneflow\/scan-jobs/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
});

test('first-party staging exposes only the TLS proxy and keeps data services private', async () => {
  const compose = await read('deploy/compose.staging.yml');
  const postgres = serviceBlock(compose, 'postgres', 'redis');
  const redis = serviceBlock(compose, 'redis', 'migrate');
  const vision = serviceBlock(compose, 'vision', 'maneflow');
  const maneflow = serviceBlock(compose, 'maneflow', 'caddy');
  const caddy = serviceBlock(compose, 'caddy');

  assert.match(maneflow, /PUBLIC_BASE_URL: https:\/\/\$\{MANEFLOW_DOMAIN/);
  assert.match(maneflow, /MANEFLOW_SCAN_JOB_STORAGE_DURABLE: "true"/);
  assert.match(maneflow, /scan_jobs:\/var\/lib\/maneflow\/scan-jobs/);
  assert.match(compose, /internal:\s*\n\s*internal: true/);
  assert.match(caddy, /ports:[\s\S]*"443:443"/);

  for (const [name, block] of Object.entries({ postgres, redis, vision, maneflow })) {
    assert.doesNotMatch(block, /\n\s+ports:/, `${name} must not expose host ports`);
  }
  assert.match(vision, /\n\s+expose: \["8741"\]/);
  assert.match(maneflow, /\n\s+expose: \["4321"\]/);

  for (const variable of ['MANEFLOW_IMAGE_REF', 'MANEFLOW_VISION_IMAGE_REF', 'POSTGRES_IMAGE_REF', 'REDIS_IMAGE_REF', 'CADDY_IMAGE_REF']) {
    assert.match(compose, new RegExp(`\\$\\{${variable}:\\?`));
  }
  assert.match(maneflow, /MANEBRAIN_META_KILL_SWITCH: "true"/);
  assert.match(maneflow, /MANEBRAIN_META_OUTBOUND_ENABLED: "false"/);
});

test('Caddy contract provisions first-party TLS and restrictive proxy headers', async () => {
  const caddyfile = await read('deploy/Caddyfile');
  assert.match(caddyfile, /\{\$MANEFLOW_DOMAIN\}/);
  assert.match(caddyfile, /Strict-Transport-Security/);
  assert.match(caddyfile, /X-Content-Type-Options "nosniff"/);
  assert.match(caddyfile, /Permissions-Policy/);
  assert.match(caddyfile, /reverse_proxy maneflow:4321/);
  assert.match(caddyfile, /max_size 32MB/);
});

test('staging shell procedures pass syntax validation and refuse placeholders by design', async () => {
  for (const file of ['deploy/deploy-staging.sh', 'deploy/backup-staging.sh', 'deploy/rollback-staging.sh']) {
    const syntax = spawnSync('bash', ['-n', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, `${file}: ${syntax.stderr}`);
  }
  const deploy = await read('deploy/deploy-staging.sh');
  assert.match(deploy, /grep -Eq 'REPLACE\|example\\\.invalid\|URL_ENCODED'/);
  assert.match(deploy, /@sha256:/);
  assert.match(deploy, /backup-staging\.sh/);
  assert.match(deploy, /smoke-staging\.mjs/);
});

test('staging compose renders with sanitized placeholder values when Docker Compose is available', async (t) => {
  const version = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  if (version.status !== 0) {
    t.skip('Docker Compose is not available in this test environment.');
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-compose-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const digest = `sha256:${'a'.repeat(64)}`;
  const envFile = path.join(directory, '.env');
  const releaseFile = path.join(directory, '.release');
  await fs.writeFile(envFile, [
    'MANEFLOW_DOMAIN=app.example.test',
    'ACME_EMAIL=ops@example.test',
    'POSTGRES_DB=maneflow_staging',
    'POSTGRES_ADMIN_USER=postgres',
    'POSTGRES_ADMIN_PASSWORD=admin-secret',
    'MANEFLOW_DATABASE_APP_PASSWORD=app-secret',
    'POSTGRES_ADMIN_DATABASE_URL=postgresql://postgres:admin-secret@postgres:5432/maneflow_staging',
    'MANEFLOW_APP_DATABASE_URL=postgresql://maneflow_app:app-secret@postgres:5432/maneflow_staging',
    'MANEFLOW_API_TOKEN=api-secret',
    'MANEFLOW_SERVICE_TOKEN=service-secret',
    'PROVIDER_WEBHOOK_SECRET=provider-secret',
    'EBAY_OAUTH_STATE_SECRET=oauth-secret',
    'MANEFLOW_EMAIL_WEBHOOK_URL=https://email.example.test/hook',
    'MANEFLOW_EMAIL_WEBHOOK_SECRET=email-secret',
  ].join('\n'));
  await fs.writeFile(releaseFile, [
    `MANEFLOW_IMAGE_REF=registry.example.test/maneflow@${digest}`,
    `MANEFLOW_VISION_IMAGE_REF=registry.example.test/maneflow-vision@${digest}`,
    `POSTGRES_IMAGE_REF=registry.example.test/postgres@${digest}`,
    `REDIS_IMAGE_REF=registry.example.test/redis@${digest}`,
    `CADDY_IMAGE_REF=registry.example.test/caddy@${digest}`,
    `RELEASE_COMMIT_SHA=${'b'.repeat(40)}`,
    'RELEASE_DEPLOYED_AT=2026-07-29T00:00:00.000Z',
    'MANEFLOW_WEB_RELEASE_ID=web-test',
    'MANEFLOW_API_RELEASE_ID=api-test',
    'MANEFLOW_VISION_RELEASE_ID=vision-test',
  ].join('\n'));
  const rendered = spawnSync('docker', [
    'compose', '--env-file', envFile, '--env-file', releaseFile,
    '-f', path.join(root, 'deploy/compose.staging.yml'), 'config', '--quiet',
  ], { cwd: path.join(root, 'deploy'), encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr);
});
