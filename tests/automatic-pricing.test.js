import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAutomaticPricingEngine } from '../src/services/automatic-pricing.js';
import { TtlCache } from '../src/services/cache.js';
import { JsonStore } from '../src/services/store.js';

const card = {
  id: 'card-automatic-pricing',
  player: 'Test Player',
  year: 2024,
  brand: 'Topps',
  set: 'Chrome',
  cardNumber: '123',
  parallel: 'Refractor',
};

function completedSale(id, price, soldAt = '2026-07-20T12:00:00.000Z') {
  return {
    provider: 'eBay Marketplace Insights',
    sourceType: 'sold',
    listingType: 'completed',
    saleType: 'fixed_price',
    isCompletedSale: true,
    title: `2024 Topps Chrome Test Player #123 Refractor ${id}`,
    soldAt,
    price,
    shipping: 0,
    currency: 'USD',
    rawProviderId: id,
    cardId: card.id,
    player: card.player,
    year: card.year,
    brand: card.brand,
    set: card.set,
    cardNumber: card.cardNumber,
    parallel: card.parallel,
    verified: true,
    confidence: 0.94,
  };
}

async function testContext(t, { provider = null, demoMode = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-automatic-pricing-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = await new JsonStore(path.join(directory, 'state.json')).init();
  const providers = { byName: new Map() };
  if (provider) providers.byName.set('eBay', provider);
  const cache = new TtlCache();
  const config = { demoMode };
  const engine = createAutomaticPricingEngine({
    config,
    providers,
    store,
    cache,
    catalog: () => [card],
    salesForCard: (target) => store.state.customSales.filter((sale) => sale.cardId === target.id),
    activeAskingListingsForCard: async () => ({
      listings: [{ provider: 'eBay Browse', sourceType: 'active_listing', price: 9_999, itemPrice: 9_999 }],
      error: null,
    }),
    refreshIntervalMs: 6 * 60 * 60_000,
    cacheTtlMs: 60_000,
  });
  return { store, providers, cache, config, engine };
}

test('ManeFlow automatically imports authorized completed sales and excludes active asking prices from value', async (t) => {
  let observed = null;
  const provider = {
    marketplaceInsightsEnabled: true,
    status() { return { marketplaceInsightsEnabled: true }; },
    async searchCompletedSales(options) {
      observed = options;
      return {
        rawCount: 6,
        sales: [
          completedSale('sale-1', 95, '2026-07-03T12:00:00.000Z'),
          completedSale('sale-2', 100, '2026-07-08T12:00:00.000Z'),
          completedSale('sale-3', 105, '2026-07-13T12:00:00.000Z'),
          completedSale('sale-4', 102, '2026-07-18T12:00:00.000Z'),
          completedSale('sale-5', 98, '2026-07-21T12:00:00.000Z'),
          completedSale('sale-6', 101, '2026-07-24T12:00:00.000Z'),
        ],
      };
    },
  };
  const { engine, store } = await testContext(t, { provider });
  const result = await engine.priceCard(card, {
    actor: { userId: 'user-a' },
    reason: 'confirmed_scan_identity',
    now: new Date('2026-07-29T12:00:00.000Z'),
  });

  assert.equal(result.refresh.performed, true);
  assert.equal(result.refresh.imported, 6);
  assert.equal(result.status, 'valued_from_authorized_completed_sales');
  assert.equal(result.marketMode, 'production');
  assert.equal(result.productionCompletedSaleCount, 6);
  assert.ok(result.valuation.value >= 95 && result.valuation.value <= 105);
  assert.ok(result.valuation.value < 1_000, 'active $9,999 asking price must not set value');
  assert.equal(result.askingPriceContext.valuationUse, false);
  assert.match(result.askingPriceContext.explanation, /never set ManeFlow market value/i);
  assert.match(observed.query, /2024 Topps Chrome Test Player 123 Refractor/);
  assert.equal(observed.cardContext.cardId, card.id);
  assert.equal(store.state.customSales.length, 6);
  assert.ok(store.state.auditLog.some((entry) => entry.type === 'automatic_pricing_refresh_completed'));
});

test('automatic pricing fails closed to existing evidence when provider access is not enabled', async (t) => {
  const { engine, store } = await testContext(t);
  await store.upsertCustomSales([
    {
      ...completedSale('stored-1', 44, '2026-07-25T12:00:00.000Z'),
      id: 'stored-sale-1',
      sourceMode: 'production',
      authorizationBasis: 'ebay_api',
      allInPrice: 44,
      valuationUse: true,
      importedAt: '2026-07-25T12:00:00.000Z',
    },
  ]);
  const result = await engine.priceCard(card, {
    actor: { userId: 'user-a' },
    now: new Date('2026-07-29T12:00:00.000Z'),
  });
  assert.equal(result.refresh.attempted, false);
  assert.equal(result.refresh.reason, 'fresh_completed_sale_evidence_available');
  assert.equal(result.status, 'valued_from_authorized_completed_sales');
  assert.equal(result.valuation.value, 44);
});

test('provider failure is reported without inventing a market value', async (t) => {
  const provider = {
    marketplaceInsightsEnabled: true,
    status() { return { marketplaceInsightsEnabled: true }; },
    async searchCompletedSales() {
      const error = new Error('Provider unavailable');
      error.code = 'PROVIDER_UNAVAILABLE';
      error.status = 503;
      error.retryable = true;
      throw error;
    },
  };
  const { engine, store } = await testContext(t, { provider });
  const result = await engine.priceCard(card, {
    actor: { userId: 'user-a' },
    now: new Date('2026-07-29T12:00:00.000Z'),
  });
  assert.equal(result.refresh.attempted, true);
  assert.equal(result.refresh.performed, false);
  assert.equal(result.refresh.error.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(result.status, 'refresh_failed_no_value');
  assert.equal(result.valuation.value, null);
  assert.ok(store.state.auditLog.some((entry) => entry.type === 'automatic_pricing_refresh_failed'));
});

test('fresh evidence and cache prevent repeated provider calls for the same card', async (t) => {
  let calls = 0;
  const provider = {
    marketplaceInsightsEnabled: true,
    status() { return { marketplaceInsightsEnabled: true }; },
    async searchCompletedSales() {
      calls += 1;
      return { rawCount: 1, sales: [completedSale('single-flight', 77, '2026-07-28T12:00:00.000Z')] };
    },
  };
  const { engine } = await testContext(t, { provider });
  const now = new Date('2026-07-29T12:00:00.000Z');
  const [first, second] = await Promise.all([
    engine.priceCard(card, { actor: { userId: 'user-a' }, now }),
    engine.priceCard(card, { actor: { userId: 'user-a' }, now }),
  ]);
  assert.equal(calls, 1);
  assert.equal(first.valuation.value, 77);
  assert.equal(second.valuation.value, 77);
  const cached = await engine.priceCard(card, { actor: { userId: 'user-a' }, now });
  assert.equal(calls, 1);
  assert.equal(cached.cache.hit, true);
});

test('an unrecognized card cannot receive a fabricated automatic value', async (t) => {
  const { engine } = await testContext(t);
  const result = await engine.priceCard(null, { actor: { userId: 'user-a' } });
  assert.equal(result.status, 'card_identity_required');
  assert.equal(result.valuation, null);
  assert.equal(result.refresh.attempted, false);
});
