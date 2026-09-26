// PBEcast V3 playback regressions (owner brief §21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, advance, seek, step, togglePlay, replayAgain, jumpToStart, pauseLive, returnToLive, liveArrivals, dwellMs, DEFAULT_SPEED } from '../src/lib/pbecast-player.js';

test('completed match: replay autoplays from event 0 and advances with no click', () => {
  let st = initialState({ live: false, count: 5 });
  assert.equal(st.pos, 0);
  assert.equal(st.playing, true, 'autoplay');
  st = advance(st, 5);
  assert.equal(st.pos, 1, 'advanced to event 1 on the first tick');
  assert.equal(st.speed, DEFAULT_SPEED);
});

test('deep-linked ?t= event is respected: no autoplay over the chosen position', () => {
  const st = initialState({ live: false, count: 9, deepLinkIndex: 6 });
  assert.equal(st.pos, 6);
  assert.equal(st.playing, false);
  assert.equal(advance(st, 9).pos, 6, 'a paused replay never advances');
});

test('scrub, previous and next pause the replay', () => {
  const st = initialState({ live: false, count: 9 });
  for (const s of [seek(st, 4, 9), step(st, 1, 9), step({ ...st, pos: 3 }, -1, 9)]) assert.equal(s.playing, false);
  assert.equal(step({ ...st, pos: 3 }, -1, 9).pos, 2);
});

test('completion stops at the final state (no loop); Replay again restarts; jump to start holds', () => {
  let st = initialState({ live: false, count: 3 });
  st = advance(st, 3);
  st = advance(st, 3);
  assert.equal(st.pos, 2);
  assert.equal(st.done, true);
  assert.equal(st.playing, false);
  assert.equal(advance(st, 3).pos, 2, 'stays on the final state');
  const again = replayAgain(st, 3);
  assert.deepEqual([again.pos, again.playing, again.done], [0, true, false]);
  const start = jumpToStart(st);
  assert.deepEqual([start.pos, start.playing], [0, false]);
  const replayFromEnd = togglePlay(st, 3);
  assert.deepEqual([replayFromEnd.pos, replayFromEnd.playing], [0, true], 'play at the end restarts');
});

test('live mode follows the latest event with nothing to press; new events queue in order', () => {
  const st = initialState({ live: true, count: 10 });
  assert.deepEqual([st.mode, st.pos, st.following, st.playing], ['live', 9, true, false]);
  const { queue } = liveArrivals(st, 10, 13);
  assert.deepEqual(queue, [10, 11, 12], 'each newly observed event is animated, oldest first');
});

test('paused live shows Return to Live; arrivals do not move a paused viewer; return snaps to latest', () => {
  let st = pauseLive(initialState({ live: true, count: 10 }));
  assert.equal(st.paused, true);
  st = seek(st, 4, 10);
  const r = liveArrivals(st, 10, 12);
  assert.deepEqual(r.queue, []);
  assert.equal(r.st.pos, 4, 'inspecting history is never interrupted');
  const back = returnToLive(r.st, 12);
  assert.deepEqual([back.pos, back.following, back.paused], [11, true, false]);
});

test('pacing is presentation-only and ordered by significance; speed scales it', () => {
  assert.ok(dwellMs('score_update', 1) < dwellMs('game_won', 1));
  assert.ok(dwellMs('game_won', 1) < dwellMs('break', 1));
  assert.ok(dwellMs('break', 1) < dwellMs('set_won', 1));
  assert.ok(dwellMs('set_won', 1) <= dwellMs('match_end', 1));
  assert.equal(dwellMs('break', 2), Math.round(dwellMs('break', 1) / 2));
});

test('point-by-point markers come from the score progression: set entry appearing is NOT a set end', async () => {
  const { pointMarker } = await import('../src/lib/pbecast-state.js');
  const S = (sets, status = 'in_progress') => ({ sets: sets.map(([A, B]) => ({ A, B, tb: null, mtb: false })), status });
  assert.equal(pointMarker(S([]), S([[1, 0]]), { server_side: 'A', winner_side: 'A' }), null, 'first game held: no marker');
  assert.equal(pointMarker(S([[4, 4]]), S([[4, 5]]), { server_side: 'A', winner_side: 'B' }), 'BREAK');
  assert.equal(pointMarker(S([[4, 5]]), S([[4, 6]]), { server_side: 'B', winner_side: 'B' }), 'SET');
  assert.equal(pointMarker(S([[4, 6]]), S([[4, 6], [1, 0]]), { server_side: 'A', winner_side: 'A' }), null, 'a new set entry appearing is the first game of the next set');
  assert.equal(pointMarker(S([[4, 6], [5, 4]]), S([[4, 6], [6, 4]]), { server_side: 'B', winner_side: 'A' }), 'SET', 'a set-ending break is a SET');
  assert.equal(pointMarker(S([[6, 4], [5, 4]]), S([[6, 4], [6, 4]], 'completed'), { server_side: 'A', winner_side: 'A' }), 'FINAL');
});
