import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DurableScanJobSpool } from '../src/services/durable-scan-jobs.js';
import { hardenDurableScanJobSpool } from '../src/services/durable-scan-hardening.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZwgAAAABJRU5ErkJggg==',
  'base64',
);

function pngDataUrl(bytes = PNG) {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

async function spoolForTest(t, overrides = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-scan-hardening-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  const spool = hardenDurableScanJobSpool(new DurableScanJobSpool({
    rootDir,
    maxItems: 10,
    maxItemBytes: 1_000_000,
    concurrency: 1,
    maxAttempts: 2,
    retryBackoffMs: 100,
    processor: async () => ({ exact: false, needsConfirmation: true, matches: [] }),
    ...overrides,
  }));
  await spool.initialize();
  return spool;
}

test('hardening rejects MIME labels whose bytes are not the declared image type', async (t) => {
  const spool = await spoolForTest(t);
  const created = await spool.createJob({
    ownerUserId: 'user-a',
    idempotencyKey: 'signature-test',
    expectedItems: 1,
  });
  await assert.rejects(
    spool.addItem('user-a', created.job.id, {
      itemKey: 'fake-png',
      fileName: 'fake.png',
      mimeType: 'image/png',
      size: 12,
      dataUrl: `data:image/png;base64,${Buffer.from('not-a-png!!!').toString('base64')}`,
    }),
    (error) => error.code === 'SCAN_IMAGE_SIGNATURE_MISMATCH' && error.status === 415,
  );
});

test('same item key reuses identical bytes but rejects different image content', async (t) => {
  const spool = await spoolForTest(t);
  const created = await spool.createJob({
    ownerUserId: 'user-a',
    idempotencyKey: 'content-conflict',
    expectedItems: 1,
  });
  const first = await spool.addItem('user-a', created.job.id, {
    itemKey: 'image-001',
    fileName: 'card.png',
    mimeType: 'image/png',
    size: PNG.length,
    dataUrl: pngDataUrl(),
  });
  const duplicate = await spool.addItem('user-a', created.job.id, {
    itemKey: 'image-001',
    fileName: 'card.png',
    mimeType: 'image/png',
    size: PNG.length,
    dataUrl: pngDataUrl(),
  });
  assert.equal(first.reused, false);
  assert.equal(duplicate.reused, true);

  const changed = Buffer.concat([PNG, Buffer.from([0])]);
  await assert.rejects(
    spool.addItem('user-a', created.job.id, {
      itemKey: 'image-001',
      fileName: 'card.png',
      mimeType: 'image/png',
      size: changed.length,
      dataUrl: pngDataUrl(changed),
    }),
    (error) => error.code === 'SCAN_ITEM_ID_CONFLICT' && error.status === 409,
  );
});

test('a job cannot commit until every declared manifest item is stored', async (t) => {
  const spool = await spoolForTest(t);
  const created = await spool.createJob({
    ownerUserId: 'user-a',
    idempotencyKey: 'complete-manifest',
    expectedItems: 2,
  });
  await spool.addItem('user-a', created.job.id, {
    itemKey: 'image-001',
    fileName: 'first.png',
    mimeType: 'image/png',
    size: PNG.length,
    dataUrl: pngDataUrl(),
  });
  await assert.rejects(
    spool.commit('user-a', created.job.id),
    (error) => error.code === 'SCAN_JOB_UPLOAD_INCOMPLETE' && error.status === 409 && error.retryable === true,
  );
  const job = spool.getJob('user-a', created.job.id);
  assert.equal(job.status, 'accepting');
  assert.equal(job.progress.total, 1);
});

test('job creation rejects zero, fractional, and over-limit manifest counts', async (t) => {
  const spool = await spoolForTest(t, { maxItems: 3 });
  for (const expectedItems of [0, 1.5, 4]) {
    await assert.rejects(
      spool.createJob({
        ownerUserId: 'user-a',
        idempotencyKey: `invalid-${expectedItems}`,
        expectedItems,
      }),
      (error) => error.code === 'SCAN_JOB_ITEM_COUNT_INVALID' && error.status === 400,
    );
  }
});

test('owner deletion removes job metadata and private payload directories', async (t) => {
  const spool = await spoolForTest(t);
  const created = await spool.createJob({
    ownerUserId: 'user-a',
    idempotencyKey: 'delete-owner',
    expectedItems: 1,
  });
  await spool.addItem('user-a', created.job.id, {
    itemKey: 'image-001',
    fileName: 'private.png',
    mimeType: 'image/png',
    size: PNG.length,
    dataUrl: pngDataUrl(),
  });
  await fs.access(spool.jobDir(created.job.id));
  const removed = await spool.deleteOwnerJobs('user-a');
  assert.equal(removed, 1);
  assert.equal(spool.getJob('user-a', created.job.id), null);
  await assert.rejects(fs.access(spool.jobDir(created.job.id)));
});
