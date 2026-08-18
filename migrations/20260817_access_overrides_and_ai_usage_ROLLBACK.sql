begin;

-- DATA-PRESERVING rollback: remove mutation entry points only. Dropping a
-- function also removes its grants and is idempotent with IF EXISTS.
-- Usage/reservation rows, indexes, RLS, privileges, and override columns remain.
drop function if exists public.reserve_ai_usage(uuid,text,integer);
drop function if exists public.consume_ai_usage(uuid,uuid);
drop function if exists public.release_ai_usage(uuid,uuid);

commit;

-- OPTIONAL DESTRUCTIVE CLEANUP IS INTENTIONALLY NOT EXECUTABLE HERE.
-- After approved retention/export, a separate migration may remove the two quota
-- tables and public.users admin_override* columns. This rollback never does so.
