// Incremental inputs for the Tennis DNA v2 build (docs/TENNIS_DNA_CONTRACT.md "Build performance").
//
// Ledger: each tour's RAW singles rows (the fields ledgerEntry reads, sets packed) are cached in R2 as 16 chunks
// by match-id prefix (derived/dna-v2/ledger/<tour>/<p>.json). A build reads only the rows whose updated_at is
// after the cache watermark, merges them chunk by chunk (one chunk in memory at a time), rewrites the chunks
// that changed, and turns rows into ledger entries with the CURRENT editions and player genders. The merge is
// trusted only when the eligible-row count equals the database's exact count; otherwise, when the cache is
// missing, older than 7 days, of another version, or a full build is requested, the whole tour is scanned
// (keyset by match id, which is also prefix order, so each chunk is written as soon as the scan passes it).
//
// Rank lists: cached with their snapshot descriptors (derived/dna-v2/ranks/<list>.json). Reused when every cached
// snapshot still has the same date / row count and no rank row was written since (KV rank:changed_at, set by every
// writer of tennis_rankings: official pages, ESPN lists, the ESPN relink); new snapshots are fetched alone when
// nothing else changed; anything else reloads the list.
// Deletions: a row merged away since the watermark is logged by the writer (tennis_source_changes
// duplicate_merged) and dropped from the cache; any other deletion shows up as a count mismatch -> full scan.
//
// Shadow verification (KV dna2:shadow = { until }): after an incremental ledger load the build ALSO streams a
// full scan and compares an order-sensitive hash of the raw rows; the result is logged to KV dna2:shadow:log.

import { ledgerEntry } from '../../shared/dna/match-dna.js';

export const CACHE_VERSION = 1;
const PREFIXES = '0123456789abcdef'.split('');
const FULL_EVERY_MS = 7 * 86400e3;
const SAFETY_MS = 5 * 60e3; // rows written while a build runs are re-read by the next one
const chunkKey = (tour, p) => `derived/dna-v2/ledger/${tour}/${p}.json`;
const META = (tour) => `dna2:ledger:${tour}`;
const EVENT = { ATP: 'MS', WTA: 'WS' };
const ELIGIBLE = new Set(['completed', 'retired']);
const SELECT = 'select=match_id,edition_id,event_type,round,format_key,status,winner_side,scheduled_at,started_at,surface,source_family,updated_at,tennis_sets(set_no,games_a,games_b),tennis_match_participants(side,participant_key)';

/** Store row -> cached raw row (array; fixed field order). */
export function rawOf(r) {
  const side = (s) => { const p = (r.tennis_match_participants || []).find((x) => x.side === s)?.participant_key; return p && p.startsWith('S:') ? p.slice(2) : null; };
  const packed = [...(r.tennis_sets || [])].sort((a, b) => a.set_no - b.set_no).map((s) => (s.games_a & 255) + 256 * (s.games_b & 255));
  return [r.match_id, r.edition_id, r.round, r.format_key, r.status, r.winner_side, r.scheduled_at, r.started_at, r.surface, r.source_family, packed, side('A'), side('B')];
}

function entryOf(raw, event, tourOf, editions, intern) {
  const [match_id, edition_id, round, format_key, status, winner_side, scheduled_at, started_at, surface, source_family, packed, A, B] = raw;
  return ledgerEntry({ match_id, edition_id, event_type: event, round, format_key, status, winner_side, scheduled_at, started_at, surface, source_family, packed, A, B, edition: editions.get(edition_id) }, tourOf, intern);
}

// 64-bit FNV-1a over the rows' canonical JSON, in match-id order (two 32-bit halves; deterministic, streaming)
export function hasher() {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0xcbf29ce4 | 0;
  return {
    add(s) { for (let i = 0; i < s.length; i += 1) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ (c + 0x9e37), 16777619); } h1 = Math.imul(h1 ^ 10, 16777619); },
    hex() { return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'); }
  };
}

async function* scan(store, event, extra = '') {
  let last = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const rows = await store.select('tennis_matches', `${SELECT}&event_type=eq.${event}${extra}&match_id=gt.${last}&order=match_id.asc&limit=1000`);
    for (const r of rows) yield r;
    if (rows.length < 1000) return;
    last = rows.at(-1).match_id;
  }
}

/**
 * One tour's ledger entries. mode 'auto' (incremental when the cache allows it) | 'full'.
 * Returns { entries, info: { mode, reason, delta_rows, chunks_written, rows, mismatched } }.
 */
export async function loadTourLedger(ctx, tour, { tourOf, editions, mode = 'auto' }) {
  const { store, kv } = ctx;
  const bucket = ctx.env?.TENNIS_SOURCE || null;
  const event = EVENT[tour];
  const pool = new Map();
  const intern = (x) => { if (x == null) return x; const h = pool.get(x); if (h !== undefined) return h; pool.set(x, x); return x; };
  const started = Date.now();
  const meta = bucket ? await kv.get(META(tour), 'json') : null;
  let reason = null;
  if (!bucket) reason = 'no_cache_bucket';
  else if (mode === 'full') reason = 'requested';
  else if (!meta || meta.v !== CACHE_VERSION) reason = 'no_cache';
  else if (Date.now() - Date.parse(meta.full_at) > FULL_EVERY_MS) reason = 'weekly_full';
  if (!reason) {
    const inc = await incremental(ctx, tour, event, meta, { tourOf, editions, intern, bucket, started });
    if (inc.ok) return inc.result;
    reason = inc.reason;
  }
  return full(ctx, tour, event, { tourOf, editions, intern, bucket, started, reason });
}

async function full(ctx, tour, event, { tourOf, editions, intern, bucket, started, reason }) {
  const entries = [];
  entries.mismatched = 0;
  let chunk = [];
  let cp = null;
  let rows = 0;
  let eligible = 0;
  let written = 0;
  const flush = async () => { if (bucket && cp != null) { await bucket.put(chunkKey(tour, cp), JSON.stringify(chunk)); written += 1; } chunk = []; };
  const seen = new Set();
  for await (const r of scan(ctx.store, event)) {
    const raw = rawOf(r);
    const p = raw[0][0];
    if (p !== cp) { await flush(); cp = p; seen.add(p); }
    chunk.push(raw);
    rows += 1;
    if (ELIGIBLE.has(raw[4])) eligible += 1;
    const e = entryOf(raw, event, tourOf, editions, intern);
    if (e && e.tour === tour) entries.push(e); else if (e) entries.mismatched += 1;
  }
  await flush();
  if (bucket) {
    for (const p of PREFIXES) if (!seen.has(p)) { await bucket.put(chunkKey(tour, p), '[]'); written += 1; }
    const now = new Date(started - SAFETY_MS).toISOString();
    await ctx.kv.put(META(tour), JSON.stringify({ v: CACHE_VERSION, watermark: now, full_at: new Date(started).toISOString(), rows, eligible }));
  }
  return { entries, info: { mode: 'full', reason, rows, eligible, chunks_written: written, mismatched: entries.mismatched } };
}

async function incremental(ctx, tour, event, meta, { tourOf, editions, intern, bucket, started }) {
  // 1. rows touched since the watermark (any status: a row that left completed/retired must leave the cache)
  const delta = new Map();
  for await (const r of scan(ctx.store, event, `&updated_at=gt.${encodeURIComponent(meta.watermark)}`)) delta.set(r.match_id, rawOf(r));
  // rows deleted since the watermark: the writer logs every merge-away as a source change (duplicate_merged)
  const gone = new Set();
  for (let off = 0; ; off += 1000) {
    const rows = await ctx.store.select('tennis_source_changes', `select=entity_id&entity_type=eq.match&kind=eq.duplicate_merged&observed_at=gt.${encodeURIComponent(meta.watermark)}&order=id.asc&limit=1000&offset=${off}`);
    for (const r of rows) if (!delta.has(r.entity_id)) gone.add(r.entity_id);
    if (rows.length < 1000) break;
  }
  const expect = await ctx.store.count('tennis_matches', `event_type=eq.${event}&status=in.(completed,retired)`);
  // 2. merge chunk by chunk
  const entries = [];
  entries.mismatched = 0;
  let rows = 0;
  let eligible = 0;
  let written = 0;
  const shadow = await shadowWanted(ctx);
  const h = shadow ? hasher() : null;
  const pending = new Map(PREFIXES.map((p) => [p, []]));
  for (const [id, raw] of delta) pending.get(id[0]).push(raw);
  for (const p of PREFIXES) {
    const obj = await bucket.get(chunkKey(tour, p));
    if (!obj) return { ok: false, reason: `chunk_missing_${p}` };
    let cached = JSON.parse(await obj.text());
    const d = pending.get(p);
    let changed = false;
    if (d.length || gone.size) {
      const ids = new Set(d.map((x) => x[0]));
      const before = cached.length;
      cached = cached.filter((x) => !ids.has(x[0]) && !gone.has(x[0]));
      changed = d.length > 0 || cached.length !== before;
      if (d.length) cached = cached.concat(d).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    }
    for (const raw of cached) {
      rows += 1;
      if (ELIGIBLE.has(raw[4])) eligible += 1;
      if (h) h.add(JSON.stringify(raw));
      const e = entryOf(raw, event, tourOf, editions, intern);
      if (e && e.tour === tour) entries.push(e); else if (e) entries.mismatched += 1;
    }
    // a changed chunk is written at once (one chunk in memory); if the count check below fails, the full scan
    // that follows rewrites every chunk anyway
    if (changed) { await bucket.put(chunkKey(tour, p), JSON.stringify(cached)); written += 1; }
  }
  // 3. integrity: the merged eligible rows must be exactly the database's
  if (eligible !== expect) return { ok: false, reason: `count_mismatch cache=${eligible} db=${expect}` };
  await ctx.kv.put(META(tour), JSON.stringify({ ...meta, watermark: new Date(started - SAFETY_MS).toISOString(), rows, eligible }));
  const info = { mode: 'incremental', reason: null, delta_rows: delta.size, deleted_rows: gone.size, rows, eligible, chunks_written: written, mismatched: entries.mismatched };
  if (h) info.shadow = await shadowCompare(ctx, tour, event, h.hex(), rows);
  return { ok: true, result: { entries, info } };
}

async function shadowWanted(ctx) {
  const s = await ctx.kv.get('dna2:shadow', 'json');
  return !!(s && s.until && Date.now() < Date.parse(s.until));
}

/** Streams the full scan, hashes it the same way, logs equality. Never changes what the build uses. */
async function shadowCompare(ctx, tour, event, incHash, incRows) {
  const h = hasher();
  let rows = 0;
  for await (const r of scan(ctx.store, event)) { h.add(JSON.stringify(rawOf(r))); rows += 1; }
  const res = { tour, at: new Date().toISOString(), equal: h.hex() === incHash && rows === incRows, incremental: { hash: incHash, rows: incRows }, full: { hash: h.hex(), rows } };
  const log = (await ctx.kv.get('dna2:shadow:log', 'json')) || [];
  log.push(res);
  await ctx.kv.put('dna2:shadow:log', JSON.stringify(log.slice(-60)));
  return res;
}

// ---- rank lists ---------------------------------------------------------------------------------------------
const rankKey = (list) => `derived/dna-v2/ranks/${list}.json`;

/**
 * [{ snapshot_id, ranking_date, row_count, source_family }] + ranks per snapshot, from cache where still valid.
 * fetchRanks(snapshots) -> Map(snapshot_id -> [[pbe_player_id, rank], ...]) does the store reads.
 */
export async function cachedRankRows(ctx, list, snaps, fetchRanks, { mode = 'auto' } = {}) {
  const bucket = ctx.env?.TENNIS_SOURCE || null;
  if (!bucket) return { ranks: await fetchRanks(snaps), info: { mode: 'full', reason: 'no_cache_bucket' } };
  const changed = await ctx.kv.get('rank:changed_at');
  let cache = null;
  if (mode !== 'full') { const o = await bucket.get(rankKey(list)); cache = o ? JSON.parse(await o.text()) : null; }
  let reason = mode === 'full' ? 'requested' : !cache ? 'no_cache' : cache.v !== CACHE_VERSION ? 'version' : changed && changed > cache.built_at ? 'rank_rows_changed' : Date.now() - Date.parse(cache.full_at) > FULL_EVERY_MS ? 'weekly_full' : null;
  if (!reason) {
    const now = new Map(snaps.map((s) => [s.snapshot_id, s]));
    for (const [id, d] of Object.entries(cache.snaps)) { const s = now.get(id); if (!s || s.ranking_date !== d[0] || s.row_count !== d[1]) { reason = 'snapshot_changed'; break; } }
  }
  const builtAt = new Date().toISOString();
  if (reason) {
    const ranks = await fetchRanks(snaps);
    await bucket.put(rankKey(list), JSON.stringify({ v: CACHE_VERSION, built_at: builtAt, full_at: builtAt, snaps: Object.fromEntries(snaps.map((s) => [s.snapshot_id, [s.ranking_date, s.row_count]])), ranks: Object.fromEntries(ranks) }));
    return { ranks, info: { mode: 'full', reason, lists: snaps.length } };
  }
  const fresh = snaps.filter((s) => !cache.snaps[s.snapshot_id]);
  const add = fresh.length ? await fetchRanks(fresh) : new Map();
  const ranks = new Map(snaps.map((s) => [s.snapshot_id, cache.ranks[s.snapshot_id] || add.get(s.snapshot_id) || []]));
  if (fresh.length) await bucket.put(rankKey(list), JSON.stringify({ ...cache, built_at: builtAt, snaps: Object.fromEntries(snaps.map((s) => [s.snapshot_id, [s.ranking_date, s.row_count]])), ranks: Object.fromEntries(ranks) }));
  return { ranks, info: { mode: 'incremental', new_lists: fresh.length, lists: snaps.length } };
}

