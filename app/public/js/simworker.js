// v1.2.30: the host's match on its own CPU thread (simlink.js). Everything it does is in hostsim.js.
import { HostSim } from './hostsim.js';
let sim = null, out = [];
const emit = (k, v) => out.push([k, v]);
self.onmessage = e => {
  const m = e.data, at = performance.timeOrigin + performance.now();
  try {
    if (m.t === 'init') { sim = new HostSim(m.opts, emit); self.postMessage({ t: 'ready', at: performance.now() }); }
    else if (m.t === 'start') sim.start();
    else if (m.t === 'batch') for (const c of m.list) sim.cmd(c);
    else sim.cmd(m);
  } catch (err) {
    self.postMessage({ t: 'err', why: String((err && err.stack) || err), fatal: !sim });
  }
  // (a frame always answers, even one that failed, so the page never waits on it)
  if (out.length || m.t === 'frame') { const o = out; out = []; self.postMessage({ t: 'out', o, frame: m.t === 'frame', at, ms: performance.timeOrigin + performance.now() - at }); }
};
