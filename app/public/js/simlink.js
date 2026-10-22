// =====================================================================
// v1.2.30: where the host's match runs (hostsim.js HostSim). With 2+ CPU threads allowed (Settings > CPU threads,
// threads.js) it runs on a thread of its own (simworker.js) while the page's thread draws; with 1, or if the thread
// can't start, it runs on the page's thread as before. Same face either way:
//   cmd(c)      an order (inputs, picks, joins...); frame(c) one frame of game time; mirror: what the page may read
//   handlers:   { net(msg), ui(msg), frame(f), departed(d), fail(why) }
// On its own thread the host sees each frame's result one frame later (it comes back while the page draws). Frames are
// pipelined: up to 3 may be on their way (a result usually lands just after the next frame began); past that, frame
// time adds up and goes with the next one, so drawing never waits on the match.
// =====================================================================
import { HostSim } from './hostsim.js';

export class SimLink {
  constructor(opts, threads, handlers) {
    this.opts = opts; this.h = handlers; this.mirror = null; this.threaded = false;
    this.inFlight = 0; this.sentAt = []; this.accDt = 0; this.q = []; this.stat = { frames: 0, waitMs: 0, lastMs: 0, skipped: 0 };
    if (threads >= 2 && typeof Worker !== 'undefined') {
      try {
        this.w = new Worker(new URL('./simworker.js', import.meta.url), { type: 'module' });
        this.w.onmessage = e => this.onMsg(e.data);
        this.w.onerror = e => { e.preventDefault && e.preventDefault(); this.lost((e && e.message) || 'the game thread stopped'); };
        this.w.postMessage({ t: 'init', opts });
        this.threaded = true;
        return;
      } catch { this.w = null; }
    }
    this.inline();
  }
  inline() {
    this.threaded = false;
    this.sim = new HostSim({ ...this.opts, inline: true }, (k, v) => this.out(k, v));   // (inline: the level goes over as is, no copy to rebuild)
  }
  out(k, v) {
    if (this.closed) return;
    if (k === 'frame') { this.mirror = v.mirror; this.h.frame(v); }
    else if (this.h[k]) this.h[k](v);
  }
  onMsg(m) {
    if (this.closed) return;
    if (m.t === 'ready') { this.ready = true; for (const c of this.q) this.w.postMessage(c); this.q = []; return; }
    if (m.t === 'err') { if (m.fatal) this.lost(m.why); else console.error('game thread:', m.why); return; }
    if (m.t === 'out') {
      if (m.frame) { this.inFlight = Math.max(0, this.inFlight - 1); const [t0, n0] = this.sentAt.shift() || [performance.now(), this.n], ms = performance.now() - t0; this.stat.late = (this.stat.late || 0) * 0.95 + (this.n - n0) * 0.05; this.stat.lastMs = ms; this.stat.waitMs = this.stat.waitMs * 0.95 + ms * 0.05; this.stat.frames++; this.stat.workMs = m.ms; this.stat.back = performance.timeOrigin + performance.now() - m.at - m.ms; }
      for (const [k, v] of m.o) { this.out(k, v); if (this.closed) return; }
    }
  }
  // the thread couldn't start: run here (from the start, nothing has been shown yet); later on it can't be saved
  lost(why) {
    if (this.closed || !this.threaded) return;
    try { this.w.terminate(); } catch { /* gone */ }
    this.w = null;
    if (this.ready && this.started) { this.closed = true; if (this.h.fail) this.h.fail(why); return; }
    console.warn('game thread unavailable, running on the page thread:', why);
    const q = this.q; this.q = []; this.inline();
    for (const c of q) { if (c.t === 'start') this.sim.start(); else if (c.t !== 'init') this.sim.cmd(c); }
  }
  post(c) { if (!this.ready) this.q.push(c); else this.w.postMessage(c); }
  start() { this.started = true; if (this.threaded) this.post({ t: 'start' }); else this.sim.start(); }
  cmd(c) { if (this.closed) return; if (this.threaded) this.post(c); else this.sim.cmd(c); }
  frame(c) {
    if (this.closed) return;
    this.n = (this.n || 0) + 1;
    if (!this.threaded) { this.sim.cmd({ t: 'frame', ...c }); return; }
    if (this.inFlight >= 3 || !this.ready) { this.accDt += c.dt; this.stat.skipped++; return; }
    const dt = Math.min(0.3, c.dt + this.accDt); this.accDt = 0;
    this.inFlight++; this.sentAt.push([performance.now(), this.n]);
    this.w.postMessage({ t: 'frame', ...c, dt });
  }
  close() { this.closed = true; if (this.w) { try { this.w.terminate(); } catch { /* gone */ } this.w = null; } }
  // what the page reads between frames (main.js used to read the Game directly)
  heroes() { return this.mirror ? this.mirror.heroes : []; }
  player(id) { return this.heroes().find(p => p.id === id) || null; }
  get phase() { return this.mirror ? this.mirror.phase : 'countdown'; }
  get ow() { return !!(this.mirror && this.mirror.ow); }
  get settings() { return this.opts.settings; }
}
