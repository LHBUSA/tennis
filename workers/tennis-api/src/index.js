// tennis-api — the public read API behind tennis.propbetedge.ai. docs/API.md.
//
// Reads come from the canonical store (Supabase) and live state (KV) once those are wired. Until a
// route's backing data is in production it answers NOT_CONFIGURED with data: null — never a sample,
// never a placeholder. /v1/sources is real today: it serves the audited source registry and the most
// recent canary evidence committed to Git.

import { envelope, notConfigured, json } from '../../shared/envelope.js';
import { health } from '../../shared/health.js';
import registry from '../../../data/source-registry/sources.json' with { type: 'json' };
import canary from '../../../docs/evidence/source-canary-latest.json' with { type: 'json' };

export const VERSION = '0.1.0';

const DATA_ROUTES = [
  ['/v1/today', 'today: live, scheduled and final matches across tours for the current date'],
  ['/v1/live', 'matches currently in progress'],
  ['/v1/tournaments', 'tournament editions calendar'],
  ['/v1/matches', 'matches by date / tournament / player'],
  ['/v1/players', 'canonical player directory'],
  ['/v1/rankings', 'official ranking snapshots (ATP/WTA singles + doubles)'],
  ['/v1/news', 'published newsroom stories (none: the evidence graph is not populated)'],
  ['/v1/breakout-watch', 'Breakout Watch index (methodology unpublished)'],
  ['/v1/odds', 'market snapshots (MARKET UNAVAILABLE until a legitimate source is captured)'],
  ['/v1/pbe-picks', 'locked PBE picks (model not validated; none exist)'],
  ['/v1/track-record', 'graded PBE picks (none exist)']
];
const PARAM_ROUTES = [
  [/^\/v1\/tournaments\/[^/]+\/draws$/, 'tournament draws'],
  [/^\/v1\/tournaments\/[^/]+$/, 'tournament edition'],
  [/^\/v1\/matches\/[^/]+\/(live|points|stats)$/, 'match live state / point stream / stats'],
  [/^\/v1\/matches\/[^/]+$/, 'match'],
  [/^\/v1\/players\/[^/]+\/(matches|dna|rankings)$/, 'player history / Tennis DNA / ranking history'],
  [/^\/v1\/players\/[^/]+$/, 'player profile'],
  [/^\/v1\/h2h\/[^/]+\/[^/]+$/, 'head-to-head'],
  [/^\/v1\/doubles\/pairs\/[^/]+$/, 'doubles pair profile']
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' } });
    if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, { status: 405 });

    if (path === '/health' || path === '/') {
      return json(await health({ worker: 'tennis-api', version: VERSION, env, deps: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TENNIS_STATE'], extra: { routes: [...DATA_ROUTES.map((r) => r[0]), '/v1/sources'] } }), { headers: { 'cache-control': 'no-store' } });
    }
    if (path === '/v1/sources') {
      return json(envelope({ registry, canary }, { source: ['pbe_source_audit'], source_updated_at: canary.run_at || null, freshness: canary.run_at ? 'CACHED' : 'UNAVAILABLE', semantics: 'Audited source registry + latest committed canary run. Canary results are evidence from the run time shown, not live status.' }));
    }
    const exact = DATA_ROUTES.find(([p]) => p === path);
    if (exact) return json(notConfigured(exact[1], ['canonical store not yet populated']));
    const param = PARAM_ROUTES.find(([re]) => re.test(path));
    if (param) return json(notConfigured(param[1], ['canonical store not yet populated']));
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }
};
