// =====================================================================
// v1.2.38 (Devin: spread the work over the CPU cores in every mode, not just the tournament): bot brains on other threads.
// A shared map (free-for-all, team games) can't be split up like the tournament's arenas: anyone can shoot anyone. What
// can move is the bots' thinking (targets, sight lines, routes, dodging), the biggest single part of a big lobby's step.
// Each brain thread keeps a copy of the world (BrainSim: a Game that never steps): the level, the fighters and their
// builds, walls and props, sent when they change, plus every frame where everyone is, the shots and the props, packed
// into number arrays. It thinks for its share of the bots and sends back their buttons, which the match (hostsim.js)
// presses a frame later. Bots that need what the copy doesn't keep (charging Hair / Pentagram / Grove / Space King,
// Pillars, katanas, melee units, commanded heroes) still think on the match's own thread, as do modes with bosses,
// waves, Core Defense, the open world, side view, Brawl and the tournament (it has its arena shards).
//   BrainSim: one brain thread's side (inside brainworker.js, or run here)
//   BrainSet: the match's side: what changed, the packed frame, the buttons coming back
// =====================================================================
import { Game } from './sim.js';
import { botThink } from './ai.js';
import { prepareLevel, gridExtras } from './physics.js';

const SPECIAL = new Set(['hair', 'ritual', 'grove', 'spaceking', 'pillar']);
// the bots a brain thread can think for (the rest think on the match's thread)
export const brainy = p => p.isBot && p.kind === 'hero' && !p.commanded && !p.melee && !p.dummy && p.mod !== 'katana' && !SPECIAL.has(p.smod);
// the matches that use brain threads
export const brainMode = g => !g.tourn && !g.isOpen() && !g.isSide() && !g.isBrawl() && !g.settings.core && !g.isWaves() && !g.boss && !(g.level && g.level.side);
// fewer bots than this: not worth the copying
export const BRAIN_MIN = 48;

// per fighter each frame (by slot): where they are and what changes from moment to moment
const ROW = 20;
const packRow = (A, o, p) => {
  A[o] = p.pos.x; A[o + 1] = p.pos.y; A[o + 2] = p.pos.z; A[o + 3] = p.vel.x; A[o + 4] = p.vel.y; A[o + 5] = p.vel.z;
  A[o + 6] = p.alive ? 1 : 0; A[o + 7] = p.hp; A[o + 8] = p.onGround ? 1 : 0; A[o + 9] = p.size || 1; A[o + 10] = p.blockCdT || 0; A[o + 11] = p.fireT || 0;
  A[o + 12] = p.crouch ? 1 : 0; A[o + 13] = p.flying ? 1 : 0; A[o + 14] = p.reviving ? 1 : 0; A[o + 15] = p.blockT || 0; A[o + 16] = p.ammo || 0; A[o + 17] = p.reloadT || 0;
  A[o + 18] = typeof p.team === 'number' ? p.team : NaN; A[o + 19] = p.dropThru || 0;
};
const unpackRow = (A, o, p) => {
  p.pos.x = A[o]; p.pos.y = A[o + 1]; p.pos.z = A[o + 2]; p.vel.x = A[o + 3]; p.vel.y = A[o + 4]; p.vel.z = A[o + 5];
  const alive = A[o + 6] === 1;
  if (alive && !p.alive) p.ai = {};   // (back from a respawn: a fresh mind, as resetPlayer gives)
  p.alive = alive; p.hp = A[o + 7]; p.onGround = A[o + 8] === 1; p.size = A[o + 9]; p.blockCdT = A[o + 10]; p.fireT = A[o + 11];
  p.crouch = A[o + 12] === 1 ? true : undefined; p.flying = A[o + 13] === 1; p.reviving = A[o + 14] === 1; p.blockT = A[o + 15]; p.ammo = A[o + 16]; p.reloadT = A[o + 17];
  if (!Number.isNaN(A[o + 18])) p.team = A[o + 18]; p.dropThru = A[o + 19];
};
// per shot: id, owner slot, where, how fast, size, bounced
const BROW = 10;
// per bot answer: slot, move, jump, shoot, block, block presses, aim (has, x, y, z), aim point (has, x, y, z), reload
const OUT = 16;

export class BrainSim {
  constructor() { this.g = null; this.slots = []; this.tok = 0; this.shots = new Map(); }
  init(m) { this.settings = m.settings; this.cards = m.cards; }
  round(B) {
    const g = this.g = new Game({ roster: [], settings: this.settings, cards: this.cards });
    this.tok = B.tok; this.slots = []; this.shots = new Map();
    g.round = B.round; g.rmod = B.rmod; g.levelVersion++; g.time = B.time; g.phase = B.phase; g.flyHeight = B.fly;
    g.bullets = []; g.barricades = []; g.shields = []; g.boss = null;
    g.startReload = p => { p._reload = true; };   // (the match does it: the answer says so)
    g.level = prepareLevel(B.level); g.buildDynamics();
    this.roster(B.add, []); this.walls(B.bar);
  }
  roster(add, del) {
    const g = this.g;
    for (const s of del) this.slots[s] = null;
    for (const [s, h] of add) {
      const old = this.slots[s], p = Object.assign(g.makePlayer({ ...h }), h);
      p.input = old && old.id === p.id ? old.input : { mx: 0, mz: 0, jump: false, shoot: false, blockSeq: 0, reloadSeq: 0, aim: null, aimPoint: null };
      p.ai = old && old.id === p.id ? old.ai : {}; p.fx = {}; p.ground = null;
      this.slots[s] = p;
    }
    g.players = this.slots.filter(Boolean);
    for (const p of g.players) p.ownerRef = p.ownerId ? g.player(p.ownerId) : null;
    g._ap = g._bp = g._pg = g._bg = null;
  }
  walls(bar) { if (!bar) return; this.g.barricades = bar; this.g.refreshSolids(); }
  frame(m) {
    const g = this.g, t0 = performance.now();
    if (!g || m.tok !== this.tok) return { t: 'out', tok: m.tok, stale: 1 };
    if (m.add || m.del) this.roster(m.add || [], m.del || []);
    if (m.bar) this.walls(m.bar);
    g.time = m.time; g.phase = m.phase; g.stepN++; g._ap = g._bp = g._pg = g._bg = null;
    const S = this.slots, R = m.rows;
    for (let s = 0, o = 0; s < S.length; s++, o += ROW) if (S[s] && o < R.length) unpackRow(R, o, S[s]);
    // props: where they are now (same list and order as the match's, both made from the level)
    const D = m.dyn;
    if (D && D.length === g.dyn.length * 3) for (let i = 0; i < g.dyn.length; i++) { const o = g.dyn[i]; o.pos.x = D[i * 3]; o.pos.y = D[i * 3 + 1]; o.pos.z = D[i * 3 + 2]; g.updateSolid(o); }
    gridExtras(g.solids);
    // shots: the same objects from frame to frame (a bot remembers which ones it already reacted to)
    const B = m.shots, list = [], seen = new Map();
    for (let o = 0; o < B.length; o += BROW) {
      const id = B[o], own = S[B[o + 1]] || null;
      let b = this.shots.get(id);
      if (!b) b = { id, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, aiSeen: {}, alive: true };
      b.owner = own ? own.id : null; b.ownerRef = own; b.pos.x = B[o + 2]; b.pos.y = B[o + 3]; b.pos.z = B[o + 4]; b.vel.x = B[o + 5]; b.vel.y = B[o + 6]; b.vel.z = B[o + 7]; b.r = B[o + 8]; b.bounced = B[o + 9] === 1;
      list.push(b); seen.set(id, b);
    }
    g.bullets = list; this.shots = seen;
    // think: each of this thread's bots, with the time since its last think
    const mine = m.mine, out = new Float64Array(mine.length * OUT);
    let k = 0;
    for (const s of mine) {
      const p = S[s]; if (!p || !p.alive || p.reviving) continue;
      p._reload = false;
      botThink(g, p, m.dt);
      const i = p.input, a = i.aim, ap = i.aimPoint, o = k * OUT; k++;
      out[o] = s; out[o + 1] = i.mx; out[o + 2] = i.mz; out[o + 3] = i.jump ? 1 : 0; out[o + 4] = i.shoot ? 1 : 0; out[o + 5] = i.block ? 1 : 0; out[o + 6] = i.blockSeq | 0;
      if (a) { out[o + 7] = 1; out[o + 8] = a.x; out[o + 9] = a.y; out[o + 10] = a.z; }
      if (ap) { out[o + 11] = 1; out[o + 12] = ap.x; out[o + 13] = ap.y; out[o + 14] = ap.z; }
      out[o + 15] = p._reload ? 1 : 0;
    }
    return { t: 'out', tok: m.tok, n: k, a: out.subarray(0, k * OUT), ms: performance.now() - t0 };
  }
  handle(m) {
    switch (m.t) {
      case 'init': this.init(m); return null;
      case 'round': this.round(m.B); return null;
      case 'frame': return this.frame(m);
      case 'end': this.g = null; this.tok = 0; return null;
    }
    return null;
  }
}

// barricades as plain data for a brain's copy (their solids and what the bots' checks read)
const wallsOf = g => g.barricades.map(b => ({ kind: b.kind, owner: b.owner, ownerId: b.ownerId, x: b.x, z: b.z, y0: b.y0, hp: b.hp, solids: b.solids.map(s => ({ min: { ...s.min }, max: { ...s.max }, wall: !!s.wall, barricade: true, noPlayer: !!s.noPlayer, oneWay: !!s.oneWay })) }));

export class BrainSet {
  // n: brain threads; mk: makes one (null: run them here, for tests)
  constructor(n, settings, cards, mk) {
    this.slots = []; this.tok = 0; this.got = []; this.active = false; this.stat = { ms: [], n: [] };
    this.slotOf = new Map(); this.rv = new Map();
    for (let i = 0; i < n; i++) {
      const s = { i, inFlight: 0, acc: 0, w: null, local: null };
      if (mk) { try { s.w = mk(); s.w.onmessage = e => this.got.push([s, e.data]); s.w.onerror = e => { if (e && e.preventDefault) e.preventDefault(); this.lost(s); }; } catch { s.w = null; } }
      if (!s.w) s.local = new BrainSim();
      this.slots.push(s);
      this.post(s, { t: 'init', settings, cards });
    }
    this.settings = settings; this.cards = cards;
  }
  get size() { return this.slots.length; }
  get threads() { return this.slots.filter(s => s.w).length; }
  post(s, m, tr) {
    if (s.w) { s.w.postMessage(m, tr || []); return; }
    const r = s.local.handle(m); if (r) this.got.push([s, r]);
  }
  lost(s) {
    console.warn('bot brain thread lost: its bots think here again');
    try { s.w.terminate(); } catch { /* gone */ }
    this.slots = this.slots.filter(x => x !== s);
    if (!this.slots.length) this.active = false;
  }
  // a new round (or the first frame that wants brains): the world from scratch
  start(g) {
    this.tok = (this.tok + 1) | 0 || 1; this.slotOf.clear(); this.rv.clear(); this.got = [];
    this.order = [];
    const add = [];
    for (const p of g.players) { const s = this.order.length; this.order.push(p); this.slotOf.set(p, s); this.rv.set(p, p._rv | 0); add.push([s, g.exportHero(p)]); }
    this.solids = g.solids; this.walls = g.barricades;
    const B = { tok: this.tok, round: g.round, rmod: g.rmod, time: g.time, phase: g.phase, fly: g.flyHeight, level: g.levelForNet(), add, bar: wallsOf(g) };
    for (const s of this.slots) { s.inFlight = 0; s.acc = 0; s.pAdd = s.pDel = s.pBar = null; this.post(s, { t: 'round', B }); }
    this.active = true; this.level = g.level;
  }
  stop(g) {
    if (!this.active) return;
    this.active = false; this.tok = 0;
    for (const p of g.players) p._brain = false;
    for (const s of this.slots) this.post(s, { t: 'end' });
  }
  // the buttons that came back: pressed now (a frame after the frame they were worked out from)
  take(g) {
    const got = this.got; this.got = [];
    for (const [s, m] of got) {
      if (m.t !== 'out') continue;
      if (s.w) s.inFlight = Math.max(0, s.inFlight - 1);
      if (m.tok !== this.tok || m.stale || !this.active) continue;
      this.stat.ms[s.i] = m.ms; this.stat.n[s.i] = m.n;
      const A = m.a;
      for (let o = 0; o < A.length; o += OUT) {
        const p = this.order[A[o]]; if (!p || !p._brain || !p.alive) continue;
        const i = p.input;
        i.mx = A[o + 1]; i.mz = A[o + 2]; i.jump = A[o + 3] === 1; i.shoot = A[o + 4] === 1; i.block = A[o + 5] === 1; i.blockSeq = A[o + 6];
        if (A[o + 7] === 1) i.aim = { x: A[o + 8], y: A[o + 9], z: A[o + 10] };
        if (A[o + 11] === 1) i.aimPoint = { x: A[o + 12], y: A[o + 13], z: A[o + 14] };
        if (A[o + 15] === 1) g.startReload(p);
      }
    }
  }
  // after the match's steps: what changed, where everyone is, and which bots each brain thinks for
  frame(g, dt) {
    if (!this.active) return;
    if (g.level !== this.level) { this.start(g); }
    // fighters who came or went, or whose build changed (recompute bumps p._rv)
    const add = [], del = [], live = new Set(g.players);
    for (const p of g.players) {
      let s = this.slotOf.get(p);
      if (s === undefined) { s = this.order.length; this.order.push(p); this.slotOf.set(p, s); this.rv.set(p, p._rv | 0); add.push([s, g.exportHero(p)]); }
      else if ((p._rv | 0) !== this.rv.get(p)) { this.rv.set(p, p._rv | 0); add.push([s, g.exportHero(p)]); }
    }
    for (const [p, s] of this.slotOf) if (!live.has(p)) { del.push(s); this.slotOf.delete(p); this.rv.delete(p); this.order[s] = null; }
    const bar = g.solids !== this.solids || g.barricades !== this.walls ? wallsOf(g) : null;
    this.solids = g.solids; this.walls = g.barricades;
    // the packed frame
    const O = this.order, rows = new Float64Array(O.length * ROW);
    for (let s = 0; s < O.length; s++) if (O[s]) packRow(rows, s * ROW, O[s]);
    const dyn = new Float64Array(g.dyn.length * 3);
    for (let i = 0; i < g.dyn.length; i++) { const o = g.dyn[i]; dyn[i * 3] = o.pos.x; dyn[i * 3 + 1] = o.pos.y; dyn[i * 3 + 2] = o.pos.z; }
    let nb = 0; for (const b of g.bullets) if (b.alive) nb++;
    const shots = new Float64Array(nb * BROW);
    let o = 0;
    for (const b of g.bullets) {
      if (!b.alive) continue;
      const os = b.ownerRef ? this.slotOf.get(b.ownerRef) : undefined;
      shots[o] = b.id; shots[o + 1] = os === undefined ? -1 : os; shots[o + 2] = b.pos.x; shots[o + 3] = b.pos.y; shots[o + 4] = b.pos.z;
      shots[o + 5] = b.vel.x; shots[o + 6] = b.vel.y; shots[o + 7] = b.vel.z; shots[o + 8] = b.r || 0; shots[o + 9] = b.bounced ? 1 : 0; o += BROW;
    }
    // who thinks where: each brain bot to one thread by its slot (they stay put)
    const n = this.slots.length, mine = Array.from({ length: n }, () => []);
    for (const p of g.players) { if (!p._brain) continue; const s = this.slotOf.get(p); mine[s % n].push(s); }
    this.slots.forEach((sl, j) => {
      // what changed waits for the thread's next frame if it skips this one
      if (add.length) (sl.pAdd ||= []).push(...add);
      if (del.length) (sl.pDel ||= []).push(...del);
      if (bar) sl.pBar = bar;
      // (a thread still busy with two frames gets this one's time with its next; its bots keep their last buttons)
      if (sl.w && sl.inFlight >= 2) { sl.acc += dt; return; }
      const m = { t: 'frame', tok: this.tok, time: g.time, phase: g.phase, dt: Math.min(0.25, dt + sl.acc), rows, dyn, shots, mine: Int32Array.from(mine[j]), add: sl.pAdd || null, del: sl.pDel || null, bar: sl.pBar || null };
      sl.acc = 0; sl.pAdd = sl.pDel = sl.pBar = null; if (sl.w) sl.inFlight++;
      this.post(sl, m);
    });
  }
  close() { for (const s of this.slots) if (s.w) { try { s.w.terminate(); } catch { /* gone */ } } this.slots = []; this.active = false; }
}
