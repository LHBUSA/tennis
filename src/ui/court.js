// PBEcast court renderer — SVG geometry in real ITF dimensions (metres), used by PBEcast and (later)
// the simulator. Pure functions of a render model; no data fetching.
//
// Orientation: side A plays from the BOTTOM baseline, side B from the TOP, consistently.
// Truth rules (docs/TENNISCAST.md):
//   * the serve marker + highlighted service box come from the OBSERVED server and point score using the
//     rules of tennis (first point of a game / tiebreak from the deuce court, then alternating) — never
//     from an invented rally;
//   * a ball position is drawn ONLY when an event carries source coordinates ({x, y} metres, origin at the
//     court centre, +y towards side B); otherwise nothing spatial is drawn;
//   * `simulation: true` stamps the court SIMULATION so a simulated path can never look like a sourced one.

import { raw } from '../lib/dom.js';

const L = 23.77 / 2, D = 10.97 / 2, S = 8.23 / 2, SL = 6.4;
const PAD_X = 3.2, PAD_Y = 4.2;               // run-off shown around the court (m)
const VB_W = 2 * (D + PAD_X), VB_H = 2 * (L + PAD_Y);
const X = (x) => (x + D + PAD_X).toFixed(3);
const Y = (y) => (L + PAD_Y - y).toFixed(3); // +y (towards B) is up on screen

/** Which half of the court the server stands on: 'deuce' or 'ad'. null when not provable. */
export function serveCourt(point, inTiebreak) {
  if (!point) return null;
  if (inTiebreak) {
    const a = Number(point.A), b = Number(point.B);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    return (a + b) % 2 === 0 ? 'deuce' : 'ad';
  }
  const map = { 0: 0, 15: 1, 30: 2, 40: 3 };
  const pa = String(point.A).toUpperCase(), pb = String(point.B).toUpperCase();
  if (pa === 'AD' || pb === 'AD') return 'ad'; // advantage points are played from the ad court
  if (map[pa] == null || map[pb] == null) return null;
  return (map[pa] + map[pb]) % 2 === 0 ? 'deuce' : 'ad';
}

/**
 * model = { doubles, server: 'A'|'B'|null, point: {A,B}|null, tiebreak: bool, highlight: 'A'|'B'|null,
 *           ball: {x,y}|null (source coordinates only), banner: string|null, simulation: bool, tone }
 */
export function courtSvg(model = {}) {
  const lines = [
    [-D, -L, D, -L], [-D, L, D, L], [-D, -L, -D, L], [D, -L, D, L],
    [-S, -L, -S, L], [S, -L, S, L], [-S, -SL, S, -SL], [-S, SL, S, SL], [0, -SL, 0, SL],
    [0, -L, 0, -L + 0.18], [0, L, 0, L - 0.18]
  ];
  const doublesAlleyOpacity = model.doubles ? 1 : 0.45;
  let s = `<svg class="court" viewBox="0 0 ${VB_W.toFixed(2)} ${VB_H.toFixed(2)}" role="img" aria-label="${model.doubles ? 'Doubles' : 'Singles'} tennis court${model.server ? `, side ${model.server} serving` : ''}">`;
  s += `<rect class="c-out" x="0" y="0" width="${VB_W}" height="${VB_H}" rx="0.6"/>`;
  s += `<rect class="c-in" x="${X(-D)}" y="${Y(L)}" width="${(2 * D).toFixed(3)}" height="${(2 * L).toFixed(3)}"/>`;
  // service box the serve must land in (diagonally opposite the server's half)
  const court = model.server ? serveCourt(model.point, model.tiebreak) : null;
  if (model.server && court) {
    // server facing the net: deuce court is to the server's right. A faces +y (right = +x); B faces -y (right = -x).
    const rightSign = model.server === 'A' ? 1 : -1;
    const serverX = (court === 'deuce' ? 1 : -1) * rightSign;         // sign of x where the server stands
    const boxY0 = model.server === 'A' ? 0 : -SL, boxY1 = model.server === 'A' ? SL : 0; // receiver's half
    const bx0 = serverX > 0 ? -S : 0, bx1 = serverX > 0 ? 0 : S;      // diagonal box = opposite x
    s += `<rect class="c-box" x="${X(bx0)}" y="${Y(boxY1)}" width="${(bx1 - bx0).toFixed(3)}" height="${(boxY1 - boxY0).toFixed(3)}"/>`;
    const by = model.server === 'A' ? -L - 0.9 : L + 0.9;
    s += `<g class="c-srv"><circle cx="${X(serverX * 2.2)}" cy="${Y(by)}" r="0.42"/><circle class="c-srv-ring" cx="${X(serverX * 2.2)}" cy="${Y(by)}" r="0.95"/></g>`;
  } else if (model.server) {
    const by = model.server === 'A' ? -L - 0.9 : L + 0.9;
    s += `<g class="c-srv"><circle cx="${X(0)}" cy="${Y(by)}" r="0.42"/></g>`;
  }
  if (model.highlight) {
    const y0 = model.highlight === 'A' ? -L : 0, y1 = model.highlight === 'A' ? 0 : L;
    s += `<rect class="c-hl" x="${X(-D)}" y="${Y(y1)}" width="${(2 * D).toFixed(3)}" height="${(y1 - y0).toFixed(3)}"/>`;
  }
  s += `<g class="c-lines">${lines.map(([x1, y1, x2, y2], i) => `<line x1="${X(x1)}" y1="${Y(y1)}" x2="${X(x2)}" y2="${Y(y2)}"${i >= 2 && i <= 3 ? ` opacity="${doublesAlleyOpacity}"` : ''}/>`).join('')}</g>`;
  // net + posts
  s += `<line class="c-net" x1="${X(-D - 0.914)}" y1="${Y(0)}" x2="${X(D + 0.914)}" y2="${Y(0)}"/>`;
  s += `<circle class="c-post" cx="${X(-D - 0.914)}" cy="${Y(0)}" r="0.16"/><circle class="c-post" cx="${X(D + 0.914)}" cy="${Y(0)}" r="0.16"/>`;
  if (model.ball && Number.isFinite(model.ball.x) && Number.isFinite(model.ball.y)) s += `<circle class="c-ball" cx="${X(model.ball.x)}" cy="${Y(model.ball.y)}" r="0.2"/>`;
  if (model.simulation) s += `<text class="c-sim" x="${(VB_W / 2).toFixed(2)}" y="1.6" text-anchor="middle">SIMULATION</text>`;
  s += '</svg>';
  return raw(s);
}

export const COURT_VIEWBOX = { w: VB_W, h: VB_H };
