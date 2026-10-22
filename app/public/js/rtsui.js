// =====================================================================
// RTS mode (v1.2.27): the client. The 3D world (terrain, fog of war, instanced units and buildings, effects),
// the camera, mouse and keyboard controls, and the network glue. The HUD (minimap, selection, command card,
// research, end screen) is in rtshud.js. The host also runs RtsGame (rts.js) through this.
//
// Mouse lock: the real cursor is captured (pointer lock) and a drawn cursor takes its place, held inside the window like
// a fullscreen game, so pushing against the screen edge always pans the camera (v1.2.28: windowed too, not only F11).
// =====================================================================
import * as THREE from '/vendor/three/build/three.module.js';
import { RTS, UNITS, BUILDINGS } from './rtsdata.js';
import { generateRtsMap, CELL, cellOf, stampVision, resCells } from './rtsmap.js';
import { TYPE_LIST, mapChecksum } from './rts.js';
import { AckDecoder } from './netcodec.js';
import { FOW, makeFow, fowMat, UNIT_LOOK, BUILD_LOOK, UNIT_AIR_H, bakeParts, Inst, buildTerrain, buildDoodads, makeSurface } from './rtsart.js';
import { HUD } from './rtshud.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const angLerp = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; };
const PITCH = 0.98;          // camera tilt (radians below horizontal)
const SKY = '#9cc0dc';

export class RtsClient {
  constructor(ctx) {
    Object.assign(this, ctx);   // renderer, localId, isHost, game, net, send, toast, banner, sound, toLobby, keys, settings, rttOf
    window.rtsClient = this;    // handle for the browser test scripts
    this.pub = null; this.M = null; this.ents = new Map(); this.sel = []; this.groups = Array.from({ length: 10 }, () => []);
    this.res = new Map(); this.der = []; this.towersSt = []; this.flares = []; this.my = { sc: [0, 0, 0, 0, 0, 0, 0, 0], bo: {}, co: { hand: [], off: null, ups: {}, pulls: 0 }, sw: [0, 0, 0, 0] };
    this.tm = 0; this.tmAt = performance.now(); this.snapI = 1 / 15; this.lastSnapAt = 0;
    this.cam = { x: 0, z: 0, h: 30, gy: 0 }; this.mode = null; this.mx = innerWidth / 2; this.my2 = innerHeight / 2;
    this.peerSeq = new Map(); this.sendT = 0; this.pubT = 0; this.fpsT = 0; this.sfxT = {};
    this.fx = []; this.marks = []; this.alerts = []; this.lastAlert = null;
    const R = this.renderer;
    this.saved = { bg: R.scene.background, fog: R.scene.fog, lg: R.levelGroup, far: R.camera.far, near: R.camera.near, sunPos: R.sun.position.clone(), sunT: R.sun.target.position.clone(), sh: { ...R.sun.shadow.camera }, hemi: R.hemi.intensity, sun: R.sun.intensity, fov: R.camera.fov };
    if (R.levelGroup) R.levelGroup.visible = false;
    if (R.marker) R.marker.visible = false;
    if (R.skyMarker) R.skyMarker.visible = false;
    this.root = new THREE.Group(); R.scene.add(this.root);
    R.camera.far = 900; R.camera.near = 0.5; R.camera.fov = 50; R.camera.updateProjectionMatrix();
    R.scene.background = new THREE.Color(SKY); R.scene.fog = new THREE.Fog(SKY, 260, 620);
    this.hud = new HUD(this);
    this.bindInput();
    // v1.2.30: the host's game runs through a driver (rtshost.js): on its own thread when the PC has cores to spare
    if (this.isHost && this.game) this.game.start(this.localId, {
      pub: s => { if (!this.disposed) this.applyPub(s); },
      view: (v, ev) => { if (this.disposed) return; this.tm = v.tm; this.tmAt = performance.now(); this.applyView(v, ev, RTS.tick); },
      send: m => { if (this.net && !this.disposed) this.net.send(m); },
    }, this.net);
  }
  dispose() {
    this.disposed = true;
    this.unbindInput();
    this.hud.dispose();
    const R = this.renderer;
    R.scene.remove(this.root);
    this.root.traverse(o => { if (o.geometry && !o.geometry.shared) o.geometry.dispose(); });
    R.scene.background = this.saved.bg; R.scene.fog = this.saved.fog;
    if (this.saved.lg) this.saved.lg.visible = true;
    R.camera.far = this.saved.far; R.camera.near = this.saved.near; R.camera.fov = this.saved.fov; R.camera.updateProjectionMatrix();
    R.sun.position.copy(this.saved.sunPos); R.sun.target.position.copy(this.saved.sunT);
    Object.assign(R.sun.shadow.camera, { left: this.saved.sh.left, right: this.saved.sh.right, top: this.saved.sh.top, bottom: this.saved.sh.bottom, near: this.saved.sh.near, far: this.saved.sh.far }); R.sun.shadow.camera.updateProjectionMatrix();
    R.hemi.intensity = this.saved.hemi; R.sun.intensity = this.saved.sun;
    if (document.pointerLockElement === R.canvas) document.exitPointerLock();
    if (window.rtsClient === this) window.rtsClient = null;
  }
  hideLevel() { if (this.renderer.levelGroup) this.renderer.levelGroup.visible = false; }
  act(a) { if (this.isHost) this.game.action(this.localId, a); else this.send(a); }
  me() { return this.pub ? this.pub.pl.find(p => p.id === this.localId) : null; }
  myIdx() { const m = this.me(); return m ? m.idx : -1; }
  myTeam() { const m = this.me(); return m ? m.team : null; }
  spectating() { const m = this.me(); return !m || m.out || m.spec; }
  plOf(idx) { return this.pub ? this.pub.pl.find(p => p.idx === idx) : null; }
  isMine(e) { return e && e.own === this.myIdx() && !this.spectating(); }
  isAlly(e) { const p = e && this.plOf(e.own); return !!p && p.team === this.myTeam(); }
  gameTime() { return this.tm / 1000 + (performance.now() - this.tmAt) / 1000; }

  // ---------------------------------------------------------------- frame
  frame(dt, paused, simDt = dt) {
    if (this.isHost) this.hostTick(Math.min(0.25, simDt), paused);
    if (this.locked() && !this.wantLock()) document.exitPointerLock();   // a menu opened or the window lost focus
    if (!this.M) { this.renderer.updateFx(dt); return; }
    this.fpsTick(dt);
    this.updateCamera(dt);
    this.updateEnts(dt);
    this.updateVision(dt);
    this.drawWorld(dt);
    this.updateFx(dt);
    this.renderer.updateFx(dt);
    this.hud.frame(dt);
  }
  fpsTick(dt) {
    this.fpsAcc = (this.fpsAcc || 0) + 1; this.fpsT += dt;
    if (this.fpsT >= 2) { const fps = document.hidden ? 0 : this.fpsAcc / this.fpsT; this.fps = fps; this.fpsAcc = 0; this.fpsT = 0; if (!this.isHost && this.net) this.sendU({ t: 'fps', v: Math.round(fps) }); }
  }
  hostTick(dt, paused) {
    const rtt = {};
    if (this.net && this.rttOf && this.pub) for (const p of this.pub.pl) if (p.id !== this.localId && !p.bot) rtt[p.id] = this.rttOf(p.id);
    const backlog = this.net && typeof this.net.backlog === 'function' ? this.net.backlog() : 0;
    this.game.frame(dt, paused, { rtt, backlog, fps: this.fps || 0 });
  }
  sendU(a) { if (this.net && !this.isHost) this.net.send({ t: 'toHostU', msg: { k: 'rts', a } }); }
  onMsg(msg) {
    if (msg.k === 'rpub') this.applyPub(msg.s);
    else if (msg.k === 'rsnap' && msg.s) this.takeSnap(msg.s);
    else if (msg.k === 'rmap' && msg.m) this.takeMap(msg.m);
  }
  takeSnap(m) {
    if (!this.M) { this.pendSnap = m; return; }
    const d = this.dec ||= new AckDecoder();
    const s = d.decode(m);
    if (!s) { const now = performance.now(); if (now - (this.nkT || 0) > 300) { this.nkT = now; this.sendU({ t: 'ack', a: null }); } return; }
    const now = performance.now();
    if (this.lastSnapAt) this.snapI = clamp(this.snapI * 0.85 + (now - this.lastSnapAt) / 1000 * 0.15, 1 / 30, 0.4);
    this.lastSnapAt = now;
    if (s.tm > this.tm) { this.tm = s.tm; this.tmAt = now; }
    this.applyView(s, s.ev || [], this.snapI);
    this.sendU({ t: 'ack', a: d.ack() });
  }
  takeMap(m) {
    const un = (b, T) => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new T(u.buffer); };
    const M = { ...m, lv: un(m.lv, Int8Array), h: un(m.h, Float32Array), walk: un(m.walk, Uint8Array), ramp: un(m.ramp, Uint8Array) };
    this.setupWorld(M);
  }

  // ---------------------------------------------------------------- state in
  applyPub(s) {
    const prev = this.pub; this.pub = s;
    if (!this.M) {
      const M = this.isHost && this.game ? this.game.M : generateRtsMap(s.n, s.seed, s.size);
      if (!this.isHost && mapChecksum(M) !== s.sum) { this.sendU({ t: 'ack', need: 1 }); this.net && this.net.send({ t: 'toHost', msg: { k: 'rts', a: { t: 'ack', need: 1 } } }); }
      else this.setupWorld(M);
    }
    if (prev && prev.ph !== 'over' && s.ph === 'over') this.hud.showOver();
    this.hud.dirty = true;
  }
  setupWorld(M) {
    if (this.M) return;
    this.M = M; this.SF = makeSurface(M);
    makeFow(M);
    this.vis = new Uint8Array(M.N * M.N); this.explored = new Uint8Array(M.N * M.N); this.fowCur = new Float32Array(M.N * M.N).fill(18);
    // v1.2.28 (Devin): every base spot (its crystal line and vents) starts out as explored ground, so the places to
    // expand to show through the fog (dimmed, like ground you've seen) on the field and the minimap from the start
    for (const b of M.bases) {
      const R = 15, c0x = Math.floor((b.x - R + M.H) / CELL), c1x = Math.floor((b.x + R + M.H) / CELL), c0z = Math.floor((b.z - R + M.H) / CELL), c1z = Math.floor((b.z + R + M.H) / CELL);
      for (let cz = Math.max(0, c0z); cz <= Math.min(M.N - 1, c1z); cz++) for (let cx = Math.max(0, c0x); cx <= Math.min(M.N - 1, c1x); cx++) {
        if (Math.hypot(cx * CELL - M.H + CELL / 2 - b.x, cz * CELL - M.H + CELL / 2 - b.z) <= R) this.explored[cz * M.N + cx] = 1;
      }
    }
    for (const r of M.res) this.res.set(r.id, { ...r, seen: false });
    this.der = M.derricks.map(d => ({ ...d, own: -2, cap: 0, capPct: 0 }));
    this.terrain = buildTerrain(M, M.bases, this.SF); this.root.add(this.terrain);
    this.doodads = buildDoodads(M, this.root);
    this.buildStatic();
    this.buildDynamic();
    // the camera starts over your Command Hub
    const me = this.me(), s = me && !me.spec ? M.starts[me.idx] : null;
    if (s) { this.cam.x = s.x; this.cam.z = s.z + 6; } else { this.cam.x = 0; this.cam.z = 0; this.cam.h = 70; }
    const R = this.renderer; R.hemi.intensity = this.saved.hemi * 0.95; R.sun.intensity = this.saved.sun * 1.25;
    this.hud.setupMinimap();
    if (this.pendSnap) { const m = this.pendSnap; this.pendSnap = null; this.takeSnap(m); }
  }
  // crystal fields, flux vents, derricks and watchtowers
  buildStatic() {
    const M = this.M, root = this.root;
    const cMat = fowMat(new THREE.MeshLambertMaterial({ color: '#4ac8ff', emissive: '#1a5a90', emissiveIntensity: 0.9 }));
    const cGeo = new THREE.OctahedronGeometry(0.5, 0); cGeo.scale(0.8, 1.6, 0.8);
    this.crystalI = new Inst(root, cGeo, cMat, Math.max(8, M.res.length * 3));
    const vMat = fowMat(new THREE.MeshLambertMaterial({ color: '#4a5048' })), gMat = fowMat(new THREE.MeshBasicMaterial({ color: '#5aff9a' }));
    this.vents = new Map();
    for (const r of M.res) {
      if (r.k !== 'f') continue;
      const g = new THREE.Group(), y = this.SF.y(r.x, r.z);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 0.6, 10), vMat); ring.position.y = 0.3; g.add(ring);
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.64, 10), gMat); glow.position.y = 0.32; g.add(glow);
      g.position.set(r.x, y, r.z); root.add(g); this.vents.set(r.id, g);
    }
    // derricks: a blocky pump jack whose flag shows the owner's color
    const dBase = fowMat(new THREE.MeshLambertMaterial({ color: '#6a5a48' })), dArm = fowMat(new THREE.MeshLambertMaterial({ color: '#3a3a40' }));
    this.derG = new Map();
    for (const d of M.derricks) {
      const g = new THREE.Group(), y = this.SF.y(d.x, d.z);
      const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 2.4), dBase); base.position.y = 0.25; g.add(base);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.2, 0.4), dArm); post.position.y = 1.5; g.add(post);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 0.3), dArm); arm.position.y = 2.6; g.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), dArm); head.position.set(1.4, 2.3, 0); arm.add(head); head.position.set(1.4, -0.3, 0);
      const flagMat = new THREE.MeshBasicMaterial({ color: '#cccccc' }), flag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.9), flagMat); flag.position.set(-1.0, 3.2, 0); g.add(flag);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.4, 0.08), dArm); pole.position.set(-1.0, 2.7, -0.45); g.add(pole);
      const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false }), ring = new THREE.Mesh(new THREE.RingGeometry(RTS.towerReach - 0.15, RTS.towerReach, 40).rotateX(-Math.PI / 2), ringMat); ring.position.y = 0.12; g.add(ring);
      g.position.set(d.x, y, d.z); root.add(g);
      this.derG.set(d.id, { g, arm, flagMat, ringMat });
    }
    const tMat = fowMat(new THREE.MeshLambertMaterial({ color: '#8a8478' }));
    this.towG = M.towers.map(t => {
      const g = new THREE.Group(), y = this.SF.y(t.x, t.z);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.1, 5, 6), tMat); p.position.y = 2.5; g.add(p);
      const eyeMat = new THREE.MeshBasicMaterial({ color: '#888888' }), eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), eyeMat); eye.position.y = 5.8; g.add(eye);
      const ring = new THREE.Mesh(new THREE.RingGeometry(RTS.towerReach - 0.15, RTS.towerReach, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false })); ring.position.y = 0.12; g.add(ring);
      g.position.set(t.x, y, t.z); root.add(g);
      return { g, eye, eyeMat };
    });
  }
  // instanced meshes for every unit / building type, selection rings, health bars, tracers, markers
  buildDynamic() {
    const root = this.root;
    this.mat = fowMat(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.kinds = new Map();
    for (const [type, L] of Object.entries(UNIT_LOOK)) { const g = bakeParts(L.parts, L.s); this.kinds.set(type, Object.fromEntries(Object.entries(g).map(([k, ge]) => [k, new Inst(root, ge, this.mat, 16)]))); }
    for (const [type, parts] of Object.entries(BUILD_LOOK)) { const g = bakeParts(parts); this.kinds.set(type, Object.fromEntries(Object.entries(g).map(([k, ge]) => [k, new Inst(root, ge, this.mat, 8)]))); }
    const ringGeo = new THREE.RingGeometry(0.86, 1, 32).rotateX(-Math.PI / 2);
    this.ringI = new Inst(root, ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }), 64, false);
    const barGeo = new THREE.PlaneGeometry(1, 1);
    const barMat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, depthWrite: false });
    this.barBg = new Inst(root, barGeo, barMat('#000000', 0.6), 64, false); this.barFg = new Inst(root, barGeo, barMat('#ffffff', 0.95), 64, false);
    this.barBg.mesh.renderOrder = 20; this.barFg.mesh.renderOrder = 21;
    this.tracerI = new Inst(root, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), 64, false);
    this.shellI = new Inst(root, new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), 16, false);
    this.markI = new Inst(root, new THREE.RingGeometry(0.7, 1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }), 16, false);
    this.cellI = new Inst(root, new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, depthWrite: false }), 16, false);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: '#7fff9a', transparent: true, opacity: 0.45, depthWrite: false });
    this.ghost = new THREE.Group(); this.ghost.visible = false; root.add(this.ghost);
    this.rallyLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: '#7fff9a', dashSize: 0.8, gapSize: 0.5, transparent: true, opacity: 0.8 }));
    this.rallyLine.visible = false; this.rallyLine.frustumCulled = false; root.add(this.rallyLine);
    this.flagMesh = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 6), new THREE.MeshBasicMaterial({ color: '#7fff9a' })); this.flagMesh.visible = false; root.add(this.flagMesh);
  }
  // one update of what you see (rows from RtsGame.viewFor)
  applyView(s, evs, interval) {
    if (!this.M) return;
    const now = performance.now(), seen = new Set(), died = new Set();
    for (const e of evs) if (e.t === 'die') died.add(e.id);
    const R = TYPE_LIST;
    const take = (row, kind) => {
      const [id, ti, own, x, z] = row;
      let e = this.ents.get(id);
      const type = R[ti];
      if (!e || e.type !== type) {
        e = { id, kind, type, def: kind === 'u' ? UNITS[type] : BUILDINGS[type], own, x, z, px: x, pz: z, tx: x, tz: z, t0: now, I: interval, face: kind === 'u' ? row[5] : 0, tface: kind === 'u' ? row[5] : 0, pface: 0, anim: Math.random() * 10, born: now };
        this.ents.set(id, e);
      }
      e.own = own; e.ghost = false; e.lastSeen = now;
      if (Math.hypot(x - e.tx, z - e.tz) > 8) { e.x = e.px = x; e.z = e.pz = z; }
      else { e.px = e.x; e.pz = e.z; }
      e.tx = x; e.tz = z; e.t0 = now; e.I = interval * 1.05;
      if (kind === 'u') { e.pface = e.face; e.tface = row[5]; e.hp = row[6]; e.maxHp = row[7]; e.fl = row[8]; e.tgt = row[9]; }
      else { e.hp = row[5]; e.maxHp = row[6]; e.prog = row[7]; e.fl = row[8]; e.tgt = row[9]; e.half = e.def.s * CELL / 2; }
      seen.add(id);
    };
    for (const r of s.ob || []) take(r, 'u');
    for (const r of s.bc || []) take(r, 'b');
    if (!s.partial) for (const [id, e] of this.ents) {
      if (seen.has(id)) continue;
      if (died.has(id)) { this.ents.delete(id); continue; }
      if (e.kind === 'b') { // went out of sight: remembered where you last saw it (StarCraft's building snapshots)
        if (this.visAt(e.x, e.z)) this.ents.delete(id); else e.ghost = true;
      } else this.ents.delete(id);
    }
    for (const [id, amt] of s.mn || []) { const r = this.res.get(id); if (r) { r.amt = amt; r.seen = true; } }
    if (s.sc) this.my.sc = s.sc; if (s.bo) this.my.bo = s.bo; if (s.co) this.my.co = s.co; if (s.sw) this.my.sw = s.sw;
    if (s.tg) for (const [id, own, cap, pct] of s.tg) { const d = this.der.find(q => q.id === id); if (d && own !== -2) { d.own = own; d.cap = cap; d.capPct = pct; } }
    if (s.rt) this.towersSt = s.rt;
    for (const e of evs) this.event(e);
    this.sel = this.sel.filter(id => this.ents.has(id) && !this.ents.get(id).ghost);
    this.hud.dirty = true;
  }
  event(e) {
    const ent = id => this.ents.get(id);
    switch (e.t) {
      case 'shoot': this.shotFx(e); break;
      case 'splash': this.boom(e.x, e.z, e.r); break;
      case 'die': this.deathFx(e); break;
      case 'feral': this.renderer.burst(e.x, this.groundY(e.x, e.z) + 0.6, e.z, '#9aff4a', 10, 4); break;   // (v1.2.32: a Hive unit went feral)
      case 'heal': { const b = ent(e.b); if (b) this.renderer.glowSprite(b.x, this.yOf(b) + 0.8, b.z, '#7fff9a', 0.7, 0.3); break; }
      case 'chain': this.tracer(e.x1, this.groundY(e.x1, e.z1) + 0.8, e.z1, e.x2, this.groundY(e.x2, e.z2) + 0.8, e.z2, '#9ad8ff', 0.12, 'laser'); break;
      case 'meteor': this.meteorFx(e.x, e.z); break;
      case 'flare': this.flares.push({ x: e.x, z: e.z, until: this.gameTime() + e.dur }); this.renderer.glowSprite(e.x, this.groundY(e.x, e.z) + 8, e.z, '#ffd166', 6, 1.4, 2); this.sfx('powerUp', 0.6); break;
      case 'od': { const u = ent(e.id); if (u) this.renderer.glowSprite(u.x, this.yOf(u) + 0.8, u.z, '#ff5a3a', 1, 0.35); this.sfx('powerUp', 0.25, 0.3); break; }
      case 'echo': this.renderer.glowSprite(e.x, this.groundY(e.x, e.z) + 1, e.z, '#c8a8ff', 2, 0.5); break;
      case 'blockHit': { const u = ent(e.id); if (u) this.renderer.glowSprite(u.x, this.yOf(u) + 0.8, u.z, '#8fd0ff', 0.8, 0.2); break; }
      case 'resGone': { this.res.delete(e.id); break; }
      case 'alert': this.hud.alert(e); break;
      case 'built': this.hud.note(`${BUILDINGS[e.type].name} complete.`, 'good'); this.sfx('roundStart', 0.4, 1); break;
      case 'trained': this.sfx('pip', 0.25, 0.4); break;
      case 'placed': this.sfx('block', 0.4, 0.2); break;
      case 'offer': this.hud.openCards(true); this.sfx('cardDeal', 0.7); break;
      case 'fitted': this.hud.note(`${e.name} fitted to your ${UNITS[e.u] ? UNITS[e.u].name : e.u}s.`, 'good'); this.sfx('cardPick', 0.6); break;
      case 'derrick': { const me = this.myIdx(), d = this.der.find(q => q.id === e.id); if (d) { const p = this.pub && this.pub.pl.find(q => q.id === e.o); d.own = p ? p.idx : -1; } break; }
      case 'msg': this.toast(e.text); break;
      case 'elim': { const p = this.pub && this.pub.pl.find(q => q.id === e.p); if (p) this.hud.note(p.id === this.localId ? (e.why === 'surrender' ? 'You surrendered.' : 'You have been defeated.') : `${p.name} has been ${e.why === 'surrender' ? 'surrendered' : 'defeated'}.`, p.id === this.localId ? 'bad' : ''); if (p && p.id === this.localId) this.sfx('defeat', 0.8); break; }
      case 'over': break;
      case 'drop': break;
    }
  }
  sfx(name, vol = 1, gap = 0.06) { const t = performance.now() / 1000; if ((this.sfxT[name] || 0) > t) return; this.sfxT[name] = t + gap; try { this.sound.play(name, vol); } catch { /* audio off */ } }

  // ---------------------------------------------------------------- world drawing
  groundY(x, z) { return this.SF ? this.SF.y(x, z) : 0; }
  yOf(e) { return e.kind === 'u' && e.def.air ? this.groundY(e.x, e.z) + UNIT_AIR_H : this.groundY(e.x, e.z); }
  updateEnts(dt) {
    const now = performance.now();
    for (const e of this.ents.values()) {
      if (e.ghost) continue;
      const k = clamp((now - e.t0) / 1000 / Math.max(0.03, e.I), 0, 1.25);
      e.x = e.px + (e.tx - e.px) * k; e.z = e.pz + (e.tz - e.pz) * k;
      if (e.kind === 'u') { e.face = angLerp(e.face, e.tface, clamp(dt * 14, 0, 1)); e.anim += dt * ((e.fl & 256) ? 9 : 2); }
    }
  }
  drawWorld(dt) {
    const m = this._m || (this._m = new THREE.Matrix4()), q = this._q || (this._q = new THREE.Quaternion()), e3 = this._e || (this._e = new THREE.Euler()), v = this._v || (this._v = new THREE.Vector3()), s = this._s || (this._s = new THREE.Vector3());
    const col = this._c || (this._c = new THREE.Color()), white = this._w || (this._w = new THREE.Color(1, 1, 1)), dim = this._dim || (this._dim = new THREE.Color(0.55, 0.55, 0.6));
    for (const k of this.kinds.values()) for (const i of Object.values(k)) i.begin();
    this.ringI.begin(); this.barBg.begin(); this.barFg.begin();
    const cam = this.renderer.camera, camQ = cam.quaternion, camR = this._cr || (this._cr = new THREE.Vector3());
    camR.set(1, 0, 0).applyQuaternion(camQ);
    const selSet = new Set(this.sel), hover = this.hoverId, alt = this.keys && (this.keys.AltLeft || this.keys.AltRight);
    const myTeam = this.myTeam();
    const view = this.viewRect();
    const t = performance.now() / 1000;
    for (const e of this.ents.values()) {
      if (e.x < view.x0 || e.x > view.x1 || e.z < view.z0 || e.z > view.z1) continue;
      const K = this.kinds.get(e.type); if (!K) continue;
      const p = this.plOf(e.own); col.set(p ? p.color : '#aaaaaa');
      const fixedC = e.ghost ? dim : white;
      if (e.ghost) col.multiplyScalar(0.6);
      let y = this.groundY(e.x, e.z);
      if (e.kind === 'u') {
        const air = e.def.air;
        if (air) y += UNIT_AIR_H + Math.sin(e.anim * 0.7 + e.id) * 0.25;
        const moving = e.fl & 256, bob = !air && moving && !e.def.tags.includes('mech') ? Math.abs(Math.sin(e.anim)) * 0.08 : 0;
        const bank = air ? clamp(angLerp(0, e.tface - e.face, 1) * -2, -0.5, 0.5) : 0;
        e3.set(bank, -e.face, 0, 'YXZ'); q.setFromEuler(e3);
        m.compose(v.set(e.x, y + bob, e.z), q, s.set(1, 1, 1));
        if (K['0f']) K['0f'].add(m, fixedC);
        if (K['0t']) K['0t'].add(m, col);
        if (K['1f'] || K['1t']) {   // turret: toward its target
          let ta = e.face; const tg = e.tgt && this.ents.get(e.tgt); if (tg) ta = Math.atan2(tg.z - e.z, tg.x - e.x);
          e.tur = angLerp(e.tur ?? e.face, ta, clamp(dt * 6, 0, 1));
          e3.set(0, -e.tur, 0); q.setFromEuler(e3); m.compose(v.set(e.x, y + bob, e.z), q, s.set(1, 1, 1));
          if (K['1f']) K['1f'].add(m, fixedC); if (K['1t']) K['1t'].add(m, col);
        }
      } else {
        // buildings go up from the ground while they're built
        const sy = e.prog >= 100 ? 1 : 0.25 + 0.75 * e.prog / 100;
        e3.set(0, 0, 0); q.setFromEuler(e3);
        m.compose(v.set(e.x, y, e.z), q, s.set(1, sy, 1));
        const fc = e.prog >= 100 ? fixedC : (this._uc || (this._uc = new THREE.Color(0.75, 0.78, 0.85)));
        if (K['0f']) K['0f'].add(m, fc); if (K['0t']) K['0t'].add(m, col);
        if (K['1f'] || K['1t']) {
          let ta = e.tur ?? 0; const tg = e.tgt && this.ents.get(e.tgt); if (tg) ta = Math.atan2(tg.z - e.z, tg.x - e.x);
          e.tur = angLerp(e.tur ?? 0, ta, clamp(dt * 6, 0, 1));
          e3.set(0, -e.tur, 0); q.setFromEuler(e3); m.compose(v.set(e.x, y, e.z), q, s.set(1, sy, 1));
          if (K['1f']) K['1f'].add(m, fc); if (K['1t']) K['1t'].add(m, col);
        }
      }
      if (e.ghost) continue;
      // selection ring, health bar
      const sel = selSet.has(e.id), hov = hover === e.id, mine = this.isMine(e), ally = p && p.team === myTeam;
      const r = e.kind === 'u' ? e.def.r * 1.25 + 0.15 : e.half * 1.12;
      if (sel || hov) {
        const rc = this._rc || (this._rc = new THREE.Color());
        rc.set(mine ? '#5aff7a' : ally ? '#ffe45a' : '#ff5a4a'); if (!sel) rc.multiplyScalar(0.6);
        m.compose(v.set(e.x, (e.kind === 'u' && e.def.air ? y - UNIT_AIR_H + 0.15 : y + 0.12), e.z), this._q0 || (this._q0 = new THREE.Quaternion()), s.set(r, 1, r));
        this.ringI.add(m, rc);
      }
      const hurt = e.hp < e.maxHp;
      if (sel || hov || alt || (hurt && (mine || ally || e.kind === 'u')) || (e.kind === 'b' && e.prog < 100)) {
        const w = e.kind === 'u' ? clamp(0.5 + Math.sqrt(e.maxHp) * 0.06, 0.8, 2.2) : e.half * 1.3, hp = clamp(e.hp / e.maxHp, 0, 1);
        const top = e.kind === 'u' ? (e.def.air ? y + 1.1 : y + (e.def.tags.includes('mech') ? 1.9 : 1.6) * (UNIT_LOOK[e.type].s || 1)) : y + 4.2 + (e.def.s > 2 ? 1.2 : 0);
        m.compose(v.set(e.x, top, e.z), camQ, s.set(w + 0.08, 0.2, 1)); this.barBg.add(m);
        const bc = this._bc || (this._bc = new THREE.Color());
        bc.set(hp > 0.6 ? '#4ae05a' : hp > 0.3 ? '#ffd23a' : '#ff4a3a');
        const off = -(1 - hp) * w / 2;
        m.compose(v.set(e.x + camR.x * off, top + camR.y * off, e.z + camR.z * off), camQ, s.set(Math.max(0.001, w * hp), 0.12, 1)); this.barFg.add(m, bc);
        if (e.kind === 'b' && e.prog < 100) {   // construction progress under it
          const pr = e.prog / 100, o2 = -(1 - pr) * w / 2;
          bc.set('#5ab8ff');
          m.compose(v.set(e.x, top - 0.3, e.z), camQ, s.set(w + 0.08, 0.14, 1)); this.barBg.add(m);
          m.compose(v.set(e.x + camR.x * o2, top - 0.3 + camR.y * o2, e.z + camR.z * o2), camQ, s.set(Math.max(0.001, w * pr), 0.08, 1)); this.barFg.add(m, bc);
        }
      }
    }
    for (const k of this.kinds.values()) for (const i of Object.values(k)) i.end();
    this.ringI.end(); this.barBg.end(); this.barFg.end();
    // crystals (3 shards a patch, fewer as it's mined), derrick flags, tower eyes
    this.crystalI.begin();
    for (const r of this.res.values()) {
      if (r.k !== 'c') continue;
      const y = this.groundY(r.x, r.z), f = clamp((r.amt ?? r.max) / r.max, 0.15, 1), n = f > 0.66 ? 3 : f > 0.33 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const a = r.id * 2.1 + i * 2.1, ox = Math.cos(a) * 0.45 * (i ? 1 : 0), oz = Math.sin(a) * 0.45 * (i ? 1 : 0), sc = (i ? 0.75 : 1.05) * (0.7 + f * 0.3);
        e3.set(0.15 * Math.sin(a), a, 0.15 * Math.cos(a)); q.setFromEuler(e3);
        m.compose(v.set(r.x + ox, y + 0.7 * sc, r.z + oz), q, s.set(sc, sc, sc)); this.crystalI.add(m);
      }
    }
    this.crystalI.end();
    for (const r of this.res.values()) if (r.k === 'f') { const g = this.vents.get(r.id); if (g) g.visible = true; }
    for (const [id, g] of this.vents) if (!this.res.has(id)) g.visible = false;
    for (const d of this.der) {
      const G = this.derG.get(d.id); if (!G) continue;
      G.arm.rotation.z = Math.sin(t * 1.6 + d.id) * 0.25;
      const p = d.own >= 0 ? this.plOf(d.own) : null; G.flagMat.color.set(p ? p.color : d.own === -2 ? '#555555' : '#cccccc');
      G.ringMat.color.set(d.cap === 1 ? '#7fff9a' : d.cap === 2 ? '#ff5a4a' : p ? p.color : '#ffffff'); G.ringMat.opacity = d.cap ? 0.5 + 0.4 * Math.sin(t * 8) : 0.35;
    }
    this.towG.forEach((T, i) => { const st = this.towersSt[i] || 0; T.eyeMat.color.set(st === 1 ? '#7fff9a' : st === 2 ? '#ff5a4a' : '#888888'); T.eye.rotation.y = t; });
    this.drawPlacement(); this.drawRally(); this.drawNet();
  }
  viewRect() {   // the ground the camera can see (a generous box), for skipping far entities
    const c = this.cam, w = c.h * 2.6 + 20;
    return { x0: c.x - w * 1.3, x1: c.x + w * 1.3, z0: c.z - w * 1.4, z1: c.z + w * 1.1 };
  }
  drawRally() {
    const b = this.sel.length ? this.ents.get(this.sel[0]) : null;
    const bo = b && this.isMine(b) && b.kind === 'b' && this.my.bo[b.id];
    const r = bo && bo[3];
    if (!r) { this.rallyLine.visible = false; this.flagMesh.visible = false; return; }
    const p = this.rallyLine.geometry.attributes.position;
    p.setXYZ(0, b.x, this.groundY(b.x, b.z) + 0.4, b.z); p.setXYZ(1, r[0], this.groundY(r[0], r[1]) + 0.4, r[1]); p.needsUpdate = true;
    this.rallyLine.computeLineDistances(); this.rallyLine.visible = true;
    this.flagMesh.position.set(r[0], this.groundY(r[0], r[1]) + 0.8, r[1]); this.flagMesh.visible = true;
  }
  // v1.2.32 the Hive: your network drawn on the ground (a ring around each Brood Nest and Hive Node)
  netList() { const L = []; for (const e of this.ents.values()) if (e.kind === 'b' && e.def.net && this.isMine(e)) L.push([e.x, e.z, e.prog >= 100 ? e.def.net : RTS.hive.siteR]); return L; }
  inNet(x, z) { for (const [bx, bz, r] of this.netList()) if (Math.hypot(x - bx, z - bz) <= r) return true; return false; }
  drawNet() {
    const seen = new Set(), M = this.netM || (this.netM = new Map());
    for (const [x, z, r] of this.netList()) {
      const k = x + ':' + z; seen.add(k);
      let o = M.get(k);
      if (!o || o.r !== r) {
        if (o) { this.root.remove(o.m); o.m.geometry.dispose(); }
        const m = new THREE.Mesh(new THREE.RingGeometry(r - 0.35, r, 72).rotateX(-Math.PI / 2), this.netMat || (this.netMat = new THREE.MeshBasicMaterial({ color: '#b07aff', transparent: true, opacity: 0.4, depthWrite: false })));
        m.position.set(x, this.groundY(x, z) + 0.15, z); this.root.add(m); M.set(k, o = { m, r });
      }
    }
    for (const [k, o] of M) if (!seen.has(k)) { this.root.remove(o.m); o.m.geometry.dispose(); M.delete(k); }
  }
  drawPlacement() {
    const P = this.mode && this.mode.k === 'place' ? this.mode : null;
    this.cellI.begin();
    if (!P || !this.mouseGround) { this.ghost.visible = false; this.cellI.end(); return; }
    const type = P.type, d = BUILDINGS[type], M = this.M, N = M.N;
    let { x, z } = this.mouseGround;
    if (d.vent) { const v = this.ventNear(x, z); if (v) { x = v.x; z = v.z; } }
    const s = d.s, cx0 = Math.round((x + M.H) / CELL - s / 2), cz0 = Math.round((z + M.H) / CELL - s / 2);
    const fx = (cx0 + s / 2) * CELL - M.H, fz = (cz0 + s / 2) * CELL - M.H;
    P.x = fx; P.z = fz;
    if (P.type0 !== type) {
      P.type0 = type;
      for (const c of [...this.ghost.children]) { this.ghost.remove(c); c.geometry.dispose(); }
      for (const ge of Object.values(bakeParts(BUILD_LOOK[type]))) this.ghost.add(new THREE.Mesh(ge, this.ghostMat));
    }
    let ok = true, lv = -1;
    const m = this._pm || (this._pm = new THREE.Matrix4()), q0 = this._q0 || (this._q0 = new THREE.Quaternion()), v = this._v, sc = this._s.set(1, 1, 1), c = this._pc || (this._pc = new THREE.Color());
    for (let dz = 0; dz < s; dz++) for (let dx = 0; dx < s; dx++) {
      const kx = cx0 + dx, kz = cz0 + dz, k = kz * N + kx;
      let good = kx > 0 && kz > 0 && kx < N - 1 && kz < N - 1 && M.walk[k] === 1 && !M.ramp[k] && this.explored[k];
      if (good && lv < 0) lv = M.lv[k]; else if (good && M.lv[k] !== lv) good = false;
      if (good) for (const e of this.ents.values()) if (e.kind === 'b' && Math.abs(e.x - (kx * CELL - M.H + 1)) < e.half && Math.abs(e.z - (kz * CELL - M.H + 1)) < e.half) { good = false; break; }
      if (d.vent) good = !!this.ventNear(x, z);
      if (!good) ok = false;
      const wx = kx * CELL - M.H + 1, wz = kz * CELL - M.H + 1;
      m.compose(v.set(wx, this.groundY(wx, wz) + 0.1, wz), q0, sc); this.cellI.add(m, c.set(good ? '#5aff7a' : '#ff4a3a'));
    }
    if (!d.vent && d.drop) for (const r of this.res.values()) if (Math.abs(r.x - fx) < 6.5 && Math.abs(r.z - fz) < 6.5) ok = false;
    if (d.fac === 'hive' && !d.drop && !this.inNet(fx, fz)) ok = false;   // (v1.2.32: inside your network)
    this.cellI.end();
    P.ok = ok;
    this.ghostMat.color.set(ok ? '#7fff9a' : '#ff6a5a');
    this.ghost.position.set(fx, this.groundY(fx, fz) + 0.05, fz); this.ghost.visible = true;
  }
  ventNear(x, z) { for (const r of this.res.values()) if (r.k === 'f' && Math.abs(r.x - x) < 2.6 && Math.abs(r.z - z) < 2.6) return r; return null; }

  // ---------------------------------------------------------------- vision (for drawing the fog; the host decides what you get)
  visAt(x, z) { if (!this.vis) return true; const k = cellOf(this.M, x, z); return k >= 0 && this.vis[k] === 2; }
  updateVision(dt) {
    const M = this.M; this.visT = (this.visT || 0) - dt;
    if (this.visT <= 0) {
      this.visT = 0.15;
      const vis = this.vis; vis.fill(0);
      const all = this.spectating() || (this.pub && this.pub.ph === 'over');
      if (all) vis.fill(2);
      else {
        const team = this.myTeam();
        for (const e of this.ents.values()) {
          if (e.ghost) continue;
          const p = this.plOf(e.own); if (!p || p.team !== team) continue;
          if (e.kind === 'u') stampVision(M, vis, e.x, e.z, e.def.sight, e.def.air ? 9 : M.lv[Math.max(0, cellOf(M, e.x, e.z))], e.def.air);
          else stampVision(M, vis, e.x, e.z, e.prog >= 100 ? e.def.sight : 5, M.lv[Math.max(0, cellOf(M, e.x, e.z))], false);
        }
        M.towers.forEach((t, i) => { if (this.towersSt[i] === 1) stampVision(M, vis, t.x, t.z, RTS.towerSight, 9, true); });
        const gt = this.gameTime(); this.flares = this.flares.filter(f => f.until > gt);
        for (const f of this.flares) stampVision(M, vis, f.x, f.z, RTS.flare.r, 9, true);
      }
      for (let k = 0; k < vis.length; k++) if (vis[k]) this.explored[k] = 1;
    }
    // ease the fog toward its target (soft edges as units move)
    const cur = this.fowCur, data = FOW.data, ex = this.explored, vis = this.vis, a = clamp(dt * 7, 0, 1);
    let ch = false;
    for (let k = 0; k < cur.length; k++) {
      const want = vis[k] === 2 ? 255 : ex[k] ? 118 : 16;
      const c = cur[k]; if (c === want) continue;
      const n = Math.abs(want - c) < 2 ? want : c + (want - c) * a; cur[k] = n; data[k * 4] = n; ch = true;
    }
    if (ch) FOW.tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- effects
  muzzle(e) {
    const y = this.yOf(e) + (e.kind === 'b' ? 2.85 : e.def.air ? 0 : e.def.tags.includes('mech') ? 0.95 : 0.68);
    const a = e.tur ?? e.face, r = e.kind === 'b' ? 1.2 : e.def.r + 0.35;
    return { x: e.x + Math.cos(a) * r, y, z: e.z + Math.sin(a) * r };
  }
  shotFx(e) {
    const a = this.ents.get(e.a), b = this.ents.get(e.b);
    const tx = b ? b.x : e.x, tz = b ? b.z : e.z, ty = b ? this.yOf(b) + (b.kind === 'b' ? 1.5 : 0.6) : this.groundY(tx, tz) + 0.5;
    if (!a) { this.renderer.burst(tx, ty, tz, '#ffd166', 3, 2); return; }
    const m = this.muzzle(a), near = Math.hypot(this.cam.x - a.x, this.cam.z - a.z) < this.cam.h * 2.2;
    switch (e.fx) {
      case 'melee': if (near) this.renderer.burst(tx, ty, tz, '#ffd166', 2, 2); this.sfx('cut', 0.12, 0.25); break;
      case 'bullet': this.tracer(m.x, m.y, m.z, tx, ty, tz, '#ffe08a', 0.07, 'bullet'); if (near) this.renderer.glowSprite(m.x, m.y, m.z, '#ffe08a', 0.4, 0.05); this.sfx('shoot', 0.12, 0.07); break;
      case 'acid': this.tracer(m.x, m.y, m.z, tx, ty, tz, '#9aff4a', 0.14, 'laser'); if (near) this.renderer.burst(tx, ty, tz, '#9aff4a', 2, 1.5); this.sfx('hiss', 0.12, 0.2); break;
      case 'laser': this.tracer(m.x, m.y, m.z, tx, ty, tz, '#ff6a6a', 0.1, 'laser'); this.sfx('zap', 0.2, 0.12); break;
      case 'rocket': this.tracer(m.x, m.y, m.z, tx, ty, tz, '#ffb04a', 0.32, 'rocket'); this.sfx('whoosh', 0.18, 0.15); break;
      case 'flame': { if (near) for (let i = 1; i <= 4; i++) { const k = i / 4; this.renderer.burst(m.x + (tx - m.x) * k, m.y + (ty - m.y) * k, m.z + (tz - m.z) * k, i % 2 ? '#ff8a2a' : '#ffd166', 2, 1.5); } this.sfx('hiss', 0.2, 0.3); break; }
      case 'shell': this.tracer(m.x, m.y, m.z, tx, ty, tz, '#ffd166', e.s ? 0.55 : 0.25, 'shell'); if (near) this.renderer.glowSprite(m.x, m.y, m.z, '#fff0c0', e.s ? 1.4 : 0.8, 0.1); this.sfx('explode', e.s ? 0.35 : 0.18, 0.15); break;
      default: this.tracer(m.x, m.y, m.z, tx, ty, tz, '#ffffff', 0.08, 'bullet');
    }
  }
  tracer(x0, y0, z0, x1, y1, z1, color, dur, kind) { if (this.fx.length < 500) this.fx.push({ x0, y0, z0, x1, y1, z1, c: new THREE.Color(color), t: 0, dur, kind }); }
  boom(x, z, r) {
    const y = this.groundY(x, z) + 0.4;
    this.renderer.glowSprite(x, y + 0.4, z, '#ffd166', r * 1.4, 0.3, 1.8); this.renderer.glowSprite(x, y, z, '#ff7a2a', r * 2, 0.45, 1.6);
    this.renderer.burst(x, y, z, '#6a5a48', 8, 5); this.renderer.burst(x, y, z, '#ffb04a', 6, 4);
    this.sfx('explode', 0.35, 0.12);
  }
  deathFx(e) {
    const y = this.groundY(e.x, e.z) + (e.k === 'u' && UNITS[e.type] && UNITS[e.type].air ? UNIT_AIR_H : 0.5), p = this.plOf(e.o), c = p ? p.color : '#cccccc';
    if (e.k === 'b') {
      const s = BUILDINGS[e.type] ? BUILDINGS[e.type].s : 2;
      for (let i = 0; i < 3 + s; i++) this.renderer.glowSprite(e.x + (Math.random() - 0.5) * s * 2, y + Math.random() * 2, e.z + (Math.random() - 0.5) * s * 2, i % 2 ? '#ff7a2a' : '#ffd166', 2 + s, 0.5 + Math.random() * 0.4, 1.8);
      this.renderer.burst(e.x, y + 1, e.z, '#5a5a60', 18, 7); this.renderer.burst(e.x, y + 1, e.z, c, 10, 6);
      this.sfx('explode', 0.8, 0.2);
    } else {
      this.renderer.deathPop(e.x, y, e.z, c, UNITS[e.type] && UNITS[e.type].tags.includes('mech'));
      if (UNITS[e.type] && UNITS[e.type].tags.includes('mech')) { this.renderer.burst(e.x, y, e.z, '#ff8a2a', 6, 4); this.sfx('explode', 0.3, 0.1); } else this.sfx('death', 0.2, 0.15);
    }
    if (this.sel.includes(e.id)) this.sel = this.sel.filter(id => id !== e.id);
  }
  meteorFx(x, z) { const y = this.groundY(x, z); this.tracer(x - 6, y + 22, z - 4, x, y, z, '#ff8a3a', 0.7, 'shell'); }
  mark(x, z, color) { this.marks.push({ x, z, c: new THREE.Color(color), t: 0 }); }
  updateFx(dt) {
    const m = this._fm || (this._fm = new THREE.Matrix4()), q = this._fq || (this._fq = new THREE.Quaternion()), v = this._fv || (this._fv = new THREE.Vector3()), s = this._fs || (this._fs = new THREE.Vector3()), dir = this._fd || (this._fd = new THREE.Vector3()), up = this._fu || (this._fu = new THREE.Vector3(1, 0, 0));
    this.tracerI.begin(); this.shellI.begin();
    const keep = [];
    for (const f of this.fx) {
      f.t += dt; const k = f.t / f.dur;
      if (k >= 1) {
        if (f.kind === 'rocket') this.renderer.burst(f.x1, f.y1, f.z1, '#ffb04a', 4, 3);
        else if (f.kind === 'shell') { this.renderer.glowSprite(f.x1, f.y1, f.z1, '#ffd166', 1.6, 0.25, 1.6); this.renderer.burst(f.x1, f.y1, f.z1, '#7a6a58', 6, 4); }
        else if (Math.random() < 0.4) this.renderer.burst(f.x1, f.y1, f.z1, '#ffe08a', 1, 1.5);
        continue;
      }
      keep.push(f);
      const arc = f.kind === 'shell' ? Math.sin(k * Math.PI) * Math.hypot(f.x1 - f.x0, f.z1 - f.z0) * 0.18 : 0;
      const x = f.x0 + (f.x1 - f.x0) * k, y = f.y0 + (f.y1 - f.y0) * k + arc, z = f.z0 + (f.z1 - f.z0) * k;
      if (f.kind === 'shell') { m.compose(v.set(x, y, z), q.identity(), s.set(1, 1, 1)); this.shellI.add(m, f.c); continue; }
      dir.set(f.x1 - f.x0, f.y1 - f.y0, f.z1 - f.z0); const L = dir.length() || 1; dir.divideScalar(L);
      q.setFromUnitVectors(up, dir);
      const len = f.kind === 'laser' ? L : f.kind === 'rocket' ? 0.5 : Math.min(1.6, L * 0.35), w = f.kind === 'rocket' ? 0.16 : f.kind === 'laser' ? 0.07 : 0.05;
      const cx = f.kind === 'laser' ? (f.x0 + f.x1) / 2 : x, cy = f.kind === 'laser' ? (f.y0 + f.y1) / 2 : y, cz = f.kind === 'laser' ? (f.z0 + f.z1) / 2 : z;
      m.compose(v.set(cx, cy, cz), q, s.set(len, w, w)); this.tracerI.add(m, f.c);
    }
    this.fx = keep; this.tracerI.end(); this.shellI.end();
    this.markI.begin();
    this.marks = this.marks.filter(mk => (mk.t += dt) < 0.55);
    for (const mk of this.marks) { const r = 1.3 * (1 - mk.t / 0.55) + 0.25; m.compose(v.set(mk.x, this.groundY(mk.x, mk.z) + 0.15, mk.z), q.identity(), s.set(r, 1, r)); this.markI.add(m, mk.c); }
    this.markI.end();
  }

  // ---------------------------------------------------------------- camera
  updateCamera(dt) {
    const c = this.cam, K = this.keys || {}, M = this.M;
    const typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    const sp = c.h * 1.5 * dt * (this.settings && this.settings.rtsPan ? +this.settings.rtsPan : 1);
    let dx = 0, dz = 0;
    if (!typing && !this.hud.blocking()) { if (K.ArrowLeft) dx -= 1; if (K.ArrowRight) dx += 1; if (K.ArrowUp) dz -= 1; if (K.ArrowDown) dz += 1; }
    // edge panning (the drawn cursor in fullscreen can't leave the window, so this always works there)
    const edge = 8, focused = document.hasFocus();
    if (focused && this.mouseIn && !this.drag && this.edgeOk()) { if (this.mx <= edge) dx -= 1; if (this.mx >= innerWidth - 1 - edge) dx += 1; if (this.my2 <= edge) dz -= 1; if (this.my2 >= innerHeight - 1 - edge) dz += 1; }
    if (dx || dz) { c.x += dx * sp; c.z += dz * sp; c.goal = null; }
    if (c.goal) { const k = 1 - Math.exp(-dt * 9); c.x += (c.goal.x - c.x) * k; c.z += (c.goal.z - c.z) * k; if (Math.hypot(c.goal.x - c.x, c.goal.z - c.z) < 0.2) c.goal = null; }
    if (c.hGoal) { c.h += (c.hGoal - c.h) * (1 - Math.exp(-dt * 10)); if (Math.abs(c.hGoal - c.h) < 0.05) c.hGoal = null; }
    if (M) { const L = M.H - 4; c.x = clamp(c.x, -L, L); c.z = clamp(c.z, -L, L + 10); }
    const gy = M ? this.groundY(clamp(c.x, -M.H + 3, M.H - 3), clamp(c.z, -M.H + 3, M.H - 3)) : 0;
    c.gy += (gy - c.gy) * (1 - Math.exp(-dt * 4));
    const cam = this.renderer.camera, back = c.h / Math.tan(PITCH);
    cam.position.set(c.x, c.gy + c.h, c.z + back);
    cam.lookAt(c.x, c.gy, c.z);
    cam.updateMatrixWorld();
    this.renderer.shake = 0;
    // shadows follow the camera
    const R = this.renderer, S = R.sun, ext = clamp(c.h * 1.5, 30, 90);
    S.position.set(c.x + 30, c.gy + 70, c.z + 22); S.target.position.set(c.x, c.gy, c.z); S.target.updateMatrixWorld();
    const sc = S.shadow.camera; if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 200; sc.updateProjectionMatrix(); }
  }
  edgeOk() { return this.locked() || (this.mx > -1 && this.my2 > -1 && this.mx < innerWidth && this.my2 < innerHeight); }
  lookAt(x, z) { this.cam.goal = { x, z }; }
  // screen point -> ground point (a ray against the terrain, refined a few times)
  ground(sx, sy) {
    const cam = this.renderer.camera, ray = this._ray || (this._ray = new THREE.Raycaster()), v = this._gv || (this._gv = new THREE.Vector2());
    v.set(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    ray.setFromCamera(v, cam);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y > -0.01) return null;
    let y = this.cam.gy, x = 0, z = 0;
    for (let i = 0; i < 5; i++) { const t = (y - o.y) / d.y; x = o.x + d.x * t; z = o.z + d.z * t; y = this.groundY(x, z); }
    // march for cliffs in front of the hit point
    const t0 = (this.cam.gy + 14 - o.y) / d.y;
    for (let t = Math.max(0, t0); t < (y - o.y) / d.y; t += 0.5) { const px = o.x + d.x * t, pz = o.z + d.z * t, py = o.y + d.y * t; if (py <= this.groundY(px, pz)) { x = px; z = pz; y = this.groundY(px, pz); break; } }
    return { x, z, y };
  }
  project(x, y, z) {
    const v = this._pv || (this._pv = new THREE.Vector3());
    v.set(x, y, z).project(this.renderer.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, z: v.z };
  }
  // the entity under a screen point (closest to the cursor, within its drawn size)
  pick(sx, sy, filter) {
    let best = null, bd = Infinity;
    const scale = innerHeight / (2 * Math.tan(this.renderer.camera.fov * Math.PI / 360));
    for (const e of this.ents.values()) {
      if (filter && !filter(e)) continue;
      const y = this.yOf(e) + (e.kind === 'b' ? 1.2 : 0.55);
      const p = this.project(e.x, y, e.z); if (p.z > 1) continue;
      const dist = Math.hypot(this.renderer.camera.position.x - e.x, this.renderer.camera.position.y - y, this.renderer.camera.position.z - e.z) || 1;
      const rad = (e.kind === 'b' ? e.half * 1.2 : e.def.r * 1.6 + 0.35) * scale / dist + 4;
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < rad && d < bd) { bd = d; best = e; }
    }
    return best;
  }
  locked() { return document.pointerLockElement === this.renderer.canvas; }
  fullscreen() { return !!document.fullscreenElement || (Math.abs(innerWidth - screen.width) < 3 && Math.abs(innerHeight - screen.height) < 3); }

  // ---------------------------------------------------------------- input
  bindInput() {
    const R = this.renderer, cv = R.canvas;
    this.onMove = e => {
      if (this.locked()) { const k = (this.settings && +this.settings.sensitivity) || 1, cl = v => clamp(v || 0, -250, 250); this.mx = clamp(this.mx + cl(e.movementX) * k, 0, innerWidth - 1); this.my2 = clamp(this.my2 + cl(e.movementY) * k, 0, innerHeight - 1); }   // (clamped: some browsers send one huge jump right after the lock)
      else { this.mx = e.clientX; this.my2 = e.clientY; }
      this.mouseIn = true;
      this.pointerMove();
    };
    this.onLeave = () => { if (!this.locked()) this.mouseIn = false; };
    this.onEnter = () => { this.mouseIn = true; };
    this.onDown = e => {
      if (this.disposed) return;
      const el = this.locked() ? document.elementFromPoint(this.mx, this.my2) : e.target;
      if (!this.locked() && e.target !== cv) return;   // the HUD handles its own clicks
      if (this.locked() && el && el !== cv && this.hud.el.contains(el)) { this.hud.lockedDown(el, e); return; }
      if (this.wantLock() && !this.locked()) { try { cv.requestPointerLock(); } catch { /* not allowed */ } }
      if (e.button === 0) e.preventDefault();   // (no text selection while dragging a box)
      this.worldDown(e);
    };
    this.onUp = e => {
      if (this.disposed) return;
      if (this.locked()) { const el = document.elementFromPoint(this.mx, this.my2); if (this.hud.lockedUp(el, e)) return; }
      this.worldUp(e);
    };
    this.onWheel = e => {
      if (this.disposed) return;
      const el = this.locked() ? document.elementFromPoint(this.mx, this.my2) : e.target;
      if (el !== cv) return;
      const c = this.cam; c.hGoal = clamp((c.hGoal || c.h) * (e.deltaY > 0 ? 1.12 : 0.89), 14, 75);
    };
    this.onKey = e => this.keyDown(e);
    this.onKeyUp = e => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.hud.dirty = true; };
    this.onCtx = e => { if (e.target === cv || (this.hud.el.contains(e.target))) e.preventDefault(); };
    this.onLockCh = () => { this.hud.cursorShow(this.locked()); if (!this.locked()) this.hud.lockHint(this.wantLock()); };
    this.onResize = () => { if (!this.wantLock() && this.locked()) document.exitPointerLock(); this.hud.lockHint(this.wantLock() && !this.locked()); };
    addEventListener('mousemove', this.onMove); document.addEventListener('mouseleave', this.onLeave); document.addEventListener('mouseenter', this.onEnter);
    addEventListener('mousedown', this.onDown, true); addEventListener('mouseup', this.onUp, true);
    addEventListener('wheel', this.onWheel, { passive: true }); addEventListener('keydown', this.onKey, true); addEventListener('keyup', this.onKeyUp, true);
    addEventListener('contextmenu', this.onCtx); document.addEventListener('pointerlockchange', this.onLockCh); addEventListener('resize', this.onResize);
  }
  unbindInput() {
    removeEventListener('mousemove', this.onMove); document.removeEventListener('mouseleave', this.onLeave); document.removeEventListener('mouseenter', this.onEnter);
    removeEventListener('mousedown', this.onDown, true); removeEventListener('mouseup', this.onUp, true);
    removeEventListener('wheel', this.onWheel); removeEventListener('keydown', this.onKey, true); removeEventListener('keyup', this.onKeyUp, true);
    removeEventListener('contextmenu', this.onCtx); document.removeEventListener('pointerlockchange', this.onLockCh); removeEventListener('resize', this.onResize);
  }
  // v1.2.28 (Devin: the mouse still left the window, even in fullscreen): the lock no longer waits for fullscreen. That
  // test compared the window with the screen size, which never matched once the GUI scale zoomed the page (or in a
  // maximized window), so it never locked. Now any click into the battlefield captures the mouse, windowed or not
  // (Esc or Alt+Tab lets it go; the next click takes it again). Settings > General can still turn it off.
  wantLock() { return !(this.settings && this.settings.rtsLock === false) && !this.hud.menuOpen() && document.hasFocus(); }
  pointerMove() {
    this.mouseGround = this.M ? this.ground(this.mx, this.my2) : null;
    const h = this.M && !this.drag ? this.pick(this.mx, this.my2) : null;
    this.hoverId = h ? h.id : 0;
    if (this.drag) { this.drag.x1 = this.mx; this.drag.y1 = this.my2; if (Math.hypot(this.drag.x1 - this.drag.x0, this.drag.y1 - this.drag.y0) > 5) this.drag.box = true; }
    if (this.grab && this.mouseGround) { /* middle-drag: the ground point under the cursor stays under it */ const g0 = this.grab; const nowG = this.ground(this.mx, this.my2); if (nowG) { this.cam.x += g0.x - nowG.x; this.cam.z += g0.z - nowG.z; this.cam.goal = null; } }
    this.hud.cursorMove();
  }
  worldDown(e) {
    if (!this.M) return;
    const shift = e.shiftKey;
    if (e.button === 1) { e.preventDefault(); this.grab = this.ground(this.mx, this.my2); return; }
    if (e.button === 2) {
      if (this.mode) { this.mode = null; this.hud.dirty = true; return; }
      this.smart(shift);
      return;
    }
    if (e.button !== 0) return;
    if (this.mode) { this.useMode(shift); return; }
    this.drag = { x0: this.mx, y0: this.my2, x1: this.mx, y1: this.my2, box: false, shift, ctrl: e.ctrlKey };
  }
  worldUp(e) {
    if (e.button === 1) { this.grab = null; return; }
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag; this.drag = null; this.hud.boxHide();
    if (d.box) this.boxSelect(d);
    else this.clickSelect(d);
  }
  // left click on the world
  clickSelect(d) {
    const e = this.pick(this.mx, this.my2);
    const now = performance.now(), dbl = this.lastClick && now - this.lastClick.t < 320 && e && this.lastClick.id === e.id;
    this.lastClick = { t: now, id: e ? e.id : 0 };
    if (!e) { if (!d.shift) this.setSel([]); return; }
    if ((dbl || d.ctrl) && this.isMine(e)) { this.selectTypeOnScreen(e.type, d.shift); return; }
    if (d.shift && this.isMine(e) && this.sel.length && this.sel.every(id => this.isMine(this.ents.get(id)))) {
      this.setSel(this.sel.includes(e.id) ? this.sel.filter(id => id !== e.id) : [...this.sel, e.id]); return;
    }
    this.setSel([e.id]);
    this.sfx('ui', 0.3, 0.05);
  }
  boxSelect(d) {
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    const inBox = e => { const p = this.project(e.x, this.yOf(e) + 0.5, e.z); return p.z < 1 && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1; };
    const mineU = [], mineB = [], other = [];
    for (const e of this.ents.values()) { if (e.ghost || !inBox(e)) continue; if (this.isMine(e)) (e.kind === 'u' ? mineU : mineB).push(e); else other.push(e); }
    // army first: workers only join a box with no army in it (unless it's only workers)
    let pickU = mineU; const army = mineU.filter(u => !u.def.worker); if (army.length && army.length < mineU.length && !d.shift) pickU = army;
    const ids = pickU.length ? pickU.map(e => e.id) : mineB.length ? mineB.map(e => e.id) : other.slice(0, 1).map(e => e.id);
    if (d.shift) this.setSel([...new Set([...this.sel, ...ids])]);
    else this.setSel(ids);
    if (ids.length) this.sfx('ui', 0.3, 0.05);
  }
  selectTypeOnScreen(type, add) {
    const ids = [];
    for (const e of this.ents.values()) { if (e.type !== type || !this.isMine(e)) continue; const p = this.project(e.x, this.yOf(e), e.z); if (p.z < 1 && p.x >= 0 && p.y >= 0 && p.x <= innerWidth && p.y <= innerHeight) ids.push(e.id); }
    this.setSel(add ? [...new Set([...this.sel, ...ids])] : ids);
  }
  setSel(ids) {
    // sorted like StarCraft: the most important unit type first (for the command card)
    const w = e => e.kind === 'b' ? 0 : e.def.worker ? 1 : 2 + (e.def.cost[0] + e.def.cost[1]) / 100;
    this.sel = ids.filter(id => this.ents.has(id)).sort((a, b) => w(this.ents.get(b)) - w(this.ents.get(a)) || a - b);
    this.mode = null; this.hud.buildMenu = false; this.hud.dirty = true;
  }
  mySel() { return this.sel.map(id => this.ents.get(id)).filter(e => e && this.isMine(e)); }
  // right click: move / attack / mine / repair / rally, whatever fits what's under the cursor
  smart(shift) {
    const mine = this.mySel(); if (!mine.length) return;
    const g = this.mouseGround; if (!g) return;
    const tgt = this.pick(this.mx, this.my2, e => !e.ghost || e.kind === 'b');
    const res = !tgt && this.resAt(g.x, g.z), der = !tgt && !res && this.derAt(g.x, g.z);
    const o = { k: 'smart', x: Math.round(g.x * 10) / 10, z: Math.round(g.z * 10) / 10 };
    if (tgt && tgt.id) o.id = tgt.id; if (res) o.res = res.id; if (der) o.der = der.id;
    this.act({ t: 'cmd', ids: mine.map(e => e.id), o, q: shift });
    const enemy = tgt && !this.isAlly(tgt);
    this.mark(tgt ? tgt.x : g.x, tgt ? tgt.z : g.z, enemy ? '#ff4a3a' : res ? '#ffd166' : '#5aff7a');
    this.sfx('pip', 0.35, 0.05);
  }
  resAt(x, z) { for (const r of this.res.values()) { const s = r.k === 'f' ? 2.4 : 1.4; if (Math.abs(r.x - x) < s && Math.abs(r.z - z) < s) return r; } return null; }
  derAt(x, z) { for (const d of this.der) if (Math.hypot(d.x - x, d.z - z) < 2.4) return d; return null; }
  // targeting modes: move, amove, patrol, repair, gather, flare, rally, place
  setMode(m) { this.mode = m; this.hud.dirty = true; this.sfx('ui', 0.25, 0.05); }
  useMode(shift, at) {
    const m = this.mode, g = at || this.mouseGround; if (!m || !g) return;
    const ids = this.mySel().map(e => e.id);
    const tgt = !at ? this.pick(this.mx, this.my2) : null;
    const X = Math.round(g.x * 10) / 10, Z = Math.round(g.z * 10) / 10;
    switch (m.k) {
      case 'place': {
        if (!m.ok && !at) { this.hud.err('Can\'t build there.'); this.sfx('nope', 0.5); return; }
        const ws = this.mySel().filter(e => e.kind === 'u' && e.def.worker).map(e => e.id);
        this.act({ t: 'build', ids: ws, type: m.type, x: m.x ?? X, z: m.z ?? Z, q: shift });
        this.sfx('block', 0.4);
        if (!shift) this.mode = null;
        break;
      }
      case 'flare': this.act({ t: 'ab', ab: 'flare', b: ids[0], x: X, z: Z }); this.mode = null; break;
      case 'rally': this.act({ t: 'cmd', ids, o: tgt ? { k: 'rally', id: tgt.id, x: X, z: Z } : this.resAt(X, Z) ? { k: 'rally', res: this.resAt(X, Z).id, x: X, z: Z } : { k: 'rally', x: X, z: Z } }); this.mark(X, Z, '#ffd166'); if (!shift) this.mode = null; break;
      default: {
        let o;
        if (m.k === 'amove' && tgt && !this.isAlly(tgt)) o = { k: 'attack', id: tgt.id };
        else if (m.k === 'repair' && tgt) o = { k: 'repair', id: tgt.id };
        else if (m.k === 'gather') { const r = this.resAt(X, Z); o = r ? { k: 'smart', res: r.id, x: X, z: Z } : tgt ? { k: 'smart', id: tgt.id, x: X, z: Z } : null; if (!o) { this.hud.err('Pick crystal or one of your refineries.'); return; } }
        else o = { k: m.k, x: X, z: Z };
        this.act({ t: 'cmd', ids, o, q: shift });
        this.mark(X, Z, m.k === 'amove' ? '#ff4a3a' : m.k === 'patrol' ? '#5ab8ff' : '#5aff7a');
        if (!shift) this.mode = null;
      }
    }
    this.hud.dirty = true;
  }
  keyDown(e) {
    if (this.disposed || !this.M) return;
    if (e.target && e.target.matches && e.target.matches('input[type=text], input:not([type]), textarea')) return;
    if (this.hud.menuOpen()) return;
    const code = e.code;
    if (code === 'Escape') {
      if (this.mode) { this.mode = null; this.hud.dirty = true; e.stopImmediatePropagation(); e.preventDefault(); return; }
      if (this.hud.buildMenu) { this.hud.buildMenu = false; this.hud.dirty = true; e.stopImmediatePropagation(); return; }
      if (this.hud.cardsOpen) { this.hud.openCards(false); e.stopImmediatePropagation(); return; }
      if (this.hud.overShown && this.hud.overOpen) { this.hud.hideOver(); e.stopImmediatePropagation(); return; }
      return;   // the pause menu (main.js)
    }
    if (e.ctrlKey && code === 'KeyR') return;   // (reload)
    if (code === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (code.startsWith('Arrow') || code === 'Space' || code === 'Backspace' || /^F[1-4]$/.test(code)) e.preventDefault();
    // control groups
    const dg = /^Digit([0-9])$/.exec(code);
    if (dg) {
      e.stopImmediatePropagation(); e.preventDefault();
      const i = +dg[1], mine = this.mySel().map(x => x.id);
      if (e.ctrlKey) { this.groups[i] = mine; this.hud.note(`Group ${i} set.`); }
      else if (e.shiftKey) { this.groups[i] = [...new Set([...this.groups[i], ...mine])]; }
      else {
        const ids = this.groups[i].filter(id => this.ents.has(id)); this.groups[i] = ids;
        const now = performance.now();
        if (this.lastGroup && this.lastGroup.i === i && now - this.lastGroup.t < 350 && ids.length) { const c = this.centerOf(ids); this.lookAt(c.x, c.z); }
        this.lastGroup = { i, t: now };
        if (ids.length) this.setSel(ids);
      }
      this.hud.dirty = true; return;
    }
    if (code === 'F1') { this.idleWorker(); e.stopImmediatePropagation(); return; }
    if (code === 'F2') { this.setSel([...this.ents.values()].filter(x => this.isMine(x) && x.kind === 'u' && !x.def.worker).map(x => x.id)); e.stopImmediatePropagation(); return; }
    if (code === 'Backspace') { const hubs = [...this.ents.values()].filter(x => this.isMine(x) && x.kind === 'b' && x.def.drop); if (hubs.length) { this.hubI = ((this.hubI || 0) + 1) % hubs.length; this.lookAt(hubs[this.hubI].x, hubs[this.hubI].z); } return; }
    if (code === 'Space') { if (this.lastAlert) this.lookAt(this.lastAlert.x, this.lastAlert.z); e.stopImmediatePropagation(); return; }
    if (e.repeat) return;
    if (this.hud.hotkey(code, e)) { e.stopImmediatePropagation(); e.preventDefault(); }
  }
  centerOf(ids) { let x = 0, z = 0, n = 0; for (const id of ids) { const e = this.ents.get(id); if (e) { x += e.x; z += e.z; n++; } } return n ? { x: x / n, z: z / n } : { x: this.cam.x, z: this.cam.z }; }
  idleWorker() {
    const idle = [...this.ents.values()].filter(x => this.isMine(x) && x.kind === 'u' && x.def.worker && (x.fl & 4096));
    if (!idle.length) { this.hud.err('No idle Riggers.'); return; }
    this.idleI = ((this.idleI || 0) + 1) % idle.length;
    const w = idle[this.idleI]; this.setSel([w.id]); this.lookAt(w.x, w.z);
  }
}
