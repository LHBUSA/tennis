// Schedule freshness guard (workers/shared/freshness.js). Incident 2026-10-03: Beijing ATP frozen at round 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOverdue, overdueByEdition, tournamentFreshness, overdueQuery, readOverdue, OVERDUE_H } from '../workers/shared/freshness.js';

const now = Date.parse('2026-10-03T18:00:00Z');
const h = (n) => new Date(now - n * 3600e3).toISOString();

test('overdue: a fixture 6+ h past its start with no result; a stuck live row; never a final or a fresh row', () => {
  assert.equal(isOverdue({ status: 'scheduled', scheduled_at: h(OVERDUE_H + 0.1) }, now), true);
  assert.equal(isOverdue({ status: 'scheduled', scheduled_at: h(OVERDUE_H - 0.5) }, now), false, 'a late start inside the window is not stale');
  assert.equal(isOverdue({ status: 'completed', scheduled_at: h(80) }, now), false);
  assert.equal(isOverdue({ status: 'in_progress', scheduled_at: h(7), updated_at: h(0.2) }, now), false, 'a long live match still being updated');
  assert.equal(isOverdue({ status: 'in_progress', scheduled_at: h(7), updated_at: h(3) }, now), true, 'live with no update for hours');
  assert.equal(isOverdue({ status: 'scheduled', scheduled_at: null }, now), false, 'no start time = no claim');
});

test('per edition: the Beijing shape (21 R1 rows stuck since 09-30) is STALE while a fresh edition stays CURRENT', () => {
  const rows = [
    ...Array.from({ length: 21 }, (_, i) => ({ match_id: `b${i}`, edition_id: 'beijing-atp', status: 'scheduled', scheduled_at: h(84 - i), updated_at: '2026-09-30T04:59:28Z' })),
    { match_id: 't1', edition_id: 'tokyo', status: 'scheduled', scheduled_at: h(1), updated_at: h(0.1) }
  ];
  const by = overdueByEdition(rows, now);
  assert.deepEqual([...by.keys()], ['beijing-atp']);
  assert.equal(by.get('beijing-atp').overdue, 21);
  assert.equal(by.get('beijing-atp').oldest_start, h(84));
  const f = tournamentFreshness('2026-09-30T04:59:28Z', by.get('beijing-atp'));
  assert.equal(f.state, 'STALE');
  assert.equal(f.overdue_unfinalized, 21);
  assert.equal(tournamentFreshness(h(0.1), by.get('tokyo')).state, 'CURRENT');
});

test('query: bounded by the scheduled_at index range and the unfinalized statuses; edition filter optional', async () => {
  const q = overdueQuery(now, ['e1']);
  assert.match(q, /status=in\.\(scheduled,in_progress\)/);
  assert.match(q, /scheduled_at=lt\.2026-10-03T12:00:00\.000Z/);
  assert.match(q, /scheduled_at=gte\.2026-09-03T18:00:00\.000Z/);
  assert.match(q, /edition_id=in\./);
  assert.doesNotMatch(overdueQuery(now), /edition_id=/);
  assert.doesNotMatch(q, /order=/, 'no ORDER BY + LIMIT over a filter its index cannot serve');
  let called = 0;
  assert.equal((await readOverdue({ select: async () => { called += 1; return []; } }, now, [])).size, 0);
  assert.equal(called, 0, 'no editions = no query');
});
