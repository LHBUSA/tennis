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
import { courtSituation, situationLine } from '../lib/pbecast-state.js';

const MODE_LABEL = {
  point_by_point_live: 'Point-by-point live', point_by_point_replay: 'Replay · point-by-point',
  observed_live: 'Observed live', observed_replay: 'Replay · observed score feed', scheduled: 'Scheduled', result_only: 'Result only'
};
const REASON = { ace: 'Ace', double_fault: 'Double fault', winner: 'Winner', forced_error: 'Forced error', unforced_error: 'Unforced error', service_winner: 'Service winner', point: 'Point' };
const SPEEDS = [0.5, 1, 2, 4];
// observed transition -> court motion (no ball, no rally, no player movement: none of that is in the feed)
const ANIM = { game_won: 'game', break: 'game', set_won: 'set', tiebreak: 'game', match_end: 'end', retired: 'end', walkover: 'end', suspended: 'pause', resumed: 'point', score_update: 'point', point: 'point', ace: 'point', double_fault: 'point', winner: 'point', unforced_error: 'point', forced_error: 'point' };

const surname = (p) => (p?.name || '').split(' ').slice(-1)[0];
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

const lastName = (p) => (p?.name || '').split(' ').slice(-1)[0];
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

export function mount(root, { params, live = null }) {
  const ctl = new AbortController();
  const q = new URLSearchParams(location.search);
  const st = { data: null, pos: 0, playing: false, speed: 1, timer: null, poll: null, lastEvent: null, following: true, animate: false, prevState: null };
  render(root, html`<div data-switch></div><div class="pbc" data-pbc><div class="page"><p class="loading">Loading PBEcast…</p></div></div>`);
  // live switcher: separate container so the court's redraws never reset it; polls the canonical live list
  const drawSwitch = (list) => { const el = root.querySelector('[data-switch]'); if (el) render(el, liveSwitcher(switcherItems(list, params.id))); };
  const loadLive = async () => { try { const r = await api('/v1/live', { signal: ctl.signal }); if (Array.isArray(r.data)) drawSwitch(r.data); } catch { /* aborted */ } };
  if (live) drawSwitch(live);
  loadLive();
  const livePoll = setInterval(loadLive, 30000);

  const draw = () => {
    const d = st.data;
    const m = d.match;
    const evs = d.events;
    const cur = evs.length ? evs[Math.min(st.pos, evs.length - 1)] : null;
    const state = cur?.state || { status: m.status, sets: (m.sets || []).map((x) => ({ A: x.A, B: x.B, tb: x.tb })), point: m.live?.point || null, server: m.live?.server || null };
    const tb = inTiebreakScore(state.point);
    const isPoint = d.quality === 'point_event';
    // the court banner is for real moments only; plain observed score updates stay in the rail
    const tagNow = cur ? eventText(cur, m).tag : null;
    const banner = tagNow && !['SCORE UPDATE', 'OBSERVED', 'UPDATE', 'POINT'].includes(tagNow) ? tagNow : null;
    const url = `${location.origin}/pbecast/${m.id}${cur ? `?t=${cur.event_id}` : ''}`;
    const title = `${sideName(m, 'A')} vs ${sideName(m, 'B')}`;
    const replay = d.mode.includes('replay');
    const final = ['completed', 'retired', 'walkover'].includes(state.status);
    const sit = final ? null : situationLine(courtSituation(state, m.format), (x) => sideName(m, x));
    // Level-1 motion: only a REAL observed transition animates (a new live event or one forward step).
    const anim = st.animate && cur ? ANIM[cur.event_type] || 'point' : null;
    st.animate = false;
    // the half of the court that won the observed/official change (never a rally position)
    const hl = anim && cur?.winner_side && ['point', 'game', 'set', 'end'].includes(anim) ? cur.winner_side : isPoint && cur ? cur.winner_side : null;
    render(root.querySelector('[data-pbc]'), html`
      <div class="pbc-top page">
        ${scoreboard(m, state, d.mode, anim ? st.prevState : null)}
      </div>
      <div class="pbc-stage-wrap page">
        ${modeBadge(d.mode, evs)}
        <div class="pbc-stage${final ? ' is-final' : ''}">
          <div class="pbc-side pbc-side-B">${identity(m, 'B', state, final)}</div>
          <section class="pbc-court" aria-label="Court">
            <div class="court-wrap${d.mode.includes('live') && !final ? ' is-live' : ''}${sit ? ` sit-${sit.kind}` : ''}" ${anim ? raw(`data-anim="${anim}"`) : ''} ${hl ? raw(`data-hl="${hl}"`) : ''}>
              ${courtSvg({ doubles: ['MD', 'WD', 'XD'].includes(m.event_type), server: final ? null : state.server, point: state.point, tiebreak: tb, highlight: hl, ball: cur?.coordinates || null, trail: cur?.trail || null, serveIndicator: !final, surface: m.tournament?.surface || null })}
              ${sit ? html`<span class="court-sit k-${sit.kind}" role="status">${sit.text}${state.point && state.server ? html`<small class="tabnum">${state.point[state.server]}–${state.point[state.server === 'A' ? 'B' : 'A']}</small>` : ''}</span>` : !final && state.point && state.server ? html`<span class="court-pt tabnum" aria-label="Point score, server first">${state.point[state.server]}–${state.point[state.server === 'A' ? 'B' : 'A']}<small>server first</small></span>` : ''}
              ${banner ? html`<span class="court-banner ${isPoint ? 'pt' : 'obs'} t-${String(banner).replace(/\s+/g, '-').toLowerCase()}">${banner}</span>` : ''}
              ${!final && state.server ? html`<span class="court-key"><i class="k-serve"></i> Serve indicator — not tracked position</span>` : ''}
            </div>
          </section>
          <div class="pbc-side pbc-side-A">${identity(m, 'A', state, final)}</div>
        </div>
        ${evs.length ? html`<div class="rp" role="group" aria-label="Replay controls">
          <button type="button" data-rp="first" aria-label="First event">|◀</button>
          <button type="button" data-rp="prev" aria-label="Previous event">◀</button>
          <button type="button" data-rp="play" class="rp-play" aria-label="${st.playing ? 'Pause' : 'Play'}">${st.playing ? 'Pause' : 'Play'}</button>
          <button type="button" data-rp="next" aria-label="Next event">▶</button>
          <button type="button" data-rp="last" aria-label="Latest event">▶|</button>
          <label class="rp-speed">Speed <select data-rp-speed>${SPEEDS.map((sp) => html`<option value="${sp}" ${sp === st.speed ? 'selected' : ''}>${sp}×</option>`)}</select></label>
          <input type="range" min="0" max="${evs.length - 1}" value="${st.pos}" data-rp-range aria-label="Event position">
          <span class="rp-pos tabnum">${st.pos + 1}/${evs.length}</span>
        </div>` : ''}
        <div class="pbc-actions">
          <button type="button" class="btn line" data-fs>Fullscreen PBEcast</button>
          ${shareBar({ url, text: `${title} — PropBetEdge Tennis PBEcast`, label: 'Share' })}
        </div>
        <p class="pbc-note">${freshnessBadge(d.meta)} ${d.cadence_note}${isPoint ? '' : '. Point reasons, serve speeds and ball positions are not in this feed and are never shown.'}</p>
      </div>
      ${intelStrip(d, m, state, evs, st.pos)}
      <section class="pbc-feed page" aria-label="${isPoint ? 'Points' : 'Observed updates'}">
        <h2>${isPoint ? (replay ? 'Every point' : 'Live points') : 'Match moments'} <small>${isPoint ? 'official point-by-point' : 'observed score changes'}</small></h2>
        ${evs.length ? momentRail(evs, m, st.pos, isPoint) : emptyModule(d.meta, d.mode === 'scheduled' ? 'PBEcast starts when live coverage begins.' : 'No stored events for this match: it finished before live observation began.')}
      </section>
      <div class="page pbc-panels">
        <section class="mod"><header class="mod-h"><h2>Key moments</h2></header><div class="mod-b">${d.moments.length ? html`<div class="km">${d.moments.map((k) => html`<button type="button" class="km-b" data-jump="${k.event_id}"><b>${k.kind}</b>${k.side ? ` ${sideName(m, k.side)}` : ''}<small>${k.text}</small></button>`)}</div>` : html`<p class="note">No provable key moments yet.</p>`}</div></section>
        <section class="mod"><header class="mod-h"><h2>Match progression</h2></header><div class="mod-b">${timeline(d, st.pos)}</div></section>
        <div class="grid-2">
          <section class="mod"><header class="mod-h"><h2>Match control</h2><span class="mod-k">Descriptive</span></header><div class="mod-b">${d.control ? html`<div class="ctl"><span style="flex:${d.control.A}">${sideName(m, 'A')} ${d.control.A}</span><span style="flex:${d.control.B}">${d.control.B} ${sideName(m, 'B')}</span></div><p class="note">${d.control.definition}.</p>` : html`<p class="note">Needs at least four games with a known winner. Not a win probability.</p>`}</div></section>
          <section class="mod"><header class="mod-h"><h2>Serve &amp; return</h2></header><div class="mod-b">${statsPanel(d.statistics)}</div></section>
          <section class="mod"><header class="mod-h"><h2>Player DNA</h2></header><div class="mod-b">${dnaCompare(d, m)}</div></section>
          <section class="mod"><header class="mod-h"><h2>Head to head</h2></header><div class="mod-b">${d.h2h ? html`<p class="h2h-big tabnum">${sideName(m, 'A')} <b>${d.h2h.A}</b> – <b>${d.h2h.B}</b> ${sideName(m, 'B')}</p>${d.h2h.meetings.length ? html`<ul class="opp">${d.h2h.meetings.map((x) => html`<li><a href="/matches/${x.id}">${x.year || ''} ${x.tournament || ''}</a><b>${x.score || ''}</b></li>`)}</ul>` : ''}<p class="note">${d.h2h.basis}.</p>` : html`<p class="note">Head-to-head is shown for singles.</p>`}</div></section>
        </div>
      </div>`);
  };

  const load = async (first) => {
    let res;
    try { res = await api(`/v1/pbecast/${params.id}`, { signal: ctl.signal }); } catch { return; }
    if (!res.data) { if (first) render(root.querySelector('[data-pbc]'), html`<div class="page">${emptyModule(res.meta, 'This match is not in the canonical store.')}</div>`); return; }
    const d = { ...res.data, meta: res.meta };
    const lastId = d.events.at(-1)?.event_id || null;
    if (!first && lastId === st.lastEvent) return;
    st.lastEvent = lastId;
    const prevData = st.data;
    st.data = d;
    if (first) {
      const t = q.get('t');
      const i = t ? d.events.findIndex((e) => e.event_id === t) : -1;
      st.pos = i >= 0 ? i : d.mode.includes('replay') ? 0 : Math.max(0, d.events.length - 1);
      st.following = !(i >= 0) && !d.mode.includes('replay');
      track(d.mode.includes('replay') ? 'tennis_pbecast_replay_open' : 'tennis_pbecast_open', { match_id: d.match.id, pbecast_mode: d.mode, match_status: d.match.status, surface: d.match.tournament?.surface });
      document.title = `${sideName(d.match, 'A')} vs ${sideName(d.match, 'B')} ${d.mode.includes('live') ? 'Live PBEcast' : 'PBEcast Replay'} | PropBetEdge Tennis`;
    } else if (st.following) { st.prevState = prevData?.events?.[st.pos]?.state || null; st.pos = d.events.length - 1; st.animate = true; }
    draw();
    if (d.mode.includes('live') && !st.poll) st.poll = setInterval(() => load(false), 15000);
  };

  const stopPlay = () => { st.playing = false; clearInterval(st.timer); st.timer = null; };
  const step = (n) => { const max = st.data.events.length - 1; const from = st.pos; st.pos = Math.max(0, Math.min(max, st.pos + n)); st.following = st.pos === max; if (n === 1 && st.pos === from + 1) { st.prevState = st.data.events[from]?.state || null; st.animate = true; } draw(); };
  const onClick = (e) => {
    const b = e.target.closest('[data-rp],[data-jump],[data-fs]');
    if (!b || !st.data) return;
    if (b.dataset.fs !== undefined) {
      const el = root.querySelector('[data-pbc]');
      if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => el.classList.toggle('is-fs'));
      track('pbecast_fullscreen', { match_id: st.data.match.id });
      return;
    }
    if (b.dataset.jump) { const i = st.data.events.findIndex((x) => x.event_id === b.dataset.jump); if (i >= 0) { stopPlay(); st.pos = i; st.following = false; draw(); track('pbecast_key_moment_jump', { match_id: st.data.match.id }); } return; }
    const a = b.dataset.rp;
    if (a === 'first') { stopPlay(); st.pos = 0; st.following = false; draw(); }
    if (a === 'last') { stopPlay(); st.pos = st.data.events.length - 1; st.following = true; draw(); }
    if (a === 'prev') { stopPlay(); step(-1); }
    if (a === 'next') { stopPlay(); step(1); }
    if (a === 'play') {
      if (st.playing) { stopPlay(); draw(); return; }
      st.playing = true;
      if (st.pos >= st.data.events.length - 1) st.pos = 0;
      st.timer = setInterval(() => { if (st.pos >= st.data.events.length - 1) { stopPlay(); draw(); return; } step(1); }, 1200 / st.speed);
      draw();
    }
  };
  const onInput = (e) => {
    if (!st.data) return;
    if (e.target.matches('[data-rp-range]')) { stopPlay(); st.pos = Number(e.target.value); st.following = st.pos === st.data.events.length - 1; draw(); }
    if (e.target.matches('[data-rp-speed]')) { st.speed = Number(e.target.value); track('pbecast_replay_speed', { match_id: st.data.match.id, speed: st.speed }); if (st.playing) { stopPlay(); onClick({ target: root.querySelector('[data-rp="play"]') }); } }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onInput);
  root.addEventListener('input', onInput);
  load(true);
  return () => { ctl.abort(); stopPlay(); clearInterval(st.poll); clearInterval(livePoll); root.removeEventListener('click', onClick); root.removeEventListener('change', onInput); root.removeEventListener('input', onInput); };
}

export const __test = { eventText, MODE_LABEL };
void raw;
