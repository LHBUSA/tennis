// Ingest jobs. Each job is bounded (a small number of upstream requests), idempotent, and records its
// runs + captures. The scheduler composes them into one polite tick.

import { runAdapter } from '../../shared/adapter.js';
import { archiveCapture } from '../../shared/archive.js';
import { NORMALIZATION_VERSION } from '../../shared/canonical/normalize.js';
import { inList } from '../../shared/store/postgrest.js';
import * as wta from '../../providers/wta.js';
import * as slams from '../../providers/slams.js';
import * as open from '../../providers/open.js';
import { editionId, tournamentId, tournamentKey } from '../../shared/canonical/ids.js';
import { aoPointEvents, eventId, CONTRACT } from '../../shared/canonical/events.js';
import { normalizeName } from '../../shared/canonical/identity.js';
import { hold } from './writer.js';
import { recordCapture, recordRun, writeRankingPage, finalizeSnapshot, writeEditions, writeMatches, writeMatchStats, writeCrosswalk, upsertPlayersFull } from './writer.js';

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const TOUR_LEVELS = /^(grand slam|wta 1000|wta 500|wta 250|wta 125|wta finals|wta elite trophy)$/i;

/** Run one adapter through the client, archive + record lineage. */
async function fetchRun(ctx, adapter, params) {
  const started = new Date().toISOString();
  let capture = null;
  const r = await runAdapter(adapter, {
    client: ctx.client,
    params,
    archive: async ({ result }) => {
      capture = await archiveCapture({ bucket: ctx.env.TENNIS_SOURCE || null, family: adapter.family, adapter: adapter.key, parserVersion: adapter.parser_version, normalizationVersion: NORMALIZATION_VERSION, result });
      if (ctx.env.TENNIS_SOURCE) await recordCapture(ctx.store, capture);
      return capture;
    }
  });
  r.started_at = started;
  r.capture = capture && ctx.env.TENNIS_SOURCE ? capture : null;
  ctx.upstream += 1;
  await recordRun(ctx.store, r).catch(() => {});
  ctx.log.push({ key: adapter.key, state: r.state, records: r.record_count ?? null, error: r.error ?? null });
  return r;
}

// ---- calendar ------------------------------------------------------------------------------------------
/** Returns { ok, editions }. ok=false when any page failed — callers must not advance cursors then. */
export async function calendarWindow(ctx, from, to) {
  const editions = [];
  let ok = false;
  for (let page = 0; page < 10; page += 1) {
    const adapter = { ...wta.calendar, request: () => ({ url: `https://api.wtatennis.com/tennis/tournaments/?page=${page}&pageSize=100&from=${from}&to=${to}` }) };
    const r = await fetchRun(ctx, adapter, {});
    if (r.state !== 'PASS' && !(r.state === 'DEGRADED' && r.error === 'zero_records' && page === 0)) { ok = false; break; }
    ok = true;
    editions.push(...(r.records || []));
    if ((r.records || []).length < 100) break;
  }
  if (editions.length) await writeEditions(ctx.store, editions, 'wta');
  return { ok, editions };
}

export async function editionContext(e) {
  const tid = await tournamentId(tournamentKey('wta', e.provider_tournament_id, e.name, e.level));
  return { edition_id: await editionId(tid, e.year), event_id: e.live_scoring_id, year: e.year, level: e.level, surface: e.surface, indoor: e.indoor, name: e.name, start_date: e.start_date, end_date: e.end_date, status: e.status };
}

// ---- matches -------------------------------------------------------------------------------------------
export async function editionMatches(ctx, ed) {
  const r = await fetchRun(ctx, wta.matches, { eventId: ed.event_id, year: ed.year, level: ed.level });
  if (r.state !== 'PASS') return { state: r.state, error: r.error };
  const w = await writeMatches(ctx.store, r.records, ed, { captureId: r.capture?.capture_id || null });
  return { state: 'PASS', ...w, live: r.records.filter((m) => m.status === 'in_progress').length };
}

// ---- stats ---------------------------------------------------------------------------------------------
export async function pendingStats(ctx, limit) {
  const rows = await ctx.store.select('tennis_matches', `select=match_id,updated_at&source_family=eq.wta&stats_status=eq.pending&status=in.(completed,retired)&order=updated_at.desc&limit=${limit}`);
  if (!rows.length) return 0;
  const ext = await ctx.store.select('tennis_match_external_ids', `select=match_id,external_id&provider=eq.wta&match_id=${inList(rows.map((r) => r.match_id))}`);
  let n = 0;
  for (const x of ext) {
    const [eventId, year, mid] = x.external_id.split('-');
    const r = await fetchRun(ctx, wta.matchStats, { eventId, year, matchId: mid });
    const empty = r.state === 'DEGRADED' && (r.error === 'shape_drift' || r.error === 'zero_records') || r.http_status === 404;
    if (r.state === 'PASS') await writeMatchStats(ctx.store, x.match_id, r.records[0], { captureId: r.capture?.capture_id || null });
    else if (empty) await writeMatchStats(ctx.store, x.match_id, null);
    n += 1;
  }
  return n;
}

// ---- rankings ------------------------------------------------------------------------------------------
/** Ingest up to `pages` pages of one list/date. Returns { done, page }. State lives in KV. */
export async function rankingStep(ctx, kind, date, pages) {
  const k = `rank:${kind}:${date}`;
  const st = (await ctx.kv.get(k, 'json')) || { page: 0, done: false, snapshot_id: null };
  if (st.done) return st;
  const adapter = kind === 'doubles' ? wta.rankingsDoubles : wta.rankingsSingles;
  for (let i = 0; i < pages; i += 1) {
    const r = await fetchRun(ctx, adapter, { at: date, page: st.page, pageSize: 100 });
    if (r.state === 'DEGRADED' && r.error === 'shape_drift' && st.page > 0) { st.done = true; break; } // empty tail page
    if (r.state !== 'PASS') break;
    // the API answers any date with the list in force on it; keep the list's own date
    const w = await writeRankingPage(ctx.store, r.records, { captureId: r.capture?.capture_id || null });
    st.snapshot_id = w.snapshot_id;
    st.list_date = r.records[0].ranking_date;
    st.page += 1;
    if (r.records.length < 100) { st.done = true; break; }
  }
  if (st.done && st.snapshot_id) st.rows = await finalizeSnapshot(ctx.store, st.snapshot_id);
  await ctx.kv.put(k, JSON.stringify(st), { expirationTtl: 400 * 86400 });
  return st;
}

// ---- Wimbledon (men's singles; women come from the WTA API to avoid duplicate matches) ------------------
export async function wimbledonMen(ctx, year) {
  const r = await fetchRun(ctx, slams.wimbledonDraw, { year, eventCode: 'MS' });
  if (r.state !== 'PASS') return { state: r.state, error: r.error };
  const tid = await tournamentId('slam:wimbledon');
  const eid = await editionId(tid, year);
  await ctx.store.upsert('tennis_tournaments', [{ tournament_id: tid, slug: 'wimbledon', name: 'Wimbledon', competition_key: 'grand_slam', country: 'GBR', city: 'London' }], { onConflict: 'tournament_id', ignore: true });
  await ctx.store.upsert('tennis_tournament_editions', [{ edition_id: eid, tournament_id: tid, year, competition_key: 'grand_slam', surface: 'grass', indoor: false, source_family: 'wimbledon', name: `Wimbledon ${year}`, level: 'Grand Slam', city: 'London', country: 'GBR' }], { onConflict: 'edition_id', ignore: true });
  const w = await writeMatches(ctx.store, r.records, { edition_id: eid, surface: 'grass', indoor: false }, { captureId: r.capture?.capture_id || null });
  // men's Slam rows carry no stats from this feed
  await ctx.store.req('PATCH', `tennis_matches?edition_id=eq.${eid}&source_family=eq.wimbledon&stats_status=eq.pending`, { body: { stats_status: 'unavailable' } });
  return { state: 'PASS', ...w };
}

// ---- Australian Open match days (men's + mixed; women's come from the WTA API) -------------------------
export async function ausopenDayMatches(ctx, year, day, period = 'MD') {
  const r = await fetchRun(ctx, slams.ausopenMatches, { year, day, period });
  if (r.state === 'DEGRADED' && r.error === 'zero_records') return { state: 'PASS', written: 0, note: 'no men/mixed matches that day' };
  if (r.state !== 'PASS') return { state: r.state, error: r.error };
  const tid = await tournamentId('slam:australian-open');
  const eid = await editionId(tid, year);
  await ctx.store.upsert('tennis_tournaments', [{ tournament_id: tid, slug: 'australian-open', name: 'Australian Open', competition_key: 'grand_slam', country: 'AUS', city: 'Melbourne' }], { onConflict: 'tournament_id', ignore: true });
  await ctx.store.upsert('tennis_tournament_editions', [{ edition_id: eid, tournament_id: tid, year, competition_key: 'grand_slam', surface: 'hard', indoor: false, source_family: 'ausopen', name: `Australian Open ${year}`, level: 'Grand Slam', city: 'Melbourne', country: 'AUS' }], { onConflict: 'edition_id', ignore: true });
  const w = await writeMatches(ctx.store, r.records, { edition_id: eid, surface: 'hard', indoor: false }, { captureId: r.capture?.capture_id || null });
  await ctx.store.req('PATCH', `tennis_matches?edition_id=eq.${eid}&source_family=eq.ausopen&stats_status=eq.pending`, { body: { stats_status: 'unavailable' } });
  return { state: 'PASS', ...w };
}

// ---- AO point-by-point -> point_event rows ---------------------------------------------------------------
export async function ausopenPointStep(ctx, batch = 3) {
  const st = (await ctx.kv.get('bf:aopbp', 'json')) || { offset: 0 };
  const ext = await ctx.store.select('tennis_match_external_ids', `select=match_id,external_id&provider=eq.ausopen&order=external_id.asc&limit=${batch}&offset=${st.offset}`);
  if (!ext.length) return { done: true };
  const out = [];
  for (const x of ext) {
    const code = x.external_id.split('-').pop();
    const r = await fetchRun(ctx, slams.ausopenMatchCentre, { matchId: code });
    if (r.state !== 'PASS') { out.push({ match: code, state: r.state, error: r.error }); continue; }
    const mc = r.records[0];
    if (!mc) { out.push({ match: code, state: 'EMPTY' }); continue; }
    const [m] = await ctx.store.select('tennis_matches', `select=match_id,format_key,status,tennis_sets(set_no,games_a,games_b,winner_side),tennis_match_participants(side,tennis_participants(tennis_participant_members(tennis_players(last_name,full_name))))&match_id=eq.${x.match_id}`);
    const lastNames = {};
    for (const p of m.tennis_match_participants) lastNames[p.side] = p.tennis_participants.tennis_participant_members.map((mm) => normalizeName(mm.tennis_players.last_name || mm.tennis_players.full_name.split(' ').slice(-1)[0]));
    const nameSide = (raw) => {
      const n = normalizeName(String(raw).replace(/^[A-Z]\.\s*/, ''));
      const hits = ['A', 'B'].filter((sd) => (lastNames[sd] || []).some((ln) => ln && (n === ln || n.endsWith(` ${ln}`) || ln.endsWith(` ${n}`))));
      return hits.length === 1 ? hits[0] : null;
    };
    const finalSets = (m.tennis_sets || []).sort((a, b) => a.set_no - b.set_no).map((t) => ({ A: t.games_a, B: t.games_b, winner: t.winner_side }));
    // match statistics from the same payload — only when teams[0]/teams[1] provably ARE our sides A/B by name
    let statsState = 'no_stats';
    try {
      const teamSide = (t) => { const hits = new Set((t?.players || []).map((pl) => nameSide(pl.last_name || pl.full_name || ''))); return hits.size === 1 ? [...hits][0] : null; };
      const rec = m.status === 'completed' || m.status === 'retired' ? slams.parseAusopenStats(mc) : null;
      if (rec && teamSide(mc.teams?.[0]) === 'A' && teamSide(mc.teams?.[1]) === 'B') statsState = await writeMatchStats(ctx.store, x.match_id, { ...rec, provider_match_id: x.external_id }, { captureId: r.capture?.capture_id || null });
      else if (rec) statsState = 'side_mapping_unproven';
    } catch (e) {
      statsState = 'held';
      await hold(ctx.store, [{ provider: 'ausopen', entity_type: 'match_stats', external_id: x.external_id, problems: [String(e.message).slice(0, 300)], payload: null, capture_id: r.capture?.capture_id || null }]);
    }
    try {
      if (!mc.commentary?.length) { out.push({ match: code, state: 'PASS', points: 0, stats: statsState }); continue; }
      const evs = aoPointEvents(mc.commentary, { formatKey: m.format_key, sideOfTeam: (t) => (t === 1 ? 'A' : t === 2 ? 'B' : null), nameSide, finalSets: m.status === 'completed' ? finalSets : null });
      const rows = [];
      for (let i = 0; i < evs.length; i += 1) {
        const e = evs[i];
        rows.push({ event_id: await eventId(x.match_id, 'point_event', e.source_event_id), match_id: x.match_id, contract: CONTRACT, quality: 'point_event', event_sequence: i, event_type: e.event_type, source: 'ausopen', source_event_id: e.source_event_id, observed_at: new Date().toISOString(), event_at: e.event_at, set_number: e.set_number, game_number: e.game_number, server_side: e.server_side, winner_side: e.winner_side, derivation: null, event_detail: e.event_detail, state: e.state, raw_source_ref: r.capture?.capture_id || null });
      }
      await ctx.store.upsert('tennis_match_events', rows, { onConflict: 'event_id', ignore: true, chunk: 200 });
      out.push({ match: code, state: 'PASS', points: rows.length, stats: statsState });
    } catch (e) {
      await hold(ctx.store, [{ provider: 'ausopen', entity_type: 'point_feed', external_id: x.external_id, problems: [String(e.message).slice(0, 300)], payload: null, capture_id: r.capture?.capture_id || null }]);
      out.push({ match: code, state: 'HELD', error: String(e.message).slice(0, 120), stats: statsState });
    }
  }
  await ctx.kv.put('bf:aopbp', JSON.stringify({ offset: st.offset + ext.length }));
  return { offset: st.offset + ext.length, results: out };
}

// ---- Australian Open player registry (identity evidence: tour ids, DOB, gender) ------------------------
export async function ausopenPlayers(ctx, year) {
  const r = await fetchRun(ctx, slams.ausopenDay, { year, day: 1 });
  if (r.state !== 'PASS') return { state: r.state };
  const withTour = r.records.filter((p) => p.tour_id);
  let n = 0;
  for (const provider of ['atp', 'wta']) {
    const members = withTour.filter((p) => p.tour_id.provider === provider).map((p) => ({ provider_id: p.tour_id.provider_id, first_name: p.first_name, last_name: p.last_name, full_name: p.full_name, gender: p.gender, dob: p.dob, country: p.nationality }));
    n += await upsertPlayersFull(ctx.store, members, provider);
  }
  return { state: 'PASS', players: n };
}

// ---- Wikidata crosswalk --------------------------------------------------------------------------------
export async function wikidataPage(ctx, prop, offset, limit = 1500) {
  const query = `SELECT ?h ?hLabel ?atp ?wta ?itf ?dc ?bjk ?img WHERE { ?h wdt:${prop} ?x . OPTIONAL { ?h wdt:P536 ?atp } OPTIONAL { ?h wdt:P597 ?wta } OPTIONAL { ?h wdt:P599 ?itf } OPTIONAL { ?h wdt:P2641 ?dc } OPTIONAL { ?h wdt:P2642 ?bjk } OPTIONAL { ?h wdt:P18 ?img } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY ?h LIMIT ${limit} OFFSET ${offset}`;
  const adapter = { ...open.wikidataCrosswalk, request: () => ({ url: `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, headers: { accept: 'application/sparql-results+json' } }) };
  const r = await fetchRun(ctx, adapter, {});
  if (r.state !== 'PASS') return { state: r.state, rows: 0 };
  const attached = await writeCrosswalk(ctx.store, r.records);
  return { state: 'PASS', rows: r.records.length, attached };
}

export { iso, addDays };
