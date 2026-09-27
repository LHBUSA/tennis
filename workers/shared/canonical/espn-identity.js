// ESPN athlete id -> canonical player (tour id), fail-closed. docs/TENNIS_IDENTITY.md §ESPN.
//
// Canonical players are minted ONLY from tour ids (atp:/wta:). An ESPN athlete id reaches one through:
//   1. the crosswalk we already hold (tennis_player_external_ids provider=espn)            method external_id
//   2. Wikidata: P11585 (ESPN.com tennis player ID) on the same item as P536 (ATP) / P597 (WTA)
//      — CC0, exact identifiers; corroborated against the canonical player when we hold one
//      (surname must agree, DOB must not conflict); an id Wikidata gives to two ESPN athletes is refused
//                                                                                             method external_id
//   3. exact normalized full name + exact DOB (+ nationality when both have one), unique among tour-id
//      players (identity.js resolveIdentity — the same contract Roland-Garros uses)          method name_dob
//   4. only when 3 finds no candidate at all: exact normalized English label + exact DAY-precision DOB,
//      unique among every Wikidata item carrying an ATP (P536) or WTA (P597) id              method name_dob
// Anything else is unresolved / ambiguous / conflict: the athlete's matches are held, never guessed.

import { normalizeName, resolveIdentity } from './identity.js';

const toks = (s) => new Set(normalizeName(s).split(' ').filter((t) => t.length > 1));

function surnameAgrees(observed, fullName) {
  const want = toks(observed);
  if (!want.size || !fullName) return true; // nothing to compare
  const have = toks(fullName);
  return [...want].some((t) => have.has(t));
}

/**
 * c = {
 *   stored:  Map(espnId -> founding key 'atp:X'),
 *   wd:      Map(espnId -> { qid, atp, wta }),
 *   wdShared: Set('atp:X' | 'wta:Y') claimed by more than one ESPN id on Wikidata,
 *   players: Map(founding key -> { pbe_player_id, full_name, dob, nationality }),
 *   nameIndex: { byExternal: Map(), players: [{ pbe_player_id, full_name, dob, nationality, founding }] },
 *   athlete: { first_name, last_name, full_name, dob, nationality } | null,
 *   observedName: competitor name printed on the match (fallback for the surname check)
 * }
 */
export function resolveEspnIdentity(espnId, c) {
  const id = String(espnId);
  const stored = c.stored.get(id);
  if (stored) return { status: 'resolved', tour: splitKey(stored), method: 'external_id', evidence: `espn:${id} on the PBE crosswalk -> ${stored}` };
  const w = c.wd.get(id);
  if (w) {
    const keys = [w.atp && `atp:${String(w.atp).toUpperCase()}`, w.wta && `wta:${String(w.wta).toUpperCase()}`].filter(Boolean);
    let key = keys.length === 1 ? keys[0] : null;
    if (keys.length === 2) {
      const held = keys.filter((k) => c.players.has(k));
      if (held.length !== 1) return { status: 'ambiguous', reason: 'wikidata_lists_atp_and_wta_ids', candidates: keys };
      key = held[0];
    }
    if (key) {
      if (c.wdShared.has(key)) return { status: 'ambiguous', reason: `wikidata_tour_id_on_several_espn_ids:${key}` };
      const p = c.players.get(key);
      const surname = c.athlete?.last_name || c.athlete?.full_name || c.observedName || '';
      if (p && !surnameAgrees(surname, p.full_name)) return { status: 'conflict', reason: `crosswalk_name_conflict:${key}`, candidates: [p.pbe_player_id] };
      if (p?.dob && c.athlete?.dob && p.dob !== c.athlete.dob) return { status: 'conflict', reason: `crosswalk_dob_conflict:${key}`, candidates: [p.pbe_player_id] };
      const prop = key.startsWith('atp:') ? 'P536' : 'P597';
      return { status: 'resolved', tour: splitKey(key), method: 'external_id', evidence: `espn:${id} -> wikidata:${w.qid} (P11585) -> ${key} (${prop})` };
    }
  }
  const a = c.athlete;
  if (!a?.dob || !a.full_name) return { status: 'unresolved', reason: a ? 'no_dob_for_corroboration' : 'athlete_not_fetched' };
  const r = resolveIdentity({ provider: 'espn', provider_id: id, full_name: a.full_name, dob: a.dob, nationality: a.nationality }, c.nameIndex);
  if (r.status !== 'resolved') {
    if (r.reason === 'no_candidate' && c.wdNames) {
      const hits = [...(c.wdNames.get(`${normalizeName(a.full_name)}|${a.dob}`) || [])];
      if (hits.length > 1) return { status: 'ambiguous', reason: 'wikidata_name_dob_matches_several_tour_ids' };
      if (hits.length === 1) {
        const key = hits[0];
        if (c.wdShared.has(key)) return { status: 'ambiguous', reason: `wikidata_tour_id_on_several_espn_ids:${key}` };
        const p = c.players.get(key);
        if (p?.dob && p.dob !== a.dob) return { status: 'conflict', reason: `crosswalk_dob_conflict:${key}`, candidates: [p.pbe_player_id] };
        return { status: 'resolved', tour: splitKey(key), method: 'name_dob', evidence: `espn:${id} matched ${key} (Wikidata ${key.startsWith('atp:') ? 'P536' : 'P597'} holder) by exact name + day-precision date of birth (unique)` };
      }
    }
    return { status: r.status, reason: r.reason, candidates: r.candidates || [] };
  }
  const hit = c.nameIndex.players.find((p) => p.pbe_player_id === r.pbe_player_id);
  if (!hit?.founding) return { status: 'unresolved', reason: 'matched_player_has_no_tour_id' };
  return { status: 'resolved', tour: splitKey(hit.founding), method: 'name_dob', evidence: `espn:${id} matched ${hit.founding} by exact name + date of birth${a.nationality ? ' + nationality' : ''} (unique)` };
}

function splitKey(k) {
  const i = k.indexOf(':');
  return { provider: k.slice(0, i), provider_id: k.slice(i + 1) };
}

/** Wikidata SPARQL bindings -> { wd: Map, wdShared: Set }. */
export function wikidataEspnMap(bindings) {
  const wd = new Map();
  const claims = new Map();
  for (const b of bindings || []) {
    const e = String(b.e?.value || '').trim();
    if (!/^\d+$/.test(e)) continue;
    const qid = String(b.h?.value || '').split('/').pop();
    const prev = wd.get(e);
    const atp = b.atp?.value ? String(b.atp.value).toUpperCase() : null;
    const wta = b.wta?.value ? String(b.wta.value) : null;
    if (prev && (prev.qid !== qid)) { wd.set(e, { qid: `${prev.qid}|${qid}`, atp: null, wta: null, multiple_items: true }); continue; }
    wd.set(e, { qid, atp: prev?.atp && atp && prev.atp !== atp ? null : prev?.atp || atp, wta: prev?.wta && wta && prev.wta !== wta ? null : prev?.wta || wta });
  }
  for (const [e, v] of wd) for (const k of [v.atp && `atp:${v.atp}`, v.wta && `wta:${v.wta}`].filter(Boolean)) claims.set(k, [...(claims.get(k) || []), e]);
  const wdShared = new Set([...claims].filter(([, es]) => es.length > 1).map(([k]) => k));
  return { wd, wdShared };
}

/** Wikidata tour-id holders -> Map('normalized label|YYYY-MM-DD' -> Set('atp:X' | 'wta:Y')). Rows: [key, label, dob]. */
export function wikidataNameIndex(rows) {
  const m = new Map();
  for (const [key, label, dob] of rows || []) {
    if (!key || !label || !/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) continue;
    const k = `${normalizeName(label)}|${dob}`;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(key);
  }
  return m;
}
