(function () {
  'use strict';
  if (typeof ForgeNoise === 'undefined') return;

  const stage   = document.getElementById('racer-stage');
  const canvas  = document.getElementById('racer-canvas');
  const ctx     = canvas.getContext('2d', { alpha: false });
  const speedEl = document.getElementById('racer-speed');
  const gripEl  = document.getElementById('racer-grip-fill');
  const timeEl  = document.getElementById('racer-time');
  const distEl  = document.getElementById('racer-dist');
  const msgEl   = document.getElementById('racer-msg');
  const overEl  = document.getElementById('racer-over');
  const emojiEl = document.getElementById('racer-emoji');
  const titleEl = document.getElementById('racer-title');
  const subEl   = document.getElementById('racer-sub');
  const retryBtn= document.getElementById('racer-retry');
  const newBtn  = document.getElementById('racer-new');
  const newBtn2 = document.getElementById('racer-new2');

  // ── Engine Config ─────────────────────────────────────
  const SEG_LENGTH    = 200;
  const DRAW_DISTANCE = 240;
  const ROAD_WIDTH    = 2100;
  const CAMERA_HEIGHT = 1050;
  const FOV           = 100;
  const CAMERA_DEPTH  = 1 / Math.tan((FOV / 2) * Math.PI / 180);
  const PLAYER_Z      = CAMERA_HEIGHT * CAMERA_DEPTH;

  const BASE_SPEED    = 6200;
  const MAX_SPEED     = 19500;
  const SPEED_RAMP    = 95;
  const STEER_ACCEL   = 7.5;
  const STEER_DECEL   = 4.2;
  const STEER_MULT    = 2.6;
  const CENTRIFUGAL   = 0.135;

  const OFFROAD_EDGE  = 0.88;
  const OFFROAD_LIMIT = 1.65;
  const CAR_COUNT     = 11;

  // ── State ─────────────────────────────────────────────
  let noise, seed;
  let W = 0, H = 0, dpr = 1;
  let position = 0;
  let playerX = 0, playerVX = 0;
  let speed = BASE_SPEED, boostBonus = 0;
  let shield = 1.0;
  let survived = 0, distance = 0, nearMisses = 0;
  let nearMissBanner = 0;
  let gameOver = false, crashFlash = 0, shake = 0;
  let lastT = 0, raf = 0;
  let skyOffset = 0;

  const heldKeys = new Set();
  const segments = new Map();
  let cars = [];
  let touchX = 0, touching = false;

  // ── 1D ForgeNoise Road Curvature, Width & 3D Hills ────
  function curveAt(z) {
    return noise.generateSimplex1D(z * 0.0000028) * 4.2
         + noise.generateSimplex1D(z * 0.0000210) * 1.8;
  }

  function elevationAt(z) {
    return noise.generateSimplex1D(z * 0.000014 + 100) * 1500
         + noise.generateSimplex1D(z * 0.000042 + 250) * 480;
  }

  function roadWidthAt(z) {
    const n = noise.generateSimplex1D(z * 0.000045 + 300);
    return ROAD_WIDTH * (0.78 + 0.22 * (n + 1) * 0.5);
  }

  function getSegment(index) {
    let seg = segments.get(index);
    if (!seg) {
      const z1 = index * SEG_LENGTH;
      const z2 = z1 + SEG_LENGTH;
      const c = curveAt(z1);
      const propNoise = noise.generateSimplex1D(index * 0.37 + 500);
      seg = {
        index,
        p1: { world: { x: 0, y: elevationAt(z1), z: z1 }, camera: {}, screen: {} },
        p2: { world: { x: 0, y: elevationAt(z2), z: z2 }, camera: {}, screen: {} },
        curve: c,
        roadW: roadWidthAt(z1),
        color: ((index >> 2) & 1) ? '#282a32' : '#22242b',
        hasChevron: Math.abs(c) > 2.4 && (index % 5 === 0),
        chevronDir: Math.sign(c),
        treeSide: propNoise > 0.52 ? 1 : (propNoise < -0.52 ? -1 : 0),
        treeScale: 0.7 + Math.abs(propNoise) * 0.6,
      };
      segments.set(index, seg);
    }
    return seg;
  }

  function trimCache(baseIndex) {
    if (segments.size < 650) return;
    for (const k of segments.keys()) if (k < baseIndex - 15) segments.delete(k);
  }

  function project(p, camX, camY, camZ, roadW) {
    p.camera.x = p.world.x - camX;
    p.camera.y = p.world.y - camY;
    p.camera.z = p.world.z - camZ;
    if (p.camera.z < 1) p.camera.z = 1;
    p.screen.scale = CAMERA_DEPTH / p.camera.z;
    p.screen.x = W / 2 + p.screen.scale * p.camera.x * W / 2;
    p.screen.y = H * 0.52 - p.screen.scale * p.camera.y * H / 2;
    p.screen.w = p.screen.scale * roadW * W / 2;
  }

  // ── Setup ─────────────────────────────────────────────
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = stage.getBoundingClientRect();
    W = Math.max(1, Math.floor(r.width * dpr));
    H = Math.max(1, Math.floor(r.height * dpr));
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = true;
  }

  function reset(s) {
    seed = s;
    noise = new ForgeNoise(s);
    segments.clear();
    position = 0;
    playerX = 0; playerVX = 0;
    speed = BASE_SPEED; boostBonus = 0;
    shield = 1.0;
    survived = 0; distance = 0; nearMisses = 0;
    nearMissBanner = 0;
    gameOver = false; crashFlash = 0; shake = 0;
    skyOffset = 0;
    lastT = 0;
    heldKeys.clear();
    spawnCars();
    overEl.classList.remove('show');
    msgEl.classList.remove('fade');
    updateUrl();
  }

  function updateUrl() {
    try {
      const url = new URL(location.href);
      url.searchParams.set('seed', String(seed));
      history.replaceState(null, '', url);
    } catch {}
  }

  function spawnCars() {
    cars = [];
    const playerWorldZ = position + PLAYER_Z;
    const colors = ['#4fc3f7', '#66bb6a', '#ab47bc', '#ffa726', '#ec407a', '#ef5350', '#ffd54f'];
    for (let i = 0; i < CAR_COUNT; i++) {
      const lane = (i % 3) - 1; // Spread across lanes -1, 0, 1 so all 3 lanes aren't blocked simultaneously
      cars.push({
        id: i,
        z: playerWorldZ + SEG_LENGTH * (26 + i * 22),
        baseOffset: lane * 0.62,
        offset: lane * 0.62,
        speedFactor: 0.50 + (i % 4) * 0.10,
        color: colors[i % colors.length],
        tilt: 0,
        passed: false,
      });
    }
  }

  // ── Update ────────────────────────────────────────────
  function update(dt) {
    if (gameOver) return;

    survived += dt;
    if (survived > 3.5) msgEl.classList.add('fade');
    if (nearMissBanner > 0) nearMissBanner = Math.max(0, nearMissBanner - dt);
    if (boostBonus > 0) boostBonus = Math.max(0, boostBonus - 1200 * dt);

    const boosting = heldKeys.has('ArrowUp') || heldKeys.has('w') || heldKeys.has('W');
    const braking  = heldKeys.has('ArrowDown') || heldKeys.has('s') || heldKeys.has('S');

    let targetCruise = Math.min(MAX_SPEED, BASE_SPEED + survived * SPEED_RAMP) + boostBonus;
    if (boosting) targetCruise = Math.min(MAX_SPEED * 1.12, targetCruise + 2200);
    if (braking)  targetCruise = Math.max(BASE_SPEED * 0.55, targetCruise * 0.62);

    speed += (targetCruise - speed) * Math.min(1, dt * 4.5);
    position += speed * dt;
    distance = position / 10;

    // Steering with drift authority when braking
    let steerInput = 0;
    if (heldKeys.has('ArrowLeft')  || heldKeys.has('a') || heldKeys.has('A')) steerInput -= 1;
    if (heldKeys.has('ArrowRight') || heldKeys.has('d') || heldKeys.has('D')) steerInput += 1;

    if (touching) {
      const normX = (touchX / (W / dpr)) - 0.5;
      steerInput += Math.max(-1, Math.min(1, normX * 2.8));
    }

    const turnAuthority = braking ? 1.35 : 1.0;
    if (steerInput !== 0) {
      playerVX += (steerInput * turnAuthority - playerVX) * STEER_ACCEL * dt;
    } else {
      playerVX *= Math.max(0, 1 - STEER_DECEL * dt);
    }
    playerX += playerVX * STEER_MULT * dt;

    // Centrifugal curve pull
    const segCurve = curveAt(position + PLAYER_Z);
    const speedRatio = speed / BASE_SPEED;
    playerX -= segCurve * CENTRIFUGAL * speedRatio * dt;
    skyOffset += segCurve * speedRatio * dt * 28;

    // Off-road shield & grip handling (fair degradation instead of instant death)
    const absX = Math.abs(playerX);
    if (absX > OFFROAD_EDGE) {
      const severity = (absX - OFFROAD_EDGE) / (OFFROAD_LIMIT - OFFROAD_EDGE);
      speed = Math.max(BASE_SPEED * 0.55, speed - 2600 * dt);
      shield -= (0.42 + severity * 0.65) * dt;
      playerX = Math.max(-OFFROAD_LIMIT, Math.min(OFFROAD_LIMIT, playerX));
      if (shield <= 0) {
        shield = 0;
        crash('offroad');
        return;
      }
    } else {
      shield = Math.min(1.0, shield + 0.22 * dt);
    }

    // NPC Traffic update & Near-Miss detection
    const playerWorldZ = position + PLAYER_Z;
    for (const car of cars) {
      car.z += speed * car.speedFactor * dt;

      // Smooth noise lane-weaving
      const weave = noise.generateSimplex1D(car.z * 0.00018 + car.id * 37) * 0.24;
      const newOffset = Math.max(-0.82, Math.min(0.82, car.baseOffset + weave));
      car.tilt = (newOffset - car.offset) * 35;
      car.offset += (newOffset - car.offset) * Math.min(1, dt * 3);

      const zDiff = car.z - playerWorldZ;

      // Near-miss check when passing a car closely at high speed
      if (!car.passed && zDiff < 0 && zDiff > -SEG_LENGTH * 2) {
        car.passed = true;
        const latDist = Math.abs(car.offset - playerX);
        if (latDist >= 0.26 && latDist < 0.52) {
          nearMisses++;
          boostBonus = Math.min(3500, boostBonus + 1800);
          shield = Math.min(1.0, shield + 0.15);
          nearMissBanner = 1.1;
        }
      }

      // Recycle passed traffic ahead with guaranteed lane spacing
      if (zDiff < -SEG_LENGTH * 6) {
        let maxZ = playerWorldZ + SEG_LENGTH * 90;
        for (const other of cars) if (other.z > maxZ) maxZ = other.z;
        car.z = maxZ + SEG_LENGTH * (18 + Math.random() * 14);
        const lane = Math.floor(Math.random() * 3) - 1;
        car.baseOffset = lane * 0.62;
        car.offset = lane * 0.62;
        car.speedFactor = 0.52 + Math.random() * 0.36;
        car.passed = false;
      }

      // Collision check
      if (Math.abs(zDiff) < SEG_LENGTH * 0.95 && Math.abs(car.offset - playerX) < 0.27) {
        // Glancing side-bump vs full rear-end slam
        if (Math.abs(car.offset - playerX) > 0.20 && shield > 0.45) {
          shield -= 0.45;
          crashFlash = 0.6;
          playerVX = (playerX > car.offset ? 1 : -1) * 1.4;
          car.z += SEG_LENGTH * 2.5;
        } else {
          shield = 0;
          crash('car');
          return;
        }
      }
    }

    const speedFactor = speed / MAX_SPEED;
    const offRoadShake = absX > OFFROAD_EDGE ? 12 : 0;
    const shakeTarget = Math.min(15, Math.max(0, (speedFactor - 0.45) * 9) + offRoadShake);
    shake += (shakeTarget - shake) * dt * 9;
  }

  function crash(reason) {
    if (gameOver) return;
    gameOver = true;
    crashFlash = 1;
    emojiEl.textContent = reason === 'car' ? '💥' : '🌿';
    titleEl.textContent = reason === 'car' ? 'Wrecked!' : 'Spun Out!';
    subEl.textContent = `Survived ${survived.toFixed(1)}s · ${Math.round(distance)}m · ${nearMisses} Near Miss${nearMisses === 1 ? '' : 'es'}`;
    overEl.classList.add('show');
  }

  // ── Render Helpers ────────────────────────────────────
  function poly(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  }

  function drawMountains(horizonY) {
    // Distant parallax mountain range driven by 1D ForgeNoise
    ctx.fillStyle = '#141724';
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    const steps = 64;
    for (let i = 0; i <= steps; i++) {
      const px = (i / steps) * W;
      const sampleX = i * 0.14 + skyOffset * 0.015;
      const h = (noise.generateSimplex1D(sampleX) * 0.6 + noise.generateSimplex1D(sampleX * 2.4 + 30) * 0.4 + 1) * 0.5;
      const py = horizonY - h * H * 0.16 - H * 0.02;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(W, horizonY);
    ctx.closePath();
    ctx.fill();

    // Closer ridge
    ctx.fillStyle = '#1b1f30';
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    for (let i = 0; i <= steps; i++) {
      const px = (i / steps) * W;
      const sampleX = i * 0.22 + skyOffset * 0.032 + 120;
      const h = (noise.generateSimplex1D(sampleX) + 1) * 0.5;
      const py = horizonY - h * H * 0.09 - H * 0.005;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(W, horizonY);
    ctx.closePath();
    ctx.fill();
  }

  function drawRoadsideProp(seg, clipY) {
    const sc = seg.p1.screen.scale;
    const roadW = seg.p1.screen.w;
    if (seg.p1.screen.y >= clipY) return;

    // Curve warning chevron sign
    if (seg.hasChevron) {
      const side = -seg.chevronDir;
      const sx = seg.p1.screen.x + side * roadW * 1.25;
      const sy = seg.p1.screen.y;
      const sw = Math.max(4, sc * 260 * W * 0.5);
      const sh = sw * 0.75;
      if (sy - sh < clipY) {
        ctx.fillStyle = '#ff5c33';
        ctx.fillRect(sx - sw * 0.5, sy - sh * 1.4, sw, sh);
        ctx.fillStyle = '#0a0a0c';
        ctx.font = `bold ${Math.max(8, Math.round(sh * 0.75))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(seg.chevronDir > 0 ? '»' : '«', sx, sy - sh * 0.9);
      }
    }

    // Stylized roadside pine/pillar
    if (seg.treeSide !== 0) {
      const tx = seg.p1.screen.x + seg.treeSide * roadW * (1.45 + seg.treeScale * 0.35);
      const ty = seg.p1.screen.y;
      const tw = sc * 320 * seg.treeScale * W * 0.5;
      const th = tw * 2.4;
      if (tw > 2 && ty > 0) {
        const visibleBottom = Math.min(ty, clipY);
        if (visibleBottom > ty - th) {
          ctx.fillStyle = '#182420';
          ctx.beginPath();
          ctx.moveTo(tx, ty - th);
          ctx.lineTo(tx - tw * 0.5, visibleBottom);
          ctx.lineTo(tx + tw * 0.5, visibleBottom);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  function drawTrafficCar(car, seg, clipY) {
    const sc = seg.p1.screen.scale;
    const roadW = seg.p1.screen.w;
    const cx = seg.p1.screen.x + car.offset * roadW;
    const cy = seg.p1.screen.y;
    const cw = sc * 540 * (W * 0.5);
    const ch = cw * 0.58;

    if (cw < 2 || cy - ch >= clipY) return;

    ctx.save();
    ctx.translate(cx, Math.min(cy, clipY));
    ctx.rotate(car.tilt * 0.015);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(-cw * 0.52, -ch * 0.12, cw * 1.04, ch * 0.16);

    // Body
    ctx.fillStyle = car.color;
    ctx.beginPath();
    ctx.roundRect(-cw * 0.5, -ch, cw, ch * 0.88, Math.max(2, cw * 0.12));
    ctx.fill();

    // Cabin / rear window
    ctx.fillStyle = '#11131a';
    ctx.beginPath();
    ctx.roundRect(-cw * 0.36, -ch * 0.92, cw * 0.72, ch * 0.42, Math.max(1, cw * 0.08));
    ctx.fill();

    // Tail lights
    ctx.fillStyle = '#ff1744';
    ctx.fillRect(-cw * 0.44, -ch * 0.42, cw * 0.22, ch * 0.14);
    ctx.fillRect(cw * 0.22, -ch * 0.42, cw * 0.22, ch * 0.14);

    ctx.restore();
  }

  function drawPlayerCar() {
    const cx = W * 0.5;
    const cy = H * 0.86;
    const cw = Math.min(W, H) * 0.16;
    const ch = cw * 0.56;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(playerVX * 0.085);

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.ellipse(0, ch * 0.1, cw * 0.62, ch * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    // Boost flame
    if (boostBonus > 100 || heldKeys.has('ArrowUp') || heldKeys.has('w') || heldKeys.has('W')) {
      const flicker = 0.7 + Math.random() * 0.5;
      ctx.fillStyle = 'rgba(79, 195, 247, 0.85)';
      ctx.beginPath();
      ctx.moveTo(-cw * 0.22, 0);
      ctx.lineTo(-cw * 0.14, ch * 0.35 * flicker);
      ctx.lineTo(-cw * 0.06, 0);
      ctx.moveTo(cw * 0.06, 0);
      ctx.lineTo(cw * 0.14, ch * 0.35 * flicker);
      ctx.lineTo(cw * 0.22, 0);
      ctx.fill();
    }

    // Main chassis
    ctx.fillStyle = '#ff5c33';
    ctx.beginPath();
    ctx.roundRect(-cw * 0.5, -ch, cw, ch, cw * 0.14);
    ctx.fill();

    // Roof / cockpit
    ctx.fillStyle = '#14161f';
    ctx.beginPath();
    ctx.roundRect(-cw * 0.34, -ch * 0.88, cw * 0.68, ch * 0.48, cw * 0.1);
    ctx.fill();

    // Rear tail light bar
    ctx.fillStyle = '#ffeb3b';
    ctx.fillRect(-cw * 0.42, -ch * 0.34, cw * 0.24, ch * 0.14);
    ctx.fillRect(cw * 0.18, -ch * 0.34, cw * 0.24, ch * 0.14);

    // Shield aura when low or taking off-road damage
    if (shield < 0.98) {
      ctx.strokeStyle = shield < 0.35 ? 'rgba(239, 83, 80, 0.75)' : 'rgba(79, 195, 247, 0.45)';
      ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath();
      ctx.ellipse(0, -ch * 0.45, cw * 0.64, ch * 0.72, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ── Render ────────────────────────────────────────────
  function render() {
    const shook = shake > 0.4;
    if (shook) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * shake * dpr, (Math.random() - 0.5) * shake * dpr);
    }

    const horizonY = H * 0.50;

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
    skyGrad.addColorStop(0, '#090b12');
    skyGrad.addColorStop(1, '#181c2e');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, horizonY + 2);

    // Sun / Horizon glow
    const sunGrad = ctx.createRadialGradient(W * 0.5, horizonY, 0, W * 0.5, horizonY, W * 0.45);
    sunGrad.addColorStop(0, 'rgba(255, 92, 51, 0.28)');
    sunGrad.addColorStop(1, 'rgba(255, 92, 51, 0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, W, horizonY);

    drawMountains(horizonY);

    // Ground base
    ctx.fillStyle = '#0d1017';
    ctx.fillRect(0, horizonY, W, H - horizonY);

    const baseIndex = Math.floor(position / SEG_LENGTH);
    const basePercent = (position % SEG_LENGTH) / SEG_LENGTH;
    trimCache(baseIndex);

    const playerZWorld = position + PLAYER_Z;
    const playerElev = elevationAt(playerZWorld);
    const camY = CAMERA_HEIGHT + playerElev;

    // Project road segments front-to-back, tracking horizon clip line
    let maxy = H;
    let x = 0;
    let dx = -getSegment(baseIndex).curve * basePercent;

    const visibleSegs = [];
    for (let n = 0; n < DRAW_DISTANCE; n++) {
      const seg = getSegment(baseIndex + n);
      const camX = playerX * seg.roadW - x;
      project(seg.p1, camX, camY, position, seg.roadW);
      project(seg.p2, camX - dx, camY, position, seg.roadW);

      x += dx;
      dx += seg.curve;

      seg.clipY = maxy;
      visibleSegs.push(seg);

      if (seg.p1.camera.z <= CAMERA_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) {
        continue;
      }

      const x1 = seg.p1.screen.x, y1 = seg.p1.screen.y, w1 = seg.p1.screen.w;
      const x2 = seg.p2.screen.x, y2 = seg.p2.screen.y, w2 = seg.p2.screen.w;

      // Alternating terrain strips
      const grassColor = ((seg.index >> 2) & 1) ? '#10141d' : '#0c0f16';
      ctx.fillStyle = grassColor;
      ctx.fillRect(0, y2, W, y1 - y2 + 1);

      // Rumble strips
      const r1 = w1 * 1.14, r2 = w2 * 1.14;
      const rumbleColor = ((seg.index >> 1) & 1) ? '#ff5c33' : '#d9e2ec';
      poly(x1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - r2, y2, rumbleColor);
      poly(x1 + w1, y1, x1 + r1, y1, x2 + r2, y2, x2 + w2, y2, rumbleColor);

      // Road surface
      poly(x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, seg.color);

      // Lane dividers (3 lanes)
      if ((seg.index & 3) < 2) {
        const lw1 = Math.max(1, w1 * 0.022), lw2 = Math.max(1, w2 * 0.022);
        const l1 = w1 * 0.33, l2 = w2 * 0.33;
        poly(x1 - l1 - lw1, y1, x1 - l1 + lw1, y1, x2 - l2 + lw2, y2, x2 - l2 - lw2, y2, 'rgba(255,255,255,0.38)');
        poly(x1 + l1 - lw1, y1, x1 + l1 + lw1, y1, x2 + l2 + lw2, y2, x2 + l2 - lw2, y2, 'rgba(255,255,255,0.38)');
      }

      maxy = y2;
    }

    // Back-to-front pass for roadside props and traffic cars
    for (let i = visibleSegs.length - 1; i >= 0; i--) {
      const seg = visibleSegs[i];
      if (seg.p1.camera.z > CAMERA_DEPTH) {
        drawRoadsideProp(seg, seg.clipY);
      }
      for (const car of cars) {
        const carSegIdx = Math.floor(car.z / SEG_LENGTH);
        if (carSegIdx === seg.index && seg.p1.camera.z > CAMERA_DEPTH) {
          drawTrafficCar(car, seg, seg.clipY);
        }
      }
    }

    drawPlayerCar();

    // Near-Miss Banner
    if (nearMissBanner > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, nearMissBanner * 1.5);
      ctx.fillStyle = '#4fc3f7';
      ctx.font = `bold ${Math.round(18 * dpr)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('⚡ NEAR MISS! +BOOST & SHIELD', W * 0.5, H * 0.24);
      ctx.restore();
    }

    // Crash Flash Overlay
    if (crashFlash > 0) {
      ctx.fillStyle = `rgba(255, 82, 82, ${crashFlash * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (shook) ctx.restore();

    // Update HUD
    const kmh = Math.round((speed / BASE_SPEED) * 145);
    speedEl.textContent = `${kmh} km/h`;
    timeEl.textContent = `${survived.toFixed(1)}s`;
    distEl.textContent = `${Math.round(distance)}m`;
    gripEl.style.width = `${(shield * 100).toFixed(0)}%`;
    gripEl.style.background = shield > 0.6 ? '#4fc3f7' : shield > 0.3 ? '#ffa726' : '#ef5350';
  }

  // ── Main Loop ─────────────────────────────────────────
  function loop(now) {
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0;
    lastT = now;

    if (crashFlash > 0) crashFlash = Math.max(0, crashFlash - dt * 2.2);

    update(dt);
    render();
    raf = requestAnimationFrame(loop);
  }

  // ── Controls & Events ─────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === ' ') {
      e.preventDefault();
      reset(Math.floor(Math.random() * 1_000_000));
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) {
      e.preventDefault();
      heldKeys.add(e.key);
    }
  });

  document.addEventListener('keyup', e => heldKeys.delete(e.key));
  window.addEventListener('blur', () => heldKeys.clear());

  canvas.addEventListener('touchstart', e => {
    touching = true;
    touchX = e.touches[0].clientX;
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    if (!touching) return;
    touchX = e.touches[0].clientX;
  }, { passive: true });

  canvas.addEventListener('touchend', () => {
    touching = false;
  }, { passive: true });

  retryBtn.addEventListener('click', () => reset(seed));
  newBtn.addEventListener('click', () => reset(Math.floor(Math.random() * 1_000_000)));
  newBtn2.addEventListener('click', () => reset(Math.floor(Math.random() * 1_000_000)));

  window.addEventListener('resize', resize);
  resize();

  const params = new URLSearchParams(location.search);
  const urlSeed = parseInt(params.get('seed'), 10);
  reset(isNaN(urlSeed) ? Math.floor(Math.random() * 1_000_000) : urlSeed);
  raf = requestAnimationFrame(loop);
})();