// =====================================================================
// v1.2.31: how the host's view of the match crosses from the game thread to the page (hostsim.js -> simlink.js).
// Copying every fighter and bullet as fresh objects each frame left the page ~20% of its allocations to clean up
// (with 100 players), which showed up as a dropped frame every so often. Instead the numbers that change every frame
// travel in one Float64Array, the rest (name, color, cosmetics, mods...) only when it changes, and the page keeps one
// object per fighter / bullet and updates it in place. The page sees the same view objects as before.
// =====================================================================
const VEC = ['pos', 'vel', 'aim'];
// per fighter, after the 3 vectors and aimPoint (4 numbers: set?, x, y, z)
const PNUM = ['hp', 'maxHp', 'ammo', 'maxAmmo', 'reloadFrac', 'blockFrac', 'size', 'blockSize', 'charge', 'status', 'bulletSpeed', 'bulletGrav',
  'riotFrac', 'pillarFrac', 'healN', 'critters', 'blockFx', 'fieldR', 'flags', 'pct', 'stocks', 'kCharge', 'slashN', 'hairFrac', 'hairHp', 'hairMax', 'tsFrac', 'team'];
const PBOOL = ['alive', 'blocking', 'flash', 'sky', 'broken', 'holding', 'holdHoly', 'holyShield', 'robe'];
const PSTRIDE = 9 + 4 + PNUM.length + PBOOL.length;
const HOT = new Set([...VEC, 'aimPoint', ...PNUM, ...PBOOL]);
const BSTRIDE = 9;   // id, pos, vel, r, ring

export class ViewPacker {
  constructor() { this.pSig = new Map(); this.pIds = ''; this.bSig = new Map(); }
  // view.players / view.bullets -> view.pk (the arrays go)
  pack(view) {
    const P = view.players, f = new Float64Array(P.length * PSTRIDE), cold = [], ids = [], sigs = new Map();
    for (let i = 0; i < P.length; i++) {
      const v = P[i], o = i * PSTRIDE; ids.push(v.id);
      let k = o;
      for (const n of VEC) { const a = v[n] || ZERO; f[k++] = a.x; f[k++] = a.y; f[k++] = a.z; }
      const ap = v.aimPoint; if (ap) { f[k++] = 1; f[k++] = ap.x; f[k++] = ap.y; f[k++] = ap.z; } else { f[k] = 0; k += 4; }
      for (const n of PNUM) { const x = v[n]; f[k++] = x == null ? NaN : +x; }
      for (const n of PBOOL) f[k++] = v[n] ? 1 : 0;
      const c = {}; for (const n in v) if (!HOT.has(n)) c[n] = v[n];
      const s = JSON.stringify(c); sigs.set(v.id, s);
      if (this.pSig.get(v.id) !== s) cold.push([i, c]);
    }
    this.pSig = sigs;
    const key = ids.join('\u0001'), idsOut = key !== this.pIds ? ids : null; this.pIds = key;
    const B = view.bullets, bf = new Float64Array(B.length * BSTRIDE), bcold = [], bsig = new Map();
    let numIds = true;
    for (let i = 0; i < B.length; i++) {
      const b = B[i], o = i * BSTRIDE;
      if (typeof b.id !== 'number') { numIds = false; break; }
      bf[o] = b.id; bf[o + 1] = b.pos.x; bf[o + 2] = b.pos.y; bf[o + 3] = b.pos.z; bf[o + 4] = b.vel.x; bf[o + 5] = b.vel.y; bf[o + 6] = b.vel.z; bf[o + 7] = b.r; bf[o + 8] = b.ring || 0;
      const s = b.color + '|' + b.fx + '|' + b.tgt + '|' + b.o; bsig.set(b.id, s);
      if (this.bSig.get(b.id) !== s) bcold.push([b.id, b.color, b.fx, b.tgt, b.o]);
    }
    const pk = { pf: f, pids: idsOut, pcold: cold };
    if (numIds) { this.bSig = bsig; pk.bf = bf; pk.bcold = bcold; delete view.bullets; }
    else this.bSig = new Map();
    delete view.players;
    view.pk = pk;
    return view;
  }
}
const ZERO = { x: 0, y: 0, z: 0 };

export class ViewUnpacker {
  constructor() { this.ids = []; this.pObj = new Map(); this.bObj = new Map(); this.cold = new Map(); this.bc = new Map(); this.last = null; this.lastView = null; }
  unpack(view) {
    const pk = view.pk; if (!pk) return view;
    delete view.pk; this.last = pk; this.lastView = view;
    if (pk.pids) {
      this.ids = pk.pids;
      const keep = new Set(pk.pids); for (const id of this.pObj.keys()) if (!keep.has(id)) { this.pObj.delete(id); this.cold.delete(id); }
    }
    const ids = this.ids, f = pk.pf, players = new Array(ids.length);
    for (const [i, c] of pk.pcold) { const id = ids[i]; this.cold.set(id, c); let v = this.pObj.get(id); if (!v) this.pObj.set(id, v = newPlayer()); for (const n in v) if (!HOT.has(n) && !(n in c)) v[n] = undefined; Object.assign(v, c); }   // (not delete: a deleted key slows every later read of the object)
    for (let i = 0; i < ids.length; i++) {
      let v = this.pObj.get(ids[i]); if (!v) this.pObj.set(ids[i], v = newPlayer());
      let k = i * PSTRIDE;
      for (const n of VEC) { const a = v[n]; a.x = f[k++]; a.y = f[k++]; a.z = f[k++]; }
      if (f[k]) { const a = v.aimPoint || (v.aimPoint = { x: 0, y: 0, z: 0 }); a.x = f[k + 1]; a.y = f[k + 2]; a.z = f[k + 3]; } else v.aimPoint = null;
      k += 4;
      for (const n of PNUM) { const x = f[k++]; v[n] = x !== x ? undefined : x; }
      for (const n of PBOOL) v[n] = f[k++] === 1;
      players[i] = v;
    }
    view.players = players;
    if (pk.bf) {
      const bf = pk.bf, n = bf.length / BSTRIDE, out = new Array(n), seen = this.bSeen = (this.bSeen || 0) + 1;
      for (const r of pk.bcold) { const [id, color, fx, tgt, o] = r; this.bc.set(id, r); let b = this.bObj.get(id); if (!b) this.bObj.set(id, b = { id, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, ring: 0, r: 0 }); b.color = color; b.fx = fx; b.tgt = tgt; b.o = o; }
      for (let i = 0; i < n; i++) {
        const o = i * BSTRIDE, id = bf[o]; let b = this.bObj.get(id);
        if (!b) this.bObj.set(id, b = { id, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, ring: 0, r: 0 });
        b.pos.x = bf[o + 1]; b.pos.y = bf[o + 2]; b.pos.z = bf[o + 3]; b.vel.x = bf[o + 4]; b.vel.y = bf[o + 5]; b.vel.z = bf[o + 6]; b.r = bf[o + 7]; b.ring = bf[o + 8];
        b._s = seen; out[i] = b;
      }
      if (this.bObj.size > n * 2 + 64) for (const [id, b] of this.bObj) if (b._s !== seen) { this.bObj.delete(id); this.bc.delete(id); }   // (gone bullets, now and then)
      view.bullets = out;
    }
    return view;
  }
}
const newPlayer = () => ({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, aim: { x: 0, y: 0, z: 0 }, aimPoint: null });

// v1.2.31: the kill cam's recording (main.js kcRecord). It keeps the last frame's packed numbers (copied into arrays it
// reuses) and points at the rarely changing parts, instead of copying every fighter field by field (with 100 players
// that copying was most of the page's garbage). Fighters and shots are only rebuilt for the frames the replay shows.
const grow = (a, n) => a && a.length === n ? a : new Float64Array(n);
export function kcPackInto(fr, u) {
  const pk = u.last, ids = u.ids;
  fr.ids = ids; fr.pf = grow(fr.pf, pk.pf.length); fr.pf.set(pk.pf);
  const C = fr.cold || (fr.cold = []); C.length = ids.length; for (let i = 0; i < ids.length; i++) C[i] = u.cold.get(ids[i]);
  if (pk.bf) {
    fr.bf = grow(fr.bf, pk.bf.length); fr.bf.set(pk.bf);
    const n = pk.bf.length / BSTRIDE, B = fr.bcold || (fr.bcold = []); B.length = n; for (let i = 0; i < n; i++) B[i] = u.bc.get(pk.bf[i * BSTRIDE]);
  } else fr.bf = null;
  fr.players = null; fr.bullets = null;
  return fr;
}
export const kcHas = (fr, id) => fr.ids.includes(id);
// the fighters and shots of a recorded frame (new objects: they live through the replay only)
export function kcExpand(fr) {
  if (fr.players) return fr;
  const f = fr.pf, players = [];
  for (let i = 0; i < fr.ids.length; i++) {
    const v = { ...(fr.cold[i] || {}), id: fr.ids[i], pos: {}, vel: {}, aim: {}, aimPoint: null };
    let k = i * PSTRIDE;
    for (const n of VEC) { const a = v[n]; a.x = f[k++]; a.y = f[k++]; a.z = f[k++]; }
    if (f[k]) v.aimPoint = { x: f[k + 1], y: f[k + 2], z: f[k + 3] };
    k += 4;
    for (const n of PNUM) { const x = f[k++]; v[n] = x !== x ? undefined : x; }
    for (const n of PBOOL) v[n] = f[k++] === 1;
    players.push(v);
  }
  const bullets = [];
  if (fr.bf) for (let i = 0; i < fr.bcold.length; i++) {
    const o = i * BSTRIDE, b = fr.bf, c = fr.bcold[i] || [];
    bullets.push({ id: b[o], pos: { x: b[o + 1], y: b[o + 2], z: b[o + 3] }, vel: { x: b[o + 4], y: b[o + 5], z: b[o + 6] }, r: b[o + 7], ring: b[o + 8], color: c[1], fx: c[2], tgt: c[3], o: c[4] });
  }
  fr.players = players; fr.bullets = bullets;
  return fr;
}
