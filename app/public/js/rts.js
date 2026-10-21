// =====================================================================
// RTS mode (v1.2.27): the host simulation (no three.js, no DOM; node runs it in tools/simtest.mjs).
// One faction for now (rtsdata.js), random maps with StarCraft-style cliff levels (rtsmap.js).
//
// Loop: a fixed 20 Hz step. Orders come in as actions (action()) from the local player, joiners and bots (rtsai.js).
// Pathing: one flow field per destination (shared by every unit going there) plus straight-line shortcuts, then
// local steering (separation, idle units stepping aside, smooth acceleration and turning) so groups move like a crowd.
// Vision: per team, StarCraft rules (stampVision): fog of war, explored ground, can't see up cliffs, air sees all.
// Each player is only sent what their team sees (viewFor) through its own AckEncoder stream (rtsui.js sendViews).
// =====================================================================
import { RTS, UNITS, BUILDINGS, UNIT_IDS, BUILDING_IDS, ABILITIES, supplyCap, researchCards, sumUps, pullCost, PULL_ODDS, cardCap } from './rtsdata.js';
import { generateRtsMap, CELL, LEVEL_H, STEP_MAX, ROCK, cellOf, cellX, cellZ, groundAt, stampVision, resCells, mulberry } from './rtsmap.js';
import { rtsBot } from './rtsai.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const INF = 0x3fffffff;
const D8X = [1, -1, 0, 0, 1, 1, -1, -1], D8Z = [0, 0, 1, -1, 1, -1, 1, -1], D8C = [10, 10, 10, 10, 14, 14, 14, 14];
export const TYPE_LIST = [...UNIT_IDS, ...BUILDING_IDS];   // type index on the wire
export const typeIndex = new Map(TYPE_LIST.map((t, i) => [t, i]));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// v1.2.27 entity budget for the RTS (same idea as the shooter's shot budget, budget.js): the unit cap adapts to how
// well the game runs. When it's near, the players with the most units are held from training more, first.
export const RTS_BUDGET = { msSlow: 22, msGood: 12, fpsSlow: 30, fpsGood: 36, every: 1, down: 0.92, up: 1.04, press: 0.8, minPer: 24 };

export class RtsGame {
  constructor({ roster, settings, cards, seed }) {
    this.settings = { ...settings };
    this.seed = (seed ?? Math.floor(Math.random() * 1e9)) >>> 0;
    this.rnd = mulberry(this.seed ^ 0x5bd1e995);
    this.M = generateRtsMap(roster.length, this.seed, this.settings.rtsSize || 'normal');
    this.mapSum = mapChecksum(this.M);
    this.cards = researchCards(cards || []);
    this.cardById = new Map(this.cards.map(c => [c.id, c]));
    this.time = 0; this.tickN = 0; this.acc = 0; this.nextId = 1; this.events = []; this.phase = 'play'; this.winner = null; this.dirty = true;
    const N = this.M.N;
    this.occ = new Int32Array(N * N);   // building on each cell (id), 0 = none
    this.navVer = 1; this.fields = new Map(); this.fieldBudget = 0;
    this.ents = new Map(); this.units = []; this.blds = [];
    this.res = new Map(this.M.res.map(r => [r.id, { ...r, busy: 0, ref: 0 }]));
    for (const r of this.res.values()) for (const k of resCells(r, N, this.M.H)) if (k >= 0) this.occ[k] = -r.id;   // (negative: a resource)
    this.derricks = this.M.derricks.map(d => ({ ...d, owner: null, capTeam: -1, capT: 0 }));
    this.towers = this.M.towers.map(t => ({ ...t, teams: [] }));
    this.flares = [];
    const cap = supplyCap(roster.length);
    this.players = roster.map((r, i) => ({
      id: r.id, name: r.name, color: r.color || '#8fd0ff', team: settings.mode === 'rts' && this.teamsOn(roster) ? (r.team || 0) : i, idx: i,
      isBot: !!r.isBot, difficulty: r.difficulty || 'normal', connected: true, out: false, spectator: false,
      crystal: RTS.startCrystal, flux: RTS.startFlux, supply: 0, supCap: 0, capMax: cap, inc: 0, incAcc: 0, incT: 0, trickle: 0,
      ups: {}, hand: [], offer: null, offers: [], pulls: 0, flareT: 0, alertT: {}, held: false, heldT: 0,
      stats: { built: 0, lost: 0, killed: 0, mined: 0, razed: 0, cards: 0, apm: 0 }, start: i,
    }));
    this.teams = [...new Set(this.players.map(p => p.team))];
    this.vis = new Map(); this.explored = new Map();
    for (const t of this.teams) { this.vis.set(t, { g: new Uint8Array(N * N), a: new Uint8Array(N * N) }); this.explored.set(t, new Uint8Array(N * N)); }
    this.visT = 0; this.bud = { cap: Infinity, total: 0, ms: 0, fps: 0, acc: 0, n: 0, t: 0 };
    this.hash = new Map(); this.hashSize = 6;
    this.bots = new Map();
    // starting bases: a Command Hub and 12 Riggers already mining
    this.players.forEach((p, i) => {
      const s = this.M.starts[i];
      const hub = this.addBuilding(p, 'hub', s.x, s.z, true);
      const base = this.M.bases.find(b => b.main === i);
      const patches = base ? base.patches.map(id => this.res.get(id)).filter(Boolean) : [];
      for (let w = 0; w < RTS.startWorkers; w++) {
        const r = patches[w % Math.max(1, patches.length)];
        const a = Math.atan2((r ? r.z : s.z + 1) - s.z, (r ? r.x : s.x) - s.x) + (w - 5.5) * 0.12;
        const u = this.addUnit(p, 'rigger', s.x + Math.cos(a) * 5.4, s.z + Math.sin(a) * 5.4);
        if (r) this.order(u, { k: 'harvest', res: r.id }, false);
      }
      this.recount(p);
      if (p.isBot) this.bots.set(p.id, rtsBot(this, p));
      if (hub) hub.rally = null;
    });
    this.updateVision(true);
  }
  teamsOn(roster) { return !!this.settings.rtsTeams && new Set(roster.map(r => r.team || 0)).size > 1; }
  player(id) { return this.players.find(p => p.id === id) || null; }
  takeEvents() { const e = this.events; this.events = []; return e; }
  ev(e) { this.events.push(e); }
  alert(p, k, x, z, text, gap = 4) {   // a message for one player (throttled per kind)
    if (!p || p.isBot) return;
    if ((p.alertT[k] || -99) > this.time - gap) return;
    p.alertT[k] = this.time;
    this.ev({ t: 'alert', to: p.id, k, x, z, text });
  }

  // ---------------------------------------------------------------- entities
  addUnit(p, type, x, z) {
    const d = UNITS[type]; if (!d) return null;
    const u = { id: this.nextId++, kind: 'u', type, def: d, owner: p.id, team: p.team, pl: p, x, z, vx: 0, vz: 0, face: this.rnd() * Math.PI * 2, spd: 0,
      hp: d.hp, maxHp: d.hp, r: d.r, air: !!d.air, order: null, queue: [], tgt: 0, cd: d.weapons.map(() => 0), acqT: this.rnd() * 0.3, wp: null, wpT: 0,
      carry: null, siege: 0, sT: 0, odT: 0, slowT: 0, slowK: 0, burnT: 0, burn: 0, poisonT: 0, poison: 0, hexT: 0, hex: 0, barrier: 0, barT: 0, hitT: -99, echoed: false,
      stuckT: 0, lastX: x, lastZ: z, atkN: 0, firing: 0, inside: 0, born: this.time };
    this.applyUps(u);
    u.hp = u.maxHp; u.barrier = u.st.barrier || 0;
    this.ents.set(u.id, u); this.units.push(u);
    this.dirty = true;
    return u;
  }
  // a building whose footprint's corner cell is computed from its center (sizes 1-4 cells)
  footprint(type, x, z) {
    const s = BUILDINGS[type].s, H = this.M.H;
    const cx0 = Math.round((x + H) / CELL - s / 2), cz0 = Math.round((z + H) / CELL - s / 2);
    return { s, cx0, cz0, x: (cx0 + s / 2) * CELL - H, z: (cz0 + s / 2) * CELL - H };
  }
  addBuilding(p, type, x, z, done = false, vent = null) {
    const d = BUILDINGS[type], f = this.footprint(type, x, z), N = this.M.N;
    const b = { id: this.nextId++, kind: 'b', type, def: d, owner: p.id, team: p.team, pl: p, x: f.x, z: f.z, s: f.s, cx0: f.cx0, cz0: f.cz0, half: f.s * CELL / 2,
      hp: done ? d.hp : Math.max(1, d.hp * 0.1), maxHp: d.hp, r: f.s * CELL * 0.5, done, prog: done ? 1 : 0, builders: 0, queue: [], qT: 0, rally: null,
      cd: (d.weapons || []).map(() => 0), tgt: 0, acqT: 0, vent: vent ? vent.id : 0, inside: 0, insideT: 0, hitT: -99, air: false, armor: d.armor };
    for (let dz = 0; dz < f.s; dz++) for (let dx = 0; dx < f.s; dx++) { const cx = f.cx0 + dx, cz = f.cz0 + dz; if (cx >= 0 && cz >= 0 && cx < N && cz < N) this.occ[cz * N + cx] = b.id; }
    if (vent) vent.ref = b.id;
    this.ents.set(b.id, b); this.blds.push(b);
    this.navVer++; this.dirty = true;
    this.shoveOut(b);
    if (done) this.recount(p);
    return b;
  }
  removeEnt(e) {
    this.ents.delete(e.id);
    if (e.kind === 'u') { const i = this.units.indexOf(e); if (i >= 0) this.units.splice(i, 1); }
    else {
      const i = this.blds.indexOf(e); if (i >= 0) this.blds.splice(i, 1);
      const N = this.M.N;
      for (let dz = 0; dz < e.s; dz++) for (let dx = 0; dx < e.s; dx++) { const k = (e.cz0 + dz) * N + e.cx0 + dx; if (this.occ[k] === e.id) this.occ[k] = 0; }
      if (e.vent) { const v = this.res.get(e.vent); if (v) { v.ref = 0; for (const k of resCells(v, N, this.M.H)) if (k >= 0) this.occ[k] = -v.id; } }
      this.navVer++;
    }
    this.dirty = true;
  }
  // units standing where a building goes step out to the nearest open cell around it
  shoveOut(b) {
    for (const u of this.units) {
      if (u.air || u.inside) continue;
      if (Math.abs(u.x - b.x) < b.half + u.r && Math.abs(u.z - b.z) < b.half + u.r) {
        const p = this.freeSpotNear(b, u.x, u.z, u.r); if (p) { u.x = p.x; u.z = p.z; }
      }
    }
  }
  freeSpotNear(b, tx, tz, r = 0.5) {
    const N = this.M.N, M = this.M;
    let best = null, bd = Infinity;
    for (let ring = 0; ring < 4; ring++) {
      const x0 = b.cx0 - 1 - ring, z0 = b.cz0 - 1 - ring, s = b.s + 2 + ring * 2;
      for (let i = 0; i < s; i++) for (const [cx, cz] of [[x0 + i, z0], [x0 + i, z0 + s - 1], [x0, z0 + i], [x0 + s - 1, z0 + i]]) {
        if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
        const k = cz * N + cx; if (!this.passable(k)) continue;
        const x = cellX(M, k), z = cellZ(M, k), d = Math.hypot(x - tx, z - tz);
        if (d < bd) { bd = d; best = { x, z }; }
      }
      if (best) return best;
    }
    return best;
  }
  passable(k) { return k >= 0 && this.M.walk[k] === 1 && this.occ[k] === 0; }
  recount(p) {
    let sup = 0, cap = 0;
    for (const u of this.units) if (u.owner === p.id) sup += u.def.supply;
    for (const b of this.blds) {
      if (b.owner !== p.id) continue;
      if (b.done && b.def.gives) cap += b.def.gives;
      for (const q of b.queue) if (q.u && q.started) sup += UNITS[q.u].supply;
    }
    p.supply = sup; p.supCap = Math.min(p.capMax, cap);
  }
  // unit stats: the base numbers with the owner's research cards for that unit type on top
  applyUps(u) {
    const p = u.pl, d = u.def, up = sumUps((p.ups[u.type] || []).map(id => (this.cardById.get(id) || {}).up));
    const ratio = u.maxHp ? u.hp / u.maxHp : 1;
    u.ups = up;
    u.st = { dmg: 1 + (up.dmg || 0), rate: 1 + (up.rate || 0), range: up.range || 0, splash: up.splash || 0, armor: d.armor + (up.armor || 0), regen: (d.regen || 0) + (up.regen || 0),
      leech: up.leech || 0, chain: up.chain || 0, slow: up.slow || 0, burn: up.burn || 0, poison: up.poison || 0, hex: up.hex || 0, encore: up.encore || 0, block: up.block || 0,
      barrier: up.barrier || 0, thorns: up.thorns || 0, drain: up.drain || 0, pen: up.pen || 0, resist: up.resist || 0, echo: !!up.echo, twin: up.twin || 0,
      boom: up.blastOnDeath || 0, extra: up.extra || 0, bomb: up.bomb || 0, meteor: up.meteor || 0, knock: up.knock || 0 };
    u.maxHp = Math.max(5, Math.round(d.hp * (1 + (up.hp || 0))));
    u.speedMax = d.speed * (1 + (up.speed || 0));
    if (u.hp != null) u.hp = Math.max(1, Math.min(u.maxHp, u.maxHp * ratio));
  }

  // ---------------------------------------------------------------- actions (players, joiners, bots)
  action(from, a) {
    const p = this.player(from); if (!p || !a || typeof a !== 'object') return;
    if (a.t === 'ack' || a.t === 'fps') { if (a.t === 'fps') p.fps = +a.v || 0; if (this.onAck && a.t === 'ack') this.onAck(from, a); return; }
    if (a.t === 'surrender') { if (!p.out) this.eliminate(p, 'surrender'); return; }
    if (p.out || this.phase !== 'play') return;
    p.stats.apm++;
    const mine = ids => (Array.isArray(ids) ? ids : []).slice(0, 400).map(id => this.ents.get(id)).filter(e => e && e.owner === p.id);
    switch (a.t) {
      case 'cmd': {   // orders for a group of units: { ids, o: { k, x, z, id, type }, q: queue (shift) }
        const us = mine(a.ids).filter(e => e.kind === 'u'), bs = mine(a.ids).filter(e => e.kind === 'b');
        const o = a.o || {};
        if (bs.length && (o.k === 'move' || o.k === 'smart' || o.k === 'rally')) for (const b of bs) this.setRally(b, o);
        if (!us.length) break;
        this.groupOrder(us, o, !!a.q);
        break;
      }
      case 'train': {   // { b: building id, u: unit type, n }
        const b = this.ents.get(a.b); if (!b || b.owner !== p.id || b.kind !== 'b') break;
        for (let i = 0; i < clamp(a.n | 0 || 1, 1, 5); i++) this.queueTrain(p, b, a.u);
        break;
      }
      case 'trainAny': {   // a unit type from the least busy building of yours that can make it (multi-building selections)
        const list = mine(a.ids).filter(b => b.kind === 'b' && b.done && (b.def.trains || []).includes(a.u)).sort((x, y) => x.queue.length - y.queue.length);
        if (list.length) this.queueTrain(p, list[0], a.u);
        else this.alert(p, 'nob', 0, 0, 'Nothing selected can train that.', 1);
        break;
      }
      case 'pull': {   // card research at an Archive
        const list = mine(a.ids || [a.b]).filter(b => b.kind === 'b' && b.done && b.def.research).sort((x, y) => x.queue.length - y.queue.length);
        if (list.length) this.queuePull(p, list[0]);
        break;
      }
      case 'cancel': {   // { b, i }: a queue slot, or the building itself while it's going up
        const b = this.ents.get(a.b); if (!b || b.owner !== p.id || b.kind !== 'b') break;
        if (!b.done && a.i == null) { this.refund(p, BUILDINGS[b.type].cost, 0.75); this.killEnt(b, null, true); break; }
        const i = a.i == null ? b.queue.length - 1 : a.i | 0, q = b.queue[i]; if (!q) break;
        this.refund(p, q.cost, 1);
        if (q.card) p.pulls = Math.max(0, p.pulls - 1);
        b.queue.splice(i, 1); if (i === 0) b.qT = 0;
        this.recount(p);
        break;
      }
      case 'build': {   // { ids (workers), type, x, z, q }
        const ws = mine(a.ids).filter(e => e.kind === 'u' && e.def.worker);
        if (!ws.length) break;
        const ok = this.canPlace(p, a.type, a.x, a.z, true);
        if (ok !== true) { this.alert(p, 'place', a.x, a.z, ok, 0.5); break; }
        const cost = BUILDINGS[a.type].cost;
        if (!this.afford(p, cost)) break;
        // the closest worker goes (any that is already carrying finishes the trip after)
        let w = ws[0], bd = Infinity; for (const x of ws) { const d = Math.hypot(x.x - a.x, x.z - a.z); if (d < bd) { bd = d; w = x; } }
        this.pay(p, cost);
        this.order(w, { k: 'build', type: a.type, x: a.x, z: a.z, paid: cost }, !!a.q);
        break;
      }
      case 'ab': {   // abilities: overdrive, siege, flare
        if (a.ab === 'flare') {
          const hub = mine([a.b]).find(b => b.def.ab && b.def.ab.includes('flare') && b.done) || this.blds.find(b => b.owner === p.id && b.done && b.type === 'hub');
          if (!hub) break;
          if (p.flareT > this.time) { this.alert(p, 'cd', 0, 0, `Recon Flare is ready again in ${Math.ceil(p.flareT - this.time)} s.`, 1); break; }
          if (!this.afford(p, [RTS.flare.cost, 0])) break;
          this.pay(p, [RTS.flare.cost, 0]); p.flareT = this.time + RTS.flare.cd;
          const x = clamp(+a.x || 0, -this.M.H, this.M.H), z = clamp(+a.z || 0, -this.M.H, this.M.H);
          this.flares.push({ team: p.team, x, z, until: this.time + RTS.flare.dur });
          this.ev({ t: 'flare', team: p.team, x, z, dur: RTS.flare.dur });
          this.updateVision(true);
          break;
        }
        const us = mine(a.ids).filter(e => e.kind === 'u');
        for (const u of us) {
          if (a.ab === 'overdrive' && (u.def.ab || []).includes('overdrive')) { const c = u.type === 'lancer' ? 20 : 10; if (u.hp > c + 1 && u.odT < 1) { u.hp -= c; u.odT = ABILITIES.overdrive.dur; this.ev({ t: 'od', id: u.id }); } }
          if (a.ab === 'siege' && u.def.siege) { if (u.sT <= 0) { u.siege = u.siege ? 0 : 1; u.sT = u.def.siege.t; u.order = null; u.queue = []; u.tgt = 0; u.vx = u.vz = 0; u.spd = 0; } }
        }
        break;
      }
      case 'pick': {   // { i }: take one of the cards a pull offered
        const off = p.offers[0]; if (!off) break;
        const id = off[a.i | 0]; if (!id) break;
        if (a.u && UNITS[a.u] && !this.roomFor(p, a.u)) { if (!a.keep || p.hand.length >= RTS.pull.hand) break; a = { ...a, u: null }; }   // (full: v1.2.28)
        if (!a.u && p.hand.length >= RTS.pull.hand) { const t = UNIT_IDS.find(u => this.roomFor(p, u, true)); if (!t) break; a = { ...a, u: t }; }
        p.offers.shift();
        if (a.u && UNITS[a.u]) this.fitCard(p, id, a.u); else p.hand.push(id);
        this.dirty = true;
        break;
      }
      case 'fit': {   // { c, u }: put a card from your hand on a unit type
        const i = p.hand.indexOf(a.c); if (i < 0 || !UNITS[a.u] || !this.roomFor(p, a.u)) break;
        p.hand.splice(i, 1); this.fitCard(p, a.c, a.u); break;
      }
      case 'unfit': {   // v1.2.28 { c, u }: take a card off a unit type, back into your hand (to fit it somewhere else)
        const L = p.ups[a.u], i = L ? L.indexOf(a.c) : -1; if (i < 0) break;
        if (p.hand.length >= RTS.pull.hand) { this.alert(p, 'hand', 0, 0, 'Your hand is full. Fit or discard a card first.', 1); break; }
        L.splice(i, 1); if (!L.length) delete p.ups[a.u];
        p.hand.push(a.c);
        for (const u of this.units) if (u.owner === p.id && u.type === a.u) this.applyUps(u);
        this.dirty = true; break;
      }
      case 'discard': { const i = p.hand.indexOf(a.c); if (i >= 0) p.hand.splice(i, 1); this.dirty = true; break; }
    }
  }
  // v1.2.28 (Devin): each unit type holds up to RTS.pull.perUnit cards (workers any number)
  roomFor(p, type, quiet) {
    if ((p.ups[type] || []).length < cardCap(type)) return true;
    if (!quiet) this.alert(p, 'full', 0, 0, `${UNITS[type].name}s already have ${RTS.pull.perUnit} cards. Take one off in research (F3) to fit another.`, 1);
    return false;
  }
  fitCard(p, id, type) {
    (p.ups[type] ||= []).push(id); p.stats.cards++;
    for (const u of this.units) if (u.owner === p.id && u.type === type) this.applyUps(u);
    const c = this.cardById.get(id);
    this.ev({ t: 'fitted', to: p.id, c: id, u: type, name: c ? c.name : id });
    this.dirty = true;
  }
  afford(p, cost) {
    if (p.crystal < cost[0]) { this.alert(p, 'noC', 0, 0, 'Not enough crystal.', 0.8); return false; }
    if (p.flux < cost[1]) { this.alert(p, 'noF', 0, 0, 'Not enough flux.', 0.8); return false; }
    return true;
  }
  pay(p, cost) { p.crystal -= cost[0]; p.flux -= cost[1]; }
  refund(p, cost, k) { if (!cost) return; p.crystal += Math.floor(cost[0] * k); p.flux += Math.floor(cost[1] * k); }
  hasTech(p, needs) { return !needs || needs.every(t => this.blds.some(b => b.owner === p.id && b.type === t && b.done)); }
  queueTrain(p, b, type) {
    const d = UNITS[type];
    if (!d || !b.done || !(b.def.trains || []).includes(type)) return false;
    if (!this.hasTech(p, d.needs)) { this.alert(p, 'tech', b.x, b.z, `Needs ${d.needs.map(t => BUILDINGS[t].name).join(', ')}.`, 1); return false; }
    if (b.queue.length >= RTS.queueMax) { this.alert(p, 'qfull', b.x, b.z, 'That queue is full.', 1); return false; }
    if (!this.afford(p, d.cost)) return false;
    this.pay(p, d.cost);
    b.queue.push({ u: type, cost: d.cost, dur: d.time });
    this.dirty = true;
    return true;
  }
  queuePull(p, b) {
    if (!b.done || b.queue.length >= RTS.queueMax) return false;
    if (p.offers.length + p.hand.length + b.queue.length >= RTS.pull.hand + 2) { this.alert(p, 'hand', b.x, b.z, 'Fit some of your cards first.', 1); return false; }
    const cost = pullCost(p.pulls);
    if (!this.afford(p, cost)) return false;
    this.pay(p, cost); p.pulls++;
    b.queue.push({ card: 1, cost, dur: RTS.pull.time });
    this.dirty = true;
    return true;
  }
  setRally(b, o) {
    if (!b.def.trains) return;
    if (o.id && this.ents.get(o.id)) b.rally = { x: this.ents.get(o.id).x, z: this.ents.get(o.id).z, id: o.id };
    else if (o.res && this.res.get(o.res)) { const r = this.res.get(o.res); b.rally = { x: r.x, z: r.z, res: r.id }; }
    else b.rally = { x: +o.x || 0, z: +o.z || 0 };
    this.dirty = true;
  }
  canPlace(p, type, x, z, explain) {
    const d = BUILDINGS[type]; if (!d) return 'Unknown building.';
    if (!this.hasTech(p, d.needs)) return `Needs ${d.needs.map(t => BUILDINGS[t].name).join(', ')}.`;
    const N = this.M.N, M = this.M;
    if (d.vent) {
      const v = this.ventAt(x, z);
      if (!v) return 'Refineries go on a flux vent.';
      if (v.ref) return 'That vent already has a refinery.';
      return true;
    }
    const f = this.footprint(type, x, z);
    let lv = -1;
    const ex = this.explored.get(p.team);
    for (let dz = 0; dz < f.s; dz++) for (let dx = 0; dx < f.s; dx++) {
      const cx = f.cx0 + dx, cz = f.cz0 + dz;
      if (cx < 1 || cz < 1 || cx >= N - 1 || cz >= N - 1) return 'Can\'t build there.';
      const k = cz * N + cx;
      if (!M.walk[k] || M.ramp[k] || this.occ[k]) return 'Can\'t build there.';
      if (lv < 0) lv = M.lv[k]; else if (M.lv[k] !== lv) return 'The ground there isn\'t flat.';
      if (ex && !ex[k]) return 'You haven\'t explored there.';
    }
    // no enemy units in the way (yours step aside)
    for (const u of this.units) if (!u.air && u.team !== p.team && Math.abs(u.x - f.x) < f.s + u.r && Math.abs(u.z - f.z) < f.s + u.r) return 'Something is in the way.';
    // hubs keep their distance from crystal and vents (StarCraft's rule)
    if (type === 'hub') for (const r of this.res.values()) if (Math.abs(r.x - f.x) < 6.5 + (r.k === 'f' ? 1 : 0) && Math.abs(r.z - f.z) < 6.5 + (r.k === 'f' ? 1 : 0)) return 'Too close to crystal or flux.';
    return true;
  }
  ventAt(x, z) { for (const r of this.res.values()) if (r.k === 'f' && Math.abs(r.x - x) < 2.6 && Math.abs(r.z - z) < 2.6) return r; return null; }

  // ---------------------------------------------------------------- orders
  // o.k: move, amove (attack-move), attack, stop, hold, patrol, harvest, ret (return cargo), build, repair, follow, smart (right-click: decided here)
  groupOrder(us, o, queue) {
    if (o.k === 'smart') o = this.smartOf(us[0], o);
    if (o.k === 'stop' || o.k === 'hold') { for (const u of us) { if (u.order && u.order.k === 'build' && u.order.paid && !u.order.bid) this.refund(u.pl, u.order.paid, 1); u.queue = []; u.order = o.k === 'hold' ? { k: 'hold' } : null; u.tgt = 0; u.wp = null; } return; }
    // workers: a smart click on crystal / refinery / damaged machine is theirs; others just move there
    if (o.k === 'move' || o.k === 'amove' || o.k === 'patrol') {
      // formation: a tight group moving far keeps its shape; a spread-out one converges on the spot
      let cx = 0, cz = 0; const ground = us.filter(u => !u.siege);
      for (const u of ground) { cx += u.x; cz += u.z; }
      cx /= Math.max(1, ground.length); cz /= Math.max(1, ground.length);
      let spread = 0; for (const u of ground) spread = Math.max(spread, Math.hypot(u.x - cx, u.z - cz));
      const tx = +o.x || 0, tz = +o.z || 0, far = Math.hypot(tx - cx, tz - cz);
      const keep = ground.length > 1 && spread < 9 + Math.sqrt(ground.length) && far > spread * 1.6 + 4;
      const grp = this.nextId++, gr = 0.6 + Math.sqrt(ground.length) * 0.75;
      for (const u of ground) {
        let x = tx, z = tz;
        if (keep) { x = tx + (u.x - cx) * 0.9; z = tz + (u.z - cz) * 0.9; if (!u.air && !this.walkableAt(x, z)) { x = tx; z = tz; } }
        const ord = { ...o, x, z, grp, gr: keep ? 0.6 : gr, k: o.k };
        if (o.k === 'patrol') { ord.ax = u.x; ord.az = u.z; }
        this.order(u, ord, queue);
      }
      return;
    }
    for (const u of us) {
      let oo = o;
      if (o.k === 'harvest' && !u.def.worker) oo = { k: 'move', x: o.x, z: o.z };
      if (o.k === 'repair' && !u.def.worker) oo = { k: 'follow', id: o.id };
      if (o.k === 'build' && !u.def.worker) continue;
      if (o.k === 'capture' && !(u.def.tags.includes('bio'))) oo = { k: 'move', x: o.x, z: o.z };
      this.order(u, { ...oo }, queue);
    }
  }
  // what a right-click means for this unit
  smartOf(u, o) {
    const e = o.id && this.ents.get(o.id);
    if (e && e.team !== u.team) return { k: 'attack', id: e.id };
    if (e && e.kind === 'b' && u.def.worker && e.owner === u.owner) {
      if (!e.done) return { k: 'build', bid: e.id, x: e.x, z: e.z };
      if (e.def.vent) return { k: 'harvest', ref: e.id, x: e.x, z: e.z };
      if (e.def.drop && u.carry) return { k: 'ret' };
      if (e.hp < e.maxHp) return { k: 'repair', id: e.id };
    }
    if (e && e.kind === 'u' && u.def.worker && e.team === u.team && e.def.tags.includes('mech') && e.hp < e.maxHp) return { k: 'repair', id: e.id };
    if (e && e.team === u.team && e.id !== u.id) return { k: 'follow', id: e.id };
    if (o.res && this.res.get(o.res)) { const r = this.res.get(o.res); if (u.def.worker && r.k === 'c') return { k: 'harvest', res: r.id, x: r.x, z: r.z }; if (u.def.worker && r.ref) return { k: 'harvest', ref: r.ref, x: r.x, z: r.z }; return { k: 'move', x: r.x, z: r.z }; }
    if (o.der != null) { const d = this.derricks.find(q => q.id === o.der); if (d) return { k: 'capture', der: d.id, x: d.x, z: d.z }; }
    return { k: 'move', x: o.x, z: o.z };
  }
  order(u, o, queue) {
    if (u.siege && u.sT <= 0 && o.k !== 'attack' && o.k !== 'stop' && o.k !== 'hold') {
      if (queue) { u.queue.push(o); return; }
      // a sieged crawler packs up first
      u.siege = 0; u.sT = u.def.siege.t;
    }
    if (queue && (u.order || u.queue.length)) { if (u.queue.length < 24) u.queue.push(o); return; }
    // a build order that gets replaced before the worker started it gives the money back
    if (u.order && u.order.k === 'build' && u.order.paid && !u.order.bid) this.refund(u.pl, u.order.paid, 1);
    for (const q of u.queue) if (q.k === 'build' && q.paid && !q.bid) this.refund(u.pl, q.paid, 1);
    u.queue = []; u.order = o; u.tgt = o.k === 'attack' ? o.id : 0; u.wp = null; u.wpT = 0; u.stuckT = 0;
    if (u.inside) { /* a worker inside a refinery keeps going until it comes out */ }
    if (o.k === 'harvest') { o.ph = 'go'; if (o.res) { const r = this.res.get(o.res); if (r) { o.x = r.x; o.z = r.z; } } }
    if (o.k === 'ret' && !u.carry) u.order = null;
  }
  nextOrder(u) {
    if (u.order && u.order.k === 'patrol') { const o = u.order; [o.ax, o.az, o.x, o.z] = [o.x, o.z, o.ax, o.az]; u.wp = null; return; }
    u.order = u.queue.length ? u.queue.shift() : null; u.wp = null; u.tgt = u.order && u.order.k === 'attack' ? u.order.id : 0;
    if (u.order && u.order.k === 'harvest') u.order.ph = 'go';
  }
  walkableAt(x, z) { return this.passable(cellOf(this.M, x, z)); }

  // ---------------------------------------------------------------- step
  step(dt) {
    if (this.phase === 'over') { this.time += dt; return; }
    this.acc += Math.min(0.25, dt);
    let n = 0;
    while (this.acc >= RTS.tick && n < 4) { this.acc -= RTS.tick; n++; this.tick(RTS.tick); }
    if (n >= 4) this.acc = 0;
  }
  tick(dt) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.time += dt; this.tickN++; this.fieldBudget = 6;
    this.buildHash();
    for (const [id, bot] of this.bots) { const p = this.player(id); if (p && !p.out) bot.tick(dt); }
    for (const p of this.players) if (!p.out) this.economy(p, dt);
    for (const b of this.blds.slice()) this.stepBuilding(b, dt);
    for (const u of this.units.slice()) if (this.ents.has(u.id)) this.stepUnit(u, dt);
    this.separate(dt);
    this.derrickTick(dt);
    this.timed(dt);
    this.visT -= dt;
    if (this.visT <= 0) { this.visT = 0.2; this.updateVision(); }
    if (this.tickN % 10 === 0) { this.checkStranded(); this.checkOver(); }
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.budgetTick(dt, t1 - t0);
  }
  economy(p, dt) {
    // C&C style infinite trickles: derricks you hold and your Reclaimers
    let rate = 0;
    for (const d of this.derricks) if (d.owner === p.id) rate += RTS.derrickRate;
    for (const b of this.blds) if (b.owner === p.id && b.done && b.def.income) rate += b.def.income;
    p.trickle = rate;
    p.incAcc += rate * dt;
    if (p.incAcc >= 1) { const w = Math.floor(p.incAcc); p.incAcc -= w; p.crystal += w; p.stats.mined += w; }
    p.incT += dt;
    if (p.incT >= 5) { p.inc = Math.round(((p.minedWin || 0) / p.incT) * 60 + rate * 60); p.minedWin = 0; p.incT = 0; }
    if (p.heldT > 0) p.heldT -= dt;
  }
  stepBuilding(b, dt) {
    const p = b.pl;
    if (!b.done) {
      // Terran-style: the building goes up only while a Rigger works on it (more Riggers, faster)
      if (b.builders > 0) {
        const k = dt / b.def.time * (1 + 0.6 * (b.builders - 1));
        b.prog = Math.min(1, b.prog + k); b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * k);
        if (b.prog >= 1) {
          b.done = true; b.hp = Math.max(b.hp, b.maxHp * 0.999); this.recount(p); p.stats.built++;
          this.ev({ t: 'built', to: p.id, id: b.id, type: b.type, x: b.x, z: b.z });
          if (b.def.vent) for (const u of this.units) if (u.owner === p.id && u.order && u.order.k === 'build' && u.order.bid === b.id) { u.order = { k: 'harvest', ref: b.id, x: b.x, z: b.z, ph: 'go' }; }
          this.dirty = true;
        }
      }
      b.builders = 0;
      return;
    }
    // production / research
    if (b.queue.length) {
      const q = b.queue[0];
      if (q.u && !q.started) {
        const d = UNITS[q.u];
        if (p.supply + d.supply > p.supCap) { this.alert(p, 'supply', b.x, b.z, p.supCap >= p.capMax ? 'You\'re at the supply limit.' : 'Not enough supply: build Supply Depots.', 8); return; }
        if (this.held(p)) { this.alert(p, 'held', b.x, b.z, 'Training held to keep the game smooth: you have the most units (right-click the unit bar to learn more).', 10); p.held = true; p.heldT = 1; return; }
        q.started = true; q.t0 = this.time; this.recount(p); this.dirty = true;
      }
      if (q.card && !q.started) { q.started = true; q.t0 = this.time; this.dirty = true; }
      b.qT += dt;
      if (b.qT >= q.dur) {
        b.qT = 0; b.queue.shift(); this.dirty = true;
        if (q.u) { this.spawnFrom(b, q.u); if (b.pl.ups[q.u] && this.rnd() < sumUps((p.ups[q.u] || []).map(id => (this.cardById.get(id) || {}).up)).twin && p.supply + UNITS[q.u].supply <= p.supCap) { this.spawnFrom(b, q.u); this.alert(p, 'twin', b.x, b.z, `Twin! A free ${UNITS[q.u].name}.`, 2); } this.recount(p); }
        if (q.card) this.offerCards(p);
      }
    }
    // inside a refinery
    if (b.inside) { b.insideT -= dt; if (b.insideT <= 0) { const u = this.ents.get(b.inside); b.inside = 0; if (u) { u.inside = 0; const v = this.res.get(b.vent); const n = v ? Math.min(RTS.fluxTrip, v.amt) : 0; if (v) v.amt -= n; u.carry = n > 0 ? { k: 'f', n } : null; if (u.order && u.order.k === 'harvest') u.order.ph = u.carry ? 'back' : 'go'; if (!u.carry) { u.order = null; this.alert(p, 'vdry', b.x, b.z, 'A flux vent has run dry.', 20); } } } }
    // towers shoot
    if (b.def.weapons) this.towerTick(b, dt);
  }
  towerTick(b, dt) {
    for (let i = 0; i < b.cd.length; i++) if (b.cd[i] > 0) b.cd[i] -= dt;
    b.firing = Math.max(0, (b.firing || 0) - dt);
    let t = b.tgt && this.ents.get(b.tgt);
    if (!t || !this.seenBy(b.team, t) || !this.inRange(b, t)) { t = null; b.tgt = 0; }
    b.acqT -= dt;
    if (!t && b.acqT <= 0) { b.acqT = 0.3; t = this.acquire(b, 0); b.tgt = t ? t.id : 0; }
    if (t) this.fire(b, t, dt);
  }
  spawnFrom(b, type) {
    const p = b.pl, d = UNITS[type];
    const r = b.rally;
    const tx = r ? r.x : b.x + b.half + 3, tz = r ? r.z : b.z + b.half + 3;
    let x, z;
    if (d.air) { x = b.x + Math.sign(tx - b.x || 1) * (b.half + 0.5); z = b.z + Math.sign(tz - b.z || 1) * (b.half + 0.5); }
    else { const s = this.freeSpotNear(b, tx, tz, d.r) || { x: b.x, z: b.z + b.half + 1 }; x = s.x + (this.rnd() - 0.5) * 0.4; z = s.z + (this.rnd() - 0.5) * 0.4; }
    const u = this.addUnit(p, type, x, z);
    u.face = Math.atan2(tz - z, tx - x);
    this.ev({ t: 'trained', to: p.id, id: u.id, type });
    if (r) {
      if (r.res && d.worker) { const rs = this.res.get(r.res); if (rs) this.order(u, rs.k === 'c' ? { k: 'harvest', res: rs.id } : rs.ref ? { k: 'harvest', ref: rs.ref, x: rs.x, z: rs.z } : { k: 'move', x: r.x, z: r.z }, false); }
      else if (r.id && this.ents.get(r.id) && this.ents.get(r.id).team === p.team) this.order(u, { k: 'follow', id: r.id }, false);
      else this.order(u, { k: 'move', x: r.x, z: r.z, grp: 0, gr: 1.5 }, false);
    } else if (d.worker) {
      // a new Rigger with no rally point goes mining at the nearest crystal
      const rs = this.nearestRes(x, z, 'c', 30); if (rs) this.order(u, { k: 'harvest', res: rs.id }, false);
    }
    return u;
  }
  offerCards(p) {
    const pool = this.cards, owned = new Set([...p.hand, ...Object.values(p.ups).flat()]);
    const pick = [];
    for (let i = 0; i < RTS.pull.offer && pool.length; i++) {
      const tot = Object.values(PULL_ODDS).reduce((a, b) => a + b, 0); let r = this.rnd() * tot, rar = 'common';
      for (const [k, w] of Object.entries(PULL_ODDS)) { r -= w; if (r <= 0) { rar = k; break; } }
      let list = pool.filter(c => c.rarity === rar && !pick.includes(c.id) && !owned.has(c.id));
      if (!list.length) list = pool.filter(c => !pick.includes(c.id));
      if (!list.length) break;
      pick.push(list[Math.floor(this.rnd() * list.length)].id);
    }
    p.offers.push(pick);
    this.ev({ t: 'offer', to: p.id });
    this.dirty = true;
    if (p.isBot) { const bot = this.bots.get(p.id); if (bot) bot.onOffer(); }
  }

  // ---------------------------------------------------------------- units
  stepUnit(u, dt) {
    // timers
    if (u.sT > 0) { u.sT -= dt; if (u.sT <= 0) u.sT = 0; u.vx = u.vz = 0; u.spd = 0; this.cooldowns(u, dt); return; }
    if (u.odT > 0) u.odT -= dt;
    if (u.slowT > 0) u.slowT -= dt;
    u.firing = Math.max(0, u.firing - dt);
    const regen = u.st.regen + (u.def.regen && this.time - u.hitT < 4 ? -u.def.regen : 0);
    if (regen > 0 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + regen * dt);
    if (u.st.barrier && this.time - u.hitT > 6 && u.barrier < u.st.barrier) u.barrier = Math.min(u.st.barrier, u.barrier + u.st.barrier * 0.2 * dt);
    if (u.st.drain && this.tickN % 10 === u.id % 10) this.near(u.x, u.z, 3, e => { if (e.team !== u.team && !e.air) { this.hurt(e, u.st.drain * 0.5, u, { pure: true }); u.hp = Math.min(u.maxHp, u.hp + u.st.drain * 0.25); } });
    if (u.inside) return;
    this.cooldowns(u, dt);
    if (u.def.heal) this.medic(u, dt);
    const o = u.order;
    // auto-acquire targets: idle, attack-moving, holding or patrolling units (and anyone who's being shot)
    const canFight = u.def.weapons.length > 0 && !u.def.worker;
    if (canFight && (!o || o.k === 'amove' || o.k === 'hold' || o.k === 'patrol')) {
      u.acqT -= dt;
      if (u.acqT <= 0) { u.acqT = 0.25 + this.rnd() * 0.1; const t = this.acquire(u, o && o.k === 'hold' ? 0 : 1); if (t && (!u.tgt || u.tgtAuto)) { u.tgt = t.id; u.tgtAuto = true; } }
    }
    let tg = u.tgt ? this.ents.get(u.tgt) : null;
    if (tg && (!this.seenBy(u.team, tg) || tg.inside)) { if (!o || o.k !== 'attack' || tg.inside) { tg = null; u.tgt = 0; } }
    if (!tg && u.tgt) u.tgt = 0;
    if (tg) {
      const inR = this.inRange(u, tg);
      if (inR) {
        this.brake(u, dt); this.turnTo(u, Math.atan2(tg.z - u.z, tg.x - u.x), dt);
        this.fire(u, tg, dt);
        if (o && o.k === 'attack' && !this.ents.has(o.id)) this.nextOrder(u);
        return;
      }
      if (u.siege || (o && o.k === 'hold')) { u.tgt = 0; }
      else if (!o || o.k === 'amove' || o.k === 'patrol' || o.k === 'attack') {
        // chase (auto targets only while they stay close to where we were going)
        if (u.tgtAuto && o && (o.k === 'amove' || o.k === 'patrol') && Math.hypot(tg.x - u.x, tg.z - u.z) > Math.max(u.def.sight, this.rangeOf(u, tg)) + 4) { u.tgt = 0; }
        else if (u.tgtAuto && !o && Math.hypot(tg.x - (u.homeX ?? u.x), tg.z - (u.homeZ ?? u.z)) > u.def.sight + 6) { u.tgt = 0; this.order(u, { k: 'move', x: u.homeX ?? u.x, z: u.homeZ ?? u.z, gr: 1 }, false); }
        else { if (!o && u.homeX == null) { u.homeX = u.x; u.homeZ = u.z; } this.moveToward(u, tg.kind === 'b' ? { b: tg } : { x: tg.x, z: tg.z, ent: tg }, dt, 0); return; }
      }
    } else if (o && o.k === 'attack') { this.nextOrder(u); return; }
    if (!o) { this.brake(u, dt); if (!u.tgt) { u.homeX = null; } return; }
    u.homeX = null;
    switch (o.k) {
      case 'move': case 'amove': case 'patrol': {
        const arrived = this.moveToward(u, { x: o.x, z: o.z, grp: o.grp, gr: o.gr }, dt, 0);
        if (arrived) { u.lastGrp = o.grp; this.nextOrder(u); }
        break;
      }
      case 'follow': {
        const e = this.ents.get(o.id); if (!e || e.team !== u.team) { this.nextOrder(u); break; }
        if (Math.hypot(e.x - u.x, e.z - u.z) > e.r + u.r + 2) this.moveToward(u, { x: e.x, z: e.z, ent: e }, dt, 0); else this.brake(u, dt);
        break;
      }
      case 'hold': this.brake(u, dt); break;
      case 'harvest': this.harvest(u, o, dt); break;
      case 'ret': this.returnCargo(u, o, dt); break;
      case 'build': this.buildWork(u, o, dt); break;
      case 'repair': this.repairWork(u, o, dt); break;
      case 'capture': {
        const d = this.derricks.find(q => q.id === o.der); if (!d) { this.nextOrder(u); break; }
        if (Math.hypot(d.x - u.x, d.z - u.z) > RTS.towerReach) this.moveToward(u, { x: d.x, z: d.z, gr: 2.4 }, dt, 0);
        else { this.brake(u, dt); if (d.owner === u.owner) this.nextOrder(u); }
        break;
      }
      default: this.nextOrder(u);
    }
  }
  cooldowns(u, dt) { const k = u.odT > 0 ? 1.5 : 1; for (let i = 0; i < u.cd.length; i++) if (u.cd[i] > 0) u.cd[i] -= dt * k; }
  rangeOf(u, t) {
    if (u.siege && u.def.siege) return u.def.siege.range + u.st.range;
    let r = 0; for (const w of u.def.weapons) if (this.canHit(w, t)) r = Math.max(r, w.range); return r + (u.st ? u.st.range : 0);
  }
  canHit(w, t) { return t.air ? w.ga.includes('a') : w.ga.includes('g'); }
  distTo(u, t) {
    if (t.kind === 'b') { const dx = Math.max(0, Math.abs(u.x - t.x) - t.half), dz = Math.max(0, Math.abs(u.z - t.z) - t.half); return Math.hypot(dx, dz); }
    return Math.max(0, Math.hypot(t.x - u.x, t.z - u.z) - t.r);
  }
  inRange(u, t) {
    const R = this.rangeOf(u, t); if (R <= 0) return false;
    const d = this.distTo(u, t) - (u.r || 0) * 0.5;
    if (u.siege && u.def.siege && d < u.def.siege.min) return false;
    return d <= R;
  }
  seenBy(team, e) {
    const v = this.vis.get(team); if (!v) return true;
    if (e.team === team) return true;
    const k = cellOf(this.M, e.x, e.z); if (k < 0) return false;
    return (e.air ? v.a[k] : v.g[k]) === 2;
  }
  acquire(u, chase) {
    const R = Math.max(this.maxRange(u) + (chase ? 2 : 0.3), chase ? u.def.sight * 0.9 : 0), team = u.team;
    let best = null, bs = Infinity;
    this.near(u.x, u.z, R + 4, e => {
      if (e.team === team || e.inside || e.dead) return;
      if (!this.weaponFor(u, e)) return;
      if (!this.seenBy(team, e)) return;
      const d = this.distTo(u, e);
      if (d > R) return;
      if (!chase && !this.inRange(u, e)) return;
      if (u.siege && u.def.siege && d < u.def.siege.min) return;
      const threat = e.kind === 'u' && e.def.weapons.length ? 0 : e.kind === 'b' && e.def.weapons ? 2 : e.kind === 'u' ? 6 : 12;
      const s = d + threat + (e.hp / e.maxHp) * 2;
      if (s < bs) { bs = s; best = e; }
    }, true);
    return best;
  }
  maxRange(u) { if (u.siege && u.def.siege) return u.def.siege.range + u.st.range; let r = 0; for (const w of u.def.weapons) r = Math.max(r, w.range); return r + (u.st ? u.st.range : 0); }
  weaponFor(u, t) {
    if (u.siege && u.def.siege) return t.air ? null : u.def.siege;
    for (const w of u.def.weapons) if (this.canHit(w, t)) return w;
    return null;
  }
  fire(u, t, dt) {
    const w = this.weaponFor(u, t); if (!w) return;
    const wi = u.siege ? 0 : u.def.weapons.indexOf(w);
    if (u.cd[wi] > 0) return;
    if (!u.def.turret && !u.air && u.kind === 'u' && Math.abs(angDiff(u.face, Math.atan2(t.z - u.z, t.x - u.x))) > 0.5) return;   // face it first
    u.cd[wi] = w.cd / (u.st ? u.st.rate : 1);
    u.firing = 0.4;
    this.attackOnce(u, t, w);
    if (u.st && u.st.encore && this.rnd() < u.st.encore) this.attackOnce(u, t, w);
  }
  attackOnce(u, t, w) {
    const st = u.st || { dmg: 1, pen: 0 };
    u.atkN = (u.atkN || 0) + 1;
    this.ev({ t: 'shoot', a: u.id, b: t.id, x: Math.round(t.x * 10) / 10, z: Math.round(t.z * 10) / 10, fx: w.fx || 'bullet', s: u.siege ? 1 : 0 });
    const n = w.n || 1;
    for (let i = 0; i < n; i++) {
      let dmg = this.dmgVs(w, t) * st.dmg;
      const splash = (w.splash || 0) + (st.splash || 0);
      if (w.line) this.lineHit(u, t, w, dmg);
      else if (splash > 0) this.splash(u, t.x, t.z, splash, dmg, w, t);
      else this.hurt(t, dmg, u, { w });
    }
    if (st.extra) for (let i = 0; i < st.extra; i++) this.hurt(t, this.dmgVs(w, t) * 0.25, u, { w, noFx: true });
    if (st.chain) {   // hits bounce on to nearby enemies
      let from = t; const hit = new Set([t.id]);
      for (let c = 0; c < st.chain; c++) {
        let nx = null, nd = 6;
        this.near(from.x, from.z, 6, e => { if (e.team === u.team || hit.has(e.id) || !this.canHit(w, e) || e.inside) return; const d = Math.hypot(e.x - from.x, e.z - from.z); if (d < nd) { nd = d; nx = e; } });
        if (!nx) break;
        hit.add(nx.id); this.hurt(nx, this.dmgVs(w, nx) * st.dmg * 0.6, u, { w });
        this.ev({ t: 'chain', x1: from.x, z1: from.z, x2: nx.x, z2: nx.z, a: from.id, b: nx.id });
        from = nx;
      }
    }
    if (st.meteor && u.atkN % 5 === 0) this.later(0.7, () => this.splash(u, t.x, t.z, 2.5, 30 * st.meteor, { ga: 'g' }, null, true), { t: 'meteor', x: t.x, z: t.z });
    if (st.bomb && t.kind) { const tx = t.x, tz = t.z, amt = this.dmgVs(w, t) * st.dmg * st.bomb; this.later(1.2, () => { const tt = this.ents.get(t.id); this.splash(u, tt ? tt.x : tx, tt ? tt.z : tz, 1.6, amt, w, null, true); }); }
  }
  dmgVs(w, t) {
    let d = w.dmg;
    if (w.bonus && t.def) { const tags = t.kind === 'b' ? ['armored', 'structure'] : t.def.tags; for (const k in w.bonus) if (tags.includes(k)) d += w.bonus[k]; }
    return d;
  }
  lineHit(u, t, w, dmg) {   // the Strider's flame: everything on a short line through the target
    const dx = t.x - u.x, dz = t.z - u.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L, reach = L + 1.5;
    const hit = new Set();
    this.near(u.x + ux * reach / 2, u.z + uz * reach / 2, reach, e => {
      if (e.team === u.team || e.air || hit.has(e.id) || e.inside) return;
      const rx = e.x - u.x, rz = e.z - u.z, al = rx * ux + rz * uz, ac = Math.abs(rx * uz - rz * ux);
      if (al < 0 || al > reach + e.r || ac > w.line / 2 + (e.r || 0)) return;
      hit.add(e.id); this.hurt(e, this.dmgVs(w, e) * (u.st ? u.st.dmg : 1), u, { w });
    });
    if (!hit.has(t.id)) this.hurt(t, dmg, u, { w });
  }
  splash(u, x, z, r, dmg, w, primary, noEv) {
    if (!noEv) this.ev({ t: 'splash', x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, r });
    const team = u ? u.team : -1;
    this.near(x, z, r + 2, e => {
      if (e.team === team || e.inside) return;
      if (w && w.ga && !this.canHit(w, e)) return;
      const d = e.kind === 'b' ? Math.max(0, Math.hypot(Math.max(0, Math.abs(e.x - x) - e.half), Math.max(0, Math.abs(e.z - z) - e.half))) : Math.max(0, Math.hypot(e.x - x, e.z - z) - e.r);
      if (d > r) return;
      const k = e === primary || d <= r * 0.5 ? 1 : 0.5;
      this.hurt(e, (w && w.dmg ? this.dmgVs(w, e) / w.dmg : 1) * dmg * k, u, { w, splash: true });
    });
  }
  hurt(t, amt, src, opts = {}) {
    if (!t || !this.ents.has(t.id) || amt <= 0) return;
    const st = t.st, sst = src && src.st;
    if (!opts.pure) {
      if (st && st.block && this.rnd() < st.block) { this.ev({ t: 'blockHit', id: t.id }); return; }
      if (t.hexT > this.time) amt *= 1 + t.hex;
      const armor = (t.kind === 'b' ? t.armor : st ? st.armor : 0) - (sst ? sst.pen : 0);
      amt = Math.max(0.5, amt - Math.max(0, armor));
      if (st && st.resist) amt *= 1 - st.resist;
    }
    if (t.barrier > 0) { const a = Math.min(t.barrier, amt); t.barrier -= a; amt -= a; }
    t.hp -= amt; t.hitT = this.time;
    if (src && src.team !== t.team) {
      if (src.kind === 'u' && src.st) {
        if (sst.leech) src.hp = Math.min(src.maxHp, src.hp + amt * sst.leech);
        if (!opts.splash && t.kind === 'u') {
          const w = opts.w || {};
          const slow = Math.max(w.slow || 0, sst.slow || 0);
          if (slow && !t.air) { t.slowT = Math.max(t.slowT, w.slowT || 1.5); t.slowK = Math.max(t.slowT > 0 ? t.slowK : 0, slow); }
          if (sst.burn) { t.burnT = this.time + 3; t.burn = Math.max(t.burn, sst.burn); t.burnBy = src.id; this.addDot(t); }
          if (sst.poison) { t.poisonT = this.time + 4; t.poison = Math.max(t.poison, sst.poison); t.poisonBy = src.id; this.addDot(t); }
          if (sst.hex) { t.hexT = this.time + 3; t.hex = Math.max(t.hexT > this.time ? t.hex : 0, sst.hex); }
          if (sst.knock && t.kind === 'u' && !t.siege) { const dx = t.x - src.x, dz = t.z - src.z, L = Math.hypot(dx, dz) || 1, nx = t.x + dx / L * sst.knock * 0.4, nz = t.z + dz / L * sst.knock * 0.4; if (t.air || this.walkableAt(nx, nz)) { t.x = nx; t.z = nz; } }
        }
      }
      if (st && st.thorns && src.kind === 'u' && !opts.thorns) this.hurt(src, amt * st.thorns, t, { thorns: true, pure: true });
      // under attack: idle units fight back, workers flee a little, the owner hears about it
      if (t.kind === 'u' && !t.order && !t.tgt && t.def.weapons.length && !t.def.worker && this.weaponFor(t, src) && this.seenBy(t.team, src)) { t.tgt = src.id; t.tgtAuto = true; }
      const owner = t.pl;
      if (owner && !owner.isBot) this.alert(owner, t.kind === 'b' ? 'baseHit' : 'armyHit', t.x, t.z, t.kind === 'b' ? 'Your base is under attack!' : t.def.worker ? 'Your workers are under attack!' : 'Your forces are under attack!', 12);
      if (owner && owner.isBot) { const bot = this.bots.get(owner.id); if (bot) bot.onHit(t, src); }
    }
    if (t.hp <= 0) this.killEnt(t, src);
  }
  addDot(t) { if (!t.dot) { t.dot = true; (this.dots ||= []).push(t); } }
  timed(dt) {
    // burns and poisons tick, delayed effects (bombs, meteors) go off
    if (this.dots && this.dots.length) {
      for (let i = this.dots.length - 1; i >= 0; i--) {
        const t = this.dots[i];
        if (!this.ents.has(t.id)) { this.dots.splice(i, 1); continue; }
        let any = false;
        if (t.burnT > this.time) { any = true; this.hurt(t, t.burn * dt, this.ents.get(t.burnBy), { pure: true }); }
        if (t.poisonT > this.time && this.ents.has(t.id)) { any = true; this.hurt(t, t.poison * dt, this.ents.get(t.poisonBy), { pure: true }); }
        if (!any) { t.dot = false; this.dots.splice(i, 1); }
      }
    }
    if (this.lat && this.lat.length) { const now = this.time; const due = this.lat.filter(l => l.at <= now); if (due.length) { this.lat = this.lat.filter(l => l.at > now); for (const l of due) l.fn(); } }
    if (this.flares.length) this.flares = this.flares.filter(f => f.until > this.time);
  }
  later(s, fn, ev) { (this.lat ||= []).push({ at: this.time + s, fn }); if (ev) this.ev(ev); }
  killEnt(e, src, quiet = false) {
    if (!this.ents.has(e.id)) return;
    const p = e.pl;
    if (e.kind === 'u' && e.st && e.st.echo && !e.echoed && !quiet) {   // Echo: back once at half health
      e.echoed = true; e.hp = e.maxHp * 0.5; this.ev({ t: 'echo', id: e.id, x: e.x, z: e.z }); return;
    }
    e.dead = true;
    if (e.kind === 'u' && e.st && e.st.boom && !quiet) this.splash(e, e.x, e.z, 2.5, e.st.boom, { ga: 'ga' });
    this.removeEnt(e);
    if (e.kind === 'b') {
      for (const u of this.units) if (u.inside && e.inside === u.id) { u.inside = 0; }
      if (e.vent) { /* the vent comes back (removeEnt) */ }
    }
    if (e.kind === 'u' && e.order && e.order.k === 'build' && e.order.paid && !e.order.bid) this.refund(p, e.order.paid, 1);
    if (e.kind === 'u' && e.harvRes) { const r = this.res.get(e.harvRes); if (r && r.busy === e.id) r.busy = 0; }
    if (!quiet) {
      this.ev({ t: 'die', id: e.id, k: e.kind, type: e.type, x: Math.round(e.x * 10) / 10, z: Math.round(e.z * 10) / 10, o: p ? p.idx : -1 });
      if (p) p.stats.lost++;
      const sp = src && src.pl; if (sp && sp !== p) { sp.stats.killed++; if (e.kind === 'b') sp.stats.razed++; }
    }
    if (p) this.recount(p);
    if (e.kind === 'b' && p && !this.blds.some(b => b.owner === p.id)) this.eliminate(p, 'razed');
  }
  eliminate(p, why) {
    if (p.out) return;
    p.out = true; p.outAt = this.time; this.dirty = true;
    for (const e of [...this.units, ...this.blds]) if (e.owner === p.id) this.killEnt(e, null, false);
    for (const d of this.derricks) if (d.owner === p.id) d.owner = null;
    this.ev({ t: 'elim', p: p.id, why });
    this.checkOver();
  }
  // no units left and nothing that can make any: out (StarCraft would reveal them; here the match just moves on)
  checkStranded() {
    if (this.tickN % 40) return;
    for (const p of this.players) {
      if (p.out || p.spectator) continue;
      // no Command Hub for 2 minutes: everyone sees your buildings (so a hidden last building can't drag a game on forever)
      if (this.blds.some(b => b.owner === p.id && b.type === 'hub')) { p.noHubT = null; p.revealed = false; }
      else { if (p.noHubT == null) p.noHubT = this.time; if (!p.revealed && this.time - p.noHubT > 120) { p.revealed = true; this.ev({ t: 'msg', text: `${p.name} has no Command Hub left: their buildings are revealed.` }); } }
      if (this.units.some(u => u.owner === p.id)) continue;
      if (this.blds.some(b => b.owner === p.id && ((b.done && b.def.trains) || (!b.done && b.type === 'hub')))) continue;
      this.eliminate(p, 'stranded');
    }
  }
  checkOver() {
    if (this.phase !== 'play') return;
    const alive = new Set(this.players.filter(p => !p.out && !p.spectator).map(p => p.team));
    if (alive.size <= 1 && this.players.length > 1) { this.phase = 'over'; this.winner = alive.size ? [...alive][0] : null; this.ev({ t: 'over', team: this.winner }); this.dirty = true; }
    else if (this.players.length === 1 && alive.size === 0) { this.phase = 'over'; this.winner = null; this.ev({ t: 'over', team: null }); this.dirty = true; }
  }

  // ---------------------------------------------------------------- medics, workers
  medic(u, dt) {
    const H = u.def.heal;
    let best = u.healT && this.ents.get(u.healT), bd = 99;
    if (!best || best.hp >= best.maxHp || Math.hypot(best.x - u.x, best.z - u.z) > H.range + 3) {
      best = null;
      this.near(u.x, u.z, H.range + 2.5, e => { if (e.kind !== 'u' || e.team !== u.team || e.id === u.id || !e.def.tags.includes('bio') || e.hp >= e.maxHp) return; const d = Math.hypot(e.x - u.x, e.z - u.z) + e.hp / e.maxHp * 4; if (d < bd) { bd = d; best = e; } });
    }
    u.healT = best ? best.id : 0;
    if (!best) return;
    const d = Math.hypot(best.x - u.x, best.z - u.z);
    if (d <= H.range + best.r) { best.hp = Math.min(best.maxHp, best.hp + H.hps * dt); u.firing = 0.3; if (this.tickN % 6 === 0) this.ev({ t: 'heal', a: u.id, b: best.id }); }
    else if (!u.order) this.moveToward(u, { x: best.x, z: best.z, ent: best }, dt, 0);
  }
  nearestRes(x, z, k, maxD = 1e9, skip = 0) {
    let best = null, bd = maxD;
    for (const r of this.res.values()) { if (r.k !== k || r.amt <= 0 || r.id === skip) continue; const d = Math.hypot(r.x - x, r.z - z) + (r.busy ? 3 : 0); if (d < bd) { bd = d; best = r; } }
    return best;
  }
  nearestDrop(u) {
    let best = null, bd = Infinity;
    for (const b of this.blds) { if (b.owner !== u.owner || !b.done || !b.def.drop) continue; const d = Math.hypot(b.x - u.x, b.z - u.z); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  harvest(u, o, dt) {
    u.ghost = true;   // mining workers walk through each other (StarCraft's mineral walk) so lines never jam
    if (o.ref) {   // flux: in and out of a refinery
      const b = this.ents.get(o.ref);
      if (!b || !b.done || b.owner !== u.owner) { u.ghost = false; this.nextOrder(u); return; }
      if (u.carry && u.carry.k === 'f') o.ph = 'back';
      if (o.ph === 'back' || (u.carry && u.carry.k === 'c')) { this.returnCargo(u, o, dt); return; }
      if (this.distTo(u, b) > RTS.dropRange + u.r) { this.moveToward(u, { b }, dt, RTS.dropRange); return; }
      this.brake(u, dt);
      if (!b.inside) { b.inside = u.id; b.insideT = RTS.fluxTime; u.inside = b.id; u.x = b.x; u.z = b.z; }
      return;
    }
    let r = this.res.get(o.res);
    if (u.carry) { this.returnCargo(u, o, dt); return; }
    if (!r || r.amt <= 0) {   // patch gone: the nearest one left in that base
      const nr = this.nearestRes(u.x, u.z, 'c', 24, o.res);
      if (!nr) { u.ghost = false; this.nextOrder(u); if (!u.order) this.alert(u.pl, 'mined', u.x, u.z, 'A crystal field is mined out.', 20); return; }
      o.res = nr.id; o.x = nr.x; o.z = nr.z; r = nr; o.ph = 'go';
    }
    const d = Math.hypot(r.x - u.x, r.z - u.z) - 0.9;
    if (o.ph !== 'mine') {
      if (d > u.r + 0.35) { this.moveToward(u, { x: r.x, z: r.z, res: r }, dt, u.r + 0.3); return; }
      // a free patch? another worker mining this one: try a free neighbor first
      if (r.busy && r.busy !== u.id && this.ents.has(r.busy)) {
        const alt = this.freePatchNear(r, u);
        if (alt) { o.res = alt.id; o.x = alt.x; o.z = alt.z; return; }
        this.brake(u, dt); return;   // wait for it
      }
      r.busy = u.id; u.harvRes = r.id; o.ph = 'mine'; o.t = RTS.mineTime;
    }
    this.brake(u, dt); this.turnTo(u, Math.atan2(r.z - u.z, r.x - u.x), dt);
    u.firing = 0.3;
    o.t -= dt;
    if (o.t <= 0) {
      const n = Math.min(RTS.crystalTrip, r.amt); r.amt -= n; r.busy = 0; u.harvRes = 0;
      u.carry = { k: 'c', n }; o.ph = 'back';
      if (r.amt <= 0) this.depleteRes(r);
    }
  }
  freePatchNear(r, u) {
    let best = null, bd = 7;
    for (const q of this.res.values()) { if (q.k !== 'c' || q.amt <= 0 || q.id === r.id || (q.busy && this.ents.has(q.busy) && q.busy !== u.id)) continue; const d = Math.hypot(q.x - r.x, q.z - r.z); if (d < bd) { bd = d; best = q; } }
    return best;
  }
  depleteRes(r) {
    this.res.delete(r.id);
    for (const k of resCells(r, this.M.N, this.M.H)) if (k >= 0 && this.occ[k] === -r.id) this.occ[k] = 0;
    this.navVer++; this.dirty = true;
    this.ev({ t: 'resGone', id: r.id });
  }
  returnCargo(u, o, dt) {
    const drop = this.nearestDrop(u);
    if (!drop) { this.brake(u, dt); return; }
    if (this.distTo(u, drop) > RTS.dropRange + u.r) { this.moveToward(u, { b: drop }, dt, RTS.dropRange); return; }
    const p = u.pl, c = u.carry;
    if (c) {
      if (c.k === 'c') { p.crystal += c.n; p.minedWin = (p.minedWin || 0) + c.n; } else p.flux += c.n;
      p.stats.mined += c.n;
      this.ev({ t: 'drop', id: u.id, k: c.k, n: c.n, to: p.id });
    }
    u.carry = null;
    if (o.k === 'ret') { this.nextOrder(u); return; }
    o.ph = 'go'; u.wp = null;
  }
  buildWork(u, o, dt) {
    let b = o.bid ? this.ents.get(o.bid) : null;
    if (o.bid && (!b || b.done)) { u.ghost = false; this.nextOrder(u); return; }
    if (!b) {
      // walk to the site, then lay the foundation
      const f = this.footprint(o.type, o.x, o.z), half = f.s * CELL / 2;
      const dx = Math.max(0, Math.abs(u.x - f.x) - half), dz = Math.max(0, Math.abs(u.z - f.z) - half);
      if (Math.hypot(dx, dz) > RTS.dropRange + u.r + 0.4) { this.moveToward(u, { x: f.x, z: f.z, site: f }, dt, 0); if (u.stuckT > 6) { this.refund(u.pl, o.paid, 1); o.paid = null; this.alert(u.pl, 'place', f.x, f.z, 'Your Rigger couldn\'t reach the building site.', 1); this.nextOrder(u); } return; }
      const ok = this.canPlace(u.pl, o.type, o.x, o.z, false);
      if (ok !== true) {
        o.wait = (o.wait || 0) + dt;
        if (o.wait > 4) { this.refund(u.pl, o.paid, 1); o.paid = null; this.alert(u.pl, 'place', f.x, f.z, ok === 'Something is in the way.' ? 'The building site is blocked.' : ok, 1); this.nextOrder(u); }
        this.brake(u, dt); return;
      }
      const vent = BUILDINGS[o.type].vent ? this.ventAt(o.x, o.z) : null;
      if (vent) { for (const k of resCells(vent, this.M.N, this.M.H)) if (k >= 0 && this.occ[k] === -vent.id) this.occ[k] = 0; }
      b = this.addBuilding(u.pl, o.type, vent ? vent.x : o.x, vent ? vent.z : o.z, false, vent);
      o.bid = b.id; o.paid = null;
      this.ev({ t: 'placed', to: u.owner, id: b.id, type: b.type });
    }
    if (this.distTo(u, b) > RTS.dropRange + u.r + 0.3) { this.moveToward(u, { b }, dt, RTS.dropRange); return; }
    this.brake(u, dt); this.turnTo(u, Math.atan2(b.z - u.z, b.x - u.x), dt);
    b.builders++; u.firing = 0.3;
  }
  repairWork(u, o, dt) {
    const t = this.ents.get(o.id);
    if (!t || t.team !== u.team || t.hp >= t.maxHp || (t.kind === 'b' && !t.done)) { this.nextOrder(u); return; }
    if (this.distTo(u, t) > RTS.dropRange + u.r + 0.3) { this.moveToward(u, t.kind === 'b' ? { b: t } : { x: t.x, z: t.z, ent: t }, dt, RTS.dropRange); return; }
    this.brake(u, dt); this.turnTo(u, Math.atan2(t.z - u.z, t.x - u.x), dt);
    // repairing costs a little crystal (a quarter of the unit / building per full repair)
    const cost = (t.def.cost ? t.def.cost[0] : 100) * 0.25, rate = t.maxHp / Math.max(8, (t.def.time || 20)) * dt;
    const c = cost * rate / t.maxHp;
    if (u.pl.crystal < c) { this.alert(u.pl, 'noC', 0, 0, 'Not enough crystal to repair.', 2); this.nextOrder(u); return; }
    u.pl.crystalFrac = (u.pl.crystalFrac || 0) + c; if (u.pl.crystalFrac >= 1) { const w = Math.floor(u.pl.crystalFrac); u.pl.crystal -= w; u.pl.crystalFrac -= w; }
    t.hp = Math.min(t.maxHp, t.hp + rate); u.firing = 0.3;
  }

  // ---------------------------------------------------------------- movement
  // Moves u toward a goal: { x, z } (a point), { b } (a building's edge), { res } (a crystal patch), { site } (a building site).
  // Returns true once it has arrived. arrive: how close counts (0 = the order's own rule).
  moveToward(u, g, dt, arrive) {
    if (u.siege) return false;
    let tx = g.x, tz = g.z;
    if (g.b) { tx = g.b.x; tz = g.b.z; }
    const distGoal = g.b ? this.distTo(u, g.b) : Math.hypot(tx - u.x, tz - u.z);
    const arriveR = arrive || (g.gr != null ? 0.35 : 0.5);
    if (distGoal <= arriveR + (g.b ? u.r : 0)) { this.brake(u, dt); return true; }
    // crowd arrival: someone of my group already stands at the spot and I'm touching them
    if (g.grp && distGoal < (g.gr || 1) + u.r) {
      let touch = false;
      this.near(u.x, u.z, u.r + 1.6, e => { if (!touch && e !== u && e.kind === 'u' && e.lastGrp === g.grp && !e.order && Math.hypot(e.x - u.x, e.z - u.z) < e.r + u.r + 0.25) touch = true; });
      if (touch) { this.brake(u, dt); return true; }
    }
    // stuck near the goal for a while: call it done
    if (Math.hypot(u.x - u.lastX, u.z - u.lastZ) > 0.6) { u.lastX = u.x; u.lastZ = u.z; u.stuckT = 0; } else u.stuckT += dt;
    if (u.stuckT > 1.2 && distGoal < 3 + (g.gr || 0)) { this.brake(u, dt); u.stuckT = 0; return true; }
    if (u.stuckT > 2.5) { u.wp = null; u.wpT = 0; }
    // waypoint: straight there when nothing is in the way, else down the flow field
    u.wpT -= dt;
    if (!u.wp || u.wpT <= 0 || Math.hypot(u.wp.x - u.x, u.wp.z - u.z) < 0.6) {
      u.wp = u.air ? { x: tx, z: tz } : this.waypoint(u, tx, tz, g);
      u.wpT = 0.3 + this.rnd() * 0.15;
    }
    let dx = u.wp.x - u.x, dz = u.wp.z - u.z;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    // speed: slow on approach (only for the final point), slowed by hits, faster on Overdrive
    let vmax = u.speedMax * (u.slowT > 0 ? 1 - u.slowK : 1) * (u.odT > 0 ? 1.5 : 1);
    const slowR = u.air ? 3 : 1.2;
    if (distGoal < slowR && !g.ent) vmax *= Math.max(0.35, distGoal / slowR);
    const want = Math.atan2(dz, dx);
    this.turnTo(u, want, dt);
    const align = Math.cos(angDiff(u.face, want));
    const mech = u.def.tags.includes('mech');
    const acc = u.air ? 7 : mech ? 12 : 26;
    const target = vmax * (mech && !u.air ? Math.max(0.15, align) : Math.max(0.6, align));
    u.spd += clamp(target - u.spd, -acc * 1.6 * dt, acc * dt);
    const vx = Math.cos(u.face) * u.spd * (mech || u.air ? 1 : 0) + dx * u.spd * (mech || u.air ? 0 : 1);
    const vz = Math.sin(u.face) * u.spd * (mech || u.air ? 1 : 0) + dz * u.spd * (mech || u.air ? 0 : 1);
    u.vx = vx; u.vz = vz;
    this.tryMove(u, vx * dt, vz * dt);
    return false;
  }
  brake(u, dt) { u.spd = Math.max(0, u.spd - (u.air ? 8 : 30) * dt); if (u.air && u.spd > 0) this.tryMove(u, Math.cos(u.face) * u.spd * dt, Math.sin(u.face) * u.spd * dt); u.vx = u.vz = 0; }
  turnTo(u, a, dt) {
    const rate = u.air ? 4 : u.def.tags.includes('mech') ? 6.5 : 14;
    const d = angDiff(u.face, a);
    u.face += clamp(d, -rate * dt, rate * dt);
  }
  // steps a ground unit, sliding along cliffs and buildings; air units fly anywhere over the map
  tryMove(u, mx, mz) {
    const H = this.M.H - 3;
    if (u.air) { u.x = clamp(u.x + mx, -H, H); u.z = clamp(u.z + mz, -H, H); return; }
    const k0 = cellOf(this.M, u.x, u.z);
    const ok = (x, z) => { const k = cellOf(this.M, x, z); if (k === k0) return true; return this.canStep(u, k0, k); };
    // a probe a little ahead (the unit's radius) keeps bodies off walls
    const pr = Math.min(0.45, u.r * 0.6), L = Math.hypot(mx, mz) || 1;
    const nx = u.x + mx, nz = u.z + mz;
    if (ok(nx, nz) && ok(nx + mx / L * pr, nz + mz / L * pr)) { u.x = nx; u.z = nz; return; }
    if (mx && ok(u.x + mx, u.z) && ok(u.x + mx + Math.sign(mx) * pr, u.z)) { u.x += mx; return; }
    if (mz && ok(u.x, u.z + mz) && ok(u.x, u.z + mz + Math.sign(mz) * pr)) { u.z += mz; return; }
    // v1.2.28: blocked both ways: slide off at 45 degrees to either side (pressed into a cliff corner beside a ramp)
    for (const a of [0.785, -0.785]) { const c = Math.cos(a), sn = Math.sin(a), rx = mx * c - mz * sn, rz = mx * sn + mz * c; if (ok(u.x + rx, u.z + rz) && ok(u.x + rx + rx / L * pr, u.z + rz + rz / L * pr)) { u.x += rx; u.z += rz; return; } }
    // stuck inside something (a building went up on top of it): step out
    if (!this.passable(k0) && !u.inside) { const b = this.ents.get(this.occ[k0]); const s = b && b.kind === 'b' ? this.freeSpotNear(b, u.x, u.z) : null; if (s) { u.x = s.x; u.z = s.z; } }
  }
  canStep(u, a, b) {
    if (b < 0 || !this.passable(b)) return false;
    if (a < 0) return true;
    const dh = Math.abs(this.M.h[a] - this.M.h[b]);
    if (dh <= STEP_MAX) {
      // diagonal steps can't squeeze between two blocked corners
      const N = this.M.N, ax = a % N, az = (a / N) | 0, bx = b % N, bz = (b / N) | 0;
      if (ax !== bx && az !== bz) { if (!this.passable(az * N + bx) && !this.passable(bz * N + ax)) return false; }
      return true;
    }
    return !!u.def.cliff && dh <= LEVEL_H * 1.25 && this.M.lv[b] !== ROCK;
  }
  // a point the unit can walk to in a straight line, as far along its path as possible
  // v1.2.28 (Devin: units got stuck at ramps when the goal was off to the side of one): the straight-line test is now
  // "fat" (the unit's width, not just its center line), so a shortcut never grazes a cliff edge beside a ramp; and a
  // unit that stops making progress follows the flow field one cell at a time until it is moving again.
  clearFat(x0, z0, x1, z1, cliff, r = 0.55) {
    if (!this.clearLine(x0, z0, x1, z1, cliff)) return false;
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); if (L < 0.5) return true;
    const px = -dz / L * r, pz = dx / L * r;
    const own = (x, z) => this.passable(cellOf(this.M, x, z));   // (an offset start can sit in a neighbor cell: only test it when open)
    for (const s of [1, -1]) { const ax = x0 + px * s, az = z0 + pz * s; if (own(ax, az) && !this.clearLine(ax, az, x1 + px * s, z1 + pz * s, cliff)) return false; }
    return true;
  }
  waypoint(u, tx, tz, g) {
    const M = this.M, k0 = cellOf(M, u.x, u.z), cliff = !!u.def.cliff;
    const careful = u.stuckT > 0.9;   // not getting anywhere: cell by cell down the field
    if (!careful && this.clearFat(u.x, u.z, tx, tz, cliff) && Math.hypot(tx - u.x, tz - u.z) < 90) return { x: tx, z: tz };
    const f = this.field(g, tx, tz, cliff);
    if (!f) return { x: tx, z: tz };
    let c = k0, best = null, first = null; const N = M.N;
    if (c < 0) return { x: tx, z: tz };
    for (let i = 0; i < 14; i++) {
      let nb = -1, nd = f[c];
      const cx = c % N, cz = (c / N) | 0;
      for (let d = 0; d < 8; d++) {
        const ex = cx + D8X[d], ez = cz + D8Z[d]; if (ex < 0 || ez < 0 || ex >= N || ez >= N) continue;
        const j = ez * N + ex; if (f[j] >= nd) continue;
        if (!this.passable(j) && f[j] !== 0) continue;
        if (this.passable(j) && !this.canStepCells(c, j, cliff)) continue;
        nd = f[j]; nb = j;
      }
      if (nb < 0 || !this.passable(nb)) break;
      c = nb; if (first === null) first = c;
      if (careful) { best = c; break; }
      if (this.clearFat(u.x, u.z, cellX(M, c), cellZ(M, c), cliff)) best = c; else if (best !== null) break;
    }
    if (best === null) best = first ?? c;   // (v1.2.28: was the last cell looked at, often round a cliff corner: units walked into the cliff)
    if (best === k0 || best < 0) return { x: tx, z: tz };
    return { x: cellX(M, best), z: cellZ(M, best) };
  }
  canStepCells(a, b, cliff) {
    const dh = Math.abs(this.M.h[a] - this.M.h[b]);
    if (dh > STEP_MAX && !(cliff && dh <= LEVEL_H * 1.25)) return false;
    const N = this.M.N, ax = a % N, az = (a / N) | 0, bx = b % N, bz = (b / N) | 0;
    if (ax !== bx && az !== bz && (!this.passable(az * N + bx) || !this.passable(bz * N + ax))) return false;
    return true;
  }
  // can a ground unit walk straight from (x0, z0) to (x1, z1)? (every cell on the line, each step climbable)
  clearLine(x0, z0, x1, z1, cliff) {
    const M = this.M, N = M.N, H = M.H;
    let fx = (x0 + H) / CELL, fz = (z0 + H) / CELL;
    const tx = (x1 + H) / CELL, tz = (z1 + H) / CELL;
    let cx = Math.floor(fx), cz = Math.floor(fz);
    const ex = Math.floor(tx), ez = Math.floor(tz);
    const dx = tx - fx, dz = tz - fz, sx = Math.sign(dx), sz = Math.sign(dz);
    let tMx = dx !== 0 ? ((sx > 0 ? cx + 1 - fx : fx - cx) / Math.abs(dx)) : Infinity, tMz = dz !== 0 ? ((sz > 0 ? cz + 1 - fz : fz - cz) / Math.abs(dz)) : Infinity;
    const tDx = dx !== 0 ? 1 / Math.abs(dx) : Infinity, tDz = dz !== 0 ? 1 / Math.abs(dz) : Infinity;
    let prev = cz * N + cx, n = 0;
    while ((cx !== ex || cz !== ez) && n++ < 400) {
      if (Math.abs(tMx - tMz) < 1e-9) { // exactly through a corner: both side cells must be open
        const a = cz * N + cx + sx, b = (cz + sz) * N + cx;
        if (!this.passable(a) || !this.passable(b)) return false;
        cx += sx; cz += sz; tMx += tDx; tMz += tDz;
      } else if (tMx < tMz) { cx += sx; tMx += tDx; } else { cz += sz; tMz += tDz; }
      if (cx < 0 || cz < 0 || cx >= N || cz >= N) return false;
      const k = cz * N + cx;
      if (!this.passable(k)) return false;
      const dh = Math.abs(M.h[k] - M.h[prev]);
      if (dh > STEP_MAX && !(cliff && dh <= LEVEL_H * 1.25)) return false;
      prev = k;
    }
    return true;
  }
  // Flow field (distance to the goal from every cell), shared by every unit headed to the same place.
  field(g, tx, tz, cliff) {
    const M = this.M, N = M.N;
    let key, goals;
    if (g.b) { key = 'b' + g.b.id; goals = []; for (let dz = 0; dz < g.b.s; dz++) for (let dx = 0; dx < g.b.s; dx++) goals.push((g.b.cz0 + dz) * N + g.b.cx0 + dx); }
    else if (g.res) { key = 'r' + g.res.id; goals = resCells(g.res, N, M.H).filter(k => k >= 0); }
    else if (g.site) { key = 's' + g.site.cx0 + ':' + g.site.cz0; goals = []; for (let dz = 0; dz < g.site.s; dz++) for (let dx = 0; dx < g.site.s; dx++) goals.push((g.site.cz0 + dz) * N + g.site.cx0 + dx); }
    else {
      let k = cellOf(M, tx, tz); if (k < 0) return null;
      if (g.ent) { const cx = (k % N) >> 1 << 1, cz = ((k / N) | 0) >> 1 << 1; k = cz * N + cx; }   // chasing: share fields on 2x2 blocks
      if (!this.passable(k)) { const alt = this.nearestOpen(k); if (alt < 0) return null; k = alt; }
      key = 'p' + k; goals = [k];
    }
    if (cliff) key += 'c';
    let F = this.fields.get(key);
    if (F && (F.ver === this.navVer || this.fieldBudget <= 0)) { F.used = this.time; return F.d; }
    if (this.fieldBudget <= 0 && !F) return null;
    this.fieldBudget--;
    const d = this.computeField(goals, cliff);
    if (!F) { F = { d, ver: this.navVer, used: this.time }; this.fields.set(key, F); } else { F.d = d; F.ver = this.navVer; F.used = this.time; }
    if (this.fields.size > 64) { let ok = null, ot = Infinity; for (const [k2, v] of this.fields) if (v.used < ot) { ot = v.used; ok = k2; } this.fields.delete(ok); }
    return d;
  }
  nearestOpen(k) {
    const N = this.M.N, cx = k % N, cz = (k / N) | 0;
    for (let r = 1; r < 8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const ex = cx + dx, ez = cz + dz; if (ex < 0 || ez < 0 || ex >= N || ez >= N) continue;
      const j = ez * N + ex; if (this.passable(j)) return j;
    }
    return -1;
  }
  computeField(goals, cliff) {
    const M = this.M, N = M.N, NN = N * N, h = M.h;
    const d = this._fd && this._fd.length === NN ? new Uint32Array(NN) : new Uint32Array(NN);
    d.fill(INF);
    const heap = this._heap || (this._heap = new Heap(NN * 2));
    heap.clear();
    for (const k of goals) { d[k] = 0; heap.push(k, 0); }
    while (heap.n) {
      const c = heap.pop(), dc = heap.lastKey;
      if (dc > d[c]) continue;
      const cx = c % N, cz = (c / N) | 0, open = this.passable(c);
      for (let i = 0; i < 8; i++) {
        const ex = cx + D8X[i], ez = cz + D8Z[i]; if (ex < 0 || ez < 0 || ex >= N || ez >= N) continue;
        const j = ez * N + ex;
        if (!this.passable(j)) continue;
        if (open) {
          const dh = Math.abs(h[j] - h[c]);
          if (dh > STEP_MAX && !(cliff && dh <= LEVEL_H * 1.25 && M.lv[j] !== ROCK)) continue;
          if (i >= 4 && (!this.passable(cz * N + ex) || !this.passable(ez * N + cx))) continue;
        }
        const nd = dc + D8C[i];
        if (nd < d[j]) { d[j] = nd; heap.push(j, nd); }
      }
    }
    return d;
  }

  // ---------------------------------------------------------------- crowds
  buildHash() {
    const S = this.hashSize, H = this.M.H, n = Math.ceil(this.M.size / S) + 1;
    if (!this.hashCells || this.hashN !== n) { this.hashN = n; this.hashCells = Array.from({ length: n * n }, () => []); }
    for (const c of this.hashCells) c.length = 0;
    for (const u of this.units) { if (u.inside) continue; const cx = clamp(Math.floor((u.x + H) / S), 0, n - 1), cz = clamp(Math.floor((u.z + H) / S), 0, n - 1); this.hashCells[cz * n + cx].push(u); }
  }
  // calls fn for units near (x, z) within r (+ buildings when withB)
  near(x, z, r, fn, withB = true) {
    const S = this.hashSize, H = this.M.H, n = this.hashN;
    const x0 = clamp(Math.floor((x - r + H) / S), 0, n - 1), x1 = clamp(Math.floor((x + r + H) / S), 0, n - 1), z0 = clamp(Math.floor((z - r + H) / S), 0, n - 1), z1 = clamp(Math.floor((z + r + H) / S), 0, n - 1);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) for (const u of this.hashCells[cz * n + cx]) if (Math.abs(u.x - x) <= r + u.r && Math.abs(u.z - z) <= r + u.r) fn(u);
    if (withB) for (const b of this.blds) if (Math.abs(b.x - x) <= r + b.half && Math.abs(b.z - z) <= r + b.half) fn(b);
  }
  // bodies push apart; a moving unit nudges idle friends out of its way instead of stopping
  separate(dt) {
    const S = this.hashSize, n = this.hashN, cells = this.hashCells;
    for (let cz = 0; cz < n; cz++) for (let cx = 0; cx < n; cx++) {
      const A = cells[cz * n + cx]; if (!A.length) continue;
      for (let dz = 0; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (dz === 0 && dx < 0) continue;
        const ex = cx + dx, ez = cz + dz; if (ex < 0 || ez >= n || ex >= n) continue;
        const B = cells[ez * n + ex]; const same = A === B;
        for (let i = 0; i < A.length; i++) {
          const a = A[i];
          for (let j = same ? i + 1 : 0; j < B.length; j++) {
            const b = B[j];
            if (a.air !== b.air) continue;
            if (a.ghost && b.ghost) continue;
            const ddx = b.x - a.x, ddz = b.z - a.z, rr = (a.r + b.r) * (a.air ? 1.1 : 0.92), d2 = ddx * ddx + ddz * ddz;
            if (d2 >= rr * rr) continue;
            let d = Math.sqrt(d2), nx, nz;
            if (d < 1e-4) { const ang = (a.id * 7 + b.id * 13) % 628 / 100; nx = Math.cos(ang); nz = Math.sin(ang); d = 0; } else { nx = ddx / d; nz = ddz / d; }
            const ov = (rr - d) * (a.air ? 0.25 : 0.5);
            const am = this.moving(a), bm = this.moving(b), aSolid = a.siege || a.ghost && !b.ghost, bSolid = b.siege || b.ghost && !a.ghost;
            // who gives way: idle friends step aside for movers; sieged tanks never move
            let ka = 0.5, kb = 0.5;
            if (a.team === b.team) { if (am && !bm) { ka = 0.1; kb = 0.9; } else if (bm && !am) { ka = 0.9; kb = 0.1; } }
            if (a.siege) { ka = 0; kb = 1; } if (b.siege) { kb = 0; ka = a.siege ? 0 : 1; }
            if (aSolid && !bSolid && !b.siege) { ka = 0; kb = 1; } else if (bSolid && !aSolid && !a.siege) { kb = 0; ka = 1; }
            if (ka) this.nudge(a, -nx * ov * ka * 2, -nz * ov * ka * 2);
            if (kb) this.nudge(b, nx * ov * kb * 2, nz * ov * kb * 2);
          }
        }
      }
    }
    for (const u of this.units) if (!u.order || u.order.k !== 'harvest') u.ghost = false;
  }
  moving(u) { return u.spd > 0.3 || (u.order && u.order.k !== 'hold' && u.order.k !== 'harvest'); }
  nudge(u, mx, mz) {
    if (u.inside) return;
    const m = Math.hypot(mx, mz); if (m > 0.5) { mx *= 0.5 / m; mz *= 0.5 / m; }
    this.tryMove(u, mx, mz);
  }

  // ---------------------------------------------------------------- derricks, towers, vision
  derrickTick(dt) {
    for (const d of this.derricks) {
      const teams = new Map();
      this.near(d.x, d.z, RTS.towerReach, e => { if (e.kind === 'u' && !e.air && e.def.tags.includes('bio') && Math.hypot(e.x - d.x, e.z - d.z) <= RTS.towerReach + e.r) { if (!teams.has(e.team)) teams.set(e.team, e.owner); } }, false);
      const ownerTeam = d.owner ? (this.player(d.owner) || {}).team : -1;
      if (teams.size === 1) {
        const [team, pid] = [...teams][0];
        if (team === ownerTeam) { d.capT = 0; d.capTeam = -1; continue; }
        if (d.capTeam !== team) { d.capTeam = team; d.capT = 0; }
        d.capT += dt;
        if (d.capT >= RTS.derrickCapture) {
          const prev = d.owner; d.owner = pid; d.capT = 0; d.capTeam = -1; this.dirty = true;
          this.ev({ t: 'derrick', id: d.id, o: pid, prev, x: d.x, z: d.z });
          const lost = prev && this.player(prev); if (lost) this.alert(lost, 'derLost', d.x, d.z, 'You lost a derrick!', 3);
          const won = this.player(pid); if (won) this.alert(won, 'derWon', d.x, d.z, `Derrick captured: +${RTS.derrickRate} crystal a second.`, 1);
        }
      } else if (teams.size === 0) { d.capT = Math.max(0, d.capT - dt); if (!d.capT) d.capTeam = -1; }
    }
    for (const t of this.towers) {
      const set = new Set();
      this.near(t.x, t.z, RTS.towerReach, e => { if (e.kind === 'u' && !e.air && Math.hypot(e.x - t.x, e.z - t.z) <= RTS.towerReach + e.r) set.add(e.team); }, false);
      t.teams = [...set];
    }
  }
  updateVision() {
    const M = this.M;
    for (const [team, v] of this.vis) {
      v.g.fill(0); v.a.fill(0);
      const ex = this.explored.get(team);
      for (const u of this.units) {
        if (u.team !== team || u.inside) continue;
        const lv = u.air ? 9 : M.lv[Math.max(0, cellOf(M, u.x, u.z))];
        stampVision(M, v.g, u.x, u.z, u.def.sight, lv, u.air);
        stampVision(M, v.a, u.x, u.z, u.def.sight, 9, true);
      }
      for (const b of this.blds) {
        if (b.team !== team) continue;
        const lv = M.lv[Math.max(0, cellOf(M, b.x, b.z))], sight = b.done ? b.def.sight : 5;
        stampVision(M, v.g, b.x, b.z, sight, lv, false);
        stampVision(M, v.a, b.x, b.z, sight, 9, true);
      }
      for (const t of this.towers) if (t.teams.includes(team)) { stampVision(M, v.g, t.x, t.z, RTS.towerSight, 9, true); stampVision(M, v.a, t.x, t.z, RTS.towerSight, 9, true); }
      for (const f of this.flares) if (f.team === team) { stampVision(M, v.g, f.x, f.z, RTS.flare.r, 9, true); stampVision(M, v.a, f.x, f.z, RTS.flare.r, 9, true); }
      for (let k = 0; k < v.g.length; k++) if (v.g[k]) ex[k] = 1;
    }
  }

  // ---------------------------------------------------------------- entity budget
  budgetTick(dt, ms) {
    const B = this.bud;
    if (this.settings.budget === false) { B.cap = Infinity; return; }
    B.acc += ms; B.n++; B.t += dt;
    if (B.t < RTS_BUDGET.every) return;
    const avg = B.acc / Math.max(1, B.n);
    let fps = this.hostFps || 0;
    for (const p of this.players) if (!p.isBot && p.connected && p.fps > 0 && (!fps || p.fps < fps)) fps = p.fps;
    B.ms = avg; B.fps = fps; B.acc = 0; B.n = 0; B.t = 0;
    const total = this.units.length; B.total = total;
    const active = this.players.filter(p => !p.out).length || 1, floor = RTS_BUDGET.minPer * active;
    const slow = avg > RTS_BUDGET.msSlow || (fps > 0 && fps < RTS_BUDGET.fpsSlow), good = avg < RTS_BUDGET.msGood && (!fps || fps >= RTS_BUDGET.fpsGood);
    if (slow) B.cap = Math.max(floor, Math.floor(Math.min(B.cap, total) * RTS_BUDGET.down));
    else if (good && B.cap !== Infinity) { B.cap = Math.ceil(B.cap * RTS_BUDGET.up); if (B.cap > total * 1.6 + 40) B.cap = Infinity; }
  }
  // held from training: only while the game is near its unit cap, and only players above their fair share (most units first)
  held(p) {
    const B = this.bud; if (B.cap === Infinity || this.settings.budget === false) return false;
    const total = this.units.length; if (total < B.cap * RTS_BUDGET.press) return false;
    const active = this.players.filter(q => !q.out).length || 1, share = B.cap / active;
    const mine = this.units.reduce((n, u) => n + (u.owner === p.id ? 1 : 0), 0);
    return total >= B.cap ? mine >= share * 0.6 : mine > share;
  }

  // ---------------------------------------------------------------- joining / leaving
  setConnected(id, on) {
    const p = this.player(id); if (!p) return;
    p.connected = on;
    if (!on && !p.isBot && !p.out) { p.wasHuman = true; p.isBot = true; p.difficulty = 'normal'; this.bots.set(p.id, rtsBot(this, p)); this.ev({ t: 'msg', text: `${p.name} left: a bot takes over their base.` }); }
    if (on && p.wasHuman) { p.isBot = false; p.wasHuman = false; this.bots.delete(p.id); this.ev({ t: 'msg', text: `${p.name} is back in command.` }); }
    this.dirty = true;
  }
  rebind(oldId, newId) {   // a player who dropped comes back with a new connection id: their base is theirs again
    const p = this.player(oldId); if (!p || p.spectator || this.player(newId)) return false;
    p.id = newId;
    for (const e of this.ents.values()) if (e.owner === oldId) e.owner = newId;
    for (const d of this.derricks) if (d.owner === oldId) d.owner = newId;
    if (this.bots.has(oldId)) { this.bots.set(newId, this.bots.get(oldId)); this.bots.delete(oldId); }
    this.setConnected(newId, true);
    return true;
  }
  addSpectator(r) {
    if (this.player(r.id)) { this.setConnected(r.id, true); return; }
    const p = { id: r.id, name: r.name, color: r.color || '#ccc', team: -1 - this.players.length, idx: this.players.length, isBot: false, connected: true, out: true, spectator: true, crystal: 0, flux: 0, supply: 0, supCap: 0, ups: {}, hand: [], offers: [], stats: {}, alertT: {} };
    this.players.push(p); this.dirty = true;
  }

  // ---------------------------------------------------------------- what each player is sent
  publicState() {
    return {
      ph: this.phase, tm: Math.round(this.time * 10) / 10, seed: this.seed, n: this.M.players, size: this.settings.rtsSize || 'normal', sum: this.mapSum, win: this.winner,
      pl: this.players.map(p => ({ id: p.id, name: p.name, color: p.color, team: p.team, idx: p.idx, out: p.out, spec: !!p.spectator, bot: p.isBot, on: p.connected, st: this.phase === 'over' ? p.stats : null })),
    };
  }
  // per player: the units / buildings / resources their team sees, their own economy and research
  viewFor(pid) {
    const p = this.player(pid), team = p ? p.team : null, all = !p || p.out || p.spectator;
    const v = all ? null : this.vis.get(team);
    const seen = e => all || e.team === team || (e.kind === 'b' && e.pl.revealed) || (v && (() => { const k = cellOf(this.M, e.x, e.z); if (k < 0) return false; if (e.kind === 'b') return v.g[k] === 2 || this.bSeen(v.g, e); return (e.air ? v.a[k] : v.g[k]) === 2; })());
    const ob = [], bc = [], mn = [], R1 = x => Math.round(x * 10) / 10;
    for (const u of this.units) {
      if (u.inside || !seen(u)) continue;
      const fl = (u.siege ? 1 : 0) | (u.sT > 0 ? 2 : 0) | (u.carry ? (u.carry.k === 'c' ? 4 : 8) : 0) | (u.odT > 0 ? 16 : 0) | (u.firing > 0 ? 64 : 0) | (u.spd > 0.2 ? 256 : 0) | (u.barrier > 1 ? 512 : 0) | (u.slowT > 0 ? 1024 : 0) | ((u.burnT > this.time || u.poisonT > this.time) ? 2048 : 0) | (u.def.worker && !u.order && !u.queue.length ? 4096 : 0);
      ob.push([u.id, typeIndex.get(u.type), u.pl.idx, R1(u.x), R1(u.z), Math.round(((u.face % 6.2832) + 6.2832) % 6.2832 * 10) / 10, Math.ceil(u.hp), u.maxHp, fl, u.tgt || 0]);
    }
    for (const b of this.blds) {
      if (!seen(b)) continue;
      bc.push([b.id, typeIndex.get(b.type), b.pl.idx, b.x, b.z, Math.ceil(b.hp), b.maxHp, b.done ? 100 : Math.floor(b.prog * 100), (b.queue.length ? 1 : 0) | (b.inside ? 2 : 0) | (b.firing > 0 ? 4 : 0), b.tgt || 0]);
    }
    for (const r of this.res.values()) { const k = cellOf(this.M, r.x, r.z); if (all || (v && v.g[k] === 2)) mn.push([r.id, r.amt]); }
    const out = { tm: Math.round(this.time * 1000), ob, bc, mn };
    // own side blocks (sticky: only sent when they change)
    if (p && !p.spectator) {
      out.sc = [Math.floor(p.crystal), Math.floor(p.flux), p.supply, p.supCap, p.inc, p.trickle, Math.max(0, Math.ceil(p.flareT - this.time)), p.held && p.heldT > 0 ? 1 : 0];
      const bo = {};
      for (const b of this.blds) if (b.owner === pid && (b.queue.length || b.rally)) bo[b.id] = [b.queue.map(q => q.u || '#card'), b.queue.length && b.queue[0].started ? Math.round((this.time - b.qT) * 10) / 10 : -1, b.queue.length ? b.queue[0].dur : 0, b.rally ? [R1(b.rally.x), R1(b.rally.z)] : null];
      out.bo = bo;
      out.co = { hand: p.hand, off: p.offers[0] || null, offN: p.offers.length, ups: p.ups, pulls: p.pulls };
    }
    out.tg = this.derricks.map(d => { const k = cellOf(this.M, d.x, d.z), vis = all || (v && v.g[k] === 2); return vis ? [d.id, d.owner ? this.player(d.owner).idx : -1, d.capTeam === team ? 1 : d.capTeam >= 0 ? 2 : 0, Math.round(d.capT / RTS.derrickCapture * 100)] : [d.id, -2]; });
    out.sw = [this.units.length, this.bud.cap === Infinity ? 0 : this.bud.cap, Math.round(this.bud.ms * 10) / 10, this.bud.fps];
    out.rt = this.towers.map(t => t.teams.length ? t.teams.includes(team) ? 1 : 2 : 0);
    return out;
  }
  bSeen(vg, b) { const M = this.M, N = M.N; for (let dz = 0; dz < b.s; dz++) for (let dx = 0; dx < b.s; dx++) { const k = (b.cz0 + dz) * N + b.cx0 + dx; if (vg[k] === 2) return true; } return false; }
  // which events a player gets: their own messages, and battle effects their team can see
  eventsFor(pid, evs) {
    const p = this.player(pid), team = p ? p.team : null, all = !p || p.out || p.spectator, v = all ? null : this.vis.get(team);
    const at = (x, z) => all || (v && v.a[cellOf(this.M, x, z)] === 2);
    const out = [];
    for (const e of evs) {
      if (e.to) { if (e.to === pid) out.push(e); continue; }
      if (e.team != null && e.t === 'flare') { if (all || e.team === team) out.push(e); continue; }
      if (e.t === 'shoot') { const a = this.ents.get(e.a); if (at(e.x, e.z) || (a && at(a.x, a.z))) out.push(e); continue; }
      if (e.x != null && e.z != null) { if (at(e.x, e.z)) out.push(e); continue; }
      if (e.x1 != null) { if (at(e.x1, e.z1)) out.push(e); continue; }
      out.push(e);
    }
    return out;
  }
}

// a binary min-heap of cell ids keyed by distance (flow fields)
class Heap {
  constructor(cap) { this.k = new Uint32Array(cap); this.v = new Int32Array(cap); this.n = 0; this.lastKey = 0; }
  clear() { this.n = 0; }
  push(v, key) {
    if (this.n >= this.k.length) { const k = new Uint32Array(this.k.length * 2), vv = new Int32Array(this.k.length * 2); k.set(this.k); vv.set(this.v); this.k = k; this.v = vv; }
    let i = this.n++; const K = this.k, V = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = v;
  }
  pop() {
    const K = this.k, V = this.v, top = V[0]; this.lastKey = K[0];
    const n = --this.n; if (n <= 0) return top;
    const key = K[n], val = V[n]; let i = 0;
    for (;;) { let c = i * 2 + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= key) break; K[i] = K[c]; V[i] = V[c]; i = c; }
    K[i] = key; V[i] = val;
    return top;
  }
}
export function mapChecksum(M) {
  let h = 2166136261 >>> 0;
  for (let k = 0; k < M.lv.length; k++) { h ^= M.lv[k] * 3 + M.walk[k] + M.ramp[k] * 7; h = Math.imul(h, 16777619); }
  for (const r of M.res) { h ^= Math.round(r.x * 10) * 31 + Math.round(r.z * 10); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export { generateRtsMap, groundAt };
