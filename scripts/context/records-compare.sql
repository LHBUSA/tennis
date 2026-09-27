-- WTA /records (official, as reported) vs our derived career singles record, per player and surface.
-- The WTA's /records counts SINGLES AND DOUBLES together (observed: 320760 'Grand Slam' 6 titles = 4 singles +
-- 2 doubles; her official singles history has 149 Slam main-draw rows vs /records 188 matches).
-- Derived rule (records-v1): WS + WD, main draw (round not Q-*), completed or retired (walkovers are not played),
-- tour level = edition not ITF. Rows in editions of UNKNOWN level (ESPN shadow editions) are counted apart.
with rec as (
  select r.pbe_player_id, lower(s->>'surface') surface, (s->>'wins')::int w, (s->>'losses')::int l
  from tennis_player_source_records r, jsonb_array_elements(r.payload->'by_surface') s
  where r.provider = 'wta' and r.kind = 'career_records'),
players as (select distinct pbe_player_id from rec),
der as (
  select mm.pbe_player_id, coalesce(e.surface, m.surface, 'unknown') surface,
    case when e.level is null and e.competition_key is null then 'unknown_level' else 'tour' end lvl,
    count(*) filter (where p.side = m.winner_side) w, count(*) filter (where p.side <> m.winner_side) l
  from tennis_matches m join tennis_match_participants p using (match_id)
  join tennis_participant_members mm on mm.participant_key = p.participant_key
  join tennis_tournament_editions e on e.edition_id = m.edition_id
  where m.event_type in ('WS', 'WD') and m.status in ('completed', 'retired') and m.round not like 'Q-%'
    and coalesce(e.competition_key, '') <> 'itf_women' and coalesce(e.level, '') <> 'ITF'
    and mm.pbe_player_id in (select pbe_player_id from players)
  group by 1, 2, 3)
select rec.pbe_player_id, rec.surface, rec.w off_w, rec.l off_l,
  coalesce(t.w, 0) der_w, coalesce(t.l, 0) der_l, coalesce(u.w, 0) unk_w, coalesce(u.l, 0) unk_l
from rec left join der t on t.pbe_player_id = rec.pbe_player_id and t.surface = rec.surface and t.lvl = 'tour'
left join der u on u.pbe_player_id = rec.pbe_player_id and u.surface = rec.surface and u.lvl = 'unknown_level'
