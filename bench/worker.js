'use strict';
const { performance } = require('perf_hooks');
const tests = require('./tests');

const TARGET_WINDOW_MS = 500;
const MIN_WINDOW_ITERS = 100_000;
const MAX_WINDOW_ITERS = 20_000_000;
const N_WINDOWS        = 12;

const INPUT_SIZE = 65536;
const INPUT_MASK = INPUT_SIZE - 1;
const xArr = new Float64Array(INPUT_SIZE);
const yArr = new Float64Array(INPUT_SIZE);
const zArr = new Float64Array(INPUT_SIZE);
const wArr = new Float64Array(INPUT_SIZE);
(function fillInputs() {
  let s = 0x9E3779B9 | 0;
  const next = () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 200 - 100;
  };
  for (let i = 0; i < INPUT_SIZE; i++) {
    xArr[i] = next(); yArr[i] = next();
    zArr[i] = next(); wArr[i] = next();
  }
})();

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function runWindow(fn, iters, shiftBase, dims) {
  const start = shiftBase & INPUT_MASK;
  let local = 0;
  const t0 = performance.now();
  if (dims === 4) {
    for (let i = 0; i < iters; i++) {
      const idx = (i + start) & INPUT_MASK;
      local += fn(xArr[idx], yArr[idx], zArr[idx], wArr[idx]);
    }
  } else if (dims === 3) {
    for (let i = 0; i < iters; i++) {
      const idx = (i + start) & INPUT_MASK;
      local += fn(xArr[idx], yArr[idx], zArr[idx]);
    }
  } else if (dims === 2) {
    for (let i = 0; i < iters; i++) {
      const idx = (i + start) & INPUT_MASK;
      local += fn(xArr[idx], yArr[idx]);
    }
  } else {
    for (let i = 0; i < iters; i++) {
      const idx = (i + start) & INPUT_MASK;
      local += fn(xArr[idx]);
    }
  }
  const dt = performance.now() - t0;
  if (!Number.isFinite(local)) throw new Error('non-finite sink');
  globalThis.__BENCH_SINK = (globalThis.__BENCH_SINK || 0) + local;
  return iters / (dt / 1000);
}

async function main() {
  const id = process.env.TEST_ID;
  const test = tests.find(t => t.id === id);
  if (!test) { console.error(`unknown test ${id}`); process.exit(2); }

  const fn = await test.setup();
  const dims = test.dims || 2;

  // Adaptive warm-up: seed chunk → ~20 ms chunks until >= 500 ms AND plateau.
  const SEED_CHUNK = 20_000;
  let t0 = performance.now();
  runWindow(fn, SEED_CHUNK, 0, dims);
  const seedMs = Math.max(0.01, performance.now() - t0);
  const WARM_CHUNK = Math.max(SEED_CHUNK, Math.round(SEED_CHUNK * (20 / seedMs)));

  const history = [];
  let warmMs = 0, rounds = 0;
  while (warmMs < 500 || rounds < 20) {
    const t1 = performance.now();
    runWindow(fn, WARM_CHUNK, rounds * WARM_CHUNK, dims);
    warmMs += performance.now() - t1;
    history.push(runWindow(fn, WARM_CHUNK, (rounds + 1) * WARM_CHUNK, dims));
    rounds++;
    if (warmMs >= 2000) break;
    if (history.length >= 8) {
      const recent = history.slice(-8);
      if (Math.abs(recent[7] - recent[0]) / recent[0] < 0.015) break;
    }
  }
  const warmOps = median(history.slice(-3));

  const winIters = Math.max(
    MIN_WINDOW_ITERS,
    Math.min(MAX_WINDOW_ITERS, Math.round(warmOps * (TARGET_WINDOW_MS / 1000)))
  );

  // ── Measurement with per-window CPU / RSS ─────────────────────────
  const samples = [];
  const cpuSamples = [];
  const rssSamples = [];

  for (let w = 0; w < N_WINDOWS; w++) {
    if (global.gc) global.gc();
    const cpuBefore = process.cpuUsage();
    const wallStart = performance.now();
    samples.push(runWindow(fn, winIters, w * winIters, dims));
    const wallMs    = performance.now() - wallStart;
    const cpuDiff   = process.cpuUsage(cpuBefore);
    const memAfter  = process.memoryUsage();

    const cpuPct = ((cpuDiff.user + cpuDiff.system) / 1000) / wallMs * 100;
    cpuSamples.push(+cpuPct.toFixed(1));
    rssSamples.push(memAfter.rss);
  }

  process.stdout.write(JSON.stringify({
    id, cat: test.cat, lib: test.lib,
    warmupMs: Math.round(warmMs), windowIters: winIters,
    samples, cpuSamples, rssSamples,
  }) + '\n');
}

main().catch(err => { console.error(err.stack || err); process.exit(1); });