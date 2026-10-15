// =====================================================================
// Card behaviors ("effects").
//
// Plain stat changes (damage, ammo...) need no code. When a card needs NEW
// behavior, add an entry here keyed by a stat name, add that stat to
// DEFAULT_STATS / STAT_INFO in config.js, and any card can use it.
//
// An effect runs only for players whose stat is above 0. Available hooks:
//   onBlock(game, player, level)          player pressed block (level = stat value)
//   onTick(game, player, level, dt)       every simulation step while alive
//   onDeath(game, player, level) -> true  return true to cancel the death
//   onRoundStart(game, player, level)     player spawned for a new round
//   onDealDamage(game, player, level, target, amount)  player damaged an enemy
// Use player.fx (an object reset every round) to store per-round state.
// =====================================================================
import { RULES } from './config.js';

const groundAt = (g, x, z, y) => {
  let top = 0;
  for (const s of g.solids) if (x > s.min.x && x < s.max.x && z > s.min.z && z < s.max.z && s.max.y <= y && s.max.y > top) top = s.max.y;
  return top;
};
const norm = v => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const rotY = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c }; };

export const EFFECTS = {
  // Fires a fan of free bullets when you block. Level = number of bullets.
  counterShots: {
    onBlock(g, p, n) {
      n = Math.round(n);
      for (let k = 0; k < n; k++) {
        const d = norm(rotY(p.aim, (k - (n - 1) / 2) * 0.16));
        g.spawnBullet(p, { x: p.pos.x + d.x * 0.75, y: p.pos.y + RULES.chest * p.size, z: p.pos.z + d.z * 0.75 }, d, p.stats.bulletSpeed, false);
      }
    },
  },

  // Blocking drops a concrete wall where you aim (long side facing you). Level = wall health.
  // Listed before sandbags so with both cards the sandbags land on top of the concrete.
  blockConcrete: {
    onBlock(g, p, hp) { g.placeWall(p, 'concrete', hp); },
  },

  // Blocking also drops a sandbag wall where you aim (long side facing you). Level = wall health.
  // No limit on how many stand at once; walls placed on other walls stack on top of them.
  blockBarricade: {
    onBlock(g, p, hp) { g.placeWall(p, 'sandbag', hp); },
  },

  // A second block triggers automatically 1 second after each block. Level = extra blocks.
  blockEcho: {
    onBlock(g, p, n) {
      if (p.fx.echoing) return;              // echoes don't echo
      p.fx.echoQueue = (p.fx.echoQueue || []);
      // Turret shield mod: echoes come 5 s apart so turrets don't stack up all at once.
      const gap = p.smod === 'turret' ? 5 : 1.0;
      for (let k = 1; k <= Math.round(n); k++) p.fx.echoQueue.push(k * gap);
    },
    onTick(g, p, n, dt) {
      const q = p.fx.echoQueue;
      if (!q || !q.length) return;
      for (let i = 0; i < q.length; i++) q[i] -= dt;
      while (q.length && q[0] <= 0) {
        q.shift();
        p.fx.echoing = true;
        g.tryBlock(p, true);                 // free block: ignores and doesn't reset cooldown
        p.fx.echoing = false;
      }
    },
  },

  // Once per round per revive card, a killing blow starts a revive instead: a beam of light marks the spot for
  // 1.6 seconds, then you stand back up with part of your health. Level = health fraction (split across copies).
  revive: {
    onDeath(g, p, frac) {
      const n = Math.max(1, (p.cards || []).filter(id => { const c = g.cardById && g.cardById.get(id); return c && c.modifiers.some(m => m.stat === 'revive'); }).length);
      if ((p.fx.revived || 0) >= n) return false;
      p.fx.revived = (p.fx.revived || 0) + 1; p.fx.reviveFrac = Math.min(1, frac / n * (n > 1 ? 1.25 : 1));
      p.hp = 0; p.reviving = true; p.reviveT = 1.6;
      g.emit({ t: 'reviveStart', p: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, dur: 1.6 });
      return true;
    },
  },

  // Blocking drops a field; one second later it heals every ally inside. Level = health restored.
  blockHeal: {
    onBlock(g, p, heal) { g.addField(p, heal, 3.2 * p.stats.blockSize); },
  },

  // Blocking drops mines in front of you: one per bullet you fire plus one (v1.1.2: two with a normal gun), plus (level - 1) extra.
  // They deal your gun's damage, keep explosive/knockback effects, and can hurt you too.
  blockMines: {
    onBlock(g, p, level) {
      const n = Math.max(2, Math.max(1, Math.round(p.stats.projectiles)) + Math.round(level));
      // Laid in a row across your facing, past any turret and walls this block also places (see Game.planDeploys).
      const plan = g.deployPlan(p), d = plan.f, side = { x: -d.z, z: d.x };
      const dist = plan.mine ?? 1.6, sp = 0.9 * Math.min(2, Math.max(0.7, p.stats.blockSize || 1));
      for (let k = 0; k < n; k++) {
        const o = (k - (n - 1) / 2) * sp, c = g.planSpot(plan, dist, 0.4);
        const x = c.x + side.x * o, z = c.z + side.z * o;
        g.addMine(p, x, groundAt(g, x, z, plan.y + 0.5), z);
      }
    },
  },

  // Co-op waves card: damage you deal heals nearby allies (not yourself). Level = fraction of damage.
  healAllies: {
    onDealDamage(g, p, level, target, amt) {
      for (const q of g.players) {
        if (q === p || !q.alive || q.reviving || g.isEnemy(p, q)) continue;
        if (Math.hypot(q.pos.x - p.pos.x, q.pos.z - p.pos.z) < 7) { const h0 = q.hp; q.hp = Math.min(g.maxHp(q), q.hp + amt * level); g.healPing(q, h0); }
      }
    },
  },
};

// Bloodforge: damage you deal to enemies grows your max health (and heals you by the same amount)
// for the rest of the round. Bonus is capped at +150% of your base health.
EFFECTS.growOnHit = {
  onDealDamage(g, p, level, target, amt) {
    const cap = p.stats.health * 1.5, gain = Math.min(amt * level, cap - (p.bonusHp || 0));
    if (gain <= 0) return;
    p.bonusHp = (p.bonusHp || 0) + gain;
    const h0 = p.hp; p.hp += gain; g.healPing(p, h0);
  },
};

// Drain Life card: siphons health from the nearest enemy you can see within 5 m + Drain range (level = health per
// second) and heals you by the same amount. A block bubble or shield stops it.
EFFECTS.lifeDrain = {
  onTick(g, p, rate, dt) {
    if (g.phase !== 'play') return;
    p.fx.drainScan = (p.fx.drainScan || 0) - dt;
    if (p.fx.drainScan <= 0) {
      p.fx.drainScan = 0.25;
      p.fx.drainTgt = g.drainTarget(p);
      const q = p.fx.drainTgt;
      if (q) g.emit({ t: 'drain', p: p.id, x1: q.pos.x, y1: g.chest(q), z1: q.pos.z, x2: p.pos.x, y2: g.chest(p), z2: p.pos.z });
    }
    const q = p.fx.drainTgt;
    if (!q || !q.alive || q.reviving || g.shielded(q) || g.boxCover(q, { x: p.pos.x, y: g.chest(p), z: p.pos.z }, p)) return;
    const amt = Math.min(rate * dt, Math.max(0, q.hp));
    g.hurt(q, amt, p, null, true);
    p.hp = Math.min(g.maxHp(p), p.hp + amt);
  },
};

// v1.2.6: the effects that have each hook are listed once (this runs for every unit every tick); hooks take at most two
// extra arguments (onTick: dt; onDealDamage: target, amount)
const HOOKS = new Map();
export function runHook(hook, g, p, a, b) {
  let list = HOOKS.get(hook);
  if (!list) HOOKS.set(hook, list = Object.entries(EFFECTS).filter(([, fx]) => fx[hook]));
  let result = false;
  for (let i = 0; i < list.length; i++) {
    const level = p.stats[list[i][0]];
    if (level > 0) result = list[i][1][hook](g, p, level, a, b) || result;
  }
  return result;
}
