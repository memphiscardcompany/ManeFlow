import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdaptiveConcurrencyController,
  runAdaptiveBatch,
} from '../src/services/adaptive-batch-scheduler.js';
import {
  VisionWorkerClient,
  classifyWorkerScanResult,
} from '../src/services/vision-worker-client.js';

test('adaptive concurrency uses additive increase and multiplicative decrease', () => {
  const controller = new AdaptiveConcurrencyController({
    initialConcurrency: 4,
    minimumConcurrency: 1,
    maximumConcurrency: 8,
    healthyWindow: 2,
  });

  assert.equal(controller.currentConcurrency, 4);
  controller.recordSuccess();
  assert.equal(controller.currentConcurrency, 4);
  controller.recordSuccess();
  assert.equal(controller.currentConcurrency, 5);

  const error = new Error('rate limited');
  error.status = 429;
  controller.recordFault(error);
  assert.equal(controller.currentConcurrency, 2);
  assert.equal(controller.snapshot().backoff_events, 1);

  controller.recordMemoryPressure();
  assert.equal(controller.currentConcurrency, 1);
});

test('adaptive batch accounts for every source and preserves input order', async () => {
  const items = [
    { sourceId: 'one', kind: 'detected' },
    { sourceId: 'two', kind: 'review' },
    { sourceId: 'three', kind: 'no-card' },
    { sourceId: 'four', kind: 'insufficient' },
  ];
  const summaries = [];
  const result = await runAdaptiveBatch({
    items,
    queueGenerationId: 'generation-test',
    controller: new AdaptiveConcurrencyController({ initialConcurrency: 2 }),
    worker: async (item) => ({ kind: item.kind }),
    classifyResult: (payload) => ({
      terminalState: {
        detected: 'detected',
        review: 'review_required',
        'no-card': 'rejected_no_card',
        insufficient: 'insufficient_evidence',
      }[payload.kind],
      result: payload,
    }),
    onProgress: (summary) => summaries.push(summary),
  });

  assert.equal(result.queue_generation_id, 'generation-test');
  assert.equal(result.source_image_count, 4);
  assert.equal(result.processed_count, 4);
  assert.equal(result.detected_count, 1);
  assert.equal(result.review_required_count, 1);
  assert.equal(result.rejected_count, 1);
  assert.equal(result.insufficient_evidence_count, 1);
  assert.equal(result.unresolved_count, 2);
  assert.equal(result.silently_dropped_sources, 0);
  assert.equal(result.scene_complete, true);
  assert.deepEqual(result.sources.map((source) => source.source_id), ['one', 'two', 'three', 'four']);
  assert.ok(summaries.some((summary) => summary.active_count > 0));
});

test('stop-after-current preserves completed work and cancels queued sources', async () => {
  let stop = false;
  const result = await runAdaptiveBatch({
    items: ['first', 'second', 'third'],
    controller: new AdaptiveConcurrencyController({
      initialConcurrency: 1,
      minimumConcurrency: 1,
      maximumConcurrency: 1,
    }),
    shouldStop: () => stop,
    worker: async () => {
      stop = true;
      return { ok: true };
    },
    classifyResult: (payload) => ({ terminalState: 'detected', result: payload }),
  });

  assert.equal(result.detected_count, 1);
  assert.equal(result.canceled_count, 2);
  assert.equal(result.processed_count, 3);
  assert.equal(result.silently_dropped_sources, 0);
  assert.equal(result.scene_complete, true);
});

test('adaptive batch records retryable and permanent failures without dropping sources', async () => {
  const result = await runAdaptiveBatch({
    items: [{ type: 'transient' }, { type: 'permanent' }],
    controller: new AdaptiveConcurrencyController({ initialConcurrency: 2 }),
    worker: async (item) => {
      const error = new Error(item.type);
      if (item.type === 'transient') error.status = 503;
      else error.status = 400;
      throw error;
    },
    classifyResult: () => ({ terminalState: 'detected' }),
  });

  assert.equal(result.retryable_failed_count, 1);
  assert.equal(result.permanent_failed_count, 1);
  assert.equal(result.failed_count, 2);
  assert.equal(result.processed_count, 2);
  assert.equal(result.scene_complete, true);
});

test('worker scan classifier separates exact candidates, review, no-card, and insufficient evidence', () => {
  assert.equal(classifyWorkerScanResult({
    detected_object_count: 1,
    identity_confidence: 0.92,
    predicted_card: { player_name: 'Shohei Ohtani', card_number: 'US1' },
  }).terminalState, 'detected');

  assert.equal(classifyWorkerScanResult({
    detected_object_count: 1,
    identity_confidence: 0.4,
    predicted_card: {},
  }).terminalState, 'review_required');

  assert.equal(classifyWorkerScanResult({
    detected_object_count: 0,
    pipeline_state: 'no_card',
  }).terminalState, 'rejected_no_card');

  assert.equal(classifyWorkerScanResult({
    detected_object_count: 0,
  }).terminalState, 'insufficient_evidence');
});

test('VisionWorkerClient scanDataUrls exposes progressive source-accounted results', async () => {
  const client = new VisionWorkerClient({ nowFn: (() => {
    let value = 1_000;
    return () => value += 5;
  })() });

  client.scanDataUrl = async (dataUrl, { onTransientFault } = {}) => {
    if (dataUrl.endsWith('fault')) {
      const fault = new Error('temporary capacity');
      fault.status = 429;
      onTransientFault?.(fault);
      return {
        detected_object_count: 1,
        identity_confidence: 0.4,
        predicted_card: {},
      };
    }
    if (dataUrl.endsWith('exact')) {
      return {
        detected_object_count: 1,
        identity_confidence: 0.95,
        predicted_card: { player_name: 'Shohei Ohtani', card_number: '1' },
      };
    }
    if (dataUrl.endsWith('no-card')) {
      return { detected_object_count: 0, pipeline_state: 'no_card' };
    }
    return { detected_object_count: 0 };
  };

  const progress = [];
  const result = await client.scanDataUrls([
    { sourceId: 'exact', dataUrl: 'data:exact', filename: 'exact.jpg' },
    { sourceId: 'fault', dataUrl: 'data:fault', filename: 'fault.jpg' },
    { sourceId: 'none', dataUrl: 'data:no-card', filename: 'none.jpg' },
    { sourceId: 'weak', dataUrl: 'data:weak', filename: 'weak.jpg' },
  ], {
    initialConcurrency: 4,
    healthyWindow: 20,
    queueGenerationId: 'queue-18',
    onProgress: (summary) => progress.push(summary),
  });

  assert.equal(result.queue_generation_id, 'queue-18');
  assert.equal(result.detected_count, 1);
  assert.equal(result.review_required_count, 1);
  assert.equal(result.rejected_count, 1);
  assert.equal(result.insufficient_evidence_count, 1);
  assert.equal(result.processed_count, 4);
  assert.equal(result.silently_dropped_sources, 0);
  assert.equal(result.scene_complete, true);
  assert.equal(result.scheduler.current_concurrency, 2);
  assert.ok(progress.length >= 5);
});
