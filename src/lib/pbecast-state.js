// PBEcast court intelligence — PURE (tests/pbecast-v2.test.js).
// Turns the displayed state (set games, point labels, server) into a canonical scoring-engine state and
// asks the SAME engine for break point / set point / match point / tiebreak. Nothing is guessed: when the
// state is incomplete (no server, no point score, unknown format) the answer is null, and the overlay
// shows nothing.

import { resolveFormat, situation, setsToWin } from '../../workers/shared/canonical/scoring.js';

const PT = { 0: 0, 15: 1, 30: 2, 40: 3 };

function pointsOf(point, tiebreak) {
  if (!point) return null;
  const a = String(point.A ?? '').toUpperCase();
  const b = String(point.B ?? '').toUpperCase();
  if (tiebreak) {
    const x = Number(a);
    const y = Number(b);
    return Number.isInteger(x) && Number.isInteger(y) ? { A: x, B: y } : null;
  }
  const adv = (x) => /^(AD|AV|A)$/.test(x); // sources write advantage as AD, Av or A
  if (adv(a)) return { A: 4, B: 3 };
  if (adv(b)) return { A: 3, B: 4 };
  if (PT[a] == null || PT[b] == null) return null;
  return { A: PT[a], B: PT[b] };
}

const setDone = (s, idx, format) => {
  const hi = Math.max(s.A, s.B);
  const lead = Math.abs(s.A - s.B);
  const final = idx === format.best_of - 1;
  if (s.match_tiebreak) return !!s.tb && Math.max(s.tb.A, s.tb.B) >= format.final_set.tiebreak_to && Math.abs(s.tb.A - s.tb.B) >= 2;
  if (final && format.final_set.mode === 'advantage') return hi >= 6 && lead >= 2;
  return hi >= 6 && (lead >= 2 || hi === 7);
};

/** Canonical engine state from a PBEcast view state, or null when not provable. */
export function engineState(view, formatKey) {
  let format;
  try { format = resolveFormat(formatKey); } catch { return null; }
  if (!view || view.status !== 'in_progress' || !['A', 'B'].includes(view.server) || !view.sets?.length) return null;
  const sets = view.sets.map((s, i) => ({ ...s, match_tiebreak: !!(s.match_tiebreak || s.mtb), idx: i }));
  const done = sets.filter((s, i) => i < sets.length - 1 || setDone(s, i, format));
  const cur = sets.length > done.length ? sets[sets.length - 1] : null;
  if (!cur) return null; // between sets: next set not yet observed
  const idx = sets.length - 1;
  const matchTb = !!cur.match_tiebreak || (idx === format.best_of - 1 && format.final_set.mode === 'match_tiebreak');
  const tbAt = format.tiebreak_at ?? 6;
  const inTb = matchTb || (cur.A === tbAt && cur.B === tbAt && !(idx === format.best_of - 1 && format.final_set.mode === 'advantage'));
  const pts = pointsOf(view.point, inTb);
  if (!pts) return null;
  const won = { A: 0, B: 0 };
  for (const s of done) won[s.A > s.B || (s.tb && s.tb.A > s.tb.B && s.match_tiebreak) ? 'A' : 'B'] += 1;
  if (won.A >= setsToWin(format) || won.B >= setsToWin(format)) return null;
  const toEngine = (s, i, winner) => ({ games: { A: s.A, B: s.B }, tiebreak: null, is_match_tiebreak: !!s.match_tiebreak, winner });
  const engSets = done.map((s, i) => toEngine(s, i, s.A > s.B ? 'A' : 'B'));
  engSets.push({ games: matchTb ? { A: 0, B: 0 } : { A: cur.A, B: cur.B }, tiebreak: inTb ? { A: pts.A, B: pts.B, first_server: view.server } : null, is_match_tiebreak: matchTb, winner: null });
  return { format, status: 'in_progress', server: view.server, sets: engSets, game: inTb ? { A: 0, B: 0 } : { A: pts.A, B: pts.B }, sets_won: won, winner: null, end_reason: null, points_played: 0 };
}

/** { break_point, set_point[], match_point[], tiebreak } for the next point, or null. */
export function courtSituation(view, formatKey) {
  const st = engineState(view, formatKey);
  if (!st) return null;
  try { return situation(st); } catch { return null; }
}

/** The single most important overlay line: MATCH POINT > SET POINT > BREAK POINT > TIEBREAK. */
export function situationLine(sit, name = (s) => s) {
  if (!sit) return null;
  if (sit.match_point.length) return { kind: 'match_point', text: `MATCH POINT · ${sit.match_point.map(name).join(' / ')}`, side: sit.match_point[0] };
  if (sit.set_point.length) return { kind: 'set_point', text: `SET POINT · ${sit.set_point.map(name).join(' / ')}`, side: sit.set_point[0] };
  if (sit.break_point) return { kind: 'break_point', text: `BREAK POINT · ${name(sit.break_point)}`, side: sit.break_point };
  if (sit.tiebreak) return { kind: 'tiebreak', text: sit.match_tiebreak ? 'MATCH TIEBREAK' : 'TIEBREAK', side: null };
  return null;
}
