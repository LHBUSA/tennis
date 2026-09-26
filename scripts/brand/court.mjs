// Court geometry for brand art: ITF dimensions through a pinhole camera. Shared by build-assets.

export const C = { night: '#062019', court: '#0f4d38', courtIn: '#15634a', runoff: '#0c3f2e', line: '#f3f6f1', gold: '#d9b44a' };

// ---- projection ---------------------------------------------------------------------------------------
export function camera({ W, H, camX = 0, camY = -24, camZ = 26, pitch = 0.42, yaw = 0, focal = 1.05, cx = 0.5, cy = 0.42 }) {
  const F = focal * W;
  const cosP = Math.cos(pitch), sinP = Math.sin(pitch), cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  return (X, Y, Z = 0) => {
    let rx = X - camX, ry = Y - camY; const rz = Z - camZ;
    const x1 = rx * cosY - ry * sinY; const y1 = rx * sinY + ry * cosY; rx = x1; ry = y1;
    const depth = ry * cosP - rz * sinP;
    const up = ry * sinP + rz * cosP;
    return [cx * W + (F * rx) / depth, cy * H - (F * up) / depth];
  };
}
export const poly = (P, pts) => pts.map(([x, y, z]) => P(x, y, z).map((v) => v.toFixed(1)).join(',')).join(' ');
// a painted line is a thin world-space rectangle (5 cm) so perspective width is true
function lineRect(P, x1, y1, x2, y2, w = 0.05) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), nx = (-dy / L) * w / 2, ny = (dx / L) * w / 2;
  return `<polygon points="${poly(P, [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]])}"/>`;
}

// Court in metres: 23.77 long, doubles 10.97, singles 8.23, service line 6.40 from net. Origin = court centre.
export function courtSvg(P, { lineOpacity = 0.92, net = true, doubles = true } = {}) {
  const L = 23.77 / 2, D = 10.97 / 2, S = 8.23 / 2, SL = 6.4;
  const lines = [
    [-D, -L, D, -L], [-D, L, D, L], [-D, -L, -D, L], [D, -L, D, L],
    [-S, -L, -S, L], [S, -L, S, L], [-S, -SL, S, -SL], [-S, SL, S, SL], [0, -SL, 0, SL], [0, -L, 0, -L + 0.1], [0, L, 0, L - 0.1]
  ].filter((l, i) => doubles || i > 3);
  let s = `<polygon fill="${C.runoff}" points="${poly(P, [[-D - 6.4, -L - 6.4], [D + 6.4, -L - 6.4], [D + 6.4, L + 6.4], [-D - 6.4, L + 6.4]])}"/>`;
  s += `<polygon fill="${C.courtIn}" points="${poly(P, [[-D, -L], [D, -L], [D, L], [-D, L]])}"/>`;
  s += `<g fill="${C.line}" opacity="${lineOpacity}">${lines.map((l) => lineRect(P, ...l)).join('')}</g>`;
  if (net) {
    const top = (x) => (Math.abs(x) <= 0.1 ? 0.914 : 0.914 + (Math.abs(x) / (D + 0.914)) * (1.07 - 0.914));
    const xs = []; for (let x = -D - 0.914; x <= D + 0.914 + 1e-6; x += 0.25) xs.push(x);
    s += `<polygon fill="#041712" opacity="0.55" points="${poly(P, [...xs.map((x) => [x, 0, top(x)]), ...xs.slice().reverse().map((x) => [x, 0, 0])])}"/>`;
    let mesh = '';
    for (let x = -D - 0.914; x <= D + 0.914; x += 0.18) mesh += `<line x1="${P(x, 0, 0)[0].toFixed(1)}" y1="${P(x, 0, 0)[1].toFixed(1)}" x2="${P(x, 0, top(x))[0].toFixed(1)}" y2="${P(x, 0, top(x))[1].toFixed(1)}"/>`;
    s += `<g stroke="${C.line}" stroke-width="0.6" opacity="0.18">${mesh}</g>`;
    s += `<polyline fill="none" stroke="${C.line}" stroke-width="3" opacity="0.9" points="${poly(P, xs.map((x) => [x, 0, top(x)]))}"/>`;
    for (const x of [-D - 0.914, D + 0.914]) s += `<line stroke="#0b2a21" stroke-width="5" x1="${P(x, 0, 0)[0]}" y1="${P(x, 0, 0)[1]}" x2="${P(x, 0, 1.07)[0]}" y2="${P(x, 0, 1.07)[1]}"/>`;
  }
  return s;
}

// faint ball-flight arcs (illustrative texture, not data): parabolas from baseline to far court
export function arcs(P, n, seed = 7) {
  let r = seed; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  let s = '';
  for (let i = 0; i < n; i += 1) {
    const x0 = (rnd() - 0.5) * 8, y0 = -11.5 + rnd() * 1.5, x1 = (rnd() - 0.5) * 9, y1 = 3 + rnd() * 8, h = 1.6 + rnd() * 1.6;
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.05) pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 1 + 4 * h * t * (1 - t)]);
    s += `<polyline points="${poly(P, pts)}"/>`;
    const [bx, by] = P(x1, y1, 0);
    s += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="4" fill="${C.gold}" opacity="0.5" stroke="none"/>`;
  }
  return `<g fill="none" stroke="${C.line}" stroke-width="1.4" stroke-dasharray="2 7" opacity="0.28">${s}</g>`;
}

export const HERO_CAMERA = { camX: -3, camY: -30, camZ: 11, pitch: 0.3, yaw: 0.16, focal: 1.4, cx: 0.69, cy: 0.24 };
export function heroSvg(W, H, cam = HERO_CAMERA) {
  const P = camera({ W, H, ...cam });
  let dots = '';
  for (let x = 40; x < W * 0.5; x += 36) for (let y = 40; y < H; y += 36) dots += `<circle cx="${x}" cy="${y}" r="1.1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="72%" cy="-10%" r="80%"><stop offset="0" stop-color="#2b7a5c" stop-opacity="0.55"/><stop offset="1" stop-color="${C.night}" stop-opacity="0"/></radialGradient>
    <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="${C.night}" stop-opacity="1"/><stop offset="0.3" stop-color="${C.night}" stop-opacity="0.92"/><stop offset="0.55" stop-color="${C.night}" stop-opacity="0.35"/><stop offset="1" stop-color="${C.night}" stop-opacity="0"/></linearGradient>
    <linearGradient id="fadeB" x1="0" y1="0" x2="0" y2="1"><stop offset="0.7" stop-color="${C.night}" stop-opacity="0"/><stop offset="1" stop-color="${C.night}" stop-opacity="0.85"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.night}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <g>${courtSvg(P)}</g>
  ${arcs(P, 9)}
  <rect width="${W}" height="${H}" fill="url(#fadeL)"/>
  <rect width="${W}" height="${H}" fill="url(#fadeB)"/>
  <g fill="${C.line}" opacity="0.07">${dots}</g>
</svg>`;
}

