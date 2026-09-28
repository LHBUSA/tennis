-- Log WTA /records (as reported) vs our derived career record per player x surface (rule records-v1, see
-- records-compare.sql): singles + doubles, main draw, completed or retired, tour level (edition not ITF).
-- A difference is LOGGED in tennis_source_disagreements (field 'career_record:<surface>'); nothing is written
-- over the derived record. Idempotent (unique entity/field/source); resolved rows are not reopened.
with rec as (
  select r.pbe_player_id, lower(s->>'surface') surface, (s->>'wins')::int w, (s->>'losses')::int l, r.capture_id, r.source_synced_at
  from tennis_player_source_records r, jsonb_array_elements(r.payload->'by_surface') s
  where r.provider = 'wta' and r.kind = 'career_records'),
der as (
  select mm.pbe_player_id, coalesce(e.surface, m.surface, 'unknown') surface,
    count(*) filter (where p.side = m.winner_side) w, count(*) filter (where p.side <> m.winner_side) l
  from tennis_matches m join tennis_match_participants p using (match_id)
  join tennis_participant_members mm on mm.participant_key = p.participant_key
  join tennis_tournament_editions e on e.edition_id = m.edition_id
  where m.event_type in ('WS', 'WD') and m.status in ('completed', 'retired') and m.round not like 'Q-%'
    and coalesce(e.competition_key, '') <> 'itf_women' and coalesce(e.level, '') <> 'ITF'
    and mm.pbe_player_id in (select pbe_player_id from rec)
  group by 1, 2),
cmp as (
  select rec.*, coalesce(der.w, 0) dw, coalesce(der.l, 0) dl from rec left join der using (pbe_player_id, surface))
insert into tennis_source_disagreements (entity_type, entity_id, field, source, source_value, derived_value, detail)
select 'player', pbe_player_id::text, 'career_record:' || surface, 'wta:records',
  jsonb_build_object('W', w, 'L', l), jsonb_build_object('W', dw, 'L', dl),
  jsonb_build_object('rule', 'records-v1: singles+doubles, main draw, completed/retired, tour level', 'capture_id', capture_id, 'source_synced_at', source_synced_at, 'diff_matches', (dw + dl) - (w + l))
from cmp where w <> dw or l <> dl
on conflict (entity_type, entity_id, field, source) do update set source_value = excluded.source_value, derived_value = excluded.derived_value, detail = excluded.detail, observed_at = now()
  where tennis_source_disagreements.resolved_at is null;
