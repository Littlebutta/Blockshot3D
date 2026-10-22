// v1.2.30: using more than one CPU core. A browser page runs its scripts on one thread; extra threads are web workers.
// threadCount() is how many threads the game may use in all (Settings > Game > CPU threads; Auto = this PC's logical
// cores). WorkerPool spreads jobs over workers running one script. With 1 thread (or no workers) callers run inline.
// Works in the page and inside a worker (a worker can start workers of its own).
export const MAX_THREADS = 16;
export function coreCount() { const n = typeof navigator !== 'undefined' && navigator.hardwareConcurrency; return n > 0 ? Math.min(64, n | 0) : 1; }
export function threadCount(setting) {   // setting: 0 / 'auto' / undefined = every core
  const n = +setting > 0 ? +setting | 0 : coreCount();
  return typeof Worker === 'undefined' ? 1 : Math.max(1, Math.min(MAX_THREADS, n));
}

export class WorkerPool {
  // url: a module worker script; n: how many workers (0 = none: run() always rejects, callers go inline)
  constructor(url, n) {
    this.workers = []; this.seq = 0; this.wait = new Map();
    for (let i = 0; i < n; i++) {
      let w;
      try { w = new Worker(url, { type: 'module' }); } catch { break; }
      const slot = { w, busy: 0 };
      w.onmessage = e => { const m = e.data, cb = this.wait.get(m.id); if (!cb) return; this.wait.delete(m.id); slot.busy--; cb.ok(m); };
      w.onerror = e => { this.failed = (e && e.message) || 'worker error'; for (const [id, cb] of this.wait) if (cb.slot === slot) { this.wait.delete(id); cb.no(new Error(this.failed)); } slot.busy = 0; slot.dead = true; };
      this.workers.push(slot);
    }
  }
  get size() { return this.workers.filter(s => !s.dead).length; }
  get busy() { let b = 0; for (const s of this.workers) b += s.busy; return b; }
  // the same message to every worker (shared data); messages to one worker arrive in order, so jobs sent after it see it
  broadcast(msg) { for (const s of this.workers) if (!s.dead) s.w.postMessage(msg); }
  // one job to the least busy worker; resolves with the worker's answer ({ id, ... })
  run(msg, transfer) {
    let best = null; for (const s of this.workers) if (!s.dead && (!best || s.busy < best.busy)) best = s;
    if (!best) return Promise.reject(new Error('no workers'));
    const id = ++this.seq; best.busy++;
    return new Promise((ok, no) => { this.wait.set(id, { ok, no, slot: best }); best.w.postMessage({ ...msg, id }, transfer || []); });
  }
  close() { for (const s of this.workers) s.w.terminate(); this.workers = []; for (const cb of this.wait.values()) cb.no(new Error('closed')); this.wait.clear(); }
}
