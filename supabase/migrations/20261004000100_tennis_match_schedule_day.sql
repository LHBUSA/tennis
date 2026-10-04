-- Sourced day of play for a scheduled match (Tennis Picker V1 lock rule, owner-approved 2026-10-04).
--
-- A WTA order of play often states the day and a "not before" time but no exact start (scheduled_at stays null). The
-- lock rule needs that day: sourced exact start -> T_MINUS_60; else sourced day + PROVEN UTC offset -> DAY_START_LOCK at
-- 00:00 tournament local; else HOLD. These columns record the day exactly as the source stated it:
--   scheduled_day        the local calendar day of play the source lists the match for
--   schedule_utc_offset  the UTC offset the source states for that day ('+08:00'); null = not proven. '+00:00' is never
--                        stored: the source also emits it as a default, so it is unproven (-> HOLD). Never guessed from
--                        a city or country.
--   schedule_day_source  which derivation produced it (see the check list)
--   schedule_day_raw     the raw source field(s) and value(s) it was derived from, e.g.
--                        {"field":"MatchTimeStamp","value":"2026-10-05T11:00+08:00","corroborated_by":{...}}
-- 23:59 MatchTimeStamp placeholders are never a start time; the placeholder may set the day only once proven
-- (docs/evidence/wta-oop-day-proof.md).
-- Additive and nullable only; written by tennis-ingest and read by tennis-api only when SCHEDULE_DAY_COLUMNS = "1".
-- Rollback: supabase/rollback/20261004000100_tennis_match_schedule_day.down.sql

alter table public.tennis_matches add column if not exists scheduled_day date;
alter table public.tennis_matches add column if not exists schedule_utc_offset text;
alter table public.tennis_matches add column if not exists schedule_day_source text;
alter table public.tennis_matches add column if not exists schedule_day_raw jsonb;

alter table public.tennis_matches add constraint tennis_matches_schedule_utc_offset_check
  check (schedule_utc_offset is null or (schedule_utc_offset ~ '^[+-][0-2][0-9]:[0-5][0-9]$' and schedule_utc_offset not in ('+00:00', '-00:00'))) not valid;
alter table public.tennis_matches validate constraint tennis_matches_schedule_utc_offset_check;
alter table public.tennis_matches add constraint tennis_matches_schedule_day_source_check
  check (schedule_day_source is null or schedule_day_source in ('wta_not_before_iso', 'wta_order_of_play', 'wta_match_timestamp_placeholder')) not valid;
alter table public.tennis_matches validate constraint tennis_matches_schedule_day_source_check;
-- a day always names its source and raw evidence; an offset never exists without a day
alter table public.tennis_matches add constraint tennis_matches_schedule_day_check
  check ((scheduled_day is null) = (schedule_day_source is null)
     and (scheduled_day is null) = (schedule_day_raw is null)
     and (schedule_utc_offset is null or scheduled_day is not null)
     and (schedule_day_raw is null or (jsonb_typeof(schedule_day_raw) = 'object' and schedule_day_raw ? 'field' and schedule_day_raw ? 'value'))) not valid;
alter table public.tennis_matches validate constraint tennis_matches_schedule_day_check;

create index if not exists tennis_matches_scheduled_day_idx on public.tennis_matches (scheduled_day) where scheduled_day is not null;

comment on column public.tennis_matches.scheduled_day is
  'Sourced local day of play (order of play). Never assumed; null = not sourced. Not a start time.';
comment on column public.tennis_matches.schedule_utc_offset is
  'UTC offset the source states for scheduled_day (+HH:MM). Null = unproven (+00:00 is never stored). Never guessed.';
comment on column public.tennis_matches.schedule_day_source is
  'Derivation of scheduled_day: wta_not_before_iso | wta_order_of_play | wta_match_timestamp_placeholder.';
comment on column public.tennis_matches.schedule_day_raw is
  'Raw source field(s) + value(s) scheduled_day was derived from: {field, value[, corroborated_by]}.';
