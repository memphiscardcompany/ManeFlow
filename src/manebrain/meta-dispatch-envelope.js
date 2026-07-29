const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value, name) {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`${name} must be a UUID.`);
  return normalized;
}

export async function loadMetaDispatchEnvelope(pool, ownerUserId, { jobId, leaseToken }) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A pg.Pool-compatible instance is required.');
  }
  const ownerId = uuid(ownerUserId, 'ownerUserId');
  const id = uuid(jobId, 'jobId');
  const lease = uuid(leaseToken, 'leaseToken');
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(`SELECT set_config('app.platform_owner_user_id', $1, true)`, [ownerId]);
    const result = await client.query(`
      SELECT
        job.id,
        job.conversation_id,
        job.approved_text,
        job.approved_text_sha256,
        job.idempotency_key,
        job.attempts,
        job.max_attempts,
        conversation.channel,
        conversation.provider_account_id,
        conversation.provider_sender_id
      FROM public.manebrain_outbound_jobs AS job
      JOIN public.manebrain_conversations AS conversation
        ON conversation.id = job.conversation_id
       AND conversation.owner_user_id = job.owner_user_id
      WHERE job.owner_user_id = $1
        AND job.id = $2
        AND job.status = 'DISPATCHING'
        AND job.lease_token = $3
      LIMIT 1
    `, [ownerId, id, lease]);
    await client.query('COMMIT');
    transactionOpen = false;
    const row = result.rows[0];
    if (!row) return null;
    return {
      jobId: row.id,
      conversationId: row.conversation_id,
      approvedText: row.approved_text,
      approvedTextSha256: row.approved_text_sha256,
      idempotencyKey: row.idempotency_key,
      attempts: Number(row.attempts || 0),
      maxAttempts: Number(row.max_attempts || 0),
      channel: row.channel,
      providerAccountId: row.provider_account_id,
      providerSenderId: row.provider_sender_id,
    };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
