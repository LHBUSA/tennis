/**
 * Article Market module — ONE module with a lifecycle (contract article-market/1, packet post_event_market_result/1).
 * CANONICAL SOURCE: propbetedge-workers/workers/propsports-markets/client/article-market-ui.js (vendor unchanged,
 * next to kalshi-market-ui.js + article-market-ui.css). docs/POST_EVENT_MARKET_RESULT.md.
 *
 *   articleMarketModule(payload, opts)   HTML string: LIVE MARKET WATCH (market open) or THE MARKET RESULT (event over)
 *   mountArticleMarket(host, opts)       progressive enhancement: first paint from an embedded payload, then refresh
 *                                        ~30 s while visible (never offscreen / hidden tab); frozen packets never refetch
 *
 * Truth rules: venues are separate columns (never averaged); a checkpoint we did not observe says so; PBE-vs-venue
 * only for comparable venues; related markets show their own path under "RULES DIFFER"; LIVE only <= 150 s
 * ("Updated X ago" otherwise; an unchanged price says "unchanged since"); movement after publication is timing only,
 * never attributed to the story. Ineligible / nothing observed -> renders nothing (no empty state).
 */
import { sparkline, ageLabel } from './kalshi-market-ui.js'

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const cents = (bp) => (bp == null ? null : `${Number.isInteger(bp / 100) ? bp / 100 : (bp / 100).toFixed(1)}¢`)
const signed = (bp) => (bp == null ? null : `${bp > 0 ? '+' : bp < 0 ? '−' : '±'}${Math.abs(bp / 100).toFixed(1)}¢`)
const pts = (x) => (x == null ? null : `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)} pts`)
const time = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toISOString().slice(11, 16) + ' UTC' : '' }
const VENUE_CLASS = {
  CANONICAL_LINK: null,
  EXACT_MATCH: 'Exact match',
  COMPARABLE_EXCEPT_EXCEPTIONS: 'Comparable · postponement rules differ',
}
const venueTag = (v) => v.label || VENUE_CLASS[v.semantic_class] || null
const MISSING = { NO_OBSERVATION_AT_PBE_FORECAST: 'Not observed', NO_OBSERVED_PRE_EVENT_PRICE: 'No observed pre-event price', NO_OBSERVATION_AT_TIME: 'Not observed' }
const cell = (c) => (!c ? '<span class="am__na">—</span>' : c.missing ? `<span class="am__na">${esc(MISSING[c.missing] || 'Not observed')}</span>` : `<b>${esc(cents(c.mid_bp))}</b>`)

// Focus outcome: the PBE selection, else the event winner, else the first outcome.
function focusRole(packet) {
  return packet.pbe?.selection_role || packet.event_result?.winner_role || packet.venues[0]?.outcomes[0]?.role || null
}
const outcomeOf = (v, role) => v.outcomes.find((o) => o.role === role) || null
// The PBE selection's name: the frozen label, else the venue's own outcome label for that role (never a bare role).
const selectionName = (packet) => {
  const role = packet.pbe?.selection_role, own = packet.pbe?.selection_label
  if (own && own !== role) return own // some ledgers store the bare role ('away') as the label: not a name
  return packet.venues.map((v) => outcomeOf(v, role)?.label).find((l) => l && l !== role) || own || role
}

function resultTable(packet) {
  const role = focusRole(packet)
  const vs = packet.venues.filter((v) => !v.field && outcomeOf(v, role))
  if (!vs.length) return ''
  const label = outcomeOf(vs[0], role)?.label || role
  const rows = [
    ['First observed', (o) => cell(o.first_observed)],
    packet.article ? ['At publication', (o) => cell(o.at_publication)] : null,
    packet.pbe ? ['At PBE lock', (o) => cell(o.at_pbe_lock)] : null,
    ['Pre-event', (o) => cell(o.pre_event)],
    ['Final trade', (o) => (o.close?.final_trade_bp != null ? `<b>${esc(cents(o.close.final_trade_bp))}</b>` : '<span class="am__na">—</span>')],
    ['Settlement', (o) => (o.settlement ? `<b>${esc(o.settlement.result === 'yes' ? 'YES' : o.settlement.result === 'no' ? 'NO' : String(o.settlement.result || '').toUpperCase())}</b>` : '<span class="am__na">Awaiting settlement</span>')],
    ['Move (first → pre-event)', (o) => (o.move?.first_to_pre_event_bp != null ? `<b>${esc(signed(o.move.first_to_pre_event_bp))}</b>` : '<span class="am__na">—</span>')],
  ].filter(Boolean)
  const head = vs.map((v) => `<th scope="col"><a href="${esc(v.market_url)}" target="_blank" rel="sponsored noopener">${esc(v.venue_label)}</a>${venueTag(v) ? `<small>${esc(venueTag(v))}</small>` : ''}</th>`).join('')
  const body = rows.map(([name, f]) => `<tr><th scope="row">${esc(name)}</th>${vs.map((v) => `<td>${f(outcomeOf(v, role))}</td>`).join('')}</tr>`).join('')
  const sparks = vs.map((v) => { const s = outcomeOf(v, role).sparkline; return s.length >= 3 ? `<figure class="am__spark"><figcaption>${esc(v.venue_label)} · pre-event path</figcaption>${sparkline(s.map((p) => ({ t: p.t, mid_bp: p.mid_bp })))}</figure>` : '' }).join('')
  return `<p class="am__focus">${esc(label)}</p><div class="am__tw"><table class="am__t"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>${sparks ? `<div class="am__sparks">${sparks}</div>` : ''}`
}

const noCall = (packet) => (packet.pbe_status === 'NO_PBE_DECISION' ? '<div class="am__pbe"><p class="am__pbeh">PBE: <b>No official call</b> on this event</p></div>' : '')
function pbeBlock(packet) {
  const p = packet.pbe
  if (!p) return noCall(packet)
  const lines = packet.venues.map((v) => {
    if (!v.comparable_to_pbe) return `<li><span>${esc(v.venue_label)}</span><span class="am__na">${esc(venueTag(v) || 'Not comparable')} · not scored</span></li>`
    const c = v.pbe_vs_venue
    if (!c || c.venue_at_pbe_lock_bp == null) return `<li><span>${esc(v.venue_label)} at PBE lock</span><span class="am__na">Not observed</span></li>`
    const moved = { TOWARD: ' · then moved toward PBE', AWAY: ' · then moved away from PBE', UNCHANGED: ' · unchanged after the PBE lock' }[c.moved_after_pbe] || ''
    return `<li><span>${esc(v.venue_label)} at PBE lock</span><span><b>${esc(cents(c.venue_at_pbe_lock_bp))}</b> · PBE ${esc(pts(c.divergence_pts))}${esc(moved)}</span></li>`
  }).join('')
  const grade = p.grade === 'W' ? 'PBE side won' : p.grade === 'L' ? 'PBE side lost' : p.grade === 'VOID' ? 'Void' : 'Result pending'
  return `<div class="am__pbe"><h4>PBE vs market</h4><p class="am__pbeh"><b>PBE ${esc(Math.round(p.probability * 1000) / 10)}%</b> on ${esc(selectionName(packet))} · locked ${esc(time(p.lock_at))} · <span class="am__g am__g--${esc(String(p.grade || 'pending').toLowerCase())}">${esc(grade)}</span></p><ul>${lines}</ul></div>`
}

function liveTable(payload) {
  const { packet, live } = payload
  const vs = live.venues.filter((v) => v.outcomes.some((o) => o.current))
  if (!vs.length) return ''
  const pv = new Map(packet.venues.map((v) => [`${v.venue}|${v.venue_market_id ?? ''}`, v]))
  const roles = vs[0].outcomes.map((o) => o.role)
  const head = vs.map((v) => { const pvv = pv.get(`${v.venue}|${v.venue_market_id ?? ''}`) || {}; return `<th scope="col"><a href="${esc(pvv.market_url)}" target="_blank" rel="sponsored noopener">${esc(pvv.venue_label || v.venue)}</a>${venueTag(pvv) ? `<small>${esc(venueTag(pvv))}</small>` : ''}</th>` }).join('')
  const priceRows = roles.map((r) => `<tr><th scope="row">${esc(vs[0].outcomes.find((o) => o.role === r)?.label || r)}</th>${vs.map((v) => { const o = v.outcomes.find((x) => x.role === r); return `<td>${o?.current ? `<b data-am-px>${esc(cents(o.current.mid_bp))}</b>` : '<span class="am__na">—</span>'}</td>` }).join('')}</tr>`).join('')
  const focus = focusRole(packet) || roles[0]
  const pubRow = packet.article ? `<tr class="am__sub"><th scope="row">Since publication</th>${vs.map((v) => { const o = v.outcomes.find((x) => x.role === focus); return `<td>${o?.since_publication_bp != null ? esc(signed(o.since_publication_bp)) : '<span class="am__na">Not observed at publication</span>'}</td>` }).join('')}</tr>` : ''
  const firstRow = `<tr class="am__sub"><th scope="row">Since first observed</th>${vs.map((v) => { const o = v.outcomes.find((x) => x.role === focus); return `<td>${o?.since_first_bp != null ? esc(signed(o.since_first_bp)) : '<span class="am__na">—</span>'}</td>` }).join('')}</tr>`
  const fresh = `<tr class="am__sub"><th scope="row">Checked</th>${vs.map((v) => { const o = v.outcomes.find((x) => x.role === focus) || v.outcomes[0]; return `<td data-am-age="${esc(o.checked_at || '')}">${o.freshness === 'LIVE' ? '<span class="am__live">LIVE</span>' : esc(`Updated ${ageLabel(o.age_s)}`)}</td>` }).join('')}</tr>`
  const pbeNow = packet.pbe ? vs.map((v) => (v.pbe_now ? `<li><span>${esc(pv.get(`${v.venue}|${v.venue_market_id ?? ''}`)?.venue_label || v.venue)} now</span><span>PBE ${esc(pts(v.pbe_now.divergence_now_pts))}</span></li>` : '')).join('') : ''
  const pbe = !packet.pbe ? noCall(packet) : packet.pbe ? `<div class="am__pbe"><p class="am__pbeh"><b>PBE ${esc(Math.round(packet.pbe.probability * 1000) / 10)}%</b> on ${esc(selectionName(packet))}</p>${pbeNow ? `<ul>${pbeNow}</ul>` : ''}</div>` : ''
  return `<div class="am__tw"><table class="am__t"><thead><tr><th></th>${head}</tr></thead><tbody>${priceRows}${pubRow}${firstRow}${fresh}</tbody></table></div>${pbe}`
}

// ---------------------------------------------------------------------------------------------------------
// FIELD markets (golf tournament, F1 race: one contract per participant). Shows the article's participants (the
// packet's `focus` flags, from the host's `focus` list of canonical ids) else the field leaders, the venue winner
// once settled, and a clear "+N more" linking to the full market. Same truth rules: observed prices only, a
// checkpoint we did not observe is "—" (legend says so), no averaging, settlement is the venue's.
const FIELD_LEADERS = 5
const focusRoles = (focus) => new Set((Array.isArray(focus) ? focus : String(focus || '').split(',')).map((x) => String(x).trim()).filter(Boolean).map((x) => (x.startsWith('p:') ? x : `p:${x}`)))
function fieldRows(v, result, focus) {
  const want = focusRoles(focus)
  const rank = (o, i) => o.rank ?? i + 1
  const focused = v.outcomes.filter((o) => o.focus || want.has(o.role))
  const rows = focused.length ? focused.slice() : v.outcomes.filter((o, i) => rank(o, i) <= FIELD_LEADERS)
  if (result) for (const o of v.outcomes) if (o.settlement?.result === 'yes' && !rows.includes(o)) rows.push(o)
  rows.sort((a, b) => rank(a, v.outcomes.indexOf(a)) - rank(b, v.outcomes.indexOf(b)))
  const size = v.field_size ?? v.outcomes.length + (v.more_outcomes || 0)
  return { rows, more: Math.max(0, size - rows.length), focused: focused.length > 0 }
}
const fcell = (c, { move = null } = {}) => (!c || c.missing || c.mid_bp == null ? `<span class="am__na"${c?.missing ? ` title="${esc(MISSING[c.missing] || 'Not observed')}"` : ''}>—</span>` : `<b>${esc(cents(c.mid_bp))}</b>${move != null ? `<small class="am__mv">${esc(signed(move))}</small>` : ''}`)
const fname = (o) => `${o.settlement?.result === 'yes' ? '<span class="am__win">Won</span> ' : ''}${esc(o.label || o.role)}`
const moreLine = (v, more) => (more > 0 ? `<p class="am__more"><a href="${esc(v.market_url)}" target="_blank" rel="sponsored noopener">+${esc(more)} more in the field on ${esc(v.venue_label)}</a></p>` : '')
const fieldHead = (v, focused) => `<p class="am__focus"><a href="${esc(v.market_url)}" target="_blank" rel="sponsored noopener">${esc(v.venue_label)}</a> · winner market${focused ? '' : ' · leaders'}</p>`

function fieldResult(packet, v, focus) {
  const { rows, more, focused } = fieldRows(v, true, focus)
  if (!rows.length) return ''
  const cols = [
    ['First obs.', (o) => fcell(o.first_observed)],
    packet.article ? ['At pub.', (o) => fcell(o.at_publication)] : null,
    ['Pre-event', (o) => fcell(o.pre_event, { move: o.move?.first_to_pre_event_bp ?? null })],
    ['Final trade', (o) => (o.close?.final_trade_bp != null ? `<b>${esc(cents(o.close.final_trade_bp))}</b>` : '<span class="am__na">—</span>')],
    ['Result', (o) => (o.settlement ? `<b>${esc(o.settlement.result === 'yes' ? 'YES' : o.settlement.result === 'no' ? 'NO' : String(o.settlement.result || '').toUpperCase())}</b>` : '<span class="am__na">Awaiting</span>')],
  ].filter(Boolean)
  const head = cols.map(([n]) => `<th scope="col">${esc(n)}</th>`).join('')
  const body = rows.map((o) => `<tr><th scope="row">${fname(o)}</th>${cols.map(([, f]) => `<td>${f(o)}</td>`).join('')}</tr>`).join('')
  return `${fieldHead(v, focused)}<div class="am__tw"><table class="am__t am__t--field"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>${moreLine(v, more)}`
}

function fieldLive(payload, v, focus) {
  const { packet, live } = payload
  const lv = live.venues.find((x) => x.venue === v.venue && (x.venue_market_id ?? null) === (v.venue_market_id ?? null))
  if (!lv || !lv.outcomes.some((o) => o.current)) return ''
  const { rows, more, focused } = fieldRows(v, false, focus)
  const now = (r) => lv.outcomes.find((o) => o.role === r) || null
  if (!rows.some((o) => now(o.role)?.current)) return ''
  const cols = [
    ['Now', (l) => (l?.current ? `<b data-am-px>${esc(cents(l.current.mid_bp))}</b>` : '<span class="am__na">—</span>')],
    packet.article ? ['Since pub.', (l) => (l?.since_publication_bp != null ? esc(signed(l.since_publication_bp)) : '<span class="am__na">—</span>')] : null,
    ['Since first obs.', (l) => (l?.since_first_bp != null ? esc(signed(l.since_first_bp)) : '<span class="am__na">—</span>')],
  ].filter(Boolean)
  const head = cols.map(([n]) => `<th scope="col">${esc(n)}</th>`).join('')
  const body = rows.map((o) => `<tr><th scope="row">${fname(o)}</th>${cols.map(([, f]) => `<td>${f(now(o.role))}</td>`).join('')}</tr>`).join('')
  const ck = lv.outcomes.find((o) => o.checked_at) || lv.outcomes[0]
  const fresh = `<tr class="am__sub"><th scope="row">Checked</th><td colspan="${cols.length}" data-am-age="${esc(ck.checked_at || '')}">${ck.freshness === 'LIVE' ? '<span class="am__live">LIVE</span>' : esc(`Updated ${ageLabel(ck.age_s)}`)}</td></tr>`
  return `${fieldHead(v, focused)}<div class="am__tw"><table class="am__t am__t--field"><thead><tr><th></th>${head}</tr></thead><tbody>${body}${fresh}</tbody></table></div>${moreLine(v, more)}`
}

export function articleMarketModule(payload, { placement = 'article', focus = null } = {}) {
  if (!payload?.eligible || !payload.packet || !payload.live || payload.packet.packet_state === 'NO_MARKET_OBSERVED') return ''
  const { packet, live } = payload
  const result = live.mode === 'MARKET_RESULT'
  const fv = packet.venues.find((v) => v.field)
  if (fv) return fieldModule(payload, fv, { placement, focus, result })
  const body = result ? resultTable(packet) + pbeBlock(packet) : liveTable(payload)
  if (!body) return ''
  const title = result ? 'The market result' : 'Live market watch'
  const tag = result ? (packet.packet_state === 'FINAL' ? 'Settled' : 'Awaiting venue settlement') : live.in_play ? 'In-play prices' : 'Pre-event prices'
  const notes = [
    'Prediction-market prices are our timestamped observations of public venue data, shown per venue and never averaged.',
    packet.article ? 'Movement after publication is timing only; it does not mean this story moved the market.' : null,
    packet.venues.some((v) => v.disclosure) ? packet.venues.find((v) => v.disclosure).disclosure + '.' : null,
  ].filter(Boolean).map((n) => `<li>${esc(n)}</li>`).join('')
  return `<section class="am am--${result ? 'result' : 'live'}" data-am-placement="${esc(placement)}" data-am-sha="${esc(packet.sha256)}" aria-label="${esc(title)}"><header class="am__hd"><h3>${esc(title)}</h3><span class="am__tag${live.in_play && !result ? ' am__tag--inplay' : ''}">${esc(tag)}</span></header>${body}<ul class="am__notes">${notes}</ul></section>`
}

function fieldModule(payload, fv, { placement, focus, result }) {
  const { packet, live } = payload
  const table = result ? fieldResult(packet, fv, focus) : fieldLive(payload, fv, focus)
  if (!table) return ''
  const body = table + (packet.pbe ? '' : noCall(packet))
  const title = result ? 'The market result' : 'Live market watch'
  const tag = result ? (packet.packet_state === 'FINAL' ? 'Settled' : 'Awaiting venue settlement') : live.in_play ? 'In-play prices' : 'Pre-event prices'
  const notes = [
    'Prediction-market prices are our timestamped observations of public venue data, shown per venue and never averaged.',
    'One contract per participant; "—" means we did not observe a price at that checkpoint.',
    result ? 'Pre-event = our last observed price before the scheduled start; the result is the venue settlement.' : null,
    packet.article ? 'Movement after publication is timing only; it does not mean this story moved the market.' : null,
  ].filter(Boolean).map((n) => `<li>${esc(n)}</li>`).join('')
  return `<section class="am am--${result ? 'result' : 'live'} am--field" data-am-placement="${esc(placement)}" data-am-sha="${esc(packet.sha256)}" aria-label="${esc(title)}"><header class="am__hd"><h3>${esc(title)}</h3><span class="am__tag${live.in_play && !result ? ' am__tag--inplay' : ''}">${esc(tag)}</span></header>${body}<ul class="am__notes">${notes}</ul></section>`
}

// Progressive enhancement. opts: { base (REQUIRED, the product's same-origin path, e.g. '/api/markets'), sport, eventId, publishedAt, initial (embedded payload), refreshMs, fetchImpl,
//   focus (optional, FIELD events only: the article's participants as canonical ids — golf-api player slug / f1-api driver id) }.
// The host should reserve the module's height server-side when the article is eligible (zero CLS). A FINAL packet is
// rendered once and never refetched (it is the article's permanent record).
export function mountArticleMarket(host, { base, sport, eventId, publishedAt, initial = null, refreshMs = 30000, fetchImpl = (...a) => globalThis.fetch(...a), focus = null } = {}) {
  if (!host || !base || !sport || !eventId || !publishedAt) return () => {} // base required: products read through their own same-origin rewrite
  let timer = null, visible = true, stopped = false, last = initial, lastAt = initial ? Date.now() : 0
  const fq = [...focusRoles(focus)].map((r) => r.slice(2)).join(',')
  const paint = (p) => { const html = articleMarketModule(p, { focus }); if (html !== host.innerHTML) host.innerHTML = html }
  const frozen = (p) => p?.packet?.packet_state === 'FINAL' && p?.live?.mode === 'MARKET_RESULT'
  if (initial) paint(initial)
  const tick = async () => {
    if (host.isConnected === false) { stop(); return } // SPA navigated away: never keep polling a detached host
    if (stopped || frozen(last) || !visible || (typeof document !== 'undefined' && document.hidden)) return
    if (Date.now() - lastAt < refreshMs / 2) return // just read (first paint / previous tick): never double-fetch
    lastAt = Date.now()
    try {
      const r = await fetchImpl(`${base}/v1/article-market/${encodeURIComponent(sport)}/${encodeURIComponent(eventId)}?published_at=${encodeURIComponent(publishedAt)}${fq ? `&focus=${encodeURIComponent(fq)}` : ''}`)
      if (!r.ok) return // failed read: keep what is shown, never blank it
      last = await r.json()
      paint(last)
    } catch { /* keep the last good render */ }
  }
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) tick() }) : null
  io?.observe(host)
  const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) tick() }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis)
  if (!initial) tick()
  timer = setInterval(tick, refreshMs)
  function stop() { stopped = true; clearInterval(timer); io?.disconnect(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis) }
  return stop
}
