// Matchup Model V2 — OBSERVE-ONLY durable observer (Windows Task Scheduler; no Worker, no Action, no new resource).
// It only runs the EXISTING read-only scripts and records what it saw; it never changes the model, the freezer, the
// shadow writer, the state build, production, or any R2/DB object, and never creates, repairs or reruns evidence.
//   node scripts/research/mm2/observe.mjs shadow   # first natural shadow write + immutability (prove-shadow.mjs)
//   node scripts/research/mm2/observe.mjs grade    # first natural grade + scoreboard (grade-shadow.mjs, prove-shadow.mjs <id>)
// Outcome per mode is recorded once in $MM2_DATA/observer/<mode>.result.json:
//   PASS  every invariant held (proof/scoreboard files written by the existing scripts)
//   FAIL  an invariant failed: the exact failed checks are recorded; the observer stops for that mode (no retry)
//   ABSENT the expected natural state never appeared within MAX_ATTEMPTS runs (recorded, then stops)
// A run while the natural state is still absent only appends to the log and exits (the next scheduled run retries).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MODE = process.argv[2];
if (!['shadow', 'grade'].includes(MODE)) throw new Error('usage: observe.mjs shadow|grade');
const MAX_ATTEMPTS = { shadow: 8, grade: 8 }[MODE];
const DIR = path.join(process.env.MM2_DATA || 'D:/Workers/research-data/tennis-mm2', 'observer');
fs.mkdirSync(DIR, { recursive: true });
const RESULT = path.join(DIR, `${MODE}.result.json`);
const STATE = path.join(DIR, `${MODE}.attempts.json`);
const LOG = path.join(DIR, `${MODE}.log`);
const log = (s) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${s}\n`);
const finish = (status, detail) => { fs.writeFileSync(RESULT, JSON.stringify({ mode: MODE, status, at: new Date().toISOString(), ...detail }, null, 1)); log(`${status} ${JSON.stringify(detail).slice(0, 2000)}`); };

if (fs.existsSync(RESULT)) { log(`already recorded (${JSON.parse(fs.readFileSync(RESULT, 'utf8')).status}); nothing to do`); process.exit(0); }
const attempts = (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')).n : 0) + 1;
fs.writeFileSync(STATE, JSON.stringify({ n: attempts }));

const run = (args) => {
  try { return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};
const lastJson = (out) => { const l = out.trim().split('\n').reverse().find((x) => x.trim().startsWith('{')); try { return l ? JSON.parse(l) : null; } catch { return null; } };
const absent = (why) => { log(`attempt ${attempts}/${MAX_ATTEMPTS}: natural state absent — ${why}`); if (attempts >= MAX_ATTEMPTS) finish('ABSENT', { reason: why, attempts }); };

if (MODE === 'shadow') {
  const r = run(['scripts/research/mm2/prove-shadow.mjs']);
  if (/NO_NATURAL_SHADOW_YET/.test(r.out)) absent('no scored natural shadow record yet');
  else {
    const j = lastJson(r.out);
    if (!j) finish('FAIL', { reason: 'prove-shadow produced no result', exit: r.code, output: r.out.slice(-1500) });
    else if (j.first_write && j.immutability) finish('PASS', { match_id: j.match, tour: j.tour, shadow_key: j.shadow, sha256: j.sha256, proof: 'docs/evidence/matchup-model-v2-shadow-proof.json' });
    else finish('FAIL', { match_id: j.match, failed_first_write: j.failed1, failed_immutability: j.failed2, proof: 'docs/evidence/matchup-model-v2-shadow-proof.json' });
  }
} else {
  const g = run(['scripts/research/mm2/grade-shadow.mjs', '2026-10-02']);
  const s = lastJson(g.out);
  if (!s) finish('FAIL', { reason: 'grade-shadow produced no result', exit: g.code, output: g.out.slice(-1500) });
  else if (!s.graded) absent(`0 graded (shadow records ${s.records}, matches ${s.matches})`);
  else {
    const ev = JSON.parse(fs.readFileSync('docs/evidence/matchup-model-v2-shadow-latest.json', 'utf8'));
    const first = [...ev.rows].sort((a, b) => (a.frozen_at < b.frozen_at ? -1 : 1))[0];
    const p = run(['scripts/research/mm2/prove-shadow.mjs', first.match_id]);
    const j = lastJson(p.out);
    const ok = j && j.first_write && j.immutability && j.grade?.kind === 'graded' && j.grade.recomputed_after_match === false && Date.parse(j.grade.graded_record_frozen_at) < Date.parse(j.grade.started_at);
    if (ok) finish('PASS', { match_id: first.match_id, tour: first.tour, grade: j.grade, scoreboard: 'docs/evidence/matchup-model-v2-shadow-latest.md', proof: 'docs/evidence/matchup-model-v2-shadow-proof.json' });
    else finish('FAIL', { match_id: first.match_id, failed_first_write: j?.failed1, failed_immutability: j?.failed2, grade: j?.grade ?? null, output: j ? undefined : p.out.slice(-1500) });
  }
}
