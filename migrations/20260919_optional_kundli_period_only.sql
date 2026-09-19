-- REVIEW ONLY. DO NOT APPLY AUTOMATICALLY.
-- Allows truthful storage of a known part of day without inventing a clock time.
begin;

alter table public.birth_profiles
  add column if not exists birth_time_period text;

alter table public.birth_profiles
  drop constraint if exists birth_profiles_time_certainty_check;
alter table public.birth_profiles
  add constraint birth_profiles_time_certainty_check
  check (birth_time_certainty in ('EXACT','APPROXIMATE','UNCERTAIN','PERIOD_ONLY','UNKNOWN'));

alter table public.birth_profiles
  drop constraint if exists birth_profiles_time_check;
alter table public.birth_profiles
  add constraint birth_profiles_time_check check (
    (birth_time_certainty in ('UNKNOWN','PERIOD_ONLY') and birth_time is null)
    or
    (birth_time_certainty in ('EXACT','APPROXIMATE','UNCERTAIN') and birth_time is not null)
  );

alter table public.birth_profiles
  drop constraint if exists birth_profiles_period_check;
alter table public.birth_profiles
  add constraint birth_profiles_period_check check (
    (birth_time_certainty='PERIOD_ONLY' and birth_time_period in (
      'BEFORE_SUNRISE','EARLY_MORNING','MORNING','AROUND_NOON',
      'AFTERNOON','EVENING','NIGHT','LATE_NIGHT'
    ))
    or
    (birth_time_certainty<>'PERIOD_ONLY' and birth_time_period is null)
  );

commit;
