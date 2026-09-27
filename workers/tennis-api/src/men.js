// tennis-api men's routes: Grand Slam draws (official feeds) plus ATP Tour results and weekly ATP singles lists
// from a secondary source (lanes espn_atp / espn_rankings), never described as official ATP data.
//   GET /v1/men          -> newest Slam editions with counts, archive list, results, finalists, PBP replays, ATP coverage, DNA gate
//   GET /v1/men/players  -> latest ATP singles list (secondary) + Grand Slam performance in the newest main draws

import { envelope, notConfigured } from '../../shared/envelope.js';
import { inList } from '../../shared/store/postgrest.js';
import { MATCH, FINAL, PLAYER, shapeMatch, shapeEdition, shapePlayer, maxTime, families } from './shape.js';
import { allRows, tourDnaStatus } from './v2.js';

const ok = (data, { rows = [], source = null, policy, semantics, degraded = [] }) => envelope(data, { source: source || families(rows), source_updated_at: maxTime(rows), policy, semantics, degraded });
// completed Grand Slam editions change only when a backfill adds rows: judged over weeks, not minutes
const ARCHIVE = { currentS: 30 * 86400, staleS: 120 * 86400 };
const NOT_ATP = 'ATP Challenger, ITF and official ATP ranking feeds are not available from a legitimate source yet (see /v1/sources)';
const ATP_NOTE = 'ATP Tour results come from a secondary source behind official Grand Slam data: results, rounds and scores; no surface, level or match statistics';

// calendar order inside a season; editions of older sources carry no dates
const SLAM_ORDER = { 'australian-open': 1, 'roland-garros': 2, wimbledon: 3, 'us-open': 4 };
const ROUND_DEPTH = { F: 7, S: 6, Q: 5, 4: 4, 3: 3, 2: 2, 1: 1 };
export const STAGE_LABEL = { 8: 'Champion', 7: 'Finalist', 6: 'Semifinalist', 5: 'Quarterfinalist', 4: 'Fourth round', 3: 'Third round', 2: 'Second round', 1: 'First round' };
const isMain = (r) => !String(r || '').startsWith('Q-');
// WTA-sourced Slam rounds carry a stage prefix (M-F, M-S, ...); the Slam sources use F, S, ...
const rnd = (r) => String(r || '').replace(/^M-/, '');

const sideOf = (m, s) => m.sides?.[s]?.players || [];

/** Stage reached by each singles player of one event (MS or WS) in one edition (8 = champion). */
export function stages(matches, event = 'MS') {
  const best = new Map();
  for (const m of matches) {
    if (m.event_type !== event || !isMain(m.round)) continue;
    const d = ROUND_DEPTH[rnd(m.round)];
    if (!d) continue;
    for (const s of ['A', 'B']) for (const p of sideOf(m, s)) {
      const won = FINAL.includes(m.status) && m.winner_side === s;
      const v = rnd(m.round) === 'F' && won ? 8 : d;
      const cur = best.get(p.id);
      if (!cur || v > cur.depth) best.set(p.id, { player: p, depth: v });
    }
  }
  return [...best.values()];
}

async function editionMatches(store, editionId, extra = '') {
  return (await store.select('tennis_matches', `select=${MATCH}&edition_id=eq.${editionId}${extra}&limit=1000`)).map(shapeMatch);
}

// Every query below is bounded by construction (tests/men-api.test.js): Grand Slam editions are resolved FIRST
// from tennis_tournament_editions (level, newest first, capped), and match rows are read only for those edition
// ids. Men's totals are exact HEAD counts, never row scans. ATP Tour coverage (secondary source) and the DNA gate
// are read independently. (Before 2026-09-27 this module scanned up to 10,000 arbitrary men's matches and sent
// every edition id they touched through one in.(...) filter — a PostgREST 400 once ATP history landed.)
export const SLAM_COUNTED = 12;      // newest Grand Slam editions that carry per-event counts
export const SLAM_ARCHIVE = 200;     // Grand Slam edition metadata (4 a year)
const RANK_LIMIT = 200;

/** Newest editions of the four canonical Grand Slam tournaments (metadata only, bounded). Some WTA-calendar Slam
 *  editions live under separate tournament rows (other slugs) and carry only the women's events. */
const SLAM_SLUGS = 'australian-open,roland-garros,wimbledon,us-open';
async function slamEditions(store, limit = SLAM_ARCHIVE) {
  const rows = await store.select('tennis_tournament_editions', `select=edition_id,year,name,level,surface,indoor,start_date,end_date,city,country,source_family,updated_at,tennis_tournaments!inner(slug,name)&tennis_tournaments.slug=in.(${SLAM_SLUGS})&order=year.desc&limit=${limit}`);
  return rows.sort((a, b) => b.year - a.year || (SLAM_ORDER[b.tennis_tournaments?.slug] || 0) - (SLAM_ORDER[a.tennis_tournaments?.slug] || 0));
}

/** Point-by-point match ids (first point event only; bounded by the few sources that publish points). */
async function pbpMatchIds(store) {
  return new Set((await store.select('tennis_match_events', 'select=match_id&quality=eq.point_event&event_sequence=eq.0&order=match_id.asc&limit=5000')).map((r) => r.match_id));
}

/** Per-event men's counts for AT MOST `SLAM_COUNTED` editions (one bounded select). */
async function countedEditions(store, eds, pbp) {
  const pick = eds.slice(0, SLAM_COUNTED);
  if (!pick.length) return [];
  // one select per edition: a Slam's men's + mixed draws are < 450 rows, under PostgREST's 1,000-row page
  const rows = (await Promise.all(pick.map((e) => store.select('tennis_matches', `select=match_id,edition_id,event_type,round&edition_id=eq.${e.edition_id}&event_type=in.(MS,MD,XD)&limit=1000`)))).flat();
  return pick.map((e) => {
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
  }).sort((a, b) => b.year - a.year || (SLAM_ORDER[b.slug] || 0) - (SLAM_ORDER[a.slug] || 0));
}

/** ATP Tour coverage held from the secondary source (exact counts + year span), independent of the Slams. */
async function atpCoverage(store) {
  const [matches, editions, first, last] = await Promise.all([
    store.count('tennis_matches', 'source_family=eq.espn&event_type=in.(MS,MD)'),
    store.count('tennis_tournament_editions', 'source_family=eq.espn'),
    store.select('tennis_tournament_editions', 'select=year&source_family=eq.espn&order=year.asc&limit=1'),
    store.select('tennis_tournament_editions', 'select=year&source_family=eq.espn&order=year.desc&limit=1')
  ]);
  return { matches, editions, first_year: first[0]?.year ?? null, last_year: last[0]?.year ?? null, source: 'secondary', note: ATP_NOTE };
}

/** Latest ATP singles list (secondary source), with movement against our previous archived list. */
export async function latestAtpList(store, limit = RANK_LIMIT) {
  const [snap] = await store.select('tennis_ranking_snapshots', 'select=snapshot_id,ranking_date,row_count,captured_at,source_family&list_key=eq.atp_singles&row_count=gt.0&order=ranking_date.desc&limit=1');
  if (!snap) return null;
  const rows = await store.select('tennis_rankings', `select=rank,points,previous_rank,provider_player_id,pbe_player_id,${PLAYER}&snapshot_id=eq.${snap.snapshot_id}&order=rank.asc&limit=${limit}`);
  const [prev] = await store.select('tennis_ranking_snapshots', `select=snapshot_id,ranking_date&list_key=eq.atp_singles&ranking_date=lt.${snap.ranking_date}&row_count=gt.0&order=ranking_date.desc&limit=1`);
  let prevRank = new Map();
  if (prev && rows.length) prevRank = new Map((await store.select('tennis_rankings', `select=provider_player_id,rank&snapshot_id=eq.${prev.snapshot_id}&limit=${limit + 100}`)).map((r) => [r.provider_player_id, r.rank]));
  return {
    list: 'atp_singles', ranking_date: snap.ranking_date, previous_date: prev?.ranking_date || null, total: snap.row_count, source_family: snap.source_family, captured_at: snap.captured_at,
    linked: rows.filter((r) => r.pbe_player_id).length,
    disclosure: snap.source_family === 'espn' ? 'Ranking list carried by a secondary source · not an official ATP feed' : null,
    rows: rows.map((r) => ({ rank: r.rank, points: r.points, previous_rank: prevRank.get(r.provider_player_id) ?? null, player: r.tennis_players ? shapePlayer(r.tennis_players) : null }))
  };
}

export async function men(store) {
  const [eds, pbp, dna, atp, total, ms, md, xd] = await Promise.all([
    slamEditions(store), pbpMatchIds(store), tourDnaStatus(store, 'M'), atpCoverage(store),
    store.count('tennis_matches', 'event_type=in.(MS,MD)'), store.count('tennis_matches', 'event_type=eq.MS'), store.count('tennis_matches', 'event_type=eq.MD'), store.count('tennis_matches', 'event_type=eq.XD')
  ]);
  const counted = await countedEditions(store, eds, pbp);
  const withMen = counted.filter((e) => e.counts.ms_main + e.counts.md > 0);
  const countedIds = new Set(counted.map((e) => e.edition_id));
  const archive = eds.filter((e) => !countedIds.has(e.edition_id)).map((e) => ({ edition_id: e.edition_id, ...shapeEdition(e), counts: null }));
  const latest = withMen[0] || null;
  const recent = [];
  for (const e of withMen.slice(0, 2)) {
    const m = await editionMatches(store, e.edition_id, '&event_type=in.(MS,MD)&round=in.(F,S,Q)');
    recent.push({ edition: e, matches: m.filter((x) => FINAL.includes(x.status)).sort((a, b) => (ROUND_DEPTH[b.round] || 0) - (ROUND_DEPTH[a.round] || 0) || (a.event_type < b.event_type ? 1 : -1)) });
  }
  const featured = [];
  const seen = new Set();
  for (const e of withMen.filter((x) => x.counts.ms_main > 0).slice(0, 3)) {
    const m = await editionMatches(store, e.edition_id, '&event_type=eq.MS&round=in.(F,S)');
    for (const st of stages(m).sort((a, b) => b.depth - a.depth)) {
      if (seen.has(st.player.id)) continue;
      seen.add(st.player.id);
      featured.push({ player: st.player, note: `${STAGE_LABEL[st.depth]} · ${e.tournament} ${e.year}`, depth: st.depth });
    }
  }
  const pbpEdition = withMen.find((e) => e.counts.point_by_point > 0) || null;
  let replays = [];
  if (pbpEdition) {
    const m = await editionMatches(store, pbpEdition.edition_id, '&event_type=in.(MS,MD)&round=in.(F,S,Q)');
    replays = m.filter((x) => pbp.has(x.id) && ['completed', 'retired'].includes(x.status)).sort((a, b) => (a.event_type === b.event_type ? 0 : a.event_type === 'MS' ? -1 : 1) || (ROUND_DEPTH[b.round] || 0) - (ROUND_DEPTH[a.round] || 0)).slice(0, 10);
  }
  const totals = { matches: total, ms, md, xd, point_by_point: pbp.size, editions: eds.length };
  return ok({ totals, latest_edition: latest, editions: withMen, archive_editions: archive, recent, featured: featured.slice(0, 12), replays, replay_edition: pbpEdition, dna: { published: dna.ready, qualified: dna.qualified, threshold: dna.threshold ?? 30 }, atp_tour: { available: atp.matches > 0, ...atp } },
    { rows: eds, source: ['ausopen', 'wimbledon', 'rolandgarros', 'espn'], policy: ARCHIVE, semantics: `men's coverage in the canonical store: Grand Slam draws (official feeds) plus ATP Tour results ${atp.first_year ?? ''}–${atp.last_year ?? ''} from a secondary source; per-event counts for the ${SLAM_COUNTED} newest Grand Slam editions`, degraded: [NOT_ATP] });
}

/** ATP singles list (secondary source) as the men's directory, plus Grand Slam performance of the 3 newest draws. */
export async function menPlayers(store) {
  const [ranking, eds, pbp] = await Promise.all([latestAtpList(store), slamEditions(store, SLAM_COUNTED), pbpMatchIds(store)]);
  const counted = await countedEditions(store, eds, pbp);
  const singles = counted.filter((e) => e.counts.ms_main > 0).slice(0, 3);
  const byPlayer = new Map();
  for (const e of singles) {
    const m = await editionMatches(store, e.edition_id, '&event_type=eq.MS');
    for (const st of stages(m)) {
      const cur = byPlayer.get(st.player.id);
      const entry = { edition: `${e.tournament} ${e.year}`, slug: e.slug, year: e.year, stage: STAGE_LABEL[st.depth], depth: st.depth };
      if (!cur) byPlayer.set(st.player.id, { player: st.player, best: entry, draws: [entry] });
      else { cur.draws.push(entry); if (st.depth > cur.best.depth) cur.best = entry; }
    }
  }
  const rows = [...byPlayer.values()].sort((a, b) => b.best.depth - a.best.depth || b.draws.length - a.draws.length || String(a.player.name).localeCompare(String(b.player.name)));
  return ok({ ranking, basis: singles.map((e) => `${e.tournament} ${e.year}`), total: rows.length, rows },
    { rows: eds, source: ranking ? [ranking.source_family, 'ausopen', 'wimbledon', 'rolandgarros'] : ['ausopen', 'wimbledon', 'rolandgarros'], policy: { currentS: 8 * 86400, staleS: 15 * 86400 }, semantics: `men's players: ${ranking ? `ATP singles list dated ${ranking.ranking_date} carried by a secondary source (not an official ATP feed), ${ranking.linked}/${ranking.rows.length} linked to canonical profiles; ` : ''}plus Grand Slam performance in the newest main draws held (${singles.map((e) => `${e.tournament} ${e.year}`).join(', ')}), by furthest round reached`, degraded: [NOT_ATP] });
}

// ---- /v1/slams: tournament-first Grand Slam coverage across all five events ------------------------------
const EVENTS = ['MS', 'WS', 'MD', 'WD', 'XD'];

export async function slams(store) {
  const eds = await store.select('tennis_tournament_editions', 'select=edition_id,year,name,level,surface,indoor,start_date,end_date,city,country,source_family,updated_at,tennis_tournaments(slug,name)&level=eq.Grand Slam&order=year.desc&limit=200');
  const ids = eds.map((e) => e.edition_id);
  // chunked by edition (never one giant in.(...)); each chunk is bounded by its editions' draw sizes
  const rows = [];
  for (let i = 0; i < ids.length; i += 10) rows.push(...await allRows(store, 'tennis_matches', `select=match_id,edition_id,event_type,round,status&edition_id=${inList(ids.slice(i, i + 10))}&order=match_id.asc`, 10 * 1200));
  const pbp = await pbpMatchIds(store);
  const editions = eds.map((e) => {
    const ms = rows.filter((r) => r.edition_id === e.edition_id);
    const counts = Object.fromEntries(EVENTS.map((ev) => [ev, ms.filter((r) => r.event_type === ev && isMain(r.round)).length]));
    counts.qualifying = ms.filter((r) => !isMain(r.round)).length;
    counts.point_by_point = ms.filter((r) => pbp.has(r.match_id)).length;
    counts.total = ms.length;
    return { edition_id: e.edition_id, ...shapeEdition(e), counts };
  }).filter((e) => e.counts.total > 0);
  editions.sort((a, b) => b.year - a.year || (SLAM_ORDER[b.slug] || 0) - (SLAM_ORDER[a.slug] || 0));
  // finals of the two newest editions, every event, with event labels as context
  const finals = [];
  for (const e of editions.slice(0, 2)) {
    const ms = await editionMatches(store, e.edition_id, '&round=in.(F,M-F)');
    finals.push(...ms.filter((m) => FINAL.includes(m.status)).sort((a, b) => EVENTS.indexOf(a.event_type) - EVENTS.indexOf(b.event_type)));
  }
  // featured: champions + finalists of the newest editions holding each singles event
  const featured = [];
  const seen = new Set();
  for (const ev of ['MS', 'WS']) {
    for (const e of editions.filter((x) => x.counts[ev] > 0).slice(0, 2)) {
      const ms = await editionMatches(store, e.edition_id, `&event_type=eq.${ev}&round=in.(F,M-F)`);
      for (const st of stages(ms, ev).sort((a, b) => b.depth - a.depth)) {
        if (seen.has(st.player.id)) continue;
        seen.add(st.player.id);
        featured.push({ player: st.player, note: `${STAGE_LABEL[st.depth]} · ${e.tournament} ${e.year}`, event: ev, depth: st.depth, year: e.year, order: SLAM_ORDER[e.slug] || 0 });
      }
    }
  }
  featured.sort((a, b) => b.year - a.year || b.order - a.order || b.depth - a.depth);
  // PBEcast replays with genuine point-by-point (closing rounds, every event)
  const pbpEdition = editions.find((e) => e.counts.point_by_point > 0) || null;
  let replays = [];
  if (pbpEdition) {
    const ms = await editionMatches(store, pbpEdition.edition_id, '&round=in.(F,S,M-F,M-S)');
    replays = ms.filter((m) => pbp.has(m.id) && ['completed', 'retired'].includes(m.status)).sort((a, b) => (ROUND_DEPTH[rnd(b.round)] || 0) - (ROUND_DEPTH[rnd(a.round)] || 0) || EVENTS.indexOf(a.event_type) - EVENTS.indexOf(b.event_type)).slice(0, 8);
  }
  return ok({ editions, finals, featured: featured.slice(0, 8), replays, replay_edition: pbpEdition },
    { rows: eds, source: ['ausopen', 'wimbledon', 'rolandgarros', 'wta'], policy: ARCHIVE, semantics: 'Grand Slam editions in the canonical store with per-event counts (MS, WS, MD, WD, XD, qualifying), finals, champions and point-by-point replays', degraded: [NOT_ATP] });
}

export async function menRoute(path, url, store) {
  if (path !== '/v1/men' && path !== '/v1/men/players' && path !== '/v1/slams') return undefined;
  if (!store) return notConfigured('canonical store not connected to this Worker');
  return path === '/v1/men' ? men(store) : path === '/v1/slams' ? slams(store) : menPlayers(store);
}
