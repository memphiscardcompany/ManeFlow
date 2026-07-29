import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMetaOwnerRouter } from '../src/manebrain/meta-owner-router.js';
import { createSessionToken, hashSessionToken } from '../src/services/auth.js';

let server;
let baseUrl;
let ownerToken;
let otherToken;
let config;

async function request(pathname, token, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  return { response, body: await response.json().catch(() => ({})) };
}

before(async () => {
  ownerToken = createSessionToken();
  otherToken = createSessionToken();
  const sessions = new Map([
    [hashSessionToken(ownerToken), {
      id: 'session-owner', userId: 'owner-user', mfaVerifiedAt: new Date().toISOString(), reauthenticatedAt: null,
    }],
    [hashSessionToken(otherToken), {
      id: 'session-other', userId: 'other-user', mfaVerifiedAt: new Date().toISOString(), reauthenticatedAt: new Date().toISOString(),
    }],
  ]);
  const users = new Map([
    ['owner-user', { id: 'owner-user', email: 'owner@example.com', role: 'admin', emailVerifiedAt: new Date().toISOString() }],
    ['other-user', { id: 'other-user', email: 'other@example.com', role: 'admin', emailVerifiedAt: new Date().toISOString() }],
  ]);
  const store = {
    findSession: (hash) => sessions.get(hash) || null,
    findUserById: (id) => users.get(id) || null,
  };
  config = {
    publicBaseUrl: 'http://127.0.0.1', allowedOrigins: [], csrfProtection: true,
    requireEmailVerification: true, serviceToken: 'service-token',
    platformOwnerUserIds: ['owner-user'], ownerRecentReauthMinutes: 15,
    metaKillSwitch: true, metaIntakeEnabled: false, metaOutboundEnabled: false,
    metaOutboundChannels: ['messenger', 'instagram_dm'], metaGraphApiVersion: '',
    metaPageAccessToken: '', metaInstagramAccessToken: '', metaPageId: '', metaInstagramAccountId: '',
    manebrainDraftModel: '', openaiApiKey: '',
  };
  const conversationRow = {
    id: '11111111-1111-4111-8111-111111111111',
    channel: 'instagram_dm', provider_account_id: 'ig-account', provider_conversation_id: 'thread-1',
    provider_sender_id: 'sender-1', state: 'OPEN', intent: 'PRICE_CHECK', intent_confidence: 0.91,
    labels: ['buyer-ready'], latest_message: '<script>not executable</script>',
    created_at: '2026-07-29T10:00:00.000Z', updated_at: '2026-07-29T10:01:00.000Z',
  };
  const databaseRuntime = {
    pool: { query: async () => ({ rows: [], rowCount: 0 }) },
    metaOutboundRepository: {},
    health: async () => ({ ok: true }),
    metaInboundRepository: {
      listConversations: async (ownerUserId) => ownerUserId === 'owner-user' ? [conversationRow] : [],
      getConversation: async (ownerUserId, id) => ownerUserId === 'owner-user' && id === conversationRow.id ? {
        conversation: conversationRow,
        messages: [{
          id: 'message-1', provider_message_id: 'provider-message-1', direction: 'inbound',
          body: 'Can you price this card?', received_at: '2026-07-29T10:00:00.000Z',
          attachment_manifest: [{
            id: 'attachment-1', type: 'image', mimeType: 'image/jpeg', storageStatus: 'private',
            privateObjectKey: 'owner/secret-object-key', remoteUrl: 'https://provider.example/tokenized-image?token=secret',
          }],
        }],
        drafts: [{
          id: 'draft-1', version: 1, body: 'Draft only', source: 'owner_manual', evidence: [], status: 'DRAFT',
          created_at: '2026-07-29T10:02:00.000Z',
        }],
      } : null,
    },
  };
  const router = createMetaOwnerRouter({ config, store, databaseRuntime });
  server = http.createServer(async (req, res) => {
    const handled = await router(req, res);
    if (!handled && !res.writableEnded) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('conversation queue and detail are readable only by the allowlisted MFA-verified owner', async () => {
  const list = await request('/api/owner/meta/conversations?limit=10', ownerToken);
  assert.equal(list.response.status, 200);
  assert.equal(list.body.conversations.length, 1);
  assert.equal(list.body.conversations[0].latestMessage, '<script>not executable</script>');

  const detail = await request('/api/owner/meta/conversations/11111111-1111-4111-8111-111111111111', ownerToken);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.messages.length, 1);
  assert.equal(detail.body.drafts.length, 1);
  const serialized = JSON.stringify(detail.body);
  assert.doesNotMatch(serialized, /tokenized-image|token=secret/);
  assert.doesNotMatch(serialized, /accessToken|pageAccessToken|instagramAccessToken/);

  const other = await request('/api/owner/meta/conversations', otherToken);
  assert.equal(other.response.status, 403);
  const anonymous = await request('/api/owner/meta/conversations', '');
  assert.equal(anonymous.response.status, 401);
});

test('owner conversation mutations require recent reauthentication before reading the request body', async () => {
  const draft = await request('/api/owner/meta/conversations/11111111-1111-4111-8111-111111111111/drafts', ownerToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'This must not be accepted without recent reauthentication.' }),
  });
  assert.equal(draft.response.status, 403);
});
