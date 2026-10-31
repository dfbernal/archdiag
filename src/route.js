// Obstacle-avoiding orthogonal connector routing with libavoid (the Adaptagrams router
// used by Inkscape and Dunnart): the same idea as Lucidchart/Visio "smart connectors".
const path = require('path');
const { titleRow, titleStrip, checkEdge, checkAll, ancestorsOf } = require('./geom');
let A = null;
async function lib() {
  if (A) return A;
  // Our patched libavoid-js build lives in vendor/ (see vendor/libavoid-js/PATCHED.md), loaded by path so
  // archdiag installs the same way from git, a folder or a registry.
  const dist = path.join(__dirname, '..', 'vendor', 'libavoid-js', 'dist');
  const { AvoidLib } = await import(require('url').pathToFileURL(path.join(dist, 'index-node.mjs')).href);
  await AvoidLib.load(path.join(dist, 'libavoid.wasm'));
  A = AvoidLib.getInstance();
  return A;
}

const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8;
const FWD = { RIGHT: 'R', LEFT: 'L', DOWN: 'B', UP: 'T' };
const OPP = { R: 'L', L: 'R', T: 'B', B: 'T' };
const pinClass = (flow, role) => 1 + Object.keys(FWD).indexOf(flow) * 2 + (role === 'in' ? 1 : 0);

function addNode(Av, r, n, withPins, theme) {
  const sh = new Av.ShapeRef(r, new Av.Rectangle(new Av.Point(n.x, n.y), new Av.Point(n.x + n.w, n.y + n.h)));
  if (!withPins) return sh;
  // Pins on every side, in separate classes per (flow direction, role), so a connector prefers
  // to leave a box on the side facing the flow and enter on the opposite side.
  const fr = [0.5, 0.3, 0.7, 0.18, 0.82];
  const sides = [['T', UP], ['B', DOWN], ['L', LEFT], ['R', RIGHT]];
  const pos = (side, f) => ({ T: [f, 0], B: [f, 1], L: [0, f], R: [1, f] }[side]);
  for (const [flow, fwd] of Object.entries(FWD)) {
    for (const role of ['out', 'in']) {
      const best = role === 'out' ? fwd : OPP[fwd];
      for (const [side, dirFlag] of sides) {
        // Leaving a box: off side 1600, opposite 4000. Entering a box: much milder, so a line would rather
        // come in from the side than cross another line (crossingPenalty 400). libavoid only applied pin
        // costs at the source end until our makepath.cpp fix, so these entry costs are new in effect.
        const [offC, oppC] = role === 'out' ? [1600, 4000] : (theme.route?.inSideCosts ?? [250, 600]);
        const sideCost = side === best ? 0 : side === OPP[best] ? oppC : offC;
        for (const f of fr) {
          // libavoid merges coincident pins, so nudge each class by a sub-pixel amount along the side.
          const cls = pinClass(flow, role), along = f + (cls - 1) * (0.6 / Math.max(n.w, n.h));
          const [x, y] = pos(side, along);
          const pin = new Av.ShapeConnectionPin(sh, cls, x, y, true, 0, dirFlag);
          pin.setExclusive(true);
          pin.setConnectionCost(sideCost + (f === 0.5 ? 0 : 6));
        }
      }
    }
  }
  return sh;
}

// Spacing between parallel lines: at least one label pill's height plus a margin, so two labelled lines that
// run side by side each have room for their label (with the old 14px, neighbouring labels had to overlap).
const nudgeOf = (theme, opts) => opts.nudge ?? theme.route?.nudge ??
  Math.max(14 * theme.scale, theme.type.edgeLabel.size * 1.25 + theme.edge.labelPadY * 2 + 6 * theme.scale);
const bufferOf = (theme, opts) => opts.buffer ?? theme.route?.buffer ?? 30 * theme.scale;
function configure(Av, r, theme, opts) {
  const P = Av.RoutingParameter, O = Av.RoutingOption, s = theme.scale;
  r.setRoutingParameter(P.shapeBufferDistance, bufferOf(theme, opts));
  r.setRoutingParameter(P.idealNudgingDistance, nudgeOf(theme, opts));
  r.setRoutingParameter(P.segmentPenalty, opts.segmentPenalty ?? theme.route?.segmentPenalty ?? 60);
  r.setRoutingParameter(P.crossingPenalty, opts.crossingPenalty ?? 400);
  r.setRoutingParameter(P.reverseDirectionPenalty, 400);
  r.setRoutingParameter(P.fixedSharedPathPenalty, opts.sharedPenalty ?? 2000);
  r.setRoutingOption(O.nudgeOrthogonalSegmentsConnectedToShapes, true);
  r.setRoutingOption(O.nudgeSharedPathsWithCommonEndPoint, true);
  r.setRoutingOption(O.penaliseOrthogonalSharedPathsAtConnEnds, true);
  // Cost per crossing of a zone boundary (libavoid ClusterRef). Leaving your own zone costs the same on
  // every path, so in practice this only steers lines around zones they have nothing to do with.
  r.setRoutingParameter(P.clusterCrossingPenalty, opts.clusterPenalty ?? theme.route?.clusterPenalty ?? 4000);
}

const box = (Av, b) => new Av.Rectangle(new Av.Point(b.x, b.y), new Av.Point(b.x + b.w, b.y + b.h));
const rect = (Av, r, b) => new Av.ShapeRef(r, box(Av, b));
// A zone title as a hard obstacle. libavoid pads every obstacle by the global shape buffer (30px), which
// would keep lines far from a title; deflate the strip so the padded result is the title's own clearance
// and a line can run right beside it.
function titleObstacle(Av, r, g, theme, buf) {
  const t = titleStrip(g, theme), c = titleRow(theme).clear, d = buf - c;
  let x = t.x + d, y = t.y - c + buf, w = t.w - 2 * d, h = t.h + c - buf - d;   // top reaches c above the border
  if (w < 1) { x += w / 2 - 0.5; w = 1; }
  if (h < 1) { y += h / 2 - 0.5; h = 1; }
  return rect(Av, r, { x, y, w, h });
}
const readRoute = (c) => { const pl = c.displayRoute(), pts = []; for (let i = 0; i < pl.size(); i++) { const q = pl.at(i); pts.push({ x: q.x, y: q.y }); } return pts; };

// Zones. 'obstacle' (default): zones as solid shapes (libavoid ignores a shape for connectors with an
// endpoint inside it); routeOne() only adds the zones a connector has nothing to do with.
// 'cluster': every zone is a libavoid ClusterRef, i.e. a boundary that costs clusterCrossingPenalty each
// time a line crosses it. Measured on checkout.yaml (2026-10-30, with the pin-cost fix): clusters gave
// more rule breaks before repair (20 vs 12-14), no better winners, and ~25x slower routing (libavoid
// re-walks the path for every cluster at every A* step), so they're opt-in. `skip` = obstacle mode only.
function addZones(Av, r, L, opts, skip = new Set()) {
  const mode = opts.zones ?? 'obstacle';
  for (const g of Object.values(L.groups)) {
    if (mode === 'cluster') new Av.ClusterRef(r, box(Av, g));
    else if (mode === 'obstacle' && !skip.has(g.id)) rect(Av, r, g);
  }
}

// Re-route one connector in a private router whose obstacles are exactly what *this* connector must
// avoid: every other box, every zone it has nothing to do with, and every zone title.
async function routeOne(L, theme, e, opts = {}) {
  opts = { ...opts, zones: opts.zones ?? theme.route?.zones ?? 'obstacle' };
  const Av = await lib();
  const r = new Av.Router(Av.RouterFlag.OrthogonalRouting.value);
  configure(Av, r, theme, opts);
  const shapes = {};
  for (const n of Object.values(L.nodes)) shapes[n.id] = addNode(Av, r, n, n.id === e.source || n.id === e.target, theme);
  const mine = new Set([...ancestorsOf(L, e.source), ...ancestorsOf(L, e.target)]);
  addZones(Av, r, L, opts, mine);
  for (const g of Object.values(L.groups)) titleObstacle(Av, r, g, theme, bufferOf(theme, opts));
  const c = new Av.ConnRef(r, new Av.ConnEnd(shapes[e.source], pinClass(e.flow || 'RIGHT', 'out')), new Av.ConnEnd(shapes[e.target], pinClass(e.flow || 'RIGHT', 'in')));
  r.processTransaction();
  const pts = readRoute(c);
  r.delete(); // frees its shapes, connectors and visibility graph (wasm heap is capped at 2 GB)
  return pts;
}

async function routeEdges(L, theme, opts = {}) {
  opts = { ...opts, zones: opts.zones ?? theme.route?.zones ?? (opts.zoneObstacles === false ? 'none' : 'obstacle') };
  const Av = await lib();
  const r = new Av.Router(Av.RouterFlag.OrthogonalRouting.value);
  configure(Av, r, theme, opts);   // fewer bends, avoid crossings, separate lines (no shared trunks)

  const shapes = {};
  for (const n of Object.values(L.nodes)) shapes[n.id] = addNode(Av, r, n, true, theme);
  // Zones go around unless the connector has an endpoint inside (see addZones).
  addZones(Av, r, L, opts);
  // Zone titles are hard obstacles; lines enter a zone beside its title.
  for (const g of Object.values(L.groups)) titleObstacle(Av, r, g, theme, bufferOf(theme, opts));
  const conns = [];
  for (const e of L.edges) {
    const c = new Av.ConnRef(r, new Av.ConnEnd(shapes[e.source], pinClass(e.flow || 'RIGHT', 'out')), new Av.ConnEnd(shapes[e.target], pinClass(e.flow || 'RIGHT', 'in')));
    c.setHateCrossings(true);
    conns.push([e, c]);
  }
  r.processTransaction();
  for (const [e, c] of conns) {
    e.points = readRoute(c);
    e.labelBox = null; // labels are re-placed on the new routes
  }
  r.delete(); // free the wasm-side router; auto-fit builds ~100 of these per run
  L.stats = { ...(L.stats || {}), firstPass: checkAll(L, theme).length };
  if (process.env.ARCHDIAG_DEBUG) for (const e of L.edges) console.error('[route]', e.source + '->' + e.target, JSON.stringify(e.points.map((p) => [Math.round(p.x), Math.round(p.y)])), JSON.stringify(checkEdge(L, theme, e)));
  straighten(L, theme);
  await repair(L, theme, opts);
  if (opts.spread !== false && theme.route?.spread !== false) spreadBundles(L, theme);
  if (opts.untangle !== false && theme.route?.untangle !== false) untangleEnds(L, theme);
  return L;
}

// Quality gate: check every connector against the rules, re-route the ones that fail on their own,
// and separate lines that ended up on top of each other. Titles never move.
async function repair(L, theme, opts) {
  for (const e of L.edges) {
    const bad = checkEdge(L, theme, e);
    if (!bad.length) continue;
    L.stats = { ...(L.stats || {}), rerouted: (L.stats?.rerouted || 0) + 1 };
    if (process.env.ARCHDIAG_DEBUG) console.error('[repair]', e.source + '->' + e.target, JSON.stringify(bad));
    // A line hugging its own box usually needs a nudge, not a new route: push the hugging segment away.
    const nudged = bad.every((v) => v.kind === 'hug') && unhug(L, theme, e, bad.length);
    if (nudged) { e.points = nudged; continue; }
    for (const buffer of [opts.buffer ?? theme.route?.buffer ?? 30 * theme.scale, 16 * theme.scale]) {
      const pts = await routeOne(L, theme, e, { ...opts, buffer });
      if (pts.length >= 2 && checkEdge(L, theme, e, pts).length < bad.length) { e.points = pts; break; }
    }
  }
  separate(L, theme);
}

// Move each inner segment that runs along one of the edge's own boxes out to a clear distance. Returns the
// new points if that fixes every rule break without adding crossings, else null.
function unhug(L, theme, e, nBad) {
  const s = theme.scale, P = e.points.map((p) => ({ ...p })), crossBefore = countCrossings(L.edges.map((x) => x.points));
  for (const id of [e.source, e.target]) {
    const n = L.nodes[id];
    for (let i = 1; i + 2 < P.length; i++) {
      const a = P[i], b = P[i + 1], vert = Math.abs(a.x - b.x) < 0.5;
      const [c, e0, e1] = vert ? [a.x, n.x, n.x + n.w] : [a.y, n.y, n.y + n.h];
      const k = vert ? 'x' : 'y', lo = Math.min(a[vert ? 'y' : 'x'], b[vert ? 'y' : 'x']), hi = Math.max(a[vert ? 'y' : 'x'], b[vert ? 'y' : 'x']);
      const [s0, s1] = vert ? [n.y, n.y + n.h] : [n.x, n.x + n.w];
      if (Math.min(hi, s1) - Math.max(lo, s0) <= 14 * s) continue;
      const out = Math.abs(c - e1) < 14 * s ? 1 : Math.abs(c - e0) < 14 * s ? -1 : 0; if (!out) continue;
      for (const d of [16, 24, 32, 44].map((v) => v * s)) {
        const target = (out > 0 ? e1 : e0) + out * d, cand = P.map((p) => ({ ...p }));
        cand[i][k] = target; cand[i + 1][k] = target;
        if (checkEdge(L, theme, e, cand).filter((v) => !(v.kind === 'hug' && v.id === id)).length > 0) continue;
        P[i][k] = target; P[i + 1][k] = target; break;
      }
    }
  }
  if (checkEdge(L, theme, e, P).length) return null;
  const crossAfter = countCrossings(L.edges.map((x) => (x === e ? P : x.points)));
  return crossAfter <= crossBefore ? P : null;
}

// Pull apart collinear overlapping segments that belong to different connectors (private re-routes
// don't know about each other). Only inner segments move, so endpoints stay on their pins.
function separate(L, theme) {
  const gap = 12 * theme.scale;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < L.edges.length; i++) for (let j = i + 1; j < L.edges.length; j++) {
      const A = L.edges[i], B = L.edges[j];
      for (let k = 1; k < B.points.length - 2; k++) {
        const p = B.points[k], q = B.points[k + 1], vert = Math.abs(p.x - q.x) < 0.5;
        const clash = A.points.slice(0, -1).some((a, t) => {
          const b = A.points[t + 1];
          if (vert && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.x - p.x) < gap * 0.6) return Math.min(a.y, b.y) < Math.max(p.y, q.y) - 2 && Math.max(a.y, b.y) > Math.min(p.y, q.y) + 2;
          if (!vert && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.y - p.y) < gap * 0.6) return Math.min(a.x, b.x) < Math.max(p.x, q.x) - 2 && Math.max(a.x, b.x) > Math.min(p.x, q.x) + 2;
          return false;
        });
        if (!clash) continue;
        const before = checkEdge(L, theme, B).length;
        for (const d of [gap, -gap, 2 * gap, -2 * gap]) {
          const cand = B.points.map((x) => ({ ...x }));
          if (vert) { cand[k].x += d; cand[k + 1].x += d; } else { cand[k].y += d; cand[k + 1].y += d; }
          if (checkEdge(L, theme, B, cand).length <= before) { B.points = cand; moved = true; break; }
        }
      }
    }
    if (!moved) break;
  }
}

// Replace small doglegs with a straight run when the two boxes overlap enough to allow it,
// the way a person would nudge a connector in Lucidchart.
function straighten(L, theme) {
  const m = 12 * theme.scale, buf = 6 * theme.scale;
  const nodes = Object.values(L.nodes);
  const blocks = [...nodes, ...Object.values(L.groups).map((g) => ({ id: '#title:' + g.id, ...titleStrip(g, theme) }))];
  const hits = (x1, y1, x2, y2, skip) => blocks.some((n) => !skip.includes(n.id) &&
    Math.min(x1, x2) < n.x + n.w + buf && Math.max(x1, x2) > n.x - buf && Math.min(y1, y2) < n.y + n.h + buf && Math.max(y1, y2) > n.y - buf);
  for (const e of L.edges) {
    if (e.points.length <= 2) continue;
    const s = L.nodes[e.source], t = L.nodes[e.target];
    const skip = [s.id, t.id];
    const lo = Math.max(s.y, t.y) + m, hi = Math.min(s.y + s.h, t.y + t.h) - m;
    const loX = Math.max(s.x, t.x) + m, hiX = Math.min(s.x + s.w, t.x + t.w) - m;
    let pts = null;
    if (lo <= hi && (s.x + s.w < t.x || t.x + t.w < s.x)) {
      const prefer = Math.min(Math.max(s.y + s.h / 2, lo), hi), y = Math.abs((t.y + t.h / 2) - prefer) < Math.abs((s.y + s.h / 2) - prefer) ? prefer : prefer;
      const fwd = s.x + s.w < t.x, x1 = fwd ? s.x + s.w : s.x, x2 = fwd ? t.x : t.x + t.w;
      if (!hits(x1, y, x2, y, skip)) pts = [{ x: x1, y }, { x: x2, y }];
    } else if (loX <= hiX && (s.y + s.h < t.y || t.y + t.h < s.y)) {
      const x = Math.min(Math.max(s.x + s.w / 2, loX), hiX);
      const fwd = s.y + s.h < t.y, y1 = fwd ? s.y + s.h : s.y, y2 = fwd ? t.y : t.y + t.h;
      if (!hits(x, y1, x, y2, skip)) pts = [{ x, y: y1 }, { x, y: y2 }];
    }
    // Don't land on a point another connector already uses at either end.
    const clash = (p) => L.edges.some((o) => o !== e && o.points.length && [o.points[0], o.points[o.points.length - 1]].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 14 * theme.scale));
    if (pts && !clash(pts[0]) && !clash(pts[1])) e.points = pts;
  }
}

// Break up "buses". libavoid packs every line that runs through the same gap at the minimum nudge
// spacing, so a few connectors travel together like a motherboard bus and their crossings happen inside
// the bundle, where you can't tell which line goes where. Spread each bundle across the free gap, one
// lane per line, in the order with the fewest crossings. Only the bundle's middle segments move, so every
// endpoint stays on its pin; a change is kept only if no connector breaks more rules than before.
function spreadBundles(L, theme) {
  if (theme.charMode) return;                       // the character grid has no room for lanes
  const s = theme.scale, nudge = nudgeOf(theme, {});
  const near = nudge * 2.5, clear = theme.route?.buffer ?? 30 * s, m = 12 * s;
  const laneMax = theme.route?.laneMax ?? 110 * s;  // widest lane spacing: spread out, not scattered
  for (const a of ['x', 'y']) {                      // a = the coordinate that is constant along the segment
    const b = a === 'x' ? 'y' : 'x', len = (o) => (a === 'x' ? o.w : o.h), span = (o) => (a === 'x' ? o.h : o.w);
    const segs = [];
    for (const e of L.edges) for (let k = 1; k + 2 < e.points.length; k++) {
      const P = e.points, c = P[k][a];
      if (Math.abs(P[k + 1][a] - c) > 0.5) continue;
      const lo = Math.min(P[k][b], P[k + 1][b]), hi = Math.max(P[k][b], P[k + 1][b]);
      if (hi - lo < 2 * near) continue;
      // Where this segment may move without its neighbouring segments reversing.
      const p = P[k - 1][a], q = P[k + 2][a];
      const range = (p - c) * (q - c) < 0 ? [Math.min(p, q) + m, Math.max(p, q) - m]
        : p < c && q < c ? [Math.max(p, q) + m, Infinity] : [-Infinity, Math.min(p, q) - m];
      segs.push({ e, k, c, lo, hi, range });
    }
    // Bundles: segments of different connectors that run side by side.
    const parent = segs.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i], B = segs[j];
      if (A.e !== B.e && Math.abs(A.c - B.c) <= near && Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo) > near) parent[find(i)] = find(j);
    }
    const groups = {};
    segs.forEach((sg, i) => (groups[find(i)] = groups[find(i)] || []).push(sg));
    for (const G of Object.values(groups)) {
      if (G.length < 2 || G.length > 6 || new Set(G.map((g) => g.e)).size < 2) continue;
      G.sort((x, y) => x.c - y.c);
      const lo = Math.min(...G.map((g) => g.lo)), hi = Math.max(...G.map((g) => g.hi));
      const cMin = G[0].c, cMax = G[G.length - 1].c;
      // The free gap: nearest boxes, zones, titles and other lines on either side, over the bundle's extent.
      let left = -Infinity, right = Infinity;
      const wall = (pos, size, along, alongSize, gap) => {
        if (along + alongSize <= lo || along >= hi) return;
        if (pos + size <= cMin) left = Math.max(left, pos + size + gap);
        else if (pos >= cMax) right = Math.min(right, pos - gap);
      };
      for (const n of Object.values(L.nodes)) wall(n[a], len(n), n[b], span(n), clear);
      for (const g of Object.values(L.groups)) { wall(g[a], len(g), g[b], span(g), clear);
        const t = titleStrip(g, theme); wall(t[a], len(t), t[b], span(t), clear); }
      for (const e of L.edges) for (let i = 0; i + 1 < e.points.length; i++) {
        const p = e.points[i], q = e.points[i + 1];
        if (Math.abs(p[a] - q[a]) > 0.5 || G.some((g) => g.e === e && g.k === i)) continue;
        wall(p[a], 0, Math.min(p[b], q[b]), Math.abs(p[b] - q[b]), near);
      }
      if (!isFinite(left)) left = cMin - laneMax * G.length;
      if (!isFinite(right)) right = cMax + laneMax * G.length;
      const n = G.length, gap = Math.min((right - left) / (n + 1), laneMax);
      if (gap <= nudge * 1.2) continue;               // no room to do better than libavoid did
      const mid = (left + right) / 2;
      const apply = (order) => {
        const pts = new Map();
        for (let i = 0; i < n; i++) {
          const g = order[i], x = mid + (i - (n - 1) / 2) * gap;
          if (x < g.range[0] || x > g.range[1]) return null;
          const P = pts.get(g.e) || g.e.points.map((v) => ({ ...v }));
          P[g.k][a] = x; P[g.k + 1][a] = x; pts.set(g.e, P);
        }
        return pts;
      };
      let best = null;
      for (const order of permutations(G)) {
        const pts = apply(order); if (!pts) continue;
        const crossings = countCrossings(L.edges.map((e) => pts.get(e) || e.points));
        const moved = order.reduce((t, g, i) => t + Math.abs(order.indexOf(g) - G.indexOf(g)), 0);
        if (!best || crossings < best.crossings || (crossings === best.crossings && moved < best.moved)) best = { crossings, moved, pts };
      }
      if (!best) continue;
      const before = countCrossings(L.edges.map((e) => e.points));
      if (best.crossings > before) continue;
      if ([...best.pts].some(([e, P]) => checkEdge(L, theme, e, P).length > checkEdge(L, theme, e).length)) continue;
      for (const [e, P] of best.pts) e.points = P;
      L.stats = { ...(L.stats || {}), spread: (L.stats?.spread || 0) + 1 };
      if (process.env.ARCHDIAG_DEBUG) console.error('[spread]', G.map((g) => g.e.source + '->' + g.e.target).join(', '), `gap ${Math.round(gap)}`);
    }
  }
}
// Lines that share a side of a box can attach in an order that makes them cross right next to the box
// (libavoid picks each line's pin on its own). Try every order of their attachment points on that side and
// keep the one with the fewest crossings. Only the first segment moves; it stays perpendicular to the side.
function untangleEnds(L, theme) {
  if (theme.charMode) return;
  const near = (a, b) => Math.abs(a - b) < 1;
  for (const n of Object.values(L.nodes)) {
    const sides = { L: [], R: [], T: [], B: [] };
    for (const e of L.edges) {
      const P = e.points; if (P.length < 3) continue;          // a straight line would move its other end too
      for (const [i, j] of [[0, 1], [P.length - 1, P.length - 2]]) {
        if ((i === 0 ? e.source : e.target) !== n.id) continue;
        const p = P[i], q = P[j], horiz = near(p.y, q.y);
        const side = horiz ? (near(p.x, n.x) ? 'L' : near(p.x, n.x + n.w) ? 'R' : null) : (near(p.y, n.y) ? 'T' : near(p.y, n.y + n.h) ? 'B' : null);
        if (side) sides[side].push({ e, i, j, axis: horiz ? 'y' : 'x', at: horiz ? p.y : p.x });
      }
    }
    for (const ends of Object.values(sides)) {
      if (ends.length < 2 || ends.length > 6) continue;
      let slots = ends.map((d) => d.at).sort((a, b) => a - b);
      // Lines sharing a side need room for an arrowhead between them, or a head lands on its neighbour.
      const minGap = theme.edge.arrow * 2.4, axis = ends[0].axis, m = 10 * theme.scale;
      const lo = (axis === 'y' ? n.y : n.x) + m, hi = (axis === 'y' ? n.y + n.h : n.x + n.w) - m, span = minGap * (slots.length - 1);
      const crowded = slots.some((v, k) => k && v - slots[k - 1] < minGap - 0.5) && hi - lo >= span;
      if (crowded) {
        const mid = (slots[0] + slots[slots.length - 1]) / 2, start = Math.min(Math.max(mid - span / 2, lo), hi - span);
        slots = slots.map((_, k) => start + k * minGap);
      }
      const original = new Map(L.edges.map((e) => [e, e.points]));
      const tryOrder = (order) => {
        const pts = new Map();
        order.forEach((d, k) => {
          const P = (pts.get(d.e) || d.e.points.map((v) => ({ ...v })));
          P[d.i][d.axis] = slots[k]; P[d.j][d.axis] = slots[k]; pts.set(d.e, P);
        });
        return pts;
      };
      const base = countCrossings(L.edges.map((e) => e.points));
      let best = null;
      for (const order of permutations(ends)) {
        const pts = tryOrder(order);
        const c = countCrossings(L.edges.map((e) => pts.get(e) || original.get(e)));
        if ((c < base || (crowded && c <= base)) && (!best || c < best.c)) best = { c, pts };
      }
      if (!best) continue;
      if ([...best.pts].some(([e, P]) => checkEdge(L, theme, e, P).length > checkEdge(L, theme, e).length)) continue;
      for (const [e, P] of best.pts) e.points = P;
      L.stats = { ...(L.stats || {}), untangled: (L.stats?.untangled || 0) + 1 };
      if (process.env.ARCHDIAG_DEBUG) console.error('[untangle]', n.id, `${base} -> ${best.c} crossings${crowded ? ', spaced' : ''}`);
    }
  }
}
function* permutations(xs) {
  if (xs.length <= 1) { yield xs.slice(); return; }
  for (let i = 0; i < xs.length; i++) for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...rest];
}
function countCrossings(routes) {
  const segsOf = (P) => P.slice(0, -1).map((p, i) => [p, P[i + 1]]);
  const cross = ([a, b], [c, d]) => {
    const h1 = Math.abs(a.y - b.y) < 0.5, h2 = Math.abs(c.y - d.y) < 0.5; if (h1 === h2) return false;
    const [H, V] = h1 ? [[a, b], [c, d]] : [[c, d], [a, b]], x = V[0].x, y = H[0].y;
    return x > Math.min(H[0].x, H[1].x) + 1 && x < Math.max(H[0].x, H[1].x) - 1 && y > Math.min(V[0].y, V[1].y) + 1 && y < Math.max(V[0].y, V[1].y) - 1;
  };
  const all = routes.map(segsOf); let n = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) for (const p of all[i]) for (const q of all[j]) if (cross(p, q)) n++;
  return n;
}

module.exports = { routeEdges, routeOne };
