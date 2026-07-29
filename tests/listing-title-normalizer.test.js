import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateListingTitle, extractListingGrade, scrubInvalidListings } from '../src/services/listing-title-normalizer.js';

test('listing scrubber rejects prohibited titles and exact card-number mismatches', () => {
  const result = scrubInvalidListings([
    { title: '2018 Topps Update Shohei Ohtani #US1 PSA 10' },
    { title: '2018 Topps Update Shohei Ohtani #US10 PSA 10' },
    { title: '2018 Topps Update Shohei Ohtani #US1 Reprint' },
  ], { cardNumber: 'US1' });
  assert.equal(result.cleaned.length, 1);
  assert.equal(result.rejected.length, 2);
  assert.equal(result.cleaned[0].normalizedGrade.company, 'PSA');
});

test('card number matching does not confuse 12 and 120', () => {
  assert.equal(evaluateListingTitle('1986 Fleer Michael Jordan #12 PSA 8', { cardNumber: '120' }).valid, false);
  assert.equal(evaluateListingTitle('1986 Fleer Michael Jordan #120 PSA 8', { cardNumber: '120' }).valid, true);
});

test('grade parser treats speculative grades as raw', () => {
  assert.equal(extractListingGrade('Raw card PSA 10?').company, 'RAW');
  assert.equal(extractListingGrade('BGS candidate').company, 'RAW');
  assert.deepEqual(extractListingGrade('BGS 9.5'), {
    company: 'BGS', grade: 9.5, slabbed: true, confidence: 0.98, reason: 'BGS numeric grade found in listing title.',
  });
});

test('strict card-number matching accepts bare alphanumeric sports numbers and rejects longer collisions', () => {
  const accepted = evaluateListingTitle('2018 Topps Update Shohei Ohtani US1 PSA 10', { cardNumber: 'US1' });
  assert.equal(accepted.valid, true);
  assert.ok(accepted.cardNumbers.includes('US1'));

  const rejected = evaluateListingTitle('2018 Topps Update Shohei Ohtani US10 PSA 10', { cardNumber: 'US1' });
  assert.equal(rejected.valid, false);
  assert.equal(rejected.reason, 'card_number_mismatch');
});
