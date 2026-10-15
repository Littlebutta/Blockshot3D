// v1.2.9: round-trip fuzz test for the snapshot codec (public/js/netcodec.js) and the Steam packet layer (electron/p2pwire.cjs).
// node tools/codecfuzz.mjs [rounds]  — exits 1 on the first mismatch.
// Random snapshots (players, bullets with gravity, props, side blocks, events), random acks (late, lost, out of order, too old),
// and every message decoded must give back exactly what was pushed: rows, side blocks, and each event batch once, in order.
import { createRequire } from 'module';
import { AckEncoder, AckDecoder } from '../public/js/netcodec.js';
const W = createRequire(import.meta.url)('../electron/p2pwire.cjs');
const ROUNDS = +(process.argv[2] || 40);
let seed = 1; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)], r2 = v => Math.round(v * 100) / 100;
const num = () => { const k = rnd(); return k < 0.3 ? Math.floor(rnd() * 200 - 100) : k < 0.8 ? r2(rnd() * 80 - 40) : k < 0.9 ? Math.round(rnd() * 1e7) / 1000 : rnd() * 1e3; };
const val = () => { const k = rnd(); return k < 0.7 ? num() : k < 0.8 ? pick(['p1', 'p2', 'bot3', 'shield', '']) : k < 0.88 ? null : k < 0.94 ? [num(), num()] : { a: num(), b: pick(['x', 'y']) }; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let serial = 1, fails = 0, msgs = 0, decoded = 0, packets = 0;
function fail(what, a, b) { fails++; console.log('FAIL', what, JSON.stringify(a).slice(0, 300), '\n    ', JSON.stringify(b).slice(0, 300)); if (fails > 5) process.exit(1); }
for (let round = 0; round < ROUNDS; round++) {
  seed = round * 7919 + 1;
  const enc = new AckEncoder(), dec = new AckDecoder(), sent = new Map(), evSent = [];
  let pl = Array.from({ length: 2 + Math.floor(rnd() * 9) }, (_, i) => ['p' + i, ...Array.from({ length: 34 }, val)]);
  let bu = [], ob = Array.from({ length: Math.floor(rnd() * 6) }, (_, i) => [100 + i, num(), num(), num(), num(), 0, 0, 0]), nextId = 1000, tm = 1000, ack = 0, since = 0;
  const inFlight = [], evGot = [];
  for (let t = 0; t < 400; t++) {
    tm += 33 + Math.floor(rnd() * 5);
    // players: positions follow their velocity (sometimes exactly, sometimes not), other fields change now and then
    pl = pl.map(r => { r = r.slice(); for (const [i, j] of [[1, 16], [2, 17], [3, 18]]) if (typeof r[i] === 'number' && typeof r[j] === 'number') r[i] = r2(r[i] + r[j] * (rnd() < 0.5 ? 0.033 : 0.03)); for (let i = 1; i < r.length; i++) if (rnd() < 0.05) r[i] = val(); return r; });
    if (rnd() < 0.03) pl.push(['p' + (nextId++), ...Array.from({ length: 34 }, val)]); if (rnd() < 0.03 && pl.length > 1) pl.splice(Math.floor(rnd() * pl.length), 1);
    if (rnd() < 0.02) pl.reverse();
    // bullets: [id, x, y, z, vx, vy, vz, r, owner, ring, cown, grav], falling like sim.js (60 steps a second)
    bu = bu.filter(() => rnd() > 0.04).map(b => { b = b.slice(); for (let k = 0; k < 2; k++) { b[5] -= b[11] / 60; b[1] += b[4] / 60; b[2] += b[5] / 60; b[3] += b[6] / 60; } if (rnd() < 0.05) b[4] = -b[4]; return b; });
    for (let k = rnd() < 0.3 ? Math.floor(rnd() * 6) : 0; k > 0; k--) bu.push([nextId++, num(), num(), num(), num(), num(), num(), 0.1, 'p1', 0, 0, pick([0, 9.8, 4.5, 0.6, 12.34])]);
    const buRows = bu.map(b => b.map((v, i) => i >= 1 && i <= 6 ? r2(v) : v));
    if (rnd() < 0.1) ob = ob.map(o => { o = o.slice(); o[1] = r2(o[1] + 0.1); return o; });
    const s = { ph: pick(['play', 'play', 'countdown']), pt: r2(rnd() * 10), rd: 1, tm, pl, bu: buRows, ob, sc: rnd() < 0.1 ? { p1: Math.floor(rnd() * 5) } : { p1: 1 }, tg: rnd() < 0.2 ? [[1, num()]] : null, mv: [['p1', t, 5.2, 9, 1, 1, 12]] };
    const ev = rnd() < 0.3 ? Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => ({ t: pick(['hit', 'death', 'shoot', 'impact', 'units', 'napalm', 'round']), p: 'p1', x: num(), dmg: Math.floor(rnd() * 50), n: serial++ })) : [];
    const full = JSON.parse(JSON.stringify(s));
    const q = enc.push(s, ev); if (!since) since = q;
    sent.set(q, full); if (ev.length) evSent.push([q, ev.map(e => JSON.parse(JSON.stringify(e)))]);
    const m = enc.encodeFor(ack, since); msgs++;
    // through the Steam packet layer (pieces may arrive in any order)
    const pks = W.packMessage({ t: 'msg', from: 'host', msg: { k: 'snap', s: m } }, false); packets += pks.length;
    if (pks.length > 1) for (let i = pks.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pks[i], pks[j]] = [pks[j], pks[i]]; }
    if (rnd() < 0.08) continue;   // lost
    const asm = new W.Assembler(); let got = null; for (const p of pks) got = asm.take(p.buf) || got;
    if (!got) { fail('p2pwire reassembly', m, null); continue; }
    if (!eq(got.msg.s, m)) fail('p2pwire round trip', got.msg.s, m);
    inFlight.push([t + 1 + Math.floor(rnd() * 4), got.msg.s]);
    inFlight.sort((a, b) => a[0] - b[0]);
    while (inFlight.length && inFlight[0][0] <= t) {
      const mm = inFlight.shift()[1], out = dec.decode(mm);
      if (!out) continue;
      decoded++;
      const want = sent.get(mm.q);
      for (const k of ['pl', 'bu', 'ob', 'sc', 'tg', 'mv', 'ph', 'pt', 'tm']) if (!eq(out[k] ?? null, want[k] ?? null)) fail(`decode ${k} at q ${mm.q} (base ${mm.b})`, out[k], want[k]);
      evGot.push(...out.ev);
      if (rnd() < 0.85) { const a = dec.ack(); if (rnd() < 0.05) ack = Math.max(0, a[1] - 120); else ack = a[1]; }   // acks: usually the newest, sometimes too old to use
    }
  }
  // events: numbers go to 2 places on the wire; sound/particle ones may be dropped once stale and an older unit roster once a newer
  // one is out, but the rest (hits, deaths, rounds, napalm...) must each come exactly once, in order, from the first one received
  const FXT = new Set(['shoot', 'impact']), key = e => JSON.stringify({ ...e, x: typeof e.x === 'number' && !Number.isInteger(e.x) ? r2(e.x) : e.x });
  const want = evSent.flatMap(([, e]) => e).filter(e => !FXT.has(e.t) && e.t !== 'units').map(key), got = evGot.filter(e => !FXT.has(e.t) && e.t !== 'units').map(key);
  const at = want.indexOf(got[0]); if (got.length && (at < 0 || !eq(want.slice(at, at + got.length), got) || at + got.length < want.length - 40)) fail('events once and in order', got.slice(0, 5), want.slice(at, at + 5));
  const ns = evGot.map(e => e.n); if (new Set(ns).size !== ns.length) fail('an event came twice', ns.length, new Set(ns).size);
}
// p2pwire alone: messages of every size, reliable and not
for (let i = 0; i < 300; i++) {
  seed = 99991 + i;
  const big = { t: 'msg', msg: { k: pick(['snap', 'level', 'input']), a: Array.from({ length: Math.floor(rnd() ** 3 * 4000) }, val) } };
  for (const rel of [false, true]) {
    const pks = W.packMessage(big, rel), asm = new W.Assembler(); let got = null; for (const p of pks) got = asm.take(p.buf) || got;
    if (!eq(got, big)) fail('p2pwire size ' + JSON.stringify(big).length + (rel ? ' reliable' : ''), got, big);
    for (const p of pks) if (!p.reliable && p.buf.length > 1200) fail('unreliable packet over 1200 bytes', p.buf.length, 1200);
  }
}
console.log(`codec fuzz: ${ROUNDS} matches, ${msgs} snapshots, ${decoded} decoded, ${packets} packets: ${fails ? fails + ' FAILED' : 'all match'}`);
process.exit(fails ? 1 : 0);
