(function () {
  'use strict';
  if (typeof ForgeNoise === 'undefined') return;

  // ── Config ─────────────────────────────────────────────
  const COLS = 52, ROWS = 36;
  const NOISE_SCALE = 0.082;
  const OCTAVES = 4;
  const PLAYER_RADIUS = 0.30;
  const BASE_MOVE_SPEED = 11.5;
  const DASH_SPEED = 23.0;

  const COLORS = {
    bg:     '#0a0a0c',
    wall:   '#1c1f2e',
    wallHi: '#2a2f45',
    player: '#ff5c33',
    exit:   '#4caf50',
    trail:  'rgba(255, 92, 51, 0.36)',
  };

  // ── DOM ────────────────────────────────────────────────
  const stage     = document.getElementById('cave-stage');
  const canvas    = document.getElementById('cave-canvas');
  const ctx       = canvas.getContext('2d', { alpha: false });
  const seedEl    = document.getElementById('cave-seed');
  const dailyEl   = document.getElementById('cave-daily');
  const timerEl   = document.getElementById('cave-timer');
  const bestEl    = document.getElementById('cave-best');
  const hintEl    = document.getElementById('cave-hint');
  const winEl     = document.getElementById('cave-win');
  const winTimeEl = document.getElementById('cave-win-time');
  const winBestEl = document.getElementById('cave-win-best');
  const shareBtn  = document.getElementById('cave-share');
  const nextBtn   = document.getElementById('cave-next');
  const newBtn    = document.getElementById('cave-new');
  const sonarBtn  = document.getElementById('cave-sonar');
  const shadedEl  = document.getElementById('cave-shaded');
  const toastEl   = document.getElementById('toast');

  // ── State ──────────────────────────────────────────────
  let noise = null;
  let maze = null;
  let seed = 0;
  let isDaily = false;
  let shaded = true;
  let player = { x: 0, y: 0, vx: 0, vy: 0, dashTime: 0, dashCooldown: 0 };
  let trail = [];
  let spores = [];
  let sonarNodes = [];
  let sonarAnim = 0;
  let started = false;
  let startTime = 0;
  let finishTime = 0;
  let won = false;
  let cellPx = 16, W = 0, H = 0, dpr = 1;
  let wallShade = null;
  let flowFieldX = null, flowFieldY = null;
  let raf = 0, lastFrameT = 0;

  const heldKeys = new Set();
  let touchJoy = { active: false, sx: 0, sy: 0, dx: 0, dy: 0 };

  function todaySeed() {
    const d = new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }
  function randomSeed() { return Math.floor(Math.random() * 1_000_000); }
  function idx(x, y) { return y * COLS + x; }

  // ── Cave Generation & True Graph-Diameter Routing ─────
  function generateCave(s) {
    noise = new ForgeNoise(s);
    const grid = new Uint8Array(COLS * ROWS);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = noise.generateFractal2D(x * NOISE_SCALE, y * NOISE_SCALE, { octaves: OCTAVES });
        grid[idx(x, y)] = v > 0.06 ? 1 : 0;
      }
    }

    for (let pass = 0; pass < 3; pass++) {
      const next = grid.slice();
      for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
          let walls = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if (dx || dy) walls += grid[idx(x + dx, y + dy)];
          const i = idx(x, y);
          next[i] = walls >= 5 ? 1 : (walls <= 3 ? 0 : grid[i]);
        }
      }
      grid.set(next);
    }

    for (let x = 0; x < COLS; x++) { grid[x] = 1; grid[idx(x, ROWS - 1)] = 1; }
    for (let y = 0; y < ROWS; y++) { grid[idx(0, y)] = 1; grid[idx(COLS - 1, y)] = 1; }

    // Find largest connected cavern component
    const seen = new Uint8Array(COLS * ROWS);
    let largest = [];
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        const i = idx(x, y);
        if (grid[i] || seen[i]) continue;
        const q = [[x, y]], comp = [];
        seen[i] = 1;
        while (q.length) {
          const [cx, cy] = q.shift();
          comp.push([cx, cy]);
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx <= 0 || ny <= 0 || nx >= COLS - 1 || ny >= ROWS - 1) continue;
            const ni = idx(nx, ny);
            if (!grid[ni] && !seen[ni]) {
              seen[ni] = 1;
              q.push([nx, ny]);
            }
          }
        }
        if (comp.length > largest.length) largest = comp;
      }
    }

    const keep = new Uint8Array(COLS * ROWS);
    for (const [x, y] of largest) keep[idx(x, y)] = 1;
    for (let i = 0; i < grid.length; i++) if (!keep[i]) grid[i] = 1;

    // 2-Pass BFS to place Start and Exit at the true topological diameter of the cave
    function bfsFrom(sx, sy) {
      const dist = new Int32Array(COLS * ROWS).fill(-1);
      const parent = new Int32Array(COLS * ROWS).fill(-1);
      dist[idx(sx, sy)] = 0;
      const q = [[sx, sy]];
      let farX = sx, farY = sy, maxD = 0;
      while (q.length) {
        const [x, y] = q.shift();
        const d = dist[idx(x, y)];
        if (d > maxD) { maxD = d; farX = x; farY = y; }
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const ni = idx(nx, ny);
          if (grid[ni] || dist[ni] >= 0) continue;
          dist[ni] = d + 1;
          parent[ni] = idx(x, y);
          q.push([nx, ny]);
        }
      }
      return { farX, farY, dist, parent };
    }

    const seedCell = largest[0] || [COLS >> 1, ROWS >> 1];
    const pass1 = bfsFrom(seedCell[0], seedCell[1]);
    const startX = pass1.farX, startY = pass1.farY;
    const pass2 = bfsFrom(startX, startY);
    const exitX = pass2.farX, exitY = pass2.farY;
    const exitBFS = bfsFrom(exitX, exitY);

    // Precompute analytical derivative shading & curl air-current field
    wallShade = shaded ? new Float32Array(COLS * ROWS) : null;
    flowFieldX = new Float32Array(COLS * ROWS);
    flowFieldY = new Float32Array(COLS * ROWS);
    const tmp = new Float64Array(3);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = idx(x, y);
        noise.generateSimplexFractal2D_Derivative(x * NOISE_SCALE, y * NOISE_SCALE, tmp, { octaves: OCTAVES });
        if (grid[i] && wallShade) {
          const lightX = -0.6, lightY = -0.8;
          const lit = (tmp[1] * lightX + tmp[2] * lightY) * 0.5 + 0.5;
          wallShade[i] = Math.max(0.22, Math.min(1.45, lit * 1.25 + 0.28));
        } else if (!grid[i]) {
          // 2D curl vector from analytical noise derivatives
          const len = Math.hypot(tmp[1], tmp[2]) || 1;
          flowFieldX[i] =  tmp[2] / len;
          flowFieldY[i] = -tmp[1] / len;
        }
      }
    }

    // Spawn ambient bioluminescent spores that drift along the derivative curl field
    spores = [];
    for (let i = 0; i < 55 && largest.length > 0; i++) {
      const [sx, sy] = largest[(i * 19) % largest.length];
      spores.push({ x: sx + Math.random(), y: sy + Math.random(), size: 1 + (i % 3) * 0.6 });
    }

    return { grid, startX, startY, exitX, exitY, exitDist: exitBFS.dist };
  }

  // ── Sonar Path Wave ────────────────────────────────────
  function triggerSonar() {
    if (!maze || won) return;
    const { grid, exitDist, exitX, exitY } = maze;
    let cx = Math.floor(player.x), cy = Math.floor(player.y);
    sonarNodes = [[cx + 0.5, cy + 0.5]];

    for (let step = 0; step < 36; step++) {
      if (cx === exitX && cy === exitY) break;
      let bestX = cx, bestY = cy, bestD = exitDist[idx(cx, cy)];
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx <= 0 || ny <= 0 || nx >= COLS - 1 || ny >= ROWS - 1) continue;
        const ni = idx(nx, ny);
        if (!grid[ni] && exitDist[ni] >= 0 && exitDist[ni] < bestD) {
          bestD = exitDist[ni];
          bestX = nx;
          bestY = ny;
        }
      }
      if (bestX === cx && bestY === cy) break;
      cx = bestX; cy = bestY;
      sonarNodes.push([cx + 0.5, cy + 0.5]);
    }
    sonarAnim = 1.0;
  }

  // ── Smooth Sub-Tile Physics & Corner Sliding ──────────
  function isWall(x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
    return maze.grid[idx(x, y)] === 1;
  }

  function resolvePlayerCollisions() {
    const r = PLAYER_RADIUS;
    const minX = Math.floor(player.x - r - 0.5);
    const maxX = Math.floor(player.x + r + 0.5);
    const minY = Math.floor(player.y - r - 0.5);
    const maxY = Math.floor(player.y + r + 0.5);

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (!isWall(tx, ty)) continue;
        const cx = Math.max(tx, Math.min(player.x, tx + 1));
        const cy = Math.max(ty, Math.min(player.y, ty + 1));
        const ox = player.x - cx;
        const oy = player.y - cy;
        const dSq = ox * ox + oy * oy;
        if (dSq < r * r) {
          const d = Math.sqrt(dSq) || 0.001;
          player.x += (ox / d) * (r - d);
          player.y += (oy / d) * (r - d);
        }
      }
    }
  }

  function update(dt) {
    if (!maze || won) return;

    if (player.dashCooldown > 0) player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    if (player.dashTime > 0) player.dashTime = Math.max(0, player.dashTime - dt);
    if (sonarAnim > 0) sonarAnim = Math.max(0, sonarAnim - dt * 0.75);

    let ix = 0, iy = 0;
    if (heldKeys.has('ArrowLeft')  || heldKeys.has('a') || heldKeys.has('A')) ix -= 1;
    if (heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D')) ix += 1;
    if (heldKeys.has('ArrowUp')    || heldKeys.has('w') || heldKeys.has('W')) iy -= 1;
    if (heldKeys.has('ArrowDown')  || heldKeys.has('s') || heldKeys.has('S')) iy += 1;

    if (touchJoy.active) {
      ix += touchJoy.dx;
      iy += touchJoy.dy;
    }

    const mag = Math.hypot(ix, iy);
    if (mag > 0.01) {
      ix /= mag;
      iy /= mag;
      if (!started) {
        started = true;
        startTime = performance.now();
        hintEl.classList.add('fade');
      }
      if (heldKeys.has('Shift') && player.dashCooldown <= 0) {
        player.dashTime = 0.16;
        player.dashCooldown = 0.85;
      }
    }

    const speed = player.dashTime > 0 ? DASH_SPEED : BASE_MOVE_SPEED;
    player.vx += (ix * speed - player.vx) * Math.min(1, dt * 18);
    player.vy += (iy * speed - player.vy) * Math.min(1, dt * 18);

    player.x += player.vx * dt;
    resolvePlayerCollisions();
    player.y += player.vy * dt;
    resolvePlayerCollisions();

    const lastPt = trail[trail.length - 1];
    if (!lastPt || Math.hypot(player.x - lastPt[0], player.y - lastPt[1]) > 0.25) {
      trail.push([player.x, player.y]);
    }

    // Drift spores along analytical ForgeNoise curl field
    for (const sp of spores) {
      const ci = idx(Math.floor(sp.x), Math.floor(sp.y));
      const fx = flowFieldX[ci] || 0.3;
      const fy = flowFieldY[ci] || 0.3;
      sp.x += fx * dt * 1.4;
      sp.y += fy * dt * 1.4;
      if (isWall(Math.floor(sp.x), Math.floor(sp.y))) {
        sp.x = Math.floor(player.x) + 0.5;
        sp.y = Math.floor(player.y) + 0.5;
      }
    }

    if (Math.hypot(player.x - (maze.exitX + 0.5), player.y - (maze.exitY + 0.5)) < 0.65) {
      win();
    }
  }

  // ── Resize & Render ────────────────────────────────────
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = stage.getBoundingClientRect();
    W = Math.max(1, Math.floor(rect.width * dpr));
    H = Math.max(1, Math.floor(rect.height * dpr));
    canvas.width = W;
    canvas.height = H;
    cellPx = Math.min(W / COLS, H / ROWS);
    canvas._offX = (W - cellPx * COLS) / 2;
    canvas._offY = (H - cellPx * ROWS) / 2;
  }

  function drawFrame(now) {
    const dt = lastFrameT ? Math.min(0.05, (now - lastFrameT) / 1000) : 0;
    lastFrameT = now;

    update(dt);

    if (!maze) { raf = requestAnimationFrame(drawFrame); return; }

    const { grid, exitX, exitY } = maze;
    const offX = canvas._offX, offY = canvas._offY;

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    // Walls
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = idx(x, y);
        if (!grid[i]) continue;
        const px = offX + x * cellPx, py = offY + y * cellPx;
        if (wallShade) {
          const sh = wallShade[i];
          const r = Math.round(28 * sh), g = Math.round(31 * sh), b = Math.round(46 * sh);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          ctx.fillStyle = COLORS.wall;
        }
        ctx.fillRect(px, py, cellPx + 0.6, cellPx + 0.6);
        if (cellPx > 8 && y > 0 && !grid[idx(x, y - 1)]) {
          ctx.fillStyle = wallShade ? 'rgba(255,255,255,0.09)' : COLORS.wallHi;
          ctx.fillRect(px, py, cellPx + 0.6, 1.5);
        }
      }
    }

    // Ambient derivative-driven spores
    ctx.fillStyle = 'rgba(79, 195, 247, 0.28)';
    for (const sp of spores) {
      ctx.beginPath();
      ctx.arc(offX + sp.x * cellPx, offY + sp.y * cellPx, sp.size * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sonar wave guide
    if (sonarAnim > 0 && sonarNodes.length > 1) {
      ctx.save();
      ctx.strokeStyle = `rgba(79, 195, 247, ${sonarAnim * 0.75})`;
      ctx.lineWidth = Math.max(2, cellPx * 0.24);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const limit = Math.min(sonarNodes.length, Math.ceil((1.15 - sonarAnim) * sonarNodes.length * 2.2));
      for (let i = 0; i < limit; i++) {
        const [sx, sy] = sonarNodes[i];
        const px = offX + sx * cellPx, py = offY + sy * cellPx;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Player trail
    if (trail.length > 1) {
      ctx.strokeStyle = COLORS.trail;
      ctx.lineWidth = Math.max(2, cellPx * 0.22);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < trail.length; i++) {
        const [tx, ty] = trail[i];
        const px = offX + tx * cellPx, py = offY + ty * cellPx;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Exit beacon
    const ex = offX + (exitX + 0.5) * cellPx;
    const ey = offY + (exitY + 0.5) * cellPx;
    const pulse = 0.75 + 0.25 * Math.sin(now * 0.005);
    const rg = ctx.createRadialGradient(ex, ey, 0, ex, ey, cellPx * 1.8 * pulse);
    rg.addColorStop(0, 'rgba(76, 175, 80, 0.95)');
    rg.addColorStop(0.5, 'rgba(76, 175, 80, 0.35)');
    rg.addColorStop(1, 'rgba(76, 175, 80, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(ex - cellPx * 2, ey - cellPx * 2, cellPx * 4, cellPx * 4);
    ctx.fillStyle = COLORS.exit;
    ctx.beginPath();
    ctx.arc(ex, ey, cellPx * 0.42, 0, Math.PI * 2);
    ctx.fill();

    // Player
    const px = offX + player.x * cellPx;
    const py = offY + player.y * cellPx;
    const glow = ctx.createRadialGradient(px, py, 0, px, py, cellPx * 1.5);
    glow.addColorStop(0, player.dashTime > 0 ? 'rgba(255, 213, 79, 0.85)' : 'rgba(255, 92, 51, 0.65)');
    glow.addColorStop(1, 'rgba(255, 92, 51, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(px - cellPx * 2, py - cellPx * 2, cellPx * 4, cellPx * 4);
    ctx.fillStyle = player.dashTime > 0 ? '#ffd54f' : COLORS.player;
    ctx.beginPath();
    ctx.arc(px, py, cellPx * PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    if (started && !won) {
      timerEl.textContent = ((now - startTime) / 1000).toFixed(1) + 's';
    }

    raf = requestAnimationFrame(drawFrame);
  }

  function win() {
    won = true;
    finishTime = (performance.now() - startTime) / 1000;
    timerEl.textContent = finishTime.toFixed(1) + 's';
    const best = getBest(seed);
    let bestText = '';
    if (best === null || finishTime < best) {
      setBest(seed, finishTime);
      bestText = best !== null ? `🎉 New best! (was ${best.toFixed(1)}s)` : '🎉 First solve!';
    } else {
      bestText = `Best: ${best.toFixed(1)}s`;
    }
    winTimeEl.textContent = finishTime.toFixed(1);
    winBestEl.textContent = bestText;
    bestEl.textContent = getBest(seed).toFixed(1) + 's';
    winEl.classList.add('show');
  }

  function getBest(s) {
    const v = localStorage.getItem('fn-cave-best-' + s);
    return v ? parseFloat(v) : null;
  }
  function setBest(s, t) { localStorage.setItem('fn-cave-best-' + s, String(t)); }

  function load(newSeed, daily) {
    seed = newSeed;
    isDaily = daily;
    maze = generateCave(seed);
    player = { x: maze.startX + 0.5, y: maze.startY + 0.5, vx: 0, vy: 0, dashTime: 0, dashCooldown: 0 };
    trail = [[player.x, player.y]];
    sonarNodes = [];
    sonarAnim = 0;
    started = false;
    won = false;
    startTime = 0;
    finishTime = 0;
    timerEl.textContent = '0.0s';
    seedEl.textContent = '#' + seed;
    dailyEl.style.display = daily ? '' : 'none';
    winEl.classList.remove('show');
    hintEl.classList.remove('fade');
    const best = getBest(seed);
    bestEl.textContent = best ? best.toFixed(1) + 's' : '-';
    heldKeys.clear();
    lastFrameT = 0;
    updateUrl();
  }

  function updateUrl() {
    try {
      const url = new URL(location.href);
      if (isDaily) url.searchParams.delete('seed');
      else url.searchParams.set('seed', String(seed));
      history.replaceState(null, '', url);
    } catch {}
  }

  // ── Input ──────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === ' ') { e.preventDefault(); newBtn.click(); return; }
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); triggerSonar(); return; }
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D','Shift'].includes(e.key)) {
      e.preventDefault();
      heldKeys.add(e.key);
    }
  });
  document.addEventListener('keyup', e => heldKeys.delete(e.key));
  window.addEventListener('blur', () => heldKeys.clear());

  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0];
    touchJoy.active = true;
    touchJoy.sx = t.clientX;
    touchJoy.sy = t.clientY;
    touchJoy.dx = 0;
    touchJoy.dy = 0;
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (!touchJoy.active) return;
    const t = e.touches[0];
    const dx = t.clientX - touchJoy.sx;
    const dy = t.clientY - touchJoy.sy;
    const d = Math.hypot(dx, dy);
    if (d > 8) { touchJoy.dx = dx / d; touchJoy.dy = dy / d; }
    else { touchJoy.dx = 0; touchJoy.dy = 0; }
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    touchJoy.active = false;
    touchJoy.dx = 0;
    touchJoy.dy = 0;
  }, { passive: true });

  newBtn.addEventListener('click', () => load(randomSeed(), false));
  nextBtn.addEventListener('click', () => load(randomSeed(), false));
  sonarBtn.addEventListener('click', triggerSonar);

  shareBtn.addEventListener('click', async () => {
    const text = `I found the exit in ${finishTime.toFixed(1)}s - Cave #${seed}\nhttps://cmdaeo.github.io/ForgeNoise/games/maze.html?seed=${seed}`;
    try {
      if (navigator.share) await navigator.share({ title: 'ForgeNoise Cave', text });
      else { await navigator.clipboard.writeText(text); showToast('Copied!'); }
    } catch { showToast('Share failed'); }
  });

  shadedEl.addEventListener('change', () => {
    shaded = shadedEl.checked;
    maze = generateCave(seed);
  });

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  window.addEventListener('resize', resize);
  resize();

  const params = new URLSearchParams(location.search);
  const paramSeed = parseInt(params.get('seed'), 10);
  if (!isNaN(paramSeed)) load(paramSeed, false);
  else load(todaySeed(), true);

  raf = requestAnimationFrame(drawFrame);
})();