// Compound layout with lifted edges.
// Each container (root or group) is laid out on its own with ELK in its own direction.
// Inside a container, child groups are opaque boxes, and every real edge is "lifted" to the
// pair of children that contain its endpoints, so the macro arrangement follows the real flow.
// Connectors are then routed separately (libavoid), Lucidchart-style.
const ELK = require('elkjs/lib/elk.bundled.js');
const { measureNode, parseEdges } = require('./layout');
const { textWidth } = require('./measure');
const { titleRow } = require('./geom');

async function layoutCompound(diagram, theme, overrides = {}) {
  const elk = new ELK();
  const groups = Object.fromEntries(Object.entries(diagram.groups || {}).map(([id, g]) => [id, { id, ...g }]));
  const nodes = Object.fromEntries(Object.entries(diagram.nodes || {}).map(([id, n]) => [id, { id, kind: 'service', ...n }]));
  const edges = parseEdges(diagram.edges);
  const opts = { ...(diagram.layout || {}), ...overrides };
  const mul = opts.spaceMul || 1, G = theme.group;
  const sp = { ...theme.spacing, nodeNode: theme.spacing.nodeNode * mul, betweenLayers: theme.spacing.betweenLayers * mul };

  for (const n of Object.values(nodes)) {
    Object.assign(n, measureNode(n, theme));
    if (theme.charMode) {                      // text mode: sizes in whole character cells
      const { cw, ch } = theme.charMode, len = Math.max([...n.label].length, [...(n.sub || '')].length);
      n.w = (len + 4) * cw; n.h = (n.sub ? 4 : 3) * ch;
    }
  }
  if (opts.uniform !== false) {
    const unify = (list) => { if (!list.length) return; const w = Math.max(...list.map((n) => n.w)), h = Math.max(...list.map((n) => n.h)); list.forEach((n) => { n.w = w; n.h = h; }); };
    unify(Object.values(nodes).filter((n) => ['service', 'external', 'queue'].includes(n.kind)));
    unify(Object.values(nodes).filter((n) => n.kind === 'datastore'));
  }

  const parentOf = (id) => (groups[id] ? groups[id].parent : nodes[id]?.group) || 'root';
  const childrenOf = (cid) => [...Object.keys(groups), ...Object.keys(nodes)].filter((id) => parentOf(id) === cid)
    // keep declaration order: groups and nodes interleaved as declared in the file
    .sort((a, b) => order(a) - order(b));
  const declOrder = [...Object.keys(diagram.nodes || {}), ...Object.keys(diagram.groups || {})];
  const order = (id) => {
    if (nodes[id]) return Object.keys(diagram.nodes).indexOf(id) * 2;
    // a group sorts at the position of its first descendant node
    const desc = Object.keys(nodes).filter((n) => ancestors(n).includes(id));
    return desc.length ? Math.min(...desc.map((d) => Object.keys(diagram.nodes).indexOf(d))) * 2 - 1 : declOrder.indexOf(id) * 2;
  };
  const dirOf = (cid) => ((cid === 'root' ? opts.direction || diagram.direction : groups[cid].direction) || (cid === 'root' ? 'right' : (opts.direction || diagram.direction || 'right'))).toUpperCase();
  const depthOf = (cid) => (cid === 'root' ? 0 : ancestors(cid).length + 1);
  const ancestors = (id) => { const out = []; let p = parentOf(id); while (p !== 'root') { out.push(p); p = parentOf(p); } return out; };
  // The child of container cid that contains node id (or null if id is outside cid).
  const liftTo = (id, cid) => { let cur = id; while (cur && parentOf(cur) !== cid) { const p = parentOf(cur); if (p === 'root') return null; cur = p; } return cur; };

  // Lanes: `lane: N` on a zone or box pins it to the Nth band along its container's flow (1 = first).
  // An edge from a later lane to an earlier one is "backward" (e.g. a task consuming a topic that sits
  // to its right): it still counts for layout, but leaves and enters on the sides facing each other.
  const laneOf = (id) => (groups[id] ? groups[id].lane : nodes[id]?.lane);
  const OPPOSITE = { RIGHT: 'LEFT', LEFT: 'RIGHT', DOWN: 'UP', UP: 'DOWN' };
  const backwardAt = (e, cid) => {
    const s = liftTo(e.source, cid), t = liftTo(e.target, cid);
    return !!(s && t && s !== t && laneOf(s) != null && laneOf(t) != null && laneOf(s) > laneOf(t));
  };
  const isBackward = (e) => ['root', ...Object.keys(groups)].some((cid) => backwardAt(e, cid));

  const local = {}; // container id -> { w, h, pos: {childId: {x,y}} }
  async function lay(cid) {
    const kids = childrenOf(cid);
    for (const k of kids) if (groups[k]) await lay(k);
    const size = (k) => (groups[k] ? { w: local[k].w, h: local[k].h } : { w: nodes[k].w, h: nodes[k].h });
    const isRoot = cid === 'root';
    const dir = dirOf(cid);
    // Exit-aware order: when this zone flows across its parent's flow (e.g. DOWN inside a left-to-right
    // diagram), ELK's in-row order runs along the parent's flow. Put children whose connections leave the
    // zone toward the exit side and children fed from outside toward the entry side, so lines leaving the
    // zone don't cut across the zone's own flow. Stable sort: ties keep declaration order.
    let forceOrder = false;
    if (!isRoot && opts.exitOrder !== false) {
      const pdir = dirOf(parentOf(cid)), horiz = (d) => d === 'RIGHT' || d === 'LEFT';
      if (horiz(pdir) !== horiz(dir)) {
        const sign = pdir === 'RIGHT' || pdir === 'DOWN' ? 1 : -1;
        // (A backward edge's outside end is ahead, on the exit side, whichever end is the source.)
        const score = (k) => edges.reduce((a, e) => {
          const s = liftTo(e.source, cid), t = liftTo(e.target, cid), f = isBackward(e) ? -1 : 1;
          return a + f * ((s === k && !t ? 1 : 0) - (t === k && !s ? 1 : 0));
        }, 0);
        // Only the direction counts, not how many links. A child zone is a wall for its neighbours'
        // lines, so on the exit side plain boxes go beyond zones, and on the entry side before them.
        // Ties: the larger the share of a box's links that leave the zone, the further out it goes
        // (Auth, whose only outgoing link leaves, sits beyond Orders, whose links mostly stay inside).
        const share = (k) => { let ext = 0, tot = 0; for (const e of edges) {
          const s = liftTo(e.source, cid), t = liftTo(e.target, cid);
          if (s !== k && t !== k) continue; if (s === t) continue; tot++; if (!s || !t) ext++; }
          return tot ? ext / tot : 0; };
        const sc = Object.fromEntries(kids.map((k) => { const v = Math.sign(score(k) * sign);
          return [k, v === 0 ? 0 : v * (groups[k] ? 2 : 3 + share(k))]; }));
        kids.sort((a, b) => sc[a] - sc[b]);
        forceOrder = Object.values(sc).some((v) => v !== 0);
      }
    }
    // Port-aware lifting: a lifted edge leaves/enters a child zone at a port placed where the real inner
    // box sits, on the side facing the flow. ELK then lines neighbours up with the box they actually
    // connect to (Stripe beside Payments) instead of with the middle of the zone.
    // Off by default in text mode: on the character grid it made checkout.yaml 27 rows shorter but added a
    // crossing and lost a label (no room to place it). Force with overrides.ports = true.
    const usePorts = opts.ports ?? !theme.charMode;
    const SIDES = { RIGHT: ['EAST', 'WEST'], LEFT: ['WEST', 'EAST'], DOWN: ['SOUTH', 'NORTH'], UP: ['NORTH', 'SOUTH'] }[dir];
    const ports = {}; // child group id -> { portId: port }
    const portFor = (k, inner, role, back = false) => {
      const side = (role === 'out') !== back ? SIDES[0] : SIDES[1], id = `${k}::${side}::${inner}`;
      if (ports[k]?.[id]) return id;
      let x = nodes[inner].w / 2, y = nodes[inner].h / 2, cur = inner;
      while (cur !== k) { const p = parentOf(cur), at = local[p].pos[cur]; x += at.x; y += at.y; cur = p; }
      const W = local[k].w, H = local[k].h;
      const pos = { EAST: { x: W, y }, WEST: { x: -1, y }, SOUTH: { x, y: H }, NORTH: { x, y: -1 } }[side];
      (ports[k] = ports[k] || {})[id] = { id, width: 1, height: 1, ...pos, layoutOptions: { 'elk.port.side': side } };
      return id;
    };
    const lifted = []; const seen = new Set();
    for (const e of edges) {
      const s = liftTo(e.source, cid), t = liftTo(e.target, cid);
      if (!s || !t || s === t) continue;
      e.flow = e.flow || null;
      const back = backwardAt(e, cid), fdir = back ? OPPOSITE[dir] : dir;
      if (s === e.source && t === e.target) e.flow = fdir;          // edge lives at this level
      else if (!e.flow || e.flowDepth === undefined || depthOf(cid) > e.flowDepth) { e.flow = fdir; e.flowDepth = depthOf(cid); }
      const src = usePorts && groups[s] ? portFor(s, e.source, 'out', back) : s;
      const tgt = usePorts && groups[t] ? portFor(t, e.target, 'in', back) : t;
      const key = src + '>' + tgt; if (seen.has(key)) continue; seen.add(key);
      const le = { id: `${cid}_${lifted.length}`, sources: [src], targets: [tgt] };
      if (e.label) {
        // Reserve the label's real footprint so ELK opens a wide enough gap for it.
        const tl = theme.type.edgeLabel, E = theme.edge;
        le.labels = [theme.charMode ? { text: e.label, width: ([...e.label].length + 4) * theme.charMode.cw, height: theme.charMode.ch } : { text: e.label, width: Math.ceil(textWidth(e.label, tl.size, theme.fonts[tl.weight]) + E.labelPadX * 2 + 8 * theme.scale), height: Math.ceil(tl.size * 1.25 + E.labelPadY * 2) }];
      }
      lifted.push(le);
    }
    const pad = isRoot ? { t: 0, l: 0, b: 0, r: 0 } : { t: titleRow(theme).padTop, l: G.padX, b: G.padBottom, r: G.padX };
    const laned = kids.some((k) => laneOf(k) != null);
    const graph = {
      id: cid,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': dir,
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.padding': `[top=${pad.t},left=${pad.l},bottom=${pad.b},right=${pad.r}]`,
        'elk.spacing.nodeNode': String(isRoot ? sp.nodeNode * 1.6 : sp.nodeNode),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(isRoot ? sp.betweenLayers * 1.3 : sp.betweenLayers),
        'elk.spacing.componentComponent': String(sp.betweenLayers),
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        'elk.edgeLabels.placement': 'CENTER',
        'elk.spacing.edgeLabel': String(sp.edgeLabel),
        ...(forceOrder ? { 'elk.layered.crossingMinimization.forceNodeModelOrder': 'true' } : {}),
        ...(laned ? { 'elk.partitioning.activate': 'true' } : {}),
        ...(opts.elk || {}),
        ...((isRoot ? opts.rootElk : groups[cid].elk) || {}),
      },
      children: kids.map((k) => ({ id: k, width: size(k).w, height: size(k).h,
        ...(ports[k] ? { ports: Object.values(ports[k]) } : {}),
        layoutOptions: { ...(ports[k] ? { 'elk.portConstraints': 'FIXED_POS' } : {}),
          ...(laned ? { 'elk.partitioning.partition': String(laneOf(k) ?? 0) } : {}) } })),
      edges: lifted,
    };
    if (!lifted.length && kids.length > 1) {
      // No internal edges: ELK would just pack the boxes, ignoring direction. Line them up ourselves.
      if (laned) kids.sort((a, b) => (laneOf(a) ?? 0) - (laneOf(b) ?? 0));   // stable: lanes first, then declaration order
      const gap = isRoot ? sp.betweenLayers : sp.nodeNode * 1.2, row = dir === 'RIGHT' || dir === 'LEFT';
      let cur = row ? pad.l : pad.t; const pos = {};
      const cross = Math.max(...kids.map((k) => (row ? size(k).h : size(k).w)));
      for (const k of kids) {
        const z = size(k);
        pos[k] = row ? { x: cur, y: pad.t + (cross - z.h) / 2 } : { x: pad.l + (cross - z.w) / 2, y: cur };
        cur += (row ? z.w : z.h) + gap;
      }
      cur -= gap;
      local[cid] = row ? { w: cur + pad.r, h: pad.t + cross + pad.b, pos } : { w: pad.l + cross + pad.r, h: cur + pad.b, pos };
      return;
    }
    const res = await elk.layout(graph);
    local[cid] = { w: res.width, h: res.height, pos: Object.fromEntries(res.children.map((c) => [c.id, { x: c.x, y: c.y }])) };
  }
  await lay('root');

  // Resolve absolute coordinates top-down.
  const out = { width: local.root.w, height: local.root.h, nodes: {}, groups: {}, edges: [] };
  const place = (cid, ox, oy, depth) => {
    for (const [k, p] of Object.entries(local[cid].pos)) {
      const x = ox + p.x, y = oy + p.y;
      if (groups[k]) { out.groups[k] = { ...groups[k], x, y, w: local[k].w, h: local[k].h, depth }; place(k, x, y, depth + 1); }
      else out.nodes[k] = { ...nodes[k], x, y };
    }
  };
  place('root', 0, 0, 0);
  if (opts.align !== false) alignRoot();

  for (const e of edges) out.edges.push({ ...e, flow: e.flow || 'RIGHT', points: [], labelBox: null });

  // Alignment pass (what a person does by hand): anchor the biggest top-level block, then slide each
  // neighbour that has exactly one connection to the placed set along the cross axis so the two
  // connected boxes line up, as long as nothing ends up overlapping.
  function alignRoot() {
    const dir = (opts.direction || diagram.direction || 'right').toUpperCase();
    const cross = dir === 'RIGHT' || dir === 'LEFT' ? 'y' : 'x', len = cross === 'y' ? 'h' : 'w';
    const kids = Object.keys(local.root.pos);
    const box = (k) => (groups[k] ? out.groups[k] : out.nodes[k]);
    const area = (k) => box(k).w * box(k).h;
    const placed = new Set([kids.sort((a, b) => area(b) - area(a))[0]]);
    const shiftTree = (k, d) => {
      const b = box(k); b[cross] += d;
      if (groups[k]) {
        for (const n of Object.values(out.nodes)) if (ancestors(n.id).includes(k)) n[cross] += d;
        for (const g of Object.values(out.groups)) if (g.id !== k && ancestors(g.id).includes(k)) g[cross] += d;
      }
    };
    const overlapsAny = (k) => kids.some((o) => o !== k && (() => { const a = box(k), b = box(o), m = 20;
      return a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y; })());
    let changed = true;
    while (changed) {
      changed = false;
      for (const k of kids) {
        if (placed.has(k)) continue;
        const links = edges.filter((e) => { const s = liftTo(e.source, 'root'), t = liftTo(e.target, 'root');
          return (s === k && placed.has(t)) || (t === k && placed.has(s)); });
        if (!links.length) continue;
        placed.add(k); changed = true;
        if (links.length !== 1) continue;
        const e = links[0], mine = liftTo(e.source, 'root') === k ? e.source : e.target, other = mine === e.source ? e.target : e.source;
        const a = out.nodes[mine], b = out.nodes[other];
        const d = (b[cross] + b[len] / 2) - (a[cross] + a[len] / 2);
        shiftTree(k, d);
        if (overlapsAny(k)) shiftTree(k, -d);
      }
    }
    // Normalise so the drawing starts at 0,0 again.
    const all = [...Object.values(out.nodes), ...Object.values(out.groups)];
    const minX = Math.min(...all.map((b) => b.x)), minY = Math.min(...all.map((b) => b.y));
    all.forEach((b) => { b.x -= minX; b.y -= minY; });
    out.width = Math.max(...all.map((b) => b.x + b.w)); out.height = Math.max(...all.map((b) => b.y + b.h));
  }
  return out;
}

module.exports = { layoutCompound };
