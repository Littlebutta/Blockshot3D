// Card tips (Settings → Card tips): a light hint on the card screen about which offered card fits
// what you already own. Purely advisory; it never changes offers. Tweak PAIRS to taste.
import { STAT_INFO } from './config.js';

const ON_HIT = ['poison', 'ignite', 'chill', 'hex', 'chain', 'limpet', 'lifesteal', 'knockback'];
const BLOCK_FX = ['counterShots', 'blockBarricade', 'blockEcho', 'blockMines', 'blockPush', 'blockDash', 'blockShock', 'blockHeal', 'blockDeploy', 'blockLeech', 'blockConcrete', 'reflectBoost'];
// [stat, stat, weight]: owning a card that improves one makes a card that improves the other better.
const PAIRS = [
  ['bounces', 'homing', 1.5], ['bounces', 'shrapnel', 1.2], ['bounces', 'explosive', 1], ['bounces', 'bulletSpeed', 0.6],
  ...ON_HIT.map(s => ['projectiles', s, 1.2]), ...ON_HIT.map(s => ['fireRate', s, 1]), ...ON_HIT.map(s => ['counterShots', s, 0.8]),
  ['ammo', 'fireRate', 1.2], ['ammo', 'reloadTime', 0.8], ['fireRate', 'reloadTime', 0.8], ['projectiles', 'ammo', 0.6],
  ['damage', 'explosive', 1.2], ['damage', 'skyfall', 1], ['damage', 'lifesteal', 1], ['damage', 'knockback', 0.8], ['damage', 'bulletSize', 0.6],
  ['explosive', 'bulletSize', 0.8], ['explosive', 'noSelfDamage', 1.5], ['explosive', 'limpet', 0.8],
  ['health', 'regen', 1.2], ['health', 'growOnHit', 1], ['health', 'lifesteal', 0.8], ['health', 'blockLeech', 0.8], ['regen', 'lifesteal', 0.6],
  ...BLOCK_FX.map(s => ['blockCooldown', s, 1.2]), ['blockDuration', 'blockShock', 1.2], ['blockDuration', 'blockLeech', 1], ['blockDuration', 'reflectBoost', 1],
  ['blockSize', 'blockShock', 1], ['blockSize', 'blockDeploy', 0.8], ['blockSize', 'blockBarricade', 0.6], ['blockEcho', 'counterShots', 1], ['blockEcho', 'blockMines', 0.8],
  ['drill', 'bulletSpeed', 1], ['drill', 'homing', 1], ['drill', 'damage', 0.6],
  ['moveSpeed', 'blockDash', 1], ['moveSpeed', 'jump', 0.6],
  ['bounces', 'bounceTarget', 1.6], ['bounces', 'bounceExplode', 1.3], ['bounces', 'bounceBoost', 1.3], ['bounces', 'bounceSplit', 1.3],
  ['bounceTarget', 'bounceBoost', 1], ['bounceSplit', 'bounceExplode', 0.8], ['ringHit', 'projectiles', 0.8], ['ringHit', 'bulletSpeed', 0.6],
  ['lifeDrain', 'health', 0.8], ['tank', 'health', 1], ['tank', 'damage', 0.8],
  ['summonTwin', 'damage', 0.8], ['summonTurret', 'projectiles', 0.8], ['summonDrone', 'fireRate', 0.6],
  ['napalm', 'damage', 1.2], ['napalm', 'bounces', 1], ['napalm', 'projectiles', 0.8], ['napalm', 'ignite', 0.6],
  ['slowField', 'moveSpeed', 1], ['slowField', 'health', 0.6], ['slowField', 'blockDuration', 0.5],
];
const W = new Map();
for (const [a, b, w] of PAIRS) { W.set(a + '|' + b, Math.max(w, W.get(a + '|' + b) || 0)); W.set(b + '|' + a, Math.max(w, W.get(b + '|' + a) || 0)); }

// Which stats a card improves and which it worsens.
export function cardEffects(c) {
  const up = new Set(), down = new Set();
  for (const m of c.modifiers || []) {
    const info = STAT_INFO[m.stat]; if (!info || m.op === 'convert') continue;
    const rises = m.op === 'mul' ? m.value > 1 : m.value > 0;
    (rises !== !!info.lowerIsBetter ? up : down).add(m.stat);
  }
  return { up, down };
}

// Score each offered card against the owned cards. Returns { scores: Map(id -> {score, why}), best }
// where best is the clearly strongest fit (or null when nothing stands out).
export function recommend(offered, owned) {
  const mine = owned.map(c => ({ c, e: cardEffects(c) }));
  const scores = new Map();
  for (const c of offered) {
    const e = cardEffects(c);
    let score = 0; const why = new Map();
    for (const o of mine) {
      for (const a of e.up) for (const b of o.e.up) {
        const w = a === b ? 0.35 : W.get(a + '|' + b) || 0;   // stacking the same stat helps a little
        if (w) { score += w; if (w >= 0.6) why.set(o.c.name, (why.get(o.c.name) || 0) + w); }
      }
      for (const a of e.down) if (o.e.up.has(a)) score -= 0.6;   // undercuts something you built around
    }
    const top = [...why.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(x => x[0]);
    scores.set(c.id, { score: Math.round(score * 10) / 10, why: top });
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const best = ranked[0] && ranked[0][1].score >= 1 && (!ranked[1] || ranked[0][1].score - ranked[1][1].score >= 0.5) && ranked[0][1].why.length
    ? { id: ranked[0][0], ...ranked[0][1] } : null;
  return { scores, best };
}
