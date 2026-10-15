// Cash, the cosmetic shop and match bets. Everything here is per player and saved with their settings
// (this browser / this PC only). Cash is earned by playing matches; it only buys cosmetics, never power.
import { COSMETICS } from './config.js';

// Cosmetic prices. The first entry of each slot ('none' / the Cube gun) is always free.
export const PRICES = {
  hat: { tophat: 150, cowboy: 150, bowler: 120, beanie: 100, crown: 400, party: 120, halo: 350, fez: 150, headphones: 200,
    propeller: 180, viking: 250, chef: 150, wizard: 300, bunny: 150, pirate: 250, trooper: 450, crusader: 450, psicords: 400 },
  face: { mustache: 80, handlebar: 120, beard: 150, clown: 60, goatee: 90 },
  eyes: { monocle: 120, shades: 100, goggles: 150, hearts: 140, eyepatch: 90, glasses3d: 110, cateyes: 220, nightops: 260 },
  neck: { bowtie: 90, scarf: 110, medal: 200, chain: 300, cape: 250, lei: 120, wolfmed: 300, seals: 220 },
  body: { censor: 69, tutu: 150, floatie: 150, champ: 350, harness: 400, carapace: 400 },
  // Characters cost more than any gun or accessory (the Classic body is free).
  model: { bolt: 800, mochi: 800, sentinel: 900, vanguard: 900, wisp: 900, quack: 800, astro: 1000, cubert: 800, tiki: 900, shroom: 800, prism: 1000, gumdrop: 800, strider: 1200, fishbowl: 1000 },
  gun: { blaster: 150, gold: 600, neon: 300, camo: 200, toy: 150, raygun: 300, candy: 250, banana: 250, baguette: 250, duck: 350, fish: 300, carrot: 250, eblade: 500, gauss: 450 },
};
// Match pay: pay for the time played (perMinute, at least minFinish), plus per round (or wave) won, per kill and
// per 100 damage, plus a win bonus. v26: time-based, so a short "Keep playing" pays for its own length only.
// Free-for-all pays ffaK more (round wins are shared between many players there).
export const PAY = { perMinute: 10, minFinish: 10, round: 12, kill: 6, per100Damage: 2, win: 60, ffaK: 1.6 };
// Bets: pay back BET.payout x the stake on a win. Bets are open from the start of a match until the first
// round (or wave) is decided, and only in multiplayer (at least BET.minHumans people).
export const BET = { payout: 2, chips: [10, 50, 100], minHumans: 2 };

const isFree = (slot, id) => Object.keys(COSMETICS[slot] || {})[0] === id;
export function priceOf(slot, id) { return isFree(slot, id) ? 0 : (PRICES[slot] && PRICES[slot][id]) || 150; }
export function owns(settings, slot, id) { return isFree(slot, id) || !!(settings.owned && settings.owned[slot + ':' + id]); }

// First run with the shop: whatever you're already wearing counts as owned, so nobody loses a look.
export function initEconomy(settings) {
  let changed = false;
  if (typeof settings.cash !== 'number' || !isFinite(settings.cash)) { settings.cash = 0; changed = true; }
  if (!settings.owned) {
    settings.owned = {};
    for (const [slot, id] of Object.entries(settings.cosmetics || {})) if (COSMETICS[slot] && COSMETICS[slot][id] && !isFree(slot, id)) settings.owned[slot + ':' + id] = true;
    changed = true;
  }
  return changed;
}
export function buy(settings, slot, id) {
  const p = priceOf(slot, id);
  if (owns(settings, slot, id)) return { ok: true, price: 0 };
  if (settings.cash < p) return { ok: false, short: p - settings.cash };
  settings.cash -= p; settings.owned[slot + ':' + id] = true;
  return { ok: true, price: p };
}
// What a finished match (or the extension since the last finish) pays. `prev` holds what was already paid for.
export function matchPay({ roundsWon, kills, damage, won, mins = 4, mode }, prev = { roundsWon: 0, kills: 0, damage: 0 }) {
  const r = Math.max(0, roundsWon - prev.roundsWon), k = Math.max(0, kills - prev.kills), d = Math.max(0, damage - prev.damage);
  const parts = { finish: Math.max(PAY.minFinish, Math.round(PAY.perMinute * Math.max(0, mins))), rounds: r * PAY.round, kills: k * PAY.kill, damage: Math.floor(d / 100) * PAY.per100Damage, win: won ? PAY.win : 0 };
  const total = Math.round(Object.values(parts).reduce((a, b) => a + b, 0) * (mode === 'ffa' ? PAY.ffaK : 1));
  return { total, parts };
}
export const fmtCash = n => '💰 ' + Math.floor(n).toLocaleString();
