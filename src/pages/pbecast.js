// PBEcast — live analytical court + replay engine. docs/TENNISCAST.md.
//
// Modes (from tennis-api, never guessed here):
//   point_by_point_live / point_by_point_replay — every event is a source-published point
//   observed_live / observed_replay             — periodic observations; one card per observed change
//   scheduled / result_only                     — no event stream to show
// The page never renders a point reason, serve speed, rally length or ball position that the event does
// not carry. Replay walks the stored events only. Live polling: every 15 s (source cadence ~18 s),
// re-rendering only when a new event arrives.

import { html, render, raw } from '../lib/dom.js';
import { api } from '../data/api.js';
import { courtSvg } from '../ui/court.js';
import { avatar, nat } from '../ui/avatar.js';
import { shareBar } from '../ui/share.js';
import { freshnessBadge, emptyModule } from '../ui/state.js';
import { eventLabel, roundLabel, fmtDuration, pct, cap, statusLabel } from '../ui/render.js';
import { inTiebreakScore } from '../../workers/shared/canonical/events.js';
import { track } from '../analytics.js';
import { switcherItems } from '../lib/pbecast-live.js';
import { courtSituation, situationLine, pointMarker } from '../lib/pbecast-state.js';
import { DEFAULT_SPEED, SPEEDS, dwellMs, initialState, advance, seek, step, togglePlay, replayAgain, jumpToStart, pauseLive, returnToLive, liveArrivals } from '../lib/pbecast-player.js';

const MODE_LABEL = {
  point_by_point_live: 'Point-by-point live', point_by_point_replay: 'Replay · point-by-point',
  observed_live: 'Observed live', observed_replay: 'Replay · observed score feed', scheduled: 'Scheduled', result_only: 'Result only'
};
const REASON = { ace: 'Ace', double_fault: 'Double fault', winner: 'Winner', forced_error: 'Forced error', unforced_error: 'Unforced error', service_winner: 'Service winner', point: 'Point' };
// observed transition -> court motion (no ball, no rally, no player movement: none of that is in the feed)
const ANIM = { game_won: 'game', break: 'game', set_won: 'set', tiebreak: 'game', match_end: 'end', retired: 'end', walkover: 'end', suspended: 'pause', resumed: 'point', score_update: 'point', point: 'point', ace: 'point', double_fault: 'point', winner: 'point', unforced_error: 'point', forced_error: 'point' };

// the stored surname when the source gave one (all-caps sources are title-cased), else the last word of the name
const surname = (p) => (p?.last_name ? p.last_name.split(' ').map((w) => (w === w.toUpperCase() && w.length > 1 ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ') : (p?.name || '').split(' ').slice(-1)[0]);
const sideName = (m, s) => (m.players?.[s] || m.sides?.[s]?.players || []).map(surname).join(' / ') || s;

/** Human text for one event — only facts the event carries. Exported for truth tests. */
export function eventText(e, m) {
  const d = e.event_detail || {};
  if (e.quality === 'point_event') {
    const who = sideName(m, e.winner_side);
    const r = REASON[e.event_type] || 'Point';
    const stroke = d.stroke ? ` · ${cap(d.stroke)}` : '';
    const speed = e.serve_speed_kmh != null ? ` · ${Math.round(e.serve_speed_kmh)} km/h` : '';
    return { tag: r.toUpperCase(), line: `${who} wins the point${e.event_type === 'point' ? '' : ` — ${r.toLowerCase()}${stroke}`}${speed}`, quality: 'point' };
  }
  const from = d.from ? `${d.from.games || ''}${d.from.point ? ` · ${d.from.point}` : ''}` : null;
  const to = d.to ? `${d.to.games || ''}${d.to.point ? ` · ${d.to.point}` : ''}` : null;
  const change = from && to ? `${from} → ${to}` : to || '';
  const map = {
    observation_start: ['OBSERVED', `First observation · ${change}`],
    match_start: ['START', `Match under way · ${change}`],
    score_update: ['SCORE UPDATE', change],
    game_won: ['GAME', `${sideName(m, e.winner_side)} wins the game · ${change}`],
    break: ['BREAK', `${sideName(m, e.winner_side)} breaks · ${change}`],
    set_won: ['SET', `${sideName(m, e.winner_side)} takes set ${d.sets_won?.at(-1)?.set} ${d.sets_won?.at(-1)?.score || ''}`],
    tiebreak: ['TIEBREAK', `Tiebreak · ${change}`],
    match_end: ['FINAL', `Match complete · ${to}`],
    retired: ['RETIRED', `Retirement · ${to}`],
    walkover: ['WALKOVER', 'Walkover'],
    suspended: ['SUSPENDED', 'Play suspended'],
    resumed: ['RESUMED', 'Play resumed']
  };
  const [tag, line] = map[e.event_type] || ['UPDATE', change];
  const hold = d.game_won?.result === 'hold' ? ' (hold)' : '';
  const multi = d.games_between_observations ? ` · ${d.games_between_observations} games between observations` : '';
  return { tag, line: `${line}${hold}${multi}`, quality: 'snapshot' };
}

function scoreboard(m, state, mode, prev = null) {
  const chg = (s, i) => (prev && prev.sets?.[i]?.[s] !== state?.sets?.[i]?.[s] ? 'chg' : '');
  const chgPt = (s) => (prev && prev.point?.[s] !== state?.point?.[s] ? 'chg' : '');
  const sets = state?.sets || [];
  const point = state?.point;
  const server = state?.server;
  const final = ['completed', 'retired', 'walkover'].includes(state?.status || m.status);
  const row = (s) => {
    const ps = m.players?.[s] || m.sides?.[s]?.players || [];
    return html`<div class="sb-row ${m.winner_side === s && final ? 'win' : ''}">
      <span class="sb-av">${ps.map((p) => avatar(p, { px: 40, eager: true }))}</span>
      <span class="sb-name">${ps.map((p, i) => html`${i ? ' / ' : ''}<a href="/players/${p.slug}">${p.name}</a>`)}<small>${ps.map((p) => [p.rank ? `No. ${p.rank.rank}` : null, p.nationality].filter(Boolean).join(' · ')).join(' / ')}</small></span>
      <span class="sb-srv">${server === s && !final ? html`<i class="srv" title="Serving"></i><span class="sr">serving</span>` : ''}</span>
      <span class="sb-sets tabnum">${sets.map((x, i) => html`<b class="${(x.A > x.B ? 'A' : 'B') === s && Math.max(x.A, x.B) >= 6 ? 'w' : ''} ${chg(s, i)}">${x[s]}${x.tb && Math.min(x.tb.A, x.tb.B) === x.tb[s] ? html`<sup>${x.tb[s]}</sup>` : ''}</b>`)}</span>
      <span class="sb-pt tabnum ${chgPt(s)}">${!final && point ? point[s] : ''}</span>
    </div>`;
  };
  const t = m.tournament || {};
  return html`<header class="sb"><h1 class="sr">${sideName(m, 'A')} vs ${sideName(m, 'B')} — PBEcast</h1>
    <div class="sb-top"><span class="sb-t">${t.tournament || ''}</span><span>${roundLabel(m.round)} · ${eventLabel(m.event_type)}${t.surface ? ` · ${cap(t.surface)}` : ''}</span>
      <span class="sb-mode m-${mode}">${mode.includes('live') ? html`<i class="dot"></i>` : ''}${MODE_LABEL[mode]}</span></div>
    ${row('A')}${row('B')}
    <div class="sb-bot">${server && !final ? html`<span><i class="srv"></i> ${sideName(m, server)} serving</span>` : html`<span>${statusLabel(state?.status || m.status)}</span>`}${m.duration_s ? html`<span>${fmtDuration(m.duration_s)}</span>` : ''}</div>
  </header>`;
}

function timeline(data, upto) {
  // Game blocks: exact from point-by-point; from observations only where a game winner was provable.
  const byset = new Map();
  if (data.games) {
    for (const g of data.games) { if (!byset.has(g.set)) byset.set(g.set, []); byset.get(g.set).push({ label: g.result === 'break' ? 'BRK' : 'HLD', side: g.winner, brk: g.result === 'break' }); }
  } else {
    for (const e of data.events.slice(0, upto + 1)) {
      const g = e.event_detail?.game_won;
      if (!g) continue;
      if (!byset.has(g.set)) byset.set(g.set, []);
      byset.get(g.set).push({ label: g.result === 'break' ? 'BRK' : g.result === 'hold' ? 'HLD' : 'GAME', side: g.winner, brk: g.result === 'break' });
    }
  }
  if (!byset.size) return html`<p class="note">${data.quality === 'score_snapshot' ? 'No game with a provable winner observed yet (a game winner is shown only when exactly one game changed between two observations).' : 'No games yet.'}</p>`;
  return html`<div class="tl">${[...byset].map(([set, gs]) => html`<div class="tl-set"><b>Set ${set}</b><div class="tl-games">${gs.map((g) => html`<span class="tl-g s-${g.side} ${g.brk ? 'brk' : ''}" title="${g.label}">${g.label}</span>`)}</div></div>`)}</div>`;
}

function statsPanel(st) {
  if (!st?.A || !st?.B) return html`<p class="note">No match statistics published by the source for this match yet.</p>`;
  const r = (n, d) => (n == null || !d ? null : n / d);
  const rows = [
    ['Aces', st.A.aces, st.B.aces, false], ['Double faults', st.A.double_faults, st.B.double_faults, false],
    ['1st serve in', r(st.A.first_serves_in, st.A.service_points), r(st.B.first_serves_in, st.B.service_points), true],
    ['1st serve points won', r(st.A.first_serve_points_won, st.A.first_serves_in), r(st.B.first_serve_points_won, st.B.first_serves_in), true],
    ['2nd serve points won', r(st.A.second_serve_points_won, st.A.service_points - st.A.first_serves_in), r(st.B.second_serve_points_won, st.B.service_points - st.B.first_serves_in), true],
    ['Break points saved', st.A.break_points_faced ? `${st.A.break_points_saved}/${st.A.break_points_faced}` : null, st.B.break_points_faced ? `${st.B.break_points_saved}/${st.B.break_points_faced}` : null, false],
    ['Total points won', st.A.total_points_won, st.B.total_points_won, false]
  ].filter(([, a, b]) => a != null || b != null);
  const f = (v, p) => (v == null ? '—' : p ? pct(v, 0) : v);
  return html`<table class="cmp2"><tbody>${rows.map(([l, a, b, p]) => html`<tr><td class="n">${f(a, p)}</td><th scope="row">${l}</th><td>${f(b, p)}</td></tr>`)}</tbody></table>`;
}

function dnaCompare(data, m) {
  const gated = [data.dna?.A?.all, data.dna?.B?.all].find((x) => x?.published === false);
  if (gated) return html`<p class="note">${gated.reason}. ATP and WTA are separate populations.</p>`;
  const A = data.dna?.A?.all?.dimensions, B = data.dna?.B?.all?.dimensions;
  if (!A && !B) return html`<p class="note">No stored Tennis DNA for these players yet.</p>`;
  const dims = (A || B).map((d, i) => ({ label: d.label, a: A?.[i], b: B?.[i] }));
  const v = (x) => (x?.value == null ? '—' : pct(x.value));
  return html`<table class="cmp2 dna-cmp"><thead><tr><th class="n">${sideName(m, 'A')}</th><th></th><th>${sideName(m, 'B')}</th></tr></thead><tbody>${dims.map((d) => html`<tr><td class="n">${v(d.a)}${d.a?.percentile != null ? html` <small>${d.a.percentile}th</small>` : ''}</td><th scope="row">${d.label}</th><td>${v(d.b)}${d.b?.percentile != null ? html` <small>${d.b.percentile}th</small>` : ''}</td></tr>`)}</tbody></table>
    <p class="note">Stored Tennis DNA v1 as of ${data.dna?.A?.all?.as_of || data.dna?.B?.all?.as_of || '—'} (exclusive). Percentiles only where the metric sample is medium or high confidence. <a href="/methodology">Definitions</a>.</p>`;
}

/** LIVE MATCHES switcher: every live court, deterministic order; the current court is marked. */
function liveSwitcher(items) {
  if (!items.length) return '';
  const score = (m) => (m.sets || []).map((x) => (x.match_tiebreak && x.tb ? `[${x.tb.A}-${x.tb.B}]` : `${x.A}-${x.B}`)).join(' ') + (m.live?.point ? ` · ${m.live.point.A}–${m.live.point.B}` : '');
  const side = (m, s) => (m.sides?.[s]?.players || []);
  return html`<nav class="pbc-switch page" aria-label="Live matches"><p class="pbc-switch-h"><span class="live-dot" aria-hidden="true"></span>Live matches <small>${items.length}</small></p>
    <ul>${items.map(({ href, current, match: m }) => html`<li><a href="${href}" class="${current ? 'on' : ''}" ${current ? raw('aria-current="page"') : ''}>
      <span class="sw-live">LIVE</span>
      <span class="sw-p">${['A', 'B'].map((s) => html`<span class="sw-row">${side(m, s).map((p) => avatar(p, { px: 26 }))}<b>${side(m, s).map((p) => p.name).join(' / ')}</b></span>`)}</span>
      <span class="sw-sc tabnum">${score(m)}</span>
      <span class="sw-t">${m.tournament?.name || ''}${m.court ? ` · ${m.court}` : ''}</span></a></li>`)}</ul></nav>`;
}


// ---- PBEcast V2 building blocks ------------------------------------------------------------------------
const MODE_BADGE = {
  tracked_live: ['TRACKED LIVE', 'Ball and point positions from the source'],
  point_by_point_live: ['POINT-BY-POINT LIVE', 'Every point from the official feed · no ball tracking'],
  observed_live: ['OBSERVED LIVE', 'Score/server observations · no spatial tracking'],
  point_by_point_replay: ['POINT-BY-POINT REPLAY', 'Every point from the official feed · no ball tracking'],
  observed_replay: ['OBSERVED REPLAY', 'Score/server observations · no spatial tracking'],
  scheduled: ['SCHEDULED', 'PBEcast starts when live coverage begins'],
  result_only: ['RESULT ONLY', 'No stored events for this match']
};
function modeBadge(mode, evs) {
  const tracked = evs.some((e) => e.coordinates);
  const key = tracked && mode.includes('live') ? 'tracked_live' : mode;
  const [label, sub] = MODE_BADGE[key] || [MODE_LABEL[mode] || mode, ''];
  return html`<div class="pbc-mode k-${key}" role="status"><span class="pbc-mode-l">${mode.includes('live') ? html`<i class="dot"></i>` : ''}${label}</span><small>${sub}</small></div>`;
}

const lastName = (p) => surname(p);
function identity(m, s, state, final) {
  const ps = m.players?.[s] || m.sides?.[s]?.players || [];
  const serving = !final && state?.server === s;
  return html`<div class="pid pid-${s}${serving ? ' is-srv' : ''}${final && m.winner_side === s ? ' is-win' : ''}">
    <span class="pid-av">${ps.map((p) => avatar(p, { px: 52, eager: true }))}</span>
    <span class="pid-t"><b>${ps.map(lastName).join(' / ')}</b><small>${ps.map((p) => [p.rank ? `No. ${p.rank.rank}` : null, p.nationality].filter(Boolean).join(' · ')).join(' / ')}</small></span>
    ${serving ? html`<span class="pid-srv">SERVING</span>` : ''}${final && m.winner_side === s ? html`<span class="pid-srv win">WINNER</span>` : ''}
  </div>`;
}

/** Observed/official game results for the strip: holds, breaks, recent games — only games with a provable winner. */
function gamesFrom(evs, upto) {
  const out = [];
  for (const e of evs.slice(0, upto + 1)) {
    const g = e.event_detail?.game_won;
    if (g?.winner) out.push({ set: g.set, game: g.game, winner: g.winner, server: g.server || null, result: g.result || null });
    else if (e.quality === 'point_event' && e.event_detail?.game_complete && e.winner_side) out.push({ set: e.set_number, game: e.game_number, winner: e.winner_side, server: e.server_side || null, result: e.server_side ? (e.server_side === e.winner_side ? 'hold' : 'break') : null });
  }
  return out;
}

function intelStrip(d, m, state, evs, pos) {
  const cells = [];
  const games = gamesFrom(evs, pos);
  for (const s of ['A', 'B']) {
    const served = games.filter((g) => g.server === s && g.result);
    const returned = games.filter((g) => g.server && g.server !== s && g.result);
    if (served.length) cells.push([`${sideName(m, s)} holds`, `${served.filter((g) => g.result === 'hold').length}/${served.length}`]);
    if (returned.length) cells.push([`${sideName(m, s)} breaks`, `${returned.filter((g) => g.result === 'break').length}/${returned.length}`]);
  }
  const st = d.statistics;
  if (st?.A && st?.B) {
    const r = (n, dd) => (n == null || !dd ? null : `${Math.round((n / dd) * 100)}%`);
    for (const s of ['A', 'B']) {
      const x = st[s];
      const one = r(x.first_serve_points_won, x.first_serves_in);
      const two = r(x.second_serve_points_won, x.service_points - x.first_serves_in);
      if (one) cells.push([`${sideName(m, s)} 1st-serve pts`, one]);
      if (two) cells.push([`${sideName(m, s)} 2nd-serve pts`, two]);
      if (x.break_points_faced) cells.push([`${sideName(m, s)} BP saved`, `${x.break_points_saved}/${x.break_points_faced}`]);
    }
  }
  const cur = state?.sets?.at(-1);
  if (cur && state.status === 'in_progress') cells.push(['Set differential', `${cur.A - cur.B > 0 ? '+' : ''}${cur.A - cur.B} ${sideName(m, 'A')}`]);
  const recent = games.slice(-6);
  if (!cells.length && !recent.length) return '';
  return html`<section class="pbc-intel page" aria-label="Live intelligence">
    ${cells.map(([k, v]) => html`<div class="pi-c"><span>${k}</span><b class="tabnum">${v}</b></div>`)}
    ${recent.length ? html`<div class="pi-c pi-recent"><span>Recent games</span><b>${recent.map((g) => html`<i class="rg s-${g.winner} ${g.result === 'break' ? 'brk' : ''}" title="Set ${g.set} game ${g.game}: ${sideName(m, g.winner)}${g.result ? ` (${g.result})` : ''}">${sideName(m, g.winner).slice(0, 3).toUpperCase()}</i>`)}</b></div>` : ''}
  </section>`;
}

const RAIL_TAGS = new Set(['ACE', 'DOUBLE FAULT', 'WINNER', 'BREAK', 'GAME', 'SET', 'TIEBREAK', 'FINAL', 'RETIRED', 'START', 'SUSPENDED', 'RESUMED']);
function momentRail(evs, m, pos, isPoint) {
  const list = evs.slice(0, pos + 1).slice(-60).reverse();
  const photoOf = (s) => (m.players?.[s] || m.sides?.[s]?.players || [])[0];
  return html`<ol class="rail">${list.map((e) => {
    const t = eventText(e, m);
    const sit = e.state ? situationLine(courtSituation(e.state, m.format), (x) => sideName(m, x)) : null;
    const score = e.state ? `${(e.state.sets || []).map((x) => `${x.A}-${x.B}`).join(' ')}${e.state.point ? ` · ${e.state.point.A}–${e.state.point.B}` : ''}` : '';
    const time = e.event_at || e.observed_at;
    const major = RAIL_TAGS.has(t.tag);
    return html`<li class="rl q-${t.quality}${major ? ' major' : ''}${e.event_id === evs[pos]?.event_id ? ' on' : ''}">
      <span class="rl-av">${e.winner_side && photoOf(e.winner_side) ? avatar(photoOf(e.winner_side), { px: 30 }) : ''}</span>
      <span class="rl-b"><span class="rl-top"><b class="rl-tag t-${t.tag.replace(/\s+/g, '-').toLowerCase()}">${t.tag}</b>${sit ? html`<b class="rl-sit k-${sit.kind}">${sit.text}</b>` : ''}<span class="rl-q">${t.quality === 'point' ? 'POINT' : 'OBSERVED'}</span></span>
      <span class="rl-line">${t.line}</span>
      <span class="rl-meta tabnum">${score}${time ? html` · <time datetime="${time}">${new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>` : ''}</span></span>
    </li>`;
  })}</ol>`;
}

// ================= PBEcast V3: one broadcast stage, updated in place =================
// Truth contract unchanged: the court shows the serve indicator (never a position), a tracked ball only from
// source coordinates, and moments only from stored events. Pacing is presentation-only (pbecast-player.js).

const KEY_EVENTS = { break: 'BREAK', set_won: 'SET', tiebreak: 'TB', retired: 'RET', match_end: 'FINAL', walkover: 'W/O', suspended: 'SUSP' };
const surnameUp = (m, s) => sideName(m, s).toUpperCase();
const setsWon = (state, s) => (state?.sets || []).filter((x, i, a) => {
  const done = i < a.length - 1 || ['completed', 'retired'].includes(state.status);
  return done && (x.tb && x.A === x.B ? x.tb[s] > x.tb[s === 'A' ? 'B' : 'A'] : x[s] > x[s === 'A' ? 'B' : 'A']);
}).length;

function v3Score(m, state, prev) {
  const final = ['completed', 'retired', 'walkover'].includes(state?.status || m.status);
  const row = (s) => {
    const ps = m.players?.[s] || m.sides?.[s]?.players || [];
    const sets = state?.sets || [];
    return html`<div class="v3s-row${final && m.winner_side === s ? ' win' : ''}${!final && state?.server === s ? ' is-srv' : ''}">
      <span class="v3s-srv" aria-hidden="true"></span>
      <span class="v3s-n">${ps.map((p) => lastName(p)).join(' / ')}${!final && state?.server === s ? html`<span class="sr"> serving</span>` : ''}</span>
      <span class="v3s-sets tabnum">${sets.map((x, i) => html`<b class="${prev && prev.sets?.[i]?.[s] !== x[s] ? 'chg' : ''}">${x[s]}${x.tb && Math.min(x.tb.A, x.tb.B) === x.tb[s] ? html`<sup>${x.tb[s]}</sup>` : ''}</b>`)}</span>
      <span class="v3s-pt tabnum${prev && prev.point?.[s] !== state?.point?.[s] ? ' chg' : ''}">${!final && state?.point ? state.point[s] : ''}</span>
    </div>`;
  };
  return html`${row('B')}${row('A')}`;
}

function pidShell(m, s) {
  const ps = m.players?.[s] || m.sides?.[s]?.players || [];
  return html`<div class="v3-pid v3-pid-${s}" data-pid="${s}">
    <span class="v3-av">${ps.map((p) => avatar(p, { size: 'square', px: 72, eager: true }))}</span>
    <span class="v3-who"><b class="v3-sn">${ps.map(lastName).join(' / ')}</b><small class="v3-full">${ps.map((p) => p.name).join(' / ')}</small><small class="v3-meta">${ps.map((p) => [p.rank ? `No. ${p.rank.rank}` : null, p.nationality].filter(Boolean).join(' · ')).join(' / ')}</small></span>
    <span class="v3-now"><span class="v3-tagsrv" data-srv hidden>SERVING</span><span class="v3-ctx tabnum" data-ctx></span></span>
  </div>`;
}

function momentPanel(e, m, state, marker = null) {
  if (!e) return html`<p class="v3-mo-empty">Waiting for the first observed event.</p>`;
  const t0 = eventText(e, m);
  // a real point that decided a game/set/match leads with that moment; the point reason stays underneath
  const t = marker ? { ...t0, tag: marker === 'FINAL' ? 'MATCH' : marker, line: `${t0.tag}: ${t0.line}` } : t0;
  const photo = e.winner_side ? (m.players?.[e.winner_side] || m.sides?.[e.winner_side]?.players || [])[0] : null;
  const cur = state?.sets?.at(-1);
  const when = e.event_at || e.observed_at;
  const speed = e.serve_speed_kmh != null ? `${Math.round(e.serve_speed_kmh)} km/h` : null;
  const rally = e.rally_length != null ? `${e.rally_length}-shot rally` : null;
  return html`<div class="v3-mo k-${String(t.tag).replace(/\s+/g, '-').toLowerCase()}" data-key="${e.event_id}">
    <div class="v3-mo-top"><span class="v3-mo-tag">${t.tag}</span><span class="v3-mo-q q-${t.quality}">${t.quality === 'point' ? 'POINT' : 'OBSERVED'}</span></div>
    <div class="v3-mo-body">${photo ? avatar(photo, { size: 'square', px: 44 }) : ''}<p class="v3-mo-line">${t.line}</p></div>
    <p class="v3-mo-meta tabnum">${cur ? `Set ${state.sets.length} · ${cur.A}–${cur.B}` : ''}${state?.point && !['completed', 'retired'].includes(state.status) ? ` · ${state.point.A}–${state.point.B}` : ''}${[speed, rally].filter(Boolean).map((x) => ` · ${x}`).join('')}${when ? html` · <time datetime="${when}">${t.quality === 'point' ? '' : 'Observed '}${new Date(when).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</time>` : ''}</p>
  </div>`;
}

function recentList(evs, pos, m) {
  const list = evs.slice(Math.max(0, pos - 4), pos + 1).reverse();
  const photoOf = (s) => (m.players?.[s] || m.sides?.[s]?.players || [])[0];
  return html`<ol class="v3-rc">${list.map((e, i) => { const t = eventText(e, m); const st = e.state; const when = e.event_at || e.observed_at; return html`<li class="${i === 0 ? 'on' : ''}">
    <span class="v3-rc-av">${e.winner_side && photoOf(e.winner_side) ? avatar(photoOf(e.winner_side), { px: 26 }) : ''}</span>
    <b class="v3-rc-tag t-${String(t.tag).replace(/\s+/g, '-').toLowerCase()}">${t.tag}</b>
    <span class="v3-rc-sc tabnum">${st ? (st.sets || []).map((x) => `${x.A}-${x.B}`).join(' ') : ''}</span>
    <span class="v3-rc-q">${t.quality === 'point' ? 'POINT' : 'OBS'}${when ? ` · ${new Date(when).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</span></li>`; })}</ol>`;
}

function timelineBar(evs, m) {
  const groups = [];
  evs.forEach((e, i) => {
    const set = e.set_number || e.state?.sets?.length || 1;
    if (!groups.length || groups.at(-1).set !== set) groups.push({ set, items: [] });
    let key = KEY_EVENTS[e.event_type] || null;
    if (!key && e.quality === 'point_event') key = pointMarker(evs[i - 1]?.state, e.state, e); // from the official score progression
    groups.at(-1).items.push({ i, e, key, kind: key ? ({ FINAL: 'match_end', SET: 'set_won', BREAK: 'break' }[key] || e.event_type) : e.event_type });
  });
  return html`<div class="v3-tl" role="group" aria-label="Match timeline">${groups.map((g) => html`<div class="v3-tl-set"><span class="v3-tl-h">SET ${g.set}</span><div class="v3-tl-track">${g.items.map(({ i, e, key, kind }) => html`<button type="button" class="v3-tl-e${key ? ` key k-${kind}` : ''}" data-seek="${i}" title="${eventText(e, m).tag}" aria-label="Event ${i + 1}: ${eventText(e, m).tag}">${key ? html`<span>${key}</span>` : ''}</button>`)}</div></div>`)}</div>`;
}

function controlsBar(st, count) {
  if (st.mode === 'live') {
    return html`<div class="v3-ctl" role="group" aria-label="Live controls">
      ${st.paused ? html`<button type="button" class="v3-b v3-golive" data-act="live">● RETURN TO LIVE</button>` : html`<span class="v3-livepill"><i></i>LIVE · following</span><button type="button" class="v3-b" data-act="pause-live">Pause updates</button>`}
      <button type="button" class="v3-b" data-act="prev" aria-label="Previous event">‹ Prev</button>
      <button type="button" class="v3-b" data-act="next" aria-label="Next event">Next ›</button>
      <span class="v3-pos tabnum">${st.pos + 1}/${count}</span>
      <button type="button" class="v3-b v3-fs" data-act="fs">Fullscreen</button></div>`;
  }
  return html`<div class="v3-ctl" role="group" aria-label="Replay controls">
    <button type="button" class="v3-b" data-act="start" aria-label="Back to the first event">↶ Start</button>
    <button type="button" class="v3-b" data-act="prev" aria-label="Previous event">‹</button>
    <button type="button" class="v3-b v3-play" data-act="play" aria-label="${st.playing ? 'Pause replay' : 'Play replay'}">${st.playing ? '❚❚ PAUSE' : st.done ? '↻ REPLAY' : '▶ PLAY'}</button>
    <button type="button" class="v3-b" data-act="next" aria-label="Next event">›</button>
    <span class="v3-speed" role="group" aria-label="Replay speed (presentation only)"><small>Replay speed</small>${SPEEDS.map((sp) => html`<button type="button" class="v3-chip${sp === st.speed ? ' on' : ''}" data-speed="${sp}" aria-pressed="${sp === st.speed}">${sp}×</button>`)}</span>
    <span class="v3-pos tabnum">${st.pos + 1}/${count}</span>
    <button type="button" class="v3-b v3-fs" data-act="fs">Fullscreen</button></div>`;
}

export function mount(root, { params, live = null }) {
  const ctl = new AbortController();
  const q = new URLSearchParams(location.search);
  let data = null;
  let ps = null; // playback state (pbecast-player.js)
  let timer = null;
  let poll = null;
  let queue = [];
  let lastPainted = -1;
  let ctlSig = '';
  render(root, html`<div data-switch></div><div class="pbc v3" data-pbc><div class="page"><p class="loading">Loading PBEcast…</p></div></div>`);
  const drawSwitch = (list) => { const el = root.querySelector('[data-switch]'); if (el) render(el, liveSwitcher(switcherItems(list, params.id))); };
  const loadLive = async () => { try { const r = await api('/v1/live', { signal: ctl.signal }); if (Array.isArray(r.data)) drawSwitch(r.data); } catch { /* aborted */ } };
  if (live) drawSwitch(live);
  loadLive();
  const livePoll = setInterval(loadLive, 30000);
  const $ = (sel) => root.querySelector(sel);

  const viewState = (i) => {
    const m = data.match;
    const e = data.events[i];
    return e?.state || { status: m.status, sets: (m.sets || []).map((x) => ({ A: x.A, B: x.B, tb: x.tb })), point: m.live?.point || null, server: m.live?.server || null };
  };

  function buildShell() {
    const m = data.match;
    const t = m.tournament || {};
    const title = `${sideName(m, 'A')} vs ${sideName(m, 'B')}`;
    render($('[data-pbc]'), html`
      <h1 class="sr">${title} — PBEcast</h1>
      <header class="v3-bar page"><span class="v3-bar-t">${t.tournament || ''}</span><span>${roundLabel(m.round)} · ${eventLabel(m.event_type)}${t.surface ? ` · ${cap(t.surface)}` : ''}</span><span class="v3-bar-mode" data-mode></span><span class="v3-bar-time">${m.duration_s ? fmtDuration(m.duration_s) : ''}</span></header>
      <div class="v3-score-wrap page"><div class="v3-score" data-score aria-live="polite"></div></div>
      <div class="v3-stage page" data-stage>
        <div class="v3-courtcol">
          ${pidShell(m, 'B')}
          <div class="v3-court" data-court></div>
          ${pidShell(m, 'A')}
        </div>
        <section class="v3-moment" aria-label="Current moment" aria-live="polite" data-moment></section>
        <section class="v3-recent" aria-label="Recent moments"><h2>Recent moments</h2><div data-recent></div></section>
        <section class="v3-intel" aria-label="Live intelligence" data-intel></section>
        <div class="v3-controls" data-controls></div>
        <div class="v3-timeline" data-timeline></div>
      </div>
      <p class="pbc-note page">${freshnessBadge(data.meta)} ${data.cadence_note}${data.quality === 'point_event' ? '' : '. Point reasons, serve speeds and ball positions are not in this feed and are never shown.'} <a href="#pbc-more">More intelligence ↓</a></p>
      <div class="page pbc-panels" id="pbc-more">
        <section class="mod"><header class="mod-h"><h2>Key moments</h2></header><div class="mod-b">${data.moments.length ? html`<div class="km">${data.moments.map((k) => html`<button type="button" class="km-b" data-jump="${k.event_id}"><b>${k.kind}</b>${k.side ? ` ${sideName(m, k.side)}` : ''}<small>${k.text}</small></button>`)}</div>` : html`<p class="note">No provable key moments yet.</p>`}</div></section>
        <div class="grid-2">
          <section class="mod"><header class="mod-h"><h2>Match control</h2><span class="mod-k">Descriptive</span></header><div class="mod-b">${data.control ? html`<div class="ctl"><span style="flex:${data.control.A}">${sideName(m, 'A')} ${data.control.A}</span><span style="flex:${data.control.B}">${data.control.B} ${sideName(m, 'B')}</span></div><p class="note">${data.control.definition}.</p>` : html`<p class="note">Needs at least four games with a known winner. Not a win probability.</p>`}</div></section>
          <section class="mod"><header class="mod-h"><h2>Serve &amp; return</h2></header><div class="mod-b">${statsPanel(data.statistics)}</div></section>
          <section class="mod"><header class="mod-h"><h2>Player DNA</h2></header><div class="mod-b">${dnaCompare(data, m)}</div></section>
          <section class="mod"><header class="mod-h"><h2>Head to head</h2></header><div class="mod-b">${data.h2h ? html`<p class="h2h-big tabnum">${sideName(m, 'A')} <b>${data.h2h.A}</b> – <b>${data.h2h.B}</b> ${sideName(m, 'B')}</p>${data.h2h.meetings.length ? html`<ul class="opp">${data.h2h.meetings.map((x) => html`<li><a href="/matches/${x.id}">${x.year || ''} ${x.tournament || ''}</a><b>${x.score || ''}</b></li>`)}</ul>` : ''}<p class="note">${data.h2h.basis}.</p>` : html`<p class="note">Head-to-head is shown for singles.</p>`}</div></section>
        </div>
        <div class="pbc-actions">${shareBar({ url: `${location.origin}/pbecast/${m.id}`, text: `${title} — PropBetEdge Tennis PBEcast`, label: 'Share' })}</div>
      </div>`);
    if (data.events.length) render($('[data-timeline]'), timelineBar(data.events, m));
    lastPainted = -1;
    ctlSig = '';
  }

  // flash a full-stage moment (SET / MATCH) — driven by a real event only
  function stageFlash(text, kind) {
    const stage = $('[data-stage]');
    if (!stage) return;
    stage.querySelector('.v3-flash')?.remove();
    stage.insertAdjacentHTML('beforeend', String(html`<div class="v3-flash k-${kind}" aria-hidden="true"><span>${text}</span></div>`));
    setTimeout(() => stage.querySelector('.v3-flash')?.remove(), 2200);
  }

  function paint(animate) {
    if (!data || !ps) return;
    const m = data.match;
    const evs = data.events;
    const cur = evs.length ? evs[Math.min(ps.pos, evs.length - 1)] : null;
    const state = viewState(ps.pos);
    const prev = animate && ps.pos > 0 ? viewState(ps.pos - 1) : null;
    const final = ['completed', 'retired', 'walkover'].includes(state.status);
    const isPoint = data.quality === 'point_event';
    const anim = animate && cur ? ANIM[cur.event_type] || 'point' : null;
    const tracked = !!cur?.coordinates;
    const sit = final ? null : situationLine(courtSituation(state, m.format), (x) => sideName(m, x));
    const hl = anim && cur?.winner_side && ['point', 'game', 'set', 'end'].includes(anim) ? cur.winner_side : isPoint && cur ? cur.winner_side : null;
    const tagNow = cur ? eventText(cur, m).tag : null;
    const mkNow = isPoint && cur ? pointMarker(ps.pos > 0 ? viewState(ps.pos - 1) : null, state, cur) : null;
    const banner = mkNow ? (mkNow === 'FINAL' ? 'MATCH' : mkNow) : tagNow && !['SCORE UPDATE', 'OBSERVED', 'UPDATE', 'POINT'].includes(tagNow) ? tagNow : null;

    render($('[data-mode]'), modeBadge(data.mode, evs));
    render($('[data-score]'), v3Score(m, state, prev));
    render($('[data-court]'), html`<div class="court-wrap${data.mode.includes('live') && !final ? ' is-live' : ''}${tracked ? ' is-tracked' : ''}${sit ? ` sit-${sit.kind}` : ''}" ${anim ? raw(`data-anim="${anim}"`) : ''}>
      ${tracked ? html`<span class="v3-tracked">TRACKED · ball position from the source</span>` : ''}
      ${courtSvg({ doubles: ['MD', 'WD', 'XD'].includes(m.event_type), server: final ? null : state.server, point: state.point, tiebreak: inTiebreakScore(state.point), highlight: hl, ball: cur?.coordinates || null, trail: cur?.trail || null, serveIndicator: !final, surface: m.tournament?.surface || null })}
      ${sit ? html`<span class="court-sit k-${sit.kind}" role="status">${sit.text}${state.point && state.server ? html`<small class="tabnum">${state.point[state.server]}–${state.point[state.server === 'A' ? 'B' : 'A']}</small>` : ''}</span>` : !final && state.point && state.server ? html`<span class="court-pt tabnum" aria-label="Point score, server first">${state.point[state.server]}–${state.point[state.server === 'A' ? 'B' : 'A']}<small>server first</small></span>` : ''}
      ${banner ? html`<span class="court-banner ${isPoint ? 'pt' : 'obs'} t-${String(banner).replace(/\s+/g, '-').toLowerCase()}" data-k="${cur.event_id}">${banner}</span>` : ''}
      ${!final && state.server ? html`<span class="court-key"><i class="k-serve"></i> Serve indicator — not tracked position</span>` : ''}
      ${ps.mode === 'replay' && ps.done ? html`<div class="v3-done" role="status"><b>REPLAY COMPLETE</b><span><button type="button" class="v3-b v3-play" data-act="again">↻ Replay again</button><button type="button" class="v3-b" data-act="start">Jump to start</button></span></div>` : ''}
    </div>`);
    // player cards: headshots stay mounted; only live state changes
    for (const s of ['A', 'B']) {
      const card = root.querySelector(`[data-pid="${s}"]`);
      if (!card) continue;
      const serving = !final && state.server === s;
      card.classList.toggle('is-srv', serving);
      card.classList.toggle('is-win', final && m.winner_side === s);
      const lastSet = state.sets?.at(-1);
      const won = animate && prev && ((lastSet?.[s] ?? 0) > (prev.sets?.at(-1)?.[s] ?? 0) || (cur?.winner_side === s && anim && anim !== 'point'));
      card.classList.remove('pulse');
      if (won || (animate && cur?.winner_side === s)) { void card.offsetWidth; card.classList.add('pulse'); }
      card.querySelector('[data-srv]').hidden = !serving;
      card.querySelector('[data-srv]').textContent = serving ? 'SERVING' : '';
      const sw = setsWon(state, s);
      card.querySelector('[data-ctx]').textContent = final ? (m.winner_side === s ? 'WINNER' : '') : `${sw} set${sw === 1 ? '' : 's'} · ${lastSet?.[s] ?? 0} games${state.point ? ` · ${state.point[s]}` : ''}`;
    }
    render($('[data-moment]'), momentPanel(cur, m, state, isPoint && cur ? pointMarker(prev || (ps.pos > 0 ? viewState(ps.pos - 1) : null), state, cur) : null));
    render($('[data-recent]'), evs.length ? recentList(evs, ps.pos, m) : html`<p class="note">No stored events for this match.</p>`);
    render($('[data-intel]'), intelStrip(data, m, state, evs, ps.pos) || html`<p class="note">No live intelligence yet: needs games with a provable winner or published statistics.</p>`);
    // controls: re-render only when their own state changes (keeps focus)
    const sig = `${ps.mode}|${ps.playing}|${ps.paused}|${ps.done}|${ps.speed}|${evs.length}|${ps.mode === 'live' ? ps.pos === evs.length - 1 : ''}`;
    if (sig !== ctlSig) { render($('[data-controls]'), evs.length ? controlsBar(ps, evs.length) : ''); ctlSig = sig; }
    const posEl = root.querySelector('.v3-pos');
    if (posEl) posEl.textContent = `${ps.pos + 1}/${evs.length}`;
    root.querySelectorAll('.v3-tl-e.on').forEach((b) => b.classList.remove('on'));
    const dot = root.querySelector(`.v3-tl-e[data-seek="${ps.pos}"]`);
    if (dot) { dot.classList.add('on'); root.querySelectorAll('.v3-tl-e').forEach((b) => b.classList.toggle('past', Number(b.dataset.seek) < ps.pos)); }
    if (animate && cur && (cur.event_type === 'set_won' || cur.event_type === 'match_end') && cur.winner_side) stageFlash(`${cur.event_type === 'match_end' ? 'MATCH' : 'SET'} · ${surnameUp(m, cur.winner_side)}`, cur.event_type === 'match_end' ? 'match' : 'set');
    else if (animate && isPoint && cur?.winner_side) {
      const mk = pointMarker(prev, state, cur);
      if (mk === 'FINAL') stageFlash(`MATCH · ${surnameUp(m, cur.winner_side)}`, 'match');
      else if (mk === 'SET') stageFlash(`SET · ${surnameUp(m, cur.winner_side)}`, 'set');
    }
    lastPainted = ps.pos;
  }

  const clearTimer = () => { clearTimeout(timer); timer = null; };
  function schedule() {
    clearTimer();
    if (!data) return;
    if (ps.mode === 'replay' && ps.playing) {
      timer = setTimeout(() => { ps = advance(ps, data.events.length); paint(true); schedule(); }, dwellMs(data.events[ps.pos]?.event_type, ps.speed));
    } else if (ps.mode === 'live' && queue.length && ps.following && !ps.paused) {
      timer = setTimeout(() => { ps = { ...ps, pos: queue.shift() }; paint(true); schedule(); }, dwellMs(data.events[ps.pos]?.event_type, 1.5));
    }
  }

  const load = async (first) => {
    let res;
    try { res = await api(`/v1/pbecast/${params.id}`, { signal: ctl.signal }); } catch { return; }
    if (!res.data) { if (first) render($('[data-pbc]'), html`<div class="page">${emptyModule(res.meta, 'This match is not in the canonical store.')}</div>`); return; }
    const d = { ...res.data, meta: res.meta };
    const prevCount = data?.events.length || 0;
    const modeChanged = data && data.mode !== d.mode;
    data = d;
    if (first || modeChanged) {
      const t = q.get('t');
      const i = first && t ? d.events.findIndex((e) => e.event_id === t) : -1;
      ps = initialState({ live: d.mode.includes('live'), count: d.events.length, deepLinkIndex: i, speed: ps?.speed || DEFAULT_SPEED });
      buildShell();
      paint(false);
      if (first) {
        track(d.mode.includes('replay') ? 'tennis_pbecast_replay_open' : 'tennis_pbecast_open', { match_id: d.match.id, pbecast_mode: d.mode, match_status: d.match.status, surface: d.match.tournament?.surface });
        document.title = `${sideName(d.match, 'A')} vs ${sideName(d.match, 'B')} ${d.mode.includes('live') ? 'Live PBEcast' : 'PBEcast Replay'} | PropBetEdge Tennis`;
      }
      schedule();
    } else if (d.events.length > prevCount) {
      render($('[data-timeline]'), timelineBar(d.events, d.match));
      const r = liveArrivals(ps, prevCount, d.events.length);
      ps = r.st;
      queue.push(...r.queue);
      paint(false);
      schedule();
    }
    if (d.mode.includes('live') && !poll) poll = setInterval(() => load(false), 15000);
  };

  const onClick = (e) => {
    const b = e.target.closest('[data-act],[data-seek],[data-speed],[data-jump]');
    if (!b || !data) return;
    const n = data.events.length;
    const act = b.dataset.act;
    if (act === 'fs') {
      const el = $('[data-pbc]');
      if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => el.classList.toggle('is-fs'));
      track('pbecast_fullscreen', { match_id: data.match.id });
      return;
    }
    if (b.dataset.speed) { ps = { ...ps, speed: Number(b.dataset.speed) }; track('pbecast_replay_speed', { match_id: data.match.id, speed: ps.speed }); paint(false); schedule(); return; }
    if (b.dataset.seek) { ps = seek(ps, Number(b.dataset.seek), n); queue = []; paint(false); schedule(); return; }
    if (b.dataset.jump) { const i = data.events.findIndex((x) => x.event_id === b.dataset.jump); if (i >= 0) { ps = seek(ps, i, n); queue = []; paint(false); schedule(); track('pbecast_key_moment_jump', { match_id: data.match.id }); document.querySelector('[data-stage]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return; }
    if (act === 'play') ps = togglePlay(ps, n);
    else if (act === 'again') ps = replayAgain(ps, n);
    else if (act === 'start') ps = jumpToStart(ps);
    else if (act === 'prev') ps = step(ps, -1, n);
    else if (act === 'next') ps = step(ps, 1, n);
    else if (act === 'pause-live') ps = pauseLive(ps);
    else if (act === 'live') { ps = returnToLive(ps, n); queue = []; }
    else return;
    paint(act === 'next' || act === 'again');
    schedule();
  };
  const onKey = (e) => {
    if (!data || !e.target.closest?.('[data-controls],[data-timeline]')) return;
    if (e.key === 'ArrowRight') { ps = step(ps, 1, data.events.length); paint(true); schedule(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { ps = step(ps, -1, data.events.length); paint(false); schedule(); e.preventDefault(); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  load(true);
  return () => { ctl.abort(); clearTimer(); clearInterval(poll); clearInterval(livePoll); root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); };
}

export const __test = { eventText, MODE_LABEL };
void raw;
