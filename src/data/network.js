// PropBetEdge network registry (shape follows LHBUSA/UFC web/lib/network.ts and LHBUSA/wnba src/ui/network.js).
// The Discord invite and the X account are defined exactly once, network-wide.
// Canonical network X identity: @PROPBETEDGE (https://x.com/PROPBETEDGE). Retired handles are guarded
// against in scripts/guard-truth.mjs and must never return.

export const PROPBETEDGE_DISCORD_URL = 'https://discord.gg/kb5zCTHbME';
export const PROPBETEDGE_X_HANDLE = '@PROPBETEDGE';
export const PROPBETEDGE_X_URL = 'https://x.com/PROPBETEDGE';
export const CURRENT_SPORT = 'tennis';

export const NETWORK = Object.freeze({
  news: { label: 'Sports News', href: 'https://propbetedge.ai/' },
  store: { label: 'Store', href: 'https://ufc.propbetedge.ai/store' },
  learn: { label: 'Learn', href: 'https://learn.propbetedge.ai/' },
  discord: { label: 'Discord', href: PROPBETEDGE_DISCORD_URL },
  x: { label: PROPBETEDGE_X_HANDLE, href: PROPBETEDGE_X_URL, title: 'Follow PropBetEdge on X' },
  sports: [
    { key: 'mlb', label: 'MLB', name: 'Baseball Intelligence', href: 'https://mlb.propbetedge.ai/' },
    { key: 'nfl', label: 'NFL', name: 'Football Intelligence', href: 'https://nfl.propbetedge.ai/' },
    { key: 'nba', label: 'NBA', name: 'Basketball Intelligence', href: 'https://nba.propbetedge.ai/' },
    { key: 'wnba', label: 'WNBA', name: 'WNBA Intelligence', href: 'https://wnba.propbetedge.ai/' },
    { key: 'nhl', label: 'NHL', name: 'Hockey Intelligence', href: 'https://nhl.propbetedge.ai/' },
    { key: 'ufc', label: 'UFC', name: 'Fight Intelligence', href: 'https://ufc.propbetedge.ai/' },
    { key: 'tennis', label: 'Tennis', name: 'Tennis Intelligence', href: '/' }
  ]
});
