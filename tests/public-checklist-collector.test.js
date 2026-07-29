import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { authorizeAcquisition } from '../src/services/acquisition-gate.js';
import { extractChecklistCardsFromHtml, collectApprovedChecklistPage } from '../src/services/public-checklist-collector.js';
import { JsonStore } from '../src/services/store.js';

function response(text, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    async text() { return text; },
  };
}

async function withStore(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-public-checklist-'));
  const store = await new JsonStore(path.join(directory, 'state.json')).init();
  try {
    return await fn(store);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('public checklist HTML extraction creates identity-only catalog rows', () => {
  const html = `
    <h1>2026 Topps Series 1 Baseball Checklist</h1>
    <p>#1 Shohei Ohtani</p>
    <p>2 Aaron Judge</p>
    <p>Odds and pack information</p>
  `;
  const result = extractChecklistCardsFromHtml(html, {
    provider: 'Topps Official Checklists',
    year: 2026,
    brand: 'Topps',
    set: 'Series 1',
    sport: 'Baseball',
  });
  assert.equal(result.summary.unique, 2);
  assert.deepEqual(result.cards.map((card) => card.cardNumber), ['1', '2']);
  assert.equal(result.cards[0].player, 'Shohei Ohtani');
  assert.equal(result.cards[0].catalogSource, 'Topps Official Checklists');
});

test('approved public checklist collection respects source policy and stores cards only outside dry run', async () => withStore(async (store) => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/robots.txt')) return response('User-agent: *\nAllow: /\n');
    return response('<p>#1 Shohei Ohtani</p><p>#2 Aaron Judge</p>');
  };
  const dryRun = await collectApprovedChecklistPage({
    store,
    source: 'Topps Official Checklists',
    url: 'https://www.topps.com/pages/checklists',
    fetchImpl,
    dryRun: true,
    context: { year: 2026, brand: 'Topps', set: 'Series 1', sport: 'Baseball' },
  });
  assert.equal(dryRun.decision.allowed, true);
  assert.equal(dryRun.summary.unique, 2);
  assert.equal(store.state.customCards.length, 0);

  store.state.acquisitionRuns = [];
  const liveRun = await collectApprovedChecklistPage({
    store,
    source: 'Topps Official Checklists',
    url: 'https://www.topps.com/pages/checklists',
    fetchImpl,
    dryRun: false,
    context: { year: 2026, brand: 'Topps', set: 'Series 1', sport: 'Baseball' },
  });
  assert.equal(liveRun.summary.unique, 2);
  assert.equal(store.state.customCards.length, 2);
  assert.equal(store.state.customCards[0].catalogSource, 'Topps Official Checklists');
}));

test('prohibited checklist sources are blocked by acquisition gate', async () => withStore(async (store) => {
  const decision = authorizeAcquisition(store.state, 'Trading Card Database', {
    url: 'https://www.tcdb.com/ViewSet.cfm/sid/12345',
    purpose: 'approved_public_checklist_identity_collection',
    robotsText: 'User-agent: *\nAllow: /\n',
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.blockedReason, /prohibited/i);
}));
