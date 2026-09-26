-- Venues, broadcast contract, data-quality levels, simulation ledger.

-- ---------- venues: location entities; precision says what we actually know --------------------------
create table public.tennis_venues (
  venue_id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  venue_name text,                                   -- null until a source names the venue
  city text not null,
  state_region text,
  country char(3),
  latitude numeric,                                  -- only when a source gives venue coordinates
  longitude numeric,
  timezone text,
  precision text not null check (precision in ('city', 'venue')),
  source_family text not null,
  updated_at timestamptz not null default now(),
  check (precision = 'venue' or (latitude is null and longitude is null))
);
alter table public.tennis_tournament_editions add column if not exists venue_id uuid references public.tennis_venues (venue_id);
alter table public.tennis_venues enable row level security;

-- ---------- tennis_broadcast/1.0.0 — territorial, sourced, expiring ---------------------------------
create table public.tennis_broadcasts (
  broadcast_id uuid primary key default gen_random_uuid(),
  contract text not null default 'tennis_broadcast/1.0.0',
  tournament_id uuid references public.tennis_tournaments (tournament_id),
  edition_id uuid references public.tennis_tournament_editions (edition_id),
  match_id uuid references public.tennis_matches (match_id),
  territory text not null,
  country_code char(2),
  broadcaster text not null,
  service text,
  distribution_type text not null check (distribution_type in ('tv', 'stream', 'both')),
  official_url text not null check (official_url ~ '^https://'),
  deep_link text check (deep_link is null or deep_link ~ '^https://'),
  subscription_required boolean,
  free_to_watch boolean,
  language text,
  starts_at timestamptz,
  ends_at timestamptz,
  source text not null,
  source_url text not null,
  verified_at timestamptz not null,
  expires_at timestamptz,                            -- rights change: never permanent truth
  superseded_by uuid references public.tennis_broadcasts (broadcast_id),
  created_at timestamptz not null default now(),
  check (edition_id is not null or tournament_id is not null or match_id is not null)
);
create index tennis_broadcasts_scope on public.tennis_broadcasts (edition_id, match_id, country_code);
alter table public.tennis_broadcasts enable row level security;

-- ---------- simulation ledger (research) ---------------------------------------------------------------
create table public.tennis_simulations (
  simulation_id uuid primary key default gen_random_uuid(),
  model_version text not null,
  feature_snapshot jsonb not null,                   -- exact inputs, with their as_of dates
  seed bigint not null,
  iterations int not null check (iterations > 0),
  config jsonb not null,
  output jsonb not null,
  status text not null default 'research' check (status in ('research', 'validated')),
  created_at timestamptz not null default now()
);
alter table public.tennis_simulations enable row level security;

-- ---------- data quality: Q1 result only · Q2 set/game score · Q3 match statistics · Q4 point-by-point ·
--            Q5 point + spatial/shot (no source yet) ----------------------------------------------------
create view public.tennis_match_quality with (security_invoker = true) as
select m.match_id, m.edition_id, m.event_type, m.status, m.source_family,
  case
    when exists (select 1 from public.tennis_match_events e where e.match_id = m.match_id and e.quality = 'point_event' and e.coordinates is not null) then 'Q5'
    when exists (select 1 from public.tennis_match_events e where e.match_id = m.match_id and e.quality = 'point_event') then 'Q4'
    when exists (select 1 from public.tennis_match_stats s where s.match_id = m.match_id) then 'Q3'
    when exists (select 1 from public.tennis_sets s where s.match_id = m.match_id) then 'Q2'
    else 'Q1'
  end as quality
from public.tennis_matches m;

create view public.tennis_coverage_summary with (security_invoker = true) as
select e.year, coalesce(e.level, 'unknown') as level, q.event_type, q.source_family,
  count(*) as matches,
  count(*) filter (where q.quality = 'Q1') as q1,
  count(*) filter (where q.quality = 'Q2') as q2,
  count(*) filter (where q.quality = 'Q3') as q3,
  count(*) filter (where q.quality = 'Q4') as q4,
  count(*) filter (where q.quality = 'Q5') as q5
from public.tennis_match_quality q join public.tennis_tournament_editions e using (edition_id)
group by 1, 2, 3, 4;

revoke all on public.tennis_match_quality, public.tennis_coverage_summary from anon, authenticated;
