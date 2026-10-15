// =====================================================================
// Blockshot 3D configuration.
// Everything you might want to tweak lives here: rules, base stats,
// rarity weights, bot difficulty and ALL colors/art hooks (see ART).
// =====================================================================

export const RULES = {
  gravity: 26,
  playerRadius: 0.45,
  playerHeight: 1.5,
  chest: 1.0,           // height bullets are fired from (clears 0.8 m cover)
  eye: 1.35,            // first-person camera height
  maxPlayers: 20,
  skyfallHeight: 14,    // where Sky Strike bullets spawn
  pickSeconds: 30,
  countdown: 3,         // seconds of 3-2-1 before each round      // default time limit for picking a card (lobby can change it)
  bulletGravity: 3.4,   // bullet drop for a default-size bullet, m/s² (bigger bullets drop harder: see bulletGravityFor)
  // Platform heights. Level layouts use "units" 0-3; these are the real heights in meters.
  // 0.8 m is low enough to shoot over from first person; 2.0 m needs a step; 3.2 m is tall cover.
  tierHeights: [0, 0.8, 2.0, 3.2],
  blockReflectBonus: 0.42,  // seconds added to a block by its first reflected bullet
  blockReflectDecay: 0.75,  // each further reflect in the same block adds this much less (0.42, 0.32, 0.24...)
  blockMaxExtra: 1.2,       // cap on those bonus seconds per block
  // Hidden knockback every hit carries, growing with the damage of the hit (on top of the Knockback stat).
  hitKnockBase: 2.5, hitKnockPerDamage: 0.11, hitKnockMax: 12,
};

// Every player starts each match with these. Cards modify them.
// Card files refer to these exact names (see README "Stat reference").
export const DEFAULT_STATS = {
  health: 100,
  damage: 24,
  fireRate: 3.6,        // shots per second
  ammo: 3,
  reloadTime: 1.5,      // seconds
  bulletSpeed: 28,
  bulletSize: 0.14,
  bounces: 0,
  projectiles: 1,       // bullets per shot
  projMul: 1,           // v1.1.4 Twin Barrel: bullets per shot are multiplied by this after every card (order doesn't matter)
  spread: 0.1,          // radians between multi-shot bullets
  lifesteal: 0,         // fraction of damage dealt returned as health
  explosive: 0,         // explosion size level (0 = none)
  homing: 0,            // turn rate in radians per second
  moveSpeed: 8.5,
  jump: 9.5,
  blockCooldown: 3.5,
  counterShots: 0,      // free bullets fired when you block
  regen: 0,             // health per second
  skyfall: 0,           // >0: bullets drop from the sky onto your cursor
  blockBarricade: 0,    // >0: blocking drops a sandbag wall with this much health
  blockEcho: 0,         // extra automatic blocks, 1 second apart, after each block
  revive: 0,            // >0: once per round, survive death with this fraction of health
  growOnHit: 0,         // fraction of damage you deal that is added to your max health (this round)
  // ---- block modifiers ----
  blockDuration: 0.35,  // seconds the block bubble lasts
  blockSize: 1,         // bubble size; bigger bubbles also cover nearby teammates
  blockDeploy: 0,       // >0: block places a standing shield wall instead of the bubble
  blockHeal: 0,         // >0: block drops a field that heals allies this much after 1 second
  blockMines: 0,        // >0: block drops mines (one per bullet you fire, plus this - 1 extra)
  blockPush: 0,         // >0: block shoves nearby enemies away with this force
  blockDash: 0,         // >0: block dashes you in the direction you're moving
  reflectBoost: 0,      // reflected bullets gain this fraction of extra damage
  blockShock: 0,        // damage per second to enemies touching your bubble (or deployed shield wall)
  blockLeech: 0,        // fraction of damage your block stops that heals you (bubble or deployed shield, not sandbags)
  blockConcrete: 0,     // >0: blocking drops a concrete wall with this much health
  // ---- gun modifiers ----
  knockback: 0,         // pushes whoever your bullets hit; scales with bullet damage
  drill: 0,             // >0: bullets tunnel through walls and objects
  healAllies: 0,        // fraction of damage dealt that heals nearby allies (co-op waves card)
  // ---- summons (commander mode cards) ----
  summonTwin: 0,        // AI copies of you each round
  summonTurret: 0,      // stationary twin-gun copies of you
  summonDrone: 0,       // flying drones
  // bullet effects
  poison: 0,            // bullets poison instead of hitting: ~40% max HP over 5 s, ramping; hits refresh (see POISON in sim.js), +20%/level
  ignite: 0,            // bullets set targets on fire for 3 s
  chill: 0,             // bullets slow targets for 1.5 s
  hex: 0,               // targets take +25% damage for 2.5 s
  chain: 0,             // hits arc to another enemy within 6 m for 40%/level damage
  limpet: 0,            // bullets stick and explode a second later for 60%/level damage
  shrapnel: 0,          // bullets that hit walls burst into fragments (3 per level)
  noSelfDamage: 0,      // >0: you can't hurt yourself (SCP)
  drain: 0,             // cursed: fraction of max health lost every 2 s (never kills)
  lifeDrain: 0,         // Drain Life card: health per second siphoned from the nearest visible enemy within 5 m + drainRange
  drainRange: 0,        // Drain Life card: extra reach (m) for life drain
  // ---- bounce effects ----
  bounceTarget: 0,      // >0: after a bounce the bullet re-aims at the nearest enemy it can see
  bounceExplode: 0,     // bullets explode on every bounce (and on the last hit) for 100%/level of their damage
  bounceBoost: 0,       // each bounce adds this fraction of damage (and half of it as speed)
  bounceSplit: 0,       // each bounce splits off this many extra bullets (60% damage; splits don't split)
  ringHit: 0,           // outer hit ring radius (m): hits players it touches, ignores walls
  tank: 0,              // Tiny Tank: no jumping, you drive a tank and fire from its barrel
  napalm: 0,            // Napalm Rounds: impacts leave fire splats stuck to surfaces (5 s) that ignite enemies
  slowField: 0,         // Bullet Time: field around you slows bullets that can hurt you to 25% speed (copies widen it)
  toxic: 0,             // Toxic Cloud: impacts leave a drifting poison cloud (level)
  scavenge: 0,          // Scavenger: damaging health reloads you to full
  squid: 0,             // Squid: bullets swim in pulses toward enemies
  bees: 0,              // Bees: bullets fly at the first enemy they see, around obstacles
  encore: 0,            // Encore: free follow-up shots (no ammo) fired right after each shot (1.5 = one, plus a 50% chance of a second)
};

// How stats are shown on cards and kept in sane ranges.
export const STAT_INFO = {
  health:        { label: 'Health', min: 10, max: 2000 },
  damage:        { label: 'Damage', min: 1, max: 500 },
  fireRate:      { label: 'Fire rate', min: 0.3, max: 20 },
  ammo:          { label: 'Ammo', int: true, min: 1, max: 60 },
  reloadTime:    { label: 'Reload time', lowerIsBetter: true, min: 0.15, max: 10 },
  bulletSpeed:   { label: 'Bullet speed', min: 4, max: 120 },
  bulletSize:    { label: 'Bullet size', min: 0.05, max: 1.2 },
  bounces:       { label: 'Bounces', int: true, min: 0, max: 20 },
  projectiles:   { label: 'Bullets per shot', int: true, min: 1, max: 12 },
  projMul:       { label: 'Bullets per shot', min: 1, max: 8 },
  spread:        { label: 'Spread', lowerIsBetter: true, min: 0, max: 1 },
  lifesteal:     { label: 'Lifesteal', percent: true, min: 0, max: 2 },
  explosive:     { label: 'Explosion size', min: 0, max: 6 },
  homing:        { label: 'Homing', min: 0, max: 40 },
  moveSpeed:     { label: 'Move speed', min: 2, max: 25 },
  jump:          { label: 'Jump', min: 4, max: 20 },
  blockCooldown: { label: 'Block cooldown', lowerIsBetter: true, min: 0.5, max: 20 },
  counterShots:  { label: 'Bullets on block', int: true, min: 0, max: 30 },
  regen:         { label: 'Health regen', suffix: '/s', min: 0, max: 100 },
  skyfall:       { label: 'Sky strike', flag: true, min: 0, max: 1 },
  blockBarricade:{ label: 'Sandbag wall health', min: 0, max: 2000 },
  blockEcho:     { label: 'Echo blocks', int: true, min: 0, max: 3 },
  revive:        { label: 'Revive health', percent: true, min: 0, max: 1 },
  growOnHit:     { label: 'Damage dealt → max health', percent: true, min: 0, max: 3 },
  blockDuration: { label: 'Block duration', min: 0.1, max: 3 },
  blockSize:     { label: 'Block size', min: 0.5, max: 4 },
  blockDeploy:   { label: 'Deployable shield wall', flag: true, min: 0, max: 1 },
  blockHeal:     { label: 'Healing field', min: 0, max: 300 },
  blockMines:    { label: 'Mines on block', int: true, min: 0, max: 8 },
  blockPush:     { label: 'Block shove', min: 0, max: 60 },
  blockDash:     { label: 'Block dash', min: 0, max: 40 },
  reflectBoost:  { label: 'Reflected bullet damage', percent: true, min: 0, max: 5 },
  blockShock:    { label: 'Shock burst damage', min: 0, max: 400 },
  blockLeech:    { label: 'Blocked damage → health', percent: true, min: 0, max: 3 },
  blockConcrete: { label: 'Concrete wall health', min: 0, max: 8000 },
  knockback:     { label: 'Thrust', min: 0, max: 20 },   // v1.2.13 (Devin): shown as Thrust (the stat key stays knockback)
  drill:         { label: 'Drill power', min: 0, max: 5 },
  healAllies:    { label: 'Damage dealt → heals allies', percent: true, min: 0, max: 3 },
  summonTwin:    { label: 'AI twins', int: true, min: 0, max: 3 },
  summonTurret:  { label: 'Turret units', int: true, min: 0, max: 3 },
  summonDrone:   { label: 'Drones', int: true, min: 0, max: 4 },
  poison:        { label: 'Poison', min: 0, max: 10 },
  ignite:        { label: 'Ignite', min: 0, max: 10 },
  chill:         { label: 'Chill', min: 0, max: 10 },
  hex:           { label: 'Hex', min: 0, max: 10 },
  chain:         { label: 'Chain lightning', min: 0, max: 10 },
  limpet:        { label: 'Sticky bombs', min: 0, max: 10 },
  shrapnel:      { label: 'Shrapnel', min: 0, max: 10 },
  noSelfDamage:  { label: 'No self damage', flag: true, min: 0, max: 1 },
  drain:         { label: 'Health drain / 2 s', percent: true, lowerIsBetter: true, min: 0, max: 1 },
  lifeDrain:     { label: 'Life drain from enemies', suffix: '/s', min: 0, max: 200 },
  drainRange:    { label: 'Drain range', suffix: ' m', min: 0, max: 60 },
  bounceTarget:  { label: 'Bounces re-aim at enemies', flag: true, min: 0, max: 1 },
  bounceExplode: { label: 'Explode on bounce', min: 0, max: 6 },
  bounceBoost:   { label: 'Damage per bounce', percent: true, min: 0, max: 3 },
  bounceSplit:   { label: 'Split on bounce', int: true, min: 0, max: 4 },
  ringHit:       { label: 'Hit ring radius', suffix: ' m', min: 0, max: 1 },
  tank:          { label: 'Tiny tank (no jumping)', flag: true, min: 0, max: 1 },
  napalm:        { label: 'Napalm splats', min: 0, max: 5 },
  slowField:     { label: 'Bullet time field', int: true, min: 0, max: 6 },
  encore:        { label: 'Encore shots', min: 0, max: 3 },
  toxic:         { label: 'Toxic clouds', min: 0, max: 5 },
  scavenge:      { label: 'Reload on health hit', flag: true, min: 0, max: 1 },
  squid:         { label: 'Squid bullets', flag: true, min: 0, max: 1 },
  bees:          { label: 'Bee bullets', flag: true, min: 0, max: 1 },
};

// How often each rarity shows up. Weight is per card: a common card is
// 1 / 0.12 = about 8x as likely to be offered as any single legendary card.
export const RARITY = {
  common:    { weight: 1.0,  color: '#9aa5bd', label: 'Common' },
  uncommon:  { weight: 0.55, color: '#5fe3a1', label: 'Uncommon' },
  rare:      { weight: 0.28, color: '#ffb347', label: 'Rare' },
  legendary: { weight: 0.12, color: '#ff5fd2', label: 'Legendary' },
  // Weapon mods and shield mods are offered as often as a legendary card (one of each kind at a time).
  mod:       { weight: 0.12, color: '#7fe0ff', label: 'Weapon mod' },
  shieldmod: { weight: 0.12, color: '#8fb4ff', label: 'Shield mod' },
  // Cursed: triple the upside, five times the downside, plus life drain. Generated automatically from
  // every regular card (see makeCursed in cards.js); can also be hand-written. Weight = original card x CURSED_ODDS.
  cursed:    { weight: 0.045, color: '#e0464b', label: 'Cursed' },
  // Holy: the upside with no downside. Generated from every regular card. Weight = original card x HOLY_ODDS.
  holy:      { weight: 0.045, color: '#ffe08a', label: 'Holy' },
  combo:     { weight: 0, color: '#7fe0ff', label: 'Combo' },        // never offered; formed from two cards
};

export const DIFFICULTY = {
  easy:   { label: 'Easy',   react: 0.45, noise: 0.16, block: 0.25, lead: 0.3, speed: 0.8 },
  normal: { label: 'Normal', react: 0.25, noise: 0.08, block: 0.55, lead: 0.7, speed: 0.92 },
  hard:   { label: 'Hard',   react: 0.12, noise: 0.035, block: 0.85, lead: 1.0, speed: 1.0 },
};

// Bigger health = bigger body (and hitbox), and slightly slower.
// 100 health = size 1. Size follows the square root of health so it doesn't get absurd.
export function sizeFor(maxHp) { return Math.max(0.75, Math.min(1.8, Math.sqrt(maxHp / 100))); }
// Small players are noticeably quicker (+20% at the smallest size), big ones noticeably slower (-32% at the largest).
export function speedFor(size) { return size < 1 ? Math.min(1.2, 1 + (1 - size) * 0.8) : Math.max(0.68, 1 - (size - 1) * 0.4); }
// Bullet drop: bigger bullets are heavier and fall harder (default bullet = RULES.bulletGravity).
export function bulletGravityFor(r) { return RULES.bulletGravity * Math.max(0.6, Math.min(4, Math.pow(Math.max(0.01, r) / DEFAULT_STATS.bulletSize, 1.1))); }

// Units other than player heroes.
export const UNITS = {
  hazardTurret: { label: 'Turret', health: 260, damage: 14 },
  drone: { label: 'Drone', health: 25, damage: 7, flyAbove: 0.7 },  // flies just above the tallest pillar
};

// Cosmetics: neutral-colored accessories that stay the same regardless of team color.
export const COSMETICS = {
  // Character bodies (bodies.js; bought in the shop, see economy.js). Purely visual, same hitbox for everyone.
  model: { classic: 'Classic', bolt: 'Bolt (robot)', mochi: 'Mochi (blob)', sentinel: 'Sentinel (knight)', vanguard: 'Vanguard (stout knight)', wisp: 'Wisp (phantom)',
    quack: 'Quack (rubber duck)', astro: 'Astro (astronaut)', cubert: 'Cubert (slime cube)', tiki: 'Tiki (totem)', shroom: 'Shroom (mushroom)', prism: 'Prism (crystal)',
    gumdrop: 'Gumdrop (jelly)', strider: 'Strider (mini mech)', fishbowl: 'Fishbowl (diver)' },
  hat: { none: 'None', tophat: 'Top hat', cowboy: 'Cowboy hat', bowler: 'Bowler', beanie: 'Beanie', crown: 'Crown', party: 'Party hat', halo: 'Halo', fez: 'Fez', headphones: 'Headphones',
    propeller: 'Propeller beanie', viking: 'Viking helmet', chef: 'Chef hat', wizard: 'Wizard hat', bunny: 'Bunny ears', pirate: 'Pirate hat',
    // v30: sci-fi and dark fantasy homages (original designs)
    trooper: 'Orbital trooper helmet', crusader: 'Grim crusader helm', psicords: 'Psionic nerve cords' },
  face: { none: 'None', mustache: 'Mustache', handlebar: 'Handlebar mustache', beard: 'Beard', clown: 'Clown nose', goatee: 'Goatee' },
  eyes: { none: 'None', monocle: 'Monocle', shades: 'Shades', goggles: 'Goggles', hearts: 'Heart glasses', eyepatch: 'Eye patch', glasses3d: '3D glasses', cateyes: 'Mutant cat eyes', nightops: 'Night-ops goggles' },
  neck: { none: 'None', bowtie: 'Bow tie', scarf: 'Scarf', medal: 'Medal', chain: 'Gold chain', cape: 'Cape', lei: 'Flower lei', wolfmed: 'Wolf medallion', seals: 'Wax prayer seals' },
  body: { none: 'None', censor: 'Censored (mosaic blur)', tutu: 'Tutu', floatie: 'Duck floatie', champ: 'Champion belt', harness: 'Twin-blade harness', carapace: 'Brood carapace' },
  // Gun skins (the first entry is the default). Built in buildGunSkin() in art.js, shown in first and third person.
  gun: { cube: 'Cube (original)', blaster: 'Blaster', gold: 'Solid gold', neon: 'Neon', camo: 'Camo', toy: 'Toy blaster', raygun: 'Retro ray gun',
    candy: 'Candy cane', banana: 'Banana', baguette: 'Baguette', duck: 'Rubber duck', fish: 'Fish', carrot: 'Carrot', eblade: 'Plasma prong blade', gauss: 'Heavy gauss rifle' },
};
export const COSMETIC_LABELS = { model: 'Character', hat: 'Hat', face: 'Face', eyes: 'Eyes', neck: 'Neck', body: 'Body', gun: 'Gun skin' };

// A cursed card is offered as often as its normal version times this (1 = exactly as often).
export const CURSED_ODDS = 0.045;
// A holy card is offered as often as its normal version times this. Holy and cursed cards exclude each other per player.
export const HOLY_ODDS = 0.045;

// Cursed cards and weapon mods are always in the card pool (they used to be lobby toggles).
export const DEFAULT_LOBBY_SETTINGS = {
  mode: 'ffa',           // 'ffa' | 'tdm' | 'waves' (co-op against waves of bots) | 'open' (open world) | 'amon' (autobattler, amon.js) | 'practice' (solo sandbox)
  roundsToWin: 5,
  rerolls: 1,            // rerolls per player per match, 0 = off
  friendlyFire: false,   // team modes: bullets can hurt teammates
  mapSource: 'mixed',    // 'generated' | 'classic' | 'mixed' | 'lava' | 'ice'
  mapLava: true,         // Mixed: Lava Lake maps can come up
  mapIce: true,          // Mixed: Ice Sheets maps can come up
  combos: true,          // matching card pairs merge into combo cards
  hazards: false,        // random rounds get a hazard event (laser, saws, turret)
  brawl: false, stocks: 3,   // Brawl mode (brawl.js; the lobby picks it as mode 'brawl'): lives per round
  side: false,           // 2D side view (side.js): flat orthographic camera, ROUNDS-style maps. Every mode except the open world
  commander: false,      // you pick the cards, an AI controls your character
  pickTime: 30,          // seconds to pick a card, 0 = no limit
  themes: 'standard',    // 'standard' | 'experimental' (castle, western, candy, forest, tundra, neon) | 'all' | one theme name ('forest')
  speed: false,          // Speed mode: two picks per pick phase (fresh hand after each pick)
  waveDifficulty: 'normal', // co-op difficulty: 'easy' | 'normal' | 'hard' | 'nightmare' (old 'relaxed'/'brutal' = easy/hard)
  coopScale: 'standard',  // co-op: how much each extra hero (player or bot) scales the waves: 'off' | 'standard' | 'strong'
  owType: 'br',           // open world: 'br' (battle royale, red wall) | 'extract' (co-op extraction)
  owSquads: false,        // open world battle royale: play in the lobby teams
  owBots: 'some',         // open world roaming bots: 'off' | 'some' | 'lots'
  amonTimer: false,       // AMON: store closes after 75 s (false = waits for everyone to press Ready)
  amonVs: false,          // AMON Versus (v28): players fight each other's armies every round (teams fight together)
  gmSpawn: 'auto',        // co-op: 'auto' (Game Master picks per wave; critters/turrets always trickle in) | 'waves' | 'all'
  // practice range
  dummyCount: 3,         // target dummies
  dummyMode: 'idle',     // 'idle' | 'move' | 'fight'
  dummyHp: 100,          // dummy max health
  practiceGod: true,     // you can't die in the practice range
};

// =====================================================================
// ART — colors, themes and model hooks. Change freely.
// =====================================================================
export const ART = {
  background: '#121826',
  // Free-for-all: one color per player slot, and the 20 colors players pick from in the lobby.
  // (The first 8 are the classic set; the rest differ in hue or lightness so no two look alike.)
  ffaColors: ['#ffcf3a', '#9b7bff', '#3fd0e0', '#ff7a59', '#7ee36b', '#ff5fb0', '#e8ecf5', '#4f8cff',
    '#e8231f', '#138a5e', '#ff9a00', '#c8f560', '#8b4a2b', '#2a3fbf', '#e3b6ff', '#8c8c96', '#00a3a3', '#b5174f', '#f2e6b8', '#6a2fb0'],
  // Team deathmatch: one base color per team; teammates get lighter/darker shades of it.
  teamColors: ['#ffcf3a', '#9b7bff', '#3fd0e0', '#ff7a59', '#8fe04a', '#4f86ff', '#e0344f', '#ff7ad1'],   // v1.0.1: 8 teams (was 4)
  teamNames: ['Gold', 'Violet', 'Teal', 'Coral', 'Lime', 'Azure', 'Crimson', 'Pink'],
  // Color of a platform's top edge tells you its height: 1, 2 or 3+ jumps up.
  tierColors: ['#7fe0ff', '#ffd166', '#ff7b9c'],
  propDensity: 1,       // decoration amount (0 = none). Players can also turn it off in Settings.
  sandbagColor: '#b7a07a',
  concreteColor: '#a3a39c',
  // Arena themes. bandA/bandB alternate every 1 meter (one jump) on block sides.
  themes: [
    // grass/rock = decoration colors (same shapes, palette swapped per theme)
    { name: 'Slate',  floor: '#26304a', bandA: '#7186b3', bandB: '#4d5c80', top: '#7f8db0', wall: '#38425c', grid: 0.06, grass: '#6f9a8a', rock: '#59647e' },
    { name: 'Dusk',   floor: '#2c2a3e', bandA: '#937fb3', bandB: '#64557f', top: '#8e7ea8', wall: '#3d3652', grid: 0.06, grass: '#9b7cc4', rock: '#5b5170' },
    { name: 'Lagoon', floor: '#1f3338', bandA: '#62a5a7', bandB: '#3e6f71', top: '#6c9fa1', wall: '#2b4549', grid: 0.06, grass: '#5fbf7a', rock: '#4c6a6c' },
    { name: 'Dune',   floor: '#33302a', bandA: '#ad946a', bandB: '#766446', top: '#a08c68', wall: '#46403a', grid: 0.06, grass: '#c9b061', rock: '#7a6a52' },
    { name: 'Ember',  floor: '#2f2424', bandA: '#b86d5e', bandB: '#7f4a41', top: '#a86e62', wall: '#463232', grid: 0.06, grass: '#d9733f', rock: '#5e3c36' },
    // Experimental themes: their own textures, props and skybox (lobby: Map themes).
    { name: 'Castle',  style: 'castle',  experimental: true, floor: '#6b6a66', bandA: '#9a958c', bandB: '#7d786f', top: '#8f8a80', wall: '#5e5a54', grid: 0, grass: '#5f8a4a', rock: '#77736b',
      sky: ['#5d7896', '#c9b99a'], fog: '#8a8f99', banner: ['#a8232e', '#e2b33c'] },
    { name: 'Western', style: 'western', experimental: true, floor: '#ad8a58', bandA: '#a0703e', bandB: '#83582e', top: '#b98a52', wall: '#7a5230', grid: 0, grass: '#7aa04a', rock: '#a27c52',
      sky: ['#e8804a', '#e8b880'], fog: '#c8925e' },
    // (v26: deeper, saturated candy colors; the old pastel version was washed out and hard to look at)
    { name: 'Candy',   style: 'candy',   experimental: true, floor: '#b85a8c', bandA: '#e0408e', bandB: '#2fae8f', top: '#d77aa9', wall: '#7a3fa8', grid: 0, grass: '#ff3f95', rock: '#4fa8d8',
      sky: ['#a8327a', '#3f8fb0'], fog: '#8a4a78' },
    // Forest: rocks for pillars, overturned logs for low walls, ferns, thick grass and mushrooms.
    { name: 'Forest',  style: 'forest',  experimental: true, floor: '#3e4a2c', bandA: '#7b7f68', bandB: '#5d6250', top: '#6f8f45', wall: '#4a3b2a', grid: 0, grass: '#5f9a3a', rock: '#7a7a6c',
      sky: ['#6f9fc0', '#dce9cf'], fog: '#a9bea0', bark: '#8a6a4a', moss: '#5e8a34' },
    // Tundra: snow, ice and frosted stone; snowy pines around the edge.
    { name: 'Tundra',  style: 'tundra',  experimental: true, floor: '#9aaec2', bandA: '#6f88a0', bandB: '#536a82', top: '#b9cadb', wall: '#4a5d72', grid: 0, grass: '#a9bdcc', rock: '#748698',
      sky: ['#5f7fa6', '#b4c6d8'], fog: '#9fb2c6' },
    // Neon: synthwave night with glowing grid lines and trim.
    { name: 'Neon',    style: 'neon',    experimental: true, floor: '#140c24', bandA: '#2c1f52', bandB: '#1f1640', top: '#2a2048', wall: '#1a1030', grid: 0, grass: '#ff3da8', rock: '#3fe0ff',
      sky: ['#14042e', '#ff4f9a'], fog: '#2a0f3f', glow: ['#ff3da8', '#3fe0ff'] },
    // Sakura: a Japanese temple garden; raked gravel, wood-and-paper walls, cherry trees, a torii gate, stone lanterns.
    { name: 'Sakura',   style: 'sakura',   experimental: true, floor: '#a99f8e', bandA: '#7a4a35', bandB: '#5c3626', top: '#c9b48a', wall: '#3d2a22', grid: 0, grass: '#ffb0cc', rock: '#8d8a83',
      sky: ['#6f98c8', '#d8a8bc'], fog: '#c4a2b2' },
    // Tropical: a beach; sand, bamboo walls, palm trees, umbrellas, tiki torches and the sea beyond the walls.
    { name: 'Tropical', style: 'tropical', experimental: true, floor: '#cdb27a', bandA: '#b89a5a', bandB: '#9a7d42', top: '#bba370', wall: '#7a5a34', grid: 0, grass: '#6fbf4a', rock: '#e8e0d0',
      sky: ['#1f88c8', '#8fd0e6'], fog: '#86c2d4' },
    // Lunar: a moon base; grey regolith with craters, metal walls with hazard stripes, stars and the Earth overhead.
    { name: 'Lunar',    style: 'lunar',    experimental: true, floor: '#8b8b92', bandA: '#c9ccd4', bandB: '#a5a9b3', top: '#b9bcc4', wall: '#5d6069', grid: 0, grass: '#a0a0a8', rock: '#77777f',
      sky: ['#02030a', '#141826'], fog: '#151a2a' },
    // Volcano: black basalt with glowing cracks, obsidian spires and lava pools outside the walls (the floor is safe).
    { name: 'Volcano',  style: 'volcano',  experimental: true, floor: '#2a2224', bandA: '#4a3a3a', bandB: '#33282a', top: '#3e3434', wall: '#1e1719', grid: 0, grass: '#ff6a2a', rock: '#1c1418',
      sky: ['#2a0a08', '#ff5a1a'], fog: '#4a1a10' },
  ],
  // Optional custom player model (glTF/GLB) placed in the art/ folder, e.g. '/art/player.glb'.
  // Any material whose name contains "tint" gets recolored to the player's color.
  playerModel: null,
  playerModelScale: 1,
  playerModelYOffset: 0,
};

// ---------- color helpers ----------
export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
export function hslToHex(h, s, l) {
  const f = n => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

// Teammates: same hue, different lightness, so each player can still find themselves.
const SHADE_STEPS = [0, 0.14, -0.13, 0.24, -0.22, 0.07, -0.06, 0.3, -0.18, 0.19, 0.035, -0.095];
// Free-for-all: players can pick a color in the lobby (p.prefColor, one of ART.ffaColors).
// The first player to claim a color keeps it; everyone else gets the free palette slots in order.
export function assignColors(players, mode) {
  if (mode !== 'tdm') {
    const pal = ART.ffaColors, taken = new Set(), out = new Array(players.length);
    // Humans' preferred colors win first; a bot holding that color moves to a free one. Then bots the host colored.
    for (const bots of [false, true]) players.forEach((p, i) => { const c = p && p.prefColor; if (!p || !!p.isBot !== bots) return; if (c && pal.includes(c) && !taken.has(c)) { out[i] = c; taken.add(c); } });
    let k = 0;
    players.forEach((p, i) => {
      if (out[i]) return;
      const own = pal[i % pal.length];
      if (!taken.has(own)) { out[i] = own; taken.add(own); return; }
      while (k < pal.length && taken.has(pal[k])) k++;
      out[i] = k < pal.length ? pal[k] : pal[i % pal.length]; taken.add(out[i]);
    });
    return out;
  }
  const count = {};
  return players.map(p => {
    const t = p.team || 0;
    const k = count[t] = (count[t] ?? -1) + 1;
    const [h, s, l] = hexToHsl(ART.teamColors[t % ART.teamColors.length]);
    // Shades that would run past the light/dark limits bounce back instead of piling up on the limit,
    // and a tiny hue nudge per member keeps big teams (up to 20 players) all distinct.
    let lt = l + SHADE_STEPS[k % SHADE_STEPS.length];
    if (lt > 0.88) lt = 0.88 - (lt - 0.88) * 1.6; if (lt < 0.22) lt = 0.22 + (0.22 - lt) * 1.6;
    const hk = (h + (k ? (k % 2 ? 1 : -1) * 0.011 * Math.ceil(k / 2) : 0) + 1) % 1;
    return hslToHex(hk, Math.min(1, s * (k % 2 ? 0.85 : 1)), Math.max(0.22, Math.min(0.88, lt)));
  });
}
