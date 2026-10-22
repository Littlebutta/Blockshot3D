// v1.2.26 Tournament mode (Devin): deathmatch rules, but every round each player fights in their own 1v1 arena.
// All arenas use the same map in the same place, as separate "dimensions": a player only collides with, hits, sees and
// targets the players, units, shots and walls of their own arena (p.arena; units take their owner's). Everyone starts with
// settings.tLives lives (default 4); losing your arena costs one, and at 0 you're knocked out. Losers pick a card after each
// round. With teams on (settings.tTeams) arenas pair players from different teams, a player who wins their arena is sent
// to help an ally whose arena is still fighting, and allies can trade cards from their draws during the pick (giftOffer).
export const TOURN = {
  lives: 4,          // default losses before you're out (lobby: 1-10)
  quiet: 10,         // an arena where nobody has dealt damage for this long (only units left) is a draw
  intro: 15,         // v1.2.28: seconds of matchup screen (opponent's model + cards) before each round's 3-2-1
};
// v1.2.28: what the 'round' event carries for the matchup screen
export const tournIntroInfo = g => tournOn(g) && g.tArenas ? { ti: TOURN.intro, tA: g.tArenas.map(A => A.ids) } : null;

export const tournOn = g => !!g && g.settings.mode === 'tourn';
export const tournTeams = g => tournOn(g) && !!g.settings.tTeams;
export const livesOf = g => Math.max(1, Math.min(99, Math.round(g.settings.tLives || TOURN.lives)));   // (v1.2.29: up to 99 after extensions)

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pairKey = (a, b) => a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;

// Split the players still in into arenas: pairs (a 3-way arena when the count is odd). Teams: each pair is from two
// different teams; anyone left over (only one team has players left to place) joins an arena with a teammate in it.
// Prefers pairs that haven't met yet.
export function tournPair(g, heroes) {
  const seen = g.tMet || (g.tMet = new Map());
  const cost = arenas => { let c = 0; for (const A of arenas) for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) c += seen.get(pairKey(A[i], A[j])) || 0; return c; };
  let best = null, bc = Infinity;
  for (let t = 0; t < 24 && bc > 0; t++) {
    const arenas = tournTeams(g) ? teamPairs(g, heroes) : ffaPairs(heroes);
    const c = cost(arenas);
    if (c < bc) { bc = c; best = arenas; }
  }
  for (const A of best) for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) { const k = pairKey(A[i], A[j]); seen.set(k, (seen.get(k) || 0) + 1); }
  return best;
}
function ffaPairs(heroes) {
  const h = shuffle(heroes.slice()), out = [];
  for (let i = 0; i + 1 < h.length; i += 2) out.push([h[i], h[i + 1]]);
  if (h.length % 2) { if (out.length) out[Math.floor(Math.random() * out.length)].push(h[h.length - 1]); else out.push([h[0]]); }
  return out;
}
function teamPairs(g, heroes) {
  const teams = new Map();
  for (const p of shuffle(heroes.slice())) { const k = g.scoreKey(p); if (!teams.has(k)) teams.set(k, []); teams.get(k).push(p); }
  const out = [];
  for (;;) {
    const live = [...teams.values()].filter(l => l.length).sort((a, b) => b.length - a.length || Math.random() - 0.5);
    if (live.length < 2) break;
    out.push([live[0].pop(), live[1].pop()]);
  }
  for (const l of teams.values()) for (const p of l) {
    const k = g.scoreKey(p), mates = out.filter(A => A.some(q => g.scoreKey(q) === k));
    const pool = mates.length ? mates : out;
    if (pool.length) pool[Math.floor(Math.random() * pool.length)].push(p); else out.push([p]);
  }
  return out;
}

// Round start: give everyone their arena and lives. Returns the arenas (lists of players).
export function tournStart(g, heroes) {
  for (const p of g.players) if (p.kind === 'hero' && p.tLives === undefined) p.tLives = livesOf(g);
  const arenas = tournPair(g, heroes);
  g._ap = null;
  g.tArenas = arenas.map((A, i) => { for (const p of A) p.arena = i; return { ids: A.map(p => p.id), done: false, winner: null }; });
  for (const p of g.players) if (p.kind === 'hero' && !heroes.includes(p)) p.arena = null;   // knocked out: watching
  g.tQuietT = null;
  return arenas;
}

// The arena a player (or a unit, through its owner) is in.
export function arenaOf(g, p) {
  if (!p) return null;
  if (p.arena !== undefined && p.arena !== null) return p.arena;
  const o = p.ownerId ? g.player(p.ownerId) : null;
  return o ? o.arena ?? null : null;
}

const live = p => p.alive || p.reviving;
// Units that win an arena for their owner when every player in it is down (like the regular round end)
const ARENA_UNITS = new Set(['turret', 'blockTurret', 'mount', 'critter', 'clone', 'twin', 'drone', 'bigbro']);

// checkRoundEnd for tournaments: arenas finish one by one; the round ends when they all have.
export function tournCheck(g) {
  let fighting = 0;
  const pools = g.arenaPools();   // (v1.2.35: each arena's own list, not every player for every arena)
  g.tArenas.forEach((A, i) => {
    if (A.done) return;
    const pool = pools.get(i) || [];
    const ps = pool.filter(p => p.kind === 'hero' && live(p));
    const keys = new Set(ps.map(p => g.scoreKey(p)));
    if (keys.size >= 2) { fighting++; return; }
    let w = keys.size === 1 ? [...keys][0] : null;
    if (keys.size === 0) {   // everyone in it is down: units still standing decide, a units-only standoff is a draw
      const side = new Map();
      for (const u of pool) {
        if (!u.alive || !u.transient || !ARENA_UNITS.has(u.kind) || arenaOf(g, u) !== i) continue;
        const o = g.player(u.ownerId || u.kingOf), k = o && g.scoreKey(o);
        if (k) side.set(k, (side.get(k) || 0) + Math.max(0, u.hp));
      }
      if (side.size > 1) {
        A.unitsT = A.unitsT ?? g.time;
        if (g.time - Math.max(A.unitsT, g.lastDmgT ?? -1e9) < TOURN.quiet) { fighting++; return; }
      } else if (side.size === 1) w = [...side.keys()][0];
    }
    A.done = true; A.winner = w;
    if (w != null && w in g.scores) g.scores[w]++;
    g.emit({ t: 'tArena', a: i, w, left: g.tArenas.filter(x => !x.done).length });
    if (tournTeams(g) && w != null) for (const p of ps) helpAlly(g, p, i);
  });
  if (!fighting && g.tArenas.every(A => A.done)) {
    // v1.2.29 (Devin): the round end says who won and who lost a life (it used to read "Draw" every time)
    const o = tournOutcome(g);
    g.endRound(null, { tw: [...o.won], tl: [...o.lost] });
  }
}
// v1.2.29: who won and who lost this round, by score key (a player, or a team with teams on). A side loses only when
// every arena it fought in was won by someone else (teams: every player on it lost); a drawn arena costs nobody.
export function tournOutcome(g) {
  const won = new Set(), fought = new Map();
  for (const A of g.tArenas || []) {
    if (A.winner != null) won.add(A.winner);
    for (const id of A.ids) {
      const p = g.player(id); if (!p) continue;
      const k = g.scoreKey(p), f = fought.get(k) || { all: true };
      if (A.winner == null || A.winner === k) f.all = false;
      fought.set(k, f);
    }
  }
  const lost = new Set([...fought].filter(([k, f]) => f.all && !won.has(k)).map(([k]) => k));
  return { won, lost };
}

// Teams: the winners of an arena go to help an ally (a teammate) whose arena is still fighting.
function helpAlly(g, p, from) {
  const k = g.scoreKey(p);
  const open = g.tArenas.map((A, i) => i).filter(i => i !== from && !g.tArenas[i].done && g.players.some(q => q.kind === 'hero' && q.arena === i && live(q) && g.scoreKey(q) === k));
  if (!open.length) return;
  const dest = open[Math.floor(Math.random() * open.length)];
  const foes = g.players.filter(q => q.arena === dest && live(q) && g.scoreKey(q) !== k);
  // the spawn spot furthest from the fight there
  let spot = null, bd = -1;
  for (const s of g.tSpots || []) {
    const d = foes.length ? Math.min(...foes.map(q => Math.hypot(q.pos.x - s.x, q.pos.z - s.z))) : 0;
    if (d > bd) { bd = d; spot = s; }
  }
  p.arena = dest; g._ap = null;
  for (const u of g.players) if (u.transient && u.ownerId === p.id && u.alive) u.alive = false;   // (your units stay behind: they go)
  if (spot) { p.pos = { x: spot.x, y: spot.y || 0, z: spot.z }; p.vel = { x: 0, y: 0, z: 0 }; }
  p.fx.invulnT = g.time + 1;
  g.emit({ t: 'tMove', p: p.id, a: dest, x: p.pos.x, y: p.pos.y, z: p.pos.z });
}

// After the round: losers lose a life (a draw costs nobody one), the knocked out leave, losers pick a card.
// v1.2.29 teams: a team shares one loss count; it only loses a life when every player on it lost their arena.
export function tournAfter(g) {
  const { lost } = tournOutcome(g), losers = [];
  for (const k of lost) {
    const ps = g.players.filter(p => p.kind === 'hero' && !p.tko && g.scoreKey(p) === k);
    const left = Math.max(0, Math.min(...ps.map(p => p.tLives ?? livesOf(g))) - 1);
    for (const p of ps) {
      p.tLives = left;
      if (left <= 0) { p.tko = true; g.emit({ t: 'tKO', p: p.id }); }
    }
  }
  // the players who lost their own arena pick a card (teams too, even when an ally saved the team's life)
  for (const A of g.tArenas || []) if (A.winner != null) for (const id of A.ids) {
    const p = g.player(id);
    if (p && !p.tko && g.scoreKey(p) !== A.winner && !losers.includes(p)) losers.push(p);
  }
  const inPlay = g.heroes().filter(p => p.connected && !p.tko), keys = new Set(inPlay.map(p => g.scoreKey(p)));
  if (keys.size <= 1) {
    g.phase = 'over';
    g.winner = keys.size ? [...keys][0] : Object.keys(g.scores).sort((a, b) => g.scores[b] - g.scores[a])[0];
    g.emit({ t: 'over', w: g.winner, tally: g.tallyList(), tourn: 1 });
    return;
  }
  if (!losers.length) { g.startRound(); return; }
  g.offerCards(losers.filter(p => p.connected));
}

// v1.2.29 (Devin): "Keep playing" after a tournament: everyone gets that many more losses, the knocked out come back.
export function tournExtend(g, extra) {
  extra = Math.max(1, extra | 0);
  g.settings.tLives = livesOf(g) + extra;
  for (const p of g.players) if (p.kind === 'hero') { p.tLives = (p.tLives ?? 0) + extra; p.tko = false; }
  g.winner = null;
  g.emit({ t: 'extend', goal: livesOf(g), tourn: 1, add: extra });
  g.startRound();
  return true;
}

// Snapshot row: [id, arena, lives, knocked out] for every player, the arenas still fighting, done flags per arena, teams on
// v1.2.35: the same object until something in it changes (quick signatures first), so a 1000-player table isn't rebuilt,
// copied to the page and compared every frame. The player rows (p) change only at round ends; the arenas' done flags
// change all round, so the snapshot sends them apart (sim.js snapshot tn / tq). Their .sig (not sent) tells the snapshot
// encoder they're unchanged.
const sigOf = (o, sig) => { Object.defineProperty(o, 'sig', { value: sig, enumerable: false }); return o; };
export function tournRows(g) {
  if (!tournOn(g)) return null;
  const A = g.tArenas || [], L = livesOf(g);
  let h = L * 7, n = 0, k = 0, hd = A.length * 31 + (tournTeams(g) ? 1 : 0);
  for (const p of g.players) if (p.kind === 'hero') { k++; h = (Math.imul(h, 16777619) ^ ((p.arena ?? -1) * 4099 + (p.tLives ?? L) * 3 + (p.tko ? 1 : 0))) | 0; }
  for (let i = 0; i < A.length; i++) if (A[i].done) hd = (Math.imul(hd, 16777619) ^ (i + 1)) | 0; else n++;
  const sp = h + ':' + k, sig = sp + '/' + hd + ':' + n, old = g._tnRows;
  if (old && old.sig === sig) return old;
  const rows = old && old.p.sig === sp ? old.p : sigOf(g.players.filter(p => p.kind === 'hero').map(p => [p.id, p.arena ?? -1, p.tLives ?? L, p.tko ? 1 : 0]), sp);
  return g._tnRows = sigOf({ p: rows, n, a: A.length, L, d: A.map(x => x.done ? 1 : 0), T: tournTeams(g) ? 1 : 0 }, sig);
}
// the snapshot's halves: the arenas (tn) and the player rows (tq)
export function tournSnap(g) {
  const T = tournRows(g); if (!T) return [null, null];
  if (g._tnSnap && g._tnSnap[2] === T) return g._tnSnap;
  const { p, ...rest } = T;
  return g._tnSnap = [sigOf(rest, T.sig), p, T];
}

// ---- card trades between allies during the pick (teams): offer one card from your draw; the ally answers with one of theirs
export function giftOffer(g, fromId, toId, cardId) {
  const a = g.player(fromId), b = g.player(toId);
  if (!tournTeams(g) || g.phase !== 'picking' || !a || !b || a === b || g.scoreKey(a) !== g.scoreKey(b)) return false;
  if (!a.offer || !a.offer.includes(cardId) || a.picked) return false;
  if (!b.offer || b.picked || b.giftIn) { g.emit({ t: 'giftFail', from: a.id, to: b.id, busy: b.giftIn ? 1 : 0 }); return false; }   // (they already picked, or are answering another offer)
  b.giftIn = { from: a.id, card: cardId };
  g.emit({ t: 'gift', from: a.id, to: b.id, c: cardId });
  if (b.isBot) giftBotAnswer(g, b);
  return true;
}
// The receiver swaps one card of their own draw for the offered one; the giver gets that card in its place.
export function giftAccept(g, toId, giveId) {
  const b = g.player(toId), G = b && b.giftIn, a = G && g.player(G.from);
  if (!G || !a || g.phase !== 'picking') return false;
  b.giftIn = undefined;
  if (!a.offer || !a.offer.includes(G.card) || !b.offer || !b.offer.includes(giveId) || a.picked || b.picked) { g.emit({ t: 'giftGone', from: a.id, to: b.id }); return false; }
  a.offer = a.offer.map(c => c === G.card ? giveId : c);
  b.offer = b.offer.map(c => c === giveId ? G.card : c);
  g.onOffer(a); g.onOffer(b);
  g.emit({ t: 'giftDone', from: a.id, to: b.id, c: G.card, back: giveId });
  return true;
}
export function giftDecline(g, toId) {
  const b = g.player(toId), G = b && b.giftIn;
  if (!G) return false;
  b.giftIn = undefined;
  g.emit({ t: 'giftNo', from: G.from, to: b.id, c: G.card });
  return true;
}
// Bots take an ally's card when it's rarer than their weakest one, giving that one back.
function giftBotAnswer(g, b) {
  const R = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }, rk = id => R[(g.cardById.get(id) || {}).rarity] ?? 0;
  const G = b.giftIn, worst = b.offer.slice().sort((x, y) => rk(x) - rk(y))[0];
  if (worst && rk(G.card) > rk(worst)) giftAccept(g, b.id, worst); else giftDecline(g, b.id);
}
