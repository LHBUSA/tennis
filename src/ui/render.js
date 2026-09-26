// Data renderers. Everything shown comes from tennis-api payloads; nothing here invents a value.

import { html, raw } from '../lib/dom.js';
import { freshnessBadge } from './state.js';
import { initials } from './identity-card.js';

const EVENT = { MS: "Men's singles", WS: "Women's singles", MD: "Men's doubles", WD: "Women's doubles", XD: 'Mixed doubles' };
export const eventLabel = (e) => EVENT[e] || e;

/** Source round codes -> label. Stage prefix Q- = qualifying. Numeric rounds count from the first round. */
export function roundLabel(code) {
  const [stage, r] = String(code || '').includes('-') ? String(code).split('-') : ['M', String(code || '')];
  const base = { Q: 'Quarterfinal', S: 'Semifinal', F: 'Final' }[r] || (/^\d+$/.test(r) ? `Round ${r}` : r || 'Round');
  return stage === 'Q' ? `Qualifying ${base.replace('Round ', 'R')}` : base;
}

export const surfaceClass = (s) => (s ? `surf-${s}` : '');

function names(side) {
  return html`${(side?.players || []).map((p, i) => html`${i ? html`<span class="sep"> / </span>` : ''}<a class="pl" href="/players/${p.slug}">${p.name}</a>${p.nationality ? html` <span class="nat">${p.nationality}</span>` : ''}`)}`;
}

const STATUS = { in_progress: 'LIVE', scheduled: 'UPCOMING', completed: 'FINAL', retired: 'RET.', walkover: 'W/O', suspended: 'SUSP.' };

/** One match: two rows (A, B) with set scores. */
export function matchCard(m, { showTournament = true } = {}) {
  const live = m.status === 'in_progress';
  const setCell = (s, side) => {
    if (s.match_tiebreak && s.tb) return html`<td class="g${s.winner === side ? ' w' : ''}">${s.tb[side]}</td>`;
    const tb = s.tb && Math.min(s.tb.A, s.tb.B) === s.tb[side] ? html`<sup>${s.tb[side]}</sup>` : '';
    return html`<td class="g${s.winner === side ? ' w' : ''}">${s[side]}${tb}</td>`;
  };
  const row = (side) => html`<tr class="${m.winner_side === side ? 'win' : ''}">
    <th scope="row"><span class="seed">${m.sides?.[side]?.seed ? `[${m.sides[side].seed}]` : ''}</span> ${names(m.sides?.[side])}${live && m.live?.server === side ? html` <span class="srv" title="Serving">●</span>` : ''}</th>
    ${(m.sets || []).map((s) => setCell(s, side))}
    ${live ? html`<td class="pt">${m.live?.point?.[side] ?? ''}</td>` : ''}
  </tr>`;
  return html`<article class="mc ${live ? 'is-live' : ''}">
    <header class="mc-h"><span class="st st-${m.status}">${STATUS[m.status] || m.status}</span>
      <span>${eventLabel(m.event_type)} · ${roundLabel(m.round)}</span>
      ${showTournament && m.tournament ? html`<a href="/tournaments/${m.tournament.slug}/${m.tournament.year}" class="mc-t">${m.tournament.tournament}</a>` : ''}
    </header>
    <table class="mc-s"><tbody>${row('A')}${row('B')}</tbody></table>
    <footer class="mc-f">${m.status === 'scheduled' ? html`${m.court || ''}${m.schedule_note ? ` · ${m.schedule_note}` : ''}` : ''}${m.duration_s ? html`${fmtDuration(m.duration_s)}` : ''}<a href="/matches/${m.id}">Match Lab →</a></footer>
  </article>`;
}

export function fmtDuration(s) {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function matchList(matches, opts) {
  return html`<div class="mcs">${matches.map((m) => matchCard(m, opts))}</div>`;
}

export function tournamentRow(t) {
  return html`<a class="tr ${surfaceClass(t.surface)}" href="/tournaments/${t.slug}/${t.year}">
    <span class="tr-l">${t.level || ''}</span>
    <b>${t.tournament}</b>
    <span class="tr-d">${fmtRange(t.start_date, t.end_date)}${t.surface ? ` · ${cap(t.surface)}${t.indoor ? ' (indoor)' : ''}` : ''}</span>
    ${t.status === 'live' || t.status === 'inProgress' ? html`<span class="st st-in_progress">IN PROGRESS</span>` : ''}
  </a>`;
}

const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
export function fmtDate(d) {
  return d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
}
export function fmtRange(a, b) {
  if (!a) return '';
  const o = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return `${new Date(`${a}T00:00:00Z`).toLocaleDateString('en-US', o)} – ${new Date(`${b}T00:00:00Z`).toLocaleDateString('en-US', { ...o, year: 'numeric' })}`;
}

export function rankingTable(d) {
  return html`<div class="rk-wrap"><table class="rk">
    <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col" class="n">Points</th><th scope="col" class="n">Move</th></tr></thead>
    <tbody>${d.rows.map((r) => {
      const mv = r.previous_rank == null ? null : r.previous_rank - r.rank;
      return html`<tr><td class="rk-n">${r.rank}</td><td><a href="/players/${r.player.slug}">${r.player.name}</a> <span class="nat">${r.player.nationality || ''}</span></td><td class="n">${r.points == null ? '—' : r.points.toLocaleString('en-US')}</td><td class="n mv ${mv > 0 ? 'up' : mv < 0 ? 'down' : ''}">${mv == null ? '—' : mv === 0 ? '=' : mv > 0 ? `▲${mv}` : `▼${-mv}`}</td></tr>`;
    })}</tbody>
  </table></div>`;
}

/** Rank history (lower is better, so the axis is inverted). Pure SVG, only real archived points. */
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
    <figcaption>${fmtDate(pts[0].date)}: No. ${pts[0].rank} → ${fmtDate(pts[pts.length - 1].date)}: No. ${pts[pts.length - 1].rank} · best ${lo} · ${pts.length} weekly lists</figcaption></figure>`;
}

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
export function dnaTable(dna) {
  const rows = Object.values(dna.metrics || {});
  return html`<div class="rk-wrap"><table class="dna">
    <thead><tr><th scope="col">Metric</th><th scope="col" class="n">Value</th><th scope="col" class="n">Sample</th><th scope="col">Confidence</th></tr></thead>
    <tbody>${rows.map((m) => html`<tr><th scope="row"><code>${m.metric_key}</code></th><td class="n">${pct(m.value)}</td><td class="n">${m.numerator == null ? '—' : `${m.numerator}/${m.denominator}`} · ${m.sample_matches} m</td><td><span class="conf c-${m.confidence}">${m.confidence}</span></td></tr>`)}</tbody>
  </table></div>`;
}

const STAT_ROWS = [
  ['Aces', (s) => s.aces], ['Double faults', (s) => s.double_faults],
  ['1st serve in', (s) => ratio(s.first_serves_in, s.service_points)],
  ['1st serve points won', (s) => ratio(s.first_serve_points_won, s.first_serves_in)],
  ['2nd serve points won', (s) => ratio(s.second_serve_points_won, s.service_points - s.first_serves_in)],
  ['Break points saved', (s) => (s.break_points_faced == null ? null : `${s.break_points_saved}/${s.break_points_faced}`)],
  ['Service games', (s) => s.service_games], ['Total points won', (s) => s.total_points_won]
];
function ratio(n, d) { return n == null || !d ? null : `${n}/${d} (${Math.round((n / d) * 100)}%)`; }
export function statsCompare(m) {
  const A = m.statistics?.A, B = m.statistics?.B;
  if (!A || !B) return null;
  const nameOf = (side) => (m.sides?.[side]?.players || []).map((p) => p.name?.split(' ').slice(-1)[0]).join(' / ');
  return html`<div class="rk-wrap"><table class="cmp"><thead><tr><th scope="col" class="n">${nameOf('A')}</th><th scope="col"></th><th scope="col">${nameOf('B')}</th></tr></thead>
    <tbody>${STAT_ROWS.map(([label, f]) => html`<tr><td class="n">${f(A) ?? '—'}</td><th scope="row">${label}</th><td>${f(B) ?? '—'}</td></tr>`)}</tbody></table></div>`;
}

export function playerHero(p, meta) {
  const age = p.dob ? Math.floor((Date.now() - Date.parse(`${p.dob}T00:00:00Z`)) / (365.2425 * 86400000)) : null;
  const r = p.rankings || {};
  return html`<header class="ph">
    <figure class="idcard is-portrait" aria-hidden="true"><span class="idcard-ini">${initials(p.name)}</span>${p.nationality ? html`<figcaption class="idcard-nat">${p.nationality}</figcaption>` : ''}</figure>
    <div class="ph-b">
      <p class="eyebrow">${p.gender === 'F' ? 'WTA' : p.gender === 'M' ? 'ATP' : 'Player'}${p.nationality ? ` · ${p.nationality}` : ''}</p>
      <h1>${p.name}</h1>
      <dl class="ph-f">
        ${r.wta_singles ? html`<div><dt>WTA singles</dt><dd>No. ${r.wta_singles.rank}<small>${r.wta_singles.points?.toLocaleString('en-US')} pts · ${fmtDate(r.wta_singles.date)}</small></dd></div>` : ''}
        ${r.wta_doubles ? html`<div><dt>WTA doubles</dt><dd>No. ${r.wta_doubles.rank}<small>${fmtDate(r.wta_doubles.date)}</small></dd></div>` : ''}
        ${age != null ? html`<div><dt>Age</dt><dd>${age}<small>born ${fmtDate(p.dob)}</small></dd></div>` : ''}
      </dl>
      <p class="note">${freshnessBadge(meta)} No licensed photo approved yet — identity card shown.</p>
    </div>
  </header>`;
}
