import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createAutomaticPricingRouter } from '../src/automatic-pricing-router.js';
import { hashSessionToken } from '../src/services/auth.js';

const card = {
  id: 'card-pricing-router',
  player: 'Router Player',
  year: 2025,
  brand: 'Topps',
  set: 'Finest',
  cardNumber: '42',
  parallel: 'Gold',
};

const completedSales = [{
  id: 'sale-router-1',
  cardId: card.id,
  provider: 'eBay Marketplace Insights',
  sourceType: 'sold',
  isCompletedSale: true,
  price: 125,
  allInPrice: 125,
  soldAt: '2026-07-28T12:00:00.000Z',
  sourceMode: 'production',
  valuationUse: true,
}];

function createStore() {
  const users = [
    { id: 'user-a', email: 'a@example.test', role: 'collector', plan: 'collector', emailVerifiedAt: new Date().toISOString() },
    { id: 'user-b', email: 'b@example.test', role: 'collector', plan: 'collector', emailVerifiedAt: new Date().toISOString() },
  ];
  const tokens = new Map([
    [hashSessionToken('token-a'), { userId: 'user-a' }],
    [hashSessionToken('token-b'), { userId: 'user-b' }],
  ]);
  const state = {
    scanSessions: [{
      id: 'scan-a',
      userId: 'user-a',
      status: 'needs_confirmation',
      selectedCardId: card.id,
      confidence: { scanConfidenceScore: 92 },
      correctedFields: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    scanCorrections: [],
    dataByUser: {
      'user-a': { collection: [] },
      'user-b': { collection: [] },
    },
  };
  return {
    state,
    persisted: 0,
    lastCollectionInput: null,
    findSession(tokenHash) { return tokens.get(tokenHash) || null; },
    findUserById(userId) { return users.find((user) => user.id === userId) || null; },
    userSnapshot(userId) {
      return structuredClone(state.dataByUser[userId] || { collection: [] });
    },
    findMergeableCollectionItem() { return null; },
    async addCollectionItem(userId, input) {
      this.lastCollectionInput = structuredClone(input);
      const item = { id: 'collection-created', ...input, merged: false, quantityAdded: input.quantity || 1 };
      state.dataByUser[userId].collection.push(item);
      return item;
    },
    async persist() { this.persisted += 1; },
  };
}

function request({ token = null, method = 'GET', url = '/', body = null, headers = {} } = {}) {
  const req = Readable.from(body == null ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = {
    ...headers,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  return req;
}

function response() {
  return {
    headers: {},
    statusCode: null,
    body: '',
    writableEnded: false,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    end(body = '') { this.body = String(body); this.writableEnded = true; },
  };
}

function parsed(res) {
  return res.body ? JSON.parse(res.body) : {};
}

function setup() {
  const store = createStore();
  const calls = [];
  const pricingEngine = {
    async priceCard(target, options) {
      calls.push({ card: target, options });
      return {
        status: 'valued_from_authorized_completed_sales',
        cardId: target.id,
        marketMode: 'production',
        valuation: {
          value: 125,
          range: { low: 115, high: 135 },
          confidence: 88,
          windows: {},
          compDetails: { included: completedSales, excluded: [], needsReview: [] },
          askingPriceContext: { listings: [], valuationUse: false },
        },
        refresh: { performed: true, attempted: true },
        askingPriceContext: { listings: [], error: null, valuationUse: false },
      };
    },
  };
  const cache = { clearCalls: 0, clear() { this.clearCalls += 1; } };
  const router = createAutomaticPricingRouter({
    config: {
      publicBaseUrl: 'https://app.example.test',
      allowedOrigins: [],
      csrfProtection: true,
      requireEmailVerification: true,
      serviceToken: 'service-secret',
      apiToken: 'api-secret',
      adminToken: 'admin-secret',
    },
    store,
    cache,
    pricingEngine,
    catalog: () => [card],
    salesForCard: (target) => completedSales.filter((sale) => sale.cardId === target.id),
  });
  return { store, calls, cache, router };
}

test('automatic pricing routes require a real authenticated user session', async () => {
  const { router } = setup();
  const res = response();
  const handled = await router(request({ url: `/api/pricing/cards/${card.id}` }), res);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 401);

  const serviceRes = response();
  await router(request({ token: 'service-secret', url: `/api/pricing/cards/${card.id}` }), serviceRes);
  assert.equal(serviceRes.statusCode, 401);
});

test('authenticated card pricing is calculated by ManeFlow', async () => {
  const { router, calls } = setup();
  const res = response();
  await router(request({ token: 'token-a', url: `/api/pricing/cards/${card.id}` }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(parsed(res).pricing.valuation.value, 125);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].card.id, card.id);
  assert.equal(calls[0].options.reason, 'authenticated_card_pricing_read');
});

test('the existing card market screen receives the automatically calculated value and completed sales', async () => {
  const { router, calls } = setup();
  const res = response();
  await router(request({ token: 'token-a', url: `/api/cards/${card.id}/market?window=365d&active=1` }), res);
  assert.equal(res.statusCode, 200);
  const body = parsed(res);
  assert.equal(body.card.id, card.id);
  assert.equal(body.valuation.value, 125);
  assert.equal(body.marketMode, 'production');
  assert.equal(body.pricingStatus, 'valued_from_authorized_completed_sales');
  assert.equal(body.sales.length, 1);
  assert.equal(body.sales[0].id, 'sale-router-1');
  assert.equal(body.automaticPricing.askingPriceContext.valuationUse, false);
  assert.match(body.message, /calculated this value automatically/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.reason, 'card_market_screen');
});

test('Vault creation ignores client-provided market values and triggers automatic pricing', async () => {
  const { router, store, calls, cache } = setup();
  const res = response();
  await router(request({
    token: 'token-a',
    method: 'POST',
    url: '/api/collection',
    body: {
      cardId: card.id,
      name: 'Router Player Gold',
      quantity: 1,
      purchasePrice: 40,
      marketValue: 999_999,
      estimatedValue: 888_888,
      comps: [{ price: 777_777 }],
      valuation: { value: 666_666 },
      suggestedPrice: 555_555,
    },
  }), res);

  assert.equal(res.statusCode, 201);
  const body = parsed(res);
  assert.equal(body.pricing.valuation.value, 125);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.reason, 'vault_item_created');
  assert.equal(cache.clearCalls, 1);
  assert.equal(store.lastCollectionInput.cardId, card.id);
  for (const forbiddenField of ['marketValue', 'estimatedValue', 'comps', 'valuation', 'suggestedPrice']) {
    assert.equal(Object.hasOwn(store.lastCollectionInput, forbiddenField), false);
  }
});

test('confirmed exact scan triggers pricing while rejection does not', async () => {
  const confirmed = setup();
  const confirmRes = response();
  await confirmed.router(request({
    token: 'token-a',
    method: 'POST',
    url: '/api/scan-sessions/scan-a/confirm',
    body: { cardId: card.id, notes: 'Exact identity verified.' },
  }), confirmRes);
  assert.equal(confirmRes.statusCode, 200);
  assert.equal(parsed(confirmRes).pricing.valuation.value, 125);
  assert.equal(confirmed.calls.length, 1);
  assert.equal(confirmed.calls[0].options.reason, 'confirmed_scan_identity');

  const rejected = setup();
  const rejectRes = response();
  await rejected.router(request({
    token: 'token-a',
    method: 'POST',
    url: '/api/scan-sessions/scan-a/confirm',
    body: { rejected: true, notes: 'Not a card.' },
  }), rejectRes);
  assert.equal(rejectRes.statusCode, 200);
  assert.equal(parsed(rejectRes).pricing, null);
  assert.equal(rejected.calls.length, 0);
});

test('one user cannot confirm or price another user scan session', async () => {
  const { router, calls } = setup();
  const res = response();
  await router(request({
    token: 'token-b',
    method: 'POST',
    url: '/api/scan-sessions/scan-a/confirm',
    body: { cardId: card.id },
  }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(calls.length, 0);
});
