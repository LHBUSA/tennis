// tennis-api men's routes: everything legitimate we hold for men, which today means Grand Slam draws
// (Australian Open match centre, Wimbledon draws archive, Roland-Garros results). No ATP Tour data and no
// ATP rankings exist in the store, and nothing here implies otherwise.
//   GET /v1/men          -> editions with counts, latest results, champions/finalists, PBP replays, DNA gate
//   GET /v1/men/players  -> men in the latest Grand Slam main draws, by furthest round reached

import { envelope, notConfigured } from '../../shared/envelope.js';
import { inList } from '../../shared/store/postgrest.js';
import { MATCH, FINAL, shapeMatch, shapeEdition, maxTime, families } from './shape.js';
import { allRows, tourDnaStatus } from './v2.js';

const ok = (data, { rows = [], source = null, policy, semantics, degraded = [] }) => envelope(data, { source: source || families(rows), source_updated_at: maxTime(rows), policy, semantics, degraded });
// completed Grand Slam editions change only when a backfill adds rows: judged over weeks, not minutes
const ARCHIVE = { currentS: 30 * 86400, staleS: 120 * 86400 };
const NOT_ATP = 'ATP Tour, ATP Challenger and official ATP rankings are not available from a legitimate source yet (see /v1/sources)';

// calendar order inside a season; editions of older sources carry no dates
const SLAM_ORDER = { 'australian-open': 1, 'roland-garros': 2, wimbledon: 3, 'us-open': 4 };
const ROUND_DEPTH = { F: 7, S: 6, Q: 5, 4: 4, 3: 3, 2: 2, 1: 1 };
export const STAGE_LABEL = { 8: 'Champion', 7: 'Finalist', 6: 'Semifinalist', 5: 'Quarterfinalist', 4: 'Fourth round', 3: 'Third round', 2: 'Second round', 1: 'First round' };
const isMain = (r) => !String(r || '').startsWith('Q-');

/** Every edition holding men's or mixed matches, newest first, with per-event counts. */
async function menEditions(store) {
  const rows = await allRows(store, 'tennis_matches', 'select=match_id,edition_id,event_type,round,status&event_type=in.(MS,MD,XD)&order=match_id.asc', 10000);
  const ids = [...new Set(rows.map((r) => r.edition_id))];
  const eds = ids.length ? await store.select('tennis_tournament_editions', `select=edition_id,year,name,level,surface,indoor,start_date,end_date,city,country,source_family,updated_at,tennis_tournaments(slug,name)&edition_id=${inList(ids)}`) : [];
  const pbp = new Set((await allRows(store, 'tennis_match_events', 'select=match_id&quality=eq.point_event&event_sequence=eq.0&order=match_id.asc', 10000)).map((r) => r.match_id));
  const out = eds.map((e) => {
    const ms = rows.filter((r) => r.edition_id === e.edition_id);
    return {
      edition_id: e.edition_id, ...shapeEdition(e),
      counts: {
        ms_main: ms.filter((r) => r.event_type === 'MS' && isMain(r.round)).length,
        ms_qualifying: ms.filter((r) => r.event_type === 'MS' && !isMain(r.round)).length,
        md: ms.filter((r) => r.event_type === 'MD').length,
        xd: ms.filter((r) => r.event_type === 'XD').length,
        point_by_point: ms.filter((r) => pbp.has(r.match_id)).length
      }
    };
  });
  out.sort((a, b) => b.year - a.year || (SLAM_ORDER[b.slug] || 0) - (SLAM_ORDER[a.slug] || 0));
  return { editions: out, pbp, rows, raw: eds };
}

const sideOf = (m, s) => m.sides?.[s]?.players || [];

/** Stage reached by each men's singles player in one edition (8 = champion). */
export function stages(matches) {
  const best = new Map();
  for (const m of matches) {
    if (m.event_type !== 'MS' || !isMain(m.round)) continue;
    const d = ROUND_DEPTH[m.round];
    if (!d) continue;
    for (const s of ['A', 'B']) for (const p of sideOf(m, s)) {
      const won = FINAL.includes(m.status) && m.winner_side === s;
      const v = m.round === 'F' && won ? 8 : d;
      const cur = best.get(p.id);
      if (!cur || v > cur.depth) best.set(p.id, { player: p, depth: v });
    }
  }
  return [...best.values()];
}

async function editionMatches(store, editionId, extra = '') {
  return (await store.select('tennis_matches', `select=${MATCH}&edition_id=eq.${editionId}${extra}&limit=1000`)).map(shapeMatch);
}

export async function men(store) {
  const { editions, pbp, raw } = await menEditions(store);
  const withMen = editions.filter((e) => e.counts.ms_main + e.counts.md > 0);
  const latest = withMen[0] || null;
  // latest results: the closing rounds of the two newest editions
  const recent = [];
  for (const e of withMen.slice(0, 2)) {
    const ms = await editionMatches(store, e.edition_id, '&event_type=in.(MS,MD)&round=in.(F,S,Q)');
    recent.push({ edition: e, matches: ms.filter((m) => FINAL.includes(m.status)).sort((a, b) => (ROUND_DEPTH[b.round] || 0) - (ROUND_DEPTH[a.round] || 0) || (a.event_type < b.event_type ? 1 : -1)) });
  }
  // champions and finalists of the three newest singles editions (real results, not a ranking)
  const featured = [];
  const seen = new Set();
  for (const e of withMen.filter((x) => x.counts.ms_main > 0).slice(0, 3)) {
    const ms = await editionMatches(store, e.edition_id, '&event_type=eq.MS&round=in.(F,S)');
    for (const st of stages(ms).sort((a, b) => b.depth - a.depth)) {
      if (seen.has(st.player.id)) continue;
      seen.add(st.player.id);
      featured.push({ player: st.player, note: `${STAGE_LABEL[st.depth]} · ${e.tournament} ${e.year}`, depth: st.depth });
    }
  }
  // PBEcast replays with genuine point-by-point: closing rounds of the newest edition that has it
  const pbpEdition = withMen.find((e) => e.counts.point_by_point > 0) || null;
  let replays = [];
  if (pbpEdition) {
    const ms = await editionMatches(store, pbpEdition.edition_id, '&event_type=in.(MS,MD)&round=in.(F,S,Q)');
    replays = ms.filter((m) => pbp.has(m.id) && ['completed', 'retired'].includes(m.status)).sort((a, b) => (a.event_type === b.event_type ? 0 : a.event_type === 'MS' ? -1 : 1) || (ROUND_DEPTH[b.round] || 0) - (ROUND_DEPTH[a.round] || 0)).slice(0, 10);
  }
  const dna = await tourDnaStatus(store, 'M');
  const totals = withMen.reduce((t, e) => ({ matches: t.matches + e.counts.ms_main + e.counts.ms_qualifying + e.counts.md, point_by_point: t.point_by_point + e.counts.point_by_point, editions: t.editions + 1 }), { matches: 0, point_by_point: 0, editions: 0 });
  return ok({ totals, latest_edition: latest, editions: withMen, recent, featured: featured.slice(0, 12), replays, replay_edition: pbpEdition, dna: { published: dna.ready, qualified: dna.qualified, threshold: dna.threshold ?? 30 }, atp_tour: { available: false, reason: NOT_ATP } },
    { rows: raw, source: ['ausopen', 'wimbledon', 'rolandgarros'], policy: ARCHIVE, semantics: "men's coverage held in the canonical store: Grand Slam draws only (Australian Open, Wimbledon archive, Roland-Garros). Not ATP Tour data.", degraded: [NOT_ATP] });
}

/** Men in the newest Grand Slam main draws (up to 3 editions), by furthest round reached, then name. */
export async function menPlayers(store) {
  const { editions, raw } = await menEditions(store);
  const singles = editions.filter((e) => e.counts.ms_main > 0).slice(0, 3);
  const byPlayer = new Map();
  for (const e of singles) {
    const ms = await editionMatches(store, e.edition_id, '&event_type=eq.MS');
    for (const st of stages(ms)) {
      const cur = byPlayer.get(st.player.id);
      const entry = { edition: `${e.tournament} ${e.year}`, slug: e.slug, year: e.year, stage: STAGE_LABEL[st.depth], depth: st.depth };
      if (!cur) byPlayer.set(st.player.id, { player: st.player, best: entry, draws: [entry] });
      else { cur.draws.push(entry); if (st.depth > cur.best.depth) cur.best = entry; }
    }
  }
  const rows = [...byPlayer.values()].sort((a, b) => b.best.depth - a.best.depth || b.draws.length - a.draws.length || String(a.player.name).localeCompare(String(b.player.name)));
  return ok({ basis: singles.map((e) => `${e.tournament} ${e.year}`), total: rows.length, rows },
    { rows: raw, source: ['ausopen', 'wimbledon', 'rolandgarros'], policy: ARCHIVE, semantics: "men's singles players in the newest Grand Slam main draws PropBetEdge holds, ordered by furthest round reached — not a ranking", degraded: [NOT_ATP] });
}

export async function menRoute(path, url, store) {
  if (path !== '/v1/men' && path !== '/v1/men/players') return undefined;
  if (!store) return notConfigured('canonical store not connected to this Worker');
  return path === '/v1/men' ? men(store) : menPlayers(store);
}
