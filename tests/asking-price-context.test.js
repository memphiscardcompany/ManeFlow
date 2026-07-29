import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAskingPriceContext } from '../src/services/asking-price-context.js';
import { calculateValuation } from '../src/services/valuation.js';
import { buildDealerDecision } from '../src/services/dealer-decision.js';

const now = new Date('2026-07-21T12:00:00Z');

function sold(price, days = 2) {
  return {
    id: `sale-${price}-${days}`,
    provider: 'Authorized Feed',
    sourceMode: 'production',
    authorizationBasis: 'official_api',
    dataRightsStatus: 'authorized',
    sourceType: 'sold',
    listingType: 'completed',
    saleType: 'fixed_price',
    isCompletedSale: true,
    allInPrice: price,
    soldAt: new Date(now.getTime() - days * 86_400_000).toISOString(),
    verified: true,
    confidence: 0.92,
  };
}

function bin(price, id = price) {
  return {
    provider: 'eBay Browse',
    sourceType: 'active_listing',
    listingType: 'buy_it_now_asking',
    saleType: 'asking',
    itemId: `item-${id}`,
    title: `Current BIN ${price}`,
    price,
    currency: 'USD',
    buyingOptions: ['FIXED_PRICE'],
    authorizationBasis: 'ebay_api',
    dataRightsStatus: 'active_listings_only_not_for_valuation',
  };
}

test('asking context summarizes current BIN prices without valuation use', () => {
  const context = summarizeAskingPriceContext([bin(120), bin(124), bin(125), bin(128), bin(132), bin(10000)], { now });
  assert.equal(context.valuationUse, false);
  assert.equal(context.count, 5);
  assert.equal(context.medianAsk, 125);
  assert.equal(context.rejectedCount, 1);
  assert.match(context.methodology, /never set completed-sale market value/i);
  assert.ok(context.listings.every((listing) => listing.valuationUse === false));
});

test('valuation keeps completed-sale value separate from active BIN context', () => {
  const result = calculateValuation([sold(100), sold(102), sold(98)], {
    now,
    demoMode: false,
    askingListings: [bin(140), bin(145), bin(150)],
  });
  assert.ok(result.value < 110);
  assert.equal(result.askingPriceContext.medianAsk, 145);
  assert.equal(result.askingPriceContext.valuationUse, false);
  assert.ok(result.pricingConfidence >= result.completedSaleConfidence - 10);
  assert.notEqual(result.pricingRating, 'completed_sales_only');
});

test('dealer decisions can use BIN context for new-release listing strategy only', () => {
  const decision = buildDealerDecision({
    card: { id: 'new-card', player: 'New Rookie', year: 2026, set: 'Fresh Release', cardNumber: '1' },
    sales: [],
    askingListings: [bin(35), bin(38), bin(42)],
    demoMode: false,
  });
  assert.equal(decision.estimatedMarketValue, null);
  assert.equal(decision.dealerBuyRange.low, null);
  assert.equal(decision.askingPriceContext.medianAsk, 38);
  assert.ok(decision.fairListPrice > 0);
  assert.match(decision.suggestedAction, /No completed-sale value yet/);
});
