-- READ ONLY. Run only after the canonical migration succeeds.
with
tables(table_name) as (values ('user_profiles'),('birth_profiles'),('jyotish_profiles'),('account_deletion_audit')),
table_checks as (
  select 'table:'||t.table_name as check_name,
    case when c.oid is not null then 'PASS' else 'FAIL' end as status,
    case when c.oid is null then 'missing' else format('rls=%s force_rls=%s',c.relrowsecurity,c.relforcerowsecurity) end as details
  from tables t left join pg_catalog.pg_class c on c.oid=to_regclass(format('public.%I',t.table_name))
),
rls_checks as (
  select 'rls:'||t.table_name as check_name,
    case when c.relrowsecurity and c.relforcerowsecurity then 'PASS' else 'FAIL' end as status,
    format('enabled=%s forced=%s',coalesce(c.relrowsecurity,false),coalesce(c.relforcerowsecurity,false)) as details
  from tables t left join pg_catalog.pg_class c on c.oid=to_regclass(format('public.%I',t.table_name))
),
expected_columns(table_name,column_name,formatted_type,not_null) as (
  values
    ('user_profiles','user_id','uuid',true),('user_profiles','name','text',true),
    ('user_profiles','gender','text',true),('user_profiles','language','text',true),
    ('user_profiles','interests','text[]',true),('user_profiles','current_place_name','text',false),
    ('user_profiles','current_latitude','double precision',false),('user_profiles','current_longitude','double precision',false),
    ('user_profiles','current_timezone','text',false),('user_profiles','onboarding_status','text',true),
    ('user_profiles','birth_data_consent_at','timestamp with time zone',true),('user_profiles','birth_data_consent_version','text',true),
    ('user_profiles','created_at','timestamp with time zone',true),('user_profiles','updated_at','timestamp with time zone',true),
    ('birth_profiles','user_id','uuid',true),('birth_profiles','date_of_birth','date',true),
    ('birth_profiles','birth_time','time without time zone',false),('birth_profiles','birth_time_certainty','text',true),
    ('birth_profiles','birthplace_input','text',true),('birth_profiles','place_name','text',true),
    ('birth_profiles','city','text',false),('birth_profiles','region','text',false),
    ('birth_profiles','country','text',true),('birth_profiles','country_code','text',false),
    ('birth_profiles','latitude','double precision',true),('birth_profiles','longitude','double precision',true),
    ('birth_profiles','timezone','text',true),('birth_profiles','utc_offset_minutes','integer',true),
    ('birth_profiles','profile_version','integer',true),('birth_profiles','input_fingerprint','text',true),
    ('birth_profiles','created_at','timestamp with time zone',true),('birth_profiles','updated_at','timestamp with time zone',true),
    ('jyotish_profiles','user_id','uuid',true),('jyotish_profiles','birth_profile_version','integer',true),
    ('jyotish_profiles','input_fingerprint','text',true),('jyotish_profiles','status','text',true),
    ('jyotish_profiles','provider','text',false),('jyotish_profiles','calculation_version','text',false),
    ('jyotish_profiles','ayanamsha','text',false),('jyotish_profiles','chart_data','jsonb',false),
    ('jyotish_profiles','compact_context','jsonb',false),('jyotish_profiles','failure_code','text',false),
    ('jyotish_profiles','generated_at','timestamp with time zone',false),('jyotish_profiles','updated_at','timestamp with time zone',true),
    ('account_deletion_audit','id','uuid',true),('account_deletion_audit','deleted_user_hash','text',true),
    ('account_deletion_audit','result','text',true),('account_deletion_audit','created_at','timestamp with time zone',true)
),
column_checks as (
  select 'columns:'||e.table_name as check_name,
    case when count(a.attname)=count(*) and bool_and(format_type(a.atttypid,a.atttypmod)=e.formatted_type and a.attnotnull=e.not_null)
         then 'PASS' else 'FAIL' end as status,
    format('compatible=%s expected=%s',count(*) filter(where format_type(a.atttypid,a.atttypmod)=e.formatted_type and a.attnotnull=e.not_null),count(*)) as details
  from expected_columns e
  left join pg_catalog.pg_attribute a on a.attrelid=to_regclass(format('public.%I',e.table_name))
    and a.attname=e.column_name and a.attnum>0 and not a.attisdropped
  group by e.table_name
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
    case when count(c.column_name) filter(where c.column_default is not null)=count(*) then 'PASS' else 'FAIL' end as status,
    format('present=%s expected=%s',count(c.column_name) filter(where c.column_default is not null),count(*)) as details
  from expected_defaults e left join information_schema.columns c
    on c.table_schema='public' and c.table_name=e.table_name and c.column_name=e.column_name
  group by e.table_name
),
expected_constraints(table_name,constraint_name) as (
  values
    ('user_profiles','user_profiles_pkey'),('user_profiles','user_profiles_user_id_fkey'),
    ('user_profiles','user_profiles_gender_check'),('user_profiles','user_profiles_language_check'),('user_profiles','user_profiles_onboarding_check'),
    ('birth_profiles','birth_profiles_pkey'),('birth_profiles','birth_profiles_user_id_fkey'),
    ('birth_profiles','birth_profiles_time_certainty_check'),('birth_profiles','birth_profiles_time_check'),
    ('birth_profiles','birth_profiles_latitude_check'),('birth_profiles','birth_profiles_longitude_check'),
    ('birth_profiles','birth_profiles_offset_check'),('birth_profiles','birth_profiles_version_check'),
    ('jyotish_profiles','jyotish_profiles_pkey'),('jyotish_profiles','jyotish_profiles_user_id_fkey'),
    ('jyotish_profiles','jyotish_profiles_status_check'),('jyotish_profiles','jyotish_profiles_version_check'),
    ('account_deletion_audit','account_deletion_audit_pkey'),('account_deletion_audit','account_deletion_audit_deleted_user_hash_key'),
    ('account_deletion_audit','account_deletion_audit_result_check')
),
constraint_checks as (
  select 'constraints:'||e.table_name as check_name,
    case when count(c.oid)=count(*) then 'PASS' else 'FAIL' end as status,
    format('present=%s expected=%s; %s',count(c.oid),count(*),
      string_agg(e.constraint_name||'='||coalesce(pg_get_constraintdef(c.oid),'MISSING'),'; ' order by e.constraint_name)) as details
  from expected_constraints e left join pg_catalog.pg_constraint c
    on c.conrelid=to_regclass(format('public.%I',e.table_name)) and c.conname=e.constraint_name
   and c.contype=case when e.constraint_name like '%_pkey' then 'p'::"char"
                      when e.constraint_name like '%_fkey' then 'f'::"char"
                      when e.constraint_name like '%_check' then 'c'::"char" else 'u'::"char" end
   and (e.constraint_name not like '%_user_id_fkey'
        or (c.confrelid='auth.users'::regclass and pg_get_constraintdef(c.oid) like '%(user_id)%ON DELETE CASCADE%'))
  group by e.table_name
),
index_checks as (
  select 'index:'||v.index_name as check_name,
    case when i.indrelid=to_regclass('public.'||v.table_name)
       and pg_get_indexdef(i.indexrelid) like case when v.index_name='user_profiles_onboarding_idx'
            then '%(onboarding_status)%' else '%(status)%' end then 'PASS' else 'FAIL' end as status,
    coalesce('attached_to='||i.indrelid::regclass::text,'missing') as details
  from (values ('user_profiles_onboarding_idx','user_profiles'),('jyotish_profiles_status_idx','jyotish_profiles')) v(index_name,table_name)
  left join pg_catalog.pg_index i on i.indexrelid=to_regclass('public.'||v.index_name)
),
privilege_checks as (
  select 'privileges:'||t.table_name as check_name,
    case when not (has_table_privilege('anon',to_regclass(format('public.%I',t.table_name)),'SELECT') or has_table_privilege('anon',to_regclass(format('public.%I',t.table_name)),'INSERT') or has_table_privilege('anon',to_regclass(format('public.%I',t.table_name)),'UPDATE') or has_table_privilege('anon',to_regclass(format('public.%I',t.table_name)),'DELETE'))
           and not (has_table_privilege('authenticated',to_regclass(format('public.%I',t.table_name)),'SELECT') or has_table_privilege('authenticated',to_regclass(format('public.%I',t.table_name)),'INSERT') or has_table_privilege('authenticated',to_regclass(format('public.%I',t.table_name)),'UPDATE') or has_table_privilege('authenticated',to_regclass(format('public.%I',t.table_name)),'DELETE'))
           and has_table_privilege('service_role',to_regclass(format('public.%I',t.table_name)),'SELECT')
           and has_table_privilege('service_role',to_regclass(format('public.%I',t.table_name)),'INSERT')
           and has_table_privilege('service_role',to_regclass(format('public.%I',t.table_name)),'UPDATE')
           and (t.table_name='account_deletion_audit' or has_table_privilege('service_role',to_regclass(format('public.%I',t.table_name)),'DELETE'))
           and (t.table_name<>'account_deletion_audit' or not has_table_privilege('service_role',to_regclass(format('public.%I',t.table_name)),'DELETE'))
         then 'PASS' else 'FAIL' end as status,
    format('anon_dml=%s authenticated_dml=%s service_role_select=%s',
      has_table_privilege('anon',to_regclass(format('public.%I',t.table_name)),'SELECT') or has_table_privilege('anon',to_regclass(format('public.%I',t.table_name)),'INSERT') or has_table_privilege('anon',to_regclass(format('public.%I',t.table_name)),'UPDATE') or has_table_privilege('anon',to_regclass(format('public.%I',t.table_name)),'DELETE'),
      has_table_privilege('authenticated',to_regclass(format('public.%I',t.table_name)),'SELECT') or has_table_privilege('authenticated',to_regclass(format('public.%I',t.table_name)),'INSERT') or has_table_privilege('authenticated',to_regclass(format('public.%I',t.table_name)),'UPDATE') or has_table_privilege('authenticated',to_regclass(format('public.%I',t.table_name)),'DELETE'),
      has_table_privilege('service_role',to_regclass(format('public.%I',t.table_name)),'SELECT')) as details
  from tables t
),
function_check as (
  select 'function:delete_dharmasetu_account_data(uuid,text,text)' as check_name,
    case when p.oid is not null and p.prosecdef and pg_get_function_result(p.oid)='boolean'
       and position('search_path=""' in coalesce(array_to_string(p.proconfig,','),''))>0
       and not has_function_privilege('anon',p.oid,'EXECUTE')
       and not has_function_privilege('authenticated',p.oid,'EXECUTE')
       and has_function_privilege('service_role',p.oid,'EXECUTE') then 'PASS' else 'FAIL' end as status,
    case when p.oid is null then 'missing' else format('security_definer=%s return=%s config=%s anon=%s authenticated=%s service_role=%s',
      p.prosecdef,pg_get_function_result(p.oid),coalesce(array_to_string(p.proconfig,','),'none'),
      has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),
      has_function_privilege('service_role',p.oid,'EXECUTE')) end as details
  from (select to_regprocedure('public.delete_dharmasetu_account_data(uuid,text,text)') oid) x
  left join pg_catalog.pg_proc p on p.oid=x.oid
),
checks as (
  select * from table_checks union all select * from rls_checks union all select * from column_checks union all select * from default_checks
  union all select * from constraint_checks union all select * from index_checks
  union all select * from privilege_checks union all select * from function_check
)
select check_name,status,details from checks
union all
select 'verification_result',case when count(*) filter(where status='FAIL')=0 then 'PASS' else 'FAIL' end,
  format('failures=%s',count(*) filter(where status='FAIL')) from checks
order by check_name;
