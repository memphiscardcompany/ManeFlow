import test, { after, before } from 'node:test';
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
const calls = { cardBatches: [], embeddingBatches: [] };

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  return { response, body: await response.json().catch(() => ({})) };
}

before(async () => {
  const cards = JSON.parse(await fs.readFile(new URL('../src/data/cards.json', import.meta.url), 'utf8'));
  const sales = JSON.parse(await fs.readFile(new URL('../src/data/sales.json', import.meta.url), 'utf8'));
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'maneflow-catalog-api-'));
  const config = {
    appName: 'ManeFlow', version: '2.14.0-beta.1', releaseChannel: 'test',
    port: 0, host: '127.0.0.1', publicBaseUrl: 'http://127.0.0.1',
    apiToken: '', serviceToken: 'service-test-token', adminToken: '', bootstrapAdminEmail: '',
    demoMode: true, allowGuestWrites: false, allowPublicSignups: false,
    requireEmailVerification: false, exposeDevTokens: false, accountTokenMinutes: 60, sessionDays: 30,
    allowedOrigins: [], maxRequestBytes: 30_000_000, runtimeFile: path.join(directory, 'state.json'),
    openaiApiKey: '', openaiVisionModel: '', providerWebhookSecret: '', emailWebhookUrl: '', emailWebhookSecret: '',
    ebayClientId: '', ebayClientSecret: '', tcgplayerPublicKey: '', tcgplayerPrivateKey: '',
    embeddingModelName: 'siglip2-so400m-card-front-v1', embeddingModelVersion: '1',
  };
  const store = await new JsonStore(config.runtimeFile).init();
  const providers = createProviderRegistry(config, sales);
  const databaseRuntime = {
    async upsertCatalogCards(items) {
      calls.cardBatches.push(structuredClone(items));
      return items.map((item, index) => ({ id: `card-${index + 1}`, canonical_key: item.canonicalKey }));
    },
    async upsertCardEmbeddings(items) {
      calls.embeddingBatches.push(structuredClone(items));
      return items.map((item, index) => ({ id: `embedding-${index + 1}`, catalog_card_id: item.catalogCardId }));
    },
  };
  server = http.createServer(createRouter({
    config, cards, sales, providers, store, cache: new TtlCache(), databaseRuntime,
  }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});

test('internal catalog persistence endpoints require a service token', async () => {
  const denied = await request('/api/internal/catalog/cards/upsert', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ canonicalKey: 'x' }),
  });
  assert.equal(denied.response.status, 401);
});

test('internal catalog endpoint accepts bounded batch upserts', async () => {
  const result = await request('/api/internal/catalog/cards/upsert', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer service-test-token' },
    body: JSON.stringify({ items: [
      { canonicalKey: 'card-a', sportOrGame: 'baseball', setName: 'Set', cardNumber: '1', subjectName: 'A' },
      { canonicalKey: 'card-b', sportOrGame: 'pokemon', setName: 'Set', cardNumber: '2', subjectName: 'B' },
    ] }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.contractVersion, 'catalog-upsert.v1');
  assert.equal(result.body.count, 2);
  assert.equal(calls.cardBatches.length, 1);
  assert.equal(calls.cardBatches[0].length, 2);
});

test('internal embedding endpoint forwards complete vector records', async () => {
  const vector = Array.from({ length: 1152 }, (_, index) => index === 0 ? 1 : 0);
  const result = await request('/api/internal/catalog/embeddings/upsert', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer service-test-token' },
    body: JSON.stringify({
      catalogCardId: '11111111-1111-4111-8111-111111111111',
      modelName: 'siglip2-so400m-card-front-v1',
      modelVersion: '1',
      frontVector: vector,
    }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.contractVersion, 'catalog-embedding-upsert.v1');
  assert.equal(result.body.count, 1);
  assert.equal(calls.embeddingBatches.length, 1);
  assert.equal(calls.embeddingBatches[0][0].frontVector.length, 1152);
});
