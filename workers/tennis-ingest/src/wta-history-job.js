// WTA player-history lane (wta_history): official career match lists, one player at a time. docs/TENNIS_SOURCE_MATRIX.md.
// Queue: current official WTA top list first, then every canonical WTA player (rebuilt monthly). Each page is
// written edition by edition through the cross-source writer: an existing official WTA API / Slam row stays
// canonical (the history row attaches), an ESPN row is taken over — also when ESPN filed it under its own
// edition (proven per player: same event, stage and opponent, edition dates overlapping within 3 days).

import * as hist from '../../providers/wta-history.js';
import { fetchRun } from './jobs.js';
import { writeGroups, upsertPlayersFull } from './writer.js';
import { inList } from '../../shared/store/postgrest.js';
import { tournamentId, tournamentKey, editionId, slugify, competitionFor, SLAMS } from '../../shared/canonical/ids.js';
import { mintPlayerId } from '../../shared/canonical/identity.js';

const Q = 'wh:queue';
const S = 'wh:state';
const PAGE = 100;

/**
 * The backfill population: the previous queue (order kept) plus any player newly on the latest official WTA
 * singles list. Never "every WTA id we know": opponents minted by the backfill itself do not join the queue, so the
 * lane cannot turn into an open-ended crawl (the 2026-09-28 scope is the 3,523-player population + new entrants).
 */
async function buildQueue(ctx, prev = []) {
  const [snap] = await ctx.store.select('tennis_ranking_snapshots', 'select=snapshot_id&list_key=eq.wta_singles&source_family=eq.wta&row_count=gt.0&order=ranking_date.desc&limit=1');
  const top = snap ? (await ctx.store.select('tennis_rankings', `select=provider_player_id,rank&snapshot_id=eq.${snap.snapshot_id}&order=rank.asc&limit=1000`)).map((r) => r.provider_player_id) : [];
  if (!prev.length) {
    // first build only: the official top list, then the canonical WTA players known at that time
    const all = [];
    for (let off = 0; ; off += 1000) {
      const rows = await ctx.store.select('tennis_players', `select=founding_external_key&founding_external_key=like.wta:*&status=eq.active&order=founding_external_key.asc&limit=1000&offset=${off}`);
      all.push(...rows.map((r) => r.founding_external_key.slice(4)));
      if (rows.length < 1000) break;
    }
    return [...new Set([...top, ...all])];
  }
  return [...new Set([...prev, ...top])];
}

/**
 * Every participant row of the player's keys with its match (2026-09-28, bounded): ONE key per statement (equality on
 * tennis_match_participants_key) with a match_id keyset, never OFFSET, then sorted by match_id -- the exact rows and
 * order of the previous single query over the whole key list (which the planner could run as a walk of the whole
 * participants primary key under ORDER BY match_id + LIMIT: mean 631 ms, max 7.3 s). Each statement is bounded by one
 * key's career (a player's singles key, or one doubles partnership).
 */
export async function playerRows(store, mine, { page = 1000 } = {}) {
  const rows = [];
  for (const key of mine) {
    for (let after = null; ;) {
      const part = await store.select('tennis_match_participants', `select=match_id,participant_key,tennis_matches!inner(edition_id,event_type,round,source_family,tennis_tournament_editions(start_date,end_date,source_family),tennis_match_participants(participant_key))&participant_key=eq.${encodeURIComponent(key)}${after ? `&match_id=gt.${after}` : ''}&order=match_id.asc&limit=${page}`);
      rows.push(...part);
      if (part.length < page) break;
      after = part.at(-1).match_id;
    }
  }
  return rows.sort((a, b) => (a.match_id < b.match_id ? -1 : a.match_id > b.match_id ? 1 : a.participant_key < b.participant_key ? -1 : 1));
}

/** The player's existing canonical matches in ANY edition: `${event}|${stage}|${opponentKey}` -> [{ match_id, edition_id, source, start, end }]. */
async function playerIndex(store, pid) {
  const mem = await store.select('tennis_participant_members', `select=participant_key&pbe_player_id=eq.${pid}`);
  if (!mem.length) return new Map();
  const mine = new Set(mem.map((m) => m.participant_key));
  const rows = await playerRows(store, mine);
  const idx = new Map();
  for (const r of rows) {
    const m = r.tennis_matches;
    const opp = (m.tennis_match_participants || []).map((p) => p.participant_key).find((k) => !mine.has(k));
    if (!opp) continue;
    const stage = /^Q-/.test(m.round || '') ? 'qualifying' : m.round === 'RR' ? 'round_robin' : 'main';
    const k = `${m.event_type}|${stage}|${opp}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push({ match_id: r.match_id, edition_id: m.edition_id, source: m.source_family, edition_source: m.tennis_tournament_editions?.source_family || null, start: m.tennis_tournament_editions?.start_date || null, end: m.tennis_tournament_editions?.end_date || null });
  }
  return idx;
}

/**
 * Edition for history rows: INSERT-ONLY (an existing official calendar edition is never overwritten); dates,
 * surface and indoor are filled only where the stored edition has none. New tournaments get a unique slug.
 */
export async function ensureHistoryEdition(store, e) {
  const key = tournamentKey('wta', e.provider_tournament_id, e.name, e.level);
  const tid = await tournamentId(key);
  const eid = await editionId(tid, e.year);
  const [t] = await store.select('tennis_tournaments', `select=tournament_id&tournament_id=eq.${tid}`);
  if (!t) {
    const slam = key.startsWith('slam:') ? key.slice(5) : null;
    let slug = slam || `${slugify(e.name)}${/^itf$/i.test(e.level || '') ? '-itf' : ''}` || `wta-${e.provider_tournament_id}`;
    const [taken] = await store.select('tennis_tournaments', `select=tournament_id&slug=eq.${slug}`);
    if (taken) slug = `${slug}-${e.provider_tournament_id}`;
    const nm = slam ? Object.keys(SLAMS).find((k) => SLAMS[k] === slam).replace(/\b\w/g, (c) => c.toUpperCase()) : String(e.name || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    await store.upsert('tennis_tournaments', [{ tournament_id: tid, slug, name: nm, competition_key: competitionFor(e.level), country: null, city: null }], { onConflict: 'tournament_id', ignore: true });
  }
  await store.upsert('tennis_tournament_editions', [{ edition_id: eid, tournament_id: tid, year: e.year, competition_key: competitionFor(e.level), start_date: e.start_date, end_date: e.end_date && e.start_date && e.end_date < e.start_date ? e.start_date : e.end_date, surface: e.surface, indoor: e.indoor, source_family: 'wta', name: e.title || e.name, level: e.level, singles_draw_size: e.singles_draw_size, doubles_draw_size: e.doubles_draw_size, updated_at: new Date().toISOString() }], { onConflict: 'edition_id', ignore: true });
  if (e.surface) await store.req('PATCH', `tennis_tournament_editions?edition_id=eq.${eid}&surface=is.null`, { body: { surface: e.surface } });
  if (e.indoor != null) await store.req('PATCH', `tennis_tournament_editions?edition_id=eq.${eid}&indoor=is.null`, { body: { indoor: e.indoor } });
  if (e.start_date && e.end_date) await store.req('PATCH', `tennis_tournament_editions?edition_id=eq.${eid}&start_date=is.null&end_date=is.null`, { body: { start_date: e.start_date, end_date: e.end_date } });
  await store.upsert('tennis_tournament_external_ids', [{ provider: 'wta', external_id: String(e.provider_tournament_id), tournament_id: tid }], { onConflict: 'provider,external_id', ignore: true });
  await store.upsert('tennis_edition_external_ids', [{ provider: 'wta', external_id: `${e.live_scoring_id || e.provider_tournament_id}-${e.year}`, edition_id: eid }], { onConflict: 'provider,external_id', ignore: true });
  return eid;
}

const keyOf = async (members) => (members.length === 1 ? `S:${await mintPlayerId('wta', members[0].provider_id)}` : `D:${(await Promise.all(members.map((m) => mintPlayerId('wta', m.provider_id)))).sort().join('+')}`);
// the SAME event filed under ESPN's edition: start dates within 3 days (back-to-back weeks never qualify)
const sameEventWeek = (a, b) => a.start && b.start && Math.abs(Date.parse(a.start) - Date.parse(b.start)) <= 3 * 86400e3;

/** One page of one player's history. */
export async function historyPage(ctx, wtaId, page) {
  const r = await fetchRun(ctx, hist.playerMatches, { id: wtaId, page, pageSize: PAGE });
  if (r.state !== 'PASS') {
    if (r.state === 'DEGRADED' && (r.error === 'zero_records' || r.http_status === 404)) return { state: 'END' };
    // HTTP 200 with an EMPTY body (observed 1022815): the player has no match list — absent, recorded for audit
    if (r.http_status === 200 && r.bytes === 0) {
      // per-player key (no shared-key write contention between shards)
      await ctx.kv.put(`wh:empty:${wtaId}`, new Date().toISOString());
      return { state: 'END', empty_body: true };
    }
    throw new Error(`wta history ${wtaId} p${page}: ${r.state} ${r.error || ''}`.trim());
  }
  const body = r.records[0];
  const rows = body.matches || [];
  const parsed = rows.map((x) => hist.parseHistoryRow(x));
  // player bios the rows carry (DOB, nationality) -> full upsert of every WTA id seen
  const people = new Map();
  if (body.player?.id) people.set(String(body.player.id), body.player);
  for (const x of rows) for (const p of [x.opponent, x.partner, x.opponent_partner]) if (p?.id) people.set(String(p.id), p);
  await upsertPlayersFull(ctx.store, [...people.values()].map((p) => ({ provider_id: String(p.id), first_name: p.firstName || null, last_name: p.lastName || null, full_name: p.fullName || null, gender: 'F', dob: /^\d{4}-\d{2}-\d{2}$/.test(p.dateOfBirth || '') ? p.dateOfBirth : null, country: p.countryCode || null })), 'wta');
  const pid = await mintPlayerId('wta', wtaId);
  // one index per player per invocation: later pages of the same player reuse it (its only use is to find
  // ESPN-owned rows to take over; a row already taken over by an earlier page resolves to the same match)
  if (ctx.whIndex?.pid !== pid) ctx.whIndex = { pid, idx: await playerIndex(ctx.store, pid) };
  const idx = ctx.whIndex.idx;
  const groups = new Map();
  const out = { rows: rows.length, written: 0, attached: 0, taken_over: 0, held: 0, duplicate_candidates: 0, skipped: {}, cross_edition: 0 };
  for (const p of parsed) {
    if (p.skip || p.hold) { const k = (p.skip || p.hold).split(':')[0]; out.skipped[k] = (out.skipped[k] || 0) + 1; continue; }
    const key = `${p.edition.provider_tournament_id}-${p.edition.year}`;
    if (!groups.has(key)) groups.set(key, { edition: p.edition, matches: [] });
    groups.get(key).matches.push(p.match);
  }
  const known = new Set((await ctx.kv.get('wh:eds', 'json')) || []);
  const knownBefore = known.size;
  const batch = [];
  for (const g of groups.values()) {
    // an edition ensured on an earlier run (same facts) needs no re-check
    const ek = `${g.edition.provider_tournament_id}-${g.edition.year}`;
    const eid = known.has(ek) ? await editionId(await tournamentId(tournamentKey('wta', g.edition.provider_tournament_id, g.edition.name, g.edition.level)), g.edition.year) : await ensureHistoryEdition(ctx.store, g.edition);
    known.add(ek);
    for (const m of g.matches) {
      if (!m.stage) continue;
      const mineSide = m.sides.A.some((x) => x.provider_id === String(wtaId)) ? 'A' : 'B';
      const opp = await keyOf(m.sides[mineSide === 'A' ? 'B' : 'A']);
      // only an ESPN-owned row in an ESPN edition can be the same match filed elsewhere; an official row in another
      // official edition is ANOTHER match (players meet in back-to-back tournaments)
      const cands = (idx.get(`${m.event_type}|${m.stage}|${opp}`) || []).filter((c) => c.edition_id !== eid && c.source === 'espn' && c.edition_source === 'espn' && sameEventWeek(c, { start: g.edition.start_date }));
      if (cands.length === 1) { m.existing_match_id = cands[0].match_id; m.existing_owner = cands[0].source; out.cross_edition += 1; }
    }
    batch.push({ edition: { edition_id: eid, surface: g.edition.surface, indoor: g.edition.indoor }, sourceMatches: g.matches });
  }
  // the whole page in one batched pass (identical per-edition rules; ~20 store requests instead of ~15 per edition)
  if (batch.length) {
    const w = await writeGroups(ctx.store, batch, { captureId: r.capture?.capture_id || null, dedupe: true });
    for (const k of ['written', 'attached', 'taken_over', 'held', 'duplicate_candidates']) out[k] += w[k] || 0;
    const eds = batch.map((b) => b.edition.edition_id);
    for (let i = 0; i < eds.length; i += 100) await ctx.store.req('PATCH', `tennis_matches?edition_id=${inList(eds.slice(i, i + 100))}&source_family=eq.wta_history&stats_status=eq.pending`, { body: { stats_status: 'unavailable' } });
  }
  // wh:eds is only a cache (every shard shares the key; KV allows ~1 write/s per key): written when it grew, a
  // rate-limited write is skipped
  if (known.size !== knownBefore) { try { await ctx.kv.put('wh:eds', JSON.stringify([...known])); } catch (e) { if (!/429/.test(String(e?.message || e))) throw e; } }
  return { state: rows.length < PAGE ? 'END' : 'MORE', ...out };
}

const DONE = (id) => `wh:done:${id}`; // completion ledger: one key per player, value = that player's totals
const PAGE_AT = (id) => `wh:page:${id}`; // resume page of a player in progress (written only while MORE)
export const ADMIN_FLAG = 'wh:admin_active'; // an admin sharded backfill is running: the cron lane stands aside
const SUMS = ['rows', 'written', 'attached', 'taken_over', 'held', 'duplicate_candidates', 'cross_edition'];
const isDeadlock = (e) => /40P01|deadlock/i.test(String(e?.message || e));

/**
 * Bounded unit: up to `pages` history pages across the queue. Shard k of n walks positions k, k+n, k+2n ...
 * (a match two players share gets one deterministic id, so overlapping players are safe, only wasteful). A player
 * with a completion key is skipped by every runner (cron or any shard layout), so re-sharding never re-fetches
 * finished history; a player in progress resumes at its recorded page.
 */
export async function wtaHistoryStep(ctx, { pages = 2, shard = 0, shards = 1, admin = false, resume = null, pageFn = historyPage } = {}) {
  const SK = shards > 1 ? `${S}:${shard}/${shards}` : S;
  if (admin) await ctx.kv.put(ADMIN_FLAG, new Date().toISOString(), { expirationTtl: 900 });
  else if (await ctx.kv.get(ADMIN_FLAG)) return { skipped: 'admin_backfill_active' };
  let st = (await ctx.kv.get(SK, 'json')) || { i: shard, page: 0, players_done: 0 };
  // KV reads can trail a write by up to a minute: the driver hands back the cursor it was given last time, and
  // the further of the two wins (a cursor only moves forward), so a stale read never repeats pages
  if (resume && Number.isInteger(resume.i) && (resume.i > st.i || (resume.i === st.i && resume.page > (st.page || 0)))) st = { ...st, i: resume.i, page: resume.page, acc: resume.i === st.i ? st.acc : null };
  let queue = (await ctx.kv.get(Q, 'json')) || [];
  // the queue carries its own build time: a new shard layout (no state yet) never triggers a rebuild
  const qBuilt = await ctx.kv.get(`${Q}:built_at`);
  if (!queue.length || !qBuilt || Date.now() - Date.parse(qBuilt) > 30 * 86400e3) {
    queue = await buildQueue(ctx, queue);
    await ctx.kv.put(Q, JSON.stringify(queue));
    await ctx.kv.put(`${Q}:built_at`, new Date().toISOString());
    if (st.i >= queue.length) st = { ...st, i: shard, page: 0 };
  }
  const out = { runs: [], skipped_done: 0 };
  let n = 0;
  let guard = 0;
  while (n < pages && st.i < queue.length && guard < 400) {
    guard += 1;
    const id = queue[st.i];
    // a queue entry that is not a WTA player id (a draw placeholder such as "TBD") is skipped, never fetched
    if (!/^\d+$/.test(String(id))) { out.skipped_done += 1; st.i += shards; st.page = 0; st.acc = null; continue; }
    if (!st.acc) {
      // entering a player: skip a finished one, resume one another runner left mid-history
      if (await ctx.kv.get(DONE(id))) { out.skipped_done += 1; st.i += shards; st.page = 0; continue; }
      st.page = Math.max(st.page || 0, Number(await ctx.kv.get(PAGE_AT(id))) || 0);
      st.acc = { pages: 0 };
    }
    let r;
    try { r = await pageFn(ctx, id, st.page); } catch (e) {
      if (!isDeadlock(e)) { await ctx.kv.put(SK, JSON.stringify(st)); throw e; }
      r = await pageFn(ctx, id, st.page); // concurrent shards upsert the same people: retry the page once
    }
    n += 1;
    out.runs.push({ player: id, page: st.page, ...r });
    for (const k of SUMS) st.acc[k] = (st.acc[k] || 0) + (r[k] || 0);
    st.acc.pages += 1;
    if (r.state === 'END') {
      await ctx.kv.put(DONE(id), JSON.stringify({ ...st.acc, at: new Date().toISOString(), by: SK }));
      await ctx.kv.delete(PAGE_AT(id));
      st.i += shards; st.page = 0; st.players_done += 1; st.acc = null;
    } else {
      st.page += 1;
      await ctx.kv.put(PAGE_AT(id), String(st.page));
    }
    await ctx.kv.put(SK, JSON.stringify(st));
  }
  if (guard >= 400) await ctx.kv.put(SK, JSON.stringify(st));
  return { ...out, queue: queue.length, position: st.i, page: st.page, players_done: st.players_done, done: st.i >= queue.length };
}
