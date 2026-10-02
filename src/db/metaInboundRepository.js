import crypto from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MetaInboundRepositoryError extends Error {
  constructor(message, { cause, code = 'META_INBOUND_REPOSITORY_ERROR' } = {}) {
    super(message, { cause });
    this.name = 'MetaInboundRepositoryError';
    this.code = code;
  }
}

function uuid(value, name) {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`${name} must be a UUID.`);
  return normalized;
}

function string(value, name, maximum = 4_096) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${name} is required.`);
  if (normalized.length > maximum) throw new TypeError(`${name} exceeds ${maximum} characters.`);
  return normalized;
}

function optionalString(value, maximum) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value);
  return normalized.slice(0, maximum);
}

function pageLimit(value) {
  const normalized = Number(value ?? 50);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 200) {
    throw new TypeError('limit must be an integer between 1 and 200.');
  }
  return normalized;
}

function assertEvent(event) {
  if (!event || event.provider !== 'meta') throw new TypeError('A normalized Meta event is required.');
  return {
    channel: string(event.channel, 'channel', 40),
    providerAccountId: string(event.providerAccountId, 'providerAccountId', 500),
    providerEventId: string(event.providerEventId, 'providerEventId', 500),
    providerMessageId: string(event.providerMessageId, 'providerMessageId', 500),
    providerConversationId: string(event.providerConversationId, 'providerConversationId', 1_000),
    providerSenderId: string(event.providerSenderId, 'providerSenderId', 500),
    body: optionalString(event.body, 4_000),
    receivedAt: string(event.receivedAt, 'receivedAt', 64),
    attachments: Array.isArray(event.attachments) ? structuredClone(event.attachments) : [],
  };
}

export class MetaInboundRepository {
  constructor(pool) {
    if (!pool || typeof pool.connect !== 'function') {
      throw new TypeError('MetaInboundRepository requires a pg.Pool-compatible instance.');
    }
    this.pool = pool;
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
      if (error instanceof TypeError || error instanceof MetaInboundRepositoryError) throw error;
      throw new MetaInboundRepositoryError('Durable Meta inbox operation failed.', { cause: error });
    } finally {
      client.release();
    }
  }

  async ingestBatch(ownerUserId, { events, payloadSha256 }) {
    if (!Array.isArray(events) || events.length < 1 || events.length > 5_000) {
      throw new TypeError('events must contain between 1 and 5000 normalized events.');
    }
    const hash = string(payloadSha256, 'payloadSha256', 64);
    if (!/^[a-f0-9]{64}$/i.test(hash)) throw new TypeError('payloadSha256 must be a SHA-256 digest.');
    const normalized = events.map(assertEvent);
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const assetKeys = new Map();
      for (const event of normalized) {
        assetKeys.set(JSON.stringify([event.channel, event.providerAccountId]), {
          channel: event.channel,
          providerAccountId: event.providerAccountId,
        });
      }
      for (const { channel, providerAccountId } of assetKeys.values()) {
        const asset = await client.query(`
          SELECT id
          FROM public.manebrain_meta_assets
          WHERE owner_user_id = $1
            AND enabled = true
            AND verified_at IS NOT NULL
            AND CASE
              WHEN $2 LIKE 'instagram_%' THEN instagram_account_id = $3
              ELSE page_id = $3
            END
          LIMIT 1
        `, [ownerId, channel, providerAccountId]);
        if (!asset.rowCount) {
          throw new MetaInboundRepositoryError('The Meta asset is not enabled and verified.', {
            code: 'META_ASSET_NOT_PROVISIONED',
          });
        }
      }

      const replayMismatch = await client.query(`
        WITH input AS (
          SELECT *
          FROM jsonb_to_recordset($3::jsonb) AS event(
            "providerAccountId" text,
            "providerEventId" text
          )
        )
        SELECT input."providerEventId"
        FROM input
        JOIN public.manebrain_webhook_events AS existing
          ON existing.owner_user_id = $1
         AND existing.provider_account_id = input."providerAccountId"
         AND existing.provider_event_id = input."providerEventId"
        WHERE existing.payload_sha256 <> $2
        LIMIT 1
      `, [ownerId, hash, JSON.stringify(normalized)]);
      if (replayMismatch.rowCount) {
        throw new MetaInboundRepositoryError(
          'A replayed Meta event had different payload bytes.',
          { code: 'META_REPLAY_PAYLOAD_MISMATCH' },
        );
      }

      const inserted = await client.query(`
        WITH input AS (
          SELECT *
          FROM jsonb_to_recordset($3::jsonb) AS event(
            channel text,
            "providerAccountId" text,
            "providerEventId" text,
            "providerMessageId" text,
            "providerConversationId" text,
            "providerSenderId" text,
            body text,
            "receivedAt" timestamptz,
            attachments jsonb
          )
        ),
        inserted_events AS (
          INSERT INTO public.manebrain_webhook_events (
            owner_user_id,
            provider_account_id,
            provider_event_id,
            payload_sha256,
            received_at,
            status
          )
          SELECT
            $1,
            input."providerAccountId",
            input."providerEventId",
            $2,
            input."receivedAt",
            'RECEIVED'
          FROM input
          ON CONFLICT (owner_user_id, provider_account_id, provider_event_id) DO NOTHING
          RETURNING id, provider_account_id, provider_event_id
        ),
        accepted AS (
          SELECT input.*, inserted_events.id AS webhook_id
          FROM input
          JOIN inserted_events
            ON inserted_events.provider_account_id = input."providerAccountId"
           AND inserted_events.provider_event_id = input."providerEventId"
        ),
        latest_conversations AS (
          SELECT DISTINCT ON (channel, "providerConversationId")
            channel,
            "providerAccountId",
            "providerConversationId",
            "providerSenderId"
          FROM accepted
          ORDER BY channel, "providerConversationId", "receivedAt" DESC
        ),
        conversations AS (
          INSERT INTO public.manebrain_conversations (
            owner_user_id,
            channel,
            provider_account_id,
            provider_conversation_id,
            provider_sender_id,
            state
          )
          SELECT
            $1,
            latest_conversations.channel,
            latest_conversations."providerAccountId",
            latest_conversations."providerConversationId",
            latest_conversations."providerSenderId",
            'QUEUED'
          FROM latest_conversations
          ON CONFLICT (owner_user_id, channel, provider_conversation_id)
          DO UPDATE SET
            provider_sender_id = EXCLUDED.provider_sender_id,
            updated_at = clock_timestamp()
          RETURNING id, channel, provider_conversation_id
        ),
        messages AS (
          INSERT INTO public.manebrain_messages (
            owner_user_id,
            conversation_id,
            provider_message_id,
            direction,
            body,
            attachment_manifest,
            received_at
          )
          SELECT
            $1,
            conversations.id,
            accepted."providerMessageId",
            'inbound',
            accepted.body,
            accepted.attachments,
            accepted."receivedAt"
          FROM accepted
          JOIN conversations
            ON conversations.channel = accepted.channel
           AND conversations.provider_conversation_id = accepted."providerConversationId"
          ON CONFLICT (owner_user_id, provider_message_id) DO NOTHING
          RETURNING id
        ),
        updated_events AS (
          UPDATE public.manebrain_webhook_events AS webhook
          SET status = 'QUEUED', normalized_at = clock_timestamp()
          FROM accepted
          WHERE webhook.id = accepted.webhook_id
          RETURNING webhook.id
        )
        SELECT
          accepted."providerEventId" AS provider_event_id,
          conversations.id AS conversation_id
        FROM accepted
        JOIN conversations
          ON conversations.channel = accepted.channel
         AND conversations.provider_conversation_id = accepted."providerConversationId"
        JOIN updated_events ON updated_events.id = accepted.webhook_id
      `, [ownerId, hash, JSON.stringify(normalized)]);
      const accepted = inserted.rows.map((row) => ({
        providerEventId: row.provider_event_id,
        conversationId: row.conversation_id,
      }));
      const acceptedIds = new Set(accepted.map((event) => event.providerEventId));
      const duplicates = normalized
        .filter((event) => !acceptedIds.has(event.providerEventId))
        .map((event) => event.providerEventId);

      if (accepted.length) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [ownerId]);
        const previous = await client.query(`
          SELECT entry_hash
          FROM public.manebrain_audit_log
          WHERE owner_user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `, [ownerId]);
        const previousHash = previous.rows[0]?.entry_hash || null;
        const auditEvent = {
          accepted: accepted.length,
          providerEventIds: accepted.map((event) => event.providerEventId),
          payloadSha256: hash,
        };
        const auditMaterial = JSON.stringify(auditEvent);
        const entryHash = crypto.createHash('sha256')
          .update(`${previousHash || ''}|${auditMaterial}`)
          .digest('hex');
        await client.query(`
          INSERT INTO public.manebrain_audit_log (
            owner_user_id,
            actor_type,
            actor_id,
            event_type,
            event,
            previous_hash,
            entry_hash
          )
          VALUES ($1, 'meta_webhook', 'meta', 'inbound_batch_queued', $2::jsonb, $3, $4)
        `, [ownerId, auditMaterial, previousHash, entryHash]);
      }
      return { accepted, duplicates };
    });
  }

  async deadLetterEvents(ownerUserId, {
    events,
    payloadSha256,
    errorCode = 'META_WEBHOOK_STALE',
  }) {
    if (!Array.isArray(events) || events.length < 1 || events.length > 5_000) {
      throw new TypeError('events must contain between 1 and 5000 normalized events.');
    }
    const hash = string(payloadSha256, 'payloadSha256', 64);
    if (!/^[a-f0-9]{64}$/i.test(hash)) throw new TypeError('payloadSha256 must be a SHA-256 digest.');
    const normalizedErrorCode = string(errorCode, 'errorCode', 160);
    const normalized = events.map(assertEvent);

    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const inserted = await client.query(`
        WITH input AS (
          SELECT *
          FROM jsonb_to_recordset($4::jsonb) AS event(
            "providerAccountId" text,
            "providerEventId" text,
            "receivedAt" timestamptz
          )
        )
        INSERT INTO public.manebrain_webhook_events (
          owner_user_id,
          provider_account_id,
          provider_event_id,
          payload_sha256,
          received_at,
          normalized_at,
          status,
          error_code
        )
        SELECT
          $1,
          input."providerAccountId",
          input."providerEventId",
          $2,
          input."receivedAt",
          clock_timestamp(),
          'DEAD_LETTER',
          $3
        FROM input
        ON CONFLICT (owner_user_id, provider_account_id, provider_event_id) DO NOTHING
        RETURNING provider_event_id
      `, [ownerId, hash, normalizedErrorCode, JSON.stringify(normalized)]);

      const deadLettered = inserted.rows.map((row) => row.provider_event_id);
      if (deadLettered.length) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [ownerId]);
        const previous = await client.query(`
          SELECT entry_hash
          FROM public.manebrain_audit_log
          WHERE owner_user_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `, [ownerId]);
        const previousHash = previous.rows[0]?.entry_hash || null;
        const auditEvent = {
          errorCode: normalizedErrorCode,
          deadLettered: deadLettered.length,
          providerEventIds: deadLettered,
          payloadSha256: hash,
        };
        const auditMaterial = JSON.stringify(auditEvent);
        const entryHash = crypto.createHash('sha256')
          .update(`${previousHash || ''}|${auditMaterial}`)
          .digest('hex');
        await client.query(`
          INSERT INTO public.manebrain_audit_log (
            owner_user_id,
            actor_type,
            actor_id,
            event_type,
            event,
            previous_hash,
            entry_hash
          )
          VALUES ($1, 'meta_webhook', 'meta', 'inbound_dead_lettered', $2::jsonb, $3, $4)
        `, [ownerId, auditMaterial, previousHash, entryHash]);
      }

      const insertedIds = new Set(deadLettered);
      return {
        deadLettered,
        duplicates: normalized
          .filter((event) => !insertedIds.has(event.providerEventId))
          .map((event) => event.providerEventId),
      };
    });
  }

  async listConversations(ownerUserId, { limit = 50, beforeUpdatedAt = null, beforeId = null } = {}) {
    const normalizedLimit = pageLimit(limit);
    if (Boolean(beforeUpdatedAt) !== Boolean(beforeId)) {
      throw new TypeError('beforeUpdatedAt and beforeId must be provided together.');
    }
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const result = await client.query(`
        SELECT
          conversation.id,
          conversation.channel,
          conversation.provider_account_id,
          conversation.provider_conversation_id,
          conversation.provider_sender_id,
          conversation.state,
          conversation.intent,
          conversation.intent_confidence,
          conversation.labels,
          conversation.created_at,
          conversation.updated_at,
          (
            SELECT body
            FROM public.manebrain_messages AS message
            WHERE message.conversation_id = conversation.id
              AND message.owner_user_id = conversation.owner_user_id
            ORDER BY message.created_at DESC, message.id DESC
            LIMIT 1
          ) AS latest_message
        FROM public.manebrain_conversations AS conversation
        WHERE conversation.owner_user_id = $1
          AND (
            $2::timestamptz IS NULL
            OR (conversation.updated_at, conversation.id) < ($2::timestamptz, $3::uuid)
          )
        ORDER BY conversation.updated_at DESC, conversation.id DESC
        LIMIT $4
      `, [
        ownerId,
        beforeUpdatedAt,
        beforeId ? uuid(beforeId, 'beforeId') : null,
        normalizedLimit,
      ]);
      return result.rows;
    });
  }

  async getConversation(ownerUserId, conversationId) {
    const id = uuid(conversationId, 'conversationId');
    return this.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
      const conversation = await client.query(`
        SELECT *
        FROM public.manebrain_conversations
        WHERE owner_user_id = $1 AND id = $2
      `, [ownerId, id]);
      if (!conversation.rowCount) return null;
      const [messages, drafts] = await Promise.all([
        client.query(`
          SELECT id, provider_message_id, direction, body, attachment_manifest,
                 received_at, sent_at, created_at
          FROM public.manebrain_messages
          WHERE owner_user_id = $1 AND conversation_id = $2
          ORDER BY created_at, id
          LIMIT 500
        `, [ownerId, id]),
        client.query(`
          SELECT id, version, body, source, evidence, status, created_at
          FROM public.manebrain_reply_drafts
          WHERE owner_user_id = $1 AND conversation_id = $2
          ORDER BY version DESC
          LIMIT 100
        `, [ownerId, id]),
      ]);
      return {
        conversation: conversation.rows[0],
        messages: messages.rows,
        drafts: drafts.rows,
      };
    });
  }
}
