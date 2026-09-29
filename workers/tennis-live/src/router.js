// Live source router: a live edition goes to the provider that legitimately owns its live state. Both providers
// normalize through parse -> normalizeMatch -> the same canonical writer (tennis_matches, tennis_sets,
// tennis_match_events score_snapshot rows, tennis_source_changes). No per-tour tables, no second data model.
//
//   source 'wta'   official WTA live-scoring feed (api.wtatennis.com)   WS, WD      point score + server
//   source 'espn'  ESPN core API, ATP league (SECONDARY)                MS, MD, XD  games per set; no point/server
//
// live:editions entries are written by tennis-ingest: WTA calendar editions (no `source` field before 2026-09-29 ->
// they are WTA) and ESPN ATP events with a competition in progress ({ source: 'espn', event_id: '959-2026' }).
// An unknown source is refused, never guessed.

import * as wta from '../../providers/wta.js';
import * as espn from '../../providers/espn.js';
import { editionMatches } from '../../tennis-ingest/src/jobs.js';
import { espnLiveObserve } from '../../tennis-ingest/src/espn-live.js';

export const LIVE_PROVIDERS = Object.freeze({
  wta: Object.freeze({
    key: 'wta', source_family: 'wta', tour: 'WTA', official: true, granularity: 'point', events: Object.freeze(['WS', 'WD']),
    host: wta.WTA_HOST, policy: Object.freeze({ ...wta.WTA_POLICY, retries: 2 }),
    observe: (ctx, ed) => editionMatches(ctx, ed)
  }),
  espn: Object.freeze({
    key: 'espn', source_family: 'espn', tour: 'ATP', official: false, granularity: 'game', events: Object.freeze(['MS', 'MD', 'XD']),
    host: espn.ESPN_HOST, policy: espn.ESPN_POLICY,
    // tennis-live reads fewer not-yet-confirmed competitions per round than the ingest scan (a round must fit the minute)
    observe: (ctx, ed) => espnLiveObserve(ctx, ed.event_id, { league: ed.league || 'atp', maxStatus: 4 })
  })
});

/** live:editions entry -> provider. */
export function providerFor(ed) {
  const src = ed?.source || 'wta';
  const p = LIVE_PROVIDERS[src];
  if (!p) throw new Error(`no live provider for source '${src}'`);
  return p;
}

/** SourceClient host policies for every live provider (one client serves the whole cycle). */
export function livePolicies() {
  return Object.fromEntries(Object.values(LIVE_PROVIDERS).map((p) => [p.host, p.policy]));
}
