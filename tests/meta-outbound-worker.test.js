import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaOutboundWorker } from '../src/manebrain/meta-outbound-worker.js';
import { MetaGraphClientError } from '../src/manebrain/meta-graph-client.js';
import { hashApprovedText } from '../src/manebrain/outbound-policy.js';

const ownerUserId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const leaseToken = '33333333-3333-4333-8333-333333333333';

function envelope(text = 'Approved response') {
  return {
    jobId,
    conversationId: '44444444-4444-4444-8444-444444444444',
    approvedText: text,
    approvedTextSha256: hashApprovedText(text),
    channel: 'messenger',
    providerAccountId: 'page-1',
    providerSenderId: 'psid-1',
  };
}

function repository({ job = { id: jobId, lease_token: leaseToken } } = {}) {
  const calls = [];
  return {
    calls,
    async reconcileExpiredLeases(owner, options) { calls.push(['reconcile', owner, options]); return []; },
    async claimNext(owner, options) { calls.push(['claim', owner, options]); return job; },
    async completeAccepted(owner, input) { calls.push(['accepted', owner, input]); return { status: 'SENT' }; },
    async completeRejectedBeforeAcceptance(owner, input) { calls.push(['rejected', owner, input]); return { status: 'RETRY_WAIT' }; },
    async completeOutcomeUnknown(owner, input) { calls.push(['unknown', owner, input]); return { status: 'DELIVERY_UNKNOWN' }; },
  };
}

test('worker refuses to run when outbound dispatch is not explicitly enabled', async () => {
  const repo = repository();
  const worker = new MetaOutboundWorker({
    ownerUserId,
    repository: repo,
    graphClient: { async sendText() { throw new Error('should not run'); } },
    loadEnvelope: async () => envelope(),
    dispatchAllowed: false,
  });
  await assert.rejects(worker.runOnce(), { code: 'META_DISPATCH_DISABLED' });
  assert.equal(repo.calls.length, 0);
});

test('worker returns idle without provider access when no job is available', async () => {
  const repo = repository({ job: null });
  let providerCalled = false;
  const worker = new MetaOutboundWorker({
    ownerUserId,
    repository: repo,
    graphClient: { async sendText() { providerCalled = true; } },
    loadEnvelope: async () => envelope(),
    dispatchAllowed: true,
  });
  const result = await worker.runOnce();
  assert.deepEqual(result, { claimed: false, expiredLeases: 0 });
  assert.equal(providerCalled, false);
});

test('worker sends only the digest-bound approved text and records provider acceptance', async () => {
  const repo = repository();
  let sent;
  const worker = new MetaOutboundWorker({
    ownerUserId,
    repository: repo,
    graphClient: {
      async sendText(input) {
        sent = input;
        return { providerMessageId: 'mid.1', recipientId: 'psid-1', metadata: { httpStatus: 200 } };
      },
    },
    loadEnvelope: async () => envelope(),
    dispatchAllowed: true,
    logger: { info() {}, warn() {}, error() {} },
  });
  const result = await worker.runOnce();
  assert.equal(result.status, 'SENT');
  assert.deepEqual(sent, {
    channel: 'messenger',
    accountId: 'page-1',
    recipientId: 'psid-1',
    text: 'Approved response',
  });
  const accepted = repo.calls.find((call) => call[0] === 'accepted');
  assert.equal(accepted[2].providerMessageId, 'mid.1');
  assert.equal(accepted[2].leaseToken, leaseToken);
});

test('provider rejection can enter retry wait, while ambiguous outcomes are terminal', async () => {
  const rejectedRepo = repository();
  const rejectedWorker = new MetaOutboundWorker({
    ownerUserId,
    repository: rejectedRepo,
    graphClient: {
      async sendText() {
        throw new MetaGraphClientError('Rate limited', {
          code: 'META_GRAPH_REJECTED',
          outcome: 'rejected_before_acceptance',
          retryable: true,
          metadata: { httpStatus: 429 },
        });
      },
    },
    loadEnvelope: async () => envelope(),
    dispatchAllowed: true,
    logger: { info() {}, warn() {}, error() {} },
  });
  const rejected = await rejectedWorker.runOnce();
  assert.equal(rejected.status, 'RETRY_WAIT');
  assert.ok(rejectedRepo.calls.some((call) => call[0] === 'rejected'));
  assert.ok(!rejectedRepo.calls.some((call) => call[0] === 'unknown'));

  const unknownRepo = repository();
  const unknownWorker = new MetaOutboundWorker({
    ownerUserId,
    repository: unknownRepo,
    graphClient: {
      async sendText() {
        throw new MetaGraphClientError('Socket closed', {
          code: 'META_GRAPH_NETWORK_ERROR',
          outcome: 'outcome_unknown',
        });
      },
    },
    loadEnvelope: async () => envelope(),
    dispatchAllowed: true,
    logger: { info() {}, warn() {}, error() {} },
  });
  const unknown = await unknownWorker.runOnce();
  assert.equal(unknown.status, 'DELIVERY_UNKNOWN');
  assert.ok(unknownRepo.calls.some((call) => call[0] === 'unknown'));
  assert.ok(!unknownRepo.calls.some((call) => call[0] === 'rejected'));
});

test('changed approved text is rejected before any provider call', async () => {
  const repo = repository();
  let providerCalled = false;
  const altered = envelope('Changed after approval');
  altered.approvedTextSha256 = hashApprovedText('Original approval');
  const worker = new MetaOutboundWorker({
    ownerUserId,
    repository: repo,
    graphClient: { async sendText() { providerCalled = true; } },
    loadEnvelope: async () => altered,
    dispatchAllowed: true,
    logger: { info() {}, warn() {}, error() {} },
  });
  const result = await worker.runOnce();
  assert.equal(result.status, 'RETRY_WAIT');
  assert.equal(result.errorCode, 'META_APPROVED_CONTENT_CHANGED');
  assert.equal(providerCalled, false);
});
