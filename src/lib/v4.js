// Tennis V4 — pure presentation helpers (tests/v4-design.test.js). Nothing here invents a fact: every function selects or
// labels values the API already served, and returns an empty result when there is nothing legitimate to show.

/** Surface accent for a page with a SOURCED surface; unknown / missing surface is neutral (never guessed). */
const SURFACES = Object.freeze({ hard: 'Hard court', clay: 'Clay court', grass: 'Grass court' });
export function surfaceAccent(surface) {
  const k = String(surface || '').toLowerCase().trim();
  return SURFACES[k] ? { key: k, label: SURFACES[k] } : { key: 'neutral', label: null };
}

/** The page's surface context on <html data-surface> (the router resets it to neutral on every navigation). */
export function setPageSurface(surface, doc = typeof document === 'undefined' ? null : document) {
  if (!doc?.documentElement) return surfaceAccent(null);
  const a = surfaceAccent(surface);
  doc.documentElement.dataset.surface = a.key;
  return a;
}

const tourOf = (a) => (a?.desk === 'atp' || a?.desk === 'wta' ? a.desk : a?.tour === 'atp' || a?.tour === 'wta' ? a.tour : null);

/**
 * Newsroom front plan (all-desk): after the hero (lead + majors), LATEST INTELLIGENCE takes the next `latest` stories, then
 * an ATP rail and a WTA rail each take up to `rail` of that tour's REMAINING stories; everything left is `more` (revealed on
 * demand). Every story appears exactly once — no duplicate news sections. On a single desk there are no rails.
 */
export function newsPlan(rest, { desk = 'all', latest = 5, rail = 4 } = {}) {
  const list = (rest || []).filter(Boolean);
  if (desk !== 'all') return { latest: list, atp: [], wta: [], more: [] };
  const top = list.slice(0, latest);
  const left = list.slice(latest);
  const atp = left.filter((a) => tourOf(a) === 'atp').slice(0, rail);
  const wta = left.filter((a) => tourOf(a) === 'wta').slice(0, rail);
  const used = new Set([...atp, ...wta]);
  return { latest: top, atp, wta, more: left.filter((a) => !used.has(a)) };
}

/**
 * Previews / what's next: real scheduled singles matchups only (API /v1/matchups), soonest first, at most one per player
 * pair, `limit` rows; nothing when none is scheduled.
 */
export function previewPick(matchups, { now = Date.now(), limit = 4 } = {}) {
  const seen = new Set();
  return (matchups || [])
    .filter((x) => x?.match?.scheduled_at && Date.parse(x.match.scheduled_at) >= now - 2 * 3600e3)
    .sort((a, b) => Date.parse(a.match.scheduled_at) - Date.parse(b.match.scheduled_at))
    .filter((x) => { const k = ['A', 'B'].map((s) => x.match.sides?.[s]?.participant_key).sort().join('~'); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit);
}

/**
 * A leaderboard is shown ONLY with a defined, adequate qualification population. Returns { show, rows, population, note }.
 * `d` is a /v1/dna/leaders payload: v1 technical boards carry no `published` flag when the tour gate is open and
 * `published:false` when held; v2 Match DNA / PBE Rating boards carry `published`. `min` = the gate's own threshold.
 */
export function leaderBoard(d, { tour, min = 30 } = {}) {
  const T = String(tour || '').toUpperCase();
  if (!d) return { show: false, rows: [], population: null, note: `${T} leaders unavailable right now.` };
  const q = Number(d.qualified) || 0;
  const threshold = Number(d.threshold) || min;
  const held = d.published === false || q < threshold || !(d.rows || []).length;
  if (held) return { show: false, rows: [], population: q, note: `${T} comparison building: ${q} of ${threshold} players meet the comparison standard.` };
  // the board's own population rule when it states one ("... among players with 20+ rated matches ..."), else the v1 gate
  const rule = /\bamong (.+)$/.exec(String(d.definition || ''))?.[1] || 'players with a medium- or high-confidence sample';
  return { show: true, rows: d.rows, population: q, note: `${T} singles ${rule} (${q.toLocaleString('en-US')} qualified${d.as_of ? `, as of ${d.as_of}` : ''}); ATP and WTA are never pooled.` };
}
