// Shared geometry + the diagram quality checker. Router, renderer and auto-fit all use the same
// rectangles, so "what the checker forbids" is exactly "what you see".
const { textWidth } = require('./measure');

// Zone title row (top of every zone), top to bottom:
//   [margin][title chip][turn lane][first box]
// The lane is tall enough for a connector to run under the title and turn into a box, the way you'd
// draw it in Lucidchart: lines slide in *beside* a title, never through it. Text mode keeps titles on
// the border row (no lane).
function titleRow(theme) {
  const ty = theme.type.group, s = theme.scale, G = theme.group;
  if (theme.charMode) { const buf = theme.route?.buffer ?? theme.charMode.ch / 2;   // one full buffer of clearance (grid cells)
    return { top: G.padTop * 0.45 - ty.size * 0.85, h: ty.size * 1.7, clear: buf, vclear: buf, lane: 0, padTop: G.padTop }; }
  const top = G.titleTop ?? 12 * s, h = ty.size * 1.7;
  const clear = G.titleClear ?? 10 * s;                     // gap a line keeps beside / under a title
  const buf = theme.route?.buffer ?? 30 * s;                // libavoid keeps lines this far from boxes
  const vclear = Math.max(clear, buf - (top + h) / 2);      // see titleObstacle(): tiny strips can't deflate fully
  const lane = vclear + buf + 6 * s;
  return { top, h, clear, vclear, lane, padTop: Math.max(G.padTop, top + h + lane) };
}

// The zone title chip, as drawn by the renderer. side: 'left' | 'right' (set in the YAML; never moved automatically).
function titleRect(g, theme, side = g.titleSide || 'left') {
  const ty = theme.type.group, s = theme.scale, G = theme.group, row = titleRow(theme);
  const isz = ty.size * 1.35;
  const tw = textWidth(g.label, ty.size, theme.fonts[ty.weight]) + (g.icon ? isz + ty.size * 0.5 : 0);
  const w = tw + 16 * s, h = row.h, y = g.y + row.top, cy = y + h / 2;
  const x = side === 'right' ? g.x + g.w - G.padX * 0.5 - tw - 8 * s : g.x + G.padX * 0.5 - 8 * s;
  return { x, y, w, h, textX: x + 8 * s, cy };
}

// The no-go strip for connectors: from the zone border down to the bottom of the title chip, and from
// the zone's corner to the far end of the title (nothing squeezes between a corner and its title).
// Lines cross a zone's top border only on the open side of the title.
function titleStrip(g, theme) {
  const t = titleRect(g, theme), right = (g.titleSide || 'left') === 'right';
  const x0 = right ? t.x : g.x, x1 = right ? g.x + g.w : t.x + t.w;
  return { x: x0, y: g.y, w: x1 - x0, h: t.y + t.h - g.y };
}

const inflate = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
function segHitsRect(a, b, r) {
  const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  return x1 < r.x + r.w && x2 > r.x && y1 < r.y + r.h && y2 > r.y;
}
const ancestorsOf = (L, id) => { const out = []; let g = L.nodes[id]?.group; while (g) { out.push(g); g = L.groups[g]?.parent; } return out; };

// Every rule a person checks by eye. Returns a list of violations for one edge (or all edges).
function checkEdge(L, theme, e, pts = e.points) {
  const s = theme.scale, m = 8 * s, out = [];
  if (!pts || pts.length < 2) return [{ kind: 'unrouted' }];
  const mine = new Set([...ancestorsOf(L, e.source), ...ancestorsOf(L, e.target)]);
  const segs = pts.slice(0, -1).map((a, i) => [a, pts[i + 1]]);
  for (const n of Object.values(L.nodes)) {
    if (n.id === e.source || n.id === e.target) continue;
    if (segs.some(([a, b]) => segHitsRect(a, b, inflate(n, m)))) out.push({ kind: 'node', id: n.id });
  }
  for (const g of Object.values(L.groups)) {
    if (segs.some(([a, b]) => segHitsRect(a, b, inflate(titleStrip(g, theme), 2 * s)))) out.push({ kind: 'title', id: g.id });
    if (!mine.has(g.id)) {
      // A zone this connector has nothing to do with: it must go around, with clearance.
      if (segs.some(([a, b]) => segHitsRect(a, b, inflate(g, m)))) out.push({ kind: 'zone', id: g.id });
    } else {
      // Its own zone: crossing the border is fine, running along it is not.
      for (const [a, b] of segs) {
        const len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 30 * s) continue;
        const vert = Math.abs(a.x - b.x) < 0.5;
        const near = vert ? [g.x, g.x + g.w].some((x) => Math.abs(a.x - x) < m) : [g.y, g.y + g.h].some((y) => Math.abs(a.y - y) < m);
        if (near) { out.push({ kind: 'skim', id: g.id }); break; }
      }
    }
  }
  return out;
}
function checkAll(L, theme) { return L.edges.flatMap((e) => checkEdge(L, theme, e).map((v) => ({ ...v, edge: `${e.source}->${e.target}` }))); }

module.exports = { titleRow, titleRect, titleStrip, checkEdge, checkAll, segHitsRect, inflate, ancestorsOf };
