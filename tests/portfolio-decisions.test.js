import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPortfolioIntelligence,
  getInventoryHealth,
} from '../src/services/portfolio-intelligence.js';
import {
  buildPortfolioDecisionSupport,
  buildShopInventoryDecisionSupport,
} from '../src/services/portfolio-decisions.js';

const now = new Date('2026-07-21T12:00:00Z');

const cards = [
  { id: 'rising_card', year: 2024, brand: 'Topps Chrome', set: 'Update', player: 'Rising Rookie', cardNumber: '88', parallel: 'Refractor', sport: 'Baseball', grade: { company: 'PSA', grade: '10' } },
  { id: 'falling_card', year: 2023, brand: 'Prizm', set: 'Basketball', player: 'Cooling Star', cardNumber: '12', parallel: 'Silver', sport: 'Basketball', grade: { company: 'PSA', grade: '10' } },
  { id: 'thin_card', year: 2026, brand: 'Topps', set: 'Brand New', player: 'New Release', cardNumber: '1', parallel: 'Base', sport: 'Baseball' },
];

function isoDaysAgo(days) {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function sale(cardId, price, days, index, provider = `Provider ${index % 4}`) {
  return {
    id: `${cardId}_${index}`,
    rawProviderId: `${cardId}_${index}`,
    cardId,
    provider,
    sourceType: 'sold',
    sourceMode: 'production',
    authorizationBasis: 'official_api',
    dataRightsStatus: 'authorized',
    listingType: 'completed',
    saleType: index % 2 ? 'auction' : 'fixed_price',
    isCompletedSale: true,
    soldAt: isoDaysAgo(days),
    price,
    allInPrice: price,
    title: `${cardId} completed sale ${index}`,
    verified: true,
    confidence: 0.96,
  };
}

const risingSales = [
  ...[7, 10, 13, 16, 19, 22, 25, 28].map((days, index) => sale('rising_card', 130 + index, days, index)),
  ...[36, 39, 42, 45, 48, 51, 54, 57].map((days, index) => sale('rising_card', 98 + index, days, index + 20)),
];

const fallingSales = [
  ...[7, 10, 13, 16, 19, 22, 25, 28].map((days, index) => sale('falling_card', 80 - index, days, index + 50)),
  ...[36, 39, 42, 45, 48, 51, 54, 57].map((days, index) => sale('falling_card', 122 + index, days, index + 80)),
];

const thinSales = [sale('thin_card', 45, 8, 200)];

const wildActiveAsk = {
  id: 'rising_card_active_ask',
  rawProviderId: 'rising_card_active_ask',
  cardId: 'rising_card',
  provider: 'Active BIN Context',
  sourceType: 'active',
  sourceMode: 'production',
  authorizationBasis: 'official_api',
  dataRightsStatus: 'active_listings_only_not_for_valuation',
  listingType: 'active',
  saleType: 'asking',
  isCompletedSale: false,
  soldAt: isoDaysAgo(2),
  price: 9999,
  allInPrice: 9999,
  title: 'Wild active asking price that must not affect value',
  verified: false,
  confidence: 0.99,
};

const collection = [
  { id: 'holding_rising', cardId: 'rising_card', quantity: 2, purchasePrice: 132, purchaseDate: '2026-02-01', status: 'owned' },
  { id: 'holding_falling', cardId: 'falling_card', quantity: 1, purchasePrice: 35, purchaseDate: '2025-02-01', status: 'owned' },
  { id: 'holding_thin', cardId: 'thin_card', quantity: 1, purchasePrice: 40, purchaseDate: '2026-07-01', status: 'owned' },
];

const options = {
  cards,
  sales: [...risingSales, ...fallingSales, ...thinSales, wildActiveAsk],
  demoMode: false,
  now,
};

test('portfolio decision support tracks movement, confidence, liquidity, and actions', () => {
  const intelligence = buildPortfolioIntelligence(collection, options);
  const support = intelligence.decisionSupport;
  assert.equal(support.methodologyVersion, 'portfolio-decision-v1.0');
  assert.ok(support.summary.averageValuationConfidence > 40);
  assert.ok(support.summary.averageLiquidityScore > 0);
  assert.ok(support.summary.estimated30DayChange !== 0);
  assert.equal(support.cards.length, 3);
  assert.ok(support.actionBuckets.buyMore.some((item) => item.cardId === 'rising_card'));
  assert.ok(support.actionBuckets.sellNow.some((item) => item.cardId === 'falling_card'));
  assert.ok(support.actionBuckets.wait.some((item) => item.cardId === 'thin_card'));
});

test('portfolio decision support is independent of wall clock when now is supplied', () => {
  const expected = buildPortfolioIntelligence(collection, options);
  const RealDate = globalThis.Date;
  const frozenWallClock = new RealDate('2042-01-01T00:00:00Z');

  class FrozenDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [frozenWallClock.toISOString()]));
    }

    static now() {
      return frozenWallClock.getTime();
    }
  }

  try {
    globalThis.Date = FrozenDate;
    const actual = buildPortfolioIntelligence(collection, options);
    assert.deepEqual(actual.decisionSupport, expected.decisionSupport);
    assert.deepEqual(actual.inventoryHealth.decisionSupport, expected.inventoryHealth.decisionSupport);
  } finally {
    globalThis.Date = RealDate;
  }
});

test('active BIN prices stay secondary and never drive true market value', () => {
  const intelligence = buildPortfolioIntelligence(collection, options);
  const rising = intelligence.decisionSupport.cards.find((item) => item.cardId === 'rising_card');
  assert.ok(rising.currentValue < 400, `completed-sale value was polluted by active ask: ${rising.currentValue}`);
  assert.equal(rising.dataHealth.completedSalesOnly, true);
  assert.equal(rising.movement.methodology.includes('Active BIN/ask prices are not used'), true);
  assert.equal(rising.askingPriceContext, null, 'active listing in sales feed should be excluded, not mixed into market movement');
});

test('thin data produces honest wait recommendation and low valuation confidence', () => {
  const intelligence = buildPortfolioIntelligence(collection, options);
  const thin = intelligence.decisionSupport.cards.find((item) => item.cardId === 'thin_card');
  assert.equal(thin.recommendation.action, 'wait');
  assert.equal(thin.valuationConfidence.label, 'thin_data');
  assert.ok(thin.recommendation.reasons[0].includes('too thin'));
});

test('card decision signal is separate from scan confidence and uses valuation evidence', () => {
  const intelligence = buildPortfolioIntelligence(collection, options);
  const rising = intelligence.decisionSupport.cards.find((item) => item.cardId === 'rising_card');
  assert.ok(rising.valuationConfidence.score >= 60);
  assert.equal(Object.hasOwn(rising, 'scanConfidence'), false);
  assert.ok(rising.momentum.score > 50);
});

test('shop inventory health exposes list, hold, reprice, and review queues', () => {
  const shopCollection = [
    { id: 'shop_available', cardId: 'falling_card', quantity: 1, purchasePrice: 35, listPrice: null, purchaseDate: '2025-02-01', status: 'available' },
    { id: 'shop_overpriced', cardId: 'rising_card', quantity: 1, purchasePrice: 80, listPrice: 220, purchaseDate: '2026-02-01', status: 'listed' },
    { id: 'shop_thin', cardId: 'thin_card', quantity: 1, purchasePrice: 30, listPrice: null, purchaseDate: '2026-07-01', status: 'available' },
  ];
  const health = getInventoryHealth(shopCollection, options);
  assert.ok(health.listCandidates.some((item) => item.cardId === 'falling_card'));
  assert.ok(health.repriceCandidates.some((item) => item.cardId === 'rising_card'));
  assert.ok(health.reviewCandidates.some((item) => item.cardId === 'thin_card'));
  assert.equal(health.decisionSupport.disclaimer.includes('completed sales only'), true);
});

test('portfolio and shop decision helpers accept already-enriched market objects', () => {
  const intelligence = buildPortfolioIntelligence(collection, options);
  const support = buildPortfolioDecisionSupport(intelligence.decisionSupport.cards, { now });
  const shop = buildShopInventoryDecisionSupport(intelligence.decisionSupport.cards.map((item) => ({ ...item, market: { value: item.movement.currentUnitValue, confidence: item.valuationConfidence.score, completedSaleConfidence: item.valuationConfidence.score, liquidityScore: item.liquidity.score, volume90: item.liquidity.volume90, windows: item.movement.completedSaleWindows, trend30Pct: item.movement.trend30Pct, trend90Pct: item.movement.trend90Pct, compQuality: { includedCount: item.valuationConfidence.includedCompCount, averageQualityScore: item.valuationConfidence.averageCompQuality || item.valuationConfidence.score, averageSourceTrust: item.valuationConfidence.averageSourceTrust || item.valuationConfidence.score, averageMatchScore: item.valuationConfidence.averageMatchScore || item.valuationConfidence.score } } })), { now });
  assert.equal(support.cards.length, 3);
  assert.equal(shop.items.length, 3);
});
