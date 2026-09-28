// Player DNA profile presentation (Phase 6): rating history chart, rolling windows and splits. Renders ONLY the stored
// profile from /v1/players/:slug/dna (built server-side from the canonical ledger); never computes a comparison or
// fills a gap in the browser. Small samples are shown and labelled, never ranked.
import { html, raw } from '../lib/dom.js';
import { fmtDate } from './render.js';

const pc = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const wae = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}`);
const n = (x) => x.W + x.L;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/**
 * SVG rating chart from stored monthly points ([month, rating, rated_matches]). Idle months are gaps on the time
 * axis (no interpolated points are drawn: markers sit only on months played). Peak and 3-month swings annotated.
 */
export function ratingChart(h, { label = 'PBE Rating history', min = 3 } = {}) {
  const s = h?.series || [];
  if (s.length < min) return html`<p class="note">${s.length ? `${s.length} monthly point${s.length === 1 ? '' : 's'} so far — the chart appears once there are ${min}.` : 'No rating history stored yet.'}</p>`;
  const W = 720; const H = 240; const L = 48; const R = 14; const T = 16; const B = 30;
  const t = (m) => { const [y, mo] = m.split('-').map(Number); return y * 12 + mo - 1; };
  const t0 = t(s[0][0]); const t1 = Math.max(t(s.at(-1)[0]), t0 + 1);
  const vals = s.map((p) => p[1]);
  const lo = Math.floor((Math.min(...vals) - 20) / 50) * 50; const hi = Math.ceil((Math.max(...vals) + 20) / 50) * 50;
  const x = (m) => L + ((t(m) - t0) * (W - L - R)) / (t1 - t0);
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo || 1);
  // a gap of more than 6 months without a match breaks the line (no bridge drawn across a long absence)
  let d = '';
  s.forEach((p, i) => { const gap = i && t(p[0]) - t(s[i - 1][0]) > 6; d += `${!i || gap ? 'M' : 'L'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`; });
  const step = Math.max(50, Math.ceil((hi - lo) / 4 / 50) * 50);
  const grid = []; for (let v = lo; v <= hi; v += step) grid.push(v);
  const years = []; for (let yy = Math.ceil(t0 / 12); yy * 12 <= t1; yy += Math.max(1, Math.ceil((t1 - t0) / 12 / 8))) years.push(yy);
  const mark = (day, v, cls, text, anchor = 'middle') => { const m = day.slice(0, 7); return `<g class="rc-mk ${cls}"><circle cx="${x(m).toFixed(1)}" cy="${y(v).toFixed(1)}" r="5"/><text x="${x(m).toFixed(1)}" y="${(y(v) - 10).toFixed(1)}" text-anchor="${anchor}">${text}</text></g>`; };
  const anchorOf = (day) => { const px = x(day.slice(0, 7)); return px < L + 60 ? 'start' : px > W - 60 ? 'end' : 'middle'; };
  const cur = s.at(-1);
  const svg = `<svg class="rc" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}: from ${s[0][1]} (${monthLabel(s[0][0])}) to ${cur[1]} (${monthLabel(cur[0])})${h.peak ? `, peak ${h.peak.rating}` : ''}">
    ${grid.map((v) => `<line class="rc-g" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="rc-y" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}
    ${years.map((yy) => `<text class="rc-x" x="${x(`${yy}-01`).toFixed(1)}" y="${H - 8}" text-anchor="middle">${yy}</text>`).join('')}
    <path class="rc-l" d="${d}"/>
    ${s.map((p) => `<circle class="rc-p" cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="2.2"><title>${monthLabel(p[0])}: ${p[1]}${p[2] != null ? ` · ${p[2]} rated matches` : ''}</title></circle>`).join('')}
    ${h.gain_3m ? mark(h.gain_3m.to, h.gain_3m.to_rating, 'up', `+${h.gain_3m.change}`, anchorOf(h.gain_3m.to)) : ''}
    ${h.drop_3m ? mark(h.drop_3m.to, h.drop_3m.to_rating, 'down', `${h.drop_3m.change}`, anchorOf(h.drop_3m.to)) : ''}
    ${h.peak ? mark(h.peak.day, h.peak.rating, 'peak', `Peak ${h.peak.rating}`, anchorOf(h.peak.day)) : ''}
  </svg>`;
  return html`<figure class="rc-fig">${raw(svg)}
    <figcaption><span><i class="k peak"></i>Peak ${h.peak ? `${h.peak.rating} · ${fmtDate(h.peak.day)}` : '—'}</span>
      <span><i class="k up"></i>Biggest 3-month gain ${h.gain_3m ? `+${h.gain_3m.change} (${fmtDate(h.gain_3m.from)} – ${fmtDate(h.gain_3m.to)})` : '—'}</span>
      <span><i class="k down"></i>Biggest 3-month drop ${h.drop_3m ? `${h.drop_3m.change} (${fmtDate(h.drop_3m.from)} – ${fmtDate(h.drop_3m.to)})` : '—'}</span></figcaption></figure>`;
}

const splitRow = (label, x, min) => html`<tr class="${n(x) < min ? 'small' : ''}"><th scope="row">${label}${n(x) < min ? html` <span class="tag">small sample</span>` : ''}</th><td class="n tabnum">${x.W}–${x.L}</td><td class="n tabnum">${n(x) ? `${Math.round((x.W / n(x)) * 100)}%` : '—'}</td><td class="n tabnum hide-s">${pc(x.set)}</td><td class="n tabnum hide-s">${pc(x.game)}</td><td class="n tabnum">${wae(x.wae)}${x.n_rated ? html`<small class="note"> · ${x.n_rated}</small>` : ''}</td></tr>`;
const splitTable = (rows, min) => html`<div class="tbl-wrap"><table class="tbl split-tbl"><thead><tr><th>Split</th><th class="n">W–L</th><th class="n">Win %</th><th class="n hide-s">Sets</th><th class="n hide-s">Games</th><th class="n" title="wins above expectation per rated match (opponent-adjusted)">vs expectation</th></tr></thead><tbody>${rows.map(([l, x]) => splitRow(l, x, min))}</tbody></table></div>`;

const STRENGTH = [['stronger', 'vs stronger (opponent rated 100+ higher)'], ['similar', 'vs similar (within 100)'], ['weaker', 'vs weaker (100+ lower)'], ['unrated', 'Opponent or player not yet rated']];
const HAND = [['left', 'vs left-handers'], ['right', 'vs right-handers'], ['unknown', 'Opponent hand not sourced']];
const ROUNDS = [['qualifying', 'Qualifying'], ['round_robin', 'Round robin'], ['early', 'Early rounds (R1–R2)'], ['middle', 'Middle rounds (R3–R4)'], ['quarterfinal', 'Quarterfinals'], ['semifinal', 'Semifinals'], ['final', 'Finals'], ['unknown', 'Round not recorded']];
const LEVEL = { grand_slam: 'Grand Slams', atp_finals: 'ATP Finals', wta_finals: 'WTA Finals', olympics: 'Olympics', unclassified: 'Level not given by the source' };
const pick = (o, keys) => keys.filter(([k]) => o?.[k]).map(([k, l]) => [l, o[k]]);

/** Rolling windows + archetype / level / round splits. */
export function profileBlock(p, defs, asOf) {
  if (!p) return '';
  const min = defs?.min_sample ?? 10;
  const win = ['5w', '10w', '20w', '52w'].filter((k) => p.windows?.[k]);
  return html`<section class="mod"><header class="mod-h"><h2>Form windows</h2><span class="mod-k">rolling · as of ${fmtDate(asOf)}</span></header>
      <div class="win-grid">${win.map((k) => { const w = p.windows[k]; return html`<div class="win ${n(w) < min ? 'small' : ''}"><span>Last ${k.replace('w', '')} weeks</span><b class="tabnum">${w.W}–${w.L}</b><small>${n(w) ? `${Math.round((w.W / n(w)) * 100)}% wins` : 'no matches'}${w.wae != null ? ` · ${wae(w.wae)} vs expectation` : ''}</small></div>`; })}</div>
      <p class="note">${defs?.windows || ''}. “vs expectation” = wins above the PBE Rating’s pre-match expectation per rated match: positive means the player beat the odds the rating gave them.</p></section>
    <section class="mod"><header class="mod-h"><h2>Opponent archetypes</h2><span class="mod-k">strength · handedness</span></header>
      ${splitTable([...pick(p.vs_strength, STRENGTH), ...pick(p.vs_hand, HAND)], min)}
      <p class="note">${defs?.vs_strength || ''}. ${defs?.vs_hand || ''}. Style archetypes (big server, counter-puncher…) are not shown: ${String(defs?.style_archetypes || '').replace(/^not available: /, '')}.</p></section>
    <section class="mod"><header class="mod-h"><h2>Tournament level &amp; round</h2></header>
      ${splitTable([...Object.entries(p.by_level || {}).sort((a, b) => n(b[1]) - n(a[1])).map(([k, x]) => [LEVEL[k] || k.replace(/_/g, ' '), x]), ...pick(p.by_round, ROUNDS)], min)}
      <p class="note">${defs?.by_level || ''}. Rows with fewer than ${min} matches are small samples: shown for completeness, never ranked.</p></section>`;
}
