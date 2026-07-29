-- ManeFlow async recognition DAG
-- PostgreSQL 15+ / pgvector 0.8+
-- Extends the existing recognition_jobs table and existing HNSW vector indexes.

ALTER TABLE public.recognition_jobs
    ADD COLUMN IF NOT EXISTS idempotency_key text,
    ADD COLUMN IF NOT EXISTS policy_version text,
    ADD COLUMN IF NOT EXISTS embedding_model_name text,
    ADD COLUMN IF NOT EXISTS embedding_model_version text,
    ADD COLUMN IF NOT EXISTS total_assets integer NOT NULL DEFAULT 0 CHECK (total_assets >= 0),
    ADD COLUMN IF NOT EXISTS total_crops integer NOT NULL DEFAULT 0 CHECK (total_crops >= 0),
    ADD COLUMN IF NOT EXISTS completed_crops integer NOT NULL DEFAULT 0 CHECK (completed_crops >= 0),
    ADD COLUMN IF NOT EXISTS unresolved_crops integer NOT NULL DEFAULT 0 CHECK (unresolved_crops >= 0),
    ADD COLUMN IF NOT EXISTS rejected_assets integer NOT NULL DEFAULT 0 CHECK (rejected_assets >= 0),
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS recognition_jobs_shop_idempotency_unique_idx
    ON public.recognition_jobs (shop_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.recognition_jobs
    DROP CONSTRAINT IF EXISTS recognition_jobs_status_check;
ALTER TABLE public.recognition_jobs
    ADD CONSTRAINT recognition_jobs_status_check CHECK (
        status IN (
            'received', 'queued', 'detecting', 'normalizing', 'parallel_evidence',
            'ocr', 'embedding', 'retrieving', 'reranking', 'adjudicating',
            'pricing', 'review', 'complete', 'failed', 'cancelled'
        )
    );

CREATE TABLE IF NOT EXISTS public.recognition_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recognition_job_id uuid NOT NULL REFERENCES public.recognition_jobs(id) ON DELETE CASCADE,
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    source_index integer NOT NULL CHECK (source_index >= 0),
    source_type text NOT NULL CHECK (source_type IN ('camera', 'photos', 'files', 'folder', 'drag_drop', 'scanner', 'api')),
    original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[a-f0-9]{64}$'),
    normalized_sha256 text CHECK (normalized_sha256 IS NULL OR normalized_sha256 ~ '^[a-f0-9]{64}$'),
    storage_uri text NOT NULL CHECK (length(btrim(storage_uri)) BETWEEN 1 AND 2048),
    mime_type text NOT NULL,
    width integer CHECK (width IS NULL OR width > 0),
    height integer CHECK (height IS NULL OR height > 0),
    status text NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'decoded', 'detected', 'rejected', 'failed', 'cancelled')),
    quality jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(quality) = 'object'),
    error_code text,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT recognition_assets_job_source_unique UNIQUE (recognition_job_id, source_index),
    CONSTRAINT recognition_assets_job_hash_unique UNIQUE (recognition_job_id, original_sha256)
);

DROP TRIGGER IF EXISTS recognition_assets_touch_updated_at ON public.recognition_assets;
CREATE TRIGGER recognition_assets_touch_updated_at
BEFORE UPDATE ON public.recognition_assets
FOR EACH ROW EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.recognition_crops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recognition_job_id uuid NOT NULL REFERENCES public.recognition_jobs(id) ON DELETE CASCADE,
    recognition_asset_id uuid NOT NULL REFERENCES public.recognition_assets(id) ON DELETE CASCADE,
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    crop_index integer NOT NULL CHECK (crop_index >= 0),
    object_type text NOT NULL,
    detector_model_name text,
    detector_model_version text,
    detector_confidence real NOT NULL CHECK (detector_confidence >= 0 AND detector_confidence <= 1),
    bounding_box jsonb NOT NULL CHECK (jsonb_typeof(bounding_box) = 'object'),
    normalized_storage_uri text,
    normalized_sha256 text CHECK (normalized_sha256 IS NULL OR normalized_sha256 ~ '^[a-f0-9]{64}$'),
    status text NOT NULL DEFAULT 'detected'
        CHECK (status IN ('detected', 'normalized', 'processing', 'review', 'complete', 'rejected', 'failed', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT recognition_crops_asset_index_unique UNIQUE (recognition_asset_id, crop_index)
);

DROP TRIGGER IF EXISTS recognition_crops_touch_updated_at ON public.recognition_crops;
CREATE TRIGGER recognition_crops_touch_updated_at
BEFORE UPDATE ON public.recognition_crops
FOR EACH ROW EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.recognition_work_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recognition_job_id uuid NOT NULL REFERENCES public.recognition_jobs(id) ON DELETE CASCADE,
    recognition_asset_id uuid REFERENCES public.recognition_assets(id) ON DELETE CASCADE,
    recognition_crop_id uuid REFERENCES public.recognition_crops(id) ON DELETE CASCADE,
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    task_type text NOT NULL CHECK (task_type IN (
        'detect', 'normalize_crop', 'ocr', 'embed', 'retrieve',
        'rerank', 'adjudicate', 'price'
    )),
    scope_type text NOT NULL CHECK (scope_type IN ('job', 'asset', 'crop')),
    scope_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'leased', 'retry_wait', 'complete', 'failed',
        'dead_letter', 'skipped', 'cancelled'
    )),
    priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    lease_owner text,
    lease_expires_at timestamptz,
    heartbeat_at timestamptz,
    idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
    input_fingerprint text CHECK (input_fingerprint IS NULL OR input_fingerprint ~ '^[a-f0-9]{64}$'),
    model_name text,
    model_version text,
    policy_version text NOT NULL,
    output jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(output) = 'object'),
    error_code text,
    error_message text,
    metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT recognition_work_items_idempotency_unique UNIQUE (shop_id, idempotency_key)
);

DROP TRIGGER IF EXISTS recognition_work_items_touch_updated_at ON public.recognition_work_items;
CREATE TRIGGER recognition_work_items_touch_updated_at
BEFORE UPDATE ON public.recognition_work_items
FOR EACH ROW EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.recognition_work_dependencies (
    parent_work_item_id uuid NOT NULL REFERENCES public.recognition_work_items(id) ON DELETE CASCADE,
    child_work_item_id uuid NOT NULL REFERENCES public.recognition_work_items(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (parent_work_item_id, child_work_item_id),
    CONSTRAINT recognition_work_dependency_no_self CHECK (parent_work_item_id <> child_work_item_id)
);

CREATE TABLE IF NOT EXISTS public.recognition_candidates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recognition_job_id uuid NOT NULL REFERENCES public.recognition_jobs(id) ON DELETE CASCADE,
    recognition_crop_id uuid NOT NULL REFERENCES public.recognition_crops(id) ON DELETE CASCADE,
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    catalog_card_id uuid NOT NULL REFERENCES public.catalog_cards(id) ON DELETE CASCADE,
    rank integer NOT NULL CHECK (rank >= 1),
    vector_similarity real CHECK (vector_similarity IS NULL OR (vector_similarity >= 0 AND vector_similarity <= 1)),
    ocr_score real CHECK (ocr_score IS NULL OR (ocr_score >= 0 AND ocr_score <= 1)),
    rerank_score real NOT NULL CHECK (rerank_score >= 0 AND rerank_score <= 1),
    exact_field_matches jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(exact_field_matches) = 'array'),
    conflicts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conflicts) = 'array'),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT recognition_candidates_crop_rank_unique UNIQUE (recognition_crop_id, rank),
    CONSTRAINT recognition_candidates_crop_card_unique UNIQUE (recognition_crop_id, catalog_card_id)
);

CREATE TABLE IF NOT EXISTS public.recognition_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recognition_job_id uuid NOT NULL REFERENCES public.recognition_jobs(id) ON DELETE CASCADE,
    recognition_crop_id uuid NOT NULL REFERENCES public.recognition_crops(id) ON DELETE CASCADE,
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    selected_catalog_card_id uuid REFERENCES public.catalog_cards(id) ON DELETE SET NULL,
    decision_level text NOT NULL CHECK (decision_level IN (
        'official_verified', 'exact_variant', 'card_family', 'candidate',
        'unresolved', 'insufficient_evidence', 'non_card'
    )),
    calibrated_confidence real NOT NULL CHECK (calibrated_confidence >= 0 AND calibrated_confidence <= 1),
    needs_confirmation boolean NOT NULL DEFAULT true,
    withheld_fields jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(withheld_fields) = 'array'),
    conflicts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conflicts) = 'array'),
    decision_reason text NOT NULL,
    model_manifest jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(model_manifest) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT recognition_decisions_crop_unique UNIQUE (recognition_crop_id)
);

DROP TRIGGER IF EXISTS recognition_decisions_touch_updated_at ON public.recognition_decisions;
CREATE TRIGGER recognition_decisions_touch_updated_at
BEFORE UPDATE ON public.recognition_decisions
FOR EACH ROW EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE INDEX IF NOT EXISTS recognition_assets_job_status_idx
    ON public.recognition_assets (recognition_job_id, status, source_index);
CREATE INDEX IF NOT EXISTS recognition_crops_job_status_idx
    ON public.recognition_crops (recognition_job_id, status, crop_index);
CREATE INDEX IF NOT EXISTS recognition_work_items_ready_idx
    ON public.recognition_work_items (priority DESC, available_at, created_at)
    WHERE status IN ('pending', 'retry_wait');
CREATE INDEX IF NOT EXISTS recognition_work_items_lease_idx
    ON public.recognition_work_items (lease_expires_at)
    WHERE status = 'leased';
CREATE INDEX IF NOT EXISTS recognition_work_items_job_idx
    ON public.recognition_work_items (recognition_job_id, task_type, status);
CREATE INDEX IF NOT EXISTS recognition_work_dependencies_child_idx
    ON public.recognition_work_dependencies (child_work_item_id);
CREATE INDEX IF NOT EXISTS recognition_candidates_crop_score_idx
    ON public.recognition_candidates (recognition_crop_id, rerank_score DESC);
CREATE INDEX IF NOT EXISTS recognition_decisions_job_idx
    ON public.recognition_decisions (recognition_job_id, decision_level);

ALTER TABLE public.recognition_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_crops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_crops FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_work_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_decisions FORCE ROW LEVEL SECURITY;

DO $policies$
DECLARE table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'recognition_assets', 'recognition_crops', 'recognition_work_items',
        'recognition_candidates', 'recognition_decisions'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON public.%I', table_name, table_name);
        EXECUTE format(
            'CREATE POLICY %I_tenant_isolation ON public.%I FOR ALL TO maneflow_app USING (maneflow_private.current_shop_id() IS NOT NULL AND shop_id = maneflow_private.current_shop_id()) WITH CHECK (maneflow_private.current_shop_id() IS NOT NULL AND shop_id = maneflow_private.current_shop_id())',
            table_name, table_name
        );
    END LOOP;
END
$policies$;

REVOKE ALL ON TABLE public.recognition_assets FROM PUBLIC;
REVOKE ALL ON TABLE public.recognition_crops FROM PUBLIC;
REVOKE ALL ON TABLE public.recognition_work_items FROM PUBLIC;
REVOKE ALL ON TABLE public.recognition_work_dependencies FROM PUBLIC;
REVOKE ALL ON TABLE public.recognition_candidates FROM PUBLIC;
REVOKE ALL ON TABLE public.recognition_decisions FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recognition_assets TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recognition_crops TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recognition_work_items TO maneflow_app;
GRANT SELECT, INSERT, DELETE ON TABLE public.recognition_work_dependencies TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recognition_candidates TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recognition_decisions TO maneflow_app;
