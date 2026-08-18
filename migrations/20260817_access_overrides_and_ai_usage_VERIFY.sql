-- PRODUCTION VERIFY
-- Metadata queries are read-only. Functional changes are enclosed by BEGIN /
-- ROLLBACK, so temporary changes to a real Auth user's quota rows never persist.

select 'users_override_columns' as section,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name='users'
  and column_name in ('admin_override','admin_override_expires_at',
    'admin_override_reason','admin_override_updated_at') order by column_name;

select 'quota_constraints' as section,c.conrelid::regclass as table_name,
  c.conname,c.contype,pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where (to_regclass('public.ai_daily_usage') is not null
    and c.conrelid=to_regclass('public.ai_daily_usage'))
   or (to_regclass('public.ai_usage_reservations') is not null
    and c.conrelid=to_regclass('public.ai_usage_reservations'))
order by c.conrelid::regclass::text,c.conname;

select 'quota_indexes' as section,tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename in ('ai_daily_usage','ai_usage_reservations')
order by tablename,indexname;

select 'quota_rls' as section,c.relname as table_name,
  c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p')
  and c.relname in ('ai_daily_usage','ai_usage_reservations') order by c.relname;

select 'quota_functions' as section,p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type,
  not p.prosecdef as security_invoker,p.proconfig,p.proacl,
  not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute_blocked,
  not has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute_blocked,
  not has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute_blocked,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute_allowed
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.oid in (
  coalesce(to_regprocedure('public.reserve_ai_usage(uuid,text,integer)'),0::oid),
  coalesce(to_regprocedure('public.consume_ai_usage(uuid,uuid)'),0::oid),
  coalesce(to_regprocedure('public.release_ai_usage(uuid,uuid)'),0::oid))
order by p.proname,pg_get_function_identity_arguments(p.oid);

-- FUNCTIONAL TEST. Any assertion error aborts the transaction, which cannot be
-- committed. ROLLBACK is explicit; an ended aborted session also rolls back.
-- This single-session test validates quota semantics, not concurrent-session races.
begin;
do $$
declare
  test_user uuid;
  effective_date date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
  r1 record; r2 record; r3 record; r4 record; rf record; ru record;
  dharma_count integer; factcheck_count integer;
begin
  if to_regclass('public.ai_daily_usage') is null
     or to_regclass('public.ai_usage_reservations') is null then
    raise exception 'VERIFY_FAIL: quota tables are missing';
  end if;
  if to_regprocedure('public.reserve_ai_usage(uuid,text,integer)') is null
     or to_regprocedure('public.consume_ai_usage(uuid,uuid)') is null
     or to_regprocedure('public.release_ai_usage(uuid,uuid)') is null then
    raise exception 'VERIFY_FAIL: expected quota RPC signatures are missing';
  end if;
  select id into test_user from auth.users order by created_at limit 1;
  if test_user is null then
    raise exception 'VERIFY_FAIL: functional test requires one auth.users row';
  end if;

  -- Isolated baseline; these changes and all RPC calls are restored by ROLLBACK.
  delete from public.ai_usage_reservations
  where user_id=test_user and usage_date=effective_date;
  delete from public.ai_daily_usage
  where user_id=test_user and usage_date=effective_date;

  select * into r1 from public.reserve_ai_usage(test_user,'dharma',3);
  select * into r2 from public.reserve_ai_usage(test_user,'dharma',3);
  select * into r3 from public.reserve_ai_usage(test_user,'dharma',3);
  select * into r4 from public.reserve_ai_usage(test_user,'dharma',3);
  if not r1.allowed or r1.reservation_id is null or r1.used<>1 or r1.remaining<>2
    or r1.usage_date<>effective_date
    or not r2.allowed or r2.reservation_id is null or r2.used<>2 or r2.remaining<>1
    or r2.usage_date<>effective_date
    or not r3.allowed or r3.reservation_id is null or r3.used<>3 or r3.remaining<>0
    or r3.usage_date<>effective_date
    or r4.allowed or r4.reservation_id is not null or r4.used<>3 or r4.remaining<>0
    or r4.usage_date<>effective_date then
    raise exception 'VERIFY_FAIL: free limit 3 or Asia/Kolkata usage date is incorrect';
  end if;

  if not public.consume_ai_usage(test_user,r1.reservation_id)
     or not public.consume_ai_usage(test_user,r1.reservation_id) then
    raise exception 'VERIFY_FAIL: consume is not idempotent';
  end if;
  select dharma_questions,factcheck_questions into dharma_count,factcheck_count
  from public.ai_daily_usage where user_id=test_user and usage_date=effective_date;
  if dharma_count<>3 or factcheck_count<>0 then
    raise exception 'VERIFY_FAIL: consume changed counters unexpectedly';
  end if;

  if public.release_ai_usage(test_user,r1.reservation_id) then
    raise exception 'VERIFY_FAIL: consumed reservation was released';
  end if;
  select dharma_questions into dharma_count from public.ai_daily_usage
  where user_id=test_user and usage_date=effective_date;
  if dharma_count<>3 then
    raise exception 'VERIFY_FAIL: release decremented a consumed reservation';
  end if;

  if not public.release_ai_usage(test_user,r2.reservation_id) then
    raise exception 'VERIFY_FAIL: first release did not succeed';
  end if;
  if public.release_ai_usage(test_user,r2.reservation_id) then
    raise exception 'VERIFY_FAIL: duplicate release succeeded';
  end if;
  select dharma_questions into dharma_count from public.ai_daily_usage
  where user_id=test_user and usage_date=effective_date;
  if dharma_count<>2 then
    raise exception 'VERIFY_FAIL: duplicate release changed counter incorrectly';
  end if;

  select * into rf from public.reserve_ai_usage(test_user,'factcheck',1);
  if not rf.allowed or rf.reservation_id is null or rf.used<>1 or rf.remaining<>0
     or rf.usage_date<>effective_date then
    raise exception 'VERIFY_FAIL: FactCheck reservation failed';
  end if;
  select dharma_questions,factcheck_questions into dharma_count,factcheck_count
  from public.ai_daily_usage where user_id=test_user and usage_date=effective_date;
  if dharma_count<>2 or factcheck_count<>1 then
    raise exception 'VERIFY_FAIL: DharmaChat and FactCheck counters are not separate';
  end if;

  select * into ru from public.reserve_ai_usage(test_user,'dharma',null);
  if not ru.allowed or ru.reservation_id is null or ru.remaining is not null
     or ru.usage_date<>effective_date then
    raise exception 'VERIFY_FAIL: unlimited quota behavior is incorrect';
  end if;
  select dharma_questions,factcheck_questions into dharma_count,factcheck_count
  from public.ai_daily_usage where user_id=test_user and usage_date=effective_date;
  if dharma_count<>3 or factcheck_count<>1 then
    raise exception 'VERIFY_FAIL: unlimited reservation changed the wrong counter';
  end if;
  raise notice 'VERIFY functional test passed for user %; transaction will roll back',test_user;
end $$;
rollback;

-- FINAL RESULT. Reached only after all functional assertions and ROLLBACK.
with objects as (
  select to_regclass('public.users') as users_oid,
    to_regclass('public.ai_daily_usage') as daily_oid,
    to_regclass('public.ai_usage_reservations') as reservations_oid
), columns_ok as (
  select count(*)=4 as override_columns_ok from information_schema.columns
  where table_schema='public' and table_name='users' and (
    (column_name='admin_override' and data_type='text') or
    (column_name='admin_override_expires_at' and data_type='timestamp with time zone') or
    (column_name='admin_override_reason' and data_type='text') or
    (column_name='admin_override_updated_at' and data_type='timestamp with time zone'))
), rls_ok as (
  select coalesce((select relrowsecurity and relforcerowsecurity from pg_class
      where oid=o.daily_oid),false) as daily_rls_ok,
    coalesce((select relrowsecurity and relforcerowsecurity from pg_class
      where oid=o.reservations_oid),false) as reservations_rls_ok from objects o
), table_acl_ok as (
  select not (coalesce(has_table_privilege('anon',o.daily_oid,'INSERT'),false)
      or coalesce(has_table_privilege('anon',o.daily_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('anon',o.daily_oid,'DELETE'),false)
      or coalesce(has_table_privilege('anon',o.reservations_oid,'INSERT'),false)
      or coalesce(has_table_privilege('anon',o.reservations_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('anon',o.reservations_oid,'DELETE'),false)) as anon_mutation_blocked,
    not (coalesce(has_table_privilege('authenticated',o.daily_oid,'INSERT'),false)
      or coalesce(has_table_privilege('authenticated',o.daily_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('authenticated',o.daily_oid,'DELETE'),false)
      or coalesce(has_table_privilege('authenticated',o.reservations_oid,'INSERT'),false)
      or coalesce(has_table_privilege('authenticated',o.reservations_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('authenticated',o.reservations_oid,'DELETE'),false)) as authenticated_mutation_blocked
  from objects o
), function_oids as (
  select to_regprocedure('public.reserve_ai_usage(uuid,text,integer)') as reserve_oid,
    to_regprocedure('public.consume_ai_usage(uuid,uuid)') as consume_oid,
    to_regprocedure('public.release_ai_usage(uuid,uuid)') as release_oid
), function_checks as (
  select label,oid,
    coalesce((select not p.prosecdef from pg_proc p where p.oid=f.oid),false) as invoker,
    coalesce((select exists(select 1 from unnest(p.proconfig) cfg
      where replace(cfg,' ','')=f.expected_path) from pg_proc p where p.oid=f.oid),false) as fixed_path,
    coalesce((select not exists(select 1
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE')
      from pg_proc p where p.oid=f.oid),false) as public_blocked,
    coalesce(not has_function_privilege('anon',f.oid,'EXECUTE'),false) as anon_blocked,
    coalesce(not has_function_privilege('authenticated',f.oid,'EXECUTE'),false) as authenticated_blocked,
    coalesce(has_function_privilege('service_role',f.oid,'EXECUTE'),false) as service_allowed
  from function_oids o cross join lateral (values
    ('reserve_ai_usage',o.reserve_oid,'search_path=pg_catalog,extensions'),
    ('consume_ai_usage',o.consume_oid,'search_path=pg_catalog'),
    ('release_ai_usage',o.release_oid,'search_path=pg_catalog')
  ) f(label,oid,expected_path)
), function_summary as (
  select count(*) filter(where oid is not null)=3 as functions_exist,
    bool_and(invoker and fixed_path and public_blocked and anon_blocked
      and authenticated_blocked and service_allowed) as functions_secure from function_checks
), constraint_summary as (
  select count(*) filter(where conname in ('ai_daily_usage_pkey','ai_daily_usage_user_date_key',
      'ai_daily_usage_user_id_fkey','ai_daily_usage_dharma_questions_check',
      'ai_daily_usage_factcheck_questions_check'))>=4 as daily_constraints_ok,
    count(*) filter(where conname in ('ai_usage_reservations_pkey',
      'ai_usage_reservations_user_id_fkey','ai_usage_reservations_kind_check',
      'ai_usage_reservations_status_check','ai_usage_reservations_usage_fkey'))=5 as reservation_constraints_ok
  from pg_constraint c cross join objects o
  where (o.daily_oid is not null and c.conrelid=o.daily_oid)
     or (o.reservations_oid is not null and c.conrelid=o.reservations_oid)
), index_summary as (
  select count(*) filter(where indexname in ('ai_daily_usage_pkey',
      'ai_daily_usage_user_date_key','ai_daily_usage_usage_date_idx'))>=2 as daily_indexes_ok,
    count(*) filter(where indexname in ('ai_usage_reservations_pkey',
      'ai_usage_reservations_user_date_idx','ai_usage_reservations_active_idx'))=3 as reservation_indexes_ok
  from pg_indexes where schemaname='public'
    and tablename in ('ai_daily_usage','ai_usage_reservations')
), facts as (
  select o.*,c.*,r.*,t.*,f.*,q.*,i.* from objects o cross join columns_ok c
  cross join rls_ok r cross join table_acl_ok t cross join function_summary f
  cross join constraint_summary q cross join index_summary i
), summary as (
  select 10 as n,'override_columns'::text as check_name,
    case when override_columns_ok then 'PASS' else 'FAIL' end as status,
    'all four override columns have expected types'::text as details from facts
  union all select 20,'quota_tables',case when daily_oid is not null and reservations_oid is not null then 'PASS' else 'FAIL' end,
    'both quota tables exist' from facts
  union all select 30,'rls',case when daily_rls_ok and reservations_rls_ok then 'PASS' else 'FAIL' end,
    'RLS enabled and forced on both tables' from facts
  union all select 40,'client_table_mutation',case when anon_mutation_blocked and authenticated_mutation_blocked then 'PASS' else 'FAIL' end,
    'anon and authenticated mutation blocked' from facts
  union all select 50,'quota_functions',case when functions_exist then 'PASS' else 'FAIL' end,
    'all three exact RPC signatures exist' from facts
  union all select 60,'function_security',case when functions_secure then 'PASS' else 'FAIL' end,
    'invoker, fixed paths, client blocked, service_role allowed' from facts
  union all select 70,'quota_constraints',case when daily_constraints_ok and reservation_constraints_ok then 'PASS' else 'FAIL' end,
    'required target-table constraints exist' from facts
  union all select 80,'quota_indexes',case when daily_indexes_ok and reservation_indexes_ok then 'PASS' else 'FAIL' end,
    'required quota indexes exist' from facts
  union all select 90,'functional_quota_test','PASS',
    'all assertions completed and transaction rolled back' from facts
), final_summary as (
  select * from summary
  union all select 100,'overall_result',
    case when bool_and(status='PASS') then 'VERIFY_PASS' else 'VERIFY_FAIL' end,
    case when bool_and(status='PASS') then 'all static and functional checks passed'
      else 'one or more checks failed; inspect summary rows' end from summary
)
select check_name,status,details from final_summary order by n;
