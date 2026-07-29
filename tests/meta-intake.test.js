import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestMetaWebhook } from '../src/manebrain/meta-intake.js';
import { normalizeMetaWebhook } from '../src/manebrain/meta-normalizer.js';
import { signMetaPayload } from '../src/manebrain/meta-security.js';

const ownerUserId = '11111111-1111-4111-8111-111111111111';
const now = Date.parse('2026-07-29T12:00:00.000Z');
const config = {
  metaIntakeEnabled: true,
  metaKillSwitch: false,
  metaAppSecret: 'meta-app-secret',
  metaAppId: 'app-1',
  metaBusinessId: 'business-1',
  metaPageId: 'page-1',
  metaInstagramAccountId: 'instagram-1',
  maxRequestBytes: 1_000_000,
};

function pageMessage(overrides = {}) {
  return {
    object: 'page',
    entry: [{
      id: 'page-1',
      time: now,
      messaging: [{
        sender: { id: 'sender-1' },
        recipient: { id: 'page-1' },
        timestamp: now,
        message: {
          mid: 'mid.1',
          text: 'What is this card worth?',
          attachments: [{
            type: 'image',
            payload: { url: 'https://lookaside.example/card.jpg' },
          }],
        },
        ...overrides,
      }],
    }],
  };
}

test('Meta normalization preserves provider identity and never invents missing IDs or time', () => {
  const normalized = normalizeMetaWebhook(pageMessage());
  assert.equal(normalized.events.length, 1);
  assert.equal(normalized.events[0].channel, 'messenger');
  assert.equal(normalized.events[0].providerEventId, 'mid.1');
  assert.equal(normalized.events[0].providerAccountId, 'page-1');
  assert.equal(normalized.events[0].attachments[0].type, 'image');

  const missingIdentity = pageMessage();
  delete missingIdentity.entry[0].messaging[0].message.mid;
  delete missingIdentity.entry[0].messaging[0].timestamp;
  delete missingIdentity.entry[0].time;
  const rejected = normalizeMetaWebhook(missingIdentity);
  assert.equal(rejected.events.length, 0);
  assert.equal(rejected.ignored[0].reason, 'UNSTABLE_MESSAGE_IDENTITY');
});

test('Meta intake verifies exact raw bytes before parsing and persists only allowlisted fresh events', async () => {
  const rawBody = Buffer.from(JSON.stringify(pageMessage()));
  const calls = [];
  const repository = {
    async ingestBatch(owner, input) {
      calls.push({ owner, input });
      return {
        accepted: [{ providerEventId: 'mid.1', conversationId: 'conversation-1' }],
        duplicates: [],
      };
    },
  };
  const outcome = await ingestMetaWebhook({
    rawBody,
    signature: signMetaPayload(rawBody, config.metaAppSecret),
    config,
    repository,
    ownerUserId,
    now,
  });
  assert.equal(outcome.status, 202);
  assert.deepEqual(outcome.body, { accepted: 1, duplicates: 0, rejected: 0 });
  assert.equal(calls[0].owner, ownerUserId);
  assert.match(calls[0].input.payloadSha256, /^[a-f0-9]{64}$/);

  const invalidSignature = await ingestMetaWebhook({
    rawBody,
    signature: signMetaPayload(Buffer.from(`${rawBody} `), config.metaAppSecret),
    config,
    repository,
    ownerUserId,
    now,
  });
  assert.equal(invalidSignature.status, 401);
  assert.equal(calls.length, 1);
});

test('Meta kill switch and asset allowlist fail closed before persistence', async () => {
  const rawBody = Buffer.from(JSON.stringify(pageMessage()));
  let writes = 0;
  const repository = {
    async ingestBatch() {
      writes += 1;
      return { accepted: [], duplicates: [] };
    },
  };
  const disabled = await ingestMetaWebhook({
    rawBody,
    signature: signMetaPayload(rawBody, config.metaAppSecret),
    config: { ...config, metaKillSwitch: true },
    repository,
    ownerUserId,
    now,
  });
  assert.equal(disabled.status, 503);

  const wrongPage = Buffer.from(JSON.stringify({
    ...pageMessage(),
    entry: [{ ...pageMessage().entry[0], id: 'unapproved-page' }],
  }));
  const wrongAsset = await ingestMetaWebhook({
    rawBody: wrongPage,
    signature: signMetaPayload(wrongPage, config.metaAppSecret),
    config,
    repository,
    ownerUserId,
    now,
  });
  assert.equal(wrongAsset.status, 202);
  assert.equal(wrongAsset.body.accepted, 0);
  assert.equal(wrongAsset.body.rejected, 1);
  assert.equal(writes, 0);
});
