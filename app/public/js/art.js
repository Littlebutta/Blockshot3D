// Player art. Replace buildDefaultModel() or set ART.playerModel in config.js
// to use your own glTF/GLB model from the art/ folder.
import * as THREE from '/vendor/three/build/three.module.js';
import { GEO } from './geocache.js';
import { buildBody, BODY_FIT, grainTexture } from './bodies.js';
import { ART, RULES } from './config.js';

let customTemplate = null;
// v1.2.6: materials that never change per unit (not in a model's tint list; shadeByHealth and the gold boss clone
// before changing anything) are shared by every model, so a spawn creates fewer materials and three can skip the
// material refresh between units. Never mutate one of these per unit.
const _shared = new Map();
const shared = (key, make) => { let m = _shared.get(key); if (!m) { m = make(); if (_shared.size < 512) _shared.set(key, m); } return m; };

// ---------------------------------------------------------------------
// Block shields (bubble and deployed wall): flat translucent shell with a soft rim, a slow shimmer
// band, a few low-poly "facets" that twinkle, and a soft outer halo (the slight blur). Shock and
// Siphon add electric crackle / a green tint. One time uniform drives every shield.
// ---------------------------------------------------------------------
export const SHIELD_TIME = { value: 0 };
const SHIELD_VERT = `
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = position;
    vN = normalize(normalMatrix * normal);
    vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const SHIELD_FRAG = `
  uniform vec3 color; uniform float time; uniform float opacity; uniform float shock; uniform float halo; uniform float cell;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  void main() {
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    if (halo > 0.5) { // soft outer glow: only the rim, fading out (reads as a slight blur)
      float a = fres * fres * opacity * (0.8 + 0.2 * sin(time * 5.0));
      gl_FragColor = vec4(mix(color, vec3(1.0), 0.3), a); return;
    }
    vec3 q = vP * cell;
    float band = 0.5 + 0.5 * sin(vP.y * 9.0 - time * 2.6 + sin(vP.x * 4.0 + time * 1.3) * 1.4);
    vec3 c = floor(q);
    float h = hash(c);
    float tw = pow(0.5 + 0.5 * sin(time * (2.0 + h * 3.0) + h * 6.283), 8.0);
    float a = opacity * (0.55 + fres * 1.3 + band * 0.18) + tw * 0.14;
    vec3 col = mix(color, vec3(1.0), clamp(fres * 0.55 + tw * 0.5, 0.0, 1.0));
    if (shock > 0.5) {
      float arc = sin(vP.x * 11.0 + time * 23.0) * sin(vP.y * 13.0 - time * 19.0) * sin(vP.z * 9.0 + time * 29.0);
      float zap = smoothstep(0.82, 0.98, abs(arc)) * step(0.35, fract(time * 7.0 + h));
      col = mix(col, vec3(0.75, 0.97, 1.0), zap);
      a += zap * 0.55 + 0.06 * sin(time * 40.0) * fres;
    }
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
  }`;
export function makeShieldMaterial(color = 0xffffff, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: SHIELD_TIME, opacity: { value: opts.opacity ?? 0.16 },
      shock: { value: 0 }, halo: { value: opts.halo ? 1 : 0 }, cell: { value: opts.cell ?? 4.5 } },
    vertexShader: SHIELD_VERT, fragmentShader: SHIELD_FRAG, transparent: true, depthWrite: false, fog: false,
    blending: opts.halo ? THREE.AdditiveBlending : THREE.NormalBlending, side: opts.halo ? THREE.BackSide : THREE.FrontSide,
  });
}
// A bubble mesh with its halo shell as a child. Scale/visibility of the returned mesh covers both.
export function buildShieldBubble(radius, color = 0xffffff) {
  const shield = new THREE.Mesh(GEO.Sphere(radius, 24, 16), makeShieldMaterial(color));
  const halo = new THREE.Mesh(GEO.Sphere(radius * 1.09, 24, 16), makeShieldMaterial(color, { halo: true, opacity: 0.5 }));
  shield.add(halo); shield.userData.halo = halo; shield.userData.radius = radius;
  return shield;
}

export async function loadArtAssets() {
  if (!ART.playerModel) return;
  try {
    const { GLTFLoader } = await import('/vendor/three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().loadAsync(ART.playerModel);
    customTemplate = gltf.scene;
  } catch (e) {
    console.warn('[art] Could not load', ART.playerModel, '- using the default model.', e);
  }
}

// Must return: root (Group), tint (materials recolored + flashed), gunPivot (Group pitched to aim),
// shield (Mesh shown while blocking), hitMeshes (meshes the mouse can aim at).
// bodyId picks a character from bodies.js (Customize > Character); anything else is the classic model.
// Also returns animate(t, walk) for idle/walk motion and what attachCosmetics needs (headNode, fit, hatHide).
export function buildPlayerModel(color, gunSkin = 'cube', bodyId = 'classic') {
  const root = new THREE.Group();
  let tint = [], hitMeshes = [], body = null;
  if (customTemplate) {
    const m = customTemplate.clone(true);
    m.scale.setScalar(ART.playerModelScale || 1);
    m.position.y = ART.playerModelYOffset || 0;
    m.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      hitMeshes.push(o);
      if (o.material && /tint/i.test(o.material.name || '')) {
        o.material = o.material.clone(); o.material.color.set(color); tint.push(o.material);
      }
    });
    root.add(m);
  } else {
    body = (bodyId !== 'classic' && buildBody(bodyId, color)) || buildDefaultModel(color);
    root.add(body.group); tint = body.tint; hitMeshes = body.hitMeshes;
  }
  const gunPivot = new THREE.Group();
  gunPivot.position.set(0.32, RULES.chest, 0);
  const fit = body && !body.classic ? BODY_FIT[bodyId] || null : null;
  if (fit && fit.gun) {   // other characters hold the gun at their side, gripped by a small mitt (pitches with the gun)
    gunPivot.position.set(...fit.gun);
    const hand = new THREE.Mesh(GEO.Sphere(0.075, 10, 8), body.handMat || tint[0]); hand.position.set(-0.02, -0.12, 0.07); hand.castShadow = true;
    gunPivot.add(hand);
  }
  const gun = buildGunSkin(gunSkin, color);
  gun.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  gunPivot.add(gun.root);
  const shield = buildShieldBubble(1.05);
  shield.position.y = 0.8; shield.visible = false;
  root.add(gunPivot, shield);
  const model = { root, tint, gunPivot, shield, hitMeshes, gunSkin: gun.skin, spinners: [], flounce: [],
    headNode: body ? body.headNode || body.group : root, fit, hatHide: (body && body.hatHide) || [] };
  model.animate = (t, walk) => {
    if (body && body.anim) body.anim(t, walk);
    for (const sp of model.spinners) sp.rotation.y = t * sp.userData.spin;
    // v30: tutu layers bounce and twirl while you run (and sway a little standing still); bow ribbons flutter
    for (const o of model.flounce) {
      const f = o.userData.flounce, w = walk || 0;
      if (f.ribbon) { o.rotation.x = 0.15 + Math.sin(t * 9 + f.ph) * (0.08 + w * 0.5); continue; }
      o.position.y = f.y + Math.sin(t * 13 + f.ph) * 0.03 * w;
      o.rotation.y = f.ry + Math.sin(t * 1.4 + f.ph) * 0.08 + t * w * 0.6;
      o.rotation.x = Math.sin(t * 6.5 + f.ph) * 0.06 * w; o.rotation.z = Math.cos(t * 5.5 + f.ph) * 0.05 * w;
    }
  };
  return model;
}

// Puts a cosmetics set on a player model, moved and scaled to fit its body (BODY_FIT in bodies.js).
export function attachCosmetics(model, cos) {
  const c = buildCosmetics(cos);
  if (model.fit) fitCosmetics(c, model.fit);
  (model.headNode || model.root).add(c);
  c.traverse(o => { if (o.userData.spin && model.spinners) model.spinners.push(o); if (o.userData.flounce && model.flounce) model.flounce.push(o); });
  const hat = !!(cos && cos.hat && cos.hat !== 'none');
  for (const m of model.hatHide || []) m.visible = !hat;
  return c;
}
// Each slot group is built for the classic model; move its anchor point to the body's matching spot and scale
// around it: p' = target + scale * (p - anchor).
const COS_ANCHORS = { hat: [0, 1.52, 0], head: [0, 1.15, 0.42], neck: [0, 0.95, 0.42], hip: [0, 0.3, 0] };
function fitCosmetics(c, fit) {
  for (const [slot, a] of Object.entries(COS_ANCHORS)) {
    const f = fit[slot], g = c.userData.slots[slot];
    if (!f || !g) continue;
    const [y, k, z] = slot === 'hat' ? [f[0], f[1], f[2] || 0] : slot === 'hip' ? [f[0], f[1], 0] : [f[0], f[2], f[1]];
    const sc = Array.isArray(k) ? k : [k, k, k];
    g.scale.set(sc[0], sc[1], sc[2]);
    g.position.set(-sc[0] * a[0], y - sc[1] * a[1], z - sc[2] * a[2]);
  }
}

function buildDefaultModel(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: grainTexture(), color, roughness: 0.35, metalness: 0.15 });
  const dark = shared('defDark', () => new THREE.MeshStandardMaterial({ map: grainTexture(), color: 0x1b2030, roughness: 0.4 }));
  const body = new THREE.Mesh(GEO.Cylinder(0.42, 0.45, 0.9, 22), mat); body.position.y = 0.65;
  const dome = new THREE.Mesh(GEO.Sphere(0.42, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.position.y = 1.1;
  const base = new THREE.Mesh(GEO.Cylinder(0.45, 0.3, 0.2, 22), dark); base.position.y = 0.1;
  const visor = new THREE.Mesh(GEO.Box(0.55, 0.16, 0.12), shared('defVisor', () => new THREE.MeshBasicMaterial({ color: 0xffffff })));
  visor.position.set(0, 1.15, 0.38); visor.userData.visor = true;
  for (const m of [body, dome, base]) m.castShadow = true;
  group.add(body, dome, base, visor);
  // Small details (same silhouette, kept clear of the cosmetic spots: hats above 1.45, face/eyes at z ~0.42-0.49
  // between y 0.95-1.25, neck items at y 0.76-0.95 on the front): a visor frame, a belt with a buckle, a darker
  // trim ring where the dome meets the body, little feet, a back pack with a status light, and a hip emblem.
  const trim = shared('defTrim' + color, () => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.62), roughness: 0.45, metalness: 0.2 }));
  const steel = shared('defSteel', () => new THREE.MeshStandardMaterial({ color: 0x9aa3b5, roughness: 0.35, metalness: 0.6 }));
  const frame = new THREE.Mesh(GEO.Box(0.63, 0.23, 0.08), dark); frame.position.set(0, 1.15, 0.355);
  const belt = new THREE.Mesh(GEO.Cylinder(0.452, 0.455, 0.08, 22), dark); belt.position.y = 0.42;
  const buckle = new THREE.Mesh(GEO.Box(0.13, 0.09, 0.03), steel); buckle.position.set(0, 0.42, 0.45);
  const ring = new THREE.Mesh(GEO.Cylinder(0.428, 0.428, 0.05, 22), trim); ring.position.y = 1.1;
  const pack = new THREE.Mesh(GEO.Box(0.42, 0.42, 0.14), trim); pack.position.set(0, 0.74, -0.47);
  const light = new THREE.Mesh(GEO.Sphere(0.035, 8, 6), shared('defLight', () => new THREE.MeshBasicMaterial({ color: 0x7dffb0 }))); light.position.set(0.12, 0.88, -0.545);
  const emblem = new THREE.Mesh(GEO.Cylinder(0.055, 0.055, 0.02, 12), steel); emblem.position.set(-0.24, 0.6, 0.39); emblem.rotation.set(Math.PI / 2, 0, 0); emblem.rotation.y = -0.55;
  group.add(frame, belt, buckle, ring, pack, light, emblem);
  const feet = [];
  for (const s of [-1, 1]) {
    const foot = new THREE.Mesh(GEO.Box(0.2, 0.1, 0.22), dark); foot.position.set(s * 0.18, 0.05, 0.26); foot.castShadow = true; feet.push(foot);
    const vent = new THREE.Mesh(GEO.Box(0.02, 0.22, 0.12), dark); vent.position.set(s * 0.44, 0.74, -0.05);
    group.add(foot, vent);
  }
  pack.castShadow = true;
  return { group, tint: [mat], hitMeshes: [body, dome], classic: true, anim(t, w) {   // little feet shuffle while walking
    feet.forEach((f, i) => { const s = Math.sin(t * 10 + i * Math.PI); f.position.z = 0.26 + s * 0.1 * w; f.position.y = 0.05 + Math.max(0, s) * 0.05 * w; });
  } };
}

// ---------------------------------------------------------------------
// Cosmetics: fixed colors (never team-tinted), low detail to match the art.
// Positions are for the default model (head dome top ~1.52, face at z ~0.42).
// To add one: add a case below and a label in COSMETICS (config.js).
// ---------------------------------------------------------------------
const M = c => shared('M' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.05 }));
const MET = c => shared('MET' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, metalness: 0.7 }));
function mesh(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; return m;
}
// Items go in one group per fit slot (hat / head = face + eyes / neck / hip = body) so attachCosmetics can
// move each slot onto other bodies.
export function buildCosmetics(cos, hatOnly = false) {
  const root = new THREE.Group(), slots = { hat: new THREE.Group(), head: new THREE.Group(), neck: new THREE.Group(), hip: new THREE.Group() };
  root.add(...Object.values(slots)); root.userData.slots = slots;
  if (!cos) return root;
  if (hatOnly) cos = { hat: cos.hat };
  const black = M(0x17181c), brown = M(0x6b4423), dark = M(0x2a2b30), gold = MET(0xe2b33c), red = M(0xb3262e), white = M(0xf4f1ea);
  let g = slots.hat;
  switch (cos.hat) {
    case 'tophat':
      g.add(mesh(GEO.Cylinder(0.38, 0.38, 0.03, 24), black, 0, 1.5, 0));
      g.add(mesh(GEO.Cylinder(0.23, 0.24, 0.42, 24), black, 0, 1.72, 0));
      g.add(mesh(GEO.Cylinder(0.245, 0.245, 0.06, 24), red, 0, 1.56, 0));
      break;
    case 'cowboy':
      g.add(mesh(GEO.Cylinder(0.52, 0.52, 0.03, 24), brown, 0, 1.5, 0));
      g.add(mesh(GEO.Cylinder(0.19, 0.24, 0.24, 20), brown, 0, 1.63, 0));
      g.add(mesh(GEO.Cylinder(0.245, 0.245, 0.04, 20), dark, 0, 1.53, 0));
      break;
    case 'bowler':
      g.add(mesh(GEO.Cylinder(0.33, 0.33, 0.025, 24), black, 0, 1.49, 0));
      g.add(mesh(GEO.Sphere(0.25, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), black, 0, 1.5, 0));
      break;
    case 'beanie': {
      const knit = M(0x3c5a7a);
      const cap = mesh(GEO.Sphere(0.44, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), knit, 0, 1.18, 0); cap.scale.y = 0.85; g.add(cap);
      g.add(mesh(GEO.Cylinder(0.445, 0.445, 0.1, 20), M(0x2f4862), 0, 1.2, 0));
      g.add(mesh(GEO.Sphere(0.09, 10, 8), M(0xe9e4da), 0, 1.58, 0));
      break;
    }
    case 'crown':
      g.add(mesh(GEO.Cylinder(0.25, 0.25, 0.16, 20, 1, true), gold, 0, 1.56, 0));
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; g.add(mesh(GEO.Cone(0.05, 0.13, 6), gold, Math.cos(a) * 0.23, 1.7, Math.sin(a) * 0.23)); }
      break;
    case 'party':
      g.add(mesh(GEO.Cone(0.17, 0.42, 16), M(0xe8508f), 0, 1.7, 0));
      g.add(mesh(GEO.Sphere(0.05, 8, 6), M(0xf5f0e0), 0, 1.93, 0));
      break;
    case 'halo':
      g.add(mesh(GEO.Torus(0.28, 0.035, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffe28a }), 0, 1.86, 0, Math.PI / 2));
      break;
    case 'fez':
      g.add(mesh(GEO.Cylinder(0.16, 0.2, 0.26, 18), red, 0, 1.6, 0));
      g.add(mesh(GEO.Cylinder(0.012, 0.012, 0.18, 4), black, 0.1, 1.68, 0, 0, 0, -0.5));
      break;
    case 'headphones':
      g.add(mesh(GEO.Torus(0.42, 0.035, 8, 24, Math.PI), dark, 0, 1.2, 0));
      for (const s of [-1, 1]) g.add(mesh(GEO.Cylinder(0.12, 0.12, 0.08, 14), dark, s * 0.44, 1.2, 0, 0, 0, Math.PI / 2));
      break;
    case 'propeller': {   // beanie with a spinning propeller (spun in model.animate)
      const cap = mesh(GEO.Sphere(0.44, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M(0x2f6fd6), 0, 1.18, 0); cap.scale.y = 0.85; g.add(cap);
      g.add(mesh(GEO.Cylinder(0.445, 0.445, 0.07, 20), M(0xf2c230), 0, 1.2, 0));
      g.add(mesh(GEO.Cylinder(0.018, 0.018, 0.12, 6), dark, 0, 1.6, 0));
      const prop = new THREE.Group(); prop.position.y = 1.66; prop.userData.spin = 14; g.add(prop);
      prop.add(mesh(GEO.Box(0.46, 0.02, 0.08), M(0xe0403a), 0, 0, 0, 0.25), mesh(GEO.Box(0.08, 0.02, 0.46), M(0x3ac06a), 0, 0, 0, 0, 0, 0.25));
      break;
    }
    case 'viking': {
      const iron = MET(0x8a8f99), dome = mesh(GEO.Sphere(0.45, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), iron, 0, 1.12, 0); dome.scale.y = 0.95; g.add(dome);
      g.add(mesh(GEO.Cylinder(0.455, 0.455, 0.08, 20), brown, 0, 1.14, 0));
      g.add(mesh(GEO.Box(0.05, 0.05, 0.92), iron, 0, 1.47, 0));
      for (const s of [-1, 1]) g.add(mesh(GEO.Cone(0.07, 0.34, 10), M(0xefe6cf), s * 0.46, 1.42, 0, 0, 0, -s * 0.65));
      break;
    }
    case 'chef':
      g.add(mesh(GEO.Cylinder(0.28, 0.28, 0.22, 20), white, 0, 1.58, 0));
      for (const [x, z] of [[0, 0], [0.13, 0.08], [-0.13, 0.08], [0, -0.14]]) g.add(mesh(GEO.Sphere(0.2, 14, 10), white, x, 1.78, z));
      break;
    case 'wizard': {
      const cloth = M(0x4b2c8f);
      g.add(mesh(GEO.Cylinder(0.52, 0.52, 0.03, 24), cloth, 0, 1.5, 0));
      g.add(mesh(GEO.Cone(0.27, 0.72, 18), cloth, 0.03, 1.86, -0.03, -0.12, 0, -0.1));
      g.add(mesh(GEO.Cylinder(0.275, 0.275, 0.06, 18), gold, 0, 1.55, 0));
      g.add(mesh(GEO.Octahedron(0.06, 0), new THREE.MeshBasicMaterial({ color: 0xffe28a }), 0.13, 1.75, 0.17));
      break;
    }
    case 'bunny':
      g.add(mesh(GEO.Torus(0.43, 0.025, 6, 24, Math.PI), M(0xe8508f), 0, 1.12, 0));
      for (const s of [-1, 1]) {
        const ear = mesh(GEO.Sphere(0.11, 12, 10), white, s * 0.15, 1.78, 0, 0, 0, -s * 0.15); ear.scale.set(0.75, 2.6, 0.45); g.add(ear);
        const inner = mesh(GEO.Sphere(0.07, 10, 8), M(0xf7a8c4), s * 0.15, 1.76, 0.035, 0, 0, -s * 0.15); inner.scale.set(0.7, 2.6, 0.3); g.add(inner);
      }
      break;
    case 'pirate': {
      g.add(mesh(GEO.Cylinder(0.27, 0.3, 0.22, 20), black, 0, 1.6, 0));
      for (let i = 0; i < 3; i++) {   // three upturned brim flaps make the tricorn
        const f = new THREE.Group(); f.rotation.y = i / 3 * Math.PI * 2; f.position.y = 1.52; g.add(f);
        f.add(mesh(GEO.Box(0.56, 0.2, 0.03), black, 0, 0.06, 0.32, -0.45));
      }
      g.add(mesh(GEO.Sphere(0.045, 8, 6), white, 0, 1.62, 0.3));
      break;
    }
    // v30 homages (original designs, no logos): a sci-fi trooper helmet, a grim crusader helm and psionic nerve cords.
    case 'trooper': {   // rounded olive armor shell over the whole head with a wide gold mirror visor
      const shell = M(0x55663a), plate = MET(0x6b7a4a), seam = M(0x2c3220);
      const visor = new THREE.MeshStandardMaterial({ color: 0xffc24a, roughness: 0.15, metalness: 0.45, emissive: 0xc07a10, emissiveIntensity: 0.75 });
      const s = mesh(GEO.Sphere(0.47, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), shell, 0, 1.08, 0); s.scale.set(1.12, 1.05, 1.12); g.add(s);
      const v = mesh(GEO.Sphere(0.48, 26, 10, Math.PI / 2 - 0.85, 1.7, 1.2, 0.42), visor, 0, 1.08, 0); v.scale.set(1.13, 1.06, 1.14); g.add(v);
      g.add(mesh(GEO.Box(0.1, 0.05, 0.62), plate, 0, 1.58, -0.06));   // crest ridge front to back
      for (const x of [-1, 1]) {
        g.add(mesh(GEO.Cylinder(0.12, 0.13, 0.08, 16), plate, x * 0.52, 1.1, -0.02, 0, 0, Math.PI / 2));   // ear plates
        g.add(mesh(GEO.Box(0.05, 0.12, 0.2), seam, x * 0.5, 0.97, 0.22, 0, x * 0.35, 0));   // cheek guards
      }
      g.add(mesh(GEO.Cylinder(0.012, 0.012, 0.32, 5), seam, -0.42, 1.38, -0.22, -0.2, 0, 0.25));   // antenna
      break;
    }
    case 'crusader': {   // a heavy gothic war helm: iron dome, red eye lenses, a grille mouth and a tall red plume
      const iron = new THREE.MeshStandardMaterial({ color: 0x6f7888, roughness: 0.4, metalness: 0.35 }), dk = M(0x23262c), brass = MET(0xb88a3a);
      const s = mesh(GEO.Sphere(0.47, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.66), iron, 0, 1.08, 0); s.scale.set(1.14, 1.06, 1.12); g.add(s);
      const lens = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
      for (const x of [-1, 1]) {
        g.add(mesh(GEO.Cylinder(0.085, 0.085, 0.06, 16), lens, x * 0.16, 1.2, 0.5, Math.PI / 2));
        g.add(mesh(GEO.Torus(0.09, 0.02, 6, 16), brass, x * 0.16, 1.2, 0.52));
      }
      const grille = mesh(GEO.Cylinder(0.15, 0.11, 0.2, 10), dk, 0, 0.98, 0.47, Math.PI / 2 + 0.2); grille.scale.set(1, 1, 0.8); g.add(grille);
      for (let i = 0; i < 4; i++) g.add(mesh(GEO.Box(0.2 - i * 0.02, 0.012, 0.02), brass, 0, 1.04 - i * 0.04, 0.58 - i * 0.008));
      g.add(mesh(GEO.Box(0.06, 0.12, 0.66), brass, 0, 1.6, -0.05));   // crest mount
      const plume = M(0xa81c22);
      for (let i = 0; i < 9; i++) { const t = i / 8, m = mesh(GEO.Box(0.07, 0.24 - Math.abs(t - 0.35) * 0.12, 0.08), plume, 0, 1.76 - t * 0.08, 0.26 - t * 0.66, -0.3 + t * 0.6); g.add(m); }
      break;
    }
    case 'psicords': {   // a gold circlet with a glowing blue gem, and long nerve cords falling down the back
      const goldc = MET(0xd8b04a), cord = M(0xb08856), tipm = M(0x6a4a2a);
      g.add(mesh(GEO.Torus(0.37, 0.028, 8, 32), goldc, 0, 1.32, 0, Math.PI / 2));
      g.add(mesh(GEO.Box(0.16, 0.11, 0.04), goldc, 0, 1.36, 0.35, -0.3));
      g.add(mesh(GEO.Octahedron(0.055, 0), new THREE.MeshStandardMaterial({ color: 0x48c8ff, emissive: 0x1a9cff, emissiveIntensity: 1.1, roughness: 0.15 }), 0, 1.37, 0.39));
      for (let i = 0; i < 7; i++) {
        const x = (i - 3) * 0.075, sw = (i - 3) * 0.03;
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 1.36, -0.3), new THREE.Vector3(x * 1.2 + sw, 1.12, -0.5), new THREE.Vector3(x * 1.35 + sw * 2, 0.82, -0.56), new THREE.Vector3(x * 1.5 + sw * 3, 0.52, -0.5)]);
        g.add(mesh(new THREE.TubeGeometry(curve, 18, 0.03 - Math.abs(i - 3) * 0.002, 6), cord, 0, 0, 0));
        g.add(mesh(GEO.Sphere(0.03, 6, 5), tipm, x * 1.5 + sw * 3, 0.51, -0.5));
      }
      break;
    }
  }
  g = slots.head;
  switch (cos.face) {
    case 'mustache':
      for (const s of [-1, 1]) { const m = mesh(GEO.Sphere(0.09, 10, 6), brown, s * 0.08, 1.03, 0.42); m.scale.set(1.3, 0.45, 0.6); g.add(m); }
      break;
    case 'handlebar':
      for (const s of [-1, 1]) {
        const m = mesh(GEO.Sphere(0.12, 12, 8), black, s * 0.12, 1.02, 0.43); m.scale.set(1.7, 0.5, 0.7); g.add(m);
        // curled tips sweeping up and out
        g.add(mesh(GEO.Torus(0.06, 0.025, 6, 12, Math.PI * 1.4), black, s * 0.31, 1.1, 0.42, 0, 0, s > 0 ? -0.4 : Math.PI + 0.4));
      }
      break;
    case 'beard': {
      const b = mesh(GEO.Sphere(0.38, 18, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), brown, 0, 1.05, 0.2); b.scale.set(1.15, 1.3, 0.95); g.add(b);
      for (const s of [-1, 1]) { const side = mesh(GEO.Sphere(0.14, 10, 8), brown, s * 0.36, 1.0, 0.2); side.scale.set(0.8, 1.4, 1); g.add(side); }
      break;
    }
    case 'clown':
      g.add(mesh(GEO.Sphere(0.085, 14, 10), new THREE.MeshStandardMaterial({ color: 0xe8202a, roughness: 0.2 }), 0, 1.03, 0.47));
      break;
    case 'goatee':
      g.add(mesh(GEO.Cone(0.075, 0.18, 10), brown, 0, 0.9, 0.42, 0, 0, Math.PI));
      for (const s of [-1, 1]) { const m = mesh(GEO.Sphere(0.06, 8, 6), brown, s * 0.06, 1.02, 0.43); m.scale.set(1.4, 0.4, 0.6); g.add(m); }
      break;
  }
  switch (cos.eyes) {
    case 'monocle':
      g.add(mesh(GEO.Torus(0.075, 0.012, 6, 18), gold, 0.13, 1.15, 0.46));
      g.add(mesh(GEO.Cylinder(0.005, 0.005, 0.3, 4), gold, 0.18, 1.0, 0.45, 0, 0, 0.3));
      break;
    case 'shades': { // one dark lens covering the whole eye visor, with arms back to the head
      g.add(mesh(GEO.Box(0.64, 0.22, 0.04), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.15, metalness: 0.6 }), 0, 1.15, 0.465));
      for (const s of [-1, 1]) g.add(mesh(GEO.Box(0.03, 0.03, 0.42), black, s * 0.33, 1.2, 0.26));
      break;
    }
    case 'goggles': { // two big lenses that cover the visor completely
      g.add(mesh(GEO.Torus(0.44, 0.03, 6, 24), dark, 0, 1.15, 0, Math.PI / 2));
      const glass = new THREE.MeshStandardMaterial({ color: 0x3a5a6a, roughness: 0.1, metalness: 0.5 });
      for (const s of [-1, 1]) {
        g.add(mesh(GEO.Cylinder(0.155, 0.155, 0.06, 20), glass, s * 0.15, 1.15, 0.46, Math.PI / 2));
        g.add(mesh(GEO.Torus(0.155, 0.03, 8, 20), MET(0x9a6a3a), s * 0.15, 1.15, 0.49));
      }
      g.add(mesh(GEO.Box(0.06, 0.06, 0.06), MET(0x9a6a3a), 0, 1.15, 0.49));
      break;
    }
    case 'hearts': {   // heart-shaped pink lenses
      const sh = new THREE.Shape();
      sh.moveTo(0, -0.1); sh.bezierCurveTo(-0.16, 0.0, -0.13, 0.13, 0, 0.06); sh.bezierCurveTo(0.13, 0.13, 0.16, 0.0, 0, -0.1);
      const lens = new THREE.MeshStandardMaterial({ color: 0xff5fa8, roughness: 0.2, metalness: 0.2, side: THREE.DoubleSide });
      for (const s of [-1, 1]) g.add(mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false }), lens, s * 0.15, 1.15, 0.45));
      g.add(mesh(GEO.Box(0.1, 0.025, 0.025), lens, 0, 1.18, 0.47));
      for (const s of [-1, 1]) g.add(mesh(GEO.Box(0.03, 0.03, 0.42), black, s * 0.29, 1.18, 0.26));
      break;
    }
    case 'eyepatch':
      g.add(mesh(GEO.Cylinder(0.1, 0.1, 0.03, 16), black, 0.15, 1.15, 0.46, Math.PI / 2));
      g.add(mesh(GEO.Torus(0.44, 0.014, 4, 28), black, 0, 1.17, 0, Math.PI / 2, 0.3, 0));
      break;
    case 'glasses3d':
      g.add(mesh(GEO.Box(0.62, 0.2, 0.03), white, 0, 1.15, 0.465));
      g.add(mesh(GEO.Box(0.22, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0xff3040 }), -0.15, 1.15, 0.48));
      g.add(mesh(GEO.Box(0.22, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0x30d8ff }), 0.15, 1.15, 0.48));
      for (const s of [-1, 1]) g.add(mesh(GEO.Box(0.03, 0.03, 0.42), white, s * 0.32, 1.18, 0.26));
      break;
    case 'cateyes': {   // v30: glowing yellow monster-hunter eyes with slit pupils
      const iris = new THREE.MeshBasicMaterial({ color: 0xffc928 }), slit = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
      for (const s of [-1, 1]) {
        const e = mesh(GEO.Circle(0.075, 20), iris, s * 0.14, 1.15, 0.447); e.scale.set(1.25, 0.9, 1); e.rotation.z = -s * 0.15; g.add(e);
        const p = mesh(GEO.Circle(0.06, 12), slit, s * 0.14, 1.15, 0.449); p.scale.set(0.16, 1, 1); g.add(p);
      }
      break;
    }
    case 'nightops': {   // v30: a covert-ops headset with three glowing green lenses
      const frame = M(0x22262d), glow = new THREE.MeshBasicMaterial({ color: 0x7dff6a });
      g.add(mesh(GEO.Torus(0.44, 0.03, 6, 28), frame, 0, 1.16, 0, Math.PI / 2));
      g.add(mesh(GEO.Box(0.5, 0.18, 0.08), frame, 0, 1.15, 0.47));
      g.add(mesh(GEO.Cylinder(0.075, 0.09, 0.16, 16), frame, 0, 1.15, 0.56, Math.PI / 2));
      g.add(mesh(GEO.Circle(0.06, 16), glow, 0, 1.15, 0.641));
      for (const s of [-1, 1]) {
        g.add(mesh(GEO.Cylinder(0.05, 0.06, 0.1, 14), frame, s * 0.17, 1.13, 0.53, Math.PI / 2));
        g.add(mesh(GEO.Circle(0.04, 14), glow, s * 0.17, 1.13, 0.581));
      }
      break;
    }
  }
  g = slots.hip;
  if (cos.body === 'censor') {   // joke: a pixel-mosaic "censored" patch over the crotch, front and back
    const tex = censorTexture(), mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    for (const s of [1, -1]) { const p = new THREE.Mesh(GEO.Plane(0.46, 0.34), mat); p.position.set(0, 0.3, s * 0.47); if (s < 0) p.rotation.y = Math.PI; p.renderOrder = 3; g.add(p); }
  } else if (cos.body === 'tutu') {
    // v30 rework: a fuller pancake tutu. Five stacked layers of ruffled tulle flare out flat (deep pink underneath,
    // pale on top), each hem waves up and down, a satin bodice band carries a big bow at the back with trailing
    // ribbons, and sequins sparkle on the top layer. The layers bounce and twirl as you run (flounce, see buildModel).
    const layers = [[0xe8307f, 0.86, 0.34, 0.92], [0xf2479a, 0.8, 0.37, 0.9], [0xfa62ac, 0.74, 0.4, 0.88], [0xff80bf, 0.67, 0.43, 0.86], [0xffa3d2, 0.6, 0.46, 0.88]];
    layers.forEach(([col, R, y, op], li) => {
      const tulle = new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: op, depthWrite: false, emissive: col, emissiveIntensity: 0.08 });
      const N = 22, geo = new THREE.CylinderGeometry(0.44, R, 0.06, N * 6, 2, true), pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y0 = pos.getY(i); if (y0 > 0.02) continue;
        const a = Math.atan2(pos.getZ(i), pos.getX(i)), edge = y0 < -0.02 ? 1 : 0.45;
        const k = 1 + (Math.cos(a * N + li * 1.7) * 0.05 + Math.sin(a * 7 + li) * 0.025) * edge;   // scalloped and gently wavy hem
        pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); pos.setY(i, y0 + (Math.sin(a * N * 0.5 + li) * 0.04 + Math.cos(a * 3 + li * 2) * 0.02) * edge);
      }
      geo.computeVertexNormals();
      const m = mesh(geo, tulle, 0, y, 0, 0, li * 0.37, 0); m.renderOrder = 2 + li;
      m.userData.flounce = { y, ry: li * 0.37, ph: li * 0.9 };
      g.add(m);
    });
    const satin = new THREE.MeshStandardMaterial({ color: 0xff5ca6, roughness: 0.3, metalness: 0.2 });
    g.add(mesh(GEO.Cylinder(0.465, 0.465, 0.1, 32, 1, true), satin, 0, 0.5, 0));
    const bow = new THREE.Group(); bow.position.set(0, 0.52, -0.48); g.add(bow);
    for (const s of [1, -1]) {
      const loop = mesh(GEO.Torus(0.075, 0.03, 8, 16), satin, s * 0.09, 0.02, 0, 0, 0, s * 0.35); loop.scale.set(1.3, 0.8, 0.6); bow.add(loop);
      const tail = mesh(GEO.Box(0.06, 0.32, 0.015), satin, s * 0.06, -0.17, -0.02, 0.15, 0, s * 0.18); tail.userData.flounce = { y: -0.17, ry: 0, ph: s * 2, ribbon: s }; bow.add(tail);
    }
    bow.add(mesh(GEO.Sphere(0.045, 10, 8), satin, 0, 0.02, -0.01));
    const sequin = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe0f0, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.15 });
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2 + 0.2, r = 0.5 + (i % 3) * 0.035; g.add(mesh(GEO.Octahedron(0.018, 0), sequin, Math.cos(a) * r, 0.475 + (i % 2) * 0.01, Math.sin(a) * r)); }
  } else if (cos.body === 'harness') {
    // v30: a monster hunter's harness: a leather strap across the chest and two swords crossed on the back
    // (one steel, one silver, with leather-wrapped grips and pommels sticking out over the shoulders).
    const leather = M(0x4a2f1c), buckle = MET(0xb8b2a2);
    const strap = mesh(GEO.Torus(0.5, 0.04, 6, 32), leather, 0, 0.72, 0, Math.PI / 2 - 0.05, 0.55, 0); strap.scale.set(1, 1, 0.6); g.add(strap);
    g.add(mesh(GEO.Cylinder(0.47, 0.47, 0.08, 24, 1, true), leather, 0, 0.36, 0));
    g.add(mesh(GEO.Box(0.1, 0.08, 0.03), buckle, 0, 0.36, 0.475));
    g.add(mesh(GEO.Box(0.09, 0.09, 0.03), buckle, 0.14, 0.72, 0.45, 0, 0, 0.5));
    for (const [s, col] of [[1, 0xd7dbe2], [-1, 0xb9c4d6]]) {
      const sw = new THREE.Group(); sw.position.set(0, 1.02, -0.52); sw.rotation.z = s * 0.55; g.add(sw);
      const blade = MET(col);
      sw.add(mesh(GEO.Box(0.07, 0.95, 0.015), blade, 0, -0.18, 0));
      sw.add(mesh(GEO.Cone(0.035, 0.1, 4), blade, 0, -0.7, 0, Math.PI, Math.PI / 4, 0));
      sw.add(mesh(GEO.Box(0.24, 0.035, 0.05), buckle, 0, 0.3, 0));
      sw.add(mesh(GEO.Cylinder(0.025, 0.025, 0.2, 8), leather, 0, 0.42, 0));
      sw.add(mesh(GEO.Sphere(0.04, 8, 6), buckle, 0, 0.54, 0));
      sw.add(mesh(GEO.Box(0.1, 0.85, 0.04), leather, 0, -0.22, -0.035));   // scabbard behind the blade
    }
  } else if (cos.body === 'carapace') {
    // v30: alien brood chitin: overlapping armored plates around the waist, a row of curved spines up the back
    // and glowing bile sacs.
    const chitin = new THREE.MeshStandardMaterial({ color: 0x5a2f4a, roughness: 0.35, metalness: 0.25 }), bone = M(0xd9c7a2);
    const sac = new THREE.MeshStandardMaterial({ color: 0xc7ff4a, emissive: 0x7aff20, emissiveIntensity: 0.7, roughness: 0.3 });
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2, p = mesh(GEO.Sphere(0.2, 12, 8), chitin, Math.sin(a) * 0.42, 0.34 + (i % 2) * 0.05, Math.cos(a) * 0.42, 0, a, 0);
      p.scale.set(1.15, 0.7, 0.35); g.add(p);
    }
    for (let i = 0; i < 5; i++) {
      const sp = mesh(GEO.Cone(0.06 - i * 0.006, 0.36 - i * 0.03, 8), bone, 0, 0.45 + i * 0.17, -0.5 - i * 0.015, -0.9 + i * 0.08, 0, 0); g.add(sp);
    }
    for (const s of [-1, 1]) {
      g.add(mesh(GEO.Cone(0.05, 0.3, 8), bone, s * 0.44, 0.75, -0.25, -0.4, 0, -s * 0.8));
      g.add(mesh(GEO.Sphere(0.06, 10, 8), sac, s * 0.36, 0.44, 0.3));
    }
  } else if (cos.body === 'floatie') {   // rubber-duck swim ring
    const yellow = M(0xffd23a);
    g.add(mesh(GEO.Torus(0.5, 0.1, 10, 28), yellow, 0, 0.45, 0, Math.PI / 2));
    g.add(mesh(GEO.Sphere(0.11, 12, 10), yellow, 0, 0.6, 0.55));
    const beak = mesh(GEO.Sphere(0.05, 8, 6), M(0xff8a1f), 0, 0.58, 0.66); beak.scale.set(1.2, 0.5, 1); g.add(beak);
  } else if (cos.body === 'champ') {   // championship belt
    g.add(mesh(GEO.Cylinder(0.47, 0.47, 0.12, 22), black, 0, 0.42, 0));
    g.add(mesh(GEO.Box(0.3, 0.2, 0.04), gold, 0, 0.42, 0.47));
    g.add(mesh(GEO.Cylinder(0.06, 0.06, 0.02, 14), red, 0, 0.42, 0.495, Math.PI / 2));
  }
  g = slots.neck;
  switch (cos.neck) {
    case 'bowtie':
      for (const s of [-1, 1]) g.add(mesh(GEO.Cone(0.06, 0.12, 4), black, s * 0.06, 0.95, 0.44, 0, 0, s * Math.PI / 2));
      break;
    case 'scarf':
      g.add(mesh(GEO.Torus(0.44, 0.065, 8, 24), red, 0, 0.95, 0, Math.PI / 2)); // sits below the visor
      g.add(mesh(GEO.Box(0.11, 0.32, 0.05), red, 0.2, 0.76, 0.43, 0, 0, 0.15));
      break;
    case 'medal':
      g.add(mesh(GEO.Box(0.06, 0.16, 0.02), M(0x2f5fb3), 0, 0.92, 0.45));
      g.add(mesh(GEO.Cylinder(0.06, 0.06, 0.02, 14), gold, 0, 0.82, 0.46, Math.PI / 2));
      break;
    case 'chain':   // gold chain dipping at the front, with a big medallion
      g.add(mesh(GEO.Torus(0.45, 0.022, 6, 32), gold, 0, 0.93, 0.02, Math.PI / 2 + 0.3));
      g.add(mesh(GEO.Cylinder(0.08, 0.08, 0.025, 16), gold, 0, 0.72, 0.47, Math.PI / 2));
      break;
    case 'cape': {
      const cloth = new THREE.MeshStandardMaterial({ color: 0xb3262e, roughness: 0.7, side: THREE.DoubleSide });
      g.add(mesh(GEO.Box(0.72, 0.62, 0.025), cloth, 0, 0.64, -0.58, 0.1));
      g.add(mesh(GEO.Torus(0.44, 0.03, 6, 24), gold, 0, 0.95, 0, Math.PI / 2));
      break;
    }
    case 'lei': {   // flower necklace
      const cols = [0xff5f8a, 0xffd23a, 0xff8a3a, 0xf4f1ea];
      for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; g.add(mesh(GEO.Dodecahedron(0.065, 0), M(cols[i % 4]), Math.sin(a) * 0.45, 0.93 - Math.max(0, Math.cos(a)) * 0.08, Math.cos(a) * 0.45)); }
      break;
    }
    case 'wolfmed': {   // v30: a silver snarling-wolf medallion on a chain (a monster hunter's badge)
      const silver = MET(0xc9ccd2), dk = M(0x1a1b1f);
      g.add(mesh(GEO.Torus(0.45, 0.014, 5, 32), silver, 0, 0.93, 0.02, Math.PI / 2 + 0.3));
      g.add(mesh(GEO.Cylinder(0.11, 0.11, 0.025, 20), silver, 0, 0.72, 0.47, Math.PI / 2));
      const head = new THREE.Shape();   // wolf head: pointed ears, broad brow, narrow open-jawed snout
      head.moveTo(-0.08, 0.07); head.lineTo(-0.055, 0.12); head.lineTo(-0.03, 0.065); head.lineTo(0.03, 0.065); head.lineTo(0.055, 0.12); head.lineTo(0.08, 0.07);
      head.lineTo(0.06, -0.01); head.lineTo(0.025, -0.09); head.lineTo(0.008, -0.05); head.lineTo(-0.008, -0.05); head.lineTo(-0.025, -0.09); head.lineTo(-0.06, -0.01); head.closePath();
      g.add(mesh(new THREE.ExtrudeGeometry(head, { depth: 0.02, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 }), MET(0xa9adb6), 0, 0.715, 0.48));
      for (const s of [-1, 1]) g.add(mesh(GEO.Sphere(0.011, 6, 5), dk, s * 0.03, 0.735, 0.51));
      break;
    }
    case 'seals': {   // v30: red wax seals pressed onto the chest with long parchment prayer strips
      const wax = new THREE.MeshStandardMaterial({ color: 0x9c1a1e, roughness: 0.35, metalness: 0.1 }), paper = M(0xe8dcb8), ink = M(0x3a2a1a);
      for (const [x, y, n] of [[-0.18, 0.86, 3], [0.16, 0.8, 2], [0.02, 0.62, 3]]) {
        const z = 0.47;
        for (let i = 0; i < n; i++) g.add(mesh(GEO.Box(0.05, 0.26 + i * 0.05, 0.006), paper, x - 0.04 + i * 0.04, y - 0.16 - i * 0.025, z, 0, 0, (i - 1) * 0.12));
        g.add(mesh(GEO.Cylinder(0.06, 0.065, 0.03, 12), wax, x, y, z + 0.01, Math.PI / 2));
        g.add(mesh(GEO.Torus(0.035, 0.008, 5, 12), wax, x, y, z + 0.03));
        for (let i = 0; i < 3; i++) g.add(mesh(GEO.Box(0.03, 0.004, 0.002), ink, x - 0.04, y - 0.1 - i * 0.03, z + 0.005));
      }
      break;
    }
  }
  return root;
}

let _censorTex = null;
function censorTexture() {
  if (_censorTex) return _censorTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 48;
  const g = c.getContext('2d'), tones = ['#c9a48a', '#b88f74', '#d9b8a0', '#a77d66', '#e6cbb6', '#8f6b58'];
  for (let y = 0; y < 48; y += 8) for (let x = 0; x < 64; x += 8) {
    const edge = Math.min(x, 56 - x, y, 40 - y) / 8;   // fade toward the border, like a soft blur
    g.globalAlpha = Math.max(0.25, Math.min(1, 0.45 + edge * 0.35));
    g.fillStyle = tones[(x * 7 + y * 13) % tones.length]; g.fillRect(x, y, 8, 8);
  }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  return (_censorTex = t);
}
// Anime mode (Settings, only you see it): every player is drawn as a body pillow printed with a chibi anime
// character wearing their color. Returns a group standing on the player's feet.
const _pillowTex = new Map();
function pillowTexture(color) {
  if (_pillowTex.has(color)) return _pillowTex.get(color);
  const c = document.createElement('canvas'); c.width = 128; c.height = 320;
  const g = c.getContext('2d'), col = new THREE.Color(color), hair = col.getStyle(), deep = col.clone().multiplyScalar(0.6).getStyle();
  g.fillStyle = '#fdf6fb'; g.fillRect(0, 0, 128, 320);
  g.strokeStyle = '#f2b6d4'; g.lineWidth = 6; g.strokeRect(5, 5, 118, 310);
  g.fillStyle = '#ffd6ea'; for (let i = 0; i < 14; i++) { const x = 14 + (i * 37) % 100, y = 20 + (i * 71) % 280; g.font = '14px serif'; g.fillText(i % 2 ? '♡' : '✦', x, y); }
  // hair (back), body and dress in the player's color
  g.fillStyle = hair; g.beginPath(); g.ellipse(64, 92, 46, 60, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = deep; g.beginPath(); g.moveTo(40, 150); g.lineTo(88, 150); g.lineTo(104, 270); g.lineTo(24, 270); g.closePath(); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(54, 150); g.lineTo(64, 168); g.lineTo(74, 150); g.closePath(); g.fill();   // collar
  g.fillStyle = '#ffe3cf'; g.fillRect(36, 270, 14, 30); g.fillRect(78, 270, 14, 30);   // legs
  g.fillStyle = '#ffe3cf'; g.beginPath(); g.ellipse(64, 88, 34, 38, 0, 0, Math.PI * 2); g.fill();   // face
  g.fillStyle = hair; g.beginPath(); g.moveTo(28, 78); g.quadraticCurveTo(64, 30, 100, 78); g.lineTo(88, 64); g.lineTo(78, 82); g.lineTo(64, 60); g.lineTo(50, 82); g.lineTo(40, 64); g.closePath(); g.fill();   // bangs
  for (const s of [-1, 1]) {   // big sparkly eyes
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(64 + s * 14, 94, 9, 12, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = deep; g.beginPath(); g.ellipse(64 + s * 14, 96, 7, 10, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64 + s * 14 - 3, 91, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,120,150,.45)'; g.beginPath(); g.ellipse(64 + s * 22, 110, 6, 3, 0, 0, Math.PI * 2); g.fill();   // blush
  }
  g.strokeStyle = '#a0405a'; g.lineWidth = 2; g.beginPath(); g.arc(64, 112, 5, 0.2, Math.PI - 0.2); g.stroke();   // smile
  const t = new THREE.CanvasTexture(c);
  _pillowTex.set(color, t);
  return t;
}
let _pillowGeo = null;
function pillowGeo() {   // v1.2.4: built once and shared (every humanoid model carries a hidden pillow)
  if (_pillowGeo) return _pillowGeo;
  const geo = new THREE.BoxGeometry(0.7, 1.75, 0.26, 1, 4, 1);
  const pos = geo.attributes.position;   // puff the middle out a little so it reads as a pillow, not a plank
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), z = pos.getZ(i); pos.setZ(i, z * (1 + 0.5 * (1 - Math.abs(y) / 0.875))); }
  geo.computeVertexNormals(); geo.userData.keep = true;
  return (_pillowGeo = geo);
}
export function buildBodyPillow(color) {
  const g = new THREE.Group();
  const geo = pillowGeo();
  const front = shared('pillow' + color, () => new THREE.MeshStandardMaterial({ map: pillowTexture(color), roughness: 0.8 })), plain = shared('pillowPlain', () => new THREE.MeshStandardMaterial({ color: 0xfdf6fb, roughness: 0.85 }));
  const m = new THREE.Mesh(geo, [plain, plain, plain, plain, front, plain]);
  m.position.y = 0.9; m.castShadow = true; g.add(m);
  return g;
}

// Hazard turret: base + rotating head with two barrels. Same interface as buildPlayerModel.
export function buildTurretModel() {
  const root = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd6e4, roughness: 0.35, metalness: 0.6 });
  const dark = shared('turretDark', () => new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.5 }));
  const base = new THREE.Mesh(GEO.Cylinder(0.7, 0.85, 0.5, 18), dark); base.position.y = 0.25;
  const neck = new THREE.Mesh(GEO.Cylinder(0.3, 0.3, 0.5, 12), steel); neck.position.y = 0.7;
  const head = new THREE.Mesh(GEO.Box(0.9, 0.5, 0.7), steel); head.position.y = 1.1;
  const eye = new THREE.Mesh(GEO.Sphere(0.1, 10, 8), shared('turretEye', () => new THREE.MeshBasicMaterial({ color: 0xff3344 }))); eye.position.set(0, 1.15, 0.36);
  for (const m of [base, neck, head]) m.castShadow = true;
  root.add(base, neck, head, eye);
  const gunPivot = new THREE.Group(); gunPivot.position.set(0, 1.05, 0);
  for (const s of [-1, 1]) { const b = new THREE.Mesh(GEO.Box(0.14, 0.14, 0.9), dark); b.position.set(s * 0.3, 0, 0.55); b.castShadow = true; gunPivot.add(b); }
  const shield = buildShieldBubble(1.2, 0xff6b6b);
  shield.position.y = 0.8; shield.visible = false;
  root.add(gunPivot, shield);
  return { root, tint: [steel], gunPivot, shield, hitMeshes: [base, head, neck] };
}

// Tiny Tank card: a little tank in the player's color. The hull turns toward where you drive (model.hull),
// the turret and barrel follow your aim (the root faces the aim, like every model). Barrel sits at chest height.
export function buildTankModel(color) {
  const root = new THREE.Group(), hull = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 });
  const dark = shared('tankDark', () => new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.7 }));
  const steel = shared('tankSteel', () => new THREE.MeshStandardMaterial({ color: 0x8a92a3, roughness: 0.4, metalness: 0.6 }));
  const body = new THREE.Mesh(GEO.Box(0.72, 0.36, 1.0), mat); body.position.y = 0.38;
  const glacis = new THREE.Mesh(GEO.Box(0.7, 0.18, 0.3), mat); glacis.position.set(0, 0.5, 0.42); glacis.rotation.x = -0.5;
  hull.add(body, glacis);
  for (const s of [-1, 1]) {
    const tread = new THREE.Mesh(GEO.Box(0.2, 0.3, 1.12), dark); tread.position.set(s * 0.43, 0.17, 0); hull.add(tread);
    for (let k = -2; k <= 2; k++) { const w = new THREE.Mesh(GEO.Cylinder(0.1, 0.1, 0.22, 10), steel); w.rotation.z = Math.PI / 2; w.position.set(s * 0.43, 0.13, k * 0.23); hull.add(w); }
  }
  const turret = new THREE.Mesh(GEO.Cylinder(0.3, 0.36, 0.34, 16), mat); turret.position.y = 0.8;
  const hatch = new THREE.Mesh(GEO.Cylinder(0.13, 0.13, 0.06, 12), dark); hatch.position.set(-0.08, 0.99, -0.08);
  const gunPivot = new THREE.Group(); gunPivot.position.set(0, RULES.chest * 0.92, 0.1);
  const barrel = new THREE.Mesh(GEO.Cylinder(0.065, 0.075, 0.8, 12), steel); barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.42;
  const muzzle = new THREE.Mesh(GEO.Cylinder(0.095, 0.095, 0.12, 12), dark); muzzle.rotation.x = Math.PI / 2; muzzle.position.z = 0.82;
  gunPivot.add(barrel, muzzle);
  for (const m of [body, glacis, turret, barrel]) m.castShadow = true;
  root.add(hull, turret, hatch, gunPivot);
  const shield = buildShieldBubble(1.05); shield.position.y = 0.8; shield.visible = false; root.add(shield);
  return { root, hull, tint: [mat], gunPivot, shield, hitMeshes: [body, turret, glacis] };
}

// Tiny Tank: the player's hat, scaled down and set on top of the tank turret (turret top ~0.97,
// cosmetics are laid out for a head top at ~1.52 with radius 0.42).
export function buildTankHat(cos) {
  const g = buildCosmetics(cos, true), k = 0.75;
  g.scale.setScalar(k); g.position.y = 0.99 - 1.52 * k;
  return g;
}

// Turret shield mod: a small tripod turret with a head in the owner's color.
export function buildBlockTurretModel(color) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.25 });
  const dark = shared('btDark', () => new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.6 }));
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3, leg = new THREE.Mesh(GEO.Cylinder(0.05, 0.06, 0.95, 6), dark);
    // tripod: tops lean in under the hub, feet splay out
    leg.position.set(Math.sin(a) * 0.32, 0.42, Math.cos(a) * 0.32); leg.rotation.set(-Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45); root.add(leg);
  }
  const hub = new THREE.Mesh(GEO.Cylinder(0.18, 0.22, 0.2, 12), dark); hub.position.y = 0.86;
  const head = new THREE.Mesh(GEO.Box(0.62, 0.42, 0.62), mat); head.position.y = 1.1;
  const eye = new THREE.Mesh(GEO.Sphere(0.08, 10, 8), shared('btEye', () => new THREE.MeshBasicMaterial({ color: 0xffffff }))); eye.position.set(0, 1.18, 0.32);
  for (const m of [hub, head]) m.castShadow = true;
  root.add(hub, head, eye);
  const gunPivot = new THREE.Group(); gunPivot.position.set(0, 1.08, 0);
  for (const s of [-1, 1]) { const b = new THREE.Mesh(GEO.Box(0.1, 0.1, 0.7), dark); b.position.set(s * 0.17, 0, 0.5); b.castShadow = true; gunPivot.add(b); }
  root.add(gunPivot);
  const shield = buildShieldBubble(1.05); shield.position.y = 0.8; shield.visible = false; root.add(shield);
  return { root, tint: [mat], gunPivot, shield, hitMeshes: [head, hub] };
}

// v1.2.8 Gun Nest shield mod: a squat swivel gun behind a ring of sandbags, in the caster's color, with handles at the back
// for whoever mans it. The root faces the aim like every model; the gun pivot tilts with it.
export function buildMountTurretModel(color) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const dark = shared('btDark', () => new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.6 }));
  const bag = shared('mtBag', () => new THREE.MeshStandardMaterial({ color: 0xb8945a, roughness: 0.95 }));
  for (let k = 0; k < 7; k++) {   // sandbag horseshoe, open at the back where the gunner stands
    const a = -Math.PI * 0.62 + k * Math.PI * 1.24 / 6, b = new THREE.Mesh(GEO.Box(0.42, 0.24, 0.22), bag);
    b.position.set(Math.sin(a) * 0.62, 0.12, Math.cos(a) * 0.62); b.rotation.y = a; b.castShadow = true; root.add(b);
  }
  const post = new THREE.Mesh(GEO.Cylinder(0.12, 0.2, 0.75, 10), dark); post.position.y = 0.38;
  const ring = new THREE.Mesh(GEO.Cylinder(0.32, 0.32, 0.1, 16), dark); ring.position.y = 0.78;
  const body = new THREE.Mesh(GEO.Box(0.5, 0.36, 0.7), mat); body.position.y = 1.0;
  const plate = new THREE.Mesh(GEO.Box(0.9, 0.55, 0.06), mat); plate.position.set(0, 1.05, 0.42);   // gun shield
  for (const m of [post, ring, body, plate]) m.castShadow = true;
  root.add(post, ring, body, plate);
  const gunPivot = new THREE.Group(); gunPivot.position.set(0, 1.04, 0);
  for (const s of [-1, 1]) { const b = new THREE.Mesh(GEO.Cylinder(0.055, 0.065, 1.0, 10), dark); b.rotation.x = Math.PI / 2; b.position.set(s * 0.11, 0, 0.75); b.castShadow = true; gunPivot.add(b); }
  for (const s of [-1, 1]) { const h = new THREE.Mesh(GEO.Box(0.06, 0.06, 0.3), dark); h.position.set(s * 0.2, -0.04, -0.46); gunPivot.add(h); }
  root.add(gunPivot);
  const shield = buildShieldBubble(1.1); shield.position.y = 0.8; shield.visible = false; root.add(shield);
  return { root, tint: [mat], gunPivot, shield, hitMeshes: [body, plate, post] };
}

// Extra bits for commander units on top of the normal model.
export function addUnitExtras(model, kind) {
  if (kind === 'turret') {
    const g2 = model.gunPivot.children[0].clone(); g2.position.x = -0.64; model.gunPivot.add(g2);
    const plate = new THREE.Mesh(GEO.Cylinder(0.6, 0.65, 0.12, 16), shared('xPlate', () => new THREE.MeshStandardMaterial({ color: 0x23262e })));
    plate.position.y = 0.06; model.root.add(plate);
  } else if (kind === 'drone') {
    const rotor = new THREE.Mesh(GEO.Cylinder(0.55, 0.55, 0.02, 20), shared('xRotor', () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })));
    rotor.position.y = 1.62; model.root.add(rotor); model.rotor = rotor;
  }
}

// Co-op wave bots: a dark visor with two slanted amber eye slits instead of the white bar, and a short dark
// crest on the dome (not on Elites, who wear a crown). Same blocky style, readable at a glance besides the red.
let raiderMats = null;
export function addRaiderMarks(model, kind) {
  raiderMats ||= { dark: new THREE.MeshStandardMaterial({ color: 0x1b2030, roughness: 0.45 }), glow: new THREE.MeshBasicMaterial({ color: 0xffb72e }) };
  const { dark, glow } = raiderMats, g = new THREE.Group();
  model.root.traverse(o => { if (o.isMesh && o.userData.visor) o.visible = false; });
  const plate = new THREE.Mesh(GEO.Box(0.58, 0.2, 0.12), dark); plate.position.set(0, 1.15, 0.385); g.add(plate);
  for (const s of [-1, 1]) {
    const slit = new THREE.Mesh(GEO.Box(0.2, 0.065, 0.04), glow);
    slit.position.set(s * 0.13, 1.16, 0.45); slit.rotation.z = s * 0.38; g.add(slit);   // angled down toward the middle
  }
  if (kind !== 'elite') {
    const crest = new THREE.Mesh(GEO.Box(0.08, 0.14, 0.46), dark); crest.position.set(0, 1.5, -0.02); crest.castShadow = true; g.add(crest);
  }
  model.root.add(g);
  model.raiderMarks = g;
}

// Wave enemies: small crawling critter and a bouncy blob that splits when killed.
function enemyModel(group, tint, hit) {
  const gunPivot = new THREE.Group();
  const shield = buildShieldBubble(1.05);
  shield.visible = false; shield.position.y = 0.6;
  group.add(gunPivot, shield);
  return { root: group, tint, gunPivot, shield, hitMeshes: hit };
}
export function buildCritterModel(color) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 }), dark = shared('critDark', () => new THREE.MeshStandardMaterial({ color: 0x1b1414 }));
  const body = new THREE.Mesh(GEO.Sphere(0.75, 16, 10), mat); body.scale.set(1, 0.55, 1.3); body.position.y = 0.55; body.castShadow = true;
  const head = new THREE.Mesh(GEO.Sphere(0.42, 12, 8), dark); head.position.set(0, 0.55, 0.95);
  g.add(body, head);
  for (const s of [-1, 1]) {
    for (let k = -1; k <= 1; k++) { const leg = new THREE.Mesh(GEO.Cylinder(0.06, 0.04, 0.9, 5), dark); leg.position.set(s * 0.8, 0.3, k * 0.5); leg.rotation.z = s * 1.0; g.add(leg); }
    const eye = new THREE.Mesh(GEO.Sphere(0.09, 8, 6), shared('critEye', () => new THREE.MeshBasicMaterial({ color: 0xffe066 }))); eye.position.set(s * 0.18, 0.7, 1.28); g.add(eye);
  }
  return enemyModel(g, [mat], [body, head]);
}
export function buildBlobModel(color) {
  // A low-poly slime: faceted squashed body with a darker drippy skirt, a floating toxic core, big googly eyes,
  // a frown and a couple of bubbles on top. model.blob is squashed and stretched by the renderer as it hops.
  const g = new THREE.Group(), base = new THREE.Color(color);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, transparent: true, opacity: 0.82, flatShading: true });
  const skirtMat = shared('blobSkirt' + color, () => new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color(0x1d4a16), 0.45), roughness: 0.35, flatShading: true }));
  const white = shared('blobWhite', () => new THREE.MeshBasicMaterial({ color: 0xf2ffe8 })), black = shared('blobBlack', () => new THREE.MeshBasicMaterial({ color: 0x0c180a }));
  const blob = new THREE.Group(); g.add(blob);
  const body = new THREE.Mesh(GEO.Icosahedron(0.78, 1), mat); body.scale.set(1, 0.82, 1); body.position.y = 0.66; body.castShadow = true;
  const skirt = new THREE.Mesh(GEO.Cylinder(0.78, 0.86, 0.22, 10), skirtMat); skirt.position.y = 0.11;
  const core = new THREE.Mesh(GEO.Octahedron(0.24, 0), shared('blobCore', () => new THREE.MeshBasicMaterial({ color: 0x2f6b25 }))); core.position.y = 0.62;
  blob.add(body, skirt, core);
  for (let k = 0; k < 6; k++) {   // drips around the base
    const a = k / 6 * Math.PI * 2 + 0.3, d = new THREE.Mesh(GEO.Box(0.16, 0.2 + (k % 2) * 0.12, 0.16), skirtMat);
    d.position.set(Math.cos(a) * 0.8, 0.1, Math.sin(a) * 0.8); d.rotation.y = -a; blob.add(d);
  }
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(GEO.Sphere(0.16, 10, 8), white); eye.position.set(s * 0.25, 0.92, 0.58);
    const pupil = new THREE.Mesh(GEO.Sphere(0.075, 8, 6), black); pupil.position.set(s * 0.25 + s * 0.02, 0.9, 0.72);
    const brow = new THREE.Mesh(GEO.Box(0.2, 0.04, 0.04), black); brow.position.set(s * 0.25, 1.1, 0.62); brow.rotation.z = s * 0.35;
    blob.add(eye, pupil, brow);
  }
  const mouth = new THREE.Mesh(GEO.Torus(0.14, 0.03, 4, 10, Math.PI), black); mouth.position.set(0, 0.62, 0.74); blob.add(mouth);
  for (const [x, y, z, r] of [[0.2, 1.24, -0.1, 0.1], [-0.15, 1.2, 0.15, 0.07], [0.02, 1.3, 0.1, 0.05]]) {
    const bub = new THREE.Mesh(GEO.Icosahedron(r, 0), mat); bub.position.set(x, y, z); blob.add(bub);
  }
  const model = enemyModel(g, [mat], [body, skirt]);
  model.blob = blob;
  return model;
}

// Cursed Sacrifice level 2: a hulking brute. Hunched dark body in the owner's color, horns, glowing eyes, big fists.
export function buildBruteModel(color) {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0x3a0a12), 0.55), roughness: 0.6, flatShading: true });
  const dark = shared('bruteDark', () => new THREE.MeshStandardMaterial({ color: 0x1a0d10, roughness: 0.7, flatShading: true })), horn = shared('bruteHorn', () => new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.5 }));
  const glow = shared('bruteGlow', () => new THREE.MeshBasicMaterial({ color: 0xff3a1a }));
  const body = new THREE.Mesh(GEO.Box(1.0, 0.8, 0.7), mat); body.position.y = 0.75; body.rotation.x = 0.18; body.castShadow = true;
  const belly = new THREE.Mesh(GEO.Box(0.8, 0.35, 0.6), dark); belly.position.set(0, 0.42, 0.04);
  const head = new THREE.Mesh(GEO.Box(0.46, 0.38, 0.42), mat); head.position.set(0, 1.12, 0.3); head.castShadow = true;
  g.add(body, belly, head);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(GEO.Box(0.1, 0.05, 0.02), glow); eye.position.set(s * 0.11, 1.15, 0.52); eye.rotation.z = s * 0.25; g.add(eye);
    const h = new THREE.Mesh(GEO.Cone(0.06, 0.32, 6), horn); h.position.set(s * 0.2, 1.38, 0.24); h.rotation.set(-0.3, 0, -s * 0.55); g.add(h);
    const arm = new THREE.Mesh(GEO.Box(0.24, 0.7, 0.26), mat); arm.position.set(s * 0.62, 0.62, 0.12); arm.rotation.z = s * 0.15; arm.castShadow = true;
    const fist = new THREE.Mesh(GEO.Box(0.32, 0.28, 0.32), dark); fist.position.set(s * 0.68, 0.22, 0.16); fist.castShadow = true;
    const leg = new THREE.Mesh(GEO.Box(0.3, 0.4, 0.32), dark); leg.position.set(s * 0.27, 0.2, -0.05);
    g.add(arm, fist, leg);
  }
  return enemyModel(g, [mat], [body, head]);
}
// Sacred Grove level 3: a small angel (robed body, wings, halo). Its shield bubble works like the Turret's.
export function buildAngelModel() {
  const g = new THREE.Group();
  const robe = shared('angelRobe', () => new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.5, emissive: 0xfff3c4, emissiveIntensity: 0.25 }));
  const gold = shared('angelGold', () => new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.3, metalness: 0.6, emissive: 0xffc21a, emissiveIntensity: 0.5 }));
  const skin = shared('angelSkin', () => new THREE.MeshStandardMaterial({ color: 0xffe2c4, roughness: 0.6 }));
  const body = new THREE.Mesh(GEO.Cone(0.32, 0.8, 12), robe); body.position.y = 0.45; body.castShadow = true;
  const head = new THREE.Mesh(GEO.Sphere(0.17, 14, 10), skin); head.position.y = 0.98;
  const halo = new THREE.Mesh(GEO.Torus(0.15, 0.025, 6, 20), gold); halo.position.y = 1.24; halo.rotation.x = Math.PI / 2;
  g.add(body, head, halo);
  const wings = new THREE.Group(); wings.position.set(0, 0.68, -0.12);
  const wingMat = shared('angelWing', () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, side: THREE.DoubleSide, emissive: 0xfffbe6, emissiveIntensity: 0.3 }));
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.quadraticCurveTo(s * 0.35, 0.45, s * 0.75, 0.3); sh.quadraticCurveTo(s * 0.55, 0.05, s * 0.6, -0.15); sh.quadraticCurveTo(s * 0.3, -0.05, 0, 0);
    const w = new THREE.Mesh(new THREE.ShapeGeometry(sh), wingMat); w.rotation.y = s * 0.35; w.userData.side = s; wings.add(w);
  }
  g.add(wings);
  const m = enemyModel(g, [], [body, head]);
  m.shield.position.y = 0.6; m.wings = wings; m.halo = halo;
  return m;
}
// Sacred Grove level 2: the priest's robe worn over the default body, with a gold trim and a cross on the chest.
export function buildRobe() {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0xf3efe2, roughness: 0.7 }), gold = new THREE.MeshStandardMaterial({ color: 0xe2b33c, roughness: 0.35, metalness: 0.5 });
  const robe = new THREE.Mesh(GEO.Cylinder(0.47, 0.58, 0.88, 22, 1, true), cloth); robe.position.y = 0.56; robe.castShadow = true;
  const hem = new THREE.Mesh(GEO.Torus(0.575, 0.025, 6, 28), gold); hem.rotation.x = Math.PI / 2; hem.position.y = 0.13;
  const collar = new THREE.Mesh(GEO.Torus(0.46, 0.03, 6, 28), gold); collar.rotation.x = Math.PI / 2; collar.position.y = 1.0;
  const stole = new THREE.Mesh(GEO.Box(0.14, 0.8, 0.02), gold); stole.position.set(0, 0.6, 0.5); stole.rotation.x = -0.08;
  const crossV = new THREE.Mesh(GEO.Box(0.05, 0.2, 0.02), cloth), crossH = new THREE.Mesh(GEO.Box(0.14, 0.05, 0.02), cloth);
  crossV.position.set(0, 0.78, 0.515); crossH.position.set(0, 0.81, 0.515); crossV.rotation.x = crossH.rotation.x = -0.08;
  g.add(robe, hem, collar, stole, crossV, crossH);
  return g;
}
// Sacred Grove level 2: the healing cross that falls into the circle.
export function buildHolyCross() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xfff6dc, roughness: 0.4, emissive: 0xffe9a8, emissiveIntensity: 0.6 });
  const v = new THREE.Mesh(GEO.Box(0.22, 1.7, 0.22), wood); v.position.y = 0.85; v.castShadow = true;
  const h = new THREE.Mesh(GEO.Box(0.9, 0.2, 0.22), wood); h.position.y = 1.2; h.castShadow = true;
  g.add(v, h);
  return { root: g, mat: wood };
}
// Sacred Grove: a ring of grass tufts that grows around the circle as it charges, flowers once it's complete,
// a soft glowing disc and a column of light that brighten with each level.
export function buildGrove(R = 1) {
  const root = new THREE.Group();
  const gc = document.createElement('canvas'); gc.width = gc.height = 64;
  const gg = gc.getContext('2d'), gr = gg.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.5)'); gr.addColorStop(0.8, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  gg.fillStyle = gr; gg.fillRect(0, 0, 64, 64);
  const glowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), color: 0xfff1a8, transparent: true, depthWrite: false, opacity: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const glow = new THREE.Mesh(GEO.Plane(2.3 * R, 2.3 * R), glowMat); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; glow.renderOrder = 2;
  root.add(glow);
  const tufts = [], n = Math.max(18, Math.round(R * 11));
  const grass = new THREE.MeshStandardMaterial({ color: 0x5fae3c, roughness: 0.85 }), blade = new THREE.ConeGeometry(0.05, 0.36, 3); blade.translate(0, 0.18, 0);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, t = new THREE.Group();
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(blade, grass); b.position.set((Math.random() - 0.5) * 0.18, 0, (Math.random() - 0.5) * 0.18); b.rotation.set((Math.random() - 0.5) * 0.7, Math.random() * 6, (Math.random() - 0.5) * 0.7); b.scale.setScalar(0.7 + Math.random() * 0.6); t.add(b); }
    t.position.set(Math.cos(a) * R * 0.95, 0, Math.sin(a) * R * 0.95); t.scale.setScalar(0.001); t.userData.at = i / n; tufts.push(t); root.add(t);
  }
  // Fill the middle too, so the grove reads as one solid patch of grass (tufts grow in from the ring as it charges).
  const inner = Math.round(R * R * 9);
  for (let i = 0; i < inner; i++) {
    const a = Math.random() * Math.PI * 2, rr = R * 0.92 * Math.sqrt(Math.random()), t = new THREE.Group();
    for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(blade, grass); b.position.set((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2); b.rotation.set((Math.random() - 0.5) * 0.7, Math.random() * 6, (Math.random() - 0.5) * 0.7); b.scale.setScalar(0.6 + Math.random() * 0.5); t.add(b); }
    t.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr); t.scale.setScalar(0.001); t.userData.at = Math.min(0.97, 1 - rr / R + Math.random() * 0.1); tufts.push(t); root.add(t);
  }
  const turf = new THREE.Mesh(GEO.Circle(R * 0.98, 32), new THREE.MeshStandardMaterial({ color: 0x4a8f2e, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  turf.rotation.x = -Math.PI / 2; turf.position.y = 0.02; turf.scale.setScalar(0.001); root.add(turf);
  const flowers = new THREE.Group(), cols = [0xffffff, 0xffe066, 0xff9ec7, 0xb7a6ff];
  const stem = new THREE.MeshStandardMaterial({ color: 0x3f8a2a }), petalGeo = GEO.Sphere(0.06, 6, 4), mid = new THREE.MeshBasicMaterial({ color: 0xffc21a });
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, r = R * (0.25 + Math.random() * 0.6), f = new THREE.Group();
    const st = new THREE.Mesh(GEO.Cylinder(0.012, 0.012, 0.22, 4), stem); st.position.y = 0.11; f.add(st);
    const pm = new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.6 });
    for (let k = 0; k < 5; k++) { const p = new THREE.Mesh(petalGeo, pm); const b = k / 5 * Math.PI * 2; p.position.set(Math.cos(b) * 0.06, 0.23, Math.sin(b) * 0.06); p.scale.set(1, 0.4, 1); f.add(p); }
    const c = new THREE.Mesh(GEO.Sphere(0.035, 6, 4), mid); c.position.y = 0.24; f.add(c);
    f.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); flowers.add(f);
  }
  flowers.visible = false; root.add(flowers);
  // a soft column of light (no real light source: adding lights mid-game makes three.js recompile every material)
  // (the old cylinder of light around the grass is gone: only the ground glow and drifting motes remain)
  const beamMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
  return { root, glowMat, tufts, flowers, beamMat, turf };
}

// Riot Shield weapon mod: a curved shield in the player's color with a blue (ready) or red (broken) rim.
export function buildRiotShield(color) {
  const g = new THREE.Group();
  // Matches RIOT in sim.js: radius 0.95, +-0.8 rad arc, 0.15-1.6 m tall.
  const face = new THREE.Mesh(GEO.Cylinder(0.95, 0.95, 1.45, 24, 1, true, -0.8, 1.6),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, roughness: 0.3, emissive: color, emissiveIntensity: 0.15 }));
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(GEO.Cylinder(0.97, 0.97, 1.47, 24, 1, true, -0.8, 1.6)), new THREE.LineBasicMaterial({ color: 0x4fa8ff }));
  const orb = new THREE.Mesh(GEO.Sphere(0.2, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  orb.position.set(0, 0, 1.15); orb.visible = false;
  g.add(face, rim, orb);
  g.position.y = 0.875;
  return { group: g, face, rim, orb };
}

// First-person blaster (only drawn in first person, in its own overlay pass). Built pointing down -z.
// The glowing strips take the player's color; the muzzle flash shows briefly after each shot.
export function buildBlaster() {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x2a3042, roughness: 0.45, metalness: 0.35, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8a93a8, roughness: 0.35, metalness: 0.6, flatShading: true });
  const tintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.15 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); root.add(m); return m; };
  add(GEO.Box(0.09, 0.1, 0.34), body, 0, 0, 0);                       // receiver
  add(GEO.Box(0.05, 0.018, 0.2), tintMat, 0, 0.058, -0.01);           // top rail (player color)
  add(GEO.Cylinder(0.03, 0.034, 0.26, 8), trim, 0, 0.01, -0.28, Math.PI / 2); // barrel
  add(GEO.Cylinder(0.045, 0.045, 0.05, 8), body, 0, 0.01, -0.39, Math.PI / 2); // muzzle ring
  for (let i = 0; i < 3; i++) add(GEO.Box(0.1, 0.018, 0.022), trim, 0, 0.01, -0.2 - i * 0.05); // cooling fins
  add(GEO.Box(0.06, 0.13, 0.07), body, 0, -0.1, 0.09, 0.32);         // grip
  add(GEO.Box(0.05, 0.1, 0.06), trim, 0, -0.08, -0.06);              // cell (swings out on reload)
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
  const glow = add(GEO.Box(0.094, 0.016, 0.2), glowMat, 0, -0.02, -0.02); // side glow strip
  const cell = root.children[root.children.length - 2];
  const muzzle = new THREE.Mesh(GEO.Circle(0.09, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  muzzle.position.set(0, 0.01, -0.43); muzzle.visible = false; root.add(muzzle);
  root.rotation.y = 0.04; root.scale.setScalar(0.62);
  const api = {
    root, glow, muzzle, color: null,
    setColor(c) { api.color = c; tintMat.color.set(c); tintMat.emissive.set(c); glowMat.color.set(c); muzzle.material.color.set(c).lerp(new THREE.Color(0xffffff), 0.5); },
    reload(on) { cell.position.y += ((on ? -0.16 : -0.08) - cell.position.y) * 0.25; cell.rotation.x += ((on ? 0.6 : 0) - cell.rotation.x) * 0.25; },
  };
  return api;
}

// ---------------------------------------------------------------------
// Gun skins. Every skin is built in "gun space": +z is forward, the grip sits at z = 0 and the muzzle
// at about z = 0.8 (the size of the original cube gun). Third person uses it as-is on the gun pivot;
// first person turns it around and shrinks it (buildViewGun). To add a skin: add a case here and a
// label in COSMETICS.gun (config.js).
// ---------------------------------------------------------------------
const GUN_TINTABLE = new Set(['neon', 'cube', 'blaster', 'camo', 'gauss']);
export function buildGunSkin(skin, color = '#ffffff') {
  const root = new THREE.Group();
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? 0.5, metalness: o.m ?? 0.1, flatShading: !!o.flat, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, transparent: !!o.t, opacity: o.op ?? 1 });
  const tintMat = std(color, { r: 0.4, e: color, ei: 0.25 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); root.add(m); return m; };
  const box = (w, h, d) => GEO.Box(w, h, d);
  const cyl = (r1, r2, h, n = 12) => GEO.Cylinder(r1, r2, h, n);
  const along = Math.PI / 2; // cylinders point up (y); rotate x by 90° to point along z
  let tip = 0.82;
  switch (skin) {
    case 'blaster': {
      const body = std(0x2a3042, { r: 0.45, m: 0.35, flat: true }), trim = std(0x8a93a8, { r: 0.35, m: 0.6, flat: true });
      add(box(0.15, 0.17, 0.5), body, 0, 0, 0.25);
      add(box(0.08, 0.03, 0.32), tintMat, 0, 0.1, 0.26);
      add(cyl(0.05, 0.055, 0.36, 10), trim, 0, 0.015, 0.62, along);
      add(cyl(0.075, 0.075, 0.08, 10), body, 0, 0.015, 0.78, along);
      for (let i = 0; i < 3; i++) add(box(0.17, 0.03, 0.035), trim, 0, 0.015, 0.5 + i * 0.07);
      add(box(0.1, 0.2, 0.11), body, 0, -0.15, 0.08, -0.32);
      tip = 0.83; break;
    }
    case 'gold': {
      const g = std(0xf2c440, { r: 0.28, m: 0.45, e: 0x6a4a00, ei: 0.35 }), d = std(0xb8862a, { r: 0.35, m: 0.4, e: 0x3a2800, ei: 0.3 }); // no env map, so keep metalness moderate or gold reads black
      add(box(0.17, 0.17, 0.62), g, 0, 0, 0.31);
      add(cyl(0.045, 0.05, 0.3, 14), g, 0, 0.02, 0.72, along);
      add(box(0.18, 0.04, 0.5), d, 0, 0.1, 0.3);
      add(box(0.1, 0.2, 0.1), g, 0, -0.16, 0.06, -0.3);
      add(GEO.Octahedron(0.045), std(0xff3b6b, { r: 0.1, m: 0.2, e: 0x801030, ei: 0.6 }), 0, 0.14, 0.18); // the gem
      tip = 0.88; break;
    }
    case 'neon': {
      const glass = std(0x0d1020, { r: 0.2, m: 0.1, t: true, op: 0.75 });
      const g = add(box(0.16, 0.16, 0.8), glass, 0, 0, 0.4);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g.geometry), new THREE.LineBasicMaterial({ color }));
      g.add(edges);
      add(box(0.04, 0.04, 0.78), new THREE.MeshBasicMaterial({ color }), 0, 0, 0.4);
      add(box(0.17, 0.02, 0.06), new THREE.MeshBasicMaterial({ color }), 0, 0, 0.2);
      add(box(0.17, 0.02, 0.06), new THREE.MeshBasicMaterial({ color }), 0, 0, 0.6);
      break;
    }
    case 'camo': {
      add(box(0.16, 0.16, 0.8), std(0x5b6b3a, { r: 0.85 }), 0, 0, 0.4);
      const cols = [0x3b4526, 0x8a7a4f, 0x2a2f1c, 0x6f7f47];
      for (let i = 0; i < 14; i++) {
        const side = i % 3, z = 0.06 + ((i * 0.37) % 0.7), w = 0.05 + (i % 4) * 0.02;
        if (side === 0) add(box(w, 0.012, 0.09 + (i % 3) * 0.04), std(cols[i % 4], { r: 0.9 }), ((i * 0.13) % 0.1) - 0.05, 0.083, z);
        else add(box(0.012, w, 0.09 + (i % 2) * 0.05), std(cols[i % 4], { r: 0.9 }), side === 1 ? 0.083 : -0.083, ((i * 0.11) % 0.1) - 0.05, z);
      }
      add(cyl(0.035, 0.035, 0.28, 8), std(0x1b2030, { r: 0.6 }), 0, 0.12, 0.42, along); // scope
      add(box(0.03, 0.03, 0.2), tintMat, 0, 0.083, 0.12);
      break;
    }
    case 'toy': {
      const y = std(0xffd23f, { r: 0.6 }), o = std(0xff7a1a, { r: 0.55 }), b = std(0x2f7dff, { r: 0.55 });
      add(GEO.Sphere(0.14, 14, 10), y, 0, 0, 0.2).scale.set(1, 0.9, 1.6);
      add(cyl(0.07, 0.08, 0.4, 14), b, 0, 0.02, 0.5, along);
      add(cyl(0.085, 0.085, 0.1, 14), o, 0, 0.02, 0.74, along);   // the orange safety tip
      add(box(0.09, 0.2, 0.1), o, 0, -0.17, 0.08, -0.3);
      add(GEO.Torus(0.05, 0.015, 6, 12), b, 0, -0.1, 0.18, 0, along);
      tip = 0.8; break;
    }
    case 'raygun': {
      const silver = std(0xc9ced8, { r: 0.25, m: 0.85 }), red = std(0xd8303a, { r: 0.4, m: 0.3 });
      add(GEO.Sphere(0.15, 16, 12), red, 0, 0, 0.16).scale.set(1, 1, 1.3);
      add(cyl(0.025, 0.09, 0.5, 14), silver, 0, 0, 0.5, -along);
      for (let i = 0; i < 3; i++) add(GEO.Torus(0.075 - i * 0.016, 0.014, 6, 16), silver, 0, 0, 0.36 + i * 0.12);
      add(GEO.Sphere(0.04, 10, 8), std(0x7fffd4, { e: 0x40ffc0, ei: 0.9 }), 0, 0, 0.77);
      add(box(0.02, 0.12, 0.16), red, 0, 0.14, 0.12);
      add(box(0.08, 0.2, 0.09), silver, 0, -0.16, 0.05, -0.35);
      tip = 0.8; break;
    }
    case 'candy': {
      const red = std(0xe0303a, { r: 0.3 }), white = std(0xf8f4f0, { r: 0.3 });
      for (let i = 0; i < 8; i++) add(cyl(0.065, 0.065, 0.1, 12), i % 2 ? red : white, 0, 0, 0.05 + i * 0.1, along);
      add(GEO.Torus(0.12, 0.065, 8, 14, Math.PI), red, 0, -0.12, 0, 0, -along, along); // hook curls back and down
      break;
    }
    case 'banana': {
      const yel = std(0xf7d84a, { r: 0.6 }), brn = std(0x5a3a1a, { r: 0.8 });
      for (let i = 0; i <= 24; i++) {          // a gentle curve of overlapping segments, thick in the middle
        const t = i / 24, r = 0.035 + 0.045 * Math.sin(Math.PI * t);
        add(GEO.Sphere(r, 10, 8), yel, 0, 0.1 * Math.sin(Math.PI * t) - 0.02, 0.04 + 0.76 * t);
      }
      add(cyl(0.018, 0.025, 0.07, 6), brn, 0, -0.01, 0.83, along - 0.4);
      add(cyl(0.025, 0.018, 0.05, 6), brn, 0, -0.01, 0.0, along + 0.4);
      tip = 0.84; break;
    }
    case 'baguette': {
      const crust = std(0xc98b3f, { r: 0.85 }), cut = std(0xf0d9a0, { r: 0.9 });
      add(cyl(0.075, 0.075, 0.74, 14), crust, 0, 0, 0.42, along);
      add(GEO.Sphere(0.075, 12, 8), crust, 0, 0, 0.79);
      add(GEO.Sphere(0.075, 12, 8), crust, 0, 0, 0.05);
      for (let i = 0; i < 4; i++) add(box(0.06, 0.012, 0.11), cut, 0, 0.072, 0.18 + i * 0.16, 0, 0.6);
      tip = 0.86; break;
    }
    case 'duck': {
      const yel = std(0xffd60a, { r: 0.35 }), org = std(0xff8c1a, { r: 0.4 }), blk = std(0x111111, { r: 0.3 });
      add(GEO.Sphere(0.17, 16, 12), yel, 0, 0, 0.28).scale.set(1, 0.85, 1.25);
      add(GEO.Sphere(0.11, 14, 10), yel, 0, 0.17, 0.48);
      add(GEO.Cone(0.06, 0.2, 10), org, 0, 0.15, 0.66, along);   // the beak is the muzzle
      for (const x of [-0.06, 0.06]) add(GEO.Sphere(0.022, 8, 6), blk, x, 0.21, 0.57);
      add(GEO.Cone(0.06, 0.12, 8), yel, 0, 0.08, 0.05, -along - 0.6);
      tip = 0.78; break;
    }
    case 'fish': {
      const scale = std(0x5fa8d3, { r: 0.35, m: 0.3 }), fin = std(0xff8f5a, { r: 0.5 }), eye = std(0xffffff), pup = std(0x111111);
      add(GEO.Sphere(0.15, 16, 12), scale, 0, 0, 0.45).scale.set(0.8, 1, 2.4);
      const tail = add(GEO.Cone(0.13, 0.2, 4), fin, 0, 0, 0.02, -along); tail.scale.set(0.25, 1, 1);
      add(GEO.Cone(0.05, 0.14, 4), fin, 0, 0.15, 0.4).scale.set(0.3, 1, 1.4);
      for (const x of [-0.09, 0.09]) { add(GEO.Sphere(0.03, 8, 6), eye, x, 0.04, 0.72); add(GEO.Sphere(0.015, 6, 5), pup, x * 1.2, 0.04, 0.74); }
      tip = 0.82; break;
    }
    case 'carrot': {
      const org = std(0xf47b20, { r: 0.6 }), grn = std(0x3fae49, { r: 0.6 });
      add(GEO.Cone(0.1, 0.78, 12), org, 0, 0, 0.45, along);
      for (let i = 0; i < 4; i++) add(GEO.Cone(0.025, 0.22, 5), grn, Math.sin(i * 1.6) * 0.04, 0.04 + Math.cos(i * 1.6) * 0.04, -0.02, -along - 0.3 + i * 0.2, 0, i * 0.4 - 0.6);
      for (let i = 0; i < 5; i++) add(GEO.Torus(0.085 - i * 0.015, 0.006, 4, 12), std(0xc85f12), 0, 0, 0.2 + i * 0.12);
      tip = 0.86; break;
    }
    case 'eblade': {   // v30: a sci-fi plasma blade: a ribbed hilt and two glowing prongs splitting forward
      const hilt = std(0x3a3f4a, { r: 0.35, m: 0.6 }), rib = std(0x8a93a8, { r: 0.3, m: 0.7 });
      const plasma = new THREE.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.85 }), core = new THREE.MeshBasicMaterial({ color: 0xf2fbff });
      add(box(0.09, 0.12, 0.34), hilt, 0, 0, 0.12);
      for (let i = 0; i < 4; i++) add(box(0.1, 0.13, 0.025), rib, 0, 0, 0.0 + i * 0.07);
      for (const s of [-1, 1]) {
        add(box(0.05, 0.08, 0.16), hilt, s * 0.07, 0, 0.32, 0, -s * 0.25, 0);
        const p = add(GEO.Cone(0.045, 0.62, 6), plasma, s * 0.12, 0, 0.66, along, 0, 0); p.scale.set(1, 1, 0.45);
        add(GEO.Cone(0.018, 0.56, 5), core, s * 0.12, 0, 0.64, along);
      }
      tip = 0.9; break;
    }
    case 'gauss': {   // v30: a chunky power-armor gauss rifle with a drum magazine and a stripe in your color
      const gm = std(0x4a505c, { r: 0.45, m: 0.5, flat: true }), dk = std(0x23262c, { r: 0.6, flat: true }), y = std(0xd8a22a, { r: 0.5, flat: true });
      add(box(0.2, 0.22, 0.62), gm, 0, 0, 0.3);
      add(box(0.21, 0.05, 0.4), tintMat, 0, 0.12, 0.34);
      add(box(0.12, 0.12, 0.34), dk, 0, -0.02, 0.76);
      add(cyl(0.035, 0.035, 0.1, 8), dk, 0, -0.02, 0.95, along);
      add(box(0.06, 0.06, 0.3), gm, 0, -0.12, 0.66);   // under-barrel
      add(cyl(0.1, 0.1, 0.12, 14), dk, 0, -0.17, 0.32, 0, 0, along);   // drum magazine
      add(box(0.11, 0.2, 0.11), gm, 0, -0.17, 0.06, -0.3);
      add(box(0.22, 0.02, 0.06), y, 0, 0.0, 0.62);   // hazard stripe
      tip = 1.0; break;
    }
    case 'katana': {   // Katana weapon mod (not a cosmetic): wrapped grip, round guard, long curved blade
      const wrap = std(0x1d1a24, { r: 0.8 }), diamond = std(0xd8c9a0, { r: 0.6 }), guard = std(0xc9a646, { r: 0.3, m: 0.6, e: 0x3a2a00, ei: 0.3 });
      const blade = std(0xe9eef6, { r: 0.18, m: 0.55, e: 0xffffff, ei: 0.0 });
      add(cyl(0.035, 0.038, 0.28, 8), wrap, 0, 0, 0.0, along);                         // grip (tsuka)
      for (let i = 0; i < 4; i++) add(box(0.05, 0.05, 0.03), diamond, 0, 0, -0.1 + i * 0.065, 0, 0, Math.PI / 4);
      add(cyl(0.042, 0.042, 0.03, 10), guard, 0, 0, -0.15, along);                     // pommel
      add(cyl(0.1, 0.1, 0.03, 16), guard, 0, 0, 0.155, along);                    // guard (tsuba)
      add(box(0.03, 0.05, 0.05), guard, 0, 0, 0.19);                                    // collar (habaki)
      const segs = 6, L = 0.95;                                                       // the blade curves gently upward
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs, t1 = (i + 1) / segs, z0 = 0.21 + t0 * L, z1 = 0.21 + t1 * L, y0 = 0.09 * t0 * t0, y1 = 0.09 * t1 * t1;
        const m = add(box(0.055 - 0.012 * t0, 0.02, z1 - z0 + 0.004), blade, 0, (y0 + y1) / 2, (z0 + z1) / 2, -Math.atan2(y1 - y0, z1 - z0));
        if (i === segs - 1) m.scale.y = 0.75;
      }
      add(GEO.Cone(0.03, 0.09, 4), blade, 0, 0.09 + 0.012, 0.21 + L + 0.03, along - 0.18);   // tip
      root.userData.blade = blade;
      tip = 1.2; break;
    }
    default: { // 'cube': the original gun, with a thin stripe in your color so it reads in first person
      skin = 'cube';
      add(box(0.16, 0.16, 0.8), std(0x1b2030, { r: 0.4 }), 0, 0, 0.4);
      add(box(0.05, 0.012, 0.6), tintMat, 0, 0.086, 0.42);
    }
  }
  return { root, skin, tip, tintMat, tintable: GUN_TINTABLE.has(skin) };
}

// First-person version of a gun skin (drawn in its own overlay pass, pointing down -z).
// Same API the renderer uses for the old blaster: root, glow, muzzle, setColor, reload.
export function buildViewGun(skin, color = '#ffffff') {
  const root = new THREE.Group();
  let g = buildGunSkin(skin, color);
  const holder = new THREE.Group();
  holder.add(g.root);
  holder.rotation.y = Math.PI;            // forward is -z in the view
  holder.position.z = 0.06;
  holder.scale.setScalar(0.4);
  root.add(holder);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
  const glow = new THREE.Mesh(GEO.Box(0.002, 0.002, 0.002), glowMat); glow.visible = false; root.add(glow);
  const muzzle = new THREE.Mesh(GEO.Circle(0.05, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  muzzle.position.set(0, 0.006, 0.06 - g.tip * 0.4 - 0.01); muzzle.visible = false; root.add(muzzle);
  root.rotation.y = 0.04;
  const api = {
    root, glow, muzzle, color: null, skin: g.skin,
    setColor(c) {
      api.color = c; muzzle.material.color.set(c).lerp(new THREE.Color(0xffffff), 0.5); glowMat.color.set(c);
      if (g.tintable) { holder.remove(g.root); g = buildGunSkin(api.skin, c); holder.add(g.root); }
    },
    reload(on) { holder.rotation.x += ((on ? 0.55 : 0) - holder.rotation.x) * 0.2; holder.position.y += ((on ? -0.05 : 0) - holder.position.y) * 0.2; },
    get blade() { return g.root.userData.blade || null; },
    holder,
  };
  return api;
}

// Co-op final boss ("The Warden"): an armored golem with a glowing core. Built about player-sized; the sim
// scales it up (fixedSize). model.core / model.eyes glow brighter each phase (render.js).
export function buildBossModel(color, type) {
  const g = new THREE.Group();
  const armor = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1626, roughness: 0.6, metalness: 0.4, flatShading: true });
  const glow = new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff6a00, emissiveIntensity: 1.2, roughness: 0.3 });
  const add = (geo, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  for (const s of [-1, 1]) {
    add(GEO.Box(0.26, 0.5, 0.3), dark, s * 0.2, 0.25, 0);                  // legs
    add(GEO.Box(0.32, 0.12, 0.42), armor, s * 0.2, 0.06, 0.05);           // feet
  }
  const torso = add(GEO.Box(0.8, 0.62, 0.5), armor, 0, 0.82, 0);
  add(GEO.Box(0.62, 0.18, 0.42), dark, 0, 0.5, 0);                         // belt
  const core = add(GEO.Icosahedron(0.13, 0), glow, 0, 0.86, 0.27);
  const head = add(GEO.Box(0.36, 0.3, 0.34), armor, 0, 1.3, 0.02);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffb04a });
  for (const s of [-1, 1]) {
    add(GEO.Box(0.09, 0.04, 0.02), eyeMat, s * 0.08, 1.33, 0.2);
    const horn = add(GEO.Cone(0.05, 0.3, 6), dark, s * 0.17, 1.52, -0.02); horn.rotation.z = -s * 0.5;
    const pad = add(GEO.Sphere(0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), armor, s * 0.5, 1.08, 0); pad.scale.set(1, 0.8, 1);
    for (let k = 0; k < 3; k++) { const sp = add(GEO.Cone(0.04, 0.18, 5), glow, s * (0.42 + k * 0.08), 1.25 - k * 0.02, -0.05 + k * 0.05); sp.rotation.z = -s * 0.5; }
    const arm = add(GEO.Box(0.2, 0.55, 0.22), dark, s * 0.55, 0.72, 0.02);
    add(GEO.Box(0.26, 0.22, 0.28), armor, s * 0.55, 0.38, 0.04);            // fists
    arm.rotation.z = s * 0.08;
  }
  const crown = new THREE.Mesh(GEO.Torus(0.16, 0.025, 6, 16), glow); crown.position.set(0, 1.47, 0.02); crown.rotation.x = Math.PI / 2; g.add(crown);
  if (type === 'brood') {   // The Brood Mother: a swollen translucent egg sac on its back and four spindly legs
    const sacMat = new THREE.MeshStandardMaterial({ color: 0x9be36b, roughness: 0.2, transparent: true, opacity: 0.7, flatShading: true });
    const sac = add(GEO.Icosahedron(0.42, 1), sacMat, 0, 1.05, -0.48); sac.scale.set(1.1, 0.9, 1.2);
    for (const [x, y, z] of [[0.15, 1.1, -0.6], [-0.12, 0.95, -0.7], [0, 1.25, -0.45]]) add(GEO.Sphere(0.09, 8, 6), glow, x, y, z);
    for (const s of [-1, 1]) for (const f of [-1, 1]) {
      const leg = add(GEO.Box(0.07, 0.07, 0.75), dark, s * 0.55, 0.45, f * 0.22); leg.rotation.set(f * 0.5, s * 1.1, s * 0.6);
    }
  } else if (type === 'storm') {   // The Storm Engine: tesla coils on the shoulders and a spinning halo of plates
    const coilMat = new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x2f9fff, emissiveIntensity: 1.1, roughness: 0.3 });
    for (const s of [-1, 1]) {
      add(GEO.Cylinder(0.05, 0.07, 0.4, 6), dark, s * 0.5, 1.4, -0.05);
      for (let k = 0; k < 3; k++) { const r = add(GEO.Torus(0.1 - k * 0.02, 0.02, 4, 10), coilMat, s * 0.5, 1.3 + k * 0.1, -0.05); r.rotation.x = Math.PI / 2; }
      add(GEO.Sphere(0.08, 8, 6), coilMat, s * 0.5, 1.64, -0.05);
    }
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, pl = new THREE.Mesh(GEO.Box(0.12, 0.03, 0.06), coilMat); pl.position.set(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2); pl.rotation.y = -a; crown.add(pl); }
  }
  const model = enemyModel(g, [armor], [torso, head]);
  model.core = core; model.coreMat = glow; model.crown = crown;
  return model;
}

// Boss portal: a standing ring of violet energy with a swirling face (model.spin turns each frame).
export function buildPortalModel(color = '#b56bff') {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3 });
  const ring = new THREE.Mesh(GEO.Torus(0.62, 0.09, 10, 32), ringMat); ring.position.y = 0.85; ring.castShadow = true; g.add(ring);
  const spin = new THREE.Group(); spin.position.y = 0.85; g.add(spin);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), grd = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.25, '#e2b8ff'); grd.addColorStop(0.7, color); grd.addColorStop(1, 'rgba(40,0,70,0)');
  x.fillStyle = grd; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(30,0,50,.55)'; x.lineWidth = 6;
  for (let k = 0; k < 4; k++) { x.beginPath(); for (let t = 0; t < 1; t += 0.02) { const a = k * Math.PI / 2 + t * 5, r = t * 58; x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } x.stroke(); }
  const face = new THREE.Mesh(GEO.Circle(0.58, 32), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  spin.add(face);
  const base = new THREE.Mesh(GEO.Cylinder(0.45, 0.55, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0x241433, roughness: 0.6 })); base.position.y = 0.06; g.add(base);
  const model = enemyModel(g, [ringMat], [ring, face]);
  model.spin = spin;
  return model;
}

// ---------------------------------------------------------------------
// Super Saiyan Hair (shield mod): spiky hair that replaces the hat. Built at full size around the head;
// the renderer scales it (small when drained, nearly as big as the body when full) and shifts its color
// from dull grey to glowing gold.
// ---------------------------------------------------------------------
export function buildSaiyanHair() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffb000, emissiveIntensity: 0.6, roughness: 0.45, metalness: 0.1, flatShading: true });
  const spike = (len, r, rx, ry, rz, x, y, z) => {
    const geo = new THREE.ConeGeometry(r, len, 5); geo.translate(0, len / 2, 0);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz, 'YXZ'); m.castShadow = true; g.add(m); return m;
  };
  // a cap over the top/back of the dome (the visor stays clear), then big spikes sweeping up and back
  const cap = new THREE.Mesh(GEO.Sphere(0.46, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.33), mat); cap.position.set(0, -0.16, -0.06); cap.castShadow = true; g.add(cap);
  spike(1.45, 0.24, -0.35, 0, 0, 0, 0.0, -0.08);                        // the big central spike
  for (const [len, r, rx, ry, x, z] of [[1.15, 0.2, -0.55, 0.55, 0.16, -0.12], [1.15, 0.2, -0.55, -0.55, -0.16, -0.12], [1.0, 0.18, -0.95, 0.0, 0, -0.2],
    [0.95, 0.17, -0.5, 1.2, 0.26, -0.02], [0.95, 0.17, -0.5, -1.2, -0.26, -0.02], [0.8, 0.15, -1.25, 0.6, 0.2, -0.25], [0.8, 0.15, -1.25, -0.6, -0.2, -0.25]]) spike(len, r, rx, ry, 0, x, 0.0, z);
  for (let i = 0; i < 7; i++) {                                         // lower ring at the back and sides, swept back and out
    const a = Math.PI * 0.45 + (i / 6) * Math.PI * 1.1;
    spike(0.6 + (i % 2) * 0.15, 0.12, -1.55, a, 0, Math.sin(a) * 0.33, -0.12, Math.cos(a) * 0.33);
  }
  const bangs = [-0.13, 0.05].map(x => spike(0.3, 0.07, 2.3, 0, 0.3 * Math.sign(x || 1), x, -0.06, 0.36));   // a couple of bangs over the brow
  g.position.y = 1.38;   // on top of the head dome of the default model; scaling grows up and out from here
  return { group: g, mat, bangs };
}

// ---------------------------------------------------------------------
// Pentagram (shield mod): a glowing pentagram drawn on the floor (canvas texture, redrawn as it's drawn),
// five candles that light once it's finished, and a portal that opens at each ritual level.
// ---------------------------------------------------------------------
export function drawPentagram(g, size, draw) {
  const c = size / 2, R = c * 0.94, Ri = c * 0.8;
  g.clearRect(0, 0, size, size);
  g.lineCap = 'round'; g.strokeStyle = '#ffffff'; g.shadowColor = '#ffffff'; g.shadowBlur = size * 0.02;
  const ring = Math.min(1, draw / 0.35), star = Math.max(0, Math.min(1, (draw - 0.35) / 0.5)), inner = Math.max(0, Math.min(1, (draw - 0.85) / 0.15));
  g.lineWidth = size * 0.026;
  if (ring > 0) { g.beginPath(); g.arc(c, c, R, -Math.PI / 2, -Math.PI / 2 + ring * Math.PI * 2); g.stroke(); }
  if (inner > 0) { g.lineWidth = size * 0.01; g.beginPath(); g.arc(c, c, Ri, -Math.PI / 2, -Math.PI / 2 + inner * Math.PI * 2); g.stroke(); }
  if (star > 0) {   // the five strokes of the star, one after the other
    g.lineWidth = size * 0.024;
    const pts = []; for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * 4 * Math.PI / 5; pts.push([c + Math.cos(a) * Ri, c + Math.sin(a) * Ri]); }
    const done = star * 5;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let k = 0; k < 5 && k < done; k++) {
      const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % 5], f = Math.min(1, done - k);
      g.lineTo(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
    }
    g.stroke();
  }
  if (draw >= 1) {   // small sigils between the rings
    g.font = `${Math.round(size * 0.05)}px serif`; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const sig = ['☽', '✶', '☿', '♄', '✠', '☾', '♆', '✷', '☉', '♃'];
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + 0.31; g.fillText(sig[k], c + Math.cos(a) * (R + Ri) / 2, c + Math.sin(a) * (R + Ri) / 2); }
  }
}
export function buildPentagram(R = 1) {
  const root = new THREE.Group();
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xb25bff, transparent: true, depthWrite: false, side: THREE.DoubleSide,   // normal blending so it reads on light floors too
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const disc = new THREE.Mesh(GEO.Plane(2 * R, 2 * R), mat); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.025; disc.renderOrder = 3;
  // a soft glow under the lines
  const gc = document.createElement('canvas'); gc.width = gc.height = 64;
  const gg = gc.getContext('2d'), gr = gg.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.75, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  gg.fillStyle = gr; gg.fillRect(0, 0, 64, 64);
  const glowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc), color: 0x7a2bd0, transparent: true, depthWrite: false, opacity: 0.6 });
  const glow = new THREE.Mesh(GEO.Plane(2.4 * R, 2.4 * R), glowMat); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02; glow.renderOrder = 2;
  root.add(glow, disc);
  // candles at the star's five points (shown once it's fully drawn)
  const candles = new THREE.Group(), flames = [];
  const wax = new THREE.MeshStandardMaterial({ color: 0x2a1b2e, roughness: 0.7 }), drip = new THREE.MeshStandardMaterial({ color: 0x4a2a52, roughness: 0.6 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + k * 2 * Math.PI / 5, x = Math.cos(a) * 0.8 * R, z = Math.sin(a) * 0.8 * R, h = 0.16 + (k % 2) * 0.06;
    const cd = new THREE.Mesh(GEO.Cylinder(0.035, 0.04, h, 8), wax); cd.position.set(x, h / 2, z); cd.castShadow = true;
    const lip = new THREE.Mesh(GEO.Cylinder(0.045, 0.045, 0.02, 8), drip); lip.position.set(x, h, z);
    const fl = new THREE.Mesh(GEO.Cone(0.025, 0.08, 6), flameMat); fl.position.set(x, h + 0.06, z); flames.push(fl);
    candles.add(cd, lip, fl);
  }
  candles.visible = false; root.add(candles);
  return { root, canvas: c, ctx: c.getContext('2d'), tex, mat, glowMat, candles, flames, key: -1 };
}
