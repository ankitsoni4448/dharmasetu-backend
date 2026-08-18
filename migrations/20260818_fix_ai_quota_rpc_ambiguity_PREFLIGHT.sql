-- Read-only production preflight for the AI quota RPC ambiguity hotfix.
with objects as (
  select to_regclass('public.ai_daily_usage') as daily_oid,
    to_regclass('public.ai_usage_reservations') as reservations_oid,
    to_regprocedure('public.reserve_ai_usage(uuid,text,integer)') as reserve_oid,
    to_regprocedure('public.consume_ai_usage(uuid,uuid)') as consume_oid,
    to_regprocedure('public.release_ai_usage(uuid,uuid)') as release_oid
), table_checks as (
  select o.*,
    coalesce((select c.relkind in ('r','p') from pg_class c where c.oid=o.daily_oid),false)
      as daily_compatible,
    coalesce((select c.relkind in ('r','p') from pg_class c where c.oid=o.reservations_oid),false)
      as reservations_compatible,
    coalesce((select c.contype in ('p','u') from pg_constraint c
      where c.conrelid=o.daily_oid and c.conname='ai_daily_usage_pkey'),false) as conflict_constraint_ok,
    (select count(*)=4 from pg_constraint c where c.conrelid=o.daily_oid
      and c.conname in ('ai_daily_usage_pkey','ai_daily_usage_user_id_fkey',
        'ai_daily_usage_dharma_questions_check','ai_daily_usage_factcheck_questions_check'))
      as daily_constraints_ok,
    (select count(*)=5 from pg_constraint c where c.conrelid=o.reservations_oid
      and c.conname in ('ai_usage_reservations_pkey','ai_usage_reservations_user_id_fkey',
        'ai_usage_reservations_kind_check','ai_usage_reservations_status_check',
        'ai_usage_reservations_usage_fkey')) as reservation_constraints_ok
  from objects o
), function_rows as (
  select f.label,f.oid,f.expected_result,p.proowner,p.prosecdef,p.proconfig,
    p.prolang=(select oid from pg_language where lanname='plpgsql') as is_plpgsql,
    pg_get_function_result(p.oid) as actual_result,
    coalesce((select r.rolsuper from pg_roles r where r.rolname=current_user),false)
      or p.proowner=(select oid from pg_roles where rolname=current_user)
      or pg_has_role(current_user,p.proowner,'USAGE') as current_user_can_replace,
    coalesce(has_function_privilege('service_role',p.oid,'EXECUTE'),false) as service_role_execute
  from objects o cross join lateral (values
    ('reserve_ai_usage',o.reserve_oid,
      'TABLE(reservation_id uuid, allowed boolean, used integer, remaining integer, usage_date date)'),
    ('consume_ai_usage',o.consume_oid,'boolean'),
    ('release_ai_usage',o.release_oid,'boolean')
  ) f(label,oid,expected_result)
  left join pg_proc p on p.oid=f.oid
), function_checks as (
  select count(*) filter(where oid is not null)=3 as signatures_exist,
    bool_and(oid is not null and is_plpgsql and actual_result=expected_result) as return_types_compatible,
    bool_and(oid is not null and current_user_can_replace) as replaceable,
    bool_and(oid is not null and service_role_execute) as service_role_privileges_exist
  from function_rows
), summary as (
  select 10 as n,'quota_tables'::text as check_name,
    case when daily_oid is not null and reservations_oid is not null
      and daily_compatible and reservations_compatible then 'PASS' else 'INCOMPATIBLE' end as status,
    'both expected public tables must exist as ordinary or partitioned tables'::text as details
  from table_checks
  union all select 20,'conflict_constraint',case when conflict_constraint_ok then 'PASS' else 'INCOMPATIBLE' end,
    'public.ai_daily_usage must have primary/unique constraint ai_daily_usage_pkey' from table_checks
  union all select 30,'reservation_constraints',case when reservation_constraints_ok then 'PASS' else 'INCOMPATIBLE' end,
    'all five reservation constraints must exist on the target table' from table_checks
  union all select 25,'daily_constraints',case when daily_constraints_ok then 'PASS' else 'INCOMPATIBLE' end,
    'primary key, Auth foreign key, and both counter checks must exist' from table_checks
  union all select 40,'rpc_signatures',case when signatures_exist then 'PASS' else 'INCOMPATIBLE' end,
    'all three exact RPC input signatures must already exist' from function_checks
  union all select 50,'rpc_return_types',case when return_types_compatible then 'PASS' else 'INCOMPATIBLE' end,
    'return types must be unchanged for CREATE OR REPLACE' from function_checks
  union all select 60,'current_user_replace_access',case when replaceable then 'PASS' else 'INCOMPATIBLE' end,
    'SQL Editor role must own, inherit ownership, or be superuser' from function_checks
  union all select 70,'service_role_execute',case when service_role_privileges_exist then 'PASS' else 'INCOMPATIBLE' end,
    'service_role must currently execute all three RPCs' from function_checks
), final_summary as (
  select * from summary
  union all select 100,'overall_result',
    case when bool_and(status='PASS') then 'PREFLIGHT_PASS' else 'PREFLIGHT_FAIL' end,
    case when bool_and(status='PASS') then 'safe to apply ambiguity hotfix'
      else 'do not apply hotfix; inspect failed check' end from summary
)
select check_name,status,details from final_summary order by n;
