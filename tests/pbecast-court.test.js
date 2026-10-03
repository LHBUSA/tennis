// PBEcast Phase 2 — event-driven live court (src/lib/pbecast-court.js), proven on REAL archived official-feed
// observations (tests/fixtures/wta/live-observations-2026-10-03.json) replayed through the live writer's own chain.
// docs/PBECAST_LIVE_CAPABILITY_AUDIT.md: no live source carries spatial data, WTA = point level, ATP = game level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayMatch, LIVE_FIX } from './helpers/live-replay.js';
import { gameLedger, ledgerTotals, courtReaction, liveGranularity, provenPoints, pointRun, gameRun, actionRail, currentGame, staleness, hasSpatial, SPATIAL_FIELDS } from '../src/lib/pbecast-court.js';
import { courtSvg } from '../src/ui/court.js';
import { diffSnapshots } from '../workers/shared/canonical/events.js';

const KEYS = Object.keys(LIVE_FIX.matches);
const SINGLES = KEYS.filter((k) => /:LS/.test(k));
const DOUBLES = KEYS.filter((k) => /:LD/.test(k));
const ctx = (r) => ({ match: { format: r.format, winner_side: r.final.winner_side }, granularity: 'point' });
const sets = (st) => (st?.sets || []).map((s) => [s.A, s.B]);

// independent oracle for "exactly one legal point" (deliberately NOT pbecast-feed.js)
const IDX = { 0: 0, 15: 1, 30: 2, 40: 3 };
function onePoint(prev, cur) {
  if (!prev?.point || !cur?.point || JSON.stringify(sets(prev)) !== JSON.stringify(sets(cur))) return null;
  const num = (p) => /^\d+$/.test(p.A) && /^\d+$/.test(p.B) && !(IDX[p.A] != null && IDX[p.B] != null);
  if (num(prev.point) && num(cur.point)) { // tiebreak counting
    const dA = Number(cur.point.A) - Number(prev.point.A); const dB = Number(cur.point.B) - Number(prev.point.B);
    return dA === 1 && dB === 0 ? 'A' : dA === 0 && dB === 1 ? 'B' : null;
  }
  const c = (p) => (/^A[vVdD]?$/.test(p.A) ? [4, 3] : /^A[vVdD]?$/.test(p.B) ? [3, 4] : IDX[p.A] != null && IDX[p.B] != null ? [IDX[p.A], IDX[p.B]] : null);
  const a = c(prev.point); const b = c(cur.point);
  if (!a || !b) return null;
  const win = (x, w) => { const o = 1 - w; if (x[o] === 4) return w === 0 ? [3, 3] : [3, 3]; const y = [...x]; y[w] += 1; return y; };
  for (const w of [0, 1]) { const y = win(a, w); if (y[0] === b[0] && y[1] === b[1] && !(y[w] >= 4 && y[w] - y[1 - w] >= 2)) return w === 0 ? 'A' : 'B'; }
  return null;
}
const POINTY = new Set(['point', 'bp_saved', 'advantage', 'deuce']);

test('1+5+6. every real fixture match replays through the live writer chain to its final score', () => {
  assert.equal(SINGLES.length, 3);
  assert.equal(DOUBLES.length, 1);
  for (const k of KEYS) {
    const r = replayMatch(k);
    assert.equal(r.final.status, 'completed', k);
    assert.ok(r.events.length > 90, `${k}: a full match of observations (${r.events.length})`);
    assert.equal(r.events[0].event_type, 'match_start', `${k} observed from its first point`);
    assert.equal(r.events.at(-1).event_type, 'match_end');
  }
});

test('2. completed-game history is complete: at EVERY observation the ledger accounts for every game in the score', () => {
  for (const k of KEYS) {
    const r = replayMatch(k);
    for (let i = 0; i < r.events.length; i += 1) {
      const want = sets(r.events[i].state);
      const got = ledgerTotals(gameLedger(r.events, i)).map((s) => [s.A, s.B]);
      while (got.length < want.length) got.push([0, 0]); // a new set at 0-0 has no game yet
      assert.deepEqual(got, want, `${k} at observation ${i}`);
    }
    const full = gameLedger(r.events);
    assert.deepEqual(ledgerTotals(full).map((s) => [s.A, s.B]), r.final.sets.map((s) => [s.games.A, s.games.B]), `${k} final`);
    // these matches were observed every game: every game has a proven winner, and hold/break whenever the server was seen
    assert.ok(full.every((g) => g.kind === 'game' && ['A', 'B'].includes(g.winner)), k);
    assert.ok(full.filter((g) => !g.tiebreak).every((g) => g.server && g.result), `${k}: every non-tiebreak game has its observed server`);
  }
});

test('2b. a real source correction (game taken back, then re-awarded) is retracted, never double-counted', () => {
  const r = replayMatch('1143:LD001');
  const L = gameLedger(r.events);
  assert.equal(L.corrections.length, 1);
  assert.deepEqual(L.corrections[0], { set: 2, side: 'B', idx: L.corrections[0].idx, at: L.corrections[0].at });
  assert.deepEqual(ledgerTotals(L)[1], { A: 6, B: 7 });
});

test('3. point events appear only where two consecutive observations establish exactly one point', () => {
  let proven = 0;
  for (const k of KEYS) {
    const r = replayMatch(k);
    r.events.forEach((e, i) => {
      const x = courtReaction(r.events, i, ctx(r));
      if (!x || !POINTY.has(x.kind)) return;
      proven += 1;
      assert.equal(onePoint(r.events[i - 1]?.state, e.state), x.side, `${k} #${i}: ${x.label} must be a single legal point won by ${x.side}`);
    });
    // and the converse: every exactly-one-point step IS shown as a proven point (nothing proven is dropped)
    r.events.forEach((e, i) => {
      if (i === 0 || e.event_type !== 'score_update') return;
      const w = onePoint(r.events[i - 1].state, e.state);
      if (w) assert.ok(POINTY.has(courtReaction(r.events, i, ctx(r))?.kind), `${k} #${i} proven point not shown`);
    });
  }
  assert.ok(proven > 100, `real proven points exercised (${proven})`);
});

test('4. a delayed / thinned feed never yields a point winner across a multi-point gap; games stay complete', () => {
  for (const k of KEYS) {
    const obs = LIVE_FIX.matches[k];
    // keep every 4th observation (plus the last): the same real states, seen far less often
    const thin = { ...LIVE_FIX, matches: { [k]: obs.filter((_, i) => i % 4 === 0 || i === obs.length - 1) } };
    const saved = LIVE_FIX.matches[k];
    LIVE_FIX.matches[k] = thin.matches[k];
    try {
      const r = replayMatch(k);
      let jumps = 0;
      r.events.forEach((e, i) => {
        const x = courtReaction(r.events, i, ctx(r));
        if (x?.kind === 'advance') jumps += 1;
        if (x && POINTY.has(x.kind)) assert.equal(onePoint(r.events[i - 1]?.state, e.state), x.side, `${k} thin #${i}`);
      });
      assert.ok(jumps > 0, `${k}: thinned feed shows score advances, not invented points`);
      const L = gameLedger(r.events);
      assert.deepEqual(ledgerTotals(L).map((s) => [s.A, s.B]), r.final.sets.map((s) => [s.games.A, s.games.B]), `${k} thin: still complete`);
      // games won between observations by both sides are spans (order unknown), never attributed one by one
      for (const g of L) if (g.kind === 'span') assert.ok(g.A > 0 && g.B > 0 && g.to - g.from + 1 === g.A + g.B);
      for (const g of L.filter((x) => x.between)) assert.equal(g.result, null, 'no hold/break without an observed server');
    } finally { LIVE_FIX.matches[k] = saved; }
  }
});

test('6. doubles: the server is a SIDE (team), proven points are credited to a side, never to one partner', () => {
  const r = replayMatch('1143:LD001');
  assert.equal(r.doubles, true);
  for (const e of r.events) if (e.state.server) assert.ok(['A', 'B'].includes(e.state.server));
  const pos = r.events.findIndex((e, i) => i > 0 && courtReaction(r.events, i, ctx(r))?.kind === 'point');
  const pts = provenPoints(r.events, pos, { format: r.format });
  assert.ok(pts.length >= 1 && pts.every((p) => ['A', 'B'].includes(p.winner)));
  const x = courtReaction(r.events, pos, { ...ctx(r), name: (s) => (s === 'A' ? 'Brooks / Rajecki' : 'Lansere / Shubladze') });
  assert.match(x.label, /^POINT · (BROOKS \/ RAJECKI|LANSERE \/ SHUBLADZE)$/);
});

test('7. deuce and advantage: real advantage states react as ADVANTAGE; points from deuce/advantage are proven only by single steps', () => {
  const kinds = new Set();
  let adv = 0;
  for (const k of KEYS) {
    const r = replayMatch(k);
    r.events.forEach((e, i) => { const x = courtReaction(r.events, i, ctx(r)); if (x) kinds.add(x.kind); if (x?.kind === 'advantage') { adv += 1; assert.match(x.label, /^ADVANTAGE · [AB]$/); } });
  }
  assert.ok(adv >= 5, `real advantage reactions (${adv})`);
  assert.ok(kinds.has('bp_saved'), 'saved game/break points from deuce and advantage states');
});

test('8. tiebreak and set transitions from real data: 7-6 tiebreak game, match tiebreak, SET reactions', () => {
  const tb = gameLedger(replayMatch('1020:LS040').events).filter((g) => g.tiebreak);
  assert.equal(tb.length, 1);
  assert.deepEqual([tb[0].set, tb[0].after, tb[0].set_end, tb[0].result], [1, { A: 7, B: 6 }, true, null], 'a tiebreak game has no hold/break');
  const d = replayMatch('1143:LD001');
  const mtb = gameLedger(d.events).filter((g) => g.tiebreak);
  assert.deepEqual(mtb.map((g) => g.set), [1, 2, 3], 'two set tiebreaks + the match tiebreak');
  for (const k of KEYS) {
    const r = replayMatch(k);
    const rx = r.events.map((_, i) => courtReaction(r.events, i, ctx(r))?.kind);
    assert.ok(rx.filter((x) => x === 'set').length >= 2, `${k}: set reactions`);
    assert.equal(rx.at(-1), 'match');
    // the action rail marks set boundaries
    const rail = actionRail(gameLedger(r.events), 40);
    assert.ok(rail.some((x) => x.new_set) && rail.some((x) => x.set_end));
  }
});

test('9. stale / no-new-observation: flagged after 3 min while live, never while final, never filled', () => {
  const now = Date.parse('2026-10-03T12:10:00Z');
  assert.deepEqual(staleness('2026-10-03T12:09:10Z', { now }), { stale: false, minutes: 0 });
  assert.deepEqual(staleness('2026-10-03T12:05:00Z', { now }), { stale: true, minutes: 5 });
  assert.deepEqual(staleness('2026-10-03T12:05:00Z', { now, live: false }), { stale: false, minutes: null });
  assert.deepEqual(staleness(null, { now }), { stale: false, minutes: null });
  // with no new observation the court keeps the last observed state: the reaction at the last position is unchanged
  const r = replayMatch('1020:LS046');
  const i = 40;
  assert.deepEqual(courtReaction(r.events, i, ctx(r)), courtReaction(r.events.slice(0, i + 1), i, ctx(r)));
});

test('game level (ATP): no point kinds, no server, no hold/break — the same real games without point state', () => {
  const r = replayMatch('1020:LS043');
  // what a game-level source gives: set/game scores only (point + server removed from the real states)
  // rebuilt through the writer's own diff, exactly as a game-level source's observations would be
  const evs = [];
  let prev = null;
  for (const e of r.events) {
    const next = { ...e.state, point: null, server: null };
    const d = diffSnapshots(prev, next, r.format);
    if (d) evs.push({ ...d, event_id: `g${evs.length}`, observed_at: e.observed_at, set_number: next.sets.length || null });
    prev = next;
  }
  assert.ok(evs.every((e) => !e.state.point && !e.state.server && !e.event_detail.from?.point));
  assert.equal(liveGranularity({ events: evs, match: { sets: [{ A: 1, B: 0 }] } }), 'game');
  assert.equal(liveGranularity({ live_granularity: 'game', events: r.events }), 'game', 'the API decides when it says so');
  const kinds = new Set(evs.map((_, i) => courtReaction(evs, i, { match: { format: r.format }, granularity: 'game' })?.kind));
  for (const k of ['point', 'bp_saved', 'advantage', 'deuce', 'server', 'hold', 'break']) assert.ok(!kinds.has(k), `game level never shows ${k}`);
  assert.ok(kinds.has('game') && kinds.has('set'));
  const L = gameLedger(evs);
  assert.deepEqual(ledgerTotals(L).map((s) => [s.A, s.B]), r.final.sets.map((s) => [s.games.A, s.games.B]));
  assert.ok(L.every((g) => g.server === null && g.result === null));
  assert.equal(provenPoints(evs, evs.length - 2, { format: r.format }).length, 0);
  const run = gameRun(L.slice(0, 6));
  if (run) assert.equal(run.break_hold, false, 'break + hold needs observed servers');
});

test('runs only from proven history: game runs stop at any span; point runs stop at any unproven step', () => {
  const r = replayMatch('1020:LS046');
  for (let i = 1; i < r.events.length; i += 1) {
    const pr = pointRun(r.events, i, { format: r.format });
    if (!pr) continue;
    for (let j = i - pr.points + 1; j <= i; j += 1) assert.equal(onePoint(r.events[j - 1].state, r.events[j].state), pr.side, `run at ${i} includes unproven #${j}`);
  }
  const L = gameLedger(r.events);
  assert.equal(gameRun([...L.slice(0, 5), { kind: 'span', set: 1, A: 1, B: 1 }]), null);
  assert.equal(currentGame({ status: 'completed', sets: [{ A: 6, B: 2 }] }), null);
});

test('NO SPATIAL DATA: nothing in the court state machine or court drawing is a position, path, speed or rally', () => {
  for (const k of KEYS) {
    const r = replayMatch(k);
    assert.equal(hasSpatial(r.events), false, `${k}: no live event carries coordinates`);
    const L = gameLedger(r.events);
    const outs = [L, ...r.events.map((_, i) => courtReaction(r.events, i, ctx(r))), provenPoints(r.events, 50, { format: r.format })];
    const keys = JSON.stringify(outs);
    for (const f of SPATIAL_FIELDS) assert.ok(!keys.includes(`"${f}"`), `${k}: ${f} never produced`);
    const st = r.events[60].state;
    const svg = String(courtSvg({ server: st.server, point: st.point, highlight: null, ball: null, trail: null, serveIndicator: true, pressure: 'A', react: { kind: 'point', side: 'B' }, lastGame: null }));
    assert.doesNotMatch(svg, /c-ball|c-trail|data-kind="tracked"/, 'no tracked ball or trail without source coordinates');
    assert.match(svg, /c-pressure/); assert.match(svg, /c-react k-point/);
  }
  // the page only passes a ball / trail when the event is a source point event WITH coordinates
  const page = readFileSync(new URL('../src/pages/pbecast.js', import.meta.url), 'utf8');
  assert.match(page, /ball: tracked \? cur\.coordinates : null/);
  assert.match(page, /trail: tracked \? cur\?\.trail \|\| null : null/);
  assert.equal(hasSpatial([{ quality: 'score_snapshot', coordinates: { x: 1, y: 2 } }]), false, 'an observation can never become tracking');
  assert.equal(hasSpatial([{ quality: 'point_event', coordinates: { x: 1, y: 2 } }]), true, 'a future verified source would');
});

test('public provenance: PBEcast and the live API copy name no upstream provider', () => {
  const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const UPSTREAM = /ESPN|wtatennis|ausopen|official WTA (?:live )?feed|WTA feed|Australian Open (?:feed|match cent)/i;
  const v2 = src('../workers/tennis-api/src/v2.js').split('\n').filter((l) => /cadence_note:/.test(l));
  assert.equal(v2.length, 1);
  const literals = (l) => [...l.matchAll(/'([^']{12,})'/g)].map((x) => x[1]); // the public copy, not the provenance check
  assert.ok(literals(v2[0]).length >= 3);
  for (const t of literals(v2[0])) assert.doesNotMatch(t, UPSTREAM);
  assert.match(v2[0], /about once a minute while live \(measured; occasionally twice\)/, 'the measured cadence copy is unchanged');
  const live = src('../workers/tennis-api/src/index.js').split('\n').find((l) => /point score \+ server where the live source/.test(l));
  assert.ok(live, '/v1/live semantics are source-neutral');
  for (const t of literals(live)) assert.doesNotMatch(t, UPSTREAM);
  for (const f of ['../src/pages/pbecast.js', '../src/lib/pbecast-court.js', '../src/ui/court.js', '../src/styles/pbecast-v5.css']) {
    const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, UPSTREAM, f);
  }
});
