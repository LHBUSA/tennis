-- WTA /year (official season serve totals, as reported) vs the sum of OUR stored per-match statistics
-- (tennis_match_stats, WTA match-stats lane) for the same player and season: tour-level singles (not ITF).
-- Our per-match coverage starts late 2024, so only seasons we hold stats for are comparable; a season is
-- compared only where we hold stats for at least 80% of the matches the WTA counts (MatchCount).
with y as (
  select r.pbe_player_id, r.period::int season, (r.payload->>'aces')::int aces, (r.payload->>'double_faults')::int dfs,
         (r.payload->>'first_serves_played')::int fsp, (r.payload->>'matchcount')::int mc
  from tennis_player_source_records r where r.provider = 'wta' and r.kind = 'season_stats' and r.period ~ '^[0-9]{4}$'),
ours as (
  select mm.pbe_player_id, e.year season, count(distinct s.match_id) matches,
    sum((s.stats->>'aces')::int) aces, sum((s.stats->>'double_faults')::int) dfs, sum((s.stats->>'service_points')::int) sp
  from tennis_match_stats s join tennis_matches m using (match_id)
  join tennis_match_participants p on p.match_id = m.match_id and p.side = s.side
  join tennis_participant_members mm on mm.participant_key = p.participant_key
  join tennis_tournament_editions e on e.edition_id = m.edition_id
  where m.event_type = 'WS' and coalesce(e.competition_key, '') <> 'itf_women' and coalesce(e.level, '') <> 'ITF'
  group by 1, 2)
select y.pbe_player_id, y.season, y.mc official_matches, o.matches our_matches, y.aces official_aces, o.aces our_aces, y.dfs official_dfs, o.dfs our_dfs
from y join ours o using (pbe_player_id, season)
where o.matches >= 0.8 * y.mc
