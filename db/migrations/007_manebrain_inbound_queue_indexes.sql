-- High-throughput, owner-isolated Meta intake access paths.

CREATE INDEX IF NOT EXISTS manebrain_webhook_queue_idx
    ON public.manebrain_webhook_events (owner_user_id, created_at, id)
    WHERE status IN ('RECEIVED', 'QUEUED');

CREATE INDEX IF NOT EXISTS manebrain_conversation_owner_cursor_idx
    ON public.manebrain_conversations (owner_user_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS manebrain_messages_conversation_cursor_idx
    ON public.manebrain_messages (owner_user_id, conversation_id, created_at, id);

CREATE INDEX IF NOT EXISTS manebrain_drafts_conversation_version_idx
    ON public.manebrain_reply_drafts (owner_user_id, conversation_id, version DESC);
