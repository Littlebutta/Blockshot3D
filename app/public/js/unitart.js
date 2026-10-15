// v1.2.5: the AMON unit models (also the AMON raiders in Core Defense) rebuilt with real detail, in the same chunky,
// faceted style as the Brute and the Critter: proper limbs and joints, faces with eyes, armour plates, gear that
// reads at a glance. Every model still faces +x, stands about 1 m tall (fliers centred on y = 0), and returns the
// same animated parts as before (halo, wl/wr wings, tank turret/barrel, caster orb). Static parts are merged into
// one mesh per look in big AMON battles (amonui.js bakedUnit), so the extra pieces cost vertices, not draw calls.
import * as THREE from '/vendor/three/build/three.module.js';

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  tcyl: new THREE.CylinderGeometry(0.5, 0.38, 1, 10),          // tapered (wide top): torsos, thighs
  cone: new THREE.ConeGeometry(0.5, 1, 8),
  sph: new THREE.SphereGeometry(0.5, 12, 8),
  lsph: new THREE.SphereGeometry(0.5, 6, 4),                    // small bits (eyes, joints, knuckles)
  dome: new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  ico: new THREE.IcosahedronGeometry(0.5, 1),
  oct: new THREE.OctahedronGeometry(0.5, 0),
  ring: new THREE.TorusGeometry(0.5, 0.07, 6, 22),
  half: new THREE.TorusGeometry(0.5, 0.08, 6, 16, Math.PI),
};
const mats = new Map();
const M = (color, emissive = 0) => {
  const k = color + ':' + emissive;
  if (!mats.has(k)) mats.set(k, new THREE.MeshLambertMaterial({ color, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive }));
  return mats.get(k);
};
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
const mix = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
function P(g, shape, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, em = 0) {
  const m = new THREE.Mesh(G[shape], M(color, em));
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz);
  g.add(m); return m;
}
// a limb from point a to point b (cylinder of radius r), plus a ball joint at a
function limb(g, color, a, b, r, joint = true, shape = 'cyl') {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1e-3;
  const m = new THREE.Mesh(G[shape], M(color));
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); m.scale.set(r * 2, len, r * 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  g.add(m);
  if (joint) P(g, 'lsph', color, a[0], a[1], a[2], r * 2.3, r * 2.3, r * 2.3);
  return m;
}
const eyes = (g, x, y, w, s, color = '#ffe066', em = 1) => { for (const z of [-w, w]) P(g, 'lsph', color, x, y, z, s, s, s, 0, 0, 0, em); };

const BUGS = new Set(['swarm', 'spitter', 'roach', 'lurker', 'critters', 'broodling', 'crawler', 'crawlers', 'leech', 'voidling']);

// --------------------------------------------------------------------------- shapes
function humanoid(g, o) {
  const { c, dk, lt, acc, skin, gear } = o, b = o.bulk || 1, boot = shade(dk, 0.7), metal = '#a8b0bc';
  for (const z of [-0.12 * b, 0.12 * b]) {   // legs: thigh, knee, shin, boot
    limb(g, dk, [0, 0.5, z], [0.04, 0.27, z], 0.075 * b);
    limb(g, dk, [0.04, 0.27, z], [0, 0.08, z], 0.065 * b);
    P(g, 'box', boot, 0.05, 0.05, z, 0.24, 0.1, 0.15 * b);
    P(g, 'box', lt, 0.08, 0.3, z, 0.06, 0.1, 0.12 * b);   // knee pad
  }
  P(g, 'cyl', shade(dk, 0.8), 0, 0.52, 0, 0.34 * b, 0.1, 0.44 * b);   // hips
  P(g, 'box', acc, 0.01, 0.56, 0, 0.36 * b, 0.07, 0.46 * b);         // belt in the side's color
  P(g, 'box', '#d8c070', 0.19 * b, 0.56, 0, 0.02, 0.06, 0.08);        // buckle
  P(g, 'tcyl', c, 0, 0.76, 0, 0.4 * b, 0.36, 0.5 * b);                // torso
  P(g, 'box', lt, 0.13 * b, 0.78, 0, 0.12, 0.24, 0.3 * b);            // chest plate
  P(g, 'box', acc, 0.02, 0.8, 0, 0.42 * b, 0.05, 0.52 * b, 0.5, 0, 0); // sash
  for (const s of [-1, 1]) {   // shoulders and arms (both reach forward to the weapon)
    const sz = s * 0.29 * b;
    P(g, 'sph', lt, 0, 0.92, sz, 0.2 * b, 0.16, 0.2 * b);
    limb(g, c, [0, 0.9, sz], [0.1, 0.72, sz * 0.95], 0.06 * b);
    limb(g, c, [0.1, 0.72, sz * 0.95], [0.28, 0.72, s * 0.12], 0.055 * b);
    P(g, 'lsph', skin, 0.3, 0.72, s * 0.11, 0.1, 0.1, 0.1);
  }
  P(g, 'cyl', skin, 0, 0.99, 0, 0.1, 0.08, 0.1);                       // neck
  P(g, 'sph', skin, 0.01, 1.1, 0, 0.26, 0.26, 0.24);                   // head
  P(g, 'box', '#1a1a20', 0.13, 1.12, -0.05, 0.02, 0.035, 0.04); P(g, 'box', '#1a1a20', 0.13, 1.12, 0.05, 0.02, 0.035, 0.04);   // eyes
  // headgear
  if (o.helm === 'hood') { P(g, 'cone', c, -0.02, 1.2, 0, 0.32, 0.34, 0.32, 0, 0, 0.25); }
  else if (o.helm === 'skull') { P(g, 'box', '#1a1a20', 0.13, 1.06, 0, 0.02, 0.03, 0.1); }
  else if (o.helm === 'horned') { P(g, 'dome', metal, 0, 1.14, 0, 0.3, 0.26, 0.28); for (const z of [-1, 1]) P(g, 'cone', '#ece4cc', -0.01, 1.26, z * 0.15, 0.06, 0.22, 0.06, z * 0.7, 0, 0); }
  else { P(g, 'dome', o.helmC || dk, 0, 1.14, 0, 0.3, 0.26, 0.29); P(g, 'box', o.helmC || dk, 0.11, 1.16, 0, 0.1, 0.03, 0.28); }   // helmet with a brim
  // gear
  const hx = 0.32, hy = 0.72;
  switch (gear) {
    case 'pike': P(g, 'cyl', '#8a6a40', hx, 0.85, 0.12, 0.04, 1.5, 0.04, 0, 0, -0.35); P(g, 'cone', metal, hx + 0.27, 1.58, 0.12, 0.08, 0.2, 0.05, 0, 0, -0.35); break;
    case 'bow': P(g, 'half', '#6a4a2a', hx + 0.04, 0.8, -0.12, 0.6, 0.7, 0.6, 0, Math.PI / 2, -Math.PI / 2); P(g, 'cyl', '#e8e0c8', hx + 0.04, 0.8, -0.12, 0.01, 0.58, 0.01); P(g, 'cyl', '#7a5a3a', -0.16, 0.86, 0.1, 0.12, 0.34, 0.12, 0.3, 0, 0.3); break;
    case 'shield':
      P(g, 'box', metal, 0.3, 0.68, -0.3, 0.06, 0.56, 0.4); P(g, 'box', acc, 0.335, 0.68, -0.3, 0.02, 0.4, 0.08); P(g, 'lsph', '#d8c070', 0.34, 0.7, -0.3, 0.08, 0.08, 0.08);
      P(g, 'box', metal, 0.4, 0.75, 0.14, 0.42, 0.04, 0.06); P(g, 'box', '#6a4a2a', 0.18, 0.75, 0.14, 0.1, 0.05, 0.14); break;   // sword
    case 'cross':
      P(g, 'box', '#f4f4f4', 0.14 * b, 0.78, 0, 0.13, 0.26, 0.32 * b); P(g, 'box', '#e03030', 0.21 * b, 0.78, 0, 0.01, 0.18, 0.06); P(g, 'box', '#e03030', 0.21 * b, 0.78, 0, 0.01, 0.06, 0.18);
      P(g, 'box', '#e8e8e8', -0.2, 0.74, 0, 0.14, 0.26, 0.3); P(g, 'box', '#e03030', -0.275, 0.74, 0, 0.01, 0.12, 0.04); break;   // med pack
    case 'tank':
      for (const z of [-0.09, 0.09]) { P(g, 'cyl', '#c05a2a', -0.24, 0.8, z, 0.14, 0.4, 0.14); P(g, 'dome', '#c05a2a', -0.24, 1.0, z, 0.14, 0.08, 0.14); }
      P(g, 'cyl', '#3a3a3a', hx + 0.08, hy, 0.1, 0.07, 0.36, 0.07, 0, 0, Math.PI / 2); P(g, 'cone', '#ff8a2a', hx + 0.3, hy, 0.1, 0.07, 0.12, 0.07, 0, 0, -Math.PI / 2, 0.9); break;
    case 'tube':
      P(g, 'cyl', '#3a4a3a', 0.04, 1.02, 0.2, 0.13, 0.86, 0.13, 0, 0, Math.PI / 2); P(g, 'cyl', '#222', 0.48, 1.02, 0.2, 0.15, 0.06, 0.15, 0, 0, Math.PI / 2);
      P(g, 'box', '#2a2a2a', 0.1, 0.94, 0.2, 0.08, 0.1, 0.05); P(g, 'cone', '#c03030', 0.53, 1.02, 0.2, 0.09, 0.12, 0.09, 0, 0, -Math.PI / 2); break;
    case 'heavy':
      for (const z of [-1, 1]) P(g, 'box', dk, 0, 0.98, z * 0.33 * b, 0.34, 0.12, 0.2, z * 0.3, 0, 0);
      P(g, 'cyl', '#3a3a40', hx + 0.06, hy, 0.12, 0.16, 0.3, 0.16, 0, 0, Math.PI / 2);
      for (let k = 0; k < 4; k++) P(g, 'cyl', '#222', hx + 0.28, hy + Math.cos(k * 1.57) * 0.04, 0.12 + Math.sin(k * 1.57) * 0.04, 0.03, 0.22, 0.03, 0, 0, Math.PI / 2); break;
    case 'wrench':
      P(g, 'cyl', '#c0c0c0', hx + 0.02, 0.8, -0.14, 0.04, 0.42, 0.04, 0, 0, -0.4); P(g, 'half', '#c0c0c0', hx + 0.12, 1.02, -0.14, 0.18, 0.18, 0.18, 0, 0, 0.6);
      P(g, 'box', '#ffd23a', -0.2, 0.74, 0, 0.14, 0.24, 0.32); P(g, 'box', '#e8e8e8', 0.2, 1.24, 0, 0.12, 0.05, 0.26); break;   // tool pack, goggles
    case 'axe':
      P(g, 'cyl', '#6a4a2a', hx + 0.04, 0.9, 0.13, 0.045, 0.7, 0.045, 0, 0, -0.25); P(g, 'box', metal, hx + 0.16, 1.18, 0.13, 0.26, 0.22, 0.04, 0, 0, -0.25);
      P(g, 'box', shade(metal, 0.7), hx + 0.27, 1.16, 0.13, 0.05, 0.24, 0.05, 0, 0, -0.25); break;
    default:   // rifle
      P(g, 'box', '#2a2a30', hx + 0.08, hy, 0.12, 0.42, 0.08, 0.07); P(g, 'cyl', '#1a1a1e', hx + 0.36, hy + 0.01, 0.12, 0.035, 0.22, 0.035, 0, 0, Math.PI / 2);
      P(g, 'box', '#2a2a30', hx + 0.04, hy - 0.08, 0.12, 0.06, 0.12, 0.05); P(g, 'box', '#5a3a22', hx - 0.12, hy - 0.03, 0.12, 0.14, 0.09, 0.06);
      P(g, 'box', '#3a3a40', -0.2, 0.76, 0, 0.12, 0.26, 0.3);   // backpack
  }
}
function bug(g, o) {   // insect: segmented carapace, six legs, mandibles, glowing eyes
  const { c, dk, lt, acc } = o;
  P(g, 'sph', c, -0.28, 0.42, 0, 0.62, 0.4, 0.52);      // abdomen
  for (let k = 0; k < 3; k++) P(g, 'box', lt, -0.28 - k * 0.1 + 0.1, 0.6 + (k === 1 ? 0.02 : 0), 0, 0.06, 0.04, 0.4 - k * 0.04);   // plates
  P(g, 'sph', dk, 0.1, 0.42, 0, 0.36, 0.3, 0.36);        // thorax
  P(g, 'sph', c, 0.34, 0.4, 0, 0.28, 0.24, 0.3);         // head
  eyes(g, 0.44, 0.47, 0.08, 0.07, '#ff3a1a');
  for (const s of [-1, 1]) {
    P(g, 'cone', '#e8dcc0', 0.52, 0.32, s * 0.07, 0.05, 0.18, 0.05, s * 0.5, 0, -1.9);   // mandibles
    P(g, 'cyl', dk, 0.42, 0.62, s * 0.06, 0.015, 0.26, 0.015, s * 0.5, 0, -0.4);         // feelers
    for (let k = -1; k <= 1; k++) {
      const x = 0.1 + k * 0.15, knee = [x + k * 0.05, 0.5, s * 0.36], foot = [x + k * 0.12, 0.02, s * 0.5];
      limb(g, dk, [x, 0.4, s * 0.12], knee, 0.03); limb(g, dk, knee, foot, 0.025);
    }
  }
  P(g, 'cone', acc, -0.6, 0.42, 0, 0.12, 0.22, 0.12, 0, 0, Math.PI / 2, 0.4);   // stinger in the side's color
}
function beast(g, o) {   // four-legged hunter: chest, haunches, snout, ears, tail, claws
  const { c, dk, lt, acc } = o;
  P(g, 'sph', c, 0.08, 0.52, 0, 0.62, 0.42, 0.42); P(g, 'sph', c, -0.25, 0.5, 0, 0.42, 0.38, 0.38);
  P(g, 'sph', lt, 0.16, 0.42, 0, 0.36, 0.28, 0.32);                     // belly / chest
  P(g, 'box', acc, 0.05, 0.69, 0, 0.36, 0.04, 0.3);                      // saddle cloth / marking
  limb(g, c, [0.3, 0.62, 0], [0.42, 0.74, 0], 0.1, false);               // neck
  P(g, 'sph', c, 0.48, 0.78, 0, 0.3, 0.26, 0.26);                        // head
  P(g, 'box', lt, 0.64, 0.72, 0, 0.18, 0.12, 0.14);                      // snout
  P(g, 'lsph', '#1a1414', 0.73, 0.75, 0, 0.06, 0.05, 0.06);              // nose
  for (const z of [-1, 1]) P(g, 'cone', '#f0e8d0', 0.69, 0.66, z * 0.04, 0.03, 0.07, 0.03, 0, 0, Math.PI);   // fangs
  eyes(g, 0.6, 0.83, 0.08, 0.06, '#ffd23a');
  for (const z of [-1, 1]) P(g, 'cone', dk, 0.44, 0.97, z * 0.09, 0.08, 0.16, 0.06, z * 0.3, 0, 0.2);   // ears
  for (const [x, z] of [[0.26, 0.15], [0.26, -0.15], [-0.32, 0.15], [-0.32, -0.15]]) {
    const knee = [x + (x > 0 ? 0.04 : -0.06), 0.24, z];
    limb(g, c, [x, 0.46, z], knee, 0.06); limb(g, dk, knee, [x + 0.02, 0.04, z], 0.045);
    P(g, 'box', dk, x + 0.05, 0.03, z, 0.12, 0.06, 0.09);
    P(g, 'cone', '#f0e8d0', x + 0.12, 0.03, z, 0.02, 0.05, 0.02, 0, 0, -Math.PI / 2);
  }
  limb(g, c, [-0.42, 0.56, 0], [-0.62, 0.72, 0], 0.045, false); P(g, 'cone', dk, -0.66, 0.76, 0, 0.07, 0.16, 0.07, 0, 0, 0.9);   // tail
  for (let k = 0; k < 3; k++) P(g, 'cone', dk, 0.1 - k * 0.16, 0.76 - k * 0.02, 0, 0.06, 0.14, 0.04);   // back ridge
}
function blob(g, o) {
  const { c, lt, acc } = o, skirt = mix(c, '#1d2a16', 0.4);
  P(g, 'ico', c, 0, 0.44, 0, 0.92, 0.72, 0.9);
  P(g, 'cyl', skirt, 0, 0.08, 0, 0.9, 0.16, 0.9);
  for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; P(g, 'box', skirt, Math.cos(a) * 0.44, 0.06, Math.sin(a) * 0.44, 0.1, 0.14 + (k % 2) * 0.08, 0.1, 0, -a, 0); }
  P(g, 'oct', acc, 0, 0.45, 0, 0.24, 0.24, 0.24, 0, 0, 0, 0.7);        // core
  for (const z of [-1, 1]) {
    P(g, 'lsph', '#f2ffe8', 0.38, 0.6, z * 0.15, 0.16, 0.16, 0.14); P(g, 'lsph', '#0c180a', 0.45, 0.6, z * 0.15, 0.07, 0.08, 0.07);
    P(g, 'box', '#0c180a', 0.38, 0.72, z * 0.15, 0.03, 0.03, 0.14, z * 0.35, 0, 0);
  }
  P(g, 'half', '#0c180a', 0.44, 0.42, 0, 0.16, 0.16, 0.16, 0, Math.PI / 2, 0);
  for (const [x, y, z, r] of [[-0.1, 0.84, 0.1, 0.1], [0.12, 0.82, -0.14, 0.07], [-0.2, 0.76, -0.1, 0.06]]) P(g, 'ico', lt, x, y, z, r, r, r);
}
function horse(g, o, coat, mane) {
  P(g, 'sph', coat, 0, 0.6, 0, 0.8, 0.38, 0.38);
  limb(g, coat, [0.32, 0.66, 0], [0.48, 0.9, 0], 0.09, false);
  P(g, 'box', coat, 0.58, 0.94, 0, 0.3, 0.14, 0.16, 0, 0, -0.35); P(g, 'lsph', '#1a1414', 0.7, 0.88, 0, 0.06, 0.06, 0.1);
  for (const z of [-1, 1]) P(g, 'cone', coat, 0.48, 1.04, z * 0.05, 0.04, 0.1, 0.04);
  P(g, 'box', mane, 0.4, 0.86, 0, 0.26, 0.08, 0.05, 0, 0, -0.9);
  for (const [x, z] of [[0.26, 0.12], [0.26, -0.12], [-0.28, 0.12], [-0.28, -0.12]]) {
    limb(g, coat, [x, 0.5, z], [x + 0.02, 0.24, z], 0.05); limb(g, shade(coat, 0.8), [x + 0.02, 0.24, z], [x, 0.04, z], 0.04);
    P(g, 'cyl', '#222', x, 0.03, z, 0.09, 0.05, 0.09);
  }
  limb(g, mane, [-0.38, 0.66, 0], [-0.54, 0.42, 0], 0.05, false);
}
function cav(g, o) {
  const { c, dk, acc, gear } = o;
  horse(g, o, '#6a4a30', '#2a1a10');
  P(g, 'box', acc, 0, 0.8, 0, 0.36, 0.06, 0.44);   // saddle blanket
  const r = new THREE.Group(); r.position.set(-0.04, 0.42, 0); r.scale.setScalar(0.78); g.add(r);
  humanoid(r, { ...o, gear: 'none', helm: gear === 'lance' ? 'horned' : 'hood' });
  if (gear === 'lance') { P(g, 'cyl', '#d0c090', 0.62, 1.06, 0.18, 0.05, 1.6, 0.05, 0, 0, -1.35); P(g, 'cone', '#c0c8d4', 1.4, 1.24, 0.18, 0.08, 0.2, 0.08, 0, 0, -1.35); P(g, 'box', acc, 0.3, 1.0, 0.18, 0.18, 0.1, 0.01); }
  else { P(g, 'box', '#2a2a30', 0.42, 1.0, 0.12, 0.36, 0.07, 0.06); }
  void c; void dk;
}
function drone(g, o) {
  const { c, dk, lt, acc } = o;
  P(g, 'sph', c, 0, 0, 0, 0.42, 0.24, 0.42); P(g, 'dome', lt, 0, 0.06, 0, 0.3, 0.16, 0.3);
  P(g, 'ring', acc, 0, 0, 0, 0.5, 0.5, 0.5, Math.PI / 2, 0, 0, 0.5);
  P(g, 'sph', '#101418', 0.19, -0.02, 0, 0.12, 0.12, 0.12); P(g, 'lsph', acc, 0.24, -0.02, 0, 0.06, 0.06, 0.06, 0, 0, 0, 1);   // camera eye
  for (const [x, z] of [[0.3, 0.3], [0.3, -0.3], [-0.3, 0.3], [-0.3, -0.3]]) {
    limb(g, dk, [x * 0.4, 0, z * 0.4], [x, 0.05, z], 0.025, false);
    P(g, 'cyl', dk, x, 0.06, z, 0.06, 0.06, 0.06); P(g, 'cyl', '#c8d4e0', x, 0.1, z, 0.3, 0.01, 0.3); P(g, 'box', '#c8d4e0', x, 0.105, z, 0.32, 0.012, 0.04, 0, 0.5, 0);
  }
  P(g, 'cyl', dk, -0.08, 0.2, 0, 0.012, 0.18, 0.012); P(g, 'lsph', '#ff3a3a', -0.08, 0.3, 0, 0.04, 0.04, 0.04, 0, 0, 0, 1);
  P(g, 'box', dk, 0.02, -0.16, 0, 0.12, 0.08, 0.06);
}
function wyrm(g, o, parts) {   // dragon: neck, horned head, tail segments, flapping wings
  const { c, dk, lt, acc } = o;
  P(g, 'sph', c, 0, 0, 0, 0.7, 0.32, 0.36); P(g, 'sph', lt, 0.04, -0.07, 0, 0.6, 0.18, 0.28);
  limb(g, c, [0.26, 0.04, 0], [0.5, 0.18, 0], 0.08, false);
  P(g, 'sph', c, 0.58, 0.2, 0, 0.26, 0.18, 0.18); P(g, 'box', c, 0.72, 0.17, 0, 0.18, 0.08, 0.12);
  eyes(g, 0.64, 0.25, 0.07, 0.05, '#ffe066');
  for (const z of [-1, 1]) P(g, 'cone', '#ece4cc', 0.52, 0.32, z * 0.06, 0.04, 0.18, 0.04, z * 0.3, 0, 0.9);
  let px = -0.3, py = 0, r = 0.11;
  for (let k = 0; k < 4; k++) { const nx = px - 0.16, ny = py + (k % 2 ? 0.03 : -0.03); limb(g, c, [px, py, 0], [nx, ny, 0], r, k > 0); px = nx; py = ny; r *= 0.75; }
  P(g, 'cone', acc, px - 0.06, py, 0, 0.1, 0.14, 0.03, 0, 0, Math.PI / 2, 0.4);
  for (let k = 0; k < 4; k++) P(g, 'cone', dk, 0.2 - k * 0.14, 0.15, 0, 0.05, 0.1, 0.03);
  for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(0.04, 0.08, s * 0.12); g.add(w);
    limb(w, dk, [0, 0, 0], [0.06, 0.14, s * 0.4], 0.03, false); limb(w, dk, [0.06, 0.14, s * 0.4], [-0.14, 0.05, s * 0.78], 0.025, false);
    P(w, 'box', mix(c, dk, 0.5), -0.12, 0.05, s * 0.4, 0.44, 0.02, 0.62, 0, 0, 0); P(w, 'box', acc, -0.04, 0.062, s * 0.42, 0.2, 0.012, 0.14);
    parts[s < 0 ? 'wl' : 'wr'] = w;
  }
}
function jet(g, o) {   // fighter: fuselage, canopy, swept wings, twin fins, engine glow
  const { c, dk, lt, acc } = o;
  P(g, 'cyl', c, 0, 0, 0, 0.2, 1.0, 0.22, 0, 0, Math.PI / 2); P(g, 'cone', lt, 0.62, 0, 0, 0.2, 0.3, 0.22, 0, 0, -Math.PI / 2);
  P(g, 'dome', '#8fd8ff', 0.22, 0.07, 0, 0.26, 0.14, 0.14, 0, 0, 0, 0.3);
  for (const s of [-1, 1]) {
    P(g, 'box', dk, -0.06, -0.02, s * 0.4, 0.36, 0.035, 0.62, 0, s * 0.35, 0); P(g, 'box', acc, 0.05, -0.0, s * 0.62, 0.12, 0.04, 0.1, 0, s * 0.35, 0);
    P(g, 'box', dk, -0.4, 0.14, s * 0.1, 0.18, 0.2, 0.025, s * 0.2, 0, 0.4);
    P(g, 'cyl', '#2a2a30', 0.12, -0.08, s * 0.32, 0.05, 0.3, 0.05, 0, 0, Math.PI / 2);   // missiles
  }
  P(g, 'cyl', '#2a2a30', -0.5, 0, 0, 0.18, 0.06, 0.18, 0, 0, Math.PI / 2); P(g, 'cone', '#ffa040', -0.6, 0, 0, 0.13, 0.16, 0.13, 0, 0, Math.PI / 2, 1);
}
function ship(g, o, disc) {
  const { c, dk, lt, acc } = o;
  if (disc) {
    P(g, 'sph', c, 0, 0, 0, 1.8, 0.3, 1.8); P(g, 'dome', '#9fe8ff', 0, 0.1, 0, 0.8, 0.36, 0.8, 0, 0, 0, 0.3);
    P(g, 'ring', acc, 0, -0.02, 0, 1.8, 1.8, 1.8, Math.PI / 2, 0, 0, 0.6); P(g, 'ring', dk, 0, 0.06, 0, 1.3, 1.3, 1.3, Math.PI / 2);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; P(g, 'lsph', k % 2 ? acc : '#ffffff', Math.cos(a) * 0.72, -0.08, Math.sin(a) * 0.72, 0.1, 0.06, 0.1, 0, 0, 0, 1); }
    P(g, 'cyl', dk, 0, -0.16, 0, 0.5, 0.1, 0.5); P(g, 'cone', acc, 0, -0.26, 0, 0.2, 0.14, 0.2, Math.PI, 0, 0, 0.8);
    return;
  }
  P(g, 'box', c, 0, 0, 0, 1.4, 0.3, 0.5); P(g, 'cone', lt, 0.86, 0, 0, 0.36, 0.34, 0.36, 0, 0, -Math.PI / 2);
  P(g, 'box', lt, -0.2, 0.22, 0, 0.5, 0.16, 0.3); P(g, 'box', '#8fd8ff', 0.02, 0.26, 0, 0.06, 0.08, 0.26, 0, 0, 0, 0.4);   // bridge
  for (const s of [-1, 1]) {
    P(g, 'box', dk, -0.1, -0.02, s * 0.36, 1.1, 0.14, 0.2);
    P(g, 'cyl', '#2a2a30', -0.66, 0, s * 0.22, 0.16, 0.2, 0.16, 0, 0, Math.PI / 2); P(g, 'cone', '#7fd0ff', -0.78, 0, s * 0.22, 0.12, 0.14, 0.12, 0, 0, Math.PI / 2, 1);
    for (const x of [0.3, -0.2]) { P(g, 'cyl', '#2a2a30', x, 0.18, s * 0.18, 0.08, 0.06, 0.08); P(g, 'cyl', '#1a1a1e', x + 0.1, 0.2, s * 0.18, 0.025, 0.2, 0.025, 0, 0, Math.PI / 2); }
  }
  P(g, 'box', acc, -0.6, 0.12, 0, 0.18, 0.3, 0.04, 0, 0, 0, 0.5);
  for (let k = 0; k < 5; k++) P(g, 'lsph', '#ffe8a0', 0.5 - k * 0.22, 0.02, 0.255, 0.04, 0.04, 0.02, 0, 0, 0, 1);
}
function zeppelin(g, o) {
  const { c, dk, acc } = o;
  P(g, 'sph', c, 0, 0.22, 0, 1.9, 0.72, 0.72);
  for (const x of [-0.4, 0, 0.4]) P(g, 'ring', dk, x, 0.22, 0, 0.72 - Math.abs(x) * 0.4, 0.72 - Math.abs(x) * 0.4, 0.5, 0, Math.PI / 2, 0);
  P(g, 'box', acc, 0, 0.22, 0, 1.6, 0.06, 0.74);
  for (const [ry, rx] of [[0, 0], [0, Math.PI / 2]]) P(g, 'box', dk, -0.86, 0.22, 0, 0.3, 0.5, 0.03, rx, ry, 0);
  P(g, 'box', dk, 0.05, -0.22, 0, 0.6, 0.18, 0.24); P(g, 'box', '#ffe8a0', 0.05, -0.2, 0, 0.5, 0.05, 0.25, 0, 0, 0, 0.8);
  for (const s of [-1, 1]) { P(g, 'cyl', '#2a2a30', -0.2, -0.12, s * 0.34, 0.1, 0.18, 0.1, 0, 0, Math.PI / 2); P(g, 'box', '#c8d4e0', -0.31, -0.12, s * 0.34, 0.01, 0.3, 0.05, 0.6, 0, 0); }
  P(g, 'cyl', '#1a1a1e', 0.3, -0.3, 0, 0.05, 0.3, 0.05, 0, 0, Math.PI / 2);
}
function tank(g, o, parts) {
  const { c, dk, lt, acc, gear } = o, tr = '#2a2a2e';
  for (const z of [-0.33, 0.33]) {
    P(g, 'box', tr, 0, 0.15, z, 1.04, 0.28, 0.2);
    for (let k = 0; k < 4; k++) P(g, 'cyl', '#4a4a50', -0.36 + k * 0.24, 0.14, z + Math.sign(z) * 0.01, 0.2, 0.22, 0.2, Math.PI / 2);
    P(g, 'box', dk, 0, 0.3, z, 1.1, 0.06, 0.24);   // track skirt
  }
  P(g, 'box', c, 0, 0.36, 0, 0.98, 0.22, 0.54); P(g, 'box', lt, 0.42, 0.33, 0, 0.16, 0.16, 0.5, 0, 0, 0.5);   // hull, sloped front
  P(g, 'box', acc, -0.1, 0.48, 0, 0.6, 0.02, 0.5);
  P(g, 'box', '#3a3a40', -0.44, 0.44, 0.16, 0.12, 0.14, 0.12);   // exhaust
  parts.turret = new THREE.Group(); parts.turret.position.set(-0.05, 0.6, 0); g.add(parts.turret);
  P(parts.turret, 'cyl', lt, 0, 0, 0, 0.5, 0.2, 0.46); P(parts.turret, 'box', c, 0.12, 0.01, 0, 0.3, 0.16, 0.36);
  P(parts.turret, 'dome', dk, -0.08, 0.1, 0.1, 0.16, 0.1, 0.16); P(parts.turret, 'cyl', '#2a2a30', -0.08, 0.16, -0.12, 0.012, 0.3, 0.012);
  P(parts.turret, 'box', acc, -0.22, 0.02, 0, 0.04, 0.12, 0.3, 0, 0, 0, 0.4);
  parts.barrel = new THREE.Group(); parts.turret.add(parts.barrel);
  const bar = z => { P(parts.barrel, 'cyl', dk, 0.5, 0, z, 0.08, 0.7, 0.08, 0, 0, Math.PI / 2); P(parts.barrel, 'cyl', '#1a1a1e', 0.86, 0, z, 0.11, 0.1, 0.11, 0, 0, Math.PI / 2); };
  if (gear === 'twin') { bar(0.09); bar(-0.09); } else bar(0);
}
function walker(g, o) {   // mech: reverse-jointed legs, cockpit, visor, weapon pods
  const { c, dk, lt, acc } = o;
  for (const z of [0.24, -0.24]) {
    const hip = [0, 0.66, z], knee = [-0.14, 0.38, z], foot = [0.02, 0.06, z];
    limb(g, dk, hip, knee, 0.07); limb(g, dk, knee, foot, 0.06);
    P(g, 'box', shade(dk, 0.8), 0.06, 0.04, z, 0.34, 0.08, 0.2); P(g, 'box', shade(dk, 0.8), -0.12, 0.04, z, 0.12, 0.06, 0.14);
    P(g, 'cyl', '#4a4a50', -0.06, 0.52, z, 0.06, 0.24, 0.06, 0, 0, 0.6);   // piston
  }
  P(g, 'box', c, 0, 0.86, 0, 0.6, 0.38, 0.62); P(g, 'box', lt, 0.24, 0.9, 0, 0.16, 0.3, 0.5, 0, 0, -0.3);
  P(g, 'box', acc, 0.32, 0.96, 0, 0.03, 0.08, 0.36, 0, 0, -0.3, 0.8);   // visor
  P(g, 'box', dk, -0.2, 1.06, 0, 0.2, 0.1, 0.4);
  for (const s of [-1, 1]) {
    P(g, 'box', dk, 0.05, 0.92, s * 0.42, 0.36, 0.2, 0.18);
    for (const dy of [0.04, -0.04]) P(g, 'cyl', lt, 0.32, 0.92 + dy, s * 0.42, 0.05, 0.3, 0.05, 0, 0, Math.PI / 2);
    P(g, 'box', '#2a2a30', -0.02, 1.08, s * 0.3, 0.2, 0.12, 0.12); P(g, 'cyl', '#c03030', 0.1, 1.08, s * 0.3, 0.06, 0.04, 0.06, 0, 0, Math.PI / 2, 0.5);   // rocket racks
  }
}
function artillery(g, o, parts) {
  const { c, dk, acc } = o, wood = '#5a3e26';
  for (const z of [0.3, -0.3]) {
    P(g, 'ring', '#3a2a1a', 0, 0.22, z, 0.44, 0.44, 0.8);
    for (let k = 0; k < 4; k++) P(g, 'box', wood, 0, 0.22, z, 0.03, 0.4, 0.03, 0, 0, k * Math.PI / 4);
    P(g, 'cyl', '#7a7a80', 0, 0.22, z, 0.08, 0.06, 0.08, Math.PI / 2);
  }
  P(g, 'cyl', '#5a5a60', 0, 0.22, 0, 0.04, 0.6, 0.04, Math.PI / 2);   // axle
  P(g, 'box', wood, -0.2, 0.26, 0, 0.7, 0.1, 0.24, 0, 0, 0.12); P(g, 'box', wood, -0.52, 0.12, 0, 0.12, 0.18, 0.3);   // trail
  parts.barrel = new THREE.Group(); parts.barrel.position.set(0.04, 0.4, 0); parts.barrel.rotation.z = 0.55; g.add(parts.barrel);
  P(parts.barrel, 'cyl', dk, 0.24, 0, 0, 0.16, 0.66, 0.16, 0, 0, -Math.PI / 2); P(parts.barrel, 'cyl', c, 0.56, 0, 0, 0.2, 0.08, 0.2, 0, 0, -Math.PI / 2);
  P(parts.barrel, 'sph', dk, -0.06, 0, 0, 0.22, 0.22, 0.22); P(parts.barrel, 'ring', acc, 0.36, 0, 0, 0.18, 0.18, 0.4, 0, Math.PI / 2, 0, 0.3);
  P(g, 'box', '#6a4a2a', -0.3, 0.1, 0.34, 0.2, 0.14, 0.14); for (let k = 0; k < 2; k++) P(g, 'sph', '#2a2a2e', -0.36 + k * 0.1, 0.2, 0.34, 0.08, 0.08, 0.08);   // shell crate
}
function caster(g, o, parts) {   // robed mage: hood with glowing eyes, sleeves, sash, staff with a floating orb
  const { c, dk, lt, acc } = o;
  P(g, 'cone', c, 0, 0.42, 0, 0.62, 0.84, 0.62); P(g, 'cyl', dk, 0, 0.06, 0, 0.62, 0.1, 0.62);
  P(g, 'cone', lt, 0.08, 0.42, 0, 0.3, 0.76, 0.2);      // robe front panel
  P(g, 'box', acc, 0.02, 0.6, 0, 0.36, 0.05, 0.38, 0, 0, 0.1);
  P(g, 'sph', c, 0, 0.84, 0, 0.42, 0.28, 0.46);          // shoulders / cape
  P(g, 'sph', dk, 0.02, 1.0, 0, 0.3, 0.3, 0.3); P(g, 'cone', c, -0.04, 1.14, 0, 0.36, 0.42, 0.36, 0, 0, 0.35);   // hood
  P(g, 'sph', '#0c0c12', 0.1, 1.0, 0, 0.18, 0.2, 0.22); eyes(g, 0.18, 1.02, 0.05, 0.05, acc);
  for (const s of [-1, 1]) { limb(g, c, [0, 0.84, s * 0.22], [0.2, 0.7, s * 0.22], 0.08, false); P(g, 'cone', c, 0.24, 0.68, s * 0.22, 0.14, 0.12, 0.14, 0, 0, -1.6); P(g, 'lsph', '#ffe2c4', 0.3, 0.68, s * 0.22, 0.08, 0.08, 0.08); }
  P(g, 'cyl', '#6a4a2a', 0.3, 0.62, 0.22, 0.035, 1.24, 0.035); P(g, 'half', '#c0a050', 0.3, 1.26, 0.22, 0.16, 0.16, 0.16, 0, 0, 0);
  parts.orb = P(g, 'sph', acc, 0.3, 1.32, 0.22, 0.16, 0.16, 0.16, 0, 0, 0, 0.9);
  for (let k = 0; k < 3; k++) P(g, 'lsph', '#f0e8c0', 0.12, 0.42 - k * 0.12, 0, 0.04, 0.04, 0.04);
}
function giant(g, o, parts, def) {   // hulking brute: hunched torso, belly, small head, horns, huge fists
  const { c, dk, lt, acc, gear } = o, horn = '#ece4cc';
  for (const z of [-0.22, 0.22]) { limb(g, dk, [0, 0.5, z], [0.04, 0.22, z], 0.13); limb(g, dk, [0.04, 0.22, z], [0, 0.06, z], 0.12); P(g, 'box', shade(dk, 0.7), 0.06, 0.05, z, 0.3, 0.1, 0.24); }
  P(g, 'box', shade(dk, 0.8), 0, 0.56, 0, 0.5, 0.14, 0.62); P(g, 'box', acc, 0.26, 0.5, 0, 0.04, 0.22, 0.22);   // loincloth in the side's color
  P(g, 'sph', c, 0, 0.92, 0, 0.74, 0.7, 0.86, 0, 0, -0.18);           // torso
  P(g, 'sph', lt, 0.2, 0.78, 0, 0.42, 0.44, 0.58);                     // belly / chest
  P(g, 'sph', c, -0.06, 1.18, 0, 0.5, 0.36, 0.7);                      // hunch
  P(g, 'sph', c, 0.3, 1.24, 0, 0.32, 0.28, 0.3); P(g, 'box', dk, 0.44, 1.18, 0, 0.1, 0.1, 0.22);   // head and jaw
  P(g, 'box', '#1a1414', 0.43, 1.31, 0, 0.04, 0.03, 0.22);             // brow
  eyes(g, 0.45, 1.27, 0.07, 0.05, '#ff3a1a');
  if (gear === 'tusks') for (const z of [-1, 1]) P(g, 'cone', horn, 0.52, 1.14, z * 0.1, 0.05, 0.26, 0.05, z * 0.2, 0, -2.3);
  else for (const z of [-1, 1]) P(g, 'cone', horn, 0.24, 1.42, z * 0.14, 0.07, 0.24, 0.07, z * 0.6, 0, -0.3);
  for (const s of [-1, 1]) {
    const sh = [0.02, 1.12, s * 0.42], el = [0.16, 0.8, s * 0.5], hand = [0.3, 0.5, s * 0.46];
    P(g, 'sph', dk, sh[0], sh[1], sh[2], 0.32, 0.26, 0.3);
    limb(g, c, sh, el, 0.1); limb(g, c, el, hand, 0.09);
    P(g, 'box', dk, hand[0], hand[1], hand[2], 0.24, 0.22, 0.22); for (let k = -1; k <= 1; k++) P(g, 'lsph', dk, hand[0] + 0.12, hand[1] + 0.06, hand[2] + k * 0.07, 0.07, 0.07, 0.07);
    P(g, 'box', '#6a6a70', el[0], el[1] - 0.06, el[2], 0.16, 0.08, 0.16);   // bracer
  }
  for (let k = 0; k < 3; k++) P(g, 'cone', dk, -0.24 - k * 0.04, 1.26 - k * 0.12, 0, 0.08, 0.18, 0.08, 0, 0, 1.2);   // back spikes
  if (gear === 'axe') { P(g, 'cyl', '#6a4a2a', 0.36, 0.8, -0.46, 0.06, 0.9, 0.06, 0, 0, -0.3); P(g, 'box', '#9aa2ae', 0.5, 1.22, -0.46, 0.36, 0.3, 0.05, 0, 0, -0.3); }
  if (gear === 'flame') { for (let k = 0; k < 3; k++) P(g, 'cone', k === 1 ? '#ffd040' : '#ff6a1a', 0.08 + (k - 1) * 0.12, 1.5 + (k === 1 ? 0.06 : 0), (k - 1) * 0.1, 0.18, 0.36, 0.18, 0, 0, 0, 1); }
  if (def.look.shape === 'boss') {
    if (gear === 'crown') { P(g, 'cyl', '#ffd23a', 0.3, 1.42, 0, 0.3, 0.1, 0.3, 0, 0, 0, 0.4); for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; P(g, 'cone', '#ffd23a', 0.3 + Math.cos(a) * 0.13, 1.52, Math.sin(a) * 0.13, 0.06, 0.14, 0.06, 0, 0, 0, 0.4); } }
    else P(g, 'cone', '#ffd23a', 0.3, 1.5, 0, 0.26, 0.26, 0.26, 0, 0, 0, 0.6);
    P(g, 'box', acc, -0.2, 0.9, 0, 0.06, 0.8, 0.9, 0, 0, 0.1);   // cape
    parts.halo = P(g, 'half', acc, 0, 0.05, 0, 1.6, 1.6, 1.6, Math.PI / 2, 0, 0, 0.8);
  }
}
function orb(g, o, parts) {
  const { c, lt, acc } = o;
  P(g, 'ico', c, 0, 0.62, 0, 0.62, 0.62, 0.62, 0, 0, 0, 0.6);
  P(g, 'sph', lt, 0, 0.62, 0, 0.36, 0.36, 0.36, 0, 0, 0, 1);
  P(g, 'ring', acc, 0, 0.62, 0, 0.9, 0.9, 0.9, 0.4, 0, 0.3, 0.6);
  for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; P(g, 'oct', lt, Math.cos(a) * 0.5, 0.62 + Math.sin(a * 2) * 0.12, Math.sin(a) * 0.5, 0.1, 0.18, 0.1, 0, a, 0, 0.8); }
  eyes(g, 0.28, 0.68, 0.09, 0.08, '#ffffff');
  parts.halo = P(g, 'half', acc, 0, 0.62, 0, 1.2, 1.2, 1.2, Math.PI / 2, 0, 0, 0.6);
}

// Builds a unit into group g. Returns the animated parts.
export function drawUnit(g, def, accent) {
  const c = def.look.color, gear = def.look.gear, parts = {};
  const o = { c, dk: shade(c, 0.6), lt: shade(c, 1.25), acc: accent, gear, skin: mix(c, '#e8c8a8', 0.55) };
  switch (def.look.shape) {
    case 'infantry': humanoid(g, { ...o, helm: def.id.startsWith('skel') || def.id === 'skeleton' ? 'skull' : gear === 'axe' ? 'horned' : gear === 'bow' || gear === 'pike' ? 'hood' : 'helmet', bulk: gear === 'heavy' || gear === 'shield' ? 1.12 : 1 }); break;
    case 'beast': (BUGS.has(def.id) ? bug : beast)(g, o); break;
    case 'blob': blob(g, o); break;
    case 'cav': cav(g, o); break;
    case 'drone': drone(g, o); break;
    case 'air': if (gear === 'wings') wyrm(g, o, parts); else jet(g, o); break;
    case 'ship': ship(g, o, gear === 'disc'); break;
    case 'zeppelin': zeppelin(g, o); break;
    case 'tank': tank(g, o, parts); break;
    case 'walker': walker(g, o); break;
    case 'artillery': artillery(g, o, parts); break;
    case 'caster': caster(g, o, parts); break;
    case 'giant': case 'boss': giant(g, o, parts, def); break;
    case 'orb': default: orb(g, o, parts);
  }
  g.traverse(m => { if (m.isMesh) m.castShadow = true; });
  return parts;
}
