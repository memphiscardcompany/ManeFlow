import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DurableScanJobSpool } from '../src/services/durable-scan-jobs.js';

function imageDataUrl(value = 'card-image') {
  return `data:image/jpeg;base64,${Buffer.from(value).toString('base64')}`;
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-scan-jobs-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function waitForJob(spool, ownerUserId, jobId, predicate, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = spool.getJob(ownerUserId, jobId, { limit: 250 });
    if (job && predicate(job)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for durable scan job state.');
}

test('durable scan jobs are owner scoped and idempotent at job and item boundaries', async (t) => {
  const rootDir = await temporaryDirectory(t);
  const processed = [];
  const spool = new DurableScanJobSpool({
    rootDir,
    concurrency: 2,
    retryBackoffMs: 100,
    processor: async (input) => {
      processed.push(input.itemKey);
      return { exact: false, matches: [], message: 'Review required' };
    },
  });
  await spool.initialize();

  const first = await spool.createJob({
    ownerUserId: 'user-a',
    idempotencyKey: 'folder-batch-001',
    expectedItems: 2,
  });
  const duplicateJob = await spool.createJob({
    ownerUserId: 'user-a',
    idempotencyKey: 'folder-batch-001',
    expectedItems: 2,
  });
  assert.equal(first.reused, false);
  assert.equal(duplicateJob.reused, true);
  assert.equal(duplicateJob.job.id, first.job.id);

  const firstItem = await spool.addItem('user-a', first.job.id, {
    itemKey: 'image-001',
    fileName: 'folder/front-001.jpg',
    dataUrl: imageDataUrl('one'),
  });
  const duplicateItem = await spool.addItem('user-a', first.job.id, {
    itemKey: 'image-001',
    fileName: 'folder/front-001.jpg',
    dataUrl: imageDataUrl('one'),
  });
  await spool.addItem('user-a', first.job.id, {
    itemKey: 'image-002',
    fileName: 'folder/front-002.jpg',
    dataUrl: imageDataUrl('two'),
  });
  assert.equal(firstItem.reused, false);
  assert.equal(duplicateItem.reused, true);
  assert.equal(spool.getJob('user-b', first.job.id), null);

  await spool.commit('user-a', first.job.id);
  const completed = await waitForJob(spool, 'user-a', first.job.id, (job) => job.status === 'complete');
  assert.equal(completed.progress.total, 2);
  assert.equal(completed.progress.complete, 2);
  assert.deepEqual(processed.sort(), ['image-001', 'image-002']);

  for (const item of completed.items) {
    await assert.rejects(fs.access(spool.payloadFile(first.job.id, item.id)));
  }
});

test('temporary failures retry once while permanent failures do not form a retry storm', async (t) => {
  const rootDir = await temporaryDirectory(t);
  const attempts = new Map();
  const spool = new DurableScanJobSpool({
    rootDir,
    concurrency: 1,
    maxAttempts: 2,
    retryBackoffMs: 100,
    processor: async ({ itemKey }) => {
      const count = (attempts.get(itemKey) || 0) + 1;
      attempts.set(itemKey, count);
      if (itemKey === 'temporary' && count === 1) {
        const error = new Error('Vision worker temporarily unavailable');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      if (itemKey === 'permanent') {
        const error = new Error('Unsupported card-image payload');
        error.code = 'UNSUPPORTED_INPUT';
        throw error;
      }
      return { message: 'done' };
    },
  });
  await spool.initialize();
  const created = await spool.createJob({ ownerUserId: 'user-a', idempotencyKey: 'retry-policy' });
  await spool.addItem('user-a', created.job.id, {
    itemKey: 'temporary', fileName: 'temporary.jpg', dataUrl: imageDataUrl('temporary'),
  });
  await spool.addItem('user-a', created.job.id, {
    itemKey: 'permanent', fileName: 'permanent.jpg', dataUrl: imageDataUrl('permanent'),
  });
  await spool.commit('user-a', created.job.id);

  const terminal = await waitForJob(spool, 'user-a', created.job.id, (job) => ['partial', 'failed'].includes(job.status));
  const temporary = terminal.items.find((item) => item.itemKey === 'temporary');
  const permanent = terminal.items.find((item) => item.itemKey === 'permanent');
  assert.equal(temporary.status, 'complete');
  assert.equal(temporary.attempts, 2);
  assert.equal(permanent.status, 'failed');
  assert.equal(permanent.attempts, 1);
  assert.equal(attempts.get('temporary'), 2);
  assert.equal(attempts.get('permanent'), 1);
});

test('queued jobs resume from disk after a process restart', async (t) => {
  const rootDir = await temporaryDirectory(t);
  const firstSpool = new DurableScanJobSpool({
    rootDir,
    processor: async () => ({ message: 'first process should not execute' }),
  });
  await firstSpool.initialize();
  const created = await firstSpool.createJob({ ownerUserId: 'user-a', idempotencyKey: 'restart-safe' });
  await firstSpool.addItem('user-a', created.job.id, {
    itemKey: 'restart-image', fileName: 'restart.jpg', dataUrl: imageDataUrl('restart'),
  });
  const internalJob = firstSpool.findOwned('user-a', created.job.id);
  internalJob.status = 'queued';
  internalJob.items[0].status = 'queued';
  internalJob.committedAt = new Date().toISOString();
  await firstSpool.persist(internalJob);

  let executions = 0;
  const restartedSpool = new DurableScanJobSpool({
    rootDir,
    processor: async () => {
      executions += 1;
      return { message: 'resumed' };
    },
  });
  await restartedSpool.initialize();
  const completed = await waitForJob(restartedSpool, 'user-a', created.job.id, (job) => job.status === 'complete');
  assert.equal(completed.progress.complete, 1);
  assert.equal(executions, 1);
});

test('invalid image payloads and oversized jobs fail before processing', async (t) => {
  const rootDir = await temporaryDirectory(t);
  const spool = new DurableScanJobSpool({
    rootDir,
    maxItems: 1,
    maxItemBytes: 1_024,
    processor: async () => ({ message: 'not reached' }),
  });
  await spool.initialize();
  const created = await spool.createJob({ ownerUserId: 'user-a', idempotencyKey: 'limits' });
  await assert.rejects(
    spool.addItem('user-a', created.job.id, {
      itemKey: 'bad-image', fileName: 'bad.gif', dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==',
    }),
    /JPEG, PNG, or WebP/,
  );
  await spool.addItem('user-a', created.job.id, {
    itemKey: 'valid-image', fileName: 'valid.jpg', dataUrl: imageDataUrl('valid'),
  });
  await assert.rejects(
    spool.addItem('user-a', created.job.id, {
      itemKey: 'second-image', fileName: 'second.jpg', dataUrl: imageDataUrl('second'),
    }),
    /at most 1 image/,
  );
});
