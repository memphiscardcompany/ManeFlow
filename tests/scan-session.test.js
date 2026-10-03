import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/services/store.js';
import { createScanSession, confirmScanSession, scanQualityAnalytics } from '../src/services/scan-session.js';

const actor = { userId: 'user_scan_test', role: 'collector' };

async function withStore(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-scan-session-'));
  const store = await new JsonStore(path.join(directory, 'state.json')).init();
  try { return await fn(store); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('scan sessions persist explanations, top candidates, and correction learning', async () => withStore(async (store) => {
  const session = await createScanSession(store, actor, {
    body: {
      manualText: '2026 Topps Chrome Test Player 101',
      frontDataUrl: 'data:image/jpeg;base64,' + 'a'.repeat(6000),
    },
    vision: {
      facts: { player: 'Test Player', year: 2026, brand: 'Topps', set: 'Chrome Baseball', cardNumber: '101' },
      imageQuality: { blur: 'none', glare: 'none', crop: 'full_card', lighting: 'good', angle: 'flat' },
    },
    matches: [
      { id: 'card_a', year: 2026, brand: 'Topps', set: 'Chrome Baseball', player: 'Test Player', cardNumber: '101', parallel: 'Gold', confidence: 0.88 },
      { id: 'card_b', year: 2026, brand: 'Topps', set: 'Chrome Baseball', player: 'Test Player', cardNumber: '101', parallel: 'Base', confidence: 0.83 },
    ],
    result: { query: '2026 Topps Chrome Test Player 101', mode: 'vision_catalog' },
  });
  assert.ok(session.explanation.whyMatched.length >= 3);
  assert.equal(session.topCandidates.length, 2);
  assert.equal(session.status, 'needs_confirmation');
  assert.equal(session.selectedCardId, null);
  await assert.rejects(
    confirmScanSession(store, actor, session.id, {}),
    (error) => error.code === 'EXACT_CARD_SELECTION_REQUIRED' && error.status === 422,
  );
  assert.equal(store.state.scanSessions[0].status, 'needs_confirmation');

  const confirmed = await confirmScanSession(store, actor, session.id, {
    cardId: 'card_b',
    correctedFields: { parallel: 'Base' },
    notes: 'User selected base after checking back image.',
  });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(store.state.scanCorrections.length, 1);
  const analytics = scanQualityAnalytics(store.state);
  assert.equal(analytics.corrections, 1);
  assert.ok(analytics.commonUncertainFields.some((row) => row.field === 'parallel'));
}));

test('recognition abstention survives scan-session creation even when legacy confidence is high', async () => withStore(async (store) => {
  const session = await createScanSession(store, actor, {
    body: { manualText: '2026 Topps Chrome Test Player 101', frontDataUrl: 'data:image/jpeg;base64,' + 'a'.repeat(6000) },
    vision: { facts: { player: 'Test Player', year: 2026, brand: 'Topps', set: 'Chrome Baseball', cardNumber: '101', parallel: 'Gold' } },
    matches: [{ id: 'card_a', player: 'Test Player', year: 2026, brand: 'Topps', set: 'Chrome Baseball', cardNumber: '101', parallel: 'Gold' }],
    result: { needsConfirmation: true },
    recognition: { primary: { requiresManualConfirmation: true } },
  });
  assert.equal(session.status, 'needs_confirmation');
  assert.equal(session.selectedCardId, null);
  assert.deepEqual(session.matchIds, ['card_a']);
}));
