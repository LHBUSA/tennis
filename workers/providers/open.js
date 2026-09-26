// Open identity/media sources and ATP's public draw PDFs.
//   Wikidata (CC0)       — identity crosswalk: ATP (P536), WTA (P597), ITF (P599), Davis Cup (P2641), BJK Cup (P2642), image (P18)
//   Wikimedia Commons    — per-file license + author metadata for the photo rights ledger
//   ProTennisLive        — ATP's official draw PDFs (/posting/{year}/{tournamentId}/mds.pdf); names only, no ids

import { requirePaths, safeJson } from '../shared/adapter.js';

const PARSER = '1';

export function crosswalkQuery({ limit = 50, offset = 0 } = {}) {
  return `SELECT ?h ?hLabel ?atp ?wta ?itf ?dc ?bjk ?dob ?img WHERE {
  ?h wdt:P31 wd:Q5 .
  { ?h wdt:P536 ?atp } UNION { ?h wdt:P597 ?wta } UNION { ?h wdt:P599 ?itf }
  OPTIONAL { ?h wdt:P536 ?atp } OPTIONAL { ?h wdt:P597 ?wta } OPTIONAL { ?h wdt:P599 ?itf }
  OPTIONAL { ?h wdt:P2641 ?dc } OPTIONAL { ?h wdt:P2642 ?bjk } OPTIONAL { ?h wdt:P569 ?dob } OPTIONAL { ?h wdt:P18 ?img }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY ?h LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;
}

const lit = (b, k) => b[k]?.value ?? null;

export function parseCrosswalk(json) {
  return (json.results?.bindings || []).map((b) => {
    const img = lit(b, 'img');
    return {
      type: 'identity_crosswalk',
      provider: 'wikidata',
      provider_id: lit(b, 'h')?.split('/').pop() || null,
      label: /^Q\d+$/.test(lit(b, 'hLabel') || '') ? null : lit(b, 'hLabel'),
      external: { atp: lit(b, 'atp'), wta: lit(b, 'wta'), itf: lit(b, 'itf'), daviscup: lit(b, 'dc'), bjkcup: lit(b, 'bjk') },
      dob: lit(b, 'dob') ? lit(b, 'dob').slice(0, 10) : null,
      commons_file: img ? decodeURIComponent(img.split('/Special:FilePath/')[1] || '') || null : null
    };
  });
}

export const wikidataCrosswalk = {
  key: 'wikidata.crosswalk',
  family: 'wikidata',
  capabilities: ['player_identity', 'player_media'],
  parser_version: PARSER,
  cadence: { class: 'weekly', min_interval_s: 7 * 86400 },
  request: (p = {}) => ({ url: `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(crosswalkQuery(p))}`, headers: { accept: 'application/sparql-results+json' } }),
  shape: (body) => {
    const j = safeJson(body);
    return j ? requirePaths(j, ['head.vars', 'results.bindings']) : ['not_json'];
  },
  parse: (body) => parseCrosswalk(safeJson(body))
};

export const commonsLicense = {
  key: 'commons.license',
  family: 'commons',
  capabilities: ['player_media'],
  parser_version: PARSER,
  cadence: { class: 'on_demand' },
  request: ({ file }) => ({ url: `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=LicenseShortName|Artist|LicenseUrl|Credit|AttributionRequired&titles=${encodeURIComponent(`File:${file}`)}` }),
  shape: (body) => {
    const j = safeJson(body);
    const page = j && Object.values(j.query?.pages || {})[0];
    return page ? requirePaths(page, ['imageinfo.0.url', 'imageinfo.0.extmetadata.LicenseShortName.value']) : ['no_page'];
  },
  parse: (body) => Object.values(safeJson(body).query.pages).map((p) => {
    const ii = p.imageinfo[0];
    const md = ii.extmetadata || {};
    const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').trim() || null;
    return { type: 'media_license', provider: 'commons', title: p.title, original_url: ii.url, description_url: ii.descriptionurl || null, width: ii.width ?? null, height: ii.height ?? null, license: strip(md.LicenseShortName?.value), license_url: strip(md.LicenseUrl?.value), author: strip(md.Artist?.value), credit: strip(md.Credit?.value) };
  })
};

// ProTennisLive returns HTTP 200 with a ~2.6 KB "Tournament Information Not Yet Available" PDF for draws
// that are not published: status alone proves nothing, so the shape check looks at size and text.
export const PTL_PLACEHOLDER_MAX_BYTES = 8000;
export const protennisliveDraw = {
  key: 'protennislive.draw_pdf',
  family: 'protennislive',
  capabilities: ['draws'],
  parser_version: PARSER,
  cadence: { class: 'event_window', active_s: 1800, idle_s: 86400 },
  request: ({ year, tournamentId, doc = 'mds' }) => ({ url: `https://www.protennislive.com/posting/${year}/${tournamentId}/${doc}.pdf`, headers: { accept: 'application/pdf' } }),
  shape: (body) => {
    if (!String(body).startsWith('%PDF')) return ['not_a_pdf'];
    if (body.length < PTL_PLACEHOLDER_MAX_BYTES || /Not Yet Available/i.test(body)) return ['placeholder_pdf'];
    return [];
  },
  // Text extraction is not built yet (needs a PDF parser in the ingest runtime). Record availability only.
  parse: (body, meta) => [{ type: 'artifact', provider: 'protennislive', url: meta?.url || null, bytes: body.length, parsed: false }]
};

export const ADAPTERS = [wikidataCrosswalk, commonsLicense, protennisliveDraw];
