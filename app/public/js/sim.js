// Authoritative simulation. Runs on the host (or in solo play). No rendering here.
import { RULES, DEFAULT_STATS, DEFAULT_LOBBY_SETTINGS, sizeFor, speedFor, UNITS, bulletGravityFor, ROUND_MODS } from './config.js';
import { applyCard, finishStats, weightedOffer, VARIANT_CHANCE, variantBase } from './cards.js';
import { generateLevel, spawnPoints, clearSpawns, mulberry32, edgeDistance, boundaryPoint } from './levelgen.js';
import { tournOn, tournStart, tournCheck, tournAfter, tournRows, tournIntroInfo, tournExtend, TOURN } from './tourn.js';
import { BUDGET, budgetTick, budgetAllow, budgetAdd, budgetRoom, budgetRow } from './budget.js';
import { prepareLevel, movePlayer, moveBody, accel, pointInSolid, rayExit, groundBelow, segBlocked, clampToArena, wallSegments, buildGrid, PA } from './physics.js';
import { planWave, splitWave, unitSpec, spawnBoss, spawnAllyBoss, bossThink, portalThink, coopTick, bossDown, telegraphRows, shockRows, bossRow, gmBudget, coopDiff, UNIT_COSTS, UNIT_NAMES, isBossWave, addBlotch, CORE_TWISTS } from './coop.js';
import { botThink } from './ai.js';
import { generateOpenWorld, owStart, owTick, owAir, owView, owBotThink, owRoundEnd, owDrive, owCarHit, OW } from './openworld.js';
import { runHook } from './effects.js';
import { TRAP, trapState, crusherAt, segDist, pinchAt, pinchPos } from './traps.js';
import { SIDE, generateSideLevel, sideSpawnPoints, sideRules, swingStep, swingImpulse, inPit } from './side.js';
import { CORE, generateCoreLevel, coreSpawnPoints, coreSpawnGuard, coreStart, coreCapture, coreTick, coreUse, corePlace, coreRows, coreAmonPick, coreAmonStats, coreAwardLeftovers, coreUseInput, coreCarrySlow } from './core.js';
import { BRAWL, generateBrawlLevel, brawlSpawnPoints, brawlRules, brawlLaunch, brawlTick, applyFighter, brawlMove, brawlHit, bItemK, bItemRows } from './brawl.js';

const PR = RULES.playerRadius, PH = RULES.playerHeight, CHEST = RULES.chest;
const fin = v => typeof v === 'number' && isFinite(v);
const len = v => Math.hypot(v.x, v.y, v.z);
const norm = v => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
// 2D side view: spreads fan out in the play plane (around z) instead of around the vertical axis. Only while a
// side-view round is running (set in startRound), so cards behave exactly as before in every other mode.
let SIDE_ON = false;
let BRAWL_ON = false;   // Brawl mode round running (brawl.js): damage % and launches instead of health
const rotY = (v, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  if (SIDE_ON) { const k = v.x < 0 ? -1 : 1; return { x: v.x * c - v.y * s * k, y: v.x * s * k + v.y * c, z: 0 }; }
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function turnToward(v, d, maxAng) {
  const dot = clamp(v.x * d.x + v.y * d.y + v.z * d.z, -1, 1), ang = Math.acos(dot);
  if (ang < 1e-4) return d;
  const s = Math.sin(ang);
  if (s < 1e-3) return v;
  const t = Math.min(1, maxAng / ang), a = Math.sin((1 - t) * ang) / s, b = Math.sin(t * ang) / s;
  return { x: v.x * a + d.x * b, y: v.y * a + d.y * b, z: v.z * a + d.z * b };
}
const emptyInput = () => ({ mx: 0, mz: 0, jump: false, shoot: false, blockSeq: 0, reloadSeq: 0, aim: null, aimPoint: null });
// Riot Shield weapon mod: the shield's shape (matches the model in art.js), hits before it breaks, recharge times,
// and wave charging (one extra bullet every `step` seconds held, up to `maxExtra`).
// Grenade launcher: heavy gravity; the throw speed is solved so the arc lands on your aim point (capped at maxSpeed).
export const GRENADE = { grav: 34, maxSpeed: 42, fuse: 1.4 };
export const RIOT = { radius: 0.95, halfArc: 0.8, y0: 0.15, y1: 1.6, hits: 6, recharge: 2.6, regen: 2.0, step: 0.35, maxExtra: 5 };
export const CRITTER_REACH = 1.0;
export const SCATTER = { pellets: 10, dmg: 0.32, spread: 0.48, vSpread: 0.08, life: 0.5 };   // Scattergun weapon mod
// Critter weapon mod: no real cap on how many you keep alive (only a safety limit), speed as a fraction of bullet speed
export const CRITTER_MAX = 400, CRITTER_SPEED = 0.6, RITUAL_CRITTER_MAX = 400;
// Ground Slam shield mod: shockwave damage = base + share of your bullet damage; while in the air after the
// block's leap you move faster and steer harder, so you can actually land on someone.
export const SLAM = { base: 28, dmgShare: 0.9, airSpeed: 1.6, airControl: 2.4 };
// Clone shield mod: each split halves the splitting body's current health, damage and block stats (all but the cooldown)
// and the new clone gets that same half: first split 50/50, a second split by either body leaves 25/25 of the original.
export const CLONE_SPLIT = 0.5;
// When a clone dies, the nearest of your remaining bodies (you or another clone) wins back this share of what the clone took.
export const CLONE_INHERIT = 0.8;
const SPLIT_STATS = ['health', 'blockDuration', 'blockSize', 'counterShots', 'blockBarricade', 'blockEcho', 'blockDeploy', 'blockHeal',
  'blockMines', 'blockPush', 'blockDash', 'reflectBoost', 'blockShock', 'blockLeech', 'blockConcrete'];
function applySplit(s, k) { for (const key of SPLIT_STATS) if (typeof s[key] === 'number') s[key] *= k; }
// Napalm Rounds: impact fire splats. dps is a share of the bullet's damage (per Napalm level), applied as a burn.
export const NAPALM = { life: 5, max: 40, perBullet: 8, dps: 0.22, burnFor: 2, polyWallTop: 1.0 };
// Bullet Time: a field around the holder that slows bullets which can hurt them to 25% speed. More copies = bigger field.
export const SLOWFIELD = { slow: 0.75, radius: 4, perCopy: 2.5, height: 3 };
const UNIT_WINS = new Set(['turret', 'blockTurret', 'mount', 'critter', 'clone', 'twin', 'drone']);   // (v1.2.26: clones and summons too)   // v1.2.13: units that win a round for their owner (with a Space King)
export const BANK_RANGE = 22;   // Bank Shot: how far a bounced bullet looks for a visible target   // extra bite reach for critters beyond touching distance
const PILLAR_LIP = 0.6;   // how far the top-only shield reaches down the pillar's sides
export const PILLAR_SHIELD = 300;   // v1.2.22: was 170, and it now scales harder with Block size and Block duration   // Pillar Shield health before Block size / Block duration scaling
// Turret shield mod: the turret's own block bubble. hp = base x (Block duration / 0.35)^0.75 x sqrt(Block size).
// Broken: comes back full after `recharge` s. Intact: refills `regen` of its max per second once it's gone `delay` s without a hit.
export const TURRET_SHIELD = { base: 50, recharge: 3, delay: 2.5, regen: 0.1 };
// Katana weapon mod: click = melee slash (cuts enemy bullets out of the air), hold = charge a flying slash wave.
//   reach: slash reach past your body (m, x your size); arc: half-angle of the slash (rad); slashMul: slash damage x your bullet damage;
//   active: how long a slash keeps cutting bullets (s); chargeTime: full charge at the base fire rate (fire rate scales it);
//   minCharge: release below this and no wave flies; wave*: the wave's speed (x bullet speed), life (s), width and damage
export const KATANA = { grace: 0.32, reach: 2.1, arc: 1.1, slashMul: 1.4, active: 0.16, chargeTime: 1.1, minCharge: 0.25,
  waveSpeed: 0.85, waveLife: [0.8, 1.3], waveW: [0.5, 1.15], waveDmg: [1.0, 2.6], cutPad: 0.3, minScale: 0.7, maxScale: 2.6 };
// Super Saiyan Hair shield mod: a separate health pool soaked before your own health, filled by holding block.
//   mult: full pool = mult x your max health; fillTime: seconds from empty to full at base block stats
export const HAIR = { mult: 3, fillTime: 8, fullSpeed: 2, fullDamage: 2 };   // v1.2.13 (Devin): hair pool = 3x max health (v1.0.1 had 2x); a FULL pool doubles move speed and damage
// Cursed Sacrifice shield mod: hold block to draw a pentagram under you, then keep charging inside it for 3 levels.
// L1 a swarm of critters, L2 a big brute, L3 a meteor storm. drawTime / levelTime at base block stats, radius x Block size.
// Charging costs health: `cost` of your max health over the whole charge (draw + 3 levels), never refunded.
// Let go and the charge drains back at `decay` x the charge speed (draw or the next level); hold again to resume.
export const RITUAL = { radius: 2.3, drawTime: 1.6, levelTime: 2.2, counts: [7], spawnGap: 0.16, expire: 30, cdMul: 1.4, critterLife: 10,
  cost: 0.6, decay: 1.5, humEvery: 1.4,
  brute: { hp: 1.6, minHp: 220, melee: 26, dmgShare: 0.8, life: 25, size: 1.9 },
  meteors: { n: 12, over: 4, dmg: 85, rmul: 1.5, fireR: 3, fireLife: 8, fireDps: 14, nearEnemy: 0.5 } };
// Sacred Grove shield mod: the holy mirror. A circle of grass grows (same charge times as Cursed Sacrifice), flowers bloom, then 3 levels:
// L1 a 10 s holy shield (soaks `shield` x your max health), L2 a priest's robe and a cross that heals you near it,
// L3 an angel that circles you, healing, with its own shield bubble (like the Turret's).
export const GROVE = { radius: 2.3, drawTime: RITUAL.drawTime, levelTime: RITUAL.levelTime, shieldT: 10, shield: 0.5, crossHeal: 0.12, crossR: 4.5, crossLife: 30,
  angelHeal: 0.03, angelHp: 0.6, angelShield: 70, chargeHeal: 0.004 };   // chargeHeal: a tiny heal (share of max health per second) while you charge
// Space King shield mod: one long charge (as long as growing a grove circle plus all 3 of its levels), nothing happens meanwhile
// except a soft opera choir, then a co-op boss steps out on your side for the rest of the round. Once per round.
export const KING = { time: 9, decay: 1.5, humEvery: 8.2, cdMul: 1.4 };   // v1.2.22: charges in 9 s (was 17)
// v1.2.22 (Devin) Big Brother replaces the Space King boss: a giant copy of you (x hp, x damage, x move speed, body size)
export const BIGBRO = { hp: 3.5, dmg: 1.5, speed: 0.45, size: 2.4 };
// Life drain stat: siphons from the nearest visible enemy within base + Drain range metres.
export const DRAIN_RANGE = 5;
// Rewind Blink: how far back (s) the blink goes. Bullet Catcher: how far (m) released bullets look for a target, and their damage bonus.
export const REWIND_T = 6;   // v26: rewinds further back (was 3.5 s)
// Poison (v26): one poison per target that eats about POISON.share of max health over POISON.dur seconds, the rate ramping up
// the longer it stays on. New hits refresh the timer without resetting the ramp, so keeping someone poisoned hurts far more.
export const POISON = { dur: 5, share: 0.22, rampCap: 12, boss: 0.25, perLevel: 0.2, hpCap: 1500 };   // hpCap: the share is of at most this much health
// Shock Bubble (v26): blocking sends one shock burst through the floor around you instead of a constant aura.
// Squid / Bees (v26): swimming and swarming bullets. cap = top speed (people can outrun them), turn = rad/s, see = target range.
export const SWARM = { bee: { cap: 8.5, turn: 7, see: 30, life: 6, look: 2.4, spread: 0.7, wob: 0.75 },   // v28 bees: slower, look further ahead, fly spread out
   squid: { cap: 13, turn: 3.4, see: 26, life: 6.5, pulse: 1.05 } };
// v1.2.22 (Devin) squid rework: a squid that reaches someone latches on and gnaws (bite = share of its damage every `every` s,
// for up to `latch` s), healing its shooter. Blocking or a shield knocks it off; mashing jump (`mash` presses in `win` s)
// shakes every squid off and stuns them for `stun` s before they look for a new target.
export const SQUID = { bite: 0.24, every: 0.45, latch: 3.6, steal: 0.25, mash: 4, win: 1.2, stun: 2.2, blockStun: 1.2 };
// Toxic Cloud (v26): impacts leave a poison cloud that drifts on in the bullet's direction and spreads out.
export const TOXIC = { life: 4, max: 30, perBullet: 4, dps: 0.3, drift: 1.3, grow: 1.9 };
// 2D side view: bullets drop this much harder, so arcing shots takes skill (v26).
export const SIDE_BULLET_GRAV = 2.2;
// Ice Sheets (v26): wet slow lingers, floes are slippery, jumps a bit higher so floes are easy to reach.
export const ICE = { wetLinger: 1.1, wetSlow: 0.7, slip: 0.2, jumpK: 1.18 };
export const SHOCK = { radius: 3.6, height: 2.6, dmgK: 0.9, stun: 0.35 };
export const CATCHER = { range: 18, dmgMul: 1.1 };
// Cards dealt per pick.
export const OFFER_SIZE = 5;
// Co-op waves: extra seconds of prep on top of the countdown, and how far (m) anyone may stray from their spawn until it ends.
export const WAVE_PREP = { extra: 4, leash: 3.5 };
// Thruster (the Knockback stat): hits push for a while instead of one shove. dur = base x sqrt(damage / ref), clamped;
// the push speed from all hits combined is capped so a hail of small bullets moves you without pinning you.
export const THRUST = { base: 2, ref: 20, minDur: 1, maxDur: 5, perHit: 0.7, cap: 6, impulse: 0.35 };
// Encore: follow-up shots fired shortly after a shot (v1.2.8: free, they use no ammo). Stat = expected follow-ups per shot.
export const ENCORE = { gap: 0.11 };
// v1.2.8 Gun Nest shield mod: a mountable turret. reach = how far (m, edge to edge) you can be to man it with the use key,
// decay = share of its health lost per second, fireK = its fire rate vs the caster's, size = body size.
export const MOUNT = { reach: 1.1, decay: 0.012, fireK: 2, size: 0.9 };
// v1.2.15 round-2 cards (Devin): the numbers behind them. Card strength comes from each card's stat (so holy / cursed
// versions scale it); these are the fixed parts.
//   salvoSpeed: Opening Salvo move bonus; cold: Cold Barrel wait (s) and speed share; press: Pressure Stack window (s), max stacks,
//   grace (s) a miss is forgiven after a hit; stand: Last Stand Rig health share, block (s), speed, rush time (s) per level;
//   decoy: Afterimage decoy health, most at once; overpen: Overpen search range (m); spite: Spite Charge fuse (s);
//   pound: Ground Pound landing speed, radius, pop, damage per level; rhythm: hits for level 1, overcharged size / damage;
//   gamble: Gambler's Mag rolls; payback: Payback memory (s); bountyHeal: Bounty Mark heal share per bounty;
//   volley: Blood Volley hold (s), health cost, fan width (rad), cooldown (s); snare: Snare Plate arm time, most at once;
//   asc: Ascension Core rounds for tier 1 / 2 and the bonus per level; chain: Chain Encore longest chain; well: Gravity Well
//   radius, pull (m/s2 per level), time, most per shooter; scorch: Scorched Floor radius and burn (dps share of bullet damage);
//   purge: Purge Pulse charge (s); swap: Swap Shot orb speed / size / life; squad: Squad Caller soldier stats.
export const NEWC = {
  salvoSpeed: 0.3, cold: { wait: 1.5, speedK: 0.83 }, press: { win: 1, max: 8, grace: 0.3 },
  stand: { at: 0.4, block: 1.5, speed: 0.3, time: 2 }, decoy: { hp: 40, max: 2 }, overpen: 12, spite: 0.5,
  pound: { vy: -10.5, r: 3, pop: 8, dmg: 8 }, rhythm: { hits: 5, size: 2.5, dmg: 3 },
  gamble: ['dmg', 'proj', 'bounce', 'homing'], payback: 2, bountyHeal: 0.25,
  volley: { hold: 0.35, cost: 0.25, fan: 1.0, cd: 1 }, snare: { arm: 0.5, max: 2 },
  asc: { t1: 5, t2: 10, k: 0.3 }, chain: 20, well: { r: 4, pull: 16, t: 0.5, max: 10 },
  scorch: { r: 3.5, dps: 16 }, purge: { time: 3 }, swap: { speed: 9, perLv: 4, r: 0.35, life: 3 },
  squad: { hp: 40, dmg: 0.35, rate: 2, speed: 6.5, size: 0.62 },
};
const WAVE_COLORS = ['#ff5f5f', '#ff7f50', '#e04a6a', '#ff9a6b'];

export class Game {
  constructor({ roster, settings, cards, onOffer, onCombo, onBreak }) {
    this.settings = { ...DEFAULT_LOBBY_SETTINGS, ...settings };
    // Cursed cards and weapon mods are always part of the card pool (no lobby toggles any more).
    this.settings.cursedCards = true; this.settings.weaponMods = true;
    if (this.settings.mode === 'practice') { this.settings.hazards = false; this.settings.commander = false; }
    if (this.settings.mode === 'open') { this.settings.hazards = false; this.settings.commander = false; }
    // Brawl (brawl.js): picked as its own lobby mode, played as a free-for-all on the side view with fixed fighter builds.
    if (this.settings.mode === 'brawl') { this.settings.mode = 'ffa'; this.settings.brawl = true; }
    this.settings.brawl = !!this.settings.brawl && this.settings.mode === 'ffa';
    if (this.settings.brawl) { this.settings.side = true; this.settings.commander = false; }
    // Core Defense (core.js): its own lobby mode, played as co-op waves around a core block on a flat battlefield.
    if (this.settings.mode === 'core') { this.settings.mode = 'waves'; this.settings.core = true; }
    this.settings.core = !!this.settings.core && this.settings.mode === 'waves';
    if (this.settings.core) { this.settings.side = false; this.settings.hazards = false; this.settings.commander = false; }
    this.settings.side = !!this.settings.side && this.settings.mode !== 'open';   // 2D side view: every mode except the open world
    if (this.settings.side) this.settings.hazards = false;   // the laser / saws / turret are built for the top-down arenas
    if (['practice', 'open'].includes(this.settings.mode) || this.settings.brawl || this.settings.core) this.settings.roundMods = 'off';
    this.tourn = this.settings.mode === 'tourn';   // v1.2.26 Tournament (tourn.js): its own 1v1 arenas, in 3D, without the roaming hazards
    if (this.tourn) { this.settings.side = false; this.settings.hazards = false; }
    this.rmod = null;
    this.allCards = cards;
    this.cardById = new Map(cards.map(c => [c.id, c]));
    this.combos = cards.filter(c => c.combo && !variantBase(c));   // base combos; their holy / cursed versions come from the pieces
    this.onOffer = onOffer || (() => {});
    this.onCombo = onCombo || (() => {});
    this.onBreak = onBreak || (() => {});
    this.players = roster.map(r => this.makePlayer({ ...r, kind: 'hero' }));
    for (const p of this.players) if (p.dummy) this.recompute(p);
    this.scores = {};
    if (this.isWaves() || this.isExtract()) this.scores.players = 0;
    else if (this.isPractice()) { /* practice range keeps no score */ }
    else for (const p of this.players) this.scores[this.scoreKey(p)] = 0;
    this.events = []; this.bullets = []; this.barricades = []; this.shields = []; this.mines = []; this.fields = []; this.booms = []; this.fires = []; this.clouds = []; this.rituals = []; this.relics = []; this.wells = [];
    this.dyn = []; this.nextId = 1; this.nextUnit = 1;
    this.stepN = 0; this.unitsEv = null; this.unitsAt = -1; this.unitsGone = false;   // (unitsChanged)
    if (this.isBrawl()) for (const p of this.players) applyFighter(this, p);
    this.round = 0; this.phase = 'idle'; this.phaseT = 0; this.levelVersion = 0; this.time = 0;
    this.winner = null; this.roundWinner = null; this.level = null; this.hazard = null;
    this.telegraphs = []; this.shockwaves = []; this.boss = null; this.gm = null;   // co-op (coop.js)
    this.blotches = []; this.bossKills = 0; this.bossOrder = null;
    this.lossTokens = this.isWaves() && !this.settings.core ? 1 : 0;   // (Core Defense offers a retry instead)   // co-op: one lost wave per run is forgiven (never the boss wave)
  }

  // ------------------------------------------------------------ helpers
  isWaves() { return this.settings.mode === 'waves'; }
  isPractice() { return this.settings.mode === 'practice'; }
  isOpen() { return this.settings.mode === 'open'; }
  isSide() { return !!this.settings.side; }
  isBrawl() { return !!this.settings.brawl; }
  isExtract() { return this.isOpen() && this.settings.owType === 'extract'; }
  // Is (x,z) at least m meters inside the arena (polygon or rectangle)?
  inArena(x, z, m = 0) {
    const L = this.level;
    if (Math.abs(x) > L.hx - m || Math.abs(z) > L.hz - m) return false;
    return !L.edges || edgeDistance(L.edges, x, z) >= m;
  }
  // Pull (x,z) inside the arena with a margin of m meters.
  clampArena(x, z, m = 0.5) {
    const L = this.level, p = { x: clamp(x, -L.hx + m, L.hx - m), z: clamp(z, -L.hz + m, L.hz - m) };
    if (L.edges) clampToArena(L, p, m);
    return p;
  }
  makePlayer(r) {
    return {
      id: r.id, name: r.name, team: r.team || 0, color: r.color, isBot: !!r.isBot, difficulty: r.difficulty || 'normal',
      kind: r.kind || 'hero', ownerId: r.ownerId || null, transient: !!r.transient, cosmetics: r.cosmetics || null, dummy: !!r.dummy,
      commanded: r.kind === 'hero' && !r.isBot && !!this.settings.commander,
      stats: { ...DEFAULT_STATS }, cards: [], pact: false,
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, onGround: false, ground: null,
      hp: DEFAULT_STATS.health, ammo: DEFAULT_STATS.ammo, reloadT: 0, fireT: 0, blockT: 0, blockCdT: 0, blockExtra: 0,
      aim: { x: 1, y: 0, z: 0 }, aimPoint: { x: 0, y: 1, z: 0 }, alive: false, reviving: false, reviveT: 0, flashT: 0,
      input: emptyInput(), lastBlockSeq: 0, lastReloadSeq: 0, ai: {}, fx: {}, spawn: { x: 0, y: 0, z: 0 },
      rerollsLeft: this.settings.rerolls, offer: null, picked: true, pickDelay: 0, connected: true,
      picksLeft: 0, picksTotal: 0, picksOwed: 0, pickT: Infinity, catchUp: false,
      size: 1, bonusHp: 0, flying: r.kind === 'drone', tally: { damage: 0, kills: 0, deaths: 0 },
      // v1.2.6: fields set later on some players, declared here (undefined = as if not set yet) so players and units share one
      // shape and the hot loops over them stay fast (lifeT and dropThru are left out: counted down every tick, they stay plain numbers)
      lootQ: undefined, encoreQ: undefined, lastShotSeq: undefined, lastUseSeq: undefined, coreUseT: undefined, crouch: undefined,
      groundOneWay: undefined, fixedSize: undefined, melee: undefined, ephemeral: undefined, mod: undefined, smod: undefined, hairMax: undefined,
      blockReflects: undefined, lateJoin: undefined, respawnT: undefined, ow: undefined, veh: undefined, awaitCombo: undefined, awaitBreak: undefined,
      gen: undefined, roamer: undefined, home: undefined, noBlock: undefined, coreProp: undefined, heavy: undefined, coreDeaths: undefined,
      coreRespT: undefined, carry: undefined, coreReady: undefined, coreUnit: undefined, healN: undefined, fighter: undefined, stocks: undefined,
      pct: undefined, bHp: undefined, announced: undefined, casterId: undefined, riderId: undefined, anchor: undefined, hpCap: undefined,
      arena: undefined, tLives: undefined, tko: undefined, giftIn: undefined, fps: undefined,
    };
  }
  maxHp(p) { return p.stats.health + (p.bonusHp || 0); }
  chest(p) { return p.pos.y + CHEST * p.size; }
  player(id) { return this.players.find(p => p.id === id); }
  // v1.2.17: the view a player is using ('first' | 'shoulder' | 'third'), from their inputs; a turret or pet counts as its owner's
  viewOf(id) {
    let p = this.player(id); if (p && p.ownerId != null) p = this.player(p.ownerId) || p;
    const i = p && p.kind === 'hero' && !p.isBot && p.input;
    return i && i.fp ? (i.ots ? 'shoulder' : 'first') : 'third';
  }
  emit(e) { this.events.push(e); }
  takeEvents() { if (this.unitsEv) this.closeUnits(); const e = this.events; this.events = []; return e; }
  // v1.2.6: the unit roster ('units': the whole list of transient units) goes out at most once a step; a critter swarm sent
  // it for every shot and every death. The first change in a step puts the event in place (unitsChanged) and its list is
  // filled in when the step ends, or just before units are taken out (unitsRemoved), so every later event still finds the
  // units it names (handleEvent applies events in order). A removal goes out with the next list (by the next step's end).
  unitsChanged() { if (!this.unitsEv) { this.unitsEv = { t: 'units', units: null }; this.unitsAt = this.stepN; this.emit(this.unitsEv); } }
  closeUnits() { const e = this.unitsEv; if (e) { this.unitsEv = null; e.units = this.unitList(); this.unitsGone = false; } }
  unitsRemoved() { this.closeUnits(); this.unitsGone = true; }   // (right before transient units leave this.players)
  heroes() { return this.players.filter(p => p.kind === 'hero'); }
  scoreKey(p) {
    if (!p) return null;
    if (p._skN === this.stepN && p._skG === this && p._skT === p.team && p._skO === p.ownerId && this._inStep) return p._sk;   // v1.2.25: once per player per step (asked per bullet per target)
    const k = this.scoreKey0(p); p._skN = this.stepN; p._skG = this; p._sk = k; p._skT = p.team; p._skO = p.ownerId;
    return k;
  }
  scoreKey0(p) {
    if (p.kind === 'hazardTurret') return 'hazard';
    if (p.ownerId) return this.scoreKey(this.player(p.ownerId)) || 'gone';
    if (this.isWaves()) return p.team === 1 ? 'waves' : 'players';
    if (this.isOpen()) return p.roamer ? 'roamers' : this.isExtract() ? 'players' : this.settings.owSquads ? 't' + p.team : p.id;
    if (this.isPractice()) return 't' + p.team;
    if (this.tourn) return this.settings.tTeams ? 't' + p.team : p.id;
    return this.settings.mode === 'tdm' ? 't' + p.team : p.id;
  }
  isEnemy(a, b) {
    if (!a || !b || a === b) return false;
    if (this.tourn && a.arena !== b.arena) return false;   // v1.2.26: another arena's players don't exist for you
    return this.scoreKey(a) !== this.scoreKey(b);
  }
  canHurt(src, t) {
    if (!src) return true;
    if (this.tourn && src.arena !== t.arena) return false;
    if (src === t) return !(t.stats.noSelfDamage > 0);   // you can always hurt yourself, unless SCP
    if (!this.isEnemy(src, t)) return this.settings.friendlyFire; // friendly fire only covers allies
    return true;
  }
  // v1.2.13 (Devin): SCP also covers your own shots after someone blocked them back at you (bullets, bees, their blasts, fire, clouds).
  ownShot(x, q) { return !!(x && x.cown && x.cown === q.id && q.stats.noSelfDamage > 0); }
  creditOf(p) { return p && p.ownerId ? this.player(p.ownerId) : p; }

  setInput(id, i) {
    const p = this.player(id);
    if (!p || p.isBot || !i) return;
    if (p.commanded) return;   // Commander mode: the bot drives this character; the mouse/keys never aim or move it
    const inp = p.input;
    const mx = fin(i.mx) ? i.mx : 0, mz = fin(i.mz) ? i.mz : 0, ml = Math.hypot(mx, mz);
    inp.mx = ml > 1 ? mx / ml : mx; inp.mz = ml > 1 ? mz / ml : mz;
    inp.fp = !!i.fp;   // first-person view: shots leave from the eye, straight down the crosshair
    inp.ots = !!i.ots;   // v1.2.17: over the shoulder (the kill cam replays a win from the winner's own view)
    inp.jump = !!i.jump; inp.shoot = !!i.shoot; inp.block = !!i.block; inp.crouch = !!i.crouch; inp.use = !!i.use; inp.reload = !!i.reload; inp.drop = !!i.drop; inp.dash = !!i.dash; inp.ready = i.ready | 0;
    inp.blockSeq = i.blockSeq | 0; inp.reloadSeq = i.reloadSeq | 0; inp.useSeq = i.useSeq | 0; inp.rot = (i.rot | 0) & 7;   // rot: Core Defense carry turn (scroll wheel)
    inp.jumpSeq = (i.jumpSeq ?? i.js) | 0; inp.shotSeq = (i.shotSeq ?? i.ss) | 0;   // v1.2.6: press counters, so a quick tap is never lost between two steps
    if (!p.alive || p.reviving) { p.fx.jSeq = inp.jumpSeq; p.lastShotSeq = inp.shotSeq; }   // (presses made while down don't fire once you're back)
    if (fin(i.fps)) p.fps = i.fps > 0 ? clamp(i.fps, 1, 1000) : 0;   // (0 = window in the background: not counted)   // v1.2.25: frame rate, for the shot budget
    if (i.q != null) { const q = i.q | 0; if (q !== inp.q) p.inAt = this.time; inp.q = q; }   // v30: input sequence, echoed back for prediction (v1.2.9: inAt, see predRows)
    if (i.aim && fin(i.aim.x) && fin(i.aim.y) && fin(i.aim.z)) inp.aim = norm(SIDE_ON ? { x: i.aim.x, y: i.aim.y, z: 0 } : i.aim);
    if (SIDE_ON) inp.mz = 0;
    if (i.aimPoint && fin(i.aimPoint.x) && fin(i.aimPoint.y) && fin(i.aimPoint.z)) inp.aimPoint = { x: i.aimPoint.x, y: i.aimPoint.y, z: i.aimPoint.z };
  }

  removePlayer(id) {
    const p = this.player(id);
    if (!p) return;
    p.connected = false; p.alive = false; p.reviving = false; p.picked = true; p.offer = null;
    for (const u of this.players) if (u.ownerId === id) u.alive = false;
    this.emit({ t: 'left', p: id });
    if (this.phase === 'picking') this.maybeFinishPicking();
  }

  // ------------------------------------------------------------ cards
  // One weapon mod and one shield mod at a time: keeps only the most recently taken of each.
  oneModEach(p) {
    let w = -1, sm = -1;
    p.cards.forEach((id, i) => { const c = this.cardById.get(id); if (!c) return; if (c.weaponMod) w = i; if (c.shieldMod) sm = i; });
    p.cards = p.cards.filter((id, i) => { const c = this.cardById.get(id); return !c || !((c.weaponMod && i !== w) || (c.shieldMod && i !== sm)); });
  }
  recompute(p) {
    this.oneModEach(p);
    const s = { ...DEFAULT_STATS };
    p.mod = null; p.smod = null;
    for (const id of p.cards) { const c = this.cardById.get(id); if (c) { applyCard(s, c); if (c.weaponMod && !['squad', 'bees', 'squid'].includes(c.weaponMod)) p.mod = c.weaponMod; if (c.shieldMod) p.smod = c.shieldMod; } }   // (Squad Caller keeps your normal gun)
    this.roundCards(p, s);
    finishStats(s);
    if (this.rmod && p.kind === 'hero' && !p.dummy && ROUND_MODS[this.rmod]) { applyCard(s, { modifiers: ROUND_MODS[this.rmod].mods }); s.ammo = Math.max(1, Math.round(s.ammo)); }   // v1.2.15 round modifier (after the clamps)
    if (p.dummy) s.health = Math.max(10, this.settings.dummyHp || 100);
    if (p.splitK && p.splitK < 1) applySplit(s, p.splitK);   // Clone shield mod: split down for the rest of the round
    p.stats = s;
    // Super Saiyan Hair: the pool is HAIR.mult x your max health, refreshed after every card (it never counts toward size).
    p.hairMax = p.smod === 'hair' ? HAIR.mult * s.health : 0;
    if (p.fx && p.fx.hair > p.hairMax) p.fx.hair = p.hairMax;
  }
  // v1.2.15: Overdrive Core and Ascension Core change with the round. cardRound remembers the round each card was taken
  // (picked between rounds: the next round is its first; taken any other time: this round is its first).
  roundCards(p, s) {
    const cr = p.cardRound || (p.cardRound = {});
    for (const id of p.cards) if (cr[id] == null) cr[id] = this.phase === 'picking' && !this.prePick ? this.round : this.round - 1;
    if (!(s.overdrive > 0 || s.ascend > 0)) return;
    const first = id => { const c = this.cardById.get(id); return c ? cr[id] + 1 : null; };
    let od = null, asc = null;
    for (const id of p.cards) {
      const c = this.cardById.get(id); if (!c) continue;
      const mods = c.modifiers || [];
      if (mods.some(m => m.stat === 'overdrive')) od = od == null ? first(id) : Math.min(od, first(id));
      if (mods.some(m => m.stat === 'ascend')) asc = asc == null ? first(id) : Math.min(asc, first(id));
    }
    p.ncOd = 0; p.ncAsc = 0;
    if (s.overdrive > 0 && od != null) {
      const on = ((this.round - od) % 3 + 3) % 3 === 0;
      p.ncOd = on ? 1 : 2;
      if (on) s.damage *= 1 + s.overdrive;
      else { s.blockCooldown *= 1 + s.overdriveLag; s.reloadTime *= 1 + s.overdriveLag; }
    }
    if (s.ascend > 0 && asc != null) {
      const held = this.round - asc, A = NEWC.asc, tier = held >= A.t2 ? 2 : held >= A.t1 ? 1 : 0;
      p.ncAsc = tier + (Math.max(0, held) << 2);
      if (tier) { const k = 1 + A.k * tier * s.ascend; s.health *= k; s.damage *= k; }
    }
  }
  modeOK(c) {
    if (!c.modes) return true;
    return c.modes.some(m => (m === 'commander' && this.settings.commander) || (m === 'waves' && this.isWaves()));
  }
  // Holy and cursed cards exclude each other: holding a holy card blocks cursed cards (and Regretful Pact),
  // holding a cursed card (or the Pact) blocks holy cards.
  alignment(p) {
    let holy = false, cursed = false;
    for (const id of p.cards) {
      const c = this.cardById.get(id); if (!c) continue;
      if (c.rarity === 'holy') holy = true;
      if (c.rarity === 'cursed' || c.special === 'regretfulPact') cursed = true;
    }
    return { holy, cursed };
  }
  canTake(p, c) {
    const a = this.alignment(p);
    if (a.holy && (c.rarity === 'cursed' || c.special === 'regretfulPact')) return false;
    if (a.cursed && c.rarity === 'holy') return false;
    return true;
  }
  // The weapon / shield mod cards this player holds (at most one of each).
  heldMods(p) { return p.cards.filter(id => { const c = this.cardById.get(id); return c && (c.weaponMod || c.shieldMod); }); }
  offerPool(p) {
    const a = this.alignment(p);
    // One weapon mod and one shield mod at a time: once you hold one, no more of that kind are dealt to you.
    const hasW = p.cards.some(id => (this.cardById.get(id) || {}).weaponMod), hasS = p.cards.some(id => (this.cardById.get(id) || {}).shieldMod);
    return this.allCards.filter(c => !c.combo && c.rarity !== 'combo' && c.special !== 'repentance' && this.modeOK(c) &&
      !this.uniqueHeld(p, c) && !(c.weaponMod && hasW) && !(c.shieldMod && hasS) &&
      !(c.special === 'modBreaker' && !hasW && !hasS) &&
      !(a.holy && (c.rarity === 'cursed' || c.special === 'regretfulPact')) && !(a.cursed && c.rarity === 'holy'));
  }
  // "unique": one copy (holy / cursed versions count as the same card). "uniqueGroup": one card of the group
  // (Squid / Bees, Orbital Drop / Guided Meteor), for cards whose main effect doesn't stack.
  uniqueHeld(p, c) {
    if (!c.unique && !c.uniqueGroup) return false;
    const base = this.baseId(c.id);
    return p.cards.some(id => { const h = this.cardById.get(id); return h && ((c.unique && this.baseId(id) === base) || (c.uniqueGroup && h.uniqueGroup === c.uniqueGroup)); });
  }
  makeOffer(p, exclude = []) {
    const pool = this.offerPool(p).filter(c => !exclude.includes(c.id));
    if (!p.pact) {
      // Holy and cursed aren't separate cards in the deck: each regular card dealt can turn holy or cursed right then.
      const base = pool.filter(c => !variantBase(c));
      return weightedOffer(base, OFFER_SIZE).map(c => {
        const r = Math.random(), a = this.alignment(p);
        const cur = this.cardById.get('cursed-' + c.id), holy = this.cardById.get('holy-' + c.id);
        if (cur && !a.holy && !exclude.includes(cur.id) && r < VARIANT_CHANCE.cursed) return cur.id;
        if (holy && !a.cursed && !exclude.includes(holy.id) && r >= 1 - VARIANT_CHANCE.holy) return holy.id;
        return c.id;
      });
    }
    // Regretful Pact: almost everything offered is cursed; Repentance can show up rarely.
    const cursed = pool.filter(c => c.rarity === 'cursed'), normal = pool.filter(c => c.rarity !== 'cursed' && c.special !== 'regretfulPact');
    const rep = this.allCards.find(c => c.special === 'repentance');
    const out = [];
    for (let k = 0; k < OFFER_SIZE; k++) {
      const r = Math.random();
      const take = list => { const left = list.filter(c => !out.includes(c.id)); if (left.length) out.push(left[Math.floor(Math.random() * left.length)].id); };
      if (rep && !out.includes(rep.id) && r < 0.07) out.push(rep.id);
      else if (r < 0.17 || !cursed.length) { const w = weightedOffer(normal.filter(c => !out.includes(c.id)), 1); if (w[0]) out.push(w[0].id); }
      else take(cursed);
    }
    return out;
  }
  checkCombos(p) {
    if (this.settings.combos === false) return;
    for (let guard = 0; guard < 10; guard++) {
      const C = this.combos.find(c => this.comboIdx(p, c));
      if (!C) return;
      this.formCombo(p, C);
    }
  }
  // Combos match pieces by their original card, so a holy or cursed piece still counts.
  baseId(id) { return variantBase(this.cardById.get(id)) || id; }
  comboIdx(p, C) {
    const [a, b] = C.combo, ia = p.cards.findIndex(x => this.baseId(x) === a);
    if (ia < 0) return null;
    const ib = p.cards.findIndex((x, i) => i !== ia && this.baseId(x) === b);
    return ib < 0 ? null : [ia, ib];
  }
  // What the combo comes out as: holy if a piece is holy, cursed if a piece is cursed, plain if it's one of each.
  comboResult(p, C) {
    const ix = this.comboIdx(p, C); if (!ix) return C.id;
    const parts = ix.map(i => this.cardById.get(p.cards[i]) || {});
    const h = parts.some(c => c.holyFrom), k = parts.some(c => c.cursedFrom);
    const id = h && !k ? 'holy-' + C.id : k && !h ? 'cursed-' + C.id : C.id;
    return this.cardById.has(id) ? id : C.id;
  }
  formCombo(p, C) {
    const ix = this.comboIdx(p, C); if (!ix) return null;
    const id = this.comboResult(p, C), from = ix.map(i => p.cards[i]);
    for (const i of ix.slice().sort((x, y) => y - x)) p.cards.splice(i, 1);
    p.cards.push(id);
    this.emit({ t: 'combo', p: p.id, card: id, from });
    return id;
  }

  // ------------------------------------------------------------ rounds
  start() {
    this.startRound();
    // v1.0.1: everyone picks a starting card before round 1 (not in the open world, Brawl, AMON or the practice range)
    if (this.startPickOn()) {
      this.prePick = { t: this.phaseT };
      // v1.0.8: drop round 1's 'round' event (it closes the pick screen on every client, which is why the starting
      // pick never showed); endPrePick sends it once the picks are in
      this.events = this.events.filter(e => e.t !== 'round');
      this.offerCards(this.heroes().filter(p => p.connected));
    }
  }
  startPickOn() {
    return this.settings.startPick !== false && !this.isOpen() && !this.isBrawl() && !this.isPractice() && this.settings.mode !== 'amon' && this.allCards.length > 0 && this.heroes().some(p => p.connected);
  }
  // After the starting pick: back to round 1's countdown, with health and ammo topped up for the new cards.
  endPrePick() {
    const pp = this.prePick; this.prePick = null;
    for (const p of this.heroes()) { p.picked = true; p.offer = null; if (p.alive) { p.size = p.fixedSize || sizeFor(this.maxHp(p)); p.hp = this.maxHp(p); p.ammo = Math.round(p.stats.ammo); } }
    this.phase = 'countdown'; this.phaseT = pp.t; this.lastCount = null; this.fightSent = false;
    this.emit({ t: 'round', n: this.round, map: this.level.name, wave: this.isWaves() ? this.round : 0, final: this.isFinalRound(), rmod: this.rmod, start: 1, ...tournIntroInfo(this), ...(this.tourn ? { ti: Math.max(0, this.phaseT - (RULES.countdown || 3)) } : null) });
  }
  afterPicks() { if (this.prePick) this.endPrePick(); else this.startRound(); }

  startRound() {
    // Core Defense: what the players built carries over (a retry puts back how the wave started).
    const coreKeep = this.settings.core ? (this.coreRetry || (this.round > 0 ? coreCapture(this) : null)) : null, coreNoHeal = !!this.coreRetry || this.round === 0;
    this.coreRetry = null;
    this.round++; this.levelVersion++; this.time = 0; this.overtime = false; this.odx = 0; this.fightAt = null; this.wells = [];
    this.unitsRemoved();
    this.players = this.players.filter(p => !p.transient);
    // Bots that gave their seat to a late joiner leave now (between rounds, so nobody vanishes mid-fight).
    for (const p of this.players) if (p.retireNext && p.connected) {
      p.connected = false; p.alive = false; p.picked = true; p.offer = null;
      if (!this.isWaves() && this.settings.mode !== 'tdm' && !this.isPractice()) delete this.scores[p.id];
      this.emit({ t: 'left', p: p.id, bot: true });
    }
    for (const p of this.players) { p.lateJoin = false; p.respawnT = null; }
    const heroes = this.heroes().filter(p => p.connected && !p.tko);   // (tournament: the knocked out only watch)
    const groups = [], idx = new Map();
    for (const p of heroes) {
      const k = this.scoreKey(p);
      if (!idx.has(k)) { idx.set(k, groups.length); groups.push([]); }
      groups[idx.get(k)].push(p);
    }
    const tArenas = this.tourn ? tournStart(this, heroes) : null;
    for (let i = groups.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [groups[i], groups[j]] = [groups[j], groups[i]]; }
    // Co-op: the Game Master buys this wave from its credit budget (coop.js) and splits it into an opening
    // group plus reinforcements. The final wave brings the boss.
    this.telegraphs = []; this.shockwaves = []; this.boss = null; this.gm = null; this.blotches = [];
    const plan = this.isWaves() ? planWave(this, heroes.length) : null;
    const waveGroups = plan ? splitWave(plan, heroes.length, this.settings.gmSpawn || 'auto') : null;
    const waveCount = plan ? Math.max(1, waveGroups[0].length + (plan.boss ? 1 : 0)) : 0;
    const totalUnits = plan ? plan.units.length + (plan.boss ? 4 : 0) : 0;
    const seed = (Math.random() * 2 ** 31) | 0, rng = mulberry32(seed ^ 0x51ed);
    const prevMod = this.rmod; this.rmod = this.pickRoundMod();
    const open = this.isOpen(), side = this.isSide();
    SIDE_ON = side; BRAWL_ON = this.isBrawl();
    if (this.settings.core && this.coreSeed == null) this.coreSeed = seed;   // v28 Core Defense: one map for the whole match (made for wave 1)
    const level = open ? generateOpenWorld(seed, this.settings) : this.settings.core ? generateCoreLevel(this.coreSeed, this.settings.themes) : BRAWL_ON ? generateBrawlLevel(heroes.length, seed, this.settings.themes, !!this.settings.brawlFlat) : side ? generateSideLevel(heroes.length + Math.ceil(totalUnits / 3), this.settings.mapSource, seed, this.settings.themes, { spread: this.settings.mode === 'tdm' || this.isWaves() }) : generateLevel(tArenas ? Math.max(...tArenas.map(A => A.length)) : heroes.length + Math.ceil(totalUnits / 2), this.settings.mapSource, seed, this.settings.themes, heroes.length + waveCount, { noLava: this.isWaves(), liquids: { lava: this.settings.mapLava !== false, ice: this.settings.mapIce !== false } });
    level.rmod = this.rmod;
    if (this.rmod && ROUND_MODS[this.rmod].grav) level.gravK = (level.gravK || 1) * ROUND_MODS[this.rmod].grav;
    const sizes = groups.map(g => g.length);
    if (waveCount) sizes.push(waveCount);
    // tournament: every arena is the same map, each with its own spawn points (one group per side in it)
    const tGroups = tArenas ? tArenas.map(A => { const m = new Map(); for (const p of A) { const k = this.scoreKey(p); if (!m.has(k)) m.set(k, []); m.get(k).push(p); } return [...m.values()]; }) : null;
    const tPts = tGroups ? tGroups.map(G => spawnPoints(level, G.map(x => x.length), {})) : null;
    const pts = tPts ? tPts.flat() : open ? sizes.map(n => Array.from({ length: n }, () => ({ x: 0, y: OW.busY, z: 0 }))) : this.settings.core ? coreSpawnPoints(level, sizes, (coreKeep && coreKeep.cx != null ? { x: coreKeep.cx, z: coreKeep.cz } : this.corePos) || undefined) : BRAWL_ON ? brawlSpawnPoints(level, sizes) : side ? sideSpawnPoints(level, sizes) : spawnPoints(level, sizes, { coop: this.isWaves() && sizes.length === 2 });
    if (!open && !side) clearSpawns(level, pts.flat());
    this.level = prepareLevel(level);
    this.buildDynamics();
    this.flyHeight = side ? level.side.top * 0.55 : Math.max(3.2, ...level.boxes.filter(b => !b.wall).map(b => b.y0 + b.h), ...level.dynamic.map(o => o.kind === 'piston' ? o.hMax : o.y0 + o.h)) + UNITS.drone.flyAbove;
    // v26 Core Defense: heroes stay where they were between waves (not on a retry or the first wave)
    const corePos = this.settings.core && coreKeep && !coreNoHeal ? new Map(heroes.filter(p => p.alive && p.pos).map(p => [p.id, { ...p.pos }])) : null;
    for (const p of this.players) { p.alive = false; p.reviving = false; }
    for (const p of heroes) if (this.rmod !== prevMod || (!BRAWL_ON && (p.stats.overdrive > 0 || p.stats.ascend > 0))) this.recompute(p);   // v1.2.15: round-based cards
    this.bItems = []; this.bItemT = null;
    if (BRAWL_ON) for (const p of this.players) { p.stocks = p.connected && heroes.includes(p) ? Math.max(1, this.settings.stocks || BRAWL.stocks) : 0; p.respawnT = null; }
    if (tGroups) { tGroups.forEach((G, ai) => G.forEach((g, gi) => g.forEach((p, k) => this.resetPlayer(p, tPts[ai][gi][k])))); this.tSpots = tPts.flat(2); }
    else groups.forEach((g, gi) => g.forEach((p, k) => this.resetPlayer(p, (corePos && corePos.get(p.id)) || pts[gi][k])));
    this.ow = null;
    for (const p of this.players) { p.ow = null; p.veh = null; }
    if (open) owStart(this, heroes);
    this.bullets = []; this.barricades = []; this.shields = []; this.mines = []; this.fields = []; this.booms = []; this.fires = []; this.clouds = []; this.rituals = []; this.relics = [];
    this.core = null;
    if (this.settings.core) { this.refreshSolids(); coreStart(this, coreKeep, coreNoHeal); }
    // summons (commander mode cards)
    for (const h of heroes) {
      const s = h.stats;
      for (let k = 0; k < Math.round(s.summonTwin); k++) this.spawnUnit('twin', h, this.nearSpot(h, k + 1));
      for (let k = 0; k < Math.round(s.summonTurret); k++) this.spawnUnit('turret', h, this.nearSpot(h, k + 3));
      for (let k = 0; k < Math.round(s.summonDrone); k++) this.spawnUnit('drone', h, this.nearSpot(h, k + 5));
    }
    this.corePending = null;
    if (plan && this.settings.core) this.corePending = [plan, waveGroups, pts[pts.length - 1], heroes];   // Core Defense: the wave only shows up just before it attacks
    else if (plan) { this.refreshSolids(); this.spawnPlannedWave(plan, waveGroups, pts[pts.length - 1], heroes); }
    // hazard event
    this.hazard = null;
    if (this.settings.hazards && rng() < 0.5) this.setupHazard(rng);
    level.hazard = this.hazard ? this.hazardForNet() : null;
    this.refreshSolids();
    this.unitsChanged();
    this.phase = 'countdown'; this.phaseT = this.settings.core ? CORE.prep : (RULES.countdown || 3) + (this.isWaves() ? WAVE_PREP.extra : 0) + (open ? 2 : 0) + (this.tourn ? TOURN.intro : 0); this.fightSent = false; this.roundWinner = null;
    this.emit({ t: 'round', n: this.round, map: level.name, hazard: this.hazard && this.hazard.type, wave: this.isWaves() ? this.round : 0, boss: plan && plan.boss && this.boss ? this.boss.name : null, final: this.isFinalRound(), rmod: this.rmod, gm: this.gm ? this.gmSummary(plan) : null, ...tournIntroInfo(this) });
    if (this.gm) for (const u of this.players) if (u.kind === 'elite' && u.alive) this.announceElite(u);
  }

  // v1.2.15: the round modifier for the next round (never the same one twice in a row when random)
  pickRoundMod() {
    const r = this.settings.roundMods;
    if (!r || r === 'off') return null;
    if (r !== 'random') return ROUND_MODS[r] ? r : null;
    const ids = Object.keys(ROUND_MODS).filter(k => k !== this.rmod);
    return ids[Math.floor(Math.random() * ids.length)];
  }

  nearSpot(h, k) {
    const a = k * 2.1, r = 1.6;
    const p = this.clampArena(h.pos.x + Math.cos(a) * r, h.pos.z + Math.sin(a) * r, 1);
    return { x: p.x, y: h.pos.y, z: p.z };
  }

  resetPlayer(p, pt) {
    if (p.splitK && p.splitK < 1) { p.splitK = 1; this.recompute(p); }   // a new round (or practice respawn) undoes Clone splits
    p.lootQ = null;
    p.pos = { x: pt.x, y: pt.y || 0, z: pt.z }; p.vel = { x: 0, y: 0, z: 0 };
    p.bonusHp = 0; p.size = sizeFor(p.stats.health);
    p.hp = p.stats.health; p.ammo = p.stats.ammo; p.reloadT = 0; p.fireT = 0.3; p.blockT = p.kind === 'hero' && this.phase === 'play' ? 1 : 0; p.blockCdT = 0; p.blockExtra = 0;   // (v1.2.13: a respawn mid-round comes with a one-second shield)
    if (BRAWL_ON) { p.pct = 0; p.bHp = null; }
    p.encoreQ = null; p.alive = true; p.reviving = false; p.flashT = 0; p.ai = {}; p.fx = {}; p.spawn = { x: pt.x, y: pt.y || 0, z: pt.z };
    const l = Math.hypot(pt.x, pt.z) || 1;
    p.aim = { x: -pt.x / l, y: 0, z: -pt.z / l }; p.aimPoint = { x: 0, y: CHEST, z: 0 };
    p.input.mx = p.input.mz = 0; p.input.shoot = false; p.input.aim = null; p.input.aimPoint = null;
    p.lastBlockSeq = p.input.blockSeq; p.lastReloadSeq = p.input.reloadSeq; p.lastShotSeq = p.input.shotSeq | 0;
    p.lastUseSeq = p.input.useSeq | 0; p.coreUseT = 0;   // v1.0.1: a use press made while dead doesn't fire on respawn; the clock restarts each round
    if (p.flying) p.pos.y = this.flyHeight;
    this.ncReset(p);
    runHook('onRoundStart', this, p);
  }

  // ------------------------------------------------------------ units
  spawnUnit(kind, owner, pt, extra = {}) {
    const id = 'u' + (this.nextUnit++);
    let stats, name, color, team, cosmetics = null, cards = [];
    if (kind === 'twin') { stats = { ...owner.stats, health: owner.stats.health * 0.5 }; name = `${owner.name}'s twin`; cosmetics = owner.cosmetics; cards = owner.cards.slice(); }
    else if (kind === 'turret') {
      stats = { ...owner.stats, projectiles: owner.stats.projectiles + 1, spread: 0.08, moveSpeed: 0, jump: 0, health: owner.stats.health * 1.2 };
      name = `${owner.name}'s turret`;
    } else if (kind === 'drone') {
      stats = { ...DEFAULT_STATS, health: UNITS.drone.health, damage: UNITS.drone.damage, fireRate: 4, ammo: 6, reloadTime: 1.2, bulletSpeed: 32, moveSpeed: 4.2, bulletSize: 0.1 };
      name = `${owner.name}'s drone`;
    } else if (kind === 'hazardTurret') {
      stats = { ...DEFAULT_STATS, health: UNITS.hazardTurret.health, damage: UNITS.hazardTurret.damage, projectiles: 2, spread: 0.08, fireRate: 2.2, ammo: 6, reloadTime: 1.8, moveSpeed: 0, jump: 0, blockCooldown: 4 };
      name = 'Turret'; color = '#cfd6e4'; team = -1;
    } else if (kind === 'wave') { stats = extra.stats; name = extra.name; color = extra.color; team = 1; cards = extra.cards || []; cosmetics = extra.cosmetics || null; }
    else if (kind === 'bigbro') {   // v1.2.22 Big Brother (was Space King): a giant, slow copy of you with your gun and cards
      stats = { ...owner.stats, health: owner.stats.health * BIGBRO.hp, damage: owner.stats.damage * BIGBRO.dmg, bulletSize: owner.stats.bulletSize * 1.6, moveSpeed: owner.stats.moveSpeed * BIGBRO.speed, jump: owner.stats.jump * 0.8, revive: 0 };
      name = `${owner.name}'s Big Brother`; cosmetics = owner.cosmetics; cards = owner.cards.filter(id => !/spaceking/.test(id));
    }
    else if (kind === 'clone') { stats = { ...owner.stats, revive: 0 }; name = `${owner.name}'s clone`; cosmetics = owner.cosmetics; cards = owner.cards.slice(); }
    else if (kind === 'critter') { stats = extra.stats; name = `${owner.name}'s critter`; }
    else if (kind === 'blockTurret' || kind === 'mount') { stats = extra.stats; name = `${owner.name}'s turret`; }
    else if (kind === 'brute') { stats = extra.stats; name = `${owner.name}'s brute`; }
    else if (kind === 'angel') { stats = extra.stats; name = `${owner.name}'s angel`; }
    else if (kind === 'decoy') { stats = { ...DEFAULT_STATS, health: NEWC.decoy.hp, moveSpeed: 0, jump: 0 }; name = `${owner.name}'s afterimage`; cosmetics = owner.cosmetics; }
    else if (kind === 'soldier') { stats = extra.stats; name = `${owner.name}'s soldier`; cosmetics = owner.cosmetics; }
    const p = this.makePlayer({
      id, name, kind: kind === 'wave' ? (extra.unitKind || 'hero_bot') : kind, isBot: true, transient: true,
      difficulty: extra.difficulty || (owner ? 'hard' : 'normal'), ownerId: owner ? owner.id : null,
      team: team ?? (owner ? owner.team : 0), color: color || (owner ? owner.color : '#ffffff'), cosmetics,
    });
    if (kind === 'wave') {
      p.kind = extra.unitKind || 'wave'; p.flying = p.kind === 'drone';
      if (p.kind === 'critter') { p.fixedSize = 0.5; p.melee = 8 + this.round; }
      if (p.kind === 'splitter') { p.fixedSize = 1.5; p.melee = 14 + this.round; }
      if (extra.melee) p.melee = extra.melee;
    }
    if (kind === 'clone') { p.mod = owner.mod; p.smod = 'clone'; p.ephemeral = true; }
    if (kind === 'bigbro') { p.mod = owner.mod; p.fixedSize = BIGBRO.size; p.noBlock = true; p.heavy = true; p.kingOf = owner.id; }   // a clone can block too: that splits the clone itself
    if (kind === 'critter') { p.fixedSize = 0.5; p.melee = extra.melee; p.lifeT = 12; p.ephemeral = true; }
    if (kind === 'blockTurret') { p.fixedSize = extra.size; p.lifeT = extra.life; p.noBlock = true; p.ephemeral = true; }
    if (kind === 'mount') { p.fixedSize = MOUNT.size; p.noBlock = true; p.ephemeral = true; p.heavy = true; p.casterId = owner.id; p.riderId = null; }
    if (kind === 'brute') { p.fixedSize = RITUAL.brute.size; p.melee = extra.melee; p.lifeT = RITUAL.brute.life; p.noBlock = true; p.ephemeral = true; p.heavy = true; }
    if (kind === 'angel') { p.fixedSize = 0.8; p.noBlock = true; p.ephemeral = true; p.flying = true; }
    if (kind === 'decoy') { p.fixedSize = owner.size || 1; p.noBlock = true; p.ephemeral = true; p.lifeT = extra.life || 2; }
    if (kind === 'soldier') { p.fixedSize = NEWC.squad.size; p.noBlock = true; p.ephemeral = true; }
    p.stats = stats; p.cards = cards;
    if (this.tourn) p.arena = owner.arena ?? null;   // (a unit fights in its owner's arena)
    this.players.push(p);
    this.resetPlayer(p, pt);
    return p;
  }

  // One enemy of a Game Master unit type (coop.js unitSpec), at pt.
  spawnWaveUnit(type, pt, idx) {
    if (this.settings.core) {
      pt = coreSpawnGuard(this, pt);   // never right next to the core
      const tw = this.coreTwist ? CORE_TWISTS[this.coreTwist] : {};
      if (type === 'hulk') {   // v1.2.3: Sky Hulk, a huge slow flier that drifts in over the walls and bombs the core
        const n = this.round, D = coopDiff(this.settings);
        const stats = { ...DEFAULT_STATS, health: (420 + 55 * n) * D.hp, damage: (26 + 2 * n) * D.dmg, moveSpeed: DEFAULT_STATS.moveSpeed * 0.32, fireRate: 0.55, ammo: 3, reloadTime: 2.4,
          bulletSpeed: 16, bulletSize: 0.32, explosive: 1, spread: 0.05, jump: 0, blockCooldown: 99 };
        const u = this.spawnUnit('wave', null, { x: pt.x, y: this.flyHeight + 3, z: pt.z }, { stats, unitKind: 'drone', name: 'Sky Hulk', color: '#5b3f8c', difficulty: 'normal' });
        u.hulk = true; u.flyUp = 3; u.fixedSize = 2.6; u.noBlock = true; u.heavy = true;
        return u;
      }
      if (type === 'wave' && this.round >= 2 && Math.random() < (tw.brute || CORE.bruteChance)) {   // a Cursed Sacrifice brute joins the raid
        const B = RITUAL.brute, stats = { ...DEFAULT_STATS, health: 240 + 45 * this.round, damage: 0, moveSpeed: DEFAULT_STATS.moveSpeed * 1.05, jump: 9, blockCooldown: 99 };
        const u = this.spawnUnit('wave', null, pt, { stats, unitKind: 'brute', name: 'Brute', color: '#8a2333', melee: 20 + 3 * this.round });
        u.fixedSize = B.size; u.heavy = true; u.noBlock = true;
        return u;
      }
      // v28: AMON enemies join the raids from wave 3, more of them (and tougher kinds) as the waves go on
      if ((type === 'wave' || type === 'critter' || type === 'splitter') && this.round >= CORE.amonFrom && Math.random() < CORE.amonChance(this.round)) {
        const def = coreAmonPick(this);
        if (def) {
          const A = coreAmonStats(this, def, coopDiff(this.settings));
          const u = this.spawnUnit('wave', null, { x: pt.x + (Math.random() - 0.5) * 1.4, y: pt.y || 0, z: pt.z + (Math.random() - 0.5) * 1.4 }, { stats: A.stats, unitKind: 'amon', name: def.name, color: def.look.color, melee: A.melee || undefined, difficulty: 'normal' });
          u.am = def.id; u.fixedSize = A.size; u.noBlock = true; u.heavy = A.size > 1.6;
          if (A.air) { u.flying = true; u.pos.y = this.flyHeight; }
          return u;
        }
      }
    }
    const spec = unitSpec(this, type, idx);
    const p = this.spawnUnit('wave', null, { x: pt.x + (Math.random() - 0.5) * 1.4, y: pt.y || 0, z: pt.z + (Math.random() - 0.5) * 1.4 }, spec);
    if (this.settings.core && this.coreTwist === 'rush') p.stats.moveSpeed *= CORE_TWISTS.rush.speed;
    return p;
  }
  spawnPlannedWave(plan, groups, pts, heroes) {
    const wb = gmBudget(this, heroes.length), first = groups[0] || [];
    this.gm = { budget: plan.budget, spent: plan.spent, units: plan.units.slice(), queue: groups.slice(1), sinceT: 0, spawned: 0,
      groupValue: first.reduce((a, t) => a + (UNIT_COSTS[t] || 1), 0),
      portalCredits: plan.boss ? wb * 0.35 : 0, portalRate: wb * 0.03, portalCap: wb * 0.6 };
    let i = 0;
    if (plan.boss) {
      const c = boundaryPoint(this.level, 0, 4.5), sp = this.freeSpot(c.x, c.z, 0, 0, 1.3, 0.2);
      spawnBoss(this, sp, heroes); i = 1;
    }
    first.forEach((t, k) => this.spawnWaveUnit(t, pts[(k + i) % pts.length], this.gm.spawned++));
  }
  gmSummary(plan) {
    const count = {};
    for (const t of plan.units) count[t] = (count[t] || 0) + 1;
    return { budget: Math.round(plan.budget), spent: Math.round(plan.spent), units: count, groups: 1 + this.gm.queue.length, boss: !!plan.boss };
  }
  announceElite(u) {
    u.announced = true;
    this.emit({ t: 'elite', p: u.id, name: u.name, cards: u.cards.map(id => (this.cardById.get(id) || {}).name || id) });
    this.emitCards(u);
  }
  // The deciding round: co-op's final wave, or any FFA/TDM round someone still standing could win the match with.
  isFinalRound() {
    if (this.isPractice()) return false;
    if (this.isWaves()) return this.round >= this.settings.roundsToWin;
    const keys = new Set(this.heroes().filter(p => p.connected).map(p => this.scoreKey(p)));
    return [...keys].some(k => (this.scores[k] || 0) + 1 >= this.settings.roundsToWin);
  }

  // ------------------------------------------------------------ hazards
  setupHazard(rng) {
    const L = this.level;
    const tall = L.boxes.filter(b => !b.wall && b.y0 + b.h >= 3);
    const types = ['laser', 'turret'];
    if (tall.length) types.push('saws');
    const type = types[Math.floor(rng() * types.length)];
    if (type === 'laser') {
      const axis = rng() < 0.5 ? 'x' : 'z';
      this.hazard = { type, axis, y: L.lava ? 2.9 : 0.55, span: axis === 'x' ? L.hz - 0.5 : L.hx - 0.5, state: 'idle', t: 4 + rng() * 5, pos: 0, dir: rng() < 0.5 ? 1 : -1 };
    } else if (type === 'saws') {
      const picks = tall.sort(() => rng() - 0.5).slice(0, 4), saws = [];
      for (const b of picks) {
        const side = Math.floor(rng() * 4), nx = side === 0 ? 1 : side === 1 ? -1 : 0, nz = side === 2 ? 1 : side === 3 ? -1 : 0;
        // Blade plane is perpendicular to the pillar face; its hub sits 0.35 m out so it clearly juts out.
        saws.push({ x: b.x + nx * (b.w / 2 + 0.35), y: b.y0 + 1.0, z: b.z + nz * (b.d / 2 + 0.35), nx, nz });
      }
      this.hazard = { type, saws };
    } else {
      const y = groundBelow(this.level.solids, 0, 0, 20);
      this.hazard = { type: 'turret' };
      this.spawnUnit('hazardTurret', null, { x: 0, y, z: 0 });
    }
    this.emit({ t: 'hazard', type });
  }
  hazardForNet() {
    const h = this.hazard;
    if (h.type === 'laser') return { type: h.type, axis: h.axis, y: h.y, span: h.span };
    if (h.type === 'saws') return { type: h.type, saws: h.saws };
    return { type: h.type };
  }
  updateHazard(dt) {
    const h = this.hazard;
    if (!h || this.phase !== 'play') return;
    const touchCd = (p, key, cd) => { if ((p.fx[key] || 0) > this.time) return false; p.fx[key] = this.time + cd; return true; };
    if (h.type === 'laser') {
      h.t -= dt;
      if (h.state === 'idle' && h.t <= 0) { h.state = 'warn'; h.t = 2.5; h.pos = -h.span * h.dir; this.emit({ t: 'laserWarn' }); }
      else if (h.state === 'warn' && h.t <= 0) { h.state = 'on'; h.t = 11; }
      else if (h.state === 'on') {
        h.pos += h.dir * (2 * h.span / 11) * dt;
        if (h.t <= 0) { h.state = 'idle'; h.t = 8 + Math.random() * 6; h.dir *= -1; }
        for (const p of this.players) {
          if (!p.alive || p.reviving || p.flying) continue;
          const c = h.axis === 'x' ? p.pos.z : p.pos.x;
          if (Math.abs(c - h.pos) < 0.25 + PR * p.size && p.pos.y < h.y && p.pos.y + PH * p.size > h.y && touchCd(p, 'laserCd', 0.7)) {
            if (p.blockT > 0) this.emit({ t: 'block', p: p.id, x: p.pos.x, y: h.y, z: p.pos.z });
            else this.hurt(p, 18, null, null);
          }
        }
      }
    } else if (h.type === 'saws') {
      for (const p of this.players) {
        if (!p.alive || p.reviving || p.flying) continue;
        for (const sw of h.saws) {
          const dx = p.pos.x - sw.x, dz = p.pos.z - sw.z, d = Math.hypot(dx, dz);
          if (d < 0.62 + PR * p.size && Math.abs(sw.y - (p.pos.y + PH * p.size / 2)) < 0.62 + PH * p.size / 2 && touchCd(p, 'sawCd', 0.7)) {
            if (p.blockT > 0) { this.emit({ t: 'block', p: p.id, x: sw.x, y: sw.y, z: sw.z }); continue; }
            this.hurt(p, 15, null, { x: dx / (d || 1), y: 0, z: dz / (d || 1) });
            p.vel.x += (dx / (d || 1)) * 7; p.vel.z += (dz / (d || 1)) * 7; p.vel.y += 3;
          }
        }
      }
    }
  }

  // v1.2.15 trap arenas: crushers slam down on a timer (a moving solid: anyone caught under it is hurt and shoved out)
  crusherStep(o) {
    const c = crusherAt(o.def, this.time), was = o.st;
    o.pos.y = c.y; o.st = c.st;
    if (c.st === 3 && was !== 3) { this.emit({ t: 'nc', k: 'crush', x: o.pos.x, z: o.pos.z }); }
    if (c.st < 2 || c.st > 3) return;
    for (const p of this.players) {
      if (!p.alive || p.reviving || p.flying || p.ground === o) continue;
      const r = PR * (p.size || 1), ox = o.w / 2 + r - Math.abs(p.pos.x - o.pos.x), oz = o.d / 2 + r - Math.abs(p.pos.z - o.pos.z);
      if (ox <= 0 || oz <= 0 || p.pos.y >= o.pos.y + o.h - 0.05 || p.pos.y + PH * (p.size || 1) <= o.pos.y) continue;
      const sx = Math.sign(p.pos.x - o.pos.x) || 1, sz = Math.sign(p.pos.z - o.pos.z) || 1;
      if (ox < oz) { p.pos.x += sx * (ox + 0.05); p.vel.x = sx * 7; } else { p.pos.z += sz * (oz + 0.05); p.vel.z = sz * 7; }
      if (this.phase === 'play' && (p.fx.crushCd || 0) <= this.time) {
        p.fx.crushCd = this.time + 1;
        if (p.blockT > 0) this.emit({ t: 'block', p: p.id, x: p.pos.x, y: p.pos.y + 1, z: p.pos.z });
        else this.hurt(p, TRAP.crushDmg, null, { x: ox < oz ? sx : 0, y: 0, z: ox < oz ? 0 : sz });
      }
    }
  }
  // v1.2.22 pinch pistons: a jaw shoves anyone in its way toward the middle while closing; caught between shut jaws = dead
  pinchStep(o) {
    const d = o.def, c = pinchAt(d, this.time), ax = d.axis, was = o.st;
    o.pos[ax] = pinchPos(d, c.k); o.st = c.st;
    if (c.st === 3 && was !== 3 && d.side > 0) this.emit({ t: 'nc', k: 'crush', x: ax === 'x' ? d.c : o.pos.x, z: ax === 'x' ? o.pos.z : d.c });
    if (c.st < 2 || c.st > 3) return;
    const pa = ax === 'x' ? 'z' : 'x';
    for (const p of this.players) {
      if (!p.alive || p.reviving || p.flying) continue;
      const r = PR * (p.size || 1), oa = o.w / 2 + r - Math.abs(p.pos.x - o.pos.x), ob = o.d / 2 + r - Math.abs(p.pos.z - o.pos.z);
      if (oa <= 0 || ob <= 0 || p.pos.y >= o.pos.y + o.h - 0.05 || p.pos.y + PH * (p.size || 1) <= o.pos.y) continue;
      const pen = ax === 'x' ? oa : ob;
      if (c.st === 3 || Math.abs(p.pos[ax] - d.c) < r + 0.15) {   // caught in the middle
        if (this.phase === 'play' && (p.fx.crushCd || 0) <= this.time) { p.fx.crushCd = this.time + 0.5; this.dmgTag = 'blast'; this.hurt(p, 9999, null, { x: 0, y: 1, z: 0 }); }
        continue;
      }
      p.pos[ax] -= d.side * (pen + 0.03); p.vel[ax] = -d.side * 6;   // pushed toward the middle with the jaw
      if (Math.abs(p.pos[pa] - o.pos[pa]) > 0) { /* stays in its lane */ }
    }
  }
  // Spike floors, laser fences and sweeping lasers (traps.js): hurt whoever touches them while they're on.
  updateTraps() {
    const L = this.level, T = this.time;
    if (!L.traps || this.phase !== 'play') return;
    const st = L.traps.map(tr => trapState(tr, T));
    for (const p of this.players) {
      if (!p.alive || p.reviving || p.flying || p.kind === 'turret' || p.kind === 'hazardTurret') continue;
      const r = PR * (p.size || 1), top = p.pos.y + PH * (p.size || 1);
      L.traps.forEach((tr, i) => {
        const s = st[i]; if (s.s !== 2) return;
        let dmg = 0, dir = null;
        if (tr.kind === 'spikes') {
          if (p.pos.y < TRAP.spikeHeight && Math.abs(p.pos.x - tr.x) < tr.w / 2 + r * 0.5 && Math.abs(p.pos.z - tr.z) < tr.d / 2 + r * 0.5) { dmg = TRAP.spikeDmg; dir = { x: 0, y: 1, z: 0 }; }
        } else if (tr.kind === 'fence') {
          if (p.pos.y < TRAP.fenceH && segDist(p.pos.x, p.pos.z, tr.ax, tr.az, tr.bx, tr.bz) < 0.2 + r) dmg = TRAP.fenceDmg;
        } else {
          const c = tr.axis === 'x' ? p.pos.z : p.pos.x;
          if (Math.abs(c - s.pos) < 0.25 + r && p.pos.y < TRAP.sweepY && top > TRAP.sweepY) dmg = TRAP.sweepDmg;
        }
        if (!dmg) return;
        const key = 'trapCd' + tr.id;
        if ((p.fx[key] || 0) > T) return;
        p.fx[key] = T + 0.8;
        if (p.blockT > 0) { this.emit({ t: 'block', p: p.id, x: p.pos.x, y: p.pos.y + 0.6, z: p.pos.z }); return; }
        this.hurt(p, dmg, null, dir);
        if (tr.kind === 'spikes') p.vel.y = Math.max(p.vel.y, 6.5);
        else if (tr.kind === 'fence') { const vx = tr.bz - tr.az, vz = -(tr.bx - tr.ax), l = Math.hypot(vx, vz) || 1, sd = Math.sign((p.pos.x - tr.ax) * vx + (p.pos.z - tr.az) * vz) || 1; p.vel.x += sd * vx / l * 8; p.vel.z += sd * vz / l * 8; }
      });
    }
  }

  // ------------------------------------------------------------ world objects
  buildDynamics() {
    this.dyn = (this.level.dynamic || []).map(d => {
      const o = { id: d.id, kind: d.kind, w: d.w, d: d.d, h: d.h, def: d, mass: d.mass || 5,
        base: { x: d.x, y: d.y0, z: d.z }, pos: { x: d.x, y: d.y0, z: d.z }, vel: { x: 0, y: 0, z: 0 }, dx: 0, dy: 0, dz: 0 };
      o.pushable = d.kind === 'crate' || d.kind === 'barrel';
      if (d.kind === 'float') o.onLand = vy => { o.vel.y += vy * 0.05; };
      if (d.kind === 'swing') swingStep(o, 0);
      o.solid = { min: {}, max: {}, obj: o, oneWay: !!d.oneWay };
      this.updateSolid(o);
      return o;
    });
  }
  updateSolid(o) {
    const s = o.solid;
    s.min.x = o.pos.x - o.w / 2; s.max.x = o.pos.x + o.w / 2;
    s.min.z = o.pos.z - o.d / 2; s.max.z = o.pos.z + o.d / 2;
    s.min.y = o.pos.y; s.max.y = o.pos.y + o.h;
  }
  impulse(o, J) {
    if (!o || o.kind === 'slide' || o.kind === 'piston' || o.kind === 'crusher' || o.kind === 'pinch') return;
    if (o.kind === 'swing') { swingImpulse(o, J); return; }
    o.vel.x += J.x / o.mass; o.vel.y += J.y / o.mass; o.vel.z += J.z / o.mass;
  }
  updateDynamics(dt) {
    const t = this.time;
    for (const o of this.dyn) {
      const px = o.pos.x, py = o.pos.y, pz = o.pos.z, top0 = o.pos.y + o.h;
      if (o.kind === 'slide') {
        o.pos[o.def.axis] = o.base[o.def.axis] + o.def.amp * Math.sin(2 * Math.PI * t / o.def.period + o.def.phase);
      } else if (o.kind === 'piston') {
        // hold low, rise slowly, hold high, sink slowly
        const u = ((t / o.def.period) + o.def.phase / (2 * Math.PI)) % 1;
        const ease = x => x * x * (3 - 2 * x);
        const k = u < 0.3 ? 0 : u < 0.5 ? ease((u - 0.3) / 0.2) : u < 0.8 ? 1 : 1 - ease((u - 0.8) / 0.2);
        o.h = o.def.hMin + (o.def.hMax - o.def.hMin) * k;
      } else if (o.kind === 'crusher') {
        this.crusherStep(o);
      } else if (o.kind === 'pinch') {
        this.pinchStep(o);
      } else if (o.kind === 'swing') {
        swingStep(o, dt);
      } else if ((o.kind === 'crate' || o.kind === 'barrel') && o.gone) {
        continue;   // fell off the map: stays gone (parked far below) instead of dropping in again and again
      } else if (o.kind === 'crate' || o.kind === 'barrel') {
        // 2D: a moving platform coming down onto a prop (or sweeping through it) shoves it out sideways; otherwise the
        // collision pushes it up through the platform and it pops on top of it, over and over.
        if (this.level.side) for (const m of this.dyn) {
          if (m.kind !== 'slide') continue;
          const ox = (m.w + o.w) / 2 - Math.abs(o.pos.x - m.pos.x);
          if (ox <= 0 || o.pos.y >= m.pos.y + m.h - 0.05 || o.pos.y + o.h <= m.pos.y) continue;
          if (o.pos.y + o.h / 2 > m.pos.y + m.h / 2) continue;   // mostly above: let it ride
          const sx = Math.sign(o.pos.x - m.pos.x) || 1;
          o.pos.x += sx * (ox + 0.02); o.vel.x = sx * Math.max(Math.abs(o.vel.x), 1);
        }
        moveBody(o, dt, this.solids, this.level);   // (v1.2.6: moveBody skips the prop's own solid and noPlayer ones itself)
        if (this.level.side && (o.pos.y < SIDE.bottom - 8 || Math.abs(o.pos.x) > this.level.hx + 1)) { o.gone = true; o.pos = { x: o.base.x, y: -80, z: 0 }; o.vel = { x: 0, y: 0, z: 0 }; continue; }   // v26: off the map = despawned
        const SP = this.level.side && this.level.side.pads;
        if (SP && o.vel.y <= 0.01) for (const [a, b, y] of SP) if (o.pos.x > a - 0.3 && o.pos.x < b + 0.3 && Math.abs(o.pos.y - y) < 0.12) {   // crates bounce on pads like players
          o.vel.y = SIDE.pad * 0.8 * Math.sqrt(this.level.gravK || 1); o.pos.y += 0.05; break;
        }
      } else if (o.kind === 'float') {
        const riders = this.players.filter(p => p.alive && p.ground === o).length;
        for (const ax of ['x', 'y', 'z']) {
          const off = o.pos[ax] - o.base[ax];
          o.vel[ax] += (-6 * off - 2.6 * o.vel[ax]) * dt;
        }
        o.vel.y -= riders * 1.4 * dt;
        if (o.def.floe) this.floeRules(o, dt);
        for (const ax of ['x', 'y', 'z']) {
          o.pos[ax] += o.vel[ax] * dt;
          const off = o.pos[ax] - o.base[ax];
          if (Math.abs(off) > 3) { o.pos[ax] = o.base[ax] + Math.sign(off) * 3; o.vel[ax] *= -0.2; }
        }
      }
      o.dx = o.pos.x - px; o.dz = o.pos.z - pz; o.dy = (o.pos.y + o.h) - top0;
      this.updateSolid(o);
    }
    for (const p of this.players) {
      const o = p.ground;
      if (!p.alive || !o || !o.solid) continue;
      p.pos.x += o.dx; p.pos.y += o.dy; p.pos.z += o.dz;
    }
  }
  refreshSolids() {
    if (!this.level) { this.solids = []; this._solK = null; return; }
    // v1.2.6: rebuilt only when its parts changed (it ran every tick and copied ~1900 boxes on the open world). Every change
    // replaces one of these lists (a wall's b.solids, the barricade list, the level's solids, the props) except tests that
    // push into level.solids, hence its length; the props' own solids are moved in place.
    const L = this.level, B = this.barricades, K = this._solK;
    if (K && K.out === this.solids && K.ls === L.solids && K.n === L.solids.length && K.dyn === this.dyn && K.nd === this.dyn.length && K.bs.length === B.length) {
      let same = true;
      for (let i = 0; i < B.length; i++) if (K.bs[i] !== B[i].solids) { same = false; break; }
      if (same) return;
    }
    this.solids = L.solids.concat(...B.map(b => b.solids), this.dyn.map(o => o.solid));
    this._solK = { out: this.solids, ls: L.solids, n: L.solids.length, dyn: this.dyn, nd: this.dyn.length, bs: B.map(b => b.solids) };
    if (this._wallSrc !== this.level.solids) { this._wallSrc = this.level.solids; this.wallSolids = this.level.solids.filter(s => s.wall); }   // v1.2.6: once per level, not every tick
    if (this.tourn) for (const b of B) for (const q of b.solids) q.arena = b.ownerRef ? b.ownerRef.arena ?? null : null;   // (tournament: walls only stand in their builder's arena)
    if (this.tourn && !this.level.grid) { this.level.grid = buildGrid(L.solids, 4); L.solids.grid = this.level.grid; L.solids.extra = []; }   // (the arena filter works on the grid's extras)
    if (this.level.grid && this.level.grid.n !== L.solids.length) { this.level.grid = buildGrid(L.solids, this.level.open ? 8 : 4); L.solids.grid = this.level.grid; L.solids.extra = []; }   // (tests push boxes in)
    if (this.level.grid) {   // static boxes through the grid, the rest always checked
      this.solids.grid = this.level.grid; this.solids.hAt = this.level.hAt;
      this.solids.extra = this.solids.length > this.level.solids.length ? this.solids.slice(this.level.solids.length) : [];
    }
    if (this.level.side) this.solids.hAt = this.level.hAt;   // 2D side view: no floor (groundBelow over a pit finds nothing)
  }

  // ---- sandbag / concrete walls (unlimited; placed where you aim, long side facing you)
  // A wall can sit at any angle. Physics is axis-aligned boxes, so an angled wall is built from a
  // short row of overlapping boxes along its length. Walls stack: one placed on top of another
  // rests on it, and walls drop down if whatever they stood on is destroyed.
  wallSegments(b) { return wallSegments(b); }   // (physics.js: joiners build the same boxes for prediction)
  // Highest surface under a wall's footprint, ignoring anything above `limit`.
  wallSupport(b, limit, skip, wallLimit = limit) {
    let top = 0;
    const ux = Math.cos(b.ang), uz = Math.sin(b.ang);
    for (let i = -2; i <= 2; i++) {
      const x = b.x + ux * b.len * 0.42 * i / 2, z = b.z + uz * b.len * 0.42 * i / 2;
      for (const s of this.solids) {
        if (s.wall || (skip && s.barricade === skip) || s.noPlayer) continue;
        if (this.tourn && s.arena != null && b.ownerRef && s.arena !== b.ownerRef.arena) continue;   // (another arena's walls)
        if (x > s.min.x && x < s.max.x && z > s.min.z && z < s.max.z && s.max.y <= (s.barricade ? wallLimit : limit) && s.max.y > top) top = s.max.y;
      }
    }
    return top;
  }
  // Wall size by kind. Concrete is a taller, slimmer slab; sandbags are lower and chunkier.
  wallDims(kind, bs) {
    return kind === 'concrete' ? { len: 2.8 * bs, th: 0.7 * bs, h: Math.min(3.2, 1.6 * bs) } : { len: 2.4 * bs, th: 0.8 * bs, h: Math.min(3, 1.2 * bs) };
  }
  // Everything a block deploys goes at fixed distances straight ahead of you, nearest first:
  // turret, then walls (concrete / sandbags / Bastion shield wall), then mines. Each extra kind
  // pushes the ones after it further out. Distances are from your center to the deployable's center.
  planDeploys(p) {
    const s = p.stats, bs = s.blockSize || 1;
    let f = norm({ x: p.aim.x, y: 0, z: p.aim.z }); if (!fin(f.x) || Math.hypot(f.x, f.z) < 0.5) f = { x: 1, y: 0, z: 0 };
    const plan = { f, x: p.pos.x, y: p.pos.y, z: p.pos.z };
    const gap = 0.45;
    let d = PR * p.size + 0.5;
    const walls = [];
    if (s.blockConcrete > 0) walls.push(this.wallDims('concrete', bs).th);
    if (s.blockBarricade > 0) walls.push(this.wallDims('sandbag', bs).th);
    if (p.smod === 'turret') {
      // Turret shield mod, nearest first: concrete / sandbags, then the turret, then the Bastion wall and mines furthest out.
      if (walls.length) { const th = Math.max(...walls); plan.wall = d + th / 2; d += th + gap; }
      const r = PR * this.turretSize(s); plan.turret = d + r; d += 2 * r + gap;
      if (s.blockDeploy > 0) { plan.shield = d + 0.125; d += 0.25 + gap; }
      if (s.blockMines > 0) plan.mine = d + 0.35 * clamp(bs, 0.5, 3);
      return plan;
    }
    if (s.blockDeploy > 0 && p.smod !== 'pillar') walls.push(0.25);
    if (walls.length) { const th = Math.max(...walls); plan.wall = d + th / 2; d += th + gap; }
    if (s.blockMines > 0) plan.mine = d + 0.35 * clamp(bs, 0.5, 3);
    return plan;
  }
  // How many cards you hold that carry this stat (Concrete Barrier / Sandbag Barricade copies multiply their walls).
  cardsWith(p, stat) { return p.cards.filter(id => ((this.cardById.get(id) || {}).modifiers || []).some(m => m.stat === stat)).length; }
  deployPlan(p) { return p.fx.deploy || this.planDeploys(p); }
  // A point `dist` straight ahead along the plan's facing, kept inside the arena.
  // v1.2.8: hl / ht = the deployable's half length (across your aim) and half thickness: it's pushed further out until
  // it clears any Gun Nest turret.
  planSpot(plan, dist, margin = 0.6, hl = 0, ht = 0) {
    let q;
    for (let i = 0; i < 12; i++, dist += 0.35) {
      q = this.clampArena(plan.x + plan.f.x * dist, plan.z + plan.f.z * dist, margin);
      if (!(hl || ht) || !this.mountInRect(q.x, q.z, plan.f, hl, ht)) break;
    }
    return { x: q.x, z: q.z };
  }
  placeWall(p, kind, hp) {
    const bs = p.stats.blockSize || 1, dims = this.wallDims(kind, bs);
    // Each copy of the card multiplies the wall it pours: health x copies, and a longer, taller wall.
    const copies = Math.max(1, this.cardsWith(p, kind === 'concrete' ? 'blockConcrete' : 'blockBarricade'));
    hp *= copies;
    const grow = Math.min(1.8, 1 + 0.2 * (copies - 1)), len = dims.len * grow, th = dims.th, h = Math.min(3.6, dims.h * Math.min(1.4, 1 + 0.1 * (copies - 1)));
    const plan = this.deployPlan(p), f = plan.f;
    const { x, z } = this.planSpot(plan, plan.wall ?? (PR * p.size + 0.5 + th / 2), 0.6, len / 2, th / 2);
    const b = { id: this.nextId++, kind, owner: p.id, ownerRef: p, x, z, y0: 0, len, th, h, ang: Math.atan2(-f.x, f.z), hp, maxHp: hp };
    // (ang is the long axis: perpendicular to where you face, so the widest side covers you)
    // Sits on the ground at your level, or stacks onto walls already standing there (up to ~3.2 m above your feet).
    const lim = plan.y + 0.6;
    b.y0 = this.wallSupport(b, lim, null, plan.y + 3.2);
    b.solids = this.wallSegments(b);
    this.barricades.push(b); this.refreshSolids();
    p.fx.lastWall = { b, t: this.time };
    this.emit({ t: 'barricade', p: p.id, x, y: b.y0, z, kind });
    return b;
  }
  // Back-compat for effects written against the old API.
  addBarricade(p, o) { return this.placeWall(p, o.kind || 'sandbag', o.hp); }
  damageBarricade(b, amt) {
    b.hp -= amt;
    if (b.hp <= 0) {
      this.barricades = this.barricades.filter(q => q !== b); this.refreshSolids();
      this.emit({ t: 'barricadeBreak', x: b.x, y: b.y0 + b.h / 2, z: b.z, p: b.owner, kind: b.kind });
      this.settleWalls();
    }
  }
  settleWalls() {
    let moved = false;
    for (const b of this.barricades.slice().sort((a, c) => a.y0 - c.y0)) {
      if (b.coreProp) continue;   // Core Defense blocks fall on their own (core.js)
      const sup = this.wallSupport(b, b.y0 + 0.05, b);
      if (sup < b.y0 - 0.01) { b.y0 = sup; b.solids = this.wallSegments(b); moved = true; this.refreshSolids(); }
    }
    return moved;
  }
  // ================================================================ shield mods
  // A player is shielded while their block bubble is up. A Turret shield mod turret is shielded while its own bubble has health.
  // (The Pillar Shield is a separate square shield owned by the pillar, see boxCover / shieldCheck.)
  shielded(q) { return q.blockT > 0 || this.turretShieldUp(q); }
  turretShieldUp(q) { const ts = q.fx.tshield; return !!(ts && ts.hp > 0); }
  // Damage that hits a turret's bubble wears it down; when it breaks it recharges (like the Riot Shield).
  soakShield(q, amt) {
    if (amt > 0) this.lastDmgT = this.time;
    const ts = q.fx.tshield;
    if (q.blockT > 0 || !ts || ts.hp <= 0) return;
    ts.hp -= amt; ts.lastHit = this.time;
    if (ts.hp <= 0) { ts.hp = 0; ts.brokenT = this.time + TURRET_SHIELD.recharge; this.emit({ t: 'shieldBreak', p: q.id, x: q.pos.x, y: this.chest(q), z: q.pos.z }); }
  }
  updateTurretShield(q, dt) {
    const ts = q.fx.tshield;
    if (ts.hp <= 0) { if (this.time >= ts.brokenT) { ts.hp = ts.max; this.emit({ t: 'blockOn', p: q.id, x: q.pos.x, y: this.chest(q), z: q.pos.z, deploy: 0, size: q.stats.blockSize }); } }
    else if (ts.hp < ts.max && this.time - (ts.lastHit || 0) > TURRET_SHIELD.delay) ts.hp = Math.min(ts.max, ts.hp + ts.max * TURRET_SHIELD.regen * dt);
  }
  // Pillar Shield: the square shield around a pillar. Is player q inside one that protects them from `attacker`
  // (attack coming from `from`, outside the box)? Returns that shield, or null.
  inBox(s, x, y, z, pad = 0) { return x > s.x - s.w / 2 - pad && x < s.x + s.w / 2 + pad && z > s.z - s.d / 2 - pad && z < s.z + s.d / 2 + pad && y > s.y0 - pad && y < s.y0 + s.h + pad; }
  boxCover(q, from, attacker) {
    for (const s of this.shields) {
      if (!s.box || !(s.hp > 0) || this.isEnemy(s.ownerRef, q) || (attacker && !this.isEnemy(attacker, s.ownerRef))) continue;
      if (this.inBox(s, q.pos.x, this.chest(q), q.pos.z) && !(from && this.inBox(s, from.x, from.y ?? this.chest(q), from.z))) return s;
    }
    return null;
  }
  soakBox(s, amt) {
    if (!(s.hp > 0)) return;
    s.hp -= amt;
    if (s.hp <= 0) { s.hp = 0; this.emit({ t: 'shieldBreak', p: s.owner, x: s.x, y: s.y0 + s.h * 0.7, z: s.z }); }
  }
  // Ends the oldest of a player's units of one kind until fewer than `max` remain.
  capUnits(owner, kind, max, ritual = false) {
    const mine = this.players.filter(u => u.kind === kind && u.ownerId === owner.id && u.alive && !!u.ritual === ritual);
    while (mine.length >= max) this.expireUnit(mine.shift());
  }
  expireUnit(u) {
    if (!u.alive) return;
    u.alive = false; u.hp = 0;
    this.emit({ t: 'unitGone', p: u.id, x: u.pos.x, y: u.pos.y + 0.5 * (u.size || 1), z: u.pos.z });
  }
  // A free spot for a unit near (x,z): not inside any solid, inside the arena. Steps toward (bx,bz) if blocked.
  freeSpot(x, z, bx, bz, r, yRef) {
    const L = this.level;
    for (let i = 0; i <= 14; i++) {
      const k = i / 14, q = this.clampArena(x + (bx - x) * k, z + (bz - z) * k, r + 0.2), cx = q.x, cz = q.z;
      const y = groundBelow(this.solids, cx, cz, yRef + 0.6);
      if (L.side && y < L.side.bottom) continue;   // over a pit
      if (!pointInSolid(this.solids, cx, y + 0.5, cz, r * 0.9) && !this.nearMount(cx, cz, r, y)) return { x: cx, y, z: cz };   // (v1.2.8: never into a Gun Nest turret)
    }
    { const q = this.clampArena(bx, bz, 1); return { x: q.x, y: groundBelow(this.solids, q.x, q.z, yRef + 0.6), z: q.z }; }
  }

  // Clone: the block spawns a copy of you (your stats and cards). Dying with a clone up moves you into it.
  // Every clone splits you: your health (max and current), damage and block stats (not the cooldown) are halved,
  // and the clone gets the same halved numbers. The next clone halves again. Lasts until the round ends.
  // A clone that blocks splits itself the same way: half of its current stats each (no cap on clone count).
  spawnClone(p) {
    const isClone = p.kind === 'clone', owner = isClone ? this.player(p.ownerId) : p;
    if (!owner) return null;
    p.splitK = (p.splitK || 1) * CLONE_SPLIT;
    const hpNow = p.hp;
    if (isClone) applySplit(p.stats, CLONE_SPLIT); else this.recompute(p);
    p.bonusHp = (p.bonusHp || 0) * CLONE_SPLIT;
    p.hp = clamp(hpNow * CLONE_SPLIT, 1, this.maxHp(p));
    p.size = p.fixedSize || sizeFor(this.maxHp(p));
    const f = norm({ x: p.aim.x, y: 0, z: p.aim.z }), side = { x: -f.z, z: f.x };
    let spot = null;
    for (const k of [1, -1]) {
      const x = p.pos.x + side.x * 1.4 * k, z = p.pos.z + side.z * 1.4 * k;
      const s2 = this.freeSpot(x, z, p.pos.x, p.pos.z, PR * p.size, p.pos.y);
      if (Math.hypot(s2.x - p.pos.x, s2.z - p.pos.z) > 0.6) { spot = s2; break; }
    }
    if (!spot) spot = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    const c = this.spawnUnit('clone', owner, spot);
    if (isClone) c.stats = { ...p.stats, revive: 0 };
    c.blockCdT = c.stats.blockCooldown; p.blockCdT = Math.max(p.blockCdT || 0, p.stats.blockCooldown);
    c.aim = { ...p.aim };
    c.splitK = p.splitK; c.bonusHp = p.bonusHp; c.hp = p.hp; c.size = sizeFor(this.maxHp(c));
    c.ammo = Math.min(c.ammo, Math.max(p.ammo, 1));
    this.emit({ t: 'cloneSpawn', p: p.id, c: c.id, x: spot.x, y: spot.y, z: spot.z });
    this.unitsChanged();
    return c;
  }
  // A clone died: the nearest of your remaining bodies (you or another clone) wins back most of what that clone took.
  // splitK is the share of your full stats a body has; it gains CLONE_INHERIT x the dead clone's share (never above full).
  cloneInherit(c) {
    const owner = this.player(c.ownerId);
    if (!owner || !c.splitK) return;
    const bodies = [owner, ...this.players.filter(u => u.kind === 'clone' && u.ownerId === owner.id && u !== c)].filter(u => u.alive && !u.reviving);
    if (!bodies.length) return;
    bodies.sort((a, b) => Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z) - Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z));
    const q = bodies[0], frac = q.hp / Math.max(1, this.maxHp(q));
    q.splitK = Math.min(1, (q.splitK || 1) + c.splitK * CLONE_INHERIT);
    if (q === owner) this.recompute(q);
    else { const base = { ...owner.stats }; applySplit(base, q.splitK / (owner.splitK || 1)); q.stats = { ...base, revive: 0 }; }   // a clone: your stats at its share
    q.hp = Math.max(1, frac * this.maxHp(q)); q.size = q.fixedSize || sizeFor(this.maxHp(q));
    this.emit({ t: 'cloneInherit', p: q.id, x1: c.pos.x, y1: c.pos.y + 0.8, z1: c.pos.z, x2: q.pos.x, y2: q.pos.y + 0.8, z2: q.pos.z });
  }
  swapToClone(t, c) {
    const from = { ...t.pos };
    t.pos = { ...c.pos }; t.vel = { ...c.vel }; t.hp = Math.max(1, c.hp); t.flashT = 0;
    t.fx.burn = null; t.fx.burns = []; t.fx.thrust = null; t.fx.poisonS = null; t.fx.chillT = 0; t.fx.hexT = 0; t.fx.invulnT = this.time + 0.3;
    c.alive = false; c.hp = 0;
    this.emit({ t: 'cloneSwap', p: t.id, x1: from.x, y1: from.y + 0.8, z1: from.z, x2: t.pos.x, y2: t.pos.y + 0.8, z2: t.pos.z });
  }

  // Turret: blocking also places a turret (behind the wall you just dropped, if any). Its numbers come from your block stats.
  turretSize(s) { return clamp(0.7 * Math.sqrt(s.blockSize || 1), 0.5, 1.4); }
  placeTurret(p) {
    const s = p.stats, L = this.level;
    this.capUnits(p, 'blockTurret', 3);
    const plan = this.deployPlan(p), f = plan.f;
    const size = this.turretSize(s), r = PR * size;
    let { x, z } = this.planSpot(plan, plan.turret ?? (PR * p.size + 0.5 + r), r + 0.3, r, r);
    const spot = this.freeSpot(x, z, p.pos.x, p.pos.z, r, Math.max(plan.y, 0));
    const echoes = Math.round(s.blockEcho || 0);
    // The turret fires your gun: your bullet stats and effects (bounces, explosions, poison, napalm...) at a share of your damage.
    // Block-deploy stats are zeroed so a turret never pours its own sandbags, concrete, walls or mines.
    const stats = { ...s,
      health: 70 * (s.blockSize || 1) + 0.15 * (s.blockBarricade || 0) + 0.05 * (s.blockConcrete || 0),
      damage: s.damage * 0.7 * (1 + (s.reflectBoost || 0)),
      projectiles: Math.max(1, Math.round(s.projectiles)) + echoes, spread: Math.max(0.08, s.spread || 0), fireRate: Math.max(1.2, s.fireRate * 0.9), ammo: Math.max(4, Math.round(s.ammo)) + Math.round(s.counterShots || 0),
      reloadTime: s.reloadTime, moveSpeed: 0, jump: 0, blockCooldown: 99, blockSize: clamp(1.25 * (s.blockSize || 1), 0.8, 3.5),
      blockBarricade: 0, blockConcrete: 0, blockDeploy: 0, blockMines: 0, blockEcho: 0, counterShots: 0, blockHeal: 0, blockPush: 0, blockDash: 0, revive: 0, lifeDrain: 0, skyfall: 0 };
    const u = this.spawnUnit('blockTurret', p, spot, { stats, size, life: 6 + 8 * (s.blockDuration || DEFAULT_STATS.blockDuration) });
    if (['flamethrower', 'scattergun', 'grenade', 'beam'].includes(p.mod)) u.mod = p.mod;   // gun mods it can fire
    u.aim = { ...f };
    // Its own block bubble, sized by Block size; health from Block duration (and Block size). Recharges like the Riot Shield.
    const dur = (s.blockDuration || DEFAULT_STATS.blockDuration) / DEFAULT_STATS.blockDuration;
    const shp = Math.round(TURRET_SHIELD.base * Math.pow(dur, 0.75) * Math.sqrt(s.blockSize || 1));
    u.fx.tshield = { hp: shp, max: shp, brokenT: 0, lastHit: 0 };
    this.unitsChanged();
    return u;
  }

  // ---- v1.2.8 Gun Nest shield mod: blocking builds a turret anyone can man with the use key (E). It fires the caster's gun
  // (every bullet stat and effect, gun mods too) twice as fast, and keeps those stats (and its ammo) whoever mans it. Health =
  // the caster's max health; it never heals and slowly wears down. One per player: no new one while yours stands.
  // It goes beside you (not ahead, where walls and mines go), on a clear spot away from walls, shields, mines and bodies.
  placeMount(p) {
    if (p.kind !== 'hero' || this.players.some(u => u.kind === 'mount' && u.alive && u.casterId === p.id)) return null;
    const s = p.stats, r = PR * MOUNT.size, spot = this.mountSpot(p, r);
    if (!spot) return null;
    const stats = { ...s, health: this.mountHealth(p), fireRate: s.fireRate * MOUNT.fireK, moveSpeed: 0, jump: 0, regen: 0, revive: 0, lifeDrain: 0,
      growOnHit: 0, drain: 0, tank: 0, slowField: 0, summonTwin: 0, summonTurret: 0, summonDrone: 0, blockCooldown: 99, blockDeploy: 0, blockBarricade: 0,
      blockConcrete: 0, blockMines: 0, blockEcho: 0, counterShots: 0, blockHeal: 0, blockPush: 0, blockDash: 0, blockShock: 0 };
    const u = this.spawnUnit('mount', p, spot, { stats });
    if (['flamethrower', 'scattergun', 'grenade', 'beam'].includes(p.mod)) u.mod = p.mod;   // gun mods it can fire
    u.anchor = { x: spot.x, z: spot.z }; u.hpCap = u.hp; u.aim = norm({ x: p.aim.x, y: 0, z: p.aim.z });
    this.emit({ t: 'barricade', p: p.id, x: spot.x, y: spot.y, z: spot.z, kind: 'mount' });
    this.unitsChanged();
    return u;
  }
  // v1.2.20 (Devin): turret health scales off the blocking stats: your max health x Block size, Block duration and Block
  // cooldown (shorter = more; measured from the 1.3x cooldown Gun Nest itself gives, so base stats = 1x), from 0.5x to 4x
  mountHealth(p) {
    const s = p.stats, D = DEFAULT_STATS;
    const k = clamp(Math.sqrt(s.blockSize || 1) * Math.pow((s.blockDuration || D.blockDuration) / D.blockDuration, 0.5) * Math.pow(D.blockCooldown * 1.3 / Math.max(0.5, s.blockCooldown || D.blockCooldown), 0.35), 0.5, 4);
    return Math.max(1, Math.round(this.maxHp(p) * k));
  }
  // Beside you first (either side), then behind, then the diagonals, then further out.
  mountSpot(p, r) {
    let f = norm({ x: p.aim.x, y: 0, z: p.aim.z }); if (!fin(f.x) || Math.hypot(f.x, f.z) < 0.5) f = { x: 1, y: 0, z: 0 };
    const sd = { x: -f.z, z: f.x }, h = Math.SQRT1_2, d0 = PR * p.size + r + 0.45;
    const dirs = [sd, { x: -sd.x, z: -sd.z }, { x: (sd.x - f.x) * h, z: (sd.z - f.z) * h }, { x: (-sd.x - f.x) * h, z: (-sd.z - f.z) * h }, { x: -f.x, z: -f.z },
      { x: (sd.x + f.x) * h, z: (sd.z + f.z) * h }, { x: (-sd.x + f.x) * h, z: (-sd.z + f.z) * h }];
    for (const k of [1, 1.5, 2.1, 2.8]) for (const v of dirs) {
      const q = this.clampArena(p.pos.x + v.x * d0 * k, p.pos.z + v.z * d0 * k, r + 0.3);
      const y = groundBelow(this.solids, q.x, q.z, p.pos.y + 0.6);
      if (Math.abs(y - p.pos.y) < 1.3 && this.mountClear(q.x, y, q.z, r, p)) return { x: q.x, y, z: q.z };
    }
    return null;
  }
  mountClear(x, y, z, r, p) {
    const L = this.level;
    if ((L.side && y < L.side.bottom) || (L.lava && y < 0.05)) return false;   // not over a pit or in the lava
    for (const h of [0.3, 0.9, 1.5]) if (pointInSolid(this.solids, x, y + h, z, r)) return false;
    for (const sh of this.shields) {
      if (sh.box ? this.inBox(sh, x, y + 0.8, z, r) : y < sh.y0 + sh.h && y + 1.6 > sh.y0 && (([lx, lz]) => Math.abs(lx) < sh.w / 2 + r && Math.abs(lz) < sh.d / 2 + r)(this.shieldLocal(sh, x, z))) return false;
    }
    for (const q of this.players) if (q !== p && q.alive && Math.hypot(q.pos.x - x, q.pos.z - z) < PR * (q.size || 1) + r + 0.15 && Math.abs(q.pos.y - y) < 2.2) return false;
    for (const m of this.mines) if (Math.hypot(m.x - x, m.z - z) < r + 0.6 && Math.abs(m.y - y) < 1.5) return false;
    for (const d of this.coreDrops || []) if (!d.done && Math.hypot(d.x - x, d.z - z) < r + 1) return false;
    return true;
  }
  // A Gun Nest turret within r (+ its own radius) of (x, z), if any; walls and shields use mountInRect (their footprint, f = facing).
  nearMount(x, z, r, y) { return this.players.find(u => u.kind === 'mount' && u.alive && Math.hypot(u.pos.x - x, u.pos.z - z) < PR * u.size + r && (y == null || Math.abs(u.pos.y - y) < 2.5)) || null; }
  mountInRect(x, z, f, hl, ht) {
    return this.players.some(u => { if (u.kind !== 'mount' || !u.alive) return false; const dx = u.pos.x - x, dz = u.pos.z - z, R = PR * u.size + 0.1;
      return Math.abs(dx * f.z - dz * f.x) < hl + R && Math.abs(dx * f.x + dz * f.z) < ht + R; });
  }
  // (Core Defense props, core.js corePlan) pushes a footprint (half sizes hl x ht, long side at angle ang) off any Gun Nest turret.
  mountNudge(x, z, hl, ht, ang = 0) {
    const f = { x: -Math.sin(ang), z: Math.cos(ang) };
    for (const u of this.players) {
      if (u.kind !== 'mount' || !u.alive) continue;
      const dx = x - u.pos.x, dz = z - u.pos.z, R = PR * u.size + 0.1, lat = dx * f.z - dz * f.x, fwd = dx * f.x + dz * f.z;
      if (Math.abs(lat) >= hl + R || Math.abs(fwd) >= ht + R) continue;
      // out along whichever axis is the shorter way
      if (hl + R - Math.abs(lat) < ht + R - Math.abs(fwd)) { const k = (Math.sign(lat) || 1) * (hl + R) - lat; x += f.z * k; z -= f.x * k; }
      else { const k = (Math.sign(fwd) || 1) * (ht + R) - fwd; x += f.x * k; z += f.z * k; }
    }
    return { x, z };
  }
  // The use key: man the nearest free Gun Nest turret in reach, or get off the one you're on. (Eats the press so Core
  // Defense doesn't also pick up a prop, nor the open world a vehicle.)
  mountUse(p) {
    const u = p.input.useSeq | 0, f = p.fx;
    if (f.mUse === undefined) { f.mUse = u; return; }
    if (u === f.mUse) return;
    f.mUse = u;
    if (f.mount) { this.dismount(p); this.eatUse(p, u); return; }
    if (p.carry || p.veh || (p.ow && p.ow.st !== 'ground') || (this.phase !== 'play' && this.phase !== 'countdown')) return;
    const t = this.mountNear(p);
    if (t) { this.eatUse(p, u); this.mountOn(p, t); }
  }
  eatUse(p, u) { p.lastUseSeq = u; if (p.ow) p.ow.useSeq = u; }
  mountNear(p) {
    let best = null, bd = Infinity;
    for (const u of this.players) {
      if (u.kind !== 'mount' || !u.alive || this.mountRider(u) || Math.abs(u.pos.y - p.pos.y) > 1.6) continue;
      const d = Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z) - PR * (u.size + p.size);
      if (d < MOUNT.reach && d < bd) { bd = d; best = u; }
    }
    return best;
  }
  mountRider(u) { const r = u.riderId ? this.player(u.riderId) : null; return r && r.alive && r.fx.mount && r.fx.mount.id === u.id ? r : null; }
  // Whoever mans it owns it for now: its shots are theirs (team, kills, who they can hurt). Back to the caster when they get off.
  mountOn(p, u) {
    p.fx.mount = { id: u.id, x: p.pos.x, z: p.pos.z, real: null }; p.encoreQ = null;
    u.riderId = p.id; u.lastShotSeq = p.input.shotSeq | 0; u.lastReloadSeq = p.input.reloadSeq | 0; u.input.shoot = false;
    if (u.ownerId !== p.id || u.team !== p.team) { u.ownerId = p.id; u.team = p.team; this.unitsChanged(); }
    this.emit({ t: 'mount', p: p.id, u: u.id, on: 1 });
  }
  dismount(p) {
    const m = p.fx.mount; if (!m) return;
    p.fx.mount = null;
    const u = this.player(m.id);
    if (u && u.riderId === p.id) {
      u.riderId = null; u.input.shoot = false;
      const c = this.player(u.casterId);
      if (u.ownerId !== u.casterId || (c && u.team !== c.team)) { u.ownerId = u.casterId; if (c) u.team = c.team; this.unitsChanged(); }
    }
    this.emit({ t: 'mount', p: p.id, u: m.id, on: 0 });
  }
  // A rider stands still and can't fire their own gun (the trigger works the turret); blocking still works.
  riderInput(p) {
    const m = p.fx.mount, u = this.player(m.id);
    if (!u || !u.alive || u.riderId !== p.id || !p.alive || p.reviving || p.veh || p.carry) { this.dismount(p); return null; }
    const real = p.input;
    p.input = { ...real, mx: 0, mz: 0, jump: false, shoot: false, drop: false, crouch: false };
    p.lastShotSeq = real.shotSeq | 0; p.fx.jSeq = real.jumpSeq | 0; p.fx.jBuf = -9;
    m.real = real;
    return real;
  }
  riderPin(p) {
    const m = p.fx.mount; if (!m) return;
    m.real = null; p.pos.x = m.x; p.pos.z = m.z; p.vel.x = 0; p.vel.z = 0;
    if (p.fx.thrust) p.fx.thrust.t = 0;
  }
  // The turret itself: bolted down, never heals, wears down; aims at the rider's crosshair and fires on their trigger.
  mountThink(u, dt) {
    if (u.anchor) { u.pos.x = u.anchor.x; u.pos.z = u.anchor.z; }
    u.vel.x = 0; u.vel.z = 0;
    u.hpCap = Math.min(u.hpCap ?? u.hp, u.hp);
    if (this.phase === 'play') u.hpCap -= this.maxHp(u) * MOUNT.decay * dt;
    u.hp = Math.min(u.hp, u.hpCap);
    if (u.hp <= 0) { this.expireUnit(u); return; }
    const inp = u.input, r = this.mountRider(u);
    inp.mx = 0; inp.mz = 0; inp.jump = false; inp.block = false;
    if (!r) { inp.shoot = false; return; }
    const ri = r.fx.mount.real || r.input, ap = r.aimPoint, o = { x: u.pos.x, y: this.chest(u), z: u.pos.z };
    inp.shoot = !!ri.shoot; inp.shotSeq = ri.shotSeq | 0; inp.reloadSeq = ri.reloadSeq | 0;
    let a = ap && fin(ap.x) && Math.hypot(ap.x - o.x, ap.z - o.z) > 0.8 ? norm({ x: ap.x - o.x, y: ap.y - o.y, z: ap.z - o.z }) : r.aim;
    if (this.level.side) a = norm({ x: a.x, y: a.y, z: 0 });
    inp.aim = a; inp.aimPoint = ap ? { ...ap } : null;
  }

  // Pillar Shield: a pillar rises under you, boxed in by a square shield that belongs to the pillar (not to you).
  // The shield lines up with the pillar's walls and lasts until it has soaked its health or the pillar goes.
  pillarShieldTop(p) { return Math.min(3.2, PH * (p.size || 1) + 0.5); }   // how far the box reaches above the pillar top
  raisePillar(p) {
    const s = p.stats, L = this.level;
    const old = this.barricades.filter(b => b.kind === 'pillar' && b.owner === p.id);
    if (old.length) { this.barricades = this.barricades.filter(b => !old.includes(b)); this.refreshSolids(); this.settleWalls(); }
    this.shields = this.shields.filter(q => !(q.box && q.owner === p.id));
    const bs = s.blockSize || 1;
    const w = Math.max(2.2, 2 * PR * p.size + 1.2) * clamp(Math.sqrt(bs), 0.85, 1.8);   // wide enough to move around on; grows with Block size
    const { x, z } = this.clampArena(p.pos.x, p.pos.z, w / 2);
    let y0 = groundBelow(this.solids, x, z, p.pos.y + 0.05);
    // v28: over a pit / off the stage (Brawl's Siege Knight), the pillar starts under your feet instead of from the void (which dragged you down to it)
    if (!(y0 > p.pos.y - 8) || (L.side && L.hAt && y0 <= L.hAt(x, z) + 1)) y0 = p.pos.y - 0.05;
    const b = { id: this.nextId++, kind: 'pillar', owner: p.id, ownerRef: p, x, z, y0, len: w, th: w, h: 0.05, hMax: RULES.tierHeights[2] * 2, ang: 0, hp: 400, maxHp: 400, grow: true };   // v1.2.22 (Devin): taller (x2 tier, was x1.4)
    b.solids = this.wallSegments(b);
    this.barricades.push(b); this.refreshSolids();
    const pool = Math.round(PILLAR_SHIELD * Math.pow(bs, 1.3) * ((s.blockDuration || DEFAULT_STATS.blockDuration) / DEFAULT_STATS.blockDuration));
    const W = w + 0.4;
    // v1.2.22 (Devin): the shield only wraps the top of the pillar (where you stand), from just under its top edge up
    this.shields.push({ id: this.nextId++, owner: p.id, ownerRef: p, box: true, pillar: b, x, z, y0: y0 + b.h - PILLAR_LIP, w: W, d: W, h: PILLAR_LIP + this.pillarShieldTop(p), t: Infinity,
      hp: pool, maxHp: pool, shock: 0, leech: s.blockLeech > 0 ? 1 : 0 });
    // stand on it right away, so the rising pillar lifts you instead of shoving you aside
    if (Math.abs(p.pos.x - x) < w / 2 && Math.abs(p.pos.z - z) < w / 2) { p.pos.y = y0 + b.h; p.vel.y = Math.max(0, p.vel.y); p.onGround = true; }
    this.emit({ t: 'barricade', p: p.id, x, y: y0, z, kind: 'pillar' });
  }
  updatePillars(dt) {
    for (const b of this.barricades) {
      if (!b.grow) continue;
      const h0 = b.h;
      b.h = Math.min(b.hMax, b.h + dt * 5);
      if (b.h >= b.hMax) b.grow = false;
      b.solids = this.wallSegments(b);
      // lift anyone standing on the footprint
      for (const q of this.players) {
        if (!q.alive || q.flying) continue;
        if (Math.abs(q.pos.x - b.x) < b.len / 2 && Math.abs(q.pos.z - b.z) < b.th / 2 && q.pos.y >= b.y0 - 0.1 && q.pos.y < b.y0 + b.h + 0.05 && q.pos.y >= b.y0 + h0 - 0.3) {
          q.pos.y = b.y0 + b.h; q.vel.y = Math.max(0, q.vel.y); q.onGround = true;
        }
      }
    }
    if (this.barricades.some(b => b.kind === 'pillar')) this.refreshSolids();
    // the square shield follows its pillar's height
    for (const s of this.shields) if (s.box && s.pillar) { s.y0 = s.pillar.y0 + s.pillar.h - PILLAR_LIP; s.h = PILLAR_LIP + this.pillarShieldTop(s.ownerRef); }
  }

  // Rewind Blink: blocking jumps you back to where you were REWIND_T seconds ago, and heals you back up to the health you had then.
  recordHistory(p) {
    const h = p.fx.hist = p.fx.hist || [];
    if (!h.length || this.time - h[h.length - 1].t >= 0.05) h.push({ t: this.time, x: p.pos.x, y: p.pos.y, z: p.pos.z, hp: p.hp });
    while (h.length && h[0].t < this.time - REWIND_T - 1) h.shift();
  }
  rewindBlink(p) {
    const h = p.fx.hist || [];
    if (!h.length) return;
    const goal = this.time - REWIND_T;
    let i = 0;
    for (let k = 0; k < h.length; k++) if (h[k].t <= goal) i = k;
    for (; i < h.length; i++) {   // walls may have been built there since: take the first clear spot
      const e = h[i];
      if (pointInSolid(this.solids, e.x, e.y + 0.75 * p.size, e.z, PR * p.size * 0.9)) continue;
      const from = { ...p.pos };
      p.pos = { x: e.x, y: e.y, z: e.z }; p.vel = { x: 0, y: 0, z: 0 };
      const hp = Math.min(this.maxHp(p), e.hp ?? p.hp);
      if (hp > p.hp) { const h0 = p.hp; p.hp = hp; this.healPing(p, h0); }
      this.emit({ t: 'rewind', p: p.id, x1: from.x, y1: from.y + 0.8, z1: from.z, x2: e.x, y2: e.y + 0.8, z2: e.z });
      return;
    }
  }

  // Bullet Catcher: enemy bullets that reach your bubble are held, then fired at the nearest enemy when it drops.
  catchBullet(b, q) {
    this.blockedDamage(q, b.dmg);
    b.caught = q; b.caughtSpeed = Math.max(len(b.vel), 20); b.caughtAng = Math.random() * Math.PI * 2; b.vel = { x: 0, y: 0, z: 0 };
    b.homeTgt = null; b.lock = null; b.hold = null;
    this.emit({ t: 'block', p: q.id, x: b.pos.x, y: b.pos.y, z: b.pos.z });
  }
  holdCaught(b, dt) {
    const q = b.caught;
    if (q.alive && !q.reviving && q.blockT > 0) {
      b.caughtAng += dt * 5;
      const R = 1.2 * (q.stats.blockSize || 1) * q.size;
      b.pos = { x: q.pos.x + Math.cos(b.caughtAng) * R, y: q.pos.y + 0.8 * q.size + Math.sin(b.caughtAng * 1.7) * 0.35, z: q.pos.z + Math.sin(b.caughtAng) * R };
      return true;
    }
    if (!b.relN) {   // number this release's bullets, so untargeted ones fan out evenly
      const batch = this.bullets.filter(x => x.caught === q && x.alive !== false), base = Math.atan2(q.aim.z, q.aim.x);
      batch.forEach((x, i) => { x.relN = batch.length; x.relA = base + i * Math.PI * 2 / batch.length; });
    }
    b.caught = null;
    if (!q.alive || q.reviving) { this.killBullet(b, false); return true; }
    // released: it's yours now, aimed at the nearest enemy you can see within range; with none, the catch fans out in a ring
    b.owner = q.id; b.ownerRef = q; b.bounced = false; b.aiSeen = {}; b.dmg *= CATCHER.dmgMul; b.bankTgt = null; b.life = Math.max(b.life, 3);
    const t = this.homingTarget(b, CATCHER.range);
    const sp = Math.max(b.caughtSpeed, q.stats.bulletSpeed);
    b.vel = this.aimVel(b.pos, t, { x: Math.cos(b.relA || 0), y: 0.02, z: Math.sin(b.relA || 0) }, sp, b.grav);
    return false;
  }
  // Velocity that sends a bullet from `from` at target t's chest (allowing for drop), or along `fallback`.
  aimVel(from, t, fallback, sp, grav) {
    let d;
    if (t) {
      const c = { x: t.pos.x, y: this.chest(t), z: t.pos.z }, dist = Math.hypot(c.x - from.x, c.y - from.y, c.z - from.z), tt = dist / sp;
      d = norm({ x: c.x - from.x, y: c.y - from.y + 0.5 * (grav ?? RULES.bulletGravity) * tt * tt, z: c.z - from.z });
    } else d = norm(fallback);
    return { x: d.x * sp, y: d.y * sp, z: d.z * sp };
  }

  // Ground Slam: when you land after the block's leap, a shockwave hits everyone nearby.
  groundSlam(p) {
    const s = p.stats, R = 3.2 * (s.blockSize || 1), dmg = SLAM.base + SLAM.dmgShare * this.effDamage(s);
    this.emit({ t: 'slam', p: p.id, x: p.pos.x, y: p.pos.y + 0.1, z: p.pos.z, r: R });
    for (const q of this.players) {
      if (!q.alive || q.reviving || !this.isEnemy(p, q)) continue;
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > R + PR * q.size || Math.abs(q.pos.y - p.pos.y) > 2) continue;
      const dir = d > 0.01 ? { x: dx / d, y: 0, z: dz / d } : { x: 1, y: 0, z: 0 };
      const box = this.boxCover(q, { x: p.pos.x, y: p.pos.y + 0.3, z: p.pos.z }, p);
      if (box) this.soakBox(box, dmg);
      else if (this.shielded(q)) { this.blockedDamage(q, dmg); this.soakShield(q, dmg); }
      else this.hurt(q, dmg, p, dir);
      const k = (10 + (s.blockPush || 0) * 0.6) * (1 - 0.5 * Math.min(1, d / R)) / q.size;
      q.vel.x += dir.x * k; q.vel.z += dir.z * k; q.vel.y += 6 / q.size;
    }
    for (const o of this.dyn) {
      const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d < R + 1) this.impulse(o, { x: dx / (d || 1) * 6, y: 4, z: dz / (d || 1) * 6 });
    }
  }

  // Critter weapon mod: each shot sends a critter in your color at the nearest enemy.
  // Speed = 60% of your bullet speed, bite = your bullet damage, health = 10% of your health.
  // At the cap the oldest one is replaced, and only the shooter gets a "max critters" notice.
  critterCount(p) { let n = 0; for (const u of this.players) if (u.kind === 'critter' && u.ownerId === p.id && u.alive && !u.ritual) n++; return n; }
  // at: spawn point for Pentagram portal critters (they don't count toward the Critter mod's cap, and have their own).
  spawnCritter(p, off, at = null) {
    const s = p.stats, L = this.level;
    if (at) this.capUnits(p, 'critter', RITUAL_CRITTER_MAX, true);
    else {
      if (this.critterCount(p) >= CRITTER_MAX && !((p.fx.critMaxT || 0) > this.time)) {
        p.fx.critMaxT = this.time + 1.2;
        this.emit({ t: 'critterMax', p: p.id, n: CRITTER_MAX });
      }
      this.capUnits(p, 'critter', CRITTER_MAX);
    }
    let f = norm({ x: p.aim.x, y: 0, z: p.aim.z });
    const size = 0.5, ox = at ? at.x : p.pos.x, oz = at ? at.z : p.pos.z, oy = at ? at.y : p.pos.y;
    if (at) { const a = Math.random() * Math.PI * 2; f = { x: Math.cos(a), y: 0, z: Math.sin(a) }; }
    const x = clamp(ox + f.x * (at ? 0.4 : 0.9 * p.size) - f.z * off, -L.hx + 0.5, L.hx - 0.5), z = clamp(oz + f.z * (at ? 0.4 : 0.9 * p.size) + f.x * off, -L.hz + 0.5, L.hz - 0.5);
    const spd = clamp(s.bulletSpeed * CRITTER_SPEED, 10, 24) / speedFor(size);   // final running speed after the small-size bonus
    const stats = { ...DEFAULT_STATS, health: Math.max(5, 0.1 * this.maxHp(p)), damage: 0, moveSpeed: spd, jump: 8, blockCooldown: 99 };
    const spot = this.freeSpot(x, z, ox, oz, PR * size, oy);
    const c = this.spawnUnit('critter', p, { x: spot.x, y: Math.max(spot.y, oy), z: spot.z }, { stats, melee: this.effDamage(s) });
    c.vel = { x: f.x * spd * 0.5, y: at ? 5 : 2, z: f.z * spd * 0.5 }; c.aim = { ...f };
    if (at) { c.ritual = true; c.lifeT = RITUAL.critterLife; }
    return c;
  }

  // ---- deployable shield walls (Bastion Wall card): reflect bullets, players walk through
  // Like sandbags and concrete, the wall faces wherever you aim (any angle, not snapped to the grid):
  // w runs along its long axis (angle ang), d is its thickness.
  deployShield(p) {
    const s = p.stats, W = 2.6 * s.blockSize, T = 0.25;
    const plan = this.deployPlan(p), f = plan.f, { x, z } = this.planSpot(plan, plan.shield ?? plan.wall ?? 1.4, 1, W / 2, T / 2);
    const mine = this.shields.filter(q => q.owner === p.id && !q.box);
    if (mine.length >= 5) this.shields = this.shields.filter(q => q !== mine[0]);   // v1.2.9 (Devin): several walls can stand at once (up to 5; the oldest goes)
    this.shields.push({ id: this.nextId++, owner: p.id, ownerRef: p, x, z, y0: p.pos.y, w: W, d: T, ang: Math.atan2(-f.x, f.z), h: 1.9 * s.blockSize, t: 2.5 + s.blockDuration * 3,
      shock: s.blockShock > 0 ? 1 : 0, leech: s.blockLeech > 0 ? 1 : 0 });
  }
  // A point in a shield wall's own frame: [along its length, through its thickness].
  isTurret(q) { return !!q && (q.kind === 'blockTurret' || q.kind === 'turret' || q.kind === 'hazardTurret' || q.kind === 'mount'); }
  // turrets can't shoot through deployables (any walls or bastion shields, friendly ones included)
  deployBlocked(a, b) {
    if (segBlocked(this.solids, a, b, s => !s.barricade)) return true;
    if (!this.shields.length) return false;
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.35));
    for (const sh of this.shields) {
      if (!(sh.hp > 0)) continue;
      for (let i = 1; i < n; i++) {
        const k = i / n, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
        if (y < sh.y0 || y > sh.y0 + sh.h) continue;
        if (sh.box ? this.inBox(sh, x, y, z) : (([lx, lz]) => Math.abs(lx) < sh.w / 2 && Math.abs(lz) < sh.d / 2)(this.shieldLocal(sh, x, z))) return true;
      }
    }
    return false;
  }
  shieldLocal(sh, x, z) { const c = Math.cos(sh.ang || 0), sn = Math.sin(sh.ang || 0), dx = x - sh.x, dz = z - sh.z; return [dx * c + dz * sn, -dx * sn + dz * c]; }
  // ---- mines (Mine Layer card)
  addMine(p, x, y, z) {
    const u = this.nearMount(x, z, 0.5, y);   // v1.2.8: a mine meant for a Gun Nest turret's spot goes down just beside it
    if (u) { const dx = x - u.pos.x, dz = z - u.pos.z, d = Math.hypot(dx, dz) || 1, k = PR * u.size + 0.55; x = u.pos.x + (d > 0.01 ? dx / d : 1) * k; z = u.pos.z + (d > 0.01 ? dz / d : 0) * k; }
    const mine = this.mines.filter(m => m.owner === p.id && !m.snare);
    if (mine.length >= 8) this.mines = this.mines.filter(m => m !== mine[0]);
    const s = p.stats;
    this.mines.push({ id: this.nextId++, owner: p.id, ownerRef: p, x, y, z, armT: 0.7, life: 25, dmg: this.effDamage(s),
      explosive: s.explosive, knockback: s.knockback, sz: clamp(s.blockSize || 1, 0.5, 3) });
    this.emit({ t: 'mine', p: p.id, x, y, z });
  }
  updateMines(dt) {
    for (const m of this.mines) {
      m.armT -= dt; m.life -= dt;
      if (m.life <= 0) { m.dead = true; continue; }
      if (m.snare) { this.snareCheck(m); continue; }   // v1.2.15 Snare Plate
      for (const q of this.players) {
        if (!q.alive || q.reviving || q.flying) continue;
        if (q === m.ownerRef && m.armT > 0) continue;
        if (Math.hypot(q.pos.x - m.x, q.pos.z - m.z) < 0.85 * q.size + 0.2 * (m.sz || 1) + 0.3 * ((m.sz || 1) - 1) && Math.abs(q.pos.y - m.y) < 1) {
          m.dead = true;
          this.explode({ x: m.x, y: m.y + 0.3, z: m.z }, m.dmg, m.ownerRef, { full: true, selfHurt: true, extra: Math.max(0, Math.round(m.explosive) - 1), knock: m.knockback });
          break;
        }
      }
    }
    this.mines = this.mines.filter(m => !m.dead);
  }
  // ---- healing fields (Mending Field card)
  addField(p, heal, radius) {
    this.fields.push({ x: p.pos.x, y: p.pos.y, z: p.pos.z, t: 1.0, heal, r: radius, ownerRef: p });
    this.emit({ t: 'fieldSpawn', p: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, r: radius });
  }
  updateFields(dt) {
    for (const f of this.fields) {
      f.t -= dt;
      if (f.t > 0) continue;
      f.dead = true;
      for (const q of this.players) {
        if (!q.alive || q.reviving || this.isEnemy(f.ownerRef, q)) continue;
        if (Math.hypot(q.pos.x - f.x, q.pos.z - f.z) < f.r && Math.abs(q.pos.y - f.y) < 2.5) { const h0 = q.hp; q.hp = Math.min(this.maxHp(q), q.hp + f.heal); this.healPing(q, h0); }
      }
      this.emit({ t: 'fieldPulse', x: f.x, y: f.y, z: f.z, r: f.r });
    }
    this.fields = this.fields.filter(f => !f.dead);
  }

  // ------------------------------------------------------------ main loop
  step(dt) {
    this._inStep = true;
    const t0 = performance.now();
    try { this.step0(dt); } finally { this._inStep = false; }
    budgetTick(this, dt, performance.now() - t0);   // v1.2.25 entity / bullet budget (budget.js)
  }
  step0(dt) {
    this.stepDt = dt; this.stepN++;
    if (this.phase === 'countdown' && this.tourn && this.phaseT > (RULES.countdown || 3) + 0.2) {
      // v1.2.29 (Devin): the tournament matchup screen holds the world still (no health drain, burns, regen, timers)
      this.phaseT -= dt;
      const humans = this.heroes().filter(p => p.connected && !p.isBot && !p.tko);
      if (humans.length && humans.every(p => p.input.ready === this.round)) { this.phaseT = 3.2; this.emit({ t: 'tGo' }); }
      return;
    }
    if (this.phase === 'countdown') {
      this.phaseT -= dt; this.time += dt;
      const c = Math.ceil(this.phaseT);
      if (c !== this.lastCount && c > 0) { this.lastCount = c; this.emit({ t: 'count', n: c }); }
      if (this.phaseT <= 0 && !this.fightSent) { this.fightSent = true; this.lastCount = null; this.emit({ t: 'fight' }); }
      if (this.phaseT <= 0) { this.phase = 'play'; this.fightAt = this.time; }
      this.updateDynamics(dt); this.refreshSolids();
      if (this.ow) owTick(this, dt);
      if (this.settings.core) coreTick(this, dt);   // build phase: drops keep falling, you can carry and place
      if (this.settings.core && this.phaseT > 3.2) {   // v28: once every player is ready (Enter; again to unready) the wave comes early
        const humans = this.heroes().filter(p => p.connected && !p.isBot);
        for (const p of this.heroes()) p.coreReady = p.connected && (p.isBot || p.input.ready === this.round);
        if (humans.length && humans.every(p => p.coreReady)) { this.phaseT = 3.2; this.emit({ t: 'coreGo' }); }
      }
      if (this.corePending && this.phaseT <= 2.5) { const a = this.corePending; this.corePending = null; this.refreshSolids(); this.spawnPlannedWave(...a); this.unitsChanged(); this.emit({ t: 'coreIncoming', boss: this.boss ? this.boss.name : null }); for (const u of this.players) if (u.kind === 'elite' && u.alive) this.announceElite(u); }
      this.updatePlayers(dt, false);
    } else if (this.phase === 'play' || this.phase === 'roundEnd') {
      this.time += dt;
      this.updateDynamics(dt); this.refreshSolids();
      this.updatePlayers(dt, true);
      this.updateBullets(dt);
      this.updateMines(dt); this.updateFires(dt); this.updateClouds(dt); this.updateFields(dt); this.updateBooms(dt); this.updateShields(dt); this.updatePillars(dt);
      this.updateRituals(dt); this.updateRelics(dt); this.updateWells(dt);
      this.updateHazard(dt); this.updateTraps();
      if (this.isWaves() || this.telegraphs.length || this.shockwaves.length) coopTick(this, dt);   // Space King's ally boss casts in any mode
      if (this.settings.core) coreTick(this, dt);
      if (this.ow) owTick(this, dt);
      if (SIDE_ON) for (const p of this.players) { p.pos.z = 0; p.vel.z = 0; }   // 2D side view: nothing leaves the play plane
      this.pruneUnits();
      // Overtime: if a round drags past 100 s, everyone slowly loses health so it can't stall forever.
      if (this.isPractice()) this.practiceTick(dt);
      else if (BRAWL_ON) brawlTick(this, dt);   // brawl: damage %, respawns and its own sudden death
      else if (this.phase === 'play' && !this.ow && !this.settings.core && this.time > (this.isWaves() ? 150 : 100) && !(this.boss && this.boss.alive)) {   // never during the boss fight
        if (!this.overtime) { this.overtime = true; this.overtimeAt = this.time; this.emit({ t: 'overtime' }); }
        this.suddenMul();
        for (const p of this.players) if (p.alive && !p.reviving && p.kind !== 'hazardTurret') { p.hp -= 4 * dt; if (p.hp <= 0) { p.hp = 0.01; this.hurt(p, 1, null, null); } }
      }
      if (this.isPractice()) { /* the practice range never ends a round */ }
      else if (this.phase === 'play') this.checkRoundEnd();
      else { this.phaseT -= dt; if (this.phaseT <= 0) this.afterRound(); }
    } else if (this.phase === 'picking') {
      // Every picker has their own timer (late joiners catching up get 50% longer, Speed mode resets it per pick).
      let longest = 0;
      for (const p of this.players.slice()) {
        if (this.phase !== 'picking') break;
        if (p.picked || !p.connected) continue;
        if (p.offer && p.isBot) { p.pickDelay -= dt; if (p.pickDelay <= 0) { this.pick(p.id, p.offer[Math.floor(Math.random() * p.offer.length)]); continue; } }
        p.pickT -= dt;
        if (p.pickT <= 0) {
          if (p.awaitCombo) this.comboChoice(p.id, true);
          else if (p.awaitBreak) this.breakChoice(p.id, p.awaitBreak[0]);
          else if (p.offer) this.pick(p.id, p.offer[Math.floor(Math.random() * p.offer.length)]);
          else { p.picked = true; this.maybeFinishPicking(); }
        } else longest = Math.max(longest, p.pickT);
      }
      if (this.phase === 'picking') this.phaseT = longest;
    }
    if (this.unitsEv) this.closeUnits();   // v1.2.6: one roster per step at most (see unitsChanged)
    else if (this.unitsGone && this.unitsAt !== this.stepN) { this.unitsChanged(); this.closeUnits(); }
  }

  // Critters, block turrets and clones leave the player list as soon as they're gone.
  pruneUnits() {
    if (!this.players.some(p => p.ephemeral && !p.alive)) return;
    this.unitsRemoved();
    this.players = this.players.filter(p => !(p.ephemeral && !p.alive));
  }
  updatePlayers(dt, canAct) {
    for (const p of this.players) {
      if (!p.alive) continue;
      if (this.tourn) PA.a = p.arena ?? null;   // (v1.2.26: only your own arena's walls)
      if (p.lifeT != null && canAct) { p.lifeT -= dt; if (p.lifeT <= 0) { this.expireUnit(p); continue; } }
      if (p.reviving) { this.updateReviving(p, dt); continue; }
      if (p.kind === 'hero') this.mountUse(p);   // v1.2.8 Gun Nest: E mans / leaves a turret
      const real = p.fx.mount ? this.riderInput(p) : null;
      if (p.dummy) this.dummyThink(p, dt);
      else if (p.kind === 'boss') bossThink(this, p, dt);
      else if (p.kind === 'portal') portalThink(this, p, dt);
      else if (p.kind === 'angel') { this.angelThink(p, dt); continue; }
      else if (p.kind === 'decoy') { /* v1.2.15 Afterimage: stands still where you blocked */ }
      else if (p.kind === 'mount') { this.mountThink(p, dt); if (!p.alive) continue; }
      else if (p.isBot || p.commanded) (this.ow ? owBotThink : botThink)(this, p, dt);
      this.updatePlayer(p, dt, canAct);
      if (real) { p.input = real; this.riderPin(p); }
    }
    PA.a = null;
  }

  updateReviving(p, dt) {
    p.reviveT -= dt; p.vel = { x: 0, y: 0, z: 0 };
    if (p.reviveT > 0) return;
    p.reviving = false;
    p.hp = Math.max(1, this.maxHp(p) * Math.min(1, p.fx.reviveFrac || 0.5));
    p.blockT = 1; p.blockExtra = RULES.blockMaxExtra;   // (v1.2.13: a one-second shield, like any spawn)
    this.emit({ t: 'revive', p: p.id, x: p.pos.x, y: p.pos.y + 0.8, z: p.pos.z });
  }

  updatePlayer(p, dt, canAct) {
    const s = p.stats, inp = p.input, L = this.level;
    p.size = p.fixedSize || sizeFor(this.maxHp(p));
    // Open world: riding the bus, falling or parachuting (no walking, shooting or blocking until you land).
    if (p.ow && p.ow.st !== 'ground' && owAir(this, p, dt, canAct, (q, h) => movePlayer(q, h, L, this.solids))) { p.fireT -= dt; p.flashT -= dt; this.updateStatus(p, dt); p.fx.jSeq = inp.jumpSeq | 0; p.lastShotSeq = inp.shotSeq | 0; return; }
    if (p.veh && p.veh.hp != null) canAct = false;   // in a car: no shooting or blocking (the car soaks your damage instead)
    // Hair / Pentagram shield mods: holding block charges them, and you can't move, jump or shoot meanwhile.
    p.fx.hold = canAct && !!inp.block && this.canHoldCharge(p);
    const hold = p.fx.hold;
    if (p.smod === 'spaceking' && !hold && p.fx.king > 0) p.fx.king = Math.max(0, p.fx.king - dt * KING.decay / KING.time);   // let go: the charge drains back
    const slamAir = !!(p.fx.slam && !p.onGround);   // Ground Slam leap: faster, tighter air steering
    // Open world: crouching (on foot, on the ground) walks slower and halves how far roaming bots spot you.
    p.crouch = !!(this.ow && inp.crouch && !p.veh && p.onGround && p.kind === 'hero');
    // v1.0.1: crouching also makes your body (and hitbox) smaller, capped so even big builds fit up building stairs
    if (p.crouch) p.size = Math.min(p.size * OW.crouch.body, OW.crouch.maxSize);
    const spd = this.walkSpeed(p) * (slamAir ? SLAM.airSpeed : 1) * this.dirSpeedK(p, inp.mx, inp.mz);
    // Countdown: nobody moves until it ends, except in co-op waves (prep time, but stay near your spawn).
    const frozen = (this.phase === 'countdown' && !this.isWaves()) || (p.fx.rootT || 0) > this.time;   // (v1.2.15: Snare Plate roots too)
    if (frozen) { p.vel.x = 0; p.vel.z = 0; if (p.fx.thrust) p.fx.thrust.t = 0; }   // the countdown locks everyone in place
    const bHold = BRAWL_ON && p.kind === 'hero' ? brawlMove(this, p, inp, dt, frozen) : 0;   // brawl: 1 = hanging on a ledge or floating in to respawn, 2 = charging or doing the air dash
    if (bHold) canAct = false;
    const th = this.thrustVel(p, dt);
    if (p.veh) owDrive(this, p, dt, hold || frozen);   // open world: riding a scooter, bike or car
    else if (!bHold) accel(p, (hold || frozen ? 0 : inp.mx * spd) + th.x, (hold || frozen ? 0 : inp.mz * spd) + th.z, (slamAir ? dt * SLAM.airControl : dt) * (BRAWL_ON && (p.fx.launchT || 0) > this.time ? BRAWL.launchCtl : 1) * (L.ice && p.onGround && p.ground && p.ground.def && p.ground.def.floe ? ICE.slip : 1));   // ice floes: you slide
    if (p.flying) { p.pos.y += (this.flyHeight + (p.flyUp || 0) - p.pos.y) * Math.min(1, dt * 4); p.vel.y = 0; }
    if (p.dropThru > 0) p.dropThru -= dt;
    if (BRAWL_ON && p.onGround) p.fx.airJ = BRAWL.airJumps;   // landed: double jump back (before a jump this tick takes you off the ground)
    // v1.2.0 jump feel: a press up to 0.13 s before landing still jumps (buffer), and you can still jump for
    // 0.1 s after running off a ledge (coyote time). p.fx.airT = seconds since last on the ground (9 after a jump).
    if (inp.jump && !p.fx.jPrev) p.fx.jBuf = this.time;
    p.fx.jPrev = !!inp.jump;
    const js = inp.jumpSeq | 0;   // v1.2.6: a jump press that came and went between two steps (or a lost packet) still buffers a jump
    if (p.fx.jSeq === undefined) p.fx.jSeq = js;
    if (js !== p.fx.jSeq) { p.fx.jSeq = js; p.fx.jBuf = this.time; if ((p.fx.sqOnT || 0) > this.time) (p.fx.mash || (p.fx.mash = [])).push(this.time); }   // v1.2.22: mashing jump shakes off squid
    if (p.onGround) p.fx.airT = 0; else if (p.fx.airT !== 9) p.fx.airT = (p.fx.airT || 0) + dt;
    const wantJump = inp.jump || this.time - (p.fx.jBuf ?? -9) < 0.13;
    const coyote = !BRAWL_ON && !p.onGround && p.fx.airT < 0.1 && p.vel.y <= 0.5;
    if (bHold) { /* brawl.js moved them */ }
    else if (inp.drop && p.onGround && p.groundOneWay && !frozen) { p.dropThru = 0.3; p.onGround = false; p.vel.y = Math.min(p.vel.y, -1); p.fx.jBuf = -9; }   // v1.2.6: the chord's jump press is used up (no coyote jump back up)
    else if (wantJump && !hold && !frozen && (p.onGround || coyote) && s.jump > 0) { p.fx.jBuf = -9; p.fx.airT = 9; p.vel.y = s.jump * (L.side ? SIDE.jumpMul * Math.sqrt(L.gravK || 1) : 1) * (L.ice ? ICE.jumpK : 1) * (BRAWL_ON ? bItemK(this, p, 'jump') : 1); p.onGround = false; this.emit({ t: 'jump', p: p.id }); }
    else if (BRAWL_ON && inp.jump && !p.fx.jHeld && !hold && !frozen && !p.onGround && (p.fx.airJ || 0) > 0 && s.jump > 0) {   // brawl: double jump
      p.vel.y = s.jump * SIDE.jumpMul * 0.95 * bItemK(this, p, 'jump'); p.fx.airJ--; p.fx.launchT = 0; this.emit({ t: 'jump', p: p.id });
    }
    if (BRAWL_ON) { if (p.onGround) p.fx.airJ = BRAWL.airJumps; p.fx.jHeld = !!inp.jump; }
    if (inp.aim) p.aim = inp.aim;
    if (inp.aimPoint) p.aimPoint = inp.aimPoint;
    // Fast movers (critters run at bullet speed) move in small sub-steps so they can't skip through walls.
    const sub = Math.max(1, Math.min(5, Math.ceil(Math.hypot(p.vel.x, p.vel.z) * dt / 0.3)));
    const wasGround = p.onGround, fallV = p.vel.y;
    if (bHold !== 1) for (let k = 0; k < sub; k++) movePlayer(p, dt / sub, L, p.flying ? this.wallSolids : this.solids);
    if (s.pound > 0 && !wasGround && p.onGround && fallV < NEWC.pound.vy && canAct && !p.flying) this.groundPound(p);   // v1.2.15 Ground Pound
    if (this.phase === 'countdown' && this.isWaves() && p.spawn && !p.flying && !(this.settings.core && p.team !== 1)) {   // (Core Defense: heroes build during the countdown)
      const dx = p.pos.x - p.spawn.x, dz = p.pos.z - p.spawn.z, d = Math.hypot(dx, dz);
      if (d > WAVE_PREP.leash) { p.pos.x = p.spawn.x + dx / d * WAVE_PREP.leash; p.pos.z = p.spawn.z + dz / d * WAVE_PREP.leash; p.vel.x = 0; p.vel.z = 0; }
    }
    if (p.smod === 'rewind') this.recordHistory(p);
    if (p.fx.slam) { const sl = p.fx.slam; sl.t += dt; if (sl.t > 0.2 && p.onGround && canAct) { p.fx.slam = null; this.groundSlam(p); } else if (sl.t > 4) p.fx.slam = null; }
    if (L.lava && !p.flying) this.lavaRules(p);
    if (L.brawl) { brawlRules(this, p); if (!p.alive) return; }
    else if (L.side) { sideRules(this, p, dt); if (!p.alive) return; }
    // v1.2.26 (Devin: players teleporting with no teleport cards): this safety net used to send you back to your spawn
    // whenever you went above 40 m (a big launch, Thrust, explosions) or a little past the arena edge. Now only a broken
    // position does that; too high hits an invisible ceiling, past the edge is pushed back in, under the floor is lifted
    // back onto it (lava and ice keep their own rules: falling in there still counts).
    const top = L.open ? OW.ceil : 40, floorY = L.hAt ? L.hAt(p.pos.x, p.pos.z) : 0;
    if (!fin(p.pos.x) || !fin(p.pos.y) || !fin(p.pos.z) || ((L.lava || L.ice) && p.pos.y < floorY - (L.hAt ? 3 : 1))) {
      p.pos = { ...p.spawn }; p.vel = { x: 0, y: 0, z: 0 };
    } else {
      if (p.pos.y > top) { p.pos.y = top; if (p.vel.y > 0) p.vel.y = 0; }
      if (p.pos.y < floorY - (L.hAt ? 3 : 1)) { p.pos.y = floorY; if (p.vel.y < 0) p.vel.y = 0; }
      if (Math.abs(p.pos.x) > L.hx || Math.abs(p.pos.z) > L.hz || (L.edges && edgeDistance(L.edges, p.pos.x, p.pos.z) < -1.5)) {
        const c = this.clampArena(p.pos.x, p.pos.z, PR * (p.size || 1)); p.pos.x = c.x; p.pos.z = c.z;
      }
    }
    p.fireT -= dt; p.blockCdT -= dt; p.flashT -= dt;
    if (p.blockT > 0) {
      p.blockT -= dt;
    }
    if (p.reloadT > 0) {   // (v1.2.15 Running Gun: reloads faster while you stand still)
      p.reloadT -= dt * (s.runGun > 0 && Math.hypot(inp.mx || 0, inp.mz || 0) < 0.1 ? 1 + s.runGun : 1);
      if (p.reloadT <= 0) { p.reloadT = 0; p.ammo = s.ammo; this.gambleRoll(p); }
    }
    if (p.encoreQ && p.encoreQ.length) {   // Encore follow-up shots
      for (const e of p.encoreQ) e.t -= dt;
      while (p.encoreQ.length && p.encoreQ[0].t <= 0) {
        const e = p.encoreQ.shift();
        if (canAct && !hold) {
          this.tryShoot(p, true);
          // v1.2.15 Chain Encore: each Encore shot may fire another, and that one may too
          const ch = e.ch || 1;
          if (s.chainEncore > 0 && ch < NEWC.chain && Math.random() < s.chainEncore) {
            p.encoreQ.push({ t: ENCORE.gap, ch: ch + 1 }); p.encoreQ.sort((a, b) => a.t - b.t);
            if (ch + 1 >= 3) this.emit({ t: 'nc', k: 'chain', p: p.id, n: ch + 1, x: p.pos.x, y: p.pos.y + 2.2 * p.size, z: p.pos.z });
          }
        }
      }
    }
    // Core Defense: the use key (E) picks up and puts down blocks, cubes and turrets (also during the build phase).
    if (this.settings.core && p.kind === 'hero') {
      const u = inp.useSeq | 0;
      if (p.lastUseSeq === undefined) p.lastUseSeq = u;
      // v26: press picks up (or catches); while carrying, hold to aim the hologram and let go to put it down
      const pressed = u !== p.lastUseSeq; if (pressed) p.lastUseSeq = u;
      coreUseInput(this, p, pressed, !!inp.use, dt);   // v1.2.23: holding it by the core lifts the core
    }
    const ss = inp.shotSeq | 0; if (p.lastShotSeq === undefined) p.lastShotSeq = ss;
    if (canAct) {
      if (inp.blockSeq !== p.lastBlockSeq) { p.lastBlockSeq = inp.blockSeq; this.tryBlock(p); }
      if (inp.reloadSeq !== p.lastReloadSeq) { p.lastReloadSeq = inp.reloadSeq; this.startReload(p); }
      if (s.bloodVolley > 0) this.volleyHold(p, dt, !!inp.reload && !hold);
      const tap = ss !== p.lastShotSeq; p.lastShotSeq = ss;   // v1.2.6: a click whose press and release both came between steps: one shot attempt
      if ((inp.shoot || tap) && !hold && !p.carry) this.tryShoot(p);   // Core Defense: no shooting while carrying
    } else { p.lastBlockSeq = inp.blockSeq; p.lastReloadSeq = inp.reloadSeq; p.lastShotSeq = ss; }
    if (p.mod === 'katana') this.updateKatana(p, dt, canAct && !hold);
    if (hold) this.chargeHold(p, dt);
    else if (p.smod === 'purge' && (p.fx.purge || 0) > 0) {   // v1.2.15 Purge Pulse: let go at full charge to fire, earlier and it drains back
      if (p.fx.purge >= 1 && canAct) this.purgePulse(p); else p.fx.purge = Math.max(0, p.fx.purge - dt / NEWC.purge.time * 1.5);
    }
    if (s.regen > 0) p.hp = Math.min(this.maxHp(p), p.hp + s.regen * dt * (BRAWL_ON && p.kind === 'hero' ? BRAWL.regenK : 1));
    this.updateStatus(p, dt);
    if (p.melee && canAct) this.meleeContact(p);
    if (p.mod === 'shield') this.updateShieldGun(p, dt, canAct && !hold);
    if (p.fx.tshield) this.updateTurretShield(p, dt);
    runHook('onTick', this, p, dt);
  }

  // Top walking speed right now (crouch, chill and wet slow it). v30: also sent to the player for local prediction.
  walkSpeed(p) {
    return (BRAWL_ON ? bItemK(this, p, 'speed') : 1) * (p.carry ? coreCarrySlow(p) : 1) * (p.crouch ? OW.crouch.speed : 1) * (this.hairFull(p) && !p.fx.hold ? HAIR.fullSpeed : 1) * this.rushK(p) * p.stats.moveSpeed * speedFor(p.size) * ((p.fx.chillT || 0) > this.time ? 1 - (p.fx.chillK || 0.4) : 1) * ((p.fx.wetT || 0) > this.time ? ICE.wetSlow : 1);
  }
  // v30 client-side prediction: per remote human [id, last input seq applied, walk speed, jump speed, ok, on ground].
  // ok = 0 whenever the simple walk/jump model would guess wrong (vehicles, falling in, brawl, holds, moving floors...).
  predRows() {
    const L = this.level, out = [];
    if (L.side || L.brawl || BRAWL_ON) return out;
    for (const p of this.players) {
      if (p.isBot || !p.connected || p.kind !== 'hero' || p.input.q == null) continue;
      // v1.2.6: joiners now replay against walls, blocks and props too, so standing on a crate, a resting piston or a
      // bobbing float stays predicted (not on slides / swings, or anything moving faster than 0.6 m/s); a rising pillar lifts you
      const G = p.ground, slowG = !G || (G.kind !== 'slide' && G.kind !== 'swing' && Math.hypot(G.dx || 0, G.dy || 0, G.dz || 0) < 0.6 * (this.stepDt || 1 / 60));
      const ok = p.alive && !p.reviving && !p.veh && !p.flying && !p.fx.hold && !p.fx.slam && !((p.fx.rootT || 0) > this.time) && !((p.fx.pullT || 0) > this.time) && !(p.fx.thrust && p.fx.thrust.t > 0) && slowG && !(p.ow && p.ow.st !== 'ground')
        && !(this.phase === 'countdown' && !this.isWaves()) && !(L.ice && p.onGround) && !p.commanded && !p.fx.mount
        && !this.barricades.some(b => b.grow && Math.abs(p.pos.x - b.x) < b.len / 2 + 1 && Math.abs(p.pos.z - b.z) < b.th / 2 + 1);
      // v1.2.9: [6] ms the newest input has been in use: the joiner replays only the rest of it (joiners' inputs are now applied
      // for exactly as long as they were held, main.js queueInput, so this is what's left of a 0-17 ms difference at every snapshot)
      out.push([p.id, p.input.q, Math.round(this.walkSpeed(p) * 100) / 100, Math.round(p.stats.jump * (L.ice ? ICE.jumpK : 1) * 100) / 100, ok ? 1 : 0, p.onGround ? 1 : 0, Math.max(0, Math.round((this.time - (p.inAt ?? this.time)) * 1000))]);
      // v1.2.9: [7-9] the prep-time leash (spawn x, z, radius) while it holds you, so the joiner's replay stops at it like you do here
      const leash = this.phase === 'countdown' && this.isWaves() && p.spawn && !p.flying && !(this.settings.core && p.team !== 1);
      if (leash) out[out.length - 1].push(Math.round(p.spawn.x * 100) / 100, Math.round(p.spawn.z * 100) / 100, WAVE_PREP.leash);
      // v1.2.15: [10-11] Backpedal Boots (faster away from your aim, slower toward it), so the replay moves like the host
      if (p.stats.backpedal > 0 || p.stats.advanceSlow > 0) { if (!leash) out[out.length - 1].push(0, 0, 0); out[out.length - 1].push(Math.round(p.stats.backpedal * 100) / 100, Math.round(p.stats.advanceSlow * 100) / 100); }
    }
    return out;
  }

  // ---------------------------------------------------------- status effects
  // Burn: steady damage for a fixed time. Every application stacks (each bullet adds its own burn);
  // a key (one napalm splat, the lava, one flamethrower) refreshes its own stack instead of adding more.
  setBurn(t, dur, dps, src, key = null) {
    const L = t.fx.burns || (t.fx.burns = []);
    let b = key != null ? L.find(k => k.key === key && k.t > 0) : null;
    if (b) { b.t = Math.max(b.t, dur); b.dps = Math.max(b.dps, dps); b.src = src; }
    else { b = { t: dur, dps, src, key }; L.push(b); if (L.length > 24) L.shift(); }
    t.fx.burn = b;   // the latest stack (status icons, tests)
  }
  addPoison(q, src, lvl = 1) {
    const P = q.fx.poisonS;
    if (P && P.left > 0) { P.left = POISON.dur; P.lvl = Math.max(P.lvl, lvl); if (src) P.src = src; }   // refresh: the ramp carries on
    else q.fx.poisonS = { t: 0, left: POISON.dur, lvl: Math.max(0.5, lvl), src };
  }
  // Map fire (lava): scales with the round and, in co-op, the difficulty.
  mapHeatK() { return (1 + 0.12 * Math.max(0, (this.round || 1) - 1)) * (this.isWaves() ? (coopDiff(this.settings).dmg || 1) : 1); }
  burning(p) { return !!(p.fx.burns && p.fx.burns.some(b => b.t > 0)); }
  // Thruster: the push left over from Knockback hits, added to the movement target until it runs out.
  thrustVel(p, dt) {
    const th = p.fx.thrust;
    if (!th || th.t <= 0) return { x: 0, z: 0 };
    th.t -= dt;
    const k = Math.min(1, th.t / 0.5);   // eases out over the last half second
    return { x: th.x * k, z: th.z * k };
  }
  addThrust(q, dir, b) {
    const flat = Math.hypot(dir.x, dir.z); if (flat < 1e-3) return;
    const add = b.knockback * (b.dmg / DEFAULT_STATS.damage) * THRUST.perHit / q.size;
    const dur = clamp(THRUST.base * Math.sqrt(Math.max(0.01, b.dmg) / THRUST.ref), THRUST.minDur, THRUST.maxDur);
    const th = q.fx.thrust && q.fx.thrust.t > 0 ? q.fx.thrust : (q.fx.thrust = { x: 0, z: 0, t: 0 });
    th.x += dir.x / flat * add; th.z += dir.z / flat * add;
    const m = Math.hypot(th.x, th.z), cap = THRUST.cap / q.size;
    if (m > cap) { th.x *= cap / m; th.z *= cap / m; }
    th.t = Math.max(th.t, dur);
  }
  updateStatus(p, dt) {
    const f = p.fx;
    if (f.burns && f.burns.length) {
      for (const b of f.burns) { if (b.t <= 0) continue; const step = Math.min(dt, b.t); b.t -= dt; this.dmgTag = 'fire'; this.hurt(p, b.dps * step, b.src, null, true); if (!p.alive) return; }
      f.burns = f.burns.filter(b => b.t > 0);
    }
    const P = f.poisonS;
    if (P) {
      // rate ramps from 0.4x to 1.6x over the first 5 s (40% of max health in all), and keeps ramping while refreshed
      const step = Math.min(dt, Math.max(0, P.left));
      P.t += step; P.left -= dt;
      const rate = Math.min(this.maxHp(p), POISON.hpCap) * POISON.share / POISON.dur * (0.4 + 0.24 * Math.min(P.t, POISON.rampCap)) * (1 + POISON.perLevel * Math.max(0, P.lvl - 1)) * (p.kind === 'boss' || p.heavy ? POISON.boss : 1);
      if (step > 0) { this.dmgTag = 'poison'; this.hurt(p, rate * step, P.src, null, true); }
      if (!p.alive) return;
      if (P.left <= 0) f.poisonS = null;
    }
    if (p.stats.drain > 0 && p.hp > 1) p.hp = Math.max(1, p.hp - this.maxHp(p) * p.stats.drain / 2 * dt); // cursed: never kills by itself
  }
  // Critters bite from a short distance (they lunge), so they never need to stand inside your feet.
  critterReach(p, q) { return PR * (p.size + q.size) + CRITTER_REACH; }
  meleeContact(p) {
    const crit = p.kind === 'critter';
    for (const q of this.players) {
      if (!q.alive || q.reviving || q === p) continue;
      // v1.2.6: the reach before isEnemy (two scoreKey walks per pair, for every pair of a critter swarm), and a box test before
      // the hypot (exact: hypot >= |dx|, |dz|)
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, reach = crit ? this.critterReach(p, q) : PR * (p.size + q.size) + 0.15;
      if (dx > reach || -dx > reach || dz > reach || -dz > reach || !this.isEnemy(p, q)) continue;
      const d = Math.hypot(dx, dz);
      if (d > reach || Math.abs((q.pos.y + PH * q.size / 2) - (p.pos.y + PH * p.size / 2)) > PH * (p.size + q.size) / 2) continue;
      if ((p.fx['bite' + q.id] || 0) > this.time) continue;
      p.fx['bite' + q.id] = this.time + 0.7;
      if (q.mod === 'shield' && this.shieldGunBlocks(q, { pos: { x: p.pos.x, y: this.chest(q), z: p.pos.z } })) { p.vel.x -= dx / (d || 1) * 8; p.vel.z -= dz / (d || 1) * 8; continue; }
      const box = this.boxCover(q, { x: p.pos.x, y: this.chest(p), z: p.pos.z }, p);
      if (box) { p.vel.x -= dx / (d || 1) * 8; p.vel.z -= dz / (d || 1) * 8; this.soakBox(box, p.melee); this.emit({ t: 'block', p: q.id, x: q.pos.x, y: this.chest(q), z: q.pos.z }); continue; }
      if (this.shielded(q)) { p.vel.x -= dx / (d || 1) * 8; p.vel.z -= dz / (d || 1) * 8; this.blockedDamage(q, p.melee); this.soakShield(q, p.melee); this.emit({ t: 'block', p: q.id, x: q.pos.x, y: this.chest(q), z: q.pos.z }); continue; }
      if (p.kind === 'splitter') {   // blobs: a light slap plus a poison stack (stacks with every touch)
        this.hurt(q, p.melee * 0.35, p, { x: dx / (d || 1), y: 0, z: dz / (d || 1) });
        this.addPoison(q, p, 0.5);
      } else this.hurt(q, p.melee, p, { x: dx / (d || 1), y: 0, z: dz / (d || 1) });
    }
  }

  // ---------------------------------------------------------- Riot Shield weapon mod
  // A static shield held in front of you: it reflects bullets that hit it (like your block) but only takes
  // RIOT.hits hits before it turns red and has to recharge. Fire taps out a wave of your normal bullets
  // (count = your bullets per shot); hold to add one more bullet every RIOT.step s, up to +RIOT.maxExtra.
  // Wave bullets are ordinary bullets, so they keep every bullet effect from your cards.
  updateShieldGun(p, dt, canAct) {
    const f = p.fx, inp = p.input;
    if (f.riotHits == null) f.riotHits = RIOT.hits;
    // recharge: a broken shield comes back full; an intact one regains a hit every RIOT.regen s
    if ((f.shieldBrokenT || 0) > 0 && f.shieldBrokenT <= this.time) { f.shieldBrokenT = 0; f.riotHits = RIOT.hits; this.emit({ t: 'shieldUp', p: p.id }); }
    else if (!(f.shieldBrokenT > 0) && f.riotHits < RIOT.hits && this.time - (f.riotLastHit || 0) > RIOT.regen) { f.riotHits++; f.riotLastHit = this.time; }
    f.shieldOpen = !(p.stats.tank > 0) && !(f.shieldBrokenT > 0);   // Tiny Tank: no shield, just the charged shot
    const ai = p.isBot || p.commanded;
    const held = canAct && inp.shoot && !(ai && (f.charge || 0) >= RIOT.step * RIOT.maxExtra);
    if (held && (f.charging || (p.reloadT <= 0 && p.fireT <= 0 && p.ammo > 0))) {
      if (!f.charging) { f.charging = true; f.charge = 0; f.chargeShots = 0; }
      f.charge += dt;
      const want = Math.min(RIOT.maxExtra, Math.floor(f.charge / RIOT.step));
      while (f.chargeShots < want) { f.chargeShots++; this.emit({ t: 'charge', p: p.id, n: f.chargeShots }); }
    } else if (f.charging) {
      f.charging = false;
      if (p.ammo > 0 && p.reloadT <= 0) {
        p.ammo--; p.fireT = 1 / p.stats.fireRate;
        this.fireWave(p, f.chargeShots);
      }
      f.chargeShots = 0; f.charge = 0;
      if (p.ammo <= 0) this.startReload(p);
    }
  }
  // Bullets in a wave: your bullets per shot, plus the extra ones charged by holding.
  waveCount(p, extra) { return Math.max(1, Math.round(p.stats.projectiles)) + Math.max(0, Math.min(RIOT.maxExtra, extra | 0)); }
  fireWave(p, extra) {
    if (!budgetAllow(this, p)) return;
    if (p.stats.tank > 0) return this.fireShell(p, extra);
    const s = p.stats, n = this.waveCount(p, extra);
    const step = n > 1 ? Math.min(0.16, 1.3 / (n - 1)) : 0;   // a fan, never wider than ~75 degrees
    for (let k = 0; k < n; k++) {
      const d = norm(rotY(p.aim, (k - (n - 1) / 2) * step));
      // spawned just outside the shield so it never eats your own wave
      const o = RIOT.radius * p.size + 0.1;
      this.spawnBullet(p, { x: p.pos.x + d.x * o, y: this.chest(p) + d.y * 0.6, z: p.pos.z + d.z * o }, d, s.bulletSpeed, false);
    }
    this.emit({ t: 'shoot', p: p.id, x: p.pos.x, y: this.chest(p), z: p.pos.z, wave: n });
  }
  // Tiny Tank + Riot Shield: the charged shot is one explosive shell with double damage and a bigger blast.
  fireShell(p, extra) {
    const shots = this.waveCount(p, extra);
    const s = p.stats, d = norm(p.aim), dmg = this.effDamage(s) * shots * 2;
    const b = this.spawnBullet(p, { x: p.pos.x + d.x * 0.9 * p.size, y: this.chest(p) + d.y * 0.5, z: p.pos.z + d.z * 0.9 * p.size }, d, Math.max(20, s.bulletSpeed), false);
    Object.assign(b, { dmg, r: 0.28 + Math.min(0.3, shots * 0.03), explosive: Math.max(1, b.explosive), boomMul: 1.6, bLeft: 0, homing: 0, drill: 0, fx: 'shell' });
    b.grav = bulletGravityFor(0.2);
    this.emit({ t: 'shoot', p: p.id, x: p.pos.x, y: this.chest(p), z: p.pos.z, wave: shots });
  }
  riotUp(q) { return q.mod === 'shield' && q.alive && !q.reviving && !(q.stats.tank > 0) && !((q.fx.shieldBrokenT || 0) > 0); }
  // Is point (x,y,z) on the shield's arc? (in front of q, within the shield's width and height)
  riotCovers(q, x, y, z) {
    const dx = x - q.pos.x, dz = z - q.pos.z, d = Math.hypot(dx, dz) || 1;
    const a = norm({ x: q.aim.x, y: 0, z: q.aim.z });
    if ((dx * a.x + dz * a.z) / d < Math.cos(RIOT.halfArc)) return false;
    return y > q.pos.y + RIOT.y0 * q.size - 0.15 && y < q.pos.y + RIOT.y1 * q.size + 0.15;
  }
  // One hit on the shield: uses up a charge; the last one turns it red until it recharges.
  riotHit(q, x, y, z) {
    const f = q.fx;
    if (f.riotHits == null) f.riotHits = RIOT.hits;
    f.riotHits--; f.riotLastHit = this.time;
    if (f.riotHits <= 0) { f.riotHits = 0; f.shieldBrokenT = this.time + RIOT.recharge; this.emit({ t: 'shieldBreak', p: q.id, x: q.pos.x, y: this.chest(q), z: q.pos.z }); }
    else this.emit({ t: 'block', p: q.id, x, y, z });
  }
  // Hitscan and other non-bullet hits from point b.pos: blocked if they land on the shield.
  shieldGunBlocks(q, b) {
    if (!this.riotUp(q) || !this.riotCovers(q, b.pos.x, b.pos.y, b.pos.z)) return false;
    this.riotHit(q, b.pos.x, b.pos.y, b.pos.z);
    return true;
  }
  // Bullets: blocked where they cross the shield's surface (an arc RIOT.radius out from the holder).
  riotCheck(b, prev) {
    for (const q of this._riotQ || this.players) {
      if (q.mod !== 'shield' || q.id === b.owner || !this.riotUp(q) || !this.isEnemy(b.ownerRef, q)) continue;
      const R = RIOT.radius * q.size;
      const d1 = Math.hypot(prev.x - q.pos.x, prev.z - q.pos.z), d2 = Math.hypot(b.pos.x - q.pos.x, b.pos.z - q.pos.z);
      if (!(d2 <= R + b.r && d1 >= R - 0.05)) continue;
      if (!this.riotCovers(q, b.pos.x, b.pos.y, b.pos.z)) continue;
      const n = norm({ x: b.pos.x - q.pos.x, y: 0, z: b.pos.z - q.pos.z });
      b.pos = { x: q.pos.x + n.x * (R + b.r + 0.03), y: b.pos.y, z: q.pos.z + n.z * (R + b.r + 0.03) };
      const ev = this.events.length;
      this.reflect(b, q, n);
      this.events.length = ev;            // riotHit emits its own block / break event
      this.riotHit(q, b.pos.x, b.pos.y, b.pos.z);
      return true;
    }
    return false;
  }
  pillarFrac(p) { const ps = this.shields.find(s => s.box && s.owner === p.id && s.hp > 0); return ps ? ps.hp / ps.maxHp : -1; }
  riotFrac(p) {
    if (p.mod !== 'shield' || p.stats.tank > 0) return -1;
    if ((p.fx.shieldBrokenT || 0) > 0) return 0;
    return (p.fx.riotHits ?? RIOT.hits) / RIOT.hits;
  }

  // ---------------------------------------------------------- Katana weapon mod
  // Click: a melee slash in front of you. It hits everyone in the arc with your bullet damage x KATANA.slashMul
  // and all your bullet effects, and for a moment cuts any enemy bullet in the arc out of the air (no explosion,
  // no damage, no effects). Hold: charges a flying slash wave (full charge in KATANA.chargeTime at the base fire
  // rate, faster with more fire rate). Release past KATANA.minCharge and the wave flies: it is one of your bullets
  // (every bullet card applies), passes through players, and cuts enemy bullets it touches. No ammo, no reload.
  katanaReach(p) { return KATANA.reach * p.size * this.katanaScale(p) + PR; }
  katanaChargeTime(p) { return clamp(KATANA.chargeTime * DEFAULT_STATS.fireRate / Math.max(0.1, p.stats.fireRate), 0.25, 4); }
  updateKatana(p, dt, canAct) {
    const f = p.fx, held = canAct && !!p.input.shoot;
    if ((f.slashT || 0) > 0) { f.slashT -= dt; this.katanaCut(p, KATANA.reach * p.size + KATANA.cutPad, f.slashArc || KATANA.arc); }
    if (held && !f.kHeld) {                       // press: slash right away
      f.kHeld = true; f.kCharge = 0;
      if (p.fireT <= 0) this.katanaSlash(p);
    } else if (held) {
      // v1.2.22 (Devin): a longer grace before holding counts as charging (quick slashes stay plain melee), and a full
      // charge fires the wave by itself and starts charging the next one while you keep holding
      if ((f.kHeldT = (f.kHeldT || 0) + dt) > KATANA.grace) f.kCharge = Math.min(1, (f.kCharge || 0) + dt / this.katanaChargeTime(p));
      if (f.kCharge >= 1) { this.katanaWave(p, 1); f.kCharge = 0; f.kHeldT = KATANA.grace * 0.5; }
    } else if (f.kHeld) {                         // release: a charged slash flies off as a wave
      f.kHeld = false; f.kHeldT = 0;
      if ((f.kCharge || 0) >= KATANA.minCharge) this.katanaWave(p, f.kCharge);
      f.kCharge = 0;
    }
  }
  // Effects a slash carries onto whoever it hits (a stand-in bullet for applyHit).
  meleeHit(p, dmg) {
    const s = p.stats;
    return { dmg, ownerRef: p, owner: p.id, pos: { ...p.pos }, vel: { ...p.aim }, knockback: s.knockback + 0.4, poison: s.poison, ignite: s.ignite, chill: s.chill,
      hex: s.hex, chain: s.chain, limpet: s.limpet, flame: false };
  }
  katanaSlash(p) {
    const s = p.stats, n = Math.max(1, Math.round(s.projectiles));
    p.fireT = 1 / s.fireRate;
    const arc = Math.min(1.7, KATANA.arc + 0.1 * (n - 1)), reach = KATANA.reach * p.size * this.katanaScale(p), a = norm({ x: p.aim.x, y: 0, z: p.aim.z });
    const from = { x: p.pos.x, y: this.chest(p), z: p.pos.z }, dmg = this.effDamage(s) * KATANA.slashMul;
    p.fx.slashT = KATANA.active; p.fx.slashArc = arc; p.fx.slashN = ((p.fx.slashN || 0) + 1) & 255;
    for (const q of this.players) {
      if (q === p || !q.alive || q.reviving || !this.canHurt(p, q)) continue;
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d - PR * q.size > reach) continue;
      if (d > PR * (p.size + q.size) && (dx * a.x + dz * a.z) / (d || 1) < Math.cos(arc)) continue;
      if (q.pos.y > p.pos.y + PH * p.size + 0.6 || q.pos.y + PH * q.size < p.pos.y - 0.6) continue;
      const to = { x: q.pos.x, y: this.chest(q), z: q.pos.z };
      if (segBlocked(this.solids, from, to, sd => sd.barricade && !this.canHurt(p, sd.barricade.ownerRef))) continue;
      const dir = norm({ x: dx, y: 0, z: dz });
      // Shields stop the blade like a bullet: riot shields, pillar boxes and bubbles.
      if (q.mod === 'shield' && this.shieldGunBlocks(q, { pos: { x: p.pos.x, y: this.chest(q), z: p.pos.z } })) { p.vel.x -= dir.x * 6; p.vel.z -= dir.z * 6; continue; }
      const box = this.boxCover(q, from, p);
      if (box) { this.soakBox(box, dmg); this.emit({ t: 'block', p: q.id, x: q.pos.x, y: this.chest(q), z: q.pos.z }); continue; }
      if (this.shielded(q)) { p.vel.x -= dir.x * 6; p.vel.z -= dir.z * 6; this.blockedDamage(q, dmg); this.soakShield(q, dmg); this.emit({ t: 'block', p: q.id, x: q.pos.x, y: this.chest(q), z: q.pos.z }); continue; }
      this.applyHit(this.meleeHit(p, dmg), q, dir);
      if (s.explosive > 0) this.explode(to, dmg, p, { knock: s.knockback, rmul: 0.8, noSelf: true, extra: Math.max(0, Math.round(s.explosive) - 1) });
    }
    // crates and barrels get knocked about
    for (const o of this.dyn) {
      if (!o.pushable && o.kind !== 'crate' && o.kind !== 'barrel') continue;
      const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d < reach + Math.max(o.w, o.d) / 2 && (dx * a.x + dz * a.z) / (d || 1) > Math.cos(arc)) this.impulse(o, { x: dx / (d || 1) * dmg * 0.06, y: 0.6, z: dz / (d || 1) * dmg * 0.06 });
    }
    this.katanaCut(p, reach + KATANA.cutPad, arc);
    this.emit({ t: 'slash', p: p.id, x: p.pos.x, y: this.chest(p), z: p.pos.z, ax: a.x, az: a.z, r: reach, arc });
  }
  // Cuts enemy bullets inside the slash arc: they vanish with no impact (no explosion, shrapnel, fire or damage).
  katanaCut(p, R, arc) {
    const a = norm({ x: p.aim.x, y: 0, z: p.aim.z }), cy = this.chest(p);
    for (const b of this.bullets) {
      if (!b.alive || b.owner === p.id || b.caught || !(this.isEnemy(b.ownerRef, p) || this.canHurt(b.ownerRef, p))) continue;
      const dx = b.pos.x - p.pos.x, dz = b.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > R + b.r || Math.abs(b.pos.y - cy) > PH * p.size * 0.8 + 0.5) continue;
      if (d > PR * p.size && (dx * a.x + dz * a.z) / (d || 1) < Math.cos(arc)) continue;
      this.cutBullet(b);
    }
  }
  cutBullet(b) {
    b.alive = false;
    this.emit({ t: 'cut', x: b.pos.x, y: b.pos.y, z: b.pos.z, p: b.cown || b.owner });
  }
  // Swing size follows your bullet damage (sqrt), never below KATANA.minScale so low-damage builds can still hit.
  katanaScale(p) { return clamp(Math.sqrt(this.effDamage(p.stats) / DEFAULT_STATS.damage), KATANA.minScale, KATANA.maxScale); }
  katanaWave(p, charge) {
    if (!budgetAllow(this, p)) return;
    const s = p.stats, n = Math.max(1, Math.round(s.projectiles)), lerp = ([a, b], k) => a + (b - a) * k, ks = this.katanaScale(p);
    p.fireT = Math.max(p.fireT, 0.2);
    for (let k = 0; k < n; k++) {
      const d = norm(rotY({ x: p.aim.x, y: clamp(p.aim.y, -0.35, 0.35), z: p.aim.z }, (k - (n - 1) / 2) * 0.2));
      const o = { x: p.pos.x + d.x * 0.9 * p.size, y: this.chest(p) + d.y * 0.6, z: p.pos.z + d.z * 0.9 * p.size };
      const b = this.spawnBullet(p, o, d, Math.max(14, s.bulletSpeed * KATANA.waveSpeed), false);
      Object.assign(b, { fx: 'slash:' + (lerp(KATANA.waveW, charge) * Math.sqrt(p.size) * ks).toFixed(2), dmg: b.dmg * lerp(KATANA.waveDmg, charge), hitR: lerp(KATANA.waveW, charge) * Math.sqrt(p.size) * ks, life: lerp(KATANA.waveLife, charge),
        grav: 0, pierce: true, cutter: true, charge: Math.round(charge * 100) / 100 });
    }
    this.emit({ t: 'shoot', p: p.id, x: p.pos.x, y: this.chest(p), z: p.pos.z, mod: 'katana', wave: 1 });
  }
  // A flying slash wave cuts the enemy bullets it touches (two waves that meet cut each other).
  waveCuts(b) {
    const R = b.hitR || b.r;
    for (const o of this.bullets) {
      if (o === b || !o.alive || !(this.isEnemy(o.ownerRef, b.ownerRef))) continue;
      if (Math.hypot(o.pos.x - b.pos.x, o.pos.y - b.pos.y, o.pos.z - b.pos.z) > R + o.r) continue;
      this.cutBullet(o);
      if (o.cutter) { this.cutBullet(b); return; }
    }
  }
  katanaFrac(p) { return p.mod === 'katana' ? (p.fx.kCharge || 0) : -1; }

  // ---------------------------------------------------------- Super Saiyan Hair / Pentagram (hold-to-charge shield mods)
  // Both read your block stats: Block cooldown and Block duration set how fast they charge, Block size scales them.
  // k < 1 is faster: (cooldown / 3.5) / sqrt(duration / 0.35), kept between 0.25 and 4.
  holdRateK(p) { const s = p.stats; return clamp((s.blockCooldown / DEFAULT_STATS.blockCooldown) / Math.sqrt(Math.max(0.05, s.blockDuration) / DEFAULT_STATS.blockDuration), 0.25, 4); }
  canHoldCharge(p) {
    if (!p.alive || p.reviving || p.noBlock) return false;
    if (p.smod === 'hair') return (p.fx.hair || 0) < (p.hairMax || 0);
    if (p.smod === 'purge') return !p.fx.purgeUsed;
    if (p.smod === 'spaceking') return !p.fx.kingUsed && (p.blockCdT <= 0 || (p.fx.king || 0) > 0) && p.onGround && !this.players.some(u => u.kingOf === p.id && u.alive);
    if (p.smod === 'ritual' || p.smod === 'grove') {
      const r = p.fx.ritual;
      if (!r) return p.blockCdT <= 0 && p.onGround;
      return r.level < 3 && this.inRitual(p, r);
    }
    return false;
  }
  chargeHold(p, dt) {
    if (p.smod === 'purge') { p.fx.purge = Math.min(1, (p.fx.purge || 0) + dt / NEWC.purge.time); return; }
    if (p.smod === 'hair') {
      p.fx.hair = Math.min(p.hairMax, (p.fx.hair || 0) + p.hairMax / (HAIR.fillTime * this.holdRateK(p)) * dt);
      if (p.fx.hair >= p.hairMax && !p.fx.hairFullSent) { p.fx.hairFullSent = true; this.emit({ t: 'hairFull', p: p.id, x: p.pos.x, y: p.pos.y + 1.5 * p.size, z: p.pos.z }); }
      if (p.fx.hair < p.hairMax) p.fx.hairFullSent = false;
    } else if (p.smod === 'spaceking') {
      p.fx.king = Math.min(1, (p.fx.king || 0) + dt / (KING.time * this.holdRateK(p)));
      if ((p.fx.kingHumT = (p.fx.kingHumT || 0) - dt) <= 0) { p.fx.kingHumT = KING.humEvery; this.emit({ t: 'kingHum', p: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z }); }
      if (p.fx.king >= 1) this.summonKing(p);
    } else if ((p.smod === 'ritual' || p.smod === 'grove') && !p.fx.ritual) {
      // start drawing a new pentagram (or growing a grass circle) right under your feet
      const holy = p.smod === 'grove';
      const r = { id: this.nextId++, owner: p.id, ownerRef: p, x: p.pos.x, y: p.pos.y, z: p.pos.z, R: (holy ? GROVE : RITUAL).radius * clamp(p.stats.blockSize, 0.5, 3),
        draw: 0, deployed: false, level: 0, prog: 0, age: 0, portals: [], holy, humT: 0, meteors: null };
      p.fx.ritual = r; this.rituals.push(r);
      this.emit({ t: 'ritualStart', p: p.id, x: r.x, y: r.y, z: r.z });
    }
  }
  // Space King: a co-op boss on your side, next to you. It fights for you until it dies or the round ends.
  summonKing(p) {
    p.fx.king = 0; p.fx.kingUsed = true; p.blockCdT = p.stats.blockCooldown * KING.cdMul;
    const a = Math.atan2(p.aim.x, p.aim.z), at = { x: p.pos.x + Math.sin(a) * 3.5, z: p.pos.z + Math.cos(a) * 3.5 };
    const spot = this.freeSpot(at.x, at.z, p.pos.x, p.pos.z, PR * 2.8, p.pos.y);
    const b = this.spawnUnit('bigbro', p, spot);
    this.unitsChanged();
    this.emit({ t: 'kingSummon', p: p.id, name: b.name, x: spot.x, y: spot.y, z: spot.z });
  }
  inRitual(p, r) { return Math.hypot(p.pos.x - r.x, p.pos.z - r.z) < r.R + 0.1 && Math.abs(p.pos.y - r.y) < 1.2; }
  updateRituals(dt) {
    for (const r of this.rituals) {
      const p = r.ownerRef, k = this.holdRateK(p), holding = p.alive && !p.reviving && p.fx.ritual === r && p.fx.hold;
      const C = r.holy ? GROVE : RITUAL, total = C.drawTime + 3 * C.levelTime;
      r.hold = holding;
      // Cursed Sacrifice: charging bleeds you (never below 1 health, never refunded). Both make a quiet sound others can hear.
      const sacrifice = gain => { if (!r.holy && gain > 0 && p.hp > 1) p.hp = Math.max(1, p.hp - this.maxHp(p) * RITUAL.cost * gain); };
      if (r.holy && holding && !p.reviving && p.hp < this.maxHp(p)) p.hp = Math.min(this.maxHp(p), p.hp + GROVE.chargeHeal * this.maxHp(p) * dt);   // Sacred Grove never costs health; it heals a touch
      if (holding && (r.humT -= dt) <= 0) { r.humT = RITUAL.humEvery; this.emit({ t: 'ritualHum', p: p.id, holy: r.holy ? 1 : 0, x: r.x, y: r.y, z: r.z }); }
      if (!r.deployed) {
        if (holding) {
          const g = Math.min(1 - r.draw, dt / (C.drawTime * k)); r.draw += g; sacrifice(g * C.drawTime / total);
          if (r.draw >= 1) {
            r.deployed = true;
            this.emit({ t: 'ritualReady', p: p.id, holy: r.holy ? 1 : 0, x: r.x, y: r.y, z: r.z, r: r.R });
            this.tryBlock(p, true);   // your other block effects (walls, mines, counter shots...) fire now
          }
        } else {   // let go: it fades back fast but not at once, so you can pick it up again
          r.draw -= dt * RITUAL.decay / (C.drawTime * k);
          if (r.draw <= 0 || !p.alive) { r.dead = true; this.emit({ t: 'ritualFizzle', p: p.id, x: r.x, y: r.y, z: r.z }); }
        }
      } else {
        r.age += dt;
        if (r.level < 3) {
          if (holding) {
            const g = Math.min(1 - r.prog, dt / (C.levelTime * k)); r.prog += g; sacrifice(g * C.levelTime / total);
            if (r.prog >= 1) {
              r.prog = 0; r.level++;
              this.ritualLevel(p, r);
            }
          } else r.prog = Math.max(0, r.prog - dt * RITUAL.decay / (C.levelTime * k));
        }
        for (const q of r.portals) {
          q.t += dt; q.gap -= dt;
          if (q.left > 0 && q.gap <= 0 && p.alive) {
            q.gap = RITUAL.spawnGap; q.left--;
            const a = (q.n - q.left) * 2.4;
            const at = { x: r.x + Math.cos(a) * 0.35, y: r.y, z: r.z + Math.sin(a) * 0.35 };
            if (q.brute) this.spawnBrute(p, at); else this.spawnCritter(p, 0, at);
            this.unitsChanged();
          }
          if (q.left <= 0 && q.gap < -0.9) q.done = true;
        }
        r.portals = r.portals.filter(q => !q.done);
        if (r.meteors) this.updateMeteors(p, r, dt);
        const finished = r.level >= 3 && !r.portals.length && !(r.meteors && r.meteors.left > 0);
        if (finished || r.age > RITUAL.expire || !p.alive) {
          r.dead = true;
          this.emit({ t: 'ritualEnd', p: p.id, holy: r.holy ? 1 : 0, x: r.x, y: r.y, z: r.z });
        }
      }
      if (r.dead) {
        if (p.fx.ritual === r) { p.fx.ritual = null; if (r.deployed) p.blockCdT = p.stats.blockCooldown * RITUAL.cdMul; }
      }
    }
    this.rituals = this.rituals.filter(r => !r.dead);
  }
  // What each ritual level gives. Cursed Sacrifice: critter swarm, brute, meteor storm. Sacred Grove: holy shield, robe + cross, angel.
  ritualLevel(p, r) {
    const bs = Math.sqrt(clamp(p.stats.blockSize, 0.5, 3));
    let c = 0;
    if (!r.holy) {
      if (r.level === 1) { c = Math.max(1, Math.round(RITUAL.counts[0] * bs)); r.portals.push({ n: c, left: c, t: 0, gap: 0.35 }); }
      else if (r.level === 2) { c = 1; r.portals.push({ n: 1, left: 1, t: 0, gap: 0.6, brute: true }); }
      else { const M = RITUAL.meteors; c = Math.round(M.n * bs); r.meteors = { left: c, t: 0, gap: M.over / c }; }
    } else {
      if (r.level === 1) { const pool = GROVE.shield * this.maxHp(p); p.fx.holyShield = { hp: pool, max: pool, until: this.time + GROVE.shieldT }; }
      else if (r.level === 2) {
        p.fx.robe = true;
        this.relics = this.relics || [];
        this.relics = this.relics.filter(q => q.owner !== p.id);
        this.relics.push({ id: this.nextId++, owner: p.id, ownerRef: p, x: r.x, y: r.y, z: r.z, t: GROVE.crossLife, fall: 1.2 });
      } else this.spawnAngel(p);
    }
    this.emit({ t: 'ritualLevel', p: p.id, holy: r.holy ? 1 : 0, x: r.x, y: r.y, z: r.z, n: r.level, c });
  }
  // Cursed Sacrifice level 3: meteors rain across the map, half of them aimed near enemies. They hurt everyone, you included,
  // and leave wide fire patches. Each one is marked on the ground a second before it lands.
  updateMeteors(p, r, dt) {
    const M = RITUAL.meteors, m = r.meteors, L = this.level;
    m.t -= dt;
    if (m.left > 0 && m.t <= 0) {
      m.t = m.gap; m.left--;
      let x, z;
      const foes = this.players.filter(q => q.alive && !q.reviving && this.isEnemy(p, q));
      if (foes.length && Math.random() < M.nearEnemy) { const q = foes[Math.floor(Math.random() * foes.length)]; x = q.pos.x + (Math.random() - 0.5) * 6; z = q.pos.z + (Math.random() - 0.5) * 6; }
      else { x = (Math.random() * 2 - 1) * (L.hx - 1.5); z = (Math.random() * 2 - 1) * (L.hz - 1.5); }
      const q = this.clampArena(x, z, 1);
      const y = groundBelow(this.solids, q.x, q.z, 30);
      const dmg = M.dmg * Math.sqrt(clamp(p.stats.blockSize, 0.5, 3));
      this.booms.push({ t: 1.1, pos: { x: q.x, y: y + 0.4, z: q.z }, dmg, owner: p, opts: { full: true, rmul: M.rmul, meteor: true } });
      this.emit({ t: 'meteorWarn', p: p.id, x: q.x, y, z: q.z, r: 3, d: 1.1 });
    }
  }
  // A wide fire patch on flat ground (meteor impacts), burning like Napalm Rounds.
  firePatch(owner, x, y, z, R, dps, life) {
    const bits = [], count = clamp(Math.round(R * R * 4), 12, 44);
    for (let i = 0; i < count; i++) {
      const rr = R * Math.sqrt((i + 0.5) / count) * (0.85 + Math.random() * 0.15), a = i * 2.39996 + Math.random() * 0.4;
      const bx = x + Math.cos(a) * rr, bz = z + Math.sin(a) * rr, by = groundBelow(this.solids, bx, bz, y + 1);
      if (Math.abs(by - y) < 1.2) bits.push({ x: bx, y: by, z: bz });
    }
    if (!bits.length) return;
    if (this.fires.length >= NAPALM.max) this.dropFire(this.fires.shift());
    const f = { id: this.nextId++, owner: owner.id, ownerRef: owner, cown: owner.id, n: { x: 0, y: 1, z: 0 }, r: R, bits, t: life, dps, checkT: 0 };
    this.fires.push(f);
    const r2 = v => Math.round(v * 100) / 100;
    this.emit({ t: 'napalm', id: f.id, p: owner.id, n: [0, 1, 0], life, r: r2(R), b: bits.flatMap(q => [r2(q.x), r2(q.y), r2(q.z)]) });
  }
  // Cursed Sacrifice level 2: a big, tough brute that runs down enemies and pounds them.
  spawnBrute(p, at) {
    const B = RITUAL.brute, s = p.stats;
    const stats = { ...DEFAULT_STATS, health: Math.max(B.minHp, B.hp * this.maxHp(p)), damage: 0, moveSpeed: DEFAULT_STATS.moveSpeed * 1.05, jump: 9, blockCooldown: 99 };
    const spot = this.freeSpot(at.x, at.z, p.pos.x, p.pos.z, PR * B.size, at.y);
    const u = this.spawnUnit('brute', p, spot, { stats, melee: B.melee + B.dmgShare * this.effDamage(s) });
    u.vel.y = 5;
    return u;
  }
  // Sacred Grove level 3: an angel that circles you and heals you, with a turret-style shield bubble. Lasts the round.
  spawnAngel(p) {
    this.players.filter(u => u.kind === 'angel' && u.ownerId === p.id && u.alive).forEach(u => this.expireUnit(u));
    const stats = { ...DEFAULT_STATS, health: Math.max(60, GROVE.angelHp * this.maxHp(p)), damage: 0, moveSpeed: 0, jump: 0, blockCooldown: 99, blockSize: 1.1 };
    const u = this.spawnUnit('angel', p, { x: p.pos.x, y: p.pos.y + 6, z: p.pos.z }, { stats });
    const dur = (p.stats.blockDuration || DEFAULT_STATS.blockDuration) / DEFAULT_STATS.blockDuration;
    const shp = Math.round(GROVE.angelShield * Math.pow(dur, 0.75) * Math.sqrt(p.stats.blockSize || 1));
    u.fx.tshield = { hp: shp, max: shp, brokenT: 0, lastHit: 0 };
    u.orbit = Math.random() * Math.PI * 2;
    this.unitsChanged();
    return u;
  }
  angelThink(u, dt) {
    const p = this.player(u.ownerId);
    if (!p || !p.alive) { this.expireUnit(u); return; }
    u.orbit += dt * 1.3;
    const R = 1.7 * (p.size || 1), want = { x: p.pos.x + Math.cos(u.orbit) * R, y: p.pos.y + 1.9 * (p.size || 1) + Math.sin(this.time * 2.2) * 0.25, z: p.pos.z + Math.sin(u.orbit) * R };
    const k = Math.min(1, dt * 5);
    u.vel = { x: (want.x - u.pos.x) * 5, y: (want.y - u.pos.y) * 5, z: (want.z - u.pos.z) * 5 };
    u.pos = { x: u.pos.x + (want.x - u.pos.x) * k, y: u.pos.y + (want.y - u.pos.y) * k, z: u.pos.z + (want.z - u.pos.z) * k };
    u.aim = norm({ x: p.pos.x - u.pos.x, y: 0, z: p.pos.z - u.pos.z });
    u.size = u.fixedSize; u.fireT -= dt; u.flashT -= dt;
    if (u.fx.tshield) this.updateTurretShield(u, dt);
    if (!p.reviving && p.hp < this.maxHp(p)) p.hp = Math.min(this.maxHp(p), p.hp + GROVE.angelHeal * this.maxHp(p) * dt);
  }
  updateRelics(dt) {
    if (!this.relics || !this.relics.length) return;
    for (const c of this.relics) {
      c.t -= dt; c.fall = Math.max(0, c.fall - dt);
      const p = c.ownerRef;
      if (!p.alive || p.reviving) continue;
      if (c.fall <= 0 && Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < GROVE.crossR && Math.abs(p.pos.y - c.y) < 3 && p.hp < this.maxHp(p)) {
        p.hp = Math.min(this.maxHp(p), p.hp + GROVE.crossHeal * this.maxHp(p) * dt);
      }
    }
    this.relics = this.relics.filter(c => c.t > 0 && c.ownerRef.alive);
  }
  relicRows() {
    const r2 = v => Math.round(v * 100) / 100;
    return (this.relics || []).map(c => [c.id, c.owner, r2(c.x), r2(c.y), r2(c.z), r2(c.fall), r2(c.t)]);
  }
  // Network rows: [id, owner, x, y, z, radius, draw 0-1, deployed, level, progress to next level, open portal 0-1,
  //   charging now, holy (Sacred Grove), owner x, chest y, z]
  ritualRows() {
    const r2 = v => Math.round(v * 100) / 100;
    return this.rituals.map(r => {
      const q = r.portals[r.portals.length - 1];
      const o = r.ownerRef;
      return [r.id, r.owner, r2(r.x), r2(r.y), r2(r.z), r2(r.R), r2(r.draw), r.deployed ? 1 : 0, r.level, r2(r.prog), q ? r2(Math.min(1, q.t / 0.4)) : 0,
        r.hold ? 1 : 0, r.holy ? 1 : 0, r2(o.pos.x), r2(o.pos.y + 0.9 * (o.size || 1)), r2(o.pos.z)];
    });
  }
  hairFull(p) { return !!p && p.smod === 'hair' && p.hairMax > 0 && (p.fx.hair || 0) >= p.hairMax - 0.5; }
  hairFrac(p) { return p.smod === 'hair' && p.hairMax > 0 ? (p.fx.hair || 0) / p.hairMax : -1; }

  // Ice Sheets floes. Small floes slowly sink under anyone standing on them (and bob back up once empty);
  // medium floes tip toward whoever stands near an edge, sliding them off; big floes stay steady.
  floeRules(o, dt) {
    const riders = this.players.filter(p => p.alive && p.ground === o), kind = o.def.floe;
    if (kind === 'small') {
      o.sink = Math.max(0, Math.min(0.75, (o.sink || 0) + (riders.length ? 0.22 : -0.35) * dt));
      o.base.y = o.def.y0 - o.sink;
    } else if (kind === 'med') {
      let ax = 0, az = 0;
      for (const p of riders) {
        const rx = (p.pos.x - o.pos.x) / (o.w / 2), rz = (p.pos.z - o.pos.z) / (o.d / 2);
        if (Math.abs(rx) > 0.45) ax += (rx - Math.sign(rx) * 0.45) / 0.55;
        if (Math.abs(rz) > 0.45) az += (rz - Math.sign(rz) * 0.45) / 0.55;
      }
      const k = Math.min(1, dt * (riders.length ? 0.9 : 1.6));   // tips slowly, settles a bit faster
      o.tx = (o.tx || 0) + (Math.max(-1, Math.min(1, ax)) * 0.24 - (o.tx || 0)) * k;
      o.tz = (o.tz || 0) + (Math.max(-1, Math.min(1, az)) * 0.24 - (o.tz || 0)) * k;
      o.base.y = o.def.y0 - (Math.abs(o.tx) * o.w + Math.abs(o.tz) * o.d) * 0.3;   // the low edge dips toward the water
      for (const p of riders) {   // a steep tilt slides riders toward the low edge
        if (Math.abs(o.tx) > 0.08) p.pos.x += Math.sign(o.tx) * (Math.abs(o.tx) - 0.08) * 14 * dt;
        if (Math.abs(o.tz) > 0.08) p.pos.z += Math.sign(o.tz) * (Math.abs(o.tz) - 0.08) * 14 * dt;
      }
    }
  }
  // Ice Sheets water: only hurts (a little) and slows while you're in it; jump out to stop it.
  waterRules(p) {
    if (p.pos.y > 0.02) return;
    p.fx.wetT = this.time + ICE.wetLinger;   // v26: the chill lingers a moment after you climb out
    if ((p.fx.lavaCd || 0) <= this.time) {
      p.fx.lavaCd = this.time + 0.5;
      if (p.blockT <= 0) this.hurt(p, 3, null, null);
      this.emit({ t: 'splash', p: p.id, x: p.pos.x, y: 0.1, z: p.pos.z });
    }
  }
  // Lava Lake: the floor burns and the edge field zaps. Blocking at the edge throws you back in hard.
  lavaRules(p) {
    if (this.level.ice) return this.waterRules(p);
    const L = this.level, edge = PR * p.size + 0.08;
    if (p.pos.y <= 0.02 && (p.fx.lavaCd || 0) <= this.time) {
      p.fx.lavaCd = this.time + 0.45;
      if (p.blockT > 0) { p.vel.y = 19; this.emit({ t: 'repel', p: p.id, x: p.pos.x, y: 0.5, z: p.pos.z }); }
      else { const k = this.mapHeatK(); this.hurt(p, 10 * k, null, null); this.setBurn(p, 3, 6 * k, null, 'lava'); p.vel.y = 14; }
      this.emit({ t: 'lava', p: p.id, x: p.pos.x, y: 0.1, z: p.pos.z });
    }
    const nearX = Math.abs(p.pos.x) >= L.hx - edge, nearZ = Math.abs(p.pos.z) >= L.hz - edge;
    if ((nearX || nearZ) && (p.fx.edgeCd || 0) <= this.time) {
      p.fx.edgeCd = this.time + 0.4;
      const ix = nearX ? -Math.sign(p.pos.x) : 0, iz = nearZ ? -Math.sign(p.pos.z) : 0;
      if (p.blockT > 0) { p.vel.x = ix * 14; p.vel.z = iz * 14; p.vel.y = 20; this.emit({ t: 'repel', p: p.id, x: p.pos.x, y: p.pos.y + 1, z: p.pos.z }); }
      else { this.hurt(p, 14, null, null); p.vel.x = ix * 8; p.vel.z = iz * 8; p.vel.y = 6; this.emit({ t: 'zap', p: p.id, x: p.pos.x, y: p.pos.y + 1, z: p.pos.z }); }
    }
  }

  // Damage gets a small boost from bullet speed; size gets a small boost from damage.
  effDamage(s) { return s.damage * Math.pow(Math.max(0.2, s.bulletSpeed / DEFAULT_STATS.bulletSpeed), 0.3); }
  effSize(s, dmg) { return clamp(s.bulletSize * Math.pow(Math.max(0.2, dmg / DEFAULT_STATS.damage), 0.25), 0.05, 1.2); }

  // Siphon Shield: damage stopped by your bubble or deployed shield wall heals you (sandbags don't count).
  blockedDamage(q, amt) {
    const lv = q.stats.blockLeech;
    if (!(lv > 0) || !q.alive || q.reviving || !(amt > 0)) return;
    const before = q.hp;
    q.hp = Math.min(this.maxHp(q), q.hp + amt * lv);
    this.healPing(q, before);
    if (q.hp - before >= 1) this.emit({ t: 'leech', p: q.id, a: Math.round(q.hp - before), x: q.pos.x, y: this.chest(q), z: q.pos.z });
  }
  bulletGrav(p) { const s = p.stats; return bulletGravityFor(this.effSize(s, this.effDamage(s))); }

  // encore = an Encore follow-up shot: ignores the fire-rate timer and never queues more follow-ups.
  // v1.2.8: encores are free (no ammo, and they still fire if the shot before emptied the mag).
  tryShoot(p, encore = false) {
    if (p.mod === 'shield' || p.mod === 'katana') return;   // the shield and katana charge instead (updateShieldGun / updateKatana)
    if (!encore && (p.reloadT > 0 || p.fireT > 0 || p.ammo <= 0)) return;
    if (!budgetAllow(this, p)) return;   // v1.2.25: too many of your shots in the air (no ammo used)
    const s = p.stats;
    if (!encore) { p.fireT = 1 / (s.fireRate * (s.runGun > 0 && Math.hypot(p.input.mx || 0, p.input.mz || 0) >= 0.1 ? 1 + s.runGun : 1)); p.ammo--; }   // (v1.2.15 Running Gun)
    if (!encore && s.encore > 0 && p.mod !== 'critter') {
      const n = Math.floor(s.encore) + (Math.random() < s.encore % 1 ? 1 : 0);
      if (n > 0) {   // v1.2.11: added to the queue (a fast next shot used to wipe the encores still waiting from the last one)
        const q = p.encoreQ || (p.encoreQ = []);
        for (let k = 0; k < n; k++) q.push({ t: ENCORE.gap * (k + 1) });
        q.sort((a, b) => a.t - b.t);
      }
    }
    const boost = this.shotBoost(p, encore), b0 = this.bullets.length;   // v1.2.15: Tight Chamber, Cold Barrel, Battle Rhythm, Payback, Gambler's Mag
    const n = Math.min(12, Math.round(s.projectiles * boost.proj));
    if (p.mod && p.mod !== 'tank') { this.fireMod(p, n); this.applyBoost(p, boost, b0); if (p.ammo <= 0) this.startReload(p); return; }   // Tiny Tank fires normal bullets
    if (s.skyfall > 0) {
      // Locked to where you aimed when you fired, kept inside the arena.
      const L = this.level;
      const lock = { x: clamp(p.aimPoint.x, -L.hx + 0.5, L.hx - 0.5), y: Math.max(0.3, p.aimPoint.y), z: clamp(p.aimPoint.z, -L.hz + 0.5, L.hz - 0.5) };
      for (let k = 0; k < n; k++) {
        const o = { x: p.pos.x + (Math.random() - 0.5) * 2, y: Math.max(RULES.skyfallHeight, this.flyHeight + 4), z: p.pos.z + (Math.random() - 0.5) * 2 };
        const off = (k - (n - 1) / 2) * 0.9;
        const tgt = { x: lock.x + off * -p.aim.z, y: lock.y, z: lock.z + off * p.aim.x };
        const b = this.spawnBullet(p, o, norm({ x: tgt.x - o.x, y: tgt.y - o.y, z: tgt.z - o.z }), Math.max(s.bulletSpeed, 30), true);
        b.lock = tgt;
      }
      this.emit({ t: 'skyLock', p: p.id, x: lock.x, y: lock.y, z: lock.z });
    } else {
      // First person (v26): fire from the eye along the exact line to the crosshair point, with just enough loft that the
      // bullet's drop lands it on that point (no chest offset, no auto-aim upward).
      const ap = p.aimPoint, fpEye = p.input && p.input.fp && p.kind === 'hero' && !this.level.side && !(s.tank > 0) && ap;
      let base = p.aim, eye = null;
      if (fpEye) {
        eye = { x: p.pos.x, y: p.pos.y + RULES.eye * p.size * (p.crouch ? 0.7 : 1), z: p.pos.z };
        const dx = ap.x - eye.x, dz = ap.z - eye.z, flat = Math.hypot(dx, dz), t = flat / Math.max(1, s.bulletSpeed);
        const dy = ap.y - eye.y + (flat < 35 ? 0.5 * this.bulletGrav(p) * t * t : 0);   // (past 35 m: straight down the view line)
        if (flat > 0.3) base = norm({ x: dx, y: dy, z: dz });
      }
      for (let k = 0; k < n; k++) {
        const d = norm(rotY(base, (k - (n - 1) / 2) * s.spread));
        const o = eye ? { x: eye.x + d.x * 0.3, y: eye.y + d.y * 0.3, z: eye.z + d.z * 0.3 } : { x: p.pos.x + d.x * 0.75 * p.size, y: this.chest(p) + d.y * 0.75, z: p.pos.z + d.z * 0.75 * p.size };
        this.spawnBullet(p, o, d, s.bulletSpeed, false);
      }
    }
    this.applyBoost(p, boost, b0);
    this.emit({ t: 'shoot', p: p.id, x: p.pos.x, y: this.chest(p), z: p.pos.z, sky: s.skyfall > 0 ? 1 : 0 });
    if (p.ammo <= 0) this.startReload(p);
  }

  // ---------------------------------------------------------- weapon mods
  fireMod(p, n) {
    const s = p.stats, from = { x: p.pos.x, y: this.chest(p), z: p.pos.z }, rnd = a => (Math.random() - 0.5) * a;
    if (p.mod === 'flamethrower') {
      // Short-lived flames; bullet speed stretches the range. Hits burn for 3 s at a steady rate.
      for (let k = 0; k < 3 * n; k++) {
        const d = norm(rotY({ x: p.aim.x, y: p.aim.y + rnd(0.15), z: p.aim.z }, rnd(0.45)));
        const b = this.spawnBullet(p, { x: from.x + d.x * 0.7, y: from.y, z: from.z + d.z * 0.7 }, d, s.bulletSpeed * 0.55, false);
        Object.assign(b, { life: 0.42 * (s.bulletSpeed / 28), r: 0.22, pierce: true, flame: true, grav: -1.5, bLeft: 0, explosive: 0, homing: 0, drill: 0, fx: 'flame', color: '#ff8a2a' });
      }
    } else if (p.mod === 'scattergun') {
      // 10 pellets in a tight cone, each 32% of your damage (3.2x per shot if they all land).
      for (let k = 0; k < SCATTER.pellets * n; k++) {
        const d = norm(rotY({ x: p.aim.x, y: p.aim.y + rnd(SCATTER.vSpread), z: p.aim.z }, rnd(SCATTER.spread)));
        const b = this.spawnBullet(p, { x: from.x + d.x * 0.7, y: from.y, z: from.z + d.z * 0.7 }, d, s.bulletSpeed * (0.92 + Math.random() * 0.16), false);
        Object.assign(b, { dmg: b.dmg * SCATTER.dmg, r: b.r * 0.7 });   // v28: pellets keep a normal bullet's life (no short range cut)
      }
    } else if (p.mod === 'grenade') {
      // Lobbed: each grenade is thrown on a heavy arc that lands on the spot you aim at (not along the bullet line).
      const ap = p.aimPoint || { x: from.x + p.aim.x * 12, y: 0, z: from.z + p.aim.z * 12 };
      for (let k = 0; k < n; k++) {
        let hx = ap.x - from.x, hz = ap.z - from.z; const hl = Math.hypot(hx, hz);
        let ux = hl > 0.05 ? hx / hl : p.aim.x, uz = hl > 0.05 ? hz / hl : p.aim.z; { const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul; }
        const off = (k - (n - 1) / 2) * 0.9, tx = ap.x - uz * off, tz = ap.z + ux * off;
        const o = { x: from.x + ux * 0.7, y: from.y + 0.2, z: from.z + uz * 0.7 };
        const dist = Math.max(1, Math.hypot(tx - o.x, tz - o.z)), dy = (ap.y ?? 0) - o.y;
        const th = Math.max(0.6, Math.atan2(dy, dist) + 0.35), ct = Math.cos(th), den = 2 * ct * ct * (dist * Math.tan(th) - dy);
        const v = clamp(den > 0 ? Math.sqrt(GRENADE.grav * dist * dist / den) : GRENADE.maxSpeed, 5, GRENADE.maxSpeed);
        const dx = (tx - o.x) / dist, dz = (tz - o.z) / dist;
        const d = { x: dx * ct, y: Math.sin(th), z: dz * ct };
        const b = this.spawnBullet(p, o, d, v, false);
        const tFly = dist / Math.max(0.1, v * ct);
        Object.assign(b, { grav: GRENADE.grav, bLeft: 4 + b.bLeft, fuse: Math.max(GRENADE.fuse, tFly + 0.5), explosive: Math.max(1, b.explosive), r: Math.max(0.18, b.r), dmg: b.dmg * 1.3, fx: 'grenade', homing: 0 });
        if (this.level.side) { b.vel.z = 0; b.pos.z = 0; }
      }
    } else if (p.mod === 'critter') {
      for (let k = 0; k < n; k++) this.spawnCritter(p, (k - (n - 1) / 2) * 0.6);
      this.unitsChanged();
    } else if (p.mod === 'beam') {
      for (let k = 0; k < n; k++) this.fireBeam(p, from, norm(rotY(p.aim, (k - (n - 1) / 2) * 0.05)));
    }
    this.emit({ t: 'shoot', p: p.id, x: from.x, y: from.y, z: from.z, mod: p.mod });
  }

  // Beam Rifle: hitscan along your aim, stopped by shields. It bounces off walls and the floor (Bounces stat) and
  // carries your other bullet effects: ignite, poison, chill, hex, chain, sticky bombs, knockback, explosions,
  // shrapnel and napalm at impact points, and the bounce cards (boost, explode, re-aim).
  fireBeam(p, from, d) {
    const s = p.stats;
    const proto = this.spawnBullet(p, from, d, s.bulletSpeed, false); this.bullets.pop();   // the beam's "bullet" (all gun effects), never flown
    const b = { ...proto, beam: true };
    let o = { ...from }, bouncesLeft = Math.round(s.bounces), range = 70, hitAny = false;
    for (let leg = 0; leg <= 20 && range > 0.5; leg++) {
      let x = o.x, y = o.y, z = o.z, hit = null, solid = null, floor = false, px = x, py = y, pz = z, t = 0;
      for (t = 0.2; t < range; t += 0.2) {
        px = x; py = y; pz = z;
        x = o.x + d.x * t; y = o.y + d.y * t; z = o.z + d.z * t;
        if (y < 0) { floor = true; break; }
        solid = pointInSolid(this.solids, x, y, z, 0);
        if (solid) break;
        const box = this.shields.find(sb => sb.box && sb.hp > 0 && this.isEnemy(p, sb.ownerRef) && this.inBox(sb, x, y, z) && !this.inBox(sb, o.x, o.y, o.z));
        if (box) { this.soakBox(box, b.dmg); this.emit({ t: 'block', p: box.owner, x, y, z }); range = 0; break; }
        const wall = this.shields.find(sb => !sb.box && sb.owner !== p.id && this.isEnemy(p, sb.ownerRef) && y > sb.y0 - 0.1 && y < sb.y0 + sb.h + 0.1 && (([lx, lz]) => Math.abs(lx) < sb.w / 2 + 0.1 && Math.abs(lz) < sb.d / 2 + 0.1)(this.shieldLocal(sb, x, z)));
        if (wall) { this.emit({ t: 'block', p: wall.owner, x, y, z }); range = 0; break; }   // v1.2.9 (Devin): an enemy Bastion Wall stops the Beam Rifle
        hit = this.players.find(q => q.alive && !q.reviving && q !== p && Math.abs(q.pos.x - x) < PR * q.size && Math.abs(q.pos.z - z) < PR * q.size && y > q.pos.y && y < q.pos.y + PH * q.size);
        if (hit) break;
      }
      range -= t;
      this.emit({ t: 'beam', p: p.id, x1: o.x, y1: o.y, z1: o.z, x2: x, y2: y, z2: z });
      b.pos = { x, y, z }; b.vel = { x: d.x * s.bulletSpeed, y: d.y * s.bulletSpeed, z: d.z * s.bulletSpeed };
      if (hit) {
        if (this.canHurt(p, hit)) {
          if (this.shielded(hit) || (hit.mod === 'shield' && this.shieldGunBlocks(hit, { pos: { x, y, z } }))) { this.soakShield(hit, b.dmg); this.emit({ t: 'block', p: hit.id, x, y, z }); }
          else {
            this.applyHit(b, hit, d); hitAny = true;
            if (b.explosive > 0) this.explode(b.pos, b.dmg, p, { extra: Math.max(0, Math.round(b.explosive) - 1), knock: b.knockback, noSelf: true });
            if (b.shrapnel > 0) this.shrapnelBurst(b, hit);   // v1.1.2: shrapnel bursts on players too
            if (b.napalm > 0) { const gy = groundBelow(this.solids, hit.pos.x, hit.pos.z, hit.pos.y + 0.3); this.napalmSplat(b, { x: hit.pos.x, y: gy, z: hit.pos.z }, { x: 0, y: 1, z: 0 }, null); }
          }
        }
        break;
      }
      if (range <= 0.5 && !solid && !floor) break;   // out of range in open air (or stopped by a shield)
      // Impact on a wall or the floor: work out which face was crossed, then splat / burst / bounce.
      let ax = 'y';
      if (solid) {
        if (pointInSolid([solid], x, py, pz, 0) && !pointInSolid([solid], px, py, pz, 0)) ax = 'x';
        else if (pointInSolid([solid], px, py, z, 0) && !pointInSolid([solid], px, py, pz, 0)) ax = 'z';
      }
      b.pos = { x: px, y: Math.max(0.02, py), z: pz };
      if (b.napalm > 0) {
        if (solid) this.napalmSplatSolid({ ...b, pos: { x, y, z } }, solid, ax, { x: px, y: py, z: pz });
        else this.napalmSplat(b, { x, y: 0, z }, { x: 0, y: 1, z: 0 }, null);
      }
      if (bouncesLeft <= 0) {
        if (b.explosive > 0) this.explode(b.pos, b.dmg, p, { extra: Math.max(0, Math.round(b.explosive) - 1), knock: b.knockback });
        if (b.shrapnel > 0) this.shrapnelBurst(b);   // walls and the floor
        break;
      }
      bouncesLeft--;
      d = { ...d }; d[ax] = -d[ax];
      b.vel = { x: d.x * s.bulletSpeed, y: d.y * s.bulletSpeed, z: d.z * s.bulletSpeed };
      b.splitChild = true;   // a beam doesn't split on bounces
      this.onBounce(b);
      d = norm(b.vel);
      o = { ...b.pos };
    }
    return hitAny;
  }

  startReload(p) {
    if (p.reloadT > 0 || p.ammo >= p.stats.ammo) return;
    if (this.salvoOn(p)) { p.ammo = Math.round(p.stats.ammo); this.gambleRoll(p); this.emit({ t: 'nc', k: 'salvo', p: p.id }); return; }   // v1.2.15 Opening Salvo: instant reloads
    p.reloadT = p.stats.reloadTime;
    this.emit({ t: 'reload', p: p.id });
  }

  // free = triggered by an effect (e.g. Echo Shield): ignores and doesn't reset the cooldown.
  tryBlock(p, free = false) {
    if (!p.alive || p.reviving || p.noBlock || (!free && p.blockCdT > 0)) return;
    // Pentagram: pressing block only starts the drawing (hold to draw); its block effects fire once it's fully drawn.
    if ((p.smod === 'ritual' || p.smod === 'grove' || p.smod === 'spaceking') && !free) return;
    const s = p.stats;
    if (!free) p.blockCdT = s.blockCooldown;
    p.fx.blockAt = this.time;   // v1.2.15 Perfect Parry
    if (!free) this.ncBlock(p);   // v1.2.15: Afterimage, Snare Plate, Scorched Floor, Swap Shot
    // Shield mods. Clone replaces the block entirely: no bubble and no block effects, just the clone.
    if (p.smod === 'clone') { if (!free) this.spawnClone(p); return; }
    p.fx.deploy = this.planDeploys(p);   // where this block's turret / walls / mines go
    if (p.smod === 'rewind' && !free) this.rewindBlink(p);
    if (p.smod === 'pillar') { if (!free) this.raisePillar(p); }
    else if (s.blockDeploy > 0) this.deployShield(p);
    else if (p.smod === 'hair' || p.smod === 'ritual' || p.smod === 'grove' || p.smod === 'spaceking') { /* no personal bubble: the hair / circle replaces it */ }
    else { p.blockT = Math.max(p.blockT, s.blockDuration); p.blockExtra = 0; p.blockReflects = 0; }
    this.emit({ t: 'blockOn', p: p.id, x: p.pos.x, y: this.chest(p), z: p.pos.z, deploy: s.blockDeploy > 0 ? 1 : 0, size: s.blockSize });
    if (s.blockShock > 0) this.shockBurst(p);
    if (s.blockPush > 0) {
      const R = 3.5 * s.blockSize;
      for (const q of this.players) {
        if (!q.alive || q.reviving || !this.isEnemy(p, q)) continue;
        const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, d = Math.hypot(dx, dz);
        if (!(d < R && d > 0.01)) continue;
        if (BRAWL_ON && q.kind === 'hero') { if (!((q.fx.invulnT || 0) > this.time)) brawlLaunch(this, q, s.blockPush * (1.2 - 0.6 * d / R), { x: dx / d, y: 0.5, z: 0 }); continue; }   // v1.2.13: Brawl: a real launch that grows with damage %
        const f = s.blockPush * (1 - d / R) / q.size; q.vel.x += dx / d * f; q.vel.z += dz / d * f; q.vel.y += f * 0.3;
      }
      this.emit({ t: 'push', p: p.id, x: p.pos.x, y: this.chest(p), z: p.pos.z, r: R });
    }
    if (s.blockDash > 0 && p.smod !== 'rewind') {
      let dx = p.input.mx, dz = p.input.mz;
      if (Math.hypot(dx, dz) < 0.1) { dx = p.aim.x; dz = p.aim.z; }
      const l = Math.hypot(dx, dz) || 1;
      p.vel.x = dx / l * s.blockDash; p.vel.z = dz / l * s.blockDash; p.vel.y = Math.max(p.vel.y, 2.5);
    }
    if (p.smod === 'slam' && !free) { p.vel.y = Math.max(p.vel.y, 13); p.onGround = false; p.fx.slam = { t: 0 }; }
    runHook('onBlock', this, p);
    if (p.smod === 'turret') this.placeTurret(p);
    if (p.smod === 'mount' && !free) this.placeMount(p);
    p.fx.deploy = null;
  }

  // Shock Bubble: one burst of lightning through the floor around you each time you block (like the Bullet Time field's area).
  shockBurst(p) {
    const s = p.stats, R = SHOCK.radius * Math.sqrt(Math.max(0.5, s.blockSize)) * Math.max(1, p.size * 0.8), dmg = s.blockShock * SHOCK.dmgK;
    const gy = p.pos.y;
    for (const q of this.players) {
      if (!q.alive || q.reviving || !this.isEnemy(p, q)) continue;
      if (Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z) > R + PR * q.size || Math.abs(q.pos.y - gy) > SHOCK.height) continue;
      this.hurt(q, dmg, p, null);
      if (!q.heavy) { q.fx.chillK = Math.max((q.fx.chillT || 0) > this.time ? q.fx.chillK || 0 : 0, 0.6); q.fx.chillT = Math.max(q.fx.chillT || 0, this.time + SHOCK.stun); }
    }
    this.emit({ t: 'shockArea', p: p.id, x: p.pos.x, y: gy, z: p.pos.z, r: Math.round(R * 100) / 100 });
  }
  spawnBullet(p, o, d, speed, sky) {
    const s = p.stats, dmg = this.effDamage(s), r = this.effSize(s, dmg);
    const b = {
      id: this.nextId++, owner: p.id, ownerRef: p, color: p.color, cown: p.id,   // cown: original shooter (keeps the bullet's color after a block)
      pos: { ...o }, vel: { x: d.x * speed, y: d.y * speed, z: d.z * speed },
      r, dmg, bLeft: Math.round(s.bounces), explosive: s.explosive, homing: s.homing,
      knockback: s.knockback, drill: s.drill, life: sky ? 5 : 4, bounced: false, sky, alive: true, aiSeen: {}, hold: null,
      poison: s.poison, ignite: s.ignite, chill: s.chill, hex: s.hex, chain: s.chain, limpet: s.limpet, shrapnel: s.shrapnel, napalm: s.napalm || 0,
      bounceTarget: s.bounceTarget || 0, bounceExplode: s.bounceExplode || 0, bounceBoost: s.bounceBoost || 0, bounceSplit: s.bounceSplit || 0, ring: s.ringHit || 0,
      grav: bulletGravityFor(r) * (this.level && this.level.side ? SIDE_BULLET_GRAV : 1),   // bigger bullets drop harder (2D: much harder, for skill arcs)
      toxic: s.toxic || 0, swarm: s.bees > 0 ? 'bee' : s.squid > 0 ? 'squid' : null,
    };
    if (b.swarm) {
      b.fx = b.swarm; b.grav = 0; b.life = SWARM[b.swarm].life; b.swPh = Math.random() * 0.3; b.swT = 0; if (b.swarm === 'squid') b.homing = 0;
      if (b.swarm === 'bee') {   // v28: each bee leaves at its own angle and keeps its own weave, so the swarm spreads out instead of clumping
        const SB = SWARM.bee, a = (Math.random() - 0.5) * 2 * SB.spread, side = this.level && this.level.side;
        const v = side ? { x: b.vel.x * Math.cos(a) - b.vel.y * Math.sin(a), y: b.vel.x * Math.sin(a) + b.vel.y * Math.cos(a), z: 0 } : rotY(b.vel, a);
        if (!side) v.y += (Math.random() - 0.3) * len(b.vel) * 0.25;
        b.vel = v; b.swOff = Math.random() * Math.PI * 2; b.swWob = (0.6 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1);
      }
    }
    this.bullets.push(b); budgetAdd(this, p);
    return b;
  }

  // v1.2.9 (Devin): during sudden death / overtime in versus modes, damage doubles every 10 s (x2 at 10 s, x4 at 20 s...).
  suddenMul() {
    if (!this.overtime || this.isWaves() || this.overtimeAt == null) return 1;
    const n = Math.min(8, Math.floor((this.time - this.overtimeAt) / 10));
    if (n > (this.odx || 0)) { this.odx = n; this.emit({ t: 'suddenX', x: 2 ** n }); }
    return 2 ** n;
  }
  hurt(t, amt, src, dir, quiet) {
    const tag = this.dmgTag || (quiet ? 'dot' : 'hit'); this.dmgTag = null;   // v1.2.11: what kind of damage, for the death recap
    if (!t.alive || t.reviving || this.phase !== 'play') return;
    if ((t.fx.invulnT || 0) > this.time) return;
    if (amt > 0) this.lastDmgT = this.time;   // (v1.2.26: a units-only standoff with no damage ends in a draw)
    // v1.2.15 Gilded Shell: a hit (not burn / poison ticks) that would hurt you just shatters a shell instead
    if ((t.fx.shell || 0) > 0 && !quiet && amt >= 1 && src !== t && this.canHurt(src, t)) {
      t.fx.shell--; t.flashT = 0.12;
      this.emit({ t: 'nc', k: 'shell', p: t.id, n: t.fx.shell, x: t.pos.x, y: this.chest(t), z: t.pos.z });
      return;
    }
    if (t.veh && t.veh.hp != null && amt > 0 && owCarHit(this, t, amt, src)) return;   // open world: in a car, the car takes the damage
    if ((t.fx.hexT || 0) > this.time) amt *= 1 + (t.fx.hexK || 0.25);
    if (amt > 0 && src && src !== t) amt *= this.suddenMul();   // v1.2.9: sudden death doubles damage every 10 s
    if (amt > 0 && src && src !== t && this.hairFull(src) && this.isEnemy(src, t)) amt *= HAIR.fullDamage;   // v1.0.1: full Super Saiyan Hair
    // Super Saiyan Hair: the hair's pool takes the damage before your own health does.
    let soaked = 0;
    if (t.smod === 'hair' && (t.fx.hair || 0) > 0 && amt > 0) {
      soaked = Math.min(amt, t.fx.hair); t.fx.hair -= soaked;
      if (t.fx.hair <= 0.001) { t.fx.hair = 0; this.emit({ t: 'hairOut', p: t.id, x: t.pos.x, y: t.pos.y + 1.6 * t.size, z: t.pos.z }); }
    }
    // Sacred Grove level 1: a holy shield soaks damage for a few seconds.
    const hs = t.fx.holyShield;
    if (hs && amt - soaked > 0) {
      if (hs.until <= this.time || hs.hp <= 0) t.fx.holyShield = null;
      else { const k = Math.min(amt - soaked, hs.hp); hs.hp -= k; soaked += k; if (hs.hp <= 0.001) { t.fx.holyShield = null; this.emit({ t: 'shieldBreak', p: t.id, x: t.pos.x, y: this.chest(t), z: t.pos.z }); } }
    }
    // v1.2.20 Gun Nest (Devin): manning the turret puts a small shield on you; what hits it hurts the turret, until the turret is gone
    const mu = t.fx.mount && amt - soaked > 0 ? this.player(t.fx.mount.id) : null;
    if (mu && mu.alive && mu.hp > 0) {
      const k = Math.min(amt - soaked, mu.hp); mu.hp -= k; soaked += k; mu.flashT = 0.12;
      if (mu.hp <= 0.001) { mu.hp = 0; this.emit({ t: 'shieldBreak', p: t.id, x: t.pos.x, y: this.chest(t), z: t.pos.z }); }
    }
    const rest = amt - soaked;
    const dealt = Math.max(0, BRAWL_ON && t.kind === 'hero' ? amt : soaked + Math.min(rest, Math.max(0, t.hp)));   // v1.0.1: brawl fighters sit at 1 hp, so count the whole hit
    if (t.kind === 'hero' && dealt > 0) this.logDamage(t, src, tag, dealt);
    const hp0 = t.hp;
    t.hp -= rest; if (!quiet) t.flashT = 0.12;   // steady damage (burn, poison, shock) shows its own effect instead of a white flash
    if (this.isPractice() && this.settings.practiceGod && !t.isBot && t.kind === 'hero' && t.hp < 1) t.hp = 1;   // practice: you can't die
    if (BRAWL_ON && t.kind === 'hero' && amt > 0) brawlHit(this, t);   // a hit lets go of a ledge; two break a dash charge
    if (dir && BRAWL_ON && t.kind === 'hero') brawlLaunch(this, t, amt, dir, src);   // brawl: launches grow with damage %
    else if (dir && !t.heavy) { // hidden knockback (the boss and portals don't budge): every hit pushes, harder the more damage it does (stacks with the Knockback stat)
      const k = Math.min(RULES.hitKnockMax, RULES.hitKnockBase + amt * RULES.hitKnockPerDamage) / t.size;
      t.vel.x += dir.x * k; t.vel.z += dir.z * k;
      if (SIDE_ON && dir.y) t.vel.y += dir.y * k;
      if (amt > 30) t.vel.y += Math.min(3, (amt - 30) * 0.03) / t.size;
    }
    const enemyHit = src && src !== t && this.isEnemy(src, t);
    if (enemyHit) { t.fx.lastSrc = src; t.fx.lastSrcT = this.time; }
    if (rest > 0 && t.hp > 0) this.ncHurt(t, rest, enemyHit);   // v1.2.15: Last Stand Rig, Payback   // side view: a pit or edge kill credits whoever hit you last
    const credit = this.creditOf(src);
    // Scavenger: damage to health (not a shield, hair pool or deployable) reloads the shooter to full.
    if (enemyHit && rest > 0 && src.alive && src.stats.scavenge > 0 && !this.isTurret(t) && t.kind !== 'portal') {
      if (src.ammo < src.stats.ammo || src.reloadT > 0) { src.ammo = Math.round(src.stats.ammo); src.reloadT = 0; if ((src.fx.scavT || 0) < this.time) { src.fx.scavT = this.time + 0.4; this.emit({ t: 'scavenge', p: src.id }); } }
    }
    if (enemyHit) {
      if (credit && credit.kind === 'hero') credit.tally.damage += dealt;
      if (src.alive && src.stats.lifesteal) { const h0 = src.hp; src.hp = Math.min(this.maxHp(src), src.hp + amt * src.stats.lifesteal); this.healPing(src, h0); }
      if (src.alive) runHook('onDealDamage', this, src, t, dealt);
    }
    if (!quiet || t.hp <= 0) this.emit({ t: 'hit', p: t.id, s: src ? src.id : null, x: t.pos.x, y: this.chest(t), z: t.pos.z, a: Math.round(amt) });
    if (BRAWL_ON && t.kind === 'hero' && t.hp < 1) { t.fx.bOver = (t.fx.bOver || 0) + (1 - t.hp); t.hp = 1; }   // brawl: damage never knocks a fighter out, only the blast zones do
    // Clone shield mod: dying with a clone up moves you into it (Phoenix only gets the last body).
    if (t.hp <= 0 && t.smod === 'clone' && t.kind === 'hero') {
      const c = this.players.find(u => u.kind === 'clone' && u.ownerId === t.id && u.alive && !u.reviving);
      if (c) { this.swapToClone(t, c); return; }
    }
    if (t.hp <= 0 && runHook('onDeath', this, t)) return;
    if (t.hp <= 0) {
      t.hp = 0; t.alive = false; t.tally.deaths++;
      // v1.0.1: a death to the map (lava, spikes, the storm, a fall) credits whoever hit them in the last 6 s
      const late = !src && t.fx.lastSrc && this.time - (t.fx.lastSrcT || -99) < 6 ? this.creditOf(t.fx.lastSrc) : null;
      if (enemyHit && credit && credit.kind === 'hero') credit.tally.kills++;
      else if (late && late !== t && late.kind === 'hero' && this.isEnemy(late, t)) late.tally.kills++;
      this.emit({ t: 'death', p: t.id, k: src ? src.id : null, x: t.pos.x, y: t.pos.y + 0.8, z: t.pos.z, ...(t.kind === 'hero' ? this.deathRecap(t, tag) : {}) });
      if (t.kind === 'hero') this.lastKill = { t: this.time, p: t.id, k: src ? src.id : null };   // (v1.2.15 kill cam)
      this.ncDeath(t, src, enemyHit ? credit : null, rest - Math.max(0, hp0), dir, quiet);   // v1.2.15: Spite Charge, Overpen Rounds, Squad Caller
      if (t.kind === 'splitter' && (t.gen || 0) < 2) this.splitBlob(t);
      else if (t.kind === 'splitter') addBlotch(this, t, t.pos.x, t.pos.z, 1.3, (t.melee || 8) * 0.35, 5);   // smallest blobs leave a poison puddle
      if (t.kind === 'boss' && !t.kingOf) bossDown(this, t);
      if (t.kind === 'clone') this.cloneInherit(t);
      if (t.kind === 'angel') this.emit({ t: 'angelUp', p: t.id, x: t.pos.x, y: t.pos.y, z: t.pos.z });
    }
  }

  // v1.2.11 death recap: who hurt a hero in the last DLOG_WINDOW seconds, by source and kind (shots, explosions, fire...).
  logDamage(t, src, tag, a) {
    const L = t.fx.dlog || (t.fx.dlog = []), now = this.time, sid = src ? src.id : null;
    while (L.length && now - L[0].t > 8) L.shift();
    const e = L.length && L.find(x => x.s === sid && x.k === tag);
    if (e) { e.a += a; e.t = now; L.splice(L.indexOf(e), 1); L.push(e); }
    else { L.push({ s: sid, k: tag, a, t: now, o: src && src.kind !== 'hero' ? src.ownerId ?? null : null, n: src && src.kind !== 'hero' ? src.name || null : null }); if (L.length > 16) L.shift(); }
  }
  deathRecap(t, tag) {
    const L = (t.fx.dlog || []).filter(x => this.time - x.t <= 8).sort((a, b) => b.a - a.a).slice(0, 5);
    return { kk: tag, dl: L.map(x => x.n ? [x.s, x.k, Math.round(x.a), x.o, x.n] : [x.s, x.k, Math.round(x.a)]) };   // units: + owner id, name (they may be gone by the time it shows)
  }

  // v1.2.23 Brawl HUD rows: [id, damage %, stocks, fighter, air jump left, air dash ready, power-up kind or 0]
  brawlRows() {
    return this.heroes().filter(p => p.connected).map(p => [p.id, Math.round(p.pct || 0), p.stocks || 0, p.fighter || 'classic', p.fx.airJ || 0, p.fx.dashUsed ? 0 : 1, p.fx.bItem && p.fx.bItem.t > this.time ? p.fx.bItem.k : 0]);
  }
  // ---------------------------------------------------------- bullet hits
  applyHit(b, q, dir) {
    const src = b.ownerRef, hm = this.ncHitMul(b, q);   // v1.2.15: Pressure Stack, Bounty Mark
    // v1.2.21 (Devin): poison rides on top of the bullet's own damage (it used to replace it); the poison share is smaller to make room
    if (b.poison > 0) this.addPoison(q, src, b.poison);
    if (b.flame) {
      this.hurt(q, b.dmg * 0.25 * hm, src, null, true);
      this.setBurn(q, 3, b.dmg * 0.6, src, src);   // a flamethrower stream is one burn (refreshed), not a stack per flame
    } else { this._hitCown = b.cown; this.hurt(q, b.dmg * hm, src, dir); this._hitCown = null; }   // (v1.2.26: an Overpen fragment stays the original shooter's)
    this.ncOnHit(b, q, hm);   // v1.2.15: Ammo Leech, Battle Rhythm, Bounty heal, Gravity Well
    if (b.ignite > 0) this.setBurn(q, 3, b.dmg * 0.18 * b.ignite, src);
    if (b.chill > 0) { q.fx.chillK = Math.max((q.fx.chillT || 0) > this.time ? q.fx.chillK || 0 : 0, Math.min(0.65, 0.4 + 0.1 * (b.chill - 1))); q.fx.chillT = this.time + 1.5 * b.chill; }   // stacked chill slows harder
    if (b.hex > 0) { q.fx.hexK = Math.max((q.fx.hexT || 0) > this.time ? q.fx.hexK || 0 : 0, 0.25 * Math.min(4, b.hex)); q.fx.hexT = this.time + 2.5; }   // stacked Hex: +25% per level
    if (b.knockback > 0 && dir && !q.heavy && q.stats.moveSpeed > 0) {   // Thruster: a small shove now, then a push that lasts (see THRUST)
      const f = b.knockback * b.dmg * 0.08 * THRUST.impulse / q.size; q.vel.x += dir.x * f; q.vel.z += dir.z * f; q.vel.y += Math.min(3, f * 0.25);
      this.addThrust(q, dir, b);
    }
    if (b.limpet > 0) this.booms.push({ t: 1.0, follow: q, pos: { ...q.pos }, dmg: b.dmg * 0.6 * b.limpet, owner: src, opts: { cown: b.cown } });
    if (b.chain > 0 && !b.chained) {
      let best = null, bd = 6;
      for (const o of this.players) {
        if (o === q || !o.alive || o.reviving || !this.isEnemy(src, o) || this.ownShot(b, o)) continue;
        const d = Math.hypot(o.pos.x - q.pos.x, o.pos.z - q.pos.z);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) {
        this.emit({ t: 'chain', x1: q.pos.x, y1: this.chest(q), z1: q.pos.z, x2: best.pos.x, y2: this.chest(best), z2: best.pos.z });
        this.applyHit({ ...b, chained: true, chain: 0, limpet: 0, dmg: b.dmg * 0.4 * b.chain }, best, dir);
      }
    }
  }
  shrapnelBurst(b, hitQ = null) {
    const n = budgetRoom(this) ? 3 * Math.round(b.shrapnel) : 0;   // (v1.2.25: none once the shot budget is used up)
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, d = norm({ x: Math.cos(a), y: 0.2 + Math.random() * 0.4, z: Math.sin(a) });
      const f = this.spawnBullet(b.ownerRef, { x: b.pos.x + d.x * 0.3, y: Math.max(0.3, b.pos.y), z: b.pos.z + d.z * 0.3 }, d, 18, false);
      Object.assign(f, { dmg: b.dmg * 0.3, r: 0.07, grav: bulletGravityFor(0.07), life: 0.4, bounced: true, shrapnel: 0, explosive: 0, bLeft: 0, poison: 0, limpet: 0, chain: 0, napalm: 0,
        color: b.color, cown: b.cown, ignite: b.ignite, chill: b.chill, hex: b.hex, knockback: b.knockback, homing: 0, drill: 0, ring: 0,
        bounceTarget: 0, bounceExplode: 0, bounceBoost: 0, bounceSplit: 0, noHit: hitQ ? hitQ.id : null, swarm: null, fx: undefined });   // v1.2.11: fragments are never bees / squid
    }
  }
  splitBlob(t) {
    for (const s of [-1, 1]) {
      const stats = { ...t.stats, health: t.stats.health * 0.45, moveSpeed: t.stats.moveSpeed * 1.12 };
      const c = this.spawnUnit('wave', null, { x: t.pos.x + s * 0.8, y: t.pos.y, z: t.pos.z + s * 0.5 },
        { stats, unitKind: 'splitter', name: t.name, color: t.color, difficulty: t.difficulty });
      c.gen = (t.gen || 0) + 1; c.fixedSize = t.fixedSize * 0.72; c.melee = t.melee * 0.75;
      c.vel = { x: s * 5, y: 6, z: 0 };
    }
    this.emit({ t: 'split', x: t.pos.x, y: t.pos.y + 0.5, z: t.pos.z, units: this.unitList() });
  }
  unitList() { return this.players.filter(p => p.transient).map(u => ({ id: u.id, name: u.name, color: u.color, team: u.team, kind: u.kind, ownerId: u.ownerId, cosmetics: u.cosmetics, ...(u.am ? { am: u.am } : {}) })); }

  // Explosion size comes from damage. extra = additional explosions, one second apart.
  explode(pos, dmg, owner, opts = {}) {
    const R = (1.4 + 0.6 * Math.sqrt(Math.max(1, dmg) / DEFAULT_STATS.damage)) * (opts.rmul || 1);
    this.emit({ t: 'boom', x: pos.x, y: pos.y, z: pos.z, r: R, p: owner ? owner.id : null });
    for (const q of this.players) {
      if (!q.alive || q.reviving) continue;
      const cx = q.pos.x - pos.x, cy = this.chest(q) - pos.y, cz = q.pos.z - pos.z, d = Math.hypot(cx, cy, cz);
      if (d >= R || this.ownShot(opts, q)) continue;
      if (this.shielded(q)) { if (q !== owner && this.canHurt(owner, q)) { this.blockedDamage(q, dmg * (opts.full ? 1 : 0.6)); this.soakShield(q, dmg * (opts.full ? 1 : 0.6)); } continue; }
      const box = q !== owner && this.boxCover(q, pos, owner);
      if (box) { this.soakBox(box, dmg * (opts.full ? 1 : 0.6)); continue; }
      let amt;
      if (q === owner) { if (q.stats.noSelfDamage > 0 || opts.noSelf) continue; amt = dmg * (opts.full ? 1 : 0.3); }
      else { if (!this.canHurt(owner, q)) continue; amt = dmg * (opts.full ? 1 : 0.6); }
      const dir = norm({ x: cx, y: 0, z: cz });
      this.dmgTag = 'blast'; this.hurt(q, amt, owner, dir);
      const k = (3 + R + (opts.knock || 0) * dmg * 0.06) / q.size;
      q.vel.x += dir.x * k; q.vel.z += dir.z * k; q.vel.y += 3;
    }
    for (const o of this.dyn) {
      const c = { x: o.pos.x - pos.x, y: o.pos.y + o.h / 2 - pos.y, z: o.pos.z - pos.z }, d = len(c);
      if (d < R + Math.max(o.w, o.d) / 2) {
        const dir = norm(c), J = dmg * 0.08 * (1 - d / (R + 2)) + 2;
        this.impulse(o, { x: dir.x * J, y: Math.abs(dir.y) * J + J * 0.4, z: dir.z * J });
        this.tipCheck(o, { pos: { x: pos.x, y: o.pos.y + o.h, z: pos.z }, vel: { x: dir.x, z: dir.z } }, J * 1.5);
      }
    }
    for (let k = 1; k <= (opts.extra || 0); k++) this.booms.push({ t: k * 1.0, pos: { ...pos }, dmg, owner, opts: { ...opts, extra: 0 } });
  }
  updateBooms(dt) {
    for (const b of this.booms) {
      b.t -= dt;
      if (b.follow && b.follow.alive) b.pos = { x: b.follow.pos.x, y: this.chest(b.follow), z: b.follow.pos.z };
      if (b.t <= 0) {
        b.dead = true; this.explode(b.pos, b.dmg, b.owner, b.opts);
        if (b.opts.meteor) { const M = RITUAL.meteors; this.firePatch(b.owner, b.pos.x, b.pos.y - 0.4, b.pos.z, M.fireR, M.fireDps, M.fireLife); }
      }
    }
    this.booms = this.booms.filter(b => !b.dead);
  }
  updateShields(dt) {
    for (const s of this.shields) {
      s.t -= dt;
      // Shock Bubble carries over to the deployed wall: enemies touching it get zapped.
      const o = s.ownerRef, shock = 0;   // v26: Shock Bubble is a burst on block now, the wall no longer zaps
      if (!(shock > 0)) continue;
      for (const q of this.players) {
        if (!q.alive || q.reviving || !this.isEnemy(o, q)) continue;
        const r = PR * q.size + 0.45, [lx, lz] = s.box ? [q.pos.x - s.x, q.pos.z - s.z] : this.shieldLocal(s, q.pos.x, q.pos.z);
        if (Math.abs(lx) < s.w / 2 + r && Math.abs(lz) < s.d / 2 + r &&
            q.pos.y < s.y0 + s.h && q.pos.y + PH * q.size > s.y0) this.hurt(q, shock * dt, o, null, true);
      }
    }
    this.shields = this.shields.filter(s => s.t > 0 && !(s.box && (!(s.hp > 0) || !this.barricades.includes(s.pillar))));
  }

  killBullet(b, impact, hitQ = null) {
    b.alive = false;
    this.ncBulletEnd(b, impact, hitQ);   // v1.2.15: Pressure Stack misses, Gravity Well
    // v1.1.2: Shrapnel bursts on anything it hits (players, shields, crates, walls, the floor), not just walls.
    // Fragments skip the player that was hit, so a direct hit isn't also shredded by its own burst.
    if (impact && b.shrapnel > 0) this.shrapnelBurst(b, hitQ);
    if (impact && b.toxic > 0) this.toxicCloud(b);
    if (impact && b.explosive > 0) this.explode(b.pos, b.dmg, b.ownerRef, { extra: Math.max(0, Math.round(b.explosive) - 1), knock: b.knockback, cown: b.cown, rmul: b.boomMul });
    if (impact && b.bounceExplode > 0 && !b.beam) this.explode(b.pos, b.dmg * b.bounceExplode, b.ownerRef, { knock: b.knockback, cown: b.cown, noSelf: true });   // Rebound Charge: the last hit blasts too (v1.2.11: also with Volatile Payload, like on bounces)
    if (impact && !(b.explosive > 0) && !(b.bounceExplode > 0 && !b.beam)) this.emit({ t: 'impact', x: b.pos.x, y: b.pos.y, z: b.pos.z, p: b.owner });
  }

  bounce(b, ax) {
    if (b.bLeft > 0) { b.vel[ax] *= -1; b.bLeft--; b.bounced = true; this.emit({ t: 'bounce', x: b.pos.x, y: b.pos.y, z: b.pos.z }); this.onBounce(b); return true; }
    this.killBullet(b, true); return false;
  }
  // Bounce off an angled wall with inward normal (nx, nz).
  bounceN(b, nx, nz) {
    if (b.bLeft > 0) {
      const vn = b.vel.x * nx + b.vel.z * nz;
      if (vn < 0) { b.vel.x -= 2 * vn * nx; b.vel.z -= 2 * vn * nz; }
      b.bLeft--; b.bounced = true; this.emit({ t: 'bounce', x: b.pos.x, y: b.pos.y, z: b.pos.z }); this.onBounce(b); return true;
    }
    this.killBullet(b, true); return false;
  }
  // Bounce effects: Kinetic Rebound (more damage), Rebound Charge (explode), Splinter Bounce (split), Bank Shot (re-aim).
  onBounce(b) {
    if (b.toxic > 0) this.toxicCloud(b);
    if (b.bounceBoost > 0) {
      b.dmg *= 1 + b.bounceBoost;
      const sp = len(b.vel), k = Math.min(1 + b.bounceBoost * 0.5, 120 / (sp || 1));
      b.vel.x *= k; b.vel.y *= k; b.vel.z *= k;
    }
    // v1.0.9: a full blast (bullet damage, knockback) on every bounce, not the old small 45% pop
    if (b.bounceExplode > 0) this.explode({ ...b.pos }, b.dmg * b.bounceExplode, b.ownerRef, { knock: b.knockback, cown: b.cown, noSelf: true });
    // Impact effects fire on every bounce, not just the last impact: Volatile Payload blasts and Shrapnel bursts
    // (grenades and shells only blast on a bounce if you have Volatile Payload yourself). Napalm splats where it touches.
    if (!b.beam) {
      const vol = b.fx === 'grenade' || b.fx === 'shell' ? (b.ownerRef && b.ownerRef.stats.explosive) || 0 : b.explosive;
      if (vol > 0) this.explode({ ...b.pos }, b.dmg, b.ownerRef, { knock: b.knockback, cown: b.cown, noSelf: true });
      if (b.shrapnel > 0) this.shrapnelBurst(b);
    }
    if (b.bounceSplit > 0 && !b.splitChild && budgetRoom(this)) {
      const n = Math.round(b.bounceSplit);
      for (let k = 1; k <= n; k++) {
        const sgn = k % 2 ? 1 : -1, ang = sgn * 0.35 * Math.ceil(k / 2);
        const v = rotY(b.vel, ang);
        this.bullets.push({ ...b, id: this.nextId++, pos: { ...b.pos }, vel: v, dmg: b.dmg * 0.6, splitChild: true, aiSeen: {}, homeTgt: null, homeT: 0, alive: true, hold: null });
      }
    }
    // Bank Shot: re-aim at the nearest enemy (player or bot) within BANK_RANGE that the bullet can see,
    // then keep gently curving toward it while it stays in sight (like Seeker homing).
    if (b.bounceTarget > 0) {
      const t = this.homingTarget(b, BANK_RANGE);
      b.bankTgt = t || null; b.bankT = 0.12;
      if (t) b.vel = this.aimVel(b.pos, t, b.vel, len(b.vel), b.grav);
    }
    if (!b.alive) return;
  }
  // Saturn Rounds: does the bullet's outer ring (a circle around its flight line) touch this player?
  ringTouches(b, q) {
    const R = b.ring, r = PR * q.size;
    if (Math.hypot(q.pos.x - b.pos.x, q.pos.z - b.pos.z) > R + r + 0.3) return false;
    const d = norm(b.vel);
    let u = { x: d.z, y: 0, z: -d.x }; const ul = Math.hypot(u.x, u.z);
    u = ul > 1e-3 ? { x: u.x / ul, y: 0, z: u.z / ul } : { x: 1, y: 0, z: 0 };
    const v = { x: u.y * d.z - u.z * d.y, y: u.z * d.x - u.x * d.z, z: u.x * d.y - u.y * d.x };
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2, c = Math.cos(a) * R, s2 = Math.sin(a) * R;
      const x = b.pos.x + u.x * c + v.x * s2, y = b.pos.y + u.y * c + v.y * s2, z = b.pos.z + u.z * c + v.z * s2;
      if (Math.hypot(x - q.pos.x, z - q.pos.z) < r && y > q.pos.y && y < q.pos.y + PH * q.size) return true;
    }
    return false;
  }

  // A blocker sends the bullet back: it bounces off, now belongs to the blocker,
  // and every reflect adds a little time to the block.
  reflect(b, q, n) {
    const vd = b.vel.x * n.x + b.vel.y * n.y + b.vel.z * n.z;
    if (vd < 0) { b.vel.x -= 2 * vd * n.x; b.vel.y -= 2 * vd * n.y; b.vel.z -= 2 * vd * n.z; }
    const boost = q.stats.reflectBoost;
    this.blockedDamage(q, b.dmg);
    b.dmg *= 1 + boost;
    if (boost) { b.vel.x *= 1 + boost * 0.3; b.vel.y *= 1 + boost * 0.3; b.vel.z *= 1 + boost * 0.3; b.r = clamp(b.r * Math.pow(1 + boost, 0.25), 0.05, 1.2); b.grav = bulletGravityFor(b.r); }
    // The bullet keeps its shooter's color, effects and damage; only who it belongs to (who it can hurt) changes.
    b.owner = q.id; b.ownerRef = q; b.bounced = false; b.aiSeen = {}; b.lock = null; b.homeTgt = null; b.homeT = 0; b.bankTgt = null;
    if (b.swarm) { b.swTgt = null; b.swT = 0.25; b.swAvoid = null; }   // v28: blocked bees / squid turn on the shooter instead of diving straight back into the shield
    // Each reflect in the same block adds less time than the one before (diminishing returns).
    if (q.blockT > 0 && q.blockExtra < RULES.blockMaxExtra) {
      const n = q.blockReflects || 0;
      const add = Math.min(RULES.blockReflectBonus * Math.pow(RULES.blockReflectDecay, n), RULES.blockMaxExtra - q.blockExtra);
      q.blockT += add; q.blockExtra += add; q.blockReflects = n + 1;
    }
    this.emit({ t: 'block', p: q.id, x: b.pos.x, y: b.pos.y, z: b.pos.z });
  }

  // Shields (bubbles and deployed walls) get first say on every bullet, even drilling ones.
  shieldCheck(b, prev) {
    for (const q of this._shQ || this.players) {   // (v1.2.25: updateBullets lists who has a shield up once per step)
      if (!q.alive || q.reviving || q.id === b.owner) continue;
      const R = 1.05 * q.stats.blockSize * q.size, c = { x: q.pos.x, y: q.pos.y + 0.8 * q.size, z: q.pos.z };
      const off = { x: b.pos.x - c.x, y: b.pos.y - c.y, z: b.pos.z - c.z }, d = len(off);
      if (d < R + b.r && this.shielded(q) && this.isEnemy(b.ownerRef, q)) {
        const n = norm(off);
        b.pos = { x: c.x + n.x * (R + b.r + 0.03), y: c.y + n.y * (R + b.r + 0.03), z: c.z + n.z * (R + b.r + 0.03) };
        if (q.blockT > 0 && q.smod === 'catcher') { this.catchBullet(b, q); return true; }
        if (q.blockT > 0 && q.stats.parry > 0 && this.time - (q.fx.blockAt ?? -9) <= q.stats.parry + 1e-6) {   // v1.2.15 Perfect Parry
          b.alive = false; q.blockCdT = 0;
          this.emit({ t: 'nc', k: 'parry', p: q.id, x: b.pos.x, y: b.pos.y, z: b.pos.z });
          return true;
        }
        const dmg = b.dmg;
        this.reflect(b, q, n);
        this.soakShield(q, dmg);
        return true;
      }
    }
    let tShot = null;
    for (const s of this.shields) {
      const qx = b.pos.x - s.x, qz = b.pos.z - s.z, qr = (s.w + s.d) * 0.5 + b.r + 0.2;
      if (qx * qx + qz * qz > qr * qr) continue;   // v1.2.25: nowhere near this one (every test below is inside this circle)
      if (tShot === null) tShot = this.isTurret(b.ownerRef);
      if (tShot && s.hp > 0 && !s.box && s.owner !== b.owner && !this.isEnemy(b.ownerRef, s.ownerRef)) {   // a turret's shot stops on a friendly bastion
        const [lx, lz] = this.shieldLocal(s, b.pos.x, b.pos.z);
        if (Math.abs(lx) < s.w / 2 + b.r && Math.abs(lz) < s.d / 2 + b.r && b.pos.y > s.y0 && b.pos.y < s.y0 + s.h) { this.killBullet(b, true); return true; }
      }
      if (s.owner === b.owner || !this.isEnemy(b.ownerRef, s.ownerRef)) continue;
      const r = b.r;
      if (s.box) {
        // Pillar Shield box: stops enemy bullets that cross into it from outside (anything fired from inside gets out).
        if (!(s.hp > 0) || !this.inBox(s, b.pos.x, b.pos.y, b.pos.z, r) || this.inBox(s, prev.x, prev.y, prev.z, r)) continue;
        const n = prev.y >= s.y0 + s.h + r ? { x: 0, y: 1, z: 0 } : prev.y <= s.y0 - r ? { x: 0, y: -1, z: 0 }
          : (prev.x <= s.x - s.w / 2 - r || prev.x >= s.x + s.w / 2 + r) ? { x: Math.sign(prev.x - s.x) || 1, y: 0, z: 0 } : { x: 0, y: 0, z: Math.sign(prev.z - s.z) || 1 };
        const dmg = b.dmg;
        b.pos = { ...prev };
        this.reflect(b, s.ownerRef, n);
        this.soakBox(s, dmg);
        return true;
      }
      const [lx, lz] = this.shieldLocal(s, b.pos.x, b.pos.z);
      if (Math.abs(lx) < s.w / 2 + r && Math.abs(lz) < s.d / 2 + r && b.pos.y > s.y0 - r && b.pos.y < s.y0 + s.h + r) {
        const a = s.ang || 0, side = Math.sign(this.shieldLocal(s, prev.x, prev.z)[1]) || 1;
        const n = s.w < s.d ? { x: Math.cos(a) * (Math.sign(this.shieldLocal(s, prev.x, prev.z)[0]) || 1), y: 0, z: Math.sin(a) * (Math.sign(this.shieldLocal(s, prev.x, prev.z)[0]) || 1) }
          : { x: -Math.sin(a) * side, y: 0, z: Math.cos(a) * side };
        b.pos = { ...prev };
        this.reflect(b, s.ownerRef, n);
        return true;
      }
    }
    return false;
  }

  // Drill: jump to the far face of whatever we hit, pause there while the bullet regrows,
  // then carry on (a bit slower the thicker the wall was).
  drillThrough(b, s) {
    const d = norm(b.vel), L = this.level;
    const t = rayExit(b.pos, d, s);
    const exit = { x: b.pos.x + d.x * (t + b.r + 0.03), y: b.pos.y + d.y * (t + b.r + 0.03), z: b.pos.z + d.z * (t + b.r + 0.03) };
    if (Math.abs(exit.x) > L.hx || Math.abs(exit.z) > L.hz || exit.y < 0 || (L.edges && edgeDistance(L.edges, exit.x, exit.z) < 0)) { this.killBullet(b, false); return; }
    const thick = t + 0.1, power = Math.max(0.5, b.drill);
    b.pos = exit;
    const dur = clamp(0.12 + thick * 0.2 / power, 0.12, 0.8);
    b.hold = { t: dur, dur };
    const decay = Math.max(0.3, 1 - thick * 0.16 / power);
    b.vel.x *= decay; b.vel.y *= decay; b.vel.z *= decay;
    if (s.obj) this.impulse(s.obj, { x: d.x * b.dmg * 0.03, y: 0, z: d.z * b.dmg * 0.03 });
    this.emit({ t: 'drill', x: exit.x, y: exit.y, z: exit.z, p: b.owner });
  }

  // Life drain target: nearest enemy you can see within DRAIN_RANGE + Drain range metres.
  drainTarget(p) {
    let best = null, bd = DRAIN_RANGE + (p.stats.drainRange || 0);
    const from = { x: p.pos.x, y: this.chest(p), z: p.pos.z };
    for (const q of this.players) {
      if (!q.alive || q.reviving || !this.isEnemy(p, q)) continue;
      const d = Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y, q.pos.z - p.pos.z);
      if (d < bd && !segBlocked(this.solids, from, { x: q.pos.x, y: this.chest(q), z: q.pos.z })) { bd = d; best = q; }
    }
    return best;
  }
  // Squid and Bees bullets: pick a visible enemy, steer around walls, keep under a speed cap.
  // Bees lock onto the first enemy they see; squid re-pick the nearest and swim in pulses.
  swarmSteer(b, dt) {
    const SW = SWARM[b.swarm];
    b.swT -= dt;
    const lost = !b.swTgt || !b.swTgt.alive || b.swTgt.reviving;
    if (b.swT <= 0 && (b.swarm === 'squid' || lost)) { b.swT = b.swarm === 'squid' ? 0.3 : 0.15; const t = this.homingTarget(b, SW.see); if (t || lost) b.swTgt = t; }
    const t = b.swTgt && b.swTgt.alive ? b.swTgt : null;
    const dir = norm(b.vel.x || b.vel.y || b.vel.z ? b.vel : { x: 1, y: 0, z: 0 });
    let want = t ? norm({ x: t.pos.x - b.pos.x, y: this.chest(t) - b.pos.y, z: t.pos.z - b.pos.z }) : dir;
    const side = this.level.side, bee = b.swarm === 'bee';
    if (bee && t) {   // v28: a sideways weave that fades out as the bee closes in (keeps the swarm spread out)
      const dist = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z), k = clamp((dist - 2) / 6, 0, 1) * SW.wob * b.swWob * Math.sin(this.time * 2.2 + b.swOff);
      want = side ? norm({ x: want.x - want.y * k, y: want.y + want.x * k, z: 0 }) : norm({ x: want.x - want.z * k, y: want.y, z: want.z + want.x * k });
    }
    if (b.pos.y < 0.5 && want.y < 0.15) want = norm({ x: want.x, y: 0.25, z: want.z });
    const look = SW.look || 1.3;
    // v1.2.8: while it has bounces left a swarm bullet doesn't dodge walls: it hits them and bounces like any bullet
    // (so splits, bounce blasts, napalm and toxic clouds on walls all go off), then steers round them once they're used up.
    const rico = b.bLeft > 0 && !(b.drill > 0);
    const hit = (d, l) => (!rico && !!pointInSolid(this.solids, b.pos.x + d.x * l, b.pos.y + d.y * l, b.pos.z + d.z * l, b.r)) || b.pos.y + d.y * l < 0.1;
    const blocked = d => hit(d, look) || (bee && hit(d, look * 0.5));
    let turn = SW.turn;
    // v28 bees: keep going round the same side of a wall for a moment instead of flip-flopping into it
    if (bee && b.swAvoid && b.swAvoid.t > this.time && !blocked(b.swAvoid.d)) { want = norm({ x: want.x * 0.25 + b.swAvoid.d.x, y: want.y * 0.25 + b.swAvoid.d.y, z: want.z * 0.25 + b.swAvoid.d.z }); turn *= 1.6; }
    else if (blocked(want) || blocked(dir)) {
      const angs = bee ? [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.5, -1.5, 2.0, -2.0, 2.6, -2.6] : [0.5, -0.5, 1.0, -1.0, 1.6, -1.6];
      if (bee && b.swAvoid) { const s0 = b.swAvoid.s || 1; angs.sort((x, y) => Math.abs(x) - Math.abs(y) || (Math.sign(y) === s0) - (Math.sign(x) === s0)); }
      const opts = side ? angs.map(a => norm({ x: want.x * Math.cos(a) - want.y * Math.sin(a), y: want.x * Math.sin(a) + want.y * Math.cos(a), z: 0 }))
        : angs.map(a => norm(rotY(want, a))).concat([norm({ x: want.x * 0.4, y: 0.9, z: want.z * 0.4 }), ...(bee ? [norm({ x: want.x * 0.5, y: -0.7, z: want.z * 0.5 })] : [])]);
      const fi = opts.findIndex(d => !blocked(d));
      if (fi >= 0) { want = opts[fi]; if (bee) { b.swAvoid = { d: want, t: this.time + 0.35, s: Math.sign(angs[fi] || 1) }; turn *= 1.8; } }
      else if (bee) { want = norm({ x: -dir.x, y: 0.6, z: -dir.z }); turn *= 2; }   // boxed in: back out and climb
    }
    const nd = norm(turnToward(dir, want, turn * dt));
    let sp;
    if (b.swarm === 'squid') {   // pulse: a quick stroke, then a long glide that slows almost to a stop
      b.swPh += dt / SW.pulse;
      const ph = b.swPh % 1;
      sp = ph < 0.2 ? SW.cap * (0.15 + 0.85 * ph / 0.2) : SW.cap * (1 - 0.88 * (ph - 0.2) / 0.8);
      sp = clamp(sp, 1.2, SW.cap);
    } else sp = Math.min(SW.cap, Math.max(len(b.vel), SW.cap * 0.8));
    b.vel = { x: nd.x * sp, y: nd.y * sp, z: side ? 0 : nd.z * sp };
  }
  // v1.2.8: a squid / bee that runs out of time pops where it is, so its impact effects (napalm on the floor below,
  // explosions, shrapnel, toxic clouds) still go off like any other bullet's (they used to just vanish mid-air).
  // v1.2.22 squid latch: stick to the target at a spot on its body, bite now and then, heal the shooter
  squidLatch(b, q) {
    const a = Math.random() * Math.PI * 2, R = PR * q.size * 0.9;
    b.latch = { q, ox: Math.cos(a) * R, oz: Math.sin(a) * R, oy: (0.35 + Math.random() * 0.5) * PH * q.size, bt: 0.12, end: this.time + SQUID.latch };
    b.vel = { x: 0, y: 0, z: 0 }; b.life = Math.max(b.life, SQUID.latch + 0.2);
    q.fx.sqOnT = this.time + 0.25;
    this.emit({ t: 'nc', k: 'squidOn', p: q.id, x: b.pos.x, y: b.pos.y, z: b.pos.z });
  }
  squidDetach(b, stun, dir) {
    const q = b.latch && b.latch.q; b.latch = null; b.stunT = stun; b.swTgt = null;
    const d = dir || norm({ x: b.pos.x - (q ? q.pos.x : b.pos.x) || 0.3, y: 0, z: b.pos.z - (q ? q.pos.z : b.pos.z) || 0.3 });
    b.vel = { x: d.x * 7, y: 4, z: this.level.side ? 0 : d.z * 7 };
    b.life = Math.max(b.life, stun + 2.5);
  }
  squidGnaw(b, dt) {
    const Lt = b.latch, q = Lt.q;
    if (!q.alive || q.reviving || !this.isEnemy(b.ownerRef, q)) { this.squidDetach(b, 0.3); return; }
    if (this.shielded(q)) { this.squidDetach(b, SQUID.blockStun); this.emit({ t: 'nc', k: 'squidOff', p: q.id, x: b.pos.x, y: b.pos.y, z: b.pos.z }); return; }   // block / shield knocks it off
    const m = q.fx.mash;
    if (m && m.length) {
      while (m.length && this.time - m[0] > SQUID.win) m.shift();
      if (m.length >= SQUID.mash) {   // shaken off: every squid on them lets go and is stunned
        m.length = 0;
        for (const o of this.bullets) if (o.alive && o.latch && o.latch.q === q) this.squidDetach(o, SQUID.stun);
        this.emit({ t: 'nc', k: 'squidOff', p: q.id, x: q.pos.x, y: this.chest(q), z: q.pos.z });
        return;
      }
    }
    b.pos = { x: q.pos.x + Lt.ox, y: q.pos.y + Lt.oy, z: q.pos.z + (this.level.side ? 0 : Lt.oz) };
    q.fx.sqOnT = this.time + 0.25;
    if (this.time >= Lt.end || b.life <= 0) { b.latch = null; this.swarmExpire(b); return; }
    if ((Lt.bt -= dt) > 0) return;
    Lt.bt = SQUID.every;
    const d0 = b.dmg, src = b.ownerRef, h0 = q.hp;
    b.dmg = d0 * SQUID.bite; this.dmgTag = 'bite';
    this.applyHit(b, q, null);
    b.dmg = d0;
    const dealt = Math.max(0, h0 - q.hp);
    if (src && src.alive && src.kind === 'hero' && dealt > 0) { const h1 = src.hp; src.hp = Math.min(this.maxHp(src), src.hp + dealt * SQUID.steal); this.healPing(src, h1); }
  }
  swarmExpire(b) {
    const pop = b.napalm > 0 || b.explosive > 0 || b.shrapnel > 0 || b.toxic > 0;
    if (b.napalm > 0) { const gy = groundBelow(this.solids, b.pos.x, b.pos.z, b.pos.y + 0.1); if (b.pos.y - gy < 3) this.napalmSplat(b, { x: b.pos.x, y: gy, z: b.pos.z }, { x: 0, y: 1, z: 0 }, null); }
    this.killBullet(b, pop);
  }
  // Toxic Cloud: a poison cloud where the bullet hit (and at each bounce), drifting on and spreading out.
  toxicCloud(b) {
    if (b.flame || this.phase !== 'play') return;
    b.toxN = (b.toxN || 0) + 1; if (b.toxN > TOXIC.perBullet) return;
    if (this.clouds.length >= TOXIC.max) this.clouds.shift();
    const h = Math.hypot(b.vel.x, b.vel.z) || 1, r0 = clamp(0.8 + 0.45 * Math.sqrt(Math.max(1, b.dmg) / DEFAULT_STATS.damage), 0.8, 2.2) * (1 + 0.15 * (b.toxic - 1));
    const side = !!this.level.side;
    const c = { id: this.nextId++, x: b.pos.x, y: Math.max(0.5, Math.min(b.pos.y, 3)), z: side ? 0 : b.pos.z, vx: b.vel.x / h * TOXIC.drift, vz: side ? 0 : b.vel.z / h * TOXIC.drift,
      r0, r: r0, t: TOXIC.life, dps: b.dmg * TOXIC.dps * b.toxic, ownerRef: b.ownerRef, cown: b.cown, checkT: 0 };
    this.clouds.push(c);
    const r2 = v => Math.round(v * 100) / 100;
    this.emit({ t: 'toxic', id: c.id, p: b.cown || b.owner, x: r2(c.x), y: r2(c.y), z: r2(c.z), vx: r2(c.vx), vz: r2(c.vz), r0: r2(r0), r1: r2(r0 * TOXIC.grow), life: TOXIC.life });
  }
  updateClouds(dt) {
    if (!this.clouds || !this.clouds.length) return;
    for (const c of this.clouds) {
      c.t -= dt;
      const nx = c.x + c.vx * dt, nz = c.z + c.vz * dt;
      if (!pointInSolid(this.solids, nx, c.y, nz, 0) && Math.abs(nx) < this.level.hx && Math.abs(nz) < this.level.hz) { c.x = nx; c.z = nz; } else { c.vx = 0; c.vz = 0; }
      c.r = c.r0 * (1 + (TOXIC.grow - 1) * (1 - c.t / TOXIC.life));
      if ((c.checkT -= dt) > 0) continue;
      c.checkT = 0.25;
      for (const q of this.players) {
        if (!q.alive || q.reviving || q === c.ownerRef || !this.canHurt(c.ownerRef, q) || this.ownShot(c, q) || this.shielded(q)) continue;
        if (Math.hypot(q.pos.x - c.x, q.pos.z - c.z) > c.r + PR * q.size || q.pos.y > c.y + c.r || q.pos.y + PH * q.size < c.y - c.r - 0.6) continue;
        this.dmgTag = 'toxic'; this.hurt(q, c.dps * 0.25, c.ownerRef, null, true);
        q.fx.toxT = this.time + 0.4;
      }
    }
    this.clouds = this.clouds.filter(c => c.t > 0);
  }
  homingTarget(b, near) {
    const cands = [];
    for (const q of this.players) {
      if (!q.alive || q.reviving || !this.isEnemy(b.ownerRef, q) || this.ownShot(b, q)) continue;   // (blocked-back seekers don't chase an SCP shooter)
      const dq = Math.hypot(q.pos.x - b.pos.x, this.chest(q) - b.pos.y, q.pos.z - b.pos.z);
      if (dq < near) cands.push([dq, q]);
    }
    cands.sort((a, c) => a[0] - c[0]);
    for (const [, q] of cands.slice(0, 4)) {
      const c = { x: q.pos.x, y: this.chest(q), z: q.pos.z };
      if (!segBlocked(this.solids, b.pos, c, s => s.barricade && !this.canHurt(b.ownerRef, s.barricade.ownerRef))) return q;
    }
    return null;
  }

  // Bullet Time: holders of the slowField stat carry a field (radius from slowFieldRadius) where bullets that can
  // hurt them fly SLOWFIELD.slow slower. Extra copies widen the field; the slow never stacks.
  slowFieldRadius(n) { return n > 0 ? SLOWFIELD.radius + SLOWFIELD.perCopy * (Math.round(n) - 1) : 0; }
  bulletSlow(b, holders) {
    for (const h of holders) {
      if (h === b.ownerRef || !this.canHurt(b.ownerRef, h) || this.ownShot(b, h) || h.blockT > 0) continue;   // blocking: bullets reach your bubble at full speed
      const dy = b.pos.y - (h.pos.y + PH * h.size * 0.5);
      if (Math.abs(dy) < SLOWFIELD.height && Math.hypot(b.pos.x - h.pos.x, b.pos.z - h.pos.z) < h.fieldR) return 1 - SLOWFIELD.slow;
    }
    return 1;
  }
  updateBullets(dt0) {
    const L = this.level;
    const holders = this.players.filter(h => h.alive && !h.reviving && h.stats.slowField > 0);
    for (const h of holders) h.fieldR = this.slowFieldRadius(h.stats.slowField);
    // v1.2.25: per-step lookups so a bullet only tests the players near it (big lobbies have hundreds of bullets)
    this._shQ = this.players.filter(q => q.alive && !q.reviving && this.shielded(q));
    this._riotQ = this.players.filter(q => q.mod === 'shield');
    const PG = new Map(), PGC = 4, hasBags = this.barricades.length > 0;
    let pgR = 0;
    this.players.forEach((q, i) => {
      if (!q.alive) return;
      q._bi = i;
      const k = Math.floor(q.pos.x / PGC) * 4096 + Math.floor(q.pos.z / PGC);
      let a = PG.get(k); if (!a) PG.set(k, a = []); a.push(q);
      const r = PR * q.size * (q.stats.hitScale || 1); if (r > pgR) pgR = r;
    });
    const near = [], nearOf = (b, hr) => {
      near.length = 0;
      const R = pgR + hr + 0.01, i0 = Math.floor((b.pos.x - R) / PGC), i1 = Math.floor((b.pos.x + R) / PGC), j0 = Math.floor((b.pos.z - R) / PGC), j1 = Math.floor((b.pos.z + R) / PGC);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = PG.get(i * 4096 + j); if (a) for (const q of a) near.push(q); }
      if (near.length > 1) near.sort((x, y) => x._bi - y._bi);   // same order as the full player list
      return near;
    };
    for (const b of this.bullets) {
      if (!b.alive) continue;
      if (this.tourn) PA.a = b.ownerRef ? b.ownerRef.arena ?? null : null;
      b.slowK = holders.length && !b.hold ? this.bulletSlow(b, holders) : 1;
      const dt = dt0 * b.slowK;
      if (b.caught && this.holdCaught(b, dt)) continue;
      if (L.side) { b.pos.z = 0; b.vel.z = 0; }
      if (b.hold) { b.hold.t -= dt; if (b.hold.t > 0) continue; b.hold = null; }
      b.life -= dt;
      if (b.life <= 0) { if (b.swarm) this.swarmExpire(b); else this.killBullet(b, false); continue; }
      const sp = len(b.vel);
      // Homing (Seeker Chip) plus a gentle built-in homing for sky strikes near their target
      let turn = b.homing, near = 35;
      if (b.sky && b.lock) { turn = Math.max(turn, 1.6); near = 6; }
      if (turn > 0 && !(b.sky && b.pos.y > 6 && !b.homing)) {
        let tgt = null;
        if (b.homing > 0) {
          // Seeker homing only locks onto targets the bullet can actually see (re-checked a few times a second).
          b.homeT = (b.homeT || 0) - dt;
          const t0 = b.homeTgt;
          if (b.homeT <= 0 || !t0 || !t0.alive || t0.reviving) { b.homeT = 0.12; b.homeTgt = this.homingTarget(b, near); }
          tgt = b.homeTgt;
        } else {
          let bd = near;
          for (const q of this.players) {
            if (!q.alive || q.reviving || !this.isEnemy(b.ownerRef, q)) continue;
            const ref = b.lock;
            const dq = Math.hypot(q.pos.x - ref.x, q.pos.z - ref.z);
            if (dq < bd) { bd = dq; tgt = q; }
          }
        }
        if (tgt) {
          const want = norm({ x: tgt.pos.x - b.pos.x, y: this.chest(tgt) - b.pos.y, z: tgt.pos.z - b.pos.z });
          const nd = norm(turnToward(norm(b.vel), want, turn * dt));
          b.vel = { x: nd.x * sp, y: nd.y * sp, z: nd.z * sp };
        }
      }
      if (b.bankTgt) {   // Bank Shot follow-up homing, dropped as soon as a wall gets in the way
        const t = b.bankTgt;
        b.bankT -= dt;
        if (!t.alive || t.reviving) b.bankTgt = null;
        else if (b.bankT <= 0) { b.bankT = 0.12; if (this.homingTarget(b, BANK_RANGE * 1.3) !== t && segBlocked(this.solids, b.pos, { x: t.pos.x, y: this.chest(t), z: t.pos.z })) b.bankTgt = null; }
        if (b.bankTgt) {
          const want = norm({ x: t.pos.x - b.pos.x, y: this.chest(t) - b.pos.y, z: t.pos.z - b.pos.z });
          const nd = norm(turnToward(norm(b.vel), want, 2.5 * b.bounceTarget * dt)), sp2 = len(b.vel);
          b.vel = { x: nd.x * sp2, y: nd.y * sp2, z: nd.z * sp2 };
        }
      }
      if (b.latch) { this.squidGnaw(b, dt); continue; }   // v1.2.22: latched squid ride their target
      if (b.stunT > 0) { b.stunT -= dt; b.vel.x *= 1 - Math.min(1, dt * 2); b.vel.z *= 1 - Math.min(1, dt * 2); b.vel.y = Math.max(b.vel.y - 6 * dt, -4); if (b.stunT <= 0) { b.swTgt = null; b.swT = 0; } }
      else if (b.swarm) this.swarmSteer(b, dt);
      if (!(b.stunT > 0)) b.vel.y -= (b.grav ?? RULES.bulletGravity) * dt;
      if (b.fuse != null) { b.fuse -= dt; if (b.fuse <= 0) { this.killBullet(b, true); continue; } }
      const steps = Math.max(1, Math.ceil(sp * dt / 0.25)), h = dt / steps;
      const tShot = this.isTurret(b.ownerRef);
      const friendlyBag = hasBags ? (s => s.barricade && !tShot && !this.canHurt(b.ownerRef, s.barricade.ownerRef)) : null;
      for (let k = 0; k < steps && b.alive && !b.hold; k++) {
        const prev = { ...b.pos };
        b.pos.x += b.vel.x * h; b.pos.y += b.vel.y * h; b.pos.z += b.vel.z * h;
        // v1.0.9: bullets bounce off the invisible arena walls (and the red edges in 2D) like any other wall. Only when
        // crossing from inside, so sky strikes that start above the 2D top edge still fall in.
        if (b.bLeft > 0 && !b.flame && !(b.drill > 0)) {
          const S2 = L.side;
          let eax = null;
          if (Math.abs(b.pos.x) > L.hx && Math.abs(prev.x) <= L.hx) eax = 'x';
          else if (!S2 && Math.abs(b.pos.z) > L.hz && Math.abs(prev.z) <= L.hz) eax = 'z';
          else if (S2 && ((b.pos.y > S2.top && prev.y <= S2.top) || (b.pos.y < S2.bottom && prev.y >= S2.bottom && !inPit(L, b.pos.x)))) eax = 'y';
          if (eax) { b.pos = prev; this.bounce(b, eax); continue; }
        }
        if (Math.abs(b.pos.x) > L.hx + 2 || Math.abs(b.pos.z) > L.hz + 2 || b.pos.y > (L.open ? OW.ceil : 45) || (L.side && b.pos.y < L.side.bottom - 4)) { this.killBullet(b, false); break; }
        if (this.shieldCheck(b, prev)) continue;
        if (this._riotQ.length && this.riotCheck(b, prev)) continue;
        const s = pointInSolid(this.solids, b.pos.x, b.pos.y, b.pos.z, b.r, friendlyBag);
        if (s) {
          if (tShot && s.barricade && !this.canHurt(b.ownerRef, s.barricade.ownerRef)) { this.killBullet(b, true); break; }   // turret shots stop on friendly walls
          if (b.drill > 0) { this.drillThrough(b, s); break; }
          if (s.barricade) { this.damageBarricade(s.barricade, b.dmg); this.killBullet(b, true); break; }
          if (s.obj) {
            const J = b.dmg * (0.05 + b.knockback * 0.02);
            this.impulse(s.obj, { x: b.vel.x / (sp || 1) * J, y: 0.5, z: b.vel.z / (sp || 1) * J });
            this.tipCheck(s.obj, b, J);
          }
          if (b.flame) { this.killBullet(b, false); break; }
          const r = b.r;
          let ax = 'y';
          if (prev.x <= s.min.x - r || prev.x >= s.max.x + r) ax = 'x';
          else if (prev.z <= s.min.z - r || prev.z >= s.max.z + r) ax = 'z';
          if (b.napalm > 0) this.napalmSplatSolid(b, s, ax, prev);
          b.pos = prev;
          if (!this.bounce(b, ax)) break;
          continue;
        }
        if (L.edges && b.pos.y < 40) {   // polygon arenas: the angled walls bounce bullets like any other wall
          let e = null;
          for (const q of L.edges) if (q.nx * b.pos.x + q.nz * b.pos.z - q.c < b.r) { e = q; break; }
          if (e) {
            if (b.drill > 0 || b.flame) { this.killBullet(b, false); break; }
            if (b.napalm > 0) this.napalmSplat(b, { x: b.pos.x - e.nx * b.r, y: b.pos.y, z: b.pos.z - e.nz * b.r }, { x: e.nx, y: 0, z: e.nz }, null);
            b.pos = prev;
            if (!this.bounceN(b, e.nx, e.nz)) break;
            continue;
          }
        }
        const fy = L.hAt ? L.hAt(b.pos.x, b.pos.z) : 0;
        if (b.pos.y < fy + b.r) { if (b.napalm > 0) this.napalmSplat(b, { x: b.pos.x, y: fy, z: b.pos.z }, { x: 0, y: 1, z: 0 }, null); b.pos.y = fy + b.r; if (!this.bounce(b, 'y')) break; continue; }
        if (b.cutter) this.waveCuts(b);
        for (const q of b.ring > 0 ? this.players : nearOf(b, b.hitR || b.r)) {
          if (!q.alive || q.reviving || (q.id === b.owner && !b.bounced) || q.id === b.noHit || (q.ow && q.ow.st === 'bus')) continue;
          const hr = b.hitR || b.r, qr = PR * q.size * (q.stats.hitScale || 1) + hr;   // (v1.2.15 Light Frame: smaller hitbox)
          if ((b.pos.x > q.pos.x - qr && b.pos.x < q.pos.x + qr && b.pos.z > q.pos.z - qr && b.pos.z < q.pos.z + qr &&
              b.pos.y > q.pos.y - hr && b.pos.y < q.pos.y + PH * q.size + hr) || (b.ring > 0 && this.ringTouches(b, q))) {
            if (!this.canHurt(b.ownerRef, q) || this.ownShot(b, q)) continue;
            if (b.swap) { this.swapPlaces(b, q); break; }   // v1.2.15 Swap Shot orb
            if (b.pierce) { // flames and shield waves pass through, hitting each target once
              const key = b.wave || b.id; this.pierceHits = this.pierceHits || new Map();
              const set = this.pierceHits.get(key) || new Set(); this.pierceHits.set(key, set);
              if (set.has(q.id)) continue; set.add(q.id);
            }
            if (b.stunT > 0) continue;   // v1.2.22: a stunned squid drifts through people
            if (b.swarm === 'squid' && !b.pierce) { this.squidLatch(b, q); break; }   // v1.2.22: squid latch on instead of popping
            const dir = norm({ x: b.vel.x, y: L.side ? b.vel.y * 0.6 : 0, z: b.vel.z });   // side view: hits knock you up and down too
            this.applyHit(b, q, dir);
            if (b.napalm > 0) { const gy = groundBelow(this.solids, q.pos.x, q.pos.z, q.pos.y + 0.3); this.napalmSplat(b, { x: q.pos.x, y: gy, z: q.pos.z }, { x: 0, y: 1, z: 0 }, null); }
            if (b.cutter && b.explosive > 0) this.explode({ x: q.pos.x, y: this.chest(q), z: q.pos.z }, b.dmg, b.ownerRef, { knock: b.knockback, cown: b.cown, rmul: 0.8 });   // slash waves pass through, exploding on each target
            if (b.pierce) continue;
            this.killBullet(b, true, q);
            break;
          }
        }
      }
    }
    this._shQ = this._riotQ = null; PA.a = null;
    this.bullets = this.bullets.filter(b => b.alive);
    if (this.pierceHits && this.pierceHits.size > 200) this.pierceHits.clear();
  }

  // ------------------------------------------------------------ Napalm Rounds (napalm stat)
  // A bullet impact leaves a small splat of fire stuck to the surface it hit (floor, platform top or wall side).
  // The splat's size comes from the bullet's damage; it burns for NAPALM.life seconds and ignites any enemy that
  // touches it. The flames are individual "bits", each checked to sit on real static surface inside the splat
  // circle, so nothing hangs in the air past a ledge or a wall's visible top, and nothing sits on things that
  // move or break (crates, moving platforms, sandbags).
  napalmSplatSolid(b, s, ax, prev) {
    if (s.obj || s.barricade) return;   // moving / breakable things don't hold fire
    let n, c;
    if (ax === 'y') {
      if (prev.y < s.min.y) return;      // the underside of something: nothing to stick to
      n = { x: 0, y: 1, z: 0 }; c = { x: b.pos.x, y: s.max.y, z: b.pos.z };
    } else {
      const sg = prev[ax] < (s.min[ax] + s.max[ax]) / 2 ? -1 : 1;
      n = { x: 0, y: 0, z: 0 }; n[ax] = sg;
      c = { ...b.pos }; c[ax] = sg < 0 ? s.min[ax] : s.max[ax];
    }
    this.napalmSplat(b, c, n, s);
  }
  napalmRadius(dmg, lvl) { return clamp(0.45 + 0.5 * Math.sqrt(Math.max(1, dmg) / DEFAULT_STATS.damage), 0.5, 2.0) * (1 + 0.15 * Math.max(0, lvl - 1)); }
  napalmSplat(b, c, n, solid) {
    if (b.flame || this.phase !== 'play') return;
    b.napalmN = (b.napalmN || 0) + 1;
    if (b.napalmN > NAPALM.perBullet) return;
    const L = this.level, R = this.napalmRadius(b.dmg, b.napalm), up = n.y > 0.5;
    if (up && L.lava && c.y < 0.05) return;   // the lava floor doesn't need the help
    // Static solids only, and arena walls only up to their visible height.
    const statics = L.solids;   // the level's own boxes: never moving props or deployables
    const onSurface = (x, y, z) => {
      if (Math.abs(x) > L.hx - 0.05 || Math.abs(z) > L.hz - 0.05) return false;
      if (L.edges && edgeDistance(L.edges, x, z) < (up ? 0.1 : -0.3)) return false;
      if (up) {
        if (pointInSolid(this.solids, x, y + 0.12, z, 0)) return false;          // buried under something
        const g = groundBelow(this.solids, x, z, y + 0.1);
        if (Math.abs(g - y) > 0.04) return false;                                 // past the ledge: would float
        if (g > 0.01) { const sup = this.solids.find(q => !q.wall && x > q.min.x && x < q.max.x && z > q.min.z && z < q.max.z && Math.abs(q.max.y - g) < 0.04); if (!sup || sup.obj || sup.barricade) return false; }
        return true;
      }
      if (y < 0.06) return false;
      const bx = x - n.x * 0.12, bz = z - n.z * 0.12;
      if (pointInSolid(this.solids, x + n.x * 0.06, y, z + n.z * 0.06, 0)) return false;   // something in front of the wall
      if (!solid) return y < NAPALM.polyWallTop && L.edges && edgeDistance(L.edges, bx, bz) < 0;   // angled arena wall
      const back = statics.find(q => bx > q.min.x && bx < q.max.x && bz > q.min.z && bz < q.max.z && y > q.min.y && y < q.max.y);
      return !!back && y < (back.vis ?? back.max.y) - 0.04;
    };
    // Bits on a jittered sunflower pattern across the splat circle, in the surface's plane.
    const t1 = up ? { x: 1, y: 0, z: 0 } : { x: -n.z, y: 0, z: n.x }, t2 = up ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    const count = clamp(Math.round(4 + R * R * 5), 5, 20), bits = [], lift = up ? 0 : 0.04;
    for (let i = 0; i < count; i++) {
      const rr = R * Math.sqrt((i + 0.5) / count) * (0.85 + Math.random() * 0.15), a = i * 2.39996 + Math.random() * 0.4;
      const u = Math.cos(a) * rr, v = Math.sin(a) * rr;
      const x = c.x + t1.x * u + t2.x * v + n.x * lift, y = c.y + t1.y * u + t2.y * v, z = c.z + t1.z * u + t2.z * v + n.z * lift;
      if (onSurface(x, y, z)) bits.push({ x, y, z });
    }
    if (!bits.length) return;
    if (this.fires.length >= NAPALM.max) this.dropFire(this.fires.shift());
    const f = { id: this.nextId++, owner: b.owner, ownerRef: b.ownerRef, cown: b.cown, n, r: R, bits, t: NAPALM.life, dps: b.dmg * NAPALM.dps * b.napalm, checkT: 0 };
    this.fires.push(f);
    const r2 = v => Math.round(v * 100) / 100;
    this.emit({ t: 'napalm', id: f.id, p: b.cown || b.owner, n: [n.x, n.y, n.z], life: NAPALM.life, r: r2(R), b: bits.flatMap(q => [r2(q.x), r2(q.y), r2(q.z)]) });
  }
  // v1.2.9: a fire pushed out by newer ones before anyone was told about it takes its 'napalm' event with it: a napalm volley
  // could make ~180 splats in one step (40 kept), and every client built all 180 fire effects in one frame (a hitch) and got
  // them all on the wire (a burst of ~10 kB, resent until confirmed)
  dropFire(f) { if (!f) return; for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].t === 'napalm' && this.events[i].id === f.id) { this.events.splice(i, 1); break; } }
  updateFires(dt) {
    if (!this.fires.length) return;
    for (const f of this.fires) {
      f.t -= dt;
      if ((f.checkT -= dt) > 0) continue;
      f.checkT = 0.1;
      for (const q of this.players) {
        if (!q.alive || q.reviving || q === f.ownerRef || !this.canHurt(f.ownerRef, q) || this.ownShot(f, q) || this.shielded(q)) continue;
        const pr = PR * q.size + 0.22, top = q.pos.y + PH * q.size;
        if (f.bits.some(k => Math.abs(k.x - q.pos.x) < pr && Math.abs(k.z - q.pos.z) < pr && k.y > q.pos.y - 0.2 && k.y < top + 0.05 && Math.hypot(k.x - q.pos.x, k.z - q.pos.z) < pr)) {
          this.setBurn(q, NAPALM.burnFor, f.dps, f.ownerRef, f);
        }
      }
    }
    this.fires = this.fires.filter(f => f.t > 0);
  }

  // Crates and barrels tip over if hit hard enough (or often enough) up high.
  tipCheck(o, b, J) {
    if (!o || !(o.kind === 'crate' || o.kind === 'barrel') || o.tipped) return;
    const lever = (b.pos.y - (o.pos.y + o.h * 0.4)) / o.h;
    if (lever <= 0) return;
    o.tipAcc = (o.tipAcc || 0) * Math.exp(-(this.time - (o.tipT || 0)) * 0.6) + J * lever;
    o.tipT = this.time;
    if (o.tipAcc < (o.kind === 'barrel' ? 2.2 : 3.2)) return;
    const dx = b.vel.x, dz = b.vel.z;
    if (Math.abs(dx) >= Math.abs(dz)) { o.tipped = dx > 0 ? 1 : 2; const old = o.w; o.w = o.h; o.h = old; o.pos.x += Math.sign(dx) * (o.w - old) / 2; }
    else { o.tipped = dz > 0 ? 3 : 4; const old = o.d; o.d = o.h; o.h = old; o.pos.z += Math.sign(dz) * (o.d - old) / 2; }
    this.updateSolid(o);
    this.emit({ t: 'tip', x: o.pos.x, y: o.pos.y + 0.3, z: o.pos.z });
  }

  checkRoundEnd() {
    if (this.booms.some(b => b.spite)) return;   // v1.2.15 Spite Charge: the round waits for a fuse that's still burning
    const live = BRAWL_ON ? (p => p.connected && p.stocks > 0) : (p => p.alive || p.reviving);
    if (this.ow) { const w = owRoundEnd(this); if (w !== undefined) this.endRound(w); return; }
    if (this.settings.core) {   // Core Defense: the wave is lost when the core falls (players respawn), won when the raid is cleared
      const enemiesUp = this.players.some(p => p.team === 1 && p.transient && live(p)) || !!(this.gm && this.gm.queue.length);
      if (!(this.core && this.core.alive)) {   // v28: the core blows apart (renderer coreBlast), and the round end waits for it
        const c = this.core; this.emit({ t: 'coreDown', x: c ? c.pos.x : 0, y: c ? c.pos.y : 0, z: c ? c.pos.z : 0 });
        this.endRound('waves'); this.phaseT = 4;
      } else if (!enemiesUp) this.endRound('players');
      return;
    }
    if (this.isWaves()) {
      const heroesUp = this.players.some(p => p.kind === 'hero' && p.connected && live(p));
      const enemiesUp = this.players.some(p => p.team === 1 && p.transient && live(p)) || !!(this.gm && this.gm.queue.length);
      if (!heroesUp) this.endRound('waves');
      else if (!enemiesUp) this.endRound('players');
      return;
    }
    if (this.tourn) { tournCheck(this); return; }
    const keys = new Set(this.players.filter(p => p.kind === 'hero' && live(p)).map(p => this.scoreKey(p)));
    if (keys.size === 0 && !BRAWL_ON) {
      // v1.2.13 (Devin): everyone's down, but a Space King, deployed turret or critter still standing wins the round for its owner.
      // Units of several sides left: they fight on for up to 8 s, then the side with the most health left takes it.
      const side = new Map();
      for (const u of this.players) {
        if (!u.alive || !u.transient || !(u.kingOf || UNIT_WINS.has(u.kind))) continue;
        const o = this.player(u.ownerId || u.kingOf), k = o && this.scoreKey(o);
        if (k && k !== 'gone' && k !== 'hazard') side.set(k, (side.get(k) || 0) + Math.max(0, u.hp));
      }
      if (side.size === 1) { this.endRound([...side.keys()][0]); return; }
      if (side.size > 1) {   // v1.2.26 (Devin): they fight on while damage is being dealt; 10 s with none (turrets out of each other's reach) is a draw
        this.unitsOnlyT = (this.unitsOnlyT ?? this.time);
        const quiet = this.time - Math.max(this.unitsOnlyT, this.lastDmgT ?? -1e9);
        if (quiet >= 10) { this.endRound(null); return; }
        if (this.time - this.unitsOnlyT < 60) return;
        this.endRound([...side.entries()].sort((a, b) => b[1] - a[1])[0][0]); return;   // (a minute of trading blows: most health left)
      }
    }
    this.unitsOnlyT = null;
    if (keys.size <= 1) this.endRound(keys.size === 1 ? [...keys][0] : null);
  }

  endRound(w, extra) {
    this.phase = 'roundEnd'; this.phaseT = 2.0; this.roundWinner = w; this.unitsOnlyT = null;
    if (w != null && w !== 'waves' && w in this.scores) this.scores[w]++;
    // v1.2.15 kill cam: a versus round that just ended on a kill waits for the replay (main.js kcStart)
    const lk = this.lastKill, kc = w != null && lk && this.time - lk.t < 1.2 && lk.k != null && lk.k !== lk.p && !this.isWaves() && !this.isSide() && !this.isOpen() && !this.isPractice() && !this.settings.commander ? { k: lk.k, p: lk.p, v: this.viewOf(lk.k) } : null;
    if (kc) this.phaseT += 3.2;
    this.emit({ t: 'roundEnd', w, wave: this.isWaves() ? this.round : 0, kc, ...extra });
  }

  tallyList() {
    return this.heroes().map(p => ({ id: p.id, damage: Math.round(p.tally.damage), kills: p.tally.kills, deaths: p.tally.deaths }));
  }

  afterRound() {
    const w = this.roundWinner;
    if (this.isOpen()) {   // open world: no pick phase (cards come from loot); every round is a fresh drop
      const champ = this.isExtract() ? (w !== 'players' ? 'roamers' : this.scores.players >= this.settings.roundsToWin ? 'players' : null)
        : Object.keys(this.scores).find(k => this.scores[k] >= this.settings.roundsToWin);
      const activeKeys = new Set(this.heroes().filter(p => p.connected).map(p => this.scoreKey(p)));
      if (champ || (!this.isExtract() && activeKeys.size < 2 && this.heroes().length > 1) || !this.heroes().some(p => p.connected && !p.isBot)) {
        this.phase = 'over';
        this.winner = champ || Object.keys(this.scores).sort((a, b) => this.scores[b] - this.scores[a])[0];
        this.emit({ t: 'over', w: this.winner, goal: this.settings.roundsToWin, tally: this.tallyList(), waves: this.scores.players });
        return;
      }
      this.startRound(); return;
    }
    if (this.settings.core) {
      if (w !== 'players') {   // the core fell: the host can retry this wave (as it started) or start over
        this.phase = 'over'; this.winner = 'waves';
        this.emit({ t: 'over', w: 'waves', waves: this.scores.players, tally: this.tallyList(), retry: this.round });
        return;
      }
      if (this.scores.players >= this.settings.roundsToWin) {
        this.phase = 'over'; this.winner = 'players';
        this.emit({ t: 'over', w: 'players', waves: this.scores.players, goal: this.settings.roundsToWin, tally: this.tallyList() });
        return;
      }
      coreAwardLeftovers(this);   // v1.0.1: upgrades nobody reached still count
      return this.offerCards([]);   // cards only come from upgrade pickups (anyone owed a pick chooses now)
    }
    if (this.isWaves()) {
      if (w !== 'players' && this.lossTokens > 0 && !isBossWave(this) && this.heroes().some(p => p.connected)) {
        // the loss token: the squad gets this wave back once per run (fresh wave, same cards)
        this.lossTokens--;
        this.emit({ t: 'lossToken', wave: this.round, left: this.lossTokens });
        this.round = Math.max(0, this.round - 1);
        this.startRound();
        return;
      }
      if (w !== 'players') {
        this.phase = 'over'; this.winner = 'waves';
        this.emit({ t: 'over', w: 'waves', waves: this.scores.players, tally: this.tallyList() });
        return;
      }
      if (this.scores.players >= this.settings.roundsToWin) {   // survived every wave
        this.phase = 'over'; this.winner = 'players';
        this.emit({ t: 'over', w: 'players', waves: this.scores.players, goal: this.settings.roundsToWin, tally: this.tallyList() });
        return;
      }
      return this.offerCards(this.heroes().filter(p => p.connected));
    }
    if (this.tourn) return tournAfter(this);   // v1.2.26: lives, knockouts, losers pick (tourn.js)
    const champ = Object.keys(this.scores).find(k => this.scores[k] >= this.settings.roundsToWin);
    const activeKeys = new Set(this.heroes().filter(p => p.connected).map(p => this.scoreKey(p)));
    if (champ || activeKeys.size < 2) {
      this.phase = 'over';
      this.winner = champ || Object.keys(this.scores).sort((a, b) => this.scores[b] - this.scores[a])[0];
      this.emit({ t: 'over', w: this.winner, goal: this.settings.roundsToWin, tally: this.tallyList() });
      return;
    }
    if (w == null || this.isBrawl()) { this.startRound(); return; }   // brawl: fixed builds, no pick phase
    this.offerCards(this.heroes().filter(p => p.connected && this.scoreKey(p) !== w));
  }

  offerCards(pickers) {
    // Late joiners still owed catch-up cards pick this phase even if their side won the round.
    const losers = new Set(pickers.filter(p => p.connected)), set = new Set(losers);
    for (const p of this.heroes()) if (p.connected && p.picksOwed > 0) set.add(p);
    pickers = [...set];
    if (!this.allCards.length || !pickers.length) { for (const p of pickers) p.picksOwed = 0; this.afterPicks(); return; }
    this.phase = 'picking';
    for (const p of pickers) {
      const owed = p.picksOwed || 0;
      p.catchUp = owed > 0 && !this.settings.core;   // (Core Defense: owed picks come from upgrades, not a late join)
      p.picksLeft = p.picksTotal = (losers.has(p) ? this.picksPerPhase() : 0) + owed;
      p.picksOwed = 0; p.picked = false; p.awaitCombo = null; p.awaitBreak = null;
    }
    this.phaseT = Math.max(...pickers.map(p => this.pickLimit(p)));
    this.emit({ t: 'picking', losers: pickers.map(p => p.id), stats: this.statsList() });
    for (const p of pickers) this.nextOffer(p);
  }
  picksPerPhase() { return this.settings.speed ? 2 : 1; }
  // Seconds a player gets for each pick: the lobby's pick time, 50% longer while catching up after a late join.
  pickLimit(p) { const base = this.settings.pickTime > 0 ? this.settings.pickTime : Infinity; return base * (p.catchUp ? 1.5 : 1); }
  nextOffer(p, exclude = []) {
    p.offer = this.makeOffer(p, exclude);
    p.pickT = this.pickLimit(p); p.pickDelay = 0.8 + Math.random() * 1.5;
    // v1.2.26 tournament teams: a bot whose human ally is picking too waits a little, so the ally can offer it a card
    if (p.isBot && this.tourn && this.settings.tTeams && this.players.some(q => q !== p && !q.isBot && q.kind === 'hero' && q.connected && !q.picked && q.picksLeft > 0 && this.scoreKey(q) === this.scoreKey(p))) p.pickDelay += 6;
    this.onOffer(p);
  }
  // What the pick screen shows about this player's current offer (pick 1 of 2, timer, catch-up).
  offerInfo(p) {
    return { start: !!this.prePick, left: p.picksLeft, total: p.picksTotal, time: isFinite(p.pickT) ? Math.round(p.pickT * 10) / 10 : 0, catchUp: !!p.catchUp, speed: !!this.settings.speed };
  }

  // After a match ends, keep going: raise the target score and carry on.
  // Core Defense: after the core falls, play that wave again from how it started (same builds, cards and core health).
  retryRound() {
    if (this.phase !== 'over' || !this.settings.core || this.winner === 'players' || !this.coreSaved) return false;
    this.coreRetry = this.coreSaved;
    this.round = Math.max(0, this.round - 1); this.winner = null;
    this.emit({ t: 'coreRetry', n: this.round + 1 });
    this.startRound();
    return true;
  }
  extend(extraRounds) {
    if (this.phase !== 'over') return false;
    if (this.tourn) return tournExtend(this, extraRounds);   // v1.2.29: more lives for everyone
    if (this.isWaves()) {
      // Co-op: only after a win (the boss is down). More waves, a new boss on the last one, everything tougher.
      const won = this.winner === 'players';
      if (!won) return false;
      this.settings.roundsToWin = Math.max(this.settings.roundsToWin, this.scores.players) + Math.max(1, extraRounds | 0);
      this.winner = null;
      this.emit({ t: 'extend', goal: this.settings.roundsToWin, waves: 1 });
      return this.offerCards(this.heroes().filter(p => p.connected)), true;
    }
    const top = Math.max(0, ...Object.values(this.scores));
    this.settings.roundsToWin = Math.max(this.settings.roundsToWin, top) + Math.max(1, extraRounds | 0);
    this.winner = null;
    this.emit({ t: 'extend', goal: this.settings.roundsToWin });
    this.afterRound();
    return true;
  }

  pick(id, cardId) {
    const p = this.player(id);
    if (!p || this.phase !== 'picking' || p.picked || !p.offer || !p.offer.includes(cardId)) return false;
    const c = this.cardById.get(cardId);
    if (!c || !this.canTake(p, c)) return false;
    if (c.special === 'modBreaker') {
      // Asks which held mod to destroy (like a combo question); the card itself is used up.
      const opts = this.heldMods(p);
      p.offer = null;
      p.picksLeft = Math.max(0, (p.picksLeft || 1) - 1);
      this.emit({ t: 'picked', p: id, card: cardId, more: p.picksLeft > 0 });
      if (!opts.length) { this.pickDone(p); return true; }
      p.awaitBreak = opts;
      if (p.isBot) this.breakChoice(id, opts[Math.floor(Math.random() * opts.length)]);
      else { p.pickT = this.pickLimit(p); this.onBreak(p, opts); }
      return true;
    }
    if (c.special === 'repentance') {
      const i = p.cards.findIndex(x => (this.cardById.get(x) || {}).special === 'regretfulPact');
      if (i >= 0) p.cards.splice(i, 1);
      p.pact = false;
    } else {
      if (c.weaponMod) p.cards = p.cards.filter(x => !(this.cardById.get(x) || {}).weaponMod); // one gun at a time
      if (c.shieldMod) p.cards = p.cards.filter(x => !(this.cardById.get(x) || {}).shieldMod); // one shield mod at a time
      p.cards.push(cardId);
      if (c.special === 'regretfulPact') p.pact = true;
    }
    this.recompute(p);
    p.offer = null;
    p.picksLeft = Math.max(0, (p.picksLeft || 1) - 1);
    this.emit({ t: 'picked', p: id, card: cardId, more: p.picksLeft > 0 });
    this.emitCards(p);
    // Combos are offered, not forced, and only asked about when you pick one of its pieces.
    const C = this.settings.combos === false ? null : this.combos.find(k => k.combo.includes(this.baseId(cardId)) && this.hasPair(p, k));
    if (C) {
      p.awaitCombo = C.id;
      if (p.isBot) this.comboChoice(id, true);
      else { p.pickT = this.pickLimit(p); this.onCombo(p, this.cardById.get(this.comboResult(p, C)) || C); }
      return true;
    }
    this.pickDone(p);
    return true;
  }
  // After a pick (and any combo question): Speed mode / catch-up players get a fresh hand, everyone else is done.
  pickDone(p) {
    if (p.picksLeft > 0 && p.connected && this.phase === 'picking') { this.nextOffer(p); return; }
    p.picksLeft = 0; p.picked = true; p.catchUp = false;
    this.maybeFinishPicking();
  }
  emitCards(p) { this.emit({ t: 'cards', p: p.id, cards: p.cards.slice(), s: this.statSummary(p) }); }
  // Numbers for the stats window on the card screen (visible to everyone).
  statSummary(p) {
    const s = p.stats, r = (v, k = 1) => Math.round(v * k) / k;
    return { hp: Math.round(s.health), dmg: r(s.damage), spd: r(s.bulletSpeed), bnc: Math.round(s.bounces), regen: r(s.regen, 10), rate: r(s.fireRate, 10),
      ammo: Math.round(s.ammo), rel: r(s.reloadTime, 100), proj: Math.round(s.projectiles), ls: Math.round(s.lifesteal * 100), move: r(s.moveSpeed, 10), blk: r(s.blockCooldown, 10) };
  }
  statsList() { return this.heroes().filter(p => p.connected).map(p => ({ id: p.id, s: this.statSummary(p) })); }
  hasPair(p, C) { return !!this.comboIdx(p, C); }
  comboChoice(id, accept) {
    const p = this.player(id);
    if (!p || !p.awaitCombo) return false;
    const C = this.cardById.get(p.awaitCombo);
    p.awaitCombo = null;
    if (accept && C && this.hasPair(p, C)) {
      this.formCombo(p, C);
      this.recompute(p);
      this.emitCards(p);
    }
    this.pickDone(p);
    return true;
  }

  // Mod Breaker answer: destroy the chosen weapon or shield mod (null = keep both).
  breakChoice(id, cardId) {
    const p = this.player(id);
    if (!p || !p.awaitBreak) return false;
    const opts = p.awaitBreak; p.awaitBreak = null;
    if (cardId && opts.includes(cardId) && p.cards.includes(cardId)) {
      p.cards.splice(p.cards.indexOf(cardId), 1);
      this.recompute(p);
      this.emit({ t: 'modBroken', p: p.id, card: cardId });
      this.emitCards(p);
    }
    this.pickDone(p);
    return true;
  }
  maybeFinishPicking() {
    if (this.phase === 'picking' && this.players.every(p => p.picked || !p.connected)) this.afterPicks();
  }

  reroll(id) {
    const p = this.player(id);
    if (!p || this.phase !== 'picking' || p.picked || p.rerollsLeft <= 0) return false;
    p.rerollsLeft--;
    p.offer = this.makeOffer(p, p.offer);
    this.emit({ t: 'reroll', p: id });
    this.onOffer(p);
    return true;
  }

  // ------------------------------------------------------------ late joins
  // Average number of cards the other heroes hold (what a brand-new late joiner catches up to).
  averageCards(exceptId) {
    const others = this.heroes().filter(p => p.connected && p.id !== exceptId && !p.dummy);
    return others.length ? Math.round(others.reduce((a, p) => a + p.cards.length, 0) / others.length) : 0;
  }
  // A player joining a match in progress. They watch until the next round starts.
  // restore: { cards, tally, rerollsLeft, score, oldKey } for someone who left and came back.
  addPlayer(r, restore = null) {
    const p = this.makePlayer({ ...r, kind: 'hero' });
    p.alive = false; p.lateJoin = true;
    if (restore) {
      p.cards = (restore.cards || []).filter(id => this.cardById.has(id));
      if (restore.tally) p.tally = { ...p.tally, ...restore.tally };
      if (restore.rerollsLeft != null) p.rerollsLeft = restore.rerollsLeft;
      p.pact = p.cards.some(id => (this.cardById.get(id) || {}).special === 'regretfulPact');
    } else p.picksOwed = this.averageCards(p.id);
    this.recompute(p);
    if (this.isBrawl()) { p.picksOwed = 0; applyFighter(this, p); }   // brawl: your character is your build
    if (this.isOpen()) { p.picksOwed = 0; p.cards = []; this.recompute(p); }   // open world: cards only ever come from loot
    this.players.push(p);
    const k = this.scoreKey(p);
    if (!this.isWaves() && !this.isPractice()) {
      if (restore && restore.oldKey && restore.oldKey !== k && restore.oldKey in this.scores && this.settings.mode !== 'tdm') {
        this.scores[k] = this.scores[restore.oldKey]; delete this.scores[restore.oldKey];
      } else if (!(k in this.scores)) this.scores[k] = restore && restore.score ? restore.score : 0;
    }
    this.emitCards(p);
    // A pick phase running right now counts as their next one.
    if (this.phase === 'picking' && p.picksOwed > 0) {
      p.catchUp = true; p.picksLeft = p.picksTotal = p.picksOwed; p.picksOwed = 0; p.picked = false;
      this.nextOffer(p);
    }
    return p;
  }
  // Someone who left comes back with the same id (Steam ids don't change): same cards, same score.
  reconnect(id) {
    const p = this.player(id);
    if (!p || p.connected) return null;
    p.connected = true; p.alive = false; p.lateJoin = true; p.picked = true; p.offer = null; p.retireNext = false;
    p.input = emptyInput(); p.lastBlockSeq = 0; p.lastReloadSeq = 0;
    this.emitCards(p);
    return p;
  }
  // Frees a seat for a late joiner when the match is full: a bot leaves at the start of the next round.
  retireBot() {
    const b = this.heroes().filter(p => p.isBot && p.connected && !p.retireNext && !p.dummy).pop();
    if (b) b.retireNext = true;
    return b ? b.id : null;
  }
  seatsTaken() { return this.heroes().filter(p => p.connected && !p.retireNext).length; }

  // ------------------------------------------------------------ practice range
  practiceTick(dt) {
    for (const p of this.players) {
      if (p.kind !== 'hero' || !p.connected || p.alive || p.reviving) continue;
      if (p.respawnT == null) p.respawnT = p.dummy ? 1.5 : 1.0;
      p.respawnT -= dt;
      if (p.respawnT <= 0) { p.respawnT = null; this.resetPlayer(p, p.spawn); this.emit({ t: 'respawn', p: p.id }); }
    }
  }
  // Dummies: 'idle' stand still, 'move' walk around without shooting, 'fight' play like a normal bot.
  dummyThink(p, dt) {
    const mode = this.settings.dummyMode || 'idle', inp = p.input;
    if (mode === 'idle') { inp.mx = inp.mz = 0; inp.jump = false; inp.shoot = false; return; }
    botThink(this, p, dt);
    if (mode === 'move') { inp.shoot = false; inp.blockSeq = p.lastBlockSeq; }
  }
  // Practice range: replace a player's cards outright (add/remove freely) and top them up.
  practiceSetCards(id, cards) {
    const p = this.player(id);
    if (!p || !this.isPractice()) return false;
    p.cards = (cards || []).filter(c => this.cardById.has(c)).slice(0, 120);
    p.pact = p.cards.some(c => (this.cardById.get(c) || {}).special === 'regretfulPact');
    this.recompute(p);
    if (p.alive) { p.hp = this.maxHp(p); p.ammo = p.stats.ammo; p.reloadT = 0; }
    this.emitCards(p);
    return true;
  }

  // ------------------------------------------------------------ v1.2.15 new cards (round 2)
  ncReset(p) {
    const s = p.stats;
    p.fx.shell = Math.round(s.shell || 0);   // Gilded Shell: back every round and every life
    if (s.gamble > 0) this.gambleRoll(p, true);
  }
  salvoOn(p) { const s = p.stats.salvo; return s > 0 && this.phase === 'play' && this.fightAt != null && this.time - this.fightAt < s; }
  // Opening Salvo and Last Stand Rig speed boosts (part of walkSpeed, so joiners' prediction gets them too)
  rushK(p) {
    const s = p.stats;
    return (this.salvoOn(p) ? 1 + NEWC.salvoSpeed : 1) * ((p.fx.lsT || 0) > this.time ? 1 + NEWC.stand.speed * (s.lastStand || 0) : 1);
  }
  // Backpedal Boots: faster moving away from where you aim, slower moving toward it (main.js predReplay copies this)
  dirSpeedK(p, mx, mz) {
    const bp = p.stats.backpedal || 0, adv = p.stats.advanceSlow || 0;
    if (!(bp > 0 || adv > 0)) return 1;
    const ml = Math.hypot(mx || 0, mz || 0), al = Math.hypot(p.aim.x, p.aim.z);
    if (ml < 0.1 || al < 1e-3) return 1;
    const dot = (mx * p.aim.x + mz * p.aim.z) / (ml * al);
    return dot < 0 ? 1 + bp * -dot : Math.max(0.2, 1 - adv * dot);
  }
  groundPound(p) {
    if ((p.fx.poundT || 0) > this.time) return;
    p.fx.poundT = this.time + 0.4;
    const lv = p.stats.pound, P = NEWC.pound, R = P.r + 0.5 * (lv - 1);
    for (const q of this.players) {
      if (!q.alive || q.reviving || !this.isEnemy(p, q) || q.flying) continue;
      if (Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z) > R + PR * q.size || Math.abs(q.pos.y - p.pos.y) > 1.5) continue;
      if (!q.heavy) { q.vel.y = Math.max(q.vel.y, P.pop * Math.sqrt(lv) / q.size); q.onGround = false; }
      this.dmgTag = 'blast'; this.hurt(q, P.dmg * lv, p, null);
    }
    this.emit({ t: 'nc', k: 'pound', p: p.id, x: p.pos.x, y: p.pos.y + 0.1, z: p.pos.z, r: R });
  }
  // Gambler's Mag: every reload (and each round's first mag) rolls one bonus for the whole mag
  gambleRoll(p, quiet = false) {
    if (!(p.stats.gamble > 0)) return;
    p.fx.gam = Math.floor(Math.random() * NEWC.gamble.length);
    if (!quiet) this.emit({ t: 'nc', k: 'gamble', p: p.id, r: p.fx.gam });
  }
  // Blood Volley: hold Reload to pay 25% of your current health for a fan of piercing shots (a full mag's worth, free)
  volleyHold(p, dt, held) {
    if (!held) { p.fx.vhT = 0; p.fx.vhDone = false; return; }
    p.fx.vhT = (p.fx.vhT || 0) + dt;
    if (p.fx.vhDone || p.fx.vhT < NEWC.volley.hold || (p.fx.vCd || 0) > this.time || p.hp <= 1 || p.mod === 'katana' || p.mod === 'shield') return;
    if (!budgetAllow(this, p)) return;
    p.fx.vhDone = true; p.fx.vCd = this.time + NEWC.volley.cd;
    const s = p.stats, V = NEWC.volley, cost = p.hp * V.cost;
    p.hp = Math.max(1, p.hp - cost);
    const n = Math.max(1, Math.round(s.ammo)), k = 0.6 + 0.4 * s.bloodVolley;
    for (let i = 0; i < n; i++) {
      const a = n > 1 ? (i / (n - 1) - 0.5) * V.fan : 0, d = norm(rotY(p.aim, a));
      const b = this.spawnBullet(p, { x: p.pos.x + d.x * 0.75 * p.size, y: this.chest(p) + d.y * 0.75, z: p.pos.z + d.z * 0.75 * p.size }, d, s.bulletSpeed, false);
      b.pierce = true; b.dmg *= k; b.shot = true;
    }
    this.emit({ t: 'shoot', p: p.id, x: p.pos.x, y: this.chest(p), z: p.pos.z, sky: 0 });
    this.emit({ t: 'nc', k: 'volley', p: p.id, a: Math.round(cost), x: p.pos.x, y: this.chest(p), z: p.pos.z });
  }
  // Purge Pulse: wipes every player-made wall, turret, mine, critter and summon nearby (yours too). Once per round.
  purgePulse(p) {
    p.fx.purge = 0; p.fx.purgeUsed = true;
    const R = p.stats.purge, x = p.pos.x, z = p.pos.z, near = (ax, az, pad = 0) => Math.hypot(ax - x, az - z) < R + pad;
    const CORE_KINDS = new Set(['block', 'cube', 'plank', 'slab', 'steel', 'spikes']);   // Core Defense builds stay
    for (const b of this.barricades.slice()) if (!CORE_KINDS.has(b.kind) && near(b.x, b.z, (b.len || 0) / 2)) this.damageBarricade(b, (b.hp || 0) + 1e6);
    for (const s of this.shields) if (!s.box && near(s.x, s.z)) s.t = 0;
    this.mines = this.mines.filter(m => !near(m.x, m.z));
    let gone = 0;
    for (const u of this.players) {
      if (!u.alive || !u.transient || u.kind === 'core' || (u.kind === 'boss' && !u.kingOf) || u.kind === 'portal') continue;
      if (!(u.ownerId || u.kingOf || ['critter', 'turret', 'drone', 'blockTurret'].includes(u.kind))) continue;
      if (!near(u.pos.x, u.pos.z)) continue;
      if (u.kind === 'mount' && u.riderId) { const r = this.player(u.riderId); if (r) this.dismount(r); }
      this.expireUnit(u); gone++;
    }
    if (gone) this.unitsChanged();
    this.emit({ t: 'nc', k: 'purge', p: p.id, x, y: p.pos.y + 0.2, z, r: R });
  }
  // Per-shot boosts, worked out before the shot and put on its bullets after (applyBoost)
  shotBoost(p, encore) {
    const s = p.stats, f = p.fx, B = { dmg: 1, r: 1, speed: 1, proj: 1, pierce: false, bounce: 0, homing: 0, flat: 0, rhythm: false };
    if (!encore) {
      if (s.lastRound > 0 && p.ammo === 0 && p.mod !== 'critter') { B.dmg *= 1 + s.lastRound; B.r *= 1.5; }   // Tight Chamber
      if (s.coldBarrel > 0 && this.time - (f.lastFire ?? -99) >= NEWC.cold.wait) { B.dmg *= 1 + s.coldBarrel; B.speed *= 1 + s.coldBarrel * NEWC.cold.speedK; }   // Cold Barrel
      f.lastFire = this.time;
      if (f.rhyReady) { const R = NEWC.rhythm; f.rhyReady = false; B.dmg *= R.dmg; B.r *= R.size; B.pierce = true; B.rhythm = true; this.emit({ t: 'nc', k: 'rhythm', p: p.id, x: p.pos.x, y: this.chest(p), z: p.pos.z }); }   // Battle Rhythm
      if (s.payback > 0 && f.pb && f.pb.length) {   // Payback
        const sum = f.pb.filter(e => this.time - e[0] <= NEWC.payback).reduce((a, e) => a + e[1], 0);
        B.flat = Math.min(sum, s.payback * this.effDamage(s)); f.pb = [];
      }
    }
    if (s.gamble > 0 && f.gam != null) {   // Gambler's Mag (encores too)
      const g = NEWC.gamble[f.gam], lv = s.gamble;
      if (g === 'dmg') B.dmg *= 1 + lv; else if (g === 'proj') B.proj *= 1 + 0.5 * lv; else if (g === 'bounce') B.bounce += 2 * lv; else if (g === 'homing') B.homing += 2.5 * lv;
    }
    return B;
  }
  applyBoost(p, B, b0) {
    const n = this.bullets.length - b0;
    for (let i = b0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      b.shot = true;
      b.dmg = b.dmg * B.dmg + (n ? B.flat / n : 0);
      if (B.r !== 1) b.r = clamp(b.r * B.r, 0.05, 1.2);
      if (B.speed !== 1) { b.vel.x *= B.speed; b.vel.y *= B.speed; b.vel.z *= B.speed; }
      if (B.pierce) b.pierce = true;
      if (B.rhythm) b.rhythmShot = true;
      if (B.bounce) b.bLeft += Math.round(B.bounce);
      if (B.homing) b.homing += B.homing;
    }
  }
  // Block add-ons: Afterimage, Snare Plate and the Scorched Floor / Swap Shot shield mods
  ncBlock(p) {
    const s = p.stats;
    if (s.afterimage > 0 && p.kind !== 'decoy') this.spawnDecoy(p);
    if (s.snare > 0) {
      const mine = this.mines.filter(m => m.owner === p.id && m.snare);
      if (mine.length >= NEWC.snare.max) this.mines = this.mines.filter(m => m !== mine[0]);
      const gy = p.onGround ? p.pos.y : groundBelow(this.solids, p.pos.x, p.pos.z, p.pos.y + 0.3);
      this.mines.push({ id: this.nextId++, owner: p.id, ownerRef: p, x: p.pos.x, y: gy, z: p.pos.z, armT: NEWC.snare.arm, life: 9999, dmg: 0, snare: s.snare, sz: 1 });
    }
    if (p.smod === 'scorch' && s.scorch > 0) {
      const gy = p.onGround ? p.pos.y : groundBelow(this.solids, p.pos.x, p.pos.z, p.pos.y + 0.3);
      this.firePatch(p, p.pos.x, gy, p.pos.z, NEWC.scorch.r * Math.sqrt(clamp(s.blockSize || 1, 0.5, 3)), NEWC.scorch.dps * this.effDamage(s) / DEFAULT_STATS.damage, s.scorch);
    }
    if (p.smod === 'swap' && s.swapShot > 0) {
      const W = NEWC.swap, d = norm(p.aim);
      const b = this.spawnBullet(p, { x: p.pos.x + d.x * 0.9 * p.size, y: this.chest(p), z: p.pos.z + d.z * 0.9 * p.size }, d, W.speed + W.perLv * s.swapShot, false);
      Object.assign(b, { swap: true, dmg: 0, r: W.r, grav: 0, life: W.life, bLeft: 0, explosive: 0, homing: 0, drill: 0, poison: 0, ignite: 0, chill: 0, hex: 0, chain: 0, limpet: 0,
        shrapnel: 0, napalm: 0, toxic: 0, bounceTarget: 0, bounceExplode: 0, bounceBoost: 0, bounceSplit: 0, ring: 0, swarm: null, fx: 'swap', knockback: 0 });
    }
  }
  spawnDecoy(p) {
    const owner = p.ownerId ? this.player(p.ownerId) || p : p;
    this.capUnits(owner, 'decoy', NEWC.decoy.max);
    const u = this.spawnUnit('decoy', owner, { x: p.pos.x, y: p.pos.y, z: p.pos.z }, { life: p.stats.afterimage });
    u.aim = { ...p.aim }; u.fixedSize = p.size;
    this.unitsChanged();
    this.emit({ t: 'nc', k: 'decoy', p: p.id, x: p.pos.x, y: this.chest(p), z: p.pos.z });
    return u;
  }
  swapPlaces(b, q) {
    const a = b.ownerRef; b.alive = false;
    if (!a || !a.alive || a.reviving || q === a || q.heavy || q.kind === 'boss' || q.kind === 'core' || q.kind === 'portal' || q.fx.mount || a.fx.mount) { this.emit({ t: 'impact', x: b.pos.x, y: b.pos.y, z: b.pos.z, p: b.owner }); return; }
    const pa = { ...a.pos }, pq = { ...q.pos };
    a.pos = pq; q.pos = pa; a.vel = { x: 0, y: 0, z: 0 }; q.vel = { x: 0, y: 0, z: 0 };
    this.emit({ t: 'nc', k: 'swap', p: a.id, q: q.id, x1: pa.x, y1: pa.y + 1, z1: pa.z, x2: pq.x, y2: pq.y + 1, z2: pq.z });
  }
  snareCheck(m) {
    if (m.armT > 0) return;
    for (const q of this.players) {
      if (!q.alive || q.reviving || q.flying || !this.isEnemy(m.ownerRef, q) || q.kind === 'boss' || q.kind === 'core' || q.kind === 'decoy') continue;
      if (Math.hypot(q.pos.x - m.x, q.pos.z - m.z) < 0.6 + PR * q.size && Math.abs(q.pos.y - m.y) < 1) {
        m.dead = true; q.fx.rootT = this.time + m.snare; q.vel.x = 0; q.vel.z = 0;
        this.emit({ t: 'nc', k: 'snare', p: q.id, o: m.owner, x: m.x, y: m.y, z: m.z, d: m.snare });
        return;
      }
    }
  }
  ncHurt(t, rest, enemyHit) {
    const s = t.stats, f = t.fx;
    if (s.lastStand > 0 && !f.lsUsed && t.hp < NEWC.stand.at * this.maxHp(t)) {   // Last Stand Rig
      const S2 = NEWC.stand; f.lsUsed = true;
      t.ammo = Math.round(s.ammo); t.reloadT = 0;
      t.blockT = Math.max(t.blockT, S2.block * Math.sqrt(s.lastStand)); t.blockExtra = RULES.blockMaxExtra;
      f.lsT = this.time + S2.time;
      this.emit({ t: 'nc', k: 'stand', p: t.id, x: t.pos.x, y: this.chest(t), z: t.pos.z });
    }
    if (enemyHit && s.payback > 0) { const L = f.pb || (f.pb = []); L.push([this.time, rest]); while (L.length && (L.length > 40 || this.time - L[0][0] > NEWC.payback)) L.shift(); }
  }
  ncDeath(t, src, credit, over, dir, quiet) {
    const ts = t.stats;
    if (ts.spite > 0) {   // Spite Charge: a blast where you fell after a short fuse
      const pos = { x: t.pos.x, y: this.chest(t), z: t.pos.z };
      this.booms.push({ t: NEWC.spite, pos, dmg: ts.spite, owner: t, spite: true, opts: { full: true, noSelf: true } });
      this.emit({ t: 'nc', k: 'spite', p: t.id, x: pos.x, y: t.pos.y + 0.1, z: pos.z, r: Math.round((1.4 + 0.6 * Math.sqrt(ts.spite / DEFAULT_STATS.damage)) * 100) / 100, f: NEWC.spite });
    }
    const ss = src && src.stats;
    if (ss && ss.overpen > 0 && !quiet && dir && over >= 1 && src.alive) {   // Overpen Rounds: the overkill flies on
      let best = null, bd = NEWC.overpen;
      for (const q of this.players) {
        if (q === t || !q.alive || q.reviving || !this.isEnemy(src, q)) continue;
        const dx = q.pos.x - t.pos.x, dz = q.pos.z - t.pos.z, d = Math.hypot(dx, dz);
        if (d < bd && (dx * dir.x + dz * dir.z) > -0.3 * d) { bd = d; best = q; }
      }
      if (best) {
        const o = { x: t.pos.x, y: this.chest(t), z: t.pos.z }, d = norm({ x: best.pos.x - o.x, y: this.chest(best) - o.y, z: best.pos.z - o.z });
        const b = this.spawnBullet(src, o, d, Math.max(24, ss.bulletSpeed), false);
        if (this._hitCown) b.cown = this._hitCown;
        Object.assign(b, { dmg: over * ss.overpen, noHit: t.id, grav: 0, bLeft: 0, explosive: 0, shrapnel: 0, napalm: 0, toxic: 0, limpet: 0, chain: 0, bounceSplit: 0, bounceExplode: 0, swarm: null, fx: undefined, homing: 0 });
        this.emit({ t: 'nc', k: 'overpen', p: src.id, x1: o.x, y1: o.y, z1: o.z, x2: best.pos.x, y2: this.chest(best), z2: best.pos.z });
      }
    }
    if (credit && credit !== t && credit.alive && credit.stats.squad > 0 && t.kind !== 'decoy') this.spawnSoldier(credit);   // Squad Caller
  }
  spawnSoldier(o) {
    const Q = NEWC.squad, os = o.stats;
    this.capUnits(o, 'soldier', Math.max(1, Math.round(os.squad)));
    const stats = { ...DEFAULT_STATS, health: Q.hp, damage: this.effDamage(os) * Q.dmg, fireRate: Q.rate, ammo: 4, reloadTime: 1.5, moveSpeed: Q.speed, bulletSize: 0.09, bulletSpeed: 26, jump: 8, blockCooldown: 99 };
    const k = (this.nextUnit % 6) + 1, spot = this.freeSpot(o.pos.x + Math.cos(k * 1.05) * 1.5, o.pos.z + Math.sin(k * 1.05) * 1.5, o.pos.x, o.pos.z, PR * Q.size, o.pos.y);
    const u = this.spawnUnit('soldier', o, spot, { stats, difficulty: 'normal' });
    u.aim = { ...o.aim };
    this.unitsChanged();
    this.emit({ t: 'nc', k: 'squad', p: o.id, x: spot.x, y: spot.y + 0.6, z: spot.z });
    return u;
  }
  bountyMarked(q) {
    if (!q || q.kind !== 'hero' || this.isWaves() || this.isOpen() || this.isPractice()) return false;
    const v = this.scores[this.scoreKey(q)];
    return v > 0 && v >= Math.max(...Object.values(this.scores));
  }
  ncHitMul(b, q) {
    const src = b.ownerRef, s = src && src.stats;
    if (!s || b.swap) return 1;
    let k = 1;
    if (s.pressure > 0 && !b.chained && this.isEnemy(src, q)) {   // Pressure Stack
      const P = NEWC.press, st = src.fx.press || (src.fx.press = { id: null, n: 0, t: -9 });
      const same = st.id === q.id && this.time - st.t <= P.win;
      k *= 1 + s.pressure * (same ? st.n : 0);
      st.n = same ? Math.min(P.max, st.n + 1) : 1; st.id = q.id; st.t = this.time;
    }
    if (s.bounty > 0 && this.isEnemy(src, q) && this.bountyMarked(q)) k *= 1 + s.bounty;   // Bounty Mark
    return k;
  }
  ncOnHit(b, q, hm) {
    const src = b.ownerRef, s = src && src.stats;
    if (!s || b.chained || !this.isEnemy(src, q)) return;
    if (s.ammoLeech > 0 && q.stats) {   // Ammo Leech: every 3 hits (per level) take a round out of their mag
      src.fx.leech = (src.fx.leech || 0) + s.ammoLeech / 3;
      while (src.fx.leech >= 1) {
        src.fx.leech -= 1;
        if (q.ammo > 0) { q.ammo--; if (q.ammo <= 0) this.startReload(q); this.emit({ t: 'nc', k: 'leech', p: q.id, x: q.pos.x, y: this.chest(q) + 0.4, z: q.pos.z }); }
      }
    }
    if (s.rhythm > 0 && !b.rhythmShot && !src.fx.rhyReady) {   // Battle Rhythm
      src.fx.rhy = (src.fx.rhy || 0) + 1;
      if (src.fx.rhy >= Math.max(1, Math.round(NEWC.rhythm.hits / s.rhythm))) { src.fx.rhy = 0; src.fx.rhyReady = true; this.emit({ t: 'nc', k: 'rhythmReady', p: src.id }); }
    }
    if (s.bounty > 0 && hm > 1 && src.alive && this.bountyMarked(q)) {   // Bounty Mark heal
      const h0 = src.hp; src.hp = Math.min(this.maxHp(src), src.hp + b.dmg * hm * NEWC.bountyHeal * s.bounty); this.healPing(src, h0);
    }
  }
  ncBulletEnd(b, impact, hitQ) {
    const src = b.ownerRef, s = src && src.stats;
    if (!s || !b.shot || b.swap) return;
    if (!hitQ && s.pressure > 0 && src.fx.press && this.time - src.fx.press.t > NEWC.press.grace) src.fx.press.n = 0;   // Pressure Stack: a miss resets it
    if (impact && s.gravWell > 0) this.addWell(src, b.pos, s.gravWell);
  }
  addWell(o, pos, lv) {
    const W = NEWC.well, mine = this.wells.filter(w => w.o === o);
    if (mine.length >= W.max) this.wells = this.wells.filter(w => w !== mine[0]);
    this.wells.push({ x: pos.x, y: pos.y, z: pos.z, t: W.t, o, lv });
    this.emit({ t: 'nc', k: 'well', p: o.id, x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100, z: Math.round(pos.z * 100) / 100, r: W.r });
  }
  updateWells(dt) {
    if (!this.wells || !this.wells.length) return;
    const W = NEWC.well;
    for (const w of this.wells) {
      w.t -= dt;
      for (const q of this.players) {
        if (!q.alive || q.reviving || q.heavy || q.flying || !this.isEnemy(w.o, q)) continue;
        const dx = w.x - q.pos.x, dy = w.y - this.chest(q), dz = w.z - q.pos.z, d = Math.hypot(dx, dy, dz);
        if (d > W.r || d < 0.35) continue;
        const a = W.pull * w.lv * (1 - 0.5 * d / W.r) * dt / q.size;
        q.vel.x += dx / d * a; q.vel.z += dz / d * a; if (dy > 0) q.vel.y += dy / d * a * 0.5;
        q.fx.pullT = this.time + 0.15;
      }
    }
    this.wells = this.wells.filter(w => w.t > 0);
  }
  // Snapshot row for the new cards (0 when there's nothing to show): [flags, pressure stacks, rhythm progress 0-1 (-1 none),
  // gamble roll (-1 none), gilded shells, ascension (tier + rounds << 2), purge charge (-1 used)].
  // flags: 1 bounty leader, 2 overdrive round, 4 rooted, 8 cold shot ready, 16 opening salvo, 32 overcharged shot ready, 64 last round chambered
  ncRow(p) {
    const s = p.stats, f = p.fx, r2 = v => Math.round(v * 100) / 100;
    const flags = (this.bountyMarked(p) && this.players.some(q => q.stats.bounty > 0 && q.kind === 'hero') ? 1 : 0) | (s.overdrive > 0 && p.ncOd === 1 ? 2 : 0) |
      ((f.rootT || 0) > this.time ? 4 : 0) | (s.coldBarrel > 0 && this.time - (f.lastFire ?? -99) >= NEWC.cold.wait ? 8 : 0) | (this.salvoOn(p) ? 16 : 0) |
      (f.rhyReady ? 32 : 0) | (s.lastRound > 0 && p.ammo === 1 && p.reloadT <= 0 ? 64 : 0);
    const press = s.pressure > 0 && f.press && this.time - f.press.t <= NEWC.press.win ? f.press.n : 0;
    const rhy = s.rhythm > 0 ? r2(Math.min(1, (f.rhy || 0) / Math.max(1, Math.round(NEWC.rhythm.hits / s.rhythm)))) : -1;
    const gam = s.gamble > 0 && f.gam != null ? f.gam : -1, shell = f.shell || 0, asc = s.ascend > 0 ? p.ncAsc || 0 : 0;
    const pg = p.smod === 'purge' ? (f.purgeUsed ? -1 : r2(f.purge || 0)) : 0;
    if (!flags && !press && rhy < 0 && gam < 0 && !shell && !asc && !pg) return 0;
    return [flags, press, rhy, gam, shell, asc, pg];
  }

  // ------------------------------------------------------------ network
  // Extra look flags for the renderer: 1 tiny tank, 4 life drain (Drain Life card), 8 bullet catcher, 16 regenerating health
  // (has regen and isn't full), 32 crouching, 64 Brawl air jump ready. (2 was the old personal Pillar Shield; the pillar's shield is now its own box.)
  playerFlags(p) {
    return (p.stats.tank > 0 ? 1 : 0) | (p.stats.lifeDrain > 0 ? 4 : 0) | (p.smod === 'catcher' ? 8 : 0) |
      (p.stats.regen > 0 && p.alive && !p.reviving && !(BRAWL_ON && p.kind === 'hero') && p.hp < this.maxHp(p) - 0.01 ? 16 : 0) | (p.crouch ? 32 : 0) |
      (BRAWL_ON && p.kind === 'hero' && p.alive && !p.onGround && (p.fx.airJ || 0) > 0 ? 64 : 0) |   // v1.1.6: 64 = Brawl second jump ready (drawn for its own player only)
      (p.fx.thrust && p.fx.thrust.t > 0 ? 128 : 0);   // v1.2.13: 128 = being pushed by Thrust (a streak trails behind them)
  }
  // A one-off heal (lifesteal, leech, healing field, Field Medic, Bloodforge...): bumps a counter the health bar flashes on.
  // Steady healing (regen, life drain) doesn't count; regen shows as a pulsing outline instead.
  healPing(q, before) { if (q.hp - before >= 0.5) q.healN = ((q.healN || 0) + 1) & 255; }
  snapshot() {
    const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
    const h = this.hazard;
    return {
      ph: this.phase, pt: fin(this.phaseT) ? r2(this.phaseT) : -1, rd: this.round, sc: this.scores, bud: budgetRow(this), tn: tournRows(this),
      pw: this.phase === 'picking' ? this.players.filter(p => !p.picked).length : 0,
      pl: this.players.filter(p => p.connected).map(p => [
        p.id, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.aim.x), r2(p.aim.y), r2(p.aim.z),   // (v1.0.1: aim to 2 places, less traffic)
        Math.ceil(p.hp), Math.round(this.maxHp(p)), p.alive && !p.reviving ? 1 : 0, this.shielded(p) ? 1 : 0,
        p.ammo, Math.round(p.stats.ammo), p.reloadT > 0 ? r2(p.reloadT / p.stats.reloadTime) : 0,
        p.blockCdT > 0 ? r2(p.blockCdT / p.stats.blockCooldown) : 0, p.flashT > 0 ? 1 : 0,
        r1(p.vel.x), r1(p.vel.y), r1(p.vel.z), p.stats.skyfall > 0 ? 1 : 0, r2(p.stats.blockSize),
        p.mod || 0, p.fx.charging ? p.fx.chargeShots : 0, p.mod === 'shield' && (p.fx.shieldBrokenT || 0) > this.time ? 1 : 0,
        (this.burning(p) ? 1 : 0) | (p.fx.poisonS || (p.fx.toxT || 0) > this.time ? 2 : 0) | ((p.fx.chillT || 0) > this.time ? 4 : 0) | ((p.fx.hexT || 0) > this.time ? 8 : 0) | ((p.fx.wetT || 0) > this.time ? 16 : 0) | ((p.fx.sqOnT || 0) > this.time ? 32 : 0),
        r2(p.size),
        (p.stats.blockShock > 0 ? 1 : 0) | (p.stats.blockLeech > 0 ? 2 : 0) | (p.stats.blockDeploy > 0 ? 4 : 0),
        r2(p.stats.bulletSpeed), r2(this.bulletGrav(p)), this.playerFlags(p), r2(this.riotFrac(p)), r2(this.pillarFrac(p)),
        p.healN || 0, p.mod === 'critter' ? this.critterCount(p) : -1, r2(this.slowFieldRadius(p.stats.slowField || 0)),
        this.extRow(p),
      ]),
      bfx: this.bullets.filter(b => b.fx).map(b => b.latch ? [b.id, b.fx, b.latch.q.id, 1] : b.swarm === 'bee' && b.swTgt ? [b.id, b.fx, b.swTgt.id] : [b.id, b.fx]),   // v1.2.20: [2] who a bee is after (it turns red for them)
      bu: this.bullets.map(b => [b.id, r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), b.hold ? 0 : r2(b.vel.x * (b.slowK ?? 1)), b.hold ? 0 : r2(b.vel.y * (b.slowK ?? 1)), b.hold ? 0 : r2(b.vel.z * (b.slowK ?? 1)),
        r3(b.hold ? b.r * (1 - b.hold.t / b.hold.dur) : b.r), b.owner, b.ring ? r2(b.ring) : 0, b.cown && b.cown !== b.owner ? b.cown : 0,
        b.hold ? 0 : r2((b.grav ?? RULES.bulletGravity) * (b.slowK ?? 1) ** 2)]),   // v1.2.9: [11] its gravity, so joiners' decoders predict the drop (netcodec.js GRAV)
      bc: this.barricades.map(b => [b.id, r2(b.x), r2(b.y0), r2(b.z), r2(b.len), r2(b.h), r2(b.th), r2(Math.max(0, b.hp) / b.maxHp), b.owner, r3(b.ang), b.kind === 'concrete' ? 1 : b.kind === 'pillar' ? 2 : b.kind === 'block' ? 3 : b.kind === 'cube' ? 4 : b.kind === 'plank' ? 5 : b.kind === 'slab' ? 6 : b.kind === 'steel' ? 7 : b.kind === 'spikes' ? 8 : 0]),
      ob: this.dyn.map(o => [o.id, r2(o.pos.x), r2(o.pos.y), r2(o.pos.z), r2(o.h), o.tipped || 0, r2(o.tx || 0), r2(o.tz || 0)]),
      sh: this.shields.map(s => [s.id, r2(s.x), r2(s.y0), r2(s.z), r2(s.w), r2(s.h), r2(s.d), s.owner, (s.shock ? 1 : 0) | (s.leech ? 2 : 0) | (s.box ? 4 : 0), s.box ? r2(Math.max(0, s.hp) / s.maxHp) : 1, r2(s.ang || 0)]),
      mn: this.mines.map(m => m.snare ? [m.id, r2(m.x), r2(m.y), r2(m.z), m.owner, m.armT <= 0 ? 1 : 0, 1, 1] : [m.id, r2(m.x), r2(m.y), r2(m.z), m.owner, m.armT <= 0 ? 1 : 0, r2(m.sz || 1)]),   // (v1.2.15: [7] 1 = Snare Plate)
      tp: this.level.traps ? Math.round(this.time * 100) / 100 : null,   // v1.2.15 trap clock (traps.js)
      lz: h && h.type === 'laser' ? [r2(h.pos), h.state === 'warn' ? 1 : h.state === 'on' ? 2 : 0] : null,
      tg: this.telegraphs.length ? telegraphRows(this) : null, sw: this.shockwaves.length ? shockRows(this) : null, bo: bossRow(this),
      rt: this.rituals.length ? this.ritualRows() : null, rl: this.relics.length ? this.relicRows() : null,
      ow: this.ow ? this.owSnap() : null,
      co: this.settings.core ? coreRows(this) : null,
      mv: this.predRows(),
      bw: BRAWL_ON ? this.brawlRows() : null, bi: BRAWL_ON ? bItemRows(this) : null, bwt: BRAWL_ON ? Math.max(0, Math.ceil(BRAWL.suddenT - this.time)) : null,
    };
  }
  // Open world rows; the taken-loot list rides along once a second (and right after something is picked up).
  owSnap() {
    const v = owView(this);
    if (this.time - (this._owLt || -9) > 1 || this.ow.takenList.length !== this._owLn) { v.lt = this.ow.takenList.slice(); this._owLt = this.time; this._owLn = this.ow.takenList.length; }
    return v;
  }
  // Newer per-player look data: [katana charge (-1 none), slash counter, hair fraction (-1 none), hair health, hair max, charging (hold),
  //   turret-style shield health 0-1 (-1 none), holy bits (1 holy shield, 2 priest robe)]
  extRow(p) {
    const r2 = v => Math.round(v * 100) / 100;
    const hs = p.fx.holyShield, ts = p.fx.tshield;
    const holy = (hs && hs.hp > 0 && hs.until > this.time ? 1 : 0) | (p.fx.robe ? 2 : 0);
    return [r2(this.katanaFrac(p)), p.fx.slashN || 0, r2(this.hairFrac(p)), Math.ceil(p.fx.hair || 0), Math.round(p.hairMax || 0), p.fx.hold ? (p.smod === 'grove' ? 2 : p.smod === 'spaceking' ? 3 : 1) : 0,
      ts ? r2(Math.max(0, ts.hp) / ts.max) : -1, holy, p.fx.mount ? p.fx.mount.id : 0, this.ncRow(p)];   // v1.2.8: [8] the Gun Nest turret you're manning; v1.2.15: [9] new card state (ncRow)
  }

  levelForNet() {
    const { seed, name, hx, hz, theme, boxes, dynamic, lava, ice, hazard, poly, shape, open, zones, pads, loot, side, brawl, gravK, rmod, traps } = this.level;
    return { seed, name, hx, hz, theme, boxes, dynamic, lava, ice, hazard, poly, shape, open, zones, pads, loot, side, brawl, gravK, rmod, traps };   // (v1.2.15: gravK too, so joiners predict 2D and Low Gravity jumps)
  }
}
