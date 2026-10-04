#!/usr/bin/env node
// Static truth guards. Runs first in `npm run check` (and therefore every Vercel build).
// Fails on: randomness in data paths, browser->provider/database calls, secrets, fake/demo production
// data, hardcoded scores, placeholder copy, official-relationship claims, Vercel Functions / Actions
// schedulers, unapproved or orphan player media, and a source registry that claims more than its
// evidence proves.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, VERDICTS } from '../workers/shared/adapter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = [];
const fail = (rule, where) => fails.push(`${rule}: ${where}`);
const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');
const read = (p) => fs.readFileSync(p, 'utf8');
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.wrangler', 'qa-artifacts'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const src = walk(path.join(ROOT, 'src'), ['.js', '.css']);
const workers = walk(path.join(ROOT, 'workers'), ['.js']);
const scripts = walk(path.join(ROOT, 'scripts'), ['.js', '.mjs']);
const code = [...src, ...workers];

// 1. No Math.random in production paths (jitter uses crypto.getRandomValues).
for (const f of code) if (/Math\.random\s*\(/.test(read(f))) fail('no-math-random', rel(f));

// 2. The browser talks only to our own Workers: tennis-api through src/data/api.js, and the shared PropBetEdge
//    propsports-markets Worker through the vendored Kalshi client (src/vendor/kalshi/, unchanged). That client may
//    name no host but propsports-markets, and nothing in src/ may name a Kalshi API host (the browser never calls Kalshi).
const MARKETS_CLIENT = 'src/vendor/kalshi/kalshi-market-client.js';
// The shared article market module (article-market/1) reads only through the same-origin exact rewrite
// /api/markets/v1/article-market/tennis/:id (vercel.json -> propsports-markets): these two files may fetch but name NO host.
const ARTICLE_MARKET_CLIENTS = new Set(['src/vendor/kalshi/article-market-ui.js', 'src/data/article-market.js']);
const KALSHI_API_HOST = /(?:api\.elections\.kalshi\.com|trading-api\.kalshi\.com|external-api\.kalshi\.com|demo-api\.kalshi\.co|api\.kalshi\.com)/i;
for (const f of src) {
  const t = stripComments(read(f));
  if (rel(f) === MARKETS_CLIENT) {
    const hosts = [...t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
    if (hosts.some((h) => h !== 'propsports-markets.sales-fd3.workers.dev')) fail('markets-client-host', `${rel(f)} -> ${hosts.join(', ')}`);
  } else if (ARTICLE_MARKET_CLIENTS.has(rel(f))) {
    if (/https?:\/\//i.test(t)) fail('article-market-client-host', rel(f));
  } else if (/\bfetch\s*\(/.test(t) && !rel(f).endsWith('src/data/api.js')) fail('browser-fetch-outside-api-client', rel(f));
  if (KALSHI_API_HOST.test(read(f))) fail('browser-kalshi-api-host', rel(f));
  if (/supabase\.co|service_role|SUPABASE_SERVICE/i.test(t)) fail('browser-database-access', rel(f));
  if (/new\s+WebSocket|EventSource\s*\(/.test(t)) fail('browser-direct-stream', rel(f));
}

// 3. Secrets never enter Git.
const SECRET = [/sk_live_[0-9a-zA-Z]{10,}/, /sk_test_[0-9a-zA-Z]{10,}/, /whsec_[0-9a-zA-Z]{10,}/, /eyJhbGciOiJIUzI1NiIs[0-9a-zA-Z._-]{40,}/, /sbp_[0-9a-f]{20,}/, /ghp_[0-9A-Za-z]{30,}/, /AKIA[0-9A-Z]{16}/, /apiKey=[0-9a-f]{32}/];
const textFiles = [...code, ...scripts, ...walk(path.join(ROOT, 'supabase'), ['.sql']), ...walk(path.join(ROOT, 'docs'), ['.md', '.json']), ...walk(path.join(ROOT, 'data'), ['.json']), ...walk(path.join(ROOT, 'workers'), ['.toml']), ...walk(path.join(ROOT, 'tests'), ['.js', '.json'])];
for (const f of textFiles) for (const re of SECRET) if (re.test(read(f))) fail('no-secrets', `${rel(f)} -> ${re}`);
for (const f of walk(path.join(ROOT, 'workers'), ['.toml'])) if (/^\s*\[vars\][\s\S]*?(KEY|TOKEN|SECRET)\s*=/m.test(read(f))) fail('secret-in-wrangler-vars', rel(f));

// 4. Vercel presents only; GitHub Actions schedule nothing.
if (fs.existsSync(path.join(ROOT, 'api'))) fail('no-vercel-functions', 'api/ directory exists');
const vj = JSON.parse(read(path.join(ROOT, 'vercel.json')));
if (vj.functions || vj.crons) fail('no-vercel-functions', 'vercel.json declares functions/crons');
if (walk(path.join(ROOT, '.github'), ['.yml', '.yaml']).length) fail('no-github-actions', '.github workflows exist (owner policy: never add Actions)');

// 5. No localhost / placeholder / hardcoded live data / official-relationship claims in shipped code.
for (const f of [...src, ...workers]) {
  const t = stripComments(read(f));
  if (/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(t)) fail('no-localhost-url', rel(f));
  if (/lorem ipsum|\bTODO\b|\bFIXME\b|coming soon|placeholder text|dummy data|mock data|sample data/i.test(t)) fail('no-placeholder-copy', rel(f));
  if (/\b[67]-[0-6]\s+[67]-[0-6](\s+[67]-[0-6])?\b/.test(t) && !rel(f).includes('workers/shared/canonical/scoring.js')) fail('no-hardcoded-score', rel(f));
  if (/\bofficial (data )?(partner|provider|app)\b|\bin partnership with (the )?(ATP|WTA|ITF)\b|\bofficial (ATP|WTA|ITF) (data|ranking)s? (feed|partner)\b/i.test(t)) fail('no-official-claim', rel(f));
  if (/\b(?:ATP|WTA) ranking\b/.test(t) && /projected/i.test(t) && !/PBE PROJECTED RANK/.test(t)) fail('projection-must-be-labeled-pbe', rel(f));
}

// 6. No demo/sample/fake records anywhere in production data.
for (const f of walk(path.join(ROOT, 'data'), ['.json'])) {
  if (/(demo|sample|fake|mock)/i.test(path.basename(f))) fail('no-demo-data-file', rel(f));
}

// 7. Player media: every approved entry is complete, rights-safe and on disk; nothing orphaned.
const ledgerPath = path.join(ROOT, 'data', 'media', 'player-media.json');
const ledger = JSON.parse(read(ledgerPath));
const OK_LICENSE = /^(cc0|public domain|pd|cc by(-sa)? \d(\.\d)?|cc by(-sa)?)$/i;
const approved = new Set();
for (const p of ledger.players || []) {
  if (p.approval !== 'approved') continue;
  const where = `player ${p.pbe_player_id} ${p.display_name}`;
  approved.add(String(p.pbe_player_id));
  for (const k of ['pbe_player_id', 'display_name', 'source_page_url', 'original_url', 'author', 'license', 'attribution', 'width', 'height', 'focal', 'identity_evidence', 'verified_at']) if (!p[k]) fail('photo-provenance', `${where} missing ${k}`);
  if (!OK_LICENSE.test(String(p.license || '').trim()) || /\bnc\b|\bnd\b|non-?commercial|no-?deriv/i.test(p.license || '')) fail('photo-license', `${where} (${p.license})`);
  for (const v of ['portrait', 'card', 'thumb', 'wide', 'og']) if (!fs.existsSync(path.join(ROOT, 'public', 'media', 'players', String(p.pbe_player_id), `${v}.webp`))) fail('photo-derivative-missing', `${where} ${v}`);
}
const mediaDir = path.join(ROOT, 'public', 'media', 'players');
if (fs.existsSync(mediaDir)) for (const d of fs.readdirSync(mediaDir)) if (!approved.has(d)) fail('photo-orphan-derivative', `public/media/players/${d}`);

// 8. Source registry claims only what evidence proves. PASS requires a PASS canary in the latest run
//    (or an explicit manual evidence file). Commercial vendors are reference-only, never "pending purchase".
const reg = JSON.parse(read(path.join(ROOT, 'data', 'source-registry', 'sources.json')));
const canary = JSON.parse(read(path.join(ROOT, 'docs', 'evidence', 'source-canary-latest.json')));
const canaryState = new Map((canary.results || []).map((r) => [r.key, r.state]));
const seen = new Set();
for (const s of reg.sources || []) {
  const where = `source ${s.key}`;
  if (seen.has(s.key)) fail('registry-duplicate-key', where);
  seen.add(s.key);
  if (!VERDICTS.includes(s.verdict)) fail('registry-verdict', `${where} (${s.verdict})`);
  for (const c of s.capabilities || []) if (!CAPABILITIES.includes(c)) fail('registry-capability', `${where} (${c})`);
  if (s.verdict === 'PASS' || s.verdict === 'DEGRADED') {
    const ev = s.evidence || {};
    const byCanary = ev.canary_key && ['PASS', 'DEGRADED'].includes(canaryState.get(ev.canary_key));
    const byFile = ev.file && fs.existsSync(path.join(ROOT, ev.file));
    // raw third-party captures live in private R2, not in this public repo
    const byArchive = typeof ev.r2_key === 'string' && /^tennis-source\/audit\/[\w.-]+\.json$/.test(ev.r2_key);
    if (!byCanary && !byFile && !byArchive) fail('registry-claim-without-evidence', `${where} is ${s.verdict} but has no passing canary or evidence file`);
    if (s.verdict === 'PASS' && ev.canary_key && canaryState.get(ev.canary_key) && canaryState.get(ev.canary_key) !== 'PASS') fail('registry-pass-contradicted-by-canary', `${where}: canary ${canaryState.get(ev.canary_key)}`);
  }
  if (/PENDING_PURCHASE|BUY|SUBSCRIBE/i.test(JSON.stringify(s.production_status || ''))) fail('no-purchase-dependency', where);
}

if (fails.length) {
  console.error(`guard-truth: ${fails.length} failure(s)`);
  for (const f of fails) console.error(`  ✖ ${f}`);
  process.exit(1);
}
console.log(`guard-truth: OK (${code.length} code files, ${(reg.sources || []).length} registry sources, ${approved.size} approved photos)`);
