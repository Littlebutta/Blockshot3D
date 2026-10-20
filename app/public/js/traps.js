// v1.2.15 trap arenas (levelgen.js TRAP_MAPS): spike floors, laser fences and sweeping lasers that cycle on a timer.
// Each trap's state is a pure function of the sim clock, so the host (sim.js updateTraps) and the renderer (the
// snapshot's 'tp' clock) always agree. Crushers are moving solids instead (kind 'crusher' dynamics, sim.js).
export const TRAP = {
  warn: 0.8,                        // seconds of warning flicker before a spike floor or fence turns on
  spikeDmg: 28, spikeHeight: 0.25,  // standing on the floor (feet below this) when the spikes are up
  fenceDmg: 34, fenceH: 2.3,
  sweepDmg: 22, sweepY: 0.55,       // low beam: jump over it
  crushDmg: 65,
  crusher: { warn: 0.7, fall: 0.18, down: 0.55, rise: 0.6 },   // the rest of each period it waits at the top
  // v1.2.22 (Devin) pinch pistons: two horizontal jaws that slam together; whoever is caught between them dies
  pinch: { warn: 0.8, close: 0.28, shut: 0.45, open: 0.9 },
};

// v1.2.22 pinch jaws: how far closed (0 open, 1 shut) at time T, and the stage: 0 open, 1 warning, 2 closing, 3 shut, 4 opening.
export function pinchAt(d, T) {
  const C = TRAP.pinch, P = d.period, u = (((T + d.phase) % P) + P) % P;
  const wS = P - C.warn - C.close - C.shut - C.open, cS = wS + C.warn, sS = cS + C.close, oS = sS + C.shut;
  if (u < wS) return { k: 0, st: 0 };
  if (u < cS) return { k: 0.03 * (0.5 + 0.5 * Math.sin(u * 60)), st: 1 };
  if (u < sS) { const k = (u - cS) / C.close; return { k: k * k, st: 2 }; }
  if (u < oS) return { k: 1, st: 3 };
  const k = (u - oS) / C.open; return { k: 1 - k * k * (3 - 2 * k), st: 4 };
}
// Where a jaw's center sits along its axis for a closed fraction k
export function pinchPos(d, k) { return d.c + d.side * (d.len / 2 + d.gap * (1 - k)); }

// 0 off, 1 warning, 2 on; sweeps are always on and also return where the beam is.
export function trapState(tr, T) {
  const P = tr.period, u = (((T + tr.off) % P) + P) % P;
  if (tr.kind === 'sweep') return { s: 2, pos: tr.a + (tr.b - tr.a) * (0.5 - 0.5 * Math.cos(2 * Math.PI * u / P)) };
  const left = P - u;
  return { s: left <= tr.on ? 2 : left <= tr.on + TRAP.warn ? 1 : 0, k: left <= tr.on ? 1 - left / tr.on : 0 };
}

// Crusher height above the floor (its bottom face) at time T, and its stage: 0 waiting, 1 warning, 2 falling, 3 down, 4 rising.
export function crusherAt(d, T) {
  const C = TRAP.crusher, P = d.period, u = (((T + d.phase) % P) + P) % P;
  const wS = P - C.warn - C.fall - C.down - C.rise, fS = wS + C.warn, dS = fS + C.fall, rS = dS + C.down;
  if (u < wS) return { y: d.top, st: 0 };
  if (u < fS) return { y: d.top + Math.sin(u * 70) * 0.05, st: 1 };
  if (u < dS) { const k = (u - fS) / C.fall; return { y: d.top * (1 - k * k), st: 2 }; }
  if (u < rS) return { y: 0, st: 3 };
  const k = (u - rS) / C.rise; return { y: d.top * k * k * (3 - 2 * k), st: 4 };
}

// Distance from (x, z) to the segment a-b.
export function segDist(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
  const k = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
  return Math.hypot(x - ax - vx * k, z - az - vz * k);
}
