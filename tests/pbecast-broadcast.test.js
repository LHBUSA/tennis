// PBEcast Broadcast V4 derivations (src/lib/pbecast-broadcast.js): three data modes shown for what they are; no invented
// server, point score or points; break-point counts with their basis; navigation over real events only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dataMode, breakPressure, recentGames, setStarts, gameEnds, prevGame, nextGame, currentMoment } from '../src/lib/pbecast-broadcast.js';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/pbecast/observed-adana-2026-10-02.json', import.meta.url), 'utf8'));
// a real point-event stream shape (Australian Open feed): state BEFORE/AFTER, server, winner, source game marker
const pt = (i, srv, win, before, after, set = 1, extra = {}) => ({ event_id: `p${i}`, quality: 'point_event', event_type: 'winner', set_number: set, server_side: srv, winner_side: win, event_detail: { point_from_source: after === 'Game' ? 'Game' : after }, state: { status: 'in_progress', server: srv, sets: [{ A: 2, B: 2 }], point: after === 'Game' ? { A: '0', B: '0' } : { A: after.split('-')[0], B: after.split('-')[1] } }, ...extra });
const start = { event_id: 'p0', quality: 'point_event', event_type: 'winner', set_number: 1, server_side: 'A', winner_side: 'A', event_detail: {}, state: { status: 'in_progress', server: 'A', sets: [{ A: 2, B: 2 }], point: { A: '15', B: '40' } } };

test('data modes: point events / observed WTA score+server / ESPN snapshot (no events)', () => {
  assert.equal(dataMode({ quality: 'point_event', events: [start] }), 'point');
  assert.equal(dataMode({ quality: 'score_snapshot', events: FX.singles.events }), 'observed');
  assert.equal(dataMode({ quality: null, events: [] }), 'snapshot');
});

test('snapshot mode never shows a point score or a server, even if a state object carries one', () => {
  const m = currentMoment({ status: 'in_progress', sets: [{ A: 4, B: 3 }], point: { A: '30', B: '15' }, server: 'A' }, 'snapshot');
  assert.equal(m.point, null);
  assert.equal(m.server, null);
  assert.deepEqual([m.set, m.games], [1, { A: 4, B: 3 }]);
  assert.equal(breakPressure([], 0, { mode: 'snapshot' }), null);
});

test('point mode: break points are counted per point played at break point (state BEFORE the point)', () => {
  // A serves at 15-40 (double break point for B): B misses one (30-40), then converts
  const evs = [start, pt(1, 'A', 'A', '15-40', '30-40'), pt(2, 'A', 'B', '30-40', 'Game')];
  const p = breakPressure(evs, 2, { mode: 'point' });
  assert.deepEqual([p.chances.B, p.converted.B, p.faced.A, p.saved.A], [2, 1, 2, 1]);
  assert.equal(p.basis, 'points');
});

test('observed mode: break-point GAMES only, labelled; unseen break points are not claimed', () => {
  const p = breakPressure(FX.singles.events, FX.singles.events.length - 1, { mode: 'observed' });
  assert.equal(p.basis, 'observed_games');
  assert.match(p.note, /not seen/);
  assert.ok(p.chances.A + p.chances.B >= p.converted.A + p.converted.B + p.saved.A + p.saved.B);
});

test('recent games: point mode reads real game-ending points; observed mode only provable games', () => {
  const evs = [start, pt(1, 'A', 'B', '15-40', 'Game'), pt(2, 'B', 'B', '40-0', 'Game'), pt(3, 'A', 'A', '40-0', 'Game')];
  assert.deepEqual(recentGames(evs, 3, { mode: 'point' }), { window: 3, A: 1, B: 2, basis: 'games with a provable winner' });
  const o = recentGames(FX.singles.events, FX.singles.events.length - 1);
  assert.equal(o.basis, 'games with a provable winner');
});

test('navigation: set starts and game boundaries are real event indexes; prev/next game exact', () => {
  const evs = [start, pt(1, 'A', 'B', '15-40', 'Game'), pt(2, 'B', 'B', '15-0', '30-0'), pt(3, 'B', 'B', '30-0', 'Game', 2)];
  assert.deepEqual(gameEnds(evs), [1, 3]);
  assert.deepEqual(setStarts(evs), [{ set: 1, index: 0 }, { set: 2, index: 3 }]);
  assert.equal(nextGame(evs, 1), 3);
  assert.equal(prevGame(evs, 3), 1);
  assert.equal(nextGame(evs, 3), null);
  const obs = FX.singles.events;
  for (const i of gameEnds(obs)) assert.ok(['game_won', 'break', 'set_won', 'match_end'].includes(obs[i].event_type) || obs[i].event_detail?.game_won);
});
