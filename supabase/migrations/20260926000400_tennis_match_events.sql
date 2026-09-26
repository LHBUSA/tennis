-- tennis_event/1.0.0 — the one live + replay event contract (docs/TENNISCAST.md §Events).
--
-- quality distinguishes what we actually observed:
--   point_event     a source-published point (winner, reason) — from point-by-point feeds only
--   score_snapshot  a periodic observation of match state; transitions between two observations are
--                   recorded as ONE event, never split into invented points
-- Every row carries the full observed state after the event, so replay needs nothing else.

create table public.tennis_match_events (
  event_id text primary key,                          -- deterministic: hash of match + quality + source identity
  match_id uuid not null references public.tennis_matches (match_id),
  contract text not null default 'tennis_event/1.0.0',
  quality text not null check (quality in ('point_event', 'score_snapshot')),
  event_sequence int not null check (event_sequence >= 0),
  event_type text not null,
  source text not null,
  source_event_id text,
  observed_at timestamptz not null,
  event_at timestamptz,
  set_number smallint,
  game_number smallint,
  server_side char(1) check (server_side in ('A', 'B')),
  winner_side char(1) check (winner_side in ('A', 'B')),
  derivation text,                                    -- how a derived fact was proven (e.g. game winner)
  event_detail jsonb not null default '{}'::jsonb,    -- reason / stroke / break / from->to; nothing unsourced
  state jsonb not null,                               -- { status, sets:[{A,B,tb}], point:{A,B}, server }
  serve_speed_kmh numeric,
  serve_number smallint check (serve_number in (1, 2)),
  rally_length smallint,
  coordinates jsonb,
  raw_source_ref text,
  created_at timestamptz not null default now(),
  unique (match_id, quality, event_sequence),
  -- point-level facts can only come from point-level records
  check (quality = 'point_event' or (serve_speed_kmh is null and rally_length is null and coordinates is null and serve_number is null)),
  check (quality = 'point_event' or event_type not in ('point', 'ace', 'double_fault', 'winner', 'forced_error', 'unforced_error', 'service_winner'))
);
create index tennis_match_events_match on public.tennis_match_events (match_id, quality, event_sequence);

alter table public.tennis_match_events enable row level security;

create trigger tennis_match_events_append_only before update or delete on public.tennis_match_events
  for each row execute function public.tennis_append_only();
