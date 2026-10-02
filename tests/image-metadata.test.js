import test from 'node:test';
import assert from 'node:assert/strict';

import { ORGANIZATION, newsArticleLd, personLd, ccLicenseUrl, SITE } from '../src/seo/meta.js';
import { newsEntities } from '../workers/tennis-web/src/heads.js';

const fils = {
  slug: 'arthur-fils', name: 'Arthur Fils', author: 'Gordons203', license: 'CC BY-SA 4.0',
  square: 'https://tennis-api.propbetedge.ai/media/players/f/square.webp',
  source_page: 'https://commons.wikimedia.org/wiki/File:Arthur_Fils.jpg',
};
const card = { url: `${SITE}/og/news/s.png?v=1`, width: 1200, height: 630, alt: 'Fils wins' };
const base = {
  headline: 'Fils wins', slug: 's', desk: 'singles', published_at: '2026-10-01T10:00:00Z',
  evidence: { participants: { A: { players: [{ id: '1', name: 'Arthur Fils', slug: 'arthur-fils', photo: fils }] }, B: { players: [{ id: '2', name: 'Frances Tiafoe', slug: 'frances-tiafoe' }] } } },
  plan: { modules: [{ id: 'scoreboard', data: { winner_side: 'A' } }] },
};

test('logo is PropBetEdge art', () => {
  assert.deepEqual(ORGANIZATION.logo.creator, { '@type': 'Organization', name: 'PropBetEdge' });
  assert.equal(ORGANIZATION.logo.copyrightNotice, '© 2026 PropBetEdge');
});

test('CC license deed URLs are derived only from a recognised CC name', () => {
  assert.equal(ccLicenseUrl('CC BY-SA 4.0'), 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.equal(ccLicenseUrl('CC BY 2.0'), 'https://creativecommons.org/licenses/by/2.0/');
  assert.equal(ccLicenseUrl('CC0'), 'https://creativecommons.org/publicdomain/zero/1.0/');
  assert.equal(ccLicenseUrl('Public domain'), null);
});

test('portrait story: card credits the portrait it embeds; the photo credits its photographer', () => {
  const a = { ...base, media: { hero: { type: 'portrait', images: [{ kind: 'player', ...fils }] } } };
  const ld = newsArticleLd(a, `${SITE}/news/s`, card, newsEntities(a));
  const [cardNode, photo] = ld.image;
  assert.equal(cardNode.creator.name, 'PropBetEdge');
  assert.equal(cardNode.copyrightNotice, '© 2026 PropBetEdge. Photo: Gordons203 / CC BY-SA 4.0');
  assert.equal(cardNode.license, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.deepEqual(photo.creator, { '@type': 'Person', name: 'Gordons203' });
  assert.equal(photo.copyrightNotice, 'Gordons203 / CC BY-SA 4.0');
  assert.equal(photo.acquireLicensePage, fils.source_page);
});

test('text-only card is owned; card on an uncredited photo is held', () => {
  const plain = newsArticleLd({ ...base, media: null }, `${SITE}/news/s`, card, {});
  assert.equal(plain.image[0].copyrightNotice, '© 2026 PropBetEdge');
  const anon = { ...base, media: { hero: { type: 'portrait', images: [{ kind: 'player', ...fils, author: 'No machine-readable author provided. X assumed (based on copyright claims).' }] } } };
  const held = newsArticleLd(anon, `${SITE}/news/s`, card, {}).image[0];
  assert.equal(held.creator, undefined);
  assert.equal(held.copyrightNotice, undefined);
});

test('player page photo is credited to its photographer', () => {
  const p = personLd({ name: 'Arthur Fils', photo: fils }, `${SITE}/players/arthur-fils`);
  assert.equal(p.image['@type'], 'ImageObject');
  assert.equal(p.image.copyrightNotice, 'Gordons203 / CC BY-SA 4.0');
});
