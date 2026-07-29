import test from 'node:test';
import assert from 'node:assert/strict';
import { JustTcgProvider } from '../src/providers/justtcg.js';
import { SportsCardsProProvider } from '../src/providers/sportscardspro.js';

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('JustTCG provider returns variant market context without claiming completed sales', async () => {
  const provider = new JustTcgProvider({
    justTcgApiKey: 'test-key',
    justTcgFetch: async () => response({ data: [{ id: 'card-1', name: 'Charizard', game: 'Pokemon', set_name: 'Base Set', variants: [{ id: 'v1', condition: 'Near Mint', printing: 'Holofoil', price: 100 }] }], meta: { total: 1 } }),
  });
  const result = await provider.searchCards({ query: 'Charizard' });
  assert.equal(result.cards[0].variants[0].price, 100);
  assert.equal(result.cards[0].valuationUse, false);
  assert.equal(provider.supportsCompletedSales, false);
});

test('SportsCardsPro provider converts pennies and keeps guide values separate from comps', async () => {
  const provider = new SportsCardsProProvider({
    sportsCardsProApiToken: 'test-token',
    sportsCardsProFetch: async () => response({ status: 'success', id: '72584', 'product-name': 'Michael Jordan #57', 'console-name': 'Basketball Cards 1986 Fleer', 'loose-price': 225500, 'manual-only-price': 602295 }),
  });
  const result = await provider.getProduct({ id: '72584' });
  assert.equal(result.product.prices.raw, 2255);
  assert.equal(result.product.prices.psa10, 6022.95);
  assert.equal(result.product.valuationUse, false);
});
