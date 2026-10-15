// Co-op waves: difficulty, the "Game Master" that buys each wave from a credit budget, Elite bots,
// and the final boss (telegraphed area attacks, portals, phases). Runs on the host inside sim.js.
import { DEFAULT_STATS, RULES } from './config.js';
import { weightedOffer, applyCard, finishStats } from './cards.js';
import { recommend, cardEffects } from './synergy.js';
import { groundBelow, pointInSolid } from './physics.js';
import { detour } from './ai.js';
import { boundaryPoint, edgeDistance, arenaEdges } from './levelgen.js';
import { sideEdgeSpots } from './side.js';

const PR = RULES.playerRadius;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WAVE_COLORS = ['#ff5f5f', '#ff7f50', '#e04a6a', '#ff9a6b'];

// ---------------------------------------------------------------- difficulty
// budget: Game Master credits; hp/dmg: enemy stat scaling; elite: chance an Elite is bought (from wave eliteFrom);
// boss*: boss health/damage; windup: telegraph time multiplier (bigger = more time to dodge);
// cd: boss cooldown multiplier; extra: extra boss projectiles / circles / portals; maxCasts: boss attacks at once.
export const COOP_DIFFICULTY = {
  easy:      { label: 'Easy',      budget: 0.7,  hp: 0.8,  dmg: 0.85, elite: 0.22, eliteFrom: 4, eliteCards: -1, bossHp: 0.7,  bossDmg: 0.75, windup: 1.3,  cd: 1.25, extra: 0, maxCasts: 1 },
  normal:    { label: 'Normal',    budget: 1,    hp: 1,    dmg: 1,    elite: 0.38, eliteFrom: 3, eliteCards: 0,  bossHp: 1,    bossDmg: 1,    windup: 1,    cd: 1,    extra: 0, maxCasts: 1 },
  hard:      { label: 'Hard',      budget: 1.35, hp: 1.2,  dmg: 1.12, elite: 0.55, eliteFrom: 3, eliteCards: 1,  bossHp: 1.35, bossDmg: 1.2,  windup: 0.88, cd: 0.85, extra: 1, maxCasts: 2 },
  nightmare: { label: 'Nightmare', budget: 1.75, hp: 1.45, dmg: 1.25, elite: 0.75, eliteFrom: 2, eliteCards: 2,  bossHp: 1.75, bossDmg: 1.4,  windup: 0.78, cd: 0.72, extra: 2, maxCasts: 2 },
};
const LEGACY = { relaxed: 'easy', brutal: 'hard' };   // the old three-step wave difficulty
export function coopDiffKey(settings) { const k = LEGACY[settings.waveDifficulty] || settings.waveDifficulty; return COOP_DIFFICULTY[k] ? k : 'normal'; }
export const coopDiff = settings => COOP_DIFFICULTY[coopDiffKey(settings)];

// ---------------------------------------------------------------- Game Master
// Every enemy has a credit cost. Each wave gets a budget from the wave number, squad size and difficulty,
// and the Game Master spends it on a mix of units it has unlocked by then.
export const UNIT_COSTS = { critter: 1, wave: 2, splitter: 3, turret: 3, drone: 3, elite: 8, portal: 6, boss: 40, hulk: 7 };
const UNIT_PLAN = {   // from: first wave it can appear; weight: how often it's bought; max: per wave
  critter:  { from: 1, weight: 3 },
  wave:     { from: 1, weight: 4 },
  splitter: { from: 2, weight: 1.6 },
  turret:   { from: 3, weight: 1.1, max: 2 },
  drone:    { from: 4, weight: 1.2, max: 4 },
};
export const UNIT_NAMES = { wave: 'Raider', drone: 'Drone', turret: 'Turret', critter: 'Critter', splitter: 'Blob', elite: 'Elite', portal: 'Portal', boss: 'The Warden', hulk: 'Sky Hulk' };
// v1.2.3 Core Defense: no enemy turrets (they can't reach the core), Sky Hulks (big slow fliers that bomb the core)
// late in the run, and from wave 3 most waves get a twist that changes what the Game Master buys.
// Sky Hulks come in the last stretch of the run (60% of the way through, so wave 3 of 5 or wave 6 of 10).
const HULK = { weight: 0.8 }, hulkFrom = g => Math.max(3, Math.min(12, Math.ceil((g.settings.roundsToWin || 5) * 0.6)));
export const CORE_TWISTS = {
  swarm: { name: 'Swarm', text: 'a flood of critters', w: { critter: 3.5 }, budget: 1.15 },
  heavy: { name: 'Heavy raid', text: 'blobs and brutes', w: { splitter: 3, critter: 0.5 }, brute: 0.45 },
  air:   { name: 'Air raid', text: 'drones overhead', w: { drone: 4 }, max: { drone: 9 }, from: 4 },
  rush:  { name: 'Rush', text: 'faster raiders', speed: 1.22 },
  elite: { name: 'Elite escort', text: 'an elite leads the raid', elite: 1, from: 5 },
  hulks: { name: 'Sky Hulks', text: 'giant fliers bombing the core', w: { hulk: 4 }, max: { hulk: 3 }, hulks: true },
};
function coreTwist(g, rng) {
  if (g.round < 3 || isBossWave(g) || rng() < 0.3) return null;
  const opts = Object.keys(CORE_TWISTS).filter(k => k !== g.coreLastTwist && g.round >= (CORE_TWISTS[k].hulks ? hulkFrom(g) + 1 : CORE_TWISTS[k].from || 3));
  return opts[Math.floor(rng() * opts.length)] || null;
}
export function waveBudget(wave, heroes, D) { return (2 + 1.5 * wave) * (1 + 0.45 * Math.max(0, heroes - 1)) * D.budget; }
// Squad scaling (lobby "Scale to squad size"): how much each extra hero counts toward the Game Master's budget,
// boss health and (on Strong) enemy toughness. Off = the waves are sized for one hero however many are fighting.
const SCALE_K = { off: 0, standard: 1, strong: 1.6 };
export const scaleKey = g => (SCALE_K[g.settings.coopScale] != null ? g.settings.coopScale : 'standard');
export function squadSize(g, heroes) { return 1 + Math.max(0, heroes - 1) * SCALE_K[scaleKey(g)]; }
const liveHeroes = g => Math.max(1, g.heroes().filter(h => h.connected).length);
// Each boss kill makes the run substantially harder (after "Keep playing" on a win).
export const bossTier = g => g.bossKills || 0;
export const ngPlus = g => 1 + 0.4 * bossTier(g);
export function gmBudget(g, heroes, wave = g.round) { return waveBudget(wave, squadSize(g, heroes), coopDiff(g.settings)) * ngPlus(g); }
export const isBossWave = g => g.isWaves() && g.round >= g.settings.roundsToWin;

// Buy a wave. Returns { units: [type...], budget, spent, boss }.
export function planWave(g, heroes, rng = Math.random) {
  const D = coopDiff(g.settings), w = g.round, boss = isBossWave(g), core = !!g.settings.core;
  const tw = core ? coreTwist(g, rng) : null, T = tw ? CORE_TWISTS[tw] : {};
  if (core) { g.coreTwist = tw; if (tw) g.coreLastTwist = tw; }
  const PLAN = core ? { ...UNIT_PLAN, hulk: { ...HULK, from: hulkFrom(g), max: 1 + Math.floor(Math.max(0, w - hulkFrom(g)) / 4) } } : UNIT_PLAN;
  if (core) delete PLAN.turret;
  let budget = gmBudget(g, heroes) * (boss ? 1.5 : 1) * (T.budget || 1);
  const total = budget, units = [];
  if (boss) budget -= Math.min(budget * 0.6, UNIT_COSTS.boss);   // the Warden takes most of the final wave's budget
  // Elites show up now and then (never on the boss wave's escort, the boss brings its own through portals).
  if (!boss && (T.elite || (w >= D.eliteFrom && rng() < D.elite)) && budget >= UNIT_COSTS.elite + 1) {
    const n = 1 + (budget >= UNIT_COSTS.elite * 3 && rng() < D.elite * 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) { units.push('elite'); budget -= UNIT_COSTS.elite; }
  }
  const count = {};
  if (core && w >= hulkFrom(g) && (w === hulkFrom(g) || boss || rng() < 0.6)) {   // late game: a Sky Hulk (always on the first late wave and the last one)
    units.push('hulk'); count.hulk = 1; budget -= Math.min(budget * 0.6, UNIT_COSTS.hulk);
  }
  for (let guard = 0; guard < 80 && budget >= 1; guard++) {
    const wt = (t, u) => u.weight * ((T.w && T.w[t]) || 1), mx = (t, u) => (T.max && T.max[t]) || u.max;
    const opts = Object.entries(PLAN).filter(([t, u]) => (w >= u.from || (T.w && T.w[t] > 1 && w >= 3)) && UNIT_COSTS[t] <= budget + 1e-6 && !(mx(t, u) && (count[t] || 0) >= mx(t, u)));
    if (!opts.length) break;
    let r = rng() * opts.reduce((a, [t, u]) => a + wt(t, u), 0), pick = opts[0][0];
    for (const [t, u] of opts) { r -= wt(t, u); if (r <= 0) { pick = t; break; } }
    units.push(pick); count[pick] = (count[pick] || 0) + 1; budget -= UNIT_COSTS[pick];
  }
  if (!units.length && !boss) units.push('critter');
  // Raiders and elites first so the opening group always has some gunfire, then the rest shuffled.
  const lead = units.filter(t => t === 'elite' || t === 'wave').slice(0, 2);
  const rest = units.slice(); for (const t of lead) rest.splice(rest.indexOf(t), 1);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return { units: [...lead, ...rest], budget: total, spent: total - budget, boss };
}

// Split a planned wave into the opening group and up to two reinforcement groups.
// style (lobby "Game Master spawning"): 'all' = everything at once, 'waves' = always in groups,
// 'auto' = the Game Master picks per wave, but critters and turrets always trickle in so one explosion can't wipe them all.
const TRICKLE = new Set(['critter', 'turret']);
export function splitWave(plan, heroes, style = 'auto', rng = Math.random) {
  if (style === 'all') return [plan.units.slice()];
  if (style === 'auto' && plan.units.length > 4 && rng() < 0.35) {
    // all at once for the fighters, the critters and turrets held back and sent in two later groups
    const now = plan.units.filter(t => !TRICKLE.has(t)), later = plan.units.filter(t => TRICKLE.has(t));
    if (now.length >= 3 && later.length) { const h = Math.ceil(later.length / 2); return [now, later.slice(0, h), ...(later.length > h ? [later.slice(h)] : [])].filter(gr => gr.length); }
  }
  const groups = splitGroups(plan, heroes);
  if (groups.length < 2) return groups;
  // keep at most a third of the critters/turrets in the opening group; push the rest into later groups
  const first = groups[0], tr = first.filter(t => TRICKLE.has(t)), keep = Math.ceil(tr.length / 3);
  let moved = 0;
  for (let i = first.length - 1; i >= 0 && tr.length - moved > keep; i--) if (TRICKLE.has(first[i])) { groups[1 + (moved % (groups.length - 1))].push(first.splice(i, 1)[0]); moved++; }
  return groups;
}
function splitGroups(plan, heroes) {
  const cap = clamp(6 + heroes * 2, 6, 16), cost = t => UNIT_COSTS[t] || 1, all = plan.units.slice();
  const value = all.reduce((a, t) => a + cost(t), 0);
  if (all.length <= 4 || value < 10) return [all.slice(0, cap), ...(all.length > cap ? [all.slice(cap)] : [])];
  const first = [], groups = [];
  let v = 0;
  while (all.length && (first.length < 3 || (v < value * 0.62 && first.length < cap))) { const t = all.shift(); first.push(t); v += cost(t); }
  if (all.length) { const half = all.length > 5 ? Math.ceil(all.length / 2) : all.length; groups.push(all.splice(0, half)); if (all.length) groups.push(all); }
  return [first, ...groups];
}

// ---------------------------------------------------------------- enemy stats
function tier(g, w, D) { const t = w <= 2 ? 0 : w <= 5 ? 1 : 2; return ['easy', 'normal', 'hard'][Math.min(2, t + (D === COOP_DIFFICULTY.nightmare ? 1 : 0) - (D === COOP_DIFFICULTY.easy && t > 0 ? 1 : 0))]; }
// Stats for one enemy. Standard wave bots never get cards; only Elites carry upgrades.
export function unitSpec(g, type, idx) {
  const D = coopDiff(g.settings), n = Math.max(1, g.round), ng = ngPlus(g);
  const squadHp = scaleKey(g) === 'strong' ? 1 + 0.07 * (liveHeroes(g) - 1) : 1;
  const hpK = (1 + 0.14 * (n - 1)) * D.hp * ng * squadHp, dmgK = (1 + 0.08 * (n - 1)) * D.dmg * (1 + 0.15 * bossTier(g));
  const stats = { ...DEFAULT_STATS }, spec = { stats, cards: [], difficulty: tier(g, n, D), unitKind: type, color: WAVE_COLORS[idx % WAVE_COLORS.length], name: `${UNIT_NAMES[type] || 'Raider'} ${idx + 1}` };
  stats.health *= hpK; stats.damage *= dmgK;
  const fixedK = hpK / ((1 + 0.14 * (n - 1)) * D.hp);   // boss-kill and squad scaling for the units with fixed health
  if (type === 'drone') Object.assign(stats, { health: (30 + n * 4) * D.hp * fixedK, damage: (7 + n * 0.5) * dmgK / (1 + 0.08 * (n - 1)), moveSpeed: 7.5, fireRate: 4, bulletSize: 0.1 });
  if (type === 'turret') Object.assign(stats, { moveSpeed: 0, jump: 0, projectiles: stats.projectiles + 1, spread: 0.08, health: stats.health * 1.4 });
  if (type === 'critter') { Object.assign(stats, { health: (22 + n * 4) * D.hp * fixedK, moveSpeed: 10.5, jump: 7 }); spec.color = '#c25a3c'; spec.melee = (8 + n) * dmgK / (1 + 0.08 * (n - 1)); }
  // Blob: big and tanky, splits twice (children get BLOB.childHp of the parent's health and move faster); its touch poisons.
  if (type === 'splitter') { Object.assign(stats, { health: (175 + n * 28) * D.hp * fixedK, moveSpeed: 4.4, jump: 0 }); spec.color = '#7ee36b'; spec.melee = (14 + n) * dmgK / (1 + 0.08 * (n - 1)); }
  // 2D side view: pits and blocks can only be crossed by jumping, so the melee units need a real jump there
  if (g.isSide && g.isSide()) { if (type === 'critter') stats.jump = DEFAULT_STATS.jump; if (type === 'splitter') stats.jump = DEFAULT_STATS.jump * 0.85; }
  if (type === 'elite') {
    const k = clamp(3 + Math.floor(n / 3) + D.eliteCards, 2, 8), cards = eliteCards(g, k);
    for (const id of cards) { const c = g.cardById.get(id); if (c) applyCard(stats, c); }
    finishStats(stats);
    stats.health *= 1.9; stats.damage *= 1.1;
    Object.assign(spec, { cards, difficulty: 'hard', color: '#d94dff', name: `Elite ${eliteTitle(g, cards)}`, cosmetics: { hat: 'crown', face: 'none', eyes: 'shades', neck: 'medal', gun: 'gold' }, unitKind: 'elite' });
  }
  return spec;
}

// A fresh, somewhat synergistic hand for every Elite: one random card, then each next card is the best
// fit (by the card-tip synergy scores) out of a small random handful, with a little randomness left in.
function elitePool(g) {
  return g._elitePool || (g._elitePool = g.allCards.filter(c => !c.special && !c.combo && c.rarity !== 'combo' && !c.modes && c.rarity !== 'cursed' && c.rarity !== 'holy' && !c.weaponMod && !c.shieldMod && !c.unique));
}
export function eliteCards(g, n, rng = Math.random) {
  const pool = elitePool(g), picked = [];
  if (!pool.length) return [];
  const first = weightedOffer(pool, 1)[0]; if (first) picked.push(first);
  for (let k = 1; k < n; k++) {
    const left = pool.filter(c => !picked.includes(c));
    if (!left.length) break;
    const hand = weightedOffer(left, Math.min(8, left.length));
    const { scores } = recommend(hand, picked);
    let best = hand[0], bs = -Infinity;
    for (const c of hand) { const s = (scores.get(c.id) || { score: 0 }).score + rng() * 0.9; if (s > bs) { bs = s; best = c; } }
    picked.push(best);
  }
  return picked.map(c => c.id);
}
const TITLES = [['explosive', 'Bomber'], ['homing', 'Hunter'], ['bounces', 'Trickster'], ['poison', 'Venomist'], ['ignite', 'Pyro'], ['chill', 'Cryo'],
  ['chain', 'Stormcaller'], ['lifesteal', 'Leech'], ['regen', 'Troll'], ['health', 'Juggernaut'], ['fireRate', 'Gunner'], ['projectiles', 'Spreader'],
  ['damage', 'Brute'], ['moveSpeed', 'Skirmisher'], ['bulletSpeed', 'Marksman'], ['ammo', 'Gunner'], ['blockCooldown', 'Guardian']];
function eliteTitle(g, ids) {
  const count = {};
  for (const id of ids) { const c = g.cardById.get(id); if (c) for (const s of cardEffects(c).up) count[s] = (count[s] || 0) + 1; }
  let best = 'Raider', bc = 0;
  for (const [s, t] of TITLES) if ((count[s] || 0) > bc) { bc = count[s]; best = t; }
  return best;
}

// Where reinforcements come in: a spot on the wave's side of the arena, as far from the squad as possible.
export function enemySideSpots(g, n) {
  const L = g.level, heroes = g.players.filter(p => p.kind === 'hero' && p.alive);
  const hx = heroes.length ? heroes.reduce((a, p) => a + p.pos.x, 0) / heroes.length : -L.hx;
  if (L.side) return sideEdgeSpots(L, hx > 0 ? -1 : 1, n);   // 2D side view: on solid ground at the far end
  const base = hx > 0 ? Math.PI : 0, pts = [];
  for (let k = 0; k < n; k++) {
    const p = boundaryPoint(L, base + (k - (n - 1) / 2) * 0.1, 1.8 + Math.floor(k / 8) * 1.9);
    pts.push(g.freeSpot(p.x, p.z, 0, 0, 0.6, 0.2));
  }
  return pts;
}

// ---------------------------------------------------------------- the final boss
// Three bosses, one per final wave in turn (random order each run). abilities: [name, unlock phase, base cooldown, weight].
// volley: the basic orb fan (every: seconds between fans, n: base orbs). Telegraphed attacks are the main threat;
// the orbs are kept slow and rare so the bosses don't just out-shoot the squad.
export const BOSSES = {
  warden: { name: 'The Warden', size: 2.8, hp: 1600, hpPerHero: 1300, speed: 3.4, color: '#6a3fb5', volley: { every: 4.2, n: 2, speed: 15 },
    abilities: [['cleave', 1, 4.5, 3], ['meteors', 1, 7, 3], ['leap', 1, 10, 1.4], ['beams', 2, 8, 2.4], ['quake', 2, 9.5, 2], ['inout', 2, 12, 2], ['portals', 2, 18, 2.2], ['cross', 3, 11, 2.2]] },
  brood: { name: 'The Brood Mother', size: 3.0, hp: 1900, hpPerHero: 1450, speed: 2.8, color: '#4f8f3a', volley: { every: 5, n: 2, speed: 12 },
    abilities: [['spit', 1, 5.5, 3], ['cleave', 1, 5, 2], ['brood', 1, 13, 2], ['quake', 2, 10, 2], ['leap', 2, 12, 1.2], ['inout', 2, 12, 1.8], ['portals', 3, 20, 1.6]] },
  storm: { name: 'The Storm Engine', size: 2.6, hp: 1400, hpPerHero: 1150, speed: 4.4, color: '#2f7fd1', volley: { every: 3.6, n: 1, speed: 22 },
    abilities: [['beams', 1, 6.5, 3], ['charge', 1, 8, 2.6], ['meteors', 1, 8, 2], ['ring', 2, 10, 2.2], ['cross', 2, 11, 2.2], ['inout', 2, 12, 1.6], ['portals', 3, 18, 1.6]] },
};
export const BOSS = BOSSES.warden;
const KIND = { circle: 1, donut: 2, cone: 3, line: 4, portal: 5, leap: 6 };
function nextBossType(g) {
  if (!g.bossOrder) { const k = Object.keys(BOSSES); for (let i = k.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [k[i], k[j]] = [k[j], k[i]]; } g.bossOrder = k; }
  return g.bossOrder[bossTier(g) % g.bossOrder.length];
}

export function spawnBoss(g, pt, heroes) {
  const D = coopDiff(g.settings), w = Math.max(1, g.round), type = nextBossType(g), T = BOSSES[type];
  const avgCards = heroes.length ? heroes.reduce((a, p) => a + p.cards.length, 0) / heroes.length : 0;
  const hp = (T.hp + T.hpPerHero * squadSize(g, heroes.length)) * D.bossHp * (1 + 0.07 * Math.max(0, w - 3)) * (1 + 0.03 * avgCards) * ngPlus(g);
  const stats = { ...DEFAULT_STATS, health: Math.round(hp), damage: 15 * D.bossDmg * (1 + 0.04 * Math.max(0, w - 3)) * (1 + 0.15 * bossTier(g)), bulletSize: 0.34, bulletSpeed: T.volley.speed,
    moveSpeed: T.speed, jump: 0, fireRate: 1, ammo: 99, reloadTime: 1, projectiles: 1, spread: 0 };
  const b = g.spawnUnit('wave', null, pt, { stats, unitKind: 'boss', name: T.name, color: T.color, difficulty: 'hard', cosmetics: { boss: type } });
  b.fixedSize = T.size; b.heavy = true; b.noBlock = true; b.size = T.size;
  b.boss = { type, phase: 1, cd: {}, gap: 2.0, castT: 0, root: 0, fightT: 0, volleyT: 3, aggroT: 0, enraged: false, stuckT: 0, lx: pt.x, lz: pt.z, leap: null };
  g.boss = b;
  return b;
}

// Space King: a boss that fights for a player (owner) for the rest of the round. Warden or Storm Engine (the Brood Mother's
// eggs and the bosses' portals would spawn enemies, so the ally never casts those). Weaker than a wave boss, scaled to its owner.
export function spawnAllyBoss(g, owner, pt) {
  const type = Math.random() < 0.5 ? 'warden' : 'storm', T = BOSSES[type], w = Math.max(1, g.round);
  // v26 buff: more damage, faster attacks and movement (the King's own volleys and its telegraphed slams use KING_ALLY.dmg)
  const stats = { ...DEFAULT_STATS, health: Math.round(T.hp * 0.6 + 3 * g.maxHp(owner)), damage: 26 * (1 + 0.05 * Math.max(0, w - 3)), bulletSize: 0.36, bulletSpeed: T.volley.speed * 1.15,
    moveSpeed: T.speed * 1.5, jump: 0, fireRate: 1.7, ammo: 99, reloadTime: 0.7, projectiles: 1, spread: 0 };
  const b = g.spawnUnit('wave', null, pt, { stats, unitKind: 'boss', name: `${owner.name} Space King`, color: '#ffc928', difficulty: 'hard', cosmetics: { boss: type, gold: 1 } });
  b.ownerId = owner.id; b.team = owner.team;
  b.fixedSize = T.size; b.heavy = true; b.noBlock = true; b.size = T.size;
  b.boss = { type, phase: 1, cd: {}, gap: 1.3, castT: 0, root: 0, fightT: 0, volleyT: 2, aggroT: 0, enraged: false, stuckT: 0, lx: pt.x, lz: pt.z, leap: null, ally: true, dmgK: 1.6 };
  return b;
}

// Scaling knobs that change with difficulty, the wave number and how long the fight has run.
function bossScale(g, b) {
  const D = coopDiff(g.settings), B = b.boss, w = Math.max(1, g.round);
  const tempo = 1 + Math.min(0.6, B.fightT / 150);
  return {
    D, tempo,
    windup: D.windup * Math.max(0.8, 1 - B.fightT / 600),
    dmg: D.bossDmg * (1 + 0.04 * Math.max(0, w - 3)) * (1 + 0.15 * bossTier(g)) * (B.enraged ? 1.3 : 1) * (B.dmgK || 1),
    extra: D.extra + Math.floor(Math.max(0, w - 3) / 3) + bossTier(g) + (B.enraged ? 1 : 0) + (B.phase - 1),
    maxCasts: D.maxCasts + (B.enraged || (B.phase === 3 && D.maxCasts > 1) ? 1 : 0),
  };
}
const targets = (g, b) => g.players.filter(q => q.alive && !q.reviving && g.isEnemy(b, q) && q.kind !== 'hazardTurret');

function addTg(g, tg) {
  tg.id = g.nextTg = (g.nextTg || 0) + 1;
  tg.dur = tg.t; tg.seen = {};
  g.telegraphs.push(tg);
  return tg;
}

function cast(g, b, name) {
  const B = b.boss, S = bossScale(g, b), hs = targets(g, b);
  if (!hs.length) return;
  const near = hs.slice().sort((a, c) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) - Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z));
  const W = t => t * S.windup, owner = b.id, D = S.dmg, rec = { name, tgs: [] };
  const push = tg => rec.tgs.push(addTg(g, { owner, cast: name, ...tg }));
  g.emit({ t: 'bossCast', a: name, x: b.pos.x, y: b.pos.y + 3, z: b.pos.z });
  if (name === 'cleave') {
    const t = near[0], ang = Math.atan2(t.pos.z - b.pos.z, t.pos.x - b.pos.x);
    push({ kind: 'cone', x: b.pos.x, z: b.pos.z, ang, arc: 1.9, len: 11, t: W(1.3), dmg: 38 * D, follow: true });
    if (B.phase >= 3) push({ kind: 'cone', x: b.pos.x, z: b.pos.z, ang: ang + Math.PI, arc: 1.9, len: 11, t: W(1.3), dmg: 38 * D, follow: true });
    B.root = W(1.3) + 0.3; B.face = ang;
  } else if (name === 'meteors') {
    const n = hs.length + S.extra, L = g.level;
    for (let k = 0; k < n; k++) {
      let x, z;
      if (k < hs.length) { x = hs[k].pos.x + hs[k].vel.x * 0.25; z = hs[k].pos.z + hs[k].vel.z * 0.25; }
      else { const h = hs[k % hs.length], a = Math.random() * 6.28, r = 3 + Math.random() * 5; x = h.pos.x + Math.cos(a) * r; z = h.pos.z + Math.sin(a) * r; }
      const p = g.clampArena(x, z, 1);
      push({ kind: 'circle', x: p.x, z: p.z, r: 3.0, t: W(1.7) + k * 0.12, dmg: 34 * D });
    }
    if (S.D === COOP_DIFFICULTY.nightmare || B.enraged) for (const h of hs) push({ kind: 'circle', x: h.pos.x, z: h.pos.z, r: 2.6, t: W(1.7) + 1.4, dmg: 30 * D });
  } else if (name === 'beams') {
    for (const h of hs.slice(0, 4)) {
      const ang = Math.atan2(h.pos.z - b.pos.z, h.pos.x - b.pos.x);
      push({ kind: 'line', x: b.pos.x, z: b.pos.z, ang, len: 60, w: 2.4, t: W(1.5), dmg: 40 * D });
    }
    B.root = W(1.5) + 0.2;
  } else if (name === 'cross') {
    const a0 = Math.random() * Math.PI;
    for (let k = 0; k < 4; k++) push({ kind: 'line', x: b.pos.x, z: b.pos.z, ang: a0 + k * Math.PI / 2, len: 60, w: 2.8, t: W(1.6), dmg: 44 * D });
    if (S.extra >= 3) for (let k = 0; k < 4; k++) push({ kind: 'line', x: b.pos.x, z: b.pos.z, ang: a0 + Math.PI / 4 + k * Math.PI / 2, len: 60, w: 2.8, t: W(1.6) + 1.3, dmg: 44 * D });
    B.root = W(1.6) + (S.extra >= 3 ? 1.5 : 0.2);
  } else if (name === 'inout') {
    if (Math.random() < 0.5) push({ kind: 'donut', x: b.pos.x, z: b.pos.z, r0: 3.4, r: 16, t: W(2.0), dmg: 48 * D, follow: true });   // get IN close
    else push({ kind: 'circle', x: b.pos.x, z: b.pos.z, r: 7.5, t: W(2.0), dmg: 48 * D, follow: true });                           // get OUT
    B.root = W(2.0) + 0.2;
  } else if (name === 'quake') {
    B.root = W(1.2) + 0.2;
    push({ kind: 'donut', x: b.pos.x, z: b.pos.z, r0: 2.2, r: 3.0, t: W(1.2), dmg: 0, wave: { speed: 9 + S.extra, maxR: 34, w: 1.0, dmg: 28 * D }, follow: true });
  } else if (name === 'leap') {
    const far = B.ally ? (B.tgt && B.tgt.alive ? B.tgt : near[0]) : near[near.length - 1];   // an ally king leaps onto the foe it fights
    const p = B.ally ? g.freeSpot(far.pos.x, far.pos.z, b.pos.x, b.pos.z, 1.2, far.pos.y + 0.2) : g.freeSpot(far.pos.x, far.pos.z, 0, 0, 1.2, 0.2);
    push({ kind: 'leap', x: p.x, z: p.z, y: p.y, r: 4.5, t: W(1.8), dmg: 40 * D });
    B.leap = { fromX: b.pos.x, fromZ: b.pos.z, fromY: b.pos.y, x: p.x, z: p.z, t: W(1.8), dur: W(1.8) };
    B.root = W(1.8) + 0.4;
  } else if (name === 'spit') {   // Brood Mother: acid globs on each hero that leave a poison puddle
    const n = hs.length + Math.ceil(S.extra / 2);
    for (let k = 0; k < n; k++) {
      const h = hs[k % hs.length], off = k < hs.length ? 0 : 3 + Math.random() * 3, a = Math.random() * 6.28;
      const p = g.clampArena(h.pos.x + h.vel.x * 0.3 + Math.cos(a) * off, h.pos.z + h.vel.z * 0.3 + Math.sin(a) * off, 1);
      push({ kind: 'circle', x: p.x, z: p.z, r: 2.4, t: W(1.5) + k * 0.1, dmg: 20 * D, poison: true });
    }
  } else if (name === 'brood') {   // Brood Mother: egg sacs burst into critters (blobs from phase 3)
    const n = Math.min(5, 2 + Math.floor(S.extra / 2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.28 + Math.random(), p = g.clampArena(b.pos.x + Math.cos(a) * 5, b.pos.z + Math.sin(a) * 5, 1.5);
      push({ kind: 'circle', x: p.x, z: p.z, r: 1.8, t: W(1.8), dmg: 18 * D, spawn: B.phase >= 3 && k === 0 ? 'splitter' : 'critter' });
    }
  } else if (name === 'charge') {   // Storm Engine: a lane, then it rams down it
    const t = near[Math.floor(Math.random() * Math.min(2, near.length))], ang = Math.atan2(t.pos.z - b.pos.z, t.pos.x - b.pos.x);
    const len = clamp(Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z) + 4, 8, 30);
    push({ kind: 'line', x: b.pos.x, z: b.pos.z, ang, len, w: 3.2, t: W(1.3), dmg: 42 * D, dash: true });
    B.root = W(1.3) + 0.4; B.face = ang;
  } else if (name === 'ring') {   // Storm Engine: rings of lightning pulsing outward from where it stands
    const x = b.pos.x, z = b.pos.z;
    push({ kind: 'circle', x, z, r: 4, t: W(1.2), dmg: 30 * D });
    push({ kind: 'donut', x, z, r0: 4, r: 8, t: W(1.2) + 0.8, dmg: 30 * D });
    push({ kind: 'donut', x, z, r0: 8, r: 12.5, t: W(1.2) + 1.6, dmg: 30 * D });
    B.root = W(1.2) + 0.4;
  } else if (name === 'portals') {
    const n = Math.min(5, 2 + Math.floor(S.extra / 2) + (B.phase >= 3 ? 1 : 0));
    for (const p of portalSpots(g, b, n)) push({ kind: 'portal', x: p.x, z: p.z, r: 1.6, t: W(1.6), dmg: 0 });
  }
  B.casts = (B.casts || []).concat([rec]);
}

function portalSpots(g, b, n) {
  const L = g.level, hs = targets(g, b), out = [];
  for (let tries = 0; tries < 80 && out.length < n; tries++) {
    const x = (Math.random() * 2 - 1) * (L.hx - 2), z = (Math.random() * 2 - 1) * (L.hz - 2);
    if (!g.inArena(x, z, 2)) continue;
    const dn = Math.min(...hs.map(h => Math.hypot(h.pos.x - x, h.pos.z - z)));
    if (dn < 6.5 || dn > 15) continue;
    if (out.some(p => Math.hypot(p.x - x, p.z - z) < 4)) continue;
    const y = groundBelow(g.solids, x, z, 0.5);
    if (pointInSolid(g.solids, x, y + 0.8, z, 0.9)) continue;
    out.push({ x, z, y });
  }
  return out;
}

// Is q inside telegraph tg? (pad: extra margin, e.g. for bots deciding to dodge)
export function inTelegraph(tg, x, z, pad = 0) {
  const dx = x - tg.x, dz = z - tg.z, d = Math.hypot(dx, dz);
  switch (tg.kind) {
    case 'circle': case 'leap': return d < tg.r + pad;
    case 'donut': return d > tg.r0 - pad && d < tg.r + pad;
    case 'cone': {
      if (d > tg.len + pad) return false;
      if (d < 1 + pad) return true;
      const a = Math.atan2(dz, dx) - tg.ang, da = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      return da < tg.arc / 2 + pad / Math.max(1, d);
    }
    case 'line': {
      const ux = Math.cos(tg.ang), uz = Math.sin(tg.ang), along = dx * ux + dz * uz, side = Math.abs(-dx * uz + dz * ux);
      return along > -1.2 - pad && along < tg.len && side < tg.w / 2 + pad;
    }
    default: return false;
  }
}

function hitPlayer(g, b, q, dmg, fromX, fromZ, knock = 9) {
  const dx = q.pos.x - fromX, dz = q.pos.z - fromZ, d = Math.hypot(dx, dz) || 1, dir = { x: dx / d, y: 0, z: dz / d };
  if (g.shielded(q)) { g.blockedDamage(q, dmg); g.soakShield(q, dmg); g.emit({ t: 'block', p: q.id, x: q.pos.x, y: g.chest(q), z: q.pos.z }); return; }
  g.hurt(q, dmg, b, dir);
  q.vel.x += dir.x * knock / (q.size || 1); q.vel.z += dir.z * knock / (q.size || 1); q.vel.y += 3;
}

function resolve(g, b, tg) {
  const code = KIND[tg.kind];
  g.emit({ t: 'aoe', k: code, x: tg.x, z: tg.z, a: tg.r || tg.ang || 0, b: tg.r0 || tg.arc || tg.len || 0, c: tg.len || tg.w || 0, w: tg.w || 0, ang: tg.ang || 0 });
  if (tg.kind === 'portal') { openPortal(g, b, tg.x, tg.z); return; }
  if (tg.wave) { g.shockwaves.push({ id: tg.id, owner: tg.owner, x: tg.x, z: tg.z, r: tg.r, ...tg.wave, hit: new Set() }); return; }
  if (tg.kind === 'leap') {
    const B = b.boss; B.leap = null;
    b.pos = { x: tg.x, y: groundBelow(g.solids, tg.x, tg.z, (tg.y || 0) + 0.5), z: tg.z }; b.vel = { x: 0, y: 0, z: 0 };
    g.emit({ t: 'boom', x: tg.x, y: b.pos.y + 0.3, z: tg.z, r: tg.r, p: b.id });
  }
  for (const q of targets(g, b)) if (inTelegraph(tg, q.pos.x, q.pos.z, PR * (q.size || 1) * 0.5)) hitPlayer(g, b, q, tg.dmg, tg.kind === 'line' || tg.kind === 'cone' ? b.pos.x : tg.x, tg.kind === 'line' || tg.kind === 'cone' ? b.pos.z : tg.z);
  if (tg.poison) addBlotch(g, b, tg.x, tg.z, tg.r * 0.9, (4 + g.round * 0.5) * coopDiff(g.settings).dmg, 6);
  if (tg.spawn && g.gm) {
    const n = tg.spawn === 'critter' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const u = g.spawnWaveUnit(tg.spawn, g.freeSpot(tg.x + (k - 0.5), tg.z, tg.x, tg.z, 0.6, 0.2), g.gm.spawned++);
      u.vel = { x: (Math.random() - 0.5) * 4, y: 4, z: (Math.random() - 0.5) * 4 };
    }
    g.unitsChanged();
  }
  if (tg.dash) {
    const e = g.clampArena(tg.x + Math.cos(tg.ang) * tg.len * 0.92, tg.z + Math.sin(tg.ang) * tg.len * 0.92, 1.5), p = g.freeSpot(e.x, e.z, tg.x, tg.z, 1.2, 0.2);
    b.pos = { x: p.x, y: groundBelow(g.solids, p.x, p.z, 0.5), z: p.z }; b.vel = { x: 0, y: 0, z: 0 };
    g.emit({ t: 'boom', x: p.x, y: b.pos.y + 0.3, z: p.z, r: 2.5, p: b.id });
  }
}

// ---------------------------------------------------------------- poison puddles
// Left by the smallest blobs when they die and by the Brood Mother's spit: a flat low-fi puddle that adds a poison
// stack (DoT stacks, see sim.js updateStatus) to every enemy of its owner standing in it, twice a second.
export function addBlotch(g, owner, x, z, r, dmg, life = 6) {
  const y = groundBelow(g.solids, x, z, 0.6);
  const bl = { id: g.nextId++, owner, x, y, z, r, dmg, t: life, tickT: 0 };
  (g.blotches = g.blotches || []).push(bl);
  const r2 = v => Math.round(v * 100) / 100;
  g.emit({ t: 'blotch', id: bl.id, x: r2(x), y: r2(y), z: r2(z), r: r2(r), life });
}
function tickBlotches(g, dt) {
  if (!g.blotches || !g.blotches.length) return;
  for (const bl of g.blotches) {
    bl.t -= dt; bl.tickT -= dt;
    if (bl.tickT > 0) continue;
    bl.tickT = 0.5;
    for (const q of g.players) {
      if (!q.alive || q.reviving || q.flying || q.team === 1 || q.kind === 'hazardTurret') continue;
      if (Math.hypot(q.pos.x - bl.x, q.pos.z - bl.z) > bl.r + PR * (q.size || 1) * 0.5 || q.pos.y - bl.y > 0.5) continue;
      g.addPoison(q, bl.owner, 0.5);
    }
  }
  g.blotches = g.blotches.filter(bl => bl.t > 0);
}

// ---------------------------------------------------------------- portals
function openPortal(g, b, x, z) {
  const D = coopDiff(g.settings), y = groundBelow(g.solids, x, z, 0.5);
  const stats = { ...DEFAULT_STATS, health: Math.round((80 + 12 * g.round) * D.hp), moveSpeed: 0, jump: 0, fireRate: 0.3, ammo: 1 };
  const p = g.spawnUnit('wave', null, { x, y, z }, { stats, unitKind: 'portal', name: 'Portal', color: '#b56bff', difficulty: 'normal' });
  p.fixedSize = 1.25; p.heavy = true; p.noBlock = true; p.ephemeral = true; p.lifeT = 9 + D.extra;
  p.portal = { t: 0.8 };
  g.unitsChanged();
}
function portalUnitPool(g) {
  const B = g.boss && g.boss.boss, ph = B ? B.phase : 1, key = coopDiffKey(g.settings);
  const pool = ['critter', 'critter', 'wave', 'wave', 'splitter'];
  if (ph >= 2) pool.push('drone', 'wave');
  if (ph >= 3 && (key === 'hard' || key === 'nightmare')) pool.push('elite');
  if (key === 'easy') return pool.filter(t => t === 'critter' || t === 'wave');
  return pool;
}
export function portalThink(g, p, dt) {
  const P = p.portal, gm = g.gm;
  p.input.mx = p.input.mz = 0; p.input.shoot = false;
  if (g.phase !== 'play' || !gm) return;
  P.t -= dt;
  if (P.t > 0) return;
  P.t = 1.7;
  const heroes = g.heroes().filter(h => h.connected).length;
  if (g.players.filter(u => u.alive && u.team === 1 && u.transient && u.kind !== 'portal' && u.kind !== 'boss').length >= 12 + heroes * 2) return;
  let pool = portalUnitPool(g).filter(t => UNIT_COSTS[t] <= gm.portalCredits);
  if (pool.includes('elite') && g.players.some(u => u.alive && u.kind === 'elite')) pool = pool.filter(t => t !== 'elite');
  if (!pool.length) return;
  const type = pool[Math.floor(Math.random() * pool.length)];
  gm.portalCredits -= UNIT_COSTS[type];
  const spot = g.freeSpot(p.pos.x + (Math.random() - 0.5) * 1.6, p.pos.z + (Math.random() - 0.5) * 1.6, p.pos.x, p.pos.z, 0.6, p.pos.y + 0.2);
  const u = g.spawnWaveUnit(type, spot, gm.spawned++);
  u.vel = { x: (Math.random() - 0.5) * 4, y: 5, z: (Math.random() - 0.5) * 4 };
  g.unitsChanged();
  if (type === 'elite') g.announceElite(u);
  g.emit({ t: 'portalSpawn', x: p.pos.x, y: p.pos.y + 1, z: p.pos.z });
}

// ---------------------------------------------------------------- boss brain
export function bossThink(g, b, dt) {
  const B = b.boss, inp = b.input;
  inp.shoot = false; inp.jump = false;
  if (g.phase !== 'play') { inp.mx = inp.mz = 0; return; }
  B.fightT += dt;
  const S = bossScale(g, b), hs = targets(g, b);
  // phases at 66% and 33% health; enrage after 3 minutes
  const frac = b.hp / Math.max(1, g.maxHp(b)), ph = frac < 0.33 ? 3 : frac < 0.66 ? 2 : 1;
  if (ph > B.phase) {
    B.phase = ph; b.fx.invulnT = g.time + 1.2; B.gap = Math.min(B.gap, 1.4);
    g.emit({ t: 'bossPhase', n: ph, p: b.id, name: b.name, x: b.pos.x, y: b.pos.y + 2, z: b.pos.z });
    if (ph === 2) B.cd.quake = 0; else B.cd.cross = 0;
  }
  if (!B.enraged && B.fightT > 180) { B.enraged = true; g.emit({ t: 'bossEnrage', p: b.id, name: b.name }); }
  // Leaping: fly along an arc to the landing circle (untouchable in the air).
  if (B.leap) {
    const L = B.leap; L.t -= dt;
    const k = clamp(1 - L.t / L.dur, 0, 1), air = clamp((k - 0.3) / 0.7, 0, 1);
    if (air > 0) {
      b.pos = { x: L.fromX + (L.x - L.fromX) * air, y: L.fromY + Math.sin(air * Math.PI) * 7, z: L.fromZ + (L.z - L.fromZ) * air };
      b.vel = { x: 0, y: 0, z: 0 }; b.fx.invulnT = g.time + 0.1;
    }
  }
  for (const c of B.casts || []) c.tgs = c.tgs.filter(t => t.alive !== false);
  B.casts = (B.casts || []).filter(c => c.tgs.length);
  // pick the next attack
  for (const k in B.cd) B.cd[k] -= dt * S.tempo;
  B.gap -= dt * S.tempo;
  const key = coopDiffKey(g.settings), early = key === 'hard' || key === 'nightmare';
  if (B.gap <= 0 && !B.leap && hs.length && B.casts.length < S.maxCasts) {
    const opts = BOSSES[B.type || 'warden'].abilities.filter(([n, unlock]) => !(B.ally && (n === 'portals' || n === 'brood' || n === 'spit')) && (B.phase >= unlock || (early && B.fightT > 20 && (n === 'portals' || n === 'beams')))
      && !(n === 'cross' && key === 'easy') && (B.cd[n] || 0) <= 0 && !(B.casts.some(c => c.name === n)) && !(n === 'leap' && B.casts.length));
    if (opts.length) {
      let r = Math.random() * opts.reduce((a, o) => a + o[3], 0), pick = opts[0];
      for (const o of opts) { r -= o[3]; if (r <= 0) { pick = o; break; } }
      if (B.stuckT > 3 && opts.some(o => o[0] === 'leap')) pick = opts.find(o => o[0] === 'leap');
      cast(g, b, pick[0]);
      B.cd[pick[0]] = pick[2] * S.D.cd;
      B.gap = Math.max(1.1, (1.9 - 0.25 * (B.phase - 1)) * S.D.cd);
      if (pick[0] === 'leap') B.stuckT = 0;
    }
  }
  // follow-the-boss telegraphs (cleave, in/out, quake) stay centered on it while it winds up
  for (const tg of g.telegraphs) if (tg.owner === b.id && tg.follow) { tg.x = b.pos.x; tg.z = b.pos.z; }
  // basic attack: a fan of big slow orbs (blockable, reflectable)
  B.volleyT -= dt * S.tempo;
  if (B.volleyT <= 0 && hs.length && !B.leap && B.root <= 0) {
    const V = BOSSES[B.type || 'warden'].volley;
    B.volleyT = (V.every - 0.3 * (B.phase - 1)) * S.D.cd;
    const t = hs[Math.floor(Math.random() * hs.length)], n = V.n + B.phase + S.D.extra;
    const from = { x: b.pos.x, y: g.chest(b) + 0.4, z: b.pos.z };
    const dx = t.pos.x - from.x, dz = t.pos.z - from.z, dy = g.chest(t) - from.y, l = Math.hypot(dx, dy, dz) || 1;
    for (let k = 0; k < n; k++) {
      const a = (k - (n - 1) / 2) * 0.2, c = Math.cos(a), s = Math.sin(a);
      const d = { x: (dx * c - dz * s) / l, y: dy / l + 0.03, z: (dx * s + dz * c) / l };
      const bl = g.spawnBullet(b, { x: from.x + d.x * 1.4, y: from.y, z: from.z + d.z * 1.4 }, d, b.stats.bulletSpeed, false);
      bl.life = 5;
    }
    g.emit({ t: 'shoot', p: b.id, x: from.x, y: from.y, z: from.z, sky: 0 });
  }
  // movement: keep a medium distance from the squad, stop while winding up an attack
  B.root -= dt; B.aggroT -= dt;
  if (B.aggroT <= 0 || !B.tgt || !B.tgt.alive || (B.ally && !hs.includes(B.tgt))) {
    B.aggroT = B.ally ? 3 : 6;
    B.tgt = !hs.length ? null : B.ally ? hs.slice().sort((a, c) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) - Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z))[0] : hs[Math.floor(Math.random() * hs.length)];
  }
  let mx = 0, mz = 0;
  if (B.ally && B.root <= 0 && !B.leap) {
    // Space King's ally boss: walk to the foe it's fighting (or back to its summoner), around walls; leap when stuck or the
    // foe is up on a platform it can't walk to.
    const own = g.player(b.ownerId), goal = B.tgt && B.tgt.alive ? B.tgt : own && own.alive ? own : null;
    if (goal) {
      const dx = goal.pos.x - b.pos.x, dz = goal.pos.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
      const want = goal === own ? (d > 5 ? 1 : 0) : d > 8 ? 1 : d < 4 ? -0.6 : 0;
      mx = dx / d * want - (goal === own ? 0 : dz / d * 0.3); mz = dz / d * want + (goal === own ? 0 : dx / d * 0.3);
      if (Math.hypot(mx, mz) > 0.01) [mx, mz] = detour(g, b, b.ai || (b.ai = {}), mx, mz);
      const moved = Math.hypot(b.pos.x - B.lx, b.pos.z - B.lz);
      B.stuckT = moved < dt * 0.6 && Math.abs(want) > 0 ? B.stuckT + dt : Math.max(0, B.stuckT - dt);
      const high = goal !== own && goal.onGround && goal.pos.y - b.pos.y > 1.5 && d < 14;
      if ((B.stuckT > 2 || (high && (B.cd.allyLeap || 0) <= 0)) && hs.length && !B.casts.some(c => c.name === 'leap')) {
        if (goal === own) { B.tgt = own; }
        cast(g, b, 'leap'); B.stuckT = 0; B.cd.allyLeap = 6;
      }
    }
  } else if (hs.length && B.root <= 0 && !B.leap) {
    const cx = hs.reduce((a, q) => a + q.pos.x, 0) / hs.length, cz = hs.reduce((a, q) => a + q.pos.z, 0) / hs.length;
    const dx = cx - b.pos.x, dz = cz - b.pos.z, d = Math.hypot(dx, dz) || 1;
    const want = d > 9 ? 1 : d < 5 ? -0.7 : 0;
    mx = dx / d * want - dz / d * 0.35; mz = dz / d * want + dx / d * 0.35;
    const moved = Math.hypot(b.pos.x - B.lx, b.pos.z - B.lz);
    B.stuckT = moved < dt * 0.4 && Math.abs(want) > 0 ? B.stuckT + dt : Math.max(0, B.stuckT - dt);
  }
  B.lx = b.pos.x; B.lz = b.pos.z;
  const l = Math.hypot(mx, mz);
  inp.mx = l > 0.01 ? mx / l * (B.phase === 3 ? 1.2 : 1) : 0; inp.mz = l > 0.01 ? mz / l * (B.phase === 3 ? 1.2 : 1) : 0;
  const t = B.tgt;
  const ang = B.root > 0 && B.face != null ? B.face : t ? Math.atan2(t.pos.z - b.pos.z, t.pos.x - b.pos.x) : 0;
  inp.aim = { x: Math.cos(ang), y: 0, z: Math.sin(ang) };
  if (t) inp.aimPoint = { x: t.pos.x, y: g.chest(t), z: t.pos.z };
  if (B.root <= 0) B.face = null;
}

// Runs every tick on the host during co-op: counts down telegraphs, moves shockwaves, sends reinforcements.
export function coopTick(g, dt) {
  const b = g.boss;
  tickBlotches(g, dt);
  for (const tg of g.telegraphs) {
    tg.t -= dt;
    if (tg.t <= 0) { tg.alive = false; const owner = g.player(tg.owner); if (owner && owner.alive) resolve(g, owner, tg); }
  }
  g.telegraphs = g.telegraphs.filter(t => t.alive !== false);
  for (const sw of g.shockwaves) {
    sw.r += sw.speed * dt;
    const owner = g.player(sw.owner) || b;
    if (!owner) continue;
    for (const q of targets(g, owner)) {
      if (sw.hit.has(q.id)) continue;
      const d = Math.hypot(q.pos.x - sw.x, q.pos.z - sw.z), rr = PR * (q.size || 1);
      if (d > sw.r - sw.w / 2 - rr && d < sw.r + sw.w / 2 + rr && q.pos.y < 0.6) { sw.hit.add(q.id); hitPlayer(g, owner, q, sw.dmg, sw.x, sw.z, 7); }
    }
  }
  g.shockwaves = g.shockwaves.filter(s => s.r < s.maxR);
  if (g.gm && g.boss && g.boss.alive) {
    const B = g.boss.boss, S = bossScale(g, g.boss);
    g.gm.portalCredits = Math.min(g.gm.portalCap, g.gm.portalCredits + dt * g.gm.portalRate * S.tempo * (B.phase >= 2 ? 1.4 : 1));
  }
  // Reinforcements: when the field has thinned out (or it's been a while), the next group arrives.
  const gm = g.gm;
  if (gm && gm.queue.length && g.phase === 'play') {
    gm.sinceT += dt;
    const value = g.players.filter(u => u.alive && u.team === 1 && u.transient && u.kind !== 'portal').reduce((a, u) => a + (UNIT_COSTS[u.kind] || 2), 0);
    if (value <= gm.groupValue * 0.4 || gm.sinceT > 28) {
      const group = gm.queue.shift(), pts = enemySideSpots(g, group.length);
      group.forEach((t, i) => g.spawnWaveUnit(t, pts[i], gm.spawned++));
      gm.groupValue = group.reduce((a, t) => a + (UNIT_COSTS[t] || 1), 0); gm.sinceT = 0;
      g.unitsChanged();
      g.emit({ t: 'reinforce', n: group.length, x: pts[0].x, z: pts[0].z, left: gm.queue.length });
      for (const u of g.players) if (u.kind === 'elite' && u.alive && !u.announced) g.announceElite(u);
    }
  }
}

// The boss falls: everything it brought with it goes too.
export function bossDown(g, b) {
  g.emit({ t: 'bossDown', p: b.id, name: b.name, x: b.pos.x, y: b.pos.y + 2, z: b.pos.z });
  g.bossKills = (g.bossKills || 0) + 1;
  g.telegraphs = []; g.shockwaves = [];
  if (g.gm) g.gm.queue = [];
  for (const u of g.players) if (u !== b && u.alive && u.team === 1 && u.transient) { u.alive = false; u.hp = 0; g.emit({ t: 'unitGone', p: u.id, x: u.pos.x, y: u.pos.y + 0.5, z: u.pos.z }); }
}

// Compact telegraph / shockwave lists for the network snapshot and the renderer.
// tg rows: [id, kind, x, z, a, b, c, frac]  circle/leap/portal: a=r | donut: a=r0 b=r | cone: a=ang b=arc c=len | line: a=ang b=len c=w
export function telegraphRows(g) {
  const r2 = v => Math.round(v * 100) / 100;
  return (g.telegraphs || []).map(tg => {
    const k = KIND[tg.kind], f = r2(clamp(1 - tg.t / tg.dur, 0, 1));
    if (tg.kind === 'donut') return [tg.id, k, r2(tg.x), r2(tg.z), r2(tg.r0), r2(tg.r), 0, f];
    if (tg.kind === 'cone') return [tg.id, k, r2(tg.x), r2(tg.z), r2(tg.ang), r2(tg.arc), r2(tg.len), f];
    if (tg.kind === 'line') return [tg.id, k, r2(tg.x), r2(tg.z), r2(tg.ang), r2(tg.len), r2(tg.w), f];
    return [tg.id, k, r2(tg.x), r2(tg.z), r2(tg.r), 0, 0, f];
  });
}
export function shockRows(g) { const r2 = v => Math.round(v * 100) / 100; return (g.shockwaves || []).map(s => [s.id, r2(s.x), r2(s.z), r2(s.r), r2(s.w)]); }
export function bossRow(g) {
  const b = g.boss;
  if (!b || !b.alive) return null;
  return [b.id, Math.ceil(b.hp), Math.round(g.maxHp(b)), b.boss.phase, b.boss.enraged ? 1 : 0];
}

// ---------------------------------------------------------------- squad bots: dodge the boss
const DODGE = { easy: 0.55, normal: 0.82, hard: 0.96 };
// A direction out of the nearest telegraph about to land on this bot (or null). jump: hop a shockwave.
export function dodgeFor(g, p) {
  if (!g.telegraphs || (!g.telegraphs.length && !g.shockwaves.length)) return null;
  let best = null;
  for (const tg of g.telegraphs) {
    if (tg.kind === 'portal' || tg.t > 1.7 || !g.isEnemy(p, g.player(tg.owner))) continue;
    if (tg.seen[p.id] == null) tg.seen[p.id] = Math.random() < (DODGE[p.difficulty] ?? 0.8);
    if (!tg.seen[p.id] || !inTelegraph(tg, p.pos.x, p.pos.z, 0.9)) continue;
    const dx = p.pos.x - tg.x, dz = p.pos.z - tg.z, d = Math.hypot(dx, dz) || 1;
    let ex, ez;
    if (tg.kind === 'donut') { const inward = d - tg.r0 < tg.r - d; ex = inward ? -dx / d : dx / d; ez = inward ? -dz / d : dz / d; }
    else if (tg.kind === 'line' || tg.kind === 'cone') {
      const ux = Math.cos(tg.ang), uz = Math.sin(tg.ang), side = -dx * uz + dz * ux >= 0 ? 1 : -1;
      ex = -uz * side; ez = ux * side;
      if (tg.kind === 'cone' && d > tg.len * 0.75) { ex = ex * 0.5 + ux * 0.5; ez = ez * 0.5 + uz * 0.5; }
    } else { ex = dx / d; ez = dz / d; }
    if (!best || tg.t < best.t) best = { x: ex, z: ez, t: tg.t };
  }
  let jump = false;
  for (const sw of g.shockwaves) {
    const d = Math.hypot(p.pos.x - sw.x, p.pos.z - sw.z), gap = d - sw.r;
    if (gap > 0 && gap < sw.speed * 0.32 && (DODGE[p.difficulty] ?? 0.8) > 0.6) jump = true;
  }
  if (!best && !jump) return null;
  return { x: best ? best.x : 0, z: best ? best.z : 0, move: !!best, jump };
}
export { arenaEdges, edgeDistance };
