// YouTube (keyless) — official channels' public Atom feeds + oEmbed embeddability. Owner decision: never the Data API,
// never a key. Every request goes through the shared polite client (workers/shared/http.js) and is archived.
//   feed:   https://www.youtube.com/feeds/videos.xml?channel_id=<UC…>   (the channel's ~15 newest uploads)
//   oembed: https://www.youtube.com/oembed?format=json&url=<watch url>   (200 embeddable, 401/403 not, 400/404 gone)

export const YOUTUBE_HOST = 'www.youtube.com';
export const YOUTUBE_POLICY = Object.freeze({ min_interval_ms: 1500, max_concurrency: 1, jitter_ms: 300, retries: 1, backoff_ms: 4000, timeout_ms: 20000 });
const PARSER = 'tennis-youtube-feed/1.0.0';
const dec = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Atom feed -> { feed_title, channel_id, entries[] } (entries: video_id, channel_id, title, published_at, thumbnail, is_short). */
export function parseFeed(xml) {
  const s = String(xml || '');
  const head = s.split('<entry>')[0];
  const feed_title = dec((head.match(/<title>([^<]*)<\/title>/) || [])[1] || '') || null;
  // the feed HEADER prints the channel id without its "UC" prefix (entries carry the full id) — observed 2026-10-03
  const rawId = (head.match(/<yt:channelId>([^<]+)<\/yt:channelId>/) || [])[1] || null;
  const channel_id = rawId ? (rawId.startsWith('UC') ? rawId : `UC${rawId}`) : null;
  const entries = [...s.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1];
    const g = (re) => (e.match(re) || [])[1] || null;
    const link = g(/<link rel="alternate" href="([^"]+)"/);
    return { video_id: g(/<yt:videoId>([^<]+)<\/yt:videoId>/), channel_id: g(/<yt:channelId>([^<]+)<\/yt:channelId>/), title: dec(g(/<title>([^<]*)<\/title>/)), published_at: g(/<published>([^<]+)<\/published>/), thumbnail: g(/<media:thumbnail url="([^"]+)"/), is_short: /\/shorts\//.test(link || '') };
  }).filter((v) => v.video_id && /^[\w-]{11}$/.test(v.video_id));
  return { feed_title, channel_id, entries };
}

export const youtubeFeed = {
  key: 'youtube.feed', family: 'youtube', capabilities: ['official_video'], parser_version: PARSER, cadence: { class: 'periodic', idle_s: 1800 },
  request: ({ channelId }) => ({ url: `https://${YOUTUBE_HOST}/feeds/videos.xml?channel_id=${channelId}`, headers: { accept: 'application/atom+xml' } }),
  shape: (body) => (/<feed[\s>]/.test(String(body || '')) ? [] : ['not_atom']),
  parse: (body) => [parseFeed(body)]
};

export const youtubeOembed = {
  key: 'youtube.oembed', family: 'youtube', capabilities: ['official_video'], parser_version: PARSER, cadence: { class: 'on_link' },
  request: ({ videoId }) => ({ url: `https://${YOUTUBE_HOST}/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, headers: { accept: 'application/json' } }),
  shape: (body) => { try { return JSON.parse(body)?.html ? [] : ['no_html']; } catch { return ['not_json']; } },
  parse: () => [{ embeddable: true }]
};
