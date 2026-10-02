import { MetaGraphClient, MetaGraphDispatchError, metaGraphReadiness } from './meta-graph-client.js';
import { metaOperationMode } from './owner-authority.js';

export function metaDispatchLeasePolicy(config = {}) {
  const requestTimeoutMs = Math.max(1_000, Number(config.metaRequestTimeoutMs || 15_000));
  const safetyMarginMs = Math.max(1_000, Number(config.metaOutboundLeaseMarginMs || 5_000));
  const leaseDurationMs = Math.max(1_000, Number(config.metaOutboundLeaseMs || 30_000));
  return {
    requestTimeoutMs,
    safetyMarginMs,
    leaseDurationMs,
    minimumExclusiveMs: requestTimeoutMs + safetyMarginMs,
    valid: leaseDurationMs > requestTimeoutMs + safetyMarginMs,
  };
}

export function assertMetaDispatchLease(config = {}) {
  const policy = metaDispatchLeasePolicy(config);
  if (!policy.valid) {
    const error = new Error(
      `Meta outbound lease (${policy.leaseDurationMs}ms) must exceed request timeout + safety margin (${policy.minimumExclusiveMs}ms).`,
    );
    error.code = 'META_OUTBOUND_LEASE_TOO_SHORT';
    throw error;
  }
  return policy;
}

function sanitizeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    conversationId: job.conversation_id || job.conversationId || null,
    draftId: job.draft_id || job.draftId || null,
    channel: job.channel || null,
    status: job.status || null,
    attempts: Number(job.attempts || 0),
    maxAttempts: Number(job.max_attempts || job.maxAttempts || 0),
  };
}

export function metaDispatcherReadiness(config = {}, repository = null) {
  const missing = [...metaGraphReadiness(config).missing];
  if (!repository || typeof repository.claimNext !== 'function') missing.push('META_OUTBOUND_REPOSITORY');
  if (!Array.isArray(config.platformOwnerUserIds) || config.platformOwnerUserIds.length !== 1) {
    missing.push('MANEFLOW_PLATFORM_OWNER_USER_IDS_EXACTLY_ONE');
  }
  const mode = metaOperationMode(config);
  if (mode !== 'OWNER_APPROVAL_REQUIRED') missing.push(`META_OPERATION_MODE_${mode}`);
  const leasePolicy = metaDispatchLeasePolicy(config);
  if (!leasePolicy.valid) missing.push('META_OUTBOUND_LEASE_TOO_SHORT');
  return { ready: missing.length === 0, missing, mode, leasePolicy };
}

export async function reconcileMetaDispatchLeases({ repository, ownerUserId, limit = 100 }) {
  if (!repository || typeof repository.reconcileExpiredLeases !== 'function') return [];
  return repository.reconcileExpiredLeases(ownerUserId, { limit });
}

export async function dispatchNextMetaJob({
  repository,
  config,
  ownerUserId,
  graphClient = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const readiness = metaDispatcherReadiness(config, repository);
  if (!readiness.ready) {
    return { state: 'NOT_READY', mode: readiness.mode, missing: readiness.missing };
  }

  const client = graphClient || new MetaGraphClient(config, { fetchImpl });
  const job = await repository.claimNext(ownerUserId, {
    dispatchAllowed: true,
    activeOwnerUserIds: config.platformOwnerUserIds,
    approvalMaxAgeMs: config.metaApprovalMaxAgeMs || 900_000,
  });
  if (!job) return { state: 'IDLE', mode: readiness.mode };

  try {
    const result = await client.send(job);
    const completed = await repository.completeAccepted(ownerUserId, {
      jobId: job.id,
      leaseToken: job.lease_token || job.leaseToken,
      providerMessageId: result.providerMessageId,
      responseMetadata: result.responseMetadata,
    });
    return { state: 'SENT', job: sanitizeJob(completed), providerMessageId: result.providerMessageId };
  } catch (error) {
    const known = error instanceof MetaGraphDispatchError ? error : new MetaGraphDispatchError(
      'Unexpected Meta dispatch failure left the delivery outcome unknown.',
      { code: 'META_GRAPH_UNEXPECTED_FAILURE', certainty: 'outcome_unknown', cause: error },
    );
    if (known.certainty === 'rejected_before_acceptance') {
      const completed = await repository.completeRejectedBeforeAcceptance(ownerUserId, {
        jobId: job.id,
        leaseToken: job.lease_token || job.leaseToken,
        errorCode: known.code,
        responseMetadata: known.responseMetadata,
        retryable: known.retryable,
      });
      return {
        state: completed.status === 'RETRY_WAIT' ? 'RETRY_WAIT' : 'DEAD_LETTER',
        job: sanitizeJob(completed),
        error: known.code,
      };
    }
    const completed = await repository.completeOutcomeUnknown(ownerUserId, {
      jobId: job.id,
      leaseToken: job.lease_token || job.leaseToken,
      errorCode: known.code,
      responseMetadata: known.responseMetadata,
    });
    return { state: 'DELIVERY_UNKNOWN', job: sanitizeJob(completed), error: known.code };
  }
}

export async function dispatchMetaBatch({
  repository,
  config,
  ownerUserId,
  graphClient = null,
  fetchImpl = globalThis.fetch,
  limit = config?.metaMaxDispatchBatch || 10,
} = {}) {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit || 10)));
  const reconciled = await reconcileMetaDispatchLeases({ repository, ownerUserId, limit: boundedLimit });
  const results = [];
  for (let index = 0; index < boundedLimit; index += 1) {
    const result = await dispatchNextMetaJob({ repository, config, ownerUserId, graphClient, fetchImpl });
    results.push(result);
    if (['IDLE', 'NOT_READY'].includes(result.state)) break;
  }
  return {
    reconciledExpiredLeases: reconciled.length,
    attempted: results.filter((item) => !['IDLE', 'NOT_READY'].includes(item.state)).length,
    results,
  };
}
