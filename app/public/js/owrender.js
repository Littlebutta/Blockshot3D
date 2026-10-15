// Open world rendering (see openworld.js): chunked hill terrain, merged building meshes, themed props,
// loot items, the flying blue bus, parachutes, fog and the bus / spectator cameras.
import * as THREE from '/vendor/three/build/three.module.js';
import { ART } from './config.js';
import { OW, lootColor, VEH_KINDS } from './openworld.js';
import { makeRock, makeTree, makeBush, makeFern, makePine, iceCrystal, neonPylon, makeCherryTree, stoneLantern, bambooClump,
  makePalm, beachUmbrella, tikiTorch, crater, moonRock, satDish, obsidianSpire, mushroomPatch, makeLog } from './scenery.js';

// the sun's offset from the shadow box center, and the shadow camera's own x / y axes (for texel snapping)
const OW_SUN_DIR = new THREE.Vector3(36, 100, 48);
const OW_SUN_Z = OW_SUN_DIR.clone().normalize(), OW_SUN_X = new THREE.Vector3(0, 1, 0).cross(OW_SUN_Z).normalize(), OW_SUN_Y = OW_SUN_Z.clone().cross(OW_SUN_X);
const CH = 8;   // terrain / building chunks per side
const col = (c, fb = '#888888') => new THREE.Color(c || fb);

export function owBuild(R, level) {
  const G = R.levelGroup = new THREE.Group();
  R.scene.add(G);
  R.level = level; R.aimables = []; R.reflectMeshes = []; R.glossMats = []; R.slopMats = []; R.forestLogs = [];
  R.lavaMat = null; R.waterMat = null; R.liquidFx = null; R.hoverFx = []; R.driftPts = null;
  if (R.envTex) { R.envTex.dispose(); R.envTex = null; R.scene.environment = null; }
  const H = OW.half, n = level.hfN, c = OW.cell, per = (n - 1) / CH;
  const themes = level.zones.map(z => ART.themes[z.theme] || ART.themes[0]);
  const zFloor = themes.map(t => col(t.floor)), zRock = themes.map(t => col(t.rock || t.wall));
  // ---- terrain: zone colors blurred across borders, rockier on slopes, snow on high tundra
  const vc = new Float32Array(n * n * 3), tmp = new THREE.Color(), B = 3;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0, w = 0;
    for (let dj = -B; dj <= B; dj += 2) for (let di = -B; di <= B; di += 2) {
      const ii = Math.min(n - 1, Math.max(0, i + di)), jj = Math.min(n - 1, Math.max(0, j + dj)), zc = zFloor[level.zf[jj * n + ii]];
      r += zc.r; g += zc.g; b += zc.b; w++;
    }
    tmp.setRGB(r / w, g / w, b / w);
    const k = j * n + i, h = level.hf[k];
    const sx = (level.hf[k + (i < n - 1 ? 1 : 0)] - level.hf[k - (i > 0 ? 1 : 0)]), sz = (level.hf[k + (j < n - 1 ? n : 0)] - level.hf[k - (j > 0 ? n : 0)]);
    const slope = Math.min(1, Math.hypot(sx, sz) / (c * 2) * 1.4);
    tmp.lerp(zRock[level.zf[k]], slope * 0.7);
    if (h > 24) tmp.lerp(new THREE.Color('#c3cdd7'), Math.min(1, (h - 24) / 10));   // v28: snow caps toned down (was #e8eef4)
    { const lum = tmp.r * 0.3 + tmp.g * 0.59 + tmp.b * 0.11; if (lum > 0.4) tmp.multiplyScalar(1 - (lum - 0.4) * 0.9); }   // v28: bright sand / snow ground darkened
    const jit = 0.94 + ((Math.sin(i * 12.9898 + j * 78.233) * 43758.5453) % 1 + 1) % 1 * 0.1;
    vc[k * 3] = tmp.r * jit; vc[k * 3 + 1] = tmp.g * jit; vc[k * 3 + 2] = tmp.b * jit;
  }
  const terrMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });   // pushed back so building floors never z-fight with the pads under them
  const cell = v => Math.min(CH - 1, Math.max(0, Math.floor((v + H) / (2 * H) * CH)));
  for (let cj = 0; cj < CH; cj++) for (let ci = 0; ci < CH; ci++) {
    const m = per + 1, pos = new Float32Array(m * m * 3), cols = new Float32Array(m * m * 3), idx = [];
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const gi = ci * per + i, gj = cj * per + j, k = gj * n + gi, o = (j * m + i) * 3;
      pos[o] = -H + gi * c; pos[o + 1] = level.hf[k]; pos[o + 2] = -H + gj * c;
      cols[o] = vc[k * 3]; cols[o + 1] = vc[k * 3 + 1]; cols[o + 2] = vc[k * 3 + 2];
    }
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) { const a = j * m + i, b = a + 1, d = a + m, e = d + 1; idx.push(a, d, b, b, d, e); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setIndex(idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, terrMat); mesh.receiveShadow = true; mesh.userData.floor = true;
    G.add(mesh); R.aimables.push(mesh);
  }
  // ---- buildings: every box of a chunk merged into one mesh (one for lit boxes, one for glowing trim)
  const buckets = new Map(), rng = rngOf(level.seed ^ 0x7a11);
  for (const b of level.boxes) {
    if (b.rock) {
      const t = themes[b.zone] || themes[0], m = makeRock(b.w, b.h, b.d, rng, { rock: t.rock, moss: t.moss || t.grass });
      m.position.set(b.x, b.y0 + b.h / 2, b.z); G.add(m); m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; R.aimables.push(o); } });
      continue;
    }
    const key = (cell(b.z) * CH + cell(b.x)) * 2 + (b.glow ? 1 : 0);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(b);
  }
  const litMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  R.glossMats.push(litMat);
  for (const [key, list] of buckets) {
    const glow = key % 2 === 1, geo = boxesGeometry(list, themes);
    const mesh = new THREE.Mesh(geo, glow ? glowMat : litMat);
    if (!glow) { mesh.castShadow = mesh.receiveShadow = true; R.aimables.push(mesh); }
    G.add(mesh);
  }
  if (R.settings.props !== false && (ART.propDensity ?? 1) > 0) addProps(R, level, themes, G);
  // v1.2.6: terrain chunks, building chunks, rocks and props get a bounding sphere for owCull (fog culling)
  G.updateMatrixWorld(true);
  const box = new THREE.Box3(); R.owCullObjs = [];
  for (const o of G.children) { box.setFromObject(o); if (!box.isEmpty()) R.owCullObjs.push({ o, s: box.getBoundingSphere(new THREE.Sphere()) }); }
  // ---- loot: spinning colored cubes with a faint beam of light
  const L = level.loot.length;
  if (L) {
    const cube = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), new THREE.MeshBasicMaterial({ color: 0xffffff }), L);
    const beam = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.2, 3.2, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }), L);
    level.loot.forEach((it, i) => { const cc = col(lootColor(it[3])); cube.setColorAt(i, cc); beam.setColorAt(i, cc); });
    G.add(cube, beam);
    R.owLoot = { cube, beam, taken: new Set() };
  } else R.owLoot = null;
  R.owBus = buildBus(); G.add(R.owBus);
  R.owChutes = new Map(); R.owVeh = new Map();
  // the red wall (battle royale) and the extraction beacon (co-op); both shine through the fog
  R.owWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 260, 72, 1, true), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  R.owWall.visible = false; G.add(R.owWall);
  const ext = R.owExt = new THREE.Group();
  ext.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 220, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x5aff8a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })));
  ext.children[0].position.y = 110;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0x5aff8a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; ext.add(ring);
  ext.visible = false; G.add(ext);
  R.scene.background = new THREE.Color(themes[4] && themes[4].fog || '#a9b8c8');
  R.scene.fog.color.copy(R.scene.background);
  R.owFogKey = -1;
  Object.assign(R.sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 220 });
  R.sun.shadow.camera.updateProjectionMatrix();
  if (R.settings.reflections === 'probe' || R.settings.reflections === 'ssr') R.envDirty = true;
  R.applyGloss();
}
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// v1.2.6: static pieces (terrain and building chunks, rocks, props) lying wholly past the fog's far end are skipped.
// Linear fog runs on view depth, and an object's nearest view depth is at least its bounding sphere center's depth
// minus the radius, so a skipped one would have drawn as pure fog color (the sky behind it is the same color); the
// camera's far plane sits further out (owUpdate). Shadows are unaffected: anything past the fog is far outside the
// shadow box around the camera. Called by Renderer.render every frame, for the camera about to be drawn.
const _cp = new THREE.Vector3(), _cf = new THREE.Vector3(), _cd = new THREE.Vector3();
export function owCull(R) {
  const list = R.owCullObjs, cam = R.camera, fog = R.scene.fog;
  if (!list) return;
  const far = fog && fog.isFog && cam.isPerspectiveCamera ? fog.far : Infinity;
  cam.getWorldDirection(_cf); _cp.setFromMatrixPosition(cam.matrixWorld);
  for (const { o, s } of list) o.visible = far === Infinity || _cd.copy(s.center).sub(_cp).dot(_cf) - s.radius < far;
}

// One BufferGeometry for a list of boxes (24 vertices each, vertex colored).
function boxesGeometry(list, themes) {
  const N = list.length, pos = new Float32Array(N * 72), nor = new Float32Array(N * 72), cols = new Float32Array(N * 72), idx = new Uint32Array(N * 36);
  const F = [   // face normal, then 4 corners as signs of (x,y,z)
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]], [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]], [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  const cc = new THREE.Color();
  list.forEach((b, bi) => {
    cc.set(b.c || (themes[b.zone] || themes[0]).bandA);
    // v26: thin floor slabs sit a hair higher and a hair inside their walls, so their faces never share a plane
    // with the pad, wall or roof they touch (that flickered as you moved).
    const thin = b.h < 0.6, ins = thin ? 0.008 : 0, lift = thin ? 0.02 : 0;
    const hx = b.w / 2 - ins, hh = b.h / 2 + lift / 2, hz = b.d / 2 - ins, cy = b.y0 + hh;
    F.forEach(([nm, cs], fi) => {
      const shade = nm[1] > 0 ? 1.06 : nm[1] < 0 ? 0.6 : nm[0] ? 0.9 : 0.97;
      cs.forEach((s, k) => {
        const o = (bi * 24 + fi * 4 + k) * 3;
        pos[o] = b.x + s[0] * hx; pos[o + 1] = cy + s[1] * hh; pos[o + 2] = b.z + s[2] * hz;
        nor[o] = nm[0]; nor[o + 1] = nm[1]; nor[o + 2] = nm[2];
        cols[o] = cc.r * shade; cols[o + 1] = cc.g * shade; cols[o + 2] = cc.b * shade;
      });
      const v = bi * 24 + fi * 4, q = (bi * 6 + fi) * 6;
      idx[q] = v; idx[q + 1] = v + 1; idx[q + 2] = v + 2; idx[q + 3] = v; idx[q + 4] = v + 2; idx[q + 5] = v + 3;
    });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

// Themed decoration per zone (no collision), kept off building pads.
function addProps(R, level, themes, G) {
  const rng = rngOf(level.seed ^ 0x51a7), H = OW.half;
  const make = (st, t) => {
    const r = rng();
    switch (st) {
      case 'forest': return r < 0.6 ? makeTree(rng, { bark: t.bark, leaf: t.grass }) : r < 0.85 ? makeBush(rng, t.grass) : mushroomPatch(rng);
      case 'tundra': return r < 0.75 ? makePine(rng, true) : iceCrystal(rng);
      case 'neon': return neonPylon(rng, (t.glow || ['#ff3da8'])[r < 0.5 ? 0 : 1] || '#3fe0ff');
      case 'sakura': return r < 0.55 ? makeCherryTree(rng) : r < 0.8 ? stoneLantern(rng) : bambooClump(rng);
      case 'tropical': return r < 0.65 ? makePalm(rng) : r < 0.85 ? beachUmbrella(rng) : tikiTorch(rng);
      case 'lunar': return r < 0.45 ? crater(rng, 1 + rng() * 2) : r < 0.85 ? moonRock(rng) : satDish(rng);
      case 'volcano': return obsidianSpire(rng);
      case 'western': return r < 0.6 ? makeRock(1 + rng() * 2, 0.6 + rng() * 1.4, 1 + rng() * 2, rng, { rock: t.rock }) : makeLog(2 + rng() * 2, 0.25, rng, { bark: t.bark || '#8a6a4a' });
      case 'candy': return r < 0.6 ? makeTree(rng, { bark: '#e8c8d8', leaf: t.grass }) : makeBush(rng, t.rock);
      case 'castle': return r < 0.6 ? makeTree(rng, { bark: '#6a4a30', leaf: t.grass }) : makeFern(rng, t.grass);
      default: return r < 0.5 ? makeBush(rng, t.grass) : makeRock(1, 0.8, 1, rng, { rock: t.rock });
    }
  };
  const onPad = (x, z) => level.pads.some(p => Math.abs(x - p.x) < p.w / 2 + 2 && Math.abs(z - p.z) < p.d / 2 + 2);
  level.zones.forEach((zn, zi) => {
    const t = themes[zi], st = t.style || '';
    for (let k = 0, tries = 0; k < 22 && tries < 80; tries++) {
      const x = zn.x + (rng() - 0.5) * 110, z = zn.z + (rng() - 0.5) * 110;
      if (Math.abs(x) > H - 6 || Math.abs(z) > H - 6 || level.zoneAt(x, z) !== zi || onPad(x, z)) continue;
      const m = make(st, t); if (!m) continue;
      m.position.set(x, level.hAt(x, z) - 0.05, z); m.rotation.y = rng() * 6.28;
      if (st !== 'lunar') m.scale.multiplyScalar(1.25 + rng() * 0.5);
      m.traverse(o => {
        if (!o.isMesh) return; o.castShadow = true;
        const c = o.material && o.material.color;   // v28: very bright props (snowy pines, ice, white sand things) toned down
        if (c && !o.material.emissiveIntensity && c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.7) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.8); }
      });
      G.add(m); k++;
    }
  });
}

// The flying blue bus under its balloon.
function buildBus() {
  const g = new THREE.Group(), M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, ...o });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  const blue = M('#2f6fe0'), dark = M('#1b2440', { roughness: 0.2, metalness: 0.4 }), white = M('#f2f5fa'), tire = M('#202020');
  box(2.8, 2.4, 9, blue, 0, 0, 0);
  box(2.86, 0.9, 7.2, dark, 0, 0.45, -0.4);       // window band
  box(2.6, 1.0, 0.1, dark, 0, 0.45, 4.52);        // windshield
  box(2.9, 0.18, 9.05, white, 0, -0.35, 0);       // stripe
  box(2.4, 0.3, 8, white, 0, 1.35, 0);            // roof rack
  const wg = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14);
  for (const [x, z] of [[-1.3, 2.9], [1.3, 2.9], [-1.3, -2.9], [1.3, -2.9]]) { const w = new THREE.Mesh(wg, tire); w.rotation.z = Math.PI / 2; w.position.set(x, -1.2, z); g.add(w); }
  const balloon = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 14), M('#e8ecf5'));
  balloon.position.y = 8.2; balloon.scale.y = 1.15; g.add(balloon);
  const band = new THREE.Mesh(new THREE.TorusGeometry(4.25, 0.35, 8, 28), blue); band.rotation.x = Math.PI / 2; band.position.y = 8.2; g.add(band);
  const pts = []; for (const [x, z] of [[-1.2, 4], [1.2, 4], [-1.2, -4], [1.2, -4]]) pts.push(new THREE.Vector3(x, 1.2, z), new THREE.Vector3(x * 1.6, 5.2, z * 0.7));
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x333333 })));
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.visible = false;
  return g;
}
// Scooter, bike and car (pivot on the ground, facing +z).
function buildVehicle(kind) {
  const g = new THREE.Group(), M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, ...o });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  const wheel = (r, w, x, y, z, m) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), m); c.rotation.z = Math.PI / 2; c.position.set(x, y, z); g.add(c); };
  const tire = M('#1d1d1d'), metal = M('#c9ccd4', { metalness: 0.6, roughness: 0.3 });
  if (kind === 'scooter') {
    const paint = M('#ff5f5f'); g.userData.paint = paint;
    box(0.36, 0.1, 1.15, paint, 0, 0.18, 0);
    box(0.06, 1.0, 0.06, metal, 0, 0.7, 0.52).rotation.x = -0.15;
    box(0.6, 0.05, 0.05, metal, 0, 1.2, 0.6);
    wheel(0.13, 0.08, 0, 0.13, 0.5, tire); wheel(0.13, 0.08, 0, 0.13, -0.5, tire);
  } else if (kind === 'bike') {
    const paint = M('#3fd0e0'); g.userData.paint = paint;
    const T = new THREE.TorusGeometry(0.36, 0.05, 6, 18);
    for (const z of [0.62, -0.62]) { const t = new THREE.Mesh(T, tire); t.rotation.y = Math.PI / 2; t.position.set(0, 0.38, z); g.add(t); }
    box(0.07, 0.07, 1.0, paint, 0, 0.62, 0).rotation.x = 0.1;
    box(0.07, 0.55, 0.07, paint, 0, 0.62, -0.25);
    box(0.22, 0.06, 0.32, M('#222'), 0, 0.92, -0.3);
    box(0.62, 0.05, 0.05, metal, 0, 1.02, 0.55);
  } else {
    const paint = M('#ffcf3a', { metalness: 0.3, roughness: 0.35 }); g.userData.paint = paint;
    box(1.9, 0.7, 3.6, paint, 0, 0.6, 0);
    box(1.7, 0.62, 1.8, M('#1b2440', { roughness: 0.15, metalness: 0.4 }), 0, 1.25, -0.2);
    box(1.72, 0.06, 1.6, paint, 0, 1.58, -0.2);
    for (const [x, z] of [[-0.95, 1.2], [0.95, 1.2], [-0.95, -1.2], [0.95, -1.2]]) wheel(0.36, 0.3, x, 0.36, z, tire);
    box(0.4, 0.15, 0.05, M('#fff6c0', { emissive: '#fff2a0', emissiveIntensity: 0.8 }), -0.6, 0.65, 1.81);
    box(0.4, 0.15, 0.05, M('#fff6c0', { emissive: '#fff2a0', emissiveIntensity: 0.8 }), 0.6, 0.65, 1.81);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function buildChute(color) {
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.9, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.4),
    new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6 }));
  canopy.scale.y = 0.55; canopy.position.y = 3.2; g.add(canopy);
  const pts = []; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; pts.push(new THREE.Vector3(0, 1.3, 0), new THREE.Vector3(Math.cos(a) * 1.55, 3.55, Math.sin(a) * 1.55)); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xeeeeee })));
  return g;
}

export const owStateOf = (view, id) => { const ow = view.ow; if (!ow || !ow.ps) return 0; for (const r of ow.ps) if (r[0] === id) return r[1]; return 0; };

// Per frame: bus, parachutes, loot, fog, sun.
export function owUpdate(R, view, local, dt) {
  const ow = view.ow || {}, now = performance.now() / 1000, level = R.level;
  // bus
  const bus = ow.bus;
  R.owBus.visible = !!bus;
  if (bus) { R.owBus.position.set(bus[0], bus[1] + Math.sin(now * 0.8) * 0.4, bus[2]); R.owBus.rotation.y = bus[3]; }
  // players in the air: bus riders are hidden, parachutes over the gliders
  const st = new Map((ow.ps || []).map(r => [r[0], r[1]]));
  for (const [id, e] of R.players) {
    const s = st.get(id) || 0;
    if (s === 1) e.root.visible = false;
    let ch = R.owChutes.get(id);
    if (s === 3 && !ch) { ch = buildChute(e.color || '#ffffff'); R.owChutes.set(id, ch); R.scene.add(ch); }
    if (ch) {
      ch.visible = s === 3;
      if (s === 3) { ch.position.copy(e.root.position); ch.rotation.y = e.root.rotation.y; ch.rotation.z = Math.sin(now * 1.7 + e.phase) * 0.06; }
    }
  }
  for (const [id, ch] of R.owChutes) if (!R.players.has(id)) { R.scene.remove(ch); R.owChutes.delete(id); }
  // vehicles (a car hides its driver; scooters and bikes carry theirs standing / seated)
  const seen = new Set();
  for (const r of ow.veh || []) {
    const [id, ki, x, y, z, yaw, rider, hpf = 1] = r; seen.add(id);
    let m = R.owVeh.get(id);
    if (!m) { m = buildVehicle(VEH_KINDS[ki]); R.owVeh.set(id, m); R.levelGroup.add(m); }
    const e = rider && R.players.get(rider);
    if (e) { m.position.copy(e.root.position); if (VEH_KINDS[ki] === 'car') e.root.visible = false; }
    else m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.visible = Math.hypot(m.position.x - R.camera.position.x, m.position.z - R.camera.position.z) < OW.fogFar + 20;
    // a damaged car: darker, smoking under 60%, burning under 30%
    if (hpf < 0.999 && m.userData.dmgK !== Math.round(hpf * 20)) {
      m.userData.dmgK = Math.round(hpf * 20);
      m.traverse(o => { if (o.isMesh && o.material && o.material.color) { if (!o.userData.base) { o.material = o.material.clone(); o.userData.base = o.material.color.clone(); } o.material.color.copy(o.userData.base).multiplyScalar(0.35 + 0.65 * hpf); } });
    }
    if (m.visible && hpf < 0.6 && Math.random() < (hpf < 0.3 ? 0.5 : 0.2)) R.burst(m.position.x, m.position.y + 1.2, m.position.z, hpf < 0.3 ? (Math.random() < 0.5 ? '#ff7a1a' : '#3a3a3a') : '#555b63', 1, 1.2);
    const paintC = e ? e.color : null;
    if (m.userData.paint && paintC && m.userData.tint !== paintC) { m.userData.paint.color.set(paintC); m.userData.tint = paintC; }
  }
  for (const [id, m] of R.owVeh) if (!seen.has(id)) { R.levelGroup.remove(m); R.owVeh.delete(id); }
  // red wall / extraction
  if (ow.wall) { R.owWall.visible = true; const r = Math.max(0.5, ow.wall[2]); R.owWall.scale.set(r, 1, r); R.owWall.position.set(ow.wall[0], 100, ow.wall[1]); R.owWall.material.opacity = 0.26 + Math.sin(now * 3) * 0.05; }
  else R.owWall.visible = false;
  if (ow.ext) { R.owExt.visible = true; R.owExt.position.set(ow.ext[0], ow.ext[4] || level.hAt(ow.ext[0], ow.ext[1]), ow.ext[1]); R.owExt.scale.set(ow.ext[2], 1, ow.ext[2]); R.owExt.children[0].material.opacity = 0.18 + (ow.ext[3] > 0 ? 0.2 : 0) + Math.sin(now * 2.5) * 0.04; }
  else R.owExt.visible = false;
  // loot
  if (R.owLoot) {
    const taken = ow.taken || R.owLoot.taken, m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const cx = R.camera.position.x, cz = R.camera.position.z, far2 = (OW.fogFar + 10) ** 2;
    level.loot.forEach((it, i) => {
      const gone = taken.has(i) || (it[0] - cx) ** 2 + (it[2] - cz) ** 2 > far2;
      e.set(0.4, now * 1.6 + i, 0); q.setFromEuler(e);
      p.set(it[0], it[1] + 0.55 + Math.sin(now * 2 + i) * 0.12, it[2]); sc.setScalar(gone ? 0 : 1);
      m.compose(p, q, sc); R.owLoot.cube.setMatrixAt(i, m);
      q.identity(); p.set(it[0], it[1] + 1.6, it[2]); m.compose(p, q, sc); R.owLoot.beam.setMatrixAt(i, m);
    });
    R.owLoot.cube.instanceMatrix.needsUpdate = true; R.owLoot.beam.instanceMatrix.needsUpdate = true;
  }
  // fog: clear from the bus, a light haze on the ground in the color of the zone you're in
  const me = local && st.get(local.id);
  const inBus = me === 1 || (!local && bus);
  const near = inBus ? 260 : OW.fogNear, far = inBus ? 1400 : OW.fogFar;
  const f = R.scene.fog, k = Math.min(1, dt * 1.5);
  f.near += (near - f.near) * (inBus ? 1 : k); f.far += (far - f.far) * (inBus ? 1 : k);
  const camFar = Math.max(f.far + 25, 160);
  if (Math.abs(R.camera.far - camFar) > 5) { R.camera.far = camFar; R.camera.updateProjectionMatrix(); }   // (near: set per frame in Renderer.update, v1.1.0)   // v26: a larger near plane = finer depth (less flicker)
  const zi = level.zoneAt(R.camera.position.x, R.camera.position.z), t = ART.themes[level.zones[zi].theme] || {};
  // Sky / fog color: blended over the zones around you (so borders fade instead of snapping), with very bright
  // themes (snow, candy) toned down, and eased in slowly.
  const want = new THREE.Color(0, 0, 0), cx0 = R.camera.position.x, cz0 = R.camera.position.z;
  let wsum = 0;
  for (const [ox, oz, w] of [[0, 0, 2], [24, 0, 1], [-24, 0, 1], [0, 24, 1], [0, -24, 1], [17, 17, 0.7], [-17, 17, 0.7], [17, -17, 0.7], [-17, -17, 0.7]]) {
    const zt = ART.themes[level.zones[level.zoneAt(cx0 + ox, cz0 + oz)].theme] || {}, c = new THREE.Color(zt.fog || (zt.sky && zt.sky[1]) || '#a9b8c8');
    if (zt.style === 'lunar' || zt.style === 'neon') c.lerp(new THREE.Color('#556070'), 0.25);
    const hsl = {}; c.getHSL(hsl); if (hsl.l > 0.5) c.setHSL(hsl.h, hsl.s * 0.8, 0.5);   // keep snow / candy haze from glaring
    want.r += c.r * w; want.g += c.g * w; want.b += c.b * w; wsum += w;
  }
  want.multiplyScalar(1 / wsum);
  f.color.lerp(want, Math.min(1, dt * 0.35)); R.scene.background.copy(f.color);
  // the sun's shadow box follows the camera
  // v1.0.5: snapped to whole shadow-map texels in the light's own view, so shadows don't crawl and shimmer as you move
  const c = R.camera.position;
  let tx = Math.round(c.x / 4) * 4, tz = Math.round(c.z / 4) * 4, ty = Math.round(level.hAt(tx, tz) / 4) * 4;
  {
    const L = OW_SUN_DIR, ax = OW_SUN_X, ay = OW_SUN_Y, cam = R.sun.shadow.camera, texel = (cam.right - cam.left) / (R.sun.shadow.mapSize.x || 2048);
    const a = tx * ax.x + ty * ax.y + tz * ax.z, b = tx * ay.x + ty * ay.y + tz * ay.z, da = Math.round(a / texel) * texel - a, db = Math.round(b / texel) * texel - b;
    tx += ax.x * da + ay.x * db; ty += ax.y * da + ay.y * db; tz += ax.z * da + ay.z * db;
    R.sun.target.position.set(tx, ty, tz); R.sun.position.set(tx + L.x, ty + L.y, tz + L.z);
  }
  if (R.rim) { R.rim.target.position.set(tx, ty, tz); R.rim.position.set(tx - 40, ty + 60, tz - 55); }
}
export function owTake(R, id) { if (R.owLoot) R.owLoot.taken.add(id); }

// Cameras the open world adds: riding the bus (orbit with the mouse; the whole map is in view) and
// spectating a teammate (or anyone) after you're out. Returns true when it placed the camera.
export function owCamera(R, view, local, dt) {
  const ow = view.ow || {};
  const me = local ? owStateOf(view, local.id) : 0;
  if (ow.bus && (me === 1 || !local)) {
    const b = new THREE.Vector3(ow.bus[0], ow.bus[1], ow.bus[2]), dir = R.fpDir();
    R.camera.position.copy(b).addScaledVector(dir, -28).add(new THREE.Vector3(0, 7, 0));
    R.camera.lookAt(b);
    return true;
  }
  if (local && local.alive) { R.owFly = null; R.owSpecFollow = false; return false; }
  // Out of the match: fly freely around the map (move keys, jump = up, crouch = down, mouse looks). The view key follows a player instead.
  if (local && !R.owSpecFollow) {
    const fl = R.owFly || (R.owFly = R.camera.position.clone());
    const inp = R.owFlyInput || {}, dir = R.fpDir(), right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const sp = 24 * dt * (inp.fast ? 2.5 : 1);
    fl.addScaledVector(dir, (inp.f || 0) * sp).addScaledVector(right, (inp.r || 0) * sp); fl.y += (inp.up || 0) * sp;
    const H = OW.half - 2; fl.x = Math.max(-H, Math.min(H, fl.x)); fl.z = Math.max(-H, Math.min(H, fl.z));
    fl.y = Math.max(R.level.hAt(fl.x, fl.z) + 1, Math.min(OW.ceil, fl.y));
    R.camera.position.copy(fl); R.camera.lookAt(fl.x + dir.x, fl.y + dir.y, fl.z + dir.z);
    return true;
  }
  const alive = view.players.filter(p => p.alive && (!p.kind || p.kind === 'hero') && !p.raider);
  const tgt = (local && alive.find(p => p.team === local.team && p.id !== local.id && !ow.ffa)) || alive[0];
  if (!tgt) return false;
  const a = tgt.aim || { x: 0, z: 1 }, l = Math.hypot(a.x, a.z) || 1;
  const want = new THREE.Vector3(tgt.pos.x - a.x / l * 6, tgt.pos.y + 3.2, tgt.pos.z - a.z / l * 6);
  const gy = R.level.hAt(want.x, want.z); if (want.y < gy + 1) want.y = gy + 1;
  R.camera.position.lerp(want, R.snapCamera ? 1 : 1 - Math.exp(-dt * 4)); R.snapCamera = false;
  R.camera.lookAt(tgt.pos.x, tgt.pos.y + 1.4, tgt.pos.z);
  return true;
}
