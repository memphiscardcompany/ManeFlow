import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDataHealth } from '../src/services/data-health.js';

const now = new Date('2026-07-21T12:00:00Z');
const cards = [{ id: 'card-1' }, { id: 'card-2' }, { id: 'card-3' }];
const providers = [
  { name: 'Demo', supportsCompletedSales: true, dataRightsStatus: 'demo_only', authorizationBasis: 'demo' },
  { name: 'Approved Feed', supportsCompletedSales: true, dataRightsStatus: 'configured', authorizationBasis: 'written_license' },
  { name: 'Missing Partner', supportsCompletedSales: true, dataRightsStatus: 'partnership_required', authorizationBasis: 'written_license' },
];
function sale(overrides = {}) {
  return {
    id: `sale-${Math.random().toString(16).slice(2)}`,
    provider: 'Approved Feed',
    sourceType: 'sold',
    isCompletedSale: true,
    saleType: 'auction',
    authorizationBasis: 'written_license',
    sourceMode: 'production',
    cardId: 'card-1',
    allInPrice: 100,
    soldAt: '2026-07-10T12:00:00Z',
    verified: true,
    confidence: 0.9,
    ...overrides,
  };
}

test('data health summarizes demo, production, authorization, stale providers, and review needs', () => {
  const health = summarizeDataHealth({
    sales: [
      sale({ id: 'demo-1', provider: 'Demo', sourceMode: 'demo', authorizationBasis: 'demo', cardId: 'card-2' }),
      sale({ id: 'prod-1' }),
      sale({ id: 'active-1', sourceType: 'active', listingType: 'active', isCompletedSale: false }),
      sale({ id: 'bad-date', soldAt: null }),
      sale({ id: 'bad-price', allInPrice: null }),
      sale({ id: 'low-trust', authorizationBasis: 'unknown', sourceMode: 'production', verified: false }),
    ],
    cards,
    providers,
    config: { demoMode: true },
    now,
  });
  assert.equal(health.totalComps, 6);
  assert.equal(health.demoComps, 1);
  assert.equal(health.productionComps, 5);
  assert.equal(health.activeListingsPresent, 1);
  assert.ok(health.unauthorizedComps >= 1);
  assert.ok(health.compsMissingSaleDates >= 1);
  assert.ok(health.compsMissingAllInPrice >= 1);
  assert.ok(health.cardsWithNoComps.includes('card-3'));
  assert.ok(health.cardsWithOnlyDemoComps.includes('card-2'));
  assert.ok(health.staleProviders.some((provider) => provider.name === 'Missing Partner'));
});
