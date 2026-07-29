import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPortfolioIntelligence,
  calculatePortfolioMetrics,
  calculateROI,
  generateAllocationBreakdown,
  generateTaxEstimate,
  getInventoryHealth,
  getSmartRecommendations,
  runScenarioAnalysis,
} from '../src/services/portfolio-intelligence.js';

const now = new Date('2026-07-21T12:00:00Z');
const cards = [
  { id: 'card_a', year: 2018, brand: 'Topps', set: 'Update', player: 'Shohei Ohtani', cardNumber: 'US1', parallel: 'Base', sport: 'Baseball', grade: { company: 'PSA', grade: '10' } },
  { id: 'card_b', year: 2023, brand: 'Panini', set: 'Prizm', player: 'Victor Wembanyama', cardNumber: '136', parallel: 'Silver', sport: 'Basketball', grade: { company: 'PSA', grade: '10' } },
];
const collection = [
  { id: 'item_a', cardId: 'card_a', quantity: 2, purchasePrice: 100, purchaseDate: '2025-01-01', status: 'owned' },
  { id: 'item_b', cardId: 'card_b', quantity: 1, purchasePrice: 80, purchaseDate: '2026-01-01', status: 'owned' },
  { id: 'item_sold', cardId: 'card_a', quantity: 1, purchasePrice: 90, soldPrice: 160, purchaseDate: '2024-01-01', status: 'sold' },
];
const sales = [
  { id: 'sale_a_1', cardId: 'card_a', provider: 'Official Feed', sourceType: 'sold', saleType: 'fixed_price', soldAt: '2026-07-01T00:00:00Z', price: 150, allInPrice: 150, verified: true, confidence: 0.96, sourceMode: 'production', authorizationBasis: 'official_api' },
  { id: 'sale_a_2', cardId: 'card_a', provider: 'Official Feed', sourceType: 'sold', saleType: 'auction', soldAt: '2026-06-15T00:00:00Z', price: 160, allInPrice: 160, verified: true, confidence: 0.93, sourceMode: 'production', authorizationBasis: 'official_api' },
  { id: 'sale_a_active', cardId: 'card_a', provider: 'Asking Feed', sourceType: 'active', listingType: 'active', soldAt: '2026-07-10T00:00:00Z', price: 9999, allInPrice: 9999, verified: false, confidence: 0.9, sourceMode: 'production', authorizationBasis: 'official_api' },
  { id: 'sale_b_1', cardId: 'card_b', provider: 'Licensed Feed', sourceType: 'sold', saleType: 'fixed_price', soldAt: '2026-07-03T00:00:00Z', price: 50, allInPrice: 50, verified: true, confidence: 0.91, sourceMode: 'production', authorizationBasis: 'written_license' },
  { id: 'sale_b_2', cardId: 'card_b', provider: 'Licensed Feed', sourceType: 'sold', saleType: 'fixed_price', soldAt: '2026-06-28T00:00:00Z', price: 55, allInPrice: 55, verified: true, confidence: 0.9, sourceMode: 'production', authorizationBasis: 'written_license' },
];
const options = { cards, sales, demoMode: false, now };

test('portfolio metrics use only comp-quality valuationUse comps', () => {
  const metrics = calculatePortfolioMetrics(collection, options);
  assert.equal(metrics.itemCount, 2);
  assert.ok(metrics.currentValue > 340 && metrics.currentValue < 370, `value was ${metrics.currentValue}`);
  assert.ok(metrics.currentValue < 1000, 'active listing asking price must not affect portfolio value');
  assert.equal(metrics.lowConfidenceCount, 0);
  assert.ok(metrics.averageCompQuality > 70);
});

test('ROI calculations include realized and unrealized gains', () => {
  const roi = calculateROI(collection, options);
  assert.equal(roi.totalCost, 370);
  assert.equal(roi.realizedGains, 70);
  assert.ok(roi.unrealizedGains > 0);
  assert.ok(roi.groups.byPlayer.some((row) => row.label === 'Shohei Ohtani'));
});

test('allocation breakdown reports value concentration correctly', () => {
  const allocation = generateAllocationBreakdown(collection, options);
  assert.equal(allocation.bySport[0].label, 'Baseball');
  assert.ok(['medium', 'high'].includes(allocation.concentrationRisk));
  assert.equal(allocation.byGradeTier[0].label, 'PSA Gem Mint 10');
});

test('tax estimate separates realized and unrealized gains', () => {
  const tax = generateTaxEstimate(collection, { ...options, shortTermRate: 0.3, longTermRate: 0.15 });
  assert.equal(tax.realizedLongTermGain, 70);
  assert.ok(tax.unrealizedLongTermGain > 0);
  assert.ok(tax.realizedTaxEstimate > 0);
  assert.ok(tax.disclaimer.includes('not tax advice'));
});

test('scenario analysis models selected sales and market moves', () => {
  const scenario = runScenarioAnalysis(collection, { collectionItemIds: ['item_a'], sellFeePct: 0.1, marketDropPct: 20 }, options);
  assert.equal(scenario.selectedCount, 1);
  assert.ok(scenario.estimatedSellProceeds > 250);
  assert.ok(scenario.valueAfterMarketMove < scenario.currentValue);
});

test('inventory health identifies velocity and reorder context for shops', () => {
  const health = getInventoryHealth(collection, options);
  assert.equal(health.totalQuantity, 3);
  assert.ok(Array.isArray(health.reorderPoints));
  assert.ok(health.velocityLeaders[0].monthlyVelocity > 0);
});

test('smart recommendations flag concentration and performance issues', () => {
  const recommendations = getSmartRecommendations(collection, options);
  assert.ok(Array.isArray(recommendations.recommendations));
  assert.ok(recommendations.recommendations.some((item) => ['concentration_risk', 'consider_sale'].includes(item.type)));
});

test('full intelligence bundle includes metrics, tax, inventory, recommendations, and trends', () => {
  const intelligence = buildPortfolioIntelligence(collection, options);
  assert.ok(intelligence.metrics.currentValue > 0);
  assert.ok(intelligence.taxEstimate.ifLiquidatedTaxEstimate >= intelligence.taxEstimate.realizedTaxEstimate);
  assert.ok(Array.isArray(intelligence.inventoryHealth.velocityLeaders));
  assert.ok(Array.isArray(intelligence.recommendations.recommendations));
  assert.ok(Array.isArray(intelligence.trends));
});
