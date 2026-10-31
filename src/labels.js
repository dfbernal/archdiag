// Place edge-label pills centred on their own line.
//
// Never: on a box, a zone title, another label (with room to spare) or any arrowhead.
// Worst after that: on or across a zone's border. Then: inside a zone the line only passes through
// (one that doesn't hold both its ends). Then: covering other lines (a line passing behind a pill is
// readable; an arrowhead isn't). Among what's left: long horizontal runs, near the middle of a segment.
// The most constrained labels are placed first, so a label with few good spots isn't crowded out by one
// that could have gone almost anywhere.
const { textWidth } = require('./measure');
const { titleRow, titleStrip, inflate, segHitsRect } = require('./geom');

function overlaps(a, b, m = 0) {
  return a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
}
const within = (c, g) => c.x >= g.x && c.y >= g.y && c.x + c.w <= g.x + g.w && c.y + c.h <= g.y + g.h;

function placeLabels(L, theme) {
  const t = theme.type.edgeLabel, E = theme.edge, s = theme.scale;
  const font = theme.fonts[t.weight] || theme.fonts.regular;
  const fixed = Object.values(L.nodes).map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  for (const g of Object.values(L.groups)) fixed.push(inflate(titleStrip(g, theme), titleRow(theme).clear)); // zone titles
  // Every arrowhead, as a square around its tip.
  const al = E.arrow * 1.25 + 6 * s;   // tip square plus clearance, so a pill never crowds an arrowhead
  for (const e of L.edges) {
    const P = e.points; if (!P || P.length < 2) continue;
    if (e.arrow !== 'back' && e.arrow !== 'none') fixed.push({ x: P[P.length - 1].x - al, y: P[P.length - 1].y - al, w: 2 * al, h: 2 * al });
    if (e.arrow === 'back' || e.arrow === 'both') fixed.push({ x: P[0].x - al, y: P[0].y - al, w: 2 * al, h: 2 * al });
  }
  const placed = [];

  // Every spot along a label's own line, with what it costs apart from other labels.
  const spotsFor = (e) => {
    const w = Math.ceil(textWidth(e.label, t.size, font) + E.labelPadX * 2), h = Math.ceil(t.size * 1.25 + E.labelPadY * 2);
    const P = e.points, step = 8 * s, spots = [];
    const others = L.edges.filter((o) => o !== e).flatMap((o) => o.points.slice(0, -1).map((p, i) => [p, o.points[i + 1]]));
    const own = (g) => [e.source, e.target].every((id) => L.nodes[id] && within(L.nodes[id], g));
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y), horiz = Math.abs(a.y - b.y) < 0.5;
      const half = (horiz ? w : h) / 2 + 8 * s;     // keep the pill inside the segment, off its corners
      if (len < half * 2 || shared(a, b, e, L.edges)) continue;   // never on a stretch another line runs along
      for (let d = half; d <= len - half + 0.01; d += step) {
        const f = d / len, c = { x: a.x + (b.x - a.x) * f - w / 2, y: a.y + (b.y - a.y) * f - h / 2, w, h };
        if (fixed.some((o) => overlaps(c, o, 4 * s))) continue;
        const borders = Object.values(L.groups).filter((g) => overlaps(c, g) && !within(c, g)).length;
        const inside = Object.values(L.groups).filter((g) => !own(g) && overlaps(c, g)).length;
        const covered = others.filter(([p, q]) => segHitsRect(p, q, inflate(c, 3 * s))).length;
        const score = len * (horiz ? 1.3 : 1) - Math.abs(f - 0.5) * 200 - (i === 0 || i === P.length - 2 ? 40 : 0);
        const pen = borders * 400 + inside * 150 + covered * 120;
        spots.push({ c, pen, cost: pen - score });
      }
    }
    spots.sort((x, y) => x.cost - y.cost);
    return { w, h, spots };
  };

  const todo = L.edges.filter((e) => e.label).map((e) => ({ e, ...spotsFor(e) }));
  // Fewest good spots (no zone border, no other line covered) first; ties: longest line first.
  const good = (x) => x.spots.filter((p) => p.pen === 0).length;
  todo.sort((a, b) => good(a) - good(b) || pathLen(b.e.points) - pathLen(a.e.points));
  for (const { e, w, h, spots } of todo) {
    const clash = (c) => placed.some((o) => overlaps(c, o, 12 * s));
    let pick = spots.find((p) => !clash(p.c))?.c;
    if (process.env.ARCHDIAG_DEBUG) console.error('[label]', e.label, `${spots.length} spots`, JSON.stringify(spots.slice(0, 3).map((p) =>
      ({ at: [Math.round(p.c.x), Math.round(p.c.y)], pen: p.pen, cost: Math.round(p.cost), clash: clash(p.c) }))));
    // Nowhere free: the spot overlapping other labels least, still by cost.
    if (!pick && spots.length) pick = spots.map((p) => ({ c: p.c, n: placed.filter((o) => overlaps(p.c, o, 12 * s)).length }))
      .sort((x, y) => x.n - y.n)[0].c;
    if (!pick) { const m = e.points[Math.floor(e.points.length / 2)]; pick = { x: m.x - w / 2, y: m.y - h / 2, w, h }; }
    e.labelBox = { x: pick.x, y: pick.y, w, h, text: e.label };
    placed.push(e.labelBox);
  }
  return require('./geom').fitCanvas(L);   // nothing drawn may fall outside the canvas
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
