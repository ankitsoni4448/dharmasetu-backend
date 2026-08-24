-- READ-ONLY. Run after the Master 2 Granth migration.
with required_tables(name) as (
  values ('granth_sources'),('granth_pages'),('granth_chunks'),('granth_review_audit'),('curated_knowledge_artifacts')
)
select 'required_tables' as check_name,
  case when bool_and(to_regclass('public.' || name) is not null) then 'PASS' else 'FAIL' end as status,
  string_agg(name || '=' || coalesce(to_regclass('public.' || name)::text, 'ABSENT'), ', ' order by name) as details
from required_tables;

select 'rls_and_force_rls' as check_name,
  case when count(*) = 5 and bool_and(c.relrowsecurity and c.relforcerowsecurity) then 'PASS' else 'FAIL' end as status,
  string_agg(c.relname || ':rls=' || c.relrowsecurity || ':force=' || c.relforcerowsecurity, ', ' order by c.relname) as details
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('granth_sources','granth_pages','granth_chunks','granth_review_audit','curated_knowledge_artifacts');

select 'client_table_privileges' as check_name,
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  coalesce(string_agg(grantee || ':' || table_name || ':' || privilege_type, ', ' order by grantee, table_name, privilege_type), 'none') as details
from information_schema.role_table_grants
where table_schema = 'public' and (table_name like 'granth_%' or table_name = 'curated_knowledge_artifacts')
  and grantee in ('anon','authenticated','PUBLIC');

select 'search_rpc_permissions' as check_name,
  case when to_regprocedure('public.search_verified_granth_chunks(text,integer)') is not null
    and not has_function_privilege('anon','public.search_verified_granth_chunks(text,integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.search_verified_granth_chunks(text,integer)','EXECUTE')
    and has_function_privilege('service_role','public.search_verified_granth_chunks(text,integer)','EXECUTE')
    then 'PASS' else 'FAIL' end as status,
  'anon/authenticated denied; service_role required' as details;

select 'replace_extraction_rpc_permissions' as check_name,
  case when to_regprocedure('public.replace_granth_extraction(uuid,jsonb,jsonb,text,text)') is not null
    and not has_function_privilege('anon','public.replace_granth_extraction(uuid,jsonb,jsonb,text,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.replace_granth_extraction(uuid,jsonb,jsonb,text,text)','EXECUTE')
    and has_function_privilege('service_role','public.replace_granth_extraction(uuid,jsonb,jsonb,text,text)','EXECUTE')
    then 'PASS' else 'FAIL' end as status,
  'transactional extraction replacement is service_role-only' as details;

select 'verified_retrieval_scope' as check_name,
  case when exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='search_verified_granth_chunks'
      and pg_get_functiondef(p.oid) like '%c.verification_status = ''VERIFIED''%'
      and pg_get_functiondef(p.oid) like '%s.verification_status = ''VERIFIED''%'
  ) then 'PASS' else 'FAIL' end as status,
  'both source and chunk must be VERIFIED' as details;
