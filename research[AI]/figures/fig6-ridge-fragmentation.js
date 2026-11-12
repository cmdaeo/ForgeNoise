'use strict';
// Figure 6: ridge network fragmentation vs persistence.
const path = require('path');
const SVG = require('../svg');
const { readCSV, ensureDir } = require('../lib');

const outDir = path.join(__dirname, 'output');
ensureDir(outDir);

const rows = readCSV(path.join(__dirname, '..', '03-ridge-topology', 'results', 'percolation.csv'));
const data = rows.map(r => ({
  p: parseFloat(r.persistence),
  frac: parseFloat(r.mean_largest_frac),
  std: parseFloat(r.std_largest_frac),
  comp: parseFloat(r.mean_n_components),
}));

const W = 720, H = 460;
const ML = 90, MR = 90, MT = 60, MB = 70;
const PW = W - ML - MR, PH = H - MT - MB;
const svg = new SVG(W, H);

const xMin = 0.28, xMax = 0.72;
const yMin = 0, yMax = 0.05;
const px = v => ML + ((v - xMin) / (xMax - xMin)) * PW;
const py = v => MT + PH - ((v - yMin) / (yMax - yMin)) * PH;

svg.rect(ML, MT, PW, PH, { fill: '#fafafa', stroke: '#ccc', sw: 1 });
for (let v = 0; v <= 0.05; v += 0.01) {
  svg.line(ML, py(v), ML + PW, py(v), { color: '#eaeaea', width: 1 });
  svg.text(ML - 10, py(v) + 4, v.toFixed(2), { anchor: 'end', size: 12 });
}
for (let v = 0.3; v <= 0.7; v += 0.1) {
  svg.line(px(v), MT, px(v), MT + PH, { color: '#eaeaea', width: 1 });
  svg.text(px(v), MT + PH + 20, v.toFixed(1), { anchor: 'middle', size: 12 });
}

// Error bar + line
const pts = data.map(r => [px(r.p), py(r.frac)]);
for (const r of data) {
  const x = px(r.p);
  svg.line(x, py(r.frac - r.std), x, py(r.frac + r.std), { color: '#666', width: 1.5 });
  svg.line(x - 5, py(r.frac + r.std), x + 5, py(r.frac + r.std), { color: '#666', width: 1.5 });
  svg.line(x - 5, py(r.frac - r.std), x + 5, py(r.frac - r.std), { color: '#666', width: 1.5 });
}
svg.polyline(pts, { stroke: '#222', width: 2.5, fill: 'none' });
for (const p of pts) svg.circle(p[0], p[1], 5, { fill: '#222', stroke: '#fff', sw: 1.5 });

// Component count on right axis
const compMax = Math.max(...data.map(d => d.comp));
const pcy = v => MT + PH - (v / compMax) * PH;
const cpts = data.map(r => [px(r.p), pcy(r.comp)]);
svg.polyline(cpts, { stroke: '#e05c33', width: 2, fill: 'none' });
for (const p of cpts) svg.circle(p[0], p[1], 4, { fill: '#e05c33', stroke: '#fff', sw: 1 });
for (let v = 0; v <= compMax; v += 500) {
  svg.text(ML + PW + 10, pcy(v) + 4, String(v), { size: 11, anchor: 'start', color: '#e05c33' });
}

// Labels
svg.text(ML + PW / 2, H - 20, 'Persistence p', { anchor: 'middle', size: 13, weight: 'bold' });
svg.els.push(`<text x="22" y="${MT + PH / 2}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#000" transform="rotate(-90 22 ${MT + PH / 2})">Largest component fraction</text>`);
svg.els.push(`<text x="${W - 18}" y="${MT + PH / 2}" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="bold" text-anchor="middle" fill="#e05c33" transform="rotate(90 ${W - 18} ${MT + PH / 2})">Component count</text>`);

svg.text(ML, 30, 'Ridge networks fragment with persistence (no percolation)', { size: 16, weight: 'bold' });
svg.text(ML, 48, 'Largest fraction shrinks 5×, component count triples - negative result', { size: 12, color: '#666' });

// Legend
const lx = ML + 20, ly = MT + 30;
svg.line(lx, ly, lx + 24, ly, { color: '#222', width: 2.5 });
svg.text(lx + 30, ly + 4, 'largest fraction', { size: 12 });
svg.line(lx, ly + 22, lx + 24, ly + 22, { color: '#e05c33', width: 2 });
svg.text(lx + 30, ly + 26, 'component count', { size: 12 });

svg.save(path.join(outDir, 'fig6-ridge-fragmentation.svg'));
console.log(`Wrote ${outDir}/fig6-ridge-fragmentation.svg`);