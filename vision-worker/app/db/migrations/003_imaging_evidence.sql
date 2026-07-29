alter table if exists detected_items
    add column if not exists grouping_method text not null default 'unique',
    add column if not exists grouping_confidence numeric(5,4) not null default 1,
    add column if not exists crop_quality jsonb not null default '{}'::jsonb,
    add column if not exists detector_name text,
    add column if not exists identity_provider text,
    add column if not exists image_processed_remotely boolean not null default false,
    add column if not exists card_side text not null default 'unknown',
    add column if not exists is_trading_card boolean,
    add column if not exists barcode_values jsonb not null default '[]'::jsonb,
    add column if not exists visible_text jsonb not null default '[]'::jsonb;

alter table if exists lot_analysis_jobs
    add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create index if not exists detected_items_grouping_method_idx
    on detected_items(lot_job_id, grouping_method);
