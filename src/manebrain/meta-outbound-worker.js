import { hashApprovedText } from './outbound-policy.js';
import { MetaGraphClientError } from './meta-graph-client.js';

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('Aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Aborted'));
    }, { once: true });
  });
}

function safeErrorMetadata(error) {
  return {
    code: String(error?.code || 'META_WORKER_ERROR').slice(0, 160),
    outcome: String(error?.outcome || 'outcome_unknown').slice(0, 80),
    retryable: error?.retryable === true,
    provider: error?.metadata && typeof error.metadata === 'object'
      ? structuredClone(error.metadata)
      : {},
  };
}

export class MetaOutboundWorker {
  constructor({
    ownerUserId,
    repository,
    graphClient,
    loadEnvelope,
    dispatchAllowed = false,
    pollIntervalMs = 1_000,
    logger = console,
  } = {}) {
    if (!ownerUserId) throw new TypeError('ownerUserId is required.');
    if (!repository || typeof repository.claimNext !== 'function') {
      throw new TypeError('A durable Meta outbound repository is required.');
    }
    if (!graphClient || typeof graphClient.sendText !== 'function') {
      throw new TypeError('A Meta Graph client is required.');
    }
    if (typeof loadEnvelope !== 'function') throw new TypeError('loadEnvelope is required.');
    this.ownerUserId = String(ownerUserId);
    this.repository = repository;
    this.graphClient = graphClient;
    this.loadEnvelope = loadEnvelope;
    this.dispatchAllowed = dispatchAllowed === true;
    this.pollIntervalMs = Math.max(100, Math.min(60_000, Number(pollIntervalMs || 1_000)));
    this.logger = logger;
  }

  async runOnce() {
    if (!this.dispatchAllowed) {
      const error = new Error('Meta outbound worker is disabled by policy.');
      error.code = 'META_DISPATCH_DISABLED';
      throw error;
    }

    const expired = await this.repository.reconcileExpiredLeases(this.ownerUserId, { limit: 100 });
    if (expired.length) {
      this.logger.warn?.('Meta worker reconciled expired leases.', { count: expired.length });
    }

    const job = await this.repository.claimNext(this.ownerUserId, { dispatchAllowed: true });
    if (!job) return { claimed: false, expiredLeases: expired.length };

    const jobId = job.id;
    const leaseToken = job.lease_token;
    let envelope;
    try {
      envelope = await this.loadEnvelope({ jobId, leaseToken });
      if (!envelope) {
        const error = new Error('The claimed Meta job no longer has a valid dispatch envelope.');
        error.code = 'META_DISPATCH_ENVELOPE_MISSING';
        error.outcome = 'outcome_unknown';
        throw error;
      }
      const currentHash = hashApprovedText(envelope.approvedText);
      if (currentHash !== envelope.approvedTextSha256) {
        const error = new Error('Approved Meta text no longer matches its immutable digest.');
        error.code = 'META_APPROVED_CONTENT_CHANGED';
        error.outcome = 'rejected_before_acceptance';
        error.retryable = false;
        throw error;
      }

      const accepted = await this.graphClient.sendText({
        channel: envelope.channel,
        accountId: envelope.providerAccountId,
        recipientId: envelope.providerSenderId,
        text: envelope.approvedText,
      });
      const completed = await this.repository.completeAccepted(this.ownerUserId, {
        jobId,
        leaseToken,
        providerMessageId: accepted.providerMessageId,
        responseMetadata: {
          ...accepted.metadata,
          channel: envelope.channel,
          recipientId: accepted.recipientId,
        },
      });
      this.logger.info?.('Meta owner-approved message accepted by provider.', {
        jobId,
        channel: envelope.channel,
        providerMessageId: accepted.providerMessageId,
      });
      return {
        claimed: true,
        status: completed.status,
        jobId,
        providerMessageId: accepted.providerMessageId,
      };
    } catch (error) {
      const known = error instanceof MetaGraphClientError || error?.outcome;
      const outcome = known ? error.outcome : 'outcome_unknown';
      const code = String(error?.code || 'META_WORKER_UNEXPECTED_ERROR').slice(0, 160);
      const metadata = safeErrorMetadata(error);
      if (outcome === 'rejected_before_acceptance') {
        const completed = await this.repository.completeRejectedBeforeAcceptance(this.ownerUserId, {
          jobId,
          leaseToken,
          errorCode: code,
          responseMetadata: metadata,
        });
        this.logger.warn?.('Meta provider rejected an owner-approved message before acceptance.', {
          jobId,
          status: completed.status,
          code,
          retryable: error?.retryable === true,
        });
        return { claimed: true, status: completed.status, jobId, errorCode: code };
      }
      const completed = await this.repository.completeOutcomeUnknown(this.ownerUserId, {
        jobId,
        leaseToken,
        errorCode: code,
        responseMetadata: metadata,
      });
      this.logger.error?.('Meta message outcome is ambiguous; automatic retry is blocked.', {
        jobId,
        status: completed.status,
        code,
      });
      return { claimed: true, status: completed.status, jobId, errorCode: code };
    }
  }

  async run({ signal } = {}) {
    while (!signal?.aborted) {
      const result = await this.runOnce();
      if (!result.claimed) await delay(this.pollIntervalMs, signal);
    }
  }
}
