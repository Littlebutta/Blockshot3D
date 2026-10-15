// Post-processing chain for the graphics settings (loaded only when an effect needs it).
// Order: scene (plain, or screen-space reflections) -> ambient occlusion -> bloom -> FXAA / SMAA.
// Works with a perspective or an orthographic camera (reflections need perspective and are skipped otherwise).
import * as THREE from '/vendor/three/build/three.module.js';
import { EffectComposer } from '/vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '/vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '/vendor/three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '/vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from '/vendor/three/examples/jsm/postprocessing/SSAOPass.js';
import { SSRPass } from '/vendor/three/examples/jsm/postprocessing/SSRPass.js';
import { SMAAPass } from '/vendor/three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from '/vendor/three/examples/jsm/shaders/FXAAShader.js';
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
  renderOverride(...a) { const back = hideSoft(this.scene); super.renderOverride(...a); back(); }
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

// SSAO that shades the previous pass's image instead of rendering the scene a second time,
// so it stacks on top of reflections.
// v1.2.6: works at half resolution with 16 samples (was full res, 32): AO is a soft, blurred term, the 4x4 noise
// tile and its 5x5 blur stay matched at the lower resolution, and the result is bilinear-upsampled when applied.
class AOPass extends SSAOPass {
  constructor(scene, camera, w, h) {
    super(scene, camera, Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.kernelSize = 16; this.kernel.length = 0; this.generateSampleKernel();
    this.ssaoMaterial.defines.KERNEL_SIZE = 16; this.ssaoMaterial.needsUpdate = true;
  }
  setSize(w, h) { super.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); }
  render(renderer, writeBuffer, readBuffer) {
    syncCam(this.camera, this.ssaoMaterial, this.depthRenderMaterial);   // v1.2.8: see ReflectPass.render
    this.overrideVisibility(); const back = hideSoft(this.scene);
    this.renderOverride(renderer, this.normalMaterial, this.normalRenderTarget, 0x7777ff, 1.0);
    back(); this.restoreVisibility();
    const u = this.ssaoMaterial.uniforms;
    u.kernelRadius.value = this.kernelRadius; u.minDistance.value = this.minDistance; u.maxDistance.value = this.maxDistance;
    this.renderPass(renderer, this.ssaoMaterial, this.ssaoRenderTarget);
    this.renderPass(renderer, this.blurMaterial, this.blurRenderTarget);
    const out = this.renderToScreen ? null : writeBuffer;
    this.copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.copyMaterial.blending = THREE.NoBlending;
    this.renderPass(renderer, this.copyMaterial, out);
    this.copyMaterial.uniforms.tDiffuse.value = this.blurRenderTarget.texture;
    this.copyMaterial.blending = THREE.CustomBlending;
    this.renderPass(renderer, this.copyMaterial, out);
  }
}

const BLOOM = { low: [0.14, 0.3, 0.92], high: [0.26, 0.4, 0.86] };   // strength, radius, threshold (v30: much gentler, only bright lights and glows bloom; it washed out light floors)

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
  let aa = cfg.aa;
  let target;
  if (aa === 'msaa') {
    if (r.capabilities.isWebGL2 && !ssr) {
      target = new THREE.WebGLMultisampleRenderTarget(w * pr, h * pr, { format: THREE.RGBAFormat, stencilBuffer: true });
      target.samples = 4;
    } else aa = 'smaa';   // reflections draw the scene themselves, so smooth edges afterwards instead
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
  } else composer.addPass(new RenderPass(scene, camera));
  if (rt && cfg.sun) { rtPass = new RTShadowPass(scene, camera, cfg.sun, Math.round(w * pr), Math.round(h * pr), rt); composer.addPass(rtPass); }
  if (cfg.ao) {
    aoPass = new AOPass(scene, camera, w * pr, h * pr);
    aoPass.kernelRadius = 0.9; aoPass.minDistance = 0.0004; aoPass.maxDistance = 0.012;
    const p = persp ? 1 : 0;
    aoPass.ssaoMaterial.defines.PERSPECTIVE_CAMERA = p; aoPass.ssaoMaterial.needsUpdate = true;
    aoPass.depthRenderMaterial.defines.PERSPECTIVE_CAMERA = p; aoPass.depthRenderMaterial.needsUpdate = true;
    composer.addPass(aoPass);
  }
  if (BLOOM[cfg.bloom]) composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), ...BLOOM[cfg.bloom]));
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
