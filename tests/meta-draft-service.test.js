import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMetaReplyDraft, MetaDraftGenerationError, metaDraftReadiness } from '../src/manebrain/meta-draft-service.js';

function config(overrides = {}) {
  return {
    openaiApiKey: 'openai-test-secret',
    openaiApiBaseUrl: 'https://api.openai.test/v1',
    manebrainDraftModel: 'test-draft-model',
    manebrainDraftTimeoutMs: 1_000,
    ...overrides,
  };
}

function conversation() {
  return {
    messages: [
      { direction: 'inbound', body: 'Can you identify and price this card?' },
      { direction: 'outbound', body: 'I can review it after the image is processed.' },
    ],
  };
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

test('draft readiness identifies missing provider settings without secret values', () => {
  assert.deepEqual(metaDraftReadiness(config()), { ready: true, missing: [] });
  const result = metaDraftReadiness(config({ openaiApiKey: '', manebrainDraftModel: '' }));
  assert.deepEqual(result.missing, ['OPENAI_API_KEY', 'MANEBRAIN_DRAFT_MODEL']);
  assert.doesNotMatch(JSON.stringify(result), /openai-test-secret/);
});

test('AI draft uses Responses API with store disabled and returns draft-only text', async () => {
  let observed;
  const result = await generateMetaReplyDraft({
    config: config(),
    conversation: conversation(),
    additionalEvidence: [{ type: 'identity', status: 'unresolved' }],
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return response(200, {
        id: 'resp_1',
        model: 'test-draft-model',
        output: [{ content: [{ type: 'output_text', text: 'Thanks for sending it. The exact card and value still need verification.' }] }],
      });
    },
  });
  assert.equal(observed.url, 'https://api.openai.test/v1/responses');
  assert.equal(observed.options.headers.authorization, 'Bearer openai-test-secret');
  const body = JSON.parse(observed.options.body);
  assert.equal(body.store, false);
  assert.equal(body.model, 'test-draft-model');
  assert.match(JSON.stringify(body.input), /human owner must review and approve/i);
  assert.match(JSON.stringify(body.input), /unresolved/);
  assert.equal(result.body, 'Thanks for sending it. The exact card and value still need verification.');
  assert.equal(result.source, 'openai_responses_api');
});

test('provider rejection and empty output fail closed', async () => {
  await assert.rejects(generateMetaReplyDraft({
    config: config(),
    conversation: conversation(),
    fetchImpl: async () => response(429, { error: { code: 'rate_limit' } }),
  }), (error) => {
    assert.ok(error instanceof MetaDraftGenerationError);
    assert.equal(error.code, 'META_DRAFT_PROVIDER_REJECTED');
    assert.equal(error.status, 429);
    return true;
  });

  await assert.rejects(generateMetaReplyDraft({
    config: config(),
    conversation: conversation(),
    fetchImpl: async () => response(200, { id: 'resp_empty', output: [] }),
  }), { code: 'META_DRAFT_EMPTY_RESPONSE' });
});

test('missing conversation content and network failure do not fabricate a draft', async () => {
  await assert.rejects(generateMetaReplyDraft({
    config: config(),
    conversation: { messages: [] },
    fetchImpl: async () => response(200, {}),
  }), /conversation transcript is required/);

  await assert.rejects(generateMetaReplyDraft({
    config: config(),
    conversation: conversation(),
    fetchImpl: async () => { throw new Error('offline'); },
  }), { code: 'META_DRAFT_NETWORK_FAILURE' });
});
