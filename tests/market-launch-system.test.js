import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRouter } from '../src/router.js';
import { JsonStore } from '../src/services/store.js';
import { TtlCache } from '../src/services/cache.js';
import { createProviderRegistry } from '../src/services/provider-registry.js';
import { evaluateScanConfidence } from '../src/services/scan-confidence.js';
import { buildDealerDecision } from '../src/services/dealer-decision.js';
import { providerExpansionStubs } from '../src/services/import-jobs.js';

async function makeServer() {
  const cards = JSON.parse(await fs.readFile(new URL('../src/data/cards.json', import.meta.url), 'utf8'));
  const sales = JSON.parse(await fs.readFile(new URL('../src/data/sales.json', import.meta.url), 'utf8'));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-v16-'));
  const config = {
    appName: 'ManeFlow', version: '1.9.0', releaseChannel: 'test', port: 0, host: '127.0.0.1', publicBaseUrl: 'http://127.0.0.1',
    apiToken: '', adminToken: 'admin-test-token', bootstrapAdminEmail: '', demoMode: true, allowGuestWrites: false, allowPublicSignups: true, requireEmailVerification: false, exposeDevTokens: true, accountTokenMinutes: 60, sessionDays: 30,
    allowedOrigins: ['https://shop.example.com'], widgetAllowedOrigins: ['https://shop.example.com'], maxRequestBytes: 14_000_000, runtimeFile: path.join(directory, 'state.json'),
    openaiApiKey: '', openaiVisionModel: '', providerWebhookSecret: 'test-secret', emailWebhookUrl: '', emailWebhookSecret: '',
    ebayClientId: '', ebayClientSecret: '', ebayMarketplaceInsightsEnabled: false, ebayUserAccessToken: '', ebayMarketplaceId: 'EBAY_US', ebayEnvironment: 'sandbox', ebayRequestTimeoutMs: 3000, ebayMaxRetries: 0, ebayMinBackoffMs: 100,
  };
  const store = await new JsonStore(config.runtimeFile).init();
  const providers = createProviderRegistry(config, sales);
  const server = http.createServer(createRouter({ config, cards, sales, providers, store, cache: new TtlCache() }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, directory, cards, sales, store };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

async function registerAndLogin(baseUrl, { name, email, password }) {
  const registered = await request(baseUrl, '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  assert.equal(registered.response.status, 202);
  const login = await request(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.response.status, 200);
  return login;
}

async function withServer(fn) {
  const ctx = await makeServer();
  try { return await fn(ctx); }
  finally { await new Promise((resolve) => ctx.server.close(resolve)); await fs.rm(ctx.directory, { recursive: true, force: true }); }
}

test('scan confidence requires confirmation when back image and parallel certainty are missing', () => {
  const confidence = evaluateScanConfidence({ body: { manualText: '2018 Topps Update Shohei Ohtani US1 PSA 10' }, matches: [{ id: 'card_1', player: 'Shohei Ohtani', year: 2018, set: 'Update', cardNumber: 'US1', grade: { company: 'PSA', grade: '10' } }] });
  assert.equal(confidence.needsManualConfirmation, true);
  assert.equal(confidence.needsBackImage, true);
  assert.ok(confidence.warnings.some((warning) => warning.includes('Back image')));
});

test('dealer decision produces merchant pricing guidance from valuation data', () => {
  const card = { id: 'card_a', player: 'Shohei Ohtani', year: 2018, brand: 'Topps', set: 'Update', cardNumber: 'US1', grade: { company: 'PSA', grade: '10' } };
  const sales = [
    { id: 's1', cardId: 'card_a', provider: 'Licensed Feed', sourceMode: 'production', authorizationBasis: 'written_license', sourceType: 'sold', saleType: 'fixed_price', isCompletedSale: true, soldAt: '2026-07-01T00:00:00Z', allInPrice: 120, verified: true, confidence: 0.95 },
    { id: 's2', cardId: 'card_a', provider: 'Licensed Feed', sourceMode: 'production', authorizationBasis: 'written_license', sourceType: 'sold', saleType: 'auction', isCompletedSale: true, soldAt: '2026-07-02T00:00:00Z', allInPrice: 130, verified: true, confidence: 0.95 },
  ];
  const decision = buildDealerDecision({ card, sales, demoMode: false });
  assert.ok(decision.dealerBuyRange.low < decision.fairListPrice);
  assert.ok(decision.suggestedAction.length > 10);
  assert.match(decision.disclaimer, /not an appraisal/i);
});

test('multi-shop routes isolate shop inventory and enforce merchant gates', async () => withServer(async ({ baseUrl, cards }) => {
  const merchant = await registerAndLogin(baseUrl, { name: 'Shop Owner', email: 'shop@example.com', password: 'shop-password-123' });
  const collector = await registerAndLogin(baseUrl, { name: 'Collector', email: 'collector@example.com', password: 'collector-password-123' });
  const users = await request(baseUrl, '/api/admin/users', { headers: { authorization: 'Bearer admin-test-token' } });
  const shopUser = users.body.users.find((u) => u.email === 'shop@example.com');
  await request(baseUrl, `/api/admin/users/${shopUser.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' }, body: JSON.stringify({ plan: 'merchant', role: 'merchant' }) });
  const org = await request(baseUrl, '/api/organizations', { method: 'POST', headers: { 'content-type': 'application/json', cookie: merchant.cookie }, body: JSON.stringify({ name: '901 Cards' }) });
  assert.equal(org.response.status, 201);
  const item = await request(baseUrl, `/api/organizations/${org.body.organization.id}/inventory`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: merchant.cookie }, body: JSON.stringify({ cardId: cards[0].id, quantity: 2, costBasis: 50 }) });
  assert.equal(item.response.status, 201);
  const denied = await request(baseUrl, `/api/organizations/${org.body.organization.id}/inventory`, { headers: { cookie: collector.cookie } });
  assert.equal(denied.response.status, 403);
}));

test('website embed endpoints enforce allowed origins and expose public-safe value data', async () => withServer(async ({ baseUrl, cards }) => {
  const blocked = await request(baseUrl, '/api/embed/scan-intake', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://bad.example.com' }, body: JSON.stringify({ notes: 'test' }) });
  assert.equal(blocked.response.status, 403);
  const allowed = await request(baseUrl, '/api/embed/scan-intake', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://shop.example.com' }, body: JSON.stringify({ notes: 'test' }) });
  assert.equal(allowed.response.status, 202);
  const value = await request(baseUrl, `/api/public/cards/${cards[0].id}/value`, { headers: { origin: 'https://shop.example.com' } });
  assert.equal(value.response.status, 200);
  assert.equal(value.body.card.id, cards[0].id);
  assert.ok(value.body.card.image);
  assert.ok(value.body.card.imageMeta);
  assert.equal(value.body.card.ownerUserId, undefined);
  assert.equal(value.body.includedComps.some((comp) => comp.rawPayload), false);
}));

test('card image source endpoint exposes public-safe source policy', async () => withServer(async ({ baseUrl }) => {
  const sources = await request(baseUrl, '/api/card-images/sources');
  assert.equal(sources.response.status, 200);
  assert.ok(sources.body.configuredHosts.includes('images.pokemontcg.io'));
  assert.ok(sources.body.configuredHosts.includes('cards.lorcast.io'));
  assert.ok(sources.body.configuredHosts.includes('i.ebayimg.com'));
  assert.ok(sources.body.builtInSources.some((source) => source.key === 'pokemon_tcg_api' && source.enabled));
  assert.ok(sources.body.builtInSources.some((source) => source.key === 'ebay_api' && source.enabled));
  assert.match(sources.body.policy, /approved source hosts/i);
}));

test('dealer-grade data ops workbench is admin-only and promotes reviewed manual comps', async () => withServer(async ({ baseUrl, cards, store }) => {
  const denied = await request(baseUrl, '/api/admin/data-sources');
  assert.equal(denied.response.status, 403);

  const sources = await request(baseUrl, '/api/admin/data-sources', { headers: { authorization: 'Bearer admin-test-token' } });
  assert.equal(sources.response.status, 200);
  assert.ok(sources.body.sources.some((source) => source.provider === 'Manual Comp Evidence'));

  const blocked = await request(baseUrl, '/api/admin/acquisition/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' },
    body: JSON.stringify({ provider: 'Unknown Visible Source', purpose: 'test_unknown_source', dryRun: true }),
  });
  assert.equal(blocked.response.status, 409);
  assert.equal(blocked.body.decision.allowed, false);

  const allowed = await request(baseUrl, '/api/admin/acquisition/authorize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' },
    body: JSON.stringify({ provider: 'Manual Comp Evidence', purpose: 'manual_comp_review', dryRun: true }),
  });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.body.decision.allowed, true);

  const evidence = await request(baseUrl, '/api/admin/evidence/parse', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' },
    body: JSON.stringify({ text: 'eBay sold price: $221.50 shipping $8 Date: 2026-07-01 PSA 10 Cert #12345678 2018 Topps Update Series Shohei Ohtani #US1' }),
  });
  assert.equal(evidence.response.status, 200);
  assert.equal(evidence.body.evidence.price, 221.5);
  assert.equal(evidence.body.evidence.certNumber, '12345678');

  const capture = await request(baseUrl, '/api/admin/manual-comps', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' },
    body: JSON.stringify({
      text: 'eBay sold price: $221.50 shipping $8 Date: 2026-07-01 PSA 10 Cert #12345678 2018 Topps Update Series Shohei Ohtani #US1',
      provider: 'Manual Comp Evidence',
      evidenceType: 'manual_evidence',
      player: cards[0].player,
      year: cards[0].year,
      brand: cards[0].brand,
      set: cards[0].set,
      cardNumber: cards[0].cardNumber,
      parallel: cards[0].parallel,
      grader: cards[0].grade.company,
      grade: cards[0].grade.grade,
      rightsNotes: 'Test evidence captured from an authorized owner review workflow.',
    }),
  });
  assert.equal(capture.response.status, 201);
  assert.equal(capture.body.comp.reviewStatus, 'needs_review');
  assert.equal(capture.body.comp.valuationUse, false);

  const review = await request(baseUrl, `/api/admin/manual-comps/${capture.body.comp.id}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' },
    body: JSON.stringify({ decision: 'approved', valuationUse: true, publicDisplayEligible: false, notes: 'Authorized test approval.' }),
  });
  assert.equal(review.response.status, 200);
  assert.equal(review.body.comp.reviewStatus, 'approved');
  assert.equal(review.body.comp.valuationUse, true);

  const promote = await request(baseUrl, `/api/admin/manual-comps/${capture.body.comp.id}/promote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' },
    body: JSON.stringify({ dryRun: false }),
  });
  assert.equal(promote.response.status, 202);
  assert.ok(promote.body.summary.valuationEligible >= 1);
  assert.ok(store.state.customSales.some((sale) => sale.rawProviderId === capture.body.comp.id && sale.valuationUse === true));
}));

test('dealer decision route is server-gated and returns actionable merchant pricing', async () => withServer(async ({ baseUrl, cards }) => {
  const collector = await registerAndLogin(baseUrl, { name: 'Collector', email: 'dealer-check@example.com', password: 'collector-password-123' });
  const denied = await request(baseUrl, `/api/cards/${cards[0].id}/dealer-decision`, { headers: { cookie: collector.cookie } });
  assert.equal(denied.response.status, 403);

  const users = await request(baseUrl, '/api/admin/users', { headers: { authorization: 'Bearer admin-test-token' } });
  const user = users.body.users.find((item) => item.email === 'dealer-check@example.com');
  await request(baseUrl, `/api/admin/users/${user.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' }, body: JSON.stringify({ plan: 'merchant', role: 'merchant' }) });

  const allowed = await request(baseUrl, `/api/cards/${cards[0].id}/dealer-decision`, { headers: { cookie: collector.cookie } });
  assert.equal(allowed.response.status, 200);
  assert.ok(allowed.body.decision.dealerBuyRange.low < allowed.body.decision.fairListPrice);
  assert.match(allowed.body.decision.disclaimer, /not an appraisal/i);
}));

test('admin import job controls and provider stubs are auditable', async () => withServer(async ({ baseUrl }) => {
  const denied = await request(baseUrl, '/api/admin/import-jobs');
  assert.equal(denied.response.status, 403);
  const created = await request(baseUrl, '/api/admin/import-jobs', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' }, body: JSON.stringify({ provider: 'eBay', jobType: 'completed_sales', dryRun: true }) });
  assert.equal(created.response.status, 201);
  const run = await request(baseUrl, `/api/admin/import-jobs/${created.body.job.id}/runs`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' }, body: JSON.stringify({ status: 'completed', imported: 0, dryRun: true }) });
  assert.equal(run.response.status, 202);
  const list = await request(baseUrl, '/api/admin/import-jobs', { headers: { authorization: 'Bearer admin-test-token' } });
  assert.ok(list.body.jobs.length >= 1);
  assert.ok(list.body.providerStubs.length >= 6);
  assert.ok(providerExpansionStubs().some((stub) => stub.name === 'cardladder_partner'));
}));

test('cert extraction endpoint identifies readable slab labels without a full card photo', async () => withServer(async ({ baseUrl }) => {
  const result = await request(baseUrl, '/api/cert/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      certText: `PSA GEM MT 10
Cert #12345678
2018 Topps Update Series
Shohei Ohtani
#US1 Base Rookie Debut`,
    }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.gradedCert.certNumber, '12345678');
  assert.equal(result.body.gradedCert.extractionTier, 'cert_locked');
  assert.ok(result.body.gradedCert.extractionCompletenessScore >= 80);
  assert.equal(result.body.matches[0].id, 'card_ohtani_2018_update_us1_psa10');
  assert.match(result.body.message, /official cert page/i);
}));

test('desktop package configuration is hardened and valid', () => {
  const result = spawnSync(process.execPath, ['scripts/check-desktop.js'], { cwd: path.dirname(fileURLToPath(new URL('../package.json', import.meta.url))), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
