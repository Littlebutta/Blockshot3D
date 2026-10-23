// v1.2.38: one bot brain thread (brain.js BrainSim; started by the host's match: BrainSet)
import { BrainSim } from './brain.js';
const sim = new BrainSim();
self.onmessage = e => {
  let r = null;
  try { r = sim.handle(e.data); } catch (err) { console.error('bot brain:', err); if (e.data.t === 'frame') r = { t: 'out', tok: e.data.tok, stale: 1 }; }
  if (r) self.postMessage(r);
};
