# ForgeNoise

**Procedural noise for JavaScript - fast, dependency-free, seedable.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

[**Live Demo**](https://cmdaeo.github.io/forgeNoise/demo.html) ·
[**API Reference**](https://cmdaeo.github.io/forgeNoise/api.html) ·
[**Benchmarks**](https://cmdaeo.github.io/forgeNoise/benchmark.html) ·
[**GitHub**](https://github.com/cmdaeo/forgeNoise)

---

Perlin, Simplex, OpenSimplex2 (F & S), Value, Worley, Voronoi, configurable cellular noise, five fractal modes, tiling, domain warping, and analytic derivatives - all in one plain-JavaScript file with zero dependencies.

## Install

Drop it in with a `<script>` tag from jsDelivr (pulls directly from GitHub):

```html
<script src="https://cdn.jsdelivr.net/gh/cmdaeo/forgeNoise@main/dist/forgeNoise.min.js"></script>
```

Or download `dist/forgeNoise.min.js` directly from this repository and include it locally.

For production, pin to a specific tag or commit SHA instead of `@main` so CDN caching can't serve you a stale build:

```html
<script src="https://cdn.jsdelivr.net/gh/cmdaeo/forgeNoise@v1.1.0/dist/forgeNoise.min.js"></script>
```

> **Note:** jsDelivr caches `@main` branch references for up to 12 hours. If you just pushed an update and the CDN still serves the old file, either wait or [purge the cache](https://www.jsdelivr.com/tools/purge).

```js
// Once loaded, ForgeNoise is available globally:
const noise = new ForgeNoise(1337);
```

## Quick start

```js
const noise = new ForgeNoise(1337);   // seed - any number

noise.generate2D(x, y);                               // Perlin,          [-1, 1]
noise.generateSimplex3D(x, y, z);                     // Simplex 3D,      [-1, 1]
noise.generateFractal2D(x, y, { octaves: 6 });        // fBm,             [-1, 1]
noise.generateWorley2D01(x, y);                       // Worley,          [0, 1]
noise.warp2D(x, y, { warpStrength: 2, warpScale: 1.5 });
```

## Features

### Algorithms

**Perlin**
`generate1D` · `generate2D` · `generate3D` · `generate4D` · `generateTiling2D` · `generateTiling3D`

**Simplex**
`generateSimplex1D` · `generateSimplex2D` · `generateSimplex3D` · `generateSimplex4D` ·
`generateSimplex2D_Derivative` · `generateSimplex3D_Derivative`

**OpenSimplex2**
`generateOpenSimplex2F_2D / 3D / 4D` · `generateOpenSimplex2S_2D / 3D / 4D` (plus `ImproveX`, `ImproveXY`, `ImproveXZ`, `ImproveXYZ`, `ImproveZW`, `Fallback` orientations for each)

**Value**
`generateValue1D` · `generateValue2D` · `generateValue3D`

**Worley / cellular**
`generateWorley2D` · `generateWorley3D` · `generateWorley2D_Sq` · `generateWorley3D_Sq` ·
`generateVoronoi2D` · `generateCellular2D` · `generateCellular3D` · `getCellPoint2D` · `getCellPoint3D`

**Fractal** - fBm, ridged, turbulence, ping-pong, hybrid
`generateFractal1D / 2D / 3D` · `generateSimplexFractal1D / 2D / 3D` ·
`generateSimplexFractal2D_Derivative`

**Domain warp**
`warp2D` · `warp3D` · `warpCoords2D` · `warpCoords3D`

**`[0, 1]` variants** for every kernel - append `01` to the method name.

### Design

- **Seedable** - `new ForgeNoise(seed)` reproduces exactly; `reseed(seed)` re-uses the instance.
- **No allocations** on the hot path. Optional `out` arrays for the few methods that could otherwise allocate.
- **Uniform output range** - `[-1, 1]` everywhere, `[0, 1]` for `*01` variants.
- **No dependencies**, single file, ~15 KB minified.
- **UMD** - works with a plain `<script>` tag, or `require()` / `import` if you bundle it.

## Benchmarks

Measured on an AMD Ryzen 5 3500U, Node 24.15, V8 13.6, 7 trials per category, rotation order, trial 1 dropped. **Median op/s**; difference counts as a win only when the 95 % confidence intervals don't overlap.

| Category | ForgeNoise | Competitor | Ratio |
|---|---:|---:|---:|
| **Simplex 2D** | 40,940,793 | `simplex-noise` 20,204,578 | **2.03×** |
| **Simplex 3D** | 15,327,358 | `simplex-noise` 13,260,554 | **1.16×** |
| Simplex 4D | 7,366,274 | `simplex-noise` 7,482,144 | 0.98× (tied) |
| **Perlin 2D** | 81,320,086 | `noisejs` 61,834,862 | **1.31×** |
| **Perlin 3D** | 19,675,765 | `noisejs` 17,038,556 | **1.15×** |
| **Value 2D** | 110,775,872 | `fastnoise-lite` 16,758,416 | **6.61×** |
| **Value 3D** | 59,277,375 | `fastnoise-lite` 9,926,743 | **5.97×** |
| **Worley 2D** | 14,117,208 | `fastnoise-lite` 7,121,329 | **1.98×** |
| **Worley 3D** | 4,324,084 | `fastnoise-lite` 2,599,985 | **1.66×** |
| **Fractal (Simplex) 2D** | 6,825,701 | `fastnoise-lite` 4,335,152 | **1.57×** |
| **Fractal (Simplex) 3D** | 4,931,055 | `fastnoise-lite` 2,072,440 | **2.38×** |

10 wins, 1 tie, 0 losses. Full methodology and per-test data (CPU %, RSS, p50/p95/p99 latency, 95 % CIs) at the [benchmark page](https://cmdaeo.github.io/forgeNoise/benchmark.html). Reproduce locally with `npm run bench`.

## Examples

**Terrain heightmap**

```js
const noise = new ForgeNoise(42);
const height = noise.generateFractal2D(x / 100, y / 100, {
  octaves: 8,
  persistence: 0.55,
  lacunarity: 2.0,
});
```

**Cellular texture**

```js
const noise = new ForgeNoise(7);
const pattern = noise.generateWorley2D01(x / 20, y / 20);
```

**Domain-warped fBm**

```js
const noise = new ForgeNoise(99);
const warped = noise.warp2D(x / 50, y / 50, {
  warpStrength: 2.5,
  warpScale: 1.5,
  iterations: 2,
});
```

**Tileable**

```js
const noise = new ForgeNoise(1);
const tile = noise.generateTiling2D(x, y, { periodX: 128, periodY: 128 });
```

**Ridged terrain with derivative (for erosion, lighting, flow fields)**

```js
const noise = new ForgeNoise(3);
const grad = new Float64Array(3);
noise.generateSimplexFractal2D_Derivative(x, y, grad, { octaves: 5 });
// grad = [value, d/dx, d/dy]
```

## API

Full reference at the [API page](https://cmdaeo.github.io/forgeNoise/api.html), generated automatically from `forgeNoise.js` source comments. To add documentation for a method, put a `//` or `/** */` comment above its `ForgeNoise.prototype.X = function...` line:

```js
// @range [-1, 1]
// 3D simplex noise - branch-free ordering, structure-of-arrays gradients.
ForgeNoise.prototype.generateSimplex3D = function simplex3D(x, y, z) { ... };
```

Then `npm run build:web`.

## Browser support

Works in any browser with typed arrays: Chrome, Firefox, Safari, Edge - every version released since 2015. Also runs in Node, Deno, Bun, and Web Workers.

## Development

```bash
git clone https://github.com/cmdaeo/forgeNoise.git
cd forgeNoise
npm install

npm test                # mocha - 30 s
npm run bench:quick     # 3-trial benchmark (~20 min)
npm run bench           # 7-trial definitive run (~45 min)

npm run build           # minify forgeNoise.js → dist/forgeNoise.min.js
npm run build:web       # regen docs/api-data.js, docs/bench-data.js, docs/dist/
npx serve docs          # static server on http://localhost:3000
```

Node 24 recommended.

## License

MIT © [cmdaeo](https://github.com/cmdaeo)
