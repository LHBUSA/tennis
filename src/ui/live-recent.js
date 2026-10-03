// Homepage LIVE & RECENT: live matches (live PBEcast + the shared market line) followed by recent finals (winner-side
// result, PBEcast replay only when events are stored, the shared "how the market closed" line, official highlights).
// Market state comes ONLY from the shared Kalshi board (kalshiSlot -> paintKalshiLines); nothing is hard-coded here.
import { html } from '../lib/dom.js';
import { scoreGrid } from './score-grid.js';
import { kalshiSlot, roundLabel, eventLabel } from './render.js';
import { tourTag, tournamentName, roundShort } from '../lib/home.js';
import { orderLive } from '../lib/pbecast-live.js';

const FINAL = new Set(['completed', 'retired']);
const nm = (m, s) => (m.sides?.[s]?.players || []).map((p) => p.last_name || String(p.name || '').split(' ').slice(-1)[0]).join(' / ');
const winnerScore = (m) => String(m.score || '').split(/\s+/).map((t) => (m.winner_side === 'B' ? t.replace(/^(\d+)-(\d+)/, (_, a, b) => `${b}-${a}`) : t)).join(' ');
const VIDEO = { full_match: 'Full match replay', extended_highlights: 'Extended highlights', match_highlights: 'Highlights', interview: 'Interview' };

export function liveRecentCard(m, video = null) {
  const live = m.status === 'in_progress';
  const t = m.tournament;
  const head = html`<p class="hm-mh1">${tourTag(m.tour) ? html`<span class="hm-tag">${tourTag(m.tour)}</span>` : ''}${t ? html`<span class="hm-mt" title="${tournamentName(t)}">${tournamentName(t)}</span>` : ''}<span class="hm-mr" title="${eventLabel(m.event_type)} · ${roundLabel(m.round)}">${roundShort(m.round)}</span></p>`;
  if (live) {
    return html`<article class="hm-card lr-card is-live" data-lr="live">
      <header class="hm-mh"><span class="lr-chip lr-live"><i class="hm-dot" aria-hidden="true"></i>LIVE</span>${head}</header>
      ${scoreGrid(m, { links: false })}
      ${kalshiSlot(m, 'hm-kx')}
      <footer class="lr-ft"><a class="hm-go hm-go-cast" href="/pbecast/${m.id}">Live PBEcast <span aria-hidden="true">→</span></a></footer>
    </article>`;
  }
  const w = m.winner_side;
  const l = w === 'A' ? 'B' : 'A';
  return html`<article class="hm-card lr-card" data-lr="final">
    <header class="hm-mh"><span class="lr-chip">${m.status === 'retired' ? 'FINAL · RET.' : 'FINAL'}</span>${head}</header>
    <p class="lr-res"><b>${nm(m, w)}</b> def. ${nm(m, l)} <span class="tabnum">${winnerScore(m)}</span></p>
    ${kalshiSlot(m, 'hm-kx')}
    <footer class="lr-ft">${m.replay ? html`<a class="hm-go hm-go-cast" href="/pbecast/${m.id}">PBEcast replay <span aria-hidden="true">→</span></a>` : html`<a class="hm-go" href="/matches/${m.id}">Match <span aria-hidden="true">→</span></a>`}${video ? html`<a class="lr-badge lr-video" href="/pbecast/${m.id}#pbc-watch">▶ ${VIDEO[video.best] || 'Video'}</a>` : ''}</footer>
  </article>`;
}

/** Live first (deterministic court order), then the latest finals with a winner; walkovers are not "recent finals". */
export function liveRecentItems(today, videos = {}, { finals = 10 } = {}) {
  const live = orderLive(today?.live || []);
  // newest finals, men's and women's events interleaved (the newest rows are often one tour's batch of results)
  const done = (today?.latest_results || []).filter((m) => FINAL.has(m.status) && m.winner_side);
  const men = done.filter((m) => /^M/.test(m.event_type || ''));
  const women = done.filter((m) => /^W/.test(m.event_type || ''));
  const other = done.filter((m) => !/^[MW]/.test(m.event_type || ''));
  const recent = [];
  for (let i = 0; recent.length < finals && (i < men.length || i < women.length || i < other.length); i += 1) for (const g of [women, men, other]) if (g[i] && recent.length < finals) recent.push(g[i]);
  return [...live, ...recent].map((m) => liveRecentCard(m, videos[m.id] || null));
}
