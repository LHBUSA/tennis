// ESPN ATP lane (espn_atp) + ESPN ATP rankings lane (espn_rankings). docs/TENNIS_SOURCE_MATRIX.md §ESPN.
//
// Secondary source: official feeds keep precedence (writer.js crossSource). One event request = one whole
// tournament; athletes are looked up once and cached; unresolved identities hold their matches.
// Cursor rules match every other backfill: a cursor moves past an event/week only when the source proves it
// empty (404 / zero competitions); a block or transient failure throws, the lane backs off and retries.

import * as espn from '../../providers/espn.js';
import { fetchRun, iso } from './jobs.js';
import { writeMatches, hold } from './writer.js';
import { inList } from '../../shared/store/postgrest.js';
import { tournamentId, editionId, snapshotId, slugify } from '../../shared/canonical/ids.js';
import { mintPlayerId } from '../../shared/canonical/identity.js';
import { resolveEspnIdentity, wikidataEspnMap, wikidataNameIndex } from '../../shared/canonical/espn-identity.js';

const now = () => new Date().toISOString();
const K = { state: 'bf:espn', ath: 'espn:ath', wd: 'espn:wd', status: 'espn:status', rank: 'bf:espnrank', held: 'espn:held' };
// per-league state keys (the ATP keys predate the WTA lane and are kept as they are)
const LK = {
  atp: { state: 'bf:espn', rank: 'bf:espnrank', held: 'espn:held', reheld: 'espn:reheld', status: '' },
  wta: { state: 'bf:espn:wta', rank: 'bf:espnrank:wta', held: 'espn:wta:held', reheld: 'espn:wta:reheld', status: 'wta:' }
};
const ADA = (league) => (league === 'wta' ? espn.WTA : espn.ATP);
const WD_TTL_DAYS = 7;
const CURRENT_REFRESH_MS = 3 * 3600 * 1000;

async function all(store, table, query, page = 1000) {
  const out = [];
  for (let off = 0; ; off += page) {
    const rows = await store.select(table, `${query}&limit=${page}&offset=${off}`);
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

// ---- identity context (loaded once per tick) ----------------------------------------------------------
async function wikidataMap(ctx) {
  const cached = await ctx.kv.get(K.wd, 'json');
  if (cached && Date.now() - Date.parse(cached.at) < WD_TTL_DAYS * 86400e3) return cached.rows;
  const query = 'SELECT ?h ?e ?atp ?wta WHERE { ?h wdt:P11585 ?e . OPTIONAL { ?h wdt:P536 ?atp } OPTIONAL { ?h wdt:P597 ?wta } }';
  const adapter = { key: 'wikidata.p11585', family: 'wikidata', capabilities: ['player_identity'], parser_version: '1', request: () => ({ url: `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, headers: { accept: 'application/sparql-results+json' } }), shape: (b) => (/"bindings"/.test(b) ? [] : ['no_bindings']), parse: (b) => (JSON.parse(b).results?.bindings || []).map((x) => ({ h: x.h?.value, e: x.e?.value, atp: x.atp?.value || null, wta: x.wta?.value || null })) };
  const r = await fetchRun(ctx, adapter, {});
  if (r.state !== 'PASS') {
    if (cached) return cached.rows; // stale map beats none; identity stays exact either way
    throw new Error(`wikidata P11585 ${r.state} ${r.error || ''}`.trim());
  }
  const rows = r.records.map((x) => [x.h, x.e, x.atp, x.wta]);
  await ctx.kv.put(K.wd, JSON.stringify({ at: now(), rows }));
  return rows;
}

/** Every Wikidata item with an ATP or WTA id and a DAY-precision date of birth (weekly, KV espn:wdnames). */
async function wikidataNames(ctx) {
  const cached = await ctx.kv.get('espn:wdnames', 'json');
  if (cached && Date.now() - Date.parse(cached.at) < WD_TTL_DAYS * 86400e3) return cached.rows;
  const query = 'SELECT ?atp ?wta ?dob ?l WHERE { { ?h wdt:P536 ?atp } UNION { ?h wdt:P597 ?wta } ?h p:P569/psv:P569 [ wikibase:timeValue ?dob ; wikibase:timePrecision 11 ] . ?h rdfs:label ?l FILTER(lang(?l) = "en") }';
  const adapter = { key: 'wikidata.tour_dob', family: 'wikidata', capabilities: ['player_identity'], parser_version: '1', request: () => ({ url: `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, headers: { accept: 'application/sparql-results+json' } }), shape: (b) => (/"bindings"/.test(b) ? [] : ['no_bindings']), parse: (b) => (JSON.parse(b).results?.bindings || []).map((x) => [x.atp ? `atp:${String(x.atp.value).toUpperCase()}` : `wta:${x.wta.value}`, x.l.value, String(x.dob.value).slice(0, 10)]) };
  const r = await fetchRun(ctx, adapter, {});
  if (r.state !== 'PASS') return cached ? cached.rows : [];
  await ctx.kv.put('espn:wdnames', JSON.stringify({ at: now(), rows: r.records }));
  return r.records;
}

export async function identityContext(ctx) {
  if (ctx.espnIdentity) return ctx.espnIdentity;
  const rows = await wikidataMap(ctx);
  const { wd, wdShared } = wikidataEspnMap(rows.map(([h, e, atp, wta]) => ({ h: { value: h }, e: { value: e }, atp: atp ? { value: atp } : undefined, wta: wta ? { value: wta } : undefined })));
  const players = await all(ctx.store, 'tennis_players', 'select=pbe_player_id,founding_external_key,full_name,dob,nationality,gender&status=eq.active&order=pbe_player_id.asc');
  const byFounding = new Map(players.map((p) => [p.founding_external_key, p]));
  const byPid = new Map(players.map((p) => [p.pbe_player_id, p]));
  const stored = new Map();
  for (const x of await all(ctx.store, 'tennis_player_external_ids', 'select=external_id,pbe_player_id&provider=eq.espn&order=external_id.asc')) {
    const p = byPid.get(x.pbe_player_id);
    if (p && /^(atp|wta):/.test(p.founding_external_key)) stored.set(String(x.external_id), p.founding_external_key);
  }
  const nameIndex = { byExternal: new Map(), players: players.filter((p) => p.dob && /^(atp|wta):/.test(p.founding_external_key)).map((p) => ({ ...p, founding: p.founding_external_key })) };
  ctx.espnIdentity = { wd, wdShared, players: byFounding, stored, nameIndex, wdNames: wikidataNameIndex(await wikidataNames(ctx)) };
  return ctx.espnIdentity;
}

/** Athlete facts cache: KV 'espn:ath' { id: [first, last, full, dob, nat, hand] | 0 }. */
async function athletes(ctx, ids, lookups) {
  const cache = (await ctx.kv.get(K.ath, 'json')) || {};
  const idc = await identityContext(ctx);
  const unknown = ids.filter((id) => !(id in cache) && !idc.stored.has(id));
  let looked = 0;
  for (const id of unknown.slice(0, lookups)) {
    const r = await fetchRun(ctx, espn.espnAthlete, { id });
    if (r.state === 'PASS') { const a = r.records[0]; cache[id] = [a.first_name, a.last_name, a.full_name, a.dob, a.nationality, a.hand]; }
    // 404 / 400 ('Sports Athletes not supported for tennis', athlete 458): no bio record exists for that id
    else if (r.state === 'DEGRADED' && [400, 404].includes(r.http_status)) cache[id] = 0;
    else { await ctx.kv.put(K.ath, JSON.stringify(cache)); throw new Error(`espn athlete ${id}: ${r.state} ${r.error || ''}`.trim()); }
    looked += 1;
  }
  if (looked) await ctx.kv.put(K.ath, JSON.stringify(cache));
  const get = (id) => { const v = cache[id]; return v ? { first_name: v[0], last_name: v[1], full_name: v[2], dob: v[3], nationality: v[4], hand: v[5] } : null; };
  return { get, remaining: unknown.length - looked, looked };
}

/** Resolve a set of ESPN athlete ids -> idMap for parseEspnEvent + outcome counts + queue rows. */
export function buildIdMap(ids, idc, getAthlete, observedNames = {}) {
  const idMap = {};
  const outcomes = { resolved: 0, by_crosswalk: 0, by_wikidata: 0, by_name_dob: 0, unresolved: 0, ambiguous: 0, conflict: 0 };
  const queue = [];
  for (const id of ids) {
    const a = getAthlete(id);
    const r = resolveEspnIdentity(id, { ...idc, athlete: a, observedName: observedNames[id] || '' });
    if (r.status === 'resolved') {
      outcomes.resolved += 1;
      const how = r.evidence.includes('crosswalk') ? 'by_crosswalk' : r.evidence.includes('holder') ? 'by_wikidata_name_dob' : r.method === 'name_dob' ? 'by_name_dob' : 'by_wikidata';
      outcomes[how] = (outcomes[how] || 0) + 1;
      idMap[id] = { provider: r.tour.provider, provider_id: r.tour.provider_id, evidence: r.evidence, method: r.method, first_name: a?.first_name || null, last_name: a?.last_name || null, country: a?.nationality || null, gender: r.tour.provider === 'wta' ? 'F' : 'M', dob: a?.dob || null, hand: a?.hand || null, canonical_name: idc.players.get(`${r.tour.provider}:${r.tour.provider_id}`)?.full_name || null };
    } else {
      outcomes[r.status] = (outcomes[r.status] || 0) + 1;
      queue.push({ provider: 'espn', external_id: String(id), observed_name: a?.full_name || observedNames[id] || `espn:${id}`, observed: { dob: a?.dob || null, nationality: a?.nationality || null }, status: r.status === 'unresolved' ? 'unresolved' : 'ambiguous', reason: r.reason, candidates: (r.candidates || []).filter((c) => /^[0-9a-f-]{36}$/.test(c)) });
    }
  }
  return { idMap, outcomes, queue };
}

// ---- editions -----------------------------------------------------------------------------------------
export async function writeEspnEdition(store, e) {
  const slam = e.slam ? Object.values(espn.ESPN_SLAMS).find((s) => s.key === e.slam) : null;
  const tid = await tournamentId(slam ? `slam:${slam.key}` : `espn:${e.espn_tournament_id}`);
  const eid = await editionId(tid, e.year);
  if (slam) {
    await store.upsert('tennis_tournaments', [{ tournament_id: tid, slug: slam.key, name: slam.name, competition_key: 'grand_slam', country: slam.country, city: slam.city }], { onConflict: 'tournament_id', ignore: true });
    // an official source's edition row is never overwritten; ESPN only creates a missing one
    await store.upsert('tennis_tournament_editions', [{ edition_id: eid, tournament_id: tid, year: e.year, competition_key: 'grand_slam', start_date: e.start_date, end_date: e.end_date, surface: slam.surface, indoor: false, source_family: 'espn', name: `${slam.name} ${e.year}`, level: 'Grand Slam', city: slam.city, country: slam.country, source_status: e.status, updated_at: now() }], { onConflict: 'edition_id', ignore: true });
    // an official edition row without dates gets ESPN's calendar days (fill-missing only; never overwritten)
    if (e.start_date && e.end_date && e.end_date >= e.start_date) await store.req('PATCH', `tennis_tournament_editions?edition_id=eq.${eid}&start_date=is.null&end_date=is.null`, { body: { start_date: e.start_date, end_date: e.end_date } });
  } else {
    const [have] = await store.select('tennis_tournaments', `select=tournament_id,slug&tournament_id=eq.${tid}`);
    if (!have) {
      // insert-only (newest edition's name wins because the backfill walks backwards); slug collisions with a
      // different tournament (e.g. the WTA event of the same name) get "-atp", then the ESPN id
      let slug = slugify(e.name) || `espn-${e.espn_tournament_id}`;
      const taken = new Set((await store.select('tennis_tournaments', `select=slug&slug=${inList([slug, `${slug}-atp`])}`)).map((x) => x.slug));
      if (taken.has(slug)) slug = taken.has(`${slug}-atp`) ? `${slug}-atp-${e.espn_tournament_id}` : `${slug}-atp`;
      await store.upsert('tennis_tournaments', [{ tournament_id: tid, slug, name: e.name, competition_key: e.competition_key, country: null, city: e.city }], { onConflict: 'tournament_id', ignore: true });
    }
    await store.upsert('tennis_tournament_editions', [{ edition_id: eid, tournament_id: tid, year: e.year, competition_key: e.competition_key, start_date: e.start_date, end_date: e.end_date && e.start_date && e.end_date < e.start_date ? e.start_date : e.end_date, surface: null, indoor: e.indoor, source_family: 'espn', name: e.name, level: null, city: e.city, country: null, source_status: e.status, updated_at: now() }], { onConflict: 'edition_id' });
  }
  await store.upsert('tennis_tournament_external_ids', [{ provider: 'espn', external_id: e.espn_tournament_id, tournament_id: tid }], { onConflict: 'provider,external_id', ignore: true });
  await store.upsert('tennis_edition_external_ids', [{ provider: 'espn', external_id: e.espn_event_id, edition_id: eid }], { onConflict: 'provider,external_id', ignore: true });
  const [row] = await store.select('tennis_tournament_editions', `select=edition_id,surface,indoor,source_family&edition_id=eq.${eid}`);
  return { edition_id: eid, surface: row?.surface ?? (slam ? slam.surface : null), indoor: row?.indoor ?? e.indoor ?? null, owner: row?.source_family || 'espn' };
}

/** DOB / playing hand from ESPN only where the canonical player has none (never overwrite). */
async function fillPlayerFacts(store, idMap) {
  const facts = new Map();
  for (const x of Object.values(idMap)) if (x.dob || x.hand) facts.set(await mintPlayerId(x.provider, x.provider_id), x);
  if (!facts.size) return 0;
  const rows = await store.select('tennis_players', `select=pbe_player_id,founding_external_key,full_name,dob,plays&pbe_player_id=${inList([...facts.keys()])}`);
  const patch = [];
  for (const p of rows) {
    const f = facts.get(p.pbe_player_id);
    const next = { dob: p.dob || f.dob || null, plays: p.plays || f.hand || null };
    if (next.dob !== p.dob || next.plays !== p.plays) patch.push({ pbe_player_id: p.pbe_player_id, founding_external_key: p.founding_external_key, full_name: p.full_name, ...next });
  }
  if (patch.length) await store.upsert('tennis_players', patch, { onConflict: 'pbe_player_id' });
  return patch.length;
}

// ---- one event ----------------------------------------------------------------------------------------
/** Returns { state: 'PASS'|'IDENTITY_PENDING'|'ABSENT'|'SKIPPED', final: bool, ... }. Throws on a block. */
export async function espnEventStep(ctx, eventId, { lookups = 12, statusLookups = 4, league = 'atp' } = {}) {
  const A = ADA(league);
  const lk = LK[league];
  const res = await fetchRun(ctx, A.event, { id: eventId });
  if (res.state !== 'PASS') {
    if (res.state === 'DEGRADED' && (res.http_status === 404 || res.error === 'zero_records')) return { event: eventId, state: 'ABSENT', error: res.error };
    throw new Error(`espn event ${eventId}: ${res.state} ${res.error || ''}`.trim());
  }
  const json = res.records[0];
  const final = json.status?.type?.completed === true || json.status?.type?.name === 'STATUS_FINAL';
  let parsed = espn.parseEspnEvent(json, { league });
  if (!parsed.edition || parsed.edition.exhibition || parsed.edition.slam_mismatch) return { event: eventId, state: 'SKIPPED', final: true, reason: parsed.skipped[0]?.reason || 'bad_event' };
  const statuses = (await ctx.kv.get(K.status, 'json')) || {};
  const pendingStatus = parsed.needsStatus.filter((c) => !(`${lk.status}${eventId}:${c}` in statuses));
  for (const c of pendingStatus.slice(0, statusLookups)) {
    const r = await fetchRun(ctx, A.status, { eventId, compId: c });
    if (r.state !== 'PASS') throw new Error(`espn status ${eventId}:${c}: ${r.state} ${r.error || ''}`.trim());
    statuses[`${lk.status}${eventId}:${c}`] = r.records[0].name;
  }
  if (pendingStatus.length) await ctx.kv.put(K.status, JSON.stringify(statuses));
  const ath = await athletes(ctx, parsed.athletes, lookups);
  if (ath.remaining > 0 || pendingStatus.length > statusLookups) return { event: eventId, state: 'IDENTITY_PENDING', name: parsed.edition.name, athletes: parsed.athletes.length, looked_up: ath.looked, remaining: ath.remaining };
  const idc = await identityContext(ctx);
  const observed = {};
  for (const c of json.competitions || []) for (const x of c.competitors || []) { const ids = espn.competitorAthletes(x) || []; const names = String(x.name || '').split('/'); ids.forEach((id, i) => { if (names[i]) observed[id] = names[i].trim(); }); }
  const { idMap, outcomes, queue } = buildIdMap(parsed.athletes, idc, ath.get, observed);
  const statusById = Object.fromEntries(Object.entries(statuses).filter(([k]) => k.startsWith(`${lk.status}${eventId}:`)).map(([k, v]) => [k.split(':').at(-1), v]));
  parsed = espn.parseEspnEvent(json, { idMap, statusById, league });
  const skipped = {};
  for (const s of parsed.skipped) skipped[s.reason.split(':')[0]] = (skipped[s.reason.split(':')[0]] || 0) + 1;
  if (queue.length) await ctx.store.upsert('tennis_identity_queue', queue, { onConflict: 'provider,external_id' });
  const resolvedNow = Object.keys(idMap);
  for (let i = 0; i < resolvedNow.length; i += 150) await ctx.store.req('PATCH', `tennis_identity_queue?provider=eq.espn&status=in.(unresolved,ambiguous)&external_id=${inList(resolvedNow.slice(i, i + 150))}`, { body: { status: 'resolved', reason: 'resolved by a later crosswalk' } });
  if (!parsed.matches.length) return { event: eventId, state: 'PASS', final, start_date: parsed.edition.start_date, name: parsed.edition.name, matches: 0, skipped, identity: outcomes };
  // WTA: the official WTA edition of the same event (proven by shared player pairs) owns the rows; else ESPN's
  const mapped = league === 'wta' ? await mapOfficialEdition(ctx.store, parsed, idMap) : null;
  const ed = mapped || await writeEspnEdition(ctx.store, parsed.edition);
  const w = await writeMatches(ctx.store, parsed.matches, ed, { captureId: res.capture?.capture_id || null, dedupe: true });
  // ESPN carries no match statistics
  await ctx.store.req('PATCH', `tennis_matches?edition_id=eq.${ed.edition_id}&source_family=eq.espn&stats_status=eq.pending`, { body: { stats_status: 'unavailable' } });
  const facts = await fillPlayerFacts(ctx.store, idMap);
  const unresolvedHeld = w.held > 0;
  const heldSet = new Set((await ctx.kv.get(lk.held, 'json')) || []);
  if (unresolvedHeld) heldSet.add(eventId); else heldSet.delete(eventId);
  await ctx.kv.put(lk.held, JSON.stringify([...heldSet]));
  return { event: eventId, league, state: 'PASS', final, start_date: parsed.edition.start_date, name: parsed.edition.name, year: parsed.edition.year, slam: parsed.edition.slam, edition_mapping: mapped ? mapped.evidence : null, matches: parsed.matches.length, ...w, skipped, identity: outcomes, player_facts_filled: facts };
}

// ---- lane: current season first, then history back to the floor year ---------------------------------
async function seasonEvents(ctx, year, league = 'atp') {
  const ids = [];
  for (let page = 1; page <= 5; page += 1) {
    const r = await fetchRun(ctx, ADA(league).seasonEvents, { year, page });
    if (r.state !== 'PASS') {
      if (r.state === 'DEGRADED' && r.error === 'zero_records' && page === 1) return [];
      throw new Error(`espn events ${year} p${page}: ${r.state} ${r.error || ''}`.trim());
    }
    ids.push(...r.records.map((x) => x.id));
    if (page >= (r.records[0]?.page_count || 1)) break;
  }
  return [...new Set(ids)];
}

/**
 * One bounded unit of ESPN ATP work. State (KV bf:espn):
 *   { year: history cursor, queue: [event ids of the cursor year], cur: { listed_at, queue, done: [final ids] } }
 * The current season is re-listed every 3 h and its unfinished events are re-read; history walks
 * year -> floor, one queue per year. `budget` caps ESPN requests (events + statuses + athletes).
 */
export const espnAtpStep = (ctx, o = {}) => espnLaneStep(ctx, { ...o, league: 'atp' });
export const espnWtaStep = (ctx, o = {}) => espnLaneStep(ctx, { ...o, league: 'wta' });

export async function espnLaneStep(ctx, { budget = 20, today = iso(new Date()), league = 'atp' } = {}) {
  const lk = LK[league];
  const season = Number(today.slice(0, 4));
  const st = (await ctx.kv.get(lk.state, 'json')) || { year: season - 1, queue: null, cur: { listed_at: null, queue: [], done: [] } };
  const start = ctx.upstream;
  const spent = () => ctx.upstream - start;
  const out = { runs: [] };
  const save = () => ctx.kv.put(lk.state, JSON.stringify(st));
  // 1. current season
  if (!st.cur.listed_at || Date.now() - Date.parse(st.cur.listed_at) > CURRENT_REFRESH_MS) {
    const ids = await seasonEvents(ctx, season, league);
    const done = new Set(st.cur.done);
    const future = st.cur.future || {};
    // events that have not started are re-read only once their start date arrives
    st.cur = { listed_at: now(), queue: ids.filter((id) => !done.has(id) && !(future[id] && future[id] > today)), done: [...done], future };
    await save();
  }
  while (st.cur.queue.length && spent() < budget) {
    const id = st.cur.queue[0];
    const r = await espnEventStep(ctx, id, { lookups: Math.max(1, budget - spent() - 1), league });
    out.runs.push(r);
    if (r.state === 'IDENTITY_PENDING') break;
    st.cur.queue.shift();
    if (r.final || r.state === 'ABSENT') st.cur.done = [...new Set([...st.cur.done, id])];
    else if (r.start_date && r.start_date > today) st.cur.future = { ...(st.cur.future || {}), [id]: r.start_date };
    await save();
  }
  if (st.cur.queue.length) return { ...out, phase: 'current', season, remaining: st.cur.queue.length };
  // 2. history
  if (st.year < espn.ESPN_FLOOR_YEAR) {
    // history complete: re-read events that still hold unresolved identities once the crosswalk grows (weekly)
    const last = await ctx.kv.get(lk.reheld);
    if (!last || Date.now() - Date.parse(last) > 7 * 86400e3) {
      const held = (await ctx.kv.get(lk.held, 'json')) || [];
      st.retry = held;
      await ctx.kv.put(lk.reheld, now());
    }
    while ((st.retry || []).length && spent() < budget) {
      const r = await espnEventStep(ctx, st.retry[0], { lookups: Math.max(1, budget - spent() - 1), league });
      out.runs.push(r);
      if (r.state === 'IDENTITY_PENDING') break;
      st.retry.shift();
    }
    await save();
    return { ...out, phase: 'history_complete', held_events_retry: (st.retry || []).length };
  }
  if (!st.queue) { st.queue = await seasonEvents(ctx, st.year, league); await save(); }
  while (st.queue.length && spent() < budget) {
    const r = await espnEventStep(ctx, st.queue[0], { lookups: Math.max(1, budget - spent() - 1), league });
    out.runs.push(r);
    if (r.state === 'IDENTITY_PENDING') break;
    st.queue.shift();
    await save();
  }
  if (!st.queue.length) { st.year -= 1; st.queue = null; await save(); }
  return { ...out, phase: 'history', year: st.queue ? st.year : st.year + 1, remaining: st.queue ? st.queue.length : 0 };
}

// ---- rankings -----------------------------------------------------------------------------------------
/**
 * Weekly ESPN ATP singles lists -> tennis_ranking_snapshots(list_key atp_singles, source_family espn).
 * ranking_date = ESPN's own `lastUpdated` date for that list (an observation/publication date, never earlier
 * than the list existed), NOT a claimed official ATP release date. Walks the current season forward to its
 * latest week, then history backwards week by week to the floor. 404 weeks are recorded absent, not guessed.
 */
export async function espnRankingStep(ctx, { weeks = 8, today = iso(new Date()), league = 'atp' } = {}) {
  const lk = LK[league];
  const K = { rank: lk.rank };
  const season = Number(today.slice(0, 4));
  const st = (await ctx.kv.get(K.rank, 'json')) || { season, week: 1, hist: { season: season - 1, week: 53 }, cur_checked: null };
  const out = { lists: [] };
  let n = 0;
  const idc = await identityContext(ctx);
  const step = async (s, w) => {
    const r = await fetchRun(ctx, ADA(league).rankingWeek, { season: s, week: w, league });
    n += 1;
    if (r.state !== 'PASS') {
      if (r.state === 'DEGRADED' && (r.http_status === 404 || r.error === 'shape_drift' || r.error === 'zero_records')) return { season: s, week: w, state: 'ABSENT' };
      throw new Error(`espn ranking ${s} w${w}: ${r.state} ${r.error || ''}`.trim());
    }
    const list = r.records[0];
    const w2 = await writeEspnRanking(ctx, list, idc, r.capture?.capture_id || null, league);
    return { season: s, week: w, state: 'PASS', ...w2 };
  };
  // current season: advance while weeks exist (a 404 past the latest week just means "not yet")
  if (!st.cur_checked || Date.now() - Date.parse(st.cur_checked) > 12 * 3600e3) {
    if (st.season !== season) { st.season = season; st.week = 1; }
    while (n < weeks) {
      const r = await step(st.season, st.week);
      out.lists.push(r);
      if (r.state !== 'PASS') { if (st.week < 53 && r.week < isoWeek(today)) { st.week += 1; continue; } st.cur_checked = now(); break; }
      st.week += 1;
    }
    await ctx.kv.put(K.rank, JSON.stringify(st));
  }
  while (n < weeks && st.hist.season >= espn.ESPN_FLOOR_YEAR) {
    let r;
    try { r = await step(st.hist.season, st.hist.week); } catch (e) {
      // a HISTORICAL week that answers 5xx on 3 separate runs (ESPN "application error", e.g. 2018 w29) is recorded
      // as a source error and passed; anything else (blocks, transient failures) still stops the lane
      const key = `${st.hist.season}w${st.hist.week}`;
      if (!/DEGRADED http_5\d\d/.test(String(e.message))) throw e;
      st.fail = st.fail || {};
      st.fail[key] = (st.fail[key] || 0) + 1;
      if (st.fail[key] < 3) { await ctx.kv.put(K.rank, JSON.stringify(st)); throw e; }
      st.source_errors = [...new Set([...(st.source_errors || []), key])];
      delete st.fail[key];
      r = { season: st.hist.season, week: st.hist.week, state: 'SOURCE_ERROR' };
    }
    out.lists.push(r);
    st.hist.week -= 1;
    if (st.hist.week < 1) { st.hist.season -= 1; st.hist.week = 53; }
    await ctx.kv.put(K.rank, JSON.stringify(st));
  }
  // weekly: retry the historical weeks recorded as SOURCE_ERROR (a source error is not proof the week was empty)
  if ((st.source_errors || []).length && n < weeks && (!st.errors_retried || Date.now() - Date.parse(st.errors_retried) > 7 * 86400e3)) {
    st.errors_retried = now();
    out.source_error_retry = [];
    for (const key of [...st.source_errors]) {
      if (n >= weeks) break;
      const [s, w] = key.split('w').map(Number);
      try {
        const r = await step(s, w);
        out.source_error_retry.push({ key, state: r.state });
        if (r.state === 'PASS' || r.state === 'ABSENT' || r.state === 'KEPT_OFFICIAL') st.source_errors = st.source_errors.filter((k) => k !== key);
      } catch (e) { out.source_error_retry.push({ key, state: 'SOURCE_ERROR', error: String(e.message).slice(0, 80) }); }
    }
    await ctx.kv.put(K.rank, JSON.stringify(st));
  }
  // daily: link archived ranking rows whose ESPN athlete has since been resolved to a canonical player
  if (!st.relinked || Date.now() - Date.parse(st.relinked) > 86400e3) {
    const open = [...new Set((await ctx.store.select('tennis_rankings', `select=provider_player_id,tennis_ranking_snapshots!inner(list_key)&tennis_ranking_snapshots.list_key=eq.${espn.LEAGUES[league].list_key}&provider_player_id=like.espn:*&pbe_player_id=is.null&limit=5000`)).map((r) => r.provider_player_id.slice(5)))];
    const ath = await athletes(ctx, open, 0);
    const { idMap } = buildIdMap(open, idc, ath.get);
    let linked = 0;
    for (const [aid, x] of Object.entries(idMap)) {
      const p = x.provider === league ? idc.players.get(`${league}:${x.provider_id}`) : null;
      if (!p) continue;
      await ctx.store.req('PATCH', `tennis_rankings?provider_player_id=eq.espn:${aid}&pbe_player_id=is.null`, { body: { pbe_player_id: p.pbe_player_id } });
      linked += 1;
    }
    st.relinked = now();
    await ctx.kv.put(K.rank, JSON.stringify(st));
    out.relinked = { open: open.length, linked };
  }
  return { ...out, league, source_errors: st.source_errors || [], current: `${st.season} w${st.week}`, history_cursor: st.hist.season >= espn.ESPN_FLOOR_YEAR ? `${st.hist.season} w${st.hist.week}` : 'complete', done: st.hist.season < espn.ESPN_FLOOR_YEAR };
}

function isoWeek(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - (d.getUTCDay() || 7)));
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400e3 + 1) / 7);
}

async function writeEspnRanking(ctx, list, idc, captureId, league = 'atp') {
  if (!list.observed_date) throw new Error('espn ranking list without lastUpdated');
  const listKey = espn.LEAGUES[league].list_key;
  const ath = await athletes(ctx, list.rows.map((r) => r.espn_id), 0); // rankings never trigger athlete fetches
  const { idMap } = buildIdMap(list.rows.map((r) => r.espn_id), idc, ath.get);
  // an OFFICIAL list within 6 days of this one wins: the ESPN list is not stored, only reconciled against it
  const lo = new Date(Date.parse(list.observed_date) - 6 * 86400e3).toISOString().slice(0, 10);
  const hi = new Date(Date.parse(list.observed_date) + 6 * 86400e3).toISOString().slice(0, 10);
  const official = await ctx.store.select('tennis_ranking_snapshots', `select=snapshot_id,ranking_date,source_family&list_key=eq.${listKey}&source_family=neq.espn&ranking_date=gte.${lo}&ranking_date=lte.${hi}&order=ranking_date.asc`);
  if (official.length) return { date: list.observed_date, state: 'KEPT_OFFICIAL', reconciliation: await reconcile(ctx, list, idMap, idc, official, league) };
  const [existing] = await ctx.store.select('tennis_ranking_snapshots', `select=snapshot_id,source_family&list_key=eq.${listKey}&ranking_date=eq.${list.observed_date}`);
  if (existing && existing.source_family !== 'espn') return { date: list.observed_date, state: 'KEPT_OFFICIAL' };
  // a list already stored for this date keeps its row (ids of re-dated lists were minted from the old date)
  const sid = existing?.snapshot_id || await snapshotId(listKey, list.observed_date);
  await ctx.store.upsert('tennis_ranking_snapshots', [{ snapshot_id: sid, list_key: listKey, ranking_date: list.observed_date, source_family: 'espn', capture_id: captureId, row_count: 0, captured_at: now() }], { onConflict: 'snapshot_id', ignore: true });
  const rows = [];
  for (const r of list.rows) {
    const x = idMap[r.espn_id];
    rows.push({ snapshot_id: sid, provider_player_id: `espn:${r.espn_id}`, pbe_player_id: x && x.provider === league && idc.players.has(`${league}:${x.provider_id}`) ? idc.players.get(`${league}:${x.provider_id}`).pbe_player_id : null, rank: r.rank, tied: false, points: r.points, tournaments_played: null, previous_rank: r.previous_rank });
  }
  await ctx.store.upsert('tennis_rankings', rows, { onConflict: 'snapshot_id,provider_player_id' });
  await ctx.store.req('PATCH', `tennis_ranking_snapshots?snapshot_id=eq.${sid}`, { body: { row_count: rows.length } });
  return { date: list.observed_date, rows: rows.length, linked: rows.filter((r) => r.pbe_player_id).length };
}

/** ESPN list vs the official list(s) within 6 days: coverage, rank and points agreement (evidence, KV espn:recon:<league>). */
async function reconcile(ctx, list, idMap, idc, official, league) {
  const snap = official.reduce((b, s) => (Math.abs(Date.parse(s.ranking_date) - Date.parse(list.observed_date)) < Math.abs(Date.parse(b.ranking_date) - Date.parse(list.observed_date)) ? s : b));
  const off = new Map((await ctx.store.select('tennis_rankings', `select=pbe_player_id,rank,points&snapshot_id=eq.${snap.snapshot_id}&pbe_player_id=not.is.null&limit=1000`)).map((r) => [r.pbe_player_id, r]));
  let linked = 0; let found = 0; let rankEq = 0; let ptsEq = 0; let absDiff = 0;
  for (const r of list.rows) {
    const x = idMap[r.espn_id];
    const p = x && x.provider === league ? idc.players.get(`${league}:${x.provider_id}`) : null;
    if (!p) continue;
    linked += 1;
    const o = off.get(p.pbe_player_id);
    if (!o) continue;
    found += 1;
    if (o.rank === r.rank) rankEq += 1;
    absDiff += Math.abs(o.rank - r.rank);
    if (o.points != null && r.points != null && Number(o.points) === Number(r.points)) ptsEq += 1;
  }
  const rec = { espn_date: list.observed_date, official_date: snap.ranking_date, days_apart: Math.round((Date.parse(list.observed_date) - Date.parse(snap.ranking_date)) / 86400e3), espn_rows: list.rows.length, linked, in_official: found, rank_equal: rankEq, points_equal: ptsEq, mean_abs_rank_diff: found ? Math.round((absDiff / found) * 100) / 100 : null };
  const key = `espn:recon:${league}`;
  const all = (await ctx.kv.get(key, 'json')) || {};
  all[list.observed_date] = rec;
  await ctx.kv.put(key, JSON.stringify(all));
  return rec;
}

/**
 * The official WTA edition of an ESPN WTA event, proven by shared singles pairs: candidates are official
 * (source_family wta) editions of the same year whose dates overlap the event (+-3 days) and, for a Slam, the
 * canonical Slam edition; the one holding the most of the event's resolved singles pairs wins when that is at
 * least max(2, 30%) of them and no other candidate ties. No proof -> null (the ESPN edition is used).
 */
export async function mapOfficialEdition(store, parsed, idMap) {
  const e = parsed.edition;
  if (!e.start_date || !e.end_date) return null;
  const pairs = new Set();
  for (const m of parsed.matches) {
    if (m.event_type !== 'WS') continue;
    const a = idMap[m.sides.A[0]?.provider_id];
    const b = idMap[m.sides.B[0]?.provider_id];
    if (!a || !b) continue;
    pairs.add([`S:${await mintPlayerId(a.provider, a.provider_id)}`, `S:${await mintPlayerId(b.provider, b.provider_id)}`].sort().join('~'));
  }
  if (pairs.size < 2) return null;
  const lo = Date.parse(e.start_date) - 3 * 86400e3;
  const hi = Date.parse(e.end_date) + 3 * 86400e3;
  // candidate editions found THROUGH the players: their women's singles matches of that year, grouped by edition
  // (a date-window scan of editions drowns in same-fortnight ITF events)
  const keys = [...new Set([...pairs].flatMap((p) => p.split('~')))];
  const byMatch = new Map();
  for (let i = 0; i < keys.length; i += 60) {
    for (let off = 0; ; off += 1000) {
      const rows = await store.select('tennis_match_participants', `select=match_id,participant_key,tennis_matches!inner(edition_id,event_type,tennis_tournament_editions!inner(year,start_date,end_date,source_family,surface,indoor,name))&participant_key=${inList(keys.slice(i, i + 60))}&tennis_matches.event_type=eq.WS&tennis_matches.tennis_tournament_editions.year=eq.${e.year}&order=match_id.asc&limit=1000&offset=${off}`);
      for (const r of rows) { if (!byMatch.has(r.match_id)) byMatch.set(r.match_id, { keys: [], m: r.tennis_matches }); byMatch.get(r.match_id).keys.push(r.participant_key); }
      if (rows.length < 1000) break;
    }
  }
  const tally = new Map();
  for (const { keys: ks, m } of byMatch.values()) {
    const ed = m.tennis_tournament_editions;
    if (!ed || ed.source_family === 'espn' || !ed.start_date || !ed.end_date) continue;
    if (!(Date.parse(ed.start_date) <= hi && Date.parse(ed.end_date) >= lo)) continue;
    if (ks.length !== 2 || !pairs.has([...ks].sort().join('~'))) continue;
    const t = tally.get(m.edition_id) || { edition_id: m.edition_id, surface: ed.surface, indoor: ed.indoor, name: ed.name, source_family: ed.source_family, hit: 0 };
    t.hit += 1;
    tally.set(m.edition_id, t);
  }
  if (e.slam) {
    const slam = Object.values(espn.ESPN_SLAMS).find((x) => x.key === e.slam);
    const sid = await editionId(await tournamentId(`slam:${slam.key}`), e.year);
    if (!tally.has(sid)) { const [x] = await store.select('tennis_tournament_editions', `select=edition_id,surface,indoor,name,source_family&edition_id=eq.${sid}`); if (x && x.source_family !== 'espn') tally.set(sid, { ...x, hit: 0 }); }
  }
  let best = null;
  let second = 0;
  for (const c of [...tally.values()].sort((a, b) => b.hit - a.hit)) { if (!best) best = c; else if (!second) second = c.hit; }
  if (!best || best.hit < Math.max(2, Math.ceil(pairs.size * 0.3)) || best.hit === second) return null;
  await store.upsert('tennis_edition_external_ids', [{ provider: 'espn_wta', external_id: e.espn_event_id, edition_id: best.edition_id }], { onConflict: 'provider,external_id', ignore: true });
  return { edition_id: best.edition_id, surface: best.surface ?? null, indoor: best.indoor ?? null, owner: best.source_family, evidence: `${best.hit} of ${pairs.size} resolved singles pairs already in ${best.name || best.edition_id}` };
}

export { hold };
