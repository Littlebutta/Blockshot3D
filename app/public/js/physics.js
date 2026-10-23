// Axis-aligned box physics. No rendering code here so it can run anywhere.
import { RULES } from './config.js';
import { arenaEdges } from './levelgen.js';
import { buildTerrain } from './openworld.js';
const PR = RULES.playerRadius, PH = RULES.playerHeight;

export function prepareLevel(level) {
  if (level.open && !level.hAt) buildTerrain(level);   // open world: hills (level.hAt) and zones (level.zoneAt)
  if (level.side && !level.hAt) level.hAt = () => -1e4;   // 2D side view: no floor under the islands (pits are open)
  level.solids = level.boxes.filter(b => !b.deco).map(b => ({
    min: { x: b.x - b.w / 2, y: b.y0, z: b.z - b.d / 2 },
    max: { x: b.x + b.w / 2, y: b.y0 + (b.ch || b.h), z: b.z + b.d / 2 }, // ch = taller invisible collider (walls)
    wall: !!b.wall, vis: b.y0 + b.h,   // vis = visible top (walls have a taller invisible collider)
    oneWay: !!b.oneWay,   // 2D platforms: only solid from above, and you can drop through them
    ...(b.stair ? { stair: 1 } : {}),   // v28 open world stairs: low steps you walk up (see STEP)
  }));
  level.edges = level.poly ? arenaEdges(level) : null;   // polygon arenas: angled walls (see clampToArena)
  // v1.2.25: every level with more than a handful of boxes gets the grid (shaped / big-lobby arenas have hundreds)
  if (level.open || level.solids.length >= 12) { level.grid = buildGrid(level.solids, level.open ? 8 : 4); level.solids.grid = level.grid; level.solids.extra = []; if (level.open) level.solids.hAt = level.hAt; }
  return level;
}

// Open world: a uniform grid over the static solids so collision only looks at nearby boxes.
// A solids array may carry .grid (static boxes) plus .extra (moving / deployed solids, always checked).
export function buildGrid(solids, cell) {
  const g = { cell, cells: new Map(), stamp: 0, n: solids.length };
  for (const s of solids) {
    s._st = 0;
    for (let i = Math.floor(s.min.x / cell); i <= Math.floor(s.max.x / cell); i++)
      for (let j = Math.floor(s.min.z / cell); j <= Math.floor(s.max.z / cell); j++) {
        const k = i * 4096 + j; let a = g.cells.get(k); if (!a) g.cells.set(k, a = []); a.push(s);
      }
  }
  return g;
}
// v1.2.26 tournament arenas: while PA.a is set, deployed solids (walls) from another arena (s.arena) are skipped.
export const PA = { a: null };
const inArenaS = s => PA.a === null || s.arena === undefined || s.arena === null || s.arena === PA.a;
// v1.2.35: in the tournament the deployed solids come split by arena (sim.js refreshSolids: S.extraBy, key -1 = every arena),
// so a fighter only goes through its own arena's walls, not every arena's
function pushExtra(S, out) {
  const by = S.extraBy;
  if (by && PA.a !== null) { const a = by.get(PA.a), c = by.get(-1); if (a) for (const s of a) out.push(s); if (c) for (const s of c) out.push(s); return; }
  for (const s of S.extra) if (inArenaS(s)) out.push(s);
}
// The solids that may touch the x/z rectangle (all of S when it has no grid).
export function solidsNear(S, x0, z0, x1, z1) {
  const g = S.grid;
  if (!g) return S;
  const st = ++g.stamp, out = [], c = g.cell;
  for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++)
    for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const a = g.cells.get(i * 4096 + j); if (!a) continue;
      for (const s of a) if (s._st !== st) { s._st = st; out.push(s); }
    }
  if (S.extra) pushExtra(S, out);
  return out;
}
// v1.2.25: the solids in the grid cells a straight x/z line passes through (cell walk), for long sight lines / shots
// where the bounding rectangle would cover most of the map.
export function solidsAlong(S, ax, az, bx, bz) {
  const g = S.grid;
  if (!g) return S;
  const c = g.cell, st = ++g.stamp, out = [];
  let i = Math.floor(ax / c), j = Math.floor(az / c);
  const i1 = Math.floor(bx / c), j1 = Math.floor(bz / c), dx = bx - ax, dz = bz - az;
  const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
  const tdx = dx ? Math.abs(c / dx) : Infinity, tdz = dz ? Math.abs(c / dz) : Infinity;
  let tx = dx ? ((dx > 0 ? (i + 1) * c - ax : ax - i * c) / Math.abs(dx)) : Infinity;
  let tz = dz ? ((dz > 0 ? (j + 1) * c - az : az - j * c) / Math.abs(dz)) : Infinity;
  for (let guard = 0; guard < 4096; guard++) {
    const a = g.cells.get(i * 4096 + j);
    if (a) for (const s of a) if (s._st !== st) { s._st = st; out.push(s); }
    if (i === i1 && j === j1) break;
    if (tx < tz) { i += si; tx += tdx; } else { j += sj; tz += tdz; }
    if (tx > 1.0001 && tz > 1.0001 && (i !== i1 || j !== j1)) { const b = g.cells.get(i1 * 4096 + j1); if (b) for (const s of b) if (s._st !== st) { s._st = st; out.push(s); } break; }
  }
  if (S.extra) pushExtra(S, out);
  return out;
}
// Ground height under (x,z): the open world's hills, 0 everywhere else.
export const floorAt = (level, x, z) => level && level.hAt ? level.hAt(x, z) : 0;

// Polygon arenas: keep a circle of radius r inside every edge. Returns the summed push (0,0 if untouched).
export function clampToArena(level, pos, r) {
  const E = level.edges; let px = 0, pz = 0;
  if (!E) return null;
  for (let it = 0; it < 2; it++) for (const e of E) {
    const d = e.nx * pos.x + e.nz * pos.z - e.c;
    if (d < r) { const k = r - d; pos.x += e.nx * k; pos.z += e.nz * k; px += e.nx * k; pz += e.nz * k; }
  }
  return px || pz ? { x: px, z: pz } : null;
}
// Steering away from arena edges closer than m meters (bots); works for rectangles and polygons.
export function edgePush(level, x, z, m) {
  const E = level.edges || (level._rectEdges = level._rectEdges || arenaEdges(level));
  let px = 0, pz = 0;
  for (const e of E) { const d = e.nx * x + e.nz * z - e.c; if (d < m) { px += e.nx * (m - d) / m; pz += e.nz * (m - d) / m; } }
  return { x: px, z: pz };
}

// Player collision box scales with p.size (health-based, see sizeFor in config.js).
const rad = p => PR * (p.size || 1), tall = p => PH * (p.size || 1);
const LIP = 0.15;   // walking: a ledge this low (a floor slab a touch above the ground, rounding) is stepped onto, not a wall
const STEP = 0.36;  // v28: stair steps (s.stair) this low are walked up like a ramp
function overlaps(p, s, lip = 0, r = rad(p), h = tall(p)) {   // v1.2.6: movePlayer passes r and h (worked out once per move)
  const P = p.pos;
  return P.x + r > s.min.x && P.x - r < s.max.x &&
         P.y + h > s.min.y && P.y < s.max.y - lip &&
         P.z + r > s.min.z && P.z - r < s.max.z;
}

// v1.2.0: snappier feel. On the ground you speed up fast and stop even faster (turning counts as stopping
// the old direction); in the air you keep a bit more control than before.
export function accel(p, tx, tz, dt) {
  const stopping = tx * p.vel.x + tz * p.vel.z < 0.5 * (p.vel.x * p.vel.x + p.vel.z * p.vel.z);
  const k = Math.min(1, dt * (p.onGround ? (stopping ? 26 : 20) : 7.5));
  p.vel.x += (tx - p.vel.x) * k;
  p.vel.z += (tz - p.vel.z) * k;
}

// Sandbag / concrete walls and Core Defense blocks (sim.js barricades) as collision boxes. A wall can sit at any angle;
// physics is axis-aligned boxes, so an angled wall is built from a short row of overlapping boxes along its length.
// v1.2.6: a pure function so the host and a joiner's prediction (main.js) build the very same boxes from a wall.
export function wallSegments(b) {
  const ux = Math.cos(b.ang), uz = Math.sin(b.ang), fx = -uz, fz = ux;  // u = long axis, f = facing
  const axisAligned = Math.min(Math.abs(ux), Math.abs(uz)) < 0.06;
  const n = axisAligned ? 1 : Math.max(3, Math.ceil(b.len / (b.th * 0.9)));
  const seg = b.len / n, out = [];
  for (let i = 0; i < n; i++) {
    const o = -b.len / 2 + (i + 0.5) * seg, cx = b.x + ux * o, cz = b.z + uz * o;
    const hx = axisAligned ? (Math.abs(ux) > 0.5 ? b.len : b.th) / 2 : Math.abs(ux) * seg / 2 + Math.abs(fx) * b.th / 2;
    const hz = axisAligned ? (Math.abs(ux) > 0.5 ? b.th : b.len) / 2 : Math.abs(uz) * seg / 2 + Math.abs(fz) * b.th / 2;
    out.push({ min: { x: cx - hx, y: b.y0, z: cz - hz }, max: { x: cx + hx, y: b.y0 + b.h, z: cz + hz }, barricade: b });
  }
  return out;
}

// Solids may carry .obj (a moving platform / physics prop). Players standing on one ride along
// (p.ground), and walking into a pushable one shoves it.
const THRU = new WeakMap();
// v1.2.6 (joiner prediction): a replay that starts inside a lava-map platform is passing up through it, as the host has it.
export function seedThru(p, solids, level) {
  if (!level.lava || level.side) return;
  const S = solids.grid ? solidsNear(solids, p.pos.x - 2, p.pos.z - 2, p.pos.x + 2, p.pos.z + 2) : solids;
  for (const s of S) if (!s.wall && !s.noPlayer && !s.oneWay && s.min.y > 0.05 && !(s.obj && s.obj.pushable) && overlaps(p, s)) { THRU.set(p, s.obj || s); return; }
}
// v1.2.6 (joiner prediction): snapshot positions are rounded to 1 cm, so a replay can start a hair inside a wall the
// player rests against (or rise into one above). movePlayer pushes out along the axis it is moving on, to the side of
// the box's center, and a hair-deep overlap on the other axis can then throw the body across the arena. So first step
// out of any box beside or above you that overlaps your footprint by no more than the rounding (not what you stand on).
// Run before seedThru, so a hair-deep overlap isn't taken for passing up through a lava-map platform.
export function unstick(p, solids, level, tol = 0.012) {
  const r = rad(p), S = solids.grid ? solidsNear(solids, p.pos.x - 2, p.pos.z - 2, p.pos.x + 2, p.pos.z + 2) : solids;
  for (const s of S) {
    if (s.noPlayer || s.oneWay || s.max.y <= p.pos.y + (s.stair ? STEP : LIP)) continue;
    const lx = p.pos.x + r - s.min.x, hx = s.max.x - (p.pos.x - r), lz = p.pos.z + r - s.min.z, hz = s.max.z - (p.pos.z - r);
    if (lx <= 0 || hx <= 0 || (!level.side && (lz <= 0 || hz <= 0))) continue;
    const dx = Math.min(lx, hx), dz = level.side ? Infinity : Math.min(lz, hz);
    if (dx <= tol && dx <= dz) p.pos.x = lx < hx ? s.min.x - r - 1e-4 : s.max.x + r + 1e-4;
    else if (dz <= tol) p.pos.z = lz < hz ? s.min.z - r - 1e-4 : s.max.z + r + 1e-4;
  }
}
export function movePlayer(p, dt, level, solids = level.solids) {
  const PR = rad(p), PH = tall(p), wasGround = p.onGround;
  if (level.side) { p.pos.z = 0; p.vel.z = 0; }   // 2D side view: everything lives on the z = 0 plane
  const m = PR + 1 + (Math.abs(p.vel.x) + Math.abs(p.vel.z)) * dt;
  const S = solids.grid ? solidsNear(solids, p.pos.x - m, p.pos.z - m, p.pos.x + m, p.pos.z + m) : solids;
  if (!p.flying) p.vel.y -= RULES.gravity * (level.gravK || 1) * dt;
  const push = (s, axis) => { if (s.obj && s.obj.pushable) s.obj.vel[axis] += Math.max(-6, Math.min(6, p.vel[axis])) * 0.12; };
  // One-way platforms (2D): you pass through them from below and sideways, land on them from above,
  // and drop through while p.dropThru > 0 (down + jump).
  const y0 = p.pos.y, oneWay = s => s.oneWay && (p.dropThru > 0 || y0 < s.max.y - 0.12);
  // v1.1.2 Lava / Ice maps: the floating platforms let you up through their bottom (a lava bounce or a jump from
  // underneath no longer pins you below them). THRU holds the platform each player is passing through (kept off the player object, which gets cloned and sent): it ignores you
  // until you're on top of it or out of it.
  const key = s => s.obj || s;   // (moving platforms get fresh solids each tick; their object stays the same)
  let pt = THRU.get(p) || null;
  if (pt && !S.some(s => key(s) === pt && overlaps(p, s, 0, PR, PH))) pt = null;
  const thru = s => pt !== null && key(s) === pt;
  // (v1.2.6: index loops over the solids; a for-of made an iterator per loop wherever this ran unoptimized)
  p.pos.x += p.vel.x * dt;
  for (let i = 0; i < S.length; i++) { const s = S[i]; if (!s.noPlayer && !s.oneWay && !thru(s) && overlaps(p, s, s.stair ? STEP : LIP, PR, PH)) { push(s, 'x'); p.pos.x = p.pos.x < (s.min.x + s.max.x) / 2 ? s.min.x - PR - 1e-4 : s.max.x + PR + 1e-4; p.vel.x = 0; } }
  p.pos.z += p.vel.z * dt;
  if (!level.side) for (let i = 0; i < S.length; i++) { const s = S[i]; if (!s.noPlayer && !s.oneWay && !thru(s) && overlaps(p, s, s.stair ? STEP : LIP, PR, PH)) { push(s, 'z'); p.pos.z = p.pos.z < (s.min.z + s.max.z) / 2 ? s.min.z - PR - 1e-4 : s.max.z + PR + 1e-4; p.vel.z = 0; } }
  p.onGround = false; p.ground = null; p.groundOneWay = false;
  const vy = p.vel.y;
  p.pos.y += p.vel.y * dt;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (s.noPlayer || !overlaps(p, s, 0, PR, PH)) continue;
    if (s.oneWay && (vy > 0 || oneWay(s))) continue;
    if (!thru(s) && level.lava && !level.side && vy > 0 && !s.wall && s.min.y > 0.05 && !(s.obj && s.obj.pushable) && y0 + PH <= s.min.y + 0.05) pt = key(s);   // coming up from underneath
    if (thru(s)) { if (vy <= 0 && y0 >= s.max.y - 0.12) pt = null; else continue; }   // land once your feet clear its top
    if (p.vel.y <= 0 || p.pos.y > (s.min.y + s.max.y) / 2) {
      p.pos.y = s.max.y; p.onGround = true; p.ground = s.obj || null; p.groundOneWay = !!s.oneWay;
      if (s.obj && s.obj.onLand && vy < -2) s.obj.onLand(vy);
    } else p.pos.y = s.min.y - PH - 1e-4;
    p.vel.y = 0;
  }
  if (pt) THRU.set(p, pt); else THRU.delete(p);
  const gy = level.hAt ? level.hAt(p.pos.x, p.pos.z) : 0;
  if (p.pos.y <= gy) { p.pos.y = gy; p.vel.y = Math.max(0, p.vel.y); p.onGround = true; }
  else if (level.hAt && !level.side && wasGround && !p.onGround && vy <= 0 && p.pos.y - gy < 0.45) { p.pos.y = gy; p.vel.y = 0; p.onGround = true; }   // walk down hills, don't hop off them
  const bx = level.hx - PR, bz = level.hz - PR;
  p.pos.x = Math.max(-bx, Math.min(bx, p.pos.x));
  p.pos.z = Math.max(-bz, Math.min(bz, p.pos.z));
  if (level.edges) {
    const push = clampToArena(level, p.pos, PR);
    if (push) { const l = Math.hypot(push.x, push.z), nx = push.x / l, nz = push.z / l, vn = p.vel.x * nx + p.vel.z * nz; if (vn < 0) { p.vel.x -= vn * nx; p.vel.z -= vn * nz; } }
  }
}

// Generic box body (crates, barrels): pos is bottom-center, size {w,h,d}.
// v1.2.6: takes the whole solids list (the body's own solid and noPlayer ones are skipped here, no filtered copy per prop per tick)
export function moveBody(o, dt, solids, level) {
  if (solids.grid) { const m = Math.max(o.w, o.d) + 1; solids = solidsNear(solids, o.pos.x - m, o.pos.z - m, o.pos.x + m, o.pos.z + m); }
  const hw = o.w / 2, hd = o.d / 2;   // v1.2.4: no box object per test (this ran for every prop against every nearby solid, every tick)
  const hit = s => { const P = o.pos; return s.obj !== o && !s.noPlayer && P.x + hw > s.min.x && P.x - hw < s.max.x && P.y + o.h > s.min.y && P.y < s.max.y && P.z + hd > s.min.z && P.z - hd < s.max.z; };
  o.vel.y -= RULES.gravity * (level.gravK || 1) * dt;
  if (level.side) { o.pos.z = 0; o.vel.z = 0; }
  for (let k = 0, nAx = level.side ? 1 : 2; k < nAx; k++) {
    const ax = k ? 'z' : 'x';
    o.pos[ax] += o.vel[ax] * dt;
    const half = ax === 'x' ? o.w / 2 : o.d / 2, lim = (ax === 'x' ? level.hx : level.hz) - half;
    o.pos[ax] = Math.max(-lim, Math.min(lim, o.pos[ax]));   // inside the arena before resolving, so a push-out never fights the arena clamp
    // a surface just under the body's bottom (rounding, a slab a hair higher) is stood on, not a wall to be shoved out of
    for (let i = 0; i < solids.length; i++) { const s = solids[i]; if (hit(s) && !s.oneWay && s.max.y - o.pos.y > 0.15) { o.pos[ax] = o.pos[ax] < (s.min[ax] + s.max[ax]) / 2 ? s.min[ax] - half - 1e-4 : s.max[ax] + half + 1e-4; o.vel[ax] *= -0.3; } }
  }
  o.grounded = false;
  const by0 = o.pos.y;
  o.pos.y += o.vel.y * dt;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (!hit(s)) continue;
    if (s.oneWay && (o.vel.y > 0 || by0 < s.max.y - 0.12)) continue;
    // Land on it when coming down from above (or barely sunk in). A body that sits below the solid (a crate under
    // another crate, a lift coming down) is pushed under it, not teleported on top of it.
    const fromAbove = s.max.y - o.pos.y <= 0.15 || (o.vel.y <= 0 && (by0 >= s.max.y - 0.15 || o.pos.y + o.h / 2 > (s.min.y + s.max.y) / 2));
    if (fromAbove) { o.pos.y = s.max.y; o.grounded = true; } else o.pos.y = s.min.y - o.h - 1e-4;
    o.vel.y = 0;
  }
  const gy = level.hAt ? level.hAt(o.pos.x, o.pos.z) : 0;
  if (o.pos.y <= gy) { o.pos.y = gy; o.vel.y = 0; o.grounded = true; }
  if (o.grounded) { const f = Math.max(0, 1 - 5 * dt); o.vel.x *= f; o.vel.z *= f; }
  o.pos.x = Math.max(-level.hx + o.w / 2, Math.min(level.hx - o.w / 2, o.pos.x));
  o.pos.z = Math.max(-level.hz + o.d / 2, Math.min(level.hz - o.d / 2, o.pos.z));
  if (level.edges) { const push = clampToArena(level, o.pos, Math.max(o.w, o.d) / 2); if (push) { o.vel.x *= -0.3; o.vel.z *= -0.3; } }
}

// Distance along a ray (from inside or at the surface of a box) to where it leaves the box.
export function rayExit(o, d, s) {
  let tmax = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    if (Math.abs(d[ax]) < 1e-9) continue;
    const t = ((d[ax] > 0 ? s.max[ax] : s.min[ax]) - o[ax]) / d[ax];
    if (t < tmax) tmax = t;
  }
  return Math.max(0, tmax);
}

export function pointInSolid(S, x, y, z, r, skip) {
  if (S.grid) S = solidsNear(S, x - r, z - r, x + r, z + r);
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    if (skip && skip(s)) continue;
    if (x > s.min.x - r && x < s.max.x + r && y > s.min.y - r && y < s.max.y + r && z > s.min.z - r && z < s.max.z + r) return s;
  }
  return null;
}

// Line of sight: is any of the points every 0.4 m along a->b (ends excluded) inside a solid?
// v1.2.4: same answer as testing each point against each solid, but worked out per solid (where the line enters
// and leaves the box, then whether one of the points falls in between), so a long sight line costs one test per
// nearby solid instead of one per point per solid. It was the single hottest function in the sim (bots, bullets).
export function segBlocked(S, a, b, skip) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const n = Math.ceil(Math.hypot(dx, dy, dz) / 0.4);
  if (n <= 1) return false;
  const hAt = S.hAt;   // open world: hills block the view too
  if (hAt) for (let i = 1; i < n; i++) { const t = i / n; if (a.y + dy * t < hAt(a.x + dx * t, a.z + dz * t)) return true; }
  if (S.grid) S = solidsAlong(S, a.x, a.z, b.x, b.z);
  for (let k = 0; k < S.length; k++) {
    const s = S[k];
    if (skip && skip(s)) continue;
    let lo = 0, hi = 1;
    if (dx === 0) { if (!(a.x > s.min.x && a.x < s.max.x)) continue; }
    else { const t0 = (s.min.x - a.x) / dx, t1 = (s.max.x - a.x) / dx; if (t0 < t1) { if (t0 > lo) lo = t0; if (t1 < hi) hi = t1; } else { if (t1 > lo) lo = t1; if (t0 < hi) hi = t0; } }
    if (dy === 0) { if (!(a.y > s.min.y && a.y < s.max.y)) continue; }
    else { const t0 = (s.min.y - a.y) / dy, t1 = (s.max.y - a.y) / dy; if (t0 < t1) { if (t0 > lo) lo = t0; if (t1 < hi) hi = t1; } else { if (t1 > lo) lo = t1; if (t0 < hi) hi = t0; } }
    if (dz === 0) { if (!(a.z > s.min.z && a.z < s.max.z)) continue; }
    else { const t0 = (s.min.z - a.z) / dz, t1 = (s.max.z - a.z) / dz; if (t0 < t1) { if (t0 > lo) lo = t0; if (t1 < hi) hi = t1; } else { if (t1 > lo) lo = t1; if (t0 < hi) hi = t0; } }
    if (lo >= hi) continue;
    // a sample point i/n with lo < i/n < hi (1 <= i <= n-1)?
    const i0 = Math.max(1, Math.floor(lo * n) + 1), i1 = Math.min(n - 1, Math.ceil(hi * n) - 1);
    for (let i = i0; i <= i1; i++) {   // (normally the first one; rechecked exactly like the point test did)
      const t = i / n, x = a.x + dx * t, y = a.y + dy * t, z = a.z + dz * t;
      if (x > s.min.x && x < s.max.x && y > s.min.y && y < s.max.y && z > s.min.z && z < s.max.z) return true;
      if (i - i0 > 2) break;
    }
  }
  return false;
}

// Height of the highest surface under (x,z) at or below y. Used for drop shadows.
export function groundBelow(S, x, z, y) {
  let g = S.hAt ? S.hAt(x, z) : 0;
  if (S.grid) S = solidsNear(S, x, z, x, z);
  for (const s of S) if (x > s.min.x && x < s.max.x && z > s.min.z && z < s.max.z && s.max.y <= y + 0.05 && s.max.y > g) g = s.max.y;
  return g;
}
