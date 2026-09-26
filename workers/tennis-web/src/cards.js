// Social cards (1200x630) as SVG strings — PURE. Rendered to PNG by resvg in tennis-web.
// Only data the API returned is printed; a missing photo becomes the monogram tile, never another image.

import { heroSvg, C } from '../../../scripts/brand/court.mjs';
import { PBE_MARK_PNG_B64 } from './pbe-mark.js';

export const W = 1200;
export const H = 630;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fit = (text, max, base) => Math.max(34, Math.min(base, Math.floor(max / (String(text).length * 0.47))));

/** Centered name block: one line if it fits, else two lines split at the space nearest the middle. */
function nameBlock(text, cx, y, maxW, base) {
  const t = String(text || '');
  const w = (str, size) => str.length * size * 0.47;
  if (w(t, base) <= maxW) return `<text x="${cx}" y="${y}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="${base}" fill="${C.line}">${esc(t)}</text>`;
  const words = t.split(' ');
  let best = [t, ''];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const l1 = words.slice(0, i).join(' ');
    const l2 = words.slice(i).join(' ');
    const d = Math.abs(l1.length - l2.length);
    if (d < bestDiff) { bestDiff = d; best = [l1, l2]; }
  }
  const size = Math.max(28, Math.min(base, Math.floor(maxW / (Math.max(best[0].length, best[1].length) * 0.47))));
  return best.filter(Boolean).map((line, i) => `<text x="${cx}" y="${y + i * size * 1.02}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="${size}" fill="${C.line}">${esc(line)}</text>`).join('');
}

function backdrop() {
  const svg = heroSvg(W, H);
  return svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
}

function brand(label) {
  return `<image href="data:image/png;base64,${PBE_MARK_PNG_B64}" x="60" y="52" height="62" width="114"/>
  <rect x="190" y="58" width="2" height="50" fill="${C.line}" opacity="0.35"/>
  <text x="208" y="96" font-family="Barlow Condensed" font-weight="800" font-size="30" letter-spacing="6" fill="${C.gold}">TENNIS${label ? ` · ${esc(label)}` : ''}</text>`;
}

function initials(name) {
  const p = String(name || '').normalize('NFD').replace(/\p{M}+/gu, '').split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : p[0]?.[1] || '')).toUpperCase();
}

/** Photo (jpeg base64) or monogram tile, clipped to a rounded square. */
function portrait({ x, y, size, name, jpegB64 }) {
  const id = `c${x}${y}`;
  const clip = `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.08}"/></clipPath>`;
  if (jpegB64) return `<defs>${clip}</defs><image href="data:image/jpeg;base64,${jpegB64}" x="${x}" y="${y}" width="${size}" height="${size}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.08}" fill="none" stroke="${C.line}" stroke-opacity="0.25" stroke-width="2"/>`;
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.08}" fill="${C.court}" stroke="${C.line}" stroke-opacity="0.25" stroke-width="2"/><text x="${x + size / 2}" y="${y + size * 0.62}" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="${size * 0.42}" fill="${C.line}">${esc(initials(name))}</text><circle cx="${x + size * 0.84}" cy="${y + size * 0.16}" r="${size * 0.045}" fill="${C.gold}"/>`;
}

const frame = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${backdrop()}${inner}
  <text x="60" y="${H - 44}" font-family="Barlow Condensed" font-weight="600" font-size="26" fill="${C.line}" opacity="0.72">tennis.propbetedge.ai</text></svg>`;

export function playerCard({ name, rank, list, nationality, jpegB64, label = 'PLAYER', note = null }) {
  const size = 330;
  const nm = String(name || '').toUpperCase();
  return frame(`${brand(label)}
    ${portrait({ x: 60, y: 160, size, name, jpegB64 })}
    <text x="430" y="300" font-family="Barlow Condensed" font-weight="800" font-size="${fit(nm, 720, 96)}" fill="${C.line}">${esc(nm)}</text>
    ${rank ? `<text x="432" y="380" font-family="Barlow Condensed" font-weight="800" font-size="60" fill="${C.gold}">No. ${esc(rank)}</text><text x="432" y="420" font-family="Barlow Condensed" font-weight="600" font-size="28" letter-spacing="3" fill="${C.line}" opacity="0.8">${esc(list || '')}</text>` : ''}
    ${note ? `<text x="432" y="530" font-family="Barlow Condensed" font-weight="600" font-size="30" fill="${C.gold}">${esc(note)}</text>` : ''}
    ${nationality ? `<text x="432" y="470" font-family="Barlow Condensed" font-weight="600" font-size="30" letter-spacing="4" fill="${C.line}" opacity="0.8">${esc(nationality)}</text>` : ''}`);
}

export function matchCard({ a, b, tournament, round, status, pbecast = false }) {
  const size = 250;
  const nameA = String(a?.name || '').toUpperCase();
  const nameB = String(b?.name || '').toUpperCase();
  const st = { in_progress: 'LIVE', completed: 'FINAL', retired: 'FINAL · RET.', walkover: 'WALKOVER', scheduled: 'UPCOMING' }[status] || '';
  return frame(`${brand(pbecast ? 'PBECAST' : 'MATCH')}
    ${portrait({ x: 120, y: 150, size, name: a?.name, jpegB64: a?.jpegB64 })}
    ${portrait({ x: 830, y: 150, size, name: b?.name, jpegB64: b?.jpegB64 })}
    <text x="600" y="300" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="72" fill="${C.gold}">VS</text>
    ${nameBlock(nameA, 245, 450, 400, 46)}
    ${nameBlock(nameB, 955, 450, 400, 46)}
    <text x="600" y="560" text-anchor="middle" font-family="Barlow Condensed" font-weight="600" font-size="30" letter-spacing="3" fill="${C.line}" opacity="0.85">${esc([tournament, round].filter(Boolean).join(' · ').toUpperCase())}</text>
    ${st ? `<text x="600" y="370" text-anchor="middle" font-family="Barlow Condensed" font-weight="800" font-size="30" letter-spacing="4" fill="${status === 'in_progress' ? '#ff6a63' : C.line}">${st}</text>` : ''}`);
}

export function tournamentCard({ name, year, surface, location, dates, level }) {
  const nm = `${String(name || '').toUpperCase()} ${year || ''}`.trim();
  return frame(`${brand('TOURNAMENT')}
    <text x="60" y="290" font-family="Barlow Condensed" font-weight="800" font-size="${fit(nm, 1080, 110)}" fill="${C.line}">${esc(nm)}</text>
    <text x="62" y="360" font-family="Barlow Condensed" font-weight="800" font-size="40" letter-spacing="4" fill="${C.gold}">${esc([level, surface].filter(Boolean).join(' · ').toUpperCase())}</text>
    <text x="62" y="420" font-family="Barlow Condensed" font-weight="600" font-size="34" fill="${C.line}" opacity="0.85">${esc([location, dates].filter(Boolean).join(' · '))}</text>`);
}

export function rankingsCard({ tour, type, date }) {
  return frame(`${brand('RANKINGS')}
    <text x="60" y="300" font-family="Barlow Condensed" font-weight="800" font-size="104" fill="${C.line}">${esc(`${tour} ${type}`.toUpperCase())}</text>
    <text x="62" y="370" font-family="Barlow Condensed" font-weight="800" font-size="44" letter-spacing="4" fill="${C.gold}">PROPBETEDGE TENNIS RANKINGS</text>
    ${date ? `<text x="62" y="430" font-family="Barlow Condensed" font-weight="600" font-size="34" fill="${C.line}" opacity="0.85">Official list dated ${esc(date)}</text>` : ''}`);
}

/** Greedy wrap into at most `maxLines`, shrinking the font until it fits. */
function wrap(text, maxW, base, maxLines, min = 34) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  for (let size = base; size >= min; size -= 2) {
    const lines = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length * size * 0.47 <= maxW) cur = next;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines) return { lines, size };
  }
  // still too long: keep maxLines and ellipsize the last one
  const size = min;
  const per = Math.floor(maxW / (size * 0.47));
  const lines = [];
  let rest = String(text);
  for (let i = 0; i < maxLines; i += 1) { const cut = rest.length <= per ? rest.length : rest.lastIndexOf(' ', per) > 0 ? rest.lastIndexOf(' ', per) : per; lines.push(rest.slice(0, cut)); rest = rest.slice(cut).trim(); }
  if (rest) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+\S*$/, '')}…`;
  return { lines, size };
}

const KIND_LABEL = { upset: 'UPSET', seed_upset: 'SEED UPSET', title: 'TITLE', doubles_title: 'DOUBLES TITLE', retirement: 'RETIREMENT', walkover: 'WALKOVER', marathon: 'MARATHON', comeback: 'COMEBACK', deciding_tiebreak: 'DECIDING TIEBREAK', dominant: 'DOMINANT WIN', qualifier_run: 'QUALIFIER RUN', new_no1: 'NEW NO. 1', enters_top10: 'TOP 10', enters_top20: 'TOP 20', enters_top50: 'TOP 50', enters_top100: 'TOP 100' };

export function newsCard({ headline, kind, context, stat, jpegB64, name }) {
  const withPhoto = !!(jpegB64 || name);
  const x = withPhoto ? 400 : 60;
  const maxW = withPhoto ? 740 : 1080;
  const { lines, size } = wrap(headline, maxW, 60, 3);
  const top = 250 - ((lines.length - 1) * size) / 2;
  return frame(`${brand('NEWS')}
    ${withPhoto ? portrait({ x: 60, y: 170, size: 300, name, jpegB64 }) : ''}
    <text x="${x + 2}" y="${top - size * 0.95}" font-family="Barlow Condensed" font-weight="800" font-size="26" letter-spacing="5" fill="${C.gold}">${esc(KIND_LABEL[kind] || 'STORY')}</text>
    ${lines.map((l, i) => `<text x="${x}" y="${top + i * size * 1.04}" font-family="Barlow Condensed" font-weight="800" font-size="${size}" fill="${C.line}">${esc(l)}</text>`).join('')}
    ${context ? `<text x="${x + 2}" y="${top + lines.length * size * 1.04 + 20}" font-family="Barlow Condensed" font-weight="600" font-size="28" fill="${C.line}" opacity="0.82">${esc(String(context).slice(0, 70))}</text>` : ''}
    ${stat ? `<text x="${x + 2}" y="${Math.min(560, top + lines.length * size * 1.04 + 80)}" font-family="Barlow Condensed" font-weight="800" font-size="40" fill="${C.gold}">${esc(`${stat.label}: ${stat.value}`.toUpperCase().slice(0, 48))}</text>` : ''}`);
}
