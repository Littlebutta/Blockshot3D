// v1.2.30: the RTS host simulation on its own thread (rtshost.js RtsThread). Flow fields go to helper threads
// (rtsnavworker.js) when there are CPU threads to spare; otherwise they're worked out here as before.
import { RtsGame } from './rts.js';
import { RtsHost, applyCmd } from './rtshost.js';
import { WorkerPool } from './threads.js';
import { NavPool } from './rtsnav.js';

let g = null, host = null, out = null, helpers = 0;
const now = () => performance.now();
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.t === 'init') {
      g = new RtsGame(m.opts); helpers = m.helpers;
      if (helpers > 0) { const pool = new WorkerPool(new URL('./rtsnavworker.js', import.meta.url), helpers); if (pool.size) g.nav = new NavPool(pool, g.M); }
      const M = g.M; self.postMessage({ t: 'ready', M });
    } else if (m.t === 'start') {
      out = { pub: null, view: null, ev: null, send: [] };
      host = new RtsHost(g, m.localId, { pub: s => { out.pub = s; }, view: (v, ev) => { out.view = v; out.ev = ev; }, send: s => out.send.push(s) }, m.net);
    } else if (m.t === 'cmd') applyCmd(g, m.c);
    else if (m.t === 'frame') {
      const t0 = now();
      host.io = m.io; g.hostFps = m.io.fps;
      host.tick(m.dt, m.paused);
      const o = out; out = { pub: null, view: null, ev: null, send: [] };
      self.postMessage({ t: 'out', pub: o.pub, view: o.view, ev: o.ev, send: o.send, info: { threads: 2 + (g.nav ? g.nav.pool.size : 0), tickMs: g.bud ? Math.round(g.bud.ms * 10) / 10 : 0, frameMs: Math.round((now() - t0) * 10) / 10, fields: g.nav ? g.nav.done : 0 } });
    }
  } catch (err) {
    if (m.t === 'init' || !host) self.postMessage({ t: 'err', why: String(err && err.stack || err) });
    else { console.error(err); if (m.t === 'frame') self.postMessage({ t: 'out', send: [] }); }
  }
};
