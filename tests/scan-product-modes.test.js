import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyScanProductModePolicy,
  resolveScanProductMode,
  SCAN_PRODUCT_MODES,
} from '../src/services/scan-product-modes.js';

const exactCandidate = {
  status: 'exact',
  topCandidate: {
    parallelName: 'Base',
    matchedFields: ['cardNumber', 'setCode'],
    frontCosineSimilarity: 0.96,
    backCosineSimilarity: 0.95,
    viewAgreement: 0.98,
  },
};

test('scan product modes keep catalog identification separate from marketplace image search', () => {
  assert.equal(resolveScanProductMode('scan'), SCAN_PRODUCT_MODES.CATALOG_IDENTIFICATION);
  assert.equal(resolveScanProductMode('image search'), SCAN_PRODUCT_MODES.MARKETPLACE_VISUAL_SEARCH);
  assert.throws(() => resolveScanProductMode('imaginary_mode'), /Unsupported scanMode/);
});

test('catalog identification accepts exact only with corroborating evidence', () => {
  const accepted = applyScanProductModePolicy({
    requestedMode: 'catalog_identification',
    result: { exact: true, needsConfirmation: false, matches: [{ parallel: 'Base' }] },
    vectorDecision: exactCandidate,
    body: { frontDataUrl: 'data:image/jpeg;base64,a', backDataUrl: 'data:image/jpeg;base64,b' },
  });
  assert.equal(accepted.exact, true);
  assert.equal(accepted.decisionType, 'exact_card');

  const refused = applyScanProductModePolicy({
    requestedMode: 'catalog_identification',
    result: { exact: true, needsConfirmation: false, matches: [{ parallel: 'Base' }] },
    body: { frontDataUrl: 'data:image/jpeg;base64,a' },
  });
  assert.equal(refused.exact, false);
  assert.match(refused.warnings.join(' '), /corroborating/i);
});

test('marketplace visual search never becomes exact identity or valuation evidence', () => {
  const policy = applyScanProductModePolicy({
    requestedMode: 'marketplace_visual_search',
    result: { exact: true, needsConfirmation: false, matches: [{ id: 'card_1' }] },
    vectorDecision: exactCandidate,
  });
  assert.equal(policy.exact, false);
  assert.equal(policy.identityUseAllowed, false);
  assert.equal(policy.pricingUseAllowed, false);
  assert.equal(policy.candidateSemantics, 'visually_similar_marketplace_context');
});

test('non-base parallel stays unresolved without parallel-specific evidence', () => {
  const policy = applyScanProductModePolicy({
    requestedMode: 'catalog_identification',
    result: { exact: true, needsConfirmation: false, matches: [{ parallel: 'Gold Refractor' }] },
    vectorDecision: {
      ...exactCandidate,
      topCandidate: { ...exactCandidate.topCandidate, parallelName: 'Gold Refractor' },
    },
    body: { frontDataUrl: 'data:image/jpeg;base64,a', backDataUrl: 'data:image/jpeg;base64,b' },
  });
  assert.equal(policy.exact, false);
  assert.equal(policy.decisionType, 'card_family_variant_unresolved');
});

test('cert lookup requires official verification, not OCR extraction alone', () => {
  const parsed = applyScanProductModePolicy({
    requestedMode: 'graded_cert_lookup',
    result: { exact: true, needsConfirmation: false },
    gradedCert: { grader: 'PSA', certNumber: '123', verificationStatus: 'cert_number_extracted' },
  });
  assert.equal(parsed.exact, false);

  const verified = applyScanProductModePolicy({
    requestedMode: 'graded_cert_lookup',
    result: { exact: true, needsConfirmation: false },
    gradedCert: { grader: 'PSA', certNumber: '123', verificationStatus: 'official_verified' },
  });
  assert.equal(verified.exact, true);
});
