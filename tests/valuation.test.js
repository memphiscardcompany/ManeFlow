import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateValuation } from '../src/services/valuation.js';

const now = new Date('2026-07-08T12:00:00Z');
function sale(price, days, provider = 'A', verified = true) {
  return {
    allInPrice: price,
    soldAt: new Date(now.getTime() - days * 86_400_000).toISOString(),
    provider,
    verified,
    confidence: verified ? 0.95 : 0.6,
  };
}

test('valuation excludes extreme IQR outlier', () => {
  const result = calculateValuation([
    sale(100, 3), sale(102, 7), sale(98, 11), sale(105, 15), sale(101, 19), sale(999, 22),
  ], { now });
  assert.equal(result.outlierCount, 1);
  assert.ok(result.value < 120);
  assert.ok(result.range.high < 180);
});

test('valuation detects rising 30-day trend', () => {
  const current = [sale(150, 2, 'A'), sale(148, 8, 'B'), sale(145, 16, 'A'), sale(142, 25, 'C')];
  const prior = [sale(100, 35, 'A'), sale(102, 42, 'B'), sale(98, 50, 'C'), sale(101, 58, 'A')];
  const result = calculateValuation([...current, ...prior], { now });
  assert.equal(result.direction, 'rising');
  assert.ok(result.trend30Pct > 30);
});

test('confidence rewards provider diversity and verified sales', () => {
  const diverse = calculateValuation([
    sale(100, 1, 'A'), sale(101, 2, 'B'), sale(99, 3, 'C'), sale(102, 4, 'D'), sale(98, 5, 'A'), sale(100, 6, 'B'),
  ], { now });
  const narrow = calculateValuation([
    sale(100, 1, 'A', false), sale(101, 2, 'A', false), sale(99, 3, 'A', false), sale(102, 4, 'A', false), sale(98, 5, 'A', false), sale(100, 6, 'A', false),
  ], { now });
  assert.ok(diverse.confidence > narrow.confidence);
});
