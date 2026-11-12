'use strict';
// Figure 3: R₄ (square lattice) vs R₆ (triangular lattice) scatter.
const path = require('path');
const SVG = require('../svg');
const { readCSV, ensureDir } = require('../lib');

const outDir = path.join(__dirname, 'output');
ensureDir(outDir);

const rows = readCSV(path.join(__dirname, '..', '04-isotropy', 'results', 'per_algorithm.csv'));

const W = 720, H = 560;
const ML = 80, MR = 40, MT = 70, MB = 70;
const PW = W - ML - MR, PH = H - MT - MB;
const svg = new SVG(W, H);

const xMax = 0.35, yMax = 0.35;
const px = v => ML + (v / xMax) * PW;
const py = v => MT + PH - (v / yMax) * PH;

// Grid
svg.rect(ML, MT, PW, PH, { fill: '#fafafa', stroke: '#ccc', sw: 1 });
for (let v = 0; v <= 0.35; v += 0.05) {
  svg.line(px(v), MT, px(v), MT + PH, { color: '#eaeaea', width: 1 });
  svg.line(ML, py(v), ML + PW, py(v), { color: '#eaeaea', width: 1 });
  svg.text(px(v), MT + PH + 20, v.toFixed(2), { anchor: 'middle', size: 11 });
  svg.text(ML - 8, py(v) + 4, v.toFixed(2), { anchor: 'end', size: 11 });
}

// Diagonal reference (isotropic)
svg.line(px(0), py(0), px(xMax), py(yMax), { color: '#ddd', width: 1.5, dash: '4,4' });

// Data points
const COLORS = {
  perlin2d: '#e05c33',
  simplex2d: '#222',
  os2f_2d: '#1a7aff',
  os2s_2d: '#4caf50',
};
const LABELS = {
  perlin2d: 'Perlin 2D',
  simplex2d: 'Simplex 2D',
  os2f_2d: 'OpenSimplex2F',
  os2s_2d: 'OpenSimplex2S',
};

for (const r of rows) {
  const x = px(parseFloat(r.dir_concentration_6));
  const y = py(parseFloat(r.dir_concentration_4));
  svg.circle(x, y, 10, { fill: COLORS[r.algorithm], stroke: '#fff', sw: 2 });
  svg.text(x + 15, y + 5, LABELS[r.algorithm], { size: 13, weight: 'bold', color: COLORS[r.algorithm] });
}

// Quadrant labels
svg.text(ML + PW - 10, MT + 20, 'square-lattice signature →', { anchor: 'end', size: 11, color: '#888' });
svg.text(ML + 10, MT + PH - 10, '← triangular-lattice signature', { anchor: 'start', size: 11, color: '#888' });

// Axes
svg.text(ML + PW / 2, H - 20, 'R₆  (six-fold concentration - triangular lattice)', { anchor: 'middle', size: 13, weight: 'bold' });
svg.els.push(`<text x="22" y="${MT + PH / 2}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#000" transform="rotate(-90 22 ${MT + PH / 2})">R₄  (four-fold concentration - square lattice)</text>`);

svg.text(ML, 30, 'Lattice fingerprint: R₄ vs R₆', { size: 16, weight: 'bold' });
svg.text(ML, 50, 'Perlin sits in square-lattice corner; Simplex/OS2 in triangular', { size: 12, color: '#666' });

svg.save(path.join(outDir, 'fig3-lattice-fingerprint.svg'));
console.log(`Wrote ${outDir}/fig3-lattice-fingerprint.svg`);