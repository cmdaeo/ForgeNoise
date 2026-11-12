'use strict';
// Hypothesis: sampling noise at Poincaré-disk coordinates produces a field
// isotropic in the hyperbolic metric - but the *Euclidean* feature size
// shrinks as (1 − r²)/2 toward the disk boundary. In hyperbolic units,
// |∇n|·(1 − r²)/2 is constant across the disk. In Euclidean units it
// decays exponentially with hyperbolic radius.

const path = require('path');
const lib = require('../lib');
const { ForgeNoise, ensureDir, writeCSV, writeJSON, writePNG, mean, std } = lib;

const R = 512;                     // disk pixels (diameter)
const CX = R / 2, CY = R / 2;
const R_DISK_PX = R / 2 - 2;
const COORD_SCALE = 4.0;           // how much of the noise's coordinate range fits inside the disk

const outDir = path.join(__dirname, 'results');
ensureDir(outDir);

const noise = new ForgeNoise(12345);

// Sample noise at Poincaré disk coordinates: p_hyp → p_disk → p_noise
// (p_disk is the conformal Euclidean map; the noise field is sampled at
// the disk coords directly - no additional transform needed since the
// disk IS a conformal model of ℍ².)
function sampleAtDisk(u, v) {
  const nx = u * COORD_SCALE;
  const ny = v * COORD_SCALE;
  return noise.generateSimplex2D(nx, ny);
}

// Euclidean gradient at (u, v)
function euclGrad(u, v, h = 1e-3) {
  const gx = (sampleAtDisk(u + h, v) - sampleAtDisk(u - h, v)) / (2 * h);
  const gy = (sampleAtDisk(u, v + h) - sampleAtDisk(u, v - h)) / (2 * h);
  return Math.hypot(gx, gy);
}

// Hyperbolic metric factor at Euclidean disk radius r:
// ds² = 4(du² + dv²) / (1 − r²)², so a hyperbolic length element ds_hyp
// corresponds to ds_eucl = ds_hyp · (1 − r²) / 2.
function metricFactor(r) {
  return (1 - r * r) / 2;
}

// ── Measure mean Euclidean and hyperbolic gradient magnitudes ──
// in concentric annuli of the disk.
const N_RADII = 40;
const SAMPLES_PER_ANNULUS = 500;

const rows = [];
for (let ri = 0; ri < N_RADII; ri++) {
  const r = 0.02 + 0.94 * ri / (N_RADII - 1);
  const rho_hyp = 2 * Math.atanh(r);   // hyperbolic distance from origin
  let sumEucl = 0, sumHyp = 0, cnt = 0;
  for (let s = 0; s < SAMPLES_PER_ANNULUS; s++) {
    const theta = (s / SAMPLES_PER_ANNULUS) * 2 * Math.PI;
    const u = r * Math.cos(theta);
    const v = r * Math.sin(theta);
    if (u * u + v * v >= 1) continue;
    const g = euclGrad(u, v);
    sumEucl += g;
    sumHyp += g * metricFactor(r);
    cnt++;
  }
  rows.push({
    r: r.toFixed(4),
    rho_hyp: rho_hyp.toFixed(4),
    mean_eucl_grad: (sumEucl / cnt).toFixed(6),
    mean_hyp_grad:  (sumHyp / cnt).toFixed(6),
    metric_factor:  metricFactor(r).toFixed(6),
  });
}

// ── Report ────────────────────────────────────────────────────
const hypGrads = rows.slice(5, -5).map(r => parseFloat(r.mean_hyp_grad));  // skip edges
const euclGrads = rows.slice(5, -5).map(r => parseFloat(r.mean_eucl_grad));
const cvHyp = std(hypGrads) / mean(hypGrads);
const cvEucl = std(euclGrads) / mean(euclGrads);

console.log('\n=== Hyperbolic noise stationarity ===');
console.log('radius r  rho_hyp   mean_eucl_grad   mean_hyp_grad');
for (let i = 0; i < rows.length; i += 8) {
  const r = rows[i];
  console.log(`${r.r.padStart(6)}   ${r.rho_hyp.padStart(6)}   ${r.mean_eucl_grad.padStart(12)}   ${r.mean_hyp_grad.padStart(12)}`);
}
console.log('');
console.log(`Euclidean gradient CV (edge-skipped): ${(cvEucl * 100).toFixed(1)}%`);
console.log(`Hyperbolic gradient CV (edge-skipped): ${(cvHyp * 100).toFixed(1)}%`);
const HYPOTHESIS = cvHyp < cvEucl / 2;
console.log(`Hypothesis "hyperbolic units give constant feature size": ${HYPOTHESIS ? '✓ SUPPORTED' : '✗ FAILED'}`);

// Fit log(mean_eucl_grad) vs rho_hyp → slope should be ≈ −1
const xs = rows.slice(5, -5).map(r => parseFloat(r.rho_hyp));
const ys = rows.slice(5, -5).map(r => Math.log(parseFloat(r.mean_eucl_grad)));
const N_ = xs.length;
const sx = xs.reduce((a, b) => a + b, 0);
const sy = ys.reduce((a, b) => a + b, 0);
const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
const sxx = xs.reduce((a, b) => a + b * b, 0);
const slope = (N_ * sxy - sx * sy) / (N_ * sxx - sx * sx);
console.log(`Log-Euclidean-gradient slope vs hyperbolic radius: ${slope.toFixed(3)}`);
console.log(`Predicted slope: -1.0 (from metric factor (1-r²)/2)`);

writeCSV(path.join(outDir, 'per_radius.csv'), rows);
writeJSON(path.join(outDir, 'summary.json'), {
  resolution: R, coord_scale: COORD_SCALE,
  euclidean_cv: cvEucl, hyperbolic_cv: cvHyp,
  euclidean_gradient_log_slope: slope,
  predicted_slope: -1.0,
  hypothesis_hyperbolic_constant: HYPOTHESIS,
  rows,
});

// ── Render the disk (paper Figure 4) ──────────────────────────
const rgb = Buffer.alloc(R * R * 3);
for (let py = 0; py < R; py++) {
  for (let px = 0; px < R; px++) {
    const u = (px - CX) / R_DISK_PX;
    const v = (py - CY) / R_DISK_PX;
    const r2 = u * u + v * v;
    const k = (py * R + px) * 3;
    if (r2 >= 1) {
      rgb[k] = 0; rgb[k + 1] = 0; rgb[k + 2] = 0;
    } else {
      const val = sampleAtDisk(u, v);
      const g = Math.round(Math.max(0, Math.min(1, val * 0.5 + 0.5)) * 255);
      rgb[k] = g;
      rgb[k + 1] = Math.round(g * 0.85);
      rgb[k + 2] = Math.round(g * 0.7);
    }
  }
}
writePNG(path.join(outDir, 'poincare_noise.ppm'), R, R, rgb);

// Render the grid overlay: geodesics would require more code, but we can at
// least render concentric hyperbolic-equidistant circles (each an annulus of
// constant feature size in the metric). This is visually striking.
console.log(`\nWrote ${outDir}/per_radius.csv, summary.json, poincare_noise.ppm`);