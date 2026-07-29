import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { VisionWorkerClient, workerCardToLegacyVision } from '../src/services/vision-worker-client.js';

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

test('worker card extraction maps into the legacy ManeFlow evidence contract', () => {
  const result = workerCardToLegacyVision({
    predicted_card: {
      player_name: 'Shohei Ohtani', year: 2018, brand: 'Topps', set_name: 'Update', card_number: 'US1',
    },
    identity_confidence: 0.91,
    detected_surface_type: 'SILVER_HOLOFRACTOR',
    refractor_confidence: 0.76,
    surface_analysis: { detected_surface_type: 'SILVER_HOLOFRACTOR', refractor_confidence: 0.76 },
    centering_assessment: { centering_lr: '55/45', centering_tb: '50/50', estimated_centering_score: 9.5 },
    warnings: ['Confirm parallel'],
  });
  assert.equal(result.facts.player, 'Shohei Ohtani');
  assert.equal(result.facts.cardNumber, 'US1');
  assert.equal(result.fieldConfidence.player, 0.91);
  assert.equal(result.facts.detectedSurfaceType, 'SILVER_HOLOFRACTOR');
  assert.equal(result.fieldConfidence.detectedSurfaceType, 0.76);
  assert.equal(result.surfaceAnalysis.refractor_confidence, 0.76);
  assert.equal(result.centeringAssessment.centering_lr, '55/45');
  assert.match(result.warnings[0], /parallel/);
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
