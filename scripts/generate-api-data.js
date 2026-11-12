'use strict';
// scripts/generate-api-data.js
// Parses ForgeNoise.js as the single source of truth for the API page.
// Run: node scripts/generate-api-data.js

const fs   = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src  = fs.readFileSync(path.join(root, 'ForgeNoise.js'), 'utf8');
const lines = src.split('\n');

// ── 1. Scan source: every ForgeNoise.prototype.X or ForgeNoise.X ───
const protoRe  = /^\s*ForgeNoise\.prototype\.(\w+)\s*=\s*function\s*\w*\s*\(([^)]*)\)/;
const staticRe = /^\s*ForgeNoise\.(\w+)\s*=\s*function\s*\w*\s*\(([^)]*)\)/;
const methods = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let m = protoRe.exec(line);
  let isStatic = false;
  if (!m) { m = staticRe.exec(line); isStatic = true; }
  if (!m) continue;
  if (m[1].startsWith('_')) continue;
  methods.push({
    name: m[1],
    params: m[2].split(',').map(s => s.trim()).filter(Boolean),
    comment: readCommentAbove(lines, i),
    isStatic,
  });
}

// ── 2. Read the comment block above a declaration ─────────────────
function readCommentAbove(lines, idx) {
  // Case A: /** ... */ block
  let j = idx - 1;
  while (j >= 0 && lines[j].trim() === '') j--;
  if (j >= 0 && lines[j].trim().endsWith('*/')) {
    let start = j;
    while (start >= 0 && !lines[start].trim().startsWith('/**')) start--;
    if (start >= 0) {
      return lines.slice(start, j + 1)
        .map(l => l.replace(/^\s*\/\*\*?/, '').replace(/\*\/\s*$/, '').replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .join('\n');
    }
  }
  // Case B: contiguous // lines
  const buf = [];
  j = idx - 1;
  while (j >= 0 && lines[j].trim().startsWith('//')) {
    buf.unshift(lines[j].trim().replace(/^\/\/\s?/, ''));
    j--;
  }
  return buf.join('\n');
}

// ── 3. Split comment into @tags + description ─────────────────────
function parseComment(text) {
  const tags = {};
  const desc = [];
  for (const line of text.split('\n')) {
    const m = /^@(\w+)\s+(.*)$/.exec(line.trim());
    if (m) tags[m[1].toLowerCase()] = m[2].trim();
    else if (line.trim()) desc.push(line.trim());
  }
  return { tags, description: desc.join(' ') };
}

// ── 4. Inference (only used when the comment didn't say) ──────────
function inferCategory(name) {
  if (name.endsWith('01'))                                     return '[0, 1] variants';
  if (/^(initSeed|reseed|clone|setGlobalSeed|getGlobalSeed)$/.test(name)) return 'Constructor';
  if (/^generateSimplex\d+D_Derivative$/.test(name))           return 'Simplex - analytic derivatives';
  if (/^generateSimplex\d+D$/.test(name))                      return 'Simplex';
  if (/^generate\d+D$/.test(name))                             return 'Perlin';
  if (/^generateValue\d+D$/.test(name))                        return 'Value';
  if (/^generateWorley\d+D(_Sq)?$/.test(name))                 return 'Cellular - Worley';
  if (name === 'generateVoronoi2D')                            return 'Cellular - Voronoi';
  if (/^generateCellular\d+D$/.test(name))                     return 'Cellular - configurable';
  if (/^getCellPoint\d+D$/.test(name))                         return 'Cellular - feature points';
  if (/^generateSimplexFractal\d+D_Derivative$/.test(name))    return 'Fractal - analytic derivatives';
  if (/^generate(Simplex)?Fractal\d+D$/.test(name))            return 'Fractal';
  if (/^generateTiling/.test(name))                            return 'Tiling';
  if (/^(warp|warpCoords)\d+D$/.test(name))                    return 'Domain warp';
  if (/^generateOpenSimplex2F_/.test(name))                    return 'OpenSimplex2F';
  if (/^generateOpenSimplex2S_/.test(name))                    return 'OpenSimplex2S';
  return 'Other';
}

function inferReturn(name) {
  if (name === 'clone')                 return 'ForgeNoise';
  if (name === 'reseed')                return 'this';
  if (name === 'initSeed')              return 'void';
  if (name === 'setGlobalSeed')         return 'void';
  if (name === 'getGlobalSeed')         return 'number | undefined';
  if (name.startsWith('warpCoords'))    return 'Float64Array';
  if (name === 'generateVoronoi2D')     return '{ distance, cellI, cellJ }';
  if (name.startsWith('getCellPoint'))  return 'Array | out';
  return 'number';
}

function inferRange(name) {
  if (/^(initSeed|reseed|clone|setGlobalSeed|getGlobalSeed)$/.test(name)) return null;
  if (name.startsWith('warpCoords'))    return null;
  if (name.startsWith('getCellPoint'))  return null;
  if (name === 'generateVoronoi2D')     return '{ distance: [0, ≈0.7] }';
  if (name.endsWith('01'))              return '[0, 1]';
  if (/_Sq$/.test(name))                return '[0, ∞)';
  if (/^generateValue/.test(name))      return '[0, 1]';
  if (/Derivative$/.test(name))         return '[-1, 1] (value)';
  if (/^generateWorley3D/.test(name))   return '[0, ≈0.9]';
  if (/^generateWorley2D/.test(name))   return '[0, ≈0.7]';
  if (/^generate(Simplex)?Fractal/.test(name)) return '[-1, 1] (fbm)';
  if (/^generateTiling/.test(name))     return '[-1, 1]';
  if (/^warp\d+D$/.test(name))          return '[-1, 1]';
  if (/^generateOpenSimplex2/.test(name)) return '≈[-1, 1]';
  if (/^generateCellular/.test(name))   return 'depends on metric / returnType';
  return '[-1, 1]';
}

function inferDescription(name) {
  let m;
  if ((m = /^generateSimplex(\d+)D_Derivative$/.exec(name)))
    return `${m[1]}D simplex - value plus analytic gradient.`;
  if ((m = /^generateSimplex(\d+)D$/.exec(name)))
    return `${m[1]}D simplex noise.`;
  if ((m = /^generate(\d+)D$/.exec(name)))
    return `${m[1]}D Perlin noise.`;
  if ((m = /^generateValue(\d+)D$/.exec(name)))
    return `${m[1]}D value noise.`;
  if ((m = /^generateWorley(\d+)D_Sq$/.exec(name)))
    return `Squared ${m[1]}D Worley distance (no sqrt).`;
  if ((m = /^generateWorley(\d+)D$/.exec(name)))
    return `${m[1]}D Worley distance.`;
  if ((m = /^generateCellular(\d+)D$/.exec(name)))
    return `Configurable ${m[1]}D cellular noise.`;
  if ((m = /^getCellPoint(\d+)D$/.exec(name)))
    return `Feature point of cell in ${m[1]}D.`;
  if ((m = /^generateSimplexFractal(\d+)D_Derivative$/.exec(name)))
    return `${m[1]}D simplex fBm - value plus analytic gradient.`;
  if ((m = /^generateSimplexFractal(\d+)D$/.exec(name)))
    return `fBm of ${m[1]}D simplex noise.`;
  if ((m = /^generateFractal(\d+)D$/.exec(name)))
    return `fBm of ${m[1]}D Perlin noise.`;
  if ((m = /^generateTilingSimplex(\d+)D$/.exec(name)))
    return `Tileable ${m[1]}D simplex (toroidal mapping).`;
  if ((m = /^generateTiling(\d+)D$/.exec(name)))
    return `Perlin noise periodic in ${m[1]} axes.`;
  if ((m = /^warpCoords(\d+)D$/.exec(name)))
    return `${m[1]}D warped coordinates only.`;
  if ((m = /^warp(\d+)D$/.exec(name)))
    return `${m[1]}D domain warp.`;
  if ((m = /^generateOpenSimplex2F_(.+)$/.exec(name)))
    return `OpenSimplex2F, orientation ${m[1]}.`;
  if ((m = /^generateOpenSimplex2S_(.+)$/.exec(name)))
    return `OpenSimplex2S, orientation ${m[1]}.`;
  if (name.endsWith('01'))
    return `[0, 1] variant of ${name.slice(0, -2)}.`;
  if (name === 'initSeed')       return 'Re-shuffle permutation from a new seed.';
  if (name === 'reseed')         return 'Alias of initSeed(); returns this for chaining.';
  if (name === 'clone')          return 'New instance with the same seed.';
  if (name === 'setGlobalSeed')  return 'Set the process-wide default seed.';
  if (name === 'getGlobalSeed')  return 'Get the process-wide default seed.';
  return name;
}

// ── 5. Build groups ───────────────────────────────────────────────
const groups = new Map();
for (const m of methods) {
  const { tags, description } = parseComment(m.comment);
  const category  = tags.category || inferCategory(m.name);
  const ret       = tags.returns  || inferReturn(m.name);
  const range     = tags.range    || inferRange(m.name);
  const desc      = description   || inferDescription(m.name);
  const displaySig = m.isStatic
    ? `ForgeNoise.${m.name}(${m.params.join(', ')})`
    : `.${m.name}(${m.params.map(p =>
        (p === 'options' || p === 'out' || p === 'seed') ? p + '?' : p).join(', ')})`;

  if (!groups.has(category)) groups.set(category, []);
  groups.get(category).push({ sig: displaySig, ret, desc, range });
}

// Constructor entry
if (!groups.has('Constructor')) groups.set('Constructor', []);
groups.get('Constructor').unshift({
  sig: 'new ForgeNoise(seed?)',
  ret: 'ForgeNoise',
  desc: 'Create a new instance. Accepts any number; wraps into [1, 2^31-2]. Omit for a random seed.',
  range: null,
});

for (const [, items] of groups) items.sort((a, b) => a.sig.localeCompare(b.sig));

// Display order preference. Unknown categories fall through to 'Other'.
const ORDER = [
  'Constructor', 'Perlin', 'Simplex', 'Simplex - analytic derivatives',
  'Value', 'Cellular - Worley', 'Cellular - Voronoi', 'Cellular - configurable',
  'Cellular - feature points', 'Fractal', 'Fractal - analytic derivatives',
  'Tiling', 'Domain warp', 'OpenSimplex2F', 'OpenSimplex2S',
  '[0, 1] variants', 'Other',
];
const out = ORDER.filter(c => groups.has(c)).map(c => ({ name: c, items: groups.get(c) }));

const js =
  '/* auto-generated by scripts/generate-api-data.js - do not edit directly */\n' +
  '/* Regenerate with: npm run build:web                              */\n' +
  'window.FORGE_API = ' + JSON.stringify(out, null, 2) + ';\n';

fs.writeFileSync(path.join(root, 'docs', 'api-data.js'), js);
const total = out.reduce((s, g) => s + g.items.length, 0);
console.log(`Wrote docs/api-data.js - ${out.length} categories, ${total} methods`);