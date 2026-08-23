-- REVIEW ONLY. DO NOT EXECUTE AUTOMATICALLY.
-- Run 20260822_account_birth_jyotish_lifecycle_PREFLIGHT.sql first.

begin;

-- Fail before making changes when a prerequisite or partial lifecycle object is incompatible.
do $migration_guard$
declare
  r record;
  actual_type text;
  actual_nullable text;
begin
  for r in select * from (values
    ('users','id','uuid_or_text'), ('users','phone','text'), ('payments','phone','text'),
    ('user_notifications','user_id','uuid'), ('ai_feedback','user_id','uuid'),
    ('ai_usage_reservations','user_id','uuid'), ('ai_daily_usage','user_id','uuid')
  ) as required(table_name,column_name,type_family)
  loop
    if to_regclass(format('public.%I',r.table_name)) is null then
      raise exception using message=format('account lifecycle prerequisite missing: public.%I',r.table_name);
    end if;
    select format_type(a.atttypid,a.atttypmod) into actual_type
      from pg_catalog.pg_attribute a
     where a.attrelid=to_regclass(format('public.%I',r.table_name))
       and a.attname=r.column_name and a.attnum>0 and not a.attisdropped;
    if actual_type is null then
      raise exception using message=format('account lifecycle prerequisite missing: public.%I.%I',r.table_name,r.column_name);
    end if;
    if r.type_family='uuid' and actual_type<>'uuid' then
      raise exception using message=format('account lifecycle incompatible column: public.%I.%I must be uuid',r.table_name,r.column_name);
    end if;
    if r.type_family='uuid_or_text' and actual_type!~'^(uuid|text|character varying(\([0-9]+\))?|character(\([0-9]+\))?)$' then
      raise exception using message=format('account lifecycle incompatible column: public.%I.%I must be uuid or text-compatible',r.table_name,r.column_name);
    end if;
    if r.type_family='text' and actual_type !~ '^(text|character varying(\([0-9]+\))?|character(\([0-9]+\))?)$' then
      raise exception using message=format('account lifecycle incompatible column: public.%I.%I must be text-compatible',r.table_name,r.column_name);
    end if;
  end loop;

  for r in select * from (values
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
  ) as expected_constraint(table_name,constraint_name)
  loop
    if to_regclass(format('public.%I',r.table_name)) is not null and not exists (
      select 1 from pg_catalog.pg_constraint c
       where c.conrelid=to_regclass(format('public.%I',r.table_name)) and c.conname=r.constraint_name
         and c.contype=case when r.constraint_name like '%_pkey' then 'p'::"char"
                            when r.constraint_name like '%_fkey' then 'f'::"char"
                            when r.constraint_name like '%_check' then 'c'::"char"
                            else 'u'::"char" end
         and (r.constraint_name not like '%_user_id_fkey'
              or (c.confrelid='auth.users'::regclass and pg_get_constraintdef(c.oid) like '%(user_id)%ON DELETE CASCADE%'))
         and (r.constraint_name not like '%_pkey'
              or (r.table_name<>'account_deletion_audit' and pg_get_constraintdef(c.oid) like 'PRIMARY KEY (user_id)%')
              or (r.table_name='account_deletion_audit' and pg_get_constraintdef(c.oid) like 'PRIMARY KEY (id)%'))
    ) then
      raise exception using message=format('incompatible existing lifecycle table: public.%I missing constraint %I',r.table_name,r.constraint_name);
    end if;
  end loop;

  for r in select * from (values
    ('user_profiles','language'),('user_profiles','interests'),('user_profiles','onboarding_status'),
    ('user_profiles','created_at'),('user_profiles','updated_at'),
    ('birth_profiles','profile_version'),('birth_profiles','created_at'),('birth_profiles','updated_at'),
    ('jyotish_profiles','status'),('jyotish_profiles','updated_at'),
    ('account_deletion_audit','id'),('account_deletion_audit','created_at')
  ) as expected_default(table_name,column_name)
  loop
    if to_regclass(format('public.%I',r.table_name)) is not null and not exists (
      select 1 from information_schema.columns c
       where c.table_schema='public' and c.table_name=r.table_name
         and c.column_name=r.column_name and c.column_default is not null
    ) then
      raise exception using message=format('incompatible existing lifecycle column: public.%I.%I requires a default',r.table_name,r.column_name);
    end if;
  end loop;

  for r in select * from (values
    ('user_profiles_onboarding_idx','user_profiles'),('jyotish_profiles_status_idx','jyotish_profiles')
  ) as expected_index(index_name,table_name)
  loop
    if to_regclass('public.'||r.index_name) is not null and not exists (
      select 1 from pg_catalog.pg_index i
       where i.indexrelid=to_regclass('public.'||r.index_name)
         and i.indrelid=to_regclass('public.'||r.table_name)
         and pg_get_indexdef(i.indexrelid) like case when r.index_name='user_profiles_onboarding_idx'
              then '%(onboarding_status)%' else '%(status)%' end
    ) then
      raise exception using message=format('incompatible existing index: public.%I',r.index_name);
    end if;
  end loop;

  select format_type(a.atttypid,a.atttypmod) into actual_type
    from pg_catalog.pg_attribute a
   where a.attrelid='public.payments'::regclass and a.attname='phone'
     and a.attnum>0 and not a.attisdropped;
  if actual_type ~ '^character( varying)?\([0-9]+\)$'
     and substring(actual_type from '\(([0-9]+)\)')::integer<20 then
    raise exception 'account lifecycle incompatible column: public.payments.phone must accept at least 20 characters';
  end if;

  for r in select * from (values
    ('user_profiles','user_id','uuid','NO'), ('user_profiles','name','text','NO'),
    ('user_profiles','gender','text','NO'), ('user_profiles','language','text','NO'),
    ('user_profiles','interests','ARRAY','NO'), ('user_profiles','current_place_name','text','YES'),
    ('user_profiles','current_latitude','double precision','YES'), ('user_profiles','current_longitude','double precision','YES'),
    ('user_profiles','current_timezone','text','YES'), ('user_profiles','onboarding_status','text','NO'),
    ('user_profiles','birth_data_consent_at','timestamp with time zone','NO'),
    ('user_profiles','birth_data_consent_version','text','NO'),
    ('user_profiles','created_at','timestamp with time zone','NO'), ('user_profiles','updated_at','timestamp with time zone','NO'),
    ('birth_profiles','user_id','uuid','NO'), ('birth_profiles','date_of_birth','date','NO'),
    ('birth_profiles','birth_time','time without time zone','YES'), ('birth_profiles','birth_time_certainty','text','NO'),
    ('birth_profiles','birthplace_input','text','NO'), ('birth_profiles','place_name','text','NO'),
    ('birth_profiles','city','text','YES'), ('birth_profiles','region','text','YES'),
    ('birth_profiles','country','text','NO'), ('birth_profiles','country_code','text','YES'),
    ('birth_profiles','latitude','double precision','NO'), ('birth_profiles','longitude','double precision','NO'),
    ('birth_profiles','timezone','text','NO'), ('birth_profiles','utc_offset_minutes','integer','NO'),
    ('birth_profiles','profile_version','integer','NO'), ('birth_profiles','input_fingerprint','text','NO'),
    ('birth_profiles','created_at','timestamp with time zone','NO'), ('birth_profiles','updated_at','timestamp with time zone','NO'),
    ('jyotish_profiles','user_id','uuid','NO'), ('jyotish_profiles','birth_profile_version','integer','NO'),
    ('jyotish_profiles','input_fingerprint','text','NO'), ('jyotish_profiles','status','text','NO'),
    ('jyotish_profiles','provider','text','YES'), ('jyotish_profiles','calculation_version','text','YES'),
    ('jyotish_profiles','ayanamsha','text','YES'), ('jyotish_profiles','chart_data','jsonb','YES'),
    ('jyotish_profiles','compact_context','jsonb','YES'), ('jyotish_profiles','failure_code','text','YES'),
    ('jyotish_profiles','generated_at','timestamp with time zone','YES'),
    ('jyotish_profiles','updated_at','timestamp with time zone','NO'),
    ('account_deletion_audit','id','uuid','NO'), ('account_deletion_audit','deleted_user_hash','text','NO'),
    ('account_deletion_audit','result','text','NO'), ('account_deletion_audit','created_at','timestamp with time zone','NO')
  ) as expected(table_name,column_name,data_type,is_nullable)
  loop
    if to_regclass(format('public.%I',r.table_name)) is not null then
      select c.data_type,c.is_nullable into actual_type,actual_nullable
        from information_schema.columns c
       where c.table_schema='public' and c.table_name=r.table_name and c.column_name=r.column_name;
      if actual_type is distinct from r.data_type or actual_nullable is distinct from r.is_nullable then
        raise exception using message=format('incompatible existing lifecycle column: public.%I.%I expected %s nullable=%s',r.table_name,r.column_name,r.data_type,r.is_nullable);
      end if;
    end if;
  end loop;

  for r in select * from (values
    ('user_profiles',14), ('birth_profiles',18), ('jyotish_profiles',13), ('account_deletion_audit',4)
  ) as counts(table_name,expected_count)
  loop
    if to_regclass(format('public.%I',r.table_name)) is not null
       and (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=r.table_name)<>r.expected_count then
      raise exception using message=format('incompatible existing lifecycle table shape: public.%I',r.table_name);
    end if;
  end loop;

  if to_regprocedure('public.delete_dharmasetu_account_data(uuid,text,text)') is not null
     and pg_get_function_result(to_regprocedure('public.delete_dharmasetu_account_data(uuid,text,text)'))<>'boolean' then
    raise exception 'incompatible existing function: public.delete_dharmasetu_account_data(uuid,text,text) must return boolean';
  end if;
end
$migration_guard$;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  gender text not null,
  language text not null default 'hindi',
  interests text[] not null default '{}',
  current_place_name text,
  current_latitude double precision,
  current_longitude double precision,
  current_timezone text,
  onboarding_status text not null default 'PROFILE_PENDING',
  birth_data_consent_at timestamptz not null,
  birth_data_consent_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_gender_check check (gender in ('male','female','other','prefer_not_to_say')),
  constraint user_profiles_language_check check (language in ('hindi','english')),
  constraint user_profiles_onboarding_check check (onboarding_status in ('PROFILE_PENDING','BIRTHPLACE_PENDING','KUNDLI_PENDING','KUNDLI_READY'))
);

create table if not exists public.birth_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  date_of_birth date not null,
  birth_time time,
  birth_time_certainty text not null,
  birthplace_input text not null,
  place_name text not null,
  city text,
  region text,
  country text not null,
  country_code text,
  latitude double precision not null,
  longitude double precision not null,
  timezone text not null,
  utc_offset_minutes integer not null,
  profile_version integer not null default 1,
  input_fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint birth_profiles_time_certainty_check check (birth_time_certainty in ('EXACT','APPROXIMATE','UNCERTAIN','UNKNOWN')),
  constraint birth_profiles_time_check check ((birth_time_certainty='UNKNOWN' and birth_time is null) or (birth_time_certainty<>'UNKNOWN' and birth_time is not null)),
  constraint birth_profiles_latitude_check check (latitude between -90 and 90),
  constraint birth_profiles_longitude_check check (longitude between -180 and 180),
  constraint birth_profiles_offset_check check (utc_offset_minutes between -720 and 840),
  constraint birth_profiles_version_check check (profile_version>=1)
);

create table if not exists public.jyotish_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_profile_version integer not null,
  input_fingerprint text not null,
  status text not null default 'KUNDLI_PENDING',
  provider text,
  calculation_version text,
  ayanamsha text,
  chart_data jsonb,
  compact_context jsonb,
  failure_code text,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint jyotish_profiles_status_check check (status in ('KUNDLI_PENDING','KUNDLI_READY','INPUT_CORRECTION_REQUIRED','PROVIDER_UNAVAILABLE')),
  constraint jyotish_profiles_version_check check (birth_profile_version>=1)
);

create table if not exists public.account_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  deleted_user_hash text not null unique,
  result text not null,
  created_at timestamptz not null default now(),
  constraint account_deletion_audit_result_check check (result in ('DATA_DELETED_AUTH_PENDING','COMPLETE'))
);

create index if not exists user_profiles_onboarding_idx on public.user_profiles(onboarding_status);
create index if not exists jyotish_profiles_status_idx on public.jyotish_profiles(status);

alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;
alter table public.birth_profiles enable row level security;
alter table public.birth_profiles force row level security;
alter table public.jyotish_profiles enable row level security;
alter table public.jyotish_profiles force row level security;
alter table public.account_deletion_audit enable row level security;
alter table public.account_deletion_audit force row level security;

revoke all on public.user_profiles, public.birth_profiles, public.jyotish_profiles, public.account_deletion_audit from public, anon, authenticated;
grant select, insert, update, delete on public.user_profiles, public.birth_profiles, public.jyotish_profiles to service_role;
grant select, insert, update on public.account_deletion_audit to service_role;

create or replace function public.delete_dharmasetu_account_data(p_user_id uuid,p_phone text,p_deleted_hash text)
returns boolean
language plpgsql
security definer
set search_path=''
as $function$
begin
  if p_user_id is null or p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$'
     or p_deleted_hash is null or p_deleted_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid deletion request';
  end if;

  -- Validate retained-payment storage before the first destructive statement.
  if pg_catalog.to_regclass('public.payments') is null or not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid=pg_catalog.to_regclass('public.payments') and a.attname='phone'
       and a.attnum>0 and not a.attisdropped
  ) then
    raise exception 'account deletion storage is not configured';
  end if;

  delete from public.user_notifications where user_id=p_user_id;
  delete from public.ai_feedback where user_id=p_user_id;
  delete from public.ai_usage_reservations where user_id=p_user_id;
  delete from public.ai_daily_usage where user_id=p_user_id;
  delete from public.jyotish_profiles where user_id=p_user_id;
  delete from public.birth_profiles where user_id=p_user_id;
  delete from public.user_profiles where user_id=p_user_id;

  update public.payments set phone='deleted_' || pg_catalog.left(p_deleted_hash,12) where phone=p_phone;

  -- id::text supports both UUID and legacy textual public.users identifiers.
  delete from public.users where id::text=p_user_id::text or phone=p_phone;

  insert into public.account_deletion_audit(deleted_user_hash,result)
  values (p_deleted_hash,'DATA_DELETED_AUTH_PENDING')
  on conflict (deleted_user_hash) do update
    set result='DATA_DELETED_AUTH_PENDING',created_at=pg_catalog.now();
  return true;
end
$function$;

revoke all on function public.delete_dharmasetu_account_data(uuid,text,text) from public, anon, authenticated;
grant execute on function public.delete_dharmasetu_account_data(uuid,text,text) to service_role;

commit;
