-- Durable, owner-isolated Meta outbox.
-- An ambiguous provider result is terminal DELIVERY_UNKNOWN. It is never
-- automatically retried because the provider may already have accepted it.

ALTER TABLE public.manebrain_outbound_jobs
    DROP CONSTRAINT IF EXISTS manebrain_outbound_jobs_status_check;

ALTER TABLE public.manebrain_outbound_jobs
    ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    ADD COLUMN IF NOT EXISTS lease_token uuid,
    ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_attempt_id uuid,
    ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS delivery_certainty text,
    ADD COLUMN IF NOT EXISTS sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS terminal_at timestamptz;

ALTER TABLE public.manebrain_outbound_jobs
    ADD CONSTRAINT manebrain_outbound_jobs_status_check
        CHECK (status IN (
            'HELD_POLICY_REVIEW',
            'SEND_QUEUED',
            'DISPATCHING',
            'RETRY_WAIT',
            'SENT',
            'SEND_FAILED',
            'DELIVERY_UNKNOWN',
            'DEAD_LETTER'
        )),
    ADD CONSTRAINT manebrain_outbound_attempt_limit_check
        CHECK (max_attempts BETWEEN 1 AND 20 AND attempts BETWEEN 0 AND max_attempts),
    ADD CONSTRAINT manebrain_outbound_lease_shape_check
        CHECK (
            (status = 'DISPATCHING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
            OR
            (status <> 'DISPATCHING' AND lease_token IS NULL AND lease_expires_at IS NULL)
        ),
    ADD CONSTRAINT manebrain_outbound_terminal_shape_check
        CHECK (
            (status = 'SENT'
                AND provider_message_id IS NOT NULL
                AND sent_at IS NOT NULL
                AND terminal_at IS NOT NULL
                AND delivery_certainty = 'accepted')
            OR
            (status = 'DELIVERY_UNKNOWN'
                AND terminal_at IS NOT NULL
                AND delivery_certainty = 'outcome_unknown')
            OR
            (status = 'DEAD_LETTER'
                AND terminal_at IS NOT NULL
                AND delivery_certainty = 'rejected_before_acceptance')
            OR
            status NOT IN ('SENT', 'DELIVERY_UNKNOWN', 'DEAD_LETTER')
        );

CREATE UNIQUE INDEX IF NOT EXISTS manebrain_outbound_provider_message_unique
    ON public.manebrain_outbound_jobs (provider_message_id)
    WHERE provider_message_id IS NOT NULL;

DROP INDEX IF EXISTS public.manebrain_outbound_queue_idx;
CREATE INDEX manebrain_outbound_queue_idx
    ON public.manebrain_outbound_jobs (owner_user_id, available_at, created_at)
    WHERE status IN ('SEND_QUEUED', 'RETRY_WAIT');

CREATE TABLE IF NOT EXISTS public.manebrain_outbound_attempts (
    id uuid PRIMARY KEY,
    owner_user_id uuid NOT NULL REFERENCES public.platform_owner_authority(user_id) ON DELETE RESTRICT,
    outbound_job_id uuid NOT NULL REFERENCES public.manebrain_outbound_jobs(id) ON DELETE RESTRICT,
    attempt_number integer NOT NULL CHECK (attempt_number > 0),
    lease_token uuid NOT NULL,
    state text NOT NULL DEFAULT 'DISPATCHING'
        CHECK (state IN ('DISPATCHING', 'ACCEPTED', 'REJECTED_BEFORE_ACCEPTANCE', 'OUTCOME_UNKNOWN')),
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    provider_message_id text,
    error_code text,
    response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_metadata) = 'object'),
    CONSTRAINT manebrain_outbound_attempt_number_unique UNIQUE (outbound_job_id, attempt_number),
    CONSTRAINT manebrain_outbound_attempt_lease_unique UNIQUE (outbound_job_id, lease_token),
    CONSTRAINT manebrain_outbound_attempt_completion_check CHECK (
        (state = 'DISPATCHING' AND completed_at IS NULL)
        OR
        (state <> 'DISPATCHING' AND completed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS manebrain_outbound_attempts_job_idx
    ON public.manebrain_outbound_attempts (owner_user_id, outbound_job_id, attempt_number DESC);

ALTER TABLE public.manebrain_outbound_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manebrain_outbound_attempts FORCE ROW LEVEL SECURITY;

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
        'manebrain_outbound_attempts',
        'manebrain_audit_log'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_owner_isolation', table_name);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO maneflow_app '
            || 'USING (owner_user_id = maneflow_private.current_platform_owner_id() '
            || 'AND EXISTS (SELECT 1 FROM public.platform_owner_authority AS authority '
            || 'WHERE authority.user_id = owner_user_id AND authority.revoked_at IS NULL)) '
            || 'WITH CHECK (owner_user_id = maneflow_private.current_platform_owner_id() '
            || 'AND EXISTS (SELECT 1 FROM public.platform_owner_authority AS authority '
            || 'WHERE authority.user_id = owner_user_id AND authority.revoked_at IS NULL))',
            table_name || '_owner_isolation',
            table_name
        );
    END LOOP;
END
$policies$;

REVOKE ALL ON TABLE public.manebrain_outbound_attempts FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.manebrain_outbound_attempts TO maneflow_app;
