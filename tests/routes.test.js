// Route authority + canonical/robots behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoute, STATIC_ROUTES, normalizePath } from '../src/lib/routes.js';
import { routeMeta, canonicalUrl, INDEX_ROBOTS, NOINDEX_ROBOTS } from '../src/seo/meta.js';
import { initials } from '../src/ui/avatar.js';
import { coverage } from '../src/pages/coverage.js';
import registry from '../data/source-registry/sources.json' with { type: 'json' };

test('every brief route resolves', () => {
  const cases = {
    '/': 'today', '/live': 'live', '/matches': 'matches', '/matches/00000000-0000-4000-8000-000000000001': 'match', '/pbecast': 'pbecast-hub', '/pbecast/00000000-0000-4000-8000-000000000001': 'pbecast', '/schedule': 'schedule', '/dna': 'dna', '/search': 'search', '/credits': 'credits', '/venues/paris-fra': 'venue', '/rankings': 'rankings', '/players': 'players', '/players/jannik-sinner': 'player',
    '/players/jannik-sinner/dna': 'player-sub', '/players/x/matches': 'player-sub', '/players/x/surfaces': 'player-sub', '/players/x/rankings': 'player-sub',
    '/h2h/a/b': 'h2h', '/tournaments': 'tournaments', '/tournaments/wimbledon/2025': 'tournament', '/tournaments/wimbledon/2025/draw': 'tournament-sub',
    '/tournaments/wimbledon/2025/mens-singles': 'tournament-sub', '/tournaments/x/2025/womens-singles': 'tournament-sub', '/tournaments/x/2025/mens-doubles': 'tournament-sub',
    '/tournaments/x/2025/womens-doubles': 'tournament-sub', '/tournaments/x/2025/mixed-doubles': 'tournament-sub',
    '/rankings/men': 'rankings-list', '/rankings/women': 'rankings-list', '/rankings/men/doubles': 'rankings-list', '/rankings/women/doubles': 'rankings-list',
    '/breakout-watch': 'breakout-watch', '/doubles': 'doubles', '/pbe-picks': 'pbe-picks', '/track-record': 'track-record', '/news': 'news',
    '/news/atp': 'news-desk', '/news/wta': 'news-desk', '/news/challenger': 'news-desk', '/news/itf': 'news-desk', '/news/doubles': 'news-desk',
    '/news/some-story': 'not-found', '/sources': 'sources', '/methodology': 'methodology', '/labs': 'labs', '/tenniscast': 'tenniscast', '/matches/not-a-uuid': 'not-found'
  };
  for (const [p, id] of Object.entries(cases)) assert.equal(resolveRoute(p).id, id, p);
});

test('enumerated params are validated (no thin combinatorial pages)', () => {
  assert.equal(resolveRoute('/players/x/banana').id, 'not-found');
  assert.equal(resolveRoute('/tournaments/x/20x5').id, 'not-found');
  assert.equal(resolveRoute('/tournaments/x/2025/quads').id, 'not-found');
  assert.equal(resolveRoute('/rankings/juniors').id, 'not-found');
  assert.equal(resolveRoute('/pbecast/xyz').id, 'not-found');
});

test('canonical: trailing slash and duplicate slashes normalized; query/hash dropped', () => {
  assert.equal(normalizePath('/sources/'), '/sources');
  assert.equal(normalizePath('//sources?x=1#y'), '/sources');
  assert.equal(routeMeta(resolveRoute('/sources/')).canonical, 'https://tennis.propbetedge.ai/sources');
  assert.equal(canonicalUrl('/'), 'https://tennis.propbetedge.ai/');
});

test('only substantive routes are indexable today; data routes and 404 are noindex', () => {
  const indexable = STATIC_ROUTES.filter((r) => r.index).map((r) => r.path).sort();
  assert.deepEqual(indexable, ['/', '/dna', '/live', '/methodology', '/pbecast', '/players', '/rankings/women', '/rankings/women/doubles', '/schedule', '/sources', '/tournaments']);
  for (const p of ['/search', '/coverage', '/credits', '/pbe-picks', '/news', '/rankings/men']) assert.equal(routeMeta(resolveRoute(p)).robots, NOINDEX_ROBOTS, p);
  assert.equal(routeMeta(resolveRoute('/live')).robots, INDEX_ROBOTS);
  assert.equal(routeMeta(resolveRoute('/players/x')).robots, NOINDEX_ROBOTS);
  assert.equal(routeMeta(resolveRoute('/nope')).robots, NOINDEX_ROBOTS);
  assert.equal(routeMeta(resolveRoute('/')).robots, INDEX_ROBOTS);
});

test('identity-card initials fold accents', () => {
  assert.equal(initials('Félix Auger-Aliassime'), 'FA');
  assert.equal(initials('Iga Świątek'), 'IS');
  assert.equal(initials('Madonna'), 'MA');
  assert.equal(initials('Beatriz Haddad Maia'), 'BM');
});

test('coverage matrix never counts commercial reference sources', () => {
  const { families, cell } = coverage(registry);
  assert.ok(!families.includes('commercial'));
  assert.equal(cell['wta|rankings_singles'], 'PASS');
  assert.equal(cell['atp|rankings_singles'], 'BLOCKED_BY_ACCESS_CONTROL');
});
