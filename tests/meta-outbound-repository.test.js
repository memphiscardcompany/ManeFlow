import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaOutboundRepository } from '../src/db/metaOutboundRepository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const leaseToken = '33333333-3333-4333-8333-333333333333';

function fakePool(resultFactory = () => ({ rows: [], rowCount: 0 })) {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text: String(text), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return { rows: [], rowCount: 0 };
      if (String(text).includes('set_config')) return { rows: [{ set_config: ownerId }], rowCount: 1 };
      return resultFactory(String(text), values);
    },
    release() { calls.push({ text: 'RELEASE', values: undefined }); },
  };
  return {
    calls,
    pool: { async connect() { return client; } },
  };
}

test('Meta outbox refuses to claim when dispatch policy is disabled', async () => {
  const { pool, calls } = fakePool();
  const repository = new MetaOutboundRepository(pool);
  await assert.rejects(repository.claimNext(ownerId), { code: 'META_DISPATCH_DISABLED' });
  assert.equal(calls.length, 0);
});

test('Meta outbox claim is transaction-local, skip-locked, and creates a fenced attempt', async () => {
  const { pool, calls } = fakePool((sql) => ({
    rows: sql.includes('FOR UPDATE SKIP LOCKED') ? [{ id: jobId, status: 'DISPATCHING' }] : [],
    rowCount: sql.includes('FOR UPDATE SKIP LOCKED') ? 1 : 0,
  }));
  const repository = new MetaOutboundRepository(pool);
  const claimed = await repository.claimNext(ownerId, { dispatchAllowed: true });
  assert.equal(claimed.status, 'DISPATCHING');
  const claim = calls.find((entry) => entry.text.includes('FOR UPDATE SKIP LOCKED'));
  assert.ok(claim);
  assert.match(claim.text, /INSERT INTO public\.manebrain_outbound_attempts/);
  assert.equal(claim.values[0], ownerId);
  assert.match(claim.values[1], /^[0-9a-f-]{36}$/i);
  assert.match(claim.values[3], /^[0-9a-f-]{36}$/i);
  assert.deepEqual(calls.slice(-2).map((entry) => entry.text), ['COMMIT', 'RELEASE']);
});

test('accepted delivery is terminal and records the provider message under the lease fence', async () => {
  const { pool, calls } = fakePool((sql) => ({
    rows: sql.includes('completed_attempt') ? [{ id: jobId, status: 'SENT', provider_message_id: 'mid.1' }] : [],
    rowCount: sql.includes('completed_attempt') ? 1 : 0,
  }));
  const repository = new MetaOutboundRepository(pool);
  const completed = await repository.completeAccepted(ownerId, {
    jobId,
    leaseToken,
    providerMessageId: 'mid.1',
    responseMetadata: { provider: 'meta' },
  });
  assert.equal(completed.status, 'SENT');
  const completion = calls.find((entry) => entry.text.includes('completed_attempt'));
  assert.match(completion.text, /status = 'DISPATCHING'/);
  assert.match(completion.text, /lease_token = \$3/);
  assert.match(completion.text, /WHEN \$4 = 'accepted' THEN 'SENT'/);
  assert.equal(completion.values[4], 'mid.1');
});

test('unknown delivery and expired leases become terminal reconciliation states, never retries', async () => {
  const unknownPool = fakePool((sql) => ({
    rows: sql.includes('completed_attempt') ? [{ id: jobId, status: 'DELIVERY_UNKNOWN' }] : [],
    rowCount: sql.includes('completed_attempt') ? 1 : 0,
  }));
  const repository = new MetaOutboundRepository(unknownPool.pool);
  const unknown = await repository.completeOutcomeUnknown(ownerId, { jobId, leaseToken });
  assert.equal(unknown.status, 'DELIVERY_UNKNOWN');
  const unknownQuery = unknownPool.calls.find((entry) => entry.text.includes('completed_attempt'));
  assert.match(unknownQuery.text, /WHEN \$4 = 'outcome_unknown' THEN 'DELIVERY_UNKNOWN'/);

  const expiredPool = fakePool((sql) => ({
    rows: sql.includes('WITH expired AS') ? [{ id: jobId, status: 'DELIVERY_UNKNOWN' }] : [],
    rowCount: sql.includes('WITH expired AS') ? 1 : 0,
  }));
  const reconciled = await new MetaOutboundRepository(expiredPool.pool).reconcileExpiredLeases(ownerId);
  assert.equal(reconciled[0].status, 'DELIVERY_UNKNOWN');
  const reconciliation = expiredPool.calls.find((entry) => entry.text.includes('WITH expired AS'));
  assert.match(reconciliation.text, /state = 'OUTCOME_UNKNOWN'/);
  assert.doesNotMatch(reconciliation.text, /RETRY_WAIT/);
});
