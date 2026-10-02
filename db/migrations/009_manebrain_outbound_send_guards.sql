-- Send-time approval integrity and exact-target fencing for Meta outbound jobs.
-- This migration is additive. Applied migrations are intentionally left unchanged.

ALTER TABLE public.manebrain_reply_drafts
  ADD COLUMN IF NOT EXISTS target_provider_message_id text;

COMMENT ON COLUMN public.manebrain_reply_drafts.target_provider_message_id IS
  'Exact inbound provider message/comment ID captured when the owner approves this draft.';

CREATE OR REPLACE FUNCTION maneflow_private.prevent_meta_approval_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.approved_text IS DISTINCT FROM OLD.approved_text
     OR NEW.approved_text_sha256 IS DISTINCT FROM OLD.approved_text_sha256
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'Meta approval evidence is immutable after insert'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION maneflow_private.prevent_meta_approval_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maneflow_private.prevent_meta_approval_mutation() TO maneflow_app;

DROP TRIGGER IF EXISTS manebrain_outbound_approval_immutable
  ON public.manebrain_outbound_jobs;
CREATE TRIGGER manebrain_outbound_approval_immutable
BEFORE UPDATE ON public.manebrain_outbound_jobs
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.prevent_meta_approval_mutation();

CREATE OR REPLACE FUNCTION maneflow_private.prevent_meta_draft_target_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.target_provider_message_id IS NOT NULL
     AND NEW.target_provider_message_id IS DISTINCT FROM OLD.target_provider_message_id THEN
    RAISE EXCEPTION 'Approved Meta draft target is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION maneflow_private.prevent_meta_draft_target_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maneflow_private.prevent_meta_draft_target_mutation() TO maneflow_app;

DROP TRIGGER IF EXISTS manebrain_reply_draft_target_immutable
  ON public.manebrain_reply_drafts;
CREATE TRIGGER manebrain_reply_draft_target_immutable
BEFORE UPDATE ON public.manebrain_reply_drafts
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.prevent_meta_draft_target_mutation();

REVOKE DELETE ON TABLE public.manebrain_outbound_jobs FROM maneflow_app;
