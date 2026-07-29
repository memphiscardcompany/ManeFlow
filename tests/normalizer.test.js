import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGrade, normalizeSale } from '../src/services/normalizer.js';


test('normalizes common grade strings', () => {
  assert.deepEqual(normalizeGrade('PSA 10'), { company: 'PSA', grade: '10' });
  assert.deepEqual(normalizeGrade('raw'), { company: 'RAW', grade: 'Raw' });
});

test('normalizes all-in sale price', () => {
  const sale = normalizeSale({
    id: 'x',
    price: 100,
    shipping: 5,
    buyerPremium: 20,
    sourceType: 'sold',
    soldAt: '2026-07-01T00:00:00Z',
    grade: 'PSA 10',
    player: 'Shohei Ohtani',
    year: 2018,
  }, 'test');
  assert.equal(sale.allInPrice, 125);
  assert.equal(sale.provider, 'test');
  assert.equal(sale.grade.company, 'PSA');
});
