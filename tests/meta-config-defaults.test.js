import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';
import { metaDispatcherReadiness } from '../src/manebrain/meta-dispatcher.js';

test('Meta outbound defaults remain kill-switched and disabled', () => {
  const config = loadConfig({ NODE_ENV: 'test' });
  assert.equal(config.metaKillSwitch, true);
  assert.equal(config.metaOutboundEnabled, false);
  assert.equal(config.metaIntakeEnabled, false);

  const readiness = metaDispatcherReadiness(config, {
    async claimNext() {},
  });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes('META_OPERATION_MODE_KILL_SWITCHED'));
});
