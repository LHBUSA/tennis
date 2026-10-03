// Home (V2): one Tennis product, organized by what is happening — never by gender. Hero -> live status -> live / up next
// -> tournament coverage -> players to watch -> latest intelligence -> Tennis DNA leaders -> PBEcast -> coverage & sources.
// Every value is real API data; an empty section states why (docs/evidence/home-v2-production.md).

import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { kalshi, bounded, paintKalshiLines } from '../data/kalshi.js';
import { leadStory, majorStory } from './news.js';
import { hierarchy } from '../lib/newsroom.js';
import { ensureEach, eventGender, storyTour } from '../lib/balance.js';
import { leaderBoard } from '../lib/v4.js';
import { liveGroups, nextMatch, orderTournaments, latestSlams, heroPick, playersToWatch, tourStatus } from '../lib/home.js';
import { liveRecentItems } from '../ui/live-recent.js';
import { section, rail, wireRails, heroMedia, statusBar, tourLines, TOURS_PENDING, matchCard, tournamentCard, playerCard, dnaColumnsSkeleton, dnaBoard, pbecastLive, replayCard, coverageCards } from '../ui/home.js';

const menWomen = (m) => { const g = eventGender(m); return g === 'mixed' ? null : g; };
// Match DNA boards (mature same-tour populations on both tours). Technical DNA metrics (hold / break rate) stay off the
// homepage while ATP Technical DNA is below its 30-player gate. Keep in sync with tennis-api PUBLIC_DNA_PREVIEW_METRICS.
export const HOME_DNA_BOARDS = [['pbe_rating', 'PBE Rating', (v) => String(v)], ['match_win_rate', 'Match win %', (v) => `${(v * 100).toFixed(1)}%`], ['game_win_rate', 'Games won %', (v) => `${(v * 100).toFixed(1)}%`]];
const BOARD_TIMEOUT_MS = 10000;
const NEXT = {
  live: { title: 'Live now', sub: 'Matches in progress — open PBEcast for the live court.', link: '/live', linkLabel: 'All live scores', label: 'live matches' },
  upcoming: { title: 'Up next', sub: 'Upcoming matches from today’s tournaments.', link: '/schedule', linkLabel: 'All matches', label: 'upcoming matches' },
  results: { title: 'Latest results', sub: 'Completed matches from the tournaments in progress.', link: '/schedule', linkLabel: 'All matches', label: 'latest results' }
};

export function mount(root) {
  const ctl = new AbortController();
  render(root, html`<div class="hm">
    <section class="hm-hero" aria-labelledby="hero-h">
      <picture class="hm-hero-bg" aria-hidden="true">
        <source media="(max-width: 600px)" type="image/avif" srcset="/brand/tennis-hero-mobile-900x1200.avif">
        <source media="(max-width: 600px)" type="image/webp" srcset="/brand/tennis-hero-mobile-900x1200.webp">
        <source type="image/avif" srcset="/brand/tennis-hero-1200.avif 1200w, /brand/tennis-hero-1600.avif 1600w, /brand/tennis-hero-2400.avif 2400w" sizes="100vw">
        <img src="/brand/tennis-hero-1600.webp" srcset="/brand/tennis-hero-1200.webp 1200w, /brand/tennis-hero-1600.webp 1600w, /brand/tennis-hero-2400.webp 2400w" sizes="100vw" width="1600" height="900" alt="" fetchpriority="high" decoding="async">
      </picture>
      <div class="hm-hero-in">
        <div class="hm-hero-copy">
          <p class="hm-badge">Real data · real-time systems · daily updates</p>
          <p class="eyebrow">PropBetEdge Tennis</p>
          <h1 id="hero-h"><span>Global Tennis</span> <em>Intelligence</em></h1>
          <p class="hm-hero-sub">ATP, WTA and the Grand Slams — singles, doubles and mixed. Live scores, results, PBEcast, Match DNA and player analytics, built on a data graph PropBetEdge collects, normalizes and owns.</p>
          <div class="hm-cta"><a class="hm-btn primary" href="/schedule">Explore today <span aria-hidden="true">→</span></a><a class="hm-btn" href="/pbecast">Watch PBEcast</a><a class="hm-btn" href="/news">Latest news</a></div>
        </div>
        <div class="hm-hero-media" data-hero-media></div>
        <ul class="hm-hero-index" aria-label="In PropBetEdge Tennis"><li><a href="/players">Players</a></li><li><a href="/tournaments">Tournaments</a></li><li><a href="/dna">Match DNA</a></li><li><a href="/pbecast">PBEcast</a></li></ul>
      </div>
    </section>
    <div class="hm-status" data-status aria-live="polite"><div class="hm-in"><p class="hm-st-msg">Checking live matches…</p>${tourLines(TOURS_PENDING, { state: 'pending' })}</div></div>
    <div data-lr>${section({ id: 'h-lr', hook: 'lrbody', title: 'Live & recent', sub: 'Live courts and the latest finals: PBEcast, how the market priced it and the official highlights.', link: '/pbecast', linkLabel: 'All PBEcasts' })}</div>
    <div data-next>${section({ id: 'h-next', ...NEXT.upcoming })}</div>
    ${section({ id: 'h-tours', hook: 'tours', title: 'Tournament coverage', sub: 'Live coverage, draws, results and intelligence for every tournament we cover.', link: '/tournaments', linkLabel: 'All tournaments', cls: 'hm-alt' })}
    ${section({ id: 'h-players', hook: 'players', title: 'Players to watch', sub: 'Grand Slam champions and finalists, then the ATP and WTA leaders.', link: '/players', linkLabel: 'All players' })}
    ${section({ id: 'h-news', hook: 'news', title: 'Latest intelligence', sub: 'Stories the newsroom publishes only when real data passes every factual check.', link: '/news', linkLabel: 'Newsroom', cls: 'hm-alt' })}
    ${section({ id: 'h-dna', hook: 'leaders', title: 'Tennis DNA leaders', sub: 'Match DNA from every singles result we hold — ATP and WTA compared only within their own tour.', link: '/dna', linkLabel: 'All Tennis DNA', dark: true, body: dnaColumnsSkeleton(HOME_DNA_BOARDS) })}
    ${section({ id: 'h-cast', hook: 'pbecast', title: 'PBEcast', sub: 'The analytical court for every covered match — live when a match is on, replays afterwards.', link: '/pbecast', linkLabel: 'All casts and replays', dark: true, cls: 'hm-cast' })}
    ${section({ id: 'h-cov', hook: 'cov', title: 'Coverage & sources', sub: 'What we hold, where it comes from, and what we do not show.', link: '/sources', linkLabel: 'Full sources & methodology', cls: 'hm-alt' })}
  </div>`);
  const $ = (s) => root.querySelector(s);
  wireRails(root, ctl.signal);
  let today = null;
  let slams = null;
  let wta = null;
  let atp = null;

  // live first; else upcoming; else the latest results (never an empty rail)
  const drawNext = () => {
    const el = $('[data-next]');
    if (!el || !today) return;
    const mode = today.live.length ? 'live' : today.upcoming.length ? 'upcoming' : today.latest_results?.length ? 'results' : null;
    if (!mode) { render(el, ''); return; }
    const src = { live: today.live, upcoming: today.upcoming, results: today.latest_results }[mode];
    const list = ensureEach(src, 10, menWomen).slice(0, 10);
    render(el, section({ id: 'h-next', ...NEXT[mode], body: rail(list.map(matchCard), { label: NEXT[mode].label, cls: 'hm-rail-match' }) }));
  };
  // LIVE & RECENT: live courts + the latest finals (replay, market close and official video indicators)
  let videos = {};
  const drawLR = () => {
    const el = $('[data-lrbody]');
    if (!el || !today) return;
    const items = liveRecentItems(today, videos);
    render(el, items.length ? rail(items, { label: 'live and recent matches', cls: 'hm-rail-match lr-rail' }) : html`<p class="hm-note">No live match and no recent final right now.</p>`);
    paintKalshiLines(el);
  };
  api('/v1/videos/recent', { signal: ctl.signal }).then((r) => { videos = r?.data || {}; drawLR(); }).catch(() => {});
  const drawTours = () => {
    const el = $('[data-tours]');
    if (!el || (!today && !slams)) return;
    const cur = orderTournaments(today?.tournaments || [], today?.live || []);
    const eds = latestSlams(slams?.editions || [], 3);
    render(el, html`${cur.length ? rail(cur.map((t) => tournamentCard(t)), { label: 'tournaments in progress', cls: 'hm-rail-t' }) : today ? html`<p class="hm-note">No covered tournament is in progress today.</p>` : ''}
      ${eds.length ? html`<p class="hm-sub">Latest Grand Slams</p>${rail(eds.map((e) => tournamentCard(e, { slam: true })), { label: 'Grand Slams', cls: 'hm-rail-t hm-rail-slam' })}` : ''}`);
  };
  const drawPlayers = () => {
    const el = $('[data-players]');
    if (!el || !slams || !wta || !atp) return;
    const list = playersToWatch(slams.featured || [], atp.data?.rows, wta.data?.rows, { limit: 12 });
    render(el, list.length ? rail(list.map(playerCard), { label: 'players to watch', cls: 'hm-rail-p' }) : html`<p class="hm-note">No players yet.</p>`);
  };
  const drawCast = () => {
    const el = $('[data-pbecast]');
    if (!el || (!today && !slams)) return;
    const live = today?.live || [];
    const replays = slams?.replays || [];
    const ed = slams?.replay_edition;
    render(el, html`${live.length ? pbecastLive(live[0]) : ''}
      ${replays.length ? html`<p class="hm-sub">Point-by-point replays${ed ? ` · ${ed.tournament} ${ed.year}` : ''}</p>${rail(replays.slice(0, 8).map((m) => replayCard(m, ed)), { label: 'PBEcast replays', cls: 'hm-rail-r' })}` : slams ? html`<p class="hm-note">No point-by-point replay is stored yet.</p>` : ''}`);
  };
  const refresh = async () => {
    let t = null;
    // Kalshi board for the match rail, read alongside /v1/today (bounded; a late board fills the rail's slots in place)
    const kb = kalshi.loadBoard();
    kb.then(() => { if (!ctl.signal.aborted) { paintKalshiLines($('[data-next]')); paintKalshiLines($('[data-lrbody]')); } }).catch(() => {});
    try { [t] = await Promise.all([api('/v1/today', { signal: ctl.signal }), bounded(kb)]); } catch (e) { if (ctl.signal.aborted) return; }
    const d = t?.data || null;
    const st = $('[data-status]');
    if (st) render(st, html`<div class="hm-in">${statusBar(d, liveGroups(d?.live), nextMatch(d?.upcoming), d ? tourStatus(d.live, d.upcoming) : null)}</div>`);
    if (!d) return;
    today = d;
    drawLR();
    drawNext();
    paintKalshiLines($('[data-next]'));
    drawTours();
    drawCast();
    const cov = $('[data-cov]');
    if (cov) render(cov, html`${coverageCards(d.coverage)}<p class="hm-note">ATP Challenger, ITF and official ATP feeds are not yet acquirable — we show nothing rather than something unsourced.</p>`);
  };
  refresh();
  const timer = setInterval(refresh, 60000);
  api('/v1/slams', { signal: ctl.signal }).then((r) => {
    slams = r?.data || {};
    const pick = heroPick(slams.featured);
    const hm = $('[data-hero-media]');
    if (hm && pick) { render(hm, heroMedia(pick)); hm.classList.add('has-photo'); }
    drawTours();
    drawPlayers();
    drawCast();
  }).catch(() => { slams = {}; drawTours(); drawPlayers(); drawCast(); });
  api('/v1/rankings?tour=wta&type=singles&limit=10', { signal: ctl.signal }).then((r) => { wta = r; drawPlayers(); }).catch(() => { wta = {}; drawPlayers(); });
  api('/v1/rankings?tour=atp&type=singles&limit=10', { signal: ctl.signal }).then((r) => { atp = r; drawPlayers(); }).catch(() => { atp = {}; drawPlayers(); });
  // Newsroom V3/V4: lead + up to 3 supporting stories, ATP and WTA both represented when both exist. Freshness is the
  // newsroom's own storyClock (a backfill shows its match date, never "N min ago").
  api('/v1/news?limit=20', { signal: ctl.signal }).catch(() => null).then((r) => {
    const el = $('[data-news]');
    if (!el) return;
    const list = ensureEach(r?.data?.articles || [], 6, (a) => storyTour(a));
    const { lead, majors } = hierarchy(list, { majors: 3 });
    render(el, lead
      ? html`<div class="hm-news">${leadStory(lead)}<div class="hm-news-side">${majors.map((a) => majorStory(a))}</div></div>`
      : html`<p class="hm-note">No story is published yet. The newsroom publishes only when a real event in our data passes every factual check — a quiet day publishes nothing.</p>`);
  });
  // Tennis DNA leaders: the columns are on screen (skeleton) from the first paint; each of the six boards fills its own
  // slot when its request resolves, so one slow or failed board never blanks the others. A board that does not answer
  // within BOARD_TIMEOUT_MS says so in its own slot. Every board states its qualification population.
  HOME_DNA_BOARDS.forEach(([metric, , fmt]) => ['atp', 'wta'].forEach((tour) => {
    const req = api(`/v1/dna/leaders?metric=${metric}&tour=${tour}&limit=5&preview=1`, { signal: ctl.signal }).then((x) => x?.data || null).catch(() => null);
    const late = new Promise((ok) => setTimeout(() => ok(undefined), BOARD_TIMEOUT_MS));
    const fill = (d) => {
      const slot = root.querySelector(`[data-dna-slot="${metric}:${tour}"]`);
      if (!slot || ctl.signal.aborted) return;
      render(slot, dnaBoard(metric, tour, fmt, d === undefined ? { show: false, rows: [], population: null, note: `${tour.toUpperCase()} board is taking longer than usual — it will appear here when it loads.` } : leaderBoard(d, { tour })));
      slot.removeAttribute('aria-busy');
    };
    Promise.race([req, late]).then((d) => { fill(d); if (d === undefined) req.then(fill); });
  }));
  return () => { ctl.abort(); clearInterval(timer); };
}
