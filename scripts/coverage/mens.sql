-- Men's coverage (brief Phase 11). Q1 result only · Q2 set/game · Q3 stats · Q4 point-by-point.
with men as (
  select m.match_id, m.event_type, m.status, e.year, coalesce(e.level, 'unknown') as level, m.source_family,
    exists (select 1 from tennis_sets s where s.match_id = m.match_id) as q2,
    exists (select 1 from tennis_match_stats s where s.match_id = m.match_id) as q3,
    exists (select 1 from tennis_match_events v where v.match_id = m.match_id and v.quality = 'point_event') as q4
  from tennis_matches m join tennis_tournament_editions e using (edition_id)
  where m.event_type in ('MS', 'MD', 'XD')
),
mp as (select distinct pm.pbe_player_id from men join tennis_match_participants mp using (match_id) join tennis_participant_members pm on pm.participant_key = mp.participant_key join tennis_players p on p.pbe_player_id = pm.pbe_player_id where p.gender = 'M')
select json_build_object(
  'generated_at', now(),
  'by_year', (select coalesce(json_agg(z order by z.year, z.level, z.event_type), '[]') from (
     select year, level, event_type, source_family, count(*) matches,
       count(*) filter (where not q2 and not q3 and not q4) q1_only, count(*) filter (where q2) q2, count(*) filter (where q3) q3, count(*) filter (where q4) q4
     from men group by 1, 2, 3, 4) z),
  'atp_tour_matches', (select count(*) from men where level ~* '^ATP (250|500|1000|Finals|Masters)'),
  'atp_challenger_matches', (select count(*) from men where level ~* 'challenger'),
  'mens_slam_matches', (select count(*) from men where level = 'Grand Slam'),
  'mens_live_matches', (select count(*) from men where status = 'in_progress'),
  'mens_matches_with_stats', (select count(*) from men where q3),
  'mens_matches_with_pbp', (select count(*) from men where q4),
  'mens_point_events', (select count(*) from tennis_match_events v join men using (match_id) where v.quality = 'point_event'),
  'mens_players', (select count(*) from tennis_players where gender = 'M'),
  'mens_players_with_matches', (select count(*) from mp),
  'mens_players_with_photo', (select count(distinct m.pbe_player_id) from tennis_player_media m join tennis_players p using (pbe_player_id) where p.gender = 'M' and m.approval = 'approved'),
  'mens_players_with_wikidata', (select count(distinct x.pbe_player_id) from tennis_player_external_ids x join tennis_players p using (pbe_player_id) where p.gender = 'M' and x.provider = 'wikidata'),
  'mens_dna_players', (select count(distinct d.pbe_player_id) from tennis_dna_snapshots d join tennis_players p using (pbe_player_id) where p.gender = 'M'),
  'mens_dna_eligible', (select count(distinct d.pbe_player_id) from tennis_dna_snapshots d join tennis_players p using (pbe_player_id), jsonb_each(d.metrics) k where p.gender = 'M' and d.surface = 'all' and k.value->>'confidence' in ('medium', 'high')),
  'atp_rankings_snapshots', (select count(*) from tennis_ranking_snapshots where list_key like 'atp_%' and row_count > 0)
) as report;
