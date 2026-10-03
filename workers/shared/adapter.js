// Provider adapter contract. docs/ARCHITECTURE.md §Adapters.
//
// Every upstream source (ATP, WTA, ITF, each Slam, Wikidata …) is an adapter object:
//
//   {
//     key: 'wta.rankings.singles',         // unique, <family>.<capability-ish>
//     family: 'wta',                        // R2 family + source_family on every record
//     capabilities: ['rankings_singles'],   // from CAPABILITIES
//     parser_version: '1',
//     cadence: { class: 'weekly', min_interval_s: 21600 },
//     request(params) -> { url, headers? }  // what to fetch (pure)
//     parse(body, meta) -> SourceRecord[]   // provider shape -> provider-neutral source records (pure)
//     shape(body) -> string[]               // parser-shape monitor: [] when the payload looks as expected
//   }
//
// Provider weirdness stops here: parse() emits provider-neutral SourceRecords with provider ids kept as
// external ids. Identity resolution + canonical writes happen downstream, never inside an adapter.

export const CAPABILITIES = Object.freeze([
  'calendar', 'draws', 'schedule', 'live_state', 'point_by_point', 'set_game_scoring', 'serve_stats', 'return_stats',
  'match_stats', 'player_identity', 'player_bio', 'rankings_singles', 'rankings_doubles', 'race', 'match_history', 'h2h',
  'withdrawals_ret_wo', 'qualifying', 'doubles', 'mixed', 'odds', 'news', 'history', 'player_media', 'official_video'
]);

export const VERDICTS = Object.freeze(['PASS', 'DEGRADED', 'NOT_AVAILABLE', 'BLOCKED_BY_ACCESS_CONTROL', 'UNVERIFIED', 'COMMERCIAL_REFERENCE_ONLY']);

export function validateAdapter(a) {
  const errors = [];
  for (const k of ['key', 'family', 'parser_version']) if (!a[k]) errors.push(`missing ${k}`);
  for (const k of ['request', 'parse', 'shape']) if (typeof a[k] !== 'function') errors.push(`missing fn ${k}`);
  for (const c of a.capabilities || []) if (!CAPABILITIES.includes(c)) errors.push(`unknown capability ${c}`);
  if (!a.capabilities?.length) errors.push('no capabilities');
  return errors;
}

/**
 * Run one adapter end to end through the polite client. Never throws: every failure becomes a
 * result state so one broken source can never take down another.
 */
export async function runAdapter(adapter, { client, params = {}, archive = null }) {
  const started = Date.now();
  const base = { key: adapter.key, family: adapter.family, parser_version: adapter.parser_version };
  let req;
  try {
    req = adapter.request(params);
    const res = await client.get(req.url, { headers: req.headers || {} });
    const capture = archive ? await archive({ adapter, result: res }) : null;
    if (!res.ok) return { ...base, state: 'DEGRADED', url: req.url, http_status: res.status, error: `http_${res.status}`, capture, ms: Date.now() - started };
    const drift = adapter.shape(res.body, res);
    if (drift.length) return { ...base, state: 'DEGRADED', url: req.url, http_status: res.status, error: 'shape_drift', drift, bytes: res.bytes, capture, ms: Date.now() - started };
    const records = adapter.parse(res.body, { url: req.url, fetched_at: res.fetched_at, params });
    return { ...base, state: records.length ? 'PASS' : 'DEGRADED', url: req.url, http_status: res.status, records, record_count: records.length, bytes: res.bytes, latency_ms: res.latency_ms, not_modified: res.not_modified, capture, ms: Date.now() - started, ...(records.length ? {} : { error: 'zero_records' }) };
  } catch (err) {
    const blocked = err?.code === 'source_blocked';
    return { ...base, state: blocked ? 'BLOCKED_BY_ACCESS_CONTROL' : 'ERROR', url: req?.url || null, http_status: err?.status ?? null, error: String(err?.message || err).slice(0, 300), ms: Date.now() - started };
  }
}

/** Run many adapters with isolation: allSettled + a hard per-adapter timeout. */
export async function runIsolated(adapters, ctx, { timeoutMs = 60000 } = {}) {
  const runs = adapters.map((a) => {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ key: a.key, family: a.family, state: 'ERROR', error: 'adapter_timeout' }), timeoutMs); });
    return Promise.race([runAdapter(a, ctx), timeout]).finally(() => clearTimeout(timer));
  });
  const settled = await Promise.allSettled(runs);
  return settled.map((s, i) => (s.status === 'fulfilled' ? s.value : { key: adapters[i].key, family: adapters[i].family, state: 'ERROR', error: String(s.reason) }));
}

/** Shape helper: dotted-path presence checks, e.g. requirePaths(obj, ['content.0.player.id']). */
export function requirePaths(obj, paths) {
  const missing = [];
  for (const p of paths) {
    let cur = obj;
    for (const seg of p.split('.')) cur = cur == null ? undefined : cur[/^\d+$/.test(seg) ? Number(seg) : seg];
    if (cur === undefined || cur === null) missing.push(p);
  }
  return missing;
}

export function safeJson(body) {
  try { return JSON.parse(body); } catch { return undefined; }
}
