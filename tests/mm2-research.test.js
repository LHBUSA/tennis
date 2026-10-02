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

// ---- prospective shadow lane (research-only) ----------------------------------------------------------------------
import { playerState, stateProfile, tourStates, recordsOf } from '../workers/shared/research/mm2-profile.js';
import { shadowRecord, shadowFrozen } from '../workers/tennis-api/src/mm2-shadow.js';
import { SHADOW_MODEL } from '../workers/shared/research/mm2-b-shadow.js';

test('daily player state reproduces the offline profile exactly on its cutoff day (no records between cutoff and D)', () => {
  const recs = [[100, 0, 1, 0.6, 1600, 1, 1, 0, 0, 1], [118, 1, 0, 0.5, 1650, 0, 0, 0, 0, -1], [125, 0, 0, 0.4, 1700, 0, 0, 1, 0, 0], [129, 0, 1, 0.55, 1580, 1, 2, 1, 0, 0]];
  const cut = 130;
  const s = playerState(recs, cut);
  for (const D of [130, 131, 140, 160, 200]) {
    const a = profileFrom(recs, D); const b = stateProfile(s, D);
    for (const k of Object.keys(a)) assert.ok(a[k] === b[k] || Math.abs(a[k] - b[k]) < 1e-6, `${k} @${D}`);
  }
  assert.equal(playerState(recs, 100), null); // nothing before the cutoff: no state
});

test('tour states give the same Challenger B features as the frozen offline rows (matches on the cutoff day)', () => {
  const L = ledger();
  const run = ratingRun(L, { variant: 'margin' });
  const rows = buildRows('WTA', L, { run }).rows;
  const target = rows.at(-1);
  const byPlayer = new Map();
  for (const e of L) for (const pid of [e.A, e.B]) { if (!byPlayer.has(pid)) byPlayer.set(pid, []); byPlayer.get(pid).push(e); }
  const st = tourStates(byPlayer, run, target.day);
  const e = L.find((x) => x.id === target.match_id);
  const f = featuresB(target.champion, null, stateProfile(st.players[e.A], dayNum(target.day)), stateProfile(st.players[e.B], dayNum(target.day)));
  for (const k of ['form', 'opp', 'act30', 'rest', 'dec', 'tb', 'ss', 'fsc', 'cb', 'L']) assert.ok(Math.abs(f[k] - target.f[k]) < 1e-5, k);
});

function fakeBucket(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, async get(k) { return m.has(k) ? { text: async () => m.get(k) } : null; }, async head(k) { return m.has(k) ? {} : null; }, async put(k, v) { m.set(k, v); } };
}
const snapFor = (status = 'published') => ({ snapshot_kind: 'pre_match', match_id: 'mx', frozen_at: '2026-10-03T10:00:00.000Z', scheduled_at: '2026-10-03T12:00:00+00:00', content_hash: 'h',
  payload: { tour: 'WTA', match: { sides: { A: { players: [{ id: 'pa' }] }, B: { players: [{ id: 'pb' }] } } }, model: { status, probability: status === 'published' ? { A: 0.64, B: 0.36 } : null, basis: 'overall', surface_ratings: null } } });
const STATE = { state_version: 'mm2-state/1', cutoff: '2026-10-03', players: { pa: { form: 0.05, opp: 1700, dec: 0.55, tb: 0.5, ss: 0.6, fsc: 0.8, cb: 0.25, last: dayNum('2026-10-01'), days: [dayNum('2026-09-28'), dayNum('2026-10-01')] }, pb: { form: -0.02, opp: 1650, dec: 0.45, tb: 0.52, ss: 0.55, fsc: 0.78, cb: 0.2, last: dayNum('2026-09-20'), days: [dayNum('2026-09-20')] } } };

test('shadow record: champion exactly as frozen, challenger from the frozen coefficients; unscorable rows say why', async () => {
  const r = await shadowRecord(snapFor(), STATE);
  assert.deepEqual(r.champion.probability, { A: 0.64, B: 0.36 });
  assert.equal(r.model_version, SHADOW_MODEL.model_version);
  assert.ok(r.challenger.probability.A > 0 && r.challenger.probability.A < 1);
  assert.equal(r.research_only, true);
  assert.match(r.feature_hash, /^[0-9a-f]{64}$/);
  assert.equal((await shadowRecord(snapFor('insufficient_history'), STATE)).reason, 'champion_not_published:insufficient_history');
  assert.equal((await shadowRecord(snapFor(), null)).reason, 'no_player_state');
  assert.equal((await shadowRecord({ ...snapFor(), scheduled_at: '2026-10-02T23:00:00Z' }, STATE)).reason, 'state_cutoff_mismatch'); // cutoff > day
  assert.equal((await shadowRecord({ ...snapFor(), scheduled_at: '2026-10-04T01:00:00Z' }, STATE)).reason, 'state_cutoff_mismatch'); // cutoff < day
  assert.equal((await shadowRecord({ ...snapFor(), scheduled_at: '2026-10-03T23:59:00Z' }, STATE)).challenger !== null, true);      // cutoff == day
});

test('shadow writer: append-only, research prefix only, never overwrites; index appended', async () => {
  const snapKey = 'intel/matchup-prematch/mx/2026-10-03T10:00:00.000Z_x.json';
  const b = fakeBucket({ [snapKey]: JSON.stringify(snapFor()), 'research/mm2/state/WTA.json': JSON.stringify(STATE) });
  const before = new Map(b.m);
  const s1 = await shadowFrozen(b, [{ id: 'mx', written: true, key: snapKey }, { id: 'my', written: false }]);
  assert.equal(s1.written, 1);
  const added = [...b.m.keys()].filter((k) => !before.has(k));
  assert.ok(added.length === 2 && added.every((k) => k.startsWith('research/mm2/')));
  const shadowKey = added.find((k) => k.startsWith('research/mm2/shadow/'));
  const first = b.m.get(shadowKey);
  const s2 = await shadowFrozen(b, [{ id: 'mx', written: true, key: snapKey }]);
  assert.equal(s2.exists, 1);
  assert.equal(b.m.get(shadowKey), first);
  assert.equal(JSON.parse(b.m.get('research/mm2/shadow-index/2026-10-03.json')).length, 1);
  assert.equal(b.m.get(snapKey), before.get(snapKey)); // the frozen snapshot is never touched
});

// ---- frozen shadow model + frozen prospective gate --------------------------------------------------------------
import crypto from 'node:crypto';
import { PROMOTION_GATE, pickGradeable, gateStatus } from '../scripts/research/mm2/shadow-gate.mjs';

test('mm2-B-context/1 is frozen: coefficients hash to the pinned coef_hash (a refit must be /2, never /1)', () => {
  assert.equal(SHADOW_MODEL.model_version, 'mm2-B-context/1');
  assert.equal(SHADOW_MODEL.coef_hash, 'ca5795a4dc2d7578d8798d778c1c6dec9a6fb06d05676a235c8742e3ae3541a5');
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(SHADOW_MODEL.tours)).digest('hex'), SHADOW_MODEL.coef_hash);
  assert.deepEqual(SHADOW_MODEL.names, ['L', 'surf_edge', 'form', 'opp', 'act30', 'rest', 'dec', 'tb', 'ss', 'fsc', 'cb']);
  assert.deepEqual([SHADOW_MODEL.tours.ATP.lambda, SHADOW_MODEL.tours.WTA.lambda], [1, 1]);
});

test('the prospective promotion gate is frozen (mm2-shadow-gate/1)', () => {
  assert.equal(PROMOTION_GATE.gate_version, 'mm2-shadow-gate/1');
  assert.equal(PROMOTION_GATE.coef_hash, SHADOW_MODEL.coef_hash);
  assert.deepEqual({ ...PROMOTION_GATE.per_tour }, { min_graded: 2000, min_edition_clusters: 40, min_surfaces_with_100_graded: 2 });
  assert.equal(gateStatus({ n: 0 }).met, false);
});

test('grading picks the last record frozen before play; retirements/walkovers excluded; unfinished pending', () => {
  const rec = (t, extra = {}) => ({ frozen_at: t, challenger: { probability: { A: 0.6 } }, champion: { probability: { A: 0.55 } }, ...extra });
  const list = [rec('2026-10-03T01:00:00Z'), rec('2026-10-03T09:00:00Z'), rec('2026-10-03T13:00:00Z')];
  const done = { status: 'completed', winner_side: 'B', started_at: '2026-10-03T12:00:00Z' };
  const g = pickGradeable(list, done);
  assert.equal(g.kind, 'graded'); assert.equal(g.record.frozen_at, '2026-10-03T09:00:00Z'); assert.equal(g.y, 0);
  assert.equal(pickGradeable(list, { ...done, status: 'retired' }).kind, 'excluded');
  assert.equal(pickGradeable(list, { ...done, status: 'walkover' }).reason, 'walkover');
  assert.equal(pickGradeable(list, { status: 'in_progress', started_at: '2026-10-03T12:00:00Z' }).kind, 'pending');
  assert.equal(pickGradeable([rec('2026-10-03T13:00:00Z')], done).reason, 'no_record_before_start');
  assert.equal(pickGradeable([rec('2026-10-03T09:00:00Z', { challenger: null, reason: 'player_not_in_state' })], done).kind, 'unscored');
});

test('stale-state regression: a day-D state never scores a D+1 match; the D+1 state includes the result on D', async () => {
  const L = ledger();
  const run0 = ratingRun(L, { variant: 'margin' });
  const D = L.at(-1).day;                                   // the last day with a result for some players
  const D1 = new Date(Date.parse(D) + 86400e3).toISOString().slice(0, 10);
  const e = L.at(-1);                                        // a player who played ON day D
  const byP = (LL) => { const m = new Map(); for (const x of LL) for (const pid of [x.A, x.B]) { if (!m.has(pid)) m.set(pid, []); m.get(pid).push(x); } return m; };
  const stD = tourStates(byP(L), run0, D);
  const stD1 = tourStates(byP(L), run0, D1);
  // the D state lacks the D result; the D+1 state has it
  assert.ok(stD.players[e.A].last < dayNum(D));
  assert.equal(stD1.players[e.A].last, dayNum(D));
  const snap = { ...snapFor(), scheduled_at: `${D1}T10:00:00Z`, frozen_at: `${D1}T01:00:00.000Z`, payload: { ...snapFor().payload, match: { sides: { A: { players: [{ id: e.A }] }, B: { players: [{ id: e.B }] } } } } };
  const old = await shadowRecord(snap, { ...stD, state_version: 'mm2-state/1' });
  assert.equal(old.challenger, null);
  assert.equal(old.reason, 'state_cutoff_mismatch');
  const fresh = await shadowRecord(snap, { ...stD1, state_version: 'mm2-state/1' });
  assert.ok(fresh.challenger);
  // and the D+1 state equals the offline strict-before-day profile for a D+1 match
  const recs = []; for (const x of byP(L).get(e.A)) { const pr = run0.pre.get(x); recs.push(recordsOf(x, pr.p, pr.ra, pr.rb)[x.A === e.A ? 0 : 1]); }
  const off = profileFrom(recs, dayNum(D1)); const on = stateProfile(stD1.players[e.A], dayNum(D1));
  for (const k of Object.keys(off)) assert.ok(off[k] === on[k] || Math.abs(off[k] - on[k]) < 1e-6, k);
});
