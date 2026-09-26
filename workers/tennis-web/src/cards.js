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

export function playerCard({ name, rank, list, nationality, jpegB64 }) {
  const size = 330;
  const nm = String(name || '').toUpperCase();
  return frame(`${brand('PLAYER')}
    ${portrait({ x: 60, y: 160, size, name, jpegB64 })}
    <text x="430" y="300" font-family="Barlow Condensed" font-weight="800" font-size="${fit(nm, 720, 96)}" fill="${C.line}">${esc(nm)}</text>
    ${rank ? `<text x="432" y="380" font-family="Barlow Condensed" font-weight="800" font-size="60" fill="${C.gold}">No. ${esc(rank)}</text><text x="432" y="420" font-family="Barlow Condensed" font-weight="600" font-size="28" letter-spacing="3" fill="${C.line}" opacity="0.8">${esc(list || '')}</text>` : ''}
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
