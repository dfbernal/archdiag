// Try every combination of container directions and keep the layout that reads best on the target
// canvas: biggest on-screen text, then fewest crossings and bends.
const { layoutCompound } = require('./layout-compound');
const { routeEdges } = require('./route');
const { placeLabels } = require('./labels');
const { checkAll } = require('./geom');

function segs(e) { const s = []; for (let i = 0; i < e.points.length - 1; i++) s.push([e.points[i], e.points[i + 1]]); return s; }
function crosses([a, b], [c, d]) {
  const h1 = Math.abs(a.y - b.y) < 0.5, h2 = Math.abs(c.y - d.y) < 0.5;
  if (h1 === h2) return false;
  const [H, V] = h1 ? [[a, b], [c, d]] : [[c, d], [a, b]];
  const x = V[0].x, y = H[0].y;
  return x > Math.min(H[0].x, H[1].x) + 1 && x < Math.max(H[0].x, H[1].x) - 1 && y > Math.min(V[0].y, V[1].y) + 1 && y < Math.max(V[0].y, V[1].y) - 1;
}
function quality(L) {
  let crossings = 0, bends = 0;
  const all = L.edges.map(segs);
  all.forEach((s) => (bends += Math.max(0, s.length - 1)));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
    for (const p of all[i]) for (const q of all[j]) if (crosses(p, q)) crossings++;
  return { crossings, bends };
}

async function fitLayout(diagram, theme, { target = 'slide', overrides = {}, chrome = 0 } = {}) {
  const box = target === 'slide' ? { w: 1800, h: 900 } : { w: 1600, h: 100000 }; // 'doc' = fixed width column
  const ids = Object.keys(diagram.groups || {}).filter((g) => !(diagram.groups[g].direction && diagram.groups[g].locked));
  const dirs = ['right', 'down'];
  const combos = [];
  const n = ids.length + 1;
  for (let m = 0; m < 1 << n; m++) combos.push([dirs[m & 1], ...ids.map((_, i) => dirs[(m >> (i + 1)) & 1])]);
  const results = [];
  for (const [root, ...gd] of combos) {
    const d = JSON.parse(JSON.stringify(diagram));
    ids.forEach((g, i) => (d.groups[g].direction = gd[i]));
    // Make room automatically: if any connector still breaks a rule after routing,
    // widen the gaps and lay out again (what you'd do by hand), up to two more times.
    let L;
    for (const spaceMul of [1, 1.45, 1.9]) {
      L = await layoutCompound(d, theme, { ...overrides, direction: root, spaceMul });
      await routeEdges(L, theme);
      if (!checkAll(L, theme).length) break;
    }
    placeLabels(L, theme);
    const W = L.width + theme.canvasPad * 2, H = L.height + theme.canvasPad * 2 + chrome;
    // Docs: anything that fits the column is full size; don't reward being narrower than needed.
    const fit = target === 'doc' ? Math.min(1, box.w / W) : Math.min(box.w / W, box.h / H);
    const q = { ...quality(L), violations: checkAll(L, theme).length };
    const px = theme.type.node.size * fit;
    let score = px - q.violations * 4 - q.crossings * 1.6 - q.bends * 0.1 - (target === 'doc' ? H / 1000 : 0);
    // Legibility floor: below ~14px on a 1080p slide nobody in the room can read it, whatever else is true.
    if (target === 'slide' && px < 14) score -= (14 - px) * 3;
    if (target === 'text') {   // fit a Slack/terminal width first, then cleanliness, then height
      const cols = L.width / theme.charMode.cw, rows = L.height / theme.charMode.ch;
      score = -Math.max(0, cols - (overrides.maxCols || 100)) * 10 - q.violations * 4 - q.crossings * 3 - q.bends * 0.3 - rows * 0.05;
    }
    results.push({ root, dirs: Object.fromEntries(ids.map((g, i) => [g, gd[i]])), px: +px.toFixed(1), aspect: +(W / H).toFixed(2), ...q, score, L, d });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

module.exports = { fitLayout, quality };
