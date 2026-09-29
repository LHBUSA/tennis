#!/usr/bin/env node
// Newsroom V3 replay: every newsroom event of the last N days through the V3 classifier.
//   node scripts/news/replay.mjs [--days 7] [--base https://<version>-tennis-news.sales-fd3.workers.dev]
// Local mode (always): facts completed point-in-time from the database (read-only SQL via scripts/db/run_sql.ps1; the
// Supabase service key is never read locally) -> PRELIMINARY class (significance, facts only).
// --base: the tennis-news Worker's admin dry run (POST /v1/news/reclassify?dry=1) adds the FINAL class from each event's
// frozen-packet evidence dimensions. Run it against an uploaded (0%) version BEFORE promoting; nothing is written.
// Output: docs/evidence/newsroom-v3-replay-latest.json (+ owner-principle checks; violations must be 0).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { classifyEvent, tierOf } from '../../workers/tennis-news/src/classify.js';
import { atpTierForEdition } from '../../workers/shared/atp-tiers.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('days', 7));
const BASE = arg('base', null);
const sql = (q) => {
  const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0);
  if (!at.length) return [];
  const v = JSON.parse(out.slice(Math.min(...at)));
  if (v && !Array.isArray(v) && v.message) throw new Error(v.message);
  return Array.isArray(v) ? v : [v];
};

const rows = sql(`with ev as (select e.event_id, e.kind, e.materiality::float mat, e.state, e.detected_at, e.match_id, e.article_id, e.signature, e.evidence->'facts' f from tennis_news_events e where e.detected_at > now() - interval '${DAYS} days')
select ev.*, m.event_type, m.round, m.winner_side, x.level, x.competition_key, x.source_family ed_source, x.start_date, x.edition_id, t.slug, t.name tname,
  (select json_agg(json_build_object('side', mp.side, 'seed', mp.seed, 'entry', mp.entry_type, 'pid', pm.pbe_player_id)) from tennis_match_participants mp join tennis_participant_members pm on pm.participant_key = mp.participant_key where mp.match_id = m.match_id) parts
from ev left join tennis_matches m on m.match_id = ev.match_id left join tennis_tournament_editions x on x.edition_id = m.edition_id left join tennis_tournaments t on t.tournament_id = x.tournament_id order by ev.detected_at`);

// point-in-time ranks: the list in force at the tournament start (latest list dated on/before it)
const singlesPids = [...new Set(rows.filter((r) => ['MS', 'WS'].includes(r.event_type)).flatMap((r) => (r.parts || []).map((p) => p.pid)))];
const ranks = singlesPids.length ? sql(`select r.pbe_player_id pid, r.rank, s.ranking_date d, s.list_key l from tennis_rankings r join tennis_ranking_snapshots s on s.snapshot_id = r.snapshot_id where s.list_key in ('atp_singles','wta_singles') and s.row_count > 0 and s.ranking_date > now() - interval '${DAYS + 45} days' and r.pbe_player_id in (${singlesPids.map((x) => `'${x}'`).join(',')})`) : [];
const rankAt = (pid, list, date) => ranks.filter((r) => r.pid === pid && r.l === list && r.d <= date).sort((a, b) => (a.d < b.d ? 1 : -1))[0]?.rank ?? null;

const out = [];
for (const r of rows) {
  const f0 = typeof r.f === 'string' ? JSON.parse(r.f) : r.f || {};
  const facts = { ...f0 };
  if (r.match_id) {
    const W = r.winner_side;
    const L = W === 'A' ? 'B' : 'A';
    const side = (s) => (r.parts || []).filter((p) => p.side === s);
    const list = r.event_type === 'MS' ? 'atp_singles' : r.event_type === 'WS' ? 'wta_singles' : null;
    const one = (s) => (side(s).length === 1 ? side(s)[0] : null);
    const tier = ['MS', 'MD', 'XD'].includes(r.event_type) && !r.level ? await atpTierForEdition(r.edition_id) : null;
    const add = { level: r.level, competition_key: r.competition_key, tournament_slug: r.slug, source_family: r.ed_source, edition_tier: tier?.tier || null, round: r.round, event_type: r.event_type, tour: f0.tour || ({ MS: 'atp', MD: 'atp', WS: 'wta', WD: 'wta', XD: 'mixed' }[r.event_type]), winner_rank: list && one(W) ? rankAt(one(W).pid, list, r.start_date) : null, loser_rank: list && one(L) ? rankAt(one(L).pid, list, r.start_date) : null, winner_seed: one(W)?.seed ?? null, loser_seed: one(L)?.seed ?? null };
    for (const [k, v] of Object.entries(add)) if (facts[k] == null && v != null) facts[k] = v;
  }
  const pre = r.state === 'duplicate' ? null : classifyEvent({ kind: r.kind, facts });
  out.push({ signature: r.signature, event_id: r.event_id, kind: r.kind, tour: facts.tour || (facts.list ? facts.list.split('_')[0] : null), event_type: r.event_type || null, tournament: r.tname || null, tier: pre?.tier ?? tierOf(facts), round: r.round || null, loser_rank: facts.loser_rank ?? null, materiality: r.mat, old_state: r.state, detected_at: r.detected_at, preliminary: pre?.surface ?? 'duplicate', class: pre?.surface ?? 'duplicate', reasons: pre?.reasons || [`merged into the match's canonical event`], evidence_dimensions: null, would_create_article: !!pre?.publish_article && !r.article_id, existing_article: !!r.article_id });
}

// FINAL class from the frozen packet (worker dry run)
if (BASE) {
  const TOKEN = fs.readFileSync('D:/Workers/secrets/tennis-news-admin-token', 'utf8').trim();
  const byId = new Map(out.map((x) => [x.event_id, x]));
  for (let offset = 0; offset != null;) {
    const res = await fetch(`${BASE}/v1/news/reclassify?dry=1&days=${DAYS}&offset=${offset}&limit=200`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
    const j = JSON.parse((await res.text()).replaceAll(TOKEN, '***'));
    if (!j.ok) throw new Error(`reclassify: ${JSON.stringify(j).slice(0, 300)}`);
    for (const e of j.data.events) {
      const x = byId.get(e.event_id);
      if (!x) continue;
      Object.assign(x, { preliminary: e.preliminary, class: e.class, reasons: e.reasons, evidence_dimensions: e.evidence_dimensions, would_create_article: e.would_create_article, duplicate_of: e.duplicate_of || null });
    }
    offset = j.data.next_offset;
  }
}

// one canonical event per signature (the worker applies the same rule in --base mode)
if (!BASE) {
  const RANKC = { duplicate: -1, wire: 0, brief: 1, full: 2, deep: 3 };
  const bySig = new Map();
  for (const x of out) {
    if (x.class === 'duplicate') continue;
    const prev = bySig.get(x.signature);
    if (!prev) { bySig.set(x.signature, x); continue; }
    const keepNew = !prev.existing_article && (x.existing_article || RANKC[x.class] > RANKC[prev.class]);
    const loser = keepNew ? prev : x;
    loser.duplicate_of = keepNew ? x.event_id : prev.event_id; loser.class = 'duplicate'; loser.would_create_article = false;
    if (keepNew) bySig.set(x.signature, x);
  }
}

// owner-principle checks (violations must be 0)
const violations = [];
for (const x of out) {
  if (x.kind === 'title' && ['MS', 'WS'].includes(x.event_type) && x.tier !== 'itf' && x.class !== 'duplicate' && !['brief', 'full', 'deep'].includes(x.class)) violations.push({ rule: 'tour singles title >= brief', event_id: x.event_id, class: x.class });
  if (x.kind === 'comeback' && /^(M-)?[12]$/.test(String(x.round)) && !(x.loser_rank && x.loser_rank <= 10) && x.class !== 'wire' && x.class !== 'duplicate') violations.push({ rule: 'routine R1/R2 comeback is wire', event_id: x.event_id, class: x.class });
  if (x.kind === 'deciding_tiebreak' && /^(M-)?[12]$/.test(String(x.round)) && x.class !== 'wire' && x.class !== 'duplicate') violations.push({ rule: 'ordinary deciding tiebreak is wire', event_id: x.event_id, class: x.class });
  if (x.kind === 'upset' && x.loser_rank && x.loser_rank <= 10 && x.class === 'wire') violations.push({ rule: 'top-10 upset >= brief', event_id: x.event_id });
}
const articleMatches = new Map();
for (const x of out.filter((y) => y.class !== 'duplicate' && y.class !== 'wire')) { const k = x.event_id; articleMatches.set(k, (articleMatches.get(k) || 0) + 1); }
const count = (f) => out.filter(f).length;
const tours = ['atp', 'wta', 'mixed', null];
const summary = { generated_at: new Date().toISOString(), days: DAYS, mode: BASE ? 'final (frozen-packet evidence via worker dry run)' : 'preliminary (facts only)', events: out.length,
  by_class: Object.fromEntries(['wire', 'brief', 'full', 'deep', 'duplicate'].map((c) => [c, count((x) => x.class === c)])),
  by_class_and_tour: Object.fromEntries(tours.map((t) => [t || 'unknown', Object.fromEntries(['wire', 'brief', 'full', 'deep', 'duplicate'].map((c) => [c, count((x) => (x.tour || null) === t && x.class === c)]))])),
  would_create_articles: count((x) => x.would_create_article), existing_articles: count((x) => x.existing_article),
  titles: out.filter((x) => x.kind === 'title' || x.kind === 'doubles_title').map((x) => ({ tournament: x.tournament, kind: x.kind, event_type: x.event_type, tier: x.tier, materiality: x.materiality, old_state: x.old_state, class: x.class })),
  principle_violations: violations };
fs.mkdirSync('docs/evidence', { recursive: true });
fs.writeFileSync('docs/evidence/newsroom-v3-replay-latest.json', JSON.stringify({ summary, events: out }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
