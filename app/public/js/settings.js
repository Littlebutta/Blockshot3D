// Per-player settings, saved in this browser (and, in the desktop app, in Documents/Blockshot3D/settings.json too).
const KEY = 'blockshot3d.settings';
export const DEFAULT_SETTINGS = {
  name: 'Player',
  view: 'third',        // 'third' | 'first'
  fov: 60,
  sensitivity: 1,
  master: 0.8,
  music: 0.45,
  sfx: 0.8,
  effects: 'high',      // 'high' | 'low' | 'off'
  shadows: true,
  // Graphics (Settings > Graphics). Defaults are the Medium preset, which runs on modest PCs.
  gfxPreset: 'medium',  // 'low' | 'medium' | 'high' | 'ultra' | 'custom'
  lighting: 'vivid',    // 'classic' | 'vivid'
  shadowQ: 'medium',    // 'low' | 'medium' | 'high' (shadow map 1024 / 2048 / 4096)
  ao: false,            // screen-space ambient occlusion (contact shadows)
  bloom: 'off',         // 'off' | 'low' | 'high' (v1.2.6: off on Medium; bloom alone forced the whole post-processing chain)
  reflections: 'off',   // 'off' | 'probe' (reflection probe + bounce light) | 'ssr' (probe + screen-space floor reflections)
  aa: 'msaa',           // 'off' | 'fxaa' | 'smaa' | 'msaa' | 'msaa8' | 'ssaa' (v1.2.17: MSAA 8x, supersampling)
  uiScale: 1,           // v1.2.16: size of menus and HUD (0.7 to 1.5)
  renderScale: 1,       // 0.5 to 1 of the screen's resolution
  raytracing: 'off',    // v27: 'off' | 'on' | 'ultra' (hybrid screen-space ray tracing: reflections on every surface + traced sun shadows)
  upscaler: 'off',      // v27: 'off' | 'quality' | 'balanced' | 'performance' (FSR 1-style upscale + sharpen)
  vsync: true,          // desktop app: off unlocks the frame rate (after a restart); browsers always sync
  fpsCap: 0,            // 0 = no limit
  showFps: false,
  showPing: true,       // v30: live ping readout + connection warnings in multiplayer matches
  netPredict: true,     // v30: move your own character instantly when you join someone's game (client-side prediction)
  hiModels: true,       // v28: extra model detail (squid bullet tentacles)       // v28: FPS counter in the top-right corner
  screenShake: true,
  shakeMax: 0.5,        // v1.2.21: the most the camera may shake (0.1-1 of the old uncapped peak), however much is going on
  emoteSlots: null,     // v1.2.21: the 8 emotes on the wheel (main.js EMOTES keys); null = the defaults
  rtsLock: true,        // v1.2.27: RTS in fullscreen keeps the mouse in the window (pointer lock + drawn cursor) so edge panning always works
  killCam: true,        // v1.2.15: replay the round-winning kill from the killer's eyes
  feel: true,           // v1.2.0: hit-stop on kills and slow motion on the round-winning kill
  props: true,          // grass and pebbles
  slop: false,
  pillow: false,        // anime mode: everyone looks like a body pillow (only on your screen)
  language: 'en',       // see LANGUAGES in i18n.js
  colorBlind: 'off',    // 'off' | 'protan' | 'deutan' | 'tritan' (see a11y.js)
  recommend: false,
  cursorAmmo: true,     // small ammo count + reload bar next to the cursor
  shieldHaze: true,     // brief white screen-edge glow when your block is ready again
  binds: null,          // custom controls (see DEFAULT_BINDS); null = defaults     // card screen: gently point out cards that fit your build
  topZoom: 1,           // v1.2.13: top-down camera zoom (scroll wheel in a match), 0.6-2.2
  previewSpin: false,   // Customize: spin the character preview
  color: null,          // preferred player color (free-for-all), one of ART.ffaColors
  cosmetics: { model: 'classic', hat: 'none', face: 'none', eyes: 'none', neck: 'none', body: 'none', gun: 'cube' }, // chosen in Customize
};
export const GFX_PRESETS = {
  low:    { lighting: 'classic', shadows: false, shadowQ: 'low', ao: false, bloom: 'off', reflections: 'off', aa: 'fxaa', renderScale: 0.75, raytracing: 'off', upscaler: 'off', hiModels: false },
  medium: { lighting: 'vivid', shadows: true, shadowQ: 'medium', ao: false, bloom: 'off', reflections: 'off', aa: 'msaa', renderScale: 1, raytracing: 'off', upscaler: 'off', hiModels: true },
  high:   { lighting: 'vivid', shadows: true, shadowQ: 'high', ao: true, bloom: 'low', reflections: 'probe', aa: 'msaa', renderScale: 1, raytracing: 'off', upscaler: 'off', hiModels: true },
  ultra:  { lighting: 'vivid', shadows: true, shadowQ: 'high', ao: true, bloom: 'high', reflections: 'ssr', aa: 'msaa', renderScale: 1, raytracing: 'off', upscaler: 'off', hiModels: true },
  raytraced: { lighting: 'vivid', shadows: true, shadowQ: 'high', ao: true, bloom: 'high', reflections: 'ssr', aa: 'smaa', renderScale: 1, raytracing: 'on', upscaler: 'quality', hiModels: true },
};
const newClientId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
export function loadSettings() {
  let s;
  let first = false;
  // v1.2.11: the desktop app's settings file wins over browser storage (which is lost when the game runs on another port)
  let raw = null;
  try { const b = typeof window !== 'undefined' && window.steamBridge; if (b && b.readSettings) { raw = b.readSettings(); JSON.parse(raw || 'x'); } } catch { raw = null; }
  try { if (!raw) raw = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  try { first = !raw; s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw || '{}') }; }
  catch { s = { ...DEFAULT_SETTINGS }; }
  Object.defineProperty(s, 'firstRun', { value: first, enumerable: false });   // v30: never saved; the quiet graphics check sets the defaults on a first run (main.js quietGfxCheck)
  // Lets a host recognize you if you drop out of a match and come back (your cards are restored).
  if (!s.clientId) { s.clientId = newClientId(); saveSettings(s); }
  // v1.2.6: saved-settings revision (absent = before 1.2.6). 1: the Medium preset dropped bloom, so a saved Medium follows.
  if (!(s.rev >= 1)) { if (s.gfxPreset === 'medium') s.bloom = 'off'; s.rev = 1; saveSettings(s); }
  // 2 (v1.2.21, Devin): middle mouse no longer opens the emote wheel unless the player binds it again
  if (!(s.rev >= 2)) { if (s.binds && Array.isArray(s.binds.emote) && s.binds.emote[1] === 'Mouse1') s.binds = { ...s.binds, emote: [s.binds.emote[0] || 'KeyQ', ''] }; s.rev = 2; saveSettings(s); }
  return s;
}
export function saveSettings(s) {
  const text = JSON.stringify(s);
  try { localStorage.setItem(KEY, text); } catch { /* storage blocked */ }
  try { const b = typeof window !== 'undefined' && window.steamBridge; if (b && b.writeSettings) b.writeSettings(text); } catch { /* not the desktop app */ }
}
// v1.2.11: Settings > General "Save to file" / "Load from file": the whole settings object (key bindings included) as JSON.
export function settingsFileText(s) { return JSON.stringify({ blockshot3dSettings: 1, ...s }, null, 2); }
export function parseSettingsFile(text) {
  const o = JSON.parse(text);
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not a settings file');
  if (!o.blockshot3dSettings && !('binds' in o) && !('gfxPreset' in o)) throw new Error('not a Blockshot 3D settings file');
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in o && (DEFAULT_SETTINGS[k] === null || o[k] === null || typeof o[k] === typeof DEFAULT_SETTINGS[k])) out[k] = o[k];
  for (const k of Object.keys(o)) if (!(k in DEFAULT_SETTINGS) && k !== 'blockshot3dSettings' && k !== 'clientId') out[k] = o[k];   // cash, cosmetics owned, revisions...
  return out;
}

// Controls. Each action has two slots: a KeyboardEvent.code, or "Mouse0" / "Mouse1" / "Mouse2"... for mouse buttons.
export const DEFAULT_BINDS = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space', ''], shoot: ['Mouse0', ''], block: ['Mouse2', 'ShiftLeft'], reload: ['KeyR', ''],
  view: ['Tab', ''], use: ['KeyE', ''], crouch: ['KeyC', ''], cursor: ['AltLeft', 'AltRight'], practice: ['KeyP', ''], netstats: ['KeyN', 'F2'], netlog: ['F3', ''], dash: ['KeyF', ''], emote: ['KeyQ', ''],
};
export const BIND_LABELS = {
  up: 'Move forward', down: 'Move back', left: 'Move left', right: 'Move right', jump: 'Jump', shoot: 'Shoot (hold)',
  block: 'Block (stops bullets)', reload: 'Reload', view: 'Switch first / third person', use: 'Use: vehicles (open world), carry props (core defense)', crouch: 'Open world: crouch (hold, harder to spot)', cursor: 'First person: free the cursor', practice: 'Practice range panel', netstats: 'Multiplayer: network status window', netlog: 'Network log: start recording, press again to save it to a file', dash: 'Brawl: air dash (hold in the air to charge, let go to dash toward the mouse)', emote: 'Emote and ping wheel (hold, move the mouse, let go)',
};
export function bindsOf(s) {
  const out = {};
  for (const [k, d] of Object.entries(DEFAULT_BINDS)) {
    const b = s.binds && Array.isArray(s.binds[k]) ? s.binds[k] : d;
    out[k] = [b[0] || '', b[1] || ''];
  }
  return out;
}
export function codeLabel(code) {
  if (!code) return '—';
  const m = /^Mouse(\d)$/.exec(code);
  if (m) return ['Left click', 'Middle click', 'Right click', 'Mouse 4', 'Mouse 5'][+m[1]] || 'Mouse ' + m[1];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code];
  return code.replace(/(Left|Right)$/, ' $1').replace(/^Numpad/, 'Num ');
}
