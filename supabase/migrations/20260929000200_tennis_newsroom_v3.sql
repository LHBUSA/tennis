-- Newsroom V3 (docs/NEWSROOM_V3.md): a multi-tier newsroom instead of one global materiality bar.
--   editorial class per event: wire (fact card, no article) | brief | full | deep (article depth)
--   one canonical story per real-world event: an event may upgrade wire -> brief -> full -> deep in place; the article
--   keeps its id, slug and first_published_at; revisions are recorded, never a second URL.
-- Additive only. The external-publisher wire (tennis_news_wire) is untouched: the internal live wire is a projection of
-- tennis_news_events. State 'wire' = classified as a wire item (replaces below_threshold for new events; old rows keep
-- their historical state).

alter table public.tennis_news_events drop constraint if exists tennis_news_events_state_check;
alter table public.tennis_news_events add constraint tennis_news_events_state_check
  check (state in ('detected', 'below_threshold', 'wire', 'enriching', 'published', 'held', 'duplicate', 'failed')) not valid;
alter table public.tennis_news_events validate constraint tennis_news_events_state_check;

alter table public.tennis_news_events
  add column if not exists editorial_class text check (editorial_class in ('wire', 'brief', 'full', 'deep')),
  add column if not exists class_reasons jsonb not null default '[]',
  add column if not exists class_history jsonb not null default '[]',
  add column if not exists classifier_version text;
create index if not exists tennis_news_events_wire on public.tennis_news_events (detected_at desc) where editorial_class is not null;

alter table public.tennis_articles
  add column if not exists story_class text check (story_class in ('brief', 'full', 'deep')),
  add column if not exists revised_at timestamptz,
  add column if not exists revisions jsonb not null default '[]';
