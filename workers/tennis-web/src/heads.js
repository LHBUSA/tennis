// Data-backed heads for tennis-web — PURE apart from the injected API fetch (testable in node).
import { SITE, INDEX_ROBOTS, NOINDEX_ROBOTS, breadcrumb, personLd, sportsEventLd, itemListLd, canonicalUrl } from '../../../src/seo/meta.js';

export const ROUND = (code) => { const [st, r] = String(code || '').includes('-') ? String(code).split('-') : ['M', String(code || '')]; const b = { Q: 'Quarterfinal', S: 'Semifinal', F: 'Final' }[r] || (/^\d+$/.test(r) ? `Round ${r}` : r); return st === 'Q' ? `Qualifying ${b}` : b; };
const EVENT = { MS: "Men's singles", WS: "Women's singles", MD: "Men's doubles", WD: "Women's doubles", XD: 'Mixed doubles' };
export const fmtD = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

export async function apiGet(env, path) {
  const res = env.API ? await env.API.fetch(new Request(`https://tennis-api.internal${path}`)) : await fetch(`https://tennis-api.propbetedge.ai${path}`);
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  return j?.data ?? null;
}

const card = (path, v) => ({ url: `${SITE}/og/${path}.png${v ? `?v=${encodeURIComponent(v)}` : ''}`, type: 'image/png', width: 1200, height: 630 });
const names = (m, s) => (m.sides?.[s]?.players || []).map((p) => p.name).join(' / ');

/** Data-backed head for a resolved route. Returns meta overrides (or {} to keep the route default). */
export async function headFor(env, r) {
  const { id, params } = r;
  if (id === 'player' || id === 'player-sub') {
    const p = await apiGet(env, `/v1/players/${params.slug}`);
    if (!p) return { robots: NOINDEX_ROBOTS, title: 'Player not found | PropBetEdge Tennis' };
    const ws = p.rankings?.wta_singles;
    const rankTxt = ws ? `WTA No. ${ws.rank} (list of ${fmtD(ws.date)})` : null;
    const dna = id === 'player-sub' && params.tab === 'dna';
    const facts = [rankTxt, p.nationality, p.dob ? `born ${fmtD(p.dob)}` : null].filter(Boolean).join(' · ');
    const canonical = canonicalUrl(dna ? `/players/${p.slug}/dna` : `/players/${p.slug}`);
    return {
      title: `${p.name} — ${dna ? 'Tennis DNA' : 'Profile, Ranking & Matches'} | PropBetEdge Tennis`,
      description: `${p.name}${facts ? ` — ${facts}` : ''}. ${dna ? 'Serve, return and pressure metrics with samples and confidence.' : 'Ranking history, recent results, surface record, head-to-head and Tennis DNA.'}`,
      robots: ws || p.recent_matches?.length ? INDEX_ROBOTS : NOINDEX_ROBOTS,
      type: 'profile',
      image: { ...card(`player/${p.slug}`, `${ws?.date || ''}${p.photo ? 'p' : 'm'}`), alt: `${p.name} — PropBetEdge Tennis player card` },
      jsonld: [personLd(p, canonicalUrl(`/players/${p.slug}`)), breadcrumb([['PropBetEdge Tennis', '/'], ['Players', '/players'], [p.name, `/players/${p.slug}`]])]
    };
  }
  if (id === 'tournament' || id === 'tournament-sub') {
    const d = await apiGet(env, `/v1/tournaments/${params.slug}/${params.year}`);
    if (!d) return { robots: NOINDEX_ROBOTS, title: 'Tournament not found | PropBetEdge Tennis' };
    const e = d.edition;
    const where = [e.city, e.country].filter(Boolean).join(', ');
    return {
      title: `${e.tournament} ${e.year} — Results, Schedule & Draw | PropBetEdge Tennis`,
      description: `${e.tournament} ${e.year}${e.level ? ` (${e.level})` : ''}${e.surface ? ` on ${e.surface}` : ''}${where ? ` in ${where}` : ''}, ${fmtD(e.start_date)}–${fmtD(e.end_date)}: ${d.matches.length} matches with live scores, results and PBEcast.`,
      robots: d.matches.length && id === 'tournament' ? INDEX_ROBOTS : NOINDEX_ROBOTS,
      image: { ...card(`tournament/${params.slug}/${params.year}`, `${d.matches.length}`), alt: `${e.tournament} ${e.year} — PropBetEdge Tennis` },
      jsonld: [breadcrumb([['PropBetEdge Tennis', '/'], ['Tournaments', '/tournaments'], [`${e.tournament} ${e.year}`, `/tournaments/${params.slug}/${params.year}`]]), itemListLd(`${e.tournament} ${e.year} matches`, d.matches.slice(0, 50).map((m) => [`${names(m, 'A')} vs ${names(m, 'B')}`, `/matches/${m.id}`]))]
    };
  }
  if (id === 'match' || id === 'pbecast') {
    const m = await apiGet(env, `/v1/matches/${params.id}`);
    if (!m) return { robots: NOINDEX_ROBOTS, title: 'Match not found | PropBetEdge Tennis' };
    const vs = `${names(m, 'A')} vs ${names(m, 'B')}`;
    const t = m.tournament || {};
    const live = m.status === 'in_progress';
    const final = ['completed', 'retired', 'walkover'].includes(m.status);
    const label = id === 'pbecast' ? (live ? 'Live PBEcast' : final ? 'PBEcast Replay' : 'PBEcast') : live ? 'Live Score' : final ? 'Result & Stats' : 'Preview';
    const canonical = canonicalUrl(`/${id === 'pbecast' ? 'pbecast' : 'matches'}/${m.id}`);
    const ev = sportsEventLd(m, canonical);
    return {
      title: `${vs} ${label} — ${t.tournament || ''} ${t.year || ''} | PropBetEdge Tennis`.replace(/\s+/g, ' '),
      description: `${vs}, ${EVENT[m.event_type] || ''} ${ROUND(m.round)}${t.tournament ? ` at ${t.tournament} ${t.year}` : ''}${final && m.score ? `: ${m.score}` : live ? ': live' : ''}.${id === 'pbecast' ? ' The PropBetEdge analytical court: score, serve, key moments, Tennis DNA and head-to-head.' : ''}`.replace(/\s+/g, ' ').trim(),
      // match pages index only with real depth (statistics); PBEcast stays noindex (companion view of the match page)
      robots: id === 'match' && m.statistics ? INDEX_ROBOTS : NOINDEX_ROBOTS,
      image: { ...card(`${id === 'pbecast' ? 'pbecast' : 'match'}/${m.id}`, `${m.status}${m.score || ''}`), alt: `${vs} — ${t.tournament || 'PropBetEdge Tennis'}` },
      jsonld: [ev, breadcrumb([['PropBetEdge Tennis', '/'], [t.tournament ? `${t.tournament} ${t.year}` : 'Matches', t.slug ? `/tournaments/${t.slug}/${t.year}` : '/schedule'], [vs, `/matches/${m.id}`]])].filter(Boolean)
    };
  }
  if (id === 'rankings-list' && params.tour === 'women') {
    const d = await apiGet(env, `/v1/rankings?tour=wta&type=${r.route.doubles ? 'doubles' : 'singles'}&limit=10`);
    return d ? { image: { ...card(`rankings/wta-${r.route.doubles ? 'doubles' : 'singles'}`, d.ranking_date), alt: 'PropBetEdge Tennis rankings' }, jsonld: [itemListLd(`WTA ${r.route.doubles ? 'doubles' : 'singles'} rankings ${d.ranking_date}`, d.rows.map((x) => [`${x.rank}. ${x.player.name}`, `/players/${x.player.slug}`]))] } : {};
  }
  return {};
}

