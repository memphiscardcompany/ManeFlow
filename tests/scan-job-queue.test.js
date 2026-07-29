import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createScanJobRouter } from '../src/scan-job-router.js';
import { ScanJobError, ScanJobQueue } from '../src/services/scan-job-queue.js';
import { hashSessionToken } from '../src/services/auth.js';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZwgAAAABJRU5ErkJggg==',
  'base64',
);

function pngDataUrl(bytes = PNG_BYTES) {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function createStore(initialJobs = []) {
  return {
    state: { scanJobs: structuredClone(initialJobs) },
    persistCount: 0,
    recordedScans: [],
    async persist() { this.persistCount += 1; },
    async recordScan(userId, input) {
      this.recordedScans.push({ userId, ...structuredClone(input) });
      return { id: `scan-${this.recordedScans.length}` };
    },
  };
}

async function createQueue(t, processor, options = {}, initialJobs = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-scan-job-'));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  const store = createStore(initialJobs);
  const queue = await new ScanJobQueue({
    store,
    uploadDirectory: directory,
    processor,
    concurrentJobs: 1,
    concurrentItems: 2,
    retryBaseDelayMs: 100,
    ...options,
  }).init();
  t.after(async () => queue.close());
  return { queue, store, directory };
}

async function waitForTerminal(queue, userId, jobId, timeoutMs = 4_000) {
  const startedAt = Date.now();
  for (;;) {
    const job = queue.getJob(userId, jobId, { includeItems: true, limit: 200 });
    if (['complete', 'partial', 'failed', 'cancelled'].includes(job.status)) return job;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for ${jobId}; status=${job.status}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function successfulResult(name = 'Draft card') {
  return {
    exact: false,
    needsConfirmation: true,
    mode: 'durable_scan_job',
    query: name,
    message: 'Human confirmation required.',
    matches: [{ id: 'candidate-1', player: name }],
    recognition: { summary: { detectedCards: 1 }, cards: [] },
    scanConfidence: { scanConfidenceScore: 63, warnings: ['Confirm exact variant.'] },
  };
}

test('durable scan jobs process a complete manifest and remove temporary source bytes', async (t) => {
  const { queue, store } = await createQueue(t, async ({ fileName }) => successfulResult(fileName));
  queue.start();
  const created = await queue.createJob('user-a', {
    clientJobId: 'manifest-a',
    totalItems: 2,
    autoStart: true,
  });
  await queue.addItem('user-a', created.job.id, {
    clientItemId: 'item-a',
    index: 0,
    fileName: 'folder/front.png',
    dataUrl: pngDataUrl(),
  });
  let accepting = queue.getJob('user-a', created.job.id);
  assert.equal(accepting.status, 'accepting');
  assert.equal(accepting.uploadedCount, 1);

  await queue.addItem('user-a', created.job.id, {
    clientItemId: 'item-b',
    index: 1,
    fileName: 'folder/back.png',
    dataUrl: pngDataUrl(Buffer.concat([PNG_BYTES, Buffer.from([0])])),
  });
  const final = await waitForTerminal(queue, 'user-a', created.job.id);
  assert.equal(final.status, 'complete');
  assert.equal(final.succeededCount, 2);
  assert.equal(final.failedCount, 0);
  assert.equal(final.items[0].result.needsConfirmation, true);
  assert.equal(store.recordedScans.length, 2);
  assert.deepEqual(new Set(store.recordedScans.map((entry) => entry.userId)), new Set(['user-a']));

  const rawJob = store.state.scanJobs.find((job) => job.id === created.job.id);
  assert.ok(rawJob.items.every((item) => item.sourcePath === null));
});

test('client job and item identifiers are idempotent while content conflicts fail closed', async (t) => {
  const { queue } = await createQueue(t, async () => successfulResult(), { retainUploads: true });
  const first = await queue.createJob('user-a', {
    clientJobId: 'stable-manifest',
    totalItems: 1,
    autoStart: false,
  });
  const repeatedJob = await queue.createJob('user-a', {
    clientJobId: 'stable-manifest',
    totalItems: 1,
    autoStart: false,
  });
  assert.equal(repeatedJob.reused, true);
  assert.equal(repeatedJob.job.id, first.job.id);

  const firstItem = await queue.addItem('user-a', first.job.id, {
    clientItemId: 'stable-image',
    index: 0,
    fileName: 'card.png',
    dataUrl: pngDataUrl(),
  });
  const repeatedItem = await queue.addItem('user-a', first.job.id, {
    clientItemId: 'stable-image',
    index: 0,
    fileName: 'card.png',
    dataUrl: pngDataUrl(),
  });
  assert.equal(firstItem.reused, false);
  assert.equal(repeatedItem.reused, true);
  assert.equal(repeatedItem.item.sha256, firstItem.item.sha256);

  await assert.rejects(
    queue.addItem('user-a', first.job.id, {
      clientItemId: 'stable-image',
      index: 0,
      fileName: 'changed.png',
      dataUrl: pngDataUrl(Buffer.concat([PNG_BYTES, Buffer.from([1])])),
    }),
    (error) => error instanceof ScanJobError && error.code === 'SCAN_ITEM_ID_CONFLICT' && error.status === 409,
  );
});

test('temporary processing failures retry only within the configured bound', async (t) => {
  let calls = 0;
  const { queue } = await createQueue(t, async () => {
    calls += 1;
    if (calls < 3) {
      const error = new Error('Provider rate limited');
      error.code = 'PROVIDER_RATE_LIMIT';
      error.status = 429;
      error.retryable = true;
      throw error;
    }
    return successfulResult('Recovered card');
  }, { maximumRetries: 2 });
  queue.start();
  const created = await queue.createJob('user-a', { clientJobId: 'retry-manifest', totalItems: 1 });
  await queue.addItem('user-a', created.job.id, {
    clientItemId: 'retry-image',
    fileName: 'retry.png',
    dataUrl: pngDataUrl(),
  });
  const final = await waitForTerminal(queue, 'user-a', created.job.id);
  assert.equal(final.status, 'complete');
  assert.equal(final.items[0].attempts, 3);
  assert.equal(calls, 3);
});

test('permanent processing rejection is never multiplied into a retry storm', async (t) => {
  let calls = 0;
  const { queue } = await createQueue(t, async () => {
    calls += 1;
    const error = new Error('Unsupported image');
    error.code = 'UNSUPPORTED_IMAGE';
    error.status = 415;
    error.retryable = false;
    throw error;
  }, { maximumRetries: 5 });
  queue.start();
  const created = await queue.createJob('user-a', { clientJobId: 'permanent-manifest', totalItems: 1 });
  await queue.addItem('user-a', created.job.id, {
    clientItemId: 'permanent-image',
    fileName: 'bad.png',
    dataUrl: pngDataUrl(),
  });
  const final = await waitForTerminal(queue, 'user-a', created.job.id);
  assert.equal(final.status, 'failed');
  assert.equal(final.items[0].attempts, 1);
  assert.equal(final.items[0].error.code, 'UNSUPPORTED_IMAGE');
  assert.equal(calls, 1);
});

test('jobs and item records are isolated by authenticated owner', async (t) => {
  const { queue } = await createQueue(t, async () => successfulResult(), { retainUploads: true });
  const created = await queue.createJob('user-a', { clientJobId: 'private-manifest', totalItems: 1, autoStart: false });
  assert.throws(
    () => queue.getJob('user-b', created.job.id),
    (error) => error instanceof ScanJobError && error.code === 'SCAN_JOB_NOT_FOUND' && error.status === 404,
  );
  assert.deepEqual(queue.listJobs('user-b'), []);
});

test('initialization recovers interrupted processing without fabricating completion', async (t) => {
  const timestamp = new Date().toISOString();
  const initialJobs = [{
    id: 'scan_job_interrupted',
    userId: 'user-a',
    clientJobId: 'interrupted-manifest',
    status: 'processing',
    totalItems: 1,
    uploadedCount: 1,
    processedCount: 0,
    succeededCount: 0,
    failedCount: 0,
    cancelledCount: 0,
    autoStart: true,
    cancelRequested: false,
    items: [{
      id: 'scan_item_interrupted',
      clientItemId: 'interrupted-image',
      index: 0,
      fileName: 'interrupted.png',
      mimeType: 'image/png',
      byteLength: PNG_BYTES.length,
      sha256: 'not-processed',
      sourcePath: null,
      status: 'processing',
      attempts: 1,
      result: null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    }],
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    completedAt: null,
    lastError: null,
  }];
  const { queue } = await createQueue(t, async () => successfulResult(), {}, initialJobs);
  const recovered = queue.getJob('user-a', 'scan_job_interrupted', { includeItems: true });
  assert.equal(recovered.status, 'queued');
  assert.equal(recovered.items[0].status, 'queued');
  assert.equal(recovered.processedCount, 0);
  assert.equal(recovered.lastError.code, 'SCAN_JOB_RECOVERED_AFTER_RESTART');
});

function mockResponse() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = String(body);
      this.writableEnded = true;
    },
  };
}

function request({ token = '', method = 'GET', url = '/api/scan-jobs', body = null } = {}) {
  const req = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  return req;
}

test('the authenticated API refuses to start an incomplete manifest', async () => {
  const token = 'test-session-token';
  const tokenHash = hashSessionToken(token);
  const user = {
    id: 'user-a',
    email: 'owner@example.test',
    role: 'admin',
    plan: 'enterprise',
    emailVerifiedAt: new Date().toISOString(),
  };
  const store = {
    state: { scanJobs: [] },
    findSession(value) { return value === tokenHash ? { userId: user.id } : null; },
    findUserById(value) { return value === user.id ? user : null; },
    userSnapshot() { return { scanHistory: [] }; },
  };
  let startCalled = false;
  const queue = {
    getJob() {
      return { id: 'job-a', status: 'accepting', uploadedCount: 1, totalItems: 2 };
    },
    async startJob() { startCalled = true; },
  };
  const router = createScanJobRouter({
    config: {
      publicBaseUrl: 'https://app.example.test',
      allowedOrigins: [],
      csrfProtection: true,
      requireEmailVerification: true,
    },
    store,
    queue,
  });
  const res = mockResponse();
  const handled = await router(request({
    token,
    method: 'POST',
    url: '/api/scan-jobs/job-a/start',
    body: {},
  }), res);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).error, 'SCAN_JOB_UPLOAD_INCOMPLETE');
  assert.equal(startCalled, false);
});
