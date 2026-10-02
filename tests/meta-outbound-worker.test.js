import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertMetaDispatchLease,
  metaDispatchLeasePolicy,
} from '../src/manebrain/meta-dispatcher.js';
import { runMetaOutboundCycles } from '../src/manebrain/meta-outbound-worker.js';

const ownerUserId = '11111111-1111-4111-8111-111111111111';

function config(overrides = {}) {
  return {
    platformOwnerUserIds: [ownerUserId],
    metaKillSwitch: false,
    metaOutboundEnabled: true,
    metaGraphApiVersion: 'v99.0',
    metaPageAccessToken: 'page-token',
    metaInstagramAccessToken: 'instagram-token',
    metaPageId: 'page-1',
    metaInstagramAccountId: 'instagram-1',
    metaOutboundChannels: ['messenger', 'instagram_dm'],
    metaRequestTimeoutMs: 15_000,
    metaOutboundLeaseMs: 30_000,
    metaOutboundLeaseMarginMs: 5_000,
    metaApprovalMaxAgeMs: 15 * 60_000,
    metaMaxDispatchBatch: 10,
    metaPollIntervalMs: 1_000,
    ...overrides,
  };
}

test('continuous worker re-reads kill switch before every dispatch cycle', async () => {
  const loaded = [
    config({ metaKillSwitch: false }),
    config({ metaKillSwitch: true }),
  ];
  let loadCount = 0;
  let dispatchCount = 0;
  let sleepCount = 0;
  const events = [];
  const repository = {
    leaseDurationMs: 30_000,
    async claimNext() { throw new Error('dispatchBatch stub owns repository access'); },
  };

  const result = await runMetaOutboundCycles({
    repository,
    ownerUserId,
    continuous: true,
    configLoader: async () => loaded[Math.min(loadCount++, loaded.length - 1)],
    dispatchBatch: async () => {
      dispatchCount += 1;
      return {
        reconciledExpiredLeases: 0,
        attempted: 0,
        results: [{ state: 'IDLE' }],
      };
    },
    sleep: async () => { sleepCount += 1; },
    onEvent: (event) => events.push(event),
  });

  assert.equal(loadCount, 2);
  assert.equal(dispatchCount, 1);
  assert.equal(sleepCount, 1);
  assert.equal(result.reason, 'KILL_SWITCHED');
  assert.equal(events.at(-1).reason, 'KILL_SWITCHED');
});

test('Meta worker refuses a lease that is not longer than timeout plus margin', () => {
  const shorterThanTimeout = config({
    metaRequestTimeoutMs: 15_000,
    metaOutboundLeaseMs: 10_000,
    metaOutboundLeaseMarginMs: 5_000,
  });
  assert.throws(() => assertMetaDispatchLease(shorterThanTimeout), {
    code: 'META_OUTBOUND_LEASE_TOO_SHORT',
  });

  const exactlyAtBoundary = config({
    metaRequestTimeoutMs: 15_000,
    metaOutboundLeaseMs: 20_000,
    metaOutboundLeaseMarginMs: 5_000,
  });
  assert.equal(metaDispatchLeasePolicy(exactlyAtBoundary).valid, false);
  assert.throws(() => assertMetaDispatchLease(exactlyAtBoundary), {
    code: 'META_OUTBOUND_LEASE_TOO_SHORT',
  });

  const safe = config({
    metaRequestTimeoutMs: 15_000,
    metaOutboundLeaseMs: 20_001,
    metaOutboundLeaseMarginMs: 5_000,
  });
  assert.equal(assertMetaDispatchLease(safe).valid, true);
});
