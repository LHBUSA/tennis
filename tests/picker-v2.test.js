// Tennis Picks V2 (docs/research/PICKS_V2_PROTOCOL.md): ATP recalibration map, ATP SHADOW ledger (create-only, never
// official, never post-hoc, concurrent duplicates write once), grading, opportunity labels, record aggregates.
import { test } from 'node:test';
import { readLedger as readLedgerV1 } from '../workers/tennis-api/src/picker-ledger.js';
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
  assert.equal(pub.label, 'PRELAUNCH RESEARCH');
  assert.equal(pub.official, false, 'an ATP shadow record is never official');
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

test('R2 self-test: passes on a store honouring If-None-Match: *, FAILS on one that ignores it (overwrite detected)', async () => {
  const { r2CreateOnlySelftest, SELFTEST_PREFIX } = await import('../workers/tennis-api/src/r2-selftest.js');
  const good = memBucket();
  const ok = await r2CreateOnlySelftest(good, { now: '2026-10-09T12:00:00.000Z', nonce: 'abcdef12-0000' });
  assert.equal(ok.pass, true, JSON.stringify(ok.checks));
  assert.ok([...good.m.keys()].every((k) => k.startsWith(SELFTEST_PREFIX)), 'writes only under ledger/selftest/');
  const m = new Map(); let n = 0;
  const naive = { async head(k) { return m.has(k) ? { etag: m.get(k).e } : null; }, async get(k) { return m.has(k) ? { text: async () => m.get(k).v } : null; }, async put(k, v) { await null; m.set(k, { v, e: `e${n += 1}` }); return {}; } };
  const bad = await r2CreateOnlySelftest(naive, { now: '2026-10-09T12:00:00.000Z', nonce: 'abcdef12-0000' });
  assert.equal(bad.pass, false);
  assert.equal(bad.checks.second_write_refused.bytes_unchanged, false);
});

test('records never mixed: each scope is its own line; disclosures (research only, underdog, markets, samples) are served', async () => {
  const { picksRoute, DISCLOSURES } = await import('../workers/tennis-api/src/picks-api.js');
  const { decideMatch } = await import('../workers/tennis-api/src/picker-ledger.js');
  const b = memBucket();
  const atp = match();
  const wta = match({ id: '1a2b3c4d-0000-5000-8000-000000000002', event_type: 'WS', tournament: { slug: 'wuhan', level: 'WTA 1000' } });
  await freezeOne(b, dossier(atp, 0.7), { now: '2026-10-10T05:00:00.000Z' });
  await freezeOne(b, { ...dossier(wta, 0.7), tour: 'WTA' }, { now: '2026-10-10T05:00:00.000Z' });
  await decideShadowMatch({ bucket: b, match: atp, now: LOCK_NOW, fetchImpl: benchOk });
  await decideMatch({ bucket: b, match: wta, now: LOCK_NOW, fetchImpl: benchOk });
  const res = await picksRoute('/v1/picks/track-record', null, { TENNIS_SOURCE: b });
  const rec = res.data.record;
  const { streamOf } = await import('../workers/tennis-api/src/picks-api.js');
  const wtaKey = streamOf((await readLedgerV1(b))[0].record);
  // the ATP shadow is ALWAYS prelaunch research; the WTA decision's stream follows its own recorded time vs the cutover
  assert.deepEqual(Object.keys(rec).sort(), ['prelaunch_atp', wtaKey].sort());
  assert.equal(rec.prelaunch_atp.CALL, 1); assert.equal(rec[wtaKey].CALL, 1);
  assert.ok(rec.prelaunch_atp.version.startsWith('tennis-picker-v2-atp-shadow') && rec[wtaKey].version.startsWith('tennis-picker-v1'));
  const codes = res.data.policy.disclosures.map((d) => d.code);
  for (const c of ['HOW', 'COUNTED', 'MODEL', 'SEPARATE_RECORDS', 'NO_GUARANTEE']) assert.ok(codes.includes(c), c);
  assert.ok(/Upset Hunter/.test(DISCLOSURES.find((d) => d.code === 'SEPARATE_RECORDS').text));
  assert.ok(/never counted as official/.test(DISCLOSURES.find((d) => d.code === 'SEPARATE_RECORDS').text));
  const { PICKS_ACTIVATED_AT } = await import('../workers/tennis-api/src/picker.js');
  assert.equal(res.data.policy.activated_at, PICKS_ACTIVATED_AT);
  assert.equal(res.data.official.activated_at, PICKS_ACTIVATED_AT);
});

test('public lock proofs: lock time + record/evidence sha256 only — never state, side or probability', async () => {
  const { picksRoute } = await import('../workers/tennis-api/src/picks-api.js');
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m, 0.7), { now: '2026-10-10T05:00:00.000Z' });
  await decideShadowMatch({ bucket: b, match: m, now: LOCK_NOW, fetchImpl: benchOk });
  const res = await picksRoute('/v1/picks/track-record', null, { TENNIS_SOURCE: b });
  const [p] = res.data.lock_proofs;
  assert.equal(p.match_id, ID);
  assert.match(p.record_sha256, /^[0-9a-f]{64}$/);
  const stored = b.m.get(key.decision(ID));
  const h = (await import('node:crypto')).createHash('sha256').update(stored).digest('hex');
  assert.equal(p.record_sha256, h, 'commitment = sha256 of the stored bytes');
  assert.ok(Date.parse(p.decided_at) < Date.parse(p.scheduled_at_known_at_lock));
  assert.ok(!/"(side|probability|state|selection|p_fav)"/.test(JSON.stringify(res.data.lock_proofs)));
});

test('verification ledger: read-only lock + start checks from stored bytes, create-only, no sides/probabilities, tamper = FAIL', async () => {
  const { runVerification, entryKey, readVerification } = await import('../workers/tennis-api/src/picks-verify.js');
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m, 0.7), { now: '2026-10-10T05:00:00.000Z' });
  await decideShadowMatch({ bucket: b, match: m, now: '2026-10-10T06:00:00.000Z', fetchImpl: benchOk }); // seen
  await decideShadowMatch({ bucket: b, match: m, now: LOCK_NOW, fetchImpl: benchOk });
  const decisionBytes = b.m.get(key.decision(ID));
  let row = { match_id: ID, event_type: 'MS', status: 'scheduled', scheduled_at: '2026-10-10T08:00:00+00:00', started_at: null };
  const store = { async select() { return [row]; } };
  const kv = new Map();
  const env = { TENNIS_SOURCE: b, TENNIS_STATE: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
  const r1 = await runVerification(store, env, { now: '2026-10-10T07:10:00.000Z' });
  assert.deepEqual(r1.written.map((w) => [w.stage, w.verdict]), [['lock', 'PASS']]);
  const lock = JSON.parse(b.m.get(entryKey('atp_shadow', ID, 'lock')));
  assert.equal(lock.checks.record_sha256, (await import('node:crypto')).createHash('sha256').update(decisionBytes).digest('hex'));
  assert.equal(lock.checks.evidence_rehash_matches, true);
  assert.equal(lock.checks.decided_before_sourced_start, true);
  assert.equal(lock.checks.counted_publicly, true);
  assert.ok(!/"(side|probability|p_fav|selection|selection_name)"/.test(b.m.get(entryKey('atp_shadow', ID, 'lock'))), 'no side / probability in the verification ledger');
  assert.equal(b.m.get(key.decision(ID)), decisionBytes, 'the decision bytes are untouched');
  // nothing new until the match starts; then one start entry
  assert.equal((await runVerification(store, env, { now: '2026-10-10T07:20:00.000Z' })).written.length, 0);
  row = { ...row, status: 'completed', started_at: '2026-10-10T08:07:00+00:00' };
  const r3 = await runVerification(store, env, { now: '2026-10-10T10:00:00.000Z' });
  assert.deepEqual(r3.written.map((w) => [w.stage, w.verdict]), [['start', 'PASS']]);
  assert.equal((await runVerification(store, env, { now: '2026-10-10T10:10:00.000Z' })).written.length, 0, 'create-only: never rewritten');
  assert.equal(JSON.parse(kv.get('picks:verify:summary')).counts['atp_shadow:lock'].PASS, 1);
  assert.equal((await readVerification(b)).length, 2);
});

test('verification ledger: a decision after the sourced start, broken evidence or a doubles row FAILS; no start time = UNVERIFIABLE', async () => {
  const { runVerification, entryKey } = await import('../workers/tennis-api/src/picks-verify.js');
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m, 0.7), { now: '2026-10-10T05:00:00.000Z' });
  await decideShadowMatch({ bucket: b, match: m, now: LOCK_NOW, fetchImpl: benchOk });
  // simulate corrupted storage (the test fake allows it; production writes are create-only)
  const rec = JSON.parse(b.m.get(key.decision(ID)));
  rec.lock.decided_at = '2026-10-10T08:30:00.000Z';
  b.m.set(key.decision(ID), JSON.stringify(rec));
  const snapKey = [...b.m.keys()].find((k) => k.startsWith('intel/matchup-prematch/'));
  const snap = JSON.parse(b.m.get(snapKey)); snap.payload.model.probability.A = 0.99; b.m.set(snapKey, JSON.stringify(snap));
  const row = { match_id: ID, event_type: 'MD', status: 'completed', scheduled_at: '2026-10-10T08:00:00+00:00', started_at: null };
  const kv = new Map();
  const env = { TENNIS_SOURCE: b, TENNIS_STATE: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
  const r = await runVerification({ async select() { return [row]; } }, env, { now: '2026-10-10T11:00:00.000Z' });
  const lock = JSON.parse(b.m.get(entryKey('atp_shadow', ID, 'lock')));
  assert.equal(lock.verdict, 'FAIL');
  for (const f of ['decided_before_sourced_start', 'evidence_rehash_matches', 'singles']) assert.ok(lock.failed.includes(f), f);
  assert.equal(JSON.parse(b.m.get(entryKey('atp_shadow', ID, 'start'))).verdict, 'UNVERIFIABLE');
  assert.equal(JSON.parse(kv.get('picks:verify:summary')).last_fail.scope, 'atp_shadow');
  assert.ok(r.written.length === 2);
});

test('owner-only verification route: premium path + owner state check in index.js', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../workers/tennis-api/src/index.js', import.meta.url), 'utf8');
  assert.ok(src.includes(String.raw`/^\/v1\/picks\/verification$/`));
  assert.ok(src.includes(`path === '/v1/picks/verification' && membership?.membership?.state !== 'owner'`));
});

test('verification /2: a HOLD is NOT_A_LOCK (never timed against the start); a /1 FAIL on a HOLD gets an appended correction', async () => {
  const { runVerification, entryKey, startChecks, VERIFY_PREFIX } = await import('../workers/tennis-api/src/picks-verify.js');
  assert.equal(startChecks({ record: { decision: { state: 'HOLD', reasons: ['MISSING_DAY_OR_TIMEZONE'] }, lock: { decided_at: '2026-10-09T11:50:00Z' } }, row: { started_at: '2026-10-09T11:30:00Z' } }).verdict, 'NOT_A_LOCK');
  const b = memBucket();
  const id = 'aaaaaaaa-0000-5000-8000-000000000009';
  const bad = { schema: 'pbe-lock-verification/1', scope: 'wta_v1', match_id: id, stage: 'start', verdict: 'FAIL', decision_state_public: 'HOLD' };
  b.m.set(entryKey('wta_v1', id, 'start'), JSON.stringify(bad));
  const kv = new Map([['picks:verify:summary', JSON.stringify({ schema: 'pbe-lock-verification/1', since: 'x', counts: { 'wta_v1:start': { PASS: 0, FAIL: 1 } }, last_fail: { at: 'x', scope: 'wta_v1', match_id: id, stage: 'start' } })]]);
  const env = { TENNIS_SOURCE: b, TENNIS_STATE: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v) } };
  await runVerification({ async select() { return []; } }, env, { now: '2026-10-09T13:20:00.000Z' });
  const s = JSON.parse(kv.get('picks:verify:summary'));
  assert.deepEqual([s.counts['wta_v1:start'].FAIL, s.counts['wta_v1:start'].NOT_A_LOCK, s.last_fail], [0, 1, null]);
  assert.equal(JSON.parse(b.m.get(entryKey('wta_v1', id, 'start'))).verdict, 'FAIL', 'the original entry is kept');
  assert.equal(JSON.parse(b.m.get(`${VERIFY_PREFIX}wta_v1/${id}/start.correction-1.json`)).corrected_verdict, 'NOT_A_LOCK');
});

test('guest safety (#12): the public track record never carries an unresolved selection, side or probability; upcoming locks are schedule facts only', async () => {
  const { picksRoute } = await import('../workers/tennis-api/src/picks-api.js');
  const { decideMatch } = await import('../workers/tennis-api/src/picker-ledger.js');
  const b = memBucket();
  const atp = match();
  const wta = match({ id: '1a2b3c4d-0000-5000-8000-000000000003', event_type: 'WS', tournament: { slug: 'wuhan', level: 'WTA 1000' } });
  await freezeOne(b, dossier(atp, 0.7), { now: '2026-10-10T05:00:00.000Z' });
  await freezeOne(b, { ...dossier(wta, 0.72), tour: 'WTA' }, { now: '2026-10-10T05:00:00.000Z' });
  await decideShadowMatch({ bucket: b, match: atp, now: LOCK_NOW, fetchImpl: benchOk });
  await decideMatch({ bucket: b, match: wta, now: LOCK_NOW, fetchImpl: benchOk });
  const store = { async select(t) { return t === 'tennis_tournament_editions' ? [{ edition_id: 'e1', level: 'WTA 1000' }, { edition_id: 'e2', level: 'ITF W75' }] : [
    { match_id: 'm-atp', event_type: 'MS', scheduled_at: '2026-10-10T12:00:00+00:00', edition_id: 'e0' },
    { match_id: 'm-wta', event_type: 'WS', scheduled_at: '2026-10-10T13:00:00+00:00', edition_id: 'e1' },
    { match_id: 'm-itf', event_type: 'WS', scheduled_at: '2026-10-10T13:00:00+00:00', edition_id: 'e2' }]; } };
  const res = await picksRoute('/v1/picks/track-record', null, { TENNIS_SOURCE: b }, store);
  const body = JSON.stringify(res.data);
  assert.equal(res.data.resolved.length, 0, 'no pending selection is public');
  assert.ok(!body.includes('"selection_id":"pa"') && !body.includes('Player A'), 'no pending side / player name');
  assert.ok(!/"probability(_a|_raw_a|_uncalibrated)?":0\.\d/.test(body), 'no unresolved probability');
  const { streamOf } = await import('../workers/tennis-api/src/picks-api.js');
  assert.equal(res.data.record[streamOf((await readLedgerV1(b))[0].record)].pending, 1);
  const u = res.data.upcoming_locks;
  assert.deepEqual([u.atp_shadow.candidates, u.wta.candidates], [1, 1], 'ITF never counted');
  assert.ok(!/side|probability|selection/.test(JSON.stringify(u)));
});
