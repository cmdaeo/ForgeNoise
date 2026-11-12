'use strict';
// Figure 4: critical-point density across algorithms.
const path = require('path');
const SVG = require('../svg');
const { readCSV, ensureDir } = require('../lib');

const outDir = path.join(__dirname, 'output');
ensureDir(outDir);

const rows = readCSV(path.join(__dirname, '..', '02-critical-points', 'results', 'per_algorithm.csv'));
const data = rows.map(r => ({
  algo: r.algorithm,
  density: parseFloat(r.mean_density),
  std: parseFloat(r.std_density),
  saddle: parseFloat(r.saddle_ratio),
}));

const W = 720, H = 440;
const ML = 90, MR = 40, MT = 60, MB = 100;
const PW = W - ML - MR, PH = H - MT - MB;
const svg = new SVG(W, H);

const yMax = 8;
const barW = PW / data.length * 0.6;
const barGap = PW / data.length;
const px = i => ML + i * barGap + barGap / 2;
const py = v => MT + PH - (v / yMax) * PH;

// Grid
svg.rect(ML, MT, PW, PH, { fill: '#fafafa', stroke: '#ccc', sw: 1 });
for (let v = 0; v <= yMax; v += 2) {
  svg.line(ML, py(v), ML + PW, py(v), { color: '#eaeaea', width: 1 });
  svg.text(ML - 10, py(v) + 4, String(v), { anchor: 'end', size: 12 });
}

// Bars
const COLORS = { perlin2d: '#e05c33', simplex2d: '#222', os2f_2d: '#1a7aff' };
const LABELS = { perlin2d: 'Perlin', simplex2d: 'Simplex', os2f_2d: 'OS2F' };

for (let i = 0; i < data.length; i++) {
  const d = data[i];
  const x = px(i) - barW / 2;
  const y = py(d.density);
  svg.rect(x, y, barW, MT + PH - y, { fill: COLORS[d.algo] });
  svg.text(px(i), y - 8, d.density.toFixed(2), { anchor: 'middle', size: 13, weight: 'bold' });
  svg.text(px(i), MT + PH + 22, LABELS[d.algo], { anchor: 'middle', size: 13, weight: 'bold' });
  svg.text(px(i), MT + PH + 40, `saddle/peak = ${d.saddle.toFixed(3)}`, { anchor: 'middle', size: 11, color: '#888' });
}

svg.text(ML + PW / 2, H - 20, 'Algorithm', { anchor: 'middle', size: 13, weight: 'bold' });
svg.els.push(`<text x="22" y="${MT + PH / 2}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#000" transform="rotate(-90 22 ${MT + PH / 2})">Critical points per unit²</text>`);
svg.text(ML, 30, 'Critical-point density discriminates 2.2×', { size: 16, weight: 'bold' });
svg.text(ML, 48, 'Saddle/peak ratio is universal (~1.97) across all three', { size: 12, color: '#666' });

svg.save(path.join(outDir, 'fig4-critical-density.svg'));
console.log(`Wrote ${outDir}/fig4-critical-density.svg`);