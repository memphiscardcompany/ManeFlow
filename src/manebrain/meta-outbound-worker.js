import {
  assertMetaDispatchLease,
  dispatchMetaBatch,
  metaDispatcherReadiness,
} from './meta-dispatcher.js';

function requiredOwner(config = {}, expectedOwnerUserId = null) {
  const ownerIds = Array.isArray(config.platformOwnerUserIds)
    ? config.platformOwnerUserIds.map(String)
    : [];
  if (ownerIds.length !== 1) {
    const error = new Error('MANEFLOW_PLATFORM_OWNER_USER_IDS must contain exactly one immutable owner UUID.');
    error.code = 'META_OWNER_CONFIGURATION_INVALID';
    throw error;
  }
  if (expectedOwnerUserId && ownerIds[0] !== String(expectedOwnerUserId)) {
    const error = new Error('The configured Meta owner changed while the worker was running; restart is required.');
    error.code = 'META_OWNER_CONFIGURATION_CHANGED';
    throw error;
  }
  return ownerIds[0];
}

export async function runMetaOutboundCycles({
  repository,
  configLoader,
  ownerUserId = null,
  continuous = false,
  dispatchBatch = dispatchMetaBatch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  shouldStop = () => false,
  onEvent = () => {},
} = {}) {
  if (!repository || typeof repository.claimNext !== 'function') {
    throw new TypeError('A Meta outbound repository is required.');
  }
  if (typeof configLoader !== 'function') {
    throw new TypeError('A configLoader function is required.');
  }

  let configuredOwner = ownerUserId ? String(ownerUserId) : null;
  let cycles = 0;
  while (!shouldStop()) {
    const config = await configLoader();
    const owner = requiredOwner(config, configuredOwner);
    configuredOwner ||= owner;
    const leasePolicy = assertMetaDispatchLease(config);

    if (
      Number.isFinite(Number(repository.leaseDurationMs))
      && Number(repository.leaseDurationMs) !== leasePolicy.leaseDurationMs
    ) {
      const error = new Error('Meta outbound lease configuration changed while the worker was running; restart is required.');
      error.code = 'META_OUTBOUND_LEASE_CHANGED';
      throw error;
    }

    if (config.metaKillSwitch !== false) {
      const event = {
        event: 'meta_dispatch_stopped',
        reason: 'KILL_SWITCHED',
        cycles,
      };
      onEvent(event);
      return event;
    }

    const readiness = metaDispatcherReadiness(config, repository);
    if (!readiness.ready) {
      const error = new Error(`Meta outbound worker is not ready: ${readiness.missing.join(', ')}`);
      error.code = 'META_DISPATCH_NOT_READY';
      error.missing = readiness.missing;
      throw error;
    }

    const result = await dispatchBatch({
      repository,
      config,
      ownerUserId: configuredOwner,
      limit: config.metaMaxDispatchBatch,
    });
    cycles += 1;
    onEvent({
      event: 'meta_dispatch_cycle',
      time: new Date().toISOString(),
      reconciledExpiredLeases: result.reconciledExpiredLeases,
      attempted: result.attempted,
      states: result.results.map((item) => item.state),
    });

    if (!continuous || shouldStop()) {
      return { event: 'meta_dispatch_stopped', reason: 'COMPLETE', cycles, result };
    }
    const idle = result.attempted === 0;
    await sleep(idle ? config.metaPollIntervalMs : 250);
  }

  return { event: 'meta_dispatch_stopped', reason: 'SIGNAL', cycles };
}
