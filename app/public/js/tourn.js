// v1.2.26 Tournament mode (Devin): deathmatch rules, but every round each player fights in their own 1v1 arena.
// All arenas use the same map in the same place, as separate "dimensions": a player only collides with, hits, sees and
// targets the players, units, shots and walls of their own arena (p.arena; units take their owner's). Everyone starts with
// settings.tLives lives (default 4); losing your arena costs one, and at 0 you're knocked out. Losers pick a card after each
// round. With teams on (settings.tTeams) arenas pair players from different teams, a player who wins their arena is sent
// to help an ally whose arena is still fighting, and allies can trade cards from their draws during the pick (giftOffer).
export const TOURN = {
  lives: 4,          // default losses before you're out (lobby: 1-10)
  quiet: 10,         // an arena where nobody has dealt damage for this long (only units left) is a draw
};

export const tournOn = g => !!g && g.settings.mode === 'tourn';
export const tournTeams = g => tournOn(g) && !!g.settings.tTeams;
export const livesOf = g => Math.max(1, Math.min(10, Math.round(g.settings.tLives || TOURN.lives)));

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
  g.tArenas.forEach((A, i) => {
    if (A.done) return;
    const ps = g.players.filter(p => p.kind === 'hero' && p.arena === i && live(p));
    const keys = new Set(ps.map(p => g.scoreKey(p)));
    if (keys.size >= 2) { fighting++; return; }
    let w = keys.size === 1 ? [...keys][0] : null;
    if (keys.size === 0) {   // everyone in it is down: units still standing decide, a units-only standoff is a draw
      const side = new Map();
      for (const u of g.players) {
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
  if (!fighting && g.tArenas.every(A => A.done)) g.endRound(null);
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
  p.arena = dest;
  for (const u of g.players) if (u.transient && u.ownerId === p.id && u.alive) u.alive = false;   // (your units stay behind: they go)
  if (spot) { p.pos = { x: spot.x, y: spot.y || 0, z: spot.z }; p.vel = { x: 0, y: 0, z: 0 }; }
  p.fx.invulnT = g.time + 1;
  g.emit({ t: 'tMove', p: p.id, a: dest, x: p.pos.x, y: p.pos.y, z: p.pos.z });
}

// After the round: losers lose a life (a draw costs nobody one), the knocked out leave, losers pick a card.
export function tournAfter(g) {
  const losers = [];
  for (const A of g.tArenas || []) {
    if (A.winner == null) continue;
    for (const id of A.ids) {
      const p = g.player(id);
      if (!p || g.scoreKey(p) === A.winner) continue;
      p.tLives = Math.max(0, (p.tLives ?? livesOf(g)) - 1);
      if (p.tLives <= 0 && !p.tko) { p.tko = true; g.emit({ t: 'tKO', p: p.id }); }
      else losers.push(p);
    }
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

// Snapshot row: [id, arena, lives, knocked out] for every player, the arenas still fighting, done flags per arena, teams on
export function tournRows(g) {
  if (!tournOn(g)) return null;
  const rows = g.players.filter(p => p.kind === 'hero').map(p => [p.id, p.arena ?? -1, p.tLives ?? livesOf(g), p.tko ? 1 : 0]);
  return { p: rows, n: (g.tArenas || []).filter(A => !A.done).length, a: (g.tArenas || []).length, L: livesOf(g), d: (g.tArenas || []).map(A => A.done ? 1 : 0), T: tournTeams(g) ? 1 : 0 };
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
