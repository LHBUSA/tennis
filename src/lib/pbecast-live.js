// PBEcast live entry — PURE (tested in tests/pbecast-live.test.js).
// Clicking PBEcast enters a live court when one exists. The featured court is chosen by a deterministic
// order over canonical data (never random), so a refresh or a poll never swaps the viewer's match.

const LEVEL = { 'Grand Slam': 0, 'WTA Finals': 1, 'WTA 1000': 2, 'WTA 500': 3, 'WTA 250': 4, 'WTA 125': 5 };
const levelRank = (lvl) => LEVEL[lvl] ?? (/1000/.test(lvl || '') ? 2 : /500/.test(lvl || '') ? 3 : /250/.test(lvl || '') ? 4 : /125/.test(lvl || '') ? 5 : 6);
const roundRank = (code) => {
  const [stage, r] = String(code || '').split('-');
  const k = { F: 0, S: 1, Q: 2 }[r] ?? (Number(r) ? 10 - Number(r) : 9);
  return (stage === 'Q' ? 20 : 0) + k;
};

/** Only a match the source reports in progress is live. Suspended, scheduled and final are not. */
export const isLive = (m) => m?.status === 'in_progress';

/** Deterministic order: tournament level, then deeper round, then singles before doubles, then id. */
export function orderLive(list) {
  return (list || []).filter(isLive).slice().sort((a, b) =>
    levelRank(a.tournament?.level) - levelRank(b.tournament?.level)
    || roundRank(a.round) - roundRank(b.round)
    || (/S$/.test(a.event_type) ? 0 : 1) - (/S$/.test(b.event_type) ? 0 : 1)
    || String(a.id).localeCompare(String(b.id)));
}

/** What /pbecast does: 0 live -> the replay hub; >=1 live -> open the first ordered court (+ switcher if >1). */
export function liveEntry(list) {
  const live = orderLive(list);
  if (!live.length) return { mode: 'hub' };
  return { mode: 'live', id: live[0].id, path: `/pbecast/${live[0].id}`, switcher: live.length > 1, count: live.length };
}

/** Switcher entries for the current court. Shown when >1 court is live, or when the viewer is on a non-live match. */
export function switcherItems(list, currentId) {
  const live = orderLive(list);
  const onLive = live.some((m) => m.id === currentId);
  if (live.length < 2 && (onLive || !live.length)) return [];
  return live.map((m) => ({ id: m.id, href: `/pbecast/${m.id}`, current: m.id === currentId, match: m }));
}
