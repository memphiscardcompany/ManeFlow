import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeEbayOAuthState, issueEbayOAuthState } from '../src/services/ebay-oauth-state.js';

const secret = '0123456789abcdef0123456789abcdef0123456789abcdef';

test('eBay OAuth state is signed, actor-bound, expiring, and single-use', () => {
  const storeState = {};
  const issued = issueEbayOAuthState({ storeState, secret, actorId: 'owner', now: 1_000_000, ttlMs: 60_000 });
  const payload = consumeEbayOAuthState({ storeState, secret, actorId: 'owner', state: issued.state, now: 1_010_000 });
  assert.equal(payload.actorId, 'owner');
  assert.throws(
    () => consumeEbayOAuthState({ storeState, secret, actorId: 'owner', state: issued.state, now: 1_020_000 }),
    /already been used/,
  );
});

test('eBay OAuth state rejects tampering, actor mismatch, and expiry', () => {
  const stateA = {};
  const issuedA = issueEbayOAuthState({ storeState: stateA, secret, actorId: 'owner', now: 1_000, ttlMs: 60_000 });
  assert.throws(() => consumeEbayOAuthState({ storeState: stateA, secret, actorId: 'other', state: issuedA.state, now: 2_000 }), /does not belong/);
  assert.throws(() => consumeEbayOAuthState({ storeState: stateA, secret, actorId: 'owner', state: `${issuedA.state}x`, now: 2_000 }), /signature/);

  const stateB = {};
  const issuedB = issueEbayOAuthState({ storeState: stateB, secret, actorId: 'owner', now: 1_000, ttlMs: 60_000 });
  assert.throws(() => consumeEbayOAuthState({ storeState: stateB, secret, actorId: 'owner', state: issuedB.state, now: 70_001 }), /expired/);
});
