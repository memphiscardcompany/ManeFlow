import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadConfig } from '../src/config.js';
import { clientIp, createRouter } from '../src/router.js';
import { TtlCache } from '../src/services/cache.js';
import { createProviderRegistry } from '../src/services/provider-registry.js';
import { JsonStore } from '../src/services/store.js';

let server;
let baseUrl;
let directory;

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function postJson(pathname, body, forwardedFor = null) {
  return request(pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
    },
    body: JSON.stringify(body),
  });
}

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-auth-rate-limit-'));
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
    TRUST_PROXY: 'false',
  });
  const cards = JSON.parse(await fs.readFile(new URL('../src/data/cards.json', import.meta.url), 'utf8'));
  const sales = JSON.parse(await fs.readFile(new URL('../src/data/sales.json', import.meta.url), 'utf8'));
  const store = await new JsonStore(config.runtimeFile).init();
  const providers = createProviderRegistry(config, sales);
  const router = createRouter({
    config,
    cards,
    sales,
    providers,
    store,
    cache: new TtlCache(),
  });

  server = http.createServer(async (req, res) => {
    await router(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const registered = await postJson('/api/auth/register', {
    name: 'Rate Limit Test',
    email: 'rate-limit@example.test',
    password: 'correct-password-123',
  });
  assert.equal(registered.response.status, 201);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});

test('TRUST_PROXY defaults off and forwarded IPs require a trusted immediate proxy', () => {
  assert.equal(loadConfig({}).trustProxy, false);

  const requestFromInternet = {
    headers: { 'x-forwarded-for': '198.51.100.7, 192.0.2.4' },
    socket: { remoteAddress: '203.0.113.10' },
  };

  assert.equal(clientIp(requestFromInternet, {
    trustProxy: false,
    trustedProxyAddresses: ['203.0.113.10'],
  }), '203.0.113.10');

  assert.equal(clientIp(requestFromInternet, {
    trustProxy: true,
    trustedProxyAddresses: ['127.0.0.1'],
  }), '203.0.113.10');

  assert.equal(clientIp(requestFromInternet, {
    trustProxy: true,
    trustedProxyAddresses: ['203.0.113.10'],
  }), '198.51.100.7');
});

test('login has an account limiter that IP-header rotation cannot bypass', async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await postJson('/api/auth/login', {
      email: 'rate-limit@example.test',
      password: 'wrong-password',
    }, `198.51.100.${attempt + 1}`);
    assert.equal(result.response.status, 401, `attempt ${attempt + 1}: ${JSON.stringify(result.body)}`);
  }

  const blocked = await postJson('/api/auth/login', {
    email: 'RATE-LIMIT@example.test',
    password: 'wrong-password',
  }, '198.51.100.250');
  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.body.error, 'rate_limited');
});

test('forgot-password has a per-account limiter', async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await postJson('/api/auth/forgot-password', {
      email: 'rate-limit@example.test',
    }, `192.0.2.${attempt + 1}`);
    assert.equal(result.response.status, 202, `attempt ${attempt + 1}: ${JSON.stringify(result.body)}`);
  }

  const blocked = await postJson('/api/auth/forgot-password', {
    email: 'rate-limit@example.test',
  }, '192.0.2.250');
  assert.equal(blocked.response.status, 429);
});

test('verification requests have a per-account limiter', async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await postJson('/api/auth/request-verification', {
      email: 'rate-limit@example.test',
    }, `203.0.113.${attempt + 1}`);
    assert.equal(result.response.status, 202, `attempt ${attempt + 1}: ${JSON.stringify(result.body)}`);
  }

  const blocked = await postJson('/api/auth/request-verification', {
    email: 'rate-limit@example.test',
  }, '203.0.113.250');
  assert.equal(blocked.response.status, 429);
});
