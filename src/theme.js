// Design tokens: every visual decision lives here so diagrams stay consistent.
const path = require('path');
// Inter (SIL Open Font License) ships in fonts/; ARCHDIAG_FONT_DIR points elsewhere if you need to.
const FONT_DIR = process.env.ARCHDIAG_FONT_DIR || path.join(__dirname, '..', 'fonts');

const palette = {
  blue:   { stroke: '#3B82F6', fill: '#F3F7FF', text: '#1E40AF' },
  orange: { stroke: '#F97316', fill: '#FFF8F1', text: '#9A3412' },
  amber:  { stroke: '#D97706', fill: '#FFFBEB', text: '#92400E' },
  green:  { stroke: '#059669', fill: '#F0FDF6', text: '#065F46' },
  violet: { stroke: '#7C3AED', fill: '#F7F3FF', text: '#5B21B6' },
  slate:  { stroke: '#64748B', fill: '#F8FAFC', text: '#334155' },
};

const edgeStyles = {
  request: { color: '#4F46E5', dash: null, label: '#3730A3' },
  async:   { color: '#D97706', dash: '7 5', label: '#92400E' },
  data:    { color: '#059669', dash: null, label: '#065F46' },
};

function makeTheme(scale = 1, typeScale = 1) {
  const s = (n) => Math.round(n * scale * 10) / 10;
  const ts = (n) => Math.round(n * scale * typeScale * 10) / 10;
  return {
    scale,
    fonts: {
      regular: path.join(FONT_DIR, 'Inter-Regular.otf'),
      medium: path.join(FONT_DIR, 'Inter-Medium.otf'),
      semibold: path.join(FONT_DIR, 'Inter-SemiBold.otf'),
      bold: path.join(FONT_DIR, 'Inter-Bold.otf'),
    },
    family: "Inter, 'Helvetica Neue', Arial, sans-serif",
    // Type scale: one ratio between tiers so hierarchy reads at a glance.
    type: {
      title:     { size: ts(34), weight: 'bold' },
      subtitle:  { size: ts(18), weight: 'regular' },
      group:     { size: ts(17), weight: 'semibold' },
      node:      { size: ts(19), weight: 'semibold' },
      nodeSub:   { size: ts(14), weight: 'regular' },
      edgeLabel: { size: ts(14), weight: 'medium' },
    },
    node: {
      padX: s(18), padY: s(14), minW: s(170), icon: ts(30), iconGap: s(12),
      lineGap: s(4), radius: s(10), stroke: s(1.5), accent: s(4),
    },
    group: { padX: s(44), padTop: s(60), padBottom: s(36), radius: s(16), stroke: s(1.5) },
    edge: { width: ts(2), radius: s(10), arrow: ts(9), labelPadX: ts(8), labelPadY: ts(4), labelRadius: s(6) },
    spacing: {
      nodeNode: s(36),          // between nodes in the same layer
      betweenLayers: s(72),     // between columns (or rows when vertical)
      edgeNode: s(24),
      edgeEdge: s(16),
      edgeLabel: s(6),
    },
    canvasPad: s(48),
    palette, edgeStyles,
    ink: '#0F172A', muted: '#64748B', cardFill: '#FFFFFF', cardStroke: '#CBD5E1',
  };
}

// Text-mode theme: every distance is a whole number of character cells (cw x ch pixels).
function makeTextTheme() {
  const cw = 10, ch = 20, t = makeTheme(1, 1);
  t.charMode = { cw, ch };
  for (const k of Object.keys(t.fonts)) t.fonts[k] = 'CHAR';
  for (const k of Object.keys(t.type)) t.type[k].size = cw;
  t.edge = { ...t.edge, labelPadX: 0, labelPadY: 0 };
  t.group = { padX: 3 * cw, padTop: 2 * ch, padBottom: 1 * ch, radius: 0, stroke: 1 };
  t.spacing = { nodeNode: 1 * ch, betweenLayers: 6 * cw, edgeNode: ch, edgeEdge: ch, edgeLabel: 0 };
  // No entry-side preference on the character grid: it only adds crossings there (measured on checkout.yaml).
  t.route = { buffer: ch * 0.5, nudge: ch, segmentPenalty: 200, inSideCosts: [0, 0] };
  t.canvasPad = 0;
  return t;
}

module.exports = { makeTheme, makeTextTheme, palette, edgeStyles };
