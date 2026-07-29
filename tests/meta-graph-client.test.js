import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaGraphClient, MetaGraphDispatchError, metaGraphReadiness } from '../src/manebrain/meta-graph-client.js';

function config(overrides = {}) {
  return {
    metaGraphApiVersion: 'v99.0',
    metaFacebookGraphBaseUrl: 'https://graph.facebook.test',
    metaInstagramGraphBaseUrl: 'https://graph.instagram.test',
    metaPageId: 'page-123',
    metaInstagramAccountId: 'ig-456',
    metaPageAccessToken: 'page-secret-token',
    metaInstagramAccessToken: 'instagram-secret-token',
    metaOutboundChannels: ['messenger', 'instagram_dm'],
    metaRequestTimeoutMs: 1_000,
    ...overrides,
  };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

function baseJob(overrides = {}) {
  return {
    approved_text: 'Thanks for reaching out. I will verify the card details before providing a value.',
    provider_sender_id: 'customer-1',
    provider_account_id: 'page-123',
    target_provider_message_id: 'comment-1',
    channel: 'messenger',
    ...overrides,
  };
}

test('Meta Graph readiness reports secret and channel names without exposing values', () => {
  assert.deepEqual(metaGraphReadiness(config()), { ready: true, missing: [] });
  const result = metaGraphReadiness(config({
    metaPageAccessToken: '',
    metaInstagramAccessToken: '',
    metaOutboundChannels: [],
  }));
  assert.equal(result.ready, false);
  assert.deepEqual(result.missing, [
    'META_PAGE_ACCESS_TOKEN',
    'META_INSTAGRAM_ACCESS_TOKEN',
    'MANEBRAIN_META_OUTBOUND_CHANNELS',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test('Messenger dispatch uses the allowlisted Page and RESPONSE message contract', async () => {
  let observed;
  const client = new MetaGraphClient(config(), {
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return response(200, { recipient_id: 'customer-1', message_id: 'mid.1' });
    },
  });
  const result = await client.send(baseJob());
  assert.equal(result.providerMessageId, 'mid.1');
  assert.equal(observed.url, 'https://graph.facebook.test/v99.0/page-123/messages');
  assert.equal(observed.options.headers.authorization, 'Bearer page-secret-token');
  assert.deepEqual(JSON.parse(observed.options.body), {
    recipient: { id: 'customer-1' },
    messaging_type: 'RESPONSE',
    message: { text: baseJob().approved_text },
  });
});

test('Instagram direct messages use the Instagram account and token', async () => {
  let observed;
  const client = new MetaGraphClient(config(), {
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return response(200, { message_id: 'ig.mid.1' });
    },
  });
  await client.send(baseJob({ channel: 'instagram_dm', provider_account_id: 'ig-456' }));
  assert.equal(observed.url, 'https://graph.instagram.test/v99.0/ig-456/messages');
  assert.equal(observed.options.headers.authorization, 'Bearer instagram-secret-token');
  assert.deepEqual(JSON.parse(observed.options.body), {
    recipient: { id: 'customer-1' },
    message: { text: baseJob().approved_text },
  });
});

test('comment replies are blocked until their exact channels are explicitly activated', async () => {
  let called = false;
  const client = new MetaGraphClient(config(), {
    fetchImpl: async () => { called = true; return response(200, { id: 'unexpected' }); },
  });
  await assert.rejects(client.send(baseJob({ channel: 'facebook_comment' })), (error) => {
    assert.ok(error instanceof MetaGraphDispatchError);
    assert.equal(error.code, 'META_OUTBOUND_CHANNEL_DISABLED');
    assert.equal(error.certainty, 'rejected_before_acceptance');
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(called, false);
});

test('explicitly reviewed Facebook and Instagram comment channels target the exact inbound comment', async () => {
  const urls = [];
  const client = new MetaGraphClient(config({
    metaOutboundChannels: ['messenger', 'instagram_dm', 'facebook_comment', 'instagram_comment'],
  }), {
    fetchImpl: async (url) => {
      urls.push(url);
      return response(200, { id: `reply-${urls.length}` });
    },
  });
  await client.send(baseJob({ channel: 'facebook_comment' }));
  await client.send(baseJob({ channel: 'instagram_comment', provider_account_id: 'ig-456' }));
  assert.deepEqual(urls, [
    'https://graph.facebook.test/v99.0/comment-1/comments',
    'https://graph.instagram.test/v99.0/comment-1/replies',
  ]);
});

test('HTTP rate limits are definite pre-acceptance rejections and may retry', async () => {
  const client = new MetaGraphClient(config(), {
    fetchImpl: async () => response(429, { error: { code: 4, error_subcode: 99, is_transient: true, fbtrace_id: 'trace-1' } }),
  });
  await assert.rejects(client.send(baseJob()), (error) => {
    assert.ok(error instanceof MetaGraphDispatchError);
    assert.equal(error.code, 'META_GRAPH_REJECTED');
    assert.equal(error.certainty, 'rejected_before_acceptance');
    assert.equal(error.retryable, true);
    assert.deepEqual(error.responseMetadata, {
      channel: 'messenger',
      httpStatus: 429,
      providerCode: 4,
      providerSubcode: 99,
      providerType: null,
      providerTraceId: 'trace-1',
      providerTransient: true,
    });
    assert.doesNotMatch(JSON.stringify(error.responseMetadata), /secret-token/);
    return true;
  });
});

test('permanent HTTP rejection is not retried automatically', async () => {
  const client = new MetaGraphClient(config(), {
    fetchImpl: async () => response(400, { error: { code: 100, type: 'OAuthException' } }),
  });
  await assert.rejects(client.send(baseJob()), (error) => {
    assert.equal(error.certainty, 'rejected_before_acceptance');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('network ambiguity and 2xx without message ID become outcome unknown', async () => {
  const networkClient = new MetaGraphClient(config(), {
    fetchImpl: async () => { throw new Error('socket reset'); },
  });
  await assert.rejects(networkClient.send(baseJob()), (error) => {
    assert.equal(error.certainty, 'outcome_unknown');
    assert.equal(error.retryable, false);
    return true;
  });

  const ambiguousClient = new MetaGraphClient(config(), {
    fetchImpl: async () => response(200, { recipient_id: 'customer-1' }),
  });
  await assert.rejects(ambiguousClient.send(baseJob()), (error) => {
    assert.equal(error.code, 'META_GRAPH_ACCEPTANCE_UNCONFIRMED');
    assert.equal(error.certainty, 'outcome_unknown');
    return true;
  });
});

test('account allowlist mismatch fails before any provider request with a definite local rejection', async () => {
  let called = false;
  const client = new MetaGraphClient(config(), {
    fetchImpl: async () => { called = true; return response(200, { message_id: 'unexpected' }); },
  });
  await assert.rejects(client.send(baseJob({ provider_account_id: 'wrong-page' })), (error) => {
    assert.ok(error instanceof MetaGraphDispatchError);
    assert.equal(error.code, 'META_GRAPH_PREFLIGHT_REJECTED');
    assert.equal(error.certainty, 'rejected_before_acceptance');
    assert.equal(error.retryable, false);
    assert.match(error.cause?.message || '', /allowlist/);
    return true;
  });
  assert.equal(called, false);
});
