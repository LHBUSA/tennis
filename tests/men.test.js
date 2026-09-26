// Men's tennis is a first-class destination: nav + footer, /men route, and stage logic built only from
// stored results (never from rankings, which do not exist for men).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRIMARY_NAV, MORE_NAV, footerHtml } from '../src/ui/shell.js';
import { resolveRoute, STATIC_ROUTES } from '../src/lib/routes.js';
import { stages, STAGE_LABEL } from '../workers/tennis-api/src/men.js';

test('Men and News are primary destinations; Schedule and Rankings stay reachable', () => {
  assert.deepEqual(PRIMARY_NAV.map((n) => n.label), ['Today', 'Live', 'PBEcast', 'Men', 'News', 'Players', 'Tournaments', 'Tennis DNA']);
  assert.ok(MORE_NAV.some((n) => n.href === '/schedule') && MORE_NAV.some((n) => n.href === '/rankings'));
  const f = String(footerHtml());
  for (const href of ['/men', '/news', '/schedule', '/rankings']) assert.ok(f.includes(`href="${href}"`), href);
});

test('/men is an indexable static route; /rankings is a real hub, not a redirect to women', () => {
  assert.equal(resolveRoute('/men').id, 'men');
  const men = STATIC_ROUTES.find((r) => r.path === '/men');
  assert.ok(men.index && /Men/.test(men.title));
  const rk = STATIC_ROUTES.find((r) => r.path === '/rankings');
  assert.ok(rk && !rk.redirect);
});

test('stage reached comes from stored results: the final winner is champion, the loser finalist', () => {
  const p = (id) => ({ id, name: id });
  const m = (round, a, b, w) => ({ event_type: 'MS', round, status: 'completed', winner_side: w, sides: { A: { players: [p(a)] }, B: { players: [p(b)] } } });
  const out = Object.fromEntries(stages([m('F', 'x', 'y', 'A'), m('S', 'x', 'z', 'A'), m('S', 'y', 'w', 'A'), m('Q-3', 'q', 'r', 'A')]).map((s) => [s.player.id, STAGE_LABEL[s.depth]]));
  assert.deepEqual(out, { x: 'Champion', y: 'Finalist', z: 'Semifinalist', w: 'Semifinalist' });
  assert.equal(out.q, undefined, 'qualifying rounds never count as a main-draw stage');
});
