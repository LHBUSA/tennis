// Central tennis-api client. The browser talks ONLY to tennis-api (our Worker) — never to a provider,
// never to Supabase. When the API base is not configured for this build, every read resolves to a
// NOT_CONFIGURED envelope without a network call, and pages render that truthfully.

const BASE = (import.meta.env?.VITE_TENNIS_API_BASE || '').replace(/\/+$/, '') || null;

export const apiConfigured = () => !!BASE;
export const LIVE_PATH = /^\/v1\/(live|today|pbecast\/|matches\/)/;

function local(freshness, semantics, degraded = []) {
  return { ok: false, data: null, meta: { source: [], fetched_at: new Date().toISOString(), source_updated_at: null, age_s: null, freshness, semantics, degraded } };
}

export async function api(path, { signal } = {}) {
  if (!BASE) return local('NOT_CONFIGURED', 'tennis-api is not connected to this build');
  try {
    // live-sensitive reads never come from the browser HTTP cache (a stale header must never freeze a live page);
    // the API's edge cache still absorbs the load
    const res = await fetch(`${BASE}${path}`, { signal, credentials: 'include', headers: { accept: 'application/json' }, ...(LIVE_PATH.test(path) ? { cache: 'no-store' } : {}) });
    const body = await res.json();
    if (!body || typeof body !== 'object' || !body.meta) return local('ERROR', 'unexpected response shape');
    return body;
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return local('UNAVAILABLE', 'tennis-api did not respond', [String(err?.message || err)]);
  }
}


export async function membershipApi({ signal } = {}) {
  if (!BASE) return null;
  try {
    const res = await fetch(`${BASE}/v1/membership`, {
      signal, credentials: 'include', cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    return await res.json();
  } catch {
    return null;
  }
}

/** The membership read with its HTTP status, for the account surface: status 0 = no answer
 *  (network failure or the timeout), so an outage is never mistaken for a free reader. */
export async function membershipResult({ timeoutMs = 0 } = {}) {
  if (!BASE) return { status: 0, body: null };
  const ctl = timeoutMs ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${BASE}/v1/membership`, {
      credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' },
      ...(ctl ? { signal: ctl.signal } : {}),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function requestMagic(email, returnTo, { signal } = {}) {
  if (!BASE) return { ok: false, message: 'Sign-in is not connected to this build.' };
  try {
    const res = await fetch(`${BASE}/v1/magic/request`, {
      method: 'POST', signal, credentials: 'include', cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ email, return_to: returnTo }),
    });
    return await res.json();
  } catch {
    return { ok: false, message: 'Could not reach sign-in. Please try again.' };
  }
}
