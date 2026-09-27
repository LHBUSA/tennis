// Tennis editorial-photo resolver: tennis journalism first (event action, then event places), portraits last;
// never another tournament's photo because the player appears in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHero, tierOf } from '../workers/shared/editorial.js';
import catalog from '../data/media/editorial-media.json' with { type: 'json' };

const item = (o) => ({ id: o.id, type: o.type, tournaments: o.tournaments || [], edition: o.edition || null, event: o.event || o.edition || null, match_id: o.match_id || null, player_ids: o.player_ids || [], derivatives: { 'wide-1200': { url: 'u' } }, caption: 'c' });
const W25 = { slug: 'wimbledon', year: 2025 };
const cat = { items: [
  item({ id: 'a-match', type: 'match_action', tournaments: ['wimbledon'], edition: W25, match_id: 'm1', player_ids: ['alc'] }),
  item({ id: 'b-edition-action', type: 'match_action', tournaments: ['wimbledon'], edition: W25, player_ids: ['alc'] }),
  item({ id: 'c-edition-place', type: 'tournament_atmosphere', tournaments: ['wimbledon'], edition: W25 }),
  item({ id: 'd-old-featured-action', type: 'match_action', tournaments: ['wimbledon'], edition: { slug: 'wimbledon', year: 2019 }, player_ids: ['xu'] }),
  item({ id: 'e-venue', type: 'venue', tournaments: ['wimbledon'] }),
  item({ id: 'f-citi-open', type: 'player_action', event: { slug: 'citi-open', year: 2017 }, player_ids: ['smith'] }),
  item({ id: 'g-no-context-action', type: 'player_action', player_ids: ['kato'] })
] };
const photos = new Map([['xu', { slug: 'yifan-xu', name: 'Yifan Xu', square: 's' }], ['smith', { slug: 'alana-smith', name: 'Alana Smith', square: 's' }], ['kato', { slug: 'miyu-kato', name: 'Miyu Kato', square: 's' }]]);
const hero = (story) => resolveHero(story, cat, photos);

test('priority: match > edition action > edition place > tournament action with featured > tournament imagery', () => {
  assert.equal(hero({ match_id: 'm1', tournament: W25, featured_ids: ['alc'] }).images[0].id, 'a-match');
  const ed = hero({ match_id: 'zz', tournament: W25, featured_ids: ['nobody'] });
  assert.deepEqual([ed.tier, ed.type], [2, 'match_action'], 'an edition action photo even without the featured player');
  const noAction = { items: cat.items.filter((i) => i.id !== 'a-match' && i.id !== 'b-edition-action') };
  assert.equal(resolveHero({ tournament: W25, featured_ids: ['xu'] }, noAction, photos).images[0].id, 'c-edition-place', 'edition court/atmosphere before an older featured action and before any portrait');
  assert.equal(hero({ tournament: { slug: 'wimbledon', year: 2023 }, featured_ids: ['xu'] }).images[0].id, 'd-old-featured-action');
  const r = hero({ tournament: { slug: 'wimbledon', year: 2023 }, featured_ids: ['nobody'] });
  assert.equal(r.tier, 5, 'the tournament’s own imagery before a portrait');
});

test('portrait is identity fallback only; unrelated tournament photos are never used', () => {
  const sg = hero({ tournament: { slug: 'singapore', year: 2026 }, featured_ids: ['tang', 'xu'] });
  assert.equal(sg.type, 'portrait', 'no Singapore imagery, no Wimbledon art: Xu’s canonical portrait');
  assert.equal(sg.tier, 7);
  assert.deepEqual(sg.images.map((i) => i.slug), ['yifan-xu']);
  const ank = hero({ tournament: { slug: 'ankara-125', year: 2026 }, featured_ids: ['falkowska', 'smith'] });
  assert.equal(ank.type, 'portrait', 'the 2017 Citi Open photo is never used for Ankara');
  assert.equal(tierOf(cat.items[5], { tournament: { slug: 'ankara-125', year: 2026 }, featured_ids: ['smith'] }), 0);
  assert.equal(hero({ tournament: { slug: 'x', year: 2026 }, featured_ids: ['kato'] }).images[0].id, 'g-no-context-action', 'an action photo with no other event context outranks the portrait');
  assert.equal(hero({ tournament: { slug: 'porto-125', year: 2026 }, featured_ids: ['fj', 'mj'] }).type, 'fallback');
});

test('committed catalog: licensed, reviewed, typed, identity-mapped, versioned derivatives', () => {
  const TYPES = new Set(['match_action', 'player_action', 'court', 'venue', 'tournament_atmosphere']);
  for (const i of catalog.items) {
    assert.ok(TYPES.has(i.type), `${i.id} type ${i.type}`);
    assert.match(i.license, /^(CC0|Public domain|CC BY(-SA)? [\d.]+)$/i, i.id);
    assert.ok(i.author && i.source_page && i.reviewed && i.caption, i.id);
    for (const d of Object.values(i.derivatives)) assert.match(d.url, /\?v=[0-9a-f]{10}$/);
    assert.equal(i.player_ids.length, i.player_slugs.length);
    if (i.edition) assert.ok(i.tournaments.includes(i.edition.slug), `${i.id}: edition belongs to its tournament`);
  }
});

test('real catalog: every Slam page communicates its own tournament; newest imagery wins within a tier', () => {
  const pick = (slug, year) => resolveHero({ tournament: { slug, year }, featured_ids: [] }, catalog);
  assert.equal(pick('australian-open', 2026).tier, 2, 'AO 2026: an action photo from that edition');
  assert.equal(pick('wimbledon', 2025).tier, 2);
  assert.equal(pick('roland-garros', 2026).images[0].id, 'court-philippe-chatrier-2024', 'capture year breaks ties (2024 court over a 2011 crowd)');
  for (const s of ['us-open', 'roland-garros', 'wimbledon', 'australian-open']) assert.ok(pick(s, 2030).tier <= 5, `${s}: tournament imagery exists`);
  assert.equal(pick('singapore', 2026).type, 'fallback');
});
