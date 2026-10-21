// =====================================================================
// RTS mode (v1.2.27): random map generation, the walk grid and the vision helpers. No three.js, no DOM:
// the host simulation (rts.js) and the client (rtsui.js) both use it, so a map is rebuilt the same way on every PC
// from its seed and player count.
//
// The map is a square of N x N cells, CELL meters each. Every cell has a cliff level (0 low ground, 1, 2, 3 high ground,
// ROCK = the impassable mountains around the edge) like StarCraft's. Ramps join neighboring levels. On top of the levels
// a gentle hill noise gives the ground its texture (looks only: walking and vision go by level).
// =====================================================================
export const CELL = 2;          // meters per walk / vision cell
export const LEVEL_H = 3.2;     // height of one cliff level
export const STEP_MAX = 1.7;    // the most two neighboring cells may differ in height and still be walked between (ramps step ~0.8)
export const THEME = 'highlands';
export const ROCK = 4;          // v1.2.28: the mountain rim (was level 3; 3 is now a fourth walkable height, Devin wanted more variation)
export const TOP_LV = 3;        // highest walkable level

export function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Value noise (smooth, seeded). n2(x, z) is about -1..1.
function hash2(seed, x, z) { let h = (x * 374761393 + z * 668265263 + seed * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function noise2(seed, x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(seed, xi, zi), b = hash2(seed, xi + 1, zi), c = hash2(seed, xi, zi + 1), d = hash2(seed, xi + 1, zi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
export function fbm(seed, x, z, oct = 4) { let s = 0, a = 1, f = 1, n = 0; for (let i = 0; i < oct; i++) { s += noise2(seed + i * 101, x * f, z * f) * a; n += a; a *= 0.5; f *= 2.03; } return s / n; }

// Map side in meters for a player count (StarCraft-sized: the arenas are 60-90 m, these are 3-4x that)
export function mapSize(n, opt = 'normal') {
  const base = n <= 2 ? 232 : n <= 4 ? 288 : n <= 6 ? 336 : 384;   // v1.2.28: ~12% bigger (was 208 / 256 / 304 / 344) for the bigger bases
  return Math.round(base * (opt === 'small' ? 0.82 : opt === 'large' ? 1.22 : 1) / 8) * 8;
}

// ---------------------------------------------------------------- generation
// Returns the map: per-cell level / height / walkable / ramp flags plus bases, resources, derricks, towers and doodads.
export function generateRtsMap(nPlayers, seed, sizeOpt = 'normal') {
  const n = Math.max(2, nPlayers | 0);
  for (let attempt = 0; attempt < 8; attempt++) {
    const M = tryMap(n, (seed + attempt * 7919) >>> 0, sizeOpt);
    if (M) { M.seed = seed; M.attempt = attempt; return M; }
  }
  return tryMap(n, seed >>> 0, sizeOpt, true);
}

function tryMap(n, seed, sizeOpt, force = false) {
  const rnd = mulberry(seed), size = mapSize(n, sizeOpt), N = size / CELL, H = size / 2;
  const NN = N * N, lv = new Int8Array(NN), forced = new Uint8Array(NN);
  const idx = (cx, cz) => cz * N + cx, cOf = v => Math.floor((v + H) / CELL), wOf = c => c * CELL - H + CELL / 2;
  const inB = (cx, cz) => cx >= 0 && cz >= 0 && cx < N && cz < N;
  // 1) rolling levels from noise; the middle of the map leans low (room for the big fights), the rim leans high
  const s1 = (seed % 100000) + 17;
  for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
    const x = wOf(cx), z = wOf(cz), d = Math.hypot(x, z) / H;
    let f = fbm(s1, x / 58, z / 58, 4) * 1.15 + fbm(s1 + 9, x / 23, z / 23, 2) * 0.3;
    f += (d - 0.6) * 0.38;
    lv[idx(cx, cz)] = f < -0.16 ? 0 : f < 0.14 ? 1 : f < 0.4 ? 2 : 3;   // v1.2.28: four heights (was three)
  }
  // 2) bases: every player gets a high-ground main (one ramp down), a natural below it and a third base out on the map
  const starts = [], bases = [], a0 = rnd() * Math.PI * 2, R = H * (n <= 2 ? 0.66 : 0.7);
  for (let i = 0; i < n; i++) {
    const a = n === 2 ? a0 + i * Math.PI + Math.PI / 4 * 0 : a0 + i * Math.PI * 2 / n;
    const sx = Math.cos(a) * R, sz = Math.sin(a) * R;
    starts.push({ x: sx, z: sz, a });
  }
  const set = (x, z, r, L, mark = 1) => {
    const c0x = cOf(x - r), c1x = cOf(x + r), c0z = cOf(z - r), c1z = cOf(z + r);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) if (inB(cx, cz) && Math.hypot(wOf(cx) - x, wOf(cz) - z) <= r) { const k = idx(cx, cz); lv[k] = L; if (mark) forced[k] = Math.max(forced[k], mark); }
  };
  const MAIN_R = 22, NAT_R = 15, BASE_R = 13;   // v1.2.28 (Devin: more room to build): mains were 17, naturals 13, others 12
  // the center: wide open low ground
  set(0, 0, H * 0.2, 0, 1);
  for (const s of starts) {
    const ux = -Math.cos(s.a), uz = -Math.sin(s.a);   // toward the middle
    // the main's ramp leaves the plateau toward the middle, a bit to one side; the natural sits just below it
    const side = (n % 2 ? 1 : (starts.indexOf(s) % 2 ? 1 : -1)) * 0.45;
    const rx = ux * Math.cos(side) - uz * Math.sin(side), rz = ux * Math.sin(side) + uz * Math.cos(side);
    s.ramp = { x: s.x + rx * (MAIN_R + 1), z: s.z + rz * (MAIN_R + 1), dx: rx, dz: rz };
    s.nat = { x: s.x + rx * (MAIN_R + NAT_R + 9), z: s.z + rz * (MAIN_R + NAT_R + 9) };
    // pull the natural back inside the map
    const nd = Math.hypot(s.nat.x, s.nat.z), lim = H - NAT_R - 8; if (nd > lim) { s.nat.x *= lim / nd; s.nat.z *= lim / nd; }
    set(s.x, s.z, MAIN_R + 7, 1, 1);      // a moat of level 1 so the main has only its ramp
    set(s.nat.x, s.nat.z, NAT_R + 3, 1, 1);
    set(s.x, s.z, MAIN_R, 2, 2);
  }
  // third bases: between each pair of neighboring players, out on the map (level 0 or 1, whatever is there)
  const thirds = [];
  for (let i = 0; i < n; i++) {
    const s = starts[i], t = starts[(i + 1) % n];
    let a = Math.atan2(s.z + t.z, s.x + t.x); if (n === 2) a = s.a + Math.PI / 2;
    const r = H * (n === 2 ? 0.5 : 0.62);
    thirds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    if (n === 2) thirds.push({ x: -Math.cos(a) * r, z: -Math.sin(a) * r });
  }
  for (const t of thirds) { const k = idx(cOf(t.x), cOf(t.z)); const L = Math.min(1, Math.max(0, lv[k])); t.lv = L; set(t.x, t.z, BASE_R + 2, L, 1); }
  // 3) the edge: a 2-cell mountain rim nobody walks on
  for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) if (cx < 2 || cz < 2 || cx >= N - 2 || cz >= N - 2) { lv[idx(cx, cz)] = ROCK; forced[idx(cx, cz)] = 3; }
  // 4) smooth the noise (majority of the 3x3 block) and fold tiny pockets into their surroundings
  for (let pass = 0; pass < 3; pass++) {
    const nx = lv.slice();
    for (let cz = 1; cz < N - 1; cz++) for (let cx = 1; cx < N - 1; cx++) {
      const k = idx(cx, cz); if (forced[k]) continue;
      const cnt = [0, 0, 0, 0, 0];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) cnt[lv[idx(cx + dx, cz + dz)]]++;
      let best = lv[k]; for (let L = 0; L <= TOP_LV; L++) if (cnt[L] > cnt[best]) best = L;
      if (cnt[lv[k]] <= 3) nx[k] = best;
    }
    lv.set(nx);
  }
  // levels may only step by one between neighbors (a 0 next to a 2 becomes a 1), except at the mountains. The lower cell
  // comes up, unless it's part of a base's layout: then the higher one comes down.
  for (let pass = 0; pass < 8; pass++) {
    let ch = 0;
    for (let cz = 1; cz < N - 1; cz++) for (let cx = 1; cx < N - 1; cx++) {
      const k = idx(cx, cz); if (lv[k] === ROCK) continue;
      for (let d = 0; d < 4; d++) {
        const j = idx(cx + DX4[d], cz + DZ4[d]); if (lv[j] === ROCK || lv[j] - lv[k] <= 1) continue;
        if (!forced[k]) { lv[k] = lv[j] - 1; ch++; } else if (!forced[j]) { lv[j] = lv[k] + 1; ch++; }
      }
    }
    if (!ch) break;
  }
  const regions = labelRegions(lv, N);
  mergeSmall(lv, regions, N, forced, 40);
  const reg = labelRegions(lv, N);
  // 5) ramps. Each main gets its one ramp; then every pair of touching regions one level apart gets 1-3 ramps
  const h = new Float32Array(NN), ramp = new Uint8Array(NN), walk = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) h[k] = lv[k] * LEVEL_H;
  const ramps = [];
  const addRamp = (hx, hz, dx, dz, width, len, hi, lo) => {   // (hx, hz) on the boundary (world), d = from high to low
    const ux = dx / Math.hypot(dx, dz), uz = dz / Math.hypot(dx, dz), px = -uz, pz = ux;
    const cells = [];
    const R2 = Math.max(width, len) + 2;
    for (let cz = cOf(hz - R2); cz <= cOf(hz + R2); cz++) for (let cx = cOf(hx - R2); cx <= cOf(hx + R2); cx++) {
      if (!inB(cx, cz)) continue;
      const wx = wOf(cx) - hx, wz = wOf(cz) - hz, along = wx * ux + wz * uz, across = wx * px + wz * pz;
      if (Math.abs(along) <= len / 2 && Math.abs(across) <= width / 2) cells.push([idx(cx, cz), along]);
    }
    // its ends must land on the two levels it joins
    const endHi = idx(cOf(hx - ux * (len / 2 + CELL)), cOf(hz - uz * (len / 2 + CELL))), endLo = idx(cOf(hx + ux * (len / 2 + CELL)), cOf(hz + uz * (len / 2 + CELL)));
    if (lv[endHi] !== hi || lv[endLo] !== lo) return false;
    if (cells.some(([k]) => lv[k] === ROCK || ramp[k] || (lv[k] !== hi && lv[k] !== lo))) return false;
    for (const [k, along] of cells) {
      const t = Math.max(0, Math.min(1, (along + len / 2) / len));
      h[k] = (hi + (lo - hi) * t) * LEVEL_H; lv[k] = lo; ramp[k] = 1;
    }
    ramps.push({ x: hx, z: hz, dx: ux, dz: uz, w: width, len, hi, lo });
    return true;
  };
  for (const s of starts) {
    // walk from the main's center along the ramp direction to the plateau's edge
    let ex = s.x, ez = s.z;
    for (let d = 0; d < MAIN_R + 10; d += 0.5) { const k = idx(cOf(s.x + s.ramp.dx * d), cOf(s.z + s.ramp.dz * d)); if (lv[k] !== 2) { ex = s.x + s.ramp.dx * (d - 0.5); ez = s.z + s.ramp.dz * (d - 0.5); break; } }
    if (!addRamp(ex + s.ramp.dx * 1, ez + s.ramp.dz * 1, s.ramp.dx, s.ramp.dz, 5, 9, 2, 1) && !force) return null;
    s.rampAt = { x: ex + s.ramp.dx * 1, z: ez + s.ramp.dz * 1 };
  }
  // boundaries between regions
  const pairs = new Map();
  for (let cz = 2; cz < N - 2; cz++) for (let cx = 2; cx < N - 2; cx++) {
    const k = idx(cx, cz); if (ramp[k] || lv[k] === ROCK) continue;
    for (let d = 0; d < 4; d++) {
      const j = idx(cx + DX4[d], cz + DZ4[d]); if (ramp[j] || lv[j] === ROCK || lv[j] !== lv[k] - 1) continue;
      const ra = reg.id[k], rb = reg.id[j], key = ra + ':' + rb;
      if (forced[k] === 2 || forced[j] === 2) continue;   // never into a main
      (pairs.get(key) || pairs.set(key, []).get(key)).push([cx, cz, DX4[d], DZ4[d], lv[k], lv[j]]);
    }
  }
  for (const list of pairs.values()) {
    const want = Math.max(1, Math.min(3, Math.round(list.length / 45)));
    const picked = [];
    for (let tries = 0; tries < 40 && picked.length < want; tries++) {
      const [cx, cz, dx, dz, hi, lo] = list[Math.floor(rnd() * list.length)];
      if (picked.some(p => Math.hypot(p[0] - cx, p[1] - cz) < 22)) continue;
      const bx = wOf(cx) + dx * CELL / 2, bz = wOf(cz) + dz * CELL / 2;
      if (starts.some(s => Math.hypot(s.x - bx, s.z - bz) < MAIN_R + 4)) continue;
      if (addRamp(bx, bz, dx, dz, 7 + Math.floor(rnd() * 3) * 2, 9, hi, lo)) picked.push([cx, cz]);
    }
  }
  // 6) walkable (the mountains never)
  for (let k = 0; k < NN; k++) walk[k] = lv[k] === ROCK ? 0 : 1;
  // connect anything left unreachable: lower an unreachable region one step toward a reached neighbor, or add a ramp
  for (let guard = 0; guard < 30; guard++) {
    const seen = flood(walk, h, N, idx(cOf(starts[0].x), cOf(starts[0].z)));
    let fixed = false, missing = 0;
    for (let k = 0; k < NN; k++) {
      if (!walk[k] || seen[k]) continue;
      missing++;
      // a boundary cell of this pocket next to a reached cell one level apart: ramp there
      const cx = k % N, cz = (k / N) | 0;
      for (let d = 0; d < 4 && !fixed; d++) {
        const ex = cx + DX4[d], ez = cz + DZ4[d]; if (!inB(ex, ez)) continue;
        const j = idx(ex, ez); if (!seen[j] || !walk[j]) continue;
        const dl = lv[k] - lv[j];
        const bx = wOf(cx) + DX4[d] * CELL / 2, bz = wOf(cz) + DZ4[d] * CELL / 2;
        if (dl === 1) fixed = addRamp(bx, bz, DX4[d], DZ4[d], 6, 9, lv[k], lv[j]);
        else if (dl === -1) fixed = addRamp(bx, bz, -DX4[d], -DZ4[d], 6, 9, lv[j], lv[k]);
      }
      if (fixed) break;
    }
    if (!missing) break;
    if (!fixed) {   // no ramp fit anywhere: level the unreachable cells to their reached neighbors
      for (let k = 0; k < NN; k++) if (walk[k] && !seen[k]) {
        const cx = k % N, cz = (k / N) | 0;
        for (let d = 0; d < 4; d++) { const ex = cx + DX4[d], ez = cz + DZ4[d]; if (!inB(ex, ez)) continue; const j = idx(ex, ez); if (seen[j] && walk[j] && !ramp[j]) { lv[k] = lv[j]; h[k] = h[j]; break; } }
      }
    }
  }
  // 7) bases: hub spot, a crystal line and two flux vents, laid out on the side away from the base's way in
  const all = [];
  starts.forEach((s, i) => all.push({ x: s.x, z: s.z, out: [s.rampAt.x - s.x, s.rampAt.z - s.z], main: i }));
  starts.forEach((s, i) => all.push({ x: s.nat.x, z: s.nat.z, out: [-s.nat.x, -s.nat.z], nat: i }));
  for (const t of thirds) all.push({ x: t.x, z: t.z, out: [-t.x, -t.z] });
  const res = [], blocked = new Uint8Array(NN);
  let rid = 1;
  for (const b of all) {
    const k = idx(cOf(b.x), cOf(b.z));
    if (ramp[k]) { if (!force) return null; }
    b.lv = lv[k]; b.y = h[k];
    // flatten the base (hub + mineral line) to its level, never over a ramp
    const fr = b.main != null ? MAIN_R - 2 : 15;   // (v1.2.28: was 13 for every base)
    for (let cz = cOf(b.z - fr - 2); cz <= cOf(b.z + fr + 2); cz++) for (let cx = cOf(b.x - fr - 2); cx <= cOf(b.x + fr + 2); cx++) {
      if (!inB(cx, cz)) continue; const j = idx(cx, cz);
      if (Math.hypot(wOf(cx) - b.x, wOf(cz) - b.z) <= fr && !ramp[j] && lv[j] !== ROCK) { lv[j] = b.lv; h[j] = b.lv * LEVEL_H; }
    }
    const ol = Math.hypot(b.out[0], b.out[1]) || 1, ox = b.out[0] / ol, oz = b.out[1] / ol;
    const back = Math.atan2(-oz, -ox);
    b.patches = []; b.vents = [];
    for (let i = 0; i < 8; i++) {
      const a = back + (i - 3.5) * 0.25, r = 9 + (i % 2) * 1.6;
      const x = snap(b.x + Math.cos(a) * r, H), z = snap(b.z + Math.sin(a) * r, H);
      const big = i !== 0 && i !== 7;
      const R0 = { id: rid++, k: 'c', x, z, amt: big ? 1500 : 900, max: big ? 1500 : 900, base: all.indexOf(b) };
      res.push(R0); b.patches.push(R0.id);
    }
    for (const sgn of [-1, 1]) {
      const a = back + sgn * 1.45, r = 10.5;
      const x = snap2(b.x + Math.cos(a) * r, H), z = snap2(b.z + Math.sin(a) * r, H);
      const R0 = { id: rid++, k: 'f', x, z, amt: 2000, max: 2000, base: all.indexOf(b) };
      res.push(R0); b.vents.push(R0.id);
    }
  }
  for (const r of res) for (const k of resCells(r, N, H)) { if (k < 0 || ramp[k] || lv[k] === ROCK) { if (!force) return null; } else blocked[k] = 1; }
  // 8) derricks (infinite income, captured by standing next to them) and watchtowers (vision while you hold them)
  const pois = [];
  const farFromAll = (x, z, d) => all.every(b => Math.hypot(b.x - x, b.z - z) > d) && pois.every(p => Math.hypot(p.x - x, p.z - z) > d * 0.8) && ramps.every(r => Math.hypot(r.x - x, r.z - z) > 8);
  const okSpot = (x, z) => { const cx = cOf(x), cz = cOf(z); for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const j = idx(cx + dx, cz + dz); if (!inB(cx + dx, cz + dz) || lv[j] === ROCK || ramp[j] || blocked[j] || lv[j] !== lv[idx(cx, cz)]) return false; } return true; };
  const derricks = [], towers = [];
  const nT = n <= 2 ? 1 : n <= 5 ? 2 : 3;
  for (let i = 0; i < nT; i++) {
    for (let t = 0; t < 200; t++) {
      const a = (i / nT) * Math.PI * 2 + rnd() * 0.6 + a0, r = nT === 1 ? rnd() * 8 : H * (0.12 + rnd() * 0.12);
      const x = snap(Math.cos(a) * r, H), z = snap(Math.sin(a) * r, H);
      if (!okSpot(x, z) || !farFromAll(x, z, 26)) continue;
      const T = { id: rid++, x, z }; towers.push(T); pois.push(T); break;
    }
  }
  const nD = n + 2;
  for (let i = 0; i < nD; i++) {
    for (let t = 0; t < 300; t++) {
      const a = rnd() * Math.PI * 2, r = H * (0.15 + rnd() * 0.65);
      const x = snap(Math.cos(a) * r, H), z = snap(Math.sin(a) * r, H);
      if (!okSpot(x, z) || !farFromAll(x, z, 30)) continue;
      const D = { id: rid++, x, z }; derricks.push(D); pois.push(D); break;
    }
  }
  for (const p of pois) blocked[idx(cOf(p.x), cOf(p.z))] = 1;
  // 9) doodads: tree groves and rock piles on noise peaks, away from bases, ramps and points of interest
  const doodads = [], s2 = s1 + 333;
  for (let cz = 3; cz < N - 3; cz++) for (let cx = 3; cx < N - 3; cx++) {
    const k = idx(cx, cz); if (lv[k] === ROCK || ramp[k] || blocked[k]) continue;
    const x = wOf(cx), z = wOf(cz);
    const g = fbm(s2, x / 30, z / 30, 3);
    if (g < 0.38) continue;
    if (all.some(b => Math.hypot(b.x - x, b.z - z) < 24) || pois.some(p => Math.hypot(p.x - x, p.z - z) < 10) || ramps.some(r => Math.hypot(r.x - x, r.z - z) < 10)) continue;
    if (Math.hypot(x, z) < H * 0.16) continue;
    let nearRamp = false; for (let dz = -2; dz <= 2 && !nearRamp; dz++) for (let dx = -2; dx <= 2; dx++) if (ramp[idx(cx + dx, cz + dz)]) { nearRamp = true; break; }
    if (nearRamp) continue;
    if (rnd() < 0.35) continue;
    const tree = fbm(s2 + 5, x / 12, z / 12, 2) > -0.1;
    blocked[k] = 1;
    doodads.push({ k: tree ? 't' : 'r', x: x + (rnd() - 0.5) * 0.8, z: z + (rnd() - 0.5) * 0.8, s: 0.8 + rnd() * 0.5, r: rnd() * Math.PI * 2, c: k });
  }
  // the whole map must stay connected: drop doodads that cut anything off
  for (let k = 0; k < NN; k++) walk[k] = lv[k] === ROCK || blocked[k] ? 0 : 1;
  {
    const seen = flood(walk, h, N, idx(cOf(starts[0].x), cOf(starts[0].z)));
    const need = [...all.map(b => [b.x + b.out[0] / (Math.hypot(b.out[0], b.out[1]) || 1) * 5, b.z + b.out[1] / (Math.hypot(b.out[0], b.out[1]) || 1) * 5]), ...pois.map(p => [p.x + 3, p.z])];
    if (need.some(([x, z]) => !seen[idx(cOf(x), cOf(z))])) {
      for (const d of doodads) { blocked[d.c] = 0; walk[d.c] = lv[d.c] === ROCK ? 0 : 1; }
      doodads.length = 0;
      const s2b = flood(walk, h, N, idx(cOf(starts[0].x), cOf(starts[0].z)));
      if (need.some(([x, z]) => !s2b[idx(cOf(x), cOf(z))]) && !force) return null;
    }
    // walkable pockets nobody can reach become rock (they'd only trap a unit)
    const s3 = flood(walk, h, N, idx(cOf(starts[0].x), cOf(starts[0].z)));
    for (let k = 0; k < NN; k++) if (walk[k] && !s3[k] && !blocked[k]) walk[k] = 0;
  }
  // resource and point-of-interest cells are not walkable (the game marks buildings itself)
  for (let k = 0; k < NN; k++) if (blocked[k]) walk[k] = 0;
  return {
    v: 1, theme: THEME, players: n, size, N, H, cell: CELL, lv, h, walk, ramp, ramps,
    starts: starts.map((s, i) => ({ x: snapHub(s.x, H), z: snapHub(s.z, H), lv: 2, rampAt: s.rampAt, base: i })),
    bases: all.map((b, i) => ({ id: i, x: snapHub(b.x, H), z: snapHub(b.z, H), lv: b.lv, y: b.y, main: b.main, nat: b.nat, patches: b.patches, vents: b.vents })),
    res, derricks, towers, doodads, hillSeed: s1 + 77,
  };
}
const DX4 = [1, -1, 0, 0], DZ4 = [0, 0, 1, -1];
// crystal patches sit on a cell center, vents and hubs on cell corners (they are 2 and 4 cells wide)
const snap = (v, H) => Math.floor((v + H) / CELL) * CELL - H + CELL / 2;
const snap2 = (v, H) => Math.round((v + H) / CELL) * CELL - H;
const snapHub = (v, H) => Math.round((v + H) / CELL) * CELL - H;
export function resCells(r, N, H) {
  const out = [], f = r.k === 'f' ? 2 : 1, x0 = r.x - f * CELL / 2, z0 = r.z - f * CELL / 2;
  for (let dz = 0; dz < f; dz++) for (let dx = 0; dx < f; dx++) {
    const cx = Math.floor((x0 + H) / CELL + dx + 0.01), cz = Math.floor((z0 + H) / CELL + dz + 0.01);
    out.push(cx < 0 || cz < 0 || cx >= N || cz >= N ? -1 : cz * N + cx);
  }
  return out;
}
function labelRegions(lv, N) {
  const id = new Int32Array(N * N).fill(-1), size = [];
  let r = 0;
  const st = new Int32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    if (id[k] >= 0) continue;
    let sp = 0; st[sp++] = k; id[k] = r; let n = 0;
    while (sp) {
      const c = st[--sp]; n++;
      const cx = c % N, cz = (c / N) | 0;
      for (let d = 0; d < 4; d++) {
        const ex = cx + DX4[d], ez = cz + DZ4[d]; if (ex < 0 || ez < 0 || ex >= N || ez >= N) continue;
        const j = ez * N + ex; if (id[j] < 0 && lv[j] === lv[c]) { id[j] = r; st[sp++] = j; }
      }
    }
    size.push(n); r++;
  }
  return { id, size };
}
function mergeSmall(lv, reg, N, forced, min) {
  for (let k = 0; k < N * N; k++) {
    if (forced[k] || reg.size[reg.id[k]] >= min) continue;
    const cx = k % N, cz = (k / N) | 0, cnt = [0, 0, 0, 0, 0];
    for (let d = 0; d < 4; d++) { const ex = cx + DX4[d], ez = cz + DZ4[d]; if (ex < 0 || ez < 0 || ex >= N || ez >= N) continue; const j = ez * N + ex; if (lv[j] !== lv[k]) cnt[lv[j]]++; }
    let best = -1; for (let L = 0; L <= TOP_LV; L++) if (cnt[L] && (best < 0 || cnt[L] > cnt[best])) best = L;
    if (best >= 0) lv[k] = best;
  }
}
// cells reachable on foot from cell s (4-neighbor steps that climb at most STEP_MAX)
export function flood(walk, h, N, s) {
  const seen = new Uint8Array(N * N), st = new Int32Array(N * N); let sp = 0;
  if (!walk[s]) { for (let r = 1; r < 6 && !walk[s]; r++) for (let d = 0; d < 4; d++) { const j = s + DX4[d] * r + DZ4[d] * r * N; if (j >= 0 && j < N * N && walk[j]) { s = j; break; } } }
  seen[s] = 1; st[sp++] = s;
  while (sp) {
    const c = st[--sp], cx = c % N, cz = (c / N) | 0;
    for (let d = 0; d < 4; d++) {
      const ex = cx + DX4[d], ez = cz + DZ4[d]; if (ex < 0 || ez < 0 || ex >= N || ez >= N) continue;
      const j = ez * N + ex; if (seen[j] || !walk[j] || Math.abs(h[j] - h[c]) > STEP_MAX) continue;
      seen[j] = 1; st[sp++] = j;
    }
  }
  return seen;
}

// ---------------------------------------------------------------- shared lookups
export const cellOf = (M, x, z) => { const cx = Math.floor((x + M.H) / CELL), cz = Math.floor((z + M.H) / CELL); return cx < 0 || cz < 0 || cx >= M.N || cz >= M.N ? -1 : cz * M.N + cx; };
export const cellX = (M, k) => (k % M.N) * CELL - M.H + CELL / 2;
export const cellZ = (M, k) => ((k / M.N) | 0) * CELL - M.H + CELL / 2;
// gentle hills on top of the levels (looks only; both the terrain mesh and the units use it)
export function hillAt(M, x, z) {
  return fbm(M.hillSeed, x / 34, z / 34, 3) * 1.1 + fbm(M.hillSeed + 3, x / 9, z / 9, 2) * 0.18;
}
// ground height where a unit stands: its cell's level (ramps blend smoothly between their cells) plus the hills
export function groundAt(M, x, z) {
  const fx = (x + M.H) / CELL - 0.5, fz = (z + M.H) / CELL - 0.5;
  const cx = Math.max(0, Math.min(M.N - 1, Math.round(fx))), cz = Math.max(0, Math.min(M.N - 1, Math.round(fz)));
  const k = cz * M.N + cx;
  let base = M.h[k];
  if (M.ramp[k]) {   // bilinear over the ramp cells (and the cells it lands on) for a smooth slope
    const x0 = Math.max(0, Math.min(M.N - 2, Math.floor(fx))), z0 = Math.max(0, Math.min(M.N - 2, Math.floor(fz))), tx = Math.max(0, Math.min(1, fx - x0)), tz = Math.max(0, Math.min(1, fz - z0));
    const a = M.h[z0 * M.N + x0], b = M.h[z0 * M.N + x0 + 1], c = M.h[(z0 + 1) * M.N + x0], d = M.h[(z0 + 1) * M.N + x0 + 1];
    const ok = v => Math.abs(v - base) <= STEP_MAX;   // never blend with a cliff top / bottom next to the ramp
    const A = ok(a) ? a : base, B = ok(b) ? b : base, Cc = ok(c) ? c : base, D = ok(d) ? d : base;
    base = (A * (1 - tx) + B * tx) * (1 - tz) + (Cc * (1 - tx) + D * tx) * tz;
  }
  return base + hillAt(M, x, z) * (M.lv[k] === ROCK ? 0 : 1);
}
export const levelAt = (M, x, z) => { const k = cellOf(M, x, z); return k < 0 ? ROCK : M.lv[k]; };

// ---------------------------------------------------------------- vision (StarCraft rules)
// A ground unit sees cells within its sight radius whose level is not above its own (it can't see up a cliff);
// ramps count as the lower level. Air units see everything in range. vis: Uint8Array per cell, stamped to 2.
export function stampVision(M, vis, x, z, r, level, air) {
  const N = M.N, cx = Math.floor((x + M.H) / CELL), cz = Math.floor((z + M.H) / CELL), rc = r / CELL, rc2 = (rc + 0.5) * (rc + 0.5), R = Math.ceil(rc);
  for (let dz = -R; dz <= R; dz++) {
    const ez = cz + dz; if (ez < 0 || ez >= N) continue;
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > rc2) continue;
      const ex = cx + dx; if (ex < 0 || ex >= N) continue;
      const k = ez * N + ex;
      if (air || M.lv[k] <= level || M.lv[k] === ROCK) vis[k] = 2;
    }
  }
}
