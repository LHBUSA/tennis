// Superseded match rows (migration 20260929000100): a duplicate row that could not be deleted is kept as a tombstone
// (status 'superseded', superseded_by = the surviving row). Readers that serve a match by id expose the tombstone's
// pointer and the resolved canonical survivor so tennis-web can 301 the old URL (2026-10-07, China Open WS orphans).
// The chain is followed at most MAX_HOPS rows and never through a repeat; a missing, looping or still-superseded end
// resolves to null (no guess: the page renders a noindex "Superseded match record" state instead).

const MAX_HOPS = 4;

/** { superseded_by, canonical_match_id } for a superseded row id; {} for any other status. */
export async function supersession(store, id, status) {
  if (status !== 'superseded') return {};
  const seen = new Set([id]);
  let cur = id;
  let first = null;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const [r] = await store.select('tennis_matches', `select=match_id,status,superseded_by&match_id=eq.${cur}`);
    if (!r) return { superseded_by: first, canonical_match_id: null };
    if (hop === 0) first = r.superseded_by || null;
    if (r.status !== 'superseded') return { superseded_by: first, canonical_match_id: r.match_id };
    if (!r.superseded_by || seen.has(r.superseded_by)) return { superseded_by: first, canonical_match_id: null };
    seen.add(r.superseded_by);
    cur = r.superseded_by;
  }
  // the last hop may still be the survivor
  const [r] = await store.select('tennis_matches', `select=match_id,status&match_id=eq.${cur}`);
  return { superseded_by: first, canonical_match_id: r && r.status !== 'superseded' ? r.match_id : null };
}
