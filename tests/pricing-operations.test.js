import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeCatalogCard } from '../src/services/catalog.js';
import { ingestPricingData, rollbackPricingBatch } from '../src/services/pricing-data.js';
import { JsonStore } from '../src/services/store.js';

const card = normalizeCatalogCard({
  id: 'card_judge_gold', player: 'Aaron Judge', year: 2022, brand: 'Topps', set: 'Chrome', cardNumber: '99', parallel: 'Gold', sport: 'Baseball', grade: 'PSA 10',
});

function sale(overrides = {}) {
  return {
    provider: 'Shop Authorized CSV',
    authorizationBasis: 'user_csv',
    sourceMode: 'production',
    rawProviderId: 'judge-sale-1',
    title: '2022 Topps Chrome Aaron Judge 99 Gold PSA 10',
    soldAt: '2026-07-10T00:00:00Z',
    price: 250,
    shipping: 7,
    saleType: 'fixed_price',
    listingType: 'completed',
    isCompletedSale: true,
    player: 'Aaron Judge',
    year: 2022,
    brand: 'Topps',
    set: 'Chrome',
    cardNumber: '99',
    parallel: 'Gold',
    grader: 'PSA',
    grade: '10',
    cardId: card.id,
    verified: true,
    confidence: 0.94,
    ...overrides,
  };
}

async function makeStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-pricing-ops-'));
  const store = await new JsonStore(path.join(dir, 'state.json')).init();
  return { store, dir };
}

test('pricing ingestion persists scored comp quality fields', async () => {
  const { store, dir } = await makeStore();
  const result = await ingestPricingData({
    rows: [sale()],
    cards: [card],
    store,
    source: { provider: 'Shop Authorized CSV', authorizationBasis: 'user_csv', sourceMode: 'production' },
    actor: { userId: 'admin' },
    config: { demoMode: false },
    now: new Date('2026-07-21T00:00:00Z'),
  });
  assert.equal(result.result.added, 1);
  assert.equal(store.state.customSales[0].inclusionStatus, 'included');
  assert.equal(store.state.customSales[0].valuationUse, true);
  assert.ok(store.state.customSales[0].publicExplanation.includes('Included'));
  assert.ok(store.state.customSales[0].providerRunId);
  await fs.rm(dir, { recursive: true, force: true });
});

test('dry-run import writes no sales and rollback removes a bad batch', async () => {
  const { store, dir } = await makeStore();
  const dry = await ingestPricingData({
    rows: [sale({ rawProviderId: 'dry-1' })],
    cards: [card],
    store,
    source: { provider: 'Shop Authorized CSV', authorizationBasis: 'user_csv', sourceMode: 'production' },
    actor: { userId: 'admin' },
    config: { demoMode: false },
    dryRun: true,
  });
  assert.equal(dry.result.dryRun, true);
  assert.equal(store.state.customSales.length, 0);

  const live = await ingestPricingData({
    rows: [sale({ rawProviderId: 'live-1' })],
    cards: [card],
    store,
    source: { provider: 'Shop Authorized CSV', authorizationBasis: 'user_csv', sourceMode: 'production' },
    actor: { userId: 'admin' },
    config: { demoMode: false },
  });
  assert.equal(store.state.customSales.length, 1);
  const rollback = await rollbackPricingBatch(store, { providerRunId: live.ingest.providerRunId, actor: { userId: 'admin' }, reason: 'test rollback' });
  assert.equal(rollback.removed, 1);
  assert.equal(store.state.customSales.length, 0);
  await fs.rm(dir, { recursive: true, force: true });
});
