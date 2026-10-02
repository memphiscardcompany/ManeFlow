import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRouter } from '../src/router.js';
import { JsonStore } from '../src/services/store.js';
import { TtlCache } from '../src/services/cache.js';
import { createProviderRegistry } from '../src/services/provider-registry.js';

let server;
let baseUrl;
let directory;
let cards;
let sales;
let store;

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

async function registerAndLogin({ name, email, password }) {
  const registered = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  assert.equal(registered.response.status, 202);
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.response.status, 200);
  return login;
}

before(async () => {
  cards = JSON.parse(await fs.readFile(new URL('../src/data/cards.json', import.meta.url), 'utf8'));
  sales = JSON.parse(await fs.readFile(new URL('../src/data/sales.json', import.meta.url), 'utf8'));
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-api-'));
  const config = {
    appName: 'ManeFlow', version: '1.2.0', releaseChannel: 'test',
    port: 0, host: '127.0.0.1', publicBaseUrl: 'http://127.0.0.1',
    apiToken: '', adminToken: 'admin-test-token', bootstrapAdminEmail: '',
    demoMode: true, allowGuestWrites: false, allowPublicSignups: true, requireEmailVerification: false, exposeDevTokens: true, accountTokenMinutes: 60, sessionDays: 30,
    allowedOrigins: [], maxRequestBytes: 14_000_000, runtimeFile: path.join(directory, 'state.json'),
    openaiApiKey: '', openaiVisionModel: '', providerWebhookSecret: 'test-secret', emailWebhookUrl: '', emailWebhookSecret: '',
    ebayClientId: '', ebayClientSecret: '', tcgplayerPublicKey: '', tcgplayerPrivateKey: '',
  };
  store = await new JsonStore(config.runtimeFile).init();
  const providers = createProviderRegistry(config, sales);
  server = http.createServer(createRouter({ config, cards, sales, providers, store, cache: new TtlCache() }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});

test('health and market APIs respond', async () => {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  const market = await request(`/api/cards/${cards[0].id}/market`);
  assert.equal(market.response.status, 200);
  assert.equal(market.body.card.id, cards[0].id);
});

test('accounts isolate collection data end to end', async () => {
  const alice = await registerAndLogin({ name: 'Alice', email: 'alice@example.com', password: 'alice-password-123' });
  const bob = await registerAndLogin({ name: 'Bob', email: 'bob@example.com', password: 'bob-password-123' });

  const added = await request('/api/collection', { method: 'POST', headers: { 'content-type': 'application/json', cookie: alice.cookie }, body: JSON.stringify({ cardId: cards[0].id, quantity: 1, purchasePrice: 100 }) });
  assert.equal(added.response.status, 201);

  const aliceDashboard = await request('/api/dashboard', { headers: { cookie: alice.cookie } });
  const bobDashboard = await request('/api/dashboard', { headers: { cookie: bob.cookie } });
  assert.equal(aliceDashboard.body.collection.length, 1);
  assert.equal(bobDashboard.body.collection.length, 0);
});

test('front/back manual scan records a candidate match', async () => {
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'alice-password-123' }) });
  const scan = await request('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json', cookie: login.cookie }, body: JSON.stringify({ manualText: '2018 Topps Update Shohei Ohtani US1 PSA 10' }) });
  assert.equal(scan.response.status, 200);
  assert.equal(scan.body.matches[0].id, cards[0].id);
  assert.ok(scan.body.scanId);
});

test('collection logging merges duplicate matched cards and feeds portfolio value', async () => {
  const created = await registerAndLogin({ name: 'Logger', email: 'logger@example.com', password: 'logger-password-123' });
  const first = await request('/api/collection', { method: 'POST', headers: { 'content-type': 'application/json', cookie: created.cookie }, body: JSON.stringify({ cardId: cards[0].id, name: 'Shohei Ohtani', quantity: 1, purchasePrice: 100, location: 'Box A', certNumber: '12345' }) });
  assert.equal(first.response.status, 201);
  assert.equal(first.body.merged, false);
  const second = await request('/api/collection', { method: 'POST', headers: { 'content-type': 'application/json', cookie: created.cookie }, body: JSON.stringify({ cardId: cards[0].id, name: 'Shohei Ohtani', quantity: 2, purchasePrice: 100, location: 'Box A', certNumber: '12345' }) });
  assert.equal(second.response.status, 200);
  assert.equal(second.body.merged, true);
  assert.equal(second.body.item.quantity, 3);
  const separateCert = await request('/api/collection', { method: 'POST', headers: { 'content-type': 'application/json', cookie: created.cookie }, body: JSON.stringify({ cardId: cards[0].id, name: 'Shohei Ohtani', quantity: 1, purchasePrice: 100, location: 'Box A', certNumber: '99999' }) });
  assert.equal(separateCert.response.status, 201);
  const dashboard = await request('/api/dashboard', { headers: { cookie: created.cookie } });
  assert.equal(dashboard.body.collection.length, 2);
  assert.equal(dashboard.body.collection.find((item) => item.certNumber === '12345').quantity, 3);
  assert.ok(dashboard.body.portfolio.totalValue > 0);
});

test('admin provider ingest documents authorization basis', async () => {
  const payload = {
    provider: 'Approved Test Feed', authorizationBasis: 'written_license', cards: [],
    sales: [{ id: 'approved-sale-1', cardId: cards[0].id, price: 333, soldAt: new Date().toISOString(), verified: true }],
  };
  const result = await request('/api/admin/provider-ingest', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' }, body: JSON.stringify(payload),
  });
  assert.equal(result.response.status, 202);
  assert.equal(result.body.ingest.salesAdded, 1);
});


test('email verification and password recovery complete end to end', async () => {
  const created = await request('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Charlie', email: 'charlie@example.com', password: 'charlie-password-123' }) });
  assert.equal(created.response.status, 202);
  const verificationMessage = store.state.outbox.find((item) => item.type === 'verify_email' && item.to === 'charlie@example.com');
  assert.ok(verificationMessage?.actionUrl);
  const verificationToken = new URL(verificationMessage.actionUrl).hash.match(/verify=([^&]+)/)?.[1];
  assert.ok(verificationToken);
  const verified = await request('/api/auth/verify-email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: decodeURIComponent(verificationToken) }) });
  assert.equal(verified.response.status, 200);
  assert.ok(verified.body.user.emailVerifiedAt);

  const forgot = await request('/api/auth/forgot-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'charlie@example.com' }) });
  assert.equal(forgot.response.status, 202);
  assert.ok(forgot.body.reset.token);
  const reset = await request('/api/auth/reset-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: forgot.body.reset.token, password: 'charlie-new-password-456' }) });
  assert.equal(reset.response.status, 200);
  const oldLogin = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'charlie@example.com', password: 'charlie-password-123' }) });
  assert.equal(oldLogin.response.status, 401);
  const newLogin = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'charlie@example.com', password: 'charlie-new-password-456' }) });
  assert.equal(newLogin.response.status, 200);
});

test('price targets create persistent alert records', async () => {
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'alice-password-123' }) });
  const watch = await request('/api/watchlist', { method: 'POST', headers: { 'content-type': 'application/json', cookie: login.cookie }, body: JSON.stringify({ cardId: cards[0].id, targetPrice: 1000000, direction: 'below' }) });
  assert.equal(watch.response.status, 201);
  const dashboard = await request('/api/dashboard', { headers: { cookie: login.cookie } });
  assert.ok(dashboard.body.unreadAlerts >= 1);
  assert.ok(dashboard.body.alerts.some((alert) => alert.cardId === cards[0].id));
  const alert = dashboard.body.alerts[0];
  const marked = await request(`/api/alerts/${alert.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: login.cookie }, body: JSON.stringify({ read: true }) });
  assert.equal(marked.response.status, 200);
  assert.ok(marked.body.alert.readAt);
});

test('account session, export, and deletion controls work', async () => {
  const created = await registerAndLogin({ name: 'Delete Me', email: 'delete@example.com', password: 'delete-password-123' });
  const sessions = await request('/api/auth/sessions', { headers: { cookie: created.cookie } });
  assert.equal(sessions.response.status, 200);
  assert.ok(sessions.body.sessions.length >= 1);
  const exported = await request('/api/auth/export', { headers: { cookie: created.cookie } });
  assert.equal(exported.response.status, 200);
  assert.equal(exported.body.user.email, 'delete@example.com');
  assert.equal(exported.body.user.passwordHash, undefined);
  const deleted = await request('/api/auth/account', { method: 'DELETE', headers: { 'content-type': 'application/json', cookie: created.cookie }, body: JSON.stringify({ password: 'delete-password-123' }) });
  assert.equal(deleted.response.status, 200);
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'delete@example.com', password: 'delete-password-123' }) });
  assert.equal(login.response.status, 401);
});

test('administrator data health and user operations are available', async () => {
  const health = await request('/api/admin/data-health', { headers: { authorization: 'Bearer admin-test-token' } });
  assert.equal(health.response.status, 200);
  assert.ok(Array.isArray(health.body.blockers));
  assert.ok(health.body.saleCount > 0);
  const users = await request('/api/admin/users', { headers: { authorization: 'Bearer admin-test-token' } });
  assert.equal(users.response.status, 200);
  assert.ok(users.body.users.length >= 3);
  assert.equal(users.body.users[0].passwordHash, undefined);
});

test('admin recognition benchmark lab is protected and blocks prohibited sources', async () => {
  const denied = await request('/api/admin/recognition-benchmarks');
  assert.equal(denied.response.status, 403);

  const listed = await request('/api/admin/recognition-benchmarks', { headers: { authorization: 'Bearer admin-test-token' } });
  assert.equal(listed.response.status, 200);
  assert.ok(listed.body.eligibleSources.some((source) => source.provider === 'GotThatData Sports Cards Dataset'));
  assert.ok(listed.body.blockedSources.some((source) => source.provider === 'Trading Card Database'));

  const blocked = await request('/api/admin/recognition-benchmarks/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' },
    body: JSON.stringify({ sourceName: 'Trading Card Database', cases: [{ player: 'Shohei Ohtani', year: 2018, brand: 'Topps', set: 'Update Series', cardNumber: 'US1' }] }),
  });
  assert.equal(blocked.response.status, 409);

  const run = await request('/api/admin/recognition-benchmarks/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' },
    body: JSON.stringify({ sourceName: 'GotThatData Sports Cards Dataset', cases: [{ imageName: 'single-ohtani.jpg', player: 'Shohei Ohtani', year: 2018, brand: 'Topps', set: 'Update Series', cardNumber: 'US1' }] }),
  });
  assert.equal(run.response.status, 200);
  assert.equal(run.body.report.policy.doesNotCreateMarketValues, true);
  assert.equal(run.body.benchmark.caseCount, 1);
});

test('plan entitlements are exposed and history is limited by plan', async () => {
  const plans = await request('/api/plans');
  assert.equal(plans.response.status, 200);
  assert.equal(plans.body.plans.free.historyDays, 90);
  assert.equal(plans.body.plans.merchant.apiAccess, true);
  const login = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'alice-password-123' }) });
  const market = await request(`/api/cards/${cards[0].id}/market?window=365d`, { headers: { cookie: login.cookie } });
  assert.equal(market.response.status, 200);
  assert.equal(market.body.historyWindowDays, 90);
  assert.equal(market.body.historyTruncated, true);
  const collection = await request('/api/collection', { headers: { cookie: login.cookie } });
  assert.equal(collection.response.status, 200);
  assert.ok(Array.isArray(collection.body.collection));
});

test('comp quality endpoints expose public comp reasons and protect admin review actions', async () => {
  const comps = await request(`/api/cards/${cards[0].id}/comps`);
  assert.equal(comps.response.status, 200);
  assert.ok(Array.isArray(comps.body.included));
  assert.ok(comps.body.message.includes('included or excluded'));

  const reviewUnauthed = await request('/api/admin/comps/review');
  assert.equal(reviewUnauthed.response.status, 403);

  const review = await request('/api/admin/comps/review', { headers: { authorization: 'Bearer admin-test-token' } });
  assert.equal(review.response.status, 200);
  assert.ok(Array.isArray(review.body.review));

  const targetId = sales[0].id;
  const nonAdmin = await request(`/api/admin/comps/${encodeURIComponent(targetId)}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ notes: 'Nope' }) });
  assert.equal(nonAdmin.response.status, 403);

  const approved = await request(`/api/admin/comps/${encodeURIComponent(targetId)}/approve`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' }, body: JSON.stringify({ notes: 'Reviewed sample comp' }) });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.result.decision, 'approved');

  const rejected = await request(`/api/admin/comps/${encodeURIComponent(targetId)}/reject`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' }, body: JSON.stringify({ notes: 'Test rejection', inclusionStatus: 'excluded_wrong_card' }) });
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.body.result.decision, 'rejected');
});

test('portfolio intelligence endpoints respect account privacy and merchant inventory gates', async () => {
  const aliceLogin = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'alice@example.com', password: 'alice-password-123' }) });
  const bobLogin = await request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bob@example.com', password: 'bob-password-123' }) });

  const aliceIntel = await request('/api/portfolio/intelligence', { headers: { cookie: aliceLogin.cookie } });
  assert.equal(aliceIntel.response.status, 200);
  assert.equal(aliceIntel.body.privacy, 'private_user_vault');
  assert.ok(aliceIntel.body.intelligence.metrics.itemCount >= 1);

  const bobIntel = await request('/api/portfolio/intelligence', { headers: { cookie: bobLogin.cookie } });
  assert.equal(bobIntel.response.status, 200);
  assert.equal(bobIntel.body.intelligence.metrics.itemCount, 0);

  const scenario = await request('/api/portfolio/scenario', { method: 'POST', headers: { 'content-type': 'application/json', cookie: aliceLogin.cookie }, body: JSON.stringify({ scenario: { marketDropPct: 10 } }) });
  assert.equal(scenario.response.status, 200);
  assert.ok(scenario.body.scenario.currentValue >= scenario.body.scenario.valueAfterMarketMove);

  const tax = await fetch(`${baseUrl}/api/portfolio/tax-report.csv`, { headers: { cookie: aliceLogin.cookie } });
  assert.equal(tax.status, 200);
  assert.match(await tax.text(), /ifLiquidatedTaxEstimate/);

  const deniedInventory = await fetch(`${baseUrl}/api/portfolio/inventory-report.csv`, { headers: { cookie: aliceLogin.cookie } });
  assert.equal(deniedInventory.status, 403);
});

test('admin portfolio and inventory intelligence dashboards are admin-only', async () => {
  const denied = await request('/api/admin/portfolio-intelligence');
  assert.equal(denied.response.status, 403);
  const portfolios = await request('/api/admin/portfolio-intelligence', { headers: { authorization: 'Bearer admin-test-token' } });
  assert.equal(portfolios.response.status, 200);
  assert.ok(Array.isArray(portfolios.body.portfolios));
  assert.ok(portfolios.body.portfolios.some((row) => row.email === 'alice@example.com'));

  const inventory = await request('/api/admin/inventory-intelligence', { headers: { authorization: 'Bearer admin-test-token' } });
  assert.equal(inventory.response.status, 200);
  assert.ok(Array.isArray(inventory.body.shops));
});

test('eBay admin import endpoints require admin access', async () => {
  const blocked = await request('/api/admin/ebay/import-completed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'ohtani' }) });
  assert.equal(blocked.response.status, 403);
  const status = await request('/api/admin/ebay/status', { headers: { authorization: 'Bearer admin-test-token' } });
  assert.equal(status.response.status, 200);
  assert.ok(status.body.provider);
});

test('eBay completed import fails closed when Marketplace Insights access is not enabled', async () => {
  const result = await request('/api/admin/ebay/import-completed', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-test-token' }, body: JSON.stringify({ query: '2018 Topps Ohtani US1 PSA 10' }) });
  assert.equal(result.response.status, 400);
  assert.match(result.body.message, /Marketplace Insights is not enabled/);
});

test('collection survey HTTP workflow persists conservative estimates and enforces tenant isolation', async () => {
  const owner = await registerAndLogin({
    name: 'Survey Owner', email: 'survey-owner@example.com', password: 'survey-owner-password-123',
  });
  const outsider = await registerAndLogin({
    name: 'Survey Outsider', email: 'survey-outsider@example.com', password: 'survey-outsider-password-123',
  });

  const surveyInput = {
    title: 'Storage room acquisition',
    surveyType: 'collection_purchase',
    locationLabel: 'Memphis storage room',
    images: [
      { id: 'wide-1', name: 'wide.jpg', width: 3024, height: 4032, qualityWarnings: [] },
      { id: 'close-1', name: 'shelf-close.jpg', width: 3024, height: 4032, qualityWarnings: [] },
    ],
    hiddenAreas: ['Lower shelf behind tote'],
    objects: [
      { kind: 'five_row_box', contentType: 'raw', fullness: 0.75, confidence: 0.75, stableKey: 'shelf-a-box-1' },
      { kind: 'five_row_box', contentType: 'raw', fullness: 0.75, confidence: 0.75, stableKey: 'shelf-a-box-1' },
      { kind: 'graded_card_box', contentType: 'slab', fullness: 0.5, confidence: 0.7, stableKey: 'shelf-a-slab-box' },
      { kind: 'furniture', category: 'non_inventory', directCount: 1, confidence: 0.99 },
    ],
  };

  const estimated = await request('/api/collection-surveys/estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify(surveyInput),
  });
  assert.equal(estimated.response.status, 200);
  assert.ok(estimated.body.survey.countEstimate.low < estimated.body.survey.countEstimate.expected);
  assert.ok(estimated.body.survey.countEstimate.expected < estimated.body.survey.countEstimate.high);
  assert.equal(estimated.body.survey.scene.possibleDuplicates.length, 1);
  assert.equal(estimated.body.survey.review.humanReviewRequired, true);
  assert.equal(estimated.body.survey.countEstimate.duplicateViewRisk, 'review_required');

  const created = await request('/api/collection-surveys', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify(surveyInput),
  });
  assert.equal(created.response.status, 201);
  assert.ok(created.body.survey.id);

  const ownerList = await request('/api/collection-surveys', { headers: { cookie: owner.cookie } });
  const outsiderList = await request('/api/collection-surveys', { headers: { cookie: outsider.cookie } });
  assert.equal(ownerList.response.status, 200);
  assert.equal(ownerList.body.surveys.length, 1);
  assert.equal(ownerList.body.surveys[0].id, created.body.survey.id);
  assert.equal(outsiderList.response.status, 200);
  assert.equal(outsiderList.body.surveys.length, 0);

  const outsiderUpdate = await request(`/api/collection-surveys/${created.body.survey.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: outsider.cookie },
    body: JSON.stringify({ title: 'Unauthorized edit' }),
  });
  assert.equal(outsiderUpdate.response.status, 404);

  const ownerUpdate = await request(`/api/collection-surveys/${created.body.survey.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: owner.cookie },
    body: JSON.stringify({ title: 'Reviewed storage room acquisition' }),
  });
  assert.equal(ownerUpdate.response.status, 200);
  assert.equal(ownerUpdate.body.survey.title, 'Reviewed storage room acquisition');
});
