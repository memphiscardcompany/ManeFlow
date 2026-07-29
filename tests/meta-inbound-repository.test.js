import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MetaInboundRepository,
} from '../src/db/metaInboundRepository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const digest = 'a'.repeat(64);
const event = {
  provider: 'meta',
  channel: 'messenger',
  providerAccountId: 'page-1',
  providerEventId: 'mid.1',
  providerMessageId: 'mid.1',
  providerConversationId: 'messenger:page-1:sender-1',
  providerSenderId: 'sender-1',
  body: 'Please price this card.',
  receivedAt: '2026-07-29T12:00:00.000Z',
  attachments: [],
};

function fakePool(resultFactory) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ text: String(sql), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
      if (String(sql).includes('set_config')) return { rows: [{ set_config: ownerId }], rowCount: 1 };
      return resultFactory(String(sql), values);
    },
    release() {
      calls.push({ text: 'RELEASE' });
    },
  };
  return { calls, pool: { async connect() { return client; } } };
}

test('Meta inbox ingestion is owner-scoped, set-based, replay-safe, and audit-chained', async () => {
  const fixture = fakePool((sql) => {
    if (sql.includes('FROM public.manebrain_meta_assets')) {
      return { rows: [{ id: 'asset-1' }], rowCount: 1 };
    }
    if (sql.includes('existing.payload_sha256 <>')) return { rows: [], rowCount: 0 };
    if (sql.includes('WITH input AS') && sql.includes('inserted_events AS')) {
      return {
        rows: [{ provider_event_id: 'mid.1', conversation_id: conversationId }],
        rowCount: 1,
      };
    }
    if (sql.includes('SELECT entry_hash')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
  const repository = new MetaInboundRepository(fixture.pool);
  const result = await repository.ingestBatch(ownerId, { events: [event], payloadSha256: digest });
  assert.equal(result.accepted[0].conversationId, conversationId);
  const bulkInsert = fixture.calls.find((call) => call.text.includes('inserted_events AS'));
  assert.match(bulkInsert.text, /jsonb_to_recordset/);
  assert.match(bulkInsert.text, /ON CONFLICT \(owner_user_id, provider_account_id, provider_event_id\) DO NOTHING/);
  assert.match(bulkInsert.text, /INSERT INTO public\.manebrain_messages/);
  assert.ok(fixture.calls.some((call) => call.text.includes('pg_advisory_xact_lock')));
  assert.ok(fixture.calls.some((call) => call.text.includes("'inbound_batch_queued'")));
  assert.deepEqual(fixture.calls.slice(-2).map((call) => call.text), ['COMMIT', 'RELEASE']);
});

test('Meta inbox rejects same provider event ID with different signed payload bytes', async () => {
  const fixture = fakePool((sql) => {
    if (sql.includes('FROM public.manebrain_meta_assets')) {
      return { rows: [{ id: 'asset-1' }], rowCount: 1 };
    }
    if (sql.includes('existing.payload_sha256 <>')) {
      return { rows: [{ providerEventId: 'mid.1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(
    new MetaInboundRepository(fixture.pool).ingestBatch(ownerId, {
      events: [event],
      payloadSha256: digest,
    }),
    { code: 'META_REPLAY_PAYLOAD_MISMATCH' },
  );
  assert.ok(fixture.calls.some((call) => call.text === 'ROLLBACK'));
  assert.equal(fixture.calls.some((call) => call.text.includes('inserted_events AS')), false);
});

test('Meta inbox pagination requires a complete keyset cursor', async () => {
  const fixture = fakePool(() => ({ rows: [], rowCount: 0 }));
  const repository = new MetaInboundRepository(fixture.pool);
  await assert.rejects(repository.listConversations(ownerId, {
    beforeUpdatedAt: '2026-07-29T12:00:00.000Z',
  }), /provided together/);
  assert.equal(fixture.calls.length, 0);
});
