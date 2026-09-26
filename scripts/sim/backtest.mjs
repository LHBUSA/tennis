// Walk-forward backtest of the research simulator (docs/SIMULATOR.md).
//   node scripts/sim/backtest.mjs [--write]
// For every completed women's singles match, features come ONLY from editions that started strictly
// before the match's edition (no same-tournament leakage, no look-ahead). Predictions: exact solver
// over the point model. Baselines: coin flip, and a ranking model fitted on the earlier half only.
// Output: docs/evidence/sim-backtest-latest.json (Brier, log loss, calibration, coverage). --write also
// stores one tennis_model_evaluations row. SIMULATOR stays RESEARCH unless gates in the doc pass.
import fs from 'node:fs';
import { storeFromEnv } from '../../workers/shared/store/postgrest.js';
import { exact, pointModel, SIM_VERSION } from '../../workers/shared/sim/engine.js';

const envText = fs.readFileSync('D:/Workers/secrets/ufc-propbetedge.env', 'utf8').replace(/^\uFEFF/, '');
const g = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(envText) || [])[1]?.trim().replace(/^"|"$/g, '');
const store = storeFromEnv({ TENNIS_MODEL_SUPABASE_URL: g('SUPABASE_URL'), TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY: g('SUPABASE_SERVICE_ROLE_KEY') });

async function all(table, q) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const rows = await store.select(table, `${q}&limit=1000&offset=${off}`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const matches = await all('tennis_matches', 'select=match_id,winner_side,format_key,surface,tennis_match_participants(side,participant_key),tennis_match_stats(side,stats),tennis_tournament_editions(edition_id,start_date,level)&event_type=eq.WS&status=eq.completed&order=match_id');
const ranks = await all('tennis_rankings', 'select=pbe_player_id,rank,tennis_ranking_snapshots!inner(list_key,ranking_date)&tennis_ranking_snapshots.list_key=eq.wta_singles&rank=lte.1500');
const rankBy = new Map();
for (const r of ranks) { const a = rankBy.get(r.pbe_player_id) || []; a.push([r.tennis_ranking_snapshots.ranking_date, r.rank]); rankBy.set(r.pbe_player_id, a); }
for (const a of rankBy.values()) a.sort((x, y) => (x[0] < y[0] ? -1 : 1));
const rankAt = (pid, date) => { const a = rankBy.get(pid); if (!a) return null; let v = null; for (const [d, r] of a) { if (d < date) v = r; else break; } return v; };

const rows = matches
  .map((m) => {
    const side = (s) => m.tennis_match_participants.find((p) => p.side === s)?.participant_key || '';
    const st = (s) => m.tennis_match_stats.find((x) => x.side === s)?.stats || null;
    return { id: m.match_id, date: m.tennis_tournament_editions?.start_date, edition: m.tennis_tournament_editions?.edition_id, level: m.tennis_tournament_editions?.level, format: m.format_key, winner: m.winner_side, a: side('A').replace(/^S:/, ''), b: side('B').replace(/^S:/, ''), sa: st('A'), sb: st('B') };
  })
  .filter((r) => r.date && r.a && r.b && r.winner)
  .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

// Running point-in-time totals, applied edition by edition AFTER predicting that edition.
const tot = new Map();
const acc = (pid) => tot.get(pid) || { sp: 0, spw: 0, rp: 0, rpw: 0, m: 0 };
const served = (s) => (s && s.service_points ? { n: s.service_points, w: (s.first_serve_points_won || 0) + (s.second_serve_points_won || 0) } : null);
const feat = (pid) => { const t = acc(pid); return { serve_won: t.sp ? t.spw / t.sp : null, serve_n: t.sp, return_won: t.rp ? t.rpw / t.rp : null, return_n: t.rp, matches: t.m }; };

const preds = [];
let i = 0;
while (i < rows.length) {
  const date = rows[i].date;
  const batch = [];
  while (i < rows.length && rows[i].date === date) batch.push(rows[i++]);
  for (const r of batch) {
    const fa = feat(r.a);
    const fb = feat(r.b);
    const { pA, pB } = pointModel({ a: fa, b: fb });
    const fmt = /^(BO3_TB7|BO3_FINAL_TB10|BO5_FINAL_TB10)$/.test(r.format) ? r.format : 'BO3_TB7';
    const pSim = (exact({ pA, pB, format: fmt, firstServer: 'A' }).p_a_wins + exact({ pA, pB, format: fmt, firstServer: 'B' }).p_a_wins) / 2;
    preds.push({ date, y: r.winner === 'A' ? 1 : 0, pSim, informed: fa.serve_n >= 150 && fb.serve_n >= 150, ra: rankAt(r.a, date), rb: rankAt(r.b, date) });
  }
  for (const r of batch) {
    const A = served(r.sa);
    const B = served(r.sb);
    if (!A || !B) continue;
    const ta = acc(r.a); const tb = acc(r.b);
    ta.sp += A.n; ta.spw += A.w; ta.rp += B.n; ta.rpw += B.n - B.w; ta.m += 1;
    tb.sp += B.n; tb.spw += B.w; tb.rp += A.n; tb.rpw += A.n - A.w; tb.m += 1;
    tot.set(r.a, ta); tot.set(r.b, tb);
  }
}

// Ranking baseline p = 1 / (1 + (rA/rB)^c), c fitted on the first half only (grid search on log loss).
const half = Math.floor(preds.length / 2);
const ll = (p, y) => -(y * Math.log(Math.max(1e-6, p)) + (1 - y) * Math.log(Math.max(1e-6, 1 - p)));
const rankP = (x, c) => (x.ra && x.rb ? 1 / (1 + (x.ra / x.rb) ** c) : 0.5);
let bestC = 0.5; let bestL = Infinity;
for (let c = 0.1; c <= 2.0; c += 0.05) { const L = preds.slice(0, half).reduce((s, x) => s + ll(rankP(x, c), x.y), 0); if (L < bestL) { bestL = L; bestC = c; } }

const test = preds.slice(half);
const metric = (xs, f) => ({ n: xs.length, brier: xs.reduce((s, x) => s + (f(x) - x.y) ** 2, 0) / xs.length, log_loss: xs.reduce((s, x) => s + ll(f(x), x.y), 0) / xs.length, accuracy: xs.reduce((s, x) => s + ((f(x) > 0.5) === (x.y === 1) ? 1 : 0), 0) / xs.length });
const calib = (xs, f) => { const b = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 })); for (const x of xs) { const k = Math.min(9, Math.floor(f(x) * 10)); b[k].n += 1; b[k].p += f(x); b[k].y += x.y; } return b.map((v, k) => ({ bucket: `${k / 10}-${(k + 1) / 10}`, n: v.n, mean_pred: v.n ? v.p / v.n : null, observed: v.n ? v.y / v.n : null })).filter((v) => v.n); };
const informed = test.filter((x) => x.informed);
const out = {
  generated_at: new Date().toISOString(), model_version: SIM_VERSION, status: 'RESEARCH',
  data: { completed_ws_matches: rows.length, with_stats: rows.filter((r) => r.sa && r.sb).length, test_matches: test.length, test_informed: informed.length, first_date: rows[0]?.date, last_date: rows.at(-1)?.date },
  method: 'walk-forward by edition start date; features = serve/return points won from strictly earlier editions, shrunk (k=400) to tour mean 0.56; exact Markov solver averaged over first server; ranking baseline c fitted on the earlier half',
  test_all: { simulator: metric(test, (x) => x.pSim), rank_baseline: { c: +bestC.toFixed(2), ...metric(test, (x) => rankP(x, bestC)) }, coin: metric(test, () => 0.5) },
  test_informed_both_150pts: informed.length ? { simulator: metric(informed, (x) => x.pSim), rank_baseline: metric(informed, (x) => rankP(x, bestC)) } : null,
  calibration_simulator: calib(test, (x) => x.pSim),
  note: 'Side A/B is the source listing order; if the source lists the favourite first, accuracy vs 0.5 is inflated — compare against the ranking baseline, not the coin.'
};
fs.writeFileSync('docs/evidence/sim-backtest-latest.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ data: out.data, test_all: out.test_all, informed: out.test_informed_both_150pts }, null, 1));
if (process.argv.includes('--write')) {
  await store.insert('tennis_model_evaluations', [{ model_version: SIM_VERSION, evaluation: out }]).catch((e) => console.error('evaluation row not written:', e.message));
}
