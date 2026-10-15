// v30: multiplayer connection health. Measures ping (round trip to the host), jitter (how unevenly the host's
// updates arrive) and loss (pings that never came back, skipped updates, and stalls), shows a live ping readout,
// a warning line when something is off, and a per-player window (bound key, N by default).
//
// v1.2.3: on Steam, snapshots travel unreliably, so loss is measured directly: snapshot numbers that never
// arrived (netcodec.js AckDecoder.lossPct) plus lost pings. Hitches (an update over STALL_MS late, e.g. the host's
// frame rate dipping) are counted separately and no longer reported as packet loss.
export const NET = {
  pingEvery: 1000,     // ms between pings
  pingLost: 2500,      // a ping not answered in this long counts as lost
  snapMs: 1000 / 30,   // the host's update interval
  stallMs: 250,        // an update this late = a hitch (probably a resend after a lost packet)
  warnPing: 150, badPing: 250, warnJitter: 20, warnLoss: 2,
};
const now = () => performance.now();
// v1.2.9: how many times something happened per second, over the last 2 s (frames, sim steps, snapshots sent / received)
export class RateMeter {
  constructor(win = 2000) { this.win = win; this.t = []; }
  tick(t = now()) { this.t.push(t); if (this.t.length > 600 || t - this.t[0] > this.win * 2) this.t.splice(0, this.t.findIndex(x => t - x <= this.win) >>> 0); }
  hz(t = now()) { let n = 0; for (let i = this.t.length - 1; i >= 0 && t - this.t[i] <= this.win; i--) n++; return n * 1000 / this.win; }
}

// v1.2.9: hitch readouts for the network window: the worst value over the last ~5 s (1 s buckets) and what came with it
export class Worst {
  constructor(win = 5000) { this.win = win; this.b = []; }
  add(v, info, t = now()) {
    const b = this.b; let k = b[b.length - 1];
    if (!k || t - k.t >= 1000) { b.push(k = { t, v: -1, info: null }); if (b.length > this.win / 1000 + 1) b.shift(); }
    if (v > k.v) { k.v = v; k.info = info; }
  }
  get(t = now()) { let w = null; for (const k of this.b) if (t - k.t < this.win + 1000 && k.v >= 0 && (!w || k.v > w.v)) w = k; return w; }
}
// sizes (bytes) seen over the last 5 s: p95 and max
export class SizeWin {
  constructor(win = 5000) { this.win = win; this.a = []; }
  add(v, t = now()) { this.a.push([t, v]); if (this.a.length > 400 || t - this.a[0][0] > this.win) this.a.splice(0, this.a.findIndex(x => t - x[0] <= this.win) >>> 0); }
  stats(t = now()) { const v = this.a.filter(x => t - x[0] <= this.win).map(x => x[1]).sort((x, y) => x - y); return v.length ? { p95: v[Math.floor(v.length * 0.95)], max: v[v.length - 1], n: v.length } : null; }
}

// Peer side: what this client sees of its own connection to the host.
export class PeerNetStats {
  constructor(send) {
    this.send = send; this.n = 0; this.pending = new Map(); this.rtts = []; this.sent = []; this.lastPing = 0;
    this.lastSnap = 0; this.iv = []; this.stalls = []; this.gaps = 0; this.rtt = null; this.jitter = 0; this.loss = 0; this.started = now();
    this.snapRate = new RateMeter(); this.corr = []; this.hostRates = null;   // v1.2.9: network window details
    this.gapW = new Worst(); this.sizeW = new SizeWin();   // v1.2.9: longest wait between updates, update sizes (hitch readout)
  }
  // v1.2.9: how far your own predicted position had to be corrected when a snapshot came in (m), last 5 s
  onCorr(d) { const t = now(); this.corr.push([t, d]); while (this.corr.length && t - this.corr[0][0] > 5000) this.corr.shift(); }
  corrStats() { const c = this.corr; if (!c.length) return null; let s = 0, m = 0; for (const [, d] of c) { s += d; if (d > m) m = d; } return { avg: s / c.length, max: m, n: c.length }; }
  onSnap(lossPct) {
    const t = now();
    if (this.lastSnap) {
      const d = t - this.lastSnap;
      this.iv.push(d); if (this.iv.length > 90) this.iv.shift(); this.gapW.add(d, null, t);
      if (d > NET.stallMs) this.stalls.push(t);
    }
    this.lastSnap = t; this.snapLoss = lossPct || 0; this.snapRate.tick(t);
  }
  onPong(m) {
    const sent = this.pending.get(m.n); if (sent == null) return;
    this.pending.delete(m.n);
    this.rtts.push(now() - sent); if (this.rtts.length > 10) this.rtts.shift();
  }
  tick() {
    const t = now();
    for (const [n, at] of this.pending) if (t - at > NET.pingLost) { this.pending.delete(n); this.sent.push([t, 1]); }
    if (t - this.lastPing >= NET.pingEvery) {
      this.lastPing = t; this.n++;
      this.pending.set(this.n, t); this.sent.push([t, 0]);
      this.compute();
      this.send({ k: 'ping', n: this.n, st: [this.rtt == null ? -1 : Math.round(this.rtt), Math.round(this.jitter), Math.round(this.loss * 10) / 10, this.stalled() ? 1 : 0] });
    }
    while (this.sent.length && t - this.sent[0][0] > 30000) this.sent.shift();
    while (this.stalls.length && t - this.stalls[0] > 10000) this.stalls.shift();
  }
  compute() {
    // ping: the median of the last few round trips (one slow reply doesn't jump the number)
    if (this.rtts.length) { const r = this.rtts.slice().sort((a, b) => a - b); this.rtt = r[r.length >> 1]; }
    // jitter: how far each update interval strays from the average one (a slow but steady host isn't jitter)
    if (this.iv.length > 5) { const m = this.iv.reduce((a, d) => a + d, 0) / this.iv.length; this.jitter = this.iv.reduce((a, d) => a + Math.abs(d - m), 0) / this.iv.length; }
    // loss: the larger of lost pings and snapshots that never arrived (last 10-30 s)
    const sent = this.sent.length, lost = this.sent.filter(x => x[1]).length;
    const pingLoss = sent ? lost / sent * 100 : 0;
    this.loss = Math.min(100, Math.max(pingLoss, this.snapLoss || 0));
    this.hitches = this.stalls.length;   // updates over STALL_MS late in the last 10 s
  }
  stalled() { return this.lastSnap > 0 && now() - this.lastSnap > 1000; }
  // The warning line under the ping readout (empty when the connection is fine).
  warning() {
    if (this.stalled()) return { level: 2, text: `Connection stalled: no updates from the host for ${((now() - this.lastSnap) / 1000).toFixed(1)} s` };
    if (this.loss >= NET.warnLoss) return { level: this.loss >= 8 ? 2 : 1, text: `Possible packet loss (${this.loss.toFixed(1)}%): expect stutters` };
    if (this.rtt != null && this.rtt >= NET.warnPing) return { level: this.rtt >= NET.badPing ? 2 : 1, text: `High ping (${Math.round(this.rtt)} ms): shots may land late` };
    // v1.2.9: a host drawing few frames sends few updates: everything looks choppy however good the connection is
    const hr = this.hostRates; if (hr && now() - this.started > 5000 && hr[2] > 0 && hr[2] < 22) return { level: hr[2] < 15 ? 2 : 1, text: `Host is slow: ${Math.round(hr[2])} updates/s (host at ${Math.round(hr[0])} FPS)` };
    if (this.hitches >= 3) return { level: 1, text: `Hitching: ${this.hitches} late updates in 10 s (host busy or connection spiking)` };
    if (this.jitter >= NET.warnJitter) return { level: 1, text: `Unstable connection (jitter ${Math.round(this.jitter)} ms)` };
    return null;
  }
}

// Host side: each peer's own report (sent with its pings) plus how steadily its inputs arrive.
export class HostNetStats {
  constructor() { this.peers = new Map(); }
  onPing(id, m, reply) {
    reply({ k: 'pong', n: m.n });
    const st = Array.isArray(m.st) ? m.st : [];
    const e = this.peers.get(id) || { lastInput: 0 };
    Object.assign(e, { rtt: +st[0], jitter: +st[1] || 0, loss: +st[2] || 0, stalled: !!st[3], at: now() });
    this.peers.set(id, e);
  }
  onInput(id) { const e = this.peers.get(id) || {}; e.lastInput = now(); this.peers.set(id, e); }
  remove(id) { this.peers.delete(id); }
  // [id, ping (-1 unknown), jitter, loss %, flags (1 = no input for a while, 2 = no report for a while)]
  rows() {
    const t = now(), out = [];
    for (const [id, e] of this.peers) out.push([id, e.rtt == null ? -1 : e.rtt, e.jitter || 0, e.loss || 0, (e.lastInput && t - e.lastInput > 600 ? 1 : 0) | (e.at && t - e.at > 3500 ? 2 : 0)]);
    return out;
  }
  worst(nameOf) {
    let w = null;
    for (const [id, rtt, jit, loss, fl] of this.rows()) {
      const sc = (fl ? 3 : 0) + (loss >= NET.warnLoss ? 2 : 0) + (rtt >= NET.warnPing ? 1 : 0) + (jit >= NET.warnJitter ? 0.5 : 0);
      if (sc > 0 && (!w || sc > w.sc)) w = { sc, text: `${nameOf(id)}: ${fl ? 'connection stalled' : loss >= NET.warnLoss ? `possible packet loss (${loss}%)` : rtt >= NET.warnPing ? `high ping (${rtt} ms)` : `unstable (jitter ${jit} ms)`}`, level: fl || loss >= 8 || rtt >= NET.badPing ? 2 : 1 };
    }
    return w;
  }
}

export const pingClass = ms => ms == null || ms < 0 ? 'unk' : ms < 80 ? 'good' : ms < NET.warnPing ? 'ok' : 'bad';

// Testing aid: simulate a bad connection on this client (incoming messages only).
// blockshot.netSim = { lag: 120, jitter: 40, loss: 3 }   (loss %: what Steam sends unreliably (snapshots, inputs, AMON
// fields, anything sent toPeerU / toHostU; net.js) is dropped; other messages are held back like a reliable resend)
export function netSimDelay(sim, lastRelease, unreliable) {
  const t = now();
  if (unreliable) return sim.loss && Math.random() * 100 < sim.loss ? -1 : t + (sim.lag || 0) + Math.random() * (sim.jitter || 0);
  let at = t + (sim.lag || 0) + Math.random() * (sim.jitter || 0);
  if (sim.loss && Math.random() * 100 < sim.loss) at += 200 + (sim.lag || 0) * 2;   // a resend: the next RTO later
  return Math.max(at, lastRelease);   // keep order, like the real transports
}
