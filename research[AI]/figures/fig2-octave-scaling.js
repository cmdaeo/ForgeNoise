'use strict';
// Figure 2: s_crit scaling with octave count (log-log).
const path = require('path');
const SVG = require('../svg');
const { readCSV, ensureDir } = require('../lib');

const outDir = path.join(__dirname, 'output');
ensureDir(outDir);

const rows = readCSV(path.join(__dirname, '..', '01-warp-folding', 'results', 'octave_scaling.csv'));
const points = rows.map(r => ({ N: parseInt(r.octaves), sc: parseFloat(r.mean_s_crit), std: parseFloat(r.std_s_crit) }));

// Fit only N >= 4
const fitRows = points.filter(p => p.N >= 4);
const xs = fitRows.map(p => Math.log(p.N));
const ys = fitRows.map(p => Math.log(p.sc));
const n = xs.length;
const sx = xs.reduce((a, b) => a + b, 0);
const sy = ys.reduce((a, b) => a + b, 0);
const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
const sxx = xs.reduce((a, b) => a + b * b, 0);
const alpha = (n * sxy - sx * sy) / (n * sxx - sx * sx);
const intercept = (sy - alpha * sx) / n;
const C = Math.exp(intercept);

// Canvas
const W = 720, H = 500;
const ML = 80, MR = 40, MT = 60, MB = 70;
const PW = W - ML - MR, PH = H - MT - MB;
const svg = new SVG(W, H);

// Bounds
const xMin = Math.log10(0.8), xMax = Math.log10(20);
const yMin = Math.log10(0.03), yMax = Math.log10(0.20);
const px = v => ML + ((Math.log10(v) - xMin) / (xMax - xMin)) * PW;
const py = v => MT + PH - ((Math.log10(v) - yMin) / (yMax - yMin)) * PH;

// Grid
svg.rect(ML, MT, PW, PH, { fill: '#fafafa', stroke: '#ccc', sw: 1 });
for (let v = 1; v <= 16; v *= 2) {
  const x = px(v);
  svg.line(x, MT, x, MT + PH, { color: '#e0e0e0', width: 1 });
  svg.text(x, MT + PH + 20, String(v), { anchor: 'middle', size: 13 });
}
for (let v = 0.03; v <= 0.20; v *= 2) {
  const y = py(v);
  svg.line(ML, y, ML + PW, y, { color: '#e0e0e0', width: 1 });
  svg.text(ML - 10, y + 4, v.toFixed(2), { anchor: 'end', size: 12 });
}

// Theory line: s_crit = C · N^-0.5
const theoryPts = [];
for (let N = 1; N <= 20; N *= 1.05) theoryPts.push([px(N), py(C * Math.pow(N, -0.5))]);
svg.polyline(theoryPts, { stroke: '#999', width: 2, fill: 'none' });
// Add dasharray by patching: not supported in polyline helper - use line pieces instead
// Simpler: draw the fitted line as solid, theory as dashed via multiple segments
svg.els.pop();  // remove solid theory line
for (let N = 1; N < 20; N *= 1.2) {
  const n2 = Math.min(20, N * 1.2);
  svg.line(px(N), py(C * Math.pow(N, -0.5)), px(n2), py(C * Math.pow(n2, -0.5)), { color: '#999', width: 2, dash: '6,4' });
}

// Fit line: s_crit = C · N^alpha
const fitPts = [];
for (let N = 4; N <= 16; N *= 1.05) fitPts.push([px(N), py(C * Math.pow(N, alpha))]);
svg.polyline(fitPts, { stroke: '#e05c33', width: 2.5, fill: 'none' });

// Data points + error bars
for (const p of points) {
  const x = px(p.N), y = py(p.sc);
  const yHi = py(p.sc + p.std), yLo = py(p.sc - p.std);
  svg.line(x, yHi, x, yLo, { color: '#333', width: 1.5 });
  svg.line(x - 6, yHi, x + 6, yHi, { color: '#333', width: 1.5 });
  svg.line(x - 6, yLo, x + 6, yLo, { color: '#333', width: 1.5 });
  svg.circle(x, y, 5, { fill: '#222', stroke: '#fff', sw: 1.5 });
}

// Labels
svg.text(ML + PW / 2, H - 20, 'Octave count N', { anchor: 'middle', size: 14, weight: 'bold' });
svg.text(20, MT + PH / 2, 's_crit', { anchor: 'middle', size: 14, weight: 'bold' });
svg.text(W - 20, MT + PH / 2, '', { anchor: 'middle' });  // placeholder
svg.text(ML - 55, MT + PH / 2, 's_crit', {
  anchor: 'middle', size: 14, weight: 'bold',
});
// Rotated y-axis label - use manual rotate via separate text element
svg.els.push(`<text x="20" y="${MT + PH / 2}" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="bold" text-anchor="middle" fill="#000" transform="rotate(-90 20 ${MT + PH / 2})">s_crit (fold threshold)</text>`);

// Title
svg.text(ML, 30, 'Warp folding threshold vs octave count', { size: 16, weight: 'bold' });

// Legend
const lx = ML + PW - 200, ly = MT + 20;
svg.line(lx, ly, lx + 30, ly, { color: '#e05c33', width: 2.5 });
svg.text(lx + 36, ly + 4, `fit: s_crit ∝ N^${alpha.toFixed(2)}`, { size: 12 });
svg.line(lx, ly + 22, lx + 30, ly + 22, { color: '#999', width: 2, dash: '6,4' });
svg.text(lx + 36, ly + 26, 'theory: N^-0.5', { size: 12 });

svg.save(path.join(outDir, 'fig2-octave-scaling.svg'));
console.log(`Wrote ${outDir}/fig2-octave-scaling.svg`);
console.log(`Fit: s_crit = ${C.toFixed(4)} · N^${alpha.toFixed(3)}`);