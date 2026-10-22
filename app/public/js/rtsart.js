// =====================================================================
// RTS mode (v1.2.27): everything that is drawn. Blocky unit and building models (merged into one geometry per
// color group, drawn instanced so a few hundred units are a few dozen draw calls), the terraced terrain with
// its cliffs, trees and rocks, crystal fields and vents, and the fog of war (a texture every material reads).
// =====================================================================
import * as THREE from '/vendor/three/build/three.module.js';
import { CELL, LEVEL_H, ROCK as ROCK_LV, hillAt, fbm, resCells } from './rtsmap.js';
import { UNITS, BUILDINGS } from './rtsdata.js';

// ---------------------------------------------------------------- fog of war (shared by every world material)
export const FOW = { tex: null, data: null, size: 1, H: 0, N: 1 };
export function makeFow(M) {
  const N = M.N, data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { data[i * 4] = 18; data[i * 4 + 3] = 255; }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  FOW.tex = tex; FOW.data = data; FOW.size = M.size; FOW.H = M.H; FOW.N = N;
  FOW.uni.fowTex.value = tex; FOW.uni.fowH.value = M.H; FOW.uni.fowSize.value = M.size; FOW.uni.fowTexel.value = 1 / N;
  return FOW;
}
FOW.uni = { fowTex: { value: null }, fowH: { value: 0 }, fowSize: { value: 1 }, fowOn: { value: 1 }, fowTexel: { value: 1 / 128 } };
// patch a material so it is darkened outside your vision (explored = dim, never seen = nearly black)
export function fowMat(mat) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, FOW.uni);
    sh.vertexShader = 'varying vec2 vFowUv;\nuniform float fowH;\nuniform float fowSize;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fowWp = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        fowWp = instanceMatrix * fowWp;
      #endif
      fowWp = modelMatrix * fowWp;
      vFowUv = ( fowWp.xz + fowH ) / fowSize;`);
    // v1.2.28 (Devin: less blocky): the fog is read through a soft 9-tap blur (about one 2 m cell each way) and eased,
    // so its edge is a smooth round fade instead of the stepped outline of the vision cells
    sh.fragmentShader = 'varying vec2 vFowUv;\nuniform sampler2D fowTex;\nuniform float fowOn;\nuniform float fowTexel;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      float fo = fowTexel * 0.85;
      float fowS = texture2D( fowTex, vFowUv ).r * 0.25
        + ( texture2D( fowTex, vFowUv + vec2( fo, 0.0 ) ).r + texture2D( fowTex, vFowUv - vec2( fo, 0.0 ) ).r + texture2D( fowTex, vFowUv + vec2( 0.0, fo ) ).r + texture2D( fowTex, vFowUv - vec2( 0.0, fo ) ).r ) * 0.125
        + ( texture2D( fowTex, vFowUv + vec2( fo, fo ) ).r + texture2D( fowTex, vFowUv - vec2( fo, fo ) ).r + texture2D( fowTex, vFowUv + vec2( fo, -fo ) ).r + texture2D( fowTex, vFowUv - vec2( fo, -fo ) ).r ) * 0.0625;
      float fowK = mix( 1.0, fowS, fowOn );
      gl_FragColor.rgb *= fowK;`);
  };
  mat.customProgramCacheKey = () => 'rtsfow';
  return mat;
}

// ---------------------------------------------------------------- model parts
// [shape, color ('T' = the owner's color, 'D' = a darker owner color), x, y, z, sx, sy, sz, ry, group]
// group: 0 body, 1 turret (turns toward its target). Models face +x and stand on y = 0.
const P = (s, c, x, y, z, sx, sy, sz, ry = 0, g = 0) => [s, c, x, y, z, sx, sy, sz, ry, g];
const SKIN = '#e0b48c', DARK = '#2a2e36', STEEL = '#8a9098', GUN = '#30343c', GLASS = '#9fd8ff';
const infantry = (body, extra = [], helmet = 'T') => [
  P('box', DARK, 0, 0.22, -0.11, 0.16, 0.44, 0.15), P('box', DARK, 0, 0.22, 0.11, 0.16, 0.44, 0.15),   // legs
  P('box', body, 0, 0.66, 0, 0.3, 0.46, 0.46), P('box', 'T', 0.02, 0.72, 0, 0.32, 0.18, 0.48),            // torso + team band
  P('box', SKIN, 0.02, 1.0, 0, 0.24, 0.22, 0.24), P('box', helmet, 0.02, 1.12, 0, 0.3, 0.12, 0.3),
  P('box', GLASS, 0.14, 1.0, 0, 0.04, 0.08, 0.2), ...extra,
];
export const UNIT_LOOK = {
  rigger: { s: 1, parts: infantry('#d8a03a', [P('box', '#c08030', -0.24, 0.72, 0, 0.18, 0.4, 0.34), P('box', STEEL, 0.26, 0.6, 0.18, 0.4, 0.08, 0.08), P('box', STEEL, 0.44, 0.6, 0.18, 0.08, 0.18, 0.14)], '#f0d040') },
  trooper: { s: 1, parts: infantry('#56606e', [P('box', GUN, 0.32, 0.68, 0.17, 0.56, 0.1, 0.08), P('box', GUN, 0.2, 0.6, 0.17, 0.1, 0.14, 0.06), P('box', 'D', -0.2, 0.74, 0, 0.12, 0.34, 0.38)]) },
  lancer: { s: 1.18, parts: infantry('#44505e', [P('cyl', '#5a6a4a', 0.05, 1.04, 0.24, 0.13, 0.9, 0.13, 0, 0), P('box', 'T', -0.2, 0.76, 0, 0.16, 0.42, 0.44), P('box', STEEL, 0.06, 0.92, 0, 0.36, 0.1, 0.56)]) },
  medic: { s: 1, parts: infantry('#e8ecf0', [P('box', '#d23a3a', 0.16, 0.7, 0, 0.02, 0.16, 0.06), P('box', '#d23a3a', 0.16, 0.7, 0, 0.02, 0.06, 0.16), P('box', '#c8ccd2', -0.22, 0.7, 0, 0.16, 0.34, 0.34)], '#f4f6f8') },
  vaulter: { s: 1, parts: infantry('#3a4a5a', [P('box', STEEL, -0.24, 0.76, -0.1, 0.16, 0.4, 0.12), P('box', STEEL, -0.24, 0.76, 0.1, 0.16, 0.4, 0.12), P('box', '#ff9a3a', -0.26, 0.5, 0, 0.1, 0.1, 0.3), P('box', GUN, 0.26, 0.62, 0.2, 0.3, 0.08, 0.06), P('box', GUN, 0.26, 0.62, -0.2, 0.3, 0.08, 0.06)]) },
  strider: { s: 1, parts: [
    P('box', '#4a5058', 0, 0.42, 0, 1.5, 0.3, 0.8), P('box', 'T', 0.15, 0.62, 0, 0.9, 0.14, 0.7), P('box', GLASS, 0.32, 0.78, 0, 0.3, 0.2, 0.5),
    P('cyl', DARK, 0.5, 0.26, 0.44, 0.52, 0.18, 0.52, 0, 0), P('cyl', DARK, -0.5, 0.26, 0.44, 0.52, 0.18, 0.52), P('cyl', DARK, 0.5, 0.26, -0.44, 0.52, 0.18, 0.52), P('cyl', DARK, -0.5, 0.26, -0.44, 0.52, 0.18, 0.52),
    P('box', GUN, 0.8, 0.6, 0, 0.4, 0.12, 0.12), P('box', '#ff7a2a', 1.0, 0.6, 0, 0.06, 0.14, 0.14), P('box', '#c04a2a', -0.5, 0.72, 0, 0.3, 0.3, 0.5)] },
  crawler: { s: 1, parts: [
    P('box', DARK, 0, 0.3, 0.62, 1.9, 0.5, 0.36), P('box', DARK, 0, 0.3, -0.62, 1.9, 0.5, 0.36), P('box', '#5c6650', 0, 0.62, 0, 1.8, 0.4, 1.1), P('box', 'T', -0.6, 0.66, 0, 0.36, 0.34, 1.14),
    P('box', '#6a7460', 0, 0.98, 0, 0.9, 0.38, 0.8, 0, 1), P('box', 'T', -0.1, 1.2, 0, 0.5, 0.08, 0.6, 0, 1), P('box', GUN, 0.95, 0.98, 0, 1.2, 0.14, 0.14, 0, 1), P('box', GUN, 1.5, 0.98, 0, 0.16, 0.2, 0.2, 0, 1)] },
  hornet: { s: 1, parts: [
    P('box', '#9aa4b0', 0, 0, 0, 1.7, 0.3, 0.34), P('box', GLASS, 0.45, 0.16, 0, 0.4, 0.14, 0.24), P('box', '#9aa4b0', -0.1, 0, 0, 0.6, 0.06, 1.9), P('box', 'T', -0.1, 0.035, 0.75, 0.5, 0.06, 0.4), P('box', 'T', -0.1, 0.035, -0.75, 0.5, 0.06, 0.4),
    P('box', '#9aa4b0', -0.75, 0.26, 0, 0.36, 0.44, 0.06), P('box', '#ff9a3a', -0.88, 0, 0, 0.06, 0.18, 0.2), P('box', GUN, 0.1, -0.12, 0.5, 0.5, 0.08, 0.08), P('box', GUN, 0.1, -0.12, -0.5, 0.5, 0.08, 0.08)] },
  spotter: { s: 1, parts: [
    P('cyl', '#c8d0d8', 0, 0, 0, 0.6, 0.18, 0.6), P('box', 'T', 0, 0.12, 0, 0.3, 0.1, 0.3), P('sph', '#ff4a4a', 0.28, -0.04, 0, 0.14, 0.14, 0.14),
    P('box', STEEL, 0, 0.04, 0, 1.3, 0.04, 0.08), P('box', STEEL, 0, 0.04, 0, 0.08, 0.04, 1.3), P('cyl', DARK, 0.62, 0.08, 0, 0.36, 0.02, 0.36), P('cyl', DARK, -0.62, 0.08, 0, 0.36, 0.02, 0.36), P('cyl', DARK, 0, 0.08, 0.62, 0.36, 0.02, 0.36), P('cyl', DARK, 0, 0.08, -0.62, 0.36, 0.02, 0.36)] },
  gunship: { s: 1, parts: [
    P('box', '#58664a', 0, 0, 0, 1.9, 0.6, 0.7), P('box', GLASS, 0.85, 0.08, 0, 0.3, 0.34, 0.5), P('box', '#58664a', -1.2, 0.12, 0, 1.2, 0.22, 0.22), P('box', 'T', -1.75, 0.3, 0, 0.3, 0.44, 0.06),
    P('box', 'T', 0, 0.32, 0, 0.8, 0.06, 0.72), P('cyl', '#3a3e44', 0, 0.42, 0, 2.6, 0.03, 2.6), P('box', GUN, 0.6, -0.36, 0.3, 0.6, 0.12, 0.12), P('box', GUN, 0.6, -0.36, -0.3, 0.6, 0.12, 0.12), P('box', '#58664a', 0, -0.2, 0, 0.3, 0.1, 1.4)] },
};
// v1.2.32 the Hive: chitin bugs (legs are thin boxes splayed out to the sides)
const CHIT = '#3a2a48', CHIT2 = '#5a3e6a', BELLY = '#8a7a5a', ACID = '#9aff4a', EYE = '#ffde4a';
const legs = (n, len, y, w, spread = 0.9) => { const o = []; for (let i = 0; i < n; i++) { const x = (i / Math.max(1, n - 1) - 0.5) * spread; o.push(P('box', CHIT, x, y, w, 0.07, 0.07, len, 0.25 * (i - (n - 1) / 2)), P('box', CHIT, x, y, -w, 0.07, 0.07, len, -0.25 * (i - (n - 1) / 2))); } return o; };
Object.assign(UNIT_LOOK, {
  mite: { s: 1, parts: [P('sph', CHIT2, 0, 0.42, 0, 0.7, 0.42, 0.56), P('sph', 'T', -0.12, 0.56, 0, 0.42, 0.18, 0.46), P('sph', BELLY, 0.36, 0.42, 0, 0.32, 0.3, 0.32), P('box', EYE, 0.5, 0.48, 0.08, 0.06, 0.06, 0.06), P('box', EYE, 0.5, 0.48, -0.08, 0.06, 0.06, 0.06),
    P('box', '#c8b080', 0.6, 0.36, 0.1, 0.24, 0.05, 0.05, 0.4), P('box', '#c8b080', 0.6, 0.36, -0.1, 0.24, 0.05, 0.05, -0.4), ...legs(3, 0.5, 0.2, 0.3, 0.5)] },
  skitter: { s: 1, parts: [P('sph', CHIT, 0, 0.32, 0, 0.66, 0.3, 0.4), P('box', 'T', -0.05, 0.44, 0, 0.36, 0.08, 0.3), P('cone', CHIT2, 0.42, 0.32, 0, 0.18, 0.4, 0.18, 0), P('box', EYE, 0.36, 0.4, 0.08, 0.05, 0.05, 0.05), P('box', EYE, 0.36, 0.4, -0.08, 0.05, 0.05, 0.05),
    P('box', '#e8e0c8', 0.52, 0.28, 0.08, 0.2, 0.04, 0.04, 0.5), P('box', '#e8e0c8', 0.52, 0.28, -0.08, 0.2, 0.04, 0.04, -0.5), ...legs(3, 0.46, 0.16, 0.24, 0.4)] },
  spitter: { s: 1, parts: [P('sph', CHIT2, -0.1, 0.42, 0, 0.8, 0.44, 0.5), P('sph', ACID, -0.4, 0.54, 0, 0.42, 0.38, 0.4), P('box', 'T', 0, 0.6, 0, 0.4, 0.08, 0.36), P('sph', CHIT, 0.34, 0.5, 0, 0.32, 0.3, 0.3), P('cyl', ACID, 0.5, 0.56, 0, 0.12, 0.2, 0.12),
    P('box', EYE, 0.44, 0.58, 0.1, 0.05, 0.05, 0.05), P('box', EYE, 0.44, 0.58, -0.1, 0.05, 0.05, 0.05), ...legs(3, 0.52, 0.2, 0.28, 0.5)] },
  ravager: { s: 1, parts: [P('sph', CHIT, 0, 0.62, 0, 1.4, 0.7, 0.9), P('sph', 'T', -0.1, 0.86, 0, 1.0, 0.24, 0.7), P('box', CHIT2, -0.6, 1.1, 0, 0.16, 0.6, 0.16, 0, 1), P('sph', ACID, -0.6, 1.45, 0, 0.34, 0.34, 0.34, 0, 1), P('cone', CHIT2, 0.75, 0.62, 0, 0.3, 0.5, 0.3),
    P('box', EYE, 0.62, 0.74, 0.14, 0.06, 0.06, 0.06), P('box', EYE, 0.62, 0.74, -0.14, 0.06, 0.06, 0.06), ...legs(3, 0.8, 0.3, 0.42, 0.9)] },
  crusher: { s: 1, parts: [P('sph', '#2e3a30', 0, 0.8, 0, 1.9, 1.0, 1.3), P('sph', 'T', -0.2, 1.12, 0, 1.4, 0.36, 1.0), P('sph', '#3e4a3a', 0.85, 0.72, 0, 0.62, 0.58, 0.7), P('cone', '#e8e0c8', 1.3, 0.95, 0, 0.26, 0.8, 0.26), P('cone', '#e8e0c8', 1.05, 1.1, 0.26, 0.12, 0.4, 0.12), P('cone', '#e8e0c8', 1.05, 1.1, -0.26, 0.12, 0.4, 0.12),
    P('box', EYE, 1.08, 0.82, 0.24, 0.07, 0.07, 0.07), P('box', EYE, 1.08, 0.82, -0.24, 0.07, 0.07, 0.07), ...legs(3, 1.0, 0.36, 0.56, 1.2)] },
  wasp: { s: 1, parts: [P('sph', '#e0b030', 0, 0, 0, 0.8, 0.34, 0.34), P('sph', CHIT, -0.42, -0.04, 0, 0.6, 0.3, 0.3), P('box', CHIT, -0.24, 0, 0, 0.1, 0.36, 0.36), P('box', 'T', 0.05, 0.15, 0, 0.3, 0.06, 0.3), P('cone', CHIT, -0.8, -0.04, 0, 0.1, 0.3, 0.1),
    P('box', '#d8f0ff', 0, 0.22, 0.5, 0.5, 0.02, 0.7, 0.3), P('box', '#d8f0ff', 0, 0.22, -0.5, 0.5, 0.02, 0.7, -0.3), P('box', EYE, 0.36, 0.06, 0.1, 0.08, 0.08, 0.08), P('box', EYE, 0.36, 0.06, -0.1, 0.08, 0.08, 0.08)] },
});
export const UNIT_AIR_H = 6;
const BOX = (c, x, y, z, sx, sy, sz, g = 0) => P('box', c, x, y, z, sx, sy, sz, 0, g);
export const BUILD_LOOK = {
  hub: [BOX('#7c848e', 0, 0.3, 0, 7.6, 0.6, 7.6), BOX('#9aa2ac', 0, 1.9, 0, 6, 2.6, 6), BOX('T', 0, 3.3, 0, 6.2, 0.3, 6.2), BOX('#b6bec8', 0.8, 4.2, 0.8, 2.4, 1.6, 2.4), BOX(GLASS, 2.02, 4.3, 0.8, 0.06, 0.6, 1.8),
    P('cyl', STEEL, -2, 5, -2, 0.2, 3, 0.2), P('sph', '#ff4a4a', -2, 6.6, -2, 0.3, 0.3, 0.3), BOX('#5c646e', 3.05, 1.3, 0, 0.2, 2, 2.6), BOX('T', -2.2, 3.7, 2.2, 1, 0.5, 1), BOX('#c8a040', 3.3, 0.62, 0, 1, 0.04, 3)],
  depot: [BOX('#8a7a5a', -0.7, 0.75, -0.7, 1.6, 1.5, 1.6), BOX('#9a8a6a', 0.8, 0.6, -0.6, 1.4, 1.2, 1.6), BOX('#7a6a4a', 0, 0.55, 0.9, 3.2, 1.1, 1.2), BOX('T', -0.7, 1.55, -0.7, 1.6, 0.12, 1.6), BOX('T', 0, 1.15, 0.9, 3.2, 0.1, 1.2), BOX(STEEL, 0.8, 1.25, -0.6, 0.2, 0.1, 1.6)],
  refinery: [BOX('#6a7078', 0, 0.3, 0, 3.6, 0.6, 3.6), P('cyl', '#9aa2ac', -0.7, 1.6, -0.7, 1.5, 2.4, 1.5), P('cyl', '#9aa2ac', 0.8, 1.2, 0.7, 1.2, 1.6, 1.2), P('cyl', 'T', -0.7, 2.2, -0.7, 1.56, 0.2, 1.56),
    P('cyl', '#5aff9a', -0.7, 2.86, -0.7, 0.5, 0.2, 0.5), BOX(STEEL, 0.1, 1.6, 0, 1.6, 0.16, 0.16), BOX('T', 1.3, 0.9, -1, 0.6, 1.2, 0.6)],
  reclaimer: [BOX('#5a6458', 0, 0.35, 0, 3.6, 0.7, 3.6), P('cyl', '#7a8a6a', 0, 1.4, 0, 2.4, 1.6, 2.4), P('cyl', 'T', 0, 2.25, 0, 2.5, 0.16, 2.5), P('cyl', '#9aff6a', 0, 2.5, 0, 1, 0.4, 1), BOX(STEEL, 1.5, 1, 1.2, 0.6, 1.4, 0.6), BOX(STEEL, -1.5, 1, -1.2, 0.6, 1.4, 0.6)],
  barracks: [BOX('#6e7680', 0, 0.3, 0, 5.6, 0.6, 5.6), BOX('#8a929c', 0, 1.6, 0, 5, 2.2, 4.6), BOX('#5a626c', 0, 2.95, 0, 5.2, 0.5, 4.8), BOX('T', 0, 3.3, 0, 3.6, 0.3, 3.4), BOX(DARK, 2.52, 1.2, 0, 0.1, 1.6, 1.8),
    BOX('T', 2.6, 2.2, 1.6, 0.06, 1, 0.7), BOX('T', 2.6, 2.2, -1.6, 0.06, 1, 0.7), P('cyl', STEEL, -1.8, 3.8, -1.6, 0.3, 1.4, 0.3)],
  sentry: [BOX('#6a7078', 0, 0.3, 0, 1.8, 0.6, 1.8), P('cyl', '#8a929c', 0, 1.6, 0, 0.7, 2.2, 0.7), BOX('T', 0, 2.8, 0, 1.1, 0.5, 1.1, 1), BOX(GUN, 0.75, 2.85, 0.18, 0.9, 0.12, 0.12, 1), BOX(GUN, 0.75, 2.85, -0.18, 0.9, 0.12, 0.12, 1), BOX('#ff5a5a', 0.56, 3.0, 0, 0.06, 0.14, 0.3, 1)],
  archive: [BOX('#6a6e80', 0, 0.3, 0, 5.6, 0.6, 5.6), BOX('#8a8ea8', 0, 1.5, 0, 4.6, 2, 4.6), P('sph', '#a0a8c8', 0, 2.6, 0, 3.6, 2.4, 3.6), BOX('T', 0, 2.55, 0, 4.7, 0.2, 4.7),
    BOX('#ffd166', 0, 4.1, 0, 0.9, 1.2, 0.06), BOX('#c8a8ff', 0.6, 4.0, 0.3, 0.06, 1.0, 0.7), BOX(DARK, 2.32, 1.1, 0, 0.1, 1.4, 1.2)],
  factory: [BOX('#6a6e72', 0, 0.3, 0, 5.6, 0.6, 5.6), BOX('#7e848a', -0.3, 1.9, 0, 4.6, 2.8, 5), BOX('#5e646a', -0.3, 3.45, 0, 4.8, 0.4, 5.2), BOX(DARK, 2.0, 1.5, 0, 0.1, 2, 2.6),
    BOX('T', 2.06, 2.8, 0, 0.06, 0.4, 2.8), P('cyl', '#5a5e64', -1.6, 4.4, -1.6, 0.8, 2.2, 0.8), P('cyl', 'T', -1.6, 5.4, -1.6, 0.86, 0.2, 0.86), BOX('#c8a040', 2.6, 0.62, 0, 1, 0.04, 2.6)],
  airfield: [BOX('#5a6068', 0, 0.2, 0, 5.8, 0.4, 5.8), BOX('#c8c8c8', 0, 0.42, 0, 4, 0.04, 0.3), BOX('#c8c8c8', 0, 0.42, 1.4, 4, 0.04, 0.3), BOX('#c8c8c8', 0, 0.42, -1.4, 4, 0.04, 0.3),
    BOX('#8a929c', -2.2, 1.8, -2.2, 1.2, 3.2, 1.2), BOX(GLASS, -2.2, 3.6, -2.2, 1.5, 0.8, 1.5), BOX('T', -2.2, 4.1, -2.2, 1.6, 0.2, 1.6), BOX('T', 2.4, 0.6, 2.4, 0.6, 0.6, 0.6), BOX('T', 2.4, 0.6, -2.4, 0.6, 0.6, 0.6)],
};

// v1.2.32 the Hive's buildings: organic mounds, pods and spires
const MOUND = '#4a3858', MOUND2 = '#5e4670', FLESH = '#8a5a6a';
Object.assign(BUILD_LOOK, {
  nest: [P('sph', MOUND, 0, 0.4, 0, 8, 2.4, 8), P('sph', MOUND2, 0, 1.8, 0, 5.4, 3.6, 5.4), P('sph', 'T', 0, 3.3, 0, 3, 1, 3), P('sph', FLESH, 1.6, 1.2, 1.6, 1.6, 1.4, 1.6), P('sph', FLESH, -1.8, 1.0, 1.2, 1.4, 1.2, 1.4),
    P('sph', ACID, 0, 4.0, 0, 1.0, 1.0, 1.0), P('cone', MOUND2, 2.6, 2.2, -2.2, 0.6, 2.4, 0.6), P('cone', MOUND2, -2.6, 2.0, -1.8, 0.5, 2.0, 0.5), P('box', '#c8a040', 3.4, 0.4, 0, 1, 0.04, 3)],
  node: [P('sph', MOUND, 0, 0.3, 0, 3.6, 1.0, 3.6), P('cyl', MOUND2, 0, 1.4, 0, 0.6, 2.4, 0.6), P('sph', ACID, 0, 2.9, 0, 1.0, 1.0, 1.0), P('sph', 'T', 0, 2.2, 0, 1.0, 0.3, 1.0), P('box', MOUND2, 0, 0.7, 0, 3.2, 0.12, 0.2, 0.7), P('box', MOUND2, 0, 0.7, 0, 3.2, 0.12, 0.2, -0.7)],
  pit: [P('sph', MOUND, 0, 0.3, 0, 5.8, 1.2, 5.8), P('cyl', '#1a1220', 0, 0.62, 0, 3.2, 0.1, 3.2), P('sph', '#e8dcc0', 0.8, 0.9, 0.6, 0.7, 0.9, 0.7), P('sph', '#e8dcc0', -0.6, 0.9, -0.5, 0.6, 0.8, 0.6), P('sph', '#e8dcc0', -0.4, 0.9, 0.9, 0.5, 0.7, 0.5),
    P('sph', 'T', 0, 0.75, -2.2, 1.6, 0.6, 1.0), P('cone', MOUND2, 2.2, 1.4, 2.2, 0.5, 2, 0.5)],
  spire: [P('sph', MOUND, 0, 0.3, 0, 1.8, 0.8, 1.8), P('cone', MOUND2, 0, 1.8, 0, 0.8, 3, 0.8), P('sph', ACID, 0, 3.1, 0, 0.7, 0.7, 0.7, 0, 1), P('sph', 'T', 0, 1.2, 0, 1.0, 0.3, 1.0)],
  vault: [P('sph', MOUND, 0, 0.3, 0, 5.6, 1.2, 5.6), P('sph', MOUND2, 0, 1.6, 0, 3.8, 3, 3.8), P('box', ACID, 0, 3.0, 0, 0.2, 2, 0.2, 0.5), P('box', '#c8a8ff', 0, 3.0, 0, 0.2, 2, 0.2, -0.5), P('sph', 'T', 0, 2.6, 0, 2.6, 0.4, 2.6)],
  chamber: [P('sph', MOUND, 0, 0.4, 0, 6, 1.6, 6), P('sph', FLESH, -0.4, 1.8, 0, 4.4, 3.2, 4.0), P('sph', 'T', -0.4, 3.1, 0, 2.4, 0.6, 2.2), P('cone', '#e8e0c8', 1.8, 2.4, 1.2, 0.4, 1.6, 0.4), P('cone', '#e8e0c8', 1.8, 2.4, -1.2, 0.4, 1.6, 0.4), P('cyl', '#1a1220', 2.0, 1.0, 0, 0.1, 1.4, 1.6)],
  roost: [P('sph', MOUND, 0, 0.3, 0, 5.8, 1.0, 5.8), P('cyl', MOUND2, -1.4, 2.2, -1.4, 1.2, 4, 1.2), P('cyl', MOUND2, 1.4, 1.6, 1.0, 1.0, 3, 1.0), P('sph', 'T', -1.4, 4.3, -1.4, 1.6, 0.5, 1.6), P('sph', 'T', 1.4, 3.2, 1.0, 1.3, 0.4, 1.3),
    P('sph', '#e0b030', 0.4, 0.9, -1.6, 0.8, 0.5, 0.8)],
});

// shared unit geometries for the shapes
const SHAPES = {
  box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10), sph: new THREE.SphereGeometry(0.5, 10, 8), cone: new THREE.ConeGeometry(0.5, 1, 8),
};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
// merges parts into one geometry per (group, team / fixed): fixed parts carry vertex colors, team parts are white
// (the instance color is the player's color; 'D' parts are darkened through their vertex color)
export function bakeParts(parts, scale = 1) {
  const out = {};
  for (const [s, c, x, y, z, sx, sy, sz, ry, g] of parts) {
    const team = c === 'T' || c === 'D', key = g + (team ? 't' : 'f');
    const ge = SHAPES[s].toNonIndexed();
    _e.set(0, ry, 0); _q.setFromEuler(_e);
    _m.compose(_v.set(x * scale, y * scale, z * scale), _q, _s.set(sx * scale, sy * scale, sz * scale));
    ge.applyMatrix4(_m);
    const col = new THREE.Color(team ? (c === 'D' ? '#8a8a8a' : '#ffffff') : c);
    (out[key] ||= []).push([ge, col]);
  }
  const res = {};
  for (const [key, list] of Object.entries(out)) res[key] = mergeColored(list);
  return res;
}
function mergeColored(list) {
  const n = list.reduce((a, [ge]) => a + ge.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const [ge, c] of list) {
    const cnt = ge.attributes.position.count;
    pos.set(ge.attributes.position.array, o * 3); nor.set(ge.attributes.normal.array, o * 3);
    for (let i = 0; i < cnt; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    o += cnt; ge.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// An instanced drawing of one geometry (grows as needed). begin() each frame, add() each copy, end().
export class Inst {
  constructor(parent, geo, mat, cap = 32, shadow = true) {
    this.parent = parent; this.geo = geo; this.mat = mat; this.shadow = shadow; this.n = 0; this.make(cap);
  }
  make(cap) {
    if (this.mesh) { this.parent.remove(this.mesh); this.mesh.dispose && this.mesh.dispose(); }
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); this.mesh.instanceColor.array.fill(1);   // (no color given = white)
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = this.shadow; this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.parent.add(this.mesh);
  }
  begin() { this.n = 0; }
  add(m, c) {
    if (this.n >= this.cap) { const old = this.mesh; this.make(this.cap * 2); this.mesh.instanceMatrix.array.set(old.instanceMatrix.array); this.mesh.instanceColor.array.set(old.instanceColor.array); }
    this.mesh.setMatrixAt(this.n, m); if (c) this.mesh.setColorAt(this.n, c);
    this.n++;
  }
  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; this.mesh.visible = this.n > 0; }
  dispose() { this.parent.remove(this.mesh); this.mesh.dispose && this.mesh.dispose(); }
}

// ---------------------------------------------------------------- terrain
// (v1.2.27 drew every cell as a flat terrace with straight rock walls on the cell edges; see makeSurface for 1.2.28)
const DIRT = new THREE.Color('#7a6142'), ROCK = new THREE.Color('#6e655a'), ROCK2 = new THREE.Color('#8a8070');
const SNOWCAP = new THREE.Color('#9a958c'), PATH = new THREE.Color('#8a7350'), DARKG = new THREE.Color('#3d6228'), FLOWER = new THREE.Color('#c8b84a');
// v1.2.28 (Devin: less blocky): the ground is one smooth height grid, a vertex every meter. Each vertex takes a soft
// (gaussian) average of the cell heights around it and is then pulled back onto the nearest terrace, so plateaus stay
// flat while cliff edges follow the smoothed outline: a diagonal cliff is a straight diagonal wall now, not a staircase
// of 2 m cell steps, and corners are rounded. Ramps and the mountains keep the plain smooth average. The same grid
// gives where units stand (y), so feet always meet the ground.
const LV_GRASS = [new THREE.Color('#4f7a34'), new THREE.Color('#6a8a3a'), new THREE.Color('#8a9446'), new THREE.Color('#a39a58')];
const sstep = (a, b, t) => { const x = clamp01((t - a) / (b - a)); return x * x * (3 - 2 * x); };
export function makeSurface(M) {
  const N = M.N, H = M.H, h = M.h, lv = M.lv, VN = 2 * N + 1;
  const TH = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) TH[k] = lv[k] === ROCK_LV ? ROCK_LV * LEVEL_H + 1.2 + Math.max(0, fbm(M.hillSeed + 11, ((k % N) * CELL - H) / 14, (((k / N) | 0) * CELL - H) / 14, 2)) * 7 : h[k];
  const V = new Float32Array(VN * VN), kind = new Uint8Array(VN * VN);   // kind: 0 terrace, 1 ramp / blend, 2 mountain
  const sig2 = 2 * 1.15 * 1.15;
  for (let j = 0; j < VN; j++) for (let i = 0; i < VN; i++) {
    const x = i, z = j;   // meters from the map corner (cell c spans [2c, 2c + 2])
    let s = 0, w = 0, rampN = 0, rockN = 0;
    const c0x = Math.floor(x / CELL - 1.5), c0z = Math.floor(z / CELL - 1.5);
    for (let cz = c0z; cz <= c0z + 3; cz++) for (let cx = c0x; cx <= c0x + 3; cx++) {
      const ccx = Math.max(0, Math.min(N - 1, cx)), ccz = Math.max(0, Math.min(N - 1, cz)), k = ccz * N + ccx;
      const dx = (cx + 0.5) * CELL - x, dz = (cz + 0.5) * CELL - z, d2 = dx * dx + dz * dz;
      if (d2 > 9) continue;
      const wt = Math.exp(-d2 / sig2);
      s += TH[k] * wt; w += wt;
      if (d2 < 2.3) { if (M.ramp[k]) rampN++; if (lv[k] === ROCK_LV) rockN++; }
    }
    let y = s / (w || 1);
    if (rockN) kind[j * VN + i] = 2;
    else if (rampN) kind[j * VN + i] = 1;
    else { const L = y / LEVEL_H, b = Math.floor(L + 1e-4); y = (b + sstep(0.3, 0.7, L - b)) * LEVEL_H; }   // back onto the terraces
    V[j * VN + i] = y;
  }
  const hill = (x, z, i, j) => kind[j * VN + i] === 2 ? 0 : hillAt(M, x, z);
  const y = (x, z) => {
    const fx = Math.max(0, Math.min(VN - 1.001, x + H)), fz = Math.max(0, Math.min(VN - 1.001, z + H)), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = V[j * VN + i], b = V[j * VN + i + 1], c = V[(j + 1) * VN + i], d = V[(j + 1) * VN + i + 1];
    const rock = kind[j * VN + i] === 2 && kind[(j + 1) * VN + i + 1] === 2;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz + (rock ? 0 : hillAt(M, x, z));
  };
  return { TH, V, VN, kind, hill, y };
}
export function buildTerrain(M, bases, SF = makeSurface(M)) {
  const N = M.N, H = M.H, lv = M.lv, group = new THREE.Group();
  const mat = fowMat(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const { V, VN, kind } = SF;
  const baseD = (x, z) => { let d = 1e9; for (const b of bases) d = Math.min(d, Math.hypot(b.x - x, b.z - z)); return d; };
  const Y = new Float32Array(VN * VN);
  for (let j = 0; j < VN; j++) for (let i = 0; i < VN; i++) Y[j * VN + i] = V[j * VN + i] + SF.hill(i - H, j - H, i, j);
  const colorAt = (i, j, out) => {
    const x = i - H, z = j - H, v = j * VN + i, k = Math.min(N - 1, Math.floor(j / CELL)) * N + Math.min(N - 1, Math.floor(i / CELL));
    if (kind[v] === 2) { out.copy(ROCK).lerp(SNOWCAP, clamp01(0.5 + fbm(M.hillSeed + 5, x / 9, z / 9, 2))); return out; }
    // steepness: the biggest height step to a neighboring vertex (cliff faces get the rock strata)
    let st = 0; const y0 = V[v];
    if (i > 0) st = Math.max(st, Math.abs(V[v - 1] - y0)); if (i < VN - 1) st = Math.max(st, Math.abs(V[v + 1] - y0));
    if (j > 0) st = Math.max(st, Math.abs(V[v - VN] - y0)); if (j < VN - 1) st = Math.max(st, Math.abs(V[v + VN] - y0));
    const L = Math.max(0, Math.min(3, Math.round(y0 / LEVEL_H)));
    const n1 = fbm(M.hillSeed + 21, x / 16, z / 16, 3), n2 = fbm(M.hillSeed + 33, x / 4.5, z / 4.5, 2);
    out.copy(LV_GRASS[L]);
    out.lerp(DARKG, clamp01(n1 * 0.9 + 0.2) * 0.55);
    if (n2 > 0.55) out.lerp(FLOWER, (n2 - 0.55) * 1.2);
    const dirt = clamp01((fbm(M.hillSeed + 44, x / 22, z / 22, 3) - 0.25) * 2.2);
    out.lerp(DIRT, dirt * 0.7);
    if (M.ramp[k] && kind[v] === 1) out.lerp(PATH, 0.65);
    const bd = baseD(x, z); if (bd < 13) out.lerp(PATH, clamp01((13 - bd) / 6) * 0.45);
    out.multiplyScalar(0.92 + n2 * 0.08);
    const cliff = clamp01((st - 0.55) / 0.9);
    if (cliff > 0 && !(M.ramp[k])) out.lerp(c2.copy(ROCK).lerp(ROCK2, clamp01(0.5 + 0.5 * Math.sin(y0 * 2.3 + fbm(M.hillSeed + 7, x / 5, z / 5, 1) * 3))).multiplyScalar(0.85), cliff);
    return out;
  };
  const c2 = new THREE.Color(), c = new THREE.Color();
  const CH = 32;   // vertices per chunk side (16 cells)
  for (let j0 = 0; j0 < VN - 1; j0 += CH) for (let i0 = 0; i0 < VN - 1; i0 += CH) {
    const i1 = Math.min(VN - 1, i0 + CH), j1 = Math.min(VN - 1, j0 + CH), w = i1 - i0 + 1;
    const pos = [], col = [], idx = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { pos.push(i - H, Y[j * VN + i], j - H); colorAt(i, j, c); col.push(c.r, c.g, c.b); }
    for (let j = 0; j < j1 - j0; j++) for (let i = 0; i < i1 - i0; i++) {
      const a = j * w + i, b = a + 1, d = a + w, e = d + 1;
      // split each quad along the diagonal that follows the slope (a cliff edge running diagonally stays straight)
      const ya = pos[a * 3 + 1], yb = pos[b * 3 + 1], yd = pos[d * 3 + 1], ye = pos[e * 3 + 1];
      if (Math.abs(ya - ye) <= Math.abs(yb - yd)) idx.push(a, d, e, a, e, b); else idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.castShadow = true;
    group.add(mesh);
  }
  // a dark floor under everything, so a gap at the map's edge never shows the sky
  const under = new THREE.Mesh(new THREE.PlaneGeometry(M.size + 40, M.size + 40).rotateX(-Math.PI / 2), fowMat(new THREE.MeshLambertMaterial({ color: '#2e2c26' })));
  under.position.y = -1.2; group.add(under);
  return group;
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

// trees and rocks (instanced)
export function buildDoodads(M, parent) {
  const trunk = fowMat(new THREE.MeshLambertMaterial({ color: '#5a4030' })), leaf = fowMat(new THREE.MeshLambertMaterial({ color: '#3f6a2a' })), leaf2 = fowMat(new THREE.MeshLambertMaterial({ color: '#557a30' })), rock = fowMat(new THREE.MeshLambertMaterial({ color: '#7a756c' }));
  const trees = M.doodads.filter(d => d.k === 't'), rocks = M.doodads.filter(d => d.k === 'r');
  const tI = new Inst(parent, new THREE.CylinderGeometry(0.18, 0.26, 1, 6), trunk, Math.max(1, trees.length)), l1 = new Inst(parent, new THREE.ConeGeometry(1, 1, 7), leaf, Math.max(1, trees.length)), l2 = new Inst(parent, new THREE.ConeGeometry(1, 1, 7), leaf2, Math.max(1, trees.length));
  const rI = new Inst(parent, new THREE.DodecahedronGeometry(1, 0), rock, Math.max(1, rocks.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  tI.begin(); l1.begin(); l2.begin(); rI.begin();
  for (const d of trees) {
    const y = groundY(M, d.x, d.z), s = d.s;
    e.set(0, d.r, 0); q.setFromEuler(e);
    tI.add(m.compose(_v.set(d.x, y + 0.6 * s, d.z), q, _s.set(s, 1.2 * s, s)));
    l1.add(m.compose(_v.set(d.x, y + 1.9 * s, d.z), q, _s.set(1.25 * s, 2.0 * s, 1.25 * s)));
    l2.add(m.compose(_v.set(d.x, y + 2.9 * s, d.z), q, _s.set(0.85 * s, 1.5 * s, 0.85 * s)));
  }
  for (const d of rocks) { const y = groundY(M, d.x, d.z); e.set(d.r, d.r * 2, 0); q.setFromEuler(e); rI.add(m.compose(_v.set(d.x, y + 0.3 * d.s, d.z), q, _s.set(1.1 * d.s, 0.75 * d.s, 0.95 * d.s))); }
  tI.end(); l1.end(); l2.end(); rI.end();
  for (const i of [tI, l1, l2, rI]) { i.mesh.castShadow = true; i.mesh.receiveShadow = true; }
  return [tI, l1, l2, rI];
}
let surfFor = null, surfM = null;
export function groundY(M, x, z) {   // the terrain's top at (x, z)
  if (surfM !== M) { surfM = M; surfFor = makeSurface(M); }
  return surfFor.y(x, z);
}

// thumbnails of units and buildings for the HUD (rendered once each, cached as images)
let thumbR = null; const thumbs = new Map();
export function thumbOf(type, color = '#5aa0ff') {
  const key = type + color; if (thumbs.has(key)) return thumbs.get(key);
  let url = '';
  try {
    thumbR = thumbR || new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    const size = 96; thumbR.setSize(size, size, false);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight(0xe8eeff, 0x2a3040, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(2, 4, 3); scene.add(sun);
    const parts = UNIT_LOOK[type] ? UNIT_LOOK[type].parts : BUILD_LOOK[type];
    const geos = bakeParts(parts), g = new THREE.Group();
    for (const [k, ge] of Object.entries(geos)) { const mt = new THREE.MeshLambertMaterial({ vertexColors: true, color: k.endsWith('t') ? color : '#ffffff' }); g.add(new THREE.Mesh(ge, mt)); }
    g.rotation.y = -2.3; scene.add(g);
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), r = Math.max(0.6, box.getSize(new THREE.Vector3()).length() * 0.5);
    cam.position.set(c.x + r * 1.5, c.y + r * 1.3, c.z + r * 2.5); cam.lookAt(c);
    thumbR.setClearColor(0x000000, 0); thumbR.render(scene, cam);
    url = thumbR.domElement.toDataURL();
    for (const m of g.children) { m.geometry.dispose(); m.material.dispose(); }
  } catch { url = ''; }
  thumbs.set(key, url);
  return url;
}
export { resCells };
