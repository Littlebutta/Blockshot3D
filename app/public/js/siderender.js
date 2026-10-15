// 2D side view drawing: an orthographic camera looking straight down -z (no perspective, so you only ever see
// the front faces: everything reads flat), a painted backdrop, islands and platforms, the glowing arena edges,
// the death pits and the strings of the hanging platforms. Used by render.js when level.side is set.
import * as THREE from '/vendor/three/build/three.module.js';
import { ART } from './config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const EDGE_Z = 1.75;   // the edge glow and pit void sit just in front of the blocks (blocks are 3 m deep)

// Swap between the normal perspective camera and the side view's orthographic one.
export function useSideCamera(r, on) {
  if (!r.perspCam) r.perspCam = r.camera;
  if (on) {
    if (!r.orthoCam) { r.orthoCam = new THREE.OrthographicCamera(-20, 20, 11, -11, 0.1, 400); r.scene.add(r.orthoCam); }
    r.camera = r.orthoCam;
  } else r.camera = r.perspCam;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  return t;
}
const lvlTex = (w, h, draw) => { const t = canvasTex(w, h, draw); t.userData = { perLevel: true }; return t; };   // v1.2.6: freed with its level (render.js disposeLevel; blockMat's are cached)
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

// Front-face texture for a block: 1 m stripes in the theme's band colors under a bright cap in the top color.
function blockMat(r, theme, w, h, kind) {
  r.sideMats ||= new Map();
  const key = `${theme.name}|${kind}|${w.toFixed(1)}|${h.toFixed(1)}`;
  if (r.sideMats.has(key)) return r.sideMats.get(key);
  const ppm = 24, H = Math.max(8, Math.min(1024, Math.round(h * ppm))), W = Math.max(8, Math.min(1024, Math.round(w * ppm)));
  const map = canvasTex(W, H, (g) => {
    if (kind === 'plat') {
      g.fillStyle = shade(theme.top, 0.95); g.fillRect(0, 0, W, H);
      g.fillStyle = shade(theme.bandB, 0.8); g.fillRect(0, H * 0.55, W, H * 0.45);
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(0, 0, W, 3);
      g.fillStyle = 'rgba(0,0,0,.25)'; for (let x = 12; x < W; x += 36) g.fillRect(x, H * 0.55, 2, H * 0.45);
      return;
    }
    for (let m = 0; m * ppm < H; m++) { g.fillStyle = m % 2 ? theme.bandB : theme.bandA; g.fillRect(0, m * ppm, W, ppm); }
    // a grassy / capped top, darker toward the bottom (islands reach down past the bottom edge)
    g.fillStyle = kind === 'ground' ? (theme.grass || theme.top) : theme.top; g.fillRect(0, 0, W, Math.min(H, 7));
    g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(0, 0, W, 2);
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);
  });
  map.magFilter = THREE.NearestFilter;
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.85 });
  if (theme.style === 'neon') { m.emissiveMap = map; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.6; }
  r.sideMats.set(key, m);
  return m;
}

export function sideBuild(r, level) {
  useSideCamera(r, !level.brawl);   // brawl: the perspective camera (3D-looking stages)
  const theme = ART.themes[level.theme % ART.themes.length], S = level.side, hx = level.hx;
  r.level = level; r.aimables = []; r.driftPts = null; r.seaTex = null; r.lavaMat = null; r.waterMat = null; r.liquidFx = null; r.hoverFx = []; r.forestLogs = [];
  const G = r.levelGroup = new THREE.Group();
  r.scene.add(G);
  // sky + backdrop
  const sky0 = theme.sky || [shade(theme.fog || ART.background, 1.6), theme.fog || ART.background];
  // v26: 2D backdrops are always dark (lightness capped), so characters and above all bullets stand out against them
  const darken = (c, L) => { const k = new THREE.Color(c), hsl = {}; k.getHSL(hsl); k.setHSL(hsl.h, Math.min(0.55, hsl.s), Math.min(L, hsl.l * 0.5)); return '#' + k.getHexString(); };
  const sky = level.brawl ? sky0 : [darken(sky0[0], 0.2), darken(sky0[1], 0.14)];
  r.scene.background = new THREE.Color(sky[1]);
  r.scene.fog.near = 500; r.scene.fog.far = 900; r.scene.fog.color.set(sky[1]);
  const BW = hx * 2 + 80, BH = (S.top - S.bottom) + 50;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshStandardMaterial({ roughness: 1, map: lvlTex(512, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, sky[0]); grd.addColorStop(1, sky[1]); g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // two rows of soft silhouette hills / towers in the theme's wall color
    let seed = level.seed >>> 0; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (const [y0, k, a] of [[0.62, 0.7, 0.35], [0.74, 0.5, 0.55]]) {
      g.fillStyle = level.brawl ? shade(theme.wall, k) : darken(theme.wall, 0.12 + 0.05 * k); g.globalAlpha = a; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, h * y0 - Math.abs(Math.sin(x * 0.013 + rnd() * 0.3 + y0 * 9)) * h * 0.12 - (rnd() < 0.08 ? h * 0.08 : 0));
      g.lineTo(w, h); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
  }) }));
  back.position.set(0, (S.top + S.bottom) / 2, -9); back.receiveShadow = true; G.add(back);
  if (level.brawl) { back.position.z = -45; back.scale.set(3.2, 2.6, 1); }
  if (level.brawl) brawlScenery(r, level, theme, G);
  // blocks: islands, platforms, pillars
  for (const b of level.boxes) {
    const kind = b.ground ? 'ground' : b.plat ? 'plat' : 'block';
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), blockMat(r, theme, b.w, b.h, kind));
    mesh.position.set(b.x, b.y0 + b.h / 2, b.z || 0);
    mesh.castShadow = mesh.receiveShadow = true;
    G.add(mesh); r.aimables.push(mesh);
  }
  // bounce pads: a bright striped spring plate on the surface
  const padMap = lvlTex(64, 16, (g, w, h) => { g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a2a2a'; for (let x = -16; x < w; x += 16) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 8, 0); g.lineTo(x + 14, 0); g.lineTo(x + 6, h); g.fill(); } });
  for (const [a, b, y] of S.pads || []) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b - a, 0.22, 2.2), new THREE.MeshStandardMaterial({ map: padMap, emissive: 0x332200, roughness: 0.5 }));
    m.position.set((a + b) / 2, y + 0.11, 0.6); G.add(m);
  }
  // moving / hanging platforms and props (render.js's builder), then the side look for the platforms
  const topMats = r.topMaterials(theme), edgeMats = ART.tierColors.map(tc => new THREE.LineBasicMaterial({ color: tc }));
  r.buildDynamics(level, theme, G, topMats, edgeMats);
  r.sideStrings = [];
  for (const d of level.dynamic || []) {
    const e = r.dynMeshes.get(d.id);
    if (!e || (d.kind !== 'slide' && d.kind !== 'swing')) continue;
    e.mesh.material = blockMat(r, theme, d.w, d.h, 'plat');
    for (let i = e.mesh.children.length - 1; i >= 0; i--) if (e.mesh.children[i].isLine) e.mesh.remove(e.mesh.children[i]);
    if (d.kind === 'swing') {
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2a2420 }));
      line.frustumCulled = false; G.add(line);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(d.w * 0.8, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: 0x3a3532, roughness: 0.6, metalness: 0.4 }));
      hook.position.set(d.ax, d.ay + 0.09, 0.4); G.add(hook);
      r.sideStrings.push({ id: d.id, d, geo });
    }
  }
  if (level.brawl) { sideFinish(r, level, hx); return; }   // brawl: no hurting border, the blast zones are off screen
  // the glowing arena border (it hurts) with gaps over the pits, and the pits themselves: a dark void
  const glow = r.sideEdgeMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  const strip = (x0, x1, y0, y1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.01, x1 - x0), Math.max(0.01, y1 - y0)), glow); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, EDGE_Z); m.renderOrder = 3; G.add(m); };
  const T = 0.22, E = hx;
  strip(-E - T, -E, S.bottom - T, S.top + T); strip(E, E + T, S.bottom - T, S.top + T); strip(-E - T, E + T, S.top, S.top + T);
  const pits = (S.pits || []).slice().sort((a, b) => a[0] - b[0]);
  let x = -E;
  for (const [a, b] of pits) { if (a > x) strip(x, Math.min(a, E), S.bottom - T, S.bottom); x = Math.max(x, b); }
  if (x < E) strip(x, E, S.bottom - T, S.bottom);
  const voidTex = lvlTex(8, 128, (g, w, h) => { const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, 'rgba(10,0,0,0)'); grd.addColorStop(0.35, 'rgba(40,0,0,.75)'); grd.addColorStop(1, 'rgba(0,0,0,1)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); });
  for (const [a, b] of pits) {
    const v = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 8), new THREE.MeshBasicMaterial({ map: voidTex, transparent: true, depthWrite: false, fog: false }));
    v.position.set((a + b) / 2, S.bottom - 2.5, EDGE_Z - 0.05); G.add(v);
    // a row of spikes down in the dark so the pit reads as deadly
    const n = Math.max(2, Math.floor((b - a) / 0.7)), spikes = new THREE.Group();
    for (let i = 0; i < n; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 4), new THREE.MeshBasicMaterial({ color: 0x5a1010, fog: false })); s.position.set(a + (i + 0.5) * (b - a) / n, S.bottom - 3.2, EDGE_Z - 0.1); spikes.add(s); }
    G.add(spikes);
  }
  // outside the arena: a dark frame so the play area stands out
  const frame = new THREE.MeshBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
  const box = (x0, x1, y0, y1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), frame); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, EDGE_Z + 0.05); m.renderOrder = 2; G.add(m); };
  box(-E - 60, -E - T, S.bottom - 60, S.top + 60); box(E + T, E + 60, S.bottom - 60, S.top + 60); box(-E - T, E + T, S.top + T, S.top + 60);
  sideFinish(r, level, hx);
}

function sideFinish(r, level, hx) {
  const S = level.side;
  // light from the front-top so faces read well and blocks throw soft shadows onto the backdrop
  r.sun.position.set(10, S.top + 22, 40); r.sun.target.position.set(0, (S.top + S.bottom) / 2, 0);
  const ext = hx + 14;
  Object.assign(r.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 160 });
  r.sun.shadow.camera.updateProjectionMatrix();
  // housekeeping shared with the normal level builder
  r.slopMats = [];
  r.glossMats = [];
  r.reflectMeshes = [];
  if (r.post) r.post.setSelects(r.reflectMeshes);
  if (r.envTex) { r.envTex.dispose(); r.envTex = null; r.scene.environment = null; }
  if (r.settings.reflections === 'probe' || r.settings.reflections === 'ssr') r.envDirty = true;
  r.applyGraphics();
  r.sideFocus = null;
}

// Every frame: the hanging platforms' strings, the edge glow pulse and the camera.
export function sideCamera(r, view, local, dt) {
  const L = r.level, S = L.side;
  useSideCamera(r, !L.brawl);
  const cam = r.camera;
  for (const s of r.sideStrings || []) {
    const e = r.dynMeshes.get(s.id); if (!e) continue;
    const p = e.mesh.position, d = s.d, top = p.y + d.h, o = d.w * 0.38, a = s.geo.attributes.position.array;
    a.set([d.ax - o, d.ay, 0.4, p.x - o, top, 0.4, d.ax + o, d.ay, 0.4, p.x + o, top, 0.4]);
    s.geo.attributes.position.needsUpdate = true;
  }
  if (L.brawl) return brawlCamera(r, view, local, dt);
  if (r.sideEdgeMat) r.sideEdgeMat.opacity = 0.7 + 0.25 * Math.sin(performance.now() / 260);
  const aspect = innerWidth / innerHeight;
  const fullH = (S.top - S.bottom) / 2 + 1.4, fullW = L.hx + 1.2;
  // whole arena on screen when it fits (ROUNDS style); bigger arenas follow you, zoomed to the arena's height
  let V = Math.max(fullH, fullW / aspect), follow = false;
  if (V > 17) { V = clamp(fullH, 11, 17); follow = true; }
  const W = V * aspect;
  let cx = 0, cy = (S.top + S.bottom) / 2 + 0.6;
  if (follow) {
    if (local && local.alive) { cx = local.pos.x; cy = local.pos.y + 1; if (local.aimPoint) cx += clamp(local.aimPoint.x - local.pos.x, -8, 8) * 0.25; }
    else { const al = view.players.filter(p => p.alive); if (al.length) { cx = al.reduce((s, p) => s + p.pos.x, 0) / al.length; cy = al.reduce((s, p) => s + p.pos.y, 0) / al.length; } }
    cx = W >= fullW ? 0 : clamp(cx, -fullW + W, fullW - W);
    const lo = S.bottom - 1.4 + V, hi = S.top + 1.4 - V;
    cy = lo > hi ? (S.top + S.bottom) / 2 : clamp(cy, lo, hi);
  }
  if (!r.sideFocus || r.snapCamera) r.sideFocus = new THREE.Vector2(cx, cy);
  r.snapCamera = false;
  const k = 1 - Math.exp(-dt * 5);
  r.sideFocus.x += (cx - r.sideFocus.x) * k; r.sideFocus.y += (cy - r.sideFocus.y) * k;
  cam.left = -W; cam.right = W; cam.top = V; cam.bottom = -V; cam.near = 0.1; cam.far = 400; cam.updateProjectionMatrix();
  cam.position.set(r.sideFocus.x, r.sideFocus.y, 80);
  cam.lookAt(r.sideFocus.x, r.sideFocus.y, 0);
}

// Mouse aim: where the cursor ray meets the play plane (z = 0), straight from your chest.
export function sideAim(r, chest) {
  r.ray.setFromCamera(r.mouse, r.camera);
  const pt = new THREE.Vector3();
  if (!r.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), pt)) return null;
  const d = pt.clone().sub(chest); d.z = 0;
  if (d.lengthSq() < 0.04) return null;
  d.normalize();
  return { aim: { x: d.x, y: d.y, z: 0 }, aimPoint: { x: pt.x, y: pt.y, z: 0 } };
}

// ---- Brawl stages (brawl.js): floating islands with rocky undersides and scenery at several depths.
function brawlScenery(r, level, theme, G) {
  let seed = (level.seed ^ 0x5eed) >>> 0; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rock = new THREE.MeshStandardMaterial({ color: shade(theme.wall, 0.75), roughness: 0.95, flatShading: true });
  const rock2 = new THREE.MeshStandardMaterial({ color: shade(theme.bandB || theme.wall, 0.6), roughness: 1, flatShading: true });
  // under every island: a tapered rock that hangs below it (the main stage's is deepest)
  for (const b of level.boxes) {
    if (!b.main) continue;
    const depth = b.w > 10 ? 7 : 4;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 7, 3), rock);
    const pos = cone.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {   // taper toward the bottom tip, jagged
      const y = pos.getY(i), k = (y + 0.5);
      pos.setX(i, pos.getX(i) * (0.15 + 0.85 * k) * (1 + (rnd() - 0.5) * 0.25));
      pos.setZ(i, pos.getZ(i) * (0.15 + 0.85 * k) * (1 + (rnd() - 0.5) * 0.25));
    }
    cone.geometry.computeVertexNormals();
    cone.scale.set(b.w * 0.98, depth, b.d * 0.98);
    cone.position.set(b.x, b.y0 - depth / 2 + 0.05, 0);
    cone.castShadow = cone.receiveShadow = true; G.add(cone);
  }
  // floating rocks and far islands behind the stage (parallax under the moving camera)
  for (let i = 0; i < 18; i++) {
    const far = i < 8, z = far ? -32 + rnd() * 8 : -8 - rnd() * 14, s = far ? 2 + rnd() * 4 : 0.5 + rnd() * 1.6;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), far ? rock2 : rock);
    m.scale.set(s * (1 + rnd()), s * (0.5 + rnd() * 0.6), s);
    m.position.set((rnd() - 0.5) * (level.hx * 2.6), level.side.bottom + 4 + rnd() * (level.side.top - level.side.bottom), z);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    if (far) { const cap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.3, 8), new THREE.MeshStandardMaterial({ color: theme.grass || theme.top, roughness: 0.9 })); cap.position.y = 0.55; m.add(cap); }
    G.add(m);
  }
  // a soft glow line on the main stage's front lip so the edge reads in 3D
  for (const b of level.boxes) if (b.main) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    lip.position.set(b.x, b.y0 + b.h, b.d / 2); G.add(lip);
  }
}

// Smash-style camera: frames every fighter still in, zooming out as they spread, a little above the stage looking down.
function brawlCamera(r, view, local, dt) {
  const L = r.level, B = L.brawl, cam = r.camera;
  const al = view.players.filter(p => p.alive && p.kind === 'hero');
  let x0 = -B.W, x1 = B.W, y0 = -1, y1 = 4;
  for (const p of al) { x0 = Math.min(x0, p.pos.x - 3); x1 = Math.max(x1, p.pos.x + 3); y0 = Math.min(y0, p.pos.y - 2); y1 = Math.max(y1, p.pos.y + 3.5); }
  x0 = Math.max(x0, -L.hx); x1 = Math.min(x1, L.hx); y0 = Math.max(y0, B.bottom); y1 = Math.min(y1, B.top);
  const aspect = innerWidth / innerHeight, fov = (cam.fov || 50) * Math.PI / 180;
  const halfH = clamp(Math.max((y1 - y0) / 2, (x1 - x0) / 2 / aspect) + 1.5, 7, 22);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, dist = halfH / Math.tan(fov / 2);
  if (!r.sideFocus || r.snapCamera || r.sideFocus.z == null) r.sideFocus = new THREE.Vector3(cx, cy, dist);
  r.snapCamera = false;
  const k = 1 - Math.exp(-dt * 3);
  r.sideFocus.x += (cx - r.sideFocus.x) * k; r.sideFocus.y += (cy - r.sideFocus.y) * k; r.sideFocus.z += (dist - r.sideFocus.z) * k;
  const f = r.sideFocus;
  if (cam.far < 400) { cam.far = 400; cam.updateProjectionMatrix(); }
  cam.position.set(f.x, f.y + f.z * 0.16, f.z);
  cam.lookAt(f.x, f.y, 0);
}
