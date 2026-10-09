// One-shot verification of the first ATP SHADOW locks (Tennis Picks V2, tennis-api /v1/picks/track-record).
// Read-only. PASS | HOLD | FAIL (exit 0 | 2 | 1).
//   HOLD — no ATP shadow decision recorded yet (prints the next expected locks from /v1/today).
//   PASS — >= 1 decision, and for every one: decided_at >= lock_at (the lock rule was honoured) and decided_at < the
//          sourced start known at the lock; when graded, decided_at < the canonical started_at; evidence sha256 present
//          for CALL/PASS-capable rules; the public record counts them (record.atp_shadow.decisions >= proofs); and, with
//          R2=1 (default), sha256 of the stored R2 bytes (wrangler r2 object get --remote) == the served record_sha256.
//   FAIL — any check above fails.
//   node scripts/qa/atp-shadow-first-lock.mjs            (R2=0 to skip the wrangler byte check; OUT=<file> for JSON)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const API = process.env.API || 'https://tennis-api.propbetedge.ai';
const R2 = process.env.R2 !== '0';
const OUT = process.env.OUT || null;
const now = new Date().toISOString();
const j = async (p) => (await fetch(`${API}${p}`, { headers: { accept: 'application/json' } })).json();

const tr = await j(`/v1/picks/track-record`);
const proofs = (tr.data?.lock_proofs || []).filter((p) => p.scope === 'atp_shadow' && !p.excluded);
const rec = tr.data?.record?.atp_shadow || null;
const resolved = new Map((tr.data?.resolved || []).filter((r) => r.scope === 'atp_shadow').map((r) => [r.match_id, r]));
const out = { at: now, api: API, policy: tr.data?.policy?.atp_shadow?.version ?? null, served_record: rec, proofs: [], fails: [], verdict: null };

if (!proofs.length) {
  const today = await j('/v1/today');
  const next = (today.data?.upcoming || []).filter((m) => m.event_type === 'MS' && m.scheduled_at && Date.parse(m.scheduled_at) > Date.now())
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 5)
    .map((m) => ({ match_id: m.id, scheduled_at: m.scheduled_at, expected_lock_at: new Date(Date.parse(m.scheduled_at) - 3600e3).toISOString(), players: `${m.sides?.A?.players?.[0]?.name} v ${m.sides?.B?.players?.[0]?.name}`, tournament: m.tournament?.slug }));
  out.verdict = 'HOLD';
  out.note = 'no ATP shadow decision recorded yet';
  out.next_expected_locks = next;
} else {
  const wr = (...a) => execFileSync('npx', ['wrangler', ...a], { cwd: path.resolve('workers/tennis-api'), shell: process.platform === 'win32', encoding: 'buffer', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, NODE_OPTIONS: '--require D:/Workers/exfat-readlink.cjs' } });
  for (const p of proofs) {
    const f = [];
    const d = Date.parse(p.decided_at);
    if (p.lock_at && d < Date.parse(p.lock_at)) f.push('decided before lock_at');
    if (p.scheduled_at_known_at_lock && !(d < Date.parse(p.scheduled_at_known_at_lock))) f.push('decided_at not before the sourced start');
    if (p.lock_at && !/^[0-9a-f]{64}$/.test(p.evidence_sha256 || '')) f.push('no evidence sha256 for a locked decision');
    if (!/^[0-9a-f]{64}$/.test(p.record_sha256 || '')) f.push('no record sha256');
    const g = resolved.get(p.match_id)?.grade || null;
    if (g?.started_at && !(d < Date.parse(g.started_at))) f.push(`decided_at not before canonical started_at ${g.started_at}`);
    let r2 = null;
    if (R2) {
      try {
        const bytes = wr('r2', 'object', 'get', `tennis-source/ledger/picker-v2-atp-shadow/decisions/${p.match_id}.json`, '--remote', '--pipe');
        r2 = crypto.createHash('sha256').update(bytes).digest('hex');
        if (r2 !== p.record_sha256) f.push('stored R2 bytes do not hash to the served record_sha256');
      } catch (e) { f.push(`r2 read failed: ${String(e?.message || e).slice(0, 120)}`); }
    }
    out.proofs.push({ ...p, r2_sha256: r2, grade: g ? { result: g.result, started_at: g.started_at } : null, checks: f.length ? f : 'ok' });
    for (const x of f) out.fails.push(`${p.match_id}: ${x}`);
  }
  if (!rec || rec.decisions < proofs.length) out.fails.push(`served record.atp_shadow.decisions ${rec?.decisions ?? 'missing'} < ${proofs.length} proofs`);
  out.verdict = out.fails.length ? 'FAIL' : 'PASS';
}
const text = JSON.stringify(out, null, 1);
if (OUT) fs.writeFileSync(OUT, text);
console.log(text);
process.exit(out.verdict === 'PASS' ? 0 : out.verdict === 'HOLD' ? 2 : 1);
