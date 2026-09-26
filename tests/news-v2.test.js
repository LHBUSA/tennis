// News V2: links and schema come only from the frozen evidence packet's resolved entities.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkParts } from '../src/pages/news.js';
import { newsArticleLd, breadcrumb } from '../src/seo/meta.js';
import { newsEntities } from '../workers/tennis-web/src/heads.js';
import { newsCard } from '../workers/tennis-web/src/cards.js';

const ents = [
  { key: 'p:1', name: 'Qianhui Tang', href: '/players/qianhui-tang' },
  { key: 'p:2', name: 'Yifan Xu', href: '/players/yifan-xu' },
  { key: 't', name: 'Singapore', href: '/tournaments/singapore/2026' }
];
const hrefs = (parts) => parts.filter((x) => typeof x !== 'string').map((x) => String(x).match(/href="([^"]+)"/)[1]);

test('only the first exact canonical full-name mention links; surnames and repeats stay text', () => {
  const linked = new Set();
  const p1 = linkParts('Qianhui Tang and Yifan Xu won in Singapore. Tang served first.', ents, linked);
  assert.deepEqual(hrefs(p1), ['/players/qianhui-tang', '/players/yifan-xu', '/tournaments/singapore/2026']);
  const p2 = linkParts('Later, Qianhui Tang and Xu closed it out.', ents, linked);
  assert.deepEqual(hrefs(p2), [], 'already linked once; surname alone never links');
  assert.deepEqual(hrefs(linkParts('Yifan Xuan played.', ents, new Set())), [], 'no partial-word matches');
});

const a = {
  headline: 'Tang and Xu edge Kato and Perez', dek: 'd', slug: 's', desk: 'doubles', match_id: '74d84d49-df9a-59ef-9ef7-af6e824f9093', published_at: '2026-09-26T16:56:00Z', updated_at: '2026-09-26T21:09:00Z',
  tournament: { name: 'Singapore', slug: 'singapore', year: 2026 },
  evidence: { participants: { A: { players: [{ id: '1', name: 'Qianhui Tang', slug: 'qianhui-tang', photo: null }, { id: '2', name: 'Yifan Xu', slug: 'yifan-xu', photo: { square: 'https://x/sq.webp' } }] }, B: { players: [{ id: '3', name: 'Miyu Kato', slug: 'miyu-kato' }, { id: '4', name: 'Ellen Perez', slug: 'ellen-perez' }] } } },
  plan: { modules: [{ id: 'scoreboard', data: { winner_side: 'A' } }] }
};

test('schema: about = winners + the match event, mentions = every player + the edition, same #person ids as player pages', () => {
  const ctx = newsEntities(a);
  assert.deepEqual(ctx.featured.map((p) => p.slug), ['qianhui-tang', 'yifan-xu']);
  assert.deepEqual(ctx.images, ['https://x/sq.webp'], 'only approved photos of featured players');
  const ld = newsArticleLd(a, 'https://tennis.propbetedge.ai/news/s', 'https://tennis.propbetedge.ai/og/news/s.png', ctx);
  assert.equal(ld['@type'], 'NewsArticle');
  assert.equal(ld.articleSection, 'Tennis · Doubles');
  assert.deepEqual(ld.about.map((x) => x['@id']), ['https://tennis.propbetedge.ai/players/qianhui-tang#person', 'https://tennis.propbetedge.ai/players/yifan-xu#person', 'https://tennis.propbetedge.ai/matches/74d84d49-df9a-59ef-9ef7-af6e824f9093#event']);
  assert.equal(ld.mentions.filter((x) => x['@type'] === 'Person').length, 4);
  assert.equal(ld.mentions.find((x) => x['@type'] === 'Event').url, 'https://tennis.propbetedge.ai/tournaments/singapore/2026');
  const bc = breadcrumb([['PropBetEdge', 'https://propbetedge.ai/'], ['Tennis', '/'], ['News', '/news'], ['A', '/news/s']]);
  assert.deepEqual(bc.itemListElement.map((i) => i.item), ['https://propbetedge.ai/', 'https://tennis.propbetedge.ai/', 'https://tennis.propbetedge.ai/news', 'https://tennis.propbetedge.ai/news/s']);
});

test('share card composes the whole featured team; a player without an approved photo gets a monogram, never another photo', () => {
  const svg = newsCard({ headline: 'Tang and Xu edge Kato and Perez', kind: 'deciding_tiebreak', context: 'Singapore 2026 · Semifinal', stat: { label: 'Score', value: '6-0, 3-6, [10-6]' }, faces: [{ name: 'Qianhui Tang', jpegB64: null }, { name: 'Yifan Xu', jpegB64: 'AAAA' }] });
  assert.match(svg, /width="1200" height="630"/);
  assert.equal((svg.match(/data:image\/jpeg;base64,/g) || []).length, 1);
  assert.match(svg, />QT</, 'monogram for the player without a photo');
});
