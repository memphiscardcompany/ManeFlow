import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaDeliveryRepository } from '../src/db/metaDeliveryRepository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';

function echo(overrides = {}) {
  return {
    provider: 'meta',
    channel: 'messenger',
    direction: 'outbound',
    isEcho: true,
    providerMessageId: 'mid.sent.1',
    receivedAt: '2026-07-29T13:00:00.000Z',
    ...overrides,
  };
}

function fakePool() {
  const calls = [];
  const client = {
    async query(text, values) {
      const sql = String(text);
      calls.push({ text: sql, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [], rowCount: 0 };
      if (sql.includes('set_config')) return { rows: [{ set_config: ownerId }], rowCount: 1 };
      if (sql.includes('UPDATE public.manebrain_messages')) {
        return { rows: [{ provider_message_id: 'mid.sent.1' }], rowCount: 1 };
      }
      if (sql.includes('UPDATE public.manebrain_outbound_jobs')) {
        return {
          rows: [{ id: '22222222-2222-4222-8222-222222222222', provider_message_id: 'mid.sent.1', provider_echo_at: '2026-07-29T13:00:00.000Z' }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT entry_hash')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO public.manebrain_audit_log')) return { rows: [], rowCount: 1 };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push({ text: 'RELEASE' }); },
  };
  return { calls, pool: { async connect() { return client; } } };
}

test('delivery reconciliation updates only owner-scoped messages and SENT jobs', async () => {
  const { pool, calls } = fakePool();
  const result = await new MetaDeliveryRepository(pool).reconcileEchoes(ownerId, [echo()]);
  assert.deepEqual(result, { observed: 1, matchedJobs: 1, updatedMessages: 1 });

  const messageQuery = calls.find((entry) => entry.text.includes('UPDATE public.manebrain_messages'));
  assert.match(messageQuery.text, /message\.owner_user_id = \$1/);
  assert.match(messageQuery.text, /SET direction = 'outbound'/);

  const jobQuery = calls.find((entry) => entry.text.includes('UPDATE public.manebrain_outbound_jobs'));
  assert.match(jobQuery.text, /job\.owner_user_id = \$1/);
  assert.match(jobQuery.text, /job\.status = 'SENT'/);
  assert.match(jobQuery.text, /job\.provider_message_id = input\."providerMessageId"/);

  const audit = calls.find((entry) => entry.text.includes('INSERT INTO public.manebrain_audit_log'));
  assert.ok(audit);
  assert.match(audit.values[2], /mid\.sent\.1/);
});

test('delivery reconciliation is a no-op without provider echoes', async () => {
  const { pool, calls } = fakePool();
  const repository = new MetaDeliveryRepository(pool);
  const result = await repository.reconcileEchoes(ownerId, [{ ...echo(), isEcho: false, direction: 'inbound' }]);
  assert.deepEqual(result, { observed: 0, matchedJobs: 0, updatedMessages: 0 });
  assert.equal(calls.length, 0);
});

test('delivery reconciliation rejects malformed echo evidence', async () => {
  const { pool } = fakePool();
  const repository = new MetaDeliveryRepository(pool);
  await assert.rejects(repository.reconcileEchoes(ownerId, [{ ...echo(), receivedAt: 'not-a-time' }]), /receivedAt/);
  await assert.rejects(repository.reconcileEchoes(ownerId, [{ ...echo(), direction: 'inbound' }]), /outbound Meta echo/);
});
