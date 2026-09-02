-- REVIEW AND APPLY THROUGH THE PROJECT'S NORMAL SUPABASE MIGRATION PROCESS.
-- Permanent, versioned Panchang cache; backend service-role access only.

create table if not exists public.panchang_daily_records (
  canonical_key text primary key,
  panchang_date date not null,
  location_key text not null,
  latitude numeric(6,3) not null check (latitude between -90 and 90),
  longitude numeric(7,3) not null check (longitude between -180 and 180),
  timezone text not null,
  ayanamsa text not null,
  calendar_convention text not null,
  provider text not null,
  provider_version text,
  calculation_version text not null,
  normalized_payload jsonb not null,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (panchang_date, location_key, timezone, ayanamsa, calendar_convention, provider, calculation_version)
);

create index if not exists panchang_daily_month_lookup_idx
  on public.panchang_daily_records
  (location_key, timezone, ayanamsa, calendar_convention, provider, calculation_version, panchang_date);

alter table public.panchang_daily_records enable row level security;
revoke all on table public.panchang_daily_records from anon, authenticated;
revoke all on table public.panchang_daily_records from service_role;
grant select, insert, update on table public.panchang_daily_records to service_role;

create table if not exists public.panchang_events (
  event_id text not null,
  occurrence_date date not null,
  event_type text not null,
  region_code text not null default 'GLOBAL',
  tradition_code text not null default 'GENERAL',
  importance smallint,
  source text not null,
  calendar_version text not null,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (event_id, occurrence_date, region_code, tradition_code, calendar_version)
);

create table if not exists public.panchang_event_content (
  event_id text not null,
  language_code text not null,
  name text not null,
  description text,
  significance text,
  vrat_puja_content jsonb,
  source text not null,
  content_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, language_code, content_version)
);

alter table public.panchang_events enable row level security;
alter table public.panchang_event_content enable row level security;
revoke all on table public.panchang_events, public.panchang_event_content from anon, authenticated;
revoke all on table public.panchang_events, public.panchang_event_content from service_role;
grant select, insert, update on table public.panchang_events, public.panchang_event_content to service_role;
