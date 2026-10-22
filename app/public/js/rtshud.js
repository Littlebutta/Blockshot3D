// =====================================================================
// RTS mode (v1.2.27): the HUD. Top bar (resources, supply, timer, unit budget, research, menu), minimap,
// selection panel, StarCraft-style 3x5 command card with hotkeys, control groups, card research panel,
// alerts, tooltips, the drawn cursor used while the mouse is locked (fullscreen), and the end screen.
// Every button works with the real cursor and with the locked (drawn) one: clicks go through press().
// =====================================================================
import { RTS, UNITS, BUILDINGS, UNIT_IDS, BUILD_MENU, ABILITIES, GRID_KEYS, TRAIN_KEYS, BUILD_KEYS, researchCards, upLines, sumUps, pullCost, FACTION, cardCap } from './rtsdata.js';
import { CELL } from './rtsmap.js';
import { thumbOf } from './rtsart.js';
import { RARITY } from './config.js';
import { openInfo } from './infopop.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const keyL = code => code ? code.replace(/^Key/, '').replace(/^Digit/, '') : '';
const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const rarC = r => (RARITY[r] && RARITY[r].color) || (r === 'combo' ? '#ffd166' : '#9aa5bd');
const MM = 220;   // minimap size (css px)
const ERR_KINDS = new Set(['noC', 'noF', 'supply', 'tech', 'qfull', 'place', 'cd', 'nob', 'hand', 'held', 'full']);
const HIT_KINDS = new Set(['baseHit', 'armyHit', 'derLost']);

const CSS = `
#rts{position:fixed;inset:0;pointer-events:none;z-index:20;font-family:'Chakra Petch',sans-serif;color:#eef;user-select:none}
#rts .p{pointer-events:auto}
#rts .pan{background:linear-gradient(#141c2cf0,#0b101af0);border:1px solid #ffffff26;border-radius:10px;box-shadow:0 6px 20px #0008}
#rtsTop{position:absolute;top:8px;right:8px;display:flex;gap:6px;align-items:center;padding:5px 10px;white-space:nowrap;font-size:16px}
#rtsTop .r{display:flex;gap:5px;align-items:center;padding:2px 8px;border-radius:7px;background:#ffffff0c;cursor:default}
#rtsTop .r b{font-size:19px;min-width:34px;text-align:right}
#rtsTop .r.c b{color:#8fdcff}#rtsTop .r.f b{color:#7fff9a}#rtsTop .r.s b{color:#ffe9a8}#rtsTop .r.s.full b{color:#ff6b6b}
#rtsTop .r small{opacity:.6;font-size:12.5px}
#rtsTop .r.bud{font-size:13px}#rtsTop .r.bud i{display:inline-block;width:60px;height:7px;border-radius:4px;background:#ffffff1c;overflow:hidden;vertical-align:middle}#rtsTop .r.bud i u{display:block;height:100%;background:#5fe3a1}
#rtsTop .r.bud.hot i u{background:#ffb347}#rtsTop .r.bud.held{color:#ff9a6b}
.rb{background:#1e2840;border:1px solid #ffffff30;color:#eef;border-radius:7px;padding:4px 10px;font:600 14.5px 'Chakra Petch',sans-serif;cursor:pointer;position:relative}
.rb:hover{background:#2a3a5c}.rb.warn{background:#7a2f2f}.rb.go{background:#2f7a3a}
.rb .bdg{position:absolute;top:-7px;right:-7px;background:#ffcf3a;color:#1b1500;border-radius:9px;padding:0 5px;font-size:12px;font-weight:700}
.rb.pulse{animation:rtsPulse 1s infinite}@keyframes rtsPulse{50%{box-shadow:0 0 12px #ffcf3a}}
#rtsMenu{position:absolute;top:52px;right:8px;display:flex;flex-direction:column;gap:5px;padding:8px}
#rtsPl{position:absolute;top:8px;left:8px;padding:6px 10px;font-size:14px;line-height:1.5;max-width:260px}
#rtsPl div{display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden}#rtsPl i{width:10px;height:10px;border-radius:2px;flex:none}
#rtsPl .out{opacity:.45;text-decoration:line-through}#rtsPl .me{font-weight:700}#rtsPl small{opacity:.6}
#rtsPl .fac{font-size:12px;opacity:.65;margin-top:2px}
#rtsNotes{position:absolute;top:58px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px}
#rtsNotes div{background:#0b101ad8;border:1px solid #ffffff22;border-radius:7px;padding:4px 12px;font-size:15px;transition:opacity .5s}
#rtsNotes .bad{color:#ff8a7a;border-color:#ff6b6b66}#rtsNotes .good{color:#9affb8;border-color:#5fe3a166}
#rtsErr{position:absolute;left:50%;bottom:232px;transform:translateX(-50%);color:#ffe45a;font-size:17px;font-weight:600;text-shadow:0 1px 3px #000,0 0 6px #000;transition:opacity .4s;white-space:nowrap}
#rtsBottom{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:flex-end;gap:6px;padding:6px}
#rtsMapBox{padding:6px;position:relative}
#rtsMap{position:relative !important;inset:auto !important;display:block;width:${MM}px;height:${MM}px;border-radius:5px;cursor:pointer;image-rendering:auto;background:#000}
#rtsMapBtns{display:flex;gap:4px;margin-bottom:5px}
#rtsMapBtns .rb{padding:2px 8px;font-size:13px}#rtsMapBtns .rb.idle{color:#ffe45a}
#rtsMid{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;align-items:stretch}
#rtsGroups{display:flex;gap:3px;min-height:24px;padding-left:2px}
#rtsGroups .g{font-size:12.5px;background:#141c2ce8;border:1px solid #ffffff26;border-radius:5px;padding:1px 6px;cursor:pointer;display:flex;gap:4px;align-items:center}
#rtsGroups .g b{color:#ffcf3a}#rtsGroups .g img{width:18px;height:18px}#rtsGroups .g.on{border-color:#ffcf3a}
#rtsSel{height:178px;padding:8px 10px;display:flex;gap:12px;overflow:hidden;box-sizing:border-box}
#rtsSel .por{width:118px;min-width:118px;height:118px;border-radius:8px;background:#0a0e16 center/cover;border:2px solid #ffffff30;position:relative}
#rtsSel .por .hpn{position:absolute;bottom:-22px;left:0;right:0;text-align:center;font-size:13.5px}
#rtsSel .inf{flex:1;min-width:0;font-size:14px;line-height:1.35;overflow:hidden}
#rtsSel .nm{font-size:19px;font-weight:700}#rtsSel .nm small{font-size:13px;opacity:.65;font-weight:400;margin-left:6px}
#rtsSel .st{display:flex;flex-wrap:wrap;gap:3px 12px;margin:3px 0;opacity:.92}
#rtsSel .st span b{color:#ffe9a8;font-weight:600}
#rtsSel .ups{display:flex;flex-wrap:wrap;gap:3px 10px;font-size:13px;color:#9affb8}#rtsSel .ups .bad{color:#ff9a8a}
#rtsSel .tag{display:inline-block;font-size:12px;padding:0 6px;border-radius:5px;background:#ffffff18;margin-right:4px}
#rtsSel .multi{display:grid;grid-template-columns:repeat(12,44px);gap:4px;align-content:start}
#rtsSel .mp{width:44px;height:44px;border-radius:5px;background:#0a0e16 center/cover;border:1px solid #ffffff30;position:relative;cursor:pointer}
#rtsSel .mp:hover{border-color:#fff}#rtsSel .mp i{position:absolute;left:2px;right:2px;bottom:2px;height:4px;background:#000a;border-radius:2px;overflow:hidden}#rtsSel .mp i u{display:block;height:100%}
#rtsSel .more{font-size:13px;opacity:.7;align-self:end}
#rtsSel .q{display:flex;gap:5px;margin-top:6px;align-items:center}
#rtsSel .qs{width:46px;height:46px;border-radius:6px;background:#0a0e16 center/cover;border:1px solid #ffffff30;position:relative;cursor:pointer;font-size:24px;display:flex;align-items:center;justify-content:center}
#rtsSel .qs.e{border-style:dashed;cursor:default;opacity:.5}#rtsSel .qs:not(.e):hover{border-color:#ff6b6b}
#rtsSel .qbar{flex:1;max-width:220px;height:9px;border-radius:5px;background:#ffffff18;overflow:hidden}#rtsSel .qbar u{display:block;height:100%;background:#5ab8ff}
#rtsCmd{padding:6px;display:grid;grid-template-columns:repeat(5,56px);grid-template-rows:repeat(3,56px);gap:5px}
#rtsCmd .cb{position:relative;border-radius:7px;background:#1e2840;border:1px solid #ffffff30;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:27px;overflow:hidden}
#rtsCmd .cb.img{background:#1e2840 center/120% no-repeat}
#rtsCmd .cb:hover{background-color:#2a3a5c;border-color:#ffffffa0}#rtsCmd .cb.on{border-color:#5fe3a1;box-shadow:inset 0 0 0 1px #5fe3a1}
#rtsCmd .cb.dis{filter:grayscale(1);opacity:.45}#rtsCmd .cb.poor .k{color:#ff6b6b}
#rtsCmd .cb .k{position:absolute;top:1px;left:4px;font-size:12.5px;font-weight:700;color:#ffcf3a;text-shadow:0 1px 2px #000}
#rtsCmd .cb .cd{position:absolute;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:700}
#rtsCmd .cb .n{position:absolute;bottom:1px;right:4px;font-size:12px;font-weight:700;text-shadow:0 1px 2px #000}
#rtsCmd .em{border-radius:7px;background:#ffffff07;border:1px solid #ffffff0d}
#rtsTip{position:absolute;max-width:340px;padding:8px 11px;font-size:14px;line-height:1.35;z-index:3}
#rtsTip .t{font-weight:700;font-size:16px}#rtsTip .k{color:#ffcf3a}#rtsTip .c{margin:2px 0;display:flex;gap:10px}#rtsTip .c .no{color:#ff6b6b}
#rtsTip .need{color:#ff9a8a}#rtsTip .d{opacity:.85}
#rtsCards{position:absolute;top:60px;left:50%;transform:translateX(-50%);width:min(940px,96vw);max-height:calc(100vh - 300px);overflow-y:auto;padding:12px 16px}
#rtsCards h3{margin:4px 0 8px;font-size:18px;display:flex;justify-content:space-between;align-items:center}
#rtsCards h4{margin:12px 0 6px;font-size:15px;opacity:.8}
#rtsCards .row{display:flex;gap:8px;flex-wrap:wrap}
.rc{width:170px;min-height:200px;border-radius:9px;border:2px solid #888;background:#151b2a;position:relative;overflow:hidden;cursor:pointer;padding:6px 8px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end}
.rc .art{position:absolute;inset:0;background-size:cover;background-position:center 25%;opacity:.8}.rc .art::after{content:'';position:absolute;inset:0;background:linear-gradient(transparent 20%,#000e 70%)}
.rc .ic{position:absolute;top:4px;left:6px;font-size:22px}.rc .rr{position:absolute;top:6px;right:7px;font-size:11.5px;font-weight:700;text-transform:uppercase}
.rc .nm{position:relative;font-weight:700;font-size:15.5px;text-shadow:0 1px 2px #000}.rc ul{position:relative;margin:3px 0 0;padding:0;list-style:none;font-size:12.8px;line-height:1.3}
.rc li{color:#9affb8}.rc li.bad{color:#ff9a8a}.rc:hover{filter:brightness(1.15)}.rc.sel{outline:3px solid #fff;box-shadow:0 0 16px #fff8}
.rc.small{width:132px;min-height:150px}.rc.small .nm{font-size:13.5px}.rc.small ul{font-size:11.8px}
#rtsCards .fit{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;align-items:center}
#rtsCards .fit .rb{display:flex;gap:5px;align-items:center}#rtsCards .fit .rb img{width:26px;height:26px}#rtsCards .fit .rb.hl{border-color:#5fe3a1}
#rtsCards .fit .rb small{opacity:.6}
#rtsCards .upr{display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-top:1px solid #ffffff12;font-size:13.5px}#rtsCards .upr img{width:34px;height:34px}
#rtsCards .upr .cs{display:flex;flex-wrap:wrap;gap:3px}#rtsCards .upr .cs span{padding:0 6px;border-radius:5px;border:1px solid;font-size:12.5px}
#rtsCards .upr .ls{color:#9affb8;font-size:12.5px}
#rtsCards .none{opacity:.6;font-size:14px}
#rtsCursor{position:fixed;left:0;top:0;width:26px;height:26px;pointer-events:none;z-index:9999;display:none}
#rtsCursor.tgt svg.a{display:none}#rtsCursor:not(.tgt) svg.x{display:none}#rtsCursor.enemy svg{filter:drop-shadow(0 0 3px #ff3a2a)}
#rtsBox{position:absolute;border:1.5px solid #5aff7a;background:#5aff7a18;display:none}
#rtsHint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:18px;padding:8px 16px;display:none;pointer-events:none}
#rtsOver{position:absolute;inset:0;background:#000a;display:flex;align-items:center;justify-content:center}
#rtsOver .pan{padding:18px 26px;min-width:560px;max-width:92vw}
#rtsOver h2{margin:0 0 4px;font-size:34px;text-align:center}#rtsOver .sub{text-align:center;opacity:.8;margin-bottom:12px}
#rtsOver table{border-collapse:collapse;width:100%;font-size:14.5px}#rtsOver td,#rtsOver th{padding:4px 8px;text-align:right}#rtsOver td:first-child,#rtsOver th:first-child{text-align:left}
#rtsOver th{opacity:.65;font-weight:600;font-size:13px}#rtsOver tr.w td:first-child::after{content:' 🏆'}
#rtsOver .btns{display:flex;gap:8px;justify-content:center;margin-top:14px}
`;

const HTML = `
<div id="rtsPl" class="pan"></div>
<div id="rtsTop" class="pan p">
  <span class="r c" data-tip="t_c">💎 <b id="rtsC">0</b></span>
  <span class="r f" data-tip="t_f">🟢 <b id="rtsF">0</b></span>
  <span class="r s" id="rtsSup" data-tip="t_s">👥 <b id="rtsS">0/0</b></span>
  <span class="r" data-tip="t_i"><small>income</small> <span id="rtsInc">0</span></span>
  <span class="r bud" id="rtsBud" data-tip="t_b" data-a="bud">units <span id="rtsBudN">0</span> <i><u id="rtsBudBar"></u></i></span>
  <span class="r"><span id="rtsTime">0:00</span></span>
  <button class="rb" id="rtsResBtn" data-a="cards" data-tip="t_r">📚 Research <span class="bdg" id="rtsResN" style="display:none"></span></button>
  <button class="rb" data-a="menu" data-tip="t_m">☰</button>
</div>
<div id="rtsMenu" class="pan p" style="display:none">
  <button class="rb" data-a="pause">⏸ Game menu (Esc)</button>
  <button class="rb warn" data-a="surr" id="rtsSurr">🏳 Surrender</button>
</div>
<div id="rtsNotes"></div>
<div id="rtsErr"></div>
<div id="rtsBottom">
  <div id="rtsMapBox" class="pan p"><div id="rtsMapBtns"><button class="rb idle" data-a="idle" id="rtsIdle" data-tip="t_idle">🔧 0</button><button class="rb" data-a="army" data-tip="t_army">⚔ Army</button><button class="rb" data-a="alertgo" data-tip="t_alert">⚠</button></div><canvas id="rtsMap"></canvas></div>
  <div id="rtsMid"><div id="rtsGroups" class="p"></div><div id="rtsSel" class="pan p"></div></div>
  <div id="rtsCmd" class="pan p"></div>
</div>
<div id="rtsCards" class="pan p" style="display:none"></div>
<div id="rtsTip" class="pan" style="display:none"></div>
<div id="rtsBox"></div>
<div id="rtsHint" class="pan">Click to lock the mouse inside the window</div>
<div id="rtsOver" class="p" style="display:none"></div>
<div id="rtsCursor"><svg class="a" width="26" height="26" viewBox="0 0 26 26"><path d="M2 2 L2 21 L7 16 L11 24 L14.5 22.5 L10.5 14.5 L17.5 14.5 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg><svg class="x" width="26" height="26" viewBox="0 0 26 26" style="margin:-13px 0 0 -13px"><circle cx="13" cy="13" r="8" fill="none" stroke="#fff" stroke-width="2"/><path d="M13 1v7M13 18v7M1 13h7M18 13h7" stroke="#fff" stroke-width="2"/><circle cx="13" cy="13" r="8" fill="none" stroke="#000" stroke-width="0.8" opacity=".6"/></svg></div>
`;

const STAT_TIPS = {
  t_c: ['Crystal', 'Mined by Riggers from crystal fields (each field runs dry). Derricks and Reclaimers make it slowly forever.'],
  t_f: ['Flux', 'Gas-like resource from flux vents: build a Refinery on a vent, then send up to 3 Riggers to it.'],
  t_s: ['Supply', 'Units in use / units you can support. Supply Depots and Command Hubs raise it.'],
  t_i: ['Income', 'Crystal and flux gathered per minute, plus the endless trickle from derricks and Reclaimers.'],
  t_b: ['Unit budget', 'All units on the map / the most the game allows right now. The cap adapts to how smoothly the game runs; near it, the players with the most units are held from training first. Right-click for more.'],
  t_r: ['Research (F3)', 'Cards you pulled at an Archive. Fit each one to a unit type: every unit of that type gets it, now and later.'],
  t_m: ['Menu', 'Game menu and surrender.'],
  t_idle: ['Idle Riggers (F1)', 'Selects your next worker with nothing to do.'],
  t_army: ['Army (F2)', 'Selects all your fighting units.'],
  t_alert: ['Last alert (Space)', 'Jumps to where the last attack happened.'],
};

export class HUD {
  constructor(c) {
    this.c = c; this.dirty = true; this.buildMenu = false; this.cardsOpen = false; this.overShown = false; this.overOpen = false;
    this.acts = new Map(); this.cmds = []; this.notes = []; this.pings = []; this.t = 0; this.selT = 0; this.mmT = 0; this.cardSel = null; this.cardKey = '';
    if (!document.getElementById('rtsCss')) { const s = document.createElement('style'); s.id = 'rtsCss'; s.textContent = CSS; document.head.appendChild(s); }
    this.el = document.createElement('div'); this.el.id = 'rts'; this.el.innerHTML = HTML; document.body.appendChild(this.el);
    const $ = id => this.el.querySelector('#' + id);
    this.$ = $;
    this.cards = researchCards(c.cards || []); this.cardById = new Map(this.cards.map(x => [x.id, x]));
    // clicks with the real cursor (the locked cursor comes through lockedDown / lockedUp)
    this.onDown = e => { const t = e.target; if (!this.el.contains(t)) return; if (t.id === 'rtsMap') { this.mapDown(e.clientX, e.clientY, e.button, e); e.preventDefault(); return; } if (this.press(t, e.button, e)) e.preventDefault(); };
    this.onUp = () => { this.mmDrag = false; };
    this.el.addEventListener('mousedown', this.onDown);
    addEventListener('mouseup', this.onUp, true);
  }
  dispose() {
    this.el.removeEventListener('mousedown', this.onDown); removeEventListener('mouseup', this.onUp, true);
    this.el.remove();
  }
  // ---------------------------------------------------------------- input from the locked cursor
  lockedDown(el, e) { this.downIn = true; if (el.id === 'rtsMap') { this.mapDown(this.c.mx, this.c.my2, e.button, e); return; } this.press(el, e.button, e); }
  lockedUp(el, e) { const was = this.downIn; this.downIn = false; this.mmDrag = false; return !!was; }
  press(el, button, e) {
    const b = el && el.closest && el.closest('[data-a]'); if (!b || !this.el.contains(b)) return false;
    const fn = this.acts.get(b.dataset.a) || this.fixedAct(b.dataset.a);
    if (!fn) return false;
    fn(button, e || {});
    return true;
  }
  fixedAct(a) {
    const c = this.c;
    switch (a) {
      case 'bud': return btn => { if (btn === 2) openInfo('rts_budget', c.mx, c.my2); };
      case 'cards': return () => this.openCards(!this.cardsOpen);
      case 'menu': return () => { const m = this.$('rtsMenu'); m.style.display = m.style.display === 'none' ? '' : 'none'; this.surrArm = false; this.$('rtsSurr').textContent = '🏳 Surrender'; };
      case 'pause': return () => { this.$('rtsMenu').style.display = 'none'; if (c.openMenu) c.openMenu(); };
      case 'surr': return () => {
        if (c.spectating()) return;
        if (!this.surrArm) { this.surrArm = true; this.$('rtsSurr').textContent = '🏳 Click again to surrender'; return; }
        this.surrArm = false; this.$('rtsMenu').style.display = 'none'; c.act({ t: 'surrender' });
      };
      case 'idle': return () => c.idleWorker();
      case 'army': return () => c.setSel([...c.ents.values()].filter(x => c.isMine(x) && x.kind === 'u' && !x.def.worker).map(x => x.id));
      case 'alertgo': return () => { if (c.lastAlert) c.lookAt(c.lastAlert.x, c.lastAlert.z); };
      case 'overHide': return () => this.hideOver();
      case 'overLobby': return () => c.toLobby();
    }
    return null;
  }
  blocking() { return this.overOpen; }
  menuOpen() { return !!(this.c.uiOpen && this.c.uiOpen()); }
  cursorShow(on) { this.$('rtsCursor').style.display = on ? 'block' : 'none'; this.cursorMove(); }
  // the browser's UI scale (style.css zooms the HUD): screen pixels -> HUD pixels
  zk() { if (this.zkT !== (this.zkT = Math.floor(performance.now() / 1000))) this._zk = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--uiz')) || 1; return this._zk || 1; }
  cursorMove() {
    const c = this.c, cur = this.$('rtsCursor');
    if (cur.style.display !== 'none') {
      const k = this.zk(); cur.style.transform = `translate(${c.mx / k}px,${c.my2 / k}px)`;
      const tgt = !!(c.mode && c.mode.k !== 'place');
      cur.classList.toggle('tgt', tgt);
      const h = c.hoverId && c.ents.get(c.hoverId); cur.classList.toggle('enemy', !!(h && !c.isAlly(h) && h.own >= 0));
    }
    if (this.mmDrag) this.mapDrag(c.mx, c.my2);
  }
  lockHint(on) { this.$('rtsHint').style.display = on ? 'block' : 'none'; }
  boxHide() { this.$('rtsBox').style.display = 'none'; }

  // ---------------------------------------------------------------- messages
  note(text, kind = '') {
    const box = this.$('rtsNotes'), d = document.createElement('div');
    d.className = kind; d.textContent = text; box.appendChild(d);
    this.notes.push({ d, t: 4.5 });
    while (this.notes.length > 5) this.notes.shift().d.remove();
  }
  err(text) {
    const e = this.$('rtsErr'); e.textContent = text; e.style.opacity = 1; this.errT = 2.2;
    this.c.sfx('nope', 0.35, 0.3);
  }
  alert(e) {
    if (ERR_KINDS.has(e.k)) { this.err(e.text); return; }
    const hit = HIT_KINDS.has(e.k);
    this.note(e.text, hit ? 'bad' : e.k === 'derWon' || e.k === 'twin' ? 'good' : '');
    if ((e.x || e.z) && (hit || e.k === 'derWon' || e.k === 'mined')) {
      this.pings.push({ x: e.x, z: e.z, t: 0, c: hit ? '#ff4a3a' : '#ffe45a' });
      if (hit) { this.c.lastAlert = { x: e.x, z: e.z }; this.c.sfx('hurt', 0.45, 4); }
    }
  }

  // ---------------------------------------------------------------- per frame
  frame(dt) {
    const c = this.c; this.t += dt;
    for (const n of this.notes) { n.t -= dt; if (n.t < 0.6) n.d.style.opacity = Math.max(0, n.t / 0.6); }
    while (this.notes.length && this.notes[0].t <= 0) this.notes.shift().d.remove();
    if (this.errT > 0) { this.errT -= dt; if (this.errT < 0.5) this.$('rtsErr').style.opacity = Math.max(0, this.errT / 0.5); }
    // selection box
    const d = c.drag, box = this.$('rtsBox');
    if (d && d.box) { const k = this.zk(); box.style.display = 'block'; box.style.left = Math.min(d.x0, d.x1) / k + 'px'; box.style.top = Math.min(d.y0, d.y1) / k + 'px'; box.style.width = Math.abs(d.x1 - d.x0) / k + 'px'; box.style.height = Math.abs(d.y1 - d.y0) / k + 'px'; }
    else if (box.style.display !== 'none') box.style.display = 'none';
    if (this.mmDrag && !c.locked()) this.mapDrag(c.mx, c.my2);
    this.topBar();
    this.selT -= dt;
    if (this.dirty || this.selT <= 0) { this.selT = 0.2; this.dirty = false; this.players(); this.selection(); this.command(); this.groupsBar(); if (this.cardsOpen) this.cardsPanel(); }
    this.mmT -= dt; if (this.mmT <= 0 && c.M) { this.mmT = 0.12; this.drawMinimap(); }
    this.tip();
    const ov = c.pub && c.pub.ph === 'over';
    if (ov && !this.overShown) this.showOver();
  }
  topBar() {
    const c = this.c, sc = c.my.sc, sw = c.my.sw;
    const set = (id, v) => { const e = this.$(id); if (e.textContent !== String(v)) e.textContent = v; };
    set('rtsC', sc[0]); set('rtsF', sc[1]); set('rtsS', `${sc[2]}/${sc[3]}`);
    this.$('rtsSup').classList.toggle('full', sc[2] >= sc[3] && sc[3] > 0);
    set('rtsInc', `${sc[4]}/min${sc[5] ? ` (+${Math.round(sc[5] * 10) / 10}/s)` : ''}`);
    set('rtsTime', fmtT(c.gameTime()));
    const cap = sw[1], n = sw[0];
    set('rtsBudN', cap ? `${n}/${cap}` : `${n}`);
    this.$('rtsBudBar').style.width = (cap ? Math.min(100, n / cap * 100) : 0) + '%';
    this.$('rtsBud').classList.toggle('hot', !!cap && n / cap > 0.85); this.$('rtsBud').classList.toggle('held', !!sc[7]);
    const co = c.my.co, pend = (co.offN || 0), rb = this.$('rtsResN');
    const badge = pend + (co.hand ? co.hand.length : 0);
    rb.style.display = badge ? '' : 'none'; if (badge) set('rtsResN', badge);
    this.$('rtsResBtn').classList.toggle('pulse', pend > 0 && !this.cardsOpen);
    const idle = [...c.ents.values()].filter(x => x.kind === 'u' && x.def.worker && (x.fl & 4096) && c.isMine(x)).length;
    set('rtsIdle', `🔧 ${idle}`);
  }
  players() {
    const c = this.c, pub = c.pub; if (!pub) return;
    const teams = new Set(pub.pl.map(p => p.team)).size < pub.pl.filter(p => !p.spec).length;
    const h = pub.pl.filter(p => !p.spec).map(p => `<div class="${p.out ? 'out' : ''} ${p.id === c.localId ? 'me' : ''}"><i style="background:${esc(p.color)}"></i>${esc(p.name)}${p.bot ? ' <small>bot</small>' : ''}${!p.on && !p.bot ? ' <small>(left: bot playing)</small>' : ''}${teams ? ` <small>team ${p.team + 1}</small>` : ''}</div>`).join('');
    const html = h + `<div class="fac">${esc(FACTION.name)}${c.spectating() ? ' · watching' : ''}</div>`;
    if (html !== this.plH) { this.plH = html; this.$('rtsPl').innerHTML = html; }
  }
  groupsBar() {
    const c = this.c; let h = '';
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
      const ids = c.groups[i].filter(id => c.ents.has(id)); if (!ids.length) continue;
      const e = c.ents.get(ids[0]), p = c.plOf(e.own), on = ids.length === c.sel.length && ids.every(id => c.sel.includes(id));
      h += `<span class="g ${on ? 'on' : ''}" data-a="grp${i}"><b>${i}</b><img src="${thumbOf(e.type, p ? p.color : '#888')}">${ids.length}</span>`;
      this.acts.set('grp' + i, () => { const ids2 = c.groups[i].filter(id => c.ents.has(id)); if (ids2.length) { if (this.lastGrp === i && performance.now() - this.lastGrpT < 350) { const p2 = c.centerOf(ids2); c.lookAt(p2.x, p2.z); } c.setSel(ids2); this.lastGrp = i; this.lastGrpT = performance.now(); } });
    }
    if (h !== this.grpH) { this.grpH = h; this.$('rtsGroups').innerHTML = h; }
  }

  // ---------------------------------------------------------------- selection panel
  ups(type) { const ids = (this.c.my.co.ups || {})[type] || []; return { ids, sum: sumUps(ids.map(id => (this.cardById.get(id) || {}).up)) }; }
  selection() {
    const c = this.c, sel = c.sel.map(id => c.ents.get(id)).filter(Boolean);
    let h = '';
    if (!sel.length) h = `<div class="inf" style="opacity:.55;align-self:center">Nothing selected. Drag a box or click a unit. Right-click to move or attack, A then click to attack-move.</div>`;
    else if (sel.length === 1) h = this.single(sel[0]);
    else {
      const max = 36; h = `<div class="multi">`;
      sel.slice(0, max).forEach((e, i) => {
        const p = c.plOf(e.own), hp = e.maxHp ? e.hp / e.maxHp : 1, col = hp > 0.6 ? '#4ae05a' : hp > 0.3 ? '#ffd23a' : '#ff4a3a';
        h += `<div class="mp" data-a="ms${i}" data-tip="ms${i}" style="background-image:url(${thumbOf(e.type, p ? p.color : '#888')})"><i><u style="width:${Math.round(hp * 100)}%;background:${col}"></u></i></div>`;
        this.acts.set('ms' + i, (btn, ev) => { if (ev.shiftKey) c.setSel(c.sel.filter(id => id !== e.id)); else if (ev.ctrlKey) c.setSel(c.sel.filter(id => { const x = c.ents.get(id); return x && x.type === e.type; })); else c.setSel([e.id]); });
        this.tipFor['ms' + i] = () => ({ t: `${e.def.name}`, d: `${Math.ceil(e.hp)} / ${e.maxHp} health. Click: select only this one. Shift: remove it. Ctrl: keep only this type.` });
      });
      h += `</div>`;
      if (sel.length > max) h += `<div class="more">+${sel.length - max} more</div>`;
    }
    if (h !== this.selH) { this.selH = h; this.$('rtsSel').innerHTML = h; }
  }
  get tipFor() { return this._tf || (this._tf = {}); }
  single(e) {
    const c = this.c, d = e.def, p = c.plOf(e.own), mine = c.isMine(e);
    const col = p ? p.color : '#888';
    let h = `<div class="por" style="background-image:url(${thumbOf(e.type, col)});border-color:${esc(col)}"><div class="hpn">${Math.ceil(e.hp)} / ${e.maxHp}</div></div><div class="inf">`;
    h += `<div class="nm">${esc(d.name)}<small>${esc(d.role || (e.kind === 'b' ? 'Building' : ''))} · ${esc(p ? p.name : 'Neutral')}</small></div>`;
    if (e.ghost) return h + `<div class="st">Last seen here.</div></div>`;
    const st = [];
    const up = mine && e.kind === 'u' ? this.ups(e.type) : { ids: [], sum: {} }, S = up.sum;
    const armor = (d.armor || 0) + (S.armor || 0);
    st.push(`Armor <b>${Math.round(armor * 10) / 10}</b>`);
    const ws = e.kind === 'u' && (e.fl & 1) && d.siege ? [d.siege] : d.weapons || [];
    for (const w of ws) {
      const dmg = Math.round(w.dmg * (1 + (S.dmg || 0)) * 10) / 10, bonus = w.bonus ? Object.entries(w.bonus).map(([k, v]) => ` (+${Math.round(v * (1 + (S.dmg || 0)))} vs ${k})`).join('') : '';
      const ga = w.ga === 'g' ? 'ground' : w.ga === 'a' ? 'air' : 'ground + air';
      st.push(`Attack <b>${dmg}${(w.n || 1) > 1 ? ' ×' + w.n : ''}</b>${bonus} · range <b>${Math.round((w.range + (S.range || 0)) * 10) / 10}</b> · every <b>${Math.round(w.cd / (1 + (S.rate || 0)) * 100) / 100}s</b> · ${ga}${w.splash ? ' · splash' : ''}`);
    }
    if (d.heal) st.push(`Heals <b>${d.heal.hps}/s</b> to bio units`);
    if (e.kind === 'u') { st.push(`Speed <b>${Math.round(d.speed * (1 + (S.speed || 0)) * 10) / 10}</b>`); st.push(`Sight <b>${d.sight}</b>`); st.push(`Supply <b>${d.supply}</b>`); }
    if (d.income) st.push(`Makes <b>+${d.income}</b> crystal a second`);
    if (d.gives) st.push(`Supply <b>+${d.gives}</b>`);
    h += `<div class="st">${st.map(s => `<span>${s}</span>`).join('')}</div>`;
    const tags = [...(d.tags || [])];
    if (e.kind === 'u') { if (e.fl & 1) tags.push('sieged'); if (e.fl & 2) tags.push('changing mode'); if (e.fl & 4) tags.push('carrying crystal'); if (e.fl & 8) tags.push('carrying flux'); if (e.fl & 16) tags.push('overdrive'); if (e.fl & 512) tags.push('barrier'); if (e.fl & 1024) tags.push('slowed'); if (e.fl & 2048) tags.push('burning'); if (e.fl & 4096) tags.push('idle'); }
    if (tags.length) h += `<div>${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
    if (up.ids.length) {
      const lines = upLines(S);
      h += `<div class="ups" style="margin-top:3px">${up.ids.map(id => { const cd = this.cardById.get(id); return cd ? `<span style="color:${rarC(cd.rarity)}">${esc(cd.icon || '🃏')} ${esc(cd.name)}</span>` : ''; }).join('')}</div>`;
      h += `<div class="ups">${lines.map(l => `<span class="${l.good ? '' : 'bad'}">${esc(l.text)}</span>`).join('')}</div>`;
    }
    if (e.kind === 'b' && mine) {
      if (e.prog < 100) h += `<div class="q">Building <div class="qbar"><u style="width:${e.prog}%"></u></div> ${e.prog}%</div>`;
      const bo = c.my.bo[e.id];
      if (bo && bo[0].length) {
        if (bo !== this.boRef) { this.boRef = bo; this.boAt = performance.now(); }
        const el = bo[1] >= 0 ? bo[1] + (performance.now() - this.boAt) / 1000 : 0, pct = bo[2] ? Math.min(100, el / bo[2] * 100) : 0;
        h += `<div class="q">`;
        for (let i = 0; i < RTS.queueMax; i++) {
          const q = bo[0][i];
          if (!q) { h += `<div class="qs e"></div>`; continue; }
          const img = q === '#card' ? '' : `style="background-image:url(${thumbOf(q, col)})"`;
          h += `<div class="qs" data-a="q${i}" data-tip="q${i}" ${img}>${q === '#card' ? '🃏' : ''}</div>`;
          this.acts.set('q' + i, () => c.act({ t: 'cancel', b: e.id, i }));
          this.tipFor['q' + i] = () => ({ t: q === '#card' ? 'Card research' : UNITS[q].name, d: 'Click to cancel (full refund).' });
        }
        h += `<div class="qbar"><u style="width:${pct.toFixed(1)}%"></u></div></div>`;
      } else if (d.trains && e.prog >= 100) h += `<div class="q" style="opacity:.6;font-size:13px">Idle. ${d.trains.map(u => `${keyL(TRAIN_KEYS[u])}: ${UNITS[u].name}`).join(' · ')}</div>`;
    }
    if (d.desc && (e.kind === 'b' || !up.ids.length)) h += `<div style="opacity:.6;font-size:12.8px;margin-top:3px">${esc(d.desc)}</div>`;
    return h + `</div>`;
  }

  // ---------------------------------------------------------------- command card
  myTech(type) { const c = this.c; for (const e of c.ents.values()) if (e.type === type && e.kind === 'b' && e.prog >= 100 && c.isMine(e)) return true; return false; }
  missing(needs) { return (needs || []).filter(t => !this.myTech(t)); }
  poor(cost) { const sc = this.c.my.sc; return sc[0] < cost[0] || sc[1] < cost[1]; }
  cmdList() {
    const c = this.c, mine = c.mySel(), L = [];
    if (!mine.length || c.spectating()) return L;
    const put = (r, col, b) => { b.r = r; b.col = col; L.push(b); };
    const first = mine[0];
    if (first.kind === 'u') {
      const units = mine.filter(e => e.kind === 'u'), workers = first.def.worker;
      if (this.buildMenu && workers) {
        for (const t of BUILD_MENU) {
          const d = BUILDINGS[t], key = BUILD_KEYS[t], pos = this.posOf(key), miss = this.missing(d.needs);
          put(pos[0], pos[1], { key, img: thumbOf(t, c.me() ? c.me().color : '#5aa0ff'), name: `Build ${d.name}`, cost: d.cost, time: d.time, desc: d.desc, need: miss, dis: miss.length > 0,
            fn: () => { if (miss.length) { this.err(`Needs ${miss.map(x => BUILDINGS[x].name).join(', ')}.`); return; } if (this.poor(d.cost)) { this.err(c.my.sc[0] < d.cost[0] ? 'Not enough crystal.' : 'Not enough flux.'); return; } this.buildMenu = false; c.setMode({ k: 'place', type: t }); } });
        }
        put(2, 4, { key: 'KeyB', icon: '↩', name: 'Back', desc: 'Back to the Rigger\'s commands (Esc).', fn: () => { this.buildMenu = false; this.dirty = true; } });
        return L;
      }
      const md = c.mode && c.mode.k;
      put(0, 0, { key: 'KeyM', icon: '➜', name: 'Move', desc: 'Move to a spot, ignoring enemies (right-click does this too). Shift queues orders.', on: md === 'move', fn: () => c.setMode({ k: 'move' }) });
      put(0, 1, { key: 'KeyS', icon: '■', name: 'Stop', desc: 'Stop what they are doing.', fn: () => c.act({ t: 'cmd', ids: units.map(e => e.id), o: { k: 'stop' } }) });
      put(0, 2, { key: 'KeyH', icon: '✋', name: 'Hold position', desc: 'Stay put and shoot anything in range.', fn: () => c.act({ t: 'cmd', ids: units.map(e => e.id), o: { k: 'hold' } }) });
      put(0, 3, { key: 'KeyP', icon: '⇄', name: 'Patrol', desc: 'Walk back and forth, fighting anything met.', on: md === 'patrol', fn: () => c.setMode({ k: 'patrol' }) });
      if (units.some(u => u.def.weapons.length || u.def.siege)) put(0, 4, { key: 'KeyA', icon: '⚔', name: 'Attack', desc: 'Click an enemy to attack it, or the ground to attack-move: walk there fighting everything on the way.', on: md === 'amove', fn: () => c.setMode({ k: 'amove' }) });
      if (units.some(u => (u.def.ab || []).includes('overdrive'))) put(1, 4, { key: 'KeyT', icon: ABILITIES.overdrive.icon, name: ABILITIES.overdrive.name, desc: ABILITIES.overdrive.desc, fn: () => c.act({ t: 'ab', ab: 'overdrive', ids: units.filter(u => (u.def.ab || []).includes('overdrive')).map(u => u.id) }) });
      if (units.some(u => u.def.siege)) { const sg = units.some(u => u.def.siege && (u.fl & 1)); put(1, 2, { key: 'KeyE', icon: ABILITIES.siege.icon, name: sg ? 'Leave siege mode' : ABILITIES.siege.name, desc: ABILITIES.siege.desc, on: sg, fn: () => c.act({ t: 'ab', ab: 'siege', ids: units.filter(u => u.def.siege).map(u => u.id) }) }); }
      if (workers) {
        put(1, 0, { key: 'KeyG', icon: '⛏', name: 'Gather', desc: 'Click crystal, or one of your Refineries for flux.', on: md === 'gather', fn: () => c.setMode({ k: 'gather' }) });
        put(1, 1, { key: 'KeyC', icon: '⤺', name: 'Return cargo', desc: 'Bring what they carry to the nearest Command Hub.', fn: () => c.act({ t: 'cmd', ids: units.filter(u => u.def.worker).map(u => u.id), o: { k: 'ret' } }) });
        put(1, 3, { key: 'KeyR', icon: '🔧', name: 'Repair', desc: 'Repair a damaged machine or building of yours (costs a little crystal).', on: md === 'repair', fn: () => c.setMode({ k: 'repair' }) });
        put(2, 0, { key: 'KeyB', icon: '🏗', name: 'Build', desc: 'Open the build menu. The Rigger builds it on the spot; more Riggers can help by right-clicking the site.', fn: () => { this.buildMenu = true; this.dirty = true; } });
      }
      return L;
    }
    // buildings
    const bs = mine.filter(e => e.kind === 'b' && e.type === first.type), d = first.def;
    if (first.prog < 100) {
      put(2, 4, { key: 'KeyX', icon: '✖', name: 'Cancel construction', desc: 'Stop building it: 75% of the cost back.', fn: () => c.act({ t: 'cancel', b: first.id }) });
      return L;
    }
    for (const u of d.trains || []) {
      const ud = UNITS[u], key = TRAIN_KEYS[u], pos = this.posOf(key), miss = this.missing(ud.needs);
      put(pos[0], pos[1], { key, img: thumbOf(u, c.me() ? c.me().color : '#5aa0ff'), name: `Train ${ud.name}`, cost: ud.cost, time: ud.time, supply: ud.supply, desc: ud.desc, need: miss, dis: miss.length > 0, n: this.queued(bs, u),
        fn: (btn, ev) => { if (miss.length) { this.err(`Needs ${miss.map(x => BUILDINGS[x].name).join(', ')}.`); return; } const n = ev && ev.shiftKey ? 5 : 1; for (let i = 0; i < n; i++) { if (bs.length > 1) c.act({ t: 'trainAny', ids: bs.map(b => b.id), u }); else c.act({ t: 'train', b: first.id, u }); } c.sfx('ui', 0.3, 0.05); } });
    }
    if (d.research) {
      const pc = pullCost(c.my.co.pulls || 0);
      put(0, 0, { key: 'KeyQ', icon: '🃏', name: 'Pull a card', cost: pc, time: RTS.pull.time, desc: `Research: after ${RTS.pull.time} s you get ${RTS.pull.offer} cards from the shooter's pool to choose from. Fit the one you take to any unit type (every card works on every unit). Each pull costs a bit more.`, n: this.queued(bs, '#card'),
        fn: () => c.act({ t: 'pull', ids: bs.map(b => b.id) }) });
      put(0, 1, { key: 'KeyW', icon: '📚', name: 'Open research (F3)', desc: 'Your pulled cards, your hand and every upgrade fitted so far.', fn: () => this.openCards(true) });
    }
    if ((d.ab || []).includes('flare')) {
      const cd = c.my.sc[6];
      put(1, 3, { key: 'KeyF', icon: ABILITIES.flare.icon, name: ABILITIES.flare.name, cost: [RTS.flare.cost, 0], desc: ABILITIES.flare.desc, cd, on: c.mode && c.mode.k === 'flare', fn: () => { if (cd > 0) { this.err(`Recon Flare is ready again in ${cd} s.`); return; } c.setMode({ k: 'flare' }); } });
    }
    if (d.trains) put(2, 3, { key: 'KeyY', icon: '🚩', name: 'Set rally point', desc: 'Where new units go. Right-click the ground does this too. Rally a Command Hub on crystal and new Riggers start mining.', on: c.mode && c.mode.k === 'rally', fn: () => c.setMode({ k: 'rally' }) });
    const bo = c.my.bo[first.id];
    if (bo && bo[0].length) put(2, 4, { key: 'KeyX', icon: '✖', name: 'Cancel last', desc: 'Cancel the last unit in the queue (full refund).', fn: () => c.act({ t: 'cancel', b: first.id }) });
    return L;
  }
  queued(bs, u) { let n = 0; for (const b of bs) { const bo = this.c.my.bo[b.id]; if (bo) n += bo[0].filter(q => q === u).length; } return n; }
  posOf(key) { for (let r = 0; r < 3; r++) { const i = GRID_KEYS[r].indexOf(key); if (i >= 0) return [r, i]; } return [2, 2]; }
  command() {
    const L = this.cmdList(); this.cmds = L;
    const grid = Array.from({ length: 15 }, () => null);
    for (const b of L) grid[b.r * 5 + b.col] = b;
    let h = '';
    grid.forEach((b, i) => {
      if (!b) { h += `<div class="em"></div>`; return; }
      const cls = ['cb', b.img ? 'img' : '', b.on ? 'on' : '', b.dis ? 'dis' : '', b.cost && this.poor(b.cost) ? 'poor' : ''].join(' ');
      h += `<div class="${cls}" data-a="cmd${i}" data-tip="cmd${i}" ${b.img ? `style="background-image:url(${b.img})"` : ''}><span class="k">${keyL(b.key)}</span>${b.img ? '' : b.icon}${b.n ? `<span class="n">${b.n}</span>` : ''}${b.cd > 0 ? `<span class="cd">${b.cd}</span>` : ''}</div>`;
      this.acts.set('cmd' + i, (btn, ev) => { if (btn === 0) b.fn(btn, ev); });
      this.tipFor['cmd' + i] = () => this.cmdTip(b);
    });
    if (h !== this.cmdH) { this.cmdH = h; this.$('rtsCmd').innerHTML = h; }
  }
  cmdTip(b) {
    const sc = this.c.my.sc;
    let cost = '';
    if (b.cost) cost = `<div class="c"><span class="${sc[0] < b.cost[0] ? 'no' : ''}">💎 ${b.cost[0]}</span>${b.cost[1] ? `<span class="${sc[1] < b.cost[1] ? 'no' : ''}">🟢 ${b.cost[1]}</span>` : ''}${b.supply ? `<span>👥 ${b.supply}</span>` : ''}${b.time ? `<span>⏱ ${b.time}s</span>` : ''}</div>`;
    return { t: `${esc(b.name)} <span class="k">[${keyL(b.key)}]</span>`, html: true, d: cost + (b.need && b.need.length ? `<div class="need">Needs ${b.need.map(x => esc(BUILDINGS[x].name)).join(', ')}</div>` : '') + `<div class="d">${esc(b.desc || '')}</div>` };
  }
  hotkey(code, e) {
    const c = this.c;
    if (code === 'F3') { this.openCards(!this.cardsOpen); return true; }
    if (this.overOpen) return false;
    if (code === 'KeyB' && this.buildMenu) { this.buildMenu = false; this.dirty = true; return true; }
    this.command();
    const b = this.cmds.find(x => x.key === code);
    if (!b) return false;
    b.fn(0, e);
    this.dirty = true;
    return true;
  }

  // ---------------------------------------------------------------- tooltips
  tip() {
    const c = this.c, box = this.$('rtsTip');
    const el = document.elementFromPoint(c.mx, c.my2), t = el && el.closest && el.closest('[data-tip]');
    if (!t || !this.el.contains(t)) { if (box.style.display !== 'none') box.style.display = 'none'; this.tipK = null; return; }
    const k = t.dataset.tip;
    let info = this.tipFor[k] ? this.tipFor[k]() : STAT_TIPS[k] ? { t: STAT_TIPS[k][0], d: STAT_TIPS[k][1] } : null;
    if (!info) { box.style.display = 'none'; return; }
    const html = `<div class="t">${info.html ? info.t : esc(info.t)}</div>${info.html ? info.d : `<div class="d">${esc(info.d)}</div>`}`;
    if (html !== this.tipH) { this.tipH = html; box.innerHTML = html; }
    box.style.display = 'block';
    const z = this.zk(), r = t.getBoundingClientRect(), w = box.offsetWidth, hh = box.offsetHeight, W = innerWidth / z;
    const L = r.left / z, T = r.top / z, B = r.bottom / z;
    let x = Math.min(W - w - 6, Math.max(6, L + r.width / z / 2 - w / 2)), y = T - hh - 8;
    if (y < 6) y = B + 8;
    box.style.left = x + 'px'; box.style.top = y + 'px';
  }

  // ---------------------------------------------------------------- minimap
  setupMinimap() {
    const c = this.c, M = c.M, N = M.N, cv = this.$('rtsMap'), dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = cv.height = Math.round(MM * dpr); this.mmS = cv.width;
    const base = document.createElement('canvas'); base.width = base.height = N;
    const g = base.getContext('2d'), img = g.createImageData(N, N);
    const pal = [[74, 102, 58], [98, 120, 66], [126, 136, 84], [156, 152, 112], [52, 52, 46]];   // (v1.2.28: four heights + the mountains)
    for (let k = 0; k < N * N; k++) {
      const L = Math.max(0, Math.min(4, M.lv[k])); let [r, gg, b] = pal[L];
      if (M.ramp[k]) { r = 150; gg = 136; b = 100; }
      else if (!M.walk[k]) { r *= 0.6; gg *= 0.6; b *= 0.6; }
      const n = ((k * 2654435761) >>> 24) / 255 * 10 - 5;
      img.data[k * 4] = r + n; img.data[k * 4 + 1] = gg + n; img.data[k * 4 + 2] = b + n; img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0); this.mmBase = base;
    this.fog = document.createElement('canvas'); this.fog.width = this.fog.height = N; this.fogImg = this.fog.getContext('2d').createImageData(N, N);
  }
  w2m(x, z) { const H = this.c.M.H, s = this.mmS; return [(x + H) / (2 * H) * s, (z + H) / (2 * H) * s]; }
  m2w(cx, cy) { const r = this.$('rtsMap').getBoundingClientRect(), H = this.c.M.H; return { x: ((cx - r.left) / r.width) * 2 * H - H, z: ((cy - r.top) / r.height) * 2 * H - H }; }
  mapDown(x, y, button, e) {
    const c = this.c; if (!c.M) return;
    const w = this.m2w(x, y);
    if (button === 0) {
      if (c.mode) { c.useMode(!!(e && e.shiftKey), w); return; }
      this.mmDrag = true; c.cam.goal = null; c.cam.x = w.x; c.cam.z = w.z;
    } else if (button === 2) {
      const mine = c.mySel(); if (!mine.length) return;
      if (mine[0].kind === 'b') c.act({ t: 'cmd', ids: mine.map(m => m.id), o: { k: 'rally', x: w.x, z: w.z } });
      else c.act({ t: 'cmd', ids: mine.map(m => m.id), o: { k: 'smart', x: Math.round(w.x * 10) / 10, z: Math.round(w.z * 10) / 10 }, q: !!(e && e.shiftKey) });
      c.mark(w.x, w.z, '#5aff7a'); c.sfx('pip', 0.35, 0.05);
      this.pings.push({ x: w.x, z: w.z, t: 0.4, c: '#5aff7a' });
    }
  }
  mapDrag(x, y) { const c = this.c, w = this.m2w(x, y); c.cam.goal = null; c.cam.x = w.x; c.cam.z = w.z; }
  drawMinimap() {
    const c = this.c, M = c.M, N = M.N, cv = this.$('rtsMap'), g = cv.getContext('2d'), s = this.mmS, k0 = s / N;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mmBase, 0, 0, s, s);
    // fog
    const fd = this.fogImg.data, vis = c.vis, ex = c.explored;
    for (let k = 0; k < N * N; k++) fd[k * 4 + 3] = vis[k] === 2 ? 0 : ex[k] ? 120 : 228;
    this.fog.getContext('2d').putImageData(this.fogImg, 0, 0);
    g.drawImage(this.fog, 0, 0, s, s);
    // resources, derricks, towers
    for (const r of c.res.values()) {
      const k = Math.max(0, Math.floor((r.z + M.H) / CELL) * N + Math.floor((r.x + M.H) / CELL));
      if (!ex[k] && !c.spectating()) continue;
      const [x, y] = this.w2m(r.x, r.z);
      g.fillStyle = r.k === 'c' ? '#6ad4ff' : '#6aff9a'; const q = r.k === 'c' ? Math.max(2, k0 * 0.9) : Math.max(3, k0 * 1.6); g.fillRect(x - q / 2, y - q / 2, q, q);
    }
    for (const d of c.der) {
      const [x, y] = this.w2m(d.x, d.z), p = d.own >= 0 ? c.plOf(d.own) : null;
      g.fillStyle = p ? p.color : '#bbbbbb'; g.strokeStyle = '#000'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y); g.closePath(); g.fill(); g.stroke();
    }
    M.towers.forEach((t, i) => { const [x, y] = this.w2m(t.x, t.z), st = c.towersSt[i] || 0; g.strokeStyle = st === 1 ? '#7fff9a' : st === 2 ? '#ff5a4a' : '#cccccc'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 3.5, 0, 6.3); g.stroke(); });
    // buildings, then units
    for (const e of c.ents.values()) {
      if (e.kind !== 'b') continue;
      const p = c.plOf(e.own), [x, y] = this.w2m(e.x, e.z), w = Math.max(4, e.def.s * CELL * s / (2 * M.H));
      g.fillStyle = p ? p.color : '#aaa'; g.globalAlpha = e.ghost ? 0.55 : 1; g.fillRect(x - w / 2, y - w / 2, w, w);
      g.strokeStyle = c.sel.includes(e.id) ? '#ffffff' : '#000000'; g.lineWidth = 1; g.strokeRect(x - w / 2, y - w / 2, w, w); g.globalAlpha = 1;
    }
    const us = Math.max(2.5, s / 110);
    for (const e of c.ents.values()) {
      if (e.kind !== 'u') continue;
      const p = c.plOf(e.own), [x, y] = this.w2m(e.x, e.z);
      g.fillStyle = c.sel.includes(e.id) ? '#ffffff' : p ? p.color : '#aaa';
      const q = e.def.supply >= 3 ? us * 1.4 : us; g.fillRect(x - q / 2, y - q / 2, q, q);
    }
    // flares, pings
    for (const f of c.flares) { const [x, y] = this.w2m(f.x, f.z); g.strokeStyle = '#ffd166'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, RTS.flare.r * s / (2 * M.H), 0, 6.3); g.stroke(); }
    this.pings = this.pings.filter(pg => (pg.t += 0.12) < 2.4);
    for (const pg of this.pings) { const [x, y] = this.w2m(pg.x, pg.z), k = (pg.t % 0.8) / 0.8; g.strokeStyle = pg.c; g.globalAlpha = 1 - k; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 4 + k * 16, 0, 6.3); g.stroke(); g.globalAlpha = 1; }
    // camera view
    const pts = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([a, b]) => c.ground(a, b));
    if (pts.every(Boolean)) {
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.4; g.beginPath();
      pts.forEach((p, i) => { const [x, y] = this.w2m(p.x, p.z); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); g.stroke();
    }
  }

  // ---------------------------------------------------------------- research panel
  openCards(on) {
    this.cardsOpen = !!on; this.$('rtsCards').style.display = on ? '' : 'none';
    if (on) { this.cardKey = ''; this.cardsPanel(); } else this.cardSel = null;
  }
  cardEl(id, sel, a, small) {
    const cd = this.cardById.get(id); if (!cd) return '';
    const col = rarC(cd.rarity);
    return `<div class="rc ${small ? 'small' : ''} ${sel ? 'sel' : ''}" data-a="${a}" style="border-color:${col}">${cd.imageUrl ? `<div class="art" style="background-image:url('${esc(cd.imageUrl)}')"></div>` : ''}<span class="ic">${esc(cd.icon || '🃏')}</span><span class="rr" style="color:${col}">${esc(cd.rarity)}</span><div class="nm">${esc(cd.name)}</div><ul>${upLines(cd.up).map(l => `<li class="${l.good ? '' : 'bad'}">${esc(l.text)}</li>`).join('')}</ul></div>`;
  }
  cardsPanel() {
    const c = this.c, co = c.my.co, off = co.off, hand = co.hand || [], ups = co.ups || {};
    const selType = (() => { const m = c.mySel(); return m.length && m[0].kind === 'u' ? m[0].type : null; })();
    if (this.cardSel && this.cardSel.src === 'off' && !off) this.cardSel = null;
    if (this.cardSel && this.cardSel.src === 'hand' && !hand.includes(this.cardSel.id)) this.cardSel = null;
    const key = JSON.stringify([off, co.offN, hand, ups, this.cardSel, selType, co.pulls]);
    if (key === this.cardKey) return; this.cardKey = key;
    const col = c.me() ? c.me().color : '#5aa0ff';
    let h = `<h3><span>📚 Research <small style="opacity:.6;font-weight:400">· every card works on every unit type · up to ${RTS.pull.perUnit} cards per unit (Riggers: any number) · click ✕ on a fitted card to take it back</small></span><button class="rb" data-a="cClose">✕ Close (Esc)</button></h3>`;
    this.acts.set('cClose', () => this.openCards(false));
    const fitRow = (onFit, keep) => {
      let r = `<div class="fit"><span>Fit to:</span>`;
      for (const u of UNIT_IDS) {
        const n = (ups[u] || []).length, cap = cardCap(u), full = n >= cap;   // (v1.2.28: 4 cards per unit type)
        r += `<button class="rb ${u === selType ? 'hl' : ''}${full ? ' off' : ''}" data-a="fit_${u}" data-tip="fit_${u}"${full ? ' style="opacity:.45"' : ''}><img src="${thumbOf(u, col)}">${esc(UNITS[u].name)} <small>${cap === Infinity ? (n || '') : `${n}/${cap}`}</small></button>`;
        this.acts.set('fit_' + u, () => { if (full) { this.c.sfx && this.c.sfx('ui', 0.4); this.note(`${UNITS[u].name}s already have ${cap} cards. Take one off below first.`, 'err'); return; } onFit(u); });
        this.tipFor['fit_' + u] = () => ({ t: UNITS[u].name, d: `${UNITS[u].role}. ${n ? `${n} card${n > 1 ? 's' : ''} fitted` : 'No cards fitted yet'}${cap === Infinity ? ' (workers take any number).' : ` of ${cap}.${full ? ' Full: take one off below to fit another.' : ''}`}` });
      }
      if (keep) { r += `<button class="rb" data-a="keep">✋ Keep in hand</button>`; this.acts.set('keep', keep); }
      return r + `</div>`;
    };
    h += `<h4>New cards${co.offN > 1 ? ` (${co.offN - 1} more pull${co.offN > 2 ? 's' : ''} waiting)` : ''}</h4>`;
    if (off) {
      h += `<div class="row">${off.map((id, i) => this.cardEl(id, this.cardSel && this.cardSel.src === 'off' && this.cardSel.i === i, 'off' + i)).join('')}</div>`;
      off.forEach((id, i) => this.acts.set('off' + i, () => { this.cardSel = { src: 'off', i }; this.cardsPanel(); }));
      if (this.cardSel && this.cardSel.src === 'off') { const i = this.cardSel.i; h += fitRow(u => { c.act({ t: 'pick', i, u }); this.cardSel = null; }, () => { c.act({ t: 'pick', i }); this.cardSel = null; }); }
      else h += `<div class="none">Click a card to choose it.</div>`;
    } else h += `<div class="none">No new cards. Select an Archive and press Q to pull one (💎 ${pullCost(co.pulls || 0)[0]} 🟢 ${pullCost(co.pulls || 0)[1]}).</div>`;
    h += `<h4>Hand (${hand.length}/${RTS.pull.hand})</h4>`;
    if (hand.length) {
      h += `<div class="row">${hand.map(id => this.cardEl(id, this.cardSel && this.cardSel.src === 'hand' && this.cardSel.id === id, 'h_' + id, true)).join('')}</div>`;
      hand.forEach(id => this.acts.set('h_' + id, () => { this.cardSel = { src: 'hand', id }; this.cardsPanel(); }));
      if (this.cardSel && this.cardSel.src === 'hand') {
        const id = this.cardSel.id;
        h += fitRow(u => { c.act({ t: 'fit', c: id, u }); this.cardSel = null; });
        h += `<div class="fit"><button class="rb warn" data-a="discard">🗑 Discard this card</button></div>`;
        this.acts.set('discard', () => { c.act({ t: 'discard', c: id }); this.cardSel = null; });
      }
    } else h += `<div class="none">Empty. Cards you keep instead of fitting wait here.</div>`;
    h += `<h4>Upgrades</h4>`;
    const typed = UNIT_IDS.filter(u => (ups[u] || []).length);
    if (!typed.length) h += `<div class="none">No upgrades yet.</div>`;
    for (const u of typed) {
      const ids = ups[u], S = sumUps(ids.map(id => (this.cardById.get(id) || {}).up)), cap = cardCap(u);
      // v1.2.28: ✕ takes a card off (back to your hand), so upgrades can be moved to another unit type
      h += `<div class="upr"><img src="${thumbOf(u, col)}"><div><b>${esc(UNITS[u].name)}</b> <small style="opacity:.6">${cap === Infinity ? ids.length : `${ids.length}/${cap}`}</small><div class="cs">${ids.map((id, i) => { const cd = this.cardById.get(id); if (!cd) return ''; this.acts.set(`un_${u}_${i}`, () => c.act({ t: 'unfit', c: id, u })); return `<span style="border-color:${rarC(cd.rarity)};color:${rarC(cd.rarity)}">${esc(cd.name)} <button class="rb x" data-a="un_${u}_${i}" title="Take this card off (back to your hand)" style="padding:0 4px;min-width:0;font-size:11px">✕</button></span>`; }).join('')}</div><div class="ls">${upLines(S).map(l => esc(l.text)).join(' · ')}</div></div></div>`;
    }
    this.$('rtsCards').innerHTML = h;
  }

  // ---------------------------------------------------------------- end screen
  showOver() {
    const c = this.c, pub = c.pub; if (!pub) return;
    this.overShown = true; this.overOpen = true; this.openCards(false);
    const me = c.me(), won = me && !me.spec && pub.win != null && me.team === pub.win;
    const winners = pub.pl.filter(p => !p.spec && pub.win != null && p.team === pub.win);
    const mins = Math.max(1, c.gameTime() / 60);
    const rows = pub.pl.filter(p => !p.spec).map(p => { const s = p.st || {}; return `<tr class="${winners.includes(p) ? 'w' : ''}"><td><span style="color:${esc(p.color)}">■</span> ${esc(p.name)}${p.bot ? ' <small>(bot)</small>' : ''}</td><td>${s.built || 0}</td><td>${s.lost || 0}</td><td>${s.killed || 0}</td><td>${s.razed || 0}</td><td>${Math.round(s.mined || 0)}</td><td>${s.cards || 0}</td><td>${Math.round((s.apm || 0) / mins)}</td></tr>`; }).join('');
    const title = me && !me.spec ? (won ? 'Victory' : 'Defeat') : 'Game over';
    const sub = winners.length ? `${winners.map(p => esc(p.name)).join(' & ')} win${winners.length > 1 ? '' : 's'} · ${fmtT(c.gameTime())}` : `Draw · ${fmtT(c.gameTime())}`;
    this.$('rtsOver').innerHTML = `<div class="pan"><h2 style="color:${won ? '#9affb8' : title === 'Defeat' ? '#ff8a7a' : '#fff'}">${title}</h2><div class="sub">${sub}</div><table><tr><th>Player</th><th>Units made</th><th>Units lost</th><th>Kills</th><th>Buildings razed</th><th>Gathered</th><th>Cards</th><th>APM</th></tr>${rows}</table><div class="btns"><button class="rb" data-a="overHide">👁 Look at the map</button>${c.isHost ? '<button class="rb go" data-a="overLobby">↩ Back to the lobby</button>' : '<span style="opacity:.7;align-self:center">The host takes everyone back to the lobby.</span>'}</div></div>`;
    this.$('rtsOver').style.display = 'flex';
    c.sfx(won ? 'victory' : 'defeat', 0.7, 1);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  hideOver() {
    this.overOpen = false; this.$('rtsOver').style.display = 'none';
    if (this.c.isHost && !this.backBtn) { this.backBtn = true; const m = this.$('rtsMenu'); m.insertAdjacentHTML('afterbegin', '<button class="rb go" data-a="overLobby">↩ Back to the lobby</button><button class="rb" data-a="overShow">📊 Results</button>'); this.acts.set('overShow', () => { this.overOpen = true; this.$('rtsOver').style.display = 'flex'; m.style.display = 'none'; }); m.style.display = ''; }
  }
}
