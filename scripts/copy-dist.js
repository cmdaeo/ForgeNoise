'use strict';
// scripts/copy-dist.js - sync dist/forgeNoise.min.js into web/dist/
const fs   = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src  = path.join(root, 'dist', 'forgeNoise.min.js');
const dir  = path.join(root, 'docs', 'dist');
const dst  = path.join(dir, 'forgeNoise.min.js');

if (!fs.existsSync(src)) {
  console.error('Missing dist/forgeNoise.min.js. Run `npm run build` first.');
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, dst);
const kb = (fs.statSync(dst).size / 1024).toFixed(1);
console.log(`Copied dist/forgeNoise.min.js → web/dist/forgeNoise.min.js (${kb} KB)`);