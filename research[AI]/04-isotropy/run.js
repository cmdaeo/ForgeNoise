'use strict';
// Hypothesis A: mean λ₂/λ₁ (structure-tensor eigenvalue ratio) discriminates
//               algorithms. (1 = isotropic, 0 = fully anisotropic.)
// Hypothesis B: the distribution of *principal directions* is not uniform
//               for lattice algorithms (Perlin, Simplex) but is closer to
//               uniform for lattice-free ones (OS2F).

const path = require('path');
const lib = require('../lib');
const { ForgeNoise, ensureDir, writeCSV, writeJSON, mean, std, min, max, fdGrad } = lib;

const SAMPLES       = 800;
const INTEGRATION_R = 0.35;
const DISK_SAMPLES  = 48;

const outDir = path.join(__dirname, 'results');
ensureDir(outDir);

function structureTensor(derivFn, x, y) {
  let xx = 0, xy = 0, yy = 0;
  const tmp = new Float64Array(3);
  for (let k = 0; k < DISK_SAMPLES; k++) {
    const a = (k / DISK_SAMPLES) * 2 * Math.PI;
    const r = INTEGRATION_R * Math.sqrt((k * 0.618033) % 1);
    derivFn(x + r * Math.cos(a), y + r * Math.sin(a), tmp);
    xx += tmp[1] * tmp[1];
    xy += tmp[1] * tmp[2];
    yy += tmp[2] * tmp[2];
  }
  return { xx: xx / DISK_SAMPLES, xy: xy / DISK_SAMPLES, yy: yy / DISK_SAMPLES };
}

function analyzeField(name, derivFn) {
  let s = 0x9E3779B9;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };

  const isos = [];
  const dirs = [];    // principal directions mod π/2
  for (let k = 0; k < SAMPLES; k++) {
    const x = -6 + rnd() * 12;
    const y = -6 + rnd() * 12;
    const T = structureTensor(derivFn, x, y);
    const trace = T.xx + T.yy;
    const det = T.xx * T.yy - T.xy * T.xy;
    const disc = Math.sqrt(Math.max(0, trace * trace / 4 - det));
    const l1 = trace / 2 + disc;
    const l2 = trace / 2 - disc;
    if (l1 > 1e-10) isos.push(l2 / l1);
    // principal direction of the LARGER eigenvalue (gradient's dominant axis)
    const theta = 0.5 * Math.atan2(2 * T.xy, T.xx - T.yy);
    // wrap to [0, π/2) - mod symmetry doesn't care about sign
    dirs.push(((theta % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2));
  }

  // Rayleigh-like concentration on [0, π/2): map to full circle via ×4
  let cx = 0, cy = 0;
  for (const d of dirs) { cx += Math.cos(4 * d); cy += Math.sin(4 * d); }
  const R = Math.hypot(cx, cy) / dirs.length;

  // Second concentration: mod 2π/3 (3-fold symmetry, catches hex lattices)
  let cx3 = 0, cy3 = 0;
  for (const d of dirs) { cx3 += Math.cos(6 * d); cy3 += Math.sin(6 * d); }
  const R3 = Math.hypot(cx3, cy3) / dirs.length;

  return {
    algorithm: name,
    mean_iso:  mean(isos),
    std_iso:   std(isos),
    q05_iso:   [...isos].sort((a, b) => a - b)[Math.floor(0.05 * isos.length)],
    q95_iso:   [...isos].sort((a, b) => a - b)[Math.floor(0.95 * isos.length)],
    dir_concentration_4: R,
    dir_concentration_6: R3,
    samples: isos.length,
  };
}

const noise = new ForgeNoise(12345);
const algorithms = [
  ['perlin2d',  (x, y, out) => fdGrad(noise, x, y, 'perlin',  out)],
  ['simplex2d', (x, y, out) => noise.generateSimplex2D_Derivative(x, y, out)],
  ['os2f_2d',   (x, y, out) => fdGrad(noise, x, y, 'os2f',    out)],
  ['os2s_2d',   (x, y, out) => fdGrad(noise, x, y, 'os2s',    out)],
];

const rows = algorithms.map(([name, fn]) => analyzeField(name, fn));

console.log('\n=== Per-algorithm analysis ===');
console.log('algorithm     mean_iso  q05_iso   dir_conc_4  dir_conc_6');
for (const r of rows) {
  console.log(`${r.algorithm.padEnd(12)}  ${r.mean_iso.toFixed(4)}    ${r.q05_iso.toFixed(4)}    ${r.dir_concentration_4.toFixed(4)}      ${r.dir_concentration_6.toFixed(4)}`);
}

// Hypotheses
const perlinR = rows.find(r => r.algorithm === 'perlin2d').dir_concentration_4;
const simplexR = rows.find(r => r.algorithm === 'simplex2d').dir_concentration_4;
const os2fR = rows.find(r => r.algorithm === 'os2f_2d').dir_concentration_4;

console.log('');
console.log(`Hypothesis A "Perlin has lower mean isotropy than Simplex": ` +
  `${rows[0].mean_iso < rows[1].mean_iso ? '✓ SUPPORTED' : '✗ FAILED'} ` +
  `(${rows[0].mean_iso.toFixed(3)} vs ${rows[1].mean_iso.toFixed(3)})`);
console.log(`Hypothesis B "Direction concentration: Perlin > Simplex > OS2F": ` +
  `${perlinR > simplexR && simplexR > os2fR ? '✓ SUPPORTED' : '✗ FAILED'} ` +
  `(${perlinR.toFixed(3)} vs ${simplexR.toFixed(3)} vs ${os2fR.toFixed(3)})`);

writeCSV(path.join(outDir, 'per_algorithm.csv'), rows);
writeJSON(path.join(outDir, 'summary.json'), {
  samples: SAMPLES, integration_radius: INTEGRATION_R, disk_samples: DISK_SAMPLES,
  rows,
  hypothesis_A_perlin_lower_iso: rows[0].mean_iso < rows[1].mean_iso,
  hypothesis_B_direction_ordering: perlinR > simplexR && simplexR > os2fR,
});
console.log(`\nWrote ${outDir}/per_algorithm.csv`);
console.log(`Wrote ${outDir}/summary.json`);