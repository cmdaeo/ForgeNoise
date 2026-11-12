'use strict';
// Hypothesis 1: critical points (where ∇n = 0) can be located by Newton
// iteration on the analytic gradient.
// Hypothesis 2: for a generic stationary field, #saddles ≈ 2·#peaks.
// Deviation from this ratio is a measure of lattice artifacts.

const path = require('path');
const lib = require('../lib');
const {
  ForgeNoise, ensureDir, writeCSV, writeJSON,
  mean, std, min, max,
  fdGrad,
} = lib;

const GRID     = 128;      // cell-scan resolution
const EXTENT   = 6.0;
const SEEDS    = 20;
const NEWTON_ITERS = 20;

const outDir = path.join(__dirname, 'results');
ensureDir(outDir);

// Find all critical points by:
//   1. Scan grid, mark cells where both gx and gy cross zero
//   2. Newton-refine from cell center using FD Hessian
//   3. Deduplicate
function findCriticalPoints(derivFn) {
  const eps = 1e-3;
  const grad = (x, y, out) => derivFn(x, y, out);

  const g = new Float64Array(3);
  const gp = new Float64Array(3);

  const points = [];
  const h = 2 * EXTENT / (GRID - 1);

  for (let j = 0; j < GRID - 1; j++) {
    const y0 = -EXTENT + j * h;
    for (let i = 0; i < GRID - 1; i++) {
      const x0 = -EXTENT + i * h;

      // 4 corners
      const gs = [
        grad(x0,     y0,     g).slice ? [g[1], g[2]] : null,
      ];
      // simpler: inline
      const g00x = (grad(x0,     y0, g), g[1]);
      const g00y = g[2];
      const g10x = (grad(x0 + h, y0, g), g[1]);
      const g10y = g[2];
      const g01x = (grad(x0, y0 + h, g), g[1]);
      const g01y = g[2];
      const g11x = (grad(x0 + h, y0 + h, g), g[1]);
      const g11y = g[2];

      const gxMin = Math.min(g00x, g10x, g01x, g11x);
      const gxMax = Math.max(g00x, g10x, g01x, g11x);
      const gyMin = Math.min(g00y, g10y, g01y, g11y);
      const gyMax = Math.max(g00y, g10y, g01y, g11y);

      if (gxMin * gxMax > 0) continue;
      if (gyMin * gyMax > 0) continue;

      // Newton from cell center
      let cx = x0 + h / 2, cy = y0 + h / 2;
      let converged = false;
      for (let iter = 0; iter < NEWTON_ITERS; iter++) {
        const gx = (grad(cx, cy, g), g[1]);
        const gy = g[2];
        const gnorm = Math.hypot(gx, gy);
        if (gnorm < 1e-5) { converged = true; break; }

        // FD Hessian
        const gpx = (grad(cx + eps, cy, gp), gp[1]);
        const gpy = gp[2];
        const gqy = (grad(cx, cy + eps, gp), gp[2]);
        const gqx = gp[1];
        const hxx = (gpx - gx) / eps;
        const hyx = (gpy - gy) / eps;
        const hxy = (gqx - gx) / eps;
        const hyy = (gqy - gy) / eps;

        const det = hxx * hyy - hxy * hyx;
        if (Math.abs(det) < 1e-10) break;
        const ddx = ( hyy * gx - hxy * gy) / det;
        const ddy = (-hyx * gx + hxx * gy) / det;
        cx -= ddx; cy -= ddy;
        if (Math.abs(cx) > 3 * EXTENT || Math.abs(cy) > 3 * EXTENT) break;
      }

      if (converged) {
        // Classify by Hessian eigenvalues at the critical point
        const gx = (grad(cx, cy, g), g[1]);
        const gy = g[2];
        const gpx = (grad(cx + eps, cy, gp), gp[1]);
        const gpy = gp[2];
        const gqy = (grad(cx, cy + eps, gp), gp[2]);
        const gqx = gp[1];
        const hxx = (gpx - gx) / eps;
        const hyx = (gpy - gy) / eps;
        const hxy = (gqx - gx) / eps;
        const hyy = (gqy - gy) / eps;

        const trace = hxx + hyy;
        const detH = hxx * hyy - hxy * hyx;
        const discH = Math.sqrt(Math.max(0, trace * trace / 4 - detH));
        const l1 = trace / 2 + discH;
        const l2 = trace / 2 - discH;

        let type;
        if (l1 < 0 && l2 < 0) type = 'peak';
        else if (l1 > 0 && l2 > 0) type = 'valley';
        else type = 'saddle';

        points.push({ x: cx, y: cy, l1, l2, type });
      }
    }
  }

  // Deduplicate within ~0.01 world units
  const seen = new Set();
  const unique = [];
  for (const p of points) {
    const key = `${Math.round(p.x * 100)}|${Math.round(p.y * 100)}`;
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
  }
  return unique;
}

// ── Main ──────────────────────────────────────────────────────
const algorithms = ['simplex2d', 'perlin2d', 'os2f_2d'];
const area = (2 * EXTENT) ** 2;

const rows = [];
for (const algo of algorithms) {
  console.log(`\n=== ${algo} ===`);
  const peaks = [], valleys = [], saddles = [];
  const densities = [];

  for (let k = 0; k < SEEDS; k++) {
    const seed = 2000 + k;
    const noise = new ForgeNoise(seed);
    let derivFn;
    if (algo === 'simplex2d') {
      derivFn = (x, y, out) => noise.generateSimplex2D_Derivative(x, y, out);
    } else if (algo === 'perlin2d') {
      derivFn = (x, y, out) => fdGrad(noise, x, y, 'perlin', out);
    } else if (algo === 'os2f_2d') {
      derivFn = (x, y, out) => fdGrad(noise, x, y, 'os2f', out);
    } else {
      throw new Error('unknown algo: ' + algo);
    }

    const cps = findCriticalPoints(derivFn);
    const np = cps.filter(c => c.type === 'peak').length;
    const nv = cps.filter(c => c.type === 'valley').length;
    const ns = cps.filter(c => c.type === 'saddle').length;
    peaks.push(np); valleys.push(nv); saddles.push(ns);
    densities.push(cps.length / area);
  }

  const mp = mean(peaks), mv = mean(valleys), ms = mean(saddles);
  const saddleRatio = ms / ((mp + mv) / 2 + 1e-9);  // should be ≈ 2 for Gaussian

  console.log(`  peaks:   ${mp.toFixed(1)}  valleys: ${mv.toFixed(1)}  saddles: ${ms.toFixed(1)}`);
  console.log(`  saddle/peak_avg ratio: ${saddleRatio.toFixed(3)}  (Gaussian prediction: 2.0)`);
  console.log(`  density: ${mean(densities).toFixed(3)} per unit²`);

  rows.push({
    algorithm: algo,
    mean_peaks: mp,
    mean_valleys: mv,
    mean_saddles: ms,
    std_saddles: std(saddles),
    saddle_ratio: saddleRatio,
    mean_density: mean(densities),
    std_density: std(densities),
  });
}

// Hypothesis test
console.log('');
console.log('=== Hypothesis: saddle/peak ≈ 2 for Gaussian-like fields ===');
for (const r of rows) {
  const err = Math.abs(r.saddle_ratio - 2);
  console.log(`  ${r.algorithm.padEnd(12)}  ratio=${r.saddle_ratio.toFixed(3)}  ` +
              `error from 2: ${err.toFixed(3)}  ${err < 0.3 ? '(Gaussian-like)' : '(deviates)'}`);
}

writeCSV(path.join(outDir, 'per_algorithm.csv'), rows);
writeJSON(path.join(outDir, 'summary.json'), {
  seeds: SEEDS, grid: GRID, extent: EXTENT,
  gaussian_saddle_ratio_expected: 2.0,
  results: rows,
});

console.log('');
console.log(`Wrote ${outDir}/per_algorithm.csv`);
console.log(`Wrote ${outDir}/summary.json`);