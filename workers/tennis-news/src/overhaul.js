// Editorial overhaul helpers (owner brief 2026-10-03, "Prose leads. Data supports."): the newsroom corpus for the
// repeated-phrasing check, the combined publication gate (factual + editorial acceptance), and preview detection.

import { runGates } from './gates.js';
import { editorialGate, shingles, bodySections, EDITORIAL_GATE_VERSION } from './editorial-gate.js';
import { storyAngle } from './angle.js';
import { classifyEvent, historyEntry, CLASSIFIER_VERSION } from './classify.js';
import { loadMatches, rankAt } from './packet.js';
import { RANKING_LISTS, tourOf } from './tour.js';
import { atpTierForEdition } from '../../shared/atp-tiers.js';

const textOf = (a) => bodySections({ sections: a.body?.sections || a.sections || [] }).flatMap((s) => [s.heading || '', ...(s.paragraphs || []), s.visual_note || '']).join('\n');

/** Recent published stories (newest first) as phrasing shingles; `exclude` = the article being written/rewritten. */
export async function loadCorpus(store, { exclude = null, limit = 40 } = {}) {
  const rows = await store.select('tennis_articles', `select=article_id,slug,body&status=eq.published&order=published_at.desc&limit=${limit}`);
  return rows.filter((r) => r.article_id !== exclude).map((r) => ({ slug: r.slug, shingles: shingles(textOf(r)) }));
}

/** The most repeated 6-word frames across the corpus (shared by >= minArticles stories): the editor is told to avoid them.
 *  minArticles mirrors the editorial gate (stockPhrases: a frame already in 2 stories counts against a draft), so the
 *  writer is warned about every frame the gate can reject (#15: the old 3 left the gate's 2-story frames unannounced). */
export function overusedFrames(corpus, { minArticles = 2, max = 60 } = {}) {
  const n = new Map();
  for (const c of corpus) for (const g of c.shingles) n.set(g, (n.get(g) || 0) + 1);
  return [...n.entries()].filter(([, k]) => k >= minArticles).sort((a, b) => b[1] - a[1]).slice(0, max).map(([g]) => g);
}

/**
 * Publication gate = the factual gates (truth) AND the editorial acceptance gate (finished journalism). Returns the
 * runGates shape with `editorial` metrics attached; failures from both are listed (editorial ones prefixed in detail).
 */
export function publicationGate(packet, { plan, storyClass, corpus = [], angle = null } = {}) {
  const A = angle || storyAngle(packet, plan, storyClass);
  return (article) => {
    const g = runGates(article, packet, { plan });
    const e = editorialGate(article, packet, { plan, storyClass, corpus, angle: A });
    return { ...g, pass: g.pass && e.pass, failures: [...g.failures, ...e.failures.map((f) => ({ ...f, family: 'editorial' }))], editorial: { version: EDITORIAL_GATE_VERSION, pass: e.pass, metrics: e.metrics } };
  };
}

const PREVIEW_HORIZON_H = 30;
const PREVIEWS_PER_RUN = 3;
const PREVIEWS_PER_DAY = 8;
const ROUND_MAT = { Q: 66, S: 70, F: 74 };

/**
 * PREVIEW detection: scheduled main-draw singles matches in the next 30 h whose facts clear the preview bar
 * (classify 'preview'). One canonical event per match (signature preview:<match_id>), at most 3 per run and 8 per UTC
 * day (KV counter) so automatic paid prose stays bounded. Detection never calls a model.
 */
export async function detectPreviews(env, store, { now = new Date(), dry = false } = {}) {
  const until = new Date(now.getTime() + PREVIEW_HORIZON_H * 3600e3).toISOString();
  const rows = await loadMatches(store, `status=eq.scheduled&event_type=in.(WS,MS)&scheduled_at=gte.${now.toISOString()}&scheduled_at=lte.${until}&order=scheduled_at.asc&limit=120`);
  const day = now.toISOString().slice(0, 10);
  const kvKey = `news:preview:count:${day}`;
  let used = Number(env.TENNIS_STATE ? await env.TENNIS_STATE.get(kvKey) : 0) || 0;
  const out = [];
  const tierCache = new Map();
  const known = new Set();
  const ids = rows.map((m) => `preview:${m.id}`);
  for (let i = 0; i < ids.length; i += 50) for (const r of await store.select('tennis_news_events', `select=event_id&event_id=in.(${ids.slice(i, i + 50).map((x) => `"${x}"`).join(',')})`)) known.add(r.event_id);
  for (const m of rows) {
    if (out.length >= PREVIEWS_PER_RUN || used + out.length >= PREVIEWS_PER_DAY) break;
    if (known.has(`preview:${m.id}`)) continue;
    const code = String(m.round || '').split('-').pop();
    if (/^Q-/.test(String(m.round)) || !ROUND_MAT[code]) continue;
    if ((m.sides.A?.players || []).length !== 1 || (m.sides.B?.players || []).length !== 1) continue;
    let atpTier = null;
    if (m.event_type === 'MS' && !m.tournament.level) {
      if (!tierCache.has(m.tournament.edition_id)) tierCache.set(m.tournament.edition_id, await atpTierForEdition(m.tournament.edition_id));
      atpTier = tierCache.get(m.tournament.edition_id);
    }
    const listKey = RANKING_LISTS[m.event_type] || null;
    const pa = m.sides.A.players[0].id;
    const pb = m.sides.B.players[0].id;
    const ranks = listKey ? await rankAt(store, [pa, pb], m.tournament.start_date, listKey) : new Map();
    const facts = { tour: tourOf(m.event_type), event_type: m.event_type, level: m.tournament.level || null, edition_tier: atpTier?.tier || null, tier_registry: atpTier?.registry || null, competition_key: m.tournament.competition_key || null, tournament_slug: m.tournament.slug || null, source_family: m.tournament.source_family || null, round: m.round, scheduled_at: m.scheduled_at, a_rank: ranks.get(pa)?.rank ?? null, b_rank: ranks.get(pb)?.rank ?? null, a_seed: m.sides.A.seed ?? null, b_seed: m.sides.B.seed ?? null, rank_list: ranks.provenance ? listKey : null, rank_classification: ranks.provenance?.classification || null };
    const ev = { kind: 'preview', facts };
    const cls = classifyEvent(ev);
    if (!cls.publish_article) continue;
    out.push({ event_id: `preview:${m.id}`, kind: 'preview', occurred_at: m.scheduled_at, entities: [pa, pb], materiality: ROUND_MAT[code], evidence: { facts, detector: 'tennis-preview/1.0.0' }, state: 'detected', state_reason: null, editorial_class: cls.surface, class_reasons: cls.reasons, class_history: [historyEntry('detect', cls.surface, cls.reasons, now.toISOString())], classifier_version: CLASSIFIER_VERSION, signature: `preview:${m.id}`, match_id: m.id, detected_at: now.toISOString() });
  }
  if (dry || !out.length) return { scanned: rows.length, candidates: dry ? out.map((x) => ({ event_id: x.event_id, class: x.editorial_class, reasons: x.class_reasons, facts: x.evidence.facts })) : 0 };
  const fresh = out;
  if (fresh.length) {
    await store.upsert('tennis_news_events', fresh, { onConflict: 'event_id', ignore: true });
    if (env.TENNIS_STATE) await env.TENNIS_STATE.put(kvKey, String(used + fresh.length), { expirationTtl: 3 * 86400 });
  }
  return { scanned: rows.length, new: fresh.length, ids: fresh.map((x) => x.event_id) };
}
