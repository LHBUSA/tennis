// Editorial media: the resolver's truth rules and the court-graphic fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMedia, scoreItem } from '../workers/shared/editorial.js';
import { courtVisualSvg, courtFromStory } from '../workers/shared/court-visual.js';
import catalog from '../data/media/editorial-media.json' with { type: 'json' };

const item = (o) => ({ id: o.id, type: o.type, tournaments: o.tournaments || [], edition: o.edition || null, match_id: o.match_id || null, player_ids: o.player_ids || [], venue_dominant: !!o.venue_dominant, surface: o.surface || 'hard', derivatives: {}, caption: '' });
const cat = { items: [
  item({ id: 'wim-venue', type: 'venue', tournaments: ['wimbledon'], surface: 'grass' }),
  item({ id: 'wim-2025', type: 'edition_action', tournaments: ['wimbledon'], edition: { slug: 'wimbledon', year: 2025 }, player_ids: ['alc'] }),
  item({ id: 'xu-wim-wide', type: 'player_action', player_ids: ['xu'], venue_dominant: true, surface: 'grass' }),
  item({ id: 'smith-net', type: 'player_action', player_ids: ['smith'] }),
  item({ id: 'perez', type: 'player_action', player_ids: ['perez'] })
] };

test('priority: same edition > own venue; venue imagery never represents another tournament', () => {
  assert.equal(resolveMedia({ tournament: { slug: 'wimbledon', year: 2025 } }, cat).hero.id, 'wim-2025');
  assert.equal(resolveMedia({ tournament: { slug: 'wimbledon', year: 2024 } }, cat).hero.id, 'wim-venue');
  const sg = resolveMedia({ tournament: { slug: 'singapore', year: 2026 }, featured_ids: [], player_ids: [] }, cat);
  assert.equal(sg.hero.type, 'data_visual', 'no Wimbledon art on a Singapore story');
  assert.equal(sg.inline.length, 0);
});

test('people only by canonical id; a featured player photo dominated by another event’s venue is inline-only; opponents never lead', () => {
  const r = resolveMedia({ tournament: { slug: 'singapore', year: 2026 }, featured_ids: ['tang', 'xu'], player_ids: ['tang', 'xu', 'kato', 'perez'] }, cat);
  assert.equal(r.hero.type, 'data_visual');
  assert.deepEqual(r.inline.map((x) => x.id), ['xu-wim-wide', 'perez']);
  assert.ok(r.inline.every((x) => x.file_photo), 'file photos are labelled as such');
  const a = resolveMedia({ tournament: { slug: 'ankara-125', year: 2026 }, featured_ids: ['falkowska', 'smith'], player_ids: ['falkowska', 'smith'] }, cat);
  assert.equal(a.hero.id, 'smith-net');
  assert.equal(scoreItem(cat.items[4], { featured_ids: ['smith'], player_ids: ['smith'] }).score, 0, 'no shared canonical id -> unrelated');
});

test('committed catalog: licensed, reviewed, identity-mapped, versioned derivatives', () => {
  assert.ok(catalog.items.length >= 5);
  for (const i of catalog.items) {
    assert.match(i.license, /^(CC0|Public domain|CC BY(-SA)? [\d.]+)$/i, i.id);
    assert.ok(i.author && i.source_page && i.reviewed && i.caption, i.id);
    assert.ok(i.derivatives.card && i.derivatives['wide-1200'], i.id);
    for (const d of Object.values(i.derivatives)) assert.match(d.url, /\?v=[0-9a-f]{10}$/, 'immutable derivatives carry a content version');
    assert.equal(i.player_ids.length, i.player_slugs.length);
  }
});

test('court graphic: surface colour, winners at the near baseline, labelled as a graphic', () => {
  const a = { tournament: { name: 'Porto 125', year: 2026 }, evidence: { tournament: { name: 'Porto 125', year: 2026, surface: 'clay', indoor: false }, participants: { A: { players: [{ name: 'Francisca Jorge', last_name: 'Jorge' }, { name: 'Matilde Jorge', last_name: 'Jorge' }] }, B: { players: [{ name: 'Ariana Arseneault', last_name: 'Arseneault' }] } }, match: { round_label: 'final' } }, plan: { modules: [{ id: 'scoreboard', data: { winner_side: 'A', sets: [{ A: 6, B: 3 }, { A: 1, B: 0, match_tiebreak: true, tb: { A: 10, B: 3 } }] } }] } };
  const c = courtFromStory(a);
  assert.deepEqual(c.bottom, ['F. Jorge', 'M. Jorge'], 'shared surnames get initials');
  assert.deepEqual(c.sets, [{ w: '6', l: '3' }, { w: '[10]', l: '[3]' }]);
  const svg = courtVisualSvg(c);
  assert.match(svg, /#c4622d/, 'clay court colour');
  assert.match(svg, /PROPBETEDGE COURT GRAPHIC · CLAY/);
  assert.ok(!/<image/.test(svg), 'pure graphic: no embedded photograph');
});
