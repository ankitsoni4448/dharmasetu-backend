-- READ ONLY. Run before 20260822_account_birth_jyotish_lifecycle.sql.
-- One result set: every FAIL must be resolved before running the migration.
with
required_base(table_name,column_name,type_family,min_length) as (
  values
    ('users','id','uuid_or_text',null::integer),
    ('users','phone','text',null::integer),
    ('payments','phone','text',20),
    ('user_notifications','user_id','uuid',null::integer),
    ('ai_feedback','user_id','uuid',null::integer),
    ('ai_usage_reservations','user_id','uuid',null::integer),
    ('ai_daily_usage','user_id','uuid',null::integer)
),
base_checks as (
  select 'base_column:'||r.table_name||'.'||r.column_name as check_name,
    case
      when to_regclass(format('public.%I',r.table_name)) is null then 'FAIL'
      when a.attname is null then 'FAIL'
      when r.type_family='uuid' and format_type(a.atttypid,a.atttypmod)<>'uuid' then 'FAIL'
      when r.type_family='uuid_or_text' and format_type(a.atttypid,a.atttypmod)!~'^(uuid|text|character varying(\([0-9]+\))?|character(\([0-9]+\))?)$' then 'FAIL'
      when r.type_family='text' and format_type(a.atttypid,a.atttypmod)!~'^(text|character varying(\([0-9]+\))?|character(\([0-9]+\))?)$' then 'FAIL'
      when r.min_length is not null
       and format_type(a.atttypid,a.atttypmod)~'^character( varying)?\([0-9]+\)$'
       and substring(format_type(a.atttypid,a.atttypmod) from '\(([0-9]+)\)')::integer<r.min_length then 'FAIL'
      else 'PASS'
    end as status,
    case
      when to_regclass(format('public.%I',r.table_name)) is null then 'required table is absent'
      when a.attname is null then 'required column is absent'
      else 'actual_type='||format_type(a.atttypid,a.atttypmod)
    end as details
  from required_base r
  left join pg_catalog.pg_attribute a
    on a.attrelid=to_regclass(format('public.%I',r.table_name))
   and a.attname=r.column_name and a.attnum>0 and not a.attisdropped
),
expected_columns(table_name,column_name,data_type,is_nullable) as (
  values
    ('user_profiles','user_id','uuid','NO'),('user_profiles','name','text','NO'),
    ('user_profiles','gender','text','NO'),('user_profiles','language','text','NO'),
    ('user_profiles','interests','ARRAY','NO'),('user_profiles','current_place_name','text','YES'),
    ('user_profiles','current_latitude','double precision','YES'),('user_profiles','current_longitude','double precision','YES'),
    ('user_profiles','current_timezone','text','YES'),('user_profiles','onboarding_status','text','NO'),
    ('user_profiles','birth_data_consent_at','timestamp with time zone','NO'),
    ('user_profiles','birth_data_consent_version','text','NO'),
    ('user_profiles','created_at','timestamp with time zone','NO'),('user_profiles','updated_at','timestamp with time zone','NO'),
    ('birth_profiles','user_id','uuid','NO'),('birth_profiles','date_of_birth','date','NO'),
    ('birth_profiles','birth_time','time without time zone','YES'),('birth_profiles','birth_time_certainty','text','NO'),
    ('birth_profiles','birthplace_input','text','NO'),('birth_profiles','place_name','text','NO'),
    ('birth_profiles','city','text','YES'),('birth_profiles','region','text','YES'),
    ('birth_profiles','country','text','NO'),('birth_profiles','country_code','text','YES'),
    ('birth_profiles','latitude','double precision','NO'),('birth_profiles','longitude','double precision','NO'),
    ('birth_profiles','timezone','text','NO'),('birth_profiles','utc_offset_minutes','integer','NO'),
    ('birth_profiles','profile_version','integer','NO'),('birth_profiles','input_fingerprint','text','NO'),
    ('birth_profiles','created_at','timestamp with time zone','NO'),('birth_profiles','updated_at','timestamp with time zone','NO'),
    ('jyotish_profiles','user_id','uuid','NO'),('jyotish_profiles','birth_profile_version','integer','NO'),
    ('jyotish_profiles','input_fingerprint','text','NO'),('jyotish_profiles','status','text','NO'),
    ('jyotish_profiles','provider','text','YES'),('jyotish_profiles','calculation_version','text','YES'),
    ('jyotish_profiles','ayanamsha','text','YES'),('jyotish_profiles','chart_data','jsonb','YES'),
    ('jyotish_profiles','compact_context','jsonb','YES'),('jyotish_profiles','failure_code','text','YES'),
    ('jyotish_profiles','generated_at','timestamp with time zone','YES'),('jyotish_profiles','updated_at','timestamp with time zone','NO'),
    ('account_deletion_audit','id','uuid','NO'),('account_deletion_audit','deleted_user_hash','text','NO'),
    ('account_deletion_audit','result','text','NO'),('account_deletion_audit','created_at','timestamp with time zone','NO')
),
expected_counts(table_name,column_count) as (
  values ('user_profiles',14),('birth_profiles',18),('jyotish_profiles',13),('account_deletion_audit',4)
),
lifecycle_checks as (
  select 'lifecycle_table:'||n.table_name as check_name,
    case when to_regclass(format('public.%I',n.table_name)) is null then 'ABSENT_EXPECTED'
         when (select count(*) from information_schema.columns x where x.table_schema='public' and x.table_name=n.table_name)<>n.column_count
           or count(c.column_name)<>n.column_count
           or count(c.column_name) filter(where c.data_type=e.data_type and c.is_nullable=e.is_nullable)<>n.column_count
         then 'FAIL' else 'PASS' end as status,
    case when to_regclass(format('public.%I',n.table_name)) is null then 'migration will create it'
         else format('columns=%s expected=%s compatible=%s',
           (select count(*) from information_schema.columns x where x.table_schema='public' and x.table_name=n.table_name),n.column_count,
           count(c.column_name) filter(where c.data_type=e.data_type and c.is_nullable=e.is_nullable)) end as details
  from expected_counts n
  left join expected_columns e on e.table_name=n.table_name
  left join information_schema.columns c on c.table_schema='public' and c.table_name=e.table_name and c.column_name=e.column_name
  group by n.table_name,n.column_count
),
expected_defaults(table_name,column_name) as (
  values
    ('user_profiles','language'),('user_profiles','interests'),('user_profiles','onboarding_status'),
    ('user_profiles','created_at'),('user_profiles','updated_at'),
    ('birth_profiles','profile_version'),('birth_profiles','created_at'),('birth_profiles','updated_at'),
    ('jyotish_profiles','status'),('jyotish_profiles','updated_at'),
    ('account_deletion_audit','id'),('account_deletion_audit','created_at')
),
default_checks as (
  select 'defaults:'||e.table_name as check_name,
    case when to_regclass(format('public.%I',e.table_name)) is null then 'ABSENT_EXPECTED'
         when count(c.column_name) filter(where c.column_default is not null)=count(*) then 'PASS' else 'FAIL' end as status,
    format('present=%s expected=%s',count(c.column_name) filter(where c.column_default is not null),count(*)) as details
  from expected_defaults e left join information_schema.columns c
    on c.table_schema='public' and c.table_name=e.table_name and c.column_name=e.column_name
  group by e.table_name
),
expected_constraints(table_name,constraint_name) as (
  values
    ('user_profiles','user_profiles_pkey'),('user_profiles','user_profiles_user_id_fkey'),
    ('user_profiles','user_profiles_gender_check'),('user_profiles','user_profiles_language_check'),
    ('user_profiles','user_profiles_onboarding_check'),
    ('birth_profiles','birth_profiles_pkey'),('birth_profiles','birth_profiles_user_id_fkey'),
    ('birth_profiles','birth_profiles_time_certainty_check'),('birth_profiles','birth_profiles_time_check'),
    ('birth_profiles','birth_profiles_latitude_check'),('birth_profiles','birth_profiles_longitude_check'),
    ('birth_profiles','birth_profiles_offset_check'),('birth_profiles','birth_profiles_version_check'),
    ('jyotish_profiles','jyotish_profiles_pkey'),('jyotish_profiles','jyotish_profiles_user_id_fkey'),
    ('jyotish_profiles','jyotish_profiles_status_check'),('jyotish_profiles','jyotish_profiles_version_check'),
    ('account_deletion_audit','account_deletion_audit_pkey'),
    ('account_deletion_audit','account_deletion_audit_deleted_user_hash_key'),
    ('account_deletion_audit','account_deletion_audit_result_check')
),
constraint_checks as (
  select 'constraints:'||e.table_name as check_name,
    case when to_regclass(format('public.%I',e.table_name)) is null then 'ABSENT_EXPECTED'
         when count(c.oid)=count(*) then 'PASS' else 'FAIL' end as status,
    format('present=%s expected=%s; %s',count(c.oid),count(*),
      string_agg(e.constraint_name||'='||coalesce(pg_get_constraintdef(c.oid),'MISSING'),'; ' order by e.constraint_name)) as details
  from expected_constraints e
  left join pg_catalog.pg_constraint c
    on c.conrelid=to_regclass(format('public.%I',e.table_name)) and c.conname=e.constraint_name
   and c.contype=case when e.constraint_name like '%_pkey' then 'p'::"char"
                      when e.constraint_name like '%_fkey' then 'f'::"char"
                      when e.constraint_name like '%_check' then 'c'::"char" else 'u'::"char" end
   and (e.constraint_name not like '%_user_id_fkey'
        or (c.confrelid='auth.users'::regclass and pg_get_constraintdef(c.oid) like '%(user_id)%ON DELETE CASCADE%'))
  group by e.table_name
),
expected_indexes(index_name,table_name) as (
  values ('user_profiles_onboarding_idx','user_profiles'),('jyotish_profiles_status_idx','jyotish_profiles')
),
index_checks as (
  select 'index:'||e.index_name as check_name,
    case when to_regclass('public.'||e.index_name) is null then 'ABSENT_EXPECTED'
         when i.indrelid=to_regclass('public.'||e.table_name)
          and pg_get_indexdef(i.indexrelid) like case when e.index_name='user_profiles_onboarding_idx'
               then '%(onboarding_status)%' else '%(status)%' end then 'PASS' else 'FAIL' end as status,
    case when to_regclass('public.'||e.index_name) is null then 'migration will create it'
         else 'attached_to='||coalesce(i.indrelid::regclass::text,'unknown') end as details
  from expected_indexes e
  left join pg_catalog.pg_index i on i.indexrelid=to_regclass('public.'||e.index_name)
),
rls_checks as (
  select 'rls:'||n.table_name as check_name,
    case when c.oid is null then 'ABSENT_EXPECTED'
         when c.relrowsecurity and c.relforcerowsecurity then 'PASS' else 'REPAIRABLE' end as status,
    case when c.oid is null then 'migration will enable and force RLS'
         else format('enabled=%s forced=%s',c.relrowsecurity,c.relforcerowsecurity) end as details
  from expected_counts n
  left join pg_catalog.pg_class c on c.oid=to_regclass(format('public.%I',n.table_name))
),
privilege_checks as (
  select 'privileges:'||n.table_name as check_name,
    case when to_regclass(format('public.%I',n.table_name)) is null then 'ABSENT_EXPECTED'
         when has_table_privilege('anon',to_regclass(format('public.%I',n.table_name)),'SELECT')
           or has_table_privilege('anon',to_regclass(format('public.%I',n.table_name)),'INSERT')
           or has_table_privilege('anon',to_regclass(format('public.%I',n.table_name)),'UPDATE')
           or has_table_privilege('anon',to_regclass(format('public.%I',n.table_name)),'DELETE')
           or has_table_privilege('authenticated',to_regclass(format('public.%I',n.table_name)),'SELECT')
           or has_table_privilege('authenticated',to_regclass(format('public.%I',n.table_name)),'INSERT')
           or has_table_privilege('authenticated',to_regclass(format('public.%I',n.table_name)),'UPDATE')
           or has_table_privilege('authenticated',to_regclass(format('public.%I',n.table_name)),'DELETE') then 'REPAIRABLE'
         else 'PASS' end as status,
    case when to_regclass(format('public.%I',n.table_name)) is null then 'migration will restrict it'
         else format('anon_dml=%s authenticated_dml=%s service_role_select=%s',
           has_table_privilege('anon',to_regclass(format('public.%I',n.table_name)),'SELECT') or has_table_privilege('anon',to_regclass(format('public.%I',n.table_name)),'INSERT') or has_table_privilege('anon',to_regclass(format('public.%I',n.table_name)),'UPDATE') or has_table_privilege('anon',to_regclass(format('public.%I',n.table_name)),'DELETE'),
           has_table_privilege('authenticated',to_regclass(format('public.%I',n.table_name)),'SELECT') or has_table_privilege('authenticated',to_regclass(format('public.%I',n.table_name)),'INSERT') or has_table_privilege('authenticated',to_regclass(format('public.%I',n.table_name)),'UPDATE') or has_table_privilege('authenticated',to_regclass(format('public.%I',n.table_name)),'DELETE'),
           has_table_privilege('service_role',to_regclass(format('public.%I',n.table_name)),'SELECT')) end as details
  from expected_counts n
),
function_check as (
  select 'function:delete_dharmasetu_account_data(uuid,text,text)' as check_name,
    case when p.oid is null then 'ABSENT_EXPECTED'
         when pg_get_function_result(p.oid)<>'boolean' then 'FAIL'
         else 'REPLACEABLE' end as status,
    case when p.oid is null then 'migration will create it'
         else format('return=%s security_definer=%s execute_anon=%s execute_authenticated=%s execute_service_role=%s',
           pg_get_function_result(p.oid),p.prosecdef,
           has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),
           has_function_privilege('service_role',p.oid,'EXECUTE')) end as details
  from (select to_regprocedure('public.delete_dharmasetu_account_data(uuid,text,text)') as oid) x
  left join pg_catalog.pg_proc p on p.oid=x.oid
),
checks as (
  select * from base_checks union all select * from lifecycle_checks
  union all select * from default_checks union all select * from constraint_checks union all select * from index_checks
  union all select * from rls_checks union all select * from privilege_checks
  union all select * from function_check
)
select check_name,status,details from checks
union all
select 'migration_readiness',case when count(*) filter(where status='FAIL')=0 then 'PASS' else 'FAIL' end,
       format('failures=%s; ABSENT_EXPECTED lifecycle objects are safe',count(*) filter(where status='FAIL'))
from checks
order by check_name;
