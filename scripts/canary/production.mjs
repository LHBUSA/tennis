#!/usr/bin/env node
// Production canary: exercises the deployed stack end to end and checks canonical-data integrity.
//   node scripts/canary/production.mjs            -> docs/evidence/production-canary-latest.json
// Exit 1 when any check FAILs. Read-only everywhere (HTTP GETs + SELECTs through the Supabase
// Management API runner). No secret is printed or written.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API = process.env.TENNIS_API || 'https://tennis-api.propbetedge.ai';
const INGEST = 'https://tennis-ingest.sales-fd3.workers.dev';
const LIVE = 'https://tennis-live.sales-fd3.workers.dev';
const checks = [];
const add = (name, ok, detail, level = 'FAIL') => checks.push({ name, result: ok ? 'PASS' : level, detail });

async function get(url) {
  const t = Date.now();
  const r = await fetch(url, { headers: { 'user-agent': 'PropBetEdge-Tennis-ProductionCanary/0.1' } });
  let body = null;
  try { body = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body, ms: Date.now() - t };
}

function sql(query) {
  const out = execFileSync('pwsh', ['-NoProfile', '-File', path.join(ROOT, 'scripts', 'db', 'run_sql.ps1'), '-Query', query], { encoding: 'utf8' });
  if (out.startsWith('FAILED')) throw new Error(out.slice(0, 300));
  const j = JSON.parse(out);
  return Array.isArray(j) ? j : [j];
}

// ---- 1. Workers health ---------------------------------------------------------------------------------
for (const [name, url] of [['tennis-api', `${API}/health`], ['tennis-ingest', `${INGEST}/health`], ['tennis-live', `${LIVE}/health`]]) {
  const r = await get(url);
  const deps = r.body?.dependencies || {};
  add(`${name} /health`, r.status === 200 && Object.values(deps).every((v) => v === 'configured'), { status: r.status, deps });
}

// ---- 2. ingest + live runtime ----------------------------------------------------------------------------
const runs = (await get(`${INGEST}/v1/runs`)).body?.data;
const last = runs?.last_run;
const age = last ? (Date.now() - Date.parse(last.finished_at)) / 1000 : null;
add('ingest ran within 10 min', age != null && age < 600, { finished_at: last?.finished_at, age_s: age && Math.round(age) });
add('ingest steps all ok', !!last && last.steps.every((s) => s.ok), { failed: last?.steps.filter((s) => !s.ok).map((s) => `${s.step}: ${s.error}`) });
add('ingest upstream never blocked', !!last && (last.client?.blocked || 0) === 0, last?.client);
const liveRun = (await get(`${LIVE}/v1/live/runs`)).body?.data;
const liveAge = liveRun ? (Date.now() - Date.parse(liveRun.finished_at || liveRun.started_at)) / 1000 : null;
add('tennis-live cycled within 3 min', liveAge != null && liveAge < 180, { started_at: liveRun?.started_at, editions: liveRun?.editions, age_s: liveAge && Math.round(liveAge) });

// ---- 3. public API routes -----------------------------------------------------------------------------
const routes = ['/v1/today', '/v1/live', '/v1/tournaments', '/v1/rankings?tour=wta&type=singles&limit=5', '/v1/rankings?tour=wta&type=doubles&limit=5', '/v1/players?q=ryb', '/v1/sources'];
for (const r of routes) {
  const x = await get(API + r);
  const m = x.body?.meta;
  const okShape = m && ['source', 'fetched_at', 'source_updated_at', 'age_s', 'freshness', 'semantics', 'degraded'].every((k) => k in m);
  add(`API ${r}`, x.status === 200 && okShape && !['ERROR'].includes(m.freshness), { status: x.status, freshness: m?.freshness, ms: x.ms });
}
const today = (await get(`${API}/v1/today`)).body?.data;
const anyMatch = today?.latest_results?.[0] || today?.live?.[0];
if (anyMatch) {
  const mm = await get(`${API}/v1/matches/${anyMatch.id}`);
  add('API match detail', mm.status === 200 && mm.body?.data?.id === anyMatch.id, { id: anyMatch.id, freshness: mm.body?.meta?.freshness });
  const slug = anyMatch.sides?.A?.players?.[0]?.slug;
  if (slug) {
    const p = await get(`${API}/v1/players/${slug}`);
    add('API player profile', p.status === 200 && p.body?.data?.slug === slug, { slug });
    const d = await get(`${API}/v1/players/${slug}/dna`);
    const dd = d.body?.data?.dna;
    // v2 contract: stored snapshot under data.dna; percentiles are tour-scoped (ATP and WTA never pooled)
    add('API player DNA contract', d.status === 200 && (dd === null || (dd?.definition_version === 1 && /^(ATP|WTA) singles players/.test(dd?.percentile_basis || ''))), { matches_considered: dd?.matches_considered ?? null, tour: dd?.tour ?? null });
  }
}
add('API unknown route 404', (await get(`${API}/v1/nope`)).status === 404, {});
// since 2026-09-27 the ATP list is served from a SECONDARY source: it must say so, never claim to be official
{ const r = (await get(`${API}/v1/rankings?tour=atp`)).body; const sem = String(r?.meta?.semantics || ''); add('API ATP rankings labelled secondary, never official', r?.data === null || (/secondary source/i.test(sem) && /not an official ATP feed/i.test(sem)), { rows: r?.data?.rows?.length ?? null }); }
add('API picks not fabricated', (await get(`${API}/v1/pbe-picks`)).body?.data === null, {});

// ---- 4. canonical integrity (SQL) ---------------------------------------------------------------------
const [q] = sql(`select
  (select count(*) from tennis_matches where status in ('completed','retired','walkover','defaulted') and winner_side is null) final_without_winner,
  (select count(*) from tennis_matches m where not exists (select 1 from tennis_match_participants p where p.match_id = m.match_id and p.side = 'A') or not exists (select 1 from tennis_match_participants p where p.match_id = m.match_id and p.side = 'B')) matches_missing_side,
  (select count(*) from tennis_participants p where (select count(*) from tennis_participant_members m where m.participant_key = p.participant_key) <> case when p.kind = 'singles' then 1 else 2 end) participants_wrong_size,
  (select count(*) from tennis_match_participants mp join tennis_matches m using (match_id) join tennis_participants p using (participant_key) where (m.event_type in ('MS','WS')) <> (p.kind = 'singles')) event_size_mismatch,
  (select count(*) from tennis_players where slug is null) players_without_slug,
  (select count(*) from (select pbe_player_id from tennis_player_external_ids where provider in ('wta','atp') group by pbe_player_id, provider having count(*) > 1) x) player_with_two_tour_ids,
  (select count(*) from tennis_ingest_holds where resolved_at is null) open_holds,
  (select count(*) from tennis_matches) matches, (select count(*) from tennis_players) players,
  (select count(*) from tennis_match_stats) stats_rows, (select count(*) from tennis_ranking_snapshots where row_count > 0) complete_snapshots,
  (select count(*) from tennis_source_changes) changes, (select count(*) from tennis_source_captures) captures,
  (select count(distinct pbe_player_id) from tennis_player_external_ids where provider = 'wikidata') players_with_wikidata,
  (select count(*) from tennis_player_external_ids e1 join tennis_player_external_ids e2 on e1.pbe_player_id = e2.pbe_player_id and e2.provider = 'wimbledon' where e1.provider = 'atp') wimbledon_linked_to_atp`);
add('no final match without a winner', q.final_without_winner === 0, q.final_without_winner);
add('every match has both sides', q.matches_missing_side === 0, q.matches_missing_side);
add('participant sizes match kind', q.participants_wrong_size === 0, q.participants_wrong_size);
add('singles events use singles participants, doubles use pairs', q.event_size_mismatch === 0, q.event_size_mismatch);
add('every player has a slug', q.players_without_slug === 0, q.players_without_slug);
add('no player carries two ids from the same tour', q.player_with_two_tour_ids === 0, q.player_with_two_tour_ids);
add('raw captures archived (R2 lineage rows present)', q.captures > 0, q.captures);
add('open ingest holds are few (reviewable)', q.open_holds < 25, q.open_holds, 'WARN');

// ---- 5. validity re-check of stored scores ------------------------------------------------------------
const { validateScore } = await import('../../workers/shared/canonical/scoring.js');
const sample = sql(`select m.match_id, m.format_key, m.status, m.winner_side, json_agg(json_build_object('A', s.games_a, 'B', s.games_b, 'tbA', s.tb_a, 'tbB', s.tb_b, 'mtb', s.is_match_tiebreak) order by s.set_no) sets from tennis_matches m join tennis_sets s using (match_id) where m.status in ('completed','retired') and m.format_key <> 'unknown' group by 1,2,3,4 order by random() limit 300`);
let bad = 0;
for (const r of sample) {
  const sets = (typeof r.sets === 'string' ? JSON.parse(r.sets) : r.sets).map((s) => ({ games: { A: s.A, B: s.B }, tiebreak: s.tbA == null ? null : { A: s.tbA, B: s.tbB }, is_match_tiebreak: s.mtb }));
  const v = validateScore({ sets, end_reason: r.status === 'retired' ? 'retirement' : 'completed' }, r.format_key);
  if (!v.ok || (r.status === 'completed' && v.winner !== r.winner_side)) bad += 1;
}
add(`stored scores re-validate (${sample.length} sampled)`, bad === 0, { invalid: bad });

const summary = checks.reduce((m, c) => ({ ...m, [c.result]: (m[c.result] || 0) + 1 }), {});
const doc = { run_at: new Date().toISOString(), api: API, summary, totals: { matches: q.matches, players: q.players, stats_rows: q.stats_rows, complete_ranking_snapshots: q.complete_snapshots, observed_changes: q.changes, raw_captures: q.captures, players_with_wikidata: q.players_with_wikidata, wimbledon_rows_linked_to_atp_ids: q.wimbledon_linked_to_atp }, backfill: runs?.backfill, checks };
fs.writeFileSync(path.join(ROOT, 'docs', 'evidence', 'production-canary-latest.json'), `${JSON.stringify(doc, null, 2)}\n`);
for (const c of checks) console.log(`${c.result.padEnd(5)} ${c.name}${c.result !== 'PASS' ? `  ${JSON.stringify(c.detail).slice(0, 200)}` : ''}`);
console.log(`\nproduction canary: ${JSON.stringify(summary)} · ${JSON.stringify(doc.totals)}`);
process.exit(summary.FAIL ? 1 : 0);
