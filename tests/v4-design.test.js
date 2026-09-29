// Tennis V4 presentation helpers: surface accents from sourced surfaces only, newsroom plan with no duplicate sections,
// real previews only, and leaderboards only with a defined adequate population.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surfaceAccent, setPageSurface, newsPlan, previewPick, leaderBoard } from '../src/lib/v4.js';

test('surfaceAccent: hard / clay / grass from a sourced surface; anything else is neutral (never guessed)', () => {
  assert.deepEqual(surfaceAccent('Clay'), { key: 'clay', label: 'Clay court' });
  assert.equal(surfaceAccent('hard').key, 'hard');
  assert.equal(surfaceAccent('grass').label, 'Grass court');
  for (const x of [null, undefined, '', 'carpet', 'indoor']) assert.deepEqual(surfaceAccent(x), { key: 'neutral', label: null });
  const doc = { documentElement: { dataset: {} } };
  setPageSurface('grass', doc); assert.equal(doc.documentElement.dataset.surface, 'grass');
  setPageSurface(null, doc); assert.equal(doc.documentElement.dataset.surface, 'neutral');
});

test('newsPlan: every story exactly once across Latest / ATP rail / WTA rail / more; no rails on a single desk', () => {
  const s = (id, desk) => ({ id, desk });
  const rest = [s(1, 'wta'), s(2, 'atp'), s(3, 'wta'), s(4, 'doubles'), s(5, 'wta'), s(6, 'atp'), s(7, 'wta'), s(8, 'atp'), s(9, 'doubles'), s(10, 'wta'), s(11, 'wta'), s(12, 'wta'), s(13, 'wta'), s(14, 'atp')];
  const p = newsPlan(rest, { latest: 5, rail: 4 });
  const ids = [...p.latest, ...p.atp, ...p.wta, ...p.more].map((x) => x.id).sort((a, b) => a - b);
  assert.deepEqual(ids, rest.map((x) => x.id), 'nothing dropped, nothing duplicated');
  assert.deepEqual(p.latest.map((x) => x.id), [1, 2, 3, 4, 5]);
  assert.ok(p.atp.every((x) => x.desk === 'atp') && p.atp.length === 3);
  assert.ok(p.wta.every((x) => x.desk === 'wta') && p.wta.length === 4);
  const d = newsPlan(rest, { desk: 'atp' });
  assert.equal(d.latest.length, rest.length); assert.equal(d.atp.length + d.wta.length + d.more.length, 0);
});

test('previewPick: real scheduled matchups only, soonest first, one per pair, bounded', () => {
  const now = Date.parse('2026-09-29T20:00:00Z');
  const m = (id, at, a, b) => ({ match: { id, scheduled_at: at, sides: { A: { participant_key: a }, B: { participant_key: b } } } });
  const got = previewPick([m('late', '2026-10-01T02:00:00Z', 'x', 'y'), m('soon', '2026-09-30T02:00:00Z', 'a', 'b'), m('dup', '2026-10-02T02:00:00Z', 'b', 'a'), m('past', '2026-09-28T02:00:00Z', 'c', 'd'), { match: { id: 'no-time' } }], { now, limit: 4 });
  assert.deepEqual(got.map((x) => x.match.id), ['soon', 'late']);
  assert.deepEqual(previewPick([], { now }), []);
});

test('leaderBoard: shown only with a defined population at or above the gate; held tours say so', () => {
  const wta = leaderBoard({ qualified: 466, rows: [{ player: { name: 'Elena Rybakina' }, value: 0.8169 }], as_of: '2026-09-29' }, { tour: 'wta' });
  assert.equal(wta.show, true); assert.match(wta.note, /466 qualified, as of 2026-09-29/); assert.match(wta.note, /never pooled/);
  const atp = leaderBoard({ published: false, qualified: 17, threshold: 30, rows: [] }, { tour: 'atp' });
  assert.equal(atp.show, false); assert.equal(atp.note, 'ATP comparison building: 17 of 30 players meet the comparison standard.');
  assert.equal(leaderBoard({ qualified: 12, threshold: 30, rows: [{}] }, { tour: 'atp' }).show, false, 'below the gate even when rows came back');
  assert.equal(leaderBoard(null, { tour: 'wta' }).show, false);
  const r = leaderBoard({ published: true, qualified: 261, threshold: 30, definition: 'PBE Rating (chronological Elo, method v1) among players with 20+ rated matches and a match in the last 365 days', rows: [{}] }, { tour: 'atp' });
  assert.match(r.note, /^ATP singles players with 20\+ rated matches and a match in the last 365 days \(261 qualified\)/, 'the board states its own population rule');
});
