import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBarcodePayload, extractCertFromText } from '../src/services/barcode-parser.js';
import { certStatusLabel, collectCertEvidence, parseCertByGrader, parseSlabLabelText } from '../src/services/cert-accuracy.js';
import { analyzeGradedCert } from '../src/services/graded-cert.js';
import { evaluateScanConfidence } from '../src/services/scan-confidence.js';

test('PSA QR URL extracts grader and cert number', () => {
  const parsed = parseBarcodePayload('https://www.psacard.com/cert/12345678');
  assert.equal(parsed.decoded, true);
  assert.equal(parsed.grader, 'PSA');
  assert.equal(parsed.certNumber, '12345678');
  assert.equal(parsed.verificationUrl, 'https://www.psacard.com/cert/12345678');
});

test('visible cert text fallback extracts grader and cert number', () => {
  const parsed = extractCertFromText('BGS GEM MINT 9.5 Certification Number: 0009876543');
  assert.equal(parsed.grader, 'BGS');
  assert.equal(parsed.certNumber, '0009876543');
});

test('grader-specific cert parsers handle PSA, BGS, SGC, and CGC evidence', () => {
  assert.equal(parseCertByGrader('PSA', 'https://www.psacard.com/cert/12345678').certNumber, '12345678');
  assert.equal(parseCertByGrader('BGS', 'Beckett Certification Number: 0009876543').certNumber, '0009876543');
  assert.equal(parseCertByGrader('SGC', 'https://www.gosgc.com/cert-code-lookup?certificateNumber=AA12345').certNumber, 'AA12345');
  assert.equal(parseCertByGrader('CGC', 'https://www.cgcgrading.com/verify/1401000001').certNumber, '1401000001');
});

test('OCR-noisy PSA cert payload is normalized before matching', () => {
  const parsed = parseBarcodePayload('https://www.psacard.com/cert/12O45S78');
  assert.equal(parsed.decoded, true);
  assert.equal(parsed.grader, 'PSA');
  assert.equal(parsed.rawCertNumber, '12O45S78');
  assert.equal(parsed.certNumber, '12045578');
});

test('slab label text extracts cert, grade, card number, and useful identity hints', () => {
  const label = parseSlabLabelText(`PSA GEM MT 10
Cert #12345678
2018 Topps Update Series
Shohei Ohtani
#US1 Base Rookie Debut`);
  assert.equal(label.grader, 'PSA');
  assert.equal(label.certNumber, '12345678');
  assert.equal(label.grade, '10');
  assert.equal(label.year, 2018);
  assert.equal(label.cardNumber, 'US1');
  assert.equal(label.playerHint, 'Shohei Ohtani');
});

test('cert evidence detects conflicts between barcode and visible label', () => {
  const evidence = collectCertEvidence({
    qrText: 'https://www.psacard.com/cert/12345678',
    certText: 'PSA GEM MT 10 Cert #87654321 2018 Topps Update Shohei Ohtani #US1',
  });
  assert.equal(evidence.best.certNumber, '12345678');
  assert.ok(evidence.conflicts.some((conflict) => conflict.field === 'certNumber'));
  assert.notEqual(evidence.extractionTier, 'cert_locked');
  assert.ok(evidence.warnings.some((warning) => /certNumber conflict/i.test(warning)));
});

test('graded cert analysis builds manual verification result and agreement score', async () => {
  const graded = await analyzeGradedCert({
    body: { qrText: 'https://www.psacard.com/cert/12345678', certText: 'PSA 10 2018 Topps Update Shohei Ohtani US1' },
    vision: { grader: 'PSA', grade: '10', player: 'Shohei Ohtani', year: 2018, set: 'Update', cardNumber: 'US1', visibleText: 'PSA 10 Cert 12345678' },
  }, { state: {} });
  assert.equal(graded.slabbed, true);
  assert.equal(graded.grader, 'PSA');
  assert.equal(graded.certNumber, '12345678');
  assert.equal(graded.verificationStatus, 'manual_verify_recommended');
  assert.equal(graded.verificationLabel, 'parsed_not_officially_verified');
  assert.equal(graded.officialVerificationConnected, false);
  assert.equal(graded.parsedNotVerified, true);
  assert.ok(graded.certConfidence >= 60);
});

test('cert status labels never overclaim official verification', () => {
  assert.equal(certStatusLabel('official_verified'), 'officially_verified');
  assert.equal(certStatusLabel('cert_number_extracted'), 'parsed_not_officially_verified');
  assert.equal(certStatusLabel('manual_verify_recommended'), 'parsed_not_officially_verified');
  assert.equal(certStatusLabel('mismatch_detected'), 'conflict_needs_review');
});

test('graded cert analysis can lock onto cert-only slab text', async () => {
  const graded = await analyzeGradedCert({
    body: {
      certText: `PSA GEM MT 10
Cert #12345678
2018 Topps Update Series
Shohei Ohtani
#US1 Base Rookie Debut`,
    },
  }, { state: {} });
  assert.equal(graded.slabbed, true);
  assert.equal(graded.grader, 'PSA');
  assert.equal(graded.certNumber, '12345678');
  assert.equal(graded.grade, '10');
  assert.equal(graded.year, '2018');
  assert.equal(graded.cardNumber, 'US1');
  assert.ok(graded.extractionCompletenessScore >= 80);
  assert.equal(graded.extractionTier, 'cert_locked');
  assert.ok(graded.certEvidence.candidates.some((item) => item.source === 'visible_label'));
});

test('cert mismatch lowers scan confidence and requires manual confirmation', async () => {
  const graded = await analyzeGradedCert({
    body: { qrText: 'https://www.psacard.com/cert/12345678', certText: 'PSA 10 Ohtani' },
    vision: { grader: 'PSA', grade: '9', player: 'Shohei Ohtani', year: 2018, cardNumber: 'US1' },
  }, { state: {} });
  const confidence = evaluateScanConfidence({
    body: { manualText: '2018 Topps Update Shohei Ohtani US1 PSA 9', frontDataUrl: 'data:image/png;base64,' + 'a'.repeat(5000), gradedCert: graded },
    vision: { grader: 'PSA', grade: '9', player: 'Shohei Ohtani', year: 2018, cardNumber: 'US1' },
    matches: [{ id: 'card_ohtani', player: 'Shohei Ohtani', year: 2018, set: 'Update', cardNumber: 'US1', parallel: 'Base', grade: { company: 'PSA', grade: '9' } }],
  });
  assert.equal(graded.verificationStatus, 'mismatch_detected');
  assert.equal(confidence.needsManualConfirmation, true);
  assert.ok(confidence.warnings.some((warning) => /Cert\/slab/.test(warning)));
});

test('conflicting cert evidence forces scan confirmation even when the slab is readable', async () => {
  const graded = await analyzeGradedCert({
    body: {
      qrText: 'https://www.psacard.com/cert/12345678',
      certText: 'PSA GEM MT 10 Cert #87654321 2018 Topps Update Shohei Ohtani #US1',
    },
  }, { state: {} });
  const confidence = evaluateScanConfidence({
    body: {
      manualText: '2018 Topps Update Shohei Ohtani US1 PSA 10',
      frontDataUrl: 'data:image/png;base64,' + 'a'.repeat(5000),
      backDataUrl: 'data:image/png;base64,' + 'b'.repeat(5000),
      gradedCert: graded,
    },
    matches: [{ id: 'card_ohtani', player: 'Shohei Ohtani', year: 2018, set: 'Update', cardNumber: 'US1', parallel: 'Base', grade: { company: 'PSA', grade: '10' } }],
  });
  assert.ok(graded.certEvidence.conflicts.length >= 1);
  assert.equal(confidence.needsManualConfirmation, true);
  assert.ok(confidence.warnings.some((warning) => /conflicting cert evidence/i.test(warning)));
});
