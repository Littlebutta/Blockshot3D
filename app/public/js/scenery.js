// Themed scenery meshes (visual only, no collision). Used by render.js for the Forest, Tundra and Neon themes.
// Every builder takes a seeded rng so all players see the same arena.
import * as THREE from '/vendor/three/build/three.module.js';

const texCache = new Map();
function canvasTex(key, w, h, draw, repeat) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  texCache.set(key, t);
  return t;
}
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------------------------------------------------------------- materials
export function barkTexture(color = '#5a4330') {
  return canvasTex('bark' + color, 64, 128, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {   // vertical furrows
      const x = hash(i) * w, wd = 1 + hash(i + 9) * 3;
      g.fillStyle = `rgba(20,12,6,${0.25 + hash(i + 3) * 0.3})`; g.fillRect(x, 0, wd, h);
      g.fillStyle = 'rgba(255,230,190,.07)'; g.fillRect(x + wd, 0, 1, h);
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(hash(i + 50) * w, hash(i + 80) * h, 4 + hash(i) * 6, 1); }
  }, true);
}
export function ringsTexture() {
  return canvasTex('rings', 64, 64, (g) => {
    g.fillStyle = '#c9a874'; g.fillRect(0, 0, 64, 64);
    for (let r = 4; r < 32; r += 3 + (r % 4)) { g.strokeStyle = `rgba(110,72,36,${0.35 + (r % 3) * 0.12})`; g.lineWidth = 1.2; g.beginPath(); g.arc(32 + (r % 2), 32, r, 0, 6.29); g.stroke(); }
    g.strokeStyle = '#5a4330'; g.lineWidth = 4; g.beginPath(); g.arc(32, 32, 31, 0, 6.29); g.stroke();
  });
}
function std(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra }); }

// ---------------------------------------------------------------- rocks
// A boulder that fills a w x h x d box: a subdivided box pushed toward an ellipsoid with noise, top kept
// flat (you can stand on it), moss on the upward faces. Fits the collision box closely.
export function makeRock(w, h, d, rng, opts = {}) {
  const geo = new THREE.BoxGeometry(w, h, d, 4, 5, 4), pos = geo.attributes.position, col = [];
  const base = new THREE.Color(opts.rock || '#7a7a6c'), moss = new THREE.Color(opts.moss || '#5e8a34'), c = new THREE.Color();
  const s1 = rng() * 10, s2 = rng() * 10, v = new THREE.Vector3();
  // Same displacement for vertices that share a position (box faces are separate), so the rock stays closed.
  const noise = (x, y, z) => Math.sin(x * 2.1 + s1) * Math.cos(z * 1.9 + s2) * 0.5 + Math.sin(y * 1.7 + x * 1.3 + s2) * 0.35 + Math.cos(z * 3.3 - y * 2.2 + s1) * 0.15;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const nx = v.x / (w / 2), ny = v.y / (h / 2), nz = v.z / (d / 2);
    // blend the box toward an ellipsoid (rounded boulder), more so near the top, keeping the footprint
    const L = Math.hypot(nx, ny * 0.65, nz) || 1, k = 0.42 + 0.18 * Math.max(0, ny);
    let x = v.x * (1 - k + k / L), z = v.z * (1 - k + k / L);
    const n = noise(v.x, v.y, v.z);
    const r = 1 + n * 0.09;
    x *= r; z *= r;
    let y = v.y;
    if (ny > 0.99) { x *= 0.92; z *= 0.92; y += n * 0.03; }         // flat-ish top you can stand on
    else if (ny < -0.99) { x *= 0.97; z *= 0.97; }
    else y += n * 0.08 * h / 3;
    pos.setXYZ(i, x, y, z);
    const m = ny > 0.99 ? 0.38 + 0.25 * Math.max(0, n) : ny > 0.6 ? 0.3 * (ny - 0.6) / 0.4 * Math.max(0, n + 0.3) : 0;
    c.copy(base).offsetHSL(0, 0, n * 0.05 + (ny < -0.6 ? -0.05 : 0)).lerp(moss, Math.min(0.7, m));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- logs and mushrooms
// Oyster mushrooms: overlapping fan-shaped shelves growing out of the wood. Built facing +z.
export function oysterCluster(rng, size = 1) {
  const g = new THREE.Group(), cap = std('#bfb29a', { roughness: 0.6 }), gill = std('#e8dfcc', { roughness: 0.7 });
  const n = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const r = (0.09 + rng() * 0.08) * size, s = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, 0.025 * size, 14, 1, false, -Math.PI / 2, Math.PI), cap);
    const under = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.5, 0.03 * size, 14, 1, false, -Math.PI / 2, Math.PI), gill);
    under.position.y = -0.022 * size;
    s.add(top, under);
    s.position.set(0, (i - n / 2) * 0.05 * size + (rng() - 0.5) * 0.03, (rng() - 0.5) * 0.18 * size);
    s.rotation.set(-(0.15 + rng() * 0.2), (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.2);   // tilted up a little, like real shelves
    s.scale.set(1, 1, 0.85 + rng() * 0.3);
    g.add(s);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// An overturned log filling a box: lying along its long axis, bark sides, ringed ends, a broken branch,
// and clusters of oyster mushrooms on the sides.
export function makeLog(len, rad, rng, opts = {}) {
  const g = new THREE.Group();
  const bark = std(opts.bark || '#5a4330', { map: barkTexture(opts.bark || '#5a4330'), roughness: 0.95 });
  bark.map.repeat.set(3, Math.max(1, len / 1.5));
  const ends = std('#c9a874', { map: ringsTexture(), roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.05, len, 14, 4), [bark, ends, ends]);
  // gentle irregularity along the length
  const p = body.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = 1 + Math.sin(y * 2.3 + len) * 0.04; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  body.geometry.computeVertexNormals();
  body.rotation.z = Math.PI / 2; body.castShadow = body.receiveShadow = true;
  g.add(body);
  if (rng() < 0.7) {   // broken branch stub
    const br = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.22, rad * 0.32, rad * 1.1, 8), bark);
    br.position.set((rng() - 0.5) * len * 0.6, rad * 0.75, 0); br.rotation.z = (rng() - 0.5) * 0.9; br.rotation.x = -0.4; g.add(br);
  }
  // oyster mushrooms on both sides
  const clusters = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < clusters; i++) {
    const side = rng() < 0.5 ? 1 : -1, ox = oysterCluster(rng, 1 + rng() * 0.5);
    ox.position.set((rng() - 0.5) * len * 0.8, (rng() - 0.3) * rad * 0.6, side * rad * 0.96);
    ox.rotation.y = side > 0 ? 0 : Math.PI;
    g.add(ox);
  }
  return g;
}

// Bear's Head Tooth (Hericium americanum): a branched white fruiting body hung with cascading icicle-like
// spines in tufts at every branch tip. Built growing out along +z from a trunk at the origin.
export function bearsHeadTooth(rng, size = 1) {
  const g = new THREE.Group(), white = std('#f4efe2', { roughness: 0.55, emissive: 0x15130e });
  const base = new THREE.Mesh(new THREE.SphereGeometry(0.11 * size, 10, 8), white); base.scale.set(1.2, 0.8, 1); base.position.z = 0.06 * size; g.add(base);
  const tips = [];
  const branches = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < branches; i++) {
    const a = (i / branches - 0.5) * 2.4 + (rng() - 0.5) * 0.3, L = (0.14 + rng() * 0.16) * size, up = 0.05 + rng() * 0.12;
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * size, 0.025 * size, L, 5), white);
    const dir = new THREE.Vector3(Math.sin(a), up + (rng() - 0.5) * 0.25, Math.cos(a)).normalize();
    br.position.copy(dir.clone().multiplyScalar(L / 2)).add(new THREE.Vector3(0, 0, 0.06 * size));
    br.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); g.add(br);
    const tip = dir.clone().multiplyScalar(L).add(new THREE.Vector3(0, 0, 0.06 * size));
    tips.push(tip);
    // secondary branchlets
    for (let j = 0; j < 2; j++) { const t2 = tip.clone().add(new THREE.Vector3((rng() - 0.5) * 0.12, (rng() - 0.2) * 0.06, rng() * 0.08).multiplyScalar(size)); tips.push(t2); }
  }
  // cascading spines: many thin downward cones per tip
  const spine = new THREE.ConeGeometry(0.008 * size, 1, 4); spine.translate(0, -0.5, 0);
  const per = 12, inst = new THREE.InstancedMesh(spine, white, tips.length * per), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let k = 0;
  for (const tip of tips) for (let s = 0; s < per; s++) {
    const len = (0.06 + rng() * 0.12) * size;
    e.set((rng() - 0.5) * 0.25, 0, (rng() - 0.5) * 0.25); q.setFromEuler(e);
    m.compose(new THREE.Vector3(tip.x + (rng() - 0.5) * 0.06 * size, tip.y + (rng() - 0.5) * 0.02, tip.z + (rng() - 0.5) * 0.06 * size), q, new THREE.Vector3(1, len, 1));
    inst.setMatrixAt(k++, m);
  }
  g.add(inst);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// A deciduous tree: textured trunk with root flares and a clumpy canopy. hericium: a Bear's Head Tooth
// on the trunk facing `face` (radians, the direction it grows toward).
export function makeTree(rng, opts = {}) {
  const g = new THREE.Group(), h = opts.height || 5.5 + rng() * 2.5, r = 0.3 + rng() * 0.2;
  const bark = std(opts.bark || '#5a4330', { map: barkTexture(opts.bark || '#5a4330'), roughness: 0.95 }); bark.map.repeat.set(2, 3);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, h, 10), bark); trunk.position.y = h / 2; g.add(trunk);
  for (let i = 0; i < 4; i++) {   // root flares
    const a = i / 4 * 6.28 + rng(), root = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, 0.9, 6), bark);
    root.position.set(Math.cos(a) * r * 0.9, 0.3, Math.sin(a) * r * 0.9); root.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9); g.add(root);
  }
  const leaf = new THREE.Color(opts.leaf || '#3f6b2c');
  for (let i = 0; i < 5; i++) {
    const c = leaf.clone().offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.08);
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4 + rng() * 1.1, 0), std(c, { flatShading: true }));
    blob.position.set((rng() - 0.5) * 2.4, h - 0.6 + rng() * 1.6, (rng() - 0.5) * 2.4); g.add(blob);
  }
  if (opts.hericium) {
    const ht = bearsHeadTooth(rng, 3.3);
    const y = opts.hericiumY ?? 1.6 + rng() * 0.6, f = opts.face || 0;
    ht.position.set(Math.cos(f) * r * 0.85, y, Math.sin(f) * r * 0.85); ht.rotation.y = Math.PI / 2 - f;
    g.add(ht);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// Small decorative mushrooms for the forest floor: a little cluster of caps on stems.
export function mushroomPatch(rng) {
  const g = new THREE.Group(), red = rng() < 0.22;
  const capC = red ? '#c8372d' : ['#b0794a', '#9c6a3f', '#c99a63'][Math.floor(rng() * 3)];
  const cap = std(capC, { roughness: 0.55 }), stem = std('#ece2cc', { roughness: 0.7 }), dot = std('#fbf6ea');
  const n = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const hgt = 0.06 + rng() * 0.1, cr = 0.035 + rng() * 0.04, m = new THREE.Group();
    const st = new THREE.Mesh(new THREE.CylinderGeometry(cr * 0.28, cr * 0.36, hgt, 6), stem); st.position.y = hgt / 2; m.add(st);
    const cp = new THREE.Mesh(new THREE.SphereGeometry(cr, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), cap); cp.position.y = hgt; cp.scale.y = 0.7; m.add(cp);
    if (red) for (let k = 0; k < 4; k++) { const d = new THREE.Mesh(new THREE.SphereGeometry(cr * 0.14, 5, 4), dot); const a = k * 1.7 + rng(); d.position.set(Math.cos(a) * cr * 0.55, hgt + cr * 0.45, Math.sin(a) * cr * 0.55); m.add(d); }
    m.position.set((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3); m.rotation.z = (rng() - 0.5) * 0.3;
    g.add(m);
  }
  return g;
}

// Fern: arching fronds around a center.
export function makeFern(rng, color = '#4f8a35') {
  const g = new THREE.Group(), mat = std(color, { side: THREE.DoubleSide, roughness: 0.9 });
  const frond = new THREE.PlaneGeometry(0.12, 0.6, 1, 4); frond.translate(0, 0.3, 0);
  const p = frond.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, -y * y * 0.6); p.setX(i, p.getX(i) * (1 - y / 0.75)); }
  frond.computeVertexNormals();
  const n = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const f = new THREE.Mesh(frond, mat); f.rotation.y = i / n * 6.28 + rng() * 0.4; f.rotation.x = -0.5 - rng() * 0.3;
    f.scale.setScalar(0.8 + rng() * 0.6); g.add(f);
  }
  return g;
}
export function makeBush(rng, color = '#3f6b2c') {
  const g = new THREE.Group();
  for (let i = 0; i < 3 + Math.floor(rng() * 3); i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + rng() * 0.25, 0), std(new THREE.Color(color).offsetHSL(0, 0, (rng() - 0.5) * 0.1), { flatShading: true }));
    b.position.set((rng() - 0.5) * 0.7, 0.2 + rng() * 0.2, (rng() - 0.5) * 0.7); g.add(b);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------- tundra
export function makePine(rng, snowy = true) {
  const g = new THREE.Group(), h = 4 + rng() * 3.5;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, h * 0.35, 7), std('#4a3526')); trunk.position.y = h * 0.17; g.add(trunk);
  const green = std('#2f5a43', { flatShading: true }), snow = std('#f4f8fc', { flatShading: true });
  for (let i = 0; i < 4; i++) {
    const r = (1.3 - i * 0.26) * (h / 6), y = h * 0.25 + i * h * 0.19;
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.32, 8), green); c.position.y = y + h * 0.16; g.add(c);
    if (snowy) { const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.72, h * 0.14, 8), snow); s.position.y = y + h * 0.27; g.add(s); }
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function iceCrystal(rng) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.8, emissive: 0x2a5a7a, emissiveIntensity: 0.4, flatShading: true });
  for (let i = 0; i < 3 + Math.floor(rng() * 3); i++) {
    const h = 0.3 + rng() * 0.6, c = new THREE.Mesh(new THREE.ConeGeometry(0.08 + rng() * 0.06, h, 5), mat);
    c.position.set((rng() - 0.5) * 0.35, h / 2, (rng() - 0.5) * 0.35); c.rotation.set((rng() - 0.5) * 0.6, rng() * 3, (rng() - 0.5) * 0.6); g.add(c);
  }
  return g;
}
export function snowDrift(rng, len = 1.6) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), std('#f2f6fb', { roughness: 1 }));
  m.scale.set(len * (0.6 + rng() * 0.6), 0.18 + rng() * 0.15, 0.45 + rng() * 0.3); m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- neon
export function neonPylon(rng, color) {
  const g = new THREE.Group(), h = 1.6 + rng() * 1.6;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.16), std('#120a20', { metalness: 0.6, roughness: 0.3 })); post.position.y = h / 2; g.add(post);
  const tube = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.9, 0.05), new THREE.MeshBasicMaterial({ color })); tube.position.set(0, h / 2, 0.09); g.add(tube);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color })); cap.position.y = h + 0.08; g.add(cap);
  return g;
}

// ---------------------------------------------------------------- sakura (Japanese temple garden)
export function makeCherryTree(rng) {
  const g = new THREE.Group(), h = 3.2 + rng() * 1.6;
  const bark = std('#4a2e2a', { roughness: 0.9 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, h, 8), bark); trunk.position.y = h / 2; trunk.rotation.z = (rng() - 0.5) * 0.25; g.add(trunk);
  for (let i = 0; i < 3; i++) {   // branches spreading out
    const a = i / 3 * 6.28 + rng(), L = 1.4 + rng() * 0.8, br = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, L, 6), bark);
    br.position.set(Math.cos(a) * L * 0.35, h * 0.8, Math.sin(a) * L * 0.35); br.rotation.set(Math.sin(a) * 1.0, 0, -Math.cos(a) * 1.0); g.add(br);
  }
  const pinks = ['#ffc0d8', '#ffb0cc', '#ffd4e4', '#f7a1c4'];
  for (let i = 0; i < 7; i++) {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + rng() * 0.8, 0), std(pinks[i % 4], { flatShading: true, roughness: 0.8, emissive: '#5a1a30', emissiveIntensity: 0.15 }));
    blob.position.set((rng() - 0.5) * 3.0, h + (rng() - 0.3) * 1.2, (rng() - 0.5) * 3.0); blob.scale.y = 0.7; g.add(blob);
  }
  // fallen petals around the base
  const petal = std('#ffc6dc', { side: THREE.DoubleSide });
  for (let i = 0; i < 14; i++) { const p = new THREE.Mesh(new THREE.CircleGeometry(0.06, 5), petal); p.rotation.x = -Math.PI / 2; p.position.set((rng() - 0.5) * 3.4, 0.02, (rng() - 0.5) * 3.4); g.add(p); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function makeTorii(width = 4.4, height = 4.2) {
  const g = new THREE.Group(), red = std('#c8322a', { roughness: 0.6 }), black = std('#1b1716', { roughness: 0.7 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, height, 10), red); post.position.set(s * width / 2, height / 2, 0); g.add(post);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.35, 10), black); foot.position.set(s * width / 2, 0.17, 0); g.add(foot);
  }
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(width + 0.5, 0.22, 0.22), red); nuki.position.y = height * 0.74; g.add(nuki);
  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(width + 1.4, 0.3, 0.42), black); kasagi.position.y = height + 0.1; g.add(kasagi);
  const shimaki = new THREE.Mesh(new THREE.BoxGeometry(width + 1.1, 0.24, 0.36), red); shimaki.position.y = height - 0.17; g.add(shimaki);
  for (const s of [-1, 1]) { const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.42), black); tip.position.set(s * (width / 2 + 0.75), height + 0.2, 0); tip.rotation.z = s * 0.25; g.add(tip); }
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.1), black); plaque.position.y = height * 0.87; g.add(plaque);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function stoneLantern(rng) {
  const g = new THREE.Group(), stone = std('#8d8a83', { flatShading: true, roughness: 0.95 });
  const parts = [[0.28, 0.32, 0.18, 0.09], [0.1, 0.12, 0.6, 0.48], [0.3, 0.26, 0.12, 0.84]];
  for (const [r1, r2, h, y] of parts) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 6), stone); m.position.y = y; g.add(m); }
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.34), stone); box.position.y = 1.05; g.add(box);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.36), new THREE.MeshBasicMaterial({ color: '#ffcf7a' })); glow.position.y = 1.05; g.add(glow);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 6), stone); roof.position.y = 1.35; g.add(roof);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), stone); knob.position.y = 1.53; g.add(knob);
  g.rotation.y = rng() * 6.28;
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function bambooClump(rng) {
  const g = new THREE.Group(), mat = std('#7fa24a', { roughness: 0.6 }), node = std('#5d7a33');
  for (let i = 0; i < 4 + Math.floor(rng() * 4); i++) {
    const h = 2.5 + rng() * 2.5, x = (rng() - 0.5) * 0.8, z = (rng() - 0.5) * 0.8;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 6), mat); c.position.set(x, h / 2, z); c.rotation.z = (rng() - 0.5) * 0.12; g.add(c);
    for (let y = 0.5; y < h; y += 0.55) { const n = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.04, 6), node); n.position.set(x, y, z); g.add(n); }
    const lf = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 4), std('#6f9a3a', { flatShading: true })); lf.position.set(x, h + 0.2, z); lf.rotation.x = Math.PI; g.add(lf);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------- tropical (beach)
export function makePalm(rng) {
  const g = new THREE.Group(), h = 4.2 + rng() * 2, lean = (rng() - 0.5) * 0.5;
  const bark = std('#8a6a44', { roughness: 0.9, flatShading: true });
  const segs = 7; let x = 0, y = 0;
  for (let i = 0; i < segs; i++) {
    const L = h / segs, m = new THREE.Mesh(new THREE.CylinderGeometry(0.15 - i * 0.008, 0.19 - i * 0.008, L, 7), bark);
    x += Math.sin(lean * (i / segs)) * L; y += L;
    m.position.set(x, y - L / 2, 0); m.rotation.z = -lean * (i / segs); g.add(m);
  }
  const leaf = std('#3f8a3a', { side: THREE.DoubleSide, roughness: 0.8 });
  const frond = new THREE.PlaneGeometry(0.5, 2.3, 1, 6); frond.translate(0, 1.15, 0);
  const p = frond.attributes.position;
  for (let i = 0; i < p.count; i++) { const yy = p.getY(i); p.setZ(i, yy * yy * 0.18); p.setX(i, p.getX(i) * (1 - yy / 2.6)); }
  frond.computeVertexNormals();
  for (let i = 0; i < 8; i++) {
    const f = new THREE.Mesh(frond, leaf); f.position.set(x, y, 0); f.rotation.set(-1.2 - rng() * 0.3, i / 8 * 6.28 + rng() * 0.3, 0, 'YXZ'); g.add(f);
  }
  for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), std('#5a3b1e')); c.position.set(x + Math.cos(i * 2.1) * 0.18, y - 0.15, Math.sin(i * 2.1) * 0.18); g.add(c); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function tikiTorch(rng) {
  const g = new THREE.Group(), h = 1.6 + rng() * 0.4;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, h, 6), std('#6a4a2a')); pole.position.y = h / 2; g.add(pole);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.07, 0.25, 8), std('#a67c47', { flatShading: true })); cup.position.y = h + 0.1; g.add(cup);
  const fl = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 6), new THREE.MeshBasicMaterial({ color: '#ffa53a' })); fl.position.y = h + 0.35; g.add(fl);
  return g;
}
export function beachUmbrella(rng) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 6), std('#eeeeee')); pole.position.y = 1.05; pole.rotation.z = 0.12; g.add(pole);
  const cols = [['#ff5a5a', '#ffffff'], ['#3fb0ff', '#ffffff'], ['#ffd23a', '#ff7a2a']][Math.floor(rng() * 3)];
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.45, 8, 1, true, i / 8 * 6.283, 6.283 / 8), std(cols[i % 2], { side: THREE.DoubleSide }));
    s.position.set(0.12, 2.1, 0); g.add(s);
  }
  const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.5), std(cols[0])); towel.rotation.x = -Math.PI / 2; towel.position.set(0.9, 0.02, 0.2); towel.rotation.z = rng(); g.add(towel);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function seaPlane(size = 400) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#1f9fc4'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(255,255,255,${0.08 + hash(i) * 0.15})`; x.fillRect(hash(i + 3) * 128, hash(i + 7) * 128, 8 + hash(i) * 14, 1.5); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(size / 10, size / 10); t.userData = { perLevel: true };   // v1.2.6: freed with its level (render.js disposeLevel)
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: t, roughness: 0.25, metalness: 0.1, emissive: '#0a3a52', emissiveIntensity: 0.4 }));
  m.rotation.x = -Math.PI / 2; m.userData.sea = t;
  return m;
}

// ---------------------------------------------------------------- lunar (moon base)
export function crater(rng, r = 1) {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.16, 6, 18), std('#9b9ba2', { flatShading: true, roughness: 1 }));
  rim.rotation.x = -Math.PI / 2; rim.scale.z = 0.5; g.add(rim);
  const pit = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 18), std('#5c5c63', { roughness: 1 })); pit.rotation.x = -Math.PI / 2; pit.position.y = 0.012; g.add(pit);
  g.rotation.y = rng() * 6.28; g.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  return g;
}
export function moonRock(rng) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng() * 0.6, 0), std('#8e8e96', { flatShading: true, roughness: 1 }));
  m.scale.set(1, 0.55 + rng() * 0.4, 1 + rng() * 0.4); m.rotation.set(rng(), rng() * 6, rng()); m.castShadow = true;
  return m;
}
export function satDish(rng) {
  const g = new THREE.Group(), metal = std('#d7dbe3', { metalness: 0.5, roughness: 0.35 });
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.6, 8), metal); leg.position.y = 0.8; g.add(leg);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), std('#eef1f6', { side: THREE.DoubleSide, metalness: 0.3, roughness: 0.4 }));
  dish.position.y = 1.9; dish.rotation.x = -0.9 + rng() * 0.3; g.add(dish);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4), metal); feed.position.set(0, 2.2, 0.25); feed.rotation.x = 0.6; g.add(feed);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: '#ff3a3a' })); lamp.position.y = 1.62; g.add(lamp);
  g.rotation.y = rng() * 6.28; g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function moduleHab(rng) {
  const g = new THREE.Group(), hull = std('#e6e8ee', { metalness: 0.3, roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.2, 14), hull); body.rotation.z = Math.PI / 2; body.position.y = 1.2; g.add(body);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.22, 0.25, 14), std('#ff7a2a')); stripe.rotation.z = Math.PI / 2; stripe.position.y = 1.2; g.add(stripe);
  for (const s of [-1, 1]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hull); cap.rotation.z = s * -Math.PI / 2; cap.position.set(s * 1.6, 1.2, 0); g.add(cap); }
  for (let i = 0; i < 3; i++) { const w = new THREE.Mesh(new THREE.CircleGeometry(0.2, 10), new THREE.MeshBasicMaterial({ color: '#8fd8ff' })); w.position.set(-0.8 + i * 0.8, 1.5, 1.21); g.add(w); }
  g.rotation.y = rng() * 6.28; g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
// A big sky backdrop: stars all around plus a planet (the Earth) low over the arena.
export function starField(n = 900, R = 180) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = hash(i * 3 + 1) * 2 - 1, a = hash(i * 3 + 2) * 6.283, s = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(a) * s * R; pos[i * 3 + 1] = Math.abs(u) * R * 0.9 + 5; pos[i * 3 + 2] = Math.sin(a) * s * R;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, fog: false }));
}
export function planetDisc() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(100, 100, 20, 128, 128, 126);
  gr.addColorStop(0, '#6fc3ff'); gr.addColorStop(0.75, '#1f5fb0'); gr.addColorStop(1, '#0a2050');
  g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 124, 0, 6.29); g.fill();
  g.fillStyle = 'rgba(70,150,70,.85)';
  for (const [x, y, rx, ry] of [[90, 100, 40, 26], [150, 150, 30, 44], [170, 80, 22, 14], [80, 170, 18, 12]]) { g.beginPath(); g.ellipse(x, y, rx, ry, 0.4, 0, 6.29); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(60 + hash(i) * 140, 50 + hash(i + 4) * 150, 26, 6, hash(i + 9) * 3, 0, 6.29); g.fill(); }
  g.globalCompositeOperation = 'destination-in'; g.beginPath(); g.arc(128, 128, 124, 0, 6.29); g.fill();
  g.globalCompositeOperation = 'source-atop'; const sh = g.createLinearGradient(40, 40, 230, 230); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.6, 'rgba(0,0,0,.15)'); sh.addColorStop(1, 'rgba(0,0,0,.8)'); g.fillStyle = sh; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.userData = { perLevel: true };
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, fog: false, depthWrite: false }));
}

// ---------------------------------------------------------------- volcano
export function obsidianSpire(rng) {
  const g = new THREE.Group(), mat = std('#1c1418', { flatShading: true, roughness: 0.35, metalness: 0.3 });
  for (let i = 0; i < 2 + Math.floor(rng() * 3); i++) {
    const h = 1.5 + rng() * 3.5, c = new THREE.Mesh(new THREE.ConeGeometry(0.35 + rng() * 0.4, h, 5), mat);
    c.position.set((rng() - 0.5) * 1.2, h / 2, (rng() - 0.5) * 1.2); c.rotation.set((rng() - 0.5) * 0.3, rng() * 3, (rng() - 0.5) * 0.3); g.add(c);
    const vein = new THREE.Mesh(new THREE.ConeGeometry(0.06, h * 0.7, 4), new THREE.MeshBasicMaterial({ color: '#ff5a1a' }));
    vein.position.copy(c.position); vein.position.y = h * 0.35; vein.rotation.copy(c.rotation); vein.position.x += 0.18; g.add(vein);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
export function lavaPool(rng, r = 1.5) {
  const g = new THREE.Group();
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, '#ffe08a'); gr.addColorStop(0.45, '#ff7a1a'); gr.addColorStop(0.85, '#c8300a'); gr.addColorStop(1, 'rgba(60,10,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.userData = { perLevel: true };
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.scale.y = 0.6 + rng() * 0.4; g.add(m);
  const crust = new THREE.Mesh(new THREE.TorusGeometry(r * 0.95, r * 0.12, 5, 16), std('#2a1a16', { flatShading: true })); crust.rotation.x = -Math.PI / 2; crust.scale.y = m.scale.y; crust.position.y = 0.04; g.add(crust);
  g.rotation.y = rng() * 6.28;
  return g;
}
