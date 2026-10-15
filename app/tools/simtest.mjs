// Headless simulation tests: node tools/simtest.mjs
// Runs the authoritative sim (no rendering) through many rounds and checks feature behavior.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const J = p => import(path.join(root, 'public/js', p));
const { Game: Game0, CRITTER_MAX } = await J('sim.js');
// v1.0.1: matches open with a starting card pick; the older tests below start straight at round 1 (startPick: false)
class Game extends Game0 { constructor(o) { super({ ...o, settings: { startPick: false, ...(o.settings || {}) } }); } }
const { validateCard, makeCursed, makeHoly, expandCards, cardWeight } = await J('cards.js');
const C = await J('config.js');
const C2 = await J('coop.js');
const { sideRules, inPit, SIDE } = await J('side.js');

const cards = [];
for (const d of fs.readdirSync(path.join(root, 'cards'))) {
  if (d.startsWith('_')) continue;
  const f = path.join(root, 'cards', d, 'card.json');
  if (!fs.existsSync(f)) continue;
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  const errs = validateCard(c);
  if (errs.length) { console.error('BAD CARD', d, errs); process.exitCode = 1; continue; }
  cards.push({ ...c, rarity: c.rarity || 'common' });
}
expandCards(cards);
let fails = 0, passes = 0;
export function check(name, ok, info = '') { if (ok) passes++; else { fails++; console.log('FAIL', name, info); } }
const roster = (n, opts = {}) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, team: opts.teams ? i % opts.teams : 0, isBot: !opts.human || i > 0, difficulty: ['easy', 'normal', 'hard'][i % 3], color: C.assignColors(Array.from({ length: n }, (_, k) => ({ team: opts.teams ? k % opts.teams : 0 })), opts.teams ? 'tdm' : 'ffa')[i], kind: 'hero' }));
function run(g, secs, dt = 1 / 60, each) { for (let t = 0; t < secs; t += dt) { g.step(dt); g.takeEvents(); if (each) each(g); } }
export { Game, cards, C, roster, run };

{ // v1.0.1: starting card pick before round 1 (FFA / TDM / waves / Core), none in Brawl or the open world
  for (const [mode, extra, want] of [['ffa', {}, true], ['tdm', {}, true], ['waves', {}, true], ['waves', { core: true }, true], ['open', {}, false]]) {
    const g = new Game0({ roster: roster(3, { teams: mode === 'tdm' ? 3 : 0 }), settings: { mode, pickTime: 2, ...extra }, cards });
    g.start();
    const picking = g.phase === 'picking';
    check('start pick ' + mode + (extra.core ? ' core' : ''), picking === want, g.phase);
    if (!want) continue;
    run(g, 6);
    check('start pick ends in round 1 countdown/play ' + mode, g.round === 1 && (g.phase === 'countdown' || g.phase === 'play') && g.heroes().every(p => p.cards.length === 1), `${g.round} ${g.phase} ${g.heroes().map(p => p.cards.length)}`);
  }
}
const t0 = Date.now();
// ---- smoke: many rounds in several modes
for (const [label, n, settings] of [
  ['ffa', 4, { mapSource: 'mixed' }], ['tdm', 6, { mode: 'tdm' }], ['waves', 3, { mode: 'waves' }],
  ['lava', 5, { mapSource: 'lava' }], ['hazards', 4, { hazards: true }], ['commander', 3, { commander: true }],
]) {
  const g = new Game({ roster: roster(n, { teams: settings.mode === 'tdm' ? 2 : 0, human: settings.commander }), settings: { ...settings, pickTime: 2, weaponMods: true }, cards });
  g.start();
  let err = null, rounds = 0, lastRound = 0;
  try { run(g, 240, 1 / 60, gg => { if (gg.round !== lastRound) { rounds++; lastRound = gg.round; } for (const p of gg.players) if (!isFinite(p.pos.x + p.pos.y + p.pos.z)) throw new Error('NaN pos ' + p.id); }); }
  catch (e) { err = e; console.log(e.stack); }
  check('smoke ' + label, !err && rounds >= 2, `rounds=${rounds} err=${err && err.message}`);
  JSON.stringify(g.snapshot());
}

// ---------------------------------------------------------------- feature tests
const { generateLevel, spawnPoints, clearSpawns } = await J('levelgen.js');
const { navNodes, currentNode } = await J('ai.js');
const cardById = new Map(cards.map(c => [c.id, c]));
const freshGame = (n = 2, settings = {}) => { const g = new Game({ roster: roster(n), settings: { mapSource: 'generated', ...settings }, cards }); g.start(); g.phase = 'play'; g.phaseT = 0; return g; };
const giveCard = (g, p, id) => { p.cards.push(id); g.recompute(p); };
// A clean flat arena (no boxes/dynamics) for precise mechanics tests.
const flat = (g) => { g.level.boxes = g.level.boxes.filter(b => b.wall); g.level.dynamic = []; g.level.solids = g.level.solids.filter(s => s.wall); g.dyn = []; g.refreshSolids(); g.bullets = []; g.hazard = null; };

// Player cap and colors
check('maxPlayers is 20', C.RULES.maxPlayers === 20);
check('20 distinct FFA colors', new Set(C.assignColors(Array.from({ length: 20 }, () => ({})), 'ffa')).size === 20);
check('10 distinct shades per team', new Set(C.assignColors(Array.from({ length: 20 }, (_, i) => ({ team: i % 2 })), 'tdm')).size === 20);

// Lava spawns: nobody shares a platform, for every count up to 20, any mode
{
  let ok = true, info = '';
  for (let seed = 1; seed <= 40; seed++) for (const groups of [[1, 1], [1, 1, 1, 1, 1], Array(8).fill(1), Array(20).fill(1), [5, 5], [10, 10], [4, 4, 4, 4], [3, 9]]) {
    const n = groups.reduce((a, b) => a + b, 0), L = generateLevel(n, 'lava', seed * 7919, 'standard', n);
    const pts = spawnPoints(L, groups).flat();
    const plats = pts.map(p => L.dynamic.find(o => o.kind === 'float' && Math.abs(p.x - o.x) < o.w / 2 && Math.abs(p.z - o.z) < o.d / 2));
    if (plats.some(x => !x) || new Set(plats).size !== pts.length) { ok = false; info = `seed ${seed} groups ${groups}`; }
    // symmetric ring: spawn platforms mirror left/right
    const ring = L.dynamic.filter(o => o.spawn != null);
    if (!ring.every(o => ring.some(q => Math.abs(q.x + o.x) < 0.01 && Math.abs(q.z - o.z) < 0.01))) { ok = false; info = 'ring not mirrored ' + seed; }
  }
  check('lava: one spawn platform per person (2-20 players, teams), symmetric ring', ok, info);
  // co-op never uses Lava Lake (bots can't navigate it), even with "Lava Lake only" picked
  let lavaSeen = false;
  for (let k = 0; k < 12; k++) { const g = new Game({ roster: roster(4), settings: { mode: 'waves', mapSource: k % 2 ? 'lava' : 'mixed' }, cards }); g.round = 3; g.startRound(); if (g.level.lava) lavaSeen = true; }
  check('co-op never picks Lava Lake', !lavaSeen);
}
// Arena grows to 20
{ const L = generateLevel(20, 'generated', 5, 'standard'); check('arena grows past 8 players', L.hx > generateLevel(8, 'generated', 5, 'standard').hx); }

// Size-to-speed range widened
check('small players faster', C.speedFor(0.75) >= 1.18, C.speedFor(0.75));
check('big players slower', C.speedFor(1.58) <= 0.78 && C.speedFor(1.8) >= 0.68, C.speedFor(1.58));
check('normal size unchanged', C.speedFor(1) === 1);

// Bullet drop scales with size; size scales with damage
{
  const g = freshGame(); const p = g.players[0];
  const r1 = g.effSize(p.stats, g.effDamage(p.stats));
  p.stats.damage *= 3; const r2 = g.effSize(p.stats, g.effDamage(p.stats));
  check('damage grows bullet size', r2 > r1 * 1.25 && r2 < r1 * 1.4, `${r1} ${r2}`);
  check('bigger bullets drop harder', C.bulletGravityFor(0.3) > C.bulletGravityFor(0.14) * 2 && C.bulletGravityFor(0.14) === C.RULES.bulletGravity);
  const b = g.spawnBullet(p, { x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 28, false);
  check('spawned bullet uses size gravity', Math.abs(b.grav - C.bulletGravityFor(b.r)) < 1e-9);
}

// Hidden knockback grows with damage
{
  const g = freshGame(); const t = g.players[1];
  t.vel = { x: 0, y: 0, z: 0 }; g.hurt(t, 24, g.players[0], { x: 1, y: 0, z: 0 }); const k24 = t.vel.x;
  t.hp = 500; t.vel = { x: 0, y: 0, z: 0 }; g.hurt(t, 80, g.players[0], { x: 1, y: 0, z: 0 }); const k80 = t.vel.x;
  check('default hit knockback ~unchanged (5)', Math.abs(k24 - 5.14) < 0.1, k24);
  check('bigger hits push harder', k80 > k24 * 1.8, `${k24} ${k80}`);
}

// Grenade launcher +30%
check('grenade launcher damage x1.43 (was 1.1)', cardById.get('mod-grenade-launcher').modifiers.find(m => m.stat === 'damage').value === 1.43);

// Homing respects line of sight
{
  const mk = (wall) => {
    const g = freshGame(); flat(g);
    const [a, t] = g.players; a.pos = { x: -6, y: 0, z: 0 }; t.pos = { x: 4, y: 0, z: 6 };
    for (const p of g.players.slice(2)) p.alive = false;
    if (wall) { g.level.solids.push({ min: { x: -2, y: 0, z: 1 }, max: { x: 0, y: 6, z: 12 } }); g.refreshSolids(); }
    a.stats.homing = 6;
    const b = g.spawnBullet(a, { x: -5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 20, false); b.grav = 0;
    for (let i = 0; i < 6; i++) g.updateBullets(1 / 60);
    return b.vel.z;
  };
  check('homing turns toward a visible target', mk(false) > 0.5, mk(false));
  check('homing ignores a target behind a wall', Math.abs(mk(true)) < 1e-6, mk(true));
}

// Shield reflect bonus: diminishing and capped lower
{
  const g = freshGame(); const [a, q] = g.players; q.blockT = 0; g.tryBlock(q);
  const t0 = q.blockT, adds = [];
  for (let i = 0; i < 12; i++) { const before = q.blockT; const b = g.spawnBullet(a, { ...q.pos, y: 1 }, { x: 1, y: 0, z: 0 }, 28, false); g.reflect(b, q, { x: -1, y: 0, z: 0 }); adds.push(q.blockT - before); }
  check('first reflect adds 0.42 s', Math.abs(adds[0] - 0.42) < 1e-9, adds[0]);
  check('second reflect adds less', Math.abs(adds[1] - 0.315) < 1e-9, adds[1]);
  check('total extension capped at 1.2 s', Math.abs(q.blockT - t0 - 1.2) < 1e-9, q.blockT - t0);
}

// Siphon Shield
{
  const g = freshGame(); const [a, q] = g.players; giveCard(g, q, 'siphon-shield');
  check('siphon raises block cooldown', q.stats.blockCooldown > C.DEFAULT_STATS.blockCooldown * 1.3);
  q.hp = 50; g.tryBlock(q); const b = g.spawnBullet(a, { ...q.pos, y: 1 }, { x: 1, y: 0, z: 0 }, 28, false); g.reflect(b, q, { x: -1, y: 0, z: 0 });
  check('siphon heals from blocked bullet', Math.abs(q.hp - (50 + b.dmg * 0.5)) < 1e-6 || Math.abs(q.hp - 50 - 0.5 * g.effDamage(a.stats)) < 1e-6, q.hp);
  // deployed shield wall also heals, and there is no bubble
  const g2 = freshGame(); flat(g2); const [a2, q2] = g2.players; giveCard(g2, q2, 'siphon-shield'); giveCard(g2, q2, 'bastion-wall');
  q2.pos = { x: 0, y: 0, z: 0 }; q2.aim = { x: 1, y: 0, z: 0 }; a2.pos = { x: 8, y: 0, z: 0 }; q2.hp = 40; q2.blockCdT = 0; g2.tryBlock(q2);
  check('deploy: no bubble', q2.blockT <= 0 && g2.shields.length === 1 && g2.shields[0].leech === 1);
  const b2 = g2.spawnBullet(a2, { x: 5, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, 28, false); b2.grav = 0;
  for (let i = 0; i < 30 && q2.hp === 40; i++) g2.updateBullets(1 / 60);
  check('siphon heals through deployed shield wall', q2.hp > 40, q2.hp);
  // sandbags do not heal
  const g3 = freshGame(); flat(g3); const [a3, q3] = g3.players; giveCard(g3, q3, 'siphon-shield'); giveCard(g3, q3, 'sandbag-barricade');
  q3.pos = { x: 0, y: 0, z: 0 }; q3.aim = { x: 1, y: 0, z: 0 }; q3.aimPoint = { x: 2.5, y: 1, z: 0 }; a3.pos = { x: 9, y: 0, z: 0 }; q3.hp = 40; q3.blockCdT = 0;
  g3.tryBlock(q3); q3.blockT = 0;
  const b3 = g3.spawnBullet(a3, { x: 6, y: 0.6, z: 0 }, { x: -1, y: 0, z: 0 }, 28, false); b3.grav = 0;
  for (let i = 0; i < 40 && b3.alive; i++) g3.updateBullets(1 / 60);
  check('sandbag stopped the bullet', !b3.alive && g3.barricades[0].hp < g3.barricades[0].maxHp);
  check('sandbags do not trigger siphon', q3.hp === 40, q3.hp);
}

// v26: Shock Bubble is a burst around you the moment you block (shock area + floor ring event)
{
  const g = freshGame(); flat(g); const [q, e] = g.players; giveCard(g, q, 'shock-bubble');
  q.pos = { x: 0, y: 0, z: 0 }; q.aim = { x: 1, y: 0, z: 0 }; e.pos = { x: 2, y: 0, z: 0 }; const hp0 = e.hp; g.takeEvents();
  g.tryBlock(q); const ev = g.takeEvents();
  check('shock burst hurts enemies near you when you block', e.hp < hp0 - 5 && ev.some(x => x.t === 'shockArea'), hp0 - e.hp);
}

// Block size scales every deployable
{
  const g = freshGame(); flat(g); const p = g.players[0]; giveCard(g, p, 'sandbag-barricade'); giveCard(g, p, 'concrete-barrier'); giveCard(g, p, 'mine-layer');
  p.pos = { x: 0, y: 0, z: 0 }; p.aim = { x: 1, y: 0, z: 0 }; p.aimPoint = { x: 4, y: 1, z: 0 };
  g.tryBlock(p); const small = g.barricades.map(b => b.len), m1 = g.mines[0].sz;
  g.barricades = []; g.mines = []; g.refreshSolids(); p.stats.blockSize = 2; p.blockCdT = 0; g.tryBlock(p);
  check('walls double with block size 2', g.barricades.every((b, i) => Math.abs(b.len - small[i] * 2) < 1e-9), JSON.stringify([small, g.barricades.map(b => b.len)]));
  check('mines scale with block size', g.mines[0].sz === 2 && m1 === 1);
  const g2 = freshGame(); const q = g2.players[0]; giveCard(g2, q, 'bastion-wall'); const w1 = Math.max(g2.shields.length, 0); g2.tryBlock(q); const W1 = Math.max(g2.shields[0].w, g2.shields[0].d);
  q.stats.blockSize *= 2; q.blockCdT = 0; g2.tryBlock(q); const sl = g2.shields[g2.shields.length - 1], W2 = Math.max(sl.w, sl.d);
  check('deployed shield scales with block size', Math.abs(W2 - 2 * W1) < 1e-9);
}

// Sandbags + concrete: aim placement, perpendicular, unlimited, stacking, settling, 4x HP
{
  check('concrete is 4x sandbag health', cardById.get('concrete-barrier').modifiers[0].value === 4 * cardById.get('sandbag-barricade').modifiers[0].value);
  const g = freshGame(); flat(g); const p = g.players[0]; giveCard(g, p, 'sandbag-barricade');
  p.pos = { x: 0, y: 0, z: 0 };
  const ang = 0.6; p.aim = { x: Math.cos(ang), y: 0, z: Math.sin(ang) }; p.aimPoint = { x: Math.cos(ang) * 5, y: 1, z: Math.sin(ang) * 5 };
  g.tryBlock(p); const b = g.barricades[0];
  { const d = Math.hypot(b.x, b.z); check('wall placed a fixed distance ahead, not at the aim point', Math.abs(b.x / d - p.aim.x) < 1e-6 && d > 1 && d < 2.5, d); }
  const u = { x: Math.cos(b.ang), z: Math.sin(b.ang) };
  check('wall long side perpendicular to facing', Math.abs(u.x * p.aim.x + u.z * p.aim.z) < 1e-9);
  check('angled wall made of several boxes', b.solids.length >= 3);
  for (let i = 0; i < 12; i++) { p.blockCdT = 0; p.pos = { x: -8 + i * 1.5, y: 0, z: -6 }; g.tryBlock(p); }
  check('no wall limit', g.barricades.length === 13);
  // stacking
  const g2 = freshGame(); flat(g2); const q = g2.players[0]; giveCard(g2, q, 'concrete-barrier'); giveCard(g2, q, 'sandbag-barricade');
  q.pos = { x: 0, y: 0, z: 0 }; q.aim = { x: 0, y: 0, z: 1 }; q.aimPoint = { x: 0, y: 1, z: 4 };
  g2.tryBlock(q);
  const [c0, s0] = g2.barricades;
  check('concrete placed first, sandbags stacked on it', c0.kind === 'concrete' && s0.kind === 'sandbag' && Math.abs(s0.y0 - c0.h) < 1e-9, `${c0.kind} ${s0.kind} ${s0.y0}`);
  { // stacking also works with bigger block size
    const g4 = freshGame(); flat(g4); const q4 = g4.players[0]; giveCard(g4, q4, 'concrete-barrier'); giveCard(g4, q4, 'sandbag-barricade'); q4.stats.blockSize = 1.5;
    q4.pos = { x: 0, y: 0, z: 0 }; q4.aim = { x: 0, y: 0, z: 1 }; q4.aimPoint = { x: 0, y: 1, z: 4 }; g4.tryBlock(q4);
    check('stacking works at block size 1.5', Math.abs(g4.barricades[1].y0 - g4.barricades[0].h) < 1e-9, g4.barricades[1].y0);
  }
  g2.damageBarricade(c0, 10000);
  check('stacked wall drops when its base breaks', g2.barricades.length === 1 && g2.barricades[0].y0 === 0);
  // a player can stand on a wall
  const r = g2.players[1]; r.pos = { x: g2.barricades[0].x, y: 3, z: g2.barricades[0].z }; r.vel = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 90; i++) g2.updatePlayer(r, 1 / 60, false);
  check('players can stand on walls', Math.abs(r.pos.y - g2.barricades[0].h) < 0.02, r.pos.y);
}

// Commander mode: cursor input never drives the commanded hero
{
  const g = new Game({ roster: roster(2, { human: true }), settings: { commander: true }, cards }); g.start();
  const p = g.players[0]; const before = { ...p.input };
  g.setInput(p.id, { mx: 1, mz: 0, aim: { x: 0, y: 0, z: -1 }, aimPoint: { x: 9, y: 1, z: 9 }, shoot: true, blockSeq: 99 });
  check('commander: human input ignored', p.input.mx === before.mx && p.input.blockSeq === before.blockSeq && p.input.aim === before.aim);
}

// Saws stick out of the pillar
{
  const g = freshGame(2, { hazards: true }); let tries = 0;
  while ((!g.hazard || g.hazard.type !== 'saws') && tries++ < 200) { g.startRound(); }
  if (g.hazard && g.hazard.type === 'saws') {
    const ok = g.hazard.saws.every(sw => !g.level.solids.some(s => !s.wall && sw.x > s.min.x && sw.x < s.max.x && sw.z > s.min.z && sw.z < s.max.z));
    check('saw hubs sit outside the pillar', ok);
  } else check('saw hazard rolled', false);
}

// Bot pathing: bots take high ground on normal maps and keep moving on lava
{
  let elevated = 0, samples = 0;
  for (let k = 0; k < 4; k++) {
    const g = new Game({ roster: roster(6).map(r => ({ ...r, difficulty: 'hard' })), settings: { mapSource: 'generated', roundsToWin: 99, pickTime: 1 }, cards }); g.start();
    run(g, 40, 1 / 60, gg => { if (gg.phase !== 'play') return; for (const p of gg.players) if (p.alive && p.onGround) { samples++; if (p.pos.y > 0.7) elevated++; } });
  }
  check('bots spend time on raised platforms', elevated / samples > 0.1, (elevated / samples).toFixed(3));
  { // and never get stuck jumping into walls
    let st = 0, n = 0;
    for (let k = 0; k < 3; k++) {
      const g = new Game({ roster: roster(6), settings: { mapSource: 'generated', roundsToWin: 99, pickTime: 1 }, cards }); g.start();
      const still = new Map();
      run(g, 40, 1 / 60, gg => { if (gg.phase !== 'play') return; for (const p of gg.players) { if (!p.alive) continue; n++;
        const sp = Math.hypot(p.vel.x, p.vel.z); still.set(p, sp < 0.5 ? (still.get(p) || 0) + 1 / 60 : 0); if (still.get(p) > 3) st++; } });
    }
    check('bots on normal maps rarely stuck/idle', st / n < 0.02, (st / n).toFixed(3));
  }
  let idle = 0, tot = 0, hops = 0;
  for (let k = 0; k < 4; k++) {
    const g = new Game({ roster: roster(6), settings: { mapSource: 'lava', roundsToWin: 99, pickTime: 1 }, cards }); g.start();
    const last = new Map(), still = new Map();
    run(g, 40, 1 / 60, gg => {
      if (gg.phase !== 'play') return;
      const nodes = navNodes(gg);
      for (const p of gg.players) {
        if (!p.alive) continue;
        tot++;
        const sp = Math.hypot(p.vel.x, p.vel.z);
        still.set(p, sp < 0.5 ? (still.get(p) || 0) + 1 / 60 : 0);
        if (still.get(p) > 3) idle++;           // standing still for more than 3 s straight
        const n = currentNode(p, nodes); if (n && last.get(p) && n !== last.get(p)) hops++; if (n) last.set(p, n);
      }
    });
  }
  check('lava bots rarely stand idle', idle / tot < 0.05, (idle / tot).toFixed(3));
  check('lava bots hop between platforms', hops > 40, hops);
}

// 20 players: full match runs; snapshot carries new fields
{
  const g = new Game({ roster: roster(20, { teams: 2 }), settings: { mode: 'tdm', mapSource: 'mixed', pickTime: 1, hazards: true }, cards }); g.start();
  let err = null; try { run(g, 120); } catch (e) { err = e; console.log(e.stack); }
  const snap = g.snapshot();
  check('20-player TDM runs', !err && g.round >= 2, `round ${g.round}`);
  check('snapshot has block fx + bullet gravity', snap.pl.every(r => r.length === 36 && r[28] > 0));
  const g2 = new Game({ roster: roster(20), settings: { mapSource: 'lava', pickTime: 1 }, cards }); g2.start();
  try { run(g2, 60); } catch (e) { err = e; console.log(e.stack); }
  check('20-player lava FFA runs', !err);
}


// ---------------------------------------------------------------- batch: modes, late joins, practice, tips
const step = (g, secs) => { for (let t = 0; t < secs; t += 1 / 60) g.step(1 / 60); };
const toPicking = (g, losers) => { g.phase = 'play'; g.offerCards(losers); };
// Cursed cards and weapon mods are always offered now, even if old settings say otherwise
{
  const g = new Game({ roster: roster(2), settings: { cursedCards: false, weaponMods: false }, cards }); g.start();
  const pool = g.offerPool(g.players[0]);
  check('cursed cards always in pool', pool.some(c => c.rarity === 'cursed'));
  check('weapon mods always in pool', pool.some(c => c.weaponMod));
  check('lobby defaults no longer carry the toggles', !('cursedCards' in C.DEFAULT_LOBBY_SETTINGS) && !('weaponMods' in C.DEFAULT_LOBBY_SETTINGS));
}
// Speed mode: two picks per phase, a fresh hand after the first
{
  const offers = [];
  const g = new Game({ roster: roster(2, { human: true }), settings: { speed: true, pickTime: 30 }, cards, onOffer: p => offers.push([p.id, p.offer.slice()]) }); g.start();
  const human = g.players[0];
  toPicking(g, [human]);
  check('speed: two picks owed', human.picksLeft === 2 && g.offerInfo(human).total === 2);
  const first = human.offer.slice();
  g.pick(human.id, first[0]); g.takeEvents();
  if (human.awaitCombo) g.comboChoice(human.id, true);
  check('speed: still picking after the first card', g.phase === 'picking' && !human.picked && human.picksLeft === 1);
  check('speed: hand refreshed', offers.length === 2 && human.offer && human.offer.join() !== first.join());
  g.pick(human.id, human.offer[0]);
  if (human.awaitCombo) g.comboChoice(human.id, true);
  check('speed: two cards gained, phase over', human.cards.length >= 1 && g.phase !== 'picking');
  const g2 = new Game({ roster: roster(2), settings: { pickTime: 30 }, cards }); g2.start(); toPicking(g2, [g2.players[0]]);
  check('normal mode: one pick', g2.players[0].picksLeft === 1);
}
// Per-player pick timers auto-pick for humans who run out of time
{
  const g = new Game({ roster: roster(2, { human: true }), settings: { pickTime: 2 }, cards }); g.start();
  const h = g.players[0]; toPicking(g, [h]);
  step(g, 2.5);
  check('pick timer auto-picks', h.picked && h.cards.length === 1, `picked=${h.picked} cards=${h.cards.length} phase=${g.phase}`);
}
// Late joins: new players catch up to the lobby average with 50% more pick time; returning players keep their cards
{
  const g = new Game({ roster: roster(3), settings: { pickTime: 20, mapSource: 'generated' }, cards }); g.start();
  g.players[0].cards = ['big-iron', 'quick-hands', 'bulk-up', 'speed-loader'].filter(id => cardById.has(id)); g.players[1].cards = g.players[0].cards.slice(0, 2); g.players[2].cards = [];
  for (const p of g.players) g.recompute(p);
  const avg = g.averageCards('new1');
  const n = g.addPlayer({ id: 'new1', name: 'New', team: 0, color: '#ffffff' });
  check('late joiner owed the lobby average', n.picksOwed === avg && avg === 2, `owed ${n.picksOwed} avg ${avg}`);
  check('late joiner waits for the next round', !n.alive && 'new1' in g.scores);
  g.phase = 'play'; g.offerCards([g.players[1]]);
  check('late joiner picks at the next phase even when not a loser', n.picksLeft === 2 && n.catchUp && !n.picked);
  check('late joiner gets 50% more time', Math.abs(n.pickT - 30) < 1e-6 && Math.abs(g.players[1].pickT - 20) < 1e-6);
  let guard = 0;
  while (g.phase === 'picking' && guard++ < 20) { for (const p of g.players) { if (p.awaitCombo) g.comboChoice(p.id, true); else if (!p.picked && p.offer) g.pick(p.id, p.offer[0]); } }
  check('late joiner caught up and spawned', n.cards.length >= 1 && g.phase === 'countdown' && n.alive);
  // returning player (new connection id) gets cards and score back
  g.scores.p2 = 3;
  const back = g.addPlayer({ id: 'p2b', name: 'P2', team: 0, color: '#00ff00' }, { cards: ['big-iron'], oldKey: 'p2', score: 3 });
  check('returning player restored', back.cards.includes('big-iron') && back.picksOwed === 0 && g.scores.p2b === 3 && !('p2' in g.scores));
  // same id (Steam) reconnects
  g.removePlayer('p1'); const re = g.reconnect('p1');
  check('reconnect keeps cards', re && re.connected && re.cards.length >= 2);
  // full lobby: a bot gives up its seat at the next round
  const id = g.retireBot(); g.startRound();
  check('bot retires at round start', id && !g.player(id).connected);
  JSON.stringify(g.snapshot());
}
// Practice range: no round end, dummies respawn, cards set freely, god mode, idle dummies don't shoot
{
  const r = [{ id: 'you', name: 'You', team: 0, isBot: false, color: '#ffcf3a', kind: 'hero' },
    ...[1, 2, 3].map(i => ({ id: 'd' + i, name: 'Dummy', team: 1, isBot: true, dummy: true, color: '#cccccc', kind: 'hero' }))];
  const g = new Game({ roster: r, settings: { mode: 'practice', dummyHp: 250, practiceGod: true, dummyMode: 'idle' }, cards }); g.start();
  step(g, 3.2);
  const me = g.player('you'), d = g.player('d1');
  check('practice: dummy health setting', g.maxHp(d) === 250);
  check('practice: setCards', g.practiceSetCards('you', ['big-iron', 'bulk-up', 'not-a-card']) && me.cards.length === 2 && me.stats.health > 100);
  g.hurt(d, 999, me, null);
  check('practice: dummy died', !d.alive);
  g.hurt(me, 9999, d, null);
  check('practice: god mode', me.alive && me.hp >= 1);
  step(g, 2);
  check('practice: dummy respawned, round never ends', d.alive && g.phase === 'play' && g.round === 1);
  let shots = 0; for (let i = 0; i < 300; i++) { g.step(1 / 60); shots += g.takeEvents().filter(e => e.t === 'shoot' && e.p && e.p.startsWith('d')).length; }
  check('practice: idle dummies never shoot', shots === 0);
}
// Stats window data travels with card events
{
  const g = new Game({ roster: roster(2), settings: {}, cards }); g.start(); g.takeEvents();
  g.players[0].offer = ['big-iron']; g.players[0].picked = false; g.players[0].picksLeft = 1; g.phase = 'picking';
  g.pick('p0', 'big-iron');
  const ev = g.takeEvents().find(e => e.t === 'cards');
  check('cards event carries stats', ev && ev.s && ev.s.dmg > C.DEFAULT_STATS.damage && 'bnc' in ev.s && 'regen' in ev.s);
}
// Wave difficulty
{
  const mk = d => { const g = new Game({ roster: roster(3), settings: { mode: 'waves', waveDifficulty: d, roundsToWin: 10 }, cards }); g.round = 5; g.startRound(); return g.gm.budget; };
  check('co-op difficulty scales the Game Master budget', mk('nightmare') > mk('hard') && mk('hard') > mk('normal') && mk('normal') > mk('easy') && mk('brutal') === mk('hard') && mk('relaxed') === mk('easy'));
}
// Lobby color picks
{
  const cols = C.assignColors([{}, { prefColor: C.ART.ffaColors[0] }, { prefColor: C.ART.ffaColors[0] }, {}], 'ffa');
  check('color picks honored, no duplicates', cols[1] === C.ART.ffaColors[0] && new Set(cols).size === 4);
}
// Card tips and color-blind matrix
{
  const { recommend } = await J('synergy.js');
  const by = id => cardById.get(id);
  const owned = ['ricochet-rounds'].map(by).filter(Boolean);
  const offer = ['bulk-up', 'shrapnel-rounds', 'field-rations'].map(by).filter(Boolean);
  const r = recommend(offer, owned);
  check('card tips: ricochet suggests shrapnel', r.best && r.best.id === 'shrapnel-rounds', JSON.stringify(r.best));
  check('card tips: nothing forced with no build', recommend(offer, []).best === null);
  const { daltonMatrix } = await J('a11y.js');
  for (const m of ['protan', 'deutan', 'tritan']) {
    const M = daltonMatrix(m), gray = [0, 1, 2].map(rw => M[rw * 3] + M[rw * 3 + 1] + M[rw * 3 + 2]);
    check('color-blind matrix keeps grays: ' + m, gray.every(v => Math.abs(v - 1) < 0.02), gray.join());
  }
  const { t } = await J('i18n.js');
  check('i18n params', t('Round {n}', { n: 4 }) === 'Round 4');
}
// Speed mode + waves + commander smoke
for (const [label, settings] of [['speed ffa', { speed: true }], ['speed waves', { speed: true, mode: 'waves' }], ['speed tdm', { speed: true, mode: 'tdm' }]]) {
  const g = new Game({ roster: roster(4, { teams: settings.mode === 'tdm' ? 2 : 0 }), settings: { ...settings, pickTime: 2 }, cards }); g.start();
  let err = null; try { run(g, 150); } catch (e) { err = e; console.log(e.stack); }
  check('smoke ' + label, !err && g.round >= 2, `round ${g.round}`);
}


// ---------------------------------------------------------------- batch: speed mode, late joins, practice, lobby rules
const pickAll = g => { for (const p of g.players) if (!p.picked && p.offer) g.pick(p.id, p.offer[0]); };
{ // cursed cards + weapon mods are always offered now (no lobby toggles)
  const g = new Game({ roster: roster(2), settings: { cursedCards: false, weaponMods: false }, cards }); g.start();
  const pool = g.offerPool(g.players[0]);
  check('cursed cards always in pool', pool.some(c => c.rarity === 'cursed'));
  check('weapon mods always in pool', pool.some(c => c.weaponMod));
}
{ // speed mode: two picks per phase, fresh hand after the first
  const offers = [];
  const g = new Game({ roster: roster(2, { human: true }), settings: { speed: true, mapSource: 'generated', pickTime: 30 }, cards, onOffer: p => offers.push([p.id, p.offer.slice()]) });
  g.start(); g.phase = 'play';
  g.endRound('p1'); g.afterRound();
  const me = g.player('p0');
  check('speed: loser picks twice', g.phase === 'picking' && me.picksLeft === 2 && me.picksTotal === 2);
  const first = me.offer.slice(); g.pick('p0', first[0]);
  check('speed: still picking after first card, new hand', g.phase === 'picking' && !me.picked && me.offer && me.picksLeft === 1 && offers.filter(o => o[0] === 'p0').length === 2);
  if (me.awaitCombo) g.comboChoice('p0', false);
  if (me.offer) g.pick('p0', me.offer[0]);
  if (me.awaitCombo) g.comboChoice('p0', false);
  check('speed: two cards gained, phase over', me.cards.length === 2 && g.phase === 'countdown');
  const info = (() => { const g2 = new Game({ roster: roster(2, { human: true }), settings: { speed: true, pickTime: 20 }, cards }); g2.start(); g2.endRound('p1'); g2.afterRound(); return g2.offerInfo(g2.player('p0')); })();
  check('speed: offer info says pick 1 of 2', info.total === 2 && info.left === 2 && info.speed && info.time === 20);
}
{ // per-player pick timers expire independently
  const g = new Game({ roster: roster(3, { human: true }), settings: { pickTime: 2, mapSource: 'generated' }, cards }); g.start();
  g.endRound('p2'); g.afterRound();
  let rounds = g.round; run(g, 3.5);
  check('pick timer auto-picks for an idle human', g.round === rounds + 1 && g.player('p0').cards.length === 1);
}
{ // late joiner: watches this round, owed the lobby's average card count, 50% more pick time, spawns next round
  const g = new Game({ roster: roster(3), settings: { pickTime: 10, mapSource: 'generated' }, cards }); g.start();
  g.players[0].cards = ['big-iron', 'quick-hands', 'fortify'].filter(id => cardById.has(id)); g.players[1].cards = ['big-iron'].filter(id => cardById.has(id)); g.players[2].cards = [];
  for (const p of g.players) g.recompute(p);
  const avg = Math.round((g.players[0].cards.length + g.players[1].cards.length) / 3);
  const n = g.addPlayer({ id: 'late', name: 'Late', team: 0, isBot: false, color: '#fff' });
  check('late join: not alive mid-round', !n.alive);
  check('late join: owed average picks', n.picksOwed === avg, `${n.picksOwed} vs ${avg}`);
  check('late join: has a score entry', 'late' in g.scores);
  g.phase = 'play'; g.endRound('late'); g.afterRound();   // their side "won", so only the catch-up picks apply
  check('late join: picks in the next phase even if not a loser', avg ? (!n.picked && n.picksTotal === avg && n.catchUp) : n.picked, `${n.picksTotal} ${avg}`);
  if (avg) check('late join: 50% more pick time', Math.abs(g.pickLimit(n) - 15) < 1e-6);
  for (let k = 0; k < 10 && g.phase === 'picking'; k++) { pickAll(g); for (const p of g.players) if (p.awaitCombo) g.comboChoice(p.id, false); }
  check('late join: spawns next round', g.phase === 'countdown' && n.alive);
}
{ // returning player gets cards + score back; a full match retires a bot for the newcomer
  const g = new Game({ roster: roster(4), settings: { mapSource: 'generated' }, cards }); g.start();
  const cs = ['big-iron', 'quick-hands'].filter(id => cardById.has(id));
  g.players[1].cards = cs.slice(); g.recompute(g.players[1]); g.scores.p1 = 2;
  g.removePlayer('p1');
  const back = g.addPlayer({ id: 'p1b', name: 'P1', team: 0, isBot: false, color: '#fff' }, { cards: cs, oldKey: 'p1', score: 2 });
  check('rejoin: cards restored, no catch-up picks', back.cards.join() === cs.join() && back.picksOwed === 0);
  check('rejoin: score moved to the new id', g.scores.p1b === 2 && !('p1' in g.scores));
  const re = g.player('p2'); g.removePlayer('p2'); check('reconnect same id', g.reconnect('p2') === re && re.connected);
  const big = new Game({ roster: roster(20), settings: { mapSource: 'generated' }, cards }); big.start();
  const bot = big.retireBot(); big.addPlayer({ id: 'h', name: 'H', team: 0, isBot: false, color: '#fff' });
  big.phase = 'play'; big.startRound();
  check('full match: a bot gives up its seat next round', !big.player(bot).connected && big.heroes().filter(p => p.connected).length === 20);
}
{ // practice range: no round end, respawns, free card edits, dummy behaviors
  const r = [{ id: 'me', name: 'Me', team: 0, isBot: false, color: '#fff', kind: 'hero' },
    ...[1, 2, 3].map(i => ({ id: 'd' + i, name: 'D' + i, team: 1, isBot: true, dummy: true, color: '#ccc', kind: 'hero' }))];
  const g = new Game({ roster: r, settings: { mode: 'practice', dummyMode: 'idle', dummyHp: 500, practiceGod: true, hazards: true, mapSource: 'generated' }, cards }); g.start();
  run(g, 4);
  const d = g.player('d1'), me = g.player('me');
  check('practice: dummy health setting', g.maxHp(d) === 500);
  check('practice: hazards forced off', !g.settings.hazards && !g.hazard);
  const p0 = { ...d.pos }; run(g, 2);
  check('practice: idle dummies stand still', Math.hypot(d.pos.x - p0.x, d.pos.z - p0.z) < 0.3);
  g.hurt(d, 9999, me, null); check('practice: dummy dies', !d.alive);
  run(g, 2); check('practice: dummy respawns', d.alive && d.hp === 500);
  g.hurt(me, 9999, d, null); check("practice: you can't die", me.alive && me.hp >= 1);
  check('practice: setCards', g.practiceSetCards('me', ['big-iron', 'big-iron', 'nope'].filter(x => x === 'nope' || cardById.has(x))) && !me.cards.includes('nope'));
  run(g, 120);
  check('practice: never ends a round or opens picks', g.phase === 'play' && g.round === 1);
  const g2 = new Game({ roster: r, settings: { mode: 'practice', dummyMode: 'fight', mapSource: 'generated' }, cards }); g2.start();
  let shots = 0; run(g2, 15, 1 / 60, gg => { for (const e of gg.events) if (e.t === 'shoot') shots++; });
  const g3 = new Game({ roster: r, settings: { mode: 'practice', dummyMode: 'move', mapSource: 'generated' }, cards }); g3.start();
  let shots3 = 0; for (let k = 0; k < 900; k++) { g3.step(1 / 60); for (const e of g3.takeEvents()) if (e.t === 'shoot' && e.p !== 'me') shots3++; }
  check('practice: "walk around" dummies never shoot', shots3 === 0);
}
{ // wave difficulty, stat summary, colors, synergy, color-blind matrix
  const mk = d => { const g = new Game({ roster: roster(3), settings: { mode: 'waves', waveDifficulty: d, mapSource: 'generated', roundsToWin: 10 }, cards }); g.round = 4; g.startRound(); return g.gm.spent; };
  let ok = true; for (let k = 0; k < 5; k++) if (!(mk('easy') < mk('hard'))) ok = false;
  check('harder co-op difficulty spends more credits', ok);
  const g = new Game({ roster: roster(2), settings: {}, cards }); g.start();
  const s = g.statSummary(g.players[0]);
  check('stat summary has the card-screen stats', ['hp', 'dmg', 'spd', 'bnc', 'regen', 'rate', 'ammo'].every(k => typeof s[k] === 'number') && s.hp === 100);
  const cols = C.assignColors([{}, { prefColor: C.ART.ffaColors[5] }, { prefColor: C.ART.ffaColors[5] }, {}], 'ffa');
  check('picked colors honored, never duplicated', cols[1] === C.ART.ffaColors[5] && new Set(cols).size === 4);
  check('gun skins listed with cube first', Object.keys(C.COSMETICS.gun)[0] === 'cube' && Object.keys(C.COSMETICS.gun).length >= 10);
  const { recommend } = await J('synergy.js');
  const by = id => cardById.get(id);
  const owned = cards.filter(c => c.modifiers.some(m => m.stat === 'bounces' && m.value > 0) && c.rarity !== 'cursed').slice(0, 1);
  const homing = cards.find(c => c.modifiers.some(m => m.stat === 'homing' && m.value > 0) && c.rarity !== 'cursed' && !c.combo);
  const plain = cards.find(c => c.modifiers.length === 1 && c.modifiers[0].stat === 'moveSpeed' && c.rarity !== 'cursed');
  if (owned.length && homing && plain) { const r = recommend([plain, homing], owned); check('card tips: homing suggested for a bounce build', r.best && r.best.id === homing.id); }
  const { daltonMatrix } = await J('a11y.js');
  const m = daltonMatrix('deutan');
  check('color-blind matrix keeps white white', m && Math.abs(m[0] + m[1] + m[2] - 1) < 0.02 && Math.abs(m[3] + m[4] + m[5] - 1) < 0.02 && Math.abs(m[6] + m[7] + m[8] - 1) < 0.02);
}

// ================================================================ batch: cursed/holy, mods, shield mods, bounce, ring, tank
{
  // Cursed: 3x upside, 5x downside, drain + life drain
  const ck = cardById.get('cursed-heavy-slugs'), val = st => (ck.modifiers.find(m => m.stat === st) || { value: 0 }).value;
  check('cursed: 3x upside (damage 1.7 -> 3.1)', Math.abs(val('damage') - 3.1) < 1e-9, val('damage'));
  check('cursed: 3x upside (size 1.4 -> 2.2)', Math.abs(val('bulletSize') - 2.2) < 1e-9, val('bulletSize'));
  check('cursed: 5x downside (fire rate 0.75 -> 0.75^5)', Math.abs(val('fireRate') - Math.round(0.75 ** 5 * 1000) / 1000) < 1e-9, val('fireRate'));
  check('cursed: add stats 3x/5x', Math.abs(cardById.get('cursed-padded-vest').modifiers.find(m => m.stat === 'health' && m.op === 'add').value - 75) < 1e-9);
  check('cursed: self drain (life drain is its own card now)', val('drain') > 0);
  const bases = cards.filter(c => !['cursed', 'holy', 'mod', 'shieldmod', 'combo'].includes(c.rarity) && !c.special && !c.weaponMod && !c.shieldMod);
  const missing = bases.filter(c => !cardById.has('cursed-' + c.id)).map(c => c.id);
  check('cursed version for every regular card (incl. upside-only, unit and convert cards)', !missing.length && cardById.has('cursed-big-iron') && cardById.has('cursed-twin-protocol') && cardById.has('cursed-scp'), missing.join(','));
  check('no cursed/holy for mods or specials (combos get variants since v14)', !cards.some(c => (c.rarity === 'cursed' || c.rarity === 'holy') && (c.weaponMod || c.shieldMod || c.special)));
  check('cursed odds raised a little', C.CURSED_ODDS > 0.03 && C.CURSED_ODDS <= 0.06);
  // Holy: upside, no downside
  const hk = cardById.get('holy-heavy-slugs');
  check('holy keeps the upsides, doubled', hk && hk.modifiers.some(m => m.stat === 'damage' && m.value === 2.4) && hk.modifiers.some(m => m.stat === 'bulletSize' && m.value === 1.8));
  check('holy uses holyDescription and no stock prefix', hk && hk.description === 'Big, painful rounds.' && !/upside/i.test(hk.description));
  check('cursed description has no stock prefix', !cards.some(c => c.rarity === 'cursed' && /3x the upside/.test(c.description || '')));
  check('mods keep full text in details', cards.filter(c => c.weaponMod || c.shieldMod).every(c => c.details && !/^(WEAPON|SHIELD) MOD/.test(c.description)));
  check('holy drops the downsides', hk && !hk.modifiers.some(m => m.stat === 'fireRate'));
  check('holy for every regular card, without its downsides', cardById.has('holy-padded-vest') && cardById.has('holy-glass-core') && !cardById.get('holy-glass-core').modifiers.some(m => m.stat === 'health'));
  // Holy/cursed exclusive per player
  const g = freshGame(); const p = g.players[0];
  giveCard(g, p, 'holy-heavy-slugs');
  let pool = g.offerPool(p);
  check('holding holy blocks cursed + Regretful Pact', !pool.some(c => c.rarity === 'cursed' || c.special === 'regretfulPact') && pool.some(c => c.rarity === 'holy'));
  p.cards = ['cursed-heavy-slugs']; g.recompute(p); pool = g.offerPool(p);
  check('holding cursed blocks holy', !pool.some(c => c.rarity === 'holy') && pool.some(c => c.rarity === 'cursed'));
  p.cards = ['regretful-pact']; p.pact = true; g.recompute(p);
  let anyHoly = false; for (let i = 0; i < 300; i++) if (g.makeOffer(p).some(id => cardById.get(id).rarity === 'holy')) anyHoly = true;
  check('Regretful Pact counts as cursed (no holy offers)', !anyHoly);
  p.cards = ['holy-heavy-slugs']; p.pact = false; g.recompute(p);
  g.phase = 'picking'; p.picked = false; p.offer = ['cursed-glass-core']; check('pick refuses a cursed card while holding holy', !g.pick(p.id, 'cursed-glass-core'));
}
{
  // Mod odds and pool sizes
  const wm = cards.filter(c => c.weaponMod), sm = cards.filter(c => c.shieldMod), leg = cardById.get('hydra-rounds');
  check('weapon mods weigh the same as legendary cards', wm.every(c => cardWeight(c) === cardWeight(leg)), wm.map(c => cardWeight(c)).join(','));
  check('shield mods weigh the same as legendary cards', sm.every(c => cardWeight(c) === cardWeight(leg)));
  check('11 shield mods (Sacred Grove, Space King, Gun Nest added), 8 weapon mods (Tiny Tank and Katana are weapon mods)', sm.length === 11 && wm.length === 8, `${sm.length} ${wm.length}`);
  check('more common cards', cards.filter(c => c.rarity === 'common').length >= 21);
  const g = freshGame(); const p = g.players[0]; giveCard(g, p, 'shield-clone'); giveCard(g, p, 'shield-turret');
  g.phase = 'picking'; p.picked = false; p.offer = ['shield-pillar']; g.pick(p.id, 'shield-pillar');
  check('one shield mod at a time', p.cards.filter(id => cardById.get(id).shieldMod).length === 1 && p.smod === 'pillar');
  check('held shield mod not re-offered', !g.offerPool(p).some(c => c.id === 'shield-pillar'));
}
{
  // Critter weapon mod
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const q of g.players.slice(2)) q.alive = false;
  giveCard(g, p, 'rapid-cycler'); giveCard(g, p, 'mod-critter');
  check('critter: fire rate reset to 1 when taken', p.stats.fireRate === 1 && p.mod === 'critter');
  giveCard(g, p, 'rapid-cycler'); check('critter: later fire-rate cards still apply', Math.abs(p.stats.fireRate - 1.6) < 1e-9);
  p.pos = { x: -8, y: 0, z: 0 }; e.pos = { x: 6, y: 0, z: 0 }; p.aim = { x: 1, y: 0, z: 0 }; p.fireT = 0; p.ammo = 3;
  g.tryShoot(p);
  const c = g.players.find(u => u.kind === 'critter' && u.ownerId === p.id);
  check('critter: spawned in your color', c && c.color === p.color);
  check('critter: speed = 60% of bullet speed (10..24)', c && Math.abs(c.stats.moveSpeed * C.speedFor(c.fixedSize) - Math.min(24, Math.max(10, p.stats.bulletSpeed * 0.6))) < 1e-9);
  check('critter: bite = bullet damage', c && Math.abs(c.melee - g.effDamage(p.stats)) < 1e-9);
  check('critter: health = 10% of yours', c && Math.abs(c.stats.health - 0.1 * g.maxHp(p)) < 1e-9);
  e.isBot = false;   // target stands still: this checks the bite, not a shootout
  const hp0 = e.hp; let reached = false;
  for (let i = 0; i < 240 && e.hp === hp0; i++) { g.step(1 / 60); g.takeEvents(); p.input.shoot = false; }
  check('critter runs at the enemy and bites', e.hp < hp0, `${hp0} -> ${e.hp}`);
  for (let i = 0; i < CRITTER_MAX + 2; i++) { p.fireT = 0; p.ammo = 3; p.reloadT = 0; g.tryShoot(p); }
  check('critters capped at CRITTER_MAX per player', g.players.filter(u => u.kind === 'critter' && u.alive).length <= CRITTER_MAX);
}
{
  // Clone shield mod
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const q of g.players.slice(2)) q.alive = false;
  giveCard(g, p, 'sandbag-barricade'); giveCard(g, p, 'shield-clone'); giveCard(g, p, 'phoenix-protocol');
  check('clone: long block cooldown', p.stats.blockCooldown > 10);
  p.pos = { x: 0, y: 0, z: 0 }; p.aim = { x: 1, y: 0, z: 0 }; p.blockCdT = 0; g.tryBlock(p);
  const clone = g.players.find(u => u.kind === 'clone' && u.ownerId === p.id);
  check('clone: block spawns a clone with your stats', clone && clone.stats.health === p.stats.health && clone.stats.damage === p.stats.damage);
  check('clone: no bubble and no block effects', p.blockT <= 0 && g.barricades.length === 0);
  g.hurt(p, 9999, e, null);
  check('clone: dying moves you into the clone', p.alive && !clone.alive && Math.hypot(p.pos.x - clone.pos.x, p.pos.z - clone.pos.z) < 1e-6);
  check('clone: Phoenix not used while a clone was up', !p.fx.revived && !p.reviving);
  p.fx.invulnT = 0; g.hurt(p, 9999, e, null);
  check('clone: Phoenix triggers on the last body', p.reviving && p.fx.revived);
}
{
  // Turret shield mod
  const g = freshGame(); flat(g); const p = g.players[0];
  giveCard(g, p, 'shield-turret'); giveCard(g, p, 'echo-shield'); giveCard(g, p, 'sandbag-barricade');
  p.pos = { x: 0, y: 0, z: 0 }; p.aim = { x: 0, y: 0, z: 1 }; p.aimPoint = { x: 0, y: 1, z: 5 }; p.blockCdT = 0; g.tryBlock(p);
  const t = g.players.find(u => u.kind === 'blockTurret');
  check('turret: block places a turret', !!t && t.ownerId === p.id && t.color === p.color);
  check('turret: echo blocks = shots per volley', t && t.stats.projectiles === 1 + Math.round(p.stats.blockEcho));
  check('turret: echoes 5 s apart', JSON.stringify(p.fx.echoQueue) === JSON.stringify([5]));
  const w = g.barricades[0];
  check('turret: sits just past the wall, never inside it', t && w && t.pos.z > w.z + w.th / 2 && !w.solids.some(s => t.pos.x + 0.3 > s.min.x && t.pos.x - 0.3 < s.max.x && t.pos.z + 0.3 > s.min.z && t.pos.z - 0.3 < s.max.z));
  check('turret: block cooldown raised', p.stats.blockCooldown > C.DEFAULT_STATS.blockCooldown * 1.4);
  const big = freshGame(); const q = big.players[0]; giveCard(big, q, 'shield-turret'); giveCard(big, q, 'big-bubble'); giveCard(big, q, 'long-guard'); q.blockCdT = 0; big.tryBlock(q);
  const t2 = big.players.find(u => u.kind === 'blockTurret');
  check('turret: block size/duration scale health and lifetime', t2.stats.health > t.stats.health && t2.lifeT > t.lifeT);
  run(g, 1); check('turret: stays put', t.alive && t.stats.moveSpeed === 0);
}
{
  // Pillar shield
  const g = freshGame(); flat(g); const [p, a] = g.players; for (const q of g.players.slice(2)) q.alive = false;
  p.isBot = false; a.isBot = false;   // nobody walks or shoots on their own here
  giveCard(g, p, 'shield-pillar'); p.pos = { x: 0, y: 0, z: 0 }; a.pos = { x: 9, y: 0, z: 0 }; p.blockCdT = 0; g.tryBlock(p);
  check('pillar: no timed bubble, a pillar instead', p.blockT <= 0 && g.barricades.some(b => b.kind === 'pillar'));
  for (let i = 0; i < 40; i++) { g.step(1 / 60); g.takeEvents(); }
  check('pillar raises you up', p.pos.y > 1.8, p.pos.y);
  const box = () => g.shields.find(s => s.box && s.owner === p.id);
  const pil = g.barricades.find(b => b.kind === 'pillar');
  const PS = (await J('sim.js')).PILLAR_SHIELD;
  check('pillar shield: a separate square box with PILLAR_SHIELD hp, not a personal bubble', box() && box().hp === PS && !g.shielded(p) && g.pillarFrac(p) === 1);
  check('pillar is taller and wider', pil.hMax > 2.7 && pil.len >= 1.7, `${pil.hMax} ${pil.len}`);
  check('pillar shield lines up with the pillar walls and covers you on top', box() && Math.abs(box().x - pil.x) < 1e-9 && Math.abs(box().w - (pil.len + 0.4)) < 1e-9 && box().w === box().d && box().y0 + box().h > p.pos.y + 1.8);
  run(g, 20); check('pillar shield has no timer', box() && box().hp === PS);
  for (let i = 0; i < Math.ceil(PS / 25); i++) { const b = g.spawnBullet(a, { x: p.pos.x + 1.6, y: p.pos.y + 0.8, z: 0 }, { x: -1, y: 0, z: 0 }, 28, false); b.grav = 0; b.dmg = 25; for (let k = 0; k < 8; k++) g.updateBullets(1 / 60); }
  g.updateShields(1 / 60);
  check('pillar shield soaks hits until its pool is gone', !box() && p.hp === g.maxHp(p) && g.pillarFrac(p) === -1, `${box() && box().hp} ${p.hp}`);
  // The pillar box protects whoever stands inside from outside blasts, not the owner once they step out
  g.tryBlock(Object.assign(p, { blockCdT: 0 })); run(g, 1);
  const hp1 = p.hp; g.explode({ x: pil.x + box().w / 2 + 0.5, y: p.pos.y + 1, z: 0 }, 40, a, {});
  check('pillar box stops an outside explosion', p.hp === hp1 && box().hp < box().maxHp, `${hp1} -> ${p.hp}`);
  p.pos = { x: pil.x + 6, y: 0, z: 0 }; const hp2 = p.hp; g.explode({ x: p.pos.x + 1, y: 0.8, z: 0 }, 40, a, {});
  check('pillar shield is tied to the pillar: off it you take damage', p.hp < hp2);
  g.tryBlock(Object.assign(p, { blockCdT: 0 }));
  check('blocking again replaces the pillar and its shield', g.barricades.filter(b => b.kind === 'pillar' && b.owner === p.id).length === 1 && g.shields.filter(s => s.box && s.owner === p.id).length === 1);
}
{
  // Rewind blink
  const g = freshGame(); flat(g); const p = g.players[0]; giveCard(g, p, 'shield-rewind'); giveCard(g, p, 'phase-step');
  p.pos = { x: -6, y: 0, z: 0 }; p.input.mx = 1;
  const RT = (await J('sim.js')).REWIND_T;
  for (let i = 0; i < 60 * (RT + 0.5); i++) { p.input.mx = 1; g.updatePlayer(p, 1 / 60, true); g.time += 1 / 60; }
  const was = p.fx.hist.find(h => h.t >= g.time - RT - 0.05);
  const xNow = p.pos.x; p.blockCdT = 0; g.tryBlock(p);
  check('rewind: blinks back REWIND_T s', was && Math.abs(p.pos.x - was.x) < 0.5 && xNow - p.pos.x > 5, `${was && was.x} -> ${p.pos.x} (was ${xNow})`);
  check('rewind: short shield on landing, no dash', p.blockT > 0 && Math.abs(p.vel.x) < 1e-9);
}
{
  // Bullet catcher
  const g = freshGame(); flat(g); const [q, a] = g.players; for (const o of g.players.slice(2)) o.alive = false;
  giveCard(g, q, 'shield-catcher'); q.pos = { x: 0, y: 0, z: 0 }; a.pos = { x: 8, y: 0, z: 0 }; q.blockCdT = 0; g.tryBlock(q);
  const b = g.spawnBullet(a, { x: 3, y: 0.8, z: 0 }, { x: -1, y: 0, z: 0 }, 28, false); b.grav = 0; const d0 = b.dmg;
  for (let i = 0; i < 10; i++) g.updateBullets(1 / 60);
  check('catcher: bullet caught and held', b.alive && b.caught === q);
  q.blockT = 0; g.updateBullets(1 / 60);
  check('catcher: released at the enemy with the damage bonus', b.owner === q.id && b.vel.x > 10 && Math.abs(b.dmg - d0 * (await J('sim.js')).CATCHER.dmgMul) < 1e-9, `${b.vel.x} ${b.dmg}`);
}
{
  // Ground slam
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const o of g.players.slice(2)) o.alive = false;
  giveCard(g, p, 'shield-slam'); p.pos = { x: 0, y: 0, z: 0 }; e.pos = { x: 2, y: 0, z: 0 }; const hp0 = e.hp; p.blockCdT = 0; p.onGround = true; g.tryBlock(p);
  check('slam: launches you', p.vel.y >= 13);
  for (let i = 0; i < 120; i++) { g.updatePlayer(p, 1 / 60, true); g.time += 1 / 60; }
  check('slam: landing shockwave hurts and throws enemies', e.hp < hp0 && Math.hypot(e.vel.x, e.vel.z) > 3, `${hp0} -> ${e.hp}`);
}
{
  // Bounce cards
  const mk = (cardsList) => { const g = freshGame(); flat(g); const [a, t] = g.players; for (const o of g.players.slice(2)) o.alive = false; for (const id of cardsList) giveCard(g, a, id); a.pos = { x: 0, y: 0, z: -6 }; t.pos = { x: 6, y: 0, z: 4 }; return { g, a, t }; };
  { const { g, a } = mk(['bank-shot']); const b = g.spawnBullet(a, { x: 0, y: 0.5, z: 0 }, { x: 0, y: -1, z: 0 }, 20, false); g.updateBullets(1 / 60); g.updateBullets(1 / 60);
    check('bank shot: re-aims at the enemy after a bounce', b.bounced && b.vel.x > 5 && b.vel.z > 3, JSON.stringify(b.vel)); }
  { const { g, a } = mk(['rebound-charge']); let booms = 0; const b = g.spawnBullet(a, { x: 0, y: 0.5, z: 0 }, { x: 0, y: -1, z: 0 }, 20, false); g.updateBullets(1 / 60); g.updateBullets(1 / 60);
    for (const ev of g.takeEvents()) if (ev.t === 'boom') booms++; check('rebound charge: explodes on bounce', booms >= 1 && b.alive); }
  { const { g, a } = mk(['splinter-bounce']); const b = g.spawnBullet(a, { x: 0, y: 0.5, z: 0 }, { x: 0.3, y: -1, z: 0 }, 20, false); const n0 = g.bullets.length; g.updateBullets(1 / 60); g.updateBullets(1 / 60);
    check('splinter bounce: splits on bounce', g.bullets.length === n0 + 1 && g.bullets.some(x => x.splitChild && Math.abs(x.dmg - b.dmg * 0.6) < 1e-9)); }
  { const { g, a } = mk(['kinetic-rebound']); const b = g.spawnBullet(a, { x: 0, y: 0.5, z: 0 }, { x: 0, y: -1, z: 0 }, 20, false); const d0 = b.dmg; g.updateBullets(1 / 60); g.updateBullets(1 / 60);
    check('kinetic rebound: +25% damage per bounce', Math.abs(b.dmg - d0 * 1.25) < 1e-9); }
  const tsc = cardById.get('trick-shot');
  check('Trick Shot combo = Bank Shot + Ricochet Rounds', tsc && tsc.combo.includes('bank-shot') && tsc.combo.includes('ricochet-rounds'));
}
{
  // Saturn Rounds ring
  const shot = (ring) => { const g = freshGame(); flat(g); const [a, t] = g.players; for (const o of g.players.slice(2)) o.alive = false; if (ring) giveCard(g, a, 'saturn-rounds');
    a.pos = { x: -8, y: 0, z: 0 }; t.pos = { x: 0, y: 0, z: 0.85 }; const hp0 = t.hp;
    const b = g.spawnBullet(a, { x: -5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 28, false); b.grav = 0;
    for (let i = 0; i < 40; i++) g.updateBullets(1 / 60); return t.hp < hp0; };
  check('saturn: ring hits a player the bullet would miss', shot(true) && !shot(false));
  const g = freshGame(); flat(g); const a = g.players[0]; giveCard(g, a, 'saturn-rounds');
  g.level.solids.push({ min: { x: -1, y: 0, z: 0.4 }, max: { x: 1, y: 3, z: 1 } }); g.refreshSolids();
  const b = g.spawnBullet(a, { x: -4, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 28, false); b.grav = 0;
  for (let i = 0; i < 20; i++) g.updateBullets(1 / 60);
  check('saturn: ring passes walls (not a physical hitbox)', b.alive && b.pos.x > 1);
}
{
  // Tiny Tank
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const o of g.players.slice(2)) o.alive = false;
  giveCard(g, p, 'tiny-tank');
  check('tank: no jumping, slower', p.stats.jump === 0 && p.stats.moveSpeed < C.DEFAULT_STATS.moveSpeed);
  p.onGround = true; p.input.jump = true; g.updatePlayer(p, 1 / 60, true); check('tank: jump input does nothing', p.vel.y <= 0);
  p.input.jump = false;
  const snap = g.snapshot(); check('snapshot flags the tank', (snap.pl.find(r => r[0] === p.id)[29] & 1) === 1);
  giveCard(g, p, 'mod-riot-shield');
  check('tank and Riot Shield can\'t be held together (both weapon mods)', p.mod === 'shield' && !(p.stats.tank > 0) && p.stats.jump > 0);
}
{
  // Life drain (cursed)
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const o of g.players.slice(2)) o.alive = false;
  giveCard(g, p, 'drain-life'); p.pos = { x: 0, y: 0, z: 0 }; e.pos = { x: 4, y: 0, z: 0 }; p.hp = 50; const eh = e.hp;
  for (let i = 0; i < 60; i++) { g.updatePlayer(p, 1 / 60, true); g.time += 1 / 60; }
  check('life drain: siphons from a nearby enemy', e.hp < eh - 2 && p.hp > 50 - 0.06 * g.maxHp(p), `${eh}->${e.hp} me ${p.hp}`);
  e.pos = { x: 12, y: 0, z: 0 }; p.fx.drainScan = 0; const eh2 = e.hp; for (let i = 0; i < 30; i++) { g.updatePlayer(p, 1 / 60, true); g.time += 1 / 60; }
  check('life drain: only within 8 m', e.hp === eh2);
}
{
  // Stability: bots loaded with every new card kind
  const fresh = ['bank-shot', 'rebound-charge', 'kinetic-rebound', 'splinter-bounce', 'saturn-rounds', 'tiny-tank', 'mod-critter', 'shield-clone', 'shield-turret', 'shield-pillar', 'shield-rewind', 'shield-catcher', 'shield-slam', 'holy-heavy-slugs', 'cursed-rapid-cycler', 'mod-riot-shield', 'echo-shield', 'sandbag-barricade', 'concrete-barrier', 'phoenix-protocol', 'ricochet-rounds'];
  for (const [label, settings, n] of [['ffa', {}, 8], ['tdm', { mode: 'tdm' }, 8], ['waves', { mode: 'waves' }, 4], ['lava', { mapSource: 'lava' }, 6]]) {
    const g = new Game({ roster: roster(n, { teams: settings.mode === 'tdm' ? 2 : 0 }), settings: { mapSource: 'mixed', pickTime: 1, ...settings }, cards }); g.start();
    g.players.forEach((p, i) => { p.cards = [fresh[i % fresh.length], fresh[(i * 3 + 5) % fresh.length], fresh[(i * 7 + 2) % fresh.length]].filter((x, k, arr) => arr.indexOf(x) === k); g.recompute(p); });
    let err = null; const kinds = new Set();
    try { run(g, 90, 1 / 60, gg => { for (const p of gg.players) { kinds.add(p.kind); if (!isFinite(p.pos.x + p.pos.y + p.pos.z + p.hp)) throw new Error('NaN ' + p.id + ' ' + p.kind); } }); } catch (e) { err = e; console.log(e.stack); }
    check('new cards stable in bot matches: ' + label, !err && g.round >= 1, err && err.message);
    JSON.stringify(g.snapshot());
  }
}


// ================= batch: riot shield, pillar, deploy layout, critters, co-op keep playing
{
  // Riot shield: wave = bullets per shot, +1 per step held, max +5; inherits bullet effects
  const { RIOT } = await J('sim.js');
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const o of g.players.slice(2)) o.alive = false;
  p.isBot = false; e.isBot = false;
  giveCard(g, p, 'mod-riot-shield'); giveCard(g, p, 'twin-barrel'); giveCard(g, p, 'ricochet-rounds'); giveCard(g, p, 'incendiary-rounds');
  p.pos = { x: 0, y: 0, z: 0 }; p.aim = { x: 1, y: 0, z: 0 }; e.pos = { x: 12, y: 0, z: 0 };
  const base = Math.round(p.stats.projectiles);
  p.ammo = p.stats.ammo; p.reloadT = 0; p.fireT = 0;
  p.input.shoot = true; g.updateShieldGun(p, 1 / 60, true); p.input.shoot = false; g.updateShieldGun(p, 1 / 60, true);
  check('riot: a tap fires your bullets-per-shot', g.bullets.length === base, `${g.bullets.length} vs ${base}`);
  const b0 = g.bullets[0];
  check('riot: wave bullets keep bullet effects', b0 && b0.bLeft === Math.round(p.stats.bounces) && b0.bLeft > 0 && b0.ignite === p.stats.ignite && !b0.pierce && Math.abs(b0.dmg - g.effDamage(p.stats)) < 1e-9);
  g.bullets = []; p.ammo = p.stats.ammo; p.fireT = 0;
  p.input.shoot = true; for (let i = 0; i < 300; i++) g.updateShieldGun(p, 1 / 60, true); p.input.shoot = false; g.updateShieldGun(p, 1 / 60, true);
  check('riot: holding adds at most 5', g.bullets.length === base + 5, g.bullets.length);
  g.bullets = []; p.ammo = p.stats.ammo; p.fireT = 0;
  p.input.shoot = true; for (let i = 0; i < Math.round(RIOT.step * 2 * 60) + 2; i++) g.updateShieldGun(p, 1 / 60, true); p.input.shoot = false; g.updateShieldGun(p, 1 / 60, true);
  check('riot: partial hold adds partial bullets', g.bullets.length === base + 2, g.bullets.length);
  // shield blocks frontal bullets at the shield surface, reflects them, breaks after RIOT.hits
  g.bullets = []; p.fx.riotHits = RIOT.hits; p.fx.shieldBrokenT = 0; const hp0 = p.hp;
  let reflected = 0;
  for (let i = 0; i < RIOT.hits; i++) {
    const b = g.spawnBullet(e, { x: 4, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, 28, false); b.grav = 0;
    for (let k = 0; k < 30 && b.owner === e.id && b.alive; k++) { g.updateBullets(1 / 60); g.time += 1 / 60; }
    if (b.owner === p.id && b.vel.x > 0) reflected++;
    g.bullets = [];
  }
  check('riot: blocks and reflects frontal bullets', reflected === RIOT.hits && p.hp === hp0, `${reflected} hp ${p.hp}`);
  check('riot: breaks (red) after its hits', p.fx.shieldBrokenT > g.time && g.riotFrac(p) === 0);
  const b = g.spawnBullet(e, { x: 4, y: 1, z: 0 }, { x: -1, y: 0, z: 0 }, 28, false); b.grav = 0;
  for (let k = 0; k < 30 && b.alive; k++) g.updateBullets(1 / 60);
  check('riot: broken shield lets bullets through', p.hp < hp0);
  g.time = p.fx.shieldBrokenT + 0.01; g.updateShieldGun(p, 1 / 60, true);
  check('riot: recharges to full', g.riotFrac(p) === 1);
  const hp1 = p.hp, bb = g.spawnBullet(e, { x: -4, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 28, false); bb.grav = 0;
  for (let k = 0; k < 30 && bb.alive; k++) g.updateBullets(1 / 60);
  check('riot: does not block from behind', p.hp < hp1);
  const snap = g.snapshot(); check('snapshot carries shield fraction', snap.pl.find(r => r[0] === p.id)[30] === 1);
}
{
  // Deploy layout: turret nearest, then walls, then mines; all at fixed distances regardless of aim point
  const g = freshGame(); flat(g); const p = g.players[0]; for (const o of g.players.slice(1)) o.alive = false;
  giveCard(g, p, 'shield-turret'); giveCard(g, p, 'concrete-barrier'); giveCard(g, p, 'mine-layer');
  p.pos = { x: 0, y: 0, z: 0 }; p.aim = { x: 0, y: 0, z: 1 }; p.aimPoint = { x: 6, y: 1, z: 9 }; p.blockCdT = 0; g.tryBlock(p);
  const t = g.players.find(u => u.kind === 'blockTurret'), w = g.barricades[0], m = g.mines[0];
  check('deploy order: wall < turret < mines', t && w && m && t.pos.z > w.z + w.th / 2 && m.z > t.pos.z, `${t && t.pos.z} ${w && w.z} ${m && m.z}`);
  check('deploy: straight ahead, ignores aim point', Math.abs(w.x) < 1e-6 && Math.abs(t.pos.x) < 0.05);
  const g2 = freshGame(); flat(g2); const q = g2.players[0]; giveCard(g2, q, 'concrete-barrier');
  q.pos = { x: 0, y: 0, z: 0 }; q.aim = { x: 0, y: 0, z: 1 }; q.aimPoint = { x: 0, y: 1, z: 9 }; g2.tryBlock(q);
  check('deploy: more kinds push further out', g2.mines.length === 0 && m.z > g2.barricades[0].z + 1, `${g2.barricades[0].z} vs ${w.z}`);
  check('concrete is a taller slab', g2.barricades[0].h >= 1.5);
  const g3 = freshGame(); flat(g3); const r = g3.players[0]; giveCard(g3, r, 'bastion-wall'); giveCard(g3, r, 'shield-turret');
  r.pos = { x: 0, y: 0, z: 0 }; r.aim = { x: 0, y: 0, z: 1 }; r.blockCdT = 0; g3.tryBlock(r);
  const t3 = g3.players.find(u => u.kind === 'blockTurret');
  check('deploy: turret behind the Bastion wall', t3 && g3.shields[0] && t3.pos.z < g3.shields[0].z, `${t3 && t3.pos.z} ${g3.shields[0] && g3.shields[0].z}`);
}
{
  // Critters keep a distance and still bite
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const o of g.players.slice(2)) o.alive = false;
  e.isBot = false; giveCard(g, p, 'mod-critter'); p.pos = { x: -6, y: 0, z: 0 }; e.pos = { x: 4, y: 0, z: 0 }; p.aim = { x: 1, y: 0, z: 0 };
  g.spawnCritter(p, 0); const c = g.players.find(u => u.kind === 'critter');
  const hp0 = e.hp; let minD = 99;
  for (let i = 0; i < 300; i++) { g.step(1 / 60); g.takeEvents(); if (c.alive) minD = Math.min(minD, Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z)); }
  check('critter does not clip into feet', minD > C.RULES.playerRadius * (c.size + e.size) + 0.2, minD);
  check('critter still bites from range', e.hp < hp0, `${hp0} -> ${e.hp}`);
}
{
  // Co-op: waves end in victory at the target, and Keep playing works after a win and after a wipe
  const g = new Game({ roster: roster(2), settings: { mode: 'waves', roundsToWin: 2, pickTime: 2 }, cards }); g.start();
  const heroes = () => g.players.filter(p => p.kind === 'hero');
  const clearWave = () => { g.phase = 'play'; if (g.gm) g.gm.queue = []; for (const p of g.players) if (p.transient) p.alive = false; g.checkRoundEnd(); g.afterRound(); };
  clearWave(); check('waves: card pick after clearing a wave', g.phase === 'picking');
  g.startRound(); clearWave();
  check('waves: victory after surviving the target', g.phase === 'over' && g.winner === 'players');
  check('waves: keep playing after a win', g.extend(3) && g.settings.roundsToWin === 5 && g.phase === 'picking');
  g.startRound(); const rd = g.round; g.phase = 'play'; for (const p of heroes()) p.alive = false; g.checkRoundEnd(); g.afterRound();
  check('waves: first wipe spends the loss token and retries', g.phase !== 'over' && g.lossTokens === 0);
  g.phase = 'play'; for (const p of heroes()) p.alive = false; g.checkRoundEnd(); g.afterRound();
  check('waves: second wipe ends the match', g.phase === 'over' && g.winner === 'waves');
  check('waves: no extending after a loss (only after a win)', !g.extend(1));
}

// ---------------------------------------------------------------- batch: mods, shields, bullets, healing
{
  // One weapon mod and one shield mod at a time, on every path (practice add, restore, raw card lists)
  const g = freshGame(2, { mode: 'practice' }); const p = g.players[0];
  g.practiceSetCards(p.id, ['mod-scattergun', 'shield-turret', 'heavy-slugs', 'mod-critter', 'shield-pillar', 'tiny-tank']);
  const mods = p.cards.filter(id => g.cardById.get(id).weaponMod), smods = p.cards.filter(id => g.cardById.get(id).shieldMod);
  check('one weapon mod + one shield mod (newest kept)', mods.length === 1 && mods[0] === 'tiny-tank' && smods.length === 1 && smods[0] === 'shield-pillar' && p.cards.includes('heavy-slugs'), p.cards.join(','));
  check('Tiny Tank is a weapon mod', p.mod === 'tank' && p.stats.tank > 0 && p.stats.jump === 0);
  const q = g.players[1]; q.cards = ['mod-beam-rifle', 'mod-grenade-launcher']; g.recompute(q);
  check('raw duplicate mods collapse on recompute', q.cards.length === 1 && q.mod === 'grenade');
}
{
  // Tiny Tank shoots normal bullets (not a mod pattern), and taking another weapon mod removes it
  const g = freshGame(); flat(g); const p = g.players[0];
  giveCard(g, p, 'tiny-tank'); p.fireT = 0; p.ammo = 3; p.reloadT = 0; g.tryShoot(p);
  check('tank fires your normal bullets', g.bullets.length === Math.round(p.stats.projectiles) && g.bullets[0].owner === p.id);
  g.phase = 'picking'; p.picked = false; p.offer = ['mod-scattergun']; g.pick(p.id, 'mod-scattergun');
  check('picking another weapon mod replaces the tank', p.mod === 'scattergun' && !p.cards.includes('tiny-tank') && !(p.stats.tank > 0));
}
{
  // Scattergun: 10 pellets per shot, much more per-shot damage than the old 8 x 30%
  const g = freshGame(); flat(g); const p = g.players[0]; giveCard(g, p, 'mod-scattergun');
  p.fireT = 0; p.ammo = 3; p.reloadT = 0; g.tryShoot(p);
  const tot = g.bullets.reduce((a, b) => a + b.dmg, 0), base = g.effDamage(p.stats);
  check('scattergun: 10 pellets, 3.2x damage per shot', g.bullets.length === 10 && Math.abs(tot / base - 3.2) < 1e-6, `${g.bullets.length} ${tot / base}`);
  check('scattergun: tight cone (all within 0.25 rad of aim)', g.bullets.every(b => { const d = Math.atan2(b.vel.z, b.vel.x) - Math.atan2(p.aim.z, p.aim.x); return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 0.25; }));
}
{
  // Critters: max-critters notice goes only to the shooter, counted per player
  const g = freshGame(3); flat(g); const [p, q] = g.players; for (const o of g.players) o.isBot = false;
  giveCard(g, p, 'mod-critter'); giveCard(g, q, 'mod-critter');
  let evs = [];
  for (let i = 0; i < CRITTER_MAX + 1; i++) { p.fireT = 0; p.ammo = 3; p.reloadT = 0; g.tryShoot(p); evs.push(...g.takeEvents()); }
  const mx = evs.filter(e => e.t === 'critterMax');
  check('critter max notice: once, for the shooter only', mx.length === 1 && mx[0].p === p.id && g.critterCount(p) === CRITTER_MAX, `${mx.length} ${g.critterCount(p)}`);
  q.fireT = 0; q.ammo = 3; g.tryShoot(q);
  check('critter counts are per player', g.critterCount(q) === 1 && g.critterCount(p) === CRITTER_MAX && !g.takeEvents().some(e => e.t === 'critterMax'));
  const snap = g.snapshot(); const row = id => snap.pl.find(r => r[0] === id);
  check('snapshot carries each player\'s critter count', row(p.id)[33] === CRITTER_MAX && row(q.id)[33] === 1 && row(g.players[2].id)[33] === -1);
}
{
  // Turret shield mod: the turret gets its own block bubble that breaks and recharges
  const g = freshGame(); flat(g); const [p, a] = g.players; for (const o of g.players) o.isBot = false;
  giveCard(g, p, 'shield-turret'); p.pos = { x: 0, y: 0, z: 0 }; p.aim = { x: 0, y: 0, z: 1 }; p.blockCdT = 0; g.tryBlock(p);
  const t = g.players.find(u => u.kind === 'blockTurret');
  check('turret has a block bubble (50 hp at base stats)', t && g.shielded(t) && t.fx.tshield.max === 50, t && t.fx.tshield.max);
  p.pos = { x: -20, y: 0, z: -20 }; a.pos = { x: 20, y: 0, z: 20 }; a.fx.invulnT = 1e9; const hp0 = t.hp; g.explode({ x: t.pos.x + 0.5, y: t.pos.y + 0.6, z: t.pos.z }, 200, a, { full: true });
  check('bubble soaks damage, breaks, turret unhurt', t.hp === hp0 && !g.shielded(t) && t.fx.tshield.hp === 0);
  run(g, 3.2); check('broken turret bubble recharges in 3 s', t.fx.tshield.hp === t.fx.tshield.max && g.shielded(t));
  t.fx.tshield.hp = 10; t.fx.tshield.lastHit = g.time; run(g, 2); const mid = t.fx.tshield.hp; run(g, 2);
  check('intact turret bubble refills after a pause', mid === 10 && t.fx.tshield.hp > 10, `${mid} ${t.fx.tshield.hp}`);
  const g2 = freshGame(); const p2 = g2.players[0]; giveCard(g2, p2, 'shield-turret'); giveCard(g2, p2, 'long-guard'); giveCard(g2, p2, 'big-bubble'); p2.blockCdT = 0; g2.tryBlock(p2);
  const t2 = g2.players.find(u => u.kind === 'blockTurret');
  check('turret bubble health and size grow with Block duration / Block size', t2.fx.tshield.max > 50 && t2.stats.blockSize > t.stats.blockSize);
}
{
  // Block size scales deployables: Bastion / Holy Bastion wall, pillar
  const g = freshGame(); flat(g); const p = g.players[0];
  giveCard(g, p, 'holy-bastion-wall'); p.blockCdT = 0; g.tryBlock(p); const w1 = g.shields[0];
  const g2 = freshGame(); flat(g2); const q = g2.players[0];
  giveCard(g2, q, 'holy-bastion-wall'); giveCard(g2, q, 'big-bubble'); q.blockCdT = 0; g2.tryBlock(q); const w2 = g2.shields[0];
  check('holy bastion wall scales with Block size', w1 && w2 && Math.max(w2.w, w2.d) > Math.max(w1.w, w1.d) * 1.5 && w2.h > w1.h * 1.5, `${w1 && w1.w} ${w2 && w2.w}`);
  const g3 = freshGame(); flat(g3); const r = g3.players[0]; giveCard(g3, r, 'shield-pillar'); giveCard(g3, r, 'big-bubble'); r.blockCdT = 0; g3.tryBlock(r);
  check('pillar and its shield widen with Block size', g3.barricades.find(b => b.kind === 'pillar').len > 1.9);
}
{
  // Blocked bullets keep the shooter's color, effects and damage
  const g = freshGame(); flat(g); const [q, a] = g.players; for (const o of g.players) o.isBot = false;
  giveCard(g, a, 'frost-rounds'); giveCard(g, a, 'heavy-slugs');
  q.pos = { x: 0, y: 0, z: 0 }; a.pos = { x: 8, y: 0, z: 0 }; q.blockCdT = 0; g.tryBlock(q);
  const b = g.spawnBullet(a, { x: 3, y: 0.8, z: 0 }, { x: -1, y: 0, z: 0 }, 28, false); b.grav = 0; const d0 = b.dmg;
  for (let i = 0; i < 10; i++) g.updateBullets(1 / 60);
  check('reflected bullet: blocker owns it, shooter color and effects kept', b.owner === q.id && b.color === a.color && b.chill === a.stats.chill && b.chill > 0 && Math.abs(b.dmg - d0) < 1e-9, `${b.owner} ${b.color} ${b.dmg} ${d0}`);
  const row = g.snapshot().bu.find(r => r[0] === b.id);
  check('snapshot sends the original shooter for color', row && row[10] === a.id);
}
{
  // Bank Shot: re-aims only at visible enemies within 22 m, then keeps tracking them
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const o of g.players.slice(2)) o.alive = false; for (const o of g.players) o.isBot = false;
  giveCard(g, p, 'bank-shot');
  e.pos = { x: 0, y: 0, z: 0 };
  const near = g.spawnBullet(p, { x: 10, y: 1.1, z: 0 }, { x: 0, y: 0, z: 1 }, 28, false); g.onBounce(near);
  check('bank shot: finds a visible enemy in range', near.bankTgt === e && near.vel.x < 0);
  const far = g.spawnBullet(p, { x: Math.min(g.level.hx - 1, 26), y: 1.1, z: 0 }, { x: 0, y: 0, z: 1 }, 28, false); const fx0 = far.vel.x;
  if (Math.hypot(far.pos.x, 0.3) > 22) { g.onBounce(far); check('bank shot: ignores enemies beyond 22 m', !far.bankTgt && far.vel.x === fx0); }
}
{
  // Healing visuals: regen flag while regenerating, a heal counter that bumps on one-off heals only
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const o of g.players) o.isBot = false;
  giveCard(g, p, 'nanite-repair'); p.hp = 50; g.updatePlayer(p, 1 / 60, true);
  check('regen flag on while regenerating', (g.playerFlags(p) & 16) && !(g.playerFlags(e) & 16));
  const n0 = p.healN || 0; run(g, 0.5);
  check('steady regen does not bump the heal counter', (p.healN || 0) === n0);
  giveCard(g, p, 'leech-rounds'); p.hp = 40; g.hurt(e, 30, p, null);
  check('lifesteal bumps the heal counter', (p.healN || 0) === n0 + 1);
  p.hp = g.maxHp(p); check('regen flag off at full health', !(g.playerFlags(p) & 16));
}


// ---------------------------------------------------------------- batch: polygon arenas, Game Master, elites, boss
{
  const { arenaEdges, edgeDistance, SHAPES } = await J('levelgen.js');
  const { prepareLevel } = await J('physics.js');
  // every shape: obstacles and spawns inside, players can't leave
  for (const shape of SHAPES) {
    let ok = true, info = '';
    for (const seed of [3, 17, 99]) {
      const L = generateLevel(6, 'generated', seed, 'standard', 6, { shape });
      const E = arenaEdges(L);
      for (const b of L.boxes) if (!b.wall) for (const [x, z] of [[b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z + b.d / 2], [b.x - b.w / 2, b.z + b.d / 2], [b.x + b.w / 2, b.z - b.d / 2]]) if (edgeDistance(E, x, z) < 2.9) { ok = false; info = `${shape} box ${seed}`; }
      for (const o of L.dynamic) if (edgeDistance(E, o.x, o.z) < 2) { ok = false; info = `${shape} dyn ${seed}`; }
      for (const p of spawnPoints(L, [3, 3]).flat()) if (edgeDistance(E, p.x, p.z) < 1.5) { ok = false; info = `${shape} spawn ${seed}`; }
      if (shape !== 'rect' && !(L.poly && L.poly.length >= 3)) { ok = false; info = 'no poly ' + shape; }
    }
    check('arena shape ' + shape + ': boxes, platforms and spawns inside', ok, info);
  }
  { // players and bullets stay inside a triangle
    const g = freshGame(4, {});
    let L = generateLevel(4, 'generated', 5, 'standard', 4, { shape: 'tri' }); g.level = prepareLevel(L); g.dyn = []; g.refreshSolids();
    const p = g.players[0]; p.pos = { x: 0, y: 0, z: 0 }; p.isBot = false;
    let out = 0;
    for (let i = 0; i < 400; i++) { p.input.mx = Math.cos(i / 40); p.input.mz = Math.sin(i / 40); g.step(1 / 60); g.takeEvents(); if (edgeDistance(g.level.edges, p.pos.x, p.pos.z) < 0.3) out++; }
    check('players can\'t walk through polygon walls', out === 0, out);
    g.bullets = []; const b = g.spawnBullet(p, { x: 0, y: 1, z: 0 }, { x: 0.7071, y: 0, z: -0.7071 }, 30, false); b.bLeft = 3; b.life = 3;
    let maxOut = 9;
    for (let i = 0; i < 120 && b.alive; i++) { g.updateBullets(1 / 60); maxOut = Math.min(maxOut, edgeDistance(g.level.edges, b.pos.x, b.pos.z)); }
    check('bullets bounce off polygon walls', maxOut > -0.3 && b.bLeft < 3, `${maxOut.toFixed(2)} bounces left ${b.bLeft}`);
  }
  { // co-op: squad and wave spawn on opposite sides; Game Master costs; standard bots have no cards
    let ok = true, noCards = true, info = '';
    for (let k = 0; k < 8; k++) {
      const g = new Game({ roster: roster(3), settings: { mode: 'waves', mapSource: 'generated', roundsToWin: 20 }, cards }); g.round = 2 + k; g.startRound();
      const hs = g.players.filter(p => p.kind === 'hero'), es = g.players.filter(p => p.team === 1 && p.transient);
      const hx = Math.max(...hs.map(p => p.pos.x)), ex = Math.min(...es.map(p => p.pos.x));
      if (!(hx < 0 && ex > 0)) { ok = false; info = `${hx.toFixed(1)} vs ${ex.toFixed(1)} ${g.level.shape}`; }
      for (const e of es) if (e.kind !== 'elite' && e.cards.length) noCards = false;
      const spent = g.gm.units.reduce((a, t) => a + C2.UNIT_COSTS[t], 0);
      if (Math.abs(spent - g.gm.spent) > 1e-6 || g.gm.spent > g.gm.budget + 1e-6) { ok = false; info = 'budget ' + spent + ' ' + g.gm.spent + ' ' + g.gm.budget; }
    }
    check('co-op: squad and wave spawn on opposite sides, wave fits its budget', ok, info);
    check('co-op: standard wave bots carry no cards', noCards);
  }
  { // elites: a fresh, non-empty hand every time
    const g = new Game({ roster: roster(2), settings: { mode: 'waves', roundsToWin: 10, waveDifficulty: 'nightmare' }, cards }); g.round = 6; g.startRound();
    const hands = Array.from({ length: 6 }, () => C2.unitSpec(g, 'elite', 0).cards.join(','));
    check('elites get cards, a new hand each spawn', hands.every(h => h.length) && new Set(hands).size >= 5, hands.length);
    const e = g.spawnWaveUnit('elite', { x: 0, z: 0 }, 0);
    check('elite stats come from its cards', e.kind === 'elite' && e.cards.length >= 3 && e.stats.health > 150);
  }
  { // reinforcements arrive when the field thins out
    const g = new Game({ roster: roster(4), settings: { mode: 'waves', roundsToWin: 12, waveDifficulty: 'nightmare' }, cards }); g.round = 10; g.startRound(); g.phase = 'play';
    const q0 = g.gm.queue.length, n0 = g.players.filter(p => p.team === 1 && p.transient).length;
    for (const p of g.players) if (p.team === 1 && p.transient) p.alive = false;
    g.step(1 / 60); g.takeEvents();
    check('reinforcements follow when the opening group falls', q0 > 0 && g.gm.queue.length === q0 - 1 && g.players.filter(p => p.team === 1 && p.transient && p.alive).length > 0, `${q0} ${n0}`);
  }
  { // final wave: boss with telegraphed attacks, portals, phases; killing it ends the wave
    const g = new Game({ roster: roster(3), settings: { mode: 'waves', roundsToWin: 5, waveDifficulty: 'hard', pickTime: 2 }, cards }); g.round = 3; g.startRound();
    check('no boss before the final wave', !g.boss);
    for (let k = 0; k < 40; k++) { g.round = 4; g.startRound(); if (g.boss && g.boss.boss.type === 'warden') break; }   // the Warden has the attacks checked below
    const b = g.boss;
    check('boss spawns on the final wave with huge health', b && b.kind === 'boss' && b.stats.health > 2000 && b.team === 1);
    g.phase = 'play'; for (const p of g.players) if (p.kind === 'hero') { p.stats.health = 1e6; p.hp = 1e6; }
    const seen = new Set(), evs = new Set(); let maxTg = 0, sw = 0;
    for (let i = 0; i < 60 * 70; i++) {
      if (i === 60 * 25) b.hp = g.maxHp(b) * 0.5;
      if (i === 60 * 45) b.hp = g.maxHp(b) * 0.2;
      g.step(1 / 60); for (const e of g.takeEvents()) evs.add(e.t === 'bossCast' ? 'cast:' + e.a : e.t);
      for (const t of g.telegraphs) seen.add(t.kind); maxTg = Math.max(maxTg, g.telegraphs.length); sw += g.shockwaves.length ? 1 : 0;
      JSON.stringify(g.snapshot());
      if (g.phase !== 'play') break;
    }
    check('boss uses several telegraphed attacks', ['cleave', 'meteors', 'beams', 'quake', 'inout', 'portals', 'leap', 'cross'].filter(a => evs.has('cast:' + a)).length >= 5, [...evs].filter(e => e.startsWith('cast')).join(' '));
    check('boss phases change at 66% and 33%', evs.has('bossPhase') && b.boss.phase === 3);
    check('boss portals spawn enemies', g.players.some(p => p.kind === 'portal') || evs.has('portalSpawn'), [...evs].join(' '));
    check('telegraphs damage heroes standing in them', g.players.some(p => p.kind === 'hero' && p.hp < 1e6));
    b.hp = 1; g.hurt(b, 50, g.players[0], null); g.step(1 / 60); g.takeEvents();
    check('killing the boss clears its adds and wins the wave', !g.players.some(p => p.team === 1 && p.transient && p.alive) && (g.phase === 'roundEnd' || g.phase === 'picking' || g.phase === 'over'));
    // difficulty changes the boss
    const hpOf = d => { const h = new Game({ roster: roster(2), settings: { mode: 'waves', roundsToWin: 3, waveDifficulty: d }, cards }); h.round = 2; h.startRound(); return h.boss.stats.health; };
    check('boss health scales with difficulty', hpOf('easy') < hpOf('normal') && hpOf('normal') < hpOf('nightmare'));
  }
  { // full co-op smoke with bots through a boss fight
    for (const d of ['easy', 'nightmare']) {
      const g = new Game({ roster: roster(3), settings: { mode: 'waves', roundsToWin: 2, waveDifficulty: d, pickTime: 1 }, cards }); g.start();
      let err = null; try { run(g, 200, 1 / 60); } catch (e) { err = e; console.log(e.stack); }
      check('co-op boss smoke ' + d, !err && (g.round >= 2 || g.phase === 'over'), err && err.message);
    }
  }
  { // final-round flag (drives the suspense music)
    const g = new Game({ roster: roster(3), settings: { roundsToWin: 3 }, cards }); g.start();
    const k = g.scoreKey(g.players[0]);
    const before = g.isFinalRound(); g.scores[k] = 2;
    check('final round detected at match point', !before && g.isFinalRound());
  }
}

// ---------------------------------------------------------------- batch: slam buff, clone split, napalm, bullet time
const SIM = await J('sim.js');
const { prepareLevel: prepLevel } = await J('physics.js');
{ // Ground Slam: bigger shockwave damage and faster air steering during the leap
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const o of g.players.slice(2)) o.alive = false;
  giveCard(g, p, 'shield-slam'); p.pos = { x: 0, y: 0, z: 0 }; e.pos = { x: 2, y: 0, z: 0 }; const hp0 = e.hp; p.blockCdT = 0; p.onGround = true; g.tryBlock(p);
  p.input.mx = 1; p.input.mz = 0; let topSpd = 0;
  for (let i = 0; i < 20; i++) { g.updatePlayer(p, 1 / 60, true); g.time += 1 / 60; topSpd = Math.max(topSpd, p.vel.x); }
  const ground = p.stats.moveSpeed * C.speedFor(p.size);
  check('slam: faster in the air during the leap', topSpd > ground * 1.25, `${topSpd.toFixed(2)} vs ${ground.toFixed(2)}`);
  p.input.mx = 0; p.vel.x = 0; p.pos.x = 0;
  for (let i = 0; i < 150; i++) { g.updatePlayer(p, 1 / 60, true); g.time += 1 / 60; }
  const want = SIM.SLAM.base + SIM.SLAM.dmgShare * g.effDamage(p.stats);
  check('slam: buffed shockwave damage', hp0 - e.hp > 40 && Math.abs((hp0 - e.hp) - want) < 2, `${(hp0 - e.hp).toFixed(1)} want ${want.toFixed(1)}`);
  p.input.mx = 1; p.onGround = true; p.fx.slam = null; p.vel.x = 0;
  for (let i = 0; i < 40; i++) g.updatePlayer(p, 1 / 60, true);
  check('slam: normal speed back on the ground', p.vel.x < ground * 1.05);
}
{ // Clone: every clone halves health / damage / block stats (not cooldown) for you and the clone; resets next round
  const g = freshGame(); flat(g); const p = g.players[0]; for (const o of g.players.slice(1)) o.alive = false;
  for (const id of ['shield-clone', 'incendiary-rounds', 'big-bubble', 'counter-pulse']) if (cardById.has(id)) giveCard(g, p, id);
  const s0 = { ...p.stats }; p.hp = 80; p.pos = { x: 0, y: 0, z: 0 }; p.aim = { x: 0, y: 0, z: 1 };
  p.blockCdT = 0; g.tryBlock(p);
  const c1 = g.players.find(u => u.kind === 'clone' && u.ownerId === p.id && u.alive);
  check('clone split: health halved', Math.abs(p.stats.health - s0.health / 2) < 1e-6 && Math.abs(p.hp - 40) < 1e-6, `${p.stats.health} ${p.hp}`);
  check('clone split: damage kept (v26: clones keep the gun)', Math.abs(p.stats.damage - s0.damage) < 1e-6);
  check('clone split: block stats halved', Math.abs(p.stats.blockSize - s0.blockSize / 2) < 1e-6 && Math.abs(p.stats.blockDuration - s0.blockDuration / 2) < 1e-6 && Math.abs(p.stats.counterShots - s0.counterShots / 2) < 1e-6);
  check('clone split: cooldown kept', p.stats.blockCooldown === s0.blockCooldown);
  check('clone split: clone copies the halved stats', c1 && c1.stats.health === p.stats.health && c1.stats.damage === p.stats.damage && c1.hp === p.hp && c1.stats.ignite === s0.ignite);
  check('clone split: block still makes the clone (no bubble)', p.blockT <= 0);
  p.blockCdT = 0; g.tryBlock(p);
  check('clone split: second clone halves again', Math.abs(p.stats.health - s0.health / 4) < 1e-6 && Math.abs(p.stats.damage - s0.damage) < 1e-6 && Math.abs(p.hp - 20) < 1e-6);
  const c2 = g.players.filter(u => u.kind === 'clone' && u.ownerId === p.id && u.alive).pop();
  check('clone split: newest clone at quarter health, full damage', c2 && Math.abs(c2.stats.health - s0.health / 4) < 1e-6 && Math.abs(c2.stats.damage - s0.damage) < 1e-6);
  // gun effects on the clone still work: its bullet ignites
  const e = g.players[1]; e.alive = true; e.hp = g.maxHp(e); e.fx = {}; c2.pos = { x: -3, y: 0, z: 0 }; e.pos = { x: 0, y: 0, z: 0 };
  const b = g.spawnBullet(c2, { x: c2.pos.x + 1, y: 0.9, z: c2.pos.z }, { x: 1, y: 0, z: 0 }, 28, false); b.grav = 0;
  for (let i = 0; i < 20 && b.alive; i++) g.updateBullets(1 / 60);
  check('clone split: clone bullets keep gun effects (ignite)', e.fx.burn && e.fx.burn.t > 0 && Math.abs(b.dmg - g.effDamage(c2.stats)) < 1e-6);
  g.resetPlayer(p, { x: 0, y: 0, z: 0 });
  check('clone split: reset at next spawn', Math.abs(p.stats.health - s0.health) < 1e-6 && p.hp === p.stats.health);
}
{ // Clone + every weapon mod: the clone fires without errors
  let ok = true, info = '';
  for (const mod of cards.filter(c => c.weaponMod).map(c => c.id)) {
    try {
      const g = freshGame(); flat(g); const p = g.players[0], e = g.players[1]; for (const o of g.players.slice(2)) o.alive = false;
      giveCard(g, p, 'shield-clone'); giveCard(g, p, mod); p.pos = { x: 0, y: 0, z: 0 }; p.blockCdT = 0; g.tryBlock(p);
      const c = g.players.find(u => u.kind === 'clone'); c.pos = { x: -3, y: 0, z: 0 }; e.pos = { x: 3, y: 0, z: 0 };
      c.aim = { x: 1, y: 0, z: 0 }; c.aimPoint = { x: 3, y: 1, z: 0 }; c.input.shoot = true; c.input.aim = c.aim; c.input.aimPoint = c.aimPoint;
      let fired = false; const hp0 = e.hp;
      p.pos = { x: 0, y: 0, z: 6 };
      for (let i = 0; i < 150; i++) {
        if (i === 100) c.input.shoot = false;   // Riot Shield fires its wave on release
        g.updatePlayer(c, 1 / 60, true); g.updateBullets(1 / 60); g.time += 1 / 60;
        if (g.takeEvents().some(ev => ev.t === 'shoot' && ev.p === c.id)) fired = true;
      }
      if (c.mod !== p.mod) { ok = false; info += mod + ':mod '; }
      if (!fired && e.hp >= hp0) { ok = false; info += mod + ':nofire '; }
    } catch (err) { ok = false; info += mod + ':' + err.message + ' '; }
  }
  check('clone split: clones fire every weapon mod', ok, info);
}
{ // Napalm: floor splat sized by damage, bits on the surface only, 5 s life, ignites enemies who touch it
  const g = freshGame(); flat(g); const [p, e] = g.players; for (const o of g.players.slice(2)) o.alive = false;
  giveCard(g, p, 'napalm-rounds'); p.pos = { x: -8, y: 0, z: 0 }; e.pos = { x: 6, y: 0, z: 6 };
  const shoot = (o, d, dmg) => { const b = g.spawnBullet(p, o, d, 20, false); b.grav = 0; if (dmg) b.dmg = dmg; for (let i = 0; i < 30 && b.alive; i++) g.updateBullets(1 / 60); return b; };
  shoot({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 });
  const f1 = g.fires[0];
  check('napalm: floor impact leaves a fire splat', g.fires.length === 1 && f1.bits.length >= 4);
  check('napalm: floor bits on the floor, inside the splat', f1 && f1.bits.every(k => Math.abs(k.y) < 1e-6 && Math.hypot(k.x, k.z) <= f1.r + 1e-6));
  shoot({ x: 3, y: 1, z: -4 }, { x: 0, y: -1, z: 0 }, 120);
  check('napalm: bigger damage, bigger splat', g.fires.length === 2 && g.fires[1].r > f1.r * 1.5, g.fires.map(f => f.r).join(','));
  // ignite on touch, no damage to the owner
  e.pos = { x: 0, y: 0, z: 0 }; e.fx = {};
  g.updateFires(1 / 60);
  check('napalm: ignites an enemy standing in it', e.fx.burn && e.fx.burn.t > 0 && e.fx.burn.src === p);
  p.pos = { x: 0, y: 0, z: 0 }; p.fx = {}; g.fires.forEach(f => f.checkT = 0); g.updateFires(1 / 60);
  check('napalm: owner not ignited by own fire', !(p.fx.burn && p.fx.burn.t > 0));
  // above the fire (jumping over) doesn't ignite
  e.fx = {}; e.pos = { x: 0, y: 2.5, z: 0 }; g.fires.forEach(f => f.checkT = 0); g.updateFires(1 / 60);
  check('napalm: jumping over it is safe', !(e.fx.burn && e.fx.burn.t > 0));
  for (let i = 0; i < 60 * 5 + 5; i++) g.updateFires(1 / 60);
  check('napalm: burns out after 5 s', g.fires.length === 0);
}
{ // Napalm on a platform edge: no flames hanging past the ledge; on a wall: only below its visible top
  const g = freshGame(); flat(g); const p = g.players[0]; for (const o of g.players.slice(1)) o.alive = false;
  giveCard(g, p, 'napalm-rounds');
  g.level.boxes.push({ x: 0, z: 0, w: 2, d: 2, h: 0.8, y0: 0 }); prepLevel(g.level); g.refreshSolids();
  const b = g.spawnBullet(p, { x: 0.9, y: 2, z: 0 }, { x: 0, y: -1, z: 0 }, 20, false); b.grav = 0; b.dmg = 150;
  for (let i = 0; i < 30 && b.alive; i++) g.updateBullets(1 / 60);
  const f = g.fires[0];
  check('napalm: ledge splat stays on the platform top', f && f.bits.length > 0 && f.bits.every(k => Math.abs(k.y - 0.8) < 1e-6 && Math.abs(k.x) < 1 && Math.abs(k.z) < 1), f && JSON.stringify(f.bits.slice(0, 3)));
  check('napalm: big splat clipped (some bits dropped at the edge)', f && f.r > 1.0);
  // side of the platform: wall splat, every bit backed by the box and below its top
  g.fires = [];
  const b2 = g.spawnBullet(p, { x: -4, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 }, 20, false); b2.grav = 0; b2.dmg = 150;
  for (let i = 0; i < 30 && b2.alive; i++) g.updateBullets(1 / 60);
  const w = g.fires[0];
  check('napalm: wall splat sticks to the wall face', w && w.n.x === -1 && w.bits.every(k => k.x < -1 && k.x > -1.1 && k.y > 0 && k.y < 0.8 && Math.abs(k.z) < 1), w && JSON.stringify(w.bits.slice(0, 3)));
  // crates (moving props) don't hold fire
  const g2 = freshGame(); const p2 = g2.players[0]; giveCard(g2, p2, 'napalm-rounds');
  const crate = g2.dyn.find(o => o.kind === 'crate');
  if (crate) { const b3 = g2.spawnBullet(p2, { x: crate.pos.x, y: crate.pos.y + crate.h + 1.5, z: crate.pos.z }, { x: 0, y: -1, z: 0 }, 20, false); b3.grav = 0; for (let i = 0; i < 30 && b3.alive; i++) g2.updateBullets(1 / 60);
    check('napalm: no fire on crates', !g2.fires.some(f => f.bits.some(k => Math.abs(k.y - (crate.pos.y + crate.h)) < 0.05 && Math.abs(k.x - crate.pos.x) < crate.w / 2))); }
}
{ // Bullet Time: enemy bullets inside the field fly 30% slower; own bullets don't; copies widen the field only
  const g = freshGame(); flat(g); const [h, e] = g.players; for (const o of g.players.slice(2)) o.alive = false;
  giveCard(g, h, 'bullet-time'); h.pos = { x: 0, y: 0, z: 0 }; e.pos = { x: 15, y: 0, z: 0 };
  const travel = (owner, o, d) => { const b = g.spawnBullet(owner, o, d, 20, false); b.grav = 0; const x0 = b.pos.x; g.updateBullets(0.05); return Math.abs(b.pos.x - x0); };
  const inside = travel(e, { x: 2, y: 0.9, z: 0 }, { x: -1, y: 0, z: 0 });
  const outside = travel(e, { x: 10, y: 0.9, z: 0 }, { x: -1, y: 0, z: 0 });
  check('bullet time: enemy bullets slowed to 25% inside the field', Math.abs(inside / outside - 0.25) < 0.01, `${inside} / ${outside}`);
  const own = travel(h, { x: 1, y: 0.9, z: 0 }, { x: 1, y: 0, z: 0 });
  check('bullet time: your own bullets unaffected', Math.abs(own - outside) < 1e-6);
  const r1 = g.slowFieldRadius(h.stats.slowField);
  giveCard(g, h, 'bullet-time');
  const r2 = g.slowFieldRadius(h.stats.slowField);
  const inside2 = travel(e, { x: 2, y: 0.9, z: 0 }, { x: -1, y: 0, z: 0 });
  const edge = travel(e, { x: r1 + 1, y: 0.9, z: 0 }, { x: -1, y: 0, z: 0 });
  check('bullet time: a second copy widens the field', r2 > r1 && edge < outside * 0.75, `${r1} -> ${r2}`);
  check('bullet time: a second copy does not slow more', Math.abs(inside2 / outside - 0.25) < 0.01);
  const sn = g.snapshot(); const row = sn.pl.find(r => r[0] === h.id);
  check('bullet time: field radius sent to clients', Math.abs(row[34] - r2) < 0.01);
}

// ---- Katana weapon mod
{
  const g = freshGame(2); flat(g);
  const [a, b] = g.players; b.isBot = false; a.isBot = false;
  giveCard(g, a, 'mod-katana');
  check('katana is a weapon mod', a.mod === 'katana');
  a.pos = { x: 0, y: 0, z: 0 }; b.pos = { x: 1.6, y: 0, z: 0 }; a.input.aim = { x: 1, y: 0, z: 0 }; a.aim = { x: 1, y: 0, z: 0 };
  a.fireT = 0; let hp0 = b.hp; a.input.shoot = true; g.step(1 / 60); g.takeEvents();
  check('katana slash hits up close for 1.4x damage', Math.abs((hp0 - b.hp) - g.effDamage(a.stats) * 1.4) < 0.5, hp0 - b.hp);
  check('katana uses no ammo', a.ammo === a.stats.ammo);
  a.input.shoot = false; g.step(1 / 60); a.fireT = 0;
  b.pos = { x: 6, y: 0, z: 0 };
  const eb = g.spawnBullet(b, { x: 1.3, y: g.chest(a), z: 0 }, { x: -1, y: 0, z: 0 }, 28, false); eb.explosive = 2;
  hp0 = a.hp; a.input.shoot = true; g.step(1 / 60);
  const ev = g.takeEvents();
  check('katana slash cuts a bullet with no explosion', !eb.alive && ev.some(e => e.t === 'cut') && !ev.some(e => e.t === 'boom') && a.hp === hp0);
  for (let i = 0; i < 120; i++) { g.step(1 / 60); g.takeEvents(); }
  check('holding the katana charges it', a.fx.kCharge >= 0.99);
  const fast = g.katanaChargeTime({ stats: { ...a.stats, fireRate: a.stats.fireRate * 2 } });
  check('fire rate speeds up the katana charge', fast < g.katanaChargeTime(a) * 0.6);
  a.stats.poison = 1; hp0 = b.hp; a.input.shoot = false; g.step(1 / 60);
  const w = g.bullets.find(x => String(x.fx).startsWith('slash'));
  check('releasing a charge sends a slash wave carrying bullet effects', w && w.pierce && w.poison === 1 && w.dmg > g.effDamage(a.stats) * 2);
  // a second enemy bullet in the wave's path gets cut
  const eb2 = g.spawnBullet(b, { x: 4, y: g.chest(a), z: 0 }, { x: -1, y: 0, z: 0 }, 20, false);
  for (let i = 0; i < 60; i++) { g.step(1 / 60); g.takeEvents(); }
  check('the slash wave cuts bullets and hits players', !eb2.alive && b.hp < hp0 && !!b.fx.poisonS);
}
// ---- Super Saiyan Hair shield mod
{
  const g = freshGame(2); flat(g);
  const [a, b] = g.players; a.isBot = false; b.isBot = false;
  giveCard(g, a, 'shield-saiyan');
  check('hair pool is 2x max health', a.smod === 'hair' && Math.abs(a.hairMax - 2 * a.stats.health) < 0.01);
  giveCard(g, a, 'padded-vest');
  check('hair pool updates after a card', Math.abs(a.hairMax - 2 * a.stats.health) < 0.01);
  a.pos = { x: 0, y: 0, z: 0 }; b.pos = { x: 9, y: 0, z: 0 }; a.fx = {};
  a.input.block = true; a.input.mx = 1; a.input.shoot = true; a.input.blockSeq++;
  const ammo0 = a.ammo;
  for (let i = 0; i < 60 * 3; i++) { g.step(1 / 60); g.takeEvents(); }
  check('charging the hair: no moving or shooting', Math.hypot(a.pos.x, a.pos.z) < 0.05 && a.ammo === ammo0 && a.fx.hair > 0);
  check('hair has no block bubble', a.blockT <= 0);
  a.input.block = false; a.input.shoot = false; a.input.mx = 0;
  const hp0 = a.hp, hair0 = a.fx.hair, size0 = a.size;
  g.hurt(a, 60, b, null);
  check('hair soaks damage before your health', a.hp === hp0 && Math.abs(a.fx.hair - (hair0 - 60)) < 0.01);
  a.fx.hair = 10; g.hurt(a, 30, b, null);
  check('damage past the hair reaches your health', a.fx.hair === 0 && Math.abs(a.hp - (hp0 - 20)) < 0.01);
  a.fx.hair = a.hairMax; g.step(1 / 60);
  check('hair never changes your size', Math.abs(a.size - size0) < 0.01);
  check('hair row in snapshot', g.snapshot().pl.find(r => r[0] === a.id)[35][2] === 1);
}
// ---- Pentagram shield mod
{
  const g = freshGame(2); flat(g);
  const [a, b] = g.players; a.isBot = false; b.isBot = false;
  giveCard(g, a, 'shield-pentagram');
  a.pos = { x: 0, y: 0, z: 0 }; b.pos = { x: 14, y: 0, z: 0 }; b.stats.health = b.hp = 1e5;
  for (let i = 0; i < 10; i++) g.step(1 / 60);
  a.input.block = true; for (let i = 0; i < 40; i++) { g.step(1 / 60); g.takeEvents(); }
  check('pentagram starts drawing', g.rituals.length === 1 && !g.rituals[0].deployed);
  a.input.block = false; g.step(1 / 60); g.takeEvents();
  for (let i = 0; i < 60 * 3; i++) { g.step(1 / 60); g.takeEvents(); }
  check('letting go before it is drawn makes it fade', g.rituals.length === 0);
  a.input.block = true; const evs = [];
  for (let i = 0; i < 60 * 3; i++) { g.step(1 / 60); evs.push(...g.takeEvents()); }
  const r = g.rituals[0];
  check('pentagram deploys and stays', r && r.deployed && evs.some(e => e.t === 'ritualReady'));
  // walk away (it stays), come back, charge partway, let go: progress resets
  a.input.block = false; a.input.mx = 1; for (let i = 0; i < 60; i++) { g.step(1 / 60); g.takeEvents(); }
  check('you can leave a drawn pentagram', g.rituals.length === 1 && !g.inRitual(a, r));
  a.input.block = true; for (let i = 0; i < 30; i++) { g.step(1 / 60); g.takeEvents(); }
  check('no charging outside the pentagram', r.prog === 0 && !a.fx.hold);
  a.input.block = false; a.pos = { x: r.x, y: 0, z: r.z }; a.input.mx = 0; a.input.block = true;
  for (let i = 0; i < 60; i++) { g.step(1 / 60); g.takeEvents(); }
  const part = r.prog; a.input.block = false; g.step(1 / 60);
  check('level charge decays when let go', part > 0.2 && r.prog < part && r.level === 0);
  a.input.block = true; const lv = []; let cdAtEnd = -1;
  for (let i = 0; i < 60 * 12; i++) { g.step(1 / 60); for (const e of g.takeEvents()) { if (e.t === 'ritualLevel') lv.push(e.c); if (e.t === 'ritualEnd') { cdAtEnd = a.blockCdT; a.input.block = false; } } }
  check('three ritual levels (critters, brute, meteors)', lv.length === 3 && lv.every(c => c > 0), lv.join(','));
  check('portal critters spawned', g.players.filter(u => u.kind === 'critter' && u.ritual).length > 0);
  a.input.block = false;
  for (let i = 0; i < 60 * 3; i++) { g.step(1 / 60); g.takeEvents(); }
  check('ritual resolves and goes on cooldown', g.rituals.length === 0 && cdAtEnd > a.stats.blockCooldown, JSON.stringify([g.phase, g.rituals.map(r => [r.level, r.portals.length, r.age]), a.blockCdT, a.alive]));
}
// ---- bots with the new mods don't break
{
  const g = new Game({ roster: roster(4), settings: { mapSource: 'generated', pickTime: 2 }, cards }); g.start();
  const ids = ['mod-katana', 'shield-saiyan', 'shield-pentagram', 'mod-katana'];
  g.players.forEach((p, i) => giveCard(g, p, ids[i]));
  let err = null; const seen = new Set();
  try { run(g, 90, 1 / 60, gg => { for (const p of gg.players) { if (p.fx.hold) seen.add(p.smod); if (p.fx.kCharge > 0) seen.add('katana'); } JSON.stringify(gg.snapshot()); }); } catch (e) { err = e; console.log(e.stack); }
  check('bots play with katana / hair / pentagram', !err && seen.has('katana') && (seen.has('hair') || seen.has('ritual')), [...seen].join(' '));
}
const norm3 = v => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
// ---- batch 1: offers, mod lockout, Scrap It, burn stacks, thruster, countdown, encore, beam
{
  const g = new Game({ roster: roster(2, { human: true }), settings: { mapSource: 'generated', pickTime: 30 }, cards }); g.start();
  const me = g.players[0];
  check('offers deal 5 cards', g.makeOffer(me).length === 5);
  giveCard(g, me, 'tiny-tank'); giveCard(g, me, 'shield-pillar');
  const pool = g.offerPool(me);
  check('holding mods: no more weapon / shield mods dealt', !pool.some(c => c.weaponMod || c.shieldMod) && pool.some(c => c.special === 'modBreaker'));
  const fresh = g.players[1]; fresh.cards = []; g.recompute(fresh);
  check('Scrap It only dealt when you hold a mod', !g.offerPool(fresh).some(c => c.special === 'modBreaker'));
  g.phase = 'picking'; me.picked = false; me.picksLeft = 1; me.offer = ['mod-breaker'];
  let asked = null; g.onBreak = (p, o) => { asked = o; };
  g.pick(me.id, 'mod-breaker');
  check('Scrap It asks which mod', asked && asked.length === 2 && !me.cards.includes('mod-breaker'), JSON.stringify(asked));
  g.breakChoice(me.id, 'tiny-tank');
  check('Scrap It destroys the chosen mod', !me.cards.includes('tiny-tank') && me.cards.includes('shield-pillar') && !me.mod && me.smod === 'pillar');
  check('weapon mods dealt again after scrapping', g.offerPool(me).some(c => c.weaponMod));
}
{
  const g = freshGame(); flat(g); const [a, b] = g.players;
  a.pos = { x: -3, y: 0, z: 0 }; b.pos = { x: 3, y: 0, z: 0 }; b.hp = 1000; b.stats.health = 1000;
  for (let i = 0; i < 3; i++) g.applyHit({ dmg: 20, ownerRef: a, ignite: 1, knockback: 0 }, b, { x: 1, y: 0, z: 0 });
  check('ignite stacks per bullet', b.fx.burns.filter(k => k.t > 0).length === 3);
  b.fx.burns = []; b.fx.thrust = null;
  g.applyHit({ dmg: 20, ownerRef: a, knockback: 6 }, b, { x: 1, y: 0, z: 0 });
  check('thruster pushes for about 2 s', b.fx.thrust && Math.abs(b.fx.thrust.t - 2) < 0.05, b.fx.thrust && b.fx.thrust.t);
  for (let i = 0; i < 60; i++) g.applyHit({ dmg: 3, ownerRef: a, knockback: 6 }, b, { x: 1, y: 0, z: 0 });
  check('thruster push is capped', Math.hypot(b.fx.thrust.x, b.fx.thrust.z) <= 6 / b.size + 1e-6);
}
{
  const g = new Game({ roster: roster(2), settings: { mapSource: 'generated' }, cards }); g.start();
  const p = g.players[0], x0 = p.pos.x, z0 = p.pos.z; p.input.mx = 1; p.input.mz = 0; p.input.jump = true;
  for (let i = 0; i < 60; i++) { g.step(1 / 60); g.takeEvents(); if (g.phase !== 'countdown') break; }
  check('nobody moves during the countdown', Math.hypot(p.pos.x - x0, p.pos.z - z0) < 0.05 && p.pos.y < 0.5 + (p.spawn.y || 0));
  const w = new Game({ roster: roster(2), settings: { mapSource: 'generated', mode: 'waves' }, cards }); w.start();
  check('co-op waves get extra prep time', w.phaseT > 3.5, w.phaseT);
  const q = w.players[0]; q.input.mx = 1; q.input.mz = 0;
  for (let i = 0; i < 180; i++) { w.step(1 / 60); w.takeEvents(); }
  check('co-op prep: players stay near their side', Math.hypot(q.pos.x - q.spawn.x, q.pos.z - q.spawn.z) <= 3.6);
}
{
  const g = freshGame(); flat(g); const [a] = g.players;
  giveCard(g, a, 'standing-ovation'); a.stats.encore = 1; a.ammo = 5; a.fireT = 0; a.reloadT = 0; a.input.shoot = false;
  g.tryShoot(a); const n0 = g.bullets.length;
  for (let i = 0; i < 12; i++) g.step(1 / 60);
  check('encore fires a follow-up shot (v1.2.8: free, no ammo)', g.bullets.length >= n0 + 1 && a.ammo === 4, `${n0} -> ${g.bullets.length}, ammo ${a.ammo}`);
}
{
  const g = freshGame(); flat(g); const [a, b] = g.players;
  giveCard(g, a, 'mod-beam-rifle'); giveCard(g, a, 'incendiary-rounds');
  a.pos = { x: 0, y: 0, z: 0 }; b.pos = { x: 6, y: 0, z: 0 }; b.blockT = 0;
  a.aim = { x: 1, y: 0, z: 0 };
  g.fireBeam(a, { x: 0, y: g.chest(a), z: 0 }, { x: 1, y: 0, z: 0 });
  check('beam carries ignite', g.burning(b));
  a.stats.bounces = 2; b.pos = { x: 0, y: 0, z: 6 };
  const ev0 = g.takeEvents().length;
  g.fireBeam(a, { x: 0, y: g.chest(a), z: 0 }, norm3({ x: 1, y: -0.05, z: 0 }));
  check('beam bounces', g.takeEvents().filter(e => e.t === 'beam').length >= 2);
}
{
  // v1.2.9 (Devin): several Bastion walls stand at once, and an enemy wall stops the Beam Rifle
  const g = freshGame(); flat(g); const [a, b] = g.players;
  giveCard(g, b, 'bastion-wall'); b.pos = { x: 4, y: 0, z: 0 }; b.aim = { x: -1, y: 0, z: 0 }; b.aimPoint = { x: 2, y: 1, z: 0 };
  g.tryBlock(b); b.blockCdT = 0; g.tryBlock(b); b.blockCdT = 0; g.tryBlock(b);
  check('several bastion walls stand at once', g.shields.filter(s => s.owner === b.id && !s.box).length === 3, String(g.shields.length));
  for (let i = 0; i < 4; i++) { b.blockCdT = 0; g.tryBlock(b); }
  check('bastion walls cap at 5', g.shields.filter(s => s.owner === b.id && !s.box).length === 5);
  const w = g.shields[g.shields.length - 1]; g.shields = [w];
  giveCard(g, a, 'mod-beam-rifle'); a.pos = { x: w.x - 3 * Math.cos(w.ang + Math.PI / 2), y: 0, z: w.z - 3 * Math.sin(w.ang + Math.PI / 2) };
  b.pos = { x: w.x + 2 * Math.cos(w.ang + Math.PI / 2), y: 0, z: w.z + 2 * Math.sin(w.ang + Math.PI / 2) }; b.blockT = 0; b.hp = g.maxHp(b); const full = b.hp;
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, L = Math.hypot(dx, dz); g.takeEvents();
  g.fireBeam(a, { x: a.pos.x, y: g.chest(a), z: a.pos.z }, { x: dx / L, y: 0, z: dz / L });
  check('enemy bastion wall stops the beam rifle', b.hp === full && g.takeEvents().some(e => e.t === 'block'), `hp ${b.hp}/${full}`);
  g.shields = []; g.fireBeam(a, { x: a.pos.x, y: g.chest(a), z: a.pos.z }, { x: dx / L, y: 0, z: dz / L });
  check('beam hits with no wall (control)', b.hp < full);
}
// ---- v1.0.8: 2D: a second edge hit soon after launches you like a block would; the starting pick keeps its offer
{
  const g = freshGame(2, { side: true, mode: 'ffa' });
  const [a] = g.players; a.isBot = false; const S = g.level.side;
  const touch = () => { a.pos.y = S.bottom; a.pos.x = 0; a.vel = { x: 0, y: -5, z: 0 }; a.blockT = 0; sideRules(g, a, 1 / 60); return a.vel.y; };
  if (inPit(g.level, 0)) g.level.side.pits = [];
  g.time = 1; const v1 = touch(); g.time += 1; const v2 = touch();
  check('2D: first edge hit is a small push', v1 < SIDE.bounceMin * Math.sqrt(g.level.gravK || 1) - 0.01);
  check('2D: a repeat edge hit launches like a block', v2 >= SIDE.bounceMin * Math.sqrt(g.level.gravK || 1) - 0.01);
}
{
  const g = new Game({ roster: roster(2), settings: { mapSource: 'generated', mode: 'ffa', startPick: true }, cards }); g.start();
  check('starting pick: round 1 event held back while picking', !!g.prePick && !g.takeEvents().some(e => e.t === 'round'));
}
// v1.0.9: bullets bounce off the invisible arena walls and the 2D red edges; sky strikes still land
{
  const bare = g => { flat(g); g.level.boxes = []; g.level.solids = []; g.refreshSolids(); g.level.edges = null; };
  const g = freshGame(); bare(g); const a = g.players[0]; giveCard(g, a, 'ricochet-rounds'); g.players[1].alive = false;
  const L = g.level, b = g.spawnBullet(a, { x: L.hx - 0.3, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 30, false);
  for (let i = 0; i < 6; i++) g.updateBullets(1 / 60);
  check('bullets bounce off the invisible arena wall', b.alive && b.bounced && b.vel.x < 0 && Math.abs(b.pos.x) <= L.hx, JSON.stringify(b.pos));
  const g2 = freshGame(2, { side: true, mode: 'ffa' }); const a2 = g2.players[0]; giveCard(g2, a2, 'ricochet-rounds'); g2.players[1].alive = false;
  const top = g2.level.side.top, b2 = g2.spawnBullet(a2, { x: 0, y: top - 0.3, z: 0 }, { x: 0, y: 1, z: 0 }, 30, false);
  for (let i = 0; i < 6; i++) g2.updateBullets(1 / 60);
  check('2D: bullets bounce off the red top edge', b2.alive && b2.bounced && b2.vel.y < 0 && b2.pos.y <= top, JSON.stringify(b2.pos));
  for (const side of [false, true]) {
    const g3 = freshGame(2, side ? { side: true, mode: 'ffa' } : {}); if (!side) bare(g3);
    const p3 = g3.players[0]; giveCard(g3, p3, 'orbital-drop'); giveCard(g3, p3, 'ricochet-rounds'); g3.players[1].alive = false;
    p3.aimPoint = { x: p3.pos.x + 4, y: 0.5, z: p3.pos.z }; p3.aim = { x: 1, y: 0, z: 0 };
    p3.reloadT = 0; p3.fireT = 0; p3.ammo = 5; p3.mod = null; const n0 = g3.bullets.length; g3.tryShoot(p3); const sb = g3.bullets.slice(n0).find(x => x.sky);
    let minY = Infinity, early = false;
    for (let i = 0; i < 240 && sb && sb.alive; i++) { g3.updateBullets(1 / 60); minY = Math.min(minY, sb.pos.y); if (!sb.bounced && sb.pos.y > (side ? g3.level.side.top : 14) + 0.5 && sb.vel.y > 0) early = true; }
    check(`orbital drop still lands (${side ? '2D' : '3D'})`, !!sb && minY < (side ? g3.level.side.top - 2 : 3) && !early, sb ? 'minY ' + minY.toFixed(1) : 'no sky bullet');
  }
  const g4 = freshGame(); bare(g4); const a4 = g4.players[0]; giveCard(g4, a4, 'rebound-charge'); g4.players[1].alive = false;
  const b4 = g4.spawnBullet(a4, { x: 0, y: 0.3, z: 0 }, { x: 0, y: -1, z: 0 }, 20, false); g4.takeEvents();
  const booms = () => { let n = 0; for (let i = 0; i < 3; i++) { g4.updateBullets(1 / 60); for (const ev of g4.takeEvents()) if (ev.t === 'boom') n++; } return n; };
  const onBounce = booms(); b4.bLeft = 0; b4.pos = { x: 0, y: 0.3, z: 0 }; b4.vel = { x: 0, y: -20, z: 0 }; const onLast = booms();
  check('rebound charge: full blast on a bounce and on the last hit', onBounce === 1 && onLast === 1 && b4.alive === false, onBounce + ' ' + onLast);
}
// v1.1.2: shrapnel bursts on a player hit (fragments skip that player); Mine Layer lays two mines with a normal gun
{
  const g = freshGame(); flat(g); const [a, t] = g.players; for (const o of g.players.slice(2)) o.alive = false;
  giveCard(g, a, 'shrapnel-rounds'); a.pos = { x: 0, y: 0, z: -6 }; t.pos = { x: 0, y: 0, z: 0 };
  const b = g.spawnBullet(a, { x: 0, y: 1, z: -1.2 }, { x: 0, y: 0, z: 1 }, 30, false); const n0 = g.bullets.length;
  for (let i = 0; i < 4 && b.alive; i++) g.updateBullets(1 / 60);
  const frags = g.bullets.filter(x => x !== b && x.alive && x.noHit === t.id);
  check('shrapnel: bursts on a player hit, fragments skip that player', !b.alive && frags.length === 3 * Math.round(a.stats.shrapnel), 'frags ' + frags.length + ' of ' + (g.bullets.length - n0));
  const g2 = freshGame(); flat(g2); const p2 = g2.players[0]; giveCard(g2, p2, 'mine-layer'); const m0 = g2.mines.length;
  const { EFFECTS } = await J('effects.js'); EFFECTS.blockMines.onBlock(g2, p2, p2.stats.blockMines);
  check('mine layer: two mines with a normal gun', g2.mines.length - m0 === 2, String(g2.mines.length - m0));
}
// v1.1.2: lava maps: a bounce from underneath a floating platform goes up through it and lands on top
{
  const { movePlayer } = await J('physics.js');
  const g = freshGame(2, { mapSource: 'lava' }); const p = g.players[0];
  const s = g.solids.find(x => x.obj && !x.obj.pushable && !x.wall && x.min.y > 1.1 && x.max.x - x.min.x > 2 && x.max.z - x.min.z > 2);
  if (!s) check('lava: a floating platform to test under', false);
  else {
    const cx = (s.min.x + s.max.x) / 2, cz = (s.min.z + s.max.z) / 2, top = s.max.y;
    p.pos = { x: cx, y: 0, z: cz }; p.vel = { x: 0, y: 19, z: 0 }; let maxY = 0, landed = false;
    for (let i = 0; i < 120; i++) { movePlayer(p, 1 / 60, g.level, g.solids); p.pos.x = cx; p.pos.z = cz; maxY = Math.max(maxY, p.pos.y); if (p.onGround && p.pos.y > 1) { landed = true; break; } }
    check('lava: bouncing up under a platform passes through and lands on top', landed && Math.abs(p.pos.y - top) < 0.3, 'y ' + p.pos.y.toFixed(2) + ' top ' + top.toFixed(2) + ' max ' + maxY.toFixed(2));
    const q = g.players[1]; q.pos = { x: cx, y: top + 1, z: cz }; q.vel = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 60; i++) { movePlayer(q, 1 / 60, g.level, g.solids); q.pos.x = cx; q.pos.z = cz; }
    check('lava: platforms are still solid from above', q.onGround && Math.abs(q.pos.y - top) < 0.3, 'y ' + q.pos.y.toFixed(2));
  }
}
// v1.1.4: Twin Barrel doubles bullets per shot, whenever it's taken
{
  const g = freshGame(); const p = g.players[0];
  giveCard(g, p, 'twin-barrel'); const one = p.stats.projectiles;
  const extra = cards.find(c => c.id !== 'twin-barrel' && c.modifiers.length && c.modifiers.every(m => m.stat === 'projectiles' && m.op === 'add' || m.stat !== 'projectiles') && c.modifiers.some(m => m.stat === 'projectiles' && m.op === 'add' && m.value >= 1) && c.rarity !== 'cursed');
  giveCard(g, p, extra.id); const add = extra.modifiers.find(m => m.stat === 'projectiles').value;
  check('twin barrel: 1 -> 2, and doubles bullets from cards taken after it', one === 2 && p.stats.projectiles === Math.min(12, Math.round((1 + add) * 2)), one + ' then ' + p.stats.projectiles + ' (' + extra.id + ')');
  check('twin barrel is legendary', cards.find(c => c.id === 'twin-barrel').rarity === 'legendary');
}
// ---- v1.2.8: free encores, Bullet Hose keeps Twin Barrel's doubling, squid / bees carry bullet traits, Gun Nest turret
{
  const g = freshGame(); flat(g); const [a, e] = g.players; a.isBot = false; e.isBot = false; e.reviving = true; e.reviveT = 999;
  a.stats.encore = 1; a.ammo = 1; a.fireT = 0; a.reloadT = 0; a.input.shoot = false; a.pos = { x: 0, y: 0, z: 0 }; a.aim = { x: 1, y: 0, z: 0 };
  g.tryShoot(a); const n0 = g.bullets.length;
  check('encore: last round of the mag still gets its encore', a.ammo === 0 && a.reloadT > 0, `ammo ${a.ammo} reload ${a.reloadT}`);
  for (let i = 0; i < 12; i++) g.step(1 / 60);
  check('encore: fired while reloading, for free', g.bullets.length > n0 && a.ammo === 0, `${n0} -> ${g.bullets.length}`);
  for (const id of ['encore-engine', 'standing-ovation', 'echo-fire', 'stutter-trigger']) {
    const c = cardById.get(id); check('encore card text says it is free: ' + id, /no ammo/.test(c.description + ' ' + (c.details || '')) && !/if you have the ammo|ammo allows|while ammo lasts/.test(c.description + (c.details || '') + (c.holyDescription || '')));
  }
}
{
  const g = freshGame(); const p = g.players[0];
  p.cards = []; giveCard(g, p, 'twin-barrel'); const twin = p.stats.projectiles;
  p.cards.push('rapid-cycler'); g.checkCombos(p); g.recompute(p);
  check('bullet hose forms and keeps the doubling (1 -> 2)', p.cards.includes('bullet-hose') && !p.cards.includes('twin-barrel') && p.stats.projectiles === 2 && twin === 2, `${p.cards} ${p.stats.projectiles}`);
  giveCard(g, p, 'hydra-rounds');
  check('bullet hose doubles later bullets too ((1+2) x 2 = 6)', p.stats.projectiles === 6, String(p.stats.projectiles));
  check('bullet hose card shows x2 bullets per shot', cardById.get('bullet-hose').modifiers.some(m => m.stat === 'projMul' && m.value === 2));
}
for (const kind of ['squid', 'bees']) {
  const g = freshGame(); flat(g); const [a, e] = g.players; a.isBot = false; e.isBot = false; e.reviving = true; e.reviveT = 999;   // (no target, but the round goes on)
  a.cards = []; for (const id of [kind, 'ricochet-rounds', 'splinter-bounce', 'napalm-rounds', 'wide-shells']) giveCard(g, a, id);
  g.level.solids.push({ min: { x: 4, y: 0, z: -5 }, max: { x: 5, y: 4, z: 5 } }); g.refreshSolids();
  a.pos = { x: 0, y: 0, z: 0 }; a.aim = { x: 1, y: 0, z: 0 };
  const plain = freshGame(); const pl = plain.players[0]; pl.cards = []; giveCard(plain, pl, kind);
  const b = g.spawnBullet(a, { x: 2.5, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }, 10, false); b.vel = { x: 10, y: 0, z: 0 };
  check(kind + ': bullets take bullet size', b.r > plain.effSize(pl.stats, plain.effDamage(pl.stats)) * 1.2, `${b.r}`);
  const bl0 = b.bLeft; let evs = [];
  for (let i = 0; i < 90; i++) { g.step(1 / 60); evs.push(...g.takeEvents()); }
  check(kind + ': bullets bounce off walls (while they have bounces)', b.bLeft < bl0 && evs.some(x => x.t === 'bounce'), `${bl0} -> ${b.bLeft}`);
  check(kind + ': bounces split them', g.bullets.some(q => q.splitChild && q.swarm), String(g.bullets.length));
  check(kind + ': napalm splats on the wall', evs.some(x => x.t === 'napalm'));
  g.bullets = []; g.takeEvents();
  const c = g.spawnBullet(a, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 10, false); c.life = 0.01; c.bLeft = 0;
  g.step(1 / 60); evs = g.takeEvents();
  check(kind + ': a bullet that times out still drops its napalm', !c.alive && evs.some(x => x.t === 'napalm'));
}
{ // Gun Nest
  const g = freshGame(3); flat(g); const [p, e, f] = g.players; for (const q of g.players) { q.isBot = false; q.input.mx = 0; q.input.mz = 0; }
  f.team = p.team; p.pos = { x: 0, y: 0, z: 0 }; e.pos = { x: 12, y: 0, z: 0 }; f.pos = { x: -6, y: 0, z: 0 }; p.aim = { x: 1, y: 0, z: 0 };
  p.cards = []; for (const id of ['shield-gun-nest', 'heavy-slugs', 'ricochet-rounds', 'napalm-rounds']) giveCard(g, p, id);
  check('gun nest: a shield mod', p.smod === 'mount' && cardById.get('shield-gun-nest').rarity === 'shieldmod' && fs.existsSync(path.join(root, 'cards/shield-gun-nest/art.png')));
  p.blockCdT = 0; g.tryBlock(p);
  const u = g.players.find(q => q.kind === 'mount');
  check('gun nest: block builds a turret', !!u && u.casterId === p.id && u.alive && p.blockT > 0);
  check('gun nest: health = caster max health, fires twice as fast, same bullets', u && u.stats.health === Math.round(g.maxHp(p)) && Math.abs(u.stats.fireRate - 2 * p.stats.fireRate) < 1e-9 &&
    u.stats.damage === p.stats.damage && u.stats.bounces === p.stats.bounces && u.stats.napalm === p.stats.napalm && u.stats.bulletSize === p.stats.bulletSize && u.stats.moveSpeed === 0);
  check('gun nest: placed beside you, clear of you and walls', u && Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z) > 0.9 && Math.abs(u.pos.x - p.pos.x) < 0.5 && !g.solids.some(s => u.pos.x + 0.4 > s.min.x && u.pos.x - 0.4 < s.max.x && u.pos.z + 0.4 > s.min.z && u.pos.z - 0.4 < s.max.z && s.max.y > u.pos.y + 0.2));
  p.blockCdT = 0; g.tryBlock(p);
  check('gun nest: only one at a time', g.players.filter(q => q.kind === 'mount' && q.alive).length === 1);
  // a deployable aimed at it lands clear of it
  const pa = { ...p.aim }; p.aim = norm3({ x: u.pos.x - p.pos.x, y: 0, z: u.pos.z - p.pos.z }); p.fx.deploy = null;
  const w = g.placeWall(p, 'sandbag', 100); p.aim = pa;
  const fx = -Math.sin(w.ang), fz = Math.cos(w.ang), dx = u.pos.x - w.x, dz = u.pos.z - w.z;
  check('gun nest: walls are never dropped onto it', Math.abs(dx * fz - dz * fx) > w.len / 2 + 0.3 || Math.abs(dx * fx + dz * fz) > w.th / 2 + 0.3, `${w.x.toFixed(2)},${w.z.toFixed(2)} vs ${u.pos.x.toFixed(2)},${u.pos.z.toFixed(2)}`);
  g.barricades = []; g.refreshSolids();
  const cs = g.freeSpot(u.pos.x, u.pos.z, u.pos.x + 3, u.pos.z, 0.45, 0);
  check('gun nest: units spawn clear of it', Math.hypot(cs.x - u.pos.x, cs.z - u.pos.z) > 0.8);
  const hp0 = u.hp; run(g, 2);
  check('gun nest: slowly loses health', u.hp < hp0 && u.hp > hp0 * 0.9, `${hp0} -> ${u.hp}`);
  const h1 = u.hp; u.hp += 50; g.step(1 / 60); g.takeEvents();
  check('gun nest: can never gain health', u.hp <= h1, `${h1} -> ${u.hp}`);
  const ux = u.pos.x, uz = u.pos.z; u.vel.x = 20; g.step(1 / 60); g.takeEvents();
  check('gun nest: cannot move', Math.hypot(u.pos.x - ux, u.pos.z - uz) < 1e-6);
  // man it (E), stand still, fire it at the crosshair
  p.pos = { x: u.pos.x - 1.2, y: 0, z: u.pos.z }; p.vel = { x: 0, y: 0, z: 0 }; g.step(1 / 60);
  p.input.useSeq = (p.input.useSeq | 0) + 1; g.step(1 / 60); g.takeEvents();
  check('gun nest: E mans it', p.fx.mount && p.fx.mount.id === u.id && u.riderId === p.id);
  const px = p.pos.x, pz = p.pos.z; p.input.mx = 1; p.input.jump = true; run(g, 0.5);
  check('gun nest: rider stands still', Math.hypot(p.pos.x - px, p.pos.z - pz) < 1e-6 && p.pos.y < 0.05, `${p.pos.x - px} ${p.pos.y}`);
  p.input.mx = 0; p.input.jump = false;
  const ammo0 = p.ammo, uam0 = u.ammo; p.aimPoint = { x: e.pos.x, y: g.chest(e), z: e.pos.z }; p.input.aimPoint = p.aimPoint; p.input.aim = norm3({ x: e.pos.x - p.pos.x, y: 0, z: e.pos.z - p.pos.z });
  p.input.shoot = true; g.step(1 / 60); g.takeEvents(); p.input.shoot = false;
  const tb = g.bullets.filter(b => b.owner === u.id);
  check('gun nest: the trigger fires the turret, not your gun', tb.length >= 1 && p.ammo === ammo0 && u.ammo === uam0 - 1, `${tb.length} ${p.ammo}/${ammo0} ${u.ammo}/${uam0}`);
  check('gun nest: shots carry the stats (size, bounces, napalm) and aim at the crosshair', tb[0] && tb[0].napalm > 0 && tb[0].bLeft === Math.round(p.stats.bounces) && Math.abs(tb[0].r - g.effSize(p.stats, g.effDamage(p.stats))) < 1e-9 && tb[0].vel.x > Math.abs(tb[0].vel.z) * 3);
  check('gun nest: fires twice as fast', Math.abs(u.fireT - 1 / (2 * p.stats.fireRate)) < 0.02, `${u.fireT}`);
  const sn = g.snapshot(), row = sn.pl.find(r => r[0] === p.id);
  check('gun nest: manning goes out in the snapshot, the turret in the unit list', row && row[row.length - 1][8] === u.id && g.unitList().some(x => x.id === u.id && x.kind === 'mount'));
  check('gun nest: no move prediction while manning', !g.predRows().some(r => r[0] === p.id && r[4] === 1));
  // get off; anyone else (even an enemy) can man it, keeping the turret's stats; its shots are theirs
  p.input.useSeq++; g.step(1 / 60); g.takeEvents();
  check('gun nest: E again gets off', !p.fx.mount && !u.riderId);
  const fr = u.stats.fireRate;
  e.pos = { x: u.pos.x, y: 0, z: u.pos.z + 1.2 }; g.step(1 / 60); e.input.useSeq = (e.input.useSeq | 0) + 1; g.step(1 / 60); g.takeEvents();
  check('gun nest: an enemy can man it, and it fights for them', e.fx.mount && e.fx.mount.id === u.id && g.isEnemy(u, p) && !g.isEnemy(u, e) && u.stats.fireRate === fr);
  e.input.useSeq++; g.step(1 / 60); g.takeEvents();
  check('gun nest: back to its caster when they get off', !g.isEnemy(u, p) && u.ownerId === p.id);
  // it wears out; then a new block builds a new one
  u.hp = 0.01; u.hpCap = 0.01; g.step(1 / 60); g.takeEvents(); g.step(1 / 60); g.takeEvents();
  check('gun nest: runs out and is gone', !g.players.includes(u));
  p.blockCdT = 0; g.tryBlock(p);
  check('gun nest: a new one after the old one is gone', g.players.some(q => q.kind === 'mount' && q.alive && q !== u));
}
for (const [mode, extra] of [['tdm', {}], ['waves', {}], ['waves', { core: true }]]) {   // Gun Nest in the main modes
  const g = new Game({ roster: roster(4, { teams: mode === 'tdm' ? 2 : 0 }), settings: { mode, mapSource: 'generated', ...extra }, cards }); g.start();
  run(g, 9, 1 / 60, gg => { if (gg.phase === 'picking') for (const q of gg.heroes()) if (q.offer) gg.pick(q.id, q.offer[0]); });
  const p = g.heroes()[0]; p.cards = p.cards.filter(id => !(cardById.get(id) || {}).shieldMod); giveCard(g, p, 'shield-gun-nest');
  let err = null, got = false;
  try { for (let i = 0; i < 900; i++) { if ((g.phase === 'play' || g.phase === 'countdown') && p.alive && !got) { p.blockCdT = 0; g.tryBlock(p); got = g.players.some(q => q.kind === 'mount' && q.alive); } g.step(1 / 60); g.takeEvents(); } JSON.stringify(g.snapshot()); }
  catch (x) { err = x; console.log(x.stack); }
  check('gun nest works in ' + mode + (extra.core ? ' core' : ''), !err && got, `${g.phase} ${err && err.message}`);
}
console.log(`baseline: ${passes} passed, ${fails} failed, ${(Date.now() - t0) / 1000}s`);
if (fails) process.exitCode = 1;
