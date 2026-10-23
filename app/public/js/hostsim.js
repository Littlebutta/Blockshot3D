// =====================================================================
// v1.2.30: the host's match (sim.js Game) and everything it needs to run it: stepping, joiners' inputs (held back
// for jitter), the host's own view of the match, snapshots for joiners, card picks, joins and leaves. No DOM and no
// three.js, so it runs either on the page's thread or on a thread of its own (simworker.js, through simlink.js),
// leaving the page's thread to draw. Either way it's the same code; only where it runs changes.
//
// Out (emit): ['net', message]  send this through the network (host only)
//             ['ui', message]   to the host's own screen, like a joiner gets it (offer, comboAsk, breakAsk, note)
//             ['frame', {...}]  the host's view after a frame: view, events, level (when it changed), mirror
//             ['departed', { id, rec }]  a leaver's build, kept for when they come back
// =====================================================================
import { RULES } from './config.js';
import { Game } from './sim.js';
import { AckEncoder } from './netcodec.js';
import { telegraphRows, shockRows, bossRow } from './coop.js';
import { owView, owLootPick } from './openworld.js';
import { coreRows } from './core.js';
import { bItemRows, BRAWL } from './brawl.js';
import { budgetRow } from './budget.js';
import { TOURN_FLOW, tournRows, giftOffer, giftAccept, giftDecline } from './tourn.js';
import { ViewPacker } from './viewpack.js';
import { ShardSet } from './shard.js';

// Co-op wave bots (raiders, Elites, wave turrets and drones; not anyone's commander units) wear raider markings.
export const isRaider = (kind, transient, ownerId) => !!transient && !ownerId && ['wave', 'elite', 'turret', 'drone'].includes(kind);
// v1.2.36: tournament events every joiner gets whichever arena they watch: the match's flow, picks and cards, the unit
// roster, revives and respawns, chat-like ones (the rest, from sparks to card effects, only go to that arena's watchers)
// (v1.2.37: the flow ones are tourn.js TOURN_FLOW; the rest here carry their arena, and screens mute them when it isn't theirs)
const TOURN_ALL = new Set([...TOURN_FLOW, 'respawn', 'revive', 'revived', 'reviving', 'reviveStart', 'rewind', 'modBroken', 'cloneInherit']);
export function viewOfPlayer(g, p) {
  return {
    id: p.id, name: p.name, color: p.color, team: p.team, pos: p.pos, vel: p.vel, aim: p.aim, aimPoint: p.aimPoint,
    ...(g.isBrawl() && p.kind === 'hero' ? { pct: Math.round(p.pct || 0), stocks: p.stocks || 0, fighter: p.fighter || 'classic' } : {}),   // brawl: damage % tag instead of health (the host's own view; peers get it from the snapshot)
    hp: p.hp, maxHp: Math.round(p.stats.health), alive: p.alive, blocking: g.shielded(p), flags: g.playerFlags(p), ammo: p.ammo, maxAmmo: Math.round(p.stats.ammo),
    reloadFrac: p.reloadT > 0 ? p.reloadT / p.stats.reloadTime : 0, blockFrac: p.blockCdT > 0 ? p.blockCdT / p.stats.blockCooldown : 0,
    flash: p.flashT > 0, sky: p.stats.skyfall > 0, size: p.size, blockSize: p.stats.blockSize || 1,
    kind: p.kind, am: p.am, cosmetics: p.cosmetics, alive: p.alive && !p.reviving, maxHp: Math.round(g.maxHp(p)),
    raider: isRaider(p.kind, p.transient, p.ownerId),
    mod: p.mod, charge: p.fx.charging ? p.fx.chargeShots : 0, broken: p.mod === 'shield' && (p.fx.shieldBrokenT || 0) > g.time,
    status: (g.burning(p) ? 1 : 0) | (p.fx.poisonS || (p.fx.toxT || 0) > g.time ? 2 : 0) | ((p.fx.chillT || 0) > g.time ? 4 : 0) | ((p.fx.hexT || 0) > g.time ? 8 : 0) | ((p.fx.wetT || 0) > g.time ? 16 : 0),
    bulletSpeed: p.stats.bulletSpeed, bulletGrav: g.bulletGrav(p),
    riotFrac: g.riotFrac(p), pillarFrac: g.pillarFrac(p), healN: p.healN || 0, critters: p.mod === 'critter' ? g.critterCount(p) : -1,
    blockFx: (p.stats.blockShock > 0 ? 1 : 0) | (p.stats.blockLeech > 0 ? 2 : 0) | (p.stats.blockDeploy > 0 ? 4 : 0),
    fieldR: g.slowFieldRadius(p.stats.slowField || 0),
    ...extFields(g.extRow(p)),
  };
}
// Katana charge, slash counter, Super Saiyan Hair pool and the hold-to-charge flag (sim.js extRow).
export function extFields(x) {
  const [k, sn, hf, hp, hm, hold, ts, holy, mnt, nc] = x || [];
  return { kCharge: k ?? -1, slashN: sn || 0, hairFrac: hf ?? -1, hairHp: hp || 0, hairMax: hm || 0, holding: !!hold, holdHoly: hold === 2,
    tsFrac: ts ?? -1, holyShield: !!((holy || 0) & 1), robe: !!((holy || 0) & 2), mount: mnt || null, nc: ncFields(nc) };
}
// v1.2.15 round-2 cards (sim.js ncRow): flags, Pressure Stack, Battle Rhythm, Gambler's Mag roll, Gilded Shells, Ascension, Purge Pulse
export function ncFields(x) {
  if (!x) return null;
  const [f, press, rhy, gam, shell, asc, purge] = x;
  return { bounty: !!(f & 1), od: !!(f & 2), rooted: !!(f & 4), cold: !!(f & 8), salvo: !!(f & 16), rhyReady: !!(f & 32), lastRound: !!(f & 64),
    press: press || 0, rhy: rhy ?? -1, gam: gam ?? -1, shell: shell || 0, ascTier: (asc || 0) & 3, ascRounds: (asc || 0) >> 2, purge: purge || 0 };
}

// The host's view of one tournament arena (sc: { ps, a }), or with no sc of everything: the part an arena shard makes
// (shard.js) for the arena the host's screen shows
export function arenaView(g, sc) {
  const F = sc ? L => L.filter(x => g.seenIn(x, sc.a)) : L => L;
  return {
    players: (sc ? sc.ps : g.players).filter(p => p.connected).map(p => viewOfPlayer(g, p)),
    bullets: F(g.bullets).map(b => ({ id: b.id, pos: b.pos, vel: b.vel, ring: b.ring || 0, r: b.hold ? b.r * (1 - b.hold.t / b.hold.dur) : b.r, color: b.color, fx: b.fx, tgt: b.swarm === 'bee' && b.swTgt ? b.swTgt.id : 0, o: b.owner })),
    dynamics: (sc ? g.dyn.filter(o => o.arena === undefined || o.arena === sc.a) : g.dyn).map(o => ({ id: o.id, x: o.pos.x, y: o.pos.y, z: o.pos.z, h: o.h, tip: o.tipped || 0, tx: o.tx || 0, tz: o.tz || 0 })),
    shields: F(g.shields).map(sh => ({ id: sh.id, x: sh.x, y0: sh.y0, z: sh.z, w: sh.w, h: sh.h, d: sh.d, ang: sh.ang || 0, shock: !!sh.shock, leech: !!sh.leech, box: !!sh.box, hp: sh.box ? Math.max(0, sh.hp) / sh.maxHp : 1, color: (g.player(sh.owner) || {}).color || '#ffffff', o: sh.owner })),
    mines: F(g.mines).map(m => ({ id: m.id, x: m.x, y: m.y, z: m.z, armed: m.armT <= 0, sz: m.sz || 1, snare: !!m.snare, color: (g.player(m.owner) || {}).color || '#ffffff', o: m.owner })),   // (the page hides enemies' Snare Plates: main.js friendOf)
    barricades: F(g.barricades).map(b => ({ id: b.id, kind: b.kind, x: b.x, y0: b.y0, z: b.z, len: b.len, h: b.h, th: b.th, ang: b.ang, hp: Math.max(0, b.hp) / b.maxHp, color: b.ownerRef.color, o: b.owner })),
    trapT: g.level && g.level.traps ? g.time : null,
    rituals: g.rituals.length ? g.ritualRows(sc) : null, relics: g.relics.length ? g.relicRows(sc) : null,
    bud: budgetRow(g),
  };
}
const NO_ARENA = { players: [], bullets: [], dynamics: [], shields: [], mines: [], barricades: [], trapT: null, rituals: null, relics: null, bud: null };

// v1.2.9: joiners' inputs are used for as long as they were held, not from whenever each one happened to arrive. With uneven
// delivery (jitter) the host used to apply one input 40 ms and the next 0 ms, so its idea of where you were drifted from your
// own prediction and your view was pulled around at every snapshot (it was smooth once you died). Each input carries its
// send time; the host holds each input until send time + a hold-back covering 97% of the recent (2 s) arrival - send spread
// (at most 40 ms over the smallest), then applies it at that point inside the frame's steps (frame, releaseInputs).
// (All times here are the page's clock: the page passes them in, a worker's own clock starts elsewhere.)
function queueInput(g, a, from, i, now, fwd) {   // (v1.2.37 fwd(release, id, input): the same input to an arena shard)
  if (!(i.t > 0)) { g.setInput(from, i); if (fwd) fwd(0, from, i); return; }
  const o = now - i.t, dl = a.dl ||= []; dl.push(o); if (dl.length > 120) dl.shift();
  // v1.2.9: the hold-back (a.hold) moves only when the wanted one is well off (6 ms): every change moves where an input lands
  // on the host's step grid and so how long it seems to be held, which came back to the joiner as a correction
  if (a.hold == null || !(now - a.mT < 500)) {
    a.mT = now; const so = dl.slice().sort((x, y) => x - y), want = Math.min(so[0] + 40, so[Math.floor(so.length * 0.97)]);
    if (a.hold == null || Math.abs(want - a.hold) > 6) a.hold = want;
  }
  const r = Math.min(now + 60, i.t + a.hold), Q = a.inq ||= [];
  // v1.2.9: a late one is queued too (not applied at once): applied between frames it took effect a step earlier than the
  // same release time would through releaseInputs (which rounds to the nearest step), so its length on the host was off by a step
  if (i.q < (a.appQ || 0)) return;
  let k = Q.length; while (k > 0 && Q[k - 1][2].q > i.q) k--; Q.splice(k, 0, [r, from, i]);
  if (fwd) fwd(r, from, i);
}
function releaseInputs(g, acks, w) {
  for (const a of acks.values()) { const Q = a.inq; while (Q && Q.length && Q[0][0] <= w) { const [, f, x] = Q.shift(); g.setInput(f, x); if (x.q > (a.appQ || 0)) a.appQ = x.q; } }
}

export class HostSim {
  // o: { roster, settings, cards, localId, host (true: joiners to send to), practiceCards }
  constructor(o, emit) {
    this.emit = emit; this.localId = o.localId; this.host = !!o.host; this.inline = !!o.inline;
    this.outEvents = []; this.sendT = 0; this.snapN = 0; this.acks = null; this.enc = null; this.peerE = new Map(); this.levelVersion = -1;
    this.nsRows = null; this.hf = null;
    this.watch = undefined; this.peerWatch = new Map(); this.lastTn = undefined;   // (v1.2.35: the tournament arena each screen shows)
    this.packer = this.inline ? null : new ViewPacker();   // (v1.2.31: on its own thread, the view crosses packed: viewpack.js)
    const g = this.g = new Game({ roster: o.roster, settings: o.settings, cards: o.cards, onOffer: p => this.onOffer(p), onCombo: (p, C) => this.toPlayer(p, { k: 'comboAsk', combo: C.id }), onBreak: (p, opts) => this.toPlayer(p, { k: 'breakAsk', opts }) });
    // v1.2.37: a big tournament's arenas run on every CPU core (shard.js): o.shards = how many (1 or none: all here)
    if (g.tourn && o.shards > 1) {
      const mk = typeof Worker !== 'undefined' && !this.inline ? () => new Worker(new URL('./shardworker.js', import.meta.url), { type: 'module' }) : null;
      this.shardN = o.shards; this.shardMk = mk; this.cards = o.cards;
      const sr = g.startRound.bind(g);
      g.startRound = () => { sr(); this.roundStarted(); };
      g.shardWait = () => !!(this.shards && this.shards.tok && !this.finalsDone);
    }
    this.practice = o.settings.mode === 'practice' ? o.practiceCards || null : null;
    if (this.practice) g.practiceSetCards(this.localId, this.practice);
  }
  start() {
    this.g.start();
    if (this.practice) this.g.practiceSetCards(this.localId, this.practice);
  }
  // card offers, combo and Scrap It questions: to the host's own screen or over the network
  toPlayer(p, msg) {
    if (p.id === this.localId) this.emit('ui', msg);
    else if (!p.isBot && this.host) this.emit('net', { t: 'toPeer', id: p.id, msg });
  }
  onOffer(p) { this.toPlayer(p, { k: 'offer', offer: p.offer, rerolls: p.rerollsLeft, info: this.g.offerInfo(p) }); }

  // ---------------------------------------------------------------- commands from the page
  cmd(c) {
    const g = this.g;
    switch (c.t) {
      case 'local': g.setInput(this.localId, c.i); if (this.shards) this.shards.input(this.localId, 0, c.i); break;
      case 'input': this.input(c.from, c.i, c.now); break;
      case 'frame': this.frame(c); break;
      case 'pick': g.pick(c.from, c.card); break;
      case 'reroll': g.reroll(c.from); break;
      case 'combo': g.comboChoice(c.from, !!c.accept); break;
      case 'break': g.breakChoice(c.from, c.card || null); break;
      case 'giftOffer': giftOffer(g, c.from, c.to, c.card); break;
      case 'giftAccept': giftAccept(g, c.from, c.card); break;
      case 'giftDecline': giftDecline(g, c.from); break;
      case 'loot': if (g.ow) owLootPick(g, c.from, c.card); break;
      case 'ev': this.outEvents.push(c.e); break;   // (emotes, bets: made on the page, sent to joiners with the next snapshot)
      case 'join': this.join(c); break;
      case 'leave': this.leave(c.id, c.token); if (this.shards) this.shards.cmd(c.id, { t: 'leave', id: c.id }); break;
      case 'practice': this.practice = c.list.slice(); g.practiceSetCards(this.localId, c.list); break;
      case 'resetDmg': { const p = g.player(this.localId); if (p) p.tally.damage = 0; break; }
      case 'setting': g.settings[c.k] = c.v; if (this.shards) this.shards.cmd(null, { t: 'setting', k: c.k, v: c.v }); break;
      case 'extend': g.extend(c.n); break;
      case 'retry': g.retryRound(); break;
      case 'netRows': this.nsRows = c.ns; this.hf = c.hf; break;
      case 'dropAck': if (this.acks) this.acks.delete(c.id); break;
      case 'watch': this.watch = c.a; break;   // v1.2.35: the tournament arena the host's screen shows (main.js viewArena)
    }
  }
  // v1.2.3: inputs travel unreliably and can arrive out of order: only the newest counts
  input(from, i, now) {
    const g = this.g, a = this.acks && this.acks.get(from);
    if (a && i.q != null) { if (a.inQ && i.q <= a.inQ && !(i.t > 0 && i.q > (a.appQ || 0))) return; if (!(i.q <= a.inQ)) a.inQ = i.q; }   // (v1.2.9: one that overtook another is still slotted in while it's held back)
    if (i.wa !== undefined) this.peerWatch.set(from, i.wa);   // v1.2.35: the tournament arena that joiner is watching
    const pe = this.peerE; if (Array.isArray(i.a)) pe.set(from, i.a[0]);   // v1.2.9: [match id, seq], or just seq for the match id last given
    const aq = Array.isArray(i.a) ? i.a[1] : typeof i.a === 'number' ? i.a : 0;
    if (a && aq && this.enc && pe.get(from) === this.enc.e && aq > a.q && aq <= this.enc.n) a.q = aq;
    const ak = Array.isArray(i.a) && i.a.length > 2 ? i.a[2] : i.ak;   // v1.2.12: the newest event batch it applied in order (netcodec.js encodeFor ek)
    if (a && ak > (a.k || 0) && this.enc && pe.get(from) === this.enc.e && ak <= this.enc.n) a.k = ak;
    const sh = this.shards && this.shards.tok ? this.shards : null, fwd = sh ? (r, id, x) => sh.input(id, r, x) : null;
    if (a) queueInput(g, a, from, i, now, fwd); else { g.setInput(from, i); if (fwd) fwd(0, from, i); }
  }
  // Someone joins a match in progress (main.js lateJoin did the lobby side and sent them 'start'): the level, everyone's
  // cards, then the roster entry; their seat (or their old one back, with their build when they're returning)
  join(c) {
    const g = this.g, { id, name, r, back } = c, old = g.player(id);
    if (g.seatsTaken() >= RULES.maxPlayers && !(old && !old.connected)) g.retireBot();
    if (this.host) {
      this.emit('net', { t: 'toPeer', id, msg: { k: 'level', level: g.levelForNet() } });
      this.emit('net', { t: 'toPeer', id, msg: { k: 'cardsAll', list: g.heroes().filter(p => p.id !== id).map(p => ({ p: p.id, cards: p.cards.slice(), s: g.statSummary(p) })) } });
      this.emit('net', { t: 'toAll', msg: { k: 'rosterAdd', r } });
    }
    if (this.acks) this.acks.delete(id);   // v1.2.3: the newcomer starts from a full snapshot
    if (old && !old.connected) { g.reconnect(id); old.name = name; }
    else g.addPlayer(r, back ? { cards: g.isOpen() ? [] : back.cards, tally: back.tally, rerollsLeft: back.rerollsLeft, oldKey: back.oldKey, score: back.score } : null);
    const p = g.player(id);
    if (this.host && p && p.picksOwed > 0) this.emit('net', { t: 'toPeer', id, msg: { k: 'note', text: `You'll get ${p.picksOwed} catch-up pick${p.picksOwed === 1 ? '' : 's'} at the next card screen, with 50% more time.` } });
  }
  leave(id, token) {
    const g = this.g, gp = g.player(id);
    if (this.acks) this.acks.delete(id);
    // remember their build so a reconnect picks up where they left off
    if (gp && token) this.emit('departed', { token, rec: { cards: gp.cards.slice(), tally: { ...gp.tally }, rerollsLeft: gp.rerollsLeft, team: gp.team, oldKey: g.scoreKey(gp), score: g.scores[g.scoreKey(gp)] || 0 } });
    g.removePlayer(id);
  }
  // v1.2.35: an event's tournament arena (null: every screen gets it). v1.2.36: every kind except the ones everyone needs
  // (TOURN_ALL); deaths only in big lobbies, where the kill feed of 500 arenas is noise. v1.2.37: the sim tags each event
  // with its arena (sim.js emit e.ar); the ids are the fallback for anything made outside it.
  evArena = e => {
    const g = this.g;
    if ((e.t === 'death' && g.players.length <= 60) || TOURN_ALL.has(e.t)) return null;
    if (e.ar != null) return e.ar;
    const id = e.p ?? e.by ?? e.o ?? e.src ?? e.k, p = id != null ? g.player(id) : null;
    return p && p.arena != null ? p.arena : null;
  };
  // v1.2.35 (1000-player lobbies): what one screen needs in the tournament: the arena it shows (its own, or the one it
  // watches once out), plus that player. Null outside the tournament: everything, as before. Before the first arenas are
  // drawn (the opening card pick) a screen gets only its own player.
  scopeFor(id, wa) {
    const g = this.g; if (!g.tourn) return null;
    const me = g.player(id), a = wa !== undefined && wa !== null && wa >= 0 ? wa : me ? me.arena : undefined;
    if (a === undefined || a === null) return { ps: me ? [me] : [], a: -2, k: 'p:' + id };
    const pool = g.pool({ arena: a }), ps = me && !pool.includes(me) ? [...pool, me] : pool;
    return { ps, a, k: me && me.arena !== a ? 'w' + a + ':' + id : a };   // (watching from outside: their own player rides along)
  }
  // what the page reads between frames (lobby seats, late joins, the practice panel)
  // v1.2.35: the hero list only when something in it changed (simlink.js keeps the last one): 1000 of them every frame was
  // a good part of what crossed to the page
  mirror() {
    const g = this.g, me = g.player(this.localId);
    let h = 0, n = 0;
    for (const p of g.players) if (p.kind === 'hero') { n++; h = (Math.imul(h, 16777619) ^ ((p.isBot ? 1 : 0) | (p.connected ? 2 : 0) | (p.retireNext ? 4 : 0) | ((p.team | 0) + 8) * 8)) | 0; }
    const sig = n + ':' + h, same = sig === this.heroSig; this.heroSig = sig;
    return {
      phase: g.phase, round: g.round, time: g.time, ow: !!g.ow,
      heroes: same ? undefined : g.heroes().map(p => ({ id: p.id, isBot: !!p.isBot, connected: !!p.connected, retireNext: !!p.retireNext, color: p.color, team: p.team })),
      me: me ? { cards: me.cards.slice(), dmg: me.tally.damage } : null,
    };
  }

  // ---------------------------------------------------------------- a frame
  // dt: real time since the last frame (up to 0.25 s). v1.2.6: the sim catches up in steps of 35 ms at most, so a long
  // frame no longer loses game time (it rubber-banded joiners and slowed the whole match on a slow host).
  // c: { dt, ts (slow motion), paused, t0 (page clock), hostFps, peers: [[id, rtt]], pz: names of who paused }
  frame(c) {
    const g = this.g, { dt, ts, paused, t0 } = c;
    g.hostFps = c.hostFps;   // (v1.2.25 shot budget)
    let sh = this.shards && this.shards.tok ? this.shards : null, shEv = null;
    if (sh) shEv = this.shardIn(sh);   // (v1.2.37: what the arena shards sent back since the last frame)
    if (this.shardPending && (g.phase === 'countdown' || g.phase === 'play')) { this.shardOut(); sh = this.shards; }
    const ph0 = g.phase, pt0 = g.phaseT;
    let w = t0 - dt * 1000;   // (v1.2.9: the wall-clock time each step covers, for joiners' held-back inputs: queueInput)
    if (!paused) for (let rem = dt * ts; rem > 1e-4;) { const st = Math.min(rem, 0.035); if (this.acks) releaseInputs(g, this.acks, w + st / ts * 500); w += st / ts * 1000; g.step(st); rem -= st; }
    else if (this.acks) releaseInputs(g, this.acks, t0);
    if (sh) {
      if (g.phase === 'roundEnd' && !this.finalsAsked) { this.finalsAsked = true; this.finalsDone = false; sh.askFinals(); }
      if (g.phase !== 'countdown' && g.phase !== 'play' && g.phase !== 'roundEnd') { sh.end(); g.sharded = false; sh = null; }   // (picks or the end: no arenas running)
      else sh.frame({ dt, ts, paused, t0, ph: ph0, pt: pt0, hostFps: c.hostFps }, this.shardWant(c.peers || []));   // (they work while this answers the page)
    }
    let level = null;
    if (g.levelVersion !== this.levelVersion) {
      this.levelVersion = g.levelVersion; level = g.levelForNet();
      if (this.host) this.emit('net', { t: 'toAll', msg: { k: 'level', level } });
    }
    const evs = g.takeEvents();
    if (shEv) for (const e of shEv) evs.push(e);
    if (this.host) this.outEvents.push(...evs);
    const sc = this.scopeFor(this.localId, this.watch);
    // v1.2.37 (Devin: other players' effects still showed): the host's own screen gets its arena's events only, like a joiner
    const evsOwn = sc ? evs.filter(e => { const a = this.evArena(e); return a == null || a === sc.a; }) : evs;
    const view = {
      phase: g.phase, phaseT: g.phaseT, scores: sc && g.players.length > 60 ? g.scopedScores(sc.ps) : g.scores, round: g.round,
      waiting: g.phase === 'picking' ? g.players.filter(p => !p.picked).length : 0,
      ...(sh ? this.shardView(sc) : arenaView(g, sc)),
      laser: g.hazard && g.hazard.type === 'laser' ? [g.hazard.pos, g.hazard.state === 'warn' ? 1 : g.hazard.state === 'on' ? 2 : 0] : null,
      telegraphs: g.telegraphs.length ? telegraphRows(g) : null, shocks: g.shockwaves.length ? shockRows(g) : null, boss: bossRow(g), final: g.isFinalRound(),
      ow: g.ow ? { ...owView(g), taken: g.ow.taken } : null,
      core: g.settings.core ? coreRows(g) : null,
      bitems: g.isBrawl() ? bItemRows(g) : null,
    };
    const sent = this.host ? this.send(c, dt, ts, t0) : 0;
    if (this.packer) this.packer.pack(view);
    const tn = tournRows(g), tnOut = tn !== this.lastTn ? tn : undefined; this.lastTn = tn;   // (v1.2.35: the table only when it changed)
    const shards = sh ? { n: sh.size, t: sh.threads, ms: sh.stat.ms.map(x => Math.round((x || 0) * 10) / 10), p: sh.stat.n.slice() } : null;
    this.emit('frame', { view, evs: evsOwn, level, levelObj: level && this.inline ? g.level : null, tn: tnOut, brawlRows: g.isBrawl() ? g.brawlRows() : null, brawlT: g.isBrawl() ? Math.max(0, Math.ceil(BRAWL.suddenT - g.time)) : null, mirror: this.mirror(), sent, shards });
  }

  // ---------------------------------------------------------------- v1.2.37 arena shards (shard.js)
  // A tournament round with more than 60 fighters runs its arenas in shards when there are threads for them
  roundStarted() {
    const g = this.g, n = g.heroes().filter(p => p.connected && !p.tko).length;
    if (n > 60 && g.tArenas && g.tArenas.length > 1) {
      if (!this.shards) this.shards = new ShardSet(this.shardN, g.settings, this.cards, this.shardMk);
      g.sharded = true; this.shardPending = true; this.finalsAsked = false; this.finalsDone = false;
    } else { g.sharded = false; this.shardPending = false; if (this.shards) this.shards.end(); }
  }
  // hand the arenas out (once the round's cards are in: the first round's pick comes after its start)
  shardOut() {
    const g = this.g; this.shardPending = false;
    g.unitsRemoved(); g.players = g.players.filter(p => !p.transient); g._ap = null;   // (the shards make the round's summons)
    g.shardUnits = this.shards.units;
    this.shards.startRound(g);
    g.unitsChanged();
  }
  // the shards' results: finished arenas, heroes moved to help an ally, unit lists, end-of-round tallies; returns their events
  shardIn(sh) {
    const g = this.g, { ev, done, unitsChanged, finals } = sh.take(), out = [];
    for (const [a, w] of done) {
      const A = g.tArenas && g.tArenas[a]; if (!A || A.done) continue;
      A.done = true; A.winner = w;
      if (w != null && w in g.scores) g.scores[w]++;
      g.emit({ t: 'tArena', a, w, left: g.tArenas.filter(x => !x.done).length });
    }
    for (const e of ev) {
      if (e.t === 'tMove') { const p = g.player(e.p); if (p) { p.arena = e.a; g._ap = null; } }
      else if (e.t === 'split') e.units = g.unitList();
      out.push(e);
    }
    if (unitsChanged) g.unitsChanged();
    if (finals && !this.finalsDone && sh.finalsIn) {
      for (const L of finals.values()) for (const [id, tally, alive, hp, pos, vel, arena] of L) {
        const p = g.player(id); if (!p) continue;
        p.tally = tally; p.alive = alive; p.hp = hp; p.pos = pos; p.vel = vel; p.arena = arena;
      }
      this.finalsDone = true; g._ap = null;
    }
    if (this.finalsAsked && !this.finalsDone && sh.finalsIn) this.finalsDone = true;   // (a shard that never answered: carry on)
    return out;
  }
  // which rows the shards should send: the arena on the host's screen, the ones joiners watch, and fighters watching
  // from another arena (each screen's own player rides along: scopeFor)
  shardWant(peers) {
    const g = this.g, sh = this.shards, sa = new Set(), ids = new Set(), wa = new Set();
    const hs = this.scopeFor(this.localId, this.watch), va = hs && hs.a >= 0 ? hs.a : null;
    if (va != null) wa.add(va);
    const rideAlong = (id, sc) => { const p = g.player(id); if (p && sc && p.arena !== sc.a && sh.of.has(id)) ids.add(id); };
    rideAlong(this.localId, hs);
    for (const [id] of peers) {
      const sc = this.scopeFor(id, this.peerWatch.get(id));
      if (sc && sc.a >= 0) { sa.add(sc.a); wa.add(sc.a); }
      rideAlong(id, sc);
    }
    return { va, sa: [...sa], ids: [...ids], wa: [...wa] };
  }
  // the host's view of its arena from the shard running it (a frame old), with its own player when it watches another
  shardView(sc) {
    const g = this.g, sh = this.shards;
    if (!sc || sc.a < 0) return arenaView(g, sc);
    const r = sh.rows.get(sc.a), part = r && r.v ? { ...r.v } : { ...NO_ARENA }, me = g.player(this.localId);
    if (me && me.connected && me.arena !== sc.a) { const x = sh.idRows.get(me.id); part.players = [...part.players, x ? x.v : viewOfPlayer(g, me)]; }
    return part;
  }
  // a joiner's snapshot of its arena, the same way
  shardSnap(sc, id) {
    const g = this.g, sh = this.shards;
    if (!sc || sc.a < 0) return null;
    const r = sh.rows.get(sc.a), part = r && r.s ? { ...r.s } : g.snapshotArena({ ps: [], a: sc.a }), me = g.player(id);
    if (me && me.connected && me.arena !== sc.a) {
      const x = sh.idRows.get(id);
      part.pl = [...part.pl, x ? x.s : g.snapRow(me)]; part.mv = [...(part.mv || []), ...(x ? x.mv : g.predRows([me]))];
    }
    return part;
  }
  // snapshots for joiners: returns how many went out this frame (0 or 1)
  send(c, dt, ts, t0) {
    const g = this.g;
    this.sendT -= dt;
    if (this.sendT > 0) return 0;
    // v1.2.25: big lobbies send fewer, fuller updates (30 a second up to 30 players, 20 up to 60, then 15), which keeps
    // each joiner's stream and the host's upload in check (every joiner gets the whole match)
    const np = g.players.length, hz = np <= 30 ? 30 : np <= 60 ? 20 : 15;
    this.sendT = this.sendT < -0.05 ? 1 / hz : this.sendT + 1 / hz;   // v30: keep an even rate (was reset each send, so it drifted to the frame rate)
    const ev = this.outEvents; this.outEvents = [];
    this.snapN++;
    if (!(c.peers && c.peers.length) && g.tourn) return 1;   // (v1.2.35: nobody to send a 1000-player tournament to: don't build it)
    const ns = this.nsRows && this.snapN % 30 === 0;
    const mk = (sc, id) => {
      const s = g.snapshot(sc, this.shards && this.shards.tok ? this.shardSnap(sc, id) : null);   // (v1.2.37: an arena in a shard: its rows)
      if (hz !== 30) s.hz = hz;
      s.pz = c.pz || [];
      s.tm = Math.round(t0);   // v1.2.6: when this state was taken (host clock), so joiners place things by it, not by arrival
      if (ts < 0.999) s.tk = Math.round(ts * 100) / 100;   // slow motion: joiners extrapolate slower too
      if (ns) { s.ns = this.nsRows; s.hf = this.hf; }   // everyone's connection, once a second (network window; v1.2.9 hf: host FPS, sim runs/s, updates/s)
      return s;
    };
    // v1.2.35: in the tournament each joiner gets the arena they're in or watching (one snapshot per arena being watched)
    const peers = c.peers || [], gkOf = new Map(), gaOf = new Map(), G = new Map();
    for (const [id] of peers) {
      const sc = this.scopeFor(id, this.peerWatch.get(id)), gk = sc ? sc.k : 0;
      gkOf.set(id, gk); gaOf.set(id, sc ? sc.a : null); if (!G.has(gk)) G.set(gk, mk(sc, id));
    }
    if (!G.size) G.set(0, mk(null));   // (nobody connected yet: still number the tick and keep its events)
    // v1.2.3: each player gets the changes since the newest snapshot THEY confirmed, sent unreliably (a lost one
    // is skipped, never resent), with any events they haven't confirmed riding along (netcodec.js AckEncoder)
    // (v1.2.35: joiners only get their arena's events: evArena)
    const enc = this.enc ||= new AckEncoder(), q = enc.push(G, ev, g.tourn ? this.evArena : null);
    this.acks ||= new Map();
    const same = new Map();   // v1.2.9: players who confirmed the same snapshot share one message (encodeFor), sent once to all of them
    for (const [id, rtt0] of peers) {
      let a = this.acks.get(id); if (!a) this.acks.set(id, a = { q: 0, since: q });
      // v1.2.12: unconfirmed events are resent about once a round trip (2-4 snapshots), not in every snapshot (netcodec.js)
      const rtt = rtt0 > 0 ? rtt0 : 150, rs = Math.min(4, Math.max(2, Math.ceil((rtt + 40) / 33)));
      const m = enc.encodeFor(a.q, a.since, a.k || 0, rs, gkOf.get(id), gaOf.get(id));
      if (m) { const l = same.get(m); if (l) l.push(id); else same.set(m, [id]); }
    }
    for (const [m, ids] of same) this.emit('net', ids.length > 1 ? { t: 'toPeerU', id: ids[0], ids, msg: { k: 'snap', s: m } } : { t: 'toPeerU', id: ids[0], msg: { k: 'snap', s: m } });
    return 1;
  }
}
