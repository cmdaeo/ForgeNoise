(function () {
  const canvas = document.getElementById('demo-canvas');
  const ctx = canvas.getContext('2d');
  const hud = {
    fps: document.getElementById('fps'),
    frame: document.getElementById('frame'),
    pps: document.getElementById('pps'),
  };
  const ui = {
    algo: document.getElementById('algo'),
    seed: document.getElementById('seed'),
    zoom: document.getElementById('zoom'),
    zoomVal: document.getElementById('zoomVal'),
    speed: document.getElementById('speed'),
    speedVal: document.getElementById('speedVal'),
    octaves: document.getElementById('octaves'),
    octVal: document.getElementById('octVal'),
    res: document.getElementById('res'),
    palette: document.getElementById('palette'),
    pause: document.getElementById('pause'),
  };

  let noise = new ForgeNoise(1337);
  let W, H, img, dpr = 1;
  let t = 0, paused = false, last = performance.now();

  function resize() {
    const wrap = canvas.parentElement;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.max(1, Math.floor(wrap.clientWidth * dpr));
    H = Math.max(1, Math.floor(wrap.clientHeight * dpr));
    canvas.width = W;
    canvas.height = H;
    img = ctx.createImageData(W, H);
  }

  function reseed() {
    const s = parseInt(ui.seed.value, 10) || 1337;
    noise = new ForgeNoise(s);
  }

  const palettes = {
    thermal: (v) => {
      const g = Math.max(0, Math.min(255, (v + 1) * 127.5));
      return [g, g * 0.4, 255 - g];
    },
    grayscale: (v) => {
      const g = Math.max(0, Math.min(255, (v + 1) * 127.5));
      return [g, g, g];
    },
    viridis: (v) => {
      const g = Math.max(0, Math.min(1, (v + 1) * 0.5));
      const r = 68 + g * (253 - 68);
      const gg = 1 + g * (231 - 1);
      const b = 84 + g * (37 - 84);
      return [r, gg, b];
    },
    terrain: (v) => {
      const g = (v + 1) * 0.5;
      if (g < 0.4) return [50 + g * 100, 80 + g * 120, 30];
      if (g < 0.7) return [100 + (g - 0.4) * 400, 80 + (g - 0.4) * 200, 30];
      return [220, 220, 230];
    },
  };

  function render(time) {
    if (paused) {
      last = time;
      return;
    }
    const dt = Math.min(0.1, (time - last) / 1000);
    last = time;
    t += dt * parseFloat(ui.speed.value);

    const step = parseInt(ui.res.value, 10);
    const zoom = parseFloat(ui.zoom.value);
    const oct = parseInt(ui.octaves.value, 10);
    const pal = palettes[ui.palette.value] || palettes.thermal;
    const algo = ui.algo.value;

    const t0 = performance.now();
    const px = new Uint8ClampedArray(img.data.length);

    for (let y = 0; y < H; y += step) {
      const ny = (y / H - 0.5) * zoom;
      for (let x = 0; x < W; x += step) {
        const nx = (x / W - 0.5) * zoom;
        let v;
        switch (algo) {
          case 'simplex2d': v = noise.generateSimplex2D(nx, ny); break;
          case 'simplex3d': v = noise.generateSimplex3D(nx, ny, t); break;
          case 'simplex4d': v = noise.generateSimplex4D(nx, ny, t, t * 0.7); break;
          case 'perlin2d': v = noise.generate2D(nx, ny); break;
          case 'perlin3d': v = noise.generate3D(nx, ny, t); break;
          case 'value2d': v = noise.generateValue2D(nx, ny); break;
          case 'value3d': v = noise.generateValue3D(nx, ny, t); break;
          case 'worley2d': v = noise.generateWorley2D01(nx * 2, ny * 2); break;
          case 'worley3d': v = noise.generateWorley3D01(nx * 2, ny * 2, t * 2); break;
          case 'fractal2d': v = noise.generateFractal2D(nx, ny, { octaves: oct }); break;
          case 'fractal3d': v = noise.generateFractal3D(nx, ny, t, { octaves: oct }); break;
          case 'ridged2d': v = noise.generateFractal2D(nx, ny, { octaves: oct, ridged: true }); break;
          case 'turbulence2d': v = noise.generateFractal2D(nx, ny, { octaves: oct, turbulence: true }); break;
          case 'warp2d': v = noise.warp2D(nx, ny, { warpStrength: 1.2, warpScale: 1.5 }); break;
          case 'warp3d': v = noise.warp3D(nx, ny, t, { warpStrength: 1.2, warpScale: 1.5 }); break;
          case 'os2f2d': v = noise.generateOpenSimplex2F_2D(nx, ny); break;
          case 'os2s2d': v = noise.generateOpenSimplex2S_2D(nx, ny); break;
          default: v = 0;
        }
        const [r, g, b] = pal(v);
        for (let dy = 0; dy < step; dy++) {
          for (let dx = 0; dx < step; dx++) {
            const idx = ((y + dy) * W + (x + dx)) * 4;
            if (idx + 3 < px.length) {
              px[idx]     = r;
              px[idx + 1] = g;
              px[idx + 2] = b;
              px[idx + 3] = 255;
            }
          }
        }
      }
    }
    img.data.set(px);
    ctx.putImageData(img, 0, 0);
    const t1 = performance.now();

    hud.frame.textContent = (t1 - t0).toFixed(1);
    hud.pps.textContent = ((W * H) / ((t1 - t0) / 1000) / 1e6).toFixed(2) + 'M';
  }

  let raf = 0;
  let lastFrame = performance.now();
  let fpsAcc = 0, fpsCount = 0;

  function loop(time) {
    render(time);
    const dt = time - lastFrame;
    lastFrame = time;
    fpsAcc += dt;
    fpsCount++;
    if (fpsAcc >= 500) {
      hud.fps.textContent = (1000 / (fpsAcc / fpsCount)).toFixed(1);
      fpsAcc = 0; fpsCount = 0;
    }
    raf = requestAnimationFrame(loop);
  }

  ui.algo.addEventListener('change', () => {});
  ui.seed.addEventListener('change', reseed);
  ui.zoom.addEventListener('input', () => ui.zoomVal.textContent = parseFloat(ui.zoom.value).toFixed(1));
  ui.speed.addEventListener('input', () => ui.speedVal.textContent = parseFloat(ui.speed.value).toFixed(2));
  ui.octaves.addEventListener('input', () => ui.octVal.textContent = ui.octaves.value);
  ui.pause.addEventListener('click', () => {
    paused = !paused;
    ui.pause.textContent = paused ? 'Resume' : 'Pause';
  });

  window.addEventListener('resize', () => { cancelAnimationFrame(raf); resize(); last = performance.now(); loop(performance.now()); });
  resize();
  loop(performance.now());
})();