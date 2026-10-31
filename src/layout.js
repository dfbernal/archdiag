// Diagram model -> ELK graph -> positioned model (absolute coordinates).
const ELK = require('elkjs/lib/elk.bundled.js');
const { textWidth } = require('./measure');

const fontFor = (theme, weight) => theme.fonts[weight] || theme.fonts.regular;
const lineH = (size) => Math.round(size * 1.25);

function parseEdges(list) {
  return (list || []).map((item, i) => {
    let spec = item, opts = {};
    if (typeof item === 'object') { spec = Object.keys(item)[0]; opts = item[spec] || {}; }
    // a -> b (arrow at b), a <-> b (both ends), a -- b (no arrowheads), a <- b (same as b -> a).
    // The data flows source -> target for layout; `arrow:` (forward | back | both | none) only changes the drawing.
    const m = String(spec).match(/^\s*([\w.-]+)\s*(<->|->|<-|--)\s*([\w.-]+)\s*$/);
    if (!m) throw new Error(`Bad edge: ${spec} (use a -> b, a <-> b, a -- b or a <- b)`);
    const [, a, op, b] = m;
    const [source, target] = op === '<-' ? [b, a] : [a, b];
    const arrow = opts.arrow || { '<->': 'both', '--': 'none' }[op] || 'forward';
    if (!['forward', 'back', 'both', 'none'].includes(arrow)) throw new Error(`Bad arrow '${arrow}' on ${spec}`);
    return { id: `e${i}`, source, target, label: opts.label, style: opts.style || 'request', arrow };
  });
}

function measureNode(n, theme) {
  const t = theme.type, k = theme.node;
  const titleW = textWidth(n.label, t.node.size, fontFor(theme, t.node.weight));
  const subW = n.sub ? textWidth(n.sub, t.nodeSub.size, fontFor(theme, t.nodeSub.weight)) : 0;
  const textW = Math.max(titleW, subW);
  const textH = lineH(t.node.size) + (n.sub ? k.lineGap + lineH(t.nodeSub.size) : 0);
  const iconW = n.icon ? k.icon + k.iconGap : 0;
  let w = Math.max(k.minW, k.padX * 2 + iconW + textW + k.accent);
  let h = Math.max(textH, n.icon ? k.icon : 0) + k.padY * 2;
  if (n.kind === 'datastore') h += Math.round(w * 0.12);          // room for the cylinder lid
  if (n.kind === 'actor') { w = Math.max(w, 150); }
  return { w: Math.ceil(w), h: Math.ceil(h), textW, textH };
}

async function layoutDiagram(diagram, theme, overrides = {}) {
  const groups = diagram.groups || {};
  const nodes = Object.entries(diagram.nodes || {}).map(([id, n]) => ({ id, kind: 'service', ...n }));
  const edges = parseEdges(diagram.edges);
  const opts = { ...(diagram.layout || {}), ...overrides };
  const sp = theme.spacing;

  // Size every node from its real text extent.
  for (const n of nodes) Object.assign(n, measureNode(n, theme));
  if (opts.uniform !== false) {
    // Same-kind cards share one width: the single biggest contributor to a "drawn by hand" look.
    const cards = nodes.filter((n) => ['service', 'external', 'queue'].includes(n.kind));
    const maxW = Math.max(...cards.map((n) => n.w)), maxH = Math.max(...cards.map((n) => n.h));
    cards.forEach((n) => { n.w = maxW; n.h = maxH; });
    const stores = nodes.filter((n) => n.kind === 'datastore');
    if (stores.length) {
      const sw = Math.max(...stores.map((n) => n.w)), sh = Math.max(...stores.map((n) => n.h));
      stores.forEach((n) => { n.w = sw; n.h = sh; });
    }
  }

  const g = theme.group;
  const elkNode = (n) => ({ id: n.id, width: n.w, height: n.h });
  const groupElk = {};
  for (const [id, gr] of Object.entries(groups)) {
    groupElk[id] = {
      id, children: [],
      layoutOptions: {
        'elk.padding': `[top=${require('./geom').titleRow(theme).padTop},left=${g.padX},bottom=${g.padBottom},right=${g.padX}]`,
        ...(gr.direction ? { 'elk.direction': gr.direction.toUpperCase() } : {}),
      },
    };
  }
  const root = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': (opts.direction || diagram.direction || 'right').toUpperCase(),
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(sp.nodeNode),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(sp.betweenLayers),
      'elk.spacing.edgeNode': String(sp.edgeNode),
      'elk.spacing.edgeEdge': String(sp.edgeEdge),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(sp.edgeNode),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(sp.edgeEdge),
      'elk.spacing.edgeLabel': String(sp.edgeLabel),
      'elk.spacing.componentComponent': String(sp.betweenLayers),
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.unnecessaryBendpoints': 'true',
      'elk.json.shapeCoords': 'ROOT',
      'elk.json.edgeCoords': 'ROOT',
      ...(opts.elk || {}),
    },
    children: [], edges: [],
  };
  // Nest groups, then nodes, preserving declaration order (ELK honours model order).
  for (const [id, gr] of Object.entries(groups)) (gr.parent ? groupElk[gr.parent].children : root.children).push(groupElk[id]);
  for (const n of nodes) (n.group ? groupElk[n.group].children : root.children).push(elkNode(n));

  const t = theme.type.edgeLabel, e = theme.edge;
  for (const ed of edges) {
    const el = { id: ed.id, sources: [ed.source], targets: [ed.target] };
    if (ed.label) {
      const w = textWidth(ed.label, t.size, fontFor(theme, t.weight)) + e.labelPadX * 2;
      el.labels = [{ id: ed.id + 'l', text: ed.label, width: Math.ceil(w), height: Math.ceil(lineH(t.size) + e.labelPadY * 2) }];
    }
    root.edges.push(el);
  }

  const res = await new ELK().layout(root);

  // Flatten to absolute coordinates.
  const out = { width: res.width, height: res.height, nodes: {}, groups: {}, edges: [] };
  const walk = (n, depth) => {
    for (const c of n.children || []) {
      if (groups[c.id]) out.groups[c.id] = { ...groups[c.id], id: c.id, x: c.x, y: c.y, w: c.width, h: c.height, depth };
      else out.nodes[c.id] = { ...nodes.find((x) => x.id === c.id), x: c.x, y: c.y, w: c.width, h: c.height };
      walk(c, depth + 1);
    }
  };
  walk(res, 0);
  const collectEdges = (n) => { for (const ed of n.edges || []) out.edges.push(ed); (n.children || []).forEach(collectEdges); };
  const raw = []; const grab = (n) => { (n.edges || []).forEach((x) => raw.push(x)); (n.children || []).forEach(grab); }; grab(res);
  for (const r of raw) {
    const meta = edges.find((x) => x.id === r.id);
    const sec = (r.sections || [])[0];
    const pts = sec ? [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint] : [];
    const lab = (r.labels || [])[0];
    out.edges.push({ ...meta, points: pts, labelBox: lab ? { x: lab.x, y: lab.y, w: lab.width, h: lab.height, text: lab.text } : null });
  }
  out.edges = out.edges.filter((x) => x.points);
  return out;
}

module.exports = { layoutDiagram, measureNode, parseEdges };
