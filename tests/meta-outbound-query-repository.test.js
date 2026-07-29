import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaOutboundQueryRepository } from '../src/db/metaOutboundQueryRepository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const beforeId = '22222222-2222-4222-8222-222222222222';

function fakePool(resultFactory = () => ({ rows: [], rowCount: 0 })) {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text: String(text), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [], rowCount: 0 };
      if (String(text).includes('set_config')) return { rows: [{ set_config: ownerId }], rowCount: 1 };
      return resultFactory(String(text), values);
    },
    release() { calls.push({ text: 'RELEASE' }); },
  };
  return { calls, pool: { async connect() { return client; } } };
}

test('outbound queue listing is owner scoped, status filtered, and keyset paginated', async () => {
  const { pool, calls } = fakePool((sql) => ({
    rows: sql.includes('FROM public.manebrain_outbound_jobs AS job')
      ? [{ id: beforeId, status: 'DEAD_LETTER', channel: 'messenger' }]
      : [],
    rowCount: 1,
  }));
  const repository = new MetaOutboundQueryRepository(pool);
  const rows = await repository.list(ownerId, {
    status: 'dead_letter',
    limit: 25,
    beforeUpdatedAt: '2026-07-29T12:00:00.000Z',
    beforeId,
  });
  assert.equal(rows.length, 1);
  const query = calls.find((entry) => entry.text.includes('FROM public.manebrain_outbound_jobs AS job'));
  assert.ok(query);
  assert.match(query.text, /job\.owner_user_id = \$1/);
  assert.match(query.text, /\(job\.updated_at, job\.id\) < \(\$3::timestamptz, \$4::uuid\)/);
  assert.match(query.text, /ORDER BY job\.updated_at DESC, job\.id DESC/);
  assert.deepEqual(query.values, [ownerId, 'DEAD_LETTER', '2026-07-29T12:00:00.000Z', beforeId, 25]);
});

test('outbound queue listing rejects invalid state and incomplete cursor', async () => {
  const { pool } = fakePool();
  const repository = new MetaOutboundQueryRepository(pool);
  await assert.rejects(repository.list(ownerId, { status: 'not-a-state' }), /status/);
  await assert.rejects(repository.list(ownerId, { beforeUpdatedAt: '2026-07-29T12:00:00.000Z' }), /provided together/);
});

test('outbound counts are owner scoped and normalized to numbers', async () => {
  const { pool, calls } = fakePool((sql) => ({
    rows: sql.includes('GROUP BY status')
      ? [{ status: 'DEAD_LETTER', count: '2' }, { status: 'DELIVERY_UNKNOWN', count: 1 }]
      : [],
    rowCount: 2,
  }));
  const counts = await new MetaOutboundQueryRepository(pool).counts(ownerId);
  assert.deepEqual(counts, { DEAD_LETTER: 2, DELIVERY_UNKNOWN: 1 });
  const query = calls.find((entry) => entry.text.includes('GROUP BY status'));
  assert.match(query.text, /WHERE owner_user_id = \$1/);
  assert.deepEqual(query.values, [ownerId]);
});
