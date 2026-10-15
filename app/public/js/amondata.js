import { tacticDesc } from './amoninfo.js';   // AMON wording for tactics adapted from shooter cards (circular import: used at call time only)
// =====================================================================
// AMON autobattler: data. Units, enemies, bosses, board patterns and cards.
// No three.js here (the host simulation and the UI both read it).
//
// Unit stats (per unit): hp, atk (damage per attack), rate (attacks per second), range (m),
// speed (m/s), armor (flat damage removed from every hit, min 1 damage gets through), size (m),
// air (flies: only units with hitsAir can hit it), hitsAir / hitsGround, splash (radius m),
// bonus { armored | air | large | light: damage multiplier }, tags ['armored', 'light', 'large', 'mech', 'bio'],
// ab { ability: settings } (see amon.js ABILITY handlers), look { shape, color }.
// Every unit gets a VALUE from its stats (unitValue). The Game Master spends wave budget in value,
// and card tiers are tuned so a card's total value grows with its tier (see TIER_TARGET).
// =====================================================================

export const AMON = {
  boardSize: 5,          // 5 x 5 deployment board (row 0 = front, nearest the enemy)
  benchSize: 8,
  baseOffers: 4,         // store level 1 shows 4 offers, +1 per level up to maxOffers
  maxOffers: 8,
  tierCapLevel: 8,       // store odds stop improving at this level (levels above give a Command bonus instead)
  cardPrice: 3,          // every offer costs the same
  rerollPrice: 1,
  startGold: 10,
  income: lvl => 5 + 3 * lvl,                // gold at the start of every store, by YOUR store level (upgrading pays for itself)
  upgradeBase: lvl => 4 + 2 * lvl,          // cost to go from lvl to lvl + 1 ...
  upgradeDrop: 1,                           // ... which drops by this much every time a battle starts (down to 0)
  commandPerLevel: 0.05,                    // store levels above 8: +5% health and damage for all your units per level
  pctCap: 6,                                // v1.0.7: breeder cards can grow a unit card up to 6x its own size
  squadMul: 1.6,                            // unit cards bring this many times more (weaker) units than their base size
  maxSpeed: 4,                              // v1.2.13: battles can be voted up to this speed
  maxRank: Infinity,                        // duplicate cards merge into one card of a higher rank (v1.2.13, Devin: no cap; was 9)
  rankMul: r => 1 + 0.5 * (r - 1),          // stat multiplier per rank
  sellValue: rank => 2 * rank,
  teamHealth: 100,
  vsHealth: 60,            // AMON Versus: each player's health
  finalRound: 20,
  extendRounds: 10,
  bossEvery: 10,          // a boss on every 10th round (round 20: Amon)
  battleTime: 110,
  waveCap: 260,           // most enemy units on one field (bigger waves come as fewer, tougher units)
  deployMaxX: -24,         // custom start positions (drag on the field in the store): your units start at x <= this
  fanTime: 2.5,           // battle start: armies fan out into a wide line for this long, then march as one group
  holyChance: 0.05, cursedChance: 0.05,   // a tactic offer can roll as a Holy (no downsides, stronger) or Cursed (much stronger, worse downsides) card        // seconds before a battle is called (enemies left count against you)
  shopTime: 75,           // seconds in the store when the lobby has a pick timer (0 = wait for everyone to ready up)
  field: { hx: 70, hz: 46 },
  tick: 0.05,
};

// store odds per level (index = store level 1..8), tiers 1..6
export const TIER_ODDS = [
  null,
  [100, 0, 0, 0, 0, 0],
  [75, 25, 0, 0, 0, 0],
  [55, 35, 10, 0, 0, 0],
  [40, 34, 20, 6, 0, 0],
  [28, 30, 26, 12, 4, 0],
  [18, 26, 28, 18, 8, 2],
  [12, 20, 27, 24, 12, 5],
  [8, 14, 23, 27, 18, 10],
];
export const TIER_TARGET = [0, 6, 10, 17, 29, 50, 85];   // rough card value per tier (rank 1)
export const TIER_COLORS = ['#888', '#c9ced8', '#5fd17a', '#4aa8ff', '#b46bff', '#ffb02e', '#ff4f6a'];
export const TIER_NAMES = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

// ---------------------------------------------------------------- unit value
// Lanchester-style power: sqrt(effective health x damage output), adjusted for reach, mobility and flight.
export function unitValue(u) {
  if (u.value) return u.value;
  const s = u.ab && u.ab.siege ? { ...u, ...u.ab.siege } : u;
  const dps = (s.atk || 0) * (s.rate || 0) * (1 + 0.5 * (s.splash || 0)) * (1 + 0.4 * ((u.ab && u.ab.chain && u.ab.chain.n) || 0)) * (u.ab && u.ab.suicide ? 2.2 : 1);
  const heal = u.ab && u.ab.heal ? u.ab.heal.hps * 1.2 : 0;
  const ehp = u.hp * (1 + (u.armor || 0) / 8) * (u.ab && u.ab.cap ? 1.5 : 1) * (1 + ((u.ab && u.ab.regen ? u.ab.regen.hps : 0) * 6) / u.hp);
  const rangeF = 1 + Math.min(s.range || 1, 30) / 14, mob = 1 + (u.speed || 0) / 25, air = u.air ? 1.12 : 1;
  const v = 0.05 * Math.sqrt(ehp * Math.max(0.5, dps + heal) * rangeF) * mob * air * (u.vm || 1);
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------- player unit groups (cards spawn these)
const P = (id, name, tier, count, icon, stats, look, extra = {}) => ({ id, name, tier, count, icon, side: 0, hitsGround: true, ...stats, look, ...extra });
export const UNITS = [
  // ---- tier I ----
  P('rifle', 'Rifle Squad', 1, 5, '🪖', { hp: 45, atk: 6, rate: 1.2, range: 10, speed: 3.2, size: 0.55, hitsAir: true, tags: ['light', 'bio'] }, { shape: 'infantry', color: '#6f8fb3' },
    { desc: 'Cheap riflemen that shoot ground and air.' }),
  P('swarm', 'Swarmlings', 1, 8, '🦗', { hp: 28, atk: 5, rate: 1.6, range: 1.2, speed: 5.6, size: 0.45, tags: ['light', 'bio'] }, { shape: 'beast', color: '#a06bd0' },
    { desc: 'A fast pack of biters.' }),
  P('pike', 'Pike Line', 1, 4, '🔱', { hp: 60, atk: 8, rate: 1, range: 1.9, speed: 3, armor: 1, size: 0.6, bonus: { large: 2 }, tags: ['bio'] }, { shape: 'infantry', color: '#b38a5a', gear: 'pike' },
    { desc: 'Long spears: double damage to large units.' }),
  P('archer', 'Longbow Archers', 1, 5, '🏹', { hp: 32, atk: 7, rate: 0.9, range: 15, speed: 3, size: 0.55, hitsAir: true, tags: ['light', 'bio'] }, { shape: 'infantry', color: '#5d9a52', gear: 'bow' },
    { desc: 'Long reach, thin armor.' }),
  P('militia', 'Village Militia', 1, 6, '🧑‍🌾', { hp: 40, atk: 5, rate: 1, range: 1.3, speed: 3.2, size: 0.55, tags: ['light', 'bio'] }, { shape: 'infantry', color: '#c9a66b' },
    { desc: 'Weak fighters, but they work the fields.', aura: { pattern: 'self', fx: { gold: 1 } } }),
  P('grenadier', 'Grenadiers', 1, 3, '💣', { hp: 50, atk: 14, rate: 0.5, range: 9, speed: 3, splash: 2, size: 0.6, tags: ['bio'] }, { shape: 'infantry', color: '#7f7f4a' },
    { desc: 'Lobbed grenades hit small groups.', shell: true }),
  P('scout', 'Scout Drones', 1, 4, '🛸', { hp: 30, atk: 5, rate: 1.5, range: 7, speed: 7, size: 0.5, air: true, hitsAir: true, tags: ['light', 'mech'] }, { shape: 'drone', color: '#9fd8ff' },
    { desc: 'Quick flying pests.' }),
  P('bile', 'Bilelings', 1, 6, '🟢', { hp: 30, atk: 40, rate: 1, range: 0.8, speed: 4.6, splash: 3, size: 0.5, tags: ['light', 'bio'], ab: { suicide: {} } }, { shape: 'blob', color: '#7ce04a' },
    { desc: 'Roll into the enemy and burst in an acid splash.', value: 1.1 }),
  // ---- tier II ----
  P('concuss', 'Concussion Troopers', 2, 4, '🧱', { hp: 90, atk: 10, rate: 0.9, range: 8, speed: 3, armor: 1, size: 0.65, tags: ['bio'], ab: { slow: { amt: 0.4, dur: 1.5 } } }, { shape: 'infantry', color: '#4a6a8f', gear: 'heavy' },
    { desc: 'Heavy rounds slow what they hit.' }),
  P('footman', 'Shield Footmen', 2, 4, '🛡', { hp: 110, atk: 9, rate: 1, range: 1.4, speed: 3.2, armor: 3, size: 0.65, tags: ['armored', 'bio'] }, { shape: 'infantry', color: '#8a95a8', gear: 'shield' },
    { desc: 'Armored front-liners.' }),
  P('spitter', 'Spine Spitters', 2, 5, '🦂', { hp: 70, atk: 10, rate: 1, range: 11, speed: 3.4, size: 0.7, hitsAir: true, tags: ['bio'] }, { shape: 'beast', color: '#8a4ab0' },
    { desc: 'Ranged biters that hit air too.' }),
  P('medic', 'Field Medics', 2, 2, '⛑', { hp: 55, atk: 0, rate: 0, range: 7, speed: 3.4, size: 0.55, tags: ['light', 'bio'], ab: { heal: { hps: 10, range: 7 } } }, { shape: 'infantry', color: '#f2f2f2', gear: 'cross' },
    { value: 4, desc: 'Heal the most hurt ally nearby.', aura: { pattern: 'adj', fx: { regen: 3 } } }),
  P('flame', 'Flame Troopers', 2, 3, '🔥', { hp: 80, atk: 6, rate: 3, range: 4, speed: 3.2, armor: 1, splash: 1.5, size: 0.65, tags: ['bio'], ab: { burn: { dps: 6, dur: 3 } } }, { shape: 'infantry', color: '#d0662a', gear: 'tank' },
    { desc: 'Short cone of fire that keeps burning.' }),
  P('wolf', 'Wolf Riders', 2, 4, '🐺', { hp: 120, atk: 12, rate: 0.9, range: 1.5, speed: 7, armor: 1, size: 0.8, tags: ['bio'], ab: { slow: { amt: 0.5, dur: 1 } } }, { shape: 'cav', color: '#7a6a5a' },
    { desc: 'Fast raiders whose nets slow their prey.' }),
  P('rocket', 'Rocket Troopers', 2, 5, '🚀', { hp: 55, atk: 22, rate: 0.5, range: 12, speed: 3, size: 0.6, hitsAir: true, bonus: { armored: 1.5, air: 1.5 }, tags: ['bio'] }, { shape: 'infantry', color: '#5a7a4a', gear: 'tube' },
    { desc: 'Anti-armor and anti-air rockets.' }),
  P('mortar', 'Mortar Team', 2, 3, '🎯', { hp: 50, atk: 22, rate: 0.35, range: 22, minRange: 4, speed: 2.6, splash: 2.5, size: 0.6, tags: ['bio'] }, { shape: 'artillery', color: '#6b6b52' },
    { desc: 'Long-range shells. Can\'t fire up close.', shell: true }),
  P('engineer', 'Combat Engineers', 2, 4, '🔧', { hp: 50, atk: 5, rate: 1, range: 6, speed: 3.2, size: 0.55, tags: ['light', 'bio'], ab: { heal: { hps: 7, range: 6, mech: true } } }, { shape: 'infantry', color: '#e0b030', gear: 'wrench' },
    { desc: 'Repair machines in battle.', aura: { pattern: 'adj', fx: { armor: 2 } } }),
  // ---- tier III ----
  P('siege', 'Bombard Tank', 3, 1, '🛞', { hp: 260, atk: 15, rate: 1, range: 9, speed: 3.2, armor: 2, size: 1.3, tags: ['armored', 'mech', 'large'],
    ab: { siege: { atk: 70, rate: 0.33, range: 26, minRange: 4, splash: 2.5, deploy: 1.5 } } }, { shape: 'tank', color: '#6f8a5a' },
  { desc: 'Rolls up, then locks into siege mode: huge range and splash, but it can\'t hit up close.', shell: true, aura: { pattern: 'diag', fx: { range: 2 } }, vm: 1.15 }),
  P('knight', 'Knights', 3, 4, '🐎', { hp: 220, atk: 20, rate: 0.8, range: 1.6, speed: 6, armor: 3, size: 0.9, tags: ['armored', 'bio'], ab: { charge: { mul: 2.5 } } }, { shape: 'cav', color: '#c0c6d0', gear: 'lance' },
    { desc: 'Their first hit after a charge deals 2.5x damage.', aura: { pattern: 'front', fx: { atk: 0.2 } } }),
  P('stalker', 'Blink Striders', 3, 4, '🕷', { hp: 150, atk: 14, rate: 0.8, range: 10, speed: 5, armor: 1, size: 0.85, hitsAir: true, tags: ['armored', 'mech'], ab: { blink: { at: 0.4, dist: 9 } } }, { shape: 'walker', color: '#4a9aff' },
    { desc: 'Blink out of danger once when hurt.' }),
  P('shade', 'Shade Fighters', 3, 3, '🦇', { hp: 140, atk: 14, rate: 1, range: 8, speed: 6, size: 0.9, air: true, hitsAir: true, tags: ['mech'], ab: { stealth: { dur: 5 } } }, { shape: 'air', color: '#3a4a6a' },
    { desc: 'Cloaked for the first 5 seconds of battle.' }),
  P('roach', 'Burrow Beetles', 3, 4, '🪲', { hp: 170, atk: 16, rate: 0.6, range: 5, speed: 3.6, armor: 1, size: 0.85, tags: ['armored', 'bio'], ab: { regen: { hps: 8 } } }, { shape: 'beast', color: '#8a5a3a' },
    { desc: 'Tough bugs that regenerate fast.' }),
  P('ghoul', 'Ghouls', 3, 6, '🧟', { hp: 100, atk: 11, rate: 1.2, range: 1.3, speed: 5, size: 0.65, tags: ['bio'], ab: { cannibal: { heal: 40 } } }, { shape: 'beast', color: '#6a8a6a' },
    { desc: 'Heal by feeding on what they kill.' }),
  P('monk', 'Monks', 3, 1, '📿', { hp: 80, atk: 0, rate: 0, range: 8, speed: 3, size: 0.6, tags: ['light', 'bio'], ab: { heal: { hps: 6, range: 8 }, convert: { every: 14, maxValue: 6, range: 12 } } }, { shape: 'caster', color: '#d4a35a' },
    { desc: 'Heal, and convert an enemy to your side every 14 s.', value: 16 }),
  P('ballista', 'Ballista', 3, 3, '🏹', { hp: 120, atk: 40, rate: 0.35, range: 20, speed: 2.4, armor: 1, size: 1.1, tags: ['mech'], ab: { pierce: { len: 14, w: 1 } } }, { shape: 'artillery', color: '#8a6a40' },
    { desc: 'Bolts pierce everything in a line.' }),
  P('lancer', 'Sky Lancers', 3, 4, '✈', { hp: 120, atk: 10, rate: 1, range: 10, speed: 6, splash: 1.5, size: 0.85, air: true, hitsAir: true, hitsGround: false, bonus: { air: 1.6 }, tags: ['mech'] }, { shape: 'air', color: '#9ab0c8' },
    { desc: 'Air superiority fighters. Only hit air.' }),
  // ---- tier IV ----
  P('thor', 'Thunder Walker', 4, 1, '⚡', { hp: 600, atk: 30, rate: 0.8, range: 10, speed: 2.6, armor: 3, size: 1.8, hitsAir: true, bonus: { air: 1.8 }, tags: ['armored', 'mech', 'large'] }, { shape: 'walker', color: '#a0a8b8' },
    { desc: 'A walking cannon battery that shreds air units.' }),
  P('guardian', 'Barrier Guardians', 4, 2, '🔰', { hp: 300, atk: 40, rate: 0.6, range: 8, speed: 3.2, armor: 2, size: 1.2, bonus: { armored: 1.5 }, tags: ['armored', 'mech', 'large'], ab: { cap: { max: 18 } } }, { shape: 'walker', color: '#d8c070' },
    { desc: 'No single hit can deal them more than 18 damage.' }),
  P('adept', 'Storm Adepts', 4, 2, '🌩', { hp: 90, atk: 8, rate: 1, range: 7, speed: 3.2, size: 0.65, hitsAir: true, tags: ['light', 'bio'], ab: { storm: { every: 6, r: 4, dps: 30, dur: 3 } } }, { shape: 'caster', color: '#6a9aff' },
    { desc: 'Call a lightning storm on the biggest enemy cluster every 6 s.', vm: 2.2 }),
  P('wyrm', 'Glaive Wyrms', 4, 3, '🐉', { hp: 150, atk: 12, rate: 0.8, range: 6, speed: 6, size: 0.95, air: true, hitsAir: true, tags: ['bio'], ab: { chain: { n: 3, r: 5, falloff: 0.7 } } }, { shape: 'air', color: '#8a3a9a', gear: 'wings' },
    { desc: 'Glaives bounce to 3 more targets.' }),
  P('trebuchet', 'Trebuchet', 4, 1, '🏰', { hp: 200, atk: 120, rate: 0.15, range: 34, minRange: 8, speed: 1.8, armor: 1, splash: 4, size: 1.6, tags: ['mech', 'large'] }, { shape: 'artillery', color: '#7a5a3a' },
    { desc: 'Siege engine: enormous range and blast, slow to reload.', shell: true, aura: { pattern: 'col', fx: { range: 1 } } }),
  P('prism', 'Prism Tank', 4, 1, '🔷', { hp: 260, atk: 45, rate: 0.4, range: 18, speed: 3, armor: 2, size: 1.3, tags: ['armored', 'mech'], ab: { chain: { n: 4, r: 6, falloff: 0.8 } } }, { shape: 'tank', color: '#6ad0ff' },
    { desc: 'A light beam that splits to 4 more targets.', beam: true }),
  P('chieftain', 'Bull Chieftains', 4, 2, '🐂', { hp: 420, atk: 35, rate: 0.6, range: 1.8, speed: 3.6, armor: 2, splash: 2, size: 1.3, tags: ['bio', 'large'], ab: { quake: { every: 8, r: 5, dmg: 60, stun: 1 } } }, { shape: 'giant', color: '#8a5a3a' },
    { desc: 'Stomp the ground every 8 s, stunning everything nearby.' }),
  P('lurker', 'Spine Ambushers', 4, 2, '🦔', { hp: 200, atk: 22, rate: 0.7, range: 9, speed: 3.6, armor: 1, size: 1, tags: ['armored', 'bio'], ab: { pierce: { len: 9, w: 1.2 } } }, { shape: 'beast', color: '#5a3a6a' },
    { desc: 'Spines erupt along a line, hitting everything in it.' }),
  // ---- tier V ----
  P('carrier', 'Sky Hive', 5, 1, '🛳', { hp: 500, atk: 0, rate: 0, range: 12, speed: 2.4, armor: 2, size: 2.4, air: true, tags: ['armored', 'mech', 'large'], ab: { hangar: { unit: 'interceptor', max: 8, every: 2.5 } } }, { shape: 'ship', color: '#d8c890' },
    { desc: 'Launches up to 8 hive fighters and rebuilds them as they fall.', value: 48 }),
  P('mammoth', 'Mammoth Tank', 5, 1, '🦣', { hp: 1100, atk: 55, rate: 0.5, range: 12, speed: 2.4, armor: 4, splash: 1.5, size: 2, hitsAir: true, tags: ['armored', 'mech', 'large'], ab: { regen: { hps: 6 } } }, { shape: 'tank', color: '#6a7a5a', gear: 'twin' },
    { desc: 'Twin cannons, anti-air missiles and self-repair.' }),
  P('ultra', 'Tuskbeast', 5, 1, '🦏', { hp: 1000, atk: 45, rate: 0.8, range: 2, speed: 4, armor: 4, splash: 3, size: 2, tags: ['armored', 'bio', 'large'] }, { shape: 'giant', color: '#c8b080', gear: 'tusks' },
    { desc: 'A colossal beast whose blades cleave whole squads.' }),
  P('frost', 'Frost Wyrm', 5, 1, '❄', { hp: 700, atk: 55, rate: 0.4, range: 10, speed: 3.4, armor: 2, splash: 2.5, size: 2, air: true, hitsAir: true, tags: ['bio', 'large'], ab: { slow: { amt: 0.7, dur: 2 } } }, { shape: 'air', color: '#a8e0ff', gear: 'wings' },
    { desc: 'Frost breath freezes everything it hits.' }),
  P('archon', 'Storm Avatar', 5, 1, '🌀', { hp: 900, atk: 30, rate: 1, range: 4, speed: 3.6, size: 1.6, splash: 2, hitsAir: true, bonus: { bio: 1.5 }, tags: ['large'], ab: { regen: { hps: 10 } } }, { shape: 'orb', color: '#9ad0ff' },
    { desc: 'A storm of energy that wrecks living units.' }),
  P('dread', 'Dreadnought', 5, 1, '🚢', { hp: 900, atk: 20, rate: 1.5, range: 9, speed: 2.4, armor: 3, size: 2.4, air: true, hitsAir: true, tags: ['armored', 'mech', 'large'], ab: { yamato: { every: 12, dmg: 320, range: 12 } } }, { shape: 'ship', color: '#7a8aa0' },
    { desc: 'Fires a main-gun blast for 320 damage every 12 s.' }),
  // ---- tier VI ----
  P('mother', 'Star Citadel', 6, 1, '🌌', { hp: 1400, atk: 14, rate: 4, range: 9, speed: 2, armor: 3, size: 3, air: true, hitsAir: true, tags: ['armored', 'mech', 'large'], ab: { ward: { r: 9, cut: 0.3 } } }, { shape: 'ship', color: '#c0a0ff', gear: 'disc' },
    { desc: 'Allies within 9 m take 30% less damage.', aura: { pattern: 'ring', fx: { armor: 2 } }, vm: 1.4 }),
  P('brood', 'Hive Lords', 6, 2, '🪰', { hp: 450, atk: 20, rate: 0.6, range: 12, speed: 2.2, armor: 1, size: 1.8, air: true, tags: ['armored', 'bio', 'large'], ab: { brood: { unit: 'broodling', every: 1 } } }, { shape: 'air', color: '#6a4a3a', gear: 'wings' },
    { desc: 'Every attack drops a hiveling on the target.', vm: 1.5 }),
  P('infernal', 'Infernal', 6, 1, '☄', { hp: 1600, atk: 50, rate: 0.8, range: 2, speed: 3, armor: 5, size: 2.2, tags: ['armored', 'large'], ab: { impact: { r: 6, dmg: 150 }, burnAura: { r: 4, dps: 15 } } }, { shape: 'giant', color: '#5a3a2a', gear: 'flame' },
    { desc: 'Crashes down at the start of battle (150 blast) and burns everything near it.', vm: 1.3 }),
  P('kirov', 'Kirov Airship', 6, 1, '🎈', { hp: 1800, atk: 180, rate: 0.25, range: 2.5, speed: 1.8, armor: 4, splash: 5, size: 3, air: true, tags: ['armored', 'mech', 'large'] }, { shape: 'zeppelin', color: '#c04040' },
    { desc: 'A slow, armored zeppelin that carpet-bombs what is below it.' }),
  P('elephant', 'War Elephants', 6, 2, '🐘', { hp: 900, atk: 50, rate: 0.6, range: 2.5, speed: 4, armor: 3, splash: 2.5, size: 2.2, tags: ['armored', 'bio', 'large'], ab: { charge: { mul: 3 } } }, { shape: 'giant', color: '#9a9aa0', gear: 'tusks' },
    { desc: 'Trample through the line: the first hit after a charge deals 3x.' }),
  // ---- translated from the shooter's weapon and shield mods ----
  P('critters', 'Critter Swarm', 1, 10, '🐀', { hp: 18, atk: 4, rate: 1.6, range: 1, speed: 7, size: 0.35, tags: ['light', 'bio'] }, { shape: 'beast', color: '#9a7a5a' },
    { desc: 'Ten biting critters that rush the nearest enemy.', from: 'mod-critter' }),
  P('torch', 'Torchbearers', 2, 4, '🔥', { hp: 70, atk: 5, rate: 3, range: 3.5, speed: 3.4, splash: 1.2, size: 0.6, tags: ['bio'], ab: { burn: { dps: 8, dur: 3 } } }, { shape: 'infantry', color: '#e0702a', gear: 'tank' },
    { desc: 'Flamethrowers: short range, everything they touch keeps burning.', from: 'mod-flamethrower' }),
  P('lobber', 'Grenade Launchers', 2, 3, '🧨', { hp: 60, atk: 20, rate: 0.5, range: 12, speed: 3, splash: 2.5, size: 0.6, tags: ['bio'] }, { shape: 'infantry', color: '#6a8a3a', gear: 'tube' },
    { desc: 'Lobbed grenades that burst on groups.', shell: true, from: 'mod-grenade-launcher' }),
  P('riot', 'Riot Wall', 2, 3, '🛡', { hp: 170, atk: 8, rate: 1, range: 1.5, speed: 2.8, armor: 4, size: 0.75, tags: ['armored', 'bio'] }, { shape: 'infantry', color: '#5a6a8a', gear: 'shield' },
    { desc: 'Heavy shields up front that soak a lot of fire.', from: 'mod-riot-shield' }),
  P('scatter', 'Scattergunners', 2, 4, '💥', { hp: 70, atk: 14, rate: 0.9, range: 5, speed: 3.6, splash: 1.5, size: 0.6, tags: ['bio'] }, { shape: 'infantry', color: '#b0603a', gear: 'heavy' },
    { desc: 'Close-range pellet blasts that hit small clusters.', from: 'mod-scattergun' }),
  P('turretnest', 'Turret Nest', 2, 2, '🗼', { hp: 130, atk: 10, rate: 1.6, range: 13, speed: 0.6, armor: 2, size: 0.8, hitsAir: true, tags: ['mech'] }, { shape: 'walker', color: '#cfd6e4' },
    { desc: 'Slow-moving turrets that shoot ground and air from far away.', from: 'shield-turret' }),
  P('beam', 'Beam Riflemen', 3, 3, '🔦', { hp: 110, atk: 20, rate: 0.8, range: 15, speed: 3.2, size: 0.65, hitsAir: true, tags: ['bio'], ab: { chain: { n: 1, r: 6, falloff: 0.8 } } }, { shape: 'infantry', color: '#7fe0ff', gear: 'tube' },
    { desc: 'Instant beams that bounce to one more target.', beam: true, from: 'mod-beam-rifle' }),
  P('blade', 'Blade Dancers', 3, 4, '🗡', { hp: 140, atk: 18, rate: 1.3, range: 1.6, speed: 6.5, armor: 1, size: 0.7, tags: ['bio'], ab: { lifesteal: { f: 0.2 } } }, { shape: 'infantry', color: '#d0d8e8', gear: 'pike' },
    { desc: 'Fast swordsmen that heal from the damage they deal.', from: 'mod-katana' }),
  P('tinytank', 'Tiny Tanks', 3, 2, '🚜', { hp: 260, atk: 30, rate: 0.6, range: 10, speed: 3.2, armor: 3, splash: 2, size: 1, tags: ['armored', 'mech'] }, { shape: 'tank', color: '#8a9a5a' },
    { desc: 'Small, tough tanks firing explosive shells.', shell: true, from: 'tiny-tank' }),
  P('troll', 'Cursed Brutes', 4, 2, '⛧', { hp: 480, atk: 38, rate: 0.7, range: 2, speed: 3.6, armor: 2, splash: 1.5, size: 1.4, tags: ['bio', 'large'], ab: { regen: { hps: 10 } } }, { shape: 'giant', color: '#6a3a5a', gear: 'axe' },
    { desc: 'Brutes from the ritual circle: big hits and fast regeneration.', from: 'shield-pentagram' }),
  P('spaceking', 'Space King', 6, 1, '👑', { hp: 2200, atk: 90, rate: 0.6, range: 3, speed: 2.8, armor: 4, splash: 3, size: 2.6, hitsAir: true, tags: ['armored', 'large'], ab: { quake: { every: 7, r: 7, dmg: 80, stun: 1 } } }, { shape: 'giant', color: '#ffc928', gear: 'flame' },
    { desc: 'A golden giant that stomps everything around it every 7 s.', from: 'shield-spaceking', vm: 1.2 }),
];
// Units that only appear from abilities (no card).
export const SUMMONS = [
  P('interceptor', 'Hive Fighter', 0, 1, '·', { hp: 30, atk: 6, rate: 1.5, range: 5, speed: 9, size: 0.35, air: true, hitsAir: true, tags: ['light', 'mech'] }, { shape: 'drone', color: '#f0e0a0' }, { value: 1 }),
  P('broodling', 'Hiveling', 0, 1, '·', { hp: 40, atk: 8, rate: 1.2, range: 1.2, speed: 4.5, size: 0.4, tags: ['light', 'bio'], ab: { expire: { t: 8 } } }, { shape: 'beast', color: '#6a4a3a' }, { value: 0.8 }),
  P('skeleton', 'Risen', 0, 1, '·', { hp: 50, atk: 7, rate: 1, range: 1.3, speed: 3.5, size: 0.55, tags: ['light'] }, { shape: 'infantry', color: '#d8d0c0' }, { value: 1 }),
  P('sentry', 'Watch Turret', 0, 1, '·', { hp: 90, atk: 8, rate: 1.4, range: 12, speed: 0.4, armor: 2, size: 0.7, hitsAir: true, tags: ['mech'] }, { shape: 'walker', color: '#cfd6e4' }, { value: 2.5 }),
  P('wasp', 'Wasp Drone', 0, 1, '·', { hp: 30, atk: 5, rate: 1.5, range: 6, speed: 8, size: 0.4, air: true, hitsAir: true, tags: ['light', 'mech'] }, { shape: 'drone', color: '#ffd23a' }, { value: 1 }),
  P('crawler', 'Crawler', 0, 1, '·', { hp: 26, atk: 5, rate: 1.4, range: 1.1, speed: 5, size: 0.4, tags: ['light', 'bio'] }, { shape: 'beast', color: '#b04040' }, { value: 0.7 }),
];

// ---------------------------------------------------------------- enemies
// Raider-style enemies. tier = from which part of the run the Game Master may field them.
const E = (id, name, tier, stats, look, extra = {}) => ({ id, name, tier, count: 1, side: 1, hitsGround: true, ...stats, look, ...extra });
export const ENEMIES = [
  E('grunt', 'Scrap Grunt', 1, { hp: 45, atk: 6, rate: 1, range: 8, speed: 3, size: 0.55, tags: ['light', 'bio'] }, { shape: 'infantry', color: '#b04a3a' }),
  E('hound', 'Rust Hound', 1, { hp: 34, atk: 6, rate: 1.4, range: 1.2, speed: 6, size: 0.5, tags: ['light', 'bio'] }, { shape: 'beast', color: '#8a3a2a' }),
  E('ratbomb', 'Bomb Rat', 1, { hp: 22, atk: 34, rate: 1, range: 0.8, speed: 5, splash: 2.6, size: 0.4, tags: ['light', 'bio'], ab: { suicide: {} } }, { shape: 'blob', color: '#d06a2a' }, { value: 1 }),
  E('crawlers', 'Crawler', 1, { hp: 26, atk: 5, rate: 1.4, range: 1.1, speed: 5, size: 0.4, tags: ['light', 'bio'] }, { shape: 'beast', color: '#b04040' }),
  E('slinger', 'Junk Slinger', 1, { hp: 36, atk: 8, rate: 0.8, range: 13, speed: 3, size: 0.55, hitsAir: true, tags: ['light', 'bio'] }, { shape: 'infantry', color: '#9a5a3a', gear: 'bow' }),
  E('buzz', 'Buzz Drone', 2, { hp: 40, atk: 6, rate: 1.4, range: 7, speed: 7, size: 0.5, air: true, hitsAir: true, tags: ['light', 'mech'] }, { shape: 'drone', color: '#d04a4a' }),
  E('brute', 'Shield Brute', 2, { hp: 160, atk: 14, rate: 0.8, range: 1.6, speed: 3, armor: 3, size: 0.95, tags: ['armored', 'bio'] }, { shape: 'giant', color: '#7a2a2a' }),
  E('spitter', 'Acid Spitter', 2, { hp: 70, atk: 9, rate: 1, range: 10, speed: 3.2, size: 0.7, tags: ['bio'], ab: { burn: { dps: 4, dur: 3 } } }, { shape: 'beast', color: '#9ad04a' }),
  E('berserker', 'Berserker', 2, { hp: 110, atk: 12, rate: 1.1, range: 1.4, speed: 4.6, size: 0.7, tags: ['bio'], ab: { enrage: { at: 0.4, mul: 2 } } }, { shape: 'infantry', color: '#d03030', gear: 'axe' }),
  E('buggy', 'Rocket Buggy', 2, { hp: 90, atk: 18, rate: 0.6, range: 11, speed: 7.5, armor: 1, size: 0.9, hitsAir: true, tags: ['mech'] }, { shape: 'tank', color: '#a05a2a' }),
  E('sniper', 'Raider Sniper', 3, { hp: 60, atk: 45, rate: 0.3, range: 24, speed: 2.6, size: 0.6, hitsAir: true, tags: ['light', 'bio'] }, { shape: 'infantry', color: '#5a2a2a', gear: 'tube' }),
  E('mortar', 'Mortar Crew', 3, { hp: 70, atk: 26, rate: 0.33, range: 24, minRange: 4, speed: 2.4, splash: 2.6, size: 0.65, tags: ['bio'] }, { shape: 'artillery', color: '#7a3a2a' }, { shell: true }),
  E('gunship', 'Gunship', 3, { hp: 220, atk: 14, rate: 1.2, range: 10, speed: 4.6, armor: 2, size: 1.4, air: true, hitsAir: true, tags: ['armored', 'mech'] }, { shape: 'air', color: '#8a2a3a' }),
  E('shaman', 'Frost Shaman', 3, { hp: 90, atk: 10, rate: 0.8, range: 10, speed: 3, size: 0.65, hitsAir: true, tags: ['bio'], ab: { slow: { amt: 0.5, dur: 2 }, heal: { hps: 6, range: 8 } } }, { shape: 'caster', color: '#4a7ad0' }),
  E('nest', 'Spawner Nest', 3, { hp: 380, atk: 0, rate: 0, range: 8, speed: 0.6, armor: 2, size: 1.6, tags: ['armored', 'bio', 'large'], ab: { spawn: { unit: 'crawler', every: 4, n: 2, max: 10 } } }, { shape: 'blob', color: '#7a2a4a' }, { value: 14 }),
  E('leech', 'Leech Prowler', 3, { hp: 130, atk: 14, rate: 1, range: 1.4, speed: 5, size: 0.75, tags: ['bio'], ab: { lifesteal: { f: 0.6 } } }, { shape: 'beast', color: '#5a1a3a' }),
  E('necro', 'Bone Caller', 4, { hp: 140, atk: 12, rate: 0.8, range: 10, speed: 2.8, size: 0.7, hitsAir: true, tags: ['bio'], ab: { raise: { every: 5, n: 2, r: 12 } } }, { shape: 'caster', color: '#4a4a5a' }, { vm: 1.8 }),
  E('juggernaut', 'Juggernaut', 4, { hp: 700, atk: 32, rate: 0.6, range: 2, speed: 2.6, armor: 5, splash: 1.5, size: 1.6, tags: ['armored', 'mech', 'large'] }, { shape: 'giant', color: '#5a5a62' }),
  E('walker', 'Siege Walker', 4, { hp: 420, atk: 50, rate: 0.35, range: 22, minRange: 5, speed: 2.2, armor: 3, splash: 2.8, size: 1.8, tags: ['armored', 'mech', 'large'] }, { shape: 'walker', color: '#7a3a2a' }, { shell: true }),
  E('hellbat', 'Flame Rider', 4, { hp: 260, atk: 9, rate: 2, range: 3.6, speed: 4.6, armor: 2, splash: 2, size: 1.1, tags: ['armored', 'mech'], ab: { burn: { dps: 8, dur: 3 } } }, { shape: 'walker', color: '#d05a2a' }),
  E('wisp', 'Void Wisp', 4, { hp: 160, atk: 20, rate: 0.9, range: 8, speed: 5.5, size: 0.8, air: true, hitsAir: true, tags: ['light'], ab: { phase: { every: 3 } } }, { shape: 'orb', color: '#8a3ad0' }),
  E('warlord', 'Raider Warlord', 4, { hp: 520, atk: 28, rate: 0.8, range: 2, speed: 3.4, armor: 3, size: 1.2, tags: ['armored', 'bio'], ab: { rally: { r: 9, atk: 0.3 } } }, { shape: 'giant', color: '#a02020', gear: 'axe' }, { vm: 1.4 }),
  E('plague', 'Plague Bearer', 5, { hp: 520, atk: 16, rate: 1, range: 2, speed: 3, armor: 2, size: 1.3, tags: ['bio', 'large'], ab: { burnAura: { r: 5, dps: 14 }, deathSpawn: { unit: 'crawler', n: 6 } } }, { shape: 'giant', color: '#6a8a2a' }, { vm: 1.4 }),
  E('colossus', 'Tripod Walker', 5, { hp: 900, atk: 40, rate: 0.7, range: 14, speed: 2.6, armor: 2, splash: 2, size: 2.4, hitsAir: true, tags: ['armored', 'mech', 'large'], ab: { pierce: { len: 10, w: 1.5 } } }, { shape: 'walker', color: '#c0a060' }),
  E('behemoth', 'Behemoth', 5, { hp: 1500, atk: 55, rate: 0.6, range: 2.4, speed: 2.6, armor: 4, splash: 3, size: 2.4, tags: ['armored', 'bio', 'large'], ab: { quake: { every: 9, r: 6, dmg: 70, stun: 1 } } }, { shape: 'giant', color: '#4a2a2a', gear: 'tusks' }),
  E('leviathan', 'Sky Whale', 6, { hp: 2400, atk: 30, rate: 2, range: 11, speed: 2, armor: 4, splash: 1.5, size: 3.4, air: true, hitsAir: true, tags: ['armored', 'bio', 'large'], ab: { spawn: { unit: 'crawler', every: 3, n: 3, max: 15 } } }, { shape: 'zeppelin', color: '#5a2a5a' }, { vm: 1.3 }),
  E('golem', 'Titan Golem', 6, { hp: 3200, atk: 80, rate: 0.5, range: 2.6, speed: 2.2, armor: 6, splash: 3, size: 3, tags: ['armored', 'large'], ab: { cap: { max: 60 } } }, { shape: 'giant', color: '#6a6a6a' }),
  E('phasebeast', 'Phase Beast', 6, { hp: 1200, atk: 45, rate: 1, range: 2, speed: 6, armor: 3, size: 1.8, tags: ['armored', 'bio', 'large'], ab: { blink: { at: 0.5, dist: -10 }, lifesteal: { f: 0.3 } } }, { shape: 'beast', color: '#3a2a8a' }),
  // ---- faction troops (themed waves, see FACTIONS) ----
  E('scoutcar', 'Scout Car', 1, { hp: 55, atk: 6, rate: 1.2, range: 9, speed: 7, armor: 1, size: 0.8, hitsAir: true, tags: ['light', 'mech'] }, { shape: 'tank', color: '#8a7a4a' }),
  E('skelwar', 'Skeleton Warrior', 1, { hp: 40, atk: 7, rate: 1, range: 1.3, speed: 3.4, size: 0.55, tags: ['light'] }, { shape: 'infantry', color: '#d8d0c0', gear: 'axe' }),
  E('kite', 'Kite Drone', 1, { hp: 28, atk: 5, rate: 1.4, range: 6, speed: 7.5, size: 0.45, air: true, hitsAir: true, tags: ['light', 'mech'] }, { shape: 'drone', color: '#e0a040' }),
  E('imp', 'Fire Imp', 1, { hp: 30, atk: 5, rate: 1.2, range: 6, speed: 5, size: 0.45, tags: ['light', 'bio'], ab: { burn: { dps: 4, dur: 2 } } }, { shape: 'beast', color: '#ff7a2a' }),
  E('icewolf', 'Ice Wolf', 1, { hp: 42, atk: 6, rate: 1.3, range: 1.3, speed: 6.5, size: 0.6, tags: ['light', 'bio'], ab: { slow: { amt: 0.3, dur: 1 } } }, { shape: 'beast', color: '#bfe0ff' }),
  E('zealot', 'Fallen Crusader', 1, { hp: 50, atk: 7, rate: 1.1, range: 1.4, speed: 4, armor: 1, size: 0.6, tags: ['bio'] }, { shape: 'infantry', color: '#e0d090', gear: 'cross' }),
  E('sparkling', 'Sparkling', 1, { hp: 30, atk: 6, rate: 1, range: 7, speed: 4.5, size: 0.45, hitsAir: true, tags: ['light'], ab: { chain: { n: 1, r: 4, falloff: 0.7 } } }, { shape: 'orb', color: '#9ad0ff' }),
  E('voidling', 'Voidling', 1, { hp: 34, atk: 7, rate: 1, range: 1.2, speed: 5.5, size: 0.5, tags: ['light'], ab: { stealth: { dur: 3 } } }, { shape: 'beast', color: '#6a3ad0' }),
  E('ninja', 'Shadow Initiate', 1, { hp: 36, atk: 9, rate: 1.2, range: 1.4, speed: 6.5, size: 0.5, tags: ['light', 'bio'], ab: { stealth: { dur: 4 } } }, { shape: 'infantry', color: '#2a2a3a', gear: 'pike' }),
  E('plaguerat', 'Plague Rat', 1, { hp: 24, atk: 4, rate: 1.4, range: 1, speed: 6, size: 0.4, tags: ['light', 'bio'], ab: { burn: { dps: 3, dur: 3 } } }, { shape: 'beast', color: '#7a9a3a' }),
  E('lighttank', 'Light Tank', 2, { hp: 140, atk: 16, rate: 0.7, range: 10, speed: 4.5, armor: 2, size: 1, tags: ['armored', 'mech'] }, { shape: 'tank', color: '#7a6a3a' }),
  E('frostling', 'Frost Archer', 2, { hp: 50, atk: 8, rate: 0.9, range: 13, speed: 3, size: 0.55, hitsAir: true, tags: ['light', 'bio'], ab: { slow: { amt: 0.3, dur: 1.5 } } }, { shape: 'infantry', color: '#a8d0f0', gear: 'bow' }),
  E('flak', 'Flak Track', 3, { hp: 200, atk: 12, rate: 1.6, range: 12, speed: 3.6, armor: 2, splash: 1.2, size: 1.2, hitsAir: true, bonus: { air: 2 }, tags: ['armored', 'mech'] }, { shape: 'tank', color: '#6a6a4a', gear: 'twin' }),
  E('banshee', 'Night Raider', 3, { hp: 110, atk: 12, rate: 1, range: 7, speed: 6, size: 0.8, air: true, hitsAir: true, tags: ['light'], ab: { slow: { amt: 0.3, dur: 1 } } }, { shape: 'air', color: '#c0c8e0', gear: 'wings' }),
  E('icegolem', 'Ice Golem', 4, { hp: 650, atk: 30, rate: 0.6, range: 2, speed: 2.6, armor: 4, size: 1.7, tags: ['armored', 'large'], ab: { slow: { amt: 0.5, dur: 2 } } }, { shape: 'giant', color: '#a8d8f0' }),
  E('templar', 'Fallen Prophet', 4, { hp: 480, atk: 26, rate: 0.8, range: 1.8, speed: 4, armor: 4, size: 1.2, tags: ['armored', 'bio'], ab: { heal: { hps: 8, range: 6 } } }, { shape: 'giant', color: '#e0c070', gear: 'axe' }),
  E('lich', 'Lich', 5, { hp: 500, atk: 30, rate: 0.8, range: 12, speed: 2.6, armor: 2, size: 1.3, hitsAir: true, tags: ['bio'], ab: { raise: { every: 4, n: 3, r: 14 }, storm: { every: 9, r: 4, dps: 25, dur: 3 } } }, { shape: 'caster', color: '#5a8a7a' }, { vm: 1.5 }),
  E('firedrake', 'Fire Drake', 5, { hp: 700, atk: 40, rate: 0.6, range: 8, speed: 5, armor: 2, splash: 2.5, size: 2, air: true, hitsAir: true, tags: ['bio', 'large'], ab: { burn: { dps: 10, dur: 3 } } }, { shape: 'air', color: '#e0501a', gear: 'wings' }),
  E('seraph', 'Fallen Seraph', 5, { hp: 600, atk: 35, rate: 0.8, range: 10, speed: 5, armor: 2, size: 1.6, air: true, hitsAir: true, tags: ['large'], ab: { heal: { hps: 20, range: 10 } } }, { shape: 'air', color: '#f0e0a0', gear: 'wings' }),
  E('warhulk', 'Siege Hulk', 5, { hp: 1300, atk: 70, rate: 0.4, range: 14, speed: 2.2, armor: 5, splash: 2.5, size: 2.3, hitsAir: true, tags: ['armored', 'mech', 'large'] }, { shape: 'tank', color: '#5a5a3a', gear: 'twin' }, { shell: true }),
  E('bonedragon', 'Bone Dragon', 6, { hp: 2000, atk: 60, rate: 0.6, range: 7, speed: 4, armor: 3, splash: 3, size: 3, air: true, hitsAir: true, tags: ['large'], ab: { deathSpawn: { unit: 'skeleton', n: 8 } } }, { shape: 'air', color: '#d8d0c0', gear: 'wings' }),
  E('tempest', 'Storm Titan', 6, { hp: 2200, atk: 40, rate: 1, range: 10, speed: 2.6, armor: 3, size: 2.8, hitsAir: true, tags: ['armored', 'large'], ab: { chain: { n: 5, r: 7, falloff: 0.8 }, storm: { every: 6, r: 6, dps: 40, dur: 3 } } }, { shape: 'walker', color: '#7ab0ff' }),
  E('overlord', 'Tank Tyrant', 6, { hp: 3000, atk: 110, rate: 0.4, range: 16, speed: 2, armor: 6, splash: 3.5, size: 3, hitsAir: true, tags: ['armored', 'mech', 'large'] }, { shape: 'tank', color: '#4a4a2a', gear: 'twin' }, { shell: true }),
];
// Bosses: one per 10 rounds. Amon is the round-20 finale.
export const BOSSES = [
  E('warden', 'Warden Prime', 7, { hp: 5200, atk: 60, rate: 0.8, range: 3, speed: 2.6, armor: 4, splash: 3, size: 3.2, hitsAir: true, tags: ['armored', 'large', 'boss'],
    ab: { quake: { every: 8, r: 10, dmg: 80, stun: 1 }, spawn: { unit: 'crawler', every: 6, n: 4, max: 24 }, cap: { max: 120 } } }, { shape: 'boss', color: '#ff6a3a' }, { value: 160 }),
  E('amon', 'Amon, the Fallen', 7, { hp: 7000, atk: 60, rate: 1, range: 8, speed: 2.4, armor: 3, splash: 3, size: 4.2, hitsAir: true, tags: ['armored', 'large', 'boss'],
    ab: { chain: { n: 4, r: 8, falloff: 0.8 }, quake: { every: 8, r: 11, dmg: 80, stun: 1 }, storm: { every: 10, r: 5, dps: 40, dur: 3 }, summon: { every: 14, value: 45 }, enrage: { at: 0.5, mul: 1.5 }, cap: { max: 180 } } },
  { shape: 'boss', color: '#8a2ad0', gear: 'crown' }, { value: 480 }),
];

export const ALL_UNITS = [...UNITS, ...SUMMONS, ...ENEMIES, ...BOSSES];
export const UNIT_BY_ID = new Map(ALL_UNITS.map(u => [u.id, u]));
for (const u of ALL_UNITS) u.v = unitValue(u);
// Tier tuning: a unit card whose group is weaker than its tier's value target gets its health and damage
// scaled up to meet it (up to 3x), so higher tiers are reliably stronger cards.
for (const u of UNITS) {
  if (u.value) continue;
  const k = Math.min(3, TIER_TARGET[u.tier] / (u.v * u.count));
  if (k < 1.12) continue;
  u.hp = Math.round(u.hp * k); u.atk = Math.round((u.atk || 0) * k);
  if (u.ab && u.ab.siege) u.ab.siege = { ...u.ab.siege, atk: Math.round(u.ab.siege.atk * k) };
  u.v = unitValue(u);
}
// v1.0.7 balance: unit cards that won or lost far more than others of their tier in head-to-head test battles
// (each card alone against a wave worth its tier's value) get their health and damage nudged toward the middle.
// Space King: less health (it was a wall), same punch.
const BALANCE = { scout: 0.82, archer: 0.9, rifle: 0.9, grenadier: 0.89, critters: 1.1, swarm: 1.06, pike: 1.05, militia: 1.11, turretnest: 0.83,
  spitter: 0.91, rocket: 0.91, flame: 1.1, mortar: 0.93, wolf: 1.08, concuss: 1.06, footman: 1.05, engineer: 1.25, stalker: 0.82, beam: 0.82,
  shade: 0.85, ballista: 0.91, siege: 1.11, ghoul: 1.08, lancer: 1.24, wyrm: 0.82, lurker: 0.94, chieftain: 0.89, prism: 1.07, guardian: 1.15,
  trebuchet: 1.16, archon: 0.92, ultra: 1.13, carrier: 1.25, mother: 0.86, brood: 1.08, infernal: 1.1 };
for (const u of UNITS) {
  if (u.id === 'spaceking') { u.hp = Math.round(u.hp * 0.7); u.v = unitValue(u); continue; }
  const m = BALANCE[u.id]; if (!m) continue;
  u.hp = Math.round(u.hp * m); u.atk = Math.round((u.atk || 0) * m * 10) / 10;
  if (u.ab && u.ab.siege) u.ab.siege = { ...u.ab.siege, atk: Math.round(u.ab.siege.atk * m) };
  if (u.ab && u.ab.hangar) u.ab = { ...u.ab, hangar: { ...u.ab.hangar, max: Math.round(u.ab.hangar.max * m) } };
  u.v = unitValue(u);
}
// Bigger battles: every unit card with several units brings 60% more of them, each a little weaker (same total value).
for (const u of UNITS) {
  if (u.count < 2) continue;
  const n = Math.round(u.count * AMON.squadMul), k = u.count / n;
  u.hp = Math.round(u.hp * Math.sqrt(k)); u.atk = Math.round((u.atk || 0) * Math.sqrt(k) * 10) / 10; u.count = n;
  if (u.value) u.value = Math.round(u.value * k * 10) / 10;
  if (u.ab && u.ab.heal) u.ab = { ...u.ab, heal: { ...u.ab.heal, hps: Math.round(u.ab.heal.hps * k * 10) / 10 } };
  u.v = unitValue(u);
}
// Corrupted versions of the player units (Game Master, from round 8): same stats +10%, enemy colors.
export function corrupted(u) {
  const id = 'x-' + u.id;
  if (UNIT_BY_ID.has(id)) return UNIT_BY_ID.get(id);
  const c = { ...u, id, name: 'Corrupted ' + u.name, side: 1, hp: Math.round(u.hp * 1.1), atk: Math.round((u.atk || 0) * 1.1), look: { ...u.look, color: tint(u.look.color) }, aura: undefined };
  c.v = unitValue(c) * (u.value ? 1.1 : 1); if (u.value) c.value = c.v;
  UNIT_BY_ID.set(id, c);
  return c;
}
function tint(hex) {   // pull a color toward the raiders' dark crimson
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const m = (a, t) => Math.round(a * 0.45 + t * 0.55);
  return '#' + [m(r, 150), m(g, 30), m(b, 60)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- enemy factions (themed waves)
// Every round the Game Master sends one faction. Its wave is mostly the faction's own troops ('core', 'x-<id>' = a corrupted
// copy of a player unit), with a little help from 'aux'. The chaos faction takes anything and only keeps to the point budget.
const F = (id, leader, title, icon, color, core, aux = []) => ({ id, leader, title, icon, color, core, aux, emblem: '/art/amon/faction-' + id + '.png' });   // emblems: tools/amon-art.py
export const FACTIONS = [
  F('tank', 'General Korvak', 'Tank Commander', '🎖', '#c2a45a', ['scoutcar', 'buggy', 'lighttank', 'x-tinytank', 'flak', 'x-siege', 'walker', 'juggernaut', 'x-prism', 'warhulk', 'x-mammoth', 'overlord'], ['grunt', 'x-engineer', 'x-rocket', 'sniper']),
  F('swarm', 'The Hive Mother', 'Endless Swarm', '🐛', '#a65ad8', ['crawlers', 'hound', 'ratbomb', 'x-swarm', 'x-bile', 'spitter', 'leech', 'x-roach', 'nest', 'x-lurker', 'plague', 'x-ultra', 'leviathan', 'x-brood'], ['buzz', 'x-ghoul']),
  F('bone', 'Mordrak the Bone Lord', 'Undead Legion', '💀', '#d8d0b0', ['skelwar', 'crawlers', 'x-ghoul', 'banshee', 'necro', 'wisp', 'lich', 'x-troll', 'bonedragon'], ['leech', 'plague']),
  F('sky', 'Admiral Vex', 'Sky Fleet', '✈', '#6ab8ea', ['kite', 'buzz', 'x-scout', 'gunship', 'x-lancer', 'x-shade', 'wisp', 'x-wyrm', 'x-dread', 'x-carrier', 'x-frost', 'x-kirov', 'leviathan'], ['x-rocket', 'slinger']),
  F('artillery', 'Marshal Ashgrave', 'Artillery Corps', '🎯', '#d0904a', ['slinger', 'x-grenadier', 'x-lobber', 'mortar', 'x-mortar', 'sniper', 'x-ballista', 'walker', 'x-trebuchet', 'colossus', 'overlord'], ['x-riot', 'brute', 'grunt']),
  F('pyro', 'Ignis the Burning', 'Pyro Cult', '🔥', '#ff6a1a', ['imp', 'x-torch', 'x-flame', 'spitter', 'hellbat', 'firedrake', 'x-infernal', 'plague'], ['grunt', 'berserker', 'x-lobber']),
  F('frost', 'The Frost Witch', 'Winter Court', '❄', '#9ad8ff', ['icewolf', 'frostling', 'shaman', 'x-concuss', 'x-wolf', 'icegolem', 'x-frost', 'golem'], ['x-archer', 'x-pike']),
  F('iron', 'Lord Brannoc', 'Iron Legion', '⚔', '#b0b8c8', ['x-pike', 'brute', 'x-footman', 'x-riot', 'x-knight', 'berserker', 'warlord', 'juggernaut', 'x-guardian', 'x-elephant', 'golem'], ['x-archer', 'x-medic']),
  F('beast', 'Rhoga the Beastmaster', 'Wild Hunt', '🐺', '#a07a4a', ['hound', 'icewolf', 'x-wolf', 'x-spitter', 'leech', 'x-chieftain', 'behemoth', 'phasebeast', 'x-ultra', 'x-elephant'], ['x-archer', 'slinger']),
  F('machine', 'THE MAINFRAME', 'Machine Hive', '🤖', '#7ab0c0', ['kite', 'buzz', 'x-scout', 'x-turretnest', 'x-stalker', 'x-tinytank', 'hellbat', 'x-thor', 'walker', 'colossus', 'golem', 'x-mother'], ['x-engineer']),
  F('void', 'The Hollow Choir', 'Void Cult', '🌀', '#8a4ae0', ['voidling', 'wisp', 'x-shade', 'x-stalker', 'x-adept', 'phasebeast', 'x-archon'], ['necro', 'shaman']),
  F('raider', 'Skarr the Raider King', 'Scrap Raiders', '🏴', '#c05040', ['grunt', 'hound', 'slinger', 'ratbomb', 'berserker', 'buggy', 'brute', 'sniper', 'mortar', 'gunship', 'warlord', 'juggernaut', 'behemoth'], ['buzz']),
  F('plague', 'Doctor Rot', 'Plague Bearers', '☣', '#9ac03a', ['plaguerat', 'ratbomb', 'spitter', 'x-bile', 'leech', 'x-ghoul', 'nest', 'plague', 'x-brood'], ['necro', 'crawlers']),
  F('crusade', 'The Fallen Paladin', 'Black Crusade', '✝', '#e8c870', ['zealot', 'x-pike', 'x-archer', 'x-footman', 'x-knight', 'x-monk', 'templar', 'seraph', 'x-elephant'], ['x-medic', 'x-ballista']),
  F('storm', 'Volta the Stormcaller', 'Storm Coven', '⚡', '#8ac0ff', ['sparkling', 'x-concuss', 'x-beam', 'x-adept', 'x-prism', 'x-thor', 'x-wyrm', 'tempest'], ['shaman', 'buzz']),
  F('shadow', 'The Silent Hand', 'Shadow Clan', '🗡', '#7a6aa0', ['ninja', 'voidling', 'x-blade', 'leech', 'sniper', 'x-shade', 'x-stalker', 'phasebeast'], ['x-archer']),
  F('chaos', 'Anarchus', 'Chaos Horde', '🎲', '#ff4fd0', [], []),
  // v28: the Arbiter reads the players' boards and brings what beats them (massed cheap units, a few elites, all fliers,
  // all melee, a glass back line, heavy armor). Its core list is only what it can draw from; planWave picks per army.
  F('counter', 'The Arbiter', 'Countermeasure Legion', '⚖', '#40d0b0', ['x-mortar', 'x-lobber', 'hellbat', 'x-adept', 'x-wyrm', 'x-chieftain', 'flak', 'x-rocket', 'x-archer', 'shaman', 'x-thor', 'hound', 'x-stalker', 'ninja', 'x-shade', 'phasebeast', 'x-wolf', 'x-ballista', 'sniper', 'x-beam', 'crawlers', 'plaguerat', 'x-concuss', 'frostling', 'x-blade', 'x-riot', 'x-guardian'], []),
];
// Every faction (except the Arbiter) has a trait of its own that changes how its troops fight, so factions feel different
// beyond their unit lists. fx is applied to every raider of that faction (see deployWave in amon.js); w = how much it is
// worth (the wave brings that much fewer troops). Chaos rolls a random trait each wave.
export const FACTION_TRAITS = {
  tank:      { text: 'Reinforced hulls: +2 armor on every unit.', fx: { armor: 2 }, w: 0.06 },
  swarm:     { text: 'Frenzy: 20% faster, and they keep coming.', fx: { speed: 0.2 }, w: 0.04 },
  bone:      { text: 'Life drain: every hit heals them for 15% of the damage.', fx: { lifesteal: 0.15 }, w: 0.06 },
  sky:       { text: 'Air superiority: +2 m range.', fx: { range: 2 }, w: 0.05 },
  artillery: { text: 'Heavy shells: +1 m splash on every attack.', fx: { splash: 1 }, w: 0.06 },
  pyro:      { text: 'Everything burns: hits ignite (4/s).', fx: { burn: 4 }, w: 0.06 },
  frost:     { text: 'Frostbite: hits slow by 25%.', fx: { slow: 0.25 }, w: 0.06 },
  iron:      { text: 'Shield wall: a barrier worth 15% of their health at the start.', fx: { shieldPct: 0.15 }, w: 0.07 },
  beast:     { text: 'The hunt: 15% faster and 15% quicker attacks.', fx: { speed: 0.15, rate: 0.15 }, w: 0.06 },
  machine:   { text: 'Deflectors: 10% chance to block a hit.', fx: { block: 0.1 }, w: 0.06 },
  void:      { text: 'Unmaking: hits make your units take 12% more damage.', fx: { hex: 0.12 }, w: 0.06 },
  raider:    { text: 'Loot fever: 12% quicker attacks.', fx: { rate: 0.12 }, w: 0.05 },
  plague:    { text: 'Contagion: hits poison (ramping, like the Poison card).', fx: { poison: 0.5 }, w: 0.07 },
  crusade:   { text: 'Zeal: regenerate 2% of their health every second.', fx: { regenPct: 0.02 }, w: 0.06 },
  storm:     { text: 'Arc: ranged attacks jump to 1 more enemy.', fx: { chain: 1 }, w: 0.06 },
  shadow:    { text: 'Ambush: the whole army starts the battle unseen for 3 s.', fx: { stealth: 3 }, w: 0.05 },
};
export const COUNTER_WHY = {
  swarm: 'You field lots of small units: they bring splash, chain lightning and ground slams.',
  elite: 'You rely on a few strong units: they bring piercing, poison, slows and lots of bodies.',
  air: 'Most of your army flies: they bring anti-air.',
  melee: 'Your army is mostly melee: they bring ranged troops that slow and kite.',
  backline: 'Your army is mostly ranged: they bring fast divers and assassins.',
  armor: 'Your army is heavily armored: they bring armor-piercing weapons.',
  mixed: 'Your army is balanced: they bring a bit of everything.',
};
export const COUNTER_POOLS = {
  swarm: ['x-mortar', 'x-lobber', 'hellbat', 'x-adept', 'x-wyrm', 'x-chieftain', 'x-riot'],
  elite: ['x-ballista', 'plaguerat', 'x-concuss', 'frostling', 'crawlers', 'x-blade', 'sniper'],
  air: ['flak', 'x-rocket', 'x-archer', 'shaman', 'x-thor', 'x-wyrm'],
  melee: ['x-archer', 'frostling', 'x-concuss', 'shaman', 'x-mortar', 'x-guardian'],
  backline: ['hound', 'x-stalker', 'ninja', 'x-shade', 'phasebeast', 'x-wolf'],
  armor: ['x-ballista', 'sniper', 'x-beam', 'x-thor', 'x-blade'],
};
export const FACTION_BY_ID = new Map(FACTIONS.map(f => [f.id, f]));
// A faction's unit list as unit definitions (corrupted copies made on demand). Chaos: every enemy and every corrupted unit.
export function factionUnits(f, list = 'core') {
  const ids = f.id === 'chaos' ? (list === 'core' ? [...ENEMIES.map(e => e.id), ...UNITS.map(u => 'x-' + u.id)] : []) : f[list];
  return ids.map(id => id.startsWith('x-') ? (UNIT_BY_ID.get(id.slice(2)) ? corrupted(UNIT_BY_ID.get(id.slice(2))) : null) : UNIT_BY_ID.get(id)).filter(Boolean);
}

// ---------------------------------------------------------------- board patterns (chess-inspired)
// Each pattern lists the cells a card's effect reaches from (row, col). Row 0 is the front.
const RAYS = { rook: [[1, 0], [-1, 0], [0, 1], [0, -1]], bishop: [[1, 1], [1, -1], [-1, 1], [-1, -1]] };
export const PATTERNS = {
  self:   { name: 'This card', icon: '◉' },
  adj:    { name: 'Adjacent (up, down, left, right)', icon: '✚' },
  diag:   { name: 'Diagonal neighbors', icon: '✖' },
  ring:   { name: 'All 8 neighbors (king)', icon: '▣' },
  front:  { name: 'The card in front', icon: '▲' },
  back:   { name: 'The card behind', icon: '▼' },
  row:    { name: 'Its whole row', icon: '↔' },
  col:    { name: 'Its whole column', icon: '↕' },
  knight: { name: 'Knight moves (L-shape)', icon: '♞' },
  bishop: { name: 'Diagonal lines (bishop)', icon: '♝' },
  rook:   { name: 'Row and column (rook)', icon: '♜' },
  queen:  { name: 'Lines in all 8 directions (queen)', icon: '♛' },
};
export function patternCells(pattern, r, c, N = AMON.boardSize) {
  const out = [], add = (y, x) => { if (y >= 0 && y < N && x >= 0 && x < N && !(y === r && x === c)) out.push([y, x]); };
  const ray = dirs => { for (const [dy, dx] of dirs) for (let k = 1; k < N; k++) add(r + dy * k, c + dx * k); };
  switch (pattern) {
    case 'self': return [[r, c]];
    case 'adj': for (const [dy, dx] of RAYS.rook) add(r + dy, c + dx); break;
    case 'diag': for (const [dy, dx] of RAYS.bishop) add(r + dy, c + dx); break;
    case 'ring': for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) add(r + dy, c + dx); break;
    case 'front': add(r - 1, c); break;
    case 'back': add(r + 1, c); break;
    case 'row': for (let x = 0; x < N; x++) add(r, x); break;
    case 'col': for (let y = 0; y < N; y++) add(y, c); break;
    case 'knight': for (const [dy, dx] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(r + dy, c + dx); break;
    case 'bishop': ray(RAYS.bishop); break;
    case 'rook': ray(RAYS.rook); break;
    case 'queen': ray([...RAYS.rook, ...RAYS.bishop]); break;
  }
  return out;
}
// Squares themselves (chess board control): front row toughens melee, the back two rows extend ranged reach, the center square inspires.
export function squareBonus(r, c, unit) {
  const fx = {};
  if (r === 0 && unit.range <= 3) fx.hp = 0.1;
  if (r >= 3 && unit.range > 3) fx.range = 1;
  if (r === 2 && c === 2) { fx.atk = (fx.atk || 0) + 0.1; fx.hp = (fx.hp || 0) + 0.1; }
  return fx;
}

// ---------------------------------------------------------------- effect keys
// hp / atk / rate / speed: fractions (+0.2 = +20%). range, splash: meters. armor: flat. regen: health per second.
// lifesteal: fraction. count: extra units. chain: extra bounce targets. slow / burn: on-hit effects.
// gold: income per round (self). interest: +1 gold per 10 unspent (max 3).
// amp: auras from the cards it reaches are stronger by this fraction (1 = doubled).
// growth: permanent fraction added to the target's health and damage every round it stays in reach.
// promote: the target card ranks up after every battle won. echo: the target's units come back once at half health.
export const FX_INFO = {
  hp: ['Health', 'pct'], atk: ['Damage', 'pct'], rate: ['Attack speed', 'pct'], speed: ['Move speed', 'pct'], range: ['Range', 'm'],
  splash: ['Splash', 'm'], armor: ['Armor', 'flat'], regen: ['Regen (heals the units it reaches)', 'ps'], lifesteal: ['Lifesteal', 'pct'], count: ['Units', 'flat'],
  chain: ['Bounces', 'flat'], slow: ['Slow on hit', 'pct'], burn: ['Ignite: every hit adds a 3 s burn stack', 'ps'], poison: ['Poison: eats their health, ramping up while it stays on', 'pct'], hex: ['Enemies hit take more damage', 'pct'],
  gold: ['Gold per round', 'flat'], interest: ['Interest', 'flat'], amp: ['Boosts the effects of cards it reaches', 'pct'],
  growth: ['Grows every round', 'pct'], promote: ['Ranks up after each won battle', 'flag'], echo: ['Units return once at half health', 'flag'],
  recruit: ['Permanent unit every round', 'flat'], recruitPct: ['More units every round (share of the card\'s size)', 'pct'],
  encore: ['Chance to attack again at once', 'pct'], block: ['Chance to block a hit (and can block when you pilot it)', 'pct'],
  shield: ['Barrier health per unit at battle start', 'flat'], thorns: ['Reflects damage taken', 'pct'], drain: ['Drains nearby enemies', 'ps'],
  pen: ['Armor piercing', 'flat'], mines: ['Lays mines when the battle starts', 'flat'], knock: ['Hits knock enemies back', 'm'],
  resist: ['Damage taken', 'neg'], turret: ['Sentry turrets deployed', 'flat'], drone: ['Wasp drones launched', 'flat'],
  bomb: ['Hits stick a bomb (damage)', 'pct'], meteor: ['Every 5th attack calls a meteor', 'flat'], cleanse: ['Removes downsides', 'flag'],
};
// Point value multiplier per unit of each bonus a card gets (see computeArmy in amon.js). 'shield' is weighted against the unit's health.
export const BUFF_WEIGHT = {
  hp: 0.5, atk: 0.6, rate: 0.5, speed: 0.15, range: 0.04, splash: 0.12, armor: 0.06, regen: 0.015, lifesteal: 0.6, chain: 0.15, slow: 0.4,
  burn: 0.02, poison: 0.5, hex: 0.6, echo: 0.4, encore: 0.7, block: 0.7, shield: 0.5, thorns: 0.4, drain: 0.012, pen: 0.05, mines: 0.12, knock: 0.03,
  resist: 0.9, turret: 0.15, drone: 0.08, bomb: 0.4, meteor: 0.3,
};
export function fxLines(fx) {
  return Object.entries(fx).filter(([, v]) => v).map(([k, v]) => {
    const [label, kind] = FX_INFO[k] || [k, 'flat'];
    const sign = v < 0 ? '−' : '+', a = Math.abs(v);
    if (kind === 'neg') return { text: `${v > 0 ? '−' : '+'}${Math.round(a * 100)}% ${label}`, good: v > 0 };
    const num = kind === 'pct' ? Math.round(a * 100) + '%' : kind === 'ps' ? (Math.round(a * 10) / 10) + '/s' : kind === 'm' ? (Math.round(a * 10) / 10) + ' m' : kind === 'flag' ? '' : String(Math.round(a * 10) / 10);
    return { text: kind === 'flag' ? label : `${sign}${num} ${label}`, good: v > 0 };
  });
}

// ---------------------------------------------------------------- hand-made tactic cards
const T = (id, name, tier, icon, pattern, fx, desc, extra = {}) => ({ id: 'a-' + id, name, tier, icon, kind: 'tactic', pattern, fx, desc, ...(extra.from ? {} : { imageUrl: '/art/amon/a-' + id + '.png' }), ...extra });   // art: tools/amon-art.py
export const TACTICS = [
  T('amp', 'Amplifier Core', 3, '📡', 'adj', { amp: 1 }, 'Cards next to this have their own board effects doubled.'),
  T('gambit', 'Queen\'s Gambit', 5, '♛', 'queen', { atk: 0.15, rate: 0.1 }, 'Every card along its eight lines fights harder.'),
  T('beacon', 'Reinforcement Beacon', 2, '📯', 'adj', { count: 1 }, 'Adjacent unit cards bring one more unit.'),
  T('chest', 'War Chest', 2, '💰', 'self', { gold: 2 }, '+2 gold every round while it is on the board.'),
  T('interest', 'Investment', 1, '🏦', 'self', { interest: 1 }, '+1 gold for every 10 gold you hold when the store opens (max +3).'),
  T('drill', 'Veteran Drill', 3, '🎖', 'adj', { growth: 0.05 }, 'Adjacent cards permanently gain 5% health and damage every round.'),
  T('promote', 'Field Promotion', 4, '⭐', 'front', { promote: 1 }, 'The card in front ranks up after every battle you win.'),
  T('fortress', 'Fortress Square', 2, '🏯', 'ring', { armor: 2, hp: 0.1 }, 'All 8 neighbors gain armor and health.'),
  T('overcharge', 'Overcharge', 2, '⚙', 'diag', { rate: 0.4, hp: -0.15 }, 'Diagonal cards attack much faster but are frailer.'),
  T('sanctum', 'Sanctum', 3, '⛪', 'ring', { regen: 5 }, 'All 8 neighbors regenerate.'),
  T('echo', 'Echo Chamber', 5, '🔁', 'adj', { echo: 1 }, 'Adjacent unit cards\' units come back once at half health.'),
  T('supply', 'Supply Cache', 1, '📦', 'adj', { count: 1, hp: -0.05 }, 'Adjacent unit cards bring one more (slightly thinner) unit.'),
  T('banner', 'Knight\'s Banner', 2, '♞', 'knight', { atk: 0.25, speed: 0.2 }, 'Cards a knight\'s move away charge harder.'),
  T('wall', 'Castle Wall', 1, '🧱', 'row', { armor: 1 }, 'Its whole row gains armor.'),
  T('overwatch', 'Overwatch Post', 3, '🔭', 'col', { range: 3 }, 'Its whole column reaches 3 m further.'),
  T('uplink', 'Tactical Uplink', 4, '📶', 'rook', { rate: 0.15, range: 1 }, 'Its row and column attack faster and reach further.'),
  T('glass', 'Glass Cannon Doctrine', 3, '💥', 'adj', { atk: 0.5, hp: -0.25 }, 'Adjacent cards hit far harder but break easier.'),
  T('bishop', 'Bishop\'s Blessing', 4, '♝', 'bishop', { hp: 0.2, regen: 2 }, 'Both diagonal lines are blessed with health.'),
  T('rookfort', 'Rook Bastion', 4, '♜', 'rook', { armor: 2, hp: 0.12 }, 'Its row and column dig in.'),
  T('vanguard', 'Vanguard Doctrine', 2, '🗡', 'front', { atk: 0.35, speed: 0.25 }, 'The card in front leads the charge.'),
  T('rearguard', 'Rearguard', 2, '🛡', 'back', { hp: 0.35, armor: 1 }, 'The card behind holds the line.'),
  T('mirror', 'Mirror Array', 5, '🪞', 'ring', { amp: 0.5, atk: 0.1 }, 'Neighbors\' board effects are 50% stronger, and they hit a bit harder.'),
  T('pens', 'Breeding Pens', 2, '🐣', 'adj', { recruitPct: 0.2 }, 'Every round, adjacent unit cards permanently gain 20% more units (at least 1, up to 6x their size). Big swarms of cheap units grow fastest.'),
  T('swarmdoc', 'Swarm Doctrine', 4, '🐜', 'row', { recruitPct: 0.35, hp: -0.1 }, 'Every round, unit cards in this row permanently gain 35% more units (up to 6x their size), each a little thinner.'),
  T('recruit', 'Recruitment Office', 2, '📋', 'adj', { recruit: 1 }, 'Every round, adjacent unit cards permanently gain one more unit (up to double their size).'),
  // translated from the shooter's shield mods
  T('catcher', 'Bullet Catcher', 3, '🧤', 'adj', { armor: 2, lifesteal: 0.12 }, 'Adjacent cards catch hits and drink from them.', { from: 'shield-catcher' }),
  T('clone', 'Cloning Vat', 4, '👥', 'ring', { recruit: 1, hp: -0.05 }, 'Every round, all 8 neighbors permanently gain one more unit (slightly thinner).', { from: 'shield-clone' }),
  T('grove', 'Sacred Grove', 3, '🌼', 'ring', { regen: 4, hp: 0.1 }, 'A blessed circle: all 8 neighbors regenerate and grow tougher.', { from: 'shield-grove' }),
  T('pillar', 'Pillar Tower', 2, '🏛', 'col', { range: 2, armor: 1 }, 'Its column stands taller: more range and armor.', { from: 'shield-pillar' }),
  T('rewind', 'Rewind Field', 4, '⏪', 'front', { echo: 1, hp: 0.15 }, 'The card in front comes back once at half health, a little tougher.', { from: 'shield-rewind' }),
  T('saiyan', 'Power Surge', 5, '⚡', 'front', { atk: 0.6, hp: 0.3, speed: 0.25 }, 'The card in front goes super: much harder hits, more health, faster.', { from: 'shield-saiyan' }),
  T('slam', 'Shockwave Drill', 3, '🦶', 'adj', { atk: 0.2, slow: 0.3 }, 'Adjacent cards hit harder and their hits slow.', { from: 'shield-slam' }),
];
// Permanent units gained between rounds (kept through moves, merges and the bench):
// - recruit fx (Recruitment Office, Cloning Vat): +1 unit per round to each unit card in reach, up to the card's base size.
// - squadmates: two unit cards side by side that share a tag (bio, mech, armored, light) each gain +1 unit, once per neighbor card, up to +3.
export const SQUAD_TAGS = ['bio', 'mech', 'armored', 'light'];
export const SQUAD_MAX = 3;

// ---------------------------------------------------------------- tactic cards made from the shooter's cards
// Every stat card from the other modes becomes a board card: its stat changes are translated to unit effects
// and it gets a reach pattern from its rarity. Holy / cursed / weapon mods stay out.
const RARITY_TIER = { common: 1, uncommon: 2, rare: 3, legendary: 5, combo: 4 };
// (no 'self' pattern: a tactic card has no units of its own, so it would buff nothing)
const RARITY_PATTERNS = { common: ['adj', 'diag', 'front', 'back'], uncommon: ['ring', 'knight', 'row', 'col', 'adj'], rare: ['rook', 'bishop', 'ring', 'knight'], legendary: ['queen', 'rook', 'ring'], combo: ['queen', 'rook', 'bishop'] };
const RARITY_MAG = { common: 1, uncommon: 1.15, rare: 1.35, legendary: 1.7, combo: 1.5 };
const PATTERN_SPREAD = { self: 1.6, front: 1.4, back: 1.4, adj: 1, diag: 1, row: 0.9, col: 0.9, ring: 0.75, knight: 0.75, bishop: 0.7, rook: 0.6, queen: 0.45 };
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const BASE = { damage: 24, health: 100, fireRate: 3.6 };
function translate(m) {
  if (m.op === 'convert') return { [m.to === 'damage' ? 'atk' : m.to === 'health' ? 'hp' : 'rate']: m.value * 0.4 };
  const d = m.op === 'mul' ? m.value - 1 : 0, a = m.op === 'add' ? m.value : 0;
  switch (m.stat) {
    // every other effect from the shooter's cards has an AMON version too
    case 'encore': return { encore: a * 0.5 };
    case 'toxic': return { poison: a ? 0.5 * a : 0, splash: a ? 0.5 : 0 };
    case 'scavenge': return { rate: a ? 0.25 : 0 };
    case 'squid': case 'bees': return { range: a ? 1 : 0 };
    case 'bounceTarget': case 'bounceSplit': return { chain: 1 };
    case 'bounceBoost': return { chain: 1, atk: 0.05 };
    case 'bounceExplode': return { splash: 1 };
    case 'blockDeploy': return { block: 0.1, armor: 1 };
    case 'blockSize': return { block: d * 0.2 };
    case 'blockDuration': return { block: d * 0.1, armor: d };
    case 'blockConcrete': return { shield: a / 10 };
    case 'blockBarricade': return { shield: a / 5 };
    case 'counterShots': return { thorns: a * 0.04 };
    case 'lifeDrain': return { drain: a * 1.5 };
    case 'drainRange': return {};
    case 'drill': return { pen: 3 * a };
    case 'blockEcho': return { echo: 1 };
    case 'blockHeal': return { regen: a / 7 };
    case 'blockMines': return { mines: a };
    case 'reflectBoost': return { thorns: a * 0.4 };
    case 'blockDash': return { speed: 0.15, block: 0.08 };
    case 'blockPush': return { knock: a / 9 };
    case 'knockback': return { knock: a / 3 };
    case 'noSelfDamage': return { resist: 0.15 };
    case 'summonTurret': return { turret: a };
    case 'summonDrone': return { drone: a };
    case 'summonTwin': return { count: 1 };
    case 'shrapnel': return { splash: 1 };
    case 'blockLeech': return { lifesteal: a * 0.3 };
    case 'limpet': return { bomb: a * 0.5 };
    case 'spread': return { atk: -a * 2 };
    case 'skyfall': return { meteor: a || 1 };
    case 'jump': return { speed: d || a * 0.05 };
    case 'damage': return { atk: d || a / BASE.damage };
    case 'health': return { hp: d || a / BASE.health };
    case 'fireRate': return { rate: d || a / BASE.fireRate };
    case 'reloadTime': return { rate: m.op === 'mul' ? (1 / m.value - 1) * 0.5 : -a * 0.15 };
    case 'ammo': return { rate: m.op === 'mul' ? d * 0.25 : a * 0.04 };
    case 'moveSpeed': return { speed: d || a / 8.5 };
    case 'regen': return { regen: a ? a * 1.5 : d * 3 };
    case 'lifesteal': return { lifesteal: a || d * 0.2 };
    case 'explosive': return { splash: a ? a * 1.1 : d };
    case 'bounces': return { chain: a ? Math.max(1, Math.round(a)) : 0 };
    case 'projMul': return { count: 1, atk: -0.1 };   // Twin Barrel: one more of each unit, like +1 bullet
    case 'projectiles': return { count: a ? Math.max(1, Math.round(a)) : 0, atk: a ? -0.1 * a : 0 };
    case 'bulletSpeed': return { range: d * 5 || a / 8 };
    case 'homing': return { range: a ? 1 : 0 };
    case 'blockCooldown': return { block: m.op === 'mul' ? (1 - m.value) * 0.25 : -a * 0.05 };
    case 'chill': return { slow: a ? 0.3 : 0 };
    case 'ignite': case 'napalm': return { burn: a ? 4 * a : 0 };
    case 'poison': return { poison: a ? 0.7 * a : 0 };
    case 'hex': return { hex: a ? 0.2 : 0 };
    case 'chain': return { chain: a ? 1 : 0 };
    case 'healAllies': return { regen: a ? 4 : 0 };
    case 'bulletSize': return { splash: d > 0 ? d * 0.8 : 0 };
    case 'growOnHit': return { growth: a ? 0.03 + a * 0.05 : 0 };
    case 'revive': return { echo: a ? 1 : 0 };
    case 'slowField': case 'blockShock': case 'ringHit': return { armor: a ? 1 : 0 };
    default: return null;
  }
}
const FX_CAP = { hp: 0.8, atk: 0.8, rate: 0.8, speed: 0.6, range: 5, splash: 3, armor: 5, regen: 12, lifesteal: 0.5, count: 2, chain: 3, slow: 0.6, burn: 15, poison: 1.5, hex: 0.4, growth: 0.06, echo: 1,
  encore: 0.6, block: 0.35, shield: 90, thorns: 0.5, drain: 12, pen: 6, mines: 3, knock: 3, resist: 0.3, turret: 2, drone: 3, bomb: 0.8, meteor: 2 };
const FLAT_FX = ['count', 'chain', 'echo', 'mines', 'turret', 'drone', 'meteor'];
// Shooter cards with no stat modifiers get a hand-picked AMON effect.
const SPECIAL_FX = { 'mod-breaker': ['self', { gold: 2 }], repentance: ['ring', { cleanse: 1, regen: 2 }] };
export function cardTactics(cards) {
  const out = [];
  for (const c of cards || []) {
    const tier = RARITY_TIER[c.rarity];
    if (!tier || c.weaponMod || c.shieldMod || !Array.isArray(c.modifiers)) continue;
    if (SPECIAL_FX[c.id]) { const [pattern, fx] = SPECIAL_FX[c.id]; out.push({ id: 't-' + c.id, name: c.name, tier, icon: c.icon || '🃏', kind: 'tactic', pattern, fx: { ...fx }, desc: tacticDesc(fx, pattern), shooterDesc: c.description || '', imageUrl: c.imageUrl || null, from: c.id }); continue; }
    const pats = RARITY_PATTERNS[c.rarity], pattern = pats[hashStr(c.id) % pats.length];
    const k = RARITY_MAG[c.rarity] * PATTERN_SPREAD[pattern];
    const fx = {};
    for (const m of c.modifiers) {
      const tr = translate(m); if (!tr) continue;
      for (const [key, v] of Object.entries(tr)) if (v) fx[key] = (fx[key] || 0) + v;
    }
    for (const key of Object.keys(fx)) {
      const flat = FLAT_FX.includes(key);
      let v = flat ? fx[key] : fx[key] * k;
      const cap = FX_CAP[key] || 1;
      v = Math.max(-cap * 0.6, Math.min(cap, v));
      if (key === 'armor') v = v > 0 ? Math.max(1, Math.round(v * 2) / 2) : Math.min(-1, Math.round(v * 2) / 2);
      fx[key] = flat ? Math.round(v) : Math.round(v * 100) / 100;
      const tiny = key === 'growth' ? 0.01 : ['hp', 'atk', 'rate', 'speed', 'lifesteal', 'slow', 'hex', 'encore', 'block', 'thorns', 'resist', 'bomb', 'poison'].includes(key) ? 0.04 : 0.3;
      if (!fx[key] || (!flat && Math.abs(fx[key]) < tiny)) delete fx[key];
    }
    if (!Object.keys(fx).some(key => fx[key] > 0)) continue;
    out.push({ id: 't-' + c.id, name: c.name, tier, icon: c.icon || '🃏', kind: 'tactic', pattern, fx, desc: tacticDesc(fx, pattern), shooterDesc: c.description || '', imageUrl: c.imageUrl || null, from: c.id });
  }
  return out;
}

// ---------------------------------------------------------------- the card pool
export function unitCard(u) { return { id: 'u-' + u.id, name: u.name, tier: u.tier, icon: u.icon, kind: 'unit', unit: u.id, count: u.count, desc: u.desc || '', pattern: u.aura ? u.aura.pattern : null, fx: u.aura ? u.aura.fx : null, from: u.from || null }; }
// Holy and cursed versions of every tactic card (rolled onto store offers, never in the pool on their own).
// Holy: downsides gone, upsides +30%. Cursed: upsides +70%, downsides +50% (and a health curse if it had none).
export function variantCard(c, kind) {
  const fx = {}, holy = kind === 'holy';
  for (const [k, v] of Object.entries(c.fx || {})) {
    if (!v) continue;
    if (['promote', 'cleanse', 'gold', 'interest', 'recruit', 'echo', 'count'].includes(k)) { fx[k] = v; continue; }
    if (v < 0) { if (!holy) fx[k] = v * 1.5; continue; }
    fx[k] = FLAT_FX.includes(k) ? v + (holy ? 0 : 1) : Math.round(v * (holy ? 1.3 : 1.7) * 100) / 100;
  }
  if (!holy && !Object.values(fx).some(v => v < 0)) fx.hp = -0.15;
  return { ...c, id: kind + ':' + c.id, name: (holy ? 'Holy ' : 'Cursed ') + c.name, fx, variant: kind, base: c.id, noShop: true,
    desc: c.from && c.kind === 'tactic' && c.id.startsWith('t-') ? tacticDesc(fx, c.pattern) : (c.desc || '') };   // the holy / cursed rules live in the right-click details
}
export function buildAmonCards(shooterCards) {
  const base = [...UNITS.map(unitCard), ...TACTICS, ...cardTactics(shooterCards)];
  const list = [...base, ...base.filter(c => c.kind === 'tactic' && cardKind(c) === 'tactic').flatMap(c => [variantCard(c, 'holy'), variantCard(c, 'cursed')])];
  const byId = new Map(list.map(c => [c.id, c]));
  for (const c of list) c.value = cardValue(c, 1);
  return { list, byId };
}
// Card value at a rank: unit cards = units x unit value; tactic cards are valued from their tier target.
export function cardValue(c, rank = 1) {
  if (c.kind === 'unit') { const u = UNIT_BY_ID.get(c.unit); return Math.round(u.v * rankCount(c.count, rank) * AMON.rankMul(rank) * 10) / 10; }
  return Math.round(TIER_TARGET[c.tier] * 0.6 * (c.variant === 'holy' ? 1.3 : c.variant === 'cursed' ? 1.5 : 1) * AMON.rankMul(rank) * 10) / 10;
}
export const rankCount = (count, rank) => count + Math.floor(count * (rank - 1) * 0.5);

// Board AI helper: which row a unit card wants (melee front, artillery back).
export function preferredRow(c) {
  if (c.kind !== 'unit') return 2;
  const u = UNIT_BY_ID.get(c.unit), range = u.ab && u.ab.siege ? u.ab.siege.range : u.range;
  if (u.ab && u.ab.heal && !u.atk) return 3;
  return range <= 2.5 ? 0 : range < 9 ? 1 : range < 16 ? 3 : 4;
}

// What a card is, for its label: unit, economy (only makes gold) or tactic (everything else on the board).
export function cardKind(c) {
  if (c.kind === 'unit') return 'unit';
  const keys = Object.keys(c.fx || {}).filter(k => c.fx[k]);
  return keys.length && keys.every(k => k === 'gold' || k === 'interest') ? 'economy' : 'tactic';
}
