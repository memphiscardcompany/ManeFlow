import crypto from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, name) {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`${name} must be a UUID.`);
  return normalized;
}

function echoEvent(event) {
  if (!event || event.provider !== 'meta' || event.isEcho !== true || event.direction !== 'outbound') {
    throw new TypeError('A normalized outbound Meta echo is required.');
  }
  const providerMessageId = String(event.providerMessageId || '').trim();
  const receivedAt = String(event.receivedAt || '').trim();
  if (!providerMessageId || providerMessageId.length > 500) throw new TypeError('providerMessageId is required.');
  if (!receivedAt || Number.isNaN(Date.parse(receivedAt))) throw new TypeError('receivedAt must be an ISO timestamp.');
  return { providerMessageId, receivedAt };
}

async function appendAudit(client, ownerId, eventType, event) {
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
    ) VALUES ($1, 'meta_webhook', 'meta', $2, $3::jsonb, $4, $5)
  `, [ownerId, eventType, material, previousHash, entryHash]);
}

export class MetaDeliveryRepository {
  constructor(pool) {
    if (!pool || typeof pool.connect !== 'function') {
      throw new TypeError('MetaDeliveryRepository requires a pg.Pool-compatible instance.');
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

  async reconcileEchoes(ownerUserId, events) {
    const echoes = (Array.isArray(events) ? events : []).filter((event) => event?.isEcho === true).map(echoEvent);
    if (!echoes.length) return { observed: 0, matchedJobs: 0, updatedMessages: 0 };
    if (echoes.length > 5_000) throw new TypeError('At most 5000 Meta echoes can be reconciled in one batch.');
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const messageResult = await client.query(`
        WITH input AS (
          SELECT *
          FROM jsonb_to_recordset($2::jsonb) AS echo(
            "providerMessageId" text,
            "receivedAt" timestamptz
          )
        )
        UPDATE public.manebrain_messages AS message
        SET direction = 'outbound',
            sent_at = COALESCE(message.sent_at, input."receivedAt")
        FROM input
        WHERE message.owner_user_id = $1
          AND message.provider_message_id = input."providerMessageId"
        RETURNING message.provider_message_id
      `, [ownerId, JSON.stringify(echoes)]);

      const jobResult = await client.query(`
        WITH input AS (
          SELECT *
          FROM jsonb_to_recordset($2::jsonb) AS echo(
            "providerMessageId" text,
            "receivedAt" timestamptz
          )
        )
        UPDATE public.manebrain_outbound_jobs AS job
        SET provider_echo_at = CASE
              WHEN job.provider_echo_at IS NULL THEN input."receivedAt"
              ELSE LEAST(job.provider_echo_at, input."receivedAt")
            END,
            updated_at = clock_timestamp()
        FROM input
        WHERE job.owner_user_id = $1
          AND job.provider_message_id = input."providerMessageId"
          AND job.status = 'SENT'
        RETURNING job.id, job.provider_message_id, job.provider_echo_at
      `, [ownerId, JSON.stringify(echoes)]);

      const matchedMessageIds = [...new Set(jobResult.rows.map((row) => row.provider_message_id))];
      if (jobResult.rowCount || messageResult.rowCount) {
        await appendAudit(client, ownerId, 'meta_provider_echo_reconciled', {
          echoCount: echoes.length,
          matchedJobs: jobResult.rowCount,
          updatedMessages: messageResult.rowCount,
          providerMessageIds: matchedMessageIds,
        });
      }
      return {
        observed: echoes.length,
        matchedJobs: jobResult.rowCount,
        updatedMessages: messageResult.rowCount,
      };
    });
  }
}
