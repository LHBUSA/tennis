// HTTP transport contract for responses that reach readers through Vercel's external rewrites.
//
// Vercel caches these responses under a key that ignores Accept-Encoding, and this Worker sends no
// Vary. Without no-transform, Cloudflare compresses each response for the client that happened to
// fill Vercel's cache (zstd for Chrome), and Vercel then replays those bytes to every client, so a
// gzip-only crawler got zstd. With no-transform, Cloudflare returns identity bytes, Vercel caches
// one uncompressed representation and negotiates gzip/br per client at its edge (the behavior
// golf-api already has in production).

/** The same response with `no-transform` added to its Cache-Control (idempotent). */
export function noTransform(res) {
  const cc = res.headers.get('cache-control') || '';
  if (/(^|[\s,])no-transform([\s,]|$)/i.test(cc)) return res;
  const headers = new Headers(res.headers);
  headers.set('cache-control', cc ? `${cc}, no-transform` : 'no-transform');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
