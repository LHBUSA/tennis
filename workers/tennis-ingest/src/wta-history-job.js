// WTA player-history lane (wta_history): official career match lists, one player at a time. docs/TENNIS_SOURCE_MATRIX.md.
// Queue: current official WTA top list first, then every canonical WTA player (rebuilt monthly). Each page is
// written edition by edition through the cross-source writer: an existing official WTA API / Slam row stays
// canonical (the history row attaches), an ESPN row is taken over — also when ESPN filed it under its own
// edition (proven per player: same event, stage and opponent, edition dates overlapping within 3 days).

import * as hist from '../../providers/wta-history.js';
import { fetchRun } from './jobs.js';
import { writeMatches, upsertPlayersFull } from './writer.js';
import { inList } from '../../shared/store/postgrest.js';
import { tournamentId, tournamentKey, editionId, slugify, competitionFor, SLAMS } from '../../shared/canonical/ids.js';
import { mintPlayerId } from '../../shared/canonical/identity.js';

const Q = 'wh:queue';
const S = 'wh:state';
const PAGE = 100;

async function buildQueue(ctx) {
  const [snap] = await ctx.store.select('tennis_ranking_snapshots', 'select=snapshot_id&list_key=eq.wta_singles&source_family=eq.wta&row_count=gt.0&order=ranking_date.desc&limit=1');
  const top = snap ? (await ctx.store.select('tennis_rankings', `select=provider_player_id,rank&snapshot_id=eq.${snap.snapshot_id}&order=rank.asc&limit=1000`)).map((r) => r.provider_player_id) : [];
  const all = [];
  for (let off = 0; ; off += 1000) {
    const rows = await ctx.store.select('tennis_players', `select=founding_external_key&founding_external_key=like.wta:*&status=eq.active&order=founding_external_key.asc&limit=1000&offset=${off}`);
    all.push(...rows.map((r) => r.founding_external_key.slice(4)));
    if (rows.length < 1000) break;
  }
  return [...new Set([...top, ...all])];
}

/** The player's existing canonical matches in ANY edition: `${event}|${stage}|${opponentKey}` -> [{ match_id, edition_id, source, start, end }]. */
async function playerIndex(store, pid) {
  const mem = await store.select('tennis_participant_members', `select=participant_key&pbe_player_id=eq.${pid}`);
  if (!mem.length) return new Map();
  const mine = new Set(mem.map((m) => m.participant_key));
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const page = await store.select('tennis_match_participants', `select=match_id,participant_key,tennis_matches!inner(edition_id,event_type,round,source_family,tennis_tournament_editions(start_date,end_date,source_family),tennis_match_participants(participant_key))&participant_key=${inList([...mine])}&order=match_id.asc&limit=1000&offset=${off}`);
    rows.push(...page);
    if (page.length < 1000) break;
  }
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
  const idx = await playerIndex(ctx.store, pid);
  const groups = new Map();
  const out = { rows: rows.length, written: 0, attached: 0, taken_over: 0, held: 0, duplicate_candidates: 0, skipped: {}, cross_edition: 0 };
  for (const p of parsed) {
    if (p.skip || p.hold) { const k = (p.skip || p.hold).split(':')[0]; out.skipped[k] = (out.skipped[k] || 0) + 1; continue; }
    const key = `${p.edition.provider_tournament_id}-${p.edition.year}`;
    if (!groups.has(key)) groups.set(key, { edition: p.edition, matches: [] });
    groups.get(key).matches.push(p.match);
  }
  const known = new Set((await ctx.kv.get('wh:eds', 'json')) || []);
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
    const w = await writeMatches(ctx.store, g.matches, { edition_id: eid, surface: g.edition.surface, indoor: g.edition.indoor }, { captureId: r.capture?.capture_id || null, dedupe: true });
    for (const k of ['written', 'attached', 'taken_over', 'held', 'duplicate_candidates']) out[k] += w[k] || 0;
    await ctx.store.req('PATCH', `tennis_matches?edition_id=eq.${eid}&source_family=eq.wta_history&stats_status=eq.pending`, { body: { stats_status: 'unavailable' } });
  }
  await ctx.kv.put('wh:eds', JSON.stringify([...known]));
  return { state: rows.length < PAGE ? 'END' : 'MORE', ...out };
}

/** Bounded unit: up to `pages` history pages across the queue. */
export async function wtaHistoryStep(ctx, { pages = 2, shard = 0, shards = 1 } = {}) {
  // shard k of n walks queue positions k, k+n, k+2n ... (a match two players share gets one deterministic id)
  const SK = shards > 1 ? `${S}:${shard}/${shards}` : S;
  let st = (await ctx.kv.get(SK, 'json')) || { i: shard, page: 0, built_at: null, players_done: 0 };
  let queue = (await ctx.kv.get(Q, 'json')) || [];
  if (!queue.length || !st.built_at || Date.now() - Date.parse(st.built_at) > 30 * 86400e3) {
    queue = await buildQueue(ctx);
    await ctx.kv.put(Q, JSON.stringify(queue));
    st = { ...st, built_at: new Date().toISOString(), i: st.i >= queue.length ? shard : st.i };
  }
  const out = { runs: [] };
  for (let n = 0; n < pages && st.i < queue.length; n += 1) {
    const id = queue[st.i];
    const r = await historyPage(ctx, id, st.page);
    out.runs.push({ player: id, page: st.page, ...r });
    if (r.state === 'END') { st.i += shards; st.page = 0; st.players_done += 1; } else st.page += 1;
    await ctx.kv.put(SK, JSON.stringify(st));
  }
  return { ...out, queue: queue.length, position: st.i, players_done: st.players_done, done: st.i >= queue.length };
}
