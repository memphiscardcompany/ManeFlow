import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPricingImportTemplate, ingestPricingData, summarizePricingData, validatePricingRows } from '../src/services/pricing-data.js';
import { JsonStore } from '../src/services/store.js';
import { normalizeCatalogCard } from '../src/services/catalog.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const card = normalizeCatalogCard({
  id: 'card_ohtani_us1_psa10', player: 'Shohei Ohtani', year: 2018, brand: 'Topps', set: 'Update', cardNumber: 'US1', parallel: 'Base', sport: 'Baseball', grade: 'PSA 10',
});

function row(overrides = {}) {
  return {
    provider: 'Authorized CSV', authorizationBasis: 'user_csv', sourceMode: 'production', rawProviderId: 'sale-1',
    title: '2018 Topps Update Shohei Ohtani US1 Base PSA 10', soldAt: '2026-07-01T00:00:00Z', price: 100, shipping: 5,
    saleType: 'fixed_price', listingType: 'completed', isCompletedSale: true, player: 'Shohei Ohtani', year: 2018,
    brand: 'Topps', set: 'Update', cardNumber: 'US1', parallel: 'Base', grader: 'PSA', grade: '10', cardId: card.id,
    verified: true, confidence: 0.95, rightsNotes: 'Authorized test export', ...overrides,
  };
}

test('pricing template exposes expected headers', () => {
  const csv = buildPricingImportTemplate();
  assert.match(csv, /provider,authorizationBasis,sourceMode/);
  assert.match(csv, /rawProviderId/);
});

test('pricing validation rejects production rows without approved authorization', () => {
  const result = validatePricingRows([row({ authorizationBasis: 'unknown' })], { source: { provider: 'Bad Source', authorizationBasis: 'unknown', sourceMode: 'production' }, cards: [card] });
  assert.equal(result.normalized.length, 0);
  assert.ok(result.errors.some((error) => error.error.includes('authorizationBasis')));
});

test('pricing validation scores authorized completed rows before valuation use', () => {
  const result = validatePricingRows([row()], { source: { provider: 'Authorized CSV', authorizationBasis: 'user_csv', sourceMode: 'production' }, cards: [card] });
  assert.equal(result.errors.length, 0);
  assert.equal(result.normalized.length, 1);
  assert.equal(result.scored[0].valuationUse, true);
  assert.equal(result.scored[0].inclusionStatus, 'included');
  assert.ok(result.scored[0].dataCompletenessScore >= 70);
});

test('pricing validation keeps active listings out of valuation data', () => {
  const result = validatePricingRows([row({ rawProviderId: 'active-1', isCompletedSale: false, listingType: 'active', saleType: 'asking', soldAt: '' })], { source: { provider: 'Active Listings', authorizationBasis: 'official_api', sourceMode: 'production' }, cards: [card] });
  assert.equal(result.errors.length, 0);
  assert.equal(result.scored[0].inclusionStatus, 'excluded_missing_sale_date');
  assert.equal(result.scored[0].valuationUse, false);
});

test('pricing ingestion upserts provider raw ids idempotently', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-pricing-'));
  const store = await new JsonStore(path.join(dir, 'store.json')).init();
  const first = await ingestPricingData({ rows: [row()], cards: [card], store, source: { provider: 'Authorized CSV', authorizationBasis: 'user_csv', sourceMode: 'production' }, actor: { userId: 'admin' }, config: { demoMode: false } });
  const second = await ingestPricingData({ rows: [row({ price: 110 })], cards: [card], store, source: { provider: 'Authorized CSV', authorizationBasis: 'user_csv', sourceMode: 'production' }, actor: { userId: 'admin' }, config: { demoMode: false } });
  assert.equal(first.result.added, 1);
  assert.equal(second.result.added, 0);
  assert.equal(second.result.updated, 1);
  assert.equal(store.state.customSales.length, 1);
  assert.equal(store.state.customSales[0].price, 110);
});

test('pricing data summary reports provider quality and public blockers', () => {
  const result = validatePricingRows([row()], { source: { provider: 'Authorized CSV', authorizationBasis: 'user_csv', sourceMode: 'production' }, cards: [card] });
  const report = summarizePricingData({ sales: result.normalized, cards: [card], providers: [], config: { demoMode: false } });
  assert.equal(report.totals.valuationEligible, 1);
  assert.equal(report.providerQuality[0].provider, 'Authorized CSV');
  assert.equal(report.readyForPublicValueClaims, true);
});
