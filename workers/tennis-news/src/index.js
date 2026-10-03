// tennis-news — evidence-grounded tennis newsroom (docs/NEWSROOM.md).
//
// DETECTION = deterministic (detect.js) · EVIDENCE = deterministic (packet.js, frozen before writing)
// CHARTS = deterministic (plan.js) · FACT CHECKING = deterministic (gates.js)
// PROSE = AI-assisted (editorial.js, GPT-5.6 Sol, same architecture as UFC) with the deterministic writer
// (compose.js) as the fact-safe fallback · FAILURE = fallback or HOLD, never a relaxed gate.
//
// Cron */2: detect new events from our own graph, then enrich up to ENRICH_LIMIT claimed events under a
// lease. NEWS_PUBLISH_ENABLED != "true" is SHADOW mode: everything is written as HOLD (reason "shadow").

import { atpTierForEdition } from '../../shared/atp-tiers.js';
import { enqueueMissingPhotos } from '../../shared/media-queue.js';
import { json } from '../../shared/envelope.js';
import { health } from '../../shared/health.js';
import { storeFromEnv, inList } from '../../shared/store/postgrest.js';
import { detectMatchEvents, detectRankingEvents, DETECTOR_VERSION, GATED_KINDS } from './detect.js';
import { classifyEvent, classifyStory, historyEntry, evidenceDimensions, CLASSIFIER_VERSION, CLASS_RANK } from './classify.js';
import { buildPacket, buildPreviewPacket, loadMatches, loadMatch, rankAt, PACKET_VERSION } from './packet.js';
import { storyAngle, ANGLE_VERSION } from './angle.js';
import { EDITORIAL_GATE_VERSION, proseWords } from './editorial-gate.js';
import { loadCorpus, overusedFrames, publicationGate, detectPreviews } from './overhaul.js';
import { compose, slugFor, COMPOSE_VERSION } from './compose.js';
import { buildPlan } from './plan.js';
import { correctPreMatchRatings } from './correct.js';
import { runGates, contextFailures, GATES_VERSION } from './gates.js';
import { editorialize, costUsd, redactSecrets, EDITORIAL_VERSION } from './editorial.js';
import { route, aiConfig, poolUsage, addPoolTokens, callTelemetry, poolKey, isNewCanonicalStory } from './ai-router.js';
import { runCanary } from './canary.js';
import { resolveHero } from '../../shared/editorial.js';
import { RANKING_LISTS, MILESTONE_LISTS, tourOf, tourOfList, pickFair } from './tour.js';
import editorial from '../../../data/media/editorial-media.json' with { type: 'json' };

export const VERSION = '4.0.0';

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
const BASELINE_MIN_MATERIALITY = 70; // full/deep: the deterministic fallback publishes only for clearly material events
// (a BRIEF is the deterministic writer's own format: its baseline prose may publish when it passes every gate)
const UPGRADE_WINDOW_H = 72;
const UPGRADES_PER_RUN = 3;
const iso = (d = new Date()) => d.toISOString();

async function telemetry(store, rows) {
  try { await store.insert('tennis_news_pipeline_events', rows); } catch { /* telemetry never breaks the pipeline */ }
}

// ---- detection ----------------------------------------------------------------------------------------
export function detectorInput(m, ranks, atpTier = null) {
  const side = (s) => {
    const x = m.sides[s] || { players: [] };
    const p0 = x.players[0];
    const r = p0 ? ranks.get(p0.id) : null;
    return { players: x.players.map((p) => ({ id: p.id, name: p.name })), rank: x.players.length === 1 ? r?.rank ?? null : null, list_date: r?.list_date ?? null, seed: x.seed, entry: x.entry };
  };
  return { id: m.id, event_type: m.event_type, round: m.round, status: m.status, winner_side: m.winner_side, retired_side: m.status === 'retired' ? (m.winner_side === 'A' ? 'B' : 'A') : null, best_of: m.best_of, sets: m.sets.map((s) => ({ A: s.A, B: s.B, tb: !!s.tb })), duration_s: m.duration_s, started_at: m.started_at, edition: { id: m.tournament.edition_id, level: m.tournament.level, name: m.tournament.name, surface: m.tournament.surface, start_date: m.tournament.start_date, source_family: m.tournament.source_family || null, competition_key: m.tournament.competition_key || null, atp_tier: atpTier?.tier || null, tier_registry: atpTier?.registry || null }, list_depth: ranks.provenance?.truncated ? ranks.provenance.depth : null, sides: { A: side('A'), B: side('B') } };
}

/**
 * Finished matches that changed in the last 6 h AND belong to the freshness window — selected by MATCH time, never by
 * updated_at churn alone. (2026-09-29 latency trace: the old query "updated in 6 h, limit 400" with no ORDER BY let a bulk
 * historical rewrite — 500k+ rows on 2026-09-28 — crowd fresh finals out for up to 200 min.) Timed rows need
 * started_at / scheduled_at inside the window; untimed rows (player-history results) need their edition to end inside it.
 * Both are keyset-paged on match_id (never truncated), then loaded in full by id.
 */
export async function detectionCandidates(store, now = new Date(), { page = 500, maxPages = 40 } = {}) {
  const changed = iso(new Date(now.getTime() - 6 * 3600e3));
  const since = iso(new Date(now.getTime() - FRESH_H * 3600e3));
  const base = `status=in.(completed,retired,walkover)&event_type=in.(WS,MS,WD,MD,XD)&updated_at=gte.${changed}`;
  const queries = [
    `select=match_id&${base}&or=(started_at.gte.${since},scheduled_at.gte.${since})`,
    `select=match_id,tennis_tournament_editions!inner(end_date)&${base}&started_at=is.null&scheduled_at=is.null&tennis_tournament_editions.end_date=gte.${since.slice(0, 10)}`
  ];
  const ids = new Set();
  for (const q of queries) {
    let after = null;
    for (let i = 0; i < maxPages; i += 1) {
      const got = await store.select('tennis_matches', `${q}${after ? `&match_id=gt.${after}` : ''}&order=match_id.asc&limit=${page}`);
      for (const r of got) ids.add(r.match_id);
      if (got.length < page) break;
      after = got.at(-1).match_id;
    }
  }
  const list = [...ids];
  const out = [];
  for (let i = 0; i < list.length; i += 150) out.push(...(await loadMatches(store, `match_id=${inList(list.slice(i, i + 150))}`)));
  return out;
}

export async function detect(env, store, { now = new Date(), dry = false } = {}) {
  const since = new Date(now.getTime() - FRESH_H * 3600e3);
  const sinceDate = iso(since).slice(0, 10);
  // freshness is judged on the MATCH date, not on when our backfill last touched the row
  // every event type of the one tennis product: men's and women's singles, both doubles, mixed
  const rows = await detectionCandidates(store, now);
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
    // ESPN ATP editions carry no level: the reviewed registry's tier (null when unknown) weights materiality
    const atpTier = ['MS', 'MD', 'XD'].includes(ms[0].event_type) && !ms[0].tournament.level ? await atpTierForEdition(ms[0].tournament.edition_id) : null;
    for (const m of ms) {
      const evs = await detectMatchEvents(detectorInput(m, ranks, atpTier));
      if (!evs.length) continue;
      evs.sort((a, b) => b.materiality - a.materiality);
      const [top, ...rest] = evs;
      top.facts = { ...top.facts, ...classifierFacts(m, ranks, atpTier), secondary_kinds: rest.map((e) => e.kind), event_type: m.event_type, tour: tourOf(m.event_type), rank_list: ranks.provenance ? listKey : null, rank_source_family: ranks.provenance?.source_family || null, rank_classification: ranks.provenance?.classification || null };
      candidates.push(withClass(top, iso(now)));
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
    for (const e of evs) candidates.push(withClass({ ...e, facts: { ...e.facts, tour: tourOfList(listKey), list_source_family: snaps[0].source_family || null } }, iso(now)));
    if (!dry && env.TENNIS_STATE) await env.TENNIS_STATE.put(kvKey, iso(), { expirationTtl: 30 * 86400 });
  }
  // players in newsroom events without an approved photo -> the media discovery queue (KV media:queue; processed on the
  // workstation by scripts/media/queue.mjs with the existing identity/licence review). Never breaks detection.
  if (!dry && candidates.length) await enqueueMissingPhotos(env.TENNIS_STATE, store, candidates.flatMap((c) => c.entity_ids || []), 'news').catch(() => {});
  if (dry || !candidates.length) return { scanned: rows.length, fresh: fresh.length, candidates: dry ? candidates.map((c) => ({ kind: c.kind, materiality: c.materiality, state: c.state, editorial_class: c.editorial_class || null, class_reasons: c.class_reasons || [], match_id: c.match_id || null, facts: c.facts })) : 0 };
  const known = new Set((await store.select('tennis_news_events', `select=event_id&event_id=${inList(candidates.map((c) => c.event_id))}`)).map((r) => r.event_id));
  const insert = candidates.filter((c) => !known.has(c.event_id)).map((c) => ({ event_id: c.event_id, kind: c.kind, occurred_at: c.occurred_at || iso(now), entities: c.entity_ids, materiality: c.materiality, evidence: { facts: c.facts, detector: c.detector }, state: c.state, state_reason: c.state_reason || null, editorial_class: c.editorial_class || null, class_reasons: c.class_reasons || [], class_history: c.class_history || [], classifier_version: c.editorial_class ? CLASSIFIER_VERSION : null, signature: c.match_id ? `match:${c.match_id}` : `${c.kind}:${c.entity_ids[0]}:${c.facts.list_date}`, match_id: c.match_id || null, detected_at: iso(now) }));
  // ONE canonical event per real-world event (signature = match / ranking move): a later candidate for a match that
  // already has a canonical event (e.g. an 'upset' re-detected as 'seed_upset' once seeds or ranks arrived — the event
  // id includes the kind) is recorded as a duplicate; when it raises the class of a canonical event that has no story
  // yet, the canonical event is upgraded in place (its facts gain the new kind)
  const sigs = [...new Set(insert.filter((r) => r.state !== 'duplicate').map((r) => r.signature))];
  const canon = new Map();
  for (let i = 0; i < sigs.length; i += 50) for (const r of await store.select('tennis_news_events', `select=event_id,signature,state,editorial_class,article_id,evidence,class_history&signature=${inList(sigs.slice(i, i + 50))}&state=neq.duplicate&order=detected_at.asc`)) if (!canon.has(r.signature)) canon.set(r.signature, r);
  for (const row of insert) {
    const c = canon.get(row.signature);
    if (!c || c.event_id === row.event_id || row.state === 'duplicate') continue;
    const higher = row.editorial_class && CLASS_RANK[row.editorial_class] > CLASS_RANK[c.editorial_class || 'wire'];
    row.state = 'duplicate';
    row.state_reason = `merged into ${c.event_id} (one story per match)`;
    if (higher && !c.article_id && ['wire', 'below_threshold'].includes(c.state)) {
      const facts = { ...(c.evidence?.facts || {}), ...Object.fromEntries(Object.entries(row.evidence.facts).filter(([, v]) => v != null)), secondary_kinds: [...new Set([...(c.evidence?.facts?.secondary_kinds || []), row.kind, ...(row.evidence.facts.secondary_kinds || [])])] };
      await store.req('PATCH', `tennis_news_events?event_id=eq.${encodeURIComponent(c.event_id)}&state=eq.${c.state}`, { body: { evidence: { ...(c.evidence || {}), facts }, editorial_class: row.editorial_class, class_reasons: row.class_reasons, class_history: [...(c.class_history || []), historyEntry('merge', row.editorial_class, row.class_reasons, iso(now))], classifier_version: CLASSIFIER_VERSION, state: row.state === 'duplicate' && CLASS_RANK[row.editorial_class] >= CLASS_RANK.brief ? 'detected' : c.state, state_reason: `upgraded by ${row.kind}`, state_changed_at: iso(now) }, prefer: 'return=minimal' });
    }
  }
  if (insert.length) {
    await store.upsert('tennis_news_events', insert, { onConflict: 'event_id', ignore: true });
    await telemetry(store, insert.map((e) => ({ event_id: e.event_id, stage: 'detect', status: e.state === 'detected' ? 'ok' : 'skip', detail: { kind: e.kind, materiality: e.materiality, state: e.state } })));
  }
  return { scanned: rows.length, fresh: fresh.length, candidates: candidates.length, new: insert.length, queued: insert.filter((e) => e.state === 'detected').length, wire: insert.filter((e) => e.state === 'wire').length };
}

/** Facts the classifier needs, recorded at detection (tier, round, point-in-time ranks and seeds). */
export function classifierFacts(m, ranks, atpTier = null) {
  const W = m.winner_side;
  const L = W === 'A' ? 'B' : W === 'B' ? 'A' : null;
  const rk = (s) => { const x = m.sides[s]; return x?.players?.length === 1 ? ranks.get?.(x.players[0].id)?.rank ?? null : null; };
  return {
    level: m.tournament.level || null, competition_key: m.tournament.competition_key || null, tournament_slug: m.tournament.slug || null, source_family: m.tournament.source_family || null,
    edition_tier: atpTier?.tier || null, round: m.round, winner_rank: W ? rk(W) : null, loser_rank: L ? rk(L) : null,
    winner_seed: W ? m.sides[W]?.seed ?? null : null, loser_seed: L ? m.sides[L]?.seed ?? null : null
  };
}

/** Detection-time class: state 'detected' (queued for an article) when the preliminary class is brief+, else 'wire'. */
export function withClass(c, at) {
  if (c.state === 'duplicate') return c;
  const pre = classifyEvent(c);
  return { ...c, state: pre.publish_article ? 'detected' : 'wire', editorial_class: pre.surface, class_reasons: pre.reasons, class_history: [historyEntry('detect', pre.surface, pre.reasons, at)] };
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

const packetHash = async (packet) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(packet)));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * In-place upgrade of a published story (lifecycle): SAME article_id, slug, published_at and first_published_at; new
 * prose/plan/class from the NEW frozen packet; revised_at set; a revision appended that keeps the prior packet (and its
 * hash), frozen_at and headline — history is never lost.
 */
export async function upgradeArticle(store, existing, { article, ed, plan, packet, storyClass, dimensions = [], now = iso(), reason = null, keepEvidence = false }) {
  const prior = (await store.select('tennis_article_evidence', `select=packet,frozen_at&article_id=eq.${existing.article_id}`))[0] || null;
  const revision = { at: now, from_class: existing.story_class || null, to_class: storyClass, reason: reason || `new evidence: ${dimensions.filter((d) => d !== 'result').join(', ')}`, prior_packet_hash: prior ? await packetHash(prior.packet) : null, prior_frozen_at: prior?.frozen_at || null, prior_headline: existing.headline, ...(existing.body ? { prior_deck: existing.deck ?? null, prior_body: existing.body, prior_editorial_version: existing.editorial_version || null, prior_prose_origin: existing.prose_origin || null } : {}), packet_hash: await packetHash(packet), prior_packet: prior?.packet || null };
  await store.req('PATCH', `tennis_articles?article_id=eq.${existing.article_id}`, { body: { headline: article.headline, deck: article.dek, body: { sections: article.sections }, content_plan: plan, key_stat: article.key_stat, story_class: storyClass, prose_origin: ed.origin, gate_results: { gates_version: GATES_VERSION, gate: ed.gate, attempts: ed.attempts, usage: ed.usage, nominal_standard_cost_usd: costUsd(ed.usage), routing: ed.routing || null }, generator_version: COMPOSE_VERSION, editorial_version: EDITORIAL_VERSION, updated_at: now, revised_at: now, revisions: [...(existing.revisions || []), revision] }, prefer: 'return=minimal' });
  // a prose repair keeps the SAME frozen packet and its frozen_at (no new evidence was frozen)
  if (!keepEvidence) await store.req('PATCH', `tennis_article_evidence?article_id=eq.${existing.article_id}`, { body: { packet, frozen_at: now }, prefer: 'return=minimal' });
  return revision;
}

/**
 * Routed model prose for one story (V4): route -> editorialize (attempts 1) -> per-call telemetry (stage 'cost',
 * kind 'model_call') + Tennis's daily share of the shared pool (KV). Returns the editorialize result with .routing.
 */
export async function routedProse(env, store, { ev, articleId = null, storyClass, packet, baseline, gate, dims = [], trigger = 'new', attempts = 1, ctx = {} }) {
  const cfg = aiConfig(env);
  const kv = env.TENNIS_STATE || null;
  const usage = await poolUsage(kv);
  const routing = route({ storyClass, publishArticle: true, event: ev, packet, dims, trigger, env, usage, hasKey: !!env.OPENAI_API_KEY });
  const onCall = async (call) => {
    await telemetry(store, [callTelemetry({ eventId: ev.event_id, articleId, storyClass, routing, trigger, call, cfg })]);
    await addPoolTokens(kv, routing.pool, (Number(call.usage?.input_tokens) || 0) + (Number(call.usage?.output_tokens) || 0)).catch(() => null);
  };
  const ed = await editorialize({ packet, baseline, gate, apiKey: env.OPENAI_API_KEY, routing, attempts, onCall, ctx });
  return { ...ed, routing: { lane: routing.lane, model: routing.model, pool: routing.pool, reason: routing.reason, max_output_tokens: routing.max_output_tokens, reasoning_effort: routing.reasoning_effort, soft_cap: routing.soft_cap || null, flagship_eligible: !!routing.flagship_eligible, router_version: routing.router_version, pool_usage_before: usage } };
}

/**
 * PRODUCTION-PATH canary (V4 release gate, owner 2026-09-29): ONE model call through the deployed path — route()
 * (trigger 'canary', allow-listed) -> Responses API -> deterministic gates -> model_call telemetry row -> Tennis premium
 * KV pool counter — on a stored article's frozen packet. Unlike /v1/news/canary (offline A/B, separate canary counter)
 * this proves the live accounting. It NEVER writes articles, evidence or events: routedProse only records telemetry and
 * the pool counter. ?dry=1 returns the routing decision with no model call. Refuses any lane but STANDARD_EDITORIAL.
 */
export async function routedCanary(env, store, { eventId, dry = false } = {}) {
  if (!eventId) return { error: 'event_id required' };
  const enc = encodeURIComponent(eventId);
  const ev = (await store.select('tennis_news_events', `select=*&event_id=eq.${enc}`))[0];
  if (!ev) return { error: 'no such event' };
  const a = (await store.select('tennis_articles', `select=article_id,slug,story_class,tennis_article_evidence(packet,frozen_at)&event_id=eq.${enc}`))[0];
  if (!a) return { error: 'no stored article (frozen packet) for this event' };
  const evd = Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0] : a.tennis_article_evidence;
  const packet = evd?.packet;
  if (!packet) return { error: 'no frozen packet stored for this article' };
  const storyClass = a.story_class || 'full';
  const kv = env.TENNIS_STATE || null;
  const before = await poolUsage(kv);
  const routing = route({ storyClass, publishArticle: true, event: ev, packet, dims: [], trigger: 'canary', env, usage: before, hasKey: !!env.OPENAI_API_KEY });
  const head = { event_id: eventId, article_id: a.article_id, slug: a.slug, story_class: storyClass, frozen_at: evd.frozen_at || null, trigger: 'canary', routing: { lane: routing.lane, model: routing.model, pool: routing.pool, reason: routing.reason, router_version: routing.router_version } };
  if (routing.lane !== 'STANDARD_EDITORIAL') return { ...head, refused: `lane ${routing.lane} (the release canary only proves STANDARD_EDITORIAL)`, model_calls: 0 };
  if (dry) return { ...head, dry: true, model_calls: 0, pool_usage: before };
  const baseline = compose(packet, { storyClass });
  const plan = buildPlan(packet, baseline);
  const gate = (x) => runGates(x, packet, { plan });
  const ed = await routedProse(env, store, { ev, articleId: a.article_id, storyClass, packet, baseline, gate, dims: [], trigger: 'canary', attempts: 1 });
  const after = await poolUsage(kv);
  return { ...head, model_calls: ed.attempts.filter((x) => !x.skipped).length, origin: ed.origin, attempts: ed.attempts, usage: ed.usage, pool_before: before, pool_after: after, draft: { headline: ed.article?.headline || null, published: false } };
}

export async function enrichOne(env, store, ev) {
  const t0 = Date.now();
  const sinceDetect = () => Date.now() - Date.parse(ev.detected_at);
  const facts = ev.evidence?.facts || {};
  const candidate = { kind: ev.kind, event_id: ev.event_id, materiality: Number(ev.materiality), facts, occurred_at: ev.occurred_at, detector: ev.evidence?.detector, match_id: ev.match_id, entity_ids: ev.entities };
  const isPreview = ev.kind === 'preview';
  const packet = isPreview ? await buildPreviewPacket(store, candidate) : await buildPacket(store, candidate);
  // a preview whose match is no longer scheduled (started, finished, cancelled) has no story to tell: wire, no article
  if (!packet && isPreview && !ev.article_id) { await settle(store, ev, { state: 'wire', state_reason: 'preview window passed (match no longer scheduled)' }); return { event_id: ev.event_id, state: 'wire', reason: 'preview_window_passed' }; }
  if (!packet) { await settle(store, ev, { state: ev.article_id ? 'published' : 'held', state_reason: 'packet_unavailable' }); return { event_id: ev.event_id, state: 'held', reason: 'packet_unavailable' }; }

  // the FINAL editorial class: the event's significance capped by what the frozen packet can support
  const story = classifyStory(candidate, packet);
  const history = [...(Array.isArray(ev.class_history) ? ev.class_history : []), historyEntry('enrich', story.surface, story.reasons)];
  const reasons = story.capped_by_evidence ? [...story.reasons, 'capped_by_evidence'] : story.reasons;
  const classPatch = { editorial_class: story.surface, class_reasons: reasons, class_history: history, classifier_version: CLASSIFIER_VERSION };

  // dedupe on the real-world event: an existing article for the same signature (another event) wins
  const dup = await store.select('tennis_news_events', `select=event_id,article_id&signature=eq.${encodeURIComponent(ev.signature)}&article_id=not.is.null&event_id=neq.${encodeURIComponent(ev.event_id)}&limit=1`);
  if (dup.length) {
    await settle(store, ev, { state: 'duplicate', state_reason: `same event as ${dup[0].event_id}` });
    await telemetry(store, [{ event_id: ev.event_id, stage: 'duplicate', status: 'skip', detail: { canonical: dup[0].event_id } }]);
    return { event_id: ev.event_id, state: 'duplicate' };
  }

  // an existing story (lifecycle): upgrade in place only when the class rises; otherwise it stays as published
  let existing = null;
  if (ev.article_id) {
    existing = (await store.select('tennis_articles', `select=article_id,slug,status,story_class,first_published_at,published_at,revisions,headline,deck,body,editorial_version,prose_origin&article_id=eq.${ev.article_id}`))[0] || null;
    if (existing && !(CLASS_RANK[story.surface] > CLASS_RANK[existing.story_class || 'brief'])) {
      await settle(store, ev, { state: existing.status === 'published' ? 'published' : 'held', state_reason: `re-evaluated: ${story.surface} (no upgrade over ${existing.story_class || 'brief'})`, ...classPatch });
      return { event_id: ev.event_id, state: 'unchanged', story_class: existing.story_class, evaluated: story.surface };
    }
  }

  if (!story.publish_article) {
    // a wire item: the fact card lives on the live wire; no article, no URL
    await settle(store, ev, { state: 'wire', state_reason: `wire: ${story.reasons.at(-1)}`, ...classPatch });
    await telemetry(store, [{ event_id: ev.event_id, stage: 'hold', status: 'skip', latency_ms: Date.now() - t0, since_detect_ms: sinceDetect(), detail: { wire: true, class: story.surface, dimensions: story.evidence_dimensions } }]);
    return { event_id: ev.event_id, state: 'wire', class: story.surface, dimensions: story.evidence_dimensions };
  }

  const storyClass = story.surface;
  const baseline = compose(packet, { storyClass });
  const plan = buildPlan(packet, baseline);
  // presentation only: the hero chosen at creation from approved imagery (frozen packet photos + editorial
  // catalog), recorded with its fallback reason; tennis-api re-resolves at read time so an approved photo found
  // later upgrades the story without touching its facts
  plan.media = heroAtCreation(packet, plan);
  plan.evidence_dimensions = story.evidence_dimensions;
  // V5 (editorial overhaul): the STORY ANGLE is decided from the evidence before any prose; publication needs the factual
  // gates AND the editorial acceptance gate (thin / templated / chart-led / repeated-phrasing stories HOLD)
  const angle = storyAngle(packet, plan, storyClass);
  const corpus = await loadCorpus(store, { exclude: ev.article_id || null }).catch(() => []);
  const gate = publicationGate(packet, { plan, storyClass, corpus, angle });
  const ctx = { plan, angle, avoid: overusedFrames(corpus) };
  plan.angle = { version: ANGLE_VERSION, id: angle.angle?.id || null, thesis: angle.angle?.thesis || null, tier: angle.tier, target: angle.target, type: angle.type };

  if (existing) {
    // UPGRADE the same story: same article id, slug and first_published_at; new frozen evidence; revision recorded
    // an existing canonical story is never NEW: upgrades use the deterministic baseline prose (route() refuses the
    // 'upgrade' trigger), still through every gate; lifecycle rules unchanged
    const ed = await routedProse(env, store, { ev, articleId: existing.article_id, storyClass, packet, baseline, gate, dims: story.evidence_dimensions, trigger: isNewCanonicalStory(existing) ? 'new' : 'upgrade', ctx });
    plan.routing = ed.routing;
    if (ed.article?.layout) plan.layout = ed.article.layout;
    const allowBaseline = storyClass === 'brief' || Number(ev.materiality) >= BASELINE_MIN_MATERIALITY;
    if (!ed.origin || (ed.origin === 'baseline' && !allowBaseline) || env.NEWS_PUBLISH_ENABLED !== 'true') {
      const why = !ed.origin ? `gates: ${ed.gate.failures.map((f) => f.gate).join(', ')}` : env.NEWS_PUBLISH_ENABLED !== 'true' ? 'shadow' : 'baseline prose below the fallback bar';
      await settle(store, ev, { state: existing.status === 'published' ? 'published' : 'held', state_reason: `upgrade to ${storyClass} held (${why}); story unchanged`, ...classPatch });
      return { event_id: ev.event_id, state: 'upgrade_held', reason: why };
    }
    await upgradeArticle(store, existing, { article: ed.article, ed, plan, packet, storyClass, dimensions: story.evidence_dimensions });
    await settle(store, ev, { state: 'published', state_reason: `upgraded ${existing.story_class || 'brief'} -> ${storyClass}`, ...classPatch });
    await telemetry(store, [{ event_id: ev.event_id, article_id: existing.article_id, stage: 'publish', status: 'ok', latency_ms: Date.now() - t0, detail: { upgrade: true, from: existing.story_class, to: storyClass } }]);
    return { event_id: ev.event_id, article_id: existing.article_id, slug: existing.slug, state: 'upgraded', from: existing.story_class, to: storyClass };
  }

  const articleId = crypto.randomUUID();
  const slug = slugFor(baseline, packet);
  // FREEZE the evidence before any prose is generated
  await store.insert('tennis_articles', [{ article_id: articleId, event_id: ev.event_id, slug, status: 'held', headline: baseline.headline, deck: baseline.dek, body: { sections: baseline.sections }, gate_results: { stage: 'frozen' }, editorial_version: EDITORIAL_VERSION, generator_version: COMPOSE_VERSION, story_type: baseline.story_type, story_class: storyClass, desk: baseline.desk, primary_player_id: baseline.primary_player_id, player_ids: baseline.player_ids, match_id: baseline.match_id, tournament: baseline.tournament, key_stat: baseline.key_stat, content_plan: plan, hold_reason: 'generating', detected_at: ev.detected_at }]);
  await store.insert('tennis_article_evidence', [{ article_id: articleId, packet }]);
  await store.req('PATCH', `tennis_news_events?event_id=eq.${encodeURIComponent(ev.event_id)}`, { body: { article_id: articleId }, prefer: 'return=minimal' });
  await telemetry(store, [{ event_id: ev.event_id, article_id: articleId, stage: 'packet', status: 'ok', latency_ms: Date.now() - t0, since_detect_ms: sinceDetect(), detail: { version: PACKET_VERSION, families: Object.keys(packet), class: storyClass, dimensions: story.evidence_dimensions } }]);

  const ed = await routedProse(env, store, { ev, articleId, storyClass, packet, baseline, gate, dims: story.evidence_dimensions, trigger: 'new', ctx });
  plan.routing = ed.routing;
  if (ed.article?.layout) plan.layout = ed.article.layout;
  // nominal standard-rate cost (never an actual bill: the org may receive complimentary tokens)
  const usd = costUsd(ed.usage);
  await telemetry(store, [{ event_id: ev.event_id, article_id: articleId, stage: 'editorial', status: ed.origin ? 'ok' : 'fail', latency_ms: Date.now() - t0, detail: { origin: ed.origin, attempts: ed.attempts, routing_lane: ed.routing.lane, routing_reason: ed.routing.reason, model: ed.routing.model, pool: ed.routing.pool } }]);

  let status = 'held';
  let hold = null;
  if (!ed.origin) hold = `gates: ${ed.gate.failures.map((f) => f.gate).join(', ')}`;
  else if (env.NEWS_PUBLISH_ENABLED !== 'true') hold = `shadow (${ed.origin} prose passed gates)`;
  else if (ed.origin === 'baseline' && storyClass !== 'brief' && Number(ev.materiality) < BASELINE_MIN_MATERIALITY) hold = `baseline prose below the fallback bar for a ${storyClass} story (${ev.materiality} < ${BASELINE_MIN_MATERIALITY})`;
  else status = 'published';
  const a = ed.article;
  const now = iso();
  await store.req('PATCH', `tennis_articles?article_id=eq.${articleId}`, { body: { status, headline: a.headline, deck: a.dek, body: { sections: a.sections }, prose_origin: ed.origin, content_plan: plan, gate_results: { gates_version: GATES_VERSION, editorial_gate_version: EDITORIAL_GATE_VERSION, gate: ed.gate, attempts: ed.attempts, usage: ed.usage, nominal_standard_cost_usd: usd, routing: ed.routing }, hold_reason: hold, updated_at: now, published_at: status === 'published' ? now : null, first_published_at: status === 'published' ? now : null }, prefer: 'return=minimal' });
  await settle(store, ev, { state: status === 'published' ? 'published' : 'held', state_reason: hold, ...classPatch });
  await telemetry(store, [{ event_id: ev.event_id, article_id: articleId, stage: status === 'published' ? 'publish' : 'hold', status: status === 'published' ? 'ok' : 'skip', latency_ms: Date.now() - t0, since_detect_ms: sinceDetect(), detail: { hold, origin: ed.origin, class: storyClass, detected_to_public_ms: status === 'published' ? sinceDetect() : null } }]);
  return { event_id: ev.event_id, article_id: articleId, slug, state: status, hold, origin: ed.origin, class: storyClass };
}

/**
 * Lifecycle trigger (cheap, bounded): an event whose class was CAPPED by thin evidence (class_reasons contains
 * "capped_by_evidence") within the last UPGRADE_WINDOW_H is re-queued once match statistics for its match were captured
 * AFTER its last state change. tennis_matches.updated_at is not used (every re-read rewrites it). The re-run either
 * upgrades the same story in place (article id/slug/first_published_at kept) or leaves it unchanged; a re-queued wire
 * item stays wire unless the new evidence lifts the cap. At most UPGRADES_PER_RUN per run.
 */
export async function queueUpgrades(store, { now = new Date() } = {}) {
  const since = new Date(now.getTime() - UPGRADE_WINDOW_H * 3600e3).toISOString();
  const rows = await store.select('tennis_news_events', `select=event_id,match_id,state,state_changed_at&state=in.(wire,published)&match_id=not.is.null&detected_at=gte.${since}&class_reasons=cs.${encodeURIComponent('["capped_by_evidence"]')}&order=detected_at.desc&limit=40`);
  if (!rows.length) return [];
  const stats = await store.select('tennis_match_stats', `select=match_id,captured_at&match_id=${inList([...new Set(rows.map((r) => r.match_id))])}`);
  const latest = new Map();
  for (const x of stats) if (!latest.has(x.match_id) || x.captured_at > latest.get(x.match_id)) latest.set(x.match_id, x.captured_at);
  const due = rows.filter((r) => latest.get(r.match_id) && latest.get(r.match_id) > r.state_changed_at).slice(0, UPGRADES_PER_RUN);
  for (const r of due) await store.req('PATCH', `tennis_news_events?event_id=eq.${encodeURIComponent(r.event_id)}&state=eq.${r.state}`, { body: { state: 'detected', state_reason: 'requeued: new match statistics (lifecycle re-evaluation)', attempts: 0, state_changed_at: now.toISOString() }, prefer: 'return=minimal' });
  return due.map((r) => r.event_id);
}

/**
 * Re-classify recent events with the V3 classifier (admin; dry by default). Facts recorded before V3 lack tier / round /
 * ranks: they are completed from the stored match (point-in-time list) — never guessed. Preliminary class from facts;
 * for brief+ candidates the frozen packet decides the final class. write=1 moves below_threshold/wire rows to
 * 'detected' (queued for an article) or 'wire'; published / held rows keep their state and story (only the class is
 * recorded, and published articles get story_class). Existing articles are never recreated.
 */
export async function reclassify(store, { days = 7, write = false, offset = 0, limit = 60, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 86400e3).toISOString();
  const rows = await store.select('tennis_news_events', `select=event_id,kind,materiality,state,state_reason,match_id,entities,evidence,occurred_at,detected_at,signature,article_id,class_history&detected_at=gte.${since}&state=in.(below_threshold,wire,detected,published,held)&order=detected_at.asc,event_id.asc&limit=${limit}&offset=${offset}`);
  const out = [];
  const bySig = new Map();
  for (const ev of rows) {
    let facts = { ...(ev.evidence?.facts || {}) };
    if (ev.match_id && (facts.round === undefined || facts.level === undefined)) {
      const m = await loadMatch(store, ev.match_id);
      if (m) {
        const listKey = RANKING_LISTS[m.event_type] || null;
        const pids = ['A', 'B'].flatMap((s) => m.sides[s]?.players.map((p) => p.id) || []);
        const ranks = listKey ? await rankAt(store, pids, m.tournament.start_date, listKey) : new Map();
        const atpTier = ['MS', 'MD', 'XD'].includes(m.event_type) && !m.tournament.level ? await atpTierForEdition(m.tournament.edition_id) : null;
        const cf = classifierFacts(m, ranks, atpTier);
        facts = { ...cf, ...facts, event_type: facts.event_type || m.event_type, tour: facts.tour || tourOf(m.event_type) };
        for (const k of Object.keys(cf)) if (facts[k] == null && cf[k] != null) facts[k] = cf[k];
      }
    }
    const candidate = { kind: ev.kind, event_id: ev.event_id, materiality: Number(ev.materiality), facts, occurred_at: ev.occurred_at, match_id: ev.match_id, entity_ids: ev.entities };
    const pre = classifyEvent(candidate);
    let story = null;
    if (pre.publish_article) { const packet = await buildPacket(store, candidate); story = packet ? classifyStory(candidate, packet) : null; }
    const final = story ? story.surface : pre.surface;
    const row = { _facts: facts, _story: story, event_id: ev.event_id, kind: ev.kind, tour: facts.tour || (facts.list ? tourOfList(facts.list) : null), materiality: Number(ev.materiality), old_state: ev.state, preliminary: pre.surface, class: final, tier: pre.tier, reasons: (story || pre).reasons, evidence_dimensions: story?.evidence_dimensions || null, would_create_article: final !== 'wire' && !ev.article_id && ['below_threshold', 'wire', 'detected'].includes(ev.state), existing_article: !!ev.article_id, match_id: ev.match_id };
    // one canonical event per signature: a later event of the same match/ranking move is a duplicate unless it has the
    // story (article) or a higher class than the canonical one (then the canonical one is the duplicate)
    const prev = bySig.get(ev.signature);
    if (prev && !prev.row.existing_article && (row.existing_article || CLASS_RANK[row.class] > CLASS_RANK[prev.row.class])) { prev.row.class = 'duplicate'; prev.row.duplicate_of = ev.event_id; prev.row.would_create_article = false; bySig.set(ev.signature, { ev, row }); }
    else if (prev) { row.class = 'duplicate'; row.duplicate_of = prev.ev.event_id; row.would_create_article = false; }
    else bySig.set(ev.signature, { ev, row });
    out.push(row);
  }
  if (write) for (const row of out) {
    const ev = rows.find((r) => r.event_id === row.event_id);
    const final = row.class;
    const facts = row._facts;
    if (final === 'duplicate') {
      if (!ev.article_id && ['below_threshold', 'wire', 'detected'].includes(ev.state)) await store.req('PATCH', `tennis_news_events?event_id=eq.${encodeURIComponent(ev.event_id)}`, { body: { state: 'duplicate', state_reason: `merged into ${row.duplicate_of} (one story per match; V3 reclassification)`, state_changed_at: now.toISOString() }, prefer: 'return=minimal' });
      continue;
    }
    const hist = [...(Array.isArray(ev.class_history) ? ev.class_history : []), historyEntry('reclassify_v3', final, row.reasons, now.toISOString())];
    const reasons = row._story?.capped_by_evidence ? [...row.reasons, 'capped_by_evidence'] : row.reasons;
    const patch = { editorial_class: final, class_reasons: reasons, class_history: hist, classifier_version: CLASSIFIER_VERSION, evidence: { ...(ev.evidence || {}), facts } };
    if (['below_threshold', 'wire', 'detected'].includes(ev.state) && !ev.article_id) Object.assign(patch, final === 'wire' ? { state: 'wire', state_reason: 'V3 reclassification: wire' } : { state: 'detected', state_reason: `V3 reclassification: ${final}`, attempts: 0 }, { state_changed_at: now.toISOString() });
    await store.req('PATCH', `tennis_news_events?event_id=eq.${encodeURIComponent(ev.event_id)}`, { body: patch, prefer: 'return=minimal' });
    if (ev.article_id && final !== 'wire') await store.req('PATCH', `tennis_articles?article_id=eq.${ev.article_id}&story_class=is.null`, { body: { story_class: final }, prefer: 'return=minimal' });
    if (ev.article_id && final === 'wire') await store.req('PATCH', `tennis_articles?article_id=eq.${ev.article_id}&story_class=is.null`, { body: { story_class: 'brief' }, prefer: 'return=minimal' });
  }
  return { days, write, offset, limit, rows: out.length, next_offset: rows.length === limit ? offset + limit : null, events: out.map(({ _facts, _story, ...r }) => r) };
}

export async function run(env, { dry = false } = {}) {
  const store = storeFromEnv(env);
  const out = { started_at: iso(), detect: null, enriched: [] };
  try { out.detect = await detect(env, store, { dry }); } catch (e) { out.detect = { error: redactSecrets(e.message) }; }
  // previews of the next day's late-round matches (bounded: 3 per run, 8 per UTC day; detection never calls a model)
  if (env.NEWS_PREVIEWS_ENABLED === 'true') { try { out.previews = await detectPreviews(env, store, { dry }); } catch (e) { out.previews = { error: redactSecrets(e.message) }; } }
  if (dry) return out;
  try { out.upgrades_queued = await queueUpgrades(store); } catch (e) { out.upgrade_error = redactSecrets(e.message); }
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

/**
 * CONTEXT REPAIR (tennis-news V4.1, owner 2026-10-02): published MATCH stories whose STORED prose fails the context
 * contract (gate thin_context) although their frozen packet proves >= minDims meaningful evidence dimensions are
 * recomposed from their OWN frozen packet (no rebuild, no new facts) with the current classifier and composer, and run
 * through every gate. dry (default): report only, nothing written. write=1: in-place revision via upgradeArticle (same
 * article_id, slug, published_at, first_published_at; revised_at + a 'context repair' revision; the frozen packet and
 * its frozen_at are kept). A class never goes down. model=1: one routed model edit (trigger admin_reedit) over the new
 * baseline, through the same gates; default is the deterministic baseline. slug=: one story (the canary).
 */
export async function repairContext(env, store, { write = false, limit = 60, minDims = 4, slug = null, model = false, attempts = 1 } = {}) {
  const q = `select=article_id,slug,event_id,status,story_class,prose_origin,headline,deck,body,first_published_at,published_at,revised_at,revisions,primary_player_id,player_ids,tennis_article_evidence(packet,frozen_at)&status=eq.published${slug ? `&slug=eq.${encodeURIComponent(slug)}` : ''}&order=published_at.desc&limit=${Math.min(200, limit)}`;
  const rows = await store.select('tennis_articles', q);
  const out = { write, model, min_dims: minDims, scanned: rows.length, match_stories: 0, eligible: 0, repaired: 0, held: 0, items: [] };
  for (const a of rows) {
    const evd = Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0] : a.tennis_article_evidence;
    const packet = evd?.packet;
    if (!packet?.match) continue;
    out.match_stories += 1;
    const old = { headline: a.headline, dek: a.deck, sections: a.body?.sections || [], primary_player_id: a.primary_player_id, player_ids: a.player_ids || [] };
    const thin = contextFailures(old, packet);
    const dims = evidenceDimensions(packet).filter((d) => d !== 'result');
    if (!slug && (!thin.length || dims.length < minDims)) continue;
    out.eligible += 1;
    const ev = (await store.select('tennis_news_events', `select=event_id,kind,evidence,editorial_class&event_id=eq.${encodeURIComponent(a.event_id)}`))[0] || null;
    const story = ev ? classifyStory({ kind: ev.kind, facts: ev.evidence?.facts || {} }, packet) : null;
    const from = a.story_class || 'brief';
    const to = story && CLASS_RANK[story.surface] > CLASS_RANK[from] ? story.surface : from;
    const baseline = compose(packet, { storyClass: to });
    const plan = buildPlan(packet, baseline);
    const gate = (x) => runGates(x, packet, { plan });
    let ed;
    // model-written stories are re-edited by the model (one routed admin_reedit call, same gates, baseline fallback):
    // replacing richer model prose with the deterministic baseline would be a downgrade
    const useModel = model || a.prose_origin === 'model';
    if (useModel && write && ev) ed = await routedProse(env, store, { ev, articleId: a.article_id, storyClass: to, packet, baseline, gate, dims: evidenceDimensions(packet), trigger: 'admin_reedit', attempts: Math.min(2, Math.max(1, attempts)) });
    else { const g = gate(baseline); ed = { article: { ...baseline, prose_origin: 'baseline' }, origin: g.pass ? 'baseline' : null, gate: g, attempts: [], usage: {} }; }
    const item = { slug: a.slug, published_at: a.published_at, from_class: from, to_class: to, dims: dims.length, old_thin_context: thin.length > 0, new_gate_pass: !!ed.origin, failures: (ed.gate?.failures || []).slice(0, 6), prose_origin: ed.origin, model_attempts: (ed.attempts || []).map((x) => ({ pass: x.pass ?? null, failures: (x.failures || []).map((f) => f.gate), error: x.error || null })), stored_prose_origin: a.prose_origin || null, would_model_reedit: useModel && !write, old_failures: thin.map((f) => f.gate), after: ed.origin ? { headline: ed.article.headline, sections: ed.article.sections.filter((s) => s.id !== 'method').map((s) => ({ id: s.id, paragraphs: s.paragraphs })) } : null };
    if (write && ed.origin) {
      await upgradeArticle(store, { ...a, story_class: from }, { article: ed.article, ed, plan, packet, storyClass: to, dimensions: evidenceDimensions(packet), reason: `context repair (tennis-compose ${COMPOSE_VERSION}, ${GATES_VERSION}): stored prose failed thin_context`, keepEvidence: true });
      item.written = true;
      out.repaired += 1;
    } else if (!ed.origin) out.held += 1;
    out.items.push(item);
  }
  return out;
}


/**
 * EDITORIAL OVERHAUL REWRITE (owner brief 2026-10-03): re-write one PUBLISHED story from its OWN frozen packet with the
 * V5 writer (story angle -> narrative -> visuals attached and interpreted) through the factual gates AND the editorial
 * acceptance gate. One routed admin_reedit model call per attempt (attempts <= 2). write=1 replaces the prose IN PLACE
 * only when every gate passes: same article_id, slug, published_at, first_published_at; revised_at + a revision that keeps
 * the prior headline, dek and body; frozen packet and frozen_at untouched. A failing draft writes nothing. No model call
 * is made without write=1 or dry=1 (dry=1: one call, nothing written, for review).
 */
export async function rewriteArticle(env, store, { slug, write = false, dry = false, attempts = 1 } = {}) {
  if (!slug) return { error: 'slug required' };
  const a = (await store.select('tennis_articles', `select=article_id,slug,event_id,status,story_class,prose_origin,headline,deck,body,content_plan,first_published_at,published_at,revised_at,revisions,editorial_version,primary_player_id,player_ids,tennis_article_evidence(packet,frozen_at)&slug=eq.${encodeURIComponent(slug)}`))[0];
  if (!a) return { error: 'no such story' };
  if (a.status !== 'published') return { error: `story is ${a.status}, not published` };
  const evd = Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0] : a.tennis_article_evidence;
  const packet = evd?.packet;
  if (!packet) return { error: 'no frozen packet' };
  if (!write && !dry) return { error: 'pass write=1 (rewrite in place when every gate passes) or dry=1 (one model call, nothing written)' };
  const ev = (await store.select('tennis_news_events', `select=*&event_id=eq.${encodeURIComponent(a.event_id)}`))[0];
  if (!ev) return { error: 'no event row' };
  const storyClass = a.story_class || 'brief';
  const baseline = compose(packet, { storyClass });
  const plan = buildPlan(packet, baseline);
  // presentation fields chosen at publication stay (hero media, evidence dimensions)
  for (const k of ['media', 'evidence_dimensions']) if (a.content_plan?.[k] !== undefined) plan[k] = a.content_plan[k];
  const angle = storyAngle(packet, plan, storyClass);
  const corpus = await loadCorpus(store, { exclude: a.article_id });
  const gate = publicationGate(packet, { plan, storyClass, corpus, angle });
  const ctx = { plan, angle, avoid: overusedFrames(corpus) };
  plan.angle = { version: ANGLE_VERSION, id: angle.angle?.id || null, thesis: angle.angle?.thesis || null, tier: angle.tier, target: angle.target, type: angle.type };
  const old = { headline: a.headline, dek: a.deck, sections: a.body?.sections || [], primary_player_id: a.primary_player_id, player_ids: a.player_ids || [] };
  const oldGate = gate(old);
  const ed = await routedProse(env, store, { ev, articleId: a.article_id, storyClass, packet, baseline, gate, dims: evidenceDimensions(packet), trigger: 'admin_reedit', attempts: Math.min(2, Math.max(1, attempts)), ctx });
  const ok = ed.origin === 'model';
  const report = { slug: a.slug, story_class: storyClass, angle: plan.angle, before: { headline: a.headline, prose_words: proseWords(old), editorial: oldGate.editorial, failures: oldGate.failures.map((f) => f.gate) }, after: ok ? { headline: ed.article.headline, dek: ed.article.dek, prose_words: proseWords(ed.article), editorial: ed.gate.editorial, sections: ed.article.sections.filter((s) => s.id !== 'method') } : null, attempts: ed.attempts, usage: ed.usage, nominal_standard_cost_usd: costUsd(ed.usage), routing: ed.routing, written: false, dry };
  if (ok && write && !dry) {
    plan.routing = ed.routing;
    if (ed.article.layout) plan.layout = ed.article.layout;
    await upgradeArticle(store, { ...a }, { article: ed.article, ed, plan, packet, storyClass, dimensions: evidenceDimensions(packet), reason: `editorial overhaul rewrite (${EDITORIAL_VERSION}, ${EDITORIAL_GATE_VERSION}): narrative rewrite from the frozen packet`, keepEvidence: true });
    report.written = true;
  }
  return report;
}

/** Editorial gate over stored published stories (read-only, no model call). */
export async function editorialAudit(store, { limit = 40 } = {}) {
  const rows = await store.select('tennis_articles', `select=article_id,slug,story_class,story_type,headline,deck,body,content_plan,primary_player_id,player_ids,published_at,tennis_article_evidence(packet)&status=eq.published&order=published_at.desc&limit=${Math.min(100, limit)}`);
  const corpusAll = await loadCorpus(store, { limit: 60 });
  const out = [];
  for (const a of rows) {
    const evd = Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0] : a.tennis_article_evidence;
    if (!evd?.packet) continue;
    const art = { headline: a.headline, dek: a.deck, sections: a.body?.sections || [], primary_player_id: a.primary_player_id, player_ids: a.player_ids || [], layout: a.content_plan?.layout };
    const g = publicationGate(evd.packet, { plan: a.content_plan, storyClass: a.story_class, corpus: corpusAll.filter((c) => c.slug !== a.slug) })(art);
    out.push({ slug: a.slug, story_type: a.story_type, story_class: a.story_class, published_at: a.published_at, pass: g.pass, editorial: g.editorial, failures: [...new Set(g.failures.map((f) => f.gate))] });
  }
  return { stories: out.length, passing: out.filter((x) => x.pass).length, items: out };
}

const authed = (request, env) => env.NEWS_ADMIN_TOKEN && request.headers.get('authorization') === `Bearer ${env.NEWS_ADMIN_TOKEN}`;

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(run(env)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/health' || path === '/') {
      return json(await health({ worker: 'tennis-news', version: VERSION, env, deps: ['TENNIS_MODEL_SUPABASE_URL', 'TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY', 'TENNIS_STATE', 'NEWS_ADMIN_TOKEN', 'OPENAI_API_KEY'], extra: { mode: env.NEWS_PUBLISH_ENABLED === 'true' ? 'publish' : 'shadow', editorial: env.OPENAI_API_KEY ? `openai:${env.TENNIS_EDITORIAL_OPENAI_MODEL || 'gpt-5.6-sol'}` : 'OPENAI SECRET REQUIRED (baseline fallback / HOLD only)', versions: { detector: DETECTOR_VERSION, classifier: CLASSIFIER_VERSION, packet: PACKET_VERSION, compose: COMPOSE_VERSION, gates: GATES_VERSION, editorial: EDITORIAL_VERSION }, gated_kinds: GATED_KINDS, cron: '*/2 * * * *' } }), { headers: { 'cache-control': 'no-store' } });
    }
    if (!authed(request, env)) return json({ ok: false, error: 'not_found' }, { status: 404 });
    const store = storeFromEnv(env);
    if (path === '/v1/news/runs' && request.method === 'POST') return json({ ok: true, data: await run(env, { dry: url.searchParams.get('dry') === '1' }) });
    if (path === '/v1/news/latency') return json({ ok: true, data: await latency(store, Number(url.searchParams.get('hours')) || 168) });
    if (path === '/v1/news/reclassify' && request.method === 'POST') {
      const q = (k, d) => (url.searchParams.get(k) == null ? d : Number(url.searchParams.get(k)));
      return json({ ok: true, data: await reclassify(store, { days: Math.min(14, q('days', 7)), write: url.searchParams.get('write') === '1', offset: Math.max(0, q('offset', 0)), limit: Math.min(200, Math.max(1, q('limit', 200))) }) }); // one page: the one-story-per-signature rule sees the whole window
    }
    // editorial correction: pre-match ratings / expectation must have been validated at the time (dry unless write=1)
    if (path === '/v1/news/correct' && request.method === 'POST') return json({ ok: true, data: await correctPreMatchRatings(store, { write: url.searchParams.get('write') === '1' }) });
    // offline model canary: NEVER publishes or writes; one frozen packet per request (docs/evidence/ai-canary)
    if (path === '/v1/news/canary' && request.method === 'POST') {
      const models = String(url.searchParams.get('models') || '').split(',').map((x) => x.trim()).filter(Boolean);
      return json({ ok: true, data: await runCanary(env, store, { eventId: url.searchParams.get('event_id'), models, maxOutput: Number(url.searchParams.get('max_output')) || null }) });
    }
    // production-path release canary: one routed call, telemetry + premium counter, never writes articles (?dry=1: routing only)
    if (path === '/v1/news/canary-routed' && request.method === 'POST') return json({ ok: true, data: await routedCanary(env, store, { eventId: url.searchParams.get('event_id'), dry: url.searchParams.get('dry') === '1' }) });
    // V4.1 context repair of published match stories (dry unless write=1; model=1 adds one routed admin_reedit edit)
    if (path === '/v1/news/repair-context' && request.method === 'POST') return json({ ok: true, data: await repairContext(env, store, { write: url.searchParams.get('write') === '1', model: url.searchParams.get('model') === '1', slug: url.searchParams.get('slug'), limit: Number(url.searchParams.get('limit')) || 60, minDims: Number(url.searchParams.get('min_dims')) || 4, attempts: Number(url.searchParams.get('attempts')) || 1 }) });
    if (path === '/v1/news/rewrite' && request.method === 'POST') return json({ ok: true, data: await rewriteArticle(env, store, { slug: url.searchParams.get('slug'), write: url.searchParams.get('write') === '1', dry: url.searchParams.get('dry') === '1', attempts: Number(url.searchParams.get('attempts')) || 1 }) });
    // editorial acceptance report for stored stories (no model call)
    if (path === '/v1/news/editorial-audit') return json({ ok: true, data: await editorialAudit(store, { limit: Number(url.searchParams.get('limit')) || 40 }) });
    // preview detection on demand (?dry=1 lists candidates; no model call either way)
    if (path === '/v1/news/previews' && request.method === 'POST') return json({ ok: true, data: await detectPreviews(env, store, { dry: url.searchParams.get('dry') === '1' }) });
    if (path === '/v1/news/ai-usage') return json({ ok: true, data: { ...(await poolUsage(env.TENNIS_STATE)), canary_premium_today: Number(await env.TENNIS_STATE?.get(poolKey('canary-premium'))) || 0, config: (({ standardModel, flagshipModel, flagshipEnabled, volumeModel, standardMaxOutput, flagshipMaxOutput, premiumSoftCap, premiumWarn }) => ({ standardModel, flagshipModel, flagshipEnabled, volumeModel, standardMaxOutput, flagshipMaxOutput, premiumSoftCap, premiumWarn }))(aiConfig(env)) } });
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
