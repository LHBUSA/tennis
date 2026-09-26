// Production photo contract: an approved headshot must reach every player-bearing endpoint.
//   node scripts/qa/photo-contract.mjs
// Walks /v1/live, /v1/today, /v1/schedule, /v1/rankings, /v1/dna/leaders, /v1/search, /v1/players?q=,
// /v1/h2h, /v1/pbecast/:id and /v1/matches/:id for live matches, collects every player object, and
// compares `photo` against tennis_player_media approval in the database. Output:
// docs/evidence/photo-contract-latest.json. FAIL if any approved player is served without a photo.
import fs from 'node:fs';
import { storeFromEnv, inList } from '../../workers/shared/store/postgrest.js';

const API = process.env.TENNIS_API || 'https://tennis-api.propbetedge.ai';
const envText = fs.readFileSync('D:/Workers/secrets/ufc-propbetedge.env', 'utf8').replace(/^\uFEFF/, '');
const g = (k) => (new RegExp(`^${k}=(.*)$`, 'm').exec(envText) || [])[1]?.trim().replace(/^"|"$/g, '');
const store = storeFromEnv({ TENNIS_MODEL_SUPABASE_URL: g('SUPABASE_URL'), TENNIS_MODEL_SUPABASE_SERVICE_ROLE_KEY: g('SUPABASE_SERVICE_ROLE_KEY') });
const get = async (p) => (await (await fetch(`${API}${p}`, { headers: { 'cache-control': 'no-cache' } })).json()).data;

const seen = [];
const walk = (v, where) => {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { v.forEach((x) => walk(x, where)); return; }
  if (typeof v.slug === 'string' && typeof v.name === 'string' && 'photo' in v) seen.push({ where, id: v.id || null, slug: v.slug, name: v.name, has: !!v.photo?.square });
  for (const x of Object.values(v)) walk(x, where);
};

const live = (await get('/v1/live')) || [];
const endpoints = ['/v1/live', '/v1/today', '/v1/schedule?view=today', '/v1/rankings?tour=wta&type=singles&limit=200', '/v1/dna/leaders?metric=service_points_won&limit=50', '/v1/search?q=an', '/v1/players?q=ova'];
for (const m of live) endpoints.push(`/v1/pbecast/${m.id}`, `/v1/matches/${m.id}`);
const top = (await get('/v1/rankings?tour=wta&type=singles&limit=2'))?.rows || [];
if (top.length === 2) endpoints.push(`/v1/h2h/${top[0].player.slug}/${top[1].player.slug}`, `/v1/players/${top[0].player.slug}/dna`);
for (const e of endpoints) { try { walk(await get(e), e); } catch (err) { seen.push({ where: e, error: String(err.message) }); } }

const slugs = [...new Set(seen.filter((s) => s.slug).map((s) => s.slug))];
const approved = new Set();
for (let i = 0; i < slugs.length; i += 100) {
  const rows = await store.select('tennis_players', `select=slug,tennis_player_media(approval,derivatives)&slug=${inList(slugs.slice(i, i + 100))}`);
  for (const r of rows) if ((r.tennis_player_media || []).some((m) => m.approval === 'approved' && m.derivatives?.square?.url)) approved.add(r.slug);
}
const violations = seen.filter((s) => s.slug && approved.has(s.slug) && !s.has);
const wrong = seen.filter((s) => s.slug && !approved.has(s.slug) && s.has);
const liveIds = new Set(live.flatMap((m) => ['A', 'B'].flatMap((x) => m.sides?.[x]?.players || [])).map((p) => p.slug));
const out = {
  checked_at: new Date().toISOString(), endpoints, player_objects: seen.length, distinct_players: slugs.length,
  approved_but_monogram: violations.length, photo_without_approval: wrong.length,
  live_players: [...liveIds].map((s) => ({ slug: s, approved: approved.has(s) })),
  violations: violations.slice(0, 50), result: violations.length === 0 && wrong.length === 0 ? 'PASS' : 'FAIL'
};
fs.writeFileSync('docs/evidence/photo-contract-latest.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ result: out.result, player_objects: out.player_objects, distinct: out.distinct_players, approved_but_monogram: out.approved_but_monogram, photo_without_approval: out.photo_without_approval, live: out.live_players }, null, 1));
if (out.result !== 'PASS') process.exitCode = 1;
