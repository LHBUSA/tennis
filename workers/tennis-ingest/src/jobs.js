import { sourceAbsent } from './lanes.js';
// Ingest jobs. Each job is bounded (a small number of upstream requests), idempotent, and records its
// runs + captures. The scheduler composes them into one polite tick.

import { runAdapter } from '../../shared/adapter.js';
import { archiveCapture } from '../../shared/archive.js';
import { NORMALIZATION_VERSION } from '../../shared/canonical/normalize.js';
import { inList } from '../../shared/store/postgrest.js';
import * as wta from '../../providers/wta.js';
import * as slams from '../../providers/slams.js';
import * as open from '../../providers/open.js';
import * as rg from '../../providers/rolandgarros.js';
import { editionId, tournamentId, tournamentKey } from '../../shared/canonical/ids.js';
import { aoPointEvents, eventId, CONTRACT } from '../../shared/canonical/events.js';
import { normalizeName, resolveIdentity } from '../../shared/canonical/identity.js';
import { hold } from './writer.js';
import { writeFacts } from './context-jobs.js';
import { recordCapture, recordRun, writeRankingPage, finalizeSnapshot, writeEditions, writeMatches, writeMatchStats, writeCrosswalk, upsertPlayersFull } from './writer.js';

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const TOUR_LEVELS = /^(grand slam|wta 1000|wta 500|wta 250|wta 125|wta finals|wta elite trophy)$/i;

/** Run one adapter through the client, archive + record lineage. */
export async function fetchRun(ctx, adapter, params) {
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
  if (editions.length) {
    await writeEditions(ctx.store, editions, 'wta');
    await writeFacts(ctx.store, editions, null); // sourced attribute rows + mappings for the editions just written
  }
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
  // a finished edition cannot have a live match: the source left it 'in progress' and never finished it.
  // Held as a source inconsistency (never written as live, never guessed complete).
  const past = ed.end_date && ed.end_date < new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
  const stale = past ? r.records.filter((m) => m.status === 'in_progress') : [];
  if (stale.length) await hold(ctx.store, stale.map((m) => ({ provider: 'wta', entity_type: 'match', external_id: m.provider_match_id, problems: ['stale_in_progress: finished edition, source never completed the match'], payload: null, capture_id: r.capture?.capture_id || null })));
  // dedupe: an official WTA API row takes over a player-history or ESPN row of the same match (never a second row)
  const w = await writeMatches(ctx.store, r.records.filter((m) => !stale.includes(m)), ed, { captureId: r.capture?.capture_id || null, dedupe: true, scheduleDay: ctx.env?.SCHEDULE_DAY_COLUMNS === '1' });
  return { state: 'PASS', ...w, stale_held: stale.length, live: r.records.filter((m) => m.status === 'in_progress' && !stale.includes(m)).length };
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
    await ctx.kv.put('rank:changed_at', new Date().toISOString()); // DNA v2 rank-list cache: rank rows written
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
  const w = await writeMatches(ctx.store, r.records, { edition_id: eid, surface: 'grass', indoor: false }, { captureId: r.capture?.capture_id || null, dedupe: true });
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
  const w = await writeMatches(ctx.store, r.records, { edition_id: eid, surface: 'hard', indoor: false }, { captureId: r.capture?.capture_id || null, dedupe: true });
  await ctx.store.req('PATCH', `tennis_matches?edition_id=eq.${eid}&source_family=eq.ausopen&stats_status=eq.pending`, { body: { stats_status: 'unavailable' } });
  return { state: 'PASS', ...w };
}

// ---- AO point-by-point -> point_event rows ---------------------------------------------------------------
// bump when the point parser changes so earlier point-feed holds are re-read once
const AO_PBP_REV = 2;
export async function ausopenPointStep(ctx, batch = 3) {
  const st = (await ctx.kv.get('bf:aopbp', 'json')) || { offset: 0 };
  let ext = await ctx.store.select('tennis_match_external_ids', `select=match_id,external_id&provider=eq.ausopen&order=external_id.asc&limit=${batch}&offset=${st.offset}`);
  let retry = false;
  if (!ext.length) {
    // queue finished: re-read each open point-feed hold once per parser revision (a parser fix must reach
    // matches it held earlier); a pass resolves the hold, a repeat failure stays held
    const tried = new Set(st.retried || []);
    const open = (await ctx.store.select('tennis_ingest_holds', 'select=external_id&provider=eq.ausopen&entity_type=eq.point_feed&resolved_at=is.null&limit=200')).map((h) => h.external_id).filter((id) => !tried.has(`${AO_PBP_REV}:${id}`)).slice(0, batch);
    if (!open.length) return { done: true, holds_retried: tried.size };
    ext = await ctx.store.select('tennis_match_external_ids', `select=match_id,external_id&provider=eq.ausopen&external_id=in.(${open.map((id) => `"${id}"`).join(',')})`);
    st.retried = [...tried, ...open.map((id) => `${AO_PBP_REV}:${id}`)];
    retry = true;
  }
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
      await ctx.store.req('PATCH', `tennis_ingest_holds?provider=eq.ausopen&entity_type=eq.point_feed&resolved_at=is.null&external_id=eq.${encodeURIComponent(x.external_id)}`, { body: { resolved_at: new Date().toISOString() } });
      out.push({ match: code, state: 'PASS', points: rows.length, stats: statsState });
    } catch (e) {
      await hold(ctx.store, [{ provider: 'ausopen', entity_type: 'point_feed', external_id: x.external_id, problems: [String(e.message).slice(0, 300)], payload: null, capture_id: r.capture?.capture_id || null }]);
      out.push({ match: code, state: 'HELD', error: String(e.message).slice(0, 120), stats: statsState });
    }
  }
  if (retry) { await ctx.kv.put('bf:aopbp', JSON.stringify(st)); return { retried_holds: out }; }
  await ctx.kv.put('bf:aopbp', JSON.stringify({ ...st, offset: st.offset + ext.length }));
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
  const query = `SELECT ?h ?hLabel ?atp ?wta ?itf ?dc ?bjk ?dob ?img WHERE { ?h wdt:${prop} ?x . OPTIONAL { ?h wdt:P536 ?atp } OPTIONAL { ?h wdt:P597 ?wta } OPTIONAL { ?h wdt:P599 ?itf } OPTIONAL { ?h wdt:P2641 ?dc } OPTIONAL { ?h wdt:P2642 ?bjk } OPTIONAL { ?h wdt:P569 ?dob } OPTIONAL { ?h wdt:P18 ?img } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } ORDER BY ?h LIMIT ${limit} OFFSET ${offset}`;
  const adapter = { ...open.wikidataCrosswalk, request: () => ({ url: `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, headers: { accept: 'application/sparql-results+json' } }) };
  const r = await fetchRun(ctx, adapter, {});
  if (r.state !== 'PASS') return { state: r.state, rows: 0 };
  const attached = await writeCrosswalk(ctx.store, r.records);
  return { state: 'PASS', rows: r.records.length, attached };
}

export { iso, addDays };

// ---- Wimbledon draws archive backfill (men: MS, then MD, then QS; 2025 -> 1979) ---------------------------
// Identity: archive UUID -> ATP id only through exact mappings, cached in KV 'wima:ids' ({uuid: 'S0AG' | 0}):
//   1. Wikidata P4503 (Wimbledon player id) with P536 (ATP id) — CC0, loaded once;
//   2. the SAME match in Wimbledon's 2025 current-edition feed (same publisher, same round, identical
//      surnames on the same side) whose players carry ATP ids;
//   3. the archive player record's own `tourid`.
// A UUID with none of these stays unmapped (0): its matches are held as unresolved identities, never guessed.
const WIMA_EVENTS = ['MS', 'MD', 'QS'];
const WIMA_FLOOR = 1979;
const foldName = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

async function wimaIds(ctx) {
  return (await ctx.kv.get('wima:ids', 'json')) || {};
}

async function wimaSeed(ctx, ids) {
  if (!(await ctx.kv.get('wima:p4503'))) {
    const query = 'SELECT ?w ?atp WHERE { ?h wdt:P4503 ?w . ?h wdt:P536 ?atp }';
    const adapter = { ...open.wikidataCrosswalk, key: 'wikidata.p4503', request: () => ({ url: `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, headers: { accept: 'application/sparql-results+json' } }), parse: (body) => (JSON.parse(body).results?.bindings || []).map((b) => ({ uuid: b.w.value, atp: String(b.atp.value).toUpperCase() })) };
    const r = await fetchRun(ctx, adapter, {});
    if (r.state === 'PASS') { for (const x of r.records) if (/^[0-9a-f-]{36}$/.test(x.uuid) && /^[A-Z0-9]{4}$/.test(x.atp)) ids[x.uuid] = x.atp; await ctx.kv.put('wima:p4503', iso(new Date()), { expirationTtl: 30 * 86400 }); }
  }
  if (!(await ctx.kv.get('wima:join2025'))) {
    for (const ev of WIMA_EVENTS) {
      const cur = await fetchRun(ctx, slams.wimbledonDraw, { year: 2025, eventCode: ev });
      const arch = await fetchRun(ctx, slams.wimbledonArchiveRaw, { event: ev, year: 2025 });
      if (cur.state !== 'PASS' || arch.state !== 'PASS') continue;
      const key = (round, names) => `${round}|${names.map(foldName).sort().join('+')}`;
      const byKey = new Map();
      for (const m of cur.records) byKey.set(key(String(m.round_code).replace(/^.*-/, ''), [...m.sides.A, ...m.sides.B].map((p) => p.last_name)), m);
      for (const a of arch.records) {
        const members = (t) => ['A', 'B'].map((k) => ({ id: t[`player${k}_id`], last: t[`player${k}_last_name`] })).filter((x) => x.id);
        const s1 = members(a.team1);
        const s2 = members(a.team2);
        const m = byKey.get(key(String(a.round), [...s1, ...s2].map((x) => x.last)));
        if (!m) continue;
        // both archive teams must match the feed's two sides (either orientation) by identical surnames
        const same = (arr, feed) => arr.length === feed.length && arr.every((x, i) => foldName(x.last) === foldName(feed[i].last_name));
        const orient = same(s1, m.sides.A) && same(s2, m.sides.B) ? [[s1, m.sides.A], [s2, m.sides.B]] : same(s1, m.sides.B) && same(s2, m.sides.A) ? [[s1, m.sides.B], [s2, m.sides.A]] : null;
        if (!orient) continue;
        for (const [arr, feed] of orient) arr.forEach((x, i) => { const t = feed[i].tour_id; if (t?.provider === 'atp' && !ids[x.id]) ids[x.id] = t.provider_id; });
      }
    }
    await ctx.kv.put('wima:join2025', iso(new Date()), { expirationTtl: 30 * 86400 });
  }
  await ctx.kv.put('wima:ids', JSON.stringify(ids));
}

export async function wimbledonArchiveStep(ctx, { lookups = 15 } = {}) {
  const st = (await ctx.kv.get('bf:wima', 'json')) || { e: 0, year: 2025 };
  if (st.e >= WIMA_EVENTS.length) return { done: true };
  const event = WIMA_EVENTS[st.e];
  const ids = await wimaIds(ctx);
  await wimaSeed(ctx, ids);
  const raw = await fetchRun(ctx, slams.wimbledonArchiveRaw, { event, year: st.year });
  if (raw.state !== 'PASS') {
    if (!sourceAbsent(raw)) throw new Error(`wimbledon archive ${event} ${st.year}: ${raw.state} ${raw.error || ''}`.trim());
    // an event/year the archive does not hold: move on (recorded in the run ledger)
    const next = st.year - 1 < WIMA_FLOOR ? { e: st.e + 1, year: 2025 } : { e: st.e, year: st.year - 1 };
    await ctx.kv.put('bf:wima', JSON.stringify(next));
    return { event, year: st.year, state: raw.state, error: raw.error };
  }
  const uuids = [...new Set(raw.records.flatMap((m) => [m.team1, m.team2].flatMap((t) => [t?.playerA_id, t?.playerB_id])).filter(Boolean))];
  const unknown = uuids.filter((u) => !(u in ids));
  let looked = 0;
  for (const u of unknown.slice(0, lookups)) {
    const r = await fetchRun(ctx, slams.wimbledonArchivePlayer, { uuid: u });
    ids[u] = r.state === 'PASS' && r.records[0]?.atp ? r.records[0].atp : 0;
    looked += 1;
  }
  await ctx.kv.put('wima:ids', JSON.stringify(ids));
  if (unknown.length > looked) return { event, year: st.year, identity: { players: uuids.length, mapped: uuids.filter((u) => ids[u]).length, looked_up: looked, remaining: unknown.length - looked } };
  const idMap = Object.fromEntries(uuids.filter((u) => ids[u]).map((u) => [u, ids[u]]));
  const records = slams.parseWimbledonArchive(raw.records, { event, year: st.year, idMap });
  const tid = await tournamentId('slam:wimbledon');
  const eid = await editionId(tid, st.year);
  await ctx.store.upsert('tennis_tournaments', [{ tournament_id: tid, slug: 'wimbledon', name: 'Wimbledon', competition_key: 'grand_slam', country: 'GBR', city: 'London' }], { onConflict: 'tournament_id', ignore: true });
  await ctx.store.upsert('tennis_tournament_editions', [{ edition_id: eid, tournament_id: tid, year: st.year, competition_key: 'grand_slam', surface: 'grass', indoor: false, source_family: 'wimbledon', name: `Wimbledon ${st.year}`, level: 'Grand Slam', city: 'London', country: 'GBR' }], { onConflict: 'edition_id', ignore: true });
  const w = await writeMatches(ctx.store, records, { edition_id: eid, surface: 'grass', indoor: false }, { captureId: raw.capture?.capture_id || null, dedupe: true });
  await ctx.store.req('PATCH', `tennis_matches?edition_id=eq.${eid}&source_family=eq.wimbledon&stats_status=eq.pending`, { body: { stats_status: 'unavailable' } });
  const next = st.year - 1 < WIMA_FLOOR ? { e: st.e + 1, year: 2025 } : { e: st.e, year: st.year - 1 };
  await ctx.kv.put('bf:wima', JSON.stringify(next));
  return { event, year: st.year, players: uuids.length, mapped: Object.keys(idMap).length, ...w };
}

// ---- Roland-Garros results backfill (men: SM, DM, QM; 2026 -> 2018) ---------------------------------------
// FFT player ids carry no ATP id. Identity uses identity.js resolveIdentity(): exact stored external id first,
// then EXACT normalized name + date of birth (+ nationality) against canonical ATP-id players — unique or held.
// Player DOBs come from the player card (a few per tick, cached in KV 'rg:dob': {fftId: 'YYYY-MM-DD' | 0}).
const RG_EVENTS = ['SM', 'DM', 'QM'];
const RG_FLOOR = 2018;

async function rgIdentityIndex(ctx) {
  const players = [];
  for (let off = 0; ; off += 1000) {
    const rows = await ctx.store.select('tennis_players', `select=pbe_player_id,full_name,dob,nationality&gender=eq.M&dob=not.is.null&status=eq.active&limit=1000&offset=${off}`);
    players.push(...rows);
    if (rows.length < 1000) break;
  }
  const atp = new Map();
  const byExternal = new Map();
  for (let i = 0; i < players.length; i += 150) {
    for (const x of await ctx.store.select('tennis_player_external_ids', `select=provider,external_id,pbe_player_id&provider=in.(atp,rolandgarros)&pbe_player_id=${inList(players.slice(i, i + 150).map((p) => p.pbe_player_id))}`)) {
      if (x.provider === 'atp') atp.set(x.pbe_player_id, x.external_id);
      else byExternal.set(`rolandgarros:${x.external_id}`, x.pbe_player_id);
    }
  }
  return { index: { byExternal, players: players.filter((p) => atp.has(p.pbe_player_id)) }, atp };
}

export async function rolandGarrosStep(ctx, { lookups = 60 } = {}) {
  const st = (await ctx.kv.get('bf:rg', 'json')) || { e: 0, year: 2026 };
  if (st.e >= RG_EVENTS.length) return { done: true };
  const event = RG_EVENTS[st.e];
  const nextState = () => (st.year - 1 < RG_FLOOR ? { e: st.e + 1, year: 2026 } : { e: st.e, year: st.year - 1 });
  const res = await fetchRun(ctx, rg.rgResults, { event, year: st.year });
  if (res.state !== 'PASS' || !res.records[0]) {
    if (!sourceAbsent(res)) throw new Error(`roland-garros ${event} ${st.year}: ${res.state} ${res.error || ''}`.trim());
    await ctx.kv.put('bf:rg', JSON.stringify(nextState()));
    return { event, year: st.year, state: res.state, error: res.error || 'no_payload' };
  }
  const json = res.records[0];
  const people = rg.rgPlayers(json);
  const dobs = (await ctx.kv.get('rg:dob', 'json')) || {};
  const unknown = people.filter((p) => !(p.id in dobs) && p.path);
  let looked = 0;
  for (const p of unknown.slice(0, lookups)) {
    const r = await fetchRun(ctx, rg.rgPlayer, { path: p.path });
    dobs[p.id] = r.state === 'PASS' && r.records[0]?.dob ? r.records[0].dob : 0;
    looked += 1;
  }
  await ctx.kv.put('rg:dob', JSON.stringify(dobs));
  if (unknown.length > looked) return { event, year: st.year, identity: { players: people.length, dob_known: people.filter((p) => dobs[p.id]).length, looked_up: looked, remaining: unknown.length - looked } };
  const { index, atp } = await rgIdentityIndex(ctx);
  const idMap = {};
  const outcomes = { resolved: 0, ambiguous: 0, unresolved: 0 };
  for (const p of people) {
    const r = resolveIdentity({ provider: 'rolandgarros', provider_id: p.id, full_name: p.name, dob: dobs[p.id] || null, nationality: p.country }, index);
    if (r.status === 'resolved' && atp.get(r.pbe_player_id)) { idMap[p.id] = atp.get(r.pbe_player_id); outcomes.resolved += 1; } else outcomes[r.status === 'ambiguous' ? 'ambiguous' : 'unresolved'] += 1;
  }
  const records = rg.parseRgResults(json, { year: st.year, event, idMap });
  const tid = await tournamentId('slam:roland-garros');
  const eid = await editionId(tid, st.year);
  await ctx.store.upsert('tennis_tournaments', [{ tournament_id: tid, slug: 'roland-garros', name: 'Roland-Garros', competition_key: 'grand_slam', country: 'FRA', city: 'Paris' }], { onConflict: 'tournament_id', ignore: true });
  await ctx.store.upsert('tennis_tournament_editions', [{ edition_id: eid, tournament_id: tid, year: st.year, competition_key: 'grand_slam', surface: 'clay', indoor: false, source_family: 'rolandgarros', name: `Roland-Garros ${st.year}`, level: 'Grand Slam', city: 'Paris', country: 'FRA' }], { onConflict: 'edition_id', ignore: true });
  const w = await writeMatches(ctx.store, records, { edition_id: eid, surface: 'clay', indoor: false }, { captureId: res.capture?.capture_id || null, dedupe: true });
  await ctx.store.req('PATCH', `tennis_matches?edition_id=eq.${eid}&source_family=eq.rolandgarros&stats_status=eq.pending`, { body: { stats_status: 'unavailable' } });
  await ctx.kv.put('bf:rg', JSON.stringify(nextState()));
  return { event, year: st.year, players: people.length, identity: outcomes, ...w };
}

// ---- AO gap fill: every expected main-draw slot must exist; missing ones are read from the match centre -----
export async function ausopenGapStep(ctx, year, batch = 8) {
  const state = (await ctx.kv.get(`bf:aogap:${year}`, 'json')) || { checked: [] };
  if (state.done) return { done: true };
  const have = new Set((await ctx.store.select('tennis_match_external_ids', `select=external_id&provider=eq.ausopen&external_id=like.${year}-M*&limit=2000`)).map((r) => r.external_id.split('-').pop()));
  const checked = new Set(state.checked);
  const missing = ['MS', 'MD'].flatMap(slams.ausopenSlotIds).filter((id) => !have.has(id) && !checked.has(id));
  const out = [];
  const tid = await tournamentId('slam:australian-open');
  const eid = await editionId(tid, year);
  for (const id of missing.slice(0, batch)) {
    const r = await fetchRun(ctx, slams.ausopenMatchCentre, { matchId: id });
    const rec = r.state === 'PASS' && r.records[0] ? slams.parseAusopenWalkover(r.records[0], year) : null;
    if (rec) { const w = await writeMatches(ctx.store, [rec], { edition_id: eid, surface: 'hard', indoor: false }, { captureId: r.capture?.capture_id || null, dedupe: true }); out.push({ id, state: 'walkover_written', ...w }); }
    else out.push({ id, state: r.state === 'PASS' ? 'not_a_walkover' : r.state });
    checked.add(id);
  }
  const done = missing.length <= batch;
  await ctx.kv.put(`bf:aogap:${year}`, JSON.stringify({ checked: [...checked], done }));
  return { missing: missing.length, results: out, done };
}
