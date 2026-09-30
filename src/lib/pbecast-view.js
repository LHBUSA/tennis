// PBEcast presentation derivations — PURE (tests/pbecast-view.test.js). Every value is read from stored events, the
// served match state or published statistics; nothing is estimated. The events themselves are never modified: grouping
// is a display over index ranges of the untouched array.

import { inTiebreakScore } from '../../workers/shared/canonical/events.js';

const FINAL = new Set(['completed', 'retired', 'walkover']);
const gamesKey = (st) => JSON.stringify((st?.sets || []).map((x) => [x.A, x.B]));

/**
 * Recent moments, newest first, collapsed for display: consecutive observed SCORE UPDATE snapshots inside the same game
 * score (e.g. five point-score changes at 5-3) become ONE row carrying the first -> last point transition and the number
 * of observations. Every other event stays its own row. Only events[0..upto] are considered.
 * -> [{ first, last, count, grouped, event, current }] where first/last are indexes into the ORIGINAL array.
 */
export function groupMoments(events, upto, { limit = 6 } = {}) {
  const evs = (events || []).slice(0, Math.max(0, upto) + 1);
  const out = [];
  for (let i = 0; i < evs.length; i += 1) {
    const e = evs[i];
    const prev = out.at(-1);
    const collapsible = e.event_type === 'score_update' && e.quality === 'score_snapshot';
    if (collapsible && prev?.grouped && gamesKey(evs[prev.last].state) === gamesKey(e.state)) {
      prev.last = i;
      prev.count += 1;
      continue;
    }
    out.push({ first: i, last: i, count: 1, grouped: collapsible });
  }
  return out.slice(-limit).reverse().map((g, k) => ({ ...g, event: evs[g.last], current: k === 0 }));
}

/** Point transition for a (grouped) row: first observation's "from" point -> last observation's "to" point. */
export function groupTransition(events, g) {
  const a = events[g.first]?.event_detail?.from?.point || null;
  const b = events[g.last]?.event_detail?.to?.point || null;
  if (a && b && a !== b) return `${a} → ${b}`;
  return b || a || '';
}

/** Games with a provable winner (official point feed, or exactly one game changed between two observations). */
export function gamesFrom(evs, upto) {
  const out = [];
  for (const e of (evs || []).slice(0, upto + 1)) {
    const g = e.event_detail?.game_won;
    if (g?.winner) out.push({ set: g.set, game: g.game, winner: g.winner, server: g.server || null, result: g.result || null });
    else if (e.quality === 'point_event' && e.event_detail?.game_complete && e.winner_side) out.push({ set: e.set_number, game: e.game_number, winner: e.winner_side, server: e.server_side || null, result: e.server_side ? (e.server_side === e.winner_side ? 'hold' : 'break') : null });
  }
  return out;
}

/** Sets won by a side in a view state (a set counts once it is closed, or the match is final). */
export function setsWon(state, s) {
  const o = s === 'A' ? 'B' : 'A';
  return (state?.sets || []).filter((x, i, a) => {
    const done = i < a.length - 1 || ['completed', 'retired'].includes(state.status);
    return done && (x.tb && x.A === x.B ? x.tb[s] > x.tb[o] : x[s] > x[o]);
  }).length;
}

/** Where the match is: set number, game number inside it, or tiebreak. null when final or unknown. */
export function liveContext(state) {
  if (!state || FINAL.has(state.status) || state.status !== 'in_progress') return null;
  const sets = state.sets || [];
  const cur = sets.at(-1);
  if (!cur) return null;
  const tiebreak = inTiebreakScore(state.point);
  return { set: sets.length, game: tiebreak ? null : (Number(cur.A) || 0) + (Number(cur.B) || 0) + 1, tiebreak };
}

const ratio = (n, d) => (n == null || !d ? null : Math.round((n / d) * 100));

/**
 * Match pulse: side-by-side rows (A | label | B) and match-level facts. Hold / break counts use only games whose server
 * AND winner are provable; statistics rows appear only when the source published statistics.
 */
export function pulse(data, state, upto) {
  const evs = data?.events || [];
  const games = gamesFrom(evs, upto);
  const rows = [];
  const known = games.filter((g) => g.server && g.result);
  if (known.length) {
    const held = (s) => { const sv = known.filter((g) => g.server === s); return sv.length ? { n: sv.filter((g) => g.result === 'hold').length, d: sv.length } : null; };
    const broke = (s) => { const rt = known.filter((g) => g.server !== s); return rt.length ? { n: rt.filter((g) => g.result === 'break').length, d: rt.length } : null; };
    const f = (x) => (x ? `${x.n}/${x.d}` : '—');
    rows.push({ key: 'holds', label: 'Service holds', A: f(held('A')), B: f(held('B')) });
    rows.push({ key: 'breaks', label: 'Breaks', A: f(broke('A')), B: f(broke('B')) });
  }
  const st = data?.statistics;
  if (st?.A && st?.B) {
    const p = (v) => (v == null ? '—' : `${v}%`);
    const pair = (fn) => [fn(st.A), fn(st.B)];
    const add = (key, label, [A, B]) => { if (A != null || B != null) rows.push({ key, label, A: A ?? '—', B: B ?? '—' }); };
    add('aces', 'Aces', pair((x) => x.aces ?? null));
    add('df', 'Double faults', pair((x) => x.double_faults ?? null));
    add('first_in', '1st serve in', pair((x) => (ratio(x.first_serves_in, x.service_points) == null ? null : p(ratio(x.first_serves_in, x.service_points)))));
    add('first_won', '1st serve pts won', pair((x) => (ratio(x.first_serve_points_won, x.first_serves_in) == null ? null : p(ratio(x.first_serve_points_won, x.first_serves_in)))));
    add('second_won', '2nd serve pts won', pair((x) => { const d = x.service_points != null && x.first_serves_in != null ? x.service_points - x.first_serves_in : null; const r = ratio(x.second_serve_points_won, d); return r == null ? null : p(r); }));
    add('bp_saved', 'Break points saved', pair((x) => (x.break_points_faced ? `${x.break_points_saved}/${x.break_points_faced}` : null)));
  }
  const facts = [];
  if (state?.sets?.length) facts.push({ key: 'sets', label: 'Sets', value: `${setsWon(state, 'A')}–${setsWon(state, 'B')}` });
  const ctx = liveContext(state);
  const cur = state?.sets?.at(-1);
  if (ctx && cur) facts.push({ key: 'set_now', label: `Set ${ctx.set}`, value: ctx.tiebreak ? `${cur.A}–${cur.B} · TB` : `${cur.A}–${cur.B} · G${ctx.game}` });
  const total = (state?.sets || []).reduce((n, x) => n + (Number(x.A) || 0) + (Number(x.B) || 0), 0);
  if (total) facts.push({ key: 'games', label: 'Games played', value: String(total) });
  return { rows, facts, basis: known.length, games };
}
