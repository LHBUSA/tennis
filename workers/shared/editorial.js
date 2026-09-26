// Tennis editorial-photo resolver (pure). One resolver for the article hero, /news cards and share cards.
// Real imagery only — a generated graphic is never a hero, card or social image.
//
// Order (owner rule 2026-09-26):
//   1. event photo — an approved catalog photo from THIS match / THIS edition showing a featured player
//   2. player photos — the featured side's approved canonical photos (1 player, or both of a doubles team)
//   3. event/venue photo — an approved photo of this edition, or this tournament's own venue
//   4. fallback — no image; the page renders headline-first (as propbetedge.ai news does) and cards/social
//      use the branded PropBetEdge Tennis treatment. The reason is returned so enrichment can follow up.
// Never: a photo from an unrelated tournament because the player appears in it; a person matched by name;
// an unapproved or unlicensed file.

const overlap = (a = [], b = []) => a.some((x) => b.includes(x));

function catalogPick(story, catalog) {
  const slug = story.tournament?.slug || null;
  const year = Number(story.tournament?.year) || null;
  const featured = story.featured_ids || [];
  let best = null;
  for (const item of catalog?.items || []) {
    const sameMatch = item.match_id && story.match_id && item.match_id === story.match_id;
    const sameEdition = item.edition && slug && item.edition.slug === slug && Number(item.edition.year) === year;
    const ownVenue = item.type === 'venue' && slug && (item.tournaments || []).includes(slug);
    let rank = 0;
    if ((sameMatch || sameEdition) && overlap(item.player_ids, featured)) rank = 3; // tier 1
    else if (sameMatch || sameEdition) rank = 2; // tier 3 (event)
    else if (ownVenue) rank = 1; // tier 3 (venue)
    if (rank && (!best || rank > best.rank || (rank === best.rank && item.id < best.item.id))) best = { item, rank };
  }
  return best;
}

const catalogImage = (item) => ({
  kind: 'catalog', id: item.id, type: item.type, derivatives: item.derivatives, focal: item.focal || null,
  caption: item.caption, credit: item.credit, author: item.author, license: item.license, license_url: item.license_url,
  source: 'Wikimedia Commons', source_page: item.source_page, date: item.date || null, player_ids: item.player_ids || [], player_slugs: item.player_slugs || []
});

/**
 * story: { match_id, tournament: {slug, year}, featured_ids, player_ids, at }
 * photos: Map(pbe_player_id -> { slug, name, square, portrait, wide, thumb, square_jpg, author, license, source_page, focal })
 *         approved canonical photos only (tennis_player_media approval=approved, or the story's frozen copy)
 * -> { type, images: [...], confidence, fallback_reason, subjects }
 */
export function resolveHero(story, catalog, photos = new Map()) {
  const pick = catalogPick(story, catalog);
  if (pick?.rank === 3) return { type: 'event_photo', images: [catalogImage(pick.item)], confidence: 'high', fallback_reason: null, subjects: pick.item.player_ids };
  const featured = (story.featured_ids || []).map((id) => (photos.get(id) ? { id, ...photos.get(id) } : null));
  const withPhoto = featured.filter(Boolean);
  if (withPhoto.length) {
    const missing = (story.featured_ids || []).length - withPhoto.length;
    return {
      type: 'player_photos', confidence: missing ? 'partial' : 'high',
      fallback_reason: missing ? `${missing} featured player(s) without an approved photo` : null,
      subjects: withPhoto.map((p) => p.id),
      images: withPhoto.slice(0, 2).map((p) => ({ kind: 'player', player_id: p.id, slug: p.slug, name: p.name, portrait: p.portrait || null, square: p.square || null, wide: p.wide || null, square_jpg: p.square_jpg || null, focal: p.focal || null, credit: p.credit || null, author: p.author || null, license: p.license || null, source: 'Wikimedia Commons', source_page: p.source_page || null }))
    };
  }
  if (pick) return { type: pick.item.type === 'venue' ? 'venue_photo' : 'event_photo', images: [catalogImage(pick.item)], confidence: 'medium', fallback_reason: 'no approved photo of the featured player(s); event imagery used', subjects: [] };
  return { type: 'fallback', images: [], confidence: 'none', fallback_reason: (story.featured_ids || []).length ? 'no approved photo of the featured player(s) and no approved event imagery' : 'no featured player and no approved event imagery', subjects: [] };
}
