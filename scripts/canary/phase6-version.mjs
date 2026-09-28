#!/usr/bin/env node
// Version canary for tennis-api (Phase 6): the uploaded, not-yet-deployed version (its preview URL) against production.
//   node scripts/canary/phase6-version.mjs <candidateBase> [productionBase]      -> docs/evidence/phase6-version-canary.json
// 1. every existing route answers the SAME data as production (meta timestamps removed; the documented additive fields
//    removed from the candidate first) — a regression gate, not a smoke test;
// 2. new routes answer and obey the publication rules (no probability for an unvalidated tour / short history /
//    non-upcoming fixture; H2H flagged not a model input; watch lists withheld when not validated or not built).
import fs from 'node:fs';

const CAND = (process.argv[2] || '').replace(/\/+$/, '');
const PROD = (process.argv[3] || 'https://tennis-api.propbetedge.ai').replace(/\/+$/, '');
if (!CAND) { console.error('usage: phase6-version.mjs <candidateBase> [productionBase]'); process.exit(2); }
const checks = [];
const add = (name, pass, detail = {}) => { checks.push({ name, result: pass ? 'PASS' : 'FAIL', ...detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail).slice(0, 200)}`); };
const get = async (base, p) => { const r = await fetch(`${base}${p}${p.includes('?') ? '&' : '?'}canary=${Date.now()}`, { headers: { accept: 'application/json' } }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };
const ADDITIVE = new Set(['profile', 'profile_definitions']);
const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['fetched_at', 'age_s', 'freshness', 'source_updated_at'].includes(k) && !ADDITIVE.has(k)).map(([k, x]) => [k, strip(x)])) : v);

const h = await get(CAND, '/health');
add('health: candidate is tennis-api 0.6.0', h.status === 200 && h.j?.version === '0.6.0', { version: h.j?.version });
add('health: new routes advertised', ['/v1/matchups', '/v1/matchups/:id', '/v1/players-to-watch'].every((r) => (h.j?.routes || h.j?.extra?.routes || []).includes(r)));

const EXISTING = ['/v1/today', '/v1/live', '/v1/tournaments', '/v1/rankings?tour=wta&type=singles&limit=50', '/v1/rankings?tour=atp&type=singles&limit=50', '/v1/players?q=sinner', '/v1/men', '/v1/slams', '/v1/schedule', '/v1/search?q=alcaraz',
  '/v1/players/jannik-sinner', '/v1/players/jannik-sinner/dna', '/v1/players/carlos-alcaraz/dna', '/v1/players/iga-swiatek/dna', '/v1/players/aryna-sabalenka/dna', '/v1/players/aryna-sabalenka/profile',
  '/v1/h2h/jannik-sinner/carlos-alcaraz', '/v1/coverage', '/v1/credits', '/v1/sources'];
for (const p of EXISTING) {
  const [a, b] = await Promise.all([get(PROD, p), get(CAND, p)]);
  const same = a.status === b.status && JSON.stringify(strip(a.j)) === JSON.stringify(strip(b.j));
  add(`unchanged ${p}`, same, same ? { status: b.status } : { prod: a.status, cand: b.status, prod_len: JSON.stringify(strip(a.j) || '').length, cand_len: JSON.stringify(strip(b.j) || '').length });
}
// paged leader routes: production paged without a stable order (counts drifted per request, fixed in 0.6.0), so the
// candidate is checked for determinism and against the database count, not against production's drifting answer
const expect = { 'pbe_rating&tour=wta': Number(process.env.WTA_ESTABLISHED || 0) };
for (const q of ['metric=pbe_rating&tour=atp', 'metric=pbe_rating&tour=wta', 'metric=hold_rate&tour=wta', 'metric=match_win_rate&tour=atp']) {
  const r = await Promise.all([1, 2, 3].map(() => get(CAND, `/v1/dna/leaders?${q}`)));
  const keys = r.map((x) => JSON.stringify([x.j?.data?.qualified, (x.j?.data?.rows || []).map((y) => [y.player?.slug, y.value])]));
  const want = expect[q.replace('metric=', '')];
  add(`leaders ${q}: deterministic across 3 reads${want ? ' and equal to the database count' : ''}`, keys.every((k) => k === keys[0]) && (!want || r[0].j?.data?.qualified === want), { qualified: r.map((x) => x.j?.data?.qualified), db: want || null });
}
const nf = await get(CAND, '/v1/nope');
add('unknown route is 404', nf.status === 404);

// new: matchups list
const list = await get(CAND, '/v1/matchups');
const ms = list.j?.data?.matchups || [];
add('matchups list answers', list.status === 200 && Array.isArray(ms), { matchups: ms.length, tours: [...new Set(ms.map((x) => x.tour))] });
const now = Date.now();
add('matchups: every listed match is upcoming (start within the last 6 h or later)', ms.every((x) => Date.parse(x.match.scheduled_at) >= now - 6 * 3600e3 - 60e3));
add('matchups: no duplicate match in the list', new Set(ms.map((x) => x.match.id)).size === ms.length);
add('matchups: probability only when status published', ms.every((x) => (x.model.status === 'published') === !!x.model.probability));
add('matchups: probabilities are complementary', ms.filter((x) => x.model.probability).every((x) => Math.abs(x.model.probability.A + x.model.probability.B - 1) <= 0.0011));
// detail on listed matches (up to 6) and on a completed match
for (const x of ms.slice(0, 6)) {
  const d = await get(CAND, `/v1/matchups/${x.match.id}`);
  const m = d.j?.data?.model;
  const r = m?.ratings;
  const shortHist = r && (r.A.rated_matches < 10 || r.B.rated_matches < 10);
  add(`matchup ${x.match.id.slice(0, 8)}: rules`, d.status === 200 && (!shortHist || m.probability === null) && d.j.data.h2h.model_input === false && Array.isArray(d.j.data.why) && d.j.data.why.length > 0,
    { status: m?.status, p: m?.probability?.A ?? null, basis: m?.basis ?? null, conf: m?.confidence?.level ?? null, h2h: d.j?.data?.h2h?.total, serve_return: d.j?.data?.context?.serve_return?.available });
}
const recent = (await get(PROD, '/v1/players/jannik-sinner/dna')).j?.data?.match_dna?.recent?.[0];
if (recent) {
  const d = await get(CAND, `/v1/matchups/${recent.match_id}`);
  add('matchup on a completed match: probability withheld (not upcoming)', d.status === 200 && d.j?.data?.model?.probability === null && d.j?.data?.fixture === 'not_upcoming', { status: d.j?.data?.model?.status });
}
const watch = await get(CAND, '/v1/players-to-watch');
const wt = watch.j?.data?.tours || {};
add('players-to-watch: answers (UNAVAILABLE until the first Phase 6 build) and never lists an unvalidated tour', watch.status === 200 && (watch.j?.data == null || Object.values(wt).every((t) => t && (t.rating_published || t.status === 'not_validated'))), { freshness: watch.j?.meta?.freshness, tours: Object.keys(wt) });

const out = { run_at: new Date().toISOString(), candidate: CAND, production: PROD, pass: checks.filter((c) => c.result === 'PASS').length, fail: checks.filter((c) => c.result === 'FAIL').length, checks };
fs.writeFileSync('docs/evidence/phase6-version-canary.json', `${JSON.stringify(out, null, 1)}\n`);
console.log(`\n${out.pass} PASS / ${out.fail} FAIL`);
if (out.fail) process.exitCode = 1;
