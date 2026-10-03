// Tennis official video lane (keyless). Pattern reused from Golf (golf-ingest/src/video.js): verified official channels ->
// public Atom feed -> title classification -> resolution to ONE canonical match -> oEmbed embeddability -> stored link.
// Polling every channel's feed (~every 30 min) sees every upload, including highlights posted hours after a final,
// with no per-match YouTube requests. Nothing is downloaded or rehosted; the frontend embeds poster-first.
// Storage (KV TENNIS_STATE): video:v1:catalog (every seen long-form upload + its decision) and video:v1:by-match.

import registry from '../../../data/source-registry/youtube-channels.json' with { type: 'json' };
import { youtubeFeed, youtubeOembed } from '../../providers/youtube.js';
import { normalizeName } from '../../shared/canonical/identity.js';
import { fetchRun } from './jobs.js';
import { inList } from '../../shared/store/postgrest.js';

export const VIDEO_VERSION = 'tennis-video/1';
export const KV_CATALOG = 'video:v1:catalog';
export const KV_BY_MATCH = 'video:v1:by-match';
export const KV_LAST = 'video:v1:last_run';
export const RUN_EVERY_MS = 25 * 60 * 1000;
const DAY = 86400e3;
const CATALOG_MAX = 2500;

// ---- classification (title only; first family wins; evidence kept) --------------------------------------------
// Order = ranking: a full replay first, then condensed / extended, match highlights, interview. "Highlights" is never a
// replay; a "Classic Match" / archive upload is rejected later by the year check, not here.
const FAMILIES = [
  ['full_match', 'Full match replay', 1, /\bfull[- ]match\b|\bfull replay\b|\bfull match replay\b/i],
  ['extended_highlights', 'Extended highlights', 2, /\bcondensed match\b|\bextended highlights\b/i],
  ['interview', 'Interview', 4, /\bpress conference\b|\binterview\b|\bpost[- ]match\b|\bspeech\b|\bon[- ]court interview\b/i],
  ['tournament_coverage', 'Tournament highlights', 5, /\bhighlights day \d+\b|\bday \d+ highlights\b|\bmontage\b/i],
  ['match_highlights', 'Match highlights', 3, /\bhighlights?\b/i]
];
export const RANK = Object.fromEntries(FAMILIES.map(([t, , r]) => [t, r]));
export const LABEL = Object.fromEntries(FAMILIES.map(([t, l]) => [t, l]));

export function classifyVideo(title, { is_short = false } = {}) {
  if (is_short) return { video_type: 'short', evidence: '/shorts/' };
  for (const [type, , , re] of FAMILIES) { const m = String(title).match(re); if (m) return { video_type: type, evidence: m[0] }; }
  return { video_type: 'other', evidence: null };
}

// ---- title parsing ------------------------------------------------------------------------------------------------
const pad = (s) => ` ${normalizeName(s)} `;
const GENERIC = new Set(['open', 'tennis', 'championships', 'championship', 'tournament', 'cup', 'masters', 'the', 'of', 'group', 'presented', 'by', 'wta', 'atp', '125', '250', '500', '1000', 'international']);

/** The two side strings of a "<A> vs <B>" title segment, or null. Doubles sides keep their "/". */
export function titleSides(title) {
  const segs = String(title).split('|').map((x) => x.trim());
  for (const seg of segs) {
    const m = seg.match(/^(.*?)\s+(?:vs\.?|v\.?)\s+(.*)$/i);
    if (!m) continue;
    const strip = (x) => x.replace(/\b(full match( replay)?|full replay|condensed match|extended highlights|match highlights|highlights?|classic match)\b.*$/i, '').replace(/[^\p{L}\p{N}\s/'.-]/gu, ' ').trim();
    const a = strip(m[1]); // a caps intensifier before the names ("RUTHLESS Alexander Zverev") is a harmless extra token
    const b = strip(m[2]);
    if (a && b) return [a, b];
  }
  return null;
}

/** Every player of a side named in a side string: surname always; first name too, or the surname is pool-unique. */
export function sideNamed(sideText, players, { uniqueSurname = () => false } = {}) {
  const t = pad(sideText);
  if (!players.length) return null;
  let full = true;
  for (const p of players) {
    const last = normalizeName(p.last_name || p.full_name?.split(' ').slice(-1)[0] || '');
    if (!last || !t.includes(` ${last} `)) return null;
    const first = normalizeName(p.first_name || '');
    if (!(first && t.includes(` ${first} `))) { if (!uniqueSurname(last)) return null; full = false; }
  }
  return full ? 'full' : 'surname';
}

/** Tournament tokens of an edition: city, and the distinctive words of its own and its tournament's name. */
export function editionTokens(ed) {
  const out = new Set();
  if (ed.city) out.add(normalizeName(ed.city));
  for (const n of [ed.name, ed.tournament_name]) {
    const words = normalizeName(String(n || '').replace(/\s-\s.*$/, '')).split(' ').filter((w) => w.length >= 4 && !GENERIC.has(w));
    for (const w of words) out.add(w);
    const whole = normalizeName(String(n || '').replace(/\s-\s.*$/, ''));
    if (/^(us open|australian open|roland garros|wimbledon)$/.test(whole)) out.add(whole);
  }
  return [...out].filter(Boolean);
}

/**
 * Resolve one long-form video to ONE canonical match. candidates: [{ match_id, edition_id, event_type, status,
 * started_at, scheduled_at, sides: { A: [player], B: [player] } }]; editions: Map id -> { year, start_date, end_date, tokens }.
 * -> { status: 'linked', match_id, confidence, basis } | { status: 'unlinked' | 'ambiguous', reason }
 */
export function resolveVideo(v, candidates, editions) {
  const sides = titleSides(v.title);
  if (!sides) return { status: 'unlinked', reason: 'no_vs_pair' };
  const t = pad(v.title);
  const years = [...String(v.title).matchAll(/\b(19[6-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  const pub = Date.parse(v.published_at);
  // surname uniqueness inside the candidate pool (only used when a title prints a different first name / no first name)
  const surnames = new Map();
  for (const c of candidates) for (const s of ['A', 'B']) for (const p of c.sides[s]) { const k = normalizeName(p.last_name || ''); surnames.set(k, (surnames.get(k) || new Set()).add(p.pbe_player_id)); }
  const uniqueSurname = (k) => (surnames.get(k)?.size || 0) === 1;
  const hits = [];
  for (const c of candidates) {
    const ed = editions.get(c.edition_id);
    if (!ed || !ed.tokens.some((tok) => t.includes(` ${tok} `))) continue;
    if (years.length && !years.includes(Number(ed.year))) continue; // an archive "classic" never links to this year's match
    const from = Date.parse(c.started_at || c.scheduled_at || ed.start_date) - DAY;
    const to = Date.parse(ed.end_date || ed.start_date) + (years.length ? 200 : 21) * DAY;
    if (!(pub >= from && pub <= to)) continue;
    for (const [x, y] of [['A', 'B'], ['B', 'A']]) {
      const a = sideNamed(sides[0], c.sides[x], { uniqueSurname });
      const b = a ? sideNamed(sides[1], c.sides[y], { uniqueSurname }) : null;
      if (a && b) { hits.push({ c, conf: a === 'full' && b === 'full' ? 'high' : 'medium' }); break; }
    }
  }
  const ids = [...new Set(hits.map((h) => h.c.match_id))];
  if (!ids.length) return { status: 'unlinked', reason: 'no_candidate' };
  if (ids.length > 1) return { status: 'ambiguous', reason: `candidates:${ids.length}` };
  const h = hits[0];
  if (!['completed', 'retired', 'in_progress'].includes(h.c.status)) return { status: 'unlinked', reason: `match_status:${h.c.status}` };
  return { status: 'linked', match_id: h.c.match_id, confidence: h.conf, basis: `players(${h.conf}) + tournament + ${years.length ? 'title year' : 'publish window'}` };
}

/** Best first: full match, extended, highlights, interview, coverage; newer first within a type. */
export const rankVideos = (vs) => vs.slice().sort((a, b) => (RANK[a.video_type] ?? 9) - (RANK[b.video_type] ?? 9) || String(b.published_at).localeCompare(String(a.published_at)));

// ---- the lane --------------------------------------------------------------------------------------------------------
async function candidatesFor(store, editionIds) {
  if (!editionIds.length) return { candidates: [], editions: new Map() };
  const eds = await store.select('tennis_tournament_editions', `select=edition_id,year,start_date,end_date,name,city,tennis_tournaments(name)&edition_id=${inList(editionIds)}`);
  const matches = [];
  for (const e of eds) {
    let after = null;
    for (;;) {
      const page = await store.select('tennis_matches', `select=match_id,edition_id,event_type,status,started_at,scheduled_at&edition_id=eq.${e.edition_id}&status=in.(completed,retired,in_progress)${after ? `&match_id=gt.${after}` : ''}&order=match_id.asc&limit=1000`);
      matches.push(...page);
      if (page.length < 1000) break;
      after = page.at(-1).match_id;
    }
  }
  const parts = [];
  for (let i = 0; i < matches.length; i += 150) parts.push(...(await store.select('tennis_match_participants', `select=match_id,side,participant_key&match_id=${inList(matches.slice(i, i + 150).map((m) => m.match_id))}`)));
  const keys = [...new Set(parts.map((p) => p.participant_key))];
  const members = [];
  for (let i = 0; i < keys.length; i += 150) members.push(...(await store.select('tennis_participant_members', `select=participant_key,slot,pbe_player_id&participant_key=${inList(keys.slice(i, i + 150))}`)));
  const pids = [...new Set(members.map((m) => m.pbe_player_id))];
  const players = new Map();
  for (let i = 0; i < pids.length; i += 150) for (const p of await store.select('tennis_players', `select=pbe_player_id,full_name,first_name,last_name&pbe_player_id=${inList(pids.slice(i, i + 150))}`)) players.set(p.pbe_player_id, p);
  const byKey = new Map();
  for (const m of members.sort((a, b) => a.slot - b.slot)) { if (!byKey.has(m.participant_key)) byKey.set(m.participant_key, []); const p = players.get(m.pbe_player_id); if (p) byKey.get(m.participant_key).push(p); }
  const sides = new Map();
  for (const p of parts) { if (!sides.has(p.match_id)) sides.set(p.match_id, { A: [], B: [] }); sides.get(p.match_id)[p.side] = byKey.get(p.participant_key) || []; }
  const candidates = matches.filter((m) => sides.get(m.match_id)?.A.length && sides.get(m.match_id)?.B.length).map((m) => ({ ...m, sides: sides.get(m.match_id) }));
  const editions = new Map(eds.map((e) => [e.edition_id, { ...e, tokens: editionTokens({ ...e, tournament_name: e.tennis_tournaments?.name }) }]));
  return { candidates, editions };
}

/**
 * One run: every enabled channel's feed; new long-form uploads are classified and resolved; linked videos get an oEmbed
 * check; the catalog and the match index are rewritten. Already-seen videos are never re-resolved unless they were
 * waiting (unlinked / ambiguous / embeddability unknown) and still young (14 days).
 */
export async function runVideo(ctx, { now = Date.now(), force = false } = {}) {
  const { kv, store } = ctx;
  const last = await kv.get(KV_LAST, 'json');
  if (!force && last?.at && now - Date.parse(last.at) < RUN_EVERY_MS) return { state: 'SKIPPED_RECENT', last: last.at };
  const catalog = (await kv.get(KV_CATALOG, 'json')) || { version: VIDEO_VERSION, videos: [] };
  const byId = new Map(catalog.videos.map((v) => [v.video_id, v]));
  const out = { channels: 0, entries: 0, new: 0, linked: 0, review: 0, unlinked: 0, shorts: 0, feed_mismatch: [], errors: [] };
  const fresh = [];
  for (const ch of registry.channels.filter((c) => c.enabled && c.id)) {
    const r = await fetchRun(ctx, youtubeFeed, { channelId: ch.id });
    if (r.state !== 'PASS') { out.errors.push({ channel: ch.handle, state: r.state, error: r.error || null }); continue; }
    const f = r.records[0];
    out.channels += 1;
    // re-prove the channel every run: feed title and channel id must still be the reviewed ones
    if (f.feed_title !== ch.verification.feed_title || (f.channel_id && f.channel_id !== ch.id)) { out.feed_mismatch.push({ channel: ch.handle, expected: ch.verification.feed_title, got: f.feed_title }); continue; }
    for (const e of f.entries) {
      out.entries += 1;
      if (e.channel_id && e.channel_id !== ch.id) continue;
      const prev = byId.get(e.video_id);
      const young = now - Date.parse(e.published_at) < 14 * DAY;
      if (prev && !(young && (prev.status === 'unlinked' || prev.status === 'ambiguous' || (prev.status === 'linked' && prev.embeddable == null)))) continue;
      const cls = classifyVideo(e.title, e);
      if (cls.video_type === 'short') { out.shorts += 1; if (!prev) byId.set(e.video_id, { ...e, channel_id: ch.id, channel: ch.name, channel_class: ch.class, video_type: 'short', status: 'not_linked_short', first_seen: new Date(now).toISOString() }); continue; }
      fresh.push({ ...(prev || {}), ...e, channel_id: ch.id, channel: ch.name, channel_class: ch.class, ...cls, label: LABEL[cls.video_type] || null, first_seen: prev?.first_seen || new Date(now).toISOString() });
    }
  }
  // load candidates only for editions a fresh title actually names
  let pool = { candidates: [], editions: new Map() };
  if (fresh.length) {
    const recent = await store.select('tennis_tournament_editions', `select=edition_id,name,city,year,start_date,end_date,tennis_tournaments(name)&end_date=gte.${new Date(now - 200 * DAY).toISOString().slice(0, 10)}&start_date=lte.${new Date(now + DAY).toISOString().slice(0, 10)}&limit=1000`);
    const titles = fresh.map((v) => pad(v.title));
    const named = recent.filter((e) => { const toks = editionTokens({ ...e, tournament_name: e.tennis_tournaments?.name }); return titles.some((t) => toks.some((tok) => t.includes(` ${tok} `))); });
    pool = await candidatesFor(store, named.map((e) => e.edition_id));
  }
  for (const v of fresh) {
    const res = resolveVideo(v, pool.candidates, pool.editions);
    const rec = { ...v, status: res.status, match_id: res.match_id || null, link: res.status === 'linked' ? { confidence: res.confidence, basis: res.basis } : { reason: res.reason }, resolved_at: new Date(now).toISOString() };
    if (res.status === 'linked' && rec.embeddable == null) {
      const o = await fetchRun(ctx, youtubeOembed, { videoId: v.video_id });
      rec.embeddable = o.state === 'PASS' ? true : [400, 401, 403, 404].includes(o.http_status) ? false : null;
      rec.oembed_checked_at = new Date(now).toISOString();
    }
    if (!byId.has(v.video_id)) out.new += 1;
    if (res.status === 'linked') out.linked += 1; else if (res.status === 'ambiguous') out.review += 1; else out.unlinked += 1;
    byId.set(v.video_id, rec);
  }
  const videos = [...byId.values()].sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, CATALOG_MAX);
  const byMatch = {};
  for (const v of videos) if (v.status === 'linked' && v.embeddable !== false && v.match_id) (byMatch[v.match_id] ||= []).push(v.video_id);
  await kv.put(KV_CATALOG, JSON.stringify({ version: VIDEO_VERSION, as_of: new Date(now).toISOString(), videos }));
  await kv.put(KV_BY_MATCH, JSON.stringify({ version: VIDEO_VERSION, as_of: new Date(now).toISOString(), matches: byMatch }));
  await kv.put(KV_LAST, JSON.stringify({ at: new Date(now).toISOString(), ...out }));
  return { state: 'PASS', ...out };
}
