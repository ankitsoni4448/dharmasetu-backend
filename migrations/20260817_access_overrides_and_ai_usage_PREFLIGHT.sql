-- READ-ONLY. Run before the migration. It reports compatibility and changes nothing.

select 'object_presence' as section,
       case when to_regclass('public.users') is null then 'MISSING' else 'FOUND' end as status,
       'public.users' as object_name,
       to_regclass('public.users')::text as observed;

select 'object_presence' as section,
       case when to_regclass(v.object_name) is null then 'NOT_PRESENT' else 'FOUND' end as status,
       v.object_name,
       to_regclass(v.object_name)::text as observed
from (values ('public.ai_daily_usage'),('public.ai_usage_reservations')) v(object_name)
order by v.object_name;

select 'users_columns' as section,'FOUND' as status,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name='users'
  and column_name in ('id','plan','admin_override','admin_override_expires_at',
    'admin_override_reason','admin_override_updated_at')
order by column_name;

-- query_to_xml evaluates the diagnostic SELECT only when public.users exists.
-- The inner query uses to_jsonb, so a missing admin_override column is harmless.
select 'admin_override_data' as section,
       case when to_regclass('public.users') is null then 'SKIPPED_USERS_TABLE_MISSING' else 'INSPECTED' end as status,
       case when to_regclass('public.users') is null then null
            else query_to_xml($query$
              select
                count(*) filter(where to_jsonb(u)->>'admin_override' is null) as null_overrides,
                count(*) filter(where btrim(coalesce(to_jsonb(u)->>'admin_override',''))=''
                  and to_jsonb(u)->>'admin_override' is not null) as empty_overrides,
                count(*) filter(where lower(btrim(to_jsonb(u)->>'admin_override')) in ('basic','pro','full')) as valid_overrides,
                count(*) filter(where to_jsonb(u)->>'admin_override' is not null
                  and btrim(to_jsonb(u)->>'admin_override')<>''
                  and lower(btrim(to_jsonb(u)->>'admin_override')) not in ('basic','pro','full')) as invalid_overrides
              from public.users u
            $query$,false,true,'')::text
       end as diagnostic;

select 'quota_columns' as section,'FOUND' as status,
       table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in ('ai_daily_usage','ai_usage_reservations')
order by table_name,ordinal_position;

select 'quota_constraints' as section,'FOUND' as status,
       c.conrelid::regclass as table_name,c.conname,c.contype,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where (to_regclass('public.ai_daily_usage') is not null
       and c.conrelid=to_regclass('public.ai_daily_usage'))
   or (to_regclass('public.ai_usage_reservations') is not null
       and c.conrelid=to_regclass('public.ai_usage_reservations'))
order by c.conrelid::regclass::text, c.conname;

select 'quota_rls' as section,'FOUND' as status,
       n.nspname as schemaname,c.relname as tablename,
       c.relrowsecurity as rowsecurity,c.relforcerowsecurity as force_rowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
  and c.relname in ('ai_daily_usage','ai_usage_reservations')
order by c.relname;

select 'quota_table_privileges' as section,'FOUND' as status,
       grantee,table_name,privilege_type
from information_schema.table_privileges
where table_schema='public' and table_name in ('ai_daily_usage','ai_usage_reservations')
order by table_name,grantee,privilege_type;

select 'quota_functions' as section,'FOUND' as status,
       n.nspname as function_schema,p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,p.proconfig,p.proacl,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('reserve_ai_usage','consume_ai_usage','release_ai_usage')
order by p.proname,pg_get_function_identity_arguments(p.oid);

select 'quota_indexes' as section,'FOUND' as status,indexname,indexdef from pg_indexes
where schemaname='public' and tablename in ('ai_daily_usage','ai_usage_reservations')
order by tablename,indexname;

-- FINAL CONSOLIDATED SUMMARY: this is the last result set in Supabase SQL Editor.
with objects as (
  select to_regclass('public.users') as users_oid,
         to_regclass('public.ai_daily_usage') as daily_oid,
         to_regclass('public.ai_usage_reservations') as reservations_oid
), column_facts as (
  select
    count(*) filter(where table_name='users' and column_name='admin_override'
      and data_type='text') as admin_override_ok,
    count(*) filter(where table_name='users' and column_name='admin_override_expires_at'
      and data_type='timestamp with time zone') as admin_override_expires_ok,
    count(*) filter(where table_name='users' and column_name='admin_override_reason'
      and data_type='text') as admin_override_reason_ok,
    count(*) filter(where table_name='users' and column_name='admin_override_updated_at'
      and data_type='timestamp with time zone') as admin_override_updated_ok,
    count(*) filter(where table_name='users'
      and column_name in ('admin_override','admin_override_expires_at',
        'admin_override_reason','admin_override_updated_at')) as admin_override_columns_present,
    count(*) filter(where table_name='ai_daily_usage' and (
      (column_name='user_id' and data_type='uuid' and is_nullable='NO') or
      (column_name='usage_date' and data_type='date' and is_nullable='NO') or
      (column_name='dharma_questions' and data_type='integer' and is_nullable='NO') or
      (column_name='factcheck_questions' and data_type='integer' and is_nullable='NO') or
      (column_name='updated_at' and data_type='timestamp with time zone' and is_nullable='NO')
    )) as daily_compatible_columns,
    count(*) filter(where table_name='ai_usage_reservations' and (
      (column_name='reservation_id' and data_type='uuid' and is_nullable='NO') or
      (column_name='user_id' and data_type='uuid' and is_nullable='NO') or
      (column_name='usage_date' and data_type='date' and is_nullable='NO') or
      (column_name='kind' and data_type='text' and is_nullable='NO') or
      (column_name='status' and data_type='text' and is_nullable='NO') or
      (column_name='created_at' and data_type='timestamp with time zone' and is_nullable='NO') or
      (column_name='expires_at' and data_type='timestamp with time zone' and is_nullable='NO') or
      (column_name='finalized_at' and data_type='timestamp with time zone')
    )) as reservations_compatible_columns
  from information_schema.columns
  where table_schema='public'
), invalid_override_xml as (
  select case when o.users_oid is null then null else query_to_xml($query$
    select count(*) as invalid_admin_override_count
    from public.users u
    where to_jsonb(u)->>'admin_override' is not null
      and (btrim(to_jsonb(u)->>'admin_override')=''
        or lower(btrim(to_jsonb(u)->>'admin_override')) not in ('basic','pro','full'))
  $query$,false,true,'') end as result_xml
  from objects o
), invalid_override as (
  select case when result_xml is null then null
    else coalesce(((xpath('//invalid_admin_override_count/text()',result_xml))[1])::text::bigint,0)
  end as invalid_count
  from invalid_override_xml
), function_facts as (
  select
    to_regprocedure('public.reserve_ai_usage(uuid,text,integer)') as reserve_exact,
    to_regprocedure('public.consume_ai_usage(uuid,uuid)') as consume_exact,
    to_regprocedure('public.release_ai_usage(uuid,uuid)') as release_exact,
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='reserve_ai_usage') as reserve_named,
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='consume_ai_usage') as consume_named,
    exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='release_ai_usage') as release_named
), security_facts as (
  select
    coalesce((select c.relrowsecurity and c.relforcerowsecurity from pg_class c
      where c.oid=o.daily_oid),false) as daily_rls,
    coalesce((select c.relrowsecurity and c.relforcerowsecurity from pg_class c
      where c.oid=o.reservations_oid),false) as reservations_rls,
    coalesce(has_table_privilege('anon',o.daily_oid,'SELECT'),false)
      or coalesce(has_table_privilege('anon',o.daily_oid,'INSERT'),false)
      or coalesce(has_table_privilege('anon',o.daily_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('anon',o.daily_oid,'DELETE'),false)
      or coalesce(has_table_privilege('anon',o.reservations_oid,'SELECT'),false)
      or coalesce(has_table_privilege('anon',o.reservations_oid,'INSERT'),false)
      or coalesce(has_table_privilege('anon',o.reservations_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('anon',o.reservations_oid,'DELETE'),false) as anon_has_quota_privilege,
    coalesce(has_table_privilege('authenticated',o.daily_oid,'SELECT'),false)
      or coalesce(has_table_privilege('authenticated',o.daily_oid,'INSERT'),false)
      or coalesce(has_table_privilege('authenticated',o.daily_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('authenticated',o.daily_oid,'DELETE'),false)
      or coalesce(has_table_privilege('authenticated',o.reservations_oid,'SELECT'),false)
      or coalesce(has_table_privilege('authenticated',o.reservations_oid,'INSERT'),false)
      or coalesce(has_table_privilege('authenticated',o.reservations_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('authenticated',o.reservations_oid,'DELETE'),false) as authenticated_has_quota_privilege,
    coalesce(has_table_privilege('service_role',o.daily_oid,'SELECT'),false)
      and coalesce(has_table_privilege('service_role',o.daily_oid,'INSERT'),false)
      and coalesce(has_table_privilege('service_role',o.daily_oid,'UPDATE'),false) as service_daily_privileges,
    coalesce(has_table_privilege('service_role',o.reservations_oid,'SELECT'),false)
      and coalesce(has_table_privilege('service_role',o.reservations_oid,'INSERT'),false)
      and coalesce(has_table_privilege('service_role',o.reservations_oid,'UPDATE'),false) as service_reservation_privileges,
    coalesce((select not p.prosecdef
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      from pg_proc p where p.oid=f.reserve_exact),false) as reserve_secure,
    coalesce((select not p.prosecdef
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      from pg_proc p where p.oid=f.consume_exact),false) as consume_secure,
    coalesce((select not p.prosecdef
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not has_function_privilege('authenticated',p.oid,'EXECUTE')
      and has_function_privilege('service_role',p.oid,'EXECUTE')
      from pg_proc p where p.oid=f.release_exact),false) as release_secure
  from objects o cross join function_facts f
), constraint_facts as (
  select count(*) as target_constraint_count,
    count(*) filter(where conname in ('ai_daily_usage_pkey','ai_daily_usage_user_date_key',
      'ai_daily_usage_user_id_fkey','ai_daily_usage_dharma_questions_check',
      'ai_daily_usage_factcheck_questions_check')) as daily_required_constraints,
    count(*) filter(where conname in ('ai_usage_reservations_pkey',
      'ai_usage_reservations_user_id_fkey','ai_usage_reservations_kind_check',
      'ai_usage_reservations_status_check','ai_usage_reservations_usage_fkey')) as reservation_required_constraints
  from pg_constraint c cross join objects o
  where (o.daily_oid is not null and c.conrelid=o.daily_oid)
     or (o.reservations_oid is not null and c.conrelid=o.reservations_oid)
), index_facts as (
  select count(*) as target_index_count,
    count(*) filter(where indexname in ('ai_daily_usage_pkey','ai_daily_usage_user_date_key',
      'ai_daily_usage_usage_date_idx')) as daily_expected_indexes,
    count(*) filter(where indexname in ('ai_usage_reservations_pkey',
      'ai_usage_reservations_user_date_idx','ai_usage_reservations_active_idx')) as reservation_expected_indexes
  from pg_indexes
  where schemaname='public' and tablename in ('ai_daily_usage','ai_usage_reservations')
), facts as (
  select o.*,c.*,i.invalid_count,f.*,s.*,q.*,x.*
  from objects o cross join column_facts c cross join invalid_override i
  cross join function_facts f cross join security_facts s
  cross join constraint_facts q cross join index_facts x
), summary as (
  select 10 as sort_order,'users_table'::text as check_name,
    case when users_oid is null then 'INCOMPATIBLE' else 'PASS' end as status,
    coalesce(users_oid::text,'public.users is missing') as details from facts
  union all select 20,'admin_override_column',
    case when admin_override_ok=1 then 'PASS' when admin_override_columns_present=0 then 'ABSENT_EXPECTED' else 'INCOMPATIBLE' end,
    'expected text; matching columns='||admin_override_ok from facts
  union all select 30,'admin_override_expires_at_column',
    case when admin_override_expires_ok=1 then 'PASS' when admin_override_columns_present=0 then 'ABSENT_EXPECTED' else 'INCOMPATIBLE' end,
    'expected timestamptz; matching columns='||admin_override_expires_ok from facts
  union all select 40,'admin_override_reason_column',
    case when admin_override_reason_ok=1 then 'PASS' when admin_override_columns_present=0 then 'ABSENT_EXPECTED' else 'INCOMPATIBLE' end,
    'expected text; matching columns='||admin_override_reason_ok from facts
  union all select 50,'admin_override_updated_at_column',
    case when admin_override_updated_ok=1 then 'PASS' when admin_override_columns_present=0 then 'ABSENT_EXPECTED' else 'INCOMPATIBLE' end,
    'expected timestamptz; matching columns='||admin_override_updated_ok from facts
  union all select 60,'invalid_admin_override_count',
    case when users_oid is null or admin_override_ok=0 then 'ABSENT_EXPECTED'
      when invalid_count=0 then 'PASS' else 'WARNING' end,
    coalesce(invalid_count::text,'not inspectable') from facts
  union all select 70,'ai_daily_usage_table',
    case when daily_oid is null then 'ABSENT_EXPECTED'
      when daily_compatible_columns=5 then 'PASS' else 'INCOMPATIBLE' end,
    'compatible required columns='||daily_compatible_columns||'/5' from facts
  union all select 80,'ai_usage_reservations_table',
    case when reservations_oid is null then 'ABSENT_EXPECTED'
      when reservations_compatible_columns=8 then 'PASS' else 'INCOMPATIBLE' end,
    'compatible required columns='||reservations_compatible_columns||'/8' from facts
  union all select 90,'reserve_ai_usage_function',
    case when reserve_exact is not null and reserve_secure then 'PASS'
      when not reserve_named then 'ABSENT_EXPECTED' else 'WARNING' end,
    coalesce(reserve_exact::text,'expected signature absent')||'; secure='||reserve_secure from facts
  union all select 100,'consume_ai_usage_function',
    case when consume_exact is not null and consume_secure then 'PASS'
      when not consume_named then 'ABSENT_EXPECTED' else 'WARNING' end,
    coalesce(consume_exact::text,'expected signature absent')||'; secure='||consume_secure from facts
  union all select 110,'release_ai_usage_function',
    case when release_exact is not null and release_secure then 'PASS'
      when not release_named then 'ABSENT_EXPECTED' else 'WARNING' end,
    coalesce(release_exact::text,'expected signature absent')||'; secure='||release_secure from facts
  union all select 120,'ai_daily_usage_rls',
    case when daily_oid is null then 'ABSENT_EXPECTED' when daily_rls then 'PASS' else 'WARNING' end,
    'RLS enabled and forced='||daily_rls from facts
  union all select 130,'ai_usage_reservations_rls',
    case when reservations_oid is null then 'ABSENT_EXPECTED' when reservations_rls then 'PASS' else 'WARNING' end,
    'RLS enabled and forced='||reservations_rls from facts
  union all select 140,'anon_table_privileges',
    case when daily_oid is null and reservations_oid is null then 'ABSENT_EXPECTED'
      when anon_has_quota_privilege then 'WARNING' else 'PASS' end,
    'has quota table privileges='||anon_has_quota_privilege from facts
  union all select 150,'authenticated_table_privileges',
    case when daily_oid is null and reservations_oid is null then 'ABSENT_EXPECTED'
      when authenticated_has_quota_privilege then 'WARNING' else 'PASS' end,
    'has quota table privileges='||authenticated_has_quota_privilege from facts
  union all select 160,'service_role_table_privileges',
    case when daily_oid is null and reservations_oid is null then 'ABSENT_EXPECTED'
      when service_daily_privileges and service_reservation_privileges then 'PASS' else 'WARNING' end,
    'daily='||service_daily_privileges||', reservations='||service_reservation_privileges from facts
  union all select 170,'quota_constraints',
    case when daily_oid is null and reservations_oid is null then 'ABSENT_EXPECTED'
      when (daily_oid is null or daily_required_constraints>=4)
       and (reservations_oid is null or reservation_required_constraints=5) then 'PASS'
      else 'INCOMPATIBLE' end,
    'target constraints only='||target_constraint_count||', daily required='||daily_required_constraints||
      ', reservations required='||reservation_required_constraints from facts
  union all select 180,'quota_indexes',
    case when daily_oid is null and reservations_oid is null then 'ABSENT_EXPECTED'
      when (daily_oid is null or daily_expected_indexes>=2)
       and (reservations_oid is null or reservation_expected_indexes=3) then 'PASS' else 'WARNING' end,
    'target indexes='||target_index_count||', daily expected='||daily_expected_indexes||
      ', reservations expected='||reservation_expected_indexes from facts
  union all select 190,'migration_state',
    case
      when users_oid is null or (daily_oid is not null and daily_compatible_columns<>5)
        or (reservations_oid is not null and reservations_compatible_columns<>8)
        or (admin_override_columns_present>0 and
          (admin_override_ok+admin_override_expires_ok+admin_override_reason_ok+admin_override_updated_ok)<>4)
        then 'INCOMPATIBLE_EXISTING_SCHEMA'
      when admin_override_columns_present=0 and daily_oid is null and reservations_oid is null
        and not reserve_named and not consume_named and not release_named
        then 'CLEAN_PRE_MIGRATION_STATE'
      when admin_override_columns_present=4 and daily_oid is not null and reservations_oid is not null
        and reserve_exact is not null and consume_exact is not null and release_exact is not null
        and daily_compatible_columns=5 and reservations_compatible_columns=8
        and daily_rls and reservations_rls and not anon_has_quota_privilege
        and not authenticated_has_quota_privilege and service_daily_privileges
        and service_reservation_privileges and reserve_secure and consume_secure and release_secure
        and daily_required_constraints>=4 and reservation_required_constraints=5
        and daily_expected_indexes>=2 and reservation_expected_indexes=3
        then 'ALREADY_MIGRATED'
      else 'PARTIAL_EXISTING_MIGRATION'
    end,
    'Derived from users columns, quota tables, RPC signatures, RLS, and client privileges' from facts
)
select check_name,status,details from summary order by sort_order;
