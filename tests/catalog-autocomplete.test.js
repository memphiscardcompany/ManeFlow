import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { catalogAutocomplete, completeManualEntry, smartCatalogAutocomplete } from '../src/services/catalog-autocomplete.js';
import { createRouter } from '../src/router.js';
import { JsonStore } from '../src/services/store.js';
import { TtlCache } from '../src/services/cache.js';
import { createProviderRegistry } from '../src/services/provider-registry.js';

async function loadFixture(name) {
  return JSON.parse(await fs.readFile(new URL(`../src/data/${name}`, import.meta.url), 'utf8'));
}

async function makeServer() {
  const cards = await loadFixture('cards.json');
  const sales = await loadFixture('sales.json');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-catalog-auto-'));
  const config = {
    appName: 'ManeFlow',
    version: '2.2.0',
    releaseChannel: 'test',
    port: 0,
    host: '127.0.0.1',
    publicBaseUrl: 'http://127.0.0.1',
    apiToken: '',
    adminToken: 'admin-test-token',
    bootstrapAdminEmail: '',
    demoMode: true,
    allowGuestWrites: false,
    allowPublicSignups: true,
    requireEmailVerification: false,
    exposeDevTokens: true,
    accountTokenMinutes: 60,
    sessionDays: 30,
    allowedOrigins: [],
    widgetAllowedOrigins: [],
    maxRequestBytes: 14_000_000,
    runtimeFile: path.join(directory, 'state.json'),
    openaiApiKey: '',
    openaiVisionModel: '',
    providerWebhookSecret: 'test-secret',
    emailWebhookUrl: '',
    emailWebhookSecret: '',
    ebayClientId: '',
    ebayClientSecret: '',
    ebayMarketplaceInsightsEnabled: false,
    ebayUserAccessToken: '',
    ebayMarketplaceId: 'EBAY_US',
    ebayEnvironment: 'sandbox',
    ebayRequestTimeoutMs: 3000,
    ebayMaxRetries: 0,
    ebayMinBackoffMs: 100,
  };
  const store = await new JsonStore(config.runtimeFile).init();
  const providers = createProviderRegistry(config, sales);
  const server = http.createServer(createRouter({ config, cards, sales, providers, store, cache: new TtlCache() }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, directory };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function withServer(fn) {
  const ctx = await makeServer();
  try {
    return await fn(ctx);
  } finally {
    await new Promise((resolve) => ctx.server.close(resolve));
    await fs.rm(ctx.directory, { recursive: true, force: true });
  }
}

test('catalog autocomplete suggests loaded set data for manual card entry', async () => {
  const cards = await loadFixture('cards.json');
  const result = catalogAutocomplete(cards, { year: 2018, brand: 'Topps', set: 'Update Series', limit: 10 });
  assert.ok(result.suggestions.cardNumbers.some((item) => item.value === 'US1'));
  assert.ok(result.suggestions.players.some((item) => item.value === 'Shohei Ohtani'));
  assert.ok(result.suggestions.parallels.some((item) => /rookie/i.test(item.value)));
  assert.equal(result.coverage.cardCount, cards.length);
  assert.match(result.disclaimer, /loaded/i);
});

test('manual entry completion auto-populates an exact catalog card', async () => {
  const cards = await loadFixture('cards.json');
  const result = completeManualEntry(cards, {
    year: 2018,
    brand: 'Topps',
    set: 'Update Series',
    player: 'Shohei Ohtani',
    cardNumber: 'US1',
    parallel: 'Base Rookie Debut',
  });
  assert.equal(result.accepted, true);
  assert.equal(result.autopopulate.cardId, 'card_ohtani_2018_update_us1_psa10');
  assert.equal(result.autopopulate.player, 'Shohei Ohtani');
  assert.match(result.message, /auto-fill/i);
});

test('manual entry preserves unmatched cards without inventing catalog coverage', async () => {
  const cards = await loadFixture('cards.json');
  const result = completeManualEntry(cards, { year: 2026, brand: 'Unknown Brand', set: 'Missing Set', player: 'New Prospect', cardNumber: '999' });
  assert.equal(result.accepted, false);
  assert.equal(result.autopopulate.cardId, '');
  assert.match(result.autopopulate.name, /New Prospect/);
  assert.match(result.message, /No exact catalog row/i);
});

test('smart catalog autocomplete returns pickable inventory logging candidates', async () => {
  const cards = await loadFixture('cards.json');
  const result = smartCatalogAutocomplete(cards, { q: '2018 Topps Ohtani US1 PSA 10', limit: 5 });
  assert.equal(result.mode, 'smart_catalog_autocomplete');
  assert.ok(result.candidates.length >= 1);
  assert.equal(result.candidates[0].autofill.cardId, 'card_ohtani_2018_update_us1_psa10');
  assert.equal(result.candidates[0].autofill.player, 'Shohei Ohtani');
  assert.equal(result.candidates[0].autofill.cardNumber, 'US1');
  assert.match(result.candidates[0].lookupTitle, /2018 Topps/);
  assert.ok(result.candidates[0].matchReason.includes('card number'));
  assert.equal(result.candidates[0].rawPayload, undefined);
});

test('smart catalog autocomplete supports PSA-style partial, player, set-number, and fuzzy ranking', () => {
  const cards = [
    { id: 'lebron_2023_prizm_1', year: 2023, brand: 'Panini', set: 'Prizm Basketball', player: 'LeBron James', cardNumber: '1', parallel: 'Silver Prizm', sport: 'Basketball', grade: { company: 'RAW', grade: 'Raw' }, aliases: ['King James'] },
    { id: 'wemby_2023_prizm_136', year: 2023, brand: 'Panini', set: 'Prizm Basketball', player: 'Victor Wembanyama', cardNumber: '136', parallel: 'Base Rookie', sport: 'Basketball', grade: { company: 'RAW', grade: 'Raw' }, aliases: ['Wemby'] },
    { id: 'judge_2017_topps_287', year: 2017, brand: 'Topps', set: 'Topps Series 1', player: 'Aaron Judge', cardNumber: '287', parallel: 'Base Rookie', sport: 'Baseball', grade: { company: 'RAW', grade: 'Raw' } },
  ];
  const partialSet = smartCatalogAutocomplete(cards, { q: '2023 Prizm', limit: 3 });
  assert.equal(partialSet.status, 'ambiguous');
  assert.ok(partialSet.candidates.every((card) => card.set === 'Prizm Basketball'));

  const player = smartCatalogAutocomplete(cards, { q: 'Judge', limit: 3 });
  assert.equal(player.candidates[0].id, 'judge_2017_topps_287');

  const setNumber = smartCatalogAutocomplete(cards, { year: 2023, set: 'Prizm Basketball', q: '136', limit: 3 });
  assert.equal(setNumber.candidates[0].id, 'wemby_2023_prizm_136');

  const misspelled = smartCatalogAutocomplete(cards, { q: 'Wembanyma 136 Prizm', limit: 3 });
  assert.equal(misspelled.candidates[0].id, 'wemby_2023_prizm_136');
});

test('smart catalog autocomplete handles Pokemon, TCG numbering, accents, variants, and empty input safely', () => {
  const cards = [
    { id: 'pikachu_sv151_173', year: 2023, brand: 'Pokemon', set: 'Scarlet & Violet 151', player: 'Pikachu', cardNumber: '173/165', parallel: 'Illustration Rare', sport: 'Pokemon', grade: { company: 'RAW', grade: 'Raw' }, aliases: ['SV 151 Pikachu IR'] },
    { id: 'charizard_svp_056', year: 2023, brand: 'Pokemon', set: 'Scarlet & Violet Promo', player: 'Charizard ex', cardNumber: '056/SVP', parallel: 'Black Star Promo', sport: 'Pokemon', grade: { company: 'RAW', grade: 'Raw' } },
    { id: 'jose_2022_error_1of1', year: 2022, brand: 'Topps', set: 'Chrome Baseball', player: 'José Ramírez', cardNumber: '77', parallel: 'Printing Plate Error 1/1', serialNumber: '1/1', sport: 'Baseball', grade: { company: 'RAW', grade: 'Raw' } },
  ];
  const pokemon = smartCatalogAutocomplete(cards, { q: 'SV 151 173/165 Pikachu', limit: 3 });
  assert.equal(pokemon.candidates[0].id, 'pikachu_sv151_173');
  assert.ok(pokemon.candidates[0].matchReason.includes('card number'));

  const promo = smartCatalogAutocomplete(cards, { q: 'Charizard 056 SVP promo', limit: 3 });
  assert.equal(promo.candidates[0].id, 'charizard_svp_056');

  const accent = smartCatalogAutocomplete(cards, { q: 'Jose Ramirez 1/1 printing plate error', limit: 3 });
  assert.equal(accent.candidates[0].id, 'jose_2022_error_1of1');
  assert.ok(accent.candidates[0].matchReason.includes('serial number'));

  const empty = smartCatalogAutocomplete(cards, { q: '', limit: 3 });
  assert.equal(empty.status, 'needs_input');
  assert.equal(empty.candidates.length, 0);

  const nonsense = smartCatalogAutocomplete(cards, { q: 'zzzz-not-a-card', limit: 3 });
  assert.equal(nonsense.status, 'no_match');
  assert.equal(nonsense.candidates.length, 0);
});

test('smart catalog autocomplete remains responsive with long modern checklists', () => {
  const cards = Array.from({ length: 900 }, (_, index) => ({
    id: `bulk_${index}`,
    year: 2026,
    brand: 'Topps',
    set: index % 2 ? 'Chrome Baseball' : 'Series 1 Baseball',
    player: `Checklist Player ${index}`,
    cardNumber: String(index + 1),
    parallel: index % 25 === 0 ? 'Gold Refractor /50' : 'Base',
    sport: 'Baseball',
    grade: { company: 'RAW', grade: 'Raw' },
  }));
  cards.push({ id: 'bulk_target', year: 2026, brand: 'Topps', set: 'Chrome Baseball', player: 'Elly De La Cruz', cardNumber: '401', parallel: 'Superfractor 1/1', serialNumber: '1/1', sport: 'Baseball', grade: { company: 'RAW', grade: 'Raw' } });
  const started = performance.now();
  const result = smartCatalogAutocomplete(cards, { q: '2026 chrome elly 401 superfractor 1/1', limit: 5 });
  const elapsed = performance.now() - started;
  assert.equal(result.candidates[0].id, 'bulk_target');
  assert.ok(elapsed < 250, `autocomplete took ${elapsed}ms`);
});

test('catalog autocomplete API returns public-safe suggestions and completion data', async () => withServer(async ({ baseUrl }) => {
  const auto = await request(baseUrl, '/api/catalog/autocomplete?year=2018&brand=Topps&set=Update%20Series&cardNumber=US1&limit=5');
  assert.equal(auto.response.status, 200);
  assert.equal(auto.body.exactCard.id, 'card_ohtani_2018_update_us1_psa10');
  assert.equal(auto.body.exactCard.rawPayload, undefined);

  const complete = await request(baseUrl, '/api/catalog/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year: 2018, brand: 'Topps', set: 'Update Series', player: 'Shohei Ohtani', cardNumber: 'US1', parallel: 'Base Rookie Debut' }),
  });
  assert.equal(complete.response.status, 200);
  assert.equal(complete.body.autopopulate.cardId, 'card_ohtani_2018_update_us1_psa10');
}));

test('smart catalog autocomplete API returns autofill candidates for manual entry bars', async () => withServer(async ({ baseUrl }) => {
  const auto = await request(baseUrl, '/api/catalog/smart-autocomplete?q=2018%20Topps%20Ohtani%20US1%20PSA%2010&limit=5');
  assert.equal(auto.response.status, 200);
  assert.equal(auto.body.mode, 'smart_catalog_autocomplete');
  assert.equal(auto.body.candidates[0].autofill.cardId, 'card_ohtani_2018_update_us1_psa10');
  assert.equal(auto.body.candidates[0].autofill.player, 'Shohei Ohtani');
  assert.match(auto.body.disclaimer, /authorized/i);
}));
