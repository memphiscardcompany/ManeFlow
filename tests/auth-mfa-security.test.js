import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../src/config.js';
import { createRouter } from '../src/router.js';
import { hashSessionToken, sessionCookie } from '../src/services/auth.js';
import { totpCode } from '../src/services/mfa.js';
import { TtlCache } from '../src/services/cache.js';
import { createProviderRegistry } from '../src/services/provider-registry.js';
import { JsonStore } from '../src/services/store.js';

let server;
let baseUrl;
let directory;
let store;

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function postJson(pathname, body, token = null) {
  return request(pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-auth-mfa-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    RELEASE_CHANNEL: 'test',
    PORT: '0',
    HOST: '127.0.0.1',
    PUBLIC_BASE_URL: 'http://127.0.0.1',
    MANEFLOW_STATE_FILE: path.join(directory, 'state.json'),
    MANEFLOW_REQUIRE_AUTHENTICATION: 'true',
    MANEFLOW_REQUIRE_EMAIL_VERIFICATION: 'false',
    MANEFLOW_ALLOW_PUBLIC_SIGNUPS: 'true',
    MANEFLOW_EXPOSE_DEV_TOKENS: 'false',
    MANEFLOW_DEMO_MODE: 'true',
  });
  const cards = JSON.parse(await fs.readFile(new URL('../src/data/cards.json', import.meta.url), 'utf8'));
  const sales = JSON.parse(await fs.readFile(new URL('../src/data/sales.json', import.meta.url), 'utf8'));
  store = await new JsonStore(config.runtimeFile).init();
  const providers = createProviderRegistry(config, sales);
  const router = createRouter({ config, cards, sales, providers, store, cache: new TtlCache() });
  server = http.createServer(async (req, res) => router(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});

test('registration is generic for new and existing accounts', async () => {
  const payload = {
    name: 'Owner',
    email: 'owner@example.test',
    password: 'correct-password-123',
  };
  const first = await postJson('/api/auth/register', payload);
  const second = await postJson('/api/auth/register', payload);
  assert.equal(first.response.status, 202);
  assert.equal(second.response.status, 202);
  assert.deepEqual(second.body, first.body);
  assert.equal(first.body.user, undefined);
  assert.equal(first.body.authenticated, undefined);
});

test('new passwords store explicit hardened scrypt parameters', () => {
  const user = store.findUserByEmail('owner@example.test');
  assert.ok(user);
  assert.deepEqual(user.passwordParams, { N: 32768, r: 8, p: 1, keylen: 64 });
});

test('TOTP enrollment creates real MFA state and server-side step-up timestamps', async () => {
  const login = await postJson('/api/auth/login', {
    email: 'owner@example.test',
    password: 'correct-password-123',
    native: true,
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.body.sessionToken);
  const token = login.body.sessionToken;

  const enrolled = await postJson('/api/auth/mfa/totp/enroll', {
    password: 'correct-password-123',
  }, token);
  assert.equal(enrolled.response.status, 200);
  assert.match(enrolled.body.secret, /^[A-Z2-7]+$/);
  assert.match(enrolled.body.otpauthUrl, /^otpauth:\/\/totp\//);

  const confirmed = await postJson('/api/auth/mfa/totp/confirm', {
    code: totpCode(enrolled.body.secret),
  }, token);
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.enabled, true);

  const session = store.findSession(hashSessionToken(token));
  assert.ok(session.mfaVerifiedAt);
  assert.ok(session.reauthenticatedAt);
  const user = store.findUserByEmail('owner@example.test');
  assert.ok(user.mfaTotpSecret);
  assert.equal(user.mfaTotpPendingSecret, null);
  assert.ok(user.mfaEnabledAt);

  const me = await request('/api/auth/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.mfaEnabled, true);
});

test('HTTPS sessions use a __Host- cookie with Secure and no Domain attribute', () => {
  const cookie = sessionCookie('token', {
    publicBaseUrl: 'https://app.example.test',
    sessionDays: 30,
  });
  assert.match(cookie, /^__Host-mf_session=/);
  assert.match(cookie, /; Secure/);
  assert.doesNotMatch(cookie, /Domain=/i);
});
