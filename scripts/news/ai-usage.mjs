#!/usr/bin/env node
// Tennis AI usage (V4): today's model calls by pool and lane, nominal standard-rate cost, and the Tennis soft-cap status.
//   node scripts/news/ai-usage.mjs [--date YYYY-MM-DD]
// Reads tennis_news_pipeline_events (stage 'cost', detail.kind 'model_call') via scripts/db/run_sql.ps1 (read-only). The
// premium and volume pools are SHARED organisation pools: these numbers are Tennis's share only. Nominal cost is never an
// actual bill (the organisation may receive complimentary tokens). Canary calls are counted separately by the Worker
// (KV tennis:ai:tokens:canary-premium:<date>, GET /v1/news/ai-usage).
import { execFileSync } from 'node:child_process';

const i = process.argv.indexOf('--date');
const DAY = i > 0 ? process.argv[i + 1] : new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY)) { console.error('--date YYYY-MM-DD'); process.exit(2); }
const CAP = Number(process.env.TENNIS_PREMIUM_DAILY_SOFT_CAP || 300000);
const WARN = Number(process.env.TENNIS_PREMIUM_DAILY_WARN || 250000);
const sql = (q) => { const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 16 << 20 }); const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0); if (!at.length) return []; const v = JSON.parse(out.slice(Math.min(...at))); if (v && !Array.isArray(v) && v.message) throw new Error(v.message); return Array.isArray(v) ? v : [v]; };

const rows = sql(`select coalesce(detail->>'pool','none') pool, coalesce(detail->>'routing_lane','?') lane, coalesce(detail->>'model','?') model, count(*) calls,
    count(*) filter (where status = 'fail') failed, sum(coalesce((detail->>'input_tokens')::bigint,0)) input_tokens, sum(coalesce((detail->>'cached_input_tokens')::bigint,0)) cached_input_tokens,
    sum(coalesce((detail->>'output_tokens')::bigint,0)) output_tokens, sum(coalesce((detail->>'reasoning_tokens')::bigint,0)) reasoning_tokens,
    sum((detail->>'nominal_standard_cost')::numeric) nominal_standard_cost, count(*) filter (where detail->>'nominal_standard_cost' is null) unpriced_calls
  from tennis_news_pipeline_events where stage = 'cost' and detail->>'kind' = 'model_call' and at >= '${DAY}T00:00:00Z' and at < ('${DAY}'::date + 1)::timestamptz
  group by 1,2,3 order by 1,2,3`);
const tot = (pool) => rows.filter((r) => r.pool === pool).reduce((t, r) => t + Number(r.input_tokens) + Number(r.output_tokens), 0);
const premium = tot('premium');
const volume = tot('volume');
const report = {
  date: DAY, basis: 'tennis_news_pipeline_events stage cost / kind model_call (Tennis share of the shared organisation pools)',
  premium_pool_tokens_today: premium, volume_pool_tokens_today: volume,
  soft_cap: { premium_cap: CAP, premium_warn: WARN, status: premium >= CAP ? 'REACHED (model prose falls back to deterministic baseline)' : premium >= WARN ? 'WARN' : 'ok' },
  nominal_standard_cost_usd: rows.reduce((t, r) => t + (Number(r.nominal_standard_cost) || 0), 0), unpriced_calls: rows.reduce((t, r) => t + Number(r.unpriced_calls || 0), 0),
  by_lane: rows
};
console.log(JSON.stringify(report, null, 2));
