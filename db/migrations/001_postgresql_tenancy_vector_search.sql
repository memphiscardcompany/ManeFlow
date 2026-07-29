-- ManeFlow production migration
-- PostgreSQL 15+ and pgvector 0.8+
-- File: db/migrations/001_postgresql_tenancy_vector_search.sql


CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS maneflow_private;
REVOKE ALL ON SCHEMA maneflow_private FROM PUBLIC;

DO $role$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles
        WHERE rolname = 'maneflow_app'
    ) THEN
        CREATE ROLE maneflow_app
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            INHERIT
            NOBYPASSRLS;
    ELSE
        ALTER ROLE maneflow_app
            NOLOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            INHERIT
            NOBYPASSRLS;
    END IF;
END
$role$;

GRANT USAGE ON SCHEMA public TO maneflow_app;
GRANT USAGE ON SCHEMA maneflow_private TO maneflow_app;

DO $types$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'shop_status'
    ) THEN
        CREATE TYPE public.shop_status AS ENUM ('active', 'suspended', 'closed');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typname = 'inventory_status'
    ) THEN
        CREATE TYPE public.inventory_status AS ENUM (
            'available',
            'reserved',
            'listed',
            'sold',
            'consigned',
            'grading',
            'archived'
        );
    END IF;
END
$types$;

CREATE OR REPLACE FUNCTION maneflow_private.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION maneflow_private.current_shop_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
    SELECT NULLIF(current_setting('app.current_shop_id', true), '')::uuid;
$function$;

REVOKE ALL ON FUNCTION maneflow_private.touch_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION maneflow_private.current_shop_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maneflow_private.current_shop_id() TO maneflow_app;

CREATE TABLE IF NOT EXISTS public.shops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
    slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    status public.shop_status NOT NULL DEFAULT 'active',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT shops_slug_unique UNIQUE (slug),
    CONSTRAINT shops_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

DROP TRIGGER IF EXISTS shops_touch_updated_at ON public.shops;
CREATE TRIGGER shops_touch_updated_at
BEFORE UPDATE ON public.shops
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE INDEX IF NOT EXISTS shops_owner_user_id_idx
    ON public.shops (owner_user_id);

CREATE TABLE IF NOT EXISTS public.catalog_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_key text NOT NULL CHECK (length(btrim(canonical_key)) > 0),
    sport_or_game text NOT NULL CHECK (length(btrim(sport_or_game)) > 0),
    release_year smallint CHECK (release_year BETWEEN 1800 AND 2200),
    manufacturer text,
    brand text,
    set_name text NOT NULL CHECK (length(btrim(set_name)) > 0),
    set_code text,
    card_number text NOT NULL CHECK (length(btrim(card_number)) > 0),
    subject_name text NOT NULL CHECK (length(btrim(subject_name)) > 0),
    team_or_faction text,
    parallel_name text NOT NULL DEFAULT 'BASE',
    language_code text NOT NULL DEFAULT 'en' CHECK (language_code ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$'),
    serial_numbered_to integer CHECK (serial_numbered_to IS NULL OR serial_numbered_to > 0),
    is_rookie boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    source_namespace text,
    source_record_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_cards_canonical_key_unique UNIQUE (canonical_key),
    CONSTRAINT catalog_cards_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

DROP TRIGGER IF EXISTS catalog_cards_touch_updated_at ON public.catalog_cards;
CREATE TRIGGER catalog_cards_touch_updated_at
BEFORE UPDATE ON public.catalog_cards
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE INDEX IF NOT EXISTS catalog_cards_primary_lookup_idx
    ON public.catalog_cards (
        sport_or_game,
        release_year,
        set_name,
        card_number,
        parallel_name,
        language_code
    );

CREATE INDEX IF NOT EXISTS catalog_cards_subject_name_idx
    ON public.catalog_cards (lower(subject_name));

CREATE UNIQUE INDEX IF NOT EXISTS catalog_cards_source_identity_unique_idx
    ON public.catalog_cards (source_namespace, source_record_id)
    WHERE source_namespace IS NOT NULL
      AND source_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_cards_active_idx
    ON public.catalog_cards (id)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.catalog_card_embeddings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_card_id uuid NOT NULL
        REFERENCES public.catalog_cards (id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    model_name text NOT NULL CHECK (length(btrim(model_name)) > 0),
    model_version text NOT NULL CHECK (length(btrim(model_version)) > 0),
    front_vector vector(1152) NOT NULL,
    back_vector vector(1152),
    front_reference_uri text,
    back_reference_uri text,
    front_quality_score real NOT NULL DEFAULT 1.0
        CHECK (front_quality_score >= 0.0 AND front_quality_score <= 1.0),
    back_quality_score real
        CHECK (back_quality_score IS NULL OR (back_quality_score >= 0.0 AND back_quality_score <= 1.0)),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT catalog_card_embeddings_model_unique UNIQUE (
        catalog_card_id,
        model_name,
        model_version
    ),
    CONSTRAINT catalog_card_embeddings_front_nonzero CHECK (vector_norm(front_vector) > 0),
    CONSTRAINT catalog_card_embeddings_back_nonzero CHECK (
        back_vector IS NULL OR vector_norm(back_vector) > 0
    ),
    CONSTRAINT catalog_card_embeddings_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

DROP TRIGGER IF EXISTS catalog_card_embeddings_touch_updated_at
    ON public.catalog_card_embeddings;
CREATE TRIGGER catalog_card_embeddings_touch_updated_at
BEFORE UPDATE ON public.catalog_card_embeddings
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE INDEX IF NOT EXISTS catalog_card_embeddings_card_idx
    ON public.catalog_card_embeddings (catalog_card_id);

CREATE INDEX IF NOT EXISTS catalog_card_embeddings_model_idx
    ON public.catalog_card_embeddings (model_name, model_version);

CREATE INDEX IF NOT EXISTS catalog_card_embeddings_front_hnsw_cosine_idx
    ON public.catalog_card_embeddings
    USING hnsw (front_vector vector_cosine_ops)
    WITH (m = 16, ef_construction = 128);

CREATE INDEX IF NOT EXISTS catalog_card_embeddings_back_hnsw_cosine_idx
    ON public.catalog_card_embeddings
    USING hnsw (back_vector vector_cosine_ops)
    WITH (m = 16, ef_construction = 128)
    WHERE back_vector IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.shop_inventory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL
        REFERENCES public.shops (id)
        ON UPDATE RESTRICT
        ON DELETE CASCADE,
    catalog_card_id uuid
        REFERENCES public.catalog_cards (id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    sku text NOT NULL CHECK (length(btrim(sku)) BETWEEN 1 AND 128),
    external_reference text,
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    condition_code text NOT NULL CHECK (length(btrim(condition_code)) BETWEEN 1 AND 32),
    grader text,
    grade numeric(4, 1) CHECK (grade IS NULL OR (grade >= 0 AND grade <= 10)),
    certification_number text,
    acquisition_cost numeric(14, 2) CHECK (acquisition_cost IS NULL OR acquisition_cost >= 0),
    list_price numeric(14, 2) CHECK (list_price IS NULL OR list_price >= 0),
    currency_code char(3) NOT NULL DEFAULT 'USD' CHECK (currency_code ~ '^[A-Z]{3}$'),
    storage_location text,
    status public.inventory_status NOT NULL DEFAULT 'available',
    is_active boolean NOT NULL DEFAULT true,
    created_by_user_id uuid NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT shop_inventory_shop_sku_unique UNIQUE (shop_id, sku),
    CONSTRAINT shop_inventory_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

DROP TRIGGER IF EXISTS shop_inventory_touch_updated_at ON public.shop_inventory;
CREATE TRIGGER shop_inventory_touch_updated_at
BEFORE UPDATE ON public.shop_inventory
FOR EACH ROW
EXECUTE FUNCTION maneflow_private.touch_updated_at();

CREATE INDEX IF NOT EXISTS shop_inventory_shop_status_idx
    ON public.shop_inventory (shop_id, status, is_active);

CREATE INDEX IF NOT EXISTS shop_inventory_shop_catalog_idx
    ON public.shop_inventory (shop_id, catalog_card_id)
    WHERE catalog_card_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS shop_inventory_shop_location_idx
    ON public.shop_inventory (shop_id, storage_location)
    WHERE storage_location IS NOT NULL;

ALTER TABLE public.shop_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_inventory FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shop_inventory_tenant_isolation
    ON public.shop_inventory;

CREATE POLICY shop_inventory_tenant_isolation
ON public.shop_inventory
AS PERMISSIVE
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

REVOKE ALL ON TABLE public.shops FROM PUBLIC;
REVOKE ALL ON TABLE public.catalog_cards FROM PUBLIC;
REVOKE ALL ON TABLE public.catalog_card_embeddings FROM PUBLIC;
REVOKE ALL ON TABLE public.shop_inventory FROM PUBLIC;

GRANT SELECT ON TABLE public.shops TO maneflow_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.catalog_cards TO maneflow_app;
GRANT SELECT, INSERT, UPDATE ON TABLE public.catalog_card_embeddings TO maneflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_inventory TO maneflow_app;

COMMENT ON TABLE public.catalog_card_embeddings IS
    'Canonical ManeFlow image embeddings. Vectors are exactly 1152 dimensions and searched with cosine distance.';

COMMENT ON TABLE public.shop_inventory IS
    'Tenant-owned card inventory. RLS requires transaction-local app.current_shop_id and blocks cross-shop reads and writes.';

COMMENT ON ROLE maneflow_app IS
    'Restricted ManeFlow runtime role. It may log in after deployment assigns a password and must never have SUPERUSER or BYPASSRLS.';
