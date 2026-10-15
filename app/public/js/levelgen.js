// Level generation. Layouts are written in height "units" (0-3) and converted to meters
// with RULES.tierHeights at the end:
//   unit 1 (0.8 m): hop up from the floor, low enough to shoot over in first person
//   unit 2 (2.0 m): needs a unit-1 step next to it
//   unit 3 (3.2 m): tall cover
import { ART, RULES } from './config.js';

const unitToM = u => { const T = RULES.tierHeights, i = Math.min(2, Math.floor(u)), f = u - i; return u >= 3 ? T[3] + (u - 3) * 1.2 : T[i] + (T[i + 1] - T[i]) * f; };
function toMeters(boxes) {
  for (const b of boxes) { if (b.wall) continue; const bot = unitToM(b.y0), top = unitToM(b.y0 + b.h); b.y0 = bot; b.h = top - bot; }
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Arena half-size grows with player count.
// Grows quickly up to 8 players, then more gently up to the 20-player cap.
export function arenaSize(n) {
  n = Math.max(2, Math.min(RULES.maxPlayers || 20, n));
  const a = Math.min(8, n), b = Math.max(0, n - 8);
  return { hx: Math.round(15 + 2 * a + 1.1 * b), hz: Math.round(9 + 1.5 * a + 0.8 * b) };
}

// Classic layouts, designed for an 18 x 11 half-size arena and stretched to fit.
// [x, z, w, d, h, y0]; every box with x != 0 is mirrored to -x.
const CLASSIC = [
  { name: 'Crossroads', boxes: [[0,0,4,4,3],[8,5,2,2,3],[8,-5,2,2,3],[13,0,1,6,1],[5.5,0,2.5,2.5,1],[3.5,0,1.5,2,1,1]] },
  { name: 'Terraces',   boxes: [[10,6,4,3,1],[13.5,6,3,3,2],[10,-6,4,3,1],[13.5,-6,3,3,2],[0,0,8,3,2],[5,0,2,2,1],[0,7.5,1,4,1],[0,-7.5,1,4,1]] },
  { name: 'Pillar Hall', boxes: [[4,4,1.5,1.5,3],[4,-4,1.5,1.5,3],[10,0,1.5,1.5,3],[10,7,1.5,1.5,3],[10,-7,1.5,1.5,3],[0,2.5,6,0.8,1],[0,-2.5,6,0.8,1],[14,4,3,1,1],[14,-4,3,1,1]] },
  { name: 'Bunkers',    boxes: [[7,0,1,5,1],[12,5,3,3,2],[9.8,5,1.4,2,1],[12,-5,3,3,2],[9.8,-5,1.4,2,1],[0,6,5,2,2],[0,4.3,2,1.4,1],[0,-6,5,2,2],[0,-4.3,2,1.4,1],[0,0,1.5,1.5,1]] },
  { name: 'Ziggurat',   boxes: [[0,0,6,6,1],[0,0,4,4,1,1],[0,0,2,2,1,2],[9,4,1,3,1],[9,-4,1,3,1],[14,7,1.5,1.5,3],[14,-7,1.5,1.5,3],[6,7.5,3,1,1]] },
  { name: 'Trenches',   boxes: [[6,0,1,8,1],[11,0,1,6,1],[3,7.6,6,1,1],[3,-7.6,6,1,1],[8.5,5.5,1.5,1.5,3],[8.5,-5.5,1.5,1.5,3],[0,0,2,2,3]] },
  { name: 'Fortress',   boxes: [[0,0,7,1,3],[0,3.5,1,6,1],[0,-3.5,1,6,1],[7,4,3,3,1],[7,4,1.5,1.5,1,1],[7,-4,3,3,1],[7,-4,1.5,1.5,1,1],[13,0,1.5,4,1]] },
];

function makeStructure(rng) {
  const R = (a, b) => a + rng() * (b - a);
  const r = rng();
  let boxes, w, d;
  if (r < 0.3) { // cover wall
    const long = R(3, 5.5), h = rng() < 0.55 ? 1 : 3;
    if (rng() < 0.5) { w = 1; d = long; } else { w = long; d = 1; }
    boxes = [{ dx: 0, dz: 0, w, d, h, y0: 0 }];
  } else if (r < 0.5) { // low block
    w = R(2, 3.5); d = R(2, 3.5);
    boxes = [{ dx: 0, dz: 0, w, d, h: 1, y0: 0 }];
  } else if (r < 0.65) { // pillar
    w = d = R(1.2, 2);
    boxes = [{ dx: 0, dz: 0, w, d, h: 3, y0: 0 }];
  } else if (r < 0.85) { // step: base + half-size block stacked on top
    w = R(3, 4.5); d = R(3, 4.5);
    boxes = [{ dx: 0, dz: 0, w, d, h: 1, y0: 0 }];
    if (rng() < 0.5) boxes.push({ dx: w / 4, dz: 0, w: w / 2, d, h: 1, y0: 1 });
    else boxes.push({ dx: 0, dz: d / 4, w, d: d / 2, h: 1, y0: 1 });
  } else { // tower with a step beside it
    boxes = [{ dx: 0.75, dz: 0, w: 2.4, d: 2.4, h: 2, y0: 0 }, { dx: -1.2, dz: 0, w: 1.5, d: 2.4, h: 1, y0: 0 }];
    w = 3.9; d = 2.4;
    if (rng() < 0.5) { boxes = boxes.map(b => ({ dx: b.dz, dz: b.dx, w: b.d, d: b.w, h: b.h, y0: b.y0 })); [w, d] = [d, w]; }
  }
  return { boxes, w, d };
}

function genBoxes(rng, hx, hz, rectsOut, inside = null, areaFrac = 1, asym = false) {
  const out = [], rects = [];
  const ok = r => !inside || inside(r, 3.0);   // polygon arenas: keep the spawn band along every edge clear
  const mx = hx - 3.4, mz = hz - 3.4; // keep the spawn band near the walls clear
  const R = (a, b) => a + rng() * (b - a);
  const c = rng();
  if (c < 0.3) { out.push({ x: 0, z: 0, w: 5, d: 5, h: 1, y0: 0 }, { x: 0, z: 0, w: 2.6, d: 2.6, h: 1, y0: 1 }); rects.push([-2.5, 2.5, -2.5, 2.5]); }
  else if (c < 0.55) { out.push({ x: 0, z: 0, w: 2.5, d: 2.5, h: 3, y0: 0 }); rects.push([-1.25, 1.25, -1.25, 1.25]); }
  else if (c < 0.75) { out.push({ x: 0, z: 0, w: 6, d: 1, h: 1, y0: 0 }, { x: 0, z: 0, w: 1, d: 6, h: 1, y0: 0 }); rects.push([-3, 3, -3, 3]); }
  const target = Math.round(mx * mz / 22 * areaFrac);
  const MARGIN = 1.4;
  const free = r => rects.every(q => r[1] + MARGIN <= q[0] || r[0] >= q[1] + MARGIN || r[3] + MARGIN <= q[2] || r[2] >= q[3] + MARGIN);
  for (let i = 0; i < target; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const s = makeStructure(rng);
      const kind = rng();
      let cx, cz, mirrors;
      if (asym && kind < 0.45) { cx = R(0.8 + s.w / 2, mx - s.w / 2); cz = R(-mz + s.d / 2, mz - s.d / 2); mirrors = [[1, 1], [-1, 1]]; }   // shapes that aren't front/back symmetric
      else if (kind < 0.65) { cx = R(0.8 + s.w / 2, mx - s.w / 2); cz = R(0.8 + s.d / 2, mz - s.d / 2); mirrors = [[1, 1], [-1, 1], [1, -1], [-1, -1]]; }
      else if (kind < 0.85) { cx = R(0.8 + s.w / 2, mx - s.w / 2); cz = 0; mirrors = [[1, 1], [-1, 1]]; }
      else { cx = 0; cz = R(0.8 + s.d / 2, mz - s.d / 2); mirrors = [[1, 1], [1, -1]]; }
      if (!isFinite(cx) || !isFinite(cz) || cx + s.w / 2 > mx || Math.abs(cz) + s.d / 2 > mz) continue;
      const copies = mirrors.map(([sx, sz]) => [cx * sx - s.w / 2, cx * sx + s.w / 2, cz * sz - s.d / 2, cz * sz + s.d / 2]);
      if (!copies.every(free) || !copies.every(ok)) continue;
      rects.push(...copies);
      for (const [sx, sz] of mirrors) for (const b of s.boxes) out.push({ x: (cx + b.dx) * sx, z: (cz + b.dz) * sz, w: b.w, d: b.d, h: b.h, y0: b.y0 });
      break;
    }
  }
  if (rectsOut) rectsOut.push(...rects);
  return out;
}

// ---------- moving / physics objects ----------
let dynId = 0;
// v1.2.15 trap arenas, in the same 18 x 11 units as CLASSIC (x != 0 is mirrored to -x).
// crushers [x, z, w, d, period, phase]; spikes [x, z, w, d, period, offset, on]; fences [ax, az, bx, bz, period, offset, on];
// sweeps [axis, from, to, period, offset] (axis 'x': a beam along x that moves in z); slides [x, z, w, d, amp, period, phase]
const TRAP_MAPS = [
  { name: 'Crusher Hall', boxes: [[0,0,1.5,1.5,3],[6,7,3,1,1],[6,-7,3,1,1],[13,0,1,4,1],[15,6,2,2,2],[15,-6,2,2,2],[2.5,3,1,1,1],[2.5,-3,1,1,1]],
    crushers: [[5,0,3.2,3.2,5,0],[9.5,4,3,3,6,1.7],[9.5,-4,3,3,6,4.2],[0,6,3,3,5.5,2.4],[0,-6,3,3,5.5,0.4]] },
  { name: 'Spike Garden', boxes: [[0,0,2,2,3],[7,5.5,1.5,1.5,3],[7,-5.5,1.5,1.5,3],[13,0,1.5,5,1],[3.5,8,2,1,1],[3.5,-8,2,1,1],[10.5,0,1,1,2]],
    spikes: [[3.5,0,3,3,4,0,1.4],[7,0,3,3,4,1.3,1.4],[10.5,4,3,3,4,2.6,1.4],[10.5,-4,3,3,4,0.6,1.4],[0,4.5,3,3,4.5,2,1.6],[0,-4.5,3,3,4.5,0,1.6],[3.5,5,2.4,2.4,5,3.3,1.5],[3.5,-5,2.4,2.4,5,1,1.5]] },
  { name: 'Laser Grid', boxes: [[4,3.5,1,1,3],[4,-3.5,1,1,3],[10,0,1,1,3],[10,6.5,2.4,1,1],[10,-6.5,2.4,1,1],[0,0,2,2,1],[14.5,3,1,2,1],[14.5,-3,1,2,1]],
    sweeps: [['x',-9,9,9,0],['z',-14,14,13,3]],
    fences: [[7,-3,7,3,5,0,1.8],[0,3,0,8.5,6,2,2],[0,-3,0,-8.5,6,5,2],[12.5,4,12.5,8.5,5,2.5,1.8],[12.5,-4,12.5,-8.5,5,0.5,1.8]] },
  { name: 'Rail Yard', boxes: [[9,0,1.2,4,3],[13,6,2.5,1.5,1],[13,-6,2.5,1.5,1],[6.5,7.5,2,1,2],[6.5,-7.5,2,1,2],[15,0,1,2.5,1]],
    spikes: [[0,0,5,3.6,4,0,1.5],[0,4.2,5,3.6,4,1.4,1.5],[0,-4.2,5,3.6,4,2.8,1.5],[0,8.2,5,3.6,4,0.7,1.5],[0,-8.2,5,3.6,4,2.1,1.5]],
    slides: [[1.4,0,2.4,2.4,6,7,0],[-1.4,0,2.4,2.4,6,7,3.14]] },
];
function trapLayout(rng, hx, hz, boxes, rects) {
  const L = TRAP_MAPS[Math.floor(rng() * TRAP_MAPS.length)], sx = hx / 18, sz = hz / 11, mir = x => (x !== 0 ? [1, -1] : [1]);
  for (const [x, z, w, d, h, y0 = 0] of L.boxes) for (const m of mir(x)) boxes.push({ x: m * x * sx, z: z * sz, w: w * sx, d: d * sz, h, y0 });
  for (const b of boxes) rects.push([b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2]);
  toMeters(boxes);
  const dynamic = [], traps = [];
  for (const [x, z, w, d, period, phase] of L.crushers || []) for (const m of mir(x)) dynamic.push({ id: 'd' + (++dynId), kind: 'crusher', x: m * x * sx, z: z * sz, y0: 3.4, top: 3.4, w: w * sx, d: d * sz, h: 1.3, period, phase: phase + (m < 0 ? period / 2 : 0) });
  for (const [x, z, w, d, amp, period, phase] of L.slides || []) dynamic.push({ id: 'd' + (++dynId), kind: 'slide', x: x * sx, z: z * sz, y0: 0, w: w * sx, d: d * sz, h: unitToM(1), axis: 'z', amp: amp * sz, period, phase });
  let n = 0;
  for (const [x, z, w, d, period, off, on] of L.spikes || []) for (const m of mir(x)) traps.push({ id: ++n, kind: 'spikes', x: m * x * sx, z: z * sz, w: w * sx, d: d * sz, period, off: off + (m < 0 ? period / 2 : 0), on });
  for (const [ax, az, bx, bz, period, off, on] of L.fences || []) for (const m of mir(ax || bx)) traps.push({ id: ++n, kind: 'fence', ax: m * ax * sx, az: az * sz, bx: m * bx * sx, bz: bz * sz, period, off: off + (m < 0 ? period / 2 : 0), on });
  for (const [axis, a, b, period, off] of L.sweeps || []) { const k = axis === 'x' ? sz : sx; traps.push({ id: ++n, kind: 'sweep', axis, a: a * k, b: b * k, period, off }); }
  return { name: L.name, dynamic, traps };
}

function freeRect(rects, r, margin = 1.2) {
  return rects.every(q => r[1] + margin <= q[0] || r[0] >= q[1] + margin || r[3] + margin <= q[2] || r[2] >= q[3] + margin);
}
function placeDynamics(rng, hx, hz, rects, opts = {}) {
  const dyn = [], mx = hx - 3.6, mz = hz - 3.6, R = (a, b) => a + rng() * (b - a);
  const tryPlace = (w, d, extraX, extraZ, mirror, make) => {
    for (let t = 0; t < 40; t++) {
      const cx = R(1.5 + w / 2 + extraX, mx - w / 2 - extraX), cz = R(-mz + d / 2 + extraZ, mz - d / 2 - extraZ);
      if (!(cx < cx + 1)) return false;
      const copies = (mirror ? [1, -1] : [1]).map(sx => [cx * sx - w / 2 - extraX, cx * sx + w / 2 + extraX, cz - d / 2 - extraZ, cz + d / 2 + extraZ]);
      if (!copies.every(c => freeRect(rects, c) && (!opts.inside || opts.inside(c, 3.2)))) continue;
      rects.push(...copies);
      for (const sx of mirror ? [1, -1] : [1]) dyn.push(make(cx * sx, cz, sx));
      return true;
    }
    return false;
  };
  // Pillars that slowly extend and retract
  // (up to three mirrored pairs; later pairs are thinner or shorter and run on their own timing)
  const piston = (w, top) => tryPlace(w, w, 0, 0, true, (x, z) => ({ id: 'd' + (++dynId), kind: 'piston', x, z, y0: 0, w, d: w, h: unitToM(1), hMin: unitToM(1), hMax: unitToM(top), period: R(12, 20), phase: rng() * 6.28 }));
  if (rng() < (opts.pistonChance ?? 0.7)) piston(1.6, 3);
  if (rng() < (opts.pistonChance ?? 0.7) * 0.85) piston(R(1.3, 1.8), rng() < 0.5 ? 2 : 3);
  if (rng() < 0.4) piston(1.4, 2);
  // Platforms that slide back and forth
  if (rng() < (opts.slideChance ?? 0.6)) {
    const amp = R(2, 3.2);
    tryPlace(2.4, 2.4, 0, amp, true, (x, z, sx) => ({ id: 'd' + (++dynId), kind: 'slide', x, z, y0: 0, w: 2.4, d: 2.4, h: unitToM(1), axis: 'z', amp, period: R(8, 12), phase: sx > 0 ? 0 : Math.PI }));
  }
  // Crates and barrels you can shoot, shove and blow around
  const nCrates = 2 + Math.floor(rng() * 3), nBarrels = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < nCrates; i++) tryPlace(1.3, 1.3, 0, 0, true, (x, z) => ({ id: 'd' + (++dynId), kind: 'crate', x, z, y0: 0, w: 1.3, d: 1.3, h: 1.5, mass: 4 }));
  for (let i = 0; i < nBarrels; i++) tryPlace(1.0, 1.0, 0, 0, true, (x, z) => ({ id: 'd' + (++dynId), kind: 'barrel', x, z, y0: 0, w: 1.0, d: 1.0, h: 1.7, mass: 3 }));
  return dyn;
}

// Lava Lake: the floor is lava; everyone fights on big floating platforms that drift when
// hit and slowly spring back to where they belong.
function lavaLayout(rng, hx, hz, spawnCount = 2, ice = false) {
  // Generated with the lava ruleset: a symmetric ring of spawn platforms (one per player, so nobody
  // shares a spawn), mirrored floating platforms (physics, spring back home) inside it, plus a
  // guaranteed set of moving platforms gliding between them.
  const R = (a, b) => a + rng() * (b - a), dyn = [], rects = [];
  const fits = (x, z, w, d, m = 1.2) => rects.every(q => x + w / 2 + m <= q[0] || x - w / 2 - m >= q[1] || z + d / 2 + m <= q[2] || z - d / 2 - m >= q[3]);
  const add = (x, z, w, d, y0, extra = {}) => {
    rects.push([x - w / 2, x + w / 2, z - d / 2, z + d / 2]);
    if (ice) { // Ice Sheets: floes sit low in the water (top ~0.3 m) and are irregular polygons (corners cut off the box)
      const m = Math.min(w, d), floe = extra.spawn != null || m >= 4.4 ? 'big' : m >= 2.5 ? 'med' : 'small';
      const cut = () => rng() < 0.8 ? m * (0.1 + rng() * 0.2) : 0, hw = w / 2, hd = d / 2, P = [];
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {  // corners in order; a cut corner becomes two vertices
        const c = cut();
        if (!c) P.push([sx * hw, sz * hd]);
        else if (sx === sz) P.push([sx * hw, sz * (hd - c)], [sx * (hw - c * (0.6 + rng() * 0.8)), sz * hd]);
        else P.push([sx * (hw - c), sz * hd], [sx * hw, sz * (hd - c * (0.6 + rng() * 0.8))]);
      }
      extra = { ...extra, floe, poly: P.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]) };
      y0 = -0.4 + (y0 - 1.2) * 0.06;   // nearly level: tops between about 0.3 and 0.45 m
    }
    dyn.push({ id: 'd' + (++dynId), kind: 'float', x, z, y0, w, d, h: 0.7, mass: 30, ...extra });
  };
  // Spawn ring: evenly spaced around an ellipse just inside the edge field. An even count keeps the
  // ring mirror-symmetric left/right; at least 6 so small matches still get an interesting map.
  let N = Math.max(6, spawnCount); if (N % 2) N++;
  const rx = hx - 3.6, rz = hz - 3.4, ring = [];
  { // place by equal arc length so long sides don't bunch up
    const SEG = 720, pts = [], arc = [0];
    for (let i = 0; i <= SEG; i++) { const a = Math.PI + i / SEG * Math.PI * 2; pts.push([Math.cos(a) * rx, Math.sin(a) * rz]); if (i) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
    const total = arc[SEG];
    for (let k = 0, j = 0; k < N; k++) {
      const want = k / N * total; while (j < SEG - 1 && arc[j + 1] < want) j++;
      const f = (want - arc[j]) / ((arc[j + 1] - arc[j]) || 1);
      ring.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]);
    }
    // exact mirror symmetry (left/right and front/back)
    const sym = ring.map((p, k) => { const m = ring[(N / 2 - k + N) % N], q = ring[(N - k) % N], r = ring[(N / 2 + k) % N];
      return [(p[0] - m[0] + q[0] - r[0]) / 4, (p[1] + m[1] - q[1] - r[1]) / 4]; });
    ring.splice(0, N, ...sym);
  }
  const spacing = (2 * Math.PI * Math.sqrt((rx * rx + rz * rz) / 2)) / N;
  const ps = Math.max(2.8, Math.min(4.2, spacing - 1.6)), py = R(1.4, 1.8);
  ring.forEach(([x, z], k) => add(x, z, ps, ps, py + (k % 2 ? 0.25 : 0), { spawn: k }));
  // Stepping stones between neighboring spawn platforms so the ring is jumpable all the way round.
  const gap = spacing - ps, stones = gap > 3.4 ? (gap > 9 ? 2 : 1) : 0;
  for (let k = 0; k < N && stones; k++) {
    const [x1, z1] = ring[k], [x2, z2] = ring[(k + 1) % N];
    for (let j = 1; j <= stones; j++) {
      const t = j / (stones + 1), x = (x1 + (x2 - x1) * t) * 0.93, z = (z1 + (z2 - z1) * t) * 0.93;
      if (fits(x, z, 2.4, 2.4, 0.7)) add(x, z, 2.4, 2.4, py + 0.3 + 0.2 * Math.sin(k * 1.7 + j));
    }
  }
  const cw = R(4.5, 6.5), cd = R(4.5, 6.5);
  if (fits(0, 0, cw, cd)) add(0, 0, cw, cd, R(1.4, 2.0));            // center
  const n = Math.round((hx * hz) / (ice ? 26 : 45));
  const target = rects.length + n * 2;
  for (let i = 0; i < n * 4 && rects.length < target; i++) {          // scattered mirrored platforms
    const small = ice && rng() < 0.45;
    const w = small ? R(1.8, 2.4) : R(2.6, 5.2), d = small ? R(1.8, 2.4) : R(2.6, 5), x = R(ice ? 1.6 : 3, hx - 3 - w / 2), z = R(-hz + 2 + d / 2, hz - 2 - d / 2);
    if (!fits(x, z, w, d, ice ? 1 : 1.2) || !fits(-x, z, w, d, ice ? 1 : 1.2)) continue;
    const y0 = R(1.2, 3.0);
    add(x, z, w, d, y0); add(-x, z, w, d, y0);
  }
  // Moving platforms (always at least two pairs), sliding over the lava between the others (none on the ice)
  if (ice) return dyn;
  let movers = 0;
  for (let i = 0; i < 40 && movers < 2 + Math.floor(hx / 14); i++) {
    const amp = R(2.5, 4), axis = rng() < 0.5 ? 'x' : 'z', w = 2.6, d = 2.6;
    const x = R(3, hx - 4), z = R(-hz + 3, hz - 3);
    const span = axis === 'x' ? [w + amp * 2, d] : [w, d + amp * 2];
    if (!fits(x, z, span[0], span[1]) || !fits(-x, z, span[0], span[1])) continue;
    const y0 = R(1.6, 2.6), period = R(7, 11);
    for (const sx of [1, -1]) {
      rects.push([sx * x - span[0] / 2, sx * x + span[0] / 2, z - span[1] / 2, z + span[1] / 2]);
      dyn.push({ id: 'd' + (++dynId), kind: 'slide', x: sx * x, z, y0, w, d, h: 0.6, axis, amp, period, phase: sx > 0 ? 0 : Math.PI });
    }
    movers++;
  }
  return dyn;
}

// ---------- arena shapes ----------
// Generated maps can be a rectangle or a full polygon (hexagon, octagon, triangle, trapezoid, pentagon).
// The polygon sits inside the usual hx/hz bounds (which keep their invisible box walls as a backstop);
// its edges are extra walls handled by physics.js (clampToArena) and sim.js (bullets bounce off them).
export const SHAPES = ['rect', 'hex', 'oct', 'tri', 'trap', 'pent'];
const SHAPE_NAMES = { hex: 'Hexagon', oct: 'Octagon', tri: 'Triangle', trap: 'Trapezoid', pent: 'Pentagon' };
function shapeVerts(shape, hx, hz, s) {
  switch (shape) {
    case 'hex': return [[-hx, 0], [-hx / 2, -hz], [hx / 2, -hz], [hx, 0], [hx / 2, hz], [-hx / 2, hz]];
    case 'oct': { const k = 0.3, kz = 0.42; return [[-hx, -hz * (1 - kz)], [-hx * (1 - k), -hz], [hx * (1 - k), -hz], [hx, -hz * (1 - kz)], [hx, hz * (1 - kz)], [hx * (1 - k), hz], [-hx * (1 - k), hz], [-hx, hz * (1 - kz)]]; }
    case 'tri': return [[-hx, s * hz], [0, -s * hz], [hx, s * hz]];
    case 'trap': return [[-hx, s * hz], [-hx * 0.5, -s * hz], [hx * 0.5, -s * hz], [hx, s * hz]];
    case 'pent': return [[0, -s * hz], [hx, -s * hz * 0.25], [hx * 0.65, s * hz], [-hx * 0.65, s * hz], [-hx, -s * hz * 0.25]];
    default: return null;
  }
}
function polyArea(v) { let a = 0; for (let i = 0; i < v.length; i++) { const [x1, z1] = v[i], [x2, z2] = v[(i + 1) % v.length]; a += x1 * z2 - x2 * z1; } return Math.abs(a) / 2; }
export function polyCentroid(v) { let x = 0, z = 0; for (const p of v) { x += p[0]; z += p[1]; } return [x / v.length, z / v.length]; }
// Edge lines of the playable area (rectangle walls or polygon sides), each with its inward unit normal:
// a point is inside an edge when n.x*x + n.z*z - c >= 0.
export function arenaEdges(level) {
  const v = level.poly || [[-level.hx, -level.hz], [level.hx, -level.hz], [level.hx, level.hz], [-level.hx, level.hz]];
  const [cx, cz] = polyCentroid(v), out = [];
  for (let i = 0; i < v.length; i++) {
    const [ax, az] = v[i], [bx, bz] = v[(i + 1) % v.length], L = Math.hypot(bx - ax, bz - az) || 1;
    let nx = -(bz - az) / L, nz = (bx - ax) / L;
    if (nx * (cx - ax) + nz * (cz - az) < 0) { nx = -nx; nz = -nz; }
    out.push({ ax, az, bx, bz, nx, nz, c: nx * ax + nz * az, len: L });
  }
  return out;
}
// Smallest distance from (x,z) to any arena edge (negative = outside).
export function edgeDistance(edges, x, z) { let d = Infinity; for (const e of edges) d = Math.min(d, e.nx * x + e.nz * z - e.c); return d; }
// Point on the arena boundary along a ray from the arena's center, pulled `inset` meters inside.
export function boundaryPoint(level, ang, inset = 1.8) {
  const edges = level.edges || arenaEdges(level), v = level.poly;
  const [cx, cz] = v ? polyCentroid(v) : [0, 0], ux = Math.cos(ang), uz = Math.sin(ang);
  let t = Infinity;
  for (const e of edges) { const nu = e.nx * ux + e.nz * uz; if (nu < -1e-6) t = Math.min(t, (e.c + inset - (e.nx * cx + e.nz * cz)) / nu); }
  if (!isFinite(t) || t < 0) t = 0;
  return { x: cx + ux * t, z: cz + uz * t };
}

// themeSet: 'standard' | 'experimental' | 'all' | a single theme name ('forest', 'castle', ...)
export function pickTheme(rng, themeSet = 'standard') {
  const one = ART.themes.findIndex(t => t.name.toLowerCase() === String(themeSet).toLowerCase());
  if (one >= 0) return one;
  const ids = ART.themes.map((t, i) => [t, i]).filter(([t]) => themeSet === 'all' || (themeSet === 'experimental' ? t.experimental : !t.experimental)).map(([, i]) => i);
  return ids.length ? ids[Math.floor(rng() * ids.length)] : 0;
}
// opts.noLava: co-op waves never use Lava Lake (bots can't navigate the floating platforms well enough).
// opts.shape: force an arena shape (tests / debugging).
export function generateLevel(nPlayers, source, seed, themeSet, spawnCount = nPlayers, opts = {}) {
  const rng = mulberry32(seed);
  let { hx, hz } = arenaSize(nPlayers);
  let boxes = [], name, dynamic = [], lava = false, ice = false, poly = null, shape = 'rect', traps = null;
  if (opts.noLava && (source === 'lava' || source === 'ice')) source = 'generated';
  const roll = rng();
  // Liquid-floor maps (Lava Lake, Ice Sheets): forced by the map setting, or a 15% roll in Mixed among the
  // kinds the lobby leaves ticked (opts.liquids = { lava, ice }).
  let liquid = source === 'lava' || source === 'ice' ? source : null;
  if (!liquid && !opts.noLava && source === 'mixed' && roll < 0.15) {
    const kinds = ['lava', 'ice'].filter(k => !opts.liquids || opts.liquids[k] !== false);
    if (kinds.length) liquid = kinds[Math.floor(rng() * kinds.length)];
  }
  const isLava = !!liquid;
  const classic = !isLava && (source === 'classic' || (source === 'mixed' && roll < 0.5));
  const trapped = !isLava && (source === 'traps' || (classic && rng() < 0.35));   // v1.2.15: trap arenas (in Mixed and Classic too)
  const rects = [];
  if (trapped) {
    const T = trapLayout(rng, hx, hz, boxes, rects);
    name = T.name; dynamic = T.dynamic; traps = T.traps;
  } else if (isLava) {
    ice = liquid === 'ice'; lava = true;   // 'lava' marks any liquid floor (floating platforms); 'ice' picks the water rules
    name = ice ? 'Ice Sheets' : 'Lava Lake';
    dynamic = lavaLayout(rng, hx, hz, spawnCount, ice);
  } else if (classic) {
    const L = CLASSIC[Math.floor(rng() * CLASSIC.length)];
    name = L.name;
    const sx = hx / 18, sz = hz / 11;
    for (const [x, z, w, d, h, y0 = 0] of L.boxes) {
      boxes.push({ x: x * sx, z: z * sz, w: w * sx, d: d * sz, h, y0 });
      if (x !== 0) boxes.push({ x: -x * sx, z: z * sz, w: w * sx, d: d * sz, h, y0 });
    }
    for (const b of boxes) rects.push([b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2]);
    toMeters(boxes);
    dynamic = placeDynamics(rng, hx, hz, rects, { pistonChance: 0.4, slideChance: 0.3 });
  } else {
    // Arena shape: a rectangle about a third of the time, otherwise a full polygon. Polygons are scaled up
    // so the playable area stays close to the rectangle's.
    const sr = rng(), flip = rng() < 0.5 ? 1 : -1;
    shape = opts.shape || (sr < 0.34 ? 'rect' : sr < 0.52 ? 'hex' : sr < 0.64 ? 'oct' : sr < 0.76 ? 'tri' : sr < 0.9 ? 'trap' : 'pent');
    let areaFrac = 1;
    if (shape !== 'rect') {
      const f = polyArea(shapeVerts(shape, hx, hz, flip)) / (4 * hx * hz);
      const k = Math.min(1.42, Math.pow(1 / f, 0.5));
      hx = Math.round(hx * k); hz = Math.round(hz * k);
      poly = shapeVerts(shape, hx, hz, flip);
      areaFrac = polyArea(poly) / (4 * hx * hz);
    }
    name = poly ? 'Generated ' + SHAPE_NAMES[shape] : 'Generated';
    const tmp = { hx, hz, poly }, edges = arenaEdges(tmp);
    const inside = poly ? (r, m) => [[r[0], r[2]], [r[1], r[2]], [r[0], r[3]], [r[1], r[3]]].every(([x, z]) => edgeDistance(edges, x, z) >= m) : null;
    boxes = genBoxes(rng, hx, hz, rects, inside, areaFrac, shape === 'tri' || shape === 'trap' || shape === 'pent');
    toMeters(boxes);
    dynamic = placeDynamics(rng, hx, hz, rects, { inside });
  }
  const W = 3.5;
  boxes.push(
    // Walls: 'h' is what you see, 'ch' is the invisible collider height so nobody can jump out.
    { x: 0, z: -hz - 0.5, w: hx * 2 + 2, d: 1, h: W, ch: 40, y0: 0, wall: true },
    { x: 0, z: hz + 0.5, w: hx * 2 + 2, d: 1, h: 1.2, ch: 40, y0: 0, wall: true }, // low near wall so the camera can see over it
    { x: -hx - 0.5, z: 0, w: 1, d: hz * 2 + 2, h: W, ch: 40, y0: 0, wall: true },
    { x: hx + 0.5, z: 0, w: 1, d: hz * 2 + 2, h: W, ch: 40, y0: 0, wall: true },
  );
  if (lava) for (const b of boxes) if (b.wall) { b.h = 0.15; b.field = true; } // invisible boundary (drawn as a faint field)
  const theme = lava ? pickTheme(rng, 'standard') : pickTheme(rng, themeSet);
  // Forest: sliding blocks and rising pillars don't make sense among trees and boulders, so they stay put
  // as ordinary static blocks (crates and barrels still move).
  if (!lava && !traps && ART.themes[theme] && ART.themes[theme].style === 'forest') {
    dynamic = dynamic.filter(o => {
      if (o.kind !== 'slide' && o.kind !== 'piston') return true;
      boxes.push({ x: o.x, z: o.z, w: o.w, d: o.d, h: o.kind === 'piston' ? unitToM(2) : o.h, y0: 0 });
      return false;
    });
  }
  return { seed, name, hx, hz, lava, ice, theme, boxes, dynamic, poly, shape, traps };
}

// Spawn points on the arena's inner perimeter, one cluster per group (player or team).
// opts.coop: exactly two groups (the squad, then the wave) on opposite ends of the arena's long axis.
export function spawnPoints(level, groupSizes, opts = {}) {
  if (level.lava) {
    // One spawn platform per person, from the symmetric spawn ring. Groups (teams) get neighboring
    // platforms; everyone is spread as evenly as possible around the ring.
    let plats = level.dynamic.filter(o => o.kind === 'float' && o.spawn != null).sort((a, b) => a.spawn - b.spawn);
    if (!plats.length) plats = level.dynamic.filter(o => o.kind === 'float');
    const M = groupSizes.reduce((a, b) => a + b, 0), P = plats.length;
    const at = i => { const pl = plats[Math.floor(i * P / Math.max(1, M)) % P]; return { pl, extra: Math.floor(i / P) }; };
    let i = 0;
    return groupSizes.map(m => Array.from({ length: m }, () => {
      const { pl, extra } = at(i++);  // extra > 0 only if there are more people than platforms
      return { x: pl.x + (extra ? ((extra % 2) ? 1 : -1) * 0.9 : 0), z: pl.z, y: pl.y0 + pl.h };
    }));
  }
  const G = groupSizes.length;
  if (opts.coop) {
    // Squad on the left end, the wave on the right end (far side), in up to three rows each.
    return groupSizes.map((m, g) => {
      const base = g === 0 ? Math.PI : 0, pts = [], perRow = g === 0 ? 6 : 8;
      for (let k = 0; k < m; k++) {
        const row = Math.floor(k / perRow) % 3, n = Math.min(perRow, m - row * perRow), j = k % perRow;
        const a = base + (j - (n - 1) / 2) * (g === 0 ? 0.13 : 0.1);
        pts.push(boundaryPoint(level, a, 1.8 + row * 1.9));
      }
      return pts;
    });
  }
  return groupSizes.map((m, g) => {
    const base = Math.PI + g * 2 * Math.PI / G, pts = [];
    const step = Math.min(0.22, 1.6 / Math.max(1, G) / Math.max(1, m) + 0.08);
    for (let k = 0; k < m; k++) pts.push(boundaryPoint(level, base + (k - (m - 1) / 2) * step, 1.8));
    return pts;
  });
}

// Remove any non-wall box that would trap a spawning player.
export function clearSpawns(level, points) {
  const clear = b => points.every(p => p.y > 0 ||
    p.x + 1.3 <= b.x - b.w / 2 || p.x - 1.3 >= b.x + b.w / 2 || p.z + 1.3 <= b.z - b.d / 2 || p.z - 1.3 >= b.z + b.d / 2);
  level.boxes = level.boxes.filter(b => b.wall || clear(b));
  level.dynamic = level.dynamic.filter(o => o.kind === 'float' || clear({ x: o.x, z: o.z, w: o.w + (o.axis === 'z' ? 0 : 0), d: o.d + (o.amp ? o.amp * 2 : 0) }));
  if (level.traps) level.traps = level.traps.filter(t => t.kind !== 'spikes' || clear(t));   // (v1.2.15: no spike floor under a spawn)
  return level;
}
