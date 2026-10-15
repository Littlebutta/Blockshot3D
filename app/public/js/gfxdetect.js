// v1.1.9: graphics auto-detect (it used to run inside the intro cinematic, which is gone). A first guess from
// the GPU's name; main.js then quietly checks the frame rate on the title screen and steps down if needed.
export const GFX_TIERS = ['low', 'medium', 'high', 'ultra', 'raytraced'];
export const TIER_LABEL = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', raytraced: 'Ultra + ray tracing' };

export function gpuInfo(renderer) {
  let name = '';
  try { const gl = renderer.r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch { /* hidden */ }
  const n = name.toLowerCase();
  let guess = 'high';
  if (/swiftshader|llvmpipe|softpipe|basic render|software|mesa offscreen/.test(n)) guess = 'low';
  else if (/rtx ?(30|40|50)\d\d|rx ?(6[7-9]|7[6-9]|9\d)\d\d|radeon pro w7|apple m[2-9] (pro|max|ultra)|arc a7/.test(n)) guess = 'raytraced';
  else if (/rtx|gtx ?(16|10[6-8])|rx ?(5[6-7]|6[0-6]|7[0-5])\d\d|apple m[1-9]|arc a[35]/.test(n)) guess = 'ultra';
  // v1.2.6: integrated / entry GPUs start at Medium (High's AO pass was too much for them; the title-screen check
  // only steps down). ANGLE names spell them "Iris(R) Xe" and "Radeon(TM) Graphics".
  else if (/iris(\(r\))? xe|radeon(\(tm\))? graphics|radeon(\(tm\))? \d{3}m\b|\b[67]80m\b|\bmx ?\d{3}\b|gtx ?[79]\d\dm?\b|gtx ?1050/.test(n)) guess = 'medium';
  else if (/gtx|radeon rx|nvidia|geforce/.test(n)) guess = 'high';
  else if (/intel|uhd|hd graphics|mali|adreno|powervr|vega [3-8]\b/.test(n)) guess = 'medium';
  return { name, guess };
}
