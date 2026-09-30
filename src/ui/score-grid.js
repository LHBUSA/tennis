// Compact scoreboard for a match summary (homepage match cards, PBEcast live ticker):
//   PLAYER | SET 1 | SET 2 | SET 3 | POINT
// Both rows share one explicit column template, so set and point columns align between the sides and can never shrink;
// only the name column truncates. Columns exist only for sets the match has; the point column only while live with a
// served point score. Values are the API's (sets, live.point, live.server); nothing is derived beyond display.
// Styles: src/styles/home.css (.sg-*).

import { html } from '../lib/dom.js';
import { avatar, nat } from './avatar.js';

const DOUBLES = /D$/;
const lastName = (p) => p?.last_name || String(p?.name || '').split(' ').slice(-1)[0];

function setCell(x, s, cur) {
  const o = s === 'A' ? 'B' : 'A';
  if (x.match_tiebreak && x.tb) return html`<span class="sg-c${x.winner === s ? ' w' : ''}${cur ? ' cur' : ''}">${x.tb[s]}</span>`;
  const won = x.winner ? x.winner === s : false;
  const tb = x.tb && x.tb[s] < x.tb[o] ? html`<sup>${x.tb[s]}</sup>` : '';
  return html`<span class="sg-c${won ? ' w' : ''}${cur ? ' cur' : ''}">${x[s]}${tb}</span>`;
}

/**
 * m: an API match summary. opts.px: avatar size. opts.links: player names link to profiles (false inside a card that is
 * itself a link). Returns the grid (header + two rows).
 */
export function scoreGrid(m, { px = 28, links = true } = {}) {
  const live = m.status === 'in_progress';
  const sets = m.sets || [];
  const point = live && m.live?.point ? m.live.point : null;
  const server = live ? m.live?.server || null : null;
  const dbl = DOUBLES.test(m.event_type || '');
  const avW = dbl ? Math.round(px * 1.5) : px;
  const cols = `${avW}px minmax(0,1fr) 10px${' var(--sg-set)'.repeat(sets.length)}${point ? ' var(--sg-pt)' : ''}`;
  const style = `grid-template-columns:${cols}`;
  const row = (s) => {
    const ps = m.sides?.[s]?.players || [];
    const side = m.sides?.[s];
    const won = m.winner_side === s;
    const name = (p) => (links ? html`<a href="/players/${p.slug}">${dbl ? lastName(p) : p.name}</a>` : html`<b>${dbl ? lastName(p) : p.name}</b>`);
    const label = ps.map((p) => p.name).join(' / ');
    return html`<div class="sg-row${won ? ' won' : ''}${server === s ? ' is-srv' : ''}" style="${style}">
      <span class="sg-av">${ps.map((p) => avatar(p, { px }))}</span>
      <span class="sg-who" title="${label}">${dbl
        // doubles: one partner per line (surname + nationality), so a pair never truncates to a stub
        ? ps.map((p, i) => html`<span class="sg-nm">${name(p)}${p.nationality ? html` ${nat(p.nationality)}` : ''}${i === ps.length - 1 && side?.seed ? html` <small>[${side.seed}]</small>` : ''}</span>`)
        : html`<span class="sg-nm">${ps.map((p) => name(p))}</span>${ps.some((p) => p.nationality) || side?.seed ? html`<span class="sg-meta">${ps.map((p) => (p.nationality ? nat(p.nationality) : ''))}${side?.seed ? html` <small>[${side.seed}]</small>` : ''}</span>` : ''}`}</span>
      <span class="sg-srv">${server === s ? html`<i aria-hidden="true"></i><span class="sr">serving</span>` : ''}</span>
      ${sets.map((x, i) => setCell(x, s, live && i === sets.length - 1))}
      ${point ? html`<span class="sg-c sg-pt tabnum">${point[s] ?? ''}</span>` : ''}
    </div>`;
  };
  const head = sets.length || point
    ? html`<div class="sg-row sg-head" style="${style}" aria-hidden="true"><span></span><span></span><span></span>${sets.map((_, i) => html`<span class="sg-c${live && i === sets.length - 1 ? ' cur' : ''}">${i + 1}</span>`)}${point ? html`<span class="sg-c sg-pt">PT</span>` : ''}</div>`
    : '';
  return html`<div class="sg${live ? ' is-live' : ''}${dbl ? ' is-dbl' : ''}">${head}${row('A')}${row('B')}</div>`;
}
