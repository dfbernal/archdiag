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
  if (!input || !prefix) { console.error('Usage: archdiag diagram.yaml out/prefix [--fit doc|slide] [--type 1.3] [--png] [--ascii unicode|ascii] [--check] ... (see README)'); process.exit(2); }
  const diagram = yaml.load(fs.readFileSync(input, 'utf8'));
  // Options come from the YAML's `render:` block; command-line flags override them.
  const R = diagram.render || {};
  const KEY = { '--fit': 'fit', '--type': 'type', '--scale': 'scale', '--direction': 'direction', '--png-scale': 'pngScale',
    '--cols': 'cols', '--zones': 'zones', '--engine': 'engine', '--png-engine': 'pngEngine' };
  const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : (R[KEY[n]] ?? d); };
  const on = (n, key) => args.includes(n) || R[key] === true;
  const elk = {};
  args.forEach((a, i) => { if (a === '--elk') { const [k, v] = args[i + 1].split('='); elk[k] = v; } });
  const check = args.includes('--check');
  args.forEach((a, i) => { if (a === '--gdir') { const [g, d] = args[i + 1].split('='); diagram.groups[g].direction = d; } });
  if (flag('--ascii')) {
    const tt = makeTextTheme(), maxCols = parseInt(flag('--cols', '100'), 10);
    const ranked = await fitLayout(diagram, tt, { target: 'text', overrides: { maxCols }, lockRoot: flag('--direction'), weights: R.weights });
    const best = ranked[0];
    console.error(`  text layout root=${best.root} ${JSON.stringify(best.dirs)} crossings=${best.crossings}`);
    const txt = renderASCII(best.L, tt, diagram, { mode: flag('--ascii') });
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fs.writeFileSync(prefix + '.txt', txt);
    const w = Math.max(...txt.split('\n').map((l) => [...l].length));
    console.log(JSON.stringify({ out: prefix + '.txt', cols: w, rows: txt.split('\n').length }));
    if (check) report(best.L, tt, { cols: w });
    return;
  }
  const theme = makeTheme(parseFloat(flag('--scale', 1)), parseFloat(flag('--type', 1)));
  // --zones obstacle (default: zones as solid shapes) | cluster (libavoid ClusterRef; ~25x slower, see route.js)
  if (flag('--zones')) theme.route = { ...(theme.route || {}), zones: flag('--zones') };
  const overrides = { elk };
  if (flag('--direction')) overrides.direction = flag('--direction');
  if (args.includes('--no-uniform')) overrides.uniform = false;
  if (flag('--hier') === 'separate') elk['elk.hierarchyHandling'] = 'SEPARATE_CHILDREN';
  const engine = flag('--engine', diagram.engine || 'compound');
  let L;
  if (flag('--fit')) {
    const ty = theme.type, chrome = diagram.title && !args.includes('--no-title') ? ty.title.size * 1.3 + ty.subtitle.size * 1.6 + theme.canvasPad * 0.6 : 0;
    // `render.direction` (or --direction) locks the overall direction; otherwise auto-fit tries both.
    const ranked = await fitLayout(diagram, theme, { target: flag('--fit'), overrides, chrome, lockRoot: flag('--direction'), weights: R.weights });
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
  if (on('--png', 'png')) await writePNG(svg, width, height, prefix + '.png', parseFloat(flag('--png-scale', 2)), theme, flag('--png-engine', 'resvg'));
  fs.writeFileSync(prefix + '.layout.json', JSON.stringify({ theme: { scale: theme.scale, type: theme.type }, layout: L }, null, 1));
  // On-slide legibility: fit into the 1800x900 content area of a 1920x1080 slide.
  const fit = Math.min(1800 / width, 900 / height);
  const summary = { out: prefix, width, height, aspect: +(width / height).toFixed(2), slideNodePx: +(theme.type.node.size * fit).toFixed(1), slideEdgePx: +(theme.type.edgeLabel.size * fit).toFixed(1) };
  if (check) report(L, theme, summary); else console.log(JSON.stringify(summary));
}

// --check: one JSON object on stdout ({ ok, violations, crossings, bends, ... }); exit code 1 if any rule
// is broken, so CI can gate on it.
function report(L, theme, summary) {
  const { checkAll } = require('./geom'), { quality } = require('./fit');
  const violations = checkAll(L, theme);
  console.log(JSON.stringify({ ok: violations.length === 0, violations, ...quality(L), ...summary }));
  if (violations.length) process.exitCode = 1;
}
// PNG with the bundled Inter, so it looks the same on every machine.
// Default engine: resvg (a native renderer installed from the npm registry; no browser download).
// --png-engine chromium uses Playwright instead: npm install -D playwright && npx playwright install chromium
async function writePNG(svg, width, height, out, scale, theme, engine = 'resvg') {
  const fonts = ['regular', 'medium', 'semibold', 'bold'].map((k) => theme.fonts[k]);
  if (engine === 'resvg') {
    const { Resvg } = require('@resvg/resvg-js');
    const r = new Resvg(svg, { fitTo: { mode: 'zoom', value: scale }, background: '#ffffff',
      font: { loadSystemFonts: false, fontFiles: fonts, defaultFontFamily: 'Inter' } });
    fs.writeFileSync(out, r.render().asPng());
    return;
  }
  if (engine !== 'chromium') throw new Error(`--png-engine must be resvg or chromium, not ${engine}`);
  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    throw new Error('--png-engine chromium needs Playwright: npm install -D playwright && npx playwright install chromium');
  }
  const face = (file, weight) => `@font-face{font-family:Inter;font-weight:${weight};src:url(data:font/otf;base64,${fs.readFileSync(file).toString('base64')})}`;
  const css = fonts.map((f, i) => face(f, [400, 500, 600, 700][i])).join('');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: Math.ceil(width), height: Math.ceil(height) }, deviceScaleFactor: scale });
    await page.setContent(`<html><head><style>${css}body{margin:0;background:#fff}</style></head><body>${svg}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: out });
  } finally { await browser.close(); }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
