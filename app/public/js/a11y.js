// Color-blind support (Settings → Color-blind mode).
// 1. A daltonization filter over the whole screen (3D view and menus): colors that this type of color
//    vision confuses are shifted into ones it can tell apart. It's one color matrix, so it's cheap.
// 2. Platform height colors switch to a palette that stays distinct for every type (Okabe-Ito).
// 3. Card stat lines get ▲ / ▼ marks so good and bad never rely on green/red alone.
import { ART } from './config.js';

// Machado et al. (2009) simulation matrices at full severity.
const SIM = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
};
// Where the lost information is moved to (the usual daltonize error-shift matrix).
const SHIFT = [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1];
const mul = (a, b) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]); return o; };
export function daltonMatrix(mode) {
  const S = SIM[mode]; if (!S) return null;
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1], E = mul(SHIFT, I.map((v, i) => v - S[i]));
  return I.map((v, i) => v + E[i]);
}

const DEFAULT_TIERS = ART.tierColors.slice();
const CB_TIERS = ['#56b4e9', '#e69f00', '#cc79a7'];

export function applyColorBlind(mode) {
  const on = !!SIM[mode];
  ART.tierColors.splice(0, 3, ...(on ? CB_TIERS : DEFAULT_TIERS));
  document.documentElement.classList.toggle('cb', on);
  let svg = document.getElementById('cbFilterSvg');
  if (!on) { document.documentElement.style.filter = ''; return; }
  const m = daltonMatrix(mode);
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'cbFilterSvg'; svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.innerHTML = '<filter id="cbFilter" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=""/></filter>';
    document.body.appendChild(svg);
  }
  const vals = [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0].map(v => +v.toFixed(4)).join(' ');
  svg.querySelector('feColorMatrix').setAttribute('values', vals);
  // On the root element a filter doesn't change how fixed-position menus are laid out.
  document.documentElement.style.filter = 'url(#cbFilter)';
}
