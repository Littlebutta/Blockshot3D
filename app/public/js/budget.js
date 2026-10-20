// v1.2.25 entity / bullet budget (Devin): keeps big lobbies playable (at least ~10 fps) by capping how many shots can be
// in the air at once. It never removes a shot that is already flying: when the cap is near, the players (and their
// turrets / clones / critters) with the most shots out are stopped from firing new ones first, until some of theirs land.
// The cap adapts: it shrinks while the host's sim step runs long or anyone's frame rate drops, and grows back when it's fine.
// Lobby setting settings.budget (Arena settings), on unless turned off.
export const BUDGET = {
  cap0: 700, capMin: 120, capMax: 1600,   // shots in the air
  msSlow: 14, msGood: 8,                  // host sim step (ms) that counts as too slow / comfortable (a step every 16.7 ms)
  fpsSlow: 20, fpsGood: 40,               // frame rate (host, or the slowest player that reports one); 20 keeps a margin over 10
  perHead: 3,                             // the cap never goes below this many shots per player
  every: 0.5, down: 0.85, up: 1.08,       // how often and how hard the cap moves
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
  return g.bud || (g.bud = { cap: BUDGET.cap0, total: 0, share: Infinity, counts: new Map(), acc: 0, n: 0, t: 0, ms: 0, fps: 0 });
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
    const slow = ms > BUDGET.msSlow || (fps > 0 && fps < BUDGET.fpsSlow), good = ms < BUDGET.msGood && (!fps || fps >= BUDGET.fpsGood);
    let heads = 0; for (const p of g.players) if (p.kind === 'hero' && p.alive) heads++;
    const floor = Math.max(BUDGET.capMin, BUDGET.perHead * heads);
    if (slow) B.cap = Math.max(floor, Math.floor(Math.min(B.cap, Math.max(B.total, floor)) * BUDGET.down));
    else if (good && B.total > B.cap * 0.6) B.cap = Math.min(BUDGET.capMax, Math.ceil(B.cap * BUDGET.up));
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

// Extra shots made by a shot (bounce splits, shrapnel): skipped only once the whole cap is used up.
export const budgetRoom = g => !g.bud || g.bud.total < g.bud.cap;

// Snapshot row: [total, cap, share (0 = no limit), then id, count pairs while there is a limit]
export function budgetRow(g) {
  const B = g.bud;
  if (!B) return null;
  const row = [B.total, B.cap, B.share === Infinity ? 0 : B.share];
  if (B.share !== Infinity) for (const [id, c] of B.counts) row.push(id, c);
  return row;
}
// Client side: { total, cap, share, mine } from a snapshot row
export function budgetView(row, id) {
  if (!row) return null;
  let mine = 0;
  for (let i = 3; i < row.length; i += 2) if (row[i] === id) { mine = row[i + 1]; break; }
  return { total: row[0], cap: row[1], share: row[2], mine };
}
