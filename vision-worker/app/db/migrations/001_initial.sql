create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists cards (
    id uuid primary key default gen_random_uuid(),
    year integer,
    brand text,
    set_name text,
    player_name text,
    card_number text,
    parallel text,
    serial_number text,
    sport text,
    grader text,
    grade text,
    cert_number text,
    aliases text[] not null default '{}',
    identity_embedding vector(1536),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists cards_player_name_idx on cards using gin (to_tsvector('english', coalesce(player_name, '')));
create index if not exists cards_identity_embedding_idx on cards using ivfflat (identity_embedding vector_cosine_ops) with (lists = 100);

create table if not exists historical_comps (
    id uuid primary key default gen_random_uuid(),
    card_id uuid references cards(id) on delete cascade,
    marketplace text not null,
    external_id text,
    title text,
    sold_price numeric(12,2) not null check (sold_price > 0),
    shipping_price numeric(12,2) not null default 0,
    sold_at timestamptz,
    currency char(3) not null default 'USD',
    verified boolean not null default false,
    duplicate_group text,
    raw_payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (marketplace, external_id)
);

create index if not exists historical_comps_card_sold_idx
    on historical_comps(card_id, sold_at desc);

create table if not exists active_listings (
    id uuid primary key default gen_random_uuid(),
    card_id uuid references cards(id) on delete cascade,
    marketplace text not null,
    external_id text,
    listing_price numeric(12,2) not null check (listing_price > 0),
    shipping_price numeric(12,2) not null default 0,
    url text,
    status text not null default 'active',
    raw_payload jsonb not null default '{}'::jsonb,
    observed_at timestamptz not null default now(),
    unique (marketplace, external_id)
);

create table if not exists scan_events (
    id uuid primary key,
    user_id uuid,
    image_url text,
    filename text,
    mime_type text,
    predicted_card_id uuid references cards(id) on delete set null,
    predicted_fields jsonb not null default '{}'::jsonb,
    identity_confidence numeric(5,4) not null default 0,
    pricing_status text not null,
    device_metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists corrections_queue (
    id uuid primary key,
    scan_id uuid references scan_events(id) on delete cascade,
    corrected_card_id uuid references cards(id) on delete set null,
    corrected_fields jsonb not null,
    notes text,
    status text not null default 'pending',
    reviewed_by uuid,
    reviewed_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists collection_items (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    card_id uuid references cards(id) on delete restrict,
    quantity integer not null default 1 check (quantity > 0),
    acquisition_cost numeric(12,2),
    acquired_at date,
    condition text,
    grading_status text,
    location text,
    notes text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists price_snapshots (
    id uuid primary key default gen_random_uuid(),
    card_id uuid references cards(id) on delete cascade,
    pricing_status text not null,
    value_low numeric(12,2),
    value_mid numeric(12,2),
    value_high numeric(12,2),
    confidence_score numeric(5,4) not null default 0,
    comp_count integer not null default 0,
    outliers_removed integer not null default 0,
    recommended_cash_offer_low numeric(12,2),
    recommended_cash_offer_high numeric(12,2),
    recommended_list_price numeric(12,2),
    source_window_start timestamptz,
    source_window_end timestamptz,
    metadata jsonb not null default '{}'::jsonb,
    calculated_at timestamptz not null default now()
);

create index if not exists price_snapshots_card_calculated_idx
    on price_snapshots(card_id, calculated_at desc);
