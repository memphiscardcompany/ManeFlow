import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreComps, scoreComp, summarizeCompQuality } from '../src/services/comp-quality.js';
import { calculateValuation } from '../src/services/valuation.js';

const now = new Date('2026-07-21T12:00:00Z');
const card = { id: 'card-1', player: 'Shohei Ohtani', year: 2018, set: 'Update Series', cardNumber: 'US1', parallel: 'Base', grade: { company: 'PSA', grade: '10' } };
function sale(overrides = {}) {
  return {
    id: `sale-${Math.random().toString(16).slice(2)}`,
    provider: 'Approved Feed',
    sourceType: 'sold',
    saleType: 'auction',
    listingType: 'completed',
    isCompletedSale: true,
    authorizationBasis: 'written_license',
    sourceMode: 'production',
    cardId: 'card-1',
    player: 'Shohei Ohtani',
    year: 2018,
    set: 'Update Series',
    cardNumber: 'US1',
    parallel: 'Base',
    grade: { company: 'PSA', grade: '10' },
    allInPrice: 100,
    soldAt: '2026-07-10T12:00:00Z',
    verified: true,
    confidence: 0.95,
    ...overrides,
  };
}

test('active listing is excluded from valuation use', () => {
  const scored = scoreComp(sale({ sourceType: 'active', listingType: 'active', isCompletedSale: false }), { now, card, demoMode: false });
  assert.equal(scored.inclusionStatus, 'excluded_active_listing');
  assert.equal(scored.valuationUse, false);
});

test('demo comp is excluded in production mode', () => {
  const scored = scoreComp(sale({ sourceMode: 'demo', authorizationBasis: 'demo' }), { now, card, demoMode: false });
  assert.equal(scored.inclusionStatus, 'excluded_demo_in_production');
  assert.equal(scored.valuationUse, false);
});

test('missing sold date and missing price are excluded', () => {
  assert.equal(scoreComp(sale({ soldAt: null }), { now, card }).inclusionStatus, 'excluded_missing_sale_date');
  assert.equal(scoreComp(sale({ allInPrice: null }), { now, card }).inclusionStatus, 'excluded_missing_price');
});

test('authorized completed sale is included', () => {
  const scored = scoreComp(sale(), { now, card, demoMode: false });
  assert.equal(scored.inclusionStatus, 'included');
  assert.equal(scored.valuationUse, true);
  assert.ok(scored.qualityScore >= 70);
});

test('wrong grade is excluded', () => {
  const scored = scoreComp(sale({ grade: { company: 'PSA', grade: '9' } }), { now, card, demoMode: false });
  assert.equal(scored.inclusionStatus, 'excluded_wrong_grade');
});

test('duplicates and outliers are visibly excluded', () => {
  const sales = [
    sale({ id: 'a', allInPrice: 100, rawProviderId: 'raw-1' }),
    sale({ id: 'b', allInPrice: 100, rawProviderId: 'raw-1' }),
    sale({ id: 'c', allInPrice: 101, rawProviderId: 'raw-2' }),
    sale({ id: 'd', allInPrice: 99, rawProviderId: 'raw-3' }),
    sale({ id: 'e', allInPrice: 102, rawProviderId: 'raw-4' }),
    sale({ id: 'f', allInPrice: 98, rawProviderId: 'raw-5' }),
    sale({ id: 'g', allInPrice: 999, rawProviderId: 'raw-6' }),
  ];
  const scored = scoreComps(sales, { now, card, demoMode: false });
  assert.ok(scored.some((item) => item.inclusionStatus === 'excluded_duplicate'));
  assert.ok(scored.some((item) => item.inclusionStatus === 'excluded_outlier'));
  const summary = summarizeCompQuality(scored);
  assert.equal(summary.includedCount, 5);
  assert.equal(summary.excludedCount, 2);
});

test('valuation only uses comps with valuationUse true', () => {
  const scored = scoreComps([
    sale({ id: 'include-1', allInPrice: 100, rawProviderId: 'include-1' }),
    sale({ id: 'include-2', allInPrice: 102, rawProviderId: 'include-2' }),
    sale({ id: 'active-1', allInPrice: 100000, sourceType: 'active', listingType: 'active', isCompletedSale: false, rawProviderId: 'active-1' }),
  ], { now, card, demoMode: false });
  const result = calculateValuation(scored, { now, scored: true, includeCompDetails: true });
  assert.ok(result.value < 150);
  assert.equal(result.compQuality.includedCount, 2);
  assert.equal(result.compQuality.excludedCount, 1);
  assert.equal(result.compDetails.excluded[0].inclusionStatus, 'excluded_active_listing');
});
