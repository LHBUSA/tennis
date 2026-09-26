// Newsroom read API. Published stories only; held drafts are readable with NEWS_PREVIEW_TOKEN for
// internal QA (never cached, never indexed). The frozen evidence packet is summarised, not re-derived:
// a published story never re-reads live rankings or DNA.

import { envelope, notConfigured } from '../../shared/envelope.js';
import { approvedMedia } from '../../shared/media.js';
import { resolveHero } from '../../shared/editorial.js';
import editorial from '../../../data/media/editorial-media.json' with { type: 'json' };

const DESKS = ['all', 'wta', 'atp', 'grand-slams', 'challenger', 'itf', 'doubles', 'rankings'];
const LIST = 'article_id,slug,status,headline,deck,story_type,desk,primary_player_id,player_ids,match_id,tournament,key_stat,prose_origin,published_at,updated_at,hold_reason,content_plan,tennis_players!tennis_articles_primary_player_id_fkey(slug,full_name,tennis_player_media(approval,derivatives))';
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
const shapeCard = (a, photos = new Map()) => {
  const d = approvedMedia(a.tennis_players?.tennis_player_media)?.derivatives;
  return { id: a.article_id, slug: a.slug, status: a.status, headline: a.headline, dek: a.deck, story_type: a.story_type, desk: a.desk, match_id: a.match_id, tournament: a.tournament, key_stat: a.key_stat, published_at: a.published_at, updated_at: a.updated_at, team: teamOf(a), media: { hero: resolveHero(storyContext(a), editorial, photos) }, player: a.tennis_players ? { slug: a.tennis_players.slug, name: a.tennis_players.full_name, photo: d?.square?.url ? { square: d.square.url, wide: d.wide?.url || null } : null } : null, ...(a.status !== 'published' ? { hold_reason: a.hold_reason } : {}) };
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
  const m = /^\/v1\/news\/([a-z0-9-]+)$/.exec(path);
  if (!m || DESKS.includes(m[1])) {
    const desk = m ? m[1] : url.searchParams.get('desk') || 'all';
    const limit = Math.min(60, Number(url.searchParams.get('limit')) || 30);
    // cross-linking filters: stories naming a canonical player id, or from one tournament edition
    const player = url.searchParams.get('player');
    const tslug = url.searchParams.get('tournament');
    const tyear = url.searchParams.get('year');
    const filt = `${player && /^[0-9a-f-]{36}$/.test(player) ? `&player_ids=cs.{${player}}` : ''}${tslug && /^[a-z0-9-]{1,80}$/.test(tslug) ? `&tournament->>slug=eq.${tslug}` : ''}${tyear && /^\d{4}$/.test(tyear) ? `&tournament->>year=eq.${tyear}` : ''}`;
    const rows = await store.select('tennis_articles', `select=${LIST}&${statusQ}${desk !== 'all' ? `&desk=eq.${desk}` : ''}${filt}&order=published_at.desc.nullslast,updated_at.desc,article_id.desc&limit=${limit}`);
    const photos = await currentPhotos(store, rows.flatMap((r) => storyContext(r).featured_ids));
    return envelope({ desk, desks: DESKS, articles: rows.map((r) => shapeCard(r, photos)), preview }, { source: ['propbetedge'], source_updated_at: rows[0]?.updated_at || null, policy: { currentS: 300, staleS: 3600 }, semantics: rows.length ? 'published PropBetEdge Tennis stories, newest first' : 'no published stories yet: every story must pass the evidence gates (a quiet day publishes nothing)' });
  }
  const a = (await store.select('tennis_articles', `select=${LIST},body,content_plan,gate_results,editorial_version,generator_version,first_published_at,tennis_article_evidence(frozen_at,packet)&slug=eq.${m[1]}&${statusQ}`))[0];
  if (!a) return null;
  const packet = a.tennis_article_evidence?.packet || (Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0]?.packet : null);
  const frozenAt = a.tennis_article_evidence?.frozen_at || (Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0]?.frozen_at : null);
  const ctx = storyContext(a, packet);
  const photos = await currentPhotos(store, ctx.player_ids);
  const data = {
    ...shapeCard(a, photos), sections: a.body?.sections || [], plan: a.content_plan, first_published_at: a.first_published_at,
    evidence: packet ? { frozen_at: frozenAt, packet_version: packet.version, event: { kind: packet.event.kind, materiality: packet.event.materiality }, provenance: packet.provenance, participants: packet.participants || null, player: packet.player || null, tournament: packet.tournament || null, match: packet.match ? { id: packet.match.id, round_label: packet.match.round_label, score: packet.match.score, date: packet.match.date, status: packet.match.status } : null } : null,
    method: { editorial: a.editorial_version, writer: a.generator_version, prose: a.prose_origin, gates: a.gate_results?.gates_version || null, gates_passed: !!a.gate_results?.gate?.pass },
    media: { hero: resolveHero(ctx, editorial, photos), photos: Object.fromEntries(ctx.player_ids.filter((id) => photos.has(id)).map((id) => [id, photos.get(id)])) },
    replay: await replayOf(store, a.match_id),
    related: await relatedCards(store, a.article_id)
  };
  return envelope(data, { source: ['propbetedge'], source_updated_at: a.updated_at, policy: { currentS: 3600, staleS: 86400 * 30 }, semantics: 'story built from a frozen evidence packet; values are as of the event, not today' });
}
