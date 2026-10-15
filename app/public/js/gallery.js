// =====================================================================
// The Wiki (main menu; v28, was the Art gallery). Two halves:
//   Cards: every shooter card with its effects, organized by rarity (mods, combos, holy and cursed versions too).
//   AMON:  units, enemies and bosses, tactic cards, the factions (troops and traits) and how the mode works.
// A search box filters the current tab. Click an entry for its full page; arrow keys page through, Escape closes.
// =====================================================================
import { UNITS, ENEMIES, BOSSES, FACTIONS, FACTION_TRAITS, factionUnits, buildAmonCards, TIER_COLORS, TIER_NAMES, PATTERNS, fxLines } from './amondata.js';
import { unitThumb, patternThumb } from './amonui.js';
import { cardLines } from './cards.js';
import { TYPE_NOTES } from './cardinfo.js';
import { abilityLines, unitRole, unitTags, unitTips, cardDetails, reachText, TAG_INFO } from './amoninfo.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RARITY_COLORS = { common: '#cfd6ea', uncommon: '#5fe3a1', rare: '#ffb347', legendary: '#ff5fd2', mod: '#7fe0ff', shieldmod: '#8fb4ff', combo: '#ffd166', holy: '#ffe08a', cursed: '#e0464b' };
const RARITY_NAMES = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary', mod: 'Weapon mods', shieldmod: 'Shield mods', combo: 'Combos', holy: 'Holy versions', cursed: 'Cursed versions' };
const CSS = `
#gallery{max-width:1280px}
#wikiTop{display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap;margin:6px 0}
#wikiTop [data-half]{background:#151b2a;color:#fff;border:1px solid #ffffff33}#wikiTop [data-half].on{background:var(--accent,#ffd166);color:#111}
#wikiSearch{padding:7px 12px;border-radius:8px;border:1px solid #ffffff33;background:#0b0f18;color:#fff;min-width:240px;font-size:15px}
#galTabs{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin:6px 0}
#galTabs .btn{padding:5px 12px;font-size:14px}#galTabs .btn.on{outline:2px solid var(--accent,#ffd166)}
#galCount{opacity:.65;font-size:13px;text-align:center}
#galGrid{margin:10px 0 30px;max-height:calc(100vh - 260px);overflow-y:auto;padding:4px}
#galGrid h4{margin:14px 4px 6px;font-size:17px;border-bottom:1px solid #ffffff22;padding-bottom:4px}
#galGrid .wk{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px}
.gal-t{text-align:left;display:flex;gap:9px;background:#151b2a;border:2px solid #ffffff22;border-radius:10px;padding:7px;cursor:pointer;transition:transform .12s;min-height:86px}
.gal-t:hover{transform:translateY(-2px);border-color:#ffffff66}
.gal-t .im{width:76px;height:76px;flex:none;border-radius:7px;background:#0b0f18 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:34px}
.gal-t.sq .im{background-size:contain}
.gal-t .tx{min-width:0;flex:1}
.gal-t .nm{font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gal-t .sb{font-size:11.5px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gal-t .ln{font-size:12px;line-height:1.3;margin-top:2px}.gal-t .ln .g{color:#7fe08a}.gal-t .ln .b{color:#ff8a7a}
.gal-t .ds{font-size:11.5px;opacity:.8;line-height:1.3;margin-top:2px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
#galView{position:fixed;inset:0;background:#05070cf0;z-index:60;display:flex;align-items:center;justify-content:center;gap:16px}
#galView.hidden{display:none}
#galView .box{max-width:min(900px,80vw);max-height:92vh;overflow-y:auto;text-align:center}
#galView .big.fac{width:200px;height:200px;aspect-ratio:auto;margin:0 auto;border:0}
#galView .big.sq{width:260px;height:260px;aspect-ratio:auto;margin:0 auto}
#galView .big{width:min(620px,70vw);aspect-ratio:7/5;margin:0 auto;background:#0b0f18 center/contain no-repeat;border-radius:12px;border:2px solid #ffffff33;display:flex;align-items:center;justify-content:center;font-size:110px}
#galView h3{margin:12px 0 4px;font-size:22px}#galView .sub{opacity:.7;font-size:13px}#galView p{max-width:660px;margin:8px auto;line-height:1.45}
#galView .info{text-align:left;max-width:660px;margin:6px auto;line-height:1.45}#galView .info h5{margin:10px 0 2px;color:#ffd166;font-size:14px;text-transform:uppercase;letter-spacing:.04em}
#galView .info ul{margin:0;padding-left:20px}#galView .info .g{color:#7fe08a}#galView .info .b{color:#ff8a7a}#galView .info .t{color:#9fe0ff}
#galView .troops{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px}
#galView .troops div{width:84px;font-size:11px}#galView .troops img{width:84px;height:84px;border-radius:8px;background:#151b2a}
#galView .nav{font-size:40px;background:none;border:0;color:#fff;cursor:pointer;opacity:.7;padding:10px}#galView .nav:hover{opacity:1}
#galView .x{position:absolute;top:16px;right:22px;font-size:28px}
`;

let state = null;
const ul = (L, cls = '') => L.length ? `<ul>${L.map(l => `<li class="${cls}">${esc(l)}</li>`).join('')}</ul>` : '';
const sec = (t, html) => html ? `<h5>${esc(t)}</h5>${html}` : '';

// ---------------------------------------------------------------- Cards (the main tab)
function cardItems(cards) {
  const byId = new Map(cards.map(c => [c.id, c]));
  const order = ['common', 'uncommon', 'rare', 'legendary', 'mod', 'shieldmod', 'combo', 'holy', 'cursed'];
  return cards.filter(c => order.includes(c.rarity)).sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.name.localeCompare(b.name)).map(c => {
    let lines = []; try { lines = cardLines(c).map(([v, label, good]) => [`${v} ${label}`, good]); } catch { /* cards without stat lines */ }
    const recipe = c.combo ? c.combo.map(id => (byId.get(id) || { name: id }).name).join(' + ') : '';
    const info = sec('Effects', lines.length ? `<ul>${lines.map(([t, g]) => `<li class="${g ? 'g' : 'b'}">${esc(t)}</li>`).join('')}</ul>` : '')
      + sec('How it works', c.details ? `<p style="margin:0">${esc(c.details)}</p>` : '')
      + sec('Combo recipe', recipe ? `<p style="margin:0">Own <b>${esc(recipe)}</b> and they merge into this card.</p>` : '')
      + sec('Card type', TYPE_NOTES[c.rarity] ? `<p style="margin:0">${esc(TYPE_NOTES[c.rarity])}</p>` : '');
    return { group: RARITY_NAMES[c.rarity], filter: c.rarity, name: c.name, sub: RARITY_NAMES[c.rarity].replace(/s$/, '').replace(' version', ''), color: RARITY_COLORS[c.rarity], img: c.imageUrl, icon: c.icon,
      desc: c.description, lines, info, search: [c.name, c.description, c.details, recipe, ...lines.map(l => l[0])].join(' ') };
  });
}

// ---------------------------------------------------------------- AMON
function unitInfo(u, factions) {
  const st = [['Health', u.hp], ['Damage', u.atk || 0], ['Attacks/s', u.rate || 0], ['Range', u.range], ['Speed', u.speed], ['Armor', u.armor || 0]].concat(u.splash ? [['Splash', u.splash]] : []);
  const tags = unitTags(u);
  return `<p style="margin:0 0 4px">${st.map(([k, v]) => `<span style="margin-right:12px"><span style="opacity:.6">${k}</span> <b>${Math.round(v * 10) / 10}</b></span>`).join('')}</p>`
    + sec('Abilities', ul(abilityLines(u)))
    + sec('Type', ul(tags.map(t => TAG_INFO[t.toLowerCase()]).filter(Boolean).concat([u.air ? 'Flying.' : 'Ground unit.', u.hitsAir ? 'Hits ground and air.' : u.hitsGround === false ? 'Hits air only.' : 'Hits ground only.'])))
    + (factions && factions.length ? sec('Fielded by', `<p style="margin:0">${esc(factions.join(', '))}</p>`) : '')
    + sec('Tips', ul(unitTips(u), 't'));
}
function amonTabs(cards) {
  const amon = buildAmonCards(cards);
  const facOf = id => FACTIONS.filter(f => [...f.core, ...f.aux].some(x => x === id || x === 'x-' + id)).map(f => f.title);
  const units = UNITS.map(u => { const c = amon.byId.get('u-' + u.id); const tags = unitTags(u);
    return { group: `Tier ${TIER_NAMES[u.tier]}`, name: u.name, sub: `${unitRole(u)}${tags.length ? ' · ' + tags.join(', ') : ''} · ×${u.count}`, color: TIER_COLORS[u.tier], unit: u.id, desc: u.desc,
      info: unitInfo(u) + (c && c.fx && c.pattern ? sec(`Aura: reaches ${reachText(c.pattern)}`, ul(fxLines(c.fx).map(l => l.text))) : ''), search: [u.name, u.desc, unitRole(u), ...tags, ...abilityLines(u)].join(' ') }; });
  const enemies = [...BOSSES, ...ENEMIES].map(u => { const boss = BOSSES.includes(u), fs = facOf(u.id), tags = unitTags(u);
    return { group: boss ? 'Bosses' : `Tier ${TIER_NAMES[u.tier]}`, name: u.name, sub: boss ? 'Boss' : `${unitRole(u)}${tags.length ? ' · ' + tags.join(', ') : ''}`, color: u.look.color, unit: u.id, desc: u.desc || (boss ? 'A wave leader. Bosses come every few rounds; Amon himself waits at the end.' : ''),
      info: unitInfo(u, fs), search: [u.name, u.desc, unitRole(u), ...tags, ...fs, ...abilityLines(u)].join(' ') }; });
  const tactics = amon.list.filter(c => c.kind === 'tactic' && !c.noShop).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)).map(c => {
    const src = c.imageUrl || (c.from && (cards.find(x => x.id === c.from) || {}).imageUrl), D = cardDetails(c, { fromName: c.from && (cards.find(x => x.id === c.from) || {}).name });
    const lines = fxLines(c.fx || {}).map(l => [l.text, l.good]);
    return { group: `Tier ${TIER_NAMES[c.tier]}`, name: c.name, sub: `${PATTERNS[c.pattern] ? PATTERNS[c.pattern].icon + ' ' + PATTERNS[c.pattern].name : ''}`, color: TIER_COLORS[c.tier], img: src || null, pattern: src ? null : c.pattern, desc: c.desc, lines,
      info: D.sections.map(([t, L]) => sec(t, ul(L))).join('') + sec('Tips', ul(D.tips, 't')) + sec('Holy and Cursed', '<p style="margin:0">Tactic cards can show up Holy (no downsides, +30% upsides) or Cursed (+70% upsides, downsides 50% worse) in the store.</p>'),
      search: [c.name, c.desc, ...lines.map(l => l[0])].join(' ') };
  });
  const factions = FACTIONS.map(f => {
    const tr = FACTION_TRAITS[f.id], us = [...factionUnits(f), ...factionUnits(f, 'aux')];
    const about = f.id === 'chaos' ? 'Anything goes: the Chaos Horde throws in any enemy or corrupted unit, as long as the wave fits its point budget. It rolls a random faction trait every wave.'
      : f.id === 'counter' ? 'The Arbiter studies your boards and brings what beats them: splash against massed cheap units, piercing and poison against a few elites, anti-air against fliers, kiting slowers against melee, divers against a ranged back line, armor-piercing against heavy armor.'
      : `${f.leader} leads the ${f.title}.`;
    return { group: 'Factions', name: f.leader, sub: f.title, color: f.color, icon: f.icon, img: f.emblem, faction: f, desc: about + (tr ? ' Trait: ' + tr.text : ''),
      info: (tr ? sec('Trait', `<p style="margin:0">${esc(tr.text)}</p>`) : '') + (us.length ? sec('Troops', `<div class="troops">${us.map(u => `<div><img alt="" data-unit="${esc(u.id)}"><br>${esc(u.name)}</div>`).join('')}</div>`) : ''),
      search: [f.leader, f.title, about, tr && tr.text, ...us.map(u => u.name)].join(' ') };
  });
  const how = [
    ['The store and the board', 'Buy cards in the store, place unit cards on the 5×5 board and tactic cards next to them. A tactic card boosts the cards in its reach (the highlighted squares). Drop a card on a copy of itself to combine them into a higher level. Right-click any card for its full details and tips.'],
    ['Start positions', 'In the store your army stands on the field. Drag a group (or drag a box, or Shift-click several) to set where it starts the battle. Double-click a group to send it back to its square\'s spot. Moving the card to another square resets it.'],
    ['Formation', 'At the start your army fans out and marches as one line at the pace of its slowest walker. A unit only breaks off once it can actually fight (an enemy in its own reach); the rest keep marching. Healers stay until half the group has broken off. Survivors that move to another field form up again when they arrive.'],
    ['Taking control', 'In battle, click one of your units and press Space to drive it: WASD moves, the mouse aims, left button attacks, right button blocks (shield units), Shift dashes. A unit under your command does 20% more damage, attacks faster, takes 15% less damage and lands a heavy blow every 4th hit.'],
    ['Poison and ignite', 'Ignite from cards adds a burn stack with every hit (up to 6). Poison eats a share of the target\'s health and ramps up the longer it stays on; new hits refresh it without resetting the ramp. Large units and bosses take a third of the poison.'],
    ['Factions and traits', 'Every wave comes from one faction, shown in the store with its troops. Each faction has a trait of its own (armor, frost, poison, ambush...). The Arbiter is different: it reads your army and brings counters.'],
    ['Fields and maps', 'Every player fights on a field of their own. Maps come in 9 looks (grass, desert, snow, ash, crystal, swamp, autumn, ruins, moon) and 6 layouts (scattered rocks, a pillar line, a stone ring, tree groves, three lanes, crossroads). Survivors of a won field go help a teammate.'],
    ['AMON Versus', 'A lobby option: every round you fight another player\'s army instead of the raiders. Lobby teams fight side by side, and survivors only move to a field where an ally is fighting. With an odd number of players, one player (at random) fights a copy of a random enemy\'s board. The store shows your next opponent and the last army value you saw from them. Lose a battle and you lose health; the last player (or team) standing wins.'],
  ].map(([name, text]) => ({ group: 'How AMON works', name, sub: '', color: '#ffd166', icon: '📘', desc: text, info: '', search: name + ' ' + text }));
  return [
    { id: 'units', name: 'Your units', sq: true, items: units },
    { id: 'enemies', name: 'Enemies & bosses', sq: true, items: enemies },
    { id: 'tactics', name: 'Tactic cards', items: tactics },
    { id: 'factions', name: 'Factions', sq: true, items: factions },
    { id: 'how', name: 'How it works', items: how },
  ];
}

function buildTabs(cards) {
  const items = cardItems(cards);
  const pick = f => items.filter(it => f.includes(it.filter));
  return {
    cards: [
      { id: 'all', name: 'All cards', items: items.filter(it => it.filter !== 'holy' && it.filter !== 'cursed') },
      { id: 'basic', name: 'Common → Legendary', items: pick(['common', 'uncommon', 'rare', 'legendary']) },
      { id: 'mods', name: 'Mods', items: pick(['mod', 'shieldmod']) },
      { id: 'combos', name: 'Combos', items: pick(['combo']) },
      { id: 'variants', name: 'Holy & Cursed', items: pick(['holy', 'cursed']) },
    ],
    amon: amonTabs(cards),
  };
}

function imgOf(it, size) {
  if (it.img) return it.img;
  if (it.unit) return unitThumb(it.unit, size);
  if (it.pattern) return patternThumb(it.pattern, it.color);
  return null;
}
const curTabs = () => state.tabs[state.half];
const curTab = () => curTabs().find(t => t.id === state.tab[state.half]) || curTabs()[0];
function visible() {
  const q = state.q.trim().toLowerCase(), tab = curTab();
  return q ? tab.items.filter(it => it.search.toLowerCase().includes(q)) : tab.items;
}

function renderGrid() {
  document.querySelectorAll('#wikiTop [data-half]').forEach(b => b.classList.toggle('on', b.dataset.half === state.half));
  document.getElementById('wikiTools').classList.toggle('hidden', state.half !== 'cards');
  document.getElementById('galTabs').innerHTML = curTabs().map(t => `<button class="btn ghost ${t.id === curTab().id ? 'on' : ''}" data-gtab="${t.id}">${esc(t.name)}</button>`).join('');
  const tab = curTab(), list = visible(), grid = document.getElementById('galGrid');
  state.list = list;
  document.getElementById('galCount').textContent = `${list.length} ${list.length === 1 ? 'entry' : 'entries'}${state.q ? ` matching "${state.q}"` : ''} · click one for its full page`;
  let html = '', group = null, i = 0;
  for (const it of list) {
    if (it.group !== group) { if (group !== null) html += '</div>'; group = it.group; html += `<h4>${esc(group)}</h4><div class="wk">`; }
    const lines = (it.lines || []).slice(0, 4).map(([t, g]) => `<span class="${g ? 'g' : 'b'}">${esc(t)}</span>`).join(' · ');
    html += `<div class="gal-t ${tab.sq ? 'sq' : ''}" data-gi="${i++}" style="border-color:${it.color || '#ffffff22'}"><div class="im">${it.img || it.unit || it.pattern ? '' : esc(it.icon || '')}</div><div class="tx"><div class="nm" style="color:${it.color || '#fff'}">${esc(it.name)}</div><div class="sb">${esc(it.sub || '')}</div>${lines ? `<div class="ln">${lines}</div>` : ''}${it.desc ? `<div class="ds">${esc(it.desc)}</div>` : ''}</div></div>`;
  }
  if (group !== null) html += '</div>';
  grid.innerHTML = html || '<p style="text-align:center;opacity:.6">Nothing matches that search.</p>';
  // unit pictures are rendered from the 3D models a few at a time so the screen opens at once
  const tiles = [...grid.querySelectorAll('[data-gi]')], gen = ++state.gen;
  const step = k => {
    if (gen !== state.gen) return;
    for (let n = 0; n < 6 && k < tiles.length; k++) {
      const it = list[k], url = imgOf(it, 256);
      if (it.unit) n++;   // only 3D renders take time
      if (url) tiles[k].querySelector('.im').style.backgroundImage = `url('${url}')`;
    }
    if (k < tiles.length) setTimeout(() => step(k), 0);
  };
  step(0);
}

function openView(i) {
  const list = state.list, n = list.length; if (!n) return;
  state.view = (i + n) % n;
  const it = list[state.view], v = document.getElementById('galView'), url = imgOf(it, 512), sq = curTab().sq;
  v.querySelector('.box').innerHTML = (url || it.icon ? `<div class="big ${it.faction ? 'fac' : sq ? 'sq' : ''}" style="border-color:${it.color || '#ffffff33'};${url ? `background-image:url('${url}')` : ''}">${url ? '' : esc(it.icon || '')}</div>` : '')
    + `<h3 style="color:${it.color || '#fff'}">${esc(it.name)}</h3><div class="sub">${esc(it.sub || '')} · ${state.view + 1} / ${n}</div>${it.desc ? `<p>${esc(it.desc)}</p>` : ''}<div class="info">${it.info || ''}</div>`;
  for (const im of v.querySelectorAll('img[data-unit]')) im.src = unitThumb(im.dataset.unit, 128);
  v.classList.remove('hidden');
}
function closeView() { document.getElementById('galView').classList.add('hidden'); state && (state.view = -1); }

export function openGallery(cards, show) {
  if (!document.getElementById('galleryCss')) { const s = document.createElement('style'); s.id = 'galleryCss'; s.textContent = CSS; document.head.appendChild(s); }
  const first = !state;
  state = { tabs: buildTabs(cards), half: state ? state.half : 'cards', tab: state ? state.tab : { cards: 'all', amon: 'units' }, q: '', view: -1, gen: 0, list: [] };
  const search = document.getElementById('wikiSearch'); search.value = '';
  if (first) {
    document.getElementById('wikiTop').addEventListener('click', e => { const b = e.target.closest('[data-half]'); if (b) { state.half = b.dataset.half; renderGrid(); } });
    search.addEventListener('input', () => { state.q = search.value; renderGrid(); });
    document.getElementById('galTabs').addEventListener('click', e => { const b = e.target.closest('[data-gtab]'); if (b) { state.tab[state.half] = b.dataset.gtab; renderGrid(); } });
    document.getElementById('galGrid').addEventListener('click', e => { const t = e.target.closest('[data-gi]'); if (t) openView(+t.dataset.gi); });
    const v = document.getElementById('galView');
    v.addEventListener('click', e => {
      if (e.target.closest('[data-gnav]')) openView(state.view + +e.target.closest('[data-gnav]').dataset.gnav);
      else if (e.target === v || e.target.closest('.x')) closeView();
    });
    addEventListener('keydown', e => {
      if (!state || state.view < 0 || document.getElementById('galView').classList.contains('hidden')) return;
      if (e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); closeView(); }
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); openView(state.view + (e.code === 'ArrowLeft' ? -1 : 1)); }
    }, true);
  }
  closeView();
  show('gallery');
  renderGrid();
}
