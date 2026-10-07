// Data-backed heads for tennis-web — PURE apart from the injected API fetch (testable in node).
import { SITE, INDEX_ROBOTS, NOINDEX_ROBOTS, breadcrumb, personLd, sportsEventLd, itemListLd, canonicalUrl, newsArticleLd } from '../../../src/seo/meta.js';

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

/**
 * The singles list a player's head/card names: WTA singles (official) for women, ATP singles (secondary-source
 * list, never called official) for men. Null when the player holds neither.
 */
export function playerRank(p) {
  const w = p?.rankings?.wta_singles;
  if (w?.rank) return { rank: w.rank, date: w.date, label: 'WTA singles', card: 'WTA SINGLES', secondary: false };
  const a = p?.rankings?.atp_singles;
  if (a?.rank) return { rank: a.rank, date: a.date, label: 'ATP singles', card: 'ATP SINGLES · SECONDARY SOURCE', secondary: true };
  return null;
}

const MATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function supersededHead(id, m) {
  const to = m.canonical_match_id;
  if (to && MATCH_ID.test(to) && to !== m.id) return { redirect: `/${id === 'pbecast' ? 'pbecast' : 'matches'}/${to}` };
  return supersededRecordHead();
}
export const supersededRecordHead = () => ({ robots: NOINDEX_ROBOTS, title: 'Superseded match record | PropBetEdge Tennis', description: 'This match record was a duplicate and has been superseded. It is kept only as a record.', jsonld: [] });
/** 301 to the canonical survivor (absolute, path only) for GET/HEAD when the head asks for it; otherwise null. */
export function permanentRedirect(overrides, method) {
  if (!overrides?.redirect || !['GET', 'HEAD'].includes(method)) return null;
  return new Response(null, { status: 301, headers: { location: canonicalUrl(overrides.redirect), 'cache-control': 'public, max-age=3600', 'x-robots-tag': 'noindex' } });
}

/** Data-backed head for a resolved route. Returns meta overrides (or {} to keep the route default). */
const DESK_SECTION = { wta: 'WTA', atp: 'ATP', 'grand-slams': 'Grand Slams', challenger: 'Challenger', itf: 'ITF', doubles: 'Doubles', rankings: 'Rankings' };
/** Schema context for a story, strictly from its frozen evidence (players with canonical slugs only). */
export function newsEntities(a) {
  const parts = a.evidence?.participants;
  const sb = (a.plan?.modules || []).find((m) => m.id === 'scoreboard')?.data;
  const people = parts ? ['A', 'B'].flatMap((s) => parts[s]?.players || []) : a.evidence?.player ? [a.evidence.player] : [];
  const winners = sb?.winner_side && parts?.[sb.winner_side] ? parts[sb.winner_side].players : a.evidence?.player ? [a.evidence.player] : [];
  const withSlug = (xs) => xs.filter((p) => p?.slug && p?.name);
  const images = withSlug(winners).map((p) => p.photo?.square).filter(Boolean);
  const photos = withSlug(winners).filter((p) => p.photo?.square).map((p) => ({ ...p.photo, name: p.photo.name || p.name }));
  return { section: DESK_SECTION[a.desk] ? `Tennis · ${DESK_SECTION[a.desk]}` : 'Tennis', people: withSlug(people), featured: withSlug(winners), match_id: a.match_id || null, tournament: a.tournament || null, images, photos };
}

export async function headFor(env, r, url = null) {
  const { id, params } = r;
  if (id === 'news-article') {
    const pv = url?.searchParams.get('preview');
    const a = await apiGet(env, `/v1/news/${params.slug}${pv && /^[0-9a-f]{16,64}$/.test(pv) ? `?preview=${pv}` : ''}`);
    if (!a) return { robots: NOINDEX_ROBOTS, title: 'Story not found | PropBetEdge Tennis' };
    const canonical = canonicalUrl(`/news/${a.slug}`);
    const image = { ...card(`news/${a.slug}`, a.updated_at ? String(Date.parse(a.updated_at)) : ''), alt: a.headline };
    const published = a.status === 'published';
    return {
      title: `${a.headline} | PropBetEdge Tennis`,
      description: a.dek || a.headline,
      robots: published ? INDEX_ROBOTS : NOINDEX_ROBOTS,
      type: 'article',
      image,
      article: published ? { published_time: a.first_published_at || a.published_at, modified_time: a.updated_at, section: 'Tennis' } : null,
      jsonld: [published ? newsArticleLd(a, canonical, image, newsEntities(a)) : null, breadcrumb([['PropBetEdge', 'https://propbetedge.ai/'], ['Tennis', '/'], ['News', '/news'], [a.headline, `/news/${a.slug}`]])].filter(Boolean)
    };
  }
  if (id === 'player' || id === 'player-sub') {
    const p = await apiGet(env, `/v1/players/${params.slug}`);
    if (!p) return { robots: NOINDEX_ROBOTS, title: 'Player not found | PropBetEdge Tennis' };
    const rk = playerRank(p);
    const rankTxt = rk ? `${rk.label} No. ${rk.rank} (list of ${fmtD(rk.date)}${rk.secondary ? ', secondary source' : ''})` : null;
    const dna = id === 'player-sub' && params.tab === 'dna';
    const facts = [rankTxt, p.nationality, p.dob ? `born ${fmtD(p.dob)}` : null].filter(Boolean).join(' · ');
    const canonical = canonicalUrl(dna ? `/players/${p.slug}/dna` : `/players/${p.slug}`);
    return {
      // one product: men and women get the same head; a ranking is named only with the list it comes from
      title: `${p.name} — ${dna ? 'Tennis DNA' : 'Profile, Ranking & Matches'} | PropBetEdge Tennis`,
      description: `${p.name}${facts ? ` — ${facts}` : ''}. ${dna ? 'Match DNA from results with same-tour percentiles, plus serve and return metrics where match statistics exist — samples and confidence on every number.' : 'Ranking history, recent results, surface record, head-to-head, Match DNA and PBEcast.'}`,
      robots: rk || p.recent_matches?.length ? INDEX_ROBOTS : NOINDEX_ROBOTS,
      type: 'profile',
      image: { ...card(dna ? `player/${p.slug}/dna` : `player/${p.slug}`, `${rk?.date || ''}${p.photo ? 'p' : 'm'}`), alt: `${p.name} — PropBetEdge Tennis ${dna ? 'Tennis DNA' : 'player'} card` },
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
      description: `${e.tournament} ${e.year}${e.level || e.tour === 'atp' ? ` (${e.level || 'ATP Tour'})` : ''}${e.surface ? ` on ${e.surface}` : ''}${where ? ` in ${where}` : ''}, ${fmtD(e.start_date)}–${fmtD(e.end_date)}: ${d.matches.length} matches with live scores, results and PBEcast.`,
      robots: d.matches.length && id === 'tournament' ? INDEX_ROBOTS : NOINDEX_ROBOTS,
      image: { ...card(`tournament/${params.slug}/${params.year}`, `${d.matches.length}`), alt: `${e.tournament} ${e.year} — PropBetEdge Tennis` },
      jsonld: [breadcrumb([['PropBetEdge Tennis', '/'], ['Tournaments', '/tournaments'], [`${e.tournament} ${e.year}`, `/tournaments/${params.slug}/${params.year}`]]), itemListLd(`${e.tournament} ${e.year} matches`, d.matches.slice(0, 50).map((m) => [`${names(m, 'A')} vs ${names(m, 'B')}`, `/matches/${m.id}`]))]
    };
  }
  if (id === 'match' || id === 'pbecast') {
    const m = await apiGet(env, `/v1/matches/${params.id}`);
    if (!m) return { robots: NOINDEX_ROBOTS, title: 'Match not found | PropBetEdge Tennis' };
    // a superseded duplicate row: permanent redirect to its resolved survivor (the only canonical URL); without a valid
    // survivor no guess — a noindex "Superseded match record" state, no JSON-LD, no card (2026-10-07)
    if (m.status === 'superseded') return supersededHead(id, m);
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

