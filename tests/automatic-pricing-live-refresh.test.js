import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createAutomaticPricingRouter } from '../src/automatic-pricing-router.js';
import { hashSessionToken } from '../src/services/auth.js';

const card = {
  id: 'card-live-market',
  player: 'Shohei Ohtani',
  year: 2018,
  brand: 'Topps',
  set: 'Update',
  cardNumber: 'US1',
  parallel: 'Base',
};

function request(url) {
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = url;
  req.headers = { authorization: 'Bearer token-a' };
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

function createStore() {
  const tokenHash = hashSessionToken('token-a');
  return {
    findSession(hash) { return hash === tokenHash ? { userId: 'user-a' } : null; },
    findUserById(id) {
      return id === 'user-a'
        ? { id: 'user-a', email: 'a@example.test', role: 'collector', plan: 'collector', emailVerifiedAt: new Date().toISOString() }
        : null;
    },
  };
}

function setup(pricingResult) {
  const calls = [];
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
    store: createStore(),
    cache: { clear() {} },
    pricingEngine: {
      async priceCard(target, options) {
        calls.push({ target, options });
        return structuredClone(pricingResult);
      },
    },
    catalog: () => [card],
  });
  return { router, calls };
}

test('pricing refresh=1 forces the automatic pricing engine to request fresh authorized evidence', async () => {
  const { router, calls } = setup({
    status: 'valued_from_authorized_completed_sales',
    productionCompletedSaleCount: 8,
    valuation: { value: 125, range: { low: 115, high: 135 } },
    refresh: {
      attempted: true,
      performed: true,
      provider: 'eBay Marketplace Insights',
      reason: 'authorized_completed_sales_refreshed',
      error: null,
    },
    askingPriceContext: {
      listings: [{ itemId: 'active-1', valuationUse: false }],
      valuationUse: false,
    },
  });
  const res = response();
  const handled = await router(request(`/api/pricing/cards/${card.id}?refresh=1`), res);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.force, true);
  assert.equal(calls[0].options.reason, 'authenticated_live_market_refresh');
  const body = JSON.parse(res.body);
  assert.equal(body.liveMarket.requested, true);
  assert.equal(body.liveMarket.completedSalesAvailable, true);
  assert.equal(body.liveMarket.completedSalesLive, true);
  assert.equal(body.liveMarket.completedSaleCount, 8);
  assert.equal(body.liveMarket.activeListingCount, 1);
  assert.equal(body.liveMarket.valuationUse, 'authorized_completed_sales_only');
  assert.equal(body.liveMarket.askingPriceUse, 'context_only');
});

test('ordinary pricing reads retain cache behavior instead of forcing provider refresh', async () => {
  const { router, calls } = setup({
    status: 'valued_from_authorized_completed_sales',
    productionCompletedSaleCount: 4,
    valuation: { value: 95 },
    refresh: { attempted: false, performed: false, provider: 'eBay Marketplace Insights', reason: 'fresh_completed_sale_evidence_available' },
    askingPriceContext: { listings: [], valuationUse: false },
  });
  const res = response();
  await router(request(`/api/pricing/cards/${card.id}`), res);
  assert.equal(calls[0].options.force, false);
  assert.equal(calls[0].options.reason, 'authenticated_card_pricing_read');
  const body = JSON.parse(res.body);
  assert.equal(body.liveMarket.requested, false);
  assert.equal(body.liveMarket.completedSalesAvailable, true);
  assert.equal(body.liveMarket.completedSalesLive, false);
});

test('active eBay listings remain context only when completed-sale entitlement or evidence is unavailable', async () => {
  const { router } = setup({
    status: 'valuation_unavailable',
    productionCompletedSaleCount: 0,
    valuation: null,
    refresh: {
      attempted: false,
      performed: false,
      provider: 'eBay Marketplace Insights',
      reason: 'marketplace_insights_not_enabled',
      error: null,
    },
    askingPriceContext: {
      listings: [
        { itemId: 'active-1', price: 149.99, valuationUse: false },
        { itemId: 'active-2', price: 159.99, valuationUse: false },
      ],
      valuationUse: false,
    },
  });
  const res = response();
  await router(request(`/api/pricing/cards/${card.id}?refresh=true`), res);
  const body = JSON.parse(res.body);
  assert.equal(body.liveMarket.completedSalesAvailable, false);
  assert.equal(body.liveMarket.completedSalesLive, false);
  assert.equal(body.liveMarket.activeListingsLive, true);
  assert.equal(body.liveMarket.activeListingCount, 2);
  assert.match(body.liveMarket.explanation, /^Valuation unavailable\./);
  assert.equal(body.liveMarket.askingPriceUse, 'context_only');
});

test('provider refresh failures are surfaced without converting active asks into a market value', async () => {
  const { router } = setup({
    status: 'refresh_failed_no_value',
    productionCompletedSaleCount: 0,
    valuation: null,
    refresh: {
      attempted: true,
      performed: false,
      provider: 'eBay Marketplace Insights',
      reason: 'provider_refresh_failed',
      error: { code: 'EBAY_API_ERROR', message: 'temporary provider failure', retryable: true },
    },
    askingPriceContext: {
      listings: [{ itemId: 'active-1', price: 149.99, valuationUse: false }],
      valuationUse: false,
    },
  });
  const res = response();
  await router(request(`/api/pricing/cards/${card.id}?refresh=1`), res);
  const body = JSON.parse(res.body);
  assert.equal(body.pricing.valuation, null);
  assert.equal(body.liveMarket.completedSalesAvailable, false);
  assert.equal(body.liveMarket.refreshError.code, 'EBAY_API_ERROR');
  assert.equal(body.liveMarket.askingPriceUse, 'context_only');
  assert.match(body.liveMarket.explanation, /^Valuation unavailable\./);
});
