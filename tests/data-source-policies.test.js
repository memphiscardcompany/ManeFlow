import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSourcePolicies, findSourcePolicy, normalizeSourcePolicy } from '../src/services/data-rights-registry.js';

test('open recognition datasets can be approved for internal benchmarking only', () => {
  const state = {};
  ensureSourcePolicies(state);
  const policy = findSourcePolicy(state, 'GotThatData Sports Cards Dataset');
  assert.equal(policy.benchmarkEligible, true);
  assert.equal(policy.valuationEligible, false);
  assert.equal(policy.publicDisplayEligible, false);
});

test('restricted websites remain blocked until explicit written permission is recorded', () => {
  const state = {};
  ensureSourcePolicies(state);
  const tcdb = findSourcePolicy(state, 'Trading Card Database');
  const comc = findSourcePolicy(state, 'COMC');
  assert.equal(tcdb.sourceType, 'prohibited');
  assert.equal(tcdb.valuationEligible, false);
  assert.equal(tcdb.catalogEligible, false);
  assert.equal(comc.sourceType, 'prohibited');
  assert.equal(comc.imageEligible, false);
});

test('official TCG APIs can expand catalog and image coverage without creating comps', () => {
  const state = {};
  ensureSourcePolicies(state);
  for (const provider of ['TCGdex API', 'YGOPRODeck API']) {
    const policy = findSourcePolicy(state, provider);
    assert.equal(policy.sourceType, 'official_api');
    assert.equal(policy.catalogEligible, true);
    assert.equal(policy.imageEligible, true);
    assert.equal(policy.valuationEligible, false);
  }
});

test('policy normalization refuses valuation eligibility until review and owner approval are complete', () => {
  const draft = normalizeSourcePolicy({
    provider: 'Potential Partner Feed',
    sourceType: 'partner_feed',
    valuationEligible: true,
    legalReviewStatus: 'needs_review',
    ownerApprovalStatus: 'pending',
  });
  assert.equal(draft.valuationEligible, false);

  const approved = normalizeSourcePolicy({
    provider: 'Approved Partner Feed',
    sourceType: 'partner_feed',
    valuationEligible: true,
    legalReviewStatus: 'approved',
    ownerApprovalStatus: 'approved',
  });
  assert.equal(approved.valuationEligible, true);
});
