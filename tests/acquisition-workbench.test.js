import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/services/store.js';
import { authorizeAcquisition } from '../src/services/acquisition-gate.js';
import { upsertSourcePolicy } from '../src/services/data-rights-registry.js';
import { captureManualComp, manualCompToPricingRow, reviewManualComp } from '../src/services/manual-comp-capture.js';
import { parseEvidenceText } from '../src/services/evidence-parser.js';
import { robotsDecision } from '../src/services/source-policy.js';

async function testStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-acquisition-'));
  const store = await new JsonStore(path.join(dir, 'state.json')).init();
  return { store, dir };
}

test('unknown and prohibited acquisition sources fail closed', async () => {
  const { store, dir } = await testStore();
  try {
    const unknown = authorizeAcquisition(store.state, 'Unknown Visible Website', { url: 'https://example.com/sale/1' });
    assert.equal(unknown.allowed, false);
    assert.match(unknown.blockedReason, /Unknown source/);

    await upsertSourcePolicy(store, { userId: 'owner' }, {
      provider: 'Blocked Market',
      sourceType: 'prohibited',
      legalReviewStatus: 'approved',
      ownerApprovalStatus: 'approved',
    });
    const blocked = authorizeAcquisition(store.state, 'Blocked Market', { url: 'https://blocked.example/sale/1' });
    assert.equal(blocked.allowed, false);
    assert.match(blocked.blockedReason, /prohibited/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('approved public source still respects robots disallow', async () => {
  const { store, dir } = await testStore();
  try {
    await upsertSourcePolicy(store, { userId: 'owner' }, {
      provider: 'Approved Public Auction',
      sourceType: 'approved_public_web',
      authorizationBasis: 'public_web_allowed',
      legalReviewStatus: 'approved',
      ownerApprovalStatus: 'approved',
      valuationEligible: false,
      publicDisplayEligible: false,
      allowedPaths: ['/sales'],
    });
    const robots = robotsDecision('User-agent: *\nDisallow: /sales', 'https://auction.example/sales/123');
    assert.equal(robots.allowed, false);
    const decision = authorizeAcquisition(store.state, 'Approved Public Auction', {
      url: 'https://auction.example/sales/123',
      robotsText: 'User-agent: *\nDisallow: /sales',
    });
    assert.equal(decision.allowed, false);
    assert.match(decision.blockedReason, /robots/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('manual comp evidence starts review-only and converts to pricing row after approval', async () => {
  const { store, dir } = await testStore();
  try {
    const actor = { userId: 'owner', role: 'admin' };
    const comp = await captureManualComp(store, actor, {
      text: 'eBay sold for $125.50 on 2026-07-01. 2018 Topps Update Shohei Ohtani #US1 PSA 10 cert 12345678',
      provider: 'Manual Comp Evidence',
      evidenceType: 'screenshot_evidence',
      notes: 'Captured from seller-owned evidence.',
    });
    assert.equal(comp.reviewStatus, 'needs_review');
    assert.equal(comp.valuationUse, false);
    assert.equal(comp.extracted.price, 125.5);

    const reviewed = await reviewManualComp(store, actor, comp.id, { decision: 'approved', valuationUse: true, publicDisplayEligible: false });
    assert.equal(reviewed.reviewStatus, 'approved');
    assert.equal(reviewed.valuationUse, true);
    const row = manualCompToPricingRow(reviewed);
    assert.equal(row.id, comp.id);
    assert.equal(row.isCompletedSale, true);
    assert.equal(row.provider, 'Manual Comp Evidence');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('evidence parser extracts price, date, cert, grade, and warnings conservatively', () => {
  const parsed = parseEvidenceText({
    text: 'Heritage sale price: $2,400. Shipping: $25. Date: 07/01/2026. PSA 10 Cert #87654321 1986 Fleer Michael Jordan #57',
  });
  assert.equal(parsed.provider, 'Heritage Manual Evidence');
  assert.equal(parsed.price, 2400);
  assert.equal(parsed.shipping, 25);
  assert.equal(parsed.certNumber, '87654321');
  assert.equal(parsed.grader, 'PSA');
  assert.equal(parsed.grade, '10');
  assert.ok(parsed.confidence > 0.6);
});
