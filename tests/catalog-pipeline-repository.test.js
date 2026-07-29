import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogPipelineError, CatalogPipelineRepository } from '../src/db/catalogPipelineRepository.js';

function fakePool({ failOn = null } = {}) {
  const calls = [];
  let releasedWith = null;
  const client = {
    async query(text, values = undefined) {
      calls.push({ text, values });
      if (failOn && String(text).includes(failOn)) throw new Error('database failure');
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (String(text).includes('INSERT INTO public.catalog_cards')) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111', canonical_key: 'card:1' }], rowCount: 1 };
      }
      if (String(text).includes('INSERT INTO public.catalog_reference_images')) {
        return {
          rows: [{ id: '22222222-2222-4222-8222-222222222222', catalog_card_id: '11111111-1111-4111-8111-111111111111', image_side: 'front', image_uri: 'https://example.com/1.jpg' }],
          rowCount: 1,
        };
      }
      if (String(text).includes('INSERT INTO public.catalog_embedding_queue')) {
        return { rows: [{ id: '33333333-3333-4333-8333-333333333333' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release(error) { releasedWith = error || null; },
  };
  return {
    calls,
    async connect() { return client; },
    get releasedWith() { return releasedWith; },
  };
}

const record = {
  card: {
    canonicalKey: 'card:1',
    sportOrGame: 'baseball',
    releaseYear: 2018,
    manufacturer: 'Topps',
    setName: 'Topps Update',
    cardNumber: 'US1',
    subjectName: 'Shohei Ohtani',
    parallelName: 'BASE',
  },
  referenceImages: [{
    side: 'front',
    uri: 'https://example.com/1.jpg',
    authorizationBasis: 'licensed_api',
    commercialUseAllowed: true,
  }],
};

test('catalog pipeline imports cards, references, and embedding jobs atomically', async () => {
  const pool = fakePool();
  const repository = new CatalogPipelineRepository(pool);
  const result = await repository.importBatch([record], {
    sourceNamespace: 'authorized-provider',
    authorizationBasis: 'licensed_api',
    modelName: 'siglip2-so400m-card-front-v1',
    modelVersion: '1',
  });

  assert.deepEqual(result, {
    cardsUpserted: 1,
    referencesUpserted: 1,
    embeddingJobsEnqueued: 1,
    cards: [{ id: '11111111-1111-4111-8111-111111111111', canonical_key: 'card:1' }],
  });
  assert.equal(pool.calls[0].text, 'BEGIN');
  assert.match(pool.calls[1].text, /jsonb_to_recordset/);
  assert.match(pool.calls[2].text, /catalog_reference_images/);
  assert.match(pool.calls[3].text, /catalog_embedding_queue/);
  assert.equal(pool.calls.at(-1).text, 'COMMIT');
  assert.equal(pool.releasedWith, null);
});

test('catalog pipeline rejects unauthorized reference metadata before opening a transaction', async () => {
  const pool = fakePool();
  const repository = new CatalogPipelineRepository(pool);
  await assert.rejects(
    repository.importBatch([{ ...record, referenceImages: [{ ...record.referenceImages[0], sha256: 'bad' }] }], {
      sourceNamespace: 'authorized-provider',
      authorizationBasis: 'licensed_api',
      modelName: 'siglip2-so400m-card-front-v1',
      modelVersion: '1',
    }),
    /sha256/,
  );
  assert.equal(pool.calls.length, 0);
});

test('catalog pipeline rolls back the entire batch on reference failure', async () => {
  const pool = fakePool({ failOn: 'INSERT INTO public.catalog_reference_images' });
  const repository = new CatalogPipelineRepository(pool);
  await assert.rejects(
    repository.importBatch([record], {
      sourceNamespace: 'authorized-provider',
      authorizationBasis: 'licensed_api',
      modelName: 'siglip2-so400m-card-front-v1',
      modelVersion: '1',
    }),
    (error) => error instanceof CatalogPipelineError
      && error.code === 'CATALOG_BATCH_IMPORT_FAILED'
      && error.details.records === 1,
  );
  assert.equal(pool.calls.at(-1).text, 'ROLLBACK');
  assert.equal(pool.calls.some((call) => call.text === 'COMMIT'), false);
});
