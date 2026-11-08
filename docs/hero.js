(function () {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas || typeof ForgeNoise === 'undefined') return;
  const ctx = canvas.getContext('2d', { alpha: false });
  const noise = new ForgeNoise(0xDEAD);
  const labelEl = document.getElementById('hero-label');

  const DOWNSCALE  = 4;
  const STAGE_MS   = 6500;
  const FADE_MS    = 2200;
  const MIN_LAYERS = 1;
  const MAX_LAYERS = 5;

  function smoothstep(t) { return t * t * (3 - 2 * t); }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function pick(r, a) { return a[Math.floor(r() * a.length)]; }
  function xorshift(seed) {
    let s = seed | 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }

  // ── Palettes ──────────────────────────────────────────────────
  const PAL = {
    orange:  (v) => { const g=(v+1)*0.5, g2=g*g; return [55+200*g, 90*g2+20*g, 8+45*g2]; },
    viridis: (v) => { const g=Math.max(0,Math.min(1,(v+1)*0.5)); return [68+g*185, 1+g*230, 84-g*47]; },
    cyan:    (v) => { const g=(v+1)*0.5; return [15*g, 30+130*g, 55+175*g]; },
    magenta: (v) => { const g=(v+1)*0.5; return [25+175*g, 25*g, 45+200*g]; },
    terrain: (v) => {
      const g=(v+1)*0.5;
      if (g<0.35) return [20, 60+g*220, 95+g*200];
      if (g<0.55) return [215, 190, 115];
      if (g<0.75) return [60+(g-0.55)*500, 110+(g-0.55)*300, 30];
      return [175+(g-0.75)*400, 165+(g-0.75)*400, 185+(g-0.75)*400];
    },
    teal:    (v) => { const g=(v+1)*0.5; return [10, 90+165*g, 130+110*g]; },
    rose:    (v) => { const g=(v+1)*0.5, g2=g*g; return [140+100*g, 45+100*g2, 75+160*g2]; },
    fire:    (v) => {
      const g=Math.max(0,Math.min(1,(v+1)*0.5));
      return [255*Math.min(1,g*2), 180*Math.max(0,g*2-1), 20*Math.max(0,g*3-2)];
    },
    ocean:   (v) => { const g=(v+1)*0.5; return [20+40*g, 60+120*g, 120+135*g]; },
  };
  function buildLUT(pal) {
    const lut = new Uint8Array(768);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = pal((i / 255) * 2 - 1);
      lut[i*3] = Math.max(0, Math.min(255, r|0));
      lut[i*3 + 1] = Math.max(0, Math.min(255, g|0));
      lut[i*3 + 2] = Math.max(0, Math.min(255, b|0));
    }
    return lut;
  }

  // ── Layers ────────────────────────────────────────────────────
  const LAYER = {
    simplex2d:  (x, y, t) => noise.generateSimplex2D(x, y + t * 0.3),
    simplex3d:  (x, y, t) => noise.generateSimplex3D(x, y, t * 0.5),
    os2f2d:     (x, y, t) => noise.generateOpenSimplex2F_2D(x, y + t * 0.3),
    os2f3d:     (x, y, t) => noise.generateOpenSimplex2F_3D(x, y, t * 0.4),
    os2s3d:     (x, y, t) => noise.generateOpenSimplex2S_3D(x, y, t * 0.4),
    perlin3d:   (x, y, t) => noise.generate3D(x, y, t * 0.4),
    worley2d:   (x, y)    => noise.generateWorley2D01(x * 1.8, y * 1.8) * 2 - 1,
    worley3d:   (x, y, t) => noise.generateWorley3D01(x * 1.6, y * 1.6, t * 0.6) * 2 - 1,
    fractal:    (x, y, t) => noise.generateFractal2D(x, y + t * 0.2, { octaves: 5, persistence: 0.55 }),
    ridged:     (x, y, t) => noise.generateFractal2D(x, y + t * 0.2, { octaves: 5, type: 'ridged' }) * 2 - 1,
    turbulence: (x, y, t) => noise.generateFractal2D(x, y + t * 0.2, { octaves: 5, type: 'turbulence' }) * 2 - 1,
    warp:       (x, y)    => noise.warp2D(x, y, { warpStrength: 1.8, warpScale: 1.6, iterations: 2 }),
    warp3d:     (x, y, t) => noise.warp3D(x, y, t * 0.4, { warpStrength: 1.6, warpScale: 1.4 }),
  };
  const LAYER_LABEL = {
    simplex2d: 'Simplex 2D', simplex3d: 'Simplex 3D',
    os2f2d: 'OS2F 2D', os2f3d: 'OS2F 3D', os2s3d: 'OS2S 3D',
    perlin3d: 'Perlin 3D', worley2d: 'Worley 2D', worley3d: 'Worley 3D',
    fractal: 'fBm', ridged: 'Ridged', turbulence: 'Turbulence',
    warp: 'Warp 2D', warp3d: 'Warp 3D',
  };
  const ALL_LAYERS = Object.keys(LAYER);

  function randomStage(rng) {
    const r = rng();
    let n;
    if      (r < 0.10) n = 1;
    else if (r < 0.30) n = 2;
    else if (r < 0.65) n = 3;
    else if (r < 0.88) n = 4;
    else               n = 5;
    n = Math.max(MIN_LAYERS, Math.min(MAX_LAYERS, n));

    const picked = [...ALL_LAYERS].sort(() => rng() - 0.5).slice(0, n);
    const opacity = picked.map(() => Math.max(0.04, Math.pow(rng(), 1.6)));
    const dom = Math.floor(rng() * n);
    opacity[dom] = Math.max(opacity[dom], 0.6 + rng() * 0.4);
    const sum = opacity.reduce((a, b) => a + b, 0);
    const weights = opacity.map(o => o / sum);
    const palName = pick(rng, Object.keys(PAL));

    return {
      label: picked.map(k => LAYER_LABEL[k]).join(' + '),
      zoom: 1.2 + rng() * 1.6,
      layerFns: picked.map(k => LAYER[k]),
      weights,
      lut: buildLUT(PAL[palName]),
    };
  }

  const rng = xorshift((Math.random() * 2 ** 31) | 0);
  const STAGES = Array.from({ length: 10 }, () => randomStage(rng));

  // ── Rendering state ───────────────────────────────────────────
  let drawW = 0, drawH = 0, renderW = 0, renderH = 0;
  let bufA = null, bufB = null, bufOut = null;
  let tmpCanvas = null, tmpCtx = null;
  let cx = 0, cy = 0, worldScale = 0;
  let stageIdx = 0, stageStart = performance.now();
  let transitionIdx = -1, lastTransitionIdx = -1, transitionData = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    drawW = Math.max(1, Math.ceil(canvas.clientWidth  * dpr));
    drawH = Math.max(1, Math.ceil(canvas.clientHeight * dpr));
    canvas.width = drawW;
    canvas.height = drawH;
    ctx.imageSmoothingEnabled = false;

    renderW = Math.max(1, Math.ceil(drawW / DOWNSCALE));
    renderH = Math.max(1, Math.ceil(drawH / DOWNSCALE));

    if (!tmpCanvas) {
      tmpCanvas = document.createElement('canvas');
      tmpCtx = tmpCanvas.getContext('2d');
    }
    tmpCanvas.width  = renderW;
    tmpCanvas.height = renderH;
    tmpCtx.imageSmoothingEnabled = false;

    bufA   = tmpCtx.createImageData(renderW, renderH);
    bufB   = tmpCtx.createImageData(renderW, renderH);
    bufOut = tmpCtx.createImageData(renderW, renderH);

    cx = renderW * 0.5;
    cy = renderH * 0.5;
    worldScale = 4 / Math.min(renderW, renderH);

    // Any in-flight transition's mask is the wrong size now - restart the
    // current stage so we re-render A cleanly.
    transitionIdx = -1;
    transitionData = null;
    stageStart = performance.now();
  }

  function composite(stage, wx, wy, t) {
    let v = 0;
    for (let i = 0; i < stage.layerFns.length; i++) {
      v += stage.layerFns[i](wx, wy, t) * stage.weights[i];
    }
    return v;
  }
  function lutIdx(v) {
    let idx = ((v + 1) * 0.5 * 255) | 0;
    if (idx < 0) idx = 0; else if (idx > 255) idx = 255;
    return idx * 3;
  }
  function renderInto(stage, target, time) {
    const t = time * 0.0002;
    const ws = worldScale * stage.zoom;
    const lut = stage.lut;
    const data = target.data;
    for (let y = 0; y < renderH; y++) {
      const wy = (y - cy) * ws;
      const rowBase = y * renderW;
      for (let x = 0; x < renderW; x++) {
        const wx = (x - cx) * ws;
        const v = composite(stage, wx, wy, t);
        const li = lutIdx(v);
        const idx = (rowBase + x) * 4;
        data[idx] = lut[li];
        data[idx + 1] = lut[li + 1];
        data[idx + 2] = lut[li + 2];
        data[idx + 3] = 255;
      }
    }
  }
  function blit() {
    tmpCtx.putImageData(bufOut, 0, 0);
    ctx.drawImage(tmpCanvas, 0, 0, renderW, renderH, 0, 0, drawW, drawH);
  }

  // ── Shared melt kernel ───────────────────────────────────────
  // mask[i] < threshold → B ; mask[i] > threshold → A. Threshold sweeps
  // from below mask.min at p=0 to above mask.max at p=1, so the flips
  // happen wherever mask is *lowest* first, then spread outward.
  function meltWithMask(a, b, out, p, d) {
    const { mask, edge } = d;
    const pe = smoothstep(p);
    const lo = d.lo, hi = d.hi;
    const threshold = lo + pe * (hi - lo);
    const softLo = threshold - edge;
    const softHi = threshold + edge;
    const span = softHi - softLo;
    const n = mask.length;
    for (let i = 0; i < n; i++) {
      const v = mask[i];
      let s;
      if (v > softHi) s = 0;
      else if (v < softLo) s = 1;
      else s = smoothstep((softHi - v) / span);
      const idx = i * 4;
      out[idx]     = a[idx]     * (1 - s) + b[idx]     * s;
      out[idx + 1] = a[idx + 1] * (1 - s) + b[idx + 1] * s;
      out[idx + 2] = a[idx + 2] * (1 - s) + b[idx + 2] * s;
      out[idx + 3] = 255;
    }
  }

  function maskMinMax(mask) {
    let lo =  Infinity, hi = -Infinity;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] < lo) lo = mask[i];
      if (mask[i] > hi) hi = mask[i];
    }
    return { lo: lo - 0.05, hi: hi + 0.05 };
  }

  function buildStaticMask(generator, rng) {
    const mask = new Float32Array(renderW * renderH);
    const opts = generator.options ? generator.options(rng) : {};
    for (let y = 0; y < renderH; y++) {
      for (let x = 0; x < renderW; x++) {
        mask[y * renderW + x] = generator.fn(x, y, opts);
      }
    }
    const { lo, hi } = maskMinMax(mask);
    return { mask, lo, hi, edge: (hi - lo) * (0.03 + rng() * 0.07), ...opts };
  }

  // ── The 12 transitions ───────────────────────────────────────
  const TRANSITIONS = [
    {
      id: 'simplex-melt',
      roll: (r) => {
        const scale = 0.03 + r() * 0.04;
        const reverse = r() < 0.5;
        return buildStaticMask({
          fn: (x, y) => {
            const v = noise.generateSimplex2D(x * scale, y * scale);
            return reverse ? -v : v;
          },
        }, r);
      },
      fn: meltWithMask,
    },
    {
      id: 'fbm-dissolve',
      roll: (r) => {
        const scale = 0.02 + r() * 0.03;
        const octaves = 3 + Math.floor(r() * 4);
        const reverse = r() < 0.5;
        return buildStaticMask({
          fn: (x, y) => {
            const v = noise.generateFractal2D(x * scale, y * scale, { octaves });
            return reverse ? -v : v;
          },
        }, r);
      },
      fn: meltWithMask,
    },
    {
      id: 'cellular-edges',
      roll: (r) => {
        const scale = 0.04 + r() * 0.05;
        return buildStaticMask({
          fn: (x, y) => noise.generateCellular2D(x * scale, y * scale, { returnType: 'f2-f1' }),
        }, r);
      },
      fn: meltWithMask,
    },
    {
      id: 'cellular-centers',
      roll: (r) => {
        const scale = 0.04 + r() * 0.05;
        return buildStaticMask({
          fn: (x, y) => noise.generateCellular2D(x * scale, y * scale, { returnType: 'f1' }),
        }, r);
      },
      fn: meltWithMask,
    },
    {
      id: 'ridged-melt',
      roll: (r) => {
        const scale = 0.02 + r() * 0.03;
        return buildStaticMask({
          fn: (x, y) => noise.generateFractal2D(x * scale, y * scale, { octaves: 5, type: 'ridged' }),
        }, r);
      },
      fn: meltWithMask,
    },
    {
      id: 'turbulence-melt',
      roll: (r) => {
        const scale = 0.02 + r() * 0.03;
        return buildStaticMask({
          fn: (x, y) => noise.generateFractal2D(x * scale, y * scale, { octaves: 5, type: 'turbulence' }),
        }, r);
      },
      fn: meltWithMask,
    },
    {
      id: 'os2f-melt',
      roll: (r) => {
        const scale = 0.03 + r() * 0.04;
        const reverse = r() < 0.5;
        return buildStaticMask({
          fn: (x, y) => {
            const v = noise.generateOpenSimplex2F_2D(x * scale, y * scale);
            return reverse ? -v : v;
          },
        }, r);
      },
      fn: meltWithMask,
    },
    {
      id: 'perlin-melt',
      roll: (r) => {
        const scale = 0.03 + r() * 0.04;
        const reverse = r() < 0.5;
        return buildStaticMask({
          fn: (x, y) => {
            const v = noise.generate2D(x * scale, y * scale);
            return reverse ? -v : v;
          },
        }, r);
      },
      fn: meltWithMask,
    },
    {
      id: 'value-melt',
      roll: (r) => {
        const scale = 0.03 + r() * 0.05;
        return buildStaticMask({
          fn: (x, y) => noise.generateValue2D(x * scale, y * scale),
        }, r);
      },
      fn: meltWithMask,
    },
    {
      id: 'warp-dissolve',
      roll: (r) => {
        const scale = 0.03 + r() * 0.03;
        const strength = 1.0 + r() * 1.5;
        return buildStaticMask({
          fn: (x, y) => noise.warp2D(x * scale, y * scale, {
            warpStrength: strength, warpScale: 1.5, iterations: 1,
          }),
        }, r);
      },
      fn: meltWithMask,
    },
    {
      id: 'directional-fbm',
      roll: (r) => {
        const scale = 0.02 + r() * 0.03;
        const angle = r() * Math.PI * 2;
        const bias = 0.4 + r() * 0.7;
        const cosA = Math.cos(angle), sinA = Math.sin(angle);
        // Directional bias combined with fBm - the reveal "sweeps"
        // in one direction but the boundary shape is still fBm.
        const mask = new Float32Array(renderW * renderH);
        for (let y = 0; y < renderH; y++) {
          const ny = (y / renderH) - 0.5;
          for (let x = 0; x < renderW; x++) {
            const nx = (x / renderW) - 0.5;
            const pos = nx * cosA + ny * sinA;      // -0.7 to 0.7
            const fb = noise.generateFractal2D(x * scale, y * scale, { octaves: 4 });
            mask[y * renderW + x] = fb * 0.6 + pos * bias;
          }
        }
        const { lo, hi } = maskMinMax(mask);
        return { mask, lo, hi, edge: (hi - lo) * 0.08 };
      },
      fn: meltWithMask,
    },
    {
      id: '3d-sweep',
      roll: (r) => {
        const scale = 0.02 + r() * 0.03;
        const zSpeed = 1.0 + r() * 1.5;
        const blend = 0.7 + r() * 0.3;
        return { scale, zSpeed, blend };
      },
      fn: (a, b, out, p, d) => {
        // The mask itself evolves with progress - 3D noise where the
        // third dimension is time. Combined with a rising bias so p=0
        // → all A, p=1 → all B.
        const pe = smoothstep(p);
        const z = p * d.zSpeed;
        const bias = pe * 2 - 1;
        const scale = d.scale, blend = d.blend;
        for (let y = 0; y < renderH; y++) {
          for (let x = 0; x < renderW; x++) {
            const n = noise.generateSimplex3D(x * scale, y * scale, z);
            let s = clamp01((n * 0.5 + bias) * blend * 0.5 + 0.5);
            s = smoothstep(s);
            const i = y * renderW + x;
            const idx = i * 4;
            out[idx]     = a[idx]     * (1 - s) + b[idx]     * s;
            out[idx + 1] = a[idx + 1] * (1 - s) + b[idx + 1] * s;
            out[idx + 2] = a[idx + 2] * (1 - s) + b[idx + 2] * s;
            out[idx + 3] = 255;
          }
        }
      },
    },
  ];

  function rollNextTransition() {
    let idx;
    do { idx = Math.floor(rng() * TRANSITIONS.length); }
    while (idx === lastTransitionIdx && TRANSITIONS.length > 1);
    lastTransitionIdx = idx;
    return idx;
  }

  // ── Main loop ─────────────────────────────────────────────────
  function loop(time) {
    const stage = STAGES[stageIdx];
    const next  = STAGES[(stageIdx + 1) % STAGES.length];
    const elapsed = time - stageStart;
    const fadeStart = STAGE_MS - FADE_MS;

    if (elapsed < fadeStart) {
      if (transitionIdx !== -1) transitionIdx = -1;
      renderInto(stage, bufOut, time);
      blit();
      if (labelEl) labelEl.textContent = stage.label;
    } else {
      if (transitionIdx === -1) {
        transitionIdx = rollNextTransition();
        transitionData = TRANSITIONS[transitionIdx].roll(rng);
      }
      const progress = Math.min(1, (elapsed - fadeStart) / FADE_MS);
      renderInto(stage, bufA, time);
      renderInto(next,  bufB, time);
      TRANSITIONS[transitionIdx].fn(bufA.data, bufB.data, bufOut.data, progress, transitionData);
      blit();

      if (labelEl) {
        labelEl.textContent =
          stage.label + '  →  ' + next.label +
          '  ·  ' + TRANSITIONS[transitionIdx].id;
      }
      if (progress >= 1) {
        stageIdx = (stageIdx + 1) % STAGES.length;
        stageStart = time;
        transitionIdx = -1;
        transitionData = null;
      }
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(loop);
})();