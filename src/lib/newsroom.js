// Newsroom V3 front page + article helpers — PURE (tests/news-ui.test.js). docs/NEWSROOM_V3.md.
// Nothing here invents a fact: every value comes from a served card, wire item or frozen article field; a helper
// that has nothing legitimate to show returns an empty result and the caller renders nothing.

export const CLASS_LABEL = Object.freeze({ deep: 'Deep intelligence', full: 'Full story', brief: 'Brief', wire: 'Wire' });
export const CLASS_RANK = Object.freeze({ deep: 3, full: 2, brief: 1 });
export const DESK_LABEL = Object.freeze({ all: 'All', atp: 'ATP', wta: 'WTA', 'grand-slams': 'Grand Slams', doubles: 'Doubles', rankings: 'Rankings', challenger: 'Challenger', itf: 'ITF' });
/** Desk nav order (owner brief §14); ITF is listed only when populated. */
export const DESK_ORDER = ['all', 'atp', 'wta', 'grand-slams', 'doubles', 'rankings', 'challenger', 'itf'];
export const KIND_LABEL = Object.freeze({ upset: 'Upset', seed_upset: 'Seed upset', title: 'Title', doubles_title: 'Doubles title', retirement: 'Retirement', walkover: 'Walkover', marathon: 'Marathon', comeback: 'Comeback', deciding_tiebreak: 'Deciding tiebreak', dominant: 'Dominant win', qualifier_run: 'Qualifier run', new_no1: 'New No. 1', enters_top10: 'Top 10', enters_top20: 'Top 20', enters_top50: 'Top 50', enters_top100: 'Top 100', result: 'Result', final_score: 'Result' });

const t = (x) => { const v = Date.parse(x || ''); return Number.isFinite(v) ? v : 0; };
const stamp = (a) => t(a?.published_at || a?.first_published_at || a?.updated_at);

/**
 * Front-page hierarchy from published cards: the LEAD is the most significant recent story (class first, then
 * recency, within `leadWindowDays`), MAJORS the next 2-3 by the same rule, REST everything else newest-first.
 * Stories without a class rank as brief. Nothing is dropped and nothing duplicated.
 */
export function hierarchy(cards, { majors = 3, now = Date.now(), leadWindowDays = 7 } = {}) {
  const list = (cards || []).filter(Boolean);
  if (!list.length) return { lead: null, majors: [], rest: [] };
  const fresh = (a) => now - stamp(a) <= leadWindowDays * 86400e3;
  const score = (a) => (fresh(a) ? 10 : 0) + (CLASS_RANK[a.story_class] || 1);
  const ranked = [...list].sort((a, b) => score(b) - score(a) || stamp(b) - stamp(a));
  const lead = ranked[0];
  const maj = ranked.slice(1, 1 + majors);
  const top = new Set([lead, ...maj]);
  return { lead, majors: maj, rest: list.filter((a) => !top.has(a)).sort((a, b) => stamp(b) - stamp(a)) };
}

/**
 * CURRENT content per desk: articles published within `articleDays` + wire items within `wireHours`.
 * 'all' counts everything current. Returns { desk: { articles, wire, total } } for every desk in DESK_ORDER.
 */
export function deskCounts(cards, wire, { now = Date.now(), articleDays = 14, wireHours = 72 } = {}) {
  const out = Object.fromEntries(DESK_ORDER.map((d) => [d, { articles: 0, wire: 0, total: 0 }]));
  const bump = (desk, k) => { for (const d of new Set(['all', desk])) if (out[d]) { out[d][k] += 1; out[d].total += 1; } };
  for (const a of cards || []) if (now - stamp(a) <= articleDays * 86400e3) bump(a.desk, 'articles');
  for (const w of wire || []) if (now - t(w.detected_at || w.occurred_at) <= wireHours * 3600e3) bump(w.desk, 'wire');
  return out;
}

/** Desks shown in the nav: every standard desk (empty ones de-emphasised); ITF / Challenger only when populated. */
export function navDesks(counts) {
  return DESK_ORDER.filter((d) => !['itf', 'challenger'].includes(d) || counts?.[d]?.total > 0).map((d) => ({ key: d, label: DESK_LABEL[d], count: counts?.[d]?.total ?? 0, empty: d !== 'all' && !(counts?.[d]?.total > 0) }));
}

const TOUR_LABEL = { atp: 'ATP', wta: 'WTA' };
/** Display name without sponsor tails or the WTA 125 "- City, CCC" suffix ("Adana Open - Adana, TUR" -> "Adana Open"). */
export const shortName = (name) => String(name || '').replace(/\s+presented by.*$/i, '').replace(/\s*-\s*[^,]+,\s*[A-Z]{3}$/, '').trim();

/** Short event label for a wire row: city/tournament · tour. */
function eventLabel(w) {
  const short = shortName(w.tournament?.name);
  return [short || null, TOUR_LABEL[w.tour] || (w.desk && DESK_LABEL[w.desk] !== 'All' ? DESK_LABEL[w.desk] : null)].filter(Boolean).join(' · ');
}

/**
 * One live-wire row from a /v1/news/live item. Deterministic: headline + summary exactly as served (the API builds
 * them from facts); a time from detected_at (when it became known) else occurred_at. Links in the contract's order
 * (article, match, tournament, player), at most 3, deduplicated. Returns null for an item without a headline.
 */
export function wireRow(w, { tz } = {}) {
  if (!w || !w.headline) return null;
  const at = w.detected_at || w.occurred_at || null;
  const d = at ? new Date(at) : null;
  // day-precision items (results whose end time is not served) show FINAL instead of a clock time
  // historical items (recorded long after the event, or linked to a backfilled story) show the EVENT date, never a fresh time
  const hist = w.freshness?.historical && w.freshness.event_at ? new Date(w.freshness.event_at) : null;
  const time = hist && Number.isFinite(hist.getTime()) ? `Match ${hist.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : w.day_only ? 'Final' : d && Number.isFinite(d.getTime()) ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }) : '';
  const day = d && Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(tz ? { timeZone: tz } : {}) }) : '';
  const order = { article: 0, match: 1, tournament: 2, player: 3 };
  const served = (w.links || []).filter((l) => l && l.href && order[l.rel] != null);
  if (!served.length) {
    if (w.article_slug) served.push({ rel: 'article', href: `/news/${w.article_slug}`, label: 'Story' });
    if (w.match_id) served.push({ rel: 'match', href: `/matches/${w.match_id}`, label: 'Match' });
    if (w.tournament?.slug && w.tournament?.year) served.push({ rel: 'tournament', href: `/tournaments/${w.tournament.slug}/${w.tournament.year}`, label: 'Tournament' });
    for (const p of w.players || []) if (p?.slug) served.push({ rel: 'player', href: `/players/${p.slug}/dna`, label: `${p.name || 'Player'} DNA` });
  }
  const seen = new Set();
  const links = served.sort((a, b) => order[a.rel] - order[b.rel]).filter((l) => (seen.has(l.href) ? false : seen.add(l.href))).slice(0, 3)
    .map((l) => ({ ...l, label: l.label || { article: 'Story', match: 'Match', tournament: 'Tournament', player: 'Player' }[l.rel] }));
  return { id: w.id, time, day, iso: at, label: eventLabel(w), kind: KIND_LABEL[w.kind] || null, headline: w.headline, summary: w.summary || '', links, story: !!w.article_slug, story_class: w.story_class || null };
}

const fmtDur = (d) => (d ? `${d.hours ? `${d.hours}h ` : ''}${d.minutes}m` : null);
const cap = (s) => String(s || '').replace(/^\w/, (c) => c.toUpperCase());

/**
 * At-a-glance cells (3-5): the served `glance` when present (empty values dropped), else derived only from frozen
 * facts already on the article (final score, round, surface, event level, duration, key stat). Never an empty cell;
 * fewer than 2 legitimate cells -> [] (no strip).
 */
export function glanceCells(a) {
  const clean = (xs) => xs.filter((c) => c && c.label && c.value != null && String(c.value).trim() !== '' && String(c.value) !== '—');
  let cells = clean(a?.glance || []);
  if (cells.length < 3) {
    const sb = (a?.plan?.modules || []).find((m) => m.id === 'scoreboard')?.data;
    const tt = a?.evidence?.tournament || a?.tournament || {};
    const m = a?.evidence?.match || {};
    const score = sb?.sets?.length && sb.winner_side ? sb.sets.map((x) => (x.match_tiebreak && x.tb ? `[${x.tb[sb.winner_side]}-${x.tb[sb.winner_side === 'A' ? 'B' : 'A']}]` : `${x[sb.winner_side]}-${x[sb.winner_side === 'A' ? 'B' : 'A']}`)).join(' ') : null;
    const derived = clean([
      score ? { label: 'Final', value: score } : null,
      m.round_label ? { label: 'Round', value: cap(m.round_label) } : null,
      tt.surface ? { label: 'Surface', value: cap(tt.surface) } : null,
      tt.level ? { label: 'Event', value: tt.level } : null,
      fmtDur(sb?.duration) ? { label: 'Duration', value: fmtDur(sb.duration) } : null,
      a?.key_stat?.label && a?.key_stat?.value != null ? { label: a.key_stat.label, value: a.key_stat.value } : null
    ]);
    const have = new Set(cells.map((c) => c.label.toLowerCase()));
    cells = [...cells, ...derived.filter((c) => !have.has(c.label.toLowerCase()))];
  }
  cells = cells.slice(0, 5);
  return cells.length >= 2 ? cells : [];
}

/** Reading time from the served prose (220 wpm, at least 1 minute); 0 when there is no prose. */
export function readingMinutes(sections) {
  const words = (sections || []).flatMap((s) => s.paragraphs || []).join(' ').split(/\s+/).filter(Boolean).length;
  return words ? Math.max(1, Math.round(words / 220)) : 0;
}

/** Longest run of consecutive elements sharing one layout key (the "identical card wall" guard). */
export function longestSameRun(keys) {
  let best = 0;
  let run = 0;
  let prev;
  for (const k of keys || []) { run = k === prev ? run + 1 : 1; prev = k; best = Math.max(best, run); }
  return best;
}

/**
 * The reader's clock for a story (owner rule 2026-09-29). A normal story shows its publication time; a V3 backfill (the API's
 * freshness.is_backfill, from the lifecycle record) shows the EVENT date as the primary signal, never "N min ago", with the
 * later publication only as a secondary "Added to PropBetEdge" note. Pure: { iso, text, note, backfill }.
 */
const DAY = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export function storyClock(a, { relative = null, absolute = null } = {}) {
  const f = a?.freshness || null;
  const pub = a?.first_published_at || a?.published_at || a?.updated_at || null;
  if (f?.is_backfill && f.event_at) {
    return { iso: f.event_at, text: `Match ${DAY(f.event_at)}`, note: pub ? `Added to PropBetEdge ${DAY(pub)}` : null, backfill: true };
  }
  const fmt = relative || absolute || ((x) => x);
  return { iso: pub, text: pub ? fmt(pub) : '', note: null, backfill: false };
}
/** Newest non-backfill publication (the masthead's "Updated" must not be driven by a historical backfill). */
export const latestFresh = (stories) => (stories || []).filter((a) => !a?.freshness?.is_backfill).map((a) => a.published_at || a.first_published_at).filter(Boolean).sort().at(-1) || null;
