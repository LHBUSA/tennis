// FROZEN PRE-MATCH MATCHUP SNAPSHOTS (matchup-freeze/1). An upcoming match's dossier is frozen into an IMMUTABLE,
// write-once object while the match is still SCHEDULED (so it can never contain the match's own result: the DNA build
// counts completed matches only). Once the match is live or finished, readers serve the latest pre-play snapshot —
// never a recomputation with today's ratings. No snapshot frozen before play -> 'pre_match_snapshot_unavailable'.
//
// Storage: R2 (bucket tennis-source) — intel/matchup-prematch/<match_id>/<frozen_at>_<as_of>_<matchup_version>_<hash12>.json
// A key is never overwritten (head check before put); a new DNA build day or a corrected payload is a NEW object with
// its own frozen_at and content_hash (revisions are explicit, never a silent overwrite).

export const FREEZE_VERSION = 'matchup-freeze/1';
export const PREFIX = 'intel/matchup-prematch/';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** Stable JSON (sorted keys) so the same content always hashes the same. */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export async function contentHash(v) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(v)))); }

const keyOf = (id, frozenAt, asOf, version, hash) => `${PREFIX}${id}/${frozenAt}_${asOf || 'none'}_${version}_${hash.slice(0, 12)}.json`;
export const parseKey = (key) => { const m = /\/([^/_]+)_([^_]+)_([^_]+)_([0-9a-f]{12})\.json$/.exec(key); return m ? { key, frozen_at: m[1], as_of: m[2], matchup_version: m[3], hash12: m[4] } : null; };

/** Every frozen snapshot key of one match, oldest first (frozen_at is an ISO time: lexical = chronological). */
export async function listSnapshots(bucket, id) {
  const out = [];
  let cursor;
  do {
    const r = await bucket.list({ prefix: `${PREFIX}${id}/`, cursor, limit: 1000 });
    for (const o of r.objects || []) { const k = parseKey(o.key); if (k) out.push(k); }
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out.sort((a, b) => (a.frozen_at < b.frozen_at ? -1 : 1));
}

/**
 * Freeze one dossier payload (the /v1/matchups/:id `data`) while the match is scheduled. Write-once: skipped when a
 * snapshot for the same DNA as_of + matchup version already exists, or when the content is unchanged.
 * Returns { written, key, reason }.
 */
export async function freezeOne(bucket, data, { now = new Date().toISOString() } = {}) {
  const m = data?.match;
  if (!m?.id) return { written: false, reason: 'no_match' };
  if (m.status !== 'scheduled' || !['upcoming', 'upcoming_day'].includes(data.fixture)) return { written: false, reason: `not_pre_play:${m.status}/${data.fixture}` };
  if (m.scheduled_at && Date.parse(now) >= Date.parse(m.scheduled_at) + 6 * 3600e3) return { written: false, reason: 'stale_fixture' };
  const existing = await listSnapshots(bucket, m.id);
  if (existing.some((s) => s.as_of === String(data.as_of || 'none') && s.matchup_version === data.matchup_version)) return { written: false, reason: 'already_frozen_for_as_of' };
  const hash = await contentHash(data);
  if (existing.some((s) => s.hash12 === hash.slice(0, 12))) return { written: false, reason: 'content_unchanged' };
  const key = keyOf(m.id, now, data.as_of, data.matchup_version, hash);
  if (await bucket.head(key)) return { written: false, reason: 'exists' }; // immutable: never overwrite
  const snapshot = {
    snapshot_kind: 'pre_match', freeze_version: FREEZE_VERSION, match_id: m.id, frozen_at: now, frozen_status: m.status,
    scheduled_at: m.scheduled_at || null, content_hash: hash, dna_as_of: data.as_of || null, matchup_version: data.matchup_version,
    model_version: data.model?.model ? `${data.model.model.name} method v${data.model.model.method_version}${data.model.model.variant ? ` (${data.model.model.variant})` : ''}` : null,
    intel_version: data.intel?.edge_map_version || null, payload: data
  };
  await bucket.put(key, JSON.stringify(snapshot), { httpMetadata: { contentType: 'application/json' }, customMetadata: { content_hash: hash, frozen_at: now } });
  return { written: true, key, content_hash: hash };
}

/**
 * The authoritative pre-match snapshot: the LATEST one frozen before play. Every stored snapshot was written while the
 * match was still scheduled (freezeOne refuses anything else; frozen_status is re-checked here), so none can contain the
 * match's own result. A start later than the scheduled time is normal in tennis and does not invalidate a snapshot.
 */
export async function preMatchSnapshot(bucket, id) {
  const all = await listSnapshots(bucket, id);
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const obj = await bucket.get(all[i].key);
    if (!obj) continue;
    const snap = JSON.parse(await obj.text());
    if (snap.snapshot_kind === 'pre_match' && snap.frozen_status === 'scheduled') return { ...snap, key: all[i].key, revisions: all.length };
  }
  return null;
}

/**
 * The latest pre-match snapshot frozen AT OR BEFORE time T (the Picker lock). Never a later one: a decision at T may only
 * use evidence that existed at T.
 */
export async function snapshotAtOrBefore(bucket, id, T) {
  const all = await listSnapshots(bucket, id);
  const t = Date.parse(T);
  for (let i = all.length - 1; i >= 0; i -= 1) {
    if (Date.parse(all[i].frozen_at) > t) continue;
    const obj = await bucket.get(all[i].key);
    if (!obj) continue;
    const snap = JSON.parse(await obj.text());
    if (snap.snapshot_kind === 'pre_match' && snap.frozen_status === 'scheduled' && Date.parse(snap.frozen_at) <= t) return { ...snap, key: all[i].key };
  }
  return null;
}

/**
 * What /v1/matchups/:id serves. data = the freshly computed dossier for the CURRENT state.
 *  - upcoming: the live computation, plus the latest frozen snapshot's metadata (or "not frozen yet")
 *  - live / finished / stale: the latest PRE-PLAY snapshot's payload, untouched (no recomputation with today's
 *    ratings), with the current match status alongside; none -> 'pre_match_snapshot_unavailable' and the current
 *    computation's probability withheld (present-day context stays, labelled as current)
 */
export async function applyPreMatch(bucket, data) {
  if (!bucket || !data?.match?.id) return data;
  const id = data.match.id;
  if (data.fixture === 'upcoming' || data.fixture === 'upcoming_day') {
    const latest = (await listSnapshots(bucket, id)).at(-1);
    return { ...data, pre_match: latest ? { frozen: true, frozen_at: latest.frozen_at, dna_as_of: latest.as_of, hash12: latest.hash12, note: 'this dossier is re-frozen automatically while the match is scheduled; the last pre-play snapshot becomes the permanent record' } : { frozen: false, note: 'not frozen yet: snapshots are taken automatically while the match is scheduled' } };
  }
  const snap = await preMatchSnapshot(bucket, id);
  if (snap) {
    return { ...snap.payload, pre_match: { frozen: true, frozen_at: snap.frozen_at, content_hash: snap.content_hash, dna_as_of: snap.dna_as_of, model_version: snap.model_version, intel_version: snap.intel_version, matchup_version: snap.matchup_version, revisions: snap.revisions, freeze_version: snap.freeze_version, note: 'pre-match view exactly as frozen before play; nothing below was recomputed with later data' }, current: { status: data.match.status, fixture: data.fixture, score: data.match.score ?? null, winner_side: data.match.winner_side ?? null } };
  }
  const model = { ...(data.model || {}), status: 'pre_match_snapshot_unavailable', probability: null, reason: 'no pre-match snapshot was frozen before play, and a pre-match view is never reconstructed afterwards' };
  return { ...data, model, intel: data.intel ? { ...data.intel, why: null } : data.intel, pre_match: { frozen: false, status: 'pre_match_snapshot_unavailable' }, context_basis: 'current: present-day DNA and context, not a pre-match view' };
}
