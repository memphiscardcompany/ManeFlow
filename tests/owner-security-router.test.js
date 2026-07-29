import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRouter } from '../src/router.js';
import { createOwnerSecurityRouter } from '../src/owner-security-router.js';
import { totpCode } from '../src/services/owner-mfa.js';
import { JsonStore } from '../src/services/store.js';
import { TtlCache } from '../src/services/cache.js';
import { createProviderRegistry } from '../src/services/provider-registry.js';

let server;
let baseUrl;
let directory;
let config;
let store;
let ownerCookie;
let ownerCsrf;
let recoveryCodes;

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return {
    response,
    body,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
  };
}

function mutation(cookie, csrf, body) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      ...(csrf ? { 'x-maneflow-csrf': csrf } : {}),
    },
    body: JSON.stringify(body || {}),
  };
}

before(async () => {
  const cards = JSON.parse(await fs.readFile(new URL('../src/data/cards.json', import.meta.url), 'utf8'));
  const sales = JSON.parse(await fs.readFile(new URL('../src/data/sales.json', import.meta.url), 'utf8'));
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-owner-security-'));
  config = {
    appName: 'ManeFlow', version: 'test', releaseChannel: 'test', productionMode: false,
    port: 0, host: '127.0.0.1', publicBaseUrl: 'http://127.0.0.1',
    apiToken: 'api-test-token', serviceToken: 'service-test-token', adminToken: 'admin-test-token',
    allowLegacyAdminToken: false, bootstrapAdminEmail: '', demoMode: true,
    requireAuthentication: true, requireEmailVerification: false, csrfProtection: true,
    allowGuestWrites: false, allowPublicSignups: true, exposeDevTokens: true,
    accountTokenMinutes: 60, sessionDays: 30, allowedOrigins: [],
    maxRequestBytes: 14_000_000, runtimeFile: path.join(directory, 'state.json'),
    openaiApiKey: '', openaiVisionModel: '', providerWebhookSecret: 'test-secret',
    emailWebhookUrl: '', emailWebhookSecret: '', ebayClientId: '', ebayClientSecret: '',
    tcgplayerPublicKey: '', tcgplayerPrivateKey: '',
    platformOwnerUserIds: [], ownerRecentReauthMinutes: 15,
    ownerMfaEncryptionKey: Buffer.alloc(32, 11).toString('base64url'), ownerMfaIssuer: 'ManeFlow Test',
  };
  store = await new JsonStore(config.runtimeFile).init();
  const providers = createProviderRegistry(config, sales);
  const coreRouter = createRouter({ config, cards, sales, providers, store, cache: new TtlCache() });
  const ownerSecurityRouter = createOwnerSecurityRouter({ config, store });
  server = http.createServer(async (req, res) => {
    const handled = await ownerSecurityRouter(req, res);
    if (!handled && !res.writableEnded) await coreRouter(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const owner = await request('/api/auth/register', mutation('', '', {
    name: 'Joshua', email: 'owner@example.com', password: 'owner-password-123',
  }));
  assert.equal(owner.response.status, 201);
  ownerCookie = owner.cookie;
  const ownerUser = store.findUserByEmail('owner@example.com');
  config.platformOwnerUserIds = [ownerUser.id];
  const me = await request('/api/auth/me', { headers: { cookie: ownerCookie } });
  ownerCsrf = me.body.csrfToken;

  const other = await request('/api/auth/register', mutation('', '', {
    name: 'Other', email: 'other@example.com', password: 'other-password-123',
  }));
  assert.equal(other.response.status, 201);
  const otherMe = await request('/api/auth/me', { headers: { cookie: other.cookie } });
  const denied = await request('/api/auth/owner/security-status', { headers: { cookie: other.cookie } });
  assert.equal(denied.response.status, 403);
  assert.ok(otherMe.body.csrfToken);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});

test('owner security APIs reject service tokens and require CSRF on mutations', async () => {
  const service = await request('/api/auth/owner/security-status', {
    headers: { authorization: 'Bearer service-test-token' },
  });
  assert.equal(service.response.status, 401);

  const missingCsrf = await request('/api/auth/owner/mfa/enroll', mutation(ownerCookie, '', {
    password: 'owner-password-123',
  }));
  assert.equal(missingCsrf.response.status, 403);
});

test('allowlisted owner enrolls TOTP and receives one-time recovery codes', async () => {
  const initial = await request('/api/auth/owner/security-status', { headers: { cookie: ownerCookie } });
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.allowlisted, true);
  assert.equal(initial.body.enrolled, false);

  const wrongPassword = await request('/api/auth/owner/mfa/enroll', mutation(ownerCookie, ownerCsrf, {
    password: 'wrong-password',
  }));
  assert.equal(wrongPassword.response.status, 400);
  assert.equal(wrongPassword.body.error, 'OWNER_PASSWORD_INVALID');

  const enrollment = await request('/api/auth/owner/mfa/enroll', mutation(ownerCookie, ownerCsrf, {
    password: 'owner-password-123',
  }));
  assert.equal(enrollment.response.status, 201);
  assert.match(enrollment.body.secret, /^[A-Z2-7]+$/);
  assert.match(enrollment.body.otpauthUri, /^otpauth:\/\/totp\//);
  assert.doesNotMatch(JSON.stringify(enrollment.body), /passwordHash|backupCodeHashes|secretCiphertext/);

  const confirmation = await request('/api/auth/owner/mfa/confirm', mutation(ownerCookie, ownerCsrf, {
    code: totpCode(enrollment.body.secret),
  }));
  assert.equal(confirmation.response.status, 200);
  assert.equal(confirmation.body.status.enrolled, true);
  assert.equal(confirmation.body.status.recentReauthentication, true);
  assert.equal(confirmation.body.recoveryCodes.length, 10);
  recoveryCodes = confirmation.body.recoveryCodes;

  const me = await request('/api/auth/me', { headers: { cookie: ownerCookie } });
  assert.doesNotMatch(JSON.stringify(me.body), /ownerMfa|backupCodeHashes|secretCiphertext/);
  const ownerUser = store.findUserByEmail('owner@example.com');
  assert.ok(ownerUser.ownerMfa.secretCiphertext);
  assert.equal(ownerUser.ownerMfa.backupCodeHashes.length, 10);
});

test('a new session requires password plus TOTP or one-time recovery code', async () => {
  const logout = await request('/api/auth/logout', mutation(ownerCookie, ownerCsrf, {}));
  assert.equal(logout.response.status, 200);
  const login = await request('/api/auth/login', mutation('', '', {
    email: 'owner@example.com', password: 'owner-password-123',
  }));
  assert.equal(login.response.status, 200);
  ownerCookie = login.cookie;
  const me = await request('/api/auth/me', { headers: { cookie: ownerCookie } });
  ownerCsrf = me.body.csrfToken;

  const beforeReauth = await request('/api/auth/owner/security-status', { headers: { cookie: ownerCookie } });
  assert.equal(beforeReauth.body.enrolled, true);
  assert.equal(beforeReauth.body.mfaVerifiedAt, null);
  assert.equal(beforeReauth.body.recentReauthentication, false);

  const reauthenticated = await request('/api/auth/owner/reauthenticate', mutation(ownerCookie, ownerCsrf, {
    password: 'owner-password-123', code: recoveryCodes[0],
  }));
  assert.equal(reauthenticated.response.status, 200);
  assert.equal(reauthenticated.body.recoveryCodeUsed, true);
  assert.equal(reauthenticated.body.status.recoveryCodesRemaining, 9);
  assert.equal(reauthenticated.body.status.recentReauthentication, true);

  const replay = await request('/api/auth/owner/reauthenticate', mutation(ownerCookie, ownerCsrf, {
    password: 'owner-password-123', code: recoveryCodes[0],
  }));
  assert.equal(replay.response.status, 400);
  assert.equal(replay.body.error, 'OWNER_MFA_CODE_INVALID');
});

test('recovery-code regeneration invalidates the previous set and is audited', async () => {
  const regenerated = await request('/api/auth/owner/recovery-codes/regenerate', mutation(ownerCookie, ownerCsrf, {
    password: 'owner-password-123', code: recoveryCodes[1],
  }));
  assert.equal(regenerated.response.status, 200);
  assert.equal(regenerated.body.recoveryCodes.length, 10);
  assert.notDeepEqual(regenerated.body.recoveryCodes, recoveryCodes);
  assert.equal(regenerated.body.status.recoveryCodesRemaining, 10);

  const stale = await request('/api/auth/owner/reauthenticate', mutation(ownerCookie, ownerCsrf, {
    password: 'owner-password-123', code: recoveryCodes[2],
  }));
  assert.equal(stale.response.status, 400);

  const auditTypes = store.state.auditEvents.map((entry) => entry.type);
  assert.ok(auditTypes.includes('owner_mfa_enrollment_started'));
  assert.ok(auditTypes.includes('owner_mfa_enabled'));
  assert.ok(auditTypes.includes('owner_recent_reauthentication'));
  assert.ok(auditTypes.includes('owner_recovery_codes_regenerated'));
});
