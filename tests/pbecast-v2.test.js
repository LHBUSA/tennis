// PBEcast V2 truth tests (owner brief §16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courtSvg, serveCourt } from '../src/ui/court.js';
import { courtSituation, situationLine } from '../src/lib/pbecast-state.js';
import { diffSnapshots, normalizeStoredEvent, inTiebreakScore, aoPointEvents } from '../workers/shared/canonical/events.js';
import { assertNoRegression, startMatch, applyPoint } from '../workers/shared/canonical/scoring.js';

const svg = (m) => String(courtSvg(m));

test('observed mode: serve indicator ball, never a tracked ball; the two are different elements', () => {
  const s = svg({ server: 'A', point: { A: '15', B: '0' }, serveIndicator: true });
  assert.match(s, /class="c-srv c-serve-ball" data-kind="serve-indicator"/);
  assert.match(s, /<title>Serve indicator — not tracked position<\/title>/);
  assert.ok(!/class="c-ball"/.test(s), 'no tracked ball without coordinates');
  assert.ok(!/data-kind="tracked"/.test(s));
  assert.ok(!/c-trail/.test(s));
});

test('tracked mode: c-ball only from source coordinates; trail only from real coordinates', () => {
  const s = svg({ server: 'A', point: { A: '0', B: '0' }, ball: { x: 1.2, y: -3 }, trail: [{ x: 0, y: -11 }, { x: 1.2, y: -3 }], serveIndicator: true });
  assert.match(s, /data-kind="tracked"><title>Tracked position<\/title><circle class="c-ball"/);
  assert.match(s, /class="c-trail"/);
  assert.ok(!/class="c-ball"/.test(svg({ ball: { x: NaN, y: 2 } })), 'a malformed coordinate never draws');
  assert.ok(!/c-trail/.test(svg({ trail: [{ x: 1, y: 1 }] })), 'one point is not a trail');
});

test('break / set / match point come from the scoring engine', () => {
  const v = (sets, point, server) => ({ status: 'in_progress', sets, point, server });
  assert.equal(situationLine(courtSituation(v([{ A: 2, B: 3 }], { A: '30', B: '40' }, 'A'), 'BO3_TB7')).kind, 'break_point');
  assert.equal(situationLine(courtSituation(v([{ A: 5, B: 4 }], { A: '40', B: '15' }, 'A'), 'BO3_TB7')).kind, 'set_point');
  assert.equal(situationLine(courtSituation(v([{ A: 6, B: 3 }, { A: 5, B: 4 }], { A: '40', B: '0' }, 'A'), 'BO3_TB7')).kind, 'match_point');
  assert.equal(situationLine(courtSituation(v([{ A: 6, B: 6 }], { A: '6', B: '5' }, 'B'), 'BO3_TB7')).kind, 'set_point');
  assert.equal(situationLine(courtSituation(v([{ A: 4, B: 1 }], { A: 'Av', B: '40' }, 'B'), 'BO3_TB7')).kind, 'break_point', 'Av is advantage (WTA label)');
  assert.equal(courtSituation(v([{ A: 1, B: 1 }], { A: '40', B: '40' }, null), 'BO3_TB7'), null, 'no server -> nothing claimed');
  assert.equal(courtSituation({ status: 'completed', sets: [{ A: 6, B: 3 }], point: null, server: null }, 'BO3_TB7'), null);
});

test("'Av' is advantage, not a tiebreak: classifier fixed and stored events corrected on read", () => {
  assert.equal(inTiebreakScore({ A: 'Av', B: '40' }), false);
  assert.equal(inTiebreakScore({ A: '6', B: '5' }), true);
  assert.equal(serveCourt({ A: 'Av', B: '40' }, false), 'ad');
  const stored = { quality: 'score_snapshot', event_type: 'tiebreak', event_detail: { tiebreak_started: true, to: { point: 'Av–40' } }, state: { point: { A: 'Av', B: '40' } } };
  const fixed = normalizeStoredEvent(stored);
  assert.equal(fixed.event_type, 'score_update');
  assert.ok(!('tiebreak_started' in fixed.event_detail));
  assert.match(fixed.event_detail.reclassified, /corrected on read/);
  const real = { ...stored, state: { point: { A: '1', B: '0' } } };
  assert.equal(normalizeStoredEvent(real).event_type, 'tiebreak', 'a real tiebreak is untouched');
});

test('observed snapshots never become points; several points between observations are one SCORE UPDATE', () => {
  const prev = { status: 'in_progress', sets: [{ A: 2, B: 2 }], point: { A: '0', B: '0' }, server: 'A' };
  const next = { ...prev, point: { A: '40', B: '15' } };
  const e = diffSnapshots(prev, next, 'BO3_TB7');
  assert.equal(e.quality, 'score_snapshot');
  assert.equal(e.event_type, 'score_update');
  assert.equal(e.winner_side, null, 'no point winner is invented');
});

test('score regression is still rejected', () => {
  let s = startMatch('BO3_TB7', 'A');
  for (let i = 0; i < 4; i += 1) s = applyPoint(s, 'A');
  const back = startMatch('BO3_TB7', 'A');
  assert.throws(() => assertNoRegression(s, back));
});

test('AO point-by-point maps deterministically; live -> replay yields the exact same events', () => {
  // two games, server-first score strings, newest-first like the AO feed
  const c = [
    { id: 'X-001-002-004', type: 'game', set: 1, winner: 2, score: 'Game', games_score: '1 - 1', commentary: 'B. Two wins the point with an Ace', timestamp: 8 },
    { id: 'X-001-002-003', type: 'point', set: 1, winner: 2, score: '40 - 0', games_score: '1 - 0', commentary: 'B. Two wins the point with a Forehand Winner', timestamp: 7 },
    { id: 'X-001-002-002', type: 'point', set: 1, winner: 2, score: '30 - 0', games_score: '1 - 0', commentary: 'B. Two wins the point with an Ace', timestamp: 6 },
    { id: 'X-001-002-001', type: 'point', set: 1, winner: 2, score: '15 - 0', games_score: '1 - 0', commentary: 'B. Two wins the point with an Ace', timestamp: 5 },
    { id: 'X-001-002-000', type: 'serve', set: 1, winner: null, score: '', games_score: '1 - 0', commentary: 'B. Two is serving game 2', timestamp: 5 },
    { id: 'X-001-001-004', type: 'game', set: 1, winner: 1, score: 'Game', games_score: '1 - 0', commentary: 'A. One wins the point with an Ace', timestamp: 4 },
    { id: 'X-001-001-003', type: 'point', set: 1, winner: 1, score: '40 - 0', games_score: '0 - 0', commentary: 'A. One wins the point with a Backhand Winner', timestamp: 3 },
    { id: 'X-001-001-002', type: 'point', set: 1, winner: 1, score: '30 - 0', games_score: '0 - 0', commentary: 'A. One wins the point with an Ace', timestamp: 2 },
    { id: 'X-001-001-001', type: 'point', set: 1, winner: 1, score: '15 - 0', games_score: '0 - 0', commentary: 'A. One wins the point with an Ace', timestamp: 1 },
    { id: 'X-001-001-000', type: 'serve', set: 1, winner: null, score: '', games_score: '0 - 0', commentary: 'A. One is serving game 1', timestamp: 1 }
  ];
  const opts = { formatKey: 'BO3_TB7', sideOfTeam: (t) => (t === 1 ? 'A' : t === 2 ? 'B' : null), nameSide: (n) => (/one/i.test(n) ? 'A' : /two/i.test(n) ? 'B' : null), finalSets: null };
  const a = aoPointEvents(c, opts);
  const b = aoPointEvents(c.slice().reverse().reverse(), opts);
  assert.equal(a.length, 8, 'eight real points, nothing inserted');
  assert.deepEqual(a, b, 'deterministic');
  assert.deepEqual(a.map((e) => e.winner_side).join(''), 'AAAABBBB');
  assert.ok(a.every((e) => e.coordinates == null && e.serve_speed_kmh == null), 'no spatial data or speed invented');
});
