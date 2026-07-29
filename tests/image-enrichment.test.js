import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/services/store.js';
import { imageCoverageReport, ingestImageEnrichment, rollbackImageEnrichmentBatch, validateImageEnrichmentRows } from '../src/services/image-enrichment.js';
import { attachCardImage } from '../src/services/card-images.js';

const card = {
  id: 'card_test_1',
  year: 2026,
  brand: 'Topps',
  set: 'Chrome Baseball',
  player: 'Test Player',
  cardNumber: '101',
  parallel: 'Base',
  sport: 'Baseball',
};

async function withStore(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-image-enrichment-'));
  const store = await new JsonStore(path.join(directory, 'state.json')).init();
  try { return await fn(store); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('image enrichment validates allowed hosts and rejects unapproved image URLs', () => {
  const result = validateImageEnrichmentRows([
    { cardId: card.id, imageUrl: 'https://i.ebayimg.com/images/g/example/s-l500.jpg' },
    { cardId: card.id, imageUrl: 'https://bad.example.com/card.jpg' },
  ], {
    cards: [card],
    source: { provider: 'eBay API', authorizationBasis: 'ebay_api', sourceMode: 'production' },
  });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].error, /allowed image source/i);
});

test('image enrichment dry-run previews coverage without writing overrides', async () => withStore(async (store) => {
  const result = await ingestImageEnrichment({
    rows: [{ cardId: card.id, imageUrl: 'https://i.ebayimg.com/images/g/example/s-l500.jpg' }],
    cards: [card],
    sales: [],
    store,
    source: { provider: 'eBay API', authorizationBasis: 'ebay_api', sourceMode: 'production' },
    dryRun: true,
  });
  assert.equal(result.dryRun, true);
  assert.equal(Object.keys(store.state.cardImageOverrides || {}).length, 0);
  assert.equal(result.coverageBefore.cardsWithPlaceholder, 1);
  assert.equal(result.coverageAfter.cardsWithImages, 1);
}));

test('image enrichment import and rollback affect resolved card images', async () => withStore(async (store) => {
  const result = await ingestImageEnrichment({
    rows: [{ cardId: card.id, imageUrl: 'https://i.ebayimg.com/images/g/example/s-l500.jpg' }],
    cards: [card],
    sales: [],
    store,
    source: { provider: 'eBay API', authorizationBasis: 'ebay_api', sourceMode: 'production', providerBatchId: 'batch_images_1' },
    actor: { userId: 'admin', role: 'admin' },
    dryRun: false,
  });
  assert.equal(result.result.added, 1);
  const enriched = attachCardImage(card, {}, { imageOverrides: store.state.cardImageOverrides });
  assert.equal(enriched.imageMeta.status, 'image_enrichment_override');
  assert.equal(enriched.image, 'https://i.ebayimg.com/images/g/example/s-l500.jpg');
  const coverage = imageCoverageReport({ cards: [card], overrides: store.state.cardImageOverrides });
  assert.equal(coverage.overrideImageCount, 1);

  const rollback = await rollbackImageEnrichmentBatch(store, 'batch_images_1', { actor: { userId: 'admin' }, reason: 'test rollback' });
  assert.equal(rollback.removed, 1);
  const after = attachCardImage(card, {}, { imageOverrides: store.state.cardImageOverrides });
  assert.equal(after.imageMeta.placeholder, true);
}));
