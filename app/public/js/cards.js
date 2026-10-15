// Card system: cards are plain data (cards/<folder>/card.json) that modify stats.
import { STAT_INFO, RARITY, CURSED_ODDS, HOLY_ODDS, DEFAULT_STATS } from './config.js';

export function validateCard(c) {
  const e = [];
  if (!c || typeof c !== 'object') return ['card.json must contain an object'];
  if (typeof c.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) e.push('"id" must be lowercase letters, digits and dashes');
  if (typeof c.name !== 'string' || !c.name.trim()) e.push('"name" is required');
  if (c.rarity !== undefined && !RARITY[c.rarity]) e.push(`"rarity" must be one of ${Object.keys(RARITY).join(', ')}`);
  if (!Array.isArray(c.modifiers) || (!c.modifiers.length && !c.special)) e.push('"modifiers" must be a non-empty list');
  else c.modifiers.forEach((m, i) => {
    if (!m || !STAT_INFO[m.stat]) e.push(`modifier ${i + 1}: unknown stat "${m && m.stat}"`);
    if (!m || !['mul', 'add', 'set', 'convert'].includes(m.op)) e.push(`modifier ${i + 1}: "op" must be "mul", "add", "set" or "convert"`);
    if (m && m.op === 'convert' && !STAT_INFO[m.to]) e.push(`modifier ${i + 1}: "convert" needs a "to" stat`);
    if (!m || typeof m.value !== 'number' || !isFinite(m.value)) e.push(`modifier ${i + 1}: "value" must be a number`);
  });
  if (c.weaponMod !== undefined && typeof c.weaponMod !== 'string') e.push('"weaponMod" must be a name');
  if (c.shieldMod !== undefined && typeof c.shieldMod !== 'string') e.push('"shieldMod" must be a name');
  if (c.combo !== undefined && !(Array.isArray(c.combo) && c.combo.length === 2)) e.push('"combo" must list exactly two card ids');
  if (c.modes !== undefined && !(Array.isArray(c.modes) && c.modes.every(m => ['commander', 'waves'].includes(m)))) e.push('"modes" may contain "commander" and/or "waves"');
  return e;
}

export function clampStats(s) {
  for (const [k, info] of Object.entries(STAT_INFO)) {
    if (typeof s[k] !== 'number' || !isFinite(s[k])) continue;
    s[k] = Math.min(info.max, Math.max(info.min, s[k]));
    if (info.int) s[k] = Math.round(s[k]);
  }
  return s;
}

// v1.1.4: multipliers that apply after all cards (Twin Barrel doubles your bullets whenever you took it).
// v1.2.11: stats are clamped once here, after every card, so the order you took cards in doesn't change the result
// (a stat pinned at its limit used to lose the cards taken before it hit the limit).
export function finishStats(s) {
  clampStats(s);
  if (s.tank > 0) s.jump = 0;   // Tiny Tank: no jumping at all
  if (s.projMul > 1) s.projectiles = Math.min(STAT_INFO.projectiles.max, Math.max(1, Math.round(s.projectiles * s.projMul)));
  return s;
}
export function applyCard(stats, card) {
  for (const m of card.modifiers) {
    if (!(m.stat in stats)) continue;
    if (m.op === 'mul') stats[m.stat] *= m.value;
    else if (m.op === 'add') stats[m.stat] += m.value;
    else if (m.op === 'set') stats[m.stat] = m.value;      // resets the stat when the card is taken (later cards still change it)
    else if (m.op === 'convert') {
      // Trade one stat for another proportionally, e.g. halve ammo and double damage:
      // { "stat": "ammo", "op": "convert", "value": 0.5, "to": "damage" }
      const info = STAT_INFO[m.stat] || {}, before = stats[m.stat];
      let after = before * m.value;
      if (info.int) after = Math.max(info.min ?? 1, Math.round(after));
      stats[m.stat] = after;
      if (after > 0) stats[m.to] *= before / after;
    }
  }
  return stats;   // (clamped in finishStats, after the last card)
}

// Turns modifiers into display lines: [text, label, isGood, statKey]
// Holy and cursed cards show general words instead of exact numbers (vague); the detail window can ask for exact ones.
const STAT_BY_LABEL = Object.fromEntries(Object.entries(STAT_INFO).map(([k, v]) => [v.label.toLowerCase(), k]));
export function cardLines(card, { exact = false } = {}) {
  if (Array.isArray(card.displayLines)) return card.displayLines.map(l => [l.text, l.label, l.good !== false, l.stat || STAT_BY_LABEL[String(l.label || '').toLowerCase()] || '']);
  const vague = false;   // holy and cursed cards show exact numbers like every other card (Devin, v26)
  return card.modifiers.map(m => {
    const info = STAT_INFO[m.stat] || { label: m.stat };
    const up = m.op === 'mul' ? m.value > 1 : m.value > 0;
    const good = up !== !!info.lowerIsBetter;
    let text;
    if (m.op === 'set') return [`=${+m.value.toFixed(2)}${info.suffix || ''}`, `${info.label} (reset)`, true, m.stat];
    if (m.op === 'convert') {
      const to = STAT_INFO[m.to] || { label: m.to };
      // e.g. Combine: x0.5 ammo -> each remaining bullet carries the damage of the ones removed
      const base = DEFAULT_STATS[m.stat] || 3, after = Math.max(1, Math.round(base * m.value));
      const per = (base / after - 1) / Math.max(1, base - after);
      return [`×${m.value}`, `${info.label}; ${to.label} +${Math.round(per * 100)}% per ${info.label.toLowerCase()} removed`, true, m.stat];
    }
    if (info.flag) text = up ? '✦' : '✕';
    else if (vague) {
      const word = good ? 'greatly' : card.rarity === 'cursed' ? 'severely' : 'greatly';
      return [up ? '▲▲' : '▼▼', `${info.label}, ${word} ${up ? 'raised' : 'lowered'}`, good, m.stat];
    }
    else if (m.stat === 'projMul') text = '×' + (+m.value.toFixed(2));
    else if (m.op === 'mul') text = (m.value >= 1 ? '+' : '') + Math.round((m.value - 1) * 100) + '%';
    else if (info.percent) text = (m.value >= 0 ? '+' : '') + Math.round(m.value * 100) + '%';
    else text = (m.value >= 0 ? '+' : '') + (+m.value.toFixed(2)) + (info.suffix || '');
    return [text, info.label, good, m.stat];
  });
}

// Offer weight: cursed and holy cards use their original card's rarity times CURSED_ODDS / HOLY_ODDS.
export function cardWeight(c) {
  if (c.rarity === 'cursed') return (RARITY[c.baseRarity] || RARITY.rare).weight * CURSED_ODDS;
  if (c.rarity === 'holy') return (RARITY[c.baseRarity] || RARITY.rare).weight * HOLY_ODDS;
  return RARITY[rarityOf(c)].weight;
}
export function rarityOf(card) { return RARITY[card.rarity] ? card.rarity : 'common'; }

// Weighted pick of n distinct cards.
export function weightedOffer(cards, n, rng = Math.random, excludeIds = []) {
  let pool = cards.filter(c => !excludeIds.includes(c.id));
  if (pool.length < n) pool = cards.slice();
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, c) => a + cardWeight(c), 0);
    let r = rng() * total, i = 0;
    for (; i < pool.length - 1; i++) { r -= cardWeight(pool[i]); if (r <= 0) break; }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

// Is this modifier an upside? (flags count as upsides; "convert" trades are neutral)
function isGood(m) {
  if (m.op === 'set') return true;
  const info = STAT_INFO[m.stat] || {};
  if (info.flag) return true;
  const up = m.op === 'mul' ? m.value > 1 : m.value > 0;
  return up !== !!info.lowerIsBetter;
}
// Cards that never get cursed / holy versions: mods, combos, specials (Regretful Pact, Repentance),
// and cards that are already cursed or holy.
export function variantEligible(c) {
  if (c.variants && !variantBase(c) && c.rarity !== 'combo' && !c.special) return true;   // v1.2.15: mods that opt in get holy / cursed versions too
  return !(c.rarity === 'cursed' || c.rarity === 'holy' || c.rarity === 'mod' || c.rarity === 'shieldmod' || c.rarity === 'combo' ||
    c.weaponMod || c.shieldMod || c.special || c.combo);
}

// Cursed version of a card: every upside three times as strong, every downside five times as strong,
// plus the curse's toll: it slowly drains your health (never below 1). Siphoning from enemies is its own card now (Drain Life).
// Multipliers below 1 use powers instead (x0.75 downside -> x0.75^5) so nothing hits zero.
// Cards with only upsides get one small built-in downside (then made five times as strong like any other).
export const CURSE = { up: 3, down: 5, drain: 0.05 };
const CURSE_PENALTIES = [
  { stat: 'health', op: 'mul', value: 0.92 }, { stat: 'moveSpeed', op: 'mul', value: 0.95 },
  { stat: 'reloadTime', op: 'mul', value: 1.08 }, { stat: 'blockCooldown', op: 'mul', value: 1.1 },
  { stat: 'fireRate', op: 'mul', value: 0.94 }, { stat: 'damage', op: 'mul', value: 0.94 },
];
function hashStr(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
export function curseValue(m) {
  const info = STAT_INFO[m.stat] || {};
  if (m.op === 'convert' || info.flag) return m.value;
  const up = m.op === 'mul' ? m.value > 1 : m.value > 0, good = up !== !!info.lowerIsBetter, k = good ? CURSE.up : CURSE.down;
  let v = m.value;
  if (m.op === 'mul') v = up ? 1 + k * (v - 1) : v ** k;
  else v = v * k;
  return Math.round(v * 1000) / 1000;
}
const curseMods = () => [{ stat: 'drain', op: 'add', value: CURSE.drain }];
export function makeCursed(card) {
  const base = card.modifiers.filter(m => m.op !== 'convert');
  if (!hasUpAndDown(card)) {
    const used = new Set(base.map(m => m.stat));
    const options = CURSE_PENALTIES.filter(p => !used.has(p.stat));
    base.push({ ...options[hashStr(card.id) % options.length] });
  }
  const conv = card.modifiers.filter(m => m.op === 'convert');
  const mods = [...conv, ...base].map(m => ({ ...m, value: curseValue(m) }));
  const out = {
    ...card, id: 'cursed-' + card.id, name: 'Cursed ' + card.name, rarity: 'cursed', cursedFrom: card.id, baseRarity: card.rarity || 'common',
    description: card.description || '', details: card.details,
    modifiers: mods.concat(curseMods()),
  };
  delete out.displayLines;
  return out;
}
// Holy version: the card's upsides, twice as strong, with none of its downsides. Made for every eligible card;
// when doubling changes nothing (flag or convert-only cards) the blessing adds a little health instead.
// "holyDescription" in card.json replaces the description when the original mentions a downside.
export const HOLY_BOOST = 2;
export function holyValue(m) {
  const info = STAT_INFO[m.stat] || {};
  if (m.op !== 'mul' && m.op !== 'add') return m.value;
  if (info.flag) return m.value;
  let v = m.value;
  if (m.op === 'mul') v = v > 1 ? 1 + HOLY_BOOST * (v - 1) : v ** HOLY_BOOST;
  else v = v * HOLY_BOOST;
  return Math.round(v * 1000) / 1000;
}
export function makeHoly(card) {
  const out = {
    ...card, id: 'holy-' + card.id, name: 'Holy ' + card.name, rarity: 'holy', holyFrom: card.id, baseRarity: card.rarity || 'common',
    description: card.holyDescription || card.description || '', details: card.holyDetails || card.details,
    modifiers: card.modifiers.filter(m => m.op === 'convert' || isGood(m)).map(m => ({ ...m, value: m.op === 'convert' ? m.value : holyValue(m) })),
  };
  if (!hasDownside(card) && card.modifiers.every(m => m.op === 'convert' || holyValue(m) === m.value)) out.modifiers = out.modifiers.concat([{ stat: 'health', op: 'mul', value: 1.2 }]);
  delete out.displayLines;
  return out;
}
export function hasDownside(card) { return card.modifiers.some(m => m.op !== 'convert' && !isGood(m)); }
function hasUpAndDown(card) {
  let good = false, bad = false;
  for (const m of card.modifiers) { if (m.op === 'convert') continue; if (isGood(m)) good = true; else bad = true; }
  return good && bad;
}

// Holy / cursed are rolled onto a regular card when it's dealt (see Game.makeOffer). VARIANT_CHANCE is per dealt card.
export const VARIANT_CHANCE = { cursed: CURSED_ODDS / (1 + CURSED_ODDS + HOLY_ODDS), holy: HOLY_ODDS / (1 + CURSED_ODDS + HOLY_ODDS) };
export const variantBase = c => (c && (c.holyFrom || c.cursedFrom)) || null;
// Adds the automatic cursed and holy versions to a list of loaded cards (in place; also returns it).
// Combos get both too: a combo made from a holy (or cursed) piece comes out holy (or cursed); one of each cancels out.
// Set "noCursed": true / "noHoly": true in a card.json to skip either one.
export function expandCards(cards) {
  const seen = new Set(cards.map(c => c.id));
  for (const c of cards) if (c.rarity === 'cursed') {
    if (!c.modifiers.some(m => m.stat === 'drain')) c.modifiers = c.modifiers.concat([{ stat: 'drain', op: 'add', value: CURSE.drain }]);
  }
  for (const c of cards.slice()) {
    if (!variantEligible(c)) continue;
    if (!c.noCursed && !seen.has('cursed-' + c.id)) { const k = makeCursed(c); cards.push(k); seen.add(k.id); }
    if (!c.noHoly && !seen.has('holy-' + c.id)) { const k = makeHoly(c); cards.push(k); seen.add(k.id); }
  }
  for (const c of cards.slice()) {
    if (!c.combo || variantBase(c)) continue;
    if (!seen.has('cursed-' + c.id)) { const k = makeCursed(c); cards.push(k); seen.add(k.id); }
    if (!seen.has('holy-' + c.id)) { const k = makeHoly(c); cards.push(k); seen.add(k.id); }
  }
  return cards;
}

export async function loadCards() {
  const res = await fetch('/api/cards', { cache: 'no-store' });
  const list = await res.json();
  const cards = [], errors = [], seen = new Set();
  for (const e of list) {
    if (e.error) { errors.push({ folder: e.folder, error: e.error }); continue; }
    const errs = validateCard(e.card);
    if (!errs.length && seen.has(e.card.id)) errs.push(`duplicate id "${e.card.id}"`);
    if (errs.length) { errors.push({ folder: e.folder, error: errs.join('; ') }); continue; }
    seen.add(e.card.id);
    cards.push({ ...e.card, rarity: rarityOf(e.card), folder: e.folder, imageUrl: e.imageUrl });
  }
  expandCards(cards);
  return { cards, errors };
}
