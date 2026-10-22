// v1.2.25 entity / bullet budget (Devin): keeps big lobbies playable by limiting how many shots can be in the air at once.
// It never removes a shot that is already flying: when the limit is near, the players (and their turrets / clones /
// critters) with the most shots out are stopped from firing new ones first, until some of theirs land.
// v1.2.27 (Devin): no fixed cap. There is no limit at all while everyone runs at 30+ fps. Only when the host's sim or
// anyone's frame rate drops under 30 does a cap appear (at the current shot count, then lower while it stays slow); it
// grows back while things are smooth and goes away again after a few smooth seconds.
// Lobby setting settings.budget (Arena settings), on unless turned off.
export const BUDGET = {
  fpsTarget: 30, fpsGood: 36,             // frame rate (host, or the slowest player that reports one) to hold / that counts as smooth
  msSlow: 22, msGood: 12,                 // host sim step (ms) that counts as too slow / comfortable
  capMin: 40, perHead: 1.5,               // a cap never goes below either of these (shots, shots per player; v1.2.28: was 60 and 3, which kept 300 shots at 100 players)
  every: 0.25, down: 0.88, up: 1.06,      // how often and how hard the cap moves (v1.2.31: twice as often; under 30 fps
                                          // it drops in step with the frame rate)
  downMin: 0.6,                           // the most one step can take off (v1.2.32: was 0.4)
  slowFor: 2, panicFps: 20,               // v1.2.32: slow two checks in a row (half a second) before it cuts, unless under panicFps
  release: 6,                             // seconds of smooth play with room to spare before the cap is dropped again
  press: 0.75,                            // above this share of the cap, per-player limits start
  minShare: 3,                            // nobody is ever limited below this many shots
  notice: 1.2,                            // seconds the "can't shoot" notice stays after a blocked shot
};

export const budgetOn = g => !!g && g.settings.budget !== false;

// The player a shot counts against: turrets, clones, critters and summons count for whoever owns them.
export function budgetOwner(g, p) {
  let r = p, n = 0;
  while (r && r.ownerId && n++ < 4) { const o = g.player(r.ownerId); if (!o) break; r = o; }
  return r || p;
}

function state(g) {
  return g.bud || (g.bud = { cap: Infinity, total: 0, goodT: 0, share: Infinity, counts: new Map(), acc: 0, n: 0, t: 0, ms: 0, fps: 0 });
}

// Once per sim step (end of step): recount shots per owner and, every BUDGET.every s, move the cap.
export function budgetTick(g, dt, stepMs) {
  if (!budgetOn(g)) { g.bud = null; return; }
  const B = state(g);
  B.acc += stepMs; B.n++; B.t += dt;
  if (B.t >= BUDGET.every) {
    const ms = B.acc / Math.max(1, B.n);
    let fps = g.hostFps || 0;
    for (const p of g.players) if (p.kind === 'hero' && p.connected && !p.isBot && p.fps > 0 && (!fps || p.fps < fps)) fps = p.fps;
    B.ms = ms; B.fps = fps;
    const slow = ms > BUDGET.msSlow || (fps > 0 && fps < BUDGET.fpsTarget), good = ms < BUDGET.msGood && (!fps || fps >= BUDGET.fpsGood);
    let heads = 0; for (const p of g.players) if (p.kind === 'hero' && p.alive) heads++;
    const floor = Math.max(BUDGET.capMin, BUDGET.perHead * heads);
    // v1.2.31 (Devin: frames dropped to 0 before the budget caught up): the cut matches how slow it is
    const k = fps > 0 && fps < BUDGET.fpsTarget ? Math.max(BUDGET.downMin, Math.min(BUDGET.down, fps / BUDGET.fpsTarget)) : BUDGET.down;
    B.slowN = slow ? (B.slowN || 0) + 1 : 0;
    B.slow = slow && (B.slowN >= BUDGET.slowFor || (fps > 0 && fps < BUDGET.panicFps));
    if (B.slow) { B.goodT = 0; B.cap = Math.max(floor, Math.floor(Math.min(B.cap, Math.max(B.total, floor)) * k)); }
    else if (!slow && good && B.cap !== Infinity) {
      if (B.total > B.cap * 0.6) B.cap = Math.ceil(B.cap * BUDGET.up);
      B.goodT += B.t;
      if (B.goodT >= BUDGET.release && B.total < B.cap * 0.8) B.cap = Infinity;   // smooth for a while: no limit again
    } else B.goodT = 0;
    B.acc = 0; B.n = 0; B.t = 0;
  }
  B.counts.clear();
  let total = 0;
  for (const b of g.bullets) {
    if (!b.alive || b.beam) continue;
    total++;
    if (b._boR !== b.ownerRef) { b._boR = b.ownerRef; b._bo = b.ownerRef ? budgetOwner(g, b.ownerRef) : null; }   // (a blocked shot changes hands)
    const o = b._bo;
    if (o) B.counts.set(o.id, (B.counts.get(o.id) || 0) + 1);
  }
  B.total = total;
  B.share = shareOf(B);
}

function shareOf(B) {
  if (B.total < B.cap * BUDGET.press) return Infinity;
  const owners = Math.max(1, B.counts.size);
  let share = Math.max(BUDGET.minShare, Math.floor(B.cap / owners));
  if (B.total >= B.cap) share = Math.max(BUDGET.minShare, Math.floor(share * 0.6));   // over the cap: squeeze the heaviest harder
  return share;
}

// May p fire a new shot right now? (false also starts the "can't shoot" notice for its owner)
export function budgetAllow(g, p) {
  if (!budgetOn(g) || !g.bud) return true;
  const B = g.bud;
  if (B.share === Infinity) return true;
  const o = budgetOwner(g, p), c = B.counts.get(o.id) || 0;
  if (c < B.share) return true;
  if (!((o.fx.budT || 0) > g.time)) g.emit({ t: 'budBlock', p: o.id });
  o.fx.budT = g.time + BUDGET.notice;
  return false;
}

// A shot was added (keeps the counts right within a step, so one burst can't blow past the limit)
export function budgetAdd(g, p) {
  const B = g.bud;
  if (!B || !p) return;
  const o = budgetOwner(g, p);
  B.counts.set(o.id, (B.counts.get(o.id) || 0) + 1); B.total++;
  if (B.share === Infinity && B.total >= B.cap * BUDGET.press) B.share = shareOf(B);
}

// v1.2.31: while the match runs slow, cards don't add new critters or afterimages (shots aren't all that slows a big fight)
export const budgetSummon = g => !g.bud || !g.bud.slow;

// Extra shots made by a shot (bounce splits, shrapnel): skipped only once the whole cap is used up.
export const budgetRoom = g => !g.bud || g.bud.total < g.bud.cap;

// Snapshot row: [total, cap (0 = no cap), share (0 = no limit), then id, count pairs while there is a limit]
export function budgetRow(g) {
  const B = g.bud;
  if (!B) return null;
  const row = [B.total, B.cap === Infinity ? 0 : B.cap, B.share === Infinity ? 0 : B.share];
  if (B.share !== Infinity) for (const [id, c] of B.counts) row.push(id, c);
  return row;
}
// Client side: { total, cap (0 = no cap), share, mine } from a snapshot row
export function budgetView(row, id) {
  if (!row) return null;
  let mine = 0;
  for (let i = 3; i < row.length; i += 2) if (row[i] === id) { mine = row[i + 1]; break; }
  return { total: row[0], cap: row[1], share: row[2], mine };
}

// v1.2.27 lobby estimate (right-click on the Shot budget switch): roughly how many shots and entities a match with this
// many players puts in play. From bot matches (normal bots, 4-20 players, up to ~30 rounds): early rounds average ~1 shot
// in the air per player with fights peaking near 4; once fire-rate / multi-shot cards stack up, ~5 per player with peaks
// near 15. Entities = players plus turrets, clones, critters and summons (and the raiders in co-op).
export function budgetEstimate(n, mode) {
  n = Math.max(1, n | 0);
  const co = mode === 'waves' || mode === 'core';
  return {
    n, early: n, earlyPeak: n * 4, late: n * 5, latePeak: n * 15,
    ents: co ? Math.round(n * 2 + 6) : n, entsLate: co ? Math.round(n * 3.5 + 8) : Math.round(n * 1.8),
  };
}
