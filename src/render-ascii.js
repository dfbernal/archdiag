// Positioned model (laid out in character-cell units) -> Unicode or plain-ASCII text.
const U = 1, D = 2, Lf = 4, R = 8;

const SETS = {
  unicode: {
    line: { [Lf | R]: '─', [U | D]: '│', [D | R]: '┌', [D | Lf]: '┐', [U | R]: '└', [U | Lf]: '┘', [U | D | R]: '├', [U | D | Lf]: '┤',
      [Lf | R | D]: '┬', [Lf | R | U]: '┴', [U | D | Lf | R]: '┼', [Lf]: '─', [R]: '─', [U]: '│', [D]: '│' },
    dashH: '┄', dashV: '┆', arrows: { [R]: '▶', [Lf]: '◀', [U]: '▲', [D]: '▼' },
    box: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
    round: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
    dashed: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '╌', v: '╎' },
    group: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '┈', v: '┊' },
  },
  ascii: {
    line: new Proxy({}, { get: (_, k) => ({ [Lf | R]: '-', [U | D]: '|', [Lf]: '-', [R]: '-', [U]: '|', [D]: '|' }[k] || '+') }),
    dashH: '.', dashV: ':', arrows: { [R]: '>', [Lf]: '<', [U]: '^', [D]: 'v' },
    box: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' },
    round: { tl: '.', tr: '.', bl: "'", br: "'", h: '-', v: '|' },
    dashed: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: ':' },
    group: { tl: '+', tr: '+', bl: '+', br: '+', h: '.', v: ':' },
  },
};

function renderASCII(L, theme, diagram, { mode = 'unicode', title = true } = {}) {
  const S = SETS[mode], { cw, ch } = theme.charMode;
  const col = (x) => Math.round(x / cw), row = (y) => Math.round(y / ch);
  const W = col(L.width) + 3, H = row(L.height) + 3;
  const grid = Array.from({ length: H }, () => Array(W).fill(' '));
  const mask = Array.from({ length: H }, () => Array(W).fill(0));
  const dash = Array.from({ length: H }, () => Array(W).fill(false));
  const put = (c, r, chr) => { if (r >= 0 && r < H && c >= 0 && c < W) grid[r][c] = chr; };
  const text = (c, r, s) => [...s].forEach((chr, i) => put(c + i, r, chr));

  const boxOf = (b) => { const c0 = col(b.x), r0 = row(b.y); return { c0, r0, c1: c0 + Math.round(b.w / cw) - 1, r1: r0 + Math.round(b.h / ch) - 1 }; };
  const drawBox = (bx, set) => {
    for (let c = bx.c0 + 1; c < bx.c1; c++) { put(c, bx.r0, set.h); put(c, bx.r1, set.h); }
    for (let r = bx.r0 + 1; r < bx.r1; r++) { put(bx.c0, r, set.v); put(bx.c1, r, set.v); }
    put(bx.c0, bx.r0, set.tl); put(bx.c1, bx.r0, set.tr); put(bx.c0, bx.r1, set.bl); put(bx.c1, bx.r1, set.br);
  };
  const clearBox = (bx) => { for (let r = bx.r0; r <= bx.r1; r++) for (let c = bx.c0; c <= bx.c1; c++) put(c, r, ' '); };

  // 1. Zones.
  for (const g of Object.values(L.groups).sort((a, b) => a.depth - b.depth)) {
    const bx = boxOf(g); drawBox(bx, S.group);
  }

  // 2. Connectors: snap to the grid, attach just outside the box border.
  const boxes = Object.fromEntries(Object.values(L.nodes).map((n) => [n.id, boxOf(n)]));
  const routes = [];
  for (const e of L.edges) {
    let pts = e.points.map((p) => ({ c: col(p.x), r: row(p.y) }));
    const snapEnd = (p, nb, q) => {
      // Which side of the box is this endpoint on?
      const horiz = q && q.r === p.r;
      if (horiz || !q) {
        const leftSide = Math.abs(p.c - nb.c0) <= Math.abs(p.c - nb.c1);
        p.c = leftSide ? nb.c0 - 1 : nb.c1 + 1;
        const r = Math.min(Math.max(p.r, nb.r0 + 1), nb.r1 - 1); if (q && q.r === p.r) q.r = r; p.r = r;
      } else {
        const top = Math.abs(p.r - nb.r0) <= Math.abs(p.r - nb.r1);
        p.r = top ? nb.r0 - 1 : nb.r1 + 1;
        const c = Math.min(Math.max(p.c, nb.c0 + 1), nb.c1 - 1); if (q && q.c === p.c) q.c = c; p.c = c;
      }
    };
    if (pts.length >= 2) {
      snapEnd(pts[0], boxes[e.source], pts[1]);
      snapEnd(pts[pts.length - 1], boxes[e.target], pts[pts.length - 2]);
    }
    // keep segments orthogonal after snapping
    const fixed = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = fixed[fixed.length - 1], b = pts[i];
      if (a.c !== b.c && a.r !== b.r) fixed.push({ c: b.c, r: a.r });
      fixed.push(b);
    }
    pts = fixed;
    const dashed = e.style === 'async';
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (a.r === b.r) {
        const [lo, hi] = [Math.min(a.c, b.c), Math.max(a.c, b.c)];
        for (let c = lo; c <= hi; c++) { if (c > lo) mask[a.r][c] |= Lf; if (c < hi) mask[a.r][c] |= R; if (dashed) dash[a.r][c] = true; }
      } else {
        const [lo, hi] = [Math.min(a.r, b.r), Math.max(a.r, b.r)];
        for (let r = lo; r <= hi; r++) { if (r > lo) mask[r][a.c] |= U; if (r < hi) mask[r][a.c] |= D; if (dashed) dash[r][a.c] = true; }
      }
    }
    routes.push({ e, pts });
  }
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const m = mask[r][c]; if (!m) continue;
    let chr = S.line[m] || '+';
    if (dash[r][c] && (m === (Lf | R) || m === Lf || m === R)) chr = S.dashH;
    if (dash[r][c] && (m === (U | D) || m === U || m === D)) chr = S.dashV;
    put(c, r, chr);
  }

  // 3. Boxes on top of everything except labels and arrowheads.
  for (const n of Object.values(L.nodes)) {
    const bx = boxes[n.id]; clearBox(bx);
    drawBox(bx, n.kind === 'datastore' || n.kind === 'actor' ? S.round : n.kind === 'external' ? S.dashed : S.box);
    const inner = bx.c1 - bx.c0 - 1;
    const center = (s, r) => text(bx.c0 + 1 + Math.floor((inner - [...s].length) / 2), r, s);
    center(n.label, bx.r0 + 1);
    if (n.sub) center(n.sub, bx.r0 + 2);
  }

  // Zone titles go on top of any line crossing the border.
  for (const g of Object.values(L.groups)) { const bx = boxOf(g); text(bx.c0 + 2, bx.r0, ` ${g.label} `); }

  // 4. Arrowheads.
  const tipAt = (z, y) => put(z.c, z.r, S.arrows[z.c > y.c ? R : z.c < y.c ? Lf : z.r > y.r ? D : U]);
  for (const { e, pts } of routes) {
    if (pts.length < 2) continue;
    if (e.arrow !== 'back' && e.arrow !== 'none') tipAt(pts[pts.length - 1], pts[pts.length - 2]);
    if (e.arrow === 'back' || e.arrow === 'both') tipAt(pts[0], pts[1]);
  }

  // 5. Labels: inline on the longest free horizontal run, else beside the longest vertical run.
  const free = (c, r, len) => { for (let i = 0; i < len; i++) { const g = grid[r]?.[c + i]; if (g === undefined || !(g === ' ' || '─┄-.'.includes(g))) return false; } return true; };
  const freeBlank = (c, r, len) => { for (let i = 0; i < len; i++) if (grid[r]?.[c + i] !== ' ') return false; return true; };
  for (const { e, pts } of routes) {
    if (!e.label) continue;
    const lab = ` ${e.label} `, len = [...lab].length;
    const segs = pts.slice(0, -1).map((a, i) => ({ a, b: pts[i + 1] })).map((s) => ({ ...s, horiz: s.a.r === s.b.r, n: Math.abs(s.a.c - s.b.c) + Math.abs(s.a.r - s.b.r) }));
    let done = false;
    for (const s of segs.filter((s) => s.horiz).sort((x, y) => y.n - x.n)) {
      const lo = Math.min(s.a.c, s.b.c) + 1, hi = Math.max(s.a.c, s.b.c) - 1;
      if (hi - lo + 1 < len + 2) continue;
      const start = lo + Math.floor((hi - lo + 1 - len) / 2);
      if (free(start, s.a.r, len)) { text(start, s.a.r, lab); done = true; break; }
    }
    if (done) continue;
    for (const s of segs.filter((s) => !s.horiz).sort((x, y) => y.n - x.n)) {
      const mid = Math.round((s.a.r + s.b.r) / 2);
      for (const dr of [0, -1, 1, -2, 2]) {
        const r = mid + dr;
        if (freeBlank(s.a.c + 1, r, len)) { text(s.a.c + 1, r, lab); done = true; break; }
        if (freeBlank(s.a.c - len, r, len)) { text(s.a.c - len, r, lab); done = true; break; }
      }
      if (done) break;
    }
  }

  let lines = grid.map((r) => r.join('').replace(/\s+$/, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  while (lines.length && !lines[0]) lines.shift();
  // Trim common left margin.
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  lines = lines.map((l) => l.slice(indent));
  if (title && diagram.title) lines.unshift(diagram.title, '');
  return lines.join('\n') + '\n';
}

module.exports = { renderASCII };
