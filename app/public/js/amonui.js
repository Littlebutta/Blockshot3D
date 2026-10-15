// =====================================================================
// AMON autobattler: the client side. Store / board UI (DOM), the 3D battlefield (three.js),
// the Tab leaderboard and the network glue. The host also runs AmonGame (amon.js) through this.
// =====================================================================
import * as THREE from '/vendor/three/build/three.module.js';
import { AMON, UNIT_BY_ID, corrupted, PATTERNS, patternCells, fxLines, TIER_COLORS, TIER_NAMES, buildAmonCards, rankCount, cardKind, FACTION_BY_ID, FX_INFO, cardValue } from './amondata.js';
import { computeArmy, boardScore } from './amon.js';
import { AckEncoder, AckDecoder } from './netcodec.js';
import { cardDetails, unitTags, unitRole } from './amoninfo.js';
import { drawUnit } from './unitart.js';

const N = AMON.boardSize, CELLS = N * N, HX = AMON.field.hx, HZ = AMON.field.hz;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SIDE_COLORS = ['#8fd0ff', '#ff7a5a'];
// v1.2.6: battle-stream ids (the codec's epoch) only ever grow, so a peer can drop a late update from a field it already left
let streamId = 0;
const nextStream = () => (streamId = Math.max(streamId + 1, Math.floor(Date.now() / 100)));
const FE_MAX = 400;   // field events per update at most (only reached if a peer stops confirming for seconds)
const TILT0 = Math.atan2(0.82, 0.62);   // default camera pitch
const THEME_LOOK = {
  grass:   { ground: '#3d5f2d', ground2: '#486c35', sky: '#6f93b0', rock: '#6e6e66', prop: '#33571f' },
  desert:  { ground: '#8f7848', ground2: '#9a8252', sky: '#b49a74', rock: '#7a5c3e', prop: '#4f6a2c' },
  snow:    { ground: '#6f7c88', ground2: '#78858f', sky: '#66778a', rock: '#69788a', prop: '#244a3c' },
  ash:     { ground: '#4a4040', ground2: '#5a4a48', sky: '#5a3a38', rock: '#3a3030', prop: '#7a3a2a' },
  crystal: { ground: '#3a3a5a', ground2: '#4a4a6a', sky: '#2a2a48', rock: '#8a6ad0', prop: '#5a9ad0' },
  swamp:   { ground: '#34402a', ground2: '#2c4a3a', sky: '#56685a', rock: '#4a5040', prop: '#3f5a2a', water: '#2a4a48' },
  autumn:  { ground: '#5a4a2a', ground2: '#6a4222', sky: '#a08a70', rock: '#6a6058', prop: '#c0602a' },
  ruins:   { ground: '#5c5848', ground2: '#68634f', sky: '#8a9098', rock: '#9a9282', prop: '#4a6a3a' },
  moon:    { ground: '#5a5c66', ground2: '#4a4c56', sky: '#14162a', rock: '#7a7c88', prop: '#9aa0b8' },
};
export const unitDef = id => UNIT_BY_ID.get(id) || (id.startsWith('x-') && UNIT_BY_ID.get(id.slice(2)) ? corrupted(UNIT_BY_ID.get(id.slice(2))) : UNIT_BY_ID.get('grunt'));

// ---------------------------------------------------------------- unit models (blocky, matching the game's style)
const geo = {
  box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10), cone: new THREE.ConeGeometry(0.5, 1, 8),
  sph: new THREE.SphereGeometry(0.5, 12, 8), plane: new THREE.PlaneGeometry(1, 1), torus: new THREE.TorusGeometry(0.5, 0.08, 6, 16, Math.PI),
};
const matCache = new Map();
function mat(color, emissive = 0) {
  const k = color + ':' + emissive;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive }));
  return matCache.get(k);
}
function part(g, shape, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, emissive = 0) {
  const m = new THREE.Mesh(geo[shape], mat(color, emissive));
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz);
  g.add(m); return m;
}
function shade(hex, k) {
  const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString();
}
// Models are drawn bigger than their footprint so a full field stays readable from the battle camera.
const visScale = def => def.size * (def.look.shape === 'boss' ? 1.15 : def.size < 1 ? 2 : def.size < 2 ? 1.6 : 1.35);
// Builds a unit about 1 m tall facing +x; the caller scales it by the unit's size.
function buildUnit(def, side, ownerColor) {
  const g = new THREE.Group(), c = def.look.color, dk = shade(c, 0.6), lt = shade(c, 1.25), gear = def.look.gear;
  const accent = ownerColor || (side === 0 ? '#8fd0ff' : '#ff3a2a');   // enemies wear their faction's color
  const parts = {};
  Object.assign(parts, drawUnit(g, def, accent));
  g.userData.parts = parts;
  return g;
}

// Big battles: every unit's static parts are merged into one mesh (one draw call) shared by all units of that look.
// v28: an AMON enemy body for the shooter modes (Core Defense raids), facing +x like everywhere here.
export function amonBody(id, color) { return buildUnit(unitDef(id), 1, color || null); }
// v1.2.5: the same body with its static parts merged into one mesh (the detailed models have ~50 parts).
export function amonBodyBaked(id) { return bakedUnit(unitDef(id), 1, null, null); }
// Animated parts (turrets, wings, halos...) stay separate.
const bakeCache = new Map();
let bakedMat = null;
// v28: raiders wear their faction's gear on top of the shared unit body, so every faction's army looks its own
// (placed from the body's bounding box, so it fits every shape). Built facing +x, before scaling.
function factionDeco(g, fid, color) {
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g), top = bb.max.y, h = top - bb.min.y, fx = bb.max.x, bx = bb.min.x, wz = Math.max(0.2, bb.max.z), cx = (fx + bx) / 2;
  const s = Math.max(0.25, Math.min(h, (fx - bx), wz * 2) * 0.5), c = color, dk = shade(color, 0.5), gl = shade(color, 1.3);
  switch (fid) {
    case 'tank': for (const z of [-1, 1]) part(g, 'box', '#4a4a44', cx, h * 0.35, z * (wz + 0.03), (fx - bx) * 0.8, h * 0.3, 0.06); part(g, 'box', '#5a5a52', fx + 0.03, h * 0.45, 0, 0.06, h * 0.35, wz * 1.4); break;
    case 'swarm': for (let k = 0; k < 3; k++) part(g, 'cone', c, bx + (fx - bx) * (0.25 + k * 0.25), top + s * 0.15, 0, s * 0.3, s * 0.55, s * 0.3, 0, 0, 0.5); break;
    case 'bone': for (const z of [-1, 1]) part(g, 'cone', '#ece4cc', cx + s * 0.1, top + s * 0.2, z * s * 0.35, s * 0.16, s * 0.7, s * 0.16, z * 0.6, 0, -0.3); part(g, 'box', '#ece4cc', cx, top + 0.02, 0, s * 0.5, 0.06, s * 0.5); break;
    case 'sky': for (const z of [-1, 1]) part(g, 'box', gl, cx - s * 0.1, h * 0.6, z * (wz + s * 0.35), s * 0.5, 0.05, s * 0.7, z * 0.15, 0, 0); part(g, 'cyl', '#ddd', cx, top + 0.08, 0, s * 0.9, 0.03, s * 0.12); break;
    case 'artillery': for (let k = -1; k <= 1; k++) part(g, 'cyl', '#c0a050', bx - 0.05, h * 0.6, k * s * 0.18, s * 0.14, s * 0.55, s * 0.14); part(g, 'box', '#5a4a3a', bx - 0.03, h * 0.45, 0, 0.08, s * 0.4, s * 0.6); break;
    case 'pyro': for (let k = 0; k < 3; k++) part(g, 'cone', k === 1 ? '#ffd040' : '#ff6a1a', cx + (k - 1) * s * 0.18, top + s * 0.25, 0, s * 0.2, s * (k === 1 ? 0.8 : 0.5), s * 0.2, 0, 0, 0, 0.8); break;
    case 'frost': for (const z of [-1, 1]) for (const a of [-0.4, 0.3]) part(g, 'cone', '#bfe8ff', cx + a * s * 0.5, h * 0.85, z * (wz * 0.9), s * 0.14, s * 0.55, s * 0.14, z * 0.5, 0, a, 0.4); break;
    case 'iron': part(g, 'box', '#c03030', cx - s * 0.05, top + s * 0.22, 0, s * 0.45, s * 0.35, 0.06); for (const z of [-1, 1]) part(g, 'sph', '#9aa2b0', cx, h * 0.72, z * wz, s * 0.4, s * 0.25, s * 0.35); break;
    case 'beast': for (const z of [-1, 1]) part(g, 'cone', '#e8dcc0', fx - s * 0.1, top, z * s * 0.25, s * 0.13, s * 0.55, s * 0.13, z * 0.3, 0, -0.9); part(g, 'sph', '#6a4a2a', cx, h * 0.8, 0, s * 0.8, s * 0.45, Math.max(wz * 2.1, s * 0.6)); break;
    case 'machine': part(g, 'cyl', '#cfd6e4', cx - s * 0.1, top + s * 0.3, 0, 0.03, s * 0.6, 0.03); part(g, 'sph', '#7ff0ff', cx - s * 0.1, top + s * 0.62, 0, 0.1, 0.1, 0.1, 0, 0, 0, 1); part(g, 'box', '#7ff0ff', fx + 0.02, h * 0.82, 0, 0.04, s * 0.12, Math.min(wz * 1.6, s * 0.7), 0, 0, 0, 1); break;
    case 'void': part(g, 'torus', '#b080ff', cx, top + s * 0.3, 0, s * 0.9, s * 0.9, s * 0.9, Math.PI / 2, 0, 0, 0.9); part(g, 'torus', '#b080ff', cx, top + s * 0.3, 0, s * 0.9, s * 0.9, s * 0.9, -Math.PI / 2, 0, 0, 0.9); break;
    case 'raider': for (let k = 0; k < 4; k++) part(g, 'cone', '#8a8a80', bx + (fx - bx) * (0.2 + k * 0.2), h * 0.75 + (k % 2) * 0.05, (k % 2 ? 1 : -1) * wz, s * 0.1, s * 0.45, s * 0.1, (k % 2 ? 1 : -1) * 1.2, 0, 0); part(g, 'box', '#7a5a3a', cx, h * 0.6, 0, s * 0.35, s * 0.3, wz * 2.15, 0, 0, 0.2); break;
    case 'plague': part(g, 'cyl', '#6a7a3a', bx - 0.06, h * 0.6, 0, s * 0.3, s * 0.6, s * 0.3); part(g, 'sph', '#9aff3a', bx - 0.06, h * 0.6 + s * 0.36, 0, s * 0.2, s * 0.2, s * 0.2, 0, 0, 0, 0.9); break;
    case 'crusade': part(g, 'cyl', '#6a4a2a', bx - 0.04, top + s * 0.1, wz * 0.5, 0.03, h * 0.9, 0.03); part(g, 'box', '#e8c870', bx - 0.04 - s * 0.2, top + s * 0.35, wz * 0.5, s * 0.4, s * 0.3, 0.02); part(g, 'box', '#c02020', bx - 0.04 - s * 0.2, top + s * 0.35, wz * 0.5 + 0.012, s * 0.08, s * 0.25, 0.01); break;
    case 'storm': for (const z of [-1, 1]) part(g, 'cyl', '#bfe0ff', cx, top + s * 0.3, z * s * 0.2, 0.025, s * 0.6, 0.025, z * 0.25, 0, 0, 1); part(g, 'sph', '#8ac0ff', cx, top + s * 0.62, 0, s * 0.18, s * 0.18, s * 0.18, 0, 0, 0, 1); break;
    case 'shadow': part(g, 'cone', '#2a2238', cx, top + s * 0.1, 0, s * 0.75, s * 0.5, Math.max(s * 0.6, wz * 1.6)); part(g, 'box', '#6a2a40', cx + s * 0.1, h * 0.72, 0, s * 0.2, 0.05, wz * 2.1); break;
    case 'chaos': for (let k = 0; k < 3; k++) part(g, 'sph', ['#ff4fd0', '#4fd0ff', '#ffd04f'][k], cx + Math.cos(k * 2.1) * s * 0.5, top + s * 0.3 + k * 0.04, Math.sin(k * 2.1) * s * 0.5, s * 0.16, s * 0.16, s * 0.16, 0, 0, 0, 1); break;
    case 'counter': part(g, 'box', '#40d0b0', fx + 0.02, h * 0.8, 0, 0.04, s * 0.14, Math.min(wz * 1.7, s * 0.8), 0, 0, 0, 0.9); part(g, 'box', '#e8f0f0', cx, top + s * 0.2, 0, 0.04, s * 0.4, s * 0.06); part(g, 'box', '#e8f0f0', cx, top + s * 0.4, 0, 0.04, 0.04, s * 0.7); break;
  }
}
function bakedUnit(def, side, color, fid) {
  const g = buildUnit(def, side, color), parts = g.userData.parts;
  if (fid) factionDeco(g, fid, color);
  const skip = new Set(); for (const p of Object.values(parts)) p.traverse(o => skip.add(o));
  const statics = []; g.traverse(o => { if (o.isMesh && !skip.has(o)) statics.push(o); });
  if (statics.length < 2) return g;
  const key = def.id + ':' + side + ':' + color + ':' + (fid || '');
  let geo2 = bakeCache.get(key);
  if (!geo2) {
    g.updateMatrixWorld(true);
    const list = statics.map(m => { const ge = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()); ge.applyMatrix4(m.matrixWorld); return [ge, m.material]; });
    const n = list.reduce((a, [ge]) => a + ge.attributes.position.count, 0);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const [ge, mt] of list) {
      const c = mt.color.clone(), cnt = ge.attributes.position.count;
      if (mt.emissiveIntensity && (mt.emissive.r + mt.emissive.g + mt.emissive.b) > 0) c.multiplyScalar(1 + mt.emissiveIntensity * 0.7);
      pos.set(ge.attributes.position.array, o * 3); nor.set(ge.attributes.normal.array, o * 3);
      for (let i = 0; i < cnt; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
      o += cnt; ge.dispose();
    }
    geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo2.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo2.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo2.computeBoundingSphere();
    bakeCache.set(key, geo2);
  }
  for (const m of statics) m.parent.remove(m);
  bakedMat = bakedMat || new THREE.MeshLambertMaterial({ vertexColors: true });
  g.add(new THREE.Mesh(geo2, bakedMat));
  return g;
}

// ---------------------------------------------------------------- card art (rendered once, cached as images)
let thumbR = null;
const thumbCache = new Map();
export function unitThumb(id, size = 128) {
  const ck = size === 128 ? id : id + '@' + size;
  if (thumbCache.has(ck)) return thumbCache.get(ck);
  let url = '';
  try {
    const def = unitDef(id);
    thumbR = thumbR || new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbR.setSize(size, size, false);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    scene.add(new THREE.HemisphereLight(0xe8eeff, 0x2a3040, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(2, 4, 3); scene.add(sun);
    const g = buildUnit(def, 0, '#8fd0ff'); g.rotation.y = -0.6; scene.add(g);
    const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), r = Math.max(0.6, box.getSize(new THREE.Vector3()).length() * 0.5);
    cam.position.set(c.x + r * 1.6, c.y + r * 1.25, c.z + r * 2.6); cam.lookAt(c);
    thumbR.setClearColor(new THREE.Color(shade(def.look.color, 0.35)), 1);
    thumbR.render(scene, cam);
    url = thumbR.domElement.toDataURL();
  } catch { url = ''; }
  thumbCache.set(ck, url);
  return url;
}
export function patternThumb(pattern, color) {
  const k = 'p:' + pattern + color;
  if (thumbCache.has(k)) return thumbCache.get(k);
  const cv = document.createElement('canvas'); cv.width = cv.height = 100;
  const x = cv.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 100, 100); gr.addColorStop(0, '#1a2236'); gr.addColorStop(1, shade(color, 0.35)); x.fillStyle = gr; x.fillRect(0, 0, 100, 100);
  const cs = 14, o = (100 - cs * N) / 2, reach = new Set(patternCells(pattern || 'self', 2, 2).map(([r, c]) => r * N + c));
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const i = r * N + c;
    x.fillStyle = i === 12 ? '#ffffff' : reach.has(i) ? color : (r + c) % 2 ? '#ffffff14' : '#ffffff22';
    x.fillRect(o + c * cs + 1, o + r * cs + 1, cs - 2, cs - 2);
  }
  const url = cv.toDataURL(); thumbCache.set(k, url); return url;
}

// ---------------------------------------------------------------- styles + DOM
const CSS = `
#amon{position:fixed;inset:0;pointer-events:none;z-index:20;font-family:'Chakra Petch',sans-serif;color:#eef}
#amon .am-p{pointer-events:auto}
#amTop{position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;gap:14px;align-items:center;background:#0b0f18d0;border:1px solid #ffffff22;border-radius:10px;padding:6px 14px;white-space:nowrap}
#amTop b{font-size:23.4px}#amTop .lbl{opacity:.65;font-size:15.6px;margin-right:4px}
#amHp{width:180px;height:12px;background:#311;border-radius:6px;overflow:hidden;display:inline-block;vertical-align:middle}#amHp i{display:block;height:100%;background:linear-gradient(90deg,#e04a4a,#ffb04a)}
#amShop{position:absolute;left:8px;right:8px;bottom:8px;display:flex;gap:10px;align-items:flex-end}
#amShop .col{background:#0b0f18e6;border:1px solid #ffffff22;border-radius:10px;padding:6px}
#amLeft{flex:0 1 auto;min-width:0;max-width:calc(100vw - min(36vh,300px) - 40px)}
#amBar{position:relative;display:flex;gap:6px;align-items:center;margin-bottom:5px;flex-wrap:wrap}
#amBar .gold{font-size:24.7px;color:#ffd166;font-weight:700;margin-right:4px}
.am-btn{background:#1e2840;border:1px solid #ffffff30;color:#eef;border-radius:7px;padding:4px 10px;font:600 15.6px 'Chakra Petch',sans-serif;cursor:pointer}
.am-btn:hover:not(:disabled){background:#2a3a5c}.am-btn:disabled{opacity:.45;cursor:default}
.am-btn.go{background:#2f7a3a}.am-btn.go.on{background:#4ac05a;color:#031}.am-btn.warn{background:#7a2f2f}
.am-flash{animation:amFlash .5s 2}@keyframes amFlash{50%{color:#ff4a4a;text-shadow:0 0 8px #ff4a4a}}
#amOffers,#amBench{display:flex;gap:5px;min-height:80px;overflow-x:auto}
#amBench{min-height:66px;margin-top:5px;padding-top:5px;border-top:1px dashed #ffffff22}
.am-card{position:relative;width:96px;min-width:96px;height:96px;border-radius:7px;border:2px solid #888;background:#151b2a;padding:3px 4px;box-sizing:border-box;cursor:pointer;overflow:hidden;font-size:13px;line-height:1.15;user-select:none;display:flex;flex-direction:column;justify-content:flex-end}
.am-card:hover{filter:brightness(1.2)}.am-card.sel{outline:2px solid #fff;box-shadow:0 0 12px #fff8}
.am-card .nm{position:relative;font-weight:700;font-size:13.7px;text-align:center;max-height:34px;overflow:hidden;text-shadow:0 1px 2px #000,0 0 4px #000}
.am-card .kd{position:relative;opacity:.85;text-align:center;font-size:12.3px;text-shadow:0 1px 2px #000}.am-card .tr{position:absolute;top:1px;left:4px;font-weight:700;font-size:13.7px;text-shadow:0 1px 2px #000}
.am-card .rk,.am-cell .rk{position:absolute;top:1px;right:4px;color:#ffd166;font-weight:700;font-size:13px;text-shadow:0 1px 2px #000}.am-card .pr{position:absolute;top:19px;right:4px;color:#ffd166;font-weight:700;text-shadow:0 1px 2px #000}
.am-card .art,.am-cell .art{position:absolute;inset:0;background-size:cover;background-position:center 30%;opacity:.85}
.am-card .art::after,.am-cell .art::after{content:'';position:absolute;inset:0;background:linear-gradient(transparent 35%,#000c)}
.am-card.small{height:74px;width:74px;min-width:74px}.am-card.small .nm{font-size:12.3px;max-height:30px}.am-card.small .kd{display:none}
.am-card.empty{border-style:dashed;border-color:#ffffff22;background:#0b0f1880;cursor:default}
#amRight{width:min(36vh,300px)}
#amGrid{display:grid;grid-template-columns:repeat(5,1fr);grid-auto-rows:1fr;gap:3px;aspect-ratio:1}
.am-cell{position:relative;aspect-ratio:1;border-radius:5px;background:#1a2236;border:2px solid #ffffff18;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;font-size:12.3px;text-align:center;cursor:pointer;overflow:hidden;user-select:none}
.am-cell:nth-child(odd){background:#20293f}
.am-cell .nm{position:relative;max-width:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 2px;text-shadow:0 1px 2px #000}.am-cell .ct{position:absolute;bottom:12px;right:3px;font-weight:700;text-shadow:0 1px 2px #000}
.am-cell .bf{position:absolute;top:1px;left:3px;color:#7fe08a;font-size:12.3px;text-shadow:0 1px 2px #000}
#amBag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px 2px 4px;border:1px dashed #ffd16680;border-radius:8px;color:#ffd166;font-size:14.3px;cursor:default}
#amBag.drop{background:#4a3a10;border-style:solid}#amBag svg{width:30px;height:30px}
#amConfirm{position:absolute;bottom:100%;left:0;margin-bottom:6px;background:#070a12f2;border:1px solid #ffd16680;border-radius:8px;padding:8px 10px;font-size:15.6px;white-space:nowrap}
#amConfirm .row{display:flex;gap:6px;margin-top:6px}
#amReset{display:block;margin:0 0 4px;background:#ffd23a;color:#221;border:0;border-radius:6px;font:700 14.3px 'Chakra Petch',sans-serif;padding:3px 9px;cursor:pointer}
#amReset2{position:absolute;left:10px;top:54px;background:#ffd23a;color:#221;border:0;border-radius:6px;font:700 14.3px 'Chakra Petch',sans-serif;padding:3px 9px;cursor:pointer}
.am-cell.hl{box-shadow:inset 0 0 0 2px #ffd166;background:#3a3420}.am-cell.hlsrc{box-shadow:inset 0 0 0 2px #7fd0ff}.am-cell.sel{box-shadow:inset 0 0 0 2px #fff}
.am-cell.drop{background:#2a4a2a}
#amFront{text-align:center;font-size:14.3px;opacity:.75;margin-bottom:4px;letter-spacing:.08em}
#amPower{text-align:center;font-size:15.6px;margin-top:5px;opacity:.85}
#amSell{margin-left:auto}
#amDetail{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,94vw);max-height:84vh;overflow:auto;background:#0a0e18f8;border:1px solid #ffffff40;border-radius:12px;padding:16px 18px;font-size:16px;line-height:1.45;z-index:40;box-shadow:0 10px 40px #000a}
#amDetail .dh{display:flex;gap:12px;align-items:center;margin-bottom:8px}#amDetail .dh .art{width:72px;height:72px;border-radius:8px;background-size:cover;background-position:center;flex:none;border:2px solid #fff3}
#amDetail h3{margin:0;font-size:22px}#amDetail .sub{opacity:.7;font-size:14px}#amDetail h5{margin:10px 0 3px;font-size:15px;color:#ffd166;text-transform:uppercase;letter-spacing:.04em}
#amDetail ul{margin:0;padding-left:18px}#amDetail .tips li{color:#9fe0ff}#amDetail .x{position:absolute;right:10px;top:8px;background:none;border:0;color:#fff;font-size:22px;cursor:pointer;opacity:.7}
#amDetail .stats{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:14.5px;opacity:.9}
#amSelBox{position:fixed;border:1px dashed #ffd166;background:#ffd16618;pointer-events:none;z-index:25}
#amTip{position:fixed;max-width:300px;background:#070a12f2;border:1px solid #ffffff33;border-radius:8px;padding:8px 10px;font-size:15.6px;line-height:1.35;pointer-events:none;z-index:30}
#amTip h4{margin:0 0 3px;font-size:18.2px}#amTip .g{color:#7fe08a}#amTip .b{color:#ff8a7a}#amTip .m{opacity:.7}#amTip table{border-collapse:collapse}#amTip td{padding:0 8px 0 0}
#amBattle{position:absolute;top:56px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px}
#amFields{display:flex;gap:5px;flex-wrap:wrap;justify-content:center;max-width:90vw}
.am-chip{background:#0b0f18d0;border:1px solid #ffffff22;border-radius:12px;padding:3px 10px;font-size:15.6px;cursor:pointer}
.am-chip.on{border-color:#fff;background:#1e2840}.am-chip.won{color:#7fe08a}.am-chip.lost{color:#ff8a7a}
#amWave{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;font-size:15.6px;background:#0b0f18b0;border-radius:8px;padding:3px 10px;max-width:80vw}
#amBoss{width:420px;background:#0b0f18d0;border:1px solid #ff6a3a80;border-radius:8px;padding:4px 8px;text-align:center;font-size:16.9px}
#amBoss div{height:10px;background:#300;border-radius:5px;overflow:hidden;margin-top:3px}#amBoss i{display:block;height:100%;background:linear-gradient(90deg,#8a2ad0,#ff4a6a)}
#amCenter{position:absolute;top:34%;left:50%;transform:translate(-50%,-50%);text-align:center;background:#0b0f18e8;border:1px solid #ffffff30;border-radius:12px;padding:16px 26px;min-width:320px}
#amCenter h2{margin:0 0 6px}#amCenter .row{display:flex;gap:10px;justify-content:center;margin-top:12px;flex-wrap:wrap}
#amLb{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:#070a12f0;border:1px solid #ffffff33;border-radius:12px;padding:12px 18px;min-width:560px}
#amLb table{width:100%;border-collapse:collapse;font-size:16.9px}#amLb th{text-align:left;opacity:.6;font-weight:600;padding:3px 8px}#amLb td{padding:4px 8px;border-top:1px solid #ffffff14}
#amHelp{position:absolute;right:10px;top:54px;font-size:14.3px;opacity:.6;text-align:right;line-height:1.5}
.am-hidden{display:none!important}
#amNext{position:absolute;left:10px;top:84px;width:250px;background:#0b0f18e0;border:1px solid #ffffff22;border-left:4px solid var(--fc,#ff6a3a);border-radius:10px;padding:7px 9px;font-size:15.6px}
#amNext .fh{display:flex;gap:8px;align-items:center}#amNext .fi{width:46px;height:46px;border-radius:50%;box-shadow:0 0 10px var(--fc,#ff6a3a)}
#amNext .fl{font-weight:700;font-size:16.9px}#amNext .ft{opacity:.7;font-size:14.3px}#amNext .fu{display:flex;flex-wrap:wrap;gap:3px 8px;margin-top:5px;font-size:14.3px;opacity:.9}
#amNext .vs{margin-top:6px;font-size:15px}#amNext .vb{height:7px;border-radius:4px;background:#ff5a4a80;overflow:hidden;margin-top:3px}#amNext .vb i{display:block;height:100%;background:#5fd17a}
.am-cell .pt{position:absolute;bottom:12px;left:3px;color:#ffd166;font-size:11.7px;font-weight:700;text-shadow:0 1px 2px #000}
.am-card.holy{box-shadow:0 0 10px #ffe08a90 inset}.am-card.cursed{box-shadow:0 0 10px #e0464b90 inset}
#amPilot{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);background:#0b0f18e8;border:1px solid #7fd0ff80;border-radius:10px;padding:6px 14px;text-align:center;font-size:15.6px}
#amPilot b{font-size:18.2px}#amPilot .hb{width:240px;height:9px;background:#300;border-radius:5px;overflow:hidden;margin:4px auto 2px}#amPilot .hb i{display:block;height:100%;background:#5fd17a}
`;
const HTML = `
<div id="amTop" class="am-p"></div>
<div id="amHelp">Tab: leaderboard · Q / E: switch field · B: board · WASD / right-drag: move · middle-drag: turn · wheel: zoom · Space: reset view<br>Right-click a card or unit: details · Store: drag units on the field to set their start · Battle: click a unit, Space to drive it</div>
<div id="amNext" class="am-hidden"></div>
<div id="amPilot" class="am-p am-hidden"></div>
<button id="amReset2" class="am-p am-hidden">Reset view</button>
<div id="amBattle"><div id="amFields"></div><div id="amBoss" class="am-hidden"><span></span><div><i></i></div></div><div id="amWave"></div></div>
<div id="amShop">
  <div id="amLeft" class="col am-p">
    <button id="amReset" class="am-hidden">Reset view</button>
    <div id="amBar"><span class="gold" id="amGold"></span><span id="amLevel"></span>
      <button class="am-btn" id="amUp"></button><button class="am-btn" id="amRoll">Reroll (${AMON.rerollPrice}g)</button><button class="am-btn" id="amLock" title="Keep these cards for next round (L)">Lock</button>
      <span id="amBag" title="Drop a card here to sell it"><svg viewBox="0 0 32 32"><path d="M12 5h8l-2 4h-4z" fill="#c9a24a"/><path d="M13 9h6c5 3 8 8 8 13 0 4-3 6-11 6S5 26 5 22c0-5 3-10 8-13z" fill="#d8b25a" stroke="#7a5a1a"/><text x="16" y="24" text-anchor="middle" font-size="11" font-weight="700" fill="#5a3a0a">$</text></svg><span id="amBagTxt">Sell</span></span>
      <button class="am-btn go" id="amReady">Ready</button>
      <div id="amConfirm" class="am-hidden"></div></div>
    <div id="amOffers"></div>
    <div id="amBench"></div>
  </div>
  <div id="amRight" class="col am-p"><div id="amFront">▲ FRONT (toward the enemy) ▲</div><div id="amGrid"></div><div id="amPower"></div></div>
</div>
<div id="amCenter" class="am-p am-hidden"></div>
<div id="amLb" class="am-hidden"></div>
<div id="amTip" class="am-hidden"></div>
<div id="amDetail" class="am-hidden"></div>
<div id="amSelBox" class="am-hidden"></div>
`;

// ---------------------------------------------------------------- client
export class AmonClient {
  constructor(ctx) {
    Object.assign(this, ctx);   // renderer, localId, isHost, game, send, toast, banner, sound, cards, toLobby, keys, net, peers
    window.amonClient = this;   // handle for the browser test scripts
    this.ac = buildAmonCards(this.cards);
    this.pub = null; this.field = null; this.units = new Map(); this.shells = []; this.storms = [];
    this.sel = null; this.hover = null; this.showBoard = false; this.lastSeq = 0; this.viewF = 0;
    this.cam = { x: -40, z: 0, d: 70, yaw: 0, tilt: TILT0, goal: null }; this.peerSeq = new Map(); this.sendT = 0; this.pubT = 0; this.fieldKey = '';
    this.prevPhase = ''; this.boardKey = ''; this.preview = false; this.sfxT = 0;
    this.selU = 0; this.pilotU = 0; this.pilotBlock = false; this.mouse = { x: 0, y: 0 }; this.pinT = 0; this.mines = [];
    if (this.isHost && this.game) this.game.onAck = (id, a) => this.onAack(id, a);   // peers confirming battle-stream updates (sendFields)
    // DOM
    if (!document.getElementById('amonCss')) { const s = document.createElement('style'); s.id = 'amonCss'; s.textContent = CSS; document.head.appendChild(s); }
    this.el = document.createElement('div'); this.el.id = 'amon'; this.el.innerHTML = HTML; document.body.appendChild(this.el);
    this.$ = id => this.el.querySelector('#' + id);
    this.bindUI();
    // 3D
    const R = this.renderer;
    this.saved = { bg: R.scene.background, fog: R.scene.fog, lg: R.levelGroup, far: R.camera.far };
    if (R.levelGroup) R.levelGroup.visible = false;
    if (R.marker) R.marker.visible = false;
    this.root = new THREE.Group(); R.scene.add(this.root);
    this.unitRoot = new THREE.Group(); this.root.add(this.unitRoot);
    R.camera.far = 600; R.camera.updateProjectionMatrix();
    this.buildGround('grass', []);
    // Observer camera: wheel zooms (and stays there), right-drag pans, middle-drag turns around the point on the floor
    // you're looking at. The yellow Reset view button shows up once the view has been changed.
    this.onWheel = e => { if (e.target === R.canvas) { this.cam.d = clamp(this.cam.d * (e.deltaY > 0 ? 1.12 : 0.89), 14, 150); this.cam.goal = null; } };
    this.onMove = e => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.placing) this.placeMove(e);
      const c = this.cam;
      if (this.turn) { c.yaw -= e.movementX * 0.008; c.tilt = clamp(c.tilt + e.movementY * 0.006, 0.35, 1.45); c.goal = null; }
      else if (this.drag) { const k = c.d / 600, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw); c.x -= (e.movementX * cs + e.movementY * sn) * k; c.z -= (-e.movementX * sn + e.movementY * cs) * k; c.goal = null; }
    };
    this.onDown = e => {
      if (e.button === 1) { this.turn = true; e.preventDefault(); }
      else if (e.button === 2) { if (!this.pilotU) this.drag = true; this.rDown = { x: e.clientX, y: e.clientY, t: performance.now() }; }
      else if (e.button === 0 && this.preview && this.pub && this.pub.ph === 'shop') this.placeDown(e);
      else if (e.button === 0 && !this.pilotU) this.pickUnit(e.clientX, e.clientY);
    };
    this.onUp = e => {
      if (this.placing && e && e.button === 0) this.placeUp(e);
      // a right-click (no drag) on one of your units in battle opens its card's details
      const r = this.rDown; this.rDown = null;
      if (r && e && e.button === 2 && Math.hypot(e.clientX - r.x, e.clientY - r.y) < 6 && performance.now() - r.t < 400 && !this.pilotU) {
        const u = this.unitAt(e.clientX, e.clientY, true);
        if (u) { const id = 'u-' + u.def.id; this.showDetail(this.ac.byId.has(id) ? { w: 'unit', id } : { w: 'unit', id, card: { id, name: u.def.name, tier: Math.max(1, Math.min(6, u.def.tier || 1)), kind: 'unit', unit: u.def.id, count: 1, desc: u.def.desc || (u.side === 1 ? 'An enemy unit.' : '') } }); }
      }
      this.drag = false; this.turn = false;
    };
    this.onKey = e => this.key(e);
    addEventListener('wheel', this.onWheel, { passive: true });
    addEventListener('mousemove', this.onMove); R.canvas.addEventListener('mousedown', this.onDown); addEventListener('mouseup', this.onUp);
    addEventListener('keydown', this.onKey);
  }
  dispose() {
    this.el.remove();
    if (this.game && this.game.onAck) this.game.onAck = null;
    if (this.lightBase) { this.renderer.hemi.intensity = this.lightBase.h; this.renderer.sun.intensity = this.lightBase.s; }
    removeEventListener('wheel', this.onWheel); removeEventListener('mousemove', this.onMove); removeEventListener('mouseup', this.onUp); removeEventListener('keydown', this.onKey); if (this.onDetailOut) removeEventListener('mousedown', this.onDetailOut, true); if (this.onDetailKey) removeEventListener('keydown', this.onDetailKey, true);
    this.renderer.canvas.removeEventListener('mousedown', this.onDown);
    const R = this.renderer;
    R.scene.remove(this.root);
    R.scene.background = this.saved.bg; R.scene.fog = this.saved.fog;
    if (this.saved.lg) this.saved.lg.visible = true;
    R.camera.far = this.saved.far; R.camera.updateProjectionMatrix();
  }
  me() { return this.pub ? this.pub.pl.find(p => p.id === this.localId) : null; }
  act(a) { if (this.isHost) this.game.action(this.localId, a); else this.send(a); }

  // ---------------------------------------------------------------- frame
  frame(dt, paused, simDt = dt) {
    this.dimLights();
    if (this.isHost) this.hostTick(Math.min(0.1, simDt), paused);
    this.sfxT = Math.max(0, this.sfxT - dt); this.busy = (this.busy || 0) * Math.exp(-dt * 1.5);
    this.updateUnits(dt);
    this.pilotTick(dt);
    this.updateCamera(dt);
    this.renderer.updateFx(dt);
    this.updateHud();
  }
  // The battlefield is lit softer than the arenas (it read too bright); settings changes re-apply the dimming.
  dimLights() {
    const R = this.renderer; if (!R.hemi || !R.sun) return;
    if (!this.lightSet || R.hemi.intensity !== this.lightSet.h || R.sun.intensity !== this.lightSet.s) {
      this.lightBase = { h: R.hemi.intensity, s: R.sun.intensity };
      R.hemi.intensity *= 0.68; R.sun.intensity *= 0.72;
      this.lightSet = { h: R.hemi.intensity, s: R.sun.intensity };
    }
  }
  hideLevel() { const R = this.renderer; if (R.levelGroup) R.levelGroup.visible = false; if (R.marker) R.marker.visible = false; if (this.lastGround) this.buildGround(...this.lastGround); }
  hostTick(dt, paused) {
    const g = this.game;
    if (!paused) g.step(dt);
    const evs = g.takeEvents();
    this.pubT -= dt;
    if (g.dirty || this.pubT <= 0 || evs.length) {
      if (g.dirty || this.pubT <= 0) { g.dirty = false; this.pubT = 0.5; }
      const s = g.publicState();
      this.applyPub(s, evs);
      if (this.net) this.net.send({ t: 'toAll', msg: { k: 'apub', s, ev: evs } });
    }
    // v1.2.6: the host's own view follows every battle tick (fieldState costs ~0.03 ms), not only the 15 Hz send tick
    const meP = g.player(this.localId), of = this.fieldOf(meP ? meP.view : 0);
    if (!of) { this.field = null; this.ownF = null; }
    else if (of !== this.ownF || g.tickN !== this.ownTk) {
      const fresh = of !== this.ownF;
      if (fresh) { this.ownF = of; this.lastSeq = of.t < 1 ? 0 : of.evSeq; }   // a field you switch to mid-battle doesn't replay its past effects
      this.ownTk = g.tickN;
      this.applyField(g.fieldState(of.id, this.lastSeq), fresh);
    }
    this.sendT -= dt;
    const tick15 = this.sendT <= 0;
    if (tick15) { this.sendT = Math.max(0, this.sendT + 1 / 15); this.sendN = (this.sendN || 0) + 1; }   // v1.2.6: keeps the remainder (resetting it made this 12 Hz at 60 fps)
    if (this.net) this.sendFields(g, tick15);
  }
  fieldOf(id) { return this.game.fields.find(f => f.id === id) || null; }
  // v1.2.6: the battle stream goes UNRELIABLE, so one lost packet no longer freezes every unit until Steam resends it.
  // Each peer gets its own stream for the field it watches (netcodec.js AckEncoder): every update is a delta against the
  // newest one that peer confirmed (its 'aack'), the obstacles ride only in keyframes, and field events repeat until
  // confirmed (the peer plays each one once, by seq). A peer driving a unit gets every battle tick (20 Hz) the moment it
  // happens, with no slow-link thinning; the others get 15 Hz as before (every 2nd/3rd update over 200/400 ms ping).
  sendFields(g, tick15) {
    // WebSocket only: bytes the browser hasn't sent yet. SteamNet has no send queue to read (Steam drops unreliable packets it can't send, it never queues them).
    const backlog = typeof this.net.backlog === 'function' ? this.net.backlog() : 0;
    if (backlog > 192 * 1024) return;   // upload backed up: queue nothing new, so a laggy peer gets a fresh picture instead of an ever-older one
    if (!this.pilots || this.pilTk !== g.tickN) { this.pilTk = g.tickN; this.pilots = new Set(); for (const f of g.fields) for (const u of f.units) if (u.pilot && !u.dead) this.pilots.add(u.pilot.p); }   // who drives a unit (once per tick)
    for (const p of g.players) {
      if (p.isBot || p.id === this.localId) continue;
      if (!p.connected) { this.peerSeq.delete(p.id); continue; }   // back later: a fresh stream
      const f = this.fieldOf(p.view); if (!f) continue;
      let k = this.peerSeq.get(p.id);
      if (!k) this.peerSeq.set(p.id, k = { f: null, enc: null, ack: 0, evs: 0, tk: -1 });
      const fresh = k.f !== f, newTk = k.tk !== g.tickN, pil = this.pilots.has(p.id);
      if (!fresh && !(pil ? newTk : tick15 && this.sendN % this.thin(p.id) === 0)) continue;
      if (fresh) { k.f = f; k.enc = new AckEncoder(); k.enc.e = nextStream(); k.ack = 0; k.evs = f.t < 1 ? 0 : f.evSeq; }   // new battle or field switch
      k.tk = g.tickN;
      const s = g.fieldState(f.id, k.evs);   // events after the newest one this peer confirmed
      k.enc.push({ id: s.id, th: s.th, ow: s.ow, t: s.t, done: s.done, pl: s.u, shl: s.sh, mi: s.mi, st: s.st, seq: s.seq });
      const m = k.enc.encodeFor(k.ack, 0);
      if (m.kf) m.obs = s.ob;
      if (s.ev.length) m.fe = s.ev.length > FE_MAX ? s.ev.slice(-FE_MAX) : s.ev;
      this.net.send({ t: 'toPeerU', id: p.id, msg: { k: 'afield', s: m } });
    }
  }
  thin(id) { const rtt = this.rttOf ? this.rttOf(id) : 0; return rtt > 400 ? 3 : rtt > 200 ? 2 : 1; }
  // host: a peer confirmed update [stream, q] and every field event up to seq s (sent through AmonGame.action, see amon.js)
  onAack(from, a) {
    const k = this.peerSeq.get(from); if (!k || !k.enc) return;
    if (!a.a) { if (a.e === k.enc.e) k.ack = 0; return; }   // it lost its base: the next update is a keyframe
    if (!Array.isArray(a.a) || a.a[0] !== k.enc.e) return;   // for a stream it has left
    const q = a.a[1]; if (q > k.ack && q <= k.enc.n) k.ack = q;
    const sq = +a.s; if (sq > k.evs && sq <= k.f.evSeq) k.evs = sq;
  }
  onMsg(msg) {
    if (msg.k === 'apub') this.applyPub(msg.s, msg.ev || []);
    else if (msg.k === 'afield' && msg.s) this.takeField(msg.s);
  }
  // peer: one battle-stream update (see sendFields). Late, duplicate and out-of-order ones are skipped; each applied one is confirmed.
  takeField(m) {
    if (this.pub && this.pub.ph === 'shop') return;   // still on its way when the store opened
    const d = this.fdec ||= new AckDecoder();
    if (m.e < d.e) return;   // from a field you switched away from, or an earlier battle
    const fresh = m.e !== d.e, s = d.decode(m);
    if (!s) { if (!fresh && m.q > d.lastQ) this.needKey(d.e); return; }   // its base is gone: ask for a keyframe
    if (fresh) this.fOb = null;
    if (m.obs) this.fOb = m.obs;
    this.applyField({ id: s.id, th: s.th, ob: this.fOb || [], ow: s.ow || [], t: s.t, done: s.done, u: s.pl || [], sh: s.shl || [], mi: s.mi || [], st: s.st || [], ev: s.fe || [], seq: s.seq || 0 }, fresh);
    this.sendAck({ t: 'aack', a: d.ack(), s: this.lastSeq });
  }
  needKey(e) { const now = performance.now(); if (now - (this.nkT || 0) > 250) { this.nkT = now; this.sendAck({ t: 'aack', a: null, e }); } }
  // unreliable when this peer was handed the network (a lost confirmation is replaced by the next one); else through send()
  sendAck(a) { if (this.net && !this.isHost) this.net.send({ t: 'toHostU', msg: { k: 'amon', a } }); else this.send(a); }

  // ---------------------------------------------------------------- state in
  applyPub(s, evs) {
    const prev = this.pub; this.pub = s;
    for (const e of evs) this.event(e);
    if (s.ph !== this.prevPhase) this.phaseChanged(prev ? prev.ph : '', s.ph);
    const me = this.me();
    if (me && s.ph === 'shop') {
      const key = JSON.stringify(me.bo) + me.lv;
      if (key !== this.boardKey || !this.preview) { this.boardKey = key; this.showPreview(me); }
    }
    this.renderShop();
  }
  // fresh: the first update of a new stream (new battle, field switch). Its sender left out the effects of a field you
  // switch to mid-battle; seenK remembers how far each field of this battle was played, so going back never replays one.
  applyField(s, fresh) {
    if (!s) return;
    const key = s.id + ':' + s.th + ':' + (s.ob.length ? s.ob[0].x : 0);
    if (key !== this.fieldKey) { this.fieldKey = key; this.buildGround(s.th, s.ob); this.clearUnits(); }
    if (fresh) this.lastSeq = (this.seenK && this.seenK.get(key)) || 0;
    this.preview = false;
    this.field = s; this.viewF = s.id;
    for (const e of s.ev || []) if (e.s > this.lastSeq) this.fieldEvent(e);
    this.lastSeq = Math.max(this.lastSeq, s.seq || 0);
    (this.seenK ||= new Map()).set(key, this.lastSeq);
    this.syncUnits(s.u);
    this.shells = s.sh.map(([x0, z0, x1, z1, t, dur, side, big]) => ({ x0, z0, x1, z1, t, dur, side, big }));
    this.storms = s.st;
    this.mines = s.mi || [];
  }
  phaseChanged(from, to) {
    this.prevPhase = to;
    this.sel = null; this.hideTip(); this.selU = 0;
    if (this.pilotU && to !== 'battle') this.pilotU = 0;
    if (to !== 'shop') { this.placing = null; this.placeSel = []; if (this.placeRings) for (const m of this.placeRings) m.visible = false; }
    if (to === 'battle' || to === 'shop') this.seenK = null;
    if (to === 'battle') { this.manualView = false; this.cam.goal = this.homeView('battle'); this.sound.play('fight'); this.clearUnits(); this.preview = false; this.fieldKey = ''; }
    if (to === 'shop') { this.cam.goal = this.homeView('shop'); this.clearUnits(); this.preview = false; this.boardKey = ''; this.field = null; this.storms = []; this.shells = []; this.syncStorms(); }
  }
  event(e) {
    const me = this.localId, nm = id => { const p = this.pub && this.pub.pl.find(q => q.id === id); return p ? p.name : '?'; };
    switch (e.t) {
      case 'shop': if (e.round > 1) this.banner(`Round ${e.round} — store open`, 'var(--accent)', 1.4); this.sound.play('roundStart'); break;
      case 'battle': { const fc = e.fac && FACTION_BY_ID.get(e.fac); this.banner(e.pvp ? 'PvP battle!' : e.boss ? e.boss + ' approaches!' : fc ? `Wave ${e.round}: ${fc.icon} ${fc.title}` : `Wave ${e.round}`, e.boss ? '#ff6a3a' : fc ? fc.color : '#ff8a5a', 1.6); break; }
      case 'merge': if (e.p === me) { const c = this.ac.byId.get(e.id); this.toast(`${c ? c.name : 'Card'} combined: now Lv ${e.rank}`); this.sound.play('powerUp'); } break;
      case 'nope': if (e.p === me) this.nope(); break;
      case 'gain': if (e.p === me) { const c = this.ac.byId.get(e.id), w = e.with && this.ac.byId.get(e.with); this.toast(e.why === 'squad' ? `${c ? c.name : 'Card'} + ${w ? w.name : 'squadmate'}: +1 permanent unit` : `${c ? c.name : 'Card'} recruited +${e.n} unit${e.n === 1 ? '' : 's'}`); } break;
      case 'promote': if (e.p === me) { const c = this.ac.byId.get(e.id); this.toast(`Field Promotion: ${c ? c.name : 'card'} is now Lv ${e.rank}`); } break;
      case 'storeUp': if (e.p === me) { this.toast(`Store level ${e.level}` + (e.level > AMON.tierCapLevel ? ` — Command bonus +${Math.round((e.level - AMON.tierCapLevel) * AMON.commandPerLevel * 100)}%` : '')); this.sound.play('cardPick'); } break;
      case 'transfer': {
        const mine = (e.toOwners || []).includes(me);
        if (mine) this.toast(e.side === 1 ? `Enemies from ${nm(e.owners[0])}'s field are coming at you!` : `${nm(e.owners[0])}'s survivors arrive to help`);
        break;
      }
      case 'result': this.sound.play(e.pvp ? 'roundWin' : e.cleared ? 'roundWin' : 'roundLose'); break;
      case 'bossAgain': this.banner('The boss still stands — face it again', '#ff6a3a', 2.2); break;
      case 'choice': this.sound.play(e.why === 'lost' || e.why === 'boss' ? 'defeat' : 'victory'); break;
      case 'extend': this.banner(`+10 rounds — now to round ${e.final}`, '#ffd166', 2); break;
      case 'vsOut': this.banner(`${e.name} is knocked out`, '#ff6a8a', 2); if (e.p === this.localId) this.toast('You are out. Watch the rest of the fight from any field (Q / E).'); break;
      case 'pvpStart': this.banner('PvP: may the strongest board win', '#ff6a8a', 2); break;
      case 'pilot': if (e.p === me) {
        if (e.u) {
          this.pilotU = e.u; this.pilotBlock = !!e.blocker; this.selU = e.u;
          if (e.f !== this.viewF) { this.viewF = e.f; this.act({ t: 'view', f: e.f }); }
          this.manualView = true; this.cam.goal = null; this.cam.d = Math.min(this.cam.d, 30);
          this.banner('You take control: ' + unitDef(e.unit).name, '#7fd0ff', 1.3); this.sound.play('powerUp');
        } else if (this.pilotU) { this.pilotU = 0; this.toast('Back to the commander\'s view'); }
      } break;
    }
  }
  // combat sounds get quieter (and sparser) the busier the fight is, so a big battle doesn't turn into noise
  cSfx(name, vol, gap) {
    this.busy = (this.busy || 0) + 1;
    if (this.sfxT > 0) return;
    const k = 1 / (1 + this.busy * 0.12);
    this.sound.play(name, vol * Math.max(0.15, k)); this.sfxT = gap * (1 + Math.min(3, this.busy * 0.05));
  }
  fieldEvent(e) {
    const R = this.renderer, y = e.air ? 5 : 0.6, sideCol = SIDE_COLORS[e.side] || '#ffffff';
    switch (e.k) {
      case 'boom': R.burst(e.x, 0.5, e.z, e.side === 0 ? '#ffd27a' : '#ff6a3a', Math.min(30, 6 + e.r * 5), 3 + e.r); R.ring(e.x, 0.15, e.z, e.r, '#ffb04a'); this.cSfx('explode', 0.25, 0.08); break;
      case 'die': R.burst(e.x, e.air ? 5 : 0.6, e.z, e.side === 0 ? '#9fd8ff' : '#ff5a4a', e.big ? 40 : 10, e.big ? 8 : 4); if (e.big) { R.addShake(0.2); this.cSfx('death', 0.5, 0.05); } break;
      case 'chain': R.line(e.x, 1, e.z, e.x2, y, e.z2, '#bfe9ff', 0.25, 0.5); break;
      case 'pierce': R.line(e.x, 0.7, e.z, e.x2, 0.7, e.z2, sideCol, 0.2); break;
      case 'heal': R.line(e.x, 1, e.z, e.x2, 1, e.z2, '#7fff9a', 0.3); break;
      case 'convert': R.line(e.x, 1.2, e.z, e.x2, 1, e.z2, '#ffd23a', 0.6, 0.3); R.burst(e.x2, 1, e.z2, '#ffd23a', 20, 4); this.sound.play('choir', 0.5); break;
      case 'blink': R.burst(e.x, 1, e.z, '#7fb0ff', 14, 4); R.burst(e.x2, 1, e.z2, '#7fb0ff', 14, 4); break;
      case 'yamato': R.line(e.x, 4, e.z, e.x2, y, e.z2, '#ff9a3a', 0.5); R.burst(e.x2, y, e.z2, '#ffb04a', 50, 9); R.addShake(0.25); this.sound.play('explode', 0.7); break;
      case 'storm': R.ring(e.x, 0.2, e.z, e.r, '#7fb0ff'); this.sound.play('bounce', 0.4); break;
      case 'quake': R.ring(e.x, 0.2, e.z, e.r, '#c0a070'); R.burst(e.x, 0.4, e.z, '#a08a6a', 40, 8); R.addShake(0.3); this.sound.play('explode', 0.6); break;
      case 'impact': R.burst(e.x, 1, e.z, '#ff7a1a', 90, 12); R.ring(e.x, 0.2, e.z, e.r, '#ff4a1a'); R.addShake(0.5); this.sound.play('explode'); break;
      case 'spawn': case 'raise': case 'summon': case 'echo': R.burst(e.x, 0.8, e.z, e.k === 'echo' ? '#ffffff' : '#c58bff', e.k === 'summon' ? 50 : 12, 4); break;
      case 'charge': R.burst(e.x, 0.6, e.z, '#ffffff', 8, 4); break;
      case 'phase': R.burst(e.x, 5, e.z, '#c58bff', 6, 3); break;
      case 'arrive': this.toast(e.side === 1 ? `${e.n} enemies broke through from another field!` : `${e.n} allies arrive from another field`); break;
      case 'bossDown': this.banner(`${e.name} falls!`, 'var(--accent)', 2.2); R.burst(e.x, 2, e.z, '#ff8a2a', 140, 14); R.addShake(0.6); this.sound.play('explode'); break;
      case 'form': if (e.side === this.mySide()) { this.toast('Contact! The formation breaks'); this.sound.play('bounce', 0.4); } break;
      case 'whiff': if (e.melee) R.burst(e.x2, 0.8, e.z2, '#ffffff', 4, 2); else R.line(e.x, 0.8, e.z, e.x2, 0.8, e.z2, sideCol, 0.08); this.cSfx('shoot', 0.12, 0.04); break;
      case 'dash': R.burst(e.x, 0.6, e.z, '#ffd166', 18, 5); this.sound.play('jump', 0.4); break;
      case 'heavy': R.burst(e.x, y, e.z, '#ffd166', 26, 6); R.ring(e.x, 0.2, e.z, 1.6, '#ffd166'); this.sound.play('hit', 0.5); break;
      case 'block': R.burst(e.x, 1.2, e.z, '#cfe4ff', 10, 3); this.cSfx('bounce', 0.3, 0.04); break;
      case 'done': if (this.pub && this.pub.ph === 'battle') this.toast(e.w === 0 ? 'This field is clear' : e.w === 1 ? 'This field fell' : 'Stalemate on this field'); break;
    }
  }

  // ---------------------------------------------------------------- 3D: ground and props
  buildGround(theme, obstacles) {
    this.lastGround = [theme, obstacles];
    if (this.ground) { this.root.remove(this.ground); }
    const L = THEME_LOOK[theme] || THEME_LOOK.grass, G = this.ground = new THREE.Group();
    this.root.add(G);
    const W = HX * 2 + 80, D = HZ * 2 + 80;
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
    const x = cv.getContext('2d');
    x.fillStyle = L.ground; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2500; i++) { x.fillStyle = Math.random() < 0.5 ? L.ground2 : shade(L.ground, 0.9); x.globalAlpha = 0.35; const s = 2 + Math.random() * 7; x.fillRect(Math.random() * 512, Math.random() * 512, s, s); }
    x.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(W / 24, D / 24);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; G.add(floor);
    // deployment zones and the field border
    const zone = (x0, x1, color) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, HZ * 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.03, 0); G.add(m); };
    zone(-HX, -26, '#4aa8ff'); zone(26, HX, '#ff5a4a');
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(HX * 2, 0.01, HZ * 2)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
    edge.position.y = 0.05; G.add(edge);
    // swamp water and moon craters: flat ground decals (no collision)
    if (theme === 'swamp' || theme === 'moon') {
      const r0 = (() => { let s = 99 + theme.length; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
      for (let i = 0; i < 14; i++) {
        const r = 3 + r0() * 6, m = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshLambertMaterial({ color: theme === 'swamp' ? L.water : shade(L.ground, 0.75), transparent: theme === 'swamp', opacity: 0.85 }));
        m.rotation.x = -Math.PI / 2; m.position.set((r0() - 0.5) * HX * 2, 0.02, (r0() - 0.5) * HZ * 2); G.add(m);
        if (theme === 'moon') { const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.35, 4, 24), mat(shade(L.ground, 1.15))); rim.rotation.x = -Math.PI / 2; rim.position.copy(m.position); rim.position.y = 0.05; G.add(rim); }
      }
    }
    for (const o of obstacles) {
      const k = o.k || 'rock', t = new THREE.Group(), r = o.r;
      if (k === 'pillar') { part(t, 'cyl', L.rock, 0, r * 2.2, 0, r * 1.6, r * 4.4, r * 1.6); part(t, 'box', shade(L.rock, 1.1), 0, r * 4.5, 0, r * 2.2, r * 0.4, r * 2.2); part(t, 'box', shade(L.rock, 0.9), 0, 0.2, 0, r * 2.2, 0.4, r * 2.2); }
      else if (k === 'tree') {
        const trunk = theme === 'crystal' || theme === 'moon' ? L.prop : '#5a3a2a';
        if (theme === 'desert') { part(t, 'cyl', L.prop, 0, r * 1.6, 0, r * 0.9, r * 3.2, r * 0.9); part(t, 'cyl', L.prop, r * 0.8, r * 2, 0, r * 0.5, r * 1.2, r * 0.5); }
        else if (theme === 'swamp') { part(t, 'cyl', '#d8d0b8', 0, r * 0.7, 0, r * 0.5, r * 1.4, r * 0.5); part(t, 'sph', '#a83a3a', 0, r * 1.5, 0, r * 2.4, r * 1, r * 2.4); }
        else if (theme === 'ash') { part(t, 'cyl', '#2a2222', 0, r * 1.6, 0, r * 0.4, r * 3.2, r * 0.4); part(t, 'cyl', '#2a2222', r * 0.5, r * 2.4, 0, r * 0.2, r * 1.4, r * 0.2, 0, 0, -0.7); }
        else if (theme === 'crystal' || theme === 'moon') part(t, 'cone', L.prop, 0, r * 1.5, 0, r * 1.6, r * 3, r * 1.6, 0, 0, 0, 0.35);
        else { part(t, 'cyl', trunk, 0, r * 0.8, 0, r * 0.5, r * 1.6, r * 0.5); part(t, 'cone', theme === 'snow' ? '#244a3c' : L.prop, 0, r * 2.4, 0, r * 2.4, r * 3, r * 2.4); }
      }
      else if (k === 'crate') { part(t, 'box', '#8a6a3a', 0, r * 0.7, 0, r * 1.4, r * 1.4, r * 1.4, 0, o.x, 0); part(t, 'box', '#6a4a2a', 0, r * 0.7, 0, r * 1.45, r * 0.2, r * 1.45, 0, o.x, 0); }
      else if (k === 'ruin') { const c = shade(L.rock, 1.05); part(t, 'box', c, 0, r * 0.5, 0, r * 1.8, r, r * 1.4, 0, o.z, 0); part(t, 'box', shade(c, 0.9), r * 0.3, r * 1.3, 0, r * 0.6, r * 0.8, r * 1.2, 0, o.z, 0.1); part(t, 'box', shade(c, 0.85), -r * 0.6, r * 0.2, r * 0.6, r * 0.5, r * 0.4, r * 0.5); }
      else if (k === 'shard' || (k === 'rock' && theme === 'crystal')) part(t, 'cone', theme === 'crystal' ? L.rock : '#8ad0ff', 0, r * 0.85, 0, r * 1.4, r * 1.7, r * 1.4, 0, 0, 0, 0.3);
      else { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mat(L.rock)); m.position.y = r * 0.45; m.scale.y = 0.65; t.add(m); }
      t.position.set(o.x, 0, o.z); t.rotation.y = o.x * 3.1;
      t.traverse(m => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
      G.add(t);
    }
    // scenery outside the field
    const rnd = (() => { let s = 1234 + theme.length * 77; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    for (let i = 0; i < 70; i++) {
      const sideX = rnd() < 0.5, px = sideX ? (rnd() < 0.5 ? -1 : 1) * (HX + 6 + rnd() * 30) : (rnd() - 0.5) * (HX * 2 + 60), pz = sideX ? (rnd() - 0.5) * (HZ * 2 + 60) : (rnd() < 0.5 ? -1 : 1) * (HZ + 6 + rnd() * 30);
      const h = 3 + rnd() * 5, t = new THREE.Group();
      if (theme === 'desert') { part(t, 'cyl', L.prop, 0, h / 2, 0, 0.7, h, 0.7); part(t, 'cyl', L.prop, 0.6, h * 0.6, 0, 0.4, h * 0.35, 0.4); }
      else if (theme === 'ash' || theme === 'crystal' || theme === 'moon') part(t, 'cone', L.prop, 0, h / 2, 0, 1.6, h, 1.6, 0, 0, 0, theme === 'ash' ? 0.2 : 0.4);
      else if (theme === 'swamp') { part(t, 'cyl', '#d8d0b8', 0, h * 0.25, 0, 0.6, h * 0.5, 0.6); part(t, 'sph', rnd() < 0.5 ? '#a83a3a' : '#8a6aa8', 0, h * 0.55, 0, 3, 1.2, 3); }
      else if (theme === 'ruins') { part(t, 'cyl', L.rock, 0, h / 2, 0, 1.4, h, 1.4); if (rnd() < 0.5) part(t, 'box', L.rock, 0.8, h + 0.3, 0, 3, 0.6, 1.6); }
      else { part(t, 'cyl', '#5a3a2a', 0, h * 0.2, 0, 0.5, h * 0.4, 0.5); part(t, 'cone', L.prop, 0, h * 0.65, 0, 3, h * 0.8, 3); }
      t.position.set(px, 0, pz); G.add(t);
    }
    const R = this.renderer;
    R.scene.background = new THREE.Color(L.sky);
    R.scene.fog = new THREE.Fog(L.sky, 140, 320);
    if (R.sun) { R.sun.position.set(40, 90, 50); R.sun.target.position.set(0, 0, 0); if (R.sun.shadow && R.sun.shadow.camera) { const c = R.sun.shadow.camera; c.left = -90; c.right = 90; c.top = 70; c.bottom = -70; c.far = 260; c.updateProjectionMatrix(); } }
  }

  // ---------------------------------------------------------------- 3D: units
  clearUnits() { for (const [, e] of this.units) this.unitRoot.remove(e.g); this.units.clear(); }
  ownerColor(idx) { const p = this.pub && this.pub.pl[idx]; return p ? p.color : null; }
  makeEntry(id, type, side, owner) {
    const fac = side === 1 && owner < 0 && this.pub && this.pub.fac && FACTION_BY_ID.get(this.pub.fac);
    const def = unitDef(type), g = new THREE.Group(), body = bakedUnit(def, side, fac ? fac.color : this.ownerColor(owner), fac && def.look.shape !== 'boss' ? fac.id : null);
    const s = def.size, vis = visScale(def); body.scale.setScalar(vis);
    g.add(body);
    if (s >= 1.2) body.traverse(o => { if (o.isMesh) o.castShadow = true; });
    const bar = new THREE.Group(), bw = Math.max(1.2, vis * 1.1);
    const bg = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ color: 0x220000, depthTest: false })); bg.scale.set(bw, 0.14, 1);
    const fg = new THREE.Mesh(geo.plane, new THREE.MeshBasicMaterial({ color: side === 0 ? 0x5fd17a : 0xff5a4a, depthTest: false })); fg.scale.set(bw, 0.14, 1); fg.position.z = 0.001;
    bg.renderOrder = fg.renderOrder = 999;
    bar.add(bg, fg); bar.position.y = vis * 1.7 + 0.4; bar.visible = false;
    g.add(bar);
    this.unitRoot.add(g);
    const fly = def.air ? 4 + s * 1.2 : 0;
    return { id, type, def, side, owner, g, body, bar, fg, bw, fly, x: 0, z: 0, tx: 0, tz: 0, yaw: side === 0 ? 0 : Math.PI, atkN: -1, tgt: 0, hp: 100, flags: 0, seen: true, ph: Math.random() * 6 };
  }
  syncUnits(rows) {
    for (const [, e] of this.units) e.seen = false;
    for (const r of rows) {
      const [id, type, side, x, z, hp, tgt, atkN, flags, owner, name] = r;
      let e = this.units.get(id);
      if (e && (e.type !== type || e.side !== side)) { this.unitRoot.remove(e.g); this.units.delete(id); e = null; }   // converted units change sides
      if (!e) { e = this.makeEntry(id, type, side, owner); e.x = e.tx = x; e.z = e.tz = z; e.atkN = atkN; this.units.set(id, e); }
      if (Math.hypot(x - e.x, z - e.z) > 12) { e.x = x; e.z = z; }
      e.tx = x; e.tz = z; e.hp = hp; e.tgt = tgt; e.flags = flags; e.seen = true; e.name = name;
      if (atkN !== e.atkN) { const first = e.atkN < 0; e.atkN = atkN; if (!first) this.attackFx(e); }
    }
    for (const [id, e] of this.units) if (!e.seen) { this.unitRoot.remove(e.g); this.units.delete(id); }
    if (this.selU && !this.units.has(this.selU) && !this.preview) this.selU = 0;
    if (this.pilotU && !this.units.has(this.pilotU) && this.field && this.field.id === this.viewF) { this.pilotU = 0; this.toast('Your unit fell. Pick another one and press Space'); this.sound.play('death', 0.6); }
  }
  attackFx(e) {
    const t = this.units.get(e.tgt), d = e.def, R = this.renderer;
    if (d.shell || (e.flags & 1)) { this.cSfx('shoot', 0.15, 0.05); return; }   // shells are drawn on their own
    if (!t || d.ab && d.ab.pierce) return;
    const y0 = e.fly + visScale(d) * 0.7, y1 = t.fly + visScale(t.def) * 0.5;
    if (d.range > 3 || d.look.shape === 'boss') {
      const beam = d.look.shape === 'tank' && d.ab && d.ab.chain;
      R.line(e.x, y0, e.z, t.x, y1, t.z, beam ? '#7fe0ff' : SIDE_COLORS[e.side], beam ? 0.25 : 0.08, beam ? 0.3 : 0);
    } else R.burst(t.x, y1, t.z, '#ffffff', 3, 2);
    this.cSfx('shoot', 0.12, 0.04);
  }
  updateUnits(dt) {
    const k0 = 1 - Math.exp(-dt * 10), kp = 1 - Math.exp(-dt * 30), now = performance.now() / 1000, cq = this.renderer.camera.quaternion;
    for (const [, e] of this.units) {
      const dx = e.tx - e.x, dz = e.tz - e.z, k = e.id === this.pilotU ? kp : k0;   // v1.2.6: the unit you drive follows its updates 3x as tightly
      e.x += dx * k; e.z += dz * k;
      const moving = Math.hypot(dx, dz) > 0.05;
      let face = null;
      const t = e.tgt && this.units.get(e.tgt);
      if (t) face = Math.atan2(-(t.z - e.z), t.x - e.x); else if (moving) face = Math.atan2(-dz, dx);
      if (face != null) { let d = face - e.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); e.yaw += d * Math.min(1, dt * 8); }
      const bob = moving && !e.def.air ? Math.abs(Math.sin(now * 10 + e.ph)) * 0.12 * e.def.size : e.def.air ? Math.sin(now * 2 + e.ph) * 0.3 : 0;
      e.g.position.set(e.x, e.fly + bob, e.z);
      e.body.rotation.y = e.yaw;
      const P = e.body.userData.parts;
      if (P.halo) P.halo.rotation.z = now * 1.5;
      if (P.wl) { P.wl.rotation.x = 0.3 + Math.sin(now * 8 + e.ph) * 0.4; P.wr.rotation.x = -P.wl.rotation.x; }
      if (P.barrel && e.def.look.shape === 'tank') P.barrel.scale.x = (e.flags & 1) ? 1.8 : 1;
      if (P.turret) P.turret.position.y = (e.flags & 1) ? 0.5 : 0.6;
      e.g.visible = !(e.flags & 2) || (Math.floor(now * 6) % 3 === 0);
      if ((e.flags & 520) && Math.random() < dt * 6) this.renderer.burst(e.x, e.fly + 0.8 * e.def.size, e.z, (e.flags & 512) && (!(e.flags & 8) || Math.random() < 0.5) ? '#8aff4a' : '#ff8a2a', 3, 1.5);   // burning / poisoned
      e.bar.visible = e.hp < 100 || !!(e.flags & 32);
      if (e.bar.visible) { e.fg.scale.x = e.bw * e.hp / 100; e.fg.position.x = -e.bw * (1 - e.hp / 100) / 2; e.bar.quaternion.copy(cq); }
    }
    // shells
    this.shellMeshes = this.shellMeshes || [];
    while (this.shellMeshes.length < this.shells.length) { const m = new THREE.Mesh(geo.sph, mat('#ffd27a', 0.8)); this.root.add(m); this.shellMeshes.push(m); }
    this.shellMeshes.forEach((m, i) => {
      const s = this.shells[i]; m.visible = !!s; if (!s) return;
      s.t = Math.min(s.dur, s.t + dt);
      const f = s.t / s.dur, h = Math.min(18, 3 + s.dur * 6);
      if (s.big === 2) {   // a sticky bomb stuck on its target: blinks faster as it is about to go off
        m.position.set(s.x1, 0.9, s.z1); m.scale.setScalar(0.28 + 0.12 * Math.abs(Math.sin(now * (6 + f * 20))));
        m.material = mat('#ff3a2a', 1); return;
      }
      m.position.set(s.x0 + (s.x1 - s.x0) * f, 0.8 + 4 * h * f * (1 - f), s.z0 + (s.z1 - s.z0) * f);
      m.scale.setScalar(s.big ? 0.6 : 0.35);
      m.material = mat(s.side === 0 ? '#ffd27a' : '#ff7a4a', 0.8);
    });
    // mines
    this.mineMeshes = this.mineMeshes || [];
    while (this.mineMeshes.length < this.mines.length) { const m = new THREE.Mesh(geo.cyl, mat('#3a3a3a')); const l = new THREE.Mesh(geo.sph, mat('#ff3a2a', 1)); l.scale.set(0.35, 0.35, 0.35); l.position.y = 0.5; m.add(l); m.scale.set(0.9, 0.18, 0.9); this.root.add(m); this.mineMeshes.push(m); }
    this.mineMeshes.forEach((m, i) => { const q = this.mines[i]; m.visible = !!q; if (!q) return; m.position.set(q[0], 0.1, q[1]); m.children[0].visible = Math.floor(now * 3 + i) % 2 === 0; m.children[0].material = mat(q[2] === 0 ? '#7fd0ff' : '#ff3a2a', 1); });
    // the unit you picked (or drive): a ring under it
    const sel = (this.pilotU || this.selU) && this.units.get(this.pilotU || this.selU);
    if (!this.selRing) { this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })); this.selRing.rotation.x = -Math.PI / 2; this.root.add(this.selRing); }
    this.selRing.visible = !!sel;
    if (sel) { const r = Math.max(0.9, visScale(sel.def) * 0.8); this.selRing.position.set(sel.x, sel.fly + 0.08, sel.z); this.selRing.scale.set(r, r, r); this.selRing.material.color.set(this.pilotU ? '#ffd166' : '#7fd0ff'); }
    if (!this.aimRing) { this.aimRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 24), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })); this.aimRing.rotation.x = -Math.PI / 2; this.root.add(this.aimRing); }
    this.aimRing.visible = !!(this.pilotU && this.aim);
    if (this.aimRing.visible) this.aimRing.position.set(this.aim.x, 0.1, this.aim.z);
    this.syncStorms(now);
  }
  syncStorms(now = 0) {
    this.stormMeshes = this.stormMeshes || [];
    const list = this.storms || [];
    while (this.stormMeshes.length < list.length) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 6, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fb0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      this.root.add(m); this.stormMeshes.push(m);
    }
    this.stormMeshes.forEach((m, i) => {
      const s = list[i]; m.visible = !!s; if (!s) return;
      m.position.set(s[0], 3, s[1]); m.scale.set(s[2], 1, s[2]); m.material.opacity = 0.15 + 0.1 * Math.abs(Math.sin(now * 9 + i));
      if (Math.random() < 0.25) this.renderer.line(s[0] + (Math.random() - 0.5) * s[2], 8, s[1] + (Math.random() - 0.5) * s[2], s[0] + (Math.random() - 0.5) * s[2], 0.2, s[1] + (Math.random() - 0.5) * s[2], '#cfe4ff', 0.12, 0.6);
    });
  }
  // Store phase: your board, standing in formation on the field
  showPreview(me) {
    this.clearUnits();
    this.preview = true;
    const army = computeArmy(me.bo.map(x => x ? { id: x[0], rank: x[1], grow: (x[2] || 0) / 100, bonus: x[3] || 0 } : null), this.ac.byId, me.lv);
    const idx = this.pub.pl.indexOf(me);
    let id = 1;
    this.placeSel = (this.placeSel || []).filter(c => army.groups.some(g => g.cell === c));
    for (const g of army.groups) {
      const at = me.bo[g.cell] && me.bo[g.cell][4];
      const def = unitDef(g.unit), x0 = at ? at[0] : -30 - g.r * 6.5, z0 = at ? at[1] : (g.c - 2) * 14, cols = Math.ceil(Math.sqrt(g.n)), sp = Math.max(1.1, def.size * 1.6);
      for (let k = 0; k < g.n; k++) {
        const ox = ((k / cols) | 0) - (cols - 1) / 2, oz = (k % cols) - (cols - 1) / 2;
        const e = this.makeEntry('p' + id++, def.id, 0, idx);
        e.x = e.tx = x0 - ox * sp * 0.8; e.z = e.tz = z0 + oz * sp; e.yaw = 0; e.cell = g.cell;
        this.units.set(e.id, e);
      }
    }
    this.placeMarks();
  }

  // ---------------------------------------------------------------- camera
  homeView(ph) { return ph === 'shop' ? { x: -43, z: 0, d: 40, yaw: 0, tilt: TILT0 } : { x: 0, z: 0, d: 72, yaw: 0, tilt: TILT0 }; }
  resetView() { this.cam.goal = this.homeView(this.pub && this.pub.ph === 'shop' ? 'shop' : 'battle'); this.sound.play('ui'); }
  updateCamera(dt) {
    const c = this.cam, K = this.keys || {}, sp = c.d * 0.9 * dt, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const piloted = this.pilotU && this.units.get(this.pilotU);
    if (piloted) { const k = 1 - Math.exp(-dt * 6); c.x += (piloted.x - c.x) * k; c.z += (piloted.z - c.z) * k; c.goal = null; }   // follow the unit you drive (WASD steers it)
    else if (!document.activeElement || !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
      const f = (K.KeyS || K.ArrowDown ? 1 : 0) - (K.KeyW || K.ArrowUp ? 1 : 0), r = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
      if (f || r) { c.x += (r * cs + f * sn) * sp; c.z += (-r * sn + f * cs) * sp; c.goal = null; }
    }
    if (c.goal) {
      const g = c.goal, k = 1 - Math.exp(-dt * 3);
      c.x += (g.x - c.x) * k; c.z += (g.z - c.z) * k; c.d += (g.d - c.d) * k;
      if (g.yaw != null) { const dy = Math.atan2(Math.sin(g.yaw - c.yaw), Math.cos(g.yaw - c.yaw)); c.yaw += dy * k; c.tilt += (g.tilt - c.tilt) * k; }
      if (Math.hypot(g.x - c.x, g.z - c.z) < 0.2 && Math.abs(g.d - c.d) < 0.2 && (g.yaw == null || Math.abs(Math.sin(g.yaw - c.yaw)) < 0.003)) c.goal = null;   // arrived: let go
    }
    c.x = clamp(c.x, -HX - 10, HX + 10); c.z = clamp(c.z, -HZ - 10, HZ + 10);
    // camera shake is kept to a faint tremor here (Devin: constant shaking gave him a headache); the renderer's own shake is swallowed
    this.shk = Math.max(Math.max(0, (this.shk || 0) - dt * 3), this.renderer.shake || 0); this.renderer.shake = 0;
    const cam = this.renderer.camera, shake = this.shk * 0.05;
    // the store panel covers the bottom of the screen: aim a little lower so the army sits above it
    const off = this.pub && this.pub.ph === 'shop' ? c.d * 0.28 : 0;
    const ux = Math.sin(c.yaw), uz = Math.cos(c.yaw), D = c.d * 1.028, h = Math.cos(c.tilt) * D;
    const lx = c.x + ux * off, lz = c.z + uz * off;
    cam.position.set(lx + ux * h + (Math.random() - 0.5) * shake, Math.sin(c.tilt) * D, lz + uz * h + (Math.random() - 0.5) * shake);
    cam.lookAt(lx, 0, lz);
    // Reset view shows once you've moved away from the default view
    const home = this.homeView(this.pub && this.pub.ph === 'shop' ? 'shop' : 'battle');
    const moved = !c.goal && (Math.abs(Math.sin(c.yaw)) > 0.02 || Math.cos(c.yaw) < 0 || Math.abs(c.tilt - TILT0) > 0.03 || Math.abs(c.d - home.d) > 2 || Math.hypot(c.x - home.x, c.z - home.z) > 3);
    if (moved !== this.movedView) { this.movedView = moved; this.$('amReset').classList.toggle('am-hidden', !moved); }
    this.$('amReset2').classList.toggle('am-hidden', !moved || !this.pub || this.pub.ph === 'shop');
  }
  key(e) {
    if (!this.pub || (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      if (this.pilotU) this.act({ t: 'pilot', on: 0 });   // let go
      else if (this.selU && this.pub.ph === 'battle' && this.units.has(this.selU)) this.act({ t: 'pilot', on: 1, u: this.selU });
      else this.resetView();
    }
    if (e.code === 'KeyQ' || e.code === 'KeyE') this.cycleField(e.code === 'KeyQ' ? -1 : 1);
    if (e.code === 'KeyB' && this.pub.ph !== 'shop') { this.showBoard = !this.showBoard; this.renderShop(); }
    if (this.pub.ph !== 'shop' || e.repeat) return;
    if (e.code === 'KeyR') this.act({ t: 'reroll' });
    if (e.code === 'KeyL') this.act({ t: 'lock' });
    if (e.code === 'KeyF') this.act({ t: 'upgrade' });
    if (e.code === 'Enter') { const me = this.me(); if (me) this.act({ t: 'ready', on: !me.rd }); }
    if (/^Digit[1-8]$/.test(e.code)) this.act({ t: 'buy', i: +e.code.slice(5) - 1 });
    if ((e.code === 'Delete' || e.code === 'KeyX') && this.sel && this.sel.w !== 'offer') this.askSell(this.sel.w, this.sel.i);
  }
  mySide() { const me = this.me(); if (!me || !this.field) return 0; const i = this.field.ow.indexOf(me.id); return i < 0 ? 0 : i; }
  myIdx() { return this.pub ? this.pub.pl.findIndex(p => p.id === this.localId) : -1; }
  // Click on the battlefield: pick one of your own units (closest on screen to the click)
  // ---------------------------------------------------------------- store: drag your unit groups to set where they start
  groundAt(cx, cy) {
    const R = this.renderer, rect = R.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((cx - rect.left) / rect.width * 2 - 1, -((cy - rect.top) / rect.height * 2 - 1));
    this.ray = this.ray || new THREE.Raycaster(); this.ray.setFromCamera(ndc, R.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    return d.y < -1e-3 ? { x: o.x + d.x * (-o.y / d.y), z: o.z + d.z * (-o.y / d.y) } : null;
  }
  placeDown(e) {
    const u = this.unitAt(e.clientX, e.clientY, true), sel = this.placeSel || (this.placeSel = []);
    const now = performance.now();
    if (u && u.cell != null) {
      if (this.lastPlaceClick && this.lastPlaceClick.cell === u.cell && now - this.lastPlaceClick.t < 350) {   // double-click: back to its square's spot
        this.act({ t: 'place', reset: [u.cell] }); this.lastPlaceClick = null; return;
      }
      this.lastPlaceClick = { cell: u.cell, t: now };
      if (e.shiftKey || e.ctrlKey) { const i = sel.indexOf(u.cell); if (i >= 0) sel.splice(i, 1); else sel.push(u.cell); }
      else if (!sel.includes(u.cell)) { sel.length = 0; sel.push(u.cell); }
      this.placing = { mode: 'move', from: this.groundAt(e.clientX, e.clientY) };
    } else {
      if (!e.shiftKey && !e.ctrlKey) sel.length = 0;
      this.placing = { mode: 'box', x0: e.clientX, y0: e.clientY };
    }
    this.placeMarks();
  }
  placeMove(e) {
    const P = this.placing;
    if (P.mode === 'box') {
      const b = this.$('amSelBox'), x = Math.min(P.x0, e.clientX), y = Math.min(P.y0, e.clientY);
      Object.assign(b.style, { left: x + 'px', top: y + 'px', width: Math.abs(e.clientX - P.x0) + 'px', height: Math.abs(e.clientY - P.y0) + 'px' });
      b.classList.toggle('am-hidden', Math.abs(e.clientX - P.x0) + Math.abs(e.clientY - P.y0) < 6);
      return;
    }
    const g = this.groundAt(e.clientX, e.clientY); if (!g || !P.from) return;
    let dx = g.x - P.from.x, dz = g.z - P.from.z;
    // keep every selected unit inside your deploy zone
    for (const [, u] of this.units) if (this.placeSel.includes(u.cell)) {
      dx = clamp(u.x + dx, -HX + 1, AMON.deployMaxX + 1) - u.x; dz = clamp(u.z + dz, -HZ + 1, HZ - 1) - u.z;
    }
    for (const [, u] of this.units) if (this.placeSel.includes(u.cell)) { u.x += dx; u.tx = u.x; u.z += dz; u.tz = u.z; }
    P.from = { x: P.from.x + dx, z: P.from.z + dz }; P.moved = true;
    this.placeMarks();
  }
  placeUp(e) {
    const P = this.placing; this.placing = null;
    if (P.mode === 'box') {
      this.$('amSelBox').classList.add('am-hidden');
      if (Math.abs(e.clientX - P.x0) + Math.abs(e.clientY - P.y0) >= 6) {
        const R = this.renderer, rect = R.canvas.getBoundingClientRect(), v = new THREE.Vector3();
        const x0 = Math.min(P.x0, e.clientX), x1 = Math.max(P.x0, e.clientX), y0 = Math.min(P.y0, e.clientY), y1 = Math.max(P.y0, e.clientY);
        for (const [, u] of this.units) {
          if (u.cell == null || this.placeSel.includes(u.cell)) continue;
          v.set(u.x, u.fly + 0.5, u.z).project(R.camera);
          const sx = rect.left + (v.x + 1) / 2 * rect.width, sy = rect.top + (1 - v.y) / 2 * rect.height;
          if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) this.placeSel.push(u.cell);
        }
      }
      this.placeMarks(); return;
    }
    if (!P.moved) return;
    // each moved group's new spot: its formation's anchor (the same point the server lays the group out around)
    const moves = [];
    for (const cell of this.placeSel) {
      const list = [...this.units.values()].filter(u => u.cell === cell); if (!list.length) continue;
      const cx = list.reduce((a, u) => a + u.x, 0) / list.length, cz = list.reduce((a, u) => a + u.z, 0) / list.length;
      moves.push([cell, Math.round(cx * 10) / 10, Math.round(cz * 10) / 10]);
    }
    if (moves.length) { this.act({ t: 'place', moves }); this.sound.play('ui'); if (!this.placeTold) { this.placeTold = true; this.toast('Start positions saved. Double-click a group to send it back to its square\'s spot'); } }
  }
  // rings under the groups you have selected for moving
  placeMarks() {
    this.placeRings = this.placeRings || [];
    const sel = this.preview ? (this.placeSel || []) : [];
    const list = [...this.units.values()].filter(u => u.cell != null && sel.includes(u.cell));
    while (this.placeRings.length < list.length) { const m = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 20), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; this.root.add(m); this.placeRings.push(m); }
    this.placeRings.forEach((m, i) => { const u = list[i]; m.visible = !!u; if (u) { const r = Math.max(0.8, visScale(u.def) * 0.7); m.position.set(u.x, 0.06, u.z); m.scale.set(r, r, r); } });
  }
  unitAt(cx, cy, any) {
    const R = this.renderer, rect = R.canvas.getBoundingClientRect(), mi = this.myIdx(), v = new THREE.Vector3();
    let best = null, bd = 34;
    for (const [, e] of this.units) {
      if (!any && e.owner !== mi) continue;
      v.set(e.x, e.fly + visScale(e.def) * 0.5, e.z).project(R.camera);
      if (v.z > 1) continue;
      const sx = rect.left + (v.x + 1) / 2 * rect.width, sy = rect.top + (1 - v.y) / 2 * rect.height;
      const d = Math.hypot(sx - cx, sy - cy) - visScale(e.def) * 3;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  pickUnit(cx, cy) {
    if (!this.pub || this.pub.ph !== 'battle' || this.preview) return;
    const R = this.renderer, rect = R.canvas.getBoundingClientRect(), mi = this.myIdx(), v = new THREE.Vector3();
    let best = null, bd = 34;
    for (const [, e] of this.units) {
      if (e.owner !== mi) continue;
      v.set(e.x, e.fly + visScale(e.def) * 0.5, e.z).project(R.camera);
      if (v.z > 1) continue;
      const sx = rect.left + (v.x + 1) / 2 * rect.width, sy = rect.top + (1 - v.y) / 2 * rect.height;
      const d = Math.hypot(sx - cx, sy - cy) - visScale(e.def) * 3;
      if (d < bd) { bd = d; best = e; }
    }
    if (best) {
      if (best.id !== this.selU) { this.selU = best.id; this.toast(`${best.def.name} selected: press Space to take control`); this.sound.play('ui'); }
    } else this.selU = 0;
  }
  // While you drive a unit: WASD steers (relative to the camera), the mouse aims, left button attacks, right button blocks.
  pilotTick(dt) {
    if (!this.pilotU) { const pb = this.$('amPilot'); if (!pb.classList.contains('am-hidden')) pb.classList.add('am-hidden'); return; }
    const K = this.keys || {}, c = this.cam, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const typing = document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    const f = typing ? 0 : (K.KeyS || K.ArrowDown ? 1 : 0) - (K.KeyW || K.ArrowUp ? 1 : 0), r = typing ? 0 : (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0);
    const mx = r * cs + f * sn, mz = -r * sn + f * cs;
    // aim: where the mouse points on the ground
    const R = this.renderer, rect = R.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((this.mouse.x - rect.left) / rect.width * 2 - 1, -((this.mouse.y - rect.top) / rect.height * 2 - 1));
    this.ray = this.ray || new THREE.Raycaster(); this.ray.setFromCamera(ndc, R.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (d.y < -1e-3) { const t = -o.y / d.y; this.aim = { x: o.x + d.x * t, z: o.z + d.z * t }; }
    const overUi = document.elementFromPoint(this.mouse.x, this.mouse.y) !== R.canvas;
    const fire = !!K.Mouse0 && !overUi, block = !!K.Mouse2 && this.pilotBlock;
    const dash = !typing && !!(K.ShiftLeft || K.ShiftRight) && !this.dashHeld; this.dashHeld = !!(K.ShiftLeft || K.ShiftRight);
    const inp = { t: 'pin', mx, mz, ax: this.aim ? Math.round(this.aim.x * 10) / 10 : undefined, az: this.aim ? Math.round(this.aim.z * 10) / 10 : undefined, fire, block, dash };
    this.pinT -= dt;
    const key = [mx, mz, fire, block].join();
    if (dash || this.pinT <= 0 || key !== this.pinKey) { this.pinT = 1 / 15; this.pinKey = key; this.act(inp); }
    // HUD
    const e = this.units.get(this.pilotU), pb = this.$('amPilot');
    if (e) {
      const html = `<div><span class="lbl" style="opacity:.6">Controlling</span> <b>${esc(e.def.name)}</b></div><div class="hb"><i style="width:${e.hp}%"></i></div><div style="opacity:.75">WASD move · mouse aim · left button attack${this.pilotBlock ? ' · right button block' : ' · this unit can\'t block'} · Shift dash · Space let go</div><div style="opacity:.6;font-size:12px">Under your command: +20% damage, faster attacks, 15% tougher, every 4th hit is a heavy blow</div>`;
      if (html !== this.pilotKey) { this.pilotKey = html; pb.innerHTML = html; }
      pb.classList.remove('am-hidden');
    }
  }
  cycleField(dir) {
    if (!this.pub || !this.pub.fl.length) return;
    const ids = this.pub.fl.map(f => f[0]), i = ids.indexOf(this.viewF);
    const next = ids[(i + dir + ids.length) % ids.length];
    this.act({ t: 'view', f: next }); this.viewF = next; this.manualView = true;
  }

  // ---------------------------------------------------------------- store UI
  bindUI() {
    this.$('amUp').onclick = () => this.act({ t: 'upgrade' });
    this.$('amRoll').onclick = () => { this.act({ t: 'reroll' }); this.sound.play('reroll'); };
    this.$('amLock').onclick = () => this.act({ t: 'lock' });
    this.$('amReady').onclick = () => { const me = this.me(); if (me) this.act({ t: 'ready', on: !me.rd }); this.sound.play('ui'); };
    this.$('amBag').onclick = () => { if (this.sel && this.sel.w !== 'offer') this.askSell(this.sel.w, this.sel.i); };
    this.$('amReset').onclick = () => this.resetView(); this.$('amReset2').onclick = () => this.resetView();
    this.$('amConfirm').addEventListener('click', e => {
      const b = e.target.closest('[data-yes],[data-no]'); if (!b) return;
      const q = this.sellAsk; this.sellAsk = null; this.$('amConfirm').classList.add('am-hidden');
      if (b.dataset.yes != null && q) { this.act({ t: 'sell', w: q.w, i: q.i }); this.sel = null; this.sound.play('coin'); this.renderShop(); }
    });
    const grid = this.$('amGrid');
    grid.innerHTML = Array.from({ length: CELLS }, (_, i) => `<div class="am-cell" data-cell="${i}"></div>`).join('');
    this.el.addEventListener('click', e => {
      const o = e.target.closest('[data-offer]'), b = e.target.closest('[data-bench]'), c = e.target.closest('[data-cell]');
      if (!this.pub || this.pub.ph !== 'shop') return;
      if (o) { if (this.canAfford()) { this.act({ t: 'buy', i: +o.dataset.offer }); this.sound.play('cardPick'); } return; }
      if (b) return this.clickSlot('bench', +b.dataset.bench, !!b.dataset.full);
      if (c) return this.clickSlot('board', +c.dataset.cell, !!c.dataset.full);
    });
    // drag and drop between the bench, the board and the sell button
    // drag and drop: store -> bench / board buys it there (onto a copy combines them), bench <-> board moves,
    // a card dropped on a copy of itself combines, and the money bag sells (after a yes)
    this.el.addEventListener('dragstart', e => {
      const o = e.target.closest('[data-offer]'), b = e.target.closest('[data-bench][data-full]'), c = e.target.closest('[data-cell][data-full]');
      if (!o && !b && !c) return;
      const me = this.me();
      this.dragSrc = o ? { w: 'offer', i: +o.dataset.offer, id: me && me.of[+o.dataset.offer] } : b ? { w: 'bench', i: +b.dataset.bench, id: me && me.be[+b.dataset.bench] && me.be[+b.dataset.bench][0] } : { w: 'board', i: +c.dataset.cell, id: me && me.bo[+c.dataset.cell] && me.bo[+c.dataset.cell][0] };
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'x');
      this.hover = null; this.hideTip(); if (this.detailOpen) this.hideDetail();   // v1.0.6: no card details in the way while dragging
    });
    this.el.addEventListener('dragover', e => {
      if (!this.dragSrc) return;
      const cell = e.target.closest('[data-cell]'), bag = e.target.closest('#amBag');
      if (cell || e.target.closest('#amBench') || (bag && this.dragSrc.w !== 'offer')) e.preventDefault();
      this.$('amBag').classList.toggle('drop', !!bag && this.dragSrc.w !== 'offer');
      const j = cell ? +cell.dataset.cell : -1;
      if (j !== this.dragCell) { this.dragCell = j; this.highlight(); }   // show where a tactic would reach from this square
    });
    const endDrag = () => { this.dragSrc = null; this.dragCell = -1; this.$('amBag').classList.remove('drop'); this.highlight(); };
    addEventListener('drop', e => {   // dropped anywhere else: a store card isn't bought
      if (!this.dragSrc || this.el.contains(e.target) && e.target.closest('[data-cell], #amBench, #amBag')) return;
      if (this.dragSrc.w === 'offer') this.nope();
      endDrag();
    });
    this.el.addEventListener('drop', e => {
      const src = this.dragSrc; if (!src) return;
      const c = e.target.closest('[data-cell]'), bag = e.target.closest('#amBag'), bench = e.target.closest('#amBench'), b = e.target.closest('[data-bench]');
      if (!c && !bag && !bench) return;
      e.preventDefault(); endDrag();
      if (src.w === 'offer') {
        if (!c && !bench) return this.nope();
        if (!this.canAfford()) return;
        this.act({ t: 'buy', i: src.i, to: c ? 'board' : 'bench', j: c ? +c.dataset.cell : b ? +b.dataset.bench : -1 }); this.sound.play('cardPick');
      } else if (bag) this.askSell(src.w, src.i);
      else if (c) this.act({ t: 'move', f: src.w, i: src.i, to: 'board', j: +c.dataset.cell });
      else if (bench) this.act({ t: 'move', f: src.w, i: src.i, to: 'bench', j: b ? +b.dataset.bench : -1 });
      this.sel = null;
    });
    this.el.addEventListener('dragend', endDrag);
    // hover: details + where the card's effect reaches
    this.el.addEventListener('mouseover', e => {
      const o = e.target.closest('[data-offer]'), b = e.target.closest('[data-bench]'), c = e.target.closest('[data-cell]');
      const me = this.me(); if (!me) return;
      if (this.dragSrc) { this.hideTip(); return; }
      if (o && me.of[+o.dataset.offer]) this.hover = { w: 'offer', i: +o.dataset.offer, id: me.of[+o.dataset.offer] };
      else if (b && me.be[+b.dataset.bench]) this.hover = { w: 'bench', i: +b.dataset.bench, id: me.be[+b.dataset.bench][0], rank: me.be[+b.dataset.bench][1], bonus: me.be[+b.dataset.bench][3] || 0 };
      else if (c && me.bo[+c.dataset.cell]) this.hover = { w: 'board', i: +c.dataset.cell, id: me.bo[+c.dataset.cell][0], rank: me.bo[+c.dataset.cell][1], bonus: me.bo[+c.dataset.cell][3] || 0 };
      else { this.hover = null; this.hideTip(); this.highlight(); return; }
      this.showTip(this.hover); this.highlight();
    });
    this.el.addEventListener('mousemove', e => { const t = this.$('amTip'); if (!t.classList.contains('am-hidden')) { t.style.left = Math.min(innerWidth - 310, e.clientX + 16) + 'px'; t.style.top = Math.max(8, Math.min(innerHeight - t.offsetHeight - 8, e.clientY - t.offsetHeight - 10)) + 'px'; } });
    this.el.addEventListener('mouseleave', () => { this.hover = null; this.hideTip(); }, true);
    // right-click a card (store, bench or board): the full write-up with tips
    this.el.addEventListener('contextmenu', e => {
      if (!e.target.closest('#amShop')) return;
      e.preventDefault();
      const o = e.target.closest('[data-offer]'), b = e.target.closest('[data-bench]'), c = e.target.closest('[data-cell]'), me = this.me(); if (!me) return;
      let h = null;
      if (o && me.of[+o.dataset.offer]) h = { w: 'offer', i: +o.dataset.offer, id: me.of[+o.dataset.offer] };
      else if (b && me.be[+b.dataset.bench]) h = { w: 'bench', i: +b.dataset.bench, id: me.be[+b.dataset.bench][0], rank: me.be[+b.dataset.bench][1], bonus: me.be[+b.dataset.bench][3] || 0 };
      else if (c && me.bo[+c.dataset.cell]) h = { w: 'board', i: +c.dataset.cell, id: me.bo[+c.dataset.cell][0], rank: me.bo[+c.dataset.cell][1], bonus: me.bo[+c.dataset.cell][3] || 0 };
      if (h) { this.hideTip(); this.showDetail(h); }
    });
    this.$('amDetail').addEventListener('click', e => { if (e.target.closest('.x')) this.hideDetail(); });
    // Escape closes the details window first (captured, so it doesn't also open the pause menu)
    addEventListener('keydown', this.onDetailKey = e => { if (e.code === 'Escape' && this.detailOpen) { this.hideDetail(); e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    addEventListener('mousedown', this.onDetailOut = e => { const d = this.$('amDetail'); if (d && !d.classList.contains('am-hidden') && !e.target.closest('#amDetail')) this.hideDetail(); }, true);
    // field chips + end-of-run choices
    this.$('amFields').addEventListener('click', e => { const ch = e.target.closest('[data-f]'); if (ch) { this.manualView = true; this.viewF = +ch.dataset.f; this.act({ t: 'view', f: this.viewF }); } });
    this.$('amCenter').addEventListener('click', e => {
      const b = e.target.closest('[data-choice]'); if (!b) return;
      if (b.dataset.choice === 'lobby') this.toLobby(); else this.act({ t: 'choice', c: b.dataset.choice });
    });
  }
  clickSlot(w, i, full) {
    const sel = this.sel;
    if (sel && !(sel.w === w && sel.i === i)) {
      if (w === 'board') this.act({ t: 'move', f: sel.w, i: sel.i, to: 'board', j: i });
      else if (sel.w === 'board') this.act({ t: 'move', f: 'board', i: sel.i, to: 'bench', j: i });
      else if (full) this.act({ t: 'move', f: 'bench', i: sel.i, to: 'bench', j: i });
      this.sel = null; this.sound.play('ui');
    } else if (full) this.sel = sel && sel.w === w && sel.i === i ? null : { w, i };
    else this.sel = null;
    this.renderShop();
  }
  canAfford() { const me = this.me(); if (me && me.gold >= AMON.cardPrice) return true; this.nope(); return false; }
  nope() {   // not enough gold (or nowhere to put it): a beep and the gold count flashes
    this.sound.play('nope');
    for (const el of [this.$('amGold'), this.$('amTop').querySelector('.goldv')]) if (el) { el.classList.remove('am-flash'); void el.offsetWidth; el.classList.add('am-flash'); }
  }
  askSell(w, i) {
    const me = this.me(), x = me && (w === 'board' ? me.bo : me.be)[i], c = x && this.ac.byId.get(x[0]); if (!c) return;
    this.sellAsk = { w, i };
    const box = this.$('amConfirm');
    box.innerHTML = `Sell <b>${esc(c.name)}</b>${x[1] > 1 ? ` (Lv ${x[1]})` : ''} for <b style="color:#ffd166">${AMON.sellValue(x[1])}g</b>?<div class="row"><button class="am-btn warn" data-yes>Sell</button><button class="am-btn" data-no>Keep</button></div>`;
    box.classList.remove('am-hidden'); this.sound.play('ui');
  }
  // Card art: the card's own picture (translated shooter cards), else a render of the unit, else a drawing of its reach pattern.
  artOf(c) {
    if (c.art !== undefined) return c.art;
    if (c.variant) { c.art = this.artOf(this.ac.byId.get(c.base)); return c.art; }
    const src = c.imageUrl || (c.from && (this.cards.find(x => x.id === c.from) || {}).imageUrl);
    c.art = src || (c.kind === 'unit' ? unitThumb(c.unit) : patternThumb(c.pattern, TIER_COLORS[c.tier]));
    return c.art;
  }
  cardTile(id, opts = {}) {
    const c = this.ac.byId.get(id); if (!c) return '';
    const col = TIER_COLORS[c.tier], kk = cardKind(c);
    const n = c.kind === 'unit' ? rankCount(c.count, opts.rank || 1) + (opts.bonus || 0) : 0;
    const tg = kk === 'unit' ? unitTags(unitDef(c.unit)).filter(t => t !== 'Large').slice(0, 2).join('·') : '';
    const kind = kk === 'unit' ? `×${n}${tg ? ` <span style="opacity:.75">${esc(tg)}</span>` : ` unit${n === 1 ? '' : 's'}`}${opts.bonus ? ` <span style="color:#7fe08a">(+${opts.bonus})</span>` : ''}` : `${PATTERNS[c.pattern].icon} ${kk}`;
    const rank = opts.rank > 1 ? `<span class="rk">Lv ${opts.rank}</span>` : '';
    const art = this.artOf(c);
    return `<div class="am-card ${opts.small ? 'small' : ''} ${opts.sel ? 'sel' : ''} ${c.variant || ''}" style="border-color:${c.variant === 'holy' ? '#ffe08a' : c.variant === 'cursed' ? '#e0464b' : col}" ${opts.attr || ''}>${art ? `<div class="art" style="background-image:url('${esc(art)}')"></div>` : ''}
      <span class="tr" style="color:${col}">${TIER_NAMES[c.tier]}</span>${rank}<div class="nm">${esc(c.name)}</div><div class="kd">${kind}</div>${opts.price ? `<span class="pr">${opts.price}g</span>` : ''}</div>`;
  }
  renderShop() {
    const me = this.me(), P = this.pub; if (!P || !me) return;
    const shop = P.ph === 'shop', show = shop || this.showBoard;
    this.$('amShop').classList.toggle('am-hidden', !show);
    this.$('amLeft').classList.toggle('am-hidden', !shop);
    if (!show) return;
    this.$('amGold').textContent = `${me.gold}g`;
    this.$('amLevel').textContent = `Store Lv ${me.lv}` + (me.lv > AMON.tierCapLevel ? ` (+${Math.round((me.lv - AMON.tierCapLevel) * AMON.commandPerLevel * 100)}% command)` : '');
    const up = this.$('amUp'); up.textContent = `Upgrade store (${me.up}g)`; up.disabled = me.gold < me.up; up.title = (me.lv < AMON.tierCapLevel ? 'More offers and better tiers' : 'Odds are maxed: every level now adds +5% health and damage to all your units') + `, and +${AMON.income(me.lv + 1) - AMON.income(me.lv)}g income every round. The price drops by 1 every battle.`;
    this.$('amRoll').disabled = me.gold < AMON.rerollPrice;
    const lk = this.$('amLock'); lk.textContent = me.lk ? '🔒 Locked' : 'Lock'; lk.classList.toggle('on', !!me.lk); lk.title = me.lk ? 'These cards stay for next round (L to unlock)' : 'Keep these cards for next round, e.g. when you are out of gold (L)';
    const rd = this.$('amReady'); rd.textContent = me.rd ? 'Ready ✓' : 'Ready'; rd.classList.toggle('on', me.rd);
    const waiting = P.pl.filter(p => !p.rd && !p.bot && p.on).length;
    rd.title = waiting ? `Waiting for ${waiting} player${waiting === 1 ? '' : 's'}` : '';
    { const x = this.sel && this.sel.w !== 'offer' && (this.sel.w === 'board' ? me.bo : me.be)[this.sel.i]; this.$('amBagTxt').textContent = x ? `Sell +${AMON.sellValue(x[1])}g` : 'Sell'; }
    const offKey = JSON.stringify([me.of, me.gold >= AMON.cardPrice]);
    if (offKey !== this.offKey) {
      this.offKey = offKey;
      this.$('amOffers').innerHTML = me.of.map((id, i) => id ? this.cardTile(id, { price: AMON.cardPrice, attr: `data-offer="${i}" draggable="true" title="Buy (${i + 1}), or drag onto the bench or a board square"` }) : `<div class="am-card empty"></div>`).join('');
    }
    const benchHtml = [];
    for (let i = 0; i < AMON.benchSize; i++) {
      const x = me.be[i];
      benchHtml.push(x ? this.cardTile(x[0], { small: true, rank: x[1], bonus: x[3] || 0, sel: this.sel && this.sel.w === 'bench' && this.sel.i === i, attr: `data-bench="${i}" data-full="1" draggable="true"` }) : `<div class="am-card small empty" data-bench="${i}"></div>`);
    }
    const bKey = benchHtml.join('');
    if (bKey !== this.benchKey) { this.benchKey = bKey; this.$('amBench').innerHTML = bKey; }
    // board
    const board = me.bo.map(x => x ? { id: x[0], rank: x[1], grow: (x[2] || 0) / 100, bonus: x[3] || 0 } : null);
    const army = this.army = computeArmy(board, this.ac.byId, me.lv);
    const cells = this.$('amGrid').children;
    for (let i = 0; i < CELLS; i++) {
      const el = cells[i], x = me.bo[i], c = x && this.ac.byId.get(x[0]);
      const g = army.groups.find(q => q.cell === i);
      const buffs = army.from[i].length;
      const art = c && this.artOf(c);
      const html = c ? `${art ? `<div class="art" style="background-image:url('${esc(art)}')"></div>` : ''}<span class="rk">${x[1] > 1 ? 'Lv ' + x[1] : ''}</span><span class="nm">${esc(c.name)}</span>${g ? `<span class="ct">×${g.n}</span>` : ''}${buffs ? `<span class="bf">+${buffs}</span>` : ''}<span class="pt" title="Point value">${Math.round(army.pts[i])}</span>` : '';
      if (el._h !== html) { el._h = html; el.innerHTML = html; }
      el.style.borderColor = c ? TIER_COLORS[c.tier] : '';
      if (c) { el.dataset.full = '1'; el.draggable = shop; } else { delete el.dataset.full; el.draggable = false; }
      el.classList.toggle('sel', !!(this.sel && this.sel.w === 'board' && this.sel.i === i));
    }
    this.$('amPower').textContent = `Army ${boardScore(army)} pts` + (P.wp ? ` · next wave ${P.wp} pts` : '') + (army.gold ? ` · +${army.gold}g/round` : '') + (army.interest ? ' · interest' : '') + ` · income ${AMON.income(me.lv)}g`;
    this.highlight();
  }
  highlight() {
    const cells = this.$('amGrid').children, h = this.hover || (this.sel && this.sel.w !== 'offer' ? this.sel : null);
    for (const el of cells) el.classList.remove('hl', 'hlsrc', 'drop');
    if (this.dragSrc && this.dragCell >= 0) {   // dragging: where this card would reach from the square under the mouse
      const c = this.dragSrc.id && this.ac.byId.get(this.dragSrc.id);
      cells[this.dragCell].classList.add('drop');
      if (c && c.pattern) for (const [y, x] of patternCells(c.pattern, (this.dragCell / N) | 0, this.dragCell % N)) cells[y * N + x].classList.add('hl');
      return;
    }
    if (!h || !this.army) return;
    const me = this.me(), id = h.id || (h.w === 'board' ? me.bo[h.i] && me.bo[h.i][0] : me.be[h.i] && me.be[h.i][0]);
    const c = id && this.ac.byId.get(id);
    if (h.w === 'board') {
      for (const j of this.army.from[h.i]) cells[j].classList.add('hlsrc');   // who buffs this card
      if (c && c.pattern) for (const [y, x] of patternCells(c.pattern, (h.i / N) | 0, h.i % N)) cells[y * N + x].classList.add('hl');
    }
  }
  // The next wave's faction, its troops and its points next to your army's (updates live as you change the board)
  renderNext() {
    const P = this.pub, el = this.$('amNext'), fc = P && P.fac && FACTION_BY_ID.get(P.fac);
    if (P && P.vs && P.ph === 'shop') {   // Versus: who you fight next, and the last army value you saw from them
      const me = this.me(), pair = me && P.vs.find(q => q[0] === me.id || (q[1] === me.id && !q[2]));
      if (!pair || me.out) { el.classList.add('am-hidden'); return; }
      const oppId = pair[0] === me.id ? pair[1] : pair[0], opp = P.pl.find(p => p.id === oppId), ghost = pair[0] === me.id && pair[2];
      const seen = me.seen && me.seen[oppId], mine = this.army ? Math.round(this.army.total) : 0;
      const html = `<div class="fh"><div style="width:44px;height:44px;border-radius:50%;background:${opp ? opp.color : '#888'};flex:none"></div><div><div class="ft">Next opponent · round ${P.rd}</div><div class="fl" style="color:${opp ? opp.color : '#fff'}">${esc(opp ? opp.name : '?')}${ghost ? ' <span style="font-size:13px;opacity:.75">(a copy of their board)</span>' : ''}</div><div class="ft">${opp ? `${opp.vh} health` : ''}</div></div></div>`
        + `<div class="vs">${seen ? `Last army you saw from them: <b style="color:#ff8a7a">${seen.v}</b> pts <span style="opacity:.6">(round ${seen.r})</span>` : 'You haven\'t fought them yet: their army is a mystery.'}<br>Your army now: <b style="color:#7fe08a">${mine}</b> pts</div>`;
      if (html !== this.nextKey) { this.nextKey = html; el.innerHTML = html; el.style.setProperty('--fc', opp ? opp.color : '#888'); }
      el.classList.remove('am-hidden'); return;
    }
    if (!fc || P.ph !== 'shop') { el.classList.add('am-hidden'); return; }
    const mine = this.army ? Math.round(this.army.total) : 0, wp = P.wp || 0, frac = mine + wp ? mine / (mine + wp) : 0.5;
    const html = `<div class="fh"><img class="fi" alt="${fc.icon}" src="${fc.emblem}"><div><div class="ft">Next wave · round ${P.rd}</div><div class="fl" style="color:${fc.color}">${esc(fc.leader)}</div><div class="ft">${esc(fc.title)}</div></div></div>`
      + (P.fwhy ? `<div style="color:#40d0b0;font-size:13.5px;margin:2px 0">⚖ ${esc(P.fwhy)}</div>` : '') + (P.ftr ? `<div style="opacity:.85;font-size:13.5px;margin:2px 0">Trait · ${esc(P.ftr)}</div>` : '')
      + `<div class="fu">${(P.wave || []).map(([id, n, boss]) => boss ? `<span>👑 ${esc(boss)}</span>` : `<span>${esc(unitDef(id).name)} ×${n}</span>`).join('')}</div>`
      + `<div class="vs">Your army <b style="color:#7fe08a">${mine}</b> pts vs wave <b style="color:#ff8a7a">${wp}</b> pts<div class="vb"><i style="width:${Math.round(frac * 100)}%"></i></div></div>`;
    if (html !== this.nextKey) { this.nextKey = html; el.innerHTML = html; el.style.setProperty('--fc', fc.color); }
    el.classList.remove('am-hidden');
  }
  hideTip() { this.$('amTip').classList.add('am-hidden'); }
  hideDetail() { this.$('amDetail').classList.add('am-hidden'); this.detailOpen = false; }
  // The uncluttered details window (right-click a card, or a unit on the battlefield)
  showDetail(h) {
    const c = h.card || this.ac.byId.get(h.id); if (!c) return;
    const g = h.w === 'board' && this.army && this.army.groups.find(q => q.cell === h.i);
    const k = AMON.rankMul(h.rank || 1) * (h.w === 'board' && this.army ? 1 + this.army.amp[h.i] : 1);
    const fxScaled = c.fx ? Object.fromEntries(Object.entries(c.fx).map(([key, v]) => [key, ['count', 'chain', 'echo', 'promote', 'cleanse', 'mines', 'turret', 'drone', 'meteor'].includes(key) ? v : v * k])) : null;
    const from = c.from && this.cards.find(x => x.id === c.from);
    const D = cardDetails(c, { rank: h.rank, fxScaled, fromName: from && from.name });
    const art = this.artOf(c), f1 = v => Math.round(v * 10) / 10;
    let stats = '';
    if (c.kind === 'unit') {
      const u = unitDef(c.unit), st = g ? g.st : null, rk = AMON.rankMul(h.rank || 1), n = g ? g.n : rankCount(c.count, h.rank || 1) + (h.bonus || 0);
      const s = (label, base, fin) => `<span><span style="opacity:.6">${label}</span> <b>${f1(fin != null ? fin : base)}</b></span>`;
      stats = `<div class="stats"><span><b>${n}</b> units</span>${s('Health', u.hp * rk, st && st.hp)}${s('Damage', (u.atk || 0) * rk, st && st.atk)}${s('Attacks/s', u.rate || 0, st && st.rate)}${s('Range', u.range, st && st.range)}${s('Speed', u.speed, st && st.speed)}${s('Armor', u.armor || 0, st && st.armor)}</div>`;
    }
    const fx = c.fx && c.kind !== 'unit' ? fxLines(fxScaled).map(l => `<li style="color:${l.good ? '#7fe08a' : '#ff8a7a'}">${esc(l.text)}</li>`).join('') : '';
    const html = `<button class="x" title="Close">✕</button><div class="dh">${art ? `<div class="art" style="background-image:url('${esc(art)}');border-color:${c.variant === 'holy' ? '#ffe08a' : c.variant === 'cursed' ? '#e0464b' : TIER_COLORS[c.tier]}"></div>` : ''}<div><h3 style="color:${TIER_COLORS[c.tier]}">${esc(D.title)}${h.rank > 1 ? ` <span style="font-size:15px;opacity:.7">Lv ${h.rank}</span>` : ''}</h3><div class="sub">${esc(D.sub)}</div></div></div>`
      + (D.about ? `<div>${esc(D.about)}</div>` : '') + stats
      + (fx ? `<h5>Right now</h5><ul>${fx}</ul>` : '')
      + D.sections.map(([t, L]) => `<h5>${esc(t)}</h5><ul>${L.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('')
      + (D.tips.length ? `<h5>Tips</h5><ul class="tips">${D.tips.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : '')
      + `<div style="opacity:.5;font-size:13px;margin-top:10px">Right-click any card for this window · click outside or Esc to close</div>`;
    const el = this.$('amDetail'); el.innerHTML = html; el.classList.remove('am-hidden'); this.detailOpen = true; this.sound.play('ui');
  }
  showTip(h) {
    if (this.dragSrc) return;
    const c = this.ac.byId.get(h.id); if (!c) return;
    const lines = [`<h4 style="color:${TIER_COLORS[c.tier]}">${esc(c.name)} <span class="m">· tier ${TIER_NAMES[c.tier]}${h.rank > 1 ? ' · Lv ' + h.rank : ''} · ${cardKind(c)}</span></h4>`];
    if (c.kind === 'unit') { const u0 = unitDef(c.unit), tg = unitTags(u0); lines.push(`<div style="color:#9fd0ff">${esc(unitRole(u0))}${tg.length ? ' · ' + esc(tg.join(', ')) : ''}${u0.air ? ' · Flying' : ''}</div>`); if (u0.ab && u0.ab.heal) lines.push(`<div class="g">Heals ${u0.ab.heal.mech ? 'Mech units only' : 'Bio units (not Mech)'}</div>`); }
    if (c.desc) lines.push(`<div class="m">${esc(c.desc)}</div>`);
    if (c.kind === 'unit') {
      const u = unitDef(c.unit), g = h.w === 'board' && this.army && this.army.groups.find(q => q.cell === h.i);
      const st = g ? g.st : null, rk = AMON.rankMul(h.rank || 1);
      const n = g ? g.n : rankCount(c.count, h.rank || 1) + (h.bonus || 0);
      if (h.bonus) lines.push(`<div class="g">+${h.bonus} permanent unit${h.bonus === 1 ? '' : 's'} (recruited or squadmates; stays when moved)</div>`);
      const f1 = v => Math.round(v * 10) / 10;
      const row = (label, base, fin) => `<tr><td class="m">${label}</td><td>${fin != null && Math.abs(fin - base) > 0.05 ? `<span class="${fin > base ? 'g' : 'b'}">${f1(fin)}</span> <span class="m">(${f1(base)})</span>` : f1(base)}</td></tr>`;
      lines.push(`<div>${n}× ${esc(u.name)}${u.air ? ' · flying' : ''} · value ${f1(u.v)} each</div><table>`
        + row('Health', u.hp * rk, st && st.hp) + row('Damage', (u.atk || 0) * rk, st && st.atk) + row('Attacks/s', u.rate || 0, st && st.rate)
        + row('Range', u.range, st && st.range) + row('Speed', u.speed, st && st.speed) + row('Armor', u.armor || 0, st && st.armor)
        + (u.splash || (st && st.splash) ? row('Splash', u.splash || 0, st && st.splash) : '') + '</table>');
      const hits = [u.hitsGround !== false ? 'ground' : '', u.hitsAir ? 'air' : ''].filter(Boolean).join(' + ');
      lines.push(`<div class="m">Hits ${hits || 'nothing directly'}${u.bonus ? ' · bonus vs ' + Object.entries(u.bonus).map(([k, v]) => `${k} ×${v}`).join(', ') : ''}</div>`);
      if (st && (st.regen || st.lifesteal || st.chain || st.slow || st.burn || st.hex)) lines.push(`<div class="g">${[st.regen ? `+${f1(st.regen)}/s regen` : '', st.lifesteal ? `${Math.round(st.lifesteal * 100)}% lifesteal` : '', st.chain ? `+${st.chain} bounces` : '', st.slow ? `slow ${Math.round(st.slow * 100)}%` : '', st.burn ? `burn ${f1(st.burn)}/s` : '', st.hex ? `hex +${Math.round(st.hex * 100)}%` : ''].filter(Boolean).join(' · ')}</div>`);
      const xs = st ? [['encore', st.encore, 'pct'], ['block', st.block, 'pct'], ['resist', st.resist, 'pct'], ['thorns', st.thorns, 'pct'], ['bomb', st.bomb, 'pct'], ['shield', st.shield, 'n'], ['drain', st.drain, 'n'], ['pen', st.pen, 'n'], ['knock', st.knock, 'n'], ['mines', st.mines, 'n'], ['turret', st.turret, 'n'], ['drone', st.drone, 'n'], ['meteor', st.meteor, 'n']].filter(q => q[1]) : [];
      if (xs.length) lines.push(`<div class="g">${xs.map(([k, v, t]) => `${FX_INFO[k][0]} ${t === 'pct' ? Math.round(v * 100) + '%' : f1(v)}`).join(' · ')}</div>`);
      if (g) {
        const bl = (g.buffs || []).filter(b => Math.abs(b.add) >= 0.005).map(b => `${(FX_INFO[b.key] || [b.key])[0]} ${b.add > 0 ? '+' : '−'}${Math.abs(b.add).toFixed(2)}`);
        lines.push(`<div style="margin-top:3px"><b style="color:#ffd166">${Math.round(g.pts)} pts</b> <span class="m">= ${f1(g.basePts)} base × ${g.mul.toFixed(2)} bonus multiplier</span></div>` + (bl.length ? `<div class="m">${esc(bl.join(' · '))}${this.army.from[h.i].length ? ` · ${this.army.from[h.i].length} card${this.army.from[h.i].length === 1 ? '' : 's'} reaching it +${(0.03 * this.army.from[h.i].length).toFixed(2)}` : ''}</div>` : ''));
      } else lines.push(`<div><b style="color:#ffd166">${Math.round(cardValue(c, h.rank || 1))} pts</b> <span class="m">before board bonuses</span></div>`);
      if (g && g.echo) lines.push('<div class="g">Echo: units return once at half health</div>');
      if (g && g.promote) lines.push('<div class="g">Ranks up after each won battle</div>');
    }
    if (c.kind !== 'unit') lines.push(`<div><b style="color:#ffd166">${Math.round(cardValue(c, h.rank || 1))} pts</b></div>`);
    if (c.fx && c.pattern) {
      lines.push(`<div style="margin-top:4px"><b>${PATTERNS[c.pattern].icon} ${esc(PATTERNS[c.pattern].name)}</b></div>`);
      const k = AMON.rankMul(h.rank || 1) * (h.w === 'board' && this.army ? 1 + this.army.amp[h.i] : 1);
      for (const l of fxLines(Object.fromEntries(Object.entries(c.fx).map(([key, v]) => [key, ['count', 'chain', 'echo', 'promote', 'cleanse', 'mines', 'turret', 'drone', 'meteor'].includes(key) ? v : v * k])))) lines.push(`<div class="${l.good ? 'g' : 'b'}">${esc(l.text)}</div>`);
      if (h.w === 'board' && this.army && this.army.amp[h.i]) lines.push(`<div class="g">Amplified +${Math.round(this.army.amp[h.i] * 100)}%</div>`);
    }
    if (h.w === 'board' && this.army && this.army.from[h.i].length) {
      const me = this.me();
      lines.push(`<div class="m" style="margin-top:4px">Boosted by: ${this.army.from[h.i].map(j => esc((this.ac.byId.get(me.bo[j][0]) || {}).name)).join(', ')}</div>`);
    }
    if (c.kind === 'unit') lines.push(`<div class="m">Squadmates: side by side with another unit card that shares a tag (${(unitDef(c.unit).tags || []).join(', ') || 'none'}), both gain a permanent unit each round, once per neighbor (up to +3).</div>`);
    if (h.w === 'offer') lines.push(`<div class="m">Click to buy for ${AMON.cardPrice}g, or drag it onto the bench or a square. Drop it on a copy to combine them into a higher level.</div>`);
    else lines.push(`<div class="m">Drag to move or swap; drop on a copy of itself to combine (levels add up). Drag to the money bag (or Delete) to sell for ${AMON.sellValue(1)}g per level.</div>`);
    lines.push('<div style="color:#ffd166;opacity:.85">Right-click for full details and tips</div>');
    const t = this.$('amTip'); t.innerHTML = lines.join(''); t.classList.remove('am-hidden');
  }

  // ---------------------------------------------------------------- HUD
  updateHud() {
    const P = this.pub; if (!P) return;
    const me = this.me();
    const phaseName = { shop: 'Store', battle: 'Battle', result: 'Battle over', choice: 'Run over' }[P.ph] || P.ph;
    let timer = '';
    if (P.ph === 'shop' && P.lim) timer = ` · ${Math.max(0, Math.ceil(P.lim - P.pt))}s`;
    if (P.ph === 'battle') timer = ` · ${Math.max(0, Math.ceil(P.bt - P.pt))}s`;
    const roundTxt = P.pvp && P.pvp.vs ? `Versus · round ${P.rd}` : P.pvp ? `PvP ${Math.min(P.pvp.round + 1, P.pvp.rounds)}/${P.pvp.rounds}` : `Round ${P.rd}/${P.fr}${P.ext ? ` <span class="lbl">(+${P.ext})</span>` : ''}`;
    const top = `<span><span class="lbl">AMON</span><b>${roundTxt}</b></span>`
      + (P.pvp && P.pvp.vs && me ? `<span><span class="lbl">${me.out ? 'Knocked out' : 'Health'}</span><span id="amHp"><i style="width:${Math.round(100 * me.vh / AMON.vsHealth)}%"></i></span> <b>${me.vh}</b></span>` : '')
      + (P.pvp ? '' : `<span><span class="lbl">Team</span><span id="amHp"><i style="width:${Math.round(100 * P.hp / P.mhp)}%"></i></span> <b>${P.hp}</b></span>`)
      + `<span><span class="lbl">${phaseName}</span><b>${timer.replace(' · ', '')}</b></span>`
      + (P.ph === 'shop' && !P.lim && P.pl.filter(p => !p.bot).length > 1 ? `<span title="Who has pressed Ready"><span class="lbl">Ready</span>${P.pl.filter(p => !p.bot && !p.out).map(p => `<b style="color:${p.color};opacity:${p.rd ? 1 : 0.45};margin-right:6px">${esc(p.name)} ${p.rd ? '✓' : '…'}</b>`).join('')}</span>` : '')   // v1.0.1: no shop timer: show who is ready
      + (me ? `<span><span class="lbl">Gold</span><b class="goldv" style="color:#ffd166">${me.gold}</b></span>` : '');
    if (top !== this.topKey) { this.topKey = top; this.$('amTop').innerHTML = top; }
    this.renderNext();
    // battle overlay
    const battle = P.ph === 'battle' || P.ph === 'result';
    this.$('amBattle').classList.toggle('am-hidden', !battle);
    this.$('amHelp').classList.toggle('am-hidden', P.ph === 'choice');
    if (battle) {
      // your field is decided: follow the action on a field that is still fighting
      const cur = P.fl.find(f => f[0] === this.viewF);
      if (P.ph === 'battle' && cur && cur[2] && !this.manualView && (this.autoT = (this.autoT || 0) + 1) > 60) {
        const live = P.fl.find(f => !f[2]);
        if (live) { this.viewF = live[0]; this.act({ t: 'view', f: live[0] }); this.toast('Watching ' + live[1].map(o => (P.pl.find(p => p.id === o) || {}).name).join(' vs ') + '\'s field'); }
        this.autoT = 0;
      } else if (!cur || !cur[2]) this.autoT = 0;
      const chips = P.fl.map(([id, owners, done, w]) => {
        const vp = P.vs && P.vs[id], pn = o => (P.pl.find(p => p.id === o) || {}).name || '?';
        const nm = vp ? `${pn(vp[0])} vs ${pn(vp[1])}${vp[2] ? ' (copy)' : ''}` : owners.map(pn).join(' vs ');
        const cls = done ? (P.pvp ? '' : w === 0 ? 'won' : w === 1 ? 'lost' : '') : '';
        return `<span class="am-chip ${id === this.viewF ? 'on' : ''} ${cls}" data-f="${id}">${esc(nm)}${done ? (P.pvp ? ' ✓' : w === 0 ? ' ✓' : w === 1 ? ' ✗' : ' –') : ''}</span>`;
      }).join('');
      if (chips !== this.chipKey) { this.chipKey = chips; this.$('amFields').innerHTML = chips; }
      const fc = P.fac && FACTION_BY_ID.get(P.fac);
      const wave = P.wave ? (fc ? `<span style="color:${fc.color};font-weight:700"><img alt="" src="${fc.emblem}" style="width:20px;height:20px;vertical-align:-5px;margin-right:4px">${esc(fc.leader)} · ${esc(fc.title)}</span>` : '') + P.wave.map(([id, n, boss]) => { const d = unitDef(id); return `<span title="${esc(d.name)}">${boss ? '👑 ' + esc(boss) : `${esc(d.name)} ×${n}`}</span>`; }).join('') : '';
      if (wave !== this.waveKey) { this.waveKey = wave; this.$('amWave').innerHTML = wave; this.$('amWave').classList.toggle('am-hidden', !wave); }
      let boss = null; for (const [, e] of this.units) if (e.flags & 32) boss = e;
      const bb = this.$('amBoss'); bb.classList.toggle('am-hidden', !boss);
      if (boss) { bb.querySelector('span').textContent = boss.name || boss.def.name; bb.querySelector('i').style.width = boss.hp + '%'; }
    }
    // center panel: results and the end-of-run choice
    let center = '';
    if (P.ph === 'result' && P.res) {
      const r = P.res;
      const nm = id => { const q = P.pl.find(p => p.id === id); return esc(q ? q.name : '?'); };
      if (r.vs) {
        center = `<h2>Versus results</h2>` + r.vs.map(d => `<div>${nm(d.a)} vs ${nm(d.b)}${d.ghost ? ' (copy)' : ''}: <b>${d.w === 0 ? nm(d.a) + ' wins' : d.w === 1 ? nm(d.b) + (d.ghost ? '\'s copy wins' : ' wins') : 'draw'}</b>${d.dmg ? ` <span style="color:#ff8a7a">−${d.dmg} health</span>` : ''}</div>`).join('');
      } else if (r.pvp) {
        center = `<h2>PvP results</h2>` + (r.duels || []).map(d => { const a = P.pl.find(p => p.id === d.a), b = P.pl.find(p => p.id === d.b); return `<div>${esc(a && a.name)} vs ${esc(b && b.name)}: <b>${d.w === 0 ? esc(a && a.name) + ' wins' : d.w === 1 ? esc(b && b.name) + ' wins' : 'draw'}</b></div>`; }).join('');
      } else center = r.cleared ? `<h2 style="color:#7fe08a">Wave ${r.round} cleared</h2><div>Not a single raider got through.</div>`
        : `<h2 style="color:#ff8a7a">−${r.dmg} team health</h2><div>Enemies worth ${r.left} value were still standing.${r.bossLeft ? ' The boss survived.' : ''}</div>`;
    }
    if (P.ph === 'choice' && P.ch) {
      const ch = P.ch, host = this.isHost, champ = ch.champ && P.pl.find(p => p.id === ch.champ);
      if (ch.why === 'vs') {
        const team = (ch.team || []).map(id => (P.pl.find(p => p.id === id) || {}).name).filter(Boolean);
        center = `<h2 style="color:#ffd166">${team.length > 1 ? 'Winners: ' + esc(team.join(' & ')) : 'Champion: ' + esc(champ && champ.name)}</h2><div>Last ${team.length > 1 ? 'team' : 'commander'} standing after ${ch.round} rounds.</div>`
          + (host ? '<div class="row"><button class="am-btn" data-choice="lobby">Back to lobby</button></div>' : '<div class="row m">Waiting for the host…</div>');
      } else {
      const title = ch.why === 'won' ? `<h2 style="color:#7fe08a">Victory! Round ${ch.round} conquered</h2>` : ch.why === 'lost' ? `<h2 style="color:#ff8a7a">Defeat at round ${ch.round}</h2>` : ch.why === 'boss' ? `<h2 style="color:#ffb04a">The boss still stands</h2>` : `<h2 style="color:#ffd166">PvP champion: ${esc(champ && champ.name)}</h2>`;
      center = title + `<div>${ch.why === 'boss' ? 'Fight the boss again, or turn your boards on each other.' : ch.why === 'lost' ? 'Keep going with full health and 10 more (harder) rounds, or settle who built the strongest board.' : 'Take on 10 more rounds at a higher difficulty, or turn your boards on each other.'}</div>`
        + (host ? `<div class="row">${ch.why === 'boss' ? '<button class="am-btn go" data-choice="again">Fight the boss again</button>' : '<button class="am-btn go" data-choice="extend">+10 harder rounds</button>'}${ch.canPvp ? '<button class="am-btn" data-choice="pvp">PvP: fight each other</button>' : ''}<button class="am-btn" data-choice="lobby">Back to lobby</button></div>`
          : `<div class="row">${ch.canPvp ? '<button class="am-btn go" data-choice="pvp">PvP: fight each other</button>' : ''}</div><div class="row m">Or wait for the host to choose…</div>`);
      }
    }
    const cel = this.$('amCenter');
    if (center !== this.centerKey) { this.centerKey = center; cel.innerHTML = center; cel.classList.toggle('am-hidden', !center); }
    // Tab leaderboard
    const tab = !!(this.keys && this.keys.Tab);
    this.$('amLb').classList.toggle('am-hidden', !tab);
    if (tab) {
      const rows = P.pl.slice().sort((a, b) => P.vs ? a.out - b.out || b.vh - a.vh || b.sc - a.sc : P.pvp ? b.pv[0] - a.pv[0] || b.sc - a.sc : b.sc - a.sc);
      const html = `<h3 style="margin:0 0 8px">Leaderboard <span style="font-size:13px;padding:2px 8px;border-radius:9px;background:#ffffff18;margin:0 6px">Difficulty: <b>${esc(String(P.df || 'normal').replace(/^./, c => c.toUpperCase()))}</b></span><span class="m" style="font-size:12px;opacity:.6">army points = each card's value × its bonus multiplier</span></h3><table><tr><th>#</th><th>Player</th><th>Army pts</th><th>Store</th><th>Gold</th><th>Kills</th><th>Damage</th>${P.vs ? '<th>Health</th>' : ''}${P.pvp || rows.some(p => p.pv[0]) ? '<th>PvP</th>' : ''}</tr>`
        + rows.map((p, i) => `<tr${p.id === this.localId ? ' style="background:#ffffff10"' : ''}><td>${i + 1}</td><td><span style="color:${p.color}">■</span> ${esc(p.name)}${p.bot ? ' <span style="opacity:.5">bot</span>' : ''}${!p.on ? ' <span style="opacity:.5">(away)</span>' : ''}</td><td><b>${p.sc}</b></td><td>Lv ${p.lv}</td><td>${p.gold}</td><td>${p.k}</td><td>${p.d}</td>${P.vs ? `<td>${p.out ? '<span style="opacity:.5">out</span>' : p.vh}</td>` : ''}${P.pvp || rows.some(q => q.pv[0]) ? `<td>${p.pv[0]} pts (${p.pv[1]}-${p.pv[2]})</td>` : ''}</tr>`).join('') + '</table>';
      if (html !== this.lbKey) { this.lbKey = html; this.$('amLb').innerHTML = html; }
    }
  }
}
