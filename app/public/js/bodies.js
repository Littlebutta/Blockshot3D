// Alternate player bodies (Customize > Character). Each builder returns the same shape as buildDefaultModel()
// in art.js: { group, tint, hitMeshes } plus optional headNode (the animated group cosmetics ride on),
// hatHide (meshes hidden while a hat is worn) and anim(t, walk) for idle/walk motion (walk 0..1).
// Every body stands on y = 0, faces +z and fits the normal collider; they are purely cosmetic.
// BODY_FIT says where each cosmetic slot sits on that body (see fitCosmetics in art.js).
import * as THREE from '/vendor/three/build/three.module.js';
import { GEO } from './geocache.js';

// A faint, chunky grain multiplied over every body material: low detail, just enough to stop surfaces looking flat.
let _grain = null;
export function grainTexture() {
  if (_grain) return _grain;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 32; y += 2) for (let x = 0; x < 32; x += 2) { const v = 232 + Math.floor(rnd() * 24); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 2, 2); }
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(200,200,200,0.35)'; g.fillRect(Math.floor(rnd() * 28), Math.floor(rnd() * 28), 4, 2); }   // a few scuffs
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); t.magFilter = THREE.NearestFilter;
  return (_grain = t);
}

function makeBuilders() {
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ map: o.noTex ? null : grainTexture(), color: c, roughness: o.r ?? 0.45, metalness: o.m ?? 0.1, flatShading: !!o.flat,
    emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, transparent: !!o.t, opacity: o.o ?? 1, side: o.ds ? THREE.DoubleSide : THREE.FrontSide });
  const glow = c => new THREE.MeshBasicMaterial({ color: c });
  // v1.2.6: fixed-color parts share one material per look across every model (like art.js shared); the player-color
  // ones (tint, visor, shards, core) and the tiki's animated eyes stay per model
  const memo = new Map(), K = (key, make) => { let m = memo.get(key); if (!m) memo.set(key, m = make()); return m; };
  const stdK = (c, o = {}) => K('s' + c + JSON.stringify(o), () => std(c, o)), glowK = c => K('g' + c, () => glow(c));
  const add = (g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m;
  };
  const B = (w, h, d) => GEO.Box(w, h, d);
  const S = (r, a = 20, b = 14) => GEO.Sphere(r, a, b);
  const C = (rt, rb, h, n = 20) => GEO.Cylinder(rt, rb, h, n);
  const shade = (c, k) => new THREE.Color(c).multiplyScalar(k);
  const DARK = 0x1b2030, INK = 0x0d0f14;
  const none = () => {};

  const builders = {
    // Boxy service robot with a screen face and a blinking antenna.
    bolt(color) {
      const g = new THREE.Group(), mat = std(color, { r: 0.4, m: 0.3, flat: true }), dark = stdK(0x2a3042, { r: 0.45, m: 0.5, flat: true });
      const legs = [-1, 1].map(s => { const p = new THREE.Group(); p.position.set(s * 0.15, 0.4, 0); g.add(p); add(p, B(0.18, 0.4, 0.24), dark, 0, -0.2, 0); return p; });
      const torso = add(g, B(0.68, 0.52, 0.48), mat, 0, 0.66);
      add(g, B(0.16, 0.08, 0.02), glowK(0x9ff3ff), 0.16, 0.74, 0.25);
      add(g, B(0.08, 0.08, 0.02), glowK(0xffd34a), -0.18, 0.74, 0.25);
      const arms = [-1, 1].map(s => { const p = new THREE.Group(); p.position.set(s * 0.43, 0.86, 0); g.add(p); add(p, B(0.13, 0.4, 0.15), dark, 0, -0.18, 0); return p; });
      add(g, C(0.08, 0.1, 0.12, 10), dark, 0, 0.97);
      const headG = new THREE.Group(); g.add(headG);
      const head = add(headG, B(0.64, 0.44, 0.52), mat, 0, 1.24);
      add(headG, B(0.52, 0.28, 0.02), stdK(INK, { r: 0.2, m: 0.4 }), 0, 1.24, 0.265);
      const eyes = [-1, 1].map(s => add(headG, B(0.11, 0.07, 0.01), glowK(0x7ff6ff), s * 0.12, 1.26, 0.277));
      add(headG, C(0.018, 0.018, 0.22, 6), dark, 0.18, 1.55);
      const bulb = add(headG, S(0.05, 10, 8), glowK(0xff4a4a), 0.18, 1.68);
      return { group: g, handMat: dark, tint: [mat], hitMeshes: [torso, head], headNode: headG, anim(t, w) {
        legs.forEach((l, i) => l.rotation.x = Math.sin(t * 10 + i * Math.PI) * 0.5 * w);
        arms[0].rotation.x = Math.sin(t * 10 + Math.PI) * 0.35 * w; arms[1].rotation.x = -1.2;   // right arm holds the gun
        headG.position.y = Math.sin(t * 2) * 0.015;
        bulb.visible = (t % 1.6) < 1.3;
        eyes.forEach(e => e.scale.y = (t % 3.7) < 0.12 ? 0.15 : 1);
      } };
    },

    // Soft round blob with a sprout. Squashes and stretches as it moves.
    mochi(color) {
      const g = new THREE.Group(), mat = std(color, { r: 0.6, m: 0 }), ink = stdK(INK, { r: 0.2 }), white = glowK(0xffffff);
      const bodyG = new THREE.Group(); g.add(bodyG);
      const body = add(bodyG, S(0.6, 32, 22), mat, 0, 0.64); body.scale.set(1, 1.05, 0.95);
      for (const s of [-1, 1]) {
        const e = add(bodyG, S(0.085, 16, 12), ink, s * 0.18, 0.82, 0.52); e.scale.set(0.85, 1.25, 0.5);
        add(bodyG, S(0.028, 8, 6), white, s * 0.18 + 0.025, 0.87, 0.565);
        const b = add(bodyG, S(0.075, 12, 8), stdK(0xff8fa8, { r: 0.8 }), s * 0.33, 0.68, 0.46); b.scale.set(1.2, 0.6, 0.4);
      }
      const mouth = add(bodyG, GEO.Torus(0.045, 0.012, 6, 14, Math.PI), ink, 0, 0.72, 0.565, 0, 0, Math.PI);
      const sprout = new THREE.Group(); sprout.position.y = 1.27; bodyG.add(sprout);
      const leaf = stdK(0x5fc85a, { r: 0.6 });
      add(sprout, C(0.015, 0.02, 0.14, 6), stdK(0x3d8a3a), 0, 0.06);
      for (const s of [-1, 1]) { const l = add(sprout, S(0.08, 12, 8), leaf, s * 0.08, 0.14, 0, 0, 0, s * 0.6); l.scale.set(1.3, 0.35, 0.8); }
      const feet = [-1, 1].map(s => { const f = add(g, S(0.13, 12, 8), std(shade(color, 0.55), { r: 0.6 }), s * 0.22, 0.06, 0.12); f.scale.set(1, 0.5, 1.3); return f; });
      return { group: g, tint: [mat], hitMeshes: [body], headNode: bodyG, hatHide: [sprout], anim(t, w) {
        const sq = Math.sin(t * (3 + w * 4)) * (0.025 + w * 0.02);
        bodyG.scale.set(1 - sq * 0.6, 1 + sq, 1 - sq * 0.6);
        sprout.rotation.z = Math.sin(t * 3) * 0.2;
        feet.forEach((f, i) => f.position.z = 0.12 + Math.sin(t * 9 + i * Math.PI) * 0.08 * w);
        mouth.scale.x = 1 + w * 0.25;
      } };
    },

    // Knight in a great helm with a plume in your color.
    sentinel(color) {
      const g = new THREE.Group(), mat = std(color, { r: 0.55 }), steel = stdK(0xb8bfcc, { r: 0.25, m: 0.85 }), ink = stdK(INK);
      const legs = [-1, 1].map(s => { const p = new THREE.Group(); p.position.set(s * 0.15, 0.32, 0); g.add(p); add(p, B(0.2, 0.32, 0.24), steel, 0, -0.16, 0); return p; });
      const body = add(g, C(0.38, 0.44, 0.66, 8), mat, 0, 0.62);
      add(g, C(0.41, 0.41, 0.08, 16), stdK(0x5a3a22, { r: 0.7 }), 0, 0.44);
      add(g, B(0.09, 0.09, 0.03), stdK(0xe2b33c, { r: 0.3, m: 0.8 }), 0, 0.44, 0.41);
      add(g, B(0.5, 0.36, 0.06), steel, 0, 0.74, 0.34);
      for (const s of [-1, 1]) { const p = add(g, S(0.19, 14, 10), steel, s * 0.42, 0.92, 0); p.scale.set(1, 0.7, 1.1); }
      const helm = add(g, C(0.3, 0.31, 0.42, 20), steel, 0, 1.16);
      add(g, GEO.Sphere(0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, 1.37);
      add(g, B(0.42, 0.05, 0.03), ink, 0, 1.2, 0.3);
      add(g, B(0.05, 0.2, 0.03), ink, 0, 1.1, 0.3);
      const plume = new THREE.Group(); plume.position.y = 1.62; g.add(plume);
      for (let i = 0; i < 6; i++) { const r = 0.12 - i * 0.012, a = i / 5; add(plume, S(r, 10, 8), mat, 0, 0.1 * Math.sin(a * 2.4), -a * 0.42); }
      return { group: g, handMat: steel, tint: [mat], hitMeshes: [body, helm], anim(t, w) {
        legs.forEach((l, i) => l.rotation.x = Math.sin(t * 10 + i * Math.PI) * 0.45 * w);
        plume.rotation.x = Math.sin(t * 2.2) * 0.08 + w * 0.25;
        plume.rotation.z = Math.sin(t * 1.7) * 0.06;
      } };
    },

    // Rubber duck. Waddles.
    quack(color) {
      const g = new THREE.Group(), mat = std(color, { r: 0.3, m: 0.05 }), orange = stdK(0xff9a2a, { r: 0.4 }), ink = stdK(INK);
      const bodyG = new THREE.Group(); g.add(bodyG);
      const body = add(bodyG, S(0.48, 26, 18), mat, 0, 0.55); body.scale.set(1, 0.85, 1.2);
      add(bodyG, GEO.Cone(0.2, 0.38, 14), mat, 0, 0.82, -0.56, -1.0);
      const wings = [-1, 1].map(s => { const wg = add(bodyG, S(0.26, 14, 10), mat, s * 0.46, 0.6, -0.05); wg.scale.set(0.3, 0.65, 1); return wg; });
      const head = add(bodyG, S(0.32, 24, 16), mat, 0, 1.15, 0.14);
      for (const s of [-1, 1]) { add(bodyG, S(0.055, 10, 8), ink, s * 0.15, 1.24, 0.4); add(bodyG, S(0.018, 6, 4), glowK(0xffffff), s * 0.15 + 0.015, 1.26, 0.45); }
      const beak = add(bodyG, S(0.16, 16, 10), orange, 0, 1.08, 0.46); beak.scale.set(1.15, 0.35, 1.1);
      for (let i = -1; i <= 1; i++) add(bodyG, GEO.Cone(0.035, 0.14, 6), mat, i * 0.05, 1.5, 0.1, 0, 0, -i * 0.4);
      const feet = [-1, 1].map(s => add(g, B(0.2, 0.05, 0.26), orange, s * 0.18, 0.03, 0.14));
      return { group: g, tint: [mat], hitMeshes: [body, head], headNode: bodyG, anim(t, w) {
        bodyG.rotation.z = Math.sin(t * 9) * 0.1 * w + Math.sin(t * 1.5) * 0.02;
        wings.forEach((wg, i) => wg.rotation.z = (i ? -1 : 1) * (0.1 + Math.abs(Math.sin(t * 9)) * 0.35 * w));
        feet.forEach((f, i) => f.position.z = 0.14 + Math.sin(t * 9 + i * Math.PI) * 0.1 * w);
      } };
    },

    // Astronaut: white suit, bubble helmet, mirrored visor and backpack in your color.
    astro(color) {
      const g = new THREE.Group(), suit = stdK(0xeef0f4, { r: 0.6 }), mat = std(color, { r: 0.35, m: 0.3 });
      const visorMat = std(color, { r: 0.08, m: 0.95, e: color, ei: 0.15 });
      const legs = [-1, 1].map(s => { const p = new THREE.Group(); p.position.set(s * 0.15, 0.38, 0); g.add(p); add(p, C(0.11, 0.12, 0.3, 12), suit, 0, -0.15, 0); add(p, B(0.22, 0.12, 0.3), mat, 0, -0.32, 0.03); return p; });
      const body = add(g, C(0.36, 0.38, 0.56, 18), suit, 0, 0.64);
      add(g, B(0.3, 0.2, 0.05), mat, 0, 0.7, 0.36);
      for (let i = 0; i < 3; i++) add(g, S(0.025, 6, 4), glowK([0xff5a5a, 0xffd34a, 0x6aff8a][i]), -0.08 + i * 0.08, 0.7, 0.39);
      add(g, B(0.5, 0.58, 0.24), mat, 0, 0.76, -0.38);
      add(g, C(0.015, 0.015, 0.3, 6), stdK(0x8a93a8, { m: 0.8 }), 0.18, 1.18, -0.42);
      for (const s of [-1, 1]) add(g, S(0.14, 12, 10), suit, s * 0.4, 0.86, 0);
      add(g, C(0.3, 0.33, 0.08, 20), stdK(0x9aa0ac, { r: 0.3, m: 0.7 }), 0, 0.95);
      add(g, S(0.24, 16, 12), stdK(0x2a2f3a, { r: 0.8 }), 0, 1.18, -0.03);
      const visor = add(g, GEO.Sphere(0.335, 24, 16, Math.PI / 2 - 0.95, 1.9, 0.85, 1.05), visorMat, 0, 1.2, 0);
      const helm = add(g, S(0.36, 28, 20), stdK(0xdfeaff, { r: 0.05, m: 0.2, t: true, o: 0.28 }), 0, 1.2, 0);
      return { group: g, tint: [mat, visorMat], hitMeshes: [body, helm], anim(t, w) {
        legs.forEach((l, i) => l.rotation.x = Math.sin(t * 7 + i * Math.PI) * 0.4 * w);
        g.position.y = Math.max(0, Math.sin(t * 7)) * 0.04 * w;
        visorMat.emissiveIntensity = 0.12 + Math.sin(t * 1.2) * 0.06;
      } };
    },

    // Translucent slime cube with a dark core and a pixel face. Hops.
    cubert(color) {
      const g = new THREE.Group(), hop = new THREE.Group(); g.add(hop);
      const mat = std(color, { r: 0.15, m: 0, t: true, o: 0.62, e: color, ei: 0.12 });
      const shell = add(hop, B(0.92, 0.92, 0.92), mat, 0, 0.47); shell.castShadow = true;
      add(hop, B(0.42, 0.42, 0.42), std(shade(color, 0.35), { r: 0.6, flat: true }), 0, 0.43, -0.08);
      const ink = stdK(INK, { r: 0.4 });
      const eyes = [-1, 1].map(s => { const e = add(hop, B(0.17, 0.17, 0.02), ink, s * 0.2, 0.63, 0.465); add(hop, B(0.06, 0.06, 0.01), glowK(0xffffff), s * 0.2 + 0.04, 0.67, 0.477); return e; });
      add(hop, B(0.32, 0.08, 0.02), ink, 0, 0.35, 0.465);
      add(hop, B(0.08, 0.08, 0.02), ink, -0.2, 0.41, 0.465); add(hop, B(0.08, 0.08, 0.02), ink, 0.2, 0.41, 0.465);
      return { group: g, tint: [mat], hitMeshes: [shell], headNode: hop, anim(t, w) {
        const ph = (t * 3.2) % 1, up = Math.sin(ph * Math.PI);
        hop.position.y = up * (0.03 + 0.09 * w);
        const sq = ph < 0.12 ? (1 - ph / 0.12) * 0.12 : 0;
        hop.scale.set(1 + sq, 1 - sq - up * 0.02, 1 + sq);
        eyes.forEach(e => e.scale.y = (t % 4.1) < 0.1 ? 0.2 : 1);
      } };
    },

    // Carved tiki totem with glowing eyes and a leaf crown.
    tiki(color) {
      const g = new THREE.Group(), wood = stdK(0x7a4a2a, { r: 0.85, flat: true }), mat = std(color, { r: 0.6, flat: true });
      const body = add(g, C(0.3, 0.38, 1.28, 8), wood, 0, 0.66, 0, 0, Math.PI / 8);
      add(g, B(0.66, 0.1, 0.16), mat, 0, 1.12, 0.26);
      const eyeMat = glow(0xffd34a);   // (animated: stays per model)
      const eyes = [-1, 1].map(s => add(g, B(0.15, 0.12, 0.04), eyeMat, s * 0.15, 1.0, 0.31));
      add(g, B(0.08, 0.2, 0.12), wood, 0, 0.88, 0.33);
      add(g, B(0.42, 0.17, 0.04), stdK(INK), 0, 0.64, 0.32);
      for (let i = 0; i < 4; i++) add(g, B(0.07, 0.06, 0.02), glowK(0xf2ead8), -0.15 + i * 0.1, 0.69, 0.345);
      for (const y of [0.3, 0.42]) add(g, C(0.37, 0.37, 0.05, 8), mat, 0, y, 0, 0, Math.PI / 8);
      const crown = new THREE.Group(); crown.position.y = 1.3; g.add(crown);
      const leaf = stdK(0x4fb04a, { r: 0.6, flat: true, ds: true });
      const fronds = [];
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2, p = new THREE.Group(); p.rotation.y = a; crown.add(p);
        const l = add(p, GEO.Cone(0.08, 0.5, 4), leaf, 0, 0.18, 0.12, 0.7); l.scale.z = 0.3; fronds.push(p);
      }
      return { group: g, handMat: wood, tint: [mat], hitMeshes: [body], hatHide: [crown], anim(t, w) {
        crown.rotation.y = Math.sin(t * 0.8) * 0.15;
        fronds.forEach((f, i) => f.rotation.x = Math.sin(t * 2.5 + i) * 0.08);
        eyeMat.color.setHSL(0.13, 1, 0.55 + Math.sin(t * 3) * 0.12);
        g.rotation.z = Math.sin(t * 8) * 0.05 * w;
        g.position.y = Math.abs(Math.sin(t * 8)) * 0.05 * w;
      } };
    },

    // Mushroom kid: spotted cap in your color.
    shroom(color) {
      const g = new THREE.Group(), cream = stdK(0xf1e6cf, { r: 0.75 }), mat = std(color, { r: 0.5 }), ink = stdK(INK);
      const legs = [-1, 1].map(s => add(g, S(0.11, 10, 8), stdK(0xd9cbb0, { r: 0.8 }), s * 0.15, 0.06, 0.05));
      const stem = add(g, C(0.27, 0.34, 0.78, 22), cream, 0, 0.47);
      for (const s of [-1, 1]) { const e = add(g, S(0.045, 10, 8), ink, s * 0.11, 0.6, 0.29); e.scale.y = 1.4; }
      add(g, GEO.Torus(0.04, 0.01, 6, 12, Math.PI), ink, 0, 0.51, 0.31, 0, 0, Math.PI);
      const capG = new THREE.Group(); capG.position.y = 0.84; g.add(capG);
      const cap = add(capG, GEO.Sphere(0.64, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat); cap.scale.y = 0.72;
      add(capG, C(0.63, 0.5, 0.06, 32), stdK(0xd8c7a6, { r: 0.9 }), 0, -0.02);
      const spot = glowK(0xfbf6ea);
      for (const [th, ph, r] of [[0.15, 0, 0.11], [0.75, 0.6, 0.1], [0.8, 2.2, 0.12], [0.9, 3.7, 0.09], [0.7, 5.0, 0.1], [1.15, 1.4, 0.08], [1.2, 4.3, 0.08]]) {
        const n = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th) * 0.72, Math.sin(th) * Math.sin(ph));
        const p = new THREE.Vector3(Math.sin(th) * Math.cos(ph) * 0.64, Math.cos(th) * 0.64 * 0.72, Math.sin(th) * Math.sin(ph) * 0.64);
        const m = add(capG, GEO.Circle(r, 16), spot, p.x, p.y, p.z); m.lookAt(p.clone().add(n)); m.position.addScaledVector(n.normalize(), 0.006); m.castShadow = false;
      }
      return { group: g, handMat: cream, tint: [mat], hitMeshes: [stem, cap], anim(t, w) {
        capG.rotation.z = Math.sin(t * 2) * 0.05 + Math.sin(t * 10) * 0.06 * w;
        legs.forEach((l, i) => l.position.z = 0.05 + Math.sin(t * 10 + i * Math.PI) * 0.12 * w);
        g.position.y = Math.abs(Math.sin(t * 10)) * 0.04 * w;
      } };
    },

    // Floating crystal with a single eye band and orbiting shards.
    prism(color) {
      const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
      const mat = std(color, { r: 0.12, m: 0.4, flat: true, e: color, ei: 0.25 });
      const gem = add(inner, GEO.Octahedron(0.46, 0), mat, 0, 0.95); gem.scale.set(0.85, 1.35, 0.85);
      add(inner, B(0.36, 0.13, 0.03), stdK(INK, { r: 0.3 }), 0, 1.05, 0.4);   // floating visor plate, clear of the gem
      const eye = add(inner, B(0.22, 0.05, 0.02), glowK(0xffffff), 0, 1.05, 0.425);
      const orbit = new THREE.Group(); orbit.position.y = 0.95; inner.add(orbit);
      const shardMat = std(color, { r: 0.1, m: 0.5, flat: true, e: color, ei: 0.5 });
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; add(orbit, GEO.Tetrahedron(0.09), shardMat, Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62); }
      const base = add(g, GEO.Ring(0.2, 0.32, 24), std(color, { e: color, ei: 0.8, t: true, o: 0.45, ds: true }), 0, 0.02, 0, -Math.PI / 2);
      base.castShadow = false;
      return { group: g, handMat: shardMat, tint: [mat, shardMat], hitMeshes: [gem], headNode: inner, anim(t, w) {
        inner.position.y = 0.06 + Math.sin(t * 2) * 0.06;
        gem.rotation.y = t * 0.6;
        orbit.rotation.y = -t * 1.6; orbit.rotation.x = Math.sin(t) * 0.3;
        inner.rotation.x = w * 0.2;
        eye.scale.x = (t % 3.3) < 0.1 ? 0.1 : 1;
        base.scale.setScalar(1 + Math.sin(t * 2) * 0.1);
      } };
    },
    // Translucent jelly slime with a candy core and googly eyes. Squash-and-stretch, bounces when moving.
    gumdrop(color) {
      const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
      const mat = std(color, { r: 0.15, m: 0, t: true, o: 0.82 });
      const coreMat = std(color, { r: 0.4, m: 0 }); coreMat.color.offsetHSL(0, 0.05, -0.18);
      const shell = add(body, S(0.5, 28, 20), mat, 0, 0.68); shell.scale.set(1, 1.42, 1);
      add(body, GEO.Icosahedron(0.18, 0), coreMat, 0.04, 0.58, -0.04, 0.4, 0.6, 0);
      const bub = stdK(0xffffff, { r: 0.1, m: 0, t: true, o: 0.5 });
      for (const [x, y, z, r] of [[-0.2, 0.32, 0.1, 0.05], [0.18, 0.95, -0.12, 0.04], [0.1, 0.4, -0.2, 0.035]]) add(body, S(r, 8, 6), bub, x, y, z);
      const white = stdK(0xfbfbf6, { r: 0.3 }), black = glowK(0x111111), eyes = [];
      for (const s of [-1, 1]) {
        add(body, S(0.13, 16, 12), white, s * 0.15, 1.12, 0.36);
        eyes.push(add(body, S(0.06, 12, 8), black, s * 0.15, 1.12, 0.48));
      }
      const smile = add(body, GEO.Torus(0.06, 0.015, 6, 14, Math.PI), glowK(0x3a1020), 0, 0.92, 0.45, 0, 0, Math.PI); smile.userData.visor = true;
      const puddle = add(g, C(0.5, 0.56, 0.06, 26), mat, 0, 0.03);
      return { group: g, tint: [mat, coreMat], hitMeshes: [shell], headNode: body, anim(t, w) {
        const q = Math.sin(t * (3.2 + w * 3)) * (0.035 + w * 0.015); body.scale.set(1 + q, 1 - q, 1 + q);
        body.position.y = Math.abs(Math.sin(t * 8)) * 0.035 * w;
        eyes.forEach((e, i) => { e.position.x = (i ? 1 : -1) * 0.15 + Math.sin(t * 1.3) * 0.03; e.position.y = 1.12 + Math.cos(t * 1.7) * 0.02; });
        puddle.scale.set(1 + q * 2, 1, 1 + q * 2);
      } };
    },

    // Stout little knight: great helm with a cross slit, team-color tabard, pauldrons and plume.
    vanguard(color) {
      const g = new THREE.Group(), mat = std(color, { r: 0.38, m: 0.15 }), iron = stdK(0xc3c9d3, { r: 0.35, m: 0.6 }), dark = stdK(0x1d1f26, { r: 0.5 }), leather = stdK(0x5a3b24, { r: 0.7 });
      const legs = [-1, 1].map(s => { const p = new THREE.Group(); p.position.set(s * 0.15, 0.36, 0); g.add(p); add(p, B(0.2, 0.36, 0.24), iron, 0, -0.18, 0); add(p, B(0.22, 0.08, 0.32), iron, 0, -0.32, 0.04); return p; });
      const torso = add(g, C(0.38, 0.42, 0.62, 20), iron, 0, 0.66);
      add(g, B(0.5, 0.66, 0.06), mat, 0, 0.58, 0.39);
      const cloth = stdK(0xf1e6c8, { r: 0.6 });
      add(g, B(0.06, 0.36, 0.065), cloth, 0, 0.64, 0.4); add(g, B(0.26, 0.06, 0.065), cloth, 0, 0.7, 0.4);
      add(g, C(0.43, 0.43, 0.07, 20), leather, 0, 0.42);
      for (const s of [-1, 1]) { const p = add(g, GEO.Sphere(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat, s * 0.4, 0.9, 0); p.scale.set(1.1, 0.8, 1.1); }
      const helm = add(g, C(0.34, 0.36, 0.44, 20), iron, 0, 1.16);
      const dome = add(g, GEO.Sphere(0.34, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), iron, 0, 1.38); dome.scale.y = 0.4;
      const ridge = add(g, B(0.06, 0.08, 0.6), mat, 0, 1.5, 0);
      add(g, GEO.Torus(0.355, 0.025, 6, 24), mat, 0, 0.95, 0, Math.PI / 2);
      const slit = add(g, B(0.42, 0.05, 0.06), dark, 0, 1.2, 0.33); slit.userData.visor = true;
      add(g, B(0.05, 0.22, 0.06), dark, 0, 1.1, 0.34);
      for (let i = 0; i < 3; i++) add(g, S(0.014, 6, 4), dark, -0.1 + i * 0.1, 1.0, 0.35);
      const plume = add(g, GEO.Cone(0.07, 0.4, 8), mat, 0, 1.42, -0.36, -1.9);
      return { group: g, handMat: iron, tint: [mat], hitMeshes: [torso, helm], hatHide: [ridge], anim(t, w) {
        legs.forEach((l, i) => l.rotation.x = Math.sin(t * 9 + i * Math.PI) * 0.45 * w);
        plume.rotation.x = -1.9 + Math.sin(t * 2.4) * 0.12 - w * 0.2;
      } };
    },

    // Hovering hooded phantom: ragged cloak, void face with two ember eyes, an orbiting spark.
    wisp(color) {
      const g = new THREE.Group(), float = new THREE.Group(); g.add(float);
      const mat = std(color, { r: 0.75, m: 0, ds: true });
      const cloakGeo = new THREE.CylinderGeometry(0.26, 0.52, 1.0, 28, 4, true), pos = cloakGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -0.45) { const a = Math.atan2(pos.getZ(i), pos.getX(i)); pos.setY(i, pos.getY(i) + 0.09 * Math.sin(a * 7) - 0.04); }
      cloakGeo.computeVertexNormals();
      const cloak = add(float, cloakGeo, mat, 0, 0.72);
      const hood = add(float, S(0.4, 24, 18), mat, 0, 1.14, -0.03); hood.scale.set(1, 1, 1.05);
      const tip = add(float, GEO.Cone(0.12, 0.3, 10), mat, 0, 1.48, -0.25, -0.9);
      const face = add(float, S(0.31, 20, 14), glowK(0x07060c), 0, 1.11, 0.2); face.scale.set(1, 1.05, 0.8);
      const eyeMat = glowK(0xffc46b), eyes = [];
      for (const s of [-1, 1]) { const e = add(float, S(0.05, 10, 8), eyeMat, s * 0.11, 1.14, 0.44); e.scale.set(1, 0.6, 1); eyes.push(e); }
      eyes[0].userData.visor = true;
      for (const s of [-1, 1]) { const h = add(float, S(0.09, 10, 8), mat, s * 0.42, 0.85, 0.12); h.scale.set(0.8, 1.2, 0.8); }
      const spark = add(g, GEO.Octahedron(0.06, 0), glowK(0xfff2c2), 0.5, 0.9, 0);
      const shadow = add(g, GEO.Circle(0.36, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }), 0, 0.01, 0, -Math.PI / 2);
      shadow.castShadow = false;
      return { group: g, tint: [mat], hitMeshes: [cloak, hood], headNode: float, hatHide: [tip], anim(t, w) {
        float.position.y = 0.08 + Math.sin(t * 1.8) * 0.06;
        float.rotation.x = w * 0.22;
        shadow.scale.setScalar(1 - Math.sin(t * 1.8) * 0.08);
        spark.position.set(Math.cos(t * 1.6) * 0.58, 0.9 + Math.sin(t * 3.2) * 0.15, Math.sin(t * 1.6) * 0.58); spark.rotation.y = t * 4;
        const blink = (t % 4.2) < 0.12 ? 0.1 : 0.6; eyes.forEach(e => (e.scale.y = blink));
      } };
    },

    // Chicken-walker mini mech: bent-back legs, ball cockpit with a wraparound canopy, exhaust stacks.
    strider(color) {
      const g = new THREE.Group(), mat = std(color, { r: 0.38, m: 0.15 }), gun = stdK(0x3a3f4a, { r: 0.45, m: 0.6 }), joint = stdK(0x1a1c22, { r: 0.5, m: 0.4 }), hips = new THREE.Group();
      g.add(hips);
      const legs = [-1, 1].map(s => {   // pivot at the hip, parts placed relative to it
        const p = new THREE.Group(); p.position.set(s * 0.2, 0.64, 0); g.add(p);
        add(p, B(0.2, 0.05, 0.34), joint, 0, -0.615, 0.06);
        add(p, B(0.09, 0.36, 0.09), gun, 0, -0.44, -0.06, -0.35);
        add(p, S(0.07, 10, 8), joint, 0, -0.26, -0.12);
        add(p, B(0.12, 0.34, 0.12), mat, 0, -0.12, -0.02, 0.6);
        return p;
      });
      add(hips, B(0.5, 0.12, 0.3), joint, 0, 0.66);
      const pod = add(hips, S(0.44, 26, 18), mat, 0, 1.06); pod.scale.set(1, 0.95, 1.02);
      const canopy = add(hips, GEO.Sphere(0.45, 26, 12, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.2), stdK(0x1c3550, { r: 0.05, m: 0.6, e: 0x0b2b4a }), 0, 1.06);
      canopy.userData.visor = true;
      add(hips, B(0.3, 0.04, 0.02), glowK(0x7fe7ff), 0, 1.14, 0.44);
      add(hips, C(0.46, 0.46, 0.05, 26), gun, 0, 0.88);
      for (const s of [-1, 1]) add(hips, C(0.045, 0.055, 0.32, 10), gun, s * 0.16, 1.18, -0.38, -0.4);
      const lamp = add(hips, S(0.035, 8, 6), glowK(0xff7a3c), -0.3, 1.36, 0.1);
      return { group: g, handMat: gun, tint: [mat], hitMeshes: [pod], headNode: hips, anim(t, w) {
        legs.forEach((l, i) => l.rotation.x = Math.sin(t * 9 + i * Math.PI) * 0.4 * w);
        hips.position.y = Math.sin(t * 2.2) * 0.015 + Math.abs(Math.sin(t * 9)) * 0.04 * w;
        lamp.visible = (t % 1.4) < 0.7;
      } };
    },

    // Deep-sea diver whose helmet is a glass bowl with a goldfish pilot swimming inside.
    fishbowl(color) {
      const g = new THREE.Group(), mat = std(color, { r: 0.38, m: 0.15 }), brass = stdK(0xc9933a, { r: 0.3, m: 0.85 }), boot = stdK(0x2b2e36, { r: 0.6 });
      const boots = [-1, 1].map(s => add(g, C(0.15, 0.17, 0.2, 12), boot, s * 0.17, 0.1, 0.02));
      const suit = add(g, C(0.36, 0.4, 0.62, 20), mat, 0, 0.5);
      for (const y of [0.33, 0.5, 0.67]) add(g, GEO.Torus(0.385, 0.02, 6, 24), mat, 0, y, 0, Math.PI / 2);
      add(g, C(0.42, 0.38, 0.12, 20), brass, 0, 0.86);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(g, S(0.025, 6, 4), brass, Math.cos(a) * 0.41, 0.9, Math.sin(a) * 0.41); }
      add(g, B(0.3, 0.4, 0.16), brass, 0, 0.56, -0.42);
      const water = add(g, GEO.Sphere(0.3, 18, 12, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.6), stdK(0x5fc6e8, { r: 0.1, m: 0, t: true, o: 0.45 }), 0, 1.2);
      const bowl = add(g, S(0.36, 26, 18), new THREE.MeshStandardMaterial({ color: 0xe6f6ff, roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }), 0, 1.18);
      bowl.castShadow = false; water.castShadow = false;
      add(g, GEO.Torus(0.2, 0.025, 6, 20), brass, 0, 1.5, 0, Math.PI / 2);
      const port = add(g, GEO.Torus(0.16, 0.022, 6, 22), brass, 0, 1.18, 0.34); port.userData.visor = true;
      const fish = new THREE.Group(); fish.position.y = 1.16; g.add(fish);
      const orange = stdK(0xff8a1f, { r: 0.35 });
      const fb = add(fish, S(0.09, 12, 10), orange); fb.scale.set(1.5, 1, 0.7);
      add(fish, GEO.Cone(0.06, 0.1, 6), orange, -0.17, 0, 0, 0, 0, Math.PI / 2);
      add(fish, S(0.018, 6, 4), glowK(0x111111), 0.09, 0.03, 0.05);
      const bubMat = stdK(0xffffff, { r: 0.1, m: 0, t: true, o: 0.6 });
      const bubbles = [0, 1, 2].map(i => add(g, S(0.018 + i * 0.006, 6, 4), bubMat, 0.05, 1.0, 0.05));
      return { group: g, handMat: brass, tint: [mat], hitMeshes: [suit, bowl], anim(t, w) {
        fish.position.set(Math.cos(t * 0.9) * 0.12, 1.16 + Math.sin(t * 1.7) * 0.04, Math.sin(t * 0.9) * 0.12);
        fish.rotation.y = -t * 0.9 - Math.PI / 2;
        bubbles.forEach((b, i) => { const k = (t * 0.5 + i / 3) % 1; b.position.set(0.05 + Math.sin(k * 9 + i) * 0.03, 1.0 + k * 0.4, 0.06); });
        boots.forEach((b, i) => { const s = Math.sin(t * 8 + i * Math.PI); b.position.z = 0.02 + s * 0.13 * w; b.position.y = 0.1 + Math.max(0, s) * 0.06 * w; });
        g.rotation.z = Math.sin(t * 8) * 0.04 * w;
      } };
    },
  };
  return builders;
}


let builders = null;
export function buildBody(id, color) {
  builders ||= makeBuilders();
  return builders[id] ? builders[id](color) : null;
}

// Where cosmetics sit on each body, as targets for the classic model's anchor points:
//   hat  [y, scale, z?]  top of the head          (classic: 1.52)
//   head [y, z, scale]   eye line, front of face  (classic: 1.15, 0.42)
//   neck [y, z, scale]   collar front             (classic: 0.95, 0.42)
//   hip  [y, scale]      crotch / waist           (classic: 0.3)
//   gun  [x, y, z]       gun pivot, so the grip sits in a hand drawn at the body's side (classic: 0.32, 1.0, 0)
// A scale can be [x, y, z] for non-round bodies.
export const BODY_FIT = {
  bolt:     { hat: [1.46, 0.8], head: [1.26, 0.28, [0.8, 0.8, 0.65]], neck: [0.93, 0.25, [0.85, 0.8, 0.6]], hip: [0.36, [0.85, 0.7, 0.62]], gun: [0.43, 0.84, 0.29] },
  mochi:    { hat: [1.27, 1.15], head: [0.84, 0.56, 1], neck: [0.5, 0.56, [1.35, 1, 1.3]], hip: [0.2, 1.1], gun: [0.5, 0.67, 0.24] },
  sentinel: { hat: [1.66, 0.75], head: [1.18, 0.32, 0.74], neck: [0.92, 0.36, [0.9, 0.9, 0.85]], hip: [0.32, 0.9], gun: [0.42, 0.84, 0.19] },
  quack:    { hat: [1.47, 0.76, 0.14], head: [1.24, 0.47, 0.76], neck: [0.86, 0.39, [0.72, 0.8, 0.72]], hip: [0.3, [1, 1, 1.25]], gun: [0.5, 0.74, 0.14] },
  astro:    { hat: [1.56, 0.86], head: [1.2, 0.37, 0.86], neck: [0.95, 0.36, 0.85], hip: [0.38, [0.8, 1, 0.8]], gun: [0.42, 0.88, 0.14] },
  cubert:   { hat: [0.93, 1], head: [0.63, 0.47, 1], neck: [0.22, 0.5, [1.2, 1, 1.2]], hip: [0.18, 1], gun: [0.52, 0.57, 0.14] },
  tiki:     { hat: [1.3, 0.75], head: [1.0, 0.34, 0.75], neck: [0.5, 0.36, [0.82, 0.8, 0.82]], hip: [0.25, 0.85], gun: [0.4, 0.82, 0.14] },
  shroom:   { hat: [1.36, 1.1], head: [0.6, 0.31, 0.62], neck: [0.4, 0.33, [0.75, 0.8, 0.75]], hip: [0.15, 0.75], gun: [0.36, 0.57, 0.14] },
  prism:    { hat: [1.57, 0.6], head: [1.05, 0.44, 0.62], neck: [0.78, 0.27, [0.65, 0.8, 0.65]], hip: [0.45, 0.6], gun: [0.46, 1.02, 0.14] },
  gumdrop:  { hat: [1.39, 0.85], head: [1.12, 0.5, 0.95], neck: [0.8, 0.5, [1.15, 0.9, 1.15]], hip: [0.25, 1.05], gun: [0.5, 0.82, 0.14] },
  vanguard: { hat: [1.53, 0.85], head: [1.2, 0.37, 0.85], neck: [0.92, 0.42, [0.95, 0.9, 0.95]], hip: [0.36, 0.95], gun: [0.44, 0.84, 0.2] },
  wisp:     { hat: [1.52, 0.95], head: [1.14, 0.46, 0.9], neck: [0.92, 0.36, 0.8], hip: [0.35, 1], gun: [0.44, 0.92, 0.19] },
  strider:  { hat: [1.48, 1], head: [1.12, 0.46, 1], neck: [0.84, 0.46, [1.05, 0.9, 1.05]], hip: [0.6, 0.7], gun: [0.48, 1.07, 0.09] },
  fishbowl: { hat: [1.5, 0.8], head: [1.18, 0.38, 0.86], neck: [0.9, 0.43, 1], hip: [0.3, 0.9], gun: [0.44, 0.72, 0.09] },
};
