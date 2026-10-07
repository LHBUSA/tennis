// In-memory stand-in for workers/shared/store/postgrest.js (tests only). Implements the PostgREST query
// subset the ingest writers use: eq / neq / in / is.null / not.is.null / like / gt / gte / lt / lte filters,
// limit / offset / order, one-level embeds joined on match_id (embedded filters + !inner applied before paging), upsert with on_conflict (merge or ignore),
// PATCH / DELETE through req(), exact count. Unique constraints listed below raise 409 like Postgres would.

const PK = {
  tennis_matches: ['match_id'], tennis_sets: ['match_id', 'set_no'], tennis_match_participants: ['match_id', 'side'],
  tennis_match_external_ids: ['provider', 'external_id'], tennis_players: ['pbe_player_id'], tennis_player_external_ids: ['provider', 'external_id'],
  tennis_participants: ['participant_key'], tennis_participant_members: ['participant_key', 'slot'], tennis_tournaments: ['tournament_id'],
  tennis_tournament_editions: ['edition_id'], tennis_draws: ['draw_id'], tennis_ingest_holds: ['provider', 'entity_type', 'external_id'],
  tennis_identity_queue: ['provider', 'external_id'], tennis_ranking_snapshots: ['snapshot_id'], tennis_rankings: ['snapshot_id', 'provider_player_id'],
  tennis_tournament_external_ids: ['provider', 'external_id'], tennis_edition_external_ids: ['provider', 'external_id'], tennis_match_events: ['event_id']
};
const UNIQUE = {
  tennis_match_participants: [['match_id', 'participant_key']], tennis_tournaments: [['slug']], tennis_players: [['founding_external_key']],
  tennis_ranking_snapshots: [['list_key', 'ranking_date']], tennis_tournament_editions: [['tournament_id', 'year']],
  // migration 20260928000200: partial unique index (rows without a natural_key are not constrained)
  tennis_matches: [['edition_id', 'natural_key']]
};

const DEFAULTS = { tennis_matches: { stats_status: 'pending' }, tennis_players: { status: 'active' } };
const unq = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v);
function parseList(v) {
  const inner = v.slice(1, -1);
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '"' && inner[i - 1] !== '\\') { q = !q; cur += ch; continue; }
    if (ch === ',' && !q) { out.push(unq(cur)); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(unq(cur));
  return out;
}
const likeRe = (p) => new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

function opTest(part, v) {
  const [op, ...rest] = v.split('.');
  const val = rest.join('.');
  const f = {
    eq: (x) => String(x) === val, neq: (x) => String(x) !== val, gt: (x) => x > coerce(val, x), gte: (x) => x >= coerce(val, x), lt: (x) => x < coerce(val, x), lte: (x) => x <= coerce(val, x),
    in: (x) => parseList(val).includes(String(x)), like: (x) => x != null && likeRe(val).test(String(x)),
    is: (x) => (val === 'null' ? x == null : String(x) === val), not: (x) => (val === 'is.null' ? x != null : true)
  }[op];
  if (!f) throw new Error(`memstore: unsupported filter ${part}`);
  return f;
}

// Embedded resources (joined on match_id, one level): `embed.col=op.val` filters the embedded rows; an embed written
// `embed!inner(...)` drops parent rows that have no embedded row left. Both apply BEFORE order / offset / limit,
// as in PostgREST.
function matcher(query) {
  const tests = [];
  const opts = { limit: Infinity, offset: 0, order: null, embeds: [], inner: new Set(), embedTests: {} };
  for (const part of String(query || '').split('&').filter(Boolean)) {
    const i = part.indexOf('=');
    const k = decodeURIComponent(part.slice(0, i));
    const v = decodeURIComponent(part.slice(i + 1));
    if (k === 'select') {
      // json path projections (`alias:col->key`): only then is the select list applied to the returned rows
      if (v.includes('->')) opts.project = v.split(',').map((c) => /^(\w+):(\w+)->(\w+)$/.exec(c) || c);
      opts.embeds = [...v.matchAll(/(\w+)(?:!inner)?\(/g)].map((m) => m[1]);
      for (const m of v.matchAll(/(\w+)!inner\(/g)) opts.inner.add(m[1]);
      continue;
    }
    if (k === 'limit') { opts.limit = Number(v); continue; }
    if (k === 'offset') { opts.offset = Number(v); continue; }
    if (k === 'order') { opts.order = v; continue; }
    if (k.includes('.')) {
      const [embed, col] = k.split('.');
      const f = opTest(part, v);
      (opts.embedTests[embed] ||= []).push((row) => f(row[col]));
      continue;
    }
    const f = opTest(part, v);
    tests.push((row) => f(row[k]));
  }
  return { test: (row) => tests.every((t) => t(row)), opts };
}
const coerce = (val, x) => (typeof x === 'number' ? Number(val) : val);

export class MemStore {
  constructor() { this.t = new Map(); this.requests = 0; this.log = []; }
  rows(table) { if (!this.t.has(table)) this.t.set(table, []); return this.t.get(table); }
  key(table, row, cols) { return (cols || PK[table] || Object.keys(row)).map((c) => String(row[c])).join('|'); }
  checkUnique(table, row, self) {
    for (const cols of UNIQUE[table] || []) {
      if (cols.some((c) => row[c] == null)) continue; // NULLs never collide (partial / nullable unique indexes)
      const k = this.key(table, row, cols);
      const other = this.rows(table).find((r) => r !== self && this.key(table, r, cols) === k);
      if (other) { const e = new Error(`postgrest 409 duplicate key ${table}(${cols})`); e.status = 409; throw e; }
    }
  }
  async select(table, query = 'select=*') {
    this.requests += 1;
    this.log.push(['GET', table, query]);
    const { test, opts } = matcher(query);
    let out = this.rows(table).filter(test).map((r) => ({ ...r }));
    for (const e of opts.embeds) {
      const et = opts.embedTests[e] || [];
      for (const r of out) r[e] = this.rows(e).filter((x) => x.match_id === r.match_id && et.every((t) => t(x))).map((x) => ({ ...x }));
      if (opts.inner.has(e)) out = out.filter((r) => r[e].length);
    }
    if (opts.order) { const [col, dir] = opts.order.split(',')[0].split('.'); out.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
    out = out.slice(opts.offset, opts.offset + opts.limit);
    if (opts.project) out = out.map((r) => Object.fromEntries(opts.project.map((c) => (Array.isArray(c) ? [c[1], r[c[2]]?.[c[3]] ?? null] : [c, r[c]]))));
    return out;
  }
  async upsert(table, rows, { onConflict, ignore = false } = {}) {
    this.requests += 1;
    this.log.push(['UPSERT', table, rows.length]);
    const cols = onConflict ? onConflict.split(',') : PK[table];
    const list = this.rows(table);
    for (const row of rows) {
      const k = this.key(table, row, cols);
      const hit = list.find((r) => this.key(table, r, cols) === k);
      if (hit) { if (!ignore) { const next = { ...hit, ...row }; this.checkUnique(table, next, hit); Object.assign(hit, row); } continue; }
      this.checkUnique(table, row, null);
      list.push({ ...(DEFAULTS[table] || {}), ...row });
    }
    return [];
  }
  async insert(table, rows) { this.requests += 1; this.rows(table).push(...rows.map((r) => ({ ...r }))); return []; }
  async del(table, query) { this.requests += 1; const { test } = matcher(query); this.t.set(table, this.rows(table).filter((r) => !test(r))); return null; }
  async count(table, query = '') { return (await this.select(table, query)).length; }
  async req(method, path, { body } = {}) {
    const [table, query = ''] = path.split('?');
    if (method === 'GET') return this.select(table, query);
    if (method === 'DELETE') return this.del(table, query);
    if (method === 'POST') return this.insert(table, Array.isArray(body) ? body : [body]);
    if (method === 'PATCH') { this.requests += 1; const { test } = matcher(query); for (const r of this.rows(table).filter(test)) Object.assign(r, body); return null; }
    throw new Error(`memstore: ${method}`);
  }
}

export class MemKV {
  constructor() { this.m = new Map(); }
  // type as a string or as the Workers options object ({ type, cacheTtl })
  async get(k, type) { const t = typeof type === 'object' && type ? type.type : type; const v = this.m.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, typeof v === 'string' ? v : String(v)); }
  async delete(k) { this.m.delete(k); }
}

/** A SourceClient stand-in: routes URLs to bodies ({ __status } = an HTTP error); `blocked` URLs throw the polite client's block error. */
export function fakeClient(routes, { blocked = [] } = {}) {
  const calls = [];
  return {
    calls,
    stats: {},
    async get(url) {
      calls.push(url);
      if (blocked.some((re) => re.test(url))) { const e = new Error(`blocked 403 challenge ${url}`); e.code = 'source_blocked'; e.status = 403; throw e; }
      for (const [re, body] of routes) {
        if (re.test(url)) {
          const b = typeof body === 'function' ? body(url) : body;
          if (b && b.__status) return { url, ok: false, status: b.__status, body: b.body || '', bytes: 0, latency_ms: 1, fetched_at: new Date().toISOString(), content_type: 'application/json' };
          const text = typeof b === 'string' ? b : JSON.stringify(b);
          return { url, ok: true, status: 200, body: text, bytes: text.length, latency_ms: 1, fetched_at: new Date().toISOString(), content_type: 'application/json' };
        }
      }
      return { url, ok: false, status: 404, body: '{"error":{"code":404}}', bytes: 0, latency_ms: 1, fetched_at: new Date().toISOString(), content_type: 'application/json' };
    }
  };
}
