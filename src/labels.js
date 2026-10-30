// Place edge-label pills centred on their own line, avoiding nodes, groups' headers and each other.
const { textWidth } = require('./measure');
const { titleRow, titleStrip, inflate, segHitsRect } = require('./geom');

function overlaps(a, b, m = 0) {
  return a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
}

function placeLabels(L, theme) {
  const t = theme.type.edgeLabel, E = theme.edge;
  const font = theme.fonts[t.weight] || theme.fonts.regular;
  const taken = Object.values(L.nodes).map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  for (const g of Object.values(L.groups)) taken.push(inflate(titleStrip(g, theme), titleRow(theme).clear)); // zone titles
  // Longest edges first get the best spots.
  const edges = L.edges.filter((e) => e.label).sort((a, b) => pathLen(b.points) - pathLen(a.points));
  for (const e of edges) {
    const w = Math.ceil(textWidth(e.label, t.size, font) + E.labelPadX * 2);
    const h = Math.ceil(t.size * 1.25 + E.labelPadY * 2);
    const cands = [];
    const pts = e.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
      const horiz = Math.abs(a.y - b.y) < 0.5;
      const need = (horiz ? w : h) + 16 * theme.scale;
      if (len < need) continue;
      if (shared(a, b, e, L.edges)) continue; // never label a stretch another line also runs along
      for (const f of [0.5, 0.35, 0.65, 0.25, 0.75]) {
        const cx = a.x + (b.x - a.x) * f, cy = a.y + (b.y - a.y) * f;
        // Prefer long horizontal runs, segment centres, and not the first/last stub.
        const score = len * (horiz ? 1.3 : 1) - Math.abs(f - 0.5) * 200 - (i === 0 || i === pts.length - 2 ? 40 : 0);
        cands.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    // A pill may only sit on its own line: covering another connector (or a crossing) makes it unclear
    // which line it names.
    const others = L.edges.filter((o) => o !== e).flatMap((o) => o.points.slice(0, -1).map((p, i) => [p, o.points[i + 1]]));
    const covered = (c) => others.filter(([p, q]) => segHitsRect(p, q, inflate(c, 3 * theme.scale))).length;
    const free = cands.filter((c) => !taken.some((o) => overlaps(c, o, 4 * theme.scale)));
    // Otherwise the free spot that covers the fewest other lines (stable: keeps the score order on ties).
    let pick = free.map((c, i) => ({ c, i, n: covered(c) })).sort((x, y) => x.n - y.n || x.i - y.i)[0]?.c;
    if (!pick && cands.length) pick = cands[0];
    if (!pick) { const m = pts[Math.floor(pts.length / 2)]; pick = { x: m.x - w / 2, y: m.y - h / 2, w, h }; }
    e.labelBox = { x: pick.x, y: pick.y, w, h, text: e.label };
    taken.push(e.labelBox);
  }
  return L;
}

function shared(a, b, e, edges) {
  const horiz = Math.abs(a.y - b.y) < 0.5;
  return edges.some((o) => o !== e && o.points.some((p, i) => {
    const q = o.points[i + 1]; if (!q) return false;
    if (horiz && Math.abs(p.y - q.y) < 0.5 && Math.abs(p.y - a.y) < 3) return Math.min(p.x, q.x) < Math.max(a.x, b.x) - 2 && Math.max(p.x, q.x) > Math.min(a.x, b.x) + 2;
    if (!horiz && Math.abs(p.x - q.x) < 0.5 && Math.abs(p.x - a.x) < 3) return Math.min(p.y, q.y) < Math.max(a.y, b.y) - 2 && Math.max(p.y, q.y) > Math.min(a.y, b.y) + 2;
    return false;
  }));
}

function pathLen(p) { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return s; }

module.exports = { placeLabels };
