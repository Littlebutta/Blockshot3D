// =====================================================================
// AMON autobattler: the host simulation (no three.js, no DOM).
// Store phase: every player buys cards (unit groups and board tactics) and arranges them on a 5x5 board.
// Battle phase: every player's board fights its own copy of the Game Master's wave on a large map;
// when a field is decided, whatever survives walks onto another field, until only one side is left.
// Enemies still standing at the end cost the team health by their value. Round 20: Amon.
// =====================================================================
import { AMON, TIER_ODDS, UNITS, ENEMIES, BOSSES, UNIT_BY_ID, corrupted, unitValue, patternCells, squareBonus, rankCount, cardValue, preferredRow, buildAmonCards, SQUAD_TAGS, SQUAD_MAX, FACTIONS, FACTION_BY_ID, factionUnits, BUFF_WEIGHT , FACTION_TRAITS, COUNTER_WHY, COUNTER_POOLS } from './amondata.js';

const N = AMON.boardSize, CELLS = N * N;
// v1.2.6: Math.hypot(x, y) step for step as V8 computes it (same bits), but inlined: the builtin boxed its arguments and
// result and allocated a scratch array on every call, which was a third of the battle's garbage.
function hypot(x, y) {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (x !== x || y !== y) return ax === Infinity || ay === Infinity ? Infinity : NaN;
  const max = ay > ax ? ay : ax;
  if (max === Infinity) return Infinity;
  if (max === 0) return 0;
  const a = ax / max, b = ay / max;
  return Math.sqrt(a * a + b * b) * max;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const AMON_DIFF = {
  // v1.0.3: much bigger armies on every difficulty (budget), a bigger cheap horde (horde), and boss rounds keep more of their army (bossArmy)
  easy: { budget: 0.85, hp: 0.9, dmg: 0.9, horde: 0.05, bossArmy: 0.75 }, normal: { budget: 1.5, hp: 1, dmg: 1, horde: 0.12, bossArmy: 0.85 },
  hard: { budget: 2.3, hp: 1.12, dmg: 1.08, horde: 0.18, bossArmy: 0.95 }, nightmare: { budget: 3.2, hp: 1.25, dmg: 1.18, horde: 0.22, bossArmy: 1 },
};
const diffOf = st => AMON_DIFF[{ relaxed: 'easy', brutal: 'hard' }[st.waveDifficulty] || st.waveDifficulty] || AMON_DIFF.normal;
// Poison in AMON works like the shooter's (sim.js POISON): about share x max health over dur seconds, ramping; large units and bosses take less
export const AMON_POISON = { dur: 5, share: 0.3, rampCap: 10, big: 0.3, hpCap: 1500 };
export const THEMES = ['grass', 'desert', 'snow', 'ash', 'crystal', 'swamp', 'autumn', 'ruins', 'moon'];
// Field layouts: how the obstacles are laid out (every field in a battle shares one)
export const LAYOUTS = ['scatter', 'colonnade', 'ring', 'groves', 'lanes', 'crossroads'];

// ---------------------------------------------------------------- the board -> an army
// Pure: the UI uses it too (board previews, tooltips, the leaderboard).
const UNIT_FX = ['hp', 'atk', 'rate', 'speed', 'range', 'splash', 'armor', 'regen', 'lifesteal', 'count', 'chain', 'slow', 'burn', 'poison', 'hex', 'echo',
  'encore', 'block', 'shield', 'thorns', 'drain', 'pen', 'mines', 'knock', 'resist', 'turret', 'drone', 'bomb', 'meteor'];
const FLAT = ['count', 'chain', 'echo', 'mines', 'turret', 'drone', 'meteor'];
export function computeArmy(board, byId, level = 1) {
  const cells = board.map(x => x && byId.get(x.id) ? { inst: x, card: byId.get(x.id) } : null);
  const amp = new Array(CELLS).fill(0), mods = Array.from({ length: CELLS }, () => ({})), from = Array.from({ length: CELLS }, () => []);
  const growth = new Array(CELLS).fill(0), promote = new Array(CELLS).fill(false), recruit = new Array(CELLS).fill(0), recruitPct = new Array(CELLS).fill(0), cleanse = new Array(CELLS).fill(false);
  let gold = 0, interest = 0;
  // 1) amplifiers first (they never amplify each other)
  cells.forEach((e, i) => {
    if (!e || !e.card.fx || !e.card.fx.amp) return;
    for (const [y, x] of patternCells(e.card.pattern, (i / N) | 0, i % N)) amp[y * N + x] += e.card.fx.amp * AMON.rankMul(e.inst.rank);
  });
  // 2) every other board effect
  cells.forEach((e, i) => {
    if (!e || !e.card.fx) return;
    const k = AMON.rankMul(e.inst.rank) * (1 + amp[i]), fx = e.card.fx;
    if (fx.gold) gold += fx.gold * e.inst.rank;
    if (fx.interest) interest += fx.interest + e.inst.rank - 1;
    for (const [y, x] of patternCells(e.card.pattern, (i / N) | 0, i % N)) {
      const j = y * N + x;
      let any = false;
      for (const key of UNIT_FX) {
        if (!fx[key]) continue;
        const flat = FLAT.includes(key);
        mods[j][key] = (mods[j][key] || 0) + (flat ? Math.round(fx[key] * Math.max(1, Math.floor(k * 0.75))) : fx[key] * k);
        any = true;
      }
      if (fx.growth) { growth[j] += fx.growth * k; any = true; }
      if (fx.promote) { promote[j] = true; any = true; }
      if (fx.recruit) { recruit[j] += fx.recruit; any = true; }
      if (fx.recruitPct) { recruitPct[j] += fx.recruitPct * k; any = true; }
      if (fx.cleanse) { cleanse[j] = true; any = true; }
      if (any) from[j].push(i);
    }
  });
  // Repentance and friends: downsides on the cards they reach are gone
  cleanse.forEach((on, j) => { if (on) for (const key of Object.keys(mods[j])) if (mods[j][key] < 0) delete mods[j][key]; });
  const command = Math.max(0, level - AMON.tierCapLevel) * AMON.commandPerLevel;
  const groups = [], pts = new Array(CELLS).fill(0);
  let power = 0;
  cells.forEach((e, i) => {
    if (!e || e.card.kind !== 'unit') return;
    const r = (i / N) | 0, c = i % N, def = UNIT_BY_ID.get(e.card.unit), m = { ...mods[i] };
    for (const [key, v] of Object.entries(squareBonus(r, c, def))) m[key] = (m[key] || 0) + v;
    const rk = AMON.rankMul(e.inst.rank), grow = e.inst.grow || 0;
    const st = {
      hp: Math.max(5, def.hp * rk * (1 + (m.hp || 0) + command + grow)),
      atk: Math.max(0, (def.atk || 0) * rk * (1 + (m.atk || 0) + command + grow)),
      rate: Math.max(0.1, (def.rate || 0) * (1 + (m.rate || 0))),
      speed: clamp(def.speed * (1 + (m.speed || 0)), 0.5, 14),
      range: Math.max(0.8, def.range + (def.range > 3 ? (m.range || 0) : (m.range || 0) * 0.25)),
      splash: Math.max(0, (def.splash || 0) + (m.splash || 0)),
      armor: Math.max(0, (def.armor || 0) + (m.armor || 0)),
      regen: Math.max(0, (m.regen || 0) * rk),
      lifesteal: clamp(m.lifesteal || 0, 0, 1), chain: Math.max(0, m.chain || 0), slow: clamp(m.slow || 0, 0, 0.8), burn: Math.max(0, m.burn || 0), poison: Math.max(0, m.poison || 0), hex: clamp(m.hex || 0, 0, 0.6),
      abMul: rk * (1 + command + grow),   // ability damage / healing scale
      encore: clamp(m.encore || 0, 0, 0.6), block: clamp(m.block || 0, 0, 0.5), shield: Math.max(0, (m.shield || 0) * rk), thorns: clamp(m.thorns || 0, 0, 0.6),
      drain: Math.max(0, (m.drain || 0) * rk), pen: Math.max(0, m.pen || 0), mines: Math.max(0, m.mines || 0), knock: Math.max(0, m.knock || 0),
      resist: clamp(m.resist || 0, 0, 0.5), turret: Math.max(0, m.turret || 0), drone: Math.max(0, m.drone || 0), bomb: clamp(m.bomb || 0, 0, 1), meteor: Math.max(0, m.meteor || 0),
    };
    const n = Math.max(1, rankCount(e.card.count, e.inst.rank) + (m.count || 0) + (e.inst.bonus || 0));
    const g = { cell: i, r, c, uid: e.inst.uid, id: e.card.id, unit: def.id, n, st, echo: (m.echo || 0) > 0, promote: promote[i] };
    g.power = groupPower(def, st, n);
    power += g.power;
    // Point value: base value (unit value x level x units) times a multiplier for the number and kinds of bonuses it gets
    const base = def.v * rk * n, buffs = [];
    let mul = 1 + command + grow;
    for (const [key, v] of Object.entries(m)) {
      const w = BUFF_WEIGHT[key]; if (!w || !v) continue;
      const add = key === 'shield' ? w * v / Math.max(1, def.hp * rk) : w * v;
      mul += add; buffs.push({ key, v, add });
    }
    mul += 0.03 * from[i].length;   // every card that reaches it adds a little on top (synergy)
    g.basePts = base; g.mul = Math.max(0.2, mul); g.pts = base * g.mul; g.buffs = buffs;
    pts[i] = g.pts;
    groups.push(g);
  });
  cells.forEach((e, i) => { if (e && e.card.kind !== 'unit') pts[i] = cardValue(e.card, e.inst.rank); });
  const total = pts.reduce((a, b) => a + b, 0);
  return { groups, mods, from, amp, growth, promote, recruit, recruitPct, gold, interest, power, command, pts, total };
}
export function groupPower(def, st, n) {
  const v = def.value ? def.value * st.abMul : unitValue({ ...def, value: 0, hp: st.hp, atk: st.atk, rate: st.rate, range: st.range, speed: st.speed, armor: st.armor, splash: st.splash, ab: def.ab ? { ...def.ab, regen: st.regen ? { hps: st.regen + ((def.ab.regen && def.ab.regen.hps) || 0) } : def.ab.regen } : (st.regen ? { regen: { hps: st.regen } } : undefined) });
  return v * n * (1 + st.lifesteal * 0.5 + st.chain * 0.2 + st.hex * 0.5 + (st.burn ? 0.1 : 0) + (st.poison ? 0.15 : 0) + (st.slow ? 0.1 : 0) + (st.encore || 0) * 0.7 + (st.block || 0) * 0.7 + (st.resist || 0) * 0.9 + (st.thorns || 0) * 0.3 + (st.bomb || 0) * 0.3);
}
// Leaderboard number: the army's point value (see computeArmy).
export const boardScore = (army) => Math.round(army.total);

// ---------------------------------------------------------------- game
export class AmonGame {
  constructor({ roster, settings, cards }) {
    this.settings = settings;
    this.diff = diffOf(settings);
    this.cards = buildAmonCards(cards);
    this.seed = (Math.random() * 1e9) | 0;
    this.rng = mulberry(this.seed);
    this.uid = 1; this.unitId = 1;
    this.players = roster.map(r => this.newPlayer(r));
    this.round = 1; this.finalRound = AMON.finalRound; this.extensions = 0;
    this.health = AMON.teamHealth; this.maxHealth = AMON.teamHealth;
    this.phase = 'shop'; this.phaseT = 0; this.time = 0;
    this.fields = []; this.log = []; this.events = []; this.choice = null; this.result = null;
    this.pvp = null; this.dirty = true; this.acc = 0;
    // AMON Versus (lobby option): every round is player against player; teams (lobby teams) fight side by side. The raider waves stay home.
    if (this.settings.amonVs && this.players.length >= 2) {
      this.pvp = { round: 0, rounds: 1e9, vs: true };
      for (const p of this.players) p.vsHp = AMON.vsHealth;
      if (new Set(this.players.map(p => p.team)).size < 2) this.players.forEach((p, i) => { p.team = i; });   // everyone on one team: free-for-all
    }
    this.pool = this.cards.list.filter(c => !c.noShop);
    for (const p of this.players) p.gold = AMON.startGold;
    this.openShop(true);
  }
  newPlayer(r) {
    return { id: r.id, name: r.name, color: r.color, isBot: !!r.isBot, difficulty: r.difficulty || 'normal', connected: true,
      gold: 0, level: 1, upCost: AMON.upgradeBase(1), offers: [], bench: [], board: new Array(CELLS).fill(null), ready: false,
      kills: 0, dealt: 0, pvpPts: 0, pvpW: 0, pvpL: 0, score: 0, view: r.id, wonLast: false, team: r.team ?? 0, vsHp: AMON.vsHealth, out: false, seen: {} };
  }
  player(id) { return this.players.find(p => p.id === id); }
  emit(e) { this.events.push(e); }
  takeEvents() { const e = this.events; this.events = []; return e; }
  // late joiners (and people coming back) catch up with the gold everyone else has had
  addPlayer(r) {
    let p = this.player(r.id);
    if (p) { p.connected = true; p.name = r.name; this.dirty = true; return p; }
    p = this.newPlayer(r);
    let g = AMON.startGold; for (let k = 2; k <= this.round; k++) g += AMON.income(Math.min(AMON.tierCapLevel, 1 + Math.floor(k / 3)));
    p.gold = Math.round(g * 0.7); p.level = Math.min(AMON.tierCapLevel, 1 + Math.floor(this.round / 3)); p.upCost = AMON.upgradeBase(p.level);
    this.players.push(p); this.rollOffers(p); this.dirty = true;
    return p;
  }
  removePlayer(id) { const p = this.player(id); if (p) { p.connected = false; p.ready = true; this.dirty = true; } }
  humans() { return this.players.filter(p => !p.isBot && p.connected); }

  // ---------------------------------------------------------------- store
  offerCount(p) { return Math.min(AMON.maxOffers, AMON.baseOffers + p.level - 1); }
  rollTier(level) {
    const odds = TIER_ODDS[Math.min(level, AMON.tierCapLevel)];
    let x = this.rng() * odds.reduce((a, b) => a + b, 0);
    for (let t = 0; t < odds.length; t++) { x -= odds[t]; if (x < 0) return t + 1; }
    return 1;
  }
  rollOffers(p) {
    p.offers = [];
    for (let i = 0; i < this.offerCount(p); i++) p.offers.push(this.rollCard(p.level));
  }
  rollCard(level) {
    const tier = this.rollTier(level), list = this.pool.filter(c => c.tier === tier);
    // unit groups come up a bit more often than tactics
    let w = 0; for (const c of list) w += c.kind === 'unit' ? 2.2 : 1;
    let x = this.rng() * w, pick = list[0];
    for (const c of list) { x -= c.kind === 'unit' ? 2.2 : 1; if (x < 0) { pick = c; break; } }
    if (!pick) return null;
    // tactic cards can come up Holy or Cursed (like the shooter's cards)
    const v = this.rng();
    if (v < AMON.holyChance && this.cards.byId.has('holy:' + pick.id)) return 'holy:' + pick.id;
    if (v < AMON.holyChance + AMON.cursedChance && this.cards.byId.has('cursed:' + pick.id)) return 'cursed:' + pick.id;
    return pick.id;
  }
  openShop(first = false) {
    this.phase = 'shop'; this.phaseT = 0; this.fields = []; this.result = null;
    for (const p of this.players) {
      const army = computeArmy(p.board, this.cards.byId, p.level);
      if (!first) {
        p.gold += AMON.income(p.level) + army.gold + Math.min(3 + Math.max(0, army.interest - 1), army.interest ? Math.floor(p.gold / 10) : 0);
        // Veteran Drill and friends: permanent growth for the cards they reach
        army.growth.forEach((g, i) => { if (g && p.board[i]) p.board[i].grow = (p.board[i].grow || 0) + g; });
        this.gainUnits(p, army);
      }
      p.ready = !!p.out; p.wonLast = false;   // (knocked-out Versus players just watch)
      // a locked store keeps its cards for this round (empty slots stay empty, new slots from upgrades fill in)
      if (p.locked && !first) { p.locked = false; const n = this.offerCount(p); while (p.offers.length < n) p.offers.push(this.rollCard(p.level)); }
      else { p.locked = false; this.rollOffers(p); }
      p.score = boardScore(computeArmy(p.board, this.cards.byId, p.level), p.level);
    }
    this.wave = this.pvp ? null : this.planWave(this.round);
    if (this.pvp && this.pvp.vs) this.vsPlan = this.planVs();
    this.emit({ t: 'shop', round: this.round, fac: this.wave ? this.wave.faction : null });
    this.dirty = true;
  }
  // Permanent units (kept through moves, merges and the bench): recruiters in reach, and squadmates (two unit cards side by
  // side sharing a tag each gain one, once per neighbor card).
  gainUnits(p, army) {
    const byId = this.cards.byId, unitAt = i => { const x = p.board[i], c = x && byId.get(x.id); return c && c.kind === 'unit' ? { x, c, def: UNIT_BY_ID.get(c.unit) } : null; };
    for (let i = 0; i < CELLS; i++) {
      const a = unitAt(i); if (!a) continue;
      const cap = a.c.count * Math.max(1, a.x.rank);
      if (army.recruit[i] && (a.x.bonus || 0) < cap) { a.x.bonus = Math.min(cap, (a.x.bonus || 0) + army.recruit[i]); this.emit({ t: 'gain', p: p.id, id: a.x.id, n: army.recruit[i], why: 'recruit' }); }
      // v1.0.7: breeders add a share of the card's current size every round, so big swarms of weak units snowball
      // (up to AMON.pctCap times the card's own size)
      if (army.recruitPct[i]) {
        const base = rankCount(a.c.count, a.x.rank), size = base + (a.x.bonus || 0), pcap = base * (AMON.pctCap - 1);
        const n = Math.min(Math.max(0, pcap - (a.x.bonus || 0)), Math.max(1, Math.round(size * army.recruitPct[i])));
        if (n > 0) { a.x.bonus = (a.x.bonus || 0) + n; this.emit({ t: 'gain', p: p.id, id: a.x.id, n, why: 'recruit' }); }
      }
      const r = (i / N) | 0, c = i % N;
      for (const [y, xx] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        if (y < 0 || y >= N || xx < 0 || xx >= N) continue;
        const b = unitAt(y * N + xx); if (!b) continue;
        a.x.mates = a.x.mates || [];
        if (a.x.mates.length >= SQUAD_MAX || a.x.mates.includes(b.x.uid)) continue;
        const ta = a.def.tags || [], tb = b.def.tags || [];
        if (!SQUAD_TAGS.some(t => ta.includes(t) && tb.includes(t))) continue;
        a.x.mates.push(b.x.uid); a.x.bonus = (a.x.bonus || 0) + 1;
        this.emit({ t: 'gain', p: p.id, id: a.x.id, n: 1, why: 'squad', with: b.x.id });
      }
    }
  }
  // Two copies of the same card combine: levels add up, permanent units and growth carry over.
  merge(into, x) {
    into.rank = Math.min(AMON.maxRank, into.rank + x.rank);
    into.grow = Math.max(into.grow || 0, x.grow || 0);
    into.bonus = (into.bonus || 0) + (x.bonus || 0);
    into.mates = [...new Set([...(into.mates || []), ...(x.mates || [])])].slice(0, SQUAD_MAX);
  }
  canMerge(a, b) { return !!(a && b && a !== b && a.id === b.id && a.rank < AMON.maxRank); }
  allCards(p) { return [...p.board.map((x, i) => x && { x, where: 'board', i }), ...p.bench.map((x, i) => ({ x, where: 'bench', i }))].filter(Boolean); }
  // Buying: onto the bench, or (dragged from the store) onto a board square or bench slot. Dropped on a copy of
  // itself it combines with it. Copies no longer combine on their own: put one on the other.
  buy(p, i, to = null, j = -1) {
    const id = p.offers[i]; if (!id || p.gold < AMON.cardPrice) return false;
    const x = { uid: this.uid++, id, rank: 1, grow: 0, bonus: 0 };
    const merged = into => { this.merge(into, x); this.emit({ t: 'merge', p: p.id, id, rank: into.rank }); };
    if (to === 'board' && j >= 0 && j < CELLS) {
      const there = p.board[j];
      if (this.canMerge(there, x)) merged(there);
      else if (!there) p.board[j] = x;
      else if (p.bench.length < AMON.benchSize) { p.bench.push(there); p.board[j] = x; }
      else return false;
    } else if (to === 'bench' && j >= 0 && this.canMerge(p.bench[j], x)) merged(p.bench[j]);
    else if (p.bench.length < AMON.benchSize) p.bench.push(x);
    else { const free = p.board.indexOf(null); if (free < 0) return false; p.board[free] = x; }   // bench full: the first free board square
    p.gold -= AMON.cardPrice; p.offers[i] = null; return true;
  }
  sell(p, where, i) {
    const arr = where === 'board' ? p.board : p.bench, x = arr[i]; if (!x) return false;
    p.gold += AMON.sellValue(x.rank);
    if (where === 'board') arr[i] = null; else arr.splice(i, 1);
    return true;
  }
  move(p, from, i, to, j) {
    const src = from === 'board' ? p.board : p.bench, x = src[i]; if (!x) return false;
    const dst = to === 'board' ? p.board[j] : p.bench[j];
    if (this.canMerge(dst, x) && !(from === to && i === j)) {   // dropped on a copy of itself: combine
      this.merge(dst, x);
      if (from === 'board') p.board[i] = null; else p.bench.splice(i, 1);
      this.emit({ t: 'merge', p: p.id, id: x.id, rank: dst.rank });
      return true;
    }
    if (to === 'board') {
      if (j < 0 || j >= CELLS) return false;
      const there = p.board[j];
      if (!(from === 'board' && i === j)) { delete x.at; if (there) delete there.at; }   // a card moved to another square starts from that square again
      if (from === 'board') { p.board[j] = x; p.board[i] = there; }
      else { p.board[j] = x; if (there) p.bench[i] = there; else p.bench.splice(i, 1); }
    } else {
      if (from === 'bench') { if (j >= 0 && j < p.bench.length) { const y = p.bench[j]; p.bench[j] = x; p.bench[i] = y; } return true; }
      if (p.bench.length >= AMON.benchSize) return false;
      p.board[i] = null; p.bench.push(x);
    }
    return true;
  }
  // Custom start positions: the player drags unit groups around their deploy zone on the field (the card stays on its square)
  place(p, a) {
    if (a.reset) { for (const x of p.board) if (x && (a.reset === true || (Array.isArray(a.reset) && a.reset.includes(p.board.indexOf(x))))) delete x.at; return true; }
    if (!Array.isArray(a.moves)) return false;
    let ok = false;
    for (const m of a.moves.slice(0, CELLS)) {
      const x = p.board[m[0] | 0]; if (!x || !Number.isFinite(+m[1]) || !Number.isFinite(+m[2])) continue;
      x.at = { x: Math.round(clamp(+m[1], -AMON.field.hx + 2, AMON.deployMaxX) * 10) / 10, z: Math.round(clamp(+m[2], -AMON.field.hz + 2, AMON.field.hz - 2) * 10) / 10 }; ok = true;
    }
    return ok;
  }
  upgrade(p) {
    if (p.gold < p.upCost) return false;
    p.gold -= p.upCost; p.level++; p.upCost = AMON.upgradeBase(p.level);
    this.emit({ t: 'storeUp', p: p.id, level: p.level });
    const n = this.offerCount(p);
    while (p.offers.length < n) p.offers.push(this.rollCard(p.level));
    return true;
  }
  action(id, a) {
    const p = this.player(id); if (!p || !a) return;
    if (a.t === 'aack') { if (this.onAck) this.onAck(id, a); return; }   // v1.2.6: a peer confirming battle-stream updates (amonui.js sendFields)
    if (a.t === 'view') { const f = this.fields.find(x => x.id === a.f); if (f) p.view = a.f; return; }
    if (a.t === 'choice') { if (this.phase === 'choice' && (id === this.players[0].id || (!p.isBot && a.c === 'pvp'))) this.choose(a.c); return; }   // v1.0.1: any player can start the PvP
    if (a.t === 'pilot') { this.pilot(p, a.on ? a.u | 0 : 0); return; }
    if (a.t === 'pin') { const u = this.piloted(p); if (u) setPilotInput(u.pilot, a); return; }
    if (a.t === 'speed') { if (this.phase === 'battle') this.voteSpeed(p); return; }
    if (this.phase !== 'shop') return;
    let ok = false;
    switch (a.t) {
      case 'buy': ok = this.buy(p, a.i | 0, a.to === 'board' || a.to === 'bench' ? a.to : null, a.j == null ? -1 : a.j | 0); if (!ok && a.to) this.emit({ t: 'nope', p: p.id }); break;
      case 'sell': ok = this.sell(p, a.w === 'board' ? 'board' : 'bench', a.i | 0); break;
      case 'move': ok = this.move(p, a.f === 'board' ? 'board' : 'bench', a.i | 0, a.to === 'board' ? 'board' : 'bench', a.j | 0); break;
      case 'reroll': if (p.gold >= AMON.rerollPrice) { p.gold -= AMON.rerollPrice; this.rollOffers(p); ok = true; } break;
      case 'lock': p.locked = a.on == null ? !p.locked : !!a.on; ok = true; break;
      case 'upgrade': ok = this.upgrade(p); break;
      case 'ready': p.ready = !!a.on; ok = true; break;
      case 'place': ok = this.place(p, a); break;
    }
    if (ok) { p.score = boardScore(computeArmy(p.board, this.cards.byId, p.level), p.level); this.dirty = true; }
  }

  // v1.2.13 (Devin): speed votes during a battle. More than half the players in the match voting steps the speed up one
  // notch (2x, 3x, 4x) and clears the votes for the next notch. Bots never vote.
  speedNeed() { const n = this.players.filter(p => !p.isBot && p.connected).length; return Math.floor(n / 2) + 1; }
  voteSpeed(p) {
    if ((this.speed || 1) >= AMON.maxSpeed || p.isBot || p.speedVote) return;
    p.speedVote = true;
    const votes = this.players.filter(q => q.speedVote && !q.isBot && q.connected).length;
    if (votes >= this.speedNeed()) {
      this.speed = (this.speed || 1) + 1; for (const q of this.players) q.speedVote = false;
      this.emit({ t: 'speed', x: this.speed });
    }
    this.dirty = true;
  }

  // ---------------------------------------------------------------- personal control: a player takes over one of their own units
  piloted(p) { for (const f of this.fields) for (const u of f.units) if (u.pilot && u.pilot.p === p.id && !u.dead) return u; return null; }
  pilot(p, uid) {
    const cur = this.piloted(p);
    if (cur) { cur.pilot = null; cur.tgt = null; cur.retT = 0; }
    if (!uid || this.phase !== 'battle') { if (cur) this.emit({ t: 'pilot', p: p.id, u: 0 }); return; }
    for (const f of this.fields) for (const u of f.units) {
      if (u.id !== uid || u.dead || u.owner !== p.id || u.pilot) continue;
      u.pilot = { p: p.id, mx: 0, mz: 0, ax: u.x, az: u.z, fire: false, block: false };
      u.blocker = canBlock(u);
      u.sieged = false; u.deployT = 0;
      this.emit({ t: 'pilot', p: p.id, u: u.id, f: f.id, unit: u.def.id, blocker: u.blocker });
      return;
    }
    this.emit({ t: 'pilot', p: p.id, u: 0 });
  }

  // ---------------------------------------------------------------- bots (and players who left) shop on their own
  botShop(p) {
    const easy = p.difficulty === 'easy', hard = p.difficulty === 'hard' || p.difficulty === 'insane';
    const wantLevel = Math.min(12, 1 + Math.floor(this.round / (hard ? 1.8 : easy ? 2.6 : 2.2)));   // income grows with the store level
    for (let guard = 0; guard < 40; guard++) {
      if (p.level < wantLevel && p.gold >= p.upCost && (p.gold - p.upCost >= AMON.cardPrice || p.upCost === 0)) { this.upgrade(p); continue; }
      if (p.gold < AMON.cardPrice) break;
      const owned = new Set(this.allCards(p).map(e => e.x.id));
      let best = -1, bestS = -1;
      p.offers.forEach((id, i) => {
        if (!id) return;
        const c = this.cards.byId.get(id);
        const s = c.tier * 10 + (owned.has(id) ? 14 : 0) + (c.kind === 'unit' ? 6 : 0) + this.rng() * (easy ? 20 : 6);
        if (s > bestS) { bestS = s; best = i; }
      });
      if (best < 0) { if (p.gold >= AMON.rerollPrice + AMON.cardPrice * 2 && !easy) { p.gold -= AMON.rerollPrice; this.rollOffers(p); continue; } break; }
      if (easy && this.rng() < 0.25) { p.offers[best] = null; continue; }
      if (!this.buy(p, best)) break;
    }
    // combine copies (bots don't drag cards around)
    for (let again = true; again;) {
      again = false;
      const all = this.allCards(p);
      for (const a of all) { const b = all.find(e => e !== a && this.canMerge(a.x, e.x)); if (b) { this.merge(a.x, b.x); if (b.where === 'board') p.board[b.i] = null; else p.bench.splice(b.i, 1); again = true; break; } }
    }
    this.botArrange(p);
    // full board and bench: sell the weakest bench cards
    while (p.bench.length > 4) { let w = 0; p.bench.forEach((x, i) => { if (cardValue(this.cards.byId.get(x.id), x.rank) < cardValue(this.cards.byId.get(p.bench[w].id), p.bench[w].rank)) w = i; }); this.sell(p, 'bench', w); }
    p.ready = true;
  }
  botArrange(p) {
    // units into their preferred rows (melee front, artillery back), tactics where they reach the most units
    const units = p.bench.filter(x => this.cards.byId.get(x.id).kind === 'unit');
    for (const x of units) {
      const row = preferredRow(this.cards.byId.get(x.id));
      let best = -1, bd = 1e9;
      for (let i = 0; i < CELLS; i++) if (!p.board[i]) { const d = Math.abs(((i / N) | 0) - row) * 3 + Math.abs((i % N) - 2); if (d < bd) { bd = d; best = i; } }
      if (best < 0) break;
      p.board[best] = x; p.bench.splice(p.bench.indexOf(x), 1);
    }
    const tactics = p.bench.filter(x => this.cards.byId.get(x.id).kind === 'tactic');
    for (const x of tactics) {
      const c = this.cards.byId.get(x.id);
      let best = -1, bs = -1;
      for (let i = 0; i < CELLS; i++) {
        if (p.board[i]) continue;
        const reach = c.pattern === 'self' ? 1 : patternCells(c.pattern, (i / N) | 0, i % N).filter(([y, xx]) => { const o = p.board[y * N + xx]; return o && this.cards.byId.get(o.id).kind === 'unit'; }).length;
        if (reach > bs) { bs = reach; best = i; }
      }
      if (best < 0) break;
      p.board[best] = x; p.bench.splice(p.bench.indexOf(x), 1);
    }
  }

  // ---------------------------------------------------------------- Game Master
  diffMul() { return 1 + 0.35 * this.extensions; }
  budget(r) { return 8 * Math.pow(r, 1.42) * this.diff.budget * this.diffMul(); }
  maxTier(r) { return clamp(1 + Math.floor((r - 1) / 3), 1, 6); }
  // One faction per round (not one of the last four); the chaos horde turns up less often.
  pickFaction() {
    const recent = this.facHist || (this.facHist = []);
    const opts = FACTIONS.filter(f => !recent.includes(f.id)), w = opts.map(f => f.id === 'chaos' ? 0.6 : 1);
    let x = this.rng() * w.reduce((a, b) => a + b, 0), pick = opts[0];
    for (let i = 0; i < opts.length; i++) { x -= w[i]; if (x < 0) { pick = opts[i]; break; } }
    recent.push(pick.id); if (recent.length > 4) recent.shift();
    return pick;
  }
  // What the players' armies lean on (for the Arbiter): fliers, a swarm of cheap units, a few elites, melee, a ranged back line or armor
  readArmies() {
    let n = 0, air = 0, melee = 0, ranged = 0, armor = 0, cards = 0;
    for (const p of this.players) {
      const a = computeArmy(p.board, this.cards.byId, p.level);
      for (const g of a.groups) {
        const d = UNIT_BY_ID.get(g.unit); if (!d) continue;
        cards++; n += g.n; if (d.air) air += g.n; if ((d.range || 0) <= 2.5) melee += g.n; else ranged += g.n; armor += (g.st.armor || 0) * g.n;
      }
    }
    const np = Math.max(1, this.players.length), per = n / np;
    if (!n) return 'mixed';
    if (air / n > 0.5) return 'air';
    if (per >= 34) return 'swarm';
    if (per <= 12 && cards / np <= 4) return 'elite';
    if (armor / n >= 3) return 'armor';
    if (melee / n > 0.65) return 'melee';
    if (ranged / n > 0.65) return 'backline';
    return 'mixed';
  }
  planWave(r) {
    const rng = this.rng, plan = [], fac = this.pickFaction(), chaos = fac.id === 'chaos';
    let budget = this.budget(r);
    // a faction's trait makes its troops stronger, so it brings a few fewer of them
    const trait = chaos ? Object.values(FACTION_TRAITS)[Math.floor(rng() * Object.keys(FACTION_TRAITS).length)] : FACTION_TRAITS[fac.id];
    if (trait) budget /= 1 + trait.w;
    if (r % AMON.bossEvery === 0) {
      const k = r / AMON.bossEvery, boss = k >= 2 ? BOSSES[1] : BOSSES[0];
      const scale = k > 2 ? 1 + 0.6 * (k - 2) : 1;
      plan.push({ unit: boss.id, n: 1, scale, name: k > 2 ? (k === 3 ? 'Amon Ascended' : 'Amon Eternal ' + (k - 2)) : boss.name, boss: true });
      budget = Math.max(budget * (this.diff.bossArmy || 0.55), budget - boss.v * scale);   // the boss always brings a real army with it
    }
    const top = this.maxTier(r);
    let core = factionUnits(fac).filter(e => e.tier <= top), why = null;
    if (fac.id === 'counter') {   // the Arbiter: draw from the pool that beats what the players field
      why = this.readArmies();
      const pool = why === 'mixed' ? fac.core : COUNTER_POOLS[why];
      const units = factionUnits({ id: 'x', core: pool }).filter(e => e.tier <= top);
      if (units.length >= 2) core = units;
    }
    const aux = factionUnits(fac, 'aux').filter(e => e.tier <= top);
    if (!core.length) core = ENEMIES.filter(e => e.tier <= top);
    const pick = (list, lean) => {   // lean toward the newest tier the round allows
      const w = list.map(e => Math.pow(lean, e.tier - top + 6));
      let x = rng() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < list.length; i++) { x -= w[i]; if (x < 0) return list[i]; }
      return list[list.length - 1];
    };
    const kinds = 2 + Math.min(3, Math.floor(r / 5)) + (rng() < 0.4 ? 1 : 0) + (chaos ? 2 : 0);
    const chosen = [], shares = [];
    let hs = 0;
    // the horde: the faction's cheapest troops make up a big share of every wave, so battles are large
    const lowT = Math.min(...core.map(e => e.tier)), horde = core.filter(e => e.tier === lowT);
    if (!chaos && r >= 2) { chosen.push(horde[(rng() * horde.length) | 0]); hs = 0.38 + 0.15 * rng() + (this.diff.horde || 0); shares.push(hs); }
    for (let k = 0; k < kinds * 3 && chosen.length < kinds; k++) {
      const e = pick(core, chaos ? 1.15 : 1.7);
      if (!chosen.includes(e)) { chosen.push(e); shares.push((chaos ? 0.15 + rng() * 1.5 : 0.5 + rng()) * (1 - hs)); }
    }
    if (aux.length && rng() < 0.55) { const e = aux[(rng() * aux.length) | 0]; if (!chosen.includes(e)) { chosen.push(e); shares.push(0.12 + rng() * 0.1); } }
    const tot = shares.reduce((a, b) => a + b, 0);
    chosen.forEach((e, i) => {
      const n = Math.max(1, Math.round(budget * shares[i] / tot / e.v));
      plan.push({ unit: e.id, n, scale: 1 });
    });
    // a few pricey units can overshoot a small budget (n is at least 1): trim the priciest group until it fits
    const val = () => plan.reduce((a, g) => a + (g.boss ? 0 : UNIT_BY_ID.get(g.unit).v * g.scale * g.n), 0);
    if (val() > budget * 1.1) { const k = budget / val(); for (const g of plan) if (!g.boss) g.n = Math.max(1, Math.round(g.n * k)); }
    for (let guard = 0; guard < 200 && val() > budget * 1.1; guard++) {
      const groups = plan.filter(g => !g.boss); if (groups.length <= 1) break;
      const big = groups.sort((a, b) => UNIT_BY_ID.get(b.unit).v * b.n - UNIT_BY_ID.get(a.unit).v * a.n)[0];
      if (big.n > 1) big.n--; else plan.splice(plan.indexOf(big), 1);
    }
    // keep fields playable: very large waves come as fewer, tougher units
    const count = plan.reduce((a, b) => a + b.n, 0), cap = AMON.waveCap;
    if (count > cap) { const k = count / cap; for (const g of plan) if (!g.boss && g.n > 2) { const n2 = Math.max(1, Math.round(g.n / k)); g.scale *= g.n / n2; g.n = n2; } }
    plan.value = plan.reduce((a, g) => a + UNIT_BY_ID.get(g.unit).v * g.scale * g.n, 0);
    plan.faction = fac.id; plan.round = r; plan.trait = trait ? trait.text : null; plan.why = why ? COUNTER_WHY[why] : null; plan.traitFx = trait ? trait.fx : null;
    return plan;
  }
  // The wave's point value on the same scale as a board's (difficulty and extensions included).
  wavePoints(plan) {
    if (!plan) return 0;
    const hp = this.diff.hp * (1 + 0.15 * this.extensions), dmg = this.diff.dmg * (1 + 0.1 * this.extensions);
    return plan.value * Math.sqrt(hp * dmg);
  }

  // ---------------------------------------------------------------- battle setup
  startBattle() {
    this.phase = 'battle'; this.phaseT = 0; this.fields = []; this.battleSeed = (this.rng() * 1e9) | 0;
    this.speed = 1; for (const p of this.players) p.speedVote = false;   // v1.2.13: every battle starts at normal speed
    for (const p of this.players) { p.upCost = Math.max(0, p.upCost - AMON.upgradeDrop); p.ready = false; }
    const theme = THEMES[(this.round + this.seed) % THEMES.length];
    if (this.pvp && this.pvp.vs) {
      const plan = this.vsPlan || (this.vsPlan = this.planVs());
      plan.forEach(([aId, bId, ghost], i) => {
        const a = this.player(aId), b = this.player(bId);
        const f = this.newField(i, theme, ghost ? [a.id] : [a.id, b.id]);
        f.vs = { a: a.id, b: b.id, ghost: !!ghost };
        this.deployArmy(f, a, 0); this.deployArmy(f, ghost ? { ...b, id: 'ghost:' + b.id } : b, 1);
        f.startV = [this.sideValue(f, 0), this.sideValue(f, 1)];
        f.startPts = [a.score, b.score];
      });
      this.pvp.byes = [];
    } else if (this.pvp) {
      const pairs = this.pvpPairs();
      pairs.forEach(([a, b], i) => {
        const f = this.newField(i, theme, [a.id, b.id]);
        this.deployArmy(f, a, 0); this.deployArmy(f, b, 1);
        f.startV = [this.sideValue(f, 0), this.sideValue(f, 1)];
      });
      this.pvp.byes = this.players.filter(p => !pairs.some(pr => pr.includes(p))).map(p => p.id);
    } else {
      if (!this.wave || this.wave.round !== this.round) this.wave = this.planWave(this.round);
      this.players.forEach((p, i) => {
        const f = this.newField(i, theme, [p.id]);
        this.deployArmy(f, p, 0); this.deployWave(f, this.wave);
      });
    }
    // v1.0.4: no formations: every unit moves at full speed and picks its own targets from the start
    for (const p of this.players) { const own = this.fields.find(f => f.owners.includes(p.id)); p.view = own ? own.id : 0; }
    this.emit({ t: 'battle', round: this.round, boss: !this.pvp && this.wave.find(g => g.boss) ? this.wave.find(g => g.boss).name : null, pvp: !!this.pvp, fac: this.pvp ? null : this.wave.faction });
    this.dirty = true;
  }
  newField(i, theme, owners) {
    const rng = mulberry(this.battleSeed + 1), obstacles = [];   // every field has the same rocks (same wave, same ground)
    const layout = LAYOUTS[Math.floor(rng() * LAYOUTS.length)];
    // obstacles never overlap (and leave a gap to walk through), so sliding around them always works.
    // k is what it looks like: rock, pillar, tree, crate, ruin, shard
    const tryAdd = (x, z, r, k = 'rock') => { if (Math.abs(x) < 44 && Math.abs(z) < 42 && obstacles.every(o => hypot(o.x - x, o.z - z) > o.r + r + 4)) obstacles.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, r: Math.round(r * 10) / 10, k }); };
    const deco = () => { const d = ['rock', 'crate', 'ruin', 'tree']; return d[Math.floor(rng() * d.length)]; };
    if (layout === 'colonnade') {   // a broken line of pillars across the middle, with gaps to push through
      const off = (rng() - 0.5) * 10;
      for (let z = -38; z <= 38; z += 6 + rng() * 3) if (rng() < 0.8) tryAdd(off + (rng() - 0.5) * 2, z, 1.2 + rng() * 0.6, 'pillar');
    } else if (layout === 'ring') {   // a ring of standing stones around the centre
      const R = 12 + rng() * 4, n = 7 + Math.floor(rng() * 3), a0 = rng() * 6.28;
      for (let k = 0; k < n; k++) tryAdd(Math.cos(a0 + k / n * 6.283) * R, Math.sin(a0 + k / n * 6.283) * R, 1.4 + rng() * 0.6, 'pillar');
      tryAdd(0, 0, 2.5 + rng() * 1.5, 'shard');
    } else if (layout === 'groves') {   // clumps of trees with open ground between them
      for (let c = 0; c < 4; c++) { const cx = (rng() - 0.5) * 40, cz = (rng() - 0.5) * 70; for (let k = 0; k < 6; k++) tryAdd(cx + (rng() - 0.5) * 12, cz + (rng() - 0.5) * 12, 0.9 + rng() * 0.8, 'tree'); }
    } else if (layout === 'lanes') {   // two long rows split the field into three lanes
      for (const zz of [-16 - rng() * 4, 16 + rng() * 4]) for (let x = -20; x <= 20; x += 7 + rng() * 2) tryAdd(x, zz + (rng() - 0.5) * 2, 1.6 + rng() * 1.2, rng() < 0.5 ? 'ruin' : 'rock');
    } else if (layout === 'crossroads') {   // four big blocks leave a cross of open ground
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { tryAdd(sx * (11 + rng() * 4), sz * (17 + rng() * 6), 3.5 + rng() * 2, 'ruin'); tryAdd(sx * (6 + rng() * 3), sz * (32 + rng() * 5), 1.2 + rng(), 'crate'); }
    }
    for (let k = 0; k < 30 && obstacles.length < (layout === 'scatter' ? 9 : 13); k++) tryAdd((rng() - 0.5) * 44, (rng() - 0.5) * 76, layout === 'scatter' ? 2.2 + rng() * 3.8 : 1.4 + rng() * 2, layout === 'scatter' ? (rng() < 0.75 ? 'rock' : deco()) : deco());
    for (let k = 0; k < 4; k++) tryAdd((rng() < 0.5 ? -1 : 1) * (12 + rng() * 8), (rng() < 0.5 ? -1 : 1) * (36 + rng() * 6), 2 + rng() * 2, rng() < 0.5 ? 'rock' : deco());
    const f = { id: i, theme, layout, owners, seed: this.battleSeed + i, obstacles, units: [], shells: [], storms: [], corpses: [], respawns: [], mines: [], t: 0, done: false, winner: null,
      evs: [], evSeq: 0, gridT: 0, checkT: 0, firstWinner: null };
    this.fields.push(f);
    return f;
  }
  // board square -> spot on the field (side 1 is mirrored on the far side)
  cellPos(side, r, c) { const x = -30 - r * 6.5, z = (c - 2) * 14; return side === 0 ? { x, z } : { x: -x, z: -z }; }
  deployArmy(f, p, side) {
    const army = computeArmy(p.board, this.cards.byId, p.level);
    for (const g of army.groups) {
      const inst = p.board[g.cell], at = inst && inst.at ? (side === 0 ? { x: inst.at.x, z: inst.at.z } : { x: -inst.at.x, z: -inst.at.z }) : this.cellPos(side, g.r, g.c);
      const def = UNIT_BY_ID.get(g.unit);
      const cols = Math.ceil(Math.sqrt(g.n)), sp = Math.max(1.1, def.size * 1.6);
      let lead = null;
      for (let k = 0; k < g.n; k++) {
        const ox = ((k / cols) | 0) - (cols - 1) / 2, oz = (k % cols) - (cols - 1) / 2;
        const u = this.spawn(f, def, side, at.x + ox * sp * (side ? 1 : -1) * 0.8, at.z + oz * sp, p.id, g.st);
        u.card = g.uid; u.echo = g.echo; lead = lead || u;
      }
      // card effects from the shooter: sentry turrets and wasp drones deploy with the group, mines go down in front of it
      const fwd = side === 0 ? 1 : -1;
      for (const [sid, k] of [['sentry', g.st.turret], ['wasp', g.st.drone]]) for (let j = 0; j < k; j++) {
        const d = UNIT_BY_ID.get(sid), u = this.spawn(f, d, side, at.x + fwd * 3, at.z + (j - (k - 1) / 2) * 2.5, p.id, inheritSt(d, lead));
        u.card = g.uid;
      }
      for (let j = 0; j < g.st.mines * Math.min(4, g.n); j++) f.mines.push({ x: at.x + fwd * (14 + 3 * (j % 2)), z: at.z + (j - (Math.min(4, g.n) * g.st.mines - 1) / 2) * 3, side, dmg: 30 + 2.5 * (g.st.atk || 10), r: 2.6, src: lead });
    }
  }
  deployWave(f, plan) {
    const rng = mulberry(this.battleSeed * 31 + this.round);   // identical placement on every field
    for (const g of plan) {
      const def = UNIT_BY_ID.get(g.unit);
      const cx = g.boss ? 52 : 34 + rng() * 26, cz = g.boss ? 0 : (rng() - 0.5) * 72;
      const cols = Math.ceil(Math.sqrt(g.n)), sp = Math.max(1.1, def.size * 1.6);
      const st = enemyStats(def, g.scale * this.diff.hp * (1 + 0.15 * this.extensions), g.scale * this.diff.dmg * (1 + 0.1 * this.extensions));
      const T = plan.traitFx;
      if (T && !g.boss) {   // the faction's trait
        if (T.armor) st.armor += T.armor; if (T.speed) st.speed *= 1 + T.speed; if (T.rate) st.rate *= 1 + T.rate; if (T.lifesteal) st.lifesteal += T.lifesteal;
        if (T.range && def.range > 3) st.range += T.range; if (T.splash && def.atk) st.splash += T.splash; if (T.burn) st.burn += T.burn; if (T.slow) st.slow = Math.max(st.slow, T.slow);
        if (T.shieldPct) st.shield = st.hp * T.shieldPct; if (T.block) st.block += T.block; if (T.hex) st.hex += T.hex; if (T.poison) st.poison += T.poison;
        if (T.regenPct) st.regen += st.hp * T.regenPct; if (T.chain && def.range > 3) st.chain += T.chain;
      }
      for (let k = 0; k < g.n; k++) {
        const ox = ((k / cols) | 0) - (cols - 1) / 2, oz = (k % cols) - (cols - 1) / 2;
        const u = this.spawn(f, def, 1, clamp(cx + ox * sp, 20, 66), clamp(cz + oz * sp, -44, 44), null, st);
        u.vScale = g.scale; if (g.boss) { u.boss = true; u.name = g.name; }
        if (T && T.stealth && !g.boss) u.stealthT = Math.max(u.stealthT, T.stealth);
      }
    }
  }
  spawn(f, def, side, x, z, owner, st) {
    st = st || enemyStats(def, 1, 1);
    const u = { id: this.unitId++, def, side, owner, x, z, vx: 0, vz: 0, hp: st.hp, max: st.hp, st, cd: 0.2 + this.rng() * 0.6, tgt: null, retT: this.rng() * 0.4,
      slowT: 0, slowAmt: 0, stunT: 0, burnT: 0, burnDps: 0, hexT: 0, hexAmt: 0, atkN: 0, abT: {}, kids: 0, parent: null, dead: false, air: !!def.air, vScale: 1,
      charged: !!(def.ab && def.ab.charge), stealthT: def.ab && def.ab.stealth ? def.ab.stealth.dur : 0, sieged: false, deployT: 0, idleT: 0, hitN: 0, age: 0, blinked: false,
      barrier: st.shield || 0,
      // v1.2.6: every field set later is declared here with a value that reads the same as "not set", so all units share
      // one shape (fast property access in stepUnit / separate / retarget, and no new number boxed on every store)
      ward: 0, rally: 0, lx: NaN, lz: NaN, stuckT: 0, sx: null, sz: null, slideT: 0, slideDir: 0, wander: 0, free: false, fg: null, slot: null,
      pilot: null, pilotN: 0, blocker: false, dashT: 0, dashCd: 0, dashX: 0, dashZ: 0, boss: false, name: null, card: null, echo: false, echoed: false,
      burns: null, burnSrc: null, psT: 0, psLeft: 0, psLvl: 0, psSrc: null };
    f.units.push(u);
    return u;
  }
  sideValue(f, side) { let v = 0; for (const u of f.units) if (!u.dead && u.side === side) v += u.def.v * (u.vScale || 1); return v; }
  // Versus: pair every player still in with someone from another team. v1.2.13 (Devin): matchups rotate through everyone
  // instead of being random: each player gets the opponent they've gone longest without fighting (never = first), and the
  // order players are paired in shifts every round. Whoever is left over (odd numbers) fights a copy of the enemy board
  // they've seen least recently.
  vsAlive() { return this.players.filter(p => !p.out); }
  vsTeamsLeft() { return new Set(this.vsAlive().map(p => p.team)).size; }
  planVs() {
    const alive = this.vsAlive(), pairs = [], n = (this.vsN = (this.vsN || 0) + 1);
    const last = (a, b) => (a.vsMet && a.vsMet[b.id]) ?? -1, met = (a, b) => { (a.vsMet ||= {})[b.id] = n; };
    const k = n % Math.max(1, alive.length), rot = [...alive.slice(k), ...alive.slice(0, k)], free = new Set(rot);
    const pick = (a, pool) => pool.slice().sort((x, y) => last(a, x) - last(a, y))[0];   // (stable: ties keep the rotated order)
    for (const a of rot) {
      if (!free.has(a)) continue;
      const foes = rot.filter(b => free.has(b) && b !== a && b.team !== a.team);
      if (!foes.length) continue;
      const b = pick(a, foes);
      free.delete(a); free.delete(b); pairs.push([a.id, b.id, false]); met(a, b); met(b, a); a.lastOpp = b.id; b.lastOpp = a.id;
    }
    for (const a of free) {   // left over: a ghost of an enemy's board
      const foes = rot.filter(b => b.team !== a.team);
      if (!foes.length) continue;
      const b = pick(a, foes);
      pairs.push([a.id, b.id, true]); met(a, b); a.lastOpp = b.id;
    }
    return pairs;
  }
  pvpPairs() {
    // round robin (circle method); an odd player count gives someone a bye
    const ids = this.players.slice(); if (ids.length % 2) ids.push(null);
    const n = ids.length, r = this.pvp.round % (n - 1), arr = [ids[0], ...ids.slice(1).map((_, i) => ids[1 + ((i + r) % (n - 1))])], pairs = [];
    for (let i = 0; i < n / 2; i++) { const a = arr[i], b = arr[n - 1 - i]; if (a && b) pairs.push([a, b]); }
    return pairs;
  }

  // ---------------------------------------------------------------- main step
  step(dt) {
    if (this.phase === 'battle') dt *= this.speed || 1;   // v1.2.13 (Devin): players can vote the battle up to 4x speed
    this.time += dt; this.phaseT += dt;
    if (this.phase === 'shop') {
      for (const p of this.players) if ((p.isBot || !p.connected) && !p.ready && this.phaseT > 0.6 + (this.players.indexOf(p) % 5) * 0.25) { this.botShop(p); this.dirty = true; }
      const limit = this.settings.amonTimer ? AMON.shopTime : 0;
      if (this.players.every(p => p.ready) || (limit && this.phaseT >= limit)) this.startBattle();
      return;
    }
    if (this.phase === 'battle') {
      this.acc += dt;
      while (this.acc >= AMON.tick) { this.acc -= AMON.tick; this.tickBattle(AMON.tick); if (this.phase !== 'battle') break; }
      return;
    }
    if (this.phase === 'result' && this.phaseT >= 4.5) this.afterResult();
  }
  tickBattle(dt) {
    this.tickN = (this.tickN || 0) + 1;   // v1.2.6: lets the client refresh views once per battle tick
    for (const f of this.fields) if (!f.done) stepField(this, f, dt);
    for (const f of this.fields) if (f.done && !f.handled) this.fieldDecided(f);
    if (this.fields.every(f => f.done) || this.phaseT >= AMON.battleTime) this.endBattle();
  }
  fieldDecided(f) {
    f.handled = true;
    if (f.firstWinner == null) f.firstWinner = f.winner;
    if (this.pvp && this.pvp.vs) {
      // Versus: survivors only ever travel to a field where an ally of theirs is still fighting (and join that ally's side)
      const live = f.units.filter(u => !u.dead); if (!live.length) return;
      const side = live[0].side, owner = side === 0 ? f.vs.a : f.vs.ghost ? null : f.vs.b, me = owner && this.player(owner);
      if (!me) return;
      const to = this.fields.find(g => g !== f && !g.done && g.vs && [g.vs.a, g.vs.ghost ? null : g.vs.b].some(id => id && id !== me.id && (this.player(id) || {}).team === me.team));
      if (!to) return;
      const ally = [to.vs.a, to.vs.b].find(id => id !== me.id && (this.player(id) || {}).team === me.team), allySide = ally === to.vs.a ? 0 : 1;
      for (const u of live) u.side = allySide;
      this.transfer(f, to, live);
      return;
    }
    if (this.pvp) return;
    const live = f.units.filter(u => !u.dead);
    if (!live.length) return;
    const side = live[0].side;
    // Only your own cards fight on your field: a field with no army is simply lost, and its raiders stay there.
    // Survivors of a won field go help a teammate: the field with the most raiders left (still fighting or already lost).
    if (side !== 0) return;
    const to = this.fields.filter(g => g !== f && g.units.some(u => !u.dead && u.side === 1)).sort((a, b) => this.sideValue(b, 1) - this.sideValue(a, 1))[0];
    if (!to) return;
    this.transfer(f, to, live);
  }
  transfer(f, to, list) {
    const rng = this.rng;
    for (const u of list) {
      f.units.splice(f.units.indexOf(u), 1);
      u.x = u.side === 0 ? -64 + rng() * 6 : 58 + rng() * 6; u.z = (rng() - 0.5) * 70; u.tgt = null; u.sieged = false; u.deployT = 0; u.slot = { x: u.x, z: u.z };
      to.units.push(u);
    }
    f.evs.push({ k: 'leave', n: list.length, side: list[0].side, to: to.id, s: ++f.evSeq });
    to.evs.push({ k: 'arrive', n: list.length, side: list[0].side, from: f.id, s: ++to.evSeq });
    this.emit({ t: 'transfer', from: f.id, to: to.id, n: list.length, side: list[0].side, owners: f.owners, toOwners: to.owners });
    if (to.done) { to.done = false; to.handled = false; to.winner = null; }
  }
  endBattle() {
    for (const f of this.fields) for (const u of f.units) u.pilot = null;
    const res = { round: this.round, pvp: !!this.pvp, fields: this.fields.map(f => ({ id: f.id, owners: f.owners, winner: f.winner, first: f.firstWinner })) };
    if (this.pvp && this.pvp.vs) {
      res.vs = [];
      for (const f of this.fields) {
        const a = this.player(f.vs.a), b = this.player(f.vs.b), ghost = f.vs.ghost;
        const va = this.sideValue(f, 0), vb = this.sideValue(f, 1);
        const w = va > 0 && vb <= 0 ? 0 : vb > 0 && va <= 0 ? 1 : va > vb * 1.05 ? 0 : vb > va * 1.05 ? 1 : -1;
        // the loser loses health by how much of the winner's army is still standing
        const hit = (loser, left, start) => { const d = Math.ceil(2 + 14 * Math.min(1, left / Math.max(1, start)) + this.round * 0.3); loser.vsHp = Math.max(0, loser.vsHp - d); return d; };
        let dmg = 0;
        if (w === 0) { if (!ghost) { dmg = hit(b, va, f.startV[0]); b.pvpL++; } a.pvpW++; a.pvpPts += 3; a.wonLast = true; }
        else if (w === 1) { dmg = hit(a, vb, f.startV[1]); a.pvpL++; if (!ghost) { b.pvpW++; b.pvpPts += 3; b.wonLast = true; } }
        else { a.pvpPts++; if (!ghost) b.pvpPts++; }
        // what each side saw of the other: their army's points at the start of this battle
        a.seen[b.id] = { v: f.startPts[1], r: this.round }; if (!ghost) b.seen[a.id] = { v: f.startPts[0], r: this.round };
        f.result = w;
        res.vs.push({ a: a.id, b: b.id, ghost, w, dmg });
      }
      for (const p of this.players) if (!p.out && p.vsHp <= 0) { p.out = true; this.emit({ t: 'vsOut', p: p.id, name: p.name }); }
      res.duels = res.vs;
      this.pvp.round++;
    } else if (this.pvp) {
      for (const f of this.fields) {
        const [a, b] = f.owners.map(id => this.player(id));
        const va = this.sideValue(f, 0), vb = this.sideValue(f, 1);
        const w = va > 0 && vb <= 0 ? 0 : vb > 0 && va <= 0 ? 1 : va > vb * 1.05 ? 0 : vb > va * 1.05 ? 1 : -1;
        if (w === 0) { a.pvpPts += 3; a.pvpW++; b.pvpL++; } else if (w === 1) { b.pvpPts += 3; b.pvpW++; a.pvpL++; } else { a.pvpPts++; b.pvpPts++; }
        if (w >= 0) (w === 0 ? a : b).wonLast = true;
        f.result = w;
      }
      res.duels = this.fields.map(f => ({ a: f.owners[0], b: f.owners[1], w: f.result }));
      this.pvp.round++;
    } else {
      let left = 0, bossLeft = false;
      for (const f of this.fields) for (const u of f.units) if (!u.dead && u.side === 1) { left += u.def.v * (u.vScale || 1); if (u.boss) bossLeft = true; }
      const total = Math.max(1, this.wave.value * this.fields.length);
      const dmg = left > 0 ? Math.ceil(2 + 18 * Math.min(1, left / total) + this.round * 0.25) : 0;
      this.health = Math.max(0, this.health - dmg);
      res.left = Math.round(left); res.dmg = dmg; res.cleared = left <= 0; res.bossLeft = bossLeft;
      for (const p of this.players) { const f = this.fields.find(x => x.owners.includes(p.id)); p.wonLast = !!f && f.firstWinner === 0; }
    }
    // Field Promotion: cards in reach rank up after a battle their owner won
    for (const p of this.players) {
      if (!p.wonLast) continue;
      const army = computeArmy(p.board, this.cards.byId, p.level);
      army.promote.forEach((on, i) => { if (on && p.board[i] && p.board[i].rank < AMON.maxRank) { p.board[i].rank++; this.emit({ t: 'promote', p: p.id, id: p.board[i].id, rank: p.board[i].rank }); } });
    }
    this.result = res;
    this.phase = 'result'; this.phaseT = 0;
    this.emit({ t: 'result', ...res });
    this.dirty = true;
  }
  afterResult() {
    const r = this.result;
    if (this.pvp && this.pvp.vs) {
      if (this.vsTeamsLeft() <= 1) { this.openChoice('vs'); return; }
      this.round++; this.openShop(); return;
    }
    if (this.pvp) {
      if (this.pvp.round >= this.pvp.rounds) { this.openChoice('pvp'); return; }
      this.round++; this.openShop(); return;
    }
    if (this.health <= 0) { this.openChoice('lost'); return; }
    if (this.round >= this.finalRound) {
      if (r.cleared || !r.bossLeft) { this.openChoice('won'); return; }
      this.openChoice('boss'); return;   // v1.0.1: the final boss still stands: fight it again, or fight each other
    }
    this.round++; this.openShop();
  }
  openChoice(why) {
    this.phase = 'choice'; this.phaseT = 0;
    let champ = null;
    if (why === 'pvp') { const s = this.players.slice().sort((a, b) => b.pvpPts - a.pvpPts || b.score - a.score); champ = s[0] && s[0].id; }
    if (why === 'vs') { const s = this.vsAlive().sort((a, b) => b.vsHp - a.vsHp); champ = s[0] && s[0].id; }
    this.choice = { why, champ, canPvp: this.players.length >= 2 && why !== 'vs', round: this.round, team: why === 'vs' && champ ? this.vsAlive().filter(p => p.team === this.player(champ).team).map(p => p.id) : null };
    this.emit({ t: 'choice', ...this.choice });
    this.dirty = true;
  }
  choose(c) {
    if (c === 'again' && this.choice && this.choice.why === 'boss') { this.choice = null; this.emit({ t: 'bossAgain' }); this.openShop(); return; }
    if (c === 'extend') {
      this.extensions++; this.pvp = null;
      this.finalRound = Math.max(this.finalRound, this.round) + AMON.extendRounds;
      if (this.health <= 0) this.health = this.maxHealth;
      this.round++; this.choice = null; this.emit({ t: 'extend', final: this.finalRound, ext: this.extensions }); this.openShop();
    } else if (c === 'pvp' && this.players.length >= 2) {
      this.pvp = { round: 0, rounds: Math.max(3, this.players.length - (this.players.length % 2 ? 0 : 1)) };
      this.choice = null; this.round++; this.emit({ t: 'pvpStart', rounds: this.pvp.rounds }); this.openShop();
    }
  }

  // ---------------------------------------------------------------- network rows
  publicState() {
    return {
      ph: this.phase, pt: Math.round(this.phaseT * 10) / 10, rd: this.round, fr: this.finalRound, ext: this.extensions, hp: this.health, mhp: this.maxHealth,
      lim: this.phase === 'shop' && this.settings.amonTimer ? AMON.shopTime : 0, bt: AMON.battleTime,
      sp: [this.speed || 1, this.players.filter(q => q.speedVote && !q.isBot && q.connected).length, this.speedNeed(), ...this.players.filter(q => q.speedVote).map(q => q.id)],
      pvp: this.pvp ? { round: this.pvp.round, rounds: this.pvp.rounds, byes: this.pvp.byes || [], vs: !!this.pvp.vs } : null,
      vs: this.pvp && this.pvp.vs ? (this.vsPlan || []).map(([a, b, gh]) => [a, b, gh ? 1 : 0]) : null,
      res: this.result, ch: this.choice, df: { relaxed: 'easy', brutal: 'hard' }[this.settings.waveDifficulty] || this.settings.waveDifficulty || 'normal',
      wave: this.wave && !this.pvp ? this.wave.map(g => [g.unit, g.n, g.boss ? g.name : 0]) : null,
      fac: this.wave && !this.pvp ? this.wave.faction : null, ftr: this.wave && !this.pvp ? this.wave.trait : null, fwhy: this.wave && !this.pvp ? this.wave.why : null, wp: this.wave && !this.pvp ? Math.round(this.wavePoints(this.wave)) : 0,
      fl: this.fields.map(f => [f.id, f.owners, f.done ? 1 : 0, f.winner ?? -1]),
      pl: this.players.map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.isBot, on: p.connected, gold: p.gold, lv: p.level, up: p.upCost, rd: p.ready,
        of: p.offers, lk: p.locked ? 1 : 0, be: p.bench.map(x => [x.id, x.rank, Math.round((x.grow || 0) * 100), x.bonus || 0]), bo: p.board.map(x => x ? [x.id, x.rank, Math.round((x.grow || 0) * 100), x.bonus || 0, x.at ? [x.at.x, x.at.z] : 0] : 0),
        k: p.kills, d: Math.round(p.dealt), sc: p.score, pv: [p.pvpPts, p.pvpW, p.pvpL], v: p.view,
        tm: p.team, vh: p.vsHp, out: p.out ? 1 : 0, seen: this.pvp && this.pvp.vs ? p.seen : undefined })),
    };
  }
  fieldState(fid, sinceSeq = 0) {
    const f = this.fields.find(x => x.id === fid);
    if (!f) return null;
    const r1 = v => Math.round(v * 10) / 10;
    return {
      id: f.id, th: f.theme, ob: f.obstacles, ow: f.owners, t: r1(f.t), done: f.done ? 1 : 0,
      u: f.units.filter(u => !u.dead).map(u => [u.id, u.def.id, u.side, r1(u.x), r1(u.z), Math.max(1, Math.round(u.hp / u.max * 100)), u.tgt && !u.tgt.dead ? u.tgt.id : 0,
        u.atkN & 255, (u.sieged ? 1 : 0) | (u.stealthT > 0 ? 2 : 0) | (u.slowT > 0 ? 4 : 0) | (u.burnT > 0 ? 8 : 0) | (u.psLeft > 0 ? 512 : 0) | (u.stunT > 0 ? 16 : 0) | (u.boss ? 32 : 0) | (u.deployT > 0 ? 64 : 0) | (u.pilot ? 128 : 0) | (u.barrier > 0 ? 256 : 0),
        u.owner ? this.players.findIndex(p => p.id === u.owner) : -1, u.boss ? u.name : 0]),
      sh: f.shells.map(s => [r1(s.x0), r1(s.z0), r1(s.x1), r1(s.z1), r1(s.t), r1(s.dur), s.side, s.stick ? 2 : s.big ? 1 : 0]),
      mi: f.mines.map(m => [r1(m.x), r1(m.z), m.side]),
      st: f.storms.map(s => [r1(s.x), r1(s.z), s.r, r1(s.t), s.side]),
      ev: evsAfter(f.evs, sinceSeq), seq: f.evSeq,
    };
  }
}

// v1.2.6: a field's events are in seq order: binary search instead of scanning the whole battle's list on every update
function evsAfter(evs, since) {
  let lo = 0, hi = evs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (evs[m].s > since) hi = m; else lo = m + 1; }
  return evs.slice(lo);
}
// Units a card's units summon (interceptors, broodlings...) carry the same board buffs as their parent.
function inheritSt(def, parent) {
  const ps = parent.st, pd = parent.def;
  const hpK = ps.hp / Math.max(1, pd.hp), atkK = pd.atk ? ps.atk / pd.atk : (ps.abMul || 1);
  const st = enemyStats(def, hpK, atkK);
  st.rate = (def.rate || 0) * (pd.rate ? ps.rate / pd.rate : 1);
  st.armor = (def.armor || 0) + Math.max(0, ps.armor - (pd.armor || 0));
  st.speed = def.speed * (pd.speed ? Math.max(0.5, ps.speed / pd.speed) : 1);
  for (const k of ['lifesteal', 'chain', 'slow', 'burn', 'poison', 'hex', 'regen', 'encore', 'block', 'thorns', 'pen', 'knock', 'resist', 'bomb']) st[k] = ps[k] || 0;
  st.splash = (def.splash || 0) + Math.max(0, ps.splash - (pd.splash || 0));
  return st;
}
function enemyStats(def, hpMul, dmgMul) {
  return { hp: def.hp * hpMul, atk: (def.atk || 0) * dmgMul, rate: def.rate || 0, speed: def.speed, range: def.range, splash: def.splash || 0, armor: def.armor || 0,
    regen: 0, lifesteal: 0, chain: 0, slow: 0, burn: 0, poison: 0, hex: 0, abMul: Math.sqrt(hpMul * dmgMul),
    encore: 0, block: 0, shield: 0, thorns: 0, drain: 0, pen: 0, mines: 0, knock: 0, resist: 0, turret: 0, drone: 0, bomb: 0, meteor: 0 };
}

// Only units built to block can block when a player pilots them: shield bearers, barrier units and anything with a block bonus.
export function canBlock(u) { const d = u.def; return d.look.gear === 'shield' || !!(d.ab && (d.ab.cap || d.ab.ward)) || (u.st && u.st.block > 0); }
function setPilotInput(P, a) {
  const n = hypot(+a.mx || 0, +a.mz || 0);
  P.mx = n > 1 ? a.mx / n : +a.mx || 0; P.mz = n > 1 ? a.mz / n : +a.mz || 0;
  if (Number.isFinite(+a.ax) && Number.isFinite(+a.az)) { P.ax = clamp(+a.ax, -AMON.field.hx, AMON.field.hx); P.az = clamp(+a.az, -AMON.field.hz, AMON.field.hz); }
  P.fire = !!a.fire; P.block = !!a.block; if (a.dash) P.dash = true;
}
// Formation: at the start every side fans out into a wide line, then marches forward as one group at the pace of its slowest
// walker. A unit only leaves the line once it can actually fight: it has an enemy in its own reach (or one that hits it from
// within its reach). Everyone else keeps marching. Healers and other non-attackers stay until half their group has broken off.
// Survivors that move to another field arrive as a new group and form up the same way.
function formGroup(f, list, side, fan) {
  const sp = list.filter(u => u.def.speed >= 1.5).map(u => u.st.speed);
  const fm = { side, broken: !list.length, ax: 0, speed: clamp(sp.length ? Math.min(...sp) : 3, 2, 4), t0: f.t, fan, n: list.length, nFree: 0, contact: false };
  for (const u of list) { u.fg = fm; u.free = false; }
  (f.fgs || (f.fgs = [])).push(fm);
  if (f.allFree) { fm.broken = fm.contact = true; for (const u of list) u.free = true; fm.nFree = list.length; }   // the field is already fighting
  if (f.allFree) { fm.broken = fm.contact = true; for (const u of list) u.free = true; fm.nFree = list.length; }   // the field is already fighting
  return fm;
}
function initForm(f) {
  f.fgs = [];
  f.form = [0, 1].map(side => {
    const list = f.units.filter(u => u.side === side && !u.dead);
    const zs = list.map(u => Math.abs(u.z)), zMax = Math.max(1, ...zs), k = clamp(40 / zMax, 1, 1.45);
    for (const u of list) u.slot = { x: u.x, z: clamp(u.z * k, -AMON.field.hz + 2, AMON.field.hz - 2) };
    return formGroup(f, list, side, AMON.fanTime);
  });
}
const fights = u => u.sieged || (u.st.atk > 0 && (u.st.rate > 0 || u.def.rate > 0));
// v1.0.1: the moment any unit on a field fights, every formation on that field (both sides) breaks ranks and
// every unit moves and picks targets freely
function freeUnit(f, u) {
  const fm = u.fg;
  if (u.free && (!fm || fm.broken)) return;
  u.free = true;
  breakAll(f);
}
function breakAll(f) {
  if (!f.fgs || f.allFree) return;
  f.allFree = true;
  for (const fm of f.fgs) {
    if (!fm.contact) { fm.contact = true; f.evs.push({ k: 'form', side: fm.side, s: ++f.evSeq }); }
    fm.broken = true;
  }
  for (const x of f.units) if (x.fg && !x.free) { x.free = true; if (x.fg) x.fg.nFree++; }
}

// =====================================================================
// battle simulation (one field)
// =====================================================================
const CELL = 4;
function gridKey(x, z) { return ((Math.floor(x / CELL) + 64) << 8) | (Math.floor(z / CELL) + 64); }
function buildGrid(f) {   // v1.2.6: the cell lists are kept from tick to tick (emptied and refilled in the same order)
  let g = f.grid;
  if (!g) f.grid = g = new Map(); else for (const a of g.values()) a.length = 0;
  for (const u of f.units) { if (u.dead) continue; const k = gridKey(u.x, u.z); let a = g.get(k); if (!a) g.set(k, a = []); a.push(u); }
}
function near(f, x, z, r, fn) {
  const g = f.grid, c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
  for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
    const a = g.get(((cx + 64) << 8) | (cz + 64)); if (!a) continue;
    for (const u of a) if (!u.dead && (u.x - x) ** 2 + (u.z - z) ** 2 <= r * r) fn(u);
  }
}
const canHit = (a, t) => (t.air ? a.def.hitsAir : a.def.hitsGround !== false) && t.stealthT <= 0;
const radius = u => Math.max(0.3, u.def.size * 0.55);
function curRange(u) { return u.sieged ? u.def.ab.siege.range + (u.st.range - u.def.range) : u.st.range; }
function curMin(u) { return u.sieged ? u.def.ab.siege.minRange : (u.def.minRange || 0); }

export function stepField(g, f, dt) {
  f.t += dt;
  buildGrid(f);
  if (f.fgs) for (const fm of f.fgs) if (!fm.broken) {
    const ft = f.t - fm.t0; if (ft > fm.fan) fm.ax += fm.speed * dt; if (ft > fm.fan + 30) fm.broken = true;
    // v1.0.1: a formation marches at most to the middle of the field; once any of its units gets there the
    // whole group breaks ranks and everyone attacks at will
    if (!fm.broken && f.units.some(u => u.fg === fm && !u.dead && (fm.side === 0 ? u.x >= 0 : u.x <= 0))) {
      fm.broken = true;
      for (const u of f.units) if (u.fg === fm && !u.free) { u.free = true; fm.nFree++; }
      if (!fm.contact) { fm.contact = true; f.evs.push({ k: 'form', side: fm.side, s: ++f.evSeq }); }
    }
  }
  const units = f.units;
  // field-wide auras (ward, rally) refresh twice a second
  if ((f.auraT = (f.auraT || 0) - dt) <= 0) {
    f.auraT = 0.5;
    for (const u of units) { u.ward = 0; u.rally = 0; }
    for (const u of units) {
      if (u.dead) continue;
      if (u.st.drain) {   // Drain Life: hurts every enemy close by and heals from it
        let got = 0;
        near(f, u.x, u.z, 5, a => { if (a.side !== u.side && !a.dead) { const h = a.hp; hurt(g, f, a, u.st.drain * 0.5, u, { raw: true }); got += h - Math.max(0, a.hp); } });
        if (got) u.hp = Math.min(u.max, u.hp + got * 0.5);
      }
      if (!u.def.ab) continue;
      const ab = u.def.ab;
      if (ab.ward) near(f, u.x, u.z, ab.ward.r, a => { if (a.side === u.side) a.ward = Math.max(a.ward, ab.ward.cut); });
      if (ab.rally) near(f, u.x, u.z, ab.rally.r, a => { if (a.side === u.side && a !== u) a.rally = Math.max(a.rally, ab.rally.atk); });
      if (ab.burnAura) near(f, u.x, u.z, ab.burnAura.r, a => { if (a.side !== u.side && !a.air) hurt(g, f, a, ab.burnAura.dps * 0.5 * u.st.abMul, u, { raw: true }); });
    }
  }
  for (const u of units) if (!u.dead) stepUnit(g, f, u, dt);
  // shells in flight
  for (let i = f.shells.length - 1; i >= 0; i--) {
    const s = f.shells[i]; s.t += dt;
    if (s.follow && !s.follow.dead) { s.x0 = s.x1 = s.follow.x; s.z0 = s.z1 = s.follow.z; }
    if (s.t < s.dur) continue;
    f.shells.splice(i, 1);
    blast(g, f, s.x1, s.z1, s.splash, s.dmg, s.src, s.side, false);
  }
  // mines go off when an enemy walks over them
  if (f.mines.length && (f.mineT = (f.mineT || 0) - dt) <= 0) {
    f.mineT = 0.2;
    for (let i = f.mines.length - 1; i >= 0; i--) {
      const m = f.mines[i]; let hit = false;
      near(f, m.x, m.z, 1.8, o => { if (o.side !== m.side && !o.air) hit = true; });
      if (hit) { f.mines.splice(i, 1); blast(g, f, m.x, m.z, m.r, m.dmg, m.src && !m.src.dead ? m.src : null, m.side, false); }
    }
  }
  // storms
  for (let i = f.storms.length - 1; i >= 0; i--) {
    const s = f.storms[i]; s.t -= dt;
    if ((s.tick = (s.tick || 0) - dt) <= 0) { s.tick = 0.5; near(f, s.x, s.z, s.r, a => { if (a.side !== s.side) hurt(g, f, a, s.dps * 0.5, s.src, { raw: true }); }); }
    if (s.t <= 0) f.storms.splice(i, 1);
  }
  // echoes come back
  for (let i = f.respawns.length - 1; i >= 0; i--) {
    const r = f.respawns[i]; r.t -= dt; if (r.t > 0) continue;
    f.respawns.splice(i, 1);
    const u = g.spawn(f, r.def, r.side, r.x, r.z, r.owner, r.st); u.hp = u.max * 0.5; u.echoed = true; u.card = r.card;
    f.evs.push({ k: 'echo', x: r.x, z: r.z, s: ++f.evSeq });
  }
  // tidy up and check the outcome
  if (units.length > 60) { let nd = 0; for (const u of units) if (u.dead) nd++; if (nd > 30) f.units = units.filter(u => !u.dead); }
  if ((f.checkT -= dt) <= 0) {
    f.checkT = 0.5;
    let a = 0, b = 0, aHit = false, bHit = false;
    const live = f.units.filter(u => !u.dead);
    for (const u of live) if (u.side === 0) a++; else b++;
    if (a && b) {
      // nobody left who can hurt the other side (for example ground melee against air only): stalemate
      for (const u of live) {
        if (aHit && bHit) break;
        const canAtk = (u.st.atk > 0 || (u.def.ab && (u.def.ab.hangar || u.def.ab.spawn || u.def.ab.storm || u.def.ab.burnAura))) && !u.def.ab?.heal?.only;
        if (!canAtk) continue;
        if (u.side === 0 && !aHit && live.some(t => t.side === 1 && (t.air ? (u.def.hitsAir || u.def.ab?.hangar) : u.def.hitsGround !== false))) aHit = true;
        if (u.side === 1 && !bHit && live.some(t => t.side === 0 && (t.air ? (u.def.hitsAir || u.def.ab?.spawn) : u.def.hitsGround !== false))) bHit = true;
      }
    }
    if (!a || !b || (!aHit && !bHit && f.t > 3)) {
      if (f.respawns.length && (a || b) && !(a && b)) {
        const side = f.respawns[0].side; if ((side === 0 && !a) || (side === 1 && !b)) return;   // an echo is about to return
      }
      f.done = true; f.winner = a && !b ? 0 : b && !a ? 1 : -1;
      f.evs.push({ k: 'done', w: f.winner, s: ++f.evSeq });
    }
  }
}

// The piloted unit's target: the enemy in reach closest to where its player aims (within a cone toward the aim point).
function pilotTarget(f, u) {
  const P = u.pilot, ax = P.ax - u.x, az = P.az - u.z, al = hypot(ax, az) || 1;
  let best = null, bs = 1e9;
  for (const t of f.units) {
    if (t.dead || t.side === u.side || !canHit(u, t)) continue;
    const dx = t.x - u.x, dz = t.z - u.z, d = hypot(dx, dz) || 1;
    if (d > curRange(u) + radius(t) + 0.6 || d < curMin(u)) continue;
    const cos = (dx * ax + dz * az) / (d * al);
    if (cos < 0.45 && d > radius(t) + 1.2) continue;
    const s = hypot(t.x - P.ax, t.z - P.az) + (1 - cos) * 6;
    if (s < bs) { bs = s; best = t; }
  }
  return best;
}
function retarget(f, u) {
  let best = null, bd = 1e9;
  const lo = curMin(u), lob = !!(u.def.shell || u.def.ab?.siege), reach = lob ? curRange(u) + 2 : 0, lobR = Math.max(2.5, u.st.splash || 0);
  const slack = (lob ? 28 : 0) + 5;   // v1.2.6: the most the adjustments below take off a distance (+1 for rounding)
  for (const t of f.units) {
    if (t.dead || t.side === u.side) continue;
    const dx = t.x - u.x, dz = t.z - u.z, lim = bd + slack;
    if (dx >= lim || -dx >= lim || dz >= lim || -dz >= lim || !canHit(u, t)) continue;   // can't beat the best so far (hypot >= |dx|, |dz|)
    let d = hypot(dx, dz);
    if (lo && d < lo) d += 40;   // artillery would rather shoot something it can reach
    if (lob && d <= reach) { let n = 0; near(f, t.x, t.z, lobR, o => { if (o.side !== u.side && !o.dead && !o.air) n++; }); d -= Math.min(6, n) * 4 + (hypot(t.vx || 0, t.vz || 0) < 0.5 ? 4 : 0); }   // artillery: crowds and slow targets first
    if (t.boss) d -= 4;
    if (d < bd) { bd = d; best = t; }
  }
  u.tgt = best;
}

function stepUnit(g, f, u, dt) {
  const ab = u.def.ab || {}, st = u.st;
  u.age += dt;
  if (u.lx === u.lx && dt > 0) { u.vx = u.vx * 0.6 + (u.x - u.lx) / dt * 0.4; u.vz = u.vz * 0.6 + (u.z - u.lz) / dt * 0.4; }   // smoothed velocity, so artillery can lead its shots (lx is NaN before the first step)
  u.lx = u.x; u.lz = u.z;
  if (u.stealthT > 0) u.stealthT -= dt;
  if (u.slowT > 0) u.slowT -= dt;
  if (u.hexT > 0) u.hexT -= dt;
  if (u.burnT > 0) {   // ignite (as in the shooter since v26): every hit adds its own burn stack, so fast attackers pile them up
    let dps = 0, left = 0;
    const B = u.burns;   // v1.2.6: spent stacks dropped in place (was a new array per burning unit per tick)
    if (B) { let w = 0; for (let i = 0; i < B.length; i++) { const b = B[i]; b.t -= dt; if (b.t > 0) { dps += b.dps; left = Math.max(left, b.t); B[w++] = b; } } B.length = w; }
    u.burnT = left; u.burnDps = dps;
    if (dps) { hurt(g, f, u, dps * dt, u.burnSrc && !u.burnSrc.dead ? u.burnSrc : null, { raw: true }); if (u.dead) return; }
  }
  if (u.psLeft > 0) {   // poison (as in the shooter since v26): eats a share of max health, ramping up the longer it stays on
    u.psLeft -= dt; u.psT += dt;
    const big = u.boss || (u.def.tags || []).includes('large');
    const rate = Math.min(u.max, AMON_POISON.hpCap) * AMON_POISON.share / AMON_POISON.dur * (0.4 + 0.24 * Math.min(u.psT, AMON_POISON.rampCap)) * u.psLvl * (big ? AMON_POISON.big : 1);
    hurt(g, f, u, rate * dt, u.psSrc && !u.psSrc.dead ? u.psSrc : null, { raw: true }); if (u.dead) return;
  }
  const regen = st.regen + (ab.regen ? ab.regen.hps : 0);
  if (regen && u.hp < u.max) u.hp = Math.min(u.max, u.hp + regen * dt);
  if (ab.expire && u.age > ab.expire.t) { kill(g, f, u, null); return; }
  if (u.stunT > 0) { u.stunT -= dt; return; }
  abilities(g, f, u, dt, ab);
  if (u.dead) return;
  const slowMul = u.slowT > 0 ? 1 - u.slowAmt : 1;
  let mx = 0, mz = 0, spMul = 1;
  if (u.pilot) {
    // a player is driving: move where they steer, attack what they aim at, block if this unit can
    const P = u.pilot; mx = P.mx; mz = P.mz;
    const blocking = P.block && u.blocker;
    // Shift: a short dash (every 4 s) in the steering direction, or toward the aim point when standing still
    if (u.dashCd > 0) u.dashCd -= dt;
    if (P.dash) {
      P.dash = false;
      if (!(u.dashCd > 0)) {
        let dx = mx, dz = mz; if (!dx && !dz && P.ax != null) { dx = P.ax - u.x; dz = P.az - u.z; }
        const l = hypot(dx, dz);
        if (l > 1e-3) { u.dashT = 0.3; u.dashX = dx / l; u.dashZ = dz / l; u.dashCd = 4; f.evs.push({ k: 'dash', x: u.x, z: u.z, s: ++f.evSeq }); }
      }
    }
    if (u.dashT > 0) { u.dashT -= dt; mx = u.dashX; mz = u.dashZ; spMul = 3.2; }
    else if (blocking) spMul = 0.5;
    else if (P.fire) {
      const t = pilotTarget(f, u);
      if (t) { u.tgt = t; attack(g, f, u, t, dt); }
      else if (!(u.cd > 0) && st.rate && st.atk) {
        // nothing in reach: the shot still goes out toward the aim point (same range), it just hits nothing
        const rate = u.sieged ? (ab.siege && ab.siege.rate) || st.rate : st.rate, L = curRange(u);
        let dx = P.ax - u.x, dz = P.az - u.z; const l = hypot(dx, dz) || 1; dx /= l; dz /= l;
        u.cd = 1 / rate;
        f.evs.push({ k: 'whiff', x: u.x, z: u.z, x2: u.x + dx * L, z2: u.z + dz * L, side: u.side, melee: L <= 3 ? 1 : 0, air: u.air ? 1 : 0, s: ++f.evSeq });
      }
    }
    if (u.cd > 0) u.cd -= dt * slowMul * 1.2;   // a commander's hand: attacks come 20% faster
    spMul *= 1.15;
  } else {
  // targets
  // v1.2.6: losing a target looks for a new one at once, but a unit with none waits for its own (staggered) timer: every unit
  // spawns with none, so all of them scanned the whole field in a battle's first tick, and again every tick while nothing was in reach
  const tg0 = u.tgt;
  if ((u.retT -= dt) <= 0 || (tg0 && (tg0.dead || tg0.side === u.side || tg0.stealthT > 0))) { u.retT = 0.45 + Math.random() * 0.2; retarget(f, u); }
  const t = u.tgt;
  // siege mode: lock down when something is in reach
  if (ab.siege) {
    if (u.deployT > 0) { u.deployT -= dt; if (u.deployT <= 0) { u.sieged = !u.sieged; u.cd = 0.3; } return; }
    const d = t ? hypot(t.x - u.x, t.z - u.z) : 1e9;
    if (!u.sieged && t && d <= ab.siege.range + (st.range - u.def.range) - 1 && d >= ab.siege.minRange) { u.deployT = ab.siege.deploy; return; }
    if (u.sieged) {
      if (!t || d > curRange(u) + 2 || d < ab.siege.minRange) { u.idleT += dt; if (u.idleT > 2.5) { u.idleT = 0; u.deployT = ab.siege.deploy; } }
      else u.idleT = 0;
    }
  }
  const range = curRange(u) + (t ? radius(t) : 0);
  const fm = u.fg || (u.parent && u.parent.fg), inForm = fm && !fm.broken && !u.free && !(u.parent && u.parent.free);
  const d = t ? hypot(t.x - u.x, t.z - u.z) || 1 : 1e9;
  if (inForm && u.sieged) { if (t && d <= range) attack(g, f, u, t, dt); }   // locked down: fires as soon as it can
  else if (inForm && (!t || d > range || d < curMin(u) || !fights(u))) {
    // keep formation: fan out to your spot, then march with the group (kids stay with their parent)
    let gx, gz;
    if (u.slot) { gx = u.slot.x + (u.side === 0 ? 1 : -1) * fm.ax; gz = u.slot.z; }
    else if (u.parent && !u.parent.dead) { gx = u.parent.x; gz = u.parent.z; }
    if (gx != null) {
      const dx = gx - u.x, dz = gz - u.z, dd = hypot(dx, dz);
      if (dd > (u.slot ? 0.35 : 3)) { mx = dx / dd; mz = dz / dd; if (f.t > AMON.fanTime && dd < 2.5) spMul = Math.min(1, fm.speed / Math.max(0.5, st.speed) + dd * 0.15); }
    }
  } else if (t) {
    const dx = t.x - u.x, dz = t.z - u.z;
    if (d > range && !u.sieged) { mx = dx / d; mz = dz / d; }
    else if (d < curMin(u) && !u.sieged) { mx = -dx / d; mz = -dz / d; }
    else attack(g, f, u, t, dt);
  } else if (!u.sieged) {
    // nothing to fight: advance toward the other side and hold near the middle
    const goal = u.side === 0 ? 12 : -12;
    if (Math.abs(u.x - goal) > 2) mx = Math.sign(goal - u.x);
  }
  if (u.cd > 0) u.cd -= dt * slowMul;
  }
  if (u.slideT > 0) u.slideT -= dt;
  if (mx || mz) {
    if (!u.air && avoid(f, u, mx, mz)) { mx = AV[0]; mz = AV[1]; }
    // stuck for a while (crowds, rocks): pick the other way around for a moment
    if ((u.stuckT = (u.stuckT || 0) + dt) > 2) {
      if (hypot(u.x - (u.sx ?? 1e9), u.z - (u.sz ?? 1e9)) < 0.6) { u.slideDir = -(u.slideDir || 1); u.slideT = 1.5; u.wander = 1; }
      u.stuckT = 0; u.sx = u.x; u.sz = u.z;
    }
    if (u.wander > 0) { u.wander -= dt; const a = Math.atan2(mz, mx) + (u.slideDir || 1) * 1.2; mx = Math.cos(a); mz = Math.sin(a); }
    const sp = st.speed * slowMul * spMul * (u.charged ? 1.35 : 1);
    u.x += mx * sp * dt; u.z += mz * sp * dt;
  } else u.stuckT = 0;
  // keep apart from neighbors (same layer) and out of rocks
  const R = radius(u);
  separate(f, u, R);
  if (!u.air) for (const ob of f.obstacles) {
    const dx = u.x - ob.x, dz = u.z - ob.z, min = ob.r + R;
    if (dx >= min || -dx >= min || dz >= min || -dz >= min) continue;   // v1.2.6: clearly outside (hypot >= |dx|, |dz|): skip the hypot
    const d = hypot(dx, dz);
    if (d < min) {
      const nx = dx / (d || 1), nz = dz / (d || 1);
      u.x = ob.x + nx * min; u.z = ob.z + nz * min;
      if (mx || mz) { const side = (mx * nz - mz * nx) > 0 ? 1 : -1; u.x += -nz * side * st.speed * dt * 0.8; u.z += nx * side * st.speed * dt * 0.8; }   // slide around it
    }
  }
  u.x = clamp(u.x, -AMON.field.hx, AMON.field.hx); u.z = clamp(u.z, -AMON.field.hz, AMON.field.hz);
}

// v1.2.6: near(f, u.x, u.z, R + 1.6, ...) written out for the per-unit push-apart (same cells, order and math, so battles
// play out exactly as before): no closure per unit per tick, and no hypot for neighbors that are clearly too far to touch.
function separate(f, u, R) {
  const x = u.x, z = u.z, r = R + 1.6, rr = r * r, g = f.grid, c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
  for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
    const a = g.get(((cx + 64) << 8) | (cz + 64)); if (!a) continue;
    for (const o of a) {
      if (!(!o.dead && (o.x - x) ** 2 + (o.z - z) ** 2 <= rr)) continue;
      if (o === u || o.air !== u.air) continue;
      if (u.pilot && o.side === u.side) continue;   // allies make way for the unit a player drives
      const dx = u.x - o.x, dz = u.z - o.z, min = R + Math.max(0.3, o.def.size * 0.55);
      if (dx >= min || -dx >= min || dz >= min || -dz >= min) continue;   // hypot >= min: neither case below applies
      const d = hypot(dx, dz);
      if (d < min && d > 1e-4) { const push = (min - d) * (o.side === u.side ? (o.pilot ? 1 : 0.5) : 0.35); u.x += dx / d * push; u.z += dz / d * push; }
      else if (d <= 1e-4) { u.x += (Math.random() - 0.5) * 0.2; u.z += (Math.random() - 0.5) * 0.2; }
    }
  }
}
// Steer around the nearest rock on the way (sticky side choice so units don't dither in front of it).
// v1.2.6: true = steer toward (AV[0], AV[1]) instead (no array per steering unit per tick); false = keep (mx, mz).
const AV = new Float64Array(2);
function avoid(f, u, mx, mz) {
  const R = Math.max(0.3, u.def.size * 0.55);   // (radius(u) and clamp() written out here and in separate(): a call boxed every number it returned)
  let best = null, bd = 1e9;
  for (const ob of f.obstacles) {
    const ox = ob.x - u.x, oz = ob.z - u.z, along = ox * mx + oz * mz;
    if (along <= -ob.r * 0.3 || along > ob.r + 7) continue;
    if (Math.abs(ox * mz - oz * mx) > ob.r + R + 0.6) continue;
    if (along < bd) { bd = along; best = ob; }
  }
  if (!best) return false;
  const rx = u.x - best.x, rz = u.z - best.z, d = hypot(rx, rz) || 1;
  const t1x = -rz / d, t1z = rx / d;
  if (!(u.slideT > 0) || !u.slideDir) u.slideDir = t1x * mx + t1z * mz >= 0 ? 1 : -1;
  u.slideT = Math.max(u.slideT || 0, 0.8);
  const tx = t1x * u.slideDir, tz = t1z * u.slideDir;
  const w = Math.max(0.25, Math.min(1, (best.r + R + 3.5 - d) / 3.5));
  const nx = mx * (1 - w) + tx * w, nz = mz * (1 - w) + tz * w, l = hypot(nx, nz) || 1;
  AV[0] = nx / l; AV[1] = nz / l; return true;
}

function attack(g, f, u, t, dt) {
  if (u.cd > 0) return;
  const st = u.st, ab = u.def.ab || {};
  const rate = u.sieged ? ab.siege.rate : st.rate;
  if (!rate || (!st.atk && !(u.sieged))) return;
  u.cd = 1 / (rate * (1 + (u.rally || 0) * 0.5));
  u.atkN++;
  freeUnit(f, u);
  if (st.encore && Math.random() < st.encore) u.cd = Math.min(u.cd, 0.08);   // Encore: fires again right away
  if (st.meteor && u.atkN % 5 === 0) {   // Skyfall: every 5th attack calls a meteor onto the target
    f.shells.push({ x0: t.x - 10, z0: t.z, x1: t.x, z1: t.z, t: 0, dur: 0.9, dmg: Math.max(25, st.atk * 2) * st.meteor, splash: 3, src: u, side: u.side, big: true });
  }
  let dmg = (u.sieged ? ab.siege.atk * (st.atk / Math.max(1, u.def.atk || 1)) : st.atk) * (1 + (u.rally || 0));
  if (ab.enrage && u.hp < u.max * ab.enrage.at) dmg *= ab.enrage.mul;
  if (u.pilot) {   // piloted: +20% damage, and every 4th attack is a heavy blow (double damage)
    dmg *= 1.2;
    if ((u.pilotN = (u.pilotN || 0) + 1) % 4 === 0) { dmg *= 2; f.evs.push({ k: 'heavy', x: t.x, z: t.z, air: t.air, s: ++f.evSeq }); }
  }
  if (u.charged) { dmg *= ab.charge.mul; u.charged = false; f.evs.push({ k: 'charge', x: u.x, z: u.z, s: ++f.evSeq }); }
  const splash = u.sieged ? ab.siege.splash + st.splash : st.splash;
  if (ab.suicide) { blast(g, f, u.x, u.z, splash || 2.5, dmg, u, u.side, false); kill(g, f, u, null, true); return; }
  if (u.sieged || u.def.shell) {
    // lob it where the target will be when the shell lands (a piloted shot goes where the player aims)
    const d = hypot(t.x - u.x, t.z - u.z), dur = 0.35 + d / 24, lead = u.pilot ? 0 : dur * 0.9;
    f.shells.push({ x0: u.x, z0: u.z, x1: t.x + (t.vx || 0) * lead, z1: t.z + (t.vz || 0) * lead, t: 0, dur, dmg, splash: Math.max(splash, 1), src: u, side: u.side, big: u.def.size > 1.2 });
    return;
  }
  if (ab.pierce) {
    const dx = t.x - u.x, dz = t.z - u.z, d = hypot(dx, dz) || 1, nx = dx / d, nz = dz / d, L = Math.max(ab.pierce.len, d + 1);
    f.evs.push({ k: 'pierce', x: u.x, z: u.z, x2: u.x + nx * L, z2: u.z + nz * L, side: u.side, s: ++f.evSeq });
    near(f, u.x + nx * L / 2, u.z + nz * L / 2, L / 2 + 1, o => {
      if (o.side === u.side || !canHit(u, o)) return;
      const px = o.x - u.x, pz = o.z - u.z, along = px * nx + pz * nz, off = Math.abs(px * nz - pz * nx);
      if (along > 0 && along < L && off < ab.pierce.w + radius(o)) hurt(g, f, o, dmg, u, { hit: true });
    });
    return;
  }
  if (splash > 0) blast(g, f, t.x, t.z, splash, dmg, u, u.side, t.air, t);
  else hurt(g, f, t, dmg, u, { hit: true });
  const chainN = (ab.chain ? ab.chain.n : 0) + st.chain;
  if (chainN > 0) {
    let from = t, hitSet = new Set([t]), d2 = dmg, fall = ab.chain ? ab.chain.falloff : 0.7;
    for (let k = 0; k < chainN; k++) {
      let nxt = null, bd = (ab.chain ? ab.chain.r : 5) ** 2;
      near(f, from.x, from.z, ab.chain ? ab.chain.r : 5, o => { if (o.side !== u.side && !hitSet.has(o) && canHit(u, o)) { const d = (o.x - from.x) ** 2 + (o.z - from.z) ** 2; if (d < bd) { bd = d; nxt = o; } } });
      if (!nxt) break;
      d2 *= fall; hitSet.add(nxt);
      f.evs.push({ k: 'chain', x: from.x, z: from.z, x2: nxt.x, z2: nxt.z, air: nxt.air ? 1 : 0, side: u.side, s: ++f.evSeq });
      hurt(g, f, nxt, d2, u, { hit: true });
      from = nxt;
    }
  }
  if (st.bomb && !t.dead) f.shells.push({ x0: t.x, z0: t.z, x1: t.x, z1: t.z, t: 0, dur: 1, dmg: dmg * st.bomb, splash: 1.6, src: u, side: u.side, stick: true, follow: t });
  if (ab.brood && !t.dead) { const d = UNIT_BY_ID.get(ab.brood.unit); g.spawn(f, d, u.side, t.x + (Math.random() - 0.5) * 2, t.z + (Math.random() - 0.5) * 2, u.owner, inheritSt(d, u)); }
}

function blast(g, f, x, z, r, dmg, src, side, air, primary = null) {
  f.evs.push({ k: 'boom', x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, r: Math.round(r * 10) / 10, side, s: ++f.evSeq });
  near(f, x, z, r + 1.5, o => {
    if (o.side === side || o.air !== !!air) return;
    const d = hypot(o.x - x, o.z - z) - radius(o);
    if (d > r) return;
    hurt(g, f, o, o === primary ? dmg : dmg * (d < r * 0.5 ? 0.8 : 0.55), src, { hit: o === primary || !primary });
  });
}

// One hit. opts.raw: damage over time (no armor, no on-hit effects); opts.hit: a direct hit (on-hit effects apply).
function hurt(g, f, t, amt, src, opts = {}) {
  if (t.dead || amt <= 0) return;
  if (src && src.def) {
    const bonus = src.def.bonus;
    if (bonus) for (const [tag, m] of Object.entries(bonus)) if ((tag === 'air' && t.air) || (t.def.tags || []).includes(tag)) { amt *= m; break; }
  }
  if (t.hexT > 0) amt *= 1 + t.hexAmt;
  if (t.ward) amt *= 1 - t.ward;
  if (t.st.resist) amt *= 1 - t.st.resist;
  const ab = t.def.ab || {};
  if (!opts.raw) {
    if (ab.phase && ++t.hitN % ab.phase.every === 0) { f.evs.push({ k: 'phase', x: t.x, z: t.z, s: ++f.evSeq }); return; }
    if (t.st.block && Math.random() < t.st.block) { if (t.pilot) f.evs.push({ k: 'block', x: t.x, z: t.z, s: ++f.evSeq }); return; }   // blocked
    if (t.pilot && t.pilot.block && t.blocker) amt *= 0.2;   // a piloted unit holding its block
    else if (t.pilot) amt *= 0.85;   // and a piloted unit fights a little tougher
    amt = Math.max(1, amt - Math.max(0, t.st.armor - ((src && src.st && src.st.pen) || 0)));
    if (ab.cap) amt = Math.min(amt, ab.cap.max * (t.st.abMul || 1));
  }
  if (t.fg && !t.free && src && src.side != null && src.side !== t.side && src.x != null && (!fights(t) || (canHit(t, src) && hypot(src.x - t.x, src.z - t.z) <= curRange(t) + radius(src) + 1.5))) freeUnit(f, t);   // only breaks ranks if it can hit back
  if (t.barrier > 0) { const a = Math.min(t.barrier, amt); t.barrier -= a; amt -= a; if (amt <= 0) return; }
  t.hp -= amt;
  if (src && src.owner) { const p = g.player(src.owner); if (p) p.dealt += amt; }
  if (src && !src.dead && opts.hit) {
    const st = src.st, sab = src.def.ab || {};
    const ls = st.lifesteal + (sab.lifesteal ? sab.lifesteal.f : 0);
    if (ls) src.hp = Math.min(src.max, src.hp + amt * ls);
    const slow = Math.max(st.slow, sab.slow ? sab.slow.amt : 0);
    if (slow) { t.slowT = Math.max(t.slowT, sab.slow ? sab.slow.dur : 1.5); t.slowAmt = Math.max(t.slowT > 0 ? t.slowAmt : 0, slow); }
    const burn = st.burn + (sab.burn ? sab.burn.dps * (src.st.abMul || 1) : 0);
    if (burn) {
      // card ignite stacks per hit; a flamer's own fire is one burn per attacker, refreshed (like the shooter's flamethrower)
      const B = t.burns || (t.burns = []), dur = sab.burn ? sab.burn.dur : 3, own = sab.burn ? B.find(x => x.by === src) : null;
      if (own) { own.t = dur; own.dps = Math.max(own.dps, burn); } else { B.push({ t: dur, dps: burn, by: sab.burn ? src : null }); if (B.length > 6) B.shift(); }
      t.burnT = Math.max(t.burnT, dur); t.burnSrc = src;
    }
    if (st.poison) {   // a new hit refreshes the poison without resetting its ramp
      if (t.psLeft > 0) { t.psLeft = AMON_POISON.dur; t.psLvl = Math.max(t.psLvl, st.poison); }
      else { t.psLeft = AMON_POISON.dur; t.psT = 0; t.psLvl = st.poison; }
      t.psSrc = src;
    }
    if (st.hex) { t.hexT = 2.5; t.hexAmt = Math.max(t.hexAmt, st.hex); }
    if (st.knock && !t.boss && !(t.def.tags || []).includes('large')) {   // knockback
      const dx = t.x - src.x, dz = t.z - src.z, d = hypot(dx, dz) || 1;
      t.x = clamp(t.x + dx / d * st.knock, -AMON.field.hx, AMON.field.hx); t.z = clamp(t.z + dz / d * st.knock, -AMON.field.hz, AMON.field.hz);
    }
  }
  if (t.st.thorns && src && src.def && !src.dead && opts.hit && !opts.thorn) hurt(g, f, src, amt * t.st.thorns, t, { raw: true, thorn: true });
  // blink away once when badly hurt
  if (ab.blink && !t.blinked && t.hp > 0 && t.hp < t.max * ab.blink.at) {
    t.blinked = true;
    const dir = t.side === 0 ? -1 : 1, x0 = t.x, z0 = t.z;
    t.x = clamp(t.x + dir * ab.blink.dist, -AMON.field.hx, AMON.field.hx); t.hp = Math.min(t.max, t.hp + t.max * 0.25); t.tgt = null; t.retT = 0;
    f.evs.push({ k: 'blink', x: x0, z: z0, x2: t.x, z2: t.z, s: ++f.evSeq });
  }
  if (t.hp <= 0) kill(g, f, t, src);
}

function kill(g, f, u, src, quiet = false) {
  if (u.dead) return;
  u.dead = true; u.hp = 0;
  if (!quiet) f.evs.push({ k: 'die', x: Math.round(u.x * 10) / 10, z: Math.round(u.z * 10) / 10, side: u.side, big: u.def.size > 1.4 ? 1 : 0, air: u.air ? 1 : 0, s: ++f.evSeq });
  if (u.parent) u.parent.kids = Math.max(0, u.parent.kids - 1);
  if (!u.air && !u.def.ab?.suicide) { f.corpses.push({ x: u.x, z: u.z, side: u.side, t: f.t }); if (f.corpses.length > 60) f.corpses.shift(); }
  if (src && !src.dead) {
    if (src.owner) { const p = g.player(src.owner); if (p) p.kills++; }
    if (src.def.ab && src.def.ab.cannibal) src.hp = Math.min(src.max, src.hp + src.def.ab.cannibal.heal * src.st.abMul);
  }
  const ab = u.def.ab || {};
  if (ab.deathSpawn) for (let k = 0; k < ab.deathSpawn.n; k++) { const c = g.spawn(f, UNIT_BY_ID.get(ab.deathSpawn.unit), u.side, u.x + (Math.random() - 0.5) * 3, u.z + (Math.random() - 0.5) * 3, u.owner); c.vScale = 0.5; }
  if (u.echo && !u.echoed) f.respawns.push({ t: 1.5, def: u.def, side: u.side, x: u.x, z: u.z, owner: u.owner, st: u.st, card: u.card });
  if (u.boss) f.evs.push({ k: 'bossDown', x: u.x, z: u.z, name: u.name, s: ++f.evSeq });
}

function due(u, key, every, dt) { u.abT[key] = (u.abT[key] ?? every * (0.4 + Math.random() * 0.4)) - dt; if (u.abT[key] > 0) return false; u.abT[key] = every; return true; }
function abilities(g, f, u, dt, ab) {
  const sc = u.st.abMul || 1;
  if (ab.heal && due(u, 'heal', 0.5, dt)) {
    let best = null, bf = 0.999;
    near(f, u.x, u.z, ab.heal.range, a => { if (a.side === u.side && a !== u && (!ab.heal.mech || (a.def.tags || []).includes('mech'))) { const fr = a.hp / a.max; if (fr < bf) { bf = fr; best = a; } } });
    if (best) { best.hp = Math.min(best.max, best.hp + ab.heal.hps * 0.5 * sc); f.evs.push({ k: 'heal', x: u.x, z: u.z, x2: best.x, z2: best.z, s: ++f.evSeq }); }
  }
  if (ab.impact && !u.abT.impacted && f.t > 0.8) {
    u.abT.impacted = true;
    u.x += u.side === 0 ? 24 : -24;
    f.evs.push({ k: 'impact', x: u.x, z: u.z, r: ab.impact.r, s: ++f.evSeq });
    blast(g, f, u.x, u.z, ab.impact.r, ab.impact.dmg * sc, u, u.side, false);
  }
  if (ab.storm && due(u, 'storm', ab.storm.every, dt)) {
    // the densest enemy cluster within 16 m
    let best = null, bn = 0;
    near(f, u.x, u.z, 16, c => { if (c.side === u.side) return; let n = 0; near(f, c.x, c.z, ab.storm.r, o => { if (o.side !== u.side) n++; }); if (n > bn) { bn = n; best = c; } });
    if (best) { f.storms.push({ x: best.x, z: best.z, r: ab.storm.r, dps: ab.storm.dps * sc, t: ab.storm.dur, side: u.side, src: u }); f.evs.push({ k: 'storm', x: best.x, z: best.z, r: ab.storm.r, s: ++f.evSeq }); }
    else u.abT.storm = 1;
  }
  if (ab.quake && due(u, 'quake', ab.quake.every, dt)) {
    let any = false;
    near(f, u.x, u.z, ab.quake.r, o => { if (o.side !== u.side && !o.air) { any = true; hurt(g, f, o, ab.quake.dmg * sc, u, {}); o.stunT = Math.max(o.stunT, ab.quake.stun); } });
    if (any) f.evs.push({ k: 'quake', x: u.x, z: u.z, r: ab.quake.r, s: ++f.evSeq }); else u.abT.quake = 1;
  }
  if (ab.yamato && due(u, 'yamato', ab.yamato.every, dt)) {
    let best = null, bh = 0;
    near(f, u.x, u.z, ab.yamato.range, o => { if (o.side !== u.side && o.hp > bh && o.stealthT <= 0) { bh = o.hp; best = o; } });
    if (best) { f.evs.push({ k: 'yamato', x: u.x, z: u.z, x2: best.x, z2: best.z, air: best.air ? 1 : 0, s: ++f.evSeq }); hurt(g, f, best, ab.yamato.dmg * sc, u, { raw: true }); }
    else u.abT.yamato = 1;
  }
  if (ab.spawn && due(u, 'spawn', ab.spawn.every, dt) && u.kids < ab.spawn.max) {
    for (let k = 0; k < ab.spawn.n; k++) {
      const c = g.spawn(f, UNIT_BY_ID.get(ab.spawn.unit), u.side, u.x + (Math.random() - 0.5) * 4, u.z + (Math.random() - 0.5) * 4, u.owner);
      c.parent = u; u.kids++; c.vScale = 0.5;
    }
    f.evs.push({ k: 'spawn', x: u.x, z: u.z, s: ++f.evSeq });
  }
  if (ab.hangar && u.kids < ab.hangar.max && due(u, 'hangar', ab.hangar.every, dt)) {
    const d = UNIT_BY_ID.get(ab.hangar.unit), c = g.spawn(f, d, u.side, u.x, u.z, u.owner, inheritSt(d, u));
    c.parent = u; u.kids++;
  }
  if (ab.convert && due(u, 'convert', ab.convert.every, dt)) {
    let best = null, bv = 0;
    near(f, u.x, u.z, ab.convert.range, o => { if (o.side !== u.side && !o.boss && o.def.v <= ab.convert.maxValue * sc && o.def.v > bv) { bv = o.def.v; best = o; } });
    if (best) { best.side = u.side; best.owner = u.owner; best.tgt = null; best.retT = 0; f.evs.push({ k: 'convert', x: u.x, z: u.z, x2: best.x, z2: best.z, s: ++f.evSeq }); }
    else u.abT.convert = 2;
  }
  if (ab.raise && due(u, 'raise', ab.raise.every, dt)) {
    let n = 0;
    for (let i = f.corpses.length - 1; i >= 0 && n < ab.raise.n; i--) {
      const c = f.corpses[i];
      if ((c.x - u.x) ** 2 + (c.z - u.z) ** 2 > ab.raise.r ** 2) continue;
      f.corpses.splice(i, 1); n++;
      const s = g.spawn(f, UNIT_BY_ID.get('skeleton'), u.side, c.x, c.z, u.owner); s.vScale = 0.5;
      f.evs.push({ k: 'raise', x: c.x, z: c.z, s: ++f.evSeq });
    }
  }
  if (ab.summon && due(u, 'summon', ab.summon.every, dt)) {
    // Amon calls corrupted versions of the heroes' own units
    const pool = UNITS.filter(x => x.tier >= 2 && x.tier <= 5);
    let left = ab.summon.value * sc;
    while (left > 0) {
      const d = corrupted(pool[(Math.random() * pool.length) | 0]);
      const c = g.spawn(f, d, u.side, u.x + (Math.random() - 0.5) * 8, u.z + (Math.random() - 0.5) * 8, u.owner);
      c.vScale = 0.5; left -= d.v;
    }
    f.evs.push({ k: 'summon', x: u.x, z: u.z, s: ++f.evSeq });
  }
}
