'use strict';
// Hypothesis: for uniform domain warp q = p + s·n(p), the map is
// orientation-preserving iff s < s_crit where
//     s_crit = -1 / min_p (∂ₓn(p) + ∂ᵧn(p))
// General (ForgeNoise-style two-field) warp has a per-pixel quadratic:
//     det J(p, s) = 1 + a(p)·s + b(p)·s²
// with a = dx₁ + dy₂, b = dx₁·dy₂ − dy₁·dx₂. Folds appear at
// the smallest positive s where det J can be ≤ 0 at some pixel.

const path = require('path');
const lib = require('../lib');
const {
  ForgeNoise, ensureDir, writeCSV, writeJSON, writePNG,
  mean, std, min, max, quantile,
} = lib;


const N       = 256;
const SEEDS   = 100;
const EXTENT  = 6.0;
const OFF_X   = 5.2;   // ForgeNoise's warp offset
const OFF_Y   = 1.3;

const outDir = path.join(__dirname, 'results');
ensureDir(outDir);

// Compute s_crit for one seed under a given derivative provider.
// derivFn(x, y, out) → out = [v, dx, dy]
function sCritical(derivFn) {
  const tmp1 = new Float64Array(3);
  const tmp2 = new Float64Array(3);
  let sCrit = Infinity;
  for (let j = 0; j < N; j++) {
    const y = -EXTENT + 2 * EXTENT * j / (N - 1);
    for (let i = 0; i < N; i++) {
      const x = -EXTENT + 2 * EXTENT * i / (N - 1);
      derivFn(x, y, tmp1);
      derivFn(x + OFF_X, y + OFF_Y, tmp2);
      const a = tmp1[1] + tmp2[2];
      const b = tmp1[1] * tmp2[2] - tmp1[2] * tmp2[1];
      let sPos = Infinity;
      if (Math.abs(b) < 1e-10) {
        if (a < 0) sPos = -1 / a;
      } else {
        const disc = a * a - 4 * b;
        if (disc >= 0) {
          const sq = Math.sqrt(disc);
          const s1 = (-a - sq) / (2 * b);
          const s2 = (-a + sq) / (2 * b);
          if (s1 > 0) sPos = Math.min(sPos, s1);
          if (s2 > 0) sPos = Math.min(sPos, s2);
        }
      }
      if (sPos < sCrit) sCrit = sPos;
    }
  }
  return sCrit;
}

// Fraction of pixels with det J < 0 at the given s
function foldFraction(derivFn, s) {
  const tmp1 = new Float64Array(3);
  const tmp2 = new Float64Array(3);
  let folds = 0, total = 0;
  for (let j = 0; j < N; j++) {
    const y = -EXTENT + 2 * EXTENT * j / (N - 1);
    for (let i = 0; i < N; i++) {
      const x = -EXTENT + 2 * EXTENT * i / (N - 1);
      derivFn(x, y, tmp1);
      derivFn(x + OFF_X, y + OFF_Y, tmp2);
      const a = tmp1[1] + tmp2[2];
      const b = tmp1[1] * tmp2[2] - tmp1[2] * tmp2[1];
      const detJ = 1 + a * s + b * s * s;
      if (detJ < 0) folds++;
      total++;
    }
  }
  return folds / total;
}

// ── Main loop ──────────────────────────────────────────────────
const rows = [];
const sCrits = [];

console.log(`Running ${SEEDS} seeds at ${N}×${N} (uniform warp on Simplex 2D, exact deriv)`);

for (let k = 0; k < SEEDS; k++) {
  const seed = 1000 + k;
  const noise = new ForgeNoise(seed);
  const derivFn = (x, y, out) => noise.generateSimplex2D_Derivative(x, y, out);

  const sc = sCritical(derivFn);
  sCrits.push(sc);

  const fBelow = foldFraction(derivFn, sc * 0.85);
  const fAt    = foldFraction(derivFn, sc * 0.98);
  const fAbove = foldFraction(derivFn, sc * 1.05);
  const fWayAbove = foldFraction(derivFn, sc * 1.30);

  rows.push({
    seed,
    s_crit: sc.toFixed(4),
    fold_below: fBelow.toFixed(6),
    fold_at:    fAt.toFixed(6),
    fold_above: fAbove.toFixed(6),
    fold_way_above: fWayAbove.toFixed(6),
  });

  if ((k + 1) % 10 === 0) console.log(`  ${k + 1}/${SEEDS}: s_crit = ${sc.toFixed(3)}`);
}

// ── Summary + hypothesis test ──────────────────────────────────
const m = mean(sCrits), s = std(sCrits), lo = min(sCrits), hi = max(sCrits);
const q = [quantile(sCrits, 0.05), quantile(sCrits, 0.50), quantile(sCrits, 0.95)];

const belowClean = rows.every(r => parseFloat(r.fold_below) === 0);
const aboveDirty = rows.every(r => parseFloat(r.fold_above) > 0);
const aboveMonotonic = rows.every(r =>
  parseFloat(r.fold_way_above) >= parseFloat(r.fold_above) &&
  parseFloat(r.fold_above) >= parseFloat(r.fold_at)
);

console.log('');
console.log('=== s_crit over ' + SEEDS + ' seeds (Simplex 2D, uniform warp) ===');
console.log(`  mean   ${m.toFixed(4)}`);
console.log(`  std    ${s.toFixed(4)}`);
console.log(`  min    ${lo.toFixed(4)}`);
console.log(`  max    ${hi.toFixed(4)}`);
console.log(`  q05/50/95  ${q.map(v => v.toFixed(3)).join(' / ')}`);
console.log('');
console.log(`  s < 0.85·s_crit  ⟹  fold_frac == 0 :  ${belowClean ? '✓ SUPPORTED' : '✗ FAILED'}`);
console.log(`  s > 1.05·s_crit  ⟹  fold_frac > 0  :  ${aboveDirty ? '✓ SUPPORTED' : '✗ FAILED'}`);
console.log(`  fold_frac monotone with s           :  ${aboveMonotonic ? '✓ SUPPORTED' : '✗ FAILED'}`);

// ── Write outputs ──────────────────────────────────────────────
writeCSV(path.join(outDir, 'per_seed.csv'), rows);
writeJSON(path.join(outDir, 'summary.json'), {
  algorithm: 'simplex2d',
  seeds: SEEDS, resolution: N, extent: EXTENT,
  offset: [OFF_X, OFF_Y],
  mean_s_crit: m, std_s_crit: s, min_s_crit: lo, max_s_crit: hi,
  q05: q[0], q50: q[1], q95: q[2],
  hypothesis: {
    below_clean: belowClean,
    above_dirty: aboveDirty,
    monotone: aboveMonotonic,
  },
});

// ── Fold-mask figure (paper Figure 1) ──────────────────────────
// Render the field, with folded regions highlighted in red.
// Three panels: s = 0.85·s_crit, s = 0.98·s_crit, s = 1.05·s_crit.
const visSeed = 1000;
const visNoise = new ForgeNoise(visSeed);
const visDerivFn = (x, y, out) => visNoise.generateSimplex2D_Derivative(x, y, out);
const sc = sCritical(visDerivFn);
const panels = [0.85, 0.98, 1.05];
const PW = N * panels.length + (panels.length - 1) * 4;   // 4px gap
const rgb = Buffer.alloc(PW * N * 3);
const t1 = new Float64Array(3), t2 = new Float64Array(3);

for (let p = 0; p < panels.length; p++) {
  const s = sc * panels[p];
  const px0 = p * (N + 4);
  for (let j = 0; j < N; j++) {
    const y = -EXTENT + 2 * EXTENT * j / (N - 1);
    for (let i = 0; i < N; i++) {
      const x = -EXTENT + 2 * EXTENT * i / (N - 1);
      visDerivFn(x, y, t1);
      visDerivFn(x + OFF_X, y + OFF_Y, t2);
      const a = t1[1] + t2[2];
      const b = t1[1] * t2[2] - t1[2] * t2[1];
      const detJ = 1 + a * s + b * s * s;
      const v = t1[0];
      const gray = Math.round(Math.max(0, Math.min(1, v * 0.5 + 0.5)) * 200 + 30);
      const k = (j * PW + px0 + i) * 3;
      if (detJ < 0) {
        rgb[k] = 255; rgb[k + 1] = 55; rgb[k + 2] = 40;
      } else {
        rgb[k] = gray; rgb[k + 1] = gray; rgb[k + 2] = Math.round(gray * 0.85);
      }
    }
  }
}
writePNG(path.join(outDir, `fold_mask_seed${visSeed}.png`), PW, N, rgb);

console.log('');
console.log(`Wrote ${outDir}/per_seed.csv`);
console.log(`Wrote ${outDir}/summary.json`);
console.log(`Wrote ${outDir}/fold_mask_seed${visSeed}.ppm`);
console.log('');
console.log(`Visualization: 3 panels at s = ${panels.map(p => (sc * p).toFixed(2)).join(' / ')}`);
console.log('Convert PPM: convert fold_mask_*.ppm fold_mask.png');

// ── Octave scaling (appended) ─────────────────────────────────
// Prediction from first principles: s_crit ∝ 1/√N because the
// gradient of a normalized fractal has std(∇f) ∝ √N (independent
// octave gradients add in quadrature; pL=1 case).
const OCT_SEEDS = 20;
const OCTAVE_LIST = [1, 2, 4, 8, 16];
const octRows = [];

console.log('\n=== Octave scaling test (Simplex Fractal 2D) ===');
console.log('octaves   mean_s_crit   std');
for (const oct of OCTAVE_LIST) {
  const vals = [];
  for (let k = 0; k < OCT_SEEDS; k++) {
    const n = new ForgeNoise(5000 + k);
    const df = (x, y, out) => n.generateSimplexFractal2D_Derivative(x, y, out, { octaves: oct });
    vals.push(sCritical(df));
  }
  const m = mean(vals), s = std(vals);
  octRows.push({ octaves: oct, mean_s_crit: m, std_s_crit: s, samples: OCT_SEEDS });
  console.log(`  ${String(oct).padStart(2)}       ${m.toFixed(4)}        ${s.toFixed(4)}`);
}

// Fit log(s_crit) = log(C) − α·log(N)
const xs = octRows.map(r => Math.log(r.octaves));
const ys = octRows.map(r => Math.log(r.mean_s_crit));
const N_ = xs.length;
const sx = xs.reduce((a, b) => a + b, 0);
const sy = ys.reduce((a, b) => a + b, 0);
const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
const sxx = xs.reduce((a, b) => a + b * b, 0);
const alpha = (N_ * sxy - sx * sy) / (N_ * sxx - sx * sx);
const intercept = (sy - alpha * sx) / N_;
const C = Math.exp(intercept);

console.log('');
console.log(`Fit: s_crit(N) = ${C.toFixed(4)} · N^(${(-alpha).toFixed(3)})`);
console.log(`Prediction: α = 0.5 (s_crit ∝ 1/√N) - measured α = ${(-alpha).toFixed(3)}`);
console.log(`Agreement: ${Math.abs(-alpha - 0.5) < 0.15 ? '✓ within 15% of prediction' : '✗ deviates from prediction'}`);

writeCSV(path.join(outDir, 'octave_scaling.csv'), octRows);

// Fit on N >= 4 only (N=1,2 dominated by coarsest octave)
const fitRows = octRows.filter(r => r.octaves >= 4);
const xs4 = fitRows.map(r => Math.log(r.octaves));
const ys4 = fitRows.map(r => Math.log(r.mean_s_crit));
const N4 = xs4.length;
const sx4 = xs4.reduce((a, b) => a + b, 0);
const sy4 = ys4.reduce((a, b) => a + b, 0);
const sxy4 = xs4.reduce((a, b, i) => a + b * ys4[i], 0);
const sxx4 = xs4.reduce((a, b) => a + b * b, 0);
const alpha4 = (N4 * sxy4 - sx4 * sy4) / (N4 * sxx4 - sx4 * sx4);
const relErr = Math.abs(-alpha4 - 0.5) / 0.5;
console.log(`\nFit on N >= 4: α = ${(-alpha4).toFixed(3)} (prediction 0.5, rel err ${(relErr*100).toFixed(1)}%)`);
console.log(`Verdict: ${relErr < 0.15 ? '✓ SUPPORTED' : '✗ FAILED'}`);