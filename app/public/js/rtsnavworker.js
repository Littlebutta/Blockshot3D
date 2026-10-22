// v1.2.30: a helper thread that works out RTS flow fields (rtsnav.js NavPool).
import { flowField, Heap } from './rtsnav.js';
let M = null, occ = null, ver = -1, heap = null;
self.onmessage = e => {
  const m = e.data;
  if (m.t === 'map') { M = { N: m.N, walk: m.walk, h: m.h, lv: m.lv }; heap = new Heap(m.N * m.N * 2); occ = new Uint8Array(m.N * m.N); }
  else if (m.t === 'occ') { occ = m.occ; ver = m.ver; }
  else if (m.t === 'field') { const d = flowField(M, occ, m.goals, m.cliff, heap); self.postMessage({ id: m.id, d, ver }, [d.buffer]); }
};
