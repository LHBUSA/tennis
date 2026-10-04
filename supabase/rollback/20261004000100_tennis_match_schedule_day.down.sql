-- Rollback for supabase/migrations/20261004000100_tennis_match_schedule_day.sql.
-- Run ONLY after SCHEDULE_DAY_COLUMNS is back to "0" on tennis-ingest and tennis-api (deployed), or their reads/writes
-- of these columns fail. Drops the sourced day-of-play data recorded since the migration (export it first if needed:
--   select match_id, scheduled_day, schedule_utc_offset, schedule_day_source, schedule_day_raw
--   from public.tennis_matches where scheduled_day is not null;).

drop index if exists public.tennis_matches_scheduled_day_idx;
alter table public.tennis_matches drop constraint if exists tennis_matches_schedule_day_check;
alter table public.tennis_matches drop constraint if exists tennis_matches_schedule_day_source_check;
alter table public.tennis_matches drop constraint if exists tennis_matches_schedule_utc_offset_check;
alter table public.tennis_matches drop column if exists schedule_day_raw;
alter table public.tennis_matches drop column if exists schedule_day_source;
alter table public.tennis_matches drop column if exists schedule_utc_offset;
alter table public.tennis_matches drop column if exists scheduled_day;
