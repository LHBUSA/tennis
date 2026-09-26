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

const MODE_LABEL = {
  point_by_point_live: 'Point-by-point live', point_by_point_replay: 'Replay · point-by-point',
  observed_live: 'Observed live', observed_replay: 'Replay · observed score feed', scheduled: 'Scheduled', result_only: 'Result only'
};
const REASON = { ace: 'Ace', double_fault: 'Double fault', winner: 'Winner', forced_error: 'Forced error', unforced_error: 'Unforced error', service_winner: 'Service winner', point: 'Point' };
const SPEEDS = [0.5, 1, 2, 4];

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

function scoreboard(m, state, mode) {
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
      <span class="sb-sets tabnum">${sets.map((x) => html`<b class="${(x.A > x.B ? 'A' : 'B') === s && Math.max(x.A, x.B) >= 6 ? 'w' : ''}">${x[s]}${x.tb && Math.min(x.tb.A, x.tb.B) === x.tb[s] ? html`<sup>${x.tb[s]}</sup>` : ''}</b>`)}</span>
      <span class="sb-pt tabnum">${!final && point ? point[s] : ''}</span>
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

export function mount(root, { params }) {
  const ctl = new AbortController();
  const q = new URLSearchParams(location.search);
  const st = { data: null, pos: 0, playing: false, speed: 1, timer: null, poll: null, lastEvent: null, following: true };
  render(root, html`<div class="pbc" data-pbc><div class="page"><p class="loading">Loading PBEcast…</p></div></div>`);

  const draw = () => {
    const d = st.data;
    const m = d.match;
    const evs = d.events;
    const cur = evs.length ? evs[Math.min(st.pos, evs.length - 1)] : null;
    const state = cur?.state || { status: m.status, sets: (m.sets || []).map((x) => ({ A: x.A, B: x.B, tb: x.tb })), point: m.live?.point || null, server: m.live?.server || null };
    const tb = inTiebreakScore(state.point);
    const isPoint = d.quality === 'point_event';
    const banner = cur && st.pos === evs.length - 1 && d.mode.includes('live') ? eventText(cur, m).tag : cur ? eventText(cur, m).tag : null;
    const url = `${location.origin}/pbecast/${m.id}${cur ? `?t=${cur.event_id}` : ''}`;
    const title = `${sideName(m, 'A')} vs ${sideName(m, 'B')}`;
    const replay = d.mode.includes('replay');
    render(root.querySelector('[data-pbc]'), html`
      <div class="pbc-top page">
        ${scoreboard(m, state, d.mode)}
        <p class="pbc-note">${freshnessBadge(d.meta)} <b>${MODE_LABEL[d.mode]}</b> — ${d.cadence_note}${isPoint ? '' : '. Point reasons, serve speeds and ball positions are not in this feed and are never shown.'}</p>
      </div>
      <div class="pbc-grid page">
        <section class="pbc-court" aria-label="Court">
          <div class="court-wrap">
            ${courtSvg({ doubles: ['MD', 'WD', 'XD'].includes(m.event_type), server: ['completed', 'retired'].includes(state.status) ? null : state.server, point: state.point, tiebreak: tb, highlight: isPoint && cur ? cur.winner_side : null, ball: cur?.coordinates || null })}
            ${banner ? html`<span class="court-banner ${isPoint ? 'pt' : 'obs'}">${banner}</span>` : ''}
          </div>
          ${evs.length ? html`<div class="rp" role="group" aria-label="Replay controls">
            <button type="button" data-rp="first" aria-label="First event">|◀</button>
            <button type="button" data-rp="prev" aria-label="Previous event">◀</button>
            <button type="button" data-rp="play" class="rp-play" aria-label="${st.playing ? 'Pause' : 'Play'}">${st.playing ? 'Pause' : 'Play'}</button>
            <button type="button" data-rp="next" aria-label="Next event">▶</button>
            <button type="button" data-rp="last" aria-label="Latest event">▶|</button>
            <label class="rp-speed">Speed <select data-rp-speed>${SPEEDS.map((s) => html`<option value="${s}" ${s === st.speed ? 'selected' : ''}>${s}×</option>`)}</select></label>
            <input type="range" min="0" max="${evs.length - 1}" value="${st.pos}" data-rp-range aria-label="Event position">
            <span class="rp-pos tabnum">${st.pos + 1}/${evs.length}</span>
          </div>` : ''}
          <div class="pbc-actions">
            <button type="button" class="btn line" data-fs>Fullscreen PBEcast</button>
            ${shareBar({ url, text: `${title} — PropBetEdge Tennis PBEcast`, label: 'Share' })}
          </div>
        </section>
        <aside class="pbc-feed" aria-label="${isPoint ? 'Points' : 'Observed updates'}">
          <h2>${isPoint ? (replay ? 'Points' : 'Live points') : 'Observed updates'}</h2>
          ${evs.length ? html`<ol class="feed">${evs.slice(0, st.pos + 1).slice(-60).reverse().map((e) => { const t = eventText(e, m); return html`<li class="fe q-${t.quality} ${e.event_id === cur?.event_id ? 'on' : ''}"><span class="fe-tag">${t.tag}</span><span class="fe-line">${t.line}</span>${e.state?.point ? html`<span class="fe-sc tabnum">${(e.state.sets || []).map((x) => `${x.A}-${x.B}`).join(' ')} · ${e.state.point.A}–${e.state.point.B}</span>` : ''}${t.quality === 'snapshot' ? html`<span class="fe-q">observed</span>` : ''}</li>`; })}</ol>` : emptyModule(d.meta, d.mode === 'scheduled' ? 'PBEcast starts when live coverage begins.' : 'No stored events for this match: it finished before live observation began.')}
        </aside>
      </div>
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
    st.data = d;
    if (first) {
      const t = q.get('t');
      const i = t ? d.events.findIndex((e) => e.event_id === t) : -1;
      st.pos = i >= 0 ? i : d.mode.includes('replay') ? 0 : Math.max(0, d.events.length - 1);
      st.following = !(i >= 0) && !d.mode.includes('replay');
      track(d.mode.includes('replay') ? 'tennis_pbecast_replay_open' : 'tennis_pbecast_open', { match_id: d.match.id, pbecast_mode: d.mode, match_status: d.match.status, surface: d.match.tournament?.surface });
      document.title = `${sideName(d.match, 'A')} vs ${sideName(d.match, 'B')} ${d.mode.includes('live') ? 'Live PBEcast' : 'PBEcast Replay'} | PropBetEdge Tennis`;
    } else if (st.following) st.pos = d.events.length - 1;
    draw();
    if (d.mode.includes('live') && !st.poll) st.poll = setInterval(() => load(false), 15000);
  };

  const stopPlay = () => { st.playing = false; clearInterval(st.timer); st.timer = null; };
  const step = (n) => { const max = st.data.events.length - 1; st.pos = Math.max(0, Math.min(max, st.pos + n)); st.following = st.pos === max; draw(); };
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
  return () => { ctl.abort(); stopPlay(); clearInterval(st.poll); root.removeEventListener('click', onClick); root.removeEventListener('change', onInput); root.removeEventListener('input', onInput); };
}

export const __test = { eventText, MODE_LABEL };
void raw;
