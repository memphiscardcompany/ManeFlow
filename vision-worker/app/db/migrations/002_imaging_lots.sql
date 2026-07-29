create table if not exists scanner_profiles (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid,
    name text not null,
    scanner_model text,
    source_type text not null default 'camera',
    dpi integer not null default 300,
    duplex boolean not null default false,
    auto_crop boolean not null default true,
    auto_rotate boolean not null default true,
    brightness integer not null default 0,
    contrast integer not null default 0,
    threshold_settings jsonb not null default '{}'::jsonb,
    container_preset text not null default 'mixed',
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists scan_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid,
    scanner_profile_id uuid references scanner_profiles(id) on delete set null,
    source_type text not null,
    status text not null default 'open',
    pairing_mode text not null default 'automatic',
    device_metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create table if not exists scan_session_images (
    id uuid primary key default gen_random_uuid(),
    scan_session_id uuid not null references scan_sessions(id) on delete cascade,
    pair_key text,
    side text not null default 'unknown',
    sequence_number integer,
    image_url text,
    checksum text,
    perceptual_hash text,
    quality_metrics jsonb not null default '{}'::jsonb,
    processing_status text not null default 'queued',
    created_at timestamptz not null default now()
);

create table if not exists lot_analysis_jobs (
    id uuid primary key,
    user_id uuid,
    source_type text not null,
    source_url text,
    listing_price numeric(12,2) not null default 0,
    inbound_shipping numeric(12,2) not null default 0,
    sales_tax numeric(12,2) not null default 0,
    status text not null default 'queued',
    assumptions jsonb not null default '{}'::jsonb,
    economics jsonb not null default '{}'::jsonb,
    warnings jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create table if not exists lot_source_images (
    id uuid primary key,
    lot_job_id uuid not null references lot_analysis_jobs(id) on delete cascade,
    image_url text,
    source_order integer not null,
    filename text,
    checksum text,
    perceptual_hash text,
    quality_metrics jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists detected_items (
    id uuid primary key,
    lot_job_id uuid not null references lot_analysis_jobs(id) on delete cascade,
    source_image_id uuid not null references lot_source_images(id) on delete cascade,
    physical_item_group text not null,
    instance_index integer not null,
    object_kind text not null default 'unknown_card_object',
    bounding_box jsonb not null,
    polygon jsonb not null,
    crop_image_url text,
    fingerprint text,
    detection_confidence numeric(5,4) not null default 0,
    visibility_fraction numeric(5,4) not null default 0,
    processing_status text not null default 'detected',
    created_at timestamptz not null default now()
);

create index if not exists detected_items_lot_group_idx
    on detected_items(lot_job_id, physical_item_group);

create table if not exists identity_candidates (
    id uuid primary key default gen_random_uuid(),
    detected_item_id uuid not null references detected_items(id) on delete cascade,
    card_id uuid references cards(id) on delete set null,
    rank integer not null,
    identity_score numeric(5,4) not null default 0,
    variant_score numeric(5,4) not null default 0,
    evidence jsonb not null default '{}'::jsonb,
    model_version text,
    created_at timestamptz not null default now()
);

create table if not exists item_relationships (
    id uuid primary key default gen_random_uuid(),
    lot_job_id uuid not null references lot_analysis_jobs(id) on delete cascade,
    source_item_id uuid not null references detected_items(id) on delete cascade,
    target_item_id uuid not null references detected_items(id) on delete cascade,
    relationship_type text not null,
    confidence numeric(5,4) not null default 0,
    evidence jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique(source_item_id, target_item_id, relationship_type)
);

create table if not exists recognition_evidence (
    id uuid primary key default gen_random_uuid(),
    detected_item_id uuid not null references detected_items(id) on delete cascade,
    evidence_type text not null,
    field_name text,
    extracted_value text,
    confidence numeric(5,4) not null default 0,
    bounding_region jsonb,
    source text,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists recognition_model_versions (
    id uuid primary key default gen_random_uuid(),
    component text not null,
    version text not null,
    provider text,
    config jsonb not null default '{}'::jsonb,
    evaluation_metrics jsonb not null default '{}'::jsonb,
    active boolean not null default false,
    created_at timestamptz not null default now(),
    unique(component, version)
);

create table if not exists listing_opportunities (
    id uuid primary key default gen_random_uuid(),
    lot_job_id uuid not null references lot_analysis_jobs(id) on delete cascade,
    conservative_gross_value numeric(12,2),
    expected_gross_value numeric(12,2),
    optimistic_gross_value numeric(12,2),
    expected_net_resale numeric(12,2),
    expected_profit numeric(12,2),
    expected_roi numeric(8,4),
    recommended_max_purchase numeric(12,2),
    decision text,
    assumptions jsonb not null default '{}'::jsonb,
    calculated_at timestamptz not null default now()
);
