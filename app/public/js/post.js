// Post-processing chain for the graphics settings (loaded only when an effect needs it).
// Order: scene (plain, or screen-space reflections) -> ambient occlusion -> bloom -> FXAA / SMAA.
// v1.2.17: the scene is drawn once and every effect reads that drawing's depth (normals are worked out from it).
// Before, ambient occlusion drew the whole scene again for normals, ray-traced shadows again for depth and reflections
// again for normals: up to 5 full scene draws a frame, and on Windows each one costs as much as the game itself.
// Works with a perspective or an orthographic camera (reflections need perspective and are skipped otherwise).
import * as THREE from '/vendor/three/build/three.module.js';
import { EffectComposer } from '/vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '/vendor/three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '/vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSRPass } from '/vendor/three/examples/jsm/postprocessing/SSRPass.js';
import { SMAAPass } from '/vendor/three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from '/vendor/three/examples/jsm/shaders/FXAAShader.js';
import { Pass, FullScreenQuad } from '/vendor/three/examples/jsm/postprocessing/Pass.js';
import { CopyShader } from '/vendor/three/examples/jsm/shaders/CopyShader.js';
import { RTShadowPass, UpscalePass } from './rt.js';

// v28: nametags, health bars and other sprites (and see-through effects that don't write depth) are skipped by the
// passes that read the scene's shape (normals, depth, reflectivity). Drawn there as solid squares, they showed up as
// a fuzzy box around every nametag once ambient occlusion or reflections were on.
export function hideSoft(scene) {
  const hid = [];
  scene.traverse(o => {
    if (!o.visible) return;
    const m = o.material;
    if (o.isSprite || o.isPoints || o.isLine || (m && !Array.isArray(m) && m.transparent && m.depthWrite === false)) { o.visible = false; hid.push(o); }
  });
  return () => { for (const o of hid) o.visible = true; };
}
// v28: ray-traced reflections only on surfaces that would really shine: smooth materials (roughness under 0.7).
// Wooden boxes, cloth, stone and other rough materials stay matte.
const shiny = o => { const m = o.material; return !!m && !Array.isArray(m) && !m.userData.matte && !o.userData.matte && (m.isMeshStandardMaterial ? m.roughness < 0.7 : !!m.isMeshPhongMaterial); };
class ReflectPass extends SSRPass {
  constructor(opts, rt) {
    super({ ...opts, selects: rt ? [] : opts.selects });
    if (rt) this._selects = { includes: shiny };   // selective, decided per object every frame
  }
  // v1.2.17: three draws the whole scene again with a normal material only to know which way each pixel faces. The
  // depth it already has says the same (the game is made of flat faces), so that drawing is now one full-screen pass.
  renderOverride(renderer, mat, target, ...a) {
    if (mat === this.normalMaterial) {
      if (!this.dn) this.dn = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uPx: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: DEPTH_NORMAL }));
      const u = this.dn.material.uniforms; u.tDepth.value = this.beautyRenderTarget.depthTexture; u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
      u.uPx.value.set(1 / this.width, 1 / this.height);
      renderer.setRenderTarget(target); this.dn.render(renderer); return;
    }
    const back = hideSoft(this.scene); super.renderOverride(renderer, mat, target, ...a); back();
  }
  dispose() { super.dispose(); if (this.dn) { this.dn.material.dispose(); this.dn.dispose(); } }
  renderMetalness(...a) { const back = hideSoft(this.scene); super.renderMetalness(...a); back(); }
  // v1.2.8: three copies the camera's near / far / projection only when the pass is made (and on resize). The game
  // moves the near plane per view (first person ~0.1-0.25 m, overhead 0.6) and narrows the FOV on punches, so first
  // person reflections were traced with the wrong depth: mirrored blocks floated off the floor. Synced every frame.
  render(r, w, rd, ...a) { syncCam(this.camera, this.ssrMaterial, this.depthRenderMaterial); super.render(r, w, rd, ...a); }
  // v1.2.8: three bakes the screen diagonal into the shader as MAX_STEP, so every resolution change (window resize,
  // the in-match load guard stepping the render scale) compiled the reflection shader again: a long hitch each time
  // on Windows. Only a loop limit: keep one value, raised in 1024-pixel steps and never lowered.
  setSize(w, h) {
    super.setSize(w, h);
    this.ssrMaterial.defines.MAX_STEP = this._maxStep = Math.max(this._maxStep || 0, Math.ceil(Math.hypot(w, h) / 1024) * 1024);
  }
}
function syncCam(cam, ...mats) {
  for (const m of mats) {
    const u = m && m.uniforms; if (!u) continue;
    if (u.cameraNear) u.cameraNear.value = cam.near; if (u.cameraFar) u.cameraFar.value = cam.far;
    if (u.cameraProjectionMatrix) u.cameraProjectionMatrix.value.copy(cam.projectionMatrix);
    if (u.cameraInverseProjectionMatrix) u.cameraInverseProjectionMatrix.value.copy(cam.projectionMatrixInverse);
  }
}

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
// view-space position and (flat) normal of a pixel from the depth buffer; works for perspective and orthographic cameras
const VIEW = `
  uniform sampler2D tDepth; uniform mat4 uInvProj; uniform vec2 uPx;
  vec3 viewPos(vec2 uv) { float d = texture2D(tDepth, uv).x; vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return v.xyz / v.w; }
  vec3 viewNormal(vec2 uv, vec3 P) {   // the neighbour on the same face (smaller depth step) on each axis
    vec3 r = viewPos(uv + vec2(uPx.x, 0.0)) - P, l = P - viewPos(uv - vec2(uPx.x, 0.0));
    vec3 t = viewPos(uv + vec2(0.0, uPx.y)) - P, b = P - viewPos(uv - vec2(0.0, uPx.y));
    return normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(t.z) < abs(b.z) ? t : b));
  }`;
const DEPTH_NORMAL = `${VIEW} varying vec2 vUv;
  void main() {
    if (texture2D(tDepth, vUv).x >= 0.99999) { gl_FragColor = vec4(0.0); return; }
    vec3 P = viewPos(vUv); gl_FragColor = vec4(viewNormal(vUv, P) * 0.5 + 0.5, 1.0);
  }`;

// v1.2.17: draws the scene once into its own target that keeps the depth (multisampled when MSAA is picked), then hands
// the picture on. Ambient occlusion and ray-traced shadows read that depth instead of drawing the scene again.
class ScenePass extends Pass {
  constructor(scene, camera, w, h, samples) {
    super(); this.scene = scene; this.camera = camera; this.samples = samples; this.needsSwap = false;
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader }));
    this.make(w, h);
  }
  make(w, h) {
    if (this.target) this.target.dispose();
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: false };
    const t = this.samples ? new THREE.WebGLMultisampleRenderTarget(w, h, o) : new THREE.WebGLRenderTarget(w, h, o);
    if (this.samples) t.samples = this.samples;
    t.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    t.depthTexture.minFilter = t.depthTexture.magFilter = THREE.NearestFilter;
    this.target = t;
  }
  get depth() { return this.target.depthTexture; }
  setSize(w, h) { if (Math.round(w) !== this.target.width || Math.round(h) !== this.target.height) this.make(w, h); }   // a fresh target: depth textures don't follow a resize
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.target); renderer.clear(); renderer.render(this.scene, this.camera);
    this.copy.material.uniforms.tDiffuse.value = this.target.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer); this.copy.render(renderer);
  }
  dispose() { this.target.dispose(); this.copy.material.dispose(); this.copy.dispose(); }
}

// v1.2.17 ambient occlusion from the scene's depth alone (was three's SSAOPass, which drew the whole scene a second time
// for normals: that extra drawing was most of the "AO halves my frame rate"). Half resolution, 12 samples in a
// hemisphere around each pixel's own face normal, a depth-aware blur, then multiplied into the picture.
const AO_FRAG = `${VIEW} uniform mat4 uProj; uniform float uRadius; varying vec2 vUv;
  void main() {
    if (texture2D(tDepth, vUv).x >= 0.99999) { gl_FragColor = vec4(1.0); return; }
    vec3 P = viewPos(vUv), N = viewNormal(vUv, P);
    vec3 T = normalize(abs(N.z) < 0.99 ? cross(N, vec3(0.0, 0.0, 1.0)) : cross(N, vec3(0.0, 1.0, 0.0))), B = cross(N, T);
    float a0 = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float occ = 0.0;
    for (int i = 0; i < 12; i++) {
      float f = (float(i) + 0.5) / 12.0, a = a0 + float(i) * 2.3999632, r = sqrt(f);
      vec3 S = P + (T * cos(a) * r + B * sin(a) * r + N * sqrt(1.0 - f) + N * 0.05) * uRadius * mix(0.25, 1.0, f);
      vec4 c = uProj * vec4(S, 1.0);
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      float sz = viewPos(uv).z;
      occ += step(S.z + 0.02, sz) * smoothstep(0.0, 1.0, uRadius / max(1e-3, abs(P.z - sz)));
    }
    gl_FragColor = vec4(vec3(clamp(1.0 - 1.6 * occ / 12.0, 0.0, 1.0)), 1.0);
  }`;
const AO_BLUR = `${VIEW} uniform sampler2D tAO; varying vec2 vUv;
  void main() {
    float z = viewPos(vUv).z, sum = 0.0, wsum = 0.0;
    for (int j = -2; j <= 1; j++) for (int i = -2; i <= 1; i++) {
      vec2 uv = vUv + (vec2(float(i), float(j)) + 0.5) * uPx;
      float w = 1.0 / (1.0 + 8.0 * abs(viewPos(uv).z - z));
      sum += texture2D(tAO, uv).r * w; wsum += w;
    }
    gl_FragColor = vec4(vec3(sum / wsum), 1.0);
  }`;
class AOPass extends Pass {
  constructor(camera, w, h, depthSrc) {
    super(); this.camera = camera; this.depthSrc = depthSrc; this.radius = 1.1; this.strength = 0.8;
    const q = (frag, extra = {}) => new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uPx: { value: new THREE.Vector2() }, ...extra }, vertexShader: VERT, fragmentShader: frag }));
    this.ao = q(AO_FRAG, { uProj: { value: new THREE.Matrix4() }, uRadius: { value: 0.7 } });
    this.blur = q(AO_BLUR, { tAO: { value: null } });
    this.mix = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, tAO: { value: null }, uK: { value: 0.85 } }, vertexShader: VERT,
      fragmentShader: 'uniform sampler2D tDiffuse, tAO; uniform float uK; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(c.rgb * mix(1.0, texture2D(tAO, vUv).r, uK), c.a); }' }));
    this.setSize(w, h);
  }
  setSize(w, h) {
    const hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
    if (this.a && this.a.width === hw && this.a.height === hh) return;
    for (const t of [this.a, this.b]) if (t) t.dispose();
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false };
    this.a = new THREE.WebGLRenderTarget(hw, hh, o); this.b = new THREE.WebGLRenderTarget(hw, hh, o);
  }
  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera, depth = this.depthSrc(), px = 1 / this.a.width, py = 1 / this.a.height;
    for (const m of [this.ao.material, this.blur.material]) { const u = m.uniforms; u.tDepth.value = depth; u.uInvProj.value.copy(cam.projectionMatrixInverse); u.uPx.value.set(px, py); }
    const u = this.ao.material.uniforms; u.uProj.value.copy(cam.projectionMatrix); u.uRadius.value = this.radius;
    renderer.setRenderTarget(this.a); this.ao.render(renderer);
    this.blur.material.uniforms.tAO.value = this.a.texture; renderer.setRenderTarget(this.b); this.blur.render(renderer);
    const m = this.mix.material.uniforms; m.tDiffuse.value = readBuffer.texture; m.tAO.value = this.b.texture; m.uK.value = this.strength;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.mix.render(renderer);
  }
  dispose() { this.a.dispose(); this.b.dispose(); for (const q of [this.ao, this.blur, this.mix]) { q.material.dispose(); q.dispose(); } }
}

// strength, radius, threshold (v30: much gentler, only bright lights and glows bloom; it washed out light floors)
// v1.2.17 (Devin): less bloom overall, and much less on light-colored maps (cfg.light), where pale floors glowed
const BLOOM = { low: [0.09, 0.28, 0.95], high: [0.16, 0.36, 0.91] };
const bloomFor = (q, light) => { const [s, r, t] = BLOOM[q]; return light ? [s * 0.5, r, Math.min(0.985, t + 0.04)] : [s, r, t]; };

// cfg: { bloom: 'off'|'low'|'high', ao: bool, ssr: bool, aa: 'off'|'fxaa'|'smaa'|'msaa', selects: Mesh[],
//        rt: 'off'|'on'|'ultra' (v27 ray tracing), sun: DirectionalLight, upscale: 1 or a render share (v27 upscaler) }
// v1.0.5: three.js gives a render target without a stencil buffer a 16-bit depth buffer (and its depth textures
// default to 16-bit too). With post effects on, the whole scene was drawn at 16-bit depth, so anything more than
// a few dozen meters away z-fought: far surfaces flickered with what looked like shadow streaks, worst in the
// open world. Every target here gets 24-bit depth instead (a stencil buffer, or a 32-bit depth texture).
function deepDepth(t) {
  if (!t || !t.isWebGLRenderTarget) return;
  if (t.depthTexture) t.depthTexture.type = THREE.UnsignedIntType;
  else if (t.depthBuffer) t.stencilBuffer = true;
}
function deepDepthAll(obj) { for (const k of Object.keys(obj)) { const v = obj[k]; if (v && v.isWebGLRenderTarget) deepDepth(v); } }
export function buildPost(r, scene, camera, cfg) {
  const up = cfg.upscale > 0 && cfg.upscale < 1 ? cfg.upscale : 1;
  const w = innerWidth, h = innerHeight, pr = r.getPixelRatio() * up;   // the chain renders at the upscaler's share
  const persp = !!camera.isPerspectiveCamera;
  const rt = cfg.rt === 'on' || cfg.rt === 'ultra' ? cfg.rt : null;
  const ssr = (cfg.ssr || rt) && persp;
  let aa = cfg.aa === 'ssaa' ? 'msaa' : cfg.aa;   // (supersampling: a bigger picture, render.js pixelRatio, plus MSAA 4x)
  let target, samples = 0;
  if (aa === 'msaa' || aa === 'msaa8') {
    if (r.capabilities.isWebGL2 && !ssr) samples = Math.min(aa === 'msaa8' ? 8 : 4, r.capabilities.maxSamples || 4);
    else aa = 'smaa';   // reflections draw the scene themselves, so smooth edges afterwards instead
  }
  const scenePass = !ssr && (cfg.ao || rt) ? new ScenePass(scene, camera, w * pr, h * pr, samples) : null;   // v1.2.17: one drawing, depth shared
  if (samples && !scenePass) {
    target = new THREE.WebGLMultisampleRenderTarget(w * pr, h * pr, { format: THREE.RGBAFormat, stencilBuffer: true });
    target.samples = samples;
  }
  if (!target) target = new THREE.WebGLRenderTarget(w * pr, h * pr, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: true });
  const composer = new EffectComposer(r, target);
  composer.setPixelRatio(pr); composer.setSize(w, h);
  let ssrPass = null, aoPass = null, fxaa = null, rtPass = null, upPass = null;
  if (ssr) {
    // ray tracing: smooth surfaces reflect (strongest at grazing angles), ultra adds a second bounce
    ssrPass = new ReflectPass({ renderer: r, scene, camera, width: w * pr, height: h * pr, selects: cfg.selects || [], bouncing: rt === 'ultra' }, !!rt);
    ssrPass.opacity = rt ? (rt === 'ultra' ? 0.5 : 0.4) : 0.45; ssrPass.maxDistance = rt ? 30 : 14; ssrPass.thickness = rt ? 0.03 : 0.06;
    if (rt) { ssrPass.fresnel = true; ssrPass.distanceAttenuation = true; }
    composer.addPass(ssrPass);
  } else composer.addPass(scenePass || new RenderPass(scene, camera));
  const depthSrc = ssrPass ? () => ssrPass.beautyRenderTarget.depthTexture : scenePass ? () => scenePass.depth : null;
  if (rt && cfg.sun) { rtPass = new RTShadowPass(scene, camera, cfg.sun, Math.round(w * pr), Math.round(h * pr), rt, depthSrc); composer.addPass(rtPass); }
  if (cfg.ao) { aoPass = new AOPass(camera, w * pr, h * pr, depthSrc); if (!persp) aoPass.radius = 1.3; composer.addPass(aoPass); }
  if (BLOOM[cfg.bloom]) composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), ...bloomFor(cfg.bloom, cfg.light)));
  if (aa === 'fxaa') {
    fxaa = new ShaderPass(FXAAShader);
    composer.addPass(fxaa);
  } else if (aa === 'smaa') composer.addPass(new SMAAPass(w * pr, h * pr));
  if (up < 1) { upPass = new UpscalePass(cfg.sharp ?? 0.8); composer.addPass(upPass); }   // last: draws the full-size screen
  for (const p of composer.passes) deepDepthAll(p);
  deepDepth(composer.renderTarget1); deepDepth(composer.renderTarget2);
  const fitFxaa = () => { if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (innerWidth * r.getPixelRatio() * up), 1 / (innerHeight * r.getPixelRatio() * up)); };
  fitFxaa();
  return {
    composer, camera,
    // v1.2.6: the sun's shadow map is drawn once per frame; reflection / ray-traced shadow / AO passes that render
    // the scene again reuse it instead of redrawing every caster each time
    render() { const sm = r.shadowMap, au = sm.autoUpdate; sm.autoUpdate = false; sm.needsUpdate = true; try { composer.render(); } finally { sm.autoUpdate = au; } },
    resize() {
      composer.setPixelRatio(r.getPixelRatio() * up); composer.setSize(innerWidth, innerHeight); fitFxaa();
    },
    setSelects(list) { if (ssrPass && !rt) ssrPass.selects = list; },
    dispose() {
      for (const p of composer.passes) if (p.dispose) p.dispose();
      composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
    },
  };
}
