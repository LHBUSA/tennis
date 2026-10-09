// PICKS LOCK VERIFICATION LEDGER (pbe-lock-verification/1) — a bounded, READ-ONLY check of the picks ledgers that runs in
// the existing tennis-api */10 tick (scheduled.js). It never writes, edits or backfills a decision: it only reads stored
// decision bytes and appends its own findings, create-only, under a private prefix of the tennis-source bucket:
//   ledger/verification/v1/<scope>/<match_id>/lock.json    once the decision exists
//   ledger/verification/v1/<scope>/<match_id>/start.json   once the canonical match has started / finished
// Checks per decision (ATP shadow + WTA Picker V1, decided_at >= VERIFY_FROM):
//   lock:  singles only (record + canonical row: MS/WS, one player per side); decided_at >= lock_at; decided_at < the
//          sourced start known at the lock (T-60 rule) / for a day lock the match was still scheduled when first seen;
//          record sha256 re-computed from the stored R2 bytes; evidence: the cited snapshot exists, its payload re-hashes to
//          its content_hash == the record's evidence sha256, it was frozen while scheduled and at or before the lock;
//          the public record counts it (inside the public reader's window, not excluded by a correction).
//   start: decided_at < the canonical started_at (or the grade's started_at) once known; UNVERIFIABLE when the match is
//          final and no source ever gave a start time (never guessed).
// A summary without sides / probabilities goes to KV picks:verify:summary (public via /health and the track record);
// full entries are owner-only (/v1/picks/verification). No alert channel is bound to tennis-api, so FAIL is surfaced in
// the summary (last_fail) only.
import { contentHash } from './matchup-freeze.js';
import { SHADOW_PREFIX, OFFICIAL_ATP_PREFIX } from './picker-v2-atp.js';
import { LEDGER_PREFIX } from './picker-ledger.js';

export const VERIFY_SCHEMA = 'pbe-lock-verification/1';
export const VERIFY_PREFIX = 'ledger/verification/v1/';
export const VERIFY_FROM = '2026-10-09T11:00:00Z'; // the ATP shadow ledger's first tick; earlier V1 decisions are not in scope
export const SUMMARY_KEY = 'picks:verify:summary';
const LEDGERS = [
  { scope: 'atp_shadow', prefix: SHADOW_PREFIX, publicWindow: 400 },
  { scope: 'atp_official', prefix: OFFICIAL_ATP_PREFIX, publicWindow: 1000 },
  { scope: 'wta_v1', prefix: LEDGER_PREFIX, publicWindow: 1000 },
];
const DAY_WINDOW_MS = 6 * 3600e3;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256Text = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
export const entryKey = (scope, id, stage) => `${VERIFY_PREFIX}${scope}/${id}/${stage}.json`;

async function listAll(bucket, prefix) {
  const keys = [];
  let cursor;
  do { const r = await bucket.list({ prefix, cursor, limit: 1000 }); keys.push(...r.objects.map((o) => o.key)); cursor = r.truncated ? r.cursor : undefined; } while (cursor);
  return keys;
}
async function putCreateOnly(bucket, key, obj) {
  if (await bucket.head(key)) return false;
  return (await bucket.put(key, JSON.stringify(obj), { httpMetadata: { contentType: 'application/json' }, onlyIf: new Headers({ 'if-none-match': '*' }) })) != null;
}
const singlesRecord = (r) => !!(r?.event?.a?.id && r?.event?.b?.id && r.event.a.id !== r.event.b.id);

/** Pure-ish: the lock-stage checks of one stored decision. `row` = canonical tennis_matches row (or null). */
export async function lockChecks({ bucket, text, record: r, row, inPublicWindow, excluded }) {
  const c = {};
  const decided = Date.parse(r.lock?.decided_at);
  c.record_sha256 = await sha256Text(text);
  c.singles = singlesRecord(r) && (!row || (['MS', 'WS'].includes(row.event_type)));
  c.scope_tour_match = !row || (/^atp_(shadow|official)$/.test(r.scope) ? row.event_type === 'MS' : row.event_type === 'WS');
  if (r.lock?.lock_at) c.decided_after_lock = decided >= Date.parse(r.lock.lock_at);
  if (r.lock?.lock_rule === 'T_MINUS_60') c.decided_before_sourced_start = decided < Date.parse(r.lock.scheduled_at_known_at_lock);
  if (r.lock?.lock_rule === 'DAY_START_LOCK') c.decided_within_day_window = decided < Date.parse(r.lock.lock_at) + DAY_WINDOW_MS;
  if (r.lock?.lock_rule && r.decision?.state !== 'HOLD') c.first_seen_before_decision = !!r.lock.first_seen_scheduled_at && Date.parse(r.lock.first_seen_scheduled_at) <= decided;
  if (r.evidence?.snapshot_ref) {
    const o = await bucket.get(r.evidence.snapshot_ref);
    const snap = o ? JSON.parse(await o.text()) : null;
    const rehash = snap ? await contentHash(snap.payload) : null;
    c.evidence_exists = !!snap;
    c.evidence_rehash_matches = !!snap && rehash === snap.content_hash && rehash === r.evidence.sha256;
    c.evidence_frozen_while_scheduled = !!snap && snap.frozen_status === 'scheduled';
    c.evidence_frozen_before_lock = !!snap && Date.parse(snap.frozen_at) <= Date.parse(r.lock.lock_at || r.lock.decided_at);
    c.evidence_sha256 = rehash;
  } else if (r.decision?.state !== 'HOLD') c.evidence_exists = false; // a CALL/PASS must cite its frozen evidence
  c.counted_publicly = inPublicWindow && !excluded;
  const bad = Object.entries(c).filter(([k, v]) => v === false).map(([k]) => k);
  return { checks: c, failed: bad, verdict: bad.length ? 'FAIL' : 'PASS' };
}

export const CHECK_VERSION = 'lock-verify/2'; // /1 wrongly timed HOLD records (a HOLD is not a pre-match call)
export function startChecks({ record: r, row, grade }) {
  // a HOLD is the honest record that NO pre-match call was made (no lock, or play had begun): there is no lock to time
  if (r.decision?.state === 'HOLD') return { started_at: row?.started_at ?? null, source: null, verdict: 'NOT_A_LOCK', failed: [], note: `HOLD (${(r.decision.reasons || []).join(', ')}): no pre-match call to verify against the start` };
  const startedAt = row?.started_at || grade?.result?.started_at || null;
  if (startedAt) {
    const ok = Date.parse(r.lock.decided_at) < Date.parse(startedAt);
    return { started_at: startedAt, source: row?.started_at ? 'canonical tennis_matches.started_at' : 'grade.result.started_at', verdict: ok ? 'PASS' : 'FAIL', failed: ok ? [] : ['decided_before_canonical_start'] };
  }
  if (row && !['scheduled', 'in_progress', 'suspended'].includes(row.status)) return { started_at: null, source: null, verdict: 'UNVERIFIABLE', failed: [], note: `match ${row.status} and no source gave a start time; scheduled_at ${row.scheduled_at ?? 'null'} (never guessed)` };
  return null; // not started yet: nothing to write
}

/** CRON step: bounded (<= `limit` new entries per tick). Returns the summary it stored. */
export async function runVerification(store, env, { now = new Date().toISOString(), limit = 12 } = {}) {
  const bucket = env?.TENNIS_SOURCE;
  if (!bucket || !store) return { error: 'not_configured' };
  const done = new Set((await listAll(bucket, VERIFY_PREFIX)).map((k) => k.slice(VERIFY_PREFIX.length).replace(/\.json$/, '')));
  const queue = [];
  for (const L of LEDGERS) {
    const keys = await listAll(bucket, `${L.prefix}decisions/`);
    const ids = keys.map((k) => k.slice(`${L.prefix}decisions/`.length).replace(/\.json$/, ''));
    const window = new Set(ids.slice(-L.publicWindow));
    for (const id of ids) {
      const needLock = !done.has(`${L.scope}/${id}/lock`);
      const needStart = !done.has(`${L.scope}/${id}/start`);
      if (needLock || needStart) queue.push({ L, id, needLock, needStart, inWindow: window.has(id) });
    }
  }
  queue.sort((a, b) => Number(b.needLock) - Number(a.needLock)); // new decisions first: pending starts never starve them
  const out = { at: now, schema: VERIFY_SCHEMA, written: [], skipped_old: 0 };
  const batch = queue.slice(0, limit * 4);
  const rows = new Map();
  for (let i = 0; i < batch.length; i += 80) {
    const ids = [...new Set(batch.slice(i, i + 80).map((t) => t.id))];
    if (ids.length) for (const r of await store.select('tennis_matches', `select=match_id,event_type,status,scheduled_at,started_at&match_id=in.(${ids.join(',')})`)) rows.set(r.match_id, r);
  }
  let work = 0;
  for (const t of batch) {
    if (work >= limit) break;
    const o = await bucket.get(`${t.L.prefix}decisions/${t.id}.json`);
    if (!o) continue;
    const text = await o.text();
    const record = JSON.parse(text);
    if (!(Date.parse(record.lock?.decided_at) >= Date.parse(VERIFY_FROM)) || (t.L.scope === 'wta_v1' && record.scope === 'atp')) { out.skipped_old += 1; if (t.needLock) await putCreateOnly(bucket, entryKey(t.L.scope, t.id, 'lock'), { schema: VERIFY_SCHEMA, scope: t.L.scope, match_id: t.id, stage: 'lock', at: now, verdict: 'OUT_OF_SCOPE', note: record.scope === 'atp' ? 'Picker V1 ATP PASS lane (not a WTA decision)' : `decided before ${VERIFY_FROM}` }); if (t.needStart) await putCreateOnly(bucket, entryKey(t.L.scope, t.id, 'start'), { schema: VERIFY_SCHEMA, scope: t.L.scope, match_id: t.id, stage: 'start', at: now, verdict: 'OUT_OF_SCOPE' }); continue; }
    const row = rows.get(t.id) || null;
    const base = { schema: VERIFY_SCHEMA, scope: t.L.scope, match_id: t.id, record_id: record.record_id, policy: record.decision?.policy, decision_state_public: record.decision?.state === 'CALL' ? 'LOCKED' : record.decision?.state, decided_at: record.lock?.decided_at, lock_at: record.lock?.lock_at, lock_rule: record.lock?.lock_rule, at: now };
    if (t.needLock) {
      const corr = await bucket.list({ prefix: `${t.L.prefix}corrections/${t.id}/` });
      let excluded = false;
      for (const c of corr.objects || []) { const x = await bucket.get(c.key); if (x && JSON.parse(await x.text()).excluded) excluded = true; }
      const res = await lockChecks({ bucket, text, record, row, inPublicWindow: t.inWindow, excluded });
      if (await putCreateOnly(bucket, entryKey(t.L.scope, t.id, 'lock'), { ...base, stage: 'lock', ...res })) { out.written.push({ scope: t.L.scope, id: t.id, stage: 'lock', verdict: res.verdict }); work += 1; }
    }
    if (t.needStart) {
      const g = record.decision?.state === 'CALL' ? await bucket.get(`${t.L.prefix}grades/${t.id}.json`) : null;
      const res = startChecks({ record, row, grade: g ? JSON.parse(await g.text()) : null });
      if (res && await putCreateOnly(bucket, entryKey(t.L.scope, t.id, 'start'), { ...base, stage: 'start', ...res })) { out.written.push({ scope: t.L.scope, id: t.id, stage: 'start', verdict: res.verdict }); work += 1; }
    }
  }
  // summary (aggregate only; no side / probability anywhere in the verification ledger)
  const prev = env.TENNIS_STATE ? await env.TENNIS_STATE.get(SUMMARY_KEY, 'json').catch(() => null) : null;
  const s = prev && prev.schema === VERIFY_SCHEMA ? prev : { schema: VERIFY_SCHEMA, since: now, counts: {}, last_fail: null };
  // appended correction (never a rewrite) for a FAIL produced by check /1 on a HOLD record
  if (s.last_fail && !s.last_fail.corrected) {
    const e = await bucket.get(entryKey(s.last_fail.scope, s.last_fail.match_id, s.last_fail.stage));
    const entry = e ? JSON.parse(await e.text()) : null;
    if (entry?.verdict === 'FAIL' && entry.stage === 'start' && entry.decision_state_public === 'HOLD') {
      await putCreateOnly(bucket, `${VERIFY_PREFIX}${entry.scope}/${entry.match_id}/start.correction-1.json`, { schema: VERIFY_SCHEMA, kind: 'correction', corrects: entryKey(entry.scope, entry.match_id, 'start'), at: now, reason: 'CHECK_DEFINITION_ERROR', note: `${CHECK_VERSION}: a HOLD records that no pre-match call was made; check /1 wrongly timed it against the start. Corrected verdict NOT_A_LOCK. The original entry is kept.`, corrected_verdict: 'NOT_A_LOCK' });
      const c = s.counts[`${entry.scope}:start`];
      if (c && c.FAIL > 0) { c.FAIL -= 1; c.NOT_A_LOCK = (c.NOT_A_LOCK || 0) + 1; }
      s.corrections = [...(s.corrections || []), { at: now, scope: entry.scope, stage: 'start', reason: 'CHECK_DEFINITION_ERROR' }];
      s.last_fail = null;
    }
  }
  s.check_version = CHECK_VERSION;
  for (const w of out.written) {
    const k = `${w.scope}:${w.stage}`;
    const c = (s.counts[k] ||= { PASS: 0, FAIL: 0, UNVERIFIABLE: 0, OUT_OF_SCOPE: 0 });
    c[w.verdict] = (c[w.verdict] || 0) + 1;
    if (w.verdict === 'FAIL') s.last_fail = { at: now, scope: w.scope, match_id: w.id, stage: w.stage };
  }
  s.last_run_at = now; s.last_written = out.written.length; s.pending = undefined; s.pending_lock_checks = Math.max(0, queue.filter((q) => q.needLock).length - out.written.filter((w) => w.stage === 'lock').length - out.skipped_old);
  if (env.TENNIS_STATE) await env.TENNIS_STATE.put(SUMMARY_KEY, JSON.stringify(s));
  return { ...out, summary: s };
}

/** Owner-only read: the newest verification entries (no sides / probabilities are stored in them). */
export async function readVerification(bucket, { limit = 200 } = {}) {
  const keys = (await listAll(bucket, VERIFY_PREFIX)).slice(-limit);
  const out = [];
  for (const k of keys) { const o = await bucket.get(k); if (o) out.push(JSON.parse(await o.text())); }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
