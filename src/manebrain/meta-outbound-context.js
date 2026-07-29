export async function loadMetaOutboundDispatchContext(repository, ownerUserId, job) {
  if (!repository || typeof repository.withOwnerTransaction !== 'function') {
    throw new TypeError('A MetaOutboundRepository-compatible repository is required.');
  }
  if (!job?.id || !job?.lease_token) {
    throw new TypeError('A claimed Meta outbound job and lease token are required.');
  }
  return repository.withOwnerTransaction(ownerUserId, async (client, ownerId) => {
    const result = await client.query(`
      SELECT
        job.*,
        conversation.channel,
        conversation.provider_account_id,
        conversation.provider_conversation_id,
        conversation.provider_sender_id,
        asset.page_id,
        asset.instagram_account_id,
        (
          SELECT max(message.received_at)
          FROM public.manebrain_messages AS message
          WHERE message.owner_user_id = $1
            AND message.conversation_id = conversation.id
            AND message.direction = 'inbound'
        ) AS latest_inbound_at
      FROM public.manebrain_outbound_jobs AS job
      JOIN public.manebrain_conversations AS conversation
        ON conversation.id = job.conversation_id
       AND conversation.owner_user_id = job.owner_user_id
      JOIN public.manebrain_meta_assets AS asset
        ON asset.owner_user_id = job.owner_user_id
       AND asset.enabled
       AND asset.verified_at IS NOT NULL
      WHERE job.owner_user_id = $1
        AND job.id = $2
        AND job.status = 'DISPATCHING'
        AND job.lease_token = $3
      FOR UPDATE OF job
    `, [ownerId, job.id, job.lease_token]);
    if (!result.rowCount) {
      const error = new Error('Claimed Meta dispatch context was unavailable or no longer fenced.');
      error.code = 'META_DISPATCH_CONTEXT_MISSING';
      throw error;
    }
    return result.rows[0];
  });
}
