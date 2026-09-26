// The ONE rule for which media row may become a public player photo: approval === 'approved' with a
// usable square derivative. Array order from PostgREST is never trusted, and pending/rejected rows are never
// returned (tennis_player_media may hold history rows next to the single approved one).
export function approvedMedia(media) {
  const rows = Array.isArray(media) ? media : media ? [media] : [];
  return rows.find((m) => m && m.approval === 'approved' && typeof m.derivatives?.square?.url === 'string' && m.derivatives.square.url) || null;
}
