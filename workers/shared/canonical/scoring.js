// Canonical tennis scoring engine — PURE. Shared by tennis-live, tennis-ingest, tests and the web.
//
// tournament → match → set → game → point. The engine is side-based ('A' | 'B'): a side is a
// canonical participant of one (singles) or two (doubles / mixed) players, so the scoring rules
// never care how many people stand on each side. Which individual serves inside a doubles side is
// a SOURCE fact; the engine tracks only the serving side and never invents an individual server.
//
// Contract: docs/TENNISCAST.md. Nothing here reconstructs unseen events — every transition is
// either one observed point, or an explicit terminal/interruption event (retirement, walkover,
// suspension, resumption) that a source reported.

export const SIDES = Object.freeze(['A', 'B']);
export const other = (side) => (side === 'A' ? 'B' : 'A');

/**
 * Match formats. `final_set.mode`:
 *   'tiebreak'        — normal set with a tiebreak at tiebreak_at-all, played to final_set.tiebreak_to
 *   'advantage'       — no tiebreak, win by two games (pre-2019 Wimbledon/AO/RG final sets, Davis Cup history)
 *   'match_tiebreak'  — the deciding set is replaced by a single tiebreak to final_set.tiebreak_to
 * `no_ad`: the deciding point is played at deuce (tour doubles).
 */
export const FORMATS = Object.freeze({
  // ATP/WTA tour singles.
  BO3_TB7: fmt({ best_of: 3, final_set: { mode: 'tiebreak', tiebreak_to: 7 } }),
  // Grand Slam singles since 2022: 10-point tiebreak at 6-6 in the deciding set.
  BO5_FINAL_TB10: fmt({ best_of: 5, final_set: { mode: 'tiebreak', tiebreak_to: 10 } }),
  BO3_FINAL_TB10: fmt({ best_of: 3, final_set: { mode: 'tiebreak', tiebreak_to: 10 } }),
  // Historical advantage deciding set.
  BO5_FINAL_ADV: fmt({ best_of: 5, final_set: { mode: 'advantage' } }),
  // Wimbledon 2019-2021: deciding set tiebreak (to 7) at 12-12
  BO5_FINAL_TB7_AT12: fmt({ best_of: 5, final_set: { mode: 'tiebreak', tiebreak_to: 7, tiebreak_at: 12 } }),
  BO3_FINAL_TB7_AT12: fmt({ best_of: 3, final_set: { mode: 'tiebreak', tiebreak_to: 7, tiebreak_at: 12 } }),
  BO3_FINAL_ADV: fmt({ best_of: 3, final_set: { mode: 'advantage' } }),
  // ATP/WTA tour doubles: no-ad, match tiebreak to 10 in lieu of a third set.
  DOUBLES_TOUR: fmt({ best_of: 3, no_ad: true, final_set: { mode: 'match_tiebreak', tiebreak_to: 10 } }),
  // Same shape with advantage scoring (e.g. Grand Slam doubles with ad games).
  BO3_MATCH_TB10: fmt({ best_of: 3, final_set: { mode: 'match_tiebreak', tiebreak_to: 10 } })
});

function fmt(f) {
  return Object.freeze({
    best_of: f.best_of,
    games_per_set: f.games_per_set ?? 6,
    tiebreak_at: f.tiebreak_at ?? 6,
    tiebreak_to: f.tiebreak_to ?? 7,
    no_ad: !!f.no_ad,
    final_set: Object.freeze({ mode: f.final_set.mode, tiebreak_to: f.final_set.tiebreak_to ?? 7, tiebreak_at: f.final_set.tiebreak_at ?? null })
  });
}

export function resolveFormat(format) {
  if (typeof format === 'string') {
    const f = FORMATS[format];
    if (!f) throw new ScoringError('unknown_format', format);
    return f;
  }
  if (!format || ![1, 3, 5].includes(format.best_of)) throw new ScoringError('invalid_format', JSON.stringify(format));
  return fmt(format);
}

export class ScoringError extends Error {
  constructor(code, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.code = code;
  }
}

export const setsToWin = (format) => Math.ceil(format.best_of / 2);
const isFinalSet = (format, idx) => idx === format.best_of - 1;
/** Games-all at which a set's tiebreak is played (a deciding set may differ, e.g. 12-12 at Wimbledon 2019-21). */
const tbAt = (format, idx) => (isFinalSet(format, idx) && format.final_set.tiebreak_at ? format.final_set.tiebreak_at : format.tiebreak_at);

function newSet(format, idx, server) {
  const matchTb = isFinalSet(format, idx) && format.final_set.mode === 'match_tiebreak';
  return {
    games: { A: 0, B: 0 },
    tiebreak: matchTb ? { A: 0, B: 0, first_server: server } : null,
    is_match_tiebreak: matchTb,
    winner: null
  };
}

/** A fresh match in progress. `firstServer` must come from the source (coin toss is not inferable). */
export function startMatch(formatInput, firstServer) {
  const format = resolveFormat(formatInput);
  if (!SIDES.includes(firstServer)) throw new ScoringError('first_server_required');
  return {
    format,
    status: 'in_progress',
    server: firstServer,
    sets: [newSet(format, 0, firstServer)],
    game: { A: 0, B: 0 },
    sets_won: { A: 0, B: 0 },
    winner: null,
    end_reason: null,
    points_played: 0
  };
}

const clone = (s) => structuredClone(s);
export const currentSet = (s) => s.sets[s.sets.length - 1];
export const inTiebreak = (s) => !!currentSet(s)?.tiebreak && currentSet(s).winner === null;

function tiebreakTarget(format, idx) {
  return isFinalSet(format, idx) ? format.final_set.tiebreak_to : format.tiebreak_to;
}

function tiebreakServer(tb) {
  const played = tb.A + tb.B;
  // First point by first_server, then alternate every two points.
  return Math.floor((played + 1) / 2) % 2 === 0 ? tb.first_server : other(tb.first_server);
}

function setIsWon(format, idx, games) {
  const hi = Math.max(games.A, games.B);
  const lead = Math.abs(games.A - games.B);
  const mode = isFinalSet(format, idx) ? format.final_set.mode : 'tiebreak';
  if (mode === 'advantage') return hi >= format.games_per_set && lead >= 2;
  return hi >= format.games_per_set && lead >= 2 && hi <= tbAt(format, idx) + 1;
}

function finishSet(s, winner, nextServer) {
  const set = currentSet(s);
  set.winner = winner;
  s.sets_won[winner] += 1;
  s.game = { A: 0, B: 0 };
  if (s.sets_won[winner] >= setsToWin(s.format)) {
    s.status = 'completed';
    s.winner = winner;
    s.end_reason = 'completed';
    s.server = null;
    return;
  }
  s.server = nextServer;
  s.sets.push(newSet(s.format, s.sets.length, nextServer));
}

/** Apply exactly one observed point won by `side`. Returns a NEW state. */
export function applyPoint(state, side) {
  if (!SIDES.includes(side)) throw new ScoringError('invalid_side', side);
  if (state.status !== 'in_progress') throw new ScoringError('match_not_in_progress', state.status);
  const s = clone(state);
  const set = currentSet(s);
  const idx = s.sets.length - 1;
  s.points_played += 1;

  if (set.tiebreak) {
    const tb = set.tiebreak;
    tb[side] += 1;
    const to = set.is_match_tiebreak ? s.format.final_set.tiebreak_to : tiebreakTarget(s.format, idx);
    if (tb[side] >= to && tb[side] - tb[other(side)] >= 2) {
      if (set.is_match_tiebreak) set.games = { A: side === 'A' ? 1 : 0, B: side === 'B' ? 1 : 0 };
      else set.games[side] += 1;
      // The side that received first in the tiebreak serves first in the next set.
      finishSet(s, side, other(tb.first_server));
    } else {
      s.server = tiebreakServer(tb);
    }
    return s;
  }

  s.game[side] += 1;
  const mine = s.game[side];
  const theirs = s.game[other(side)];
  const gameWon = s.format.no_ad ? mine >= 4 : mine >= 4 && mine - theirs >= 2;
  if (!gameWon) return s;

  set.games[side] += 1;
  s.game = { A: 0, B: 0 };
  const nextServer = other(s.server);
  if (setIsWon(s.format, idx, set.games)) {
    finishSet(s, side, nextServer);
    return s;
  }
  const mode = isFinalSet(s.format, idx) ? s.format.final_set.mode : 'tiebreak';
  if (mode !== 'advantage' && set.games.A === tbAt(s.format, idx) && set.games.B === tbAt(s.format, idx)) {
    set.tiebreak = { A: 0, B: 0, first_server: nextServer };
  }
  s.server = nextServer;
  return s;
}

/** Replay an ordered, observed point stream. Same contract as live — replay is not a separate engine. */
export function replay(formatInput, firstServer, winners) {
  let s = startMatch(formatInput, firstServer);
  for (const w of winners) s = applyPoint(s, w);
  return s;
}

// ---- explicit source-reported events (never inferred) -------------------------------------------

/** `retiringSide` retired. The partial score is preserved exactly; the reason is NOT inferred. */
export function retire(state, retiringSide) {
  if (!SIDES.includes(retiringSide)) throw new ScoringError('invalid_side', retiringSide);
  if (!['in_progress', 'suspended'].includes(state.status)) throw new ScoringError('cannot_retire', state.status);
  const s = clone(state);
  s.status = 'retired';
  s.winner = other(retiringSide);
  s.end_reason = 'retirement';
  s.retired_side = retiringSide;
  s.server = null;
  return s;
}

/** Walkover: the match never started. `withdrawnSide` did not take the court. */
export function walkover(formatInput, withdrawnSide) {
  if (!SIDES.includes(withdrawnSide)) throw new ScoringError('invalid_side', withdrawnSide);
  const format = resolveFormat(formatInput);
  return {
    format,
    status: 'walkover',
    server: null,
    sets: [],
    game: { A: 0, B: 0 },
    sets_won: { A: 0, B: 0 },
    winner: other(withdrawnSide),
    end_reason: 'walkover',
    withdrawn_side: withdrawnSide,
    points_played: 0
  };
}

/** Suspension (rain, darkness, curfew …). `reason` is whatever the source said, or null. */
export function suspend(state, reason = null) {
  if (state.status !== 'in_progress') throw new ScoringError('cannot_suspend', state.status);
  return { ...clone(state), status: 'suspended', suspension_reason: reason };
}

export function resume(state) {
  if (state.status !== 'suspended') throw new ScoringError('cannot_resume', state.status);
  const s = clone(state);
  s.status = 'in_progress';
  delete s.suspension_reason;
  return s;
}

// ---- derived, deterministic situation flags ------------------------------------------------------

function wouldWin(state, side, level) {
  const next = applyPoint(state, side);
  if (level === 'match') return next.status === 'completed';
  if (level === 'set') return next.sets_won[side] > state.sets_won[side];
  // game: the side's games in the current set went up (or the set/match ended on this point)
  const before = currentSet(state).games[side];
  const after = next.sets[state.sets.length - 1].games[side];
  return after > before;
}

/** Break point / set point / match point for the NEXT point, derived from the state alone. */
export function situation(state) {
  if (state.status !== 'in_progress') return { break_point: null, set_point: [], match_point: [], tiebreak: false };
  const receiver = other(state.server);
  const tb = inTiebreak(state);
  return {
    // Break points do not exist inside a tiebreak (serve rotates every two points).
    break_point: !tb && wouldWin(state, receiver, 'game') ? receiver : null,
    set_point: SIDES.filter((x) => wouldWin(state, x, 'set') && !wouldWin(state, x, 'match')),
    match_point: SIDES.filter((x) => wouldWin(state, x, 'match')),
    tiebreak: tb,
    match_tiebreak: tb && currentSet(state).is_match_tiebreak
  };
}

const LABELS = ['0', '15', '30', '40'];
/** Game score as shown on court, e.g. { A: '40', B: 'AD' }. Tiebreak points are shown as numbers. */
export function pointLabels(state) {
  if (inTiebreak(state)) {
    const tb = currentSet(state).tiebreak;
    return { A: String(tb.A), B: String(tb.B) };
  }
  const { A, B } = state.game;
  if (A >= 3 && B >= 3) {
    if (A === B) return { A: '40', B: '40' };
    return A > B ? { A: 'AD', B: '40' } : { A: '40', B: 'AD' };
  }
  return { A: LABELS[A], B: LABELS[B] };
}

// ---- monotonic progress (TennisCast never moves backward without a documented correction) --------

function progressVector(state) {
  const set = currentSet(state);
  const done = state.sets.filter((x) => x.winner).length;
  const games = set ? set.games.A + set.games.B : 0;
  const tbPts = set?.tiebreak ? set.tiebreak.A + set.tiebreak.B : 0;
  return [done, games, tbPts];
}

/** -1 if b is behind a, 0 if equivalent/indistinguishable, 1 if b is ahead. Deuce cycles compare equal. */
export function compareProgress(a, b) {
  const terminal = (s) => (['completed', 'retired', 'walkover'].includes(s.status) ? 1 : 0);
  if (terminal(a) !== terminal(b)) return terminal(b) > terminal(a) ? 1 : -1;
  const va = progressVector(a);
  const vb = progressVector(b);
  for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return vb[i] > va[i] ? 1 : -1;
  // Same game: points only compare when neither side is in the deuce zone.
  const deuce = (g) => g.A >= 3 && g.B >= 3;
  if (deuce(a.game) && deuce(b.game)) return 0;
  const pa = a.game.A + a.game.B;
  const pb = b.game.A + b.game.B;
  return pb === pa ? 0 : pb > pa ? 1 : -1;
}

/** Throws unless `next` is at or ahead of `prev`, or the source issued a documented correction. */
export function assertNoRegression(prev, next, { correction = null } = {}) {
  if (compareProgress(prev, next) >= 0) return { ok: true, correction: null };
  if (correction && correction.source && correction.reason) return { ok: true, correction };
  throw new ScoringError('state_regression', `${JSON.stringify(progressVector(prev))} -> ${JSON.stringify(progressVector(next))}`);
}

// ---- final score strings -------------------------------------------------------------------------

const END_TOKENS = { RET: 'retirement', 'RET.': 'retirement', RETD: 'retirement', 'W/O': 'walkover', WO: 'walkover', DEF: 'default', 'DEF.': 'default', ABD: 'abandoned', ABN: 'abandoned', UNP: 'unplayed' };

/**
 * Parse a score line such as "6-4 3-6 7-6(5)", "7-6(7-5) 6-7(3) [10-8]", "6-2 3-1 RET", "W/O".
 * Games are oriented A-B as written. Where only the loser's tiebreak points are published ("7-6(5)")
 * the winner's are derived from the format rule and flagged `winner_points_derived: true`.
 */
export function parseScore(line, formatInput) {
  const format = resolveFormat(formatInput);
  const tokens = String(line || '').trim().split(/\s+/).filter(Boolean);
  const sets = [];
  let endReason = 'completed';
  for (const raw of tokens) {
    const t = raw.toUpperCase();
    if (END_TOKENS[t]) { endReason = END_TOKENS[t]; continue; }
    const idx = sets.length;
    let m = /^\[(\d+)-(\d+)\]$/.exec(t);
    if (m || (isFinalSet(format, idx) && format.final_set.mode === 'match_tiebreak' && /^(\d+)-(\d+)$/.test(t) && Math.max(...t.split('-').map(Number)) >= format.final_set.tiebreak_to)) {
      const [a, b] = (m ? [m[1], m[2]] : t.split('-')).map(Number);
      sets.push({ games: { A: a > b ? 1 : 0, B: b > a ? 1 : 0 }, tiebreak: { A: a, B: b, winner_points_derived: false }, is_match_tiebreak: true });
      continue;
    }
    m = /^(\d+)-(\d+)(?:\((\d+)(?:-(\d+))?\))?$/.exec(t);
    if (!m) throw new ScoringError('unparseable_score_token', raw);
    const a = Number(m[1]);
    const b = Number(m[2]);
    let tiebreak = null;
    if (m[3] !== undefined) {
      if (m[4] !== undefined) {
        tiebreak = { A: Number(m[3]), B: Number(m[4]), winner_points_derived: false };
      } else {
        const loser = Number(m[3]);
        const to = tiebreakTarget(format, idx);
        const win = Math.max(to, loser + 2);
        tiebreak = a > b ? { A: win, B: loser, winner_points_derived: true } : { A: loser, B: win, winner_points_derived: true };
      }
    }
    sets.push({ games: { A: a, B: b }, tiebreak, is_match_tiebreak: false });
  }
  if (!sets.length && endReason === 'completed') throw new ScoringError('empty_score');
  return { sets, end_reason: endReason };
}

/** Legality of a completed/terminated score under a format. Returns { ok, errors, winner }. */
export function validateScore(parsed, formatInput) {
  const format = resolveFormat(formatInput);
  const errors = [];
  const won = { A: 0, B: 0 };
  const terminal = parsed.end_reason !== 'completed';
  parsed.sets.forEach((set, idx) => {
    const last = idx === parsed.sets.length - 1;
    const { A, B } = set.games;
    const w = A > B ? 'A' : B > A ? 'B' : null;
    if (won.A >= setsToWin(format) || won.B >= setsToWin(format)) errors.push(`set ${idx + 1}: played after the match was decided`);
    if (set.is_match_tiebreak) {
      if (!(isFinalSet(format, idx) && format.final_set.mode === 'match_tiebreak')) errors.push(`set ${idx + 1}: match tiebreak not allowed here`);
      const tb = set.tiebreak;
      const hi = Math.max(tb.A, tb.B);
      const complete = hi >= format.final_set.tiebreak_to && Math.abs(tb.A - tb.B) >= 2;
      if (!complete && !(terminal && last)) errors.push(`set ${idx + 1}: match tiebreak ${tb.A}-${tb.B} incomplete`);
      if (complete && hi > format.final_set.tiebreak_to && Math.abs(tb.A - tb.B) !== 2) errors.push(`set ${idx + 1}: extended match tiebreak must end by two`);
      if (complete) won[tb.A > tb.B ? 'A' : 'B'] += 1;
      return;
    }
    const complete = setIsWon(format, idx, set.games) || isTiebreakSet(format, idx, set);
    if (!complete) {
      if (!(terminal && last)) errors.push(`set ${idx + 1}: ${A}-${B} is not a finished set`);
      return;
    }
    const mode = isFinalSet(format, idx) ? format.final_set.mode : 'tiebreak';
    const needsTb = mode !== 'advantage' && Math.max(A, B) === tbAt(format, idx) + 1 && Math.min(A, B) === tbAt(format, idx);
    if (needsTb && set.tiebreak) {
      const to = tiebreakTarget(format, idx);
      const tb = set.tiebreak;
      const tw = tb.A > tb.B ? 'A' : 'B';
      if (tw !== w) errors.push(`set ${idx + 1}: tiebreak winner disagrees with games`);
      if (Math.max(tb.A, tb.B) < to || Math.abs(tb.A - tb.B) < 2) errors.push(`set ${idx + 1}: tiebreak ${tb.A}-${tb.B} is not finished (to ${to})`);
      if (Math.max(tb.A, tb.B) > to && Math.abs(tb.A - tb.B) !== 2) errors.push(`set ${idx + 1}: extended tiebreak must end by two`);
    }
    if (!needsTb && set.tiebreak) errors.push(`set ${idx + 1}: tiebreak recorded on a ${A}-${B} set`);
    won[w] += 1;
  });
  const need = setsToWin(format);
  let winner = won.A >= need ? 'A' : won.B >= need ? 'B' : null;
  if (!terminal && !winner) errors.push(`no side reached ${need} sets`);
  if (terminal && winner && ['retirement', 'default'].includes(parsed.end_reason)) errors.push(`${parsed.end_reason} recorded after the match was already decided`);
  if (parsed.end_reason === 'walkover' && parsed.sets.length) errors.push('walkover with games played (that is a retirement)');
  if (terminal) winner = null; // who won a terminated match is a source fact, not derivable from games
  return { ok: errors.length === 0, errors, winner, sets_won: won };
}

function isTiebreakSet(format, idx, set) {
  const mode = isFinalSet(format, idx) ? format.final_set.mode : 'tiebreak';
  if (mode === 'advantage') return false;
  const { A, B } = set.games;
  return Math.max(A, B) === tbAt(format, idx) + 1 && Math.min(A, B) === tbAt(format, idx);
}

/** Canonical display string, winner-agnostic (A-B as stored): "6-4 7-6(5) [10-8]". */
export function formatScore(sets, endReason = 'completed') {
  const parts = sets.map((set) => {
    if (set.is_match_tiebreak) return `[${set.tiebreak.A}-${set.tiebreak.B}]`;
    const base = `${set.games.A}-${set.games.B}`;
    if (!set.tiebreak) return base;
    return `${base}(${Math.min(set.tiebreak.A, set.tiebreak.B)})`;
  });
  const tail = { retirement: 'RET', walkover: 'W/O', default: 'DEF', abandoned: 'ABD' }[endReason];
  return [...parts, tail].filter(Boolean).join(' ');
}
