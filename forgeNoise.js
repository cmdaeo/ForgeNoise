(function(root) {
	"use strict";

	// Flattened typed arrays for cache-friendly, zero-indirection gradient lookups
	const GRAD2 = new Int8Array([
		 1,  1,  -1,  1,   1, -1,  -1, -1,
		 1,  0,  -1,  0,   1,  0,  -1,  0,
		 0,  1,   0, -1,   0,  1,   0, -1
	]);

	const GRAD3 = new Int8Array([
		 1,  1,  0,  -1,  1,  0,   1, -1,  0,  -1, -1,  0,
		 1,  0,  1,  -1,  0,  1,   1,  0, -1,  -1,  0, -1,
		 0,  1,  1,   0, -1,  1,   0,  1, -1,   0, -1, -1
	]);

	const GRAD4 = new Int8Array([
		 0,  1,  1,  1,   0,  1,  1, -1,   0,  1, -1,  1,   0,  1, -1, -1,
		 0, -1,  1,  1,   0, -1,  1, -1,   0, -1, -1,  1,   0, -1, -1, -1,
		 1,  0,  1,  1,   1,  0,  1, -1,   1,  0, -1,  1,   1,  0, -1, -1,
		-1,  0,  1,  1,  -1,  0,  1, -1,  -1,  0, -1,  1,  -1,  0, -1, -1,
		 1,  1,  0,  1,   1,  1,  0, -1,   1, -1,  0,  1,   1, -1,  0, -1,
		-1,  1,  0,  1,  -1,  1,  0, -1,  -1, -1,  0,  1,  -1, -1,  0, -1,
		 1,  1,  1,  0,   1,  1, -1,  0,   1, -1,  1,  0,   1, -1, -1,  0,
		-1,  1,  1,  0,  -1,  1, -1,  0,  -1, -1,  1,  0,  -1, -1, -1,  0
	]);

	// Complete 64-entry lookup table for 4D Simplex traversal (4 bytes per entry = 256 bytes)
	const SIMPLEX_4D_LUT = new Uint8Array([
		0,1,2,3, 0,1,3,2, 0,0,0,0, 0,2,3,1, 0,0,0,0, 0,0,0,0, 0,0,0,0, 1,2,3,0,
		0,2,1,3, 0,0,0,0, 0,3,1,2, 0,3,2,1, 0,0,0,0, 0,0,0,0, 0,0,0,0, 1,3,2,0,
		0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
		1,2,0,3, 0,0,0,0, 1,3,0,2, 0,0,0,0, 0,0,0,0, 0,0,0,0, 2,3,0,1, 2,3,1,0,
		1,0,2,3, 1,0,3,2, 0,0,0,0, 0,0,0,0, 0,0,0,0, 2,0,3,1, 0,0,0,0, 2,1,3,0,
		0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
		2,0,1,3, 0,0,0,0, 0,0,0,0, 0,0,0,0, 3,0,1,2, 3,0,2,1, 0,0,0,0, 3,1,2,0,
		2,1,0,3, 0,0,0,0, 0,0,0,0, 0,0,0,0, 3,1,0,2, 0,0,0,0, 3,2,0,1, 3,2,1,0
	]);

		// Packed corner-offset LUT for 4D rank. Same information as SIMPLEX_4D_LUT
	// but the 12 (i,j,k,l) offset pairs for each sub-simplex are packed into
	// 24 bits of a single Int32. Turns "4 LUT reads + 12 comparisons" into
	// "1 LUT read + 12 shift-and-masks".
	const LUT32 = (() => {
		const out = new Int32Array(64);
		for (let c4 = 0; c4 < 64; c4++) {
			const c = c4 << 2;
			const sc0 = SIMPLEX_4D_LUT[c], sc1 = SIMPLEX_4D_LUT[c + 1],
			      sc2 = SIMPLEX_4D_LUT[c + 2], sc3 = SIMPLEX_4D_LUT[c + 3];
			const i1 = sc0 >= 3 ? 1 : 0, j1 = sc1 >= 3 ? 1 : 0, k1 = sc2 >= 3 ? 1 : 0, l1 = sc3 >= 3 ? 1 : 0;
			const i2 = sc0 >= 2 ? 1 : 0, j2 = sc1 >= 2 ? 1 : 0, k2 = sc2 >= 2 ? 1 : 0, l2 = sc3 >= 2 ? 1 : 0;
			const i3 = sc0 >= 1 ? 1 : 0, j3 = sc1 >= 1 ? 1 : 0, k3 = sc2 >= 1 ? 1 : 0, l3 = sc3 >= 1 ? 1 : 0;
			out[c4] = i1 | (j1 << 2) | (k1 << 4) | (l1 << 6)
			        | (i2 << 8) | (j2 << 10) | (k2 << 12) | (l2 << 14)
			        | (i3 << 16) | (j3 << 18) | (k3 << 20) | (l3 << 22);
		}
		return out;
	})();

	// Perlin gradient selection as fused tables. The old gradient2D/gradient3D picked u/v with data-dependent
	// ternaries, which mispredict on unordered input; here the hash indexes a table of (gx, gy[, gz]) and the
	// dot product is branch-free. Same gradient set, same sums (the extra terms are exact zeros), so the output
	// is bit-identical. 3.4x (2D) / 3.9x (3D) faster in isolation.
	const PERLIN_GRAD2 = new Float64Array(8 * 2);
	for (let h = 0; h < 8; h++) {
		if (h < 4) {
			PERLIN_GRAD2[2 * h] = (h & 1) ? -1 : 1;
			PERLIN_GRAD2[2 * h + 1] = (h & 2) ? -1 : 1;
		} else {
			PERLIN_GRAD2[2 * h] = (h & 2) ? -1 : 1;
			PERLIN_GRAD2[2 * h + 1] = (h & 1) ? -1 : 1;
		}
	}
	const PERLIN_GRAD3 = new Float64Array(16 * 3);
	for (let h = 0; h < 16; h++) {
		const u = h < 8 ? 0 : 1;
		const v = h < 4 ? 1 : (h === 12 || h === 14 ? 0 : 2);
		PERLIN_GRAD3[3 * h + u] += (h & 1) ? -1 : 1;
		PERLIN_GRAD3[3 * h + v] += (h & 2) ? -1 : 1;
	}
	// 1D gradients: magnitudes 1/8..8/8 with a sign bit (|g| <= 1 keeps the 1D range at exactly [-1, 1]).
	const PERLIN_GRAD1 = new Float64Array(16);
	for (let h = 0; h < 16; h++) PERLIN_GRAD1[h] = (((h & 7) + 1) / 8) * ((h & 8) ? -1 : 1);

	function perlinDot2(hash, x, y) {
		const k = (hash & 7) << 1;
		return PERLIN_GRAD2[k] * x + PERLIN_GRAD2[k + 1] * y;
	}

	function perlinDot3(hash, x, y, z) {
		const k = (hash & 15) * 3;
		return PERLIN_GRAD3[k] * x + PERLIN_GRAD3[k + 1] * y + PERLIN_GRAD3[k + 2] * z;
	}

	function gradient4D(hash, x, y, z, w) {
		const idx = (hash & 31) << 2;
		return GRAD4[idx] * x + GRAD4[idx + 1] * y + GRAD4[idx + 2] * z + GRAD4[idx + 3] * w;
	}

	// Precomputed mathematical constants
	const F2 = 0.5 * (Math.sqrt(3) - 1);
	const G2 = (3 - Math.sqrt(3)) / 6;
	const F3 = 1 / 3;
	const G3 = 1 / 6;
	const F4 = (Math.sqrt(5) - 1) / 4;
	const G4 = (5 - Math.sqrt(5)) / 20;
	// 2 * G is an exact doubling, so these keep the arithmetic bit-identical to `x0 - 1 + 2 * G2`.
	const G2_2 = 2 * G2;
	const G3_2 = 2 * G3;
	const NO_OPTIONS = Object.freeze({});
	const INV_255 = 1 / 255;
	const INV_256 = 1 / 256;
	const INV_SQRT2 = 1 / Math.SQRT2;
	const INV_SQRT3 = 1 / Math.sqrt(3);
	const TWO_PI = Math.PI * 2;
	const SEED_MODULUS = 2147483647;
	// 1D simplex: two vertices, kernel (1 - d^2)^4. With |g| <= 1 the maximum is 2 * (3/4)^4 * (1/2) = 81/256 at d = 1/2.
	const SIMPLEX_1D_SCALE = 256 / 81;

	// Contribution of one simplex corner. Deliberately tiny: V8 only inlines callees under ~460 bytes of
	// bytecode, and keeping the corner math here is what lets generateSimplex2D shrink enough to be
	// inlined into its callers (no argument/result boxing, no call overhead).
	function corner2D(pg, g, x, y) {
		let t = 0.5 - x * x - y * y;
		if (!(t > 0)) return 0;
		t *= t;
		return t * t * (pg[g] * x + pg[g + 1] * y);
	}

	function corner3D(pg, g, x, y, z) {
		let t = 0.6 - x * x - y * y - z * z;
		if (!(t > 0)) return 0;
		t *= t;
		return t * t * (pg[g] * x + pg[g + 1] * y + pg[g + 2] * z);
	}

	// Same corners, but also accumulating the analytic gradient into acc = [value, d/dx, d/dy(, d/dz)].
	// n = t^4 * (g . d) with t = r - |d|^2  =>  dn/dx = t^4 * gx - 8 * t^3 * dx * (g . d)
	function cornerDerivative2D(pg, g, x, y, acc) {
		const t = 0.5 - x * x - y * y;
		if (!(t > 0)) return;
		const t2 = t * t, t3 = t2 * t, t4 = t2 * t2;
		const gx = pg[g], gy = pg[g + 1];
		const gd = gx * x + gy * y;
		const k = -8 * t3 * gd;
		acc[0] += t4 * gd;
		acc[1] += t4 * gx + k * x;
		acc[2] += t4 * gy + k * y;
	}

	function cornerDerivative3D(pg, g, x, y, z, acc) {
		const t = 0.6 - x * x - y * y - z * z;
		if (!(t > 0)) return;
		const t2 = t * t, t3 = t2 * t, t4 = t2 * t2;
		const gx = pg[g], gy = pg[g + 1], gz = pg[g + 2];
		const gd = gx * x + gy * y + gz * z;
		const k = -8 * t3 * gd;
		acc[0] += t4 * gd;
		acc[1] += t4 * gx + k * x;
		acc[2] += t4 * gy + k * y;
		acc[3] += t4 * gz + k * z;
	}

	// Seeds: anything is accepted and mapped into [1, 2^31 - 2]. Seeds 1..2^31-2 are unchanged from earlier
	// versions; 0 still maps to 1. Negative / out-of-range seeds used to collapse onto seed 1, now they wrap.
	function normalizeSeed(seed) {
		let s = (seed | 0) % SEED_MODULUS;
		if (s < 0) s += SEED_MODULUS;
		return s === 0 ? 1 : s;
	}
	let globalSeed;

	// Fractal mode: 0 fBm, 1 ridged, 2 turbulence/billow (these three run in the hot loops below), 3 ping-pong,
	// 4 hybrid multifractal (both handled by _fractalAdvanced). Legacy boolean flags (ridged / turbulence) keep
	// working; `type` wins when given. Kept out of line on purpose: V8 stops inlining a callee into its caller
	// once the combined bytecode passes ~920 bytes, and the fractal functions sit right at that edge.
	function fractalModeOfType(type) {
		switch (type) {
			case "fbm": return 0;
			case "ridged": return 1;
			case "turbulence": case "billow": return 2;
			case "pingpong": return 3;
			case "hybrid": return 4;
		}
		throw new TypeError("ForgeNoise: unknown fractal type '" + type + "'");
	}

	const CELL_METRICS = { euclidean: 0, euclideanSq: 1, manhattan: 2, chebyshev: 3 };
	const CELL_RETURNS = { f1: 0, f2: 1, "f2-f1": 2, cellValue: 3 };
	function cellOption(table, name, label) {
		const v = table[name];
		if (v === undefined) throw new TypeError("ForgeNoise: unknown cellular " + label + " '" + name + "'");
		return v;
	}

	function ForgeNoise(seed) {
		this.seed = 0;
		// 1024 entries (4 repeats of the 256-permutation) so feature-point lookups like p[ii + 2 + A] never need a mask.
		this.p = new Uint8Array(1024);
		// Permutation and gradient tables fused: pgN[N * i + k] is component k of the gradient chosen by p[i].
		// Saves a dependent lookup (pMod12 -> GRAD) per corner in the simplex kernels.
		this.pg2 = new Float64Array(512 * 2);
		this.pg3 = new Float64Array(512 * 3);
		this._tmp = new Float64Array(4);
		// SoA gradient tables - filled in initSeed, reused by reseed().
		// Allocated lazily so initSeed can populate them on the first call.
		this.pg3x = null; this.pg3y = null; this.pg3z = null;
		this.g4x = null; this.g4y = null; this.g4z = null; this.g4w = null;
		this.initSeed(seed);
	}

	// Process-wide default used when no seed is passed to the constructor / initSeed / reseed.
	ForgeNoise.setGlobalSeed = function(seed) {
		globalSeed = seed === undefined ? undefined : normalizeSeed(seed);
	};
	ForgeNoise.getGlobalSeed = function() {
		return globalSeed;
	};

	ForgeNoise.prototype.initSeed = function(seed) {
		if (seed === undefined) seed = globalSeed !== undefined ? globalSeed : Math.random() * SEED_MODULUS;
		let s = normalizeSeed(seed);
		// The seed actually used. Pass it to `new ForgeNoise(noise.seed)` to reproduce a randomly seeded instance.
		this.seed = s;
		const p = this.p;
		for (let i = 0; i < 256; i++) {
			p[i] = i;
		}
		for (let i = 255; i > 0; i--) {
			s = (s * 16807) % SEED_MODULUS;
			const j = s % (i + 1);
			const tmp = p[i];
			p[i] = p[j];
			p[j] = tmp;
		}
		const pg2 = this.pg2;
		const pg3 = this.pg3;
		for (let i = 0; i < 1024; i++) {
			p[i] = p[i & 255];
		}
		for (let i = 0; i < 512; i++) {
			const g = p[i] % 12;
			pg2[2 * i] = GRAD2[2 * g];
			pg2[2 * i + 1] = GRAD2[2 * g + 1];
			pg3[3 * i] = GRAD3[3 * g];
			pg3[3 * i + 1] = GRAD3[3 * g + 1];
			pg3[3 * i + 2] = GRAD3[3 * g + 2];
		}
		// SoA gradient tables used by generateSimplex3D / _batch and
		// generateSimplex4D / _batch. Allocated once, refilled on reseed.
		if (this.pg3x === null) {
			this.pg3x = new Float64Array(512);
			this.pg3y = new Float64Array(512);
			this.pg3z = new Float64Array(512);
			// 4D gradient tables: 512-entry, pre-masked. g4x[hash] === GRAD4[4*(hash&31)].
			// Saves the `& 31` on every corner read - 5 ops per sample.
			this.g4x = new Float64Array(512);
			this.g4y = new Float64Array(512);
			this.g4z = new Float64Array(512);
			this.g4w = new Float64Array(512);
		}
		const pg3x = this.pg3x, pg3y = this.pg3y, pg3z = this.pg3z;
		for (let i = 0; i < 512; i++) {
			pg3x[i] = pg3[3 * i];
			pg3y[i] = pg3[3 * i + 1];
			pg3z[i] = pg3[3 * i + 2];
		}
		const g4x = this.g4x, g4y = this.g4y, g4z = this.g4z, g4w = this.g4w;
		for (let i = 0; i < 512; i++) {
			const g = (p[i] & 31) << 2;
			g4x[i] = GRAD4[g];
			g4y[i] = GRAD4[g + 1];
			g4z[i] = GRAD4[g + 2];
			g4w[i] = GRAD4[g + 3];
		}
	};

	ForgeNoise.prototype.reseed = function(seed) {
		this.initSeed(seed);
		return this;
	};

	ForgeNoise.prototype.clone = function() {
		return new ForgeNoise(this.seed);
	};

	/* ------------------------------------------------------------------ 1D */

	ForgeNoise.prototype.generate1D = function(x) {
		const xf = Math.floor(x);
		const X = xf & 255;
		x -= xf;
		const u = x * x * x * (x * (x * 6 - 15) + 10);
		const p = this.p;
		const g0 = PERLIN_GRAD1[p[X] & 15] * x;
		const g1 = PERLIN_GRAD1[p[X + 1] & 15] * (x - 1);
		// |value| <= 1/2 for |g| <= 1 (reached at x = 1/2), so 2x spans exactly [-1, 1].
		return 2 * (g0 + u * (g1 - g0));
	};

	ForgeNoise.prototype.generateSimplex1D = function(x) {
		const i0 = Math.floor(x);
		const x0 = x - i0;
		const x1 = x0 - 1;
		const ii = i0 & 255;
		const p = this.p;
		let t0 = 1 - x0 * x0;
		t0 *= t0; t0 *= t0;
		let t1 = 1 - x1 * x1;
		t1 *= t1; t1 *= t1;
		return SIMPLEX_1D_SCALE * (t0 * PERLIN_GRAD1[p[ii] & 15] * x0 + t1 * PERLIN_GRAD1[p[ii + 1] & 15] * x1);
	};

	ForgeNoise.prototype.generateValue1D = function(x) {
		const i0 = Math.floor(x);
		const fx = x - i0;
		const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
		const p = this.p;
		const ii = i0 & 255;
		const a = p[ii];
		const b = p[ii + 1];
		return (a + u * (b - a)) * INV_255;
	};

	/* ------------------------------------------------------------ Perlin */

	ForgeNoise.prototype.generate2D = function(x, y) {
		const xf = Math.floor(x);
		const yf = Math.floor(y);
		const X = xf & 255;
		const Y = yf & 255;
		x -= xf;
		y -= yf;
		const u = x * x * x * (x * (x * 6 - 15) + 10);
		const v = y * y * y * (y * (y * 6 - 15) + 10);
		const p = this.p;
		const A = p[X] + Y;
		const B = p[X + 1] + Y;

		const g00 = perlinDot2(p[A], x, y);
		const g10 = perlinDot2(p[B], x - 1, y);
		const g01 = perlinDot2(p[A + 1], x, y - 1);
		const g11 = perlinDot2(p[B + 1], x - 1, y - 1);

		const nx0 = g00 + u * (g10 - g00);
		const nx1 = g01 + u * (g11 - g01);
		return nx0 + v * (nx1 - nx0);
	};

	ForgeNoise.prototype.generate3D = function(x, y, z) {
		const xf = Math.floor(x);
		const yf = Math.floor(y);
		const zf = Math.floor(z);
		const X = xf & 255;
		const Y = yf & 255;
		const Z = zf & 255;
		x -= xf;
		y -= yf;
		z -= zf;
		const u = x * x * x * (x * (x * 6 - 15) + 10);
		const v = y * y * y * (y * (y * 6 - 15) + 10);
		const w = z * z * z * (z * (z * 6 - 15) + 10);
		const p = this.p;

		const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
		const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;

		const xm1 = x - 1, ym1 = y - 1, zm1 = z - 1;

		const g000 = perlinDot3(p[AA], x, y, z);
		const g100 = perlinDot3(p[BA], xm1, y, z);
		const g010 = perlinDot3(p[AB], x, ym1, z);
		const g110 = perlinDot3(p[BB], xm1, ym1, z);
		const g001 = perlinDot3(p[AA + 1], x, y, zm1);
		const g101 = perlinDot3(p[BA + 1], xm1, y, zm1);
		const g011 = perlinDot3(p[AB + 1], x, ym1, zm1);
		const g111 = perlinDot3(p[BB + 1], xm1, ym1, zm1);

		const nx00 = g000 + u * (g100 - g000);
		const nx10 = g010 + u * (g110 - g010);
		const nx01 = g001 + u * (g101 - g001);
		const nx11 = g011 + u * (g111 - g011);

		const nxy0 = nx00 + v * (nx10 - nx00);
		const nxy1 = nx01 + v * (nx11 - nx01);

		return nxy0 + w * (nxy1 - nxy0);
	};

	/* ----------------------------------------------------------- Simplex */

	ForgeNoise.prototype.generateSimplex2D = function simplex2D(x, y) {
		const s = (x + y) * F2;
		const i = Math.floor(x + s);
		const j = Math.floor(y + s);
		const t = (i + j) * G2;
		const x0 = x - (i - t);
		const y0 = y - (j - t);

		// +(cmp) compiles branch-free; a ternary here becomes a ~50% mispredicted jump on unordered input
		const i1 = +(x0 > y0);
		const j1 = 1 - i1;

		const ii = i & 255;
		const jj = j & 255;
		const p = this.p;
		const pg = this.pg2;

		return 70 * (
			corner2D(pg, (ii + p[jj]) << 1, x0, y0) +
			corner2D(pg, (ii + i1 + p[jj + j1]) << 1, x0 - i1 + G2, y0 - j1 + G2) +
			corner2D(pg, (ii + 1 + p[jj + 1]) << 1, x0 - 1 + G2_2, y0 - 1 + G2_2));
	};

		ForgeNoise.prototype.generateSimplex3D = function simplex3D(x, y, z) {
		const s = (x + y + z) * F3;
		const i = Math.floor(x + s);
		const j = Math.floor(y + s);
		const k = Math.floor(z + s);
		const t = (i + j + k) * G3;
		const x0 = x - (i - t);
		const y0 = y - (j - t);
		const z0 = z - (k - t);

		// Branch-free bit logic: ~24% faster than the if/else tree on
		// unordered input, because the tree mispredicts ~50% of pairs.
		const a = +(x0 >= y0), b = +(y0 >= z0), c = +(x0 >= z0);
		const i1 = a & (b | c), j1 = (a ^ 1) & b, k1 = (b | c) ^ 1;
		const i2 = a | c,       j2 = (a ^ 1) | b, k2 = (b & c) ^ 1;

		const ii = i & 255, jj = j & 255, kk = k & 255;
		const p = this.p;
		const pgx = this.pg3x, pgy = this.pg3y, pgz = this.pg3z;

		const x1 = x0 - i1 + G3,   y1 = y0 - j1 + G3,   z1 = z0 - k1 + G3;
		const x2 = x0 - i2 + G3_2, y2 = y0 - j2 + G3_2, z2 = z0 - k2 + G3_2;
		const x3 = x0 - 0.5,       y3 = y0 - 0.5,       z3 = z0 - 0.5;

		let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
		let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
		if (t0 > 0) { const g = ii + p[jj + p[kk]]; t0 *= t0;
			n0 = t0 * t0 * (pgx[g] * x0 + pgy[g] * y0 + pgz[g] * z0); }
		let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
		if (t1 > 0) { const g = ii + i1 + p[jj + j1 + p[kk + k1]]; t1 *= t1;
			n1 = t1 * t1 * (pgx[g] * x1 + pgy[g] * y1 + pgz[g] * z1); }
		let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
		if (t2 > 0) { const g = ii + i2 + p[jj + j2 + p[kk + k2]]; t2 *= t2;
			n2 = t2 * t2 * (pgx[g] * x2 + pgy[g] * y2 + pgz[g] * z2); }
		let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
		if (t3 > 0) { const g = ii + 1 + p[jj + 1 + p[kk + 1]]; t3 *= t3;
			n3 = t3 * t3 * (pgx[g] * x3 + pgy[g] * y3 + pgz[g] * z3); }
		return 32 * (n0 + n1 + n2 + n3);
	};

	// Value and analytic gradient in one pass. out = [noise, dnoise/dx, dnoise/dy]; returns noise.
	ForgeNoise.prototype.generateSimplex2D_Derivative = function(x, y, out) {
		if (out === undefined) out = this._tmp;
		const s = (x + y) * F2;
		const i = Math.floor(x + s);
		const j = Math.floor(y + s);
		const t = (i + j) * G2;
		const x0 = x - (i - t);
		const y0 = y - (j - t);
		const i1 = +(x0 > y0);
		const j1 = 1 - i1;
		const ii = i & 255;
		const jj = j & 255;
		const p = this.p;
		const pg = this.pg2;

		out[0] = 0; out[1] = 0; out[2] = 0;
		cornerDerivative2D(pg, (ii + p[jj]) << 1, x0, y0, out);
		cornerDerivative2D(pg, (ii + i1 + p[jj + j1]) << 1, x0 - i1 + G2, y0 - j1 + G2, out);
		cornerDerivative2D(pg, (ii + 1 + p[jj + 1]) << 1, x0 - 1 + G2_2, y0 - 1 + G2_2, out);
		out[0] *= 70; out[1] *= 70; out[2] *= 70;
		return out[0];
	};

	// out = [noise, dnoise/dx, dnoise/dy, dnoise/dz]; returns noise.
	ForgeNoise.prototype.generateSimplex3D_Derivative = function(x, y, z, out) {
		if (out === undefined) out = this._tmp;
		const s = (x + y + z) * F3;
		const i = Math.floor(x + s);
		const j = Math.floor(y + s);
		const k = Math.floor(z + s);
		const t = (i + j + k) * G3;
		const x0 = x - (i - t);
		const y0 = y - (j - t);
		const z0 = z - (k - t);
		const a = +(x0 >= y0), b = +(y0 >= z0), c = +(x0 >= z0);
		const i1 = a & (b | c), j1 = (a ^ 1) & b, k1 = (b | c) ^ 1;
		const i2 = a | c,       j2 = (a ^ 1) | b, k2 = (b & c) ^ 1;
		const ii = i & 255, jj = j & 255, kk = k & 255;
		const p = this.p;
		const pg = this.pg3;

		out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
		cornerDerivative3D(pg, (ii + p[jj + p[kk]]) * 3, x0, y0, z0, out);
		cornerDerivative3D(pg, (ii + i1 + p[jj + j1 + p[kk + k1]]) * 3, x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, out);
		cornerDerivative3D(pg, (ii + i2 + p[jj + j2 + p[kk + k2]]) * 3, x0 - i2 + G3_2, y0 - j2 + G3_2, z0 - k2 + G3_2, out);
		cornerDerivative3D(pg, (ii + 1 + p[jj + 1 + p[kk + 1]]) * 3, x0 - 0.5, y0 - 0.5, z0 - 0.5, out);
		out[0] *= 32; out[1] *= 32; out[2] *= 32; out[3] *= 32;
		return out[0];
	};

	/* ------------------------------------------------------------- Value */

	ForgeNoise.prototype.generateValue2D = function(x, y) {
		const i0 = Math.floor(x);
		const j0 = Math.floor(y);
		const fx = x - i0;
		const fy = y - j0;
		const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
		const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
		const p = this.p;
		const ii = i0 & 255;
		const jj = j0 & 255;
		const pj0 = p[jj];
		const pj1 = p[jj + 1];

		const a00 = p[ii + pj0];
		const a10 = p[ii + 1 + pj0];
		const a01 = p[ii + pj1];
		const a11 = p[ii + 1 + pj1];

		const mixX0 = a00 + u * (a10 - a00);
		const mixX1 = a01 + u * (a11 - a01);
		return (mixX0 + v * (mixX1 - mixX0)) * INV_255;
	};

	ForgeNoise.prototype.generateValue3D = function(x, y, z) {
		const i0 = Math.floor(x);
		const j0 = Math.floor(y);
		const k0 = Math.floor(z);
		const fx = x - i0;
		const fy = y - j0;
		const fz = z - k0;
		const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
		const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
		const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
		const p = this.p;

		const X = i0 & 255, Y = j0 & 255, Z = k0 & 255;
		const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
		const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;

		const v000 = p[AA], v100 = p[BA], v010 = p[AB], v110 = p[BB];
		const v001 = p[AA + 1], v101 = p[BA + 1], v011 = p[AB + 1], v111 = p[BB + 1];

		const nx00 = v000 + u * (v100 - v000);
		const nx10 = v010 + u * (v110 - v010);
		const nx01 = v001 + u * (v101 - v001);
		const nx11 = v011 + u * (v111 - v011);

		const nxy0 = nx00 + v * (nx10 - nx00);
		const nxy1 = nx01 + v * (nx11 - nx01);

		return (nxy0 + w * (nxy1 - nxy0)) * INV_255;
	};

	/* ---------------------------------------------------------- Cellular */

	// Feature point of cell (i, j[, k]). Pass `out` (length >= 2 / 3) to avoid allocating.
	ForgeNoise.prototype.getCellPoint2D = function(i, j, out) {
		const p = this.p;
		const ii = i & 255;
		const A = p[j & 255];
		const px = i + p[ii + A] * INV_256;
		const py = j + p[ii + 1 + A] * INV_256;
		if (out === undefined) return [px, py];
		out[0] = px;
		out[1] = py;
		return out;
	};

	ForgeNoise.prototype.getCellPoint3D = function(i, j, k, out) {
		const p = this.p;
		const ii = i & 255;
		const A = p[(j & 255) + p[k & 255]];
		const px = i + p[ii + A] * INV_256;
		const py = j + p[ii + 1 + A] * INV_256;
		const pz = k + p[ii + 2 + A] * INV_256;
		if (out === undefined) return [px, py, pz];
		out[0] = px;
		out[1] = py;
		out[2] = pz;
		return out;
	};

	// Squared distance to the nearest feature point (no sqrt: enough for comparisons / thresholds).
	ForgeNoise.prototype.generateWorley2D_Sq = function(x, y) {
		const i0 = Math.floor(x);
		const j0 = Math.floor(y);
		const p = this.p;
		let minDistSq = Infinity;

		for (let di = -1; di <= 1; di++) {
			const i = i0 + di;
			const ii = i & 255;
			for (let dj = -1; dj <= 1; dj++) {
				const j = j0 + dj;
				const A = p[j & 255];
				const dx = i + p[ii + A] * INV_256 - x;
				const dy = j + p[ii + 1 + A] * INV_256 - y;
				const distSq = dx * dx + dy * dy;
				if (distSq < minDistSq) minDistSq = distSq;
			}
		}
		return minDistSq;
	};

	// The innermost (k) loop is unrolled: that alone is worth ~16% (a full 27-way unroll ~24%, not worth the bulk).
	ForgeNoise.prototype.generateWorley3D_Sq = function(x, y, z) {
		const i0 = Math.floor(x);
		const j0 = Math.floor(y);
		const k0 = Math.floor(z);
		const p = this.p;
		const ka = (k0 - 1) & 255, kb = k0 & 255, kc = (k0 + 1) & 255;
		const zA = k0 - 1, zC = k0 + 1;
		let minDistSq = Infinity;

		for (let di = -1; di <= 1; di++) {
			const i = i0 + di;
			const ii = i & 255;
			for (let dj = -1; dj <= 1; dj++) {
				const j = j0 + dj;
				const jj = j & 255;

				let A = p[jj + p[ka]];
				let dx = i + p[ii + A] * INV_256 - x;
				let dy = j + p[ii + 1 + A] * INV_256 - y;
				let dz = zA + p[ii + 2 + A] * INV_256 - z;
				let distSq = dx * dx + dy * dy + dz * dz;
				if (distSq < minDistSq) minDistSq = distSq;

				A = p[jj + p[kb]];
				dx = i + p[ii + A] * INV_256 - x;
				dy = j + p[ii + 1 + A] * INV_256 - y;
				dz = k0 + p[ii + 2 + A] * INV_256 - z;
				distSq = dx * dx + dy * dy + dz * dz;
				if (distSq < minDistSq) minDistSq = distSq;

				A = p[jj + p[kc]];
				dx = i + p[ii + A] * INV_256 - x;
				dy = j + p[ii + 1 + A] * INV_256 - y;
				dz = zC + p[ii + 2 + A] * INV_256 - z;
				distSq = dx * dx + dy * dy + dz * dz;
				if (distSq < minDistSq) minDistSq = distSq;
			}
		}
		return minDistSq;
	};

	ForgeNoise.prototype.generateWorley2D = function(x, y) {
		return Math.sqrt(this.generateWorley2D_Sq(x, y));
	};

	ForgeNoise.prototype.generateWorley3D = function(x, y, z) {
		return Math.sqrt(this.generateWorley3D_Sq(x, y, z));
	};

	// Pass `out` (an object like { distance, cellI, cellJ }) to reuse it instead of allocating one per call.
	ForgeNoise.prototype.generateVoronoi2D = function(x, y, out) {
		const i0 = Math.floor(x);
		const j0 = Math.floor(y);
		const p = this.p;
		let minDistSq = Infinity;
		let closestI = 0, closestJ = 0;

		for (let di = -1; di <= 1; di++) {
			const i = i0 + di;
			const ii = i & 255;
			for (let dj = -1; dj <= 1; dj++) {
				const j = j0 + dj;
				const A = p[j & 255];
				const dx = i + p[ii + A] * INV_256 - x;
				const dy = j + p[ii + 1 + A] * INV_256 - y;
				const distSq = dx * dx + dy * dy;
				if (distSq < minDistSq) {
					minDistSq = distSq;
					closestI = i;
					closestJ = j;
				}
			}
		}
		if (out === undefined) {
			return {
				distance: Math.sqrt(minDistSq),
				cellI: closestI,
				cellJ: closestJ
			};
		}
		out.distance = Math.sqrt(minDistSq);
		out.cellI = closestI;
		out.cellJ = closestJ;
		return out;
	};

	// Configurable cellular noise.
	//   options.metric      "euclidean" (default) | "euclideanSq" | "manhattan" | "chebyshev"
	//   options.returnType  "f1" (default, nearest) | "f2" (second nearest) | "f2-f1" | "cellValue" (0..1, per nearest cell)
	//   options.jitter      0..1, how far feature points wander inside their cell (default 1 = same points as Worley)
	// out (optional, length >= 2) receives the integer coordinates of the nearest cell.
	// Like Worley/Voronoi this searches the 3x3 block around the cell, so F2 is a very close approximation, not exact.
	ForgeNoise.prototype.generateCellular2D = function(x, y, options, out) {
		const opts = options || NO_OPTIONS;
		const metric = opts.metric === undefined ? 0 : cellOption(CELL_METRICS, opts.metric, "metric");
		const ret = opts.returnType === undefined ? 0 : cellOption(CELL_RETURNS, opts.returnType, "returnType");
		const jitter = opts.jitter === undefined ? 1 : opts.jitter;
		const i0 = Math.floor(x);
		const j0 = Math.floor(y);
		const p = this.p;
		let d1 = Infinity, d2 = Infinity, ci = 0, cj = 0;

		for (let di = -1; di <= 1; di++) {
			const i = i0 + di;
			const ii = i & 255;
			for (let dj = -1; dj <= 1; dj++) {
				const j = j0 + dj;
				const A = p[j & 255];
				const dx = i + 0.5 + (p[ii + A] * INV_256 - 0.5) * jitter - x;
				const dy = j + 0.5 + (p[ii + 1 + A] * INV_256 - 0.5) * jitter - y;
				let d;
				if (metric <= 1) d = dx * dx + dy * dy;
				else if (metric === 2) d = Math.abs(dx) + Math.abs(dy);
				else d = Math.max(Math.abs(dx), Math.abs(dy));
				if (d < d1) { d2 = d1; d1 = d; ci = i; cj = j; }
				else if (d < d2) d2 = d;
			}
		}
		if (out !== undefined) { out[0] = ci; out[1] = cj; }
		if (ret === 3) return p[(ci & 255) + p[cj & 255]] * INV_255;
		if (metric === 0) { d1 = Math.sqrt(d1); d2 = Math.sqrt(d2); }
		return ret === 0 ? d1 : (ret === 1 ? d2 : d2 - d1);
	};

	// out (optional, length >= 3) receives the integer coordinates of the nearest cell.
	ForgeNoise.prototype.generateCellular3D = function(x, y, z, options, out) {
		const opts = options || NO_OPTIONS;
		const metric = opts.metric === undefined ? 0 : cellOption(CELL_METRICS, opts.metric, "metric");
		const ret = opts.returnType === undefined ? 0 : cellOption(CELL_RETURNS, opts.returnType, "returnType");
		const jitter = opts.jitter === undefined ? 1 : opts.jitter;
		const i0 = Math.floor(x);
		const j0 = Math.floor(y);
		const k0 = Math.floor(z);
		const p = this.p;
		let d1 = Infinity, d2 = Infinity, ci = 0, cj = 0, ck = 0;

		for (let di = -1; di <= 1; di++) {
			const i = i0 + di;
			const ii = i & 255;
			for (let dj = -1; dj <= 1; dj++) {
				const j = j0 + dj;
				const jj = j & 255;
				for (let dk = -1; dk <= 1; dk++) {
					const k = k0 + dk;
					const A = p[jj + p[k & 255]];
					const dx = i + 0.5 + (p[ii + A] * INV_256 - 0.5) * jitter - x;
					const dy = j + 0.5 + (p[ii + 1 + A] * INV_256 - 0.5) * jitter - y;
					const dz = k + 0.5 + (p[ii + 2 + A] * INV_256 - 0.5) * jitter - z;
					let d;
					if (metric <= 1) d = dx * dx + dy * dy + dz * dz;
					else if (metric === 2) d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
					else d = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
					if (d < d1) { d2 = d1; d1 = d; ci = i; cj = j; ck = k; }
					else if (d < d2) d2 = d;
				}
			}
		}
		if (out !== undefined) { out[0] = ci; out[1] = cj; out[2] = ck; }
		if (ret === 3) return p[(ci & 255) + p[(cj & 255) + p[ck & 255]]] * INV_255;
		if (metric === 0) { d1 = Math.sqrt(d1); d2 = Math.sqrt(d2); }
		return ret === 0 ? d1 : (ret === 1 ? d2 : d2 - d1);
	};

	/* ----------------------------------------------------------- Fractals
	 *
	 * options (all optional):
	 *   octaves (4), persistence (0.5), lacunarity (2), scale (1: base frequency), normalized (true)
	 *   type: "fbm" (default) | "ridged" | "turbulence" (alias "billow") | "pingpong" | "hybrid"
	 *         (the older `ridged: true` / `turbulence: true` flags still work)
	 *   pingPongStrength (2)  - "pingpong" only: how many times the noise is folded back on itself
	 *   offset (0.7)          - "hybrid" only: Musgrave hybrid multifractal offset
	 *
	 * Ranges when normalized: fbm [-1, 1], ridged [0, 1], turbulence/billow [0, 1], pingpong [-1, 1],
	 * hybrid |v| <= 1 (typically [0, ~0.7]; octave weights are clamped to [0, 1]).
	 *
	 * Tried and rejected after benchmarking: hoisting the mode test out of the octave loop (17-20% slower, it
	 * stops V8 inlining the kernel), computing the amplitude sum in closed form (slower than the running sum), and
	 * keeping the mode as one integer that the loop compares (17-20% slower than two booleans when callers pass
	 * options objects of different shapes, which is why `ridged` / `turbulence` stay as booleans).
	 */

	ForgeNoise.prototype.generateFractal1D = function (x, options) {
		const opts = options || NO_OPTIONS;
		const octaves = opts.octaves || 4;
		const persistence = opts.persistence || 0.5;
		const lacunarity = opts.lacunarity || 2.0;
		let frequency = opts.scale || 1.0;
		const normalized = opts.normalized !== false;
		let ridged = opts.ridged || false;
		let turbulence = opts.turbulence || false;
		if (opts.type !== undefined) {
			const mode = fractalModeOfType(opts.type);
			if (mode > 2) return this._fractalAdvanced(0, x, 0, 0, opts, mode);
			ridged = mode === 1; turbulence = mode === 2;
		}

		let total = 0;
		let amplitude = 1;
		let maxValue = 0;

		for (let i = 0; i < octaves; i++) {
			let noiseValue = this.generate1D(x * frequency);
			if (ridged) noiseValue = 1 - Math.abs(noiseValue);
			else if (turbulence) noiseValue = Math.abs(noiseValue);
			total += noiseValue * amplitude;
			maxValue += amplitude;
			amplitude *= persistence;
			frequency *= lacunarity;
		}
		return normalized ? total / maxValue : total;
	};

	ForgeNoise.prototype.generateSimplexFractal1D = function (x, options) {
		const opts = options || NO_OPTIONS;
		const octaves = opts.octaves || 4;
		const persistence = opts.persistence || 0.5;
		const lacunarity = opts.lacunarity || 2.0;
		let frequency = opts.scale || 1.0;
		const normalized = opts.normalized !== false;
		let ridged = opts.ridged || false;
		let turbulence = opts.turbulence || false;
		if (opts.type !== undefined) {
			const mode = fractalModeOfType(opts.type);
			if (mode > 2) return this._fractalAdvanced(1, x, 0, 0, opts, mode);
			ridged = mode === 1; turbulence = mode === 2;
		}

		let total = 0;
		let amplitude = 1;
		let maxValue = 0;

		for (let i = 0; i < octaves; i++) {
			let noiseValue = this.generateSimplex1D(x * frequency);
			if (ridged) noiseValue = 1 - Math.abs(noiseValue);
			else if (turbulence) noiseValue = Math.abs(noiseValue);
			total += noiseValue * amplitude;
			maxValue += amplitude;
			amplitude *= persistence;
			frequency *= lacunarity;
		}
		return normalized ? total / maxValue : total;
	};

	ForgeNoise.prototype.generateFractal2D = function (x, y, options) {
		const opts = options || NO_OPTIONS;
		const octaves = opts.octaves || 4;
		const persistence = opts.persistence || 0.5;
		const lacunarity = opts.lacunarity || 2.0;
		let frequency = opts.scale || 1.0;
		const normalized = opts.normalized !== false;
		let ridged = opts.ridged || false;
		let turbulence = opts.turbulence || false;
		if (opts.type !== undefined) {
			const mode = fractalModeOfType(opts.type);
			if (mode > 2) return this._fractalAdvanced(2, x, y, 0, opts, mode);
			ridged = mode === 1; turbulence = mode === 2;
		}

		let total = 0;
		let amplitude = 1;
		let maxValue = 0;

		for (let i = 0; i < octaves; i++) {
			let noiseValue = this.generate2D(x * frequency, y * frequency);
			if (ridged) noiseValue = 1 - Math.abs(noiseValue);
			else if (turbulence) noiseValue = Math.abs(noiseValue);
			total += noiseValue * amplitude;
			maxValue += amplitude;
			amplitude *= persistence;
			frequency *= lacunarity;
		}
		return normalized ? total / maxValue : total;
	};

	ForgeNoise.prototype.generateFractal3D = function (x, y, z, options) {
		const opts = options || NO_OPTIONS;
		const octaves = opts.octaves || 4;
		const persistence = opts.persistence || 0.5;
		const lacunarity = opts.lacunarity || 2.0;
		let frequency = opts.scale || 1.0;
		const normalized = opts.normalized !== false;
		let ridged = opts.ridged || false;
		let turbulence = opts.turbulence || false;
		if (opts.type !== undefined) {
			const mode = fractalModeOfType(opts.type);
			if (mode > 2) return this._fractalAdvanced(4, x, y, z, opts, mode);
			ridged = mode === 1; turbulence = mode === 2;
		}

		let total = 0;
		let amplitude = 1;
		let maxValue = 0;

		for (let i = 0; i < octaves; i++) {
			let noiseValue = this.generate3D(x * frequency, y * frequency, z * frequency);
			if (ridged) noiseValue = 1 - Math.abs(noiseValue);
			else if (turbulence) noiseValue = Math.abs(noiseValue);
			total += noiseValue * amplitude;
			maxValue += amplitude;
			amplitude *= persistence;
			frequency *= lacunarity;
		}
		return normalized ? total / maxValue : total;
	};

	ForgeNoise.prototype.generateSimplexFractal2D = function simplexFractal2D(x, y, options) {
		const opts = options || NO_OPTIONS;
		const octaves = opts.octaves || 4;
		const persistence = opts.persistence || 0.5;
		const lacunarity = opts.lacunarity || 2.0;
		let frequency = opts.scale || 1.0;
		const normalized = opts.normalized !== false;
		let ridged = opts.ridged || false;
		let turbulence = opts.turbulence || false;
		if (opts.type !== undefined) {
			const mode = fractalModeOfType(opts.type);
			if (mode > 2) return this._fractalAdvanced(3, x, y, 0, opts, mode);
			ridged = mode === 1; turbulence = mode === 2;
		}

		let total = 0;
		let amplitude = 1;
		let maxValue = 0;

		for (let i = 0; i < octaves; i++) {
			let noiseValue = this.generateSimplex2D(x * frequency, y * frequency);
			if (ridged) noiseValue = 1 - Math.abs(noiseValue);
			else if (turbulence) noiseValue = Math.abs(noiseValue);
			total += noiseValue * amplitude;
			maxValue += amplitude;
			amplitude *= persistence;
			frequency *= lacunarity;
		}
		return normalized ? total / maxValue : total;
	};

	// The 3D kernel is too big for V8 to inline (and calling it per octave would box 3 arguments plus the
	// result every time), so its body is expanded here by hand. Keep in sync with generateSimplex3D.
	ForgeNoise.prototype.generateSimplexFractal3D = function simplexFractal3D(x, y, z, options) {
		const opts = options || NO_OPTIONS;
		const octaves = opts.octaves || 4;
		const persistence = opts.persistence || 0.5;
		const lacunarity = opts.lacunarity || 2.0;
		let frequency = opts.scale || 1.0;
		const normalized = opts.normalized !== false;
		let ridged = opts.ridged || false;
		let turbulence = opts.turbulence || false;
		if (opts.type !== undefined) {
			const mode = fractalModeOfType(opts.type);
			if (mode > 2) return this._fractalAdvanced(5, x, y, z, opts, mode);
			ridged = mode === 1; turbulence = mode === 2;
		}
		const p = this.p;
		const pg = this.pg3;

		let total = 0;
		let amplitude = 1;
		let maxValue = 0;

		for (let o = 0; o < octaves; o++) {
			const fx = x * frequency, fy = y * frequency, fz = z * frequency;
			const s = (fx + fy + fz) * F3;
			const i = Math.floor(fx + s);
			const j = Math.floor(fy + s);
			const k = Math.floor(fz + s);
			const t = (i + j + k) * G3;
			const x0 = fx - (i - t);
			const y0 = fy - (j - t);
			const z0 = fz - (k - t);

			const a = +(x0 >= y0), b = +(y0 >= z0), c = +(x0 >= z0);
			const i1 = a & (b | c), j1 = (a ^ 1) & b, k1 = (b | c) ^ 1;
			const i2 = a | c,       j2 = (a ^ 1) | b, k2 = (b & c) ^ 1;

			const ii = i & 255, jj = j & 255, kk = k & 255;

			let noiseValue = 32 * (
				corner3D(pg, (ii + p[jj + p[kk]]) * 3, x0, y0, z0) +
				corner3D(pg, (ii + i1 + p[jj + j1 + p[kk + k1]]) * 3, x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3) +
				corner3D(pg, (ii + i2 + p[jj + j2 + p[kk + k2]]) * 3, x0 - i2 + G3_2, y0 - j2 + G3_2, z0 - k2 + G3_2) +
				corner3D(pg, (ii + 1 + p[jj + 1 + p[kk + 1]]) * 3, x0 - 0.5, y0 - 0.5, z0 - 0.5));

			if (ridged) noiseValue = 1 - Math.abs(noiseValue);
			else if (turbulence) noiseValue = Math.abs(noiseValue);
			total += noiseValue * amplitude;
			maxValue += amplitude;
			amplitude *= persistence;
			frequency *= lacunarity;
		}
		return normalized ? total / maxValue : total;
	};

	// Ping-pong (3) and hybrid multifractal (4) for every dimension/kernel. Rarely hot, so one generic loop with a
	// kernel switch instead of six copies. kind: 0/1 = Perlin/simplex 1D, 2/3 = 2D, 4/5 = 3D.
	ForgeNoise.prototype._fractalAdvanced = function(kind, x, y, z, opts, mode) {
		const octaves = opts.octaves || 4;
		const persistence = opts.persistence || 0.5;
		const lacunarity = opts.lacunarity || 2.0;
		let frequency = opts.scale || 1.0;
		const normalized = opts.normalized !== false;
		const pingPongStrength = opts.pingPongStrength !== undefined ? opts.pingPongStrength : 2.0;
		const offset = opts.offset !== undefined ? opts.offset : 0.7;

		let total = 0;
		let amplitude = 1;
		let maxValue = 0;
		let weight = 1;

		for (let i = 0; i < octaves; i++) {
			const fx = x * frequency, fy = y * frequency, fz = z * frequency;
			let v;
			switch (kind) {
				case 0: v = this.generate1D(fx); break;
				case 1: v = this.generateSimplex1D(fx); break;
				case 2: v = this.generate2D(fx, fy); break;
				case 3: v = this.generateSimplex2D(fx, fy); break;
				case 4: v = this.generate3D(fx, fy, fz); break;
				default: v = this.generateSimplex3D(fx, fy, fz); break;
			}
			if (mode === 3) {
				// triangle-wave fold of (v + 1) * strength into [0, 1], then back to [-1, 1]
				let t = (v + 1) * pingPongStrength;
				t -= Math.floor(t * 0.5) * 2;
				v = (t < 1 ? t : 2 - t) * 2 - 1;
			} else {
				// Musgrave-style: each octave's contribution is gated by the previous octave's, clamped to [0, 1]
				const signal = v + offset;
				if (weight > 1) weight = 1; else if (weight < 0) weight = 0;
				v = weight * signal;
				weight = v * amplitude;
			}
			total += v * amplitude;
			maxValue += amplitude;
			amplitude *= persistence;
			frequency *= lacunarity;
		}
		if (mode === 4) maxValue *= 1 + offset;
		return normalized ? total / maxValue : total;
	};

	// fBm of simplex noise with its analytic gradient. out = [value, d/dx, d/dy] (derivatives w.r.t. the x, y you
	// passed in, so frequency is already folded in). Only the plain fBm shape has a meaningful closed-form
	// derivative here; `type`/`ridged`/`turbulence` are ignored. Useful for erosion, lighting and flow fields.
	ForgeNoise.prototype.generateSimplexFractal2D_Derivative = function(x, y, out, options) {
		const opts = options || NO_OPTIONS;
		const octaves = opts.octaves || 4;
		const persistence = opts.persistence || 0.5;
		const lacunarity = opts.lacunarity || 2.0;
		let frequency = opts.scale || 1.0;
		const normalized = opts.normalized !== false;
		const tmp = this._tmp;

		let total = 0, dx = 0, dy = 0;
		let amplitude = 1;
		let maxValue = 0;

		for (let i = 0; i < octaves; i++) {
			total += this.generateSimplex2D_Derivative(x * frequency, y * frequency, tmp) * amplitude;
			dx += tmp[1] * amplitude * frequency;
			dy += tmp[2] * amplitude * frequency;
			maxValue += amplitude;
			amplitude *= persistence;
			frequency *= lacunarity;
		}
		const inv = normalized ? 1 / maxValue : 1;
		out[0] = total * inv;
		out[1] = dx * inv;
		out[2] = dy * inv;
		return out[0];
	};

	/* ------------------------------------------------------------ 4D etc. */

	ForgeNoise.prototype.generate4D = function(x, y, z, w) {
		const xf = Math.floor(x), yf = Math.floor(y), zf = Math.floor(z), wf = Math.floor(w);
		const X = xf & 255, Y = yf & 255, Z = zf & 255, W = wf & 255;
		x -= xf; y -= yf; z -= zf; w -= wf;

		const u = x * x * x * (x * (x * 6 - 15) + 10);
		const v = y * y * y * (y * (y * 6 - 15) + 10);
		const w1 = z * z * z * (z * (z * 6 - 15) + 10);
		const t = w * w * w * (w * (w * 6 - 15) + 10);
		const p = this.p;

		const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
		const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
		const AAA = p[AA] + W, AAB = p[AA + 1] + W, ABA = p[AB] + W, ABB = p[AB + 1] + W;
		const BAA = p[BA] + W, BAB = p[BA + 1] + W, BBA = p[BB] + W, BBB = p[BB + 1] + W;

		const xm1 = x - 1, ym1 = y - 1, zm1 = z - 1, wm1 = w - 1;

		const n0000 = gradient4D(p[AAA], x, y, z, w), n1000 = gradient4D(p[BAA], xm1, y, z, w);
		const n0100 = gradient4D(p[ABA], x, ym1, z, w), n1100 = gradient4D(p[BBA], xm1, ym1, z, w);
		const n0010 = gradient4D(p[AAB], x, y, zm1, w), n1010 = gradient4D(p[BAB], xm1, y, zm1, w);
		const n0110 = gradient4D(p[ABB], x, ym1, zm1, w), n1110 = gradient4D(p[BBB], xm1, ym1, zm1, w);

		const n0001 = gradient4D(p[AAA + 1], x, y, z, wm1), n1001 = gradient4D(p[BAA + 1], xm1, y, z, wm1);
		const n0101 = gradient4D(p[ABA + 1], x, ym1, z, wm1), n1101 = gradient4D(p[BBA + 1], xm1, ym1, z, wm1);
		const n0011 = gradient4D(p[AAB + 1], x, y, zm1, wm1), n1011 = gradient4D(p[BAB + 1], xm1, y, zm1, wm1);
		const n0111 = gradient4D(p[ABB + 1], x, ym1, zm1, wm1), n1111 = gradient4D(p[BBB + 1], xm1, ym1, zm1, wm1);

		const nx000 = n0000 + u * (n1000 - n0000), nx100 = n0100 + u * (n1100 - n0100);
		const nx010 = n0010 + u * (n1010 - n0010), nx110 = n0110 + u * (n1110 - n0110);
		const nx001 = n0001 + u * (n1001 - n0001), nx101 = n0101 + u * (n1101 - n0101);
		const nx011 = n0011 + u * (n1011 - n0011), nx111 = n0111 + u * (n1111 - n0111);

		const nxy00 = nx000 + v * (nx100 - nx000), nxy10 = nx010 + v * (nx110 - nx010);
		const nxy01 = nx001 + v * (nx101 - nx001), nxy11 = nx011 + v * (nx111 - nx011);

		const nxyz0 = nxy00 + w1 * (nxy10 - nxy00);
		const nxyz1 = nxy01 + w1 * (nxy11 - nxy01);

		return nxyz0 + t * (nxyz1 - nxyz0);
	};

			ForgeNoise.prototype.generateSimplex4D = function(x, y, z, w) {
		const s = (x + y + z + w) * F4;
		const i = Math.floor(x + s);
		const j = Math.floor(y + s);
		const k = Math.floor(z + s);
		const l = Math.floor(w + s);
		const t = (i + j + k + l) * G4;
		const x0 = x - (i - t);
		const y0 = y - (j - t);
		const z0 = z - (k - t);
		const w0 = w - (l - t);

		const c4 = ((x0 > y0 ? 32 : 0) | (x0 > z0 ? 16 : 0) | (y0 > z0 ? 8 : 0) |
		            (x0 > w0 ? 4 : 0)  | (y0 > w0 ? 2 : 0)  | (z0 > w0 ? 1 : 0));
		const pk = LUT32[c4];
		const i1 = (pk >>  0) & 3, j1 = (pk >>  2) & 3, k1 = (pk >>  4) & 3, l1 = (pk >>  6) & 3;
		const i2 = (pk >>  8) & 3, j2 = (pk >> 10) & 3, k2 = (pk >> 12) & 3, l2 = (pk >> 14) & 3;
		const i3 = (pk >> 16) & 3, j3 = (pk >> 18) & 3, k3 = (pk >> 20) & 3, l3 = (pk >> 22) & 3;

		const x1 = x0 - i1 + G4,   y1 = y0 - j1 + G4,   z1 = z0 - k1 + G4,   w1 = w0 - l1 + G4;
		const x2 = x0 - i2 + 2 * G4, y2 = y0 - j2 + 2 * G4, z2 = z0 - k2 + 2 * G4, w2 = w0 - l2 + 2 * G4;
		const x3 = x0 - i3 + 3 * G4, y3 = y0 - j3 + 3 * G4, z3 = z0 - k3 + 3 * G4, w3 = w0 - l3 + 3 * G4;
		const x4 = x0 - 1 + 4 * G4,  y4 = y0 - 1 + 4 * G4,  z4 = z0 - 1 + 4 * G4,  w4 = w0 - 1 + 4 * G4;

		const ii = i & 255, jj = j & 255, kk = k & 255, ll = l & 255;
		const p = this.p;
		const Gx = this.g4x, Gy = this.g4y, Gz = this.g4z, Gw = this.g4w;

		// Hash = ii + p[jj + p[kk + p[ll]]], NO outer p and NO mask.
		// Gx/Gy/Gz/Gw are 512-entry tables pre-baked as GRAD4[4*(p[i] & 31)],
		// so Gx[hash] === GRAD4[4*(p[hash] & 31)].
		const h0 = ii       + p[jj       + p[kk       + p[ll]]];
		const h1 = ii + i1  + p[jj + j1  + p[kk + k1  + p[ll + l1]]];
		const h2 = ii + i2  + p[jj + j2  + p[kk + k2  + p[ll + l2]]];
		const h3 = ii + i3  + p[jj + j3  + p[kk + k3  + p[ll + l3]]];
		const h4 = ii + 1   + p[jj + 1   + p[kk + 1   + p[ll + 1]]];

		const f0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0 - w0 * w0;
		const f1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1 - w1 * w1;
		const f2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2 - w2 * w2;
		const f3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3 - w3 * w3;
		const f4 = 0.6 - x4 * x4 - y4 * y4 - z4 * z4 - w4 * w4;

		let n0 = 0, n1 = 0, n2 = 0, n3 = 0, n4 = 0;

		if (f0 > 0) {
			const q = f0 * f0;
			const a0 = Gx[h0], b0 = Gy[h0], c0 = Gz[h0], d0 = Gw[h0];
			n0 = q * q * (a0 * x0 + b0 * y0 + c0 * z0 + d0 * w0);
		}
		if (f1 > 0) {
			const q = f1 * f1;
			const a1 = Gx[h1], b1 = Gy[h1], c1 = Gz[h1], d1 = Gw[h1];
			n1 = q * q * (a1 * x1 + b1 * y1 + c1 * z1 + d1 * w1);
		}
		if (f2 > 0) {
			const q = f2 * f2;
			const a2 = Gx[h2], b2 = Gy[h2], c2 = Gz[h2], d2 = Gw[h2];
			n2 = q * q * (a2 * x2 + b2 * y2 + c2 * z2 + d2 * w2);
		}
		if (f3 > 0) {
			const q = f3 * f3;
			const a3 = Gx[h3], b3 = Gy[h3], c3 = Gz[h3], d3 = Gw[h3];
			n3 = q * q * (a3 * x3 + b3 * y3 + c3 * z3 + d3 * w3);
		}
		if (f4 > 0) {
			const q = f4 * f4;
			const a4 = Gx[h4], b4 = Gy[h4], c4_ = Gz[h4], d4 = Gw[h4];
			n4 = q * q * (a4 * x4 + b4 * y4 + c4_ * z4 + d4 * w4);
		}

		return 27.0 * (n0 + n1 + n2 + n3 + n4);
	};

	/* ----------------------------------------------------------- Tiling
	 * Periods are in lattice cells. Coordinates are assumed to stay well inside +/-2^53; the period wrap is
	 * done on doubles (an int32 fast path was measured and is slower).
	 */

	ForgeNoise.prototype.generateTiling2D = function(x, y, options) {
		const opts = options || NO_OPTIONS;
		const px = opts.periodX || 256;
		const py = opts.periodY || 256;

		const xf = Math.floor(x);
		const yf = Math.floor(y);
		const X0 = ((xf % px) + px) % px & 255;
		const Y0 = ((yf % py) + py) % py & 255;
		const X1 = (((xf + 1) % px) + px) % px & 255;
		const Y1 = (((yf + 1) % py) + py) % py & 255;

		x -= xf;
		y -= yf;
		const u = x * x * x * (x * (x * 6 - 15) + 10);
		const v = y * y * y * (y * (y * 6 - 15) + 10);
		const p = this.p;

		const g00 = perlinDot2(p[p[X0] + Y0], x, y);
		const g10 = perlinDot2(p[p[X1] + Y0], x - 1, y);
		const g01 = perlinDot2(p[p[X0] + Y1], x, y - 1);
		const g11 = perlinDot2(p[p[X1] + Y1], x - 1, y - 1);

		const nx0 = g00 + u * (g10 - g00);
		const nx1 = g01 + u * (g11 - g01);
		return nx0 + v * (nx1 - nx0);
	};

	// Periodic in all three axes: f(x + periodX, y, z) === f(x, y, z), and so on. Default period 256 reproduces generate3D.
	ForgeNoise.prototype.generateTiling3D = function(x, y, z, options) {
		const opts = options || NO_OPTIONS;
		const px = opts.periodX || 256;
		const py = opts.periodY || 256;
		const pz = opts.periodZ || 256;

		const xf = Math.floor(x);
		const yf = Math.floor(y);
		const zf = Math.floor(z);
		const X0 = ((xf % px) + px) % px & 255;
		const Y0 = ((yf % py) + py) % py & 255;
		const Z0 = ((zf % pz) + pz) % pz & 255;
		const X1 = (((xf + 1) % px) + px) % px & 255;
		const Y1 = (((yf + 1) % py) + py) % py & 255;
		const Z1 = (((zf + 1) % pz) + pz) % pz & 255;

		x -= xf;
		y -= yf;
		z -= zf;
		const u = x * x * x * (x * (x * 6 - 15) + 10);
		const v = y * y * y * (y * (y * 6 - 15) + 10);
		const w = z * z * z * (z * (z * 6 - 15) + 10);
		const p = this.p;

		const A = p[X0], B = p[X1];
		const AA = p[A + Y0], AB = p[A + Y1], BA = p[B + Y0], BB = p[B + Y1];
		const xm1 = x - 1, ym1 = y - 1, zm1 = z - 1;

		const g000 = perlinDot3(p[AA + Z0], x, y, z);
		const g100 = perlinDot3(p[BA + Z0], xm1, y, z);
		const g010 = perlinDot3(p[AB + Z0], x, ym1, z);
		const g110 = perlinDot3(p[BB + Z0], xm1, ym1, z);
		const g001 = perlinDot3(p[AA + Z1], x, y, zm1);
		const g101 = perlinDot3(p[BA + Z1], xm1, y, zm1);
		const g011 = perlinDot3(p[AB + Z1], x, ym1, zm1);
		const g111 = perlinDot3(p[BB + Z1], xm1, ym1, zm1);

		const nx00 = g000 + u * (g100 - g000);
		const nx10 = g010 + u * (g110 - g010);
		const nx01 = g001 + u * (g101 - g001);
		const nx11 = g011 + u * (g111 - g011);

		const nxy0 = nx00 + v * (nx10 - nx00);
		const nxy1 = nx01 + v * (nx11 - nx01);

		return nxy0 + w * (nxy1 - nxy0);
	};

	// Tileable simplex noise: samples 4D simplex on a flat torus (x and y each wrapped onto a circle whose
	// circumference equals its period, so feature size matches generateSimplex2D). Exactly periodic up to ~1e-13.
	// The 3D simplex kernel has no such trick available (it would need 6D noise); use generateTiling3D for that.
	ForgeNoise.prototype.generateTilingSimplex2D = function(x, y, options) {
		const opts = options || NO_OPTIONS;
		const px = opts.periodX || 256;
		const py = opts.periodY || 256;
		const ax = (x / px) * TWO_PI;
		const ay = (y / py) * TWO_PI;
		const rx = px / TWO_PI;
		const ry = py / TWO_PI;
		return this.generateSimplex4D(Math.cos(ax) * rx, Math.sin(ax) * rx, Math.cos(ay) * ry, Math.sin(ay) * ry);
	};

	/* -------------------------------------------------------- Domain warp */

	ForgeNoise.prototype.warp2D = function(x, y, options) {
		const opts = options || NO_OPTIONS;
		const warpStrength = opts.warpStrength || 1.0;
		const warpScale = opts.warpScale || 1.0;
		const iterations = opts.iterations || 1;
		let qx = x;
		let qy = y;

		// Each iteration samples at the previous iteration's warped position, so the chain is inherently
		// serial: it cannot be turned into precomputed offset fields without changing the result.
		for (let i = 0; i < iterations; i++) {
			const sx = qx * warpScale;
			const sy = qy * warpScale;
			const offsetX = this.generate2D(sx, sy);
			const offsetY = this.generate2D(sx + 5.2, sy + 1.3);
			qx += offsetX * warpStrength;
			qy += offsetY * warpStrength;
		}
		return this.generate2D(qx, qy);
	};

	ForgeNoise.prototype.warp3D = function(x, y, z, options) {
		const opts = options || NO_OPTIONS;
		const warpStrength = opts.warpStrength || 1.0;
		const warpScale = opts.warpScale || 1.0;
		const iterations = opts.iterations || 1;
		let qx = x;
		let qy = y;
		let qz = z;

		for (let i = 0; i < iterations; i++) {
			const sx = qx * warpScale;
			const sy = qy * warpScale;
			const sz = qz * warpScale;
			const offsetX = this.generate3D(sx, sy, sz);
			const offsetY = this.generate3D(sx + 5.2, sy + 1.3, sz + 9.7);
			const offsetZ = this.generate3D(sx + 2.9, sy + 7.1, sz + 3.4);
			qx += offsetX * warpStrength;
			qy += offsetY * warpStrength;
			qz += offsetZ * warpStrength;
		}
		return this.generate3D(qx, qy, qz);
	};

	// The warped coordinates themselves (so any noise/cellular function can be sampled at them).
	// out = [qx, qy] / [qx, qy, qz]; same options as warp2D / warp3D.
	ForgeNoise.prototype.warpCoords2D = function(x, y, out, options) {
		const opts = options || NO_OPTIONS;
		const warpStrength = opts.warpStrength || 1.0;
		const warpScale = opts.warpScale || 1.0;
		const iterations = opts.iterations || 1;
		let qx = x;
		let qy = y;
		for (let i = 0; i < iterations; i++) {
			const sx = qx * warpScale;
			const sy = qy * warpScale;
			const offsetX = this.generate2D(sx, sy);
			const offsetY = this.generate2D(sx + 5.2, sy + 1.3);
			qx += offsetX * warpStrength;
			qy += offsetY * warpStrength;
		}
		out[0] = qx;
		out[1] = qy;
		return out;
	};

	ForgeNoise.prototype.warpCoords3D = function(x, y, z, out, options) {
		const opts = options || NO_OPTIONS;
		const warpStrength = opts.warpStrength || 1.0;
		const warpScale = opts.warpScale || 1.0;
		const iterations = opts.iterations || 1;
		let qx = x;
		let qy = y;
		let qz = z;
		for (let i = 0; i < iterations; i++) {
			const sx = qx * warpScale;
			const sy = qy * warpScale;
			const sz = qz * warpScale;
			const offsetX = this.generate3D(sx, sy, sz);
			const offsetY = this.generate3D(sx + 5.2, sy + 1.3, sz + 9.7);
			const offsetZ = this.generate3D(sx + 2.9, sy + 7.1, sz + 3.4);
			qx += offsetX * warpStrength;
			qy += offsetY * warpStrength;
			qz += offsetZ * warpStrength;
		}
		out[0] = qx;
		out[1] = qy;
		out[2] = qz;
		return out;
	};

	/* ------------------------------------------------------ [0, 1] variants */

	ForgeNoise.prototype.generate1D01 = function(x) {
		return (this.generate1D(x) + 1) * 0.5;
	};
	ForgeNoise.prototype.generateSimplex1D01 = function(x) {
		return (this.generateSimplex1D(x) + 1) * 0.5;
	};
	ForgeNoise.prototype.generateValue1D01 = function(x) {
		return this.generateValue1D(x);
	};
	ForgeNoise.prototype.generate2D01 = function(x, y) {
		return (this.generate2D(x, y) + 1) * 0.5;
	};
	ForgeNoise.prototype.generate3D01 = function(x, y, z) {
		return (this.generate3D(x, y, z) + 1) * 0.5;
	};
	ForgeNoise.prototype.generateSimplex2D01 = function(x, y) {
		return (this.generateSimplex2D(x, y) + 1) * 0.5;
	};
	ForgeNoise.prototype.generateSimplex3D01 = function(x, y, z) {
		return (this.generateSimplex3D(x, y, z) + 1) * 0.5;
	};
	ForgeNoise.prototype.generateValue2D01 = function(x, y) {
		return this.generateValue2D(x, y);
	};
	ForgeNoise.prototype.generateValue3D01 = function(x, y, z) {
		return this.generateValue3D(x, y, z);
	};
	ForgeNoise.prototype.generateWorley2D01 = function(x, y) {
		return this.generateWorley2D(x, y) * INV_SQRT2;
	};
	ForgeNoise.prototype.generateWorley3D01 = function(x, y, z) {
		return this.generateWorley3D(x, y, z) * INV_SQRT3;
	};
	ForgeNoise.prototype.generate4D01 = function(x, y, z, w) {
		return (this.generate4D(x, y, z, w) + 1) * 0.5;
	};
	ForgeNoise.prototype.generateSimplex4D01 = function(x, y, z, w) {
		return (this.generateSimplex4D(x, y, z, w) + 1) * 0.5;
	};
	ForgeNoise.prototype.generateTiling2D01 = function(x, y, options) {
		return (this.generateTiling2D(x, y, options) + 1) * 0.5;
	};
	ForgeNoise.prototype.generateTiling3D01 = function(x, y, z, options) {
		return (this.generateTiling3D(x, y, z, options) + 1) * 0.5;
	};
	ForgeNoise.prototype.generateTilingSimplex2D01 = function(x, y, options) {
		return (this.generateTilingSimplex2D(x, y, options) + 1) * 0.5;
	};

	/* ------------------------------------------------------------------------------------------------
	 * OpenSimplex2 (F = "fast", S = "smooth"), 2D / 3D / 4D.
	 *
	 * Ported from KdotJPG's reference implementation (https://github.com/KdotJPG/OpenSimplex2, CC0): same lattices,
	 * same kernels, same falloff radii, same gradient sets and normalizers. Two deliberate differences:
	 *   - hashing: the reference hashes lattice coordinates with 64-bit prime multiplication; here they go through
	 *     the instance's permutation table like every other kernel in this library, so noise.seed / reseed() work
	 *     the same way and a fixed seed reproduces across platforms. (Like the others it wraps every 256 lattice cells; the
	 *     lattices are skewed/rotated relative to world axes, so that is not 256 units along x, y, z or w.)
	 *     The second BCC lattice (3D) and the five lattice copies (4D F) get decorrelated by offsetting one coordinate
	 *     inside the permutation chain.
	 *   - arithmetic is double precision instead of float.
	 * Verified against the reference compiled with the same hash substituted in (see test/reference/README.md).
	 *
	 * Outputs are roughly in [-1, 1].
	 *
	 * Methods (F and S): generateOpenSimplex2{F,S}_2D / _2D_ImproveX, _3D (= ImproveXY) / _3D_ImproveXZ / _3D_Fallback,
	 * _4D (= ImproveXYZ_ImproveXY) / _4D_ImproveXYZ_ImproveXZ / _4D_ImproveXYZ / _4D_ImproveXY_ImproveZW / _4D_Fallback.
	 * Orientation: for 3D, "ImproveXY" is best when Z is the odd one out (time, or vertical); "ImproveXZ" when Y is.
	 * ------------------------------------------------------------------------------------------------ */

	// Base gradient sets shared by OpenSimplex2F and 2S (taken verbatim from the reference). Replicated to 256 entries and
	// divided by each variant's normalizer at load time, so the hash value p[...] (0..255) indexes them directly.
	const OS_BASE_GRAD2 = [
		0.38268343236509, 0.923879532511287, 0.923879532511287, 0.38268343236509, 0.923879532511287, -0.38268343236509,
		0.38268343236509, -0.923879532511287, -0.38268343236509, -0.923879532511287, -0.923879532511287, -0.38268343236509,
		-0.923879532511287, 0.38268343236509, -0.38268343236509, 0.923879532511287, 0.130526192220052, 0.99144486137381,
		0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721, 0.99144486137381, 0.130526192220051,
		0.99144486137381, -0.130526192220051, 0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235,
		0.130526192220052, -0.99144486137381, -0.130526192220052, -0.99144486137381, -0.608761429008721, -0.793353340291235,
		-0.793353340291235, -0.608761429008721, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051,
		-0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.130526192220052, 0.99144486137381
	];
	const OS_BASE_GRAD3 = [
		2.22474487139, 2.22474487139, -1, 0, 2.22474487139, 2.22474487139, 1, 0,
		3.0862664687972017, 1.1721513422464978, 0, 0, 1.1721513422464978, 3.0862664687972017, 0, 0,
		-2.22474487139, 2.22474487139, -1, 0, -2.22474487139, 2.22474487139, 1, 0,
		-1.1721513422464978, 3.0862664687972017, 0, 0, -3.0862664687972017, 1.1721513422464978, 0, 0,
		-1, -2.22474487139, -2.22474487139, 0, 1, -2.22474487139, -2.22474487139, 0,
		0, -3.0862664687972017, -1.1721513422464978, 0, 0, -1.1721513422464978, -3.0862664687972017, 0,
		-1, -2.22474487139, 2.22474487139, 0, 1, -2.22474487139, 2.22474487139, 0,
		0, -1.1721513422464978, 3.0862664687972017, 0, 0, -3.0862664687972017, 1.1721513422464978, 0,
		-2.22474487139, -2.22474487139, -1, 0, -2.22474487139, -2.22474487139, 1, 0,
		-3.0862664687972017, -1.1721513422464978, 0, 0, -1.1721513422464978, -3.0862664687972017, 0, 0,
		-2.22474487139, -1, -2.22474487139, 0, -2.22474487139, 1, -2.22474487139, 0,
		-1.1721513422464978, 0, -3.0862664687972017, 0, -3.0862664687972017, 0, -1.1721513422464978, 0,
		-2.22474487139, -1, 2.22474487139, 0, -2.22474487139, 1, 2.22474487139, 0,
		-3.0862664687972017, 0, 1.1721513422464978, 0, -1.1721513422464978, 0, 3.0862664687972017, 0,
		-1, 2.22474487139, -2.22474487139, 0, 1, 2.22474487139, -2.22474487139, 0,
		0, 1.1721513422464978, -3.0862664687972017, 0, 0, 3.0862664687972017, -1.1721513422464978, 0,
		-1, 2.22474487139, 2.22474487139, 0, 1, 2.22474487139, 2.22474487139, 0,
		0, 3.0862664687972017, 1.1721513422464978, 0, 0, 1.1721513422464978, 3.0862664687972017, 0,
		2.22474487139, -2.22474487139, -1, 0, 2.22474487139, -2.22474487139, 1, 0,
		1.1721513422464978, -3.0862664687972017, 0, 0, 3.0862664687972017, -1.1721513422464978, 0, 0,
		2.22474487139, -1, -2.22474487139, 0, 2.22474487139, 1, -2.22474487139, 0,
		3.0862664687972017, 0, -1.1721513422464978, 0, 1.1721513422464978, 0, -3.0862664687972017, 0,
		2.22474487139, -1, 2.22474487139, 0, 2.22474487139, 1, 2.22474487139, 0,
		1.1721513422464978, 0, 3.0862664687972017, 0, 3.0862664687972017, 0, 1.1721513422464978, 0
	];
	const OS_BASE_GRAD4 = [
		-0.6740059517812944, -0.3239847771997537, -0.3239847771997537, 0.5794684678643381, -0.7504883828755602, -0.4004672082940195, 0.15296486218853164, 0.5029860367700724,
		-0.7504883828755602, 0.15296486218853164, -0.4004672082940195, 0.5029860367700724, -0.8828161875373585, 0.08164729285680945, 0.08164729285680945, 0.4553054119602712,
		-0.4553054119602712, -0.08164729285680945, -0.08164729285680945, 0.8828161875373585, -0.5029860367700724, -0.15296486218853164, 0.4004672082940195, 0.7504883828755602,
		-0.5029860367700724, 0.4004672082940195, -0.15296486218853164, 0.7504883828755602, -0.5794684678643381, 0.3239847771997537, 0.3239847771997537, 0.6740059517812944,
		-0.6740059517812944, -0.3239847771997537, 0.5794684678643381, -0.3239847771997537, -0.7504883828755602, -0.4004672082940195, 0.5029860367700724, 0.15296486218853164,
		-0.7504883828755602, 0.15296486218853164, 0.5029860367700724, -0.4004672082940195, -0.8828161875373585, 0.08164729285680945, 0.4553054119602712, 0.08164729285680945,
		-0.4553054119602712, -0.08164729285680945, 0.8828161875373585, -0.08164729285680945, -0.5029860367700724, -0.15296486218853164, 0.7504883828755602, 0.4004672082940195,
		-0.5029860367700724, 0.4004672082940195, 0.7504883828755602, -0.15296486218853164, -0.5794684678643381, 0.3239847771997537, 0.6740059517812944, 0.3239847771997537,
		-0.6740059517812944, 0.5794684678643381, -0.3239847771997537, -0.3239847771997537, -0.7504883828755602, 0.5029860367700724, -0.4004672082940195, 0.15296486218853164,
		-0.7504883828755602, 0.5029860367700724, 0.15296486218853164, -0.4004672082940195, -0.8828161875373585, 0.4553054119602712, 0.08164729285680945, 0.08164729285680945,
		-0.4553054119602712, 0.8828161875373585, -0.08164729285680945, -0.08164729285680945, -0.5029860367700724, 0.7504883828755602, -0.15296486218853164, 0.4004672082940195,
		-0.5029860367700724, 0.7504883828755602, 0.4004672082940195, -0.15296486218853164, -0.5794684678643381, 0.6740059517812944, 0.3239847771997537, 0.3239847771997537,
		0.5794684678643381, -0.6740059517812944, -0.3239847771997537, -0.3239847771997537, 0.5029860367700724, -0.7504883828755602, -0.4004672082940195, 0.15296486218853164,
		0.5029860367700724, -0.7504883828755602, 0.15296486218853164, -0.4004672082940195, 0.4553054119602712, -0.8828161875373585, 0.08164729285680945, 0.08164729285680945,
		0.8828161875373585, -0.4553054119602712, -0.08164729285680945, -0.08164729285680945, 0.7504883828755602, -0.5029860367700724, -0.15296486218853164, 0.4004672082940195,
		0.7504883828755602, -0.5029860367700724, 0.4004672082940195, -0.15296486218853164, 0.6740059517812944, -0.5794684678643381, 0.3239847771997537, 0.3239847771997537,
		-0.753341017856078, -0.37968289875261624, -0.37968289875261624, -0.37968289875261624, -0.7821684431180708, -0.4321472685365301, -0.4321472685365301, 0.12128480194602098,
		-0.7821684431180708, -0.4321472685365301, 0.12128480194602098, -0.4321472685365301, -0.7821684431180708, 0.12128480194602098, -0.4321472685365301, -0.4321472685365301,
		-0.8586508742123365, -0.508629699630796, 0.044802370851755174, 0.044802370851755174, -0.8586508742123365, 0.044802370851755174, -0.508629699630796, 0.044802370851755174,
		-0.8586508742123365, 0.044802370851755174, 0.044802370851755174, -0.508629699630796, -0.9982828964265062, -0.03381941603233842, -0.03381941603233842, -0.03381941603233842,
		-0.37968289875261624, -0.753341017856078, -0.37968289875261624, -0.37968289875261624, -0.4321472685365301, -0.7821684431180708, -0.4321472685365301, 0.12128480194602098,
		-0.4321472685365301, -0.7821684431180708, 0.12128480194602098, -0.4321472685365301, 0.12128480194602098, -0.7821684431180708, -0.4321472685365301, -0.4321472685365301,
		-0.508629699630796, -0.8586508742123365, 0.044802370851755174, 0.044802370851755174, 0.044802370851755174, -0.8586508742123365, -0.508629699630796, 0.044802370851755174,
		0.044802370851755174, -0.8586508742123365, 0.044802370851755174, -0.508629699630796, -0.03381941603233842, -0.9982828964265062, -0.03381941603233842, -0.03381941603233842,
		-0.37968289875261624, -0.37968289875261624, -0.753341017856078, -0.37968289875261624, -0.4321472685365301, -0.4321472685365301, -0.7821684431180708, 0.12128480194602098,
		-0.4321472685365301, 0.12128480194602098, -0.7821684431180708, -0.4321472685365301, 0.12128480194602098, -0.4321472685365301, -0.7821684431180708, -0.4321472685365301,
		-0.508629699630796, 0.044802370851755174, -0.8586508742123365, 0.044802370851755174, 0.044802370851755174, -0.508629699630796, -0.8586508742123365, 0.044802370851755174,
		0.044802370851755174, 0.044802370851755174, -0.8586508742123365, -0.508629699630796, -0.03381941603233842, -0.03381941603233842, -0.9982828964265062, -0.03381941603233842,
		-0.37968289875261624, -0.37968289875261624, -0.37968289875261624, -0.753341017856078, -0.4321472685365301, -0.4321472685365301, 0.12128480194602098, -0.7821684431180708,
		-0.4321472685365301, 0.12128480194602098, -0.4321472685365301, -0.7821684431180708, 0.12128480194602098, -0.4321472685365301, -0.4321472685365301, -0.7821684431180708,
		-0.508629699630796, 0.044802370851755174, 0.044802370851755174, -0.8586508742123365, 0.044802370851755174, -0.508629699630796, 0.044802370851755174, -0.8586508742123365,
		0.044802370851755174, 0.044802370851755174, -0.508629699630796, -0.8586508742123365, -0.03381941603233842, -0.03381941603233842, -0.03381941603233842, -0.9982828964265062,
		-0.3239847771997537, -0.6740059517812944, -0.3239847771997537, 0.5794684678643381, -0.4004672082940195, -0.7504883828755602, 0.15296486218853164, 0.5029860367700724,
		0.15296486218853164, -0.7504883828755602, -0.4004672082940195, 0.5029860367700724, 0.08164729285680945, -0.8828161875373585, 0.08164729285680945, 0.4553054119602712,
		-0.08164729285680945, -0.4553054119602712, -0.08164729285680945, 0.8828161875373585, -0.15296486218853164, -0.5029860367700724, 0.4004672082940195, 0.7504883828755602,
		0.4004672082940195, -0.5029860367700724, -0.15296486218853164, 0.7504883828755602, 0.3239847771997537, -0.5794684678643381, 0.3239847771997537, 0.6740059517812944,
		-0.3239847771997537, -0.3239847771997537, -0.6740059517812944, 0.5794684678643381, -0.4004672082940195, 0.15296486218853164, -0.7504883828755602, 0.5029860367700724,
		0.15296486218853164, -0.4004672082940195, -0.7504883828755602, 0.5029860367700724, 0.08164729285680945, 0.08164729285680945, -0.8828161875373585, 0.4553054119602712,
		-0.08164729285680945, -0.08164729285680945, -0.4553054119602712, 0.8828161875373585, -0.15296486218853164, 0.4004672082940195, -0.5029860367700724, 0.7504883828755602,
		0.4004672082940195, -0.15296486218853164, -0.5029860367700724, 0.7504883828755602, 0.3239847771997537, 0.3239847771997537, -0.5794684678643381, 0.6740059517812944,
		-0.3239847771997537, -0.6740059517812944, 0.5794684678643381, -0.3239847771997537, -0.4004672082940195, -0.7504883828755602, 0.5029860367700724, 0.15296486218853164,
		0.15296486218853164, -0.7504883828755602, 0.5029860367700724, -0.4004672082940195, 0.08164729285680945, -0.8828161875373585, 0.4553054119602712, 0.08164729285680945,
		-0.08164729285680945, -0.4553054119602712, 0.8828161875373585, -0.08164729285680945, -0.15296486218853164, -0.5029860367700724, 0.7504883828755602, 0.4004672082940195,
		0.4004672082940195, -0.5029860367700724, 0.7504883828755602, -0.15296486218853164, 0.3239847771997537, -0.5794684678643381, 0.6740059517812944, 0.3239847771997537,
		-0.3239847771997537, -0.3239847771997537, 0.5794684678643381, -0.6740059517812944, -0.4004672082940195, 0.15296486218853164, 0.5029860367700724, -0.7504883828755602,
		0.15296486218853164, -0.4004672082940195, 0.5029860367700724, -0.7504883828755602, 0.08164729285680945, 0.08164729285680945, 0.4553054119602712, -0.8828161875373585,
		-0.08164729285680945, -0.08164729285680945, 0.8828161875373585, -0.4553054119602712, -0.15296486218853164, 0.4004672082940195, 0.7504883828755602, -0.5029860367700724,
		0.4004672082940195, -0.15296486218853164, 0.7504883828755602, -0.5029860367700724, 0.3239847771997537, 0.3239847771997537, 0.6740059517812944, -0.5794684678643381,
		-0.3239847771997537, 0.5794684678643381, -0.6740059517812944, -0.3239847771997537, -0.4004672082940195, 0.5029860367700724, -0.7504883828755602, 0.15296486218853164,
		0.15296486218853164, 0.5029860367700724, -0.7504883828755602, -0.4004672082940195, 0.08164729285680945, 0.4553054119602712, -0.8828161875373585, 0.08164729285680945,
		-0.08164729285680945, 0.8828161875373585, -0.4553054119602712, -0.08164729285680945, -0.15296486218853164, 0.7504883828755602, -0.5029860367700724, 0.4004672082940195,
		0.4004672082940195, 0.7504883828755602, -0.5029860367700724, -0.15296486218853164, 0.3239847771997537, 0.6740059517812944, -0.5794684678643381, 0.3239847771997537,
		-0.3239847771997537, 0.5794684678643381, -0.3239847771997537, -0.6740059517812944, -0.4004672082940195, 0.5029860367700724, 0.15296486218853164, -0.7504883828755602,
		0.15296486218853164, 0.5029860367700724, -0.4004672082940195, -0.7504883828755602, 0.08164729285680945, 0.4553054119602712, 0.08164729285680945, -0.8828161875373585,
		-0.08164729285680945, 0.8828161875373585, -0.08164729285680945, -0.4553054119602712, -0.15296486218853164, 0.7504883828755602, 0.4004672082940195, -0.5029860367700724,
		0.4004672082940195, 0.7504883828755602, -0.15296486218853164, -0.5029860367700724, 0.3239847771997537, 0.6740059517812944, 0.3239847771997537, -0.5794684678643381,
		0.5794684678643381, -0.3239847771997537, -0.6740059517812944, -0.3239847771997537, 0.5029860367700724, -0.4004672082940195, -0.7504883828755602, 0.15296486218853164,
		0.5029860367700724, 0.15296486218853164, -0.7504883828755602, -0.4004672082940195, 0.4553054119602712, 0.08164729285680945, -0.8828161875373585, 0.08164729285680945,
		0.8828161875373585, -0.08164729285680945, -0.4553054119602712, -0.08164729285680945, 0.7504883828755602, -0.15296486218853164, -0.5029860367700724, 0.4004672082940195,
		0.7504883828755602, 0.4004672082940195, -0.5029860367700724, -0.15296486218853164, 0.6740059517812944, 0.3239847771997537, -0.5794684678643381, 0.3239847771997537,
		0.5794684678643381, -0.3239847771997537, -0.3239847771997537, -0.6740059517812944, 0.5029860367700724, -0.4004672082940195, 0.15296486218853164, -0.7504883828755602,
		0.5029860367700724, 0.15296486218853164, -0.4004672082940195, -0.7504883828755602, 0.4553054119602712, 0.08164729285680945, 0.08164729285680945, -0.8828161875373585,
		0.8828161875373585, -0.08164729285680945, -0.08164729285680945, -0.4553054119602712, 0.7504883828755602, -0.15296486218853164, 0.4004672082940195, -0.5029860367700724,
		0.7504883828755602, 0.4004672082940195, -0.15296486218853164, -0.5029860367700724, 0.6740059517812944, 0.3239847771997537, 0.3239847771997537, -0.5794684678643381,
		0.03381941603233842, 0.03381941603233842, 0.03381941603233842, 0.9982828964265062, -0.044802370851755174, -0.044802370851755174, 0.508629699630796, 0.8586508742123365,
		-0.044802370851755174, 0.508629699630796, -0.044802370851755174, 0.8586508742123365, -0.12128480194602098, 0.4321472685365301, 0.4321472685365301, 0.7821684431180708,
		0.508629699630796, -0.044802370851755174, -0.044802370851755174, 0.8586508742123365, 0.4321472685365301, -0.12128480194602098, 0.4321472685365301, 0.7821684431180708,
		0.4321472685365301, 0.4321472685365301, -0.12128480194602098, 0.7821684431180708, 0.37968289875261624, 0.37968289875261624, 0.37968289875261624, 0.753341017856078,
		0.03381941603233842, 0.03381941603233842, 0.9982828964265062, 0.03381941603233842, -0.044802370851755174, 0.044802370851755174, 0.8586508742123365, 0.508629699630796,
		-0.044802370851755174, 0.508629699630796, 0.8586508742123365, -0.044802370851755174, -0.12128480194602098, 0.4321472685365301, 0.7821684431180708, 0.4321472685365301,
		0.508629699630796, -0.044802370851755174, 0.8586508742123365, -0.044802370851755174, 0.4321472685365301, -0.12128480194602098, 0.7821684431180708, 0.4321472685365301,
		0.4321472685365301, 0.4321472685365301, 0.7821684431180708, -0.12128480194602098, 0.37968289875261624, 0.37968289875261624, 0.753341017856078, 0.37968289875261624,
		0.03381941603233842, 0.9982828964265062, 0.03381941603233842, 0.03381941603233842, -0.044802370851755174, 0.8586508742123365, -0.044802370851755174, 0.508629699630796,
		-0.044802370851755174, 0.8586508742123365, 0.508629699630796, -0.044802370851755174, -0.12128480194602098, 0.7821684431180708, 0.4321472685365301, 0.4321472685365301,
		0.508629699630796, 0.8586508742123365, -0.044802370851755174, -0.044802370851755174, 0.4321472685365301, 0.7821684431180708, -0.12128480194602098, 0.4321472685365301,
		0.4321472685365301, 0.7821684431180708, 0.4321472685365301, -0.12128480194602098, 0.37968289875261624, 0.753341017856078, 0.37968289875261624, 0.37968289875261624,
		0.9982828964265062, 0.03381941603233842, 0.03381941603233842, 0.03381941603233842, 0.8586508742123365, -0.044802370851755174, -0.044802370851755174, 0.508629699630796,
		0.8586508742123365, -0.044802370851755174, 0.508629699630796, -0.044802370851755174, 0.7821684431180708, -0.12128480194602098, 0.4321472685365301, 0.4321472685365301,
		0.8586508742123365, 0.508629699630796, -0.044802370851755174, -0.044802370851755174, 0.7821684431180708, 0.4321472685365301, -0.12128480194602098, 0.4321472685365301,
		0.7821684431180708, 0.4321472685365301, 0.4321472685365301, -0.12128480194602098, 0.753341017856078, 0.37968289875261624, 0.37968289875261624, 0.37968289875261624
	];
	// OpenSimplex2S 4D: for each of the 256 cells of a 4x4x4x4 partition of the unit cell, the lattice vertices that can reach it
	// (one byte per vertex: 2 bits per axis holding offset + 1). OS_LOOKUP_4D_LENGTHS has the vertex count per cell.
	const OS_LOOKUP_4D_LENGTHS = [20,15,16,17,15,16,12,15,16,12,10,14,17,15,14,17,15,16,12,15,16,14,14,13,12,14,11,12,15,13,12,14,16,12,10,14,12,14,11,12,10,11,10,13,14,12,13,15,17,15,14,17,15,13,12,14,14,12,13,15,17,14,15,17,15,16,12,15,16,14,14,13,12,14,11,12,15,13,12,14,16,14,14,13,14,16,16,10,14,16,19,11,13,10,11,10,12,14,11,12,14,16,19,11,11,19,13,14,12,11,14,13,15,13,12,14,13,10,11,10,12,11,14,13,14,10,13,13,16,12,10,14,12,14,11,12,10,11,10,13,14,12,13,15,12,14,11,12,14,16,19,11,11,19,13,14,12,11,14,13,10,11,10,13,11,19,13,14,10,13,16,14,13,14,14,16,14,12,13,15,12,11,14,13,13,14,14,16,15,13,16,15,17,15,14,17,15,13,12,14,14,12,13,15,17,14,15,17,15,13,12,14,13,10,11,10,12,11,14,13,14,10,13,13,14,12,13,15,12,11,14,13,13,14,14,16,15,13,16,15,17,14,15,17,14,10,13,13,15,13,16,15,17,13,15,20];
	const OS_LOOKUP_4D_CODES = "154551545556595a6566696a9596999aa5a6a9aa1545515556595a65666a95969aa6aa0105111541455155565a666a969aa6aa0115164546515255565a666a969aa6aaab1545545556595a65696a95999aa9aa0515455556595a6566696a9596999aaa0515455556595a666a969aaa05151645465556595a666a969aaaab0405141544455455595a696a999aa9aa0515455556595a696a999aaa0515455556595a6a9aaa05151645465556595a5b6a9aaaab0415194549545558595a696a999aa9aaae05151945495556595a696a999aaaae05151945495556595a5e6a9aaaae05151a454a5556595a5b5e6a9aaaabaeaf1551545556596566696a95a5a6a9aa1115515556595a6566696a9596a5a6aa11155155565a65666a96a6aa111516515255565a65666a96a6aaab1415545556595a6566696a9599a5a9aa155556595a6566696a959aa6a9aa155556595a6566696a969aa6aaab151655565a666a6b969aa6aaab14155455595a65696a99a9aa155556595a6566696a999aa9aaae155556595a6566696a9aaa15165556595a666a6b9aaaab141519545558595a65696a99a9aaae151955595a696a6e999aa9aaae15195556595a696a6e9aaaae151a5556595a6a6b6e9aaaabaeaf10111415505154556566696aa5a6a9aa11155155566566696aa5a6aa111551555665666aa6aa111516515255566566676aa6aaab14155455596566696aa5a9aa155556595a6566696aa5a6a9aaba155556595a6566696aa6aa151655565a65666a6ba6aaab141554555965696aa9aa155556595a6566696aa9aa155556595a6566696aaa15165556595a6566696a6baaab1415195455585965696a6da9aaae151955595a65696a6ea9aaae15195556595a6566696a6eaaae155556595a66696a6b6e9aaaabaeaf10152551545561646566696aa5a6a9aaba111525515556616566696aa5a6aaba1115255155566165666a76a6aaba111526515556626566676a76a6aaabbabb141525545559646566696aa5a9aaba1525556566696a7aa5a6a9aaba152555566566696a7aa6aaba1526555665666a6b7aa6aaabbabb1415255455596465696a79a9aaba152555596566696a7aa9aaba15255556595a6566696a7aaaba1555565a6566696a6b7aa6aaabbabb1415295455596568696a6d79a9aaaebabe1529555965696a6e7aa9aaaebabe1555595a6566696a6e7aa9aaaebabe155556595a6566696a6b6e7aaaabaebabf455154555659659596999aa5a6a9aa4145515556595a65669596999aa5a6aa41455155565a6695969aa6aa414546515255565a6695969aa6aaab4445545556595a65699596999aa5a9aa455556595a656a9596999aa6a9aa455556595a666a9596999aa6aaab454655565a666a969a9ba6aaab44455455595a6995999aa9aa455556595a696a9596999aa9aaae455556595a6a9596999aaa45465556595a6a969a9baaab444549545558595a6995999aa9aaae454955595a696a999a9ea9aaae45495556595a6a999a9eaaae454a5556595a6a9a9b9eaaabaeaf505154555659656669959699a5a6a9aa5155565965666a95969aa5a6a9aa5155565a65666a95969aa5a6aaab515255565a666a969aa6a7aaab5455565965696a95999aa5a6a9aa5556595a6566696a9596999aa5a6a9aa1545515556595a65666a95969aa6aaab55565a666a969aa6aaab5455595a65696a95999aa5a9aaae1545545556595a65696a95999aa9aaae15455556595a6566696a9596999aa6a9aaabae5556595a666a969aa6aaab545558595a696a999aa9aaadae55595a696a999aa9aaae5556595a696a999aa9aaae5556595a6a9aaaabaeaf5051545565666995a5a6a9aa5155566566696a9596a5a6a9aaba51555665666a9596a5a6aa5152555665666a96a6a7aaab5455596566696a9599a5a6a9aaba1551545556596566696a95a5a6a9aaba15515556595a6566696a95969aa5a6a9aaabba55565a65666a969aa6aaab54555965696a9599a5a9aa15545556595a6566696a95999aa5a6a9aaaeba155556595a6566696a9aa6a9aa155556595a6566696a969aa6aaab5455585965696a99a9aaadae55595a65696a999aa9aaae155556595a6566696a999aa9aaae155556595a66696a9aaaabaeaf50515455616465666995a5a6a9aaba5155616566696aa5a6a9aab6ba5155566165666aa5a6aab6ba5155566265666aa6a7aaabb6babb5455646566696aa5a6a9aab9ba556566696aa5a6a9aaba55566566696aa5a6a9aaba555665666aa6aaabbabb5455596465696aa5a9aab9ba55596566696aa5a6a9aaba155556595a6566696aa5a6a9aaba1555565a6566696aa6aaabbabb5455596568696aa9aaadaeb9babe555965696aa9aaaebabe1555595a6566696aa9aaaebabe5556595a6566696aaaabaebabf40414445505154559596999aa5a6a9aa41455155569596999aa5a6aa414551555695969aa6aa414546515255569596979aa6aaab44455455599596999aa5a9aa455556595a9596999aa5a6a9aaea455556595a9596999aa6aa454655565a95969a9ba6aaab444554555995999aa9aa455556595a9596999aa9aa455556595a9596999aaa45465556595a9596999a9baaab4445495455585995999a9da9aaae454955595a95999a9ea9aaae45495556595a9596999a9eaaae455556595a6a96999a9b9eaaabaeaf5051545565959699a5a6a9aa51555665669596999aa5a6a9aaea515556656695969aa5a6aa515255566695969aa6a7aaab54555965699596999aa5a6a9aaea455154555659659596999aa5a6a9aaea45515556595a65666a9596999aa5a6a9aaabea55565a666a95969aa6aaab545559656995999aa5a9aa45545556595a65696a9596999aa5a6a9aaaeea455556595a6a9596999aa6a9aa455556595a666a9596999aa6aaab545558596995999aa9aaadae55595a696a95999aa9aaae455556595a696a9596999aa9aaae455556595a6a96999aaaabaeaf505154556595a5a6a9aa51555665669596a5a6a9aa51555665669596a5a6aa5152555665669596a5a6a7aaab54555965699599a5a6a9aa51545556596566696a9596999aa5a6a9aabaea51555665666a95969aa5a6a9aa5155565a65666a95969aa5a6aaab54555965699599a5a9aa54555965696a95999aa5a6a9aa5556595a6566696a9596999aa5a6a9aa5556595a65666a95969aa6a9aaab5455585965699599a5a9aaadae5455595a65696a95999aa5a9aaae5556595a65696a95999aa6a9aaae5556595a66696a96999aa6a9aaabaeaf5051545561646595a5a6a9aab5ba515561656695a5a6a9aab6ba5155566165669596a5a6aab6ba51555665666a96a5a6a7aaabb6babb545564656995a5a6a9aab9ba556566696a95a5a6a9aaba5155566566696a9596a5a6a9aaba51555665666a96a5a6aaabbabb5455596465699599a5a9aab9ba5455596566696a9599a5a6a9aaba5556596566696a959aa5a6a9aaba55565a6566696a969aa5a6a9aaabbabb54555965696a99a5a9aaadaeb9babe54555965696a99a5a9aaaebabe55595a6566696a999aa5a6a9aaaebabe5556595a6566696a9aa6a9aaabaeba40455154558591949596999aa5a6a9aaea414551555685919596999aa5a6aaea4145515556859195969aa6aad6ea414551555686929596979aa6aaabd6eaeb444554555985949596999aa5a9aaea4555859596999aa5a6a9aadaea455556859596999aa6aadaea4555568695969a9ba6aaabdaeaeb4445545559859495999aa9aad9ea455559859596999aa9aadaea455556595a859596999aaadaea4555565a9596999a9ba6aaabdaeaeb4445545559899598999a9da9aaaed9eaee4555598995999a9ea9aaaedaeaee4555595a9596999a9ea9aaaedaeaee455556595a9596999a9b9eaaabaedaeaef50515455659194959699a5a6a9aaea5155919596999aa5a6a9aae6ea5155569195969aa5a6aae6ea5155569295969aa6a7aaabe6eaeb5455949596999aa5a6a9aae9ea559596999aa5a6a9aaea55569596999aa5a6a9aaea555695969aa6aaabeaeb5455599495999aa5a9aae9ea55599596999aa5a6a9aaea455556595a9596999aa5a6a9aaea4555565a9596999aa6aaabeaeb5455599598999aa9aaadaee9eaee555995999aa9aaaeeaee4555595a9596999aa9aaaeeaee5556595a9596999aaaabaeeaef5051545565919495a5a6a9aae5ea515565919596a5a6a9aae6ea5155566566919596a5a6aae6ea5155566695969aa5a6a7aaabe6eaeb545565949599a5a6a9aae9ea55659596999aa5a6a9aaea51555665669596999aa5a6a9aaea5155566695969aa5a6aaabeaeb5455596569949599a5a9aae9ea54555965699596999aa5a6a9aaea555659656a9596999aa5a6a9aaea55565a666a9596999aa5a6a9aaabeaeb5455596995999aa5a9aaadaee9eaee5455596995999aa5a9aaaeeaee55595a696a9596999aa5a6a9aaaeeaee5556595a6a9596999aa6a9aaabaeea505154556595a1a4a5a6a9aab5bae5eafa51556595a1a5a6a9aab6bae6eafa515565669596a5a6a9aab6bae6eafa51555665669596a5a6a7aaabb6bae6eafb54556595a4a5a6a9aab9bae9eafa556595a5a6a9aabaeafa515565669596a5a6a9aabaeafa555665669596a5a6aaabbaeafb545565699599a5a6a9aab9bae9eafa545565699599a5a6a9aabaeafa556566696a9596999aa5a6a9aabaeafa555665666a95969aa5a6a9aaabbaea54555965699599a5a9aaadaeb9bae9eafe555965699599a5a9aaaebaeafe555965696a95999aa5a6a9aaaebaea5556595a6566696a9596999aa5a6a9aaabaebaea";

	const OS_UNSKEW_2D = -0.21132486540518713;
	const OS_SKEW_2D = 0.366025403784439;
	const OS_ROOT2OVER2 = 0.7071067811865476;
	const OS_ROOT3OVER3 = 0.577350269189626;
	const OS_FALLBACK_ROTATE_3D = 2.0 / 3.0;
	const OS_SECOND_LATTICE = 128;   // hash offset standing in for the reference's seed flip (3D second lattice)
	const OS_LATTICE_COPY_STEP = 51; // hash offset per lattice copy in 4D F (5 copies * 51 < 256, all distinct)

	function osBuildGrads(base, stride, normalizer) {
		const n = base.length / stride;
		const out = new Float64Array(256 * stride);
		for (let i = 0; i < 256; i++) {
			const src = (i % n) * stride;
			for (let k = 0; k < stride; k++) out[i * stride + k] = base[src + k] / normalizer;
		}
		return out;
	}
	// Normalizers are the reference's: they scale the gradients so the output spans [-1, 1].
	const OS_F_GRAD2 = osBuildGrads(OS_BASE_GRAD2, 2, 0.01001634121365712);
	const OS_F_GRAD3 = osBuildGrads(OS_BASE_GRAD3, 4, 0.07969837668935331);
	const OS_F_GRAD4 = osBuildGrads(OS_BASE_GRAD4, 4, 0.0220065933241897);
	const OS_S_GRAD2 = osBuildGrads(OS_BASE_GRAD2, 2, 0.05481866495625118);
	const OS_S_GRAD3 = osBuildGrads(OS_BASE_GRAD3, 4, 0.2781926117527186);
	const OS_S_GRAD4 = osBuildGrads(OS_BASE_GRAD4, 4, 0.11127401889945551);

	// OpenSimplex2S 4D lattice vertex tables, decoded from the data above.
	const OS_S4_START = new Uint16Array(257);
	const OS_S4_VX = new Int8Array(3476), OS_S4_VY = new Int8Array(3476), OS_S4_VZ = new Int8Array(3476), OS_S4_VW = new Int8Array(3476);
	const OS_S4_DX = new Float64Array(3476), OS_S4_DY = new Float64Array(3476), OS_S4_DZ = new Float64Array(3476), OS_S4_DW = new Float64Array(3476);
	(function() {
		const UNSKEW_4D = -0.138196601125011;
		let j = 0;
		for (let i = 0; i < 256; i++) {
			OS_S4_START[i] = j;
			for (let k = 0; k < OS_LOOKUP_4D_LENGTHS[i]; k++, j++) {
				const code = parseInt(OS_LOOKUP_4D_CODES.substr(2 * j, 2), 16);
				const x = ((code >> 0) & 3) - 1, y = ((code >> 2) & 3) - 1, z = ((code >> 4) & 3) - 1, w = ((code >> 6) & 3) - 1;
				const ssv = (x + y + z + w) * UNSKEW_4D;
				OS_S4_VX[j] = x; OS_S4_VY[j] = y; OS_S4_VZ[j] = z; OS_S4_VW[j] = w;
				OS_S4_DX[j] = -x - ssv; OS_S4_DY[j] = -y - ssv; OS_S4_DZ[j] = -z - ssv; OS_S4_DW[j] = -w - ssv;
			}
		}
		OS_S4_START[256] = j;
	})();

	// Gradient lookups: hash = permutation chain over the raw lattice coordinates (p is 4x-replicated, so the
	// partial sums need no masking). `off` is added to the last coordinate to decorrelate lattice copies.
	function osGrad2(p, G, xb, yb, dx, dy) {
		const gi = p[(xb & 255) + p[yb & 255]] << 1;
		return G[gi] * dx + G[gi + 1] * dy;
	}
	function osGrad3(p, G, xb, yb, zb, off, dx, dy, dz) {
		const gi = p[(xb & 255) + p[(yb & 255) + p[(zb + off) & 255]]] << 2;
		return G[gi] * dx + G[gi + 1] * dy + G[gi + 2] * dz;
	}
	function osGrad4(p, G, xb, yb, zb, wb, off, dx, dy, dz, dw) {
		const gi = p[(xb & 255) + p[(yb & 255) + p[(zb & 255) + p[(wb + off) & 255]]]] << 2;
		return (G[gi] * dx + G[gi + 1] * dy) + (G[gi + 2] * dz + G[gi + 3] * dw);
	}

	/* ---- OpenSimplex2F ---- */

	function osF2(p, xs, ys) {
		const xsb = Math.floor(xs), ysb = Math.floor(ys);
		const xi = xs - xsb, yi = ys - ysb;

		const t = (xi + yi) * OS_UNSKEW_2D;
		const dx0 = xi + t, dy0 = yi + t;

		let value = 0;
		const a0 = 0.5 - dx0 * dx0 - dy0 * dy0;
		if (a0 > 0) value = (a0 * a0) * (a0 * a0) * osGrad2(p, OS_F_GRAD2, xsb, ysb, dx0, dy0);

		const a1 = (2 * (1 + 2 * OS_UNSKEW_2D) * (1 / OS_UNSKEW_2D + 2)) * t + ((-2 * (1 + 2 * OS_UNSKEW_2D) * (1 + 2 * OS_UNSKEW_2D)) + a0);
		if (a1 > 0) {
			const dx1 = dx0 - (1 + 2 * OS_UNSKEW_2D);
			const dy1 = dy0 - (1 + 2 * OS_UNSKEW_2D);
			value += (a1 * a1) * (a1 * a1) * osGrad2(p, OS_F_GRAD2, xsb + 1, ysb + 1, dx1, dy1);
		}

		if (dy0 > dx0) {
			const dx2 = dx0 - OS_UNSKEW_2D;
			const dy2 = dy0 - (OS_UNSKEW_2D + 1);
			const a2 = 0.5 - dx2 * dx2 - dy2 * dy2;
			if (a2 > 0) value += (a2 * a2) * (a2 * a2) * osGrad2(p, OS_F_GRAD2, xsb, ysb + 1, dx2, dy2);
		} else {
			const dx2 = dx0 - (OS_UNSKEW_2D + 1);
			const dy2 = dy0 - OS_UNSKEW_2D;
			const a2 = 0.5 - dx2 * dx2 - dy2 * dy2;
			if (a2 > 0) value += (a2 * a2) * (a2 * a2) * osGrad2(p, OS_F_GRAD2, xsb + 1, ysb, dx2, dy2);
		}
		return value;
	}

	// Two interleaved cubic lattices (= BCC). xr, yr, zr are already in the rotated frame.
	function osF3(p, xr, yr, zr) {
		const xrb = (xr < 0 ? xr - 0.5 : xr + 0.5) | 0, yrb = (yr < 0 ? yr - 0.5 : yr + 0.5) | 0, zrb = (zr < 0 ? zr - 0.5 : zr + 0.5) | 0;
		let xri = xr - xrb, yri = yr - yrb, zri = zr - zrb;

		// -1 if positive, 1 if negative.
		let xNSign = ((-1 - xri) | 0) | 1, yNSign = ((-1 - yri) | 0) | 1, zNSign = ((-1 - zri) | 0) | 1;
		let ax0 = xNSign * -xri, ay0 = yNSign * -yri, az0 = zNSign * -zri;

		let xb = xrb, yb = yrb, zb = zrb;
		let off = 0;
		let value = 0;
		let a = (0.6 - xri * xri) - (yri * yri + zri * zri);
		for (let l = 0; ; l++) {
			// Closest point on the cube.
			if (a > 0) value += (a * a) * (a * a) * osGrad3(p, OS_F_GRAD3, xb, yb, zb, off, xri, yri, zri);

			// Second-closest point.
			if (ax0 >= ay0 && ax0 >= az0) {
				let b = a + ax0 + ax0;
				if (b > 1) {
					b -= 1;
					value += (b * b) * (b * b) * osGrad3(p, OS_F_GRAD3, xb - xNSign, yb, zb, off, xri + xNSign, yri, zri);
				}
			} else if (ay0 > ax0 && ay0 >= az0) {
				let b = a + ay0 + ay0;
				if (b > 1) {
					b -= 1;
					value += (b * b) * (b * b) * osGrad3(p, OS_F_GRAD3, xb, yb - yNSign, zb, off, xri, yri + yNSign, zri);
				}
			} else {
				let b = a + az0 + az0;
				if (b > 1) {
					b -= 1;
					value += (b * b) * (b * b) * osGrad3(p, OS_F_GRAD3, xb, yb, zb - zNSign, off, xri, yri, zri + zNSign);
				}
			}

			if (l === 1) break;

			// Switch to the other lattice copy.
			ax0 = 0.5 - ax0;
			ay0 = 0.5 - ay0;
			az0 = 0.5 - az0;
			xri = xNSign * ax0;
			yri = yNSign * ay0;
			zri = zNSign * az0;
			a += (0.75 - ax0) - (ay0 + az0);
			xb += (xNSign >> 1) & 1;
			yb += (yNSign >> 1) & 1;
			zb += (zNSign >> 1) & 1;
			xNSign = -xNSign;
			yNSign = -yNSign;
			zNSign = -zNSign;
			off = OS_SECOND_LATTICE;
		}
		return value;
	}

	// Five copies of the A4* lattice.
	function osF4(p, xs, ys, zs, ws) {
		const UNSKEW_4D = 0.309016994374947;
		const LATTICE_STEP_4D = 0.2;
		const xsb = Math.floor(xs), ysb = Math.floor(ys), zsb = Math.floor(zs), wsb = Math.floor(ws);
		let xsi = xs - xsb, ysi = ys - ysb, zsi = zs - zsb, wsi = ws - wsb;

		// Which lattice copy is guaranteed to have a contributing vertex in this cell's base simplex.
		const siSum = (xsi + ysi) + (zsi + wsi);
		const startingLattice = (siSum * 1.25) | 0;
		let off = startingLattice * OS_LATTICE_COPY_STEP;

		const startingLatticeOffset = startingLattice * -LATTICE_STEP_4D;
		xsi += startingLatticeOffset; ysi += startingLatticeOffset; zsi += startingLatticeOffset; wsi += startingLatticeOffset;
		let ssi = (siSum + startingLatticeOffset * 4) * UNSKEW_4D;

		let xv = xsb, yv = ysb, zv = zsb, wv = wsb;
		let value = 0;
		for (let i = 0; ; i++) {
			// Closest vertex of the 4-simplex whose base vertex is the one above.
			const score0 = 1.0 + ssi * (-1.0 / UNSKEW_4D);
			if (xsi >= ysi && xsi >= zsi && xsi >= wsi && xsi >= score0) {
				xv += 1; xsi -= 1; ssi -= UNSKEW_4D;
			} else if (ysi > xsi && ysi >= zsi && ysi >= wsi && ysi >= score0) {
				yv += 1; ysi -= 1; ssi -= UNSKEW_4D;
			} else if (zsi > xsi && zsi > ysi && zsi >= wsi && zsi >= score0) {
				zv += 1; zsi -= 1; ssi -= UNSKEW_4D;
			} else if (wsi > xsi && wsi > ysi && wsi > zsi && wsi >= score0) {
				wv += 1; wsi -= 1; ssi -= UNSKEW_4D;
			}

			const dx = xsi + ssi, dy = ysi + ssi, dz = zsi + ssi, dw = wsi + ssi;
			let a = (dx * dx + dy * dy) + (dz * dz + dw * dw);
			if (a < 0.6) {
				a -= 0.6;
				a *= a;
				value += a * a * osGrad4(p, OS_F_GRAD4, xv, yv, zv, wv, off, dx, dy, dz, dw);
			}

			if (i === 4) break;

			// Next lattice copy, shifted down by <-0.2, -0.2, -0.2, -0.2>.
			xsi += LATTICE_STEP_4D; ysi += LATTICE_STEP_4D; zsi += LATTICE_STEP_4D; wsi += LATTICE_STEP_4D;
			ssi += LATTICE_STEP_4D * 4 * UNSKEW_4D;
			off -= OS_LATTICE_COPY_STEP;

			// Because we don't always start on the same copy, there's a special reset case.
			if (i === startingLattice) {
				xv -= 1; yv -= 1; zv -= 1; wv -= 1;
				off += OS_LATTICE_COPY_STEP * 5;
			}
		}
		return value;
	}

	/* ---- OpenSimplex2S ---- */

	function osS2(p, xs, ys) {
		const xsb = Math.floor(xs), ysb = Math.floor(ys);
		const xi = xs - xsb, yi = ys - ysb;

		const t = (xi + yi) * OS_UNSKEW_2D;
		const dx0 = xi + t, dy0 = yi + t;
		const R = 2 / 3;

		const a0 = R - dx0 * dx0 - dy0 * dy0;
		let value = (a0 * a0) * (a0 * a0) * osGrad2(p, OS_S_GRAD2, xsb, ysb, dx0, dy0);

		const a1 = (2 * (1 + 2 * OS_UNSKEW_2D) * (1 / OS_UNSKEW_2D + 2)) * t + ((-2 * (1 + 2 * OS_UNSKEW_2D) * (1 + 2 * OS_UNSKEW_2D)) + a0);
		const dx1 = dx0 - (1 + 2 * OS_UNSKEW_2D);
		const dy1 = dy0 - (1 + 2 * OS_UNSKEW_2D);
		value += (a1 * a1) * (a1 * a1) * osGrad2(p, OS_S_GRAD2, xsb + 1, ysb + 1, dx1, dy1);

		const xmyi = xi - yi;
		if (t < OS_UNSKEW_2D) {
			if (xi + xmyi > 1) {
				const dx2 = dx0 - (3 * OS_UNSKEW_2D + 2);
				const dy2 = dy0 - (3 * OS_UNSKEW_2D + 1);
				const a2 = R - dx2 * dx2 - dy2 * dy2;
				if (a2 > 0) value += (a2 * a2) * (a2 * a2) * osGrad2(p, OS_S_GRAD2, xsb + 2, ysb + 1, dx2, dy2);
			} else {
				const dx2 = dx0 - OS_UNSKEW_2D;
				const dy2 = dy0 - (OS_UNSKEW_2D + 1);
				const a2 = R - dx2 * dx2 - dy2 * dy2;
				if (a2 > 0) value += (a2 * a2) * (a2 * a2) * osGrad2(p, OS_S_GRAD2, xsb, ysb + 1, dx2, dy2);
			}

			if (yi - xmyi > 1) {
				const dx3 = dx0 - (3 * OS_UNSKEW_2D + 1);
				const dy3 = dy0 - (3 * OS_UNSKEW_2D + 2);
				const a3 = R - dx3 * dx3 - dy3 * dy3;
				if (a3 > 0) value += (a3 * a3) * (a3 * a3) * osGrad2(p, OS_S_GRAD2, xsb + 1, ysb + 2, dx3, dy3);
			} else {
				const dx3 = dx0 - (OS_UNSKEW_2D + 1);
				const dy3 = dy0 - OS_UNSKEW_2D;
				const a3 = R - dx3 * dx3 - dy3 * dy3;
				if (a3 > 0) value += (a3 * a3) * (a3 * a3) * osGrad2(p, OS_S_GRAD2, xsb + 1, ysb, dx3, dy3);
			}
		} else {
			if (xi + xmyi < 0) {
				const dx2 = dx0 + (1 + OS_UNSKEW_2D);
				const dy2 = dy0 + OS_UNSKEW_2D;
				const a2 = R - dx2 * dx2 - dy2 * dy2;
				if (a2 > 0) value += (a2 * a2) * (a2 * a2) * osGrad2(p, OS_S_GRAD2, xsb - 1, ysb, dx2, dy2);
			} else {
				const dx2 = dx0 - (OS_UNSKEW_2D + 1);
				const dy2 = dy0 - OS_UNSKEW_2D;
				const a2 = R - dx2 * dx2 - dy2 * dy2;
				if (a2 > 0) value += (a2 * a2) * (a2 * a2) * osGrad2(p, OS_S_GRAD2, xsb + 1, ysb, dx2, dy2);
			}

			if (yi < xmyi) {
				const dx2 = dx0 + OS_UNSKEW_2D;
				const dy2 = dy0 + (OS_UNSKEW_2D + 1);
				const a2 = R - dx2 * dx2 - dy2 * dy2;
				if (a2 > 0) value += (a2 * a2) * (a2 * a2) * osGrad2(p, OS_S_GRAD2, xsb, ysb - 1, dx2, dy2);
			} else {
				const dx2 = dx0 - OS_UNSKEW_2D;
				const dy2 = dy0 - (OS_UNSKEW_2D + 1);
				const a2 = R - dx2 * dx2 - dy2 * dy2;
				if (a2 > 0) value += (a2 * a2) * (a2 * a2) * osGrad2(p, OS_S_GRAD2, xsb, ysb + 1, dx2, dy2);
			}
		}
		return value;
	}

	function osS3(p, xr, yr, zr) {
		const R = 0.75;
		const xrb = Math.floor(xr), yrb = Math.floor(yr), zrb = Math.floor(zr);
		const xi = xr - xrb, yi = yr - yrb, zi = zr - zrb;
		const G = OS_S_GRAD3;
		const L2 = OS_SECOND_LATTICE;

		// -1 if the fraction is >= 0.5, else 0.
		const xNMask = (-0.5 - xi) | 0, yNMask = (-0.5 - yi) | 0, zNMask = (-0.5 - zi) | 0;

		// First vertex.
		const x0 = xi + xNMask, y0 = yi + yNMask, z0 = zi + zNMask;
		const a0 = R - x0 * x0 - y0 * y0 - z0 * z0;
		let value = (a0 * a0) * (a0 * a0) * osGrad3(p, G, xrb + (xNMask & 1), yrb + (yNMask & 1), zrb + (zNMask & 1), 0, x0, y0, z0);

		// Second vertex (other lattice copy).
		const x1 = xi - 0.5, y1 = yi - 0.5, z1 = zi - 0.5;
		const a1 = R - x1 * x1 - y1 * y1 - z1 * z1;
		value += (a1 * a1) * (a1 * a1) * osGrad3(p, G, xrb + 1, yrb + 1, zrb + 1, L2, x1, y1, z1);

		// Shortcuts for building the remaining falloffs (differences of the polynomials with the offsets plugged in).
		const xAFlipMask0 = ((xNMask | 1) << 1) * x1;
		const yAFlipMask0 = ((yNMask | 1) << 1) * y1;
		const zAFlipMask0 = ((zNMask | 1) << 1) * z1;
		const xAFlipMask1 = (-2 - (xNMask << 2)) * x1 - 1.0;
		const yAFlipMask1 = (-2 - (yNMask << 2)) * y1 - 1.0;
		const zAFlipMask1 = (-2 - (zNMask << 2)) * z1 - 1.0;

		let skip5 = false;
		const a2 = xAFlipMask0 + a0;
		if (a2 > 0) {
			const x2 = x0 - (xNMask | 1);
			value += (a2 * a2) * (a2 * a2) * osGrad3(p, G, xrb + (~xNMask & 1), yrb + (yNMask & 1), zrb + (zNMask & 1), 0, x2, y0, z0);
		} else {
			const a3 = yAFlipMask0 + zAFlipMask0 + a0;
			if (a3 > 0) {
				const y3 = y0 - (yNMask | 1);
				const z3 = z0 - (zNMask | 1);
				value += (a3 * a3) * (a3 * a3) * osGrad3(p, G, xrb + (xNMask & 1), yrb + (~yNMask & 1), zrb + (~zNMask & 1), 0, x0, y3, z3);
			}

			const a4 = xAFlipMask1 + a1;
			if (a4 > 0) {
				const x4 = (xNMask | 1) + x1;
				value += (a4 * a4) * (a4 * a4) * osGrad3(p, G, xrb + (xNMask & 2), yrb + 1, zrb + 1, L2, x4, y1, z1);
				skip5 = true;
			}
		}

		let skip9 = false;
		const a6 = yAFlipMask0 + a0;
		if (a6 > 0) {
			const y6 = y0 - (yNMask | 1);
			value += (a6 * a6) * (a6 * a6) * osGrad3(p, G, xrb + (xNMask & 1), yrb + (~yNMask & 1), zrb + (zNMask & 1), 0, x0, y6, z0);
		} else {
			const a7 = xAFlipMask0 + zAFlipMask0 + a0;
			if (a7 > 0) {
				const x7 = x0 - (xNMask | 1);
				const z7 = z0 - (zNMask | 1);
				value += (a7 * a7) * (a7 * a7) * osGrad3(p, G, xrb + (~xNMask & 1), yrb + (yNMask & 1), zrb + (~zNMask & 1), 0, x7, y0, z7);
			}

			const a8 = yAFlipMask1 + a1;
			if (a8 > 0) {
				const y8 = (yNMask | 1) + y1;
				value += (a8 * a8) * (a8 * a8) * osGrad3(p, G, xrb + 1, yrb + (yNMask & 2), zrb + 1, L2, x1, y8, z1);
				skip9 = true;
			}
		}

		let skipD = false;
		const aA = zAFlipMask0 + a0;
		if (aA > 0) {
			const zA = z0 - (zNMask | 1);
			value += (aA * aA) * (aA * aA) * osGrad3(p, G, xrb + (xNMask & 1), yrb + (yNMask & 1), zrb + (~zNMask & 1), 0, x0, y0, zA);
		} else {
			const aB = xAFlipMask0 + yAFlipMask0 + a0;
			if (aB > 0) {
				const xB = x0 - (xNMask | 1);
				const yB = y0 - (yNMask | 1);
				value += (aB * aB) * (aB * aB) * osGrad3(p, G, xrb + (~xNMask & 1), yrb + (~yNMask & 1), zrb + (zNMask & 1), 0, xB, yB, z0);
			}

			const aC = zAFlipMask1 + a1;
			if (aC > 0) {
				const zC = (zNMask | 1) + z1;
				value += (aC * aC) * (aC * aC) * osGrad3(p, G, xrb + 1, yrb + 1, zrb + (zNMask & 2), L2, x1, y1, zC);
				skipD = true;
			}
		}

		if (!skip5) {
			const a5 = yAFlipMask1 + zAFlipMask1 + a1;
			if (a5 > 0) {
				const y5 = (yNMask | 1) + y1;
				const z5 = (zNMask | 1) + z1;
				value += (a5 * a5) * (a5 * a5) * osGrad3(p, G, xrb + 1, yrb + (yNMask & 2), zrb + (zNMask & 2), L2, x1, y5, z5);
			}
		}

		if (!skip9) {
			const a9 = xAFlipMask1 + zAFlipMask1 + a1;
			if (a9 > 0) {
				const x9 = (xNMask | 1) + x1;
				const z9 = (zNMask | 1) + z1;
				value += (a9 * a9) * (a9 * a9) * osGrad3(p, G, xrb + (xNMask & 2), yrb + 1, zrb + (zNMask & 2), L2, x9, y1, z9);
			}
		}

		if (!skipD) {
			const aD = xAFlipMask1 + yAFlipMask1 + a1;
			if (aD > 0) {
				const xD = (xNMask | 1) + x1;
				const yD = (yNMask | 1) + y1;
				value += (aD * aD) * (aD * aD) * osGrad3(p, G, xrb + (xNMask & 2), yrb + (yNMask & 2), zrb + 1, L2, xD, yD, z1);
			}
		}
		return value;
	}

	// 4x4x4x4 partition lookup of the lattice vertices that can reach each sub-cell.
	function osS4(p, xs, ys, zs, ws) {
		const UNSKEW_4D = -0.138196601125011;
		const xsb = Math.floor(xs), ysb = Math.floor(ys), zsb = Math.floor(zs), wsb = Math.floor(ws);
		const xsi = xs - xsb, ysi = ys - ysb, zsi = zs - zsb, wsi = ws - wsb;

		const ssi = (xsi + ysi + zsi + wsi) * UNSKEW_4D;
		const xi = xsi + ssi, yi = ysi + ssi, zi = zsi + ssi, wi = wsi + ssi;

		const index = ((Math.floor(xs * 4) & 3) << 0) | ((Math.floor(ys * 4) & 3) << 2) | ((Math.floor(zs * 4) & 3) << 4) | ((Math.floor(ws * 4) & 3) << 6);

		let value = 0;
		const stop = OS_S4_START[index + 1];
		for (let i = OS_S4_START[index]; i < stop; i++) {
			const dx = xi + OS_S4_DX[i], dy = yi + OS_S4_DY[i], dz = zi + OS_S4_DZ[i], dw = wi + OS_S4_DW[i];
			let a = (dx * dx + dy * dy) + (dz * dz + dw * dw);
			if (a < 0.8) {
				a -= 0.8;
				a *= a;
				value += a * a * osGrad4(p, OS_S_GRAD4, xsb + OS_S4_VX[i], ysb + OS_S4_VY[i], zsb + OS_S4_VZ[i], wsb + OS_S4_VW[i], 0, dx, dy, dz, dw);
			}
		}
		return value;
	}

	/* ---- public methods: lattice orientations ---- */

	(function() {
		const variants = [
			// tag, 2D base, 3D base, 4D base, w scale for the 4D orientations, ImproveXY_ImproveZW constants, 4D fallback skew
			{ tag: "F", b2: osF2, b3: osF3, b4: osF4, ww: 0.2236067977499788, c4: [-0.178275657951399372, 0.215623393288842828, -0.403949762580207112, -0.375199083010075342], skew4: -0.138196601125011 },
			{ tag: "S", b2: osS2, b3: osS3, b4: osS4, ww: 1.118033988749894, c4: [-0.28522513987434876941, 0.83897065470611435718, 0.21939749883706435719, -0.48214856493302476942], skew4: 0.309016994374947 }
		];
		for (const v of variants) {
			const base = "generateOpenSimplex2" + v.tag;
			const b2 = v.b2, b3 = v.b3, b4 = v.b4, ww4 = v.ww, c4 = v.c4, skew4 = v.skew4;
			const P = ForgeNoise.prototype;

			P[base + "_2D"] = function(x, y) {
				const s = OS_SKEW_2D * (x + y);
				return b2(this.p, x + s, y + s);
			};
			// Y points down the main diagonal; probably nicer for side-on 2D worlds.
			P[base + "_2D_ImproveX"] = function(x, y) {
				const xx = x * OS_ROOT2OVER2;
				const yy = y * (OS_ROOT2OVER2 * (1 + 2 * OS_SKEW_2D));
				return b2(this.p, yy + xx, yy - xx);
			};

			P[base + "_3D"] = P[base + "_3D_ImproveXY"] = function(x, y, z) {
				const xy = x + y;
				const s2 = xy * OS_UNSKEW_2D;
				const zz = z * OS_ROOT3OVER3;
				return b3(this.p, x + s2 + zz, y + s2 + zz, xy * -OS_ROOT3OVER3 + zz);
			};
			P[base + "_3D_ImproveXZ"] = function(x, y, z) {
				const xz = x + z;
				const s2 = xz * OS_UNSKEW_2D;
				const yy = y * OS_ROOT3OVER3;
				return b3(this.p, x + s2 + yy, xz * -OS_ROOT3OVER3 + yy, z + s2 + yy);
			};
			P[base + "_3D_Fallback"] = function(x, y, z) {
				const r = OS_FALLBACK_ROTATE_3D * (x + y + z);
				return b3(this.p, r - x, r - y, r - z);
			};

			P[base + "_4D"] = P[base + "_4D_ImproveXYZ_ImproveXY"] = function(x, y, z, w) {
				const xy = x + y;
				const s2 = xy * -0.21132486540518699998;
				const zz = z * 0.28867513459481294226;
				const ww = w * ww4;
				return b4(this.p, x + (zz + ww + s2), y + (zz + ww + s2), xy * -0.57735026918962599998 + (zz + ww), z * -0.866025403784439 + ww);
			};
			P[base + "_4D_ImproveXYZ_ImproveXZ"] = function(x, y, z, w) {
				const xz = x + z;
				const s2 = xz * -0.21132486540518699998;
				const yy = y * 0.28867513459481294226;
				const ww = w * ww4;
				return b4(this.p, x + (yy + ww + s2), xz * -0.57735026918962599998 + (yy + ww), z + (yy + ww + s2), y * -0.866025403784439 + ww);
			};
			P[base + "_4D_ImproveXYZ"] = function(x, y, z, w) {
				const xyz = x + y + z;
				const ww = w * ww4;
				const s2 = xyz * -0.16666666666666666 + ww;
				return b4(this.p, x + s2, y + s2, z + s2, -0.5 * xyz + ww);
			};
			// XY and ZW form orthogonal triangular planes: good for sampling (x, y, sin t, cos t) loops.
			P[base + "_4D_ImproveXY_ImproveZW"] = function(x, y, z, w) {
				const s2 = (x + y) * c4[0] + (z + w) * c4[1];
				const t2 = (z + w) * c4[2] + (x + y) * c4[3];
				return b4(this.p, x + s2, y + s2, z + t2, w + t2);
			};
			P[base + "_4D_Fallback"] = function(x, y, z, w) {
				const s = skew4 * (x + y + z + w);
				return b4(this.p, x + s, y + s, z + s, w + s);
			};
		}
	})();

	// [0, 1] variants of the default orientations.
	ForgeNoise.prototype.generateOpenSimplex2F_2D01 = function(x, y) { return (this.generateOpenSimplex2F_2D(x, y) + 1) * 0.5; };
	ForgeNoise.prototype.generateOpenSimplex2F_3D01 = function(x, y, z) { return (this.generateOpenSimplex2F_3D(x, y, z) + 1) * 0.5; };
	ForgeNoise.prototype.generateOpenSimplex2F_4D01 = function(x, y, z, w) { return (this.generateOpenSimplex2F_4D(x, y, z, w) + 1) * 0.5; };
	ForgeNoise.prototype.generateOpenSimplex2S_2D01 = function(x, y) { return (this.generateOpenSimplex2S_2D(x, y) + 1) * 0.5; };
	ForgeNoise.prototype.generateOpenSimplex2S_3D01 = function(x, y, z) { return (this.generateOpenSimplex2S_3D(x, y, z) + 1) * 0.5; };
	ForgeNoise.prototype.generateOpenSimplex2S_4D01 = function(x, y, z, w) { return (this.generateOpenSimplex2S_4D(x, y, z, w) + 1) * 0.5; };


	if (typeof module !== "undefined" && module.exports) {
		module.exports = ForgeNoise;
	} else {
		root.ForgeNoise = ForgeNoise;
	}
})(typeof globalThis !== "undefined" ? globalThis : this);