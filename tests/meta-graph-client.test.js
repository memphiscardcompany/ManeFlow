import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaGraphClient, MetaGraphClientError } from '../src/manebrain/meta-graph-client.js';

function clientWith(fetchImpl) {
  return new MetaGraphClient({
    pageAccessToken: 'page-secret-token',
    instagramAccessToken: 'instagram-secret-token',
    graphApiVersion: 'v25.0',
    fetchImpl,
  });
}

test('Messenger send uses the Page endpoint and RESPONSE payload', async () => {
  let captured;
  const client = clientWith(async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ recipient_id: 'psid-1', message_id: 'mid.1' }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-fb-request-id': 'request-1' },
    });
  });
  const result = await client.sendText({
    channel: 'messenger',
    accountId: 'page-1',
    recipientId: 'psid-1',
    text: 'Approved response',
  });
  assert.equal(captured.url, 'https://graph.facebook.com/v25.0/page-1/messages');
  assert.equal(captured.options.headers.authorization, 'Bearer page-secret-token');
  assert.deepEqual(JSON.parse(captured.options.body), {
    recipient: { id: 'psid-1' },
    message: { text: 'Approved response' },
    message_type: 'RESPONSE',
  });
  assert.equal(result.providerMessageId, 'mid.1');
  assert.equal(result.metadata.requestId, 'request-1');
});

test('Instagram send uses the Instagram Graph endpoint and token', async () => {
  let captured;
  const client = clientWith(async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ recipient_id: 'igsid-1', message_id: 'ig.mid.1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const result = await client.sendText({
    channel: 'instagram_dm',
    accountId: 'ig-account-1',
    recipientId: 'igsid-1',
    text: 'Approved Instagram response',
  });
  assert.equal(captured.url, 'https://graph.instagram.com/v25.0/ig-account-1/messages');
  assert.equal(captured.options.headers.authorization, 'Bearer instagram-secret-token');
  assert.deepEqual(JSON.parse(captured.options.body), {
    recipient: { id: 'igsid-1' },
    message: { text: 'Approved Instagram response' },
  });
  assert.equal(result.providerMessageId, 'ig.mid.1');
});

test('known client rejection is classified before acceptance and can be retried only when rate limited', async () => {
  const client = clientWith(async () => new Response(JSON.stringify({
    error: { message: 'Rate limit', type: 'OAuthException', code: 4, error_subcode: 2446079 },
  }), { status: 429, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(
    client.sendText({ channel: 'messenger', accountId: 'page-1', recipientId: 'psid-1', text: 'Approved' }),
    (error) => {
      assert.ok(error instanceof MetaGraphClientError);
      assert.equal(error.outcome, 'rejected_before_acceptance');
      assert.equal(error.retryable, true);
      assert.equal(error.metadata.providerErrorCode, 4);
      assert.doesNotMatch(JSON.stringify(error.metadata), /secret-token/);
      return true;
    },
  );
});

test('provider server failure, network failure, and success without message id are outcome-unknown', async () => {
  const serverFailure = clientWith(async () => new Response('{}', { status: 503 }));
  await assert.rejects(
    serverFailure.sendText({ channel: 'messenger', accountId: 'page-1', recipientId: 'psid-1', text: 'Approved' }),
    { outcome: 'outcome_unknown', retryable: false },
  );

  const networkFailure = clientWith(async () => { throw new Error('socket closed'); });
  await assert.rejects(
    networkFailure.sendText({ channel: 'messenger', accountId: 'page-1', recipientId: 'psid-1', text: 'Approved' }),
    { code: 'META_GRAPH_NETWORK_ERROR', outcome: 'outcome_unknown' },
  );

  const missingMessageId = clientWith(async () => new Response(JSON.stringify({ recipient_id: 'psid-1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  await assert.rejects(
    missingMessageId.sendText({ channel: 'messenger', accountId: 'page-1', recipientId: 'psid-1', text: 'Approved' }),
    { code: 'META_GRAPH_ACCEPTANCE_UNCONFIRMED', outcome: 'outcome_unknown' },
  );
});

test('comments and unsupported channels fail before any provider request', async () => {
  let called = false;
  const client = clientWith(async () => { called = true; return new Response('{}'); });
  await assert.rejects(
    client.sendText({ channel: 'facebook_comment', accountId: 'page-1', recipientId: 'person-1', text: 'Approved' }),
    { code: 'META_CHANNEL_UNSUPPORTED_FOR_SEND', outcome: 'rejected_before_acceptance' },
  );
  assert.equal(called, false);
});
