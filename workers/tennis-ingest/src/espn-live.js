// ESPN live state — the ATP side of the live pipeline (ATP league: MS, MD, XD). docs/TENNISCAST.md.
//
// Secondary source, game-level only: an in-progress competition's own status (/competitions/{c}/status) and its two
// competitors' linescores (games per set, tiebreak points) read in one observation. ESPN publishes no point score or
// server for tennis: those stay null, never interpolated. The observation goes through parseEspnEvent (live branch) and
// the SAME canonical writer as every other source, so matches/sets/score_snapshot events/source changes are identical
// in shape to the WTA live path.
//
// Used by:
//   tennis-live (router provider 'espn')  espnLiveObserve every ~20 s while an edition is in live:editions
//   tennis-ingest tick step 'espn_live'   espnLiveScan every 2 min: finds current ATP events with a competition in
//                                         progress and hands them to tennis-live (live:editions {source:'espn'})
// Ownership is unchanged: while tennis-live's heartbeat is fresh, ingest never writes an edition in live:owned.

import * as espn from '../../providers/espn.js';
import { fetchRun } from './jobs.js';
import { writeMatches } from './writer.js';
import { inList } from '../../shared/store/postgrest.js';
import { tournamentId, editionId } from '../../shared/canonical/ids.js';

export const LIVE_WINDOW_H = 10;   // a competition scheduled more than this long ago without a result is not polled
export const MAX_STATUS = 6;       // status reads per event per observation (bounded; previously-live first)
export const KV_EVENTS = 'espn:live:events'; // current ATP events { id: { start_date, end_date, final, edition_id, name } }
const KV_PREV = (eventId) => `espn:live:${eventId}`; // competitions observed in progress last time (their end gets written)
const HEARTBEAT_FRESH_MS = 150 * 1000;
const RESULT = / bt /;

/** Editions tennis-live owns right now (its heartbeat is fresh). Ingest never writes these. */
export async function liveOwnedSet(kv) {
  if (!kv) return new Set();
  const hb = await kv.get('live:heartbeat');
  return hb && Date.now() - Date.parse(hb) < HEARTBEAT_FRESH_MS ? new Set((await kv.get('live:owned', 'json')) || []) : new Set();
}

/** Canonical edition id of an ESPN ATP event (the ids writeEspnEdition mints). */
export async function espnEditionId(parsedEdition) {
  const tid = await tournamentId(parsedEdition.slam ? `slam:${parsedEdition.slam}` : `espn:${parsedEdition.espn_tournament_id}`);
  return editionId(tid, parsedEdition.year);
}

/**
 * Competitions worth a status read: ATP-league event types, no result line yet, and either observed in progress last
 * time or scheduled to have started within LIVE_WINDOW_H. Previously-live first, then earliest scheduled start.
 */
export function liveCandidates(json, { now = Date.now(), previously = [], windowH = LIVE_WINDOW_H, league = 'atp' } = {}) {
  const types = espn.LEAGUES[league].events;
  const out = [];
  for (const c of json?.competitions || []) {
    const et = espn.EVENT_TYPES[c.type?.text];
    if (!et || !types.includes(et)) continue;
    if ((c.notes || []).some((n) => RESULT.test(String(n.text)))) continue;
    const at = Date.parse(c.date);
    const prev = previously.includes(String(c.id));
    if (!prev && !(Number.isFinite(at) && at <= now && now - at <= windowH * 3600e3)) continue;
    const cs = [...(c.competitors || [])].sort((a, b) => (a.order ?? 9) - (b.order ?? 9));
    if (cs.length !== 2) continue;
    out.push({ id: String(c.id), at: Number.isFinite(at) ? at : 0, prev, competitors: cs.map((x) => String(x.id)) });
  }
  return out.sort((a, b) => Number(b.prev) - Number(a.prev) || a.at - b.at);
}

/** ESPN athlete ids -> idMap from the STORED crosswalk only (resolved earlier by the espn_atp lane). Unknown ids stay
 *  unresolved: their match is held by the writer, never guessed. */
export async function storedIdMap(store, espnIds) {
  if (!espnIds.length) return {};
  const x = await store.select('tennis_player_external_ids', `select=external_id,pbe_player_id&provider=eq.espn&external_id=${inList(espnIds)}`);
  const pids = [...new Set(x.map((r) => r.pbe_player_id))];
  const players = pids.length ? await store.select('tennis_players', `select=pbe_player_id,founding_external_key,full_name,first_name,last_name,nationality,gender&pbe_player_id=${inList(pids)}`) : [];
  const byPid = new Map(players.map((p) => [p.pbe_player_id, p]));
  const out = {};
  for (const r of x) {
    const p = byPid.get(r.pbe_player_id);
    const m = /^(atp|wta):(.+)$/.exec(p?.founding_external_key || '');
    if (!m) continue;
    out[String(r.external_id)] = { provider: m[1], provider_id: m[2], evidence: `stored crosswalk espn:${r.external_id} -> ${p.founding_external_key}`, method: 'crosswalk', first_name: p.first_name || null, last_name: p.last_name || null, country: p.nationality || null, gender: p.gender || null, canonical_name: p.full_name || null };
  }
  return out;
}

/**
 * One observation of one ESPN ATP event. Writes (through the canonical writer) the competitions in progress now and the
 * ones that were in progress last time (so a match's end lands too). Returns { state, edition_id, live, ... }.
 * `maxStatus` bounds status reads; `owned` (ingest only) = editions tennis-live owns -> nothing written.
 */
export async function espnLiveObserve(ctx, eventId, { league = 'atp', maxStatus = MAX_STATUS, owned = null, dry = false, now = ctx.now ?? Date.now() } = {}) {
  if (league !== 'atp') return { state: 'UNSUPPORTED', live: 0, error: 'ESPN live runs on the ATP league only (WTA live = official WTA feed)' };
  const res = await fetchRun(ctx, espn.espnEvent, { id: eventId });
  if (res.state !== 'PASS') return { state: res.state, error: res.error || null, live: 0 };
  const json = res.records[0];
  const first = espn.parseEspnEvent(json, { league });
  if (!first.edition || first.edition.exhibition || first.edition.slam_mismatch) return { state: 'SKIPPED', live: 0, reason: first.skipped[0]?.reason || 'bad_event' };
  const edition_id = await espnEditionId(first.edition);
  if (owned?.has(edition_id)) return { state: 'OWNED_BY_LIVE', edition_id, live: 0 };
  const previously = (await ctx.kv.get(KV_PREV(eventId), 'json')) || [];
  const cands = liveCandidates(json, { now, previously, league });
  const liveMap = {};
  const statuses = {};
  // per-competition stage trace (internal): every candidate ends with a reason code, never a silent drop
  const trace = {};
  const mark = (id, code) => { (trace[id] ||= []).push(code); };
  for (const c of cands.slice(maxStatus)) mark(c.id, 'STATUS_BUDGET_EXCEEDED');
  for (const c of cands.slice(0, maxStatus)) {
    mark(c.id, c.prev ? 'CANDIDATE_PREVIOUSLY_LIVE' : 'CANDIDATE_IN_WINDOW');
    const st = await fetchRun(ctx, espn.espnCompetitionStatus, { eventId, compId: c.id });
    if (st.state !== 'PASS') { statuses[c.id] = `error:${st.error || st.state}`; mark(c.id, `STATUS_FETCH_FAILED:${st.state}`); continue; }
    statuses[c.id] = st.records[0].name;
    if (st.records[0].name !== 'STATUS_IN_PROGRESS') { mark(c.id, `NOT_LIVE:${st.records[0].name}`); continue; }
    const ls = [];
    for (const cid of c.competitors) {
      const r = await fetchRun(ctx, espn.espnLinescores, { eventId, compId: c.id, competitorId: cid });
      ls.push(r.state === 'PASS' ? r.records[0].rows : null);
    }
    if (ls.some((x) => !x)) { statuses[c.id] = 'STATUS_IN_PROGRESS:linescores_unavailable'; mark(c.id, 'LINESCORES_UNAVAILABLE'); continue; }
    liveMap[c.id] = { A: ls[0], B: ls[1], period: st.records[0].period, observed_at: new Date(now).toISOString() };
    mark(c.id, 'LIVE');
  }
  const touched = new Set([...Object.keys(liveMap), ...previously]);
  const comps = (json.competitions || []).filter((c) => touched.has(String(c.id)));
  const athleteIds = [...new Set(comps.flatMap((c) => (c.competitors || []).flatMap((x) => espn.competitorAthletes(x) || [])))];
  const idMap = await storedIdMap(ctx.store, athleteIds);
  const parsed = espn.parseEspnEvent(json, { idMap, league, live: liveMap, now });
  const compOf = (m) => m.provider_match_id.split(':').pop();
  // live now, or live last time and now carrying a proven result (status set by the result line)
  const keep = parsed.matches.filter((m) => liveMap[compOf(m)] || (previously.includes(compOf(m)) && m.status && m.status !== 'scheduled' && m.status !== 'in_progress'));
  for (const id of touched) {
    const m = parsed.matches.find((x) => compOf(x) === id);
    if (!m) mark(id, `NOT_PARSED:${(parsed.skipped.find((x) => String(x.id || '').endsWith(`:${id}`))?.reason || 'absent').slice(0, 60)}`);
    else if (!keep.includes(m)) mark(id, `NOT_KEPT:${m.status || 'no_status'}`);
    else mark(id, `NORMALIZED:${m.status}`);
  }
  let w = { written: 0, held: 0, changes: 0 };
  if (keep.length && dry) return { state: 'PASS', dry: true, source: 'espn', event: eventId, edition_id, name: first.edition.name, live: Object.keys(liveMap).length, statuses, would_write: keep.map((m) => ({ id: m.provider_match_id, event_type: m.event_type, status: m.status, sets: m.sets.map((x) => `${x.games.A}-${x.games.B}`).join(' ') })) };
  if (keep.length) {
    const [row] = await ctx.store.select('tennis_tournament_editions', `select=edition_id,surface,indoor&edition_id=eq.${edition_id}`);
    // the espn_atp lane creates the edition (it reads current events from two days before their start)
    if (!row) { for (const m of keep) mark(compOf(m), 'EDITION_PENDING'); return { state: 'EDITION_PENDING', edition_id, live: Object.keys(liveMap).length, statuses, trace }; }
    for (const m of keep) mark(compOf(m), 'WRITE_ATTEMPTED');
    try {
      w = await writeMatches(ctx.store, keep, { edition_id, surface: row.surface ?? null, indoor: row.indoor ?? first.edition.indoor ?? null }, { captureId: res.capture?.capture_id || null, dedupe: true, trace: true });
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 200);
      for (const m of keep) mark(compOf(m), `WRITE_FAILED:${msg}`);
      return { state: 'WRITE_FAILED', error: msg, edition_id, live: Object.keys(liveMap).length, statuses, trace };
    }
    for (const m of keep) mark(compOf(m), w.outcomes?.[m.provider_match_id] || 'WRITE_RESULT_UNKNOWN');
    const { outcomes: _o, ...wNoOutcomes } = w;
    w = wNoOutcomes;
  }
  // still-open competitions stay tracked until a result line (or a non-live status) is observed
  // (a match whose status already says final keeps being tracked until its result line appears; a day-old one is dropped)
  const next = [...new Set([...Object.keys(liveMap), ...previously.filter((id) => {
    const c = (json.competitions || []).find((x) => String(x.id) === id);
    const at = Date.parse(c?.date);
    return c && !(c.notes || []).some((n) => RESULT.test(String(n.text))) && !(Number.isFinite(at) && now - at > 24 * 3600e3);
  })])];
  if (!dry) await ctx.kv.put(KV_PREV(eventId), JSON.stringify(next), { expirationTtl: 12 * 3600 });
  return { state: 'PASS', source: 'espn', event: eventId, edition_id, name: first.edition.name, live: Object.keys(liveMap).length, statuses, trace, ...w };
}

/** Record a current-season ATP event for live discovery (espn_atp lane, after each current-event read). */
export async function noteCurrentEvent(kv, today, r) {
  if (!kv || !r?.event || r.state !== 'PASS' || !r.edition_id) return;
  const events = (await kv.get(KV_EVENTS, 'json')) || {};
  events[r.event] = { start_date: r.start_date || null, end_date: r.end_date || null, final: !!r.final, edition_id: r.edition_id, name: r.name || null };
  const floor = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86400e3).toISOString().slice(0, 10);
  for (const [id, e] of Object.entries(events)) if (e.final || (e.end_date && e.end_date < floor)) delete events[id];
  await kv.put(KV_EVENTS, JSON.stringify(events));
}

/** Current ATP events whose dates include today (one day of slack each side: ESPN days are US-Eastern). */
export function currentLiveEvents(events, today) {
  const d = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
  return Object.entries(events || {}).filter(([, e]) => !e.final && e.start_date && e.start_date <= d(today, 1) && (e.end_date || e.start_date) >= d(today, -1)).map(([id, e]) => ({ id, ...e }));
}

/**
 * Ingest discovery (every tick): observe each current ATP event not owned by tennis-live; events with a competition in
 * progress become live:editions entries {source:'espn'} for tennis-live. Owned editions carry their previous entry.
 */
export async function espnLiveScan(ctx, { today, owned = new Set(), prevLive = new Map(), maxEvents = 6, dry = false } = {}) {
  const events = currentLiveEvents((await ctx.kv.get(KV_EVENTS, 'json')) || {}, today);
  const out = [];
  const live = [];
  for (const e of events.slice(0, maxEvents)) {
    if (owned.has(e.edition_id)) {
      // ownership lasts only while tennis-live still tracks a competition of this event (its KV_PREV list: live now, or
      // live last time and awaiting its result). Re-adding the old entry unconditionally made ownership self-perpetuating:
      // Beijing 959-2026 stayed 'owned' from 2026-09-30 with nothing live, so no lane wrote its results or fixtures.
      const tracked = (await ctx.kv.get(KV_PREV(e.id), 'json')) || [];
      out.push({ event: e.id, state: tracked.length ? 'OWNED_BY_LIVE' : 'OWNERSHIP_RELEASED', tracked: tracked.length });
      if (prevLive.has(e.edition_id) && tracked.length) live.push({ ...prevLive.get(e.edition_id), live: tracked.length });
      continue;
    }
    let r;
    try { r = await espnLiveObserve(ctx, e.id, { owned, dry }); } catch (err) { out.push({ event: e.id, state: 'ERROR', error: String(err?.message || err).slice(0, 300) }); continue; }
    out.push({ event: e.id, state: r.state, live: r.live, written: r.written ?? 0, statuses: r.statuses });
    if (r.state === 'PASS' && r.live) live.push({ source: 'espn', league: 'atp', event_id: e.id, edition_id: r.edition_id, name: e.name, start_date: e.start_date, end_date: e.end_date, live: r.live });
  }
  return { events: events.length, out, live };
}
