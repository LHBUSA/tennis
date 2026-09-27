// Tennis editorial-photo resolver (pure). One resolver for the article hero, /news cards, share cards and
// tournament pages. Real imagery only — a generated graphic is never a hero, card or social image.
//
// Priority (owner rule 2026-09-27: tennis journalism first, player-profile imagery last):
// Within a tier the newest imagery wins (edition year, else capture year), then action before places, then the reviewer's visual preference.
//   1. same-match action photo
//   2. same-edition action photo                      (match_action | player_action from this edition)
//   3. same-edition court / venue / atmosphere        (court | venue | tournament_atmosphere from this edition)
//   4. same-tournament action photo with a featured player (any edition of this tournament)
//   5. same-tournament court / venue / atmosphere / action (any edition — the tournament's own imagery)
//   6. approved featured-player action photo with no other event context
//   7. canonical player portrait (identity store) — explicitly below all event imagery
//   8. branded fallback (no image; headline-first page, branded card)
// Never: a photo taken at another tournament because the player appears in it (items carry their `event`);
// a person matched by name; an unapproved or unlicensed file.

export const ACTION = new Set(['match_action', 'player_action']);
export const PLACE = new Set(['court', 'venue', 'tournament_atmosphere']);
const overlap = (a = [], b = []) => a.some((x) => b.includes(x));
// recency within a tier: the edition year, else the photo's own capture year
const yearOf = (i) => Number(i.edition?.year) || Number(String(i.date || '').match(/\b(19|20)\d{2}\b/)?.[0]) || 0;

/** Tier for one catalog item (lower is better; 0 = not usable for this story). */
export function tierOf(item, story) {
  const slug = story.tournament?.slug || null;
  const year = Number(story.tournament?.year) || null;
  const featured = story.featured_ids || [];
  const own = slug && (item.tournaments || []).includes(slug);
  const sameEdition = own && item.edition && item.edition.slug === slug && Number(item.edition.year) === year;
  const otherEvent = item.event && !(slug && item.event.slug === slug);
  if (item.match_id && story.match_id && item.match_id === story.match_id) return 1;
  if (sameEdition && ACTION.has(item.type)) return 2;
  if (sameEdition && PLACE.has(item.type)) return 3;
  if (own && ACTION.has(item.type) && overlap(item.player_ids, featured)) return 4;
  if (own) return 5;
  if (item.type === 'player_action' && !otherEvent && !(item.tournaments || []).length && overlap(item.player_ids, featured)) return 6;
  return 0;
}

const catalogImage = (item) => ({
  kind: 'catalog', id: item.id, type: item.type, derivatives: item.derivatives, focal: item.focal || null,
  caption: item.caption, credit: item.credit, author: item.author, license: item.license, license_url: item.license_url,
  source: 'Wikimedia Commons', source_page: item.source_page, date: item.date || null, edition: item.edition || null,
  player_ids: item.player_ids || [], player_slugs: item.player_slugs || []
});
const CONF = { 1: 'high', 2: 'high', 3: 'high', 4: 'medium', 5: 'medium', 6: 'medium' };
const WHY = { 1: 'same match', 2: 'same edition, action', 3: 'same edition, court/venue', 4: 'same tournament, featured player in action', 5: 'same tournament imagery', 6: 'featured player in action' };

/**
 * story: { match_id, tournament: {slug, year}, featured_ids, player_ids }
 * photos: Map(pbe_player_id -> approved canonical portrait { slug, name, square, portrait, wide, ... })
 * -> { type, tier, why, images, confidence, fallback_reason, subjects }
 */
export function resolveHero(story, catalog, photos = new Map()) {
  const ranked = (catalog?.items || []).map((item) => ({ item, t: tierOf(item, story) })).filter((x) => x.t > 0)
    // within a tier: the newest edition, then a stable id order
    .sort((a, b) => a.t - b.t || yearOf(b.item) - yearOf(a.item) || (ACTION.has(b.item.type) - ACTION.has(a.item.type)) || ((b.item.prefer || 0) - (a.item.prefer || 0)) || a.item.id.localeCompare(b.item.id));
  const pick = ranked[0];
  if (pick) return { type: pick.item.type, tier: pick.t, why: WHY[pick.t], images: [catalogImage(pick.item)], confidence: CONF[pick.t], fallback_reason: null, subjects: pick.item.player_ids || [] };
  const withPhoto = (story.featured_ids || []).filter((id) => photos.get(id)).map((id) => ({ id, ...photos.get(id) }));
  if (withPhoto.length) {
    const missing = (story.featured_ids || []).length - withPhoto.length;
    return {
      type: 'portrait', tier: 7, why: 'no event imagery; canonical portrait', confidence: missing ? 'partial' : 'medium',
      fallback_reason: `no approved event imagery for this story${missing ? `; ${missing} featured player(s) without an approved portrait` : ''}`,
      subjects: withPhoto.map((p) => p.id),
      images: withPhoto.slice(0, 2).map((p) => ({ kind: 'player', player_id: p.id, slug: p.slug, name: p.name, portrait: p.portrait || null, square: p.square || null, wide: p.wide || null, square_jpg: p.square_jpg || null, focal: p.focal || null, credit: p.credit || null, author: p.author || null, license: p.license || null, source: 'Wikimedia Commons', source_page: p.source_page || null }))
    };
  }
  return { type: 'fallback', tier: 8, why: 'no approved imagery', images: [], confidence: 'none', fallback_reason: 'no approved event imagery and no approved portrait of the featured player(s)', subjects: [] };
}
