// Availability-aware mixing — PURE (tests/one-product.test.js).
// A newest-first list cut to `n` must not hide a whole tour because the other one published more recently.
// Rule: take the newest n; for every group (e.g. 'men' / 'women', 'atp' / 'wta') that has an item in the
// candidate list but none in the cut, swap in that group's newest item for the oldest item of a group that
// holds more than one slot. Nothing is invented, duplicated or held back, and order stays newest-first.
// Items whose key is null are neutral (never forced in, never displaced first).

export function ensureEach(list, n, keyOf) {
  const all = (list || []).map((item, i) => ({ item, i, k: keyOf(item) ?? null }));
  const head = all.slice(0, n);
  const want = [...new Set(all.map((x) => x.k).filter((k) => k != null))];
  for (const k of want) {
    if (head.some((x) => x.k === k)) continue;
    const add = all.find((x) => x.k === k);
    const count = (key) => head.filter((x) => x.k === key).length;
    // displace the oldest item of the most-represented keyed group (never a group's only slot, never a neutral)
    let victim = -1;
    for (let j = head.length - 1; j >= 0; j -= 1) if (head[j].k != null && count(head[j].k) > 1) { victim = j; break; }
    if (victim < 0) continue;
    head.splice(victim, 1, add);
  }
  return head.sort((a, b) => a.i - b.i).map((x) => x.item);
}

/** Men / women / mixed from a canonical event type (MS/MD -> men, WS/WD -> women, XD -> mixed). */
export const eventGender = (m) => ({ M: 'men', W: 'women', X: 'mixed' })[String(m?.event_type || '')[0]] || null;

/**
 * Tour of a news card for mixing: only desks that ARE a tour count (Slam, doubles and ranking desks are neutral),
 * and only a RECENT story (published within `maxAgeDays`) — an old story is never pulled forward for symmetry.
 */
export const storyTour = (a, now = Date.now(), maxAgeDays = 7) => {
  if (a?.desk !== 'atp' && a?.desk !== 'wta') return null;
  const t = Date.parse(a.published_at || '');
  return Number.isFinite(t) && now - t <= maxAgeDays * 86400e3 ? a.desk : null;
};
