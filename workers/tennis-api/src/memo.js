// Shared-result memo for expensive, build-versioned reads (2026-10-07, tkmln read relief).
//
// The Tennis DNA v1 gate + percentile population (v2.js tourDnaStatus / population / latestAsOfForGender) re-read every
// stored snapshot of a tour (metrics jsonb, TOASTed) on EVERY PBEcast miss and every /v1/players/:slug/dna view (a premium
// route, so never edge-cached): ~250k reads/day, the largest tkmln consumer after the 2026-10-07 index fixes. Their
// inputs change only when a DNA build (or retention) writes, so the result is memoised per isolate and in the colo's
// caches.default, keyed by the build version the ingest Worker already writes to TENNIS_STATE:
//   dna:last (v1 daily build day) | dna:v2:summary.built_at (every build, incl. forced re-runs) | dna:retention:day.
// Values are identical to an uncached read (the same function computes them); a new build changes the key.
// Pass-through (no memo) when the store carries no memo context: unit tests and the scheduled path.
// Only SETTLED values are shared inside the isolate (never an in-flight promise across requests).

const MAX_TTL_S = 6 * 3600; // safety cap even if the version keys were never to move
const VERSION_TTL_MS = 30e3; // how long one isolate trusts the build version it read
const local = new Map(); // key -> { exp, json }
let ver = { at: 0, v: null };

async function readVersion(kv) {
  const opt = { cacheTtl: 60 };
  const [last, summary, retention] = await Promise.all([
    kv.get('dna:last', opt),
    kv.get('dna:v2:summary', { ...opt, type: 'json' }),
    kv.get('dna:retention:day', opt)
  ]);
  return `${last || '-'}|${summary?.built_at || '-'}|${retention || '-'}`;
}

/** Build version of the stored DNA snapshots (per isolate for VERSION_TTL_MS); null when KV cannot be read. */
export async function dnaBuildVersion(kv, now = Date.now()) {
  if (ver.v && now - ver.at < VERSION_TTL_MS) return ver.v;
  try {
    const v = await readVersion(kv);
    ver = { at: Date.now(), v };
    return v;
  } catch {
    return null;
  }
}

/** Attach a memo context to a per-request store (tennis-api fetch path only). */
export function withMemo(store, env, ctx) {
  if (store && env?.TENNIS_STATE) store.memo = { kv: env.TENNIS_STATE, ctx: ctx || null };
  return store;
}

/**
 * dnaMemo(store, name, compute): compute()'s JSON-serialisable result, shared per DNA build version.
 * isolate map -> caches.default (per colo) -> compute() + fill both. Every caller gets its own parsed copy.
 */
export async function dnaMemo(store, name, compute) {
  const m = store?.memo;
  if (!m) return compute();
  const v = await dnaBuildVersion(m.kv);
  if (!v) return compute(); // version unreadable: behave exactly as before (no caching)
  const key = `${name}@${v}`;
  const now = Date.now();
  const hit = local.get(key);
  if (hit && hit.exp > now) return JSON.parse(hit.json);
  const cache = globalThis.caches?.default;
  const req = new Request(`https://tennis-api.propbetedge.ai/__memo/dna/${encodeURIComponent(name)}?v=${encodeURIComponent(v)}`);
  let json = null;
  if (cache) {
    const c = await cache.match(req).catch(() => null);
    if (c) json = await c.text().catch(() => null);
  }
  if (json == null) {
    json = JSON.stringify(await compute());
    if (cache) {
      const put = cache.put(req, new Response(json, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${MAX_TTL_S}` } })).catch(() => {});
      if (m.ctx?.waitUntil) m.ctx.waitUntil(put); else await put;
    }
  }
  if (local.size >= 200) for (const [k, x] of local) if (x.exp <= now || !k.endsWith(`@${v}`)) local.delete(k);
  local.set(key, { exp: now + MAX_TTL_S * 1000, json });
  return JSON.parse(json);
}

export function _resetMemoForTests() { local.clear(); ver = { at: 0, v: null }; }
