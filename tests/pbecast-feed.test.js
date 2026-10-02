// PBEcast point feed (src/lib/pbecast-feed.js): every stored event is its own row; a player is credited only for a
// proven single point; wider changes are never reconstructed; reasons / speeds / coordinates only from source point
// events; replay walks the stored events exactly. Real stored observations: tests/fixtures/pbecast/observed-adana-*.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pointFeed, feedByGame, singlePointWinner, gameSituation, situationOf, situationLabel } from '../src/lib/pbecast-feed.js';
import { initialState, step, seek } from '../src/lib/pbecast-player.js';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/pbecast/observed-adana-2026-10-02.json', import.meta.url), 'utf8'));
const nameOf = (m) => (s) => (m.players?.[s] || []).map((p) => p.last_name || p.name).join('/');
const feedOf = (x, opts = {}) => pointFeed(x.events, x.match, { name: nameOf(x.match), ...opts });

// a synthetic observed snapshot in the stored shape
let seq = 0;
const snap = (fromG, fromP, toG, toP, server = 'A', extra = {}) => {
  seq += 1;
  const sets = toG.split(' ').map((g) => { const [A, B] = g.split('-').map(Number); return { A, B, tb: null, mtb: false }; });
  const [pA, pB] = toP ? toP.split('–') : [null, null];
  return { event_id: `e${seq}`, quality: 'score_snapshot', event_sequence: seq, event_type: 'score_update', observed_at: new Date(Date.UTC(2026, 9, 2, 18, 0, seq)).toISOString(), set_number: sets.length, server_side: server, winner_side: null, event_detail: { from: { games: fromG, point: fromP, server }, to: { games: toG, point: toP, server } }, state: { sets, point: toP ? { A: pA, B: pB } : null, server, status: 'in_progress' }, ...extra };
};
const M = { format: 'BO3_TB7', players: { A: [{ last_name: 'Ruzic' }], B: [{ last_name: 'Kostovic' }] } };
const nm = nameOf(M);

test('single legal point transitions are credited: 0→15, 15→30, 30→40, deuce, advantage, advantage→deuce, tiebreak +1', () => {
  assert.equal(singlePointWinner('0–0', '15–0'), 'A');
  assert.equal(singlePointWinner('15–0', '30–0'), 'A');
  assert.equal(singlePointWinner('30–15', '30–30'), 'B');
  assert.equal(singlePointWinner('30–30', '40–30'), 'A');
  assert.equal(singlePointWinner('30–40', '40–40'), 'A', 'to deuce');
  assert.equal(singlePointWinner('40–40', 'Av–40'), 'A', 'deuce -> advantage');
  assert.equal(singlePointWinner('40–Av', '40–40'), 'A', 'advantage lost -> deuce');
  assert.equal(singlePointWinner('Av–40', '40–40'), 'B');
  assert.equal(singlePointWinner('3–1', '4–1', { tiebreak: true }), 'A');
  assert.equal(singlePointWinner('6–6', '6–7', { tiebreak: true }), 'B');
});

test('multi-point jumps and non-changes are NEVER credited (no reconstruction)', () => {
  for (const [a, b] of [['0–0', '40–30'], ['15–0', '30–15'], ['15–15', '30–30'], ['40–15', '40–40'], ['30–40', '40–Av'], ['0–0', '0–0'], ['40–40', '40–40']]) assert.equal(singlePointWinner(a, b), null, `${a} -> ${b}`);
  assert.equal(singlePointWinner('4–2', '4–4', { tiebreak: true }), null);
  assert.equal(singlePointWinner('6–7', '6–9', { tiebreak: true }), null);
  const f = pointFeed([snap('2-2', '0–0', '2-2', '40–30')], M, { name: nm });
  assert.equal(f[0].kind, 'jump');
  assert.equal(f[0].winner, undefined);
  assert.equal(f[0].who, undefined);
  assert.equal(f[0].line, 'Score advanced 0–0 → 40–30 between observations');
  assert.equal(f[0].provenance, 'observed', 'a jump is an observation, not a derived point');
});

test('unique one-point transition is described (derived, not a source point event) with the right wording', () => {
  const f = pointFeed([snap('2-2', '0–0', '2-2', '15–0'), snap('2-2', '15–0', '2-2', '15–15'), snap('2-2', '15–15', '2-2', '30–15'), snap('2-2', '30–15', '2-2', '40–15'), snap('2-2', '40–15', '2-2', '40–30', 'A')], M, { name: nm });
  assert.deepEqual(f.map((x) => x.kind), ['point', 'point', 'point', 'point', 'point']);
  assert.deepEqual(f.map((x) => x.line), ['Ruzic wins the point', 'Kostovic levels', 'Ruzic wins the point', 'Ruzic wins the point', 'Kostovic saves game point']);
  assert.ok(f.every((x) => x.provenance === 'derived'));
  assert.equal(situationLabel(f[3].sit, nm), 'GAME POINT · Ruzic');
  assert.ok(!f.some((x) => x.provenance === 'source'), 'observations never become source point events');
});

test('situations: game point, break point, deuce, advantage, set point and match point (engine) on observed states', () => {
  assert.deepEqual(gameSituation('40–15', 'A'), { kind: 'game_point', side: 'A' });
  assert.deepEqual(gameSituation('15–40', 'A'), { kind: 'break_point', side: 'B' });
  assert.deepEqual(gameSituation('40–40', 'A'), { kind: 'deuce' });
  assert.equal(gameSituation('40–Av', 'A').kind, 'break_point');
  const sp = situationOf({ status: 'in_progress', server: 'A', sets: [{ A: 5, B: 3 }], point: { A: '40', B: '0' } }, 'BO3_TB7');
  assert.deepEqual(sp, { kind: 'set_point', side: 'A' });
  const mp = situationOf({ status: 'in_progress', server: 'A', sets: [{ A: 6, B: 3 }, { A: 5, B: 4 }], point: { A: '40', B: '30' } }, 'BO3_TB7');
  assert.deepEqual(mp, { kind: 'match_point', side: 'A' }, 'serving for the match at 40-30');
  assert.equal(situationLabel(mp, nm), 'MATCH POINT · Ruzic');
  const gp = situationOf({ status: 'in_progress', server: 'B', sets: [{ A: 6, B: 3 }, { A: 4, B: 4 }], point: { A: '30', B: '40' } }, 'BO3_TB7');
  assert.deepEqual(gp, { kind: 'game_point', side: 'B' }, 'server at 40-30 mid-set: game point, not set/match point');
});

test('real stored WTA observations (Adana singles): holds, breaks, set, saved break point, jumps — every event its own row', () => {
  const f = feedOf(FX.singles);
  assert.equal(f.length, FX.singles.events.length, 'one row per stored event (no observed ×N collapsing)');
  const kinds = new Set(f.map((x) => x.kind));
  for (const k of ['point', 'jump', 'hold', 'break', 'set']) assert.ok(kinds.has(k), `has ${k}`);
  const brk = f.find((x) => x.kind === 'break' && x.event_id === 'evt_45ac14a2ec3b94d543d6');
  if (brk) assert.match(brk.line, /\(game completed between observations\)$/, '30-15 -> game: the deciding points were not observed');
  assert.ok(f.some((x) => /saves break point/.test(x.line)), 'a saved break point is provable from consecutive observations');
  for (const x of f.filter((y) => y.kind === 'jump')) { assert.equal(x.winner, undefined); assert.match(x.line, /between observations/); }
  const g = feedByGame(f);
  assert.equal(g.reduce((n, x) => n + x.items.length, 0), f.length, 'grouping never drops a row');
  assert.ok(g[0].items[0].idx > g[0].items.at(-1).idx, 'newest first');
});

test('real stored WTA observations (Adana doubles): match tiebreak, set point, match point, final; plural pair verbs', () => {
  const f = feedOf(FX.doubles);
  assert.ok(f.some((x) => x.kind === 'tiebreak'));
  assert.ok(f.some((x) => x.sit?.kind === 'set_point'));
  assert.ok(f.some((x) => x.sit?.kind === 'match_point'));
  assert.equal(f.at(-1).kind, 'match');
  assert.ok(f.some((x) => /^Falkowska\/Smith (win|hold|save|level|break)\b/.test(x.line)), 'a doubles pair takes plural verbs');
  assert.ok(!f.some((x) => /^Falkowska\/Smith (wins|holds|saves|levels|breaks)\b/.test(x.line)));
  const tbJump = f.find((x) => x.kind === 'jump' && x.from === '4–2' && x.to === '4–4');
  assert.ok(tbJump, 'match tiebreak 4-2 -> 4-4 stays a jump (two unseen points)');
});

test('reasons / speeds / rally / coordinates never appear without source point_event fields', () => {
  const all = [...feedOf(FX.singles), ...feedOf(FX.doubles)];
  const words = /\b(ace|double fault|winner\b|unforced|forced error|km\/h|mph|rally|shot|serve speed|coordinates?)\b/i;
  for (const x of all) assert.doesNotMatch(x.line || '', words, x.line);
  assert.ok(all.every((x) => x.reason === undefined && x.speed === undefined && x.rally === undefined));
  // a genuine source point event keeps its own fields and is labelled source
  const pe = pointFeed([{ event_id: 'p1', quality: 'point_event', event_type: 'ace', winner_side: 'A', serve_speed_kmh: 191, rally_length: 1, state: { sets: [{ A: 1, B: 0 }], point: { A: '15', B: '0' }, server: 'A', status: 'in_progress' } }], M, { name: nm })[0];
  assert.deepEqual([pe.kind, pe.provenance, pe.reason, pe.speed, pe.rally], ['point_event', 'source', 'ace', 191, 1]);
});

test('replay walks the stored events exactly: Prev/Next move one stored event; the feed at pos ends at that event', () => {
  const evs = FX.singles.events;
  let ps = initialState({ live: false, count: evs.length, deepLinkIndex: 0 });
  const seen = [];
  for (let i = 0; i < evs.length; i += 1) {
    const f = pointFeed(evs, FX.singles.match, { upto: ps.pos, name: nameOf(FX.singles.match) });
    assert.equal(f.length, ps.pos + 1);
    assert.equal(f.at(-1).event_id, evs[ps.pos].event_id);
    seen.push(f.at(-1).event_id);
    ps = step(ps, 1, evs.length);
  }
  assert.deepEqual(seen, evs.map((e) => e.event_id), 'every stored event visited once, in order, none generated');
  ps = step(ps, -1, evs.length);
  assert.equal(ps.pos, evs.length - 2);
  assert.equal(seek(ps, 3, evs.length).pos, 3);
  assert.deepEqual(pointFeed(evs, FX.singles.match, { upto: 3 }).map((x) => x.event_id), evs.slice(0, 4).map((e) => e.event_id), 'deterministic');
});
