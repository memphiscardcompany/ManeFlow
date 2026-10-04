import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { VisionWorkerClient, workerCardToLegacyVision, workerScanToSceneAnalysis } from '../src/services/vision-worker-client.js';
import { recognizeCardScene } from '../src/services/recognition-engine.js';
import { parseRetryAfterMs } from '../src/services/vision-retry-policy.js';

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('vision worker client reads readiness and preserves safe errors', async () => {
  await withServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/readiness') return res.end(JSON.stringify({ status: 'ready' }));
    res.statusCode = 503;
    res.end(JSON.stringify({ detail: 'not configured' }));
  }, async (baseUrl) => {
    const client = new VisionWorkerClient({ baseUrl, timeoutMs: 2000 });
    assert.deepEqual(await client.readiness(), { status: 'ready' });
    await assert.rejects(() => client.health(), /not configured/);
  });
});

test('vision worker client sends image data URLs as multipart scans', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/scan');
    assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
    let bytes = 0;
    req.on('data', (chunk) => { bytes += chunk.length; });
    req.on('end', () => {
      assert.ok(bytes > 10);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ scan_id: 'scan-1', identity_confidence: 0 }));
    });
  }, async (baseUrl) => {
    const client = new VisionWorkerClient({ baseUrl, timeoutMs: 2000 });
    const result = await client.scanDataUrl('data:image/jpeg;base64,aGVsbG8=', { filename: 'scan.jpg' });
    assert.equal(result.scan_id, 'scan-1');
  });
});

test('retry policy supports numeric and HTTP-date Retry-After values', () => {
  const now = Date.UTC(2026, 7, 1, 12, 0, 0);
  assert.equal(parseRetryAfterMs('2', { now }), 2_000);
  assert.equal(parseRetryAfterMs(new Date(now + 5_000).toUTCString(), { now }), 5_000);
  assert.equal(parseRetryAfterMs('invalid', { now }), null);
  assert.equal(parseRetryAfterMs('90', { now }), 15_000);
});

test('vision worker scan retries a transient rate limit with a fresh body', async () => {
  let attempts = 0;
  const delays = [];
  const idempotencyKeys = new Set();

  await withServer((req, res) => {
    attempts += 1;
    idempotencyKeys.add(req.headers['x-maneflow-idempotency-key']);
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (attempts === 1) {
        res.statusCode = 429;
        res.setHeader('retry-after', '1');
        res.end(JSON.stringify({ detail: 'capacity limited' }));
        return;
      }
      res.end(JSON.stringify({ scan_id: 'scan-retried', identity_confidence: 0 }));
    });
  }, async (baseUrl) => {
    const client = new VisionWorkerClient({
      baseUrl,
      timeoutMs: 2000,
      maxRetries: 1,
      idempotencySecret: 'retry-test-scope',
      sleepFn: async (milliseconds) => { delays.push(milliseconds); },
    });
    const result = await client.scanDataUrl('data:image/jpeg;base64,aGVsbG8=');
    assert.equal(result.scan_id, 'scan-retried');
  });

  assert.equal(attempts, 2);
  assert.equal(idempotencyKeys.size, 1);
  assert.equal(delays.length, 1);
  assert.ok(delays[0] >= 900 && delays[0] <= 1_000);
});

test('vision worker scan single-flight shares identical concurrent work', async () => {
  let requests = 0;

  await withServer((req, res) => {
    requests += 1;
    req.resume();
    req.on('end', () => {
      setTimeout(() => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ scan_id: 'single-flight', identity_confidence: 0 }));
      }, 25);
    });
  }, async (baseUrl) => {
    const client = new VisionWorkerClient({ baseUrl, timeoutMs: 2000 });
    const [first, second] = await Promise.all([
      client.scanDataUrl('data:image/jpeg;base64,c2FtZS1pbWFnZQ=='),
      client.scanDataUrl('data:image/jpeg;base64,c2FtZS1pbWFnZQ=='),
    ]);
    assert.equal(first.scan_id, 'single-flight');
    assert.equal(second.scan_id, 'single-flight');
  });

  assert.equal(requests, 1);
});

test('vision worker idempotency keys are scoped and do not expose a stable raw image digest', async () => {
  const keys = [];

  await withServer((req, res) => {
    keys.push(req.headers['x-maneflow-idempotency-key']);
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ scan_id: `scan-${keys.length}`, identity_confidence: 0 }));
    });
  }, async (baseUrl) => {
    const firstClient = new VisionWorkerClient({
      baseUrl,
      timeoutMs: 2000,
      idempotencySecret: 'tenant-or-process-scope-a',
    });
    const secondClient = new VisionWorkerClient({
      baseUrl,
      timeoutMs: 2000,
      idempotencySecret: 'tenant-or-process-scope-b',
    });
    const image = 'data:image/jpeg;base64,c2FtZS1wcml2YXRlLWltYWdl';
    await firstClient.scanDataUrl(image);
    await secondClient.scanDataUrl(image);
  });

  assert.equal(keys.length, 2);
  assert.match(keys[0], /^[a-f0-9]{64}$/);
  assert.match(keys[1], /^[a-f0-9]{64}$/);
  assert.notEqual(keys[0], keys[1]);
});

test('worker card extraction maps into the legacy ManeFlow evidence contract', () => {
  const result = workerCardToLegacyVision({
    predicted_card: {
      player_name: 'Shohei Ohtani', year: 2018, brand: 'Topps', set_name: 'Update', card_number: 'US1',
    },
    identity_confidence: 0.91,
    detected_object_count: 1,
    detected_surface_type: 'SILVER_HOLOFRACTOR',
    refractor_confidence: 0.76,
    surface_analysis: { detected_surface_type: 'SILVER_HOLOFRACTOR', refractor_confidence: 0.76 },
    centering_assessment: { centering_lr: '55/45', centering_tb: '50/50', estimated_centering_score: 9.5 },
    warnings: ['Confirm parallel'],
  });
  assert.equal(result.facts.player, 'Shohei Ohtani');
  assert.equal(result.facts.cardNumber, 'US1');
  assert.equal(result.fieldConfidence.player, 0.91);
  assert.equal(result.physicalCardCount, 1);
  assert.equal(result.physicalCardDetected, true);
  assert.equal(result.cropQuality, 'single-card');
  assert.equal(result.facts.detectedSurfaceType, 'SILVER_HOLOFRACTOR');
  assert.equal(result.fieldConfidence.detectedSurfaceType, 0.76);
  assert.equal(result.surfaceAnalysis.refractor_confidence, 0.76);
  assert.equal(result.centeringAssessment.centering_lr, '55/45');
  assert.match(result.warnings[0], /parallel/);
});

test('one worker frame reaches catalog recognition as independent card regions', () => {
  const workerScan = {
    quality: { width: 1000, height: 800 },
    detected_cards: [
      { detection_index: 0, bounding_box_px: [50, 80, 300, 500], detection_confidence: 0.95,
        predicted_card: { player_name: 'Player Alpha', year: 2024, brand: 'Topps', set_name: 'Test Set', card_number: '1' },
        identity_confidence: 0.93, variant_confidence: 0, needs_manual_confirmation: true, visible_text: ['Player Alpha'] },
      { detection_index: 1, bounding_box_px: [600, 90, 300, 500], detection_confidence: 0.92,
        predicted_card: { player_name: 'Player Beta', year: 2023, brand: 'Panini', set_name: 'Other Set', card_number: '2' },
        identity_confidence: 0.94, variant_confidence: 0, needs_manual_confirmation: true, visible_text: ['Player Beta'] },
    ],
  };
  const sceneAnalysis = workerScanToSceneAnalysis(workerScan);
  const recognition = recognizeCardScene({
    cards: [
      { id: 'alpha', player: 'Player Alpha', year: 2024, brand: 'Topps', set: 'Test Set', cardNumber: '1' },
      { id: 'beta', player: 'Player Beta', year: 2023, brand: 'Panini', set: 'Other Set', cardNumber: '2' },
    ],
    body: { frontDataUrl: 'data:image/jpeg;base64,AAAA', ocrText: 'Player Alpha' },
    sceneAnalysis,
  });
  assert.equal(recognition.summary.detectedCards, 2);
  assert.deepEqual(recognition.items.map((item) => item.facts.player), ['Player Alpha', 'Player Beta']);
  assert.deepEqual(recognition.items.map((item) => item.boundingBox.x), [0.05, 0.6]);
  assert.ok(recognition.items.every((item) => item.requiresManualConfirmation && !item.exact));
  assert.equal(recognition.items[1].facts.visibleText.includes('Player Alpha'), false);
});

test('whole-image fallback cannot become a confirmed physical card region', () => {
  const sceneAnalysis = workerScanToSceneAnalysis({
    quality: { width: 100, height: 100 },
    detected_cards: [{ detection_index: 0, bounding_box_px: [0, 0, 100, 100], fallback_whole_image: true,
      predicted_card: { player_name: 'Unverified' }, identity_confidence: 0.99 }],
  });
  const recognition = recognizeCardScene({
    cards: [{ id: 'unverified', player: 'Unverified' }],
    body: { frontDataUrl: 'data:image/jpeg;base64,AAAA' },
    sceneAnalysis,
  });
  assert.equal(recognition.summary.detectedCards, 0);
  assert.equal(recognition.primary, null);
});

test('vision worker client lists and curates contributed examples', async () => {
  await withServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/v1/contributions/examples?limit=25&curation_status=pending') {
      return res.end(JSON.stringify([{ id: 'example-1', curation_status: 'pending' }]));
    }
    if (req.method === 'POST' && req.url === '/v1/contributions/examples/example-1/curate') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        assert.deepEqual(JSON.parse(body), { curation_status: 'approved', notes: 'verified' });
        res.end(JSON.stringify({ id: 'example-1', curation_status: 'approved' }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ detail: 'missing' }));
  }, async (baseUrl) => {
    const client = new VisionWorkerClient({ baseUrl, timeoutMs: 2000 });
    const examples = await client.listContributionExamples({ limit: 25, curationStatus: 'pending' });
    assert.equal(examples[0].id, 'example-1');
    const curated = await client.curateContributionExample('example-1', { curation_status: 'approved', notes: 'verified' });
    assert.equal(curated.curation_status, 'approved');
  });
});

test('vision worker client reads the approved dataset manifest', async () => {
  await withServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/v1/contributions/dataset-manifest') {
      return res.end(JSON.stringify({ summary: { approved_examples: 2, train: 2, validation: 0, test: 0 }, examples: [] }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ detail: 'missing' }));
  }, async (baseUrl) => {
    const client = new VisionWorkerClient({ baseUrl, timeoutMs: 2000 });
    const manifest = await client.contributionDatasetManifest();
    assert.equal(manifest.summary.approved_examples, 2);
  });
});
