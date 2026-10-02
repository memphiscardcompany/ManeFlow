import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRouter, securityHeaders } from '../src/router.js';
import { JsonStore } from '../src/services/store.js';
import { TtlCache } from '../src/services/cache.js';
import { createProviderRegistry } from '../src/services/provider-registry.js';

let server;
let baseUrl;
let directory;
let cards;
let store;

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return {
    response,
    body: await response.json().catch(() => ({})),
    cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
  };
}

before(async () => {
  cards = JSON.parse(await fs.readFile(new URL('../src/data/cards.json', import.meta.url), 'utf8'));
  const sales = JSON.parse(await fs.readFile(new URL('../src/data/sales.json', import.meta.url), 'utf8'));
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-security-gates-'));
  const config = {
    appName: 'ManeFlow',
    version: '2.22.0-beta.1',
    releaseChannel: 'test',
    releaseCommitSha: 'abc123',
    releaseDeployedAt: '2026-07-28T12:00:00.000Z',
    releaseEnvironment: 'test',
    webReleaseId: 'web-test',
    apiReleaseId: 'api-test',
    visionReleaseId: 'vision-test',
    migrationVersion: '004',
    port: 0,
    host: '127.0.0.1',
    publicBaseUrl: 'http://127.0.0.1',
    apiToken: '',
    serviceToken: 'service-test-token',
    adminToken: 'legacy-admin-token',
    allowLegacyAdminToken: false,
    bootstrapAdminEmail: 'owner@example.com',
    demoMode: true,
    requireAuthentication: true,
    csrfProtection: true,
    allowGuestWrites: false,
    allowPublicSignups: true,
    requireEmailVerification: true,
    exposeDevTokens: true,
    accountTokenMinutes: 60,
    sessionDays: 30,
    allowedOrigins: [],
    maxRequestBytes: 14_000_000,
    runtimeFile: path.join(directory, 'state.json'),
    openaiApiKey: '',
    openaiVisionModel: '',
    providerWebhookSecret: 'provider-test-secret',
    emailWebhookUrl: '',
    emailWebhookSecret: '',
    ebayClientId: '',
    ebayClientSecret: '',
    tcgplayerPublicKey: '',
    tcgplayerPrivateKey: '',
  };
  store = await new JsonStore(config.runtimeFile).init();
  const providers = createProviderRegistry(config, sales);
  server = http.createServer(createRouter({ config, cards, sales, providers, store, cache: new TtlCache() }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});

test('public signup cannot self-assign owner authority and creates no pre-verification session', async () => {
  const created = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Owner-shaped signup',
      email: 'owner@example.com',
      password: 'owner-password-123',
      role: 'admin',
    }),
  });
  assert.equal(created.response.status, 202);
  assert.equal(created.cookie, '');
  assert.equal(created.body.authenticated, undefined);
  assert.equal(created.body.user, undefined);
  const ownerUser = store.findUserByEmail('owner@example.com');
  assert.equal(ownerUser.role, 'collector');
  assert.equal(store.listSessions(ownerUser.id).length, 0);

  const dashboard = await request('/api/dashboard');
  assert.equal(dashboard.response.status, 401);

  const blockedLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'owner-password-123' }),
  });
  assert.equal(blockedLogin.response.status, 403);
  assert.equal(blockedLogin.body.error, 'email_not_verified');

  const verificationMessage = store.state.outbox.find((item) => item.type === 'verify_email' && item.to === 'owner@example.com');
  const verificationToken = new URL(verificationMessage.actionUrl).hash.match(/verify=([^&]+)/)?.[1];
  assert.ok(verificationToken);
  const verified = await request('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: decodeURIComponent(verificationToken) }),
  });
  assert.equal(verified.response.status, 200);
});

test('cookie mutations require CSRF and revoke-all invalidates the session', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', password: 'owner-password-123' }),
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.cookie);
  assert.ok(login.body.csrfToken);

  const blocked = await request('/api/collection', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: login.cookie },
    body: JSON.stringify({ cardId: cards[0].id, quantity: 1, purchasePrice: 100 }),
  });
  assert.equal(blocked.response.status, 403);
  assert.match(blocked.body.message, /CSRF/i);

  const added = await request('/api/collection', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: login.cookie,
      'x-maneflow-csrf': login.body.csrfToken,
    },
    body: JSON.stringify({ cardId: cards[0].id, quantity: 1, purchasePrice: 100 }),
  });
  assert.equal(added.response.status, 201);

  const revoked = await request('/api/auth/sessions/revoke-all', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: login.cookie,
      'x-maneflow-csrf': login.body.csrfToken,
    },
    body: '{}',
  });
  assert.equal(revoked.response.status, 200);
  assert.equal(revoked.body.loggedOut, true);

  const afterRevoke = await request('/api/dashboard', { headers: { cookie: login.cookie } });
  assert.equal(afterRevoke.response.status, 401);
});

test('legacy admin bearer tokens are disabled and release provenance is public and non-secret', async () => {
  const denied = await request('/api/admin/users', {
    headers: { authorization: 'Bearer legacy-admin-token' },
  });
  assert.equal(denied.response.status, 403);

  const release = await request('/api/release');
  assert.equal(release.response.status, 200);
  assert.deepEqual(release.body, { version: '2.22.0-beta.1', commitSha: 'abc123' });
  assert.equal(JSON.stringify(release.body).includes('legacy-admin-token'), false);
});

test('production security headers enforce HSTS and exclude the local vision origin', () => {
  const headers = securityHeaders({
    publicBaseUrl: 'https://app.example.test',
    productionMode: true,
    releaseChannel: 'production',
    cardImageAllowedHosts: [],
  });
  assert.equal(headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  assert.doesNotMatch(headers['content-security-policy'], /127\.0\.0\.1:8741/);
});
