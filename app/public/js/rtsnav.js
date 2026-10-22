// v1.2.30: RTS flow fields as a plain function of the map, so they can be worked out on other CPU cores
// (rtsnavworker.js) as well as inline (rts.js). Same answer either way: a field depends only on the walkable
// cells, which cells buildings / resources take (occ), the heights and the goal cells.
import { LEVEL_H, STEP_MAX, ROCK } from './rtsmap.js';

export const INF = 0x3fffffff;
export const D8X = [1, -1, 0, 0, 1, 1, -1, -1], D8Z = [0, 0, 1, -1, 1, -1, 1, -1], D8C = [10, 10, 10, 10, 14, 14, 14, 14];

// a binary min-heap of cell ids keyed by distance
export class Heap {
  constructor(cap) { this.k = new Uint32Array(cap); this.v = new Int32Array(cap); this.n = 0; this.lastKey = 0; }
  clear() { this.n = 0; }
  push(v, key) {
    if (this.n >= this.k.length) { const k = new Uint32Array(this.k.length * 2), vv = new Int32Array(this.k.length * 2); k.set(this.k); vv.set(this.v); this.k = k; this.v = vv; }
    let i = this.n++; const K = this.k, V = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = v;
  }
  pop() {
    const K = this.k, V = this.v, top = V[0]; this.lastKey = K[0];
    const n = --this.n; if (n <= 0) return top;
    const key = K[n], val = V[n]; let i = 0;
    for (;;) { let c = i * 2 + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= key) break; K[i] = K[c]; V[i] = V[c]; i = c; }
    K[i] = key; V[i] = val;
    return top;
  }
}

// distance (10 per straight cell, 14 per diagonal) from every cell to the nearest goal; INF = can't get there.
// M: { N, walk, h, lv }; occ: nonzero = taken by a building or a resource
export function flowField(M, occ, goals, cliff, heap, out) {
  const N = M.N, NN = N * N, h = M.h, walk = M.walk, lv = M.lv;
  const d = out && out.length === NN ? out : new Uint32Array(NN);
  d.fill(INF);
  heap.clear();
  const pass = j => walk[j] === 1 && occ[j] === 0;
  for (const k of goals) { d[k] = 0; heap.push(k, 0); }
  while (heap.n) {
    const c = heap.pop(), dc = heap.lastKey;
    if (dc > d[c]) continue;
    const cx = c % N, cz = (c / N) | 0, open = pass(c);
    for (let i = 0; i < 8; i++) {
      const ex = cx + D8X[i], ez = cz + D8Z[i]; if (ex < 0 || ez < 0 || ex >= N || ez >= N) continue;
      const j = ez * N + ex;
      if (!pass(j)) continue;
      if (open) {
        const dh = Math.abs(h[j] - h[c]);
        if (dh > STEP_MAX && !(cliff && dh <= LEVEL_H * 1.25 && lv[j] !== ROCK)) continue;
        if (i >= 4 && (!pass(cz * N + ex) || !pass(ez * N + cx))) continue;
      }
      const nd = dc + D8C[i];
      if (nd < d[j]) { d[j] = nd; heap.push(j, nd); }
    }
  }
  return d;
}

// v1.2.30: flow fields on a WorkerPool of rtsnavworker.js. Each worker keeps the map; which cells are taken is sent
// again whenever buildings change (navVer). At most 3 fields wait per worker; past that a unit keeps its old field.
export class NavPool {
  constructor(pool, M) {
    this.pool = pool; this.ver = -1; this.out = 0; this.cap = pool.size * 3; this.done = 0;
    pool.broadcast({ t: 'map', N: M.N, walk: M.walk, h: M.h, lv: M.lv });
  }
  request(ver, occ, goals, cliff, done) {
    if (this.out >= this.cap || !this.pool.size) return false;
    if (ver !== this.ver) { this.ver = ver; const m = new Uint8Array(occ.length); for (let k = 0; k < occ.length; k++) m[k] = occ[k] !== 0 ? 1 : 0; this.pool.broadcast({ t: 'occ', ver, occ: m }); }
    this.out++;
    this.pool.run({ t: 'field', goals, cliff: !!cliff }).then(r => { this.out--; this.done++; done(r.d, r.ver); }, () => { this.out--; });
    return true;
  }
  close() { this.pool.close(); }
}
