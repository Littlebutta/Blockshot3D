// =====================================================================
// RTS mode (v1.2.27): the first faction, its units and buildings, the economy numbers and how a card from the
// shooter's pool turns into a unit upgrade (research). Pure data + small helpers (no three.js, no DOM).
// =====================================================================
import { cardTactics } from './amondata.js';

export const RTS = {
  tick: 0.05,                 // host simulation step (20 a second)
  send: 1 / 15,               // snapshots to each player
  startCrystal: 50, startFlux: 0, startWorkers: 12,
  supplyMax: 200,             // fewer with many players (supplyCap)
  mineTime: 2.6, crystalTrip: 5, fluxTime: 1.4, fluxTrip: 4, maxPerVent: 3,
  derrickRate: 1.5,           // crystal a second from a held derrick (infinite)
  derrickCapture: 3,          // seconds an infantry unit stands next to a derrick to take it
  towerSight: 22, towerReach: 3.5,
  flare: { cost: 50, cd: 40, r: 14, dur: 12 },
  pull: { c: 100, f: 75, step: 25, max: 6, time: 20, offer: 3, hand: 6 },   // card research at the Archive
  queueMax: 5,
  dropRange: 1.2,             // meters from a building's edge to drop off cargo / build
};
export const supplyCap = n => n <= 4 ? RTS.supplyMax : n <= 6 ? 160 : 130;

// Attribute tags: light / armored (damage bonuses), bio / mech (who medics heal and riggers repair), air.
// Weapons: dmg, bonus { tag: extra }, cd (s), range (m), ga = 'g' ground only, 'a' air only, 'ga' both,
// splash (m, full damage inside half of it), min (minimum range), n (shots per attack), fx (look: bullet / rocket / flame / shell / laser)
const W = (dmg, cd, range, ga, extra = {}) => ({ dmg, cd, range, ga, n: 1, ...extra });
export const UNITS = {
  rigger: { name: 'Rigger', icon: '🔧', role: 'Worker', desc: 'Mines crystal and flux, builds and repairs. Right-click crystal to mine, a vent\'s refinery for flux, a damaged machine to repair.',
    cost: [50, 0], supply: 1, time: 12, hp: 45, armor: 0, speed: 4.2, r: 0.45, sight: 9, tags: ['bio', 'light'], worker: true, from: 'hub',
    weapons: [W(5, 1.1, 0.6, 'g', { fx: 'melee' })] },
  trooper: { name: 'Trooper', icon: '🪖', role: 'Infantry', desc: 'Cheap rifle infantry that hits ground and air. Overdrive: lose 10 health for faster shooting and running.',
    cost: [50, 0], supply: 1, time: 18, hp: 50, armor: 0, speed: 4.0, r: 0.42, sight: 10, tags: ['bio', 'light'], from: 'barracks',
    weapons: [W(6, 0.61, 6.5, 'ga', { fx: 'bullet' })], ab: ['overdrive'] },
  lancer: { name: 'Lancer', icon: '🚀', role: 'Anti-armor', desc: 'Rocket infantry. Big damage against armored targets; its hits slow ground units. Ground only.',
    cost: [100, 25], supply: 2, time: 21, hp: 125, armor: 1, speed: 3.6, r: 0.55, sight: 10, tags: ['bio', 'armored'], from: 'barracks',
    weapons: [W(10, 1.07, 7, 'g', { bonus: { armored: 10 }, slow: 0.5, slowT: 1.1, fx: 'rocket' })], ab: ['overdrive'] },
  medic: { name: 'Medic', icon: '⛑', role: 'Support', desc: 'Heals nearby infantry (bio units) on its own. No weapon.',
    cost: [50, 25], supply: 1, time: 18, hp: 60, armor: 1, speed: 4.0, r: 0.42, sight: 10, tags: ['bio', 'light'], from: 'barracks',
    weapons: [], heal: { hps: 12, range: 5 } },
  vaulter: { name: 'Vaulter', icon: '🦘', role: 'Raider', desc: 'Fast raider that jumps up and down cliffs. Regenerates out of combat. Ground only.',
    cost: [50, 50], supply: 1, time: 22, hp: 60, armor: 0, speed: 5.3, r: 0.42, sight: 10, tags: ['bio', 'light'], from: 'barracks', cliff: true, regen: 2.5,
    weapons: [W(4, 1.1, 5, 'g', { n: 2, bonus: { light: 3 }, fx: 'bullet' })] },
  strider: { name: 'Strider', icon: '🏍', role: 'Light vehicle', desc: 'Very fast flamethrower buggy. Burns a line of light units. Ground only.',
    cost: [100, 0], supply: 2, time: 21, hp: 90, armor: 0, speed: 6.4, r: 0.7, sight: 10, tags: ['mech', 'light'], from: 'factory',
    weapons: [W(8, 1.8, 5, 'g', { bonus: { light: 6 }, line: 1.2, fx: 'flame' })] },
  crawler: { name: 'Siege Crawler', icon: '🛡', role: 'Siege tank', desc: 'Tank. Siege mode (E) roots it in place for a long-range cannon with splash; it can\'t hit anything right next to it.',
    cost: [150, 125], supply: 3, time: 32, hp: 175, armor: 1, speed: 3.6, r: 0.95, sight: 11, tags: ['mech', 'armored'], from: 'factory', needs: ['archive'], turret: true,
    weapons: [W(15, 1.04, 7.5, 'g', { bonus: { armored: 10 }, fx: 'shell' })],
    siege: { dmg: 40, bonus: { armored: 30 }, cd: 2.14, range: 14, min: 2.5, splash: 2.6, t: 2.7, fx: 'shell' }, ab: ['siege'] },
  hornet: { name: 'Hornet', icon: '✈', role: 'Air fighter', desc: 'Fighter jet. Missiles shred air units; weak guns against the ground.',
    cost: [150, 75], supply: 2, time: 30, hp: 125, armor: 0, speed: 4.8, r: 0.8, sight: 11, tags: ['mech', 'armored'], air: true, from: 'airfield',
    weapons: [W(10, 1.4, 9, 'a', { n: 2, bonus: { armored: 4 }, fx: 'rocket' }), W(6, 1.0, 5, 'g', { fx: 'bullet' })] },
  spotter: { name: 'Spotter', icon: '🛰', role: 'Air scout', desc: 'Cheap flying scout drone with long sight: it sees up onto high ground. No weapon.',
    cost: [75, 25], supply: 1, time: 18, hp: 40, armor: 0, speed: 5.6, r: 0.5, sight: 14, tags: ['mech', 'light'], air: true, from: 'airfield', weapons: [] },
  gunship: { name: 'Gunship', icon: '🚁', role: 'Air gunship', desc: 'Heavy flying gunship that rakes ground units. Can\'t hit air.',
    cost: [150, 100], supply: 3, time: 36, hp: 180, armor: 1, speed: 3.8, r: 1.0, sight: 10, tags: ['mech', 'armored'], air: true, from: 'airfield', needs: ['archive'],
    weapons: [W(9, 0.6, 6, 'g', { fx: 'bullet' })] },
};
export const UNIT_IDS = Object.keys(UNITS);

// Buildings: s = footprint in cells (2 m each). gives = supply. trains = units. Production and research use a queue.
export const BUILDINGS = {
  hub: { name: 'Command Hub', icon: '🏛', desc: 'Main building. Trains Riggers; workers bring crystal and flux here. Recon Flare (F) lights up any spot of the map for a while.',
    cost: [400, 0], time: 71, hp: 1500, armor: 1, s: 4, gives: 15, sight: 12, trains: ['rigger'], drop: true, ab: ['flare'] },
  depot: { name: 'Supply Depot', icon: '📦', desc: 'Raises your supply cap by 8.', cost: [100, 0], time: 21, hp: 400, armor: 1, s: 2, gives: 8, sight: 8, needs: ['hub'] },
  refinery: { name: 'Refinery', icon: '⛽', desc: 'Built on a flux vent. Up to 3 Riggers carry its flux back.', cost: [75, 0], time: 21, hp: 500, armor: 1, s: 2, sight: 8, needs: ['hub'], vent: true },
  reclaimer: { name: 'Reclaimer', icon: '♻', desc: 'Slowly makes crystal out of nothing, forever (+0.8 a second). Pays for itself in about 5 minutes.',
    cost: [250, 0], time: 40, hp: 500, armor: 1, s: 2, sight: 8, needs: ['hub'], income: 0.8 },
  barracks: { name: 'Barracks', icon: '🏢', desc: 'Trains infantry.', cost: [150, 0], time: 46, hp: 1000, armor: 1, s: 3, sight: 9, needs: ['depot'], trains: ['trooper', 'lancer', 'medic', 'vaulter'] },
  sentry: { name: 'Sentry Tower', icon: '🗼', desc: 'Defense tower. Shoots ground and air.', cost: [100, 0], time: 25, hp: 350, armor: 1, s: 1, sight: 11, needs: ['barracks'],
    weapons: [W(12, 0.85, 8, 'ga', { fx: 'laser' })] },
  archive: { name: 'Archive', icon: '📚', desc: 'Research: pull a card and fit it to a unit type. Every card works on every unit.', cost: [125, 100], time: 36, hp: 750, armor: 1, s: 3, sight: 9, needs: ['barracks'], research: true },
  factory: { name: 'Factory', icon: '🏭', desc: 'Builds vehicles.', cost: [150, 100], time: 43, hp: 1250, armor: 1, s: 3, sight: 9, needs: ['barracks'], trains: ['strider', 'crawler'] },
  airfield: { name: 'Airfield', icon: '🛫', desc: 'Builds aircraft.', cost: [150, 100], time: 36, hp: 1300, armor: 1, s: 3, sight: 9, needs: ['factory'], trains: ['spotter', 'hornet', 'gunship'] },
};
export const BUILDING_IDS = Object.keys(BUILDINGS);
export const BUILD_MENU = ['hub', 'depot', 'refinery', 'reclaimer', 'barracks', 'sentry', 'archive', 'factory', 'airfield'];
export const FACTION = { id: 'steelborne', name: 'The Steelborne', desc: 'Frontier engineers in blocky iron. Workers build on site, buildings research with cards.' };

export const ABILITIES = {
  overdrive: { name: 'Overdrive', key: 'KeyT', icon: '💉', desc: 'Costs 10 health (20 for Lancers): 50% faster attacks and +50% speed for 9 s.', hp: 10, dur: 9 },
  siege: { name: 'Siege mode', key: 'KeyE', icon: '⚙', desc: 'Roots the Crawler for long-range splash shells (E again to pack up).' },
  flare: { name: 'Recon Flare', key: 'KeyF', icon: '🎇', desc: `Lights up any spot for ${RTS.flare.dur} s (${RTS.flare.cost} crystal, every ${RTS.flare.cd} s). Sees up cliffs.` },
};

// The 3x5 command card: [row][col] key letters (StarCraft grid layout)
export const GRID_KEYS = [['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'], ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'], ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB']];
// Hotkeys for training / building (each building's trains list in order; the build menu)
export const TRAIN_KEYS = { rigger: 'KeyQ', trooper: 'KeyQ', lancer: 'KeyW', medic: 'KeyE', vaulter: 'KeyR', strider: 'KeyQ', crawler: 'KeyW', spotter: 'KeyQ', hornet: 'KeyW', gunship: 'KeyE' };
export const BUILD_KEYS = { hub: 'KeyQ', depot: 'KeyW', refinery: 'KeyE', reclaimer: 'KeyR', barracks: 'KeyA', sentry: 'KeyS', archive: 'KeyD', factory: 'KeyZ', airfield: 'KeyX' };

// ---------------------------------------------------------------- research: cards -> unit upgrades
// The shooter's cards already have an AMON translation (amondata cardTactics: hp / atk / rate / ... shares). Research
// reuses it: a pulled card's effects go onto ONE unit type of your choice (every unit of it, now and later). Weapon
// and shield mods count too. Keys with no RTS meaning are dropped, and a card with nothing left isn't offered.
const RTS_FX = {
  hp: v => ({ hp: v }), atk: v => ({ dmg: v }), rate: v => ({ rate: v }), speed: v => ({ speed: Math.min(0.5, v) }),
  range: v => ({ range: Math.min(3, v * 0.6) }), splash: v => ({ splash: Math.min(2.5, v * 0.5) }), armor: v => ({ armor: Math.min(4, v) }),
  regen: v => ({ regen: Math.min(6, v * 0.4) }), lifesteal: v => ({ leech: Math.min(0.4, v) }), chain: v => ({ chain: Math.min(3, Math.round(v)) }),
  slow: v => ({ slow: Math.min(0.5, v) }), burn: v => ({ burn: Math.min(8, v * 0.5) }), poison: v => ({ poison: Math.min(8, v * 5) }),
  hex: v => ({ hex: Math.min(0.35, v) }), encore: v => ({ encore: Math.min(0.5, v) }), block: v => ({ block: Math.min(0.35, v) }),
  shield: v => ({ barrier: Math.min(60, v * 12) }), thorns: v => ({ thorns: Math.min(0.5, v) }), drain: v => ({ drain: Math.min(6, v * 0.5) }),
  pen: v => ({ pen: Math.min(4, v) }), resist: v => ({ resist: Math.min(0.4, v) }), echo: () => ({ echo: 1 }),
  count: v => ({ twin: Math.min(0.5, v * 0.25) }), mines: v => ({ blastOnDeath: Math.min(60, v * 20) }), turret: v => ({ extra: Math.min(2, v) }),
  drone: v => ({ extra: Math.min(2, v) }), bomb: v => ({ bomb: Math.min(1, v) }), meteor: v => ({ meteor: Math.min(3, v) }), knock: v => ({ knock: Math.min(2, v) }),
};
export const UP_INFO = {
  hp: ['Health', 'pct'], dmg: ['Damage', 'pct'], rate: ['Attack speed', 'pct'], speed: ['Move speed', 'pct'], range: ['Range', 'm'], splash: ['Splash radius', 'm'],
  armor: ['Armor', 'flat'], regen: ['Health regen', 'ps'], leech: ['Lifesteal', 'pct'], chain: ['Hits bounce to more targets', 'flat'], slow: ['Slow on hit', 'pct'],
  burn: ['Burn damage', 'ps'], poison: ['Poison damage', 'ps'], hex: ['Targets hit take more damage', 'pct'], encore: ['Chance to attack again', 'pct'],
  block: ['Chance to block a hit', 'pct'], barrier: ['Recharging barrier', 'flat'], thorns: ['Reflects damage taken', 'pct'], drain: ['Drains nearby enemies', 'ps'],
  pen: ['Armor piercing', 'flat'], resist: ['Damage taken', 'neg'], echo: ['Comes back once at half health', 'flag'], twin: ['Chance to train a free extra one', 'pct'],
  blastOnDeath: ['Explodes when it dies', 'flat'], extra: ['Extra escort shots', 'flat'], bomb: ['Hits stick a bomb', 'pct'], meteor: ['Every 5th attack calls a meteor', 'flat'],
  knock: ['Hits knock back', 'm'],
};
const r2 = v => Math.round(v * 100) / 100;
// card list (the shooter's CARDS) -> [{ id, from, name, rarity, icon, imageUrl, up: { key: value } }]
export function researchCards(cards) {
  const loose = (cards || []).map(c => c && (c.weaponMod || c.shieldMod) ? { ...c, weaponMod: undefined, shieldMod: undefined } : c);
  const rar = new Map((cards || []).map(c => [c.id, c.rarity || 'common']));
  const out = [];
  for (const t of cardTactics(loose)) {
    const up = {};
    for (const [k, v] of Object.entries(t.fx || {})) {
      if (!v || !RTS_FX[k]) continue;
      for (const [uk, uv] of Object.entries(RTS_FX[k](v))) { if (uv) up[uk] = r2((up[uk] || 0) + uv); }
    }
    for (const k of Object.keys(up)) if (!up[k]) delete up[k];
    if (!Object.values(up).some(v => v > 0)) continue;
    out.push({ id: t.from, name: t.name, rarity: rar.get(t.from) || 'common', icon: t.icon, imageUrl: t.imageUrl, desc: t.shooterDesc, up });
  }
  return out;
}
export const PULL_ODDS = { common: 58, uncommon: 26, rare: 12, legendary: 4, combo: 3 };
export function upLines(up) {
  return Object.entries(up || {}).filter(([, v]) => v).map(([k, v]) => {
    const [label, kind] = UP_INFO[k] || [k, 'flat'], a = Math.abs(v), sign = v < 0 ? '−' : '+';
    if (kind === 'neg') return { text: `${v > 0 ? '−' : '+'}${Math.round(a * 100)}% ${label}`, good: v > 0 };
    const num = kind === 'pct' ? Math.round(a * 100) + '%' : kind === 'ps' ? r2(a) + '/s' : kind === 'm' ? r2(a) + ' m' : kind === 'flag' ? '' : String(r2(a));
    return { text: kind === 'flag' ? label : `${sign}${num} ${label}`, good: v > 0 };
  });
}
// all the upgrades one unit type has: the sum of its cards (resist and the chances are capped so nothing is immune)
const CAPS = { resist: 0.6, block: 0.5, encore: 0.7, slow: 0.7, leech: 0.6, twin: 0.6, speed: 0.8, hex: 0.6, thorns: 0.8 };
export function sumUps(list) {
  const s = {};
  for (const up of list) for (const [k, v] of Object.entries(up || {})) s[k] = (s[k] || 0) + v;
  for (const [k, c] of Object.entries(CAPS)) if (s[k] > c) s[k] = c;
  if (s.hp && s.hp < -0.6) s.hp = -0.6; if (s.dmg && s.dmg < -0.6) s.dmg = -0.6; if (s.rate && s.rate < -0.6) s.rate = -0.6;
  return s;
}
export const pullCost = n => { const k = Math.min(n, RTS.pull.max); return [RTS.pull.c + RTS.pull.step * k, RTS.pull.f + RTS.pull.step * k]; };
