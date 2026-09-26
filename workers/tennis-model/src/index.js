// tennis-model — PBE Tennis match model. Pre-match probabilities with frozen versions and leakage controls.
// Skeleton: /health and an empty run ledger only. It does no work until its inputs exist
// (no model is trained or validated; PBE Picks are not live); see docs/STATUS.md.

import { json, notConfigured } from '../../shared/envelope.js';
import { health } from '../../shared/health.js';

export const VERSION = '0.1.0';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/health' || path === '/') return json(await health({ worker: 'tennis-model', version: VERSION, env, deps: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TENNIS_STATE'], extra: { active: false, reason: 'no model is trained or validated; PBE Picks are not live' } }), { headers: { 'cache-control': 'no-store' } });
    if (path === '/v1/model/runs') return json(notConfigured('tennis-model run ledger', ['no model is trained or validated; PBE Picks are not live']));
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }
};
