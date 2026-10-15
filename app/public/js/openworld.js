// Open world mode (lobby mode 'open'). One big generated map made of themed zones with hills, buildings with
// interiors and loot. Everyone drops out of a flying blue bus, free-falls, opens a parachute and lands.
// Colored loot gives a card of that rarity. Battle royale (a red wall closes in) or co-op extraction.
// Sim side only: no three.js in here (render side: owrender.js).
import { ART, RARITY, RULES } from './config.js';
import { mulberry32 } from './levelgen.js';
import { botThink, detour } from './ai.js';
import { segBlocked } from './physics.js';
import { unitSpec } from './coop.js';

export const OW = {
  half: 140,          // map half-size in meters (280 x 280)
  cell: 2.5,          // terrain heightfield resolution
  hill: 9,            // base hill height
  edgeRise: 30, edgeBand: 24,   // mountains along the map edge
  busY: 78, busSpeed: 17, busDelay: 1.5,
  fall: 30, chute: 6.5, freeDrift: 10, chuteDrift: 13, autoChute: 26,
  lootR: 1.25,
  fogNear: 28, fogFar: 125,
  ceil: 160,
  sight: 34,          // how far bots notice enemies
  search: 75,         // roaming bots wander toward heroes this close, even unseen
  landGrace: 20,      // ...but not in a hero's first seconds on the ground
  roamers: { off: 0, some: 1, lots: 4 },   // roaming bots per zone (v1.0.1: 'some' halved, Devin found 2 per zone too many)
  wall: { wait: 80, stages: [[110, 120, 40], [60, 100, 35], [24, 90, 25], [0, 80, 0]], dps: [3, 5, 8, 14, 20], kill: true, warn: 12 },   // [radius, shrink s, hold s]; v1.0.1: moves at half speed, touching it kills (kill), warning within warn m
  ext: { minDist: 125, r: 6, hold: 6, reinforce: 28 },
  revive: { time: 4, r: 1.7, hp: 0.4 },   // extraction: hold E on a fallen teammate this long; they come back with this share of health
  useR: 2.6,
  crouch: { speed: 0.5, sight: 0.35, body: 0.7, maxSize: 0.85 },   // v1.0.1: body = size multiplier while crouched, maxSize = cap (1.28 m tall: fits under stairs)   // crouching: walk speed and spotting range multipliers (v28: 0.5 -> 0.35, and no seeing a crouched hero through cover up close)
  // Ambush: when roaming bots start a fight with a hero after a quiet spell, sometimes a portal opens nearby and drops
  // a few more in. chance per fight, cd = seconds before another can happen, max per match, calm = quiet seconds that count as a new fight.
  ambush: { chance: 0.4, cd: 90, max: 4, calm: 12, delay: 1.3, r: [9, 14] },
};
// Vehicles: top speed, acceleration, turn rate (rad/s at speed), and who can ride.
export const VEH = {
  scooter: { max: 13, acc: 9, turn: 2.6, i: 0 },
  bike:    { max: 17, acc: 8, turn: 2.2, i: 1 },
  car:     { max: 22, acc: 7, turn: 1.6, i: 2, ram: true, hp: 420, boom: 70 },   // the car soaks its driver's damage; at 0 it blows up
};
export const VEH_KINDS = Object.keys(VEH);
// Loot tiers, in the colors of the card rarities (RARITY in config.js).
export const LOOT_TIERS = ['common', 'uncommon', 'rare', 'legendary', 'mod', 'shieldmod', 'holy', 'cursed'];
const LOOT_W = [44, 27, 15, 3.6, 3.5, 3.5, 0.9, 0.9];   // legendary kept a bit rarer
export const lootColor = i => (RARITY[LOOT_TIERS[i]] || RARITY.common).color;
export const OW_STATE = { bus: 1, fall: 2, chute: 3 };

// ---------------------------------------------------------------- noise
function hash2(ix, iz, s) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, s) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, z, s) => vnoise(x, z, s) * 0.6 + vnoise(x * 2.1, z * 2.1, s + 7) * 0.28 + vnoise(x * 4.3, z * 4.3, s + 13) * 0.12;
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

// How hilly each theme's zone is.
const HILLS = { castle: 1.1, western: 0.9, candy: 1.0, forest: 1.25, tundra: 1.7, neon: 0.3, sakura: 0.85, tropical: 0.45, lunar: 0.8, volcano: 1.45 };
const zoneStyle = (level, i) => (ART.themes[level.zones[i].theme] || {}).style || '';

// Base hills (before building pads are flattened).
function baseHeight(level, x, z) {
  const s = level.seed | 0, H = OW.half;
  let amp = 0, wsum = 0;
  for (const zn of level.zones) { const d = Math.hypot(x - zn.x, z - zn.z), w = 1 / Math.pow(d + 12, 4); amp += w * zn.amp; wsum += w; }
  amp /= wsum;
  let h = Math.max(0, fbm(x / 52, z / 52, s) - 0.32) * OW.hill * 1.6 * amp;
  const e = H - Math.max(Math.abs(x), Math.abs(z));
  if (e < OW.edgeBand) h += OW.edgeRise * Math.pow(1 - e / OW.edgeBand, 2) * (0.7 + 0.6 * vnoise(x / 9, z / 9, s + 3));
  return h;
}

// Builds level.hf (heights), level.hAt(x,z) and level.zoneAt(x,z). Deterministic from the level data,
// so clients rebuild exactly the host's terrain from the network level.
export function buildTerrain(level) {
  const H = OW.half, c = OW.cell, n = Math.round(2 * H / c) + 1;
  const hf = new Float32Array(n * n), zf = new Uint8Array(n * n);
  const pads = level.pads || [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -H + i * c, z = -H + j * c;
    let h = baseHeight(level, x, z);
    for (const p of pads) {   // flatten building pads (a 3 m flat apron, then a 7 m blend)
      const dx = Math.max(0, Math.abs(x - p.x) - p.w / 2 - 3), dz = Math.max(0, Math.abs(z - p.z) - p.d / 2 - 3);
      const d = Math.hypot(dx, dz);
      if (d < 7) h += (p.y - h) * (1 - smooth(d / 7));
    }
    hf[j * n + i] = h;
    zf[j * n + i] = zoneIndex(level, x, z);
  }
  level.hf = hf; level.hfN = n; level.zf = zf;
  level.hAt = (x, z) => {
    const fx = clampN((x + H) / c, n), fz = clampN((z + H) / c, n);
    const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(n - 2, Math.floor(fz)), u = fx - i, v = fz - j, k = j * n + i;
    return hf[k] * (1 - u) * (1 - v) + hf[k + 1] * u * (1 - v) + hf[k + n] * (1 - u) * v + hf[k + n + 1] * u * v;
  };
  level.zoneAt = (x, z) => zf[Math.round(clampN((z + H) / c, n)) * n + Math.round(clampN((x + H) / c, n))];
  return level;
}
const clampN = (v, n) => v < 0 ? 0 : v > n - 1 ? n - 1 : v;
// Nearest zone seed, with a little noise so borders wander.
function zoneIndex(level, x, z) {
  const s = level.seed | 0, wx = x + (vnoise(x / 30, z / 30, s + 21) - 0.5) * 30, wz = z + (vnoise(x / 30, z / 30, s + 33) - 0.5) * 30;
  let best = 0, bd = Infinity;
  level.zones.forEach((zn, i) => { const d = (wx - zn.x) ** 2 + (wz - zn.z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

// ---------------------------------------------------------------- buildings
// Per theme: footprint, floors, floor height, colors and a few shape extras.
const STYLE = {
  castle:   { W: [10, 15], D: [10, 14], floors: [1, 3], FH: 3.6, th: 0.6, wall: '#8a857b', floor: '#6b6760', roof: '#5e5a54', trim: '#a8232e', crenel: true },
  western:  { W: [8, 12], D: [9, 13], floors: [1, 2], FH: 3.2, wall: '#a0703e', floor: '#83582e', roof: '#6b4423', trim: '#d9b37a', porch: true, falseFront: true },
  candy:    { W: [7, 11], D: [7, 11], floors: [1, 2], FH: 3.2, wall: ['#d9609f', '#3fb898', '#e0a83a', '#8f5cc0'], floor: '#b07898', roof: '#c03f80', trim: '#e2d2dc', stripes: true },   // v26: no glaring whites
  forest:   { W: [7, 10], D: [7, 9], floors: [1, 1], FH: 3.0, wall: '#7a5a3a', floor: '#5d4630', roof: '#4a3b2a', trim: '#5e8a34', gable: true },
  tundra:   { W: [7, 10], D: [7, 10], floors: [1, 1], FH: 3.0, wall: '#b6c4d2', floor: '#8fa2b4', roof: '#c8d4e0', trim: '#6a8299', gable: true },
  neon:     { W: [10, 14], D: [10, 14], floors: [2, 4], FH: 3.2, wall: '#2a1f4a', floor: '#2c1f52', roof: '#140c24', trim: ['#ff3da8', '#3fe0ff'], glow: true },
  sakura:   { W: [9, 12], D: [9, 12], floors: [1, 3], FH: 3.2, wall: '#7a4a35', floor: '#c9b48a', roof: '#3d2a22', trim: '#c8323c', tiered: true },
  tropical: { W: [7, 10], D: [7, 10], floors: [1, 1], FH: 3.0, wall: '#b89a5a', floor: '#9a7d42', roof: '#d8c08a', trim: '#6fbf4a', stilts: 1.6, gable: true },
  lunar:    { W: [9, 13], D: [8, 11], floors: [1, 1], FH: 3.2, wall: '#a8abb4', floor: '#8a8e98', roof: '#9a9ea8', trim: '#ffb000', glow: true },
  volcano:  { W: [8, 12], D: [8, 12], floors: [1, 2], FH: 3.4, th: 0.6, wall: '#3a2e30', floor: '#4a3a3a', roof: '#1e1719', trim: '#ff6a2a', glow: true },
  plain:    { W: [8, 12], D: [8, 12], floors: [1, 2], FH: 3.2, wall: null, floor: null, roof: null, trim: null },
};
const pickC = (c, rng) => Array.isArray(c) ? c[Math.floor(rng() * c.length)] : c;

// A wall along x (fixed z) or along z (fixed x), from a to b, with gaps (doors / windows).
// gap: { c: center along the wall, w: width, lo: bottom above y0, hi: top above y0 }
function wallRun(add, axis, a, b, k, y0, h, th, gaps, col) {
  gaps = gaps.filter(g => g.c - g.w / 2 > a + 0.3 && g.c + g.w / 2 < b - 0.3);
  const doors = gaps.filter(g => g.lo <= 0);   // a window overlapping a door would leave its sill across the doorway
  gaps = gaps.filter(g => g.lo <= 0 || doors.every(d => Math.abs(d.c - g.c) > (d.w + g.w) / 2 + 0.15)).sort((p, q) => p.c - q.c);
  const seg = (s0, s1, yb, yt) => {
    if (s1 - s0 < 0.05 || yt - yb < 0.05) return;
    const m = (s0 + s1) / 2, L = s1 - s0;
    if (axis === 'x') add(m, y0 + yb, k, L, yt - yb, th, col); else add(k, y0 + yb, m, th, yt - yb, L, col);
  };
  let s = a;
  for (const g of gaps) {
    const g0 = g.c - g.w / 2, g1 = g.c + g.w / 2;
    seg(s, g0, 0, h);
    if (g.lo > 0) seg(g0, g1, 0, g.lo);
    if (g.hi < h) seg(g0, g1, g.hi, h);
    s = g1;
  }
  seg(s, b, 0, h);
}

function makeBuilding(rng, cx, cz, gy, style, zone, boxes, loot) {
  const S = STYLE[style] || STYLE.plain, R = (a, b) => a + rng() * (b - a);
  const T = ART.themes[zone.theme] || ART.themes[0];
  const W = Math.round(R(S.W[0], S.W[1])), D = Math.round(R(S.D[0], S.D[1]));
  const floors = Math.max(1, Math.round(R(S.floors[0] - 0.4, S.floors[1] + 0.4)));
  const FH = S.FH, th = S.th || 0.4, z = zone.i;
  const cWall = pickC(S.wall, rng) || T.bandA, cFloor = S.floor || T.top, cRoof = S.roof || T.wall, cTrim = pickC(S.trim, rng) || T.bandB;
  const add = (x, y0, zz, w, h, d, c, extra) => { boxes.push({ x: r2(x), y0: r2(y0), z: r2(zz), w: r2(w), h: r2(h), d: r2(d), c, zone: z, ...extra }); };
  const lift = S.stilts || 0, base = gy + lift;
  const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;
  const doorSide = rng() < 0.5 ? 1 : -1;   // front door on +z or -z
  // Stairs: a run of steps along a side wall, under a hole in the floor above.
  // v28: 0.2 m risers that you walk straight up like a ramp (physics steps onto `stair` boxes), same run length as before.
  const stepN = Math.round(FH / 0.2), stepD = Math.round(FH / 0.8) * 0.95 / stepN, sw = 1.7, rise = FH / stepN;
  // Floors alternate the stair run between the -x and +x walls, so a run never sits right on top of the one below.
  const sz0 = cz - stepN * stepD / 2, sz1 = sz0 + stepN * stepD;
  const col = f => f % 2 ? [x1 - th - sw, x1 - th] : [x0 + th, x0 + th + sw];
  if (lift) {   // stilt hut: posts, a deck and a step up to the door
    for (const [px, pz] of [[x0 + 0.3, z0 + 0.3], [x1 - 0.3, z0 + 0.3], [x0 + 0.3, z1 - 0.3], [x1 - 0.3, z1 - 0.3]]) add(px, gy, pz, 0.35, lift, 0.35, cRoof);
    add(cx, gy + lift - 0.3, cz, W, 0.3, D, cFloor);
  } else add(cx, gy - 0.6, cz, W, 0.64, D, cFloor);   // ground floor slab, a hair above the flattened pad so the two never z-fight
  let frontDoor = cx, backDoor = null;
  for (let f = 0; f < floors; f++) {
    const fy = base + f * FH, top = f === floors - 1;
    const hgt = FH - (f < floors - 1 ? 0.3 : 0);
    const win = () => ({ c: 0, w: 1.3, lo: 1.0, hi: 2.1 });
    const front = [], back = [], left = [], right = [];
    if (f === 0) { front.push({ c: cx + R(-W / 4, W / 4), w: 1.8, lo: 0, hi: 2.5 }); frontDoor = front[0].c; }
    if (f === 0 && rng() < 0.5) { back.push({ c: cx + R(-W / 4, W / 4), w: 1.8, lo: 0, hi: 2.5 }); backDoor = back[0].c; }
    for (let k = 0; k < Math.floor(W / 4.5); k++) { const g = win(); g.c = x0 + (k + 0.5) * W / Math.floor(W / 4.5); (f === 0 ? back : front).push(g); if (f > 0) back.push({ ...g }); }
    for (let k = 0; k < Math.floor(D / 5); k++) { const g = win(); g.c = z0 + (k + 0.5) * D / Math.floor(D / 5); right.push(g); if (f > 0) left.push({ ...g }); }
    const fz = doorSide > 0 ? z1 - th / 2 : z0 + th / 2, bz = doorSide > 0 ? z0 + th / 2 : z1 - th / 2;
    let fh = hgt + (top && S.falseFront ? 1.6 : 0);
    wallRun(add, 'x', x0, x1, fz, fy, fh, th, front, cWall);
    wallRun(add, 'x', x0, x1, bz, fy, hgt, th, back, cWall);
    wallRun(add, 'z', z0 + th, z1 - th, x0 + th / 2, fy, hgt, th, left, cWall);
    wallRun(add, 'z', z0 + th, z1 - th, x1 - th / 2, fy, hgt, th, right, cWall);
    // stairs up to the next floor
    const [sx0, sx1] = col(f), [hx0, hx1] = f > 0 ? col(f - 1) : [0, 0];   // this floor's stairs; the hole down to the floor below
    if (!top) for (let k = 0; k < stepN; k++) add((sx0 + sx1) / 2, fy, sz0 + (k + 0.5) * stepD, sw, rise * (k + 1), stepD, cTrim, { stair: 1 });
    // the floor above (or the roof), with the stair hole cut out
    const sy = fy + FH - 0.3;
    if (!top) {
      const ix0 = x0 + th, ix1 = x1 - th, iz0 = z0 + th, iz1 = z1 - th;
      const onLeft = f % 2 === 0, mx0 = onLeft ? sx1 : ix0, mx1 = onLeft ? ix1 : sx0, cx0 = onLeft ? ix0 : sx0, cx1 = onLeft ? sx1 : ix1;
      add((mx0 + mx1) / 2, sy, cz, mx1 - mx0, 0.3, iz1 - iz0, cFloor);
      if (sz0 > iz0) add((cx0 + cx1) / 2, sy, (iz0 + sz0 - 0.4) / 2, cx1 - cx0, 0.3, sz0 - 0.4 - iz0, cFloor);
      if (sz1 < iz1) add((cx0 + cx1) / 2, sy, (sz1 + 0.4 + iz1) / 2, cx1 - cx0, 0.3, iz1 - sz1 - 0.4, cFloor);
      if (S.tiered) for (const [ex, ez, ew, ed] of [[cx, z0 - 0.7, W + 2.6, 1.4], [cx, z1 + 0.7, W + 2.6, 1.4], [x0 - 0.7, cz, 1.4, D], [x1 + 0.7, cz, 1.4, D]]) add(ex, sy + 0.1, ez, ew, 0.22, ed, cRoof, { deco: 1 });
    } else {
      add(cx, sy, cz, W + 0.6, 0.35, D + 0.6, cRoof);
      if (S.gable) for (let k = 1; k <= 3; k++) add(cx, sy + 0.35 * k, cz, W + 0.6 - k * W / 4, 0.35, D + 0.6, cRoof, { deco: 1 });
      if (S.tiered) add(cx, sy + 0.35, cz, W + 2.8, 0.25, D + 2.8, cRoof, { deco: 1 });
      if (S.crenel) for (let k = 0; k < Math.floor(W / 1.6); k++) for (const ez of [z0 + 0.25, z1 - 0.25]) add(x0 + 0.8 + k * 1.6, sy + 0.35, ez, 0.8, 0.7, 0.5, cWall);
      if (S.glow) add(cx, sy - 0.12, cz, W + 0.66, 0.1, D + 0.66, cTrim, { deco: 1, glow: 1 });
    }
    // v28: trim bands go round the outside of the walls (they used to be one full-size sheet across the inside: a
    // "floating floor" through the middle of the ground floor, and a glowing sheet across the stairwell you passed through)
    const band = (y, h, c, extra) => { const t = 0.08; add(cx, y, z0 - t / 2, W + 2 * t, h, t, c, extra); add(cx, y, z1 + t / 2, W + 2 * t, h, t, c, extra); add(x0 - t / 2, y, cz, t, h, D, c, extra); add(x1 + t / 2, y, cz, t, h, D, c, extra); };
    if (S.glow && !top) band(sy + 0.1, 0.1, cTrim, { deco: 1, glow: 1 });
    if (S.stripes && f === 0) band(fy + 1.0, 0.3, cTrim, { deco: 1 });
    // loot and a crate or table of cover on every floor
    const ix0 = x0 + th + 0.9, ix1 = x1 - th - 0.9, iz0 = z0 + th + 0.9, iz1 = z1 - th - 0.9;
    const nearDoor = (x, zz) => [[frontDoor, doorSide > 0 ? z1 : z0], [backDoor, doorSide > 0 ? z0 : z1]].some(([dx, dz]) => dx != null && Math.abs(x - dx) < 2 && Math.abs(zz - dz) < 2.2);
    const spot = () => { for (let t = 0; t < 12; t++) { const x = R(ix0, ix1), zz = R(iz0, iz1); const inCol = (a, b) => x > a - 0.8 && x < b + 0.8 && zz > sz0 - 0.8 && zz < sz1 + 0.8; if (!(!top && inCol(sx0, sx1)) && !(f > 0 && inCol(hx0, hx1)) && !(f === 0 && nearDoor(x, zz))) return [x, zz]; } return null; };
    const nl = 1 + (rng() < 0.55 ? 1 : 0) + (f > 0 && rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < nl; k++) { const s = spot(); if (s) loot.push([r2(s[0]), r2(fy), r2(s[1]), rollTier(rng)]); }
    if (rng() < 0.8) { const s = spot(); if (s) add(s[0], fy, s[1], R(0.9, 1.6), 0.8, R(0.9, 1.4), cTrim); }
  }
  if (lift) add(frontDoor, gy, cz + doorSide * (D / 2 + 0.6), 1.8, 0.8, 1.2, cRoof);   // the step up to the stilt hut's door
  if (S.porch) {   // western porch: a roof over the door on two posts
    const pz = cz + doorSide * (D / 2 + 1.2);
    add(cx, base + FH - 0.5, pz, W, 0.2, 2.4, cRoof, { deco: 1 });
    for (const px of [x0 + 0.3, x1 - 0.3]) add(px, base, cz + doorSide * (D / 2 + 2.2), 0.25, FH - 0.5, 0.25, cRoof);
  }
  // what bots need to find their way in and out: interior, doors (wall z, outward side) and the stair run
  return { x: cx, z: cz, w: W + 2, d: D + 2, y: gy, floors, style,
    nav: { x0: r2(x0), x1: r2(x1), z0: r2(z0), z1: r2(z1), base: r2(base), FH, floors, th, doors: [{ x: r2(frontDoor), z: r2(doorSide > 0 ? z1 : z0), s: doorSide }].concat(backDoor == null ? [] : [{ x: r2(backDoor), z: r2(doorSide > 0 ? z0 : z1), s: -doorSide }]),
      st: Array.from({ length: floors }, (_, f) => ({ x: r2((col(f)[0] + col(f)[1]) / 2), z0: r2(sz0), z1: r2(sz1) })) } };
}
const r2 = v => Math.round(v * 100) / 100;
function rollTier(rng) {
  let t = rng() * LOOT_W.reduce((a, b) => a + b, 0);
  for (let i = 0; i < LOOT_W.length; i++) { t -= LOOT_W[i]; if (t <= 0) return i; }
  return 0;
}

// The zone themes: one theme per zone, from the lobby's theme choice (a single theme fills the whole map).
function zoneThemes(rng, themeSet) {
  const one = ART.themes.findIndex(t => t.name.toLowerCase() === String(themeSet).toLowerCase());
  let ids = ART.themes.map((t, i) => i).filter(i => themeSet === 'all' || ART.themes[i].style);
  if (one >= 0) ids = [one];
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids;
}

export function generateOpenWorld(seed, settings = {}) {
  const rng = mulberry32(seed ^ 0x0be7), R = (a, b) => a + rng() * (b - a), H = OW.half;
  const themes = zoneThemes(rng, settings.themes || 'all');
  const zones = [], G = 3, span = H * 0.62;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const th = themes[(j * G + i) % themes.length];
    const st = (ART.themes[th] || {}).style;
    zones.push({ i: zones.length, x: r2(-span + i * span + R(-14, 14)), z: r2(-span + j * span + R(-14, 14)), theme: th, amp: HILLS[st] ?? 1 });
  }
  const level = { open: 1, seed, name: 'Open World', hx: H, hz: H, theme: zones[4].theme, zones, boxes: [], dynamic: [], pads: [], loot: [], lava: false, ice: false, poly: null };
  // buildings: a handful per zone, a town near each zone's center
  const pads = level.pads, buildings = [];
  const free = (x, z, w, d) => Math.abs(x) + w / 2 < H - OW.edgeBand - 2 && Math.abs(z) + d / 2 < H - OW.edgeBand - 2 &&
    pads.every(p => Math.abs(x - p.x) > (w + p.w) / 2 + 4 || Math.abs(z - p.z) > (d + p.d) / 2 + 4);
  for (const zn of zones) {
    const st = (ART.themes[zn.theme] || {}).style || 'plain', n = 5 + Math.floor(rng() * 4);
    for (let k = 0, tries = 0; k < n && tries < 60; tries++) {
      const a = rng() * Math.PI * 2, r = 6 + Math.sqrt(rng()) * 40, x = zn.x + Math.cos(a) * r, z = zn.z + Math.sin(a) * r;
      if (zoneIndex(level, x, z) !== zn.i) continue;
      const w = 18, d = 18;
      if (!free(x, z, w, d)) continue;
      const pad = { x: r2(x), z: r2(z), w, d, y: r2(baseHeight(level, x, z)) };
      pads.push(pad); buildings.push([pad, st, zn]); k++;
    }
  }
  for (const [pad, st, zn] of buildings) {
    const b = makeBuilding(rng, pad.x, pad.z, pad.y, st, zn, level.boxes, level.loot);
    pad.w = Math.min(18, b.w + 1); pad.d = Math.min(18, b.d + 1);
    (level.bldgs = level.bldgs || []).push(b.nav);
  }
  buildTerrain(level);
  // outdoor cover (rocks, walls, crates) and outdoor loot
  for (const zn of zones) {
    const T = ART.themes[zn.theme] || ART.themes[0];
    for (let k = 0; k < 9; k++) {
      const x = zn.x + R(-45, 45), z = zn.z + R(-45, 45);
      if (zoneIndex(level, x, z) !== zn.i || !free(x, z, 3, 3)) continue;
      const w = R(1.2, 4), d = rng() < 0.5 ? R(0.8, 1.4) : w, h = rng() < 0.5 ? 1.2 : R(2, 3.2), y = level.hAt(x, z);
      level.boxes.push({ x: r2(x), y0: r2(y - 0.6), z: r2(z), w: r2(rng() < 0.5 ? w : d), h: r2(h + 0.6), d: r2(rng() < 0.5 ? d : w), c: T.rock, zone: zn.i, rock: 1 });
    }
    for (let k = 0; k < 4; k++) {
      const x = zn.x + R(-50, 50), z = zn.z + R(-50, 50);
      if (zoneIndex(level, x, z) !== zn.i || !free(x, z, 2, 2)) continue;
      level.loot.push([r2(x), r2(level.hAt(x, z)), r2(z), rollTier(rng)]);
    }
  }
  return level;
}

// ---------------------------------------------------------------- match setup
// Called from Game.startRound in open world mode, after the level is made and heroes placed.
export function owStart(g, heroes) {
  const L = g.level, H = OW.half, rng = Math.random;
  const a = rng() * Math.PI * 2, off = (rng() - 0.5) * H * 0.6;
  const dx = Math.cos(a), dz = Math.sin(a), nx = -dz, nz = dx, far = H * 1.15;
  const extract = g.settings.owType === 'extract';
  // Extraction: the bus flies a short run over the team's drop zone. Battle royale: right across the map.
  const bus = extract
    ? (() => { const cx = (rng() - 0.5) * H * 0.9, cz = (rng() - 0.5) * H * 0.9; return { ax: cx - dx * 60, az: cz - dz * 60, bx: cx + dx * 60, bz: cz + dz * 60, drop: { x: cx, z: cz } }; })()
    : { ax: -dx * far + nx * off, az: -dz * far + nz * off, bx: dx * far + nx * off, bz: dz * far + nz * off };
  bus.y = OW.busY; bus.len = Math.hypot(bus.bx - bus.ax, bus.bz - bus.az); bus.dur = bus.len / OW.busSpeed; bus.t = -OW.busDelay;
  // Extraction: no bus. The squad starts together inside one random building and learns the map from there.
  let home = null;
  if (extract) {
    const lim = H - OW.edgeBand - 10, bl = (L.bldgs || []).filter(b => Math.abs((b.x0 + b.x1) / 2) < lim && Math.abs((b.z0 + b.z1) / 2) < lim);
    home = bl.length ? bl[Math.floor(rng() * bl.length)] : null;
    if (home) bus.drop = { x: (home.x0 + home.x1) / 2, z: (home.z0 + home.z1) / 2 };
    bus.t = bus.dur + 10;   // parked out of sight
  }
  g.ow = { bus, taken: new Set(), takenList: [], veh: [], wall: null, ext: null, extract, sinceT: 0, sight: OW.sight, crouchK: OW.crouch.sight, roamN: 0, reinT: OW.ext.reinforce, ambCd: OW.ambush.cd * 0.5, ambN: 0, portals: [], fightScanT: 0 };
  setupVehicles(g);
  if (extract) setupExtraction(g); else setupWall(g);
  spawnRoamers(g);
  const spots = extract ? homeSpots(g, home, heroes.length) : null;
  heroes.forEach((p, i) => {
    p.cards = []; p.pact = false; g.recompute(p); p.hp = g.maxHp(p); p.size = 1; g.emitCards(p);
    if (spots) {
      p.ow = { st: 'ground', landT: g.time, jumpHeld: true };
      const q = spots[i]; p.pos = { x: q.x, y: q.y, z: q.z }; p.vel = { x: 0, y: 0, z: 0 }; p.spawn = { ...p.pos }; p.onGround = true;
      return;
    }
    p.ow = { st: 'bus', dropAt: 0.12 + rng() * 0.76, jumpHeld: true };
    busPlace(g, p);
  });
}
// Starting spots for the extraction squad: a tight grid on the building's ground floor (clear of the stairs),
// spilling out past the front door if the squad is bigger than the room.
function homeSpots(g, b, n) {
  const L = g.level, out = [];
  if (!b) { const x = g.ow.bus.drop.x, z = g.ow.bus.drop.z; for (let i = 0; i < n; i++) { const xx = x + (i % 4) * 1.4, zz = z + Math.floor(i / 4) * 1.4; out.push({ x: xx, y: L.hAt(xx, zz) + 0.1, z: zz }); } return out; }
  const th = b.th || 0.4, x0 = b.x0 + th + 2.4, x1 = b.x1 - th - 0.8, z0 = b.z0 + th + 0.8, z1 = b.z1 - th - 0.8, y = b.base + 0.1;
  for (let z = z0; z <= z1 && out.length < n; z += 1.3) for (let x = x0; x <= x1 && out.length < n; x += 1.3) out.push({ x, y, z });
  const d = b.doors[0];
  for (let i = 0; out.length < n; i++) { const x = d.x + ((i % 4) - 1.5) * 1.3, z = d.z + d.s * (2 + Math.floor(i / 4) * 1.3); out.push({ x, y: L.hAt(x, z) + 0.1, z }); }
  return out;
}

// ---------------------------------------------------------------- extraction: reviving the fallen
// Stand on a fallen teammate's body and hold the use key (E) for OW.revive.time seconds to bring them back.
function reviveTick(g, dt) {
  if (!g.ow.extract || g.phase !== 'play') return;
  const R = OW.revive;
  for (const d of g.players) {
    if (d.kind !== 'hero' || d.alive || !d.connected || !d.ow || d.ow.st !== 'ground') { if (d.revT) d.revT = 0; continue; }
    const helper = g.players.find(h => h.kind === 'hero' && h.alive && !h.reviving && !h.veh && h.input && h.input.use &&
      Math.hypot(h.pos.x - d.pos.x, h.pos.z - d.pos.z) < R.r && Math.abs(h.pos.y - d.pos.y) < 1.6);
    if (!helper) { if (d.revT > 0) { d.revT = Math.max(0, d.revT - dt * 2); } continue; }
    d.revT = (d.revT || 0) + dt;
    if ((d.revSent = (d.revSent || 0) - dt) <= 0) { d.revSent = 0.25; g.emit({ t: 'reviving', p: d.id, by: helper.id, f: Math.min(1, d.revT / R.time), x: d.pos.x, y: d.pos.y, z: d.pos.z }); }
    if (d.revT >= R.time) {
      d.revT = 0; d.alive = true; d.reviving = false; d.hp = Math.max(1, g.maxHp(d) * R.hp); d.vel = { x: 0, y: 0, z: 0 };
      d.fx.invulnT = g.time + 1.5;
      g.emit({ t: 'revived', p: d.id, by: helper.id, x: d.pos.x, y: d.pos.y, z: d.pos.z });
    }
  }
}
function busPos(g) {
  const b = g.ow.bus, k = Math.max(0, Math.min(1, b.t / b.dur));
  return { x: b.ax + (b.bx - b.ax) * k, z: b.az + (b.bz - b.az) * k, k };
}
function busPlace(g, p) {
  const b = busPos(g);
  p.pos = { x: b.x, y: g.ow.bus.y - 1, z: b.z }; p.vel = { x: 0, y: 0, z: 0 }; p.spawn = { ...p.pos };
}

// Every tick (countdown and play): the bus flies, loot gets picked up.
export function owTick(g, dt) {
  const ow = g.ow; if (!ow) return;
  if (g.phase === 'play') ow.bus.t += dt;
  ow.sinceT += dt;
  const L = g.level;
  if (ow.wall) wallTick(g, dt);
  if (ow.ext) extTick(g, dt);
  vehTick(g, dt);
  ambushTick(g, dt);
  lootOfferTick(g, dt);
  reviveTick(g, dt);
  for (const p of g.players) {
    if (!p.alive || p.reviving || p.kind !== 'hero' || (p.ow && p.ow.st !== 'ground')) continue;
    for (let i = 0; i < L.loot.length; i++) {
      if (ow.taken.has(i)) continue;
      const it = L.loot[i];
      if (Math.abs(it[0] - p.pos.x) < OW.lootR && Math.abs(it[2] - p.pos.z) < OW.lootR && it[1] - p.pos.y < 1.4 && p.pos.y - it[1] < 1.2) grabLoot(g, p, i);
    }
  }
}

// ---------------------------------------------------------------- battle royale: the red wall
function setupWall(g) {
  const H = OW.half, cx = (Math.random() - 0.5) * H, cz = (Math.random() - 0.5) * H;
  const far = Math.max(...[[-H, -H], [H, -H], [-H, H], [H, H]].map(([x, z]) => Math.hypot(x - cx, z - cz))) + 4;
  g.ow.wall = { cx, cz, r: far, from: far, to: far, stage: -1, t: OW.wall.wait, dur: 1, shrinking: false };
}
function wallTick(g, dt) {
  const w = g.ow.wall;
  if (g.phase !== 'play') return;
  w.t -= dt;
  if (w.t <= 0) {
    if (w.shrinking) {
      w.shrinking = false; w.r = w.to;
      const st = OW.wall.stages[w.stage]; w.t = st && st[2] > 0 ? st[2] : 1e9;
      if (w.r <= 0.5) g.ow.wallDone = true;
    } else {
      const st = OW.wall.stages[++w.stage];
      if (!st) w.t = 1e9;
      else { w.shrinking = true; w.from = w.r; w.to = st[0]; w.t = w.dur = st[1]; g.emit({ t: 'owWall', n: w.stage }); }
    }
  }
  if (w.shrinking) w.r = w.to + (w.from - w.to) * Math.max(0, w.t / w.dur);
  const dps = OW.wall.dps[Math.min(OW.wall.dps.length - 1, Math.max(0, w.stage))];
  for (const p of g.players) {
    if (!p.alive || p.reviving || (p.ow && p.ow.st === 'bus') || p.kind === 'turret') continue;
    if (Math.hypot(p.pos.x - w.cx, p.pos.z - w.cz) > w.r) { if (OW.wall.kill) { p.fx.invulnT = 0; p.bonusHp = 0; p.fx.hair = 0; p.fx.holyShield = null; g.hurt(p, 1e6, null, null); } else g.hurt(p, dps * dt, null, null, true); }
  }
}

// ---------------------------------------------------------------- co-op: extraction
function setupExtraction(g) {
  const L = g.level, H = OW.half, d0 = g.ow.bus.drop, lim = H - OW.edgeBand - 6;
  const onPad = (x, z) => L.pads.some(p => Math.abs(x - p.x) < p.w / 2 + 2 && Math.abs(z - p.z) < p.d / 2 + 2);
  let best = null, bd = -1;
  for (let t = 0; t < 80; t++) {
    const x = (Math.random() * 2 - 1) * lim, z = (Math.random() * 2 - 1) * lim, d = Math.hypot(x - d0.x, z - d0.z);
    if (onPad(x, z)) continue;
    if (d >= OW.ext.minDist) { best = { x, z }; break; }
    if (d > bd) { bd = d; best = { x, z }; }
  }
  best = best || { x: -d0.x, z: -d0.z };
  g.ow.ext = { x: best.x, z: best.z, y: L.hAt(best.x, best.z), r: OW.ext.r, hold: 0 };
}
function extTick(g, dt) {
  const e = g.ow.ext;
  if (g.phase !== 'play') return;
  const live = g.players.filter(p => p.kind === 'hero' && p.connected && p.alive && !p.reviving);
  const inside = live.length > 0 && live.every(p => (!p.ow || p.ow.st === 'ground') && Math.hypot(p.pos.x - e.x, p.pos.z - e.z) < e.r && Math.abs(p.pos.y - e.y) < 4);
  e.hold = inside ? e.hold + dt : 0;
  if (e.hold >= OW.ext.hold) g.ow.extracted = true;
  // more roaming bots show up around the squad now and then
  const ow = g.ow, per = OW.roamers[g.settings.owBots || 'some'] ?? 1;
  ow.reinT -= dt;
  if (per && ow.reinT <= 0 && live.length) {
    ow.reinT = OW.ext.reinforce;
    const alive = g.players.filter(p => p.roamer && p.alive).length;
    if (alive < per * g.level.zones.length * 1.4) {
      const h = live[Math.floor(Math.random() * live.length)], a = Math.random() * Math.PI * 2, r = 45 + Math.random() * 15;
      const x = h.pos.x + Math.cos(a) * r, z = h.pos.z + Math.sin(a) * r, st = zoneStyle(g.level, g.level.zoneAt(x, z));
      for (let k = 0; k < 2; k++) spawnRoamer(g, x + k * 2, z, st);
      g.unitsChanged();
    }
  }
}

// ---------------------------------------------------------------- ambushes
// A fight starts when a roaming bot locks onto a hero who hasn't been hunted for OW.ambush.calm seconds.
// Then, sometimes, a portal opens a short way off and a few more bots step out already coming for that hero.
// A cooldown and a per-match cap keep it from happening over and over.
function ambushTick(g, dt) {
  const ow = g.ow, A = OW.ambush;
  if (g.phase !== 'play') return;
  ow.ambCd = Math.max(0, ow.ambCd - dt);
  for (let i = ow.portals.length - 1; i >= 0; i--) {
    const pt = ow.portals[i];
    if ((pt.t -= dt) > 0) continue;
    ow.portals.splice(i, 1);
    const h = g.players.find(q => q.id === pt.h);
    for (let k = 0; k < pt.n; k++) {
      const spec = unitSpec(g, Math.random() < 0.2 ? 'elite' : 'wave', ow.roamN++);
      if (!spec.name || /^Roamer|^Wave/.test(spec.name)) spec.name = `Portal Raider ${ow.roamN}`;
      const a = k * 2.1, x = pt.x + Math.cos(a) * 1.2, z = pt.z + Math.sin(a) * 1.2;
      const u = g.spawnUnit('wave', null, { x, y: g.level.hAt(x, z) + 0.05, z }, spec);
      u.roamer = true; u.home = { x: pt.x, z: pt.z };
      if (h && h.alive) { u.ai = u.ai || {}; u.ai.owFoe = h; u.ai.owSeeT = 2.5; }
    }
    g.unitsChanged();
  }
  if ((ow.fightScanT -= dt) > 0) return;
  ow.fightScanT = 0.5;
  const per = OW.roamers[g.settings.owBots || 'some'] ?? 1;
  for (const h of g.players) {
    if (h.kind !== 'hero' || !h.alive || h.reviving || !h.ow || h.ow.st !== 'ground') continue;
    const hunted = g.players.some(q => q.roamer && q.alive && q.ai && q.ai.owFoe === h);
    if (!hunted) continue;
    const quiet = g.time - (h.ow.huntT ?? -1e9) > A.calm;
    h.ow.huntT = g.time;
    if (!quiet || !per || ow.ambCd > 0 || ow.ambN >= A.max || Math.random() > A.chance) continue;
    if (g.players.filter(q => q.roamer && q.alive).length >= per * g.level.zones.length * 1.6) continue;
    const L = g.level;
    for (let tries = 0; tries < 10; tries++) {
      const a = Math.random() * Math.PI * 2, r = A.r[0] + Math.random() * (A.r[1] - A.r[0]);
      const x = clampMap(h.pos.x + Math.cos(a) * r), z = clampMap(h.pos.z + Math.sin(a) * r), y = L.hAt(x, z);
      if (bldgAt(L, x, y + 1, z) || Math.abs(y - h.pos.y) > 6) continue;
      ow.ambCd = A.cd; ow.ambN++;
      ow.portals.push({ x, z, t: A.delay, h: h.id, n: per >= 4 ? 3 : 2 });
      g.emit({ t: 'portal', x, y, z, d: A.delay + 1.6 });
      break;
    }
  }
}

// ---------------------------------------------------------------- roaming bots
const clampMap = v => Math.max(-(OW.half - OW.edgeBand - 6), Math.min(OW.half - OW.edgeBand - 6, v));   // keep off the steep edge slopes
function spawnRoamers(g) {
  const L = g.level, per = OW.roamers[g.settings.owBots || 'some'] ?? 1;
  if (!per) return;
  L.zones.forEach((zn, zi) => {
    for (let k = 0; k < per; k++) spawnRoamer(g, zn.x + (Math.random() - 0.5) * 80, zn.z + (Math.random() - 0.5) * 80, zoneStyle(L, zi));
  });
  // Extraction: a dense, tougher garrison around the extraction point.
  const e = g.ow.ext;
  if (e) for (let k = 0; k < per * 4; k++) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.sqrt(Math.random()) * 40;
    const x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r;
    spawnRoamer(g, x, z, zoneStyle(L, L.zoneAt(clampMap(x), clampMap(z))));
  }
}
// Extraction: roaming bots get tougher (and more often Elites) the closer they start to the extraction point.
function extBoost(g, x, z) {
  const e = g.ow && g.ow.ext;
  if (!e) return 0;
  return Math.max(0, 1 - Math.hypot(x - e.x, z - e.z) / 140);
}
const PACKS = ['forest', 'volcano', 'candy', 'tundra'];
function spawnRoamer(g, x, z, st) {
  const L = g.level, r = Math.random(), boost = extBoost(g, x, z);
  const type = r < 0.08 + 0.17 * boost * boost ? 'elite' : r < 0.3 && PACKS.includes(st) ? 'critter' : r < 0.38 ? 'turret' : 'wave';
  x = clampMap(x); z = clampMap(z);
  if (type === 'turret' && L.pads.length) {   // turrets guard a building (on its ground floor)
    const q = L.pads.slice().sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    x = q.x + (Math.random() - 0.5) * 2; z = q.z + (Math.random() - 0.5) * 2;
  }
  const n = type === 'critter' ? 3 : 1;
  for (let k = 0; k < n; k++) {
    const spec = unitSpec(g, type, g.ow.roamN++);
    if (type === 'wave') spec.name = `Roamer ${g.ow.roamN}`;
    const px = x + k * 1.2, pz = z + k * 0.8;
    const u = g.spawnUnit('wave', null, { x: px, y: L.hAt(px, pz) + 0.05, z: pz }, spec);
    u.roamer = true; u.home = { x, z };
    if (boost > 0) {   // up to +90% health and +45% damage right at the extraction
      u.stats.health *= 1 + 0.9 * boost; u.stats.damage *= 1 + 0.45 * boost; u.hp = u.stats.health;
      if (boost > 0.55) u.difficulty = 'hard';
    }
  }
}

// ---------------------------------------------------------------- vehicles
function setupVehicles(g) {
  const L = g.level, lim = OW.half - OW.edgeBand - 2;
  let id = 1;
  for (const pad of L.pads) {
    if (Math.random() > 0.45) continue;
    const r = Math.random(), kind = r < 0.25 ? 'car' : r < 0.6 ? 'bike' : 'scooter';
    const sx = Math.random() < 0.5 ? -1 : 1, x = pad.x + sx * (pad.w / 2 + 1.5), z = pad.z + (Math.random() - 0.5) * pad.d * 0.6;
    if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
    const hp = VEH[kind].hp || null;
    g.ow.veh.push({ id: id++, kind, x, y: L.hAt(x, z), z, yaw: Math.random() * Math.PI * 2, speed: 0, rider: null, hp, maxHp: hp });
  }
}
function toggleRide(g, p) {
  const ow = g.ow;
  if (p.veh) {
    const v = p.veh; v.rider = null; v.speed = 0; p.veh = null;
    const ox = Math.cos(v.yaw) * 1.3, oz = -Math.sin(v.yaw) * 1.3;
    p.pos.x += ox; p.pos.z += oz; p.pos.y += 0.3;
    g.emit({ t: 'owRide', p: p.id, v: v.id, on: 0 });
    return;
  }
  let best = null, bd = OW.useR;
  for (const v of ow.veh) { if (v.rider) continue; const d = Math.hypot(v.x - p.pos.x, v.z - p.pos.z); if (d < bd && Math.abs(v.y - p.pos.y) < 1.5) { bd = d; best = v; } }
  if (!best) return;
  best.rider = p.id; best.speed = 0; p.veh = best;
  p.pos = { x: best.x, y: best.y + 0.05, z: best.z }; p.vel = { x: 0, y: 0, z: 0 };
  g.emit({ t: 'owRide', p: p.id, v: best.id, on: 1 });
}
// The car takes the hits meant for its driver. Too much and it explodes: the driver is thrown out into the blast.
export function owCarHit(g, p, amt, src) {
  const v = p.veh; if (!v || v.hp == null) return false;
  v.hp -= amt;
  if (v.hp > 0) return true;
  v.hp = 0;
  toggleRide(g, p);
  g.ow.veh = g.ow.veh.filter(q => q !== v);
  g.emit({ t: 'carBoom', v: v.id, x: v.x, y: v.y + 0.8, z: v.z });
  g.explode({ x: v.x, y: v.y + 0.6, z: v.z }, VEH[v.kind].boom || 60, src && src.alive !== undefined ? src : null, { full: true, rmul: 1.6 });
  return true;
}
function vehTick(g, dt) {
  for (const p of g.players) {
    if (p.kind !== 'hero' || !p.alive || !p.ow || p.ow.st !== 'ground') continue;
    const u = p.input.useSeq | 0;
    if (p.ow.useSeq === undefined) p.ow.useSeq = u;
    if (u !== p.ow.useSeq) { p.ow.useSeq = u; if (g.phase === 'play') toggleRide(g, p); }
  }
  for (const v of g.ow.veh) {
    if (!v.rider) continue;
    const r = g.player(v.rider);
    if (!r || !r.alive || r.reviving || r.veh !== v) { v.rider = null; v.speed = 0; if (r) r.veh = null; continue; }
    const moved = Math.hypot(r.pos.x - v.x, r.pos.z - v.z) / Math.max(dt, 1e-3);
    if (Math.abs(v.speed) > 4 && moved < Math.abs(v.speed) * 0.45) v.speed *= 0.35;   // hit something: lose most of your speed
    v.x = r.pos.x; v.y = r.pos.y; v.z = r.pos.z;
    if (VEH[v.kind].ram && Math.abs(v.speed) > 7 && g.phase === 'play') {   // the car runs people over
      for (const q of g.players) {
        if (q === r || !q.alive || q.reviving || !g.isEnemy(r, q) || (q.fx.ramT || 0) > g.time) continue;
        const dx = q.pos.x - v.x, dz = q.pos.z - v.z;
        if (Math.hypot(dx, dz) > 1.9 || Math.abs(q.pos.y - v.y) > 1.6) continue;
        const l = Math.hypot(dx, dz) || 1, dir = { x: dx / l, y: 0, z: dz / l };
        q.fx.ramT = g.time + 0.7;
        g.hurt(q, 10 + Math.abs(v.speed) * 1.5, r, dir);
        q.vel.x += dir.x * 10; q.vel.z += dir.z * 10; q.vel.y = 5; q.onGround = false;
        v.speed *= 0.8;
      }
    }
  }
}
// Driving: replaces walking for a rider (Game.updatePlayer). Move keys point where you want to go.
export function owDrive(g, p, dt, frozen) {
  const v = p.veh, V = VEH[v.kind], inp = p.input;
  const m = frozen ? 0 : Math.min(1, Math.hypot(inp.mx, inp.mz));
  if (m > 0.2) {
    let d = Math.atan2(inp.mx, inp.mz) - v.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 2.5 && v.speed < 3) v.speed = Math.max(-V.max * 0.3, v.speed - V.acc * dt);   // pull back to reverse
    else {
      const turn = V.turn * dt * Math.min(1, 0.3 + Math.abs(v.speed) / 6);
      v.yaw += Math.max(-turn, Math.min(turn, d));
      v.speed = Math.min(V.max * m, v.speed + V.acc * dt * (Math.abs(d) > 1.7 ? -1.5 : 1));
    }
  } else v.speed *= Math.max(0, 1 - dt * 1.6);
  p.vel.x = Math.sin(v.yaw) * v.speed; p.vel.z = Math.cos(v.yaw) * v.speed;
  if (inp.aim) p.aim = inp.aim;
}

// A loot item: players choose one of LOOT_CHOICES cards of the item's rarity (mods swap out the one you hold).
// Bots take one at once. The host owns the offer, so a pick is only ever one of the cards it dealt (no free cards).
export const LOOT_CHOICES = 3, LOOT_PICK_T = 25, LOOT_DISCARD = '-';
function grabLoot(g, p, i) {
  const tier = LOOT_TIERS[g.level.loot[i][3]] || 'common';
  g.ow.taken.add(i); g.ow.takenList.push(i);
  if (!p.isBot && !p.commanded) {
    const ids = [];
    for (let k = 0; k < 12 && ids.length < LOOT_CHOICES; k++) { const c = lootCard(g, p, tier, ids); if (c && !ids.includes(c.id)) ids.push(c.id); }
    g.emit({ t: 'loot', id: i, p: p.id, card: null, offer: ids.length ? 1 : 0 });
    if (!ids.length) return;
    (p.lootQ = p.lootQ || []).push({ ids, t: LOOT_PICK_T, sent: false });
    sendLootOffer(g, p);
    return;
  }
  const c = lootCard(g, p, tier);
  if (!c) { g.emit({ t: 'loot', id: i, p: p.id, card: null }); return; }
  applyLoot(g, p, c);
  g.emit({ t: 'loot', id: i, p: p.id, card: c.id });
}
function sendLootOffer(g, p) {
  const q = p.lootQ && p.lootQ[0];
  if (!q || q.sent) return;
  q.sent = true;
  g.emit({ t: 'lootOffer', p: p.id, cards: q.ids.slice(), left: p.lootQ.length - 1 });
}
function applyLoot(g, p, c) {
  const before = g.maxHp(p);
  if (c.weaponMod) p.cards = p.cards.filter(x => !(g.cardById.get(x) || {}).weaponMod);
  if (c.shieldMod) p.cards = p.cards.filter(x => !(g.cardById.get(x) || {}).shieldMod);
  p.cards.push(c.id);
  if (c.special === 'regretfulPact') p.pact = true;
  g.checkCombos(p);
  g.recompute(p);
  p.hp = Math.min(g.maxHp(p), p.hp + Math.max(0, g.maxHp(p) - before));
  if (p.ammo > p.stats.ammo) p.ammo = p.stats.ammo;
  g.emitCards(p);
}
// A player's choice from their open loot offer (host only). Anything not in the offer is refused.
export function owLootPick(g, pid, cardId) {
  const p = g.player(pid), q = p && p.lootQ && p.lootQ[0];
  if (q && p.alive && cardId === LOOT_DISCARD) {   // v28: none of these fit your build: take nothing
    p.lootQ.shift(); g.emit({ t: 'lootTaken', p: p.id, card: null, discard: 1 }); sendLootOffer(g, p); return true;
  }
  if (!q || !p.alive || !q.ids.includes(cardId)) return false;
  const c = g.cardById.get(cardId); if (!c) return false;
  p.lootQ.shift();
  applyLoot(g, p, c);
  g.emit({ t: 'lootTaken', p: p.id, card: c.id });
  sendLootOffer(g, p);
  return true;
}
// Offers nobody answered (left open too long, or the player went down) resolve themselves.
function lootOfferTick(g, dt) {
  for (const p of g.players) {
    const q = p.lootQ && p.lootQ[0];
    if (!q) continue;
    if (!p.alive || !p.connected) { p.lootQ = []; g.emit({ t: 'lootOffer', p: p.id, cards: [], left: 0 }); continue; }
    if ((q.t -= dt) <= 0) owLootPick(g, p.id, q.ids[0]);
  }
}
function lootCard(g, p, tier, skip = []) {
  const ok = c => !skip.includes(c.id) && !c.combo && c.rarity !== 'combo' && c.special !== 'modBreaker' && c.special !== 'repentance' && g.modeOK(c) && g.canTake(p, c) && !g.uniqueHeld(p, c);
  let pool;
  if (tier === 'mod') pool = g.allCards.filter(c => c.weaponMod && ok(c) && !p.cards.includes(c.id));
  else if (tier === 'shieldmod') pool = g.allCards.filter(c => c.shieldMod && ok(c) && !p.cards.includes(c.id));
  else pool = g.offerPool(p).filter(c => ok(c) && !c.weaponMod && !c.shieldMod && c.rarity === tier);
  if (!pool.length) pool = g.offerPool(p).filter(c => ok(c) && !c.weaponMod && !c.shieldMod && (c.rarity === 'common' || c.rarity === 'uncommon'));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

// Players still in the sky: riding the bus, free-falling or under a parachute. Returns true while airborne
// (Game.updatePlayer then skips walking, shooting and blocking).
export function owAir(g, p, dt, canAct, move) {
  const o = p.ow;
  if (!o || o.st === 'ground') return false;
  const inp = p.input, L = g.level, b = g.ow.bus;
  const press = !!inp.jump && !o.jumpHeld;
  o.jumpHeld = !!inp.jump;
  if (inp.aim) p.aim = inp.aim;
  if (inp.aimPoint) p.aimPoint = inp.aimPoint;
  if (o.st === 'bus') {
    busPlace(g, p);
    const k = b.t / b.dur, out = k >= 1 || (g.phase === 'play' && b.t > 0.6 && (p.isBot || p.commanded ? k >= o.dropAt : press));
    if (out) {
      o.st = 'fall'; o.fallT = 0;
      p.vel = { x: (b.bx - b.ax) / b.len * OW.busSpeed * 0.4, y: -4, z: (b.bz - b.az) / b.len * OW.busSpeed * 0.4 };
      p.pos.y = b.y - 2.5;
      g.emit({ t: 'owDrop', p: p.id });
    }
    return true;
  }
  const gy = L.hAt(p.pos.x, p.pos.z), above = p.pos.y - gy;
  o.fallT = (o.fallT || 0) + dt;
  if (o.st === 'fall' && ((press && o.fallT > 0.35) || above < OW.autoChute)) { o.st = 'chute'; g.emit({ t: 'owChute', p: p.id }); }
  const chute = o.st === 'chute', drift = chute ? OW.chuteDrift : OW.freeDrift, sink = chute ? OW.chute : OW.fall;
  const k = Math.min(1, dt * (chute ? 2.5 : 1.5));
  p.vel.x += (inp.mx * drift - p.vel.x) * k;
  p.vel.z += (inp.mz * drift - p.vel.z) * k;
  p.vel.y += (-sink - p.vel.y) * Math.min(1, dt * 3);
  p.vel.y += RULES.gravity * dt;   // cancels movePlayer's gravity: the sink speed above is the whole fall
  move(p, dt);
  if (p.onGround || p.pos.y <= gy + 0.05) { o.st = 'ground'; o.landT = g.time; p.vel.y = 0; g.emit({ t: 'owLand', p: p.id }); }
  return true;
}

// Snapshot rows for the render side: the bus, players in the air (id, state 1 bus / 2 fall / 3 chute).
export function owView(g) {
  const ow = g.ow; if (!ow) return null;
  const b = ow.bus, bp = busPos(g), r2 = v => Math.round(v * 100) / 100;
  const ps = [];
  for (const p of g.players) if (p.ow && p.ow.st !== 'ground' && p.alive) ps.push([p.id, OW_STATE[p.ow.st] || 0]);
  return {
    bus: b.t < b.dur + 4 ? [r2(bp.x), b.y, r2(bp.z), r2(Math.atan2(b.bx - b.ax, b.bz - b.az)), b.t < 0 ? 0 : 1] : null,
    ps, ex: ow.extract ? 1 : 0,
    wall: ow.wall ? [r2(ow.wall.cx), r2(ow.wall.cz), r2(ow.wall.r), r2(ow.wall.to), ow.wall.shrinking || ow.wall.t > 1e8 ? 0 : Math.ceil(ow.wall.t)] : null,
    ext: ow.ext ? [r2(ow.ext.x), r2(ow.ext.z), ow.ext.r, ow.ext.hold > 0 ? r2(OW.ext.hold - ow.ext.hold) : 0, r2(ow.ext.y)] : null,
    veh: ow.veh.map(v => [v.id, VEH[v.kind].i, r2(v.x), r2(v.y), r2(v.z), r2(v.yaw), v.rider || 0, v.hp == null ? 1 : r2(v.hp / v.maxHp)]),
  };
}

// ---------------------------------------------------------------- bots
// Bots in the sky pick a building near their drop and steer for it. On the ground they fight anything in
// sight (ai.js botThink, limited to OW sight range) and otherwise roam: loot first, then toward the action.
export function owBotThink(g, p, dt) {
  const inp = p.input, o = p.ow, A = p.ai;
  if (o && o.st !== 'ground') {
    inp.shoot = false; inp.jump = false;
    if (o.st === 'bus') { inp.mx = inp.mz = 0; return; }
    if (!o.land) o.land = landingSpot(g, p);
    const dx = o.land.x - p.pos.x, dz = o.land.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
    inp.mx = d > 1.5 ? dx / d : 0; inp.mz = d > 1.5 ? dz / d : 0;
    return;
  }
  A.owSeeT = (A.owSeeT || 0) - dt;
  if (A.owSeeT <= 0) { A.owSeeT = 0.4 + Math.random() * 0.3; A.owFoe = foeInSight(g, p); }
  inp.use = false;
  if (A.owFoe && A.owFoe.alive) {
    if (p.veh) botUse(p);
    // v1.0.1: a foe on another floor (above or below, through the ceiling) isn't shot at through the floor: the
    // bot takes the stairs (or the stair hole) to their floor, and only fights once it can actually see them
    const f = A.owFoe, dy = f.pos.y - p.pos.y;
    if (!p.veh && Math.abs(dy) > 1.8 && segBlocked(g.solids, { x: p.pos.x, y: chestY(p), z: p.pos.z }, { x: f.pos.x, y: chestY(f), z: f.pos.z })) {
      const w = owWaypoint(g, p, f.pos.x, f.pos.y, f.pos.z);
      let mx = w.x - p.pos.x, mz = w.z - p.pos.z; const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
      if (!w.exact) [mx, mz] = detour(g, p, A, mx, mz);
      inp.mx = mx; inp.mz = mz; inp.shoot = false;
      A.stuckT = Math.hypot(p.vel.x, p.vel.z) < 1.5 ? (A.stuckT || 0) + dt : 0;
      inp.jump = !!(p.onGround && (w.jump || A.stuckT > 0.5));
      inp.aim = { x: mx, y: 0, z: mz };
      return;
    }
    botThink(g, p, dt); return;
  }
  // Extraction: a hero bot walks over to a fallen teammate nearby and holds use on them until they're back up.
  if (g.ow.extract && p.kind === 'hero' && !p.roamer && !p.veh) {
    const down = g.players.filter(d => d.kind === 'hero' && !d.alive && d.connected && d.ow && d.ow.st === 'ground' && Math.hypot(d.pos.x - p.pos.x, d.pos.z - p.pos.z) < 40)
      .sort((a, b) => Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z))[0];
    if (down) {
      const dx = down.pos.x - p.pos.x, dz = down.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
      if (d < 1.1 && Math.abs(down.pos.y - p.pos.y) < 1.5) { inp.mx = inp.mz = 0; inp.use = true; inp.shoot = false; return; }
      const w = owWaypoint(g, p, down.pos.x, down.pos.y, down.pos.z) || { x: down.pos.x, z: down.pos.z };
      let mx = w.x - p.pos.x, mz = w.z - p.pos.z; const l = Math.hypot(mx, mz) || 1; [mx, mz] = detour(g, p, A, mx / l, mz / l);
      inp.mx = mx; inp.mz = mz; inp.shoot = false; inp.jump = false;
      return;
    }
  }
  roam(g, p, dt);
}
const chestY = q => q.pos.y + RULES.chest * (q.size || 1);
function foeInSight(g, p) {
  const R = g.ow.sight || 34, from = { x: p.pos.x, y: chestY(p), z: p.pos.z };
  let best = null, bd = Infinity;
  for (const q of g.players) {
    if (!q.alive || q.reviving || !g.isEnemy(p, q) || (q.ow && q.ow.st === 'bus')) continue;
    const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z), dy = Math.abs(q.pos.y - p.pos.y);
    if (d > R * (q.crouch ? OW.crouch.sight : 1) || d >= bd) continue;
    if ((d > 6 || q.crouch || dy > 1.8) && segBlocked(g.solids, from, { x: q.pos.x, y: q.pos.y + (q.crouch ? 0.7 : RULES.chest) * (q.size || 1), z: q.pos.z })) continue;
    best = q; bd = d;
  }
  return best;
}
function landingSpot(g, p) {
  const pads = g.level.pads;
  if (!pads.length) return { x: p.pos.x, z: p.pos.z };
  const near = pads.map(q => [q, Math.hypot(q.x - p.pos.x, q.z - p.pos.z)]).sort((a, b) => a[1] - b[1]).slice(0, 4);
  const q = near[Math.floor(Math.random() * near.length)][0];
  return { x: q.x + (Math.random() - 0.5) * 4, z: q.z + (Math.random() - 0.5) * 4 };
}
// Where a roaming bot heads next: world bots search around for heroes near their home; hero bots loot,
// keep inside the red wall, and in extraction stick with the humans and head for the extraction point.
function roamGoal(g, p) {
  const L = g.level, ow = g.ow, w = ow.wall, R = (a, b) => a + Math.random() * (b - a);
  const inWall = (x, z, m = 0) => !w || Math.hypot(x - w.cx, z - w.cz) < Math.max(3, w.shrinking ? w.to : w.r) - m;
  const lootNear = range => {
    let best = null, bd = range;
    const bad = p.ai.badLoot;
    for (let i = 0; i < L.loot.length; i++) {
      if (ow.taken.has(i) || (bad && bad.has(i))) continue;
      const it = L.loot[i];
      if (!inWall(it[0], it[2], 2)) continue;
      const d = Math.hypot(it[0] - p.pos.x, it[2] - p.pos.z) + Math.abs(it[1] - p.pos.y) * 3;
      if (d < bd) { bd = d; best = it; }
    }
    return best ? { x: best[0], y: best[1], z: best[2], i: L.loot.indexOf(best), t: 14 + Math.abs(best[1] - p.pos.y) * 3 } : null;
  };
  if (p.roamer) {
    let best = null, bd = OW.search;
    for (const q of g.players) {
      if (q.kind !== 'hero' || !q.alive || (q.ow && q.ow.st !== 'ground')) continue;
      if (q.ow && g.time - (q.ow.landT ?? -99) < OW.landGrace) continue;   // a fresh landing gets a moment to loot before roamers come looking
      const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z) / (q.crouch ? OW.crouch.sight : 1); if (d < bd) { bd = d; best = q; }
    }
    if (best) {   // v1.0.1: head for the hero's floor too (a hero upstairs used to pull roamers under them on the ground floor)
      const inB2 = bldgAt(L, best.pos.x, best.pos.y + 0.5, best.pos.z), k = inB2 ? 1 : 5;
      return { x: best.pos.x + R(-k, k), z: best.pos.z + R(-k, k), y: inB2 ? best.pos.y : undefined, t: 6 };
    }
    const h = p.home || p.pos;
    return { x: clampMap(h.x + R(-30, 30)), z: clampMap(h.z + R(-30, 30)) };
  }
  if (w && !inWall(p.pos.x, p.pos.z, 8)) { const k = Math.max(0, (w.shrinking ? w.to : w.r) * 0.5); return { x: w.cx + R(-k, k), z: w.cz + R(-k, k), t: 10 }; }
  if (ow.extract) {
    const l = lootNear(22); if (l) return l;
    let hum = null, hd = Infinity;
    for (const q of g.players) if (q.kind === 'hero' && !q.isBot && q.alive) { const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z); if (d < hd) { hd = d; hum = q; } }
    if (hum && hd > 9) return { x: hum.pos.x + R(-3, 3), z: hum.pos.z + R(-3, 3), t: 3 };
    if (!hum && ow.ext) return { x: ow.ext.x + R(-2, 2), z: ow.ext.z + R(-2, 2), t: 30 };
    return { x: p.pos.x + R(-6, 6), z: p.pos.z + R(-6, 6), t: 3 };
  }
  const l = lootNear(70); if (l) return l;
  for (let k = 0; k < 10; k++) { const q = L.pads[Math.floor(Math.random() * L.pads.length)]; if (q && inWall(q.x, q.z, 4)) return { x: q.x, z: q.z }; }
  return w ? { x: w.cx, z: w.cz } : { x: 0, z: 0 };
}
function roam(g, p, dt) {
  const inp = p.input, A = p.ai;
  inp.shoot = false; inp.jump = false;
  const reached = A.goal && Math.hypot(A.goal.x - p.pos.x, A.goal.z - p.pos.z) < 1 && (A.goal.y == null || Math.abs(A.goal.y - p.pos.y) < 1.2);
  if (A.goal && A.goal.i != null && (reached || A.goalT <= 0) && !g.ow.taken.has(A.goal.i)) (A.badLoot = A.badLoot || new Set()).add(A.goal.i);   // couldn't get it
  if (!A.goal || A.goalT <= 0 || reached) { A.goal = roamGoal(g, p); A.goalT = A.goal.t || 25; A.stuckT = 0; }
  A.goalT -= dt;
  // far to go: hop on a vehicle; close to the goal (or stuck on it): get off
  let tgt = A.goal;
  const far = Math.hypot(A.goal.x - p.pos.x, A.goal.z - p.pos.z);
  if (p.veh) { if (far < 12 || (A.stuckT || 0) > 1.5) { botUse(p); A.stuckT = 0; } }
  else if (p.kind === 'hero' && far > 55 && !A.noVehT) {
    const v = A.vehTgt && !A.vehTgt.rider ? A.vehTgt : (A.vehTgt = freeVehicle(g, p));
    if (v) { tgt = { x: v.x, z: v.z, y: v.y }; if (Math.hypot(v.x - p.pos.x, v.z - p.pos.z) < OW.useR * 0.8 && Math.abs(v.y - p.pos.y) < 1.4) { botUse(p); A.vehTgt = null; A.noVehT = 4; } }
  }
  if (A.noVehT) A.noVehT = Math.max(0, A.noVehT - dt) || 0;
  const w = owWaypoint(g, p, tgt.x, tgt.y, tgt.z);
  let mx = w.x - p.pos.x, mz = w.z - p.pos.z;
  const d = Math.hypot(mx, mz) || 1; mx /= d; mz /= d;
  if (!w.exact) [mx, mz] = detour(g, p, A, mx, mz);
  const l = Math.hypot(mx, mz) || 1;
  inp.mx = mx / l; inp.mz = mz / l;
  const sp = Math.hypot(p.vel.x, p.vel.z);
  A.stuckT = sp < 1.5 ? (A.stuckT || 0) + dt : 0;
  if (!p.veh && p.onGround && (w.jump || A.stuckT > 0.5)) inp.jump = true;
  if (A.stuckT > 3) { A.goal = null; A.stuckT = 0; A.vehTgt = null; A.noVehT = 8; }
  inp.aim = { x: inp.mx, y: 0, z: inp.mz };
}
// Bots press the use key (E) like a player: gets on or off a vehicle.
function botUse(p) { p.input.useSeq = (p.input.useSeq | 0) + 1; }
function freeVehicle(g, p) {
  let best = null, bd = 20;
  for (const v of g.ow.veh) {
    if (v.rider || Math.abs(v.y - p.pos.y) > 1.4) continue;
    const d = Math.hypot(v.x - p.pos.x, v.z - p.pos.z);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

// ---------------------------------------------------------------- open-world steering
// Buildings are big closed boxes with a door or two and a stair run inside, so straight-line steering
// slides along their walls forever. owWaypoint gives the next point to walk to: out a door, up or down
// the stairs, in through a door, or around the corner of a building that's in the way.
const inB = (b, x, z, m = 0) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;
const floorOf = (b, y) => Math.max(0, Math.min(b.floors - 1, Math.floor((y - b.base + 0.4) / b.FH)));
function bldgAt(L, x, y, z) {
  if (!L.bldgs) return null;
  for (const b of L.bldgs) if (inB(b, x, z, -0.15) && y > b.base - 1 && y < b.base + b.floors * b.FH - 0.4) return b;
  return null;
}
// Does the segment a->b cross the rectangle (grown by m)? Slab test.
function segHitsB(ax, az, bx, bz, b, m) {   // (v1.2.6: the x then z slab without building arrays; every roamer runs this per building per tick)
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 2; k++) {
    const a = k ? az : ax, d = k ? bz - az : bx - ax, lo = k ? b.z0 - m : b.x0 - m, hi = k ? b.z1 + m : b.x1 + m;
    if (Math.abs(d) < 1e-9) { if (a < lo || a > hi) return false; continue; }
    let u = (lo - a) / d, v = (hi - a) / d; if (u > v) { const w = u; u = v; v = w; }
    t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 > t1) return false;
  }
  return true;
}
function nearestDoor(b, x, z) {
  let best = b.doors[0], bd = Infinity;
  for (const d of b.doors) { const k = Math.hypot(d.x - x, d.z + d.s * 1.5 - z); if (k < bd) { bd = k; best = d; } }
  return best;
}
// On an upper floor, the hole down to the floor below is in the way of a straight walk: step around it on the room side.
function avoidHole(b, f, x, z, t) {
  if (f <= 0) return t;
  const st = b.st[f - 1], left = st.x < (b.x0 + b.x1) / 2, ex = left ? st.x + 0.85 : st.x - 0.85;   // the hole's inner edge
  const h = { x0: left ? b.x0 : ex, x1: left ? ex : b.x1, z0: st.z0 - 0.4, z1: st.z1 + 0.4 };
  if (!segHitsB(x, z, t.x, t.z, h, 0.5)) return t;
  const side = left ? ex + 1.1 : ex - 1.1;
  if (left ? x < side - 0.3 : x > side + 0.3) return { x: side, z, exact: true };   // off the stair top, into the room first
  return { x: side, z: Math.abs(t.z - h.z0) < Math.abs(t.z - h.z1) ? h.z0 - 0.7 : h.z1 + 0.7, exact: true };
}
export function owWaypoint(g, p, gx, gy, gz) {
  const L = g.level, x = p.pos.x, z = p.pos.z, y = p.pos.y;
  const goal = { x: gx, z: gz };
  if (!L.bldgs) return goal;
  const bi = bldgAt(L, x, y, z);
  if (gy == null) { const b = L.bldgs.find(b => inB(b, gx, gz, -0.15)); if (b) gy = b.base; }   // a spot inside a building: its ground floor
  const bg = gy == null ? null : bldgAt(L, gx, gy, gz);
  if (bi) {
    const f = floorOf(bi, y), gf = bg === bi ? floorOf(bi, gy) : 0;
    const sf = bi.st[f], zFoot = Math.max(sf.z0 - 0.9, bi.z0 + bi.th + 0.45);
    // partway up this floor's stairs but not going up: walk back down them (stepping off sideways runs into the floor above)
    if (gf <= f && f < bi.floors - 1 && Math.abs(x - sf.x) < 1.3 && z > sf.z0 - 0.5 && z < sf.z1 + 0.5 && y > bi.base + f * bi.FH + 0.3) return { x: sf.x, z: zFoot, exact: true };
    if (bg === bi && gf === f) return avoidHole(bi, f, x, z, goal);
    if (gf > f) {   // up: line up at the foot of this floor's stairs, then hop up them
      const st = sf, zLo = zFoot;
      if (Math.abs(x - st.x) < 0.75 && z > zLo - 0.4 && z < st.z1 + 0.2) return { x: st.x, z: st.z1 + 0.6, jump: true, exact: true };
      const foot = { x: st.x, z: zLo };
      return Math.hypot(x - st.x, z - zLo) < 3 ? { ...foot, exact: true } : avoidHole(bi, f, x, z, foot);
    }
    if (f > 0) { const st = bi.st[f - 1]; return { x: st.x, z: st.z0 + 0.4, exact: Math.abs(x - st.x) < 2.5 && z > st.z0 - 1 && z < st.z1 + 1.5 }; }   // down: drop through the stair hole
    const d = nearestDoor(bi, x, z), inZ = d.z - d.s * 1.1;
    if (Math.abs(x - d.x) < 0.55 && (z - inZ) * -d.s < 0.6) return { x: d.x, z: d.z + d.s * 2.5, exact: true };   // lined up: straight out
    return { x: d.x, z: inZ };
  }
  let t = goal, inside = null;
  if (bg && y < bg.base + bg.floors * bg.FH - 0.4) {   // goal is inside a building: go in through its door
    const d = nearestDoor(bg, x, z), outZ = d.z + d.s * 1.8;
    inside = bg;
    if (Math.abs(x - d.x) < 0.55 && (z - outZ) * d.s < 0.4 && (z - d.z) * d.s > -0.2) return { x: d.x, z: d.z - d.s * 2, exact: true };
    t = { x: d.x, z: outZ };
  }
  // a building between here and there: around its nearest corner
  let blk = null, bd = Infinity;
  for (const b of L.bldgs) {
    if (b === inside && !segHitsB(x, z, t.x, t.z, b, 0.2)) continue;
    if (!segHitsB(x, z, t.x, t.z, b, 0.5)) continue;
    const k = Math.hypot((b.x0 + b.x1) / 2 - x, (b.z0 + b.z1) / 2 - z);
    if (k < bd) { bd = k; blk = b; }
  }
  if (!blk) return t;
  // corners whose second leg is clear win; a corner we're standing on doesn't count
  const m = 1.4, cs = [[blk.x0 - m, blk.z0 - m], [blk.x1 + m, blk.z0 - m], [blk.x0 - m, blk.z1 + m], [blk.x1 + m, blk.z1 + m]].map(([cx, cz]) => ({ x: cx, z: cz }));
  const cost = c => Math.hypot(c.x - x, c.z - z) + Math.hypot(t.x - c.x, t.z - c.z) + (segHitsB(c.x, c.z, t.x, t.z, blk, 0.3) ? 1000 : 0);
  let open = cs.filter(c => Math.hypot(c.x - x, c.z - z) >= 1 && !segHitsB(x, z, c.x, c.z, blk, 0.3));
  if (!open.length) {   // right up against a wall: the two corners of the face we're on
    const f = [x - blk.x0, blk.x1 - x, z - blk.z0, blk.z1 - z].map(Math.abs), k = f.indexOf(Math.min(...f));
    open = cs.filter(c => (k === 0 && c.x < blk.x0) || (k === 1 && c.x > blk.x1) || (k === 2 && c.z < blk.z0) || (k === 3 && c.z > blk.z1)).filter(c => Math.hypot(c.x - x, c.z - z) >= 1);
  }
  if (!open.length) return t;
  return open.reduce((a, b) => cost(a) <= cost(b) ? a : b);
}

// Round result for Game.checkRoundEnd: a score key, null (nobody), or undefined (keep playing).
export function owRoundEnd(g) {
  const live = g.players.filter(p => p.kind === 'hero' && p.connected && (p.alive || p.reviving));
  if (g.ow.extract) { if (!live.length) return 'roamers'; return g.ow.extracted ? 'players' : undefined; }
  const keys = new Set(live.map(p => g.scoreKey(p)));
  if (!keys.size) return null;
  const sides = new Set(g.heroes().filter(p => p.connected).map(p => g.scoreKey(p)));
  if (sides.size > 1) return keys.size === 1 ? [...keys][0] : undefined;
  return g.ow.wallDone ? [...keys][0] : undefined;   // solo: survive until the wall has fully closed
}
