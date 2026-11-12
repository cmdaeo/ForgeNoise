'use strict';
// Hypothesis: for a 4D gradient noise field, slicing (x, y, z, t) with t as
// time produces a 3D slice that is stationary in t: variance, mean gradient
// magnitude, and sign-change rate are constant across t. Deviations signal
// the slice is drifting through an anisotropic lattice.

const path = require('path');
const lib = require('../lib');
const { ForgeNoise, ensureDir, writeCSV, writeJSON, mean, std, quantile } = lib;

const G = 24;              // 24³ samples per slice
const EXTENT = 4.0;
const T_VALUES = [];
for (let i = 0; i < 40; i++) T_VALUES.push(i * 0.1);
const SLICE_ALGOS = ['simplex4d'];  // space for more
const h = 1e-3;

const outDir = path.join(__dirname, 'results');
ensureDir(outDir);

function analyzeSlice(noise, t) {
  const vals = new Float64Array(G * G * G);
  const grad = new Float64Array(G * G * G);
  for (let k = 0; k < G; k++) {
    const z = -EXTENT + 2 * EXTENT * k / (G - 1);
    for (let j = 0; j < G; j++) {
      const y = -EXTENT + 2 * EXTENT * j / (G - 1);
      for (let i = 0; i < G; i++) {
        const x = -EXTENT + 2 * EXTENT * i / (G - 1);
        const v = noise.generateSimplex4D(x, y, z, t);
        // gradient magnitude via 3 central differences
        const gx = (noise.generateSimplex4D(x + h, y, z, t) - noise.generateSimplex4D(x - h, y, z, t)) / (2 * h);
        const gy = (noise.generateSimplex4D(x, y + h, z, t) - noise.generateSimplex4D(x, y - h, z, t)) / (2 * h);
        const gz = (noise.generateSimplex4D(x, y, z + h, t) - noise.generateSimplex4D(x, y, z - h, t)) / (2 * h);
        const k3 = k * G * G + j * G + i;
        vals[k3] = v;
        grad[k3] = Math.hypot(gx, gy, gz);
      }
    }
  }
  // Statistics
  const vs = Array.from(vals);
  const gs = Array.from(grad);
  const var_v = mean(vs.map(v => v * v)) - mean(vs) ** 2;
  const mean_g = mean(gs);
  // Sign-change rate along x-axis at fixed (y=j, z=k)
  let changes = 0, total = 0;
  for (let k = 0; k < G; k++) {
    for (let j = 0; j < G; j++) {
      for (let i = 1; i < G; i++) {
        const a = vals[k * G * G + j * G + i - 1];
        const b = vals[k * G * G + j * G + i];
        if ((a >= 0) !== (b >= 0)) changes++;
        total++;
      }
    }
  }
  return { var_v, mean_grad: mean_g, sign_change_rate: changes / total };
}

const noise = new ForgeNoise(12345);
const rows = [];
for (const t of T_VALUES) {
  const r = analyzeSlice(noise, t);
  rows.push({ t, ...r });
}

// Aggregate - coefficient of variation across slices
const vars  = rows.map(r => r.var_v);
const grads = rows.map(r => r.mean_grad);
const scrs  = rows.map(r => r.sign_change_rate);

const cv = arr => std(arr) / mean(arr);
console.log('\n=== Temporal stationarity of 4D noise slices ===');
console.log(`t range: [${T_VALUES[0]}, ${T_VALUES[T_VALUES.length-1]}]`);
console.log(`variance         mean=${mean(vars).toFixed(5)}  CV=${(cv(vars)*100).toFixed(2)}%`);
console.log(`mean gradient    mean=${mean(grads).toFixed(5)}  CV=${(cv(grads)*100).toFixed(2)}%`);
console.log(`sign-change rate mean=${mean(scrs).toFixed(5)}  CV=${(cv(scrs)*100).toFixed(2)}%`);
console.log('');
const STATIONARY = cv(vars) < 0.05 && cv(grads) < 0.05 && cv(scrs) < 0.05;
console.log(`Hypothesis "stationary in t" (CV < 5% on all stats): ${STATIONARY ? '✓ SUPPORTED' : '✗ FAILED'}`);

writeCSV(path.join(outDir, 'per_t.csv'), rows);
writeJSON(path.join(outDir, 'summary.json'), {
  resolution: G, extent: EXTENT,
  t_range: [T_VALUES[0], T_VALUES[T_VALUES.length - 1]],
  var_mean: mean(vars), var_cv: cv(vars),
  grad_mean: mean(grads), grad_cv: cv(grads),
  scr_mean: mean(scrs), scr_cv: cv(scrs),
  stationary: STATIONARY,
  rows,
});
console.log(`\nWrote ${outDir}/per_t.csv and summary.json`);