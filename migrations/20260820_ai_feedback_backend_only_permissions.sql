-- REVIEW ONLY: do not execute until reviewed in Supabase SQL Editor.
-- The mobile app sends feedback to the authenticated backend. Only the backend
-- service role reads/writes this moderation table through the Data API.

alter table public.ai_feedback
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists feature text,
  add column if not exists message_id text,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists mode text,
  add column if not exists latency_ms integer;

create unique index if not exists ai_feedback_user_message_uidx
  on public.ai_feedback(user_id, message_id)
  where user_id is not null and message_id is not null and message_id <> '';

revoke all on table public.ai_feedback from anon, authenticated;
grant select, insert, update, delete on table public.ai_feedback to service_role;

-- error_logs is written only by backend diagnostics and is not client-readable.
revoke all on table public.error_logs from anon, authenticated;
grant insert on table public.error_logs to service_role;
