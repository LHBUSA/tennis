-- Tennis newsroom pipeline state (docs/NEWSROOM.md). Ported from the UFC realtime pipeline: leases so a
-- stalled run cannot overwrite its replacement, bounded attempts, terminal holds with an explicit requeue,
-- and per-stage telemetry for detection -> publication latency.

alter table public.tennis_news_events
  add column if not exists state text not null default 'detected'
    check (state in ('detected', 'below_threshold', 'enriching', 'published', 'held', 'duplicate', 'failed')),
  add column if not exists state_reason text,
  add column if not exists signature text,
  add column if not exists match_id uuid references public.tennis_matches (match_id),
  add column if not exists detected_at timestamptz not null default now(),
  add column if not exists state_changed_at timestamptz not null default now(),
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempts smallint not null default 0,
  add column if not exists article_id uuid;
create index if not exists tennis_news_events_state on public.tennis_news_events (state, detected_at);
create index if not exists tennis_news_events_signature on public.tennis_news_events (signature);

alter table public.tennis_articles
  add column if not exists story_type text,
  add column if not exists desk text,
  add column if not exists primary_player_id uuid references public.tennis_players (pbe_player_id),
  add column if not exists player_ids uuid[] not null default '{}',
  add column if not exists match_id uuid references public.tennis_matches (match_id),
  add column if not exists tournament jsonb,
  add column if not exists key_stat jsonb,
  add column if not exists content_plan jsonb,
  add column if not exists prose_origin text check (prose_origin in ('model', 'baseline')),
  add column if not exists hold_reason text,
  add column if not exists corroboration jsonb not null default '[]',
  add column if not exists detected_at timestamptz,
  add column if not exists first_published_at timestamptz;
create index if not exists tennis_articles_published on public.tennis_articles (status, published_at desc, article_id);
create index if not exists tennis_articles_desk on public.tennis_articles (desk, published_at desc);

create table if not exists public.tennis_news_pipeline_events (
  id bigint generated always as identity primary key,
  event_id text references public.tennis_news_events (event_id),
  article_id uuid,
  stage text not null check (stage in ('detect', 'packet', 'compose', 'editorial', 'gates', 'publish', 'hold', 'duplicate', 'cost', 'error')),
  status text not null check (status in ('ok', 'fail', 'skip')),
  latency_ms int,
  since_detect_ms bigint,
  detail jsonb,
  at timestamptz not null default now()
);
create index if not exists tennis_news_pipeline_events_at on public.tennis_news_pipeline_events (stage, at desc);

alter table public.tennis_news_pipeline_events enable row level security;

-- external wire (supplemental, attributed): headline + link + publisher + time + short permitted excerpt only
create table if not exists public.tennis_news_wire (
  wire_id text primary key,                 -- sha256(normalized title | domain)
  source_key text not null,
  publisher text not null,
  url text not null,
  title text not null,
  excerpt text,
  published_at timestamptz,
  detected_at timestamptz not null default now(),
  entities jsonb not null default '[]',
  state text not null default 'new' check (state in ('new', 'linked', 'skipped')),
  linked_event_id text references public.tennis_news_events (event_id)
);
alter table public.tennis_news_wire enable row level security;

-- claim the next events atomically with a lease (FOR UPDATE SKIP LOCKED)
create or replace function public.tennis_news_claim(p_limit int, p_lease_s int)
returns setof public.tennis_news_events
language sql
security definer
set search_path = public
as $$
  update public.tennis_news_events e
     set state = 'enriching', lease_token = gen_random_uuid(), lease_expires_at = now() + make_interval(secs => p_lease_s),
         attempts = e.attempts + 1, state_changed_at = now()
   where e.event_id in (
     select event_id from public.tennis_news_events
      where (state = 'detected') or (state = 'enriching' and lease_expires_at < now() and attempts < 3)
      order by materiality desc nulls last, detected_at
      limit p_limit
      for update skip locked)
  returning e.*;
$$;
revoke all on function public.tennis_news_claim(int, int) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on function public.tennis_news_claim(int, int) from anon, authenticated; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public.tennis_news_claim(int, int) to service_role; end if;
end $$;
