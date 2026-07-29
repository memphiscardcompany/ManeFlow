import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePsaResponse, normalizeToken } from '../scripts/psa-live-smoke.mjs';

test('PSA partner response normalization maps nested cert identity fields', () => {
  const record = normalizePsaResponse({ IsValidRequest: true, Cert: { CertNumber: '12345678', Year: '2018', Subject: 'Shohei Ohtani', Brand: 'Topps Update', CardNumber: 'US1', CardGrade: '10', CardDescription: 'Rookie' } });
  assert.equal(record.certNumber, '12345678');
  assert.equal(record.subject, 'Shohei Ohtani');
  assert.equal(record.cardNumber, 'US1');
  assert.equal(record.grade, '10');
});

test('PSA token normalization strips an accidental bearer prefix', () => {
  assert.equal(normalizeToken('Bearer secret-value'), 'secret-value');
});
