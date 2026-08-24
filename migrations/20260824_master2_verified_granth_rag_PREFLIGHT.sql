-- READ-ONLY. Run before the Master 2 Granth migration.
with required_tables(name) as (
  values ('granth_sources'),('granth_pages'),('granth_chunks'),('granth_review_audit'),('curated_knowledge_artifacts')
), existing as (
  select c.relname as name from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
)
select 'master2_tables' as check_name,
  case when count(e.name) = 0 then 'CLEAN_PRE_MIGRATION_STATE'
       when count(e.name) = count(*) then 'ALREADY_OR_PARTIALLY_MIGRATED'
       else 'PARTIAL_EXISTING_MIGRATION' end as status,
  string_agg(r.name || '=' || case when e.name is null then 'ABSENT' else 'EXISTS' end, ', ' order by r.name) as details
from required_tables r left join existing e using (name);

select 'conflicting_columns' as check_name,
  case when count(*) = 0 then 'PASS' else 'REVIEW_REQUIRED' end as status,
  coalesce(string_agg(table_name || '.' || column_name || ':' || data_type, ', ' order by table_name, ordinal_position), 'none') as details
from information_schema.columns
where table_schema = 'public'
  and table_name in ('granth_sources','granth_pages','granth_chunks','granth_review_audit','curated_knowledge_artifacts');

select 'search_rpc' as check_name,
  case when to_regprocedure('public.search_verified_granth_chunks(text,integer)') is null then 'ABSENT_EXPECTED' else 'EXISTS_REVIEW_SIGNATURE' end as status,
  coalesce(to_regprocedure('public.search_verified_granth_chunks(text,integer)')::text, 'not installed') as details;

select 'replace_extraction_rpc' as check_name,
  case when to_regprocedure('public.replace_granth_extraction(uuid,jsonb,jsonb,text,text)') is null then 'ABSENT_EXPECTED' else 'EXISTS_REVIEW_SIGNATURE' end as status,
  coalesce(to_regprocedure('public.replace_granth_extraction(uuid,jsonb,jsonb,text,text)')::text, 'not installed') as details;
