import crypto from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MetaOwnerRepositoryError extends Error {
  constructor(message, { cause, code = 'META_OWNER_REPOSITORY_ERROR', status = 409 } = {}) {
    super(message, { cause });
    this.name = 'MetaOwnerRepositoryError';
    this.code = code;
    this.status = status;
  }
}

function uuid(value, name) {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`${name} must be a UUID.`);
  return normalized;
}

function text(value, name, maximum = 4_000) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (normalized.length > maximum) throw new TypeError(`${name} exceeds ${maximum} characters.`);
  return normalized;
}

function evidenceArray(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) throw new TypeError('evidence must be an array with at most 100 items.');
  return structuredClone(value);
}

function approvedHash(value) {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

async function appendAudit(client, ownerId, actorId, eventType, event) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [ownerId]);
  const previous = await client.query(`
    SELECT entry_hash
    FROM public.manebrain_audit_log
    WHERE owner_user_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [ownerId]);
  const previousHash = previous.rows[0]?.entry_hash || null;
  const material = JSON.stringify(event);
  const entryHash = crypto.createHash('sha256').update(`${previousHash || ''}|${material}`).digest('hex');
  await client.query(`
    INSERT INTO public.manebrain_audit_log (
      owner_user_id, actor_type, actor_id, event_type, event, previous_hash, entry_hash
    ) VALUES ($1, 'platform_owner', $2, $3, $4::jsonb, $5, $6)
  `, [ownerId, actorId, eventType, material, previousHash, entryHash]);
}

export class MetaOwnerRepository {
  constructor(pool) {
    if (!pool || typeof pool.connect !== 'function') {
      throw new TypeError('MetaOwnerRepository requires a pg.Pool-compatible instance.');
    }
    this.pool = pool;
  }

  async withOwnerTransaction(ownerUserId, operation) {
    const ownerId = uuid(ownerUserId, 'ownerUserId');
    const client = await this.pool.connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;
      await client.query(`SELECT set_config('app.platform_owner_user_id', $1, true)`, [ownerId]);
      const result = await operation(client, ownerId);
      await client.query('COMMIT');
      open = false;
      return result;
    } catch (error) {
      if (open) await client.query('ROLLBACK').catch(() => {});
      if (error instanceof TypeError || error instanceof MetaOwnerRepositoryError) throw error;
      throw new MetaOwnerRepositoryError('Durable owner Meta operation failed.', { cause: error });
    } finally {
      client.release();
    }
  }

  async createDraft(ownerUserId, {
    conversationId,
    body,
    source = 'owner_manual',
    evidence = [],
    actorId = ownerUserId,
  }) {
    const normalizedConversationId = uuid(conversationId, 'conversationId');
    const normalizedBody = text(body, 'body');
    const normalizedSource = text(source, 'source', 120);
    const normalizedEvidence = evidenceArray(evidence);
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const conversation = await client.query(`
        SELECT id
        FROM public.manebrain_conversations
        WHERE owner_user_id = $1 AND id = $2
        FOR UPDATE
      `, [ownerId, normalizedConversationId]);
      if (!conversation.rowCount) {
        throw new MetaOwnerRepositoryError('Meta conversation not found.', { code: 'META_CONVERSATION_NOT_FOUND', status: 404 });
      }
      const inserted = await client.query(`
        INSERT INTO public.manebrain_reply_drafts (
          owner_user_id, conversation_id, version, body, source, evidence, status
        )
        SELECT
          $1,
          $2,
          COALESCE(MAX(version), 0) + 1,
          $3,
          $4,
          $5::jsonb,
          'DRAFT'
        FROM public.manebrain_reply_drafts
        WHERE owner_user_id = $1 AND conversation_id = $2
        RETURNING *
      `, [ownerId, normalizedConversationId, normalizedBody, normalizedSource, JSON.stringify(normalizedEvidence)]);
      const draft = inserted.rows[0];
      await appendAudit(client, ownerId, String(actorId), 'meta_reply_draft_created', {
        draftId: draft.id,
        conversationId: normalizedConversationId,
        source: normalizedSource,
        bodySha256: approvedHash(normalizedBody),
      });
      return draft;
    });
  }

  async rejectDraft(ownerUserId, { draftId, actorId = ownerUserId, reason = 'owner_rejected' }) {
    const normalizedDraftId = uuid(draftId, 'draftId');
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const result = await client.query(`
        UPDATE public.manebrain_reply_drafts
        SET status = 'REJECTED_BY_HUMAN'
        WHERE owner_user_id = $1 AND id = $2 AND status = 'DRAFT'
        RETURNING *
      `, [ownerId, normalizedDraftId]);
      if (!result.rowCount) {
        throw new MetaOwnerRepositoryError('Only an active draft can be rejected.', { code: 'META_DRAFT_STATE_CONFLICT' });
      }
      await appendAudit(client, ownerId, String(actorId), 'meta_reply_draft_rejected', {
        draftId: normalizedDraftId,
        reason: String(reason || 'owner_rejected').slice(0, 500),
      });
      return result.rows[0];
    });
  }

  async approveDraft(ownerUserId, {
    draftId,
    approvedText,
    targetProviderMessageId,
    approvedBy = ownerUserId,
    approvedAt = new Date().toISOString(),
    maxAttempts = 3,
  }) {
    const normalizedDraftId = uuid(draftId, 'draftId');
    const normalizedApprovedBy = uuid(approvedBy, 'approvedBy');
    if (normalizedApprovedBy !== uuid(ownerUserId, 'ownerUserId')) {
      throw new MetaOwnerRepositoryError('The approving owner must match the configured platform owner.', {
        code: 'META_APPROVAL_OWNER_MISMATCH',
        status: 403,
      });
    }
    const normalizedText = text(approvedText, 'approvedText');
    const normalizedTargetProviderMessageId = text(targetProviderMessageId, 'targetProviderMessageId', 500);
    const hash = approvedHash(normalizedText);
    const attempts = Math.max(1, Math.min(20, Number(maxAttempts || 3)));
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const draftResult = await client.query(`
        SELECT *
        FROM public.manebrain_reply_drafts
        WHERE owner_user_id = $1 AND id = $2
        FOR UPDATE
      `, [ownerId, normalizedDraftId]);
      if (!draftResult.rowCount) {
        throw new MetaOwnerRepositoryError('Meta draft not found.', { code: 'META_DRAFT_NOT_FOUND', status: 404 });
      }
      const draft = draftResult.rows[0];
      const existing = await client.query(`
        SELECT *
        FROM public.manebrain_outbound_jobs
        WHERE owner_user_id = $1 AND draft_id = $2
        FOR UPDATE
      `, [ownerId, normalizedDraftId]);
      if (existing.rowCount) {
        const job = existing.rows[0];
        if (job.approved_text_sha256 === hash && job.approved_by === ownerId) return job;
        throw new MetaOwnerRepositoryError('This draft already has a different approval record.', {
          code: 'META_DRAFT_ALREADY_APPROVED',
        });
      }
      if (draft.status !== 'DRAFT') {
        throw new MetaOwnerRepositoryError('Only an active draft can be approved.', { code: 'META_DRAFT_STATE_CONFLICT' });
      }
      const target = await client.query(`
        SELECT provider_message_id
        FROM public.manebrain_messages
        WHERE owner_user_id = $1
          AND conversation_id = $2
          AND direction = 'inbound'
          AND provider_message_id = $3
        FOR SHARE
      `, [ownerId, draft.conversation_id, normalizedTargetProviderMessageId]);
      if (!target.rowCount) {
        throw new MetaOwnerRepositoryError('The approved reply target is not an inbound message in this conversation.', {
          code: 'META_APPROVAL_TARGET_INVALID',
          status: 409,
        });
      }
      await client.query(`
        UPDATE public.manebrain_reply_drafts
        SET status = 'APPROVED_BY_HUMAN',
            target_provider_message_id = $3
        WHERE owner_user_id = $1 AND id = $2
      `, [ownerId, normalizedDraftId, normalizedTargetProviderMessageId]);
      const inserted = await client.query(`
        INSERT INTO public.manebrain_outbound_jobs (
          owner_user_id,
          conversation_id,
          draft_id,
          approved_text,
          approved_text_sha256,
          approved_by,
          approved_at,
          status,
          attempts,
          max_attempts,
          available_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, 'HELD_POLICY_REVIEW', 0, $8, clock_timestamp())
        RETURNING *
      `, [ownerId, draft.conversation_id, normalizedDraftId, normalizedText, hash, normalizedApprovedBy, approvedAt, attempts]);
      const job = inserted.rows[0];
      await appendAudit(client, ownerId, normalizedApprovedBy, 'meta_reply_approved', {
        draftId: normalizedDraftId,
        outboundJobId: job.id,
        conversationId: draft.conversation_id,
        approvedTextSha256: hash,
        targetProviderMessageId: normalizedTargetProviderMessageId,
      });
      return job;
    });
  }

  async queueApprovedJob(ownerUserId, {
    jobId,
    currentText,
    actorId = ownerUserId,
  }) {
    const normalizedJobId = uuid(jobId, 'jobId');
    const normalizedActorId = uuid(actorId, 'actorId');
    const normalizedText = text(currentText, 'currentText');
    const hash = approvedHash(normalizedText);
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const result = await client.query(`
        UPDATE public.manebrain_outbound_jobs
        SET status = 'SEND_QUEUED', available_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE owner_user_id = $1
          AND id = $2
          AND approved_by = $3
          AND approved_text = $4
          AND approved_text_sha256 = $5
          AND status IN ('HELD_POLICY_REVIEW', 'SEND_FAILED')
          AND attempts < max_attempts
        RETURNING *
      `, [ownerId, normalizedJobId, normalizedActorId, normalizedText, hash]);
      if (!result.rowCount) {
        throw new MetaOwnerRepositoryError('The exact owner-approved text could not be queued.', {
          code: 'META_OUTBOUND_STATE_CONFLICT',
        });
      }
      const job = result.rows[0];
      await appendAudit(client, ownerId, normalizedActorId, 'meta_reply_queued', {
        outboundJobId: normalizedJobId,
        conversationId: job.conversation_id,
        approvedTextSha256: hash,
      });
      return job;
    });
  }

  async getOutboundJob(ownerUserId, jobId) {
    const normalizedJobId = uuid(jobId, 'jobId');
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const result = await client.query(`
        SELECT
          job.*,
          conversation.channel,
          conversation.provider_account_id,
          conversation.provider_conversation_id,
          conversation.provider_sender_id
        FROM public.manebrain_outbound_jobs AS job
        JOIN public.manebrain_conversations AS conversation
          ON conversation.id = job.conversation_id
         AND conversation.owner_user_id = job.owner_user_id
        WHERE job.owner_user_id = $1 AND job.id = $2
      `, [ownerId, normalizedJobId]);
      return result.rows[0] || null;
    });
  }
}
