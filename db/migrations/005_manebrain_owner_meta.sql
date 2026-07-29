-- ManeBrain owner-only Meta operations.
-- This migration stores no provider tokens. Secret values remain in the production secret manager.

CREATE OR REPLACE FUNCTION maneflow_private.current_platform_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
    SELECT NULLIF(current_setting('app.platform_owner_user_id', true), '')::uuid;
$$;

REVOKE ALL ON FUNCTION maneflow_private.current_platform_owner_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maneflow_private.current_platform_owner_id() TO maneflow_app;

CREATE TABLE IF NOT EXISTS public.platform_owner_authority (
    user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE RESTRICT,
    authority_version integer NOT NULL DEFAULT 1 CHECK (authority_version > 0),
    mfa_required boolean NOT NULL DEFAULT true CHECK (mfa_required),
    recovery_reference text,
    provisioned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS public.manebrain_meta_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES public.platform_owner_authority(user_id) ON DELETE RESTRICT,
    provider text NOT NULL DEFAULT 'meta' CHECK (provider = 'meta'),
    app_id text NOT NULL,
    business_id text NOT NULL,
    page_id text NOT NULL,
    instagram_account_id text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT manebrain_meta_assets_owner_unique UNIQUE (owner_user_id)
);

CREATE TABLE IF NOT EXISTS public.manebrain_webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES public.platform_owner_authority(user_id) ON DELETE RESTRICT,
    provider_account_id text NOT NULL,
    provider_event_id text NOT NULL,
    payload_sha256 char(64) NOT NULL,
    received_at timestamptz NOT NULL,
    normalized_at timestamptz,
    status text NOT NULL,
    error_code text,
    private_payload_object_key text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT manebrain_webhook_event_idempotency UNIQUE (owner_user_id, provider_account_id, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.manebrain_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES public.platform_owner_authority(user_id) ON DELETE RESTRICT,
    channel text NOT NULL CHECK (channel IN ('messenger', 'instagram_dm', 'facebook_comment', 'instagram_comment')),
    provider_account_id text NOT NULL,
    provider_conversation_id text NOT NULL,
    provider_sender_id text NOT NULL,
    state text NOT NULL DEFAULT 'RECEIVED',
    intent text NOT NULL DEFAULT 'UNKNOWN',
    intent_confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (intent_confidence BETWEEN 0 AND 1),
    labels jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(labels) = 'array'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT manebrain_conversation_unique UNIQUE (owner_user_id, channel, provider_conversation_id)
);

CREATE TABLE IF NOT EXISTS public.manebrain_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES public.platform_owner_authority(user_id) ON DELETE RESTRICT,
    conversation_id uuid NOT NULL REFERENCES public.manebrain_conversations(id) ON DELETE CASCADE,
    provider_message_id text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    body text,
    attachment_manifest jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachment_manifest) = 'array'),
    received_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT manebrain_message_unique UNIQUE (owner_user_id, provider_message_id)
);

CREATE TABLE IF NOT EXISTS public.manebrain_reply_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES public.platform_owner_authority(user_id) ON DELETE RESTRICT,
    conversation_id uuid NOT NULL REFERENCES public.manebrain_conversations(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version > 0),
    body text NOT NULL,
    source text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
    status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED_BY_HUMAN', 'REJECTED_BY_HUMAN')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT manebrain_draft_version_unique UNIQUE (conversation_id, version)
);

CREATE TABLE IF NOT EXISTS public.manebrain_outbound_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES public.platform_owner_authority(user_id) ON DELETE RESTRICT,
    conversation_id uuid NOT NULL REFERENCES public.manebrain_conversations(id) ON DELETE CASCADE,
    draft_id uuid NOT NULL REFERENCES public.manebrain_reply_drafts(id) ON DELETE RESTRICT,
    approved_text text NOT NULL,
    approved_text_sha256 char(64) NOT NULL,
    approved_by uuid NOT NULL REFERENCES public.platform_owner_authority(user_id) ON DELETE RESTRICT,
    approved_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'HELD_POLICY_REVIEW'
        CHECK (status IN ('HELD_POLICY_REVIEW', 'SEND_QUEUED', 'SENT', 'SEND_FAILED', 'DEAD_LETTER')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
    provider_message_id text,
    last_error_code text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT manebrain_outbound_idempotency UNIQUE (idempotency_key),
    CONSTRAINT manebrain_outbound_draft_unique UNIQUE (draft_id)
);

CREATE TABLE IF NOT EXISTS public.manebrain_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES public.platform_owner_authority(user_id) ON DELETE RESTRICT,
    actor_type text NOT NULL,
    actor_id text NOT NULL,
    event_type text NOT NULL,
    event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
    previous_hash char(64),
    entry_hash char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT manebrain_audit_hash_unique UNIQUE (owner_user_id, entry_hash)
);

CREATE INDEX IF NOT EXISTS manebrain_conversations_queue_idx
    ON public.manebrain_conversations (owner_user_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS manebrain_outbound_queue_idx
    ON public.manebrain_outbound_jobs (owner_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS manebrain_audit_time_idx
    ON public.manebrain_audit_log (owner_user_id, created_at, id);

DO $rls$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'platform_owner_authority',
        'manebrain_meta_assets',
        'manebrain_webhook_events',
        'manebrain_conversations',
        'manebrain_messages',
        'manebrain_reply_drafts',
        'manebrain_outbound_jobs',
        'manebrain_audit_log'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    END LOOP;
END
$rls$;

DROP POLICY IF EXISTS platform_owner_authority_isolation ON public.platform_owner_authority;
CREATE POLICY platform_owner_authority_isolation ON public.platform_owner_authority
FOR SELECT TO maneflow_app
USING (user_id = maneflow_private.current_platform_owner_id() AND revoked_at IS NULL);

DO $policies$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'manebrain_meta_assets',
        'manebrain_webhook_events',
        'manebrain_conversations',
        'manebrain_messages',
        'manebrain_reply_drafts',
        'manebrain_outbound_jobs',
        'manebrain_audit_log'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_owner_isolation', table_name);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO maneflow_app USING (owner_user_id = maneflow_private.current_platform_owner_id()) WITH CHECK (owner_user_id = maneflow_private.current_platform_owner_id())',
            table_name || '_owner_isolation',
            table_name
        );
    END LOOP;
END
$policies$;

REVOKE ALL ON TABLE
    public.platform_owner_authority,
    public.manebrain_meta_assets,
    public.manebrain_webhook_events,
    public.manebrain_conversations,
    public.manebrain_messages,
    public.manebrain_reply_drafts,
    public.manebrain_outbound_jobs,
    public.manebrain_audit_log
FROM PUBLIC;

GRANT SELECT ON public.platform_owner_authority TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.manebrain_meta_assets,
    public.manebrain_webhook_events,
    public.manebrain_conversations,
    public.manebrain_messages,
    public.manebrain_reply_drafts,
    public.manebrain_outbound_jobs
TO maneflow_app;
GRANT SELECT, INSERT ON public.manebrain_audit_log TO maneflow_app;
