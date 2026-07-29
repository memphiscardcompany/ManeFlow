import test from 'node:test';
import assert from 'node:assert/strict';
import { JustTcgProvider } from '../src/providers/justtcg.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('JustTCG official SDK search uses v1 cards.get and preserves variant market context', async () => {
  const calls = [];
  const sdkClient = {
    v1: {
      cards: {
        get: async (params) => {
          calls.push(params);
          return {
            data: [{
              id: 'pokemon-base-charizard-4',
              uuid: 'card-uuid',
              name: 'Charizard',
              game: 'Pokemon',
              set: 'base-set-pokemon',
              setName: 'Base Set',
              number: '4/102',
              variants: [{ id: 'variant-1', uuid: 'variant-uuid', condition: 'Near Mint', printing: 'Holofoil', price: 325.25, lastUpdated: 1780000000 }],
            }],
            pagination: { total: 1, limit: 20, offset: 0, hasMore: false },
            usage: { apiDailyRequestsRemaining: 99 },
          };
        },
        getByBatch: async () => ({ data: [], usage: { apiDailyRequestsRemaining: 98 } }),
      },
    },
  };
  const provider = new JustTcgProvider({ justTcgApiKey: 'test-key', justTcgSdkClient: sdkClient });
  const result = await provider.searchCards({ query: 'Charizard', game: 'Pokemon', number: '4/102', printing: 'Holofoil' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, 'Charizard');
  assert.deepEqual(calls[0].printing, ['Holofoil']);
  assert.equal(result.cards[0].name, 'Charizard');
  assert.equal(result.cards[0].variants[0].price, 325.25);
  assert.equal(result.cards[0].valuationUse, false);
  assert.equal(provider.status().integration, 'official_js_sdk');
});

test('JustTCG official SDK batch lookup uses getByBatch', async () => {
  const batches = [];
  const sdkClient = {
    v1: {
      cards: {
        getByBatch: async (items) => {
          batches.push(items);
          return {
            data: items.map((item, index) => ({ id: `card-${index}`, uuid: `uuid-${index}`, name: `Card ${index}`, variants: [] })),
            usage: { apiDailyRequestsRemaining: 75 },
          };
        },
      },
    },
  };
  const provider = new JustTcgProvider({ justTcgApiKey: 'test-key', justTcgSdkClient: sdkClient });
  const result = await provider.batchCards([{ tcgplayerId: '1' }, { cardId: '2' }]);
  assert.equal(batches.length, 1);
  assert.equal(result.cards.length, 2);
  assert.equal(result.usage.apiDailyRequestsRemaining, 75);
});

test('JustTCG REST fallback uses the documented query parameter and x-api-key', async () => {
  const calls = [];
  const provider = new JustTcgProvider({
    justTcgApiKey: 'test-key',
    justTcgFetch: async (url, options) => {
      calls.push({ url: String(url), options });
      return response({ data: [], meta: { total: 0 }, _metadata: { apiRequestsRemaining: 49 } });
    },
  });
  await provider.searchCards({ query: 'Pikachu', game: 'Pokemon' });
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('query'), 'Pikachu');
  assert.equal(url.searchParams.get('q'), null);
  assert.equal(calls[0].options.headers['x-api-key'], 'test-key');
});
