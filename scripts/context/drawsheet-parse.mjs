// Official draw-sheet text parser (pdftotext -layout output of ProTennisLive / WTA draw PDFs).
// Pure: text in, facts out. It reads only what the sheet prints:
//   - header surface / indoor (a segment that IS a surface phrase, or the segment after a '|' / ', ' in the
//     dates line). A tournament NAME that contains a surface word ("Clay Court Championships") is not a
//     surface segment and is ignored. More than one distinct surface -> null (never guessed);
//   - header dates (month + day + year segments) — used only to corroborate an edition;
//   - draw rows: position, seed, entry status, nationality, "SURNAME, First" or Bye.
// A parse that is not a contiguous 1..N draw (N a power of two) is returned with ok=false and never used.

const SURF = /^(?:,\s*)?(?:(indoor|outdoor)\s+)?(?:(red|green|blue)\s+)?(clay|hard|grass|carpet)(?:\s+court)?(?:\s*,\s*(?:(indoor|outdoor)\s+)?(?:(red|green|blue)\s+)?(clay|hard|grass|carpet)(?:\s+court)?)?(?:\s*\((indoor|outdoor)\))?$/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON = new RegExp(`\\b(${MONTHS.join('|')}|${MONTHS.map((m) => m.slice(0, 3)).join('|')})\\b`, 'i');
const ENTRY = 'WC|Q|LL|PR|SE|ALT|Alt|NG|SR|JE|IP|ITF';

const segs = (line) => line.split(/\s{3,}|\t/).map((s) => s.trim()).filter(Boolean);

function surfaceOf(seg) {
  let s = seg.trim();
  const bar = s.lastIndexOf('|');
  if (bar >= 0) s = s.slice(bar + 1).trim();
  const m = s.match(SURF);
  if (!m) return null;
  const kinds = [m[3], m[6]].filter(Boolean).map((x) => x.toLowerCase());
  if (new Set(kinds).size !== 1) return null; // "Hard, Clay" never collapses to one
  const io = [m[1], m[4], m[7]].filter(Boolean).map((x) => x.toLowerCase());
  return { surface: kinds[0], indoor: io.includes('indoor') ? true : io.includes('outdoor') ? false : null, raw: seg.trim() };
}

export function parseHeader(text) {
  const lines = text.split(/\r?\n/).slice(0, 60);
  const found = [];
  const dates = [];
  for (const line of lines) {
    for (const seg of segs(line)) {
      // the dates line of newer sheets carries "dates | prize | Surface"
      const parts = seg.includes('|') ? seg.split('|').map((x) => x.trim()) : [seg];
      for (const p of parts) {
        const s = surfaceOf(p);
        if (s) found.push(s);
      }
      if (MON.test(seg) && /\b(19|20)\d{2}\b/.test(seg)) dates.push(parts[0]);
    }
  }
  const kinds = [...new Set(found.map((f) => f.surface))];
  const indoor = [...new Set(found.map((f) => f.indoor).filter((x) => x != null))];
  return {
    surface: kinds.length === 1 ? kinds[0] : null,
    surface_conflict: kinds.length > 1 ? kinds : null,
    indoor: indoor.length === 1 ? indoor[0] : null,
    surface_raw: found.map((f) => f.raw),
    dates_raw: dates.slice(0, 2),
    dates: dates.flatMap(parseDates)
  };
}

/** "10 - 18 May 2014", "April 30 - May 8, 2016", "17 September -- 23 September 2025", "April 22-4 2025" -> ISO days that are unambiguous. */
export function parseDates(s) {
  const y = (s.match(/\b((?:19|20)\d{2})\b/) || [])[1];
  if (!y) return [];
  const toks = s.replace(/,/g, ' ').split(/[\s\-–—]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < toks.length; i += 1) {
    const mi = MONTHS.findIndex((m) => m.startsWith(toks[i].toLowerCase().slice(0, 3)) && /^[a-z]{3,}$/i.test(toks[i]));
    if (mi < 0) continue;
    for (const j of [i - 1, i + 1]) {
      const d = Number(toks[j]);
      if (Number.isInteger(d) && d >= 1 && d <= 31 && String(toks[j]).length <= 2) out.push(`${y}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }
  return [...new Set(out)];
}

const NAME = String.raw`(BYE|Bye|[A-ZÀ-Þ][A-ZÀ-Þ'’\-\. ]*[A-ZÀ-Þ.],\s?(?:[A-Za-zÀ-ɏ'’\-\. ]*?|\.\.\.))(?=\s{2,}|\s+[A-Z]{3}(?:\s|$)|\s*$)`;
// a draw row starts at the left margin: [entry] number [entry] [number] [entry] [NAT] then a name, Bye, or nothing
const ROW = new RegExp(String.raw`^\s{0,8}(?:(${ENTRY})\s+)?(\d{1,3})(?:\s*(${ENTRY})(?=\s|$))?(?:\s+(\d{1,3}))?(?:\s+(${ENTRY}))?(?:\s+(?!BYE\b)([A-Z]{3}))?(?:\s+${NAME}|\s*$)`);
// a name printed on its own line (position on a neighbouring line): indented [entry] [seed] NAT NAME
const NAME_ONLY = new RegExp(String.raw`^\s{5,24}(?:(${ENTRY})\s+)?(?:(\d{1,2})\s+)?(?!BYE\b)([A-Z]{3})\s+${NAME}`);
const STOP = /SEEDED PLAYERS|Seeded Players|LAST DIRECT ACCEPTANCE|Copyright|RANKING POINTS|PRIZE MONEY/;

const slot = (pos, seed, entry, nat, name) => {
  const bye = /^bye$/i.test(name);
  const [last, first] = bye ? [null, null] : name.split(',').map((x) => x.trim());
  return { position: pos, bye, seed: seed || null, entry: entry ? entry.toUpperCase() : null, nat: nat || null, last: last || null, first: first && first !== '...' ? first.replace(/\.\.\.$/, '').trim() || null : null, truncated: bye ? false : /\.\.\./.test(name) };
};

/**
 * Draw rows, page by page, in reading order. The position is whichever leading number continues the 1..N
 * sequence (sheets print "seed position" or "position seed" by column width); a row without a name takes the
 * nearest unused name-only line within three lines. The seeded-players / prize tables end a page.
 */
export function parseSlots(text) {
  const out = [];
  let expected = 1;
  for (const page of text.split('\f')) {
    const lines = page.split(/\r?\n/);
    const stop = lines.findIndex((l) => STOP.test(l));
    const body = stop >= 0 ? lines.slice(0, stop) : lines;
    const used = new Set();
    const nameOnly = body.map((l, i) => { const m = l.match(NAME_ONLY); return m && !l.match(ROW) ? { i, entry: m[1], seed: m[2] ? Number(m[2]) : null, nat: m[3], name: m[4] } : null; }).filter(Boolean);
    for (let i = 0; i < body.length; i += 1) {
      const m = body[i].match(ROW);
      if (!m) continue;
      const a = Number(m[2]);
      const b = m[4] != null ? Number(m[4]) : null;
      let pos;
      let seed;
      if (a === expected) { pos = a; seed = b; } else if (b === expected) { pos = b; seed = a; } else continue;
      const entry = m[1] || m[3] || m[5] || null;
      if (m[7]) { out.push(slot(pos, seed, entry, m[6], m[7])); expected = pos + 1; continue; }
      if (m[6]) continue; // a nationality with no name is not a row we can read
      const near = nameOnly.filter((n) => !used.has(n.i) && Math.abs(n.i - i) <= 3).sort((x, y) => Math.abs(x.i - i) - Math.abs(y.i - i))[0];
      if (!near) continue;
      used.add(near.i);
      out.push(slot(pos, seed ?? near.seed, entry || near.entry, near.nat, near.name));
      expected = pos + 1;
    }
  }
  const n = out.length;
  const ok = n >= 8 && (n & (n - 1)) === 0 && out.every((s, k) => s.position === k + 1);
  return { ok, size: n, slots: out };
}

export const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/**
 * Resolve slots against the edition's own participants (a closed set proven by stored matches) and prove the
 * sheet: first-round pairs (2k-1, 2k) must be matches we hold. Returns per-slot participant keys + proof.
 * people: [{ key, last, first }]; matches: [{ keys: [keyA, keyB] }] (singles, any round).
 */
export function proveDraw(parsed, people, matches) {
  const byLast = new Map();
  for (const p of people) { const k = fold(p.last); if (!byLast.has(k)) byLast.set(k, []); if (!byLast.get(k).some((x) => x.key === p.key)) byLast.get(k).push(p); }
  const resolve = (s) => {
    if (s.bye || !s.last) return null;
    let c = byLast.get(fold(s.last)) || [];
    if (!c.length && s.truncated) c = people.filter((p) => fold(p.last).startsWith(fold(s.last)));
    if (c.length > 1 && s.first) c = c.filter((p) => fold(p.first)[0] === fold(s.first)[0]);
    return c.length === 1 ? c[0].key : null;
  };
  const pairs = new Set(matches.map((m) => [...m.keys].sort().join('|')));
  const slots = parsed.slots.map((s) => ({ ...s, participant_key: resolve(s) }));
  let checked = 0;
  let confirmed = 0;
  for (let i = 0; i + 1 < slots.length; i += 2) {
    const [a, b] = [slots[i], slots[i + 1]];
    if (a.bye || b.bye || !a.participant_key || !b.participant_key) continue;
    checked += 1;
    if (pairs.has([a.participant_key, b.participant_key].sort().join('|'))) confirmed += 1;
  }
  const players = slots.filter((s) => !s.bye);
  const resolved = players.filter((s) => s.participant_key).length;
  const keys = players.map((s) => s.participant_key).filter(Boolean);
  const unique = new Set(keys).size === keys.length;
  const proven = parsed.ok && unique && checked >= 4 && confirmed / checked >= 0.9 && resolved / Math.max(1, players.length) >= 0.75;
  return { proven, checked, confirmed, resolved, players: players.length, unique, slots };
}
