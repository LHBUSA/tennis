// Point-in-time selectors for model features (docs/MODEL.md §Leakage). A feature for a match played on day D
// may only read facts that existed before D: prior matches strictly earlier, and the ranking list observed
// on or before D (ranking_date is the day the list was published / observed, never a later list).
// Pure; the model pipeline and its tests call these instead of "latest" queries.

/** Latest snapshot with ranking_date <= day, or null. Snapshots: [{ ranking_date: 'YYYY-MM-DD', ... }]. */
export function rankingAsOf(snapshots, day) {
  let best = null;
  for (const s of snapshots || []) if (s.ranking_date <= day && (!best || s.ranking_date > best.ranking_date)) best = s;
  return best;
}

/** Matches strictly before `day` (the match's own day and later are future information). */
export function priorMatches(matches, day, dayOf = (m) => m.match_day) {
  return (matches || []).filter((m) => dayOf(m) && dayOf(m) < day);
}
