import { MetaGraphClient } from './meta-graph-client.js';
import { loadMetaOutboundDispatchContext } from './meta-outbound-context.js';

export class MetaOutboundWorker {
  constructor({ repository, config = {}, graphClient = null, contextLoader = loadMetaOutboundDispatchContext } = {}) {
    if (!repository || typeof repository.claimNext !== 'function') {
      throw new TypeError('MetaOutboundWorker requires a MetaOutboundRepository-compatible repository.');
    }
    if (typeof contextLoader !== 'function') throw new TypeError('MetaOutboundWorker requires a context loader.');
    this.repository = repository;
    this.config = config;
    this.graphClient = graphClient || new MetaGraphClient(config);
    this.contextLoader = contextLoader;
  }

  dispatchAllowed() {
    return this.config.metaKillSwitch === false && this.config.metaOutboundEnabled === true;
  }

  async runOnce(ownerUserId) {
    if (!this.dispatchAllowed()) {
      return {
        status: 'DISABLED',
        reason: this.config.metaKillSwitch !== false ? 'META_KILL_SWITCHED' : 'META_OUTBOUND_DISABLED',
      };
    }

    const reconciled = await this.repository.reconcileExpiredLeases(ownerUserId, { limit: 100 });
    const claimed = await this.repository.claimNext(ownerUserId, { dispatchAllowed: true });
    if (!claimed) return { status: 'IDLE', reconciled: reconciled.length };

    let job = claimed;
    let result;
    try {
      job = await this.contextLoader(this.repository, ownerUserId, claimed);
      result = await this.graphClient.dispatchApprovedReply(job);
    } catch (error) {
      result = {
        outcome: 'rejected_before_acceptance',
        errorCode: String(error?.code || 'META_GRAPH_CONFIGURATION_ERROR').slice(0, 160),
        responseMetadata: { errorName: String(error?.name || 'Error').slice(0, 100) },
      };
    }

    if (result.outcome === 'accepted') {
      const completed = await this.repository.completeAccepted(ownerUserId, {
        jobId: claimed.id,
        leaseToken: claimed.lease_token,
        providerMessageId: result.providerMessageId,
        responseMetadata: result.responseMetadata,
      });
      return { status: 'SENT', jobId: claimed.id, providerMessageId: result.providerMessageId, completed };
    }
    if (result.outcome === 'outcome_unknown') {
      const completed = await this.repository.completeOutcomeUnknown(ownerUserId, {
        jobId: claimed.id,
        leaseToken: claimed.lease_token,
        errorCode: result.errorCode,
        responseMetadata: result.responseMetadata,
      });
      return { status: 'DELIVERY_UNKNOWN', jobId: claimed.id, completed };
    }
    const completed = await this.repository.completeRejectedBeforeAcceptance(ownerUserId, {
      jobId: claimed.id,
      leaseToken: claimed.lease_token,
      errorCode: result.errorCode,
      responseMetadata: result.responseMetadata,
    });
    return { status: completed.status, jobId: claimed.id, completed };
  }
}
