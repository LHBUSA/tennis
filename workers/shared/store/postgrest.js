// Minimal PostgREST client for the SPORTS Supabase project. Worker-side only (service role).
// Env: TENNIS_MODEL_SUPABASE_URL + TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY (network DB-split naming).
// Refuses any host that is not the sports project, so a mis-set secret can never write tennis rows
// into the identity/billing database.

export const SPORTS_PROJECT_REF = 'tkmlnhmylqnttmnsnief';

export class StoreError extends Error {
  constructor(status, body, where) {
    super(`postgrest ${status} ${where}: ${String(body).slice(0, 300)}`);
    this.status = status;
  }
}

export function storeFromEnv(env, { fetch: f = (...a) => globalThis.fetch(...a) } = {}) {
  const url = env?.TENNIS_MODEL_SUPABASE_URL;
  const key = env?.TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!new URL(url).host.startsWith(`${SPORTS_PROJECT_REF}.`)) throw new Error('TENNIS_MODEL_SUPABASE_URL is not the sports project');
  return new Store(url, key, f);
}

export class Store {
  constructor(url, key, f) {
    this.base = `${url.replace(/\/+$/, '')}/rest/v1`;
    this.key = key;
    this.f = f; // always a plain function: Workers throw 'Illegal invocation' on a detached method call
    this.requests = 0;
  }

  headers(extra = {}) {
    return { apikey: this.key, authorization: `Bearer ${this.key}`, 'content-type': 'application/json', ...extra };
  }

  async req(method, path, { body, prefer } = {}) {
    this.requests += 1;
    const call = this.f;
    const res = await call(`${this.base}/${path}`, { method, headers: this.headers(prefer ? { prefer } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new StoreError(res.status, text, `${method} ${path.split('?')[0]}`);
    return text ? JSON.parse(text) : null;
  }

  /** Upsert in chunks. `onConflict` must name the real unique columns (PostgREST otherwise targets the PK). */
  async upsert(table, rows, { onConflict, ignore = false, returning = false, chunk = 500 } = {}) {
    if (!rows.length) return [];
    const out = [];
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows.slice(i, i + chunk);
      const q = onConflict ? `?on_conflict=${onConflict}` : '';
      const prefer = `resolution=${ignore ? 'ignore' : 'merge'}-duplicates,return=${returning ? 'representation' : 'minimal'}`;
      const r = await this.req('POST', `${table}${q}`, { body: part, prefer });
      if (returning && r) out.push(...r);
    }
    return out;
  }

  async insert(table, rows, { returning = false } = {}) {
    if (!rows.length) return [];
    return (await this.req('POST', table, { body: rows, prefer: `return=${returning ? 'representation' : 'minimal'}` })) || [];
  }

  /** GET with a raw PostgREST query string, e.g. select('tennis_matches', 'select=*&status=eq.in_progress'). */
  async select(table, query = 'select=*') {
    return (await this.req('GET', `${table}?${query}`)) || [];
  }

  async del(table, query) {
    return this.req('DELETE', `${table}?${query}`);
  }
}

/** PostgREST `in.(...)` list with quoting for text values. */
export const inList = (vals) => `in.(${vals.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(',')})`;
