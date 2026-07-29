import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateScanConfidence } from '../src/services/scan-confidence.js';

const image = (char = 'a', length = 6000) => `data:image/jpeg;base64,${char.repeat(length)}`;

test('vision image-quality warnings reduce scan confidence', () => {
  const confidence = evaluateScanConfidence({
    body: {
      frontDataUrl: image(),
      backDataUrl: image('b'),
      manualText: '2018 Topps Update Shohei Ohtani US1 PSA 10',
    },
    vision: {
      facts: { player: 'Shohei Ohtani', year: 2018, set: 'Update Series', cardNumber: 'US1', parallel: 'Base Rookie Debut', grade: '10' },
      imageQuality: { blur: 'heavy', glare: 'heavy', crop: 'partial', lighting: 'dim', angle: 'severe', warnings: ['Retake recommended.'] },
    },
    matches: [{ id: 'card_ohtani', player: 'Shohei Ohtani', year: 2018, set: 'Update Series', cardNumber: 'US1', parallel: 'Base Rookie Debut', grade: { company: 'PSA', grade: '10' } }],
  });
  assert.equal(confidence.needsManualConfirmation, true);
  assert.ok(confidence.imageQualityScore < 70);
  assert.ok(confidence.warnings.some((warning) => /heavy blur/i.test(warning)));
  assert.ok(confidence.warnings.some((warning) => /Retake recommended/i.test(warning)));
  assert.ok(confidence.explanation.whyMatched.some((reason) => /subject/i.test(reason)));
  assert.ok(confidence.explanation.photoGuidance.some((item) => /sharper|glare|full card|Flatten|Retake/i.test(item)));
  assert.equal(confidence.topCandidates.length, 1);
});

test('high-value cards require elite scan confidence before action', () => {
  const confidence = evaluateScanConfidence({
    body: {
      frontDataUrl: image(),
      backDataUrl: image('b'),
      manualText: '1986 Fleer Michael Jordan 57 PSA 10',
    },
    vision: {
      facts: { player: 'Michael Jordan', year: 1986, set: 'Fleer Basketball', cardNumber: '57', grade: '10' },
      imageQuality: { blur: 'none', glare: 'none', crop: 'full_card', lighting: 'good', angle: 'flat' },
    },
    matches: [{ id: 'card_jordan', player: 'Michael Jordan', year: 1986, set: 'Fleer Basketball', cardNumber: '57', parallel: 'Base Rookie', grade: { company: 'PSA', grade: '10' }, market: { value: 5000 } }],
  });
  assert.equal(confidence.needsManualConfirmation, true);
  assert.ok(confidence.warnings.some((warning) => /High-value card/i.test(warning)));
  assert.ok(confidence.manualConfirmationReasons.some((reason) => /high-value/i.test(reason)));
});

test('catalog candidates cannot create observed identity confidence', () => {
  const confidence = evaluateScanConfidence({
    body: { frontDataUrl: image() },
    vision: { facts: {}, imageQuality: { blur: 'none', glare: 'none', crop: 'full_card', lighting: 'good', angle: 'flat' } },
    matches: [{
      id: 'candidate_only',
      player: 'Shohei Ohtani',
      year: 2018,
      brand: 'Topps',
      set: 'Update Series',
      cardNumber: 'US1',
      parallel: 'Gold /2018',
      grade: { company: 'PSA', grade: '10' },
    }],
  });

  assert.equal(confidence.observedIdentityEvidence.present, false);
  assert.equal(confidence.needsManualConfirmation, true);
  assert.ok(confidence.scanConfidenceScore <= 35);
  assert.deepEqual(confidence.explanation.whyMatched, []);
  assert.ok(confidence.manualConfirmationReasons.includes('no observed identity evidence'));
});
