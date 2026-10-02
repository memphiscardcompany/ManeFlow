import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { MetaOutboundRepository } from '../src/db/metaOutboundRepository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const leaseToken = '33333333-3333-4333-8333-333333333333';
const approvedText = 'Exact owner-approved reply.';
const approvalHash = crypto.createHash('sha256').update(Buffer.from(approvedText, 'utf8')).digest('hex');
const approvalNow = Date.parse('2026-10-02T06:00:00.000Z');

function claimRow(overrides = {}) {
  return {
    id: jobId,
    status: 'SEND_QUEUED',
    attempts: 0,
    max_attempts: 3,
    approved_text: approvedText,
    approved_text_sha256: approvalHash,
    approved_by: ownerId,
    approved_at: '2026-10-02T05:55:00.000Z',
    channel: 'messenger',
    provider_account_id: 'page-1',
    provider_conversation_id: 'conversation-provider-1',
    provider_sender_id: 'sender-1',
    target_provider_message_id: 'mid.target.1',
    ...overrides,
  };
}

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

function claimPool(firstRow) {
  let candidateCalls = 0;
  return fakePool((sql, values) => {
    if (sql.includes('FROM public.manebrain_outbound_jobs AS job')) {
      candidateCalls += 1;
      return candidateCalls === 1
        ? { rows: [firstRow], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes('WITH updated AS')) {
      return {
        rows: [{ ...firstRow, status: 'DISPATCHING', lease_token: values[2] }],
        rowCount: 1,
      };
    }
    if (sql.includes('UPDATE public.manebrain_outbound_jobs') && sql.includes('status = $3')) {
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

function claimOptions(overrides = {}) {
  return {
    dispatchAllowed: true,
    activeOwnerUserIds: [ownerId],
    approvalMaxAgeMs: 15 * 60_000,
    now: approvalNow,
    ...overrides,
  };
}

test('Meta outbox refuses to claim when dispatch policy is disabled', async () => {
  const { pool, calls } = fakePool();
  const repository = new MetaOutboundRepository(pool);
  await assert.rejects(repository.claimNext(ownerId), { code: 'META_DISPATCH_DISABLED' });
  assert.equal(calls.length, 0);
});

test('Meta outbox claim revalidates approval and creates a fenced attempt only after policy passes', async () => {
  const { pool, calls } = claimPool(claimRow());
  const repository = new MetaOutboundRepository(pool);
  const claimed = await repository.claimNext(ownerId, claimOptions());
  assert.equal(claimed.status, 'DISPATCHING');

  const candidate = calls.find((entry) => entry.text.includes('FROM public.manebrain_outbound_jobs AS job'));
  assert.ok(candidate);
  assert.match(candidate.text, /FOR UPDATE OF job SKIP LOCKED/);
  assert.match(candidate.text, /draft\.target_provider_message_id/);
  assert.doesNotMatch(candidate.text, /latest_inbound/);

  const claim = calls.find((entry) => entry.text.includes('WITH updated AS'));
  assert.ok(claim);
  assert.match(claim.text, /INSERT INTO public\.manebrain_outbound_attempts/);
  assert.equal(claim.values[0], ownerId);
  assert.match(claim.values[2], /^[0-9a-f-]{36}$/i);
  assert.match(claim.values[4], /^[0-9a-f-]{36}$/i);
  assert.equal(claim.values[9], 'mid.target.1');
  assert.deepEqual(calls.slice(-2).map((entry) => entry.text), ['COMMIT', 'RELEASE']);
});

test('tampered approved text is held and never creates a dispatch attempt', async () => {
  const { pool, calls } = claimPool(claimRow({ approved_text: 'Tampered after approval.' }));
  const repository = new MetaOutboundRepository(pool);
  const claimed = await repository.claimNext(ownerId, claimOptions());
  assert.equal(claimed, null);

  const hold = calls.find((entry) => entry.text.includes('status = $3'));
  assert.ok(hold);
  assert.equal(hold.values[2], 'HELD_POLICY_REVIEW');
  assert.equal(hold.values[3], 'META_APPROVAL_TEXT_HASH_MISMATCH');
  assert.equal(calls.some((entry) => entry.text.includes('INSERT INTO public.manebrain_outbound_attempts')), false);
});

test('expired approval is held and never creates a dispatch attempt', async () => {
  const { pool, calls } = claimPool(claimRow({ approved_at: '2026-10-02T05:30:00.000Z' }));
  const repository = new MetaOutboundRepository(pool);
  const claimed = await repository.claimNext(ownerId, claimOptions());
  assert.equal(claimed, null);

  const hold = calls.find((entry) => entry.text.includes('status = $3'));
  assert.equal(hold.values[2], 'HELD_POLICY_REVIEW');
  assert.equal(hold.values[3], 'META_APPROVAL_EXPIRED');
  assert.equal(calls.some((entry) => entry.text.includes('WITH updated AS')), false);
});

test('owner removed from the active allowlist is dead-lettered and never sent', async () => {
  const { pool, calls } = claimPool(claimRow());
  const repository = new MetaOutboundRepository(pool);
  const claimed = await repository.claimNext(ownerId, claimOptions({ activeOwnerUserIds: [] }));
  assert.equal(claimed, null);

  const dead = calls.find((entry) => entry.text.includes('status = $3'));
  assert.equal(dead.values[2], 'DEAD_LETTER');
  assert.equal(dead.values[3], 'META_APPROVAL_OWNER_REVOKED');
  assert.equal(calls.some((entry) => entry.text.includes('WITH updated AS')), false);
});

test('missing exact approval target is held before dispatch', async () => {
  const { pool, calls } = claimPool(claimRow({ target_provider_message_id: null }));
  const repository = new MetaOutboundRepository(pool);
  const claimed = await repository.claimNext(ownerId, claimOptions());
  assert.equal(claimed, null);

  const hold = calls.find((entry) => entry.text.includes('status = $3'));
  assert.equal(hold.values[2], 'HELD_POLICY_REVIEW');
  assert.equal(hold.values[3], 'META_APPROVAL_TARGET_MISSING');
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
