// Safe tennis Worker deploy (2026-10-03, after a session replaced another session's tennis-api deploy for 4 minutes).
//   node scripts/ops/deploy-worker.mjs <tennis-api|tennis-live|tennis-ingest|...> [--yes]
// Refuses unless:
//   1. the working tree has no uncommitted change under workers/ (what is deployed is exactly a commit);
//   2. local main == origin/main after a fetch (rebase / merge first — never deploy a tree others have not seen);
//   3. the CURRENTLY deployed version names its commit ("@ <sha>" in the deployment message) and that commit is an
//      ancestor of HEAD — i.e. this deploy contains everything production has. Unknown or foreign base = drift: abort.
// Then: versions upload (message "<worker> @ <sha>") -> /health on the preview URL -> versions deploy 100% with the
// previous version id recorded as rollback. Without --yes it stops after the checks (dry run).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const worker = process.argv[2];
const yes = process.argv.includes('--yes');
if (!worker) throw new Error('usage: deploy-worker.mjs <worker> [--yes]');
const dir = path.resolve('workers', worker);
const env = { ...process.env, NODE_OPTIONS: '--require D:/Workers/exfat-readlink.cjs' };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 26, ...opts }).trim();
const git = (...a) => sh('git', a);
// on Windows npx needs a shell, which re-splits arguments: quote anything with spaces
const q = (x) => (process.platform === 'win32' && /[\s()]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x);
const wr = (...a) => sh('npx', ['wrangler', ...a.map(q)], { cwd: dir, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
const fail = (why) => { console.log(`ABORT ${why}`); process.exit(1); };

if (git('status', '--porcelain', '--', 'workers/')) fail('uncommitted changes under workers/: commit (and push) first');
git('fetch', '-q', 'origin', 'main');
const head = git('rev-parse', 'HEAD');
const remote = git('rev-parse', 'origin/main');
if (head !== remote) fail(`local HEAD ${head.slice(0, 7)} != origin/main ${remote.slice(0, 7)}: pull --rebase (or push) first`);

const list = wr('deployments', 'list');
const blocks = list.split(/\n(?=Created:)/);
const last = blocks.at(-1) || '';
const msg = /Message:\s+(.+)/.exec(last)?.[1] || '';
const prevVersion = /\(100%\)\s+([0-9a-f-]{36})/.exec(last)?.[1] || null;
// the commit is any token in the deployment / version messages that git resolves to a commit (version-id prefixes don't)
const isCommit = (t) => { try { return git('cat-file', '-t', t) === 'commit'; } catch { return false; } };
const base = [...last.matchAll(/\b([0-9a-f]{7,40})\b/g)].map((m) => m[1]).find(isCommit) || null;
console.log(`deployed: ${prevVersion} "${msg}"`);
if (!base) fail('the deployed version names no commit git knows: cannot prove this deploy contains it — reconcile manually');
let isAncestor = true;
try { git('merge-base', '--is-ancestor', base, head); } catch { isAncestor = false; }
if (!isAncestor) fail(`deployed commit ${base} is not in HEAD's history: another line of work is in production — merge it first`);
console.log(`ok: deployed ${base} is an ancestor of HEAD ${head.slice(0, 7)}`);
if (!yes) { console.log('checks passed (dry run; add --yes to deploy)'); process.exit(0); }

const up = wr('versions', 'upload', '--message', `${worker} @ ${head.slice(0, 7)} (rollback ${prevVersion})`);
const vid = /Version ID:\s+([0-9a-f-]{36})/.exec(up)?.[1];
const preview = /Preview URL:\s+(\S+)/.exec(up)?.[1];
if (!vid || !preview) fail(`upload failed:\n${up.slice(-800)}`);
const h = await (await fetch(`${preview}/health`)).json().catch(() => null);
if (!h?.ok) fail(`preview health not ok: ${JSON.stringify(h).slice(0, 300)}`);
console.log(`preview ${preview} health ok (${h.version})`);
console.log(wr('versions', 'deploy', `${vid}@100%`, '--message', `${worker} @ ${head.slice(0, 7)} (rollback ${prevVersion})`, '--yes').split('\n').filter((l) => /SUCCESS|rror/.test(l)).join('\n'));
console.log(`DEPLOYED ${worker} ${vid} @ ${head.slice(0, 7)}; rollback ${prevVersion}`);
