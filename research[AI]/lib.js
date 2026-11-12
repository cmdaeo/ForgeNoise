'use strict';
// Shared utilities for all research experiments.
// Run from repo root: `node research/01-warp-folding/run.js` etc.

const fs = require('fs');
const path = require('path');

// Require the built library. If this fails, run `npm run build` first.
let ForgeNoise;
try {
  ForgeNoise = require('../dist/ForgeNoise.min.js');
} catch (e) {
  console.error('Could not load dist/forgeNoise.min.js. Run `npm run build` first.');
  console.error('Also check for case: `ls dist/` - filename may be ForgeNoise.min.js.');
  throw e;
}

// ── I/O ────────────────────────────────────────────────────────

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeCSV(filePath, rows) {
  if (!rows.length) { fs.writeFileSync(filePath, ''); return; }
  const header = Object.keys(rows[0]).join(',');
  const lines = [header];
  for (const r of rows) {
    lines.push(Object.values(r).map(v =>
      typeof v === 'number' ? v : `"${String(v)}"`
    ).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

function writeJSON(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

function _crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(_crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function writePNG(filePath, width, height, rgbBuf) {
  const zlib = require('zlib');
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgbBuf.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    sig,
    _pngChunk('IHDR', ihdr),
    _pngChunk('IDAT', idat),
    _pngChunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, png);
}

// Tiny CSV reader for figure scripts
function readCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i]);
    return obj;
  });
}

// ── Statistics ─────────────────────────────────────────────────

const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
const std  = arr => {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
};
const min  = arr => arr.reduce((a, b) => Math.min(a, b));
const max  = arr => arr.reduce((a, b) => Math.max(a, b));

function quantile(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.floor(q * (s.length - 1));
  return s[Math.min(s.length - 1, i)];
}

// ── Sampling ───────────────────────────────────────────────────

// Sample gradient of the field over an n×n grid on [-extent, extent]².
// derivFn should be one of:
//   (x, y, out) => noise.generateSimplex2D_Derivative(x, y, out)       -- exact
//   (x, y, out) => noise.generateSimplexFractal2D_Derivative(x, y, out, { octaves: 4 })
//   (x, y, out) => fdGrad(noise, x, y, 'perlin', out)                  -- approximate
function sampleGradientGrid(derivFn, n, extent) {
  const v  = new Float64Array(n * n);
  const dx = new Float64Array(n * n);
  const dy = new Float64Array(n * n);
  const tmp = new Float64Array(3);
  for (let j = 0; j < n; j++) {
    const y = -extent + 2 * extent * j / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = -extent + 2 * extent * i / (n - 1);
      derivFn(x, y, tmp);
      const k = j * n + i;
      v[k]  = tmp[0];
      dx[k] = tmp[1];
      dy[k] = tmp[2];
    }
  }
  return { v, dx, dy, n, extent };
}

// Central-difference gradient for algorithms without analytic derivatives.
// method: 'perlin' | 'os2f' | 'os2s' | 'value2d'
function fdGrad(noise, x, y, method, out, h = 1e-3) {
  let evalAt;
  switch (method) {
    case 'perlin':  evalAt = (a, b) => noise.generate2D(a, b); break;
    case 'os2f':    evalAt = (a, b) => noise.generateOpenSimplex2F_2D(a, b); break;
    case 'os2s':    evalAt = (a, b) => noise.generateOpenSimplex2S_2D(a, b); break;
    case 'value2d': evalAt = (a, b) => noise.generateValue2D(a, b); break;
    default: throw new Error('unknown method: ' + method);
  }
  const v  = evalAt(x, y);
  const gx = (evalAt(x + h, y) - evalAt(x - h, y)) / (2 * h);
  const gy = (evalAt(x, y + h) - evalAt(x, y - h)) / (2 * h);
  out[0] = v; out[1] = gx; out[2] = gy;
  return out;
}

// ── Field rendering helpers ────────────────────────────────────

// RGB buffers
function grayRGB(v) {
  const g = Math.round(Math.max(0, Math.min(1, v * 0.5 + 0.5)) * 255);
  return [g, g, g];
}

module.exports = {
  ForgeNoise,
  ensureDir, writeCSV, writeJSON, writePNG, readCSV,
  mean, std, min, max, quantile,
  sampleGradientGrid, fdGrad, grayRGB,
};