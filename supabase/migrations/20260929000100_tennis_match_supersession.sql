-- Explicit tombstone for a canonical match row that duplicates another row and can never be removed.
--
-- tennis_match_events is append-only (trigger tennis_match_events_append_only) and references tennis_matches without
-- ON DELETE, so a duplicate row that already holds observed events can be neither deleted nor re-pointed. Such a row is
-- marked status 'superseded' + superseded_by = the surviving row, and its natural_key is cleared so the survivor can own
-- the key. Every status-driven reader excludes it by construction; list readers filter status <> 'superseded'.
-- First use (2026-09-29): two Adana 2026 WS rows created 09:10Z next to their real rows (docs/evidence/parity-production-2026-09-29.md).
-- Additive only. Constraints are added NOT VALID then validated (SHARE UPDATE EXCLUSIVE: writes continue).

alter table public.tennis_matches drop constraint if exists tennis_matches_status_check;
alter table public.tennis_matches add constraint tennis_matches_status_check
  check (status in ('scheduled', 'in_progress', 'suspended', 'completed', 'retired', 'walkover', 'defaulted', 'cancelled', 'abandoned', 'superseded')) not valid;
alter table public.tennis_matches validate constraint tennis_matches_status_check;

alter table public.tennis_matches add column if not exists superseded_by uuid;
alter table public.tennis_matches add constraint tennis_matches_superseded_by_fkey foreign key (superseded_by) references public.tennis_matches (match_id) not valid;
alter table public.tennis_matches validate constraint tennis_matches_superseded_by_fkey;
alter table public.tennis_matches add constraint tennis_matches_superseded_check
  check ((status = 'superseded') = (superseded_by is not null) and (superseded_by is null or superseded_by <> match_id)) not valid;
alter table public.tennis_matches validate constraint tennis_matches_superseded_check;

comment on column public.tennis_matches.superseded_by is
  'Tombstone: this row duplicates superseded_by and cannot be removed (its observed events are append-only). status = superseded; natural_key cleared. Readers exclude it.';
