// Bots write into p.input exactly like a human player would.
import { coreTarget, coreFlowDir } from './core.js';
import { RULES, DIFFICULTY, speedFor } from './config.js';
import { segBlocked, edgePush, solidsNear, groundBelow } from './physics.js';
import { dodgeFor } from './coop.js';
import { sideBotSteer } from './side.js';

const chestOf = q => ({ x: q.pos.x, y: q.pos.y + RULES.chest * (q.size || 1), z: q.pos.z });
const G = RULES.gravity;

// Lava / Ice Sheets: about to step off a platform into the liquid: jump instead, so the step becomes a hop to the next one.
function lavaJumpAhead(p, inp) { if (p.onGround) inp.jumpAhead = true; }

// ---------------------------------------------------------------- platform navigation
// Every surface a bot can stand on is a node: static blocks, rising pillars, sliding and floating
// platforms, and the floor (except on Lava Lake). Nodes on moving objects read their live position.
// Bots path between nodes (walk, climb, or jump a gap) to take high ground and to hop platforms.
const NAV_HEIGHT_W = { easy: 0.35, normal: 0.75, hard: 1.1 };
const NAV_CHANCE = { easy: 0.3, normal: 0.55, hard: 0.8 };
function rectOf(n) {
  if (!n.obj) return n;
  const o = n.obj;
  n.x0 = o.pos.x - o.w / 2; n.x1 = o.pos.x + o.w / 2; n.z0 = o.pos.z - o.d / 2; n.z1 = o.pos.z + o.d / 2; n.top = o.pos.y + o.h;
  return n;
}
// v1.2.6: returns the cached node list itself (moving nodes refreshed in place), not a copy per call; callers only read it
export function navNodes(g) {
  if (g._nav && g._nav.v === g.levelVersion && g._nav.level === g.level) { const N = g._nav.nodes; for (let i = 0; i < N.length; i++) rectOf(N[i]); return N; }
  const L = g.level, nodes = [];
  if (!L.lava) nodes.push({ floor: true, x0: -L.hx, x1: L.hx, z0: -L.hz, z1: L.hz, top: 0 });
  for (const b of L.boxes) if (!b.wall && b.w >= 0.9 && b.d >= 0.9) {
    const n = { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, top: b.y0 + b.h, spots: [] };
    // Spots on top with head room (not under another block stacked on this one).
    const nx = Math.max(1, Math.round((b.w - 0.7) / 0.5)), nz = Math.max(1, Math.round((b.d - 0.7) / 0.5));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const x = n.x0 + 0.35 + (b.w - 0.7) * (nx ? i / nx : 0.5), z = n.z0 + 0.35 + (b.d - 0.7) * (nz ? j / nz : 0.5);
      if (!solidsNear(L.solids, x - 0.4, z - 0.4, x + 0.4, z + 0.4).some(q => !q.wall && q.max.y > n.top + 0.05 && q.min.y < n.top + 1.6 && x + 0.4 > q.min.x && x - 0.4 < q.max.x && z + 0.4 > q.min.z && z - 0.4 < q.max.z)) n.spots.push({ x, z });
    }
    if (n.spots.length) nodes.push(n);
  }
  for (const o of g.dyn) if (o.kind === 'piston' || o.kind === 'slide' || o.kind === 'float') nodes.push({ obj: o, kind: o.kind, hMax: o.def && o.def.hMax });
  nodes.forEach((n, i) => { n.i = i; });
  nodes.moving = nodes.some(n => n.obj);
  g._nav = { v: g.levelVersion, level: L, nodes };
  for (const n of nodes) rectOf(n);
  return nodes;
}
const rectGap = (a, b) => {
  let gx = a.x0 - b.x1, gz = a.z0 - b.z1;
  const hx = b.x0 - a.x1, hz = b.z0 - a.z1;
  if (hx > gx) gx = hx; if (hz > gz) gz = hz;
  if (gx < 0) gx = 0; if (gz < 0) gz = 0;
  return Math.sqrt(gx * gx + gz * gz);
};
const pointGap = (x, z, n) => Math.hypot(Math.max(0, n.x0 - x, x - n.x1), Math.max(0, n.z0 - z, z - n.z1));
const inside = (x, z, n, m = 0) => x > n.x0 + m && x < n.x1 - m && z > n.z0 + m && z < n.z1 - m;
// Can a player with this jump/speed get from node a onto node b?
function canReach(a, b, jump, spd) {
  const dy = b.top - a.top, jumpH = jump * jump / (2 * G) - 0.12;
  if (dy > jumpH) return false;
  const gap = a.floor || b.floor ? 0 : rectGap(a, b);
  if (gap <= 0.05) return true;
  if (jump <= 0) return false;
  const disc = jump * jump - 2 * G * dy;
  if (disc < 0) return false;
  const t = (jump + Math.sqrt(disc)) / G;
  return gap <= spd * t * 0.8 - 0.4;
}
export function currentNode(p, nodes) {
  const C = p._cn;   // v1.2.25: same spot, same answer (asked several times per bot per step, and for targets)
  if (C && C.nodes === nodes && C.x === p.pos.x && C.y === p.pos.y && C.z === p.pos.z && C.g === p.onGround && !nodes.moving) return C.res;
  const res = currentNode0(p, nodes);
  p._cn = { nodes, x: p.pos.x, y: p.pos.y, z: p.pos.z, g: p.onGround, res };
  return res;
}
function currentNode0(p, nodes) {
  let best = null;
  if (p.onGround || p.flying === false) {
    for (const n of nodes) {
      if (n.floor) continue;
      if (inside(p.pos.x, p.pos.z, n, -0.05) && Math.abs(n.top - p.pos.y) < 0.3 && (!best || n.top > best.top)) best = n;
    }
  }
  if (!best && p.pos.y < 0.3) best = nodes.find(n => n.floor) || null;
  return best;
}
// Breadth-first search over reachable nodes from `start`. Returns parent links.
// v1.2.25: the fixed nodes' links are worked out once per jump/speed (they were re-tested pairwise on every search);
// moving platforms are still tested live. Same order as testing every node, so the same paths come out.
function navLinks(nodes, jump, spd) {
  const C = nodes.links || (nodes.links = new Map()), key = Math.round(jump * 10) * 1000 + Math.round(spd * 10);
  let L = C.get(key);
  if (L) return L;
  // longest possible hop (from the highest node down to the floor), to skip far pairs without the full test
  let hi = 0; for (const n of nodes) if (!n.obj && n.top > hi) hi = n.top;
  const far = jump > 0 ? spd * (jump + Math.sqrt(jump * jump + 2 * G * (hi + 1))) / G : 0.06;
  // the fixed nodes bucketed on a grid so each node only looks at the ones within a hop
  const cs = Math.max(4, far / 3), cells = new Map(), always = [];
  let stamp = (nodes.lstamp || 0) + 1e6; nodes.lstamp = stamp;
  for (const n of nodes) {
    if (n.obj || n.floor) { always.push(n); continue; }
    for (let i = Math.floor(n.x0 / cs); i <= Math.floor(n.x1 / cs); i++) for (let j = Math.floor(n.z0 / cs); j <= Math.floor(n.z1 / cs); j++) { const k = i * 4096 + j; let c = cells.get(k); if (!c) cells.set(k, c = []); c.push(n); }
  }
  L = nodes.map(a => {
    if (a.obj) return null;
    let cand;
    if (a.floor) cand = nodes;
    else {
      const fa = jump > 0 ? spd * (jump + Math.sqrt(jump * jump + 2 * G * (a.top + 0.5))) / G * 0.8 : 0.06;   // (furthest hop from this height)
      const st = ++stamp; cand = always.slice();
      for (let i = Math.floor((a.x0 - fa) / cs); i <= Math.floor((a.x1 + fa) / cs); i++) for (let j = Math.floor((a.z0 - fa) / cs); j <= Math.floor((a.z1 + fa) / cs); j++) { const c = cells.get(i * 4096 + j); if (c) for (const n of c) if (n._ls !== st) { n._ls = st; cand.push(n); } }
      cand.sort((x, y) => x.i - y.i);
    }
    return cand.filter(b => b !== a && (b.obj || canReach(a, b, jump, spd)));   // (moving ones kept as candidates)
  });
  C.set(key, L);
  return L;
}
function navBFS(start, nodes, jump, spd) {
  const par = new Map([[start, null]]), q = [start], links = navLinks(nodes, jump, spd);
  for (let qi = 0; qi < q.length; qi++) {
    const a = q[qi], list = links[a.i] || nodes;
    for (const b of list) if (!par.has(b) && b !== a && ((!a.obj && !b.obj) || canReach(a, b, jump, spd))) { par.set(b, a); q.push(b); }
  }
  return par;
}
function pathTo(par, goal) { const out = []; for (let n = goal; n; n = par.get(n)) out.unshift(n); return out; }

function planNav(g, p, A, t, D, force) {
  const nodes = navNodes(g), cur = currentNode(p, nodes);
  if (!cur) return false;
  const s = p.stats, spd = Math.floor(s.moveSpeed * D.speed * 2) / 2, jmp = Math.floor(s.jump * 4) / 4;   // (v1.2.25: rounded down so bots share searches)
  // v1.2.25: bots with the same jump/speed standing on the same node share one search (refreshed every 0.5 s for moving platforms)
  const NC = g._nav, key = cur.i * 1e6 + Math.round(jmp * 10) * 1000 + Math.round(spd * 10);
  if (!NC.bfs || NC.bfsT > g.time || g.time - NC.bfsT > 0.5) { NC.bfs = new Map(); NC.bfsT = g.time; }
  let par = NC.bfs.get(key);
  if (!par) NC.bfs.set(key, par = navBFS(cur, nodes, jmp, spd));
  const hw = NAV_HEIGHT_W[p.difficulty] ?? 0.75, want = A.want || 9;
  const tc = t ? chestOf(t) : null;
  // v1.2.25: the cheap part of the score first; sight lines and crowding (which only add up to +3 / subtract) are only
  // worked out for nodes that could still win, best first. Same pick as scoring every node fully.
  const base = n => {
    if (n.floor) return -2;
    const w = n.x1 - n.x0, d = n.z1 - n.z0;
    if (w < 0.9 || d < 0.9) return -Infinity;
    const cx = (n.x0 + n.x1) / 2, cz = (n.z0 + n.z1) / 2, h = n.hMax ? (n.top + n.hMax) / 2 : n.top;
    let sc = h * hw * 2 - 0.08 * Math.hypot(cx - p.pos.x, cz - p.pos.z);
    if (tc) sc -= 0.12 * Math.abs(Math.hypot(cx - tc.x, cz - tc.z) - want);
    if (n === cur) sc += force ? -1 : 1.2;   // a little stickiness so bots don't dither
    return sc;
  };
  const extra = n => {
    if (n.floor) return 0;
    let sc = 0;
    if (tc) {
      const eye = { x: (n.x0 + n.x1) / 2, y: n.top + RULES.chest * (p.size || 1), z: (n.z0 + n.z1) / 2 };
      if (!segBlocked(g.level.solids, eye, tc)) sc += 3;
    }
    for (const q of g.players) if (q !== p && q.alive && !q.flying && inside(q.pos.x, q.pos.z, n, -0.2) && Math.abs(q.pos.y - n.top) < 0.4) sc -= g.isEnemy(p, q) ? 1.5 : 2.5;
    return sc;
  };
  const cands = [];
  let o = 0;
  for (const n of par.keys()) { o++; if (A.bad && A.bad.has(n) && A.bad.get(n) > g.time) continue; const b0 = base(n); if (b0 === -Infinity) continue; cands.push({ n, o, b0, ub: n.floor ? b0 : b0 + (tc ? 3 : 0) }); }
  cands.sort((a, b) => b.ub - a.ub || a.o - b.o);
  let best = null, bs = -Infinity, bo = 0;
  for (const c of cands) {
    if (c.ub < bs) break;
    const sc = c.b0 + extra(c.n);
    if (sc > bs || (sc === bs && c.o < bo)) { bs = sc; best = c.n; bo = c.o; }
  }
  if (!best || best === cur) { A.path = null; A.goal = best === cur ? cur : null; return false; }
  A.path = pathTo(par, best); A.pi = 1; A.goal = best; A.navAge = 0; A.lastToSpot = null; A.navStuck = 0;
  return true;
}
// Steering for the current path step. Returns { mx, mz, jump } or null when not navigating.
// Is the ground step ahead blocked by something too tall to hop onto?
function blockedAhead(g, p, dx, dz, dist = 0.8) {
  const l = Math.hypot(dx, dz) || 1, x = p.pos.x + dx / l * dist, z = p.pos.z + dz / l * dist, r = RULES.playerRadius * (p.size || 1);
  const reach = p.pos.y + (p.stats.jump * p.stats.jump) / (2 * G) - 0.15;
  return solidsNear(g.solids, x - r, z - r, x + r, z + r).some(s => !s.noPlayer && s.max.y > reach && s.min.y < p.pos.y + 1.4 && x + r > s.min.x && x - r < s.max.x && z + r > s.min.z && z - r < s.max.z);
}
// Steer around a wall: try turning further and further left/right, preferring the side toward the goal.
export function detour(g, p, A, mx, mz) {
  if (!blockedAhead(g, p, mx, mz)) return [mx, mz];
  const side = A.detourSide || (Math.random() < 0.5 ? 1 : -1);
  for (const a of [0.6, 1.1, 1.6, 2.2]) for (const sd of [side, -side]) {
    const c = Math.cos(a * sd), sn = Math.sin(a * sd), rx = mx * c - mz * sn, rz = mx * sn + mz * c;
    if (!blockedAhead(g, p, rx, rz)) { A.detourSide = sd; return [rx, rz]; }
  }
  return [mx, mz];
}
function giveUp(g, A, why) {
  if (A.goal) (A.bad = A.bad || new Map()).set(A.goal, g.time + 6);
  A.path = null; A.replan = 0.2; A.navStuck = 0;
}
// Steering for the current path step. Returns { mx, mz, jump } or null when not navigating.
function followNav(g, p, A, dt) {
  if (!A.path) return null;
  const nodes = navNodes(g), cur = currentNode(p, nodes);
  A.navAge = (A.navAge || 0) + dt;
  if (A.navAge > 9) { giveUp(g, A); return null; }
  if (cur) {
    const k = A.path.indexOf(cur);
    if (k >= 0 && k + 1 > A.pi) A.pi = k + 1;
    // fell back down or off the route: plan again from here
    else if (p.onGround && (k < 0 || k < A.pi - 1) && A.lastCur && cur !== A.lastCur) { A.path = null; A.replan = 0; return null; }
    A.lastCur = cur;
  }
  if (A.pi >= A.path.length) { A.path = null; A.navStuck = 0; A.holdT = 2.5 + Math.random() * 3.5; return null; }
  const nx = A.path[A.pi], c = A.path[A.pi - 1];
  // Aim for the nearest spot on the next platform that has head room.
  let tx, tz;
  if (nx.spots && !nx.floor) {
    let bd = Infinity;
    for (const sp of nx.spots) { const d = Math.hypot(sp.x - p.pos.x, sp.z - p.pos.z); if (d < bd) { bd = d; tx = sp.x; tz = sp.z; } }
  } else {
    const inset = Math.max(0, Math.min(0.6, (nx.x1 - nx.x0) / 2 - 0.05, (nx.z1 - nx.z0) / 2 - 0.05));
    tx = Math.max(nx.x0 + inset, Math.min(nx.x1 - inset, p.pos.x)); tz = Math.max(nx.z0 + inset, Math.min(nx.z1 - inset, p.pos.z));
  }
  let mx = tx - p.pos.x, mz = tz - p.pos.z;
  if (Math.hypot(mx, mz) < 0.05) { mx = (nx.x0 + nx.x1) / 2 - p.pos.x; mz = (nx.z0 + nx.z1) / 2 - p.pos.z; }
  const toEdge = pointGap(p.pos.x, p.pos.z, nx), toSpot = Math.hypot(tx - p.pos.x, tz - p.pos.z);
  const climb = nx.top - (c ? c.top : p.pos.y) > 0.2 && nx.top - p.pos.y > 0.2;
  const gap = c && !c.floor && !nx.floor ? rectGap(c, nx) : 0;
  // walking across a floor or platform toward a far node: go around walls instead of into them
  if (!climb || toEdge > 1.2) [mx, mz] = detour(g, p, A, mx, mz);
  const hs = Math.hypot(p.vel.x, p.vel.z), spd = p.stats.moveSpeed;
  let jump = false;
  if (p.onGround && p.stats.jump > 0) {
    if (climb && toEdge < 1.0 && toSpot < 1.9) jump = true;
    else if (gap > 0.15) {
      const disc = Math.max(0, p.stats.jump ** 2 - 2 * G * (nx.top - p.pos.y)), tAir = (p.stats.jump + Math.sqrt(disc)) / G;
      const reach = Math.max(hs, spd * 0.6) * tAir * 0.8;
      const atEdge = c && pointGap(p.pos.x, p.pos.z, { x0: c.x0 + 0.55, x1: c.x1 - 0.55, z0: c.z0 + 0.55, z1: c.z1 - 0.55 }) > 0;
      if (toEdge < reach - 0.3 || atEdge) jump = true;
    }
  }
  // No progress toward the next step for a while: mark this goal as bad for a few seconds and move on.
  const prog = A.lastToSpot != null ? A.lastToSpot - toSpot : 0; A.lastToSpot = toSpot;
  A.navStuck = (prog < spd * dt * 0.2 && hs < 1.2) ? (A.navStuck || 0) + dt : Math.max(0, (A.navStuck || 0) - dt * 2);
  if (A.navStuck > 1.4) { giveUp(g, A); return null; }
  return { mx, mz, jump, nav: true };
}

export function botThink(g, p, dt) {
  const D = DIFFICULTY[p.difficulty] || DIFFICULTY.normal;
  const A = p.ai, inp = p.input, S = g.level.solids;
  if (!A.init) Object.assign(A, { init: 1, thinkT: 0, strafe: 1, want: 9, losT: 0, lx: p.pos.x, lz: p.pos.z, noise: { x: 0, y: 0, z: 0 }, noiseT: 0, retarget: 0, target: null });
  const from = chestOf(p);

  A.retarget -= dt;
  if (A.retarget <= 0 || !A.target || !A.target.alive) {
    A.retarget = 0.6;
    let best = null, bd = Infinity;
    const far = g.ow ? g.ow.sight || 34 : Infinity;   // open world: bots only notice what's near them
    for (const q of g.players) {
      if (!q.alive) continue;
      let d = Math.hypot(q.pos.x - from.x, q.pos.z - from.z);
      // v1.2.6: no closer than the best so far: it can't win even in plain sight, so skip isEnemy and the line-of-sight test
      if (d >= bd || !g.isEnemy(p, q) || (q.ow && q.ow.st === 'bus')) continue;
      if (d > far * (q.crouch && g.ow ? g.ow.crouchK || 1 : 1)) continue;   // open world: crouching heroes are harder to spot
      if (segBlocked(S, from, chestOf(q))) d += 12;
      if (d < bd) { bd = d; best = q; }
    }
    A.target = best;
    // Core Defense: raiders go for the core unless something is in their hit zone (aggressive kinds hunt players first)
    if (g.settings.core && p.team === 1 && p.kind !== 'boss') A.target = coreTarget(g, p) || best;
  }
  const t = A.target;
  // Melee wave enemies (critters, blobs): run straight at the target, no shooting.
  if (p.melee) {
    inp.shoot = false;
    if (!t) { inp.mx = inp.mz = 0; return; }
    const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1;
    const wob = p.kind === 'critter' ? Math.sin(g.time * 9 + p.pos.x) * 0.5 : 0;
    inp.mx = dx / d - dz / d * wob; inp.mz = dz / d + dx / d * wob;
    if (p.kind === 'critter') {
      // Critters keep their distance: they hold just inside bite range instead of running into your feet,
      // circling and backing off when they get too close.
      // Braking distance grows with top speed, so fast weapon-mod critters stop at bite range like wave critters.
      const top = p.stats.moveSpeed * speedFor(p.size || 0.5), stand = g.critterReach(p, t) - 0.35, brake = Math.max(2.2, top * 0.17);
      if (d < stand + brake) {   // ease off on the way in (they run at bullet speed), back off if too close, circle meanwhile
        const k = Math.max(-1, Math.min(1, (d - stand) / brake)), c = A.circle = A.circle || (Math.random() < 0.5 ? -1 : 1);
        const vin = (p.vel.x * dx + p.vel.z * dz) / d;   // closing speed
        // Outside the standing distance always pull in firmly, or fast critters get slung into an orbit just past bite range.
        const kk = vin > 4 && d < stand + Math.max(1.2, top * 0.08) ? -1 : d > stand ? Math.max(k, 0.45) : k;
        const orbit = 0.5 * Math.min(1, 12 / Math.max(1, top));   // fast critters circle less
        inp.mx = dx / d * kk - dz / d * c * orbit; inp.mz = dz / d * kk + dx / d * c * orbit;
      }
    }
    const moved = Math.hypot(p.pos.x - A.lx, p.pos.z - A.lz); A.lx = p.pos.x; A.lz = p.pos.z;
    inp.jump = p.onGround && p.stats.jump > 0 && moved < p.stats.moveSpeed * dt * 0.3;
    // Big melee units (Cursed Sacrifice brutes, splitters): steer around walls, path up platforms, and wriggle free when stuck.
    const big = p.kind !== 'critter' && !g.level.side;
    if (big) {
      [inp.mx, inp.mz] = detour(g, p, A, inp.mx, inp.mz);
      A.stuckT = moved < p.stats.moveSpeed * dt * 0.25 ? (A.stuckT || 0) + dt : Math.max(0, (A.stuckT || 0) - dt * 2);
      if (A.stuckT > 0.7 && !(A.unstickT > 0)) { A.unstickT = 0.8; A.unstickDir = Math.random() < 0.5 ? -1 : 1; A.detourSide = A.unstickDir; A.path = null; A.replan = 0; }
    }
    // Big units only path over platforms when the target is up high; on the ground they walk around things (below).
    const upHigh = t.pos.y > p.pos.y + 0.8;
    if (big) {
      // No real progress toward the target for a while (circling a pillar, pacing behind a ledge): pick a side and
      // walk well around the obstacle for a moment, then head straight in again.
      if (A.bestD == null || d < A.bestD - 0.75) { A.bestD = d; A.progT = 0; if (!(A.aroundT > 0)) A.aroundN = 0; } else A.progT = (A.progT || 0) + dt;
      if (A.progT > 2 && !(A.aroundT > 0)) {
        // Same side, a longer swing each time; switch sides after two misses in a row.
        A.aroundN = (A.aroundN || 0) + 1;
        if (!A.aroundSide || A.aroundN % 3 === 0) A.aroundSide = -(A.aroundSide || (Math.random() < 0.5 ? 1 : -1));
        A.aroundT = 1.2 + 0.8 * Math.min(4, A.aroundN); A.progT = 0; A.bestD = d; A.path = null;
      }
    }
    if ((g.level.lava || (big && upHigh)) && p.stats.jump > 0 && !(A.aroundT > 0)) { // hop platforms toward the target instead of walking into the lava
      const nodes = navNodes(g), mine = currentNode(p, nodes), theirs = currentNode(t, nodes);
      A.replan = (A.replan || 0) - dt;
      if (mine && theirs && mine !== theirs && (!A.path || A.goal !== theirs) && A.replan <= 0) {
        A.replan = 0.5;
        const par = navBFS(mine, nodes, Math.floor(p.stats.jump * 4) / 4, Math.floor(p.stats.moveSpeed * 2) / 2);
        if (par.has(theirs)) { A.path = pathTo(par, theirs); A.pi = 1; A.goal = theirs; A.navAge = 0; }
      }
      if (mine === theirs) A.path = null;
      const nv = followNav(g, p, A, dt);
      if (nv) { inp.mx = nv.mx; inp.mz = nv.mz; inp.jump = nv.jump; const l = Math.hypot(inp.mx, inp.mz) || 1; inp.mx /= l; inp.mz /= l; }
    }
    if (big && A.aroundT > 0) {   // going around: mostly sideways, a little forward, steering off walls
      A.aroundT -= dt;
      const fx = dx / d, fz = dz / d, sd = A.aroundSide;
      [inp.mx, inp.mz] = detour(g, p, A, -fz * sd * 0.9 + fx * 0.35, fx * sd * 0.9 + fz * 0.35);
      if (A.aroundT <= 0) A.bestD = d;
    }
    if (big && A.unstickT > 0) {   // stuck: sidestep at a right angle and hop for a moment
      A.unstickT -= dt;
      const sx = -inp.mz * A.unstickDir, sz = inp.mx * A.unstickDir;
      inp.mx = sx * 0.8 + inp.mx * 0.2; inp.mz = sz * 0.8 + inp.mz * 0.2;
      inp.jump = p.onGround && p.stats.jump > 0;
      if (A.unstickT <= 0) A.stuckT = 0;
    }
    // v28 Core Defense: walk the path around the players' builds to the core (or into the weakest wall when it's closed off)
    if (g.settings.core && p.team === 1 && t === g.core && !p.flying) {
      const f = coreFlowDir(g, p);
      if (f) { inp.mx = f.x; inp.mz = f.z; A.aroundT = 0; A.unstickT = 0; inp.jump = false; }
    }
    inp.aim = { x: dx / d, y: 0, z: dz / d };
    if (g.level.side) { sideBotSteer(g, p, inp, t, null, A, 0); inp.aim = { x: Math.sign(dx) || 1, y: 0, z: 0 }; }
    return;
  }
  if (!t) { inp.mx = inp.mz = 0; inp.shoot = false; inp.jump = false; return; }

  const to = chestOf(t);
  const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, dist = Math.hypot(dx, dz) || 0.001;
  const fx = dx / dist, fz = dz / dist;
  A.thinkT -= dt;
  if (A.thinkT <= 0) {
    A.thinkT = 0.5 + Math.random() * 0.9;
    A.strafe = Math.random() < 0.15 ? 0 : (Math.random() < 0.5 ? -1 : 1);
    A.want = p.mod === 'katana' ? 1.2 : p.mod === 'flamethrower' || p.mod === 'scattergun' ? 2.5 + Math.random() * 2 : 7 + Math.random() * 6;
  }
  const los = !segBlocked(S, from, to);
  let fwd = dist > A.want + 1.5 ? 1 : dist < A.want - 1.5 ? -1 : 0;
  // No line of sight: approach, but if that hasn't worked for a while, flank around the cover.
  A.noLos = los ? 0 : (A.noLos || 0) + dt;
  if (!los) {
    fwd = 1;
    if (A.noLos > 1.5) {
      if (!A.flankDir || A.noLos > (A.flankFlip || 0)) { A.flankDir = A.flankDir ? -A.flankDir : (Math.random() < 0.5 ? -1 : 1); A.flankFlip = A.noLos + 3.5; }
      A.strafe = A.flankDir; fwd = 0.35;
    }
  }
  let mx = fx * fwd - fz * A.strafe * 0.8, mz = fz * fwd + fx * A.strafe * 0.8;
  const stationary = p.stats.moveSpeed <= 0.01;
  // keep away from walls and teammates
  { const e = edgePush(g.level, p.pos.x, p.pos.z, 2.8); mx += e.x * 1.2; mz += e.z * 1.2; }   // rectangles and polygon arenas
  for (const q of g.players) {
    if (q === p || !q.alive || g.isEnemy(p, q)) continue;
    const ox = p.pos.x - q.pos.x, oz = p.pos.z - q.pos.z, od = Math.hypot(ox, oz);
    if (od < 2.5 && od > 0.01) { mx += ox / od * 0.8; mz += oz / od * 0.8; }
  }
  // ---- platform navigation: take high ground, hop between platforms, never sit idle
  const lava = g.level.lava && !p.flying;
  const canNav = !stationary && !p.flying && p.stats.jump > 0 && !g.level.open && !g.level.side;   // side view steers itself (sideBotSteer)   // no platform graph on the open world map
  const movedNow = Math.hypot(p.pos.x - A.lx, p.pos.z - A.lz);
  A.lx = p.pos.x; A.lz = p.pos.z;
  // "Idle" = barely moving while it wants to, or no shot at anyone for a while.
  A.idleT = (movedNow < p.stats.moveSpeed * dt * 0.25 && (Math.hypot(mx, mz) > 0.3 || !los)) ? (A.idleT || 0) + dt : 0;
  A.holdT = (A.holdT || 0) - dt;
  A.replan = (A.replan || 0) - dt;
  let nav = null;
  if (lava && p.pos.y < 0.6) A.path = null;   // in the lava: the escape logic below takes over
  else if (canNav) {
    const far = dist > A.want + 4;
    const needMove = lava ? (!los || far || A.idleT > 0.8) : (A.idleT > 1.2 || A.noLos > 2.5);
    if (!A.path && A.replan <= 0 && (needMove || (A.holdT <= 0 && Math.random() < (lava ? 0.6 : NAV_CHANCE[p.difficulty] ?? 0.5)))) {
      A.replan = lava ? 0.7 : 1.5 + Math.random() * 2;
      planNav(g, p, A, t, D, needMove);
      if (!A.path && needMove && !lava) A.flankDir = -(A.flankDir || 1);
    }
    nav = followNav(g, p, A, dt);
  }
  let lavaJump = false;
  if (nav) {
    mx = nav.mx; mz = nav.mz;
    // Lava / Ice Sheets (v26): never walk off a platform into the liquid unless the path jumps the gap here.
    if (lava && p.onGround && p.pos.y > 0.3 && !nav.jump) {
      const ml = Math.hypot(mx, mz) || 1;
      if (groundBelow(g.solids, p.pos.x + mx / ml * 0.8, p.pos.z + mz / ml * 0.8, p.pos.y + 0.2) < 0.3) { lavaJumpAhead(p, inp); }
    }
  }
  else if (lava || (g.level.lava && p.pos.y < 0.6 && !p.flying)) {
    const floats = g.dyn.filter(o => o.kind === 'float' || o.kind === 'slide');
    const onPlat = (x, z) => floats.some(o => Math.abs(x - o.pos.x) < o.w / 2 - 0.3 && Math.abs(z - o.pos.z) < o.d / 2 - 0.3);
    if (p.pos.y < 0.6) {
      let best = null, bd = Infinity;
      for (const o of floats) { const d = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z); if (d < bd) { bd = d; best = o; } }
      if (best) { mx = best.pos.x - p.pos.x; mz = best.pos.z - p.pos.z; lavaJump = true; }
    } else if (p.onGround) {
      const ml = Math.hypot(mx, mz) || 1, nx = p.pos.x + mx / ml * 0.9, nz = p.pos.z + mz / ml * 0.9;
      if (!onPlat(nx, nz) && groundBelow(g.solids, nx, nz, p.pos.y + 0.2) < 0.3) { mx = mz = 0; A.strafe = -A.strafe; }   // stay on the floe / platform
    }
  } else if (A.goal && !A.goal.floor && A.holdT > 0 && p.onGround && currentNode(p, navNodes(g)) === A.goal) {
    // Holding a perch: keep shuffling between spots on it (never standing still), never off the edge.
    // Without a shot from up here for a while, give it up and go elsewhere.
    const n = rectOf(A.goal);
    if (A.noLos > 1.5) A.holdT = 0;
    A.wanderT = (A.wanderT || 0) - dt;
    const m = Math.min(0.45, (n.x1 - n.x0) / 2 - 0.05, (n.z1 - n.z0) / 2 - 0.05);
    if (A.wanderT <= 0 || !A.wander || Math.hypot(A.wander.x - p.pos.x, A.wander.z - p.pos.z) < 0.25) {
      A.wanderT = 0.5 + Math.random() * 0.7;
      A.wander = { x: n.x0 + m + Math.random() * Math.max(0, n.x1 - n.x0 - 2 * m), z: n.z0 + m + Math.random() * Math.max(0, n.z1 - n.z0 - 2 * m) };
    }
    mx = A.wander.x - p.pos.x; mz = A.wander.z - p.pos.z;
    const dd = Math.hypot(mx, mz);
    if (dd < 0.6 && dd > 0.01) { mx *= 0.6 / dd; mz *= 0.6 / dd; }   // small perches: still a gentle shuffle
  }
  // Co-op boss: step out of telegraphed attacks that are about to land, hop shockwaves.
  const dodge = g.boss && g.boss.alive && !stationary ? dodgeFor(g, p) : null;
  if (dodge && dodge.move) { mx = dodge.x; mz = dodge.z; A.path = null; }
  const l = Math.hypot(mx, mz);
  if (stationary) { inp.mx = inp.mz = 0; }
  else if (l > 0.01) { inp.mx = mx / l * D.speed; inp.mz = mz / l * D.speed; } else { inp.mx = inp.mz = 0; }

  const wantJump = (l > 0.01 && movedNow < p.stats.moveSpeed * dt * 0.3) || Math.random() < dt * 0.5;
  inp.jump = !stationary && p.onGround && inp.jumpAhead || !stationary && p.onGround && (dodge && dodge.jump) || !stationary && p.onGround && (nav ? nav.jump || (A.idleT > 0.6 && !lava) : (lavaJump || (wantJump && !(lava && p.pos.y > 0.6))));

  inp.jumpAhead = false;
  A.noiseT -= dt;
  if (A.noiseT <= 0) {
    A.noiseT = 0.3;
    const k = D.noise * dist;
    A.noise = { x: (Math.random() - 0.5) * k, y: (Math.random() - 0.5) * k * 0.4, z: (Math.random() - 0.5) * k };
  }
  const lead = dist / p.stats.bulletSpeed * D.lead;
  const flight = dist / p.stats.bulletSpeed;
  const drop = 0.5 * g.bulletGrav(p) * flight * flight;   // aim a little high to cancel bullet drop
  const ap = { x: to.x + t.vel.x * lead + A.noise.x, y: Math.max(to.y + t.vel.y * lead * 0.3 + A.noise.y, t.pos.y + 0.4) + drop, z: to.z + t.vel.z * lead + A.noise.z };
  inp.aimPoint = { x: ap.x, y: ap.y - drop, z: ap.z };
  const ax = ap.x - from.x, ay = ap.y - from.y, az = ap.z - from.z, al = Math.hypot(ax, ay, az) || 1;
  inp.aim = { x: ax / al, y: ay / al, z: az / al };

  const canHit = (los || p.stats.skyfall > 0) && !(g.isTurret(p) && g.deployBlocked(from, to));   // turrets hold fire behind walls and bastions
  if (canHit) A.losT += dt; else A.losT = 0;
  inp.shoot = canHit && A.losT > D.react;
  if (!canHit) g.startReload(p);

  // Katana: tap to slash up close (press, then release so the next click registers); from range, hold to charge
  // a slash wave and let it go once it's charged enough.
  if (p.mod === 'katana') {
    const f = p.fx, reach = g.katanaReach(p) + 0.5 * (t.size || 1);
    if (los && dist < reach + 0.4 && A.losT > D.react * 0.5) inp.shoot = !f.kHeld && p.fireT <= 0;
    else if (los && dist < 24 && A.losT > D.react) {
      A.kWant = A.kWant ?? 0.55 + Math.random() * 0.45;
      inp.shoot = !(f.kHeld && (f.kCharge || 0) >= A.kWant);
      if (!inp.shoot) A.kWant = null;
    } else inp.shoot = !!f.kHeld && (f.kCharge || 0) < 1 && dist < 30;   // keep a charge going around corners
  }

  // Super Saiyan Hair / Pentagram: hold block to charge when nobody has a shot at you.
  inp.block = false;
  if (p.smod === 'hair' || p.smod === 'ritual' || p.smod === 'grove' || p.smod === 'spaceking') {
    const threat = los && dist < 13, r = p.fx.ritual;
    let want;
    if (p.smod === 'hair') want = !threat && g.hairFrac(p) < 0.98 && p.onGround;
    else if (p.smod === 'spaceking') want = !threat && p.onGround && g.canHoldCharge(p);
    else {
      want = p.onGround && (!threat || (r && !r.deployed && r.draw > 0.55)) && (!r || g.inRitual(p, r)) &&
        (p.smod !== 'ritual' || p.hp > g.maxHp(p) * 0.3);   // Cursed Sacrifice costs health: don't bleed out charging it
      // a finished pentagram waiting for more charge: walk back to it when it's quiet
      if (r && r.deployed && r.level < 3 && !threat && !g.inRitual(p, r)) {
        const mx = r.x - p.pos.x, mz = r.z - p.pos.z, ml = Math.hypot(mx, mz) || 1;
        inp.mx = mx / ml * D.speed; inp.mz = mz / ml * D.speed; A.path = null;
      }
    }
    if (want && g.canHoldCharge(p)) { inp.block = true; inp.shoot = false; }
  }

  // Shield mods that do something useful outside of blocking a bullet: use them when there's a fight.
  if (p.smod && p.blockCdT <= 0 && los) {
    const want = p.smod === 'clone' ? dist < 18 && p.kind !== 'clone'   // clones only split when they block a bullet
      : p.smod === 'turret' ? dist < 18
      : p.smod === 'pillar' ? !(g.pillarFrac(p) > 0) && dist < 16
      : p.smod === 'slam' ? dist < 3.2 * (p.stats.blockSize || 1) && p.onGround : false;
    if (want && Math.random() < dt * 2.5) inp.blockSeq = (inp.blockSeq | 0) + 1;
  }
  if (p.blockCdT <= 0) {
    for (const b of g.bullets) {
      if (b.aiSeen[p.id] || (b.owner === p.id && !b.bounced)) continue;
      if (!g.canHurt(b.ownerRef, p)) continue;
      const rx = from.x - b.pos.x, ry = from.y - b.pos.y, rz = from.z - b.pos.z, d = Math.hypot(rx, ry, rz);
      const sp = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
      if (d < 1.2 + sp * 0.09 && rx * b.vel.x + ry * b.vel.y + rz * b.vel.z > 0) {
        b.aiSeen[p.id] = true;
        if (Math.random() < D.block) { inp.blockSeq = (inp.blockSeq | 0) + 1; break; }
      }
    }
  }
  if (g.level.side && !stationary && !p.flying && !inp.block) sideBotSteer(g, p, inp, t, D, A, A.want);
}
