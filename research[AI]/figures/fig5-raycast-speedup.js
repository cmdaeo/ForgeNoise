'use strict';
// Figure 5: Newton iterations vs bisection on implicit heightmap raycasting.
const path = require('path');
const SVG = require('../svg');
const { readCSV, ensureDir } = require('../lib');

const outDir = path.join(__dirname, 'output');
ensureDir(outDir);

const rows = readCSV(path.join(__dirname, '..', '07-raycast', 'results', 'per_tolerance.csv'));

const W = 720, H = 460;
const ML = 90, MR = 160, MT = 60, MB = 70;
const PW = W - ML - MR, PH = H - MT - MB;
const svg = new SVG(W, H);

const xMin = Math.log10(1e-7 * 0.5), xMax = Math.log10(1e-3 * 2);
const yMax = 30;
const px = v => ML + ((Math.log10(v) - xMin) / (xMax - xMin)) * PW;
const py = v => MT + PH - (v / yMax) * PH;

// Grid
svg.rect(ML, MT, PW, PH, { fill: '#fafafa', stroke: '#ccc', sw: 1 });
for (let y = 0; y <= yMax; y += 5) {
  svg.line(ML, py(y), ML + PW, py(y), { color: '#eaeaea', width: 1 });
  svg.text(ML - 10, py(y) + 4, String(y), { anchor: 'end', size: 12 });
}
for (const tol of [1e-7, 1e-6, 1e-5, 1e-4, 1e-3]) {
  const x = px(tol);
  svg.line(x, MT, x, MT + PH, { color: '#eaeaea', width: 1 });
  svg.text(x, MT + PH + 20, tol.toExponential(0), { anchor: 'middle', size: 11 });
}

// Series
const series = [
  { key: 'bisection_evals',      color: '#999',    label: 'Bisection', width: 2 },
  { key: 'fd_evals',             color: '#e05c33', label: 'Newton (finite-diff)', width: 2 },
  { key: 'analytic_evals',       color: '#222',    label: 'Newton (analytic)', width: 3 },
];

for (const s of series) {
  const pts = rows.map(r => [px(parseFloat(r.tolerance)), py(parseFloat(r[s.key]))]);
  svg.polyline(pts, { stroke: s.color, width: s.width, fill: 'none' });
  for (let i = 0; i < pts.length; i++) {
    svg.circle(pts[i][0], pts[i][1], 5, { fill: s.color, stroke: '#fff', sw: 1.5 });
  }
}

// Legend (right side)
const lx = ML + PW + 20, ly = MT + 30;
for (let i = 0; i < series.length; i++) {
  const s = series[i];
  svg.line(lx, ly + i * 26, lx + 24, ly + i * 26, { color: s.color, width: s.width });
  svg.circle(lx + 12, ly + i * 26, 4, { fill: s.color });
  svg.text(lx + 32, ly + i * 26 + 4, s.label, { size: 12 });
}

// Axis labels
svg.text(ML + PW / 2, H - 20, 'Tolerance ε', { anchor: 'middle', size: 13, weight: 'bold' });
svg.els.push(`<text x="22" y="${MT + PH / 2}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#000" transform="rotate(-90 22 ${MT + PH / 2})">Noise evaluations per ray</text>`);
svg.text(ML, 30, 'Raycasting cost: noise evaluations per ray', { size: 16, weight: 'bold' });
svg.text(ML, 48, 'Newton with analytic gradient uses 4.9-8.2× fewer evaluations than bisection', { size: 12, color: '#666' });

svg.save(path.join(outDir, 'fig5-raycast-speedup.svg'));
console.log(`Wrote ${outDir}/fig5-raycast-speedup.svg`);