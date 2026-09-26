// tennis-news — Evidence-grounded newsroom. source event -> evidence packet -> gates -> publish. Failing stories HOLD.
// Skeleton: /health and an empty run ledger only. It does no work until its inputs exist
// (the canonical event graph is not populated; nothing can be published); see docs/STATUS.md.

import { json, notConfigured } from '../../shared/envelope.js';
import { health } from '../../shared/health.js';

export const VERSION = '0.1.0';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/health' || path === '/') return json(await health({ worker: 'tennis-news', version: VERSION, env, deps: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TENNIS_STATE'], extra: { active: false, reason: 'the canonical event graph is not populated; nothing can be published' } }), { headers: { 'cache-control': 'no-store' } });
    if (path === '/v1/news/runs') return json(notConfigured('tennis-news run ledger', ['the canonical event graph is not populated; nothing can be published']));
    return json({ ok: false, error: 'not_found' }, { status: 404 });
  }
};
