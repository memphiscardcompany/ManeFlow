import crypto from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MetaOutboundRepositoryError extends Error {
  constructor(message, { cause, code = 'META_OUTBOUND_REPOSITORY_ERROR', details = {} } = {}) {
    super(message, { cause });
    this.name = 'MetaOutboundRepositoryError';
    this.code = code;
    this.details = details;
  }
}

function uuid(value, name) {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`${name} must be a UUID.`);
  return normalized;
}

function requiredString(value, name, max = 500) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (normalized.length > max) throw new TypeError(`${name} exceeds ${max} characters.`);
  return normalized;
}

function positiveInteger(value, name, maximum) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new TypeError(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return normalized;
}

function metadata(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('responseMetadata must be an object.');
  return structuredClone(value);
}

export class MetaOutboundRepository {
  constructor(pool, { leaseDurationMs = 30_000, retryDelayMs = 15_000 } = {}) {
    if (!pool || typeof pool.connect !== 'function') {
      throw new TypeError('MetaOutboundRepository requires a pg.Pool-compatible instance.');
    }
    this.pool = pool;
    this.leaseDurationMs = positiveInteger(leaseDurationMs, 'leaseDurationMs', 600_000);
    this.retryDelayMs = positiveInteger(retryDelayMs, 'retryDelayMs', 3_600_000);
  }

  async withOwnerTransaction(ownerUserId, operation) {
    const ownerId = uuid(ownerUserId, 'ownerUserId');
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query(`SELECT set_config('app.platform_owner_user_id', $1, true)`, [ownerId]);
      const result = await operation(client, ownerId);
      await client.query('COMMIT');
      transactionOpen = false;
      return result;
    } catch (error) {
      if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
      if (error instanceof TypeError || error instanceof MetaOutboundRepositoryError) throw error;
      throw new MetaOutboundRepositoryError('Durable Meta outbox operation failed.', { cause: error });
    } finally {
      client.release();
    }
  }

  async claimNext(ownerUserId, { dispatchAllowed = false } = {}) {
    if (dispatchAllowed !== true) {
      throw new MetaOutboundRepositoryError('Meta dispatch is disabled by policy.', { code: 'META_DISPATCH_DISABLED' });
    }
    const leaseToken = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const result = await client.query(`
        WITH candidate AS (
          SELECT id
          FROM public.manebrain_outbound_jobs
          WHERE owner_user_id = $1
            AND status IN ('SEND_QUEUED', 'RETRY_WAIT')
            AND available_at <= clock_timestamp()
            AND attempts < max_attempts
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        ),
        claimed AS (
          UPDATE public.manebrain_outbound_jobs AS job
          SET status = 'DISPATCHING',
              attempts = job.attempts + 1,
              lease_token = $2,
              lease_expires_at = clock_timestamp() + ($3 * interval '1 millisecond'),
              last_attempt_id = $4,
              updated_at = clock_timestamp()
          FROM candidate
          WHERE job.id = candidate.id
          RETURNING job.*
        ),
        attempt AS (
          INSERT INTO public.manebrain_outbound_attempts (
            id, owner_user_id, outbound_job_id, attempt_number, lease_token, state
          )
          SELECT $4, $1, id, attempts, $2, 'DISPATCHING'
          FROM claimed
          RETURNING id
        )
        SELECT
          claimed.*,
          conversation.channel,
          conversation.provider_account_id,
          conversation.provider_conversation_id,
          conversation.provider_sender_id,
          latest_inbound.provider_message_id AS target_provider_message_id
        FROM claimed
        JOIN attempt ON attempt.id = claimed.last_attempt_id
        JOIN public.manebrain_conversations AS conversation
          ON conversation.id = claimed.conversation_id
         AND conversation.owner_user_id = claimed.owner_user_id
        LEFT JOIN LATERAL (
          SELECT message.provider_message_id
          FROM public.manebrain_messages AS message
          WHERE message.owner_user_id = claimed.owner_user_id
            AND message.conversation_id = claimed.conversation_id
            AND message.direction = 'inbound'
          ORDER BY message.received_at DESC NULLS LAST, message.created_at DESC, message.id DESC
          LIMIT 1
        ) AS latest_inbound ON true
      `, [ownerId, leaseToken, this.leaseDurationMs, attemptId]);
      return result.rows[0] || null;
    });
  }

  async completeAccepted(ownerUserId, {
    jobId,
    leaseToken,
    providerMessageId,
    responseMetadata = {},
  }) {
    return this.complete(ownerUserId, {
      jobId,
      leaseToken,
      outcome: 'accepted',
      providerMessageId: requiredString(providerMessageId, 'providerMessageId', 500),
      responseMetadata,
    });
  }

  async completeRejectedBeforeAcceptance(ownerUserId, {
    jobId,
    leaseToken,
    errorCode,
    responseMetadata = {},
    retryable = true,
  }) {
    return this.complete(ownerUserId, {
      jobId,
      leaseToken,
      outcome: 'rejected_before_acceptance',
      errorCode: requiredString(errorCode, 'errorCode', 160),
      responseMetadata,
      retryable: retryable === true,
    });
  }

  async completeOutcomeUnknown(ownerUserId, {
    jobId,
    leaseToken,
    errorCode = 'META_DELIVERY_OUTCOME_UNKNOWN',
    responseMetadata = {},
  }) {
    return this.complete(ownerUserId, {
      jobId,
      leaseToken,
      outcome: 'outcome_unknown',
      errorCode: requiredString(errorCode, 'errorCode', 160),
      responseMetadata,
      retryable: false,
    });
  }

  async complete(ownerUserId, {
    jobId,
    leaseToken,
    outcome,
    providerMessageId = null,
    errorCode = null,
    responseMetadata = {},
    retryable = true,
  }) {
    const normalizedJobId = uuid(jobId, 'jobId');
    const normalizedLeaseToken = uuid(leaseToken, 'leaseToken');
    const safeMetadata = metadata(responseMetadata);
    if (!['accepted', 'rejected_before_acceptance', 'outcome_unknown'].includes(outcome)) {
      throw new TypeError('outcome is invalid.');
    }
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const result = await client.query(`
        WITH locked AS (
          SELECT id, attempts, max_attempts, last_attempt_id
          FROM public.manebrain_outbound_jobs
          WHERE id = $2
            AND owner_user_id = $1
            AND status = 'DISPATCHING'
            AND lease_token = $3
          FOR UPDATE
        ),
        completed_attempt AS (
          UPDATE public.manebrain_outbound_attempts AS attempt
          SET state = CASE $4
                WHEN 'accepted' THEN 'ACCEPTED'
                WHEN 'rejected_before_acceptance' THEN 'REJECTED_BEFORE_ACCEPTANCE'
                ELSE 'OUTCOME_UNKNOWN'
              END,
              completed_at = clock_timestamp(),
              provider_message_id = $5,
              error_code = $6,
              response_metadata = $7::jsonb
          FROM locked
          WHERE attempt.id = locked.last_attempt_id
            AND attempt.owner_user_id = $1
            AND attempt.lease_token = $3
            AND attempt.state = 'DISPATCHING'
          RETURNING attempt.id
        )
        UPDATE public.manebrain_outbound_jobs AS job
        SET status = CASE
              WHEN $4 = 'accepted' THEN 'SENT'
              WHEN $4 = 'outcome_unknown' THEN 'DELIVERY_UNKNOWN'
              WHEN $9 = false OR locked.attempts >= locked.max_attempts THEN 'DEAD_LETTER'
              ELSE 'RETRY_WAIT'
            END,
            delivery_certainty = CASE
              WHEN $4 = 'accepted' THEN 'accepted'
              WHEN $4 = 'outcome_unknown' THEN 'outcome_unknown'
              WHEN $9 = false OR locked.attempts >= locked.max_attempts THEN 'rejected_before_acceptance'
              ELSE NULL
            END,
            provider_message_id = CASE WHEN $4 = 'accepted' THEN $5 ELSE NULL END,
            last_error_code = $6,
            available_at = CASE
              WHEN $4 = 'rejected_before_acceptance' AND $9 = true AND locked.attempts < locked.max_attempts
                THEN clock_timestamp() + ($8 * interval '1 millisecond')
              ELSE job.available_at
            END,
            sent_at = CASE WHEN $4 = 'accepted' THEN clock_timestamp() ELSE NULL END,
            terminal_at = CASE
              WHEN $4 IN ('accepted', 'outcome_unknown') OR $9 = false OR locked.attempts >= locked.max_attempts
                THEN clock_timestamp()
              ELSE NULL
            END,
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        FROM locked, completed_attempt
        WHERE job.id = locked.id
        RETURNING job.*
      `, [
        ownerId,
        normalizedJobId,
        normalizedLeaseToken,
        outcome,
        providerMessageId,
        errorCode,
        JSON.stringify(safeMetadata),
        this.retryDelayMs,
        retryable === true,
      ]);
      if (!result.rowCount) {
        throw new MetaOutboundRepositoryError('Outbound completion lost its lease or was already finalized.', {
          code: 'META_OUTBOUND_LEASE_CONFLICT',
          details: { jobId: normalizedJobId },
        });
      }
      return result.rows[0];
    });
  }

  async reconcileExpiredLeases(ownerUserId, { limit = 100 } = {}) {
    const normalizedLimit = positiveInteger(limit, 'limit', 1000);
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const result = await client.query(`
        WITH expired AS (
          SELECT id, last_attempt_id, lease_token
          FROM public.manebrain_outbound_jobs
          WHERE owner_user_id = $1
            AND status = 'DISPATCHING'
            AND lease_expires_at < clock_timestamp()
          ORDER BY lease_expires_at
          FOR UPDATE SKIP LOCKED
          LIMIT $2
        ),
        completed_attempts AS (
          UPDATE public.manebrain_outbound_attempts AS attempt
          SET state = 'OUTCOME_UNKNOWN',
              completed_at = clock_timestamp(),
              error_code = 'META_WORKER_LEASE_EXPIRED'
          FROM expired
          WHERE attempt.id = expired.last_attempt_id
            AND attempt.lease_token = expired.lease_token
            AND attempt.state = 'DISPATCHING'
          RETURNING attempt.outbound_job_id
        )
        UPDATE public.manebrain_outbound_jobs AS job
        SET status = 'DELIVERY_UNKNOWN',
            delivery_certainty = 'outcome_unknown',
            last_error_code = 'META_WORKER_LEASE_EXPIRED',
            terminal_at = clock_timestamp(),
            lease_token = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        FROM expired, completed_attempts
        WHERE job.id = expired.id
          AND completed_attempts.outbound_job_id = expired.id
        RETURNING job.*
      `, [ownerId, normalizedLimit]);
      return result.rows;
    });
  }
}
