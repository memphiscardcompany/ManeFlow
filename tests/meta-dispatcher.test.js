import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchMetaBatch, dispatchNextMetaJob, metaDispatcherReadiness } from '../src/manebrain/meta-dispatcher.js';
import { MetaGraphDispatchError } from '../src/manebrain/meta-graph-client.js';

const ownerUserId = '11111111-1111-4111-8111-111111111111';
const job = {
  id: '22222222-2222-4222-8222-222222222222',
  conversation_id: '33333333-3333-4333-8333-333333333333',
  draft_id: '44444444-4444-4444-8444-444444444444',
  lease_token: '55555555-5555-4555-8555-555555555555',
  status: 'DISPATCHING',
  attempts: 1,
  max_attempts: 3,
  channel: 'messenger',
  approved_text: 'Approved owner reply.',
  provider_sender_id: 'customer-1',
  provider_account_id: 'page-1',
};

function config(overrides = {}) {
  return {
    platformOwnerUserIds: [ownerUserId],
    metaKillSwitch: false,
    metaOutboundEnabled: true,
    metaGraphApiVersion: 'v99.0',
    metaPageAccessToken: 'page-token',
    metaInstagramAccessToken: 'ig-token',
    metaPageId: 'page-1',
    metaInstagramAccountId: 'ig-1',
    metaOutboundChannels: ['messenger', 'instagram_dm'],
    metaMaxDispatchBatch: 10,
    ...overrides,
  };
}

function repository({ claimed = job, completionStatus = 'SENT' } = {}) {
  const calls = [];
  return {
    calls,
    async claimNext(owner, options) {
      calls.push(['claimNext', owner, options]);
      return claimed;
    },
    async completeAccepted(owner, input) {
      calls.push(['completeAccepted', owner, input]);
      return { ...job, status: 'SENT', provider_message_id: input.providerMessageId };
    },
    async completeRejectedBeforeAcceptance(owner, input) {
      calls.push(['completeRejectedBeforeAcceptance', owner, input]);
      return { ...job, status: input.retryable ? 'RETRY_WAIT' : 'DEAD_LETTER' };
    },
    async completeOutcomeUnknown(owner, input) {
      calls.push(['completeOutcomeUnknown', owner, input]);
      return { ...job, status: 'DELIVERY_UNKNOWN' };
    },
    async reconcileExpiredLeases(owner, input) {
      calls.push(['reconcileExpiredLeases', owner, input]);
      return completionStatus === 'RECONCILED' ? [{ id: 'expired' }] : [];
    },
  };
}

test('dispatcher remains fail-closed when kill switch or configuration is incomplete', async () => {
  const repo = repository();
  const readiness = metaDispatcherReadiness(config({ metaKillSwitch: true }), repo);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes('META_OPERATION_MODE_KILL_SWITCHED'));

  const result = await dispatchNextMetaJob({
    repository: repo,
    config: config({ metaKillSwitch: true }),
    ownerUserId,
    graphClient: { async send() { throw new Error('must not run'); } },
  });
  assert.equal(result.state, 'NOT_READY');
  assert.equal(repo.calls.length, 0);
});

test('accepted provider response is completed under the exact lease', async () => {
  const repo = repository();
  const result = await dispatchNextMetaJob({
    repository: repo,
    config: config(),
    ownerUserId,
    graphClient: {
      async send() {
        return { providerMessageId: 'mid.accepted', responseMetadata: { httpStatus: 200 } };
      },
    },
  });
  assert.equal(result.state, 'SENT');
  assert.equal(result.providerMessageId, 'mid.accepted');
  const completion = repo.calls.find(([name]) => name === 'completeAccepted');
  assert.equal(completion[2].jobId, job.id);
  assert.equal(completion[2].leaseToken, job.lease_token);
});

test('transient pre-acceptance rejection enters retry wait', async () => {
  const repo = repository();
  const result = await dispatchNextMetaJob({
    repository: repo,
    config: config(),
    ownerUserId,
    graphClient: {
      async send() {
        throw new MetaGraphDispatchError('rate limited', {
          code: 'META_GRAPH_RATE_LIMITED',
          certainty: 'rejected_before_acceptance',
          retryable: true,
          responseMetadata: { httpStatus: 429 },
        });
      },
    },
  });
  assert.equal(result.state, 'RETRY_WAIT');
  const completion = repo.calls.find(([name]) => name === 'completeRejectedBeforeAcceptance');
  assert.equal(completion[2].retryable, true);
});

test('permanent provider rejection goes directly to dead letter', async () => {
  const repo = repository();
  const result = await dispatchNextMetaJob({
    repository: repo,
    config: config(),
    ownerUserId,
    graphClient: {
      async send() {
        throw new MetaGraphDispatchError('permission denied', {
          code: 'META_GRAPH_REJECTED',
          certainty: 'rejected_before_acceptance',
          retryable: false,
          responseMetadata: { httpStatus: 400 },
        });
      },
    },
  });
  assert.equal(result.state, 'DEAD_LETTER');
  const completion = repo.calls.find(([name]) => name === 'completeRejectedBeforeAcceptance');
  assert.equal(completion[2].retryable, false);
});

test('ambiguous delivery is terminal and never blindly retried', async () => {
  const repo = repository();
  const result = await dispatchNextMetaJob({
    repository: repo,
    config: config(),
    ownerUserId,
    graphClient: {
      async send() {
        throw new MetaGraphDispatchError('timeout', {
          code: 'META_GRAPH_TIMEOUT',
          certainty: 'outcome_unknown',
        });
      },
    },
  });
  assert.equal(result.state, 'DELIVERY_UNKNOWN');
  assert.equal(repo.calls.some(([name]) => name === 'completeRejectedBeforeAcceptance'), false);
  assert.equal(repo.calls.some(([name]) => name === 'completeOutcomeUnknown'), true);
});

test('ambiguous Meta HTTP response routes to terminal reconciliation instead of retry', async () => {
  const repo = repository();
  const result = await dispatchNextMetaJob({
    repository: repo,
    config: config(),
    ownerUserId,
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      async text() {
        return JSON.stringify({ error: { code: 2, is_transient: true, fbtrace_id: 'trace-ambiguous' } });
      },
    }),
  });

  assert.equal(result.state, 'DELIVERY_UNKNOWN');
  assert.equal(result.error, 'META_GRAPH_OUTCOME_UNKNOWN');
  assert.equal(repo.calls.some(([name]) => name === 'completeRejectedBeforeAcceptance'), false);
  const completion = repo.calls.find(([name]) => name === 'completeOutcomeUnknown');
  assert.ok(completion);
  assert.equal(completion[2].jobId, job.id);
  assert.equal(completion[2].responseMetadata.httpStatus, 503);
});

test('batch reconciles stale leases before claiming new work and stops on idle', async () => {
  const repo = repository({ claimed: null, completionStatus: 'RECONCILED' });
  const result = await dispatchMetaBatch({
    repository: repo,
    config: config(),
    ownerUserId,
    graphClient: { async send() { throw new Error('must not run'); } },
    limit: 5,
  });
  assert.equal(result.reconciledExpiredLeases, 1);
  assert.equal(result.attempted, 0);
  assert.deepEqual(result.results.map((item) => item.state), ['IDLE']);
  assert.equal(repo.calls[0][0], 'reconcileExpiredLeases');
});
