import test from 'node:test';
import assert from 'node:assert/strict';
import { EbayProvider, buildCardSearchQuery, normalizeEbayMarketplaceSale, normalizeEbaySellerOrder } from '../src/providers/ebay.js';
import { scoreComp } from '../src/services/comp-quality.js';

const now = new Date('2026-07-21T12:00:00Z');
const card = { id: 'card-ohtani', player: 'Shohei Ohtani', year: 2018, brand: 'Topps', set: 'Update', cardNumber: 'US1', parallel: 'Base', grade: { company: 'PSA', grade: '10' } };

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected fetch call to ${url}`);
    if (typeof next === 'function') return next(url, options, calls);
    return new Response(JSON.stringify(next.body || {}), { status: next.status || 200, headers: next.headers || { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

test('eBay card query builder includes exact card identity fields', () => {
  const query = buildCardSearchQuery(card);
  assert.match(query, /2018/);
  assert.match(query, /Shohei Ohtani/);
  assert.match(query, /US1/);
  assert.match(query, /PSA/);
});

test('marketplace insight sales normalize into production completed comps', () => {
  const sale = normalizeEbayMarketplaceSale({
    itemId: 'v1|123|0',
    title: '2018 Topps Update Shohei Ohtani US1 PSA 10',
    price: { value: '125.50', currency: 'USD' },
    lastSoldDate: '2026-07-20T00:00:00Z',
    itemWebUrl: 'https://www.ebay.com/itm/123',
    buyingOptions: ['AUCTION'],
    condition: 'Graded',
  }, { ...card, cardId: card.id, provider: 'eBay Marketplace Insights' });
  assert.equal(sale.provider, 'eBay Marketplace Insights');
  assert.equal(sale.authorizationBasis, 'ebay_api');
  assert.equal(sale.isCompletedSale, true);
  assert.equal(sale.allInPrice, 125.5);
  const scored = scoreComp(sale, { now, card, demoMode: false });
  assert.equal(scored.valuationUse, true);
});

test('disabled marketplace insights refuses completed sale search', async () => {
  const provider = new EbayProvider({ ebayClientId: 'id', ebayClientSecret: 'secret', ebayMarketplaceInsightsEnabled: false, ebayFetch: fakeFetch([]) });
  await assert.rejects(() => provider.searchCompletedSales({ query: 'ohtani' }), /Marketplace Insights is not enabled/);
  assert.equal(provider.status().supportsActiveListings, true);
  assert.equal(provider.status().supportsCompletedSales, false);
});

test('marketplace insights completed sale import handles oauth and sold-data response', async () => {
  const fetchImpl = fakeFetch([
    { body: { access_token: 'token', expires_in: 7200 } },
    (url, options) => {
      assert.match(String(url), /marketplace_insights\/v1_beta\/item_sales\/search/);
      assert.match(String(url), /q=2018/);
      assert.equal(options.headers.authorization, 'Bearer token');
      return new Response(JSON.stringify({
        href: String(url),
        total: 1,
        limit: 50,
        offset: 0,
        itemSales: [{
          itemId: 'v1|123|0', title: '2018 Topps Update Shohei Ohtani US1 PSA 10',
          price: { value: '130', currency: 'USD' }, lastSoldDate: '2026-07-18T00:00:00Z', itemWebUrl: 'https://www.ebay.com/itm/123', buyingOptions: ['FIXED_PRICE'], condition: 'Graded',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  ]);
  const provider = new EbayProvider({ ebayClientId: 'id', ebayClientSecret: 'secret', ebayMarketplaceInsightsEnabled: true, ebayFetch: fetchImpl });
  const result = await provider.searchCompletedSales({ query: '2018 Topps Ohtani US1 PSA 10', cardContext: { ...card, cardId: card.id } });
  assert.equal(result.sales.length, 1);
  assert.equal(result.sales[0].provider, 'eBay Marketplace Insights');
  assert.equal(result.sales[0].authorizationBasis, 'ebay_api');
  assert.equal(result.sales[0].isCompletedSale, true);
});

test('seller order lines normalize into seller-authorized completed comps', () => {
  const sale = normalizeEbaySellerOrder({ orderId: 'order-1', creationDate: '2026-07-19T00:00:00Z' }, { lineItemId: 'line-1', title: '2018 Topps Update Shohei Ohtani US1 PSA 10', lineItemCost: { value: '121', currency: 'USD' }, quantity: 1 }, { provider: 'eBay Seller Orders' });
  assert.equal(sale.provider, 'eBay Seller Orders');
  assert.equal(sale.authorizationBasis, 'ebay_api');
  assert.equal(sale.isCompletedSale, true);
  assert.equal(sale.rawProviderId, 'line-1');
});

test('active eBay Browse listings normalize as BIN context only', async () => {
  const fetchImpl = fakeFetch([
    { body: { access_token: 'token', expires_in: 7200 } },
    (url, options) => {
      assert.match(String(url), /item_summary\/search/);
      assert.match(decodeURIComponent(String(url)), /buyingOptions:\{FIXED_PRICE\}/);
      assert.equal(options.headers.authorization, 'Bearer token');
      return new Response(JSON.stringify({
        itemSummaries: [{
          itemId: 'v1|active|0',
          title: '2018 Topps Update Shohei Ohtani US1 PSA 10 BIN',
          price: { value: '149.99', currency: 'USD' },
          itemWebUrl: 'https://www.ebay.com/itm/active',
          image: { imageUrl: 'https://i.ebayimg.com/images/g/example/s-l500.jpg' },
          buyingOptions: ['FIXED_PRICE'],
          condition: 'Graded',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  ]);
  const provider = new EbayProvider({ ebayClientId: 'id', ebayClientSecret: 'secret', ebayFetch: fetchImpl });
  const listings = await provider.searchActiveListings({ query: '2018 Topps Ohtani US1 PSA 10', limit: 3 });
  assert.equal(listings.length, 1);
  assert.equal(listings[0].sourceType, 'active_listing');
  assert.equal(listings[0].valuationUse, false);
  assert.equal(listings[0].dataRightsStatus, 'active_listings_only_not_for_valuation');
  assert.equal(scoreComp(listings[0], { now, card, demoMode: false }).valuationUse, false);
});

test('eBay OAuth consent URL uses production application credentials, RuName, and seller order scope', () => {
  const provider = new EbayProvider({
    ebayClientId: 'production-client-id',
    ebayClientSecret: 'production-secret',
    ebayRedirectUriName: 'Joshua_Chappell-MemphisC-ManeFl-abc123',
  });
  const url = new URL(provider.buildUserConsentUrl({ state: 'state-123' }));
  assert.equal(url.hostname, 'auth.ebay.com');
  assert.equal(url.searchParams.get('client_id'), 'production-client-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'Joshua_Chappell-MemphisC-ManeFl-abc123');
  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.match(url.searchParams.get('scope'), /sell\.fulfillment\.readonly/);
});

test('eBay OAuth code exchange accepts a full redirect URL and stores refresh credentials', async () => {
  const fetchImpl = fakeFetch([
    (url, options) => {
      assert.match(String(url), /identity\/v1\/oauth2\/token/);
      const body = new URLSearchParams(String(options.body));
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('code'), 'single-use-code');
      assert.equal(body.get('redirect_uri'), 'ManeFlow-RuName');
      return new Response(JSON.stringify({
        access_token: 'user-access-token',
        expires_in: 7200,
        refresh_token: 'seller-refresh-token',
        refresh_token_expires_in: 47_304_000,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  ]);
  const provider = new EbayProvider({
    ebayClientId: 'id', ebayClientSecret: 'secret', ebayRedirectUriName: 'ManeFlow-RuName', ebayFetch: fetchImpl,
  });
  const result = await provider.exchangeAuthorizationCode('https://example.test/callback?code=single-use-code&state=abc');
  assert.equal(result.accessToken, 'user-access-token');
  assert.equal(result.refreshToken, 'seller-refresh-token');
  assert.equal(provider.status().sellerOrdersEnabled, true);
});

test('eBay seller order import refreshes an expired user token and uses seller-authorized data only', async () => {
  const fetchImpl = fakeFetch([
    (url, options) => {
      assert.match(String(url), /identity\/v1\/oauth2\/token/);
      const body = new URLSearchParams(String(options.body));
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'refresh-token');
      return new Response(JSON.stringify({ access_token: 'fresh-user-token', expires_in: 7200 }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    (url, options) => {
      assert.match(String(url), /sell\/fulfillment\/v1\/order/);
      assert.equal(options.headers.authorization, 'Bearer fresh-user-token');
      return new Response(JSON.stringify({
        total: 1,
        orders: [{
          orderId: 'order-1', creationDate: '2026-07-20T00:00:00Z',
          lineItems: [{ lineItemId: 'line-1', title: '2018 Topps Update Shohei Ohtani US1 PSA 10', lineItemCost: { value: '125', currency: 'USD' }, quantity: 1 }],
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  ]);
  const provider = new EbayProvider({
    ebayClientId: 'id', ebayClientSecret: 'secret', ebayRefreshToken: 'refresh-token', ebayFetch: fetchImpl,
  });
  const result = await provider.fetchSellerOrders({ limit: 10 });
  assert.equal(result.sales.length, 1);
  assert.equal(result.sales[0].dataRightsStatus, 'seller_account_authorized_orders_only');
  assert.equal(result.sales[0].isCompletedSale, true);
  assert.equal(result.sales[0].verified, true);
});
