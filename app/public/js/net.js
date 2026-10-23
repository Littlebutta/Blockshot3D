// Thin WebSocket wrapper around the room relay in server.js.
import { netSimDelay } from './netstats.js';
const UNREL = new Set(['snap', 'input', 'afield']);
// v1.2.9: bytes / messages each way, for the network window (traffic(): per second since the last call)
class Meter {
  constructor() { this.c = [0, 0, 0, 0]; this.last = null; }
  add(i, bytes) { this.c[i] += bytes; this.c[i + 1]++; }
  rates() {
    const now = performance.now(), l = this.last || { at: now - 1000, c: [0, 0, 0, 0] }, s = Math.max(0.2, (now - l.at) / 1000), c = this.c;
    this.last = { at: now, c: c.slice() };
    return { up: (c[0] - l.c[0]) / s, upP: (c[1] - l.c[1]) / s, down: (c[2] - l.c[2]) / s, downP: (c[3] - l.c[3]) / s };
  }
}
export class Net {
  constructor() { this.ws = null; this.handlers = {}; this.meter = new Meter(); }
  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = this.ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not reach the game server. Make sure it is running (npm start).'));
      ws.onclose = () => this.fire({ t: 'close' });
      ws.onmessage = e => {
        this.meter.add(2, e.data.length || 0);
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.msg && typeof m.msg === 'object') m.msg._sz = e.data.length || 0;   // (v1.2.9: message size, network window; JSON here, not wire bytes)
        const sim = window.blockshot && window.blockshot.netSim;   // v30 testing aid (netstats.js)
        if (sim) {
          const u = !!m.msg && (!!m.msg._u || UNREL.has(m.msg.k));   // what Steam sends unreliably can be lost, not held back (v1.2.6: inputs, AMON fields, anything sent toPeerU / toHostU)
          const at = netSimDelay(sim, this.rel || 0, u); if (at < 0) return;
          if (u) { setTimeout(() => this.fire(m), at - performance.now()); return; }
          // (v1.2.38: the held-back ones go out in order from one queue: separate timers could swap two sent within a
          // millisecond of each other, so a joiner's 'setCos' beat its 'hello' and it got kicked as an old version)
          this.rel = at; (this.rq ||= []).push([at, m]);
          if (!this.rqT) { const pump = () => { this.rqT = 0; const t = performance.now(); while (this.rq.length && this.rq[0][0] <= t + 0.5) this.fire(this.rq.shift()[1]); if (this.rq.length) this.rqT = setTimeout(pump, this.rq[0][0] - t); }; this.rqT = setTimeout(pump, at - performance.now()); }
        }
        else this.fire(m);
      };
    });
  }
  fire(m) { for (const f of this.handlers[m.t] || []) f(m); }
  on(t, f) { (this.handlers[t] ||= []).push(f); return this; }
  send(o) { if (o.ids) { for (const id of o.ids) this.send({ t: o.t, id, msg: o.msg }); return; }   // (v1.2.9: one message for several players: the relay takes one at a time)
    if (this.ws && this.ws.readyState === 1) { const j = JSON.stringify(o.t === 'toPeerU' || o.t === 'toHostU' ? { ...o, msg: { ...o.msg, _u: 1 } } : o); this.meter.add(0, j.length); this.ws.send(j); } }   // (_u: lets blockshot.netSim on the other end drop it like Steam would)
  traffic() { return { ...this.meter.rates(), json: true }; }   // (uncompressed JSON through the local server)
  backlog() { return this.ws ? this.ws.bufferedAmount || 0 : 0; }   // bytes queued but not yet sent (upload falling behind)
  close() { this.handlers = {}; if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.ws = null; }
}

// Same interface as Net, but routed through Steam (desktop app only).
// Lobbies are friends-only; joining happens through Steam invites or "Join game" in the friends list.
export class SteamNet {
  constructor() { this.handlers = {}; this.off = null; this.isSteam = true; }
  static async status() {
    const b = window.steamBridge;
    if (!b) return { desktop: false, available: false };
    try { return { desktop: true, ...(await b.info()) }; } catch { return { desktop: true, available: false }; }
  }
  async connect() {
    const st = await SteamNet.status();
    if (!st.desktop) throw new Error('Steam play needs the desktop version of the game.');
    if (!st.available) throw new Error('Steam isn\'t running. Start Steam, then restart the game.');
    this.off = window.steamBridge.onEvent(m => { if (m.t === 'netStats') this.ns = m; else if (m.t !== '_invite') this.fire(m); });
  }
  fire(m) { for (const f of this.handlers[m.t] || []) f(m); }
  on(t, f) { (this.handlers[t] ||= []).push(f); return this; }
  send(o) { window.steamBridge.send(o); }
  invite() { window.steamBridge.send({ t: 'invite' }); }
  // v1.2.9: what the desktop app measured on the wire (after compression) the last time it was asked, summed over players,
  // plus Steam's per-connection state; asks again for next time (the network window calls this about once a second).
  traffic() {
    window.steamBridge.send({ t: 'netStats' });
    const ns = this.ns; if (!ns) return null;
    const sum = { up: 0, upP: 0, upM: 0, upSplit: 0, upFail: 0, down: 0, downP: 0, downSplit: 0, downLost: 0 };
    for (const p of ns.peers) for (const k in sum) sum[k] += p[k] || 0;
    return { ...sum, peers: ns.peers, tune: ns.tune };
  }
  close() { if (this.off) this.off(); this.off = null; this.handlers = {}; window.steamBridge.send({ t: 'leave' }); }
}
