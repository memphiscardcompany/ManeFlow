ALTER TABLE public.manebrain_outbound_jobs
  ADD COLUMN IF NOT EXISTS provider_echo_at timestamptz;

CREATE INDEX IF NOT EXISTS manebrain_outbound_jobs_provider_echo_idx
  ON public.manebrain_outbound_jobs (owner_user_id, provider_echo_at DESC, id DESC)
  WHERE provider_echo_at IS NOT NULL;

COMMENT ON COLUMN public.manebrain_outbound_jobs.provider_echo_at IS
  'Timestamp of a signed Meta webhook echo matching the provider message ID. Provider acceptance remains distinct from echo observation.';
