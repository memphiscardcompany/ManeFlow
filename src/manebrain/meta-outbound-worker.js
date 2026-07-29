import { MetaGraphClient } from './meta-graph-client.js';

export class MetaOutboundWorker {
  constructor({ repository, config = {}, graphClient = null } = {}) {
    if (!repository || typeof repository.claimNext !== 'function') {
      throw new TypeError('MetaOutboundWorker requires a MetaOutboundRepository-compatible repository.');
    }
    this.repository = repository;
    this.config = config;
    this.graphClient = graphClient || new MetaGraphClient(config);
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
    const job = await this.repository.claimNext(ownerUserId, { dispatchAllowed: true });
    if (!job) return { status: 'IDLE', reconciled: reconciled.length };

    let result;
    try {
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
        jobId: job.id,
        leaseToken: job.lease_token,
        providerMessageId: result.providerMessageId,
        responseMetadata: result.responseMetadata,
      });
      return { status: 'SENT', jobId: job.id, providerMessageId: result.providerMessageId, completed };
    }
    if (result.outcome === 'outcome_unknown') {
      const completed = await this.repository.completeOutcomeUnknown(ownerUserId, {
        jobId: job.id,
        leaseToken: job.lease_token,
        errorCode: result.errorCode,
        responseMetadata: result.responseMetadata,
      });
      return { status: 'DELIVERY_UNKNOWN', jobId: job.id, completed };
    }
    const completed = await this.repository.completeRejectedBeforeAcceptance(ownerUserId, {
      jobId: job.id,
      leaseToken: job.lease_token,
      errorCode: result.errorCode,
      responseMetadata: result.responseMetadata,
    });
    return { status: completed.status, jobId: job.id, completed };
  }
}
