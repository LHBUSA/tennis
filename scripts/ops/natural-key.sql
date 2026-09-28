-- Backfill tennis_matches.natural_key in batches (run repeatedly until it returns 0), then build the unique index.
-- Step 1 (repeat): fills up to 20,000 rows per call; returns the rows filled.
with todo as (
  select m.match_id from tennis_matches m where m.natural_key is null
    and exists (select 1 from tennis_match_participants a where a.match_id = m.match_id and a.side = 'A')
    and exists (select 1 from tennis_match_participants b where b.match_id = m.match_id and b.side = 'B')
  limit 20000),
k as (
  select m.match_id,
    m.event_type || '|' || case when m.round like 'Q-%' then 'qualifying' when m.round = 'RR' then 'round_robin' else 'main' end || '|' ||
    least(a.participant_key collate "C", b.participant_key collate "C") || '~' || greatest(a.participant_key collate "C", b.participant_key collate "C") nk
  from tennis_matches m join todo using (match_id)
  join tennis_match_participants a on a.match_id = m.match_id and a.side = 'A'
  join tennis_match_participants b on b.match_id = m.match_id and b.side = 'B'),
u as (update tennis_matches m set natural_key = k.nk from k where k.match_id = m.match_id returning 1)
select count(*) filled from u;

-- Step 2 (once, after step 1 returns 0 and the duplicate check returns 0 groups):
-- create unique index concurrently if not exists tennis_matches_natural_key on public.tennis_matches (edition_id, natural_key) where natural_key is not null;
