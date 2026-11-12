(function () {
  'use strict';
  if (typeof ForgeNoise === 'undefined') return;

  // ── Configuration ─────────────────────────────────────
  const COLS = 40, ROWS = 28;
  const PLAYER_RADIUS = 0.30;
  const GUARD_RADIUS  = 0.32;

  const PLAYER_WALK_SPEED   = 4.6;
  const PLAYER_SPRINT_SPEED = 7.2;

  const GUARD_PATROL_SPEED  = 2.15;
  const GUARD_CURIOUS_SPEED = 2.65;
  const GUARD_SEARCH_SPEED  = 3.15;
  const GUARD_CHASE_SPEED   = 4.35;

  const GUARD_VISION_RANGE  = 8.2;
  const GUARD_VISION_CONE   = (68 * Math.PI) / 180;
  const GUARD_PERIPH_RANGE  = 1.85;
  const GEM_COUNT_TARGET    = 3;

  // ── DOM ───────────────────────────────────────────────
  const stage    = document.getElementById('heist-stage');
  const canvas   = document.getElementById('heist-canvas');
  const ctx      = canvas.getContext('2d', { alpha: false });
  const seedEl   = document.getElementById('heist-seed');
  const gemEl    = document.getElementById('heist-gem');
  const fillEl   = document.getElementById('heist-detect-fill');
  const stateEl  = document.getElementById('heist-state');
  const msgEl    = document.getElementById('heist-msg');
  const overEl   = document.getElementById('heist-over');
  const emojiEl  = document.getElementById('heist-emoji');
  const titleEl  = document.getElementById('heist-title');
  const subEl    = document.getElementById('heist-sub');
  const retryBtn = document.getElementById('heist-retry');
  const nextBtn  = document.getElementById('heist-next');
  const newBtn   = document.getElementById('heist-new');
  const decoyBtn = document.getElementById('heist-decoy');
  const fieldBtn = document.getElementById('heist-field');

  // ── Runtime State ─────────────────────────────────────
  let noise = null;
  let seed = 0;
  let grid = null;           // 1 = wall, 0 = floor
  let wallClearance = null;  // float distance to nearest wall
  let visitMemory = null;    // Float32Array tracking recent guard presence
  let player = null;
  let gems = [];
  let exit = null;
  let guards = [];
  let soundWaves = [];
  let showNoiseField = false;

  const heldKeys = new Set();
  const derivTmp = new Float64Array(3);
  let touchJoy = { active: false, sx: 0, sy: 0, dx: 0, dy: 0 };

  let detection = 0;
  let won = false, lost = false;
  let startTime = 0, simTime = 0, lastFrameT = 0;
  let decoyCooldown = 0;
  let stepSoundTimer = 0;
  let cellPx = 16, W = 0, H = 0, dpr = 1, offX = 0, offY = 0;

  function idx(x, y) { return y * COLS + x; }
  function inBounds(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS; }
  function isWall(x, y) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
    return grid[y * COLS + x] === 1;
  }

  function wrapAngle(a) {
    while (a >  Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function lerpAngle(a, b, t) {
    return a + wrapAngle(b - a) * Math.min(1, t);
  }

  // ── Tactical Vault Generation via ForgeNoise ──────────
  function generateLevel(s) {
    seed = s;
    noise = new ForgeNoise(s);
    grid = new Uint8Array(COLS * ROWS);
    visitMemory = new Float32Array(COLS * ROWS);

    // 1. Sample multi-scale ForgeNoise to create chambers and cover pillars
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const f = noise.generateFractal2D(x * 0.085, y * 0.085, { octaves: 3 });
        const s2 = noise.generateSimplex2D(x * 0.22 + 40, y * 0.22 + 40);
        grid[idx(x, y)] = (f * 0.75 + s2 * 0.25) > 0.20 ? 1 : 0;
      }
    }

    // Outer perimeter walls
    for (let x = 0; x < COLS; x++) { grid[idx(x, 0)] = 1; grid[idx(x, ROWS - 1)] = 1; }
    for (let y = 0; y < ROWS; y++) { grid[idx(0, y)] = 1; grid[idx(COLS - 1, y)] = 1; }

    // 2. Clean up isolated single-tile spikes and open 1-tile dead-ends so cover blocks are loopable
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 2; y < ROWS - 2; y++) {
        for (let x = 2; x < COLS - 2; x++) {
          const i = idx(x, y);
          const n = grid[idx(x, y - 1)] + grid[idx(x, y + 1)] + grid[idx(x - 1, y)] + grid[idx(x + 1, y)];
          if (grid[i] === 0 && n >= 3) grid[i] = 1; // fill tiny 1-tile alcoves that trap players
        }
      }
    }

    // 3. Extract largest connected floor region
    let bestRegion = [];
    const seen = new Uint8Array(COLS * ROWS);
    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        const startIdx = idx(x, y);
        if (grid[startIdx] || seen[startIdx]) continue;
        const q = [[x, y]];
        const reg = [];
        seen[startIdx] = 1;
        while (q.length) {
          const [cx, cy] = q.shift();
          reg.push([cx, cy]);
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
        if (reg.length > bestRegion.length) bestRegion = reg;
      }
    }

    // Fill disconnected pockets
    const mainSet = new Uint8Array(COLS * ROWS);
    for (const [x, y] of bestRegion) mainSet[idx(x, y)] = 1;
    for (let i = 0; i < grid.length; i++) if (!mainSet[i]) grid[i] = 1;

    // 4. Break huge monolithic wall blobs into loopable tactical cover islands
    for (let y = 3; y < ROWS - 3; y += 4) {
      for (let x = 3; x < COLS - 3; x += 4) {
        if (grid[idx(x, y)] && grid[idx(x + 1, y)] && grid[idx(x, y + 1)] && grid[idx(x + 1, y + 1)]) {
          const n = noise.generateSimplex2D(x * 0.3, y * 0.3);
          if (n > -0.2) {
            grid[idx(x, y)] = 0;
            grid[idx(x + 1, y)] = 0;
          }
        }
      }
    }

    // Re-compute reachable floor list & wall clearance field
    wallClearance = new Float32Array(COLS * ROWS);
    const wq = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = idx(x, y);
        if (grid[i] === 1) {
          wallClearance[i] = 0;
          wq.push([x, y]);
        } else {
          wallClearance[i] = 999;
        }
      }
    }
    let head = 0;
    while (head < wq.length) {
      const [cx, cy] = wq[head++];
      const baseD = wallClearance[idx(cx, cy)];
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (wallClearance[ni] > baseD + 1) {
          wallClearance[ni] = baseD + 1;
          wq.push([nx, ny]);
        }
      }
    }

    // 5. Find topological extremes for Player Spawn, Gems, and Exit
    const startCandidate = bestRegion[0];
    const d0 = computeBFS(startCandidate[0], startCandidate[1]);
    let spawnCell = startCandidate, maxD0 = -1;
    for (const [x, y] of bestRegion) {
      const d = d0[idx(x, y)];
      if (d > maxD0) { maxD0 = d; spawnCell = [x, y]; }
    }

    const distFromSpawn = computeBFS(spawnCell[0], spawnCell[1]);
    let exitCell = spawnCell, maxExitD = -1;
    for (const [x, y] of bestRegion) {
      const d = distFromSpawn[idx(x, y)];
      if (d > maxExitD) { maxExitD = d; exitCell = [x, y]; }
    }

    // Pick 3 well-spaced Gems across the vault
    gems = [];
    const sortedFloor = bestRegion
      .filter(([x, y]) => distFromSpawn[idx(x, y)] > 8)
      .sort((a, b) => {
        const na = noise.generateSimplex2D(a[0] * 0.25, a[1] * 0.25);
        const nb = noise.generateSimplex2D(b[0] * 0.25, b[1] * 0.25);
        return nb - na;
      });

    for (const [gx, gy] of sortedFloor) {
      if (gems.length >= GEM_COUNT_TARGET) break;
      const farFromSpawn = Math.hypot(gx - spawnCell[0], gy - spawnCell[1]) > 7;
      const farFromExit  = Math.hypot(gx - exitCell[0], gy - exitCell[1]) > 5;
      const farFromGems  = gems.every(g => Math.hypot(gx - g.x, gy - g.y) > 9);
      if (farFromSpawn && farFromExit && farFromGems) {
        gems.push({ x: gx + 0.5, y: gy + 0.5, collected: false });
      }
    }
    while (gems.length < GEM_COUNT_TARGET && sortedFloor.length > gems.length) {
      const [gx, gy] = sortedFloor[gems.length * Math.floor(sortedFloor.length / 4)];
      gems.push({ x: gx + 0.5, y: gy + 0.5, collected: false });
    }

    // 6. Spawn 4 Guards in strategic mid/far zones
    const guardCandidates = bestRegion.filter(([x, y]) => {
      const ds = distFromSpawn[idx(x, y)];
      return ds > 10 && Math.hypot(x - spawnCell[0], y - spawnCell[1]) > 9;
    });

    const guardCount = 4;
    guards = [];
    for (let i = 0; i < guardCount && guardCandidates.length > 0; i++) {
      // Pick well-separated guard positions
      let bestP = guardCandidates[0], bestScore = -1;
      for (let k = 0; k < guardCandidates.length; k += 3) {
        const [cx, cy] = guardCandidates[k];
        let minDist = 999;
        for (const g of guards) minDist = Math.min(minDist, Math.hypot(cx + 0.5 - g.x, cy + 0.5 - g.y));
        const gemDist = gems[i % gems.length] ? Math.hypot(cx + 0.5 - gems[i % gems.length].x, cy + 0.5 - gems[i % gems.length].y) : 0;
        const score = minDist - gemDist * 0.35;
        if (score > bestScore) { bestScore = score; bestP = [cx, cy]; }
      }
      const [gx, gy] = bestP;
      const initTarget = [gx, gy];
      guards.push({
        id: i,
        x: gx + 0.5,
        y: gy + 0.5,
        vx: 0,
        vy: 0,
        facing: noise.generateSimplex1D(i * 17.3) * Math.PI,
        lookAngle: 0,
        state: 'patrol',        // 'patrol' | 'curious' | 'chase' | 'search'
        alertness: 0,           // 0..1
        seesPlayer: false,
        targetCell: initTarget,
        bfsDist: computeBFS(initTarget[0], initTarget[1]),
        repathTimer: 0,
        stuckTimer: 0,
        lastPos: { x: gx + 0.5, y: gy + 0.5 },
        lkp: { x: 0, y: 0, vx: 0, vy: 0, active: false, checkedPred: false },
        searchTimer: 0,
        searchStep: 0,
        visionPoly: [],
      });
    }

    player = {
      x: spawnCell[0] + 0.5,
      y: spawnCell[1] + 0.5,
      vx: 0,
      vy: 0,
      facing: 0,
      sprinting: false,
      gemsCollected: 0,
    };

    exit = { x: exitCell[0] + 0.5, y: exitCell[1] + 0.5, unlocked: false };
    soundWaves = [];
    heldKeys.clear();
    detection = 0;
    won = false;
    lost = false;
    startTime = 0;
    simTime = 0;
    lastFrameT = 0;
    decoyCooldown = 0;

    updateHUD();
    overEl.classList.remove('show');
    msgEl.textContent = '💎 Steal all 3 gems & reach the exit · [Shift] Sprint · [E] Decoy sound';
    msgEl.classList.remove('fade');
    seedEl.textContent = '#' + s;
    updateUrl();
  }

  function updateUrl() {
    try {
      const url = new URL(location.href);
      url.searchParams.set('seed', String(seed));
      history.replaceState(null, '', url);
    } catch {}
  }

  // ── Fast Topological BFS Distance Field ───────────────
  // Gives guards instant wall-hugging navigation toward their noise-chosen focus or LKP
  function computeBFS(tx, ty) {
    const dist = new Int16Array(COLS * ROWS).fill(-1);
    const cx = Math.max(1, Math.min(COLS - 2, Math.floor(tx)));
    const cy = Math.max(1, Math.min(ROWS - 2, Math.floor(ty)));
    if (grid[idx(cx, cy)]) return dist;

    const qx = new Int16Array(COLS * ROWS);
    const qy = new Int16Array(COLS * ROWS);
    let head = 0, tail = 0;

    dist[idx(cx, cy)] = 0;
    qx[tail] = cx; qy[tail] = cy; tail++;

    while (head < tail) {
      const x = qx[head], y = qy[head];
      head++;
      const d = dist[idx(x, y)] + 1;

      if (!grid[idx(x + 1, y)] && dist[idx(x + 1, y)] === -1) { dist[idx(x + 1, y)] = d; qx[tail] = x + 1; qy[tail] = y; tail++; }
      if (!grid[idx(x - 1, y)] && dist[idx(x - 1, y)] === -1) { dist[idx(x - 1, y)] = d; qx[tail] = x - 1; qy[tail] = y; tail++; }
      if (!grid[idx(x, y + 1)] && dist[idx(x, y + 1)] === -1) { dist[idx(x, y + 1)] = d; qx[tail] = x; qy[tail] = y + 1; tail++; }
      if (!grid[idx(x, y - 1)] && dist[idx(x, y - 1)] === -1) { dist[idx(x, y - 1)] = d; qx[tail] = x; qy[tail] = y - 1; tail++; }
    }
    return dist;
  }

  // ── Continuous Circle vs Tile Grid Sliding Collision ──
  function moveEntityWithWallSlide(ent, dx, dy, radius) {
    // Resolve X, then Y, then push out of corner overlaps
    ent.x += dx;
    resolveTileCollisions(ent, radius);
    ent.y += dy;
    resolveTileCollisions(ent, radius);
  }

  function resolveTileCollisions(ent, radius) {
    const minX = Math.floor(ent.x - radius - 0.5);
    const maxX = Math.floor(ent.x + radius + 0.5);
    const minY = Math.floor(ent.y - radius - 0.5);
    const maxY = Math.floor(ent.y + radius + 0.5);

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (!isWall(tx, ty)) continue;
        const closestX = Math.max(tx, Math.min(ent.x, tx + 1));
        const closestY = Math.max(ty, Math.min(ent.y, ty + 1));
        const ox = ent.x - closestX;
        const oy = ent.y - closestY;
        const dSq = ox * ox + oy * oy;
        if (dSq < radius * radius) {
          const d = Math.sqrt(dSq);
          if (d > 0.0001) {
            const overlap = radius - d;
            ent.x += (ox / d) * overlap;
            ent.y += (oy / d) * overlap;
          } else {
            ent.x += radius * 0.5;
          }
        }
      }
    }
  }

  // ── Raycasting & Line-of-Sight ────────────────────────
  function castRay(ox, oy, angle, maxDist) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const step = 0.14;
    let d = 0;
    while (d < maxDist) {
      d += step;
      const rx = ox + dx * d;
      const ry = oy + dy * d;
      if (isWall(Math.floor(rx), Math.floor(ry))) {
        // Binary refine wall hit for crisp shadow edges
        let lo = d - step, hi = d;
        for (let i = 0; i < 4; i++) {
          const mid = (lo + hi) * 0.5;
          if (isWall(Math.floor(ox + dx * mid), Math.floor(oy + dy * mid))) hi = mid;
          else lo = mid;
        }
        return { x: ox + dx * lo, y: oy + dy * lo, dist: lo, hit: true };
      }
    }
    return { x: ox + dx * maxDist, y: oy + dy * maxDist, dist: maxDist, hit: false };
  }

  function hasLineOfSight(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist * 6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isWall(Math.floor(x1 + dx * t), Math.floor(y1 + dy * t))) return false;
    }
    return true;
  }

  function computeGuardVision(g) {
    const rays = 48;
    const half = GUARD_VISION_CONE * 0.5;
    const poly = [[g.x, g.y]];
    for (let i = 0; i <= rays; i++) {
      const a = g.facing - half + (i / rays) * GUARD_VISION_CONE;
      const hit = castRay(g.x, g.y, a, GUARD_VISION_RANGE);
      poly.push([hit.x, hit.y]);
    }
    g.visionPoly = poly;

    // Check if player is inside vision cone OR close peripheral awareness
    const dx = player.x - g.x;
    const dy = player.y - g.y;
    const dist = Math.hypot(dx, dy);
    if (dist > GUARD_VISION_RANGE) return false;

    const angleToPlayer = Math.atan2(dy, dx);
    const angleDiff = Math.abs(wrapAngle(angleToPlayer - g.facing));

    const inMainCone = angleDiff <= half + 0.08;
    const inPeripheral = dist <= GUARD_PERIPH_RANGE && angleDiff <= Math.PI * 0.68;

    if (!inMainCone && !inPeripheral) return false;
    return hasLineOfSight(g.x, g.y, player.x, player.y);
  }

  // ── Acoustic Ripples (Footsteps & Decoy Claps) ────────
  function emitSound(x, y, radius, color, alertsGuards) {
    soundWaves.push({ x, y, r: 0.2, maxR: radius, alpha: 1, color });
    if (!alertsGuards) return;

    const soundBFS = computeBFS(x, y);
    for (const g of guards) {
      const pathDist = soundBFS[idx(Math.floor(g.x), Math.floor(g.y))];
      if (pathDist >= 0 && pathDist <= radius * 1.35) {
        // Guard hears the sound through corridors!
        g.lkp.x = x;
        g.lkp.y = y;
        g.lkp.vx = 0;
        g.lkp.vy = 0;
        g.lkp.active = true;
        g.lkp.checkedPred = true;
        g.alertness = Math.max(g.alertness, 0.58);
        if (g.state !== 'chase') {
          g.state = 'search';
          g.searchTimer = 6.0;
          g.searchStep = 0;
          setGuardTargetCell(g, Math.floor(x), Math.floor(y));
        }
      }
    }
  }

  // ── Noise-Driven Guard Behavior Engine ────────────────
  function sampleCuriosityField(x, y, guardId, t) {
    // Coherent multi-octave Simplex curiosity field unique to each guard phase
    const n1 = noise.generateSimplex2D(x * 0.11 + t * 0.07, y * 0.11 + guardId * 23.7);
    const n2 = noise.generateFractal2D(x * 0.06 - t * 0.04, y * 0.06 + guardId * 41.3, { octaves: 2 });
    return n1 * 0.65 + n2 * 0.35;
  }

  function setGuardTargetCell(g, tx, ty) {
    const cx = Math.max(1, Math.min(COLS - 2, Math.floor(tx)));
    const cy = Math.max(1, Math.min(ROWS - 2, Math.floor(ty)));
    if (grid[idx(cx, cy)]) return false;
    if (g.targetCell[0] === cx && g.targetCell[1] === cy) return true;
    g.targetCell = [cx, cy];
    g.bfsDist = computeBFS(cx, cy);
    return true;
  }

  function pickNoisePatrolTarget(g, t) {
    // Evaluate the live ForgeNoise curiosity field across walkable corridors,
    // subtracting visitMemory so guards naturally sweep unvisited rooms.
    let bestScore = -999, bestCell = null;
    for (let k = 0; k < 42; k++) {
      // Deterministic sample coordinates derived from noise itself
      const rx = 1 + Math.floor(((noise.generateSimplex1D(t * 0.3 + k * 7.1 + g.id * 50) + 1) * 0.5) * (COLS - 2));
      const ry = 1 + Math.floor(((noise.generateSimplex1D(t * 0.3 + k * 13.7 + g.id * 90 + 200) + 1) * 0.5) * (ROWS - 2));
      const i = idx(rx, ry);
      if (grid[i]) continue;

      const dFromGuard = Math.hypot(rx + 0.5 - g.x, ry + 0.5 - g.y);
      if (dFromGuard < 5 || dFromGuard > 22) continue;

      // Avoid bunching with other patrolling guards
      let crowding = 0;
      for (const other of guards) {
        if (other.id === g.id) continue;
        const dOther = Math.hypot(rx - other.targetCell[0], ry - other.targetCell[1]);
        if (dOther < 8) crowding += (8 - dOther) * 0.18;
      }

      const curiosity = sampleCuriosityField(rx, ry, g.id, t);
      const clearanceBonus = Math.min(2, wallClearance[i]) * 0.15;
      const score = curiosity + clearanceBonus - visitMemory[i] * 0.85 - crowding;
      if (score > bestScore) {
        bestScore = score;
        bestCell = [rx, ry];
      }
    }
    if (bestCell) setGuardTargetCell(g, bestCell[0], bestCell[1]);
  }

  function pickNoiseSearchSpotNearLKP(g, t) {
    // Sample turbulent ForgeNoise offsets around the Last Known Position to inspect behind cover blocks
    g.searchStep++;
    const baseR = 2.0 + (g.searchStep % 3) * 1.6;
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = noise.generateSimplex2D(t * 0.9 + attempt * 3.1, g.id * 19 + g.searchStep * 5.3) * Math.PI * 2;
      const r = baseR * (0.6 + 0.6 * Math.abs(noise.generateSimplex1D(t + attempt * 7.7 + g.id)));
      const tx = Math.floor(g.lkp.x + Math.cos(angle) * r);
      const ty = Math.floor(g.lkp.y + Math.sin(angle) * r);
      if (inBounds(tx, ty) && !grid[idx(tx, ty)]) {
        setGuardTargetCell(g, tx, ty);
        return;
      }
    }
  }

  function updateGuards(t, dt) {
    if (won || lost) return;

    // Decay global visit memory slowly
    for (let i = 0; i < visitMemory.length; i++) {
      visitMemory[i] = Math.max(0, visitMemory[i] - dt * 0.08);
    }

    let maxDetectIncrement = 0;

    for (const g of guards) {
      // Mark current cell as visited in memory
      const gxCell = Math.floor(g.x), gyCell = Math.floor(g.y);
      if (inBounds(gxCell, gyCell)) {
        visitMemory[idx(gxCell, gyCell)] = Math.min(2.0, visitMemory[idx(gxCell, gyCell)] + dt * 0.9);
      }

      g.seesPlayer = computeGuardVision(g);
      const distToPlayer = Math.hypot(player.x - g.x, player.y - g.y);

      // ── 1. Sensory Detection & State Transitions ──
      if (g.seesPlayer) {
        // Visibility strength scales with closeness and cone center alignment
        const proximityFactor = Math.max(0.45, 1.35 - distToPlayer / GUARD_VISION_RANGE);
        const sprintPenalty = player.sprinting ? 1.45 : 1.0;
        const alertGain = 0.85 * proximityFactor * sprintPenalty * dt;
        g.alertness = Math.min(1, g.alertness + alertGain * 1.4);
        maxDetectIncrement = Math.max(maxDetectIncrement, alertGain);

        // Lock Last Known Position onto player + record velocity vector for corner prediction
        g.lkp.x = player.x;
        g.lkp.y = player.y;
        g.lkp.vx = player.vx;
        g.lkp.vy = player.vy;
        g.lkp.active = true;
        g.lkp.checkedPred = false;

        if (g.alertness >= 0.42 || distToPlayer < 3.2) {
          g.state = 'chase';
          g.searchTimer = 7.5;
          setGuardTargetCell(g, player.x, player.y);

          // Alert nearby guards within earshot when entering full chase
          for (const ally of guards) {
            if (ally.id !== g.id && Math.hypot(ally.x - g.x, ally.y - g.y) < 10) {
              ally.lkp.x = player.x;
              ally.lkp.y = player.y;
              ally.lkp.vx = player.vx;
              ally.lkp.vy = player.vy;
              ally.lkp.active = true;
              ally.alertness = Math.max(ally.alertness, 0.55);
              if (ally.state === 'patrol') {
                ally.state = 'search';
                ally.searchTimer = 6.0;
                setGuardTargetCell(ally, player.x, player.y);
              }
            }
          }
        } else {
          g.state = 'curious';
          g.searchTimer = 4.5;
          setGuardTargetCell(g, player.x, player.y);
        }
      } else {
        // Player is out of sight!
        if (g.state === 'chase' || g.state === 'curious') {
          // Transition immediately to active LKP Investigation rather than forgetting
          g.state = 'search';
          setGuardTargetCell(g, g.lkp.x, g.lkp.y);
        }

        if (g.state === 'search') {
          g.searchTimer -= dt;
          const distToTarget = Math.hypot(g.targetCell[0] + 0.5 - g.x, g.targetCell[1] + 0.5 - g.y);

          if (distToTarget < 0.85) {
            // Reached the LKP! First check predicted trajectory if player was moving around a corner
            if (!g.lkp.checkedPred && Math.hypot(g.lkp.vx, g.lkp.vy) > 0.5) {
              g.lkp.checkedPred = true;
              const predX = g.lkp.x + g.lkp.vx * 0.65;
              const predY = g.lkp.y + g.lkp.vy * 0.65;
              if (!isWall(Math.floor(predX), Math.floor(predY))) {
                setGuardTargetCell(g, predX, predY);
              } else {
                pickNoiseSearchSpotNearLKP(g, t);
              }
            } else {
              // Sample ForgeNoise around LKP to check behind nearby blocks
              pickNoiseSearchSpotNearLKP(g, t);
            }
          }

          if (g.searchTimer <= 0) {
            g.state = 'patrol';
            g.lkp.active = false;
            g.alertness = 0;
            pickNoisePatrolTarget(g, t);
          } else {
            g.alertness = Math.max(0.25, g.searchTimer / 7.5);
          }
        } else {
          // Patrol state: follow evolving ForgeNoise curiosity field
          g.alertness = Math.max(0, g.alertness - dt * 0.35);
          g.repathTimer -= dt;
          const distToTarget = Math.hypot(g.targetCell[0] + 0.5 - g.x, g.targetCell[1] + 0.5 - g.y);
          if (distToTarget < 1.1 || g.repathTimer <= 0) {
            g.repathTimer = 3.2 + Math.abs(noise.generateSimplex1D(t + g.id * 11)) * 2.5;
            pickNoisePatrolTarget(g, t);
          }
        }
      }

      // ── 2. Wall-Aware Flow Gradient + Noise Curl Steering ──
      let flowX = 0, flowY = 0;

      if (g.seesPlayer && g.state === 'chase') {
        // Direct pursuit with subtle noise flanking offset so multiple guards don't stack
        const flank = noise.generateSimplex1D(t * 1.5 + g.id * 19) * 0.28;
        const dx = player.x - g.x, dy = player.y - g.y;
        const d = Math.hypot(dx, dy) || 1;
        flowX = (dx / d) - (dy / d) * flank;
        flowY = (dy / d) + (dx / d) * flank;
      } else {
        // Sample topological BFS gradient across the 8-neighborhood so guards effortlessly round walls
        const cx = Math.floor(g.x), cy = Math.floor(g.y);
        const centerD = g.bfsDist[idx(cx, cy)];
        let bestD = centerD >= 0 ? centerD : 9999;

        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!ox && !oy) continue;
            const nx = cx + ox, ny = cy + oy;
            if (!inBounds(nx, ny) || grid[idx(nx, ny)]) continue;
            // Prevent diagonal corner clipping through walls
            if (ox && oy && (grid[idx(cx + ox, cy)] || grid[idx(cx, cy + oy)])) continue;
            const nd = g.bfsDist[idx(nx, ny)];
            if (nd >= 0 && nd <= bestD) {
              const weight = (bestD - nd) + 0.6;
              const tx = (nx + 0.5) - g.x;
              const ty = (ny + 0.5) - g.y;
              const len = Math.hypot(tx, ty) || 1;
              flowX += (tx / len) * weight;
              flowY += (ty / len) * weight;
            }
          }
        }
      }

      // Add subtle ForgeNoise derivative curl for human-like corridor weaving
      noise.generateSimplexFractal2D_Derivative(g.x * 0.25 + t * 0.2, g.y * 0.25 + g.id * 7.3, derivTmp, { octaves: 2 });
      const curlStrength = g.state === 'patrol' ? 0.22 : 0.10;
      flowX += derivTmp[2] * curlStrength;
      flowY -= derivTmp[1] * curlStrength;

      const flowLen = Math.hypot(flowX, flowY);
      if (flowLen > 0.001) {
        flowX /= flowLen;
        flowY /= flowLen;
      }

      const speed = g.state === 'chase'   ? GUARD_CHASE_SPEED
                  : g.state === 'search'  ? GUARD_SEARCH_SPEED
                  : g.state === 'curious' ? GUARD_CURIOUS_SPEED
                  : GUARD_PATROL_SPEED;

      g.vx += (flowX * speed - g.vx) * Math.min(1, dt * 10);
      g.vy += (flowY * speed - g.vy) * Math.min(1, dt * 10);

      // Guard-vs-Guard soft separation so patrols don't overlap
      for (const other of guards) {
        if (other.id === g.id) continue;
        const ox = g.x - other.x, oy = g.y - other.y;
        const d = Math.hypot(ox, oy);
        if (d > 0.001 && d < 0.85) {
          const push = (0.85 - d) * 3.5;
          g.vx += (ox / d) * push * dt;
          g.vy += (oy / d) * push * dt;
        }
      }

      moveEntityWithWallSlide(g, g.vx * dt, g.vy * dt, GUARD_RADIUS);

      // Anti-stuck check
      if (Math.hypot(g.x - g.lastPos.x, g.y - g.lastPos.y) < 0.08 * dt) {
        g.stuckTimer += dt;
        if (g.stuckTimer > 0.45) {
          g.stuckTimer = 0;
          if (g.state === 'patrol') pickNoisePatrolTarget(g, t + 17);
          else if (g.state === 'search') pickNoiseSearchSpotNearLKP(g, t + 11);
        }
      } else {
        g.stuckTimer = 0;
      }
      g.lastPos.x = g.x;
      g.lastPos.y = g.y;

      // ── 3. Facing & Noise-Driven Head Scanning ──
      let desiredFacing = g.facing;
      if (g.seesPlayer) {
        desiredFacing = Math.atan2(player.y - g.y, player.x - g.x);
      } else if (g.state === 'search') {
        const moveAngle = Math.hypot(g.vx, g.vy) > 0.25 ? Math.atan2(g.vy, g.vx) : g.facing;
        // Rapidly sweep flashlight left & right using 1D Simplex noise when searching for player
        const scanSweep = noise.generateSimplex1D(t * 2.6 + g.id * 13.7) * 0.95;
        desiredFacing = moveAngle + scanSweep;
      } else if (Math.hypot(g.vx, g.vy) > 0.2) {
        const moveAngle = Math.atan2(g.vy, g.vx);
        const gentleGlance = noise.generateSimplex1D(t * 0.9 + g.id * 9.1) * 0.32;
        desiredFacing = moveAngle + gentleGlance;
      }

      const turnRate = g.state === 'chase' ? 11.0 : g.state === 'search' ? 7.5 : 5.0;
      g.facing = lerpAngle(g.facing, desiredFacing, dt * turnRate);

      // Physical capture check (if an alerted guard tags you or you bump right into them)
      if (distToPlayer < (PLAYER_RADIUS + GUARD_RADIUS + 0.08)) {
        detection = 1;
        triggerGameOver(false, 'A guard intercepted you at close range.');
        return;
      }
    }

    // Global detection bar update
    if (maxDetectIncrement > 0) {
      detection = Math.min(1, detection + maxDetectIncrement);
      if (detection >= 1) {
        triggerGameOver(false, 'Caught in a guard’s spotlight!');
        return;
      }
    } else {
      detection = Math.max(0, detection - 0.38 * dt);
    }

    updateHUD();
  }

  function updateHUD() {
    gemEl.textContent = `${player ? player.gemsCollected : 0} / ${GEM_COUNT_TARGET}`;
    fillEl.style.width = (detection * 100).toFixed(1) + '%';
    fillEl.style.background = detection > 0.65 ? '#ef5350' : detection > 0.3 ? '#ffa726' : '#4caf50';

    let topState = 'PATROL';
    let color = '#4caf50';
    for (const g of guards) {
      if (g.state === 'chase') { topState = 'HUNTING !'; color = '#ef5350'; break; }
      if (g.state === 'search') { topState = 'SEARCHING ?'; color = '#ffa726'; }
      else if (g.state === 'curious' && topState === 'PATROL') { topState = 'CURIOUS ?'; color = '#ffd54f'; }
    }
    stateEl.textContent = topState;
    stateEl.style.color = color;
  }

  // ── Player Update ─────────────────────────────────────
  function updatePlayer(dt) {
    if (won || lost) return;

    if (decoyCooldown > 0) decoyCooldown = Math.max(0, decoyCooldown - dt);

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
      if (!startTime) {
        startTime = performance.now();
        msgEl.classList.add('fade');
      }
    }

    player.sprinting = heldKeys.has('Shift') && mag > 0.01;
    const speed = player.sprinting ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;

    player.vx += (ix * speed - player.vx) * Math.min(1, dt * 16);
    player.vy += (iy * speed - player.vy) * Math.min(1, dt * 16);

    moveEntityWithWallSlide(player, player.vx * dt, player.vy * dt, PLAYER_RADIUS);

    if (mag > 0.1) {
      player.facing = Math.atan2(iy, ix);
    }

    // Sprinting emits audible footstep ripples that nearby guards can hear
    if (player.sprinting) {
      stepSoundTimer -= dt;
      if (stepSoundTimer <= 0) {
        stepSoundTimer = 0.30;
        emitSound(player.x, player.y, 5.2, 'rgba(79, 195, 247, 0.45)', true);
      }
    } else {
      stepSoundTimer = 0;
    }

    // Gem collection
    for (const g of gems) {
      if (!g.collected && Math.hypot(player.x - g.x, player.y - g.y) < 0.65) {
        g.collected = true;
        player.gemsCollected++;
        emitSound(g.x, g.y, 2.2, 'rgba(255, 213, 79, 0.6)', false);
        if (player.gemsCollected >= GEM_COUNT_TARGET) {
          exit.unlocked = true;
          msgEl.textContent = '🚪 Vault Exit unlocked! Escape now!';
          msgEl.classList.remove('fade');
          setTimeout(() => msgEl.classList.add('fade'), 2600);
        }
        updateHUD();
      }
    }

    // Exit check
    if (exit.unlocked && Math.hypot(player.x - exit.x, player.y - exit.y) < 0.72) {
      triggerGameOver(true);
    }
  }

  function triggerDecoy() {
    if (won || lost || decoyCooldown > 0 || !player) return;
    decoyCooldown = 1.8;
    if (!startTime) startTime = performance.now();
    emitSound(player.x, player.y, 9.5, 'rgba(255, 167, 38, 0.75)', true);
  }

  function triggerGameOver(isWin, reasonText) {
    if (won || lost) return;
    won = isWin;
    lost = !isWin;
    const elapsed = startTime ? ((performance.now() - startTime) / 1000).toFixed(1) : '0.0';
    emojiEl.textContent = isWin ? '🏆' : '💀';
    titleEl.textContent = isWin ? 'Vault Cleared!' : 'Caught!';
    subEl.textContent = isWin
      ? `Escaped with all ${GEM_COUNT_TARGET} gems in ${elapsed}s.`
      : (reasonText || 'A guard tracked you down.');
    overEl.classList.add('show');
  }

  // ── Rendering ─────────────────────────────────────────
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = stage.getBoundingClientRect();
    W = Math.max(1, Math.floor(r.width * dpr));
    H = Math.max(1, Math.floor(r.height * dpr));
    canvas.width = W;
    canvas.height = H;
    cellPx = Math.min(W / COLS, H / ROWS);
    offX = (W - cellPx * COLS) * 0.5;
    offY = (H - cellPx * ROWS) * 0.5;
  }

  function draw(t) {
    if (!grid) return;
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    // 1. Floor & Optional Live ForgeNoise Field Overlay
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = idx(x, y);
        const px = offX + x * cellPx;
        const py = offY + y * cellPx;

        if (grid[i] === 1) {
          ctx.fillStyle = '#1b1e2b';
          ctx.fillRect(px, py, cellPx + 0.6, cellPx + 0.6);
          if (y > 0 && grid[idx(x, y - 1)] === 0) {
            ctx.fillStyle = '#2d334a';
            ctx.fillRect(px, py, cellPx + 0.6, Math.max(1.5, cellPx * 0.12));
          }
        } else if (showNoiseField) {
          const n = sampleCuriosityField(x, y, 0, t);
          const norm = Math.max(0, Math.min(1, (n + 1) * 0.5));
          const r = Math.round(14 + norm * 48);
          const g = Math.round(18 + norm * 28);
          const b = Math.round(30 + (1 - norm) * 52);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(px, py, cellPx + 0.5, cellPx + 0.5);
        } else if ((x + y) % 2 === 0) {
          ctx.fillStyle = '#0e1017';
          ctx.fillRect(px, py, cellPx, cellPx);
        }
      }
    }

    // 2. Raycast Guard Vision Cones (clipped accurately against walls)
    for (const g of guards) {
      if (!g.visionPoly || g.visionPoly.length < 3) continue;
      const gx = offX + g.x * cellPx;
      const gy = offY + g.y * cellPx;
      const radius = GUARD_VISION_RANGE * cellPx;

      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < g.visionPoly.length; i++) {
        const vx = offX + g.visionPoly[i][0] * cellPx;
        const vy = offY + g.visionPoly[i][1] * cellPx;
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();

      const rg = ctx.createRadialGradient(gx, gy, cellPx * 0.2, gx, gy, radius);
      if (g.seesPlayer || g.state === 'chase') {
        rg.addColorStop(0, 'rgba(239, 83, 80, 0.48)');
        rg.addColorStop(1, 'rgba(239, 83, 80, 0.03)');
      } else if (g.state === 'search' || g.state === 'curious') {
        rg.addColorStop(0, 'rgba(255, 167, 38, 0.34)');
        rg.addColorStop(1, 'rgba(255, 167, 38, 0.02)');
      } else {
        rg.addColorStop(0, 'rgba(255, 225, 130, 0.20)');
        rg.addColorStop(1, 'rgba(255, 225, 130, 0.01)');
      }
      ctx.fillStyle = rg;
      ctx.fill();
      ctx.restore();
    }

    // 3. Last Known Position (LKP) Ghost Markers & Investigation Vectors
    for (const g of guards) {
      if (!g.lkp.active || g.state === 'patrol') continue;
      const lx = offX + g.lkp.x * cellPx;
      const ly = offY + g.lkp.y * cellPx;
      const gx = offX + g.x * cellPx;
      const gy = offY + g.y * cellPx;

      ctx.save();
      ctx.strokeStyle = g.state === 'chase' ? 'rgba(239,83,80,0.45)' : 'rgba(255,167,38,0.40)';
      ctx.lineWidth = Math.max(1, cellPx * 0.07);
      ctx.setLineDash([cellPx * 0.25, cellPx * 0.25]);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(lx, ly);
      ctx.stroke();

      // Pulsing investigation target reticle where guard last saw/heard player
      const pulse = 0.8 + 0.25 * Math.sin(performance.now() * 0.008);
      ctx.setLineDash([]);
      ctx.strokeStyle = g.state === 'chase' ? 'rgba(239,83,80,0.85)' : 'rgba(255,167,38,0.85)';
      ctx.beginPath();
      ctx.arc(lx, ly, cellPx * 0.42 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      if (showNoiseField) {
        const tx = offX + (g.targetCell[0] + 0.5) * cellPx;
        const ty = offY + (g.targetCell[1] + 0.5) * cellPx;
        ctx.fillStyle = 'rgba(79,195,247,0.6)';
        ctx.fillRect(tx - 3, ty - 3, 6, 6);
      }
      ctx.restore();
    }

    // 4. Sound Waves
    for (const sw of soundWaves) {
      ctx.save();
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = sw.alpha;
      ctx.lineWidth = Math.max(1.5, cellPx * 0.12);
      ctx.beginPath();
      ctx.arc(offX + sw.x * cellPx, offY + sw.y * cellPx, sw.r * cellPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Exit Door
    const ex = offX + exit.x * cellPx;
    const ey = offY + exit.y * cellPx;
    if (exit.unlocked) {
      const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, cellPx * 1.6);
      glow.addColorStop(0, 'rgba(76, 175, 80, 0.7)');
      glow.addColorStop(1, 'rgba(76, 175, 80, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(ex - cellPx * 2, ey - cellPx * 2, cellPx * 4, cellPx * 4);
    }
    ctx.fillStyle = exit.unlocked ? '#4caf50' : '#2e4532';
    ctx.fillRect(ex - cellPx * 0.38, ey - cellPx * 0.44, cellPx * 0.76, cellPx * 0.88);
    ctx.strokeStyle = exit.unlocked ? '#a5d6a7' : '#4caf50';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ex - cellPx * 0.38, ey - cellPx * 0.44, cellPx * 0.76, cellPx * 0.88);

    // 6. Gems
    const gemPulse = 0.8 + 0.2 * Math.sin(performance.now() * 0.006);
    for (const gem of gems) {
      if (gem.collected) continue;
      const gx = offX + gem.x * cellPx;
      const gy = offY + gem.y * cellPx;

      const gglow = ctx.createRadialGradient(gx, gy, 0, gx, gy, cellPx * 1.3);
      gglow.addColorStop(0, 'rgba(255, 213, 79, 0.65)');
      gglow.addColorStop(1, 'rgba(255, 213, 79, 0)');
      ctx.fillStyle = gglow;
      ctx.fillRect(gx - cellPx * 1.5, gy - cellPx * 1.5, cellPx * 3, cellPx * 3);

      ctx.fillStyle = '#ffd54f';
      ctx.beginPath();
      ctx.moveTo(gx, gy - cellPx * 0.38 * gemPulse);
      ctx.lineTo(gx + cellPx * 0.34 * gemPulse, gy);
      ctx.lineTo(gx, gy + cellPx * 0.38 * gemPulse);
      ctx.lineTo(gx - cellPx * 0.34 * gemPulse, gy);
      ctx.closePath();
      ctx.fill();
    }

    // 7. Guards
    for (const g of guards) {
      const px = offX + g.x * cellPx;
      const py = offY + g.y * cellPx;

      const color = (g.seesPlayer || g.state === 'chase') ? '#ef5350'
                  : (g.state === 'search' || g.state === 'curious') ? '#ffa726'
                  : '#ff8a50';

      const glow = ctx.createRadialGradient(px, py, 0, px, py, cellPx * 1.4);
      glow.addColorStop(0, g.state === 'chase' ? 'rgba(239,83,80,0.65)' : 'rgba(255,152,0,0.35)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(px - cellPx * 1.5, py - cellPx * 1.5, cellPx * 3, cellPx * 3);

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, cellPx * GUARD_RADIUS, 0, Math.PI * 2);
      ctx.fill();

      // Guard facing indicator
      ctx.strokeStyle = '#0a0a0c';
      ctx.lineWidth = Math.max(1.5, cellPx * 0.11);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(g.facing) * cellPx * 0.38, py + Math.sin(g.facing) * cellPx * 0.38);
      ctx.stroke();

      // Floating ! / ? Alertness badge
      if (g.state !== 'patrol') {
        ctx.fillStyle = g.state === 'chase' ? '#ef5350' : '#ffd54f';
        ctx.font = `bold ${Math.max(11, Math.round(cellPx * 0.58))}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(g.state === 'chase' ? '!' : '?', px, py - cellPx * 0.45);
      }
    }

    // 8. Player
    const px = offX + player.x * cellPx;
    const py = offY + player.y * cellPx;
    const pglow = ctx.createRadialGradient(px, py, 0, px, py, cellPx * 1.4);
    pglow.addColorStop(0, exit.unlocked ? 'rgba(255, 213, 79, 0.65)' : 'rgba(79, 195, 247, 0.60)');
    pglow.addColorStop(1, 'rgba(79, 195, 247, 0)');
    ctx.fillStyle = pglow;
    ctx.fillRect(px - cellPx * 1.6, py - cellPx * 1.6, cellPx * 3.2, cellPx * 3.2);

    ctx.fillStyle = exit.unlocked ? '#ffd54f' : '#4fc3f7';
    ctx.beginPath();
    ctx.arc(px, py, cellPx * PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Main Loop ─────────────────────────────────────────
  function loop(now) {
    const dt = lastFrameT ? Math.min(0.05, (now - lastFrameT) / 1000) : 0;
    lastFrameT = now;
    simTime += dt;

    updatePlayer(dt);
    updateGuards(simTime, dt);

    // Update expanding sound waves
    for (let i = soundWaves.length - 1; i >= 0; i--) {
      const sw = soundWaves[i];
      sw.r += dt * 14;
      sw.alpha = Math.max(0, 1 - sw.r / sw.maxR);
      if (sw.r >= sw.maxR) soundWaves.splice(i, 1);
    }

    draw(simTime);
    requestAnimationFrame(loop);
  }

  // ── Controls & Input ──────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === ' ') { e.preventDefault(); newBtn.click(); return; }
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); triggerDecoy(); return; }
    if (e.key === 'v' || e.key === 'V') { e.preventDefault(); fieldBtn.click(); return; }
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D','Shift'].includes(e.key)) {
      e.preventDefault();
      heldKeys.add(e.key);
    }
  });

  document.addEventListener('keyup', e => heldKeys.delete(e.key));
  window.addEventListener('blur', () => heldKeys.clear());

  // Touch drag steering for mobile
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
    const dist = Math.hypot(dx, dy);
    if (dist > 8) {
      touchJoy.dx = dx / dist;
      touchJoy.dy = dy / dist;
    } else {
      touchJoy.dx = 0;
      touchJoy.dy = 0;
    }
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    touchJoy.active = false;
    touchJoy.dx = 0;
    touchJoy.dy = 0;
  }, { passive: true });

  function newLevel() { generateLevel(Math.floor(Math.random() * 1_000_000)); }
  newBtn.addEventListener('click', newLevel);
  nextBtn.addEventListener('click', newLevel);
  retryBtn.addEventListener('click', () => generateLevel(seed));
  decoyBtn.addEventListener('click', triggerDecoy);
  fieldBtn.addEventListener('click', () => {
    showNoiseField = !showNoiseField;
    fieldBtn.classList.toggle('active', showNoiseField);
  });

  window.addEventListener('resize', resize);
  resize();
  const params = new URLSearchParams(location.search);
  const urlSeed = parseInt(params.get('seed'), 10);
  generateLevel(isNaN(urlSeed) ? Math.floor(Math.random() * 1_000_000) : urlSeed);
  requestAnimationFrame(loop);
})();