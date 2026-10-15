// v27: ray tracing and upscaling passes for the post chain (post.js).
// The game runs on WebGL, so "ray tracing" here is hybrid screen-space ray tracing: rays are marched through the
// depth buffer every frame. RTShadowPass traces a ray from every pixel toward the sun and darkens what it hits
// (sharp contact shadows under feet, props and block edges that shadow maps blur away). Reflections on every
// surface come from three's SSRPass, set up in post.js. UpscalePass is an FSR 1-style upscaler: the scene renders
// at a lower resolution, then a 12-tap edge-aware (Catmull-Rom) upscale plus contrast-adaptive sharpening fills
// the full-resolution screen.
import * as THREE from '/vendor/three/build/three.module.js';
import { hideSoft } from './post.js';
import { Pass, FullScreenQuad } from '/vendor/three/examples/jsm/postprocessing/Pass.js';

const RT_Q = { on: { steps: 24, dist: 3.2, strength: 0.42 }, ultra: { steps: 48, dist: 5, strength: 0.5 } };

export class RTShadowPass extends Pass {
  // v1.2.17: depthSrc() hands over the depth the scene pass already drew (post.js), so the scene is no longer drawn a
  // second time just for depth (that doubled the draw calls: the main cost of ray tracing on Windows)
  constructor(scene, camera, sun, w, h, quality = 'on', depthSrc = null) {
    super();
    this.scene = scene; this.camera = camera; this.sun = sun; this.depthSrc = depthSrc;
    const Q = RT_Q[quality] || RT_Q.on;
    this.L = new THREE.Vector3();
    if (!depthSrc) {
      this.depthTarget = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.depthTarget.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    }
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      defines: { STEPS: Q.steps, PERSP: camera.isPerspectiveCamera ? 1 : 0 },
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: this.depthTarget ? this.depthTarget.depthTexture : null },
        uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
        uLight: { value: new THREE.Vector3() }, uDist: { value: Q.dist }, uStrength: { value: Q.strength },
        uThick: { value: 0.35 }, uFrame: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform sampler2D tDiffuse, tDepth; uniform mat4 uProj, uInvProj; uniform vec3 uLight;
        uniform float uDist, uStrength, uThick, uFrame; varying vec2 vUv;
        vec3 viewPos(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          return v.xyz / v.w;
        }
        float hash(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }   // v28: fixed interleaved-gradient noise (per-frame noise shimmered along edges)
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          float d = texture2D(tDepth, vUv).x;
          if (d >= 0.99999) { gl_FragColor = col; return; }
          vec3 P = viewPos(vUv);
          float depthK = PERSP == 1 ? clamp(-P.z / 40.0, 0.02, 1.0) : 0.05;
          vec3 start = P + uLight * (0.03 + 0.02 * depthK * 10.0);
          float jitter = hash(gl_FragCoord.xy);
          float occ = 0.0;
          for (int i = 1; i <= STEPS; i++) {
            float k = (float(i) - jitter) / float(STEPS);
            vec3 Q = start + uLight * (uDist * k * k);
            vec4 c = uProj * vec4(Q, 1.0);
            if (c.w <= 0.0) break;   // v1.2.8: the ray passed behind the camera (first person, sun at your back): its projection flips and hit random pixels
            vec2 uv = c.xy / c.w * 0.5 + 0.5;
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
            float sceneZ = viewPos(uv).z;
            float dz = sceneZ - Q.z;   // > 0: something sits between this point of the ray and the camera
            float bias = 0.02 + 0.06 * depthK;
            if (dz > bias && dz < uThick + uDist * k * 0.25) { occ = 1.0 - k * 0.6; break; }
          }
          gl_FragColor = vec4(col.rgb * (1.0 - uStrength * occ), col.a);
        }`,
    }));
  }
  setSize(w, h) {   // a fresh target (depth textures don't always follow a resize)
    if (this.depthSrc) return;
    const old = this.depthTarget;
    this.depthTarget = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.depthTarget.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
    this.quad.material.uniforms.tDepth.value = this.depthTarget.depthTexture;
    old.dispose();
  }
  render(renderer, writeBuffer, readBuffer) {
    // depth of the scene from this camera (color writes off, so it is cheap)
    const u = this.quad.material.uniforms, cam = this.camera;
    if (this.depthSrc) u.tDepth.value = this.depthSrc();
    else {
      const ov = this.scene.overrideMaterial, bg = this.scene.background;
      this.scene.overrideMaterial = this.depthMat; this.scene.background = null; const back = hideSoft(this.scene);
      renderer.setRenderTarget(this.depthTarget); renderer.clear(); renderer.render(this.scene, this.camera); back();
      this.scene.overrideMaterial = ov; this.scene.background = bg;
    }
    u.tDiffuse.value = readBuffer.texture;
    u.uProj.value.copy(cam.projectionMatrix); u.uInvProj.value.copy(cam.projectionMatrixInverse);
    // direction toward the sun, in view space
    const L = this.L.subVectors(this.sun.position, this.sun.target.position).normalize();
    u.uLight.value.copy(L.transformDirection(cam.matrixWorldInverse));
    u.uFrame.value = (u.uFrame.value + 1) % 64;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { if (this.depthTarget) this.depthTarget.dispose(); this.depthMat.dispose(); this.quad.material.dispose(); this.quad.dispose(); }
}

// FSR 1-style upscale, in two steps like AMD's FSR 1 (v28: sharper edges, was a Catmull-Rom blur + a light sharpen):
//  1. EASU-style: a 4x4 Lanczos-2 filter of the low-res frame, clamped to the 2x2 texels around the pixel so edges
//     don't ring or halo. Lanczos keeps edges much crisper than Catmull-Rom.
//  2. RCAS-style: contrast-adaptive sharpening at full resolution, limited per pixel so it never overshoots.
const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
export class UpscalePass extends Pass {
  constructor(sharp = 0.8) {
    super();
    this.mid = null;
    this.easu = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uSrc: { value: new THREE.Vector2(1, 1) } },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uSrc; varying vec2 vUv;
        float lz(float x) {   // Lanczos-2 window
          x = abs(x); if (x < 1e-4) return 1.0; if (x >= 2.0) return 0.0;
          float px = 3.14159265 * x; return 2.0 * sin(px) * sin(px * 0.5) / (px * px);
        }
        vec3 tap(vec2 t) { return texture2D(tDiffuse, (t + 0.5) / uSrc).rgb; }
        void main() {
          vec2 p = vUv * uSrc - 0.5, b = floor(p), f = p - b;
          vec3 sum = vec3(0.0); float wsum = 0.0;
          for (int j = -1; j <= 2; j++) for (int i = -1; i <= 2; i++) {
            float w = lz(float(i) - f.x) * lz(float(j) - f.y);
            sum += tap(b + vec2(float(i), float(j))) * w; wsum += w;
          }
          vec3 c = sum / wsum;
          vec3 a = tap(b), bb = tap(b + vec2(1.0, 0.0)), cc = tap(b + vec2(0.0, 1.0)), d = tap(b + vec2(1.0, 1.0));
          c = clamp(c, min(min(a, bb), min(cc, d)), max(max(a, bb), max(cc, d)));   // deringing
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    this.rcas = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uPx: { value: new THREE.Vector2(1, 1) }, uSharp: { value: sharp } },
      vertexShader: VERT,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uPx; uniform float uSharp; varying vec2 vUv;
        void main() {
          vec3 e = texture2D(tDiffuse, vUv).rgb;
          vec3 b = texture2D(tDiffuse, vUv + vec2(0.0, -uPx.y)).rgb, d = texture2D(tDiffuse, vUv + vec2(-uPx.x, 0.0)).rgb;
          vec3 f = texture2D(tDiffuse, vUv + vec2(uPx.x, 0.0)).rgb, h = texture2D(tDiffuse, vUv + vec2(0.0, uPx.y)).rgb;
          vec3 mn = min(min(b, d), min(f, h)), mx = max(max(b, d), max(f, h));
          // RCAS: the largest negative lobe that keeps the result inside the neighbours' range
          vec3 hitMin = mn / (4.0 * mx + 1e-4), hitMax = (1.0 - mx) / (4.0 * mn - 4.0 - 1e-4);
          vec3 lobeRGB = max(-hitMin, hitMax);
          float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * uSharp;
          vec3 c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
    }));
  }
  render(renderer, writeBuffer, readBuffer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!this.mid || this.mid.width !== size.x || this.mid.height !== size.y) {
      if (this.mid) this.mid.dispose();
      this.mid = new THREE.WebGLRenderTarget(size.x, size.y, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    }
    const e = this.easu.material.uniforms;
    e.tDiffuse.value = readBuffer.texture; e.uSrc.value.set(readBuffer.width, readBuffer.height);
    renderer.setRenderTarget(this.mid); this.easu.render(renderer);
    const r = this.rcas.material.uniforms;
    r.tDiffuse.value = this.mid.texture; r.uPx.value.set(1 / size.x, 1 / size.y);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.rcas.render(renderer);
  }
  dispose() { if (this.mid) this.mid.dispose(); for (const q of [this.easu, this.rcas]) { q.material.dispose(); q.dispose(); } }
}
