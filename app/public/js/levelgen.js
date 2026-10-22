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
// v1.2.22 (Devin): big lobbies get noticeably bigger maps (more room per player past 8), and past 20 players the
// area keeps growing with the player count (the side length with its square root) up to the 100-player cap.
// v1.2.34 (Devin): spawns now spread over the whole floor (spawnPoints), so maps no longer need wall room for everyone:
// past 8 players they grow more slowly (about 100 x 66 m at 100 players instead of 135 x 93).
export function arenaSize(n) {
  n = Math.max(2, Math.min(RULES.maxPlayers || 100, n));
  const a = Math.min(8, n), b = Math.max(0, Math.min(20, n) - 8), c = Math.max(0, n - 20);
  const k = c ? Math.pow(n / 20, 0.45) : 1;
  return { hx: Math.round((15 + 2 * a + 1.3 * b) * k), hz: Math.round((9 + 1.5 * a + 0.9 * b) * k) };
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
  // v1.2.22 (Devin): pinch pistons [cx, cz, axis, gap, len, depth, period, phase] (axis: which way the jaws slide)
  { name: 'Pinch Alley', boxes: [[0,0,2,2,3],[8,6,2,1,1],[8,-6,2,1,1],[14,0,1.2,4,2],[4,9,3,1,1],[4,-9,3,1,1]],
    pinches: [[5,0,'z',3,3,2.6,5,0],[11,5.5,'x',2.6,2.6,2.6,6,2],[11,-5.5,'x',2.6,2.6,2.6,6,5],[0,6.5,'x',2.8,2.6,2.6,5.5,1.2],[0,-6.5,'x',2.8,2.6,2.6,5.5,3.8]],
    crushers: [[15.5,6.5,2.6,2.6,6,1]] },
];
function trapLayout(rng, hx, hz, boxes, rects) {
  const L = TRAP_MAPS[Math.floor(rng() * TRAP_MAPS.length)], sx = hx / 18, sz = hz / 11, mir = x => (x !== 0 ? [1, -1] : [1]);
  for (const [x, z, w, d, h, y0 = 0] of L.boxes) for (const m of mir(x)) boxes.push({ x: m * x * sx, z: z * sz, w: w * sx, d: d * sz, h, y0 });
  for (const b of boxes) rects.push([b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2]);
  toMeters(boxes);
  const dynamic = [], traps = [];
  for (const [x, z, w, d, period, phase] of L.crushers || []) for (const m of mir(x)) dynamic.push({ id: 'd' + (++dynId), kind: 'crusher', x: m * x * sx, z: z * sz, y0: 3.4, top: 3.4, w: w * sx, d: d * sz, h: 1.3, period, phase: phase + (m < 0 ? period / 2 : 0) });
  for (const [x, z, axis, gap, len, dep, period, phase] of L.pinches || []) for (const m of mir(x)) for (const side of [-1, 1]) {
    const cx = m * x * sx, cz = z * sz, k = axis === 'x' ? sx : sz, Ln = len * k, G = gap * k, D = dep * (axis === 'x' ? sz : sx);
    const c = axis === 'x' ? cx : cz, pos = c + side * (Ln / 2 + G);
    dynamic.push({ id: 'd' + (++dynId), kind: 'pinch', axis, c, side, len: Ln, gap: G, x: axis === 'x' ? pos : cx, z: axis === 'x' ? cz : pos, y0: 0,
      w: axis === 'x' ? Ln : D, d: axis === 'x' ? D : Ln, h: 2.6, period, phase: phase + (m < 0 ? period / 2 : 0) });
  }
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

// ---------- v1.2.22 (Devin) shaped arenas: star (a leg per player), cross, ring, bowtie, spiral-free "wheel" ----------
// The playable area is a convex hull (level.poly, so walls, bullets and clamping work as for any polygon arena) with the
// parts outside the shape filled by tall blocks (merged into as few boxes as possible). inside(x, z, m): in the shape
// with m meters to spare. Legs/arms point at the same angles spawnPoints uses (PI + g * 2PI / G), so each player gets one.
export const SHAPED = ['star', 'cross', 'ring', 'flower', 'wheel', 'pods', 'hive', 'bowtie'];
const SHAPED_NAMES = { star: 'Star', cross: 'Cross', ring: 'Ring', flower: 'Flower', wheel: 'Wheel', pods: 'Pods', hive: 'Hive', bowtie: 'Bowtie' };
// distance from (x, z) to the segment a-b
const segDist = (x, z, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz, k = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0; return Math.hypot(x - ax - dx * k, z - az - dz * k); };
const circleHull = (R, K = 24) => Array.from({ length: K }, (_, i) => { const a = i * 2 * Math.PI / K; return [Math.cos(a) * R, Math.sin(a) * R]; });
function shapedArena(kind, nPlayers, rng) {
  const N = kind === 'cross' ? 4 : Math.max(5, Math.min(24, nPlayers));
  let R, hull, inside, legAng = null;
  const ang0 = Math.PI;
  if (kind === 'star' || kind === 'cross' || kind === 'wheel' || kind === 'flower') {
    R = kind === 'cross' ? 28 + nPlayers * 0.6 : Math.max(26, 16 + N * 1.7);
    const flower = kind === 'flower';
    const wt = kind === 'cross' ? 6 : flower ? Math.min(7, R * Math.sin(Math.PI / N) * 0.9) : 3.6, wb = kind === 'cross' ? 6 : flower ? 2.6 : Math.max(wt, Math.min(7, R * Math.sin(Math.PI / N) * 0.95)), core = kind === 'cross' ? 7 : kind === 'wheel' ? R * 0.42 : Math.max(6, wb * 1.25, flower ? 7 : 0);
    legAng = Array.from({ length: N }, (_, i) => ang0 + i * 2 * Math.PI / N);
    hull = [];
    for (const a of legAng) {
      const ux = Math.cos(a), uz = Math.sin(a), vx = -uz, vz = ux;
      hull.push([ux * R - vx * wt, uz * R - vz * wt], [ux * R + vx * wt, uz * R + vz * wt]);
    }
    const rim = kind === 'wheel' ? [R - 3.5, R + 1] : null;   // wheel: an outer ring road joins the spokes
    inside = (x, z, m = 0) => {
      const rho = Math.hypot(x, z);
      if (rho <= core - m) return true;
      if (rim && rho >= rim[0] + m && rho <= rim[1]) return true;
      for (const a of legAng) {
        const ux = Math.cos(a), uz = Math.sin(a), t = x * ux + z * uz, d = Math.abs(-x * uz + z * ux);
        if (t >= -m && t <= R && d <= wb + (wt - wb) * Math.min(1, Math.max(0, t / R)) - m) return true;
      }
      return false;
    };
  } else if (kind === 'ring') {
    R = Math.max(24, 18 + nPlayers * 1.3);
    const hole = R * 0.42, K = 20;
    hull = Array.from({ length: K }, (_, i) => { const a = i * 2 * Math.PI / K; return [Math.cos(a) * R, Math.sin(a) * R]; });
    inside = (x, z, m = 0) => Math.hypot(x, z) >= hole + m;
  } else if (kind === 'pods') {
    // v1.2.26 (Devin: more shapes like the star): round rooms (one per player) round a middle room, joined by corridors
    // to the middle and to the rooms either side
    const N = Math.max(4, Math.min(14, nPlayers)), D = Math.max(20, 11 + N * 2.3), ri = Math.max(5, Math.min(8, D * Math.sin(Math.PI / N) * 0.78)), c = 8, bw = 1.7;
    legAng = Array.from({ length: N }, (_, i) => ang0 + i * 2 * Math.PI / N);
    const C = legAng.map(a => [Math.cos(a) * D, Math.sin(a) * D]);
    R = D + ri;
    hull = circleHull(R + 1);
    inside = (x, z, m = 0) => {
      if (Math.hypot(x, z) <= c - m) return true;
      for (let i = 0; i < N; i++) {
        const [cx, cz] = C[i], [nx, nz] = C[(i + 1) % N];
        if (Math.hypot(x - cx, z - cz) <= ri - m || segDist(x, z, 0, 0, cx, cz) <= bw - m || segDist(x, z, cx, cz, nx, nz) <= bw - m) return true;
      }
      return false;
    };
  } else if (kind === 'hive') {
    // v1.2.26: a honeycomb of hexagon rooms with doorways between neighbours (a second ring of rooms for big lobbies)
    const rings = nPlayers > 9 ? 2 : 1, s = Math.max(8, Math.min(12, 6 + nPlayers * 0.5)), inr = s * Math.sqrt(3) / 2, wall = 1.4, door = 1.8;
    const cells = [];
    for (let q = -rings; q <= rings; q++) for (let r = Math.max(-rings, -q - rings); r <= Math.min(rings, -q + rings); r++) cells.push([s * 1.5 * q, s * Math.sqrt(3) * (r + q / 2)]);
    const nrm = Array.from({ length: 6 }, (_, k) => [Math.cos(Math.PI / 6 + k * Math.PI / 3), Math.sin(Math.PI / 6 + k * Math.PI / 3)]);
    const pairs = [];
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) if (Math.hypot(cells[i][0] - cells[j][0], cells[i][1] - cells[j][1]) < inr * 2.2) pairs.push([cells[i], cells[j]]);
    R = Math.max(...cells.map(([x, z]) => Math.hypot(x, z))) + s;
    hull = circleHull(R + 0.5);
    inside = (x, z, m = 0) => {
      for (const [cx, cz] of cells) if (nrm.every(([nx, nz]) => (x - cx) * nx + (z - cz) * nz <= inr - wall / 2 - m)) return true;
      for (const [a, b] of pairs) if (segDist(x, z, a[0], a[1], b[0], b[1]) <= door - m) return true;
      return false;
    };
  } else if (kind === 'bowtie') {
    // v1.2.26: two wide halves that meet at a narrow waist, with a hole in each half to circle round
    R = Math.max(26, Math.min(60, 18 + nPlayers * 1.2));
    const Z = R * 0.72, waist = 4 + Math.min(4, nPlayers * 0.15), hole = R * 0.16;
    hull = [[-R, -Z], [R, -Z], [R, Z], [-R, Z]];
    inside = (x, z, m = 0) => Math.abs(x) <= R - m && Math.abs(z) <= waist + (Z - waist) * Math.min(1, Math.abs(x) / (R * 0.75)) - m && Math.hypot(Math.abs(x) - R * 0.55, z) >= hole + m;
  }
  const hx = Math.ceil(Math.max(...hull.map(v => Math.abs(v[0])))) + 1, hz = Math.ceil(Math.max(...hull.map(v => Math.abs(v[1])))) + 1;
  // fill: grid cells inside the hull but outside the shape, merged into rectangles (row runs, then equal runs stacked)
  const g = 1.6, tmp = { hx, hz, poly: hull }, edges = arenaEdges(tmp), nx = Math.ceil(hx * 2 / g), nz = Math.ceil(hz * 2 / g);
  const runs = [];
  for (let j = 0; j < nz; j++) {
    const z = -hz + (j + 0.5) * g; let start = -1;
    for (let i = 0; i <= nx; i++) {
      const x = -hx + (i + 0.5) * g;
      const fill = i < nx && edgeDistance(edges, x, z) > -g && !inside(x, z, -0.4);
      if (fill && start < 0) start = i;
      if (!fill && start >= 0) { runs.push({ i0: start, i1: i, j0: j, j1: j + 1 }); start = -1; }
    }
  }
  const merged = [];
  for (const r of runs) {
    const up = merged.find(q => q.j1 === r.j0 && q.i0 === r.i0 && q.i1 === r.i1);
    if (up) up.j1 = r.j1; else merged.push({ ...r });
  }
  const boxes = merged.map(q => ({ x: -hx + (q.i0 + q.i1) / 2 * g, z: -hz + (q.j0 + q.j1) / 2 * g, w: (q.i1 - q.i0) * g, d: (q.j1 - q.j0) * g, h: 3.2, ch: 40, y0: 0, fill: true }));
  return { name: SHAPED_NAMES[kind], hx, hz, poly: hull, inside, boxes, legAng };
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
  // v1.2.22 (Devin): shaped arenas. 'star' / 'shapes' in the lobby, and now and then in Mixed / Random generated
  let shapedInside = null;
  const srng = mulberry32((seed ^ 0x5eed5) >>> 0);   // (its own random stream, so the other map kinds come out as before)
  let shaped = !isLava && (SHAPED.includes(source) ? source : source === 'shapes' ? SHAPED[Math.floor(srng() * SHAPED.length)] : null);
  if (!shaped && !isLava && !opts.shape && (source === 'mixed' || source === 'generated') && spawnCount >= 3 && srng() < 0.18) shaped = SHAPED[Math.floor(srng() * SHAPED.length)];
  if (shaped === 'cross' && spawnCount > 4 && source !== 'cross') shaped = 'star';   // (the cross only has four arms)
  if (opts.shaped) shaped = opts.shaped;
  if (shaped) {
    const A = shapedArena(shaped, spawnCount, rng), rects = [];
    hx = A.hx; hz = A.hz; poly = A.poly; shape = shaped; name = A.name;
    const inside = (r, m) => [[r[0], r[2]], [r[1], r[2]], [r[0], r[3]], [r[1], r[3]], [(r[0] + r[1]) / 2, (r[2] + r[3]) / 2]].every(([x, z]) => A.inside(x, z, m));
    boxes = genBoxes(rng, hx, hz, rects, inside, 0.5, false);
    toMeters(boxes);
    boxes.push(...A.boxes);
    for (const b of A.boxes) rects.push([b.x - b.w / 2, b.x + b.w / 2, b.z - b.d / 2, b.z + b.d / 2]);
    dynamic = placeDynamics(rng, hx, hz, rects, { inside }).filter(o => A.inside(o.x, o.z, 1));
    shapedInside = A.inside;
  }
  const classic = !isLava && !shaped && (source === 'classic' || (source === 'mixed' && roll < 0.5));
  const trapped = !isLava && !shaped && (source === 'traps' || (classic && rng() < 0.35));   // v1.2.15: trap arenas (in Mixed and Classic too)
  const rects = [];
  if (shaped) { /* built above */ }
  else if (trapped) {
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
  const lv = { seed, name, hx, hz, lava, ice, theme, boxes, dynamic, poly, shape, traps };
  if (shapedInside) Object.defineProperty(lv, 'insideFn', { value: shapedInside, enumerable: false });   // (host only: spawns)
  return lv;
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
  // v1.2.28 (Devin): big lobbies (12+ sides, e.g. 100-player deathmatch) spawn all over the map, evenly apart, instead of
  // packed rings along the walls: open ground clear of blocks, picked farthest-first, so everyone gets room to breathe.
  // v1.2.34 (Devin): every lobby of 3+ sides spawns spread through the whole map, not just along the walls, which lets maps be smaller.
  if (G >= 3 && !opts.noSpread) { const S = spreadSpawns(level, groupSizes); if (S) return S; }
  // v1.2.22 (Devin): keep spawns apart in big lobbies. When the perimeter can't fit every group SPAWN_GAP apart, the
  // extra groups go on inner rings (each RING_STEP further in), spread round evenly and offset from the ring outside.
  const E = level.edges || arenaEdges(level), per = E.reduce((a, e) => a + e.len, 0);
  const SPAWN_GAP = 9, RING_STEP = 9, cap0 = Math.max(2, Math.floor(per / SPAWN_GAP));
  const vv = level.poly || [[-level.hx, -level.hz], [level.hx, -level.hz], [level.hx, level.hz], [-level.hx, level.hz]];
  const at = (u, inset) => {   // a point a fraction u of the way round the walls, on the outline shrunk inset meters in
    const ks = [1 - inset / level.hx, 1 - inset / level.hz], V = vv.map(([x, z]) => [x * ks[0], z * ks[1]]);
    const L = V.map((p, i) => Math.hypot(V[(i + 1) % V.length][0] - p[0], V[(i + 1) % V.length][1] - p[1])), P = L.reduce((a, b) => a + b, 0);
    let d = ((u % 1) + 1) % 1 * P;
    for (let i = 0; i < V.length; i++) { if (d <= L[i]) { const k = d / L[i], [ax, az] = V[i], [bx, bz] = V[(i + 1) % V.length]; return { x: ax + (bx - ax) * k, z: az + (bz - az) * k }; } d -= L[i]; }
    return { x: 0, z: 0 };
  };
  if (G > cap0 && !level.insideFn) {
    const rings = []; let left = G, r = 0;
    while (left > 0) { const shrink = Math.max(0.25, 1 - r * RING_STEP / Math.max(8, Math.min(level.hx, level.hz))); const cap = Math.max(1, Math.floor(cap0 * shrink)); const n = Math.min(left, cap); rings.push(n); left -= n; r++; }
    let gi = 0; const out = [];
    rings.forEach((n, ri) => { for (let k = 0; k < n; k++, gi++) {
      const m = groupSizes[gi], u = (k + (ri % 2) * 0.5) / n, pts = [];
      for (let q = 0; q < m; q++) pts.push(at(u + (q - (m - 1) / 2) * 1.6 / per, 2.2 + ri * RING_STEP));
      out.push(pts);
    } });
    return out;
  }
  if (G >= 6 && !level.insideFn) {   // v1.2.22: many groups: even spacing by distance along the walls (angles bunch up in corners)
    return groupSizes.map((m, g) => Array.from({ length: m }, (_, q) => at(g / G + (q - (m - 1) / 2) * 1.6 / per, 2.2)));
  }
  return groupSizes.map((m, g) => {
    const base = Math.PI + g * 2 * Math.PI / G, pts = [];
    const step = Math.min(0.22, 1.6 / Math.max(1, G) / Math.max(1, m) + 0.08);
    for (let k = 0; k < m; k++) {
      const a = base + (k - (m - 1) / 2) * step, p = boundaryPoint(level, a, 1.8);
      if (level.insideFn && !level.insideFn(p.x, p.z, 1.2)) {   // v1.2.22 shaped arenas: walk in along the ray until it is open ground
        const L0 = Math.hypot(p.x, p.z);
        for (let t = L0; t > 0; t -= 0.8) { const x = Math.cos(a) * t, z = Math.sin(a) * t; if (level.insideFn(x, z, 1.2)) { p.x = x; p.z = z; break; } }
      }
      pts.push(p);
    }
    return pts;
  });
}

// v1.2.28: farthest-point spawns over the whole floor (see spawnPoints). Groups of more than one stand together around
// their point. Null when the map has too little open ground (then the wall rings are used).
export function spreadSpawns(level, groupSizes) {
  const G = groupSizes.length, step = Math.max(1.5, Math.sqrt(4 * level.hx * level.hz / 6000)), cands = [];   // (about 6000 spots at most)
  const foot = [...level.boxes.filter(b => !b.wall && (b.y0 || 0) < 2.2), ...(level.dynamic || []).map(o => ({ x: o.x, z: o.z, w: o.w + 2 * (o.amp || 0), d: o.d + 2 * (o.amp || 0) })), ...(level.traps || [])];
  const free = (x, z) => {
    if (level.insideFn && !level.insideFn(x, z, 1.4)) return false;
    for (const b of foot) if (Math.abs(x - b.x) < b.w / 2 + 1.2 && Math.abs(z - b.z) < b.d / 2 + 1.2) return false;
    return true;
  };
  for (let x = -level.hx + 2; x <= level.hx - 2; x += step) for (let z = -level.hz + 2; z <= level.hz - 2; z += step) if (free(x, z)) cands.push([x, z]);
  const need = groupSizes.reduce((a, b) => a + b, 0);
  if (cands.length < need * 3) return null;
  // v1.2.34: start at the most open spot, then keep taking the spot farthest from everything taken so far (the walls
  // count too, else small lobbies all start in the corners).
  const E = level.edges || arenaEdges(level);
  const dist = new Float64Array(cands.length), taken = new Uint8Array(cands.length), centers = [];
  for (let j = 0; j < cands.length; j++) dist[j] = edgeDistance(E, cands[j][0], cands[j][1]) ** 2;
  let first = 0; for (let i = 1; i < cands.length; i++) if (dist[i] > dist[first] + 1e-6) first = i;
  const take = i => { taken[i] = 1; const [x, z] = cands[i]; for (let j = 0; j < cands.length; j++) { const d = (cands[j][0] - x) ** 2 + (cands[j][1] - z) ** 2; if (d < dist[j]) dist[j] = d; } };
  for (let g = 0, i = first; g < G; g++) {
    if (g > 0) { i = -1; let bd = -1; for (let j = 0; j < cands.length; j++) if (!taken[j] && dist[j] > bd) { bd = dist[j]; i = j; } if (i < 0) return null; }
    centers.push(i); take(i);
  }
  // then even them out (a few rounds of Lloyd's: each spawn moves to the middle of the open ground nearest to it), so
  // everyone gets about the same share of the map, in the middle as much as along the walls
  const gap = cs => { let m = Infinity; for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) m = Math.min(m, (cands[cs[a]][0] - cands[cs[b]][0]) ** 2 + (cands[cs[a]][1] - cands[cs[b]][1]) ** 2); return m; };
  const ff = centers.slice();
  const C = cands.length, own = new Int32Array(C), sx = new Float64Array(G), sz = new Float64Array(G), sn = new Float64Array(G);
  for (let it = 0; it < 10 && G > 1; it++) {
    sx.fill(0); sz.fill(0); sn.fill(0);
    for (let j = 0; j < C; j++) {
      const [x, z] = cands[j]; let b = 0, bd = Infinity;
      for (let g = 0; g < G; g++) { const c = cands[centers[g]], d = (c[0] - x) ** 2 + (c[1] - z) ** 2; if (d < bd) { bd = d; b = g; } }
      own[j] = b; sx[b] += x; sz[b] += z; sn[b]++;
    }
    const used = new Set();
    for (let g = 0; g < G; g++) {
      const mx = sx[g] / sn[g], mz = sz[g] / sn[g]; let b = centers[g], bd = Infinity;
      for (let j = 0; j < C; j++) if (own[j] === g && !used.has(j)) { const d = (cands[j][0] - mx) ** 2 + (cands[j][1] - mz) ** 2; if (d < bd) { bd = d; b = j; } }
      used.add(b); centers[g] = b;
    }
  }
  if (gap(ff) > gap(centers)) centers.splice(0, G, ...ff);   // (around lots of blocks that can bunch people up: keep whichever keeps the closest two further apart)
  taken.fill(0); for (const i of centers) taken[i] = 1;
  return groupSizes.map((m, g) => {
    const [cx, cz] = cands[centers[g]], pts = [{ x: cx, z: cz }];
    if (m > 1) {   // teammates: the nearest free spots around their point
      const near = cands.map((c, j) => [j, (c[0] - cx) ** 2 + (c[1] - cz) ** 2]).filter(([j, d]) => !taken[j] && d > 1.5).sort((a, b) => a[1] - b[1]);
      for (let k = 0; k < near.length && pts.length < m; k++) { const j = near[k][0]; if (pts.every(p => (p.x - cands[j][0]) ** 2 + (p.z - cands[j][1]) ** 2 > 2.2)) { taken[j] = 1; pts.push({ x: cands[j][0], z: cands[j][1] }); } }
      while (pts.length < m) pts.push({ x: cx + (pts.length % 2 ? 1 : -1) * 0.9, z: cz });
    }
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
