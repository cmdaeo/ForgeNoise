'use strict';
// Hypothesis: ridged multifractal 1−|n| per octave produces a zero-contour
// network. Its connectivity (largest component / total) grows with
// persistence; there's a critical p_c above which the network percolates.

const path = require('path');
const lib = require('../lib');
const { ForgeNoise, ensureDir, writeCSV, writeJSON, writePNG, ensureDir: _e } = lib;

const N       = 512;
const EXTENT  = 8.0;
const SEEDS   = 10;
const P_VALUES = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70];
const EPS_RIDGE = 0.08;

const outDir = path.join(__dirname, 'results');
ensureDir(outDir);

function sampleField(noise, p) {
  const vals = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const y = -EXTENT + 2 * EXTENT * j / (N - 1);
    for (let i = 0; i < N; i++) {
      const x = -EXTENT + 2 * EXTENT * i / (N - 1);
      // "1 − |n|" of raw noise; use ridged fractal
      vals[j * N + i] = noise.generateFractal2D(x, y, { type: 'ridged', octaves: 6, persistence: p });
    }
  }
  return vals;
}

// Ridge mask: values very close to 0 (the fold points)
function ridgeMask(vals) {
  const m = new Uint8Array(vals.length);
  for (let i = 0; i < vals.length; i++) {
    const RIDGE_THRESHOLD = 0.92;
    if (vals[i] > RIDGE_THRESHOLD) m[i] = 1;
  }
  return m;
}

// Connected component labelling via flood fill
function connectedComponents(mask) {
  const labels = new Int32Array(mask.length).fill(-1);
  const sizes = [];
  let next = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i] >= 0) continue;
    const q = [i];
    labels[i] = next;
    let size = 0;
    while (q.length) {
      const j = q.pop();
      size++;
      const x = j % N, y = (j / N) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const k = ny * N + nx;
        if (mask[k] && labels[k] < 0) { labels[k] = next; q.push(k); }
      }
    }
    sizes.push(size);
    next++;
  }
  return { labels, sizes };
}

const rows = [];
console.log(`Running ${P_VALUES.length} p-values × ${SEEDS} seeds at ${N}×${N}`);

for (const p of P_VALUES) {
  const largest_frac = [];
  const n_components = [];
  const total_ridge_pixels = [];

  for (let k = 0; k < SEEDS; k++) {
    const noise = new ForgeNoise(7000 + k);
    const vals = sampleField(noise, p);
    const mask = ridgeMask(vals);
    const total = mask.reduce((a, b) => a + b, 0);
    if (total === 0) { largest_frac.push(0); n_components.push(0); total_ridge_pixels.push(0); continue; }
    const { sizes } = connectedComponents(mask);
    const largest = Math.max(...sizes);
    largest_frac.push(largest / total);
    n_components.push(sizes.length);
    total_ridge_pixels.push(total);
  }

  const r = {
    persistence: p,
    mean_largest_frac: lib.mean(largest_frac),
    std_largest_frac:  lib.std(largest_frac),
    mean_n_components: lib.mean(n_components),
    mean_total_pixels: lib.mean(total_ridge_pixels),
  };
  rows.push(r);
  console.log(`  p=${p.toFixed(2)}  largest_frac=${r.mean_largest_frac.toFixed(3)} ± ${r.std_largest_frac.toFixed(3)}  components=${r.mean_n_components.toFixed(0)}`);
}

// Find p_c = smallest p where largest_frac > 0.5
const pc = rows.find(r => r.mean_largest_frac > 0.5);
console.log('');
console.log(`Percolation threshold p_c: ${pc ? pc.persistence.toFixed(2) : 'not found in range'}`);
console.log(`Hypothesis: transition from fragmented to percolated network: ${pc ? '✓ SUPPORTED' : '✗ FAILED'}`);

writeCSV(path.join(outDir, 'percolation.csv'), rows);
writeJSON(path.join(outDir, 'summary.json'), {
  resolution: N, extent: EXTENT, seeds: SEEDS,
  eps_ridge: EPS_RIDGE,
  percolation_threshold: pc ? pc.persistence : null,
  rows,
});

// Figure: three panels at p = p_c − 0.1, p_c, p_c + 0.1
if (pc) {
  const panels = [pc.persistence - 0.1, pc.persistence, pc.persistence + 0.1].filter(p => p > 0 && p < 1);
  const PW = N * panels.length + (panels.length - 1) * 4;
  const rgb = Buffer.alloc(PW * N * 3);
  const noise = new ForgeNoise(7000);
  for (let pi = 0; pi < panels.length; pi++) {
    const vals = sampleField(noise, panels[pi]);
    const mask = ridgeMask(vals);
    const px0 = pi * (N + 4);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = (j * PW + px0 + i) * 3;
        const v = vals[j * N + i];
        const g = Math.round(Math.max(0, Math.min(1, v * 0.7)) * 220);
        if (mask[j * N + i]) { rgb[k] = 255; rgb[k + 1] = 90; rgb[k + 2] = 60; }
        else { rgb[k] = g; rgb[k + 1] = g; rgb[k + 2] = g; }
      }
    }
  }
  writePNG(path.join(outDir, 'ridge_network.ppm'), PW, N, rgb);
  console.log(`Wrote ${outDir}/ridge_network.ppm (p = ${panels.map(v => v.toFixed(2)).join(' / ')})`);
}