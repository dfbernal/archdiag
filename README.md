# archdiag (prototype)

Architecture diagrams from code, rendered like a hand-placed Lucidchart, with a plain-text version for Slack.

```
diagram.yaml ──► layout (elkjs, compound) ──► routing (libavoid) ──► labels ──┬─► SVG / PNG
                                                                             └─► Unicode / ASCII text
```

## Why it looks cleaner than D2 / Mermaid

- **Compound layout with lifted edges.** Each zone is laid out on its own with ELK in its own direction;
  one level up, the zone is a single box and the real edges are "lifted" onto it, so the big picture follows the flow.
  A lifted edge attaches to a port where the real inner box sits, and inside a zone that flows across its
  parent, boxes whose links leave the zone are placed on the exit side, so lines don't cut across the zone.
- **Separate connector routing (libavoid).** Placement and routing are separate steps, the way Lucidchart and Visio
  smart connectors work. Pins are flow-aware (lines leave a box on the side facing the flow), unrelated zones are
  obstacles, shared trunks are penalised, and small doglegs are straightened.
- **Alignment pass.** Neighbouring zones slide so connected boxes line up (Shoppers → Cloudflare → Gateway is one straight line).
- **Labels go on their own stretch of line**, never on a segment another connector shares, and never over a box.
- **Design system in one file** (`src/theme.js`): type scale, card sizes, colours and spacing. Type size is
  independent of spacing (`--type`), so a slide can have big text without huge gaps.
- **Auto-fit.** `--fit slide|doc` tries every combination of zone directions and keeps the one with the biggest
  on-screen text, fewest crossings and fewest bends.

## The one-shot pipeline (what happens on every render, no hand tweaks)

1. **Measure** every label with the real font, and give same-kind boxes one size.
2. **Lay out each zone on its own** (ELK), inside-out, in that zone's direction. Edges between zones are
   "lifted" onto the zone boxes, so the overall arrangement follows the real flow.
3. **Align** neighbouring zones so connected boxes sit in a straight line.
4. **Route connectors** with libavoid: flow-aware pins (leave a box facing the flow, enter mildly
   preferring the opposite side), zones and zone titles as obstacles, shared trunks penalised, then
   straighten small doglegs.
5. **Quality gate.** Check every connector against these rules:
   - doesn't touch any box except its own two (with clearance)
   - doesn't enter a zone it has nothing to do with
   - doesn't run along the border of its own zone
   - doesn't cross a zone title, or squeeze between a zone's corner and its title
   A connector that fails is re-routed alone, with exactly the obstacles it must avoid. Overlapping parallel
   lines are pulled apart. Titles never move: every zone has a title row (margin, title, turn lane) so
   lines come in beside the title and turn under it, as you'd draw it in Lucidchart.
6. **Make room.** If anything still fails, widen the gaps and redo steps 2-5 (up to two more times).
7. **Auto-fit.** All of this runs for every combination of zone directions. The layout kept is the one with
   zero rule breaks, then the biggest readable text for the target (slides need at least ~14px), then the
   fewest crossings and bends.
8. **Labels** go on a stretch of line that belongs only to their connector, clear of boxes and titles.

The YAML only says *what* connects to what. You don't position anything. The CLI prints any remaining
rule breaks, so problems are reported, not discovered by eye.

## Use it in your project

```bash
# Once: install archdiag as a dev dependency, whichever way suits you
npm install -D github:<you>/archdiag          # from your Git repo (add #tag to pin a version)
npm install -D ../archdiag                    # from a local folder (run npm install in that folder once)
npm install -g github:<you>/archdiag          # or as a global `archdiag` command
# Optional, for --png: headless Chromium
npm install -D playwright && npx playwright install chromium

# Describe your system in YAML (format below), then render:
npx archdiag docs/architecture.yaml docs/architecture --fit doc --type 1.3 --png   # README image (SVG + PNG)
npx archdiag docs/architecture.yaml docs/arch-slide --fit slide --type 1.6 --png   # 16:9 slide
npx archdiag docs/architecture.yaml docs/architecture --ascii unicode --cols 100   # Slack / terminal text
```

- Needs Node 18+. Outputs: `<prefix>.svg`, `<prefix>.png` (with `--png`, 2× by default, `--png-scale 1`),
  `<prefix>.txt` (text mode) and `<prefix>.layout.json` (positions, for debugging).
- **Icons:** `icon: name` looks for `name.svg` in `--icons <dir>`, then in an `icons/` folder next to your YAML,
  then in archdiag's built-in set (cloudflare, grafana, kafka, kubernetes, minio, nginx, postgresql, redis, stripe).
- **For GitHub READMEs, commit the PNG.** The SVG names the Inter font but doesn't embed it, so on a machine
  without Inter the text falls back to Helvetica/Arial and can overflow its boxes. The PNG always uses Inter.
- Add a script so the diagram is re-rendered with the docs: `"diagram": "archdiag docs/architecture.yaml docs/architecture --fit doc --type 1.3 --png"`.
- The CLI prints any remaining rule breaks on stderr; an empty report means the layout passed every check.
- The patched libavoid build ships as plain files in `vendor/libavoid-js/` (see PATCHED.md there), not as an npm
  dependency, so every install method above behaves the same. `npm pack` still makes a tarball if you want one.

## Usage (from this folder)

```bash
npm install
# Slide (16:9), text 1.6x the base size
node src/cli.js examples/checkout.yaml out/slide --fit slide --type 1.6
# README / doc page (fits a ~1600px column)
node src/cli.js examples/checkout.yaml out/doc --fit doc --type 1.3
# Slack / terminal text (Unicode box drawing, or --ascii ascii for plain ASCII)
node src/cli.js examples/checkout.yaml out/slack --ascii unicode --cols 100
# Zones as libavoid clusters instead of obstacles (~25x slower)
node src/cli.js examples/checkout.yaml out/doc --fit doc --type 1.3 --zones cluster
# Print every route and repair (debugging)
ARCHDIAG_DEBUG=1 node src/cli.js examples/checkout.yaml out/doc --fit doc --type 1.3
# Manual control instead of auto-fit
node src/cli.js examples/checkout.yaml out/x --engine compound --direction right --gdir k8s=down --gdir async=right
```

Output: `<prefix>.svg` (open in a browser, or convert to PNG with any headless browser) and `<prefix>.txt`.
The CLI prints width/height and the node text size you'd get on a 1920×1080 slide.

## Diagram format

```yaml
title: Checkout Platform
subtitle: Request path, async fulfilment and data tier
groups:
  k8s:   { label: Kubernetes Cluster, color: blue, icon: kubernetes }
  async: { label: Async Fulfilment, color: amber, parent: k8s, direction: down }
nodes:
  gw:    { label: API Gateway, sub: NGINX, group: k8s, icon: nginx }
  pg:    { label: Postgres, sub: primary DB, group: data, kind: datastore }
  # kinds: service (default), datastore, queue, external, actor
edges:
  - gw -> orders: { label: POST /orders }               # style: request (default)
  - orders -> kafka: { label: order.created, style: async }
  - orders -> pg: { label: write, style: data }
```

Colours: blue, orange, amber, green, violet, slate. Icons: any SVG in `icons/` by file name.

## Known limitations (prototype)

- Zones are obstacles. `--zones cluster` uses libavoid's real `ClusterRef` (patched build in `vendor/`), but its
  clusters are a crossing penalty, not clearance, so it's slower and wasn't better here. Either way a line
  can still run ~10px outside a zone edge on its way in (the checker only flags < 8px).
- libavoid-js is a patched local build (`vendor/libavoid-js/`): ClusterRef bindings plus a libavoid fix that makes
  pin costs apply at the target end of a connector. See CONTEXT.md §5.
- Dense diagrams (12+ nodes with sub-labels) land around 16px on a slide; split the diagram or drop sub-labels for talks.
- Text mode can leave long vertical runs; a compaction pass would tighten it.
- No interactive editing yet. The natural next step is a React Flow canvas where dragging a box writes a position hint back into the YAML.
