// ATP/WTA newsroom parity (brief 2026-09-29 sections 5-8): tour-aware ranking context, provenance wording, desks,
// ranking stories for every held list, and a tour-fair enrichment scheduler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect, claimFair } from '../workers/tennis-news/src/index.js';
import { compose } from '../workers/tennis-news/src/compose.js';
import { buildPlan } from '../workers/tennis-news/src/plan.js';
import { runGates } from '../workers/tennis-news/src/gates.js';
import { deskFor, rankingProvenance, pickFair, RANKING_LISTS } from '../workers/tennis-news/src/tour.js';
import { tourWeight } from '../workers/tennis-news/src/detect.js';

const uuid = (n) => `00000000-0000-5000-8000-${String(n).padStart(12, '0')}`;
const player = (n, name, last) => ({ pbe_player_id: uuid(n), slug: name.toLowerCase().replace(/ /g, '-'), full_name: name, last_name: last, nationality: 'XXX', tennis_player_media: [] });
const side = (s, p, seed = null) => ({ side: s, seed, entry_type: null, participant_key: `S:${p.pbe_player_id}`, tennis_participants: { tennis_participant_members: [{ slot: 1, tennis_players: p }] } });
const edition = (id, o) => ({ edition_id: id, year: 2026, name: o.name, level: o.level ?? null, surface: o.surface ?? null, indoor: false, start_date: '2026-09-24', end_date: '2026-10-05', city: o.city, country: null, source_family: o.source_family, competition_key: o.competition_key ?? null, tennis_tournaments: { slug: o.slug, name: o.name } });
const matchRow = (id, et, ed, A, B, fam) => ({
  match_id: id, event_type: et, round: 'M-S', format_key: 'BO3_TB7', status: 'completed', winner_side: 'A', end_reason: 'completed', score_text: '6-4 6-4', duration_s: 5400, started_at: '2026-09-28T08:00:00Z', edition_id: ed.edition_id, source_family: fam,
  tennis_tournament_editions: ed, tennis_sets: [{ set_no: 1, games_a: 6, games_b: 4, tb_a: null, tb_b: null, is_match_tiebreak: false }, { set_no: 2, games_a: 6, games_b: 4, tb_a: null, tb_b: null, is_match_tiebreak: false }],
  tennis_match_participants: [side('A', A), side('B', B)]
});

// men: Beijing (ESPN secondary, no level), women: Beijing (official WTA)
const atpEd = edition('e-atp', { name: 'China Open', slug: 'china-open-atp', city: 'Beijing', source_family: 'espn' });
const wtaEd = edition('e-wta', { name: 'China Open', slug: 'china-open', city: 'Beijing', source_family: 'wta', level: 'WTA 1000', surface: 'hard' });
const [m1, m2, m3, m4, w1, w2] = [player(1, 'Marco Moro', 'MORO'), player(2, 'Luca Lento', 'LENTO'), player(3, 'Otto Outer', 'OUTER'), player(4, 'Ivan Inner', 'INNER'), player(5, 'Ana Alta', 'ALTA'), player(6, 'Bea Bassa', 'BASSA')];
const MATCHES = [matchRow(uuid(101), 'MS', atpEd, m1, m2, 'espn'), matchRow(uuid(102), 'MS', atpEd, m3, m4, 'espn'), matchRow(uuid(103), 'WS', wtaEd, w1, w2, 'wta')];
const SNAPS = {
  atp_singles: [{ snapshot_id: 'atp-2', ranking_date: '2026-09-28', source_family: 'espn', row_count: 150 }, { snapshot_id: 'atp-1', ranking_date: '2026-09-21', source_family: 'espn', row_count: 150 }],
  wta_singles: [{ snapshot_id: 'wta-1', ranking_date: '2026-09-21', source_family: 'wta', row_count: 1500 }]
};
// m3 (winner) is outside the ESPN top 150; m2 No. 8 before; m4 No. 5
const RANKS = {
  'atp-1': [{ pbe_player_id: uuid(1), rank: 60 }, { pbe_player_id: uuid(2), rank: 8 }, { pbe_player_id: uuid(4), rank: 5 }, { pbe_player_id: uuid(9), rank: 12 }],
  'atp-2': [{ pbe_player_id: uuid(1), rank: 58 }, { pbe_player_id: uuid(2), rank: 8 }, { pbe_player_id: uuid(4), rank: 5 }, { pbe_player_id: uuid(9), rank: 9 }],
  'wta-1': [{ pbe_player_id: uuid(5), rank: 90 }, { pbe_player_id: uuid(6), rank: 7 }]
};

function fakeStore() {
  const lists = [];
  return {
    lists,
    async select(table, q) {
      if (table === 'tennis_matches') return MATCHES;
      if (table === 'tennis_ranking_snapshots') {
        const key = /list_key=eq\.(\w+)/.exec(q)[1];
        lists.push(key);
        const rows = SNAPS[key] || [];
        if (/limit=2/.test(q)) return rows.slice(0, 2);
        const lte = /ranking_date=lte\.([\d-]+)/.exec(q)?.[1];
        return rows.filter((r) => !lte || r.ranking_date <= lte).slice(0, 1);
      }
      if (table === 'tennis_rankings') {
        const snap = /snapshot_id=eq\.([\w-]+)/.exec(q)[1];
        const ids = /pbe_player_id=in\.\(([^)]*)\)/.exec(q);
        const want = ids ? new Set(ids[1].replace(/"/g, '').split(',')) : null;
        return (RANKS[snap] || []).filter((r) => !want || want.has(r.pbe_player_id));
      }
      return [];
    }
  };
}

test('C. detector: MS gets ATP ranking context, WS gets WTA context, MS never a WTA list; both create candidates', async () => {
  const store = fakeStore();
  const r = await detect({}, store, { now: new Date('2026-09-29T12:00:00Z'), dry: true });
  const byMatch = (id) => r.candidates.filter((c) => c.match_id === id && c.state !== 'duplicate');
  const ms = byMatch(uuid(101))[0];
  assert.equal(ms.kind, 'upset');
  assert.equal(ms.state, 'detected', `ATP upset is publishable (materiality ${ms.materiality})`);
  assert.equal(ms.facts.rank_list, 'atp_singles');
  assert.equal(ms.facts.rank_source_family, 'espn');
  assert.equal(ms.facts.rank_classification, 'secondary');
  assert.equal(ms.facts.tour, 'atp');
  assert.deepEqual([ms.facts.winner_rank, ms.facts.loser_rank], [60, 8]);
  // a winner missing from a top-150 extract is "outside the top 150", never "unranked"
  const out = byMatch(uuid(102))[0];
  assert.equal(out.kind, 'upset');
  assert.equal(out.facts.winner_unranked, false);
  assert.equal(out.facts.winner_outside_list, 150);
  const ws = byMatch(uuid(103))[0];
  assert.equal(ws.facts.rank_list, 'wta_singles');
  assert.equal(ws.facts.rank_classification, 'official');
  assert.equal(ws.facts.tour, 'wta');
  for (const c of r.candidates.filter((x) => x.facts?.event_type === 'MS')) assert.ok(!String(c.facts.rank_list || '').startsWith('wta'), 'MS never carries a WTA list');
  // ranking milestones read the ATP list too (ESPN-sourced: provenance travels with the event)
  const top10 = r.candidates.find((c) => c.kind === 'enters_top10');
  assert.ok(top10, 'ATP ranking milestone detected');
  assert.equal(top10.facts.list, 'atp_singles');
  assert.equal(top10.facts.tour, 'atp');
  assert.equal(top10.facts.list_source_family, 'espn');
  assert.ok(store.lists.includes('atp_singles') && store.lists.includes('wta_singles'));
  assert.deepEqual(RANKING_LISTS, { WS: 'wta_singles', MS: 'atp_singles', WD: 'wta_doubles', MD: null, XD: null }, 'doubles never borrow a singles list');
});

test('C. materiality: a level-less ESPN ATP edition weighs as the tour floor (same as a WTA 250), not as ITF', () => {
  assert.equal(tourWeight({ level: null, source_family: 'espn' }, 'MS'), tourWeight({ level: 'WTA 250' }, 'WS'));
  assert.equal(tourWeight({ level: 'Grand Slam' }, 'MS'), 30);
  assert.equal(tourWeight({ competition_key: 'atp_finals' }, 'MS'), 22);
  assert.equal(tourWeight({ level: null, source_family: 'itf' }, 'MS'), 5);
});

// ---- packets --------------------------------------------------------------------------------------------
const P = (id, name, last, rank, list, fam) => ({ id, slug: name.toLowerCase().replace(/ /g, '-'), name, last_name: last, nationality: 'ITA', photo: null, rank: rank ? { rank, list_date: '2026-09-21', list, source_family: fam } : null });
function matchPacket({ et = 'MS', level = null, slug = 'china-open-atp', fam = 'espn', list = 'atp_singles', listFam = 'espn', depth = 150, wr = 60, lr = 8, facts = {} } = {}) {
  const prov = list ? { ...rankingProvenance(list, listFam, depth), list_date: '2026-09-21' } : null;
  return {
    version: 'tennis-packet/1.0.0', built_at: '2026-09-29T12:00:00Z',
    event: { kind: 'upset', event_id: 'upset:0123456789ab', materiality: 71, facts: { winner_rank: wr, loser_rank: lr, list_date: '2026-09-21', ...facts }, occurred_at: '2026-09-28T08:00:00Z' },
    provenance: { data_brand: 'DATA · PropSports', data_url: 'https://propsports.proptechusa.ai', upstream: [{ family: fam, classification: fam === 'espn' ? 'secondary' : 'official', what: 'match result and set scores' }] },
    match: { id: uuid(101), event_type: et, round: 'M-S', round_label: 'semifinal', format: 'BO3_TB7', best_of: 3, status: 'completed', winner_side: 'A', score: '6-4 6-4', sets: [{ A: 6, B: 4, tb: null }, { A: 6, B: 4, tb: null }], duration_s: 5400, duration: { hours: 1, minutes: 30 }, started_at: '2026-09-28T08:00:00Z', date: '2026-09-28' },
    participants: { A: { key: 'S:a', seed: null, entry: null, players: [P(uuid(1), 'Marco Moro', 'MORO', wr, list, listFam)] }, B: { key: 'S:b', seed: 3, entry: null, players: [P(uuid(2), 'Luca Lento', 'LENTO', lr, list, listFam)] } },
    tournament: { edition_id: 'e', slug, name: 'China Open', year: 2026, level, surface: null, indoor: false, city: 'Beijing', country: null, start_date: '2026-09-24', end_date: '2026-10-05', source_family: fam },
    tour: et.startsWith('M') ? 'atp' : 'wta', match_source: { source_family: fam, classification: fam === 'espn' ? 'secondary' : 'official', name: fam.toUpperCase() },
    ranking_provenance: prov, rankings_note: prov?.note || null,
    canonical_signature: `upset:${uuid(101)}`
  };
}
const text = (a) => [a.headline, a.dek, ...a.sections.flatMap((s) => s.paragraphs)].join('\n');

test('D. match story: ATP secondary list is "the ATP singles list in the PropBetEdge archive", never official; gates pass', () => {
  const packet = matchPacket();
  const a = compose(packet);
  const t = text(a);
  assert.match(t, /ATP singles list in the PropBetEdge archive/);
  assert.doesNotMatch(t, /official[^.]{0,40}(rank|list)/i, 'secondary list never called official');
  assert.doesNotMatch(t, /official[^.]{0,40}(result|feed|score)/i, 'ESPN result never called official');
  assert.match(t, /secondary source \(ESPN\)/);
  const g = runGates(a, packet);
  assert.ok(g.pass, JSON.stringify(g.failures));
  // a writer that calls it official is HELD
  const bad = { ...a, sections: [{ id: 'why_it_mattered', heading: 'Why', paragraphs: ['Moro was No. 60 in the official ATP rankings at the start.'] }, ...a.sections] };
  assert.ok(runGates(bad, packet).failures.some((f) => f.gate === 'unsupported_official_claim'));
  // outside a top-N extract: said as such, never "not ranked"
  const out = compose(matchPacket({ wr: null, lr: 5, facts: { winner_rank: null, winner_outside_list: 150, winner_unranked: false } }));
  assert.match(text(out), /outside the top 150 of the ATP singles list in the PropBetEdge archive/);
  assert.doesNotMatch(text(out), /not ranked/);
});

test('D. match story: WTA official list keeps "official WTA singles list" wording', () => {
  const packet = matchPacket({ et: 'WS', slug: 'china-open', fam: 'wta', list: 'wta_singles', listFam: 'wta', depth: 1500, level: 'WTA 1000' });
  const a = compose(packet);
  assert.match(text(a), /official WTA singles list/);
  assert.ok(runGates(a, packet).pass);
});

function rankingPacket(list, fam, depth) {
  const facts = { list, list_date: '2026-09-28', previous_list_date: '2026-09-21', rank: 9, previous_rank: 12, tier: 10 };
  return {
    version: 'tennis-packet/1.0.0', built_at: '2026-09-29T12:00:00Z',
    event: { kind: 'enters_top10', event_id: 'enters_top10:0123456789ab', materiality: 75, facts, occurred_at: '2026-09-28' },
    provenance: { data_brand: 'DATA · PropSports', data_url: 'https://propsports.proptechusa.ai', upstream: [{ family: fam, classification: fam === 'wta' ? 'official' : 'secondary', what: `${list} lists dated 2026-09-21 and 2026-09-28` }] },
    player: { id: uuid(9), slug: 'nino-nove', name: 'Nino Nove', last_name: 'NOVE', nationality: 'ITA', photo: null },
    ranking_history: [{ date: '2026-09-14', rank: 14 }, { date: '2026-09-21', rank: 12 }, { date: '2026-09-28', rank: 9 }],
    ranking_provenance: rankingProvenance(list, fam, depth), tour: list.split('_')[0],
    canonical_signature: `enters_top10:${uuid(9)}:2026-09-28`
  };
}

test('D. ranking stories: tour labels and provenance come from the list; ATP (ESPN) never called official', () => {
  const atp = rankingPacket('atp_singles', 'espn', 150);
  const a = compose(atp);
  assert.match(a.headline, /ATP singles list/);
  assert.doesNotMatch(text(a), /WTA/);
  assert.doesNotMatch(text(a), /official[^.]{0,40}(rank|list)/i);
  assert.match(text(a), /ATP singles list in the PropBetEdge archive/);
  assert.match(text(a), /secondary source \(ESPN\)/);
  assert.ok(runGates(a, atp).pass, JSON.stringify(runGates(a, atp).failures));
  const chart = buildPlan(atp, a).charts?.find?.((c) => c.id === 'ranking_trajectory') || null;
  if (chart) assert.doesNotMatch(`${chart.title} ${chart.source}`, /official/i);

  const wta = rankingPacket('wta_singles', 'wta', 1500);
  const w = compose(wta);
  assert.match(w.headline, /WTA singles rankings/);
  assert.match(text(w), /official WTA singles rankings/);
  assert.ok(runGates(w, wta).pass);

  const wd = compose(rankingPacket('wta_doubles', 'wta', 1200));
  assert.match(wd.headline, /WTA doubles/);
  // a WTA list that came from ESPN (history backfill) is secondary too: provenance follows the snapshot
  const wEspn = compose(rankingPacket('wta_singles', 'espn', 150));
  assert.doesNotMatch(text(wEspn), /official[^.]{0,40}(rank|list)/i);
});

test('E. desks: ATP non-Slam -> atp, WTA non-Slam -> wta, any Slam event -> grand-slams, doubles -> doubles', () => {
  assert.equal(deskFor('MS', { level: null, slug: 'china-open-atp' }), 'atp');
  assert.equal(deskFor('WS', { level: 'WTA 1000', slug: 'china-open' }), 'wta');
  for (const et of ['MS', 'WS', 'MD', 'WD', 'XD']) {
    assert.equal(deskFor(et, { level: 'Grand Slam', slug: 'us-open' }), 'grand-slams');
    // a Slam edition that came from the WTA calendar or ESPN is still a Slam (slug decides, not the source)
    assert.equal(deskFor(et, { level: null, slug: 'wimbledon' }), 'grand-slams');
  }
  for (const et of ['MD', 'WD', 'XD']) assert.equal(deskFor(et, { level: 'WTA 500', slug: 'x' }), 'doubles');
  assert.equal(compose(matchPacket()).desk, 'atp', 'an ATP 500 men\'s match is not a Grand Slam story');
  assert.equal(compose(matchPacket({ level: 'Grand Slam', slug: 'us-open' })).desk, 'grand-slams');
  assert.equal(compose(matchPacket({ et: 'WS', slug: 'china-open', fam: 'wta', list: 'wta_singles', listFam: 'wta', level: 'WTA 1000' })).desk, 'wta');
});

// ---- scheduler fairness ---------------------------------------------------------------------------------
const ev = (id, tour, materiality) => ({ event_id: id, state: 'detected', attempts: 0, materiality, detected_at: '2026-09-29T10:00:00Z', match_id: null, evidence: { facts: { tour } } });

test('F. pickFair: 3 WTA + 1 ATP with limit 3 -> ATP takes slot 2; no quota when a tour has nothing', () => {
  const q = [ev('w1', 'wta', 90), ev('w2', 'wta', 85), ev('w3', 'wta', 80), ev('a1', 'atp', 62)];
  const tour = (e) => e.evidence.facts.tour;
  assert.deepEqual(pickFair(q, 3, tour).map((e) => e.event_id), ['w1', 'a1', 'w2']);
  assert.deepEqual(pickFair(q.filter((e) => e.event_id !== 'a1'), 3, tour).map((e) => e.event_id), ['w1', 'w2', 'w3'], 'no ATP candidate -> nothing manufactured');
  assert.deepEqual(pickFair([ev('a1', 'atp', 95), ev('a2', 'atp', 90), ev('w1', 'wta', 61)], 3, tour).map((e) => e.event_id), ['a1', 'w1', 'a2'], 'symmetric for WTA');
});

test('F. claimFair: a constant WTA stream never starves a legitimate ATP event (compare-and-set claim)', async () => {
  const rows = [ev('w1', 'wta', 90), ev('w2', 'wta', 85), ev('w3', 'wta', 80), ev('a1', 'atp', 62)];
  const patched = [];
  const store = {
    async select(table, q) {
      assert.equal(table, 'tennis_news_events');
      assert.match(q, /order=materiality\.desc\.nullslast,detected_at\.asc/);
      assert.match(q, /or=\(state\.eq\.detected,and\(state\.eq\.enriching,lease_expires_at\.lt\./);
      return rows.filter((r) => r.state === 'detected');
    },
    async req(method, path, { body }) {
      assert.equal(method, 'PATCH');
      const id = decodeURIComponent(/event_id=eq\.([^&]+)/.exec(path)[1]);
      assert.match(path, /attempts=eq\.0/);
      const r = rows.find((x) => x.event_id === id);
      if (r.state !== 'detected') return [];
      Object.assign(r, body);
      patched.push(id);
      return [r];
    }
  };
  const claimed = await claimFair(store, { limit: 3, now: new Date('2026-09-29T12:00:00Z') });
  assert.deepEqual(claimed.map((c) => c.event_id), ['w1', 'a1', 'w2']);
  assert.ok(claimed.every((c) => c.state === 'enriching' && c.lease_token && c.attempts === 1));
  // next cycle: three NEW higher-materiality WTA events arrive; the ATP event was already enriched
  assert.ok(patched.includes('a1'));
});
