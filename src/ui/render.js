// Data renderers. Everything shown comes from tennis-api payloads; nothing here invents a value.

import { html, raw } from '../lib/dom.js';
import { avatar, nat } from './avatar.js';
import { kalshiLineEligible, kalshiCloseEligible, kalshiLineFor } from '../data/kalshi.js';

const EVENT = { MS: "Men's singles", WS: "Women's singles", MD: "Men's doubles", WD: "Women's doubles", XD: 'Mixed doubles' };
export const eventLabel = (e) => EVENT[e] || e;

/** Source round codes -> label. Stage prefix Q- = qualifying. Numeric rounds count from the first round. */
export function roundLabel(code) {
  const [stage, r] = String(code || '').includes('-') ? String(code).split('-') : ['M', String(code || '')];
  const base = { Q: 'Quarterfinal', S: 'Semifinal', F: 'Final' }[r] || (/^\d+$/.test(r) ? `Round ${r}` : r || 'Round');
  return stage === 'Q' ? `Qualifying ${base.replace('Round ', 'R')}` : base;
}

export const surfaceClass = (s) => (s ? `surf-${s}` : '');
export const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
const STATUS = { superseded: 'Duplicate record (superseded)', in_progress: 'Live', scheduled: 'Upcoming', completed: 'Final', retired: 'Ret.', walkover: 'W/O', suspended: 'Suspended' };
export const statusLabel = (s) => STATUS[s] || s;

export function fmtDate(d) {
  return d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
}
export function fmtRange(a, b) {
  if (!a) return '';
  const o = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return `${new Date(`${a}T00:00:00Z`).toLocaleDateString('en-US', o)} – ${new Date(`${b}T00:00:00Z`).toLocaleDateString('en-US', { ...o, year: 'numeric' })}`;
}
/** User-local time for a full timestamp (never for a date-less source time). */
export function localTime(iso) {
  if (!iso || !/T\d{2}:\d{2}/.test(iso)) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
export function fmtDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

const names = (side) => html`${(side?.players || []).map((p) => html`<a href="/players/${p.slug}">${p.name}</a>`)}`;

/** PBEcast lifecycle CTA: scheduled -> soon, live -> watch, final -> replay. */
export function pbecastCta(m) {
  if (m.status === 'in_progress' || m.status === 'suspended') return html`<a class="live" href="/pbecast/${m.id}">Watch PBEcast</a>`;
  if (['completed', 'retired'].includes(m.status)) return html`<a href="/pbecast/${m.id}">Replay PBEcast</a>`;
  return '';
}

/** Upcoming singles with both players identified and a start not yet stale (the matchup API's own rule): link the dossier. */
export const hasMatchup = (m, now = Date.now()) => m?.status === 'scheduled' && ['MS', 'WS'].includes(m.event_type) && m.sides?.A?.players?.length === 1 && m.sides?.B?.players?.length === 1 && !!m.scheduled_at && Date.parse(m.scheduled_at) >= now - 6 * 3600e3;
export const matchupLink = (m, cls = 'mi-link') => (hasMatchup(m) ? html`<a class="${cls}" href="/matchups/${m.id}">Matchup Intelligence →</a>` : '');
/** Kalshi prediction-market line for a match still to be decided: a slot filled from the board (empty = hidden). */
// A decided match gets the subtle "how the market closed" line only when the loaded board already has a recorded close
// for it (no slot otherwise: long result lists stay lean and nothing appears late on a result card).
export const kalshiSlot = (m, cls = 'mc-kx') => {
  if (kalshiLineEligible(m)) return html`<div class="${cls}" data-kx-line="${m.id}">${raw(kalshiLineFor(m))}</div>`;
  const close = kalshiCloseEligible(m) ? kalshiLineFor(m) : '';
  return close ? html`<div class="${cls}" data-kx-line="${m.id}" data-kx-close>${raw(close)}</div>` : '';
};
export function matchCard(m, { showTournament = true, kalshi = true } = {}) {
  const live = m.status === 'in_progress';
  const sc = (side) => html`<div class="mc-sc tabnum">${(m.sets || []).map((s) => {
    if (s.match_tiebreak && s.tb) return html`<span class="${s.winner === side ? 'w' : ''}">${s.tb[side]}</span>`;
    const tb = s.tb && Math.min(s.tb.A, s.tb.B) === s.tb[side] ? html`<sup>${s.tb[side]}</sup>` : '';
    return html`<span class="${s.winner === side ? 'w' : ''}">${s[side]}${tb}</span>`;
  })}${live ? html`<span class="pt">${m.live?.point?.[side] ?? ''}</span>` : ''}</div>`;
  const row = (side) => html`<div class="mc-row ${m.winner_side === side ? 'win' : ''}">
    <span class="mc-av">${(m.sides?.[side]?.players || []).map((p) => avatar(p, { px: 32 }))}</span>
    <div class="mc-names">${names(m.sides?.[side])}<span class="seed">${m.sides?.[side]?.seed ? `[${m.sides[side].seed}] ` : ''}${(m.sides?.[side]?.players || []).map((p) => p.nationality).filter(Boolean).join(' / ')}${live && m.live?.server === side ? html`<span class="srv" title="Serving"></span><span class="sr">serving</span>` : ''}</span></div>
    ${sc(side)}
  </div>`;
  const when = m.status === 'scheduled' ? [localTime(m.scheduled_at), m.court, m.schedule_note].filter(Boolean).join(' · ') : m.duration_s ? fmtDuration(m.duration_s) : '';
  return html`<article class="mc ${live ? 'is-live' : ''}">
    <header class="mc-h"><span class="st st-${m.status}">${statusLabel(m.status)}</span>
      <span>${eventLabel(m.event_type)} · ${roundLabel(m.round)}</span>
      ${showTournament && m.tournament ? html`<a href="/tournaments/${m.tournament.slug}/${m.tournament.year}" class="mc-t">${m.tournament.tournament}</a>` : ''}
    </header>
    ${row('A')}${row('B')}
    ${kalshi ? kalshiSlot(m) : ''}
    <footer class="mc-f"><span>${when}</span><span class="mc-cta">${matchupLink(m)}${pbecastCta(m)}<a href="/matches/${m.id}">Match</a></span></footer>
  </article>`;
}

export function matchList(matches, opts) {
  return html`<div class="mcs">${matches.map((m) => matchCard(m, opts))}</div>`;
}

/** Category label: the source's own level, else the tour we proved (ATP editions carry no level from ESPN). */
export const tourLabel = (t) => t?.level || (t?.tour === 'atp' ? 'ATP Tour' : '');

export function tournamentRow(t) {
  const where = [t.city, t.country].filter(Boolean).join(', ');
  return html`<a class="tr ${surfaceClass(t.surface)}" href="/tournaments/${t.slug}/${t.year}">
    <span class="tr-l">${tourLabel(t)}${t.surface ? ` · ${t.surface}` : ''}${t.indoor ? ' · indoor' : ''}</span>
    <b>${t.tournament}</b>
    <span class="tr-d">${fmtRange(t.start_date, t.end_date)}${where ? ` · ${where}` : ''}</span>
    ${t.status === 'live' || t.status === 'inProgress' ? html`<span class="st st-in_progress">Live</span>` : ''}
  </a>`;
}

export function rankingTable(d, { compact = false } = {}) {
  return html`<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th scope="col" style="width:${compact ? 44 : 60}px">#</th><th scope="col">Player</th><th scope="col" class="n" style="width:${compact ? 80 : 100}px">Points</th>${compact ? '' : html`<th scope="col" class="n hide-s" style="width:70px">Move</th>`}</tr></thead>
    <tbody>${d.rows.map((r) => {
      const mv = r.previous_rank == null ? null : r.previous_rank - r.rank;
      return html`<tr><td class="rk-n">${r.rank}</td><td>${r.player ? html`<span class="rk-p">${avatar(r.player, { px: 32 })}<a href="/players/${r.player.slug}">${r.player.name}</a> ${nat(r.player.nationality)}</span>` : html`<span class="note">Identity not yet proven</span>`}</td><td class="n">${r.points == null ? '—' : r.points.toLocaleString('en-US')}</td>${compact ? '' : html`<td class="n mv hide-s ${mv > 0 ? 'up' : mv < 0 ? 'down' : ''}">${mv == null ? '—' : mv === 0 ? '=' : mv > 0 ? `▲${mv}` : `▼${-mv}`}</td>`}</tr>`;
    })}</tbody>
  </table></div>`;
}

/** Rank history (lower is better, so the axis is inverted). Only real archived points. */
export function rankSpark(history, list) {
  const pts = history.filter((h) => h.list === list).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (pts.length < 2) return html`<p class="note">${pts.length ? `One archived list so far (${fmtDate(pts[0].date)}: No. ${pts[0].rank}). The trend appears as weekly lists accumulate.` : 'No archived ranking lists yet.'}</p>`;
  const W = 600, H = 120, P = 8;
  const ranks = pts.map((p) => p.rank);
  const lo = Math.min(...ranks), hi = Math.max(...ranks);
  const x = (i) => P + (i * (W - 2 * P)) / (pts.length - 1);
  const y = (r) => (hi === lo ? H / 2 : P + ((r - lo) * (H - 2 * P)) / (hi - lo));
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(' ');
  return html`<figure class="spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Ranking history">${raw(`<path d="${d}" />`)}</svg>
    <figcaption>${fmtDate(pts[0].date)}: No. ${pts[0].rank} → ${fmtDate(pts[pts.length - 1].date)}: No. ${pts[pts.length - 1].rank} · best ${lo} · ${pts.length} weekly lists archived</figcaption></figure>`;
}

export const pct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);

/** Radar of stored DNA percentiles (null percentiles are drawn at the centre and labelled n/a). */
export function dnaRadar(dims, other = null) {
  const N = dims.length;
  const R = 120, C = 170;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const pt = (i, r) => [C + Math.cos(ang(i)) * r, C + Math.sin(ang(i)) * r];
  const ring = (f) => dims.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(',')).join(' ');
  const area = (ds) => ds.map((d, i) => pt(i, R * ((d.percentile ?? 0) / 100)).map((v) => v.toFixed(1)).join(',')).join(' ');
  const labels = dims.map((d, i) => { const [x, y] = pt(i, R + 26); return `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="middle" dominant-baseline="middle">${d.label}${d.percentile == null ? ' (n/a)' : ''}</text>`; }).join('');
  return raw(`<svg class="radar" viewBox="-50 0 440 340" role="img" aria-label="Tennis DNA percentiles">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<polygon class="grid" points="${ring(f)}"/>`).join('')}
    ${dims.map((_, i) => { const [x, y] = pt(i, R); return `<line class="axis" x1="${C}" y1="${C}" x2="${x}" y2="${y}"/>`; }).join('')}
    <polygon class="area" points="${area(dims)}"/>
    ${other ? `<polygon class="area b" points="${area(other)}"/>` : ''}
    ${labels}</svg>`);
}

export function dnaBars(dims) {
  return html`<div class="bars">${dims.map((d) => html`<div class="bar"><span>${d.label}</span><i><b style="width:${d.percentile ?? 0}%"></b></i><span class="v">${d.percentile == null ? html`<span class="conf c-${d.confidence}">${d.confidence}</span>` : `${d.percentile}th`}</span></div>`)}</div>`;
}

/** Grand Slam edition row, tournament first; the five events are context, never separate products. */
const SLAM_EVENTS = [['MS', 'men’s singles', 'mens-singles'], ['WS', 'women’s singles', 'womens-singles'], ['MD', 'men’s doubles', 'mens-doubles'], ['WD', 'women’s doubles', 'womens-doubles'], ['XD', 'mixed', 'mixed-doubles'], ['qualifying', 'qualifying', 'qualifying']];
export function slamRow(e) {
  const c = e.counts || {};
  const parts = SLAM_EVENTS.filter(([k]) => c[k]).map(([k, l]) => `${Number(c[k]).toLocaleString('en-US')} ${l}`).join(' · ');
  return html`<a class="tr ${surfaceClass(e.surface)}" href="/tournaments/${e.slug}/${e.year}">
    <span class="tr-l">Grand Slam${e.surface ? ` · ${e.surface}` : ''}</span>
    <b>${e.tournament} ${e.year}</b>
    <span class="tr-d">${parts}${c.point_by_point ? html` · <em class="men-pbp">${Number(c.point_by_point).toLocaleString('en-US')} with point-by-point</em>` : ''}</span>
  </a>`;
}
