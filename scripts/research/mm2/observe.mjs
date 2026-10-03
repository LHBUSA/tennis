// Matchup Model V2 — OBSERVE-ONLY durable observer (Windows Task Scheduler; no Worker, no Action, no new resource).
// It only runs the EXISTING read-only scripts and records what it saw; it never changes the model, the freezer, the
// shadow writer, the state build, production, or any R2/DB object, and never creates, repairs or reruns evidence.
//   node scripts/research/mm2/observe.mjs shadow   # first natural shadow write + immutability (prove-shadow.mjs)
//   node scripts/research/mm2/observe.mjs grade    # every natural grade, continuously (grade-shadow.mjs, prove-shadow.mjs <id>)
// shadow: outcome recorded once in $MM2_DATA/observer/shadow.result.json:
//   PASS  every invariant held · FAIL  the exact failed checks (no retry) · ABSENT  not seen within MAX_ATTEMPTS runs
// grade (mm2-observer/2, continuous): each run refreshes the scoreboard, proves every newly graded match once and appends
//   one line per match to grade.ledger.jsonl (PASS, or FAIL with the exact failed invariants). A FAIL writes
//   grade.halt.json and the observer stops until a human has read it. No graded match yet = a log line; the next run retries.
//   grade.result.json is the observer/1 record (2026-10-03 06:37Z FAIL) and is never rewritten; the corrected evaluation
//   of that match is appended to grade.events.jsonl, which quotes it.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { OBSERVER_VERSION, gradeInvariants } from './lib/observer.mjs';

const MODE = process.argv[2];
if (!['shadow', 'grade'].includes(MODE)) throw new Error('usage: observe.mjs shadow|grade');
const MAX_ATTEMPTS = 8;
const PER_RUN = 6; // proofs per run (each proof is about a dozen read-only R2 reads)
const DIR = path.join(process.env.MM2_DATA || 'D:/Workers/research-data/tennis-mm2', 'observer');
fs.mkdirSync(DIR, { recursive: true });
const RESULT = path.join(DIR, `${MODE}.result.json`);
const LOG = path.join(DIR, `${MODE}.log`);
const log = (s) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`);
const run = (args, env = {}) => {
  try { return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }) }; }
  catch (e) { return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};
const lastJson = (out) => { const l = out.trim().split('\n').reverse().find((x) => x.trim().startsWith('{')); try { return l ? JSON.parse(l) : null; } catch { return null; } };
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f, o) => fs.appendFileSync(f, `${JSON.stringify(o)}\n`);

if (MODE === 'shadow') {
  const finish = (status, detail) => { fs.writeFileSync(RESULT, JSON.stringify({ mode: MODE, status, at: new Date().toISOString(), ...detail }, null, 1)); log(`${status} ${JSON.stringify(detail).slice(0, 2000)}`); };
  if (fs.existsSync(RESULT)) { log(`already recorded (${JSON.parse(fs.readFileSync(RESULT, 'utf8')).status}); nothing to do`); process.exit(0); }
  const STATE = path.join(DIR, 'shadow.attempts.json');
  const attempts = (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')).n : 0) + 1;
  fs.writeFileSync(STATE, JSON.stringify({ n: attempts }));
  const r = run(['scripts/research/mm2/prove-shadow.mjs']);
  if (/NO_NATURAL_SHADOW_YET/.test(r.out)) {
    log(`attempt ${attempts}/${MAX_ATTEMPTS}: natural state absent — no scored natural shadow record yet`);
    if (attempts >= MAX_ATTEMPTS) finish('ABSENT', { reason: 'no scored natural shadow record yet', attempts });
  } else {
    const j = lastJson(r.out);
    if (!j) finish('FAIL', { reason: 'prove-shadow produced no result', exit: r.code, output: r.out.slice(-1500) });
    else if (j.first_write && j.immutability) finish('PASS', { match_id: j.match, tour: j.tour, shadow_key: j.shadow, sha256: j.sha256, proof: 'docs/evidence/matchup-model-v2-shadow-proof.json' });
    else finish('FAIL', { match_id: j.match, failed_first_write: j.failed1, failed_immutability: j.failed2, proof: 'docs/evidence/matchup-model-v2-shadow-proof.json' });
  }
} else {
  const HALT = path.join(DIR, 'grade.halt.json');
  const LEDGER = path.join(DIR, 'grade.ledger.jsonl');
  const EVENTS = path.join(DIR, 'grade.events.jsonl');
  const PROOFS = path.join(DIR, 'proofs');
  fs.mkdirSync(PROOFS, { recursive: true });
  const halt = (detail) => { fs.writeFileSync(HALT, JSON.stringify({ observer_version: OBSERVER_VERSION, at: new Date().toISOString(), ...detail }, null, 1)); log(`HALT ${JSON.stringify(detail).slice(0, 2000)}`); };
  if (fs.existsSync(HALT)) { log('halted (grade.halt.json present): read it; nothing done'); process.exit(0); }

  const g = run(['scripts/research/mm2/grade-shadow.mjs', '2026-10-02']);
  const s = lastJson(g.out);
  if (!s) { halt({ reason: 'grade-shadow produced no result', exit: g.code, output: g.out.slice(-1500) }); process.exit(0); }
  if (!s.graded) { log(`no graded match yet (shadow records ${s.records}, matches ${s.matches}, pending ${s.pending})`); process.exit(0); }

  const done = new Set(readJsonl(LEDGER).map((x) => x.match_id));
  const rows = JSON.parse(fs.readFileSync('docs/evidence/matchup-model-v2-shadow-latest.json', 'utf8')).rows;
  const todo = [...rows].sort((a, b) => (a.frozen_at < b.frozen_at ? -1 : 1)).filter((r) => !done.has(r.match_id)).slice(0, PER_RUN);
  const legacy = fs.existsSync(RESULT) ? JSON.parse(fs.readFileSync(RESULT, 'utf8')) : null; // observer/1, read-only
  const corrected = new Set(readJsonl(EVENTS).filter((e) => e.type === 'corrected_evaluation').map((e) => e.match_id));
  log(`graded ${s.graded}, already in ledger ${done.size}, proving ${todo.length}`);

  for (const row of todo) {
    const out = path.join(PROOFS, `${row.match_id}.json`);
    const p = run(['scripts/research/mm2/prove-shadow.mjs', row.match_id], { PROOF_OUT: out });
    if (!fs.existsSync(out) || !lastJson(p.out)) { halt({ match_id: row.match_id, reason: 'prove-shadow produced no proof', exit: p.code, output: p.out.slice(-1500) }); break; }
    const proof = JSON.parse(fs.readFileSync(out, 'utf8'));
    const inv = gradeInvariants(proof);
    const entry = { observer_version: OBSERVER_VERSION, at: new Date().toISOString(), match_id: row.match_id, tour: row.tour, status: inv.passed ? 'PASS' : 'FAIL', failed: inv.failed, checks: inv.checks,
      frozen_at: inv.frozen_at, deadline: inv.deadline, deadline_basis: inv.deadline_basis, shadow_key: proof.shadow?.key, shadow_sha256: proof.shadow?.sha256, grade: proof.grade, proof: out };
    append(LEDGER, entry);
    log(`${entry.status} ${row.match_id} ${inv.failed.join(',')}`);

    if (legacy?.status === 'FAIL' && legacy.match_id === row.match_id && !corrected.has(row.match_id)) {
      const same = ['result', 'graded_record_frozen_at', 'champion_A', 'challenger_A', 'champion_log_loss', 'challenger_log_loss'].every((k) => legacy.grade?.[k] === proof.grade?.[k]);
      append(EVENTS, {
        type: 'corrected_evaluation', observer_version: OBSERVER_VERSION, at: entry.at, match_id: row.match_id,
        original_observation: { observer_version: 'mm2-observer/1', at: legacy.at, result: legacy.status, record: 'grade.result.json (unchanged)', grade: legacy.grade },
        failed_invariant: 'frozen_before_match_started',
        root_cause: `started_at = ${JSON.stringify(proof.started_at)}: observer/1 compared frozen_at with started_at only; the grader (pickGradeable) uses started_at ?? scheduled_at`,
        effective_comparison: { basis: inv.deadline_basis, timestamp: inv.deadline },
        frozen_at: inv.frozen_at,
        corrected_invariant_result: inv.checks.frozen_before_match_started ? 'PASS' : 'FAIL',
        corrected_overall_result: entry.status,
        model_grade_unchanged: same,
        recomputed_after_match: proof.grade?.recomputed_after_match ?? null,
        frozen_record: { key: proof.shadow?.key, sha256: proof.shadow?.sha256, immutability_rechecked: proof.immutability?.passed === true },
        unchanged: 'no model input, probability, feature, coefficient, scoring, grading, gate logic or frozen record was changed; only the observer check'
      });
      log(`corrected evaluation appended for ${row.match_id} (original observer/1 FAIL preserved)`);
    }
    if (!inv.passed) { halt({ match_id: row.match_id, failed: inv.failed, checks: inv.checks, proof: out }); break; }
  }
}
