// Tour semantics for the newsroom — PURE. ATP and WTA are peers inside one tennis product: every tour-specific
// choice (ranking list, desk, provenance wording, enrichment fairness) is made here from the event type, the
// tournament and the stored source family, never from an assumption that a story is about the WTA.

export const SLAM_SLUGS = new Set(['australian-open', 'roland-garros', 'wimbledon', 'us-open']);

/** Ranking list that legitimately applies to an event type. Doubles lists only where we hold one (ESPN has no
 *  ATP doubles list: rankings/2 answers 404) — a singles list is never substituted for a doubles one. */
export const RANKING_LISTS = Object.freeze({ WS: 'wta_singles', MS: 'atp_singles', WD: 'wta_doubles', MD: null, XD: null });
export const LIST_LABEL = Object.freeze({ wta_singles: 'WTA singles', wta_doubles: 'WTA doubles', atp_singles: 'ATP singles' });
/** Ranking lists the milestone detector reads (one story per new list). */
export const MILESTONE_LISTS = Object.freeze(['wta_singles', 'atp_singles']);

// Source families that are the tour's or the tournament's own publication. ESPN is a SECONDARY source (owner
// decision 2026-09-27): its rows and lists are real data, but they are never described as official.
const OFFICIAL_MATCH = new Set(['wta', 'wta_history', 'ausopen', 'wimbledon', 'rolandgarros', 'usopen']);
const OFFICIAL_RANKING = new Set(['wta']);
const SOURCE_NAME = { espn: 'ESPN' };
// A list shorter than this is a top-N extract (ESPN publishes the top 100-150): "not in the list" means
// "outside the top N we hold", never "unranked".
const FULL_LIST_MIN_ROWS = 500;

export const tourOf = (eventType) => ({ MS: 'atp', MD: 'atp', WS: 'wta', WD: 'wta', XD: 'mixed' }[eventType] || null);
export const tourOfList = (list) => (String(list || '').startsWith('atp') ? 'atp' : String(list || '').startsWith('wta') ? 'wta' : null);

export function isSlam(t = {}) {
  return t.level === 'Grand Slam' || t.competition_key === 'grand_slam' || SLAM_SLUGS.has(t.slug);
}

/** Desk: a Grand Slam is one neutral umbrella over both tours; otherwise the tour (singles) or doubles. */
export function deskFor(eventType, t = {}) {
  if (isSlam(t)) return 'grand-slams';
  if (eventType === 'MS') return 'atp';
  if (eventType === 'WS') return 'wta';
  if (['MD', 'WD', 'XD'].includes(eventType)) return 'doubles';
  return null;
}

/** Provenance of one stored ranking list, with the wording prose must use for it. */
export function rankingProvenance(list, sourceFamily, depth = null) {
  const label = LIST_LABEL[list] || null;
  const official = OFFICIAL_RANKING.has(sourceFamily) && tourOfList(list) === sourceFamily;
  const truncated = Number.isFinite(depth) && depth > 0 && depth < FULL_LIST_MIN_ROWS;
  return {
    list, label, source_family: sourceFamily || null, classification: official ? 'official' : 'secondary', depth: Number.isFinite(depth) ? depth : null, truncated,
    // "the official WTA singles list" | "the ATP singles list in the PropBetEdge archive"
    phrase: official ? `the official ${label} list` : `the ${label} list in the PropBetEdge archive`,
    note: official
      ? `official ${label} list in force at the start of the tournament`
      : `${label} list in the PropBetEdge archive in force at the start of the tournament, from a secondary source (${SOURCE_NAME[sourceFamily] || String(sourceFamily || 'unknown').toUpperCase()})${truncated ? `; it holds the top ${depth} only` : ''}`
  };
}

/** Legacy frozen packets (before provenance was recorded) carried official WTA lists only. */
export function provenanceOf(packet) {
  if (packet.ranking_provenance) return packet.ranking_provenance;
  const list = packet.event?.facts?.list || ['A', 'B'].flatMap((s) => packet.participants?.[s]?.players || []).find((p) => p.rank?.list)?.rank.list || null;
  if (!list) return null;
  return rankingProvenance(list, tourOfList(list) === 'wta' ? 'wta' : 'espn');
}

export function matchSource(sourceFamily) {
  return { source_family: sourceFamily || null, classification: OFFICIAL_MATCH.has(sourceFamily) ? 'official' : 'secondary', name: SOURCE_NAME[sourceFamily] || String(sourceFamily || 'unknown').toUpperCase() };
}

/**
 * Tour-fair enrichment order. `rows` are claimable events already in the claim order (materiality desc,
 * detected_at asc). Slot 1 = highest materiality overall; then the best candidate of each tour (ATP / WTA) not yet
 * represented; then the next highest overall. No quota: a tour with no candidate is simply absent.
 */
export function pickFair(rows, limit, tourOfRow) {
  const out = [];
  const take = (r) => { if (r && !out.includes(r) && out.length < limit) out.push(r); };
  take(rows[0]);
  for (const tour of ['atp', 'wta']) if (!out.some((r) => tourOfRow(r) === tour)) take(rows.find((r) => tourOfRow(r) === tour));
  for (const r of rows) take(r);
  return out;
}
