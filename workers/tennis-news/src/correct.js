// Editorial correction (2026-09-29): pre-match PBE Rating values and the rating-model expectation must have been
// VALIDATED AT THE TIME — the Match DNA v2 snapshot row has to have been built before the event started. Snapshots dated
// before a match but computed later by a backfill build carry point-in-time descriptive metrics (kept), but their
// publication status is the later build's (so the rating, surface rating, trajectory and expectation are withheld).
// Prose is untouched (it never states ratings or model probabilities; the gates ban them); only the code-rendered
// at-a-glance strip and PBE Intelligence module are rebuilt from the corrected frozen packet. Same article id, slug,
// published_at and first_published_at; revised_at + a revision that keeps the prior packet.

import { builtBefore } from './packet.js';
import { glanceCells, intelligence } from './plan.js';

const REASON = 'correction: PBE Rating / pre-match model expectation withheld — the rating snapshot was built after the event started, so its validation status was not the one in force at the time';

async function builtAt(store, pid, asOf, surface = 'all') {
  const r = (await store.select('tennis_dna_snapshots', `select=built_at&pbe_player_id=eq.${pid}&surface=eq.${surface}&definition_version=eq.2&as_of=eq.${asOf}`))[0];
  return r || null;
}

/** The corrected packet (a new object) and whether anything changed. Pure except for the built_at reads. */
export async function correctPacket(store, packet, startIso) {
  const p = structuredClone(packet);
  const changes = [];
  for (const [pid, md] of Object.entries(p.match_dna || {})) {
    const row = await builtAt(store, pid, md.as_of);
    if (!builtBefore(row, startIso) && (md.rating || md.rating_trajectory)) {
      md.rating = null;
      delete md.rating_trajectory;
      md.rating_validated_at_the_time = false;
      md.rating_note = 'PBE Rating withheld: the snapshot was built after the event started, so its validation status is not the one in force at the time';
      changes.push(`match_dna.${pid}.rating`);
    }
    if (md.surface?.rating) {
      const srow = await builtAt(store, pid, md.surface.as_of, md.surface.surface);
      if (!builtBefore(srow, startIso)) { md.surface.rating = null; changes.push(`match_dna.${pid}.surface.rating`); }
    }
  }
  if (p.expectation) {
    const a = await builtAt(store, p.expectation.winner_id, p.expectation.as_of);
    const b = await builtAt(store, p.expectation.loser_id, p.expectation.as_of);
    if (!builtBefore(a, startIso) || !builtBefore(b, startIso)) { delete p.expectation; changes.push('expectation'); }
  }
  if (changes.length) p.corrections = [...(p.corrections || []), { rule: 'rating_validated_at_the_time', fields: changes }];
  return { packet: p, changes };
}

/** Apply the correction to every published article (dry by default). */
export async function correctPreMatchRatings(store, { write = false, now = new Date().toISOString() } = {}) {
  const arts = await store.select('tennis_articles', 'select=article_id,slug,match_id,story_class,content_plan,revisions,tennis_article_evidence(packet,frozen_at)&status=eq.published&order=published_at.asc&limit=500');
  const out = [];
  for (const a of arts) {
    const ev = Array.isArray(a.tennis_article_evidence) ? a.tennis_article_evidence[0] : a.tennis_article_evidence;
    const packet = ev?.packet;
    if (!packet || (!packet.match_dna && !packet.expectation)) continue;
    let startIso = null;
    if (a.match_id) {
      const m = (await store.select('tennis_matches', `select=started_at,scheduled_at,tennis_tournament_editions(start_date)&match_id=eq.${a.match_id}`))[0];
      startIso = m?.started_at || m?.scheduled_at || (m?.tennis_tournament_editions?.start_date ? `${m.tennis_tournament_editions.start_date}T00:00:00Z` : null);
    } else if (packet.event?.facts?.list_date) startIso = `${packet.event.facts.list_date}T00:00:00Z`;
    if (!startIso) { out.push({ slug: a.slug, skipped: 'no event start time' }); continue; }
    const { packet: fixed, changes } = await correctPacket(store, packet, startIso);
    if (!changes.length) { out.push({ slug: a.slug, changes: [] }); continue; }
    const cp = a.content_plan || {};
    const plan = { ...cp, glance: glanceCells(fixed), intelligence: intelligence(fixed) };
    out.push({ slug: a.slug, event_start: startIso, changes, glance_before: (cp.glance || []).map((g) => g.label), glance_after: plan.glance.map((g) => g.label), intelligence_after: plan.intelligence ? plan.intelligence.takeaway : null });
    if (!write) continue;
    const revision = { at: now, from_class: a.story_class || null, to_class: a.story_class || null, reason: REASON, fields: changes, prior_frozen_at: ev.frozen_at || null, prior_packet: packet };
    await store.req('PATCH', `tennis_articles?article_id=eq.${a.article_id}`, { body: { content_plan: plan, updated_at: now, revised_at: now, revisions: [...(a.revisions || []), revision] }, prefer: 'return=minimal' });
    await store.req('PATCH', `tennis_article_evidence?article_id=eq.${a.article_id}`, { body: { packet: fixed }, prefer: 'return=minimal' });
  }
  return { write, articles: out.length, corrected: out.filter((x) => x.changes?.length).length, rows: out };
}
