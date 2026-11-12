'use strict';
// Hypothesis: on a noise-defined heightmap F(p) = p.y − A·n(p.x·S, p.z·S),
// Newton iteration using the analytic gradient converges in far fewer
// iterations AND noise evaluations than bisection.
//
// Fix vs previous run: rays must be oblique so the noise actually varies
// along them. Vertical rays pass through fixed (x, z), making the problem
// trivially linear - Newton converged in 1 step regardless of tolerance,
// which is meaningless. Oblique rays with short XZ span (< 1 noise feature)
// keep the problem single-root so all three solvers are comparable.

const path = require('path');
const { performance } = require('perf_hooks');
const lib = require('../lib');
const { ForgeNoise, ensureDir, writeCSV, writeJSON, mean } = lib;

const N_RAYS                 = 500;
const TOLERANCES             = [1e-3, 1e-5, 1e-7];
const HEIGHT                 = 1.2;
const NOISE_SCALE            = 0.15;      // smooth terrain - < 1 feature per ray
const NEWTON_MAX_ITERS       = 25;
const BISECTION_MAX_ITERS    = 60;
const ROOT_MATCH_TOL         = 1e-4;      // for root-agreement filtering

const outDir = path.join(__dirname, 'results');
ensureDir(outDir);

const noise = new ForgeNoise(12345);
const tmp = new Float64Array(3);

// ── Heightmap along a parametric ray ──────────────────────────
function heightmapAt(px, pz) {
  return HEIGHT * noise.generateSimplex2D(px * NOISE_SCALE, pz * NOISE_SCALE);
}

function F_along(t, ray) {
  const px = ray.x0 + t * ray.dx;
  const py = ray.y0 + t * ray.dy;
  const pz = ray.z0 + t * ray.dz;
  return py - heightmapAt(px, pz);
}

// dF/dt along the ray. Uses the analytic derivative of the noise field:
//   n(px, pz) = noise2D(px*S, pz*S)
//   dn/dpx = S * noise_dx
//   dn/dpz = S * noise_dz
//   dF/dt = dy − A·(dn/dpx·dx + dn/dpz·dz)
function dFdt_along(t, ray) {
  const px = ray.x0 + t * ray.dx;
  const pz = ray.z0 + t * ray.dz;
  noise.generateSimplex2D_Derivative(px * NOISE_SCALE, pz * NOISE_SCALE, tmp);
  return ray.dy - HEIGHT * NOISE_SCALE * (tmp[1] * ray.dx + tmp[2] * ray.dz);
}

// FD approximation of dF/dt - the "no analytic derivative available"
// baseline. Costs 2 extra F evaluations per step.
function dFdt_fd(t, ray, h = 1e-5) {
  return (F_along(t + h, ray) - F_along(t - h, ray)) / (2 * h);
}

// ── Solvers ───────────────────────────────────────────────────
function bisection(ray, tol) {
  let a = 0, b = 1;
  let Fa = F_along(a, ray);
  const Fb = F_along(b, ray);
  let evals = 2;
  if ((Fa >= 0) === (Fb >= 0)) {
    return { iters: -1, t: NaN, converged: false, evals };
  }
  let iters = 0;
  for (iters = 0; iters < BISECTION_MAX_ITERS; iters++) {
    if (Math.abs(b - a) < tol) break;
    const m = 0.5 * (a + b);
    const Fm = F_along(m, ray);
    evals++;
    if ((Fa >= 0) !== (Fm >= 0)) b = m;
    else a = m;
  }
  return { iters, t: 0.5 * (a + b), converged: true, evals };
}

function newtonAnalytic(ray, tol) {
  let t = 0.5, evals = 0, iters = 0;
  for (iters = 0; iters < NEWTON_MAX_ITERS; iters++) {
    const f = F_along(t, ray); evals++;
    if (Math.abs(f) < tol) return { iters, t, converged: true, evals };
    const df = dFdt_along(t, ray);                    // free (comes from F call chain)
    if (Math.abs(df) < 1e-10) return { iters, t, converged: false, evals };
    t = t - f / df;
    if (t < -0.5 || t > 1.5) return { iters, t, converged: false, evals };
  }
  return { iters, t, converged: false, evals };
}

function newtonFD(ray, tol) {
  let t = 0.5, evals = 0, iters = 0;
  for (iters = 0; iters < NEWTON_MAX_ITERS; iters++) {
    const f = F_along(t, ray); evals++;
    if (Math.abs(f) < tol) return { iters, t, converged: true, evals };
    const df = dFdt_fd(t, ray);
    evals += 2;                                        // 2 extra F evals for FD
    if (Math.abs(df) < 1e-10) return { iters, t, converged: false, evals };
    t = t - f / df;
    if (t < -0.5 || t > 1.5) return { iters, t, converged: false, evals };
  }
  return { iters, t, converged: false, evals };
}

// ── Generate rays ─────────────────────────────────────────────
// Short oblique rays: start above (y=+2), end below (y=−2).
// XZ travel is < ~2 units, so at most 1 terrain crossing.
let s = 0x9E3779B9;
const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };

const rays = [];
for (let r = 0; r < N_RAYS; r++) {
  const x0 = (rnd() - 0.5) * 4;
  const z0 = (rnd() - 0.5) * 4;
  const dx = (rnd() - 0.5) * 1.5;
  const dz = (rnd() - 0.5) * 1.5;
  rays.push({
    x0, y0: 2, z0,
    dx, dy: -4, dz,
    x1: x0 + dx, y1: -2, z1: z0 + dz,
  });
}

// ── Run solvers at each tolerance ─────────────────────────────
const rows = [];

for (const tol of TOLERANCES) {
  const bis = { iters: [], evals: [], conv: 0, time: 0 };
  const ana = { iters: [], evals: [], conv: 0, time: 0 };
  const fdn = { iters: [], evals: [], conv: 0, time: 0 };
  let rootMatch = 0, rootChecked = 0;

  for (const ray of rays) {
    const t0 = performance.now();
    const b = bisection(ray, tol);
    bis.time += performance.now() - t0;
    if (b.converged) { bis.iters.push(b.iters); bis.evals.push(b.evals); bis.conv++; }

    const t1 = performance.now();
    const a = newtonAnalytic(ray, tol);
    ana.time += performance.now() - t1;
    if (a.converged) { ana.iters.push(a.iters); ana.evals.push(a.evals); ana.conv++; }

    const t2 = performance.now();
    const f = newtonFD(ray, tol);
    fdn.time += performance.now() - t2;
    if (f.converged) { fdn.iters.push(f.iters); fdn.evals.push(f.evals); fdn.conv++; }

    if (b.converged && a.converged) {
      rootChecked++;
      if (Math.abs(b.t - a.t) < ROOT_MATCH_TOL) rootMatch++;
    }
  }

  const r = {
    tolerance: tol,
    bisection_iters:       mean(bis.iters),
    analytic_iters:        mean(ana.iters),
    fd_iters:              mean(fdn.iters),
    bisection_evals:       mean(bis.evals),
    analytic_evals:        mean(ana.evals),
    fd_evals:              mean(fdn.evals),
    bisection_conv_rate:   bis.conv / N_RAYS,
    analytic_conv_rate:    ana.conv / N_RAYS,
    fd_conv_rate:          fdn.conv / N_RAYS,
    root_match_rate:       rootChecked ? rootMatch / rootChecked : 0,
    bisection_ms:          bis.time,
    analytic_ms:           ana.time,
    fd_ms:                 fdn.time,
    speedup_iterations_analytic: mean(bis.iters) / mean(ana.iters),
    speedup_evals_analytic:      mean(bis.evals) / mean(ana.evals),
    speedup_evals_fd:            mean(bis.evals) / mean(fdn.evals),
    speedup_walltime_analytic:   bis.time / ana.time,
    speedup_walltime_fd:         bis.time / fdn.time,
  };
  rows.push(r);

  console.log(`\n── tol = ${tol.toExponential(0)} ──`);
  console.log(`  bisection: ${r.bisection_iters.toFixed(1).padStart(5)} iters · ${r.bisection_evals.toFixed(1).padStart(5)} evals · conv ${(r.bisection_conv_rate*100).toFixed(0)}% · ${r.bisection_ms.toFixed(1)} ms`);
  console.log(`  analytic:  ${r.analytic_iters.toFixed(1).padStart(5)} iters · ${r.analytic_evals.toFixed(1).padStart(5)} evals · conv ${(r.analytic_conv_rate*100).toFixed(0)}% · ${r.analytic_ms.toFixed(1)} ms`);
  console.log(`  FD:        ${r.fd_iters.toFixed(1).padStart(5)} iters · ${r.fd_evals.toFixed(1).padStart(5)} evals · conv ${(r.fd_conv_rate*100).toFixed(0)}% · ${r.fd_ms.toFixed(1)} ms`);
  console.log(`  root agreement (analytic vs bisect): ${(r.root_match_rate*100).toFixed(1)}%`);
  console.log(`  speedups: iters ${r.speedup_iterations_analytic.toFixed(2)}× · evals ${r.speedup_evals_analytic.toFixed(2)}× · wall ${r.speedup_walltime_analytic.toFixed(2)}×`);
}

// ── Summary ───────────────────────────────────────────────────
console.log('\n══ Summary across tolerances ══');
const avgIters = mean(rows.map(r => r.speedup_iterations_analytic));
const avgEvals = mean(rows.map(r => r.speedup_evals_analytic));
const avgWall  = mean(rows.map(r => r.speedup_walltime_analytic));
const avgFD    = mean(rows.map(r => r.speedup_evals_fd));

console.log(`  Mean speedup (analytic Newton vs bisection):`);
console.log(`    by iterations: ${avgIters.toFixed(2)}×`);
console.log(`    by F evals:    ${avgEvals.toFixed(2)}×`);
console.log(`    by wall time:  ${avgWall.toFixed(2)}×`);
console.log(`  Mean speedup (FD Newton vs bisection, by F evals): ${avgFD.toFixed(2)}×`);
console.log(`  Hypothesis "≥3× fewer F evals at tol=1e-5": ${rows[1].speedup_evals_analytic >= 3 ? '✓ SUPPORTED' : '✗ FAILED'}`);

writeCSV(path.join(outDir, 'per_tolerance.csv'), rows);
writeJSON(path.join(outDir, 'summary.json'), {
  n_rays: N_RAYS,
  tolerances: TOLERANCES,
  height: HEIGHT,
  noise_scale: NOISE_SCALE,
  newton_start: 0.5,
  mean_iteration_speedup:  avgIters,
  mean_eval_speedup:       avgEvals,
  mean_walltime_speedup:   avgWall,
  mean_eval_speedup_fd:    avgFD,
  hypothesis_3x_evals:     rows[1].speedup_evals_analytic >= 3,
  rows,
});
console.log(`\nWrote ${outDir}/per_tolerance.csv and summary.json`);