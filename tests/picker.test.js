// Tennis PBE Picker V1 (workers/tennis-api/src/picker.js + picker-ledger.js): owner decisions 2026-10-04.
// Scope, designated lock, HOLD vs PASS, markets never an input, official only after activation (never retroactive),
// write-once ledger, grading.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeOf, lockFor, decide, isOfficial, grade, scores, buildRecord, assertDecisionInput, PICKER_POLICY } from '../workers/tennis-api/src/picker.js';
import { decideMatch, gradeMatch, decisionKey, gradeKey, readLedger } from '../workers/tennis-api/src/picker-ledger.js';
import { freezeOne } from '../workers/tennis-api/src/matchup-freeze.js';

function memBucket() {
  const m = new Map();
  return {
    m,
    async list({ prefix }) { return { objects: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false }; },
    async head(k) { return m.has(k) ? { key: k } : null; },
    async get(k) { return m.has(k) ? { text: async () => m.get(k) } : null; },
    async put(k, v) { if (m.has(k)) throw new Error(`overwrite attempted: ${k}`); m.set(k, v); }
  };
}
const ID = '0752bed5-2452-56bb-a9b0-ff80ed68d0bd';
const P = (id, name) => ({ players: [{ id, name }] });
const match = (over = {}) => ({ id: ID, event_type: 'WS', status: 'scheduled', round: 'R16', scheduled_at: '2026-10-05T12:30:00+00:00', schedule_day: null, tournament: { slug: 'beijing', level: 'WTA 1000', surface: 'hard' }, sides: { A: P('pa', 'Player A'), B: P('pb', 'Player B') }, ...over });
const dossier = (m, pA = 0.7, over = {}) => ({ as_of: '2026-10-04', tour: 'WTA', matchup_version: '1.1.0', fixture: 'upcoming', match: m, model: { status: 'published', probability: { A: pA, B: 1 - pA }, basis: 'overall', model: { name: 'PBE Rating', method_version: 1, variant: 'margin' }, ratings: { A: { value: 1900, rated_matches: 80 }, B: { value: 1800, rated_matches: 60 } } }, ...over });
const benchOk = async () => ({ ok: true, json: async () => ({ schema: 'pbe-benchmarks/1', at_forecast: [{ venue: 'kalshi', semantic_class: 'EXACT_MATCH', benchmark: 'NO_OBSERVATION_AT_PBE_FORECAST', comparable: true }] }) });
const benchDown = async () => { throw new Error('unreachable'); };

test('scope: WTA main tour official candidate; WTA 125 shadow; ATP PASS lane; ITF / doubles out', () => {
  assert.equal(scopeOf(match()), 'wta_main');
  assert.equal(scopeOf(match({ tournament: { level: 'Grand Slam' } })), 'wta_main');
  assert.equal(scopeOf(match({ tournament: { level: 'WTA 125' } })), 'shadow_wta125');
  assert.equal(scopeOf(match({ event_type: 'MS', tournament: { level: null } })), 'atp');
  assert.equal(scopeOf(match({ tournament: { level: 'ITF W75' } })), 'out_of_scope');
  assert.equal(scopeOf(match({ event_type: 'MS', tournament: { level: 'ITF M25' } })), 'out_of_scope');
  assert.equal(scopeOf(match({ event_type: 'WD', sides: { A: { players: [{ id: 1 }, { id: 2 }] }, B: { players: [{ id: 3 }, { id: 4 }] } } })), 'out_of_scope');
});

test('lock: sourced exact start -> T_MINUS_60; proven day + offset -> DAY_START_LOCK at 00:00 local; else none', () => {
  const t = lockFor(match());
  assert.deepEqual([t.rule, t.lock_at], ['T_MINUS_60', '2026-10-05T11:30:00.000Z']);
  const d = lockFor(match({ scheduled_at: null, schedule_day: { day: '2026-10-05', utc_offset: '+08:00', source: 'wta_order_of_play' } }));
  assert.deepEqual([d.rule, d.lock_at, d.day, d.utc_offset], ['DAY_START_LOCK', '2026-10-04T16:00:00.000Z', '2026-10-05', '+08:00']);
  // a day without a proven offset, or an offset without a day, has no lock (no guessed timezone)
  assert.equal(lockFor(match({ scheduled_at: null, schedule_day: { day: '2026-10-05', utc_offset: null, source: 'wta_order_of_play' } })).rule, null);
  assert.equal(lockFor(match({ scheduled_at: null, schedule_day: { day: null, utc_offset: '+08:00', source: 'x' } })).rule, null);
  assert.equal(lockFor(match({ scheduled_at: null })).rule, null);
  // exact start wins when both exist
  assert.equal(lockFor(match({ schedule_day: { day: '2026-10-05', utc_offset: '+08:00', source: 'x' } })).rule, 'T_MINUS_60');
});

test('decide: markets never enter; ATP PASS·MODEL_NOT_VALIDATED; HOLD = could not evaluate; PASS below tau; CALL', () => {
  const lock = lockFor(match());
  const base = { scope: 'wta_main', lock, probability_a: 0.7, rated_a: 80, rated_b: 60, model_status: 'published', snapshot_status: 'frozen', started: false };
  for (const k of ['kalshi_mid', 'market_p', 'polymarket', 'venue', 'price', 'odds']) assert.throws(() => decide({ ...base, [k]: 0.6 }), /market data may never enter/);
  assert.throws(() => assertDecisionInput({ surprise: 1 }), /unknown decision input/);
  assert.deepEqual(decide({ ...base, scope: 'atp' }).reasons, ['MODEL_NOT_VALIDATED']);
  assert.equal(decide({ ...base, scope: 'atp' }).state, 'PASS');
  assert.deepEqual(decide({ ...base, lock: { lock_at: null } }), { state: 'HOLD', side: null, reasons: ['MISSING_DAY_OR_TIMEZONE'], threshold: 0.55 });
  assert.equal(decide({ ...base, snapshot_status: 'none' }).reasons[0], 'NO_PRE_MATCH_SNAPSHOT_AT_LOCK');
  assert.equal(decide({ ...base, rated_b: 9 }).reasons[0], 'INSUFFICIENT_HISTORY');
  assert.equal(decide({ ...base, model_status: 'not_validated', probability_a: null }).reasons[0], 'INSUFFICIENT_SOURCE_DATA');
  assert.equal(decide({ ...base, started: true }).reasons[0], 'LOCK_MISSED');
  assert.deepEqual([decide({ ...base, probability_a: 0.54 }).state, decide({ ...base, probability_a: 0.54 }).reasons[0]], ['PASS', 'WITHIN_UNCERTAINTY_BAND']);
  assert.deepEqual([decide({ ...base, probability_a: 0.55 }).state, decide({ ...base, probability_a: 0.55 }).side], ['CALL', 'A']);
  assert.deepEqual([decide({ ...base, probability_a: 0.3 }).state, decide({ ...base, probability_a: 0.3 }).side, decide({ ...base, probability_a: 0.3 }).p_fav], ['CALL', 'B', 0.7]);
});

test('official = activated_at != null && decided_at >= activated_at; never retroactive; shadow never official', () => {
  const rec = (decided_at, scope = 'wta_main', state = 'CALL') => ({ scope, decision: { state }, lock: { decided_at } });
  assert.equal(isOfficial(rec('2026-10-05T00:00:00Z')), false, 'not activated -> not official');
  const act = { ...PICKER_POLICY, activated_at: '2026-10-10T00:00:00Z' };
  assert.equal(isOfficial(rec('2026-10-09T23:59:59Z'), act), false, 'pre-activation decision stays unofficial after activation');
  assert.equal(isOfficial(rec('2026-10-10T00:00:00Z'), act), true);
  assert.equal(isOfficial(rec('2026-10-11T00:00:00Z', 'shadow_wta125'), act), false);
  assert.equal(isOfficial(rec('2026-10-11T00:00:00Z', 'wta_main', 'PASS'), act), false);
  assert.equal(PICKER_POLICY.activated_at, null, 'V1 ships NOT activated');
});

test('grading: completed -> W/L from our canonical result; walkover / retired / defaulted / abandoned / cancelled -> VOID', () => {
  const r = { decision: { state: 'CALL', side: 'A', p_fav: 0.7 } };
  assert.equal(grade(r, { status: 'completed', winner_side: 'A' }).result, 'W');
  assert.equal(grade(r, { status: 'completed', winner_side: 'B' }).result, 'L');
  for (const st of ['walkover', 'retired', 'defaulted', 'abandoned', 'cancelled']) assert.equal(grade(r, { status: st, winner_side: 'A' }).result, 'VOID', st);
  assert.equal(grade(r, { status: 'completed', winner_side: 'A', end_reason: 'retired' }).result, 'VOID');
  assert.equal(grade(r, { status: 'in_progress' }), null);
  assert.equal(grade({ decision: { state: 'PASS' } }, { status: 'completed', winner_side: 'A' }), null);
  assert.deepEqual(scores(r, { result: 'W' }), { brier: 0.09, log_loss: 0.356675 });
  assert.equal(scores(r, { result: 'VOID' }), null);
});

test('ledger: before lock nothing is written; at lock ONE decision from the snapshot frozen at/before lock; never replaced', async () => {
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m, 0.7), { now: '2026-10-05T10:00:00.000Z' });
  // a later snapshot (after the lock) must never be used
  await freezeOne(b, dossier(m, 0.3, { as_of: '2026-10-05' }), { now: '2026-10-05T11:45:00.000Z' });
  assert.equal((await decideMatch({ bucket: b, match: m, now: '2026-10-05T11:00:00.000Z', fetchImpl: benchOk })).skipped, 'before_lock');
  const r = await decideMatch({ bucket: b, match: m, now: '2026-10-05T11:50:00.000Z', fetchImpl: benchOk });
  assert.deepEqual([r.written, r.state, r.lock_rule], [true, 'CALL', 'T_MINUS_60']);
  const rec = JSON.parse(b.m.get(decisionKey(ID)));
  assert.equal(rec.schema, 'pbe-decision-record/1');
  assert.equal(rec.decision.side, 'A', 'the 10:00 snapshot (p=0.70) is the one at/before the 11:30 lock; the 11:45 one is ignored');
  assert.equal(rec.probability, 0.7);
  assert.equal(rec.evidence.frozen_at, '2026-10-05T10:00:00.000Z');
  assert.equal(rec.decision.official, false);
  assert.equal(rec.contract.selection_id, 'pa');
  assert.equal(rec.benchmarks_status, 'frozen');
  assert.equal(rec.at_forecast[0].benchmark, 'NO_OBSERVATION_AT_PBE_FORECAST');
  // a later exact start / any later run never replaces the designated decision
  const again = await decideMatch({ bucket: b, match: { ...m, scheduled_at: '2026-10-05T15:00:00+00:00' }, now: '2026-10-05T14:05:00.000Z', fetchImpl: benchOk });
  assert.equal(again.skipped, 'already_decided');
});

test('ledger: DAY_START_LOCK decision is never replaced when an exact start appears later', async () => {
  const b = memBucket();
  const m = match({ scheduled_at: null, schedule_day: { day: '2026-10-05', utc_offset: '+08:00', source: 'wta_order_of_play' } });
  await freezeOne(b, dossier({ ...m }, 0.62, { fixture: 'upcoming_day' }), { now: '2026-10-04T15:00:00.000Z' });
  const r = await decideMatch({ bucket: b, match: m, now: '2026-10-04T16:05:00.000Z', fetchImpl: benchOk });
  assert.deepEqual([r.state, r.lock_rule], ['CALL', 'DAY_START_LOCK']);
  const later = await decideMatch({ bucket: b, match: { ...m, scheduled_at: '2026-10-05T12:30:00+00:00' }, now: '2026-10-04T17:40:00.000Z', fetchImpl: benchOk });
  assert.equal(later.skipped, 'already_decided');
  assert.equal(JSON.parse(b.m.get(decisionKey(ID))).lock.lock_rule, 'DAY_START_LOCK');
});

test('ledger: no lock while scheduled waits; started without a lock -> one honest HOLD; ATP -> PASS record', async () => {
  const b = memBucket();
  const m = match({ scheduled_at: null });
  assert.equal((await decideMatch({ bucket: b, match: m, now: '2026-10-05T10:00:00Z', fetchImpl: benchOk })).skipped, 'no_lock_yet');
  const r = await decideMatch({ bucket: b, match: { ...m, status: 'in_progress' }, now: '2026-10-05T13:00:00Z', fetchImpl: benchOk });
  assert.deepEqual([r.state, r.reasons], ['HOLD', ['MISSING_DAY_OR_TIMEZONE']]);
  const b2 = memBucket();
  const atp = match({ event_type: 'MS', tournament: { level: null } });
  await freezeOne(b2, dossier(atp, 0.8), { now: '2026-10-05T10:00:00.000Z' });
  const a = await decideMatch({ bucket: b2, match: atp, now: '2026-10-05T11:40:00.000Z', fetchImpl: benchOk });
  assert.deepEqual([a.state, a.reasons], ['PASS', ['MODEL_NOT_VALIDATED']]);
  assert.equal(JSON.parse(b2.m.get(decisionKey(ID))).decision.official, false);
});

test('ledger: markets outage defers (bounded); after the window the record says UNAVAILABLE, never back-filled', async () => {
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m), { now: '2026-10-05T10:00:00.000Z' });
  assert.equal((await decideMatch({ bucket: b, match: m, now: '2026-10-05T11:40:00.000Z', fetchImpl: benchDown })).skipped, 'benchmarks_deferred');
  // still scheduled after the 2 h window: the decision is taken without venues and says so permanently
  const r = await decideMatch({ bucket: b, match: m, now: '2026-10-05T12:05:00.000Z', fetchImpl: benchDown });
  assert.equal(r.state, 'CALL');
  const rec = JSON.parse(b.m.get(decisionKey(ID)));
  assert.deepEqual([rec.benchmarks_status, rec.at_forecast], ['UNAVAILABLE_AT_DECISION', null]);
});

test('grade ledger: one immutable grade per CALL; readLedger joins it', async () => {
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m), { now: '2026-10-05T10:00:00.000Z' });
  await decideMatch({ bucket: b, match: m, now: '2026-10-05T11:40:00.000Z', fetchImpl: benchOk });
  const rec = JSON.parse(b.m.get(decisionKey(ID)));
  assert.equal((await gradeMatch({ bucket: b, record: rec, match: { status: 'in_progress' }, now: '2026-10-05T13:00:00Z', fetchImpl: benchOk })).skipped, 'not_final');
  const g = await gradeMatch({ bucket: b, record: rec, match: { status: 'completed', winner_side: 'B', started_at: '2026-10-05T12:41:00Z', score: '6-4 6-4' }, now: '2026-10-05T14:00:00Z', fetchImpl: benchOk });
  assert.deepEqual([g.written, g.result], [true, 'L']);
  assert.equal((await gradeMatch({ bucket: b, record: rec, match: { status: 'completed', winner_side: 'A' }, now: '2026-10-05T15:00:00Z', fetchImpl: benchOk })).skipped, 'already_graded');
  assert.equal(JSON.parse(b.m.get(gradeKey(ID))).grade.result, 'L');
  const rows = await readLedger(b);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].grade.grade.result, 'L');
});

test('buildRecord carries no market field into the decision block', () => {
  const m = match();
  const rec = buildRecord({ match: m, scope: 'wta_main', lock: lockFor(m), snapshot: null, benchmarks: null, now: '2026-10-05T11:40:00Z' });
  assert.equal(rec.decision.state, 'HOLD');
  assert.ok(!/kalshi|polymarket|market|price|odds/i.test(JSON.stringify(rec.decision)));
});

test('picks API: public track record never reveals a pending CALL side; premium paths gate /v1/picks and /v1/picks/:id', async () => {
  const { shapePick, trackRecord } = await import('../workers/tennis-api/src/picks-api.js');
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m), { now: '2026-10-05T10:00:00.000Z' });
  await decideMatch({ bucket: b, match: m, now: '2026-10-05T11:40:00.000Z', fetchImpl: benchOk });
  const [row] = await readLedger(b);
  const pub = shapePick(row, { reveal: false });
  assert.deepEqual([pub.side, pub.selection, pub.probability, pub.markets_at_lock], [null, null, null, null]);
  assert.equal(pub.label, 'PROSPECTIVE · NOT OFFICIAL');
  assert.equal(shapePick(row, { reveal: true }).side, 'A');
  const tr = trackRecord([row]);
  assert.deepEqual([tr.wta_main.CALL, tr.wta_main.pending, tr.wta_main.graded], [1, 1, 0]);
  const src = (await import('node:fs')).readFileSync(new URL('../workers/tennis-api/src/index.js', import.meta.url), 'utf8');
  assert.ok(src.includes(String.raw`/^\/v1\/picks(?:\/[0-9a-f-]{36})?$/,`), 'premium regex for /v1/picks present in index.js');
  const premium = /^\/v1\/picks(?:\/[0-9a-f-]{36})?$/;
  assert.ok(premium.test('/v1/picks') && premium.test(`/v1/picks/${ID}`) && !premium.test('/v1/picks/track-record'));
});

test('track record: W/L enter hit rate; VOID counted apart; PBE vs market only on comparable observed venues', async () => {
  const { trackRecord } = await import('../workers/tennis-api/src/picks-api.js');
  const rec = (side, pf, venues) => ({ scope: 'wta_main', contract: { selection_id: 'pa' }, decision: { state: 'CALL', side, p_fav: pf, reasons: [] }, at_forecast: venues });
  const gr = (r) => ({ grade: { result: r, scores: r === 'VOID' ? null : { brier: 0.1, log_loss: 0.3 } } });
  const ex = { venue: 'kalshi', comparable: true, benchmark: { observed_at: 'x' }, selection_market_p_bp: 6000, market_favorite_team_id: 'pa' };
  const rm = { venue: 'polymarket', comparable: false, semantic_class: 'RULE_MISMATCH', benchmark: { observed_at: 'x' }, selection_market_p_bp: 6100 };
  const no = { venue: 'kalshi', comparable: true, benchmark: 'NO_OBSERVATION_AT_PBE_FORECAST' };
  const t = trackRecord([{ record: rec('A', 0.7, [ex, rm]), grade: gr('W') }, { record: rec('A', 0.6, [no]), grade: gr('L') }, { record: rec('A', 0.8, []), grade: gr('VOID') }]).wta_main;
  assert.deepEqual([t.graded, t.W, t.L, t.VOID, t.hit_rate, t.mean_p], [2, 1, 1, 1, 0.5, 0.65]);
  assert.deepEqual([t.vs_market.compared, t.vs_market.agree_on_favourite, t.vs_market.not_comparable, t.vs_market.no_observation_at_lock], [1, 1, 1, 1]);
  assert.equal(t.vs_market.market_brier, 0.16);
});

test('never post-hoc: a match first seen after it left scheduled gets NO record; past the window = started', async () => {
  const b = memBucket();
  const done = await decideMatch({ bucket: b, match: match({ status: 'completed', scheduled_at: '2009-10-27T12:00:00+00:00', event_type: 'MS', tournament: { level: null } }), now: '2026-10-04T14:00:00Z', fetchImpl: benchOk });
  assert.equal(done.skipped, 'not_observed_before_start');
  assert.equal(b.m.size, 0, 'nothing written for a match never observed while scheduled');
  // observed while scheduled with no lock, then play begins -> exactly one honest HOLD
  const m = match({ scheduled_at: null });
  await decideMatch({ bucket: b, match: m, now: '2026-10-05T09:00:00Z', fetchImpl: benchOk });
  const h = await decideMatch({ bucket: b, match: { ...m, status: 'in_progress' }, now: '2026-10-05T12:00:00Z', fetchImpl: benchOk });
  assert.deepEqual([h.state, h.reasons], ['HOLD', ['MISSING_DAY_OR_TIMEZONE']]);
  // a stored status that lags: still 'scheduled' after the sourced start -> treated as started (HOLD LOCK_MISSED)
  const b2 = memBucket();
  const s = match();
  await freezeOne(b2, dossier(s), { now: '2026-10-05T10:00:00.000Z' });
  await decideMatch({ bucket: b2, match: s, now: '2026-10-05T10:05:00Z', fetchImpl: benchOk });
  const late = await decideMatch({ bucket: b2, match: s, now: '2026-10-05T12:31:00Z', fetchImpl: benchOk });
  assert.deepEqual([late.state, late.reasons], ['HOLD', ['LOCK_MISSED']]);
});

test('corrections are appended, never mutations; an excluded record leaves every count', async () => {
  const { appendCorrection } = await import('../workers/tennis-api/src/picker-ledger.js');
  const { trackRecord } = await import('../workers/tennis-api/src/picks-api.js');
  const b = memBucket();
  const m = match();
  await freezeOne(b, dossier(m), { now: '2026-10-05T10:00:00.000Z' });
  await decideMatch({ bucket: b, match: m, now: '2026-10-05T11:40:00.000Z', fetchImpl: benchOk });
  await assert.rejects(() => appendCorrection(b, { id: ID }), /needs a reason/);
  await appendCorrection(b, { id: ID, reason: 'TEST_EXCLUSION', excluded: true, at: '2026-10-05T12:00:00Z' });
  const rows = await readLedger(b);
  assert.equal(rows[0].excluded, true);
  assert.equal(rows[0].record.decision.state, 'CALL', 'the record itself is unchanged');
  assert.deepEqual(trackRecord(rows), {});
});
