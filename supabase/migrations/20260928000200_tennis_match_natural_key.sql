-- One real match = one canonical row, enforced by the DATABASE (not only by the writer's read-then-write check).
-- 2026-09-28: concurrent backfill writers raced (7 WS duplicates) and a query-encoding defect let 4,392 WD
-- duplicates through; both were repaired, but a read-then-write check cannot stop two writers racing.
--
-- natural_key = '<event_type>|<stage>|<participant key A~B sorted>' with stage m / q / rr (writer.js naturalKey),
-- set by the writer on every upsert. A partial unique index on (edition_id, natural_key) makes the second writer
-- of the same match fail with 23505; the writer then attaches its external id to the surviving row.
-- Legacy rows get the key by a batched backfill (scripts/ops/backfill-natural-key.sql) BEFORE the index is built;
-- the index is created CONCURRENTLY (no table lock) as a separate step. Rows without a key are not constrained.

alter table public.tennis_matches add column if not exists natural_key text;
