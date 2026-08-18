-- Production hotfix: remove PL/pgSQL/table-column ambiguity from AI quota RPCs.
-- This preserves tables, rows, signatures, RLS, ownership, and quota counters.
begin;

do $$
begin
  if to_regclass('public.ai_daily_usage') is null
     or to_regclass('public.ai_usage_reservations') is null then
    raise exception 'HOTFIX_ABORTED: expected quota tables are missing';
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid=to_regclass('public.ai_daily_usage')
      and c.conname='ai_daily_usage_pkey' and c.contype in ('p','u')
  ) then
    raise exception 'HOTFIX_ABORTED: ai_daily_usage_pkey is missing or incompatible';
  end if;
  if to_regprocedure('public.reserve_ai_usage(uuid,text,integer)') is null
     or to_regprocedure('public.consume_ai_usage(uuid,uuid)') is null
     or to_regprocedure('public.release_ai_usage(uuid,uuid)') is null then
    raise exception 'HOTFIX_ABORTED: expected quota RPC signatures are missing';
  end if;
end $$;

create or replace function public.reserve_ai_usage(p_user_id uuid,p_kind text,p_limit integer)
returns table(reservation_id uuid,allowed boolean,used integer,remaining integer,usage_date date)
language plpgsql security invoker set search_path=pg_catalog,extensions as $$
declare
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
    select case when p_kind='dharma' then u.dharma_questions else u.factcheck_questions end
    into current_used from public.ai_daily_usage as u
    where u.user_id=p_user_id and u.usage_date=effective_date;
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
