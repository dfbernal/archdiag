// Real text measurement from the font files, so boxes fit their labels exactly.
const opentype = require('opentype.js');
const fs = require('fs');
const cache = {};
function font(file) {
  if (!cache[file]) { const b = fs.readFileSync(file); cache[file] = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  return cache[file];
}
function textWidth(text, size, file) {
  if (file === 'CHAR') return [...String(text)].length * size; // text mode: size is the cell width
  // Per-glyph advances + pair kerning (avoids opentype.js's incomplete shaping engine).
  const f = font(file), k = size / f.unitsPerEm;
  const glyphs = [...String(text)].map((c) => f.charToGlyph(c));
  let w = 0;
  glyphs.forEach((g, i) => { w += g.advanceWidth; if (i + 1 < glyphs.length) w += f.getKerningValue(g, glyphs[i + 1]) || 0; });
  return w * k;
}
module.exports = { textWidth };
