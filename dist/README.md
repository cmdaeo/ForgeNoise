# ForgeNoise

A high-performance JavaScript library for procedural noise generation.

## Installation

```javascript
npm install forge-noise
```

## Usage

```javascript
const ForgeNoise = require('forge-noise');

// Initialize generator
const noise = new ForgeNoise(seedNumber);

// Generate basic Perlin noise
const perlinValue = noise.generate2D(x, y);

// Access minified source directly (browser)
// <script src="https://cdn.jsdelivr.net/gh/TheEmptynessProject/ForgeNoise@main/dist/forgeNoise.min.js"></script>
```

## API

- `new ForgeNoise([seed])` - Create new noise generator
- `generate2D(x, y)` - Classic Perlin noise (range: [-1, 1])
- `generateSimplex2D(x, y)` - Simplex noise implementation
- `generateWorley2D(x, y)` - Cellular/Worley noise

For the full API, examples, and documentation, see the [main repository README](https://github.com/TheEmptynessProject/forgeNoise#readme) or the [website](https://theemptynessproject.github.io/repos/ForgeNoise/index.html).

## License

MIT © [TheEmptynessProject]
