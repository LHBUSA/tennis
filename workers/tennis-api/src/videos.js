// Official match videos (read side). The tennis-ingest video lane links one long-form upload of a verified official
// channel to ONE canonical match and stores the decision in KV; this route only reads it — the frontend never
// rediscovers anything and a video posted hours after a final appears here with no release.
//   GET /v1/matches/:id/videos   ranked: full match replay > extended > match highlights > interview
//   GET /v1/videos/recent        { match_id: { best, label, count } } for result cards / the homepage indicator
import { envelope } from '../../shared/envelope.js';

const KV_CATALOG = 'video:v1:catalog';
const KV_BY_MATCH = 'video:v1:by-match';
const RANK = { full_match: 1, extended_highlights: 2, match_highlights: 3, interview: 4, tournament_coverage: 5 };
const LABEL = { full_match: 'Full match replay', extended_highlights: 'Extended highlights', match_highlights: 'Match highlights', interview: 'Interview', tournament_coverage: 'Tournament highlights' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const pub = (v) => ({
  video_id: v.video_id, title: v.title, channel: v.channel, channel_class: v.channel_class, published_at: v.published_at,
  video_type: v.video_type, label: LABEL[v.video_type] || 'Video', thumbnail: `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`,
  embeddable: v.embeddable === true, availability: v.embeddable === true ? 'embeddable' : 'unverified', confidence: v.link?.confidence || null
});
const rank = (vs) => vs.slice().sort((a, b) => (RANK[a.video_type] ?? 9) - (RANK[b.video_type] ?? 9) || String(b.published_at).localeCompare(String(a.published_at)));

export async function videoRoute(path, env) {
  const m = /^\/v1\/matches\/([0-9a-f-]{36})\/videos$/.exec(path);
  if (!m && path !== '/v1/videos/recent') return undefined;
  const kv = env?.TENNIS_STATE;
  if (!kv) return envelope(null, { freshness: 'NOT_CONFIGURED', semantics: 'video index not connected' });
  const idx = (await kv.get(KV_BY_MATCH, 'json')) || { matches: {} };
  const meta = { source_updated_at: idx.as_of || null, policy: { currentS: 3600, staleS: 6 * 3600 } };
  if (path === '/v1/videos/recent') {
    const cat = (await kv.get(KV_CATALOG, 'json')) || { videos: [] };
    const byId = new Map(cat.videos.map((v) => [v.video_id, v]));
    const out = {};
    for (const [mid, ids] of Object.entries(idx.matches || {})) {
      const vs = rank(ids.map((id) => byId.get(id)).filter((v) => v && RANK[v.video_type] && RANK[v.video_type] <= 4));
      if (vs.length) out[mid] = { best: vs[0].video_type, label: LABEL[vs[0].video_type], count: vs.length };
    }
    return envelope(out, { ...meta, semantics: 'matches with an official long-form video (best type first)' });
  }
  if (!UUID.test(m[1])) return null;
  const ids = idx.matches?.[m[1]] || [];
  if (!ids.length) return envelope([], { ...meta, semantics: 'no official video linked to this match yet (checked about every 30 minutes)' });
  const cat = (await kv.get(KV_CATALOG, 'json')) || { videos: [] };
  const byId = new Map(cat.videos.map((v) => [v.video_id, v]));
  const vs = rank(ids.map((id) => byId.get(id)).filter((v) => v && v.status === 'linked' && v.embeddable !== false && RANK[v.video_type] && RANK[v.video_type] <= 4));
  // one video per type and per id (a channel never duplicates; two channels may post the same match: keep both, ranked)
  const seen = new Set();
  const data = vs.filter((v) => (seen.has(v.video_id) ? false : seen.add(v.video_id))).slice(0, 4).map(pub);
  return envelope(data, { ...meta, semantics: 'official videos linked to this match, best first: full match replay > extended highlights > match highlights > interview' });
}
