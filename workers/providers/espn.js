// ESPN tennis core API (sports.core.api.espn.com) — SECONDARY ATP results + rankings source (lane espn_atp).
// Owner decision 2026-09-27: ESPN feeds the canonical graph as a secondary source (was reference-only since
// 2026-09-26). Official sources keep precedence: an ESPN row never overwrites a match an official feed owns.
// Structured facts only; no editorial text is stored (notes are parsed for the score line and discarded).
//
// Graph (verified 2026-09-27, docs/evidence/espn-atp-discovery-latest.json):
//   /leagues/atp/events?dates={YYYY}&limit=200        season event list ($ref items; 60-96 per year)
//   /leagues/atp/events/{tid}-{YYYY}                   ONE request = the whole tournament: every competition
//        inline with type (Men's Singles/Doubles, Mixed Doubles, juniors), round {description, roundType},
//        date (UTC; T05:00Z/T04:00Z = day precision), court, competitors {id, order, name, winner,
//        tournamentSeed}, notes[0] {type: "<round> - <court>", text: "<winner> bt <loser> <score> [ret|w/o]"}.
//        Competitions exist from 2007; 2002-2006 editions list 0 competitions.
//   /leagues/atp/events/{e}/competitions/{c}/status    STATUS_FINAL / STATUS_RETIRED / STATUS_WALKOVER ...
//   /leagues/atp/events/{e}/competitions/{c}/competitors/{a}/linescores  games per set (+tiebreak points)
//   /athletes/{id}                                     firstName, lastName, dateOfBirth, citizenshipCountry, hand
//   /leagues/atp/seasons/{Y}/types/2/weeks/{W}/rankings/1   weekly ATP singles list (top 100-150): current,
//        previous, points, trend, athlete ref, lastUpdated. 2007+; no doubles list (rankings/2 = 404).
// Not available: surface, tournament level (only `major` on /tournaments/{id}), match statistics (404),
// point-by-point, Challengers. site.api.espn.com answers 403 (Akamai) to our honest UA: not used, not bypassed.

import { safeJson, requirePaths } from '../shared/adapter.js';
import { normalizeName } from '../shared/canonical/identity.js';

export const ESPN_HOST = 'sports.core.api.espn.com';
export const ESPN_POLICY = Object.freeze({ min_interval_ms: 1100, max_concurrency: 1, retries: 1, backoff_ms: 5000, timeout_ms: 30000 });
const CORE = 'https://sports.core.api.espn.com/v2/sports/tennis';
const PARSER = '1';
export const ESPN_FLOOR_YEAR = 2007; // earliest season with competitions (sweep 2002-2026, 2026-09-27)

/** ESPN tournament ids of the four Slams (event name must agree, else the event is refused). */
export const ESPN_SLAMS = Object.freeze({
  154: { key: 'australian-open', name: 'Australian Open', re: /australian open/i, surface: 'hard', city: 'Melbourne', country: 'AUS' },
  172: { key: 'roland-garros', name: 'Roland-Garros', re: /roland|french open/i, surface: 'clay', city: 'Paris', country: 'FRA' },
  188: { key: 'wimbledon', name: 'Wimbledon', re: /wimbledon/i, surface: 'grass', city: 'London', country: 'GBR' },
  189: { key: 'us-open', name: 'US Open', re: /us open/i, surface: 'hard', city: 'New York', country: 'USA' }
});

// Exhibitions / non-standard scoring: recorded as skipped, never written.
const EXHIBITION = /laver cup|hopman cup|next gen atp finals|ultimate tennis showdown|six kings|exhibition|world tennis league|tie break tens/i;

// Event types observed in real payloads (ATP league: Men's Singles/Doubles + Mixed; WTA league: Women's Singles/
// Doubles + Mixed — the SAME mixed competitions appear in both leagues and dedupe on their competition id).
export const EVENT_TYPES = Object.freeze({ "Men's Singles": 'MS', "Men's Doubles": 'MD', "Women's Singles": 'WS', "Women's Doubles": 'WD', 'Mixed Doubles': 'XD' });
export const LEAGUES = Object.freeze({ atp: { ranking_list: 1, list_key: 'atp_singles', tour: 'atp', events: ['MS', 'MD', 'XD'] }, wta: { ranking_list: 2, list_key: 'wta_singles', tour: 'wta', events: ['WS', 'WD'] } }); // mixed: ingested once, from the ATP league
const SINGLES = new Set(['MS', 'WS']);

/** Competition key only where the event itself says so; ESPN has no level for 250/500/1000 events. */
export function espnCompetition(name, slam) {
  if (slam) return 'grand_slam';
  const n = String(name || '');
  if (/next gen/i.test(n)) return null;
  if (/atp finals|atp world tour finals|masters cup|barclays atp/i.test(n)) return 'atp_finals';
  if (/olympic/i.test(n)) return 'olympics';
  if (/davis cup/i.test(n)) return 'davis_cup';
  if (/united cup/i.test(n)) return 'united_cup';
  return null;
}

/** "154-2026" -> { tid: 154, year: 2026 } */
export function splitEventId(id) {
  const m = /^(\d+)-(\d{4})$/.exec(String(id || ''));
  return m ? { tid: Number(m[1]), year: Number(m[2]) } : null;
}

/** ESPN stores calendar days as US-Eastern midnight in UTC (T05:00Z / T04:00Z): the calendar day. */
export function espnDay(ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 5 * 3600e3).toISOString().slice(0, 10);
}

// ---- rounds ------------------------------------------------------------------------------------------
const ORD = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };
/**
 * ESPN round -> canonical { stage, code } (same codes as the Slam feeds: 1..4, Q, S, F, Q-n, RR).
 * `qualRounds` = numbered qualifying rounds present for this event type; "Qualifying Final" is the next one.
 */
export function espnRound(round, qualRounds = 0) {
  const d = String(round?.description || '').trim();
  let m = /^Qualifying (\d(?:st|nd|rd|th)) Round$/i.exec(d);
  if (m) return { stage: 'qualifying', code: `Q-${ORD[m[1].toLowerCase()]}` };
  if (/^Qualifying Final$/i.test(d)) return { stage: 'qualifying', code: `Q-${qualRounds + 1}` };
  m = /^Round (\d)$/i.exec(d);
  if (m) return { stage: 'main', code: m[1] };
  if (/^Quarterfinals?$/i.test(d)) return { stage: 'main', code: 'Q' };
  if (/^Semifinals?$/i.test(d)) return { stage: 'main', code: 'S' };
  if (/^Finals?$/i.test(d)) return { stage: 'main', code: 'F' };
  if (/^(Round Robin|Group)/i.test(d)) return { stage: 'round_robin', code: 'RR' };
  return null;
}

// ---- result line ---------------------------------------------------------------------------------------
const END = [[/^(ret\.?|retired|retd\.?)$/i, 'retirement'], [/^(w\/o|walkover|wo)$/i, 'walkover'], [/^(def\.?|default(ed)?)$/i, 'default'], [/^(abd\.?|abandoned|unfinished)$/i, 'abandoned']];

/**
 * "(4) Novak Djokovic (SER) bt (16) Jakub Mensik (CZE) 7-6 (7-4) 6-7 (3-7) 1-0 ret"
 *   -> { winnerText, loserText, sets: [{ w, l, tb: {w,l,derived} | null, bracket }], ending }
 * Sets are WINNER-oriented, exactly as printed. Returns null when the line is not a result.
 */
export function parseResultNote(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const i = s.indexOf(' bt ');
  if (i < 0) return null;
  const winnerText = s.slice(0, i);
  const rest = s.slice(i + 4);
  const m = /^(.*?\))((?:\s+\d+-\d+(?:\s*\(\d+(?:-\d+)?\))?)*)\s*(\S+)?\s*$/.exec(rest);
  if (!m) return null;
  let ending = 'completed';
  if (m[3]) {
    const hit = END.find(([re]) => re.test(m[3]));
    if (!hit) return null;
    ending = hit[1];
  }
  const sets = [];
  const re = /(\d+)-(\d+)(?:\s*\((\d+)(?:-(\d+))?\))?/g;
  let t;
  while ((t = re.exec(m[2]))) {
    const w = Number(t[1]);
    const l = Number(t[2]);
    let tb = null;
    if (t[3] !== undefined) tb = t[4] !== undefined ? { w: Number(t[3]), l: Number(t[4]), derived: false } : { single: Number(t[3]) };
    sets.push({ w, l, tb });
  }
  if (!sets.length && ending === 'completed') ending = 'none';
  return { winnerText, loserText: m[1], sets, ending };
}

// ---- formats -----------------------------------------------------------------------------------------
/**
 * Deciding-set rule by event and year (documented rule changes; ESPN's `format.regulation.periods` is 5 for
 * every event and is NOT a best-of signal). bestOf comes from the observed score (see bestOfFrom).
 *   Non-Slam: tiebreak at 6-6 in every set; doubles decide with a 10-point match tiebreak.
 *   AO: advantage deciding set <= 2018, 10-point tiebreak at 6-6 from 2019.   RG: advantage <= 2021, TB10 2022+.
 *   Wimbledon: advantage <= 2018, tiebreak at 12-12 2019-2021, TB10 2022+.     US Open: tiebreak at 6-6 <= 2021, TB10 2022+.
 */
export function espnFormat({ slamKey = null, year, bestOf, matchTiebreak = false }) {
  if (![3, 5].includes(bestOf)) return null;
  if (matchTiebreak) return bestOf === 3 ? (slamKey ? 'BO3_MATCH_TB10' : 'DOUBLES_TOUR') : null;
  const b = `BO${bestOf}`;
  if (!slamKey) return `${b}_TB7`;
  if (year >= 2022) return `${b}_FINAL_TB10`;
  if (slamKey === 'us-open') return `${b}_TB7`;
  if (slamKey === 'australian-open') return year >= 2019 ? `${b}_FINAL_TB10` : `${b}_FINAL_ADV`;
  if (slamKey === 'wimbledon') return year >= 2019 ? `${b}_FINAL_TB7_AT12` : `${b}_FINAL_ADV`;
  if (slamKey === 'roland-garros') return `${b}_FINAL_ADV`;
  return null;
}

const setDone = (w, l) => (w >= 6 && w - l >= 2) || (w === 7 && l === 6) || (w > 7 && w - l === 2);

/** Best-of from a result: a completed match ends when the winner reaches 2 (Bo3) or 3 (Bo5) sets. */
export function bestOfFrom(sets, ending, defaultBestOf) {
  let ww = 0;
  let lw = 0;
  for (const s of sets) {
    if (s.mtb) { ww += 1; continue; }
    if (setDone(s.w, s.l) || (s.w === 7 && s.l === 6)) ww += 1;
    else if (setDone(s.l, s.w) || (s.l === 7 && s.w === 6)) lw += 1;
  }
  if (ending === 'completed') return ww === 3 ? 5 : ww === 2 ? 3 : null;
  if (lw >= 2 || ww >= 2) return 5;
  return defaultBestOf;
}

// ---- event -> SourceMatch records ---------------------------------------------------------------------
const BLOCKING = /^(format_unprovable|unmapped_round|winner_flag|result_line_names|resolved_player_not_in_result_line|unparseable_result_line|unsupported_ending|empty_score_status|walkover_with_games)/;
const lastToken = (name) => normalizeName(name).split(' ').filter(Boolean).pop() || '';
const tokens = (s) => new Set(normalizeName(String(s).replace(/\([^)]*\)/g, ' ')).split(' ').filter(Boolean));

/** Team id "517-574" -> ["517", "574"]; singles "8136" -> ["8136"]. */
export function competitorAthletes(c) {
  const id = String(c?.id || '');
  if (c?.type === 'team') { const p = id.split('-'); return p.length === 2 && p.every((x) => /^\d+$/.test(x)) ? p : null; }
  return /^\d+$/.test(id) ? [id] : null;
}

/**
 * Parse one event payload into edition facts + provider-neutral SourceMatch records.
 * idMap: espn athlete id -> { provider, provider_id, evidence, method, first_name, last_name, gender }.
 * Returns { edition, matches, skipped: [{ id, reason }], athletes: [ids], needsStatus: [compIds] }.
 */
export function parseEspnEvent(json, { idMap = {}, statusById = {}, league = 'atp', now = Date.now() } = {}) {
  const ev = splitEventId(json?.id);
  if (!ev) return { edition: null, matches: [], skipped: [{ id: json?.id ?? null, reason: 'bad_event_id' }], athletes: [], needsStatus: [] };
  const slamDef = ESPN_SLAMS[ev.tid] || null;
  const slam = slamDef && slamDef.re.test(json.name || '') ? slamDef : null;
  const edition = {
    espn_event_id: json.id, espn_tournament_id: String(ev.tid), year: ev.year, name: json.name || json.shortName || null,
    start_date: json.date ? espnDay(json.date) : null, end_date: json.endDate ? espnDay(json.endDate) : null,
    city: json.location?.city ? String(json.location.city).trim() : null, country_name: json.location?.country ? String(json.location.country).trim() : null,
    slam: slam?.key || null, slam_mismatch: !!(slamDef && !slam), competition_key: espnCompetition(json.name, slam), exhibition: EXHIBITION.test(json.name || ''),
    status: json.status?.type?.name || null
  };
  const comps = Array.isArray(json.competitions) ? json.competitions : [];
  const indoor = new Set(comps.map((c) => c.venue?.indoor).filter((v) => typeof v === 'boolean'));
  edition.indoor = indoor.size === 1 ? [...indoor][0] : null;
  const out = { edition, matches: [], skipped: [], athletes: new Set(), needsStatus: [] };
  if (edition.exhibition || edition.slam_mismatch) { out.skipped.push({ id: json.id, reason: edition.exhibition ? 'exhibition' : 'slam_name_mismatch' }); return { ...out, athletes: [] }; }
  // numbered qualifying rounds per event type: "Qualifying Final" is the round after them
  const qual = {};
  for (const c of comps) {
    const et = EVENT_TYPES[c.type?.text];
    const m = /^Qualifying (\d)(?:st|nd|rd|th) Round$/i.exec(String(c.round?.description || '').trim());
    if (et && m) qual[et] = Math.max(qual[et] || 0, Number(m[1]));
  }
  for (const c of comps) {
    const pmid = `${json.id}:${c.id}`;
    const et = EVENT_TYPES[c.type?.text];
    if (!et || !LEAGUES[league].events.includes(et)) { out.skipped.push({ id: pmid, reason: `event_type:${c.type?.text || 'none'}` }); continue; }
    const cs = [...(c.competitors || [])].sort((a, b) => (a.order ?? 9) - (b.order ?? 9));
    if (cs.length !== 2) { out.skipped.push({ id: pmid, reason: 'competitors' }); continue; }
    const ids = cs.map(competitorAthletes);
    if (ids.some((x) => !x) || ids.some((x) => x.length !== (SINGLES.has(et) ? 1 : 2))) { out.skipped.push({ id: pmid, reason: 'competitor_ids' }); continue; }
    for (const x of ids.flat()) out.athletes.add(x);
    const note = (c.notes || []).map((n) => n.text).find((t) => / bt /.test(String(t)));
    if (!note) {
      // an UPCOMING fixture (Phase 6 Matchup DNA): no result line and a start still in the future is unambiguous; a
      // past start without a result (live, cancelled, unreported) stays unwritten — never guessed
      const at = c.date && Math.abs(Number(String(c.date).slice(0, 4)) - ev.year) <= 1 ? Date.parse(c.date) : NaN;
      let frd = espnRound(c.round, qual[et] || 0);
      if (frd?.stage === 'round_robin' && slam) frd = null;
      if (!(at > now) || !frd) { out.skipped.push({ id: pmid, reason: 'no_result' }); continue; }
      const fside = (k) => ids[k].map((aid) => {
        let x = idMap[aid] || null;
        if (x && et !== 'XD' && x.provider !== (et.startsWith('W') ? 'wta' : 'atp')) x = null;
        return { provider: 'espn', provider_id: aid, tour_id: x ? { provider: x.provider, provider_id: x.provider_id } : null, tour_id_evidence: x?.evidence || null, tour_id_method: x?.method || null, first_name: x?.first_name || null, last_name: x?.last_name || null, country: x?.country || null, gender: et === 'XD' ? x?.gender || null : et.startsWith('W') ? 'F' : 'M' };
      });
      out.matches.push({
        type: 'match', provider: 'espn', provider_match_id: pmid, provider_event: { id: json.id, year: ev.year }, event_type: et, stage: frd.stage, round_code: frd.code, format_key: null,
        status: 'scheduled', winner_side: null, end_reason: null, retired_side: null, withdrawn_side: null, sets: [], live: null, sides: { A: fside(0), B: fside(1) },
        seeds: { A: Number.isInteger(cs[0].tournamentSeed) ? cs[0].tournamentSeed : null, B: Number.isInteger(cs[1].tournamentSeed) ? cs[1].tournamentSeed : null }, entry: { A: null, B: null },
        court_name: c.court?.description || null, scheduled_at: new Date(at).toISOString(), match_day: espnDay(c.date), started_at: null, source_updated_at: null, warnings: []
      });
      continue;
    }
    const warnings = [];
    const r = parseResultNote(note);
    const winners = cs.filter((x) => x.winner === true);
    if (!r) warnings.push('unparseable_result_line');
    if (winners.length !== 1) warnings.push('winner_flag');
    const winner = winners.length === 1 ? (cs[0] === winners[0] ? 'A' : 'B') : null;
    // the printed winner must be the flagged winner: every member's surname appears on the right side of "bt"
    if (r && winner) {
      const wSide = cs[winner === 'A' ? 0 : 1];
      const lSide = cs[winner === 'A' ? 1 : 0];
      const wt = tokens(r.winnerText);
      const lt = tokens(r.loserText);
      const names = (x) => String(x.name || '').split('/').map(lastToken).filter(Boolean);
      if (!names(wSide).every((n) => wt.has(n)) || !names(lSide).every((n) => lt.has(n))) warnings.push('result_line_names_disagree_with_winner_flag');
      // the canonical player an athlete id resolved to must also be the one printed (ESPN reuses/remaps
      // historical athlete ids: 2008 AO lists id 543 "Lesley Pattinama Kerkhove" where the result says Zimonjic)
      const printed = (sideIds, t) => sideIds.every((aid) => { const cn = idMap[aid]?.canonical_name; if (!cn) return true; const ct = normalizeName(cn).split(' ').filter((x) => x.length > 1); return ct.some((x) => t.has(x)); });
      const wIds = ids[winner === 'A' ? 0 : 1];
      const lIds = ids[winner === 'A' ? 1 : 0];
      if (!printed(wIds, wt) || !printed(lIds, lt)) warnings.push('resolved_player_not_in_result_line');
    }
    let rd = espnRound(c.round, qual[et] || 0);
    // Slams have no group stage: ESPN labels AO 2024 qualifying round 1 'Group Stage' — refused, never guessed
    if (rd?.stage === 'round_robin' && slam) rd = null;
    if (!rd) warnings.push(`unmapped_round:${c.round?.description || 'none'}`);
    let status = null;
    let end = null;
    let sets = [];
    if (r) {
      end = r.ending;
      if (end === 'none') {
        // an empty score is only a walkover when the competition status says so
        const st = statusById[c.id];
        if (st === undefined) out.needsStatus.push(c.id);
        end = st === 'STATUS_WALKOVER' ? 'walkover' : null;
        if (st !== undefined && !end) warnings.push(`empty_score_status:${st}`);
      }
      if (end === 'default' || end === 'abandoned') { warnings.push(`unsupported_ending:${end}`); end = null; }
      status = end === 'completed' ? 'completed' : end === 'retirement' ? 'retired' : end === 'walkover' ? 'walkover' : null;
      if (end === 'walkover' && r.sets.length) { warnings.push('walkover_with_games'); status = null; }
      sets = r.sets.map((s, i) => ({ ...s, idx: i }));
    }
    // deciding match tiebreak (doubles): "10-6", "13-11" or "1-0 (10-7)" as the third set
    const doubles = !SINGLES.has(et);
    let mtb = false;
    // only when the first two sets were split (a 3-set Bo5 doubles win can end with a long advantage set)
    const split = sets.length === 3 && [sets[0], sets[1]].map((s) => (s.w > s.l ? 'w' : 'l')).sort().join('') === 'lw';
    if (doubles && split) {
      const s3 = sets[2];
      const bracket = s3.w === 1 && s3.l === 0 && s3.tb && s3.tb.w !== undefined && s3.tb.w >= 10;
      const plain = !s3.tb && Math.max(s3.w, s3.l) >= 10;
      if (bracket || plain) {
        sets[2] = bracket ? { w: s3.tb.w, l: s3.tb.l, mtb: true, idx: 2 } : { w: s3.w, l: s3.l, mtb: true, idx: 2 };
        mtb = true;
      }
    }
    const defaultBestOf = slam && et === 'MS' && rd?.stage === 'main' ? 5 : 3;
    const bestOf = status ? bestOfFrom(sets, end, defaultBestOf) : null;
    const format_key = status ? espnFormat({ slamKey: slam?.key || null, year: ev.year, bestOf, matchTiebreak: mtb }) : null;
    if (status && !format_key) warnings.push('format_unprovable');
    // any unproven fact holds the whole row (status null -> tennis_ingest_holds with these warnings)
    if (warnings.some((w) => BLOCKING.test(w))) status = null;
    // winner-oriented -> A/B
    const flip = winner === 'B';
    const orient = (w, l) => (flip ? { A: l, B: w } : { A: w, B: l });
    const outSets = [];
    for (const s of sets) {
      if (s.mtb) { const g = orient(s.w, s.l); outSets.push({ games: { A: g.A > g.B ? 1 : 0, B: g.B > g.A ? 1 : 0 }, tiebreak: { ...g, winner_points_derived: false }, is_match_tiebreak: true }); continue; }
      let tb = null;
      if (s.tb) {
        if (s.tb.single !== undefined) {
          // only the loser's points printed: the winner's are the rule's minimum (flagged derived)
          const target = format_key && /FINAL_TB10/.test(format_key) && s.idx === (bestOf || 3) - 1 ? 10 : 7;
          const loser = s.tb.single;
          const winPts = Math.max(target, loser + 2);
          tb = s.w > s.l ? { ...orient(winPts, loser), winner_points_derived: true } : { ...orient(loser, winPts), winner_points_derived: true };
        } else tb = { ...orient(s.tb.w, s.tb.l), winner_points_derived: false };
      }
      outSets.push({ games: orient(s.w, s.l), tiebreak: tb, is_match_tiebreak: false });
    }
    const side = (k) => ids[k].map((aid) => {
      let x = idMap[aid] || null;
      // a women's event resolved to an ATP id (or the reverse) is a crosswalk error: unresolved, never written
      if (x && et !== 'XD' && x.provider !== (et.startsWith('W') ? 'wta' : 'atp')) { warnings.push(`tour_mismatch:${aid}`); x = null; }
      const g = et === 'XD' ? x?.gender || null : et.startsWith('W') ? 'F' : 'M';
      return {
        provider: 'espn', provider_id: aid, tour_id: x ? { provider: x.provider, provider_id: x.provider_id } : null,
        tour_id_evidence: x?.evidence || null, tour_id_method: x?.method || null,
        first_name: x?.first_name || null, last_name: x?.last_name || null, country: x?.country || null, gender: g
      };
    });
    out.matches.push({
      type: 'match', provider: 'espn', provider_match_id: pmid, provider_event: { id: json.id, year: ev.year },
      event_type: et, stage: rd?.stage || null, round_code: rd?.code || null, format_key, status,
      winner_side: status ? winner : null, end_reason: status === 'retired' ? 'retirement' : status === 'walkover' ? 'walkover' : status === 'completed' ? 'completed' : null,
      retired_side: status === 'retired' ? (winner === 'A' ? 'B' : 'A') : null, withdrawn_side: status === 'walkover' ? (winner === 'A' ? 'B' : 'A') : null,
      sets: status === 'walkover' ? [] : outSets, live: null, sides: { A: side(0), B: side(1) },
      seeds: { A: Number.isInteger(cs[0].tournamentSeed) ? cs[0].tournamentSeed : null, B: Number.isInteger(cs[1].tournamentSeed) ? cs[1].tournamentSeed : null }, entry: { A: null, B: null },
      // ESPN prints placeholder dates on some rows (1900-01-03, 2050-01-03): a timestamp outside the edition year +-1 is dropped
      court_name: c.court?.description || null, scheduled_at: c.date && Math.abs(Number(String(c.date).slice(0, 4)) - ev.year) <= 1 ? new Date(Date.parse(c.date)).toISOString() : null,
      match_day: c.date ? espnDay(c.date) : null, started_at: null, source_updated_at: null, warnings
    });
  }
  return { ...out, athletes: [...out.athletes] };
}

// ---- athletes ----------------------------------------------------------------------------------------
export function parseEspnAthlete(j) {
  if (!j?.id) return null;
  const dob = /^\d{4}-\d{2}-\d{2}/.test(j.dateOfBirth || '') ? espnDobDay(j.dateOfBirth) : null;
  const nat = j.citizenshipCountry?.abbreviation;
  return {
    espn_id: String(j.id), first_name: j.firstName || null, last_name: j.lastName || null, full_name: j.fullName || j.displayName || null,
    dob, nationality: /^[A-Z]{3}$/.test(nat || '') ? nat : null, hand: j.hand?.type === 'RIGHT' ? 'right' : j.hand?.type === 'LEFT' ? 'left' : null
  };
}
// dateOfBirth is a calendar date stored as US-Pacific/Eastern midnight in UTC ("2001-06-15T07:00Z")
const espnDobDay = (ts) => { const t = Date.parse(ts); return Number.isFinite(t) && new Date(t).getUTCHours() <= 12 ? String(ts).slice(0, 10) : espnDay(ts); };

// ---- rankings ----------------------------------------------------------------------------------------
/** Weekly list -> { week, season, observed_date, rows: [{ rank, previous_rank, points, trend, espn_id }] } */
export function mondayOnOrAfter(day) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((8 - (d.getUTCDay() || 7)) % 7));
  return d.toISOString().slice(0, 10);
}

export function parseEspnRanking(j, { season, week } = {}) {
  if (!Array.isArray(j?.ranks) || !j.ranks.length) return null;
  const rows = [];
  for (const r of j.ranks) {
    const id = /athletes\/(\d+)/.exec(r.athlete?.$ref || '')?.[1];
    if (!id || !Number.isInteger(r.current) || r.current < 1) continue;
    rows.push({ rank: r.current, previous_rank: Number.isInteger(r.previous) && r.previous > 0 ? r.previous : null, points: Number.isFinite(r.points) ? r.points : null, trend: r.trend ?? null, espn_id: id });
  }
  // lastUpdated is the START of ESPN's calendar week (anchored on 1 January: 2026 weeks start on Thursdays), not a
  // publication time. The list is the one in force from the Monday inside that week (reconciled 2026: ESPN Thu 07-23
  // == official WTA Mon 07-27, 146/146 ranks and points) -> dated conservatively to the first Monday on/after it.
  const week_start = j.lastUpdated ? String(j.lastUpdated).slice(0, 10) : null;
  return { season, week, list: j.name || null, week_start, observed_date: week_start ? mondayOnOrAfter(week_start) : null, headline: j.headline || null, rows };
}

// ---- adapters ----------------------------------------------------------------------------------------
const J = { accept: 'application/json' };
export const espnSeasonEvents = {
  key: 'espn.atp.events', family: 'espn', capabilities: ['calendar', 'history'], parser_version: PARSER, cadence: { class: 'daily', idle_s: 86400 },
  request: ({ year, page = 1, league = 'atp' }) => ({ url: `${CORE}/leagues/${league}/events?dates=${year}&limit=200&page=${page}`, headers: J }),
  shape: (body) => { const j = safeJson(body); return j ? requirePaths(j, ['items', 'count']) : ['not_json']; },
  parse: (body) => { const j = safeJson(body); return (j.items || []).map((i) => /events\/(\d+-\d{4})/.exec(i.$ref || '')?.[1]).filter(Boolean).map((id) => ({ id, page_count: j.pageCount ?? 1, count: j.count ?? null })); }
};

export const espnEvent = {
  key: 'espn.atp.event', family: 'espn', capabilities: ['draws', 'set_game_scoring', 'withdrawals_ret_wo', 'history', 'qualifying', 'doubles', 'mixed'], parser_version: PARSER, cadence: { class: 'history', idle_s: 86400 * 30 },
  request: ({ id, league = 'atp' }) => ({ url: `${CORE}/leagues/${league}/events/${id}`, headers: J }),
  shape: (body) => { const j = safeJson(body); return j ? requirePaths(j, ['id', 'name', 'date']) : ['not_json']; },
  parse: (body) => { const j = safeJson(body); return j ? [j] : []; }
};

export const espnCompetitionStatus = {
  key: 'espn.atp.status', family: 'espn', capabilities: ['withdrawals_ret_wo'], parser_version: PARSER, cadence: { class: 'history', idle_s: 86400 * 30 },
  request: ({ eventId, compId, league = 'atp' }) => ({ url: `${CORE}/leagues/${league}/events/${eventId}/competitions/${compId}/status`, headers: J }),
  shape: (body) => { const j = safeJson(body); return j ? requirePaths(j, ['type.name']) : ['not_json']; },
  parse: (body) => { const j = safeJson(body); return [{ name: j.type.name, completed: !!j.type.completed }]; }
};

export const espnAthlete = {
  key: 'espn.athlete', family: 'espn', capabilities: ['player_identity', 'player_bio'], parser_version: PARSER, cadence: { class: 'history', idle_s: 86400 * 90 },
  request: ({ id }) => ({ url: `${CORE}/athletes/${id}`, headers: J }),
  shape: (body) => { const j = safeJson(body); return j ? requirePaths(j, ['id']) : ['not_json']; },
  parse: (body) => { const a = parseEspnAthlete(safeJson(body)); return a ? [a] : []; }
};

export const espnRankingWeek = {
  key: 'espn.atp.rankings', family: 'espn', capabilities: ['rankings_singles', 'history'], parser_version: PARSER, cadence: { class: 'weekly', idle_s: 86400 },
  request: ({ season, week, league = 'atp' }) => ({ url: `${CORE}/leagues/${league}/seasons/${season}/types/2/weeks/${week}/rankings/${LEAGUES[league].ranking_list}`, headers: J }),
  shape: (body) => { const j = safeJson(body); return j ? requirePaths(j, ['ranks.0.current', 'lastUpdated']) : ['not_json']; },
  parse: (body, meta = {}) => { const r = parseEspnRanking(safeJson(body), meta.params || {}); return r && r.rows.length ? [r] : []; }
};

// Athlete season statistics (/leagues/{l}/seasons/{Y}/types/2/athletes/{id}/statistics): ESPN's own season
// totals, category "general" only (observed 2026-09-28): singlesWon, singlesLost, singlesTitles, doublesTitles,
// prize (USD, as ESPN states it). Nothing else is invented; an absent stat stays absent.
const SEASON_STATS = { singlesWon: 'singles_won', singlesLost: 'singles_lost', singlesTitles: 'singles_titles', doublesTitles: 'doubles_titles', prize: 'prize_usd' };
export function parseEspnSeasonStats(j) {
  const cats = j?.splits?.categories || [];
  const gen = cats.find((c) => c.name === 'general');
  if (!gen) return null;
  const out = {};
  for (const st of gen.stats || []) if (SEASON_STATS[st.name] && Number.isFinite(st.value)) out[SEASON_STATS[st.name]] = st.value;
  return Object.keys(out).length ? out : null;
}
export const espnSeasonStats = {
  key: 'espn.atp.season_stats', family: 'espn', capabilities: ['season_stats'], parser_version: PARSER, cadence: { class: 'weekly', idle_s: 7 * 86400 },
  request: ({ season, id, league = 'atp' }) => ({ url: `${CORE}/leagues/${league}/seasons/${season}/types/2/athletes/${id}/statistics`, headers: J }),
  shape: (body) => { const j = safeJson(body); return j ? requirePaths(j, ['splits.categories']) : ['not_json']; },
  parse: (body) => { const r = parseEspnSeasonStats(safeJson(body)); return r ? [r] : []; }
};

// Athlete event log (/leagues/{l}/seasons/{Y}/athletes/{id}/eventlog?page=): the competitions ESPN lists for the
// athlete that season, as refs (event key, competition id, played flag). Used only to check our coverage.
export function parseEspnEventLog(j) {
  const items = j?.events?.items || [];
  return { page_count: j?.events?.pageCount ?? 1, count: j?.events?.count ?? items.length, rows: items.map((it) => ({ event: /events\/(\d+-\d{4})/.exec(it.event?.$ref || '')?.[1] || null, competition: /competitions\/(\d+)/.exec(it.competition?.$ref || '')?.[1] || null, played: it.played === true })).filter((x) => x.event && x.competition) };
}
export const espnEventLog = {
  key: 'espn.atp.eventlog', family: 'espn', capabilities: ['coverage_check'], parser_version: PARSER, cadence: { class: 'weekly', idle_s: 7 * 86400 },
  request: ({ season, id, page = 1, league = 'atp' }) => ({ url: `${CORE}/leagues/${league}/seasons/${season}/athletes/${id}/eventlog?page=${page}`, headers: J }),
  // an athlete without a log that season answers with a bare $ref (observed 10645 / 2025): absent, not drift
  shape: (body) => { const j = safeJson(body); if (!j) return ['not_json']; return j.events || j.$ref ? [] : ['missing_events']; },
  parse: (body) => { const j = safeJson(body); return j?.events ? [parseEspnEventLog(j)] : []; }
};

export const ADAPTERS = [espnSeasonEvents, espnEvent, espnCompetitionStatus, espnAthlete, espnRankingWeek, espnSeasonStats, espnEventLog];

/** The same adapters bound to the WTA league (distinct run-ledger keys; identical parsing). */
const bind = (a, league, key) => ({ ...a, key, request: (p = {}) => a.request({ ...p, league }) });
export const WTA = Object.freeze({
  seasonEvents: bind(espnSeasonEvents, 'wta', 'espn.wta.events'),
  event: bind(espnEvent, 'wta', 'espn.wta.event'),
  status: bind(espnCompetitionStatus, 'wta', 'espn.wta.status'),
  rankingWeek: bind(espnRankingWeek, 'wta', 'espn.wta.rankings'),
  seasonStats: bind(espnSeasonStats, 'wta', 'espn.wta.season_stats'),
  eventLog: bind(espnEventLog, 'wta', 'espn.wta.eventlog')
});
export const ATP = Object.freeze({ seasonEvents: espnSeasonEvents, event: espnEvent, status: espnCompetitionStatus, rankingWeek: espnRankingWeek, seasonStats: espnSeasonStats, eventLog: espnEventLog });
