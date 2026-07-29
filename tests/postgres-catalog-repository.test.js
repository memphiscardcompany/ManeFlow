import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogRepository, CatalogRepositoryError } from '../src/db/catalogRepository.js';

function fakePool({ failOn } = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(query) {
      const text = typeof query === 'string' ? query : query.text;
      const values = typeof query === 'string' ? undefined : query.values;
      calls.push({ text, values });
      if (failOn && text.includes(failOn)) throw new Error('database failure');
      if (text === 'COMMIT' || text === 'ROLLBACK' || text === 'BEGIN') return { rows: [] };
      return { rows: [{ id: 'saved-id', catalog_card_id: values?.[0] || null }] };
    },
    release() { released = true; },
  };
  return {
    calls,
    client,
    get released() { return released; },
    async connect() { return client; },
  };
}

test('catalog card upsert commits and releases its transaction client', async () => {
  const pool = fakePool();
  const repository = new CatalogRepository(pool);
  const row = await repository.upsertCatalogCard({
    canonicalKey: 'baseball:2018:topps-update:us1:shohei-ohtani:base:en',
    sportOrGame: 'baseball',
    releaseYear: 2018,
    manufacturer: 'Topps',
    setName: 'Topps Update',
    cardNumber: 'US1',
    subjectName: 'Shohei Ohtani',
    parallelName: 'BASE',
    metadata: { source: 'test' },
  });
  assert.equal(row.id, 'saved-id');
  assert.equal(pool.calls[0].text, 'BEGIN');
  assert.match(pool.calls[1].text, /INSERT INTO public\.catalog_cards/);
  assert.equal(pool.calls.at(-1).text, 'COMMIT');
  assert.equal(pool.released, true);
});

test('embedding upsert normalizes a 1152-dimensional vector before commit', async () => {
  const pool = fakePool();
  const repository = new CatalogRepository(pool);
  const frontVector = Array.from({ length: 1152 }, (_, index) => index === 0 ? 3 : index === 1 ? 4 : 0);
  await repository.upsertCardEmbedding({
    catalogCardId: '11111111-1111-4111-8111-111111111111',
    modelName: 'siglip2-so400m-card-front-v1',
    modelVersion: '1',
    frontVector,
  });
  const insert = pool.calls.find((call) => call.text.includes('INSERT INTO public.catalog_card_embeddings'));
  assert.ok(insert);
  assert.match(insert.values[3], /^\[0\.6,0\.8,0/);
  assert.equal(pool.calls.at(-1).text, 'COMMIT');
  assert.equal(pool.released, true);
});

test('catalog repository rolls back and releases when PostgreSQL fails', async () => {
  const pool = fakePool({ failOn: 'INSERT INTO public.catalog_cards' });
  const repository = new CatalogRepository(pool);
  await assert.rejects(
    repository.upsertCatalogCard({
      canonicalKey: 'failure-card',
      sportOrGame: 'baseball',
      setName: 'Test Set',
      cardNumber: '1',
      subjectName: 'Test Player',
    }),
    (error) => error instanceof CatalogRepositoryError && error.code === 'CATALOG_CARD_UPSERT_FAILED',
  );
  assert.equal(pool.calls.at(-1).text, 'ROLLBACK');
  assert.equal(pool.released, true);
});


test('catalog batch upsert is atomic and rolls back all records when a later insert fails', async () => {
  let insertCount = 0;
  const calls = [];
  let released = false;
  const client = {
    async query(query) {
      const text = typeof query === 'string' ? query : query.text;
      const values = typeof query === 'string' ? undefined : query.values;
      calls.push({ text, values });
      if (text.includes('INSERT INTO public.catalog_cards')) {
        insertCount += 1;
        if (insertCount === 2) throw new Error('second insert failed');
        return { rows: [{ id: 'first-id', canonical_key: values[0] }] };
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
  const pool = { async connect() { return client; } };
  const repository = new CatalogRepository(pool);

  await assert.rejects(
    repository.upsertCatalogCards([
      {
        canonicalKey: 'card-one', sportOrGame: 'baseball', setName: 'Set', cardNumber: '1', subjectName: 'One',
      },
      {
        canonicalKey: 'card-two', sportOrGame: 'baseball', setName: 'Set', cardNumber: '2', subjectName: 'Two',
      },
    ]),
    (error) => error instanceof CatalogRepositoryError
      && error.code === 'CATALOG_CARD_UPSERT_FAILED'
      && error.details.count === 2,
  );

  assert.equal(calls.filter((call) => call.text.includes('INSERT INTO public.catalog_cards')).length, 2);
  assert.equal(calls.at(-1).text, 'ROLLBACK');
  assert.equal(calls.some((call) => call.text === 'COMMIT'), false);
  assert.equal(released, true);
});
