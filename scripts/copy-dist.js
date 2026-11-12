'use strict';
// scripts/copy-dist.js - sync dist/ForgeNoise.min.js into docs/dist/
const fs   = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src  = path.join(root, 'dist', 'ForgeNoise.min.js');
const dir  = path.join(root, 'docs', 'dist');
const dst  = path.join(dir, 'ForgeNoise.min.js');

if (!fs.existsSync(src)) {
  console.error('Missing dist/ForgeNoise.min.js. Run `npm run build` first.');
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, dst);
const kb = (fs.statSync(dst).size / 1024).toFixed(1);
console.log(`Copied dist/ForgeNoise.min.js → docs/dist/ForgeNoise.min.js (${kb} KB)`);