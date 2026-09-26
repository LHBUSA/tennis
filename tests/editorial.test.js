// Tennis editorial-photo resolver: real imagery only, entity-based, never an unrelated tournament's photo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHero } from '../workers/shared/editorial.js';
import catalog from '../data/media/editorial-media.json' with { type: 'json' };

const item = (o) => ({ id: o.id, type: o.type, tournaments: o.tournaments || [], edition: o.edition || null, match_id: o.match_id || null, player_ids: o.player_ids || [], derivatives: { 'wide-1200': { url: 'u' } }, caption: 'c' });
const cat = { items: [
  item({ id: 'wim-venue', type: 'venue', tournaments: ['wimbledon'] }),
  item({ id: 'wim-2025-alc', type: 'edition_action', tournaments: ['wimbledon'], edition: { slug: 'wimbledon', year: 2025 }, player_ids: ['alc'] }),
  item({ id: 'xu-wimbledon-2019', type: 'player_action', player_ids: ['xu'] }),
  item({ id: 'smith-citi-open-2017', type: 'player_action', player_ids: ['smith'] })
] };
const photos = new Map([['xu', { slug: 'yifan-xu', name: 'Yifan Xu', square: 's', wide: 'w' }], ['smith', { slug: 'alana-smith', name: 'Alana Smith', square: 's' }], ['kato', { slug: 'miyu-kato', name: 'Miyu Kato', square: 's' }]]);

test('order: same-edition photo of a featured player > featured players\' photos > edition/venue photo > fallback', () => {
  assert.equal(resolveHero({ tournament: { slug: 'wimbledon', year: 2025 }, featured_ids: ['alc'] }, cat, photos).images[0].id, 'wim-2025-alc');
  const xu = resolveHero({ tournament: { slug: 'singapore', year: 2026 }, featured_ids: ['tang', 'xu'], player_ids: ['tang', 'xu', 'kato', 'perez'] }, cat, photos);
  assert.equal(xu.type, 'player_photos');
  assert.deepEqual(xu.images.map((i) => i.slug), ['yifan-xu']);
  assert.equal(xu.confidence, 'partial', 'Tang has no approved photo: reported, never substituted');
  assert.equal(resolveHero({ tournament: { slug: 'wimbledon', year: 2024 }, featured_ids: ['nobody'] }, cat, photos).type, 'venue_photo');
  const none = resolveHero({ tournament: { slug: 'porto-125', year: 2026 }, featured_ids: ['fjorge', 'mjorge'], player_ids: ['fjorge', 'mjorge', 'kato'] }, cat, photos);
  assert.equal(none.type, 'fallback');
  assert.equal(none.images.length, 0, 'an opponent\'s photo never leads a winner\'s story');
  assert.ok(none.fallback_reason);
});

test('an unrelated tournament\'s photo is never used because the player appears in it', () => {
  const r = resolveHero({ tournament: { slug: 'ankara-125', year: 2026 }, featured_ids: ['falkowska', 'smith'] }, cat, photos);
  assert.equal(r.type, 'player_photos', 'Smith\'s canonical photo, not the 2017 Citi Open file photo');
  assert.ok(!r.images.some((i) => i.id === 'smith-citi-open-2017'));
  assert.equal(resolveHero({ tournament: { slug: 'singapore', year: 2026 }, featured_ids: ['zz'] }, cat, new Map()).type, 'fallback', 'no Wimbledon art on a Singapore story');
});

test('committed catalog: licensed, reviewed, identity-mapped, versioned derivatives', () => {
  for (const i of catalog.items) {
    assert.match(i.license, /^(CC0|Public domain|CC BY(-SA)? [\d.]+)$/i, i.id);
    assert.ok(i.author && i.source_page && i.reviewed && i.caption, i.id);
    for (const d of Object.values(i.derivatives)) assert.match(d.url, /\?v=[0-9a-f]{10}$/);
    assert.equal(i.player_ids.length, i.player_slugs.length);
  }
});
