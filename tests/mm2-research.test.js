// Matchup Model V2 research (scripts/research/mm2, workers/shared/research/mm2-profile.js): leakage, split and
// isolation guarantees. Synthetic ledgers through the PRODUCTION ledger/rating functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ledgerEntry, byOrder, rankIndex, ratingRun } from '../workers/shared/dna/match-dna.js';
import { buildRows, championAt } from '../scripts/research/mm2/lib/features.mjs';
import { fitLogistic, predict, walkForward, assertSameRows, pairedBootstrap, metrics } from '../scripts/research/mm2/lib/model.mjs';
import { profileFrom, featuresB, dayNum } from '../workers/shared/research/mm2-profile.js';
import { modelBlock } from '../workers/tennis-api/src/matchup.js';

const P = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const tourOf = (pid) => (pid.startsWith('p') ? 'WTA' : null);
const day = (n) => new Date(Date.UTC(2024, 0, 1) + n * 86400e3).toISOString().slice(0, 10);
let seq = 0;
function match(n, A, B, winner, { surface = 'hard', sets = null, status = 'completed', round = '1' } = {}) {
  seq += 1;
  const s = sets || (winner === 'A' ? [[6, 3], [4, 6], [7, 6]] : [[6, 4], [6, 7], [3, 6]]);
  return ledgerEntry({ match_id: `m${String(seq).padStart(4, '0')}`, event_type: 'WS', round, format_key: 'BO3', status, winner_side: winner, scheduled_at: `${day(n)}T12:00:00Z`, surface,
    packed: s.map(([a, b]) => a + 256 * b), A, B, edition: { year: 2024, start_date: day(n), end_date: day(n) } }, tourOf);
}
function ledger(extra = []) {
  seq = 0;
  const L = [];
  let n = 0;
  for (let r = 0; r < 4; r += 1) for (let i = 0; i < P.length; i += 1) for (let j = i + 1; j < P.length; j += 1) { n += 1; L.push(match(n, P[i], P[j], (i + j + r) % 3 ? 'A' : 'B', { surface: n % 5 === 0 ? null : 'hard' })); }
  L.push(...extra.map((f) => f(n)));
  L.sort(byOrder);
  L.forEach((e, i) => { e.seq = i; e.edition = `ed-${e.day}`; });
  return L;
}
const key = (r) => JSON.stringify(r);

test('future result insertion cannot change any historical feature row', () => {
  const base = buildRows('WTA', ledger()).rows;
  assert.ok(base.length > 10, 'synthetic ledger yields rows');
  const last = base.at(-1).day;
  const later = buildRows('WTA', ledger([(n) => match(n + 5, 'p1', 'p2', 'B'), (n) => match(n + 6, 'p3', 'p1', 'A')])).rows;
  const before = later.filter((r) => r.day <= last);
  assert.deepEqual(before.map(key), base.map(key));
});

test('a same-day later-round result never enters a feature row (strict day < match day)', () => {
  const L = ledger();
  const dn = dayNum(L.at(-1).day);
  const recs = [[dn - 3, 0, 1, 0.5, 1500, 0, 0, 0, 1, 1]];
  const p0 = profileFrom(recs, dn);
  const p1 = profileFrom([...recs, [dn, 0, 0, 0.9, 1800, 1, 1, 0, 0, 0]], dn);
  assert.deepEqual(p1, p0);
});

test('later ranking lists cannot leak backward (and the features read no ranking at all)', () => {
  const lists = [{ date: '2024-01-01', size: 3, ranks: new Map([['p1', 1], ['p2', 2]]) }];
  const at = rankIndex(lists);
  const at2 = rankIndex([...lists, { date: '2024-02-01', size: 3, ranks: new Map([['p1', 3], ['p2', 1]]) }]);
  assert.deepEqual(at2('p1', '2024-01-20'), at('p1', '2024-01-20'));
  assert.equal(buildRows.length, 2); // (tour, entries, { stats, run }) — no ranking, snapshot or profile input exists
});

test('later DNA cannot leak backward: a player profile depends only on strictly earlier records', () => {
  const recs = [[100, 0, 1, 0.6, 1600, 1, 1, 0, 0, 1], [110, 0, 0, 0.4, 1700, 0, 0, 1, 0, 0]];
  const a = profileFrom(recs, 111);
  const b = profileFrom([...recs, [111, 0, 1, 0.2, 2000, 1, 2, 0, 1, 1], [140, 0, 1, 0.1, 2100, 0, 0, 0, 1, 1]], 111);
  assert.deepEqual(b, a);
});

test('walk-forward only: every training row is dated before every test row; no randomness in the evaluator', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ day: day(i), match_id: `x${i}` }));
  for (const b of walkForward(rows, [{ name: 'a', from: day(20), to: day(30) }, { name: 'b', from: day(30), to: day(60) }])) {
    assert.ok(b.train.every((r) => b.test.every((t) => r.day < t.day)));
  }
  const src = fs.readFileSync('scripts/research/mm2/evaluate.mjs', 'utf8') + fs.readFileSync('scripts/research/mm2/lib/model.mjs', 'utf8');
  assert.doesNotMatch(src, /Math\.random|shuffle/);
});

test('champion and challenger must be evaluated on identical ids', () => {
  const a = [{ match_id: '1' }, { match_id: '2' }];
  assert.ok(assertSameRows(a, [{ match_id: '1' }, { match_id: '2' }]));
  assert.throws(() => assertSameRows(a, [{ match_id: '1' }]));
  assert.throws(() => assertSameRows(a, [{ match_id: '2' }, { match_id: '1' }]));
  const rows = [{ y: 1, edition: 'e' }, { y: 0, edition: 'e' }];
  assert.equal(pairedBootstrap(rows, [0.6, 0.4], [0.6, 0.4], { reps: 50 }).delta_log_loss, 0);
});

test('missing technical stats stay missing; withheld surface stays withheld', () => {
  const rows = buildRows('WTA', ledger()).rows;
  assert.ok(rows.every((r) => r.f.serve === null && r.f.ret === null && r.tech === false));
  const noSurf = rows.filter((r) => r.surface === 'unknown');
  assert.ok(noSurf.length > 0);
  assert.ok(noSurf.every((r) => r.f.surf_edge === 0 && r.blend === false && r.champion === r.overall));
  // stats for ONE player only: still missing (never imputed)
  const L = ledger();
  const stats = new Map(L.slice(0, 40).filter((e) => e.A === 'p1' || e.B === 'p1').map((e) => [e.id, { A: [60, 40, 30, 10, 3, 2, 1, 1], B: [60, 40, 28, 9, 4, 2, 0, 2] }]));
  const r2 = buildRows('WTA', L, { stats }).rows;
  assert.ok(r2.every((r) => r.tech === false || (r.f.serve !== null)));
});

test('champion probability equals the production serving rule (tennis-api modelBlock)', () => {
  const L = ledger();
  const run = ratingRun(L, { variant: 'margin' });
  const e = [...L].reverse().find((x) => x.surface && run.pre.surface(x)?.nsa >= 5 && run.pre.surface(x)?.nsb >= 5);
  const ch = championAt(run, e, e.seq, 'WTA');
  assert.ok(ch);
  const pr = run.pre.get(e); const s = run.pre.surface(e);
  const pl = (r, n, sr, sn) => ({ all: { r: { value: Math.round(r), rated_matches: n } }, hard: { r: { value: Math.round(sr), rated_matches: sn } } });
  const mb = modelBlock({ published: true, surface_published: true, variant: 'margin', backtest: {} }, pl(pr.ra, pr.na, s.sra, s.nsa), pl(pr.rb, pr.nb, s.srb, s.nsb), 'hard');
  assert.equal(ch.blend, true);
  assert.equal(mb.basis, 'surface_blend');
  assert.equal(mb.probability.A, Math.round(ch.p * 1000) / 1000);
});

test('challenger models are antisymmetric: swapping sides gives exactly 1 - p', () => {
  const X = [[0.5, 0.1], [-0.3, 0.2], [1.2, -0.4], [-0.8, -0.1]];
  const m = fitLogistic(X, [1, 0, 1, 0], ['L', 'form'], { lambda: 1 });
  const p = predict(m, [0.4, 0.2]);
  assert.ok(Math.abs(predict(m, [-0.4, -0.2]) - (1 - p)) < 1e-12);
  const a = { form: 0.1, opp: 1600, act30: 2, rest: 7, dec: 0.5, tb: 0.6, ss: 0.5, fsc: 0.8, cb: 0.2 };
  const b = { form: -0.1, opp: 1500, act30: 1, rest: 20, dec: 0.4, tb: 0.5, ss: 0.6, fsc: 0.7, cb: 0.3 };
  const f = featuresB(0.7, null, a, b); const g = featuresB(0.3, null, b, a);
  for (const k of Object.keys(f)) assert.ok(Math.abs(f[k] + g[k]) < 1e-9, k);
  assert.equal(metrics([0.5], [1]).n, 1);
});

test('research output cannot reach the production matchup API or the frontend', () => {
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(js|mjs)$/.test(d.name) ? [path.join(dir, d.name)] : []));
  for (const f of [...files('workers'), ...files('src')]) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /from\s+['"][^'"]*scripts\/research/, `${f} imports research scripts`);
    if (/research[\\/]mm2-profile\.js$/.test(f)) continue;
    // the only production importer allowed is the research-only shadow writer (never an API response)
    if (/from\s+['"][^'"]*mm2-profile/.test(s)) assert.match(f, /tennis-api[\\/]src[\\/]mm2-shadow\.js$|tennis-ingest[\\/]src[\\/]mm2-state\.js$/, `${f} imports the research profile`);
  }
  for (const f of ['workers/tennis-api/src/matchup.js', 'workers/tennis-api/src/v2.js', 'workers/tennis-api/src/index.js', 'workers/tennis-api/src/matchup-freeze.js']) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /mm2|research[/]|model_v2_challenger/i, `${f} references the research challenger`);
  }
});
