// Matchup Model V2 — operational proof of the prospective shadow lane on a NATURAL production record (read-only).
//   node scripts/research/mm2/prove-shadow.mjs [match_id]
// 1. first natural shadow: snapshot exists; shadow exists; frozen_at <= start; champion == frozen production probability;
//    challenger + feature hash present and recomputable from the frozen coefficients; model_version; not public.
// 2. immutability: the PRODUCTION shadowFrozen code is re-run for the same snapshot against production R2 through an
//    adapter whose put() throws: it must take the 'exists' path; object bytes/hash and the record count are unchanged.
// 3. grade (when the match has finished): pickGradeable on the stored result.
// Writes docs/evidence/matchup-model-v2-shadow-proof.json. Never writes to R2 or the database.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { shadowFrozen } from '../../../workers/tennis-api/src/mm2-shadow.js';
import { stableJson, contentHash } from '../../../workers/tennis-api/src/matchup-freeze.js';
import { SHADOW_MODEL } from '../../../workers/shared/research/mm2-b-shadow.js';
import { predictFrom } from '../../../workers/shared/research/mm2-profile.js';
import { pickGradeable } from './shadow-gate.mjs';

const API_DIR = path.resolve('workers/tennis-api');
const env = { ...process.env, NODE_OPTIONS: '--require D:/Workers/exfat-readlink.cjs' };
const ACCT = 'fd3a233edadd0a60916413c1199f71ee';
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: API_DIR, env, maxBuffer: 1 << 28, shell: process.platform === 'win32', ...opts });
const TOKEN = JSON.parse(sh('npx', ['wrangler', 'auth', 'token', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()).token;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function list(prefix) {
  const r = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/r2/buckets/tennis-source/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
  if (!r.success) throw new Error(`list failed ${JSON.stringify(r.errors)}`);
  return r.result;
}
const getBytes = (key) => sh('npx', ['wrangler', 'r2', 'object', 'get', `tennis-source/${key}`, '--remote', '--pipe'], { stdio: ['ignore', 'pipe', 'ignore'] });
const getJson = (key) => JSON.parse(getBytes(key).toString('utf8'));

// --- find the first natural shadow record
let rec = null;
const want = process.argv[2] || null;
for (const o of (await list('research/mm2/shadow-index/')).sort((a, b) => (a.key < b.key ? -1 : 1))) {
  const idx = getJson(o.key);
  rec = idx.find((r) => (want ? r.match_id === want : !!r.challenger)) || null;
  if (rec) break;
}
if (!rec) { console.log('NO_NATURAL_SHADOW_YET'); process.exitCode = 2; } else await prove(rec);

async function prove(rec) {
const id = rec.match_id;
const shadowKeys = (await list(`research/mm2/shadow/${id}/`)).map((x) => x.key);
const shadowKey = rec.key;
const snaps = await list(`intel/matchup-prematch/${id}/`);
const snapObj = snaps.find((s) => s.custom_metadata?.frozen_at === rec.frozen_at);
const snap = snapObj ? getJson(snapObj.key) : null;
const bytes1 = getBytes(shadowKey);
const stored = JSON.parse(bytes1.toString('utf8'));
const q = `select json_agg(json_build_object('status', status, 'winner_side', winner_side, 'started_at', started_at, 'scheduled_at', scheduled_at))::text j from tennis_matches where match_id = '${id}'`;
const outQ = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8' }).trim());
const m = JSON.parse((Array.isArray(outQ) ? outQ[0] : outQ).j)[0];
const start = m.started_at || m.scheduled_at;
const recomputed = predictFrom({ names: SHADOW_MODEL.names, coef: SHADOW_MODEL.tours[stored.tour].coef }, stored.features);

// public exposure: the match's public API responses carry nothing from the research lane
const exposure = {};
for (const u of [`/v1/pbecast/${id}`, `/v1/matches/${id}`, `/v1/matchups/${id}`, '/v1/today', '/v1/live']) {
  const r = await fetch(`https://tennis-api.propbetedge.ai${u}`, { headers: { origin: 'https://tennis.propbetedge.ai' } });
  const t = await r.text();
  exposure[u] = { status: r.status, leaks: /mm2|feature_hash|challenger|research\/mm2|ca5795a4/.test(t) };
}

const checks1 = {
  pre_match_snapshot_exists: !!snap && snap.snapshot_kind === 'pre_match' && snap.frozen_status === 'scheduled',
  snapshot_hash_verified: !!snap && (await contentHash(snap.payload)) === snap.content_hash && stored.snapshot_content_hash === snap.content_hash,
  shadow_object_exists: shadowKeys.includes(shadowKey),
  shadow_frozen_at_before_start: Date.parse(stored.frozen_at) <= Date.parse(start),
  champion_equals_frozen_production_probability: !!snap && JSON.stringify(stored.champion.probability) === JSON.stringify(snap.payload.model.probability),
  challenger_probability_present: !!stored.challenger?.probability && stored.challenger.probability.A > 0 && stored.challenger.probability.A < 1,
  challenger_recomputes_from_frozen_coefficients: Math.abs(recomputed - stored.challenger.probability.A) < 2e-6,
  feature_hash_present_and_verified: /^[0-9a-f]{64}$/.test(stored.feature_hash) && sha(JSON.stringify(stored.features)) === stored.feature_hash,
  model_version: stored.model_version === 'mm2-B-context/1' && stored.coef_hash === SHADOW_MODEL.coef_hash,
  not_exposed_by_public_api: Object.values(exposure).every((x) => !x.leaks)
};

// --- immutability: re-run the production shadow writer for the same snapshot; put() must never be reached
const puts = [];
const adapter = {
  async get(k) { try { const b = getBytes(k); return { text: async () => b.toString('utf8') }; } catch { return null; } },
  async head(k) { return (await list(k)).some((x) => x.key === k) ? {} : null; },
  async put(k) { puts.push(k); throw new Error(`immutability proof: put attempted on ${k}`); }
};
const rerun = await shadowFrozen(adapter, [{ id, written: true, key: snapObj?.key }]);
const bytes2 = getBytes(shadowKey);
const shadowKeys2 = (await list(`research/mm2/shadow/${id}/`)).map((x) => x.key);
const checks2 = {
  rerun_took_exists_path: rerun.exists === 1 && rerun.written === 0 && rerun.errors === 0,
  no_put_attempted: puts.length === 0,
  object_bytes_unchanged: sha(bytes1) === sha(bytes2),
  no_duplicate_record: shadowKeys2.length === shadowKeys.length,
  probability_unchanged: JSON.parse(bytes2.toString('utf8')).challenger.probability.A === stored.challenger.probability.A,
  feature_hash_unchanged: JSON.parse(bytes2.toString('utf8')).feature_hash === stored.feature_hash
};

// --- grade (once finished)
const pick = pickGradeable(shadowKeys.length > 1 ? await Promise.all(shadowKeys.map(async (k) => getJson(k))) : [stored], m);
const grade = pick.kind === 'graded'
  ? { kind: 'graded', result: m.winner_side, graded_record_frozen_at: pick.record.frozen_at, started_at: m.started_at, champion_A: pick.record.champion.probability.A, challenger_A: pick.record.challenger.probability.A,
      champion_log_loss: -Math.log(pick.y ? pick.record.champion.probability.A : 1 - pick.record.champion.probability.A), challenger_log_loss: -Math.log(pick.y ? pick.record.challenger.probability.A : 1 - pick.record.challenger.probability.A), recomputed_after_match: false }
  : { kind: pick.kind, reason: pick.reason || null, status: m.status };

const proof = { generated_at: new Date().toISOString(), match_id: id, tour: stored.tour, scheduled_at: m.scheduled_at, started_at: m.started_at, status: m.status,
  snapshot: snapObj && { key: snapObj.key, etag: snapObj.etag, content_hash: snap.content_hash, frozen_at: snap.frozen_at },
  shadow: { key: shadowKey, sha256: sha(bytes1), bytes: bytes1.length, records_for_match: shadowKeys.length, record: stored },
  first_natural_write: { passed: Object.values(checks1).every(Boolean), checks: checks1, public_api: exposure },
  immutability: { passed: Object.values(checks2).every(Boolean), checks: checks2, rerun },
  grade };
fs.writeFileSync('docs/evidence/matchup-model-v2-shadow-proof.json', JSON.stringify(proof, null, 1));
console.log(JSON.stringify({ match: id, tour: stored.tour, shadow: shadowKey, sha256: proof.shadow.sha256, first_write: proof.first_natural_write.passed, failed1: Object.entries(checks1).filter(([, v]) => !v).map(([k]) => k), immutability: proof.immutability.passed, failed2: Object.entries(checks2).filter(([, v]) => !v).map(([k]) => k), grade }));
}
