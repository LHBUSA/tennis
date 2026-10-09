// OFFICIAL PBE PICKS (owner decision 2026-10-09, LHBUSA/tennis#14): the activation is real backend semantics, not a label.
// - one precise cutover; nothing recorded before it is ever official (V1 research, WTA 125 shadow, ATP shadow)
// - WTA tour-level CALLs recorded at/after it are official; PASS / HOLD are never picks
// - ATP official picks come from a NEW forward-only ledger (own prefix, ids, grades) — the shadow is untouched
// - the official record counts official picks only; guests never receive a pending side or probability
// - the pages have no sideways-scrolling tables
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PICKS_ACTIVATED_AT, buildRecord, PICKER_POLICY } from '../workers/tennis-api/src/picker.js';
import { decideShadowMatch, gradeShadowMatch, readShadowLedger, runAtpShadow, OFFICIAL_STREAM, OFFICIAL_ATP_PREFIX, SHADOW_PREFIX, ATP_SHADOW_POLICY, ATP_OFFICIAL_POLICY } from '../workers/tennis-api/src/picker-v2-atp.js';
import { decideMatch, readLedger } from '../workers/tennis-api/src/picker-ledger.js';
import { picksRoute, officialRecord, streamOf, isOfficialPick, shapePick } from '../workers/tennis-api/src/picks-api.js';
import { freezeOne } from '../workers/tennis-api/src/matchup-freeze.js';

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
    },
  };
}
const T = Date.parse(PICKS_ACTIVATED_AT);
const at = (ms) => new Date(T + ms).toISOString();
const H = 3600e3;
const P = (id, name) => ({ players: [{ id, name, slug: id }] });
let n = 0;
const nextId = () => `1a2b3c4d-0000-5000-8000-${String(++n).padStart(12, '0')}`;
const atpMatch = (startMs, over = {}) => ({ id: nextId(), event_type: 'MS', status: 'scheduled', round: 'R32', scheduled_at: at(startMs), schedule_day: null, tournament: { slug: 'rolex-shanghai-masters-2026', level: null }, sides: { A: P('pa', 'Player A'), B: P('pb', 'Player B') }, ...over });
const wtaMatch = (startMs, over = {}) => atpMatch(startMs, { event_type: 'WS', tournament: { slug: 'china-open-2026', level: 'WTA 1000' }, sides: { A: P('wa', 'Player W'), B: P('wb', 'Player X') }, ...over });
const dossier = (m, pA = 0.7) => ({ as_of: '2026-10-09', tour: m.event_type === 'MS' ? 'ATP' : 'WTA', matchup_version: '1.1.0', fixture: 'upcoming', match: m, why: ['Rated well above the opponent.'], model: { status: 'published', probability: { A: pA, B: 1 - pA }, overall_probability: { A: pA, B: 1 - pA }, basis: 'overall', model: { name: 'PBE Rating', method_version: 1, variant: 'standard' }, ratings: { A: { value: 1900, rated_matches: 80 }, B: { value: 1780, rated_matches: 60 } } } });
const bench = async () => ({ ok: true, json: async () => ({ schema: 'pbe-benchmarks/1', at_forecast: [] }) });
const keysUnder = (b, prefix) => [...b.m.keys()].filter((k) => k.startsWith(prefix));

test('cutover: one precise UTC instant shared by every official stream; the ATP official policy reuses the frozen rule unchanged', () => {
  assert.match(PICKS_ACTIVATED_AT, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(PICKER_POLICY.activated_at, PICKS_ACTIVATED_AT);
  assert.equal(ATP_OFFICIAL_POLICY.activated_at, PICKS_ACTIVATED_AT);
  assert.equal(OFFICIAL_STREAM.activatedAt, PICKS_ACTIVATED_AT);
  assert.deepEqual([ATP_OFFICIAL_POLICY.recal, ATP_OFFICIAL_POLICY.tau, ATP_OFFICIAL_POLICY.min_prior], [ATP_SHADOW_POLICY.recal, ATP_SHADOW_POLICY.tau, ATP_SHADOW_POLICY.min_prior]);
  assert.equal(ATP_SHADOW_POLICY.official, false, 'the shadow policy itself is never promoted');
  assert.notEqual(OFFICIAL_ATP_PREFIX, SHADOW_PREFIX);
});

test('WTA: a CALL recorded before the cutover stays research forever; one recorded at/after it is official; PASS is never a pick', async () => {
  const b = memBucket();
  const before = wtaMatch(-1 * H);                 // lock (T-60) at T-2h -> decided before the cutover
  const after = wtaMatch(3 * H);                   // lock at T+2h -> decided after
  const pass = wtaMatch(3 * H);                    // a 52% favourite -> PASS
  for (const [m, p] of [[before, 0.72], [after, 0.72], [pass, 0.52]]) await freezeOne(b, dossier(m, p), { now: at(-5 * H) });
  await decideMatch({ bucket: b, match: before, now: at(-2 * H + 60e3), fetchImpl: bench });
  await decideMatch({ bucket: b, match: after, now: at(2 * H + 60e3), fetchImpl: bench });
  await decideMatch({ bucket: b, match: pass, now: at(2 * H + 60e3), fetchImpl: bench });
  const rows = await readLedger(b);
  const byId = Object.fromEntries(rows.map((x) => [x.record.canonical_event_id, x.record]));
  assert.equal(byId[before.id].decision.official, false);
  assert.equal(byId[before.id].decision.policy_status, 'FROZEN_PROSPECTIVE', 'the pre-cutover record keeps the status it was made under');
  assert.equal(streamOf(byId[before.id]), 'prelaunch_wta');
  assert.equal(byId[after.id].decision.official, true);
  assert.equal(byId[after.id].decision.policy_status, 'OFFICIAL');
  assert.equal(streamOf(byId[after.id]), 'official_wta');
  assert.equal(byId[pass.id].decision.state, 'PASS');
  assert.equal(isOfficialPick(byId[pass.id]), false, 'a PASS is never counted as a pick');
  const rec = officialRecord(rows);
  assert.deepEqual([rec.all.picks, rec.WTA.picks, rec.ATP.picks, rec.all.pending, rec.all.W, rec.all.L], [1, 1, 0, 1, 0, 0]);
});

test('ATP official stream: forward-only, its own ledger; nothing before the cutover, no match locked before it; the shadow is untouched', async () => {
  const b = memBucket();
  const early = atpMatch(30 * 60e3);               // lock at T-30m: before the cutover
  const live = atpMatch(3 * H);                    // lock at T+2h
  for (const m of [early, live]) await freezeOne(b, dossier(m, 0.72), { now: at(-5 * H) });
  // before the cutover the official stream does nothing at all
  const pre = await decideShadowMatch({ bucket: b, match: live, now: at(-60e3), fetchImpl: bench, stream: OFFICIAL_STREAM });
  assert.equal(pre.skipped, 'before_activation');
  const sum = await runAtpShadow({ select: async () => { throw new Error('must not read before the cutover'); } }, { TENNIS_SOURCE: b }, { now: at(-60e3), stream: OFFICIAL_STREAM });
  assert.equal(sum.skipped.before_activation, 1);
  // after it: a match whose lock fell before the cutover is never decided by the official stream
  const late = await decideShadowMatch({ bucket: b, match: early, now: at(60e3), fetchImpl: bench, stream: OFFICIAL_STREAM });
  assert.equal(late.skipped, 'locked_before_activation');
  // the shadow keeps deciding as before, in its own ledger
  await decideShadowMatch({ bucket: b, match: live, now: at(2 * H + 60e3), fetchImpl: bench });
  const shadowKeys = keysUnder(b, SHADOW_PREFIX).sort();
  const off = await decideShadowMatch({ bucket: b, match: live, now: at(2 * H + 60e3), fetchImpl: bench, stream: OFFICIAL_STREAM });
  assert.equal(off.written, true);
  assert.deepEqual(keysUnder(b, SHADOW_PREFIX).sort(), shadowKeys, 'the official stream never writes under the shadow prefix');
  const [o] = await readShadowLedger(b, { stream: OFFICIAL_STREAM });
  const [s] = await readShadowLedger(b);
  assert.equal(o.record.scope, 'atp_official');
  assert.ok(o.record.record_id.endsWith(':atp-official'));
  assert.deepEqual([o.record.decision.official, o.record.decision.policy, o.record.decision.activated_at], [true, ATP_OFFICIAL_POLICY.version, PICKS_ACTIVATED_AT]);
  assert.deepEqual([s.record.decision.official, s.record.scope], [false, 'atp_shadow'], 'the shadow record for the same match stays research');
  assert.equal(o.record.decision.p_fav, s.record.decision.p_fav, 'same frozen rule, same probability');
  // one decision per match: a second pass never replaces it
  const again = await decideShadowMatch({ bucket: b, match: live, now: at(2 * H + 120e3), fetchImpl: bench, stream: OFFICIAL_STREAM });
  assert.equal(again.skipped, 'already_decided');
  // grading lands in the official ledger only
  const g = await gradeShadowMatch({ bucket: b, record: o.record, match: { status: 'completed', winner_side: 'A', started_at: at(3 * H) }, now: at(6 * H), fetchImpl: bench, stream: OFFICIAL_STREAM });
  assert.deepEqual([g.written, g.result], [true, 'W']);
  assert.ok(b.m.has(`${OFFICIAL_ATP_PREFIX}grades/${live.id}.json`) && !b.m.has(`${SHADOW_PREFIX}grades/${live.id}.json`));
  const rows = [...await readShadowLedger(b, { stream: OFFICIAL_STREAM }), ...await readShadowLedger(b)];
  const rec = officialRecord(rows);
  assert.deepEqual([rec.ATP.picks, rec.ATP.W, rec.ATP.graded, rec.ATP.hit_rate, rec.all.picks], [1, 1, 1, 1, 1], 'the shadow CALL on the same match is not counted');
});

test('official ATP PASS / HOLD are recorded but never official picks', async () => {
  const b = memBucket();
  const m = atpMatch(3 * H);
  await freezeOne(b, dossier(m, 0.53), { now: at(-5 * H) });
  await decideShadowMatch({ bucket: b, match: m, now: at(2 * H + 60e3), fetchImpl: bench, stream: OFFICIAL_STREAM });
  const [o] = await readShadowLedger(b, { stream: OFFICIAL_STREAM });
  assert.equal(o.record.decision.state, 'PASS');
  assert.equal(o.record.decision.official, false);
  assert.equal(officialRecord([o]).all.picks, 0);
});

test('no retroactive promotion: every prelaunch record (V1 pre-cutover, WTA 125, ATP shadow) stays out of the official record', () => {
  const mk = (scope, decided_at, official = false, tour = 'WTA') => ({ record: { scope, event: { tour }, lock: { decided_at }, decision: { state: 'CALL', official } }, grade: { grade: { result: 'W' } } });
  const rows = [mk('wta_main', at(-H)), mk('shadow_wta125', at(H), false, 'WTA 125'), mk('atp_shadow', at(H), false, 'ATP'), mk('atp', at(H), false, 'ATP')];
  const rec = officialRecord(rows);
  assert.deepEqual([rec.all.picks, rec.all.W], [0, 0], 'zero fake wins');
  assert.deepEqual(rows.map((x) => streamOf(x.record)), ['prelaunch_wta', 'prelaunch_wta125', 'prelaunch_atp', 'atp_v1']);
  // a forged "official" flag on a shadow record still does not make it an official pick
  assert.equal(isOfficialPick({ scope: 'atp_shadow', decision: { state: 'CALL', official: true } }), false);
});

test('guests: the public track record carries no pending official selection; members get official picks only', async () => {
  const b = memBucket();
  const m = atpMatch(3 * H);
  const w = wtaMatch(3 * H);
  await freezeOne(b, dossier(m, 0.72), { now: at(-5 * H) });
  await freezeOne(b, dossier(w, 0.75), { now: at(-5 * H) });
  await decideShadowMatch({ bucket: b, match: m, now: at(2 * H + 60e3), fetchImpl: bench, stream: OFFICIAL_STREAM });
  await decideShadowMatch({ bucket: b, match: m, now: at(2 * H + 60e3), fetchImpl: bench });
  await decideMatch({ bucket: b, match: w, now: at(2 * H + 60e3), fetchImpl: bench });
  const pub = await picksRoute('/v1/picks/track-record', null, { TENNIS_SOURCE: b });
  const body = JSON.stringify(pub.data);
  assert.equal(pub.data.resolved.length, 0);
  assert.ok(!/Player A|Player W|"selection_id":"(pa|wa)"/.test(body), 'no pending player or side');
  assert.ok(!/"probability(_a|_raw_a|_uncalibrated)?":0\.\d/.test(body), 'no unresolved probability');
  assert.deepEqual([pub.data.official.all.picks, pub.data.official.all.pending], [2, 2]);
  const mem = await picksRoute('/v1/picks', null, { TENNIS_SOURCE: b });
  assert.equal(mem.data.picks.length, 2, 'the shadow CALL on the same match is not shown as a pick');
  assert.ok(mem.data.picks.every((p) => p.official && p.side && p.probability > 0.5));
  // the premium gate stays in index.js (fail-closed, private no-store)
  const src = fs.readFileSync(new URL('../workers/tennis-api/src/index.js', import.meta.url), 'utf8');
  assert.ok(src.includes(String.raw`/^\/v1\/picks(?:\/[0-9a-f-]{36})?$/,`));
  // resolved picks become public with the side once graded (shape only)
  const [row] = await readShadowLedger(b, { stream: OFFICIAL_STREAM });
  const shaped = shapePick({ ...row, grade: { grade: { result: 'L', reason: 'completed', scores: null }, graded_at: at(6 * H), result: { score: '6-4 6-4', winner_side: 'B' } } }, { reveal: false });
  assert.deepEqual([shaped.side, shaped.official, shaped.grade.result], ['A', true, 'L'], 'a loss is public and stays official');
});

test('UI: no sideways scrolling tables; no disclaimer wall; official copy; nav labels without a research suffix', () => {
  const css = fs.readFileSync(new URL('../src/styles/picks.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const js = fs.readFileSync(new URL('../src/pages/picks.js', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /overflow-x/);
  assert.doesNotMatch(css, /overflow:\s*hidden[^}]*\.pk-(card|row|tiles)/);
  assert.doesNotMatch(js, /<table/);
  assert.doesNotMatch(js, /RESEARCH ONLY|PROSPECTIVE · NOT OFFICIAL|Read this first|SHADOW · ATP|research, not official/i, 'the old disclaimer wall is gone');
  assert.match(js, /Our algorithm selects matches before play\. Every selection is time-locked and counted in the public track record\./);
  assert.match(js, /Official Picks · All Access/);
  assert.match(js, /How Picks Work/);
  const shell = fs.readFileSync(new URL('../src/ui/shell.js', import.meta.url), 'utf8');
  assert.match(shell, /label: 'Picks'/); assert.match(shell, /label: 'Track Record'/);
  const hub = fs.readFileSync(new URL('../src/lib/all-access.js', import.meta.url), 'utf8');
  assert.doesNotMatch(hub, /PBE Picks \(research\)|Not activated/);
  // every probability-bar width class exists (no inline style under CSP)
  for (let i = 0; i <= 100; i += 5) assert.ok(css.includes(`.pk-f${i} {`), `pk-f${i}`);
});

test('a record built at the exact cutover instant is official; one millisecond earlier is not', () => {
  const m = wtaMatch(3 * H);
  const lock = { rule: 'T_MINUS_60', lock_at: at(2 * H), scheduled_at: at(3 * H) };
  const snap = { payload: dossier(m, 0.75), key: 'k', content_hash: 'h', freeze_version: 'f', frozen_at: at(-H) };
  const mk = (now) => buildRecord({ match: m, scope: 'wta_main', lock, snapshot: snap, benchmarks: null, now, started: false });
  assert.equal(mk(PICKS_ACTIVATED_AT).decision.official, true);
  assert.equal(mk(new Date(T - 1).toISOString()).decision.official, false);
});
