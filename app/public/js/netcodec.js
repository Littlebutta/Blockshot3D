// v30: snapshot delta compression. Both transports (WebSocket, Steam reliable P2P) deliver every message in
// order, so the host can send each row of a list (players, props, walls, shields, mines, bullets) as only the
// fields that changed since the last snapshot. A keyframe with full rows goes out every KEY_EVERY snapshots and
// whenever someone joins, so a newcomer never waits long.
//   keyframe (s.kf = 1): rows as-is
//   delta:   [id]                    unchanged row
//            [id, mask, ...values]   changed fields; bit i-1 of mask = field i is in values
//            [id, -1, ...rest]       a full row (new id, or a different row length)
// v1.0.1 (less traffic, fewer resends on a lossy link):
//   - when a list has exactly the same ids in the same order as last time it goes as { d: [changed rows only] },
//     so parked cars, still props and idle walls cost nothing;
//   - open world vehicles ride as their own list (ov) so they get the same treatment;
//   - small side blocks (core, scores, telegraphs, boss bar...) that didn't change are left out and listed in s.u;
//   - keyframes every 2 s instead of every 0.5 s (a joiner still gets one at once).
const LISTS = ['pl', 'ob', 'bc', 'sh', 'mn', 'bu', 'ov'];
const STICKY = ['sc', 'co', 'tg', 'sw', 'bo', 'rt', 'rl', 'lz', 'bw', 'mv', 'bfx', 'ow'];
export const KEY_EVERY = 60;   // two seconds at 30 snapshots a second
const same = (a, b) => a === b || (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

export class SnapEncoder {
  constructor() { this.prev = {}; this.side = {}; this.n = 0; this.forceKey = true; }
  encode(s) {
    const key = this.forceKey || this.n % KEY_EVERY === 0;
    this.forceKey = false; this.n++;
    s.q = this.n;   // sequence number (the network window counts gaps)
    if (key) s.kf = 1;
    if (s.ow && Array.isArray(s.ow.veh)) { s.ov = s.ow.veh; s.ow = { ...s.ow }; delete s.ow.veh; }
    for (const L of LISTS) {
      const rows = s[L];
      if (!Array.isArray(rows)) { this.prev[L] = null; continue; }
      const prev = this.prev[L] || new Map(), next = new Map();
      let sameIds = !key && !!this.prev[L] && prev.size === rows.length;
      if (sameIds) { let i = 0; for (const id of prev.keys()) { if (rows[i] == null || rows[i][0] !== id) { sameIds = false; break; } i++; } }
      const delta = r => {
        const id = r[0], b = next.has(id) ? null : prev.get(id);
        if (!b || b.length !== r.length) return [id, -1, ...r.slice(1)];
        let mask = 0, bit = 1; const vals = [];
        for (let i = 1; i < r.length; i++, bit *= 2) if (!same(r[i], b[i])) { mask += bit; vals.push(r[i]); }
        return mask ? [id, mask, ...vals] : [id];
      };
      let out;
      if (key) out = rows;
      else if (sameIds) { const d = []; for (const r of rows) { const x = delta(r); if (x.length > 1) d.push(x); } out = { d }; }
      else out = rows.map(delta);
      for (const r of rows) next.set(r[0], r);
      this.prev[L] = next;
      s[L] = out;
    }
    const u = [];
    for (const k of STICKY) {
      if (!(k in s)) continue;
      const j = JSON.stringify(s[k] ?? null);
      if (!key && this.side[k] === j) { delete s[k]; u.push(k); } else this.side[k] = j;
    }
    if (u.length) s.u = u;
    return s;
  }
}

export class SnapDecoder {
  constructor() { this.prev = {}; this.side = {}; this.lastQ = 0; this.gaps = 0; }
  // Rebuilds full rows in place. s.partial is set when rows had no base yet (joined between keyframes);
  // the caller then keeps what it has instead of removing missing players.
  decode(s) {
    if (s.q) { if (this.lastQ && s.q > this.lastQ + 1) this.gaps += s.q - this.lastQ - 1; this.lastQ = s.q; }
    for (const k of s.u || []) if (k in this.side) s[k] = this.side[k];
    for (const k of STICKY) if (k in s) this.side[k] = s[k];
    delete s.u;
    for (const L of LISTS) {
      let rows = s[L];
      if (rows && !Array.isArray(rows) && Array.isArray(rows.d)) {   // same ids as last time: only the changed rows came
        const prev = this.prev[L];
        if (!prev) { s.partial = 1; s[L] = []; continue; }
        const ch = new Map(rows.d.map(r => [r[0], r]));
        rows = [...prev.keys()].map(id => ch.get(id) || [id]);
      }
      if (!Array.isArray(rows)) { this.prev[L] = null; continue; }
      const prev = this.prev[L] || new Map(), next = new Map(), out = [];
      for (const r of rows) {
        let full;
        if (s.kf || r[1] === -1) full = s.kf ? r : [r[0], ...r.slice(2)];
        else {
          const b = prev.get(r[0]);
          if (!b) { s.partial = 1; continue; }
          if (r.length === 1) full = b;
          else {
            full = b.slice(); let mask = r[1], k = 2;
            for (let i = 1; mask > 0; i++) { if (mask % 2) full[i] = r[k++]; mask = Math.floor(mask / 2); }
          }
        }
        next.set(full[0], full); out.push(full);
      }
      this.prev[L] = next;
      s[L] = out;
    }
    if (s.ow && s.ov) s.ow.veh = s.ov;
    delete s.ov;
    return s;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// v1.2.3: snapshots that survive packet loss. Snapshots now travel UNRELIABLY (Steam: plain UDP-style packets,
// never resent), so a lost one is simply skipped instead of stalling everything behind it until it is resent.
// That only works if each snapshot can be decoded on its own terms, so (like Quake 3 / Source) every snapshot is
// a delta against the newest snapshot THAT PLAYER HAS CONFIRMED (its "ack", sent back with its inputs), never
// against the previous one sent. The host keeps the last HIST snapshots; a player with no usable ack gets a
// keyframe. One-off events (hits, deaths, round changes, picks...) ride in every snapshot until that player acks
// a snapshot that carried them, so a lost packet can delay an event by a snapshot or two but never drop it.
//   message: { q: seq, b: base seq (0 = keyframe, kf: 1), lists as in SnapEncoder, u: unchanged side blocks,
//              eb: [[seq, events], ...] event batches the player hasn't confirmed yet }
export const HIST = 90;        // snapshots kept for baselines (3 s at 30 a second)
const EV_KEEP = 150;           // event batches kept for players who fall behind (5 s)
// v1.2.6: events that only make a sound or particles (main.js handleEvent) ride in the first FX_TTL snapshots only:
// after that a copy would come 100+ ms late anyway. Hits, deaths and everything else are resent until confirmed.
const FX = new Set(['shoot', 'impact', 'bounce', 'jump', 'reload', 'block', 'blockOn', 'splash', 'lava', 'drain', 'leech', 'zap', 'push', 'tip', 'drill', 'pad', 'beam', 'chain', 'cut', 'mine', 'unitGone', 'ritualHum', 'kingHum', 'edgeBounce']);
const FX_TTL = 3;
// v1.2.6: the wire copy of an event: top-level fractions to 2 places (1 cm), about half the bytes (the host's own
// handleEvent already ran on the originals; nested arrays / objects such as unit lists are left alone)
const r2 = v => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v;
function netEvent(e) { const o = {}; for (const k in e) o[k] = r2(e[k]); return o; }

// v1.2.9: a changed number goes as the difference from the base in hundredths when that is exact and shorter (a position
// 12.34 -> 12.41 goes as 7, a velocity 3.4 -> 3.1 as -30): about a third fewer bytes on the wire. Such a row is
// [id, -mask - 1, dmask, ...values] (bit i of dmask = value i is a difference); the decoder adds it back (undelta).
// Positions are taken from where the base row was heading (position + velocity x the time between the two snapshots), so a
// body or bullet moving steadily costs a digit or two. PRED: list -> [position field, its velocity field] pairs.
const PRED = { pl: [[1, 16], [2, 17], [3, 18]], bu: [[1, 4], [2, 5], [3, 6]] };
// v1.2.9: and bullets fall: [gravity field, y velocity field, y position field] (sim.js steps vel.y -= g dt, then pos += vel dt,
// at ~60 steps a second). A field that matches where the base row was heading counts as unchanged (decoders fill in the
// prediction), so a body or bullet moving steadily is just [id], or left out of a same-ids list altogether.
const GRAV = { bu: [11, 5, 2] }, ON_PATH = new Set(['bu']);   // (ON_PATH: lists where matching the prediction counts as unchanged; bodies often stand still against a wall with a velocity, so players still compare with the base)
const D100 = (o, d) => Math.round(o * 100 + d) / 100;
const ahead = (b, pv, dt, gv) => {
  if (!pv || !dt) return b;
  const o = b.slice(); for (const [i, j] of pv) if (typeof b[i] === 'number' && typeof b[j] === 'number') o[i] = Math.round((b[i] + b[j] * dt) * 100) / 100;
  if (gv) { const [g, vy, y] = gv, G = b[g]; if (typeof G === 'number' && G && typeof b[vy] === 'number' && typeof o[y] === 'number') { o[y] = Math.round((o[y] - G * dt * (dt + 1 / 60) / 2) * 100) / 100; o[vy] = Math.round((b[vy] - G * dt) * 100) / 100; } }
  return o;
};
function dnum(v, o) {
  if (typeof v !== 'number' || typeof o !== 'number' || !(Math.abs(v) < 1e9) || !(Math.abs(o) < 1e9)) return null;
  const d = Math.round((v - o) * 100);
  return D100(o, d) === v && String(d).length < String(v).length ? d : null;
}
function deltaList(rows, base, pv, dt, gv) {   // (gv is given only for ON_PATH lists)   // base: Map id -> row (or undefined: send rows as-is); pv, dt, gv: see PRED, GRAV
  if (!base) return rows;
  let sameIds = base.size === rows.length;
  if (sameIds) { let i = 0; for (const id of base.keys()) { if (rows[i] == null || rows[i][0] !== id) { sameIds = false; break; } i++; } }
  const seen = new Set();
  const delta = r => {
    const id = r[0], b = seen.has(id) ? null : base.get(id); seen.add(id);
    if (!b || b.length !== r.length) return [id, -1, ...r.slice(1)];
    let mask = 0, dm = 0, bit = 1; const vals = [], a = ahead(b, pv, dt, gv), op = gv && a !== b;
    for (let i = 1; i < r.length; i++, bit *= 2) if (!same(r[i], op ? a[i] : b[i])) { mask += bit; const d = dnum(r[i], a[i]); if (d === null) vals.push(r[i]); else { dm += bit; vals.push(d); } }
    return mask ? dm ? [id, -mask - 1, dm, ...vals] : [id, mask, ...vals] : [id];
  };
  if (sameIds) { const d = []; for (const r of rows) { const x = delta(r); if (x.length > 1) d.push(x); } return { d }; }
  return rows.map(delta);
}

export class AckEncoder {
  constructor() { this.n = 0; this.hist = new Map(); this.evLog = []; this.e = 1 + Math.floor(Math.random() * 1e6); }   // e: match id, so an ack from an earlier match is never used as a base
  // Store this tick's full snapshot (s: plain rows, ev: this tick's events). Returns its sequence number.
  push(s, ev) {
    const q = ++this.n;
    if (s.ow && Array.isArray(s.ow.veh)) { s.ov = s.ow.veh; s.ow = { ...s.ow }; delete s.ow.veh; }
    const lists = {}, side = {};
    for (const L of LISTS) if (Array.isArray(s[L])) lists[L] = new Map(s[L].map(r => [r[0], r]));
    for (const k of STICKY) if (k in s) side[k] = JSON.stringify(s[k] ?? null);
    this.hist.set(q, { s, lists, side });
    this.hist.delete(q - HIST);
    if (ev && ev.length) {
      const all = ev.map(netEvent), keep = all.filter(e => !FX.has(e.t)), K = keep.length === all.length ? all : keep;
      // v1.2.6: a 'units' event is the whole unit roster (the peer rebuilds its list from it), so a resend only needs the
      // newest one: nu is the batch without its 'units' events, sent instead once a newer batch carries one ('split' only
      // adds units, so it always stays)
      const nu = all.some(e => e.t === 'units') ? [all.filter(e => e.t !== 'units'), K.filter(e => e.t !== 'units')] : null;
      this.evLog.push([q, all, K, nu]); if (this.evLog.length > EV_KEEP) this.evLog.shift();
    }
    return q;
  }
  // The message for one player whose newest confirmed snapshot is `ack` (0 / unknown = keyframe). `since`: for a
  // player with no ack yet, the first snapshot they were sent (they get every event from then on until they ack).
  encodeFor(ack, since) {
    const q = this.n, cur = this.hist.get(q); if (!cur) return null;
    const base = ack && ack < q ? this.hist.get(ack) : null;
    // v1.2.9: players who confirmed the same snapshot get the very same message (one encode, and one deflate in the desktop app,
    // instead of one per player: a host with 9 joiners mostly encoded the same delta several times a tick)
    const ck = base ? 'a' + ack : 'k' + (ack || 0) + '_' + (since || 0);
    if (this.memo && this.memo.q === q) { const m = this.memo.m.get(ck); if (m) return m; } else this.memo = { q, m: new Map() };
    const out = this.encodeNew(q, cur, base, ack, since); this.memo.m.set(ck, out); return out;
  }
  encodeNew(q, cur, base, ack, since) {
    const out = { q, e: this.e, b: base ? ack : 0 };
    if (!base) out.kf = 1;
    for (const [k, v] of Object.entries(cur.s)) if (!LISTS.includes(k) && !STICKY.includes(k) && k !== 'ev') out[k] = v;
    const dt = base && cur.s.tm > 0 && base.s.tm > 0 ? (cur.s.tm - base.s.tm) / 1000 : 0;
    for (const L of LISTS) if (cur.lists[L]) out[L] = deltaList(cur.s[L], base ? base.lists[L] : null, PRED[L], dt, ON_PATH.has(L) ? GRAV[L] : null);
    let u = 0;   // v1.2.6: the unchanged side blocks as a bitmask (bit i = STICKY[i]), not a list of names
    for (let i = 0; i < STICKY.length; i++) {
      const k = STICKY[i]; if (!(k in cur.side)) continue;
      if (base && base.side[k] === cur.side[k]) u |= 1 << i; else out[k] = cur.s[k];
    }
    if (u) out.u = u;
    // events: everything after what this player confirmed (a newcomer with no ack only gets this tick's);
    // sound / particle events only while they're fresh (FX_TTL)
    const from = ack || (since ? since - 1 : q - 1), eb = [];
    let lastU = 0;   // the newest batch going out that carries a unit roster: older batches go without theirs
    for (let i = this.evLog.length - 1; i >= 0 && this.evLog[i][0] > from; i--) if (this.evLog[i][3]) { lastU = this.evLog[i][0]; break; }
    for (const [bq, all, keep, nu] of this.evLog) if (bq > from) { const fresh = bq > q - FX_TTL, evs = nu && bq < lastU ? nu[fresh ? 0 : 1] : fresh ? all : keep; if (evs.length) eb.push([bq, evs]); }
    if (eb.length) out.eb = eb;
    return out;
  }
}

function undelta(b, r, pv, dt, gv) {   // (gv: ON_PATH lists only: unchanged fields take the prediction)
  const a = ahead(b, pv, dt, gv), full = gv && a !== b ? a.slice() : b.slice(); let mask = r[1], dm = 0, k = 2;
  if (mask < -1) { mask = -mask - 1; dm = r[2]; k = 3; }
  for (let i = 1; mask > 0; i++) { if (mask % 2) { const v = r[k++]; full[i] = dm % 2 ? D100(a[i], v) : v; } mask = Math.floor(mask / 2); dm = Math.floor(dm / 2); }
  return full;
}

export class AckDecoder {
  constructor() { this.hist = new Map(); this.lastQ = 0; this.lastEv = 0; this.e = 0; }
  ack() { return this.e ? [this.e, this.lastQ] : null; }   // sent back with every input
  // Returns the full snapshot (with s.ev = events not seen before, in order), or null when the message is older
  // than one already applied or its base is gone (the host will send against an older ack or a keyframe).
  decode(m) {
    if (m.e !== this.e) { if (!m.kf) return null; this.hist.clear(); this.lastQ = 0; this.lastEv = 0; this.e = m.e; this.rx = null; this.maxRx = 0; }
    this.seen(m.q);
    if (m.q <= this.lastQ) return null;
    const base = m.kf ? null : this.hist.get(m.b);
    if (!m.kf && !base) return null;
    const dt = base && m.tm > 0 && base.tm > 0 ? (m.tm - base.tm) / 1000 : 0;   // (v1.2.9: same as the encoder's, PRED)
    const s = { ...m }, lists = {}, side = {};
    delete s.u; delete s.eb; delete s.b; delete s.kf; delete s.e;
    const um = typeof m.u === 'number' ? m.u : 0, ua = Array.isArray(m.u) ? m.u : null;   // (a name list from before v1.2.6)
    for (let i = 0; i < STICKY.length; i++) {
      const k = STICKY[i];
      if (k in m) side[k] = m[k];
      else if (base && (ua ? ua.includes(k) : (um >> i) & 1)) { side[k] = base.side[k]; s[k] = base.side[k]; }
    }
    for (const L of LISTS) {
      let rows = m[L]; if (rows == null) continue;
      const bl = base ? base.lists[L] : null;
      if (!Array.isArray(rows) && Array.isArray(rows.d)) {
        if (!bl) return null;
        const ch = new Map(rows.d.map(r => [r[0], r]));
        rows = [...bl.keys()].map(id => ch.get(id) || [id]);
      }
      const next = new Map(), out = [];
      for (const r of rows) {
        let full;
        if (!bl || r[1] === -1) full = !bl ? r : [r[0], ...r.slice(2)];
        else {
          const b = bl.get(r[0]); if (!b) return null;
          const gv = ON_PATH.has(L) ? GRAV[L] : null;
          if (r.length === 1) full = gv ? ahead(b, PRED[L], dt, gv) : b;
          else full = undelta(b, r, PRED[L], dt, gv);
        }
        next.set(full[0], full); out.push(full);
      }
      lists[L] = next; s[L] = out;
    }
    if (s.ow && s.ov) s.ow.veh = s.ov;
    delete s.ov;
    this.lastQ = m.q;
    this.hist.set(m.q, { lists, side, tm: m.tm }); for (const k of this.hist.keys()) if (k < m.q - HIST) this.hist.delete(k);
    const ev = [];
    for (const [bq, evs] of m.eb || []) if (bq > this.lastEv) { ev.push(...evs); this.lastEv = bq; }
    s.ev = ev;
    return s;
  }
  // Loss = snapshot numbers that never arrived, over the last ~10 s (one arriving late and out of order still
  // counts as received; the newest 10 are left out since they may still be on the way).
  seen(q) { (this.rx ||= new Set()).add(q); if (q > (this.maxRx || 0)) this.maxRx = q; if (this.rx.size > 400) for (const k of this.rx) if (k < this.maxRx - 330) this.rx.delete(k); }
  lossPct() {
    const hi = (this.maxRx || 0) - 10, lo = Math.max(Math.min(...(this.rx || [])), hi - 300);
    if (!(hi > lo)) return 0;
    let miss = 0; for (let k = lo; k <= hi; k++) if (!this.rx.has(k)) miss++;
    return miss / (hi - lo + 1) * 100;
  }
}
