import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaOwnerRepository } from '../src/db/metaOwnerRepository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const draftId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';

function fakePool(handler) {
  const calls = [];
  const client = {
    async query(text, values) {
      const sql = String(text);
      calls.push({ sql, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
      if (sql.includes('set_config')) return { rows: [{ set_config: ownerId }], rowCount: 1 };
      return handler(sql, values);
    },
    release() { calls.push({ sql: 'RELEASE', values: undefined }); },
  };
  return { calls, pool: { async connect() { return client; } } };
}

test('owner creates a versioned draft with immutable audit evidence', async () => {
  const draft = {
    id: draftId,
    conversation_id: conversationId,
    version: 1,
    body: 'I will verify the exact card before quoting a value.',
    source: 'owner_manual',
    status: 'DRAFT',
  };
  const { pool, calls } = fakePool((sql) => {
    if (sql.includes('FROM public.manebrain_conversations')) return { rows: [{ id: conversationId }], rowCount: 1 };
    if (sql.includes('INSERT INTO public.manebrain_reply_drafts')) return { rows: [draft], rowCount: 1 };
    if (sql.includes('SELECT entry_hash')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  const repository = new MetaOwnerRepository(pool);
  const created = await repository.createDraft(ownerId, {
    conversationId,
    body: draft.body,
    source: 'owner_manual',
    actorId: ownerId,
  });
  assert.equal(created.id, draftId);
  assert.ok(calls.some(({ sql }) => sql.includes('COALESCE(MAX(version), 0) + 1')));
  const audit = calls.find(({ sql }) => sql.includes('INSERT INTO public.manebrain_audit_log'));
  assert.ok(audit);
  assert.doesNotMatch(audit.values[3], new RegExp(draft.body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(audit.values[3], /bodySha256/);
});

test('approval is separate from queueing and records the exact text hash', async () => {
  const approvedText = 'Thanks. I am verifying the certification and completed sales now.';
  const { pool, calls } = fakePool((sql) => {
    if (sql.includes('FROM public.manebrain_reply_drafts') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: draftId, conversation_id: conversationId, status: 'DRAFT' }], rowCount: 1 };
    }
    if (sql.includes('FROM public.manebrain_outbound_jobs') && sql.includes('draft_id')) return { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO public.manebrain_outbound_jobs')) {
      return { rows: [{ id: jobId, conversation_id: conversationId, draft_id: draftId, status: 'HELD_POLICY_REVIEW' }], rowCount: 1 };
    }
    if (sql.includes('SELECT entry_hash')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  const repository = new MetaOwnerRepository(pool);
  const job = await repository.approveDraft(ownerId, {
    draftId,
    approvedText,
    approvedBy: ownerId,
  });
  assert.equal(job.status, 'HELD_POLICY_REVIEW');
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO public.manebrain_outbound_jobs'));
  assert.equal(insert.values[3], approvedText);
  assert.match(insert.values[4], /^[a-f0-9]{64}$/);
  assert.ok(calls.some(({ sql }) => sql.includes("SET status = 'APPROVED_BY_HUMAN'")));
  assert.equal(calls.some(({ sql }) => sql.includes("SET status = 'SEND_QUEUED'")), false);
});

test('queueing requires the exact owner-approved text', async () => {
  const approvedText = 'Exact approved reply.';
  const { pool, calls } = fakePool((sql) => {
    if (sql.includes("SET status = 'SEND_QUEUED'")) {
      return { rows: [{ id: jobId, conversation_id: conversationId, status: 'SEND_QUEUED' }], rowCount: 1 };
    }
    if (sql.includes('SELECT entry_hash')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  const repository = new MetaOwnerRepository(pool);
  const queued = await repository.queueApprovedJob(ownerId, {
    jobId,
    currentText: approvedText,
    actorId: ownerId,
  });
  assert.equal(queued.status, 'SEND_QUEUED');
  const update = calls.find(({ sql }) => sql.includes("SET status = 'SEND_QUEUED'"));
  assert.equal(update.values[3], approvedText);
  assert.match(update.values[4], /^[a-f0-9]{64}$/);
  assert.match(update.sql, /approved_text_sha256 = \$5/);
});

test('owner mismatch and invalid IDs fail before database mutation', async () => {
  const { pool, calls } = fakePool(() => ({ rows: [], rowCount: 0 }));
  const repository = new MetaOwnerRepository(pool);
  await assert.rejects(repository.approveDraft(ownerId, {
    draftId,
    approvedText: 'reply',
    approvedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }), { code: 'META_APPROVAL_OWNER_MISMATCH' });
  await assert.rejects(repository.getOutboundJob(ownerId, 'not-a-uuid'), /must be a UUID/);
  assert.equal(calls.length, 0);
});
