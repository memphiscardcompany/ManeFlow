import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePsaResponse, normalizeToken, validateFixture } from '../scripts/psa-live-smoke.mjs';

test('normalizes bearer prefix without exposing token', () => {
  assert.equal(normalizeToken(' Bearer abcdef123456 '), 'abcdef123456');
});

test('normalizes common PSA response wrappers', () => {
  const normalized = normalizePsaResponse({ PSACert: { CertNumber: '157674135', Year: '2023', Subject: 'Shohei Ohtani', CardDescription: 'Darrin Pepe Sketch', CardGrade: '10' } });
  assert.equal(normalized.certNumber, '157674135');
  assert.equal(normalized.year, '2023');
  assert.equal(normalized.subject, 'Shohei Ohtani');
  assert.equal(normalized.grade, '10');
});

test('validates a matching PSA fixture', () => {
  const errors = validateFixture(
    { certNumber: '157674112', year: '2019', subject: 'Shohei Ohtani', description: 'Panini Prizm Fireworks', cardNumber: '#F15', grade: 'GEM MT 10' },
    { certNumber: '157674112', expected: { year: '2019', subjectIncludes: ['Shohei', 'Ohtani'], descriptionIncludes: ['Fireworks'], cardNumberIncludes: ['F15'], grade: '10' } }
  );
  assert.deepEqual(errors, []);
});

test('rejects mismatched identity evidence', () => {
  const errors = validateFixture(
    { certNumber: '157674112', year: '2020', subject: 'Different Player', description: '', cardNumber: '', grade: '9' },
    { certNumber: '157674112', expected: { year: '2019', subjectIncludes: ['Shohei', 'Ohtani'], descriptionIncludes: ['Fireworks'], cardNumberIncludes: ['F15'], grade: '10' } }
  );
  assert.ok(errors.length >= 4);
});
