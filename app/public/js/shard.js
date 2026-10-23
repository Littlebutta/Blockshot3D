// =====================================================================
// v1.2.37 (Devin: 6000 bots drew at 144 fps but the match itself crawled, moving in bursts): a big tournament's arenas
// run on every CPU core. An arena never touches another (tourn.js), so each round the host's match (hostsim.js) hands
// them out to shards: a Game of their own on another thread (shardworker.js), plus one run on the match's own thread.
// Each shard runs its arenas' fighters, bots, shots and props for the round and reports back every frame: its events,
// the arenas that finished, its units, and the rows for the arenas someone is looking at. The host's match keeps the
// clock, the round's flow, picks, lives and the table, and builds each screen's view and snapshot from those rows.
// A shard's results reach the match one frame later (it works while the match answers the page).
//   ShardSim: one shard (inside shardworker.js, or the match's own one)
//   ShardSet: the host's match's side: hands out arenas, passes on inputs, gathers results
// =====================================================================
import { Game } from './sim.js';
import { TOURN_FLOW } from './tourn.js';
import { arenaView, viewOfPlayer } from './hostsim.js';

// shard events the match passes on as they are (the round's own flow comes from the match: count, fight, overtime...)
const PASS = new Set(['tMove', 'split']);
// events every screen gets whatever arena it shows (hostsim.js TOURN_ALL, less the flow)
// v1.2.38: the most game time one shard frame may run (2 frames at 60 fps)
const CATCH_UP = 1 / 30;
const ALL = new Set(['respawn', 'revive', 'revived', 'reviving', 'reviveStart', 'rewind', 'modBroken', 'cloneInherit']);

export class ShardSim {
  constructor() { this.g = null; this.tok = 0; this.inq = new Map(); }
  init(m) { this.settings = m.settings; this.cards = m.cards; this.idx = m.idx; }
  // a new round: these heroes in these arenas (ShardSet.startRound)
  round(B) {
    if (!this.g) {
      this.g = new Game({ roster: [], settings: this.settings, cards: this.cards });
      this.g.nextUnit = B.unitBase; this.g.nextId = B.idBase;   // (ids nobody else hands out: a joiner may see several shards' arenas)
    }
    this.tok = B.tok; this.inq.clear();
    this.g.shardRound({ ...B, unitBase: this.g.nextUnit, idBase: this.g.nextId });
    this.reported = new Set();
  }
  end() { this.tok = 0; if (this.g) { this.g.players = []; this.g.tArenas = []; this.g.bullets = []; this.g.dyn = []; this.g.events = []; } }
  cmd(c) {
    const g = this.g; if (!g || !this.tok) return;
    if (c.t === 'leave') g.removePlayer(c.id);
    else if (c.t === 'setting') g.settings[c.k] = c.v;
  }
  // one frame: c = { tok, dt, ts, paused, t0, ph, pt, hostFps, inputs: [[release, id, input]], va, sa: [arenas], ids: [ids], wa: [watched arenas] }
  frame(c) {
    const g = this.g, t0 = performance.now();
    if (!g || c.tok !== this.tok) return { t: 'out', tok: c.tok, stale: 1 };
    g.hostFps = c.hostFps;
    // the match's clock leads: its countdown (and the matchup screen) and when the round ends
    if (g.phase === 'countdown' && c.ph === 'countdown') g.phaseT = c.pt;
    else if (g.phase === 'countdown' && c.ph !== 'countdown') { g.phase = 'play'; g.fightAt = g.time; g.fightSent = true; }
    if (c.ph === 'roundEnd' && g.phase === 'play') g.phase = 'roundEnd';
    // joiners' inputs: held back by the match (hostsim.js queueInput) until their release time, in input order per player
    for (const [r, id, i] of c.inputs) {
      let Q = this.inq.get(id); if (!Q) this.inq.set(id, Q = []);
      let k = Q.length; while (k > 0 && i.q != null && Q[k - 1][1].q > i.q) k--; Q.splice(k, 0, [r, i]);
    }
    const rel = w => { for (const [id, Q] of this.inq) while (Q.length && Q[0][0] <= w) g.setInput(id, Q.shift()[1]); };
    let w = c.t0 - c.dt * 1000;
    if (!c.paused) for (let rem = c.dt * c.ts; rem > 1e-4;) { const st = Math.min(rem, 0.035); rel(w + st / c.ts * 500); w += st / c.ts * 1000; g.step(st); rem -= st; }
    else rel(c.t0);
    // events: the ones for arenas someone watches (and the few every screen gets); the round's flow is the match's
    const wa = new Set(c.wa), ev = [];
    let units = false;
    for (const e of g.takeEvents()) {
      if (e.t === 'units') { units = true; continue; }
      if (TOURN_FLOW.has(e.t) && !PASS.has(e.t)) continue;
      if (e.ar != null && !wa.has(e.ar) && !ALL.has(e.t)) continue;
      ev.push(e);
    }
    const done = [];
    g.tArenas.forEach((A, a) => { if (A.done && !this.reported.has(a)) { this.reported.add(a); done.push([a, A.winner]); } });
    // rows: the host's view of its arena (va), snapshot parts for joiners' arenas (sa), single fighters riding along (ids)
    const rows = [];
    for (const a of new Set([...(c.va != null ? [c.va] : []), ...c.sa])) {
      if (!g.tArenas[a]) continue;
      const sc = { ps: g.pool({ arena: a }), a };
      rows.push([a, a === c.va ? arenaView(g, sc) : null, c.sa.includes(a) ? g.snapshotArena(sc) : null]);
    }
    const ids = [];
    for (const id of c.ids) { const p = g.player(id); if (p) ids.push([id, viewOfPlayer(g, p), g.snapRow(p), g.predRows([p])]); }
    return { t: 'out', tok: c.tok, ev, done, units: units ? g.unitList() : undefined, rows, ids, ms: performance.now() - t0, n: g.players.length, b: g.bullets.length, tm: g.time, al: g.players.reduce((k, p) => k + (p.alive ? 1 : 0), 0), ph: g.phase };
  }
  // the round is over: what the match keeps of each hero (their tally, and where and how they ended up for the screens)
  final(tok) {
    const g = this.g; if (!g || tok !== this.tok) return { t: 'final', tok, list: [] };
    return { t: 'final', tok, list: g.players.filter(p => p.kind === 'hero').map(p => [p.id, p.tally, p.alive, p.hp, p.pos, p.vel, p.arena]) };
  }
  handle(m) {
    switch (m.t) {
      case 'init': this.init(m); return null;
      case 'round': this.round(m.B); return null;
      case 'frame': return this.frame(m);
      case 'cmd': this.cmd(m.c); return null;
      case 'final': return this.final(m.tok);
      case 'end': this.end(); return null;
    }
    return null;
  }
}

export class ShardSet {
  // n: shards in all (n - 1 on threads of their own, one here); makeWorker: () => Worker (none: every shard runs here)
  constructor(n, settings, cards, makeWorker) {
    this.slots = []; this.tok = 0; this.of = new Map(); this.got = []; this.rows = new Map(); this.idRows = new Map(); this.units = new Map();
    this.stat = { ms: [], n: [], tm: [], b: [], al: [], ph: [] }; this.settings = settings; this.cards = cards;
    for (let i = 0; i < n; i++) {
      const s = { i, inFlight: 0, acc: 0, inq: [], w: null, local: null, weight: 1 };
      if (i > 0 && makeWorker) {
        try { s.w = makeWorker(); s.w.onmessage = e => this.onOut(s, e.data); s.w.onerror = e => { if (e && e.preventDefault) e.preventDefault(); this.lost(s, (e && e.message) || 'shard stopped'); }; } catch { s.w = null; }
      }
      if (!s.w) { s.local = new ShardSim(); s.weight = i === 0 && n > 1 ? +(globalThis.SHARD_W0 ?? (n > 4 ? 0.2 : 0.35)) : 1; }   // (the match's own one gets a smaller share: its thread also builds the views and snapshots, and the page waits on those)
      this.slots.push(s);
      this.post(s, { t: 'init', settings, cards, idx: i });
    }
  }
  get size() { return this.slots.length; }
  get threads() { return this.slots.filter(s => s.w).length; }
  post(s, m) {
    if (s.w) { s.w.postMessage(m); return; }
    const r = s.local.handle(m); if (r) this.got.push([s, r]);   // (answered at once, read with the next frame like the rest)
  }
  onOut(s, m) { this.got.push([s, m]); }
  // a shard's thread died: its arenas go on here
  lost(s, why) {
    console.warn('arena shard lost:', why);
    try { s.w.terminate(); } catch { /* gone */ }
    s.w = null; s.local = new ShardSim(); s.inFlight = 0;
    this.post(s, { t: 'init', settings: this.settings, cards: this.cards, idx: s.i });
    if (this.lastB && this.lastB.get(s)) this.post(s, { t: 'round', B: this.lastB.get(s) });   // (the round starts over for those arenas)
  }
  // the round's arenas, shared out by how many fighters they have
  startRound(g) {
    const tok = this.tok = (this.tok + 1) | 0 || 1;
    this.of.clear(); this.rows.clear(); this.idRows.clear(); this.units.clear(); this.got = []; this.finals = null;
    const arenas = g.tArenas.map((A, a) => [a, A.ids.filter(id => { const p = g.player(id); return p && p.connected && !p.tko; })]);
    const total = arenas.reduce((t, [, ids]) => t + ids.length, 0), W = this.slots.reduce((t, s) => t + s.weight, 0);
    const share = this.slots.map(() => []);
    let k = 0, acc = 0, lim = total * this.slots[0].weight / W;
    for (const A of arenas) {
      while (k < this.slots.length - 1 && acc >= lim) { k++; lim += total * this.slots[k].weight / W; }
      share[k].push(A); acc += A[1].length;
    }
    const level = g.levelForNet(), crowdN = g.players.length;
    this.lastB = new Map();
    this.slots.forEach((s, i) => {
      s.inFlight = 0; s.acc = 0; s.inq = [];
      const heroes = [];
      for (const [a, ids] of share[i]) for (const id of ids) { const p = g.player(id); this.of.set(id, s); heroes.push(g.exportHero(p)); }
      const B = { tok, round: g.round, rmod: g.rmod, level, fly: g.flyHeight, tSpots: g.tSpots, arenas: share[i], heroes, crowdN, phase: g.phase, phaseT: g.phaseT, time: g.time,
        unitBase: (i + 1) * 1e7, idBase: (i + 1) * 1e8 };
      this.lastB.set(s, B);
      this.post(s, { t: 'round', B });
    });
    this.arenaSlot = new Map(); share.forEach((L, i) => { for (const [a] of L) this.arenaSlot.set(a, this.slots[i]); });
  }
  end() { if (!this.tok) return; this.tok = 0; this.of.clear(); this.arenaSlot = null; for (const s of this.slots) this.post(s, { t: 'end' }); }
  // a joiner's (or the host's) input for a fighter in a shard: r = when to apply it (page clock; 0 = now)
  input(id, r, i) { const s = this.of.get(id); if (s) s.inq.push([r, id, i]); }
  cmd(id, c) { const s = id != null ? this.of.get(id) : null; if (id != null && !s) return; for (const x of s ? [s] : this.slots) this.post(x, { t: 'cmd', c }); }
  // one frame for every shard. want: { va: the host's arena, sa: joiners' arenas, ids, wa: every watched arena }
  frame(c, want) {
    if (!this.tok) return;
    const bySlot = new Map();
    const pick = a => this.arenaSlot && this.arenaSlot.get(a);
    for (const a of want.sa) { const s = pick(a); if (s) { let o = bySlot.get(s); if (!o) bySlot.set(s, o = { sa: [], ids: [] }); o.sa.push(a); } }
    for (const id of want.ids) { const s = this.of.get(id); if (s) { let o = bySlot.get(s); if (!o) bySlot.set(s, o = { sa: [], ids: [] }); o.ids.push(id); } }
    const vs = want.va != null ? pick(want.va) : null;
    for (const s of [...this.slots.filter(x => x.w), ...this.slots.filter(x => !x.w)]) {   // (threads first: they start while the ones here run)
      // (a shard still busy with two frames gets this one's time with its next. v1.2.38: at most CATCH_UP of it: a shard
      // that can't keep up runs its arenas a bit slower but smoothly, instead of jumping ahead in big steps that make
      // its next frame slower still)
      if (s.w && s.inFlight >= 2) { s.acc += c.dt; continue; }
      const o = bySlot.get(s) || { sa: [], ids: [] }, dt = Math.min(CATCH_UP, c.dt + s.acc);
      s.acc = 0; if (s.w) s.inFlight++;
      const inputs = s.inq; s.inq = [];
      this.post(s, { t: 'frame', tok: this.tok, dt, ts: c.ts, paused: c.paused, t0: c.t0, ph: c.ph, pt: c.pt, hostFps: c.hostFps, inputs, va: s === vs ? want.va : null, sa: o.sa, ids: o.ids, wa: want.wa });
    }
  }
  // what came back since the last frame: events, finished arenas, unit lists changed (rows are kept: latest)
  take() {
    const ev = [], done = []; let unitsChanged = false, finals = null;
    const got = this.got; this.got = [];
    for (const [s, m] of got) {
      if (m.t === 'final') { if (m.tok === this.finTok) { (this.finals ||= new Map()).set(s, m.list); finals = this.finals; } continue; }
      if (m.t !== 'out') continue;
      if (s.w) s.inFlight = Math.max(0, s.inFlight - 1);
      if (m.tok !== this.tok || m.stale) continue;
      for (const e of m.ev) ev.push(e);
      for (const d of m.done) done.push(d);
      if (m.units) { this.units.set(s.i, m.units); unitsChanged = true; }
      for (const [a, v, sn] of m.rows) { const r = this.rows.get(a) || {}; if (v) r.v = v; if (sn) r.s = sn; this.rows.set(a, r); }
      for (const [id, v, sr, mv] of m.ids) this.idRows.set(id, { v, s: sr, mv });
      this.stat.ms[s.i] = m.ms; this.stat.n[s.i] = m.n; this.stat.tm[s.i] = m.tm; this.stat.b[s.i] = m.b; this.stat.al[s.i] = m.al; this.stat.ph[s.i] = m.ph;
    }
    return { ev, done, unitsChanged, finals };
  }
  // the round ended: ask every shard for its heroes' tallies (finalsIn: all answered)
  askFinals() { this.finTok = this.tok; this.finals = new Map(); for (const s of this.slots) this.post(s, { t: 'final', tok: this.tok }); this.finAt = performance.now(); }
  get finalsIn() { return !this.finals || this.finals.size >= this.slots.length || performance.now() - this.finAt > 3000; }
  close() { for (const s of this.slots) if (s.w) { try { s.w.terminate(); } catch { /* gone */ } } this.slots = []; }
}
