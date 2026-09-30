// Central tennis-api client. The browser talks ONLY to tennis-api (our Worker) — never to a provider,
// never to Supabase. When the API base is not configured for this build, every read resolves to a
// NOT_CONFIGURED envelope without a network call, and pages render that truthfully.

const BASE = (import.meta.env?.VITE_TENNIS_API_BASE || '').replace(/\/+$/, '') || null;

export const apiConfigured = () => !!BASE;

function local(freshness, semantics, degraded = []) {
  return { ok: false, data: null, meta: { source: [], fetched_at: new Date().toISOString(), source_updated_at: null, age_s: null, freshness, semantics, degraded } };
}

export async function api(path, { signal } = {}) {
  if (!BASE) return local('NOT_CONFIGURED', 'tennis-api is not connected to this build');
  try {
    const res = await fetch(`${BASE}${path}`, { signal, credentials: 'include', headers: { accept: 'application/json' } });
    const body = await res.json();
    if (!body || typeof body !== 'object' || !body.meta) return local('ERROR', 'unexpected response shape');
    return body;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return local('UNAVAILABLE', 'tennis-api did not respond', [String(err?.message || err)]);
  }
}
