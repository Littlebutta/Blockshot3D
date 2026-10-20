// =====================================================================
// RTS mode (v1.2.27): bot players. They play by the same rules as people (they send the same actions through
// RtsGame.action) and only "cheat" by knowing where the other players started.
// A bot keeps its Riggers mining, builds depots before it gets supply blocked, follows a loose build order,
// expands, pulls research cards, keeps its buildings training a mixed army and attacks in waves that grow.
// =====================================================================
import { RTS, UNITS, BUILDINGS } from './rtsdata.js';

const LEVELS = {
  easy:   { think: 2.2, workers: 14, waveAt: 22, waveGrow: 6, expandAt: 420, maxBarracks: 1, pulls: 1, micro: false },
  normal: { think: 1.1, workers: 18, waveAt: 26, waveGrow: 10, expandAt: 260, maxBarracks: 2, pulls: 3, micro: true },
  hard:   { think: 0.55, workers: 22, waveAt: 30, waveGrow: 14, expandAt: 170, maxBarracks: 3, pulls: 6, micro: true },
};
export function rtsBot(g, p) { return new RtsBot(g, p); }

class RtsBot {
  constructor(g, p) {
    this.g = g; this.p = p; this.L = LEVELS[p.difficulty] || LEVELS.normal;
    this.t = 1 + g.rnd() * this.L.think; this.wave = this.L.waveAt; this.attacking = false; this.defendT = 0; this.defendAt = null;
    this.expanded = 0; this.lastBuild = 0; this.scouted = false; this.derT = 20 + g.rnd() * 20;
  }
  act(a) { this.g.action(this.p.id, a); }
  mine(type) { return this.g.units.filter(u => u.owner === this.p.id && (!type || u.type === type)); }
  myB(type, done) { return this.g.blds.filter(b => b.owner === this.p.id && (!type || b.type === type) && (!done || b.done)); }
  onHit(t, src) {
    if (!src || src.team === this.p.team) return;
    // anything of ours hit near our buildings: defend there
    const home = this.myB('hub')[0];
    if (t.kind === 'b' || (home && Math.hypot(t.x - home.x, t.z - home.z) < 40)) { this.defendAt = { x: src.x, z: src.z }; this.defendT = 8; }
  }
  onOffer() { this.pickT = 0.8; }
  tick(dt) {
    if (this.defendT > 0) this.defendT -= dt;
    if (this.pickT != null) { this.pickT -= dt; if (this.pickT <= 0) { this.pickT = null; this.pickCard(); } }
    this.t -= dt;
    if (this.t > 0) return;
    this.t = this.L.think * (0.8 + this.g.rnd() * 0.4);
    try { this.think(); } catch (err) { if (typeof console !== 'undefined') console.warn('[rts bot]', err); }
  }
  think() {
    const g = this.g, p = this.p, L = this.L;
    const workers = this.mine('rigger'), army = g.units.filter(u => u.owner === p.id && !u.def.worker);
    const hubs = this.myB('hub', true), allHubs = this.myB('hub');
    if (!allHubs.length) {   // every Command Hub lost: a surviving Rigger builds a new one at the closest free base
      const w = workers.find(u => !(u.order && u.order.k === 'build'));
      if (w && p.crystal >= BUILDINGS.hub.cost[0] && !workers.some(u => u.order && u.order.k === 'build' && u.order.type === 'hub')) {
        const spot = g.M.bases.filter(b => g.canPlace(p, 'hub', b.x, b.z) === true).sort((a, b) => Math.hypot(a.x - w.x, a.z - w.z) - Math.hypot(b.x - w.x, b.z - w.z))[0];
        if (spot) this.act({ t: 'build', ids: [w.id], type: 'hub', x: spot.x, z: spot.z });
      }
      return;
    }
    const home = hubs[0] || allHubs[0];
    // 1) idle workers go mining; refineries get three each
    const refs = this.myB('refinery', true);
    for (const r of refs) {
      const n = workers.filter(w => w.order && w.order.k === 'harvest' && w.order.ref === r.id).length;
      if (n < 3) { const w = workers.find(w2 => w2.order && w2.order.k === 'harvest' && w2.order.res && !w2.carry && Math.hypot(w2.x - r.x, w2.z - r.z) < 30); if (w) this.act({ t: 'cmd', ids: [w.id], o: { k: 'harvest', ref: r.id, x: r.x, z: r.z } }); }
    }
    for (const w of workers) {
      if (w.order) continue;
      const hub = this.nearest(hubs.length ? hubs : allHubs, w);
      const r = g.nearestRes(hub ? hub.x : w.x, hub ? hub.z : w.z, 'c', 40) || g.nearestRes(w.x, w.z, 'c');
      if (r) this.act({ t: 'cmd', ids: [w.id], o: { k: 'harvest', res: r.id, x: r.x, z: r.z } });
    }
    // 2) supply first: a depot before the cap is close (money is saved for it)
    const building = t => g.units.some(u => u.owner === p.id && u.order && u.order.k === 'build' && u.order.type === t) || this.myB(t).some(b => !b.done);
    const prodN = this.myB(null, true).filter(b => b.def.trains).length;
    const needDepot = p.supCap < p.capMax && p.supCap - p.supply < 3 + prodN * 2 && this.myB('depot').filter(b => !b.done).length + g.units.filter(u => u.owner === p.id && u.order && u.order.k === 'build' && u.order.type === 'depot' && !u.order.bid).length < (p.supply > 60 ? 2 : 1);
    if (needDepot) { if (p.crystal >= 100) this.build('depot', home); else return; }
    // workers
    const wantW = Math.min(L.workers * Math.max(1, hubs.length) + refs.length * 3, 60);
    for (const h of hubs) if (workers.length < wantW && h.queue.length < 1 && p.crystal >= 50) { this.act({ t: 'train', b: h.id, u: 'rigger' }); break; }
    // 4) the build order (a loose one: each step once its supply count is reached)
    const steps = [['barracks', 13], ['refinery', 15], ['archive', 22], ['factory', 24], ['refinery', 28], ['barracks', 30], ['airfield', 38], ['reclaimer', 44], ['barracks', 50], ['factory', 60]];
    const have = {}; for (const b of this.myB()) have[b.type] = (have[b.type] || 0) + 1;
    for (const u of g.units) if (u.owner === p.id && u.order && u.order.k === 'build' && !u.order.bid) have[u.order.type] = (have[u.order.type] || 0) + 1;
    const want = {};
    for (const [t, s] of steps) {
      want[t] = (want[t] || 0) + 1;
      if (t === 'barracks' && want[t] > L.maxBarracks) continue;
      if (p.supply < s || (have[t] || 0) >= want[t]) continue;
      if (!g.hasTech(p, BUILDINGS[t].needs)) continue;
      if (g.time - this.lastBuild < 3) break;
      if (this.build(t, home)) break;
      break;
    }
    // expand to the natural (and later more bases)
    if (g.time > L.expandAt * (1 + this.expanded * 1.2) && p.crystal >= 400 && !building('hub') && this.expanded < 3) this.expand();
    // 5) army production
    for (const b of this.myB(null, true)) {
      if (!b.def.trains || b.type === 'hub' || b.queue.length >= 2) continue;
      const pick = this.armyPick(b);
      if (pick) this.act({ t: 'train', b: b.id, u: pick });
    }
    // research cards
    const arch = this.myB('archive', true)[0];
    if (arch && !arch.queue.length && (p.pulls < L.pulls * (1 + Math.floor(g.time / 400)) || p.flux > 600) && p.crystal > 200 && p.flux > 125) this.act({ t: 'pull', ids: [arch.id] });
    for (const c of p.hand.slice()) this.act({ t: 'fit', c, u: this.bestType() });
    // rally new units to the front of the base
    const rally = this.rallyPoint(home);
    for (const b of this.myB(null, true)) if (b.def.trains && b.type !== 'hub' && (!b.rally || Math.hypot(b.rally.x - rally.x, b.rally.z - rally.z) > 4)) this.act({ t: 'cmd', ids: [b.id], o: { k: 'rally', x: rally.x, z: rally.z } });
    // a trooper or two takes derricks now and then
    this.derT -= this.L.think;
    if (this.derT <= 0) {
      this.derT = 45 + g.rnd() * 30;
      const free = g.derricks.filter(d => !d.owner || g.player(d.owner).team !== p.team).sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0];
      const t = army.find(u => u.def.tags.includes('bio') && !u.order);
      if (free && t) this.act({ t: 'cmd', ids: [t.id], o: { k: 'capture', der: free.id, x: free.x, z: free.z } });
    }
    // 6) the army: defend, gather, attack in waves
    const fighters = army.filter(u => u.def.weapons.length || u.def.heal);
    const armySup = fighters.reduce((s, u) => s + u.def.supply, 0);
    if (this.defendT > 0 && this.defendAt) {
      const ids = fighters.filter(u => Math.hypot(u.x - this.defendAt.x, u.z - this.defendAt.z) < 70).map(u => u.id);
      if (ids.length) this.act({ t: 'cmd', ids, o: { k: 'amove', x: this.defendAt.x, z: this.defendAt.z } });
      // towers go up when a base keeps getting hit
      if (g.hasTech(p, ['barracks']) && p.crystal > 150 && this.myB('sentry').length < 2 + hubs.length && !building('sentry')) this.build('sentry', home, 8);
    } else if (!this.attacking && armySup >= this.wave) {
      this.attacking = true; this.wave += L.waveGrow;
    }
    if (this.attacking) {
      const tgt = this.attackTarget();
      if (tgt && !tgt.kind && g.units.some(u => u.owner === p.id && !u.def.worker && Math.hypot(u.x - tgt.x, u.z - tgt.z) < 10) && !g.blds.some(b => b.team !== p.team && Math.hypot(b.x - tgt.x, b.z - tgt.z) < 30)) {
        // reached a start location and nothing is there: search the base spots
        if (!this.sweep || !this.sweep.length) this.sweep = g.M.bases.map(b => ({ x: b.x, z: b.z })).sort(() => g.rnd() - 0.5);
      }
      if (!tgt || armySup < Math.max(6, this.wave * 0.25 - L.waveGrow)) { this.attacking = false; }
      else {
        const ids = fighters.filter(u => !u.order || u.order.k !== 'amove' || Math.hypot(u.order.x - tgt.x, u.order.z - tgt.z) > 8).map(u => u.id);
        if (ids.length) this.act({ t: 'cmd', ids, o: { k: 'amove', x: tgt.x, z: tgt.z } });
      }
    } else if (this.defendT <= 0) {
      const idle = fighters.filter(u => !u.order && Math.hypot(u.x - rally.x, u.z - rally.z) > 14).map(u => u.id);
      if (idle.length) this.act({ t: 'cmd', ids: idle, o: { k: 'amove', x: rally.x, z: rally.z } });
    }
    // micro: crawlers siege near enemies, infantry overdrives in fights
    if (L.micro) {
      for (const u of fighters) {
        if (u.type === 'crawler') {
          let foe = false; g.near(u.x, u.z, 13, e => { if (!foe && e.team !== p.team && !e.air && g.seenBy(p.team, e)) foe = true; });
          if (foe !== !!u.siege && u.sT <= 0) this.act({ t: 'ab', ab: 'siege', ids: [u.id] });
        }
        if ((u.type === 'trooper' || u.type === 'lancer') && u.tgt && u.odT <= 0 && u.hp > u.maxHp * 0.7 && g.rnd() < 0.3) this.act({ t: 'ab', ab: 'overdrive', ids: [u.id] });
      }
    }
  }
  armyPick(b) {
    const p = this.p, g = this.g, n = t => g.units.filter(u => u.owner === p.id && u.type === t).length;
    const opts = (b.def.trains || []).filter(t => g.hasTech(p, UNITS[t].needs) && p.crystal >= UNITS[t].cost[0] && p.flux >= UNITS[t].cost[1]);
    if (!opts.length) return null;
    const rich = p.flux > 300;
    const w = { trooper: rich ? 3 : 6, lancer: rich ? 5 : 3, medic: n('trooper') + n('lancer') > 8 + n('medic') * 6 ? 2 : 0, vaulter: 1, strider: 2, crawler: rich ? 5 : 3, spotter: n('spotter') < 1 ? 2 : 0, hornet: 2, gunship: rich ? 4 : 2 };
    // keep some anti-air if the enemy flies
    const enemyAir = g.units.some(u => u.team !== p.team && u.air && g.seenBy(p.team, u));
    if (enemyAir) { w.hornet = 5; w.trooper += 3; }
    let tot = 0; for (const t of opts) tot += w[t] || 0;
    if (!tot) return null;
    let r = g.rnd() * tot; for (const t of opts) { r -= w[t] || 0; if (r <= 0) return t; }
    return opts[0];
  }
  bestType() {
    const cnt = {}; for (const u of this.g.units) if (u.owner === this.p.id && !u.def.worker) cnt[u.type] = (cnt[u.type] || 0) + u.def.supply;
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || 'trooper';
  }
  pickCard() {
    const off = this.p.offers[0]; if (!off) return;
    // the card with the most good numbers
    let best = 0, bs = -1e9;
    off.forEach((id, i) => { const c = this.g.cardById.get(id); if (!c) return; const s = Object.values(c.up).reduce((a, v) => a + v, 0) + this.g.rnd() * 0.2; if (s > bs) { bs = s; best = i; } });
    this.act({ t: 'pick', i: best, u: this.bestType() });
  }
  nearest(list, e) { let b = null, bd = Infinity; for (const x of list) { const d = Math.hypot(x.x - e.x, x.z - e.z); if (d < bd) { bd = d; b = x; } } return b; }
  rallyPoint(home) {
    const s = this.g.M.starts[this.p.start] || home;
    const ra = s.rampAt || home;
    return { x: ra.x + (ra.x - home.x) * 0.25, z: ra.z + (ra.z - home.z) * 0.25 };
  }
  attackTarget() {
    const g = this.g, p = this.p;
    // the nearest enemy building we know about, else an enemy start location
    let best = null, bd = Infinity;
    const home = this.myB('hub')[0] || { x: 0, z: 0 };
    for (const b of g.blds) { if (b.team === p.team || (!b.pl.revealed && !g.explored.get(p.team)[Math.max(0, cellOfB(g, b))])) continue; const d = Math.hypot(b.x - home.x, b.z - home.z); if (d < bd) { bd = d; best = b; } }
    if (best) return best;
    // nothing known: sweep the enemy starts, then every base spot, in turn
    if (this.sweep && this.sweep.length) { const s = this.sweep[0]; if (g.units.some(u => u.owner === p.id && !u.def.worker && Math.hypot(u.x - s.x, u.z - s.z) < 12)) this.sweep.shift(); if (this.sweep.length) return this.sweep[0]; }
    for (const q of g.players) { if (q.team === p.team || q.out || q.spectator) continue; const s = g.M.starts[q.start]; if (!s) continue; const d = Math.hypot(s.x - home.x, s.z - home.z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  // a free spot for a building near a base: rings outward, leaving a gap around every building and the mining area
  build(type, home, minR = 0) {
    const g = this.g, p = this.p;
    const worker = this.pickWorker(home); if (!worker) return false;
    const cost = BUILDINGS[type].cost; if (p.crystal < cost[0] || p.flux < cost[1]) return false;
    let spot = null;
    if (type === 'refinery') {
      for (const h of this.myB('hub')) { for (const r of g.res.values()) if (r.k === 'f' && !r.ref && Math.hypot(r.x - h.x, r.z - h.z) < 16) { spot = { x: r.x, z: r.z }; break; } if (spot) break; }
    } else spot = this.findSpot(type, home, minR);
    if (!spot) return false;
    this.act({ t: 'build', ids: [worker.id], type, x: spot.x, z: spot.z, q: false });
    // back to mining after
    const r = g.nearestRes(home.x, home.z, 'c', 40); if (r) this.act({ t: 'cmd', ids: [worker.id], o: { k: 'harvest', res: r.id, x: r.x, z: r.z }, q: true });
    this.lastBuild = g.time;
    return true;
  }
  pickWorker(near) {
    const ws = this.mine('rigger').filter(w => !w.carry && !w.inside && (!w.order || (w.order.k === 'harvest' && w.order.res)));
    return this.nearest(ws, near);
  }
  findSpot(type, home, minR) {
    const g = this.g, p = this.p, s = BUILDINGS[type].s, M = g.M, N = M.N;
    const patches = [...g.res.values()].filter(r => Math.hypot(r.x - home.x, r.z - home.z) < 16);
    for (let r = Math.max(7, minR); r < 34; r += 2) {
      const n = Math.max(8, Math.round(r * 1.2));
      const a0 = g.rnd() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = a0 + i / n * Math.PI * 2, x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
        if (patches.some(q => Math.hypot(q.x - x, q.z - z) < 5 + s || inMiningLane(home, q, x, z))) continue;
        if (g.canPlace(p, type, x, z) !== true) continue;
        // a cell of space around it so nothing gets walled in
        const f = g.footprint(type, x, z); let ok = true;
        for (let dz = -1; dz <= f.s && ok; dz++) for (let dx = -1; dx <= f.s; dx++) { const cx = f.cx0 + dx, cz = f.cz0 + dz; if (cx < 0 || cz < 0 || cx >= N || cz >= N) { ok = false; break; } const k = cz * N + cx; if (g.occ[k] || !M.walk[k] || M.ramp[k]) { ok = false; break; } }
        if (ok) return { x, z };
      }
    }
    return null;
  }
  expand() {
    const g = this.g, p = this.p, home = this.myB('hub')[0]; if (!home) return;
    const taken = b => g.blds.some(x => x.type === 'hub' && Math.hypot(x.x - b.x, x.z - b.z) < 10);
    const free = g.M.bases.filter(b => !taken(b)).sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z));
    for (const b of free) {
      if (g.canPlace(p, 'hub', b.x, b.z) !== true) continue;
      const w = this.pickWorker(home); if (!w) return;
      this.act({ t: 'build', ids: [w.id], type: 'hub', x: b.x, z: b.z });
      this.expanded++; this.lastBuild = g.time;
      return;
    }
    // not explored yet: send the worker there to look first
    const b = free[0]; const w = this.pickWorker(home);
    if (b && w && !this.scouting) { this.scouting = true; this.act({ t: 'cmd', ids: [w.id], o: { k: 'move', x: b.x, z: b.z } }); setTimeoutish(this, 20, () => { this.scouting = false; }); }
  }
}
function inMiningLane(home, q, x, z) {   // between the hub and a patch
  const dx = q.x - home.x, dz = q.z - home.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
  const rx = x - home.x, rz = z - home.z, al = rx * ux + rz * uz, ac = Math.abs(rx * uz - rz * ux);
  return al > 0 && al < L + 2 && ac < 4;
}
function cellOfB(g, b) { const M = g.M; const cx = Math.floor((b.x + M.H) / 2), cz = Math.floor((b.z + M.H) / 2); return cz * M.N + cx; }
function setTimeoutish(bot, s, fn) { const at = bot.g.time + s; (bot.g.lat ||= []).push({ at, fn }); }
