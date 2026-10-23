// v1.2.37: one arena shard on a CPU thread of its own (shard.js ShardSim; started by the host's match: ShardSet)
import { ShardSim } from './shard.js';
const sim = new ShardSim();
self.onmessage = e => {
  let r = null;
  try { r = sim.handle(e.data); } catch (err) { console.error('arena shard:', err); if (e.data.t === 'frame') r = { t: 'out', tok: e.data.tok, stale: 1 }; }
  if (r) self.postMessage(r);
};
