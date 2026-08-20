-- REVIEW ONLY. DO NOT EXECUTE AUTOMATICALLY.

alter table public.ai_feedback
  add column if not exists corrected_answer text,
  add column if not exists source_reference text,
  add column if not exists source_type text,
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists correction_updated_at timestamptz;

alter table public.ai_feedback
  drop constraint if exists ai_feedback_verification_status_check;
alter table public.ai_feedback
  add constraint ai_feedback_verification_status_check
  check (verification_status in ('unverified', 'verified', 'rejected'));

alter table public.ai_feedback
  drop constraint if exists ai_feedback_source_type_check;
alter table public.ai_feedback
  add constraint ai_feedback_source_type_check
  check (source_type is null or source_type = '' or source_type in ('SCRIPTURE','PATENT','SCIENTIFIC','GOVERNMENT_OR_LEGAL','HISTORICAL','CURRENT_NEWS','GENERAL'));

create table if not exists public.user_notifications (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  priority text not null default 'normal',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  action_route text,
  action_label text,
  constraint user_notifications_type_check check (type in ('system','account','payment','subscription','festival','panchang','kundli','mantra','content','announcement','security')),
  constraint user_notifications_priority_check check (priority in ('low','normal','high'))
);

create index if not exists user_notifications_user_created_idx
  on public.user_notifications(user_id, created_at desc);
create index if not exists user_notifications_user_unread_idx
  on public.user_notifications(user_id, created_at desc)
  where read_at is null;

alter table public.user_notifications enable row level security;
revoke all on table public.user_notifications from anon, authenticated;
grant select, insert, update, delete on table public.user_notifications to service_role;
