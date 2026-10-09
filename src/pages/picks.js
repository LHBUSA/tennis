// PBE PICKS + Track Record — OFFICIAL (owner decision 2026-10-09, LHBUSA/tennis#14).
// /pbe-picks (All Access, tennis-api /v1/picks): the current official selections first — selected player, win probability,
// matchup, lock time, one-line reason, PBEcast — then the latest settled results. /track-record (public,
// /v1/picks/track-record): the official record (right / missed / void / pending) from the cutover, every settled pick, and
// the prelaunch research record kept separately and historical. Which decisions are official is decided by the ledgers
// (PICKS_ACTIVATED_AT, workers/tennis-api/src/picker.js), never by this page. Pending selections never reach a guest: the
// API gates /v1/picks* server-side; the public record carries resolved picks only. Layout: responsive grids and stacked
// rows — no tables that scroll sideways.
import { html, render } from '../lib/dom.js';
import { api } from '../data/api.js';
import { emptyModule, errorModule, resultState, freshnessBadge } from '../ui/state.js';
import { localTime, fmtDate, roundLabel } from '../ui/render.js';
import { avatar } from '../ui/avatar.js';
import { PICKS_LIVE } from './picks-flag.js';
import { getMembership } from '../lib/membership.js';

export const picksVisible = (search = globalThis.location?.search || '') => PICKS_LIVE || new URLSearchParams(search).get('preview') === 'picker';

const pc = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const RES = { W: ['RIGHT', 'w'], L: ['MISSED', 'l'], VOID: ['VOID', 'void'] };
const TOUR_OF = (p) => (p.event?.tour === 'ATP' ? 'ATP' : 'WTA');
const isOfficial = (p) => p.official === true;
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** "rolex-shanghai-masters-2026" -> "Rolex Shanghai Masters" (the record carries the canonical slug). */
export const tournamentName = (slug) => (slug ? titleCase(String(slug).replace(/-(19|20)\d{2}$/, '').replace(/-/g, ' ')).replace(/\bWta\b/g, 'WTA').replace(/\bAtp\b/g, 'ATP') : '');
const sideOf = (p) => (p.side === 'A' ? 'a' : p.side === 'B' ? 'b' : null);
const playerLink = (pl, cls = '') => (pl ? (pl.slug ? html`<a class="${cls}" href="/players/${pl.slug}">${pl.name}</a>` : html`<span class="${cls}">${pl.name}</span>`) : html`<span class="${cls}">TBD</span>`);
const startText = (p) => (p.event?.scheduled_at ? `Starts ${localTime(p.event.scheduled_at)}` : p.lock?.day ? fmtDate(p.lock.day) : '');
const lockText = (l) => (l?.lock_at ? `Locked ${localTime(l.lock_at)}` : 'Lock pending');
const eventLine = (p) => [p.event?.tour, tournamentName(p.event?.tournament), p.event?.round ? roundLabel(p.event.round) : null].filter(Boolean).join(' · ');
/** One short line of reasoning from the stored features (never invented). */
const reasonLine = (p) => (p.why?.length ? p.why[0] : p.probability != null ? `PBE Rating makes ${p.selection?.selection_name || 'this player'} the favourite at ${pc(p.probability)}.` : '');
/** Probability bar width as a class (pk-f0 … pk-f100 in steps of 5): CSP style-src 'self' allows no inline style. */
const fillClass = (p) => `pk-f${Math.max(0, Math.min(100, Math.round((p || 0) * 20) * 5))}`;

function resultBadge(p) {
  if (p.grade) { const [t, c] = RES[p.grade.result] || [p.grade.result, 'void']; return html`<span class="pk-badge pk-${c}">${t}</span>`; }
  return html`<span class="pk-badge pk-locked">LOCKED</span>`;
}

/** The selection card: the pick is the centrepiece (also used, compact, on the match page). */
export function pickCard(p, { compact = false } = {}) {
  const e = p.event || {};
  const s = sideOf(p);
  const pick = s ? e[s] : null;
  const opp = s ? e[s === 'a' ? 'b' : 'a'] : null;
  if (p.state !== 'CALL' || !pick) {
    // a match the model did not pick (PASS / HOLD) — stated once, plainly
    return html`<article class="pk-card pk-nopick" data-pick="${p.match_id}"><p class="pk-event">${eventLine(p)}</p><p class="pk-np">No PBE Pick for this match — ${p.state === 'PASS' ? 'neither player cleared the model’s threshold' : 'not enough sourced data to lock a pick'}.</p></article>`;
  }
  return html`<article class="pk-card${p.grade ? ` is-settled pk-r-${(RES[p.grade.result] || [])[1] || 'void'}` : ''}${compact ? ' is-compact' : ''}" data-pick="${p.match_id}" data-tour="${TOUR_OF(p)}">
    <header class="pk-card-h"><p class="pk-event">${eventLine(p)}</p>${resultBadge(p)}</header>
    <div class="pk-matchup">
      <div class="pk-side is-pick">${avatar(pick, { px: compact ? 40 : 52, cls: 'pk-av' })}<div class="pk-who"><span class="pk-tag">PBE Pick</span>${playerLink(pick, 'pk-name')}</div></div>
      <span class="pk-vs" aria-hidden="true">vs</span>
      <div class="pk-side">${avatar(opp, { px: compact ? 32 : 40, cls: 'pk-av' })}<div class="pk-who">${playerLink(opp, 'pk-opp')}</div></div>
    </div>
    <div class="pk-prob"><span class="pk-prob-n">${pc(p.probability)}</span><span class="pk-prob-l">PBE win probability</span><span class="pk-bar" aria-hidden="true"><i class="pk-fill ${fillClass(p.probability)}"></i></span></div>
    ${!compact && reasonLine(p) ? html`<p class="pk-reason">${reasonLine(p)}</p>` : ''}
    ${p.grade ? html`<p class="pk-final">${p.grade.result === 'VOID' ? `Void · ${p.grade.reason}` : `Final${p.grade.score ? ` · ${p.grade.score}` : ''}`}</p>` : ''}
    <footer class="pk-card-f"><span>${lockText(p.lock)}${startText(p) ? ` · ${startText(p)}` : ''}</span><a class="pk-cast" href="/pbecast/${p.match_id}">PBEcast: ${pick.name} vs ${opp?.name || 'TBD'}</a></footer>
  </article>`;
}

/** Compact settled row (latest results strip + track record list). Stacks on mobile; never a sideways table. */
function resultRow(p) {
  const e = p.event || {};
  const s = sideOf(p);
  const pick = s ? e[s] : null;
  const opp = s ? e[s === 'a' ? 'b' : 'a'] : null;
  const [t, c] = RES[p.grade?.result] || ['—', 'void'];
  const when = p.grade?.started_at || e.scheduled_at || p.lock?.lock_at;
  return html`<li class="pk-row pk-r-${c}" data-tour="${TOUR_OF(p)}" data-stream="${isOfficial(p) ? 'official' : 'prelaunch'}">
    <span class="pk-badge pk-${c}">${t}</span>
    <span class="pk-row-main"><b>${pick?.name || '—'}</b> <span class="pk-row-p">${pc(p.probability)}</span> <span class="pk-row-vs">vs ${opp?.name || 'TBD'}</span></span>
    <span class="pk-row-meta">${[e.tour, tournamentName(e.tournament), when ? fmtDate(String(when).slice(0, 10)) : null, p.grade?.score].filter(Boolean).join(' · ')}${isOfficial(p) ? '' : html` · <span class="pk-pre">Prelaunch</span>`}</span>
  </li>`;
}

const ZERO = { W: 0, L: 0, VOID: 0, pending: 0, graded: 0, hit_rate: null };
function statTiles(r, { label = 'Official record' } = {}) {
  const t = (n, l, cls = '') => html`<div class="pk-tile ${cls}"><b>${n}</b><span>${l}</span></div>`;
  return html`<div class="pk-tiles" aria-label="${label}">
    ${t(`${r.W}–${r.L}`, 'Right – Missed', 'is-lead')}
    ${t(r.hit_rate == null ? '—' : pc(r.hit_rate), r.graded ? `Hit rate · ${r.W} of ${r.graded} graded` : 'Hit rate · none graded yet')}
    ${t(r.VOID, 'Void')}
    ${t(r.pending, 'Pending')}
  </div>`;
}

/** "How Picks Work": one disclosure, closed by default — the method lives here, not on every card. */
function howItWorks(policy) {
  const notes = policy?.disclosures || [];
  return html`<details class="pk-how" id="how-picks-work"><summary>How Picks Work</summary><div class="pk-how-b">
    <ul>${notes.map((d) => html`<li>${d.text}</li>`)}</ul>
    <p class="pk-fine">Official since ${policy?.official?.activated_at ? localTime(policy.official.activated_at) : '—'} · scope: ${policy?.scope?.official || 'ATP and WTA tour-level singles'}.</p>
    <p class="pk-fine"><a href="/track-record#technical-audit">Technical audit: versions, lock integrity and evidence hashes</a></p>
  </div></details>`;
}

/** Waiting state: exact, sourced, short — never an invented pick. */
function nextLocks(u, official) {
  const startsLater = official?.activated_at && Date.parse(official.activated_at) > Date.now();
  const lane = (label, x) => (x?.next_lock_at ? html`<li><b>${label}</b> next lock ${localTime(x.next_lock_at)} · ${x.candidates} eligible match${x.candidates === 1 ? '' : 'es'} in the next ${u.window_hours} h</li>` : html`<li><b>${label}</b> no eligible match scheduled in the next ${u?.window_hours || 48} h</li>`);
  return html`<section class="pk-wait" aria-label="Next selections">
    <h2>Next selections will appear when locked</h2>
    <p>${startsLater ? `Official Picks start ${localTime(official.activated_at)}. ` : ''}Each pick locks 60 minutes before its sourced start time.</p>
    ${u && !u.error ? html`<ul class="pk-lanes">${lane('ATP', u.atp || u.atp_shadow)}${lane('WTA', u.wta)}</ul>` : u?.error ? html`<p class="pk-fine">The schedule source did not answer just now.</p>` : ''}
  </section>`;
}

function shell(root, { kicker, heading, lede }) {
  render(root, html`<div class="page pk-page"><header class="pk-hero"><p class="pk-kicker">${kicker}</p><h1>${heading}</h1><p class="pk-lede">${lede}</p><p class="pk-meta" data-meta></p></header><div data-body><p class="loading">Loading…</p></div></div>`);
}

// 2026-10-09 P0: the page never stays on "Loading…" — a slow read times out, a failed read or a render error shows a
// visible error with a retry; only leaving the page (our own abort) ends a load silently.
export const LOAD_TIMEOUT_MS = 15000;
export async function load(root, path, draw, emptyNote, signal, { timeoutMs = LOAD_TIMEOUT_MS, fetcher = api } = {}) {
  const body = root.querySelector('[data-body]');
  if (!body) return;
  render(body, html`<p class="loading">Loading…</p>`);
  let res;
  try { res = await fetcher(path, { signal, timeoutMs }); } catch (e) {
    if (signal?.aborted) return;
    res = { ok: false, data: null, meta: { freshness: 'UNAVAILABLE', semantics: String(e?.message || e) } };
  }
  if (signal?.aborted || !body.isConnected) return;
  const fail = (meta, note) => {
    render(body, html`${errorModule(meta, note)}<p class="pk-retry"><button type="button" class="btn line" data-retry>Try again</button></p>`);
    body.querySelector('[data-retry]')?.addEventListener('click', () => load(root, path, draw, emptyNote, signal, { timeoutMs, fetcher }), { once: true });
  };
  const meta = root.querySelector('[data-meta]');
  if (meta) render(meta, html`${freshnessBadge(res.meta)}`);
  if (resultState(res) === 'error') return fail(res.meta, 'The pick ledger could not be loaded right now.');
  let out;
  try { out = (res.data != null && draw(res.data, body)) || emptyModule(res.meta, emptyNote); } catch (e) {
    console.error('[picks] render failed', e);
    return fail({ ...res.meta, freshness: 'ERROR' }, 'The pick ledger loaded but could not be displayed.');
  }
  render(body, out);
}
const notLive = (root, heading, note) => render(root, html`<div class="page"><header class="page-h"><p class="eyebrow">${heading}</p><h1>${heading}</h1><p class="lede">${note}</p></header></div>`);
const byLockAsc = (a, b) => String(a.lock?.lock_at || '').localeCompare(String(b.lock?.lock_at || ''));
const bySettledDesc = (a, b) => String(b.grade?.graded_at || '').localeCompare(String(a.grade?.graded_at || ''));

export function picks(root) {
  if (!picksVisible()) { notLive(root, 'PBE Picks', 'PBE Picks are not available right now.'); return () => {}; }
  const c = new AbortController();
  shell(root, { kicker: 'Official Picks · All Access', heading: 'PBE Picks', lede: 'Our algorithm selects matches before play. Every selection is time-locked and counted in the public track record.' });
  load(root, '/v1/picks', (d) => {
    const official = (d.picks || []).filter(isOfficial);
    const active = official.filter((p) => !p.grade).sort(byLockAsc);
    const latest = official.filter((p) => p.grade).sort(bySettledDesc).slice(0, 8);
    const rec = d.official?.all;
    return html`
      ${active.length ? html`<section class="pk-sec" aria-label="Current picks"><div class="pk-sec-h"><h2>Current picks</h2><span class="pk-count">${active.length} locked</span></div><div class="pk-cards">${active.map((p) => pickCard(p))}</div></section>` : nextLocks(d.upcoming_locks, d.official)}
      <section class="pk-sec" aria-label="Latest results"><div class="pk-sec-h"><h2>Latest results</h2>${rec ? html`<span class="pk-count">Official record ${rec.W}–${rec.L}${rec.VOID ? ` · ${rec.VOID} void` : ''}</span>` : ''}</div>
        ${latest.length ? html`<ul class="pk-rows">${latest.map(resultRow)}</ul>` : html`<p class="pk-fine">Official results appear here as soon as the first official pick is settled.</p>`}
        <p class="pk-more"><a href="/track-record">View complete Track Record →</a></p></section>
      ${howItWorks(d.policy)}`;
  }, 'No picks yet.', c.signal);
  return () => c.abort();
}

export function trackRecord(root) {
  if (!picksVisible()) { notLive(root, 'Track Record', 'Every settled PBE Pick will be listed here.'); return () => {}; }
  const c = new AbortController();
  shell(root, { kicker: 'Official PBE Picks', heading: 'Track Record', lede: 'Every official pick is graded automatically from the final result — right, missed or void. Losses stay on the record.' });
  load(root, '/v1/picks/track-record', (d, body) => {
    const o = d.official || {};
    const settled = (d.resolved || []).filter((p) => p.state === 'CALL' && p.grade).sort(bySettledDesc);
    const off = settled.filter(isOfficial);
    const pre = settled.filter((p) => !isOfficial(p));
    const preTile = (label, r) => (r ? html`<div class="pk-pre-t"><b>${label}</b><span>${r.W}–${r.L}${r.VOID ? ` · ${r.VOID} void` : ''}${r.pending ? ` · ${r.pending} pending` : ''}</span></div>` : '');
    queueMicrotask(() => wireFilters(body));
    return html`
      <section class="pk-sec" aria-label="Official record">
        <div class="pk-sec-h"><h2>Official record</h2><span class="pk-count">since ${o.activated_at ? localTime(o.activated_at) : '—'}</span></div>
        <div class="pk-filter" role="group" aria-label="Tour"><button type="button" class="is-on" data-tour-f="all" aria-pressed="true">All</button><button type="button" data-tour-f="ATP" aria-pressed="false">ATP</button><button type="button" data-tour-f="WTA" aria-pressed="false">WTA</button></div>
        <div data-tiles="all">${statTiles(o.all || ZERO)}</div>
        <div data-tiles="ATP" hidden>${statTiles(o.ATP || ZERO, { label: 'Official record · ATP' })}</div>
        <div data-tiles="WTA" hidden>${statTiles(o.WTA || ZERO, { label: 'Official record · WTA' })}</div>
        ${off.length ? html`<ul class="pk-rows" data-list="official">${off.map(resultRow)}</ul>` : html`<p class="pk-fine">The official record starts at the launch${o.activated_at ? ` (${localTime(o.activated_at)})` : ''}. Settled official picks are listed here as soon as they finish; pending picks are visible to All Access members on <a href="/pbe-picks">PBE Picks</a>.</p>`}
      </section>
      <section class="pk-sec pk-prelaunch" aria-label="Prelaunch research record">
        <div class="pk-sec-h"><h2>Prelaunch research record</h2><span class="pk-count">historical · not official</span></div>
        <p class="pk-fine">Decisions recorded before the launch by the same locked process. They are kept exactly as recorded — losses included — and are never counted in the official record.</p>
        <div class="pk-pre-tiles">${preTile('WTA tour-level', d.record?.prelaunch_wta)}${preTile('WTA 125', d.record?.prelaunch_wta125)}${preTile('ATP', d.record?.prelaunch_atp)}</div>
        ${pre.length ? html`<details class="pk-pre-list"><summary>Show ${pre.length} prelaunch results</summary><ul class="pk-rows" data-list="prelaunch">${pre.map(resultRow)}</ul></details>` : ''}
      </section>
      ${technicalAudit(d)}`;
  }, 'Nothing has been graded yet.', c.signal);
  return () => c.abort();
}

/** Tour filter: toggles the stat tiles and rows with `hidden` (no inline styles; CSP style-src 'self'). */
function wireFilters(body) {
  const btns = [...body.querySelectorAll('[data-tour-f]')];
  for (const b of btns) b.addEventListener('click', () => {
    const f = b.dataset.tourF;
    for (const x of btns) { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); }
    for (const t of body.querySelectorAll('[data-tiles]')) t.hidden = t.dataset.tiles !== f;
    for (const r of body.querySelectorAll('.pk-rows .pk-row')) r.hidden = f !== 'all' && r.dataset.tour !== f;
  });
}

/** Technical audit (closed by default): per-stream versions, counts, lock integrity, verification and evidence hashes —
 *  stacked definition cards, never a wide table. */
function technicalAudit(d) {
  const NAME = { official_wta: 'Official · WTA', official_atp: 'Official · ATP', prelaunch_wta: 'Prelaunch · WTA tour-level', prelaunch_wta125: 'Prelaunch · WTA 125', prelaunch_atp: 'Prelaunch · ATP shadow' };
  const streams = Object.entries(d.record || {}).filter(([k]) => NAME[k]);
  const v = d.verification;
  return html`<details class="pk-how pk-audit" id="technical-audit"><summary>Technical audit</summary><div class="pk-how-b">
    <div class="pk-audit-grid">${streams.map(([k, r]) => html`<dl class="pk-dl"><dt>${NAME[k]}</dt>
      <dd><span>Version</span><b>${r.version || '—'}</b></dd>
      <dd><span>Decisions</span><b>${r.decisions} (${r.CALL} picks · ${r.PASS} pass · ${r.HOLD} hold)</b></dd>
      <dd><span>Right–Missed · Void · Pending</span><b>${r.W}–${r.L} · ${r.VOID} · ${r.pending}</b></dd>
      <dd><span>Mean probability · Brier</span><b>${pc(r.mean_p)} · ${r.brier == null ? '—' : r.brier.toFixed(3)}</b></dd>
      <dd><span>Locked before start</span><b>${r.lock_integrity ? `${r.lock_integrity.before_start} / ${r.lock_integrity.checked}` : '—'}</b></dd></dl>`)}</div>
    ${d.policy?.lock_rule ? html`<p class="pk-fine">Lock rule: ${d.policy.lock_rule} Grading: ${d.policy.grading}</p>` : ''}
    ${v?.counts ? html`<p class="pk-fine">Independent lock verification (${v.check_version || 'lock-verify'}): ${Object.entries(v.counts).map(([k, n]) => `${k.replace(/_/g, ' ')} ${Object.entries(n).filter(([, x]) => x).map(([s, x]) => `${x} ${s}`).join(', ') || '0'}`).join(' · ')}.</p>` : ''}
    ${d.lock_proofs?.length ? html`<ul class="pk-proofs" aria-label="Lock evidence">${d.lock_proofs.slice(0, 40).map((x) => html`<li><span>${x.scope === 'atp_official' ? 'ATP · official pick stream' : 'ATP · prelaunch'} · locked ${localTime(x.decided_at)}</span><code>${(x.record_sha256 || '').slice(0, 16)}</code><span>${x.resolved ? 'settled' : 'pending (All Access)'}</span></li>`)}</ul><p class="pk-fine">Each hash commits to the full stored record before the result; the selection itself is shown only to All Access members until the match is settled.</p>` : ''}
  </div></details>`;
}

// ---- match page: the PBE Pick slot above Market Pulse (All Access) ----
const pickCache = new Map();
export const pickSlot = (m) => (picksVisible() && pickCache.get(m.id) ? pickCache.get(m.id) : '');
export async function pickLoad(root, m, signal) {
  if (!picksVisible() || pickCache.has(m.id)) return;
  pickCache.set(m.id, '');
  // pending selections are All Access: never request them for a visitor the server does not verify as entitled
  const mem = await getMembership().catch(() => null);
  if (!mem?.entitled) return;
  let res;
  try { res = await api(`/v1/picks/${m.id}`, { signal, timeoutMs: LOAD_TIMEOUT_MS }); } catch { pickCache.delete(m.id); return; }
  const p = res?.data?.pick;
  // only an official pick is presented as a PBE Pick on the match page
  if (!p || !isOfficial(p)) return;
  const out = html`<section class="mod pk-slot" aria-label="PBE Pick"><header class="mod-h"><h2>PBE Pick</h2></header><div class="mod-b">${pickCard(p, { compact: true })}</div></section>`;
  pickCache.set(m.id, out);
  const slot = root.querySelector('[data-pbe-pick]');
  if (slot) render(slot, out);
}
