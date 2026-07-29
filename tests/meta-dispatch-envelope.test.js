import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMetaDispatchEnvelope } from '../src/manebrain/meta-dispatch-envelope.js';

const ownerUserId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const leaseToken = '33333333-3333-4333-8333-333333333333';

function fakePool(row) {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text: String(text), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [], rowCount: 0 };
      if (String(text).includes('set_config')) return { rows: [{ set_config: ownerUserId }], rowCount: 1 };
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    },
    release() { calls.push({ text: 'RELEASE' }); },
  };
  return { calls, pool: { async connect() { return client; } } };
}

test('dispatch envelope is loaded under owner RLS and the active lease fence', async () => {
  const { pool, calls } = fakePool({
    id: jobId,
    conversation_id: '44444444-4444-4444-8444-444444444444',
    approved_text: 'Approved response',
    approved_text_sha256: 'a'.repeat(64),
    idempotency_key: '55555555-5555-4555-8555-555555555555',
    attempts: 1,
    max_attempts: 3,
    channel: 'messenger',
    provider_account_id: 'page-1',
    provider_sender_id: 'psid-1',
  });
  const envelope = await loadMetaDispatchEnvelope(pool, ownerUserId, { jobId, leaseToken });
  assert.equal(envelope.jobId, jobId);
  assert.equal(envelope.channel, 'messenger');
  assert.equal(envelope.providerSenderId, 'psid-1');
  const query = calls.find((call) => call.text.includes('manebrain_outbound_jobs'));
  assert.ok(query);
  assert.match(query.text, /job\.status = 'DISPATCHING'/);
  assert.match(query.text, /job\.lease_token = \$3/);
  assert.deepEqual(query.values, [ownerUserId, jobId, leaseToken]);
  assert.deepEqual(calls.slice(-2).map((call) => call.text), ['COMMIT', 'RELEASE']);
});

test('dispatch envelope returns null when the owner or lease no longer matches', async () => {
  const { pool } = fakePool(null);
  const envelope = await loadMetaDispatchEnvelope(pool, ownerUserId, { jobId, leaseToken });
  assert.equal(envelope, null);
});
