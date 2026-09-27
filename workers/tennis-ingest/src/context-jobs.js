// Phase 5 context layer jobs (docs/TENNIS_DATA_MODEL.md "Context layer").
//  - wtaEditionFactsStep: the official WTA calendar, year by year (2000 ->), records surface / indoor / level of
//    every canonical edition it names as SOURCED attributes (tennis_edition_attributes, source wta, method
//    direct), fills an edition's empty surface / indoor, logs a disagreement instead of overwriting a stored
//    value, and records the WTA tournament / edition id mappings. Editions we do not hold are not created here.
//  - drawSheet: one official draw-sheet PDF (ProTennisLive for ATP, wtafiles for WTA) through the polite client,
//    archived byte-exact to R2 (content-addressed) with a capture row. Parsing happens in the reviewed registry
//    build (scripts/context/drawsheets.mjs); nothing here reads a PDF.

import * as wta from '../../providers/wta.js';
import { fetchRun } from './jobs.js';
import { recordCapture } from './writer.js';
import { archiveCapture } from '../../shared/archive.js';
import { inList } from '../../shared/store/postgrest.js';
import { tournamentId, tournamentKey, editionId } from '../../shared/canonical/ids.js';

export const RULE_VERSION = 'context-v1';
const FACTS = 'ctx:wtafacts';
const FIRST_YEAR = 2000;

export async function wtaEditionFactsStep(ctx, { pages = 4 } = {}) {
  const lastYear = new Date().getUTCFullYear() + 1;
  const st = (await ctx.kv.get(FACTS, 'json')) || { year: FIRST_YEAR, page: 0, totals: {} };
  const out = { pages: [] };
  for (let n = 0; n < pages && st.year <= lastYear; n += 1) {
    const adapter = { ...wta.calendar, key: 'wta.calendar.year', request: () => ({ url: `https://api.wtatennis.com/tennis/tournaments/?page=${st.page}&pageSize=100&from=${st.year}-01-01&to=${st.year}-12-31` }) };
    const r = await fetchRun(ctx, adapter, {});
    if (r.state !== 'PASS' && !(r.state === 'DEGRADED' && r.error === 'zero_records')) throw new Error(`wta calendar ${st.year} p${st.page}: ${r.state} ${r.error || ''}`.trim());
    const recs = (r.records || []).filter((e) => e.year === st.year); // a from/to window also lists the neighbour year's straddling events
    const w = await writeFacts(ctx.store, recs, r.capture?.capture_id || null);
    out.pages.push({ year: st.year, page: st.page, listed: (r.records || []).length, ...w });
    for (const [k, v] of Object.entries(w)) st.totals[k] = (st.totals[k] || 0) + v;
    if ((r.records || []).length < 100) { st.year += 1; st.page = 0; } else st.page += 1;
    await ctx.kv.put(FACTS, JSON.stringify(st));
  }
  return { ...out, next: { year: st.year, page: st.page }, totals: st.totals, done: st.year > lastYear };
}

export async function writeFacts(store, recs, captureId) {
  const w = { editions_known: 0, editions_unknown: 0, attributes: 0, surface_filled: 0, indoor_filled: 0, disagreements: 0, surface_unmapped: 0 };
  if (!recs.length) return w;
  const rows = await Promise.all(recs.map(async (e) => {
    const tid = await tournamentId(tournamentKey('wta', e.provider_tournament_id, e.name, e.level));
    return { e, tid, eid: await editionId(tid, e.year) };
  }));
  const stored = new Map((await store.select('tennis_tournament_editions', `select=edition_id,surface,indoor&edition_id=${inList(rows.map((x) => x.eid))}`)).map((x) => [x.edition_id, x]));
  const attrs = [];
  const maps = [];
  const dis = [];
  const now = new Date().toISOString();
  for (const { e, tid, eid } of rows) {
    const s = stored.get(eid);
    if (!s) { w.editions_unknown += 1; continue; }
    w.editions_known += 1;
    const ref = `wta:${e.provider_tournament_id}-${e.year}`;
    const evidence = { title: e.title, start_date: e.start_date, end_date: e.end_date, city: e.city, surface_raw: e.surface_raw };
    if (e.surface) attrs.push({ edition_id: eid, attribute: 'surface', value: e.surface, source: 'wta', method: 'direct', source_ref: ref, capture_id: captureId, evidence, observed_at: now });
    else if (e.surface_raw) w.surface_unmapped += 1;
    if (e.indoor != null) attrs.push({ edition_id: eid, attribute: 'indoor', value: String(e.indoor), source: 'wta', method: 'direct', source_ref: ref, capture_id: captureId, evidence, observed_at: now });
    if (e.level) attrs.push({ edition_id: eid, attribute: 'level', value: e.level, source: 'wta', method: 'direct', source_ref: ref, capture_id: captureId, evidence, observed_at: now });
    maps.push({ entity_type: 'tournament', provider: 'wta', external_id: e.provider_tournament_id, canonical_id: tid, status: 'mapped', method: 'official_id', confidence: 'high', evidence: { name: e.name, level: e.level }, capture_ids: captureId ? [captureId] : [], rule_version: RULE_VERSION, decided_at: now });
    maps.push({ entity_type: 'edition', provider: 'wta', external_id: `${e.provider_tournament_id}-${e.year}`, canonical_id: eid, status: 'mapped', method: 'official_id', confidence: 'high', evidence: { title: e.title, start_date: e.start_date }, capture_ids: captureId ? [captureId] : [], rule_version: RULE_VERSION, decided_at: now });
    for (const [field, val, cur] of [['surface', e.surface, s.surface], ['indoor', e.indoor, s.indoor]]) {
      if (val == null) continue;
      if (cur == null) {
        await store.req('PATCH', `tennis_tournament_editions?edition_id=eq.${eid}&${field}=is.null`, { body: { [field]: val } });
        w[`${field}_filled`] += 1;
      } else if (cur !== val) dis.push({ entity_type: 'edition', entity_id: eid, field, source: 'wta', source_value: val, derived_value: cur, detail: { source_ref: ref, capture_id: captureId, title: e.title }, observed_at: now });
    }
  }
  const uniq = (a, k) => [...new Map(a.map((x) => [k(x), x])).values()];
  if (attrs.length) await store.upsert('tennis_edition_attributes', uniq(attrs, (x) => `${x.edition_id}|${x.attribute}`), { onConflict: 'edition_id,attribute,source' });
  if (maps.length) await store.upsert('tennis_source_mappings', uniq(maps, (x) => `${x.entity_type}|${x.external_id}`), { onConflict: 'entity_type,provider,external_id' });
  if (dis.length) await store.upsert('tennis_source_disagreements', uniq(dis, (x) => `${x.entity_id}|${x.field}`), { onConflict: 'entity_type,entity_id,field,source' });
  w.attributes = attrs.length;
  w.disagreements = dis.length;
  return w;
}

// ---- official draw sheets --------------------------------------------------------------------------------
export const DRAW_SHEETS = {
  ptl: { family: 'protennislive', host: 'www.protennislive.com', url: (y, t, doc) => `https://www.protennislive.com/posting/${y}/${t}/${doc}.pdf`, docs: ['mds', 'qs'] },
  wta: { family: 'wta-draws', host: 'wtafiles.wtatennis.com', url: (y, t, doc) => `https://wtafiles.wtatennis.com/pdf/draws/${y}/${t}/${doc}.pdf`, docs: ['MDS', 'QS'] }
};

/** One allow-listed draw sheet -> { status, capture, body }. 404 / non-PDF -> { status } without archiving. */
export async function drawSheet(ctx, { source, year, tid, doc }) {
  const d = DRAW_SHEETS[source];
  if (!d || !d.docs.includes(doc) || !/^\d{4}$/.test(String(year)) || !/^\d{1,6}$/.test(String(tid))) return { status: 400, error: 'bad_request' };
  const res = await ctx.client.get(d.url(year, tid, doc), { binary: true, conditional: false });
  ctx.upstream += 1;
  if (!res.ok || !/pdf/i.test(res.content_type || '')) return { status: res.ok ? 415 : res.status, content_type: res.content_type };
  const capture = await archiveCapture({ bucket: ctx.env.TENNIS_SOURCE || null, family: d.family, adapter: `${d.family}.drawsheet`, parserVersion: 'registry', result: res });
  if (ctx.env.TENNIS_SOURCE) await recordCapture(ctx.store, capture);
  return { status: 200, capture, body: res.body };
}
