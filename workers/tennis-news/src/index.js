// tennis-news — evidence-grounded tennis newsroom (docs/NEWSROOM.md).
//
// DETECTION = deterministic (detect.js) · EVIDENCE = deterministic (packet.js, frozen before writing)
// CHARTS = deterministic (plan.js) · FACT CHECKING = deterministic (gates.js)
// PROSE = AI-assisted (editorial.js, GPT-5.6 Sol, same architecture as UFC) with the deterministic writer
// (compose.js) as the fact-safe fallback · FAILURE = fallback or HOLD, never a relaxed gate.
//
// Cron */2: detect new events from our own graph, then enrich up to ENRICH_LIMIT claimed events under a
// lease. NEWS_PUBLISH_ENABLED != "true" is SHADOW mode: everything is written as HOLD (reason "shadow").

import { json } from '../../shared/envelope.js';
import { health } from '../../shared/health.js';
import { storeFromEnv, inList } from '../../shared/store/postgrest.js';
import { detectMatchEvents, detectRankingEvents, PUBLISH_MIN_MATERIALITY, DETECTOR_VERSION, GATED_KINDS } from './detect.js';
import { buildPacket, loadMatches, rankAt, PACKET_VERSION } from './packet.js';
import { compose, slugFor, COMPOSE_VERSION } from './compose.js';
import { buildPlan } from './plan.js';
import { runGates, GATES_VERSION } from './gates.js';
import { editorialize, costUsd, redactSecrets, EDITORIAL_VERSION } from './editorial.js';
import { resolveHero } from '../../shared/editorial.js';
import { RANKING_LISTS, MILESTONE_LISTS, tourOf, tourOfList, pickFair } from './tour.js';
import editorial from '../../../data/media/editorial-media.json' with { type: 'json' };

export const VERSION = '1.2.0';

function heroAtCreation(packet, plan) {
  const parts = packet.participants || null;
  const all = parts ? ['A', 'B'].flatMap((s) => parts[s]?.players || []) : packet.player ? [packet.player] : [];
  const winner = (plan.modules || []).find((m) => m.id === 'scoreboard')?.data?.winner_side || null;
  const featured = winner && parts?.[winner] ? parts[winner].players : packet.player ? [packet.player] : [];
  const photos = new Map(all.filter((p) => p.photo?.square).map((p) => [p.id, { slug: p.slug, name: p.name, square: p.photo.square, wide: p.photo.wide || null, portrait: p.photo.portrait || null, square_jpg: p.photo.square_jpg || null, author: p.photo.author || null, license: p.photo.license || null, source_page: p.photo.source_page || null }]));
  const t = packet.tournament || {};
  const r = resolveHero({ match_id: packet.match?.id || null, tournament: { slug: t.slug || null, year: t.year || null }, featured_ids: featured.map((p) => p.id), player_ids: all.map((p) => p.id) }, editorial, photos);
  return { resolved_at: new Date().toISOString(), type: r.type, confidence: r.confidence, fallback_reason: r.fallback_reason, subjects: r.subjects, images: r.images.map((i) => ({ kind: i.kind, id: i.id || null, player_id: i.player_id || null, source_page: i.source_page || null, license: i.license || null })) };
}
const FRESH_H = 72;
const ENRICH_LIMIT = 3;
const LEASE_S = 360;
const BASELINE_MIN_MATERIALITY = 70; // the deterministic fallback publishes only for clearly material events
const iso = (d = new Date()) => d.toISOString();

async function telemetry(store, rows) {
  try { await store.insert('tennis_news_pipeline_events', rows); } catch { /* telemetry never breaks the pipeline */ }
}

// ---- detection ----------------------------------------------------------------------------------------
export function detectorInput(m, ranks) {
  const side = (s) => {
    const x = m.sides[s] || { players: [] };
    const p0 = x.players[0];
    const r = p0 ? ranks.get(p0.id) : null;
    return { players: x.players.map((p) => ({ id: p.id, name: p.name })), rank: x.players.length === 1 ? r?.rank ?? null : null, list_date: r?.list_date ?? null, seed: x.seed, entry: x.entry };
  };
  return { id: m.id, event_type: m.event_type, round: m.round, status: m.status, winner_side: m.winner_side, retired_side: m.status === 'retired' ? (m.winner_side === 'A' ? 'B' : 'A') : null, best_of: m.best_of, sets: m.sets.map((s) => ({ A: s.A, B: s.B, tb: !!s.tb })), duration_s: m.duration_s, started_at: m.started_at, edition: { id: m.tournament.edition_id, level: m.tournament.level, name: m.tournament.name, surface: m.tournament.surface, start_date: m.tournament.start_date, source_family: m.tournament.source_family || null, competition_key: m.tournament.competition_key || null }, list_depth: ranks.provenance?.truncated ? ranks.provenance.depth : null, sides: { A: side('A'), B: side('B') } };
}

export async function detect(env, store, { now = new Date(), dry = false } = {}) {
  const since = new Date(now.getTime() - FRESH_H * 3600e3);
  const sinceDate = iso(since).slice(0, 10);
  // freshness is judged on the MATCH date, not on when our backfill last touched the row
  // every event type of the one tennis product: men's and women's singles, both doubles, mixed
  const rows = await loadMatches(store, `status=in.(completed,retired,walkover)&event_type=in.(WS,MS,WD,MD,XD)&updated_at=gte.${iso(new Date(now.getTime() - 6 * 3600e3))}&limit=400`);
  const fresh = rows.filter((m) => (m.started_at ? m.started_at >= iso(since) : m.tournament.end_date >= sinceDate && m.tournament.start_date <= iso(now).slice(0, 10)));
  const byEdition = new Map();
  for (const m of fresh) { const k = `${m.tournament.edition_id}:${m.event_type}`; if (!byEdition.has(k)) byEdition.set(k, []); byEdition.get(k).push(m); }
  const candidates = [];
  for (const ms of byEdition.values()) {
    // the list that legitimately applies to this event type (WS -> WTA singles, MS -> ATP singles, WD -> WTA
    // doubles; MD/XD -> none held): an MS match never receives a WTA list, a doubles match never a singles list
    const listKey = RANKING_LISTS[ms[0].event_type] || null;
    const pids = [...new Set(ms.flatMap((m) => ['A', 'B'].flatMap((s) => m.sides[s]?.players.map((p) => p.id) || [])))];
    const ranks = listKey ? await rankAt(store, pids, ms[0].tournament.start_date, listKey) : new Map();
    for (const m of ms) {
      const evs = await detectMatchEvents(detectorInput(m, ranks));
      if (!evs.length) continue;
      evs.sort((a, b) => b.materiality - a.materiality);
      const [top, ...rest] = evs;
      top.facts = { ...top.facts, secondary_kinds: rest.map((e) => e.kind), event_type: m.event_type, tour: tourOf(m.event_type), rank_list: ranks.provenance ? listKey : null, rank_source_family: ranks.provenance?.source_family || null, rank_classification: ranks.provenance?.classification || null };
      candidates.push({ ...top, state: top.materiality >= PUBLISH_MIN_MATERIALITY ? 'detected' : 'below_threshold' });
      for (const e of rest) candidates.push({ ...e, state: 'duplicate', state_reason: `merged into ${top.event_id} (one story per match)` });
    }
  }
  // ranking milestones: once per new stored list, for every tour list we hold (provenance travels in the facts;
  // a list dated after today — ESPN weeks are dated to the Monday they take effect — waits for its date)
  for (const listKey of MILESTONE_LISTS) {
    const snaps = await store.select('tennis_ranking_snapshots', `select=snapshot_id,ranking_date,source_family,row_count&list_key=eq.${listKey}&row_count=gt.0&ranking_date=lte.${iso(now).slice(0, 10)}&order=ranking_date.desc&limit=2`);
    if (snaps.length < 2 || snaps[0].ranking_date < sinceDate) continue;
    const kvKey = `news:rank:${listKey}:${snaps[0].ranking_date}`;
    if (!dry && env.TENNIS_STATE && (await env.TENNIS_STATE.get(kvKey))) continue;
    const [next, prev] = await Promise.all(snaps.map((s) => store.select('tennis_rankings', `select=pbe_player_id,rank&snapshot_id=eq.${s.snapshot_id}&rank=lte.150`)));
    const evs = await detectRankingEvents({ listKey, prevDate: snaps[1].ranking_date, nextDate: snaps[0].ranking_date, prev: new Map(prev.map((r) => [r.pbe_player_id, r.rank])), next: new Map(next.filter((r) => r.rank <= 100).map((r) => [r.pbe_player_id, r.rank])) });
    for (const e of evs) candidates.push({ ...e, facts: { ...e.facts, tour: tourOfList(listKey), list_source_family: snaps[0].source_family || null }, state: e.materiality >= PUBLISH_MIN_MATERIALITY ? 'detected' : 'below_threshold' });
    if (!dry && env.TENNIS_STATE) await env.TENNIS_STATE.put(kvKey, iso(), { expirationTtl: 30 * 86400 });
  }
  if (dry || !candidates.length) return { scanned: rows.length, fresh: fresh.length, candidates: dry ? candidates.map((c) => ({ kind: c.kind, materiality: c.materiality, state: c.state, match_id: c.match_id || null, facts: c.facts })) : 0 };
  const known = new Set((await store.select('tennis_news_events', `select=event_id&event_id=${inList(candidates.map((c) => c.event_id))}`)).map((r) => r.event_id));
  const insert = candidates.filter((c) => !known.has(c.event_id)).map((c) => ({ event_id: c.event_id, kind: c.kind, occurred_at: c.occurred_at || iso(now), entities: c.entity_ids, materiality: c.materiality, evidence: { facts: c.facts, detector: c.detector }, state: c.state, state_reason: c.state_reason || null, signature: c.match_id ? `match:${c.match_id}` : `${c.kind}:${c.entity_ids[0]}:${c.facts.list_date}`, match_id: c.match_id || null, detected_at: iso(now) }));
  if (insert.length) {
    await store.upsert('tennis_news_events', insert, { onConflict: 'event_id', ignore: true });
    await telemetry(store, insert.map((e) => ({ event_id: e.event_id, stage: 'detect', status: e.state === 'detected' ? 'ok' : 'skip', detail: { kind: e.kind, materiality: e.materiality, state: e.state } })));
  }
  return { scanned: rows.length, fresh: fresh.length, candidates: candidates.length, new: insert.length, queued: insert.filter((e) => e.state === 'detected').length };
}

// ---- enrichment -----------------------------------------------------------------------------------------
// Tour-fair claim (brief section 8). tennis_news_claim orders by materiality only, so a constant stream of WTA
// events could keep an ATP event out of the ENRICH_LIMIT slots forever. We peek the claimable window in the RPC's
// own order, choose slots with pickFair (slot 1 = highest materiality; then the best event of the other tour; then
// the next highest), and claim each chosen row with a compare-and-set PATCH that repeats the RPC's eligibility
// predicate plus the attempts value we read. A row another run claimed in between matches nothing and is skipped
// (same outcome as FOR UPDATE SKIP LOCKED); no migration, no quota, and a tour with no candidate is simply absent.
const PEEK = 40;
const claimable = (nowIso) => `or=(state.eq.detected,and(state.eq.enriching,lease_expires_at.lt.${encodeURIComponent(nowIso)},attempts.lt.3))`;
export function eventTour(ev, matchTypes = new Map()) {
  const f = ev.evidence?.facts || {};
  if (f.tour) return f.tour;
  if (f.list) return tourOfList(f.list);
  return tourOf(f.event_type || matchTypes.get(ev.match_id)) || null;
}
export async function claimFair(store, { limit = ENRICH_LIMIT, leaseS = LEASE_S, now = new Date() } = {}) {
  const nowIso = now.toISOString();
  const window = await store.select('tennis_news_events', `select=*&${claimable(nowIso)}&order=materiality.desc.nullslast,detected_at.asc&limit=${PEEK}`);
  if (!window.length) return [];
  // events detected before tour facts were recorded: the tour comes from the stored match's event type
  const need = [...new Set(window.filter((e) => e.match_id && !e.evidence?.facts?.tour && !e.evidence?.facts?.event_type).map((e) => e.match_id))];
  const types = new Map(need.length ? (await store.select('tennis_matches', `select=match_id,event_type&match_id=${inList(need)}`)).map((r) => [r.match_id, r.event_type]) : []);
  const chosen = pickFair(window, limit, (e) => eventTour(e, types));
  const out = [];
  for (const ev of chosen) {
    const rows = await store.req('PATCH', `tennis_news_events?event_id=eq.${encodeURIComponent(ev.event_id)}&attempts=eq.${ev.attempts}&${claimable(nowIso)}`, {
      body: { state: 'enriching', lease_token: crypto.randomUUID(), lease_expires_at: new Date(now.getTime() + leaseS * 1000).toISOString(), attempts: Number(ev.attempts) + 1, state_changed_at: nowIso },
      prefer: 'return=representation'
    });
    if (rows?.[0]) out.push({ ...rows[0], tour: eventTour(ev, types) });
  }
  return out;
}

async function settle(store, ev, patch) {
  await store.req('PATCH', `tennis_news_events?event_id=eq.${encodeURIComponent(ev.event_id)}&lease_token=eq.${ev.lease_token}`, { body: { ...patch, state_changed_at: iso(), lease_token: null, lease_expires_at: null }, prefer: 'return=minimal' });
}

export async function enrichOne(env, store, ev) {
  const t0 = Date.now();
  const sinceDetect = () => Date.now() - Date.parse(ev.detected_at);
  const facts = ev.evidence?.facts || {};
  const candidate = { kind: ev.kind, event_id: ev.event_id, materiality: Number(ev.materiality), facts, occurred_at: ev.occurred_at, detector: ev.evidence?.detector, match_id: ev.match_id, entity_ids: ev.entities };
  const packet = await buildPacket(store, candidate);
  if (!packet) { await settle(store, ev, { state: 'held', state_reason: 'packet_unavailable' }); return { event_id: ev.event_id, state: 'held', reason: 'packet_unavailable' }; }

  // dedupe on the real-world event: an existing article for the same signature wins
  const dup = await store.select('tennis_news_events', `select=event_id,article_id&signature=eq.${encodeURIComponent(ev.signature)}&article_id=not.is.null&event_id=neq.${encodeURIComponent(ev.event_id)}&limit=1`);
  if (dup.length) {
    await settle(store, ev, { state: 'duplicate', state_reason: `same event as ${dup[0].event_id}` });
    await telemetry(store, [{ event_id: ev.event_id, stage: 'duplicate', status: 'skip', detail: { canonical: dup[0].event_id } }]);
    return { event_id: ev.event_id, state: 'duplicate' };
  }

  const baseline = compose(packet);
  const plan = buildPlan(packet, baseline);
  // presentation only: the hero chosen at creation from approved imagery (frozen packet photos + editorial
  // catalog), recorded with its fallback reason; tennis-api re-resolves at read time so an approved photo found
  // later upgrades the story without touching its facts
  plan.media = heroAtCreation(packet, plan);
  const articleId = crypto.randomUUID();
  const slug = slugFor(baseline, packet);
  // FREEZE the evidence before any prose is generated
  await store.insert('tennis_articles', [{ article_id: articleId, event_id: ev.event_id, slug, status: 'held', headline: baseline.headline, deck: baseline.dek, body: { sections: baseline.sections }, gate_results: { stage: 'frozen' }, editorial_version: EDITORIAL_VERSION, generator_version: COMPOSE_VERSION, story_type: baseline.story_type, desk: baseline.desk, primary_player_id: baseline.primary_player_id, player_ids: baseline.player_ids, match_id: baseline.match_id, tournament: baseline.tournament, key_stat: baseline.key_stat, content_plan: plan, hold_reason: 'generating', detected_at: ev.detected_at }]);
  await store.insert('tennis_article_evidence', [{ article_id: articleId, packet }]);
  await store.req('PATCH', `tennis_news_events?event_id=eq.${encodeURIComponent(ev.event_id)}`, { body: { article_id: articleId }, prefer: 'return=minimal' });
  await telemetry(store, [{ event_id: ev.event_id, article_id: articleId, stage: 'packet', status: 'ok', latency_ms: Date.now() - t0, since_detect_ms: sinceDetect(), detail: { version: PACKET_VERSION, families: Object.keys(packet) } }]);

  const gate = (a) => runGates(a, packet);
  const ed = await editorialize({ packet, baseline, gate, apiKey: env.OPENAI_API_KEY, model: env.TENNIS_EDITORIAL_OPENAI_MODEL || 'gpt-5.6-sol' });
  const usd = costUsd(ed.usage);
  if (ed.usage.input_tokens) await telemetry(store, [{ event_id: ev.event_id, article_id: articleId, stage: 'cost', status: 'ok', detail: { kind: 'cost', usd, ...ed.usage, origin: ed.origin } }]);
  await telemetry(store, [{ event_id: ev.event_id, article_id: articleId, stage: 'editorial', status: ed.origin ? 'ok' : 'fail', latency_ms: Date.now() - t0, detail: { origin: ed.origin, attempts: ed.attempts } }]);

  let status = 'held';
  let hold = null;
  if (!ed.origin) hold = `gates: ${ed.gate.failures.map((f) => f.gate).join(', ')}`;
  else if (env.NEWS_PUBLISH_ENABLED !== 'true') hold = `shadow (${ed.origin} prose passed gates)`;
  else if (ed.origin === 'baseline' && Number(ev.materiality) < BASELINE_MIN_MATERIALITY) hold = `baseline prose below the fallback materiality bar (${ev.materiality} < ${BASELINE_MIN_MATERIALITY})`;
  else status = 'published';
  const a = ed.article;
  const now = iso();
  await store.req('PATCH', `tennis_articles?article_id=eq.${articleId}`, { body: { status, headline: a.headline, deck: a.dek, body: { sections: a.sections }, prose_origin: ed.origin, gate_results: { gates_version: GATES_VERSION, gate: ed.gate, attempts: ed.attempts, usage: ed.usage, usd }, hold_reason: hold, updated_at: now, published_at: status === 'published' ? now : null, first_published_at: status === 'published' ? now : null }, prefer: 'return=minimal' });
  await settle(store, ev, { state: status === 'published' ? 'published' : 'held', state_reason: hold });
  await telemetry(store, [{ event_id: ev.event_id, article_id: articleId, stage: status === 'published' ? 'publish' : 'hold', status: status === 'published' ? 'ok' : 'skip', latency_ms: Date.now() - t0, since_detect_ms: sinceDetect(), detail: { hold, origin: ed.origin, detected_to_public_ms: status === 'published' ? sinceDetect() : null } }]);
  return { event_id: ev.event_id, article_id: articleId, slug, state: status, hold, origin: ed.origin };
}

export async function run(env, { dry = false } = {}) {
  const store = storeFromEnv(env);
  const out = { started_at: iso(), detect: null, enriched: [] };
  try { out.detect = await detect(env, store, { dry }); } catch (e) { out.detect = { error: redactSecrets(e.message) }; }
  if (dry) return out;
  let claimed = [];
  try { claimed = await claimFair(store, { limit: ENRICH_LIMIT }); } catch (e) {
    // the tour-fair claim is an ordering refinement; the atomic RPC remains the fallback (never zero progress)
    out.claim_fair_error = redactSecrets(e.message);
    try { claimed = (await store.req('POST', 'rpc/tennis_news_claim', { body: { p_limit: ENRICH_LIMIT, p_lease_s: LEASE_S } })) || []; } catch (e2) { out.claim_error = redactSecrets(e2.message); }
  }
  out.claimed = claimed.map((c) => ({ event_id: c.event_id, tour: c.tour || null, materiality: Number(c.materiality) }));
  for (const ev of claimed) {
    try { out.enriched.push(await enrichOne(env, store, ev)); } catch (e) {
      const msg = redactSecrets(e.message).slice(0, 300);
      out.enriched.push({ event_id: ev.event_id, error: msg });
      try { await settle(store, ev, { state: ev.attempts >= 3 ? 'failed' : 'detected', state_reason: msg }); } catch { /* lease expiry reclaims it */ }
      await telemetry(store, [{ event_id: ev.event_id, stage: 'error', status: 'fail', detail: { error: msg } }]);
    }
  }
  out.finished_at = iso();
  if (env.TENNIS_STATE) await env.TENNIS_STATE.put('news:last_run', JSON.stringify(out), { expirationTtl: 7 * 86400 });
  return out;
}

async function latency(store, hours = 168) {
  const rows = await store.select('tennis_news_pipeline_events', `select=since_detect_ms&stage=eq.publish&at=gte.${iso(new Date(Date.now() - hours * 3600e3))}&since_detect_ms=not.is.null&limit=5000`);
  const xs = rows.map((r) => Number(r.since_detect_ms)).sort((a, b) => a - b);
  const q = (p) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null);
  return { window_h: hours, published: xs.length, p50_ms: q(0.5), p95_ms: q(0.95), max_ms: xs.at(-1) ?? null };
}

const authed = (request, env) => env.NEWS_ADMIN_TOKEN && request.headers.get('authorization') === `Bearer ${env.NEWS_ADMIN_TOKEN}`;

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/health' || path === '/') {
      return json(await health({ worker: 'tennis-news', version: VERSION, env, deps: ['TENNIS_MODEL_SUPABASE_URL', 'TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY', 'TENNIS_STATE', 'NEWS_ADMIN_TOKEN', 'OPENAI_API_KEY'], extra: { mode: env.NEWS_PUBLISH_ENABLED === 'true' ? 'publish' : 'shadow', editorial: env.OPENAI_API_KEY ? `openai:${env.TENNIS_EDITORIAL_OPENAI_MODEL || 'gpt-5.6-sol'}` : 'OPENAI SECRET REQUIRED (baseline fallback / HOLD only)', versions: { detector: DETECTOR_VERSION, packet: PACKET_VERSION, compose: COMPOSE_VERSION, gates: GATES_VERSION, editorial: EDITORIAL_VERSION }, gated_kinds: GATED_KINDS, cron: '*/2 * * * *' } }), { headers: { 'cache-control': 'no-store' } });
    }
    if (!authed(request, env)) return json({ ok: false, error: 'not_found' }, { status: 404 });
    const store = storeFromEnv(env);
    if (path === '/v1/news/runs' && request.method === 'POST') return json({ ok: true, data: await run(env, { dry: url.searchParams.get('dry') === '1' }) });
    if (path === '/v1/news/latency') return json({ ok: true, data: await latency(store, Number(url.searchParams.get('hours')) || 168) });
    if (path === '/v1/news/requeue' && request.method === 'POST') {
      // holds are terminal; after a gate/source fix, re-run matching holds through the SAME gates
      const reason = url.searchParams.get('reason');
      if (!reason) return json({ ok: false, error: 'reason required' }, { status: 400 });
      const held = await store.select('tennis_news_events', `select=event_id,article_id&state=eq.held&state_reason=like.${encodeURIComponent(reason)}&limit=200`);
      for (const h of held) {
        if (h.article_id) {
          await store.req('PATCH', `tennis_news_events?event_id=eq.${encodeURIComponent(h.event_id)}`, { body: { article_id: null }, prefer: 'return=minimal' });
          await store.del('tennis_article_evidence', `article_id=eq.${h.article_id}`);
          await store.del('tennis_articles', `article_id=eq.${h.article_id}`);
        }
        await store.req('PATCH', `tennis_news_events?event_id=eq.${encodeURIComponent(h.event_id)}`, { body: { state: 'detected', state_reason: `requeued (${reason})`, attempts: 0 }, prefer: 'return=minimal' });
      }
      return json({ ok: true, data: { requeued: held.length } });
    }
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }
};
