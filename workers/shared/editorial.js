// Editorial media resolver (pure). Chooses a story's hero + inline visuals from the approved editorial
// catalog (data/media/editorial-media.json). Identity headshots never enter here.
//
// Priority: same match > same edition (+ same players) > the tournament's own venue > action photo of a
// featured player > generic imagery of the same tournament > PropBetEdge court/data visual.
// Guardrails: venue/edition imagery never represents another tournament; a file photo whose subject is
// another event's venue (venue_dominant) is inline-only; people are matched only by canonical player id.

const overlap = (a = [], b = []) => a.some((x) => b.includes(x));

export function scoreItem(item, story) {
  const slug = story.tournament?.slug || null;
  const year = Number(story.tournament?.year) || null;
  const featured = story.featured_ids || [];
  const everyone = story.player_ids || featured;
  const ownEvent = slug && (item.tournaments || []).includes(slug);
  if (item.match_id && story.match_id && item.match_id === story.match_id) return { score: 100, hero: true, why: 'same match' };
  if (item.edition && slug && item.edition.slug === slug && Number(item.edition.year) === year) return { score: overlap(item.player_ids, everyone) ? 90 : 80, hero: true, why: 'same edition' };
  if (item.type === 'venue' && ownEvent) return { score: 70, hero: true, why: 'tournament venue' };
  if (item.type === 'player_action' && overlap(item.player_ids, featured)) {
    const other = (item.tournaments || []).length && !ownEvent;
    if (item.venue_dominant && !ownEvent) return { score: 45, hero: false, why: 'featured player, another event’s venue dominates (inline only)' };
    return { score: 60 + (story.surface && item.surface === story.surface ? 5 : 0) - (other ? 10 : 0), hero: true, why: 'featured player in action' };
  }
  if (item.type === 'player_action' && overlap(item.player_ids, everyone)) return { score: 35, hero: false, why: 'story participant in action (inline only)' };
  if (ownEvent) return { score: 50, hero: true, why: 'same tournament' };
  return { score: 0, hero: false, why: 'unrelated' };
}

const shape = (item, s, role) => ({
  role, type: item.type, id: item.id, why: s.why,
  wide: item.derivatives, credit: item.credit, author: item.author, license: item.license, license_url: item.license_url,
  source_page: item.source_page, caption: item.caption, file_photo: !(s.why === 'same match' || s.why === 'same edition' || s.why === 'tournament venue' || s.why === 'same tournament'),
  date: item.date, player_ids: item.player_ids, player_slugs: item.player_slugs, surface: item.surface, focal: item.focal || null
});

/** story: { match_id, tournament: {slug, year}, featured_ids, player_ids, surface } -> { hero, inline } */
export function resolveMedia(story, catalog, { inlineMax = 2 } = {}) {
  const scored = (catalog?.items || []).map((item) => ({ item, s: scoreItem(item, story) })).filter((x) => x.s.score > 0).sort((a, b) => b.s.score - a.s.score || a.item.id.localeCompare(b.item.id));
  const heroPick = scored.find((x) => x.s.hero && x.s.score >= 50) || null;
  const hero = heroPick ? shape(heroPick.item, heroPick.s, 'hero') : { role: 'hero', type: 'data_visual' };
  const inline = scored.filter((x) => x !== heroPick && x.s.score >= 35 && !(heroPick && x.item.type === heroPick.item.type && x.item.type === 'venue')).slice(0, inlineMax).map((x) => shape(x.item, x.s, 'inline'));
  return { hero, inline };
}
