// PBEcast Tennis DNA parity (2026-09-29): an ATP player with published Match DNA v2 but no / below-gate technical DNA
// v1 must still get real Tennis DNA in PBEcast. Match DNA is the primary comparison; technical DNA is an additional
// module whose gates are unchanged; ATP and WTA populations are never pooled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbecast, technicalStatus } from '../workers/tennis-api/src/v2.js';
import { __test as pbc } from '../src/pages/pbecast.js';

const ALC = '11111111-1111-4111-8111-111111111111';
const SIN = '22222222-2222-4222-8222-222222222222';
const MID = '33333333-3333-4333-8333-333333333333';
const player = (id, slug, name) => ({ pbe_player_id: id, slug, full_name: name, last_name: name.split(' ').pop(), nationality: 'ESP', gender: 'M', tennis_player_media: [] });
const matchRow = {
  match_id: MID, event_type: 'MS', round: 'F', format_key: 'BO3_TB7', status: 'completed', winner_side: 'A', end_reason: 'completed', score_text: '6-4 6-4', duration_s: null, scheduled_at: null, court: null, schedule_note: null, live_state: null, stats_status: 'unavailable', source_family: 'espn', source_updated_at: '2026-09-28T10:00:00Z', updated_at: '2026-09-28T10:00:00Z', edition_id: 'e',
  tennis_tournament_editions: { year: 2026, name: 'China Open', level: null, surface: 'hard', indoor: false, start_date: '2026-09-24', end_date: '2026-10-05', tennis_tournaments: { slug: 'china-open-atp', name: 'China Open' } },
  tennis_sets: [],
  tennis_match_participants: [
    { side: 'A', participant_key: `S:${ALC}`, tennis_participants: { kind: 'single', tennis_participant_members: [{ slot: 1, tennis_players: player(ALC, 'carlos-alcaraz', 'Carlos Alcaraz') }] } },
    { side: 'B', participant_key: `S:${SIN}`, tennis_participants: { kind: 'single', tennis_participant_members: [{ slot: 1, tennis_players: player(SIN, 'jannik-sinner', 'Jannik Sinner') }] } }
  ]
};
const pub = (value, percentile, n = 300) => ({ value, confidence: 'high', comparable: true, comparative_published: true, percentile, sample_matches: n, numerator: Math.round(value * n), denominator: n, population_qualified: 420 });
const v2 = (rating) => ({
  as_of: '2026-09-29', provenance: { sample: { matches: 358, first_day: '2020-02-17', last_day: '2026-09-09' } },
  metrics: {
    _tour: 'ATP', _rating: rating, _form: { last10: { W: 8, L: 2 }, current_streak: { result: 'W', length: 3 }, career: { W: 287, L: 71 } }, _surface_record: { hard: { W: 150, L: 40 } },
    match_win_rate: pub(0.8, 97), set_win_rate: pub(0.74, 96), deciding_set_win_rate: pub(0.7, 90, 60), top10_win_rate: pub(0.58, 94, 50), straight_sets_win_rate: { value: 0.6, confidence: 'low', comparable: true, sample_matches: 4 }
  }
});
const hard = { as_of: '2026-09-29', surface: 'hard', provenance: {}, metrics: { _form: { career: { W: 150, L: 40 } }, match_win_rate: pub(0.79, 95, 190) } };
// technical v1: Sinner has a stored snapshot below the ATP gate (17 of 30 qualified); Alcaraz has none at all
const v1 = { as_of: '2026-09-29', surface: 'all', definition_version: 1, provenance: {}, metrics: { service_points_won: { metric_key: 'service_points_won', value: 0.69, confidence: 'high', sample_matches: 20, numerator: 690, denominator: 1000 } } };
const peers = Array.from({ length: 17 }, (_, i) => ({ pbe_player_id: `p${i}`, tennis_players: { gender: 'M' }, metrics: { service_points_won: { value: 0.6 + i * 0.003, confidence: 'medium' } } }));

function store({ rating = { value: 2210, published: true, provisional: false, established: true, rated_matches: 340, percentile: 99 } } = {}) {
  return {
    requests: [],
    async select(table, q) {
      this.requests.push(`${table}?${q}`);
      if (table === 'tennis_matches') return /match_id=eq\./.test(q) ? [matchRow] : [];
      if (table === 'tennis_players') return [{ gender: 'M' }];
      if (table !== 'tennis_dna_snapshots') return [];
      const pid = /pbe_player_id=eq\.([0-9a-f-]{36})/.exec(q)?.[1];
      if (/definition_version=eq\.2/.test(q)) {
        if (/surface=in\.\(hard,clay,grass\)/.test(q)) return [hard];
        return pid ? [v2(rating)] : [];
      }
      // definition_version 1 (technical)
      if (pid) return pid === SIN ? [v1] : [];
      if (/order=as_of\.desc&limit=1/.test(q)) return [{ as_of: '2026-09-29' }];
      if (/offset=0/.test(q)) return [{ ...v1, pbe_player_id: SIN, tennis_players: { gender: 'M' } }, ...peers];
      return [];
    }
  };
}

test('B: ATP singles with Match DNA v2 published and technical v1 absent / below gate -> real Tennis DNA in PBEcast', async () => {
  const s = store();
  const r = await pbecast(s, MID);
  const dna = r.data.dna;
  assert.equal(dna.contract, 'pbecast-dna/2');
  for (const side of ['A', 'B']) {
    const md = dna.match_dna[side];
    assert.equal(md.definition_version, 2);
    assert.equal(md.tour, 'ATP');
    assert.equal(md.metrics.find((m) => m.key === 'match_win_rate').percentile, 97);
    assert.equal(md.metrics.find((m) => m.key === 'straight_sets_win_rate').percentile, null, 'low-confidence metric: no percentile');
    assert.equal(md.rating.status, 'published');
    assert.equal(md.rating.value, 2210);
    assert.equal(md.surface.surface, 'hard');
  }
  assert.equal(dna.match_dna.same_tour, true);
  // technical: Alcaraz none, Sinner stored below the 30-player gate; gates unchanged (no comparative publication)
  assert.equal(dna.technical_dna.A.status, 'unavailable');
  assert.equal(dna.technical_dna.B.status, 'building');
  assert.equal(dna.technical_dna.B.data.comparative.published, false);
  assert.match(dna.technical_dna.B.message, /Technical serve\/return DNA is still building/);
  // older clients keep working
  assert.equal(dna.A.all, null);
  assert.ok(dna.B.all.dimensions.length);
  // never pooled: every v2 read is by player id, every v1 population read is filtered to the player's gender
  for (const q of s.requests.filter((x) => x.startsWith('tennis_dna_snapshots?') && /tennis_players!inner/.test(x))) assert.match(q, /tennis_players\.gender=eq\.M/);

  const out = String(pbc.dnaCompare(r.data, r.data.match));
  assert.match(out, /Match DNA/);
  assert.match(out, /80\.0%/);
  assert.match(out, /97th/);
  assert.match(out, /PBE Rating/);
  assert.match(out, /Technical serve\/return DNA is still building/);
  assert.doesNotMatch(out, /No stored Tennis DNA|No Tennis DNA/);
});

test('a tour whose PBE Rating has not passed its backtest: the value is withheld in PBEcast', async () => {
  const r = await pbecast(store({ rating: { value: 1990, published: false, provisional: false, established: true, rated_matches: 120 } }), MID);
  const md = r.data.dna.match_dna.A;
  assert.equal(md.rating.status, 'not_validated');
  assert.equal(md.rating.value, undefined);
  const out = String(pbc.dnaCompare(r.data, r.data.match));
  assert.doesNotMatch(out, /1990/);
});

test('technicalStatus: published / building / unavailable', () => {
  assert.equal(technicalStatus(null).status, 'unavailable');
  assert.equal(technicalStatus({ tour: 'WTA', comparative: { published: true } }).status, 'published');
  assert.equal(technicalStatus({ tour: 'ATP', comparative: { published: false, qualified: 17, threshold: 30 } }).status, 'building');
});

test('older API without match_dna still renders the technical table (no regression)', () => {
  const data = { dna: { A: { all: { as_of: '2026-09-29', tour: 'WTA', comparative: { published: true }, dimensions: [{ label: 'Serve', value: 0.6, percentile: 70 }] } }, B: { all: null } } };
  const out = String(pbc.dnaCompare(data, { sides: {} }));
  assert.match(out, /Serve/);
  assert.match(out, /70th/);
});

test('player profile: a long career is read in id groups (one 900-uuid in() list was a postgrest 400)', async () => {
  const { v2Route } = await import('../workers/tennis-api/src/v2.js');
  const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const reqs = [];
  const s = {
    async select(table, q) {
      reqs.push({ table, q });
      if (table === 'tennis_players') return [player(ALC, 'novak-djokovic', 'Novak Djokovic')];
      if (table === 'tennis_match_participants') return ids.map((id) => ({ match_id: id, side: 'A' }));
      if (table === 'tennis_matches') { const inl = /match_id=in\.\(([^)]*)\)/.exec(decodeURIComponent(q))[1].split(',').map((x) => x.replace(/"/g, '')); return inl.map((id) => ({ match_id: id, status: 'completed', winner_side: 'A', surface: 'hard', source_updated_at: `2026-01-01T00:00:${String(Number(id.slice(-3)) % 60).padStart(2, '0')}Z`, tennis_tournament_editions: null, tennis_match_participants: [] })); }
      return [];
    }
  };
  const r = await v2Route('/v1/players/novak-djokovic/profile', new URL('https://x/v1/players/novak-djokovic/profile'), s);
  const mq = reqs.filter((x) => x.table === 'tennis_matches');
  assert.equal(mq.length, 3);
  for (const x of mq) assert.ok(/match_id=in\.\(([^)]*)\)/.exec(x.q)[1].split(',').length <= 150);
  assert.equal(r.data.surface_record.hard.W, 400);
  assert.equal(r.data.form.length, 10);
});
