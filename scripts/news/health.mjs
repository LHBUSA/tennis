#!/usr/bin/env node
// Newsroom health (V3): publication distribution, latency and evidence attachment — makes starvation visible.
//   node scripts/news/health.mjs            -> console summary + docs/evidence/newsroom-v3-health-latest.json
// Read-only SQL via scripts/db/run_sql.ps1 (Management API); the Supabase service key is never read locally.
//
// Latency is measured from the FIRST observation of the match's terminal state (min tennis_source_changes.observed_at
// where field = 'status' and to_value is completed/retired/walkover), falling back to source_updated_at only when no
// change row exists. tennis_matches.updated_at is NOT a clock (every re-read rewrites it). Catch-up events (terminal
// state first observed > 6 h before detection, or match day more than 2 days before detection) are a separate bucket,
// never mixed into the live p95. detect -> publish uses the first 'publish' pipeline event; the owner-approved launch
// batch of 2026-09-26 is reported separately.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const sql = (q) => {
  const out = execFileSync('pwsh', ['-NoProfile', '-File', 'scripts/db/run_sql.ps1', '-Query', q], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const at = ['[', '{'].map((c) => out.indexOf(c)).filter((x) => x >= 0);
  if (!at.length) return [];
  const v = JSON.parse(out.slice(Math.min(...at)));
  if (v && !Array.isArray(v) && v.message) throw new Error(v.message);
  return Array.isArray(v) ? v : [v];
};
const SLAMS = "('australian-open','roland-garros','wimbledon','us-open')";
const base = (h) => `with ev as (
  select e.event_id, e.kind, e.state, e.editorial_class, e.detected_at, e.match_id, e.article_id,
    coalesce(e.evidence->'facts'->>'tour', case when m.event_type in ('MS','MD') then 'atp' when m.event_type in ('WS','WD') then 'wta' when m.event_type = 'XD' then 'mixed' when e.evidence->'facts'->>'list' like 'atp%' then 'atp' when e.evidence->'facts'->>'list' like 'wta%' then 'wta' end) tour,
    m.event_type, (x.level = 'Grand Slam' or t.slug in ${SLAMS}) slam, e.match_id is null ranking
  from tennis_news_events e left join tennis_matches m on m.match_id = e.match_id left join tennis_tournament_editions x on x.edition_id = m.edition_id left join tennis_tournaments t on t.tournament_id = x.tournament_id
  where e.detected_at > now() - interval '${h} hours')`;

function distribution(h) {
  const [r] = sql(`${base(h)} select count(*) detected,
    count(*) filter (where state = 'wire') wire, count(*) filter (where editorial_class = 'brief') brief, count(*) filter (where editorial_class = 'full') "full", count(*) filter (where editorial_class = 'deep') deep,
    count(*) filter (where state = 'held') held, count(*) filter (where state = 'duplicate') duplicates, count(*) filter (where state = 'below_threshold') below_bar_legacy,
    count(*) filter (where state in ('detected','enriching')) queued, count(*) filter (where state = 'published') published,
    json_build_object(
      'atp', json_build_object('events', count(*) filter (where tour = 'atp' and state <> 'duplicate'), 'published', count(*) filter (where tour = 'atp' and state = 'published'), 'wire', count(*) filter (where tour = 'atp' and state = 'wire')),
      'wta', json_build_object('events', count(*) filter (where tour = 'wta' and state <> 'duplicate'), 'published', count(*) filter (where tour = 'wta' and state = 'published'), 'wire', count(*) filter (where tour = 'wta' and state = 'wire')),
      'doubles', json_build_object('events', count(*) filter (where event_type in ('MD','WD','XD') and state <> 'duplicate'), 'published', count(*) filter (where event_type in ('MD','WD','XD') and state = 'published')),
      'grand_slams', json_build_object('events', count(*) filter (where slam and state <> 'duplicate'), 'published', count(*) filter (where slam and state = 'published')),
      'rankings', json_build_object('events', count(*) filter (where ranking and state <> 'duplicate'), 'published', count(*) filter (where ranking and state = 'published'))) by_desk
    from ev`);
  const [a] = sql(`select count(*) published_articles, count(*) filter (where story_class = 'brief') brief, count(*) filter (where story_class = 'full') "full", count(*) filter (where story_class = 'deep') deep, count(*) filter (where revised_at is not null) revised from tennis_articles where status = 'published' and first_published_at > now() - interval '${h} hours'`);
  return { ...r, articles: a };
}

function latency(h) {
  const rows = sql(`${base(h)}, lat as (
    select ev.event_id, ev.detected_at, ev.state, m.source_updated_at, coalesce(m.started_at::date, x.start_date) match_day,
      (select min(c.observed_at) from tennis_source_changes c where c.entity_type = 'match' and c.entity_id = ev.match_id::text and c.field = 'status' and (c.to_value #>> '{}') in ('completed','retired','walkover')) final_seen,
      (select min(p.at) from tennis_news_pipeline_events p where p.event_id = ev.event_id and p.stage = 'publish') published_at,
      (select a.first_published_at from tennis_articles a where a.article_id = ev.article_id) first_pub
    from ev join tennis_matches m on m.match_id = ev.match_id join tennis_tournament_editions x on x.edition_id = m.edition_id where ev.state <> 'duplicate')
    select event_id, extract(epoch from detected_at - coalesce(final_seen, source_updated_at)) / 60 src_to_detect_min, final_seen is not null from_status_change,
      (coalesce(final_seen, source_updated_at) < detected_at - interval '6 hours' or match_day < (detected_at::date - 2)) catch_up,
      extract(epoch from coalesce(published_at, first_pub) - detected_at) / 60 detect_to_publish_min, (first_pub < '2026-09-27') launch_batch
    from lat`);
  const q = (xs, p) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10 : null; };
  const live = rows.filter((r) => !r.catch_up && r.src_to_detect_min != null).map((r) => Number(r.src_to_detect_min));
  const pub = rows.filter((r) => r.detect_to_publish_min != null && !r.launch_batch).map((r) => Number(r.detect_to_publish_min));
  return {
    source_to_detect_min: { live_events: live.length, p50: q(live, 0.5), p95: q(live, 0.95), catch_up_events: rows.filter((r) => r.catch_up).length, without_any_source_clock: rows.filter((r) => r.src_to_detect_min == null).length, basis: 'first observation of the terminal status (fallback source_updated_at)' },
    detect_to_wire_min: { p50: 0, p95: 0, basis: 'the live wire is a read projection of detected events: visible on detection (API cache <= 2 min)' },
    detect_to_publish_min: { stories: pub.length, p50: q(pub, 0.5), p95: q(pub, 0.95), launch_batch_excluded: rows.filter((r) => r.launch_batch).length }
  };
}

function intelligence(h) {
  const [r] = sql(`select count(*) articles,
    count(*) filter (where ev.packet ? 'match_dna') match_dna, count(*) filter (where ev.packet ? 'dna') technical_dna, count(*) filter (where ev.packet ? 'expectation') pre_match_rating,
    count(*) filter (where coalesce((a.content_plan->>'chart_count')::int, 0) > 0) charts, count(*) filter (where ev.packet->'h2h'->'prior_meetings' is not null and jsonb_array_length(ev.packet->'h2h'->'prior_meetings') > 0) h2h,
    count(*) filter (where ev.packet ? 'draw_path') draw_path, count(*) filter (where cardinality(a.player_ids) > 0) player_links, count(*) filter (where a.tournament->>'slug' is not null) tournament_links,
    count(*) filter (where jsonb_array_length(coalesce(a.content_plan->'media'->'images', '[]'::jsonb)) > 0) media_resolved,
    count(*) filter (where a.content_plan ? 'glance') glance, count(*) filter (where a.content_plan->'intelligence' is not null and a.content_plan->>'intelligence' <> 'null') intelligence_module
    from tennis_articles a left join tennis_article_evidence ev on ev.article_id = a.article_id where a.status = 'published' and a.first_published_at > now() - interval '${h} hours'`);
  const pct = (k) => (Number(r.articles) ? Math.round((Number(r[k]) / Number(r.articles)) * 1000) / 10 : null);
  return { articles: Number(r.articles), pct: Object.fromEntries(['match_dna', 'technical_dna', 'pre_match_rating', 'charts', 'h2h', 'draw_path', 'player_links', 'tournament_links', 'media_resolved', 'glance', 'intelligence_module'].map((k) => [k, pct(k)])) };
}

const report = { generated_at: new Date().toISOString(), windows: {} };
for (const [label, h] of [['24h', 24], ['7d', 168]]) report.windows[label] = { distribution: distribution(h), latency: latency(h), intelligence: intelligence(h) };
const d7 = report.windows['7d'].distribution;
report.starvation_flags = [];
if (Number(d7.detected) >= 50 && Number(d7.published) + Number(d7.queued) < 5) report.starvation_flags.push(`only ${d7.published} published (+${d7.queued} queued) from ${d7.detected} detected in 7 days`);
if (Number(d7.wire) === 0 && Number(d7.detected) > 0) report.starvation_flags.push('no live-wire items in 7 days');
if (Number(d7.by_desk.atp.published) === 0 && Number(d7.by_desk.atp.events) > 0) report.starvation_flags.push(`ATP: ${d7.by_desk.atp.events} events, 0 published`);
fs.mkdirSync('docs/evidence', { recursive: true });
fs.writeFileSync('docs/evidence/newsroom-v3-health-latest.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
