import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRouter } from '../src/router.js';
import { TtlCache } from '../src/services/cache.js';
import { createProviderRegistry } from '../src/services/provider-registry.js';
import { JsonStore } from '../src/services/store.js';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('live session relay keeps service credentials private and sessions account scoped', async () => {
  const sessionId = '00000000-0000-4000-8000-000000000001';
  let createdCount = 0;
  let workerGoneId = null;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maneflow-live-router-'));
  const observed = [];
  const worker = http.createServer((req, res) => {
    observed.push({ path: req.url, method: req.method, authorization: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    req.resume();
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/v1/live/sessions') {
        createdCount += 1;
        const id = `00000000-0000-4000-8000-${String(createdCount).padStart(12, '0')}`;
        setTimeout(() => res.end(JSON.stringify({ session_id: id, status: 'active' })), createdCount > 1 ? 80 : 0);
      } else if (req.method === 'POST' && req.url === `/v1/live/sessions/${sessionId}/frames`) {
        res.end(JSON.stringify({ session_id: sessionId, frame_index: 1, tracks: [] }));
      } else if (req.method === 'GET' && req.url === `/v1/live/sessions/${workerGoneId}`) {
        res.statusCode = 404;
        res.end(JSON.stringify({ detail: 'gone internal detail' }));
      } else {
        res.end(JSON.stringify({ session_id: sessionId, status: 'active', deleted: req.method === 'DELETE' }));
      }
    });
  });
  let app;
  try {
    const workerUrl = await listen(worker);
    const cards = JSON.parse(await readFile(new URL('../src/data/cards.json', import.meta.url), 'utf8'));
    const sales = JSON.parse(await readFile(new URL('../src/data/sales.json', import.meta.url), 'utf8'));
    const config = {
      appName: 'ManeFlow', version: 'test', releaseChannel: 'test', productionMode: false,
      publicBaseUrl: 'http://127.0.0.1', serviceToken: 'private-worker-token',
      visionWorkerUrl: workerUrl, visionWorkerTimeoutMs: 2000,
      requireAuthentication: true, requireEmailVerification: false, csrfProtection: true,
      allowGuestWrites: false, allowPublicSignups: true, exposeDevTokens: true,
      accountTokenMinutes: 60, sessionDays: 30, allowedOrigins: [],
      maxRequestBytes: 14_000_000, maxLiveFramesPerDay: 2, runtimeFile: path.join(directory, 'state.json'),
      openaiApiKey: '', openaiVisionModel: '',
    };
    const store = await new JsonStore(config.runtimeFile).init();
    const providers = createProviderRegistry(config, sales);
    app = http.createServer(createRouter({ config, cards, sales, providers, store, cache: new TtlCache() }));
    const base = await listen(app);
    const request = async (route, options = {}) => {
      const response = await fetch(`${base}${route}`, options);
      return { status: response.status, body: await response.json() };
    };
    async function account(name) {
      const email = `${name}@example.com`;
      assert.equal((await request('/api/auth/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, email, password: `${name}-password-123` }),
      })).status, 202);
      const login = await request('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: `${name}-password-123`, native: true }),
      });
      assert.equal(login.status, 200);
      assert.ok(login.body.sessionToken);
      return { authorization: `Bearer ${login.body.sessionToken}`, 'content-type': 'application/json' };
    }
    const alice = await account('alice-live');
    const bob = await account('bob-live');
    assert.equal((await request('/api/vision/live/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    const created = await request('/api/vision/live/sessions', { method: 'POST', headers: alice, body: JSON.stringify({ mode: 'sweep' }) });
    assert.equal(created.status, 201);
    assert.equal(created.body.session_id, sessionId);
    assert.equal((await request('/api/vision/live/sessions', { headers: alice })).body.sessions.length, 1);
    assert.equal((await request('/api/vision/live/sessions/not-a-uuid', { headers: alice })).status, 400);
    assert.equal((await request(`/api/vision/live/sessions/${sessionId}`, { headers: bob })).status, 403);
    assert.equal((await request(`/api/vision/live/sessions/${sessionId}/frames`, {
      method: 'POST', headers: bob, body: JSON.stringify({ dataUrl: 'data:image/jpeg;base64,aGVsbG8=' }),
    })).status, 403);
    const frame = await request(`/api/vision/live/sessions/${sessionId}/frames`, {
      method: 'POST', headers: alice, body: JSON.stringify({ dataUrl: 'data:image/jpeg;base64,aGVsbG8=' }),
    });
    assert.equal(frame.status, 200);
    assert.equal(frame.body.frame_index, 1);
    assert.equal((await request(`/api/vision/live/sessions/${sessionId}/frames`, {
      method: 'POST', headers: alice, body: JSON.stringify({ dataUrl: 'data:image/jpeg;base64,aGVsbG8=' }),
    })).status, 200);
    assert.equal((await request(`/api/vision/live/sessions/${sessionId}/frames`, {
      method: 'POST', headers: alice, body: JSON.stringify({ dataUrl: 'data:image/jpeg;base64,aGVsbG8=' }),
    })).status, 402);
    const tooLarge = `data:image/jpeg;base64,${Buffer.alloc(1_500_001).toString('base64')}`;
    assert.equal((await request(`/api/vision/live/sessions/${sessionId}/frames`, {
      method: 'POST', headers: alice, body: JSON.stringify({ dataUrl: tooLarge }),
    })).status, 413);
    assert.equal((await request(`/api/vision/live/sessions/${sessionId}`, { method: 'DELETE', headers: alice })).status, 200);
    assert.equal((await request(`/api/vision/live/sessions/${sessionId}`, { headers: alice })).status, 404);
    const parallel = await Promise.all([1, 2, 3].map(() => request('/api/vision/live/sessions', { method: 'POST', headers: alice, body: '{}' })));
    assert.equal(parallel.filter((result) => result.status === 201).length, 2);
    assert.equal(parallel.filter((result) => result.status === 429).length, 1);
    const sessions = (await request('/api/vision/live/sessions', { headers: alice })).body.sessions;
    assert.equal(sessions.length, 2);
    const recoveredStore = await new JsonStore(config.runtimeFile).init();
    assert.equal(recoveredStore.state.liveSessions.length, 2);
    workerGoneId = sessions[0].session_id;
    const gone = await request(`/api/vision/live/sessions/${workerGoneId}`, { headers: alice });
    assert.equal(gone.status, 404);
    assert.equal(gone.body.error, 'live_session_gone');
    assert.equal((await request('/api/vision/live/sessions', { headers: alice })).body.sessions.length, 1);
    assert.ok(observed.some((entry) => entry.path === `/v1/live/sessions/${sessionId}/frames`));
    assert.ok(observed.some((entry) => entry.path === '/v1/live/sessions' && entry.method === 'POST'));
    assert.ok(observed.every((entry) => entry.authorization === 'Bearer private-worker-token'));
  } finally {
    if (app?.listening) await new Promise((resolve) => app.close(resolve));
    if (worker.listening) await new Promise((resolve) => worker.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
