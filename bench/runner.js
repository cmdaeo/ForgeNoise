'use strict';
const { spawnSync } = require('child_process');
const fs  = require('fs');
const os  = require('os');
const path = require('path');
const TESTS = require('./tests').map(t => t.id);

const TRIALS      = parseInt(process.env.TRIALS      || '7', 10);
const COOLDOWN_MS = parseInt(process.env.COOLDOWN_MS || '2000', 10);
const N_TESTS     = TESTS.length;
const TOTAL_RUNS  = N_TESTS * TRIALS;

const startTime = Date.now();
const padR = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
function elapsed() {
  const s = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mad(a) { const m = median(a); return median(a.map(x => Math.abs(x - m))); }

function percentile(arr, p) {
  if (!arr || arr.length === 0) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function bootstrapCI(values, iters = 2000) {
  const n = values.length;
  const meds = new Array(iters);
  for (let k = 0; k < iters; k++) {
    const s = new Array(n);
    for (let i = 0; i < n; i++) s[i] = values[(Math.random() * n) | 0];
    meds[k] = median(s);
  }
  meds.sort((a, b) => a - b);
  return [meds[Math.floor(0.025 * iters)], meds[Math.floor(0.975 * iters)]];
}

function systemInfo() {
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    release:  os.release(),
    arch:     os.arch(),
    node:     process.version,
    v8:       process.versions.v8,
    cpu: { model: cpus[0].model.trim(), cores: cpus.length, speed: cpus[0].speed },
    memoryTotalGB: +(os.totalmem() / 1e9).toFixed(2),
    memoryFreeGB:  +(os.freemem()  / 1e9).toFixed(2),
    timestamp: new Date().toISOString(),
  };
}

function systemCpuPct() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const c of cpus) {
    for (const k in c.times) total += c.times[k];
    idle += c.times.idle;
  }
  return +(100 * (1 - idle / total)).toFixed(1);
}

function runTrial(testId) {
  const cpuBefore = systemCpuPct();
  const r = spawnSync(process.execPath, [
    '--expose-gc', '--max-semi-space-size=64', '--max-old-space-size=4096', '--no-warnings',
    path.join(__dirname, 'worker.js'),
  ], {
    env: { ...process.env, TEST_ID: testId },
    encoding: 'utf8', timeout: 60_000,
  });
  const cpuAfter = systemCpuPct();
  if (r.status !== 0) return { error: r.stderr || 'non-zero exit', cpuBefore, cpuAfter };
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  out.cpuBefore = cpuBefore;
  out.cpuAfter  = cpuAfter;
  return out;
}

function rotation(round) {
  const out = new Array(N_TESTS);
  for (let k = 0; k < N_TESTS; k++) out[k] = TESTS[(k + round) % N_TESTS];
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const sys = systemInfo();
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  ForgeNoise benchmark - ${TRIALS} trials × ${N_TESTS} tests = ${TOTAL_RUNS} runs`);
  console.log(`  Cooldown: ${COOLDOWN_MS} ms`);
  console.log(`  CPU:      ${sys.cpu.model} (${sys.cpu.cores} cores @ ${sys.cpu.speed} MHz)`);
  console.log(`  Node:     ${sys.node} · V8 ${sys.v8}`);
  console.log(`  Platform: ${sys.platform} ${sys.release} (${sys.arch})`);
  console.log(`  Memory:   ${sys.memoryTotalGB} GB total, ${sys.memoryFreeGB} GB free`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const results = {};
  let done = 0;

  for (let t = 0; t < TRIALS; t++) {
    const order = rotation(t);
    console.log(`\n[${elapsed()}] ── Trial ${t + 1}/${TRIALS} ── first: ${order[0]}  last: ${order[N_TESTS - 1]}`);
    const trialStartTs = Date.now();

    for (const id of order) {
      const out = runTrial(id);
      done++;
      const pct = Math.floor(done / TOTAL_RUNS * 100);
      const tStart = performance.now();

      if (out.error) {
        console.log(`[${elapsed()}] ${padR(id, 28)}  FAIL: ${out.error.split('\n')[0]}`);
        continue;
      }

      const m = median(out.samples);
      const r = results[id] ||= {
        cat: out.cat, lib: out.lib,
        trialMedians: [], cpuSamples: [], rssSamples: [], sysCpu: [],
      };
      r.trialMedians.push(m);
      r.cpuSamples.push(...(out.cpuSamples || []));
      r.rssSamples.push(...(out.rssSamples || []));
      r.sysCpu.push([out.cpuBefore, out.cpuAfter]);

      const testMs = Math.round(performance.now() - tStart);
      console.log(
        `[${elapsed()}] ${padL(pct + '%', 4)} ${padR(id, 28)} ` +
        `${padL(Math.round(m).toLocaleString(), 14)} op/s  ` +
        `(${padL(testMs, 4)} ms)`
      );
    }

    if (t < TRIALS - 1) {
      console.log(`[${elapsed()}] trial done in ${Math.round((Date.now() - trialStartTs) / 1000)} s - cooling down ${COOLDOWN_MS} ms`);
      await sleep(COOLDOWN_MS);
    }
  }

  const table = [];
  for (const id of TESTS) {
    const r = results[id]; if (!r) continue;
    const usable = r.trialMedians.length > 3 ? r.trialMedians.slice(1) : r.trialMedians;
    const m   = median(usable);
    const d   = mad(usable);
    const rel = (d / m) * 100;
    const min = Math.min(...usable);
    const max = Math.max(...usable);
    const [lo, hi] = bootstrapCI(usable);
    const status = rel < 2 ? 'OK' : rel < 5 ? 'FAIR' : 'NOISY';

    const p50 = 1e9 / m;
    const p95 = 1e9 / percentile(usable, 0.05);
    const p99 = 1e9 / percentile(usable, 0.01);

    const cpuMed = r.cpuSamples.length ? median(r.cpuSamples) : NaN;
    const rssMed = r.rssSamples.length ? median(r.rssSamples) : NaN;
    const sysStartMed = r.sysCpu.length ? median(r.sysCpu.map(x => x[0])) : NaN;
    const sysEndMed   = r.sysCpu.length ? median(r.sysCpu.map(x => x[1])) : NaN;

    table.push({
      Category: r.cat,
      Library: r.lib,
      'Median op/s': Math.round(m).toLocaleString(),
      'Min':         Math.round(min).toLocaleString(),
      'Max':         Math.round(max).toLocaleString(),
      'p50 ns':      Number.isFinite(p50) ? p50.toFixed(1) : '-',
      'p95 ns':      Number.isFinite(p95) ? p95.toFixed(1) : '-',
      'p99 ns':      Number.isFinite(p99) ? p99.toFixed(1) : '-',
      'relMAD %':    rel.toFixed(2) + '%',
      '95% CI':      `[${Math.round(lo).toLocaleString()}, ${Math.round(hi).toLocaleString()}]`,
      'CPU %':       Number.isFinite(cpuMed) ? cpuMed.toFixed(0) + '%' : '-',
      'RSS MB':      Number.isFinite(rssMed) ? (rssMed / 1048576).toFixed(0) : '-',
      'Sys CPU start→end':
        Number.isFinite(sysStartMed) ? `${sysStartMed.toFixed(0)}→${sysEndMed.toFixed(0)}%` : '-',
      Status: status,
      Trials: usable.length,
    });
  }

  table.sort((a, b) =>
    a.Category.localeCompare(b.Category) ||
    parseInt(b['Median op/s'].replace(/,/g, ''), 10) -
    parseInt(a['Median op/s'].replace(/,/g, ''), 10));

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  FINAL TABLE - completed in ${elapsed()}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.table(table);

  const noisy = table.filter(r => r.Status === 'NOISY');
  if (noisy.length) {
    console.log(`\n⚠  ${noisy.length} NOISY row(s). Re-run with TRIALS=11+.`);
  }

  const outPath = path.join(__dirname, 'results.json');
  fs.writeFileSync(outPath,
    JSON.stringify({ trials: TRIALS, cooldownMs: COOLDOWN_MS, system: sys, table, results }, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch(err => { console.error(err.stack || err); process.exit(1); });