// Player media queue (Newsroom V3 §21): players who need LEGITIMATE media discovery, durable in KV
// (TENNIS_STATE `media:queue`). Deterministic and pure except the two KV/store helpers at the bottom.
//
// Enqueued by: the newsroom (a detected event names a player without an approved photo), the coverage planner
// (current-event players, ATP/WTA top-100 gaps). Processed by scripts/media/queue.mjs with the existing pipeline
// rules ONLY: identity = the Wikidata item whose ATP/WTA id equals the player's founding tour id (exactly one item),
// its P18 image, Commons licence CC0/PD/CC BY/CC BY-SA, one dominant face, approved derivatives. Never an article
// image, never a guess.

export const QUEUE_KEY = 'media:queue';
export const QUEUE_VERSION = 1;
/** Lower = sooner. A news subject outranks a current-event player, who outranks a top-100 gap. */
export const PRIORITY = Object.freeze({ news: 1, current_event: 2, top100: 3 });
export const RETRY_DAYS = Object.freeze({ no_identity: 14, no_image: 14, license: 30, rejected: 30, error: 1 });
const MAX = 2000;

const day = 86400e3;
const iso = (t) => new Date(t).toISOString();

/** Merge enqueue requests [{ id, reason }] into the queue (no duplicates; reasons accumulate; priority = best). */
export function mergeQueue(queue = {}, items = [], now = Date.now()) {
  const q = { ...queue };
  for (const it of items) {
    if (!it?.id || !/^[0-9a-f-]{36}$/.test(it.id) || !PRIORITY[it.reason]) continue;
    const cur = q[it.id];
    const reasons = [...new Set([...(cur?.reasons || []), it.reason])].sort((a, b) => PRIORITY[a] - PRIORITY[b]);
    q[it.id] = { reasons, priority: PRIORITY[reasons[0]], first_seen: cur?.first_seen || iso(now), last_seen: iso(now), attempts: cur?.attempts || 0, last_result: cur?.last_result || null, retry_after: cur?.retry_after || null, name: it.name || cur?.name || null };
  }
  return trim(q);
}

/** Keep the queue bounded: the best MAX entries by order(). */
function trim(q) {
  const ids = Object.keys(q);
  if (ids.length <= MAX) return q;
  return Object.fromEntries(order(q).slice(0, MAX).map((x) => [x.id, q[x.id]]));
}

/** Deterministic processing order: priority, then oldest first_seen, then id. */
export function order(queue = {}) {
  return Object.entries(queue).map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => a.priority - b.priority || String(a.first_seen).localeCompare(String(b.first_seen)) || a.id.localeCompare(b.id));
}

/** Entries due now (never tried, or past retry_after). */
export function due(queue = {}, now = Date.now(), limit = 25) {
  return order(queue).filter((x) => !x.retry_after || Date.parse(x.retry_after) <= now).slice(0, limit);
}

/** Record a processing result. 'approved' removes the entry; a rejection is retried later (the image or item may change). */
export function markResult(queue = {}, id, result, now = Date.now()) {
  const q = { ...queue };
  if (!q[id]) return q;
  if (result === 'approved' || result === 'already_approved') { delete q[id]; return q; }
  const kind = /^no_identity|^ambiguous_identity/.test(result) ? 'no_identity' : /^no_image/.test(result) ? 'no_image' : /^license/.test(result) ? 'license' : /^error/.test(result) ? 'error' : 'rejected';
  q[id] = { ...q[id], attempts: (q[id].attempts || 0) + 1, last_result: result, retry_after: iso(now + RETRY_DAYS[kind] * day) };
  return q;
}

/**
 * Identity proof from Wikidata rows [{ item, atp, wta, img }] for founding key 'atp:F0F1' / 'wta:330332': exactly one
 * item carries that exact tour id (case-insensitive for ATP codes); its P18 files are the candidates.
 */
export function identityFromWikidata(rows = [], foundingKey = '') {
  const m = /^(atp|wta):(.+)$/.exec(foundingKey || '');
  if (!m) return { ok: false, reason: 'no_identity:no_tour_id' };
  const want = m[2].toUpperCase();
  const items = [...new Set(rows.filter((r) => String(r[m[1]] || '').toUpperCase() === want).map((r) => r.item))];
  if (!items.length) return { ok: false, reason: 'no_identity:no_wikidata_item_with_tour_id' };
  if (items.length > 1) return { ok: false, reason: `ambiguous_identity:${items.length}_items` };
  const files = [...new Set(rows.filter((r) => r.item === items[0] && r.img).map((r) => r.img))].sort();
  if (!files.length) return { ok: false, reason: 'no_image:no_p18', item: items[0] };
  return { ok: true, item: items[0], files, evidence: [`wikidata:${items[0]} lists ${m[1]}:${m[2]}`] };
}

// ---- runtime helpers (tennis-news hook) -------------------------------------------------------------------
/**
 * Newsroom hook: enqueue the event's players that have no approved photo. Safe to call per detection run with every
 * candidate's player ids; failures never break detection (the caller should `.catch(() => {})`).
 *   await enqueueMissingPhotos(env.TENNIS_STATE, store, playerIds, 'news')
 */
export async function enqueueMissingPhotos(kv, store, playerIds = [], reason = 'news', now = Date.now()) {
  const ids = [...new Set(playerIds.filter((x) => /^[0-9a-f-]{36}$/.test(String(x))))];
  if (!kv || !store || !ids.length) return 0;
  const have = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await store.select('tennis_player_media', `select=pbe_player_id&approval=eq.approved&pbe_player_id=in.(${ids.slice(i, i + 100).join(',')})`);
    for (const r of rows) have.add(r.pbe_player_id);
  }
  const missing = ids.filter((id) => !have.has(id));
  if (!missing.length) return 0;
  const q = (await kv.get(QUEUE_KEY, 'json')) || {};
  const before = Object.keys(q).length;
  const next = mergeQueue(q, missing.map((id) => ({ id, reason })), now);
  await kv.put(QUEUE_KEY, JSON.stringify(next));
  return Object.keys(next).length - before;
}
