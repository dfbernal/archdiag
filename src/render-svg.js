// Positioned model -> clean SVG using the theme's design tokens.
const fs = require('fs');
const path = require('path');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r1 = (n) => Math.round(n * 10) / 10;

// iconDir may be one folder or a list (first match wins), so a project's own icons can override ours.
function iconHref(name, iconDir) {
  const dirs = [].concat(iconDir), dir = dirs.find((d) => fs.existsSync(path.join(d, `${name}.svg`))) || dirs[dirs.length - 1];
  const f = path.join(dir, `${name}.svg`);
  if (!fs.existsSync(f)) return null;
  return 'data:image/svg+xml;base64,' + fs.readFileSync(f).toString('base64');
}

// Orthogonal polyline with rounded corners.
function roundedPath(pts, radius) {
  if (pts.length < 2) return '';
  let d = `M${r1(pts[0].x)},${r1(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) { d += ` L${r1(b.x)},${r1(b.y)}`; continue; }
    const p1 = { x: b.x - ((b.x - a.x) / l1) * r, y: b.y - ((b.y - a.y) / l1) * r };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r };
    d += ` L${r1(p1.x)},${r1(p1.y)} Q${r1(b.x)},${r1(b.y)} ${r1(p2.x)},${r1(p2.y)}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${r1(z.x)},${r1(z.y)}`;
}

// Drop collinear and duplicate points so corners are real corners.
function simplify(pts) {
  const out = [];
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1].x - p.x) < 0.5 && Math.abs(out[out.length - 1].y - p.y) < 0.5) continue;
    out.push({ ...p });
  }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) out.splice(i, 1);
  }
  return out;
}

function renderSVG(L, theme, diagram, { iconDir, showTitle = true } = {}) {
  const T = theme, ty = T.type, N = T.node, E = T.edge, G = T.group;
  const pad = T.canvasPad;
  const titleH = showTitle && diagram.title ? ty.title.size * 1.3 + (diagram.subtitle ? ty.subtitle.size * 1.6 : 0) + pad * 0.6 : 0;
  const W = Math.ceil(L.width + pad * 2), H = Math.ceil(L.height + pad * 2 + titleH);
  const ox = pad, oy = pad + titleH;
  const out = [];
  const font = (t, extra = '') => `font-family="${T.family}" font-size="${t.size}" font-weight="${{ regular: 400, medium: 500, semibold: 600, bold: 700 }[t.weight]}" ${extra}`;

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
  out.push(`<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="${r1(1.5 * T.scale)}" stdDeviation="${r1(2 * T.scale)}" flood-color="#0F172A" flood-opacity="0.10"/></filter></defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="#FFFFFF"/>`);

  if (titleH) {
    out.push(`<text x="${pad}" y="${pad + ty.title.size}" ${font(ty.title)} fill="${T.ink}">${esc(diagram.title)}</text>`);
    if (diagram.subtitle) out.push(`<text x="${pad}" y="${r1(pad + ty.title.size + ty.subtitle.size * 1.6)}" ${font(ty.subtitle)} fill="${T.muted}">${esc(diagram.subtitle)}</text>`);
  }
  out.push(`<g transform="translate(${r1(ox)},${r1(oy)})">`);

  const headers = [];
  // Groups (outermost first).
  const groups = Object.values(L.groups).sort((a, b) => a.depth - b.depth);
  for (const g of groups) {
    const p = T.palette[g.color] || T.palette.slate;
    out.push(`<rect x="${r1(g.x)}" y="${r1(g.y)}" width="${r1(g.w)}" height="${r1(g.h)}" rx="${G.radius}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${G.stroke}" stroke-opacity="0.55"/>`);
    headers.push(g);
  }

  // Edges.
  const labels = [];
  for (const e of L.edges) {
    const st = T.edgeStyles[e.style] || T.edgeStyles.request;
    const pts = simplify(e.points);
    // Pull the line back so the arrowhead tip lands exactly on the border.
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const tip = { x: b.x, y: b.y }, al = E.arrow * 1.25;
    const line = [...pts.slice(0, -1), { x: b.x - ux * al * 0.8, y: b.y - uy * al * 0.8 }];
    out.push(`<path d="${roundedPath(line, E.radius)}" fill="none" stroke="${st.color}" stroke-width="${E.width}" stroke-linecap="round" stroke-linejoin="round"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`);
    const bx = tip.x - ux * al, by = tip.y - uy * al, px = -uy * E.arrow * 0.62, py = ux * E.arrow * 0.62;
    out.push(`<path d="M${r1(tip.x)},${r1(tip.y)} L${r1(bx + px)},${r1(by + py)} L${r1(bx - px)},${r1(by - py)} Z" fill="${st.color}" stroke="${st.color}" stroke-width="${r1(E.width * 0.5)}" stroke-linejoin="round"/>`);
    if (e.labelBox) labels.push({ e, st, pts });
  }

  // Zone titles sit on an opaque chip above the connectors, so a line passes behind a title, never through it.
  const { titleRect } = require('./geom');
  for (const g of headers) {
    const p = T.palette[g.color] || T.palette.slate, tr = titleRect(g, T), isz = ty.group.size * 1.35;
    let tx = tr.textX;
    // Opaque chip with a hairline in the zone colour, so even a line that has to pass reads as "behind".
    out.push(`<rect x="${r1(tr.x)}" y="${r1(tr.y)}" width="${r1(tr.w)}" height="${r1(tr.h)}" rx="${r1(6 * T.scale)}" fill="${p.fill}" stroke="${p.stroke}" stroke-opacity="0.25" stroke-width="${r1(T.scale)}"/>`);
    if (g.icon) {
      const href = iconHref(g.icon, iconDir);
      if (href) { out.push(`<image href="${href}" x="${r1(tx)}" y="${r1(tr.cy - isz / 2)}" width="${r1(isz)}" height="${r1(isz)}"/>`); tx += isz + ty.group.size * 0.5; }
    }
    out.push(`<text x="${r1(tx)}" y="${r1(tr.cy)}" dominant-baseline="central" ${font(ty.group)} fill="${p.text}" letter-spacing="0.2">${esc(g.label)}</text>`);
  }

  // Nodes.
  for (const n of Object.values(L.nodes)) {
    const grp = n.group ? L.groups[n.group] : null;
    const pal = T.palette[(grp && grp.color) || 'slate'];
    const x = n.x, y = n.y, w = n.w, h = n.h;
    let contentTop = y, contentH = h, textColor = T.ink, subColor = T.muted, align = 'left';

    if (n.kind === 'datastore') {
      const ry = Math.min(h * 0.14, 16 * T.scale), rx = w / 2;
      out.push(`<g filter="url(#sh)"><path d="M${r1(x)},${r1(y + ry)} A${r1(rx)},${r1(ry)} 0 0 1 ${r1(x + w)},${r1(y + ry)} L${r1(x + w)},${r1(y + h - ry)} A${r1(rx)},${r1(ry)} 0 0 1 ${r1(x)},${r1(y + h - ry)} Z" fill="#FFFFFF" stroke="${pal.stroke}" stroke-width="${N.stroke}"/></g>`);
      out.push(`<path d="M${r1(x)},${r1(y + ry)} A${r1(rx)},${r1(ry)} 0 0 0 ${r1(x + w)},${r1(y + ry)}" fill="none" stroke="${pal.stroke}" stroke-width="${N.stroke}"/>`);
      contentTop = y + ry * 2; contentH = h - ry * 3; align = 'center';
    } else if (n.kind === 'actor') {
      const ap = T.palette.violet;
      out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(h / 2)}" fill="#4F46E5" filter="url(#sh)"/>`);
      textColor = '#FFFFFF'; subColor = '#E0E7FF'; align = 'center';
      void ap;
    } else {
      const ext = n.kind === 'external';
      const accent = ext ? T.palette.violet.stroke : (n.kind === 'queue' ? T.palette.amber.stroke : pal.stroke);
      out.push(`<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${N.radius}" fill="${ext ? T.palette.violet.fill : T.cardFill}" stroke="${ext ? T.palette.violet.stroke : T.cardStroke}" stroke-width="${N.stroke}"${ext ? ` stroke-dasharray="${r1(6 * T.scale)} ${r1(4 * T.scale)}"` : ''} filter="url(#sh)"/>`);
      if (!ext) out.push(`<clipPath id="c_${n.id}"><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${N.radius}"/></clipPath><rect x="${r1(x)}" y="${r1(y)}" width="${N.accent}" height="${r1(h)}" fill="${accent}" clip-path="url(#c_${n.id})"/>`);
    }

    // Icon + text block.
    const tH = ty.node.size * 1.25, sH = n.sub ? N.lineGap + ty.nodeSub.size * 1.25 : 0;
    const blockH = tH + sH, top = contentTop + (contentH - blockH) / 2;
    const href = n.icon ? iconHref(n.icon, iconDir) : null;
    if (align === 'center') {
      let cx = x + w / 2;
      if (href) {
        const s = N.icon * 0.8, tw = Math.max(n.textW || 0, 0), total = s + N.iconGap * 0.7 + tw;
        out.push(`<image href="${href}" x="${r1(cx - total / 2)}" y="${r1(top + (blockH - s) / 2)}" width="${r1(s)}" height="${r1(s)}"/>`);
        cx = cx - total / 2 + s + N.iconGap * 0.7; align = 'start-at';
        out.push(`<text x="${r1(cx)}" y="${r1(top + tH / 2)}" dominant-baseline="central" ${font(ty.node)} fill="${textColor}">${esc(n.label)}</text>`);
        if (n.sub) out.push(`<text x="${r1(cx)}" y="${r1(top + tH + N.lineGap + ty.nodeSub.size * 0.62)}" dominant-baseline="central" ${font(ty.nodeSub)} fill="${subColor}">${esc(n.sub)}</text>`);
      } else {
        out.push(`<text x="${r1(cx)}" y="${r1(top + tH / 2)}" text-anchor="middle" dominant-baseline="central" ${font(ty.node)} fill="${textColor}">${esc(n.label)}</text>`);
        if (n.sub) out.push(`<text x="${r1(cx)}" y="${r1(top + tH + N.lineGap + ty.nodeSub.size * 0.62)}" text-anchor="middle" dominant-baseline="central" ${font(ty.nodeSub)} fill="${subColor}">${esc(n.sub)}</text>`);
      }
    } else {
      let tx = x + N.accent + N.padX;
      if (href) { out.push(`<image href="${href}" x="${r1(tx)}" y="${r1(y + (h - N.icon) / 2)}" width="${N.icon}" height="${N.icon}"/>`); tx += N.icon + N.iconGap; }
      out.push(`<text x="${r1(tx)}" y="${r1(top + tH / 2)}" dominant-baseline="central" ${font(ty.node)} fill="${textColor}">${esc(n.label)}</text>`);
      if (n.sub) out.push(`<text x="${r1(tx)}" y="${r1(top + tH + N.lineGap + ty.nodeSub.size * 0.62)}" dominant-baseline="central" ${font(ty.nodeSub)} fill="${subColor}">${esc(n.sub)}</text>`);
    }
  }

  // Edge labels last, as pills sitting on their line.
  for (const { e, st } of labels) {
    const b = e.labelBox;
    out.push(`<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.w)}" height="${r1(b.h)}" rx="${E.labelRadius}" fill="#FFFFFF" stroke="${st.color}" stroke-opacity="0.35" stroke-width="${r1(1 * T.scale)}"/>`);
    out.push(`<text x="${r1(b.x + b.w / 2)}" y="${r1(b.y + b.h / 2)}" text-anchor="middle" dominant-baseline="central" ${font(ty.edgeLabel)} fill="${st.label}">${esc(b.text)}</text>`);
  }

  out.push('</g></svg>');
  return { svg: out.join('\n'), width: W, height: H };
}

module.exports = { renderSVG };
