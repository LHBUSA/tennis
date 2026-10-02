// Homepage V2 — PURE selection helpers (tests/home-v2.test.js). Nothing here invents a fact: each function picks or labels
// values the API already served and returns an empty result when there is nothing legitimate to show.

import { shortName } from './newsroom.js';

/** Tour tag for a match / tournament from the stored tour code; unknown -> null (never guessed). */
const TOUR_TAG = { atp: 'ATP', wta: 'WTA', 'wta-125': 'WTA 125' };
export const tourTag = (code) => TOUR_TAG[String(code || '').toLowerCase()] || null;
/** Accent family for a tour code: 'atp' | 'wta' | null. */
export const tourFamily = (code) => (String(code || '').startsWith('wta') ? 'wta' : String(code || '') === 'atp' ? 'atp' : null);

/** Source casing slips ("Us Open") shown as the event's proper name. Display only; the data is untouched. */
export const properName = (s) => String(s || '').replace(/\bUs Open\b/g, 'US Open');
/** Display name for a tournament object (sponsor / "- City, CCC" tails removed, casing fixed). */
export const tournamentName = (t) => {
  // the source's location tail (" - Adana, TUR", " - New York, NY, USA", " - Paris, France") is not part of the name
  const n = shortName(t?.name || t?.tournament || '').replace(/\s+-\s+[^-]*,[^-]*$/, '').trim();
  return properName(n || t?.tournament || '');
};

const ROUND_SHORT = { Q: 'QF', S: 'SF', F: 'F' };
/** Compact round: "1" -> R1, "M-4" -> R4, "Q-2" -> Q2, "S" -> SF. */
export function roundShort(code) {
  const s = String(code || '');
  const [stage, r] = s.includes('-') ? s.split('-') : ['M', s];
  if (stage === 'Q') return `Q${r}`;
  return ROUND_SHORT[r] || (/^\d+$/.test(r) ? `R${r}` : r);
}

/**
 * Live status groups: one entry per tournament with live matches, the rounds in play and the match count, busiest first.
 * [] when nothing is live (the bar then says so — never a fake ticker).
 */
export function liveGroups(live) {
  const by = new Map();
  for (const m of live || []) {
    const t = m?.tournament;
    if (!t) continue;
    const k = `${t.slug}/${t.year}`;
    const g = by.get(k) || { key: k, name: tournamentName(t), href: `/tournaments/${t.slug}/${t.year}`, rounds: new Set(), count: 0 };
    g.rounds.add(roundShort(m.round));
    g.count += 1;
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).map((g) => ({ ...g, rounds: [...g.rounds] }));
}

// Tour of a match: the stored tour code; else a WTA-tier level ("WTA 125", "WTA 1000"); else the event code (MS/MD men's
// side, WS/WD women's side — Slam rows carry tour 'grand-slam'). Mixed doubles and anything unknown -> null (never guessed).
const EVENT_TOUR = { MS: 'atp', MD: 'atp', WS: 'wta', WD: 'wta' };
export const matchTour = (m) => tourFamily(m?.tour) || (/^WTA\b/i.test(m?.tournament?.level || '') ? 'wta' : null) || EVENT_TOUR[m?.event_type] || null;
export const isDoubles = (eventType) => /D$/.test(String(eventType || ''));
const TOURS = [['atp', 'ATP'], ['wta', 'WTA']];

/**
 * Tour-aware live state (homepage status + PBEcast). One row per tour, ATP and WTA ALWAYS both present — a tour with
 * nothing on court still says so, so "only WTA live" never reads as "ATP not covered". live = in-progress matches of that
 * tour (singles / doubles split); next = that tour's soonest scheduled matches with a real clock time in the served
 * schedule window (stale past rows and date-only rows never count). next = [] -> "no scheduled match in current window".
 */
export function tourStatus(live, upcoming, { now = Date.now(), next = 3 } = {}) {
  return TOURS.map(([tour, label]) => {
    const on = (live || []).filter((m) => m?.status === 'in_progress' && matchTour(m) === tour);
    const nx = (upcoming || [])
      .filter((m) => matchTour(m) === tour && m?.status === 'scheduled' && /T\d{2}:\d{2}/.test(m.scheduled_at || '') && Date.parse(m.scheduled_at) >= now - 15 * 60e3)
      .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || String(a.id).localeCompare(String(b.id)))
      .slice(0, next);
    const doubles = on.filter((m) => isDoubles(m.event_type)).length;
    return { tour, label, live: on.length, singles: on.length - doubles, doubles, next: nx };
  });
}

/** The next scheduled match with a real clock time (date-only source times are never shown as a time). */
export function nextMatch(upcoming, { now = Date.now() } = {}) {
  return (upcoming || [])
    .filter((m) => m?.status === 'scheduled' && /T\d{2}:\d{2}/.test(m.scheduled_at || '') && Date.parse(m.scheduled_at) >= now - 15 * 60e3)
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))[0] || null;
}

/** Tournaments in progress: those with live matches first, then the most recently started; each carries its live count. */
export function orderTournaments(tournaments, live) {
  const n = new Map();
  for (const m of live || []) if (m?.tournament) n.set(`${m.tournament.slug}/${m.tournament.year}`, (n.get(`${m.tournament.slug}/${m.tournament.year}`) || 0) + 1);
  return (tournaments || []).filter(Boolean)
    .map((t) => ({ ...t, live_count: n.get(`${t.slug}/${t.year}`) || 0 }))
    .sort((a, b) => (b.live_count > 0) - (a.live_count > 0) || String(b.start_date || '').localeCompare(String(a.start_date || '')) || tournamentName(a).localeCompare(tournamentName(b)));
}

/** The latest `n` Grand Slam editions (the rest stays behind "All tournaments"). */
export const latestSlams = (editions, n = 3) => [...(editions || [])].filter(Boolean).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || ''))).slice(0, n);

/**
 * Hero player: a current Slam featured player WITH an approved photo, alternating by UTC day between the first two
 * (men's and women's champions of the latest Slam), so neither tour owns the front door. null -> court-art hero.
 */
export function heroPick(featured, { now = Date.now() } = {}) {
  const ok = (featured || []).filter((f) => f?.player?.photo?.portrait && f.player.slug);
  if (!ok.length) return null;
  const pair = ok.slice(0, 2);
  const day = Math.floor(now / 86400e3);
  const f = pair[day % pair.length];
  return { player: f.player, note: properName(f.note || '') };
}

/**
 * Players to watch: Slam featured players first, then ATP and WTA ranking leaders interleaved (No. 1 ATP, No. 1 WTA, ...),
 * deduplicated. ATP ranks are labelled with their secondary-source provenance.
 */
export function playersToWatch(featured, atpRows, wtaRows, { limit = 12, per = 6 } = {}) {
  const out = [];
  const seen = new Set();
  const add = (p, note, rank = null, tour = null) => { if (p?.id && !seen.has(p.id)) { seen.add(p.id); out.push({ player: p, note, rank, tour }); } };
  for (const f of featured || []) add(f.player, properName(f.note || ''), null, f.player?.gender === 'F' ? 'wta' : f.player?.gender === 'M' ? 'atp' : null);
  const a = (atpRows || []).slice(0, per);
  const w = (wtaRows || []).slice(0, per);
  for (let i = 0; i < per; i += 1) {
    if (a[i]) add(a[i].player, `ATP No. ${a[i].rank} · secondary-source list`, a[i].rank, 'atp');
    if (w[i]) add(w[i].player, `WTA No. ${w[i].rank}`, w[i].rank, 'wta');
  }
  return out.slice(0, limit);
}
