begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Fail closed: incompatible existing quota objects are never destroyed.
do $$
declare missing_columns text;
begin
  if to_regclass('public.users') is null then
    raise exception 'Preflight failed: public.users does not exist';
  end if;

  select string_agg(r.name, ', ' order by r.name) into missing_columns
  from (values
    ('admin_override','text'),
    ('admin_override_expires_at','timestamp with time zone'),
    ('admin_override_reason','text'),
    ('admin_override_updated_at','timestamp with time zone')
  ) r(name,data_type)
  where exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name='users' and c.column_name=r.name
  ) and not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name='users'
      and c.column_name=r.name and c.data_type=r.data_type
  );
  if missing_columns is not null then
    raise exception 'Existing public.users has incompatible override columns: %', missing_columns;
  end if;

  if to_regclass('public.ai_daily_usage') is not null then
    select string_agg(r.name, ', ' order by r.name) into missing_columns
    from (values ('user_id','uuid'), ('usage_date','date'),
      ('dharma_questions','integer'), ('factcheck_questions','integer'),
      ('updated_at','timestamp with time zone')) r(name,data_type)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name='ai_daily_usage'
        and c.column_name=r.name and c.data_type=r.data_type and c.is_nullable='NO'
    );
    if missing_columns is not null then
      raise exception 'Existing public.ai_daily_usage has incompatible columns: %', missing_columns;
    end if;
  end if;

  if to_regclass('public.ai_usage_reservations') is not null then
    select string_agg(r.name, ', ' order by r.name) into missing_columns
    from (values ('reservation_id','uuid'), ('user_id','uuid'),
      ('usage_date','date'), ('kind','text'), ('status','text'),
      ('created_at','timestamp with time zone'), ('expires_at','timestamp with time zone'),
      ('finalized_at','timestamp with time zone')) r(name,data_type)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name='ai_usage_reservations'
        and c.column_name=r.name and c.data_type=r.data_type
        and (r.name='finalized_at' or c.is_nullable='NO')
    );
    if missing_columns is not null then
      raise exception 'Existing public.ai_usage_reservations has incompatible columns: %', missing_columns;
    end if;
  end if;
end $$;

alter table public.users
  add column if not exists admin_override text,
  add column if not exists admin_override_expires_at timestamptz,
  add column if not exists admin_override_reason text,
  add column if not exists admin_override_updated_at timestamptz;

-- Preserve unexpected legacy values in the audit reason, then fail closed to no
-- override. Base plan and payment history are never touched.
update public.users
set admin_override_reason=concat_ws(' | ',nullif(admin_override_reason,''),
      '[migration preserved invalid override: '||left(admin_override,80)||']'),
    admin_override=null, admin_override_expires_at=null,
    admin_override_updated_at=now()
where admin_override is not null
  and (btrim(admin_override)='' or lower(btrim(admin_override)) not in ('basic','pro','full'));

update public.users set admin_override=lower(btrim(admin_override))
where admin_override is not null and admin_override<>lower(btrim(admin_override));

alter table public.users drop constraint if exists users_admin_override_check;
alter table public.users add constraint users_admin_override_check
  check (admin_override is null or admin_override in ('basic','pro','full'));

create table if not exists public.ai_daily_usage (
  user_id uuid not null,
  usage_date date not null,
  dharma_questions integer not null default 0,
  factcheck_questions integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint ai_daily_usage_pkey primary key(user_id,usage_date),
  constraint ai_daily_usage_user_id_fkey foreign key(user_id)
    references auth.users(id) on delete cascade,
  constraint ai_daily_usage_dharma_questions_check check(dharma_questions>=0),
  constraint ai_daily_usage_factcheck_questions_check check(factcheck_questions>=0)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_daily_usage'::regclass and contype in ('p','u')
      and conkey=array[
        (select attnum from pg_attribute where attrelid='public.ai_daily_usage'::regclass and attname='user_id'),
        (select attnum from pg_attribute where attrelid='public.ai_daily_usage'::regclass and attname='usage_date')
      ]::smallint[]
  ) then
    alter table public.ai_daily_usage
      add constraint ai_daily_usage_user_date_key unique(user_id,usage_date);
  end if;
end $$;

do $$
declare missing_constraints text;
begin
  select string_agg(required_name, ', ' order by required_name) into missing_constraints
  from unnest(array['ai_daily_usage_user_id_fkey',
    'ai_daily_usage_dharma_questions_check','ai_daily_usage_factcheck_questions_check'])
    as required(required_name)
  where not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_daily_usage'::regclass and conname=required_name
  );
  if missing_constraints is not null then
    raise exception 'Existing public.ai_daily_usage lacks required constraints: %',missing_constraints;
  end if;
end $$;

create table if not exists public.ai_usage_reservations (
  reservation_id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  usage_date date not null,
  kind text not null,
  status text not null default 'reserved',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '10 minutes'),
  finalized_at timestamptz,
  constraint ai_usage_reservations_user_id_fkey foreign key(user_id)
    references auth.users(id) on delete cascade,
  constraint ai_usage_reservations_kind_check check(kind in ('dharma','factcheck')),
  constraint ai_usage_reservations_status_check check(status in ('reserved','consumed','released')),
  constraint ai_usage_reservations_usage_fkey foreign key(user_id,usage_date)
    references public.ai_daily_usage(user_id,usage_date) on delete cascade
);

do $$
declare missing_constraints text;
begin
  select string_agg(required_name, ', ' order by required_name) into missing_constraints
  from unnest(array['ai_usage_reservations_pkey','ai_usage_reservations_user_id_fkey',
    'ai_usage_reservations_kind_check','ai_usage_reservations_status_check',
    'ai_usage_reservations_usage_fkey']) as required(required_name)
  where not exists (
    select 1 from pg_constraint
    where conrelid='public.ai_usage_reservations'::regclass and conname=required_name
  );
  if missing_constraints is not null then
    raise exception 'Existing public.ai_usage_reservations lacks required constraints: %',missing_constraints;
  end if;
end $$;

create index if not exists ai_daily_usage_usage_date_idx
  on public.ai_daily_usage(usage_date);
create index if not exists ai_usage_reservations_user_date_idx
  on public.ai_usage_reservations(user_id,usage_date);
create index if not exists ai_usage_reservations_active_idx
  on public.ai_usage_reservations(user_id,usage_date,expires_at)
  where status='reserved';

alter table public.ai_daily_usage enable row level security;
alter table public.ai_daily_usage force row level security;
alter table public.ai_usage_reservations enable row level security;
alter table public.ai_usage_reservations force row level security;
revoke all on table public.ai_daily_usage from public,anon,authenticated;
revoke all on table public.ai_usage_reservations from public,anon,authenticated;
grant select,insert,update on table public.ai_daily_usage to service_role;
grant select,insert,update on table public.ai_usage_reservations to service_role;

drop function if exists public.reserve_ai_usage(uuid,date,text,integer);
drop function if exists public.release_ai_usage(uuid,date,text);

create or replace function public.reserve_ai_usage(p_user_id uuid,p_kind text,p_limit integer)
returns table(reservation_id uuid,allowed boolean,used integer,remaining integer,usage_date date)
language plpgsql security invoker set search_path=pg_catalog,extensions as $$
declare
  -- V1 quota day is a backend/database product rule, never a mobile-supplied
  -- value. A future per-account timezone can replace this expression while the
  -- immutable Supabase Auth UUID ownership key remains unchanged.
  effective_date date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
  current_used integer;
  new_reservation_id uuid;
  released_dharma integer := 0;
  released_factcheck integer := 0;
begin
  if p_user_id is null then raise exception 'user id is required'; end if;
  if p_kind not in ('dharma','factcheck') then raise exception 'invalid usage kind'; end if;
  if p_limit is not null and p_limit<=0 then
    raise exception 'limit must be a positive integer or null';
  end if;

  insert into public.ai_daily_usage(user_id,usage_date)
  values(p_user_id,effective_date)
  on conflict on constraint ai_daily_usage_pkey do nothing;

  with released as (
    update public.ai_usage_reservations as r
    set status='released',finalized_at=statement_timestamp()
    where r.user_id=p_user_id and r.usage_date=effective_date
      and r.status='reserved' and r.expires_at<=statement_timestamp()
    returning r.kind
  )
  select count(*) filter(where r.kind='dharma')::integer,
         count(*) filter(where r.kind='factcheck')::integer
  into released_dharma,released_factcheck from released as r;

  if released_dharma>0 or released_factcheck>0 then
    update public.ai_daily_usage as u
    set dharma_questions=greatest(u.dharma_questions-released_dharma,0),
        factcheck_questions=greatest(u.factcheck_questions-released_factcheck,0),
        updated_at=statement_timestamp()
    where u.user_id=p_user_id and u.usage_date=effective_date;
  end if;

  if p_kind='dharma' then
    update public.ai_daily_usage as u
    set dharma_questions=u.dharma_questions+1,updated_at=statement_timestamp()
    where u.user_id=p_user_id and u.usage_date=effective_date
      and (p_limit is null or u.dharma_questions<p_limit)
    returning u.dharma_questions into current_used;
  else
    update public.ai_daily_usage as u
    set factcheck_questions=u.factcheck_questions+1,updated_at=statement_timestamp()
    where u.user_id=p_user_id and u.usage_date=effective_date
      and (p_limit is null or u.factcheck_questions<p_limit)
    returning u.factcheck_questions into current_used;
  end if;

  if current_used is null then
    select case when p_kind='dharma' then d.dharma_questions else d.factcheck_questions end
    into current_used from public.ai_daily_usage d
    where d.user_id=p_user_id and d.usage_date=effective_date;
    return query select null::uuid,false,current_used,0,effective_date;
    return;
  end if;

  new_reservation_id:=extensions.gen_random_uuid();
  insert into public.ai_usage_reservations(reservation_id,user_id,usage_date,kind)
  values(new_reservation_id,p_user_id,effective_date,p_kind);
  return query select new_reservation_id,true,current_used,
    case when p_limit is null then null else greatest(p_limit-current_used,0) end,
    effective_date;
end $$;

create or replace function public.consume_ai_usage(p_user_id uuid,p_reservation_id uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare changed_id uuid;
begin
  update public.ai_usage_reservations as r
  set status='consumed',finalized_at=statement_timestamp()
  where r.reservation_id=p_reservation_id and r.user_id=p_user_id and r.status='reserved'
  returning r.reservation_id into changed_id;
  if changed_id is not null then return true; end if;
  return exists(select 1 from public.ai_usage_reservations as r
    where r.reservation_id=p_reservation_id and r.user_id=p_user_id and r.status='consumed');
end $$;

create or replace function public.release_ai_usage(p_user_id uuid,p_reservation_id uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare released_kind text; released_date date;
begin
  update public.ai_usage_reservations as r
  set status='released',finalized_at=statement_timestamp()
  where r.reservation_id=p_reservation_id and r.user_id=p_user_id and r.status='reserved'
  returning r.kind,r.usage_date into released_kind,released_date;
  if released_kind is null then return false; end if;
  update public.ai_daily_usage as u
  set dharma_questions=greatest(u.dharma_questions-case when released_kind='dharma' then 1 else 0 end,0),
      factcheck_questions=greatest(u.factcheck_questions-case when released_kind='factcheck' then 1 else 0 end,0),
      updated_at=statement_timestamp()
  where u.user_id=p_user_id and u.usage_date=released_date;
  return true;
end $$;

revoke all on function public.reserve_ai_usage(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.consume_ai_usage(uuid,uuid) from public,anon,authenticated;
revoke all on function public.release_ai_usage(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_ai_usage(uuid,text,integer) to service_role;
grant execute on function public.consume_ai_usage(uuid,uuid) to service_role;
grant execute on function public.release_ai_usage(uuid,uuid) to service_role;

commit;
