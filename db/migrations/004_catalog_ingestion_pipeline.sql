-- ManeFlow 2.15: authorized catalog/reference ingestion and embedding work queue.

CREATE TABLE IF NOT EXISTS public.catalog_reference_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_card_id uuid NOT NULL REFERENCES public.catalog_cards(id) ON DELETE CASCADE,
    image_side text NOT NULL CHECK (image_side IN ('front', 'back', 'label', 'other')),
    source_namespace text NOT NULL CHECK (length(btrim(source_namespace)) BETWEEN 1 AND 100),
    source_record_id text,
    image_uri text NOT NULL CHECK (length(btrim(image_uri)) BETWEEN 1 AND 2048),
    image_sha256 text CHECK (image_sha256 IS NULL OR image_sha256 ~ '^[a-f0-9]{64}$'),
    mime_type text,
    width integer CHECK (width IS NULL OR width > 0),
    height integer CHECK (height IS NULL OR height > 0),
    authorization_basis text NOT NULL CHECK (length(btrim(authorization_basis)) BETWEEN 1 AND 200),
    commercial_use_allowed boolean NOT NULL DEFAULT false,
    training_use_allowed boolean NOT NULL DEFAULT false,
    canonical_display_allowed boolean NOT NULL DEFAULT false,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_reference_images_source_unique
        UNIQUE (source_namespace, image_uri)
);

DROP TRIGGER IF EXISTS catalog_reference_images_touch_updated_at ON public.catalog_reference_images;
CREATE TRIGGER catalog_reference_images_touch_updated_at
BEFORE UPDATE ON public.catalog_reference_images
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE INDEX IF NOT EXISTS catalog_reference_images_card_side_idx
    ON public.catalog_reference_images (catalog_card_id, image_side, created_at DESC);
CREATE INDEX IF NOT EXISTS catalog_reference_images_training_idx
    ON public.catalog_reference_images (catalog_card_id)
    WHERE training_use_allowed = true;

CREATE TABLE IF NOT EXISTS public.catalog_embedding_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_card_id uuid NOT NULL REFERENCES public.catalog_cards(id) ON DELETE CASCADE,
    reference_image_id uuid NOT NULL REFERENCES public.catalog_reference_images(id) ON DELETE CASCADE,
    model_name text NOT NULL CHECK (length(btrim(model_name)) BETWEEN 1 AND 128),
    model_version text NOT NULL CHECK (length(btrim(model_version)) BETWEEN 1 AND 128),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'leased', 'complete', 'failed', 'dead_letter')),
    priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text,
    last_error_message text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_embedding_queue_identity_unique
        UNIQUE (reference_image_id, model_name, model_version)
);

DROP TRIGGER IF EXISTS catalog_embedding_queue_touch_updated_at ON public.catalog_embedding_queue;
CREATE TRIGGER catalog_embedding_queue_touch_updated_at
BEFORE UPDATE ON public.catalog_embedding_queue
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE INDEX IF NOT EXISTS catalog_embedding_queue_work_idx
    ON public.catalog_embedding_queue (priority DESC, available_at, created_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS catalog_embedding_queue_lease_idx
    ON public.catalog_embedding_queue (lease_expires_at)
    WHERE status = 'leased';

CREATE TABLE IF NOT EXISTS public.catalog_sync_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_namespace text NOT NULL CHECK (length(btrim(source_namespace)) BETWEEN 1 AND 100),
    authorization_basis text NOT NULL CHECK (length(btrim(authorization_basis)) BETWEEN 1 AND 200),
    input_uri text,
    input_sha256 text CHECK (input_sha256 IS NULL OR input_sha256 ~ '^[a-f0-9]{64}$'),
    status text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'complete', 'failed', 'cancelled')),
    checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checkpoint) = 'object'),
    records_read bigint NOT NULL DEFAULT 0 CHECK (records_read >= 0),
    cards_upserted bigint NOT NULL DEFAULT 0 CHECK (cards_upserted >= 0),
    images_upserted bigint NOT NULL DEFAULT 0 CHECK (images_upserted >= 0),
    embedding_jobs_enqueued bigint NOT NULL DEFAULT 0 CHECK (embedding_jobs_enqueued >= 0),
    rejected_records bigint NOT NULL DEFAULT 0 CHECK (rejected_records >= 0),
    error_code text,
    error_message text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DROP TRIGGER IF EXISTS catalog_sync_jobs_touch_updated_at ON public.catalog_sync_jobs;
CREATE TRIGGER catalog_sync_jobs_touch_updated_at
BEFORE UPDATE ON public.catalog_sync_jobs
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE INDEX IF NOT EXISTS catalog_sync_jobs_source_started_idx
    ON public.catalog_sync_jobs (source_namespace, started_at DESC);

REVOKE ALL ON TABLE public.catalog_reference_images FROM PUBLIC;
REVOKE ALL ON TABLE public.catalog_embedding_queue FROM PUBLIC;
REVOKE ALL ON TABLE public.catalog_sync_jobs FROM PUBLIC;

GRANT SELECT ON TABLE public.catalog_reference_images TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.catalog_embedding_queue TO maneflow_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.catalog_sync_jobs TO maneflow_app;
