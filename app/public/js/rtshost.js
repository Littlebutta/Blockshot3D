// =====================================================================
// v1.2.30: the host side of the RTS: step RtsGame (rts.js), publish the player list, and send every joiner what
// its team sees (deltas through its own AckEncoder stream). This used to live in rtsui.js on the drawing thread;
// an 8 player game took 8 ms a tick there, with 40-75 ms spikes that showed up as hitches.
//
// Two drivers with the same face (what rtsui.js RtsClient and main.js use):
//   RtsLocal  - the game on this thread (1 CPU thread allowed, no workers, or the thread failed to start)
//   RtsThread - the game on its own thread (rtsworker.js); its flow fields on the remaining threads (rtsnav.js)
// makeRtsHost picks one from the CPU threads allowed (threads.js).
// =====================================================================
import { RTS } from './rtsdata.js';
import { RtsGame } from './rts.js';
import { AckEncoder } from './netcodec.js';

let streamId = 0;
export const nextStream = () => (streamId = Math.max(streamId + 1, Math.floor(Date.now() / 100)));

// The host loop. out: { pub(s), view(v, ev), send(netMsg) }; io: { rtt: { id: ms }, backlog: bytes } (from the page)
export class RtsHost {
  constructor(game, localId, out, net) {
    this.g = game; this.localId = localId; this.out = out; this.net = net;
    this.peerSeq = new Map(); this.sendT = 0; this.pubT = 0; this.sendN = 0; this.pendEv = []; this.viewed = false;
    this.io = { rtt: {}, backlog: 0 };
    game.onAck = (from, a) => this.onAck(from, a);
    out.pub(game.publicState());
  }
  rttOf(id) { return this.io.rtt[id] || 0; }
  tick(dt, paused) {
    const g = this.g, tk = g.tickN;
    if (!paused) g.step(dt);
    const evs = g.takeEvents();
    if (evs.length) { this.pendEv.push(...evs); if (this.peerSeq.size) for (const k of this.peerSeq.values()) k.ev.push(...evs); }
    this.pubT -= dt;
    if (g.dirty || this.pubT <= 0) {
      g.dirty = false; this.pubT = 1;
      const s = g.publicState();
      this.out.pub(s);
      if (this.net) this.out.send({ t: 'toAll', msg: { k: 'rpub', s } });
    }
    if (g.tickN !== tk || !this.viewed) {   // the host's own view: every tick
      this.viewed = true;
      const v = g.viewFor(this.localId), ev = g.eventsFor(this.localId, this.pendEv);
      this.pendEv = [];
      this.out.view(v, ev);
    }
    if (this.net) {
      this.sendT -= dt;
      if (this.sendT <= 0) { this.sendT = Math.max(0, this.sendT + RTS.send); this.sendN++; this.sendViews(g); }
    }
  }
  // each joiner gets its own stream (what its team sees), deltas against the last update it confirmed (netcodec AckEncoder)
  sendViews(g) {
    if (this.io.backlog > 256 * 1024) return;
    for (const p of g.players) {
      if (p.id === this.localId || (p.isBot && !p.wasHuman) || !p.connected) { if (!p.connected) this.peerSeq.delete(p.id); continue; }
      if (p.wasHuman) continue;
      let k = this.peerSeq.get(p.id);
      if (!k) this.peerSeq.set(p.id, k = { enc: new AckEncoder(), ack: 0, ek: 0, since: 0, ev: [] });
      if (!k.enc.e0) { k.enc.e = nextStream(); k.enc.e0 = 1; }
      const r = this.rttOf(p.id), thin = r > 400 ? 3 : r > 220 ? 2 : 1;
      if (this.sendN % thin) continue;
      const v = g.viewFor(p.id), ev = g.eventsFor(p.id, k.ev); k.ev = [];
      const q = k.enc.push(v, ev);
      if (!k.since) k.since = q;
      const rtt = r || 150, rs = Math.min(4, Math.max(2, Math.ceil((rtt + 40) / 66)));
      const m = k.enc.encodeFor(k.ack, k.since, k.ek, rs);
      if (m) this.out.send({ t: 'toPeerU', id: p.id, msg: { k: 'rsnap', s: m } });
    }
  }
  onAck(from, a) {
    const k = this.peerSeq.get(from); if (!k) return;
    if (a.need) { this.sendMap(from); return; }
    if (!Array.isArray(a.a)) { k.ack = 0; return; }
    if (a.a[0] !== k.enc.e) return;
    if (a.a[1] > k.ack && a.a[1] <= k.enc.n) k.ack = a.a[1];
    if (a.a[2] > k.ek && a.a[2] <= k.enc.n) k.ek = a.a[2];
  }
  sendMap(to) {   // a joiner built a different map from the seed (should never happen): it gets the real one
    const M = this.g.M, b64 = arr => { let s = ''; const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
    this.out.send({ t: 'toPeer', id: to, msg: { k: 'rmap', m: { ...M, lv: b64(M.lv), h: b64(M.h), walk: b64(M.walk), ramp: b64(M.ramp) } } });
  }
  cmd(c) { applyCmd(this.g, c); }
}
// what main.js asks of the game (joins, leaves, orders)
export function applyCmd(g, c) {
  if (c.t === 'act') g.action(c.from, c.a);
  else if (c.t === 'conn') g.setConnected(c.id, c.on);
  else if (c.t === 'spec') g.addSpectator(c.r);
  else if (c.t === 'rebind') { if (!g.rebind(c.old, c.id)) g.addSpectator(c.r); }
}

// the game on this thread
export class RtsLocal {
  constructor(opts) { this.game = new RtsGame(opts); this.M = this.game.M; this.threads = 1; }
  start(localId, out, net) { this.host = new RtsHost(this.game, localId, out, net); }
  frame(dt, paused, io) { if (!this.host) return; this.host.io = io; this.game.hostFps = io.fps; this.host.tick(dt, paused); }
  cmd(c) { applyCmd(this.game, c); }
  // main.js
  action(from, a) { this.cmd({ t: 'act', from, a }); }
  setConnected(id, on) { this.cmd({ t: 'conn', id, on }); }
  addSpectator(r) { this.cmd({ t: 'spec', r }); }
  rebind(old, id) { return this.game.rebind(old, id); }
  stats() { return { threads: 1, tickMs: this.game.bud ? this.game.bud.ms : 0, fields: 0 }; }
  close() {}
}

// the game on its own thread. The page sends each frame's time and gets back the player list, its own view and
// the joiners' messages. While the thread is still busy with the last frame, frame time adds up and goes next time,
// so a slow tick never holds up drawing.
export class RtsThread {
  constructor(opts, threads, fail) {
    this.opts = opts; this.threads = threads; this.M = null; this.out = null; this.busy = false; this.acc = 0; this.q = []; this.pub = null; this.fail = fail; this.info = {};
    this.w = new Worker(new URL('./rtsworker.js', import.meta.url), { type: 'module' });
    this.w.onmessage = e => this.onMsg(e.data);
    this.w.onerror = e => this.lost((e && e.message) || 'RTS thread failed');
    this.w.postMessage({ t: 'init', opts, helpers: Math.max(0, threads - 2) });
  }
  // the thread couldn't start (or died before the game began): the game runs on this thread instead, from the same seed
  lost(why) {
    if (this.dead) return; this.dead = true; try { this.w.terminate(); } catch { /* gone */ }
    if (this.ready && this.started) { if (this.fail) this.fail(why); return; }
    const L = this.local = new RtsLocal(this.opts); this.M = L.M; this.threads = 1;
    for (const m of this.q) if (m.t === 'cmd') L.cmd(m.c);
    this.q = [];
    if (this.startArgs) L.start(...this.startArgs);
  }
  onMsg(m) {
    if (m.t === 'ready') { this.M = m.M; this.ready = true; this.flush(); return; }
    if (m.t === 'err') { this.lost(m.why); return; }
    if (m.t === 'out') {
      this.busy = false; this.info = m.info || this.info;
      if (this.out) {
        if (m.pub) { this.pub = m.pub; this.out.pub(m.pub); }
        if (m.view) this.out.view(m.view, m.ev);
        for (const s of m.send) this.out.send(s);
      }
    }
  }
  start(localId, out, net) {
    this.startArgs = [localId, out, net];
    if (this.local) return this.local.start(localId, out, net);
    this.out = out; this.started = true; this.post({ t: 'start', localId, net: !!net });
  }
  post(m) { if (this.local) return; if (this.ready) this.w.postMessage(m); else this.q.push(m); }
  flush() { for (const m of this.q) this.w.postMessage(m); this.q = []; }
  frame(dt, paused, io) {
    if (this.local) return this.local.frame(dt, paused, io);
    this.acc += dt;
    if (this.busy || !this.ready || this.dead) return;
    this.busy = true; this.w.postMessage({ t: 'frame', dt: Math.min(0.25, this.acc), paused, io }); this.acc = 0;
  }
  cmd(c) { if (this.local) this.local.cmd(c); else this.post({ t: 'cmd', c }); }
  action(from, a) { this.cmd({ t: 'act', from, a }); }
  setConnected(id, on) { this.cmd({ t: 'conn', id, on }); }
  addSpectator(r) { this.cmd({ t: 'spec', r }); }
  // (answered from the last player list; the thread checks again and seats them as a spectator if it can't)
  rebind(old, id) {
    if (this.local) return this.local.rebind(old, id);
    const pl = this.pub ? this.pub.pl : [], p = pl.find(q => q.id === old);
    if (!p || p.spec || pl.some(q => q.id === id)) return false;
    this.cmd({ t: 'rebind', old, id, r: { id, name: p.name, color: '#cccccc' } }); return true;
  }
  stats() { return this.local ? this.local.stats() : { threads: this.threads, ...this.info }; }
  close() { this.dead = true; try { this.w.terminate(); } catch { /* gone */ } }
}

export function makeRtsHost(opts, threads, onFail) {
  if (threads >= 2 && typeof Worker !== 'undefined') {
    try { return new RtsThread(opts, threads, onFail); } catch { /* fall through: this thread */ }
  }
  return new RtsLocal(opts);
}
