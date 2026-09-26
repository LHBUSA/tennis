-- PropBetEdge Tennis — canonical core schema v1.
-- STAGED, NOT APPLIED. Target: sports-data project (tkmln…), per the global identity-vs-sports DB split.
-- Proven locally by tests/migration.test.js (PGlite). Apply only with owner approval (docs/RELEASE.md).
--
-- Principles (docs/TENNIS_DATA_MODEL.md):
--   * a match is participant A vs participant B; a participant is a team of 1 or 2 players
--   * one PBE player UUID per human; provider ids live on the crosswalk, never as identity
--   * raw evidence lives in R2; rows point at it via capture_id
--   * picks are append-only; corrections are separate rows with a reason
-- Row-level security is ON for every table with NO anon/authenticated policies: the browser never
-- reads Postgres. tennis-api (service role) is the only reader.

begin;

-- ---------- target guard: sports project only (never the identity/billing project) ------------------
do $$
begin
  if to_regclass('public.ufc_bouts') is null or to_regclass('public.ufc_model_versions') is null then
    raise exception 'tennis core must target the sports project (ufc_bouts + ufc_model_versions required)';
  end if;
  if to_regclass('public.pbe_sport_entitlements') is not null then
    raise exception 'tennis core refused: identity/billing project detected';
  end if;
end $$;

-- ---------- reference ------------------------------------------------------------------------------
create table public.tennis_tours (
  tour_key text primary key check (tour_key ~ '^[a-z0-9_]+$'),
  label text not null,
  gender_scope text not null check (gender_scope in ('men', 'women', 'mixed'))
);

create table public.tennis_competitions (
  competition_key text primary key check (competition_key ~ '^[a-z0-9_]+$'),
  tour_key text not null references public.tennis_tours (tour_key),
  level text not null,
  label text not null
);

-- ---------- identity -------------------------------------------------------------------------------
create table public.tennis_players (
  pbe_player_id uuid primary key,
  founding_external_key text not null unique,            -- e.g. 'wta:320760'; the UUIDv5 seed
  full_name text not null,
  first_name text,
  last_name text,
  gender char(1) check (gender in ('M', 'F')),
  dob date,
  nationality char(3),
  plays text check (plays in ('right', 'left')),
  backhand text check (backhand in ('one', 'two')),
  height_cm smallint check (height_cm between 120 and 240),
  turned_pro smallint,
  status text not null default 'active' check (status in ('active', 'merged')),
  merged_into uuid references public.tennis_players (pbe_player_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'merged') = (merged_into is not null))
);

create table public.tennis_player_external_ids (
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  external_id text not null,
  pbe_player_id uuid not null references public.tennis_players (pbe_player_id),
  method text not null check (method in ('founding', 'external_id', 'name_dob', 'manual_review')),
  evidence jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  primary key (provider, external_id)
);
create index tennis_player_external_ids_player on public.tennis_player_external_ids (pbe_player_id);

create table public.tennis_player_aliases (
  pbe_player_id uuid not null references public.tennis_players (pbe_player_id),
  alias text not null,
  alias_norm text not null,
  kind text not null check (kind in ('legal', 'married', 'former', 'transliteration', 'feed', 'short')),
  source_family text,
  primary key (pbe_player_id, alias_norm)
);
create index tennis_player_aliases_norm on public.tennis_player_aliases (alias_norm);

create table public.tennis_identity_queue (
  id bigint generated always as identity primary key,
  provider text not null,
  external_id text not null,
  observed_name text not null,
  observed jsonb not null,                                 -- dob / nationality / tour as the source printed them
  status text not null check (status in ('unresolved', 'ambiguous', 'resolved', 'rejected')),
  reason text,
  candidates uuid[] not null default '{}',
  resolved_player_id uuid references public.tennis_players (pbe_player_id),
  created_at timestamptz not null default now(),
  unique (provider, external_id)
);

create table public.tennis_player_media (
  id bigint generated always as identity primary key,
  pbe_player_id uuid not null references public.tennis_players (pbe_player_id),
  source_page_url text not null,
  original_url text not null,
  author text not null,
  license text not null check (license ~* '^(cc0|public domain|cc by(-sa)?( [0-9.]+)?)$'),
  attribution text not null,
  width int not null check (width > 0),
  height int not null check (height > 0),
  focal jsonb not null,                                    -- reviewed face box {x,y,w,h} in source pixels
  identity_evidence jsonb not null,
  approval text not null default 'pending' check (approval in ('pending', 'approved', 'rejected')),
  verified_at timestamptz,
  derivatives jsonb not null default '{}'::jsonb,
  check (approval <> 'approved' or verified_at is not null)
);
create unique index tennis_player_media_one_approved on public.tennis_player_media (pbe_player_id) where approval = 'approved';

-- ---------- participants (teams of one or two) -----------------------------------------------------
create table public.tennis_participants (
  participant_key text primary key check (
    participant_key ~ '^S:[0-9a-f-]{36}$' or participant_key ~ '^D:[0-9a-f-]{36}\+[0-9a-f-]{36}$'
  ),
  kind text not null check (kind in ('singles', 'pair')),
  created_at timestamptz not null default now(),
  check ((kind = 'singles') = (participant_key like 'S:%'))
);

create table public.tennis_participant_members (
  participant_key text not null references public.tennis_participants (participant_key),
  slot smallint not null check (slot in (1, 2)),
  pbe_player_id uuid not null references public.tennis_players (pbe_player_id),
  primary key (participant_key, slot),
  unique (participant_key, pbe_player_id)
);

-- ---------- tournaments / draws --------------------------------------------------------------------
create table public.tennis_tournaments (
  tournament_id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  competition_key text references public.tennis_competitions (competition_key),
  country char(3),
  city text
);

create table public.tennis_tournament_editions (
  edition_id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tennis_tournaments (tournament_id),
  year smallint not null check (year between 1877 and 2100),
  competition_key text references public.tennis_competitions (competition_key),
  start_date date,
  end_date date,
  surface text check (surface in ('hard', 'clay', 'grass', 'carpet')),
  indoor boolean,
  source_family text not null,
  unique (tournament_id, year),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.tennis_draws (
  draw_id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.tennis_tournament_editions (edition_id),
  event_type text not null check (event_type in ('MS', 'WS', 'MD', 'WD', 'XD')),
  stage text not null check (stage in ('qualifying', 'main', 'round_robin')),
  draw_size smallint check (draw_size > 0),
  format_key text not null,
  unique (edition_id, event_type, stage)
);

create table public.tennis_draw_entries (
  draw_id uuid not null references public.tennis_draws (draw_id),
  position smallint not null check (position > 0),
  participant_key text references public.tennis_participants (participant_key),
  is_bye boolean not null default false,
  seed smallint check (seed > 0),
  entry_type text check (entry_type in ('DA', 'Q', 'WC', 'LL', 'PR', 'SE', 'ALT', 'JE', 'ITF')),
  withdrawn boolean not null default false,
  primary key (draw_id, position),
  check (is_bye = (participant_key is null))
);

-- ---------- matches ---------------------------------------------------------------------------------
create table public.tennis_matches (
  match_id uuid primary key default gen_random_uuid(),
  edition_id uuid references public.tennis_tournament_editions (edition_id),
  draw_id uuid references public.tennis_draws (draw_id),
  event_type text not null check (event_type in ('MS', 'WS', 'MD', 'WD', 'XD')),
  round text not null,
  format_key text not null,
  scheduled_at timestamptz,
  court text,
  status text not null check (status in ('scheduled', 'in_progress', 'suspended', 'completed', 'retired', 'walkover', 'defaulted', 'cancelled', 'abandoned')),
  winner_side char(1) check (winner_side in ('A', 'B')),
  end_reason text,
  score_text text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_s int check (duration_s >= 0),
  surface text check (surface in ('hard', 'clay', 'grass', 'carpet')),
  indoor boolean,
  source_family text not null,
  updated_at timestamptz not null default now(),
  check (status not in ('completed', 'retired', 'walkover', 'defaulted') or winner_side is not null)
);
create index tennis_matches_scheduled on public.tennis_matches (scheduled_at);
create index tennis_matches_edition on public.tennis_matches (edition_id);

create table public.tennis_match_external_ids (
  provider text not null,
  external_id text not null,
  match_id uuid not null references public.tennis_matches (match_id),
  primary key (provider, external_id)
);

create table public.tennis_match_participants (
  match_id uuid not null references public.tennis_matches (match_id),
  side char(1) not null check (side in ('A', 'B')),
  participant_key text not null references public.tennis_participants (participant_key),
  seed smallint,
  entry_type text,
  primary key (match_id, side),
  unique (match_id, participant_key)
);
create index tennis_match_participants_key on public.tennis_match_participants (participant_key);

create table public.tennis_sets (
  match_id uuid not null references public.tennis_matches (match_id),
  set_no smallint not null check (set_no between 1 and 5),
  games_a smallint not null check (games_a >= 0),
  games_b smallint not null check (games_b >= 0),
  tb_a smallint,
  tb_b smallint,
  tb_winner_points_derived boolean not null default false,
  is_match_tiebreak boolean not null default false,
  winner_side char(1) check (winner_side in ('A', 'B')),
  primary key (match_id, set_no)
);

create table public.tennis_games (
  match_id uuid not null references public.tennis_matches (match_id),
  set_no smallint not null,
  game_no smallint not null,
  server_side char(1) check (server_side in ('A', 'B')),
  winner_side char(1) check (winner_side in ('A', 'B')),
  is_tiebreak boolean not null default false,
  primary key (match_id, set_no, game_no)
);

-- Observed points only. Never reconstructed from a final score.
create table public.tennis_points (
  match_id uuid not null references public.tennis_matches (match_id),
  seq int not null check (seq > 0),
  set_no smallint not null,
  game_no smallint not null,
  server_side char(1) check (server_side in ('A', 'B')),
  server_player_id uuid references public.tennis_players (pbe_player_id),  -- only when the source names the server
  winner_side char(1) not null check (winner_side in ('A', 'B')),
  score_after jsonb not null,
  source_event_id text,
  captured_at timestamptz not null,
  capture_id text,
  primary key (match_id, seq)
);

create table public.tennis_match_stats (
  match_id uuid not null references public.tennis_matches (match_id),
  side char(1) not null check (side in ('A', 'B')),
  source_family text not null,
  stats jsonb not null,            -- canonical keys: service_points, aces, double_faults, first_serves_in, …
  capture_id text,
  captured_at timestamptz not null,
  primary key (match_id, side, source_family)
);

create table public.tennis_player_match_stats (
  match_id uuid not null references public.tennis_matches (match_id),
  pbe_player_id uuid not null references public.tennis_players (pbe_player_id),
  source_family text not null,
  stats jsonb not null,
  capture_id text,
  primary key (match_id, pbe_player_id, source_family)
);

-- ---------- rankings (snapshots, not "today's ranking") --------------------------------------------
create table public.tennis_ranking_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  list_key text not null check (list_key in ('atp_singles', 'atp_doubles', 'atp_race_singles', 'wta_singles', 'wta_doubles', 'wta_race_singles', 'itf_men', 'itf_women')),
  ranking_date date not null,
  source_family text not null,
  capture_id text,
  row_count int not null check (row_count >= 0),
  captured_at timestamptz not null,
  unique (list_key, ranking_date)
);

create table public.tennis_rankings (
  snapshot_id uuid not null references public.tennis_ranking_snapshots (snapshot_id),
  provider_player_id text not null,
  pbe_player_id uuid references public.tennis_players (pbe_player_id),   -- null while identity unresolved
  rank int not null check (rank > 0),
  tied boolean not null default false,
  points numeric,
  tournaments_played smallint,
  previous_rank int,
  primary key (snapshot_id, provider_player_id)
);
create index tennis_rankings_player on public.tennis_rankings (pbe_player_id);

-- ---------- derived intelligence (versioned, exclusive as_of) ---------------------------------------
create table public.tennis_surface_ratings (
  pbe_player_id uuid not null references public.tennis_players (pbe_player_id),
  surface text not null check (surface in ('overall', 'hard', 'clay', 'grass', 'indoor')),
  as_of date not null,
  method_version int not null,
  rating numeric not null,
  uncertainty numeric,
  sample_matches int not null,
  provenance jsonb not null,
  primary key (pbe_player_id, surface, as_of, method_version)
);

create table public.tennis_dna_snapshots (
  pbe_player_id uuid not null references public.tennis_players (pbe_player_id),
  as_of date not null,
  surface text not null default 'all' check (surface in ('all', 'hard', 'clay', 'grass', 'indoor')),
  definition_version int not null,
  metrics jsonb not null,
  provenance jsonb not null,       -- match ids, capture watermark, builder version / git sha
  built_at timestamptz not null default now(),
  primary key (pbe_player_id, as_of, surface, definition_version)
);

create table public.tennis_pair_snapshots (
  participant_key text not null references public.tennis_participants (participant_key) check (participant_key like 'D:%'),
  as_of date not null,
  definition_version int not null,
  metrics jsonb not null,
  provenance jsonb not null,
  primary key (participant_key, as_of, definition_version)
);

-- ---------- markets (append-only; separate from model truth) ----------------------------------------
create table public.tennis_odds_runs (
  run_id uuid primary key default gen_random_uuid(),
  source_family text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  state text not null,
  snapshots int not null default 0
);

create table public.tennis_odds_snapshots (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.tennis_odds_runs (run_id),
  match_id uuid references public.tennis_matches (match_id),
  provider_event_id text not null,
  sportsbook text not null,
  market text not null,
  participant_key text references public.tennis_participants (participant_key),
  line numeric,
  price_american int check (price_american <= -100 or price_american >= 100),
  captured_at timestamptz not null
);
create index tennis_odds_snapshots_match on public.tennis_odds_snapshots (match_id, captured_at);

-- ---------- model + picks (immutable once locked) ---------------------------------------------------
create table public.tennis_model_evaluations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.tennis_matches (match_id),
  model_version text not null,
  generated_at timestamptz not null,
  p_a numeric not null check (p_a between 0 and 1),
  p_b numeric not null check (p_b between 0 and 1),
  confidence text,
  factors jsonb not null default '[]'::jsonb,
  coverage_warnings jsonb not null default '[]'::jsonb,
  feature_cutoff timestamptz not null,       -- leakage control: no input captured after this
  check (abs(p_a + p_b - 1) < 0.0001),
  check (feature_cutoff <= generated_at)
);

create table public.tennis_picks (
  pick_id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.tennis_matches (match_id),
  participant_key text not null references public.tennis_participants (participant_key),
  market text not null,
  selection text not null,
  line numeric,
  price_american int check (price_american is null or price_american <= -100 or price_american >= 100),
  price_source text,
  source_market_at timestamptz,
  model_probability numeric not null check (model_probability between 0 and 1),
  model_version text not null,
  confidence text not null,
  reasons jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  locked_at timestamptz not null,
  match_start_at timestamptz not null,
  check (locked_at < match_start_at),
  check ((price_american is null) = (price_source is null))
);

create table public.tennis_pick_corrections (
  id bigint generated always as identity primary key,
  pick_id uuid not null references public.tennis_picks (pick_id),
  field text not null,
  old_value jsonb,
  new_value jsonb,
  reason text not null check (length(reason) >= 10),
  corrected_at timestamptz not null default now()
);

create table public.tennis_pick_grades (
  pick_id uuid primary key references public.tennis_picks (pick_id),
  result text not null check (result in ('win', 'loss', 'push', 'void', 'cancelled')),
  rule_version text not null,
  graded_at timestamptz not null default now(),
  evidence jsonb not null
);

create or replace function public.tennis_append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only: record a correction row instead', tg_table_name using errcode = 'P0001';
end $$;

create trigger tennis_picks_append_only before update or delete on public.tennis_picks
  for each row execute function public.tennis_append_only();
create trigger tennis_pick_corrections_append_only before update or delete on public.tennis_pick_corrections
  for each row execute function public.tennis_append_only();
create trigger tennis_odds_snapshots_append_only before update or delete on public.tennis_odds_snapshots
  for each row execute function public.tennis_append_only();

-- ---------- newsroom --------------------------------------------------------------------------------
create table public.tennis_news_events (
  event_id text primary key,                 -- deterministic: hash(kind + entity ids + as_of) so reruns never duplicate
  kind text not null,
  occurred_at timestamptz not null,
  entities jsonb not null,
  materiality numeric,
  evidence jsonb not null,
  created_at timestamptz not null default now()
);

create table public.tennis_articles (
  article_id uuid primary key default gen_random_uuid(),
  event_id text not null unique references public.tennis_news_events (event_id),
  slug text not null unique,
  status text not null check (status in ('held', 'published', 'withdrawn')),
  headline text not null,
  deck text,
  body jsonb not null,
  gate_results jsonb not null,
  editorial_version text not null,
  generator_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  check ((status = 'published') = (published_at is not null))
);

create table public.tennis_article_evidence (
  article_id uuid primary key references public.tennis_articles (article_id),
  packet jsonb not null,                     -- frozen at generation; never re-read from live tables
  frozen_at timestamptz not null default now()
);

-- ---------- source lineage --------------------------------------------------------------------------
create table public.tennis_source_captures (
  capture_id text primary key,
  source_family text not null,
  adapter text not null,
  request_identity text not null,
  url text not null,
  captured_at timestamptz not null,
  http jsonb not null,
  content_sha256 char(64) not null,
  bytes int not null,
  payload_key text not null,
  parser_version text not null,
  normalization_version text
);
create index tennis_source_captures_family_time on public.tennis_source_captures (source_family, captured_at desc);

create table public.tennis_source_runs (
  run_id uuid primary key default gen_random_uuid(),
  worker text not null,
  adapter_key text not null,
  source_family text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  state text not null check (state in ('PASS', 'DEGRADED', 'BLOCKED_BY_ACCESS_CONTROL', 'ERROR', 'NOT_MODIFIED')),
  http_status int,
  records int,
  error text,
  capture_ids text[] not null default '{}'
);

create table public.tennis_source_changes (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  field text not null,
  kind text not null,
  from_value jsonb,
  to_value jsonb,
  source_family text not null,
  capture_id text,
  observed_at timestamptz not null default now()
);
create index tennis_source_changes_entity on public.tennis_source_changes (entity_type, entity_id, observed_at desc);

create table public.tennis_coverage (
  tour_key text not null,
  season smallint not null,
  event_type text not null,
  tournament_id uuid references public.tennis_tournaments (tournament_id),
  matches text not null check (matches in ('complete', 'partial', 'unavailable', 'unaudited')),
  match_stats text not null check (match_stats in ('complete', 'partial', 'unavailable', 'unaudited')),
  points text not null check (points in ('complete', 'partial', 'unavailable', 'unaudited')),
  audited_at timestamptz,
  notes text
);
create unique index tennis_coverage_key on public.tennis_coverage (tour_key, season, event_type, coalesce(tournament_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------- crosswalks for tournaments/editions + live state + quarantine ----------------------------
create table public.tennis_tournament_external_ids (
  provider text not null,
  external_id text not null,
  tournament_id uuid not null references public.tennis_tournaments (tournament_id),
  primary key (provider, external_id)
);

create table public.tennis_edition_external_ids (
  provider text not null,
  external_id text not null,
  edition_id uuid not null references public.tennis_tournament_editions (edition_id),
  primary key (provider, external_id)
);

alter table public.tennis_tournament_editions
  add column name text,
  add column level text,
  add column city text,
  add column country char(3),
  add column singles_draw_size smallint,
  add column doubles_draw_size smallint,
  add column source_status text,
  add column updated_at timestamptz not null default now();

alter table public.tennis_matches
  add column live_state jsonb,                    -- last observed point score + server (source fact)
  add column source_updated_at timestamptz,
  add column stats_status text not null default 'pending' check (stats_status in ('pending', 'stored', 'unavailable', 'held', 'not_applicable'));
create index tennis_matches_status on public.tennis_matches (status) where status in ('in_progress', 'suspended');
create index tennis_matches_stats_pending on public.tennis_matches (stats_status) where stats_status = 'pending';

-- Source rows that failed validation. Never written to canonical tables; kept for review/reparse.
create table public.tennis_ingest_holds (
  provider text not null,
  external_id text not null,
  entity_type text not null,
  problems jsonb not null,
  payload jsonb,
  capture_id text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (provider, entity_type, external_id)
);

-- ---------- reference seeds ---------------------------------------------------------------------------
insert into public.tennis_tours (tour_key, label, gender_scope) values
  ('atp', 'ATP Tour', 'men'), ('atp_challenger', 'ATP Challenger Tour', 'men'), ('itf_men', 'ITF World Tennis Tour (men)', 'men'),
  ('wta', 'WTA Tour', 'women'), ('wta_125', 'WTA 125', 'women'), ('itf_women', 'ITF World Tennis Tour (women)', 'women'),
  ('grand_slam', 'Grand Slams', 'mixed'), ('team', 'Team competitions', 'mixed');

insert into public.tennis_competitions (competition_key, tour_key, level, label) values
  ('grand_slam', 'grand_slam', 'grand_slam', 'Grand Slam'),
  ('atp_finals', 'atp', 'finals', 'ATP Finals'), ('atp_1000', 'atp', '1000', 'ATP Masters 1000'), ('atp_500', 'atp', '500', 'ATP 500'), ('atp_250', 'atp', '250', 'ATP 250'),
  ('atp_challenger', 'atp_challenger', 'challenger', 'ATP Challenger'), ('itf_men', 'itf_men', 'itf', 'ITF Men'),
  ('wta_finals', 'wta', 'finals', 'WTA Finals'), ('wta_1000', 'wta', '1000', 'WTA 1000'), ('wta_500', 'wta', '500', 'WTA 500'), ('wta_250', 'wta', '250', 'WTA 250'),
  ('wta_125', 'wta_125', '125', 'WTA 125'), ('itf_women', 'itf_women', 'itf', 'ITF Women'),
  ('davis_cup', 'team', 'team', 'Davis Cup'), ('bjk_cup', 'team', 'team', 'Billie Jean King Cup'), ('united_cup', 'team', 'team', 'United Cup'), ('olympics', 'team', 'olympics', 'Olympics');

-- ---------- RLS: on everywhere, no client policies ---------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'tennis\_%' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

commit;
