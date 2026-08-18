-- Post-hotfix verification. Functional changes are always rolled back.
-- This is a single-session semantics test; it does not prove concurrent races.
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

  select au.id into test_user from auth.users as au order by au.created_at limit 1;
  if test_user is null then
    raise exception 'VERIFY_FAIL: functional test requires one auth.users row';
  end if;

  delete from public.ai_usage_reservations as r
  where r.user_id=test_user and r.usage_date=effective_date;
  delete from public.ai_daily_usage as u
  where u.user_id=test_user and u.usage_date=effective_date;

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
  select u.dharma_questions,u.factcheck_questions into dharma_count,factcheck_count
  from public.ai_daily_usage as u
  where u.user_id=test_user and u.usage_date=effective_date;
  if dharma_count<>3 or factcheck_count<>0 then
    raise exception 'VERIFY_FAIL: consume changed counters unexpectedly';
  end if;

  if public.release_ai_usage(test_user,r1.reservation_id) then
    raise exception 'VERIFY_FAIL: consumed reservation was released';
  end if;
  select u.dharma_questions into dharma_count from public.ai_daily_usage as u
  where u.user_id=test_user and u.usage_date=effective_date;
  if dharma_count<>3 then
    raise exception 'VERIFY_FAIL: consumed reservation release changed the counter';
  end if;

  if not public.release_ai_usage(test_user,r2.reservation_id) then
    raise exception 'VERIFY_FAIL: first release did not succeed';
  end if;
  if public.release_ai_usage(test_user,r2.reservation_id) then
    raise exception 'VERIFY_FAIL: duplicate release succeeded';
  end if;
  select u.dharma_questions into dharma_count from public.ai_daily_usage as u
  where u.user_id=test_user and u.usage_date=effective_date;
  if dharma_count<>2 then
    raise exception 'VERIFY_FAIL: release idempotency changed the counter incorrectly';
  end if;

  select * into rf from public.reserve_ai_usage(test_user,'factcheck',1);
  if not rf.allowed or rf.reservation_id is null or rf.used<>1 or rf.remaining<>0
     or rf.usage_date<>effective_date then
    raise exception 'VERIFY_FAIL: FactCheck reservation is incorrect';
  end if;
  select u.dharma_questions,u.factcheck_questions into dharma_count,factcheck_count
  from public.ai_daily_usage as u
  where u.user_id=test_user and u.usage_date=effective_date;
  if dharma_count<>2 or factcheck_count<>1 then
    raise exception 'VERIFY_FAIL: DharmaChat and FactCheck counters are not independent';
  end if;

  select * into ru from public.reserve_ai_usage(test_user,'dharma',null);
  if not ru.allowed or ru.reservation_id is null or ru.used<>3
     or ru.remaining is not null or ru.usage_date<>effective_date then
    raise exception 'VERIFY_FAIL: unlimited quota behavior is incorrect';
  end if;
  select u.dharma_questions,u.factcheck_questions into dharma_count,factcheck_count
  from public.ai_daily_usage as u
  where u.user_id=test_user and u.usage_date=effective_date;
  if dharma_count<>3 or factcheck_count<>1 then
    raise exception 'VERIFY_FAIL: unlimited reservation changed the wrong counter';
  end if;

  raise notice 'HOTFIX functional verification passed; transaction will roll back';
end $$;

rollback;

with objects as (
  select to_regclass('public.ai_daily_usage') as daily_oid,
    to_regclass('public.ai_usage_reservations') as reservations_oid
), rls_checks as (
  select coalesce((select c.relrowsecurity and c.relforcerowsecurity
      from pg_class c where c.oid=o.daily_oid),false) as daily_secure,
    coalesce((select c.relrowsecurity and c.relforcerowsecurity
      from pg_class c where c.oid=o.reservations_oid),false) as reservations_secure
  from objects o
), table_acl_checks as (
  select not (
      coalesce(has_table_privilege('anon',o.daily_oid,'INSERT'),false)
      or coalesce(has_table_privilege('anon',o.daily_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('anon',o.daily_oid,'DELETE'),false)
      or coalesce(has_table_privilege('anon',o.reservations_oid,'INSERT'),false)
      or coalesce(has_table_privilege('anon',o.reservations_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('anon',o.reservations_oid,'DELETE'),false)
    ) as anon_blocked,
    not (
      coalesce(has_table_privilege('authenticated',o.daily_oid,'INSERT'),false)
      or coalesce(has_table_privilege('authenticated',o.daily_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('authenticated',o.daily_oid,'DELETE'),false)
      or coalesce(has_table_privilege('authenticated',o.reservations_oid,'INSERT'),false)
      or coalesce(has_table_privilege('authenticated',o.reservations_oid,'UPDATE'),false)
      or coalesce(has_table_privilege('authenticated',o.reservations_oid,'DELETE'),false)
    ) as authenticated_blocked
  from objects o
), function_checks as (
  select count(*)=3 as exact_signatures_exist,
    bool_and(not p.prosecdef) as security_invoker,
    bool_and(exists(select 1 from unnest(p.proconfig) as cfg
      where replace(cfg,' ','')=f.expected_path)) as fixed_search_paths,
    bool_and(not exists(select 1
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) as a
      where a.grantee=0 and a.privilege_type='EXECUTE')) as public_blocked,
    bool_and(not has_function_privilege('anon',p.oid,'EXECUTE')) as anon_blocked,
    bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE')) as authenticated_blocked,
    bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')) as service_role_allowed
  from (values
    (to_regprocedure('public.reserve_ai_usage(uuid,text,integer)'),
      'search_path=pg_catalog,extensions'),
    (to_regprocedure('public.consume_ai_usage(uuid,uuid)'),
      'search_path=pg_catalog'),
    (to_regprocedure('public.release_ai_usage(uuid,uuid)'),
      'search_path=pg_catalog')
  ) as f(oid,expected_path)
  join pg_proc p on p.oid=f.oid
), summary as (
  select 10 as n,'functional_rpc_test'::text as check_name,'PASS'::text as status,
    'quota semantics and Asia/Kolkata date passed; all changes rolled back'::text as details
  union all select 20,'rls',case when daily_secure and reservations_secure then 'PASS' else 'FAIL' end,
    'RLS enabled and forced on both quota tables' from rls_checks
  union all select 30,'client_table_mutation',
    case when anon_blocked and authenticated_blocked then 'PASS' else 'FAIL' end,
    'anon and authenticated cannot mutate quota tables' from table_acl_checks
  union all select 40,'rpc_signatures',case when exact_signatures_exist then 'PASS' else 'FAIL' end,
    'all three exact RPC signatures exist' from function_checks
  union all select 50,'rpc_security',case when security_invoker and fixed_search_paths
      and public_blocked and anon_blocked and authenticated_blocked and service_role_allowed
      then 'PASS' else 'FAIL' end,
    'SECURITY INVOKER, fixed search_path, service_role-only execution' from function_checks
), final_summary as (
  select * from summary
  union all select 100,'overall_result',
    case when bool_and(status='PASS') then 'VERIFY_PASS' else 'VERIFY_FAIL' end,
    case when bool_and(status='PASS') then 'hotfix verified with no persistent test data'
      else 'one or more checks failed; inspect summary rows' end from summary
)
select check_name,status,details from final_summary order by n;
