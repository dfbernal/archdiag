#!/usr/bin/env node
// Usage: archdiag diagram.yaml out/prefix [--fit doc|slide] [--type 1.3] [--png] [--ascii unicode|ascii] ... (see README)
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { makeTheme, makeTextTheme } = require('./theme');
const { renderASCII } = require('./render-ascii');
const { layoutDiagram } = require('./layout');
const { layoutCompound } = require('./layout-compound');
const { fitLayout } = require('./fit');
const { renderSVG } = require('./render-svg');
const { routeEdges } = require('./route');
const { placeLabels } = require('./labels');

async function main() {
  const args = process.argv.slice(2);
  const [input, prefix] = args;
  const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const elk = {};
  args.forEach((a, i) => { if (a === '--elk') { const [k, v] = args[i + 1].split('='); elk[k] = v; } });
  const diagram = yaml.load(fs.readFileSync(input, 'utf8'));
  args.forEach((a, i) => { if (a === '--gdir') { const [g, d] = args[i + 1].split('='); diagram.groups[g].direction = d; } });
  if (flag('--ascii')) {
    const tt = makeTextTheme(), maxCols = parseInt(flag('--cols', '100'), 10);
    const ranked = await fitLayout(diagram, tt, { target: 'text', overrides: { maxCols } });
    const best = ranked[0];
    console.error(`  text layout root=${best.root} ${JSON.stringify(best.dirs)} crossings=${best.crossings}`);
    const txt = renderASCII(best.L, tt, diagram, { mode: flag('--ascii') });
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(prefix + '.txt', txt);
    const w = Math.max(...txt.split('\n').map((l) => [...l].length));
    console.log(JSON.stringify({ out: prefix + '.txt', cols: w, rows: txt.split('\n').length }));
    return;
  }
  const theme = makeTheme(parseFloat(flag('--scale', '1')), parseFloat(flag('--type', '1')));
  // --zones obstacle (default: zones as solid shapes) | cluster (libavoid ClusterRef; ~25x slower, see route.js)
  if (flag('--zones')) theme.route = { ...(theme.route || {}), zones: flag('--zones') };
  const overrides = { elk };
  if (flag('--direction')) overrides.direction = flag('--direction');
  if (args.includes('--no-uniform')) overrides.uniform = false;
  if (flag('--hier') === 'separate') elk['elk.hierarchyHandling'] = 'SEPARATE_CHILDREN';
  const engine = flag('--engine', diagram.engine || 'elk');
  let L;
  if (flag('--fit')) {
    const ty = theme.type, chrome = diagram.title && !args.includes('--no-title') ? ty.title.size * 1.3 + ty.subtitle.size * 1.6 + theme.canvasPad * 0.6 : 0;
    const ranked = await fitLayout(diagram, theme, { target: flag('--fit'), overrides, chrome });
    ranked.slice(0, 3).forEach((r) => console.error(`  candidate root=${r.root} ${JSON.stringify(r.dirs)} px=${r.px} aspect=${r.aspect} crossings=${r.crossings} bends=${r.bends} violations=${r.violations}`));
    L = ranked[0].L;
  } else {
    L = engine === 'compound' ? await layoutCompound(diagram, theme, overrides) : await layoutDiagram(diagram, theme, overrides);
    const router = engine === 'compound' ? 'avoid' : flag('--router', diagram.router || 'elk');
    if (router === 'avoid') await routeEdges(L, theme);
    placeLabels(L, theme);
  }
  const { svg, width, height } = renderSVG(L, theme, diagram, { iconDir: [
    ...(flag('--icons') ? [path.resolve(flag('--icons'))] : []),       // your icons (by file name) first
    path.resolve(path.dirname(input), 'icons'),                         // then an icons/ folder next to the YAML
    path.join(__dirname, '..', 'icons')], showTitle: !args.includes('--no-title') });
  const { checkAll } = require('./geom');
  const v = checkAll(L, theme); if (v.length) console.error('  remaining issues:', JSON.stringify(v));
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  fs.writeFileSync(prefix + '.svg', svg);
  if (args.includes('--png')) await writePNG(svg, width, height, prefix + '.png', parseFloat(flag('--png-scale', '2')), theme);
  fs.writeFileSync(prefix + '.layout.json', JSON.stringify({ theme: { scale: theme.scale, type: theme.type }, layout: L }, null, 1));
  // On-slide legibility: fit into the 1800x900 content area of a 1920x1080 slide.
  const fit = Math.min(1800 / width, 900 / height);
  console.log(JSON.stringify({ out: prefix, width, height, aspect: +(width / height).toFixed(2), slideNodePx: +(theme.type.node.size * fit).toFixed(1), slideEdgePx: +(theme.type.edgeLabel.size * fit).toFixed(1) }));
}
// PNG via headless Chromium, with the bundled Inter embedded so it looks the same on every machine.
// Playwright is optional: npm install -D playwright && npx playwright install chromium
async function writePNG(svg, width, height, out, scale, theme) {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    throw new Error('--png needs Playwright: npm install -D playwright && npx playwright install chromium');
  }
  const face = (file, weight) => `@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/otf;base64,${fs.readFileSync(file).toString('base64')})}`;
  const css = face(theme.fonts.regular, 400) + face(theme.fonts.medium, 500) + face(theme.fonts.semibold, 600) + face(theme.fonts.bold, 700);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: Math.ceil(width), height: Math.ceil(height) }, deviceScaleFactor: scale });
    await page.setContent(`<html><head><style>${css}body{margin:0;background:#fff}</style></head><body>${svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: out });
  } finally { await browser.close(); }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
