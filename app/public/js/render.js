// Everything visual. Reads a "view" (plain player/bullet data) and draws it.
import * as THREE from '/vendor/three/build/three.module.js';
import { ART, RULES } from './config.js';
import { buildPlayerModel, buildCosmetics, attachCosmetics, buildTurretModel, addUnitExtras, buildCritterModel, buildBlobModel, buildRiotShield, makeShieldMaterial, SHIELD_TIME, buildViewGun, buildTankModel, buildTankHat, buildBlockTurretModel, buildMountTurretModel, buildBossModel, buildPortalModel, addRaiderMarks, buildSaiyanHair, buildPentagram, drawPentagram,
  buildBruteModel, buildAngelModel, buildRobe, buildHolyCross, buildGrove, buildShieldBubble, buildBodyPillow } from './art.js';
import { groundBelow } from './physics.js';
import { amonBodyBaked } from './amonui.js';
import { arenaEdges, edgeDistance } from './levelgen.js';
import { trapState } from './traps.js';
import { makeRock, makeLog, makeTree, mushroomPatch, makeFern, makeBush, makePine, iceCrystal, snowDrift, neonPylon, oysterCluster,
  makeCherryTree, makeTorii, stoneLantern, bambooClump, makePalm, tikiTorch, beachUmbrella, seaPlane, crater, moonRock, satDish, moduleHab, starField, planetDisc, obsidianSpire, lavaPool } from './scenery.js';

import { owBuild, owUpdate, owCamera, owStateOf, owTake, owCull } from './owrender.js';
import { useSideCamera, sideBuild, sideCamera, sideAim } from './siderender.js';
const CORE_LOOK = { block: ['#a9b3c4', 0x55607a], cube: ['#b07a45', 0x5a3a1c], plank: ['#c08a52', 0x5a3a1c], slab: ['#9aa3b0', 0x55607a], steel: ['#7b8696', 0x2c323c, 1], spikes: ['#6b5a4a', 0x3a2a1c] };   // Core Defense prop looks

const CHEST = RULES.chest;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const UPSCALE = { quality: 0.77, balanced: 0.67, performance: 0.5 };   // v27 upscaler render share
const PIXEL_CAP = { low: 2.1e6, medium: 2.1e6, high: 3.7e6 };          // v1.2.6: most pixels drawn per frame on high-DPI screens

// v27: level textures are drawn at 2x resolution, and every texture gets anisotropic filtering (sharp at
// glancing angles, which matters most with ray-traced reflections and long shadows).
const TEX_K = 2;
// v28 Core Defense: an AMON enemy (blocky autobattler model) walking around in the shooter.
function amonShooterModel(id) {
  const g = new THREE.Group(), body = amonBodyBaked(id || 'grunt'), tint = [], hit = [];
  body.rotation.y = -Math.PI / 2; body.scale.setScalar(1.25); g.add(body);
  body.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); tint.push(o.material); hit.push(o); o.castShadow = true; } });
  const gunPivot = new THREE.Group(), shield = buildShieldBubble(1.05); shield.visible = false; shield.position.y = 0.6; g.add(gunPivot, shield);
  return { root: g, tint, gunPivot, shield, hitMeshes: hit };
}
// v1.2.6: appends a geometry's faces, offset by (x, y, z), to per-material buckets (setLevel merges static blocks).
function mergeInto(B, geo, mats, x, y, z, cast) {
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, U = geo.attributes.uv.array, I = geo.index.array;
  for (const gr of geo.groups.length ? geo.groups : [{ start: 0, count: I.length, materialIndex: 0 }]) {
    const mat = Array.isArray(mats) ? mats[gr.materialIndex] : mats;
    let d = B.get(mat); if (!d) B.set(mat, d = { p: [], n: [], u: [], i: [], cast });
    const seen = new Map();
    for (let k = gr.start; k < gr.start + gr.count; k++) {
      const v = I[k]; let j = seen.get(v);
      if (j === undefined) { seen.set(v, j = d.p.length / 3); d.p.push(P[v * 3] + x, P[v * 3 + 1] + y, P[v * 3 + 2] + z); d.n.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); d.u.push(U[v * 2], U[v * 2 + 1]); }
      d.i.push(j);
    }
  }
}

export class Renderer {
  constructor(container, opts = {}) {
    // Native MSAA can only be chosen when the canvas is created; other AA modes switch live (see applyGraphics).
    this.ctxMSAA = !opts.aa || opts.aa === 'msaa' || opts.aa === 'ssaa';
    // v1.2.6: ask for the discrete GPU on dual-GPU laptops / Macs (the desktop app also passes a launch switch)
    const r = this.r = new THREE.WebGLRenderer({ antialias: this.ctxMSAA, powerPreference: 'high-performance' });
    this.loadScale = 1;   // v1.2.6: setLoadScale (frame-time guard in main.js), never saved
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(innerWidth, innerHeight);
    // v1.0.5: any render target three.js sets up without a stencil buffer gets only a 16-bit depth buffer (far
    // surfaces z-fight and flicker). Every target (post effects, shadow maps, reflections) is given 24-bit depth
    // the first time it's used, before it's allocated.
    const setRT = r.setRenderTarget.bind(r);
    r.setRenderTarget = (t, ...rest) => {
      if (t && !t.deepDepth) { t.deepDepth = true; if (t.depthTexture) t.depthTexture.type = THREE.UnsignedIntType; else if (t.depthBuffer) t.stencilBuffer = true; }
      return setRT(t, ...rest);
    };
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    THREE.Texture.DEFAULT_ANISOTROPY = Math.min(8, r.capabilities.getMaxAnisotropy() || 1);
    container.prepend(r.domElement);
    this.canvas = r.domElement;
    this.watchContext(this.canvas);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(ART.background);
    this.scene.fog = new THREE.Fog(ART.background, 55, 120);
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 300);
    this.camera.position.set(0, 24, 20);
    this.scene.add(this.camera);
    this.camLook = new THREE.Vector3();
    this.hemi = new THREE.HemisphereLight(0xdfe6ff, 0x3a4256, 0.78); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 0.62);
    sun.position.set(12, 34, 16); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun, sun.target);
    // Vivid lighting: a cool back light that rims characters and blocks against the warm sun.
    const rim = this.rim = new THREE.DirectionalLight(0x9db8ff, 0.3);
    rim.position.set(-16, 20, -22); rim.visible = false; this.scene.add(rim, rim.target);
    this.post = null; this.gfxKey = ''; this.envTex = null; this.envDirty = false; this.glossMats = []; this.reflectMeshes = [];

    this.players = new Map(); this.bullets = new Map(); this.barricades = new Map(); this.fx = [];
    this.dynMeshes = new Map(); this.shieldMeshes = new Map(); this.mineMeshes = new Map(); this.saws = []; this.laser = null; this.lavaMat = null;
    this.aimables = []; this.level = null; this.levelGroup = null; this.texCache = new Map();
    this.mouse = new THREE.Vector2(); this.ray = new THREE.Raycaster();
    this.yaw = 0; this.pitch = 0; this.shake = 0; this.hurtFlash = 0;
    this.bulletGeo = new THREE.SphereGeometry(1, 10, 8);
    this.parts = this.makeParts();   // v1.2.6: all burst particles in one instanced draw (see burst / syncParts)
    // v1.2.0 game feel: bullet trails (a cone behind each plain bullet), camera kick / zoom punch, smooth shake
    this.trailGeo = new THREE.CylinderGeometry(0.85, 0, 1, 8, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    this.glowPool = []; this.fxPool = []; this.bulletPool = [];   // v1.2.4: recycled effect objects
    this.trailMats = new Map(); this.camKick = new THREE.Vector3(); this.fpKick = 0; this.punchFx = null; this.shakeT = 0;
    this.settings = { fov: 60, view: 'third', effects: 'high', shadows: true, screenShake: true, sensitivity: 1 };

    // First-person blaster: drawn in its own overlay pass (after clearing depth) so it is always
    // visible and never pokes into walls. Kicks back when you shoot and bobs while you move.
    this.gunScene = new THREE.Scene();
    this.gunCam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 10);
    this.gunScene.add(new THREE.HemisphereLight(0xeef2ff, 0x40465a, 0.95));
    const gl = new THREE.DirectionalLight(0xffffff, 0.75); gl.position.set(0.6, 1, 0.8); this.gunScene.add(gl);
    this.blaster = buildViewGun('cube');
    this.viewGun = this.blaster.root;
    this.viewGun.position.set(0.19, -0.17, -0.52); this.viewGun.visible = false;
    this.gunScene.add(this.viewGun);
    this.gunRecoil = 0; this.gunBob = 0;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false; this.scene.add(this.marker);
    this.skyMarker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 24), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false }));
    this.skyMarker.rotation.x = -Math.PI / 2; this.skyMarker.visible = false; this.scene.add(this.skyMarker);

    addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('mousemove', e => { this.mouse.x = e.clientX / innerWidth * 2 - 1; this.mouse.y = -(e.clientY / innerHeight) * 2 + 1; });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== this.canvas || this.settings.view !== 'first' || this.lookFreeze) return;   // (v1.2.15: the emote wheel holds the view still)
      const k = 0.0022 * (this.settings.sensitivity || 1);
      this.yaw -= e.movementX * k;
      this.pitch = clamp(this.pitch - e.movementY * k, -1.4, 1.4);
    });
  }

  resize() {
    this.r.setSize(innerWidth, innerHeight);
    if (!this.applyPixelRatio() && this.post) this.post.resize();   // v1.2.6: the pixel budget depends on the window size (and the DPR of its monitor)
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.gunCam.aspect = innerWidth / innerHeight; this.gunCam.updateProjectionMatrix();
  }
  gunKick() { this.gunRecoil = 1; }
  // First-person gun follows your gun skin (Customize).
  setViewGun(skin, color) {
    if (this.blaster && this.blaster.skin === skin && (!color || this.blaster.color === color)) return;
    const vis = this.viewGun.visible, pos = this.viewGun.position.clone();
    this.gunScene.remove(this.viewGun);
    this.blaster = buildViewGun(skin || 'cube', color || '#ffffff');
    if (color) this.blaster.setColor(color);
    this.viewGun = this.blaster.root; this.viewGun.position.copy(pos); this.viewGun.visible = vis;
    this.gunScene.add(this.viewGun);
  }
  // Which player is under a screen point (normalized device coords; default = the mouse, or the crosshair in first person).
  playerAt(localId, ndc) {
    const m = ndc || (this.settings.view === 'first' ? new THREE.Vector2(0, 0) : this.mouse);
    this.ray.setFromCamera(m, this.camera);
    const meshes = [];
    for (const [id, e] of this.players) if (id !== localId && e.root.visible) meshes.push(...e.model.hitMeshes);
    if (!meshes.length) return null;
    const hit = this.ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    // walls in front of the player block the hover
    const wall = this.ray.intersectObjects(this.aimables, false)[0];
    if (wall && wall.distance < hit.distance - 0.2) return null;
    return hit.object.userData.player || null;
  }
  // Rebuild the arena (e.g. after the color-blind palette changes the height colors).
  refreshLevel() { if (this.level) this.setLevel(this.level); }
  // v1.2.6: a replaced level's GPU buffers and its own canvas textures are freed (they piled up match after match).
  // Kept: geometries shared with effects and models (sharedGeos, GEO), cached textures (only ones tagged perLevel
  // go), and all materials (see endFx).
  disposeLevel(root) {
    this._sharedG = null; const shared = this.sharedGeos(), tex = new Set();
    root.traverse(o => {
      const g = o.geometry; if (g && !shared.has(g) && !g.userData.keep) g.dispose();
      if (o.isInstancedMesh) o.dispose();
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) for (const t of [m.map, m.emissiveMap]) if (t && t.userData && t.userData.perLevel) tex.add(t);
    });
    for (const t of tex) t.dispose();
  }

  applySettings(s) {
    this.settings = { ...this.settings, ...s };
    this.camera.fov = this.settings.fov; this.camera.updateProjectionMatrix();
    this.sun.castShadow = !!this.settings.shadows;
    this.applyGraphics();
  }

  // ---------------- graphics options (lighting, shadows, reflections, post effects) ----------------
  // v1.2.16: the graphics card can drop WebGL (alt+tab out of fullscreen, a screenshot overlay, a driver reset). The
  // picture then froze on its last frame while the game, its sounds and the menus ran on. three.js re-uploads everything
  // when the browser hands the context back; when it doesn't within 2.5 s, the drawing surface is rebuilt on a fresh canvas.
  watchContext(canvas) {
    canvas.addEventListener('webglcontextlost', () => {
      clearTimeout(this.ctxT);
      this.ctxT = setTimeout(() => { this.ctxT = null; if (this.canvas === canvas && this.r.getContext().isContextLost()) this.rebuildGL(); }, 2500);
    }, false);
    canvas.addEventListener('webglcontextrestored', () => { clearTimeout(this.ctxT); this.afterGLReset(); }, false);
  }
  checkGL() {   // (main.js, when the window comes back)
    if (this.r.getContext().isContextLost() && !this.ctxT) this.ctxT = setTimeout(() => { this.ctxT = null; if (this.r.getContext().isContextLost()) this.rebuildGL(); }, 1500);
    this.resize();
  }
  rebuildGL() {
    const old = this.r, oc = old.domElement;
    const r = new THREE.WebGLRenderer({ antialias: this.ctxMSAA, powerPreference: 'high-performance' });
    r.setPixelRatio(old.getPixelRatio()); r.setSize(innerWidth, innerHeight);
    const setRT = r.setRenderTarget.bind(r);
    r.setRenderTarget = (t, ...rest) => {
      if (t && !t.deepDepth) { t.deepDepth = true; if (t.depthTexture) t.depthTexture.type = THREE.UnsignedIntType; else if (t.depthBuffer) t.stencilBuffer = true; }
      return setRT(t, ...rest);
    };
    for (const k of ['toneMapping', 'toneMappingExposure', 'outputEncoding', 'physicallyCorrectLights']) r[k] = old[k];
    r.shadowMap.enabled = old.shadowMap.enabled; r.shadowMap.type = old.shadowMap.type;
    const nc = r.domElement; nc.id = oc.id; nc.className = oc.className; nc.style.cssText = oc.style.cssText;
    // listeners added to the old canvas (here, main.js, amonui.js) keep working: its events are passed on to it
    for (const type of ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'wheel', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchmove', 'touchend'])
      nc.addEventListener(type, e => { if (type === 'contextmenu') e.preventDefault(); try { oc.dispatchEvent(new e.constructor(type, e)); } catch { /* skip */ } }, { passive: type !== 'contextmenu' && type !== 'wheel' });
    oc.replaceWith(nc);
    this.r = r; this.canvas = nc; this.pmrem = null;
    try { old.dispose(); } catch { /* lost anyway */ }
    this.watchContext(nc);
    this.afterGLReset();
    console.warn('[graphics] WebGL was lost and not given back: rebuilt the drawing surface');
  }
  afterGLReset() {
    if (this.post) { try { this.post.dispose(); } catch { /* lost */ } this.post = null; } this.freeOldPosts();
    this.gfxKey = ''; this.warmSig = null; this.needWarm = true; this.envDirty = true;
    try { this.applyGraphics(); } catch (err) { console.warn('[graphics reset]', err); }
    this.resize();
  }
  applyGraphics() {
    const s = this.settings, vivid = s.lighting !== 'classic', rtOn = s.raytracing === 'on' || s.raytracing === 'ultra';
    const refl = s.reflections === 'probe' || s.reflections === 'ssr' || rtOn;   // v27: ray tracing always uses the probe for bounce light
    this.hemi.color.set(vivid ? 0xd6e4ff : 0xdfe6ff); this.hemi.groundColor.set(vivid ? 0x564a3c : 0x3a4256);
    // the reflection probe also lights the scene with the level's own colors, so the sky light steps back
    // v26: bright themes (pale floors) and Ice Sheets get less light so they don't wash out (this.lightK, set per level)
    const lk = this.lightK || 1;
    this.hemi.intensity = (vivid ? 0.62 : 0.78) * (refl && this.envTex ? 0.72 : 1) * lk;
    this.sun.color.set(vivid ? 0xfff0dc : 0xffffff); this.sun.intensity = (vivid ? 0.9 : 0.62) * lk;
    this.rim.visible = vivid;
    const sh = this.sun.shadow;
    sh.bias = -0.0004; sh.normalBias = 0.03;   // v1.0.5: classic lighting too (no bias = shadow acne streaks)
    const res = { low: 1024, medium: 2048, high: 4096 }[s.shadowQ] || 2048;
    if (sh.mapSize.x !== res) { sh.mapSize.set(res, res); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    // v27: with an upscaler on, the canvas stays at full resolution and the upscaler picks the render share
    const upscale = UPSCALE[s.upscaler] || 1;
    this.applyPixelRatio();
    // reflections: a probe captured from the level gives every surface soft reflections and bounce light
    if (refl) { if (!this.envTex) this.envDirty = true; } else if (this.scene.environment) { this.scene.environment = null; }
    if (refl && this.envTex) this.scene.environment = this.envTex;
    this.applyGloss();
    const aa = s.aa || 'msaa';
    const cfg = { bloom: s.bloom || 'off', ao: !!s.ao || rtOn, ssr: s.reflections === 'ssr', aa, rt: rtOn ? s.raytracing : 'off', upscale, light: lk < 0.95 };
    const need = cfg.bloom !== 'off' || cfg.ao || cfg.ssr || rtOn || upscale < 1 || aa === 'fxaa' || aa === 'smaa' || aa === 'msaa8' || ((aa === 'msaa' || aa === 'ssaa') && !this.ctxMSAA);
    const key = need ? JSON.stringify(cfg) : '';
    if (key === this.gfxKey) return;
    this.gfxKey = key;
    // v1.2.17: the old effect chain is freed only after the new one has drawn a frame. Freeing it first deleted every
    // shader they share (three drops a shader when nothing uses it any more), so changing one setting compiled the
    // whole chain again: the big hitch on every small graphics change.
    const old = this.post; this.post = null;
    if (old) (this.oldPosts ||= []).push(old);
    if (!need) { this.freeOldPosts(); return; }
    const ticket = this.postTicket = (this.postTicket || 0) + 1;
    import('./post.js').then(({ buildPost }) => {
      if (ticket !== this.postTicket) return;
      this.post = buildPost(this.r, this.scene, this.camera, { ...cfg, selects: this.reflectMeshes, sun: this.sun });
      this.freeOldAfter = 2;
      this.needWarm = true;   // v1.2.8: the effect chain loads after the level when it changes: warm up its passes too (skipped if nothing changed)
    }).catch(e => { console.warn('[graphics] post effects unavailable', e); this.gfxKey = ''; });
  }
  freeOldPosts() { for (const p of this.oldPosts || []) { try { p.dispose(); } catch { /* already gone */ } } this.oldPosts = []; }
  // v1.2.6: drawing-buffer scale. Low / Medium / High cap the pixel count on high-DPI screens (never below the
  // window's own CSS resolution), and the in-match frame-time guard's load scale multiplies on top of everything.
  pixelRatio() {
    const s = this.settings, dpr = Math.min(devicePixelRatio || 1, 2), cap = PIXEL_CAP[s.gfxPreset];
    const base = cap ? Math.min(dpr, Math.max(Math.min(1, dpr), Math.sqrt(cap / Math.max(1, innerWidth * innerHeight)))) : dpr;
    // v1.2.17 supersampling (Anti-aliasing: SSAA): about twice the pixels each way, then scaled down, capped at ~8.3 MP
    const ss = s.aa === 'ssaa' ? Math.max(1, Math.min(2, Math.sqrt(8.3e6 / Math.max(1, innerWidth * innerHeight)) / Math.max(1, base))) : 1;
    return base * ss * (UPSCALE[s.upscaler] ? 1 : clamp(+s.renderScale || 1, 0.5, 1)) * this.loadScale;
  }
  applyPixelRatio() {   // true when the ratio changed (canvas and effect targets resized)
    const pr = this.pixelRatio();
    if (Math.abs(this.r.getPixelRatio() - pr) <= 1e-3) return false;
    this.r.setPixelRatio(pr); this.r.setSize(innerWidth, innerHeight); if (this.post) this.post.resize();
    return true;
  }
  // v1.2.6: k in [0.5, 1] scales the render resolution while frames run long (main.js); not a saved setting.
  setLoadScale(k) {
    k = clamp(+k || 1, 0.5, 1);
    if (Math.abs(k - this.loadScale) < 1e-3) return;
    this.loadScale = k; this.applyPixelRatio();
  }
  // Floors and block tops turn a little glossy while reflections are on.
  applyGloss() {
    const rt = this.settings.raytracing === 'on' || this.settings.raytracing === 'ultra';
    const on = this.settings.reflections === 'probe' || this.settings.reflections === 'ssr' || rt;
    for (const m of this.glossMats) {
      if (m.userData.baseRough == null) m.userData.baseRough = m.roughness;
      m.roughness = on ? Math.min(m.userData.baseRough, rt ? 0.4 : 0.55) : m.userData.baseRough;
    }
  }
  buildEnvProbe() {
    this.envDirty = false;
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.r);
    const rt = new THREE.WebGLCubeRenderTarget(128);
    const cam = new THREE.CubeCamera(0.3, 160, rt);
    const L = this.level; cam.position.set(0, L ? 5 : 6, 0);
    const fog = this.scene.fog; this.scene.fog = null; this.scene.environment = null;
    const vis = this.marker.visible; this.marker.visible = false;
    // v1.2.8: the probe sees only the level. Units, props and effects in it were frozen into the reflections, and each
    // was drawn there without fog (a shader variant nothing else uses), compiled mid-match on every Core Defense wave.
    const hid = this.scene.children.filter(o => o.visible && o !== this.levelGroup && !o.isLight); for (const o of hid) o.visible = false;
    for (const c of this.owCullObjs || []) c.o.visible = true;   // (re-culled for the camera before the next draw)
    const sm = this.r.shadowMap, au = sm.autoUpdate; sm.autoUpdate = false; sm.needsUpdate = true;   // v1.2.6: shadows drawn once for all six faces
    this.scene.add(cam); cam.update(this.r, this.scene); this.scene.remove(cam);
    sm.autoUpdate = au; this.scene.fog = fog; this.marker.visible = vis; for (const o of hid) o.visible = true;
    const tex = this.pmrem.fromCubemap(rt.texture).texture;
    rt.dispose();
    if (this.envTex) this.envTex.dispose();
    this.envTex = tex;
    this.applyGraphics();
  }

  // ---------------- level ----------------
  // Side stripes follow the real tier heights, so each stripe is exactly one jump.
  bandMaterial(theme, h, y0) {
    const key = `${theme.name}|${h.toFixed(2)}|${y0.toFixed(2)}`;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const T = RULES.tierHeights.concat([4.4, 5.6, 6.8, 8]);
    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const g = c.getContext('2d'), top = y0 + h, rowOf = y => (1 - (y - y0) / h) * 128;
    for (let k = 0; k < T.length - 1; k++) {
      const lo = Math.max(T[k], y0), hi = Math.min(T[k + 1], top);
      if (hi <= lo) continue;
      g.fillStyle = k % 2 ? theme.bandB : theme.bandA;
      g.fillRect(0, rowOf(hi), c.width, rowOf(lo) - rowOf(hi) + 1);
      if (T[k + 1] <= top + 1e-3) { g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(0, rowOf(T[k + 1]), c.width, 3); }
    }
    if (theme.style) this.stylePattern(g, theme, top, rowOf); else this.standardDetail(g, top, rowOf);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = theme.style ? THREE.LinearFilter : THREE.NearestFilter;
    if (theme.style) { tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = 2; }
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
    if (theme.style === 'neon') { m.emissiveMap = tex; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.75; }
    if (theme.style === 'volcano') { m.emissiveMap = tex; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.35; }
    this.texCache.set(key, m);
    return m;
  }
  // Experimental themes draw a texture pattern over the height stripes (stripes stay readable).
  stylePattern(g, theme, top, rowOf) {
    const W = g.canvas.width, H = g.canvas.height, rnd = (i) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
    g.save();
    if (theme.style === 'castle' && top >= 3) {          // timber-framed house wall
      g.globalAlpha = 0.85; g.fillStyle = '#efe6d2'; g.fillRect(0, 0, W, H);
      g.globalAlpha = 1; g.fillStyle = '#4a2f1c';
      for (const x of [0, W / 2 - 3, W - 6]) g.fillRect(x, 0, 6, H);
      for (let y = 0; y < H; y += 32) g.fillRect(0, y, W, 5);
      g.lineWidth = 5; g.strokeStyle = '#4a2f1c';
      for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(3, y + 32); g.lineTo(W / 2, y + 2); g.lineTo(W - 3, y + 32); g.stroke(); }
    } else if (theme.style === 'castle') {                // stone bricks
      g.strokeStyle = 'rgba(30,28,25,.55)'; g.lineWidth = 2;
      for (let r = 0, y = 0; y < H; r++, y += 12) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        for (let x = (r % 2) * 10; x < W; x += 20) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 12); g.stroke(); }
      }
    } else if (theme.style === 'western') {               // wooden planks
      g.strokeStyle = 'rgba(50,30,15,.6)'; g.lineWidth = 2;
      for (let y = 0; y < H; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.fillStyle = 'rgba(40,25,10,.5)';
      for (let i = 0; i < 18; i++) g.fillRect(Math.abs(rnd(i)) * W, Math.abs(rnd(i + 7)) * H, 2, 2);
    } else if (theme.style === 'forest') {               // mossy stone strata with lichen
      g.strokeStyle = 'rgba(30,32,22,.45)'; g.lineWidth = 1.5;
      for (let y = 6; y < H; y += 9 + Math.abs(rnd(y)) * 7) { g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 8) g.lineTo(x, y + Math.sin(x * 0.3 + y) * 1.5); g.stroke(); }
      for (let i = 0; i < 24; i++) { g.fillStyle = `rgba(${90 + (i % 3) * 10},${130 + (i % 4) * 8},60,.55)`; g.beginPath(); g.ellipse(Math.abs(rnd(i)) * W, rowOf(top) + Math.abs(rnd(i + 3)) * 14, 3 + Math.abs(rnd(i + 5)) * 6, 2 + Math.abs(rnd(i + 7)) * 3, 0, 0, 6.29); g.fill(); }
      for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(200,210,150,.35)'; g.fillRect(Math.abs(rnd(i + 11)) * W, Math.abs(rnd(i + 13)) * H, 2, 2); }
    } else if (theme.style === 'tundra') {               // frosted stone with a snow lip
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) { g.beginPath(); let x = Math.abs(rnd(i)) * W, y = Math.abs(rnd(i + 2)) * H; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (rnd(i * 7 + k) - 0.5) * 18; y += 6 + Math.abs(rnd(k + i)) * 8; g.lineTo(x, y); } g.stroke(); }
      for (let i = 0; i < 120; i++) { const y = Math.abs(rnd(i + 20)) * H; g.fillStyle = `rgba(255,255,255,${0.15 + 0.4 * (1 - y / H)})`; g.fillRect(Math.abs(rnd(i + 21)) * W, y, 1.5, 1.5); }
      const r0 = rowOf(top); g.fillStyle = '#f6f9fc'; g.fillRect(0, r0, W, 5);
      for (let x = 0; x < W; x += 6) { const d = 3 + Math.abs(rnd(x)) * 6; g.beginPath(); g.ellipse(x + 3, r0 + 5, 3, d, 0, 0, Math.PI); g.fill(); }
    } else if (theme.style === 'neon') {                 // dark panels with glowing trim
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, W, H);
      const [a, b] = theme.glow;
      for (const ty of RULES.tierHeights.slice(1).concat([4.4, 5.6, 6.8, 8])) { const row = rowOf(ty); if (row >= -2 && row <= H + 2) { g.fillStyle = a; g.fillRect(0, row - 1, W, 3); } }
      g.fillStyle = b; g.fillRect(0, 0, 2, H); g.fillRect(W - 2, 0, 2, H);
      g.fillStyle = 'rgba(255,255,255,.05)'; for (let y = 4; y < H; y += 8) g.fillRect(4, y, W - 8, 1);
    } else if (theme.style === 'sakura' && top >= 3) {   // shoji: paper panels in a dark wooden lattice
      g.globalAlpha = 0.88; g.fillStyle = '#f4ecdc'; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
      g.fillStyle = '#3d2419';
      for (const x of [0, W / 3 - 1, 2 * W / 3 - 1, W - 3]) g.fillRect(x, 0, 3, H);
      for (let y = 0; y < H; y += 21) g.fillRect(0, y, W, 2);
      g.fillRect(0, H - 14, W, 14);   // wooden skirting at the foot
    } else if (theme.style === 'sakura') {               // dark lacquered wood boards
      g.strokeStyle = 'rgba(20,10,5,.5)'; g.lineWidth = 1.5;
      for (let y = 0; y < H; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.fillStyle = 'rgba(255,220,180,.06)'; for (let i = 0; i < 30; i++) g.fillRect(Math.abs(rnd(i)) * W, Math.abs(rnd(i + 3)) * H, 10, 1);
    } else if (theme.style === 'tropical') {             // bamboo stalks with nodes
      for (let x = 0; x < W; x += 8) {
        g.fillStyle = (x / 8) % 2 ? 'rgba(90,70,25,.35)' : 'rgba(255,240,180,.12)'; g.fillRect(x, 0, 7, H);
        g.fillStyle = 'rgba(40,30,10,.5)'; g.fillRect(x + 7, 0, 1, H);
        for (let y = (x * 7) % 23; y < H; y += 23) { g.fillStyle = 'rgba(60,45,15,.55)'; g.fillRect(x, y, 7, 2); }
      }
    } else if (theme.style === 'lunar') {                // metal panels, rivets, hazard stripe at the foot of tall blocks
      g.strokeStyle = 'rgba(40,44,52,.55)'; g.lineWidth = 1.5;
      for (let y = 0; y < H; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
      g.fillStyle = 'rgba(30,32,38,.6)'; for (let y = 4; y < H; y += 32) for (const x of [4, W / 2 - 6, W / 2 + 4, W - 6]) g.fillRect(x, y, 2, 2);
      if (top >= 3) { for (let x = -16; x < W + 16; x += 16) { g.fillStyle = '#ffcc2a'; g.beginPath(); g.moveTo(x, H); g.lineTo(x + 8, H); g.lineTo(x + 16, H - 8); g.lineTo(x + 8, H - 8); g.fill(); } g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, H - 9, W, 1); }
    } else if (theme.style === 'volcano') {              // obsidian with glowing veins
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#ff6a1a'; g.lineWidth = 1.6; g.shadowColor = '#ff3a00'; g.shadowBlur = 4;
      for (let i = 0; i < 4; i++) { g.beginPath(); let x = Math.abs(rnd(i)) * W, y = 0; g.moveTo(x, y); while (y < H) { x += (rnd(i * 13 + y) - 0.5) * 14; y += 6 + Math.abs(rnd(y + i)) * 10; g.lineTo(x, y); } g.stroke(); }
      g.shadowBlur = 0;
    } else if (theme.style === 'candy') {                 // diagonal candy stripes
      g.globalAlpha = top >= 3 ? 0.9 : 0.35; g.fillStyle = top >= 3 ? '#e8283c' : '#ffffff';
      if (top >= 3) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H); g.fillStyle = '#e8283c'; }
      for (let x = -H; x < W + H; x += 24) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 12, H); g.lineTo(x + 12 + H, 0); g.lineTo(x + H, 0); g.fill(); }
    }
    g.restore();
  }
  // Standard themes: subtle panel seams, a few scuffs and a little grain over the height stripes.
  standardDetail(g, top, rowOf) {
    const W = g.canvas.width, H = g.canvas.height, rnd = i => Math.abs((Math.sin(i * 91.17) * 43758.5453) % 1);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, 1, H); g.fillRect(W - 1, 0, 1, H);
    g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(1, 0, 1, H);
    g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(W / 2, 0, 1, H);
    for (let i = 0; i < 160; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.04)'; g.fillRect(rnd(i + 1) * W, rnd(i + 2) * H, 1, 1); }
    for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(rnd(i + 30) * W * 0.7, rnd(i + 40) * H, 6 + rnd(i + 50) * 10, 1); }
    const y = rowOf(top) + 4; g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(4, y, 2, 2); g.fillRect(W - 6, y, 2, 2);
    const gr = g.createLinearGradient(0, 0, 0, H);   // grounded look: a touch lighter at the top, darker at the foot
    gr.addColorStop(0, 'rgba(255,255,255,.07)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.2)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, 0, W, 2);
  }
  floorTexture(theme) {
    const c = document.createElement('canvas'); c.width = c.height = 128 * TEX_K;   // v27: drawn at 2x for sharper shapes
    const g = c.getContext('2d'), rnd = (i) => Math.abs((Math.sin(i * 78.233) * 43758.5453) % 1); g.scale(TEX_K, TEX_K);
    g.fillStyle = theme.floor; g.fillRect(0, 0, 128, 128);
    if (theme.style === 'castle') {
      for (let i = 0; i < 40; i++) {
        const x = rnd(i) * 128, y = rnd(i + 99) * 128, r = 8 + rnd(i + 5) * 10, l = 0.85 + rnd(i + 3) * 0.3;
        g.fillStyle = `rgba(${Math.round(120 * l)},${Math.round(118 * l)},${Math.round(112 * l)},1)`;
        g.beginPath(); g.ellipse(x, y, r, r * 0.8, rnd(i) * 3, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(40,38,34,.5)'; g.lineWidth = 2; g.stroke();
      }
    } else if (theme.style === 'western') {
      for (let i = 0; i < 400; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(120,80,40,.25)' : 'rgba(255,240,200,.25)'; g.fillRect(rnd(i + 1) * 128, rnd(i + 2) * 128, 2, 2); }
    } else if (theme.style === 'candy') {
      g.fillStyle = '#ffffff'; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) g.fillRect(x * 32, y * 32, 32, 32);
    } else if (theme.style === 'forest') {                 // soil, leaf litter, moss and twigs
      for (let i = 0; i < 260; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(20,18,10,.25)' : 'rgba(120,110,70,.18)'; g.fillRect(rnd(i + 1) * 128, rnd(i + 2) * 128, 2, 2); }
      for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(${80 + (i % 3) * 12},${120 + (i % 2) * 18},50,.35)`; g.beginPath(); g.ellipse(rnd(i + 30) * 128, rnd(i + 31) * 128, 6 + rnd(i) * 12, 4 + rnd(i + 4) * 8, rnd(i) * 3, 0, 6.29); g.fill(); }
      const leaves = ['#8a5a2a', '#a8742f', '#6d4a24', '#94702c', '#5f6b2a'];
      for (let i = 0; i < 70; i++) { g.fillStyle = leaves[i % 5]; g.globalAlpha = 0.75; g.beginPath(); g.ellipse(rnd(i + 60) * 128, rnd(i + 61) * 128, 2.6, 1.3, rnd(i + 62) * 6, 0, 6.29); g.fill(); }
      g.globalAlpha = 1; g.strokeStyle = 'rgba(70,50,30,.6)'; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const x = rnd(i + 90) * 128, y = rnd(i + 91) * 128, a = rnd(i + 92) * 6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10); g.stroke(); }
    } else if (theme.style === 'tundra') {                 // soft snow with drifts and a little sparkle
      for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(160,185,210,${0.08 + rnd(i) * 0.08})`; g.beginPath(); g.ellipse(rnd(i + 3) * 128, rnd(i + 4) * 128, 10 + rnd(i + 5) * 20, 5 + rnd(i + 6) * 10, rnd(i) * 3, 0, 6.29); g.fill(); }
      for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(rnd(i + 40) * 128, rnd(i + 41) * 128, 1, 1); }
      for (let i = 0; i < 3; i++) { g.fillStyle = 'rgba(185,215,240,.35)'; g.beginPath(); g.ellipse(rnd(i + 70) * 128, rnd(i + 71) * 128, 12, 7, rnd(i) * 3, 0, 6.29); g.fill(); }
    } else if (theme.style === 'sakura') {                 // raked gravel: parallel ripples with a few stepping stones
      for (let i = 0; i < 500; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(90,85,75,.25)' : 'rgba(255,255,250,.35)'; g.fillRect(rnd(i + 1) * 128, rnd(i + 2) * 128, 1.5, 1.5); }
      g.strokeStyle = 'rgba(120,112,98,.45)'; g.lineWidth = 1.2;
      for (let y = 4; y < 128; y += 8) { g.beginPath(); for (let x = 0; x <= 128; x += 4) g.lineTo(x, y + Math.sin(x * 0.049 * Math.PI) * 1.2); g.stroke(); }
      g.fillStyle = '#9d988e'; g.strokeStyle = 'rgba(60,55,50,.6)';
      for (const [x, y, r] of [[30, 40, 9], [90, 96, 11]]) { g.beginPath(); g.ellipse(x, y, r, r * 0.8, 0.4, 0, 6.29); g.fill(); g.stroke(); }
      const pet = ['#ffb0cc', '#ffd0e0'];
      for (let i = 0; i < 16; i++) { g.fillStyle = pet[i % 2]; g.beginPath(); g.ellipse(rnd(i + 40) * 128, rnd(i + 41) * 128, 2, 1.2, rnd(i) * 3, 0, 6.29); g.fill(); }
    } else if (theme.style === 'tropical') {               // fine sand, shells, a few footprints
      for (let i = 0; i < 700; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(160,130,70,.22)' : 'rgba(255,250,230,.35)'; g.fillRect(rnd(i + 1) * 128, rnd(i + 2) * 128, 1.5, 1.5); }
      for (let i = 0; i < 5; i++) { g.fillStyle = ['#ffe6d6', '#f7c8b0', '#ffffff'][i % 3]; g.beginPath(); g.arc(rnd(i + 70) * 128, rnd(i + 71) * 128, 2.2, 0, 6.29); g.fill(); }
      g.fillStyle = 'rgba(150,120,70,.25)';
      for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(40 + i * 12, 70 + (i % 2) * 8, 2.5, 4.5, 0.3, 0, 6.29); g.fill(); }
    } else if (theme.style === 'lunar') {                  // regolith with little craters
      for (let i = 0; i < 600; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(40,40,46,.22)' : 'rgba(230,230,236,.18)'; g.fillRect(rnd(i + 1) * 128, rnd(i + 2) * 128, 1.5, 1.5); }
      for (let i = 0; i < 9; i++) {
        const x = rnd(i + 30) * 128, y = rnd(i + 31) * 128, r = 3 + rnd(i + 32) * 9;
        g.fillStyle = 'rgba(40,40,48,.35)'; g.beginPath(); g.arc(x, y, r, 0, 6.29); g.fill();
        g.strokeStyle = 'rgba(220,220,228,.35)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r, 3.6, 5.8); g.stroke();
      }
      g.fillStyle = 'rgba(30,30,36,.3)'; for (let i = 0; i < 5; i++) { const x = 20 + i * 22; g.fillRect(x, 60, 6, 3); g.fillRect(x + 3, 68, 6, 3); }   // boot prints
    } else if (theme.style === 'volcano') {                // basalt slabs with glowing cracks (emissive in setLevel)
      // v26: seamless. Every slab and crack is drawn 9 times (shifted by a whole tile) so the edges match up
      // and the tiles blend instead of showing a grid of seams. 256 px = 8 m, so it repeats less often too.
      c.width = c.height = 256; const T = 256;
      const wrap = f => { for (const ox of [-T, 0, T]) for (const oy of [-T, 0, T]) { g.save(); g.translate(ox, oy); f(); g.restore(); } };
      g.fillStyle = '#1b1517'; g.fillRect(0, 0, T, T);
      for (let i = 0; i < 46; i++) {
        const x = rnd(i) * T, y = rnd(i + 9) * T, l = 0.8 + rnd(i + 31) * 0.4;
        g.fillStyle = `rgb(${Math.round(56 * l)},${Math.round(45 * l)},${Math.round(47 * l)})`;
        const pts = []; for (let k = 0; k < 6; k++) { const a = k / 6 * 6.28 + rnd(i * 5 + k) * 0.6, r = 14 + rnd(i * 3 + k) * 12; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
        wrap(() => { g.beginPath(); for (const [px, py] of pts) g.lineTo(px, py); g.closePath(); g.fill(); g.strokeStyle = 'rgba(10,6,8,.55)'; g.lineWidth = 1.5; g.stroke(); });
      }
      g.strokeStyle = '#ff6a1a'; g.lineWidth = 1.3; g.shadowColor = '#ff2a00'; g.shadowBlur = 5;
      for (let i = 0; i < 12; i++) {
        const pts = []; let x = rnd(i + 60) * T, y = rnd(i + 61) * T; pts.push([x, y]);
        for (let k = 0; k < 6; k++) { x += (rnd(i * 7 + k) - 0.5) * 40; y += (rnd(i * 11 + k) - 0.5) * 40; pts.push([x, y]); }
        wrap(() => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke(); });
      }
      g.shadowBlur = 0;
    } else if (theme.style === 'neon') {                   // glowing synthwave grid (1 m cells, brighter every 4 m)
      const [a, b] = theme.glow;
      g.globalAlpha = 0.45; g.fillStyle = b; for (let k = 32; k < 128; k += 32) { g.fillRect(k, 0, 1, 128); g.fillRect(0, k, 128, 1); }
      g.globalAlpha = 1; g.fillStyle = a; g.fillRect(0, 0, 2, 128); g.fillRect(0, 0, 128, 2);
    } else {                                               // standard: 2 m panels, each a slightly different tone, worn seams,
      c.width = c.height = 256; g.fillStyle = theme.floor; g.fillRect(0, 0, 256, 256);   // corner rivets, grain and a few stains (8 m tile)
      for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
        const x = px * 64, y = py * 64, k = rnd(px * 7 + py * 13 + 1);
        g.fillStyle = k > 0.5 ? `rgba(255,255,255,${(k - 0.5) * 0.07})` : `rgba(0,0,0,${(0.5 - k) * 0.12})`; g.fillRect(x, y, 64, 64);
        const gr = g.createLinearGradient(x, y, x + 64, y + 64); gr.addColorStop(0, 'rgba(255,255,255,.025)'); gr.addColorStop(1, 'rgba(0,0,0,.05)');
        g.fillStyle = gr; g.fillRect(x, y, 64, 64);
        g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, y, 64, 1); g.fillRect(x, y, 1, 64);
        g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x, y + 1, 64, 1); g.fillRect(x + 1, y, 1, 64);
        g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(x + 2, y + 2, 60, 2); g.fillRect(x + 2, y + 2, 2, 60);   // worn edge just inside the seam
        for (const [rx, ry] of [[5, 5], [58, 5], [5, 58], [58, 58]]) { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + rx, y + ry, 2, 2); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + rx, y + ry, 1, 1); }
      }
      for (let i = 0; i < 1400; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.04)'; g.fillRect(rnd(i + 1) * 256, rnd(i + 2) * 256, 1, 1); }
      for (let i = 0; i < 7; i++) {   // soft stains
        const x = rnd(i + 50) * 256, y = rnd(i + 51) * 256, r = 8 + rnd(i + 52) * 18, gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(0,0,0,.09)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
      for (let i = 0; i < 12; i++) { const x = rnd(i + 20) * 256, y = rnd(i + 21) * 256; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + rnd(i) * 12, y + (rnd(i + 3) - 0.5) * 5); g.stroke(); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData = { meters: 8, perLevel: true };
      t.anisotropy = 4;
      return t;
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData = { perLevel: true };   // v1.2.6: freed with its level (disposeLevel)
    if (theme.style === 'volcano') { t.userData.meters = 8; t.anisotropy = 4; }
    return t;
  }
  // Platform tops: themed surface (stone, planks, frosting, moss, snow, glass) with only a slight tint toward the
  // height color; the bright edge line still carries the exact height. Standard themes get a faint bevel.
  topTexture(theme) {
    const key = 'top|' + theme.name;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const c = document.createElement('canvas'); c.width = c.height = 64 * TEX_K;
    const g = c.getContext('2d'), rnd = i => Math.abs((Math.sin(i * 51.7) * 43758.5453) % 1), st = theme.style; g.scale(TEX_K, TEX_K);
    g.fillStyle = st ? theme.top : '#f2f2f2'; g.fillRect(0, 0, 64, 64);
    if (!st) {
      for (let i = 0; i < 120; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.5)'; g.fillRect(rnd(i + 1) * 64, rnd(i + 2) * 64, 1, 1); }
      const gr = g.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.08)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; g.strokeRect(3, 3, 58, 58);
      g.strokeStyle = 'rgba(0,0,0,.07)'; g.lineWidth = 1; g.strokeRect(9.5, 9.5, 45, 45);
      for (const [x, y] of [[7, 7], [56, 7], [7, 56], [56, 56]]) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, y, 2, 2); }
      g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, 63, 63);
    } else if (st === 'castle') {
      g.strokeStyle = 'rgba(40,36,30,.5)'; g.lineWidth = 1.5;
      for (let y = 0; y < 64; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y); g.stroke(); for (let x = (y / 16 % 2) * 12; x < 64; x += 24) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); } }
    } else if (st === 'western') {
      g.strokeStyle = 'rgba(60,35,15,.55)'; g.lineWidth = 1.5;
      for (let y = 0; y < 64; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y); g.stroke(); g.fillStyle = 'rgba(40,25,10,.5)'; g.fillRect(4 + (y % 16) * 2, y + 3, 2, 2); }
    } else if (st === 'candy') {
      const cols = ['#ff5fa8', '#5fd8ff', '#ffe066', '#8cff8c'];
      for (let i = 0; i < 40; i++) { g.save(); g.translate(rnd(i) * 64, rnd(i + 5) * 64); g.rotate(rnd(i + 9) * 3); g.fillStyle = cols[i % 4]; g.fillRect(-3, -1, 6, 2); g.restore(); }
    } else if (st === 'forest') {
      for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${40 + (i % 5) * 18},${90 + (i % 7) * 12},${30 + (i % 3) * 8},.6)`; g.fillRect(rnd(i) * 64, rnd(i + 1) * 64, 2, 3); }
      for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(30,50,20,.35)'; g.beginPath(); g.arc(rnd(i + 30) * 64, rnd(i + 31) * 64, 4 + rnd(i) * 5, 0, 6.29); g.fill(); }
      g.strokeStyle = 'rgba(25,40,15,.35)'; g.lineWidth = 2; g.strokeRect(1, 1, 62, 62);
    } else if (st === 'tundra') {
      for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(170,195,220,.18)'; g.beginPath(); g.ellipse(rnd(i) * 64, rnd(i + 1) * 64, 8 + rnd(i + 2) * 10, 4 + rnd(i + 3) * 5, 0, 0, 6.29); g.fill(); }
      for (let i = 0; i < 40; i++) { g.fillStyle = '#ffffff'; g.fillRect(rnd(i + 20) * 64, rnd(i + 21) * 64, 1, 1); }
    } else if (st === 'sakura') {   // tatami: woven straw with a dark cloth border
      g.fillStyle = '#d6cc98'; g.fillRect(0, 0, 64, 64);
      for (let y = 0; y < 64; y += 2) { g.fillStyle = y % 4 ? 'rgba(120,110,60,.18)' : 'rgba(255,255,220,.15)'; g.fillRect(0, y, 64, 1); }
      g.fillStyle = '#2e3a2a'; g.fillRect(0, 0, 64, 5); g.fillRect(0, 59, 64, 5);
    } else if (st === 'tropical') { // bamboo slats
      for (let x = 0; x < 64; x += 8) { g.fillStyle = (x / 8) % 2 ? 'rgba(120,90,40,.25)' : 'rgba(255,245,200,.2)'; g.fillRect(x, 0, 7, 64); g.fillStyle = 'rgba(70,50,20,.5)'; g.fillRect(x + 7, 0, 1, 64); g.fillRect(x, (x * 5) % 40 + 10, 7, 2); }
    } else if (st === 'lunar') {    // metal floor grate
      g.fillStyle = 'rgba(40,44,52,.35)'; for (let k = 4; k < 64; k += 6) { g.fillRect(k, 4, 2, 56); }
      g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 2; g.strokeRect(2, 2, 60, 60);
      g.fillStyle = 'rgba(30,30,36,.6)'; for (const [x, y] of [[5, 5], [57, 5], [5, 57], [57, 57]]) g.fillRect(x, y, 2, 2);
    } else if (st === 'volcano') {  // cracked basalt with faint embers
      for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(20,12,12,.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(rnd(i) * 64, 0); g.lineTo(rnd(i + 3) * 64, 32); g.lineTo(rnd(i + 5) * 64, 64); g.stroke(); }
      for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(255,110,40,.6)'; g.fillRect(rnd(i + 20) * 64, rnd(i + 21) * 64, 1.5, 1.5); }
    } else if (st === 'neon') {
      g.fillStyle = 'rgba(255,255,255,.05)'; for (let k = 8; k < 64; k += 8) { g.fillRect(k, 0, 1, 64); g.fillRect(0, k, 64, 1); }
      g.strokeStyle = theme.glow[1]; g.lineWidth = 2; g.strokeRect(3, 3, 58, 58);
    }
    const t = new THREE.CanvasTexture(c);
    this.texCache.set(key, t);
    return t;
  }
  // Arena walls (standard themes): 2 m panels with seams, a light cap line and darker foot. One texture per theme;
  // each wall gets its own repeat so panels stay 2 m wide however long the wall is.
  wallTexture(theme) {
    const key = 'wall|' + theme.name;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const c = document.createElement('canvas'); c.width = 64 * TEX_K; c.height = 64 * TEX_K;
    const g = c.getContext('2d'), rnd = i => Math.abs((Math.sin(i * 33.1) * 43758.5453) % 1); g.scale(TEX_K, TEX_K);
    g.fillStyle = theme.wall; g.fillRect(0, 0, 64, 64);
    const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, 'rgba(255,255,255,.1)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.25)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, 0, 1, 64); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(1, 0, 1, 64);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, 0, 64, 2);
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 40, 64, 1);
    for (let i = 0; i < 220; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(0,0,0,.08)' : 'rgba(255,255,255,.04)'; g.fillRect(rnd(i + 1) * 64, rnd(i + 2) * 64, 1, 1); }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.userData = { panel: true };
    this.texCache.set(key, t);
    return t;
  }
  wallMatFor(base, len) {
    if (!base.map || !(base.map.userData && base.map.userData.panel)) return base;
    const m = base.clone(); m.map = base.map.clone(); m.map.needsUpdate = true; m.map.repeat.x = Math.max(1, Math.round(len / 2)); m.map.userData = { perLevel: true }; return m;
  }
  // Soft dark contact shadow where blocks meet the floor (one shared texture, a flat quad per block; v1.2.6: all of a
  // level's quads are one instanced mesh per strength, walls 0.3 and blocks 0.42).
  contactTex() {
    if (this._contactTex) return this._contactTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.filter = 'blur(6px)'; g.fillStyle = '#000'; g.fillRect(14, 14, 36, 36);
    return (this._contactTex = new THREE.CanvasTexture(c));
  }
  addContacts(G, list) {   // list: [x, z, w, d, strength]
    this.contactMat ||= new THREE.MeshBasicMaterial({ map: this.contactTex(), transparent: true, depthWrite: false, opacity: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.contactGeo ||= new THREE.PlaneGeometry(1, 1);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const k of [0.3, 0.42]) {
      const L = list.filter(c => c[4] === k); if (!L.length) continue;
      const mat = k === 0.42 ? this.contactMat : (this.contactMatWall ||= Object.assign(this.contactMat.clone(), { opacity: k / 0.42 }));
      const im = new THREE.InstancedMesh(this.contactGeo, mat, L.length);
      L.forEach(([x, z, w, d], i) => im.setMatrixAt(i, M.compose(p.set(x, 0.008, z), q, sc.set((w + 0.9) * 64 / 36, (d + 0.9) * 64 / 36, 1))));   // texture's dark core is the middle 36 px
      im.frustumCulled = false; im.renderOrder = -0.5; G.add(im);
    }
  }
  // Lava Lake floor: dark crust plates with glowing cracks; drifts slowly (updateHazards) on top of the pulse.
  lavaTexture() {
    if (this._lavaTex) return this._lavaTex;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), rnd = i => Math.abs((Math.sin(i * 12.345) * 43758.5453) % 1);
    g.fillStyle = '#e8460c'; g.fillRect(0, 0, 256, 256);
    const gr = g.createRadialGradient(128, 128, 20, 128, 128, 180); gr.addColorStop(0, '#ff8a1e'); gr.addColorStop(1, '#e0400a');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    // crust plates: jittered cells, drawn wrapped so the tile repeats seamlessly
    const pts = []; for (let i = 0; i < 13; i++) pts.push([rnd(i) * 256, rnd(i + 40) * 256]);
    for (let i = 0; i < pts.length; i++) {
      const [px, py] = pts[i], r = 26 + rnd(i + 80) * 18, n = 8;
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) {
        g.beginPath();
        for (let k = 0; k < n; k++) { const a = k / n * 6.283 + rnd(i * 9 + k) * 0.5, rr = r * (0.7 + rnd(i * 5 + k) * 0.4); const x = px + ox + Math.cos(a) * rr, y = py + oy + Math.sin(a) * rr; k ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.closePath(); g.fillStyle = `rgba(${70 + (i % 4) * 10},${22 + (i % 3) * 5},10,0.6)`; g.fill();
        g.strokeStyle = 'rgba(255,190,80,.25)'; g.lineWidth = 3; g.stroke();
      }
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,220,150,.45)'; g.fillRect(rnd(i + 200) * 256, rnd(i + 300) * 256, 2, 2); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return (this._lavaTex = t);
  }
  crateTex() {
    if (this._crateTex) return this._crateTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 1);
    g.fillStyle = 'rgba(255,255,255,.12)'; for (let y = 1; y < 64; y += 16) g.fillRect(0, y, 64, 1);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(0, 0, 64, 6); g.fillRect(0, 58, 64, 6); g.fillRect(0, 0, 6, 64); g.fillRect(58, 0, 6, 64);   // frame boards
    g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 6; g.beginPath(); g.moveTo(6, 58); g.lineTo(58, 6); g.stroke();             // diagonal brace
    for (let i = 0; i < 90; i++) { g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(Math.random() * 64, Math.random() * 64, 3, 1); }
    for (const [x, y] of [[3, 3], [60, 3], [3, 60], [60, 60]]) { g.fillStyle = 'rgba(30,30,30,.6)'; g.fillRect(x - 1, y - 1, 2, 2); }
    return (this._crateTex = new THREE.CanvasTexture(c));
  }
  barrelTex() {
    if (this._barrelTex) return this._barrelTex;
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 64, 64);
    for (let x = 0; x < 64; x += 8) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(x, 0, 3, 64); }
    g.fillStyle = 'rgba(0,0,0,.35)'; for (const y of [6, 30, 54]) g.fillRect(0, y, 64, 4);   // rolled ribs
    g.fillStyle = 'rgba(255,255,255,.2)'; for (const y of [5, 29, 53]) g.fillRect(0, y, 64, 1);
    g.fillStyle = 'rgba(255,220,80,.55)'; g.fillRect(20, 14, 24, 10);   // a little warning label
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(30, 16, 4, 6);
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return (this._barrelTex = t);
  }
  speckleTex() {
    if (this._speckle) return this._speckle;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 500; i++) { const v = Math.random(); g.fillStyle = v > 0.5 ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.5)'; g.fillRect(Math.random() * 64, Math.random() * 64, 1 + (v > 0.9), 1); }
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(0,0,0,.12)'; g.beginPath(); g.arc(Math.random() * 64, Math.random() * 64, 1.5, 0, 6.3); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return (this._speckle = t);
  }
  topMaterials(theme) {
    const tex = this.topTexture(theme), st = theme.style;
    return ART.tierColors.map(tc => {
      const color = st ? new THREE.Color(0xffffff).lerp(new THREE.Color(tc), 0.16) : new THREE.Color(theme.top).lerp(new THREE.Color(tc), 0.3).multiplyScalar(0.88);
      const m = new THREE.MeshStandardMaterial({ color, map: tex, roughness: st === 'tundra' ? 0.75 : 0.6 });
      if (st === 'neon') { m.emissiveMap = tex; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.6; }
      return m;
    });
  }
  addSkybox(theme, G, noSun = false) {
    const [top, bottom] = theme.sky;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: (noSun ? '#define SUNK 0.0\n' : '#define SUNK 1.0\n') + 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float k = smoothstep(-0.1, 0.6, vP.y); vec3 c = mix(bottom, top, k); float sun = SUNK * pow(max(0.0, dot(vP, normalize(vec3(0.5,0.35,-0.8)))), 60.0); gl_FragColor = vec4(c + vec3(1.0,0.95,0.8)*sun, 1.0); }',
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), mat);
    sky.renderOrder = -1; G.add(sky);
  }
  // Themed decorations for the experimental themes (no collision). Wall dressing follows the arena edges,
  // so it works for rectangles and polygons alike.
  addStyleProps(level, theme, G) {
    const rng = this.levelRng(level, 0x2545F491);
    const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
    const add = (m, x, y, z) => { m.position.set(x, y, z); m.castShadow = true; G.add(m); return m; };
    const hx = level.hx, hz = level.hz, E = arenaEdges(level), st = theme.style;
    const along = (e, step, f) => { const n = Math.max(1, Math.floor(e.len / step)); for (let i = 0; i <= n; i++) { const t = (i + 0.5) / (n + 1); f(e.ax + (e.bx - e.ax) * t, e.az + (e.bz - e.az) * t, t); } };
    const faceY = e => Math.atan2(e.nx, e.nz);   // rotation that turns a +z-facing plane toward the arena
    const wallY = e => -Math.atan2(e.bz - e.az, e.bx - e.ax);
    const nearEdge = e => -e.nz > 0.3;
    // spots outside the arena (beyond the walls), away from the camera side
    const outside = (n, d0, d1) => {
      const out = [];
      for (const e of E) { if (nearEdge(e)) continue; along(e, 3.2 + rng() * 1.5, (x, z) => { const d = d0 + rng() * (d1 - d0); if (z - e.nz * d < -hz * 0.05) out.push({ x: x - e.nx * d + (rng() - 0.5), z: z - e.nz * d, e }); }); }
      if (level.poly) for (let i = 0; i < n; i++) {   // fill the big empty corners around polygons
        const x = (rng() * 2 - 1) * (hx + 4), z = -hz - 4 + rng() * (hz * 1.3 + 4);
        if (z > -hz * 0.1) continue;
        if (edgeDistance(E, x, z) < -2) out.push({ x, z, e: null });
      }
      return out;
    };
    if (st === 'castle') {
      const [c1, c2] = theme.banner, cloth = new THREE.MeshStandardMaterial({ color: c1, side: THREE.DoubleSide, roughness: 0.9 }), trim = M(c2), stone = M(theme.wall);
      const banner = (x, y, z, ry) => {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.6), cloth); b.position.y = -0.8; g.add(b);
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.6), new THREE.MeshStandardMaterial({ color: c2, side: THREE.DoubleSide })); stripe.position.set(0, -0.8, 0.005); g.add(stripe);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), trim); rod.rotation.z = Math.PI / 2; g.add(rod);
        g.position.set(x, y, z); g.rotation.y = ry; G.add(g);
      };
      for (const e of E) {
        const h = this.edgeWallH(level, theme, e);
        if (h >= 2.5) along(e, 7, (x, z) => banner(x + e.nx * 0.01, h - 0.2, z + e.nz * 0.01, faceY(e)));
        along(e, 1.6, (x, z) => { const m = add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 1), stone), x - e.nx * 0.25, h + 0.3, z - e.nz * 0.25); m.rotation.y = wallY(e) + Math.PI / 2; });   // battlements
      }
      for (const b of level.boxes) if (!b.wall && b.y0 + b.h >= 3 && rng() < 0.7) banner(b.x, b.y0 + b.h - 0.2, b.z + b.d / 2 + 0.02, 0);
    } else if (st === 'western') {
      const green = M(0x4f8a3a);
      for (const sp of this.edgeSpots(level, Math.round((hx + hz) / 4), rng, [0.5, 0.8], e => !nearEdge(e))) {
        const h = 1.2 + rng() * 0.9, g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, h, 8), green)); g.children[0].position.y = h / 2;
        for (const s of [-1, 1]) if (rng() < 0.8) {
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.45, 6), green); arm.position.set(s * 0.25, h * 0.55, 0); arm.rotation.z = s * Math.PI / 2; g.add(arm);
          const up = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 6), green); up.position.set(s * 0.45, h * 0.55 + 0.2, 0); g.add(up);
        }
        g.position.set(sp.x, 0, sp.z); G.add(g);
      }
    } else if (st === 'candy') {
      const cols = [0xff5fa8, 0x5fd8ff, 0xffe066, 0x8cff8c];
      this.edgeSpots(level, Math.round((hx + hz) / 3), rng, [0.6, 0.9], e => !nearEdge(e)).forEach((sp, i) => {
        if (rng() < 0.5) {   // lollipop
          const g = new THREE.Group(), h = 1.2 + rng() * 0.8;
          const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, h, 6), M(0xffffff)); stick.position.y = h / 2; g.add(stick);
          const pop = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 20), M(cols[i % 4])); pop.rotation.x = Math.PI / 2; pop.position.y = h + 0.3; g.add(pop);
          g.position.set(sp.x, 0, sp.z); G.add(g);
        } else add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(cols[(i + 1) % 4])), sp.x, 0, sp.z); // gumdrop
      });
    } else if (st === 'forest') {
      // Trees ring the arena outside the low banks; the two nearest the back carry a Bear's Head Tooth
      // cascading off the trunk toward the arena.
      const spots = outside(Math.round((hx + hz) / 2), 1.6, 4.5);
      const back = spots.filter(p => p.e && p.e.nz > 0.4).sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
      const hericium = new Set(back.filter((p, i) => i % 3 === 0).slice(0, 2));
      for (const p of spots) {
        if (rng() < 0.18 && !hericium.has(p)) { const b = makeBush(rng, '#3d6a2a'); b.position.set(p.x, 0, p.z); G.add(b); continue; }
        const face = p.e ? Math.atan2(p.e.nz, p.e.nx) : Math.atan2(-p.z, -p.x);
        const t = makeTree(rng, { bark: theme.bark, leaf: '#3f6b2c', hericium: hericium.has(p), face, hericiumY: 1.9 + rng() * 0.4 });
        t.position.set(p.x, 0, p.z); G.add(t);
        if (rng() < 0.4) { const m = mushroomPatch(rng); m.position.set(p.x + Math.cos(face) * 0.7, 0, p.z + Math.sin(face) * 0.7); G.add(m); }
      }
      // ferns and bushes on the low banks' inner side
      for (const sp of this.edgeSpots(level, Math.round((hx + hz) * 0.7), rng, [0.4, 1.0])) {
        const f = rng() < 0.7 ? makeFern(rng, rng() < 0.5 ? '#4f8a35' : '#5d9a3e') : makeBush(rng, '#456f2e');
        f.position.set(sp.x, 0, sp.z); f.scale.setScalar(0.8 + rng() * 0.5); G.add(f);
      }
      // small mushrooms on the forest floor: at block bases and the ends of logs
      for (const b of level.boxes) {
        if (b.wall || b.y0 > 0 || rng() > 0.5) continue;
        const sd = rng() * 4 | 0, t = rng() - 0.5;
        const x = sd < 2 ? b.x + t * b.w : b.x + (sd === 2 ? 1 : -1) * (b.w / 2 + 0.15), z = sd < 2 ? b.z + (sd ? 1 : -1) * (b.d / 2 + 0.15) : b.z + t * b.d;
        const m = mushroomPatch(rng); m.position.set(x, 0, z); G.add(m);
      }
      for (const b of this.forestLogs || []) {
        const alongX = b.w >= b.d, L = Math.max(b.w, b.d) / 2 + 0.25;
        for (const s of [-1, 1]) if (rng() < 0.6) { const m = mushroomPatch(rng); m.position.set(b.x + (alongX ? s * L : 0), 0, b.z + (alongX ? 0 : s * L)); G.add(m); }
      }
      // oyster mushrooms on a couple of tree stumps near the walls
      for (const sp of this.edgeSpots(level, 2, rng, [0.8, 1.0], e => !nearEdge(e))) {
        const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.55, 10), new THREE.MeshStandardMaterial({ color: theme.bark, roughness: 0.95 }));
        stump.position.set(sp.x, 0.27, sp.z); stump.castShadow = true; G.add(stump);
        const o = oysterCluster(rng, 1.1); o.position.set(sp.x + sp.e.nx * 0.33, 0.3, sp.z + sp.e.nz * 0.33); o.rotation.y = Math.atan2(sp.e.nx, sp.e.nz); G.add(o);
      }
    } else if (st === 'tundra') {
      for (const p of outside(Math.round((hx + hz) / 2), 1.6, 5)) { const t = makePine(rng, true); t.position.set(p.x, 0, p.z); t.scale.setScalar(0.85 + rng() * 0.4); G.add(t); }
      for (const sp of this.edgeSpots(level, Math.round((hx + hz) / 2.5), rng, [0.4, 0.9])) {
        const m = rng() < 0.45 ? iceCrystal(rng) : snowDrift(rng);
        m.position.set(sp.x, 0, sp.z); if (sp.e) m.rotation.y = -Math.atan2(sp.e.bz - sp.e.az, sp.e.bx - sp.e.ax); G.add(m);
      }
    } else if (st === 'sakura') {
      // cherry trees and bamboo outside, a torii gate at the back, stone lanterns along the inside of the walls
      for (const p of outside(Math.round((hx + hz) / 2), 1.8, 5)) {
        const t = rng() < 0.75 ? makeCherryTree(rng) : bambooClump(rng);
        t.position.set(p.x, 0, p.z); t.scale.setScalar(0.9 + rng() * 0.35); G.add(t);
      }
      const back = E.filter(e => e.nz > 0.6).sort((a, b) => b.len - a.len)[0];
      if (back) { const t = makeTorii(4.4, 4.4); const mx = (back.ax + back.bx) / 2, mz = (back.az + back.bz) / 2; t.position.set(mx - back.nx * 2.2, 0, mz - back.nz * 2.2); t.rotation.y = faceY(back); G.add(t); }
      for (const sp of this.edgeSpots(level, Math.round((hx + hz) / 5), rng, [0.55, 0.8], e => !nearEdge(e))) { const l = stoneLantern(rng); l.position.set(sp.x, 0, sp.z); G.add(l); }
      // falling petals drifting down over the arena (static flakes; cheap)
      const pm = new THREE.PointsMaterial({ color: 0xffc0d8, size: 0.12 }), n = 160, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (rng() * 2 - 1) * (hx + 3); pos[i * 3 + 1] = 0.5 + rng() * 7; pos[i * 3 + 2] = (rng() * 2 - 1) * (hz + 3); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, pm); pts.userData.drift = 'petals'; G.add(pts); this.driftPts = pts;
    } else if (st === 'tropical') {
      const sea = seaPlane(400); sea.position.y = -0.06; G.add(sea); this.seaTex = sea.userData.sea;
      for (const p of outside(Math.round((hx + hz) / 2.2), 1.6, 5)) { const t = makePalm(rng); t.position.set(p.x, 0, p.z); t.rotation.y = rng() * 6.28; G.add(t); }
      for (const sp of this.edgeSpots(level, Math.round((hx + hz) / 5), rng, [0.5, 0.75], e => !nearEdge(e))) { const t = tikiTorch(rng); t.position.set(sp.x, 0, sp.z); G.add(t); }
      for (const p of outside(4, 2.5, 4).slice(0, 4)) { const u = beachUmbrella(rng); u.position.set(p.x, 0, p.z); u.rotation.y = rng() * 6.28; G.add(u); }
      // a sandy apron around the arena so it reads as an island on the sea
      const sand = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 + 16, hz * 2 + 16), new THREE.MeshStandardMaterial({ map: this.floorTexture(theme), roughness: 0.95 }));
      sand.material.map.repeat.set((hx * 2 + 16) / 4, (hz * 2 + 16) / 4); sand.rotation.x = -Math.PI / 2; sand.position.y = -0.03; sand.receiveShadow = true; G.add(sand);
    } else if (st === 'lunar') {
      G.add(starField());
      const earth = planetDisc(); earth.scale.setScalar(46); earth.position.set(-40, 48, -160); G.add(earth);
      for (const p of outside(Math.round((hx + hz) / 2.5), 1.5, 6)) {
        const k = rng(), m = k < 0.45 ? crater(rng, 0.8 + rng() * 1.6) : k < 0.8 ? moonRock(rng) : k < 0.92 ? satDish(rng) : moduleHab(rng);
        m.position.set(p.x, 0, p.z); G.add(m);
      }
      for (const sp of this.edgeSpots(level, Math.round((hx + hz) / 4), rng, [0.5, 1.0])) { const c = crater(rng, 0.35 + rng() * 0.4); c.position.set(sp.x, 0, sp.z); G.add(c); }
      const regolith = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 + 60, hz * 2 + 60), new THREE.MeshStandardMaterial({ map: this.floorTexture(theme), roughness: 1 }));
      regolith.material.map.repeat.set((hx * 2 + 60) / 4, (hz * 2 + 60) / 4); regolith.rotation.x = -Math.PI / 2; regolith.position.y = -0.03; regolith.receiveShadow = true; G.add(regolith);
    } else if (st === 'volcano') {
      for (const p of outside(Math.round((hx + hz) / 2), 1.6, 6)) {
        const m = rng() < 0.55 ? obsidianSpire(rng) : lavaPool(rng, 1 + rng() * 1.8);
        m.position.set(p.x, 0, p.z); G.add(m);
      }
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 + 60, hz * 2 + 60), new THREE.MeshStandardMaterial({ map: this.floorTexture(theme), roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0.3 }));
      ground.material.emissiveMap = ground.material.map; ground.material.map.repeat.set((hx * 2 + 60) / 4, (hz * 2 + 60) / 4);
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; G.add(ground);
      // a distant erupting cone with a glow
      const cone = new THREE.Mesh(new THREE.ConeGeometry(38, 30, 9, 1, true), new THREE.MeshStandardMaterial({ color: 0x1c1416, flatShading: true, fog: false }));
      cone.position.set(30, 10, -150); G.add(cone);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(9, 16), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.85, fog: false })); glow.position.set(30, 25.5, -150); G.add(glow);
      // embers floating over the arena
      const n = 140, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = (rng() * 2 - 1) * (hx + 3); pos[i * 3 + 1] = 0.3 + rng() * 6; pos[i * 3 + 2] = (rng() * 2 - 1) * (hz + 3); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff8a3a, size: 0.09 })); pts.userData.drift = 'embers'; G.add(pts); this.driftPts = pts;
    } else if (st === 'neon') {
      for (const sp of this.edgeSpots(level, Math.round((hx + hz) / 3), rng, [0.5, 0.7], e => !nearEdge(e))) { const p = neonPylon(rng, rng() < 0.5 ? theme.glow[0] : theme.glow[1]); p.position.set(sp.x, 0, sp.z); G.add(p); }
      // a striped synthwave sun low in the sky
      const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#ffe26a'); gr.addColorStop(1, '#ff3d9a'); g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 126, 0, 6.29); g.fill();
      g.globalCompositeOperation = 'destination-out'; for (let k = 0; k < 7; k++) g.fillRect(0, 150 + k * 15, 256, 3 + k * 1.2);
      const sun = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, fog: false, depthWrite: false }));
      sun.material.map.userData = { perLevel: true }; sun.position.set(0, 18, -170); G.add(sun);
    }
  }

  tierOf(top) { const T = RULES.tierHeights; return top <= T[1] + 0.25 ? 0 : top <= T[2] + 0.25 ? 1 : 2; }

  // Height of the visible wall along an arena edge: low on the camera side, low banks in the forest.
  edgeWallH(level, theme, e) {
    if (theme.style === 'forest') return 0.9;
    if (-e.nz > 0.3) return 1.2;                // edge on the near (camera) side
    return level.poly ? 2.6 : 3.5;
  }
  levelRng(level, salt) {
    let a = (level.seed ^ salt) >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  // Points just inside the arena edges (inset meters in), with the edge they belong to. filter(e) picks edges.
  edgeSpots(level, n, rng, inset = [0.35, 0.85], filter = null) {
    const E = arenaEdges(level).filter(e => !filter || filter(e)), total = E.reduce((a, e) => a + e.len, 0), out = [];
    if (!E.length) return out;
    for (let i = 0; i < n; i++) {
      let r = rng() * total, e = E[0];
      for (const q of E) { r -= q.len; if (r <= 0) { e = q; break; } }
      const t = 0.03 + rng() * 0.94, d = inset[0] + rng() * (inset[1] - inset[0]);
      out.push({ x: e.ax + (e.bx - e.ax) * t + e.nx * d, z: e.az + (e.bz - e.az) * t + e.nz * d, e });
    }
    return out;
  }

  setLevel(level) {
    this.clearNapalm();
    const old = this.levelGroup;
    if (old) { this.scene.remove(old); this.levelGroup = null; this.disposeLevel(old); }
    this.owCullObjs = null;
    for (const [, ch] of this.owChutes || []) { this.scene.remove(ch); this.disposeLevel(ch); }
    this.owChutes = null; this.owLoot = null;
    useSideCamera(this, !!level.side && !level.brawl);   // 2D side view: orthographic camera (siderender.js)
    if (level.side) {
      sideBuild(this, level);
      for (const [, m] of this.barricades) this.scene.remove(m);
      this.barricades.clear();
      for (const [, b] of this.bullets) this.scene.remove(b);
      this.bullets.clear();
      this.clearTelegraphs();
      this.snapCamera = true;
      return;
    }
    if (level.open) {   // open world mode (owrender.js)
      owBuild(this, level);
      for (const [, m] of this.barricades) this.scene.remove(m);
      this.barricades.clear();
      for (const [, b] of this.bullets) this.scene.remove(b);
      this.bullets.clear();
      this.clearTelegraphs();
      this.snapCamera = true;
      return;
    }
    if (this.scene.fog.far !== 120 || this.camera.far !== 300) { this.scene.fog.near = 55; this.scene.fog.far = 120; this.camera.far = 300; this.camera.updateProjectionMatrix(); }   // (near: set per frame in update)
    this.sun.target.position.set(0, 0, 0); this.sun.position.set(12, 34, 16);
    if (level.poly && !level.edges) level.edges = arenaEdges(level);
    this.level = level; this.aimables = []; this.driftPts = null; this.seaTex = null;
    const theme = ART.themes[level.theme % ART.themes.length], st = theme.style;
    { const c = new THREE.Color(theme.floor || '#444'), hsl = {}; c.getHSL(hsl);
      this.lightK = (level.ice ? 0.82 : 1) * (hsl.l > 0.6 ? 0.78 : hsl.l > 0.45 ? 0.88 : 1) * (level.open ? 0.9 : 1); this.applyGraphics(); }
    const G = this.levelGroup = new THREE.Group();
    this.scene.add(G);
    const W = level.hx * 2 + 2, D = level.hz * 2 + 2;
    let floorMat;
    if (level.ice) {   // Ice Sheets: dark cold water (animated in updateHazards)
      const wt = this.waterTexture(); wt.repeat.set(W / 10, D / 10);
      floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: wt, roughness: 0.25, metalness: 0.2 });
    } else if (level.lava) {
      const lt = this.lavaTexture(); lt.repeat.set(W / 14, D / 14);
      floorMat = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, map: lt, emissive: 0xffffff, emissiveMap: lt, emissiveIntensity: 0.4, roughness: 0.6 });
    }
    else {
      floorMat = new THREE.MeshStandardMaterial({ map: this.floorTexture(theme), roughness: st === 'tundra' ? 0.8 : 0.93 });
      if (st === 'neon') { floorMat.emissiveMap = floorMat.map; floorMat.emissive = new THREE.Color(0xffffff); floorMat.emissiveIntensity = 0.7; }
      if (st === 'volcano') { floorMat.emissiveMap = floorMat.map; floorMat.emissive = new THREE.Color(0xffffff); floorMat.emissiveIntensity = 0.45; }
    }
    this.lavaMat = level.lava && !level.ice ? floorMat : null;
    this.waterMat = level.ice ? floorMat : null;
    this.liquidFx = null; this.hoverFx = [];
    let floorGeo;
    if (level.poly) {   // polygon arena: the floor is the polygon (a little past the walls); UVs are in meters
      const sh = new THREE.Shape(level.poly.map(([x, z]) => { const l = Math.hypot(x, z) || 1; return new THREE.Vector2(x + x / l * 0.8, -(z + z / l * 0.8)); }));
      floorGeo = new THREE.ShapeGeometry(sh);
      if (floorMat.map) { const m = (floorMat.map.userData && floorMat.map.userData.meters) || 4; floorMat.map.repeat.set(1 / m, 1 / m); }
    } else {
      floorGeo = new THREE.PlaneGeometry(W, D);
      if (floorMat.map) { const m = (floorMat.map.userData && floorMat.map.userData.meters) || 4; floorMat.map.repeat.set(W / m, D / m); }
    }
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.userData.floor = true;
    G.add(floor); this.aimables.push(floor);
    if (level.lava) this.addLiquidFx(level, G, W, D);
    const grid = new THREE.GridHelper(W, W, 0xffffff, 0xffffff);
    grid.scale.z = D / W;
    grid.material.opacity = theme.grid * 0.75; grid.material.transparent = true; grid.position.y = 0.01;
    if (!level.lava && !st) G.add(grid);
    const fogColor = new THREE.Color(theme.fog || ART.background);
    this.scene.fog.color.copy(fogColor); this.scene.background = st ? fogColor.clone() : new THREE.Color(ART.background);
    if (theme.sky) this.addSkybox(theme, G);
    const wallMat = st === 'forest' ? new THREE.MeshStandardMaterial({ map: this.bandMaterial(theme, 1, 0).map, color: 0xb8c4a0, roughness: 0.95 })
      : st === 'neon' ? new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.4, metalness: 0.5 })
      : !st ? new THREE.MeshStandardMaterial({ map: this.wallTexture(theme), roughness: 0.85 })
      : new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.85 });
    const bottom = new THREE.MeshStandardMaterial({ color: theme.wall });
    this.slopMats = [];
    const topMats = this.topMaterials(theme);
    this.glossMats = [...new Set([floorMat, ...topMats.filter(m => m && m.isMeshStandardMaterial)])];
    this.reflectMeshes = [floor];
    if (this.post) this.post.setSelects(this.reflectMeshes);
    if (this.envTex) { this.envTex.dispose(); this.envTex = null; this.scene.environment = null; }   // re-captured for the new level
    if (this.settings.reflections === 'probe' || this.settings.reflections === 'ssr' || this.settings.raytracing === 'on' || this.settings.raytracing === 'ultra') this.envDirty = true;   // (v1.2.8: ray tracing uses the probe too)
    this.applyGloss();
    const edgeMats = ART.tierColors.map(tc => new THREE.LineBasicMaterial({ color: tc }));
    for (const m of [...topMats, floor.material]) { m.userData.base = m.color.clone(); this.slopMats.push(m); }
    const rng = this.levelRng(level, 0x51f15e);
    // v1.2.6: static blocks are drawn merged, one mesh per material (each was a 6-material box: 6 draws, plus 6 per
    // shadow pass), their outlines as one line mesh per height color and the floor contact shadows as one instanced
    // mesh. Each block's own box stays as a detached, never-drawn raycast proxy (aiming, hover, camera pull-in).
    const merged = new Map(), lines = edgeMats.map(() => []), contacts = [];
    const topLine = (b, inset = 1) => {
      const y = b.y0 + b.h + (st === 'tundra' ? 0.085 : 0.015), hw = b.w / 2 * inset, hd = b.d / 2 * inset, tier = this.tierOf(b.y0 + b.h);
      const x0 = b.x - hw, x1 = b.x + hw, z0 = b.z - hd, z1 = b.z + hd;
      lines[tier].push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    };
    this.forestLogs = [];
    for (const b of level.boxes) {
      let mesh;
      if (b.field) { // lava map boundary: a faint glowing force field instead of a wall (a cold blue one on the ice)
        const f = new THREE.Mesh(new THREE.BoxGeometry(b.w, 5, b.d), new THREE.MeshBasicMaterial({ color: level.ice ? 0x7fc8ff : 0xff4040, transparent: true, opacity: 0.08, depthWrite: false }));
        f.position.set(b.x, 2.5, b.z); G.add(f); continue;
      }
      if (b.wall) {
        if (level.poly) continue;   // polygon arenas draw their own angled walls (addPolyShell)
        const near = b.z > level.hz, h = st === 'forest' ? 0.9 : b.h;
        mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, h, b.d), this.wallMatFor(wallMat, Math.max(b.w, b.d)));
        mesh.position.set(b.x, h / 2, b.z); mesh.castShadow = mesh.receiveShadow = true;
        if (!level.lava) contacts.push([b.x, b.z, b.w * (b.w > b.d ? 1 : 0.3), b.d * (b.d > b.w ? 1 : 0.3), 0.3]);
        G.add(mesh); this.aimables.push(mesh);
        if (st === 'neon') this.neonStrip(G, b.x, h, b.z, b.w, b.d, theme);
        continue;
      }
      const top = b.y0 + b.h, tier = this.tierOf(top), long = Math.max(b.w, b.d), short = Math.min(b.w, b.d);
      // Forest: pillars and tall walls become boulders, low walls become overturned logs.
      if (st === 'forest' && b.y0 === 0 && b.h >= 2.9) {
        mesh = makeRock(b.w, b.h, b.d, rng, { rock: theme.rock, moss: theme.moss });
        mesh.position.set(b.x, b.h / 2, b.z); G.add(mesh); this.aimables.push(mesh);
        topLine(b, 0.62);
        continue;
      }
      if (st === 'forest' && b.y0 === 0 && b.h <= 0.9 && long / short >= 2.2) {
        const rad = Math.min(b.h * 0.53, short * 0.5), log = makeLog(long, rad, rng, { bark: theme.bark, moss: theme.moss });
        log.position.set(b.x, rad, b.z); if (b.d > b.w) log.rotation.y = Math.PI / 2;
        G.add(log); log.traverse(o => { if (o.isMesh) this.aimables.push(o); });
        this.forestLogs.push(b);
        continue;
      }
      const side = this.bandMaterial(theme, b.h, b.y0);
      if (!side.userData.base) side.userData.base = side.color.clone();
      if (!this.slopMats.includes(side)) this.slopMats.push(side);
      mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), [side, side, topMats[tier], bottom, side, side]);
      topLine(b);
      if (st === 'tundra')   // a soft snow cap that hangs over the edges a touch
        mergeInto(merged, new THREE.BoxGeometry(b.w + 0.08, 0.07, b.d + 0.08), this.snowCapMat ||= new THREE.MeshStandardMaterial({ color: 0xf5f9fd, roughness: 0.9 }), b.x, top + 0.03, b.z, false);
      mesh.position.set(b.x, b.y0 + b.h / 2, b.z); mesh.updateMatrixWorld(true);
      mergeInto(merged, mesh.geometry, mesh.material, b.x, b.y0 + b.h / 2, b.z, true);
      this.aimables.push(mesh);
      if (b.y0 < 0.05 && !level.lava && st !== 'neon') contacts.push([b.x, b.z, b.w, b.d, 0.42]);
    }
    for (const [mat, d] of merged) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(d.u, 2)); geo.setIndex(d.i);
      const m = new THREE.Mesh(geo, mat); m.castShadow = d.cast; m.receiveShadow = true; m.userData.matte = true;   // (never ray-traced mirrors: multi-material blocks weren't either)
      G.add(m);
    }
    lines.forEach((pts, t) => { if (pts.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); G.add(new THREE.LineSegments(g, edgeMats[t])); } });
    this.addContacts(G, contacts);
    if (level.poly && !level.lava) this.addPolyShell(level, theme, G, wallMat);
    if (!level.lava) this.addProps(level, theme, G);
    if (st) this.addStyleProps(level, theme, G);
    this.buildDynamics(level, theme, G, topMats, edgeMats);
    this.buildHazard(level, G);
    this.buildTraps(level, G);
    for (const [, m] of this.barricades) this.scene.remove(m);
    this.barricades.clear();
    const ext = Math.max(level.hx, level.hz) + 6;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 90 });
    this.sun.shadow.camera.updateProjectionMatrix();
    for (const [, b] of this.bullets) this.scene.remove(b);
    this.bullets.clear();
    this.clearTelegraphs();
    this.snapCamera = true;
    this.needWarm = true;   // v1.2.4: build every shader on the next frame (see warmUp)
  }
  neonStrip(G, x, y, z, w, d, theme) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, d + 0.02), new THREE.MeshBasicMaterial({ color: theme.glow[0] }));
    m.position.set(x, y + 0.03, z); G.add(m);
  }
  // Polygon arenas: raised ground outside the polygon and an angled wall along every edge.
  addPolyShell(level, theme, G, wallMat) {
    const st = theme.style, M = 40, hx = level.hx + M, hz = level.hz + M;
    const shape = new THREE.Shape([new THREE.Vector2(-hx, -hz), new THREE.Vector2(hx, -hz), new THREE.Vector2(hx, hz), new THREE.Vector2(-hx, hz)]);
    // The hole is pushed a little outward so its inner sides sit inside the edge walls; when they lined up exactly
    // with the walls' inner faces the two fought over the same pixels (the flickering band along the wall bottoms).
    shape.holes.push(new THREE.Path(level.poly.map(([x, z]) => { const l = Math.hypot(x, z) || 1; return new THREE.Vector2(x + x / l * 0.15, -(z + z / l * 0.15)); })));
    const shelfH = 0.45, geo = new THREE.ExtrudeGeometry(shape, { depth: shelfH, bevelEnabled: false });
    const outerCol = { forest: '#3f5a2a', tundra: '#e6eef5', neon: '#0f0a1c', castle: '#5d6b4a', western: '#c19a62', candy: '#ffc4e1', sakura: '#5f7a45', tropical: '#e8d3a0', lunar: '#7b7b83', volcano: '#1a1214' }[st] || new THREE.Color(theme.floor).multiplyScalar(0.7).getStyle();
    const capMat = new THREE.MeshStandardMaterial({ color: outerCol, roughness: 0.95 });
    if (st === 'forest' || st === 'tundra' || st === 'tropical' || st === 'lunar' || st === 'volcano') {
      capMat.map = this.floorTexture(theme); capMat.map.repeat.set(0.25, 0.25); capMat.color.set(st === 'forest' ? 0xa8c890 : st === 'volcano' ? 0x9a8a8a : 0xffffff);
      if (st === 'volcano') { capMat.emissiveMap = capMat.map; capMat.emissive = new THREE.Color(0xffffff); capMat.emissiveIntensity = 0.35; }
    }
    const shelf = new THREE.Mesh(geo, [capMat, new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.9 })]);
    shelf.rotation.x = -Math.PI / 2; shelf.receiveShadow = true; G.add(shelf); this.aimables.push(shelf);
    for (const e of level.edges) {
      const h = this.edgeWallH(level, theme, e), len = e.len + 0.5;
      const w = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.5), this.wallMatFor(wallMat, len));
      w.position.set((e.ax + e.bx) / 2 - e.nx * 0.25, h / 2, (e.az + e.bz) / 2 - e.nz * 0.25);
      w.rotation.y = -Math.atan2(e.bz - e.az, e.bx - e.ax);
      w.castShadow = w.receiveShadow = true; G.add(w); this.aimables.push(w);
      if (st === 'neon') { const s = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.52), new THREE.MeshBasicMaterial({ color: theme.glow[0] })); s.position.set(w.position.x, h + 0.03, w.position.z); s.rotation.y = w.rotation.y; G.add(s); }
    }
  }

  // Moving platforms, pistons, crates, barrels and lava floats (positions come from the host).
  buildDynamics(level, theme, G, topMats, edgeMats) {
    this.dynMeshes = new Map();
    for (const d of level.dynamic || []) {
      let mesh;
      if (d.kind === 'piston') {
        // v26: a full-height pillar that slides up out of the floor and back down into it (no squashed texture)
        const H = d.hMax || d.h || 1, geo = new THREE.BoxGeometry(d.w, H, d.d); geo.translate(0, -H / 2, 0);
        const sideM = this.bandMaterial(theme, H, 0);
        mesh = new THREE.Mesh(geo, [sideM, sideM, new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.5 }), topMats[0], sideM, sideM]);
      } else if (d.kind === 'crusher') {   // v1.2.15: a steel slab with a hazard band that slams down (origin on its bottom face)
        const geo = new THREE.BoxGeometry(d.w, d.h, d.d); geo.translate(0, d.h / 2, 0);
        const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f5a, metalness: 0.6, roughness: 0.45 }), stripe = new THREE.MeshStandardMaterial({ map: this.stripeTex(), roughness: 0.6 });
        // v1.2.22 (Devin): see-through, so you can still see yourself under it from the top-down view
        const glass = m => { m.transparent = true; m.opacity = 0.42; m.depthWrite = false; return m; };
        glass(steel); glass(stripe);
        mesh = new THREE.Mesh(geo, [stripe, stripe, steel, glass(new THREE.MeshStandardMaterial({ color: 0x24262c, metalness: 0.7, roughness: 0.4 })), stripe, stripe]);
        mesh.renderOrder = 3; mesh.userData.seeThrough = true;
        const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 8, 10), steel); piston.position.y = d.h + 4; mesh.add(piston);
      } else if (d.kind === 'pinch') {   // v1.2.22 pinch piston jaw: a steel block with a hazard-striped face and a rod out the back
        const geo = new THREE.BoxGeometry(d.w, d.h, d.d); geo.translate(0, d.h / 2, 0);
        const steel = new THREE.MeshStandardMaterial({ color: 0x5a4f4a, metalness: 0.55, roughness: 0.45 }), stripe = new THREE.MeshStandardMaterial({ map: this.stripeTex(), roughness: 0.6 });
        const face = d.axis === 'x' ? (d.side > 0 ? 1 : 0) : (d.side > 0 ? 5 : 4);   // the face toward the middle
        const mats = [steel, steel, steel, steel, steel, steel]; mats[face] = stripe; mats[d.axis === 'x' ? (d.side > 0 ? 0 : 1) : (d.side > 0 ? 4 : 5)] = stripe;
        mesh = new THREE.Mesh(geo, mats);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 6, 10), steel);
        if (d.axis === 'x') { rod.rotation.z = Math.PI / 2; rod.position.set(d.side * (d.w / 2 + 3), d.h / 2, 0); } else { rod.rotation.x = Math.PI / 2; rod.position.set(0, d.h / 2, d.side * (d.d / 2 + 3)); }
        mesh.add(rod);
      } else if (d.kind === 'crate') {
        const geo = new THREE.BoxGeometry(d.w, d.h, d.d);
        mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(0xa8845a).lerp(new THREE.Color(theme.top), 0.2), map: this.crateTex(), roughness: 0.9 }));
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x3d2b17 })));
      } else if (d.kind === 'barrel') {
        const geo = new THREE.CylinderGeometry(d.w / 2, d.w / 2, d.h, 14);
        mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc25a44, map: this.barrelTex(), roughness: 0.5, metalness: 0.3 }));
        const band = new THREE.Mesh(new THREE.CylinderGeometry(d.w / 2 + 0.01, d.w / 2 + 0.01, 0.08, 14), new THREE.MeshStandardMaterial({ color: 0x2a2b30 }));
        band.position.y = d.h * 0.1; mesh.add(band);
      } else if (d.poly) { // Ice Sheets floe: an extruded polygon; pivots on its top center so it can tip (syncDynamics)
        mesh = this.makeFloe(d);
      } else { // slide and float platforms
        const geo = new THREE.BoxGeometry(d.w, d.h, d.d); geo.translate(0, d.h / 2, 0);
        const tier = this.tierOf(d.y0 + d.h);
        const side = d.kind === 'float' ? new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.8 }) : this.bandMaterial(theme, d.h, d.y0);
        const under = d.kind === 'float' && level.lava ? new THREE.MeshStandardMaterial({ color: 0x3a1a10, emissive: 0xff3a00, emissiveIntensity: 0.35 }) : side;
        mesh = new THREE.Mesh(geo, [side, side, topMats[tier], under, side, side]);
        const y = d.h + 0.015, hw = d.w / 2, hd = d.d / 2;
        mesh.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-hw, y, -hd), new THREE.Vector3(hw, y, -hd), new THREE.Vector3(hw, y, hd), new THREE.Vector3(-hw, y, hd), new THREE.Vector3(-hw, y, -hd)]), edgeMats[tier]));
      }
      const centered = d.kind === 'crate' || d.kind === 'barrel';
      if (level.lava && !level.ice && (d.kind === 'float' || d.kind === 'slide')) this.addHover(mesh, d);
      mesh.position.set(d.x, d.y0 + (d.poly || d.kind === 'piston' ? d.h : centered ? d.h / 2 : 0), d.z);
      mesh.castShadow = mesh.receiveShadow = true;
      G.add(mesh); this.aimables.push(d.poly ? mesh.children[0] : mesh);
      this.dynMeshes.set(d.id, { mesh, kind: d.kind, centered, floe: d.poly ? d.h : 0, piston: d.kind === 'piston' });
    }
  }
  syncDynamics(list) {
    for (const o of list || []) {
      const e = this.dynMeshes.get(o.id);
      if (!e) continue;
      e.mesh.position.set(o.x, o.y + (e.piston ? o.h : e.floe || (e.centered ? o.h / 2 : 0)), o.z);
      if (e.floe) { e.mesh.rotation.z += (-(o.tx || 0) - e.mesh.rotation.z) * 0.25; e.mesh.rotation.x += ((o.tz || 0) - e.mesh.rotation.x) * 0.25; }
      if (e.centered && o.tip) { // tipped over: ease into lying on its side
        const tz = o.tip === 1 ? -Math.PI / 2 : o.tip === 2 ? Math.PI / 2 : 0, tx = o.tip === 3 ? Math.PI / 2 : o.tip === 4 ? -Math.PI / 2 : 0;
        e.mesh.rotation.z += (tz - e.mesh.rotation.z) * 0.2; e.mesh.rotation.x += (tx - e.mesh.rotation.x) * 0.2;
      }
    }
  }

  // Ice floe mesh: the polygon (local x/z) extruded down from y=0, so the group's origin is the top center.
  makeFloe(d) {
    const shape = new THREE.Shape(d.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: d.h, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 1 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, -d.h, 0);   // extrusion runs +y; top face at y=0
    this.iceMats ||= [new THREE.MeshStandardMaterial({ color: 0xeef7ff, roughness: 0.35, metalness: 0.05 }), new THREE.MeshStandardMaterial({ color: 0x9fd0ee, roughness: 0.2, transparent: true, opacity: 0.92 })];
    const g = new THREE.Group(), m = new THREE.Mesh(geo, this.iceMats);
    m.castShadow = m.receiveShadow = true; g.add(m);
    const pts = d.poly.map(([x, z]) => new THREE.Vector3(x, 0.07, z)); pts.push(pts[0].clone());
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7fb8dc })));
    // a few cracks / snow patches on top so floes don't look like plastic
    const rnd = this.levelRng({ seed: d.id.length * 7919 + Math.round(d.x * 13 + d.z * 7) }, 0x1ce);
    for (let i = 0; i < 2 + Math.floor(rnd() * 2); i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.25 + rnd() * 0.45, 7), this.snowPatchMat ||= new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
      p.rotation.x = -Math.PI / 2; p.position.set((rnd() - 0.5) * d.w * 0.5, 0.075, (rnd() - 0.5) * d.d * 0.5); g.add(p);
    }
    return g;
  }
  // Lava platforms: a simple "thruster" under each one, a few glowing squares dropping away (accelerating) and
  // shrinking, children of the platform so they move with it. Animated in updateHazards.
  addHover(mesh, d) {
    this.hoverMat ||= new THREE.MeshBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0.8, depthWrite: false });
    this.hoverGeo ||= new THREE.PlaneGeometry(0.22, 0.22);
    const n = Math.max(3, Math.min(6, Math.round(d.w * d.d / 4)));
    for (let i = 0; i < n; i++) {
      const q = new THREE.Mesh(this.hoverGeo, this.hoverMat);
      q.rotation.x = -Math.PI / 2;
      q.userData = { ox: (Math.random() - 0.5) * d.w * 0.55, oz: (Math.random() - 0.5) * d.d * 0.55, t: i / n, spd: 0.55 + Math.random() * 0.25 };
      mesh.add(q); this.hoverFx.push(q);
    }
  }
  // Liquid floors: a second copy of the texture drifting the other way (lava churns, water ripples) and a few
  // bubbles (lava) / glints (water) popping at random spots.
  addLiquidFx(level, G, W, D) {
    const ice = !!level.ice, base = ice ? this.waterTexture() : this.lavaTexture();
    const tex = base.clone(); tex.needsUpdate = true; tex.repeat.set(W / (ice ? 7 : 9), D / (ice ? 7 : 9)); tex.userData = { perLevel: true };
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: ice ? 0.22 : 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    sheet.rotation.x = -Math.PI / 2; sheet.position.y = 0.02; G.add(sheet);
    const pops = [], mat = new THREE.MeshBasicMaterial({ color: ice ? 0xdff4ff : 0xffc35a, transparent: true, opacity: 0, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const b = new THREE.Mesh(new THREE.RingGeometry(0.05, ice ? 0.12 : 0.2, 12), mat.clone());
      b.rotation.x = -Math.PI / 2; b.position.y = 0.04; b.userData.t = Math.random(); G.add(b); pops.push(b);
    }
    this.liquidFx = { tex, pops, W, D, ice };
  }
  // Ice Sheets water: deep blue-green with lighter ripple bands; tiles seamlessly.
  waterTexture() {
    if (this._waterTex) return this._waterTex;
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), rnd = i => Math.abs((Math.sin(i * 7.77) * 43758.5453) % 1);
    const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, '#12445e'); gr.addColorStop(0.5, '#185a76'); gr.addColorStop(1, '#12445e');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const x = rnd(i) * 256, y = rnd(i + 50) * 256, len = 18 + rnd(i + 90) * 40;
      g.strokeStyle = `rgba(170,225,245,${0.12 + rnd(i + 130) * 0.18})`; g.lineWidth = 2 + rnd(i + 170) * 2;
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) { g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + len / 2, y + oy - 5, x + ox + len, y + oy); g.stroke(); }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return (this._waterTex = t);
  }

  // v1.2.15 trap arenas: spike floors, laser fences, sweeping lasers (traps.js) and floor marks under crushers
  stripeTex() {
    if (this._stripeTex) return this._stripeTex;
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#ffc93a'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#16171c';
    for (let i = -64; i < 128; i += 22) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 11, 0); x.lineTo(i + 11 - 64, 64); x.lineTo(i - 64, 64); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return (this._stripeTex = t);
  }
  buildTraps(level, G) {
    this.traps = [];
    for (const d of level.dynamic || []) if (d.kind === 'pinch' && d.side > 0) {   // v1.2.22: the kill zone between pinch jaws
      const ax = d.axis === 'x', L2 = d.gap * 2, mark = new THREE.Mesh(new THREE.PlaneGeometry(ax ? L2 : d.w, ax ? d.d : L2), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.22, depthWrite: false }));
      mark.rotation.x = -Math.PI / 2; mark.position.set(ax ? d.c : d.x, 0.025, ax ? d.z : d.c); G.add(mark);
    }
    for (const d of level.dynamic || []) if (d.kind === 'crusher') {
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.d), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.2, depthWrite: false }));
      mark.rotation.x = -Math.PI / 2; mark.position.set(d.x, 0.025, d.z); G.add(mark);
      this.traps.push({ kind: 'crushMark', id: d.id, top: d.top, mark });
    }
    for (const tr of level.traps || []) {
      if (tr.kind === 'spikes') {
        const g = new THREE.Group(); g.position.set(tr.x, 0, tr.z);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(tr.w + 0.3, 0.03, tr.d + 0.3), new THREE.MeshStandardMaterial({ map: this.stripeTex(), roughness: 0.7 }));
        rim.position.y = 0.012; g.add(rim);
        const plateM = new THREE.MeshStandardMaterial({ color: 0x3a3d45, metalness: 0.5, roughness: 0.5, emissive: 0xff2020, emissiveIntensity: 0 });
        const plate = new THREE.Mesh(new THREE.BoxGeometry(tr.w, 0.05, tr.d), plateM); plate.position.y = 0.025; plate.receiveShadow = true; g.add(plate);
        const sp = 0.42, nx = Math.max(1, Math.floor(tr.w / sp)), nz = Math.max(1, Math.floor(tr.d / sp));
        const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.11, 0.5, 5), new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.7, roughness: 0.3, flatShading: true }), nx * nz);
        const m = new THREE.Matrix4(); let k = 0;
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { m.makeTranslation((i + 0.5) * tr.w / nx - tr.w / 2, 0.25, (j + 0.5) * tr.d / nz - tr.d / 2); cones.setMatrixAt(k++, m); }
        cones.castShadow = true; const lift = new THREE.Group(); lift.add(cones); g.add(lift); G.add(g);
        this.traps.push({ tr, lift, plateM });
      } else if (tr.kind === 'fence') {
        const g = new THREE.Group(), len = Math.hypot(tr.bx - tr.ax, tr.bz - tr.az);
        g.position.set((tr.ax + tr.bx) / 2, 0, (tr.az + tr.bz) / 2); g.rotation.y = -Math.atan2(tr.bz - tr.az, tr.bx - tr.ax);
        const postM = new THREE.MeshStandardMaterial({ color: 0x2c2f38, metalness: 0.6, roughness: 0.4, emissive: 0xff2030, emissiveIntensity: 0.3 });
        for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.5, 0.3), postM); p.position.set(s * len / 2, 1.25, 0); p.castShadow = true; g.add(p); }
        const beamM = new THREE.MeshBasicMaterial({ color: 0xff3048, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
        const beam = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.3, 2.3), beamM); beam.position.y = 1.2; g.add(beam);
        const lines = new THREE.Group();
        for (let i = 0; i < 6; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(len - 0.3, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0xff5060 })); l.position.y = 0.2 + i * 0.4; lines.add(l); }
        g.add(lines); G.add(g);
        this.traps.push({ tr, beam, lines, beamM });
      } else if (tr.kind === 'sweep') {
        const len = (tr.axis === 'x' ? level.hx : level.hz) * 2 + 1;
        const beam = new THREE.Mesh(tr.axis === 'x' ? new THREE.BoxGeometry(len, 0.1, 0.1) : new THREE.BoxGeometry(0.1, 0.1, len), new THREE.MeshBasicMaterial({ color: 0xff2a3a }));
        const glow = new THREE.Mesh(tr.axis === 'x' ? new THREE.BoxGeometry(len, 0.35, 0.35) : new THREE.BoxGeometry(0.35, 0.35, len), new THREE.MeshBasicMaterial({ color: 0xff6070, transparent: true, opacity: 0.3, depthWrite: false }));
        for (const m of [beam, glow]) { m.position.y = 0.55; G.add(m); }
        this.traps.push({ tr, beam, glow });
      }
    }
  }
  updateTraps(T) {
    if (!this.traps || !this.traps.length) return;
    const blink = Math.floor(performance.now() / 120) % 2 === 0;
    for (const e of this.traps) {
      if (e.kind === 'crushMark') {
        const d = this.dynMeshes.get(e.id); if (!d) continue;
        const k = 1 - Math.min(1, d.mesh.position.y / (e.top || 3.4));
        e.mark.material.opacity = 0.12 + 0.55 * k + (Math.abs(d.mesh.position.y - e.top) > 0.01 && k < 0.05 && blink ? 0.3 : 0);
        continue;
      }
      if (T == null) continue;
      const s = trapState(e.tr, T);
      if (e.tr.kind === 'spikes') {
        const want = s.s === 2 ? 0 : s.s === 1 ? -0.38 : -0.55;
        e.lift.position.y += (want - e.lift.position.y) * (s.s === 2 ? 0.6 : 0.2);
        e.plateM.emissiveIntensity = s.s === 1 ? (blink ? 0.9 : 0.2) : s.s === 2 ? 0.25 : 0;
      } else if (e.tr.kind === 'fence') {
        e.beam.visible = s.s === 2; e.beamM.opacity = 0.4 + 0.15 * Math.sin(performance.now() / 60);
        e.lines.visible = s.s === 2 || (s.s === 1 && blink);
      } else {
        for (const m of [e.beam, e.glow]) { if (e.tr.axis === 'x') m.position.z = s.pos; else m.position.x = s.pos; }
      }
    }
  }
  buildHazard(level, G) {
    this.saws = []; this.laser = null;
    const h = level.hazard;
    if (!h) return;
    if (h.type === 'laser') {
      const len = (h.axis === 'x' ? level.hx : level.hz) * 2 + 2;
      const geo = h.axis === 'x' ? new THREE.BoxGeometry(len, 1, 1) : new THREE.BoxGeometry(1, 1, len);
      const warn = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.35, depthWrite: false }));
      const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff2a3a }));
      const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff6070, transparent: true, opacity: 0.3, depthWrite: false }));
      warn.scale.set(h.axis === 'x' ? 1 : 0.04, 0.04, h.axis === 'x' ? 0.04 : 1);
      beam.scale.set(h.axis === 'x' ? 1 : 0.1, 0.1, h.axis === 'x' ? 0.1 : 1);
      glow.scale.set(h.axis === 'x' ? 1 : 0.4, 0.4, h.axis === 'x' ? 0.4 : 1);
      for (const m of [warn, beam, glow]) { m.position.y = h.y; m.visible = false; G.add(m); }
      this.laser = { axis: h.axis, warn, beam, glow };
    } else if (h.type === 'saws') {
      // A thick spinning blade standing out of the pillar face on an arm, with a striped housing.
      // The blade spins in the plane perpendicular to the face so it clearly sticks out.
      const steel = new THREE.MeshStandardMaterial({ color: 0xe4e8ef, metalness: 0.35, roughness: 0.3, flatShading: true, emissive: 0x30343c });
      const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d35, metalness: 0.5, roughness: 0.5 });
      const warnTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 16; const x = c.getContext('2d'); x.fillStyle = '#ffd23a'; x.fillRect(0, 0, 64, 16); x.fillStyle = '#16171c'; for (let i = -16; i < 80; i += 16) { x.beginPath(); x.moveTo(i, 16); x.lineTo(i + 8, 16); x.lineTo(i + 16, 0); x.lineTo(i + 8, 0); x.fill(); } const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.repeat.x = 2; t.userData = { perLevel: true }; return t; })();
      const warn = new THREE.MeshStandardMaterial({ map: warnTex, roughness: 0.6 });
      for (const sw of h.saws) {
        const grp = new THREE.Group(), spin = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.08, 28), steel);
        disc.rotation.x = Math.PI / 2; spin.add(disc);
        const teeth = 14;
        for (let i = 0; i < teeth; i++) {
          const a = i / teeth * Math.PI * 2, tooth = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 3), steel);
          tooth.scale.z = 0.45;
          tooth.position.set(Math.cos(a) * 0.66, Math.sin(a) * 0.66, 0); tooth.rotation.z = a - Math.PI / 2 - 0.35; spin.add(tooth);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.16, 12), new THREE.MeshBasicMaterial({ color: 0xff3344 }));
        hub.rotation.x = Math.PI / 2; spin.add(hub);
        for (let i = 0; i < 3; i++) { // cut-outs so the spin is readable
          const slot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.3, 0.1), dark);
          const a = i / 3 * Math.PI * 2; slot.position.set(Math.cos(a) * 0.34, Math.sin(a) * 0.34, 0); slot.rotation.z = a; spin.add(slot);
        }
        const blur = new THREE.Mesh(new THREE.CircleGeometry(0.76, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
        spin.add(blur);
        grp.add(spin);
        // Local x points out of the pillar face (rotation below turns the group to match).
        const sgn = sw.nx !== 0 ? sw.nx : -sw.nz;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.14), dark); arm.position.x = -sgn * 0.2; grp.add(arm);
        const housing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.5), warn); housing.position.x = -sgn * 0.37; grp.add(housing);
        const track = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.7, 0.18), dark); track.position.set(-sgn * 0.33, 0, 0); grp.add(track);
        grp.position.set(sw.x, sw.y, sw.z);
        grp.rotation.y = sw.nx !== 0 ? 0 : Math.PI / 2;  // blade plane contains the face normal
        grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
        G.add(grp); this.saws.push(spin);
      }
    }
  }
  // Theme ambience: drifting petals (Sakura), rising embers (Volcano), rolling sea (Tropical).
  updateAmbience(dt) {
    const p = this.driftPts;
    if (p) {
      const a = p.geometry.attributes.position, L = this.level, t = performance.now() / 1000, ember = p.userData.drift === 'embers';
      for (let i = 0; i < a.count; i++) {
        let y = a.getY(i) + (ember ? 0.6 : -0.45) * dt * (0.6 + (i % 5) * 0.15);
        let x = a.getX(i) + Math.sin(t * 0.8 + i) * dt * (ember ? 0.2 : 0.5);
        if (y < 0.05) y = 7; if (y > 7) y = 0.3;
        if (Math.abs(x) > L.hx + 3) x = -Math.sign(x) * (L.hx + 2);
        a.setXY(i, x, y);
      }
      a.needsUpdate = true;
    }
    if (this.seaTex) { this.seaTex.offset.x += dt * 0.01; this.seaTex.offset.y += dt * 0.006; }
  }
  updateHazards(laser, dt) {
    this.updateAmbience(dt);
    for (const s of this.saws) s.rotateZ(-dt * 16);
    if (this.laser) {
      const L = this.laser, on = laser && laser[1] === 2, warn = laser && laser[1] === 1;
      for (const m of [L.warn, L.beam, L.glow]) { if (L.axis === 'x') m.position.z = laser ? laser[0] : 0; else m.position.x = laser ? laser[0] : 0; }
      L.warn.visible = !!warn && Math.floor(performance.now() / 180) % 2 === 0;
      L.beam.visible = L.glow.visible = !!on;
    }
    if (this.lavaMat) {
      this.lavaMat.emissiveIntensity = (this.lavaMat.map ? 0.4 : 0.55) + Math.sin(performance.now() / 600) * (this.lavaMat.map ? 0.1 : 0.15);
      if (this.lavaMat.map) { this.lavaMat.map.offset.x = (this.lavaMat.map.offset.x + dt * 0.02) % 1; this.lavaMat.map.offset.y = (this.lavaMat.map.offset.y + dt * 0.012) % 1; }
    }
    if (this.waterMat && this.waterMat.map) { const m = this.waterMat.map, k = performance.now() / 1000; m.offset.x = (m.offset.x + dt * 0.03) % 1; m.offset.y = Math.sin(k * 0.5) * 0.03; }
    const F = this.liquidFx;
    if (F) {
      const k = performance.now() / 1000;
      F.tex.offset.x = (F.tex.offset.x - dt * (F.ice ? 0.045 : 0.03)) % 1; F.tex.offset.y = Math.sin(k * (F.ice ? 0.7 : 0.4)) * 0.05;
      for (const b of F.pops) {
        const u = b.userData; u.t += dt * (F.ice ? 0.6 : 0.8);
        if (u.t >= 1) { u.t = 0; b.position.x = (Math.random() - 0.5) * F.W * 0.9; b.position.z = (Math.random() - 0.5) * F.D * 0.9; }
        b.scale.setScalar(0.4 + u.t * 1.4); b.material.opacity = Math.sin(u.t * Math.PI) * 0.7;
      }
    }
    for (const q of this.hoverFx || []) {   // thruster squares: ease-in fall (t^2), shrinking as they go
      const u = q.userData; u.t = (u.t + dt * u.spd) % 1;
      q.position.set(u.ox, -0.06 - u.t * u.t * 1.1, u.oz); q.scale.setScalar(Math.max(0.05, 1 - u.t));
    }
  }

  // Deployed shields (Iron Curtain etc.) and mines.
  syncShields(list) {
    const seen = new Set();
    for (const sh of list || []) {
      seen.add(sh.id);
      let m = this.shieldMeshes.get(sh.id);
      if (m && m.userData.color !== sh.color) { this.scene.remove(m); m = null; }   // owner color arrived late
      if (!m && sh.box) {
        // Pillar Shield: a square box lined up with the pillar's walls, gold-tinted in the owner's color.
        // Built 1 m tall and stretched to the pillar's current height; fades as its health drops.
        const tint = new THREE.Color(sh.color).lerp(new THREE.Color(0xffd27a), 0.45);
        const mat = makeShieldMaterial(tint, { opacity: 0.18, cell: 3.2 }); mat.side = THREE.DoubleSide;
        m = new THREE.Mesh(new THREE.BoxGeometry(sh.w, 1, sh.d), mat);
        m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity: 0.9 })));
        m.userData.color = sh.color; m.userData.box = true;
        this.scene.add(m); this.shieldMeshes.set(sh.id, m);
      }
      if (m && m.userData.box) {
        m.scale.y = Math.max(0.05, sh.h);
        m.position.set(sh.x, sh.y0 + sh.h / 2, sh.z);
        const f = Math.max(0, sh.hp ?? 1);
        if (m.material.uniforms) m.material.uniforms.opacity.value = 0.08 + 0.16 * f + Math.sin(performance.now() / 300) * 0.02;
        m.children[0].material.opacity = 0.35 + 0.6 * f;
        continue;
      }
      if (!m) {
        // Same shimmering shell as the bubble, in the owner's color. Shock and Siphon carry over.
        const tint = sh.shock ? new THREE.Color(sh.color).lerp(new THREE.Color(0x7fd8ff), 0.55) : sh.leech ? new THREE.Color(sh.color).lerp(new THREE.Color(0x6dffb0), 0.5) : new THREE.Color(sh.color);
        const mat = makeShieldMaterial(tint, { opacity: 0.2, cell: 3.2 }); mat.uniforms.shock.value = sh.shock ? 1 : 0; mat.side = THREE.DoubleSide;
        m = new THREE.Mesh(new THREE.BoxGeometry(sh.w, sh.h, sh.d), mat);
        const halo = new THREE.Mesh(new THREE.BoxGeometry(sh.w + 0.14, sh.h + 0.14, sh.d + 0.14), makeShieldMaterial(tint, { halo: true, opacity: sh.shock ? 0.9 : 0.45 }));
        m.add(halo);
        m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: tint })));
        m.userData.color = sh.color; m.userData.shock = sh.shock;
        if (sh.shock) { m.userData.arcs = this.makeArcs(5, 0xbff4ff); m.add(m.userData.arcs.group); }
        this.scene.add(m); this.shieldMeshes.set(sh.id, m);
      }
      m.position.set(sh.x, sh.y0 + sh.h / 2, sh.z); m.rotation.y = -(sh.ang || 0);   // walls face wherever they were aimed
      if (m.userData.arcs) {
        const W = Math.max(sh.w, sh.d), wide = sh.w >= sh.d;
        this.updateArcs(m.userData.arcs, () => { // arcs skittering across the wall face
          const pts = [], y0 = (Math.random() - 0.5) * sh.h, x0 = (Math.random() - 0.5) * W, len = 0.6 + Math.random() * 1.2, dir = Math.random() * 6.28;
          for (let k = 0; k < 7; k++) {
            const t = k / 6, a = x0 + Math.cos(dir) * len * t + (Math.random() - 0.5) * 0.15, b = y0 + Math.sin(dir) * len * t + (Math.random() - 0.5) * 0.15;
            const ca = Math.max(-W / 2, Math.min(W / 2, a)), cb = Math.max(-sh.h / 2, Math.min(sh.h / 2, b)), off = (Math.random() < 0.5 ? -1 : 1) * (0.14 + Math.random() * 0.04);
            pts.push(wide ? new THREE.Vector3(ca, cb, off) : new THREE.Vector3(off, cb, ca));
          }
          return pts;
        });
      }
    }
    for (const [id, m] of this.shieldMeshes) if (!seen.has(id)) { this.scene.remove(m); this.shieldMeshes.delete(id); }
  }
  syncMines(list) {
    const seen = new Set(), blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (const mn of list || []) {
      seen.add(mn.id);
      let m = this.mineMeshes.get(mn.id);
      if (!m && mn.snare) {   // v1.2.15 Snare Plate: a flat see-through plate with jaws (only you and your team see it)
        m = new THREE.Group();
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 20), new THREE.MeshStandardMaterial({ color: mn.color, transparent: true, opacity: 0.5, metalness: 0.4 }));
        m.add(plate);
        for (let k = 0; k < 8; k++) { const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 0.7 })); const a = k / 8 * Math.PI * 2; tooth.position.set(Math.cos(a) * 0.42, 0.07, Math.sin(a) * 0.42); m.add(tooth); }
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: mn.color }));
        light.position.y = 0.05; m.add(light); m.userData.light = light; m.userData.color = new THREE.Color(mn.color); m.userData.snare = true;
        this.scene.add(m); this.mineMeshes.set(mn.id, m);
      }
      if (!m) {
        m = new THREE.Group();
        m.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0x2a2b30, metalness: 0.5 })));
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: mn.color }));
        light.position.y = 0.09; m.add(light); m.userData.light = light; m.userData.color = new THREE.Color(mn.color);
        this.scene.add(m); this.mineMeshes.set(mn.id, m);
      }
      m.position.set(mn.x, mn.y + 0.06, mn.z); m.scale.setScalar(mn.sz || 1);
      if (m.userData.snare) { m.position.y = mn.y + 0.02; m.userData.light.material.color.set(mn.armed ? 0xffb347 : m.userData.color); continue; }
      m.userData.light.material.color.set(mn.armed ? (blink ? 0xff2030 : 0x400008) : m.userData.color);
    }
    for (const [id, m] of this.mineMeshes) if (!seen.has(id)) { this.scene.remove(m); this.mineMeshes.delete(id); }
  }

  // A column of light where someone is about to revive.
  holyBeam(x, y, z, dur) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 30, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.set(x, y + 15, z); this.scene.add(beam);
    const max = dur + 0.6;
    this.fx.push({ m: beam, life: max, max, update: (f) => {
      const k = 1 - f.life / f.max;
      f.m.material.opacity = Math.min(1, k * 4) * Math.min(1, f.life / 0.5) * 0.55;
      f.m.scale.set(1 + Math.sin(k * 30) * 0.06, 1, 1 + Math.sin(k * 30) * 0.06);
    } });
    this.lockFlash(x, y, z, 0xffe9a8);
  }
  fieldRing(x, y, z, r, color, dur = 1.0) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.04, z); this.scene.add(m);
    this.fx.push({ m, life: dur, max: dur, update: f => { const k = 1 - f.life / f.max; f.m.scale.setScalar(r * Math.min(1, k * 1.5)); f.m.material.opacity = 0.3 * (0.6 + 0.4 * Math.sin(k * 20)); } });
  }

  // Decorations: small grass tufts and pebbles hugging walls and block bases.
  // Purely visual (no collision), seeded by the level so every player sees the same layout.
  addProps(level, theme, G) {
    const density = (ART.propDensity ?? 1) * (this.settings.props === false ? 0 : 1);
    if (!density) return;
    let a = (level.seed ^ 0x9e3779b9) >>> 0;
    const rng = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const spots = [];
    const hx = level.hx, hz = level.hz, forest = theme.style === 'forest', n = Math.round((hx + hz) * 2.2 * density * (forest ? 1.5 : 1));
    spots.push(...this.edgeSpots(level, n, rng, [0.35, 0.85]));   // along the walls (rectangles and polygons)
    if (forest) for (let i = 0; i < Math.round(hx * hz / 14 * density); i++) {   // a few thick tufts out in the open
      const x = (rng() * 2 - 1) * (hx - 2), z = (rng() * 2 - 1) * (hz - 2);
      if ((!level.edges || edgeDistance(level.edges, x, z) > 1) && !level.boxes.some(b => !b.wall && Math.abs(x - b.x) < b.w / 2 + 0.3 && Math.abs(z - b.z) < b.d / 2 + 0.3)) spots.push({ x, z });
    }
    for (const b of level.boxes) { // tucked against block bases
      if (b.wall || b.y0 > 0) continue;
      const k = Math.round((b.w + b.d) * 0.5 * density);
      for (let i = 0; i < k; i++) {
        const side = rng() * 4 | 0, t = rng() - 0.5;
        spots.push(side < 2 ? { x: b.x + t * b.w, z: b.z + (side ? 1 : -1) * (b.d / 2 + 0.12) } : { x: b.x + (side === 2 ? 1 : -1) * (b.w / 2 + 0.12), z: b.z + t * b.d });
      }
    }
    const tufts = spots.filter(() => rng() < (forest ? 0.9 : 0.75)), pebbles = spots.filter(() => rng() < (forest ? 0.15 : 0.35));
    const per = forest ? 9 : 4, bladeH = forest ? 0.48 : 0.34;   // forest: thicker, taller tufts
    const blade = new THREE.ConeGeometry(forest ? 0.055 : 0.045, bladeH, 3); blade.translate(0, bladeH / 2, 0);
    const grass = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ roughness: 0.9 }), tufts.length * per);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), base = new THREE.Color(theme.grass), c = new THREE.Color();
    let i = 0;
    for (const sp of tufts) for (let k = 0; k < per; k++) {
      e.set((rng() - 0.5) * 0.8, rng() * 6.28, (rng() - 0.5) * 0.8); q.setFromEuler(e);
      const sc = forest ? 0.7 + rng() * 1.0 : 0.6 + rng() * 0.8, sp2 = forest ? 0.38 : 0.25;
      m.compose(new THREE.Vector3(sp.x + (rng() - 0.5) * sp2, 0, sp.z + (rng() - 0.5) * sp2), q, new THREE.Vector3(sc, sc, sc));
      grass.setMatrixAt(i, m); grass.setColorAt(i, c.copy(base).offsetHSL(0, 0, (rng() - 0.5) * 0.12)); i++;
    }
    const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), pebbles.length);
    const rb = new THREE.Color(theme.rock);
    pebbles.forEach((sp, j) => {
      e.set(rng() * 3, rng() * 3, rng() * 3); q.setFromEuler(e);
      const sc = 0.6 + rng() * 1.1;
      m.compose(new THREE.Vector3(sp.x + (rng() - 0.5) * 0.4, 0.05 * sc, sp.z + (rng() - 0.5) * 0.4), q, new THREE.Vector3(sc, sc * 0.7, sc));
      rock.setMatrixAt(j, m); rock.setColorAt(j, c.copy(rb).offsetHSL(0, 0, (rng() - 0.5) * 0.1));
    });
    grass.receiveShadow = rock.receiveShadow = true;
    G.add(grass, rock);
  }

  // Sandbag and concrete walls. Built along a local x axis (the wall's length) and turned to the
  // wall's angle. Both share the same footprint and flat-ish tops so they stack cleanly, and both
  // wear a band in the owner's color so you can tell whose wall it is.
  buildWall(b) {
    const g = new THREE.Group(), L = b.len, T = b.th, H = b.h, kind = b.kind || 'sandbag';
    const owner = new THREE.Color(b.color || '#ffffff');
    const band = new THREE.MeshStandardMaterial({ color: owner, roughness: 0.5, emissive: owner, emissiveIntensity: 0.18 });
    let mat;
    if (kind === 'pillar') {
      // Pillar Shield: built one meter tall and scaled to its current height while it rises.
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(ART.concreteColor).lerp(owner, 0.1), roughness: 0.85, flatShading: true });
      // the column stops just under the cap, so the cap's top never shares a plane with it (that flickered)
      const col = new THREE.Mesh(new THREE.BoxGeometry(L, 0.985, T), mat); col.position.y = 0.4925; col.castShadow = col.receiveShadow = true; g.add(col);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(L + 0.08, 0.05, T + 0.08), band); cap.position.y = 0.975; g.add(cap);
      const ring = new THREE.Mesh(new THREE.BoxGeometry(L + 0.04, 0.04, T + 0.04), band); ring.position.y = 0.5; g.add(ring);
      g.userData = { mat, base: mat.color.clone(), kind };
      g.position.set(b.x, b.y0, b.z); g.scale.y = Math.max(0.01, H);
      return g;
    }
    if (CORE_LOOK[kind]) {   // Core Defense props: stone block, wooden cube, plank fence, floor slab, steel pillar, spikes
      const cube = kind === 'cube' || kind === 'plank', [col, line, metal] = CORE_LOOK[kind];
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), map: this.speckleTex(), roughness: metal ? 0.45 : 0.9, metalness: metal ? 0.6 : 0, flatShading: true });
      const bh = kind === 'spikes' ? H * 0.3 : H;
      const body = new THREE.Mesh(new THREE.BoxGeometry(L, bh, T), mat); body.position.y = bh / 2; body.castShadow = body.receiveShadow = true; g.add(body);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: line }));
      edge.position.y = bh / 2; g.add(edge);
      if (kind === 'spikes') {
        const sm = new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.7, roughness: 0.3 }), nx = Math.max(2, Math.round(L / 0.4)), nz = Math.max(1, Math.round(T / 0.4));
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.11, H - bh, 5), sm); c.position.set(-L / 2 + (i + 0.5) * L / nx, bh + (H - bh) / 2, -T / 2 + (j + 0.5) * T / nz); g.add(c); }
      }
      if (kind === 'steel') for (const y of [0.2, H - 0.2]) { const band2 = new THREE.Mesh(new THREE.BoxGeometry(L + 0.06, 0.12, T + 0.06), new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.7, roughness: 0.4 })); band2.position.y = y; g.add(band2); }
      if (kind === 'cube') for (const s of [-1, 1]) { const strap = new THREE.Mesh(new THREE.BoxGeometry(L + 0.02, 0.1, T + 0.02), new THREE.MeshStandardMaterial({ color: 0x6b4423 })); strap.position.y = H / 2 + s * H * 0.3; g.add(strap); }
      g.userData = { mat, base: mat.color.clone(), kind };
      g.position.set(b.x, b.y0, b.z); g.rotation.y = -(b.ang || 0);
      return g;
    }
    if (kind === 'concrete') {
      mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(ART.concreteColor), map: this.speckleTex(), roughness: 0.92, flatShading: true });
      const c = 0.07 * Math.min(1.6, T / 0.8); // chamfered top edges
      const sh = new THREE.Shape();
      sh.moveTo(-T / 2, 0); sh.lineTo(T / 2, 0); sh.lineTo(T / 2, H - c); sh.lineTo(T / 2 - c, H); sh.lineTo(-T / 2 + c, H); sh.lineTo(-T / 2, H - c); sh.lineTo(-T / 2, 0);
      const geo = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false });
      geo.rotateY(Math.PI / 2); geo.translate(-L / 2, 0, 0);
      const slab = new THREE.Mesh(geo, mat); slab.castShadow = slab.receiveShadow = true; g.add(slab);
      const seamMat = new THREE.LineBasicMaterial({ color: 0x5e5e58 });
      const blocks = Math.max(1, Math.round(L / 1.2));
      for (let i = 1; i < blocks; i++) { // block seams so it reads as poured sections
        const x = -L / 2 + i * L / blocks;
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, T / 2 + 0.004), new THREE.Vector3(x, H - c, T / 2 + 0.004), new THREE.Vector3(x, H, 0), new THREE.Vector3(x, H - c, -T / 2 - 0.004), new THREE.Vector3(x, 0, -T / 2 - 0.004)]), seamMat));
      }
      const foot = new THREE.Mesh(new THREE.BoxGeometry(L + 0.02, 0.12, T + 0.04), new THREE.MeshStandardMaterial({ color: 0x6f6f69, roughness: 1 }));
      foot.position.y = 0.06; g.add(foot);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(L * 0.86, Math.min(0.16, H * 0.12), T + 0.03), band);
      stripe.position.y = H * 0.62; g.add(stripe);
    } else {
      const tint = new THREE.Color(ART.sandbagColor).lerp(owner, 0.12);
      mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.95, flatShading: true });
      const rows = Math.max(2, Math.round(H / 0.4)), rowH = H / rows, per = Math.max(2, Math.round(L / 0.75)), bl = L / per;
      const bag = new THREE.SphereGeometry(0.5, 9, 6);
      // The owner's color goes on the middle row of bags (a strap box used to poke out between the rows like a floating slab).
      const midMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(ART.sandbagColor).lerp(owner, 0.5), roughness: 0.9, flatShading: true });
      const midRow = Math.floor(rows / 2);
      for (let r = 0; r < rows; r++) {
        const odd = r % 2, n = per + (odd ? 1 : 0);
        for (let k = 0; k < n; k++) {
          // staggered rows; the half-bags at the ends of odd rows keep the ends square
          let x0 = -L / 2 + (k - (odd ? 0.5 : 0)) * bl, x1 = x0 + bl;
          x0 = Math.max(-L / 2, x0); x1 = Math.min(L / 2, x1);
          const w = x1 - x0; if (w < 0.08) continue;
          const m = new THREE.Mesh(bag, r === midRow ? midMat : mat);
          m.scale.set(w * 1.06, rowH * 1.18, T * 0.96);
          m.position.set((x0 + x1) / 2, (r + 0.5) * rowH, 0);
          m.rotation.y = (Math.sin(r * 7.1 + k * 3.3) * 0.06);
          m.castShadow = m.receiveShadow = true; g.add(m);
        }
      }
      g.userData.extra = [[midMat, midMat.color.clone()]];
    }
    g.userData = { mat, base: mat.color.clone(), kind, extra: g.userData.extra || [] };
    g.position.set(b.x, b.y0, b.z);
    g.rotation.y = -(b.ang || 0);
    return g;
  }
  // ---------------- Core Defense (core.js) ----------------
  buildCoreModel() {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fdcff, roughness: 0.35, metalness: 0.3, emissive: 0x2a7fa8, emissiveIntensity: 0.35 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x2b3442, roughness: 0.6, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), mat); body.position.y = 0.45; body.castShadow = true;
    const edges = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.96), frame); edges.position.y = 0.04;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.08, 0.96), frame); top.position.y = 0.88;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0xbff0ff })); gem.position.y = 1.25;
    root.add(body, edges, top, gem);
    const gunPivot = new THREE.Group(), shield = new THREE.Group(); shield.visible = false;
    root.add(gunPivot);
    return { root, tint: [], gunPivot, shield, hitMeshes: [body], animate: t => { gem.rotation.y = t * 1.5; gem.position.y = 1.25 + Math.sin(t * 2) * 0.06; } };
  }
  // Darkens a unit's model toward black as it loses health (materials are cloned once so nothing else changes).
  shadeByHealth(e, frac) {
    const k = 0.15 + 0.85 * Math.max(0, Math.min(1, frac));
    if (e.shadeK !== undefined && Math.abs(e.shadeK - k) < 0.01) return;
    e.shadeK = k;
    if (!e.shadeMats) {
      e.shadeMats = [];
      e.root.traverse(o => { if (o.isMesh && o.material && o.material.color && o !== e.model.shield && !(e.model.shield && e.model.shield.children && e.model.shield.children.includes(o))) { o.material = o.material.clone(); e.shadeMats.push([o.material, o.material.color.clone()]); } });
    }
    for (const [m, c] of e.shadeMats) m.color.copy(c).multiplyScalar(k);
  }
  coreProp(kind) {
    const g = new THREE.Group();
    if (kind === 2) {   // turret
      const t = buildBlockTurretModel('#cfd6e4'); t.root.scale.setScalar(0.8); g.add(t.root);
    } else if (kind === 3) {   // upgrade
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.12), new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffb000, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.3 }));
      m.position.y = 0.9; g.add(m); g.userData.spin = m;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 14, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 7; g.add(beam); g.userData.beam = beam;
    } else {
      const D = { 0: [2.4, 1.6, 0.7, '#a9b3c4'], 1: [1.2, 1.2, 1.2, '#b07a45'], 4: [3.6, 0.9, 0.45, '#c08a52'], 5: [2.4, 0.5, 2.4, '#9aa3b0'], 6: [1.4, 2.2, 1.4, '#7b8696'], 7: [2.4, 0.5, 1.0, '#6b5a4a'] }[kind] || [2.4, 1.6, 0.7, '#a9b3c4'];
      const m = new THREE.Mesh(new THREE.BoxGeometry(D[0], D[1], D[2]), new THREE.MeshStandardMaterial({ color: D[3], roughness: 0.9 })); m.position.y = D[1] / 2; m.castShadow = true; g.add(m);
    }
    return g;
  }
  parachute(color) {
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8 }));
    canopy.scale.y = 0.6; canopy.position.y = 3.4; g.add(canopy);
    const pts = []; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; pts.push(new THREE.Vector3(Math.cos(a) * 1.4, 3.4, Math.sin(a) * 1.4), new THREE.Vector3(0, 1.2, 0)); }
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe8e8e8 })));
    return g;
  }
  syncCore(co) {
    this.coreDrops = this.coreDrops || new Map(); this.coreCarry = this.coreCarry || new Map();
    const seen = new Set(), t = performance.now() / 1000;
    for (const [id, kind, x, y, z, landed] of (co && co.dr) || []) {
      seen.add(id);
      let d = this.coreDrops.get(id);
      if (!d) { d = { g: this.coreProp(kind), chute: this.parachute(kind === 3 ? '#ffd23a' : ['#e05a4b', '#4b8be0', '#5fcf6b'][id % 3]) }; d.g.add(d.chute); this.scene.add(d.g); this.coreDrops.set(id, d); }
      d.g.position.set(x, y, z); d.chute.visible = !landed;
      d.g.rotation.z = landed ? 0 : Math.sin(t * 1.3 + id) * 0.08;
      if (d.g.userData.spin) { d.g.userData.spin.rotation.y = t * 2; d.g.userData.spin.position.y = 0.9 + Math.sin(t * 3) * 0.12; }
    }
    for (const [id, d] of this.coreDrops) if (!seen.has(id)) { this.scene.remove(d.g); this.coreDrops.delete(id); }
    // what each player is carrying floats above their head
    const held = new Set();
    let ghostRow = null;
    for (const [pid, kind, , gx, gy, gz, ga, armed] of (co && co.cr) || []) {
      // v28: your own hologram shows in first person too (your model is hidden there, which used to hide it)
      if (pid === this.localId && gx != null && armed) ghostRow = { kind, x: gx, y: gy, z: gz, a: ga, armed: true };   // v1.0.1: only while you hold the use key
      const e = this.players.get(pid); if (!e || !e.root.visible) continue;
      held.add(pid);
      let c = this.coreCarry.get(pid);
      if (c && c.kind !== kind) { this.scene.remove(c.g); c = null; }
      if (!c) { c = { kind, g: this.coreProp(kind) }; c.g.scale.setScalar(0.45); this.scene.add(c.g); this.coreCarry.set(pid, c); }
      const p = e.root.position; c.g.position.set(p.x, p.y + 2.3 * (e.root.scale.y || 1), p.z); c.g.rotation.y = t;
    }
    for (const [pid, c] of this.coreCarry) if (!held.has(pid)) { this.scene.remove(c.g); this.coreCarry.delete(pid); }
    // v26: a see-through hologram where your carried block / turret will go (let go of the use key to place it)
    if (this.coreGhost && (!ghostRow || this.coreGhost.kind !== ghostRow.kind)) { this.scene.remove(this.coreGhost.g); this.coreGhost = null; }
    if (ghostRow) {
      if (!this.coreGhost) {
        const g = this.coreProp(ghostRow.kind), mat = new THREE.MeshBasicMaterial({ color: 0x6ad8ff, transparent: true, opacity: 0.35, depthWrite: false });
        g.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = false; } });
        const edges = []; g.traverse(o => { if (o.isMesh && o.geometry && o.geometry.type === 'BoxGeometry') edges.push(o); });
        for (const o of edges) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry), new THREE.LineBasicMaterial({ color: 0xbff2ff, transparent: true, opacity: 0.9 })); l.position.copy(o.position); o.parent.add(l); }
        this.scene.add(g); this.coreGhost = { kind: ghostRow.kind, g, mat };
      }
      const G = this.coreGhost; G.g.position.set(ghostRow.x, ghostRow.y, ghostRow.z); G.g.rotation.y = -ghostRow.a;
      // faint while you just carry it, bright while you hold the use key to aim it (let go to place)
      G.mat.opacity = ghostRow.armed ? 0.5 + Math.sin(t * 8) * 0.1 : 0.2 + Math.sin(t * 4) * 0.05;
      G.mat.color.setHex(ghostRow.armed ? 0x7dffb0 : 0x6ad8ff);
    }
  }
  syncBarricades(list) {
    const seen = new Set();
    for (const b of list || []) {
      seen.add(b.id);
      let g = this.barricades.get(b.id);
      const key = `${b.color}|${b.kind}|${(b.len || 0).toFixed(2)}`;
      if (g && g.userData.key !== key) { this.scene.remove(g); g = null; }
      if (!g) { g = this.buildWall(b); g.userData.key = key; this.scene.add(g); this.barricades.set(b.id, g); }
      g.position.y += (b.y0 - g.position.y) * 0.35;   // settles down if what it stood on breaks
      if (b.kind === 'pillar') g.scale.y = Math.max(0.01, b.h);
      g.userData.mat.color.copy(g.userData.base).multiplyScalar(CORE_LOOK[b.kind] ? 0.12 + 0.88 * b.hp : 0.55 + 0.45 * b.hp);   // Core Defense props show their health by how dark they are
      for (const [m2, c2] of g.userData.extra || []) m2.color.copy(c2).multiplyScalar(0.55 + 0.45 * b.hp);
    }
    for (const [id, g] of this.barricades) if (!seen.has(id)) { this.scene.remove(g); this.barricades.delete(id); }
  }

  // ---------------- co-op boss telegraphs ----------------
  // Rows from coop.js telegraphRows: [id, kind, x, z, a, b, c, frac]. Drawn on the floor over everything
  // (they hit at every height), filling in as the attack winds up and flashing just before it lands.
  clearTelegraphs() {
    for (const [, e] of this.tgMeshes || []) this.scene.remove(e.g);
    for (const [, e] of this.swMeshes || []) this.scene.remove(e);
    this.tgMeshes = new Map(); this.swMeshes = new Map();
  }
  makeTelegraph(r) {
    const [, k, , , a, b, c] = r, color = k === 5 ? 0xb56bff : k === 6 ? 0xff9a2a : 0xff3b3b, g = new THREE.Group();
    const mat = op => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const flat = (geo, op) => { const m = new THREE.Mesh(geo, mat(op)); m.rotation.x = -Math.PI / 2; m.renderOrder = 6; g.add(m); return m; };
    const e = { g, k };
    if (k === 1 || k === 5 || k === 6) {
      e.base = flat(new THREE.CircleGeometry(a, 48), 0.14); e.edge = flat(new THREE.RingGeometry(Math.max(0, a - 0.14), a, 48), 0.85);
      e.fill = flat(new THREE.CircleGeometry(a, 48), 0.26);
    } else if (k === 2) {
      e.base = flat(new THREE.RingGeometry(a, b, 64), 0.14); e.edge = flat(new THREE.RingGeometry(b - 0.14, b, 64), 0.85); flat(new THREE.RingGeometry(a, a + 0.14, 48), 0.85);
      e.fill = flat(new THREE.RingGeometry(a, a + 0.01, 64), 0.26); e.r0 = a; e.r1 = b;
    } else if (k === 3) {
      const geo = new THREE.CircleGeometry(c, 32, -(a + b / 2), b);
      e.base = flat(geo, 0.14); e.fill = flat(geo, 0.26);
      const pts = [new THREE.Vector3(0, 0, 0)]; for (let i = 0; i <= 24; i++) { const t = a - b / 2 + b * i / 24; pts.push(new THREE.Vector3(Math.cos(t) * c, 0, Math.sin(t) * c)); } pts.push(new THREE.Vector3(0, 0, 0));
      e.edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false })); e.edge.renderOrder = 7; g.add(e.edge);
    } else if (k === 4) {
      const geo = new THREE.PlaneGeometry(b + 1.2, c); geo.translate((b + 1.2) / 2 - 1.2, 0, 0);
      e.base = flat(geo, 0.14); e.fill = flat(geo, 0.26);
      const ed = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false })); ed.rotation.x = -Math.PI / 2; ed.renderOrder = 7; g.add(ed); e.edge = ed;
      g.rotation.y = -a;
    }
    if (k === 5) { // portal opening: a little swirl of sparks
      e.swirl = new THREE.Mesh(new THREE.TorusGeometry(a * 0.6, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: 0xe2b8ff, transparent: true, opacity: 0.8 })); e.swirl.rotation.x = -Math.PI / 2; e.swirl.position.y = 0.4; g.add(e.swirl);
    }
    return e;
  }
  syncTelegraphs(rows, shocks) {
    const blinkOn = f => f > 0.82 && Math.floor(performance.now() / 70) % 2 === 0;
    if (!this.tgMeshes) this.clearTelegraphs();
    const seen = new Set();
    for (const r of rows || []) {
      const [id, k, x, z, , , , f] = r; seen.add(id);
      let e = this.tgMeshes.get(id);
      if (!e) { e = this.makeTelegraph(r); this.tgMeshes.set(id, e); this.scene.add(e.g); }
      // v1.0.1 open world: sit on the hills (not at sea level, hidden under them), with a see-through wall rising from
      // the edge so the danger zone reads from every floor and slope
      const ow = this.level && this.level.open && this.level.hAt;
      e.g.position.set(x, ow ? this.level.hAt(x, z) + 0.12 : 0.07, z);
      if (ow && !e.col && (k === 1 || k === 2 || k === 5 || k === 6)) {
        const rad = k === 2 ? r[5] : r[4], cm = new THREE.MeshBasicMaterial({ color: k === 5 ? 0xb56bff : k === 6 ? 0xff9a2a : 0xff3b3b, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
        e.col = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 9, 48, 1, true), cm); e.col.position.y = 4.5 - 2; e.col.renderOrder = 5; e.g.add(e.col);
      }
      if (e.col) e.col.material.opacity = blinkOn(f) ? 0.3 : 0.12 + 0.1 * f;
      if (k === 2) { const rr = e.r0 + (e.r1 - e.r0) * f; if (Math.abs(rr - (e.lastR || 0)) > 0.15) { e.fill.geometry.dispose(); e.fill.geometry = new THREE.RingGeometry(e.r0, Math.max(e.r0 + 0.01, rr), 64); e.lastR = rr; } }
      else if (k === 4) e.fill.scale.x = Math.max(0.01, f);
      else e.fill.scale.setScalar(Math.max(0.01, f));
      const blink = f > 0.82 && Math.floor(performance.now() / 70) % 2 === 0;
      if (e.edge) e.edge.material.opacity = blink ? 1 : 0.75;
      e.base.material.opacity = blink ? 0.3 : 0.14;
      if (e.swirl) e.swirl.rotation.z += 0.15;
    }
    for (const [id, e] of this.tgMeshes) if (!seen.has(id)) { this.scene.remove(e.g); this.tgMeshes.delete(id); }
    // shockwaves (jump over them): a glowing ring wall rolling outward along the floor
    const seenS = new Set();
    for (const [id, x, z, r, w] of shocks || []) {
      seenS.add(id);
      let m = this.swMeshes.get(id);
      if (!m) {
        m = new THREE.Group();
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.55, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
        wall.position.y = 0.28; m.add(wall);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.0, 64), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; m.add(ring);
        this.scene.add(m); this.swMeshes.set(id, m);
      }
      m.position.set(x, 0, z); m.scale.set(r, 1, r);
    }
    for (const [id, m] of this.swMeshes) if (!seenS.has(id)) { this.scene.remove(m); this.swMeshes.delete(id); }
  }
  // The moment a telegraphed attack lands.
  aoeFlash(e) {
    const col = e.k === 5 ? '#c58bff' : e.k === 6 ? '#ffb347' : '#ff5a4a';
    if (e.k === 1 || e.k === 6 || e.k === 5) { this.fieldRing(e.x, 0, e.z, e.a, col, 0.35); this.burst(e.x, 0.4, e.z, col, Math.min(40, 8 + e.a * 5), 7); }
    else if (e.k === 2) { this.fieldRing(e.x, 0, e.z, e.b, col, 0.35); for (let i = 0; i < 16; i++) { const t = i / 16 * 6.28, r = (e.a + e.b) / 2; this.burst(e.x + Math.cos(t) * r, 0.4, e.z + Math.sin(t) * r, col, 3, 5); } }
    else if (e.k === 3) { for (let i = 0; i < 12; i++) { const t = e.a - e.b / 2 + e.b * Math.random(), r = Math.random() * e.c; this.burst(e.x + Math.cos(t) * r, 0.4, e.z + Math.sin(t) * r, col, 3, 6); } }
    else if (e.k === 4) { for (let i = 0; i < 14; i++) { const r = i / 14 * Math.min(e.b, 40); this.burst(e.x + Math.cos(e.a) * r, 0.5, e.z + Math.sin(e.a) * r, col, 3, 5); } this.line(e.x, 0.6, e.z, e.x + Math.cos(e.a) * Math.min(e.b, 45), 0.6, e.z + Math.sin(e.a) * Math.min(e.b, 45), '#ffd0c8', 0.25); }
  }

  // ---------------- players ----------------
  makePlayer(v) {
    const tank = !!((v.flags || 0) & 1);
    const model = v.kind === 'core' ? this.buildCoreModel() : v.kind === 'boss' ? buildBossModel(v.color, v.cosmetics && v.cosmetics.boss) : v.kind === 'portal' ? buildPortalModel(v.color) : v.kind === 'hazardTurret' ? buildTurretModel() : v.kind === 'critter' ? buildCritterModel(v.color)
      : v.kind === 'splitter' ? buildBlobModel(v.color) : v.kind === 'blockTurret' ? buildBlockTurretModel(v.color) : v.kind === 'mount' ? buildMountTurretModel(v.color)
      : v.kind === 'brute' ? buildBruteModel(v.color) : v.kind === 'angel' ? buildAngelModel() : v.kind === 'amon' ? amonShooterModel(v.am)
      : tank ? buildTankModel(v.color) : buildPlayerModel(v.color, this.gunOf(v), this.bodyOf(v));
    if (v.kind === 'turret' || v.kind === 'drone') addUnitExtras(model, v.kind);
    if (v.kind === 'boss' && v.cosmetics && v.cosmetics.gold) {   // Space King's summon: (almost) all gold, whatever boss answered
      const gold = new THREE.Color(0xffc928);
      model.root.traverse(o => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        o.material = mats.map(m => {
          const c = m.clone();
          if (c.color) { const lum = c.color.r * 0.3 + c.color.g * 0.59 + c.color.b * 0.11; c.color.copy(gold).multiplyScalar(0.55 + 0.6 * lum); }
          if ('metalness' in c) { c.metalness = 0.75; c.roughness = 0.3; }
          if (c.emissive && c.emissiveIntensity > 0) c.emissive.set(0xffe27a);
          return c;
        });
        if (o.material.length === 1) o.material = o.material[0];
      });
    }
    if (v.raider && !tank) addRaiderMarks(model, v.kind);
    if (v.kind === 'decoy') model.root.traverse(o => {   // v1.2.15 Afterimage: a see-through copy
      if (!o.isMesh || !o.material) return;
      o.material = (Array.isArray(o.material) ? o.material : [o.material]).map(m => { const c = m.clone(); c.transparent = true; c.opacity = 0.42; c.depthWrite = false; return c; });
      if (o.material.length === 1) o.material = o.material[0];
    });
    const hairMod = (v.hairFrac ?? -1) >= 0;   // Super Saiyan Hair replaces the hat
    const cos = v.cosmetics && hairMod ? { ...v.cosmetics, hat: 'none' } : v.cosmetics;
    if (v.kind !== 'hazardTurret' && v.kind !== 'blockTurret' && v.kind !== 'mount' && v.kind !== 'boss' && !tank && cos) attachCosmetics(model, cos);
    if (tank && cos && cos.hat && !hairMod) model.root.add(buildTankHat(cos));   // your hat rides on the turret
    let hair = null;
    if (hairMod) {
      hair = buildSaiyanHair();
      if (tank) { hair.group.position.y = 0.75; hair.group.scale.setScalar(0.8); }
      else if (model.fit && model.fit.hat) {   // other characters: placed and scaled like a hat (fitCosmetics: p' = target + k * (p - anchor))
        // v1.2.17: it used to drop the hair's own height above the anchor (1.38 of 1.52) and ignore the hat scale, so on
        // most characters it sat sunk into the body or floated beside the head
        const [y, k, z] = model.fit.hat, ks = Array.isArray(k) ? k[0] : k || 1;
        hair.group.position.set(0, y + ks * (1.38 - 1.52), z || 0); hair.group.scale.setScalar(ks);
        for (const m of hair.bangs || []) m.visible = false;   // (the bangs are cut for the default dome; on other faces they covered the eyes)
      }
      (tank ? model.root : model.headNode || model.root).add(hair.group);
    }
    for (const m of model.hitMeshes) m.userData.player = v.id;
    // Anime mode (local setting): humanoid players swap their body and cosmetics for a body pillow (gun stays).
    const humanoid = !tank && (!v.kind || v.kind === 'hero' || v.raider || v.kind === 'decoy' || v.kind === 'soldier') && v.kind !== 'turret' && v.kind !== 'drone';
    let pillow = null, bodyParts = null;
    if (humanoid) {
      bodyParts = model.root.children.filter(o => o !== model.gunPivot && o !== model.shield);
      pillow = buildBodyPillow(v.color); pillow.visible = false; model.root.add(pillow);
    }
    this.scene.add(model.root);
    const c = document.createElement('canvas'); c.width = 256; c.height = 72;
    const tex = new THREE.CanvasTexture(c);
    const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    bar.scale.set(2.6, 0.73, 1); this.scene.add(bar);
    if (v.kind === 'boss') bar.scale.set(4.4, 1.24, 1);
    // Health regen outline (pulses while regenerating) and a quick green flash on each one-off heal.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barFxTex('glow'), transparent: true, depthWrite: false, opacity: 0 }));
    const healFx = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.barFxTex('flash'), transparent: true, depthWrite: false, opacity: 0 }));
    for (const s of [glow, healFx]) { s.scale.copy(bar.scale); s.renderOrder = 2; s.visible = false; this.scene.add(s); }
    bar.renderOrder = 1;
    const shadow = new THREE.Mesh(this.blobShadowGeo ||= new THREE.CircleGeometry(0.5, 20), this.blobShadowMat ||= new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));   // v1.2.6: one shared material
    shadow.rotation.x = -Math.PI / 2; this.scene.add(shadow);
    const e = { tank, raider: !!v.raider, kind: v.kind || '', am: v.am || '', glow, healFx, healT: 0, healN: v.healN || 0, model, root: model.root, bar, barCanvas: c, barTex: tex, barKey: '', shadow, color: v.color, gun: this.gunOf(v), phase: Math.random() * 10, slop: null,   // v1.2.4: slop bits are built only when that setting is on (36 meshes + a texture per model)
      hair, hairMod, hairBase: hair ? hair.group.scale.x : 1, body: this.bodyOf(v), walk: 0, slashN: v.slashN || 0, swingT: 0, pillow, bodyParts, pillowOn: false };
    this.players.set(v.id, e);
    return e;
  }
  // Damage over time (burn = 1, poison = 2): flames licking up the body or toxic bubbles rising off it, a body glow
  // that pulses with the damage ticks, and a tinted health-bar frame (drawBar). Sprites are pooled per player and
  // share two textures, so it stays cheap with many burning bots. The effects setting thins it out.
  dotTex(kind) {
    this.dotTexs = this.dotTexs || {};
    if (this.dotTexs[kind]) return this.dotTexs[kind];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    if (kind === 'flame') {   // a soft teardrop: white-yellow core, orange edge
      const gr = g.createRadialGradient(32, 42, 2, 32, 40, 26);
      gr.addColorStop(0, 'rgba(255,250,210,1)'); gr.addColorStop(0.35, 'rgba(255,190,60,0.95)'); gr.addColorStop(0.7, 'rgba(255,90,20,0.55)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(32, 2); g.bezierCurveTo(44, 22, 58, 34, 56, 46); g.bezierCurveTo(54, 60, 10, 60, 8, 46); g.bezierCurveTo(6, 34, 20, 22, 32, 2); g.fill();
    } else {                  // a bubble: green fill, bright rim and highlight
      g.fillStyle = 'rgba(110,230,90,0.55)'; g.beginPath(); g.arc(32, 32, 24, 0, 6.283); g.fill();
      g.lineWidth = 4; g.strokeStyle = 'rgba(190,255,150,0.95)'; g.stroke();
      g.fillStyle = 'rgba(240,255,230,0.9)'; g.beginPath(); g.arc(24, 23, 6, 0, 6.283); g.fill();
    }
    return (this.dotTexs[kind] = new THREE.CanvasTexture(c));
  }
  updateDot(e, st, hidden) {
    const q = this.settings.effects === 'off' ? 0 : this.settings.effects === 'low' ? 0.5 : 1;
    const t = performance.now() / 1000;
    if (!st) { if (e.dot) e.dot.group.visible = false; e.dotGlow = null; return; }
    if (!e.dot) {
      const group = new THREE.Group(), mk = kind => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dotTex(kind), transparent: true, depthWrite: false }));   // normal blending: reads on pale bodies too
        group.add(s); return { s, seed: Math.random() * 10, ang: Math.random() * 6.283 };
      };
      e.dot = { group, flames: Array.from({ length: 7 }, () => mk('flame')), bubbles: Array.from({ length: 5 }, () => mk('bubble')) };
      e.root.add(group);
    }
    const D = e.dot, burn = !!(st & 1), pois = !!(st & 2);
    D.group.visible = !hidden && q > 0;
    // Flames: each one loops from the feet to the shoulders, wavering and shrinking as it rises.
    D.flames.forEach((f, i) => {
      const on = burn && i < Math.ceil(D.flames.length * q);
      f.s.visible = on; if (!on) return;
      const life = 0.55 + (i % 3) * 0.12, ph = ((t + f.seed) / life) % 1, a = f.ang + t * 1.6 + i;
      const r = 0.5 + Math.sin(t * 7 + f.seed) * 0.05;   // just outside the body so it isn't hidden inside it
      f.s.position.set(Math.cos(a) * r, 0.25 + ph * 1.25, Math.sin(a) * r);
      const sz = (0.62 - ph * 0.38) * (0.85 + Math.sin(t * 23 + f.seed * 5) * 0.15);
      f.s.scale.set(sz * 0.8, sz * 1.15, 1);
      f.s.material.opacity = Math.min(1, (1 - ph) * 1.6) * 0.9;
    });
    // Poison: bubbles well up from inside the body, swell and pop near the head.
    D.bubbles.forEach((b, i) => {
      const on = pois && i < Math.ceil(D.bubbles.length * q);
      b.s.visible = on; if (!on) return;
      const life = 0.9 + (i % 2) * 0.3, ph = ((t + b.seed) / life) % 1, a = b.ang + i * 1.3;
      const r = 0.48 + 0.06 * Math.sin(b.seed + ph * 3);
      b.s.position.set(Math.cos(a) * r, 0.5 + ph * 1.2, Math.sin(a) * r);
      const sz = 0.12 + ph * 0.2 + (ph > 0.9 ? (ph - 0.9) * 1.5 : 0);
      b.s.scale.set(sz, sz, 1);
      b.s.material.opacity = ph > 0.9 ? (1 - ph) * 9 : 0.9;
    });
    // Body glow that throbs with the damage ticks (about 3 per second); poison's is a slower, sicklier pulse.
    const pulse = burn ? 0.5 + 0.5 * Math.sin(t * 19) * Math.sin(t * 7.3) : 0.5 + 0.5 * Math.sin(t * 11);
    e.dotGlow = burn ? { color: pois && Math.sin(t * 4) > 0 ? 0x2a9a28 : 0xc23c08, k: 0.12 + 0.22 * pulse } : { color: 0x228a26, k: 0.1 + 0.18 * pulse };
    // A few drifting embers / drips for motion beyond the body.
    if (q > 0 && !hidden && Math.random() < 0.18 * q) {
      const p = e.root.position, sz = e.root.scale.y || 1;
      if (burn) this.burst(p.x + (Math.random() - 0.5) * 0.6 * sz, p.y + (0.6 + Math.random()) * sz, p.z + (Math.random() - 0.5) * 0.6 * sz, Math.random() < 0.5 ? '#ff8a2a' : '#ffd166', 1, 2.5);
      if (pois) this.burst(p.x + (Math.random() - 0.5) * 0.6 * sz, p.y + (0.5 + Math.random() * 0.8) * sz, p.z + (Math.random() - 0.5) * 0.6 * sz, '#6fd65a', 1, 0.8);
    }
  }
  // ---------------- Napalm Rounds: fire splats stuck to surfaces ----------------
  // Each splat arrives as an event with its flame bits (already checked by the host to sit on real surface).
  // Every bit gets a small scorch mark flat on its surface and a flickering flame whose base sits on that spot.
  napalmSplat(e, color) {
    if (!this.napalm) this.napalm = [];
    // v1.2.9: at most 8 new splats in 8 ms (a napalm volley could make 180 at once and build them all in one frame: a hitch;
    // only the newest 48 are kept anyway)
    const tn = performance.now(); if (!(tn - (this.napT || 0) < 8)) { this.napT = tn; this.napBuilt = 0; }
    if (++this.napBuilt > 8) return;
    const q = this.settings.effects === 'off' ? 0.35 : this.settings.effects === 'low' ? 0.6 : 1;
    const n = new THREE.Vector3(e.n[0], e.n[1], e.n[2]), group = new THREE.Group(), flames = [];
    this.scorchGeo ||= new THREE.CircleGeometry(1, 14);
    this.scorchMat ||= new THREE.MeshBasicMaterial({ color: 0x2a1006, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const scorch = this.scorchMat.clone();   // per splat so it can fade out with the flames
    const glowCol = new THREE.Color(color).lerp(new THREE.Color(0xff7a20), 0.65);
    // v1.2.9: two flame materials per splat (all its flames fade together), not one per flame
    const fm = [0, 1].map(k => new THREE.SpriteMaterial({ map: this.dotTex('flame'), color: k ? 0xffffff : glowCol, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    for (let i = 0; i < e.b.length; i += 3) {
      const x = e.b[i], y = e.b[i + 1], z = e.b[i + 2], k = i / 3;
      const sc = new THREE.Mesh(this.scorchGeo, scorch);
      sc.position.set(x + n.x * 0.015, y + n.y * 0.015, z + n.z * 0.015); sc.quaternion.copy(quat); sc.scale.setScalar(0.16 + Math.random() * 0.1);
      group.add(sc);
      if (k % Math.round(1 / q) !== 0 && q < 1) continue;
      const s = new THREE.Sprite(fm[k % 3 === 0 ? 0 : 1]);
      s.center.set(0.5, 0.08);   // the flame's base sits on the surface, never above it
      s.position.set(x + n.x * 0.03, y + n.y * 0.02, z + n.z * 0.03);
      group.add(s); flames.push({ s, seed: Math.random() * 10, base: 0.55 + Math.random() * 0.3 });
    }
    this.scene.add(group);
    this.napalm.push({ id: e.id, group, flames, scorch, fm, life: e.life || 5, max: e.life || 5, bits: e.b });
    if (this.napalm.length > 48) { const old = this.napalm.shift(); this.scene.remove(old.group); }
  }
  updateNapalm(dt) {
    if (!this.napalm || !this.napalm.length) return;
    const t = performance.now() / 1000;
    for (const f of this.napalm) {
      f.life -= dt;
      const grow = Math.min(1, (f.max - f.life) / 0.18), fade = Math.min(1, f.life / 0.8);
      for (const fl of f.flames) {
        const flick = 0.75 + 0.25 * Math.sin(t * 17 + fl.seed * 7) * Math.sin(t * 6.1 + fl.seed);
        const h = fl.base * grow * fade * flick;
        fl.s.scale.set(h * 0.75, h * 1.25, 1);
      }
      if (f.fm) for (const m of f.fm) m.opacity = 0.9 * fade; else for (const fl of f.flames) fl.s.material.opacity = 0.9 * fade;
      f.scorch.opacity = 0.22 * fade;
      if (this.settings.effects !== 'off' && Math.random() < 0.06 * f.flames.length * dt * 10 / 3) {   // a few embers drifting up
        const i = Math.floor(Math.random() * (f.bits.length / 3)) * 3;
        this.burst(f.bits[i], f.bits[i + 1] + 0.15, f.bits[i + 2], Math.random() < 0.5 ? '#ff8a2a' : '#ffd166', 1, 1.6);
      }
      if (f.life <= 0) this.scene.remove(f.group);
    }
    this.napalm = this.napalm.filter(f => f.life > 0);
  }
  clearNapalm() { for (const f of this.napalm || []) this.scene.remove(f.group); this.napalm = []; this.clearBlotches(); }
  // ---------------- poison puddles (co-op blobs, Brood Mother spit) ----------------
  // Deliberately low-fi: a few flat, overlapping green squares on the floor that bob a little and fade out.
  poisonBlotch(e) {
    if (!this.blotches) this.blotches = [];
    this.blotchGeo ||= new THREE.PlaneGeometry(1, 1);
    const group = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0x6fd65a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const dark = mat.clone(); dark.color.set(0x2f7a24);
    const n = 5 + Math.round(e.r * 2), sq = [];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.28, d = k === 0 ? 0 : Math.sqrt(Math.random()) * e.r * 0.7, s = (k === 0 ? e.r * 1.1 : e.r * (0.35 + Math.random() * 0.35));
      const m = new THREE.Mesh(this.blotchGeo, k % 3 === 2 ? dark : mat);
      m.rotation.set(-Math.PI / 2, 0, Math.random() * 6.28); m.position.set(Math.cos(a) * d, 0.02 + k * 0.002, Math.sin(a) * d); m.scale.set(s, s, 1);
      group.add(m); sq.push(m);
    }
    group.position.set(e.x, e.y, e.z);
    this.scene.add(group);
    this.blotches.push({ id: e.id, group, mats: [mat, dark], sq, life: e.life || 6, max: e.life || 6, x: e.x, y: e.y, z: e.z, r: e.r });
    if (this.blotches.length > 40) { const old = this.blotches.shift(); this.scene.remove(old.group); }
  }
  updateBlotches(dt) {
    if (!this.blotches || !this.blotches.length) return;
    for (const b of this.blotches) {
      b.life -= dt;
      const grow = Math.min(1, (b.max - b.life) / 0.25), fade = Math.min(1, b.life / 1.0);
      b.group.scale.setScalar(0.3 + 0.7 * grow);
      b.mats[0].opacity = 0.55 * fade; b.mats[1].opacity = 0.6 * fade;
      if (this.settings.effects !== 'off' && Math.random() < dt * 2.5) {   // a rare square bubble popping up
        const a = Math.random() * 6.28, d = Math.random() * b.r * 0.7;
        this.burst(b.x + Math.cos(a) * d, b.y + 0.1, b.z + Math.sin(a) * d, '#8be86f', 1, 0.6);
      }
      if (b.life <= 0) this.scene.remove(b.group);
    }
    this.blotches = this.blotches.filter(b => b.life > 0);
  }
  clearBlotches() { for (const b of this.blotches || []) this.scene.remove(b.group); this.blotches = []; }

  // ---------------- Bullet Time: the slow field's floor pulse ----------------
  // Two soft rings in a lighter shade of the holder's color roll out from their feet along the floor and settle
  // at the field's edge before fading, so the pulse itself marks the zone. Visible to everyone, no solid outline.
  updateField(e, v, hidden) {
    const R = v.alive ? v.fieldR || 0 : 0;
    if (!R) { if (e.field) e.field.group.visible = false; return; }
    if (!e.field) {
      const group = new THREE.Group(), col = new THREE.Color(v.color).lerp(new THREE.Color(0xffffff), 0.55);
      this.fieldGeo ||= new THREE.RingGeometry(0.975, 1, 72);
      const rings = [0, 1].map(() => {
        const m = new THREE.Mesh(this.fieldGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
        m.rotation.x = -Math.PI / 2; group.add(m); return m;
      });
      e.field = { group, rings };
      this.scene.add(group);
    }
    const F = e.field, t = performance.now() / 1000, period = 1.7;
    F.group.visible = !hidden;
    const gy = this.level ? groundBelow(this.level.solids, v.pos.x, v.pos.z, v.pos.y + 0.1) : 0;
    F.group.position.set(v.pos.x, gy + 0.04, v.pos.z);
    F.rings.forEach((m, i) => {
      const ph = ((t / period) + i * 0.5) % 1, ease = 1 - Math.pow(1 - ph, 3);
      m.scale.setScalar(Math.max(0.3, R * ease));
      m.material.opacity = 0.3 * Math.min(1, ph / 0.12) * Math.min(1, (1 - ph) / 0.25);
    });
  }
  // AI slop mode decorations (hidden unless the setting is on).
  makeSlopBits(color) {
    const group = new THREE.Group(); group.visible = false;
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).offsetHSL(0.5, 0, 0), roughness: 0.4 });
    const pupils = [];
    for (const [x, y, r] of [[-0.17, 1.28, 0.16], [0.17, 1.28, 0.12], [0.02, 1.47, 0.09]]) { // yes, three eyes
      const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), white);
      eye.position.set(x, y, 0.36); group.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.4, 10, 8), black);
      pupil.position.set(x, y, 0.36 + r * 0.9); pupil.userData.x0 = x; group.add(pupil); pupils.push(pupil);
    }
    for (const side of [-1, 1, 0.6]) {   // and a bonus third arm
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), skin);
      arm.position.set(side * 0.55, side === 0.6 ? 0.55 : 0.85, side === 0.6 ? -0.2 : 0.1); arm.rotation.z = side * 1.1; group.add(arm);
      for (let f = 0; f < 9; f++) { // count the fingers
        const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 4), skin);
        finger.position.set(side * 0.86, (side === 0.6 ? 0.72 : 1.02) + (f - 4) * 0.03, side === 0.6 ? -0.2 : 0.1); finger.rotation.z = side * (0.6 + f * 0.18);
        group.add(finger);
      }
    }
    // floating emoji that cycles above the head
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const tex = new THREE.CanvasTexture(c);
    const emoji = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    emoji.position.set(0, 2.9, 0); emoji.scale.setScalar(0.8); group.add(emoji);
    const draw = ch => { const g = c.getContext('2d'); g.clearRect(0, 0, 64, 64); g.font = '48px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 32, 36); tex.needsUpdate = true; };
    draw('✨');
    return { group, pupils, emoji, draw, emojiT: Math.random() * 3 };
  }
  // The gun model: your gun skin, or the sword while you hold the Katana weapon mod.
  bodyOf(v) { return v.raider ? 'classic' : (v.cosmetics && v.cosmetics.model) || 'classic'; }   // co-op raiders keep the classic look
  gunOf(v) { return v.mod === 'katana' ? 'katana' : (v.cosmetics && v.cosmetics.gun) || 'cube'; }
  // v1.0.7: open world, once you're out: every player still in gets a see-through colored silhouette and a name
  // tag that show through walls and at any distance (only on your screen), so you can find them anywhere on the map.
  // v1.1.6 Brawl: a glowing ring under your feet while your second jump (the one you can hold to charge a dash) is
  // ready. Only drawn for your own player; it goes when you use it and comes back when you land or get it back.
  syncJumpMark(local) {
    const on = !!(local && local.alive && ((local.flags || 0) & 64));
    let m = this.jumpMark;
    if (!on) { if (m) m.visible = false; return; }
    if (!m) {
      m = this.jumpMark = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.6, 32), new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      m.renderOrder = 998; this.scene.add(m);
    }
    const s = local.size || 1, t = performance.now() / 1000;
    m.visible = true;
    m.position.set(local.pos.x, local.pos.y - 0.12 * s, (local.pos.z || 0) + 0.6);
    m.scale.set(s * (1 + 0.08 * Math.sin(t * 7)), s * 0.45, 1);   // a flattened ellipse, like a pad under the feet
    m.material.opacity = 0.65 + 0.25 * Math.sin(t * 7);
  }
  syncSpecMarks(list, localId) {
    const me = list.find(v => v.id === localId), on = !!(this.level && this.level.open && me && !me.alive);
    const marks = this.specMarks || (this.specMarks = new Map());
    const drop = (id, m) => {
      this.scene.remove(m.tag); m.tag.material.map.dispose(); m.tag.material.dispose();
      for (const sh of m.shells) if (sh.parent) sh.parent.remove(sh);
      m.mat.dispose(); marks.delete(id);
    };
    for (const [id, m] of marks) { const v = list.find(q => q.id === id); if (!on || !v || !v.alive || this.players.get(id) !== m.e) drop(id, m); }
    if (!on) return;
    for (const v of list) {
      if (!v.alive || v.id === localId || (v.kind && v.kind !== 'hero')) continue;
      const e = this.players.get(v.id); if (!e) continue;
      let m = marks.get(v.id);
      if (!m) {
        const mat = new THREE.MeshBasicMaterial({ color: v.color, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, fog: false, side: THREE.BackSide });
        const shells = [];
        e.root.traverse(o => { if (o.isMesh && o.visible && o.geometry && o.material && !o.material.transparent && !o.userData.specShell) shells.push(o); });
        const made = shells.map(o => { const sh = new THREE.Mesh(o.geometry, mat); sh.userData.specShell = true; sh.scale.setScalar(1.12); sh.renderOrder = 998; sh.castShadow = sh.receiveShadow = false; o.add(sh); return sh; });
        const c = document.createElement('canvas'); c.width = 256; c.height = 96;
        const g = c.getContext('2d'); g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.fillStyle = v.color;
        const nm = String(v.name || '').slice(0, 14); g.strokeText(nm, 128, 38); g.fillText(nm, 128, 38);
        g.beginPath(); g.moveTo(108, 54); g.lineTo(148, 54); g.lineTo(128, 88); g.closePath(); g.stroke(); g.fill();
        const tex = new THREE.CanvasTexture(c);
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false, transparent: true }));
        tag.scale.set(0.22, 0.083, 1); tag.renderOrder = 999; this.scene.add(tag);
        m = { e, mat, shells: made, tag }; marks.set(v.id, m);
      }
      const p = e.root.position; m.tag.position.set(p.x, p.y + 2.6 * (e.root.scale.y || 1), p.z);
    }
  }
  removePlayer(id) {
    const e = this.players.get(id); if (!e) return;
    if (e.field) this.scene.remove(e.field.group);
    this.scene.remove(e.root, e.bar, e.shadow, e.glow, e.healFx); this.players.delete(id);
    e.barTex.dispose();   // v1.2.4: free the name/health bar texture (wave units come and go all match)
  }
  // Shared overlay textures for the floating health bar (same 256x72 layout as drawBar: bar box at 16,38 224x22).
  barFxTex(kind) {
    this.barFx = this.barFx || {};
    if (this.barFx[kind]) return this.barFx[kind];
    const c = document.createElement('canvas'); c.width = 256; c.height = 72;
    const g = c.getContext('2d');
    if (kind === 'glow') { g.shadowColor = '#5fe378'; g.shadowBlur = 10; g.strokeStyle = '#7dff95'; g.lineWidth = 4; for (let i = 0; i < 2; i++) g.strokeRect(14, 36, 228, 26); }
    else { g.fillStyle = '#6dff8a'; g.fillRect(16, 38, 224, 22); }
    return (this.barFx[kind] = new THREE.CanvasTexture(c));
  }
  drawBar(e, v, isLocal) {
    const dot = v.alive ? (v.status || 0) & 3 : 0;
    const hp = Math.max(0, Math.ceil(v.hp)), frac = clamp(hp / (v.maxHp || 1), 0, 1);
    // v1.2.0: lost health stays as a white chunk for a moment, then drains away (reads every hit at a glance)
    const now = performance.now() / 1000;
    if (e.gh == null || frac >= e.gh) e.gh = frac;
    else if (frac < (e.ghLast ?? frac)) e.ghT = now;
    else if (now - (e.ghT || 0) > 0.3) e.gh = Math.max(frac, e.gh - (now - (e.ghTick || now)) * 1.1);
    e.ghLast = frac; e.ghTick = now;
    const key = `${hp}|${v.maxHp}|${v.name}|${isLocal}|${dot}|${v.pct}|${e.gh > frac ? Math.round(e.gh * 40) : -1}`;   // v1.2.6: the draining ghost repaints in 40 steps (was every frame)
    if (key === e.barKey) return;
    e.barKey = key;
    const g = e.barCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 72);
    g.font = '600 24px "Chakra Petch", system-ui, sans-serif'; g.textAlign = 'center';
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.65)';
    const label = isLocal ? 'You' : (v.name || '');
    g.strokeText(label, 128, 26); g.fillStyle = '#fff'; g.fillText(label, 128, 26);
    if (v.pct != null) {   // brawl: damage % instead of a health bar (white, turning red as it climbs)
      g.font = '700 34px "Chakra Petch", system-ui, sans-serif'; g.lineWidth = 6;
      g.strokeText(v.pct + '%', 128, 66); g.fillStyle = `hsl(${Math.max(0, 50 - v.pct * 0.35)}, 100%, ${Math.max(45, 95 - v.pct * 0.3)}%)`; g.fillText(v.pct + '%', 128, 66);
      e.barTex.needsUpdate = true; return;
    }
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(16, 38, 224, 22);
    if (e.gh > frac) { g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(19, 41, 218 * e.gh, 16); }
    g.fillStyle = v.color; g.fillRect(19, 41, 218 * frac, 16);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.strokeRect(16, 38, 224, 22);
    if (dot) {   // burning / poisoned: the bar's frame takes the effect's color (half and half when both)
      g.lineWidth = 3;
      const cols = [dot & 1 ? '#ff8a2a' : null, dot & 2 ? '#7ee36b' : null].filter(Boolean);
      cols.forEach((c, i) => { g.strokeStyle = c; g.beginPath(); const x0 = 15 + i * 113, w = cols.length > 1 ? 113 : 226; g.rect(x0, 37, w, 24); g.stroke(); });
    }
    e.barTex.needsUpdate = true;
  }

  syncPlayers(list, localId) {
    const fp = this.settings.view === 'first', seen = new Set();
    let built = 0;
    for (const v of list) {
      seen.add(v.id);
      let e = this.players.get(v.id);
      if (e && (e.color !== v.color || e.gun !== this.gunOf(v) || (e.body && e.body !== this.bodyOf(v)) || e.tank !== !!((v.flags || 0) & 1) || e.raider !== !!v.raider || e.kind !== (v.kind || '') || e.am !== (v.am || '') || e.hairMod !== ((v.hairFrac ?? -1) >= 0))) { this.removePlayer(v.id); e = null; }
      else if (!e && built >= 3 && v.id !== localId) continue;   // v1.2.6: at most 3 new models a frame (a wave spawning at once was one long hitch); the rest appear over the next frames
      if (!e) { built++; e = this.makePlayer(v); }
      // First person hides your own model, except Tiny Tank, which gets an over-the-shoulder view of the tank.
      const isLocal = v.id === localId, hideSelf = isLocal && fp && !((v.flags || 0) & 1) && !this.owOts;
      // Extraction: a fallen teammate's body stays on the ground (lying down) so the squad can stand on it and revive them.
      const downed = !v.alive && this.owDowned && (!v.kind || v.kind === 'hero') && !v.raider && !isLocal;
      e.root.visible = (v.alive || downed) && !hideSelf;
      e.root.rotation.x = downed ? -Math.PI / 2 : 0;
      if (v.kind === 'core' || (v.kind === 'blockTurret' && this.coreMode)) this.shadeByHealth(e, v.hp / (v.maxHp || 1));   // Core Defense: darker = more damaged
      const size = v.size || 1;
      e.root.position.set(v.pos.x, v.pos.y, v.pos.z);
      // Ice Sheets (v26): in the water the body sinks to about the waist, so it reads as swimming
      if (this.level && this.level.ice) {
        const inWater = v.alive && v.pos.y < 0.05 && !v.flying;
        e.swim = (e.swim || 0) + ((inWater ? 0.55 * size : 0) - (e.swim || 0)) * 0.2;
        e.root.position.y -= e.swim;
        if (inWater && Math.random() < 0.12 && this.settings.effects !== 'off') this.ring(v.pos.x, 0.05, v.pos.z, 0.9 * size, '#cfefff');
      }
      // side view: face left or right, turned a little toward the camera so faces still show
      e.root.rotation.y = this.level && this.level.side ? (v.aim.x < 0 ? -1.25 : 1.25) : Math.atan2(v.aim.x, v.aim.z);
      if (e.model.animate) {   // idle + walk motion; walk (0..1) comes from how fast the model moved since last frame
        const now = performance.now() / 1000, dt = e.animT ? Math.min(0.1, now - e.animT) : 0;
        const sp = dt > 0 ? Math.hypot(v.pos.x - e.lastX, v.pos.z - e.lastZ) / dt : 0;
        e.animT = now; e.lastX = v.pos.x; e.lastZ = v.pos.z;
        e.walk += ((v.alive ? Math.min(1, sp / 5) * 0.7 : 0) - e.walk) * Math.min(1, dt * 10);
        e.model.animate(now + e.phase, e.walk);
      }
      if (this.settings.slop && !e.slop) { e.slop = this.makeSlopBits(e.color); e.root.add(e.slop.group); }
      if (this.settings.slop) {
        const t = performance.now() / 1000 + e.phase;
        e.root.scale.set(size * (1 + Math.sin(t * 9) * 0.12), size * (1 + Math.cos(t * 7) * 0.18), size * (1 + Math.sin(t * 11) * 0.12));
        e.root.rotation.z = Math.sin(t * 5) * 0.15;
        for (const eye of e.slop.pupils) eye.position.x = eye.userData.x0 + Math.sin(t * 13 + eye.userData.x0 * 9) * 0.035;
        e.slop.emoji.position.y = 2.9 + Math.sin(t * 3) * 0.15;
        if ((e.slop.emojiT -= 1 / 60) <= 0) { e.slop.emojiT = 1.5 + Math.random() * 2; e.slop.draw(['✨', '💯', '🔥', '🚀', '🧠', '🙌', '🤖', '💎', '📈'][Math.floor(Math.random() * 9)]); }
      } else { const sq = this.squash(e, v); e.root.scale.set(size * sq.xz, size * ((v.flags || 0) & 32 ? 0.7 : 1) * sq.y, size * sq.xz); e.root.rotation.z = 0; }   // flag 32: crouching (open world)
      if (e.slop) e.slop.group.visible = !!this.settings.slop;
      if (e.pillow && e.pillowOn !== !!this.settings.pillow) {
        e.pillowOn = !!this.settings.pillow; e.pillow.visible = e.pillowOn;
        for (const o of e.bodyParts) o.visible = !e.pillowOn;
      }
      e.model.gunPivot.rotation.x = -Math.asin(clamp(v.aim.y, -1, 1));
      this.updateKatana(e, v);
      this.updateHair(e, v);
      e.model.shield.visible = v.blocking;
      this.updateHoly(e, v);
      // Tiny Tank: the hull turns toward where you drive, the turret follows your aim
      if (e.model.hull && v.vel && Math.hypot(v.vel.x, v.vel.z) > 0.6) {
        let rel = Math.atan2(v.vel.x, v.vel.z) - e.root.rotation.y;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        if (Math.abs(rel) > Math.PI / 2) rel -= Math.sign(rel) * Math.PI;   // tanks drive backwards too
        const cur = e.model.hull.rotation.y, d = Math.atan2(Math.sin(rel - cur), Math.cos(rel - cur));
        e.model.hull.rotation.y = cur + d * 0.2;
      }
      // Cursed life drain: a faint red haze
      if (v.alive && ((v.flags || 0) & 4) && Math.random() < 0.12) this.burst(v.pos.x + (Math.random() - 0.5) * 0.8, v.pos.y + Math.random() * 1.4 * (v.size || 1), v.pos.z + (Math.random() - 0.5) * 0.8, '#e0464b', 1, 1);
      if (v.blocking) { e.model.shield.scale.setScalar(v.blockSize || 1); this.styleBubble(e, v); }
      if (e.model.rotor) e.model.rotor.rotation.y += 0.6;
      if (e.model.spin) e.model.spin.rotation.z += 0.09;
      if (e.model.blob) { const t = performance.now() / 1000 * 5 + (e.seed || (e.seed = Math.random() * 6)), q = Math.abs(Math.sin(t)); e.model.blob.scale.set(1 + 0.08 * (1 - q), 0.9 + 0.16 * q, 1 + 0.08 * (1 - q)); }
      if (e.model.coreMat) { const B = this.bossInfo, ph = B ? B[3] : 1, t = performance.now() / 1000; e.model.coreMat.emissiveIntensity = 0.8 + ph * 0.5 + Math.sin(t * (2 + ph * 2)) * 0.35; e.model.coreMat.emissive.setHex(B && B[4] ? 0xff2200 : ph >= 3 ? 0xff3a10 : 0xff6a00); e.model.crown.rotation.z += 0.02 * ph; }
      // Riot Shield weapon mod
      if (v.mod === 'shield' && !e.riot) { e.riot = buildRiotShield(v.color); e.root.add(e.riot.group); }
      if (e.riot) {
        e.riot.group.visible = v.mod === 'shield' && !e.tank;   // Tiny Tank drops the shield, keeps the charge
        const rf = v.riotFrac ?? 1;
        e.riot.rim.material.color.set(v.broken ? 0xff4040 : rf > 0.5 ? 0x4fa8ff : 0xffb347);
        e.riot.face.material.opacity = v.broken ? 0.15 : 0.3 + 0.35 * rf;
        if (v.broken) e.riot.face.material.color.set(0xff4040); else e.riot.face.material.color.set(v.color);
        const ch = v.charge || 0, pulse = ch ? 1 + Math.sin(performance.now() / 70) * 0.08 : 1;
        e.riot.orb.visible = ch > 0; e.riot.orb.scale.setScalar((0.6 + ch * 0.35) * pulse);
        e.riot.face.material.emissiveIntensity = 0.15 + Math.min(1, ch * 0.15);
        if (ch > 0 && Math.random() < 0.5) this.burst(v.pos.x + v.aim.x * 1.1, v.pos.y + 0.9 * (v.size || 1), v.pos.z + v.aim.z * 1.1, v.color, 1, 2);
      }
      // status effects: burning, poisoned, chilled, hexed
      // (burning and poison get their own effect: flames / bubbles on the body, a glow pulse and a tinted bar; updateDot)
      this.updateDot(e, v.alive ? (v.status || 0) & 3 : 0, hideSelf);
      this.updateField(e, v, false);
      if (v.alive && (v.status & 12) && Math.random() < 0.35) {
        const y = v.pos.y + (0.4 + Math.random()) * (v.size || 1);
        if (v.status & 4) this.burst(v.pos.x, y, v.pos.z, '#9fe7ff', 1, 1);
        if (v.status & 8) this.burst(v.pos.x, y, v.pos.z, '#b07bff', 1, 1.5);
      }
      if (v.alive && ((v.flags || 0) & 128) && this.settings.effects !== 'off') {   // v1.2.13 (Devin): pushed by Thrust: a hot streak and sparks trail behind
        const sz = v.size || 1, vx = (v.vel && v.vel.x) || 0, vz = (v.vel && v.vel.z) || 0, sp = Math.hypot(vx, vz) || 1;
        for (let k = 0; k < 2; k++) {
          const back = 0.3 + Math.random() * 0.5;
          this.burst(v.pos.x - vx / sp * back * sz, v.pos.y + (0.3 + Math.random() * 1.1) * sz, v.pos.z - vz / sp * back * sz, Math.random() < 0.5 ? '#ffb347' : '#fff1c2', 1, 0.8);
        }
      }
      if (v.alive && (v.status & 16) && Math.random() < 0.45) {   // wet and slowed (Ice Sheets water): icy drips and frost bits
        const a = Math.random() * 6.28, r = 0.35 * (v.size || 1);
        this.burst(v.pos.x + Math.cos(a) * r, v.pos.y + (0.5 + Math.random() * 0.8) * (v.size || 1), v.pos.z + Math.sin(a) * r, Math.random() < 0.5 ? '#bfe9ff' : '#ffffff', 1, 0.6);
      }
      for (const m of e.model.tint) if (m.emissive) {
        if (v.flash || !e.dotGlow) { m.emissive.setHex(v.flash ? 0xffffff : 0x000000); if (e.dotWasGlow) m.emissiveIntensity = 1; }
        else { m.emissive.setHex(e.dotGlow.color); m.emissiveIntensity = e.dotGlow.k; }
      }
      e.dotWasGlow = !!e.dotGlow;
      // charging Hair / Pentagram: the body glows in the mod's color
      if (v.holding && v.alive && !v.flash) { const now = performance.now() / 1000; for (const mt of e.model.tint) if (mt.emissive) { mt.emissive.set(e.hair ? 0xffc21a : v.holdHoly ? 0xffe9a0 : 0x9b3bff); mt.emissiveIntensity = 0.3 + Math.sin(now * 20) * 0.12; } e.holdGlow = true; }
      else if (e.holdGlow) { e.holdGlow = false; for (const mt of e.model.tint) if (mt.emissive) { if (!e.dotGlow) mt.emissive.setHex(v.flash ? 0xffffff : 0); mt.emissiveIntensity = 1; } }
      e.bar.visible = v.alive && !hideSelf && !(isLocal && fp);
      if (e.bar.visible) { e.bar.position.set(v.pos.x, v.pos.y + 2.2 * size + 0.1, v.pos.z); this.drawBar(e, v, isLocal); }
      // regen pulse / heal flash
      const nowS = performance.now() / 1000;
      if ((v.healN || 0) !== e.healN) { e.healN = v.healN || 0; e.healAt = nowS; }
      e.healT = Math.max(0, 0.35 - (nowS - (e.healAt ?? -9)));
      const regen = !!((v.flags || 0) & 16);
      e.glow.visible = e.bar.visible && regen;
      if (e.glow.visible) { e.glow.position.copy(e.bar.position); e.glow.material.opacity = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(performance.now() / 1000 * Math.PI * 2 / 1.8)); }
      e.healFx.visible = e.bar.visible && e.healT > 0;
      if (e.healFx.visible) { e.healFx.position.copy(e.bar.position); e.healFx.material.opacity = 0.85 * e.healT / 0.35; }
      e.shadow.visible = v.alive && !hideSelf && !!this.level && !this.level.side;   // side view: no floor decals (seen edge-on)
      if (e.shadow.visible) {
        const gy = groundBelow(this.level.solids, v.pos.x, v.pos.z, v.pos.y);
        const k = clamp(1 - (v.pos.y - gy) / 4, 0.35, 1);
        e.shadow.position.set(v.pos.x, gy + 0.02, v.pos.z); e.shadow.scale.setScalar(k * size);
      }
      if (isLocal) {
        this.marker.visible = v.alive && !fp && !(this.level && this.level.side);
        this.marker.position.set(v.pos.x, (this.level ? groundBelow(this.level.solids, v.pos.x, v.pos.z, v.pos.y) : 0) + 0.03, v.pos.z);
        this.marker.material.color.set(v.color); this.marker.scale.setScalar(v.size || 1);
        this.skyMarker.visible = v.alive && !!v.sky && !!v.aimPoint;
        if (this.skyMarker.visible) {
          const L = this.level || { hx: 99, hz: 99, solids: [] };
          const ax = clamp(v.aimPoint.x, -L.hx + 0.5, L.hx - 0.5), az = clamp(v.aimPoint.z, -L.hz + 0.5, L.hz - 0.5);
          this.skyMarker.position.set(ax, groundBelow(L.solids, ax, az, Math.max(0.3, v.aimPoint.y)) + 0.04, az);
        }
      }
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.removePlayer(id);
    if (!list.some(v => v.id === localId)) { this.marker.visible = false; this.skyMarker.visible = false; }
  }

  // Block bubble looks: white by default, electric blue with crackling arcs for Shock Bubble,
  // green for Siphon Shield.
  styleBubble(e, v) {
    const sh = e.model.shield, fx = v.blockFx || 0, shock = !!(fx & 1), leech = !!(fx & 2);
    const pillar = !!((v.flags || 0) & 2), catcher = !!((v.flags || 0) & 8);
    const key = fx + '|' + v.kind + '|' + pillar + '|' + catcher;
    if (sh.userData.key !== key && sh.material.uniforms) {
      sh.userData.key = key;
      const base = v.kind === 'hazardTurret' ? 0xff6b6b : shock ? 0x7fd8ff : leech ? 0x6dffb0 : pillar ? 0xffd27a : catcher ? 0xc79bff : 0xffffff;
      for (const m of [sh.material, sh.userData.halo && sh.userData.halo.material]) if (m) { m.uniforms.color.value.set(base); m.uniforms.shock.value = shock ? 1 : 0; }
      sh.material.uniforms.opacity.value = shock ? 0.22 : 0.16;
      if (sh.userData.halo) sh.userData.halo.material.uniforms.opacity.value = shock ? 0.95 : 0.5;
    }
    if ((v.tsFrac ?? -1) >= 0 && sh.material.uniforms) {   // Turret (and angel) bubble: turns red as it nears breaking
      const f = clamp(v.tsFrac, 0, 1), col = new THREE.Color(0xffffff).lerp(new THREE.Color(0xff2a2a), Math.pow(1 - f, 0.8));
      sh.material.uniforms.color.value.copy(col); if (sh.userData.halo) sh.userData.halo.material.uniforms.color.value.copy(col);
      sh.material.uniforms.opacity.value = 0.16 + 0.14 * (1 - f) + (f < 0.3 ? Math.sin(performance.now() / 90) * 0.05 : 0);
    }
    if (pillar && sh.material.uniforms) {   // Pillar Shield: brighter and pulsing, fading as its health drops
      const pf = Math.max(0, v.pillarFrac ?? 1);
      sh.material.uniforms.opacity.value = 0.14 + 0.2 * pf + Math.sin(performance.now() / 300) * 0.03;
      if (sh.userData.halo) sh.userData.halo.material.uniforms.opacity.value = 0.45 + 0.5 * pf;
    }
    if (shock) {
      if (!e.arcs) { e.arcs = this.makeArcs(6, 0xbff4ff); sh.add(e.arcs.group); }
      e.arcs.group.visible = true;
      const R = sh.userData.radius || 1.05;
      this.updateArcs(e.arcs, (a, i) => { // jagged arcs crawling over the sphere surface
        const p = new THREE.Vector3().randomDirection ? new THREE.Vector3().randomDirection() : new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        const t = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(p).normalize();
        const pts = [];
        for (let k = 0; k < 7; k++) { const q = p.clone().applyAxisAngle(t, k * 0.16).multiplyScalar(R * (1.02 + Math.random() * 0.08)); q.x += (Math.random() - 0.5) * 0.1; q.y += (Math.random() - 0.5) * 0.1; pts.push(q); }
        return pts;
      });
      if (Math.random() < 0.25 * (this.settings.effects === 'off' ? 0 : 1)) {
        const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(R * (v.blockSize || 1) * (v.size || 1));
        this.burst(v.pos.x + d.x, v.pos.y + 0.8 * (v.size || 1) + d.y, v.pos.z + d.z, '#bff4ff', 1, 3);
      }
    } else if (e.arcs) e.arcs.group.visible = false;
  }
  makeArcs(n, color) {
    const group = new THREE.Group(), lines = [];
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < n; i++) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), mat); l.frustumCulled = false; group.add(l); lines.push(l); }
    return { group, lines, t: 0 };
  }
  updateArcs(arcs, gen) {
    const now = performance.now();
    if (now - arcs.t < 55) return;
    arcs.t = now;
    arcs.lines.forEach((l, i) => { l.visible = Math.random() < 0.8; if (l.visible) { l.geometry.dispose(); l.geometry = new THREE.BufferGeometry().setFromPoints(gen(arcs, i)); } });
  }

  // Katana slash wave: a flat glowing crescent (bowed toward where it flies), as wide as its hit width.
  makeSlashWave(b) {
    const w = parseFloat(String(b.fx).split(':')[1]) || 0.8;
    const g = new THREE.Group(); g.userData = { slash: true, born: performance.now(), w };
    const arc = (r0, r1, color, op) => {
      const geo = new THREE.RingGeometry(r0, r1, 24, 1, Math.PI / 2 - 1.15, 2.3);   // centered on +y in the ring's plane
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = Math.PI / 2;  // lay flat; the bulge then points along +z (the flight direction after rotation.y)
      m.position.z = -w * 0.85; g.add(m); return m;
    };
    arc(w * 0.62, w * 1.0, b.color, 0.55);
    g.userData.core = arc(w * 0.8, w * 0.93, 0xffffff, 0.8);
    const tilt = new THREE.Group(); tilt.add(...g.children); g.add(tilt); tilt.rotation.z = 0.25;
    return g;
  }
  // A katana swing: a quick crescent sweep in front of the player.
  slashFx(e, color) {
    if (this.settings.effects === 'off' && !this.players.has(e.p)) return;
    const r = (e.r || 2) + 0.2, arcW = (e.arc || 1.1) * 2;
    const geo = new THREE.RingGeometry(r * 0.45, r, 28, 1, Math.PI / 2 - arcW / 2, arcW);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat);
    const hold = new THREE.Group(); hold.add(m); m.rotation.x = Math.PI / 2;
    const white = new THREE.Mesh(new THREE.RingGeometry(r * 0.88, r * 0.97, 28, 1, Math.PI / 2 - arcW / 2, arcW), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    white.rotation.x = Math.PI / 2; hold.add(white);
    hold.position.set(e.x, e.y, e.z); hold.rotation.y = Math.atan2(e.ax, e.az); hold.rotation.z = (Math.random() - 0.5) * 0.6;
    this.scene.add(hold);
    this.fx.push({ m: hold, life: 0.18, max: 0.18, update: f => { const k = Math.max(0, f.life / f.max); mat.opacity = 0.8 * k; white.material.opacity = 0.9 * k; hold.scale.setScalar(1 + (1 - k) * 0.15); } });
    const pe = this.players.get(e.p); if (pe) pe.swingT = 1;
    if (e.p === this.localId) this.fpSwing = 1;
  }
  // A bullet cut in half: a bright spark cross.
  cutFx(e, color) {
    this.burst(e.x, e.y, e.z, '#ffffff', 6, 5); this.burst(e.x, e.y, e.z, color, 4, 3);
    const a = Math.random() * Math.PI;
    this.line(e.x - Math.cos(a) * 0.35, e.y - 0.1, e.z - Math.sin(a) * 0.35, e.x + Math.cos(a) * 0.35, e.y + 0.1, e.z + Math.sin(a) * 0.35, '#ffffff', 0.12);
  }
  // Third-person sword: swing on each slash, raise and glow while charging a wave.
  updateKatana(e, v) {
    if (e.gun !== 'katana') return;
    const piv = e.model.gunPivot, ch = Math.max(0, v.kCharge ?? 0);
    if ((v.slashN || 0) !== e.slashN) { e.slashN = v.slashN || 0; e.swingT = 1; }
    e.swingT = Math.max(0, (e.swingT || 0) - 1 / 60 * 5.5);
    const sw = e.swingT, k = 1 - sw;   // 0 -> 1 over the swing
    piv.rotation.y = sw > 0 ? 1.5 - 3.0 * Math.min(1, k * 1.3) : 0;
    piv.rotation.z = sw > 0 ? -0.6 : 0;
    piv.rotation.x += -ch * 1.1;   // raised over the shoulder while charging
    const blade = piv.children[0] && piv.children[0].userData.blade;
    if (blade) { blade.emissive.set(v.color); blade.emissiveIntensity = ch * 1.4 + (ch >= 0.999 ? Math.sin(performance.now() / 60) * 0.4 + 0.4 : 0); }
    if (ch > 0.2 && v.alive && Math.random() < ch * 0.6) this.burst(v.pos.x + v.aim.x * 0.6, v.pos.y + (1.4 + ch * 0.5) * (v.size || 1), v.pos.z + v.aim.z * 0.6, ch >= 0.999 ? '#ffffff' : v.color, 1, 1.5);
  }
  // Super Saiyan Hair: grows with the pool (small grey tuft when drained, huge glowing gold when full).
  updateHair(e, v) {
    const now = performance.now() / 1000;
    if (e.hair) {
      const f = clamp(v.hairFrac ?? 0, 0, 1), full = f >= 0.999;
      const sc = e.hairBase * (0.5 + 0.75 * f);
      const pulse = full ? 1 + Math.sin(now * 8) * 0.03 : 1;
      e.hair.group.scale.setScalar(sc * pulse);
      // v1.0.1 2D: the side camera saw the swept-back hair sideways (sliding off the back of the head); turn it so
      // the sweep points away from the camera and the hair stands up straight on top of the head
      if (this.level && this.level.side) e.hair.group.rotation.y = -(e.root.rotation.y || 0) + Math.PI;
      else if (e.hair.group.rotation.y) e.hair.group.rotation.y = 0;
      const m = e.hair.mat;
      m.color.setRGB(0.42 + 0.58 * f, 0.42 + 0.4 * f, 0.44 - 0.21 * f);   // dull grey -> gold
      m.emissive.setRGB(1 * f, 0.68 * f, 0);
      m.emissiveIntensity = full ? 0.9 + Math.sin(now * 8) * 0.25 : 0.05 + 0.55 * f * f;
      if (v.alive && full && Math.random() < 0.35) this.burst(v.pos.x + (Math.random() - 0.5) * 0.8, v.pos.y + (1.6 + Math.random() * 0.8) * (v.size || 1), v.pos.z + (Math.random() - 0.5) * 0.8, '#ffe066', 1, 2);
    }
    // Charging (hair or pentagram): a flickering aura of rising sparks in the mod's color, plus a body glow.
    if (v.holding && v.alive) {
      const col = e.hair ? '#ffd23a' : '#b25bff', n = this.settings.effects === 'low' ? 1 : 3;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = 0.55 * (v.size || 1);
        this.burst(v.pos.x + Math.cos(a) * r, v.pos.y + Math.random() * 1.5 * (v.size || 1), v.pos.z + Math.sin(a) * r, col, 1, 3);
      }
    }
  }
  // Pentagram shield mod: one floor drawing per active ritual (rows from sim.js ritualRows).
  syncRituals(rows) {
    this.rituals = this.rituals || new Map();
    const seen = new Set(), now = performance.now() / 1000;
    for (const row of rows || []) {
      const [id, owner, x, y, z, R, draw, dep, level, prog, portal, hold, holy, hx, hy, hz] = row;
      seen.add(id);
      if (holy) { this.syncGrove(id, row, now); continue; }
      // Cursed Sacrifice: blood drips from whoever is charging it
      if (hold && hx != null && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2, rr = 0.25 + Math.random() * 0.2;
        this.blood(hx + Math.cos(a) * rr, hy + (Math.random() - 0.3) * 0.6, hz + Math.sin(a) * rr);
      }
      let r = this.rituals.get(id);
      if (!r) { r = buildPentagram(R); r.R = R; this.scene.add(r.root); this.rituals.set(id, r); }
      r.root.position.set(x, y, z);
      const key = Math.round(draw * 60);
      if (key !== r.key) { r.key = key; drawPentagram(r.ctx, 256, draw); r.tex.needsUpdate = true; }
      // purple -> red across the three levels
      const t = clamp((level + (dep ? prog : 0)) / 3, 0, 1);
      const col = new THREE.Color(0xb25bff).lerp(new THREE.Color(0xff1e1e), t);
      r.mat.color.copy(col); r.glowMat.color.copy(col).multiplyScalar(0.7);
      r.mat.opacity = dep ? 0.9 + Math.sin(now * (3 + level * 2)) * 0.1 : 0.85;
      r.glowMat.opacity = dep ? 0.3 + 0.2 * t + Math.sin(now * 4) * 0.08 : 0.2 * draw;
      r.root.children[1].rotation.z = dep ? now * 0.15 * (1 + level) : 0;
      r.root.children[0].rotation.z = r.root.children[1].rotation.z;
      if (!!dep && !r.candles.visible) { r.candles.visible = true; for (const fl of r.flames) this.burst(x + fl.position.x, y + fl.position.y, z + fl.position.z, '#ffb04a', 4, 1.5); }
      for (const fl of r.flames) { fl.scale.set(1, 0.8 + Math.random() * 0.5, 1); fl.material.color.copy(new THREE.Color(0xffb04a).lerp(new THREE.Color(0xff3a2a), t)); }
      // the portal of the latest level
      if (portal > 0 && level > 0) {
        if (!r.portal || r.portalLevel !== level) {
          if (r.portal) r.root.remove(r.portal.root);
          r.portal = buildPortalModel('#' + col.getHexString()); r.portalLevel = level; r.root.add(r.portal.root);
        }
      }
      if (r.portal) {
        const open = portal > 0 ? portal : Math.max(0, (r.portalOpen || 0) - 0.03);
        r.portalOpen = open;
        r.portal.root.scale.setScalar(Math.max(0.001, open) * (0.8 + 0.25 * level));
        if (r.portal.spin) r.portal.spin.rotation.z += 0.12;
        if (open <= 0.001) { r.root.remove(r.portal.root); r.portal = null; }
        else if (Math.random() < 0.4) this.burst(x + (Math.random() - 0.5), y + 0.9, z + (Math.random() - 0.5), '#' + col.getHexString(), 1, 2.5);
      }
      if (dep && Math.random() < 0.15 + 0.15 * level) { const a = Math.random() * Math.PI * 2; this.burst(x + Math.cos(a) * R * 0.94, y + 0.1, z + Math.sin(a) * R * 0.94, '#' + col.getHexString(), 1, 1); }
    }
    for (const [id, r] of this.rituals) if (!seen.has(id)) { this.scene.remove(r.root); this.rituals.delete(id); }
  }
  // A few small square red drops falling from a sacrificer.
  blood(x, y, z) {
    this.bloodGeo ||= new THREE.BoxGeometry(0.05, 0.05, 0.05);
    this.bloodMat ||= new THREE.MeshBasicMaterial({ color: 0xb3121c });
    if (this.fx.length >= 450) return;
    const m = new THREE.Mesh(this.bloodGeo, this.bloodMat); m.position.set(x, y, z); this.scene.add(m);
    const v = new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8);
    this.fx.push({ m, life: 0.7, max: 0.7, update: (f, dt) => { v.y -= 9 * dt; f.m.position.addScaledVector(v, dt); } });
  }
  // Sacred Grove: the grass ring grows with the charge, flowers bloom once it's complete, light builds with each level.
  syncGrove(id, row, now) {
    const [, , x, y, z, R, draw, dep, level, prog, , hold] = row;
    let r = this.rituals.get(id);
    if (!r) { r = buildGrove(R); r.holy = true; this.scene.add(r.root); this.rituals.set(id, r); }
    r.root.position.set(x, y, z);
    const grow = dep ? 1 : draw;
    for (const t of r.tufts) { const k = clamp((grow - t.userData.at) * 6 + (grow >= 1 ? 1 : 0), 0, 1); t.scale.setScalar(Math.max(0.001, k)); }
    if (r.turf) r.turf.scale.setScalar(Math.max(0.001, grow));
    if (dep && !r.flowers.visible) { r.flowers.visible = true; this.burst(x, y + 0.3, z, '#ffe066', 20, 2); }
    if (r.flowers.visible) r.flowers.children.forEach((f, i) => { f.rotation.y = Math.sin(now * 1.5 + i) * 0.3; });
    const lv = (dep ? level + prog : 0) / 3;
    r.glowMat.opacity = 0.12 + 0.5 * grow * (0.4 + lv) + Math.sin(now * 3) * 0.04;
    r.beamMat.opacity = dep ? 0.04 + 0.16 * lv + Math.sin(now * 2) * 0.02 : 0;
    r.root.children[0].scale.setScalar(1 + lv * 0.25);
    if (dep && Math.random() < 0.1 + 0.25 * lv) { const a = Math.random() * Math.PI * 2, rr = Math.random() * R; this.mote(x + Math.cos(a) * rr, y + 0.1, z + Math.sin(a) * rr); }
    if (hold && Math.random() < 0.25) { const a = Math.random() * Math.PI * 2; this.mote(x + Math.cos(a) * R * 0.95, y + 0.2, z + Math.sin(a) * R * 0.95); }
  }
  // A small golden light speck drifting up.
  mote(x, y, z) {
    this.moteGeo ||= new THREE.BoxGeometry(0.06, 0.06, 0.06);
    this.moteMat ||= new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    if (this.fx.length >= 450) return;
    const m = new THREE.Mesh(this.moteGeo, this.moteMat.clone()); m.position.set(x, y, z); this.scene.add(m);
    this.fx.push({ m, life: 1.6, max: 1.6, update: (f, dt) => { f.m.position.y += dt * 0.9; f.m.position.x += Math.sin(f.life * 5) * dt * 0.2; f.m.material.opacity = Math.min(1, f.life) * 0.9; } });
  }
  // v1.2.23 Brawl item boxes: a spinning crate in the power-up's colour with its icon floating over it; blinks before it vanishes.
  syncBrawlItems(rows) {
    this.bItemMeshes = this.bItemMeshes || new Map();
    const seen = new Set(), now = performance.now() / 1000;
    const COL = { heal: 0x5dff8f, power: 0xff5d5d, heavy: 0x9aa7b8, speed: 0xffd84a, jump: 0x6cc8ff };
    for (const [id, k, x, y, t] of rows || []) {
      seen.add(id);
      let c = this.bItemMeshes.get(id);
      if (!c) {
        const root = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: COL[k] || 0xffffff, emissive: COL[k] || 0xffffff, emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.2 });
        const box = new THREE.Mesh(this.bItemGeo || (this.bItemGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9)), mat);
        const edge = new THREE.LineSegments(this.bItemEdge || (this.bItemEdge = new THREE.EdgesGeometry(this.bItemGeo)), new THREE.LineBasicMaterial({ color: 0xffffff }));
        box.add(edge); root.add(box); this.scene.add(root);
        c = { root, box, mat }; this.bItemMeshes.set(id, c);
      }
      c.root.position.set(x, y + 0.55 + Math.sin(now * 3 + id) * 0.12, 0);
      c.box.rotation.set(0.35, now * 1.8, 0.2);
      c.root.visible = t > 3 || Math.sin(now * 18) > -0.3;
    }
    for (const [id, c] of this.bItemMeshes) if (!seen.has(id)) { this.scene.remove(c.root); c.mat.dispose(); this.bItemMeshes.delete(id); }
  }
  // Sacred Grove level 2: the healing cross falls from the sky, then glows with a soft halo of motes while it lasts.
  syncRelics(rows) {
    this.relicMeshes = this.relicMeshes || new Map();
    const seen = new Set(), now = performance.now() / 1000;
    for (const [id, , x, y, z, fall, t] of rows || []) {
      seen.add(id);
      let c = this.relicMeshes.get(id);
      if (!c) { c = buildHolyCross(); this.scene.add(c.root); this.relicMeshes.set(id, c); this.holyBeam(x, y, z, 1.2); }
      c.root.position.set(x, y + fall * fall * 14, z);
      c.root.rotation.y = now * 0.6;
      if (fall <= 0 && !c.landed) { c.landed = true; this.burst(x, y + 0.2, z, '#fff1a8', 30, 4); this.ring(x, y + 0.1, z, 4.5, '#fff1a8'); }
      c.mat.emissiveIntensity = 0.5 + Math.sin(now * 3) * 0.2;
      c.root.scale.setScalar(t < 1 ? Math.max(0.01, t) : 1);
      if (c.landed && Math.random() < 0.2) { const a = Math.random() * Math.PI * 2, rr = Math.random() * 4.5; this.mote(x + Math.cos(a) * rr, y + 0.1, z + Math.sin(a) * rr); }
    }
    for (const [id, c] of this.relicMeshes) if (!seen.has(id)) { this.scene.remove(c.root); this.relicMeshes.delete(id); }
  }
  // Priest robe, holy shield shell, and the angel's flapping wings.
  updateHoly(e, v) {
    const robeOn = !!v.robe && !e.tank && v.kind !== 'angel';
    if (robeOn && !e.robe) { e.robe = buildRobe(); e.root.add(e.robe); }
    if (e.robe) e.robe.visible = robeOn;
    if (v.holyShield && !e.holyShell) { e.holyShell = buildShieldBubble(1.15, 0xffe08a); e.holyShell.position.y = 0.8; e.root.add(e.holyShell); }
    if (e.holyShell) {
      e.holyShell.visible = !!v.holyShield && v.alive;
      if (e.holyShell.visible && e.holyShell.material.uniforms) e.holyShell.material.uniforms.opacity.value = 0.14 + Math.sin(performance.now() / 250) * 0.04;
    }
    // v1.2.20 Gun Nest: a small shield on whoever mans the turret (hits on it hurt the turret)
    if (v.mount && !e.nestShell) { e.nestShell = buildShieldBubble(0.95, 0x9fd8ff); e.nestShell.position.y = 0.75; e.root.add(e.nestShell); }
    if (e.nestShell) {
      e.nestShell.visible = !!v.mount && v.alive;
      if (e.nestShell.visible && e.nestShell.material.uniforms) e.nestShell.material.uniforms.opacity.value = 0.12 + Math.sin(performance.now() / 300) * 0.03;
    }
    if (e.model.wings) { const t = performance.now() / 1000; for (const w of e.model.wings.children) w.rotation.y = w.userData.side * (0.35 + Math.sin(t * 7) * 0.35); }
    if (v.kind === 'angel' && v.alive && Math.random() < 0.15) this.mote(v.pos.x + (Math.random() - 0.5) * 0.6, v.pos.y + 0.3, v.pos.z + (Math.random() - 0.5) * 0.6);
  }
  // Sacred Grove angel destroyed: it rises to heaven in a beam of light.
  angelAscend(x, y, z) {
    const m = buildAngelModel(); m.shield.visible = false; m.root.position.set(x, y, z); this.scene.add(m.root);
    this.holyBeam(x, y, z, 1.4);
    this.fx.push({ m: m.root, keep: true, life: 2.2, max: 2.2, update: (f, dt) => {
      const k = 1 - f.life / f.max; f.m.position.y += dt * (2 + k * 10); f.m.rotation.y += dt * 2;
      for (const w of m.wings.children) w.rotation.y = w.userData.side * (0.35 + Math.sin(k * 60) * 0.5);
      f.m.scale.setScalar(Math.max(0.01, 1 - k * 0.6));
    } });
  }
  // Cursed Sacrifice meteor: a red target ring on the ground, and a burning rock falling onto it.
  meteorWarn(e) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(e.x, e.y + 0.05, e.z); ring.scale.setScalar(e.r); this.scene.add(ring);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide }));
    fill.rotation.x = -Math.PI / 2; fill.position.set(e.x, e.y + 0.04, e.z); this.scene.add(fill);
    this.fx.push({ m: ring, life: e.d, max: e.d, update: f => { const k = 1 - f.life / f.max; f.m.material.opacity = 0.5 + 0.4 * Math.sin(k * 25); } });
    this.fx.push({ m: fill, life: e.d, max: e.d, update: f => { const k = 1 - f.life / f.max; f.m.scale.setScalar(Math.max(0.01, e.r * k)); } });
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x3a2a22, emissive: 0xff4a10, emissiveIntensity: 0.8, flatShading: true }));
    const H = 28, sx = e.x - 6, sz = e.z - 4; rock.position.set(sx, e.y + H, sz); this.scene.add(rock);
    this.fx.push({ m: rock, life: e.d, max: e.d, update: f => {
      const k = 1 - f.life / f.max;
      f.m.position.set(sx + (e.x - sx) * k, e.y + H * (1 - k), sz + (e.z - sz) * k); f.m.rotation.x += 0.2; f.m.rotation.z += 0.13;
      if (Math.random() < 0.8) this.burst(f.m.position.x, f.m.position.y, f.m.position.z, Math.random() < 0.5 ? '#ff7a2a' : '#ffcf4a', 1, 1.5);
    } });
  }
  // Mending Field: a green disc that fills in from the rim over the second before it heals, with a cross
  // pattern on the floor, a bright edge and little plus signs drifting up.
  healField(x, y, z, r, dur = 1.0) {
    if (!this.healTex) {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, 'rgba(95,227,161,.15)'); gr.addColorStop(0.8, 'rgba(95,227,161,.35)'); gr.addColorStop(0.93, 'rgba(190,255,215,.95)'); gr.addColorStop(1, 'rgba(95,227,161,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(210,255,225,.55)';
      for (const [cx, cy, s] of [[64, 64, 14], [36, 44, 7], [92, 46, 7], [44, 92, 7], [88, 88, 7]]) { g.fillRect(cx - s / 3, cy - s, s * 2 / 3, s * 2); g.fillRect(cx - s, cy - s / 3, s * 2, s * 2 / 3); }
      this.healTex = new THREE.CanvasTexture(c);
    }
    const mat = new THREE.MeshBasicMaterial({ map: this.healTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.04, z); this.scene.add(m);
    const edge = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 48), new THREE.MeshBasicMaterial({ color: 0x9dffc6, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    edge.rotation.x = -Math.PI / 2; edge.position.set(x, y + 0.06, z); edge.scale.setScalar(r); this.scene.add(edge);
    this.fx.push({ m, life: dur, max: dur, update: f => { const k = 1 - f.life / f.max; f.m.material.opacity = Math.min(1, k * 3) * 0.85; f.m.rotation.z += 0.01; } });
    this.fx.push({ m: edge, life: dur, max: dur, update: f => { const k = 1 - f.life / f.max; f.m.scale.setScalar(r * (1 - 0.85 * k)); f.m.material.opacity = 0.9 * (1 - k * 0.5); } });
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; this.plus(x + Math.cos(a) * r * 0.7, y + 0.1, z + Math.sin(a) * r * 0.7, Math.random() * dur); }
  }
  // Toxic Cloud: a few soft green puffs that drift with the bullet's direction and swell while they fade.
  toxicCloud(e) {
    if (this.settings.effects === 'off') return;
    this.toxGeo ||= new THREE.IcosahedronGeometry(1, 1);
    const group = new THREE.Group(), puffs = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this.toxGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0x7ddc4a : 0x4fae34, transparent: true, opacity: 0, depthWrite: false }));
      const a = Math.random() * 6.28, d = i === 0 ? 0 : 0.5 + Math.random() * 0.4;
      m.userData.o = new THREE.Vector3(Math.cos(a) * d, (Math.random() - 0.3) * 0.5, Math.sin(a) * d); m.userData.s = i === 0 ? 0.8 : 0.45 + Math.random() * 0.3;
      group.add(m); puffs.push(m);
    }
    group.position.set(e.x, e.y, e.z); this.scene.add(group);
    const max = e.life || 4;
    this.fx.push({ m: group, life: max, max, update: (f, dt) => {
      const k = 1 - f.life / f.max, r = e.r0 + (e.r1 - e.r0) * k;
      group.position.x += (e.vx || 0) * dt; group.position.z += (e.vz || 0) * dt;
      for (const m of puffs) { m.position.copy(m.userData.o).multiplyScalar(r); m.scale.setScalar(r * m.userData.s); m.rotation.y += dt * 0.6; m.material.opacity = Math.min(1, k * 6) * Math.min(1, f.life / 0.8) * 0.33; }
      if (Math.random() < dt * 4) this.burst(group.position.x + (Math.random() - 0.5) * r, group.position.y + Math.random() * r * 0.5, group.position.z + (Math.random() - 0.5) * r, '#9cf06f', 1, 0.5);
    } });
  }
  // Shock Bubble burst: jagged lightning runs across the floor out to the burst's edge, with a quick flash ring.
  shockArea(e) {
    const L = this.level || { solids: [] }, gy = groundBelow(L.solids, e.x, e.z, e.y + 0.3) + 0.06;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(e.x, gy, e.z); this.scene.add(ring);
    this.fx.push({ m: ring, life: 0.45, max: 0.45, update: f => { const k = 1 - f.life / f.max; f.m.scale.setScalar(e.r * (0.3 + 0.7 * Math.sqrt(k))); f.m.material.opacity = 0.9 * (1 - k); } });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(e.r, 40), new THREE.MeshBasicMaterial({ color: 0x5fc8ff, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(e.x, gy - 0.01, e.z); this.scene.add(disc);
    this.fx.push({ m: disc, life: 0.35, max: 0.35, update: f => { f.m.material.opacity = 0.25 * f.life / f.max; } });
    const n = this.settings.effects === 'low' ? 5 : 10;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.random() * 0.4, rr = e.r * (0.7 + Math.random() * 0.3);
      this.line(e.x, gy + 0.03, e.z, e.x + Math.cos(a) * rr, gy + 0.03, e.z + Math.sin(a) * rr, i % 2 ? '#e6fbff' : '#7fe0ff', 0.28, 0.55);
    }
    this.burst(e.x, gy + 0.2, e.z, '#bff3ff', 14, 5);
  }
  healPulse(x, y, z, r) {

    this.ring(x, y + 0.3, z, r, '#5fe3a1'); this.burst(x, y + 0.3, z, '#5fe3a1', 16, 4);
    for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2, rr = Math.random() * r; this.plus(x + Math.cos(a) * rr, y + 0.2, z + Math.sin(a) * rr, 0); }
  }
  // A small green plus sign floating upward.
  plus(x, y, z, delay) {
    if (this.fx.length >= 440) return;
    this.plusGeo ||= (() => { const a = new THREE.BoxGeometry(0.22, 0.07, 0.04), b = new THREE.BoxGeometry(0.07, 0.22, 0.04); return [a, b]; })();
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0x7dffb5, transparent: true, opacity: 0, depthWrite: false });
    g.add(new THREE.Mesh(this.plusGeo[0], mat), new THREE.Mesh(this.plusGeo[1], mat)); g.position.set(x, y, z); this.scene.add(g);
    const max = 1.1 + delay;
    this.fx.push({ m: g, life: max, max, update: (f, dt) => {
      const age = f.max - f.life - delay; if (age < 0) return;
      f.m.position.y += dt * 1.1; f.m.lookAt(this.camera.position);
      mat.opacity = Math.min(1, age * 4) * Math.min(1, f.life / 0.4) * 0.9;
    } });
  }

  syncBullets(list) {
    const seen = new Set();
    // v1.2.25: with lots of shots in the air, plain bullets (and their trails) draw as two instanced meshes instead of
    // two draw calls each
    const many = list.length > 80 && !this.settings.slop, inst = many ? [] : null;
    for (const b of list) {
      if (many && !b.fx && !(b.ring > 0)) { inst.push(b); continue; }
      seen.add(b.id);
      let m = this.bullets.get(b.id);
      if (!m && b.fx && b.fx.startsWith('slash')) {
        m = this.makeSlashWave(b);
        this.scene.add(m); this.bullets.set(b.id, m);
      }
      if (m && m.userData.slash) {
        m.position.set(b.pos.x, b.pos.y, b.pos.z);
        const v = b.vel; if (v && Math.hypot(v.x, v.z) > 0.1) m.rotation.y = Math.atan2(v.x, v.z);
        const age = (performance.now() - m.userData.born) / 1000;
        m.userData.core.material.opacity = 0.75 + Math.sin(age * 40) * 0.2;
        if (Math.random() < 0.5 * (this.settings.effects === 'off' ? 0 : 1)) this.burst(b.pos.x + (Math.random() - 0.5) * m.userData.w, b.pos.y, b.pos.z + (Math.random() - 0.5) * m.userData.w, b.color, 1, 1.5);
        continue;
      }
      if (!m) {
        const col = b.fx === 'flame' ? '#ff8a2a' : b.fx === 'grenade' || b.fx === 'shell' ? '#2a2b30' : b.fx === 'bee' ? '#ffd23a' : b.color;   // v1.1.1: squid takes the shooter's color (was always purple)
        // v1.2.4: plain bullets are recycled (one new mesh + material per shot added up with fast guns)
        m = !b.fx && this.bulletPool.length ? this.bulletPool.pop() : new THREE.Mesh(this.bulletGeo, new THREE.MeshBasicMaterial({ color: col, transparent: b.fx === 'flame' || b.fx === 'wave', opacity: b.fx === 'flame' ? 0.75 : b.fx === 'wave' ? 0.6 : 1 }));
        if (!b.fx) { m.material.color.set(col); m.userData.c = b.color; m.rotation.set(0, 0, 0); }
        m.userData.fx = b.fx; m.userData.born = performance.now();
        this.scene.add(m); this.bullets.set(b.id, m);
      }
      m.position.set(b.pos.x, b.pos.y, b.pos.z);
      // Saturn Rounds: a thin ring around the flight line (it's the hit ring, not a wall collider)
      if (b.ring > 0) {
        if (!m.userData.ring) {
          m.userData.ring = new THREE.Mesh(this.ringGeo || (this.ringGeo = new THREE.TorusGeometry(1, 0.03, 6, 36)),
            new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.8, depthWrite: false }));
          this.scene.add(m.userData.ring); (this.ringSet || (this.ringSet = new Set())).add(m.userData.ring);
        }
        const rg = m.userData.ring, v = b.vel;
        rg.position.copy(m.position); rg.scale.setScalar(b.ring);
        if (v && Math.hypot(v.x, v.y, v.z) > 0.1) rg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(v.x, v.y, v.z).normalize());
        if (rg.material.color.getHexString() !== String(b.color).replace('#', '').toLowerCase()) rg.material.color.set(b.color);
      }
      if (this.settings.slop) { m.scale.setScalar(b.r * 2.4); m.material.color.setHSL((performance.now() / 600 + b.id * 0.17) % 1, 1, 0.6); }
      else if (m.userData.fx === 'flame') { const age = (performance.now() - m.userData.born) / 1000; m.scale.setScalar(b.r * (1 + age * 6)); m.material.color.setHSL(0.08 - Math.min(0.08, age * 0.2), 1, 0.55); }
      else if (m.userData.fx === 'wave') m.scale.set(b.r * 2.2, b.r * 0.6, b.r * 2.2);
      else if (m.userData.fx === 'swap') { const k = 1 + 0.2 * Math.sin(performance.now() / 70); m.scale.setScalar(b.r * k); }   // v1.2.15 Swap Shot orb
      else if (m.userData.fx === 'bee') {   // Bees (v1.2.16): a small striped body with two see-through wings that flap; no more blinking
        const v = b.vel, age = (performance.now() - m.userData.born) / 1000;
        m.scale.set(b.r * 0.85, b.r * 0.85, b.r * 1.35); if (v) m.lookAt(m.position.x + v.x, m.position.y + v.y, m.position.z + v.z);
        m.position.y += Math.sin(age * 40 + b.id) * 0.03;
        this.beeParts(m, age);
        // v1.2.20 (Devin): bees chasing you turn red (on your screen only)
        const hunt = !!b.tgt && b.tgt === this.localId;
        if (m.userData.hunt !== hunt) { m.userData.hunt = hunt; m.material.color.set(hunt ? '#ff2e2e' : '#ffd23a'); }
      } else if (m.userData.fx === 'squid') {   // Squid: squashes and stretches with each stroke
        const v = b.vel, sp = v ? Math.hypot(v.x, v.y, v.z) : 0, k = Math.min(1, sp / 13);
        m.scale.set(b.r * (1.5 - 0.5 * k), b.r * (1.5 - 0.5 * k), b.r * (1 + 1.2 * k));
        const vic = b.latch && this.players.get(b.tgt);
        if (vic && vic.root) m.lookAt(vic.root.position.x, m.position.y, vic.root.position.z);   // v1.2.22: latched: face the body it is chewing
        else if (v && sp > 0.1) m.lookAt(m.position.x + v.x, m.position.y + v.y, m.position.z + v.z);
        this.squidMouth(m, !!b.latch);
        if (m.userData.c !== b.color) { m.material.color.set(b.color); m.userData.c = b.color; }   // (a blocked squid changes owner)
        this.squidArms(m, k, b.id, b.color, b.r);
      }
      else {
        m.scale.setScalar(b.r); if (!m.userData.fx && m.userData.c !== b.color) { m.material.color.set(b.color); m.userData.c = b.color; }
        if (!m.userData.fx && this.settings.effects !== 'off') this.trail(m, b);
      }
    }
    this.syncBulletInst(inst || []);
    for (const [id, m] of this.bullets) if (!seen.has(id)) { this.scene.remove(m); if (m.userData.ring) { this.scene.remove(m.userData.ring); this.ringSet && this.ringSet.delete(m.userData.ring); } this.bullets.delete(id); this.recycleBullet(m); }
    // v1.0.1: sweep any Saturn ring whose bullet is gone (a ring left behind used to hang in the air, even into later games)
    if (this.ringSet && this.ringSet.size > this.bullets.size) {
      const live = new Set(); for (const [, m] of this.bullets) if (m.userData.ring) live.add(m.userData.ring);
      for (const rg of this.ringSet) if (!live.has(rg)) { this.scene.remove(rg); this.ringSet.delete(rg); }
    }
  }

  // v1.2.16 bee bullet: two dark stripes, a stinger and a pair of pale wings (shared geometry and materials: bees come in swarms)
  // v1.2.22 (Devin): a little mouth at the front of each squid; it snaps open and shut while latched on (chomping),
  // and slowly opens and closes as it swims
  squidMouth(m, latched) {
    let g = m.userData.mouth;
    if (!g) {
      const K = this.mouthKit || (this.mouthKit = (() => {
        const jaw = new THREE.SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
        const tooth = new THREE.ConeGeometry(0.09, 0.22, 4);
        return { jaw, tooth, jm: new THREE.MeshBasicMaterial({ color: '#3a0d2e' }), tm: new THREE.MeshBasicMaterial({ color: '#ffffff' }) };
      })());
      g = m.userData.mouth = new THREE.Group(); g.position.set(0, 0, 0.82);
      const mk = up => {
        const piv = new THREE.Group(), j = new THREE.Mesh(K.jaw, K.jm);
        j.scale.set(0.9, 0.35, 0.7); j.rotation.x = up ? 0 : Math.PI; j.position.z = 0.2; piv.add(j);
        for (let i = -1; i <= 1; i++) { const t = new THREE.Mesh(K.tooth, K.tm); t.position.set(i * 0.22, up ? -0.02 : 0.02, 0.45); t.rotation.x = up ? Math.PI : 0; piv.add(t); }
        g.add(piv); return piv;
      };
      g.userData.up = mk(true); g.userData.dn = mk(false);
      m.add(g);
    }
    const t = performance.now() / 1000;
    const open = latched ? Math.max(0, Math.sin(t * 13)) * 0.75 : 0.12 + 0.12 * Math.sin(t * 3);
    g.userData.up.rotation.x = -open; g.userData.dn.rotation.x = open;
  }
  beeParts(m, age) {
    let p = m.userData.bee;
    if (!p) {
      const B = this.beeKit || (this.beeKit = (() => {
        const stripe = new THREE.CylinderGeometry(1.01, 1.01, 0.22, 10, 1, true); stripe.rotateX(Math.PI / 2);
        const sting = new THREE.ConeGeometry(0.28, 0.5, 6); sting.rotateX(-Math.PI / 2); sting.translate(0, 0, -1.15);
        const wing = new THREE.CircleGeometry(0.75, 10); wing.rotateX(-Math.PI / 2); wing.scale(0.7, 1, 1.25); wing.translate(0.55, 0, 0);
        return { stripe, sting, wing, dark: new THREE.MeshBasicMaterial({ color: 0x2a2210 }),
          wingM: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }) };
      })());
      p = m.userData.bee = new THREE.Group();
      for (const z of [-0.25, 0.25]) { const s = new THREE.Mesh(B.stripe, B.dark); s.position.z = z; p.add(s); }
      p.add(new THREE.Mesh(B.sting, B.dark));
      p.userData.wings = [1, -1].map(sx => { const w = new THREE.Mesh(B.wing, B.wingM); w.scale.x = sx; w.position.set(0, 0.55, 0.15); p.add(w); return w; });
      m.add(p);
    }
    const flap = Math.sin(age * 60) * 0.7;
    p.userData.wings[0].rotation.z = 0.35 + flap; p.userData.wings[1].rotation.z = -0.35 - flap;
  }
  syncBulletInst(L) {
    let I = this.bInst;
    if (!I && !L.length) return;
    if (!I || I.cap < L.length) {
      const cap = Math.max(256, 1 << Math.ceil(Math.log2(L.length + 1)));
      if (I) { this.scene.remove(I.core, I.trail); I.core.dispose(); I.trail.dispose(); }
      const core = new THREE.InstancedMesh(this.bulletGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), cap);
      const trail = new THREE.InstancedMesh(this.trailGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }), cap);
      const c = new THREE.Color(1, 1, 1);
      for (let i = 0; i < cap; i++) { core.setColorAt(i, c); trail.setColorAt(i, c); }
      core.frustumCulled = trail.frustumCulled = false;
      this.scene.add(core, trail);
      I = this.bInst = { core, trail, cap, born: new Map(), M: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), v: new THREE.Vector3(), z: new THREE.Vector3(0, 0, 1), id: new THREE.Quaternion(), c: new THREE.Color() };
    }
    const now = performance.now(), fx = this.settings.effects !== 'off', born = I.born, live = new Set();
    let nt = 0;
    for (let i = 0; i < L.length; i++) {
      const b = L[i], r = b.r || 0.1;
      live.add(b.id); let t0 = born.get(b.id); if (t0 == null) born.set(b.id, t0 = now);
      I.p.set(b.pos.x, b.pos.y, b.pos.z); I.s.set(r, r, r);
      I.M.compose(I.p, I.id, I.s); I.core.setMatrixAt(i, I.M);
      I.c.set(b.color || '#ffffff'); I.core.setColorAt(i, I.c);
      const v = b.vel, sp = v ? Math.hypot(v.x, v.y, v.z) : 0;
      if (fx && sp >= 0.5) {   // (same shape as trail(): grows out of the muzzle)
        const len = clamp(sp * 0.045, 0.3, 2.4) / Math.max(0.05, r), age = (now - t0) / 1000;
        I.q.setFromUnitVectors(I.z, I.v.set(v.x / sp, v.y / sp, v.z / sp));
        I.s.set(r, r, r * len * Math.min(1, age * 12));
        I.M.compose(I.p, I.q, I.s); I.trail.setMatrixAt(nt, I.M); I.trail.setColorAt(nt, I.c); nt++;
      }
    }
    for (const id of born.keys()) if (!live.has(id)) born.delete(id);
    I.core.count = L.length; I.trail.count = nt;
    I.core.instanceMatrix.needsUpdate = I.trail.instanceMatrix.needsUpdate = true;
    if (I.core.instanceColor) I.core.instanceColor.needsUpdate = true;
    if (I.trail.instanceColor) I.trail.instanceColor.needsUpdate = true;
  }
  recycleBullet(m) {
    const u = m.userData;
    if (u.fx || u.slash || u.ring || m.geometry !== this.bulletGeo || m.material.transparent || this.bulletPool.length >= 300) return;
    if (u.trail) { m.remove(u.trail); u.trail = null; }
    for (const k of Object.keys(u)) delete u[k];
    this.bulletPool.push(m);
  }
  // v28 (Settings > Graphics > High model details): squid bullets trail six little tentacles that wave as they swim.
  // Fast strokes pull them into a tight trail; while gliding they fan out and curl.
  // Tentacles: a slightly darker shade of the shooter's color (one shared material per color).
  squidArmMat(color) {
    const cache = this.armMats || (this.armMats = new Map());
    let mat = cache.get(color);
    if (!mat) { mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color || '#c46bff').multiplyScalar(0.8) }); cache.set(color, mat); }
    return mat;
  }
  squidArms(m, k, id, color, r = 0.2) {
    const want = !!this.settings.hiModels;
    let arms = m.userData.arms;
    if (!want) { if (arms) { m.remove(arms); m.userData.arms = null; } return; }
    if (!arms) {
      if (!this.armGeo) { this.armGeo = new THREE.CylinderGeometry(0.16, 0.22, 0.75, 5); this.armGeo.rotateX(Math.PI / 2); this.armGeo.translate(0, 0, -0.375); }
      const mat = this.squidArmMat(color);
      arms = m.userData.arms = new THREE.Group(); arms.userData.list = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, root = new THREE.Group();
        root.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.55, -0.55); root.userData.a = a;
        let parent = root;
        for (let s = 0; s < 3; s++) {
          const seg = new THREE.Mesh(this.armGeo, mat);
          if (s) seg.position.z = -0.72;
          seg.scale.setScalar(1 - s * 0.22); parent.add(seg); parent = seg;
        }
        arms.add(root); arms.userData.list.push(root);
      }
      m.add(arms); arms.userData.c = color;
    } else if (arms.userData.c !== color) {   // owner changed: recolor the tentacles
      arms.userData.c = color; const mat = this.squidArmMat(color); arms.traverse(o => { if (o.isMesh) o.material = mat; });
    }
    // v1.2.20 (Devin: tentacles didn't scale with bullet size): they already grew with the body, but stayed short and thin
    // next to a big one; now they also get longer and thicker as Bullet size grows (up to 2x at the largest size)
    const g = clamp(Math.pow(Math.max(0.1, r) / 0.2, 0.45), 1, 2);   // (on each root, so they stay attached to the body)
    const t = performance.now() / 1000;
    for (let i = 0; i < 6; i++) {
      const root = arms.userData.list[i], a = root.userData.a, spread = 0.75 - 0.55 * k;
      root.scale.set(g, g, g * 1.15);
      // flare outward from the body's axis, then each joint curls a little more, in a travelling wave
      root.rotation.set(-Math.sin(a) * spread, Math.cos(a) * spread, 0);
      let seg = root.children[0], s = 0;
      while (seg) {
        const w = Math.sin(t * (7 + 5 * k) - s * 1.1 + i * 1.7 + id) * (0.35 + 0.25 * (1 - k));
        seg.rotation.x = -Math.sin(a) * w * 0.8; seg.rotation.y = Math.cos(a) * w * 0.8;
        seg = seg.children[0]; s++;
      }
    }
  }

  clearAll() {
    this.clearNapalm();
    if (this.bInst) { this.bInst.core.count = this.bInst.trail.count = 0; this.bInst.born.clear(); }
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const [, m] of this.bullets) { this.scene.remove(m); if (m.userData.ring) this.scene.remove(m.userData.ring); }
    this.bullets.clear();
    for (const rg of this.ringSet || []) this.scene.remove(rg); this.ringSet = new Set();
    for (const [, g] of this.barricades) this.scene.remove(g);
    this.barricades.clear();
    for (const [, m] of this.shieldMeshes) this.scene.remove(m);
    this.shieldMeshes.clear();
    for (const [, m] of this.mineMeshes) this.scene.remove(m);
    this.mineMeshes.clear();
    for (const f of this.fx) this.endFx(f);
    this.fx = [];
    if (this.punchFx && this.camera.isPerspectiveCamera) { this.camera.fov = this.settings.fov; this.camera.updateProjectionMatrix(); }
    this.punchFx = null; this.camKick.set(0, 0, 0); this.fpKick = 0;
    this.clearTelegraphs();
    this.syncRituals([]);
    this.marker.visible = this.skyMarker.visible = this.viewGun.visible = false;
  }

  // ---------------- effects ----------------
  burst(x, y, z, color, n, spd) {
    const q = this.settings.effects === 'off' ? 0 : this.settings.effects === 'low' ? 0.4 : 1;
    n = Math.round(n * q);
    for (let i = 0; i < n && this.fx.length < 450; i++) {
      // v1.2.4: particles are recycled; v1.2.6: a particle is just a record, drawn as an instance of this.parts
      const f = this.fxPool.pop() || { part: true, p: new THREE.Vector3(), v: new THREE.Vector3(), c: new THREE.Color(), max: 0.9 };
      f.p.set(x, y, z); f.c.set(color);
      f.v.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(spd * (0.4 + Math.random()));
      f.life = 0.5 + Math.random() * 0.4;
      this.fx.push(f);
    }
  }
  // v1.2.6: one instanced mesh for every burst particle (each was its own mesh, so its own draw call). Per-instance
  // color, and a per-instance alpha attribute for the fade (MeshBasicMaterial patched to read it).
  makeParts() {
    const N = 450, geo = new THREE.BoxGeometry(0.12, 0.12, 0.12), alpha = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
    alpha.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('iAlpha', alpha); this.partsGeo = geo;
    const mat = new THREE.MeshBasicMaterial({ transparent: true });
    mat.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute float iAlpha;\nvarying float vIAlpha;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvIAlpha = iAlpha;');
      sh.fragmentShader = 'varying float vIAlpha;\n' + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vIAlpha );');
    };
    mat.customProgramCacheKey = () => 'burstParts';
    const m = new THREE.InstancedMesh(geo, mat, N), I = new THREE.Matrix4(), c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < N; i++) { m.setMatrixAt(i, I); m.setColorAt(i, c); }   // translation is written per frame; color buffer made up front (part of the shader)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.visible = false; m.frustumCulled = false; this.scene.add(m);
    return m;
  }
  syncParts() {
    const P = this.parts, A = this.partsGeo.attributes.iAlpha, M = P.instanceMatrix.array, C = P.instanceColor.array, al = A.array;
    let n = 0;
    for (const f of this.fx) {
      if (!f.part) continue;
      const o = n * 16, k = n * 3; M[o + 12] = f.p.x; M[o + 13] = f.p.y; M[o + 14] = f.p.z;
      C[k] = f.c.r; C[k + 1] = f.c.g; C[k + 2] = f.c.b; al[n] = Math.max(0, f.life / f.max);
      if (++n >= 450) break;
    }
    P.count = n; P.visible = n > 0;
    if (n) for (const b of [P.instanceMatrix, P.instanceColor, A]) { b.updateRange.offset = 0; b.updateRange.count = n * b.itemSize; b.needsUpdate = true; }
  }
  // Open world ambush: a purple portal standing on the ground; it opens, swirls while bots step out, then closes.
  portal(e) {
    const group = new THREE.Group(), R = 1.6;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 10, 40), new THREE.MeshBasicMaterial({ color: 0xc45bff, transparent: true }));
    const core = new THREE.Mesh(new THREE.CircleGeometry(R * 0.95, 40), new THREE.MeshBasicMaterial({ color: 0x3b0a4a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    group.add(rim, core); group.position.set(e.x, e.y + R + 0.1, e.z); group.rotation.y = Math.random() * Math.PI;
    this.scene.add(group);
    const max = e.d || 3;
    this.fx.push({ m: group, life: max, max, update: (f, dt) => {
      const age = f.max - f.life, k = Math.min(1, age / 0.35) * Math.min(1, f.life / 0.4);
      group.scale.setScalar(Math.max(0.01, k)); rim.rotation.z += dt * 3;
      core.material.opacity = 0.85 * k; rim.material.opacity = k;
      if (Math.random() < dt * 25) this.burst(e.x + (Math.random() - 0.5) * 2, e.y + Math.random() * R * 2, e.z + (Math.random() - 0.5) * 2, '#c45bff', 1, 1.2);
    } });
  }
  // v1.2.15 Spite Charge: a red warning ring on the ground that pulses until the blast
  spiteRing(x, y, z, r, fuse) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.9, r, 40), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.05, z); this.scene.add(m);
    this.fx.push({ m, life: fuse, max: fuse, update: f => { f.m.material.opacity = 0.45 + 0.45 * Math.sin((f.max - f.life) * 40); } });
  }
  // v1.2.15 Gravity Well: a ring that shrinks in on the impact point
  wellFx(x, y, z, r, color) {
    if (this.settings.effects === 'off') return;
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 32), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, Math.max(0.1, y), z); this.scene.add(m);
    this.fx.push({ m, life: 0.5, max: 0.5, update: f => { const k = f.life / f.max; f.m.scale.setScalar(Math.max(0.05, r * k)); f.m.material.opacity = 0.8 * (1 - k * 0.5); f.m.rotation.z += 0.3; } });
  }
  // v1.2.15: a short rising word (Chain Encore counter)
  floatText(x, y, z, text, color) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d'); g.font = '700 40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = '#000'; g.strokeText(text, 64, 34); g.fillStyle = color; g.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(c), m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    m.position.set(x, y, z); m.scale.set(1.2, 0.6, 1); this.scene.add(m);
    this.fx.push({ m, life: 0.8, max: 0.8, update: (f, dt) => { f.m.position.y += dt * 1.2; f.m.material.opacity = Math.min(1, f.life / 0.3); if (f.life <= 0) tex.dispose(); } });
  }
  // v1.2.15 emotes and pings (main.js emote wheel)
  emojiTex(text, color) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (color) { g.fillStyle = 'rgba(10,12,20,.75)'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill(); g.lineWidth = 7; g.strokeStyle = color; g.stroke(); }
    g.font = '80px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; g.fillText(text, 64, 70);
    return new THREE.CanvasTexture(c);
  }
  emote(pid, text) {
    const tex = this.emojiTex(text), m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    m.renderOrder = 5; this.scene.add(m);
    this.fx.push({ m, life: 2.6, max: 2.6, update: (f, dt) => {
      const e = this.players.get(pid), age = f.max - f.life;
      if (e) f.m.position.set(e.root.position.x, e.root.position.y + 2.4 * (e.root.scale.y || 1) + 0.3 + Math.sin(age * 5) * 0.06, e.root.position.z);
      f.m.visible = !!e && e.root.visible;
      const k = Math.min(1, age / 0.18), s = 1.1 * (k < 1 ? 0.3 + k * 0.9 : 1);
      f.m.scale.set(s, s, 1); f.m.material.opacity = Math.min(1, f.life / 0.4);
      if (f.life <= 0) tex.dispose();
    } });
  }
  ping(x, y, z, color, icon) {
    const g = new THREE.Group(), col = new THREE.Color(color);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthWrite: false }));
    beam.position.y = 3; g.add(beam);
    const tex = this.emojiTex(icon, color), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sp.position.y = 2.2; sp.scale.set(1.1, 1.1, 1); sp.renderOrder = 5; g.add(sp);
    g.position.set(x, y, z); this.scene.add(g);
    this.fx.push({ m: g, life: 4.5, max: 4.5, update: (f, dt) => {
      const age = f.max - f.life, a = Math.min(1, f.life / 0.6);
      const k = (age * 1.4) % 1; ring.scale.setScalar(0.6 + k * 1.6); ring.material.opacity = (1 - k) * a;
      beam.material.opacity = 0.45 * a; sp.material.opacity = a; sp.position.y = 2.2 + Math.sin(age * 4) * 0.08;
      if (f.life <= 0) tex.dispose();
    } });
  }
  // v1.2.15: words over heads (Gambler's Mag roll, Bounty Mark, rooted by a Snare Plate). tags: Map id -> text
  syncNcTags(list, tags) {
    const seen = new Set();
    this.ncTags ||= new Map();
    for (const v of list) {
      const text = tags(v);
      if (!text) continue;
      seen.add(v.id);
      let t = this.ncTags.get(v.id);
      if (!t) {
        const c = document.createElement('canvas'); c.width = 512; c.height = 64;
        const tex = new THREE.CanvasTexture(c), s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        s.scale.set(4, 0.5, 1); this.scene.add(s); t = { s, c, tex, text: null }; this.ncTags.set(v.id, t);
      }
      if (t.text !== text) {
        const g = t.c.getContext('2d'); g.clearRect(0, 0, 512, 64); g.font = '700 34px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(text, 256, 34); g.fillStyle = text.includes('BOUNTY') ? '#ff6a5a' : text.includes('ROOTED') ? '#ffb347' : '#ffe08a'; g.fillText(text, 256, 34);
        t.tex.needsUpdate = true; t.text = text;
      }
      t.s.position.set(v.pos.x, v.pos.y + 2.75 * (v.size || 1), v.pos.z);
    }
    for (const [id, t] of this.ncTags) if (!seen.has(id)) { this.scene.remove(t.s); t.tex.dispose(); this.ncTags.delete(id); }
  }
  ring(x, y, z, radius, color) {
    if (this.settings.effects === 'off') return;
    const m = new THREE.Mesh(this.bulletGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false }));
    m.position.set(x, y, z); m.scale.setScalar(0.2); this.scene.add(m);
    this.fx.push({ m, life: 0.3, max: 0.3, grow: radius });
  }
  line(x1, y1, z1, x2, y2, z2, color, dur = 0.15, jag = 0) {
    const pts = [new THREE.Vector3(x1, y1, z1)];
    if (jag) for (let i = 1; i < 6; i++) { const t = i / 6; pts.push(new THREE.Vector3(x1 + (x2 - x1) * t + (Math.random() - 0.5) * jag, y1 + (y2 - y1) * t + (Math.random() - 0.5) * jag, z1 + (z2 - z1) * t + (Math.random() - 0.5) * jag)); }
    pts.push(new THREE.Vector3(x2, y2, z2));
    const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true }));
    this.scene.add(m);
    this.fx.push({ m, life: dur, max: dur, update: f => { f.m.material.opacity = Math.max(0, f.life / f.max); } });
  }
  lockFlash(x, y, z, color) {
    const L = this.level || { solids: [] };
    const m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.45, 24), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, groundBelow(L.solids, x, z, y) + 0.05, z);
    this.scene.add(m); this.fx.push({ m, life: 0.6, max: 0.6, grow: 2.2, flat: true });
  }
  // v28 Core Defense: the core blows apart. A white flash and a growing fireball, a shock ring along the ground,
  // glowing chunks of the core thrown out and bouncing, and smoke rising after.
  coreBlast(x, y, z) {
    const cy = y + 0.9, col = [0x7fd8ff, 0xbff2ff, 0x3a6a8a];
    this.addShake(0.6);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    flash.position.set(x, cy, z); this.scene.add(flash);
    this.fx.push({ m: flash, life: 0.9, max: 0.9, update: f => { const k = 1 - f.life / f.max; flash.scale.setScalar(1 + k * 9); flash.material.opacity = Math.max(0, 1 - k * 1.2); flash.material.color.setHex(k < 0.25 ? 0xffffff : 0xff9a3a); } });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.4, 48), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.08, z); this.scene.add(ring);
    this.fx.push({ m: ring, life: 1.4, max: 1.4, update: f => { const k = 1 - f.life / f.max; ring.scale.setScalar(1 + k * 22); ring.material.opacity = Math.max(0, 0.9 * (1 - k)); } });
    for (let i = 0; i < 26; i++) {   // chunks
      const s = 0.18 + Math.random() * 0.4, m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshStandardMaterial({ color: col[i % 3], emissive: 0x2a8ad0, emissiveIntensity: 0.8, roughness: 0.4 }));
      m.position.set(x + (Math.random() - 0.5), cy + (Math.random() - 0.5), z + (Math.random() - 0.5)); m.castShadow = true; this.scene.add(m);
      const a = Math.random() * Math.PI * 2, sp = 6 + Math.random() * 10, v = new THREE.Vector3(Math.cos(a) * sp, 6 + Math.random() * 12, Math.sin(a) * sp), spin = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      this.fx.push({ m, life: 3.2 + Math.random(), max: 4.2, update: (f, dt) => {
        v.y -= 20 * dt; m.position.addScaledVector(v, dt); m.rotation.x += spin.x * dt; m.rotation.y += spin.y * dt; m.rotation.z += spin.z * dt;
        if (m.position.y < s / 2) { m.position.y = s / 2; v.y = Math.abs(v.y) * 0.35; v.x *= 0.6; v.z *= 0.6; spin.multiplyScalar(0.6); }
        m.material.emissiveIntensity = Math.max(0, 0.8 * f.life / f.max); if (f.life < 0.6) m.scale.setScalar(Math.max(0.01, f.life / 0.6));
        if (Math.random() < dt * 6 && f.life > 2) this.burst(m.position.x, m.position.y, m.position.z, '#ff8a3a', 1, 0.6);
      } });
    }
    this.burst(x, cy, z, '#ffffff', 40, 12); this.burst(x, cy, z, '#7fd8ff', 60, 10); this.burst(x, cy, z, '#ff7a1a', 50, 8);
    for (let k = 1; k <= 3; k++) setTimeout(() => { this.burst(x + (Math.random() - 0.5) * 3, cy + Math.random() * 2, z + (Math.random() - 0.5) * 3, '#ffb03a', 30, 7); this.addShake(0.25); }, k * 260);
    for (let i = 0; i < 14; i++) {   // smoke
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.6 + Math.random() * 0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0x2a2a30, transparent: true, opacity: 0, depthWrite: false }));
      m.position.set(x + (Math.random() - 0.5) * 2, cy, z + (Math.random() - 0.5) * 2); this.scene.add(m);
      const delay = 0.3 + Math.random() * 0.8, rise = 1.5 + Math.random() * 2;
      this.fx.push({ m, life: 4, max: 4, update: (f, dt) => { const age = f.max - f.life; if (age < delay) return; m.position.y += rise * dt; m.scale.multiplyScalar(1 + dt * 0.5); m.material.opacity = Math.min(0.55, (age - delay) * 2) * Math.min(1, f.life / 1.5); } });
    }
  }
  addShake(a) { if (this.settings.screenShake) this.shake = Math.min(0.75, this.shake + a); }

  // ---------------- v1.2.0 game feel ----------------
  // Squash and stretch: bodies squash when they land and on each hit, and stretch as they jump (a damped spring).
  squash(e, v) {
    const now = performance.now() / 1000, dt = e.sqT ? Math.min(0.05, now - e.sqT) : 0; e.sqT = now;
    e.sq = e.sq || 0; e.sqV = e.sqV || 0;
    if (dt > 0) {
      const vy = e.sqY != null ? (v.pos.y - e.sqY) / dt : 0;
      if (e.sqVy != null && v.alive) {
        if (e.sqVy < -5 && vy > -1) {
          e.sqV -= Math.min(4, -e.sqVy * 0.22);
          if (-e.sqVy > 8 && !(this.level && this.level.side)) this.burst(v.pos.x, v.pos.y + 0.08, v.pos.z, '#d6dbe6', 6, 2.4);   // a puff of dust
          if (v.id === this.localId && this.onLocalLand) this.onLocalLand(-e.sqVy);
        }
        else if (e.sqVy < 1.5 && vy > 5) e.sqV += 2.6;
      }
      e.sqY = v.pos.y; e.sqVy = vy;
      if (v.flash && !e.sqFlash) e.sqV -= 2.2;   // hit: a quick squish
      e.sqFlash = !!v.flash;
      e.sqV += (-e.sq * 300 - e.sqV * 17) * dt; e.sq = clamp(e.sq + e.sqV * dt, -0.32, 0.32);
    }
    const q = this.settings.effects === 'off' ? 0 : e.sq;
    return { y: 1 + q, xz: 1 - q * 0.55 };
  }
  // Plain bullets drag a tapering streak behind them, longer the faster they fly.
  trail(m, b) {
    const v = b.vel; if (!v) return;
    const sp = Math.hypot(v.x, v.y, v.z);
    let t = m.userData.trail;
    if (!t) {
      let mat = this.trailMats.get(b.color);
      if (!mat) { mat = new THREE.MeshBasicMaterial({ color: b.color, transparent: true, opacity: 0.45, depthWrite: false }); this.trailMats.set(b.color, mat); }
      t = m.userData.trail = new THREE.Mesh(this.trailGeo, mat); m.add(t);
    }
    if (sp < 0.5) { t.visible = false; return; }
    t.visible = true;
    const len = clamp(sp * 0.045, 0.3, 2.4) / Math.max(0.05, b.r), age = (performance.now() - m.userData.born) / 1000;
    t.scale.set(1, 1, len * Math.min(1, age * 12));   // grows out of the muzzle instead of popping in full length
    t.quaternion.setFromUnitVectors(this._zAxis || (this._zAxis = new THREE.Vector3(0, 0, 1)), (this._tv || (this._tv = new THREE.Vector3())).set(v.x, v.y, v.z).multiplyScalar(1 / sp));
  }
  glowTex() {
    if (this._glowTex) return this._glowTex;
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return (this._glowTex = new THREE.CanvasTexture(c));
  }
  glowSprite(x, y, z, color, size, life, grow = 1.6) {
    if (this.settings.effects === 'off') return;
    const s = this.glowPool.pop() || new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));   // v1.2.4: recycled
    s.material.color.set(color); s.material.opacity = 1;
    s.position.set(x, y, z); s.scale.setScalar(size); s.renderOrder = 3; this.scene.add(s);
    this.fx.push({ m: s, pool: this.glowPool, life, max: life, update: f => { const k = 1 - f.life / f.max; s.scale.setScalar(size * (1 + (grow - 1) * k)); s.material.opacity = Math.max(0, 1 - k); } });
  }
  // A bright flash at the gun's muzzle for every shot, from any player.
  muzzleFlash(id, color) {
    const e = this.players.get(id); if (!e || !e.root.visible) return;
    const side = this.level && this.level.side, ry = e.root.rotation.y, s = e.root.scale.x || 1;
    const fx = side ? Math.sign(ry) : Math.sin(ry), fz = side ? 0 : Math.cos(ry);
    const gp = (this._gp || (this._gp = new THREE.Vector3())); e.model.gunPivot.getWorldPosition(gp);
    const x = gp.x + fx * 0.85 * s, y = gp.y, z = gp.z + fz * 0.85 * s;
    this.glowSprite(x, y, z, '#ffffff', 0.55 * s, 0.07, 1.3);
    this.glowSprite(x, y, z, color, 1.1 * s, 0.1, 1.5);
  }
  // A kill: a white flash that swells and fades, a ring on the ground and a spray of the victim's color.
  deathPop(x, y, z, color, big) {
    this.glowSprite(x, y, z, '#ffffff', big ? 1.9 : 1.3, big ? 0.28 : 0.2, 2);
    this.glowSprite(x, y, z, color, big ? 2.8 : 2, big ? 0.4 : 0.3, 1.7);
    if (this.settings.effects === 'off') return;
    const L = this.level || { solids: [] };
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = L.side ? 0 : -Math.PI / 2; ring.position.set(x, L.side ? y : groundBelow(L.solids, x, z, y) + 0.06, z); this.scene.add(ring);
    this.fx.push({ m: ring, life: 0.45, max: 0.45, update: f => { const k = 1 - f.life / f.max; ring.scale.setScalar(0.5 + k * (big ? 6 : 4)); ring.material.opacity = 0.9 * (1 - k) * (1 - k); } });
  }
  // Camera kick when you shoot: first person tips up and slides back a little.
  // v1.2.7: the overhead camera no longer moves with each shot (Devin: it swung too hard when shooting).
  shotKick(ax, az, amt = 1) {
    if (!this.settings.screenShake || this.settings.view !== 'first') return;
    const l = Math.hypot(ax, az) || 1;
    this.camKick.x -= ax / l * 0.035 * amt; this.camKick.z -= az / l * 0.035 * amt;
    const m = this.camKick.length(); if (m > 0.08) this.camKick.multiplyScalar(0.08 / m);   // fast guns can't push it far
    this.fpKick = Math.min(0.05, this.fpKick + 0.012 * amt);
  }
  // Zoom punch toward a point (the round-winning kill). Weight eases in fast and out slowly.
  punch(x, y, z, dur = 1.4) { this.punchFx = { x, y, z, t: 0, dur }; }
  // v1.2.11 spectator camera: drag pans (screen pixels -> metres at the current height), the wheel zooms.
  specDrag(dx, dy) {
    const sc = this.spec || (this.spec = { x: 0, z: 0, zoom: 1, manual: false });
    const k = 0.0016 * Math.max(4, this.camera.position.y) * (this.camera.fov / 60);
    sc.manual = true; sc.x -= dx * k; sc.z -= dy * k;
  }
  specZoom(dy) {
    const sc = this.spec || (this.spec = { x: 0, z: 0, zoom: 1, manual: false });
    sc.zoom = clamp(sc.zoom * (dy > 0 ? 1.12 : 1 / 1.12), 0.45, 2.5);
  }
  punchWeight() {
    const P = this.punchFx; if (!P) return 0;
    const u = P.t / P.dur; return u < 0.12 ? u / 0.12 : u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.45) ** 2;
  }
  updateFx(dt) {
    let w = 0;
    for (const f of this.fx) {
      f.life -= dt;
      if (f.update) f.update(f, dt);
      else if (f.part) { f.v.y -= 18 * dt; f.p.addScaledVector(f.v, dt); if (f.p.y < 0.06) { f.p.y = 0.06; f.v.multiplyScalar(0.5); } }
      else {
        if (f.v) {
          f.v.y -= 18 * dt; f.m.position.addScaledVector(f.v, dt);
          if (f.m.position.y < 0.06) { f.m.position.y = 0.06; f.v.multiplyScalar(0.5); }
        }
        if (f.grow) f.m.scale.setScalar(f.grow * (1 - f.life / f.max) + (f.flat ? 1 : 0.2));
        f.m.material.opacity = Math.max(0, f.life / f.max) * (f.grow && !f.flat ? 0.45 : 1);
      }
      if (f.life > 0) { this.fx[w++] = f; continue; }
      this.endFx(f);
    }
    this.fx.length = w;
  }
  // v1.2.4: a finished effect goes back to its pool, or its one-off geometry is freed on the GPU (it used to stay
  // allocated until the browser got round to it, which showed up as stalls). Materials are left to the garbage
  // collector on purpose: disposing the last one of a kind throws its shader away, and recompiling that is a hitch.
  endFx(f) {
    if (f.part) { if (this.fxPool.length < 600) this.fxPool.push(f); return; }
    this.scene.remove(f.m);
    if (f.pool) { if (f.pool.length < 600) f.pool.push(f.m); if (f.v && this.fxPool.length < 600) { f.m = null; f.pool = null; this.fxPool.push(f); } return; }
    if (f.keep) return;
    const shared = this.sharedGeos();
    f.m.traverse(o => { const g = o.geometry; if (g && !shared.has(g) && !g.userData.keep) g.dispose(); });
  }
  sharedGeos() {   // geometries kept on the renderer and reused by many effects (never freed)
    const now = performance.now();
    if (this._sharedG && now - this._sharedT < 2000) return this._sharedG;
    const set = new Set();
    for (const v of Object.values(this)) {
      if (v && v.isBufferGeometry) set.add(v);
      else if (Array.isArray(v)) for (const x of v) if (x && x.isBufferGeometry) set.add(x);
    }
    this._sharedT = now; return (this._sharedG = set);
  }

  // ---------------- aiming ----------------
  fpDir() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }
  computeAim(v, localId) {
    const size = v.size || 1;
    const chest = new THREE.Vector3(v.pos.x, v.pos.y + CHEST * size, v.pos.z);
    const targets = this.aimables.slice();
    for (const [, g] of this.barricades) targets.push(...g.children);
    for (const [id, e] of this.players) if (id !== localId && e.root.visible) targets.push(...e.model.hitMeshes);
    let pt = null, onPlayer = false;
    if (this.level && this.level.side) return sideAim(this, chest);   // 2D side view: aim anywhere in the play plane
    if (this.settings.view === 'first' && this.otsCam) {
      // Tiny Tank over-the-shoulder: aim along the camera's center ray, ignoring anything between the camera and the tank.
      const dir = this.fpDir(), cam = this.otsCam.pos, skip = this.otsCam.dist;
      this.ray.set(cam, dir);
      const hits = this.ray.intersectObjects(targets, false).filter(h => h.distance > skip);
      pt = hits.length ? hits[0].point.clone() : cam.clone().addScaledVector(dir, 80);
    } else if (this.settings.view === 'first') {
      const eye = new THREE.Vector3(v.pos.x, v.pos.y + RULES.eye * size, v.pos.z), dir = this.fpDir();
      this.ray.set(eye, dir);
      const hits = this.ray.intersectObjects(targets, false);
      pt = hits.length ? hits[0].point.clone() : eye.clone().addScaledVector(dir, 80);
    } else {
      // Default view: aim level at chest height, so low cover in the way is shot over.
      // Only snap to something under the cursor if it's a player or a surface clearly above your feet.
      this.ray.setFromCamera(this.mouse, this.camera);
      const hits = this.ray.intersectObjects(targets, false);
      const pick = hits.find(h => {
        if (h.object.userData.player) return true;
        const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
        return n.y > 0.5 && h.point.y > v.pos.y + 0.9;
      });
      if (pick) { pt = pick.point.clone(); if (!pick.object.userData.player) pt.y += CHEST * size; else onPlayer = true; }
      else {
        pt = new THREE.Vector3();
        if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -chest.y), pt)) pt = hits.length ? hits[0].point.clone() : null;
        // Big characters: a shorter player near the cursor (and close to you) gets aimed at, not shot over.
        if (pt) for (const [id, e] of this.players) {
          if (id === localId || !e.root.visible) continue;
          const q = e.root.position, qs = e.root.scale.y || 1, qc = q.y + CHEST * qs;
          if (qc < chest.y - 0.25 && Math.hypot(q.x - pt.x, q.z - pt.z) < 0.8 * qs + 0.3 && Math.hypot(q.x - v.pos.x, q.z - v.pos.z) < 9) { pt.set(q.x, qc, q.z); onPlayer = true; break; }
        }
      }
    }
    if (!pt) return null;
    const d = pt.clone().sub(chest);
    if (this.settings.view !== 'first') {
      const flat = Math.hypot(d.x, d.z), lim = onPlayer ? 1.4 : 0.6;   // a steeper angle is allowed onto a player right under you
      d.y = clamp(d.y / Math.max(0.001, flat), -lim, 0.6) * flat;
    }
    if (this.settings.view !== 'first') { // third person: aim a touch higher to cancel bullet drop over the distance (first person fires exactly where you look)
      const flat = Math.hypot(d.x, d.z), t = flat / (v.bulletSpeed || 28);
      d.y += 0.5 * (v.bulletGrav || RULES.bulletGravity) * t * t;
    }
    if (d.lengthSq() < 0.04) return null;
    d.normalize();
    return { aim: { x: d.x, y: d.y, z: d.z }, aimPoint: { x: pt.x, y: pt.y, z: pt.z } };
  }

  // ---------------- camera & frame ----------------
  applySlopColors() {
    const on = !!this.settings.slop, t = performance.now() / 1000;
    if (!this.slopMats) return;
    if (!on && !this.slopWasOn) return;
    this.slopMats.forEach((m, i) => {
      if (on) m.color.setHSL((t * 0.08 + i * 0.137) % 1, 0.85, 0.62); else m.color.copy(m.userData.base);
    });
    this.scene.background.set(on ? new THREE.Color().setHSL((t * 0.03) % 1, 0.6, 0.18) : new THREE.Color(ART.background));
    this.slopWasOn = on;
  }

  update(view, localId, dt) {
    SHIELD_TIME.value = performance.now() / 1000;
    // v1.2.3: shake and kick are drawn as an offset that is taken back off before the next frame's camera logic.
    // (1.2.0 left them in camera.position, so the top-down camera, which eases from where it was, drifted and
    // turned toward each kick: the "twist" when shooting.)
    if (this.camOff) { this.camera.position.sub(this.camOff); this.camOff.set(0, 0, 0); }
    this.applySlopColors();
    this.owDowned = !!(view.ow && view.ow.ex);
    this.syncPlayers(view.players, localId);
    this.syncSpecMarks(view.players, localId);
    this.syncJumpMark(view.players.find(p => p.id === localId));
    if (view.ncTag) this.syncNcTags(view.players, view.ncTag);
    this.syncBullets(view.bullets);
    this.syncBarricades(view.barricades);
    this.syncDynamics(view.dynamics);
    this.syncShields(view.shields);
    this.syncMines(view.mines);
    this.bossInfo = view.boss || null;
    this.syncTelegraphs(view.telegraphs, view.shocks);
    this.localId = localId;
    this.syncRituals(view.rituals);
    this.coreMode = !!view.core; this.syncCore(view.core);
    this.syncRelics(view.relics);
    this.syncBrawlItems(view.bitems);
    this.updateHazards(view.laser, dt);
    this.updateTraps(view.trapT);
    this.updateFx(dt);
    this.updateNapalm(dt); this.updateBlotches(dt);
    const local = view.players.find(p => p.id === localId);
    // Open world: over-the-shoulder camera when chosen (and always while falling / parachuting), the bus camera while riding it.
    const ow = !!(this.level && this.level.open), owSt = ow && local ? owStateOf(view, local.id) : 0;
    if (ow) owUpdate(this, view, local, dt);
    const revHold = !!(local && !local.alive && this.reviveHold > performance.now());   // v1.2.13: Phoenix revive: the camera stays on you
    const fp = this.settings.view === 'first' && local && (local.alive || revHold) && owSt !== 1;
    const tankView = !!fp && (!!((local.flags || 0) & 1) || (ow && (this.owThird || owSt >= 2)) || (!ow && !!this.settings.ots));   // v1.0.1: over-the-shoulder view in the arena modes too
    this.owOts = tankView && (ow || !!this.settings.ots);   // (shows your own model behind the camera)
    this.viewGun.visible = !!fp && !tankView;   // Tiny Tank / over-the-shoulder: no hand-held gun
    // First person: your Riot Shield, drawn as a translucent arc in front of you (you can't see your own model).
    const fpRiot = !!fp && local.mod === 'shield' && !tankView;
    if (fpRiot && !this.fpRiot) {
      // Held low so it frames the bottom of the view instead of covering it: a faint tinted pane with a bright top edge.
      this.fpRiot = buildRiotShield(local.color); this.fpRiot.orb.visible = false; this.fpRiot.rim.visible = false;
      const pts = []; for (let i = 0; i <= 24; i++) { const a = -0.8 + 1.6 * i / 24; pts.push(new THREE.Vector3(0.95 * Math.sin(a), 0.725, 0.95 * Math.cos(a))); }
      this.fpRiot.edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x4fa8ff, transparent: true, opacity: 0.9 }));
      this.fpRiot.group.add(this.fpRiot.edge);
      this.fpRiot.group.rotation.y = Math.PI;
      this.gunScene.add(this.fpRiot.group);
    }
    if (this.fpRiot) {
      this.fpRiot.group.visible = fpRiot;
      if (fpRiot) {
        const rf = local.riotFrac ?? 1, s = local.size || 1;
        this.fpRiot.group.scale.set(1.25, 1, 1.25); this.fpRiot.group.position.y = -0.725 - 0.32;   // top edge a little below the eye line
        this.fpRiot.edge.material.color.set(local.broken ? 0xff4040 : rf > 0.5 ? 0x4fa8ff : 0xffb347);
        this.fpRiot.face.material.color.set(local.broken ? 0xff4040 : local.color);
        this.fpRiot.face.material.opacity = local.broken ? 0.05 : 0.05 + 0.07 * rf;
        this.fpRiot.face.material.depthWrite = false;
      }
    }
    const fpTank = tankView;
    if (fpTank) {
      // Tiny Tank in first person: over-the-shoulder camera behind and to the right of the tank, pulled in by walls.
      const s = local.size || 1, dir = this.fpDir(), up = new THREE.Vector3(0, 1, 0), tank = !!((local.flags || 0) & 1);
      const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize(), right = new THREE.Vector3().crossVectors(flat, up).normalize();
      const pivot = new THREE.Vector3(local.pos.x, local.pos.y + (tank ? 1.3 : 1.6) * s, local.pos.z);
      const blockers = this.aimables.slice(); for (const [, g] of this.barricades) blockers.push(...g.children);
      // Low, close shoulder spot; a wall behind pulls the camera straight in (never up), eased back out afterwards.
      const tryCam = (back, side, lift) => {
        const want = pivot.clone().addScaledVector(flat, -back * s).addScaledVector(right, side * s).addScaledVector(up, lift * s).addScaledVector(dir, 0);
        const off = want.clone().sub(pivot), L = off.length();
        this.ray.set(pivot, off.clone().normalize());
        const hit = this.ray.intersectObjects(blockers, false).find(h => h.distance < L);
        return { want, off, L, hit };
      };
      const c = tank ? tryCam(2.3, 0.65, 0.1)   // just above the tank's hat, so the tank sits in the lower middle of the view
        : owSt >= 2 ? tryCam(6, 0, 1.4) : tryCam(3.1, 0.75, 0.25);   // open world: behind the shoulder (further back under a parachute)
      const want = c.hit ? Math.max(0.2, (c.hit.distance - 0.25) / c.L) : 1;
      this.otsFrac = want < (this.otsFrac ?? 1) ? want : (this.otsFrac ?? 1) + (want - (this.otsFrac ?? 1)) * Math.min(1, dt * 5);
      const pos = pivot.clone().addScaledVector(c.off, this.otsFrac);
      const floorY = (this.level && this.level.hAt ? this.level.hAt(pos.x, pos.z) : 0) + 0.3;
      if (pos.y < floorY) pos.y = floorY;
      this.camera.position.copy(pos);
      this.camera.lookAt(pos.clone().add(dir));
      this.otsCam = { pos: pos.clone(), dist: pos.distanceTo(pivot) * 0.9 };
    } else this.otsCam = null;
    if (fp && !fpTank) {
      this.camera.position.set(local.pos.x, local.pos.y + RULES.eye * (local.size || 1) * ((local.flags || 0) & 32 ? 0.7 : 1), local.pos.z);
      this.camera.lookAt(this.camera.position.clone().add(this.fpDir()));
      const skin = this.gunOf(local);
      if (this.blaster.skin !== skin) this.setViewGun(skin, local.color);
      else if (this.blaster.color !== local.color) this.blaster.setColor(local.color);
      const sp = local.vel ? Math.hypot(local.vel.x, local.vel.z) : 0;
      this.gunBob += dt * (sp > 0.5 ? 9 : 2);
      const bobA = Math.min(1, sp / 8) * 0.012;
      this.gunRecoil = Math.max(0, this.gunRecoil - dt * 7);
      const k = this.gunRecoil * this.gunRecoil;
      this.viewGun.position.set(0.19 + Math.sin(this.gunBob) * bobA, -0.17 + Math.abs(Math.cos(this.gunBob)) * bobA + k * 0.01, -0.52 + k * 0.045);
      this.viewGun.rotation.set(k * 0.18, 0, 0);
      if (skin === 'katana') {   // first-person sword: a sweeping swing, raised and glowing while charging
        this.fpSwing = Math.max(0, (this.fpSwing || 0) - dt * 5.5);
        const sw = this.fpSwing, ch = Math.max(0, local.kCharge ?? 0), u = 1 - sw;
        this.viewGun.position.set(0.17 + (sw > 0 ? 0.25 - 0.55 * Math.min(1, u * 1.3) : 0), -0.2 + ch * 0.06, -0.45);
        this.viewGun.rotation.set(0.25 + ch * 0.5, sw > 0 ? 0.9 - 1.9 * Math.min(1, u * 1.3) : 0.15, sw > 0 ? -0.9 : -0.25 - ch * 0.3);
        const blade = this.blaster.blade;
        if (blade) { blade.emissive.set(local.color); blade.emissiveIntensity = ch * 1.2 + (ch >= 0.999 ? 0.4 + Math.sin(performance.now() / 60) * 0.3 : 0); }
      }
      this.blaster.glow.material.opacity = 0.55 + k * 0.45;
      this.blaster.muzzle.visible = this.gunRecoil > 0.75 && skin !== 'katana';
      this.blaster.muzzle.rotation.z = Math.random() * 6.28;
      this.blaster.reload(local.reloadFrac > 0);
    } else if (this.level && this.level.side) sideCamera(this, view, local, dt);
    else if (!fpTank && !(ow && owCamera(this, view, local, dt))) {
      let focus, zoom;
      const L = this.level || { hx: 19, hz: 12 };
      if (local && (local.alive || revHold)) {
        focus = new THREE.Vector3(local.pos.x, 0, local.pos.z);
        if (local.aimPoint) {
          const lead = new THREE.Vector3(local.aimPoint.x - local.pos.x, 0, local.aimPoint.z - local.pos.z);
          if (lead.length() > 6) lead.setLength(6);
          focus.addScaledVector(lead, 0.3);
        }
        zoom = clamp(Math.sqrt(L.hx / 19), 1, 1.2) * clamp(this.settings.topZoom || 1, 0.6, 2.2);   // v1.2.13: scroll wheel zoom (Devin)
      } else {
        const others = view.players.filter(p => p.alive);
        focus = new THREE.Vector3();
        for (const p of others) focus.add(new THREE.Vector3(p.pos.x, 0, p.pos.z));
        if (others.length) focus.multiplyScalar(1 / others.length);
        zoom = clamp(L.hx / 19 * 1.15, 1.1, 2);
      }
      // keep the camera from drifting far past the arena edges
      focus.x = clamp(focus.x, -L.hx + 7, L.hx - 7); focus.z = clamp(focus.z, -L.hz + 4, L.hz - 6);
      // v1.2.11: spectator pan and zoom (main.js spectating / specInput). Panning leaves the auto camera until Jump.
      const sc = this.spec || (this.spec = { x: 0, z: 0, zoom: 1, manual: false });
      if (local && (local.alive || revHold) && !this.freeCam) sc.manual = false;   // (v1.2.26 freeCam: commander mode pans too)
      else {
        const si = this.specInput;
        if (si && si.follow) sc.manual = false;
        else if (si && (si.f || si.r)) { const sp = (si.fast ? 34 : 17) * zoom * sc.zoom * dt; sc.manual = true; sc.x += si.r * sp; sc.z -= si.f * sp; }
        if (sc.manual) { sc.x = clamp(sc.x, -L.hx, L.hx); sc.z = clamp(sc.z, -L.hz, L.hz); focus.set(sc.x, 0, sc.z); }
        else { sc.x = focus.x; sc.z = focus.z; }
        zoom *= sc.zoom;
      }
      const pw = this.punchWeight();   // v1.2.0: zoom in on the round-winning kill
      if (pw > 0) { const P = this.punchFx; focus.lerp(new THREE.Vector3(P.x, 0, P.z), 0.7 * pw); zoom *= 1 - 0.38 * pw; }
      const target = new THREE.Vector3(focus.x, 15 * zoom, focus.z + 11 * zoom);
      const k = this.snapCamera ? 1 : 1 - Math.exp(-dt * (4 + 6 * pw));
      this.snapCamera = false;
      this.camera.position.lerp(target, k);
      this.camLook.lerp(focus, k);
      this.camera.lookAt(this.camLook);
      if (local && this.settings.view === 'first') { this.yaw = Math.atan2(local.aim.x, local.aim.z); this.pitch = 0; }
    }
    // v1.1.0: depth precision scales with the near plane, so push it out as far as each view allows (the old fixed
    // 0.05 wasted most of the depth buffer on the first few centimeters). First person: as far as the player's own
    // radius allows at this FOV, so walls you stand against never get cut open. Over the shoulder: the camera keeps
    // 0.25 m off walls. The overhead arena camera is high above everything, so it can use a large one.
    if (this.camera.isPerspectiveCamera && !(this.level && this.level.side)) {
      const tv = Math.tan(this.camera.fov * Math.PI / 360), corner = Math.sqrt(1 + tv * tv * (1 + this.camera.aspect * this.camera.aspect));
      let near;
      if (fp && !fpTank) near = clamp(0.75 * RULES.playerRadius * ((local && local.size) || 1) / corner, 0.05, 0.25);
      else if (fpTank || ow) near = clamp(0.2 / corner, 0.05, 0.15);
      else near = 0.6;
      if (Math.abs(this.camera.near - near) > 0.005) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
    }
    // v1.2.0: smooth shake (amount grows with the square of the trauma, so small hits stay subtle and big ones
    // really rattle) instead of random jitter, plus a short camera kick away from where you shoot.
    this.shakeT += dt;
    const off = this.camOff || (this.camOff = new THREE.Vector3());
    if (this.shake > 0) {
      // v1.2.21 (Devin): a hard cap (Settings > General "Max screen shake") so a screen full of explosions stays playable
      const cap = 0.75 * Math.sqrt(Math.max(0.05, Math.min(1, this.settings.shakeMax ?? 0.5))), tr = Math.min(this.shake, cap);
      const a = tr * tr * 1.6, t = this.shakeT;
      if (this.shake > cap + 0.25) this.shake = cap + 0.25;   // piled-up trauma can't keep it maxed for long
      off.x += a * (Math.sin(t * 47) * 0.6 + Math.sin(t * 83 + 1.3) * 0.4);
      off.y += a * (Math.sin(t * 59 + 2.1) * 0.6 + Math.sin(t * 97 + 0.4) * 0.4);
      off.z += a * 0.5 * Math.sin(t * 71 + 3.3);
      this.shake = Math.max(0, this.shake - dt * 1.6);
    }
    off.add(this.camKick);
    this.camera.position.add(off);   // a pure slide: the view direction never changes
    this.camKick.multiplyScalar(Math.exp(-dt * 16));
    if (this.fpKick > 0.0005) { if (fp && !fpTank) this.camera.rotateX(this.fpKick); this.fpKick *= Math.exp(-dt * 18); }
    if (this.punchFx && this.camera.isPerspectiveCamera && fp) {   // first person: a short narrowing of the view
      const want = this.settings.fov * (1 - 0.18 * this.punchWeight());
      if (Math.abs(this.camera.fov - want) > 0.05) { this.camera.fov = want; this.camera.updateProjectionMatrix(); }
    }
    if (this.punchFx && (this.punchFx.t += dt) > this.punchFx.dur) { this.punchFx = null; if (this.camera.isPerspectiveCamera && fp) { this.camera.fov = this.settings.fov; this.camera.updateProjectionMatrix(); } }
  }

  // Used on the title screen: slow orbit around the current level.
  orbit(t) {
    this.applySlopColors();
    if (this.level && this.level.side) useSideCamera(this, false);
    const R = this.level ? Math.max(this.level.hx, this.level.hz) + 6 : 24;
    this.camera.position.set(Math.sin(t * 0.12) * R, R * 0.8, Math.cos(t * 0.12) * R);
    this.camera.lookAt(0, 0, 0);
    this.viewGun.visible = false;
  }

  // v1.2.4: shader warm-up. three.js builds a shader the first time something of a new kind is drawn, and on
  // Windows (Direct3D under the hood) each one can take tens to hundreds of milliseconds: that was the hitch on the
  // first shot, first kill, first critter, first heal field... of every match. After a level loads, one copy of every
  // effect, bullet look and unit model is drawn (tiny, in front of the camera) so every shader is ready up front.
  warmUp() {
    const cam = this.camera; cam.updateMatrixWorld();
    const d = new THREE.Vector3(); cam.getWorldDirection(d);
    const P = cam.position.clone().addScaledVector(d, 5), x = P.x, y = P.y, z = P.z;
    const before = new Set(this.scene.children), fx0 = this.fx.length, eff = this.settings.effects;
    this.settings.effects = 'high';
    const e = { x, y, z, r: 1.5, d: 0.6, dur: 0.6, life: 0.6, k: 1, n: 1, id: -999, x1: x, y1: y, z1: z, x2: x + 1, y2: y, z2: z, ax: 0, az: 1, arc: 1, p: '__warm' };
    const calls = [
      () => this.burst(x, y, z, '#ffffff', 2, 1), () => this.ring(x, y, z, 1, '#ffffff'), () => this.line(x, y, z, x + 1, y, z, '#ffffff', 0.2, 0.1),
      () => this.lockFlash(x, y, z, '#ffffff'), () => this.glowSprite(x, y, z, '#ffffff', 1, 0.2), () => this.deathPop(x, y, z, '#ff0000', true),
      () => this.fieldRing(x, y, z, 2, '#00ff00'), () => this.holyBeam(x, y, z, 0.5), () => this.healField(x, y, z, 2, 0.5), () => this.healPulse(x, y, z, 2),
      () => this.plus(x, y, z, 0), () => this.aoeFlash(e), () => this.toxicCloud(e), () => this.shockArea(e), () => this.poisonBlotch(e),
      () => this.napalmSplat(e, '#ff8800'), () => this.meteorWarn(e), () => this.blood(x, y, z), () => this.mote(x, y, z), () => this.portal(e),
      () => this.slashFx(e, '#ffffff'), () => this.cutFx(e, '#ffffff'),
    ];
    for (const f of calls) { try { f(); } catch { /* an effect that needs more context: skip it */ } }
    const kinds = [{}, { raider: true }, { kind: 'critter' }, { kind: 'splitter' }, { kind: 'blockTurret' }, { kind: 'mount' }, { kind: 'brute' }, { kind: 'turret' }, { kind: 'drone' }, { kind: 'boss' }, { kind: 'portal' }, { kind: 'angel' },
      { kind: 'core' }, { kind: 'amon', am: 'grunt' }, { kind: 'hazardTurret' }, { flags: 1 }];   // v1.2.8: + Core Defense's core, AMON raiders, hazard turrets, Tiny Tank
    const ids = [];
    // v1.2.8: Core Defense props (built walls, falling drops with their parachutes, the placement hologram) and the
    // other wall kinds: each brought its own shader variants the first time one landed or was picked up mid-match.
    try {
      for (const kind of [...Object.keys(CORE_LOOK), 'sandbag', 'concrete', 'pillar']) this.scene.add(this.buildWall({ kind, len: 1.2, th: 1, h: 1, x, y0: y, z, color: '#888888' }));
      for (let k = 0; k < 8; k++) this.scene.add(this.coreProp(k));
      const ch = this.parachute('#ffffff'), gh = this.coreProp(0); this.scene.add(ch, gh);
      gh.traverse(o => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0x6ad8ff, transparent: true, opacity: 0.35, depthWrite: false }); });
      gh.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xbff2ff, transparent: true, opacity: 0.9 })));
    } catch { /* skip */ }
    kinds.forEach((k, i) => { const id = '__warm' + i; try { this.makePlayer({ id, color: '#888888', cosmetics: null, ...k }); ids.push(id); } catch { /* skip */ } });
    const fxs = [undefined, 'flame', 'wave', 'bee', 'grenade', 'squid', 'slash'];
    try { this.syncBullets(fxs.map((fx, i) => ({ id: -100 - i, fx, pos: { x, y, z }, vel: { x: 1, y: 0, z: 0 }, r: 0.1, ring: i === 0 ? 1 : 0, color: '#ffffff' }))); } catch { /* skip */ }
    const added = this.scene.children.filter(o => !before.has(o));
    for (const o of added) { o.position.copy(P); o.traverse(c => { c.visible = true; c.frustumCulled = false; }); }
    try { this.drawFrame(); } catch (err) { console.warn('[warm-up]', err); }
    // v1.2.8: the first-person gun (and riot shield) draw in their own scene with its own lights, so their shaders
    // differ from the world's: they used to compile on the first shot in first person
    const gv = [], riot = buildRiotShield('#888888');
    this.viewGun.traverse(o => { gv.push([o, o.visible]); o.visible = true; });   // (the muzzle flash too)
    try { this.gunScene.add(riot.group); riot.group.position.set(0, -1, -2); this.r.setRenderTarget(null); this.r.autoClear = false; this.r.clearDepth(); this.r.render(this.gunScene, this.gunCam); } catch { /* skip */ }
    this.r.autoClear = true; for (const [o, v] of gv) o.visible = v; this.gunScene.remove(riot.group);
    for (const id of ids) this.removePlayer(id);
    try { this.syncBullets([]); } catch { /* skip */ }
    for (const f of this.fx.splice(fx0)) this.endFx(f);
    this.clearNapalm();
    for (const o of this.scene.children.filter(o => !before.has(o))) this.scene.remove(o);
    this.settings.effects = eff;
  }
  drawFrame() {
    this.syncParts();
    if (this.post) this.post.render(); else this.r.render(this.scene, this.camera);
    if (this.freeOldAfter > 0 && --this.freeOldAfter === 0) this.freeOldPosts();
    else if (!this.post && !this.gfxKey && this.oldPosts && this.oldPosts.length) this.freeOldPosts();
  }
  render() {
    if (this.envDirty && this.level) this.buildEnvProbe();
    // a different camera (e.g. an orthographic one) needs the effect chain rebuilt for it
    if (this.post && this.post.camera !== this.camera) { (this.oldPosts ||= []).push(this.post); this.post = null; this.gfxKey = ''; this.applyGraphics(); }
    if (this.owCullObjs) owCull(this);
    if (this.needWarm && this.level) {
      // v1.2.6: only when something that changes shaders changed since the last warm-up (compiled shaders stay cached,
      // so warming up again after every round only cost a long frame)
      this.needWarm = false;
      const s = this.settings, sig = [s.lighting, this.rim.visible, this.sun.castShadow, this.r.shadowMap.enabled, this.r.shadowMap.type, !!this.scene.environment,
        this.scene.fog ? (this.scene.fog.isFogExp2 ? 2 : 1) : 0, this.post ? 'post' : '', this.camera.type, !!s.pillow, s.hiModels !== false].join('|');   // (v1.2.17: was the whole effect key; the world's shaders only change with the chain on/off)
      if (sig !== this.warmSig) { this.warmSig = sig; try { this.warmUp(); } catch (err) { console.warn('[warm-up]', err); } }
    }
    this.drawFrame();
    if (this.viewGun.visible || (this.fpRiot && this.fpRiot.group.visible)) {
      this.r.setRenderTarget(null);
      this.r.autoClear = false; this.r.clearDepth();
      this.r.render(this.gunScene, this.gunCam);
      this.r.autoClear = true;
    }
  }
}
