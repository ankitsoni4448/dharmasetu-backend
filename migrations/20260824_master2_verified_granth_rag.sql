-- DharmaSetu Master Prompt 2: verified Granth retrieval corpus.
-- ADDITIVE MIGRATION ONLY. Review and run manually after preflight/backup.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table if not exists public.granth_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  canonical_title text not null,
  alternate_title text,
  author_editor text,
  tradition text,
  publisher text,
  edition text,
  publication_year integer,
  language text not null,
  script text,
  source_type text not null,
  provenance text,
  storage_path text,
  file_name text not null,
  file_hash text not null unique check (file_hash ~ '^[0-9a-f]{64}$'),
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 20971520),
  page_count integer check (page_count is null or page_count > 0),
  copyright_status text,
  verification_status text not null default 'UPLOADED'
    check (verification_status in ('UPLOADED','PROCESSING','REVIEW_REQUIRED','VERIFIED','REJECTED','ARCHIVED')),
  uploaded_at timestamptz not null default now(),
  uploaded_by text not null,
  reviewed_at timestamptz,
  reviewed_by text,
  notes text,
  extraction_tool text,
  extraction_version text,
  extraction_status text not null default 'PENDING'
    check (extraction_status in ('PENDING','PROCESSING','EXTRACTED','REVIEW_REQUIRED','FAILED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.granth_pages (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.granth_sources(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  original_text text,
  normalized_text text,
  ocr_confidence numeric check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  quality_flags jsonb not null default '[]'::jsonb,
  verification_status text not null default 'REVIEW_REQUIRED'
    check (verification_status in ('UPLOADED','PROCESSING','REVIEW_REQUIRED','VERIFIED','REJECTED','ARCHIVED')),
  unique (source_id, page_number)
);

create table if not exists public.granth_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.granth_sources(id) on delete cascade,
  page_id uuid references public.granth_pages(id) on delete set null,
  ordinal integer not null check (ordinal > 0),
  structure_type text not null default 'SECTION',
  chapter text,
  section text,
  verse text,
  heading text,
  page_number integer check (page_number is null or page_number > 0),
  language text,
  original_text text not null,
  normalized_text text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  extraction_confidence numeric check (extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 1)),
  extraction_provenance jsonb not null default '{}'::jsonb,
  quality_flags jsonb not null default '[]'::jsonb,
  verification_status text not null default 'REVIEW_REQUIRED'
    check (verification_status in ('UPLOADED','PROCESSING','REVIEW_REQUIRED','VERIFIED','REJECTED','ARCHIVED')),
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(normalized_text, ''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, ordinal)
);

create table if not exists public.granth_review_audit (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.granth_sources(id) on delete cascade,
  chunk_id uuid references public.granth_chunks(id) on delete set null,
  actor text not null,
  action text not null,
  previous_status text,
  new_status text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.curated_knowledge_artifacts (
  id uuid primary key default gen_random_uuid(),
  feedback_id text,
  question text not null,
  answer text not null,
  knowledge_class text not null check (knowledge_class in
    ('PRIMARY_SCRIPTURE','TRADITIONAL_COMMENTARY','EDITORIAL_CORRECTION','CURATED_EXPLANATION')),
  source_reference text,
  source_id uuid references public.granth_sources(id) on delete set null,
  verification_status text not null default 'REVIEW_REQUIRED'
    check (verification_status in ('REVIEW_REQUIRED','VERIFIED','REJECTED','ARCHIVED')),
  reviewed_by text not null,
  reviewed_at timestamptz not null,
  original_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (knowledge_class <> 'PRIMARY_SCRIPTURE' or (source_id is not null and nullif(btrim(source_reference), '') is not null))
);

create index if not exists granth_sources_status_idx on public.granth_sources (verification_status, canonical_title);
create index if not exists granth_chunks_source_status_idx on public.granth_chunks (source_id, verification_status, ordinal);
create index if not exists granth_chunks_search_idx on public.granth_chunks using gin (search_vector);
create index if not exists curated_knowledge_status_class_idx on public.curated_knowledge_artifacts (verification_status, knowledge_class, reviewed_at desc);

alter table public.granth_sources enable row level security;
alter table public.granth_sources force row level security;
alter table public.granth_pages enable row level security;
alter table public.granth_pages force row level security;
alter table public.granth_chunks enable row level security;
alter table public.granth_chunks force row level security;
alter table public.granth_review_audit enable row level security;
alter table public.granth_review_audit force row level security;
alter table public.curated_knowledge_artifacts enable row level security;
alter table public.curated_knowledge_artifacts force row level security;

revoke all on table public.granth_sources from public, anon, authenticated;
revoke all on table public.granth_pages from public, anon, authenticated;
revoke all on table public.granth_chunks from public, anon, authenticated;
revoke all on table public.granth_review_audit from public, anon, authenticated;
revoke all on table public.curated_knowledge_artifacts from public, anon, authenticated;
grant select, insert, update, delete on table public.granth_sources to service_role;
grant select, insert, update, delete on table public.granth_pages to service_role;
grant select, insert, update, delete on table public.granth_chunks to service_role;
grant select, insert on table public.granth_review_audit to service_role;
grant select, insert, update, delete on table public.curated_knowledge_artifacts to service_role;

create or replace function public.search_verified_granth_chunks(p_query text, p_limit integer default 6)
returns table (
  id uuid, source_id uuid, title text, canonical_title text, edition text,
  chapter text, section text, verse text, page_number integer, language text,
  original_text text, normalized_text text, verification_status text,
  source_verification_status text, rank real
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $function$
  select c.id, c.source_id, s.title, s.canonical_title, s.edition,
    c.chapter, c.section, c.verse, c.page_number, c.language,
    c.original_text, c.normalized_text, c.verification_status,
    s.verification_status, ts_rank_cd(c.search_vector, websearch_to_tsquery('simple', p_query))
  from public.granth_chunks c
  join public.granth_sources s on s.id = c.source_id
  where c.verification_status = 'VERIFIED'
    and s.verification_status = 'VERIFIED'
    and nullif(btrim(p_query), '') is not null
    and c.search_vector @@ websearch_to_tsquery('simple', p_query)
  order by rank desc, c.source_id, c.ordinal
  limit greatest(1, least(coalesce(p_limit, 6), 10));
$function$;

revoke all on function public.search_verified_granth_chunks(text, integer) from public, anon, authenticated;
grant execute on function public.search_verified_granth_chunks(text, integer) to service_role;

create or replace function public.replace_granth_extraction(
  p_source_id uuid, p_pages jsonb, p_chunks jsonb, p_tool text, p_version text
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_catalog
as $function$
begin
  if not exists (select 1 from public.granth_sources where id = p_source_id) then
    raise exception 'GRANTH_SOURCE_NOT_FOUND';
  end if;
  if jsonb_typeof(p_pages) <> 'array' or jsonb_array_length(p_pages) = 0
     or jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception 'GRANTH_EXTRACTION_EMPTY';
  end if;
  delete from public.granth_chunks where source_id = p_source_id;
  delete from public.granth_pages where source_id = p_source_id;
  insert into public.granth_pages (id, source_id, page_number, original_text, normalized_text, ocr_confidence, content_hash, quality_flags, verification_status)
  select gen_random_uuid(), p_source_id, x.page_number, x.original_text, x.normalized_text, x.ocr_confidence,
    x.content_hash, coalesce(x.quality_flags, '[]'::jsonb), 'REVIEW_REQUIRED'
  from jsonb_to_recordset(p_pages) as x(page_number integer, original_text text, normalized_text text,
    ocr_confidence numeric, content_hash text, quality_flags jsonb);
  insert into public.granth_chunks (id, source_id, ordinal, chapter, section, verse, heading, page_number, language,
    original_text, normalized_text, content_hash, extraction_confidence, extraction_provenance, quality_flags, verification_status)
  select gen_random_uuid(), p_source_id, x.ordinal, x.chapter, x.section, x.verse, x.heading, x.page_number, x.language,
    x.original_text, x.normalized_text, x.content_hash, x.extraction_confidence,
    coalesce(x.extraction_provenance, '{}'::jsonb), coalesce(x.quality_flags, '[]'::jsonb), 'REVIEW_REQUIRED'
  from jsonb_to_recordset(p_chunks) as x(ordinal integer, chapter text, section text, verse text, heading text,
    page_number integer, language text, original_text text, normalized_text text, content_hash text,
    extraction_confidence numeric, extraction_provenance jsonb, quality_flags jsonb);
  update public.granth_sources set extraction_status='REVIEW_REQUIRED', verification_status='REVIEW_REQUIRED',
    page_count=jsonb_array_length(p_pages), extraction_tool=p_tool, extraction_version=p_version, updated_at=now()
  where id=p_source_id;
  return true;
end;
$function$;

revoke all on function public.replace_granth_extraction(uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.replace_granth_extraction(uuid, jsonb, jsonb, text, text) to service_role;

commit;
