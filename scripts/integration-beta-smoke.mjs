import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maneflow-beta-integration-'));
const workerData = path.join(temp, 'worker-data');
const scanFolder = path.join(temp, 'ricoh-scans');
fs.mkdirSync(workerData, { recursive: true });
fs.mkdirSync(scanFolder, { recursive: true });

// Valid tiny PNG. The integration test exercises transport, storage, pairing,
// corrections, consent, and curation rather than recognition accuracy.
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wlq3ZsAAAAASUVORK5CYII=',
  'base64',
);
fs.writeFileSync(path.join(scanFolder, 'scan-0001-front.png'), tinyPng);
fs.writeFileSync(path.join(scanFolder, 'scan-0001-back.png'), tinyPng);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, timeoutMs = 30_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body instanceof FormData
      ? { ...(options.headers || {}) }
      : { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url}: ${payload.message || payload.detail || response.status}`);
  return payload;
}

function stop(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch {}
}

const workerPort = await freePort();
const corePort = await freePort();
const workerBase = `http://127.0.0.1:${workerPort}`;
const coreBase = `http://127.0.0.1:${corePort}`;
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
let worker;
let core;

try {
  worker = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(workerPort), '--log-level', 'warning'],
    {
      cwd: path.join(root, 'vision-worker'),
      env: {
        ...process.env,
        MANEFLOW_DATA_DIR: workerData,
        DEV_DATABASE_PATH: path.join(workerData, 'integration.sqlite3'),
        OPENAI_API_KEY: '',
        PSA_API_KEY: '',
        EBAY_CLIENT_ID: '',
        EBAY_CLIENT_SECRET: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await waitFor(`${workerBase}/health`);

  core = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(corePort),
      PUBLIC_BASE_URL: coreBase,
      RELEASE_CHANNEL: 'integration-beta',
      MANEFLOW_DEMO_MODE: 'true',
      MANEFLOW_ALLOW_GUEST_WRITES: 'true',
      MANEFLOW_DATA_DIR: path.join(temp, 'core-data'),
      MANEFLOW_STATE_FILE: path.join(temp, 'core-state.json'),
      MANEFLOW_VISION_WORKER_URL: workerBase,
      OPENAI_API_KEY: '',
      PSA_API_KEY: '',
      EBAY_CLIENT_ID: '',
      EBAY_CLIENT_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitFor(`${coreBase}/healthz`);

  const status = await jsonRequest(`${coreBase}/api/vision/status`);
  assert.equal(status.connected, true);

  const contributorPayload = await jsonRequest(`${coreBase}/api/bulk-intake/contributors`, {
    method: 'POST',
    body: JSON.stringify({ display_name: 'Integration beta', consent_scope: 'labels_only' }),
  });
  const contributorId = contributorPayload.contributor.contributor_id || contributorPayload.contributor.id;
  assert.ok(contributorId);

  const imported = await jsonRequest(`${coreBase}/api/bulk-intake/ricoh/import-folder`, {
    method: 'POST',
    body: JSON.stringify({
      folder_path: scanFolder,
      batch_name: 'Integration Ricoh batch',
      contributor_id: contributorId,
      scanner_model: 'Ricoh integration fixture',
      pairing_strategy: 'filename',
      process_immediately: false,
    }),
  });
  assert.equal(imported.batch.item_count, 1);
  const itemId = imported.batch.items[0].id;

  await jsonRequest(`${coreBase}/api/bulk-intake/items/${encodeURIComponent(itemId)}/review`, {
    method: 'POST',
    body: JSON.stringify({
      review_status: 'corrected',
      confirmed_fields: {
        player_name: 'Integration Player',
        year: 2026,
        brand: 'ManeFlow',
        set_name: 'Beta Integration',
        card_number: 'INT-1',
        acquisition_cost: 999.99,
      },
    }),
  });

  const pending = await jsonRequest(`${coreBase}/api/contributions/examples?curation_status=pending&limit=20`);
  assert.equal(pending.examples.length, 1);
  assert.equal(pending.examples[0].label.player_name, 'Integration Player');
  assert.equal(Object.hasOwn(pending.examples[0].label, 'acquisition_cost'), false);

  const curated = await jsonRequest(
    `${coreBase}/api/contributions/examples/${encodeURIComponent(pending.examples[0].id)}/curate`,
    {
      method: 'POST',
      body: JSON.stringify({ curation_status: 'approved', notes: 'Integration verified' }),
    },
  );
  assert.equal(curated.example.curation_status, 'approved');

  const stats = await jsonRequest(`${coreBase}/api/contributions/stats`);
  assert.equal(stats.approved_examples, 1);
  assert.equal(stats.curation_pending, 0);

  console.log('ManeFlow integrated beta smoke passed: core + worker + Ricoh + consent + curation.');
} finally {
  stop(core);
  stop(worker);
  await new Promise((resolve) => setTimeout(resolve, 400));
  fs.rmSync(temp, { recursive: true, force: true });
}
