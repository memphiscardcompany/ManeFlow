import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRouter } from '../src/router.js';
import { createDurableScanJobRouter } from '../src/scan-job-router.js';
import { JsonStore } from '../src/services/store.js';
import { TtlCache } from '../src/services/cache.js';
import { createProviderRegistry } from '../src/services/provider-registry.js';

let server;
let baseUrl;
let directory;
let scanJobRuntime;
let cards;
let sales;

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return {
    response,
    body,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
  };
}

async function waitForJob(jobId, cookie, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await request(`/api/scan-jobs/${jobId}`, { headers: { cookie } });
    if (['complete', 'partial', 'failed'].includes(result.body.job?.status)) return result.body.job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for scan job.');
}

before(async () => {
  cards = JSON.parse(await fs.readFile(new URL('../src/data/cards.json', import.meta.url), 'utf8'));
  sales = JSON.parse(await fs.readFile(new URL('../src/data/sales.json', import.meta.url), 'utf8'));
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-scan-job-router-'));
  const config = {
    appName: 'ManeFlow', version: 'test', releaseChannel: 'test', productionMode: false,
    port: 0, host: '127.0.0.1', publicBaseUrl: 'http://127.0.0.1',
    apiToken: 'api-test-token', serviceToken: 'service-test-token', adminToken: 'admin-test-token',
    allowLegacyAdminToken: false, bootstrapAdminEmail: '', demoMode: true,
    requireAuthentication: true, requireEmailVerification: false, csrfProtection: true,
    allowGuestWrites: false, allowPublicSignups: true, exposeDevTokens: true,
    accountTokenMinutes: 60, sessionDays: 30, allowedOrigins: [],
    maxRequestBytes: 14_000_000, runtimeFile: path.join(directory, 'state.json'),
    scanJobDir: path.join(directory, 'scan-jobs'), scanJobMaxItems: 100,
    scanJobMaxItemBytes: 1_000_000, scanJobConcurrency: 2, scanJobMaxAttempts: 2,
    scanJobRetentionHours: 24, scanJobRetryBackoffMs: 100,
    openaiApiKey: '', openaiVisionModel: '', providerWebhookSecret: 'test-secret',
    emailWebhookUrl: '', emailWebhookSecret: '', ebayClientId: '', ebayClientSecret: '',
    tcgplayerPublicKey: '', tcgplayerPrivateKey: '',
  };
  const store = await new JsonStore(config.runtimeFile).init();
  const providers = createProviderRegistry(config, sales);
  const coreRouter = createRouter({ config, cards, sales, providers, store, cache: new TtlCache() });
  scanJobRuntime = await createDurableScanJobRouter({
    config,
    store,
    processor: async ({ ownerUserId, body }) => ({
      ownerUserId,
      exact: false,
      message: 'Draft scan complete',
      matches: [],
      sourceType: body.sourceType,
    }),
  });
  server = http.createServer(async (req, res) => {
    const handled = await scanJobRuntime.handle(req, res);
    if (!handled && !res.writableEnded) await coreRouter(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await scanJobRuntime?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});

test('durable scan job API requires a real authenticated user session', async () => {
  const anonymous = await request('/api/scan-jobs');
  assert.equal(anonymous.response.status, 401);
  const service = await request('/api/scan-jobs', {
    headers: { authorization: 'Bearer service-test-token' },
  });
  assert.equal(service.response.status, 401);
});

test('durable scan job API requires CSRF and explicit image authorization', async () => {
  const registered = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Alice', email: 'scan-alice@example.com', password: 'alice-password-123' }),
  });
  assert.equal(registered.response.status, 202);
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'scan-alice@example.com', password: 'alice-password-123' }),
  });
  assert.equal(login.response.status, 200);
  const me = await request('/api/auth/me', { headers: { cookie: login.cookie } });
  assert.ok(me.body.csrfToken);

  const missingCsrf = await request('/api/scan-jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: login.cookie },
    body: JSON.stringify({ idempotencyKey: 'missing-csrf', expectedItems: 1, processingAuthorization: true }),
  });
  assert.equal(missingCsrf.response.status, 403);

  const missingAuthorization = await request('/api/scan-jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: login.cookie, 'x-maneflow-csrf': me.body.csrfToken },
    body: JSON.stringify({ idempotencyKey: 'missing-authorization', expectedItems: 1 }),
  });
  assert.equal(missingAuthorization.response.status, 400);
  assert.equal(missingAuthorization.body.error, 'SCAN_IMAGE_AUTHORIZATION_REQUIRED');
});

test('users cannot inspect another account scan job and completed results remain owner scoped', async () => {
  const aliceLogin = await request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'scan-alice@example.com', password: 'alice-password-123' }),
  });
  const aliceMe = await request('/api/auth/me', { headers: { cookie: aliceLogin.cookie } });
  const bobRegistered = await request('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Bob', email: 'scan-bob@example.com', password: 'bob-password-123' }),
  });
  assert.equal(bobRegistered.response.status, 202);
  const bob = await request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'scan-bob@example.com', password: 'bob-password-123' }),
  });
  assert.equal(bob.response.status, 200);
  const bobMe = await request('/api/auth/me', { headers: { cookie: bob.cookie } });

  const created = await request('/api/scan-jobs', {
    method: 'POST',
    headers: {
      'content-type': 'application/json', cookie: aliceLogin.cookie,
      'x-maneflow-csrf': aliceMe.body.csrfToken, 'idempotency-key': 'alice-folder-001',
    },
    body: JSON.stringify({
      idempotencyKey: 'alice-folder-001', expectedItems: 1,
      processingAuthorization: true, trainingConsent: false,
    }),
  });
  assert.equal(created.response.status, 201);
  const jobId = created.body.job.id;

  const bobRead = await request(`/api/scan-jobs/${jobId}`, { headers: { cookie: bob.cookie } });
  assert.equal(bobRead.response.status, 404);

  const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('owner-image')]);
  const dataUrl = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;
  const uploaded = await request(`/api/scan-jobs/${jobId}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: aliceLogin.cookie, 'x-maneflow-csrf': aliceMe.body.csrfToken },
    body: JSON.stringify({
      itemKey: 'image-001',
      fileName: 'folder/card-001.jpg',
      mimeType: 'image/jpeg',
      size: jpegBytes.length,
      dataUrl,
    }),
  });
  assert.equal(uploaded.response.status, 201);

  const duplicate = await request(`/api/scan-jobs/${jobId}/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: aliceLogin.cookie, 'x-maneflow-csrf': aliceMe.body.csrfToken },
    body: JSON.stringify({
      itemKey: 'image-001',
      fileName: 'folder/card-001.jpg',
      mimeType: 'image/jpeg',
      size: jpegBytes.length,
      dataUrl,
    }),
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.body.reused, true);

  const committed = await request(`/api/scan-jobs/${jobId}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: aliceLogin.cookie, 'x-maneflow-csrf': aliceMe.body.csrfToken },
    body: '{}',
  });
  assert.equal(committed.response.status, 202);
  const completed = await waitForJob(jobId, aliceLogin.cookie);
  assert.equal(completed.status, 'complete');
  assert.equal(completed.progress.complete, 1);
  assert.equal(completed.items[0].result.message, 'Draft scan complete');

  const bobRetry = await request(`/api/scan-jobs/${jobId}/retry-failed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: bob.cookie, 'x-maneflow-csrf': bobMe.body.csrfToken },
    body: '{}',
  });
  assert.equal(bobRetry.response.status, 404);
});
