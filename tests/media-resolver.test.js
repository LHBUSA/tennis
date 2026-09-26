// Approved-media resolver: only an approved row with a square derivative can become player.photo,
// regardless of the order PostgREST returns embedded rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedMedia } from '../workers/shared/media.js';
import { shapePhoto, shapePlayer } from '../workers/tennis-api/src/shape.js';

const row = (approval, url) => ({ approval, derivatives: url ? { square: { url }, thumb: { url: `${url}-t` } } : {}, attribution: 'A / CC BY 4.0', license: 'CC BY 4.0', author: 'A', source_page_url: 'https://commons.wikimedia.org/wiki/File:x.jpg' });

test('pending row first + approved second -> approved wins', () => {
  assert.equal(shapePhoto([row('pending', 'P'), row('approved', 'OK')]).square, 'OK');
});
test('rejected row first + approved second -> approved wins', () => {
  assert.equal(shapePhoto([row('rejected', 'R'), row('approved', 'OK')]).square, 'OK');
});
test('approved only -> photo; single object form too', () => {
  assert.equal(shapePhoto([row('approved', 'OK')]).square, 'OK');
  assert.equal(shapePhoto(row('approved', 'OK')).square, 'OK');
});
test('no approved row -> null (monogram); pending/rejected never public', () => {
  assert.equal(shapePhoto([row('pending', 'P'), row('rejected', 'R')]), null);
  assert.equal(shapePhoto([]), null);
  assert.equal(shapePhoto(null), null);
  assert.equal(approvedMedia([row('approved', null)]), null, 'approved without a square derivative is not usable');
});
test('shapePlayer carries the full public identity contract', () => {
  const p = shapePlayer({ pbe_player_id: 'x', slug: 's', full_name: 'N', nationality: 'ITA', gender: 'F', tennis_player_media: [row('pending', 'P'), row('approved', 'OK')] });
  assert.deepEqual(Object.keys(p).sort(), ['gender', 'id', 'name', 'nationality', 'photo', 'slug'], 'last_name appears only when stored');
  assert.equal(p.photo.square, 'OK');
});
