// Newsroom read API. Published stories only; held drafts are readable with NEWS_PREVIEW_TOKEN for
// internal QA (never cached, never indexed). The frozen evidence packet is summarised, not re-derived:
// a published story never re-reads live rankings or DNA.

import { envelope, notConfigured } from '../../shared/envelope.js';
import { approvedMedia } from '../../shared/media.js';
import { resolveHero } from '../../shared/editorial.js';
import editorial from '../../../data/media/editorial-media.json' with { type: 'json' };
import { MATCH, shapeMatch, UUID, SLUG } from './shape.js';
import { deskFor, tourOf, tourOfList, LIST_LABEL } from '../../tennis-news/src/tour.js';
import { roundLabel } from '../../tennis-news/src/packet.js';

const DESKS = ['all', 'wta', 'atp', 'grand-slams', 'challenger', 'itf', 'doubles', 'rankings'];
const LIST = 'article_id,slug,status,headline,deck,story_type,story_class,first_published_at,revised_at,desk,primary_player_id,player_ids,match_id,tournament,key_stat,prose_origin,published_at,updated_at,hold_reason,content_plan,tennis_players!tennis_articles_primary_player_id_fkey(slug,full_name,tennis_player_media(approval,derivatives)),tennis_news_events!tennis_articles_event_id_fkey(occurred_at,detected_at,class_history),tennis_matches!tennis_articles_match_id_fkey(started_at,scheduled_at)';
// the story's featured side, frozen at publication (winners of a match story): the faces a card may show
const teamOf = (a) => {
  const sb = (a.content_plan?.modules || []).find((m) => m.id === 'scoreboard')?.data;
  const side = sb?.winner_side ? sb.sides?.[sb.winner_side] : null;
  return (side?.players || []).filter((p) => p?.slug).map((p) => ({ slug: p.slug, name: p.name, nationality: p.nationality || null, photo: p.photo?.square ? { square: p.photo.square, author: p.photo.author || null, license: p.photo.license || null, source_page: p.photo.source_page || null } : null }));
};
async function relatedCards(store, articleId) {
  const rows = await store.select('tennis_articles', `select=${LIST}&status=eq.published&article_id=neq.${articleId}&order=published_at.desc.nullslast&limit=4`);
  const photos = await currentPhotos(store, rows.flatMap((r) => storyContext(r).featured_ids));
  return rows.map((r) => shapeCard(r, photos));
}

/** Current approved canonical photos for players (identity store); a story upgrades when a photo is approved. */
async function currentPhotos(store, ids) {
  const out = new Map();
  const uniq = [...new Set(ids.filter((x) => /^[0-9a-f-]{36}$/.test(String(x))))];
  for (let i = 0; i < uniq.length; i += 100) {
    const rows = await store.select('tennis_players', `select=pbe_player_id,slug,full_name,tennis_player_media(approval,derivatives,attribution,source_page_url,license,author,focal)&pbe_player_id=in.(${uniq.slice(i, i + 100).join(',')})`);
    for (const r of rows) {
      const m = approvedMedia(r.tennis_player_media);
      const d = m?.derivatives;
      if (!d?.square?.url) continue;
      out.set(r.pbe_player_id, { slug: r.slug, name: r.full_name, square: d.square.url, portrait: d.portrait?.url || null, wide: d.wide?.url || null, thumb: d.thumb?.url || null, square_jpg: d.square_jpg?.url || null, credit: m.attribution || null, author: m.author || null, license: m.license || null, source_page: m.source_page_url || null, focal: m.focal || null });
    }
  }
  return out;
}

/** Story context for the editorial resolver, strictly from the frozen evidence. */
export function storyContext(a, packet = null) {
  const sb = (a.content_plan?.modules || []).find((m) => m.id === 'scoreboard')?.data;
  const parts = packet?.participants || sb?.sides || null;
  const W = sb?.winner_side;
  const ids = (xs) => (xs || []).map((p) => p.id).filter(Boolean);
  const t = packet?.tournament || a.tournament || {};
  return { match_id: a.match_id || null, tournament: { slug: t.slug || a.tournament?.slug || null, year: t.year || a.tournament?.year || null }, surface: t.surface || null, featured_ids: W && parts?.[W] ? ids(parts[W].players) : a.primary_player_id ? [a.primary_player_id] : [], player_ids: parts ? [...ids(parts.A?.players), ...ids(parts.B?.players)] : a.player_ids || [] };
}
/**
 * Which clock a reader should see (owner rule 2026-09-29): a story that was PUBLISHED BY the V3 reclassification backfill
 * must never read as breaking news. is_backfill comes from the lifecycle record: the article was first published after
 * its event's 'reclassify_v3' class-history entry (the 5 stories published before the reclassification are not
 * backfills). The event time is the match's own start, else its scheduled time (day precision for secondary results),
 * else the event's occurred_at (which can be a tournament start date for results without a time).
 */
export function freshnessOf(a) {
  const ev = Array.isArray(a.tennis_news_events) ? a.tennis_news_events[0] : a.tennis_news_events;
  const m = Array.isArray(a.tennis_matches) ? a.tennis_matches[0] : a.tennis_matches;
  const pub = a.first_published_at || a.published_at || null;
  const reclass = (Array.isArray(ev?.class_history) ? ev.class_history : []).find((h) => h?.stage === 'reclassify_v3');
  const isBackfill = !!(reclass?.at && pub && Date.parse(pub) >= Date.parse(reclass.at));
  const eventAt = m?.started_at || m?.scheduled_at || ev?.occurred_at || null;
  return { basis: isBackfill ? 'event' : 'published', is_backfill: isBackfill, event_at: eventAt, detected_at: ev?.detected_at || null, published_at: pub, reason: isBackfill ? 'published by the 2026-09-29 V3 reclassification, after the event' : null };
}
const shapeCard = (a, photos = new Map()) => {
  const d = approvedMedia(a.tennis_players?.tennis_player_media)?.derivatives;
  return { freshness: freshnessOf(a), id: a.article_id, slug: a.slug, status: a.status, headline: a.headline, dek: a.deck, story_type: a.story_type, story_class: a.story_class || null, first_published_at: a.first_published_at || null, revised_at: a.revised_at || null, desk: a.desk, match_id: a.match_id, tournament: a.tournament, key_stat: a.key_stat, published_at: a.published_at, updated_at: a.updated_at, team: teamOf(a), media: { hero: resolveHero(storyContext(a), editorial, photos) }, player: a.tennis_players ? { slug: a.tennis_players.slug, name: a.tennis_players.full_name, photo: d?.square?.url ? { square: d.square.url, wide: d.wide?.url || null } : null } : null, ...(a.status !== 'published' ? { hold_reason: a.hold_reason } : {}) };
};

/** What a PBEcast replay of this match can honestly show: point-by-point, observed score changes, or none. */
async function replayOf(store, matchId) {
  if (!matchId || !/^[0-9a-f-]{36}$/.test(matchId)) return { available: false, quality: null };
  const pts = await store.select('tennis_match_events', `select=event_id&match_id=eq.${matchId}&quality=eq.point_event&limit=1`);
  if (pts.length) return { available: true, quality: 'point_by_point' };
  const obs = await store.select('tennis_match_events', `select=event_id&match_id=eq.${matchId}&limit=1`);
  return obs.length ? { available: true, quality: 'observed' } : { available: false, quality: null };
}

export const isPreview = (url, env) => !!env?.NEWS_PREVIEW_TOKEN && url.searchParams.get('preview') === env.NEWS_PREVIEW_TOKEN;

export async function newsRoute(path, url, store, env) {
  if (!/^\/v1\/news(\/[a-z0-9-]+)?$/.test(path)) return undefined;
  if (!store) return notConfigured('canonical store not connected to this Worker');
  const preview = isPreview(url, env);
  const statusQ = preview ? 'status=in.(published,held)' : 'status=eq.published';
  if (path === '/v1/news/live') return liveWire(store, url);
  const m = /^\/v1\/news\/([a-z0-9-]+)$/.exec(path);
  if (!m || DESKS.includes(m[1])) {
    const desk = m ? m[1] : url.searchParams.get('desk') || 'all';
    const limit = Math.min(60, Number(url.searchParams.get('limit')) || 30);
    // cross-linking filters: stories naming a canonical player id, or from one tournament edition
    const player = url.searchParams.get('player');
    const tslug = url.searchParams.get('tournament');
    const tyear = url.searchParams.get('year');
    const matchId = url.searchParams.get('match'); // stories about one canonical match (the completed-match page)
    const filt = `${matchId && /^[0-9a-f-]{36}$/.test(matchId) ? `&match_id=eq.${matchId}` : ''}${player && /^[0-9a-f-]{36}$/.test(player) ? `&player_ids=cs.{${player}}` : ''}${tslug && /^[a-z0-9-]{1,80}$/.test(tslug) ? `&tournament->>slug=eq.${tslug}` : ''}${tyear && /^\d{4}$/.test(tyear) ? `&tournament->>year=eq.${tyear}` : ''}`;
    const rows = await store.select('tennis_articles', `select=${LIST}&${statusQ}${desk !== 'all' ? `&desk=eq.${desk}` : ''}${filt}&order=published_at.desc.nullslast,updated_at.desc,article_id.desc&limit=${limit}`);
    const photos = await currentPhotos(store, rows.flatMap((r) => storyContext(r).featured_ids));
    return envelope({ desk, desks: DESKS, articles: rows.map((r) => shapeCard(r, photos)), preview }, { source: ['propbetedge'], source_updated_at: rows[0]?.updated_at || null, policy: { currentS: 300, staleS: 3600 }, semantics: rows.length ? 'published PropBetEdge Tennis stories, newest first' : 'no published stories yet: every story must pass the evidence gates (a quiet day publishes nothing)' });
  }
  const a = (await store.select('tennis_articles', `select=${LIST},body,content_plan,gate_results,editorial_version,generator_version,revisions,tennis_article_evidence(frozen_at,packet)&slug=eq.${m[1]}&${statusQ}`))[0];
  if (!a) return null;
  const packet = a.tennis_article_evidence?.packet || (Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0]?.packet : null);
  const frozenAt = a.tennis_article_evidence?.frozen_at || (Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0]?.frozen_at : null);
  const ctx = storyContext(a, packet);
  const photos = await currentPhotos(store, ctx.player_ids);
  const data = {
    ...shapeCard(a, photos), sections: a.body?.sections || [], plan: a.content_plan, first_published_at: a.first_published_at,
    glance: a.content_plan?.glance || null, intelligence: a.content_plan?.intelligence || null, evidence_dimensions: a.content_plan?.evidence_dimensions || null,
    revisions: (a.revisions || []).map((r) => ({ at: r.at, from_class: r.from_class || null, to_class: r.to_class || null, reason: r.reason || null })),
    evidence: packet ? { frozen_at: frozenAt, packet_version: packet.version, event: { kind: packet.event.kind, materiality: packet.event.materiality }, provenance: packet.provenance, participants: packet.participants || null, player: packet.player || null, tournament: packet.tournament || null, match: packet.match ? { id: packet.match.id, round_label: packet.match.round_label, score: packet.match.score, date: packet.match.date, status: packet.match.status } : null, market: packet.market_snapshot || null } : null,
    method: { editorial: a.editorial_version, writer: a.generator_version, prose: a.prose_origin, gates: a.gate_results?.gates_version || null, gates_passed: !!a.gate_results?.gate?.pass },
    media: { hero: resolveHero(ctx, editorial, photos), photos: Object.fromEntries(ctx.player_ids.filter((id) => photos.has(id)).map((id) => [id, photos.get(id)])) },
    replay: await replayOf(store, a.match_id),
    related: await relatedCards(store, a.article_id)
  };
  return envelope(data, { source: ['propbetedge'], source_updated_at: a.updated_at, policy: { currentS: 3600, staleS: 86400 * 30 }, semantics: 'story built from a frozen evidence packet; values are as of the event, not today' });
}

// ---- internal live wire (Newsroom V3) --------------------------------------------------------------------------
// A read projection of tennis_news_events: every classified event is a deterministic fact card (no interpretation,
// no model prose, no materiality). Links point inward: article > match > tournament > player. The external publisher
// wire (tennis_news_wire) is a different contract and is not read here.
const WIRE_STATES = ['wire', 'published', 'detected', 'enriching', 'below_threshold'];
const other = (s) => (s === 'A' ? 'B' : 'A');
const names = (side) => (side?.players || []).map((p) => p?.name).filter(Boolean).join(' / ');
function wireScore(m, W) {
  const L = other(W);
  const sets = (m.sets || []).map((s) => (s.match_tiebreak && s.tb ? `[${s.tb[W]}-${s.tb[L]}]` : `${s[W]}-${s[L]}${s.tb ? `(${Math.min(s.tb.A, s.tb.B)})` : ''}`)).join(' ');
  return m.status === 'walkover' ? 'w/o' : `${sets}${m.status === 'retired' ? ' ret.' : ''}`.trim();
}
const cap = (x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);

/** Deterministic headline + summary for one event. Pure (exported for tests). */
export function wireCopy(ev, { match = null, player = null } = {}) {
  const f = ev.evidence?.facts || {};
  if (match) {
    const W = match.winner_side;
    const L = W ? other(W) : null;
    if (!W) return null;
    const w = names(match.sides[W]);
    const l = names(match.sides[L]);
    const T = match.tournament?.tournament || match.tournament?.name || 'the tournament';
    const score = wireScore(match, W);
    const rl = roundLabel(match.round);
    const plural = (match.sides[W]?.players || []).length > 1;
    const vb = (one, many) => (plural ? many : one);
    const lr = Number.isFinite(f.loser_rank) ? f.loser_rank : null;
    let headline;
    switch (ev.kind) {
      case 'title': headline = `${w} ${vb('wins', 'win')} the ${T} title`; break;
      case 'doubles_title': headline = `${w} win the ${T} doubles title`; break;
      case 'upset': headline = lr ? `${w} ${vb('defeats', 'defeat')} No. ${lr} ${l} at ${T}` : `${w} ${vb('defeats', 'defeat')} ${l} at ${T}`; break;
      case 'seed_upset': headline = `${w} ${vb('beats', 'beat')} No. ${f.loser_seed ?? match.sides[L]?.seed} seed ${l} at ${T}`; break;
      case 'retirement': headline = `${l} ${vb('retires', 'retire')} against ${w} at ${T}`; break;
      case 'walkover': headline = `${w} ${vb('advances', 'advance')} at ${T} after ${l} ${(match.sides[L]?.players || []).length > 1 ? 'withdraw' : 'withdraws'}`; break;
      case 'comeback': headline = `${w} ${vb('comes', 'come')} from a set down to beat ${l} at ${T}`; break;
      case 'deciding_tiebreak': headline = `${w} ${vb('beats', 'beat')} ${l} in a deciding-set tiebreak at ${T}`; break;
      case 'qualifier_run': headline = `${f.entry === 'LL' ? 'Lucky loser' : 'Qualifier'} ${w} reaches the ${T} ${({ SF: 'semifinals', F: 'final', title: 'title' })[f.reached] || rl}`; break;
      default: headline = `${w} ${vb('defeats', 'defeat')} ${l} ${score} at ${T}`;
    }
    const summary = match.status === 'walkover' ? `${cap(rl)}: walkover. The source gives no reason.` : match.status === 'retired' ? `${cap(rl)}: ${score}. The match ended in a retirement; the source gives no reason.` : `${cap(rl)}: ${w} ${vb('won', 'won')} ${score}.`;
    return { headline, summary };
  }
  if (player && f.list) {
    const label = LIST_LABEL[f.list] || f.list;
    const headline = ev.kind === 'new_no1' ? `${player.name} is No. 1 on the ${label} list` : `${player.name} moves into the top ${f.tier ?? String(ev.kind).replace('enters_top', '')} of the ${label} list`;
    const summary = `No. ${f.rank}${Number.isFinite(f.previous_rank) ? `, up from No. ${f.previous_rank}` : ', new to the list'} on the list dated ${f.list_date}.`;
    return { headline, summary };
  }
  return null;
}

/** One public wire card. Pure (exported for tests). */
export function wireCard(ev, { match = null, player = null, article = null } = {}) {
  const copy = wireCopy(ev, { match, player });
  if (!copy) return null;
  const f = ev.evidence?.facts || {};
  const t = match?.tournament || null;
  const people = match ? ['A', 'B'].flatMap((s) => (match.sides[s]?.players || []).filter(Boolean)).sort((a, b) => (match.sides[match.winner_side]?.players.includes(a) ? -1 : 0) - (match.sides[match.winner_side]?.players.includes(b) ? -1 : 0)) : player ? [player] : [];
  const links = [];
  if (article) links.push({ rel: 'article', href: `/news/${article.slug}`, label: 'Read the story' });
  if (match) links.push({ rel: 'match', href: `/matches/${match.id}`, label: 'Match' });
  if (t?.slug && t?.year) links.push({ rel: 'tournament', href: `/tournaments/${t.slug}/${t.year}`, label: t.tournament || t.name });
  for (const p of people.slice(0, 2)) if (p.slug) links.push({ rel: 'player', href: `/players/${p.slug}`, label: p.name });
  return {
    id: ev.event_id, kind: ev.kind, tour: match ? tourOf(match.event_type) : tourOfList(f.list), desk: match ? deskFor(match.event_type, { level: t?.level, slug: t?.slug }) : 'rankings',
    occurred_at: ev.occurred_at, detected_at: ev.detected_at, headline: copy.headline, summary: copy.summary,
    tournament: t ? { slug: t.slug, year: t.year, name: t.tournament || t.name, city: t.city || null, level: t.level || null, surface: t.surface || null } : null,
    players: people.map((p) => ({ id: p.id, slug: p.slug, name: p.name, photo: p.photo?.thumb || p.photo?.square || null })),
    match_id: match?.id || null, event_type: match?.event_type || null, round: match ? roundLabel(match.round) : null, score: match && match.winner_side ? wireScore(match, match.winner_side) : null,
    article_slug: article?.slug || null, story_class: article ? article.story_class || 'brief' : null, links,
    state: article ? 'story' : ev.state === 'detected' || ev.state === 'enriching' ? 'developing' : 'wire'
  };
}

/**
 * A wire item's clock (owner rule 2026-09-29): the wire is ordered by when WE recorded an event, but an item recorded long
 * after it happened (a late secondary-source catch-up, or one whose story was published by the V3 reclassification
 * backfill) is historical: its EVENT date is the clock, never a fresh time of day.
 */
export const WIRE_LATE_MS = 18 * 3600e3;
export function wireFreshness(ev, match, article) {
  const eventAt = match?.scheduled_at || match?.started_at || ev?.occurred_at || null;
  const reclass = (Array.isArray(ev?.class_history) ? ev.class_history : []).find((h) => h?.stage === 'reclassify_v3');
  const backfillStory = !!(article?.first_published_at && reclass?.at && Date.parse(article.first_published_at) >= Date.parse(reclass.at));
  const late = !!(eventAt && ev?.detected_at && Date.parse(ev.detected_at) - Date.parse(eventAt) > WIRE_LATE_MS);
  return { event_at: eventAt, historical: backfillStory || late, reason: backfillStory ? 'story published by the V3 reclassification after the event' : late ? 'recorded more than 18 h after the event' : null };
}

async function liveWire(store, url) {
  const limit = Math.min(100, Number(url.searchParams.get('limit')) || 40);
  const desk = url.searchParams.get('desk');
  const tour = url.searchParams.get('tour');
  const player = url.searchParams.get('player');
  const tslug = url.searchParams.get('tournament');
  const tyear = url.searchParams.get('year');
  const pf = player && UUID.test(player) ? `&entities=cs.${encodeURIComponent(JSON.stringify([player]))}` : '';
  const evs = await store.select('tennis_news_events', `select=event_id,kind,state,occurred_at,detected_at,match_id,article_id,entities,evidence,class_history&state=in.(${WIRE_STATES.join(',')})${pf}&order=detected_at.desc,event_id.desc&limit=${Math.min(300, limit * 3)}`);
  const mids = [...new Set(evs.map((e) => e.match_id).filter(Boolean))];
  const matches = new Map();
  for (let i = 0; i < mids.length; i += 50) for (const r of await store.select('tennis_matches', `select=${MATCH}&match_id=in.(${mids.slice(i, i + 50).join(',')})`)) matches.set(r.match_id, shapeMatch(r));
  const pids = [...new Set(evs.filter((e) => !e.match_id).map((e) => e.entities?.[0]).filter((x) => UUID.test(String(x))))];
  const players = new Map(pids.length ? (await store.select('tennis_players', `select=pbe_player_id,slug,full_name,last_name,nationality,gender,tennis_player_media(approval,derivatives,attribution,source_page_url,license,author)&pbe_player_id=in.(${pids.join(',')})`)).map((p) => [p.pbe_player_id, { id: p.pbe_player_id, slug: p.slug, name: p.full_name }]) : []);
  const aids = [...new Set(evs.map((e) => e.article_id).filter(Boolean))];
  const articles = new Map(aids.length ? (await store.select('tennis_articles', `select=article_id,slug,story_class,status,first_published_at&article_id=in.(${aids.join(',')})&status=eq.published`)).map((a) => [a.article_id, a]) : []);
  const items = [];
  for (const ev of evs) {
    // a superseded (duplicate) match never reaches the wire: its survivor carries its own events and links
    if (ev.match_id && matches.get(ev.match_id)?.status === 'superseded') continue;
    const card = wireCard(ev, { match: ev.match_id ? matches.get(ev.match_id) : null, player: ev.match_id ? null : players.get(ev.entities?.[0]), article: ev.article_id ? articles.get(ev.article_id) : null });
    if (!card) continue;
    card.freshness = wireFreshness(ev, ev.match_id ? matches.get(ev.match_id) : null, ev.article_id ? articles.get(ev.article_id) : null);
    if (desk && desk !== 'all' && card.desk !== desk) continue;
    if (tour && card.tour !== tour) continue;
    if (tslug && SLUG.test(tslug) && card.tournament?.slug !== tslug) continue;
    if (tyear && /^\d{4}$/.test(tyear) && String(card.tournament?.year) !== tyear) continue;
    items.push(card);
    if (items.length >= limit) break;
  }
  return envelope({ items, filters: { desk: desk || 'all', tour: tour || null, player: player || null, tournament: tslug || null, year: tyear || null } }, { source: ['propbetedge'], source_updated_at: items[0]?.detected_at || null, policy: { currentS: 120, staleS: 1800 }, semantics: 'live tennis wire: deterministic fact cards from the PropBetEdge newsroom event stream (no interpretation); links go to the story when one exists, else match, tournament, player' });
}
