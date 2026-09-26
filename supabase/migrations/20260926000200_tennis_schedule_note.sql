-- Order-of-play note as the source printed it ("Followed By", "Not Before 12:00"). Source text, not parsed.
alter table public.tennis_matches add column if not exists schedule_note text;
