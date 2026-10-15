// 2D side-view mode ("Side mode"): a lobby toggle (settings.side) for every mode except the open world.
// The normal sim runs locked to the z = 0 plane; this file holds the side-only pieces: the maps (ROUNDS /
// Stick Fight style: floating islands, death pits, string-hung swinging platforms, moving platforms, crates),
// spawns, the damaging arena edges (block against one to bounce off it), pits, swinging platforms and bot steering.
// No three.js here (runs in the sim). The renderer side lives in siderender.js.
import { RULES } from './config.js';
import { mulberry32, pickTheme } from './levelgen.js';
import { groundBelow, pointInSolid } from './physics.js';
import { brawlRecover } from './brawl.js';

export const SIDE = {
  bottom: -6,        // the bottom edge (y). Over a pit there is no edge: fall past it and you're out.
  depth: 3,          // every block is this deep (z), centered on the play plane
  plat: 0.6,         // floating platform thickness
  jumpMul: 1.3,      // jumps are higher in side view (about 2.9 m instead of 1.7 m), like ROUNDS
  pitKill: 2.5,      // meters below the bottom edge before a pit kills you
  edgeDmg: 0.16,     // edge damage: this share of max health (at least edgeMin)
  edgeMin: 14,
  edgeCd: 0.45,      // seconds between edge hits
  push: 9,           // edge push without blocking
  sideKick: 14,      // blocking against a side edge: sideways launch
  bounceMin: 12, bounceMax: 26,
  gravK: 1.5,        // 2D gravity multiplier: snappier, less floaty jumps (jump speed is raised to keep the same height)
  pad: 17.5,         // bounce pad launch speed (about 5.9 m up)   // blocking against the bottom edge: launch speed range (aimed at a platform above)
};
const G = () => RULES.gravity;
const jumpH = v => v * v / (2 * G());

// Arena half width / top edge for a player count. Team modes and co-op get extra width so the sides start far apart.
export function sideSize(n, spread) {
  n = Math.max(2, Math.min(RULES.maxPlayers || 20, n));
  // Bigger than before (they felt cramped) and growing with the player count.
  const hx = Math.round(Math.min(58, 26 + 2 * (n - 2) + (spread ? 6 : 0)));
  return { hx, top: Math.round(15 + (hx - 20) * 0.3) };
}

// Hand-made layouts on a 20 m half width (x is stretched to the real width; heights stay in meters so every
// jump keeps working). Right half only: everything with x != 0 is mirrored.
//   g: ground islands [x0, x1, top]      p: platforms [x, top, w]         b: blocks [x, y0, w, h]
//   hang: string-hung platforms [x, top, w, string]   mv: moving platforms [x, top, w, axis 'x'|'y', amp, period]
//   pit: death pits [x0, x1] (gaps between islands that are not listed are trenches with a damaging floor edge)
//   pad: bounce pads [x, surface top, w] (step on one and it launches you up)
//   crates / barrels: physics props dropped on the islands
const LAYOUTS = [
  { name: 'Twin Peaks', g: [[-6, 6, 0], [9.5, 20, 0]], pit: [[6, 9.5]], p: [[3, 2.6, 3], [13, 2.5, 4], [17, 5, 3], [8, 5.2, 3]], hang: [[0, 7.6, 5, 3.6]], crates: 2, barrels: 1 },
  { name: 'The Chasm', g: [[11, 20, 0]], pit: [[-11, 11]], p: [[14.5, 2.6, 3], [17.5, 5, 2.5]], hang: [[0, 1.5, 4.5, 6], [6, 3.4, 3, 4.4]], mv: [[0, 5.8, 3, 'x', 4.5, 7]], crates: 1, barrels: 1 },
  { name: 'Watchtower', g: [[-20, 20, 0]], pad: [[9, 0, 1.6]], b: [[0, 0, 3, 3.6]], p: [[6, 2.5, 4], [12, 4.9, 4], [3.5, 6.6, 4], [17, 2.4, 3]], mv: [[16, 1.4, 2.6, 'y', 2.2, 6]], crates: 3, barrels: 1 },
  { name: 'Islands', g: [[-3, 3, 0], [7, 11, 0.6], [15, 20, 0]], pit: [[3, 7]], p: [[5, 3, 3], [13, 3.4, 3], [0, 5.6, 4]], hang: [[9, 6.8, 4, 3.4]], crates: 2, barrels: 0 },
  { name: 'Swing Set', g: [[-4, 4, -1], [14, 20, 0]], pit: [[4, 14]], hang: [[7.2, 1.4, 3.5, 5], [11, 2.6, 3, 4], [3.5, 5, 3, 3]], p: [[17, 2.6, 3], [0, 3.6, 3]], crates: 1, barrels: 1 },
  { name: 'Pillars', g: [[2.2, 20, 0]], pit: [[-2.2, 2.2]], b: [[6, 0, 1.6, 4], [12, 0, 1.6, 2.4]], p: [[9, 4.4, 3], [0, 4, 5], [16, 3, 3], [4, 7, 3]], crates: 3, barrels: 1 },
  { name: 'Factory', g: [[-20, 20, 0]], pad: [[3, 0, 1.6]], b: [[5.5, 0, 2, 1.2], [15, 0, 3, 2.2]], p: [[10, 6, 4], [0, 7.2, 6], [18, 4.6, 2.4]], mv: [[0, 3, 3, 'x', 6, 8], [10, 0.6, 2.4, 'y', 3, 7]], crates: 3, barrels: 2 },
  { name: 'Sky Bridges', g: [[12.5, 20, 0]], pit: [[-12.5, 12.5]], p: [[6, 2, 3], [0, 3.4, 4], [9.5, 4.6, 3], [16, 3, 3]], hang: [[3.6, 7.6, 3, 2.8]], mv: [[0, 0.2, 3, 'x', 7, 9]], crates: 1, barrels: 0 },
  { name: 'Trenches', g: [[-2.5, 2.5, 0], [6.5, 12, 0], [16, 20, 0]], pad: [[18, 0, 1.6]], b: [[0, 0, 1.6, 1.6], [9, 0, 1.2, 2]], p: [[4.5, 3, 3], [14, 3, 3], [9, 5.4, 4]], hang: [[0, 6.4, 4, 3]], crates: 2, barrels: 1 },
  { name: 'Seesaw', g: [[-5, 5, 0], [15, 20, 1]], pit: [[5, 15]], hang: [[10, 2, 5, 6]], mv: [[10, 5.2, 2.6, 'y', 2, 6]], p: [[0, 3, 4], [17.5, 4, 3], [6, 5.6, 2.6]], crates: 2, barrels: 1 },
];

let sid = 0;
// Builds the level from a layout spec (x already in meters). Returns the usual level shape plus level.side.
function build(spec, hx, top, rng) {
  const boxes = [], dynamic = [], stands = [], pits = [];
  const D = SIDE.depth, B = SIDE.bottom;
  for (const [x0, x1, t] of spec.g) {
    boxes.push({ x: (x0 + x1) / 2, z: 0, w: x1 - x0, d: D, h: t - B, y0: B, ground: 1 });   // islands reach down to the bottom edge
    stands.push([x0, x1, t]);
  }
  for (const [x, t, w] of spec.p || []) { boxes.push({ x, z: 0, w, d: D, h: SIDE.plat, y0: t - SIDE.plat, plat: 1 }); stands.push([x - w / 2, x + w / 2, t]); }
  for (const [x, y0, w, h] of spec.b || []) {
    const under = stands.find(s => x >= s[0] && x <= s[1] && Math.abs(s[2] - y0) < 0.05);
    boxes.push({ x, z: 0, w, d: D, h, y0 });
    stands.push([x - w / 2, x + w / 2, y0 + h]);
    if (under) under.cut = (under.cut || []).concat([[x - w / 2, x + w / 2]]);
  }
  for (const [x, t, w, len] of spec.hang || []) {
    const amp = (rng() < 0.5 ? -1 : 1) * (0.12 + rng() * 0.18);
    dynamic.push({ id: 's' + (++sid), kind: 'swing', x, z: 0, y0: t - SIDE.plat, w, d: D, h: SIDE.plat, ax: x, ay: t + len, len, amp, mass: 14 });
  }
  for (const [x, t, w, axis, amp, period] of spec.mv || []) {
    dynamic.push({ id: 's' + (++sid), kind: 'slide', x, z: 0, y0: t - SIDE.plat, w, d: D, h: SIDE.plat, axis, amp, period, phase: x > 0 ? 0 : x < 0 ? Math.PI : rng() * 6.28 });
  }
  for (const pr of spec.pit || []) pits.push(pr);
  const pads = (spec.pad || []).map(([x, t, w]) => [x - w / 2, x + w / 2, t]);
  // physics props: crates and barrels on random island spots (mirrored), clear of blocks
  const spots = [];
  for (const s of stands) if (s[2] <= 1.2 && s[1] - s[0] > 3) spots.push(s);
  const drop = (kind, w, h, mass) => {
    for (let t = 0; t < 20 && spots.length; t++) {
      const s = spots[Math.floor(rng() * spots.length)], x = s[0] + 1 + rng() * (s[1] - s[0] - 2);
      if (Math.abs(x) < 1.2 || (s.cut || []).some(c => x > c[0] - 1 && x < c[1] + 1) || (spec.pad || []).some(([px, , pw]) => Math.abs(Math.abs(x) - Math.abs(px)) < pw / 2 + 1.2) || dynamic.some(o => (o.kind === 'crate' || o.kind === 'barrel') && Math.abs(Math.abs(o.x) - Math.abs(x)) < 1.6)) continue;
      for (const sx of [1, -1]) dynamic.push({ id: 's' + (++sid), kind, x: x * sx, z: 0, y0: s[2], w, d: w, h, mass });
      return;
    }
  };
  for (let i = 0; i < (spec.crates || 0); i++) drop('crate', 1.3, 1.5, 4);
  for (let i = 0; i < (spec.barrels || 0); i++) drop('barrel', 1.0, 1.7, 3);
  return { boxes, dynamic, side: { bottom: B, top, pits, pads, stands: stands.map(([a, b, c]) => [a, b, c]) } };
}

// Mirrors a right-half layout and stretches x to the half width.
function layoutSpec(L, hx) {
  // The middle (|x| <= 14) keeps its exact spacing so every gap stays jumpable; the outer part stretches.
  const k = (hx - 14) / 6, sx = v => Math.abs(v) <= 14 ? v : Math.sign(v) * (14 + (Math.abs(v) - 14) * k), out = { name: L.name, crates: L.crates, barrels: L.barrels };
  const mir = (arr, f) => { const r = []; for (const a of arr || []) { r.push(f(a, 1)); if (a[0] !== 0) r.push(f(a, -1)); } return r; };
  // ground islands / pits are ranges: mirror ranges that don't cross 0
  const ranges = arr => { const r = []; for (const [a, b, ...rest] of arr || []) { r.push([sx(a), sx(b), ...rest]); if (a >= 0) r.push([-sx(b), -sx(a), ...rest]); } return r; };
  out.g = ranges(L.g); out.pit = ranges(L.pit);
  out.p = mir(L.p, ([x, t, w], s) => [sx(x) * s, t, w]);
  out.b = mir(L.b, ([x, y0, w, h], s) => [sx(x) * s, y0, w, h]);
  out.pad = mir(L.pad, ([x, t, w], s) => [sx(x) * s, t, w]);
  out.hang = mir(L.hang, ([x, t, w, len], s) => [sx(x) * s, t, w, len]);
  out.mv = mir(L.mv, ([x, t, w, axis, amp, per], s) => [sx(x) * s, t, w, axis, amp, per]);
  return out;
}

// Random layout: islands separated by gaps (some pits, some trenches), platforms climbing in tiers
// (never more than one jump apart), a couple of hanging and moving platforms. Mirror-symmetric.
function randomSpec(rng, hx, top) {
  const props = rng() < 0.3 ? 0 : 1;   // some maps have no crates or barrels at all
  const R = (a, b) => a + rng() * (b - a), spec = { name: 'Generated', g: [], pit: [], p: [], b: [], hang: [], mv: [], crates: props * Math.floor(rng() * 4), barrels: props * Math.floor(rng() * 2) };
  // islands from the center outward (right half; mirrored below). Gaps between islands: pits or trenches.
  let x = 0; const half = [], gaps = [];
  if (rng() < 0.35) { x = R(1.8, 3.2); gaps.push([-x, x]); }
  else { const w = R(3, 7); half.push([0, w, 0]); x = w; }
  while (x < hx - 1) {
    const gap = R(2.8, 4.8), w = R(4, 9);
    if (x + gap + 2.5 > hx) break;
    half.push([x + gap, Math.min(hx + 1, x + gap + w), rng() < 0.3 ? R(-1, 1.2) : 0]);
    gaps.push([x, x + gap]);
    x += gap + w;
  }
  if (!half.length) { half.push([2.5, hx + 1, 0]); if (!gaps.length) gaps.push([-2.5, 2.5]); }
  half[half.length - 1][1] = hx + 1;   // the ends are always solid ground (spawns)
  for (const [a, b, t] of half) { if (a === 0) spec.g.push([-b, b, t]); else spec.g.push([a, b, t], [-b, -a, t]); }
  for (const [a, b] of gaps) {
    const pit = a < 0 || rng() < 0.6;   // a center gap is always a pit
    if (!pit) continue;
    if (a < 0) spec.pit.push([a, b]); else spec.pit.push([a, b], [-b, -a]);
  }
  // platforms in tiers over the right half
  for (const tier of [2.5, 4.9, 7.3, 9.6, 12, 14.4]) {
    if (tier > top - 3) break;
    const n = 1 + Math.floor(rng() * (hx > 30 ? 3 : 2));
    for (let i = 0; i < n; i++) {
      const w = R(2.6, 4.8), px = R(w / 2 + 0.6, hx - w / 2 - 1);
      if (spec.p.some(([qx, qt, qw]) => Math.abs(qt - tier) < 0.8 && Math.abs(qx - px) < (qw + w) / 2 + 3)) continue;   // roomier spacing
      spec.p.push([px, tier + R(-0.3, 0.3), w]);
      if (px - w / 2 < 0.4) spec.p[spec.p.length - 1][0] = 0;
    }
  }
  if (rng() < 0.6) { const w = R(3, 5); spec.p.push([0, R(3, 5.5), w]); }
  // over each pit: a hanging platform or a mover so it can be crossed
  for (const [a, b] of spec.pit) {
    if (a < 0 && b <= 0) continue;   // right-half pits only (mirrored later)
    const cx = Math.max(0, (a + b) / 2), w = Math.min(4, Math.max(2.4, (b - a) * 0.6));
    if (rng() < 0.55) spec.hang.push([cx, R(0.8, 2.2), w, R(3, 5.5)]);
    else spec.mv.push([cx, R(0.5, 2), w, rng() < 0.5 ? 'x' : 'y', rng() < 0.5 ? R(1, 2) : R(1.5, 2.5), R(6, 9)]);
  }
  // a pillar or two on ground
  if (rng() < 0.6) {
    const s = half[Math.floor(rng() * half.length)], w = R(1.2, 2);
    if (s[1] - s[0] > 4) spec.b.push([R(s[0] + 1.5, Math.min(s[1], hx) - 1.5), s[2], w, rng() < 0.5 ? 1.2 : R(2, 3.6)]);
  }
  // a bounce pad on an island under a high platform
  if (rng() < 0.5) { const s = half[half.length - 1]; spec.pad = [[Math.min(hx - 2, (s[0] + Math.min(s[1], hx)) / 2), s[2], 1.6]]; }
  // drop exact duplicates at x = 0 and mirror the rest
  const m = arr => { const r = []; for (const a of arr) { r.push(a); if (a[0] !== 0) r.push([-a[0], ...a.slice(1)]); } return r; };
  spec.p = m(spec.p); spec.b = m(spec.b); spec.hang = m(spec.hang); spec.mv = m(spec.mv); spec.pad = m(spec.pad || []);
  return spec;
}

// opts.spread: team mode / co-op (wider map so the sides start far apart). source: 'classic' | 'generated' | 'mixed' (others = mixed)
export function generateSideLevel(nPlayers, source, seed, themeSet, opts = {}) {
  const rng = mulberry32(seed ^ 0x5d1e);
  const { hx, top } = sideSize(nPlayers, opts.spread);
  const classic = source === 'classic' || (source !== 'generated' && rng() < 0.6);
  let spec, name;
  if (classic) {
    const L = LAYOUTS[Math.floor(rng() * LAYOUTS.length)];
    spec = layoutSpec(L, hx); name = L.name;
  } else {
    const s = randomSpec(rng, hx, top);
    spec = s; name = 'Generated';
  }
  const lv = build(spec, hx, top, rng);
  const theme = pickTheme(rng, themeSet);
  // No bottomless pits any more: the red edge runs right around the map (gaps are trenches you bounce out of).
  // Platforms are one-way: jump up through them, down + jump drops back through.
  for (const b of lv.boxes) if (b.plat) b.oneWay = 1;
  for (const d of lv.dynamic) if (d.kind === 'slide' || d.kind === 'swing') d.oneWay = 1;
  lv.side.pits = [];
  return { seed, name: name + ' (2D)', hx, hz: 2, lava: false, ice: false, theme, boxes: lv.boxes, dynamic: lv.dynamic, poly: null, shape: 'rect', side: lv.side, gravK: SIDE.gravK };
}

// Ground below which there is no floor (pits are open); physics.js uses level.hAt for the floor height.
export function sideFloor(level) { return () => -1e4; }

// Standable surfaces right now: static island / platform / block tops plus moving and hanging platform tops.
export function sideStands(g) {
  const L = g.level, out = L.side.stands.map(s => ({ x0: s[0], x1: s[1], y: s[2] }));
  for (const o of g.dyn || []) if (o.kind === 'slide' || o.kind === 'swing') out.push({ x0: o.pos.x - o.w / 2, x1: o.pos.x + o.w / 2, y: o.pos.y + o.h, dyn: o });
  return out;
}
export const inPit = (L, x) => L.side.pits.some(([a, b]) => x > a && x < b);

// Spawn points: groups spread across the map from left to right on solid ground (low surfaces first), so teams
// and the co-op squad / wave start at opposite ends with room to breathe.
export function sideSpawnPoints(level, groupSizes, opts = {}) {
  const S = level.side, hx = level.hx, n = groupSizes.length;
  const stands = S.stands.filter(s => s[1] - s[0] >= 1.6 && s[2] < 3.5).map(([a, b, y]) => ({ a: Math.max(a, -hx + 1), b: Math.min(b, hx - 1), y })).filter(s => s.b - s.a >= 1.2);
  const nearest = x => {   // closest standable spot to x
    let best = null, bd = Infinity;
    for (const s of stands) { const cx = Math.max(s.a + 0.6, Math.min(s.b - 0.6, x)), d = Math.abs(cx - x) + s.y * 0.3; if (d < bd) { bd = d; best = { x: cx, y: s.y, s }; } }
    return best || { x, y: 0, s: null };
  };
  return groupSizes.map((m, gi) => {
    // anchor: opposite ends for 2 groups (and co-op), evenly spread otherwise
    const ax = n === 1 ? 0 : -hx + 2.5 + gi * (2 * hx - 5) / (n - 1);
    const pts = [];
    for (let k = 0; k < m; k++) {
      const dir = ax > 0 ? -1 : 1, x = ax + dir * k * 1.3;
      const p = nearest(x);
      pts.push({ x: p.x, y: p.y, z: 0 });
    }
    return pts;
  });
}
// Reinforcement spots on one end of the map (sign -1 = left, 1 = right).
export function sideEdgeSpots(level, sign, n) {
  const pts = sideSpawnPoints(level, sign > 0 ? [1, n] : [n, 1]);
  return sign > 0 ? pts[1] : pts[0];
}

// The highest stand top above y that you could land on near x (for the block bounce). null when none within reach.
function standAbove(g, x, y) {
  let best = null;
  for (const s of sideStands(g)) {
    if (s.y <= y + 0.4 || s.y > y + 12) continue;
    const dx = x < s.x0 ? s.x0 - x : x > s.x1 ? x - s.x1 : 0;
    if (dx > 4) continue;
    if (!best || s.y < best.y || (s.y === best.y && dx < best.dx)) best = { ...s, dx };
  }
  return best;
}

// Edges and pits for one player (after it moved). Touching an edge hurts and pushes you back in; blocking as you
// touch it takes no damage and bounces you off: off the bottom edge high enough to land on a platform above.
export function sideRules(g, p, dt) {
  const L = g.level, S = L.side, r = RULES.playerRadius * (p.size || 1), tall = RULES.playerHeight * (p.size || 1);
  if (p.flying) { if (p.pos.y + tall > S.top) p.pos.y = S.top - tall; return; }
  // pits: fall far enough and you're out (the boss and portals get put back on solid ground)
  if (p.pos.y < S.bottom - SIDE.pitKill) {
    if (p.heavy || p.kind === 'boss' || p.kind === 'portal' || g.phase !== 'play' || (g.isPractice() && g.settings.practiceGod && !p.isBot)) {
      const sp = p.spawn || { x: 0, y: 0, z: 0 };
      p.pos = { x: sp.x, y: sp.y + 0.2, z: 0 }; p.vel = { x: 0, y: 0, z: 0 };
      return;
    }
    p.fx.invulnT = 0;
    const src = p.fx.lastSrc && g.time - (p.fx.lastSrcT || -99) < 6 ? p.fx.lastSrc : null;
    g.emit({ t: 'pit', p: p.id, x: p.pos.x, y: S.bottom, z: 0 });
    p.hp = Math.min(p.hp, 0.01); g.hurt(p, 1e6, src, null);
    if (p.alive) { const sp = p.spawn || { x: 0, y: 0, z: 0 }; p.pos = { x: sp.x, y: sp.y + 0.2, z: 0 }; p.vel = { x: 0, y: 0, z: 0 }; }
    return;
  }
  // bounce pads
  if (p.onGround && S.pads) for (const [a, b, y] of S.pads) if (p.pos.x > a - r * 0.5 && p.pos.x < b + r * 0.5 && Math.abs(p.pos.y - y) < 0.08) {
    p.vel.y = SIDE.pad * Math.sqrt(L.gravK || 1); p.onGround = false; g.emit({ t: 'pad', p: p.id, x: p.pos.x, y, z: 0 }); break;
  }
  let nx = 0, ny = 0;
  if (p.pos.y <= S.bottom && !inPit(L, p.pos.x)) { p.pos.y = S.bottom; ny = 1; }
  else if (p.pos.y + tall >= S.top) { p.pos.y = S.top - tall; ny = -1; }
  if (p.pos.x >= L.hx - r - 0.02) nx = -1; else if (p.pos.x <= -L.hx + r + 0.02) nx = 1;
  if (!nx && !ny) return;
  const blocking = p.blockT > 0 || g.shielded(p);
  // v1.0.8: hitting an edge again soon after (within 3 s) without blocking launches you like a block would (still hurts)
  const again = !blocking && (p.fx.edgeLast || -99) > g.time - 3 && (p.fx.edgeT || 0) < g.time;
  if (blocking || again) {
    if (again) {
      p.fx.edgeT = g.time + SIDE.edgeCd; p.fx.edgeLast = g.time;
      g.emit({ t: 'edgeHit', p: p.id, x: p.pos.x, y: p.pos.y + tall / 2, z: 0, nx, ny });
      g.hurt(p, Math.max(SIDE.edgeMin, g.maxHp(p) * SIDE.edgeDmg), p.fx.lastSrc && g.time - (p.fx.lastSrcT || -99) < 6 ? p.fx.lastSrc : null, null);
      if (!p.alive) return;
    }
    if (ny > 0) {
      const t = standAbove(g, p.pos.x, p.pos.y);
      const gk = Math.sqrt(L.gravK || 1), want = t ? Math.sqrt(2 * G() * (L.gravK || 1) * (t.y - p.pos.y + 1.2)) : (SIDE.bounceMin + 4) * gk;
      p.vel.y = Math.max(SIDE.bounceMin * gk, Math.min(SIDE.bounceMax * gk, want));
      if (t && t.dx > 0) p.vel.x = Math.max(-7, Math.min(7, ((t.x0 + t.x1) / 2 - p.pos.x) * 1.4));
    } else if (ny < 0) p.vel.y = -SIDE.push;
    if (nx) { p.vel.x = nx * SIDE.sideKick; p.vel.y = Math.max(p.vel.y, 7); }
    p.onGround = false;
    if (!again && (p.fx.edgeT || 0) < g.time) { p.fx.edgeT = g.time + 0.2; g.emit({ t: 'edgeBounce', p: p.id, x: p.pos.x, y: p.pos.y + tall / 2, z: 0, nx, ny }); }
    return;
  }
  // no block: pushed back in, and it hurts (once per edgeCd)
  if (ny > 0) p.vel.y = Math.max(p.vel.y, (SIDE.push + 1) * Math.sqrt(L.gravK || 1));
  if (ny < 0) p.vel.y = Math.min(p.vel.y, -SIDE.push * 0.5);
  if (nx) { p.vel.x = nx * SIDE.push; p.vel.y = Math.max(p.vel.y, 4); }
  p.onGround = false;
  if ((p.fx.edgeT || 0) < g.time) {
    p.fx.edgeT = g.time + SIDE.edgeCd; p.fx.edgeLast = g.time;
    const dmg = Math.max(SIDE.edgeMin, g.maxHp(p) * SIDE.edgeDmg);
    g.emit({ t: 'edgeHit', p: p.id, x: p.pos.x, y: p.pos.y + tall / 2, z: 0, nx, ny });
    g.hurt(p, dmg, p.fx.lastSrc && g.time - (p.fx.lastSrcT || -99) < 6 ? p.fx.lastSrc : null, null);
  }
}

// String-hung platform: a pendulum (the platform stays level). Bullets and blasts swing it (impulse).
export function swingStep(o, dt) {
  const d = o.def;
  if (o.th == null) { o.th = d.amp || 0; o.om = 0; }
  o.om += (-(G() / d.len) * Math.sin(o.th) - 0.06 * o.om) * dt;
  if (Math.abs(o.th) < 0.05 && Math.abs(o.om) < 0.05) o.om += (d.amp >= 0 ? 0.6 : -0.6) * dt * 4;   // never quite stops
  o.th = Math.max(-0.95, Math.min(0.95, o.th + o.om * dt));
  o.pos.x = d.ax + d.len * Math.sin(o.th);
  o.pos.y = d.ay - d.len * Math.cos(o.th) - o.h;
  o.pos.z = 0;
}
export function swingImpulse(o, J) { o.om = (o.om || 0) + J.x / (o.mass * o.def.len) * 1.5; }

// Bots in side view: walk toward (or keep distance from) the target along x, jump up to platforms it's on,
// jump gaps instead of walking into pits, hop over blocks, stay off the edges, and block-bounce off the bottom edge.
export function sideBotSteer(g, p, inp, t, D, A, want) {
  const L = g.level, S = L.side, jh = jumpH((p.stats.jump || 0) * SIDE.jumpMul), spd = D ? D.speed : 1;
  let dir = 0;
  if (t) {
    const dx = t.pos.x - p.pos.x, ad = Math.abs(dx);
    const w = want ?? 0;
    dir = ad > w + 1.2 ? Math.sign(dx) : ad < w - 1.5 ? -Math.sign(dx) : (A.sdir || 0);
    // target clearly above: go for a platform under it that we can reach
    if (t.pos.y > p.pos.y + 1.5 && p.onGround) {
      const up = sideStands(g).filter(s => s.y > p.pos.y + 0.5 && s.y <= p.pos.y + jh * (L.brawl ? 1.75 : 1) + 0.2).sort((a, b) => dist(a, p.pos.x) - dist(b, p.pos.x))[0];
      if (up) { const cx = (up.x0 + up.x1) / 2, ddx = cx - p.pos.x; dir = Math.abs(ddx) > 0.4 ? Math.sign(ddx) : dir; if (dist(up, p.pos.x) < 1.6) A.sJump = 0.25; }
    }
    // brawl: in the air on the way up to a target standing higher: drift over the surface it stands on (not away to keep range)
    if (L.brawl && !p.onGround && t.pos.y > p.pos.y + 0.8 && !(p.fx.launchT > g.time)) {
      const s = sideStands(g).find(q => t.pos.x > q.x0 - 0.3 && t.pos.x < q.x1 + 0.3 && Math.abs(q.y - t.pos.y) < 0.8);
      const cx = s ? Math.max(s.x0 + 0.6, Math.min(s.x1 - 0.6, t.pos.x)) : t.pos.x;
      dir = Math.abs(cx - p.pos.x) > 0.3 ? Math.sign(cx - p.pos.x) : 0;
    }
  }
  A.sdirT = (A.sdirT || 0) - (1 / 60);
  if (A.sdirT <= 0) { A.sdirT = 0.8 + Math.random(); A.sdir = Math.random() < 0.5 ? -1 : 1; }
  // target well below and we're on a one-way platform: drop through it
  inp.drop = false;
  if (t && p.onGround && p.groundOneWay && t.pos.y < p.pos.y - 1.5 && !L.brawl) inp.drop = true;
  // stay away from the side edges
  if (p.pos.x > L.hx - 2.2) dir = -1; else if (p.pos.x < -L.hx + 2.2) dir = 1;
  let jump = false;
  A.sJump = (A.sJump || 0) - (1 / 60);
  if (A.sJump > 0) jump = true;
  // brawl: still below the target near the top of a jump: tap the double jump (one-tick press so it doesn't start a dash charge)
  if (L.brawl && t && !p.onGround && p.vel.y < 1.5 && (p.fx.airJ || 0) > 0 && t.pos.y > p.pos.y + 1.2 && !(p.fx.launchT > g.time)) { A.bdj = !A.bdj; jump = A.bdj; }
  if (p.onGround && dir) {
    const r = RULES.playerRadius * (p.size || 1);
    // block or wall ahead: hop it
    if (pointInSolid(g.solids, p.pos.x + dir * (r + 0.5), p.pos.y + 0.5, 0, 0.1) || pointInSolid(g.solids, p.pos.x + dir * (r + 0.5), p.pos.y + 1.3, 0, 0.1)) jump = true;
    // a gap ahead: jump it if there's a landing within reach, otherwise don't walk off
    const ahead = p.pos.x + dir * (r + 0.6), gy = groundBelow(g.solids, ahead, 0, p.pos.y + 0.3);
    if (gy < p.pos.y - 3 || gy < S.bottom) {
      const land = sideStands(g).some(s => s.y <= p.pos.y + jh * 0.8 && s.y > S.bottom + 0.5 && (dir > 0 ? s.x0 > p.pos.x && s.x0 < p.pos.x + 6 : s.x1 < p.pos.x && s.x1 > p.pos.x - 6));
      if (land) jump = true; else if (inPit(L, ahead) || gy < S.bottom) dir = 0;
    }
  }
  // in the air over a pit: steer to the closest surface
  if (!p.onGround && inPit(L, p.pos.x) && p.vel.y < 0) {
    const s = sideStands(g).filter(q => q.y < p.pos.y + 0.5).sort((a, b) => dist(a, p.pos.x) - dist(b, p.pos.x))[0];
    if (s) dir = Math.sign(((s.x0 + s.x1) / 2) - p.pos.x) || dir;
  }
  // brawl: launched off the stage, head back and use the double jump
  if (L.brawl) { const rc = brawlRecover(g, p, inp, A, sideStands(g)); if (rc) { inp.mx = rc.dir * spd; inp.mz = 0; inp.jump = rc.jump && p.stats.jump > 0; return; } }
  // stuck: jump
  const moved = Math.abs(p.pos.x - (A.slx ?? p.pos.x)); A.slx = p.pos.x;
  if (dir && p.onGround && moved < 0.002) jump = true;
  // falling onto the bottom edge: block to bounce instead of taking the hit
  if (!p.onGround && p.vel.y < -2 && p.pos.y < S.bottom + 1.6 && !inPit(L, p.pos.x) && p.blockCdT <= 0) inp.blockSeq = (inp.blockSeq | 0) + 1;
  inp.mx = dir * spd; inp.mz = 0; inp.jump = jump && p.stats.jump > 0;
}
const dist = (s, x) => x < s.x0 ? s.x0 - x : x > s.x1 ? x - s.x1 : 0;
