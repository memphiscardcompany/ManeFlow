import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCropDag,
  classifyScanTaskFailure,
  deriveScanJobStatus,
  readyScanTasks,
  scanTaskIdempotencyKey,
  SCAN_TASK_STATUSES,
  SCAN_TASK_TYPES,
} from '../src/services/scan-dag.js';

const input = {
  jobId: 'job-1', assetId: 'asset-1', cropId: 'crop-1',
  inputSha256: 'a'.repeat(64), modelName: 'siglip2-so400m-naflex',
  modelVersion: '1', policyVersion: 'vision-dag-v1',
};

test('crop DAG runs OCR and embedding in parallel after normalization', () => {
  const tasks = buildCropDag(input);
  const normalize = tasks.find((entry) => entry.type === SCAN_TASK_TYPES.NORMALIZE_CROP);
  assert.deepEqual(readyScanTasks(tasks).map((entry) => entry.type), [SCAN_TASK_TYPES.NORMALIZE_CROP]);
  normalize.status = SCAN_TASK_STATUSES.COMPLETE;
  assert.deepEqual(
    readyScanTasks(tasks).map((entry) => entry.type).sort(),
    [SCAN_TASK_TYPES.EMBED, SCAN_TASK_TYPES.OCR].sort(),
  );
});

test('retrieval waits for embeddings and reranking waits for OCR plus retrieval', () => {
  const tasks = buildCropDag(input);
  for (const entry of tasks) {
    if ([SCAN_TASK_TYPES.NORMALIZE_CROP, SCAN_TASK_TYPES.OCR, SCAN_TASK_TYPES.EMBED].includes(entry.type)) entry.status = SCAN_TASK_STATUSES.COMPLETE;
  }
  assert.deepEqual(readyScanTasks(tasks).map((entry) => entry.type), [SCAN_TASK_TYPES.RETRIEVE]);
  tasks.find((entry) => entry.type === SCAN_TASK_TYPES.RETRIEVE).status = SCAN_TASK_STATUSES.COMPLETE;
  assert.deepEqual(readyScanTasks(tasks).map((entry) => entry.type), [SCAN_TASK_TYPES.RERANK]);
});

test('idempotency key changes when model or policy changes', () => {
  const base = scanTaskIdempotencyKey({ ...input, taskType: 'embed', scopeType: 'crop', scopeId: input.cropId });
  const changedModel = scanTaskIdempotencyKey({ ...input, modelVersion: '2', taskType: 'embed', scopeType: 'crop', scopeId: input.cropId });
  const changedPolicy = scanTaskIdempotencyKey({ ...input, policyVersion: 'vision-dag-v2', taskType: 'embed', scopeType: 'crop', scopeId: input.cropId });
  assert.match(base, /^[a-f0-9]{64}$/);
  assert.notEqual(base, changedModel);
  assert.notEqual(base, changedPolicy);
});

test('job status reflects active DAG stage and terminal review', () => {
  const tasks = buildCropDag(input);
  assert.equal(deriveScanJobStatus(tasks), 'normalizing');
  tasks.find((entry) => entry.type === SCAN_TASK_TYPES.NORMALIZE_CROP).status = SCAN_TASK_STATUSES.COMPLETE;
  assert.equal(deriveScanJobStatus(tasks), 'parallel_evidence');
  tasks.find((entry) => entry.type === SCAN_TASK_TYPES.OCR).status = SCAN_TASK_STATUSES.DEAD_LETTER;
  assert.equal(deriveScanJobStatus(tasks), 'review');
});

test('task failure classifier retries only known transient failures', () => {
  assert.deepEqual(classifyScanTaskFailure({ statusCode: 429, message: 'rate limit' }), { code: 'RATE_LIMITED', retryable: true, backoffClass: 'provider' });
  assert.deepEqual(classifyScanTaskFailure({ message: 'CUDA out of memory' }), { code: 'GPU_OOM', retryable: true, backoffClass: 'smaller_batch' });
  assert.deepEqual(classifyScanTaskFailure({ statusCode: 413, message: 'payload too large' }), { code: 'PAYLOAD_TOO_LARGE', retryable: false, backoffClass: null });
  assert.equal(classifyScanTaskFailure(new Error('unknown')).retryable, false);
});
