// PBEcast POINT FEED — PURE (tests/pbecast-feed.test.js). Turns the stored PBEcast events into a tennis-native,
// chronological play-by-play WITHOUT inventing anything:
//   * every stored event is its own row (no "observed ×N" collapsing);
//   * an observed score change is credited to a player ONLY when the two consecutive observations differ by exactly
//     one legal point inside the same game (15-0 -> 30-0, deuce -> advantage, advantage -> deuce, tiebreak +1);
//   * anything wider is "Score advanced X → Y between observations" — the unseen sequence is never reconstructed;
//   * situations (game / break / set / match point, deuce, advantage, tiebreak) describe the observed state AFTER the
//     row, from point arithmetic and the canonical scoring engine (courtSituation);
//   * point reasons, serve speed, rally length and coordinates come ONLY from source point_event rows.
// Observed rows stay provenance 'observed' (derived from score transitions); they are never relabelled as source
// point events. The events array is never modified.

import { courtSituation } from './pbecast-state.js';

const PT = { 0: 0, 15: 1, 30: 2, 40: 3 };
const ADV = /^(AD|AV|A)$/i;
const SNAP = new Set(['score_update', 'match_start', 'observation_start', 'tiebreak']);
const GAME = new Set(['game_won', 'break']);

/** "30–15" | {A,B} -> {A,B} raw labels, or null. */
export function splitPoint(p) {
  if (!p) return null;
  if (typeof p === 'object') return p.A == null || p.B == null ? null : { A: String(p.A), B: String(p.B) };
  const m = String(p).split(/[–-]/);
  return m.length === 2 ? { A: m[0].trim(), B: m[1].trim() } : null;
}
const isNum = (x) => /^\d+$/.test(String(x));
/** A tiebreak score is two plain integers that are not both standard game labels (0/15/30/40). */
export function isTiebreakPoint(p) {
  const s = splitPoint(p);
  if (!s || !isNum(s.A) || !isNum(s.B)) return false;
  return !(PT[s.A] != null && PT[s.B] != null); // "15–15" / "0–0" read as game scores; "4–2", "6–10" as tiebreak
}
/** Normal-game point counts: Av -> 4 vs 3. null when the labels are not a game score. */
function counts(p) {
  const s = splitPoint(p);
  if (!s) return null;
  if (ADV.test(s.A)) return { A: 4, B: 3 };
  if (ADV.test(s.B)) return { A: 3, B: 4 };
  return PT[s.A] != null && PT[s.B] != null ? { A: PT[s.A], B: PT[s.B] } : null;
}
const other = (s) => (s === 'A' ? 'B' : 'A');
/** The state after side `w` wins one point in a normal game: {A,B} counts or 'game'. */
function winPoint(c, w) {
  const o = other(w);
  if (c[w] >= 3 && c[w] > c[o]) return 'game';
  if (c[o] === 4) return { ...c, [o]: 3 }; // advantage lost -> deuce
  return { ...c, [w]: c[w] + 1 };
}
const same = (a, b) => a && b && a !== 'game' && b !== 'game' && a.A === b.A && a.B === b.B;

/**
 * Who won the single point between two observed scores in the SAME game, or null when it is not exactly one legal
 * point (no change, several points, a different game, unparseable). tiebreak = numeric tiebreak scoring.
 */
export function singlePointWinner(fromP, toP, { tiebreak = false } = {}) {
  if (tiebreak) {
    const a = splitPoint(fromP);
    const b = splitPoint(toP);
    if (!a || !b || ![a.A, a.B, b.A, b.B].every(isNum)) return null;
    const dA = Number(b.A) - Number(a.A);
    const dB = Number(b.B) - Number(a.B);
    if (dA === 1 && dB === 0) return 'A';
    if (dA === 0 && dB === 1) return 'B';
    return null;
  }
  const a = counts(fromP);
  const b = counts(toP);
  if (!a || !b) return null;
  if (same(winPoint(a, 'A'), b)) return 'A';
  if (same(winPoint(a, 'B'), b)) return 'B';
  return null;
}

/** Normal-game situation of a point score with a known server: game point / break point / deuce / advantage. */
export function gameSituation(p, server) {
  const c = counts(p);
  if (!c || !['A', 'B'].includes(server)) return null;
  if (c.A === 3 && c.B === 3) return { kind: 'deuce' };
  if (c.A === 4 || c.B === 4) {
    const side = c.A === 4 ? 'A' : 'B';
    return { kind: side === server ? 'game_point' : 'break_point', side, advantage: true };
  }
  for (const side of ['A', 'B']) if (c[side] === 3 && c[other(side)] < 3) return { kind: side === server ? 'game_point' : 'break_point', side };
  return null;
}

const gamesOf = (str) => String(str || '').trim().split(/\s+/).filter(Boolean).map((x) => { const [A, B] = x.split('-').map(Number); return { A, B }; });

/**
 * The situation for the NEXT point of an observed state, strongest first: MATCH POINT > SET POINT > BREAK POINT >
 * GAME POINT > ADVANTAGE > DEUCE > TIEBREAK. Set / match point come from the canonical engine (needs the format);
 * game / break point / deuce / advantage from point arithmetic. null when nothing applies or the state is unknown.
 */
export function situationOf(state, formatKey) {
  if (!state || state.status !== 'in_progress' || !state.point) return null;
  const sit = (() => { try { return courtSituation(state, formatKey); } catch { return null; } })();
  if (sit?.match_point?.length) return { kind: 'match_point', side: sit.match_point[0] };
  if (sit?.set_point?.length) return { kind: 'set_point', side: sit.set_point[0] };
  const tb = isTiebreakPoint(state.point) || sit?.tiebreak;
  if (tb) return { kind: sit?.match_tiebreak ? 'match_tiebreak' : 'tiebreak' };
  const g = gameSituation(state.point, state.server);
  if (!g) return null;
  if (g.kind === 'break_point' || g.kind === 'game_point') return g.advantage ? { kind: 'advantage', side: g.side, also: g.kind } : g;
  return g;
}

/** Display label for a situation ("BREAK POINT · Ruzic"). */
export function situationLabel(sit, name = (s) => s) {
  if (!sit) return null;
  switch (sit.kind) {
    case 'match_point': return `MATCH POINT · ${name(sit.side)}`;
    case 'set_point': return `SET POINT · ${name(sit.side)}`;
    case 'break_point': return `BREAK POINT · ${name(sit.side)}`;
    case 'game_point': return `GAME POINT · ${name(sit.side)}`;
    case 'advantage': return `ADVANTAGE ${name(sit.side).toUpperCase()}${sit.also === 'break_point' ? ' · BREAK POINT' : ''}`;
    case 'deuce': return 'DEUCE';
    case 'match_tiebreak': return 'MATCH TIEBREAK';
    case 'tiebreak': return 'TIEBREAK';
    default: return null;
  }
}

const RANK = { match_point: 6, set_point: 5, break_point: 4, game_point: 3, advantage: 3, deuce: 2, match_tiebreak: 1, tiebreak: 1 };
const fmtP = (p) => { const s = splitPoint(p); return s ? `${s.A}–${s.B}` : ''; };

/**
 * The feed: one item per stored event in events[0..upto], OLDEST first (callers reverse for newest-first display).
 * item = { idx, event_id, kind, time, set, game, server, from, to, games, winner, who, line, sit, major, provenance }
 *   kind: start | point | jump | hold | break | game | set | tiebreak | match | suspended | resumed | point_event | other
 *   provenance: 'source' (point_event) | 'derived' (exactly one point / game proven between observations) | 'observed'
 */
export function pointFeed(events, match, { upto = Infinity, name = (s) => s } = {}) {
  const evs = (events || []).slice(0, Number.isFinite(upto) ? Math.max(0, upto) + 1 : undefined);
  const fmt = match?.format;
  const PLURAL = { wins: 'win', levels: 'level', saves: 'save', breaks: 'break', holds: 'hold', leads: 'lead' };
  const v = (side, verb) => (String(name(side)).includes('/') ? PLURAL[verb] || verb : verb); // doubles pair: plural
  return evs.map((e, idx) => {
    const d = e.event_detail || {};
    const st = e.state || null;
    const sets = st?.sets || [];
    const time = e.event_at || e.observed_at || null;
    const base = { idx, event_id: e.event_id, time, set: e.set_number || sets.length || null, server: st?.server || e.server_side || null, games: sets.length ? sets.map((x) => `${x.A}-${x.B}`).join(' ') : (d.to?.games || ''), provenance: 'observed' };
    const sit = situationOf(st, fmt);
    const after = (x) => { const sx = 'sit' in x ? x.sit : sit; return { ...base, ...x, sit: sx, major: Boolean(x.major) || Boolean(sx && RANK[sx.kind] >= 4) }; };
    if (e.quality === 'point_event') {
      return after({ kind: 'point_event', winner: e.winner_side || null, who: e.winner_side ? name(e.winner_side) : null, to: fmtP(st?.point), provenance: 'source', reason: e.event_type, speed: e.serve_speed_kmh ?? null, rally: e.rally_length ?? null, major: false });
    }
    const fromP = d.from?.point || null;
    const toP = d.to?.point || null;
    const fromGames = gamesOf(d.from?.games);
    const cur = fromGames.at(-1);
    const game = d.game_won?.game || (cur ? cur.A + cur.B + 1 : null);
    if (GAME.has(e.event_type) && d.game_won?.winner) {
      const g = d.game_won;
      const w = g.winner;
      const lastSet = gamesOf(d.to?.games).at(-1);
      // the deciding point is provable only when the earlier observation was game point for the winner
      const c = counts(fromP);
      const oneShot = c && winPoint(c, w) === 'game';
      const lead = lastSet ? (lastSet.A === lastSet.B ? `${lastSet.A}–${lastSet.B}` : `${name(lastSet.A > lastSet.B ? 'A' : 'B')} ${v(lastSet.A > lastSet.B ? 'A' : 'B', 'leads')} ${Math.max(lastSet.A, lastSet.B)}–${Math.min(lastSet.A, lastSet.B)}`) : '';
      const verb = g.result === 'break' ? v(w, 'breaks') : g.result === 'hold' ? v(w, 'holds') : `${v(w, 'wins')} the game`;
      return after({ kind: g.result === 'break' ? 'break' : g.result === 'hold' ? 'hold' : 'game', set: g.set, game: g.game, server: g.server, winner: w, who: name(w), from: fmtP(fromP), to: fmtP(toP), line: `${name(w)} ${verb}${lead ? ` · ${lead}` : ''}${oneShot ? '' : ' (game completed between observations)'}`, provenance: 'derived', major: g.result === 'break' });
    }
    if (e.event_type === 'set_won') {
      const sw = d.sets_won?.at(-1);
      const w = e.winner_side;
      return after({ kind: 'set', winner: w, who: w ? name(w) : null, game, from: fmtP(fromP), to: fmtP(toP), set: sw?.set || base.set, line: w ? `${name(w)} ${v(w, 'wins')} set ${sw?.set || base.set}${sw?.score ? ` ${sw.score}` : ''}` : 'Set complete', provenance: 'derived', major: true, sit: null });
    }
    if (e.event_type === 'match_end' || e.event_type === 'retired' || e.event_type === 'walkover') {
      return after({ kind: 'match', sit: null, game, line: e.event_type === 'retired' ? 'Retirement — match over' : e.event_type === 'walkover' ? 'Walkover' : `Match complete${d.to?.games ? ` · ${d.to.games}` : ''}`, major: true });
    }
    if (e.event_type === 'suspended' || e.event_type === 'resumed') return after({ kind: e.event_type, line: e.event_type === 'suspended' ? 'Play suspended' : 'Play resumed' });
    if (e.event_type === 'match_start' || e.event_type === 'observation_start') {
      return after({ kind: 'start', game, to: fmtP(toP), line: `${e.event_type === 'match_start' ? 'Match under way' : 'First observation'}${d.to?.games ? ` · ${d.to.games}` : ''}${toP ? ` · ${fmtP(toP)}` : ''}${base.server ? ` · ${name(base.server)} serving` : ''}` });
    }
    if (SNAP.has(e.event_type)) {
      const sameGame = d.from?.games != null && d.from.games === d.to?.games;
      const tb = isTiebreakPoint(toP) && (!fromP || isTiebreakPoint(fromP));
      const startTb = e.event_type === 'tiebreak' && !fromP;
      const w = sameGame && fromP && toP ? singlePointWinner(fromP, toP, { tiebreak: tb }) : null;
      if (startTb) return after({ kind: 'tiebreak', game, to: fmtP(toP), line: `Tiebreak under way${toP ? ` · ${fmtP(toP)}` : ''}`, major: true });
      if (w) {
        const prevSit = situationOf({ ...(st || {}), point: splitPoint(fromP), server: d.from?.server || base.server, status: 'in_progress' }, fmt);
        const saved = prevSit && prevSit.side && prevSit.side !== w && ['game_point', 'break_point', 'set_point', 'match_point', 'advantage'].includes(prevSit.kind)
          ? (prevSit.kind === 'advantage' ? (prevSit.also === 'break_point' ? 'break point' : 'game point') : prevSit.kind.replace('_', ' ')) : null;
        const to = counts(toP);
        const level = tb ? (() => { const s = splitPoint(toP); return s && s.A === s.B; })() : to && to.A === to.B;
        // the score after the point is its own column (item.to); the sentence says who and what it meant
        const line = saved ? `${name(w)} ${v(w, 'saves')} ${saved}`
          : sit?.kind === 'deuce' ? `${name(w)} ${v(w, 'wins')} the point · ${counts(fromP)?.A === 4 || counts(fromP)?.B === 4 ? 'back to deuce' : 'deuce'}`
            : level ? `${name(w)} ${v(w, 'levels')}`
              : `${name(w)} ${v(w, 'wins')} the point`;
        return after({ kind: 'point', game, winner: w, who: name(w), from: fmtP(fromP), to: fmtP(toP), line, provenance: 'derived', saved: Boolean(saved), major: Boolean(saved) && /break|set|match/.test(saved) });
      }
      if (fromP && toP && fmtP(fromP) !== fmtP(toP)) {
        return after({ kind: 'jump', game, from: fmtP(fromP), to: fmtP(toP), line: `Score advanced ${fmtP(fromP)} → ${fmtP(toP)} between observations${sameGame ? '' : ` · ${d.from?.games || ''} → ${d.to?.games || ''}`}` });
      }
      return after({ kind: 'other', game, to: fmtP(toP), line: `Observed ${d.to?.games || ''}${toP ? ` · ${fmtP(toP)}` : ''}`.trim() });
    }
    return after({ kind: 'other', game, line: e.event_type });
  });
}

/**
 * Feed grouped by game, NEWEST game first, rows newest first inside each game. A game key is set+game; rows with no
 * game (start, set, match) attach to the game they close / open. -> [{ key, set, game, server, result, items }]
 */
export function feedByGame(items) {
  const groups = [];
  for (const it of items) {
    const key = `${it.set ?? '?'}:${it.game ?? '?'}`;
    let g = groups.at(-1);
    const closes = ['set', 'match'].includes(it.kind) && g;
    if (!g || (g.key !== key && !closes)) { g = { key, set: it.set, game: it.game, server: it.server, result: null, items: [] }; groups.push(g); }
    if (['hold', 'break', 'game'].includes(it.kind)) { g.result = it.kind; g.winner = it.winner; g.server = it.server || g.server; }
    if (!g.server && it.server) g.server = it.server;
    g.items.push(it);
  }
  return groups.reverse().map((g) => ({ ...g, items: g.items.slice().reverse() }));
}
