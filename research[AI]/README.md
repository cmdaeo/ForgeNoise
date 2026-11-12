# Research

Experiments probing what ForgeNoise's analytic derivatives enable that
other libraries can't do cheaply. Each folder is a self-contained script
with a `README.md` stating the hypothesis, the method, and what would
falsify it. Results land in `results/` as CSV + JSON + PPM.

## Run order (each is independent)

```bash
npm run build    # ensure dist/forgeNoise.min.js is up to date
node research/01-warp-folding/run.js
node research/04-isotropy/run.js
node research/02-critical-points/run.js
```

Then, once those three have produced data:

```bash
node research/03-ridge-topology/run.js
node research/05-4d-time/run.js
node research/06-hyperbolic/run.js
node research/07-raycast/run.js
```

## The seven

| # | Folder | Hypothesis | Status |
|---|---|---|---|
| 1 | `01-warp-folding` | Domain-warping folds at exactly `s = s_crit(seed)` computable from analytic gradients | **ready** |
| 2 | `02-critical-points` | Critical-point density and saddle balance discriminate lattice artifacts across algorithms | **ready** |
| 3 | `03-ridge-topology` | Ridged multifractal ridges percolate above a critical persistence | **design** |
| 4 | `04-isotropy` | Structure-tensor eigenvalue ratio measures anisotropy; discriminates Perlin vs Simplex vs OS2 | **ready** |
| 5 | `05-4d-time` | 4D noise sliced as (x,y,z,t) is stationary in t - safe for animation | **design** |
| 6 | `06-hyperbolic` | Noise sampled on ℍ² has exponentially growing feature size in the Euclidean projection | **design** |
| 7 | `07-raycast` | Analytic-gradient ray marching converges ~3× faster than bisection on implicit noise SDFs | **design** |

## Paper trajectory

**Paper A** - *Quantifying gradient noise quality via analytic derivatives.*
Combines #1 (folding), #2 (critical points), #3 (ridge percolation), #4
(isotropy). One framework, one benchmark suite, one set of charts. The
novelty is that all four metrics require derivatives, and ForgeNoise is
the first JS library that provides them analytically in the same pass as
the value. Target: Journal of Graphics Tools or Computers & Graphics.

**Paper B** - *Noise beyond ℝ²: 4D, hyperbolic, and implicit-surface raycasting.*
Combines #5, #6, #7. Speculative - publishable only if the hyperbolic
result is strong (i.e., the exponential feature-size law is clean). Target:
ACM TOG or SIGGRAPH; fallback arXiv.

## Falsifiability per experiment

Each experiment's README states the hypothesis as a claim that could be
shown false with the data. If the data contradicts the hypothesis, that's
a result too - report it honestly, don't massage the experiment until the
hypothesis wins. Papers that honestly report a negative result get cited
more than papers that p-hack.

## Known limitations

- The `dist/` folder occasionally has filename case inconsistency (`forgeNoise.min.js` vs `ForgeNoise.min.js`). If `require` fails, check `ls dist/`.
- OS2F / OS2S do not ship analytic derivatives; where needed, use central finite differences (`fdGrad` in `lib.js`).
- Perlin does not ship an analytic derivative either; same caveat.
- All `s_crit` results are for single-iteration uniform warp. Multi-iteration warp chains Jacobians (see `01-warp-folding/README`).