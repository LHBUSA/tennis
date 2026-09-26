// PropBetEdge court graphic (pure SVG string). The editorial fallback when no licensed photo fits a story,
// and the background of its social card. It is plainly artwork — flat perspective court in the event's
// surface colour, the two sides at opposite baselines, the score at the net, a set-by-set strip — and it is
// labelled as a graphic. Every value drawn comes from the caller (the story's frozen evidence).

const SURF = {
  hard: { field: '#255f9f', court: '#2f74bf', band: '#163e6c', glow: '#5fa0e8' },
  clay: { field: '#9e4a22', court: '#c4622d', band: '#6f3417', glow: '#e9925c' },
  grass: { field: '#3f7a31', court: '#4f9140', band: '#2a5321', glow: '#8cc46f' },
  carpet: { field: '#2d5a4a', court: '#3b7560', band: '#1d3d32', glow: '#78b89e' }
};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// perspective: v = 0 far baseline .. 1 near baseline; u = 0 .. 1 across the doubles court
function projector({ W, H }) {
  const far = { y: H * 0.3, half: W * 0.2 };
  const near = { y: H * 0.93, half: W * 0.42 };
  const f = (v) => (v * 1.7) / (1 + 0.7 * v); // foreshortening: the far half is compressed
  return (u, v) => { const t = f(v); const y = far.y + (near.y - far.y) * t; const half = far.half + (near.half - far.half) * t; return [W / 2 + (u - 0.5) * 2 * half, y]; };
}

export function courtVisualSvg({ surface = 'hard', indoor = false, top = [], bottom = [], winner = 'bottom', sets = [], tournament = '', round = '', kicker = '', width = 1600, height = 900, label = true, text = true } = {}) {
  const W = width; const H = height;
  const c = SURF[surface] || SURF.hard;
  const P = projector({ W, H });
  const line = (u1, v1, u2, v2, w = 3) => { const [x1, y1] = P(u1, v1); const [x2, y2] = P(u2, v2); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fff" stroke-opacity="0.92" stroke-width="${w}" stroke-linecap="round"/>`; };
  const poly = (pts, fill, extra = '') => `<polygon points="${pts.map(([u, v]) => P(u, v).map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="${fill}" ${extra}/>`;
  const alley = 1.37 / 10.97; const svc = 0.5 - 6.4 / 23.77; const svc2 = 0.5 + 6.4 / 23.77;
  const court = [
    poly([[-0.14, -0.1], [1.14, -0.1], [1.14, 1.07], [-0.14, 1.07]], c.field),
    poly([[0, 0], [1, 0], [1, 1], [0, 1]], c.court),
    line(0, 0, 1, 0), line(0, 1, 1, 1), line(0, 0, 0, 1), line(1, 0, 1, 1),
    line(alley, 0, alley, 1, 2.5), line(1 - alley, 0, 1 - alley, 1, 2.5),
    line(alley, svc, 1 - alley, svc, 2.5), line(alley, svc2, 1 - alley, svc2, 2.5), line(0.5, svc, 0.5, svc2, 2.5),
    line(0.5, 0, 0.5, 0.012, 3), line(0.5, 1, 0.5, 0.988, 3)
  ].join('');
  // net: posts + mesh band at v = 0.5
  const [nlx, nly] = P(-0.04, 0.5); const [nrx] = P(1.04, 0.5);
  const netH = H * 0.045;
  const net = `<rect x="${nlx.toFixed(1)}" y="${(nly - netH).toFixed(1)}" width="${(nrx - nlx).toFixed(1)}" height="${netH.toFixed(1)}" fill="#0b1a14" fill-opacity="0.55"/><line x1="${nlx.toFixed(1)}" y1="${(nly - netH).toFixed(1)}" x2="${nrx.toFixed(1)}" y2="${(nly - netH).toFixed(1)}" stroke="#fff" stroke-width="4"/>`;
  const sky = indoor
    ? `<radialGradient id="cvl" cx="50%" cy="0%" r="75%"><stop offset="0" stop-color="${c.glow}" stop-opacity="0.35"/><stop offset="1" stop-color="#050d0a" stop-opacity="0"/></radialGradient>`
    : `<linearGradient id="cvl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.glow}" stop-opacity="0.28"/><stop offset="1" stop-color="#050d0a" stop-opacity="0"/></linearGradient>`;
  // tiered stands behind the far baseline (graphic rows, not a photograph)
  const [, standBase] = P(0.5, -0.1);
  const rows = Array.from({ length: 7 }, (_, i) => { const y = standBase - 14 - i * 16; const inset = W * (0.26 - i * 0.022); return `<rect x="${inset.toFixed(1)}" y="${y.toFixed(1)}" width="${(W - 2 * inset).toFixed(1)}" height="9" rx="3" fill="#f3f6f1" fill-opacity="${(0.07 - i * 0.007).toFixed(3)}"/>`; }).join('');
  const stands = `<rect x="0" y="0" width="${W}" height="${standBase.toFixed(1)}" fill="#06120e" fill-opacity="0.35"/>${rows}`;
  const names = (arr) => arr.map((p) => String(p).toUpperCase()).join(' / ');
  const fs = (s, max, base) => Math.max(26, Math.min(base, Math.floor(max / Math.max(1, s.length * 0.52))));
  const topS = names(top); const botS = names(bottom);
  const [, farY] = P(0.5, 0); const [, nearY] = P(0.5, 1);
  const tFs = fs(topS, W * 0.62, 44); const bFs = fs(botS, W * 0.7, 64);
  const plateW = Math.min(W * 0.46, 120 + sets.length * 110); const plateH = 118; const plateX = (W - plateW) / 2; const plateY = nly - netH - plateH - 18;
  const setCells = sets.map((s, i) => { const x = plateX + 60 + i * ((plateW - 90) / Math.max(1, sets.length)); const wB = winner === 'bottom'; const topG = wB ? s.l : s.w; const botG = wB ? s.w : s.l; return `<text x="${x.toFixed(1)}" y="${plateY + 50}" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="40" fill="#f3f6f1" fill-opacity="${wB ? 0.6 : 1}">${esc(topG)}</text><text x="${x.toFixed(1)}" y="${plateY + 98}" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="40" fill="${wB ? '#d9b44a' : '#f3f6f1'}">${esc(botG)}</text>`; }).join('');
  const plate = sets.length ? `<rect x="${plateX.toFixed(1)}" y="${plateY}" width="${plateW.toFixed(1)}" height="${plateH}" rx="14" fill="#06140f" fill-opacity="0.82" stroke="#d9b44a" stroke-opacity="0.6"/><text x="${plateX + 22}" y="${plateY + 50}" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="22" fill="#c9d6cf" letter-spacing="3">${winner === 'bottom' ? '' : 'W'}</text><text x="${plateX + 22}" y="${plateY + 98}" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="22" fill="#d9b44a" letter-spacing="3">${winner === 'bottom' ? 'W' : ''}</text>${setCells}` : '';
  const txt = text ? `
    ${kicker ? `<text x="${W / 2}" y="${H * 0.075}" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="${Math.round(H * 0.03)}" letter-spacing="6" fill="#d9b44a">${esc(kicker.toUpperCase())}</text>` : ''}
    ${tournament || round ? `<text x="${W / 2}" y="${H * 0.13}" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="${Math.round(H * 0.036)}" letter-spacing="4" fill="#f3f6f1" fill-opacity="0.85">${esc([tournament, round].filter(Boolean).join(' · ').toUpperCase())}</text>` : ''}
    <text x="${W / 2}" y="${(farY - 18).toFixed(1)}" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="${tFs}" fill="#f3f6f1" fill-opacity="${winner === 'bottom' ? 0.72 : 1}">${esc(topS)}</text>
    <rect x="${(W / 2 - Math.min(W * 0.4, botS.length * bFs * 0.3 + 40)).toFixed(1)}" y="${(nearY - bFs * 1.05 - 20).toFixed(1)}" width="${(2 * Math.min(W * 0.4, botS.length * bFs * 0.3 + 40)).toFixed(1)}" height="${(bFs * 1.25).toFixed(1)}" rx="10" fill="#06140f" fill-opacity="0.55"/>
    <text x="${W / 2}" y="${(nearY - 30).toFixed(1)}" text-anchor="middle" font-family="Barlow Condensed, sans-serif" font-weight="800" font-size="${bFs}" fill="${winner === 'bottom' ? '#d9b44a' : '#f3f6f1'}">${esc(botS)}</text>
    ${plate}` : '';
  const tag = label ? `<text x="${W - 24}" y="${H - 20}" text-anchor="end" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="${Math.round(H * 0.022)}" letter-spacing="3" fill="#f3f6f1" fill-opacity="0.55">PROPBETEDGE COURT GRAPHIC · ${esc(`${surface}${indoor ? ' · indoor' : ''}`.toUpperCase())}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(`Court graphic: ${botS} ${winner === 'bottom' ? 'def.' : 'vs'} ${topS}${tournament ? `, ${tournament}` : ''}`)}">
  <defs>${sky}<linearGradient id="cvs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.22"/></linearGradient><radialGradient id="cvv" cx="50%" cy="55%" r="75%"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient><linearGradient id="cvb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050d0a"/><stop offset="0.55" stop-color="${c.band}"/><stop offset="1" stop-color="#050d0a"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#cvb)"/>${stands}${court}<polygon points="${[[-0.14, -0.1], [1.14, -0.1], [1.14, 1.07], [-0.14, 1.07]].map(([u, v]) => P(u, v).map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="url(#cvs)"/>${net}<rect width="${W}" height="${H}" fill="url(#cvl)"/><rect width="${W}" height="${H}" fill="url(#cvv)"/>${txt}${tag}</svg>`;
}

/** Court graphic inputs from a story's frozen evidence: winners at the near baseline. */
export function courtFromStory(a) {
  const sb = (a.plan?.modules || []).find((m) => m.id === 'scoreboard')?.data;
  const parts = a.evidence?.participants;
  const t = a.evidence?.tournament || a.tournament || {};
  if (!sb || !parts || !sb.winner_side) return null;
  const W = sb.winner_side; const L = W === 'A' ? 'B' : 'A';
  const last = (p) => p.last_name || String(p.name || '').split(' ').slice(-1)[0];
  // shared surnames on one side (sisters, namesakes) get an initial so the two players stay distinct
  const label = (ps) => { const ls = ps.map(last); return ps.map((p, i) => (ls.filter((x) => x === ls[i]).length > 1 ? `${String(p.name || '').trim()[0]}. ${ls[i]}` : ls[i])); };
  const sets = (sb.sets || []).map((s) => (s.match_tiebreak && s.tb ? { w: `[${s.tb[W]}]`, l: `[${s.tb[L]}]` } : { w: String(s[W]), l: String(s[L]) }));
  const round = a.evidence?.match?.round_label ? String(a.evidence.match.round_label).replace(/^\w/, (x) => x.toUpperCase()) : '';
  return { surface: t.surface || 'hard', indoor: !!t.indoor, top: label(parts[L]?.players || []), bottom: label(parts[W]?.players || []), winner: 'bottom', sets, tournament: t.name ? `${t.name}${t.year ? ` ${t.year}` : ''}` : '', round };
}
