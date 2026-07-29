const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_STATUSES = new Set([
  'HELD_POLICY_REVIEW',
  'SEND_QUEUED',
  'DISPATCHING',
  'RETRY_WAIT',
  'SEND_FAILED',
  'SENT',
  'DELIVERY_UNKNOWN',
  'DEAD_LETTER',
  'CANCELLED',
]);

function uuid(value, name) {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`${name} must be a UUID.`);
  return normalized;
}

function pageLimit(value) {
  const normalized = Number(value ?? 50);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 200) {
    throw new TypeError('limit must be an integer between 1 and 200.');
  }
  return normalized;
}

function statusFilter(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (!JOB_STATUSES.has(normalized)) throw new TypeError('status is not a supported Meta outbound state.');
  return normalized;
}

export class MetaOutboundQueryRepository {
  constructor(pool) {
    if (!pool || typeof pool.connect !== 'function') {
      throw new TypeError('MetaOutboundQueryRepository requires a pg.Pool-compatible instance.');
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
      throw error;
    } finally {
      client.release();
    }
  }

  async list(ownerUserId, {
    status = null,
    limit = 50,
    beforeUpdatedAt = null,
    beforeId = null,
  } = {}) {
    const normalizedStatus = statusFilter(status);
    const normalizedLimit = pageLimit(limit);
    if (Boolean(beforeUpdatedAt) !== Boolean(beforeId)) {
      throw new TypeError('beforeUpdatedAt and beforeId must be provided together.');
    }
    const normalizedBeforeId = beforeId ? uuid(beforeId, 'beforeId') : null;
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const result = await client.query(`
        SELECT
          job.*,
          conversation.channel,
          conversation.provider_account_id,
          conversation.provider_conversation_id,
          conversation.provider_sender_id,
          draft.version AS draft_version,
          draft.source AS draft_source
        FROM public.manebrain_outbound_jobs AS job
        JOIN public.manebrain_conversations AS conversation
          ON conversation.id = job.conversation_id
         AND conversation.owner_user_id = job.owner_user_id
        LEFT JOIN public.manebrain_reply_drafts AS draft
          ON draft.id = job.draft_id
         AND draft.owner_user_id = job.owner_user_id
        WHERE job.owner_user_id = $1
          AND ($2::text IS NULL OR job.status = $2)
          AND (
            $3::timestamptz IS NULL
            OR (job.updated_at, job.id) < ($3::timestamptz, $4::uuid)
          )
        ORDER BY job.updated_at DESC, job.id DESC
        LIMIT $5
      `, [ownerId, normalizedStatus, beforeUpdatedAt, normalizedBeforeId, normalizedLimit]);
      return result.rows;
    });
  }

  async counts(ownerUserId) {
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const result = await client.query(`
        SELECT status, COUNT(*)::integer AS count
        FROM public.manebrain_outbound_jobs
        WHERE owner_user_id = $1
        GROUP BY status
      `, [ownerId]);
      return Object.fromEntries(result.rows.map((row) => [row.status, Number(row.count)]));
    });
  }
}
