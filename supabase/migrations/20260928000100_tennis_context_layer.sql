-- Tennis Phase 5 context layer (docs/TENNIS_DATA_MODEL.md "Context layer"). Additive only.
-- 1. tennis_source_mappings: every source tournament / edition id we have looked at, mapped or not, with the
--    method, confidence and evidence that decided it. tennis_{tournament,edition}_external_ids stay the
--    resolution index; only status = 'mapped' rows are mirrored there.
-- 2. tennis_edition_attributes: sourced edition facts (surface, indoor, level) per source with provenance;
--    tennis_tournament_editions.surface / indoor keep the effective value.
-- 3. tennis_draw_slots: draw position, seed and entry per source (never projected).
-- 4. tennis_player_source_records: source-published player aggregates (WTA /records, /year; ESPN season
--    statistics) kept as reported.
-- 5. tennis_source_disagreements: a source value that disagrees with our derived value is logged, never
--    written over the derived value.

create table if not exists public.tennis_source_mappings (
  entity_type text not null check (entity_type in ('tournament', 'edition')),
  provider text not null,
  external_id text not null,
  canonical_id uuid,
  status text not null check (status in ('mapped', 'unresolved', 'ambiguous', 'rejected')),
  method text not null,
  confidence text check (confidence in ('high', 'medium')),
  evidence jsonb not null default '{}',
  capture_ids text[] not null default '{}',
  rule_version text not null,
  decided_at timestamptz not null default now(),
  primary key (entity_type, provider, external_id),
  check (status <> 'mapped' or (canonical_id is not null and confidence is not null)),
  check (status = 'mapped' or confidence is null)
);
create index if not exists tennis_source_mappings_canonical on public.tennis_source_mappings (canonical_id);
create index if not exists tennis_source_mappings_status on public.tennis_source_mappings (entity_type, provider, status);

create table if not exists public.tennis_edition_attributes (
  edition_id uuid not null references public.tennis_tournament_editions (edition_id),
  attribute text not null check (attribute in ('surface', 'indoor', 'level')),
  value text not null,
  source text not null,
  method text not null check (method in ('direct', 'combined_event', 'draw_sheet', 'mapped_edition')),
  source_ref text,
  capture_id text,
  evidence jsonb not null default '{}',
  observed_at timestamptz not null default now(),
  primary key (edition_id, attribute, source),
  check (attribute <> 'surface' or value in ('hard', 'clay', 'grass', 'carpet')),
  check (attribute <> 'indoor' or value in ('true', 'false'))
);

create table if not exists public.tennis_draw_slots (
  edition_id uuid not null references public.tennis_tournament_editions (edition_id),
  event_type text not null,
  draw text not null check (draw in ('main', 'qualifying')),
  position smallint not null check (position > 0),
  participant_key text,
  bye boolean not null default false,
  seed smallint check (seed > 0),
  entry_type text,
  source text not null,
  source_ref text,
  capture_id text,
  observed_at timestamptz not null default now(),
  primary key (edition_id, event_type, draw, position, source),
  check (not (bye and participant_key is not null))
);
create index if not exists tennis_draw_slots_participant on public.tennis_draw_slots (participant_key);

create table if not exists public.tennis_player_source_records (
  pbe_player_id uuid not null references public.tennis_players (pbe_player_id),
  provider text not null,
  kind text not null check (kind in ('career_records', 'season_stats', 'season_record')),
  period text not null,
  payload jsonb not null,
  source_ref text,
  capture_id text,
  source_synced_at timestamptz,
  observed_at timestamptz not null default now(),
  primary key (pbe_player_id, provider, kind, period)
);

create table if not exists public.tennis_source_disagreements (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  field text not null,
  source text not null,
  source_value jsonb,
  derived_value jsonb,
  detail jsonb,
  observed_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (entity_type, entity_id, field, source)
);

alter table public.tennis_source_mappings enable row level security;
alter table public.tennis_edition_attributes enable row level security;
alter table public.tennis_draw_slots enable row level security;
alter table public.tennis_player_source_records enable row level security;
alter table public.tennis_source_disagreements enable row level security;
