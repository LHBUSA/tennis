// Newsroom read API. Published stories only; held drafts are readable with NEWS_PREVIEW_TOKEN for
// internal QA (never cached, never indexed). The frozen evidence packet is summarised, not re-derived:
// a published story never re-reads live rankings or DNA.

import { envelope, notConfigured } from '../../shared/envelope.js';
import { approvedMedia } from '../../shared/media.js';

const DESKS = ['all', 'wta', 'atp', 'grand-slams', 'challenger', 'itf', 'doubles', 'rankings'];
const LIST = 'article_id,slug,status,headline,deck,story_type,desk,primary_player_id,player_ids,match_id,tournament,key_stat,prose_origin,published_at,updated_at,hold_reason,tennis_players!tennis_articles_primary_player_id_fkey(slug,full_name,tennis_player_media(approval,derivatives))';
const shapeCard = (a) => {
  const d = approvedMedia(a.tennis_players?.tennis_player_media)?.derivatives;
  return { id: a.article_id, slug: a.slug, status: a.status, headline: a.headline, dek: a.deck, story_type: a.story_type, desk: a.desk, match_id: a.match_id, tournament: a.tournament, key_stat: a.key_stat, published_at: a.published_at, updated_at: a.updated_at, player: a.tennis_players ? { slug: a.tennis_players.slug, name: a.tennis_players.full_name, photo: d?.square?.url ? { square: d.square.url, wide: d.wide?.url || null } : null } : null, ...(a.status !== 'published' ? { hold_reason: a.hold_reason } : {}) };
};

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
    const rows = await store.select('tennis_articles', `select=${LIST}&${statusQ}${desk !== 'all' ? `&desk=eq.${desk}` : ''}&order=published_at.desc.nullslast,updated_at.desc,article_id.desc&limit=${limit}`);
    return envelope({ desk, desks: DESKS, articles: rows.map(shapeCard), preview }, { source: ['propbetedge'], source_updated_at: rows[0]?.updated_at || null, policy: { currentS: 300, staleS: 3600 }, semantics: rows.length ? 'published PropBetEdge Tennis stories, newest first' : 'no published stories yet: every story must pass the evidence gates (a quiet day publishes nothing)' });
  }
  const a = (await store.select('tennis_articles', `select=${LIST},body,content_plan,gate_results,editorial_version,generator_version,first_published_at,tennis_article_evidence(frozen_at,packet)&slug=eq.${m[1]}&${statusQ}`))[0];
  if (!a) return null;
  const packet = a.tennis_article_evidence?.packet || (Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0]?.packet : null);
  const frozenAt = a.tennis_article_evidence?.frozen_at || (Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0]?.frozen_at : null);
  const data = {
    ...shapeCard(a), sections: a.body?.sections || [], plan: a.content_plan, first_published_at: a.first_published_at,
    evidence: packet ? { frozen_at: frozenAt, packet_version: packet.version, event: { kind: packet.event.kind, materiality: packet.event.materiality }, provenance: packet.provenance, participants: packet.participants || null, player: packet.player || null, tournament: packet.tournament || null, match: packet.match ? { id: packet.match.id, round_label: packet.match.round_label, score: packet.match.score, date: packet.match.date, status: packet.match.status } : null } : null,
    method: { editorial: a.editorial_version, writer: a.generator_version, prose: a.prose_origin, gates: a.gate_results?.gates_version || null, gates_passed: !!a.gate_results?.gate?.pass }
  };
  return envelope(data, { source: ['propbetedge'], source_updated_at: a.updated_at, policy: { currentS: 3600, staleS: 86400 * 30 }, semantics: 'story built from a frozen evidence packet; values are as of the event, not today' });
}
