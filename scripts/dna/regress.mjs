#!/usr/bin/env node
// DNA v2 regression: run two builders on the SAME frozen inputs (scripts/dna/dump.mjs) through a read-only fake
// store and compare everything they would write, byte for byte (canonical JSON, keys sorted).
//   node --expose-gc scripts/dna/regress.mjs <dumpDir> <baselineRoot> <candidateRoot> [asOf,asOf,...]
// Roots are repo-shaped directories containing workers/tennis-ingest/src/dna-v2-job.js.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [dir, baseRoot, candRoot, asOfArg] = process.argv.slice(2);
const asOfs = (asOfArg || '2026-09-27,2024-01-01,2019-06-01,2012-03-01').split(',');
const load = (n) => JSON.parse(fs.readFileSync(path.join(dir, `${n}.json`), 'utf8'));
const loadOpt = (n) => (fs.existsSync(path.join(dir, `${n}.json`)) ? load(n) : []);
const D = { changes: loadOpt('changes'), players: load('players'), editions: load('editions'), snapshots: load('snapshots'), rankings: load('rankings'), matches: load('matches').sort((a, b) => (a.match_id < b.match_id ? -1 : 1)) };
const rankBySnap = new Map();
for (const r of D.rankings) { if (!rankBySnap.has(r.snapshot_id)) rankBySnap.set(r.snapshot_id, []); rankBySnap.get(r.snapshot_id).push(r); }
for (const v of rankBySnap.values()) v.sort((a, b) => a.rank - b.rank || (a.pbe_player_id < b.pbe_player_id ? -1 : 1));

const q = (s) => Object.fromEntries(s.split('&').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
const page = (rows, p) => { const off = Number(p.offset || 0); const lim = Number(p.limit || 1e9); return rows.slice(off, off + lim); };
let live = 0;
let liveBase = 0;
// live set (after a full GC) sampled at every store call: what a 128 MB isolate must actually hold
let where = '';
let lastTable = '';
const trace = process.env.TRACE === '1';
const sampleLive = (tag = '') => { if (!global.gc) return; global.gc(); const v = process.memoryUsage().heapUsed - liveBase; if (v > live) { live = v; where = tag; } const t = tag.split(' #')[0]; if (trace && t !== lastTable) { console.log('  trace', tag, (v / 1048576).toFixed(0), 'MB'); lastTable = t; } };
class FakeStore {
  constructor(label) { this.requests = 0; this.files = { tennis_dna_snapshots: path.join(dir, `out-${label}-snaps.ndjson`), tennis_surface_ratings: path.join(dir, `out-${label}-ratings.ndjson`) }; for (const f of Object.values(this.files)) fs.writeFileSync(f, ''); }
  async select(table, query) {
    this.requests += 1;
    sampleLive(`select ${table} #${this.requests}`);
    const p = q(query);
    if (table === 'tennis_players') return page(D.players, p);
    if (table === 'tennis_tournament_editions') return page(D.editions, p);
    if (table === 'tennis_ranking_snapshots') return page(D.snapshots.filter((s) => s.list_key === p.list_key.slice(3)), p);
    if (table === 'tennis_rankings') {
      const ids = decodeURIComponent(p.snapshot_id).replace(/^in\.\(|\)$/g, '').split(',').map((x) => x.replace(/"/g, ''));
      const rows = ids.sort().flatMap((id) => rankBySnap.get(id) || []);
      return page(rows, p);
    }
    if (table === 'tennis_matches') {
      const gt = p.match_id ? p.match_id.slice(3) : '';
      const since = p.updated_at ? p.updated_at.slice(3) : null;
      const et = p.event_type?.startsWith('eq.') ? [p.event_type.slice(3)] : ['MS', 'WS'];
      const rows = D.matches.filter((m) => m.match_id > gt && et.includes(m.event_type) && (!since || m.updated_at > decodeURIComponent(since)));
      return rows.slice(0, Number(p.limit || 1000));
    }
    if (table === 'tennis_source_changes') { const since = decodeURIComponent(p.observed_at.slice(3)); return page(D.changes.filter((c) => c.observed_at > since), p); }
    throw new Error(`fake store: unexpected select ${table}`);
  }
  async count(table, query) {
    this.requests += 1;
    const p = q(query);
    if (table !== 'tennis_matches') throw new Error(`fake store: unexpected count ${table}`);
    const et = p.event_type.slice(3);
    return D.matches.filter((m) => m.event_type === et && ['completed', 'retired'].includes(m.status)).length;
  }
  async upsert(table, rows) { this.requests += 1; sampleLive(`upsert ${table} #${this.requests}`); fs.appendFileSync(this.files[table], rows.map((r) => `${JSON.stringify(r)}\n`).join('')); return []; }
}
// R2 stand-in on disk (cache objects never count toward the builder's live set)
const R2DIR = path.join(dir, 'r2');
const bucket = {
  async get(k) { const f = path.join(R2DIR, k); return fs.existsSync(f) ? { text: async () => fs.readFileSync(f, 'utf8') } : null; },
  async put(k, v) { const f = path.join(R2DIR, k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : Buffer.from(v)); }
};
// KV stand-in persisted on disk (candidate only: the cache watermark must survive between runs)
const KVF = path.join(dir, 'kv.json');
const kvMap = new Map(Object.entries(fs.existsSync(KVF) ? JSON.parse(fs.readFileSync(KVF, 'utf8')) : {}));
const saveKv = () => fs.writeFileSync(KVF, JSON.stringify(Object.fromEntries(kvMap)));
const kv = { get: async (k, t) => { const v = kvMap.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { kvMap.set(k, typeof v === 'string' ? v : String(v)); saveKv(); }, delete: async (k) => { kvMap.delete(k); saveKv(); } };

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
async function run(root, label) {
  const mod = await import(pathToFileURL(path.join(root, 'workers/tennis-ingest/src/dna-v2-job.js')).href);
  const store = new FakeStore(label.trim());
  global.gc?.();
  const base = process.memoryUsage().heapUsed;
  liveBase = base; live = 0;
  let peak = 0;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5);
  const t0 = Date.now();
  const mode = label.trim() === 'baseline' ? undefined : process.env.CAND_MODE || 'full';
  const summary = await mod.buildDnaV2({ store, kv, env: label.trim() === 'baseline' ? {} : { TENNIS_SOURCE: bucket } }, { asOfs, write: true, mode });
  if (summary.inputs) console.log(`  ${label.trim()} inputs`, JSON.stringify(summary.inputs));
  clearInterval(timer);
  peak = Math.max(peak, process.memoryUsage().heapUsed);
  const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  const snaps = lines(store.files.tennis_dna_snapshots).map((s) => JSON.parse(s)).map(canon).sort((a, b) => (a.pbe_player_id + a.as_of < b.pbe_player_id + b.as_of ? -1 : 1));
  const rats = lines(store.files.tennis_surface_ratings).map((s) => JSON.parse(s)).map(canon).sort((a, b) => (`${a.pbe_player_id}|${a.surface}|${a.as_of}` < `${b.pbe_player_id}|${b.surface}|${b.as_of}` ? -1 : 1));
  const h = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const tours = canon(Object.fromEntries(Object.entries(summary.tours).map(([t, x]) => [t, { ...x }])));
  console.log(`${label}: ${Date.now() - t0} ms, live set max +${(live / 1048576).toFixed(0)} MB (sampled after GC at each store call; peak at ${where}), store requests ${store.requests}, snapshots ${snaps.length}, ratings ${rats.length}`);
  return { snaps, rats, tours, hs: h(snaps), hr: h(rats), ht: h(tours), summary };
}
const a = await run(baseRoot, 'baseline ');
const b = await run(candRoot, 'candidate');
let diff = 0;
const bm = new Map(b.snaps.map((s) => [`${s.pbe_player_id}|${s.as_of}`, s]));
for (const s of a.snaps) { const o = bm.get(`${s.pbe_player_id}|${s.as_of}`); if (!o || JSON.stringify(o) !== JSON.stringify(s)) { if (diff < 3) console.log('DIFF', s.pbe_player_id, s.as_of, JSON.stringify(s).slice(0, 300), '\n     ', JSON.stringify(o || null).slice(0, 300)); diff += 1; } }
const out = { as_ofs: asOfs, inputs: { matches: D.matches.length, rankings: D.rankings.length, players: D.players.length }, snapshots: { baseline: a.snaps.length, candidate: b.snaps.length, differing: diff, sha256_equal: a.hs === b.hs, sha256: a.hs }, ratings: { baseline: a.rats.length, candidate: b.rats.length, sha256_equal: a.hr === b.hr }, summary_tours_equal: a.ht === b.ht, summary_tours_equal_on_baseline_fields: JSON.stringify(a.tours) === JSON.stringify(canon(Object.fromEntries(Object.entries(b.tours).map(([t, x]) => [t, Object.fromEntries(Object.keys(a.tours[t] || {}).map((k) => [k, x[k]]))])))), summary_fields_added: [...new Set(Object.entries(b.tours).flatMap(([t, x]) => Object.keys(x).filter((k) => !(k in (a.tours[t] || {})))))] };
console.log(JSON.stringify(out, null, 1));
if (!out.snapshots.sha256_equal || !out.ratings.sha256_equal || !out.summary_tours_equal_on_baseline_fields) process.exitCode = 1;
