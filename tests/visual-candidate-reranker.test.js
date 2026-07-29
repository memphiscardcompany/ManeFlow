import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  buildVisualSearchEvidence,
  normalizeCardNumber,
  rerankVisualCandidates,
} from '../src/services/visual-candidate-reranker.js';

function candidate(overrides = {}) {
  return {
    catalogCardId: overrides.catalogCardId || crypto.randomUUID(),
    canonicalKey: overrides.canonicalKey || '2023|topps chrome|12|base',
    sportOrGame: 'baseball',
    releaseYear: 2023,
    manufacturer: 'Topps',
    brand: 'Topps Chrome',
    setName: 'Topps Chrome',
    setCode: 'TC23',
    cardNumber: '12',
    subjectName: 'Printed Subject',
    teamOrFaction: null,
    parallelName: 'Base',
    languageCode: 'en',
    serialNumberedTo: null,
    embeddingModelName: 'siglip2-so400m-naflex',
    embeddingModelVersion: '1',
    cosineDistance: 0.08,
    cosineSimilarity: 0.92,
    combinedCosineSimilarity: 0.92,
    frontCosineSimilarity: 0.93,
    backCosineSimilarity: 0.91,
    viewAgreement: 0.98,
    shopQuantity: 0,
    lowestShopListPrice: null,
    highestShopListPrice: null,
    ...overrides,
  };
}

test('card-number normalization does not conflate #12 with #120', () => {
  assert.equal(normalizeCardNumber('Card No. #12'), '12');
  assert.equal(normalizeCardNumber('#120'), '120');
  assert.notEqual(normalizeCardNumber('#12'), normalizeCardNumber('#120'));
});

test('evidence fusion promotes an exact front/back candidate with exact card number and set', () => {
  const result = rerankVisualCandidates({
    candidates: [candidate(), candidate({ catalogCardId: crypto.randomUUID(), cardNumber: '120', cosineSimilarity: 0.94, combinedCosineSimilarity: 0.94 })],
    evidence: {
      releaseYear: 2023,
      setCode: 'TC23',
      setName: 'Topps Chrome',
      cardNumber: '#12',
      fieldConfidence: { releaseYear: 0.98, setCode: 0.96, setName: 0.92, cardNumber: 0.99 },
    },
  });
  assert.equal(result.status, 'exact');
  assert.equal(result.topCandidate.cardNumber, '12');
  assert.equal(result.topCandidate.hardConflicts.length, 0);
  assert.ok(result.topCandidate.rerankScore > result.candidates[1].rerankScore);
});

test('high-confidence card-number conflict forces abstention despite stronger vector similarity', () => {
  const result = rerankVisualCandidates({
    candidates: [candidate({ cardNumber: '120', cosineSimilarity: 0.97, combinedCosineSimilarity: 0.97 })],
    evidence: { cardNumber: '12', fieldConfidence: { cardNumber: 0.99 } },
  });
  assert.equal(result.status, 'unresolved');
  assert.deepEqual(result.topCandidate.hardConflicts, ['cardNumber']);
});

test('set lock removes candidates outside the requested set', () => {
  const result = rerankVisualCandidates({
    candidates: [
      candidate({ catalogCardId: crypto.randomUUID(), setCode: 'OTHER', setName: 'Other Set', cosineSimilarity: 0.98, combinedCosineSimilarity: 0.98 }),
      candidate({ catalogCardId: crypto.randomUUID(), cosineSimilarity: 0.88, combinedCosineSimilarity: 0.88 }),
    ],
    evidence: { setCode: 'TC23', cardNumber: '12' },
    constraints: { setCode: 'TC23' },
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.topCandidate.setCode, 'TC23');
});

test('ambiguous top candidates remain unresolved when the rerank margin is too small', () => {
  const result = rerankVisualCandidates({
    candidates: [
      candidate({ catalogCardId: crypto.randomUUID(), cosineSimilarity: 0.84, combinedCosineSimilarity: 0.84, frontCosineSimilarity: null, backCosineSimilarity: null, viewAgreement: 0 }),
      candidate({ catalogCardId: crypto.randomUUID(), canonicalKey: 'alternate', cosineSimilarity: 0.83, combinedCosineSimilarity: 0.83, frontCosineSimilarity: null, backCosineSimilarity: null, viewAgreement: 0 }),
    ],
  });
  assert.equal(result.status, 'unresolved');
  assert.ok(result.warnings.some((warning) => warning.includes('too close')));
});

test('visual-search evidence merges local OCR, manual set lock, and vision fields', () => {
  const evidence = buildVisualSearchEvidence({
    localOcr: {
      fields: { year: 2023, cardNumber: '12' },
      fieldConfidence: { year: 0.93, cardNumber: 0.97 },
    },
    vision: {
      facts: { player: 'Printed Subject', brand: 'Topps', parallel: 'Refractor' },
      fieldConfidence: { player: 0.81, brand: 0.79, parallel: 0.64 },
    },
    manual: { setCode: 'TC23', setName: 'Topps Chrome' },
  });
  assert.equal(evidence.releaseYear, 2023);
  assert.equal(evidence.cardNumber, '12');
  assert.equal(evidence.setCode, 'TC23');
  assert.equal(evidence.subjectName, 'Printed Subject');
  assert.equal(evidence.parallelName, 'Refractor');
  assert.equal(evidence.fieldConfidence.cardNumber, 0.97);
});

test('front/back OCR conflicts lower evidence confidence instead of hard-filtering the catalog', () => {
  const evidence = buildVisualSearchEvidence({
    localOcr: {
      fields: { year: 2023, cardNumber: '12' },
      fieldConfidence: { year: 0.96, cardNumber: 0.98 },
    },
    backLocalOcr: {
      fields: { year: 2022, cardNumber: '120' },
      fieldConfidence: { year: 0.95, cardNumber: 0.97 },
    },
  });
  assert.equal(evidence.releaseYear, 2023);
  assert.equal(evidence.cardNumber, '12');
  assert.equal(evidence.fieldConfidence.releaseYear, 0.49);
  assert.equal(evidence.fieldConfidence.cardNumber, 0.49);
  assert.equal(evidence.warnings.length, 2);
});

test('same card family with close parallel candidates returns family-level identity instead of inventing a variant', () => {
  const result = rerankVisualCandidates({
    candidates: [
      candidate({
        catalogCardId: crypto.randomUUID(),
        parallelName: 'Refractor',
        canonicalKey: '2023|topps chrome|12|refractor',
        cosineSimilarity: 0.91,
        combinedCosineSimilarity: 0.91,
      }),
      candidate({
        catalogCardId: crypto.randomUUID(),
        parallelName: 'Prism Refractor',
        canonicalKey: '2023|topps chrome|12|prism refractor',
        cosineSimilarity: 0.895,
        combinedCosineSimilarity: 0.895,
      }),
    ],
    evidence: {
      releaseYear: 2023,
      setCode: 'TC23',
      cardNumber: '12',
      fieldConfidence: { releaseYear: 0.98, setCode: 0.98, cardNumber: 0.99 },
    },
  });
  assert.equal(result.identityLevel, 'card_family');
  assert.equal(result.variantAmbiguous, true);
  assert.equal(result.accepted, false);
  assert.equal(result.needsConfirmation, true);
  assert.ok(result.warnings.some((warning) => warning.includes('parallel or variant')));
});

test('low similarity candidates are treated as possible out-of-catalog unknowns', () => {
  const result = rerankVisualCandidates({
    candidates: [candidate({ cosineSimilarity: 0.42, combinedCosineSimilarity: 0.42, frontCosineSimilarity: null, backCosineSimilarity: null })],
  });
  assert.equal(result.identityLevel, 'unknown');
  assert.equal(result.outOfCatalog, true);
  assert.equal(result.accepted, false);
  assert.ok(result.warnings.some((warning) => warning.includes('outside the indexed catalog')));
});
