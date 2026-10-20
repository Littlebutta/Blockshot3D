// Brawl mode (Smash style): a lobby mode built on the 2D side view (side.js). Fighters stay on the z = 0 plane but the
// stages are floating 3D islands seen through a perspective camera (siderender.js). Hits don't drain health: they
// raise your damage % and the higher it is the farther hits launch you. Fly past a blast zone (sides, top, bottom)
// and you lose a stock. Last fighter with stocks wins the round. No pick phase: every character body is a fighter
// with its own fixed card build. No three.js here (runs in the sim).
import { DEFAULT_STATS } from './config.js';
import { mulberry32, pickTheme } from './levelgen.js';
import { SIDE } from './side.js';

export const BRAWL = {
  stocks: 3,          // default lives per round (lobby setting 'stocks')
  pctPerDmg: 0.5,     // damage % per point of damage taken (a default 24 damage bullet = 12%)
  healPct: 0.3,       // damage % removed per point of healing (v28: was 0.5, healing was too strong)
  regenK: 0.6,        // v28: Regen cards heal this much less again in Brawl (on top of healPct)
  kbBase: 3,          // launch speed at 0%
  kbPct: 0.13,        // extra launch speed per damage %
  launchMin: 7,       // launches at least this fast take away most air control for a moment (hitstun)
  launchCtl: 0.1,     // air control while launched (share of normal)
  airJumps: 1,        // double jump
  respawn: 1.6,       // seconds before a fighter with stocks left drops back in
  invuln: 2,          // seconds of respawn invulnerability
  margin: 13,         // blast zone distance past the stage edge (sides)
  top: 19, bottom: -11,
  suddenT: 120,       // after this many seconds everyone's % slowly climbs
  suddenRate: 3,
  dash: { minHold: 0.25, maxCharge: 1.1, minDist: 3, maxDist: 11, time: 0.22, hover: -1.2, breakHits: 2 },   // hold the second jump to charge an air dash toward the mouse
  hang: { reach: 0.9, max: 5, regrab: 0.6 },   // ledge grab on the stage's outer edges
  float: 3.5,         // respawn: float in place (invulnerable) this long, or press jump to drop in early
  weightMax: 1.3,     // v1.2.23: heaviest a fighter can get (big health builds were near unlaunchable)
  weightMin: 0.8,
};

// v1.2.23 item boxes: drop onto a random floor every so often; touch one to grab its power-up.
export const BITEMS = {
  every: 13, life: 15, max: 2, dur: 8, reach: 1.4,
  kinds: ['heal', 'power', 'heavy', 'speed', 'jump'],
  heal: 35,          // damage % removed
  power: 1.35,       // your hits launch this much farther
  heavy: 1.5,        // you're this much heavier (past the weight cap)
  speed: 1.3,        // move speed
  jump: 1.25,        // jump height
};
export const BITEM_INFO = {
  heal: { name: 'Bandage', icon: '✚', color: '#5dff8f' },
  power: { name: 'Power Glove', icon: '✊', color: '#ff5d5d' },
  heavy: { name: 'Anvil', icon: '⚓', color: '#9aa7b8' },
  speed: { name: 'Sneakers', icon: '⚡', color: '#ffd84a' },
  jump: { name: 'Spring', icon: '⤒', color: '#6cc8ff' },
};
// Strength of a fighter's active power-up of kind k (1 when they don't have it).
export const bItemK = (g, p, k) => p && p.fx && p.fx.bItem && p.fx.bItem.k === k && p.fx.bItem.t > g.time ? BITEMS[k] : 1;
let iid = 0;
export function brawlItems(g, dt) {
  if (g.phase !== 'play' || g.settings.brawlItems === false || !g.level.brawl) { g.bItems = []; return; }
  const I = BITEMS, stands = g.level.side.stands;
  g.bItems = g.bItems || [];
  g.bItemT = (g.bItemT ?? I.every * 0.5) - dt;
  if (g.bItemT <= 0) {
    g.bItemT = I.every * (0.75 + Math.random() * 0.5);
    if (g.bItems.length < I.max && stands.length) {
      const [x0, x1, top] = stands[Math.floor(Math.random() * stands.length)];
      const x = x0 + 0.8 + Math.random() * Math.max(0, x1 - x0 - 1.6);
      g.bItems.push({ id: ++iid, k: I.kinds[Math.floor(Math.random() * I.kinds.length)], x, y: top + 10, gy: top, t: I.life });
    }
  }
  for (const it of g.bItems) {
    it.t -= dt;
    if (it.y > it.gy) it.y = Math.max(it.gy, it.y - 7 * dt);
    for (const p of g.players) {
      if (p.kind !== 'hero' || !p.alive || !p.connected || it.t <= 0) continue;
      if (Math.abs(p.pos.x - it.x) > I.reach || p.pos.y + 1.6 < it.y || p.pos.y > it.y + 1.2) continue;
      it.t = 0;
      if (it.k === 'heal') p.pct = Math.max(0, (p.pct || 0) - I.heal);
      else p.fx.bItem = { k: it.k, t: g.time + I.dur };
      g.emit({ t: 'brawlItem', p: p.id, k: it.k, x: it.x, y: it.y + 0.5, z: 0 });
    }
  }
  g.bItems = g.bItems.filter(it => it.t > 0);
}
export const bItemRows = g => (g.bItems || []).map(it => [it.id, it.k, Math.round(it.x * 100) / 100, Math.round(it.y * 100) / 100, Math.round(it.t * 10) / 10]);

// Fixed builds: every character body is a fighter. Builds lean into one idea each so the cards work together.
export const FIGHTERS = {
  classic:  { name: 'The Brawler',      cards: ['battering-ram', 'twin-barrel', 'steady-hands', 'quick-hands', 'spring-heels'] },
  bolt:     { name: 'Overcharge',       cards: ['mod-beam-rifle', 'storm-caller', 'quick-guard'] },   // v1.2.23: lost Rapid Cycler,
  mochi:    { name: 'Bouncer',          cards: ['big-bubble', 'shock-bubble', 'repulsor', 'long-guard', 'big-iron', 'padded-vest', 'hollow-points'] },   // v1.2.23: + Hollow Points,
  sentinel: { name: 'Siege Knight',     cards: ['mass-driver', 'bulk-up', 'reinforced-plating', 'bulwark', 'shield-pillar'] },
  quack:    { name: 'Rubber Ducky',     cards: ['pinball-bomb', 'splinter-bounce', 'kinetic-rebound', 'spring-heels', 'shield-slam', 'quick-hands', 'heavy-slugs'] },   // v1.2.23: + Quick Hands, Heavy Slugs,
  astro:    { name: 'Star Caller',      cards: ['guided-meteor', 'volatile-payload', 'overclocked-legs', 'shield-rewind', 'hollow-points', 'quick-hands'] },   // v1.2.23: + Hollow Points, Quick Hands,
  cubert:   { name: 'Blockhead',        cards: ['mod-grenade-launcher', 'fortify', 'heavy-slugs', 'iron-lung', 'titan-frame'] },
  tiki:     { name: 'Fire Dancer',      cards: ['mod-flamethrower', 'wildfire', 'napalm-rounds', 'troll-blood', 'overclocked-legs', 'repulsor', 'thick-hide', 'bulk-up', 'velocity-rounds', 'hollow-points'] },   // v1.2.23: + Thick Hide, Bulk Up, Velocity Rounds, Hollow Points   // v1.2.13 (Devin): block blasts people away
  shroom:   { name: 'Spore Lord',       cards: ['plague-doctor', 'hex-rounds', 'sanctuary', 'wide-shells', 'quick-hands'] },   // v1.2.23: + Quick Hands,
  prism:    { name: 'Refractor',        cards: ['trick-shot', 'kinetic-rebound', 'mirror-edge', 'velocity-rounds', 'shield-catcher'] },
  gumdrop:  { name: 'Sticky Situation', cards: ['demolition', 'scp', 'rebound-charge', 'ricochet-rounds', 'bulk-up'] },
  vanguard: { name: 'Bulwark',          cards: ['mod-riot-shield', 'siphon-shield', 'fortress-stance'] },   // v1.2.23: lost Thick Hide and Reverb Barrage,
  wisp:     { name: 'Phantom Blade',    cards: ['mod-katana', 'blink-runner'] },   // v1.2.23: lost Vampiric Nanites and Bullet Time (won 9 in 10 bot fights),
  strider:  { name: 'Rushdown',         cards: ['mod-scattergun', 'hollow-points', 'thruster', 'overclocked-legs', 'spring-heels', 'shield-slam', 'steady-hands', 'heavy-slugs'] },   // v1.2.23: + Steady Hands, Heavy Slugs,
  fishbowl: { name: 'Deep Diver',       cards: ['bullet-hose', 'frost-rounds', 'shield-turret'] },   // v1.2.23: lost Encore Engine and Speed Loader,
};
export const FIGHTER_IDS = Object.keys(FIGHTERS);
export const fighterOf = cos => FIGHTERS[cos && cos.model] ? cos.model : 'classic';

// Gives a hero its fighter's build (replaces any cards).
export function applyFighter(g, p) {
  const id = fighterOf(p.cosmetics);
  p.fighter = id;
  p.cards = FIGHTERS[id].cards.filter(c => g.cardById.has(c));
  g.recompute(p);
  if (g.emitCards) g.emitCards(p);
}

// Stages: the main island's half width W (top at y = 0), soft platforms [x, top, w], side ledges [x0, x1, top],
// pillars [x, w, h], hanging platforms [x, top, w, string], moving platforms [x, top, w, axis, amp, period].
const STAGES = [
  { name: 'Battlefield', W: 9, p: [[-5, 3.2, 4.5], [5, 3.2, 4.5], [0, 6.3, 4.5]] },
  { name: 'Final Stand', W: 12 },
  { name: 'Twin Spires', W: 10, b: [[-7, 1.4, 2.6], [7, 1.4, 2.6]], p: [[0, 4.2, 5]] },
  { name: 'Sky Ferry', W: 7, ledge: [[-16, -11, -1.5], [11, 16, -1.5]], mv: [[0, 4, 4, 'x', 7, 8]] },
  { name: 'Swingyard', W: 9, hang: [[-5.5, 3.4, 3.5, 4], [5.5, 3.4, 3.5, 4]] },
  { name: 'Lagoon Steps', W: 8, p: [[-10.5, -1.2, 3], [10.5, -1.2, 3], [0, 3.6, 6]] },
  { name: 'Lift Off', W: 10, p: [[-5.5, 3, 4], [5.5, 3, 4]], mv: [[0, 2, 3, 'y', 2.5, 6]] },
  { name: 'Small Battlefield', W: 8, p: [[-4.5, 3, 4], [4.5, 3, 4]] },
  { name: 'Stairway', W: 10, p: [[-6, 2.6, 4], [0, 4.6, 4], [6, 6.6, 4]] },
  { name: 'Town Square', W: 11, p: [[0, 3.6, 8]], b: [[-8.5, 1.2, 3], [8.5, 1.2, 3]] },
  { name: 'Floating Isles', W: 6, ledge: [[-15, -9, 0], [9, 15, 0]], p: [[0, 3.4, 4]] },
  { name: 'Pagoda', W: 9, p: [[0, 2.8, 10], [0, 5.6, 5]] },
  { name: 'Twin Lifts', W: 9, mv: [[-5, 2.5, 3, 'y', 2, 5], [5, 2.5, 3, 'y', 2, 5]] },
  { name: 'Crossroads', W: 10, p: [[-6.5, 2.8, 3.5], [6.5, 2.8, 3.5], [0, 5, 4]], mv: [[0, 8, 3, 'x', 6, 9]] },
  // v1.2.23 new stages
  { name: 'Canopy', W: 8, p: [[-4, 3, 3.5], [4, 3, 3.5]], hang: [[0, 6.2, 4, 3]] },
  { name: 'Island Hop', W: 5, ledge: [[-14, -8, 0.8], [8, 14, 0.8]], mv: [[-6.5, 3.5, 2.5, 'y', 1.5, 5], [6.5, 3.5, 2.5, 'y', 1.5, 5]] },
  { name: 'Clocktower', W: 9, b: [[0, 2.6, 3]], p: [[-5.5, 3.6, 3.5], [5.5, 3.6, 3.5], [0, 6.4, 4]] },
  { name: 'Conveyor', W: 11, mv: [[0, 3, 5, 'x', 5, 7], [0, 6, 3, 'x', -4, 7]] },
  { name: 'Ruins', W: 10, b: [[-6.5, 1.8, 2], [6.5, 1.8, 2]], p: [[-3, 3.8, 3], [3, 3.8, 3]], hang: [[0, 6, 3, 3.5]] },
];
// Lobby option "Flat, wide stages": one long island, nothing else.
const FLAT = [{ name: 'Wide Open', W: 16 }, { name: 'Long Haul', W: 19 }, { name: 'Flat Plains', W: 14, p: [[0, 3.4, 6]] }];

let bid = 0;
export function generateBrawlLevel(nPlayers, seed, themeSet, flat) {
  const rng = mulberry32(seed ^ 0xb7a1), pool = flat ? FLAT : STAGES;
  const S = pool[Math.floor(rng() * pool.length)];
  const W = S.W + Math.max(0, Math.min(5, (nPlayers - 4) * 0.8));   // big lobbies get a wider main island
  const boxes = [], dynamic = [], stands = [];
  const D = 6, P = SIDE.plat;
  boxes.push({ x: 0, z: 0, w: W * 2, d: D, h: 3, y0: -3, ground: 1, main: 1 });
  stands.push([-W, W, 0]);
  for (const [x0, x1, t] of S.ledge || []) { boxes.push({ x: (x0 + x1) / 2, z: 0, w: x1 - x0, d: 4.5, h: 2, y0: t - 2, ground: 1, main: 1 }); stands.push([x0, x1, t]); }
  for (const [x, t, w] of S.p || []) { boxes.push({ x, z: 0, w, d: 3.5, h: P, y0: t - P, plat: 1, oneWay: 1 }); stands.push([x - w / 2, x + w / 2, t]); }   // soft platforms: jump up through, drop down through
  for (const [x, w, h] of S.b || []) { boxes.push({ x, z: 0, w, d: 3, h, y0: 0 }); stands.push([x - w / 2, x + w / 2, h]); }
  for (const [x, t, w, len] of S.hang || []) {
    const amp = (rng() < 0.5 ? -1 : 1) * (0.12 + rng() * 0.15);
    dynamic.push({ id: 'bw' + (++bid), kind: 'swing', x, z: 0, y0: t - P, w, d: 3, h: P, ax: x, ay: t + len, len, amp, mass: 14, oneWay: 1 });
  }
  for (const [x, t, w, axis, amp, period] of S.mv || []) dynamic.push({ id: 'bw' + (++bid), kind: 'slide', x, z: 0, y0: t - P, w, d: 3, h: P, axis, amp, period, phase: rng() * 6.28, oneWay: 1 });
  const edge = Math.max(W, ...(S.ledge || []).map(l => Math.max(-l[0], l[1])));
  const hx = Math.round(edge + BRAWL.margin);
  const theme = pickTheme(rng, themeSet);
  // side: every x is open below (no bottom edge anywhere), so side.js bot steering treats the stage edges as pits.
  const side = { bottom: BRAWL.bottom + SIDE.pitKill, top: BRAWL.top, pits: [[-hx - 50, hx + 50]], pads: [], stands };
  return { seed, name: S.name, hx, hz: 2, lava: false, ice: false, theme, boxes, dynamic, poly: null, shape: 'rect', side,
    brawl: { W, edge, top: BRAWL.top, bottom: BRAWL.bottom, ledges: hangEdges(W, S.ledge) } };
}

// Grabbable ledges: the outer ends of the main island and of the side ledges, [x, top, side (-1 left end, 1 right end)].
function hangEdges(W, ledges) {
  const out = [[-W, 0, -1], [W, 0, 1]];
  for (const [x0, x1, t] of ledges || []) { if (x1 < 0) out.push([x0, t, -1], [x1, t, 1]); else if (x0 > 0) out.push([x0, t, -1], [x1, t, 1]); }
  return out;
}

// Fighters line up across the main island (teams on opposite halves).
export function brawlSpawnPoints(level, sizes) {
  const n = sizes.reduce((a, b) => a + b, 0), W = level.brawl.W - 1.5;
  let i = 0;
  return sizes.map(m => Array.from({ length: m }, () => {
    const x = n === 1 ? 0 : -W + (2 * W) * (i++ / (n - 1));
    return { x, y: 0, z: 0 };
  }));
}
const respawnPoint = (g) => ({ x: (Math.random() - 0.5) * 6, y: Math.min(8.5, g.level.brawl.top - 6), z: 0 });

// Blast zones (runs instead of sideRules on a brawl stage).
export function brawlRules(g, p) {
  const L = g.level, B = L.brawl;
  if (p.flying) { if (p.pos.y > B.top - 3) p.pos.y = B.top - 3; return; }
  const out = Math.abs(p.pos.x) > L.hx - 0.3 || p.pos.y > B.top || p.pos.y < B.bottom;
  if (!out) return;
  if (p.kind === 'hero' && g.phase === 'play') return brawlKO(g, p);
  if (p.heavy || p.kind === 'boss' || p.kind === 'portal' || g.phase !== 'play' || p.kind === 'hero') {
    const sp = p.kind === 'hero' ? respawnPoint(g) : (p.spawn || { x: 0, y: 0, z: 0 });
    p.pos = { x: sp.x, y: sp.y + 0.2, z: 0 }; p.vel = { x: 0, y: 0, z: 0 };
    return;
  }
  p.fx.invulnT = 0; p.hp = Math.min(p.hp, 0.01);
  g.hurt(p, 1e6, p.fx.lastSrc && g.time - (p.fx.lastSrcT || -99) < 8 ? p.fx.lastSrc : null, null);
}

// Lost a stock: out until the respawn timer runs out (or for good at zero).
function brawlKO(g, p) {
  const L = g.level, B = L.brawl;
  const src = p.fx.lastSrc && g.time - (p.fx.lastSrcT || -99) < 8 ? p.fx.lastSrc : null, credit = g.creditOf(src);
  p.stocks = Math.max(0, (p.stocks || 1) - 1);
  p.alive = false; p.hp = 0; p.tally.deaths++;
  if (credit && credit.kind === 'hero' && g.isEnemy(credit, p)) credit.tally.kills++;
  p.respawnT = p.stocks > 0 ? BRAWL.respawn : null;
  // the blast shows at the edge of the play area the fighter flew past
  const x = Math.max(-L.hx + 2, Math.min(L.hx - 2, p.pos.x)), y = Math.max(B.bottom + 3, Math.min(B.top - 2, p.pos.y));
  g.emit({ t: 'death', p: p.id, k: src ? src.id : null, x, y, z: 0 });
  g.emit({ t: 'brawlKO', p: p.id, x, y, z: 0, stocks: p.stocks, pct: Math.round(p.pct || 0) });
}

// Hit launch: replaces the normal hidden knockback for fighters. Harder hits and a higher % launch farther;
// more max health makes you heavier. Hits restore your air jump so you can always try to recover.
export function brawlLaunch(g, t, amt, dir, src) {
  const pending = ((t.bHp ?? t.hp) - t.hp + (t.fx.bOver || 0)) * BRAWL.pctPerDmg;
  const pct = (t.pct || 0) + Math.max(0, pending);
  const weight = Math.max(BRAWL.weightMin, Math.min(BRAWL.weightMax, Math.sqrt(Math.max(40, g.maxHp(t)) / DEFAULT_STATS.health) * (t.size || 1) ** 0.5)) * bItemK(g, t, 'heavy');
  const hitK = (0.55 + 0.45 * Math.min(2.5, amt / DEFAULT_STATS.damage)) * bItemK(g, g.creditOf ? g.creditOf(src) : src, 'power');
  const v = (BRAWL.kbBase + pct * BRAWL.kbPct) * hitK / weight;
  const l = Math.hypot(dir.x, dir.y || 0) || 1, hx = dir.x / l, hy = (dir.y || 0) / l;
  let vx, vy;
  if (hy < -0.8) { vx = hx * v * 0.5; vy = -v * 0.7; }          // a steep hit from above: a spike
  else {
    const ang = Math.abs(hx) < 0.15 ? 1.4 : 0.7 + Math.max(0, hy) * 0.6;   // otherwise up and away, about 40 degrees
    vx = (Math.sign(hx) || (Math.random() < 0.5 ? -1 : 1)) * Math.cos(ang) * v; vy = Math.sin(ang) * v;
  }
  t.vel.x = vx; t.vel.y = vy;
  if (vy > 0.5) t.onGround = false;
  if (v >= BRAWL.launchMin) t.fx.launchT = g.time + Math.min(0.9, v * 0.035);
  t.fx.airJ = Math.max(t.fx.airJ || 0, 1);
}

// Every tick while playing: turn health changes into damage % (damage raises it, healing lowers it), respawns,
// and sudden death after BRAWL.suddenT.
export function brawlTick(g, dt) {
  brawlItems(g, dt);
  const sudden = g.time > BRAWL.suddenT;
  if (sudden && !g.overtime) { g.overtime = true; g.overtimeAt = g.time; g.emit({ t: 'overtime', brawl: true }); }
  if (sudden) g.suddenMul();   // (announces each doubling even when nobody is hit)
  for (const p of g.players) {
    if (p.kind !== 'hero' || !p.connected) continue;
    if (!p.alive) {
      if (p.respawnT == null || g.phase !== 'play') continue;
      p.respawnT -= dt;
      if (p.respawnT <= 0) {
        p.respawnT = null;
        g.resetPlayer(p, respawnPoint(g));
        p.fx.floatT = g.time + BRAWL.float; p.fx.invulnT = p.fx.floatT + 1; p.fx.jHeld = true;   // float in place first so you see where you'll land
        g.emit({ t: 'respawn', p: p.id });
        g.emit({ t: 'brawlFloat', p: p.id, x: p.pos.x, y: p.pos.y, z: 0 });
      }
      continue;
    }
    if (p.reviving) continue;
    const half = g.maxHp(p) * 0.5;
    if (p.bHp == null) { p.hp = half; p.bHp = half; p.fx.bOver = 0; continue; }
    const d = p.hp - p.bHp - (p.fx.bOver || 0);
    p.fx.bOver = 0;
    if (d < 0) p.pct = (p.pct || 0) - d * BRAWL.pctPerDmg;
    else if (d > 0) p.pct = Math.max(0, (p.pct || 0) - d * BRAWL.healPct);
    if (sudden && g.phase === 'play') p.pct = (p.pct || 0) + BRAWL.suddenRate * dt;
    p.pct = Math.min(999, p.pct || 0);
    p.hp = half; p.bHp = half;   // health sits at half so both damage and healing register next tick
  }
}

// Bots: get back to the stage after a launch (steer to the nearest surface and use the air jump while falling).
export function brawlRecover(g, p, inp, A, stands) {
  if (p.onGround) { A.bjp = false; return null; }
  let best = null, bd = Infinity;
  for (const s of stands) { const dx = p.pos.x < s.x0 ? s.x0 - p.pos.x : p.pos.x > s.x1 ? p.pos.x - s.x1 : 0, d = dx + Math.max(0, s.y - p.pos.y) * 0.5; if (d < bd) { bd = d; best = s; } }
  if (!best) return null;
  const off = p.pos.x < best.x0 - 0.3 || p.pos.x > best.x1 + 0.3;
  if (!off && p.pos.y > best.y - 0.2) return null;
  const dir = Math.sign((best.x0 + best.x1) / 2 - p.pos.x) || 1;
  // pulse jump (jumps trigger on press) once falling below the surface
  const want = p.vel.y < 0 && p.pos.y < best.y + 1.2 && (p.fx.airJ || 0) > 0;
  A.bjp = want ? !A.bjp : false;
  return { dir, jump: A.bjp };
}

// Per-tick movement extras for fighters (runs before normal movement). Returns 1 when the fighter is held in place
// (hanging on a ledge, or floating in after a respawn), 2 while charging or doing the air dash, else 0.
// Either way no shooting or blocking meanwhile.
export function brawlMove(g, p, inp, dt, frozen) {
  const f = p.fx, fresh = !!inp.jump && !f.jHeld, B = g.level.brawl;
  const freshD = !!inp.dash && !f.dHeld; f.dHeld = !!inp.dash;   // v1.2.13: the dash has its own key (Devin)
  if (!p.alive || frozen || !B) return 0;
  // respawn float
  if (f.floatT > g.time) {
    if (fresh || (p.isBot && f.floatT - g.time < BRAWL.float - 1.2)) { f.floatT = 0; f.jHeld = true; f.invulnT = g.time + 1; p.vel = { x: 0, y: -2, z: 0 }; g.emit({ t: 'brawlDrop', p: p.id, x: p.pos.x, y: p.pos.y, z: 0 }); return 0; }
    p.vel = { x: 0, y: 0, z: 0 }; return 1;
  }
  // hanging on a ledge
  const H = BRAWL.hang;
  if (f.hang) {
    const h = f.hang, [ex, top, side] = h.e;
    h.t += dt;
    if (fresh || (p.isBot && h.t > 0.35)) {   // climb up
      f.hang = null; f.jHeld = true; p.pos = { x: ex - side * 0.9, y: top + 0.02, z: 0 }; p.vel = { x: 0, y: 0, z: 0 }; p.onGround = true; f.airJ = BRAWL.airJumps;
      g.emit({ t: 'brawlClimb', p: p.id, x: p.pos.x, y: p.pos.y, z: 0 });
      return 0;
    }
    if (inp.drop || inp.mz < -0.5 || inp.mx * side > 0.5 || h.t > H.max) { f.hang = null; f.hangCd = g.time + H.regrab; f.airJ = Math.max(f.airJ || 0, 1); return 0; }
    p.pos = { x: ex + side * 0.45 * (p.size || 1), y: top - 1.25, z: 0 }; p.vel = { x: 0, y: 0, z: 0 };
    return 1;
  }
  if (!p.onGround && p.vel.y <= 0.5 && !(f.hangCd > g.time) && !(f.launchT > g.time) && f.dashC == null) {
    for (const e of B.ledges || []) {
      const [ex, top, side] = e, dx = (p.pos.x - ex) * side;
      if (dx > -0.25 && dx < H.reach && p.pos.y > top - 2 && p.pos.y < top - 0.15) {
        f.hang = { e, t: 0 }; f.dashC = null; f.dashT = 0; f.dashUsed = false;
        g.emit({ t: 'brawlHang', p: p.id, x: ex, y: top, z: 0 });
        return 1;
      }
    }
  }
  // air dash (v1.2.13: its own key, once per time in the air): hold to charge a dash toward the mouse, let go to dash
  const D = BRAWL.dash;
  if (f.dashT > 0) {
    f.dashT -= dt;
    p.vel.x = f.dashV.x; p.vel.y = f.dashV.y; p.vel.z = 0;
    if (f.dashT <= 0) { p.vel.x *= 0.3; p.vel.y *= 0.3; }
    return 2;
  }
  if (p.onGround) { f.dashC = null; f.dashUsed = false; return 0; }
  if (freshD && !f.dashUsed && f.dashC == null) { f.dashC = 0; f.dashHits = 0; f.dashUsed = true; return 0; }
  if (f.dashC == null) return 0;
  if (!inp.dash) {   // let go
    const c = f.dashC; f.dashC = null;
    if (c >= D.minHold) startDash(g, p, Math.min(1, (c - D.minHold) / (D.maxCharge - D.minHold)));
    else f.dashUsed = false;   // a quick tap doesn't use it up
    return 0;
  }
  f.dashC += dt;
  if (f.dashC >= D.minHold) {
    if (!f.dashCue) { f.dashCue = true; g.emit({ t: 'brawlCharge', p: p.id, x: p.pos.x, y: p.pos.y, z: 0 }); }
    if (f.dashC >= D.maxCharge) { f.dashC = null; startDash(g, p, 1); return 2; }
    p.vel.x *= Math.max(0, 1 - 6 * dt); p.vel.y = Math.max(p.vel.y, D.hover);   // hang in the air while charging
    return 2;
  }
  return 0;
}
function startDash(g, p, k) {
  const D = BRAWL.dash, f = p.fx;
  const a = p.aim || { x: 1, y: 0 }, l = Math.hypot(a.x, a.y) || 1;
  const dist = D.minDist + (D.maxDist - D.minDist) * k, sp = dist / D.time;
  f.dashV = { x: a.x / l * sp, y: a.y / l * sp }; f.dashT = D.time; f.dashCue = false;
  g.emit({ t: 'brawlDash', p: p.id, x: p.pos.x, y: p.pos.y + 0.8, z: 0, x2: p.pos.x + a.x / l * dist, y2: p.pos.y + 0.8 + a.y / l * dist, k: Math.round(k * 100) / 100 });
}
// A fighter got hit: lets go of a ledge; enough hits during a dash charge break it and they drop.
export function brawlHit(g, t) {
  const f = t.fx;
  if (f.hang) { f.hang = null; f.hangCd = g.time + BRAWL.hang.regrab; }
  if (f.dashC != null && f.dashC >= BRAWL.dash.minHold * 0.5) {
    f.dashHits = (f.dashHits || 0) + 1;
    if (f.dashHits >= BRAWL.dash.breakHits) { f.dashC = null; f.dashCue = false; f.airJ = 0; g.emit({ t: 'brawlBreak', p: t.id, x: t.pos.x, y: t.pos.y + 0.8, z: 0 }); }
  }
}
