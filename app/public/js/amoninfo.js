// AMON card and unit write-ups: the right-click details window, the hover tip's short lines and The Wiki all read from here.
// Everything is plain text (callers escape it).
import { FX_INFO, PATTERNS, UNIT_BY_ID, TIER_NAMES, cardKind, corrupted } from './amondata.js';
const unitOf = id => UNIT_BY_ID.get(id) || (id && id.startsWith('x-') && UNIT_BY_ID.get(id.slice(2)) ? corrupted(UNIT_BY_ID.get(id.slice(2))) : UNIT_BY_ID.get('grunt'));

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const TAG_INFO = {
  light: 'Light: small, quick and cheap. Splash damage and slows hurt them most.',
  bio: 'Bio: living troops. Medics and Monks heal them; Combat Engineers can\'t.',
  mech: 'Mech: machines. Only Combat Engineers repair them; Medics and Monks can\'t.',
  armored: 'Armored: heavy plating. Armor-piercing and big single hits get through it best.',
  large: 'Large: big bodies. Knockback doesn\'t move them and poison eats them more slowly.',
  boss: 'Boss: a wave leader. Slows and poison are weaker on it.',
};
export function unitTags(u) { return (u.tags || []).filter(t => t !== 'boss' || u.boss).map(cap); }

// What each kind of effect does in AMON, with a tip for using it.
export const FX_HELP = {
  hp: ['More health for every unit it reaches.', 'Put it next to your front line: tanky melee cards get the most from it.'],
  atk: ['Every unit it reaches hits harder.', 'Best on cards with many units or fast attacks.'],
  rate: ['Units attack more often.', 'Stacks well with on-hit effects (ignite, poison, slow, lifesteal): more hits, more procs.'],
  speed: ['Units move faster.', 'Helps melee reach the back line before artillery wears them down.'],
  range: ['Ranged units shoot from further away (melee only gets a quarter of it).', 'Keeps archers and artillery out of reach of the enemy front line.'],
  splash: ['Hits also damage enemies around the target.', 'Great against swarm factions with many small units.'],
  armor: ['Every hit taken is reduced by this much.', 'Very strong against many weak hits; weak against a few huge ones.'],
  regen: ['The units it reaches heal themselves every second.', 'This heals the cards it reaches, not other units. Best on units that survive long fights.'],
  lifesteal: ['Units heal for part of the damage they deal.', 'Strong on hard-hitting melee units.'],
  count: ['The card brings extra units.', 'Extra bodies scale with every other bonus on the card.'],
  chain: ['Attacks bounce to more enemies nearby.', 'Each bounce does a bit less damage; deadly against packs.'],
  slow: ['Hits slow the target down for a moment.', 'Keeps chargers and fast melee away from your back line.'],
  burn: ['Ignite: every hit adds its own 3 s burn stack (up to 6), so fast attackers pile up fire damage.', 'Pair it with attack speed. Armor doesn\'t block burn damage.'],
  poison: ['Poison: eats a share of the target\'s health over 5 s, ramping up the longer it stays on. New hits refresh it without resetting the ramp.', 'Keep hitting the same target to make it hurt. Bosses and large units only take a third of it.'],
  hex: ['Enemies you hit take more damage from everything for a short time.', 'Put it on fast attackers so the hex stays up for your heavy hitters.'],
  gold: ['Extra gold every round.', 'Pays for itself after a few rounds: buy it early.'],
  interest: ['Gold for saving: you get extra gold for gold you keep.', 'Only worth it when you can bank gold.'],
  amp: ['Boosts the effects of other cards it reaches.', 'Put it in the middle of several tactic cards.'],
  growth: ['The cards it reaches permanently get stronger every round they stay in reach.', 'Buy it early and don\'t move the cards around it.'],
  promote: ['The card it reaches ranks up after every battle you win.', 'Point it at an expensive unit card.'],
  echo: ['The units it reaches come back once at half health after they die.', 'Best on units that are good at the start of a fight.'],
  recruit: ['A permanent extra unit joins the card every round.', 'Stays even when you move the card.'],
  recruitPct: ['Every round the card it reaches permanently gains a share of its current size in new units (at least 1, up to 6x the card).', 'Best on big swarms of cheap units like Critters: they snowball.'],
  encore: ['Chance to attack again right away.', 'Works best on slow, heavy hitters.'],
  block: ['Chance to block a hit completely. Units with block can also block when you take control of them.', 'Strong against artillery and big single hits.'],
  shield: ['Every unit starts the battle with a barrier that soaks damage first.', 'Best on many cheap units.'],
  thorns: ['Reflects part of the damage taken back at the attacker.', 'Put it on your tankiest front line.'],
  drain: ['Hurts every enemy close by and heals from it.', 'Melee units in the thick of the fight get the most out of it.'],
  pen: ['Attacks ignore this much armor.', 'Bring it against armored and mech factions.'],
  mines: ['Lays mines in front of the army when the battle starts.', 'Good against melee rushes.'],
  knock: ['Hits push enemies back (not large units or bosses).', 'Buys time for ranged units.'],
  resist: ['Less damage taken from everything.', 'One of the strongest defensive effects.'],
  turret: ['Deploys sentry turrets at the start of the battle.', 'Turrets don\'t move: they guard your side.'],
  drone: ['Launches wasp drones that hunt enemies.', 'Drones can hit fliers.'],
  bomb: ['Hits stick a bomb that goes off a moment later.', 'Great on fast attackers.'],
  meteor: ['Every 5th attack calls a meteor onto the target.', 'Best on fast attackers so meteors come often.'],
  cleanse: ['Removes the downsides of the cards it reaches.', 'Pair it with cursed cards.'],
};
const REACH = {
  self: 'this card itself', adj: 'the 4 cards next to it (up, down, left, right)', diag: 'the 4 cards on its corners', ring: 'all 8 cards around it',
  front: 'the card in front of it', back: 'the card behind it', row: 'every card in its row', col: 'every card in its column',
  knight: 'the cards a chess knight\'s move away', bishop: 'every card on its two diagonal lines', rook: 'every card in its row and column', queen: 'every card in its row, column and diagonals',
};
export const reachText = p => REACH[p] || (PATTERNS[p] ? PATTERNS[p].name.toLowerCase() : 'nearby cards');

// A short AMON description for a tactic built from a shooter card (replaces the shooter's text, which talks about guns and bullets)
export function tacticDesc(fx, pattern) {
  const parts = [], down = [];
  for (const [k, v] of Object.entries(fx || {})) {
    if (!v) continue;
    const [label, kind] = FX_INFO[k] || [k, 'flat'];
    const a = Math.abs(v);
    const num = kind === 'pct' || kind === 'neg' ? Math.round(a * 100) + '% ' : kind === 'ps' ? (Math.round(a * 10) / 10) + '/s ' : kind === 'm' ? (Math.round(a * 10) / 10) + ' m ' : kind === 'flag' ? '' : (Math.round(a * 10) / 10) + ' ';
    const short = label.split(/[:(]/)[0].trim().toLowerCase();
    const txt = kind === 'flag' ? short : `${v < 0 !== (kind === 'neg') ? '−' : '+'}${num}${short}`;
    ((v < 0) !== (kind === 'neg') ? down : parts).push(txt);
  }
  if (fx && (fx.gold || fx.interest) && Object.keys(fx).every(k => k === 'gold' || k === 'interest')) return `Economy: ${parts.join(', ')}.`;
  return `Gives ${reachText(pattern)}: ${parts.join(', ') || 'nothing'}${down.length ? `. Downside: ${down.join(', ')}` : ''}.`;
}

// Plain-language lines for a unit's abilities
export function abilityLines(u) {
  const ab = u.ab || {}, L = [];
  const r1 = v => Math.round(v * 10) / 10;
  if (ab.heal) L.push(`Heals ${ab.heal.mech ? 'Mech allies only (tanks, walkers, turrets...); it can\'t heal Bio units' : 'Bio allies (not Mech units)'} within ${ab.heal.range} m, ${r1(ab.heal.hps)} health/s, always the most hurt first.`);
  if (ab.siege) L.push(`Siege mode: locks down when an enemy is ${ab.siege.minRange}-${ab.siege.range} m away, then fires heavy shells (${ab.siege.atk} damage, ${ab.siege.splash} m splash). Can't hit anything closer than ${ab.siege.minRange} m while sieged.`);
  if (u.minRange) L.push(`Artillery: can't hit enemies closer than ${u.minRange} m, and backs away from them. Shells take time to land; the crew aims at crowds and leads moving targets.`);
  if (ab.burn) L.push(`Sets enemies on fire: ${ab.burn.dps}/s for ${ab.burn.dur} s.`);
  if (ab.slow) L.push(`Hits slow the target by ${Math.round(ab.slow.amt * 100)}% for ${ab.slow.dur} s.`);
  if (ab.charge) L.push(`Charge: the first hit after closing in does ×${ab.charge.mul} damage.`);
  if (ab.blink) L.push(`Blinks ${ab.blink.dist} m away when its health drops below ${Math.round(ab.blink.at * 100)}%.`);
  if (ab.stealth) L.push(`Starts the battle invisible for ${ab.stealth.dur} s (can't be targeted).`);
  if (ab.regen) L.push(`Regenerates ${ab.regen.hps} health/s.`);
  if (ab.cannibal) L.push(`Eats corpses to heal ${ab.cannibal.heal}.`);
  if (ab.convert) L.push(`Every ${ab.convert.every} s, turns a weak enemy (value up to ${ab.convert.maxValue}) within ${ab.convert.range} m to your side.`);
  if (ab.pierce) L.push(`Shots pierce through every enemy in a ${ab.pierce.len} m line.`);
  if (ab.cap) L.push(`Barrier: no single hit can do more than ${ab.cap.max} damage to it (can block when you take control).`);
  if (ab.storm) L.push(`Every ${ab.storm.every} s, calls a storm (${ab.storm.r} m wide, ${ab.storm.dps}/s for ${ab.storm.dur} s).`);
  if (ab.chain) L.push(`Attacks jump to ${ab.chain.n} more enemies within ${ab.chain.r} m.`);
  if (ab.quake) L.push(`Every ${ab.quake.every} s, slams the ground: ${ab.quake.dmg} damage in ${ab.quake.r} m and a ${ab.quake.stun} s stun.`);
  if (ab.hangar) L.push(`Launches up to ${ab.hangar.max} ${(UNIT_BY_ID.get(ab.hangar.unit) || { name: ab.hangar.unit }).name}, one every ${ab.hangar.every} s.`);
  if (ab.yamato) L.push(`Every ${ab.yamato.every} s, fires a huge blast (${ab.yamato.dmg} damage) at the strongest enemy within ${ab.yamato.range} m.`);
  if (ab.ward) L.push(`Allies within ${ab.ward.r} m take ${Math.round(ab.ward.cut * 100)}% less damage.`);
  if (ab.brood || ab.spawn) { const s = ab.brood || ab.spawn; L.push(`Spawns ${(UNIT_BY_ID.get(s.unit) || { name: s.unit }).name} every ${s.every} s${s.max ? ` (up to ${s.max})` : ''}.`); }
  if (ab.impact) L.push(`Lands with an impact: ${ab.impact.dmg} damage in ${ab.impact.r} m.`);
  if (ab.burnAura) L.push(`Burns every ground enemy within ${ab.burnAura.r} m (${ab.burnAura.dps}/s).`);
  if (ab.lifesteal) L.push(`Heals for ${Math.round(ab.lifesteal.f * 100)}% of the damage it deals.`);
  if (ab.expire) L.push(`Lives ${ab.expire.t} s.`);
  if (ab.enrage) L.push(`Below ${Math.round(ab.enrage.at * 100)}% health it does ×${ab.enrage.mul} damage.`);
  if (ab.raise) L.push(`Every ${ab.raise.every} s, raises ${ab.raise.n} dead within ${ab.raise.r} m as skeletons.`);
  if (ab.phase) L.push(`Every ${ab.phase.every}rd hit on it passes straight through.`);
  if (ab.rally) L.push(`Allies within ${ab.rally.r} m deal ${Math.round(ab.rally.atk * 100)}% more damage and attack faster.`);
  if (ab.deathSpawn) L.push(`Bursts into ${ab.deathSpawn.n} ${(UNIT_BY_ID.get(ab.deathSpawn.unit) || { name: ab.deathSpawn.unit }).name} when it dies.`);
  if (ab.suicide) L.push('Explodes on contact (and dies doing it).');
  if (ab.summon) L.push(`Every ${ab.summon.every} s, summons reinforcements.`);
  if (u.bonus) L.push('Bonus damage vs ' + Object.entries(u.bonus).map(([k, v]) => `${cap(k)} ×${v}`).join(', ') + '.');
  return L;
}
export function unitRole(u) {
  const range = u.ab && u.ab.siege ? u.ab.siege.range : u.range;
  if (u.ab && u.ab.heal && !u.atk) return 'Support (healer)';
  if (!u.atk && !(u.ab && (u.ab.hangar || u.ab.spawn))) return 'Support';
  if (u.ab && (u.ab.hangar || u.ab.spawn || u.ab.brood)) return 'Summoner';
  if (u.minRange || (u.ab && u.ab.siege)) return 'Artillery';
  if (range <= 2.5) return u.hp >= 250 || (u.armor || 0) >= 3 ? 'Melee tank' : 'Melee';
  return range >= 12 ? 'Long-range' : 'Ranged';
}
export function unitTips(u) {
  const T = [], role = unitRole(u), tags = u.tags || [];
  if (role.startsWith('Melee')) T.push('Front row: it has to walk up to the enemy, so health and armor bonuses keep it alive on the way.');
  if (role === 'Artillery' || role === 'Long-range') T.push('Back row: keep a front line in front of it so nothing reaches it.');
  if (role === 'Artillery') T.push('Taking control (Space) lets you pick where every shell lands.');
  if (role.startsWith('Support')) T.push('Put it right behind the units it heals; it follows the army.');
  if (u.ab && u.ab.heal && u.ab.heal.mech) T.push('Only worth it with Mech units on your board: Tanks, Walkers, Bombard Tanks and other machines.');
  if (u.air) T.push('Flying: only units that hit air can fight it. Melee ground units can\'t touch it.');
  if (!u.hitsAir && u.atk) T.push('Can\'t hit fliers: pair it with something that can.');
  if (tags.includes('mech')) T.push('Mech: Combat Engineers repair it.');
  if (tags.includes('bio')) T.push('Bio: Medics and Monks heal it.');
  if ((u.rate || 0) >= 2) T.push('Attacks fast: on-hit effects (ignite, poison, slow, lifesteal) are great on it.');
  if ((u.rate || 0) && u.rate <= 0.5) T.push('Slow, heavy attacks: Encore and damage bonuses are worth more than attack speed here.');
  return T;
}
// The right-click details window for a card (plain text; the UI lays it out). opts.rank, opts.fxScaled: the fx as they apply now.
export function cardDetails(c, opts = {}) {
  const out = { title: c.name, sub: `Tier ${TIER_NAMES[c.tier]} · ${cardKind(c)}`, about: '', sections: [], tips: [] };
  if (c.kind === 'unit') {
    const u = unitOf(c.unit);
    const tags = unitTags(u);
    out.sub += ` · ${unitRole(u)}${tags.length ? ' · ' + tags.join(', ') : ''}${u.air ? ' · Flying' : ''}`;
    out.about = c.desc || u.desc || '';
    const ab = abilityLines(u); if (ab.length) out.sections.push(['Abilities', ab]);
    out.sections.push(['Unit type', tags.map(t => TAG_INFO[t.toLowerCase()]).filter(Boolean).concat(u.hitsAir ? ['Hits ground and air.'] : u.hitsGround === false ? ['Hits air only.'] : ['Hits ground only.'])]);
    if (c.fx && c.pattern) out.sections.push([`Aura: reaches ${reachText(c.pattern)}`, Object.keys(c.fx).filter(k => c.fx[k]).map(k => (FX_HELP[k] || [k])[0])]);
    out.tips = unitTips(u);
  } else {
    out.about = c.desc || '';
    if (c.pattern) out.sections.push(['Reach', [`Affects ${reachText(c.pattern)}. Place it so the cards you want to boost sit in the highlighted squares.`]]);
    const fx = opts.fxScaled || c.fx || {};
    const L = [];
    for (const [k, v] of Object.entries(fx)) { if (!v) continue; const h = FX_HELP[k]; if (h) { L.push(`${(FX_INFO[k] || [k])[0]}: ${h[0]}`); if (h[1] && !out.tips.includes(h[1])) out.tips.push(h[1]); } }
    if (L.length) out.sections.push(['Effects', L]);
  }
  if (c.variant === 'holy') out.sections.push(['Holy card', ['Blessed: every downside is removed and its upsides are 30% stronger.', 'Holy cards only show up in the store as a rare roll.']]);
  if (c.variant === 'cursed') out.sections.push(['Cursed card', ['Cursed: its upsides are 70% stronger, but its downsides are 50% worse (and it adds a health curse if it had none).', 'A card that removes downsides (Repentance) cancels the curse.']]);
  if (c.from && c.kind !== 'unit') out.sections.push(['Origin', [`Adapted from the shooter card "${opts.fromName || c.from}".`]]);
  return out;
}
