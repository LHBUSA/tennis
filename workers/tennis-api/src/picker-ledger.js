// TENNIS PICKER V1 LEDGER (R2, write-once, same immutability pattern as matchup-freeze/1 and mm2-shadow/1).
//   ledger/picker-v1/decisions/<match_id>.json        ONE designated decision per match (pbe-decision-record/1)
//   ledger/picker-v1/grades/<match_id>.json           ONE grade per CALL (W / L / VOID) + scores + market path at start
//   ledger/picker-v1/corrections/<match_id>/<ts>.json append-only corrections (reason required); never a mutation
// Every write is head-checked first and never overwrites. Nothing here is official until the owner activates the policy
// (PICKER_POLICY.activated_at), and activation never makes an earlier decision official.
import { PICKER_POLICY, scopeOf, lockFor, buildRecord, grade, scores } from './picker.js';
import { snapshotAtOrBefore } from './matchup-freeze.js';
import { detail } from './matchup.js';

export const LEDGER_PREFIX = 'ledger/picker-v1/';
export const decisionKey = (id) => `${LEDGER_PREFIX}decisions/${id}.json`;
export const gradeKey = (id) => `${LEDGER_PREFIX}grades/${id}.json`;
// first observation of an in-scope match while it was still SCHEDULED: only such a match may later receive an
// after-start HOLD. A match the ledger never saw before play gets no record at all (never a post-hoc one).
export const seenKey = (id) => `${LEDGER_PREFIX}seen/${id}.json`;
export const correctionKey = (id, at) => `${LEDGER_PREFIX}corrections/${id}/${at.replace(/[:.]/g, '-')}.json`;
const MARKETS = 'https://propsports-markets.sales-fd3.workers.dev';
const BENCHMARK_DEFER_MS = 30 * 60e3; // a markets outage defers the write; after 30 min the record says UNAVAILABLE
const DAY_WINDOW_MS = 6 * 3600e3;

/** Write-once put: refuses to overwrite. Returns true when written. */
export async function putOnce(bucket, key, obj) {
  if (await bucket.head(key)) return false;
  await bucket.put(key, JSON.stringify(obj), { httpMetadata: { contentType: 'application/json' } });
  return true;
}
export async function getJson(bucket, key) { const o = await bucket.get(key); return o ? JSON.parse(await o.text()) : null; }

/** benchmarksAt from the shared markets Worker for OUR observations at or before pbe_at; null when unreachable. */
export async function fetchBenchmarks(fetchImpl, { id, pbeAt, selection }, base = MARKETS) {
  try {
    const q = new URLSearchParams({ sport: 'tennis', event: id, pbe_at: pbeAt });
    if (selection) q.set('selection', selection);
    const r = await fetchImpl(`${base}/v1/benchmarks-at?${q}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const b = await r.json();
    return Array.isArray(b?.at_forecast) ? b : null;
  } catch { return null; }
}

/** Decide one match if its designated lock has passed and no decision exists. Pure enough to test with fakes. */
export async function decideMatch({ bucket, match, now, fetchImpl, policy = PICKER_POLICY, benchBase }) {
  const scope = scopeOf(match);
  if (scope === 'out_of_scope') return { id: match.id, skipped: 'out_of_scope' };
  if (await bucket.head(decisionKey(match.id))) return { id: match.id, skipped: 'already_decided' };
  const lock = lockFor(match);
  // a stored status can lag play: past the decision window (the sourced start for T-60; 6 h after a 00:00-local
  // DAY_START_LOCK) the match counts as started, so no decision is ever taken while play may be under way
  const windowEnd = lock.rule === 'T_MINUS_60' ? Date.parse(lock.scheduled_at) : lock.rule === 'DAY_START_LOCK' ? Date.parse(lock.lock_at) + DAY_WINDOW_MS : Infinity;
  const started = match.status !== 'scheduled' || Date.parse(now) >= windowEnd;
  if (started && !(await bucket.head(seenKey(match.id)))) return { id: match.id, skipped: 'not_observed_before_start' };
  if (!started) await putOnce(bucket, seenKey(match.id), { match_id: match.id, scope, first_seen_at: now, scheduled_at: match.scheduled_at ?? null });
  // no lock time yet and still scheduled: a lock may still become known — wait (the designated decision is not taken)
  if (!lock.lock_at && !started) return { id: match.id, skipped: 'no_lock_yet' };
  if (lock.lock_at && Date.parse(lock.lock_at) > Date.parse(now) && !started) return { id: match.id, skipped: 'before_lock', lock_at: lock.lock_at };
  const snapshot = lock.lock_at && !started ? await snapshotAtOrBefore(bucket, match.id, lock.lock_at) : null;
  const preview = buildRecord({ match, scope, lock, snapshot, benchmarks: null, now, started, policy });
  let benchmarks = null;
  if (lock.lock_at && !started) {
    benchmarks = await fetchBenchmarks(fetchImpl, { id: match.id, pbeAt: lock.lock_at, selection: preview.contract.selection_id }, benchBase);
    if (!benchmarks && Date.parse(now) - Date.parse(lock.lock_at) < BENCHMARK_DEFER_MS) return { id: match.id, skipped: 'benchmarks_deferred' };
  }
  const record = buildRecord({ match, scope, lock, snapshot, benchmarks, now, started, policy });
  const written = await putOnce(bucket, decisionKey(match.id), record);
  return { id: match.id, written, state: record.decision.state, reasons: record.decision.reasons, lock_rule: lock.rule };
}

/** Grade one CALL from our canonical result (+ OUR last market observations at or before the start). */
export async function gradeMatch({ bucket, record, match, now, fetchImpl, benchBase }) {
  if (record.decision.state !== 'CALL') return { id: record.canonical_event_id, skipped: 'not_a_call' };
  if (await bucket.head(gradeKey(record.canonical_event_id))) return { id: record.canonical_event_id, skipped: 'already_graded' };
  const g = grade(record, match);
  if (!g) return { id: record.canonical_event_id, skipped: 'not_final' };
  const startAt = match.started_at || null;
  const preStart = startAt ? await fetchBenchmarks(fetchImpl, { id: record.canonical_event_id, pbeAt: startAt, selection: record.contract.selection_id }, benchBase) : null;
  const out = {
    schema: 'pbe-decision-grade/1', record_id: record.record_id, canonical_event_id: record.canonical_event_id, graded_at: now,
    result: { status: match.status, winner_side: match.winner_side ?? null, end_reason: match.end_reason ?? null, started_at: startAt, score: match.score ?? null, source: 'canonical tennis_matches' },
    grade: { ...g, graded_at: now, scores: scores(record, g) },
    path: { pre_start: preStart ? { pbe_at: startAt, at_forecast: preStart.at_forecast } : null },
  };
  const written = await putOnce(bucket, gradeKey(record.canonical_event_id), out);
  return { id: record.canonical_event_id, written, result: g.result };
}

async function listKeys(bucket, prefix, max = 5000) {
  const keys = [];
  let cursor;
  do { const r = await bucket.list({ prefix, cursor, limit: 1000 }); keys.push(...r.objects.map((o) => o.key)); cursor = r.truncated ? r.cursor : undefined; } while (cursor && keys.length < max);
  return keys;
}

/** Append a correction (never a mutation). `excluded` removes the record from every count; the record stays readable. */
export async function appendCorrection(bucket, { id, reason, excluded = false, note = null, at = new Date().toISOString() }) {
  if (!reason) throw new Error('a correction needs a reason');
  return putOnce(bucket, correctionKey(id, at), { schema: 'pbe-decision-correction/1', record_id: `tennis:${id}:PRE_MATCH_LOCK`, canonical_event_id: id, reason, excluded, note, at });
}

/** All stored decisions (+ grades + corrections), newest first. */
export async function readLedger(bucket, { limit = 500 } = {}) {
  const keys = await listKeys(bucket, `${LEDGER_PREFIX}decisions/`);
  const corr = new Map();
  for (const k of await listKeys(bucket, `${LEDGER_PREFIX}corrections/`)) {
    const c = await getJson(bucket, k);
    if (c) corr.set(c.canonical_event_id, [...(corr.get(c.canonical_event_id) || []), c]);
  }
  const rows = [];
  for (const k of keys.slice(-limit)) {
    const rec = await getJson(bucket, k);
    if (!rec) continue;
    const corrections = corr.get(rec.canonical_event_id) || [];
    rows.push({ record: rec, grade: rec.decision.state === 'CALL' ? await getJson(bucket, gradeKey(rec.canonical_event_id)) : null, corrections, excluded: corrections.some((c) => c.excluded) });
  }
  return rows.sort((a, b) => String(b.record.lock.lock_at || b.record.lock.decided_at).localeCompare(String(a.record.lock.lock_at || a.record.lock.decided_at)));
}

/**
 * CRON pass (tennis-api every 10 min, after the freezer): decide due matches, record honest HOLDs for in-scope matches that
 * started without a decision, grade finished CALLs. Bounded per tick.
 */
export async function runPicker(store, env, { now = new Date().toISOString(), fetchImpl = fetch, limit = 25 } = {}) {
  const bucket = env?.TENNIS_SOURCE;
  if (!bucket || !store) return { error: 'not_configured' };
  const t = Date.parse(now);
  const iso = (ms) => new Date(ms).toISOString();
  const sum = { at: now, policy: PICKER_POLICY.version, considered: 0, decided: [], graded: [], skipped: {} };
  const ids = new Set();
  // scheduled singles with an exact start inside [-6 h, +36 h] (lock T-60 falls inside), or a source-proven day
  for (const r of await store.select('tennis_matches', `select=match_id&status=eq.scheduled&event_type=in.(MS,WS)&scheduled_at=gte.${iso(t - 6 * 3600e3)}&scheduled_at=lte.${iso(t + 36 * 3600e3)}&limit=300`)) ids.add(r.match_id);
  if (env.SCHEDULE_DAY_COLUMNS === '1') for (const r of await store.select('tennis_matches', `select=match_id&status=eq.scheduled&event_type=in.(MS,WS)&scheduled_at=is.null&scheduled_day=gte.${iso(t - 86400e3).slice(0, 10)}&scheduled_day=lte.${iso(t + 86400e3).slice(0, 10)}&limit=300`)) ids.add(r.match_id);
  // scheduled singles on an order of play without a sourced start (WTA "Not before …" / "Followed by"): observed while
  // scheduled, so an honest HOLD can be recorded if play begins with no lock
  for (const r of await store.select('tennis_matches', `select=match_id&status=eq.scheduled&event_type=in.(MS,WS)&scheduled_at=is.null&schedule_note=not.is.null&limit=300`)) ids.add(r.match_id);
  // matches observed while scheduled that have no decision yet (they may have started without a lock -> HOLD)
  for (const k of await listKeys(bucket, `${LEDGER_PREFIX}seen/`, 3000)) ids.add(k.slice(`${LEDGER_PREFIX}seen/`.length, -5));
  const decided = new Set((await listKeys(bucket, `${LEDGER_PREFIX}decisions/`)).map((k) => k.slice(`${LEDGER_PREFIX}decisions/`.length, -5)));
  let work = 0;
  for (const id of ids) {
    if (work >= limit) break;
    if (decided.has(id)) continue;
    sum.considered += 1;
    try {
      const data = await detail(store, env, id, { raw: true });
      if (!data?.match) continue;
      const res = await decideMatch({ bucket, match: { ...data.match, tour: data.match.tour ?? null }, now, fetchImpl });
      if (res.skipped) sum.skipped[res.skipped] = (sum.skipped[res.skipped] || 0) + 1; else { sum.decided.push(res); work += 1; }
    } catch (e) { sum.skipped.error = (sum.skipped.error || 0) + 1; }
  }
  // grading: CALLs without a grade
  for (const { record, grade: g, excluded } of await readLedger(bucket, { limit: 300 })) {
    if (g || excluded || record.decision.state !== 'CALL') continue;
    const [m] = await store.select('tennis_matches', `select=match_id,status,winner_side,end_reason,started_at,score_text&match_id=eq.${record.canonical_event_id}`);
    if (!m) continue;
    const res = await gradeMatch({ bucket, record, match: { status: m.status, winner_side: m.winner_side, end_reason: m.end_reason, started_at: m.started_at, score: m.score_text }, now, fetchImpl });
    if (res.written) sum.graded.push(res);
  }
  if (env.TENNIS_STATE) await env.TENNIS_STATE.put('picker:v1:last', JSON.stringify({ ...sum, decided: sum.decided.slice(0, 25) }));
  return sum;
}
