// Safe push (2026-10-03, after a push went out past a failed `npm run check` because a shell chain used `;`).
//   node scripts/ops/push-safe.mjs [--allow "<exact failing test name>"]...
// Steps, each must succeed or NOTHING is pushed: guard -> tests -> build -> commit check -> pull --rebase -> tests again
// (the rebase may bring other sessions' work) -> push. A known failure owned elsewhere may be waived ONLY by naming the
// exact test; the waiver is printed, and any other failure still stops the push.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const allow = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '--allow') allow.push(args[++i]);
const env = { ...process.env, NODE_OPTIONS: '--require D:/Workers/exfat-readlink.cjs' };
const run = (cmd, a, opts = {}) => { const r = spawnSync(cmd, a, { encoding: 'utf8', env, maxBuffer: 1 << 28, shell: process.platform === 'win32' && cmd === 'npx', ...opts }); return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` }; };
const stop = (why, out = '') => { console.log(`STOP ${why}\n${out.slice(-2500)}`); process.exit(1); };

function tests() {
  const r = run(process.execPath, ['--test', 'tests/**/*.test.js']);
  const summary = (r.out.match(/ℹ (tests|pass|fail) \d+/g) || []).join(' · ');
  if (r.code === 0) { console.log(`tests: ${summary}`); return; }
  // node:test lists exactly the failing LEAF tests after "✖ failing tests:"
  const tail = r.out.split('✖ failing tests:').slice(1).join('\n');
  const failed = [...new Set([...tail.matchAll(/^\s*✖ (.+?) \([\d.]+ms\)/gm)].map((m) => m[1].trim()).filter((n) => !/\.test\.js$/.test(n)))];
  const blocking = failed.filter((n) => !allow.includes(n));
  if (!failed.length || blocking.length) stop(`tests failed: ${(blocking.length ? blocking : ['(unparsed)']).join(' | ')}`, `${summary}\n${r.out.slice(-1500)}`);
  console.log(`tests: ${summary} — waived by name (owned elsewhere): ${failed.join(' | ')}`);
}

let r = run(process.execPath, ['scripts/guard-truth.mjs']); if (r.code) stop('guard-truth failed', r.out);
r = run(process.execPath, ['scripts/guard-source-brand.mjs']); if (r.code) stop('guard-source-brand failed', r.out);
console.log('guards: ok');
tests();
r = run('npx', ['vite', 'build']); if (r.code) stop('build failed', r.out);
console.log('build: ok');
// generated evidence other processes keep writing (observer scoreboard, QA reports) is autostashed, never pushed;
// any other uncommitted tracked change stops the push
r = run('git', ['status', '--porcelain', '--untracked-files=no']);
const dirty = r.out.split('\n').filter((l) => l.trim() && !/^\s*\S+\s+docs\/evidence\//.test(l));
if (dirty.length) stop('uncommitted tracked changes: commit (or stash) them first', dirty.join('\n'));
if (r.out.trim()) console.log(`note: generated evidence left uncommitted (autostashed): ${r.out.trim().split('\n').length} file(s)`);
r = run('git', ['pull', '--rebase', '--autostash']); if (r.code) stop('pull --rebase failed (resolve, then rerun)', r.out);
tests();
r = run('git', ['push', 'origin', 'main']); if (r.code) stop('push failed', r.out);
console.log(`PUSHED ${run('git', ['rev-parse', '--short', 'HEAD']).out.trim()}`);
