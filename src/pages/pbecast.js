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
import { fmtMetric } from '../ui/match-dna.js';
import { inTiebreakScore } from '../../workers/shared/canonical/events.js';
import { track } from '../analytics.js';
import { switcherItems } from '../lib/pbecast-live.js';
import { gamesFrom, setsWon, liveContext, pulse } from '../lib/pbecast-view.js';
import { pointFeed, feedByGame, situationOf, situationLabel } from '../lib/pbecast-feed.js';
import { dataMode, breakPressure, recentGames, setStarts, prevGame, nextGame, currentMoment } from '../lib/pbecast-broadcast.js';
import { getMembership } from '../lib/membership.js';
import { railNav, wireRails, revealCurrent } from '../ui/rail.js';
import { scoreGrid } from '../ui/score-grid.js';
import { tourTag, tourFamily, tournamentName, roundShort, tourStatus } from '../lib/home.js';
import { castTourState, TOURS_PENDING } from '../ui/home.js';
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
// every player shown in PBEcast links to their Player DNA profile (doubles: each partner separately); no slug -> text
const dnaHref = (p) => (p?.slug ? `/players/${p.slug}/dna` : null);
const playerLinks = (m, s, fmt = surname) => html`${(m.players?.[s] || m.sides?.[s]?.players || []).map((p, i) => html`${i ? ' / ' : ''}${dnaHref(p) ? html`<a class="pl-dna" href="${dnaHref(p)}" title="${p.name} — Player DNA">${fmt(p)}</a>` : fmt(p)}`)}`;
// photo links duplicate the name link for pointer users only (tabindex -1: one keyboard stop per player)
const avatarLink = (p, opts) => (dnaHref(p) ? html`<a class="pl-dna-av" href="${dnaHref(p)}" tabindex="-1" aria-hidden="true">${avatar(p, opts)}</a>` : avatar(p, opts));

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
      <span class="sb-av">${ps.map((p) => avatarLink(p, { px: 40, eager: true }))}</span>
      <span class="sb-name">${ps.map((p, i) => html`${i ? ' / ' : ''}<a class="pl-dna" href="/players/${p.slug}/dna">${p.name}</a>`)}<small>${ps.map((p) => [p.rank ? `No. ${p.rank.rank}` : null, p.nationality].filter(Boolean).join(' · ')).join(' / ')}</small></span>
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

const ORDN = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const MD_STATUS = { missing: 'no sample', descriptive: 'descriptive', player_sample_low: 'small sample', population_building: 'tour comparison building', peer_sample_not_mature: 'peers building' };

/** Technical DNA v1 (serve/return from match statistics): an additional module; its gates are unchanged. */
function technicalCompare(data, m) {
  const A = data.dna?.A?.all?.dimensions, B = data.dna?.B?.all?.dimensions;
  const tech = data.dna?.technical_dna;
  const building = [tech?.A, tech?.B].find((x) => x && x.status !== 'published');
  const head = html`<h3 class="sub-h dna-tech-h">Technical serve/return DNA <small>v1 · from match statistics</small></h3>`;
  if (!A && !B) return html`${head}<p class="note dna-tech-status" data-tech-status="unavailable">Technical serve/return DNA is still building for these players: it needs matches with published serve/return statistics.</p>`;
  const dims = (A || B).map((d, i) => ({ label: d.label, a: A?.[i], b: B?.[i] }));
  const v = (x) => (x?.value == null ? '—' : pct(x.value));
  return html`${head}<table class="cmp2 dna-cmp dna-tech"><thead><tr><th class="n">${playerLinks(m, 'A')}</th><th></th><th>${playerLinks(m, 'B')}</th></tr></thead><tbody>${dims.map((d) => html`<tr><td class="n">${v(d.a)}${d.a?.percentile != null ? html` <small>${d.a.percentile}th</small>` : ''}</td><th scope="row">${d.label}</th><td>${v(d.b)}${d.b?.percentile != null ? html` <small>${d.b.percentile}th</small>` : ''}</td></tr>`)}</tbody></table>
    ${building ? html`<p class="note dna-tech-status" data-tech-status="${building.status}">Technical serve/return DNA is still building${data.dna?.A?.all?.comparative?.qualified != null ? html` (${data.dna.A.all.comparative.qualified} of ${data.dna.A.all.comparative.threshold} ${data.dna.A.all.tour} players meet the full standard)` : ''}. Individual measurements are shown; a percentile appears per metric once 10 same-tour peers qualify.</p>` : ''}
    <p class="note">Stored technical DNA v1 as of ${data.dna?.A?.all?.as_of || data.dna?.B?.all?.as_of || '—'} (exclusive). <a href="/methodology">Definitions</a>.</p>`;
}

/** Match DNA v2 is the primary comparison: stored results-based metrics, each player within their own tour. */
function dnaCompare(data, m) {
  const MA = data.dna?.match_dna?.A || data.dna?.A?.match_dna || null;
  const MB = data.dna?.match_dna?.B || data.dna?.B?.match_dna || null;
  if (!MA && !MB) {
    // older API (no match_dna) or neither player has a v2 snapshot: technical module only
    if (!data.dna?.A?.all && !data.dna?.B?.all) return html`<p class="note">No stored Tennis DNA for these players yet.</p>`;
    return technicalCompare(data, m);
  }
  const keys = (MA || MB).metrics.map((x) => [x.key, x.label]);
  const get = (md, k) => md?.metrics?.find((x) => x.key === k) || null;
  const cell = (x) => (!x || x.value == null ? html`—` : html`<span title="${x.record && x.record.W != null ? `${x.record.W}–${x.record.L}` : x.numerator != null ? `${x.numerator}/${x.denominator}` : ''} · ${x.confidence}">${fmtMetric(x)}</span>${x.percentile != null ? html` <small>${ORDN(x.percentile)}</small>` : x.status !== 'published' ? html` <small class="muted">${MD_STATUS[x.status] || ''}</small>` : ''}`);
  const rating = (md) => (!md?.rating ? '—' : md.rating.status === 'not_validated' ? html`<small class="muted">not published</small>` : html`${md.rating.value}${md.rating.percentile != null ? html` <small>${ORDN(md.rating.percentile)}</small>` : ''}`);
  const form = (md) => (md?.form?.last10 ? html`${md.form.last10.W}–${md.form.last10.L}${md.form.current_streak ? html` <small>${md.form.current_streak.result}${md.form.current_streak.length}</small>` : ''}` : '—');
  const surf = data.dna?.surface;
  const sCell = (md) => { const s = md?.surface; const mw = s?.metrics?.find((x) => x.key === 'match_win_rate'); return s?.form?.career ? html`${s.form.career.W}–${s.form.career.L}${mw?.percentile != null ? html` <small>${ORDN(mw.percentile)}</small>` : ''}` : '—'; };
  const tours = [...new Set([MA?.tour, MB?.tour].filter(Boolean))];
  return html`<h3 class="sub-h dna-match-h">Match DNA <small>v2 · results-based · ${tours.join(' / ')} population</small></h3>
    <table class="cmp2 dna-cmp dna-match"><thead><tr><th class="n">${sideName(m, 'A')}</th><th></th><th>${sideName(m, 'B')}</th></tr></thead><tbody>
      ${MA?.rating || MB?.rating ? html`<tr><td class="n">${rating(MA)}</td><th scope="row">PBE Rating</th><td>${rating(MB)}</td></tr>` : ''}
      <tr><td class="n">${form(MA)}</td><th scope="row">Last 10</th><td>${form(MB)}</td></tr>
      ${surf && (MA?.surface || MB?.surface) ? html`<tr><td class="n">${sCell(MA)}</td><th scope="row">${cap(surf)} record</th><td>${sCell(MB)}</td></tr>` : ''}
      ${keys.map(([k, label]) => html`<tr><td class="n">${cell(get(MA, k))}</td><th scope="row">${label}</th><td>${cell(get(MB, k))}</td></tr>`)}
    </tbody></table>
    <p class="note">Match DNA v2 as of ${MA?.as_of || MB?.as_of} from ${[MA, MB].filter(Boolean).map((x) => `${x.sample?.matches ?? '—'}`).join(' and ')} stored singles results. Percentiles only where that metric’s ${tours.join('/')} comparison is published; ATP and WTA are never pooled.${!MA || !MB ? ' One player has no Match DNA snapshot yet.' : ''}</p>
    ${technicalCompare(data, m)}`;
}

/**
 * LIVE MATCHES ticker: every live court in the deterministic order (pbecast-live.js), the current court marked and
 * revealed on first render. A rail (src/ui/rail.js): no native scrollbar, swipe / trackpad / arrows, one-card
 * auto-advance that pauses on hover, focus, touch and reduced motion. Every value is the /v1/live summary's own.
 */
function liveTicker(items) {
  if (!items.length) return '';
  const badge = (m) => {
    const t = tourTag(m.tour) || m.tournament?.level || null;
    const fam = tourFamily(m.tour) || (/^WTA/i.test(t || '') ? 'wta' : /^ATP/i.test(t || '') ? 'atp' : null);
    return t ? html`<span class="hm-tag${fam ? ` hm-tag-${fam}` : ''}">${t}</span>` : '';
  };
  const card = ({ href, current, match: m }) => html`<a href="${href}" class="tk${current ? ' on' : ''}" ${current ? raw('aria-current="page"') : ''}>
    <span class="tk-top">${current ? html`<span class="tk-now">Now showing</span>` : html`<span class="tk-live"><i aria-hidden="true"></i>Live</span>`}${badge(m)}<span class="tk-r" title="${eventLabel(m.event_type)} · ${roundLabel(m.round)}">${roundShort(m.round)}</span></span>
    <span class="tk-t">${tournamentName(m.tournament)}${m.court ? html`<small> · ${m.court}</small>` : ''}</span>
    ${scoreGrid(m, { px: 24, links: false })}
    <span class="tk-go">${current ? 'On this court' : html`Open PBEcast <span aria-hidden="true">→</span>`}</span></a>`;
  return html`<nav class="pbc-tk" aria-label="Live matches"><div class="pbc-tk-in" data-rail data-auto="4500">
    <div class="pbc-tk-h"><p class="pbc-tk-t"><span class="live-dot" aria-hidden="true"></span>Live matches <small class="tabnum">${items.length}</small></p>${railNav('live match')}</div>
    <ul class="hm-track pbc-tk-track" aria-label="Live matches, ${items.length}">${items.map((it) => html`<li>${card(it)}</li>`)}</ul>
  </div></nav>`;
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

const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');

/** B. MATCH PULSE: A | measure | B from provable games + published statistics, then match facts. */
function pulsePanel(d, m, state, pos, live) {
  const p = pulse(d, state, pos);
  const facts = [...p.facts];
  if (d.match.duration_s) facts.push({ key: 'time', label: live ? 'Match time' : 'Duration', value: fmtDuration(d.match.duration_s), title: live ? 'Reported by the source at its last update' : '' });
  const lastEv = live ? d.events.at(-1) : null;
  if (lastEv && (lastEv.event_at || lastEv.observed_at)) facts.push({ key: 'last', label: lastEv.quality === 'point_event' ? 'Last point' : 'Last observed', value: timeOf(lastEv.event_at || lastEv.observed_at) });
  if (!p.rows.length && !facts.length) return html`<p class="note">No pulse yet: needs games with a provable winner or published statistics.</p>`;
  return html`${facts.length ? html`<dl class="v3-facts">${facts.map((f) => html`<div class="v3-fact"${f.title ? raw(` title="${f.title}"`) : ''}><dt>${f.label}</dt><dd class="tabnum">${f.value}</dd></div>`)}</dl>` : ''}
    ${p.rows.length ? html`<table class="v3-pulse-t"><thead><tr><th scope="col" class="n">${playerLinks(m, 'A')}</th><th scope="col"><span class="sr">Measure</span></th><th scope="col">${playerLinks(m, 'B')}</th></tr></thead><tbody>${p.rows.map((r) => html`<tr><td class="n tabnum">${r.A}</td><th scope="row">${r.label}</th><td class="tabnum">${r.B}</td></tr>`)}</tbody></table>` : ''}
    ${p.basis ? html`<p class="v3-basis">Holds and breaks from ${p.basis} game${p.basis === 1 ? '' : 's'} with a provable server and winner${d.quality === 'point_event' ? '' : ' (several games between two observations have no provable winner and are left out)'}.</p>` : ''}`;
}

/** D. RECENT GAMES: HOLD / BREAK per game with a provable winner, newest first. */
function gamesPanel(evs, pos, m) {
  const games = gamesFrom(evs, pos).slice(-6).reverse();
  if (!games.length) return html`<p class="note">No game with a provable winner yet.</p>`;
  const photoOf = (s) => (m.players?.[s] || m.sides?.[s]?.players || [])[0];
  return html`<ol class="v3-gm">${games.map((g) => html`<li class="${g.result === 'break' ? 'brk' : ''}">
    <span class="v3-gm-at tabnum">S${g.set ?? '—'} · G${g.game ?? '—'}</span>
    <b class="v3-gm-k">${g.result === 'break' ? 'BREAK' : g.result === 'hold' ? 'HOLD' : 'GAME'}</b>
    <span class="v3-gm-who">${photoOf(g.winner) ? avatarLink(photoOf(g.winner), { px: 22 }) : ''}<span>${playerLinks(m, g.winner)}</span></span></li>`)}</ol>`;
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

/** Sticky broadcast scoreboard: live/replay state + set/game context, then one row per side (server first-class). */
function v3Score(m, state, prev, { mode, order }) {
  const final = ['completed', 'retired', 'walkover'].includes(state?.status || m.status);
  const sets = state?.sets || [];
  const point = !final && state?.point ? state.point : null;
  const ctx = liveContext(state);
  const dbl = /D$/.test(m.event_type || '');
  const cols = `12px ${dbl ? 46 : 30}px minmax(0,1fr)${' var(--v3s-set)'.repeat(sets.length)}${point ? ' var(--v3s-pt)' : ''}`;
  const isCur = (i) => !final && i === sets.length - 1;
  const row = (s) => {
    const ps = m.players?.[s] || m.sides?.[s]?.players || [];
    const srv = !final && state?.server === s;
    const meta = ps.map((p) => [p.nationality, p.rank ? `No. ${p.rank.rank}` : null].filter(Boolean).join(' · ')).filter(Boolean).join(' / ');
    return html`<div class="v3s-row${final && m.winner_side === s ? ' win' : ''}${srv ? ' is-srv' : ''}" style="grid-template-columns:${cols}">
      <span class="v3s-srv" aria-hidden="true"></span>
      <span class="v3s-av">${ps.map((p) => avatarLink(p, { px: 30, eager: true }))}</span>
      <span class="v3s-who"><span class="v3s-n">${playerLinks(m, s, lastName)}${srv ? html`<span class="sr"> serving</span>` : ''}${final && m.winner_side === s ? html`<span class="sr"> winner</span>` : ''}</span>${meta ? html`<small class="v3s-meta">${meta}</small>` : ''}</span>
      ${sets.map((x, i) => { const o = s === 'A' ? 'B' : 'A'; const won = !isCur(i) && (x.tb && x.A === x.B ? x.tb[s] > x.tb[o] : x[s] > x[o]); return html`<b class="v3s-c${won ? ' w' : ''}${isCur(i) ? ' cur' : ''}${prev && prev.sets?.[i]?.[s] !== x[s] ? ' chg' : ''}">${x[s]}${x.tb && Math.min(x.tb.A, x.tb.B) === x.tb[s] ? html`<sup>${x.tb[s]}</sup>` : ''}</b>`; })}
      ${point ? html`<b class="v3s-pt tabnum${prev && prev.point?.[s] !== point[s] ? ' chg' : ''}">${point[s]}</b>` : ''}
    </div>`;
  };
  const live = mode.includes('live') && !final;
  const where = final ? statusLabel(state?.status || m.status) : ctx ? (ctx.tiebreak ? `Set ${ctx.set} · Tiebreak` : `Set ${ctx.set} · Game ${ctx.game}`) : statusLabel(state?.status || m.status);
  return html`<div class="v3s-head" style="grid-template-columns:${cols}">
      <span class="v3s-state">${live ? html`<span class="v3s-live"><i aria-hidden="true"></i>Live</span>` : html`<span class="v3s-rp">${mode.includes('replay') ? 'Replay' : statusLabel(m.status)}</span>`}<span class="v3s-where">${where}</span></span>
      ${sets.map((_, i) => html`<span class="v3s-h${isCur(i) ? ' cur' : ''}" aria-hidden="true">${sets[i]?.mtb || sets[i]?.match_tiebreak ? 'MTB' : `S${i + 1}`}</span>`)}${point ? html`<span class="v3s-h pt" aria-hidden="true">PT</span>` : ''}
    </div>${order.map(row)}`;
}

function pidShell(m, s) {
  const ps = m.players?.[s] || m.sides?.[s]?.players || [];
  return html`<div class="v3-pid v3-pid-${s}" data-pid="${s}">
    <span class="v3-av">${ps.map((p) => avatarLink(p, { size: 'square', px: 72, eager: true }))}</span>
    <span class="v3-who"><b class="v3-sn">${playerLinks(m, s, lastName)}</b><small class="v3-full">${ps.map((p) => p.name).join(' / ')}</small><small class="v3-meta">${ps.map((p) => [p.rank ? `No. ${p.rank.rank}` : null, p.nationality].filter(Boolean).join(' · ')).join(' / ')}</small></span>
    <span class="v3-now"><span class="v3-tagsrv" data-srv hidden>SERVING</span><span class="v3-ctx tabnum" data-ctx></span></span>
  </div>`;
}

/** A. CURRENT MOMENT: the event at the viewer's position, its score transition, server and observed time. */
function momentPanel(e, m, state, marker = null) {
  if (!e) return html`<p class="v3-mo-empty">Waiting for the first observed event.</p>`;
  const t0 = eventText(e, m);
  // a real point that decided a game/set/match leads with that moment; the point reason stays underneath
  const t = marker ? { ...t0, tag: marker === 'FINAL' ? 'MATCH' : marker, line: `${t0.tag}: ${t0.line}` } : t0;
  const photo = e.winner_side ? (m.players?.[e.winner_side] || m.sides?.[e.winner_side]?.players || [])[0] : null;
  const cur = state?.sets?.at(-1);
  const final = ['completed', 'retired', 'walkover'].includes(state?.status);
  const when = e.event_at || e.observed_at;
  const speed = e.serve_speed_kmh != null ? `${Math.round(e.serve_speed_kmh)} km/h` : null;
  const rally = e.rally_length != null ? `${e.rally_length}-shot rally` : null;
  const bits = [
    cur ? `Set ${state.sets.length} · ${cur.A}–${cur.B}` : null,
    state?.point && !final ? `${state.point.A}–${state.point.B}` : null,
    state?.server && !final ? `${sideName(m, state.server)} serving` : null,
    speed, rally
  ].filter(Boolean);
  return html`<div class="v3-mo k-${String(t.tag).replace(/\s+/g, '-').toLowerCase()}" data-key="${e.event_id}">
    <div class="v3-mo-top"><span class="v3-mo-tag">${t.tag}</span><span class="v3-mo-q q-${t.quality}">${t.quality === 'point' ? 'POINT' : 'OBSERVED'}</span></div>
    <div class="v3-mo-body">${photo ? avatar(photo, { size: 'square', px: 44 }) : ''}<p class="v3-mo-line">${t.line}</p></div>
    <p class="v3-mo-meta tabnum">${bits.map((x, i) => html`${i ? html`<i aria-hidden="true">·</i>` : ''}<span>${x}</span>`)}${when ? html`<i aria-hidden="true">·</i><time datetime="${when}">${t.quality === 'point' ? '' : 'Observed '}${timeOf(when)}</time>` : ''}</p>
  </div>`;
}

/**
 * A'. LIVE STATE CARD (observed matches): the big situation callout (MATCH / SET / BREAK / GAME POINT, DEUCE, ADVANTAGE,
 * TIEBREAK — else the latest HOLD / BREAK / SET, else who is serving), then server, point score, set games, sets won,
 * the latest observed change and its time. Point-event matches keep the reason/speed card (momentPanel).
 */
const FEED_TAG = { hold: 'HOLD', break: 'BREAK', game: 'GAME', set: 'SET', match: 'FINAL', tiebreak: 'TIEBREAK', start: 'START', suspended: 'SUSPENDED', resumed: 'RESUMED' };
function stateCard(e, m, state, item, live) {
  if (!e) return html`<p class="v3-mo-empty">Waiting for the first observed event.</p>`;
  const nm = (s) => sideName(m, s);
  const final = ['completed', 'retired', 'walkover'].includes(state?.status);
  const sit = final ? null : situationOf(state, m.format);
  const call = final ? 'FINAL' : situationLabel(sit, nm)
    || (item && ['hold', 'break', 'set'].includes(item.kind) && item.who ? `${FEED_TAG[item.kind]} · ${item.who}` : null)
    || (state?.server ? `${nm(state.server).toUpperCase()} SERVING` : 'IN PLAY');
  const cur = state?.sets?.at(-1);
  const when = e.event_at || e.observed_at;
  const age = live && when ? Math.max(0, Math.round((Date.now() - Date.parse(when)) / 1000)) : null;
  const pt = state?.point && !final ? html`<b>${nm('A')} ${state.point.A}</b><i aria-hidden="true">·</i><b>${nm('B')} ${state.point.B}</b>` : '—';
  const kind = sit?.kind || (final ? 'final' : item?.kind || 'play');
  return html`<div class="v3-mo lsc k-${kind}" data-key="${e.event_id}">
    <div class="v3-mo-top"><span class="v3-mo-tag lsc-call">${call}</span><span class="v3-mo-q q-snapshot" title="Score / server observations, not source point events">OBSERVED</span></div>
    <dl class="lsc-grid tabnum">
      <div><dt>Server</dt><dd>${state?.server && !final ? playerLinks(m, state.server) : '—'}</dd></div>
      <div><dt>Point</dt><dd>${pt}</dd></div>
      <div><dt>${cur ? `Set ${state.sets.length}` : 'Games'}</dt><dd>${cur ? `${cur.A}–${cur.B}` : '—'}</dd></div>
      <div><dt>Sets</dt><dd>${state?.sets?.length ? `${setsWon(state, 'A')}–${setsWon(state, 'B')}` : '—'}</dd></div>
    </dl>
    ${item?.line ? html`<p class="v3-mo-line lsc-last">${item.line}</p>` : ''}
    <p class="v3-mo-meta tabnum">${when ? html`<time datetime="${when}">Observed ${timeOf(when)}</time>${age != null ? html`<i aria-hidden="true">·</i><span>${age < 90 ? `${age}s ago` : `${Math.round(age / 60)} min ago`}</span>` : ''}` : ''}<i aria-hidden="true">·</i><span>${item?.provenance === 'derived' ? 'derived from consecutive observations' : 'observed score state'}</span></p>
  </div>`;
}

/**
 * C. POINT FEED. Every stored event is its own row, grouped by game (newest game first): the current game and the
 * previous three, the full match on demand. A player is credited only for a proven single point; wider changes read
 * "score advanced … between observations". Rows are seek buttons: replay jumps to exactly that stored event.
 */
function feedPanel(evs, pos, m, all) {
  const nm = (s) => sideName(m, s);
  const items = pointFeed(evs, m, { upto: pos, name: nm });
  const groups = feedByGame(items);
  const shown = all ? groups : groups.slice(0, 4);
  const more = groups.length - shown.length;
  const row = (it) => {
    const e = evs[it.idx];
    const src = it.kind === 'point_event' ? eventText(e, m) : null;
    const chip = src ? src.tag : ['point', 'jump', 'start', 'other'].includes(it.kind) ? situationLabel(it.sit, nm) : FEED_TAG[it.kind] || null;
    const line = src ? src.line : it.line;
    const sc = ['hold', 'break', 'set', 'match'].includes(it.kind) ? '' : it.to || '';
    return html`<li class="pf-i k-${it.kind}${it.major ? ' is-major' : ''}${it.sit ? ` s-${it.sit.kind}` : ''}${it.idx === pos ? ' on' : ''}"><button type="button" data-seek="${it.idx}" aria-current="${it.idx === pos ? 'true' : 'false'}">
      <time class="tabnum" datetime="${it.time || ''}">${it.time ? timeOf(it.time) : ''}</time><span class="pf-chip${chip ? '' : ' is-empty'}">${chip || ''}</span><span class="pf-line">${line}</span><span class="pf-sc tabnum">${sc}</span></button></li>`;
  };
  return html`<div class="pf">${shown.map((g) => html`<section class="pf-g${g.result ? ` r-${g.result}` : ''}">
      <header class="pf-gh"><b>${g.set ? `Set ${g.set}` : ''}${g.game ? ` · Game ${g.game}` : ''}</b>${g.server ? html`<span>${playerLinks(m, g.server)} serving</span>` : ''}${g.result && g.winner ? html`<em class="pf-res">${FEED_TAG[g.result]} · ${nm(g.winner)}</em>` : ''}</header>
      <ol>${g.items.map(row)}</ol></section>`)}
    ${more ? html`<button type="button" class="pf-more" data-act="feed-all">Show full match timeline · ${more} earlier game${more === 1 ? '' : 's'}</button>` : all && groups.length > 4 ? html`<button type="button" class="pf-more" data-act="feed-recent">Show recent games only</button>` : ''}
    <p class="pf-note">${evs.some((x) => x.quality === 'point_event') ? 'Point-by-point from the source feed: reasons, speeds and rally lengths appear only where the source publishes them.' : 'Observed score feed. A player is credited with a point only when two consecutive observations differ by exactly one point; wider changes are shown as the score advancing between observations, never reconstructed.'}</p>
  </div>`;
}

// ================= PBEcast Broadcast V4: current-moment hero, pressure, pre-match panel, navigation =================
// Same truth contract: only sourced fields; snapshot mode (game-level ESPN) never shows a point score, a server or a
// point feed; observed mode never reconstructs points; point mode shows source reasons only when the event carries them.
/** The hero: where the match is, who serves (only when sourced), the situation, and what just changed. */
function heroMoment(m, state, mode, last, sitText) {
  const mo = currentMoment(state, mode, { last });
  const nm = (s) => sideName(m, s);
  const where = mo.final ? (state?.status === 'retired' ? 'RETIRED' : 'FINAL') : mo.set ? `SET ${mo.set}${mo.tiebreak ? ' · TIEBREAK' : mo.game ? ` · GAME ${mo.game}` : ''}` : statusLabel(state?.status || m.status).toUpperCase();
  const lead = mo.games && (mo.games.A !== mo.games.B) ? (mo.games.A > mo.games.B ? 'A' : 'B') : null;
  const games = mo.games ? html`<span class="v4h-games tabnum">${playerLinks(m, 'A')} <b>${mo.games.A}</b><i>·</i><b>${mo.games.B}</b> ${playerLinks(m, 'B')}</span>` : '';
  return html`<div class="v4h k-${mode}${mo.final ? ' is-final' : ''}" data-k="${sitText || ''}">
    <div class="v4h-l"><span class="v4h-where">${where}</span>${games}${lead && !mo.final ? html`<small class="v4h-lead">${nm(lead)} leads the set</small>` : ''}</div>
    <div class="v4h-c">${mo.point ? html`<b class="v4h-pt tabnum">${mo.point.A}<i>–</i>${mo.point.B}</b>` : mode === 'snapshot' && !mo.final ? html`<b class="v4h-pt v4h-nopt">GAMES</b>` : ''}${sitText ? html`<span class="v4h-sit">${sitText}</span>` : ''}${mo.server ? html`<span class="v4h-srv"><i class="v4-ball" aria-hidden="true"></i>${nm(mo.server).toUpperCase()} SERVING</span>` : ''}</div>
    <div class="v4h-r"><span class="v4h-k">${mode === 'snapshot' ? 'Latest observation' : mode === 'point' ? 'Last point' : 'Latest change'}</span><span class="v4h-last">${last?.line || (mode === 'snapshot' ? 'Set and game score as observed; this source publishes no point-by-point.' : 'Waiting for the first event.')}</span>${last?.tag ? html`<small class="v4h-tag">${last.tag}</small>` : ''}</div>
  </div>`;
}

/** Break-point pressure (current match): point mode = every break point played; observed mode = break-point games. */
function pressurePanel(bpMatch, bpSet, m) {
  if (!bpMatch) return html`<p class="note">Not available: this source publishes no point score, so break points cannot be observed.</p>`;
  const pt = bpMatch.basis === 'points';
  const row = (s) => html`<tr><th scope="row">${playerLinks(m, s)}</th><td class="tabnum">${bpMatch.converted[s]}/${bpMatch.chances[s]}</td><td class="tabnum">${pt ? `${bpMatch.saved[s]}/${bpMatch.faced[s]}` : `${bpMatch.saved[s]}`}</td>${bpSet ? html`<td class="tabnum">${bpSet.converted[s]}/${bpSet.chances[s]}</td>` : ''}</tr>`;
  return html`<table class="v4-bp"><thead><tr><th></th><th scope="col">${pt ? 'BP converted' : 'Break games won'}</th><th scope="col">${pt ? 'BP saved' : 'Held through'}</th>${bpSet ? html`<th scope="col">This set</th>` : ''}</tr></thead><tbody>${row('A')}${row('B')}</tbody></table>
    <p class="v3-basis">${pt ? 'Every point played at break point in this match, from the source point stream.' : `Games in which a break-point score was observed${bpMatch.unknown ? ` (${bpMatch.unknown} without a provable ending)` : ''}. Observations are periodic, so break points between two observations are not counted.`} PBE-derived from observed match events.</p>`;
}

/** Compact pre-match PBE view (entitled): the FROZEN probability when the match has started; never recomputed live. */
function prematchPanel(x, m) {
  if (!x) return html`<p class="note">Loading…</p>`;
  if (x.state === 'free') return html`<p class="v4-pm-t">Matchup DNA</p><p class="note">PBE Rating win probability, form, serve/return, surface and pressure profiles for this match.</p><a class="v3-b v4-pm-cta" href="/matchups/${m.id}">Open Matchup Intelligence →</a>`;
  const d = x.data;
  if (!d) return html`<p class="note">Matchup Intelligence covers singles with both players identified.</p>`;
  const p = d.model?.probability;
  const frozen = d.pre_match?.frozen;
  const cats = (d.intel?.edge_map?.categories || []).filter((c) => c.edge === 'A' || c.edge === 'B');
  return html`<p class="v4-pm-t">${frozen ? 'Pre-match PBE Rating' : 'PBE Rating'}${frozen && d.current ? html` <small>frozen before play</small>` : ''}</p>
    ${p ? html`<p class="v4-pm-p tabnum"><span>${sideName(m, 'A')} <b>${Math.round(p.A * 1000) / 10}%</b></span><span><b>${Math.round(p.B * 1000) / 10}%</b> ${sideName(m, 'B')}</span></p><div class="v4-pm-bar" aria-hidden="true"><i style="width:${Math.round(p.A * 100)}%"></i></div>` : html`<p class="note">${d.model?.reason || 'No published probability.'}</p>`}
    ${cats.length ? html`<ul class="v4-pm-c">${cats.map((c) => html`<li><span>${c.label}</span><b>${sideName(m, c.edge)}</b></li>`)}</ul><p class="v3-basis">DNA category comparison (${d.intel.edge_map.version}) — context, not the probability.</p>` : ''}
    <a class="v3-b v4-pm-cta" href="/matchups/${m.id}">Open full matchup →</a>`;
}

/** Set chips + previous / next game: real event indexes only. */
function navBar(evs, pos) {
  const sets = setStarts(evs);
  const pg = prevGame(evs, pos);
  const ng = nextGame(evs, pos);
  if (!evs.length) return '';
  return html`<div class="v4-nav" role="group" aria-label="Jump through the match">
    <button type="button" class="v3-b" data-seek="${pg ?? 0}" ${pg == null ? 'disabled' : ''} aria-label="Previous game">⏮ Game</button>
    <button type="button" class="v3-b" data-seek="${ng ?? pos}" ${ng == null ? 'disabled' : ''} aria-label="Next game">Game ⏭</button>
    ${sets.length > 1 ? html`<span class="v4-sets">${sets.map((s) => html`<button type="button" class="v3-chip${evs[pos] && (evs[pos].set_number || evs[pos].state?.sets?.length) === s.set ? ' on' : ''}" data-seek="${s.index}" aria-label="Jump to set ${s.set}">Set ${s.set}</button>`)}</span>` : ''}
  </div>`;
}

/** A one-line, polite announcement of what changed (instead of re-announcing the whole scoreboard). */
function announce(m, state, mode, last) {
  const mo = currentMoment(state, mode, { last });
  if (mo.final) return `Match ${state?.status === 'retired' ? 'ended by retirement' : 'complete'}.`;
  const g = mo.games ? `${sideName(m, 'A')} ${mo.games.A}, ${sideName(m, 'B')} ${mo.games.B}` : '';
  const pt = mo.point ? `, ${mo.point.A}–${mo.point.B}` : '';
  return `${last?.line ? `${last.line}. ` : ''}Set ${mo.set || ''}: ${g}${pt}${mo.server ? `, ${sideName(m, mo.server)} serving` : ''}.`;
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
  let feedAll = false; // point feed: full match timeline revealed (survives live repaints)
  let lastAnnounced = -1;
  let pmX = null; // pre-match matchup panel: { state: 'free' } | { state: 'ok', data } (loaded once)
  // render only when the markup actually changed: an unchanged poll never re-paints (no flashes, no lost focus)
  const renderIf = (el, tpl) => { if (!el) return; const sig = String(tpl); if (el.__v4sig === sig) return; el.__v4sig = sig; render(el, tpl); };
  render(root, html`<div class="page ts-wrap" data-tourstate>${castTourState(TOURS_PENDING, { compact: true, state: 'pending' })}</div><div data-switch></div><div class="pbc v3" data-pbc><div class="page"><p class="loading">Loading PBEcast…</p></div></div>`);
  const sw = root.querySelector('[data-switch]');
  wireRails(sw, ctl.signal);
  // the ticker keeps the viewer's scroll position across polls, and never re-renders under their focus
  const drawSwitch = (list) => {
    if (sw.contains(document.activeElement) && document.activeElement !== document.body) return;
    const was = sw.querySelector('.hm-track')?.scrollLeft;
    render(sw, liveTicker(switcherItems(list, params.id)));
    const r = sw.querySelector('[data-rail]');
    if (!r) return;
    if (was != null) r.querySelector('.hm-track').scrollLeft = was;
    else revealCurrent(r);
  };
  // wide screens show the court in landscape (the same drawing rotated): repaint when the breakpoint flips
  const wide = matchMedia('(min-width: 1024px)');
  const onWide = () => { if (data && ps) { ctlSig = ''; paint(false); } };
  wide.addEventListener('change', onWide);
  const loadLive = async () => { try { const r = await api('/v1/live', { signal: ctl.signal }); if (Array.isArray(r.data)) drawSwitch(r.data); } catch { /* aborted */ } };
  if (live) drawSwitch(live);
  loadLive();
  const livePoll = setInterval(loadLive, 30000);
  // ATP + WTA live now / up next above the court: the other tour stays visible while this match is on (tour-aware state)
  const loadTours = async () => { try { const r = await api('/v1/today', { signal: ctl.signal }); const ts = root.querySelector('[data-tourstate]'); if (ts && r?.data) render(ts, castTourState(tourStatus(r.data.live, r.data.upcoming), { compact: true })); } catch { /* aborted */ } };
  loadTours();
  const tourPoll = setInterval(loadTours, 60000);
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
      <header class="v3-bar page"><span class="v3-bar-t">${t.tournament || ''}</span><span>${[roundLabel(m.round), eventLabel(m.event_type), t.level, t.surface ? `${cap(t.surface)}${t.indoor ? ' (indoor)' : ''}` : null, m.court].filter(Boolean).join(' · ')}</span><span class="v3-bar-mode" data-mode></span><span class="v3-bar-time">${m.duration_s ? fmtDuration(m.duration_s) : ''}</span></header>
      <div class="v3-score-wrap page"><div class="v3-score" data-score></div></div>
      <p class="sr" aria-live="polite" aria-atomic="true" data-announce></p>
      <div class="v4-hero page" data-hero></div>
      <div class="v3-stage page" data-stage>
        <div class="v3-courtcol">
          ${pidShell(m, 'B')}
          <div class="v3-court" data-court></div>
          ${pidShell(m, 'A')}
          <div class="v3-controls" data-controls></div>
          <div class="v4-navwrap" data-nav></div>
        </div>
        <aside class="v3-rail" aria-labelledby="v3-rail-h">
          <h2 class="v3-rail-h" id="v3-rail-h">${data.mode.includes('live') ? 'Live intelligence' : 'Match intelligence'}</h2>
          <section class="v3-mod v4-pressure" aria-labelledby="v4-bp-h"><h3 class="v3-mod-h" id="v4-bp-h">Break-point pressure</h3><div data-pressure></div></section>
          <section class="v3-mod v3-pulse" aria-labelledby="v3-pulse-h"><h3 class="v3-mod-h" id="v3-pulse-h">Match pulse</h3><div data-intel></div></section>
          <section class="v3-mod v3-recent" aria-labelledby="v3-recent-h"><h3 class="v3-mod-h" id="v3-recent-h">Point feed</h3><div data-recent></div></section>
          <section class="v3-mod v3-games" aria-labelledby="v3-games-h"><h3 class="v3-mod-h" id="v3-games-h">Recent games</h3><div data-games></div></section>
          <section class="v3-mod v4-pm" aria-labelledby="v4-pm-h" data-pm-sec hidden><h3 class="v3-mod-h" id="v4-pm-h">Matchup</h3><div data-prematch></div></section>
        </aside>
        <div class="v3-timeline" data-timeline></div>
      </div>
      <p class="pbc-note page">${freshnessBadge(data.meta)} ${data.cadence_note}${data.quality === 'point_event' ? '' : '. Point reasons, serve speeds and ball positions are not in this feed and are never shown.'} <a href="#pbc-more">More intelligence ↓</a></p>
      <div class="page pbc-panels" id="pbc-more">
        <section class="mod"><header class="mod-h"><h2>Key moments</h2></header><div class="mod-b">${data.moments.length ? html`<div class="km">${data.moments.map((k) => html`<button type="button" class="km-b" data-jump="${k.event_id}"><b>${k.kind}</b>${k.side ? ` ${sideName(m, k.side)}` : ''}<small>${k.text}</small></button>`)}</div>` : html`<p class="note">No provable key moments yet.</p>`}</div></section>
        <div class="grid-2">
          <section class="mod"><header class="mod-h"><h2>Match control</h2><span class="mod-k">Descriptive</span></header><div class="mod-b">${data.control ? html`<div class="ctl"><span style="flex:${data.control.A}">${playerLinks(m, 'A')} ${data.control.A}</span><span style="flex:${data.control.B}">${data.control.B} ${playerLinks(m, 'B')}</span></div><p class="note">${data.control.definition}.</p>` : html`<p class="note">Needs at least four games with a known winner. Not a win probability.</p>`}</div></section>
          <section class="mod"><header class="mod-h"><h2>Serve &amp; return</h2></header><div class="mod-b">${statsPanel(data.statistics)}</div></section>
          <section class="mod"><header class="mod-h"><h2>Tennis DNA</h2></header><div class="mod-b">${dnaCompare(data, m)}</div></section>
          <section class="mod"><header class="mod-h"><h2>Head to head</h2></header><div class="mod-b">${data.h2h ? html`<p class="h2h-big tabnum">${playerLinks(m, 'A')} <b>${data.h2h.A}</b> – <b>${data.h2h.B}</b> ${playerLinks(m, 'B')}</p>${data.h2h.meetings.length ? html`<ul class="opp">${data.h2h.meetings.map((x) => html`<li><a href="/matches/${x.id}">${x.year || ''} ${x.tournament || ''}</a><b>${x.score || ''}</b></li>`)}</ul>` : ''}<p class="note">${data.h2h.basis}.</p>` : html`<p class="note">Head-to-head is shown for singles.</p>`}</div></section>
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
    const land = wide.matches;
    render($('[data-score]'), v3Score(m, state, prev, { mode: data.mode, order: land ? ['A', 'B'] : ['B', 'A'] }));
    $('[data-stage]')?.classList.toggle('is-land', land);
    render($('[data-court]'), html`<div class="court-wrap${data.mode.includes('live') && !final ? ' is-live' : ''}${tracked ? ' is-tracked' : ''}${sit ? ` sit-${sit.kind}` : ''}" ${anim ? raw(`data-anim="${anim}"`) : ''}>
      ${tracked ? html`<span class="v3-tracked">TRACKED · ball position from the source</span>` : ''}
      ${courtSvg({ doubles: ['MD', 'WD', 'XD'].includes(m.event_type), server: final ? null : state.server, point: state.point, tiebreak: inTiebreakScore(state.point), highlight: hl, ball: cur?.coordinates || null, trail: cur?.trail || null, serveIndicator: !final, surface: m.tournament?.surface || null, landscape: land })}
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
    const mode = dataMode(data);
    const feedItem = cur && !isPoint ? pointFeed(evs.slice(0, ps.pos + 1), m, { name: (x) => sideName(m, x) }).at(-1) : null;
    const last = cur ? (isPoint ? eventText(cur, m) : feedItem ? { tag: feedItem.sit ? situationLabel(feedItem.sit, (x) => sideName(m, x)) : null, line: feedItem.line } : null) : null;
    const sitText = !final ? (situationLabel(situationOf(state, m.format), (x) => sideName(m, x)) || sit?.text || null) : null;
    renderIf($('[data-hero]'), heroMoment(m, state, mode, last, mode === 'snapshot' ? null : sitText));
    const ann = $('[data-announce]');
    if (ann && animate && lastAnnounced !== ps.pos) { ann.textContent = announce(m, state, mode, last); lastAnnounced = ps.pos; }
    renderIf($('[data-pressure]'), pressurePanel(breakPressure(evs, ps.pos, { mode }), mode === 'snapshot' ? null : breakPressure(evs, ps.pos, { mode, scope: 'set' }), m));
    renderIf($('[data-recent]'), evs.length ? feedPanel(evs, ps.pos, m, feedAll) : html`<p class="pf-note">${mode === 'snapshot' ? 'Game-level coverage: this source publishes set and game scores only, so there is no point feed and no server. The scoreboard shows the latest observed games.' : 'No stored events for this match yet.'}</p>`);
    const rg = recentGames(evs, ps.pos, { mode });
    renderIf($('[data-intel]'), html`${rg ? html`<p class="v4-rg"><b>${playerLinks(m, 'A')}</b> won <b class="tabnum">${rg.A}</b> · <b>${playerLinks(m, 'B')}</b> won <b class="tabnum">${rg.B}</b> <small>of the last ${rg.window} ${rg.basis}</small></p>` : ''}${pulsePanel(data, m, state, ps.pos, data.mode.includes('live'))}`);
    renderIf($('[data-games]'), gamesPanel(evs, ps.pos, m));
    renderIf($('[data-nav]'), navBar(evs, ps.pos));
    if (pmX) { const sec = $('[data-pm-sec]'); if (sec) sec.hidden = false; renderIf($('[data-prematch]'), prematchPanel(pmX, m)); }
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
      if (first && ['MS', 'WS'].includes(d.match.event_type) && d.match.sides?.A?.players?.length === 1 && d.match.sides?.B?.players?.length === 1) {
        getMembership({ signal: ctl.signal }).then(async (mem) => {
          pmX = mem?.entitled ? { state: 'ok', data: (await api(`/v1/matchups/${d.match.id}`, { signal: ctl.signal }).catch(() => null))?.data || null } : { state: 'free' };
          if (data && ps) paint(false);
        }).catch(() => {});
      }
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
    if (act === 'feed-all' || act === 'feed-recent') { feedAll = act === 'feed-all'; paint(false); track('pbecast_feed_expand', { match_id: data.match.id, all: feedAll }); return; }
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
  const onDocKey = (e) => {
    if (!data || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    const n = data.events.length;
    if (e.key === 'f' || e.key === 'F') { const el = $('[data-pbc]'); if (document.fullscreenElement) document.exitFullscreen(); else el?.requestFullscreen?.().catch(() => el.classList.toggle('is-fs')); e.preventDefault(); return; }
    if (!n) return;
    if (e.key === ']') { const g = nextGame(data.events, ps.pos); if (g != null) { ps = seek(ps, g, n); queue = []; paint(true); schedule(); } e.preventDefault(); }
    else if (e.key === '[') { const g = prevGame(data.events, ps.pos); if (g != null) { ps = seek(ps, g, n); queue = []; paint(false); schedule(); } e.preventDefault(); }
    else if (e.key === ' ' && ps.mode === 'replay' && !(t && /^(BUTTON|A)$/.test(t.tagName))) { ps = togglePlay(ps, n); paint(false); schedule(); e.preventDefault(); }
  };
  document.addEventListener('keydown', onDocKey);
  const onKey = (e) => {
    if (!data || !e.target.closest?.('[data-controls],[data-timeline]')) return;
    if (e.key === 'ArrowRight') { ps = step(ps, 1, data.events.length); paint(true); schedule(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { ps = step(ps, -1, data.events.length); paint(false); schedule(); e.preventDefault(); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  load(true);
  return () => { ctl.abort(); wide.removeEventListener('change', onWide); clearTimer(); clearInterval(poll); clearInterval(livePoll); clearInterval(tourPoll); document.removeEventListener('keydown', onDocKey); root.removeEventListener('click', onClick); root.removeEventListener('keydown', onKey); };
}

export const __test = { eventText, MODE_LABEL, dnaCompare };
void raw;
