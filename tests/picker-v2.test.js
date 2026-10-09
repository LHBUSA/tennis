// Tennis Picks V2 (docs/research/PICKS_V2_PROTOCOL.md): ATP recalibration map, ATP SHADOW ledger (create-only, never
// official, never post-hoc, concurrent duplicates write once), grading, opportunity labels, record aggregates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyRecal } from '../workers/tennis-api/src/recal.js';
import { ATP_SHADOW_POLICY, decideShadow, decideShadowMatch, gradeShadowMatch, readShadowLedger, runAtpShadow, key, createOnly, SHADOW_PREFIX } from '../workers/tennis-api/src/picker-v2-atp.js';
import { opportunities, trackRecord, shapePick } from '../workers/tennis-api/src/picks-api.js';
import { freezeOne } from '../workers/tennis-api/src/matchup-freeze.js';
import { lockFor } from '../workers/tennis-api/src/picker.js';

/** In-memory R2 with the conditional-put contract: If-None-Match: * refuses an existing key (returns null). */
function memBucket() {
  const m = new Map();
  return {
    m,
    async list({ prefix }) { return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false }; },
    async head(k) { await null; return m.has(k) ? { key: k } : null; },
    async get(k) { return m.has(k) ? { text: async () => m.get(k) } : null; },
    async put(k, v, opts = {}) {
      await null;
      const inm = opts.onlyIf instanceof Headers ? opts.onlyIf.get('if-none-match') : null;
      if (inm === '*' && m.has(k)) return null;
      if (m.has(k)) throw new Error(`overwrite attempted: ${k}`);
      m.set(k, v); return { key: k };
    }
  };
}
const ID = '1a2b3c4d-0000-5000-8000-000000000001';
const P = (id, name) => ({ players: [{ id, name }] });
const match = (over = {}) => ({ id: ID, event_type: 'MS', status: 'scheduled', round: 'R32', scheduled_at: '2026-10-10T08:00:00+00:00', schedule_day: null, tournament: { slug: 'shanghai', level: null }, sides: { A: P('pa', 'Player A'), B: P('pb', 'Player B') }, ...over });
const dossier = (m, pA = 0.7, over = {}) => ({ as_of: '2026-10-09', tour: 'ATP', matchup_version: '1.1.0', fixture: 'upcoming', match: m, why: ['Player A is rated 120 PBE Rating points above Player B.'], model: { status: 'published', probability: { A: pA, B: 1 - pA }, overall_probability: { A: pA, B: 1 - pA }, basis: 'overall', model: { name: 'PBE Rating', method_version: 1, variant: 'standard' }, ratings: { A: { value: 1900, rated_matches: 80 }, B: { value: 1780, rated_matches: 60 } } }, ...over });
const benchOk = async () => ({ ok: true, json: async () => ({ schema: 'pbe-benchmarks/1', at_forecast: [{ venue: 'kalshi', semantic_class: 'EXACT_MATCH', comparable: true, benchmark: { observed_at: '2026-10-10T06:59:00Z' }, selection_market_p_bp: 7400, market_favorite_team_id: 'pa' }] }) });
const LOCK_NOW = '2026-10-10T07:05:00.000Z';

test('recal: frozen coefficients equal the committed frozen.json; symmetric, monotone, shrinks toward 50%', () => {
  const frozen = JSON.parse(fs.readFileSync(new URL('../docs/evidence/atp-recal/frozen.json', import.meta.url), 'utf8'));
  assert.equal(ATP_SHADOW_POLICY.recal.method, frozen.method);
  assert.equal(ATP_SHADOW_POLICY.recal.params.T, frozen.params.T);
  assert.equal(ATP_SHADOW_POLICY.tau, frozen.tau);
  assert.equal(ATP_SHADOW_POLICY.official, false);
  let prev = 0;
  for (let i = 1; i < 100; i += 1) {
    const p = i / 100;
    const q = applyRecal(ATP_SHADOW_POLICY.recal, p);
    assert.ok(q > prev, 'monotone');
    assert.ok(Math.abs(q + applyRecal(ATP_SHADOW_POLICY.recal, 1 - p) - 1) < 1e-9, 'symmetric');
    if (i > 50) assert.ok(q < p && q > 0.5, 'shrinks toward 50%');
    prev = q;
  }
});

test('decideShadow: markets never enter; HOLD reasons; PASS below tau on the RECALIBRATED probability; CALL', () => {
  const lock = { lock_at: '2026-10-10T07:00:00Z' };
  const base = { lock, probability_a: 0.6, rated_a: 50, rated_b: 50, model_status: 'published', snapshot_status: 'frozen', started: false };
  for (const k of ['kalshi_mid', 'market_p', 'polymarket', 'price', 'odds']) assert.throws(() => decideShadow({ ...base, [k]: 0.6 }), /market data may never enter/);
  assert.throws(() => decideShadow({ ...base, scope: 'atp' }), /unknown decision input/);
  assert.equal(decideShadow({ ...base, lock: {} }).reasons[0], 'MISSING_DAY_OR_TIMEZONE');
  assert.equal(decideShadow({ ...base, started: true }).reasons[0], 'LOCK_MISSED');
  assert.equal(decideShadow({ ...base, snapshot_status: 'none' }).reasons[0], 'NO_PRE_MATCH_SNAPSHOT_AT_LOCK');
  assert.equal(decideShadow({ ...base, rated_b: 9 }).reasons[0], 'INSUFFICIENT_HISTORY');
  const call = decideShadow(base);
  assert.deepEqual([call.state, call.side, call.p_fav, call.p_fav_raw], ['CALL', 'A', 0.5805, 0.6]);
  // raw 0.56 would be a V1-style CALL at 0.55, but recalibrated it is 0.548 -> PASS
  const pass = decideShadow({ ...base, probability_a: 0.44 });
  assert.deepEqual([pass.state, pass.reasons[0]], ['PASS', 'WITHIN_UNCERTAINTY_BAND']);
});

test('shadow ledger: one CALL at the lock with why + uncertainty + frozen benchmarks; never official; V1 prefix untouched', async () => {
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m, 0.7), { now: '2026-10-10T05:00:00.000Z' });
  const early = await decideShadowMatch({ bucket: b, match: m, now: '2026-10-10T06:00:00.000Z', fetchImpl: benchOk });
  assert.equal(early.skipped, 'before_lock');
  const res = await decideShadowMatch({ bucket: b, match: m, now: LOCK_NOW, fetchImpl: benchOk });
  assert.deepEqual([res.written, res.state], [true, 'CALL']);
  const [row] = await readShadowLedger(b);
  const r = row.record;
  assert.equal(r.scope, 'atp_shadow');
  assert.equal(r.decision.official, false);
  assert.equal(r.decision.activated_at, null);
  assert.equal(r.lock.lock_rule, 'T_MINUS_60');
  assert.equal(r.lock.lock_at, '2026-10-10T07:00:00.000Z');
  assert.ok(r.probability < 0.7 && r.decision.p_fav_raw === 0.7);
  assert.deepEqual(r.why, ['Player A is rated 120 PBE Rating points above Player B.']);
  assert.ok(r.uncertainty.past_calls > 0);
  assert.equal(r.benchmarks_status, 'frozen');
  assert.ok(!/kalshi|polymarket|market|price|odds/i.test(JSON.stringify(r.decision)));
  assert.ok([...b.m.keys()].every((k) => k.startsWith(SHADOW_PREFIX) || k.startsWith('intel/matchup-prematch/')), 'nothing outside the shadow prefix (V1 ledger untouched)');
  // a second tick never replaces it
  assert.equal((await decideShadowMatch({ bucket: b, match: m, now: '2026-10-10T07:15:00.000Z', fetchImpl: benchOk })).skipped, 'already_decided');
});

test('create-only under concurrent duplicate execution: two simultaneous ticks write exactly one decision', async () => {
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m, 0.7), { now: '2026-10-10T05:00:00.000Z' });
  await decideShadowMatch({ bucket: b, match: m, now: '2026-10-10T06:00:00.000Z', fetchImpl: benchOk }); // seen
  const both = await Promise.all([1, 2, 3].map(() => decideShadowMatch({ bucket: b, match: m, now: LOCK_NOW, fetchImpl: benchOk })));
  assert.equal(both.filter((x) => x.written === true).length, 1, 'exactly one writer wins');
  assert.equal([...b.m.keys()].filter((k) => k === key.decision(ID)).length, 1);
  assert.equal(await createOnly(b, key.decision(ID), { x: 1 }), false);
});

test('never post-hoc; DAY_START_LOCK for a sourced day; no invented start', async () => {
  const b = memBucket();
  const done = await decideShadowMatch({ bucket: b, match: match({ status: 'completed' }), now: LOCK_NOW, fetchImpl: benchOk });
  assert.equal(done.skipped, 'not_observed_before_start');
  assert.equal(b.m.size, 0);
  const noDay = match({ scheduled_at: null });
  assert.equal((await decideShadowMatch({ bucket: b, match: noDay, now: LOCK_NOW, fetchImpl: benchOk })).skipped, 'no_lock_yet');
  const day = match({ scheduled_at: null, schedule_day: { day: '2026-10-11', utc_offset: '+08:00', source: 'atp_order_of_play' } });
  assert.deepEqual([lockFor(day).rule, lockFor(day).lock_at], ['DAY_START_LOCK', '2026-10-10T16:00:00.000Z']);
});

test('grading: W/L scored for recalibrated AND raw probability; retirement/walkover VOID; lock integrity recorded', async () => {
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m, 0.7), { now: '2026-10-10T05:00:00.000Z' });
  await decideShadowMatch({ bucket: b, match: m, now: LOCK_NOW, fetchImpl: benchOk });
  const [row] = await readShadowLedger(b);
  assert.equal((await gradeShadowMatch({ bucket: b, record: row.record, match: { status: 'in_progress' }, now: 'x', fetchImpl: benchOk })).skipped, 'not_final');
  const g = await gradeShadowMatch({ bucket: b, record: row.record, match: { status: 'completed', winner_side: 'A', started_at: '2026-10-10T08:05:00Z', score: '6-4 6-4' }, now: '2026-10-10T10:00:00Z', fetchImpl: benchOk });
  assert.deepEqual([g.written, g.result], [true, 'W']);
  const [graded] = await readShadowLedger(b);
  assert.equal(graded.grade.lock_integrity, true);
  assert.ok(graded.grade.grade.scores.log_loss > graded.grade.grade.scores_raw.log_loss, 'a win costs the shrunk probability more');
  const t = trackRecord([graded]).atp_shadow;
  assert.deepEqual([t.graded, t.W, t.lock_integrity.before_start, t.editions], [1, 1, 1, 1]);
  assert.ok(t.log_loss_uncalibrated != null);
  const again = await gradeShadowMatch({ bucket: b, record: row.record, match: { status: 'completed', winner_side: 'B', started_at: '2026-10-10T08:05:00Z' }, now: 'later', fetchImpl: benchOk });
  assert.equal(again.written, false, 'a grade is never replaced');
  const b2 = memBucket(); const m2 = match();
  await freezeOne(b2, dossier(m2, 0.8), { now: '2026-10-10T05:00:00.000Z' });
  await decideShadowMatch({ bucket: b2, match: m2, now: LOCK_NOW, fetchImpl: benchOk });
  const [r2] = await readShadowLedger(b2);
  assert.equal((await gradeShadowMatch({ bucket: b2, record: r2.record, match: { status: 'retired', winner_side: 'B', end_reason: 'retired' }, now: 'x', fetchImpl: benchOk })).result, 'VOID');
});

test('opportunity labels: underdog watch, PBE above/below market only on same-contract venues, surface matchup', () => {
  const base = { scope: 'wta_main', event: { a: { id: 'pa' }, b: { id: 'pb' } }, contract: { selection_id: 'pa' }, decision: { state: 'CALL', side: 'A', reasons: [] }, probability: 0.72, model: { basis: 'overall' } };
  const codes = (r) => opportunities(r).map((o) => o.code);
  assert.deepEqual(codes({ ...base, at_forecast: [] }), ['MATCH_WINNER']);
  assert.deepEqual(codes({ ...base, at_forecast: [{ venue: 'kalshi', comparable: true, benchmark: {}, market_favorite_team_id: 'pb', selection_market_p_bp: 4500 }] }), ['MATCH_WINNER', 'UNDERDOG_WATCH', 'PBE_ABOVE_MARKET']);
  assert.deepEqual(codes({ ...base, at_forecast: [{ venue: 'polymarket', comparable: false, benchmark: {}, market_favorite_team_id: 'pa', selection_market_p_bp: 4000 }] }), ['MATCH_WINNER'], 'a related-only venue never yields a market difference');
  assert.deepEqual(codes({ ...base, at_forecast: [{ venue: 'kalshi', comparable: true, benchmark: {}, market_favorite_team_id: 'pa', selection_market_p_bp: 8000 }] }), ['MATCH_WINNER', 'PBE_BELOW_MARKET']);
  assert.deepEqual(codes({ ...base, at_forecast: [{ venue: 'kalshi', comparable: true, benchmark: 'NO_OBSERVATION_AT_PBE_FORECAST', market_favorite_team_id: 'pb' }] }), ['MATCH_WINNER']);
  const surf = { ...base, scope: 'atp_shadow', model: { basis: 'surface_blend' }, probability_raw_a: 0.62, overall_probability_a: 0.55, at_forecast: [] };
  assert.deepEqual(codes(surf), ['MATCH_WINNER', 'SURFACE_MATCHUP']);
  // a PASS can still be an underdog watch (never a pick)
  const pass = { ...base, contract: { selection_id: null }, decision: { state: 'PASS', side: null, reasons: ['WITHIN_UNCERTAINTY_BAND'] }, probability: 0.53, at_forecast: [{ venue: 'kalshi', comparable: true, benchmark: {}, market_favorite_team_id: 'pb' }] };
  assert.deepEqual(codes(pass), ['UNDERDOG_WATCH']);
});

test('public shape: a pending shadow CALL hides side, probability, why, labels and markets', async () => {
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m, 0.7), { now: '2026-10-10T05:00:00.000Z' });
  await decideShadowMatch({ bucket: b, match: m, now: LOCK_NOW, fetchImpl: benchOk });
  const [row] = await readShadowLedger(b);
  const pub = shapePick(row, { reveal: false });
  assert.deepEqual([pub.side, pub.probability, pub.why, pub.opportunities, pub.markets_at_lock, pub.uncertainty], [null, null, null, [], null, null]);
  assert.equal(pub.label, 'SHADOW · ATP RESEARCH');
  const full = shapePick(row, { reveal: true });
  assert.equal(full.side, 'A');
  assert.equal(full.probability_uncalibrated, 0.7);
});

test('runAtpShadow: bounded pass over MS candidates; writes KV summary', async () => {
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m, 0.7), { now: '2026-10-10T05:00:00.000Z' });
  const kv = new Map();
  const row = { match_id: ID };
  const store = { async select(table, q) { if (q.startsWith('select=match_id&')) return [row]; return []; } };
  const env = { TENNIS_SOURCE: b, TENNIS_STATE: { put: async (k, v) => kv.set(k, v) } };
  const sum = await runAtpShadow(store, env, { now: LOCK_NOW, fetchImpl: benchOk });
  assert.equal(sum.candidates, 1);
  assert.ok(kv.has('picker:v2:atp-shadow:last'));
});
