-- ManeFlow operational tenancy and evidence migration
-- PostgreSQL 15+ / pgvector 0.8+


ALTER TABLE public.shops
    ADD COLUMN IF NOT EXISTS legacy_id text;
CREATE UNIQUE INDEX IF NOT EXISTS shops_legacy_id_unique_idx
    ON public.shops (legacy_id)
    WHERE legacy_id IS NOT NULL;

ALTER TABLE public.catalog_cards
    ADD COLUMN IF NOT EXISTS legacy_id text;
CREATE UNIQUE INDEX IF NOT EXISTS catalog_cards_legacy_id_unique_idx
    ON public.catalog_cards (legacy_id)
    WHERE legacy_id IS NOT NULL;

ALTER TABLE public.shop_inventory
    ADD COLUMN IF NOT EXISTS legacy_id text;
CREATE UNIQUE INDEX IF NOT EXISTS shop_inventory_shop_legacy_id_unique_idx
    ON public.shop_inventory (shop_id, legacy_id)
    WHERE legacy_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.app_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_id text UNIQUE,
    email text NOT NULL,
    display_name text NOT NULL,
    role text NOT NULL DEFAULT 'collector'
        CHECK (role IN ('collector', 'merchant', 'admin', 'service')),
    disabled_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT app_users_email_unique UNIQUE (email)
);

DROP TRIGGER IF EXISTS app_users_touch_updated_at ON public.app_users;
CREATE TRIGGER app_users_touch_updated_at
BEFORE UPDATE ON public.app_users
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.shop_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('viewer', 'staff', 'manager', 'owner')),
    revoked_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT shop_members_unique_active UNIQUE (shop_id, user_id)
);

DROP TRIGGER IF EXISTS shop_members_touch_updated_at ON public.shop_members;
CREATE TRIGGER shop_members_touch_updated_at
BEFORE UPDATE ON public.shop_members
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE INDEX IF NOT EXISTS shop_members_user_idx
    ON public.shop_members (user_id, revoked_at);

ALTER TABLE public.shop_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shop_members_tenant_isolation ON public.shop_members;
CREATE POLICY shop_members_tenant_isolation
ON public.shop_members
FOR ALL
TO maneflow_app
USING (
    maneflow_private.current_shop_id() IS NOT NULL
    AND shop_id = maneflow_private.current_shop_id()
)
WITH CHECK (
    maneflow_private.current_shop_id() IS NOT NULL
    AND shop_id = maneflow_private.current_shop_id()
);

CREATE TABLE IF NOT EXISTS public.price_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,
    catalog_card_id uuid NOT NULL REFERENCES public.catalog_cards(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 80),
    provider_record_id text,
    evidence_type text NOT NULL
        CHECK (evidence_type IN ('verified_sale', 'active_listing', 'price_guide', 'manual_review')),
    title text,
    amount numeric(14, 2) NOT NULL CHECK (amount > 0),
    shipping_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
    currency_code char(3) NOT NULL DEFAULT 'USD' CHECK (currency_code ~ '^[A-Z]{3}$'),
    occurred_at timestamptz,
    verified boolean NOT NULL DEFAULT false,
    valuation_use boolean NOT NULL DEFAULT false,
    duplicate_group text,
    authorization_basis text NOT NULL,
    raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(raw_payload) = 'object'),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT price_evidence_provider_record_unique UNIQUE (provider, provider_record_id),
    CONSTRAINT price_evidence_verified_sale_guard CHECK (
        evidence_type <> 'verified_sale'
        OR (verified = true AND occurred_at IS NOT NULL)
    ),
    CONSTRAINT price_evidence_valuation_guard CHECK (
        valuation_use = false
        OR (evidence_type = 'verified_sale' AND verified = true AND occurred_at IS NOT NULL)
    )
);

DROP TRIGGER IF EXISTS price_evidence_touch_updated_at ON public.price_evidence;
CREATE TRIGGER price_evidence_touch_updated_at
BEFORE UPDATE ON public.price_evidence
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE INDEX IF NOT EXISTS price_evidence_card_time_idx
    ON public.price_evidence (catalog_card_id, occurred_at DESC)
    WHERE evidence_type = 'verified_sale' AND verified = true;
CREATE INDEX IF NOT EXISTS price_evidence_shop_idx
    ON public.price_evidence (shop_id, created_at DESC)
    WHERE shop_id IS NOT NULL;

ALTER TABLE public.price_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_evidence_read_policy ON public.price_evidence;
CREATE POLICY price_evidence_read_policy
ON public.price_evidence
FOR SELECT
TO maneflow_app
USING (
    shop_id IS NULL
    OR (
        maneflow_private.current_shop_id() IS NOT NULL
        AND shop_id = maneflow_private.current_shop_id()
    )
);
DROP POLICY IF EXISTS price_evidence_insert_policy ON public.price_evidence;
CREATE POLICY price_evidence_insert_policy
ON public.price_evidence
FOR INSERT
TO maneflow_app
WITH CHECK (
    maneflow_private.current_shop_id() IS NOT NULL
    AND shop_id = maneflow_private.current_shop_id()
);

DROP POLICY IF EXISTS price_evidence_update_policy ON public.price_evidence;
CREATE POLICY price_evidence_update_policy
ON public.price_evidence
FOR UPDATE
TO maneflow_app
USING (
    maneflow_private.current_shop_id() IS NOT NULL
    AND shop_id = maneflow_private.current_shop_id()
)
WITH CHECK (
    maneflow_private.current_shop_id() IS NOT NULL
    AND shop_id = maneflow_private.current_shop_id()
);

DROP POLICY IF EXISTS price_evidence_delete_policy ON public.price_evidence;
CREATE POLICY price_evidence_delete_policy
ON public.price_evidence
FOR DELETE
TO maneflow_app
USING (
    maneflow_private.current_shop_id() IS NOT NULL
    AND shop_id = maneflow_private.current_shop_id()
);

CREATE TABLE IF NOT EXISTS public.recognition_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    created_by_user_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'detecting', 'ocr', 'embedding', 'retrieving', 'reranking', 'review', 'complete', 'failed')),
    source_type text NOT NULL,
    source_uri text,
    item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
    error_code text,
    error_message text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

DROP TRIGGER IF EXISTS recognition_jobs_touch_updated_at ON public.recognition_jobs;
CREATE TRIGGER recognition_jobs_touch_updated_at
BEFORE UPDATE ON public.recognition_jobs
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

ALTER TABLE public.recognition_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recognition_jobs_tenant_isolation ON public.recognition_jobs;
CREATE POLICY recognition_jobs_tenant_isolation
ON public.recognition_jobs
FOR ALL
TO maneflow_app
USING (
    maneflow_private.current_shop_id() IS NOT NULL
    AND shop_id = maneflow_private.current_shop_id()
)
WITH CHECK (
    maneflow_private.current_shop_id() IS NOT NULL
    AND shop_id = maneflow_private.current_shop_id()
);

CREATE TABLE IF NOT EXISTS public.recognition_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recognition_job_id uuid NOT NULL REFERENCES public.recognition_jobs(id) ON DELETE CASCADE,
    shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    region_id text NOT NULL,
    evidence_type text NOT NULL,
    confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS recognition_evidence_job_region_idx
    ON public.recognition_evidence (recognition_job_id, region_id, evidence_type);

ALTER TABLE public.recognition_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recognition_evidence FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recognition_evidence_tenant_isolation ON public.recognition_evidence;
CREATE POLICY recognition_evidence_tenant_isolation
ON public.recognition_evidence
FOR ALL
TO maneflow_app
USING (
    maneflow_private.current_shop_id() IS NOT NULL
    AND shop_id = maneflow_private.current_shop_id()
)
WITH CHECK (
    maneflow_private.current_shop_id() IS NOT NULL
    AND shop_id = maneflow_private.current_shop_id()
);

CREATE TABLE IF NOT EXISTS public.oauth_state_nonces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    state_hash text NOT NULL UNIQUE,
    user_id uuid,
    shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,
    redirect_uri text,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT oauth_state_expiry_guard CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS oauth_state_expiry_idx
    ON public.oauth_state_nonces (expires_at)
    WHERE consumed_at IS NULL;

REVOKE ALL ON TABLE public.app_users FROM PUBLIC;
REVOKE ALL ON TABLE public.shop_members FROM PUBLIC;
REVOKE ALL ON TABLE public.price_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.recognition_jobs FROM PUBLIC;
REVOKE ALL ON TABLE public.recognition_evidence FROM PUBLIC;
REVOKE ALL ON TABLE public.oauth_state_nonces FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_users TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_members TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.price_evidence TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recognition_jobs TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recognition_evidence TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_state_nonces TO maneflow_app;
