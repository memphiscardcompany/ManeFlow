import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VisionWorkerClient } from '../src/services/vision-worker-client.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('vision worker client submits authorized eBay lot analysis fields', async () => {
  const oldFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, options = {}) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ job_id: 'lot-1', status: 'completed' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const client = new VisionWorkerClient({ baseUrl: 'http://127.0.0.1:8741' });
    const result = await client.analyzeEbayListing({
      sourceUrl: 'https://www.ebay.com/itm/1234567890',
      listingPriceOverride: 425,
      inboundShippingOverride: 18,
      salesTax: 0,
      targetRoi: 0.25,
    });
    assert.equal(result.status, 'completed');
    assert.equal(captured.url, 'http://127.0.0.1:8741/v1/lots/analyze-ebay');
    assert.equal(captured.options.method, 'POST');
    assert.equal(captured.options.body.get('source_url'), 'https://www.ebay.com/itm/1234567890');
    assert.equal(captured.options.body.get('listing_price_override'), '425');
    assert.equal(captured.options.body.get('target_roi'), '0.25');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('desktop and mobile clients expose the lot opportunity workflow', () => {
  const web = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const mobile = fs.readFileSync(path.join(root, 'apps', 'mobile-expo', 'App.tsx'), 'utf8');
  assert.match(html, /href="#\/lots"/);
  assert.match(web, /async function renderLots\(\)/);
  assert.match(web, /\/api\/vision\/lot-analyze-ebay/);
  assert.match(mobile, /type Tab = .*'lot'/);
  assert.match(mobile, /function Lot\(\)/);
  assert.match(mobile, /Analyze lot opportunity/);
});
