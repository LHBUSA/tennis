// The one response envelope for every tennis-api / worker read. docs/API.md.
// Every response that depends on outside data carries provenance + freshness.

export const FRESHNESS = Object.freeze(['CURRENT', 'CACHED', 'STALE', 'UNAVAILABLE', 'ERROR', 'NOT_CONFIGURED']);

/**
 * Classify freshness from the age of the underlying source data.
 * `currentS` = max age still CURRENT, `staleS` = age at/after which data is STALE (CACHED between).
 */
export function classifyFreshness(ageS, { currentS, staleS }) {
  if (ageS == null || !Number.isFinite(ageS)) return 'UNAVAILABLE';
  if (ageS <= currentS) return 'CURRENT';
  if (ageS < staleS) return 'CACHED';
  return 'STALE';
}

export function envelope(data, meta = {}, now = Date.now()) {
  const sourceUpdated = meta.source_updated_at || null;
  const ageS = sourceUpdated ? Math.max(0, Math.round((now - Date.parse(sourceUpdated)) / 1000)) : null;
  const freshness = meta.freshness || (meta.policy ? classifyFreshness(ageS, meta.policy) : ageS === null ? 'UNAVAILABLE' : 'CURRENT');
  if (!FRESHNESS.includes(freshness)) throw new Error(`invalid freshness ${freshness}`);
  return {
    ok: freshness !== 'ERROR',
    data: data ?? null,
    meta: {
      source: meta.source || [],
      fetched_at: meta.fetched_at || new Date(now).toISOString(),
      source_updated_at: sourceUpdated,
      age_s: ageS,
      freshness,
      semantics: meta.semantics || '',
      degraded: meta.degraded || []
    }
  };
}

/** A route whose backing source/storage is not wired yet. Truthful, never a fake payload. */
export function notConfigured(semantics, detail = []) {
  return envelope(null, { freshness: 'NOT_CONFIGURED', semantics, degraded: detail });
}

export function unavailable(semantics, detail = []) {
  return envelope(null, { freshness: 'UNAVAILABLE', semantics, degraded: detail });
}

export function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
      ...headers
    }
  });
}
