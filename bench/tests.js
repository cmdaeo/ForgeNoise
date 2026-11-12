'use strict';
const path = require('path');
const ForgeNoise = require('../dist/ForgeNoise.min.js'); // adjust if needed

module.exports = [
  // ═══════════════════════════════════════════════════════════════════
  // 1. PERLIN
  // ═══════════════════════════════════════════════════════════════════
  { id: 'fn_perlin1d', cat: 'Perlin 1D', lib: 'ForgeNoise', dims: 1,
    setup: () => { const n = new ForgeNoise(1337); return (x) => n.generate1D(x); } },

  { id: 'fn_perlin2d', cat: 'Perlin 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generate2D(x,y); } },
  { id: 'fnl_perlin2d', cat: 'Perlin 2D', lib: 'fastnoise-lite', dims: 2,
    setup: async () => {
      const { default: FNL } = await import('fastnoise-lite');
      const n = new FNL(1337); n.SetNoiseType(FNL.NoiseType.Perlin);
      return (x,y) => n.GetNoise(x,y);
    } },
  { id: 'noisejs_perlin2d', cat: 'Perlin 2D', lib: 'noisejs', dims: 2,
    setup: () => {
      const Noise = require('noisejs').Noise || require('noisejs');
      const n = new Noise(1337);
      return (x,y) => n.perlin2(x,y);
    } },

  { id: 'fn_perlin3d', cat: 'Perlin 3D', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.generate3D(x,y,z); } },
  { id: 'fnl_perlin3d', cat: 'Perlin 3D', lib: 'fastnoise-lite', dims: 3,
    setup: async () => {
      const { default: FNL } = await import('fastnoise-lite');
      const n = new FNL(1337); n.SetNoiseType(FNL.NoiseType.Perlin);
      return (x,y,z) => n.GetNoise(x,y,z);
    } },
  { id: 'noisejs_perlin3d', cat: 'Perlin 3D', lib: 'noisejs', dims: 3,
    setup: () => {
      const Noise = require('noisejs').Noise || require('noisejs');
      const n = new Noise(1337);
      return (x,y,z) => n.perlin3(x,y,z);
    } },

  { id: 'fn_perlin4d', cat: 'Perlin 4D', lib: 'ForgeNoise', dims: 4,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z,w) => n.generate4D(x,y,z,w); } },
  // fastnoise-lite has no 4D Perlin

  // ═══════════════════════════════════════════════════════════════════
  // 2. SIMPLEX (standard / Ken Perlin simplex)
  // ═══════════════════════════════════════════════════════════════════
  { id: 'fn_simplex1d', cat: 'Simplex 1D', lib: 'ForgeNoise', dims: 1,
    setup: () => { const n = new ForgeNoise(1337); return (x) => n.generateSimplex1D(x); } },

  { id: 'fn_simplex2d', cat: 'Simplex 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateSimplex2D(x,y); } },
  { id: 'sn_simplex2d', cat: 'Simplex 2D', lib: 'simplex-noise', dims: 2,
    setup: async () => {
      const { createNoise2D } = await import('simplex-noise');
      const n = createNoise2D();
      return (x,y) => n(x,y);
    } },
  { id: 'fnl_simplex2d', cat: 'Simplex 2D', lib: 'fastnoise-lite', dims: 2,
    setup: async () => {
      const { default: FNL } = await import('fastnoise-lite');
      const n = new FNL(1337); n.SetNoiseType(FNL.NoiseType.OpenSimplex2);
      return (x,y) => n.GetNoise(x,y);
    } },
  { id: 'osn_simplex2d', cat: 'Simplex 2D', lib: 'open-simplex', dims: 2,
    setup: async () => {
      const { makeNoise2D } = await import('open-simplex-noise');
      const n = makeNoise2D(1337);
      return (x,y) => n(x,y);
    } },
  { id: 'noisejs_simplex2d', cat: 'Simplex 2D', lib: 'noisejs', dims: 2,
    setup: () => {
      const Noise = require('noisejs').Noise || require('noisejs');
      const n = new Noise(1337);
      return (x,y) => n.simplex2(x,y);
    } },

  { id: 'fn_simplex3d', cat: 'Simplex 3D', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.generateSimplex3D(x,y,z); } },
  { id: 'sn_simplex3d', cat: 'Simplex 3D', lib: 'simplex-noise', dims: 3,
    setup: async () => {
      const { createNoise3D } = await import('simplex-noise');
      const n = createNoise3D();
      return (x,y,z) => n(x,y,z);
    } },
  { id: 'fnl_simplex3d', cat: 'Simplex 3D', lib: 'fastnoise-lite', dims: 3,
    setup: async () => {
      const { default: FNL } = await import('fastnoise-lite');
      const n = new FNL(1337); n.SetNoiseType(FNL.NoiseType.OpenSimplex2);
      return (x,y,z) => n.GetNoise(x,y,z);
    } },
  { id: 'osn_simplex3d', cat: 'Simplex 3D', lib: 'open-simplex', dims: 3,
    setup: async () => {
      const { makeNoise3D } = await import('open-simplex-noise');
      const n = makeNoise3D(1337);
      return (x,y,z) => n(x,y,z);
    } },
  { id: 'noisejs_simplex3d', cat: 'Simplex 3D', lib: 'noisejs', dims: 3,
    setup: () => {
      const Noise = require('noisejs').Noise || require('noisejs');
      const n = new Noise(1337);
      return (x,y,z) => n.simplex3(x,y,z);
    } },

  { id: 'fn_simplex4d', cat: 'Simplex 4D', lib: 'ForgeNoise', dims: 4,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z,w) => n.generateSimplex4D(x,y,z,w); } },
  { id: 'sn_simplex4d', cat: 'Simplex 4D', lib: 'simplex-noise', dims: 4,
    setup: async () => {
      const { createNoise4D } = await import('simplex-noise');
      const n = createNoise4D();
      return (x,y,z,w) => n(x,y,z,w);
    } },
  { id: 'osn_simplex4d', cat: 'Simplex 4D', lib: 'open-simplex', dims: 4,
    setup: async () => {
      const { makeNoise4D } = await import('open-simplex-noise');
      const n = makeNoise4D(1337);
      return (x,y,z,w) => n(x,y,z,w);
    } },

  // ═══════════════════════════════════════════════════════════════════
  // 3. VALUE
  // ═══════════════════════════════════════════════════════════════════
  { id: 'fn_value1d', cat: 'Value 1D', lib: 'ForgeNoise', dims: 1,
    setup: () => { const n = new ForgeNoise(1337); return (x) => n.generateValue1D(x); } },

  { id: 'fn_value2d', cat: 'Value 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateValue2D(x,y); } },
  { id: 'fnl_value2d', cat: 'Value 2D', lib: 'fastnoise-lite', dims: 2,
    setup: async () => {
      const { default: FNL } = await import('fastnoise-lite');
      const n = new FNL(1337); n.SetNoiseType(FNL.NoiseType.Value);
      return (x,y) => n.GetNoise(x,y);
    } },

  { id: 'fn_value3d', cat: 'Value 3D', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.generateValue3D(x,y,z); } },
  { id: 'fnl_value3d', cat: 'Value 3D', lib: 'fastnoise-lite', dims: 3,
    setup: async () => {
      const { default: FNL } = await import('fastnoise-lite');
      const n = new FNL(1337); n.SetNoiseType(FNL.NoiseType.Value);
      return (x,y,z) => n.GetNoise(x,y,z);
    } },

  // ═══════════════════════════════════════════════════════════════════
  // 4. WORLEY / CELLULAR
  // ═══════════════════════════════════════════════════════════════════
  { id: 'fn_worley2d', cat: 'Worley 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateWorley2D(x,y); } },
  { id: 'fnl_worley2d', cat: 'Worley 2D', lib: 'fastnoise-lite', dims: 2,
    setup: async () => {
      const { default: FNL } = await import('fastnoise-lite');
      const n = new FNL(1337);
      n.SetNoiseType(FNL.NoiseType.Cellular);
      n.SetCellularDistanceFunction(FNL.CellularDistanceFunction.Euclidean);
      n.SetCellularReturnType(FNL.CellularReturnType.Distance);
      return (x,y) => n.GetNoise(x,y);
    } },

  { id: 'fn_worley3d', cat: 'Worley 3D', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.generateWorley3D(x,y,z); } },
  { id: 'fnl_worley3d', cat: 'Worley 3D', lib: 'fastnoise-lite', dims: 3,
    setup: async () => {
      const { default: FNL } = await import('fastnoise-lite');
      const n = new FNL(1337);
      n.SetNoiseType(FNL.NoiseType.Cellular);
      n.SetCellularDistanceFunction(FNL.CellularDistanceFunction.Euclidean);
      n.SetCellularReturnType(FNL.CellularReturnType.Distance);
      return (x,y,z) => n.GetNoise(x,y,z);
    } },

  // ForgeNoise-only cellular variants
  { id: 'fn_cellular2d_f1', cat: 'Cellular 2D F1', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateCellular2D(x,y); } },
  { id: 'fn_cellular2d_f2f1', cat: 'Cellular 2D F2-F1', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateCellular2D(x,y,{returnType:'f2-f1'}); } },
  { id: 'fn_cellular3d_f1', cat: 'Cellular 3D F1', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.generateCellular3D(x,y,z); } },

  { id: 'fn_voronoi2d', cat: 'Voronoi 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateVoronoi2D(x,y).distance; } },

  // ═══════════════════════════════════════════════════════════════════
  // 5. FRACTALS (4 octaves)
  // ═══════════════════════════════════════════════════════════════════
  { id: 'fn_fractalperlin1d', cat: 'Fractal (Perlin) 1D', lib: 'ForgeNoise', dims: 1,
    setup: () => { const n = new ForgeNoise(1337); return (x) => n.generateFractal1D(x); } },
  { id: 'fn_fractalperlin2d', cat: 'Fractal (Perlin) 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateFractal2D(x,y); } },
  { id: 'fn_fractalperlin3d', cat: 'Fractal (Perlin) 3D', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.generateFractal3D(x,y,z); } },

  { id: 'fn_fractalsimplex1d', cat: 'Fractal (Simplex) 1D', lib: 'ForgeNoise', dims: 1,
    setup: () => { const n = new ForgeNoise(1337); return (x) => n.generateSimplexFractal1D(x); } },
  { id: 'fn_fractalsimplex2d', cat: 'Fractal (Simplex) 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateSimplexFractal2D(x,y); } },
  { id: 'fnl_fractalsimplex2d', cat: 'Fractal (Simplex) 2D', lib: 'fastnoise-lite', dims: 2,
    setup: async () => {
      const { default: FNL } = await import('fastnoise-lite');
      const n = new FNL(1337);
      n.SetNoiseType(FNL.NoiseType.OpenSimplex2);
      n.SetFractalType(FNL.FractalType.FBm);
      n.SetFractalOctaves(4);
      return (x,y) => n.GetNoise(x,y);
    } },

  { id: 'fn_fractalsimplex3d', cat: 'Fractal (Simplex) 3D', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.generateSimplexFractal3D(x,y,z); } },
  { id: 'fnl_fractalsimplex3d', cat: 'Fractal (Simplex) 3D', lib: 'fastnoise-lite', dims: 3,
    setup: async () => {
      const { default: FNL } = await import('fastnoise-lite');
      const n = new FNL(1337);
      n.SetNoiseType(FNL.NoiseType.OpenSimplex2);
      n.SetFractalType(FNL.FractalType.FBm);
      n.SetFractalOctaves(4);
      return (x,y,z) => n.GetNoise(x,y,z);
    } },

  // Advanced fractal modes (ForgeNoise only)
  { id: 'fn_fractal_ridged2d', cat: 'Fractal (Ridged) 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateFractal2D(x,y,{type:'ridged'}); } },
  { id: 'fn_fractal_turbulence2d', cat: 'Fractal (Turbulence) 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateFractal2D(x,y,{type:'turbulence'}); } },
  { id: 'fn_fractal_pingpong2d', cat: 'Fractal (PingPong) 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateFractal2D(x,y,{type:'pingpong'}); } },
  { id: 'fn_fractal_hybrid2d', cat: 'Fractal (Hybrid) 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateFractal2D(x,y,{type:'hybrid'}); } },

  // ═══════════════════════════════════════════════════════════════════
  // 6. TILING / PERIODIC
  // ═══════════════════════════════════════════════════════════════════
  { id: 'fn_tiling2d', cat: 'Tiling 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateTiling2D(x,y); } },
  { id: 'fn_tiling3d', cat: 'Tiling 3D', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.generateTiling3D(x,y,z); } },
  { id: 'fn_tilingsimplex2d', cat: 'Tiling Simplex 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateTilingSimplex2D(x,y); } },

  // ═══════════════════════════════════════════════════════════════════
  // 7. DOMAIN WARP
  // ═══════════════════════════════════════════════════════════════════
  { id: 'fn_warp2d', cat: 'Warp 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.warp2D(x,y); } },
  { id: 'fn_warp3d', cat: 'Warp 3D', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.warp3D(x,y,z); } },
  { id: 'fn_warpcoords2d', cat: 'WarpCoords 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); const out = new Float64Array(2);
      return (x,y) => { n.warpCoords2D(x,y,out); return out[0]; }; } },

  // ═══════════════════════════════════════════════════════════════════
  // 8. DERIVATIVES (ForgeNoise only)
  // ═══════════════════════════════════════════════════════════════════
  { id: 'fn_simplex2d_deriv', cat: 'Simplex 2D Derivative', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); const out = new Float64Array(3);
      return (x,y) => n.generateSimplex2D_Derivative(x,y,out); } },
  { id: 'fn_simplex3d_deriv', cat: 'Simplex 3D Derivative', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); const out = new Float64Array(4);
      return (x,y,z) => n.generateSimplex3D_Derivative(x,y,z,out); } },
  { id: 'fn_simplexfractal2d_deriv', cat: 'Fractal Simplex 2D Derivative', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); const out = new Float64Array(3);
      return (x,y) => n.generateSimplexFractal2D_Derivative(x,y,out); } },

  // ═══════════════════════════════════════════════════════════════════
  // 9. OpenSimplex2 F / S (ForgeNoise only; other libs differ)
  // ═══════════════════════════════════════════════════════════════════
  { id: 'fn_os2f_2d', cat: 'OpenSimplex2F 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateOpenSimplex2F_2D(x,y); } },
  { id: 'fn_os2f_3d', cat: 'OpenSimplex2F 3D', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.generateOpenSimplex2F_3D(x,y,z); } },
  { id: 'fn_os2f_4d', cat: 'OpenSimplex2F 4D', lib: 'ForgeNoise', dims: 4,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z,w) => n.generateOpenSimplex2F_4D(x,y,z,w); } },

  { id: 'fn_os2s_2d', cat: 'OpenSimplex2S 2D', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateOpenSimplex2S_2D(x,y); } },
  { id: 'fn_os2s_3d', cat: 'OpenSimplex2S 3D', lib: 'ForgeNoise', dims: 3,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z) => n.generateOpenSimplex2S_3D(x,y,z); } },
  { id: 'fn_os2s_4d', cat: 'OpenSimplex2S 4D', lib: 'ForgeNoise', dims: 4,
    setup: () => { const n = new ForgeNoise(1337); return (x,y,z,w) => n.generateOpenSimplex2S_4D(x,y,z,w); } },

  // ═══════════════════════════════════════════════════════════════════
  // 10. [0,1] VARIANTS (overhead check)
  // ═══════════════════════════════════════════════════════════════════
  { id: 'fn_simplex2d_01', cat: 'Simplex 2D [0,1]', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generateSimplex2D01(x,y); } },
  { id: 'fn_perlin2d_01', cat: 'Perlin 2D [0,1]', lib: 'ForgeNoise', dims: 2,
    setup: () => { const n = new ForgeNoise(1337); return (x,y) => n.generate2D01(x,y); } },
];