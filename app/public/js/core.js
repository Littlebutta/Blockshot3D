// Core Defense mode (picked as its own lobby mode, played as co-op waves with settings.core).
// A flat, empty battlefield with the core block in the middle. Waves of enemies from the other modes walk in from
// the edges and go for the core; aggressive ones (and anyone who gets a hero or turret inside their hit zone) go
// for you first. Players can't block: the block button picks up and places blocks, cubes and turrets instead,
// which parachute in all over the map. Every few waves a golden upgrade falls: grabbing it gives everyone a card.
// Each wave starts with a build phase. Dead players respawn on a timer that grows with each death that wave.
// Sim only (no three.js).
import { DEFAULT_STATS } from './config.js';
import { pickTheme, mulberry32 } from './levelgen.js';
import { ENEMIES } from './amondata.js';

export const CORE = {
  half: 46,               // the battlefield is 92 x 92 m (v26: was 68)
  hp: 3000, heal: 0.25,   // core health; between waves it heals this share of its max
  size: 1.5,              // core block size (its hit size, like a unit's; v26: was 2.2)
  prep: 60,               // build phase before every wave (seconds)
  spawnMin: 34,           // enemies never appear closer than this to the core
  aggroR: 7,              // hit zone: a hero or turret this close pulls a non-aggressive enemy off the core
  aggressive: ['elite', 'critter', 'brute', 'drone'],   // these hunt players first, then the core
  bruteChance: 0.12,      // from wave 2: some raiders are swapped for a Cursed Sacrifice brute
  respawn: { base: 5, add: 5, max: 30 },   // seconds; +add for every extra death in the same wave
  drop: { every: [5, 10], y: 24, fall: 2.2, max: 44 },   // parachute drops: gap, start height, fall speed, cap on props
  kinds: ['block', 'cube', 'turret', 'upgrade', 'plank', 'slab', 'steel', 'spikes'],   // (indices go over the network)
  odds: { block: 0.3, cube: 0.22, plank: 0.12, slab: 0.1, steel: 0.06, spikes: 0.06, turret: 0.05 },   // v1.2.3: turrets on any wave, rarely
  block: { len: 2.4, th: 0.7, h: 1.6, hp: 450 },
  cube: { len: 1.2, th: 1.2, h: 1.2, hp: 260 },
  plank: { len: 3.6, th: 0.45, h: 0.9, hp: 300 },     // long, low wooden fence
  slab: { len: 2.4, th: 2.4, h: 0.5, hp: 380 },       // flat stone floor piece: a step to stand on or a roof
  steel: { len: 1.4, th: 1.4, h: 2.2, hp: 1000 },     // heavy pillar, rare
  spikes: { len: 2.4, th: 1.0, h: 0.5, hp: 240, dps: 30 },   // hurts enemies standing in or chewing on it
  fallG: 22,              // blocks with nothing under them fall (m/s^2); a hard landing chips them
  turret: { hp: 220, size: 0.8, shield: 70 },
  reach: 3.4,             // how close you need to be to pick something up (v1.2.23: was 2.6)
  place: 2.2,             // how far in front of you things are put down when there's no aim point
  placeMin: 1.2, placeMax: 5.5,   // (v1.2.23: was 1.4 - 4.2)   // v26: things go where you aim (the cursor / crosshair), kept this close
  snap: 0.3, snapAng: Math.PI / 4,   // v26: placement snaps to a 0.3 m grid and 45 degree turns (tidy walls)
  catchR: 4, catchY: 5.5,         // (v1.2.23: was 3.2 / 4.5)       // v26: grab a falling drop this close (sideways) and no higher than this above you
  meleeWall: 0.8,         // melee enemies chew through blocks they're pressed against (share of their melee per second)
  useLock: 0.35,          // v28: after putting something down, the use key can't pick anything up for this long
  stackMax: 6,          // v28: things can be put down this high above your feet (three blocks stack from the ground)
  turrets: true,          // v1.2.3 (Devin): turrets drop again, at random on any wave (odds.turret), no set turret waves
  amonFrom: 3, amonChance: r => Math.min(0.5, 0.05 * (r - 2)),   // v28: AMON enemies join the raids, more each wave
  nudge: 0.7,             // v1.2.23: a piece that would just clip the corner of another one slides off it (up to this far) instead of perching on it
  move: { hold: 0.6, reach: 3.2, slow: 0.6, ahead: 2.2, edge: 6 },   // v1.2.23 (Devin): hold the use key by the core to pick it up and carry it (slowed); press again to put it down
  flowCell: 1,            // v28: path grid size (m) that melee raiders walk around your builds with
};
// How many upgrades (a card for everyone) fall this wave. v1.2.3 (Devin: too rare): one on every wave from wave 2,
// a second on every 5th wave, and one more from wave 15 (was waves 3, 6, 8, 10... then every wave from 15).
export function coreUpgrades(r) {
  if (r < 2) return 0;
  return 1 + (r % 5 === 0 ? 1 : 0) + (r >= 15 ? 1 : 0);
}

export const corePos = g => (g.core && g.core.pos ? g.core.pos : g.corePos || { x: 0, z: 0 });
export function isCore(g) { return !!(g.settings && g.settings.core); }

export function generateCoreLevel(seed, themeSet) {
  const rng = mulberry32(seed), hx = CORE.half, hz = CORE.half, W = 3.5;
  const boxes = [
    { x: 0, z: -hz - 0.5, w: hx * 2 + 2, d: 1, h: W, ch: 40, y0: 0, wall: true },
    { x: 0, z: hz + 0.5, w: hx * 2 + 2, d: 1, h: 1.2, ch: 40, y0: 0, wall: true },
    { x: -hx - 0.5, z: 0, w: 1, d: hz * 2 + 2, h: W, ch: 40, y0: 0, wall: true },
    { x: hx + 0.5, z: 0, w: 1, d: hz * 2 + 2, h: W, ch: 40, y0: 0, wall: true },
  ];
  return { seed, name: 'Battlefield', hx, hz, lava: false, ice: false, theme: pickTheme(rng, themeSet), boxes, dynamic: [], poly: null, shape: 'rect', core: true };
}
// Heroes start around the core; enemies start on the edges, spread around the whole ring.
export function coreSpawnPoints(level, sizes, cp = { x: 0, z: 0 }) {
  return sizes.map((n, gi) => Array.from({ length: n }, (_, k) => {
    if (gi < sizes.length - 1 || sizes.length === 1) { const a = k * 2.4 + gi; return { x: cp.x + Math.cos(a) * 4, y: 0, z: cp.z + Math.sin(a) * 4 }; }
    return edgeSpot(level, Math.random() * Math.PI * 2);
  }));
}
// The edge of the field straight out from (ox, oz) at angle a.
function edgeSpot(L, a, ox = 0, oz = 0) {
  const r = L.hx - 2.5, c = Math.cos(a), s = Math.sin(a);
  const tx = c > 1e-6 ? (r - ox) / c : c < -1e-6 ? (-r - ox) / c : Infinity, tz = s > 1e-6 ? (r - oz) / s : s < -1e-6 ? (-r - oz) / s : Infinity, t = Math.max(0, Math.min(tx, tz));
  return { x: ox + c * t, y: 0, z: oz + s * t };
}
// Never closer than CORE.spawnMin to the core (wherever it was moved): pushed straight out to the edge, or when that
// edge is too close (the core sits by a wall) to the farthest edge spot nearby.
export function coreSpawnGuard(g, pt) {
  const c = corePos(g), d = Math.hypot(pt.x - c.x, pt.z - c.z);
  if (d >= CORE.spawnMin) return pt;
  const a0 = d > 0.1 ? Math.atan2(pt.z - c.z, pt.x - c.x) : Math.random() * Math.PI * 2;
  let best = null, bd = -1;
  for (let k = 0; k < 16; k++) {
    const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8, e = edgeSpot(g.level, a, c.x, c.z), ed = Math.hypot(e.x - c.x, e.z - c.z);
    if (ed >= CORE.spawnMin) return { ...e, y: pt.y || 0 };
    if (ed > bd) { bd = ed; best = e; }
  }
  return { ...best, y: pt.y || 0 };
}

// ---------------------------------------------------------------- the core
function spawnCore(g, hpFrac = 1) {
  const stats = { ...DEFAULT_STATS, health: CORE.hp, damage: 0, moveSpeed: 0, jump: 0, fireRate: 0.01, ammo: 1, blockCooldown: 99 };
  const cp = g.corePos || { x: 0, z: 0 };
  const c = g.spawnUnit('wave', null, { x: cp.x, y: 0, z: cp.z }, { stats, unitKind: 'core', name: 'Core', color: '#7fd8ff', difficulty: 'normal' });
  c.team = 0; c.fixedSize = CORE.size; c.size = CORE.size; c.heavy = true; c.noBlock = true; c.isBot = false; c.coreUnit = true;
  c.hp = Math.max(1, CORE.hp * hpFrac);
  g.core = c;
  return c;
}
export function coreTurret(g, x, z, hpFrac = 1, shieldFrac = 1, y0 = 0) {
  const T = CORE.turret;
  const stats = { ...DEFAULT_STATS, health: T.hp, damage: 14, projectiles: 1, spread: 0.08, fireRate: 2, ammo: 6, reloadTime: 1.5, bulletSpeed: 30,
    moveSpeed: 0, jump: 0, blockCooldown: 99, blockSize: 1.1 };
  const spot = y0 > 0.05 ? { x, y: y0, z } : g.freeSpot(x, z, 0, 0, 0.5, 0);   // v26: y0 = on top of a block
  const u = g.spawnUnit('wave', null, spot, { stats, unitKind: 'blockTurret', name: 'Turret', color: '#cfd6e4', difficulty: 'hard' });
  u.team = 0; u.fixedSize = T.size; u.noBlock = true; u.coreProp = 'turret';
  u.hp = Math.max(1, T.hp * hpFrac);
  // the same small block bubble the Turret shield mod gives its turret (recharges after it breaks)
  u.fx.tshield = { hp: Math.round(T.shield * shieldFrac), max: T.shield, brokenT: 0, lastHit: 0 };
  return u;
}
function coreWall(g, kind, x, z, ang, hpFrac = 1, y0 = null) {
  const D = CORE[kind], hp = D.hp;
  const b = { id: g.nextId++, kind, owner: g.core.id, ownerRef: g.core, x, z, y0: 0, len: D.len, th: D.th, h: D.h, ang, hp: hp * hpFrac, maxHp: hp, coreProp: kind };
  b.y0 = y0 ?? g.wallSupport(b, 6, null, 6);
  b.solids = g.wallSegments(b);
  g.barricades.push(b); g.refreshSolids();
  return b;
}

// ---------------------------------------------------------------- rounds
// Everything the players built (and what's still falling) is kept from wave to wave, and remembered at the
// start of each wave so a retry puts it back the way it was.
export function coreCapture(g) {
  const c = g.core;
  return {
    hp: c && c.alive ? c.hp / CORE.hp : (g.coreSaved ? g.coreSaved.hp : 1),
    cx: c ? c.pos.x : (g.corePos || { x: 0 }).x, cz: c ? c.pos.z : (g.corePos || { z: 0 }).z,
    walls: g.barricades.filter(b => b.coreProp).map(b => ({ kind: b.kind, x: b.x, z: b.z, ang: b.ang, y0: b.y0, hp: b.hp / b.maxHp })),
    turrets: g.players.filter(u => u.coreProp === 'turret' && u.alive).map(u => ({ x: u.pos.x, z: u.pos.z, y: u.pos.y, hp: u.hp / u.stats.health, sh: u.fx.tshield ? u.fx.tshield.hp / u.fx.tshield.max : 1 })),
    drops: (g.coreDrops || []).map(d => ({ ...d })),
    carry: g.heroes().filter(p => p.carry && p.carry.kind !== 'core').map(p => [p.id, { ...p.carry }]),
  };
}
export function coreStart(g, keep, noHeal) {
  const heal = noHeal ? 0 : CORE.heal;
  g.corePos = keep && keep.cx != null ? { x: keep.cx, z: keep.cz } : g.corePos || { x: 0, z: 0 };
  for (const p of g.heroes()) if (p.carry && p.carry.kind === 'core') p.carry = null;
  spawnCore(g, Math.min(1, (keep ? keep.hp : 1) + heal));
  g.coreDrops = [];
  if (keep) {
    for (const w of keep.walls.slice().sort((a, b) => a.y0 - b.y0)) coreWall(g, w.kind, w.x, w.z, w.ang, w.hp, w.y0);
    for (const t of keep.turrets) coreTurret(g, t.x, t.z, t.hp, t.sh, t.y || 0);
    g.coreDrops = keep.drops.map(d => ({ ...d, id: g.nextId++ }));
    for (const [id, c] of keep.carry) { const p = g.player(id); if (p) p.carry = c; }
  }
  // v1.0.1: the sim clock restarts every wave, so the put-down lock from last wave must go (it blocked pickups for minutes)
  for (const p of g.heroes()) { p.coreDeaths = 0; p.coreRespT = null; p.coreUseT = 0; p.lastUseSeq = p.input.useSeq | 0; if (!keep) p.carry = null; else if (p.carry) p.carry.armed = false; }
  g.coreDropT = 2;
  const retry = !!(keep && noHeal), ups = retry ? 0 : coreUpgrades(g.round);   // (a retry gets back the drops it started with)
  for (let k = 0; k < ups; k++) {   // this wave's upgrades, somewhere between the core and the edge
    const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 14, cp = g.corePos, q = g.clampArena(cp.x + Math.cos(a) * r, cp.z + Math.sin(a) * r, 3);
    g.coreDrops.push({ id: g.nextId++, kind: 'upgrade', x: q.x, z: q.z, y: CORE.drop.y + k * 4, landed: false });
  }
  for (const p of g.heroes()) p.coreReady = false;
  g.coreSaved = coreCapture(g);   // for "Retry wave"
  g.emit({ t: 'coreWave', n: g.round, prep: CORE.prep, upgrade: retry ? keep.drops.filter(d => d.kind === 'upgrade').length : ups, twist: g.coreTwist || null });
}

// ---------------------------------------------------------------- every tick (build phase and fight)
export function coreTick(g, dt) {
  const L = g.level;
  // parachute drops: a new one every few seconds while there's room, anywhere on the map
  const props = g.barricades.filter(b => b.coreProp).length + g.players.filter(u => u.coreProp && u.alive).length + g.coreDrops.length;
  if ((g.coreDropT -= dt) <= 0) {
    const [a, b] = CORE.drop.every; g.coreDropT = a + Math.random() * (b - a);
    if (props < CORE.drop.max) {
      const odds = Object.entries(CORE.odds).filter(([k]) => k !== 'turret' || CORE.turrets), tot = odds.reduce((a, [, w]) => a + w, 0);
      let r = Math.random() * tot, kind = odds[0][0];
      for (const [k, w] of odds) { if (r < w) { kind = k; break; } r -= w; }
      let x = 0, z = 0;
      const cp = corePos(g);
      for (let k = 0; k < 8; k++) { x = (Math.random() * 2 - 1) * (L.hx - 3); z = (Math.random() * 2 - 1) * (L.hz - 3); if (Math.hypot(x - cp.x, z - cp.z) > 4) break; }
      g.coreDrops.push({ id: g.nextId++, kind, x, z, y: CORE.drop.y, landed: false });
    }
  }
  for (const d of g.coreDrops) {
    if (d.landed) continue;
    d.y -= CORE.drop.fall * dt;
    const floor = d.kind === 'upgrade' ? propSupport(g, { x: d.x, z: d.z, ang: 0, len: 0.8, th: 0.8 }, d.y + 0.5) : 0;   // v1.0.1: an upgrade rests on top of a block
    if (d.y > floor) continue;
    d.y = floor; d.landed = true;
    if (d.kind === 'upgrade') continue;   // stays where it fell until someone grabs it
    d.done = true;
    if (d.kind === 'turret') coreTurret(g, d.x, d.z);
    else coreWall(g, d.kind, d.x, d.z, Math.random() * Math.PI);
    g.emit({ t: 'coreLand', kind: d.kind, x: d.x, z: d.z });
  }
  // the upgrade: whoever touches it gets everyone a card (picked after this wave)
  for (const d of g.coreDrops) {
    if (d.kind !== 'upgrade' || !d.landed || d.done) continue;
    const p = g.heroes().find(q => q.alive && !q.reviving && Math.hypot(q.pos.x - d.x, q.pos.z - d.z) < 1.6 && Math.abs(q.pos.y - (d.y || 0)) < 2);
    if (!p) continue;
    d.done = true;
    for (const q of g.heroes()) if (q.connected) q.picksOwed = (q.picksOwed || 0) + 1;
    g.emit({ t: 'coreUpgrade', p: p.id, x: d.x, z: d.z });
  }
  g.coreDrops = g.coreDrops.filter(d => !d.done);
  // gravity: a block with nothing under it falls (stacks come down when what holds them is taken or broken)
  for (const b of g.barricades.slice().sort((a, c) => a.y0 - c.y0)) {
    if (!b.coreProp) continue;
    const sup = propSupport(g, b, b.y0 + 0.05, b);   // v28: the whole footprint counts (crossed and offset stacks hold)
    if (sup >= b.y0 - 0.005) { if (b.vy > 9) g.damageBarricade(b, (b.vy - 9) * 18); b.vy = 0; continue; }
    b.vy = (b.vy || 0) + CORE.fallG * dt;
    b.y0 = Math.max(sup, b.y0 - b.vy * dt); b.solids = g.wallSegments(b); g.refreshSolids();
  }
  // melee enemies pressed against a block chew through it; spikes hurt whoever stands in them
  for (const u of g.players) {
    if (!u.alive || u.team !== 1 || g.phase !== 'play') continue;
    const R = 0.42 * (u.size || 1) + 0.35;
    let chewed = !u.melee, spiked = false;
    for (const b of g.barricades) {
      if (!b.coreProp) continue;
      const ux = Math.cos(b.ang), uz = Math.sin(b.ang), dx = u.pos.x - b.x, dz = u.pos.z - b.z;
      const along = Math.abs(dx * ux + dz * uz) - b.len / 2, side = Math.abs(-dx * uz + dz * ux) - b.th / 2;
      if (!(along < R && side < R && u.pos.y < b.y0 + b.h + 0.2 && u.pos.y > b.y0 - 2)) continue;
      if (!chewed) { g.damageBarricade(b, u.melee * CORE.meleeWall * dt); chewed = true; }
      if (b.kind === 'spikes' && !spiked && !u.flying) { spiked = true; g.hurt(u, CORE.spikes.dps * dt, g.core, null); }
    }
  }
  coreCarryTick(g);
  // respawns: the timer grows with every death this wave
  for (const p of g.heroes()) {
    if (!p.connected || p.alive || p.reviving) continue;
    if (p.coreRespT == null) {
      p.coreDeaths = (p.coreDeaths || 0) + 1;
      const R = CORE.respawn;
      p.coreRespT = Math.min(R.max, R.base + R.add * (p.coreDeaths - 1));
      coreDropCarry(g, p);
      g.emit({ t: 'coreRespawnIn', p: p.id, s: Math.round(p.coreRespT) });
      continue;
    }
    if ((p.coreRespT -= dt) > 0) continue;
    p.coreRespT = null;
    const a = Math.random() * Math.PI * 2, cp = corePos(g), spot = g.freeSpot(cp.x + Math.cos(a) * 4, cp.z + Math.sin(a) * 4, cp.x, cp.z, 0.6, 0);
    g.resetPlayer(p, spot);
    g.emit({ t: 'respawn', p: p.id, x: spot.x, y: spot.y, z: spot.z });
  }
}

// v1.0.1: a cleared wave hands out any upgrade still lying on the field (or falling), so a squad that died a
// lot (or never got to it) doesn't lose its card pick.
export function coreAwardLeftovers(g) {
  const ups = (g.coreDrops || []).filter(d => d.kind === 'upgrade' && !d.done);
  if (!ups.length) return 0;
  for (const d of ups) d.done = true;
  g.coreDrops = g.coreDrops.filter(d => !d.done);
  for (const q of g.heroes()) if (q.connected) q.picksOwed = (q.picksOwed || 0) + ups.length;
  g.emit({ t: 'coreUpgrade', p: null, n: ups.length, x: ups[0].x, z: ups[0].z });
  return ups.length;
}
// v1.0.1: dying drops what you carry (it falls where you were instead of vanishing).
export function coreDropCarry(g, p) {
  const c = p.carry; if (!c) return;
  p.carry = null;
  if (c.kind === 'core') { coreSet(g, g.core); g.emit({ t: 'coreMoved', p: p.id }); return; }
  g.coreDrops.push({ id: g.nextId++, kind: c.kind, x: p.pos.x, z: p.pos.z, y: Math.max(0.6, p.pos.y + 1), landed: false });
}

// Who an enemy goes after. Aggressive kinds: the nearest hero, else the core. Everyone else: whatever's in their
// hit zone (a hero, a turret or the core), else the core. Bosses and turrets of their own keep normal targeting.
export function coreTarget(g, p) {
  const c = g.core && g.core.alive ? g.core : null;
  const near = (list, R) => {
    let best = null, bd = R;
    for (const q of list) { const d = Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z); if (d < bd) { bd = d; best = q; } }
    return best;
  };
  const heroes = g.players.filter(q => q.kind === 'hero' && q.alive && !q.reviving);
  if (p.hulk) return c || near(heroes, Infinity);   // v1.2.3: Sky Hulks only care about the core
  if (CORE.aggressive.includes(p.kind)) return near(heroes, Infinity) || c;
  const zone = g.players.filter(q => q.alive && !q.reviving && (q.kind === 'hero' || q.coreProp === 'turret'));
  return near(zone, CORE.aggroR + 0.5 * (p.size || 1)) || c || near(heroes, Infinity);
}

// ---------------------------------------------------------------- footprints (v28)
// Props are rectangles on the ground (center, long-axis angle, length, thickness). Stacking and gravity look at
// the whole footprint, so a block put down across or half over another one rests on it instead of sinking in.
// v1.2.6: a separating-axis test on the two rectangles' own axes (center distance against the summed half-widths) instead
// of projecting corner lists: the same answers, and nothing allocated (it runs for every stacked prop every tick).
function rectsOverlap(a, b, pad = -0.04) {
  const ahl = (a.len + pad * 2) / 2, aht = (a.th + pad * 2) / 2, bhl = (b.len + pad * 2) / 2, bht = (b.th + pad * 2) / 2, dx = b.x - a.x, dz = b.z - a.z;
  const aux = Math.cos(a.ang), auz = Math.sin(a.ang), bux = Math.cos(b.ang), buz = Math.sin(b.ang);
  for (let k = 0; k < 4; k++) {
    const ax = k === 0 ? aux : k === 1 ? -auz : k === 2 ? bux : -buz, az = k === 0 ? auz : k === 1 ? aux : k === 2 ? buz : bux;
    const ra = ahl * Math.abs(aux * ax + auz * az) + aht * Math.abs(auz * ax - aux * az), rb = bhl * Math.abs(bux * ax + buz * az) + bht * Math.abs(buz * ax - bux * az);
    if (Math.abs(dx * ax + dz * az) >= ra + rb) return false;
  }
  return true;
}
// Top of the highest prop (or wall) under this footprint, ignoring anything whose top is above `lim`.
export function propSupport(g, r, lim, skip) {
  let top = 0;
  for (const b of g.barricades) {
    if (b === skip) continue;
    const t = b.y0 + b.h;
    if (t > lim + 1e-6 || t <= top) continue;
    if (Math.hypot(b.x - r.x, b.z - r.z) > (Math.hypot(b.len, b.th) + Math.hypot(r.len, r.th)) / 2) continue;   // v1.2.6: their outer circles don't touch
    if (rectsOverlap(r, b)) top = t;
  }
  for (const u of g.players) {   // turrets standing on blocks hold up nothing, but a block can't sink into one either
    if (u.coreProp !== 'turret' || !u.alive || u === skip) continue;
    const t = u.pos.y + 0.9;
    if (t > lim + 1e-6 || t <= top) continue;
    if (rectsOverlap(r, { x: u.pos.x, z: u.pos.z, ang: 0, len: 0.9, th: 0.9 })) top = t;
  }
  return top;
}

// ---------------------------------------------------------------- carrying (the use key)
// v28: tap the use key to pick something up (or catch it as it falls). While carrying, a hologram shows where it
// will go; hold the use key to aim it (the hologram lights up) and let go to put it down. You can't pick anything
// else up until what you carry is down, and for a moment after putting it down.
export function coreUse(g, p) {
  if (!p.alive || p.reviving || p.hp <= 0 || (g.phase !== 'play' && g.phase !== 'countdown')) return;   // v1.0.1: the dead (and the pick screen) can't build
  if (p.carry) return corePlace(g, p);
  if ((p.coreUseT || 0) > g.time) return;
  let drop = null, dd = CORE.catchR;
  for (const d of g.coreDrops || []) {
    if (d.landed || d.done || d.kind === 'upgrade') continue;
    const h = Math.hypot(d.x - p.pos.x, d.z - p.pos.z);
    if (h < dd && d.y < p.pos.y + CORE.catchY) { dd = h; drop = d; }
  }
  if (drop) {
    drop.done = true; g.coreDrops = g.coreDrops.filter(d => d !== drop);
    p.carry = { kind: drop.kind, hp: 1, sh: 1 };
    g.emit({ t: 'corePick', p: p.id, kind: drop.kind, caught: 1 });
    return;
  }
  // the nearest thing within reach; in a stack, the top piece you can reach comes off first
  let best = null, bs = Infinity;
  for (const b of g.barricades) {
    if (!b.coreProp || b.y0 > p.pos.y + 2.6 || b.y0 + b.h < p.pos.y - 2.2) continue;
    const d = Math.hypot(b.x - p.pos.x, b.z - p.pos.z); if (d > CORE.reach) continue;
    const above = g.barricades.some(q => q !== b && q.coreProp && q.y0 >= b.y0 + b.h - 0.05 && q.y0 <= p.pos.y + 2.6 && rectsOverlap(q, b));
    const sc = d - b.y0 * 0.6 + (above ? 3 : 0); if (sc < bs) { bs = sc; best = b; }
  }
  for (const u of g.players) {
    if (u.coreProp !== 'turret' || !u.alive) continue;
    const d = Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z); if (d > CORE.reach) continue;
    const sc = d - u.pos.y * 0.6 - 0.3; if (sc < bs) { bs = sc; best = u; }
  }
  if (!best) { g.emit({ t: 'coreNothing', p: p.id }); return; }
  if (best.coreProp === 'turret') {
    p.carry = { kind: 'turret', hp: best.hp / best.stats.health, sh: best.fx.tshield ? best.fx.tshield.hp / best.fx.tshield.max : 1 };
    g.unitsRemoved(); best.alive = false; best.hp = 0; g.players = g.players.filter(u => u !== best);
    g.unitsChanged();
  } else {
    p.carry = { kind: best.kind, hp: best.hp / best.maxHp };
    g.barricades = g.barricades.filter(b => b !== best); g.refreshSolids(); g.settleWalls();
  }
  g.emit({ t: 'corePick', p: p.id, kind: p.carry.kind });
}
// v1.2.23 moving the core. A use press right by the core waits: let go quickly and it's a normal pick up (coreUse),
// hold it CORE.move.hold seconds and you lift the core instead. While carried the core floats ahead of you and you're slowed.
export function coreUseInput(g, p, pressed, held, dt) {
  const M = CORE.move, c = g.core;
  if (pressed) {
    if (p.carry) { p.carry.armed = true; return; }
    const near = c && c.alive && Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z) < M.reach && (g.phase === 'play' || g.phase === 'countdown');
    if (near && p.alive && !g.heroes().some(q => q !== p && q.carry && q.carry.kind === 'core')) { p.coreHold = { t: 0 }; return; }
    coreUse(g, p); return;
  }
  if (p.coreHold) {
    if (!held || !p.alive) { p.coreHold = null; coreUse(g, p); return; }   // a quick tap: pick up a block as usual
    p.coreHold.t += dt;
    if (p.coreHold.t >= M.hold) { p.coreHold = null; p.carry = { kind: 'core', hp: 1 }; p.coreUseT = g.time + CORE.useLock; g.emit({ t: 'corePick', p: p.id, kind: 'core' }); }
    return;
  }
  if (p.carry && p.carry.armed && !held) { if (g.phase === 'play' || g.phase === 'countdown') corePlace(g, p); else p.carry.armed = false; }
}
function coreCarrySpot(g, p) {
  const M = CORE.move, ax = p.aim.x, az = p.aim.z, l = Math.hypot(ax, az) || 1, r = M.ahead + 0.5 * (p.size || 1);
  return g.clampArena(p.pos.x + ax / l * r, p.pos.z + az / l * r, M.edge);
}
function coreCarryTick(g) {
  const c = g.core;
  for (const p of g.heroes()) {
    if (!p.carry || p.carry.kind !== 'core') continue;
    if (!c || !c.alive || !p.alive) { p.carry = null; continue; }
    const q = coreCarrySpot(g, p);
    c.pos.x = q.x; c.pos.z = q.z; c.pos.y = Math.max(0, p.pos.y) + 0.6; c.vel.x = c.vel.y = c.vel.z = 0;
  }
}
// Sets the core down on the ground where it is (never inside a wall), and remembers the spot for the next waves.
function coreSet(g, c) {
  if (!c) return;
  const q = g.clampArena(c.pos.x, c.pos.z, CORE.move.edge), spot = g.freeSpot(q.x, q.z, 0, 0, 0.5 * CORE.size + 0.3, 0);
  c.pos.x = spot.x; c.pos.z = spot.z; c.pos.y = 0; c.vel.x = c.vel.y = c.vel.z = 0;
  g.corePos = { x: c.pos.x, z: c.pos.z }; g.coreFlow = null;
}
export const coreCarrySlow = p => (p.carry && p.carry.kind === 'core' ? CORE.move.slow : 1);
// Where the carried thing would go (the hologram shows this). It goes where you aim, within reach, snapped to a
// small grid and 45 degree turns. v28: aim at a prop and it lines up on top of it (same spot and turn), so
// towers of three or four blocks go up straight; otherwise it rests on whatever its footprint touches.
export function corePlan(g, p) {
  const c = p.carry; if (!c || c.kind === 'core') return null;
  const ax = p.aim.x, az = p.aim.z, l = Math.hypot(ax, az) || 1, fx = ax / l, fz = az / l, ap = p.aimPoint;
  let dist = CORE.place;
  const aimOk = ap && isFinite(ap.x);
  if (aimOk) dist = Math.min(CORE.placeMax, Math.max(CORE.placeMin, Math.hypot(ap.x - p.pos.x, ap.z - p.pos.z)));
  const S = CORE.snap, turret = c.kind === 'turret';
  let { x, z } = g.clampArena(Math.round((p.pos.x + fx * dist) / S) * S, Math.round((p.pos.z + fz * dist) / S) * S, 0.8);
  let ang = turret ? 0 : Math.round(Math.atan2(-fx, fz) / CORE.snapAng) * CORE.snapAng;
  const turn = ((p.input.rot | 0) % 8) * CORE.snapAng;   // v1.0.1: the scroll wheel turns what you carry in 45 degree steps
  const D = turret ? { len: 0.9, th: 0.9 } : CORE[c.kind], lim = p.pos.y + CORE.stackMax;
  // the prop under the aim point (the top of a stack): line up with it
  const probe = aimOk && Math.hypot(ap.x - p.pos.x, ap.z - p.pos.z) <= CORE.placeMax + 0.6 ? { x: ap.x, z: ap.z } : { x, z };
  let on = null;
  for (const b of g.barricades) {
    if (!b.coreProp || b.y0 + b.h > lim) continue;
    const ux = Math.cos(b.ang), uz = Math.sin(b.ang), dx = probe.x - b.x, dz = probe.z - b.z;
    if (Math.abs(dx * ux + dz * uz) > b.len / 2 + 0.35 || Math.abs(-dx * uz + dz * ux) > b.th / 2 + 0.35) continue;
    if (!on || b.y0 > on.y0) on = b;
  }
  if (on && Math.hypot(on.x - p.pos.x, on.z - p.pos.z) <= CORE.placeMax + 1.2) { x = on.x; z = on.z; if (!turret && CORE[c.kind].th < CORE[c.kind].len) ang = on.ang; }
  if (!turret) ang += turn;
  const cp = corePos(g), cd = Math.hypot(x - cp.x, z - cp.z), keep = CORE.size * 0.5 + 1.2;   // never on top of the core
  if (cd < keep) { const k = keep / (cd || 1); x = cp.x + (cd ? x - cp.x : 1) * k; z = cp.z + (cd ? z - cp.z : 0) * k; }
  if (g.mountNudge) ({ x, z } = g.mountNudge(x, z, D.len / 2, D.th / 2, ang));   // v1.2.8: never onto a Gun Nest turret
  let y0 = propSupport(g, { x, z, ang, len: D.len, th: D.th }, lim);
  // v1.2.23: not aimed at a prop but just clipping one: slide off it (a short way) and sit on the ground instead of perching
  if (!on && y0 > 0.05) {
    let bestN = null, bn = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8, r = CORE.nudge * (k < 8 ? 0.5 : 1), nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
      if (propSupport(g, { x: nx, z: nz, ang, len: D.len, th: D.th }, lim) <= 0.05 && r < bn) { bn = r; bestN = { x: nx, z: nz }; }
    }
    if (bestN) { x = bestN.x; z = bestN.z; y0 = 0; }
  }
  return { x, z, y0, ang };
}
export function corePlace(g, p) {
  if (p.carry && p.carry.kind === 'core') { p.carry = null; p.coreUseT = g.time + CORE.useLock; coreSet(g, g.core); g.emit({ t: 'coreMoved', p: p.id }); return; }
  const c = p.carry, pl = corePlan(g, p);
  if (!pl || !p.alive || p.reviving || p.hp <= 0) return;
  const { x, z } = pl;
  if (c.kind === 'turret') coreTurret(g, x, z, c.hp, c.sh == null ? 1 : c.sh, pl.y0);
  else coreWall(g, c.kind, x, z, pl.ang, c.hp, pl.y0);
  p.carry = null; p.coreUseT = g.time + CORE.useLock;
  g.emit({ t: 'corePlace', p: p.id, kind: c.kind, x, z });
  if (c.kind === 'turret') g.unitsChanged();
}

// ---------------------------------------------------------------- melee raiders walk around your builds (v28)
// A cost grid over the field: open ground costs 1 per cell, a cell under a prop costs what it takes to chew through
// it. Dijkstra from the core gives every cell its cost-to-core, so melee raiders walk downhill: around walls when
// there is a way round, and into the weakest wall (chewing through it) when you've closed them off completely.
function buildFlow(g) {
  const C = CORE.flowCell, H = g.level.hx, n = Math.ceil(H * 2 / C), cost = new Float32Array(n * n).fill(1);
  const cellOf = v => Math.max(0, Math.min(n - 1, Math.floor((v + H) / C)));
  for (const b of g.barricades) {
    if (b.y0 > 1.2) continue;   // only what stands on the ground blocks the way (stacks add the pieces above)
    let hp = b.hp;
    for (const q of g.barricades) if (q !== b && q.y0 > b.y0 && q.y0 < 6 && Math.hypot(q.x - b.x, q.z - b.z) < 1.2) hp += q.hp * 0.5;
    const chew = 2 + hp / 25;   // ~seconds to chew through, in cell-steps
    const R = Math.max(b.len, b.th) / 2 + 0.6, ux = Math.cos(b.ang), uz = Math.sin(b.ang);
    for (let i = cellOf(b.x - R); i <= cellOf(b.x + R); i++) for (let j = cellOf(b.z - R); j <= cellOf(b.z + R); j++) {
      const cx = -H + (i + 0.5) * C, cz = -H + (j + 0.5) * C, dx = cx - b.x, dz = cz - b.z;
      if (Math.abs(dx * ux + dz * uz) > b.len / 2 + 0.45 || Math.abs(-dx * uz + dz * ux) > b.th / 2 + 0.45) continue;
      cost[i * n + j] = Math.max(cost[i * n + j], chew);
    }
  }
  // v1.0.1: typed-array binary heap and no per-step allocations (the old version could stall the host for
  // a quarter of a second on a rebuild, which peers saw as packet loss)
  const N = n * n, dist = new Float32Array(N).fill(Infinity), hk = new Float32Array(N * 8 + 16), hv = new Int32Array(N * 8 + 16);
  let hn = 0;
  const push = (k, d) => {
    let i = hn++;
    while (i > 0) { const pa = (i - 1) >> 1; if (hk[pa] <= d) break; hk[i] = hk[pa]; hv[i] = hv[pa]; i = pa; }
    hk[i] = d; hv[i] = k;
  };
  const popTo = out => {   // out[0] = dist, out[1] = cell
    out[0] = hk[0]; out[1] = hv[0];
    const lk = hk[--hn], lv = hv[hn];
    let i = 0;
    for (;;) {
      const l = 2 * i + 1; if (l >= hn) break;
      const r = l + 1, m = r < hn && hk[r] < hk[l] ? r : l;
      if (hk[m] >= lk) break;
      hk[i] = hk[m]; hv[i] = hv[m]; i = m;
    }
    hk[i] = lk; hv[i] = lv;
  };
  const cp = corePos(g), ci = cellOf(cp.x), cj = cellOf(cp.z);
  for (const di of [-1, 0, 1]) for (const dj of [-1, 0, 1]) { const a = ci + di, b = cj + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue; const k = a * n + b; dist[k] = 0; push(k, 0); }
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1], DW = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414], top = [0, 0];
  while (hn > 0 && hn < hk.length - 8) {
    popTo(top); const d = top[0], k = top[1]; if (d > dist[k]) continue;
    const i = (k / n) | 0, j = k - i * n, ck = cost[k];
    for (let q = 0; q < 8; q++) {
      const a = i + DI[q], b = j + DJ[q]; if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const kk = a * n + b, c2 = cost[kk], nd = d + DW[q] * (c2 > ck ? c2 : ck); if (nd < dist[kk]) { dist[kk] = nd; push(kk, nd); }
    }
  }
  return { n, C, H, dist, cost, cellOf };
}
function flowSig(g) { const cp = corePos(g); let s = g.barricades.length * 7 + Math.round(cp.x) * 131 + Math.round(cp.z) * 197; for (const b of g.barricades) s = (s * 31 + Math.round(b.x * 3) * 7 + Math.round(b.z * 3) * 13 + Math.round(b.y0 * 2) + Math.round(b.hp / 60)) | 0; return s; }
// Which way a melee raider should walk to reach the core (null = just go straight).
export function coreFlowDir(g, p) {
  const sig = flowSig(g);
  // (v1.0.1: rebuilt at most once a second; abs: the clock restarts each wave)
  if (!g.coreFlow || (g.coreFlow.sig !== sig && Math.abs(g.time - g.coreFlow.t) > 1)) { g.coreFlow = buildFlow(g); g.coreFlow.sig = sig; g.coreFlow.t = g.time; }
  const F = g.coreFlow, i = F.cellOf(p.pos.x), j = F.cellOf(p.pos.z), here = F.dist[i * F.n + j];
  const cp = corePos(g);
  if (Math.hypot(p.pos.x - cp.x, p.pos.z - cp.z) < 3.5 || !isFinite(here)) return null;
  let bi = i, bj = j, bd = here;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const a = i + di, b = j + dj; if ((!di && !dj) || a < 0 || b < 0 || a >= F.n || b >= F.n) continue;
    const d = F.dist[a * F.n + b]; if (d < bd - 1e-6) { bd = d; bi = a; bj = b; }
  }
  if (bi === i && bj === j) return null;
  // look one more step ahead along the downhill path for a smoother line
  let ti = bi, tj = bj, td = bd;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const a = bi + di, b = bj + dj; if (a < 0 || b < 0 || a >= F.n || b >= F.n) continue; const d = F.dist[a * F.n + b]; if (d < td - 1e-6) { td = d; ti = a; tj = b; } }
  const tx = -F.H + (ti + 0.5) * F.C, tz = -F.H + (tj + 0.5) * F.C, dx = tx - p.pos.x, dz = tz - p.pos.z, l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l, chewing: F.cost[bi * F.n + bj] > 1.5 };
}

// ---------------------------------------------------------------- AMON raiders (v28)
// From wave 3 some raiders are swapped for enemies from the AMON mode (blocky models, their own stats and
// abilities kept simple: melee ones bite, ranged ones shoot, fliers fly). Stronger kinds unlock as the waves go on.
export function coreAmonPick(g) {
  const r = g.round, maxTier = Math.min(6, 1 + Math.floor((r - 2) / 4));
  const pool = ENEMIES.filter(e => e.tier <= maxTier && !(e.ab && (e.ab.spawn || e.ab.raise)) && e.atk > 0);
  if (!pool.length) return null;
  // newer (higher tier) kinds a bit more often once they unlock
  const w = pool.map(e => 1 + (e.tier === maxTier ? 1.5 : 0)), tot = w.reduce((a, b) => a + b, 0);
  let x = Math.random() * tot; for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
export function coreAmonStats(g, def, D) {
  const n = Math.max(1, g.round), hpK = (1 + 0.1 * (n - 1)) * (D ? D.hp : 1), dmgK = (1 + 0.05 * (n - 1)) * (D ? D.dmg : 1);
  const melee = (def.range || 0) < 2.5;
  const stats = { ...DEFAULT_STATS, health: Math.round(Math.min(2400, def.hp * 1.25 + 20) * hpK), moveSpeed: DEFAULT_STATS.moveSpeed * Math.max(0.5, Math.min(1.45, (def.speed || 3) / 4)), blockCooldown: 99 };
  if (melee) Object.assign(stats, { damage: 0 });
  else Object.assign(stats, { damage: Math.max(5, def.atk * 1.1) * dmgK, fireRate: Math.max(0.25, Math.min(3, def.rate || 1)), ammo: 4, reloadTime: 1.6, bulletSpeed: def.shell ? 20 : 32, explosive: (def.splash || 0) >= 2 ? 1 : 0, spread: 0.06 });
  return { stats, melee: melee ? Math.max(6, def.atk * 1.4) * dmgK : 0, size: Math.max(0.6, Math.min(2.6, (def.size || 0.6) * 1.35)), air: !!def.air };
}
// ---------------------------------------------------------------- network
// co: { dr: [[id, kind, x, y, z, landed]], cr: [[playerId, kind, hp, planX, planY, planZ, planAng, held]], rs: [[playerId, seconds left]], rd: [ready ids] }
export function coreRows(g) {
  const r2 = v => Math.round(v * 100) / 100, K = k => CORE.kinds.indexOf(k);
  return {
    dr: (g.coreDrops || []).map(d => [d.id, K(d.kind), r2(d.x), r2(d.y), r2(d.z), d.landed ? 1 : 0]),
    cc: g.heroes().filter(p => p.alive && ((p.carry && p.carry.kind === 'core') || p.coreHold)).map(p => [p.id, p.coreHold ? Math.round(Math.min(1, p.coreHold.t / CORE.move.hold) * 100) / 100 : 1]),   // v1.2.23 [id, 1 carrying the core / lift progress]
    cr: g.heroes().filter(p => p.carry && p.alive && p.carry.kind !== 'core').map(p => { const pl = corePlan(g, p) || { x: 0, y0: 0, z: 0, ang: 0 }; return [p.id, K(p.carry.kind), r2(p.carry.hp), r2(pl.x), r2(pl.y0), r2(pl.z), r2(pl.ang), p.carry.armed ? 1 : 0]; }),
    rs: g.heroes().filter(p => p.coreRespT != null && !p.alive).map(p => [p.id, Math.ceil(p.coreRespT)]),
    rd: g.phase === 'countdown' ? g.heroes().filter(p => p.coreReady).map(p => p.id) : [],
  };
}
