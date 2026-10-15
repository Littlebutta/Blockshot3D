// v1.2.3: how game messages are packed into Steam P2P packets.
// Snapshots and inputs go UNRELIABLE (sent once, never resent): a lost one is skipped instead of holding up
// everything behind it until Steam resends it, which is what made matches stutter on any lossy connection.
// Everything else (lobby, picks, level, start...) stays reliable and in order.
//   '{'...   plain JSON (older builds, small reliable messages)
//   0x01 ... deflated JSON, whole message in one packet
//   0x02 id(u32) idx(u8) cnt(u8) ...  one piece of a deflated message too big for one unreliable packet
//   0x03 / 0x04  as 0x01 / 0x02, deflated against snapdict.txt (v1.2.9, below)
// Steam's unreliable packets top out at 1200 bytes; pieces stay under MTU so none is split again on the way.
// v1.2.9: each message is deflated on its own, so most of a ~500-byte snapshot went into spelling out the same keys and
// row shapes every time. snapdict.txt (sample snapshots of every mode and an input, taken from this build's own output)
// is a preset deflate dictionary both ends share: snapshots come out ~40% smaller (many more fit one packet) and an input
// ~200 bytes -> ~20. Small reliable messages stay plain JSON, so an older build can still read the hello and get the
// version-mismatch message. Any content works as long as both ends have the same file (same build).
// (Rebuilt for the second 1.2.9 pass from this build's own messages, 10-player matches and AMON fields included: 29 kB, 4-16% smaller.)
const zlib = require('zlib');
let DICT = null;
try { DICT = require('fs').readFileSync(require('path').join(__dirname, 'snapdict.txt')); } catch { /* none: plain deflate as before */ }
const ZD = DICT ? { level: 6, dictionary: DICT } : { level: 3 }, ZIN = DICT ? { dictionary: DICT } : {};

// v1.2.6: a message that fits one packet (1-byte prefix + up to WHOLE bytes, under Steam's 1200) goes whole instead of in 2 pieces
const PIECE = 1100, WHOLE = 1190, MAX_PIECES = 48, ZIP_OVER = 300, ZIP_U = DICT ? 64 : ZIP_OVER;   // (ZIP_U: unreliable messages over this are deflated)
const W1 = DICT ? 3 : 1, W2 = DICT ? 4 : 2;
let nextId = 1;

// Returns [{ buf, reliable }] packets for one message.
// v1.2.9: the same unreliable message to several players (they confirmed the same snapshot: netcodec.js encodeFor) is
// deflated once; the packets are reused for a few ms
const memo = new Map(), last = { o: null, pk: null }; let memoAt = 0;
function packMessage(o, reliable) {
  if (reliable) return packNew(o, true);
  if (last.o === o) return last.pk;   // the very same object again (main.cjs: one message to several players)
  const j = JSON.stringify(o), now = Date.now();
  if (now - memoAt > 20 || memo.size > 8) { memo.clear(); memoAt = now; }
  let pk = memo.get(j); if (!pk) memo.set(j, pk = packNew(o, false, j));
  last.o = o; last.pk = pk;
  return pk;
}
function packNew(o, reliable, j) {
  const json = Buffer.from(j || JSON.stringify(o));
  if (reliable) {
    if (json.length < ZIP_OVER) return [{ buf: json, reliable: true }];
    return [{ buf: Buffer.concat([Buffer.from([W1]), zlib.deflateRawSync(json, ZD)]), reliable: true }];
  }
  let z = json.length < ZIP_U ? null : zlib.deflateRawSync(json, ZD);
  if (z && z.length + 1 >= json.length && json.length <= WHOLE) z = null;   // (didn't shrink)
  const body = z || json;
  if (!z && body.length <= WHOLE) return [{ buf: json, reliable: false }];
  if (body.length <= WHOLE) return [{ buf: Buffer.concat([Buffer.from([W1]), body]), reliable: false }];
  const cnt = Math.ceil(body.length / PIECE);
  if (cnt > MAX_PIECES) return [{ buf: Buffer.concat([Buffer.from([W1]), body]), reliable: true }];   // huge: reliable copes with any size
  const id = nextId = (nextId + 1) >>> 0 || 1, out = [];
  for (let i = 0; i < cnt; i++) {
    const h = Buffer.alloc(7); h[0] = W2; h.writeUInt32LE(id, 1); h[5] = i; h[6] = cnt;
    out.push({ buf: Buffer.concat([h, body.subarray(i * PIECE, (i + 1) * PIECE)]), reliable: false });
  }
  return out;
}

// One per remote player: puts pieces back together. A message with a missing piece is dropped after a second
// (the next snapshot replaces it anyway).
class Assembler {
  constructor() { this.parts = new Map(); this.split = 0; this.splitLost = 0; this.lastSize = 0; }   // v1.2.9: split = messages put back together from pieces, splitLost = ones a piece never came for (network window)
  // Returns the parsed message, or null (not complete yet / unreadable).
  take(buf, now = Date.now()) {
    try {
      if (!buf.length) return null;
      this.lastSize = buf.length;   // (v1.2.9: wire size of the message just returned, all pieces together: network window)
      if (buf[0] === 0x7b) return JSON.parse(buf.toString('utf8'));
      if (buf[0] === 1) return JSON.parse(zlib.inflateRawSync(buf.subarray(1)).toString('utf8'));
      if (buf[0] === 3) return DICT ? JSON.parse(zlib.inflateRawSync(buf.subarray(1), ZIN).toString('utf8')) : null;
      if ((buf[0] !== 2 && buf[0] !== 4) || buf.length < 8 || (buf[0] === 4 && !DICT)) return null;
      const id = buf.readUInt32LE(1), idx = buf[5], cnt = buf[6];
      if (!cnt || idx >= cnt || cnt > MAX_PIECES) return null;
      let e = this.parts.get(id);
      if (!e) { e = { at: now, cnt, got: 0, bufs: new Array(cnt), d: buf[0] === 4 }; this.parts.set(id, e); }
      if (e.cnt !== cnt || e.bufs[idx]) return null;
      e.bufs[idx] = buf.subarray(7); e.got++; e.sz = (e.sz || 0) + buf.length;
      if (e.got < cnt) { this.sweep(now); return null; }
      this.parts.delete(id); this.split++; this.lastSize = e.sz;
      return JSON.parse(zlib.inflateRawSync(Buffer.concat(e.bufs), e.d ? ZIN : {}).toString('utf8'));
    } catch { return null; }
  }
  sweep(now) { if (this.parts.size > 2) for (const [id, e] of this.parts) if (now - e.at > 1000) { this.parts.delete(id); this.splitLost++; } }
}

module.exports = { packMessage, Assembler, PIECE, WHOLE, hasDict: !!DICT };
