-- ManeFlow migration 003: transactional compatibility state
-- This table supports a controlled migration away from local flat files while
-- domain records are progressively normalized into dedicated relational tables.

CREATE TABLE IF NOT EXISTS public.maneflow_application_state (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

REVOKE ALL ON TABLE public.maneflow_application_state FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.maneflow_application_state TO maneflow_app;
