// Shared select fragments + response shaping for tennis-api. Every player object carries its approved
// photo (or null -> the UI's deterministic monogram), never a guessed image.
import { approvedMedia } from '../../shared/media.js';

export const MEDIA = 'tennis_player_media(approval,derivatives,attribution,source_page_url,license,author)';
export const PLAYER = `tennis_players(pbe_player_id,slug,full_name,last_name,nationality,gender,${MEDIA})`;
export const SIDES = `tennis_match_participants(side,seed,entry_type,participant_key,tennis_participants(kind,tennis_participant_members(slot,${PLAYER})))`;
export const EDITION = 'tennis_tournament_editions(year,name,level,surface,indoor,start_date,end_date,city,country,venue_id,tennis_tournaments(slug,name))';
const MATCH_BASE = `match_id,event_type,round,format_key,status,winner_side,end_reason,score_text,duration_s,scheduled_at,court,schedule_note,live_state,stats_status,source_family,source_updated_at,updated_at,edition_id,${EDITION},tennis_sets(set_no,games_a,games_b,tb_a,tb_b,is_match_tiebreak,winner_side),${SIDES}`;
// Sourced day-of-play columns (migration 20261004000100) are selected only when SCHEDULE_DAY_COLUMNS === '1' (set per
// isolate from env by configureScheduleDay; env is constant for a deployment). Before the migration they are never named.
export const SCHEDULE_DAY_SELECT = 'scheduled_day,schedule_utc_offset,schedule_day_source,schedule_day_raw';
export let MATCH = MATCH_BASE;
export function configureScheduleDay(env) {
  MATCH = env?.SCHEDULE_DAY_COLUMNS === '1' ? `${SCHEDULE_DAY_SELECT},${MATCH_BASE}` : MATCH_BASE;
}
// { day, utc_offset, source, raw } | null; absent (undefined) when the columns were not selected
export const shapeScheduleDay = (m) => (m.scheduled_day ? { day: m.scheduled_day, utc_offset: m.schedule_utc_offset ?? null, source: m.schedule_day_source ?? null, raw: m.schedule_day_raw ?? null } : null);
export const FINAL = ['completed', 'retired', 'walkover'];
export const TOUR_LEVELS = ['Grand Slam', 'WTA 1000', 'WTA 500', 'WTA 250', 'WTA 125', 'WTA Finals'];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SLUG = /^[a-z0-9-]{1,80}$/;
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function shapePhoto(media) {
  const m = approvedMedia(media);
  const d = m?.derivatives;
  if (!d?.square?.url) return null;
  return {
    portrait: d.portrait?.url || null, square: d.square.url, thumb: d.thumb?.url || d.square.url, wide: d.wide?.url || null, square_jpg: d.square_jpg?.url || null,
    credit: m.attribution, author: m.author, license: m.license, license_url: d.license_url || null, source_page: m.source_page_url
  };
}

export function shapePlayer(p) {
  if (!p) return null;
  // last_name only when the source gave one (display surnames like 'Maristany Zuleta de Reales')
  return { id: p.pbe_player_id, slug: p.slug, name: p.full_name, ...(p.last_name ? { last_name: p.last_name } : {}), nationality: p.nationality, gender: p.gender, photo: shapePhoto(p.tennis_player_media) };
}

export function shapeEdition(e) {
  if (!e) return null;
  return { slug: e.tennis_tournaments?.slug || null, tournament: e.tennis_tournaments?.name || null, name: e.name, year: e.year, level: e.level, surface: e.surface, indoor: e.indoor, start_date: e.start_date, end_date: e.end_date, city: e.city || null, country: e.country || null };
}

export function shapeMatch(m) {
  const sides = {};
  for (const p of m.tennis_match_participants || []) {
    sides[p.side] = {
      participant_key: p.participant_key, seed: p.seed, entry_type: p.entry_type,
      players: (p.tennis_participants?.tennis_participant_members || []).sort((a, b) => a.slot - b.slot).map((x) => shapePlayer(x.tennis_players))
    };
  }
  return {
    id: m.match_id, event_type: m.event_type, round: m.round, format: m.format_key, status: m.status, winner_side: m.winner_side, end_reason: m.end_reason,
    score: m.score_text, duration_s: m.duration_s, scheduled_at: m.scheduled_at, court: m.court, schedule_note: m.schedule_note,
    ...(m.scheduled_day !== undefined ? { schedule_day: shapeScheduleDay(m) } : {}),
    live: m.status === 'in_progress' ? m.live_state : null,
    sets: (m.tennis_sets || []).sort((a, b) => a.set_no - b.set_no).map((s) => ({ A: s.games_a, B: s.games_b, tb: s.tb_a == null ? null : { A: s.tb_a, B: s.tb_b }, match_tiebreak: s.is_match_tiebreak, winner: s.winner_side })),
    sides, tournament: shapeEdition(m.tennis_tournament_editions), stats: m.stats_status, source: m.source_family, source_updated_at: m.source_updated_at, updated_at: m.updated_at
  };
}

export const maxTime = (rows, k = 'updated_at') => rows.reduce((t, r) => (r[k] && (!t || r[k] > t) ? r[k] : t), null);
export const families = (rows) => [...new Set(rows.map((r) => r.source_family).filter(Boolean))];
