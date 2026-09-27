// Roland-Garros (rolandgarros.com) — men's results 2018+ from the site's own public results API.
//   results: /api/en-us/results/{year}/{event}  (SM, DM, QM; one call returns every round)
//   player:  /en-us/players/{fftId}-{slug}      (server-rendered card; birthDate "(16 August 2001)")
// Players carry FFT ids only (no ATP id anywhere in the payloads). Identity therefore uses the existing
// corroboration contract (identity.js name_dob): exact normalized name + exact date of birth + nationality,
// matching exactly ONE canonical ATP-id player. Anything else is held — never a name-only merge.

import { safeJson, requirePaths } from '../shared/adapter.js';

const PARSER = '1';
const RG_EVENTS = { SM: { event_type: 'MS', stage: 'main' }, DM: { event_type: 'MD', stage: 'main' }, QM: { event_type: 'MS', stage: 'qualifying' } };
const ROUND = { 1: '1', 2: '2', 3: '3', 4: '4', 5: 'Q', 6: 'S', 7: 'F' };
const DM_ROUND = { 1: '1', 2: '2', 3: '3', 4: 'Q', 5: 'S', 6: 'F' };
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** Deciding-set rule at Roland-Garros: advantage through 2021, 10-point tiebreak at 6-6 from 2022. */
export function rgFormat(bestOf, year) {
  if (![3, 5].includes(bestOf) || !(year >= 2018)) return null;
  if (year >= 2022) return bestOf === 5 ? 'BO5_FINAL_TB10' : 'BO3_FINAL_TB10';
  return bestOf === 5 ? 'BO5_FINAL_ADV' : 'BO3_FINAL_ADV';
}

/** "(16 August 2001)" -> "2001-08-16"; anything else -> null. */
export function parseRgBirthDate(text) {
  const m = /\(?\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*\)?/.exec(String(text || ''));
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

export function parseRgPlayerPage(html) {
  const s = String(html || '');
  const dob = parseRgBirthDate((/birthDate:"([^"]*)"/.exec(s) || [])[1]);
  return { dob };
}

const setWon = (a, b) => { const hi = Math.max(a, b); const lo = Math.min(a, b); return hi >= 6 && (hi - lo >= 2 || (hi === 7 && lo === 6)); };

export function parseRgResults(json, { year, event, idMap = {} } = {}) {
  const ev = RG_EVENTS[event];
  const rounds = json?.tournamentEvent?.roundResults;
  if (!ev || !Array.isArray(rounds)) return [];
  const out = [];
  for (const r of rounds) {
    for (const m of r.matches || []) {
      const warnings = [];
      const tA = m.teamA || {};
      const tB = m.teamB || {};
      const members = (t) => (t.players || []).map((p) => ({
        provider: 'rolandgarros', provider_id: String(p.id), tour_id: idMap[p.id] ? { provider: 'atp', provider_id: String(idMap[p.id]).toUpperCase() } : null,
        tour_id_evidence: idMap[p.id] ? `rolandgarros:${p.id} matched atp:${String(idMap[p.id]).toUpperCase()} by exact name + date of birth + nationality (unique)` : null,
        first_name: p.firstName || null, last_name: p.lastNameLowercase || p.lastName || null, country: p.country || null, gender: 'M'
      }));
      const A = members(tA);
      const B = members(tB);
      if (!A.length || !B.length) continue;
      const winner = tA.winner === true ? 'A' : tB.winner === true ? 'B' : null;
      const n = Math.min((tA.sets || []).length, (tB.sets || []).length);
      const sets = [];
      for (let i = 0; i < n; i += 1) {
        const a = tA.sets[i];
        const b = tB.sets[i];
        if (!Number.isInteger(a?.score) || !Number.isInteger(b?.score)) { warnings.push(`bad_set_${i + 1}`); break; }
        const tb = a.tieBreak != null && b.tieBreak != null ? { A: Number(a.tieBreak), B: Number(b.tieBreak), winner_points_derived: false } : null;
        sets.push({ games: { A: a.score, B: b.score }, tiebreak: tb, is_match_tiebreak: !!(a.isMatchTieBreak || b.isMatchTieBreak) });
      }
      const cause = String(tA.endCause || tB.endCause || '').toLowerCase();
      const loserSide = winner === 'A' ? 'B' : winner === 'B' ? 'A' : null;
      const wonBy = { A: 0, B: 0 };
      for (const s of sets) if (setWon(s.games.A, s.games.B) || (Math.max(s.games.A, s.games.B) >= 6 && s.tiebreak)) wonBy[s.games.A > s.games.B ? 'A' : 'B'] += 1;
      let status = null;
      let bestOf = null;
      if (/w\/o/.test(cause) && winner) status = 'walkover';
      else if (/^r\.?/.test(cause) && winner) { status = 'retired'; bestOf = sets.length >= 4 || wonBy.A >= 2 || wonBy.B >= 2 ? 5 : event === 'SM' ? 5 : 3; }
      else if (winner && (wonBy[winner] === 3 || wonBy[winner] === 2)) { status = 'completed'; bestOf = wonBy[winner] === 3 ? 5 : 3; }
      else if (String(m.matchData?.status) !== 'FINISHED') continue; // not played yet
      else warnings.push('no_provable_result');
      const format_key = status === 'walkover' ? rgFormat(event === 'SM' ? 5 : 3, year) : rgFormat(bestOf, year);
      if (!format_key) warnings.push('format_unprovable');
      const rn = Number(m.matchData?.round ?? r.roundNumber);
      // main-draw rounds by the payload's own label: doubles has 6 rounds (4 = QF), singles 7 (4 = R16).
      // (Numbering alone stored doubles QF/SF/F as 4/Q/S before 2026-09-27; caught by the ESPN cross-source check.)
      const label = String(r.roundLabel || '').toLowerCase();
      const byLabel = /^quarter/.test(label) ? 'Q' : /^semi/.test(label) ? 'S' : /^final$/.test(label) ? 'F' : null;
      const round_code = ev.stage === 'qualifying' ? (rn >= 1 && rn <= 3 ? `Q-${rn}` : null) : byLabel || (event === 'DM' ? DM_ROUND[rn] : ROUND[rn]) || null;
      if (!round_code) warnings.push(`unmapped_round:${rn}`);
      const started = m.matchData?.endTimestamp && m.matchData?.durationInMinutes ? new Date(m.matchData.endTimestamp - m.matchData.durationInMinutes * 60000).toISOString() : null;
      out.push({
        type: 'match', provider: 'rolandgarros', provider_match_id: `${year}-${m.id}`, provider_event: { id: event, year },
        event_type: ev.event_type, stage: ev.stage, round_code, format_key, status, winner_side: winner,
        end_reason: status === 'retired' ? 'retirement' : status === 'walkover' ? 'walkover' : status === 'completed' ? 'completed' : null,
        retired_side: status === 'retired' ? loserSide : null, withdrawn_side: status === 'walkover' ? loserSide : null,
        sets: status === 'walkover' ? [] : sets, live: null, sides: { A, B },
        seeds: { A: tA.seed ?? null, B: tB.seed ?? null }, entry: { A: tA.entryStatus || null, B: tB.entryStatus || null },
        court_name: m.matchData?.courtName || null, duration_s: m.matchData?.durationInMinutes ? m.matchData.durationInMinutes * 60 : null,
        started_at: started, source_updated_at: m.matchData?.endTimestamp ? new Date(m.matchData.endTimestamp).toISOString() : null, warnings
      });
    }
  }
  return out;
}

/** Every FFT player (id + card path) in a results payload. */
export function rgPlayers(json) {
  const out = new Map();
  for (const r of json?.tournamentEvent?.roundResults || []) for (const m of r.matches || []) for (const t of [m.teamA, m.teamB]) for (const p of t?.players || []) if (p?.id) out.set(String(p.id), { id: String(p.id), path: p.playerCardUrl || null, name: `${p.firstName || ''} ${p.lastNameLowercase || p.lastName || ''}`.trim(), country: p.country || null });
  return [...out.values()];
}


export const rgResults = {
  key: 'rolandgarros.results',
  family: 'rolandgarros',
  capabilities: ['draws', 'set_game_scoring', 'withdrawals_ret_wo', 'history', 'seeds_entry'],
  parser_version: PARSER,
  cadence: { class: 'history', idle_s: 86400 * 30 },
  request: ({ year, event }) => ({ url: `https://www.rolandgarros.com/api/en-us/results/${year}/${event}` }),
  shape: (body) => { const j = safeJson(body); return j ? requirePaths(j, ['tournamentEvent.roundResults']) : ['not_json']; },
  parse: (body) => { const j = safeJson(body); return j ? [j] : []; }
};

export const rgPlayer = {
  key: 'rolandgarros.player',
  family: 'rolandgarros',
  capabilities: ['player_identity'],
  parser_version: PARSER,
  cadence: { class: 'history', idle_s: 86400 * 90 },
  request: ({ path }) => ({ url: `https://www.rolandgarros.com${path}`, headers: { accept: 'text/html' } }),
  shape: (body) => (/birthDate|playerCard|__NUXT__/.test(String(body)) ? [] : ['no_player_card']),
  parse: (body) => [parseRgPlayerPage(body)]
};

export const ADAPTERS = [rgResults, rgPlayer];
