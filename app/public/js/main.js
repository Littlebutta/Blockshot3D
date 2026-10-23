import { PATCHES } from './patchnotes.js';
import { ART, RULES, DIFFICULTY, RARITY, STAT_INFO, DEFAULT_LOBBY_SETTINGS, COSMETICS, COSMETIC_LABELS, assignColors, sizeFor, ROUND_MODS } from './config.js';
import { t, setLanguage, languageOptions } from './i18n.js';
const tr = t;   // for functions that shadow t locally
import { applyColorBlind } from './a11y.js';
import { recommend, PAIRS, cardEffects } from './synergy.js';
import { slopify, slopVerb, slopCardName, slopBadge, slopTypos, slopInit, setSlop, slopTick, slopOn } from './slop.js';
import * as THREE from '/vendor/three/build/three.module.js';
import { buildPlayerModel, attachCosmetics } from './art.js';
import { FIGHTERS, FIGHTER_IDS, fighterOf, BRAWL, BITEM_INFO } from './brawl.js';
import { loadCards, cardLines, hasDownside, validateCard, rarityOf, cardWeight } from './cards.js';
import { CRITTER_MAX, MOUNT } from './sim.js';
import { AmonGame } from './amon.js';
import { AmonClient } from './amonui.js';
import { makeRtsHost } from './rtshost.js';
import { threadCount, coreCount } from './threads.js';
import { SimLink } from './simlink.js';
import { kcPackInto, kcHas, kcExpand } from './viewpack.js';
import { extFields, isRaider } from './hostsim.js';
import { RtsClient } from './rtsui.js';
import { openGallery } from './gallery.js';
import { COOP_DIFFICULTY, coopDiffKey, UNIT_NAMES, CORE_TWISTS } from './coop.js';
import { prepareLevel, accel, movePlayer, groundBelow, wallSegments, seedThru, unstick } from './physics.js';
import { AckDecoder } from './netcodec.js';
import { PeerNetStats, HostNetStats, pingClass, RateMeter, Worst } from './netstats.js';
const NR = { frame: new RateMeter(), sim: new RateMeter(), send: new RateMeter() };
// v1.2.31: the frame rate the shot budget goes by: frames in the last half second (NR.frame looks back 2 s, which let a
// heavy fight sink to a few fps before the budget saw it). v1.2.32: a count, not an average of frame times, so one
// long frame on its own doesn't read as a slow game (in 1.2.31 every hitch made the budget cut shots)
const fastFps = () => NR.frame.hz(undefined, 500);
// v1.2.9: hitch readout (network window): worst frame over the last 5 s with its [game, draw] ms, slowest snapshot handling, longest gap between sends (host)
const HM = { frame: new Worst(), msg: new Worst(), send: new Worst(), sendAt: 0 };   // v1.2.9: frames drawn, host sim runs and snapshots sent per second (network window)
import { gpuInfo, GFX_TIERS, TIER_LABEL } from './gfxdetect.js';
import { generateLevel } from './levelgen.js';
import { Renderer } from './render.js';
import { owTake, owStateOf } from './owrender.js';
import { VEH_KINDS, LOOT_DISCARD } from './openworld.js';
import { Sound } from './audio.js';
import { Net, SteamNet } from './net.js';
import { loadSettings, saveSettings, settingsFileText, parseSettingsFile, GFX_PRESETS, DEFAULT_BINDS, BIND_LABELS, bindsOf, codeLabel } from './settings.js';
import { tipFor, TYPE_NOTES, STAT_AMP, MOD_AMP, BOOSTED_BY } from './cardinfo.js';
import { PRICES, BET, priceOf, owns, initEconomy, buy, matchPay, fmtCash } from './economy.js';
import { loadArtAssets } from './art.js';
import { openInfo, closeInfo, infoOpen } from './infopop.js';
import { budgetView, budgetEstimate } from './budget.js';


const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = (s, fb = 'Player') => (String(s || '').trim().slice(0, 20) || fb);

const settings = loadSettings();
if (initEconomy(settings)) saveSettings(settings);   // cash + owned cosmetics (economy.js)
const sound = new Sound();
sound.setVolumes(settings);
let renderer;
let CARDS = [], CARD_ERRORS = [], cardById = new Map();
let serverInfo = { lan: [], port: location.port, canSaveCards: false };
let S = null;                       // current session (solo, host or peer)
let currentScreen = 'title', settingsReturn = 'title';
let steamStatus = { desktop: false, available: false };

// ---------------------------------------------------------------- screens
function show(id) {
  currentScreen = id;
  document.body.dataset.screen = id || 'none';   // v1.2.0: the HUD tucks itself away behind menus (style.css)
  closeCardDetail();
  if (id !== 'pick') closePeek(true);
  if (id === 'title' || id === 'customize' || id === 'over' || id === 'lobby') refreshCash();
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('hidden', el.id !== id);
  const am = document.getElementById('amon'); if (am) am.style.visibility = id && id !== 'none' ? 'hidden' : '';   // AMON's board/store sit above the HUD: keep them out of menus
  if (!S || !S.inGame) sound.playMusic('menu');
}
let toastT = 0, bannerT = 0;
// Text passes through the translator (i18n.js) and, with the AI slop filter on, gets "enhanced" (slop.js).
let evMuted = false;   // v1.2.37: handling another tournament arena's event (handleEvent): no toasts, pauses or kill-cam marks from it
function toast(text) { if (evMuted) return; $('toast').textContent = slopify(t(text)); $('toast').classList.add('show'); toastT = 2.8; }
function banner(text, color, dur = 1.4) {
  const b = $('banner'); b.textContent = slopify(text); b.style.color = color || 'var(--fg)';
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); bannerT = dur;   // v1.2.0: restart the pop-in each time
  if (slopOn()) { b.classList.remove('confetti'); void b.offsetWidth; b.classList.add('confetti'); }
}

// ---- kill feed (top right)
function killFeed(e) {
  const r = id => rosterOf(id), me = S.localId;
  const name = id => `<b style="color:${r(id).color}">${esc(id === me ? 'You' : r(id).name)}</b>`;
  const verb = slopOn() ? slopVerb() : null;
  const el = document.createElement('div');
  if (e.k && e.k !== e.p) el.innerHTML = verb ? `${name(e.k)} <span class="x">${verb}</span> ${name(e.p)}` : `${name(e.k)}<span class="x">✕</span>${name(e.p)}`;
  else if (e.k === e.p) el.innerHTML = `${name(e.p)} <span class="x">took themselves out</span>`;
  else el.innerHTML = `${name(e.p)} <span class="x">was eliminated</span>`;
  const feed = $('killfeed');
  feed.appendChild(el);
  while (feed.children.length > 5) feed.firstChild.remove();
  setTimeout(() => el.classList.add('old'), 5000);
  setTimeout(() => el.remove(), 5500);
}
function emoteFeed(id, m) {
  const r = rosterOf(id), el = document.createElement('div');
  el.className = 'emoteRow';
  el.innerHTML = `<b style="color:${r.color}">${esc(id === S.localId ? t('You') : r.name)}</b> <span class="em">${m.icon}</span> <span class="x">${esc(t(m.label))}</span>`;
  const feed = $('killfeed'); feed.appendChild(el);
  while (feed.children.length > 6) feed.firstChild.remove();
  setTimeout(() => el.classList.add('old'), 4500);
  setTimeout(() => el.remove(), 5000);
}
// v1.2.11 death recap (sim.js deathRecap): who killed you, everyone who hurt you in your last 8 s, and the killer's cards.
const DMG_KIND = { hit: 'shots', blast: 'explosions', fire: 'fire', poison: 'poison', toxic: 'toxic cloud', drain: 'life drain', dot: 'damage over time' };
let deathLogT = 0;
function showDeathLog(e) {
  const r = id => rosterOf(id), me = S.localId;
  const who = id => {
    if (id == null) return t('the arena');
    if (id === me) return t('yourself');
    const x = e.dl.find(d => d[0] === id), u = x && x[4] ? { name: x[4], ownerId: x[3] } : r(id), own = u.ownerId != null && u.ownerId !== id ? u.ownerId : null;
    if (own == null) return u.name || '?';
    return (own === me ? t('your') : (r(own).name || '?') + '\u2019s') + ' ' + (u.name || t('unit'));
  };
  const ownerOf = id => { const x = e.dl.find(d => d[0] === id); return x && x[4] ? x[3] : r(id).ownerId; };
  const color = id => (id == null ? '#9aa5bd' : (ownerOf(id) != null ? r(ownerOf(id)).color : null) || r(id).color || '#fff');
  const killer = e.k == null ? null : e.k;
  const killerHero = killer != null && ownerOf(killer) != null && ownerOf(killer) !== killer ? ownerOf(killer) : killer;
  const head = killer === me ? t('You took yourself out') : t('Killed by') + ` <b style="color:${color(killer)}">${esc(who(killer))}</b>` + (e.kk && DMG_KIND[e.kk] ? ` <span class="dlk">(${t(DMG_KIND[e.kk])})</span>` : '');
  const total = e.dl.reduce((a, x) => a + x[2], 0) || 1;
  const rows = e.dl.map(([s, k, a]) => `<div class="dlrow"><span class="dln" style="color:${color(s)}">${esc(who(s))}</span><span class="dlk">${esc(t(DMG_KIND[k] || k))}</span><span class="dlbar"><i style="width:${Math.round(a / total * 100)}%;background:${color(s)}"></i></span><span class="dla">${a}</span></div>`).join('');
  const kc = killerHero != null && killerHero !== me ? (r(killerHero).cards || []).map(id => cardById.get(id)).filter(Boolean) : [];
  const cards = kc.length ? `<div class="dlcards">${esc(t('Their cards'))}: ${kc.slice(0, 8).map(c => esc(`${c.icon || ''} ${c.name}`)).join(', ')}${kc.length > 8 ? ' +' + (kc.length - 8) : ''}</div>` : '';
  const el = $('deathLog');
  el.innerHTML = `<h4>${head}</h4>${rows}${cards}`;
  el.classList.remove('hidden', 'fade');
  deathLogT = 8;
}
function tickDeathLog(dt) {
  if (!(deathLogT > 0)) return;
  const me = S && S.view && S.view.players.find(p => p.id === S.localId);
  // v1.2.21 (Devin): stays up until the round ends (or you are back in), no timer
  if (!S || !S.inGame || (me && me.alive) || (S.view && (S.view.phase === 'picking' || S.view.phase === 'over'))) {
    deathLogT = 0; $('deathLog').classList.add('fade'); setTimeout(() => { if (!(deathLogT > 0)) $('deathLog').classList.add('hidden'); }, 450);
  }
}
// ---- v1.2.0 game feel: hit-stop, slow motion, hit markers, the round win splash
// Solo scales its own simulation (hit-stop on kills, slow motion on the round-winning kill); a host only does the
// slow motion (peers see it through the snapshots); peers never change time.
const TS = { stop: 0, slow: 0, dur: 1 };
function hitStop(sec) { if (!evMuted && S && S.role === 'solo' && settings.feel !== false) TS.stop = Math.max(TS.stop, sec); }
function slowMo(sec) { if (S && S.role !== 'peer' && settings.feel !== false) { TS.slow = TS.dur = sec; TS.stop = 0; } }
function timeScale(dt) {
  if (!S || S.paused) return 1;
  if (TS.stop > 0) { TS.stop -= dt; return 0.03; }
  if (TS.slow > 0) { TS.slow -= dt; const u = 1 - TS.slow / TS.dur; return u < 0.5 ? 0.22 : 0.22 + 0.78 * ((u - 0.5) / 0.5) ** 2; }
  return 1;
}
const duelMode = () => S && ['ffa', 'tdm', 'brawl'].includes(S.matchSettings.mode) && !S.matchSettings.commander;
const waveMode = () => S && (S.matchSettings.mode === 'waves' || !!S.matchSettings.core);
function hitMarker(kill) {
  const el = $('hitMark'); if (!el || currentScreen !== 'none') return;
  if (settings.view === 'first') { el.style.left = '50%'; el.style.top = '50%'; }
  else { el.style.left = ((renderer.mouse.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - renderer.mouse.y) / 2 * innerHeight) + 'px'; }
  el.className = ''; void el.offsetWidth; el.className = kill ? 'on kill' : 'on';
}
let splashT = 0;
// Dark text on light colors, white on dark ones (team and player colors run the whole range).
function inkOn(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); if (!m) return '#10131c';
  const n = parseInt(m[1], 16), lin = v => { v /= 255; return v <= 0.04 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.22 ? '#10131c' : '#ffffff';
}
function roundSplash(w) {
  if (!S || !S.inGame) return;
  const el = $('roundSplash'), L = keyLabel(w), mine = w === myKey();
  const goal = S.matchSettings.roundsToWin || 5, sc = Math.min(goal, (S.view.scores || {})[w] || 0);
  el.classList.remove('modSplash');
  el.style.setProperty('--c', L.color || 'var(--accent)');
  el.style.setProperty('--on', inkOn(L.color));
  const waves = waveMode();
  el.querySelector('.rsSmall').textContent = waves ? t('Wave {n}', { n: S.view.round || 1 }) : t('Round {n}', { n: S.view.round || 1 });
  el.querySelector('.rsBig').textContent = waves ? t(mine ? 'Wave cleared!' : 'The squad has fallen') : mine ? t('You won the round') : teamPlay() ? `${L.name} takes the round` : t('{name} wins the round', { name: L.name });
  el.querySelector('.rsText').textContent = '';
  el.querySelector('.rsPips').innerHTML = goal > 12 || (waves && !mine) ? '' : Array.from({ length: goal }, (_, i) => `<i class="${i < sc - 1 ? 'on' : i === sc - 1 ? 'new' : ''}"></i>`).join('');
  el.classList.remove('hidden', 'out'); void el.offsetWidth; el.classList.add('in');
  $('banner').classList.remove('show'); bannerT = 0;
  setTimeout(() => { if (!el.classList.contains('hidden')) sound.play('pip', 0.8); }, 520);
  splashT = 2.4;
}
// v1.2.15 round modifier: a splash as the round starts, then a small tag at the top for the rest of the round
function modSplash(n, id) {
  const m = ROUND_MODS[id]; if (!m || !S || !S.inGame) return;
  const el = $('roundSplash');
  el.style.setProperty('--c', '#c48bff'); el.style.setProperty('--on', '#10131c');
  el.querySelector('.rsSmall').textContent = t('Round {n}', { n }) + ' · ' + t('Modifier');
  el.querySelector('.rsBig').textContent = t(m.name);
  el.querySelector('.rsPips').innerHTML = '';
  el.querySelector('.rsText').textContent = t(m.text);
  el.classList.add('modSplash');
  el.classList.remove('hidden', 'out'); void el.offsetWidth; el.classList.add('in');
  $('banner').classList.remove('show'); bannerT = 0;
  sound.play('cardDeal', 0.8);
  // v1.2.21 (Devin): longer on screen, then the tag keeps the full text open a few more seconds
  splashT = 5;
  const tag = $('rmodTag'); if (tag) { tag.classList.add('open'); clearTimeout(modSplash.t); modSplash.t = setTimeout(() => tag.classList.remove('open'), 14000); }
}
function setRmodTag(id) {
  const el = $('rmodTag'); if (!el) return;
  const m = ROUND_MODS[id];
  // v1.2.21: name + text; the text shows on hover (also while dead/spectating) and for a while after the splash
  el.classList.toggle('hidden', !m); if (m) { el.innerHTML = `<b>✦ ${esc(t(m.name))}</b><span>${esc(t(m.text))}</span>`; el.removeAttribute('title'); }
}
// ---- v1.2.15 kill cam: the last few seconds of views are kept; when the host says the round ended on a kill
// (roundEnd e.kc), the 2 s around the winning kill are replayed from the killer's view (v1.2.17: e.kc.v), then the round splash.
const KC = { buf: [], free: [], death: null, dur: 2000, lead: 330 };
// v1.2.31: the replay buffer reuses its copies (frames older than 3 s are refilled) instead of copying every fighter and
// bullet anew each frame: with 100 players that was ~2/3 of everything the page allocated, and the clean-ups it forced
// were the hitch every 0.25-0.5 s. kcInto copies o into d (one level deep, like a fresh copy), reusing d's objects.
function kcInto(d, o) {
  if (!d) d = {};
  for (const k in o) {
    const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      let t = d[k];
      if (!t || typeof t !== 'object' || Array.isArray(t)) t = d[k] = {};
      else for (const j in t) if (!(j in v)) delete t[j];
      for (const j in v) t[j] = v[j];
    } else d[k] = v;
  }
  return d;
}
const kcFill = (dst, src) => { for (let i = 0; i < src.length; i++) dst[i] = kcInto(dst[i], src[i]); dst.length = src.length; return dst; };
const kcView = fr => { if (!fr.players) { kcExpand(fr); const kv = tournView({ ...S.view, players: fr.players, bullets: fr.bullets }); fr.players = kv.players; fr.bullets = kv.bullets; } return fr; };   // (a packed frame, the first time the replay shows it)
const kcMode = () => duelMode() && S.matchSettings.mode !== 'brawl' && !S.matchSettings.side && settings.killCam !== false;
function kcRecord() {
  if (!kcMode() || !S.view || !S.view.players) { KC.buf.length = 0; return; }
  if (S.killCam) return;
  const now = performance.now();
  if (KC.buf.length && now - KC.buf[KC.buf.length - 1].t < 25) return;   // (v1.2.31: up to 40 a second is plenty for the replay; on a 144 Hz screen this was most of the page's garbage)
  while (KC.buf.length && now - KC.buf[0].t > 3000) KC.free.push(KC.buf.shift());
  const u = S.game && S.game.unpacker, f = KC.free.pop() || { t: 0, players: [], bullets: [] };
  f.t = now;
  if (u && u.lastView === S.view && (!S.view.bullets || u.last.bf)) { f.packed = true; kcPackInto(f, u); }   // (v1.2.31: the match runs on its own thread: viewpack.js)
  else { const kv = tournView(S.view); f.packed = false; kcFill(f.players || (f.players = []), kv.players); kcFill(f.bullets || (f.bullets = []), kv.bullets || []); }
  KC.buf.push(f);
}
// v1.2.20 (Devin): a wipe into and out of the replay so it reads apart from live play; the view switches while the band
// covers the screen (KC.wipe ms in)
KC.wipe = 230;
function kcWipe() { const el = $('kcWipe'); if (!el) return; el.classList.remove('hidden', 'go'); void el.offsetWidth; el.classList.add('go'); clearTimeout(kcWipe.t); kcWipe.t = setTimeout(() => el.classList.add('hidden'), 520); }
function kcStart() {
  const w = S.kcWait; S.kcWait = null;
  if (!w.wiped) { w.wiped = true; S.kcWait = { ...w, at: performance.now() + KC.wipe }; kcWipe(); sound.play('whoosh', 0.6); return; }
  const d = KC.death, t1 = d ? Math.min(performance.now(), d.t + KC.lead) : 0, t0 = t1 - KC.dur;
  const frames = d ? KC.buf.filter(f => f.t >= t0 && f.t <= t1 && (f.packed ? kcHas(f, w.k) : f.players.some(p => p.id === w.k))) : [];
  if (frames.length < 8) { sound.play(w.mine ? 'roundWin' : 'roundLose'); roundSplash(w.w); return; }
  S.killCam = { ...w, frames, t: 0, t0: frames[0].t, span: frames[frames.length - 1].t - frames[0].t, dt: d.t, d, popped: false };
  const el = $('killCam'), r = rosterOf(w.k), o = r.transient && r.ownerId != null ? rosterOf(r.ownerId) : r;
  el.querySelector('.kcName').innerHTML = `<b style="color:${o.color}">${esc(w.k === S.localId ? t('You') : o.name)}</b>`;
  el.classList.remove('hidden');
}
function kcFrame(dt) {
  const K = S.killCam, at = K.t0 + K.t;
  K.t += dt * 1000 * (Math.abs(at - K.dt) < 260 ? 0.4 : 1);   // slow motion around the killing hit
  let i = 0; while (i < K.frames.length - 1 && K.frames[i + 1].t <= at) i++;
  const f = K.frames[i].packed ? kcView(K.frames[i]) : K.frames[i], v = f.players.find(p => p.id === K.k);
  if (!K.popped && at >= K.dt) { K.popped = true; const r = rosterOf(K.p); renderer.burst(K.d.x, K.d.y, K.d.z, r.color, 48, 11); renderer.deathPop(K.d.x, K.d.y, K.d.z, r.color || '#fff', true); sound.play('kill', 0.9); sound.play('slowmo', 0.6); }
  // v1.2.17 (Devin): from the winner's own view: first person, over the shoulder, or the overhead view (bots: overhead)
  const rs = renderer.settings, keep = [rs.view, rs.ots, renderer.yaw, renderer.pitch], fpv = K.v === 'first' || K.v === 'shoulder';
  if (fpv && v && v.aim) { const a = v.netAim || v.aim; renderer.yaw = Math.atan2(a.x, a.z); renderer.pitch = Math.asin(Math.max(-1, Math.min(1, a.y || 0))); }
  rs.view = fpv ? 'first' : 'third'; rs.ots = K.v === 'shoulder';
  renderer.update({ ...S.view, players: f.players, bullets: f.bullets }, K.k, dt);
  [rs.view, rs.ots, renderer.yaw, renderer.pitch] = keep;
  if (K.t >= K.span) {   // hold the last frame while the wipe covers the switch back
    if (!K.endAt) { K.endAt = performance.now() + KC.wipe; kcWipe(); sound.play('whoosh', 0.5); }
    else if (performance.now() >= K.endAt) kcEnd(true);
  }
}
function kcEnd(splash) {
  const K = S && S.killCam; $('killCam').classList.add('hidden'); if (!K) return;
  S.killCam = null; KC.buf.length = 0; KC.free.length = 0;
  if (splash) { sound.play(K.mine ? 'roundWin' : 'roundLose'); roundSplash(K.w); }
}
function hideSplash() {
  const el = $('roundSplash'); if (!el || el.classList.contains('hidden')) return;
  el.classList.add('out'); splashT = 0;
  setTimeout(() => { if (el.classList.contains('out')) el.classList.add('hidden'); el.classList.remove('in', 'out', 'modSplash'); }, 260);
}
function flashHurt() { const h = $('hurt'); h.style.opacity = 1; setTimeout(() => { h.style.opacity = 0; }, 140); }

// ---------------------------------------------------------------- cosmetics
const COS_SLOTS = Object.keys(COSMETICS);
const COS_DEFAULT = k => Object.keys(COSMETICS[k])[0];   // 'none' for accessories, 'cube' for the gun
function cleanCos(c) { const o = {}; for (const k of COS_SLOTS) o[k] = c && COSMETICS[k][c[k]] ? c[k] : COS_DEFAULT(k); return o; }
function myCos() { return cleanCos(settings.cosmetics); }
function randomCos() {
  const o = {};
  for (const k of COS_SLOTS) { const keys = Object.keys(COSMETICS[k]); o[k] = Math.random() < (k === 'gun' ? 0.5 : 0.35) ? keys[1 + Math.floor(Math.random() * (keys.length - 1))] : keys[0]; }
  return o;
}
let preview = null, tryOn = null;   // tryOn: v26 a set of locked items being tried on in the shop ({ slot: id }), or null
function refreshCash() { for (const id of ['titleCash', 'cosCash']) { const el = $(id); if (el) el.textContent = fmtCash(settings.cash || 0); } }
function previewCos() { const c = myCos(); if (tryOn) Object.assign(c, tryOn); return c; }
function renderCosFields() {
  const cos = previewCos();
  $('cosFields').innerHTML = `<div class="field"><span>Preferred color <small class="hint">(you get it in the lobby whenever no other player has it; bots move off it)</small></span><div class="colorstrip" id="cosColor">${ART.ffaColors.map(c => `<button type="button" data-pref="${c}" style="background:${c}" class="${settings.color === c ? 'cur' : ''}" title="Prefer this color"></button>`).join('')}</div></div>` + COS_SLOTS.map(k => `<label class="field">${COSMETIC_LABELS[k] || k}
    <select data-cos="${k}">${Object.entries(COSMETICS[k]).map(([v, l]) => {
      const have = owns(settings, k, v);
      return `<option value="${v}"${cos[k] === v ? ' selected' : ''}>${esc(l)}${have ? '' : ` — 🔒 ${priceOf(k, v)}`}</option>`;
    }).join('')}</select></label>`).join('');
  const box = $('cosBuy');
  // v26: try on several locked items at once (build a set), buy one or all of them.
  const items = tryOn ? Object.entries(tryOn) : [];
  if (!items.length) { tryOn = null; box.classList.add('hidden'); return; }
  const cash = settings.cash || 0, total = items.reduce((s, [k, v]) => s + priceOf(k, v), 0);
  box.classList.remove('hidden');
  box.innerHTML = `<div class="hint">Trying on (not bought yet):</div>` + items.map(([k, v]) => `<div class="trow"><span><b>${esc(COSMETICS[k][v])}</b> <span class="hint">(${esc(COSMETIC_LABELS[k] || k)})</span></span>
      <span><button class="btn small" data-buyone="${k}"${cash >= priceOf(k, v) ? '' : ' disabled'}>💰 ${priceOf(k, v)}</button><button class="btn ghost small" data-dropone="${k}" title="Take it off">✕</button></span></div>`).join('') +
    `<div class="row left"><button class="btn small" id="cosBuyAll"${cash >= total ? '' : ' disabled'}>Buy all for 💰 ${total}</button><button class="btn ghost small" id="cosBuyCancel">Take all off</button></div>
    ${cash >= total ? '' : `<p class="hint">You need 💰 ${total - cash} more for the whole set. Play matches to earn cash.</p>`}`;
  const bought = ks => { for (const k of ks) { settings.cosmetics = { ...myCos(), [k]: tryOn[k] }; delete tryOn[k]; } saveSettings(settings); sound.play('coin'); refreshCash(); cosChanged(); renderCosFields(); rebuildPreview(); };
  box.querySelectorAll('[data-buyone]').forEach(b => b.onclick = () => {
    const k = b.dataset.buyone, r = buy(settings, k, tryOn[k]);
    if (!r.ok) { toast(`You need 💰 ${r.short} more`); return; }
    toast('Bought!'); bought([k]);
  });
  box.querySelectorAll('[data-dropone]').forEach(b => b.onclick = () => { delete tryOn[b.dataset.dropone]; renderCosFields(); rebuildPreview(); });
  $('cosBuyAll').onclick = () => {
    if ((settings.cash || 0) < total) { toast(`You need 💰 ${total - (settings.cash || 0)} more`); return; }
    for (const [k, v] of items) buy(settings, k, v);
    toast(`Bought ${items.length} item${items.length === 1 ? '' : 's'}!`); bought(items.map(([k]) => k));
  };
  $('cosBuyCancel').onclick = () => { tryOn = null; renderCosFields(); rebuildPreview(); };
}
// ---------------------------------------------------------------- lootboxes (v26)
// One lootbox for every match that ends normally (not when you leave or it is cancelled). Opening one shows a
// grid of spinning item icons; the spin lands on one random item you don't own yet, and it is yours.
const SLOT_ICON = { model: '🧍', gun: '🔫', hat: '🎩', face: '🥸', eyes: '🕶️', neck: '🎀', body: '👕' };
const unownedItems = () => COS_SLOTS.flatMap(k => Object.keys(COSMETICS[k]).filter(v => !owns(settings, k, v)).map(v => ({ k, v })));
function renderLootBtn() {
  const b = $('cosLoot'); if (!b) return;
  const n = settings.lootboxes || 0;
  b.textContent = `🎁 Open lootbox (${n})`; b.disabled = !n || !unownedItems().length;
  b.title = !unownedItems().length ? 'You own everything already' : n ? 'Open one for a random item you don\'t own' : 'Finish a match to earn a lootbox';
}
function openLootbox() {
  const pool = unownedItems();
  if (!(settings.lootboxes > 0) || !pool.length) return;
  const win = pool[Math.floor(Math.random() * pool.length)];
  settings.lootboxes--; settings.owned[win.k + ':' + win.v] = true; saveSettings(settings);   // saved first: closing mid-spin keeps the item
  const show = pool.slice().sort(() => Math.random() - 0.5).filter(x => x !== win).slice(0, 15);
  show.splice(Math.floor(Math.random() * (show.length + 1)), 0, win);
  const ov = $('lootOverlay');
  ov.innerHTML = `<div class="lootpanel panel"><h3>🎁 Lootbox</h3><div class="lootgrid">${show.map((x, i) => `<div class="lootcell" data-i="${i}"><span class="lico">${SLOT_ICON[x.k] || '🎁'}</span><span class="lname">${esc(COSMETICS[x.k][x.v])}</span></div>`).join('')}</div><p class="lootres hint">Spinning…</p><div class="row"><button class="btn hidden" id="lootDone">Nice!</button></div></div>`;
  ov.classList.remove('hidden'); renderLootBtn();
  const cells = [...ov.querySelectorAll('.lootcell')], target = show.indexOf(win);
  // v28: the spin ends exactly on the won item (it used to stop 6 cells past it, showing a different item)
  let i = 0, step = 0; const steps = cells.length * 2 + target;
  const tick = () => {
    cells.forEach(c => c.classList.remove('hot')); cells[i].classList.add('hot'); sound.play('ui', 0.4);
    if (step >= steps) {
      i = target; cells.forEach(c => c.classList.remove('hot')); cells[i].classList.add('hot'); cells.forEach(c => c.classList.add('stop')); cells[i].classList.add('won');
      ov.querySelector('.lootres').innerHTML = `You got <b>${esc(COSMETICS[win.k][win.v])}</b> (${esc(COSMETIC_LABELS[win.k] || win.k)})!`;
      sound.play('coin'); $('lootDone').classList.remove('hidden');
      $('lootDone').onclick = () => { ov.classList.add('hidden'); renderCosFields(); rebuildPreview(); };
      return;
    }
    step++; i = (i + 1) % cells.length;
    setTimeout(tick, 40 + Math.pow(step / steps, 3) * 220);
  };
  tick();
}
// v28: the first time the game is opened on this PC, a welcome gift of 5 lootboxes (opened in Shop & Customize).
function welcomeAward() {
  if (settings.welcomed) return;
  settings.welcomed = true; settings.lootboxes = (settings.lootboxes || 0) + 5; saveSettings(settings);
  const ov = $('lootOverlay');
  ov.innerHTML = `<div class="lootpanel panel"><h3>🎁 Welcome to Blockshot 3D!</h3><p>Here's a welcome gift: <b>5 lootboxes</b>. Each one unlocks a random item you don't own yet.</p>
    <div class="lootgrid">${'<div class="lootcell won"><span class="lico">🎁</span><span class="lname">Lootbox</span></div>'.repeat(5)}</div>
    <div class="row"><button class="btn" id="welcomeOpen">Open them now</button><button class="btn ghost" id="welcomeLater">Later</button></div></div>`;
  ov.classList.remove('hidden'); sound.play('coin');
  $('welcomeLater').onclick = () => { sound.play('ui'); ov.classList.add('hidden'); };
  $('welcomeOpen').onclick = () => { sound.play('ui'); ov.classList.add('hidden'); openCustomize(); };
}
// Your look changed: tell the lobby (other players see it).
function bindCosColor() {
  $('cosFields').addEventListener('click', e => {
    const c = e.target.dataset && e.target.dataset.pref; if (!c) return;
    sound.play('ui'); settings.color = c; saveSettings(settings);
    if (S && !S.inGame) setMyColor(c);
    for (const b of document.querySelectorAll('#cosColor [data-pref]')) b.classList.toggle('cur', b.dataset.pref === c);
    rebuildPreview();
  });
}
function cosChanged() {
  if (S && !S.inGame) {
    if (isHostSide()) { const p = S.lobby.players.find(q => q.id === S.localId); if (p) { p.cosmetics = myCos(); lobbyChanged(); } }
    else S.net.send({ t: 'toHost', msg: { k: 'setCos', cos: myCos() } });
  }
}
// v1.2.21 (Devin): customize the emote wheel and buy more emotes. Pick a wheel slot, then an emote for it.
let emoteSlotSel = 0;
function renderEmoteShop() {
  const box = $('cosEmotes'); if (!box) return;
  const slots = emoteSlots(), cash = settings.cash || 0;
  box.innerHTML = `<h3>Emote wheel <small class="hint">(hold ${esc(codeLabel(bindsOf(settings).emote[0] || 'KeyQ'))} in a match)</small></h3>
    <div class="emSlots">${slots.map((k, i) => { const m = EMOTES.find(q => q.k === k); return `<button type="button" class="emSlot${i === emoteSlotSel ? ' sel' : ''}" data-eslot="${i}" title="Slot ${i + 1}: ${esc(m.label)}"><b>${m.icon}</b><span>${esc(m.label)}</span></button>`; }).join('')}</div>
    <p class="hint">Slot ${emoteSlotSel + 1} selected. Click an emote to put it there. 📍 pings only work in team and co-op modes.</p>
    <div class="emGrid">${EMOTES.map(m => { const have = emoteOwned(m.k); return `<button type="button" class="emItem${have ? '' : ' locked'}${slots.includes(m.k) ? ' on' : ''}" data-emote="${m.k}" title="${esc(m.label)}${m.ping ? ' (team ping)' : ''}"${!have && cash < m.price ? ' data-short="1"' : ''}><b>${m.icon}</b><span>${esc(m.label)}</span>${have ? '' : `<i>💰 ${m.price}</i>`}</button>`; }).join('')}</div>
    <div class="row left"><button type="button" class="btn ghost small" id="emReset">Reset wheel</button></div>`;
  box.querySelectorAll('[data-eslot]').forEach(b => b.onclick = () => { emoteSlotSel = +b.dataset.eslot; sound.play('ui'); renderEmoteShop(); });
  box.querySelectorAll('[data-emote]').forEach(b => b.onclick = () => {
    const k = b.dataset.emote, m = EMOTES.find(q => q.k === k);
    if (!emoteOwned(k)) {
      if ((settings.cash || 0) < m.price) { toast(`You need 💰 ${m.price - (settings.cash || 0)} more`); return; }
      settings.cash -= m.price; settings.owned ||= {}; settings.owned['emote:' + k] = true; sound.play('coin'); refreshCash(); toast(`Bought ${m.icon} ${m.label}!`);
    }
    const a = emoteSlots(), j = a.indexOf(k);
    if (j >= 0 && j !== emoteSlotSel) a[j] = a[emoteSlotSel];   // already on the wheel: swap the two
    a[emoteSlotSel] = k; settings.emoteSlots = a; saveSettings(settings);
    emoteSlotSel = (emoteSlotSel + 1) % a.length; renderEmoteShop();
  });
  $('emReset').onclick = () => { settings.emoteSlots = null; saveSettings(settings); renderEmoteShop(); };
}
function openCustomize() {
  tryOn = null;
  renderCosFields(); renderEmoteShop();
  refreshCash();
  show('customize');
  if (!preview) {
    const canvas = $('cosPreview'), r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(260, 300, false);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 260 / 300, 0.1, 50);
    cam.position.set(0, 1.35, 4.2); cam.lookAt(0, 0.95, 0);
    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a4256, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(2, 4, 3); scene.add(sun);
    preview = { r, scene, cam, holder: new THREE.Group(), drag: null };
    scene.add(preview.holder);
    preview.holder.rotation.y = -0.5;   // a three-quarter view so the gun shows
    // Stationary by default; the Spin button turns it on. Dragging turns the model by hand.
    canvas.addEventListener('pointerdown', e => { preview.drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if (preview.drag == null) return; preview.holder.rotation.y += (e.clientX - preview.drag) * 0.012; preview.drag = e.clientX; });
    canvas.addEventListener('pointerup', () => { preview.drag = null; });
    const spin = () => { if (currentScreen === 'customize') { if (settings.previewSpin && preview.drag == null) preview.holder.rotation.y += 0.012; if (preview.model) preview.model.animate(performance.now() / 1000, 0); preview.r.render(preview.scene, preview.cam); } requestAnimationFrame(spin); };
    spin();
  }
  $('cosSpin').textContent = settings.previewSpin ? 'Spin: on' : 'Spin: off';
  rebuildPreview();
}
function rebuildPreview() {
  if (!preview) return;
  preview.holder.clear();
  const c = previewCos(), m = buildPlayerModel(settings.color || ART.ffaColors[0], c.gun, c.model);
  attachCosmetics(m, c);   // v26: characters you haven't bought show in full color too (no silhouette)
  preview.holder.add(m.root); preview.model = m;
  renderLootBtn();
}

// ---------------------------------------------------------------- combo discovery
const DISC_KEY = 'blockshot3d.combos';
let discovered = new Set(); try { discovered = new Set(JSON.parse(localStorage.getItem(DISC_KEY) || '[]')); } catch { /* storage blocked */ }
function discover(id) { if (!id || discovered.has(id)) return; discovered.add(id); try { localStorage.setItem(DISC_KEY, JSON.stringify([...discovered])); } catch { /* ignore */ } }

// ---------------------------------------------------------------- cards UI
function cardEl(c, { index, button, folder, exact } = {}) {
  const el = document.createElement(button ? 'button' : 'div');
  el.className = 'card' + (['cursed', 'combo', 'holy', 'mod', 'shieldmod'].includes(c.rarity) ? ' ' + c.rarity : '');
  el.dataset.noi18n = '';   // card text comes from card.json
  el.style.setProperty('--tilt', ((Math.random() - 0.5) * 6).toFixed(1) + 'deg');
  const rk = rarityOf(c), r = RARITY[rk];
  if (rk !== 'common') el.style.borderColor = r.color;
  el.innerHTML =
    (index != null ? `<span class="ck">${index + 1}</span>` : '') +
    `<span class="rar" style="color:${r.color}">${r.label}</span><div class="art"></div>` +
    `<h4>${esc(slopCardName(c.name))}</h4><p>${esc(slopTypos(c.description || ''))}</p>` + (slopOn() ? `<span class="slopbadge">${esc(slopBadge())}</span>` : '') +
    `<ul>${cardLines(c, { exact }).map(([t, l, g, k]) => `<li class="${g ? 'up' : 'down'}"${k ? ` data-stat="${esc(k)}"` : ''}><b>${esc(t)}</b>${esc(l)}</li>`).join('')}</ul>` +
    (folder && c.folder ? `<div class="folder">cards/${esc(c.folder)}</div>` : '');
  const art = el.querySelector('.art');
  if (c.imageUrl) {
    const img = new Image(); img.alt = ''; img.src = c.imageUrl;
    img.onerror = () => { art.textContent = c.icon || '★'; };
    art.appendChild(img);
  } else art.textContent = c.icon || '★';
  el._card = c;
  if (button || folder) el.title = '';
  return el;
}

// ---------------------------------------------------------------- card detail window (right-click a card)
// Brings a card to the front with plain-language notes. Stat lines get themed hover tooltips (STAT_TIPS in cardinfo.js).
// Longer "how it works" text comes from "details" in card.json, so any card can add an explanation later.
const cardDetailOpen = () => !$('cardDetail').classList.contains('hidden');
function openCardDetail(c) {
  const box = $('cdCard'); box.innerHTML = ''; box.classList.remove('fcards');
  const big = cardEl(c, { exact: true }); big.classList.add('big'); box.appendChild(big);
  const sec = (title, body, cls = '') => `<section class="${cls}"><h5>${esc(title)}</h5>${body}</section>`;
  const parts = [];
  parts.push(`<h3 data-noi18n>${esc(c.name)}</h3>`);
  const boost = boostChips(c); if (boost) parts.push(boost);
  if (c.details) parts.push(sec('How it works', `<p data-noi18n>${esc(c.details)}</p>`));
  const note = TYPE_NOTES[c.rarity] || (c.weaponMod ? TYPE_NOTES.mod : c.shieldMod ? TYPE_NOTES.shieldmod : '');
  if (note) parts.push(sec(RARITY[rarityOf(c)].label, `<p>${esc(note)}</p>`, 'type ' + c.rarity));
  const base = c.holyFrom || c.cursedFrom;
  if (base && cardById.get(base)) {
    const b = cardById.get(base);
    parts.push(sec('Original card', `<p data-noi18n>${c.holyFrom ? 'Blessed' : 'Cursed'} version of <b>${esc(b.name)}</b>.</p>`));
  }
  if (c.combo) {
    const [a, b2] = c.combo.map(id => (cardById.get(id) || { name: id }).name);
    parts.push(sec('Made from', `<p data-noi18n>${esc(a)} + ${esc(b2)}</p>`));
  }
  if (!c.holyFrom && !c.cursedFrom && !c.weaponMod && !c.shieldMod && !['combo', 'holy', 'cursed', 'mod', 'shieldmod'].includes(c.rarity) && !c.special) {
    const v = [cardById.has('holy-' + c.id) && 'a Holy', cardById.has('cursed-' + c.id) && 'a Cursed'].filter(Boolean);
    if (v.length) parts.push(sec('Variants', `<p>This card also has ${v.join(' and ')} version.</p>`));
  }
  const lines = cardLines(c, { exact: true }).filter(l => l[3] && tipFor(l[3]));
  if (lines.length) parts.push(sec('Stats on this card', `<ul class="cdstats">${lines.map(([v, l, g, k]) => `<li class="${g ? 'up' : 'down'}" data-stat="${esc(k)}"><b><em class="cdval">${esc(v)}</em> ${esc((STAT_INFO[k] || { label: l }).label)}</b><span>${esc(tipFor(k))}</span></li>`).join('')}</ul>`));
  const syn = synergyHtml(c); if (syn) parts.push(sec('Stacking & synergy', syn, 'syn'));
  $('cdInfo').innerHTML = parts.join('');
  $('cardDetail').classList.remove('hidden');
  sound.play('ui');
}
// v1.2.20 (Devin): how this card's stats stack and get amplified, and what they amplify (cardinfo.js STAT_AMP / MOD_AMP,
// partner stats from synergy.js PAIRS, plus the other cards that raise those partners and any combos it is part of)
// v1.2.21 (Devin): highlighted chips for the stats that make this card stronger (cardinfo.js BOOSTED_BY), plus whether you have them
function boostChips(c) {
  const base = cardById.get(c.holyFrom || c.cursedFrom) || c, keys = new Set();
  const mk = base.weaponMod || base.shieldMod;
  if (mk && BOOSTED_BY[mk]) BOOSTED_BY[mk].forEach(k => keys.add(k));
  for (const k of cardEffects(c).up) (BOOSTED_BY[k] || []).forEach(x => keys.add(x));
  const list = [...keys].filter(k => STAT_INFO[k]).slice(0, 8);
  if (!list.length) return '';
  return `<div class="cdboost"><span>⬆ ${esc(t('Boosted by'))}</span>${list.map(k => `<b data-stat="${esc(k)}">${esc(STAT_INFO[k].label)}</b>`).join('')}</div>`;
}
function synergyHtml(c) {
  const out = [], lab = k => (STAT_INFO[k] || { label: k }).label, base = cardById.get(c.holyFrom || c.cursedFrom) || c;
  const mk = base.weaponMod || base.shieldMod || base.special;
  if (mk && MOD_AMP[mk]) out.push(`<p>${esc(MOD_AMP[mk])}</p>`);
  const rules = [];
  for (const m of c.modifiers || []) {
    if (!STAT_INFO[m.stat]) continue;
    const L = lab(m.stat);
    if (m.op === 'mul') rules.push(`<b>${esc(L)} x${+m.value.toFixed(2)}</b>: multiplies, so it stacks with other ${esc(L)} cards (two copies = x${+(m.value * m.value).toFixed(2)}) and scales any flat bonus you already have.`);
    else if (m.op === 'add') rules.push(`<b>${esc(L)} ${m.value > 0 ? '+' : ''}${+m.value.toFixed(2)}</b>: adds up with every other ${esc(L)} card.`);
    else if (m.op === 'set') rules.push(`<b>${esc(L)}</b>: reset to ${m.value} when you take it; later cards still change it.`);
    else if (m.op === 'convert') rules.push(`<b>${esc(L)} into ${esc(lab(m.to))}</b>: trades one for the other in proportion.`);
  }
  if (rules.length) out.push(`<ul class="cdsyn">${rules.map(r => `<li>${r}</li>`).join('')}</ul>`);
  const { up } = cardEffects(c);
  for (const k of up) {
    const a = STAT_AMP[k], partners = PAIRS.filter(p => p[2] >= 1 && (p[0] === k || p[1] === k)).map(p => p[0] === k ? p[1] : p[0]);
    const helpers = [...new Set(CARDS.filter(o => o.id !== c.id && !o.holyFrom && !o.cursedFrom && o.rarity !== 'combo' && [...cardEffects(o).up].some(x => partners.includes(x))).map(o => o.name))].slice(0, 6);
    const bits = [];
    if (a && a.by) bits.push(`<i>Amplified by:</i> ${esc(a.by)}`);
    if (a && a.amps) bits.push(`<i>Amplifies:</i> ${esc(a.amps)}`);
    if (partners.length) bits.push(`<i>Pairs well with:</i> ${esc([...new Set(partners.map(lab))].slice(0, 6).join(', '))}${helpers.length ? ` (cards like ${esc(helpers.join(', '))})` : ''}.`);
    if (bits.length) out.push(`<div class="cdamp"><h6>${esc(lab(k))}</h6><p>${bits.join('<br>')}</p></div>`);
  }
  const combos = CARDS.filter(o => Array.isArray(o.combo) && !o.holyFrom && !o.cursedFrom && o.combo.includes(base.id));
  for (const o of combos) { const other = cardById.get(o.combo.find(x => x !== base.id) || base.id); out.push(`<p><i>Combo:</i> with <b>${esc(other ? other.name : '?')}</b> it merges into <b>${esc(o.name)}</b>.</p>`); }
  return out.join('');
}
function closeCardDetail() { $('cardDetail').classList.add('hidden'); $('statTip').classList.add('hidden'); }
function bindCardDetail() {
  $('cardDetail').addEventListener('click', e => { if (e.target === $('cardDetail') || e.target.classList.contains('cdbox')) closeCardDetail(); });
  // Themed stat tooltips anywhere inside the detail window
  const tipEl = $('statTip');
  $('cardDetail').addEventListener('mouseover', e => {
    const li = e.target.closest && e.target.closest('#cdCard li[data-stat]');
    if (!li) { tipEl.classList.add('hidden'); return; }
    const k = li.dataset.stat, tip = tipFor(k);
    if (!tip) { tipEl.classList.add('hidden'); return; }
    tipEl.innerHTML = `<h5>${esc((STAT_INFO[k] || { label: k }).label)}</h5><p>${esc(tip)}</p>`;
    tipEl.classList.remove('hidden');
    const r = li.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = r.right + 12, y = r.top + r.height / 2 - h / 2;
    if (x + w > innerWidth - 8) x = r.left - w - 12;
    tipEl.style.left = Math.max(8, x) + 'px'; tipEl.style.top = Math.max(8, Math.min(innerHeight - h - 8, y)) + 'px';
  });
  $('cardDetail').addEventListener('mouseleave', () => tipEl.classList.add('hidden'));
}

async function refreshCards() {
  try {
    const r = await loadCards();
    CARDS = r.cards; CARD_ERRORS = r.errors;
  } catch (e) {
    CARDS = []; CARD_ERRORS = [{ folder: '(server)', error: 'Could not load cards. Is the server running?' }];
  }
  cardById = new Map(CARDS.map(c => [c.id, c]));
}

let dirFilter = 'all';
function renderDirectory() {
  const counts = { all: CARDS.length };
  for (const c of CARDS) counts[c.rarity] = (counts[c.rarity] || 0) + 1;
  $('rarityFilter').innerHTML = ['all', ...Object.keys(RARITY)].map(k =>
    `<button class="btn ghost small${dirFilter === k ? ' sel' : ''}" data-f="${k}" style="${dirFilter === k ? 'border-color:var(--fg)' : ''}">${k === 'all' ? 'All' : RARITY[k].label} (${counts[k] || 0})</button>`).join('');
  const order = Object.keys(RARITY);
  const hiddenCombos = CARDS.filter(c => c.rarity === 'combo' && !discovered.has(c.id)).length;
  const list = CARDS.filter(c => (dirFilter === 'all' || c.rarity === dirFilter) && !(c.rarity === 'combo' && !discovered.has(c.id)))
    .sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.name.localeCompare(b.name));
  const grid = $('cardGrid'); grid.innerHTML = '';
  if (!list.length) grid.innerHTML = '<p>No cards here yet. Create one, or add a folder to cards/ and press Reload cards.</p>';
  for (const c of list) grid.appendChild(cardEl(c, { folder: true }));
  if (hiddenCombos && (dirFilter === 'all' || dirFilter === 'combo')) {
    const ph = document.createElement('div'); ph.className = 'card combo';
    ph.innerHTML = `<div class="art">❔</div><h4>${hiddenCombos} undiscovered combo${hiddenCombos === 1 ? '' : 's'}</h4><p>Own both cards of a combo pair during a match to reveal it.</p>`;
    grid.appendChild(ph);
  }
  $('cardErrors').innerHTML = CARD_ERRORS.map(e => `<div class="cardErr">cards/${esc(e.folder)} was skipped: ${esc(e.error)}</div>`).join('');
  $('statList').textContent = Object.keys(STAT_INFO).join(', ');
  const tot = CARDS.filter(c => c.rarity !== 'combo').reduce((a, c) => a + cardWeight(c), 0) || 1;
  $('rarityOdds').textContent = 'Chance each offered card is of a rarity, with the current cards: ' + Object.entries(RARITY).map(([k, r]) => {
    const w = CARDS.filter(c => c.rarity === k).reduce((a, c) => a + cardWeight(c), 0);
    return `${r.label} ${(w / tot * 100).toFixed(w / tot < 0.1 ? 1 : 0)}%`;
  }).join(', ') + '. Weights are in RARITY in config.js.';
}

// ---------------------------------------------------------------- card creator
const creator = { mods: [], idTouched: false, imageData: null, imageExt: null };
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
function openCreator() {
  creator.mods = [{ stat: 'damage', op: 'mul', value: 1.25 }];
  creator.idTouched = false; creator.imageData = null; creator.imageExt = null;
  $('cName').value = 'New Card'; $('cId').value = 'new-card'; $('cRarity').value = 'common'; $('cIcon').value = '⭐';
  $('cDesc').value = ''; $('cImage').value = ''; $('cError').textContent = '';
  if (!serverInfo.canSaveCards) $('cError').textContent = 'Saving only works on the computer running the server. You can still download card.json.';
  renderMods(); updatePreview(); show('creator');
}
function renderMods() {
  const opts = Object.entries(STAT_INFO).map(([k, v]) => `<option value="${k}">${esc(v.label)} (${k})</option>`).join('');
  $('cMods').innerHTML = creator.mods.map((m, i) => `<div class="modrow" data-i="${i}">
    <select data-k="stat">${opts}</select>
    <select data-k="op"><option value="mul">×</option><option value="add">+</option></select>
    <input data-k="value" type="number" step="0.05">
    <button data-del="${i}" aria-label="Remove">✕</button></div>`).join('');
  [...$('cMods').children].forEach((row, i) => {
    row.querySelector('[data-k=stat]').value = creator.mods[i].stat;
    row.querySelector('[data-k=op]').value = creator.mods[i].op;
    row.querySelector('[data-k=value]').value = creator.mods[i].value;
  });
}
function buildCard() {
  const c = {
    id: $('cId').value.trim(), name: $('cName').value.trim(), rarity: $('cRarity').value,
    icon: $('cIcon').value.trim() || '⭐', description: $('cDesc').value.trim(),
    modifiers: creator.mods.map(m => ({ stat: m.stat, op: m.op, value: parseFloat(m.value) })),
  };
  if (creator.imageExt) c.image = 'art.' + creator.imageExt;
  return c;
}
function updatePreview() {
  const c = buildCard();
  const errs = validateCard(c);
  $('cPreview').innerHTML = '';
  $('cPreview').appendChild(cardEl({ ...c, imageUrl: creator.imageData }));
  $('cError').textContent = errs.join('; ') || (serverInfo.canSaveCards ? '' : 'Saving only works on the computer running the server. You can still download card.json.');
  $('cSave').disabled = errs.length > 0 || !serverInfo.canSaveCards;
}
async function saveCreatedCard() {
  const card = buildCard();
  if (validateCard(card).length) return;
  const body = { card };
  if (creator.imageData) body.image = { data: creator.imageData.split(',')[1], ext: creator.imageExt };
  try {
    const res = await fetch('/api/cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json();
    if (!res.ok) { $('cError').textContent = out.error || 'Could not save the card.'; return; }
    toast(`Saved to ${out.folder}`);
    await refreshCards(); renderDirectory(); show('directory');
  } catch { $('cError').textContent = 'Could not reach the server.'; }
}

// ---------------------------------------------------------------- input
const keys = {};
let BINDS = bindsOf(settings);
const held = a => BINDS[a].some(c => c && keys[c]);
const bound = (a, code) => !!code && BINDS[a].includes(code);
function releaseMouse() { for (const k in keys) if (k.startsWith('Mouse')) keys[k] = false; }
const I = { blockSeq: 0, reloadSeq: 0, useSeq: 0, jumpSeq: 0, shotSeq: 0, ready: 0, rot: 0 };   // (v1.2.6: jump / shot presses counted too, so a quick tap can't get lost)
let lastPauseAt = 0;
let altFree = false; // first person: Alt frees the cursor without pausing
const locked = () => document.pointerLockElement === renderer.canvas;
const inPlay = () => S && S.inGame && currentScreen === 'none';
// v1.2.11: you're out and watching the overhead camera (not the open world's free camera, the 2D view or AMON):
// move keys / dragging pan it, the scroll wheel zooms, Jump goes back to following the fight.
const spectating = () => {
  if (!inPlay() || S.amon || S.rts || !S.view || S.matchSettings.mode === 'open' || S.matchSettings.side) return false;
  if (S.matchSettings.commander && ['play', 'roundEnd', 'countdown'].includes(S.view.phase)) return true;   // v1.2.26 (Devin): commander mode pans like spectating
  const me = S.view.players.find(p => p.id === S.localId);
  return !!me && !me.alive && (S.view.phase === 'play' || S.view.phase === 'roundEnd');
};

// Actions that fire once per press (keyboard or mouse button), using the player's bindings.
function pressAction(code, e) {
  if ((code === 'Enter' || code === 'NumpadEnter') && TI && S && S.inGame) { tournReady(); return; }   // v1.2.28 tournament matchup screen (v1.2.29: works from any menu)
  if (bound('netstats', code) && S && S.inGame && S.role !== 'solo') { netWinOpen = !netWinOpen; renderNetHud(true); }
  if (bound('netlog', code)) { if (e) e.preventDefault(); toggleNetLog(); }   // v1.2.10: record network logs to a file
  if (S && S.rts) return;   // v1.2.27: the RTS has its own keys (rtsui.js)
  if (bound('practice', code) && S && S.inGame && S.matchSettings.mode === 'practice' && currentScreen === 'none') openPracticePanel($('practice').classList.contains('hidden'));
  if (bound('cursor', code) && S && S.inGame) {
    if (e) e.preventDefault();
    if (settings.view === 'first' && locked()) { altFree = true; releaseMouse(); document.exitPointerLock(); }
  }
  if (bound('emote', code) && inPlay() && !EW.open) { if (e && e.preventDefault) e.preventDefault(); openWheel(); }
  if (inPlay()) {
    if (bound('reload', code)) I.reloadSeq++;
    if (bound('block', code)) I.blockSeq++;
    if (bound('use', code)) { I.useSeq++; if (S.tn && spectating() && tournWatchNext()) { toast(t('Watching arena {n}', { n: S.tWatch + 1 })); tvCache = null; } }   // v1.2.26 tournament: watch another arena
    const side = S.matchSettings.side;   // (2D: up also jumps; down + jump drops through instead)
    if ((bound('jump', code) && !(side && held('down'))) || (side && !S.matchSettings.brawl && bound('up', code))) I.jumpSeq++;   // (v1.2.13: not in Brawl)
    if (bound('shoot', code) && (settings.view !== 'first' || locked())) I.shotSeq++;
    // v28 Core Defense: Enter readies you for the next wave (press again to unready)
    if ((code === 'Enter' || code === 'NumpadEnter') && S.matchSettings.core && S.view && S.view.phase === 'countdown') {
      I.ready = I.ready === S.view.round ? 0 : S.view.round;
      toast(I.ready ? 'Ready! The wave starts when everyone is ready.' : 'Not ready');
      sound.play('ui');
    }
  }
  if (bound('view', code) && !(e && e.altKey)) {   // (v1.2.16: not Alt+Tab)
    if (e) e.preventDefault();
    if (S && (S.amon || S.rts)) return;   // AMON: Tab holds the leaderboard (amonui.js)
    if (S && S.inGame && S.matchSettings.mode === 'open' && currentScreen === 'none') {   // open world: always mouse-look; Tab picks the camera
      const meP = S.view && S.view.players.find(p => p.id === S.localId);
      if (meP && !meP.alive) { renderer.owSpecFollow = !renderer.owSpecFollow; renderer.owFly = null; toast(renderer.owSpecFollow ? 'Following a player' : 'Free camera: move keys fly, jump / crouch go up / down'); }   // out: free fly or follow
      else { renderer.owThird = !renderer.owThird; toast(renderer.owThird ? 'Third person' : 'First person'); }
    } else if (S && S.inGame && !S.matchSettings.commander && !S.matchSettings.side && currentScreen === 'none') {
      const nxt = { third: 'first', first: 'shoulder', shoulder: 'third' }[viewChoice()];   // v1.0.1: Tab cycles three views
      setViewChoice(nxt); $('sView').value = nxt;
      if (settings.view === 'third' && document.pointerLockElement) { altFree = true; document.exitPointerLock(); }
      toast(nxt === 'first' ? 'First person' : nxt === 'shoulder' ? 'Over the shoulder' : 'Third person (top-down)');
    }
  }
}
function viewChoice() { return settings.view === 'first' ? (settings.ots ? 'shoulder' : 'first') : 'third'; }
function setViewChoice(v) { settings.view = v === 'third' ? 'third' : 'first'; settings.ots = v === 'shoulder'; applySettings(); }
// Escape outside a match: back one menu (or out of the card detail window).
function menuBack() {
  const back = { browser: '#browser [data-go=title]', directory: '#directory [data-go=gallery]', creator: '#creator [data-go=directory]',
    customize: '#customize [data-go=title]', settings: '#settingsBack', lobby: '#leaveLobby', gallery: '#gallery [data-go=title]' }[currentScreen];
  const b = back && document.querySelector(back);
  if (b) b.click();
}

// ---- v1.2.15 emote and ping wheel: hold the key, move the mouse toward a slot, let go. Emotes show over your head
// for everyone; pings mark the spot you were aiming at for your team (team and co-op modes only).
// v1.2.21 (Devin): the wheel is customizable (Shop & Customize > Emote wheel: settings.emoteSlots, 8 slots) and the
// shop sells more emotes (price > 0: bought with cash, saved as settings.owned['emote:<k>']). Pings stay team/co-op only.
const EMOTES = [
  { k: 'laugh', icon: '😂', label: 'Ha ha' }, { k: 'cool', icon: '😎', label: 'Too easy' },
  { k: 'here', icon: '📍', label: 'Look here', ping: 1 }, { k: 'attack', icon: '⚔️', label: 'Attack here', ping: 1 },
  { k: 'help', icon: '🆘', label: 'Help me', ping: 1 }, { k: 'danger', icon: '⚠️', label: 'Careful', ping: 1 },
  { k: 'gg', icon: '👋', label: 'GG' }, { k: 'angry', icon: '😡', label: 'Grr' },
  { k: 'defend', icon: '🛡️', label: 'Defend here', ping: 1 }, { k: 'loot', icon: '💎', label: 'Loot here', ping: 1 },
  { k: 'thanks', icon: '🙏', label: 'Thanks', price: 60 }, { k: 'sorry', icon: '😅', label: 'Oops', price: 60 },
  { k: 'wow', icon: '😮', label: 'Wow', price: 60 }, { k: 'cry', icon: '😭', label: 'Why...', price: 80 },
  { k: 'think', icon: '🤔', label: 'Hmm', price: 80 }, { k: 'skull', icon: '💀', label: 'Dead', price: 100 },
  { k: 'fire', icon: '🔥', label: 'On fire', price: 100 }, { k: 'clap', icon: '👏', label: 'Nice one', price: 100 },
  { k: 'love', icon: '❤️', label: 'Love it', price: 120 }, { k: 'sleep', icon: '😴', label: 'Boring', price: 120 },
  { k: 'clown', icon: '🤡', label: 'Clown', price: 150 }, { k: 'salt', icon: '🧂', label: 'Salty', price: 150 },
  { k: 'eyes', icon: '👀', label: 'I see you', price: 150 }, { k: 'muscle', icon: '💪', label: 'Strong', price: 150 },
  { k: 'trophy', icon: '🏆', label: 'Champion', price: 250 }, { k: 'crown', icon: '👑', label: 'King', price: 300 },
  { k: 'ghost', icon: '👻', label: 'Boo', price: 200 }, { k: 'rage', icon: '🤬', label: 'RAGE', price: 200 },
  { k: 'party', icon: '🎉', label: 'Party', price: 200 }, { k: 'goat', icon: '🐐', label: 'GOAT', price: 350 },
  { k: 'brain', icon: '🧠', label: 'Big brain', price: 300 }, { k: 'popcorn', icon: '🍿', label: 'Watching', price: 250 },
  { k: 'dance', icon: '🕺', label: 'Dance', price: 400 }, { k: 'rocket', icon: '🚀', label: 'To the moon', price: 300 },
  { k: 'bee', icon: '🐝', label: 'Bzzz', price: 250 }, { k: 'squid', icon: '🦑', label: 'Nom', price: 250 },
  { k: 'bomb', icon: '💣', label: 'Boom', price: 250 }, { k: 'shield', icon: '🔰', label: 'Blocked', price: 200 },
];
const EMOTE_DEFAULT = ['laugh', 'cool', 'here', 'attack', 'help', 'danger', 'gg', 'angry'];
const emoteOwned = k => { const m = EMOTES.find(q => q.k === k); return !!m && (!m.price || !!(settings.owned && settings.owned['emote:' + k])); };
function emoteSlots() {
  const a = Array.isArray(settings.emoteSlots) ? settings.emoteSlots : [];
  return EMOTE_DEFAULT.map((d, i) => emoteOwned(a[i]) ? a[i] : d);
}
let wheelList = [];   // the 8 emotes on the wheel right now
const EW = { open: false, dx: 0, dy: 0, sel: -1, at: null, last: 0 };
const teamPings = () => !!S && (['tdm', 'waves', 'core'].includes(S.matchSettings.mode) || (S.matchSettings.mode === 'open' && (S.matchSettings.owType === 'extract' || owSquads(S.matchSettings))));
function buildWheel() {
  const el = $('emoteWheel'), list = emoteSlots().map(k => EMOTES.find(q => q.k === k));
  if (el.childElementCount && list.every((m, i) => wheelList[i] === m)) return;
  el.innerHTML = ''; wheelList = list;
  list.forEach((m, i) => {
    const a = i / list.length * Math.PI * 2, d = document.createElement('div');
    d.className = 'ewSlot' + (m.ping ? ' ping' : ''); d.style.left = `calc(50% + ${Math.sin(a) * 105}px)`; d.style.top = `calc(50% - ${Math.cos(a) * 105}px)`;
    d.innerHTML = `<b>${m.icon}</b><span>${m.label}</span>`; el.appendChild(d);
  });
  const c = document.createElement('div'); c.className = 'ewCenter'; el.appendChild(c);
}
function openWheel() {
  if (!S || !S.inGame || S.amon || S.rts || S.killCam) return;
  buildWheel(); EW.open = true; EW.dx = EW.dy = 0; EW.sel = -1; EW.at = S.lastAimPt ? { ...S.lastAimPt } : null;
  renderer.lookFreeze = true;
  const pings = teamPings();
  [...$('emoteWheel').querySelectorAll('.ewSlot')].forEach((d, i) => { d.classList.toggle('off', !!wheelList[i].ping && (!pings || !EW.at || spectating())); d.classList.remove('sel'); });
  $('emoteWheel').querySelector('.ewCenter').textContent = pings ? t('Emote or ping') : t('Emote');
  $('emoteWheel').classList.remove('hidden');
}
function wheelMove(e) {
  if (!EW.open) return;
  EW.dx += e.movementX || 0; EW.dy += e.movementY || 0;
  const L = Math.hypot(EW.dx, EW.dy); if (L > 120) { EW.dx *= 120 / L; EW.dy *= 120 / L; }
  let sel = -1;
  if (L > 22) { const a = (Math.atan2(EW.dx, -EW.dy) + Math.PI * 2) % (Math.PI * 2); sel = Math.round(a / (Math.PI * 2 / wheelList.length)) % wheelList.length; }
  const slots = $('emoteWheel').querySelectorAll('.ewSlot');
  if (sel >= 0 && slots[sel].classList.contains('off')) sel = -1;
  if (sel !== EW.sel) { EW.sel = sel; slots.forEach((d, i) => d.classList.toggle('sel', i === sel)); if (sel >= 0) sound.play('cardHover', 0.4); }
}
function closeWheel(send) {
  if (!EW.open) return;
  EW.open = false; renderer.lookFreeze = false; $('emoteWheel').classList.add('hidden');
  const m = wheelList[EW.sel]; if (!send || !m || !S || !S.inGame) return;
  const now = performance.now(); if (now - EW.last < 700) return; EW.last = now;
  const msg = { k: 'emote', e: m.k, ...(m.ping && EW.at ? { x: +EW.at.x.toFixed(2), y: +EW.at.y.toFixed(2), z: +EW.at.z.toFixed(2) } : {}) };
  if (S.role === 'peer') S.net.send({ t: 'toHost', msg }); else emoteFrom(S.localId, msg);
}
// Host: check it and pass it on to everyone (with the match events, like bets)
function emoteFrom(from, msg) {
  const m = EMOTES.find(q => q.k === msg.e); if (!m || !S.inGame) return;
  S.emoteT ||= new Map(); const now = performance.now(); if (now - (S.emoteT.get(from) || 0) < 600) return; S.emoteT.set(from, now);
  const ev = { t: 'emote', p: from, e: m.k };
  if (m.ping) { if (![msg.x, msg.y, msg.z].every(Number.isFinite)) return; ev.x = msg.x; ev.y = msg.y; ev.z = msg.z; }
  if (S.role === 'host') hostEv(ev);
  handleEvent(ev);
}
function emoteEvent(e) {
  const m = EMOTES.find(q => q.k === e.e); if (!m) return;
  const r = rosterOf(e.p);
  if (!m.ping) {
    // v1.2.21 (Devin): spectators (out of the round) can emote too; theirs show in the kill feed area for everyone
    const pv = S.view && S.view.players.find(p => p.id === e.p);
    if (pv && !pv.alive) emoteFeed(e.p, m); else renderer.emote(e.p, m.icon);
    if (e.p !== S.localId) sound.play('pip', 0.35); return;
  }
  if (!friendOf(e.p) || !teamPings()) return;
  renderer.ping(e.x, e.y, e.z, r.color || '#ffffff', m.icon); sound.play('pip', 0.7);
  if (e.p !== S.localId) toast(`${r.name}: ${t(m.label)}`);
}

function bindInput() {
  addEventListener('keydown', e => {
    if (bindCapture) return;   // the controls screen is waiting for a key (handled there)
    if (e.code === 'Escape' && cardDetailOpen()) { e.preventDefault(); closeCardDetail(); lastPauseAt = performance.now(); return; }
    if (e.code === 'Escape' && peekPinned) { closePeek(); return; }
    // typing in a text box (practice search, names) never moves you or fires shortcuts
    if (e.target && e.target.matches && e.target.matches('input[type=text], input:not([type]), textarea') && e.code !== 'Escape') return;
    keys[e.code] = true;
    if (e.code === 'Tab') e.preventDefault();
    if (S && S.inGame && (e.code === 'Space' || e.code.startsWith('Arrow') || ['up', 'down', 'left', 'right', 'jump', 'dash'].some(a => bound(a, e.code)))) e.preventDefault();
    if (!e.repeat) pressAction(e.code, e);
    if (e.code === 'Escape' && S && S.inGame) { if (performance.now() - lastPauseAt > 250) togglePause(); }
    else if (e.code === 'Escape' && !e.repeat) menuBack();
    // v1.0.8: the card stats window only opens on B (toggle), so it never sits over the cards
    if (e.code === 'KeyB' && !e.repeat && S && S.inGame && S.matchSettings.mode !== 'amon' && S.view && S.view.phase === 'picking') { S.statsOpen = !S.statsOpen; statsKey = ''; }
    if (currentScreen === 'pick' && /^Digit[1-5]$/.test(e.code)) choosePick(+e.code.slice(5) - 1);
    else if (inPlay() && S.lootOffer && /^Digit[1-4]$/.test(e.code)) chooseLoot(e.code === 'Digit4' ? -1 : +e.code.slice(5) - 1);
  });
  addEventListener('keyup', e => { keys[e.code] = false; if (EW.open && !held('emote')) closeWheel(true); });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; peerNeutral(); closeWheel(false); });
  // v1.2.6: a hidden or minimized window stops drawing frames, so a joiner's "all keys up" would never be sent: send it now
  document.addEventListener('visibilitychange', () => { if (document.hidden) { for (const k in keys) keys[k] = false; peerNeutral(); } else renderer.checkGL(); });
  addEventListener('focus', () => renderer.checkGL());   // v1.2.16: back from alt+tab: make sure the picture is still being drawn
  if (window.steamBridge && window.steamBridge.onRefocus) window.steamBridge.onRefocus(() => renderer.checkGL());
  renderer.canvas.addEventListener('mousedown', e => {
    if (!inPlay()) return;
    if (settings.view === 'first' && !locked() && !S.amon && !S.rts && !spectating()) { altFree = false; renderer.canvas.requestPointerLock(); return; }   // (AMON: the mouse runs the store, never locked)
    keys['Mouse' + e.button] = true;
    pressAction('Mouse' + e.button, e);
  });
  addEventListener('mouseup', e => { keys['Mouse' + e.button] = false; if (EW.open && !held('emote')) closeWheel(true); });
  document.addEventListener('mousemove', wheelMove);
  addEventListener('mousemove', e => { if ((e.buttons & 5) && spectating()) renderer.specDrag(e.movementX || 0, e.movementY || 0); });   // v1.2.11: drag to pan
  addEventListener('wheel', e => {
    if (!e.deltaY) return;
    if (spectating()) { renderer.specZoom(e.deltaY); return; }   // v1.2.11: scroll to zoom
    // v1.2.13 (Devin): the scroll wheel zooms the top-down view while you play too, and further out than the default
    if (!inPlay() || S.amon || S.rts || currentScreen !== 'none' || S.matchSettings.mode === 'open' || S.matchSettings.side || settings.view === 'first' || S.matchSettings.commander) return;
    const co = S.matchSettings.core && S.view && S.view.core;
    if (co && co.cr && co.cr.some(r => r[0] === S.localId)) return;   // (Core: turning a carried block)
    settings.topZoom = Math.round(Math.min(2.2, Math.max(0.6, (settings.topZoom || 1) * (e.deltaY > 0 ? 1.1 : 1 / 1.1))) * 100) / 100;
    renderer.settings.topZoom = settings.topZoom;
    clearTimeout(I.zoomSave); I.zoomSave = setTimeout(() => saveSettings(settings), 800);
  }, { passive: true });
  renderer.canvas.addEventListener('contextmenu', e => e.preventDefault());
  // v1.0.1 Core Defense: the scroll wheel turns the block you carry (45 degrees a notch)
  addEventListener('wheel', e => {
    if (!S || !S.inGame || !S.matchSettings.core || currentScreen !== 'none') return;
    const co = S.view && S.view.core, mine = co && co.cr && co.cr.some(r => r[0] === S.localId);
    if (!mine || !e.deltaY) return;
    I.rot = (I.rot + (e.deltaY > 0 ? 1 : 7)) & 7;
  }, { passive: true });
  // Right-click any card (pick screen, directory, combo, peek window...) to open its detail window; right-click again to close.
  document.addEventListener('contextmenu', e => {
    if (cardDetailOpen()) { e.preventDefault(); closeCardDetail(); return; }
    const di = e.target.closest && e.target.closest('[data-info]');   // v1.2.25: right-click info popups (infopop.js)
    if (di && !e.target.closest('.card')) { e.preventDefault(); if (infoOpen()) closeInfo(); else openInfo(di.dataset.info, e.clientX, e.clientY, infoExtra(di.dataset.info)); return; }
    const fs = e.target.closest && e.target.closest('.fsel');
    if (fs) { e.preventDefault(); openFighterDetail(fs.dataset.f); return; }
    const el = e.target.closest && e.target.closest('.card, .peekicon');
    if (el && el._card) { e.preventDefault(); openCardDetail(el._card); return; }
    // Practice range panel: the card list and your current cards
    const pb = e.target.closest && e.target.closest('#practice [data-add], #practice [data-rm]');
    if (pb) {
      const me = practiceMe();
      const id = pb.dataset.add || (me && me.cards[+pb.dataset.rm]);
      const c = id && cardById.get(id);
      if (c) { e.preventDefault(); openCardDetail(c); }
    }
  });
  document.addEventListener('pointerlockchange', () => {
    // v28: a lock granted late (the click that asked for it, then Esc right away) must not trap the mouse on a menu:
    // while locked, clicks all go to the game canvas, so Leave match and Resume did nothing.
    if (locked() && !inPlay()) { document.exitPointerLock(); return; }
    if (!locked() && inPlay() && settings.view === 'first' && !altFree) { togglePause(); lastPauseAt = performance.now(); }
  });
  const unlock = () => { sound.init().then(() => { sound.playMusic(S && S.inGame ? 'battle' : 'menu'); }); };
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });
}

function gatherInput(local) {
  // Commander mode: your bot does all the moving, aiming and shooting. The cursor never aims it.
  renderer.freeCam = !!(S && S.matchSettings && S.matchSettings.commander);
  if (renderer.freeCam) {   // v1.2.26: move keys / drag pan the camera, scroll zooms, Jump goes back to following your bot
    const bl = currentScreen !== 'none', f = bl ? 0 : (held('up') ? 1 : 0) - (held('down') ? 1 : 0), r = bl ? 0 : (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    renderer.specInput = { f, r, fast: !!(keys.ShiftLeft || keys.ShiftRight), follow: !bl && held('jump') };
  }
  if (S && S.matchSettings && S.matchSettings.commander) return { mx: 0, mz: 0, jump: false, shoot: false, block: false, blockSeq: I.blockSeq, reloadSeq: I.reloadSeq, aim: null, aimPoint: null };
  const blocked = currentScreen !== 'none';
  const fp = settings.view === 'first';
  let f = (held('up') ? 1 : 0) - (held('down') ? 1 : 0);
  let r = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
  if (blocked) f = r = 0;
  renderer.owFlyInput = { f, r, up: blocked ? 0 : held('jump') ? 1 : held('crouch') ? -1 : 0, fast: !!(keys.ShiftLeft || keys.ShiftRight) };   // open world free camera after you're out
  renderer.specInput = spectating() ? { f, r, fast: !!(keys.ShiftLeft || keys.ShiftRight), follow: held('jump') } : null;   // v1.2.11: spectator pan
  let mx, mz;
  const side = !!(S && S.matchSettings && S.matchSettings.side);
  if (side) { mx = r; mz = 0; }   // 2D side view: left / right only; up (W) also jumps
  else if (fp) { const y = renderer.yaw; mx = Math.sin(y) * f - Math.cos(y) * r; mz = Math.cos(y) * f + Math.sin(y) * r; }
  else { mx = r; mz = -f; }
  const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
  const aim = local && local.alive && !blocked ? renderer.computeAim(local, S.localId) : null;
  if (aim && aim.aimPoint && !EW.open) S.lastAimPt = aim.aimPoint;   // (v1.2.15: where a ping goes)
  return {
    mx, mz, drop: !blocked && side && held('down') && held('jump'), jump: !blocked && !(side && held('down') && held('jump')) && (held('jump') || (side && !S.matchSettings.brawl && held('up'))), dash: !blocked && !!S.matchSettings.brawl && held('dash'), shoot: !blocked && held('shoot') && (!fp || locked()),
    block: !blocked && held('block'),   // held block (Super Saiyan Hair, Pentagram)
    crouch: !blocked && held('crouch'),   // open world: sneak
    use: !blocked && held('use'),         // extraction: hold on a fallen teammate to revive them
    reload: !blocked && held('reload'),   // v1.2.15 Blood Volley: hold Reload
    blockSeq: I.blockSeq, reloadSeq: I.reloadSeq, useSeq: I.useSeq, jumpSeq: I.jumpSeq, shotSeq: I.shotSeq, ready: I.ready, rot: I.rot, aim: aim ? aim.aim : null, aimPoint: aim ? aim.aimPoint : null, fp, ots: fp && !!settings.ots,
    fps: document.hidden ? 0 : Math.round(fastFps()),   // v1.2.25: the host's shot budget eases off when anyone's frame rate drops (v1.2.27: not while alt-tabbed)
  };
}

// ---------------------------------------------------------------- sessions
// v1.2.6: everyone in a room must run the same build (the snapshot format changed in 1.2.6). A joiner says hello with its
// version first thing; the host turns away a different version, and treats a joiner that skips the hello (1.2.5 and
// older) the same way, so nobody ends up in a match that breaks.
function appVersion() { const el = document.getElementById('versionTag'); return el ? el.textContent.trim() : ''; }
function dropPeer(id, reason) {
  const p = S.lobby.players.find(q => q.id === id);
  S.net.send({ t: 'kick', id, reason });
  toast(`${p ? p.name : 'A player'} couldn't join: they have a different game version.`);
  onPeerLeave({ id }, true);
  (S.dropped ||= new Set()).add(id);   // Steam still reports their leave later: ignore that one
}

function newSession(role) {
  return {
    role, net: null, code: null, localId: null, lobby: { players: [], settings: { ...DEFAULT_LOBBY_SETTINGS } },
    game: null, inGame: false, roster: new Map(), matchSettings: { ...DEFAULT_LOBBY_SETTINGS },
    view: { players: [], bullets: [], barricades: [], phase: 'idle', scores: {}, round: 0, waiting: 0 },
    pmap: new Map(), bmap: new Map(), outEvents: [], sendT: 0, levelVersion: -1,
    paused: false, offer: null, rerolls: 0, botCounter: 0, pickStart: 0,
  };
}

function leaveSession(silent) {
  pauseReturn = 'none';
  TS.stop = TS.slow = 0; hideSplash();
  if ($('legend')) $('legend').classList.remove('hidden');
  setModeTip(null); $('lootPick').classList.add('hidden'); fsel = null; clearInterval(fselIv);
  if (!S) return;
  restoreView();
  const s = S; S = null;
  if (s.amon) s.amon.dispose();
  if (s.net) s.net.close();
  renderer.clearAll();
  $('hud').classList.add('hidden');
  $('practice').classList.add('hidden'); $('statsWin').classList.add('hidden'); $('hoverTip').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  releaseMouse();
  if (!silent) show('title');
  sound.playMusic('menu');
}

function openSolo() {
  leaveSession(true);
  S = newSession('solo'); S.localId = 'you';
  S.lobby.players = [
    { id: 'you', name: cleanName(settings.name, 'You'), team: 0, isBot: false, cosmetics: myCos(), prefColor: settings.color, fac: settings.rtsFac || null },
    { id: 'b1', name: 'Bot 1', team: 1, isBot: true, difficulty: 'normal', cosmetics: randomCos() },
  ];
  S.botCounter = 1;
  renderLobby(); show('lobby');
}
// Title screen → Practice range: straight into the range with the default range settings.
function openPractice() {
  openSolo();
  S.lobby.settings.mode = 'practice';
  renderLobby();
  startMatch();
}

function attachCommon(net) {
  net.on('close', () => { if (S && S.net === net) { toast('Lost connection to the server.'); leaveSession(); } });
}

async function openHost(transport = 'lan') {
  const name = cleanName($('mpName').value);
  settings.name = name; saveSettings(settings);
  leaveSession(true);
  const net = transport === 'steam' ? new SteamNet() : new Net();
  try { await net.connect(); } catch (e) { $('mpError').textContent = e.message; return; }
  S = newSession('host'); S.net = net; S.localId = 'host';
  S.lobby.players = [{ id: 'host', name, team: 0, isBot: false, cosmetics: myCos(), prefColor: settings.color, token: settings.clientId, fac: settings.rtsFac || null }];
  S.departed = new Map();
  attachCommon(net);
  net.on('hosted', m => { S.code = m.code; renderLobby(); show('lobby'); });
  net.on('error', m => { toast(m.message); });
  net.on('peerJoin', onPeerJoin).on('peerLeave', onPeerLeave).on('msg', onHostMsg);
  net.send({ t: 'host', name });
}

async function joinRoom(code, transport = 'lan') {
  code = String(code || '').trim().toUpperCase();
  if (transport === 'lan' && /^\d{10,20}$/.test(code)) transport = 'steam';   // a Steam lobby code (shown in the host's pause menu)
  if (transport === 'lan' && !/^[A-Z]{4}$/.test(code)) { $('mpError').textContent = 'Room codes are 4 letters (Steam codes are long numbers).'; return; }
  const name = cleanName($('mpName').value || settings.name);
  settings.name = name; saveSettings(settings);
  leaveSession(true);
  const net = transport === 'steam' ? new SteamNet() : new Net();
  try { await net.connect(); } catch (e) { $('mpError').textContent = e.message; return; }
  S = newSession('peer'); S.net = net;
  attachCommon(net);
  net.on('joined', m => {
    S.localId = m.id; S.code = m.code;
    if (!S.inGame) { renderLobby(); show('lobby'); }
    net.send({ t: 'toHost', msg: { k: 'hello', v: appVersion() } });   // v1.2.6: must go before anything else
    setTimeout(() => {   // a 1.2.5 or older host never answers the hello
      if (S && S.net === net && !S.helloOk) { leaveSession(); toast(`The host has an older version of Blockshot3D (you have ${appVersion()}). Everyone needs the same version to play together.`); toastT = 7; }
    }, 10000);
    net.send({ t: 'toHost', msg: { k: 'setCos', cos: myCos() } });
    if (settings.rtsFac === 'hive') net.send({ t: 'toHost', msg: { k: 'setFac', fac: 'hive' } });   // (v1.2.32: your RTS faction)
    if (settings.color) net.send({ t: 'toHost', msg: { k: 'setColor', color: settings.color } });
  });
  net.on('error', m => { $('mpError').textContent = m.message; leaveSession(true); show('browser'); });
  if (transport === 'steam') toast('Joining your friend\'s game…');
  net.on('hostLeft', () => { toast('The host left the game.'); leaveSession(); });
  net.on('kicked', m => { leaveSession(); toast(m.reason || 'Removed from the room.'); toastT = 7; });
  net.on('msg', onPeerMsg);
  net.send({ t: 'join', code, name, token: settings.clientId });
}

async function refreshRooms() {
  const box = $('roomList');
  box.innerHTML = '<div class="empty">Looking for rooms…</div>';
  const net = new Net();
  try { await net.connect(); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  net.on('rooms', m => {
    box.innerHTML = m.rooms.length ? '' : '<div class="empty">No open rooms. Host one, or ask a friend for their room code.</div>';
    for (const r of m.rooms) {
      const d = document.createElement('div'); d.className = 'room';
      d.innerHTML = `<span><b>${esc(r.code)}</b> · <span data-noi18n>${esc(r.host)}</span> · ${r.players} player${r.players === 1 ? '' : 's'}${r.bots ? ` + ${r.bots} bot${r.bots === 1 ? '' : 's'}` : ''}${r.started ? ' · in a match (late join)' : ''}</span>`;
      const b = document.createElement('button'); b.className = 'btn ghost small'; b.textContent = t('Join');
      b.disabled = !(r.open > 0); b.onclick = () => joinRoom(r.code);
      d.appendChild(b); box.appendChild(d);
    }
    net.close();
  });
  net.send({ t: 'list' });
}

// ---------------------------------------------------------------- lobby
const isHostSide = () => S && S.role !== 'peer';
// v1.0.8: new players and bots go to the emptiest of all 8 teams (so adding bots cycles through every team)
function leastTeam() {
  const c = ART.teamNames.map(() => 0);
  for (const p of S.lobby.players) { const t = p.team || 0; if (t < c.length) c[t]++; }
  // v1.2.28: once two or more teams are set up, newcomers fill those (the team colors can be any of the 8 now)
  const inUse = c.map((n, i) => n ? i : -1).filter(i => i >= 0), pool = inUse.length >= 2 ? inUse : c.map((n, i) => i);
  let best = pool[0]; for (const i of pool) if (c[i] < c[best]) best = i;
  return best;
}
function lobbyChanged() {
  if (S.role === 'host') {
    S.net.send({ t: 'toAll', msg: { k: 'lobby', lobby: S.lobby } });
    sendMeta();
  }
  renderLobby();
}
// Room info for the LAN room list and Steam friends (players, bots, open seats, in a match or not).
function sendMeta(extra = {}) {
  if (!S || S.role !== 'host') return;
  const m = lobbyOpenSeats();
  if (S.inGame && S.game) { // in a match, seats that are already taken by late joiners count too
    const heroes = S.game.heroes().filter(p => p.connected && !p.retireNext);
    m.players = heroes.filter(p => !p.isBot).length; m.bots = heroes.filter(p => p.isBot).length;
    m.open = Math.max(0, RULES.steamSeats - m.players);
  }
  S.net.send({ t: 'meta', meta: { ...m, ...extra } });
}
function validateLobby() {
  const L = S.lobby;
  if (L.settings.mode === 'rts') {   // v1.2.27: 2 to 8 commanders
    if (L.players.length < 2) return 'Add at least one bot or wait for another player to join.';
    if (L.players.length > 8) return 'The RTS takes up to 8 players.';
    if (L.settings.rtsTeams && new Set(L.players.map(p => p.team || 0)).size < 2) return 'Put players on at least two different teams.';
    return '';
  }
  if (L.settings.mode === 'waves' || L.settings.mode === 'core' || L.settings.mode === 'practice' || L.settings.mode === 'open' || L.settings.mode === 'amon') return '';
  if (L.players.length < 2) return 'Add at least one bot or wait for another player to join.';
  if (teamPlay(L.settings) && new Set(L.players.map(p => p.team || 0)).size < 2) return 'Put players on at least two different teams.';
  return '';
}
function lobbyOpenSeats() {
  // Open seats = empty slots + bots a human can replace. Advertised to Steam friends and the LAN room list.
  const L = S.lobby, humans = L.players.filter(p => !p.isBot).length, bots = L.players.filter(p => p.isBot).length;
  return { players: humans, bots, open: Math.max(0, RULES.steamSeats - humans), max: RULES.steamSeats };   // (v1.2.31: no cap of our own; Steam's lobby limit)
}
function renderLobby() {
  if (!S || S.inGame) return;
  const L = S.lobby, host = isHostSide(), tdm = teamPlay(L.settings) || owSquads(L.settings) || (L.settings.mode === 'amon' && !!L.settings.amonVs) || (L.settings.mode === 'rts' && !!L.settings.rtsTeams);   // (v28: AMON Versus can be played in teams)
  const mode = owSquads(L.settings) ? 'tdm' : L.settings.mode;
  $('lobbyTitle').textContent = S.role === 'solo' ? 'Solo lobby' : S.role === 'host' ? `Hosting room ${S.code || '…'}` : `Room ${S.code || ''}`;
  if (S.role === 'solo') $('lobbyInfo').textContent = 'Add bots, pick a mode and start.';
  else if (S.role === 'host' && S.net && S.net.isSteam) {
    $('lobbyInfo').textContent = 'Press Invite Steam friends. Friends join automatically when they accept, or from "Join game" in your Steam friends list. Friends also see your game in their Multiplayer menu while it has a free spot.';
  } else if (S.role === 'host') {
    const addrs = (serverInfo.lan || []).map(a => `http://${a}:${serverInfo.port}`);
    $('lobbyInfo').innerHTML = `Friends open ${addrs.length ? addrs.map(a => `<b>${esc(a)}</b>`).join(' or ') : 'this server\'s address'} in their browser, choose Multiplayer and join room <b>${esc(S.code || '…')}</b>.`;
  } else $('lobbyInfo').textContent = 'The host controls the match settings. You can pick your own team and color.';
  const colors = assignColors(L.players, teamPlay(L.settings) ? 'tdm' : mode);
  // (v1.2.35: each select is written with its value already chosen; setting them afterwards searched the page once per
  // player, which took over a minute to fill a 1000-player lobby)
  const teamOpts = v => ART.teamNames.map((n, i) => `<option value="${i}"${i === (v || 0) ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const diffOpts = v => Object.entries(DIFFICULTY).map(([k, d]) => `<option value="${k}"${k === (v || 'normal') ? ' selected' : ''}>${d.label}</option>`).join('');
  const rowOf = (p, i) => {
    const me = p.id === S.localId;
    const tag = me ? 'You' : p.isBot ? 'Bot' : p.id === 'host' ? 'Host' : 'Player';
    const diff = p.isBot ? (host ? `<select data-diff="${p.id}">${diffOpts(p.difficulty)}</select>` : `<span class="tag">${DIFFICULTY[p.difficulty]?.label || ''}</span>`) : '<span></span>';
    const team = tdm ? ((host || me) ? `<select data-team="${p.id}">${teamOpts(p.team)}</select>` : `<span class="tag">${esc(ART.teamNames[p.team || 0])}</span>`) : '<span></span>';
    const rm = host && !me && (p.isBot || S.role === 'host') ? `<button data-rm="${p.id}">${p.isBot ? 'Remove' : 'Kick'}</button>` : '<span></span>';
    // Your own swatch opens the color picker (free-for-all; teams use team shades).
    const sw = (me || (p.isBot && host)) && !tdm ? `<button class="sw pickable" data-color="${esc(p.id)}" style="background:${colors[i]}" title="${me ? 'Pick your color' : 'Pick this bot\'s color'}"></button>` : `<span class="sw" style="background:${colors[i]}"></span>`;
    const drag = tdm && (host || me) ? ` draggable="true" data-drag="${esc(p.id)}" title="Drag onto a team to move ${me ? 'yourself' : 'this player'}"` : '';
    // v1.2.32 RTS: each player's faction (yours, or a bot's when you host)
    const fv = p.fac || (p.isBot ? 'random' : 'steel'), fo = (v, l) => `<option value="${v}"${v === fv ? ' selected' : ''}>${l}</option>`;
    const fac = L.settings.mode !== 'rts' ? '' : (me || (p.isBot && host)) ? ` <select data-fac="${esc(p.id)}" title="Faction">${p.isBot ? fo('random', 'Random faction') : ''}${fo('steel', 'Steelborne')}${fo('hive', 'Hive')}</select>` : ` <span class="tag">${p.fac === 'hive' ? 'Hive' : p.fac === 'random' || (p.isBot && !p.fac) ? 'Random' : 'Steelborne'}</span>`;
    return `<div class="prow${drag ? ' dragrow' : ''}"${drag}>${sw}<span><span data-noi18n>${esc(p.name)}</span> <span class="tag">${tag}</span>${fac}</span>${diff}${team}${rm}</div>`;
  };
  // v1.2.27 (Devin): people first, then bots, so friends joining a room are easy to spot
  const ordered = L.players.map((p, i) => [p, i]).sort((a, b) => (a[0].isBot ? 1 : 0) - (b[0].isBot ? 1 : 0) || a[1] - b[1]);
  // v1.0.8: with teams on, the list is grouped into one box per team (drag a player onto a box to move them there)
  if (tdm) {
    $('playerList').innerHTML = ART.teamNames.map((n, t) => {
      const rows = ordered.filter(([p]) => (p.team || 0) === t);
      return `<div class="teambox${rows.length ? '' : ' empty'}" data-teambox="${t}" style="--tc:${ART.teamColors[t]}"><div class="teamhd"><span class="sw" style="background:${ART.teamColors[t]}"></span>${esc(n)} team <span class="tag">${rows.length || 'drop players here'}</span></div>${rows.map(([p, i]) => rowOf(p, i)).join('')}</div>`;
    }).join('');
  } else $('playerList').innerHTML = ordered.map(([p, i]) => rowOf(p, i)).join('');
  // Your color: 20 swatches (taken ones greyed out). Team deathmatch uses team shades instead.
  {
    const mineIdx = L.players.findIndex(p => p.id === S.localId), taken = new Set(colors.filter((_, i) => i !== mineIdx && !L.players[i].isBot));
    const botC = new Set(colors.filter((_, i) => i !== mineIdx && L.players[i].isBot));
    $('colorStrip').innerHTML = ART.ffaColors.map(c => `<button data-pick="${c}" style="background:${c}" ${taken.has(c) ? 'disabled title="Taken"' : botC.has(c) ? 'title="A bot has this color: pick it to swap"' : 'title="Pick this color"'} class="${colors[mineIdx] === c ? 'cur' : ''}"></button>`).join('');
    $('colorStrip').classList.toggle('off', tdm);
    $('colorNote').textContent = tdm ? t('Team deathmatch uses team shades; your color comes back in other modes.') : '';
  }
  $('playerCount').textContent = Number.isFinite(RULES.maxPlayers) ? `${L.players.length}/${RULES.maxPlayers}` : String(L.players.length);
  const practice = mode === 'practice';
  $('botRow').classList.toggle('hidden', !host || L.players.length >= RULES.maxPlayers || practice);
  $('botColorHint').classList.toggle('hidden', !host || practice || tdm);
  // Mode buttons + only the settings that apply to the chosen mode.
  for (const b of document.querySelectorAll('#modeBtns [data-mode]')) {
    b.classList.toggle('sel', b.dataset.mode === L.settings.mode || (b.dataset.mode === 'ffa' && L.settings.mode === 'tdm'));   // v1.0.6: one Deathmatch button, teams are a setting
    b.disabled = !host;
    if (b.classList.contains('soloonly')) b.classList.toggle('hidden', S.role !== 'solo');
  }
  for (const el of document.querySelectorAll('#lobby [data-modes]')) el.classList.toggle('hidden', !el.dataset.modes.split(' ').includes(L.settings.mode));
  // v1.2.26 lobby redesign: one short line for the mode, settings in tabs (right-click anything for the details)
  $('modeLine').textContent = t(MODE_LINES[L.settings.mode] || '');
  { const tb = document.querySelector(`#setTabs [data-tab="${lobbyTab}"]`); if (!tb || tb.classList.contains('hidden')) lobbyTab = 'match'; }
  for (const b of document.querySelectorAll('#setTabs [data-tab]')) b.classList.toggle('sel', b.dataset.tab === lobbyTab);
  for (const p of document.querySelectorAll('#lobby .spane')) p.classList.toggle('hidden', p.dataset.pane !== lobbyTab);
  for (const el of document.querySelectorAll('#lobby [data-maps]')) el.classList.toggle('hidden', L.settings.mapSource !== el.dataset.maps || mode === 'waves' || mode === 'core' || mode === 'practice' || mode === 'amon');
  $('roundsText').textContent = t(mode === 'waves' || mode === 'core' ? 'Waves to survive' : 'Rounds to win');
  const st = L.settings;
  $('setRounds').value = String(st.roundsToWin);
  $('setTeams').value = st.mode === 'tdm' ? 'tdm' : 'ffa'; $('setTeams').disabled = !host;
  $('setTTeams').checked = !!st.tTeams; $('setTLives').value = String(st.tLives || 4);
  $('setCombos').checked = st.combos !== false;
  $('setThemes').value = st.themes || 'all';
  $('setHazards').checked = !!st.hazards;
  $('setRoundMods').value = ROUND_MODS[st.roundMods] || st.roundMods === 'random' ? st.roundMods : 'off';
  $('setSide').checked = !!st.side; $('setStocks').value = String(st.stocks || 3); $('setBrawlFlat').checked = !!st.brawlFlat; $('setBrawlItems').checked = st.brawlItems !== false; $('setBudget').checked = st.budget !== false;
  $('setCommander').checked = !!st.commander;
  $('setRtsSize').value = st.rtsSize || 'normal'; $('setRtsTeams').checked = !!st.rtsTeams; $('setRtsBudget').checked = st.budget !== false;
  $('setPickTime').value = String(st.pickTime ?? 30); $('setAmonTimer').value = st.amonTimer ? '1' : '0'; $('setAmonVs').value = st.amonVs ? '1' : '0'; $('setAmonCmd').checked = st.amonCmd !== false;
  $('setRerolls').value = String(st.rerolls); $('setMaps').value = st.mapSource; $('setMapLava').checked = st.mapLava !== false; $('setMapIce').checked = st.mapIce !== false; $('setFF').checked = !!st.friendlyFire;
  $('setSpeed').checked = !!st.speed; $('setWaveDiff').value = coopDiffKey(st);
  $('setOwType').value = st.owType || 'br'; $('setOwBots').value = st.owBots || 'some'; $('setOwSquads').checked = !!st.owSquads;
  $('setCoopScale').value = st.coopScale || 'standard'; $('setGmSpawn').value = st.gmSpawn || 'auto';
  $('setDummies').value = String(st.dummyCount ?? 3); $('setDummyMode').value = st.dummyMode || 'idle';
  $('setDummyHp').value = String(st.dummyHp ?? 100); $('setGod').checked = st.practiceGod !== false;
  for (const id of LOBBY_INPUTS) $(id).disabled = !host;
  $('shuffleTeams').disabled = !host;
  $('startBtn').classList.toggle('hidden', !host);
  $('startBtn').textContent = t(practice ? 'Practice range' : 'Start match');
  $('inviteBtn').classList.toggle('hidden', !(S.role === 'host' && S.net && S.net.isSteam));
  if (S.net && S.net.isSteam && S.role === 'host') $('lobbyTitle').textContent = 'Hosting on Steam';
  const err = validateLobby();
  $('startBtn').disabled = !!err;
  $('lobbyError').textContent = host ? err : 'Waiting for the host to start the match.';
}
const owSquads = st => st.mode === 'open' && st.owType !== 'extract' && !!st.owSquads;
const LOBBY_INPUTS = ['setSide', 'setOwType', 'setOwBots', 'setOwSquads', 'setRounds', 'setRerolls', 'setMaps', 'setFF', 'setCombos', 'setHazards', 'setRoundMods', 'setCommander', 'setPickTime', 'setThemes', 'setSpeed', 'setWaveDiff', 'setCoopScale', 'setGmSpawn', 'setDummies', 'setDummyMode', 'setDummyHp', 'setGod', 'setAmonTimer', 'setAmonCmd', 'setBudget', 'setBrawlItems', 'setTTeams', 'setTLives', 'setRtsSize', 'setRtsTeams', 'setRtsBudget'];
let lobbyTab = 'match';
const MODE_LINES = {
  ffa: 'Everyone for themselves (or turn on teams). Losers pick cards.', tdm: 'Team deathmatch. The losing team picks cards.',
  tourn: 'Everyone fights their own 1v1 arena each round. Run out of losses and you\'re out.', waves: 'Survive the raider waves together. Boss on the last wave.',
  core: 'Build a fort and protect the core.', open: 'Drop from the bus: battle royale or extraction.', brawl: 'Smash-style: knock rivals off the stage.',
  amon: 'Autobattler: build a 5x5 army.', rts: 'Experimental. Real-time strategy: build a base, mine, research cards and wipe out the other bases.', practice: 'Try any card on target dummies.',
};
// v1.2.27 (Devin): right-click on Shot budget also estimates the shots / entities for the players in this lobby
function infoExtra(key) {
  if (key !== 'budget' || !S || !S.lobby || S.inGame) return null;
  const L = S.lobby, hum = L.players.filter(p => !p.isBot).length, bots = L.players.length - hum, E = budgetEstimate(L.players.length, L.settings.mode);
  return { more: `<p class="ipEst"><b>This lobby: ${E.n} player${E.n === 1 ? '' : 's'}</b> (${hum} ${hum === 1 ? 'person' : 'people'}, ${bots} bot${bots === 1 ? '' : 's'})<br>
Early rounds: about <b>${E.early}</b> shots in the air, fights up to ~<b>${E.earlyPeak}</b><br>
Late, with stacked cards: about <b>${E.late}</b>, fights up to ~<b>${E.latePeak}</b><br>
Entities (players, turrets, clones, critters${L.settings.mode === 'waves' || L.settings.mode === 'core' ? ', raiders' : ''}): ~<b>${E.ents}</b> early, ~<b>${E.entsLate}</b> late</p>
<p class="hint">Measured from bot matches; real numbers depend on the cards picked.</p>` };
}
let colorPopFor = null;
function openColorPop(anchor) {
  const pop = $('colorPop'), L = S.lobby, colors = assignColors(L.players, L.settings.mode);
  colorPopFor = anchor.dataset.color && anchor.dataset.color !== '1' ? anchor.dataset.color : S.localId;
  const mineIdx = L.players.findIndex(p => p.id === colorPopFor);
  const taken = new Set(colors.filter((c, i) => i !== mineIdx && !L.players[i].isBot));   // v26: a bot's color can be taken (it swaps)
  const botC = new Set(colors.filter((c, i) => i !== mineIdx && L.players[i].isBot));
  pop.innerHTML = ART.ffaColors.map(c => `<button data-pick="${c}" style="background:${c}" ${taken.has(c) ? 'disabled title="Taken"' : botC.has(c) ? 'title="Swap with that bot"' : ''} class="${colors[mineIdx] === c ? 'cur' : ''}"></button>`).join('');
  pop.classList.remove('hidden');
  const r = anchor.getBoundingClientRect(), pr = pop.offsetParent ? pop.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
  pop.style.left = (r.left - pr.left) + 'px'; pop.style.top = (r.bottom - pr.top + 6) + 'px';
}
// v26: taking a color a bot has swaps colors with that bot (host side). Human players' colors stay taken.
function claimColor(pid, c) {
  const L = S.lobby, colors = assignColors(L.players, L.settings.mode), i = L.players.findIndex(q => q.id === pid);
  if (i < 0) return;
  const j = colors.findIndex((x, k) => x === c && k !== i);
  if (j >= 0 && L.players[j].isBot) L.players[j].prefColor = colors[i];
  else if (j >= 0) return;
  L.players[i].prefColor = c; lobbyChanged();
}
function setMyColor(c) {
  settings.color = c; saveSettings(settings);
  if (isHostSide()) claimColor(S.localId, c);
  else S.net.send({ t: 'toHost', msg: { k: 'setColor', color: c } });
}
// turning teams on with everyone on one team: split them into two teams to start
function splitTeams() {
  const L = S.lobby; if (!(teamPlay(L.settings) || (L.settings.mode === 'rts' && L.settings.rtsTeams))) return;
  if (new Set(L.players.map(p => p.team || 0)).size < 2) L.players.forEach((p, i) => { p.team = i % 2; });
  colorTeams();
}
// v1.2.28 (Devin): set-up teams take the team color closest to their players' own colors (people count 4x a bot), so
// a player who likes violet tends to end up on the Violet team. Only the team colors move: who is with whom stays.
function colorTeams() {
  const L = S.lobby, own = assignColors(L.players, 'ffa'), rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const groups = new Map();
  L.players.forEach((p, i) => { const t = p.team || 0; if (!groups.has(t)) groups.set(t, []); groups.get(t).push([p, rgb(own[i] || '#ffffff')]); });
  const pairs = [];
  for (const [t, G] of groups) ART.teamColors.forEach((c, s) => {
    const tc = rgb(c); let cost = 0, w = 0;
    for (const [p, col] of G) { const k = p.isBot ? 1 : 4; cost += k * Math.hypot(col[0] - tc[0], col[1] - tc[1], col[2] - tc[2]); w += k; }
    pairs.push([cost / (w || 1), t, s]);
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const to = new Map(), used = new Set();
  for (const [, t, s] of pairs) if (!to.has(t) && !used.has(s)) { to.set(t, s); used.add(s); }
  for (const p of L.players) p.team = to.get(p.team || 0) ?? (p.team || 0);
}
function bindLobby() {
  $('playerList').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.diff && isHostSide()) { const p = S.lobby.players.find(q => q.id === t.dataset.diff); if (p) p.difficulty = t.value; lobbyChanged(); }
    if (t.dataset.fac) {   // v1.2.32 RTS faction
      const fac = ['steel', 'hive', 'random'].includes(t.value) ? t.value : 'steel';
      if (t.dataset.fac === S.localId) { settings.rtsFac = fac; saveSettings(settings); }
      if (isHostSide()) { const p = S.lobby.players.find(q => q.id === t.dataset.fac); if (p) p.fac = fac; lobbyChanged(); }
      else if (t.dataset.fac === S.localId) S.net.send({ t: 'toHost', msg: { k: 'setFac', fac } });
    }
    if (t.dataset.team) {
      const team = +t.value;
      if (isHostSide()) { const p = S.lobby.players.find(q => q.id === t.dataset.team); if (p) p.team = team; lobbyChanged(); }
      else if (t.dataset.team === S.localId) S.net.send({ t: 'toHost', msg: { k: 'setTeam', team } });
    }
  });
  // v1.0.8: drag a player row onto a team box
  const setTeamOf = (id, team) => {
    if (isHostSide()) { const p = S.lobby.players.find(q => q.id === id); if (p) { p.team = team; sound.play('ui'); lobbyChanged(); } }
    else if (id === S.localId) S.net.send({ t: 'toHost', msg: { k: 'setTeam', team } });
  };
  let dragId = null;
  $('playerList').addEventListener('dragstart', e => { const r = e.target.closest && e.target.closest('[data-drag]'); if (!r) return; dragId = r.dataset.drag; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); r.classList.add('dragging'); });
  $('playerList').addEventListener('dragend', e => { dragId = null; for (const x of document.querySelectorAll('#playerList .dragging, #playerList .dropon')) x.classList.remove('dragging', 'dropon'); });
  $('playerList').addEventListener('dragover', e => {
    const b = dragId && e.target.closest && e.target.closest('[data-teambox]'); if (!b) return;
    e.preventDefault(); for (const x of document.querySelectorAll('#playerList .dropon')) if (x !== b) x.classList.remove('dropon'); b.classList.add('dropon');
  });
  $('playerList').addEventListener('drop', e => {
    const b = dragId && e.target.closest && e.target.closest('[data-teambox]'); if (!b) return;
    e.preventDefault(); const id = dragId; dragId = null; setTeamOf(id, +b.dataset.teambox);
  });
  $('playerList').addEventListener('click', e => {
    const id = e.target.dataset && e.target.dataset.rm;
    if (!id || !isHostSide()) return;
    const p = S.lobby.players.find(q => q.id === id);
    if (p && !p.isBot && S.role === 'host') S.net.send({ t: 'kick', id, reason: 'The host removed you from the room.' });
    S.lobby.players = S.lobby.players.filter(q => q.id !== id);
    lobbyChanged();
  });
  const addBots = n => {
    if (!isHostSide()) return;
    for (let k = 0; k < n && S.lobby.players.length < RULES.maxPlayers; k++) {
      S.botCounter++;
      S.lobby.players.push({ id: 'b' + S.botCounter, name: 'Bot ' + S.botCounter, team: leastTeam(), isBot: true, difficulty: $('botDiff').value, cosmetics: randomCos() });
    }
    sound.play('ui'); lobbyChanged();
  };
  $('addBot').onclick = () => addBots(1);
  $('addBot10').onclick = () => addBots(10);   // v1.2.25: 100-player lobbies
  $('addBot100').onclick = () => addBots(100);   // v1.2.31: no player limit
  $('clearBots').onclick = () => { if (!isHostSide()) return; S.lobby.players = S.lobby.players.filter(p => !p.isBot); sound.play('ui'); lobbyChanged(); };
  const set = (k, f) => e => { if (!isHostSide()) return; S.lobby.settings[k] = f(e.target); lobbyChanged(); };
  $('modeBtns').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]'); if (!b || !isHostSide()) return;
    if (b.dataset.mode === 'practice' && S.role !== 'solo') return;
    S.lobby.settings.mode = b.dataset.mode; splitTeams(); sound.play('ui'); lobbyChanged();
  });
  $('setTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (!b) return; lobbyTab = b.dataset.tab; sound.play('ui'); renderLobby(); });
  // v1.2.26 tournament settings
  $('setTTeams').onchange = e => { if (!isHostSide()) return; S.lobby.settings.tTeams = e.target.checked; splitTeams(); sound.play('ui'); lobbyChanged(); };
  $('setTLives').onchange = set('tLives', t => Math.max(1, Math.min(10, +t.value || 4)));
  $('setRounds').onchange = set('roundsToWin', t => +t.value);
  $('setTeams').onchange = e => {
    if (!isHostSide()) return;
    const L = S.lobby; L.settings.mode = e.target.value === 'tdm' ? 'tdm' : 'ffa';
    // turning teams on with everyone on one team: split them into two teams to start
    splitTeams();
    sound.play('ui'); lobbyChanged();
  };
  $('setRerolls').onchange = set('rerolls', t => +t.value);
  $('setMaps').onchange = set('mapSource', t => t.value);
  $('setMapLava').onchange = set('mapLava', t => t.checked);
  $('setMapIce').onchange = set('mapIce', t => t.checked);
  $('setFF').onchange = set('friendlyFire', t => t.checked);
  $('setCombos').onchange = set('combos', t => t.checked);
  $('setThemes').onchange = set('themes', t => t.value);
  $('setSpeed').onchange = set('speed', t => t.checked);
  $('setWaveDiff').onchange = set('waveDifficulty', t => t.value);
  $('setCoopScale').onchange = set('coopScale', t => t.value);
  $('setGmSpawn').onchange = set('gmSpawn', t => t.value);
  $('setOwType').onchange = set('owType', t => t.value);
  $('setOwBots').onchange = set('owBots', t => t.value);
  $('setOwSquads').onchange = set('owSquads', t => t.checked);
  $('setDummies').onchange = set('dummyCount', t => +t.value);
  $('setDummyMode').onchange = set('dummyMode', t => t.value);
  $('setDummyHp').onchange = set('dummyHp', t => +t.value);
  $('setGod').onchange = set('practiceGod', t => t.checked);
  $('shuffleTeams').onclick = () => {
    if (!isHostSide()) return;
    const ps = S.lobby.players.slice().sort(() => Math.random() - 0.5);
    const n = Math.max(2, new Set(S.lobby.players.map(p => p.team || 0)).size);
    ps.forEach((p, i) => { p.team = i % n; });
    colorTeams();
    sound.play('ui'); lobbyChanged();
  };
  $('playerList').addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (b) { e.stopPropagation(); openColorPop(b); } });
  $('colorStrip').addEventListener('click', e => { const c = e.target.dataset && e.target.dataset.pick; if (c && !e.target.disabled) { sound.play('ui'); setMyColor(c); } });
  $('colorPop').addEventListener('click', e => {
    const c = e.target.dataset && e.target.dataset.pick; if (!c) return;
    const bot = colorPopFor && colorPopFor !== S.localId && S.lobby.players.find(q => q.id === colorPopFor && q.isBot);
    if (bot) { if (isHostSide()) claimColor(bot.id, c); }
    else setMyColor(c);
    $('colorPop').classList.add('hidden');
  });
  document.addEventListener('click', e => { if (!e.target.closest('#colorPop') && !e.target.closest('[data-color]')) $('colorPop').classList.add('hidden'); });
  $('setHazards').onchange = set('hazards', t => t.checked);
  $('rmodList').innerHTML = Object.entries(ROUND_MODS).map(([k, m]) => `<option value="${k}" title="${m.text}">${m.name}</option>`).join('');
  $('setRoundMods').onchange = set('roundMods', t => t.value);
  $('setSide').onchange = set('side', t => t.checked);
  $('setStocks').onchange = set('stocks', t => +t.value);
  $('setBrawlFlat').onchange = set('brawlFlat', t => t.checked);
  $('setBrawlItems').onchange = set('brawlItems', t => t.checked);
  $('setBudget').onchange = set('budget', t => t.checked);
  $('setCommander').onchange = set('commander', t => t.checked);
  $('setPickTime').onchange = set('pickTime', t => +t.value);
  $('setAmonTimer').onchange = set('amonTimer', t => t.value === '1');
  $('setAmonVs').onchange = set('amonVs', t => t.value === '1');
  $('setAmonCmd').onchange = set('amonCmd', t => t.checked);
  $('setRtsSize').onchange = set('rtsSize', t => t.value);
  $('setRtsBudget').onchange = set('budget', t => t.checked);
  $('setRtsTeams').onchange = e => { if (!isHostSide()) return; S.lobby.settings.rtsTeams = e.target.checked; splitTeams(); sound.play('ui'); lobbyChanged(); };
  $('startBtn').onclick = startMatch;
  $('leaveLobby').onclick = () => leaveSession();
  $('fselLeave').onclick = () => leaveMatch();   // v28: picking has no time limit, so the pick screen has its own way out
}

function onPeerJoin(m) {
  const name = cleanName(m.name), token = m.token || '';
  const humans = S.lobby.players.filter(p => !p.isBot).length;
  if (humans >= RULES.maxPlayers) { S.net.send({ t: 'kick', id: m.id, reason: 'That room is full.' }); return; }
  if (!S.inGame) {
    // Full of bots? The newcomer takes a bot's seat.
    if (S.lobby.players.length >= RULES.maxPlayers) { const bi = S.lobby.players.map(p => p.isBot).lastIndexOf(true); if (bi >= 0) S.lobby.players.splice(bi, 1); }
    S.lobby.players.push({ id: m.id, name, team: leastTeam(), isBot: false, token });
    toast(`${name} joined`); lobbyChanged();
    return;
  }
  lateJoin(m.id, name, token);
}
// Someone joins a match in progress. Returning players get their cards back; new players get as many
// picks as the lobby's average card count at the next pick phase (with 50% more time). Either way they
// watch until the next round starts.
function lateJoin(id, name, token) {
  if (S.rtsGame) {   // v1.2.27 RTS: your old base back (same game install), otherwise you watch
    S.lobby.players = S.lobby.players.filter(p => p.id !== id && !(token && p.token === token)); S.lobby.players.push({ id, name, team: 0, isBot: false, token });
    const old = token && S.rtsSeat && S.rtsSeat.get(token);
    if (old && S.rtsGame.rebind(old, id)) { S.rtsSeat.set(token, id); const r0 = S.roster.get(old); if (r0) { S.roster.delete(old); S.roster.set(id, { ...r0, id }); } }
    else S.rtsGame.addSpectator({ id, name, color: '#cccccc' });
    const roster = [...S.roster.values()].map(x => ({ id: x.id, name: x.name, team: x.team, isBot: x.isBot, color: x.color, cosmetics: x.cosmetics, kind: 'hero' }));
    S.net.send({ t: 'toPeer', id, msg: { k: 'start', roster, settings: S.matchSettings, late: true } });
    toast(`${name} joined`); sendMeta();
    return;
  }
  if (S.amonGame) {   // AMON: a new seat with catch-up gold (or your old seat back)
    const lp = { id, name, team: 0, isBot: false, token };
    S.lobby.players = S.lobby.players.filter(p => p.id !== id); S.lobby.players.push(lp);
    const colors = assignColors(S.lobby.players, 'ffa');
    const r = { id, name, team: 0, isBot: false, difficulty: 'normal', color: colors[colors.length - 1], cosmetics: null, kind: 'hero' };
    const roster = [...S.roster.values()].filter(x => x.id !== id).map(x => ({ id: x.id, name: x.name, team: 0, isBot: x.isBot, color: x.color, cosmetics: x.cosmetics, kind: 'hero' }));
    roster.push(r);
    S.roster.set(id, { ...r, cards: [] });
    S.amonGame.addPlayer(r);
    S.net.send({ t: 'toPeer', id, msg: { k: 'start', roster, settings: S.matchSettings, late: true } });
    toast(`${name} joined`); sendMeta();
    return;
  }
  // v1.2.30: the match may be on its own thread: read what's needed from its mirror; it seats them (hostsim.js join)
  const g = S.game;
  const tokenTaken = token && S.lobby.players.some(p => p.token === token && p.id !== id);
  const back = !tokenTaken && token && S.departed && S.departed.get(token);
  const old = g.player(id);
  let team = back ? back.team : leastTeam();
  if (S.lobby.settings.mode === 'waves') team = 0;
  const lp = { id, name, team, isBot: false, token, cosmetics: back ? back.cosmetics : null, prefColor: back ? back.prefColor : null };
  S.lobby.players = S.lobby.players.filter(p => p.id !== id); S.lobby.players.push(lp);
  const colors = assignColors(S.lobby.players, teamPlay(S.lobby.settings) ? 'tdm' : S.lobby.settings.mode);
  const r = { id, name, team, isBot: false, difficulty: 'normal', color: old ? old.color : colors[colors.length - 1], cosmetics: lp.cosmetics, kind: 'hero' };
  // tell the newcomer about the match first, then (from the match) the level, everyone's cards and everyone else about the newcomer
  const roster = [...S.roster.values()].filter(x => !x.transient && x.id !== id).map(x => ({ id: x.id, name: x.name, team: x.team, isBot: x.isBot, color: x.color, cosmetics: x.cosmetics, kind: 'hero' }));
  roster.push(r);
  S.net.send({ t: 'toPeer', id, msg: { k: 'start', roster, settings: S.matchSettings, late: true } });
  g.cmd({ t: 'join', id, name, r, back: back ? { cards: back.cards, tally: back.tally, rerollsLeft: back.rerollsLeft, oldKey: back.oldKey, score: back.score } : null });
  S.roster.set(id, { ...r, cards: [] });
  if (back) S.departed.delete(token);
  toast(back || old ? `${name} is back with their cards` : `${name} joined — they'll catch up at the next pick`);
  sendMeta();
}
function onPeerLeave(m, forced) {
  if (!forced && S.dropped && S.dropped.delete(m.id)) return;   // already removed by dropPeer
  if (S.hello) S.hello.delete(m.id);
  if (S.hostNet) S.hostNet.remove(m.id);
  if (S.acks) S.acks.delete(m.id);
  if (S.pausers) { S.pausers.delete(m.id); S.paused = S.pausers.size > 0; }
  const p = S.lobby.players.find(q => q.id === m.id);
  S.lobby.players = S.lobby.players.filter(q => q.id !== m.id);
  if (S.game) {   // (their build comes back as 'departed' to remember for a reconnect: simDeparted)
    if (p && p.token && S.departed) (S.departedCos ||= new Map()).set(p.token, { cosmetics: p.cosmetics, prefColor: p.prefColor });
    S.game.cmd({ t: 'leave', id: m.id, token: p && p.token && S.departed ? p.token : null });
  }
  if (S.amonGame) S.amonGame.removePlayer(m.id);   // their board keeps fighting; the store runs itself
  if (S.rtsGame) S.rtsGame.setConnected(m.id, false);   // v1.2.27 RTS: a bot runs their base until they come back
  if (p && !S.inGame && !forced) toast(`${p.name} left`);
  lobbyChanged();
  if (S.inGame) sendMeta();
}
function onHostMsg(m) {
  const msg = m.msg || {}, from = m.from;
  if (msg.k !== 'hello' && msg.k !== 'setCos' && S.dropped && S.dropped.has(from)) return;
  switch (msg.k) {
    case 'hello': {
      (S.hello ||= new Set()).add(from);
      const v = String(msg.v || '').slice(0, 16), mine = appVersion();
      if (v !== mine) dropPeer(from, `Version mismatch: the host has ${mine}, you have ${v || 'an older version'}. Everyone needs the same version to play together.`);
      else S.net.send({ t: 'toPeer', id: from, msg: { k: 'helloOk', v: mine } });
      break;
    }
    case 'input': {   // v1.2.3: newest-only, acks and the jitter hold-back are worked out with the match (hostsim.js input)
      const i = msg.i || {};
      if (S.game) S.game.cmd({ t: 'input', from, i, now: performance.now() }); if (S.hostNet) S.hostNet.onInput(from); break;
    }
    case 'ping': (S.hostNet ||= new HostNetStats()).onPing(from, msg, r => S.net.send({ t: 'toPeer', id: from, msg: r })); break;
    case 'amon': if (S.amonGame) S.amonGame.action(from, msg.a); break;
    case 'rts': if (S.rtsGame) S.rtsGame.action(from, msg.a); break;
    case 'pick': if (S.game) S.game.cmd({ t: 'pick', from, card: msg.card }); break;
    case 'giftOffer': if (S.game) S.game.cmd({ t: 'giftOffer', from, to: msg.to, card: msg.card }); break;   // v1.2.26 tournament card trades
    case 'giftAccept': if (S.game) S.game.cmd({ t: 'giftAccept', from, card: msg.card }); break;
    case 'giftDecline': if (S.game) S.game.cmd({ t: 'giftDecline', from }); break;
    case 'lootPick': if (S.game) S.game.cmd({ t: 'loot', from, card: msg.card }); break;
    case 'reroll': if (S.game) S.game.cmd({ t: 'reroll', from }); break;
    case 'comboChoice': if (S.game) S.game.cmd({ t: 'combo', from, accept: !!msg.accept }); break;
    case 'breakChoice': if (S.game) S.game.cmd({ t: 'break', from, card: msg.card || null }); break;
    case 'pause': if (S.inGame && canPauseAll()) { if (msg.on) S.pausers.add(from); else S.pausers.delete(from); S.paused = S.pausers.size > 0; } break;
    case 'setTeam': if (!S.inGame) { const p = S.lobby.players.find(q => q.id === from); if (p) { p.team = Math.max(0, Math.min(ART.teamNames.length - 1, msg.team | 0)); lobbyChanged(); } } break;
    case 'setCos': if (!S.hello || !S.hello.has(from)) { if (!(S.dropped && S.dropped.has(from))) dropPeer(from, `The host has ${appVersion()} and your game is older. Everyone needs the same version to play together.`); break; }
      if (!S.inGame) { const p = S.lobby.players.find(q => q.id === from); if (p) { p.cosmetics = cleanCos(msg.cos); lobbyChanged(); } } break;
    case 'setFac': if (!S.inGame) { const p = S.lobby.players.find(q => q.id === from); if (p) { p.fac = msg.fac === 'hive' ? 'hive' : 'steel'; lobbyChanged(); } } break;
    case 'setName': if (!S.inGame) { const p = S.lobby.players.find(q => q.id === from); if (p) { p.name = cleanName(msg.name); lobbyChanged(); } } break;
    case 'emote': if (S.inGame) emoteFrom(from, msg); break;
    case 'bet': if (S.inGame && +msg.a > 0) { const ev = { t: 'bet', p: from, a: Math.floor(+msg.a) }; hostEv(ev); handleEvent(ev); } break;
    case 'fsel': fselAction(from, msg); break;
    case 'setColor': if (!S.inGame) { const p = S.lobby.players.find(q => q.id === from); if (p && ART.ffaColors.includes(msg.color)) claimColor(from, msg.color); } break;
  }
}
function onPeerMsg(m) {
  const msg = m.msg || {};
  switch (msg.k) {
    case 'lobby': S.lobby = msg.lobby; renderLobby(); break;
    case 'apub': case 'afield': if (S.amon) S.amon.onMsg(msg); break;
    case 'rpub': case 'rsnap': case 'rmap': if (S.rts) S.rts.onMsg(msg); break;
    case 'fsel': fsel = msg.f; if (currentScreen !== 'fighterPick' && currentScreen !== 'pause') { show('fighterPick'); setLeaveLabels(); } renderFsel(); break;
    case 'start': beginGame(msg.roster, msg.settings, msg.late); break;
    case 'rosterAdd': if (S.inGame && msg.r && msg.r.id !== S.localId) { const prev = S.roster.get(msg.r.id); S.roster.set(msg.r.id, { ...msg.r, cards: prev ? prev.cards : [] }); scoreKeyCache = ''; } break;
    case 'cardsAll': for (const e of msg.list || []) { const r = S.roster.get(e.p); if (r) { r.cards = e.cards; r.stats = e.s; } } scoreKeyCache = ''; renderChips(); break;
    case 'note': toast(msg.text); break;
    case 'helloOk': S.helloOk = true; break;
    case 'level': setRmodTag(msg.level.rmod); S.peerLevel = prepareLevel(msg.level); renderer.setLevel(S.peerLevel); if (S.pred) S.pred.base = null; S.predSolids = null; break;
    case 'snap': if (S.inGame) { const a = performance.now(); if (NL.on) netLogSnap(a, msg._sz); applySnap(msg.s); HM.msg.add(performance.now() - a); if (msg._sz && S.peerNet) S.peerNet.sizeW.add(msg._sz); } break;
    case 'pong': if (S.peerNet) S.peerNet.onPong(msg); break;
    case 'netRows': S.netRows = msg.ns; break;   // v1.0.1: AMON has no snapshots, so the host sends the window's rows on their own
    case 'offer': if (S.inGame) showPick(msg.offer, msg.rerolls, msg.info); break;
    case 'comboAsk': if (S.inGame) showComboAsk(msg.combo); break;
    case 'breakAsk': if (S.inGame) showBreakAsk(msg.opts || []); break;
    case 'toLobby': clearInterval(fselIv); fsel = null; pauseReturn = 'none'; endToLobby(); break;
  }
}

// ---------------------------------------------------------------- brawl fighter select (before the match)
// One shared screen like the card pick: everyone sees the same grid. Under each fighter, a ring shows who is looking at
// it and a filled dot who locked it in. Right-click opens that fighter's cards in the detail window (only on your screen).
// v28: no time limit; bots lock in their fighters straight away (so you can see who plays whom), and once every
// player has locked in, a 3 second countdown starts the match.
const FSEL_GO = 3;
let fsel = null, fselIv = null, fselThumbs = null;
function fselSend() { if (S.role === 'host') S.net.send({ t: 'toAll', msg: { k: 'fsel', f: fsel } }); renderFsel(); }
function startFighterSelect() {
  const colors = assignColors(S.lobby.players, 'ffa');
  const all = S.lobby.players.map((p, i) => ({ p, c: colors[i] })), humans = all.filter(o => !o.p.isBot), bots = all.filter(o => o.p.isBot);
  fsel = { left: -1, picks: {}, hover: {}, players: all.map(o => ({ id: o.p.id, name: o.p.name, color: o.c, bot: !!o.p.isBot })) };
  for (const o of humans) fsel.hover[o.p.id] = fighterOf(o.p.cosmetics);
  const free = FIGHTER_IDS.slice().sort(() => Math.random() - 0.5);
  for (const o of bots) { const f = free.length ? free.pop() : FIGHTER_IDS[Math.floor(Math.random() * FIGHTER_IDS.length)]; fsel.picks[o.p.id] = fsel.hover[o.p.id] = f; }
  show('fighterPick'); setLeaveLabels(); fselSend();
  let goAt = 0;
  clearInterval(fselIv);
  fselIv = setInterval(() => {
    if (!fsel || S.inGame) { clearInterval(fselIv); return; }
    const ready = fsel.players.every(p => fsel.picks[p.id]);
    if (!ready) { goAt = 0; if (fsel.left !== -1) { fsel.left = -1; fselSend(); } return; }
    if (!goAt) goAt = Date.now() + FSEL_GO * 1000;
    const left = Math.max(0, Math.ceil((goAt - Date.now()) / 1000));
    if (left === 0) return finishFighterSelect();
    if (left !== fsel.left) { fsel.left = left; fselSend(); sound.play('ui', 0.6); }
  }, 100);
}
function fselAction(from, a) {   // host
  if (!fsel || !FIGHTERS[a.id] || !fsel.players.some(p => p.id === from && !p.bot)) return;
  if (a.lock) { fsel.picks[from] = a.id; fsel.hover[from] = a.id; }
  else if (!fsel.picks[from]) fsel.hover[from] = a.id;
  fselSend();
}
function finishFighterSelect() {
  clearInterval(fselIv);
  const f = fsel; fsel = null;
  S.fselPicks = {}; for (const p of f.players) S.fselPicks[p.id] = f.picks[p.id] || f.hover[p.id];
  startMatch();
}
function fselLocal(id, lock) {
  if (!fsel) return;
  if (S.role === 'host' || !S.net) fselAction(S.localId, { id, lock });
  else S.net.send({ t: 'toHost', msg: { k: 'fsel', id, lock } });
  if (lock) sound.play('ui');
}
function fighterThumb(id) {   // a still of each fighter's body, rendered once
  if (!fselThumbs) fselThumbs = {};
  if (fselThumbs[id]) return fselThumbs[id];
  try {
    const W = 150, H = 130, r = fighterThumb.r || (fighterThumb.r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }));
    r.setSize(W, H, false);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
    cam.position.set(0, 1.3, 4.4); cam.lookAt(0, 0.9, 0);
    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a4256, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(2, 4, 3); scene.add(sun);
    const m = buildPlayerModel(ART.ffaColors[FIGHTER_IDS.indexOf(id) % ART.ffaColors.length], 'cube', id);
    m.root.rotation.y = -0.5; scene.add(m.root);
    r.render(scene, cam);
    fselThumbs[id] = r.domElement.toDataURL();
  } catch { fselThumbs[id] = ''; }
  return fselThumbs[id];
}
function renderFsel() {
  if (!fsel) return;
  $('fselTimer').textContent = fsel.left > 0 ? `Starting in ${fsel.left}…` : 'No time limit: lock in a fighter';
  const grid = $('fselGrid'), mine = fsel.picks[S.localId];
  if (!grid.children.length) {
    for (const id of FIGHTER_IDS) {
      const b = document.createElement('button'); b.className = 'fsel'; b.dataset.f = id; b.dataset.noi18n = '';
      const src = fighterThumb(id);
      b.innerHTML = (src ? `<img alt="" src="${src}">` : '') + `<b>${esc(FIGHTERS[id].name)}</b><small>${esc((cardById.get(FIGHTERS[id].cards[0]) || { name: '' }).name)}</small><span class="dots"></span>`;
      b.onclick = () => fselLocal(id, true);
      b.onmouseenter = () => { if (!fsel || !fsel.picks[S.localId]) fselLocal(id, false); };
      grid.appendChild(b);
    }
  }
  for (const b of grid.children) {
    const id = b.dataset.f;
    b.classList.toggle('mine', mine === id);
    b.querySelector('.dots').innerHTML = fsel.players.filter(p => fsel.hover[p.id] === id).map(p => `<i class="${fsel.picks[p.id] ? 'lock' : ''}" style="color:${p.color}" title="${esc(p.name)}"></i>`).join('');
  }
  $('fselWho').innerHTML = fsel.players.map(p => `<span data-noi18n><i style="background:${p.color}"></i>${esc(p.name)}${p.bot ? ' 🤖' : ''}${fsel.picks[p.id] ? ` ✓ <small>${esc(FIGHTERS[fsel.picks[p.id]].name)}</small>` : ''}</span>`).join('');
}
function openFighterDetail(id) {
  const F = FIGHTERS[id], box = $('cdCard'); box.innerHTML = ''; box.classList.add('fcards');
  for (const cid of F.cards) { const c = cardById.get(cid); if (c) box.appendChild(cardEl(c, { exact: true })); }
  $('cdInfo').innerHTML = `<h3 data-noi18n>${esc(F.name)}</h3><section><h5>Build</h5><p>This fighter always plays with these cards. Hits raise damage %; the higher it is, the farther you fly.</p></section>`;
  $('cardDetail').classList.remove('hidden');
  sound.play('ui');
}

// ---------------------------------------------------------------- match
function startMatch() {
  if (!isHostSide()) return;
  const err = validateLobby();
  if (err) { $('lobbyError').textContent = err; return; }
  if (S.lobby.settings.mode === 'brawl' && !S.fselPicks) { startFighterSelect(); return; }   // brawl: everyone picks a fighter first
  const colors = assignColors(S.lobby.players, owSquads(S.lobby.settings) || teamPlay(S.lobby.settings) ? 'tdm' : S.lobby.settings.mode === 'core' ? 'waves' : S.lobby.settings.mode);
  const waves = S.lobby.settings.mode === 'waves' || S.lobby.settings.mode === 'core' || (S.lobby.settings.mode === 'open' && !owSquads(S.lobby.settings));
  let roster = S.lobby.players.map((p, i) => ({ id: p.id, name: p.name, team: waves ? 0 : (p.team || 0), isBot: !!p.isBot, difficulty: p.difficulty || 'normal', color: colors[i], cosmetics: p.cosmetics || null, kind: 'hero', fac: p.fac || null }));
  if (S.lobby.settings.mode === 'practice') roster = practiceRoster(roster.find(r => r.id === S.localId) || roster[0]);
  if (S.lobby.settings.mode === 'brawl') {   // brawl: players fight as their chosen character; bots take the fighters nobody has
    const fp = S.fselPicks || {}; S.fselPicks = null;
    roster = roster.map(r => !fp[r.id] ? r : { ...r, cosmetics: { ...(r.cosmetics || {}), model: fp[r.id] } });   // (v28: bots' instant picks too)
    const used = new Set(roster.filter(r => !r.isBot).map(r => fighterOf(r.cosmetics)));
    const free = FIGHTER_IDS.filter(id => !used.has(id)).sort(() => Math.random() - 0.5);
    roster = roster.map(r => r.isBot && !fp[r.id] ? { ...r, cosmetics: { ...(r.cosmetics || {}), model: free.length ? free.pop() : FIGHTER_IDS[Math.floor(Math.random() * FIGHTER_IDS.length)] } } : r);
  }
  if (S.lobby.settings.mode === 'rts') {   // v1.2.27 RTS (rts.js): its own simulation, no shooter Game
    // v1.2.30: on its own CPU thread (+ helper threads for pathing) when Settings > CPU threads allows (rtshost.js)
    if (S.rtsGame) S.rtsGame.close();
    if (S.game) S.game.close(); S.game = null; S.rtsGame = makeRtsHost({ roster, settings: { ...S.lobby.settings }, cards: CARDS, seed: (Math.random() * 1e9) >>> 0 }, threadCount(settings.cpuThreads), why => toast('The RTS thread stopped: ' + String(why).slice(0, 120)));
    S.rtsSeat = new Map(S.lobby.players.filter(p => p.token && !p.isBot).map(p => [p.token, p.id]));
    S.pausers = new Set();
    if (S.role === 'host') { S.net.send({ t: 'toAll', msg: { k: 'start', roster, settings: S.lobby.settings } }); sendMeta({ started: true }); }
    beginGame(roster, S.lobby.settings);
    return;
  }
  if (S.lobby.settings.mode === 'amon') {   // AMON autobattler (amon.js): its own simulation, no shooter Game
    if (S.game) S.game.close(); S.game = null; S.amonGame = new AmonGame({ roster, settings: { ...S.lobby.settings }, cards: CARDS });
    S.pausers = new Set();
    if (S.role === 'host') { S.net.send({ t: 'toAll', msg: { k: 'start', roster, settings: S.lobby.settings } }); sendMeta({ started: true }); }
    beginGame(roster, S.lobby.settings);
    return;
  }
  // Cursed cards and weapon mods are always in the pool.
  // v1.2.30: the match runs on its own CPU thread when Settings > CPU threads allows (simlink.js, hostsim.js)
  if (S.game) S.game.close();
  S.game = new SimLink({ roster, settings: { ...S.lobby.settings }, cards: CARDS, localId: S.localId, host: S.role === 'host', practiceCards: S.lobby.settings.mode === 'practice' ? S.practiceCards || null : null }, threadCount(settings.cpuThreads), simHandlers());
  S.pausers = new Set();
  if (S.role === 'host') {
    S.net.send({ t: 'toAll', msg: { k: 'start', roster, settings: S.lobby.settings } });
    sendMeta({ started: true });
  }
  beginGame(roster, S.lobby.settings);
  S.game.start();
  if (S.lobby.settings.mode === 'practice') openPracticePanel(true);
}
function practiceRoster(me) {
  const st = S.lobby.settings, n = Math.max(1, Math.min(6, st.dummyCount || 3));
  const out = [{ ...me, team: 0, color: settings.color || ART.ffaColors[0] }];
  for (let i = 0; i < n; i++) out.push({ id: 'd' + (i + 1), name: `Dummy ${i + 1}`, team: 1, isBot: true, dummy: true, difficulty: 'normal', color: '#c9ced8', cosmetics: null, kind: 'hero' });
  return out;
}

function beginGame(roster, matchSettings, late = false) {
  S.inGame = true; S.lateJoined = !!late; S.matchSettings = { ...DEFAULT_LOBBY_SETTINGS, ...matchSettings };
  S.roster = new Map(roster.map(r => [r.id, { ...r, cards: [] }]));
  if (S.amon) { S.amon.dispose(); S.amon = null; }
  if (S.rts) { S.rts.dispose(); S.rts = null; }
  if (S.matchSettings.mode === 'amon') { beginAmon(late); return; }
  if (S.matchSettings.mode === 'rts') { beginRts(late); return; }
  if (S.matchSettings.mode === 'open') S.matchSettings.commander = false;
  if (S.matchSettings.mode === 'core') { S.matchSettings.mode = 'waves'; S.matchSettings.core = true; S.matchSettings.side = false; S.matchSettings.commander = false; }   // Core Defense plays as co-op waves (core.js)
  S.matchSettings.core = !!S.matchSettings.core && S.matchSettings.mode === 'waves';
  if (S.matchSettings.mode === 'brawl') { S.matchSettings.mode = 'ffa'; S.matchSettings.brawl = true; }   // brawl plays as a free-for-all (brawl.js)
  S.matchSettings.brawl = !!S.matchSettings.brawl && S.matchSettings.mode === 'ffa';
  if (S.matchSettings.brawl) { S.matchSettings.side = true; S.matchSettings.commander = false; }
  S.matchSettings.side = !!S.matchSettings.side && S.matchSettings.mode !== 'open';
  $('legend').classList.toggle('hidden', !!(S.matchSettings.side || S.matchSettings.mode === 'core' || S.matchSettings.core));   // the height legend is for the top-down arenas
  $('legend').classList.remove('brief'); void $('legend').offsetWidth; $('legend').classList.add('brief');   // v1.2.0: shown for the first seconds of a match (and in the pause menu), then it fades away
  if (S.matchSettings.side) {   // 2D side view: always the side camera (no first person)
    if (S.owPrevView == null) S.owPrevView = settings.view;
    settings.view = 'third';
  }
  if (S.matchSettings.mode === 'open') {   // open world: mouse-look always (Tab: first person or over the shoulder)
    if (S.owPrevView == null) S.owPrevView = settings.view;
    settings.view = 'first'; renderer.owThird = renderer.owThird ?? true;
  }
  renderer.applySettings({ ...settings, view: S.matchSettings.commander ? 'third' : settings.view });
  if (S.matchSettings.commander) toast('Commander mode: your bot fights, you pick the cards.');
  if (late) toast('You joined a match in progress. You\'ll spawn next round.');
  $('practice').classList.add('hidden'); statsKey = ''; hoverId = null;
  S.pmap = new Map(); S.bmap = new Map(); S.levelVersion = -1; S.outEvents = []; S.paused = false; S.offer = null;
  S.enc = null; S.dec = null; S.acks = null; S.pred = null; S.inHist = []; S.lastIn = null; S.netRows = null;   // v30 netcode state
  S.predSolids = null; S.clk = null; S.shotPred = []; S.jumpPred = []; S.lastShotFx = 0; S.prevShotSeq = I.shotSeq; S.prevShoot = false;   // (v1.2.6)
  if (S.role === 'peer') S.peerNet = new PeerNetStats(msg => S.net.send({ t: 'toHost', msg }));
  else if (S.role === 'host') S.hostNet ||= new HostNetStats();
  S.bet = 0; S.betPay = 0; S.betOpen = !late; S.paid = { roundsWon: 0, kills: 0, damage: 0 }; S.paidT = performance.now(); betKey = '';
  S.view = { players: [], bullets: [], barricades: [], dynamics: [], shields: [], mines: [], laser: null, phase: 'countdown', scores: {}, round: 0, waiting: 0 };
  renderer.clearAll();
  show('none');
  $('hud').classList.remove('hidden');
  renderChips(); scoreKeyCache = ''; $('killfeed').innerHTML = '';
  setModeTip(S.matchSettings);
  sound.playMusic('battle');
}

// v1.2.27 RTS: the world, camera, controls and HUD live in rtsui.js / rtshud.js. The host also steps S.rtsGame there.
function beginRts(late) {
  if (S.owPrevView == null) S.owPrevView = settings.view;
  settings.view = 'third';   // the RTS locks the mouse itself, only in fullscreen (F11)
  if (document.pointerLockElement) document.exitPointerLock();
  renderer.applySettings({ ...settings, view: 'third' });
  $('practice').classList.add('hidden'); $('hud').classList.add('hidden');
  S.outEvents = []; S.paused = false; S.offer = null;
  S.view = { players: [], bullets: [], barricades: [], dynamics: [], shields: [], mines: [], laser: null, phase: 'rts', scores: {}, round: 0, waiting: 0 };
  renderer.clearAll();
  show('none');
  const host = S.role !== 'peer';
  S.rts = new RtsClient({
    renderer, localId: S.localId, isHost: host, game: host ? S.rtsGame : null, cards: CARDS, keys, settings,
    net: S.role === 'host' ? S.net : null,
    rttOf: id => { const e = S.hostNet && S.hostNet.peers.get(id); return e && e.rtt > 0 ? e.rtt : 0; },
    send: a => S.net.send({ t: a.t === 'ack' || a.t === 'fps' ? 'toHostU' : 'toHost', msg: { k: 'rts', a } }),   // snapshot acks go unreliable; orders reliable
    toast, banner, sound,
    uiOpen: () => currentScreen !== 'none' || infoOpen(),
    openMenu: () => { if (currentScreen === 'none') togglePause(); },
    toLobby: () => { if (S.role === 'host') S.net.send({ t: 'toAll', msg: { k: 'toLobby' } }); if (S.role !== 'peer') endToLobby(); },
  });
  if (late) toast('You joined a match in progress.');
  setModeTip(S.matchSettings);
  sound.playMusic('battle');
}

// AMON: the store / board UI and the battlefield camera live in amonui.js. The host also steps S.amonGame there.
function beginAmon(late) {
  if (S.owPrevView == null) S.owPrevView = settings.view;
  settings.view = 'third';   // no pointer lock: the mouse runs the store
  if (document.pointerLockElement) document.exitPointerLock();
  renderer.applySettings({ ...settings, view: 'third' });
  $('practice').classList.add('hidden'); $('hud').classList.add('hidden');
  S.outEvents = []; S.paused = false; S.offer = null;
  S.view = { players: [], bullets: [], barricades: [], dynamics: [], shields: [], mines: [], laser: null, phase: 'amon', scores: {}, round: 0, waiting: 0 };
  renderer.clearAll();
  show('none');
  const host = S.role !== 'peer';
  S.amon = new AmonClient({
    renderer, localId: S.localId, isHost: host, game: host ? S.amonGame : null, cards: CARDS, keys,
    net: S.role === 'host' ? S.net : null,
    rttOf: id => { const e = S.hostNet && S.hostNet.peers.get(id); return e && e.rtt > 0 ? e.rtt : 0; },
    send: a => S.net.send({ t: (a.t === 'pin' && !a.dash) || a.t === 'aack' ? 'toHostU' : 'toHost', msg: { k: 'amon', a } }),   // v1.2.6: pilot input (resent 15x a second) and field acks go unreliable: one lost packet no longer stalls the rest
    toast, banner, sound,
    toLobby: () => { if (S.role === 'host') S.net.send({ t: 'toAll', msg: { k: 'toLobby' } }); if (S.role !== 'peer') endToLobby(); },
  });
  if (late) toast('You joined a match in progress. Your store opens with catch-up gold.');
  setModeTip(S.matchSettings);
  sound.playMusic('battle');
}

// Small bottom-left reminder of the controls that differ from the standard arena in this mode.
function setModeTip(ms) {
  const el = $('modeTip'); if (!el) return;
  const k = a => esc(codeLabel((BINDS[a] || [])[0] || '')) || '?';
  let h = '';
  if (!ms) h = '';
  else if (ms.mode === 'amon') h = `<b>AMON</b>: drag cards from the store onto storage or the board to buy; drop a card on another copy to upgrade; drag onto the money bag to sell. Scroll zooms, hold middle mouse to rotate, ${k('up')}${k('left')}${k('down')}${k('right')} pans, Q / E switch fields, Tab leaderboard. In battle, click one of your units and press Space to take control of it (left button attacks, right button blocks if it can).`;
  else if (ms.mode === 'rts') h = `<b>RTS</b>: drag a box or click to select, right-click to move, attack or mine. A then click attack-moves, Shift queues orders, Ctrl+number saves a group, double-tap the number to jump to it. Riggers build (B). F1 idle worker, F2 army, F3 research, Space last alert. Arrow keys, screen edges or the minimap move the camera; the wheel zooms. The mouse stays inside the game window (Settings can turn this off).`;
  else if (ms.brawl) h = `<b>Brawl</b>: ${k('jump')} again in the air for a second jump. In the air, hold ${k('dash')} to charge a dash toward the mouse and let go to dash (once per jump). Near a ledge you hang on: ${k('jump')} climbs up. While respawning, ${k('jump')} drops in early. ${k('down')} + ${k('jump')} drops through platforms.`;
  else if (ms.side) h = `<b>2D</b>: ${k('left')} / ${k('right')} move, ${k('up')} or ${k('jump')} jumps, ${k('down')} + ${k('jump')} drops through a platform. The mouse aims anywhere. Block as you touch the red wall to bounce off it.`;
  else if (ms.core) h = `<b>Core defense</b>: tap ${k('use')} to pick up a block, plank, slab, steel or spikes (or catch one as it falls). Hold ${k('use')} to show the hologram of where it goes (aim at a block to stack on top), scroll the mouse wheel to turn it, and let go to place it. Stack up to four high. No shooting while carrying; unsupported blocks fall. Hold ${k('use')} next to the core to pick it up and move it (press again to set it down). <b>Enter</b> readies you for the wave.`;
  else if (ms.mode === 'open') h = `<b>Open world</b>: ${k('jump')} leaves the bus and opens the chute. ${k('use')} gets in or out of vehicles${ms.owType === 'extract' ? ' and, held on a fallen teammate, revives them' : ''}. ${k('crouch')} crouches, ${k('view')} switches first / third person. Walk into an item to choose a card.`;
  else if (ms.mode === 'practice') h = `<b>Practice</b>: P opens the practice panel. Right click a card there for its details.`;
  el.innerHTML = h; el.classList.toggle('hidden', !h); el.classList.toggle('top', !!(ms && (ms.mode === 'amon' || ms.mode === 'rts' || ms.brawl)));   // AMON store / brawl fighter cards sit at the bottom
  el.classList.toggle('amon', !!(ms && (ms.mode === 'amon' || ms.mode === 'rts')));
  el.classList.remove('brief'); void el.offsetWidth; if (h) el.classList.add('brief');   // v1.2.0: the controls tip fades after a while (Wiki and Settings keep the full list)
}
// Open world loot: a small 3-card choice at the bottom of the screen. 1 / 2 / 3 (or a click with a free cursor) takes one.
function showLootPick(ids, left) {
  S.lootOffer = ids && ids.length ? ids.slice() : null;
  const box = $('lootPick'), row = $('lootCards');
  row.innerHTML = '';
  if (!S.lootOffer) { box.classList.add('hidden'); return; }
  S.lootOffer.forEach((id, i) => { const c = cardById.get(id); if (!c) return; const el = cardEl(c, { index: i, button: true }); el.classList.add('mini'); el.onclick = () => chooseLoot(i); row.appendChild(el); });
  // v28: none of them fit your build? discard the lot
  const dis = document.createElement('button'); dis.className = 'btn ghost small lpdiscard'; dis.textContent = '🗑 Discard (4)'; dis.title = 'Take none of these cards'; dis.onclick = () => chooseLoot(-1); row.appendChild(dis);
  box.querySelector('small').textContent = `(press 1, 2 or 3, or 4 to discard${left ? `; ${left} more waiting` : ''})`;
  box.classList.remove('hidden'); sound.play('ui');
}
function chooseLoot(i) {
  const id = i === -1 && S && S.lootOffer ? LOOT_DISCARD : S && S.lootOffer && S.lootOffer[i]; if (!id) return;
  S.lootOffer = null; $('lootPick').classList.add('hidden');
  if (S.game) S.game.cmd({ t: 'loot', from: S.localId, card: id });
  else S.net.send({ t: 'toHost', msg: { k: 'lootPick', card: id } });
}
function restoreView() { if (S && S.owPrevView != null) { settings.view = S.owPrevView; S.owPrevView = null; } }
// v29: the pause menu's leave button. The host (or solo play) takes everyone back to the lobby, keeping the same
// players and host; a joined player disconnects to the main menu. The practice range has no lobby, so it goes to the title.
function leaveLabel() {
  if (!S) return 'Leave';
  if (S.role === 'peer') return 'Disconnect';
  return S.matchSettings && S.matchSettings.mode === 'practice' ? 'Leave range' : 'Leave to lobby';
}
function setLeaveLabels() { const l = t(leaveLabel()); $('leaveMatchBtn').textContent = l; $('fselLeave').textContent = l; }
function leaveMatch() {
  if (!S) return;
  if (S.role === 'peer' || (S.matchSettings && S.matchSettings.mode === 'practice')) return leaveSession();
  clearInterval(fselIv); fsel = null; pauseReturn = 'none';
  if (S.pausers) S.pausers.clear(); S.paused = false;
  if (S.role === 'host') S.net.send({ t: 'toAll', msg: { k: 'toLobby' } });
  endToLobby();
}
function endToLobby() {
  if (!S) return;
  restoreView(); setModeTip(null);
  $('legend').classList.remove('hidden');
  renderer.applySettings(settings);
  S.inGame = false; if (S.game) S.game.close(); S.game = null; S.offer = null;
  if (S.amon) { S.amon.dispose(); S.amon = null; } S.amonGame = null;
  if (S.rts) { S.rts.dispose(); S.rts = null; } if (S.rtsGame) S.rtsGame.close(); S.rtsGame = null; S.rtsSeat = null;
  if (S.lobby.settings.mode === 'practice') S.lobby.settings.mode = 'ffa';   // the practice range lives on the title screen only
  $('practice').classList.add('hidden'); $('statsWin').classList.add('hidden'); $('hoverTip').classList.add('hidden');
  renderer.clearAll();
  $('hud').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
  if (S.role === 'host') sendMeta({ started: false });
  renderLobby(); show('lobby');
}

const GAMBLE_TAGS = ['🎲 ×2 dmg', '🎲 +bullets', '🎲 bouncy', '🎲 homing'];
// Words above a head: the Gambler's Mag roll, the Bounty Mark, a Snare Plate root
function ncTag(v) {
  const n = v.nc; if (!n || !v.alive) return '';
  return [n.bounty ? '🏴 BOUNTY' : '', n.rooted ? '🪤 ROOTED' : '', n.gam >= 0 ? GAMBLE_TAGS[n.gam] || '' : ''].filter(Boolean).join('  ');
}
// Snare Plates are hidden from enemies: only the owner and their team see them
function friendOf(ownerId) {
  if (!S || ownerId === S.localId) return true;
  const mode = S.matchSettings && S.matchSettings.mode, o = S.roster.get(ownerId), me = S.roster.get(S.localId);
  return (teamPlay() || mode === 'waves' || mode === 'core') && !!o && !!me && (o.team || 0) === (me.team || 0);
}

// dt: real time since the last frame (up to 0.25 s). The match itself (stepping, joiners' inputs, snapshots) is in
// hostsim.js; v1.2.30: it may run on its own CPU thread, in which case what it worked out comes back a frame later
// (simFrame) while this thread draws.
function hostFrame(dt, ts = 1) {
  const g = S.game, t0 = performance.now(); NR.sim.tick(t0);
  const me = S.view && S.view.players.find(p => p.id === S.localId);
  g.cmd({ t: 'local', i: gatherInput(me || null) });
  let peers = null;
  if (S.role === 'host') {
    peers = [];
    for (const p of S.lobby.players) {
      if (p.isBot || p.id === S.localId) continue;
      const hn = S.hostNet && S.hostNet.peers.get(p.id); peers.push([p.id, hn && hn.rtt > 0 ? hn.rtt : 0]);
    }
    if (S.hostNet && t0 - (S.nsAt || 0) > 900) { S.nsAt = t0; g.cmd({ t: 'netRows', ns: S.hostNet.rows(), hf: [Math.round(NR.frame.hz()), Math.round(NR.sim.hz()), Math.round(NR.send.hz()), Math.round((HM.frame.get() || { v: 0 }).v), Math.round((HM.send.get() || { v: 0 }).v)] }); }   // (everyone's connection, once a second: network window)
  }
  g.frame({ dt, ts, paused: !!S.paused, t0, hostFps: document.hidden ? 0 : fastFps(), peers, pz: [...(S.pausers || [])].map(id => rosterOf(id).name) });
}
// what the match sends back (simlink.js handlers)
function simHandlers() {
  return {
    net: m => { if (S && S.net && S.role === 'host') S.net.send(m); },
    ui: m => { if (S && S.inGame) onSimUi(m); },
    frame: f => { if (S && S.inGame && S.game) simFrame(f); },
    departed: d => { if (!S || !S.departed) return; const c = (S.departedCos && S.departedCos.get(d.token)) || {}; S.departed.set(d.token, { ...d.rec, ...c }); },
    fail: why => { console.error(why); toast('The game thread stopped: ' + String(why).split('\n')[0].slice(0, 140)); },
  };
}
// the host's own card offers and questions, the same messages a joiner gets
function onSimUi(m) {
  if (m.k === 'offer') showPick(m.offer, m.rerolls, m.info);
  else if (m.k === 'comboAsk') showComboAsk(m.combo);
  else if (m.k === 'breakAsk') showBreakAsk(m.opts || []);
  else if (m.k === 'note') toast(m.text);
}
function simFrame(f) {
  if (f.level) { S.levelVersion = (S.levelVersion || 0) + 1; renderer.setLevel(f.levelObj || prepareLevel(f.level)); }
  S.shardStat = f.shards || null;   // v1.2.37: the tournament's arena threads (F2 window)
  S.brainStat = f.brains || null;   // v1.2.38: bot brain threads
  if (f.sent) { NR.send.tick(); const tn = performance.now(); if (HM.sendAt) HM.send.add(tn - HM.sendAt, null, tn); HM.sendAt = tn; }
  for (const e of f.evs) { handleEvent(e); if (!S || !S.game) return; }
  const v = f.view;
  v.mines = v.mines.filter(m => !m.snare || friendOf(m.o));   // (enemies' Snare Plates stay hidden)
  S.view = v; if (f.tn !== undefined) S.tn = f.tn; S.brawlRows = f.brawlRows; S.brawlT = f.brawlT;   // (v1.2.35: the tournament table comes only when it changed)
  if (S.tn) { const a = viewArena(); if (a !== S.wa) { S.wa = a; S.game.cmd({ t: 'watch', a }); } }   // v1.2.35: the host's match only sends this screen the arena it shows
}
// main-thread events (emotes, bets) for joiners: they go out with the match's next snapshot
function hostEv(e) { if (S && S.game) S.game.cmd({ t: 'ev', e }); }
// Unit roster updates must land before the player list is read, or brand-new units (twins, turrets,
// drones, wave enemies) show up white and without their extra parts on clients.
function applyRosterEvents(evs) {
  for (const e of evs || []) {
    // v1.2.6: only adds and refreshes here; units leave in handleEvent's in-order 'units' case, so this batch's earlier events about them still find them
    if (e.t === 'units') { for (const u of e.units) S.roster.set(u.id, { ...u, transient: true, cards: [] }); }
    else if (e.t === 'split') { for (const u of e.units) if (!S.roster.has(u.id)) S.roster.set(u.id, { ...u, transient: true, cards: [] }); }
  }
}
// v1.2.6: when a snapshot's state was taken, on this computer's clock. The host stamps each snapshot with its own clock
// (s.tm); the offset between the two clocks is the smallest (arrival - stamp) seen lately, creeping up 10 ms a second
// so a slower route or clock drift is followed. Bodies and bullets are then placed by that time, so network jitter no
// longer shows up as bullets and players jumping at each snapshot. (No stamp: counted from arrival, as before.)
function snapTime(s, now) {
  if (s.pz && s.pz.length) return Infinity;   // paused: nothing moves, so nothing is extrapolated
  if (!(s.tm > 0)) return now;
  const smp = now - s.tm, C = S.clk;
  if (!C || C.e !== S.dec.e) S.clk = { v: smp, t: now, e: S.dec.e };   // (a new match: start over)
  else { C.v = Math.min(smp, C.v + (now - C.t) * 0.01); C.t = now; }
  return s.tm + S.clk.v;
}
// Seconds to extrapolate something from a snapshot taken at st (k: the host's time scale then: slow motion), capped.
const snapAge = (st, k, t, cap) => Math.max(0, Math.min(cap, (t - st) / 1000 * k));
// Drawn position of a remote body / a bullet: snapshot position + velocity since then + a correction that fades out (off).
function placeBody(v, t, out) {
  const a = snapAge(v.st, v.k, t, S.snapHz < 30 ? 0.16 : 0.1), T = v.tgt, V = v.vel, O = v.off;   // (v1.2.25: longer gaps in big lobbies)
  out.x = T.x + V.x * a + O.x; out.y = T.y + V.y * a + O.y; out.z = T.z + V.z * a + O.z; return out;
}
function placeBullet(b, t, out) {
  const a = snapAge(b.st, b.k, t, 0.25), P = b.p0, V = b.vel, O = b.off;
  out.x = P.x + V.x * a + O.x; out.y = P.y + V.y * a + O.y; out.z = P.z + V.z * a + O.z; return out;
}
const setXYZ = (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o; };
function applySnap(s) {
  s = (S.dec ||= new AckDecoder()).decode(s);   // v1.2.3: rebuild the full snapshot (netcodec.js); null = older than one shown, or no base yet
  if (!s) return;
  if (S.peerNet) S.peerNet.onSnap(S.dec.lossPct());
  if (s.ns) S.netRows = s.ns;
  if (s.hf && S.peerNet) S.peerNet.hostRates = s.hf;
  applyRosterEvents(s.ev);
  const now = performance.now(), st = snapTime(s, now), sk = s.tk || 1, P = S.pred, tmp = { x: 0, y: 0, z: 0 };
  const v0 = S.view;
  v0.phase = s.ph; v0.phaseT = s.pt; v0.round = s.rd; v0.scores = s.sc; v0.waiting = s.pw; v0.pausedBy = s.pz || [];
  const seen = new Set();
  for (const a of s.pl) {
    const [id, x, y, z, ax, ay, az, hp, mhp, al, bl, am, mam, rl, bc, fl, vx, vy, vz, sky, bsz, mod, charge, broken, status, size, bfx, bspd, bgrav, pflags, rfrac, pfrac, healN, crit, fieldR, xt] = a;
    seen.add(id);
    let v = S.pmap.get(id);
    const r = S.roster.get(id) || {};
    if (!v) { v = { id, pos: { x, y, z }, aim: { x: 1, y: 0, z: 0 }, aimPoint: null, off: { x: 0, y: 0, z: 0 } }; S.pmap.set(id, v); }
    // Always refresh identity from the roster (unit ids can be reused across rounds).
    if (r.color) { v.name = r.name; v.color = r.color; v.team = r.team; v.kind = r.kind; v.am = r.am; v.cosmetics = r.cosmetics; v.raider = isRaider(r.kind, r.transient, r.ownerId); }
    else if (!v.color) v.color = '#ffffff';
    Object.assign(v, extFields(xt));
    v.fieldR = fieldR || 0; v.riotFrac = rfrac ?? -1; v.pillarFrac = pfrac ?? -1; v.healN = healN || 0; v.critters = crit ?? -1;
    v.blockFx = bfx || 0; v.flags = pflags || 0; if (bspd) v.bulletSpeed = bspd; if (bgrav) v.bulletGrav = bgrav;
    const teleport = !v.tgt || (!v.alive && al) || Math.hypot(x - v.pos.x, z - v.pos.z) > 6;
    // v1.2.6: smooth the correction, not the position (chasing the position drew everyone ~45 ms behind where they
    // were): keep drawing where the body was heading and let the difference fade out (v.off, peerFrame). Your own
    // predicted body is handed over by predictLocal instead.
    const keep = !teleport && !(id === S.localId && P && P.on);
    if (keep) placeBody(v, now, tmp);
    setXYZ(v.tgt ||= {}, x, y, z); setXYZ(v.vel ||= {}, vx, vy, vz); v.st = st; v.k = sk;
    if (teleport) { v.pos = { x, y, z }; setXYZ(v.off, 0, 0, 0); }
    else if (keep) { const ox = tmp.x, oy = tmp.y, oz = tmp.z; setXYZ(v.off, 0, 0, 0); placeBody(v, now, tmp); setXYZ(v.off, ox - tmp.x, oy - tmp.y, oz - tmp.z); }
    setXYZ(v.netAim ||= {}, ax, ay, az);
    if (id !== S.localId && teleport) v.aim = { x: ax, y: ay, z: az };   // (otherwise others' aim turns smoothly toward netAim: peerFrame)
    Object.assign(v, { mod: mod || null, charge, broken: !!broken, status, blockSize: bsz || 1, size: size || sizeFor(mhp), hp, maxHp: mhp, alive: !!al, blocking: !!bl, ammo: am, maxAmmo: mam, reloadFrac: rl, blockFrac: bc, flash: !!fl, sky: !!sky });
  }
  if (!s.partial) for (const id of [...S.pmap.keys()]) if (!seen.has(id)) S.pmap.delete(id);
  predAck(s.mv);
  // v1.2.6: bullets keep their objects and are placed like bodies (snapshot position + velocity since then + a fading
  // correction), so they no longer jerk at every snapshot. Your own new shots start from where your body is drawn.
  const bfx = new Map((s.bfx || []).map(e => [e[0], e])), nb = new Map(), me = S.pmap.get(S.localId);
  for (const [id, x, y, z, vx, vy, vz, r, o, ring, co] of s.bu) {
    let b = S.bmap.get(id); const old = !!b;
    if (old) placeBullet(b, now, tmp); else b = { id, pos: { x, y, z }, p0: {}, vel: {}, off: { x: 0, y: 0, z: 0 } };
    const ox = tmp.x, oy = tmp.y, oz = tmp.z;
    setXYZ(b.p0, x, y, z); setXYZ(b.vel, vx, vy, vz); b.st = st; b.k = sk; setXYZ(b.off, 0, 0, 0);
    if (old) { placeBullet(b, now, tmp); setXYZ(b.off, ox - tmp.x, oy - tmp.y, oz - tmp.z); if (Math.hypot(b.off.x, b.off.y, b.off.z) > 1.5) setXYZ(b.off, 0, 0, 0); }   // (a bounce or a homing turn: snap)
    else if (o === S.localId && P && P.on && me && me.tgt) {
      const a = snapAge(me.st, me.k, now, 0.1), dx = me.pos.x - me.tgt.x - me.vel.x * a, dy = me.pos.y - me.tgt.y - me.vel.y * a, dz = me.pos.z - me.tgt.z - me.vel.z * a;
      if (Math.hypot(dx, dy, dz) < 2.5) setXYZ(b.off, dx, dy, dz);
    }
    placeBullet(b, now, b.pos);
    b.r = r; b.ring = ring || 0; const fe = bfx.get(id); b.fx = fe && fe[1]; b.tgt = (fe && fe[2]) || 0; b.latch = !!(fe && fe[3]); b.color = (S.roster.get(co || o) || {}).color || '#ffffff'; b.o = o;
    nb.set(id, b);
  }
  S.bmap = nb;
  const col = o => (S.roster.get(o) || {}).color || '#ffffff';
  S.view.dynamics = (s.ob || []).map(([id, x, y, z, h, tip, tx, tz]) => ({ id, x, y, z, h, tip, tx: tx || 0, tz: tz || 0 }));
  S.view.shields = (s.sh || []).map(([id, x, y0, z, w, h, d, o, f, hp, ang]) => ({ id, x, y0, z, w, h, d, ang: ang || 0, shock: !!(f & 1), leech: !!(f & 2), box: !!(f & 4), hp: hp ?? 1, color: col(o), o }));
  S.view.mines = (s.mn || []).filter(r => !r[7] || friendOf(r[4])).map(([id, x, y, z, o, armed, sz, sn]) => ({ id, x, y, z, armed: !!armed, sz: sz || 1, snare: !!sn, color: col(o), o }));
  S.view.laser = s.lz || null;
  if (s.tp != null) S.trapClk = { t: s.tp, at: performance.now() }; else if ('tp' in s) S.trapClk = null;
  if (s.ow) { if (s.ow.lt) S.owTaken = new Set(s.ow.lt); s.ow.taken = S.owTaken || new Set(); }
  S.view.ow = s.ow || null;
  for (const [id, pct, stocks, fighter] of s.bw || []) { const v = S.pmap.get(id); if (v) { v.pct = pct; v.stocks = stocks; v.fighter = fighter; } }
  S.brawlRows = s.bw || null; S.brawlT = s.bwt ?? null; S.view.bitems = s.bi || null; S.view.bud = s.bud || null; S.snapHz = s.hz || 30; S.tn = s.tn ? tnJoin(s.tn, s.tq) : null;
  S.view.telegraphs = s.tg || null; S.view.shocks = s.sw || null; S.view.boss = s.bo || null; S.view.rituals = s.rt || null; S.view.relics = s.rl || null;
  S.view.barricades = (s.bc || []).map(([id, x, y0, z, len, h, th, hp, o, ang, kind]) => ({ id, x, y0, z, len, h, th, ang: ang || 0, kind: ['sandbag', 'concrete', 'pillar', 'block', 'cube', 'plank', 'slab', 'steel', 'spikes'][kind || 0] || 'sandbag', hp, color: col(o), o }));
  S.view.core = s.co || null;
  S.predSolids = predWorld(s);
  S.view.players = [...S.pmap.values()]; S.view.bullets = [...S.bmap.values()];   // (only change here; peerFrame moves what's in them)
  for (const e of s.ev || []) { handleEvent(e); if (!S) return; }
}
// v1.2.6: what your own prediction collides with, as the host has it: the level, every wall / built block (the same
// boxes as sim.js, physics.js wallSegments) and the props (crates, barrels, pistons, floats) where this snapshot has them.
const segCache = new WeakMap();   // wall row -> boxes (unchanged rows come back as the same array from the decoder)
function predWorld(s) {
  const L = S.peerLevel; if (!L) return null;
  const dyn = L.dynById ||= new Map((L.dynamic || []).map(d => [d.id, d])), extra = [], pushers = [], pv = S.obPrev ||= new Map();
  for (const r of s.bc || []) {
    let seg = segCache.get(r);
    if (!seg) { const [, x, y0, z, len, h, th, , , ang] = r; segCache.set(r, seg = wallSegments({ x, y0, z, len, h, th, ang: ang || 0 })); }
    for (const q of seg) extra.push(q);
  }
  for (const [id, x, y, z, h, tip] of s.ob || []) {
    const d = dyn.get(id); if (!d) continue;
    const w = tip === 1 || tip === 2 ? d.h : d.w, dd = tip === 3 || tip === 4 ? d.h : d.d;   // (a tipped crate lies on its side)
    const push = d.kind === 'crate' || d.kind === 'barrel';   // (a stand-in: the replay may shove it, nothing real moves)
    const box = { min: { x: x - w / 2, y, z: z - dd / 2 }, max: { x: x + w / 2, y: y + h, z: z + dd / 2 }, oneWay: !!d.oneWay, obj: push ? { kind: d.kind, pushable: true, vel: { x: 0, y: 0, z: 0 } } : { kind: d.kind } };
    if (push) {   // v1.2.9: how fast it was sliding (from the last snapshot), so the replay can slide it too (predReplay)
      const o = pv.get(id), dt = o && s.tm > o[2] ? (s.tm - o[2]) / 1000 : 0;
      box.pv = dt > 0 && dt < 0.25 ? { x: Math.max(-12, Math.min(12, (x - o[0]) / dt)), z: Math.max(-12, Math.min(12, (z - o[1]) / dt)) } : { x: 0, z: 0 };
      pv.set(id, [x, z, s.tm || 0]); pushers.push(box);
    }
    extra.push(box);
  }
  if (!extra.length) return L.solids;
  const W = L.solids.concat(extra);
  if (pushers.length) W.pushers = pushers;
  if (L.grid) { W.grid = L.grid; W.hAt = L.hAt; W.extra = extra; }   // open world: static boxes through the grid (sim.js refreshSolids)
  if (L.side) W.hAt = L.hAt;
  return W;
}

// v1.2.6: the window lost focus or was hidden (it then stops drawing frames): tell the host at once, reliably, that
// every key is up, so your character doesn't keep running and shooting there until you're back.
function peerNeutral() {
  if (!S || !S.inGame || S.role !== 'peer' || !S.net || S.amon || S.rts) return;
  const q = S.inQ = (S.inQ || 0) + 1, w = { q, mx: 0, mz: 0, blockSeq: I.blockSeq, reloadSeq: I.reloadSeq, useSeq: I.useSeq, js: I.jumpSeq, ss: I.shotSeq };
  if (I.ready) w.ready = I.ready; if (I.rot) w.rot = I.rot; if (settings.view === 'first') { w.fp = 1; if (settings.ots) w.ots = 1; }
  if (S.dec) w.a = S.dec.ack(); w.t = Math.round(performance.now());
  S.net.send({ t: 'toHost', msg: { k: 'input', i: w } });
  (S.inHist ||= []).push({ q, t: performance.now(), mx: 0, mz: 0, jump: false, js: I.jumpSeq });
  S.lastIn = null;
}
function peerFrame(dt) {
  const me = S.pmap.get(S.localId), P = S.pred;
  const inp = gatherInput(me);
  if (me && inp.aim && !S.matchSettings.commander) { me.aim = inp.aim; me.aimPoint = inp.aimPoint; }
  // v30: inputs go out 60 times a second, and right away when a button changes (shoot, jump, block, reload, use), so a
  // click reaches the host up to a frame sooner. Each carries a sequence number for prediction. v1.2.6: an even 60 (the
  // timer was reset at each send, ~40 a second on 60 Hz screens), and right away when a move key changes too (as a
  // mask, so first-person mouse-look doesn't count)
  S.sendT -= dt;
  const mk = (held('up') ? 1 : 0) | (held('down') ? 2 : 0) | (held('left') ? 4 : 0) | (held('right') ? 8 : 0) | (held('crouch') ? 16 : 0);
  const li = S.lastIn, edge = !li || mk !== S.lastMk || inp.shoot !== li.shoot || inp.jump !== li.jump || inp.dash !== li.dash || inp.block !== li.block || inp.reload !== li.reload || inp.blockSeq !== li.blockSeq || inp.reloadSeq !== li.reloadSeq || inp.useSeq !== li.useSeq || inp.jumpSeq !== li.jumpSeq || inp.shotSeq !== li.shotSeq || inp.rot !== li.rot;
  if (S.sendT <= 0 || edge) {
    if (S.sendT <= 0) S.sendT = S.sendT < -0.05 ? 1 / 60 : S.sendT + 1 / 60;
    S.lastMk = mk; inp.q = S.inQ = (S.inQ || 0) + 1; S.lastIn = inp;
    // v1.0.1: rounded and with the false / zero fields left out, an input is about half the bytes
    const r = (v, k) => Math.round(v * k) / k, w = { q: inp.q, mx: r(inp.mx, 1000), mz: r(inp.mz, 1000) };
    if (inp.blockSeq) w.blockSeq = inp.blockSeq; if (inp.reloadSeq) w.reloadSeq = inp.reloadSeq; if (inp.useSeq) w.useSeq = inp.useSeq;   // (v1.2.9: counters only once they've started; missing = 0 on the host)
    for (const f of ['drop', 'jump', 'dash', 'shoot', 'block', 'crouch', 'use', 'reload', 'fp', 'ots']) if (inp[f]) w[f] = 1;
    if (inp.jumpSeq) w.js = inp.jumpSeq; if (inp.shotSeq) w.ss = inp.shotSeq;
    if (inp.ready) w.ready = inp.ready; if (inp.rot) w.rot = inp.rot;
    if (inp.aim) w.aim = { x: r(inp.aim.x, 1000), y: r(inp.aim.y, 1000), z: r(inp.aim.z, 1000) };
    if (inp.aimPoint) w.aimPoint = { x: r(inp.aimPoint.x, 100), y: r(inp.aimPoint.y, 100), z: r(inp.aimPoint.z, 100) };
    if (S.dec) { const k = S.dec.ack(); if (k) { if (k[0] !== S.ackE) { S.ackE = k[0]; S.ackEn = 0; } w.a = S.ackEn++ >= 10 && inp.q % 30 ? k[1] : k; if (typeof w.a === 'number' && inp.q % 3 === 0 && k[2] !== S.ackK) { w.ak = S.ackK = k[2]; } } }   // (v1.2.12: ak / a[2] = events applied: on every 3rd input when it has changed, and in the full form)   // which snapshot we have, so the host sends only what changed since (v1.2.9: the match id only every 30th time, and the first 10 times after it changes)
    if (S.tn) w.wa = viewArena() ?? -1;   // v1.2.35: the tournament arena on screen (the host sends only that one)
    w.t = Math.round(performance.now());   // v1.2.9: when it was sent (host: queueInput)
    S.net.send({ t: 'toHostU', msg: { k: 'input', i: w } });
    (S.inHist ||= []).push({ q: inp.q, t: performance.now(), mx: inp.mx, mz: inp.mz, jump: inp.jump, js: inp.jumpSeq });
    if (S.inHist.length > 240) S.inHist.shift();
  }
  predictShot(me, inp);
  // v1.2.6: remote bodies: snapshot + velocity since then + a correction fading at 15/s; other players' aim turns smoothly
  const tNow = performance.now(), dk = Math.exp(-dt * 15), ka = 1 - Math.exp(-dt * 30), predOn = !!(P && P.on), L = S.peerLevel;
  for (const v of S.pmap.values()) {
    if (!v.tgt) continue;
    const O = v.off; O.x *= dk; O.y *= dk; O.z *= dk;
    if (v === me) { if (predOn) continue; }   // (predictLocal draws you)
    else if (v.netAim) {
      const A = v.aim, N = v.netAim;
      if (A.x * N.x + A.y * N.y + A.z * N.z <= 0) setXYZ(A, N.x, N.y, N.z);   // turned 90 degrees or more (2D facing flips are exactly 180): snap
      else {
        A.x += (N.x - A.x) * ka; A.y += (N.y - A.y) * ka; A.z += (N.z - A.z) * ka;
        const l = Math.hypot(A.x, A.y, A.z); if (l > 1e-3) { A.x /= l; A.y /= l; A.z /= l; } else setXYZ(A, N.x, N.y, N.z);
      }
    }
    placeBody(v, tNow, v.pos);
    if (v.vel.y < -0.5 && L && !L.side) { const gy = groundBelow(S.predSolids || L.solids, v.pos.x, v.pos.z, v.tgt.y + 0.05); if (v.pos.y < gy) v.pos.y = gy; }   // landing: not drawn sinking into the floor
  }
  for (const b of S.bmap.values()) { const O = b.off; O.x *= dk; O.y *= dk; O.z *= dk; placeBullet(b, tNow, b.pos); }
  predictLocal(dt, tNow);
}
// v1.2.6: on a joiner, the first shot of each trigger press shows its flash, sound and kick at once instead of a round
// trip later, when the host will surely fire it (alive, fighting, a plain gun, ammo left, not reloading or busy, the fire
// rate allows it). The host's own 'shoot' event for it is then skipped (handleEvent). Held fire after that follows the host.
function predictShot(me, inp) {
  if (S.prevShotSeq === undefined) S.prevShotSeq = inp.shotSeq;
  const press = inp.shotSeq !== S.prevShotSeq || (inp.shoot && !S.prevShoot), now = performance.now();
  if (inp.reloadSeq !== S.prevReloadSeq) { S.prevReloadSeq = inp.reloadSeq; S.reloadAt = now; }
  S.prevShotSeq = inp.shotSeq; S.prevShoot = inp.shoot;
  if (!press || !me || !me.alive || S.view.phase !== 'play' || S.matchSettings.commander || S.matchSettings.brawl || me.mod || me.sky || me.holding || me.reloadFrac > 0 || me.mount) return;   // (v1.2.8: manning a Gun Nest, the turret fires)
  const sp = S.shotPred ||= [], rtt = (S.peerNet && S.peerNet.rtt) || 150, rate = ((S.roster.get(S.localId) || {}).stats || {}).rate;
  while (sp.length && sp[0] < now - rtt - 250) sp.shift();
  if (!(rate > 0) || me.ammo - sp.length <= 0 || now - (S.lastShotFx || 0) < 1000 / (rate + 0.05) + 25 || now - (S.reloadAt || -1e9) < rtt + 150) return;
  const co = S.view.core, ow = S.view.ow;
  if (co && ((co.cr && co.cr.some(r => r[0] === S.localId)) || (co.cc && co.cc.some(r => r[0] === S.localId && r[1] >= 1)))) return;   // Core Defense: carrying a block (or the core)
  if (ow && (owStateOf(S.view, S.localId) || (ow.veh || []).some(r => r[6] === S.localId))) return;   // open world: bus, chute or a vehicle
  S.lastShotFx = now; sp.push(now);
  sound.play(settings.pillow ? 'uwu' : 'shoot', 0.9);
  renderer.muzzleFlash(S.localId, rosterOf(S.localId).color);
  renderer.gunKick();
  if (me.aim) renderer.shotKick(me.aim.x, me.aim.z, 1);
}
// A locally played effect still waiting for the host's event? Uses it up (they expire after about a round trip).
function takePred(list) {
  if (!list || !list.length) return false;
  const cut = performance.now() - ((S.peerNet && S.peerNet.rtt) || 150) - 250;
  while (list.length && list[0] < cut) list.shift();
  return list.length ? (list.shift(), true) : false;
}

// ---------------------------------------------------------------- v30 client-side prediction
// When you join someone else's game, your own character moves the moment you press a key instead of a round
// trip later. The host still decides where you really are: every snapshot says which of your inputs it has
// used (mv rows, sim.js predRows), so this replays the newer ones on top of the host's position with the same
// walk/jump physics (physics.js). Any difference is blended out over a few frames instead of snapping.
// Prediction pauses (host position, smoothed) whenever the simple model would be wrong: vehicles, moving
// floors, ice, holds, dashes, brawl and 2D.
function predAck(mv) {
  const me = S.pmap.get(S.localId);
  const row = (mv || []).find(r => r[0] === S.localId);
  if (!row || !me || !me.tgt) { if (S.pred) S.pred.ok = false; return; }
  const P = S.pred ||= { off: { x: 0, y: 0, z: 0 }, base: null };
  if (!P.prevBase) { P.prevBase = P.base; P.prevAck = P.ack; P.prevAge = P.age; P.prevK = { spd: P.spd, jv: P.jv, leash: P.leash }; }   // (v1.2.6: two snapshots in one frame: the one drawn last is the old picture; v1.2.9: with the speed, jump and leash it was drawn with)
  P.base = { pos: { ...me.tgt }, vel: { ...me.vel }, onGround: !!row[5] };
  [, P.ack, P.spd, P.jv] = row; P.ok = !!row[4]; P.age = row[6]; P.leash = row.length > 9 && row[9] > 0 ? row.slice(7, 10) : null;
  P.bp = row[10] || 0; P.adv = row[11] || 0;   // v1.2.15 Backpedal Boots
}
// v1.2.6: replays against the same world as the host (walls, built blocks and props too: predWorld) and with the host's
// jump rules: a press up to 0.13 s before landing still jumps (buffer), and you can still jump 0.1 s after walking off
// a ledge (coyote time). A jump that comes from a new press marks it, so predictLocal plays its sound once.
// v1.2.9: a crate or barrel you walk into slides away on the host (you shove it and slow down); its stand-in used to stay put,
// so the replay stopped dead against it and your view was pulled back up to ~0.3 m while pushing. Each replay now works on
// its own copies of the crates and slides them like the host does (the shove from physics.js movePlayer, ground friction).
function pushWorld(W) {
  const cp = new Map();
  for (const s of W.pushers) cp.set(s, { min: { ...s.min }, max: { ...s.max }, oneWay: s.oneWay, obj: { kind: s.obj.kind, pushable: true, vel: { x: s.pv.x, y: 0, z: s.pv.z } } });
  const W2 = W.map(s => cp.get(s) || s);
  if (W.grid) { W2.grid = W.grid; W2.extra = W.extra.map(s => cp.get(s) || s); }
  if (W.hAt) W2.hAt = W.hAt;
  W2.moving = [...cp.values()];
  return W2;
}
function slidePushers(W, st) {
  const f = Math.max(0, 1 - 5 * st);
  for (const c of W.moving) { const v = c.obj.vel; if (!v.x && !v.z) continue; c.min.x += v.x * st; c.max.x += v.x * st; c.min.z += v.z * st; c.max.z += v.z * st; v.x *= f; v.z *= f; }
}
function predReplay(base, ack, size, W, age, K) {
  if (W.pushers) W = pushWorld(W);
  const L = S.peerLevel, P = K || S.pred, b = { pos: { ...base.pos }, vel: { ...base.vel }, onGround: base.onGround, size, dropThru: 0 };
  unstick(b, W, L); seedThru(b, W, L);
  const hist = S.inHist || [], tNow = performance.now();
  let jb = 9, air = base.onGround ? 0 : 9, prev = null, src = null, skip = 0;
  for (let i = 0; i < hist.length; i++) {
    // v1.2.9: the base is where you were age ms after the host started on the newest input it has used (ack), so the replay
    // starts that far into it (and into the next ones, if the host has had it for longer than you held it)
    const h = hist[i], cur = h.q === ack && age >= 0; if (h.q < ack || (h.q === ack && !cur)) { prev = h; continue; }
    if (!cur && ((h.jump && !(prev && prev.jump)) || (prev && h.js !== prev.js))) { jb = 0; src = h; }
    prev = h;
    let rem = Math.min(0.25, ((i + 1 < hist.length ? hist[i + 1].t : tNow) - h.t) / 1000); if (cur) skip = age / 1000;
    if (skip > 0) { const k = Math.min(skip, rem); rem -= k; skip -= k; }
    while (rem > 1e-4) {
      const st = Math.min(rem, 1 / 60); rem -= st;
      const dk = P.bp || P.adv ? dirSpeedK(h.mx, h.mz, P.bp, P.adv) : 1;   // v1.2.15 Backpedal Boots (same as sim.js dirSpeedK)
      accel(b, h.mx * P.spd * dk, h.mz * P.spd * dk, st);
      if (b.onGround) air = 0; else if (air !== 9) air += st;
      if ((h.jump || jb < 0.13) && (b.onGround || (air < 0.1 && b.vel.y <= 0.5)) && P.jv > 0) {
        b.vel.y = P.jv; b.onGround = false; jb = air = 9;
        if (src && !src.jf) { src.jf = 1; S.jumpFx = true; }
      }
      movePlayer(b, st, L, W); if (W.moving) slidePushers(W, st);
      if (P.leash) { const [sx, sz, r] = P.leash, dx = b.pos.x - sx, dz = b.pos.z - sz, d = Math.hypot(dx, dz); if (d > r) { b.pos.x = sx + dx / d * r; b.pos.z = sz + dz / d * r; b.vel.x = 0; b.vel.z = 0; } }   // v1.2.9: prep-time leash, as sim.js
      jb += st;
    }
  }
  return b.pos;
}
function dirSpeedK(mx, mz, bp, adv) {
  const me = S.pmap.get(S.localId), a = me && me.aim, ml = Math.hypot(mx || 0, mz || 0), al = a ? Math.hypot(a.x, a.z) : 0;
  if (ml < 0.1 || al < 1e-3) return 1;
  const dot = (mx * a.x + mz * a.z) / (ml * al);
  return dot < 0 ? 1 + bp * -dot : Math.max(0.2, 1 - adv * dot);
}
function predictLocal(dt, tNow) {
  const me = S.pmap.get(S.localId), P = S.pred;
  if (!me || !P || !P.base || !P.ok || !me.alive || !S.peerLevel || settings.netPredict === false || S.matchSettings.commander) {
    if (P) P.prevBase = null;
    if (P && P.on) {   // v1.2.6: prediction stops: carry on from where you're drawn and fade into the host's position (no snap)
      P.on = false;
      if (me && me.tgt) {
        setXYZ(me.off, 0, 0, 0); const pl = placeBody(me, tNow, { x: 0, y: 0, z: 0 }), ox = me.pos.x - pl.x, oy = me.pos.y - pl.y, oz = me.pos.z - pl.z;
        if (Math.hypot(ox, oy, oz) < 6) setXYZ(me.off, ox, oy, oz);
        me.pos = placeBody(me, tNow, pl);
      }
    }
    return;
  }
  const start = !P.on;
  if (start) for (const h of S.inHist) h.jf = 1;   // (presses from before get their jump sound from the host)
  S.jumpFx = false;
  const W = S.predSolids || S.peerLevel.solids, pos = predReplay(P.base, P.ack, me.size || 1, W, P.age);
  if (start) {   // v1.2.6: (re)starting: begin where you're drawn and blend forward (it used to jump ahead by ping x speed)
    P.on = true; P.prevBase = null;
    P.off = { x: me.pos.x - pos.x, y: me.pos.y - pos.y, z: me.pos.z - pos.z };
    if (Math.hypot(P.off.x, P.off.y, P.off.z) > 2.5) P.off = { x: 0, y: 0, z: 0 };
    P.offV = null;
    while (S.inHist.length && S.inHist[0].q < P.ack) S.inHist.shift();   // the host has used these (the newest used one stays: jump edges)
  } else if (P.prevBase) {   // a new snapshot came in: keep the picture where it was and blend the correction out
    const old = predReplay(P.prevBase, P.prevAck, me.size || 1, P.drawW || W, P.prevAge, P.prevK);   // (v1.2.6: in the world it was drawn in, so a wall or crate that just showed up is eased into, not snapped to)
    if (S.peerNet && S.peerNet.onCorr) S.peerNet.onCorr(Math.hypot(old.x - pos.x, old.y - pos.y, old.z - pos.z));   // v1.2.9: shown in the network window
    P.off.x += old.x - pos.x; P.off.y += old.y - pos.y; P.off.z += old.z - pos.z;
    P.prevBase = null;
    while (S.inHist.length && S.inHist[0].q < P.ack) S.inHist.shift();
    if (Math.hypot(P.off.x, P.off.y, P.off.z) > 2.5) { P.off = { x: 0, y: 0, z: 0 }; P.offV = null; }   // too far off (teleported, respawned): snap
  }
  // v1.2.9: the correction fades like a critically damped spring (about 150 ms): the view eases into it from rest instead of
  // being kicked at full rate the moment a snapshot lands (the old exp(-12 t) fade moved you fastest in its first frame)
  const v = P.offV ||= { x: 0, y: 0, z: 0 }, w = 32, e = Math.exp(-w * Math.min(dt, 0.1));
  let f2 = 0; for (const c of 'xyz') { const x0 = P.off[c], v0 = v[c], a = (v0 + w * x0) * Math.min(dt, 0.1); P.off[c] = (x0 + a) * e; v[c] = (v0 - w * a) * e; f2 += (P.off[c] - x0) ** 2; }
  P.fade = dt > 0 ? Math.sqrt(f2) / dt : 0;   // m/s the fade moves your view this frame (tests)
  me.pos = { x: pos.x + P.off.x, y: pos.y + P.off.y, z: pos.z + P.off.z }; P.drawW = W;
  if (S.jumpFx && !start) { if (settings.pillow) sound.play('hop', 0.9); else sound.play('jump'); (S.jumpPred ||= []).push(performance.now()); }   // v1.2.6: your jump sound at once (the host's is skipped)
  S.jumpFx = false;
}

// ---------------------------------------------------------------- v30 network readout and window
let netWinOpen = false, netKey = '', netT = 0;
function renderNetHud(force) {
  const hud = $('netHud'), win = $('netWin');
  const mp = !!(S && S.inGame && (S.role === 'peer' || (S.role === 'host' && S.lobby.players.some(p => !p.isBot && p.id !== S.localId))));
  if (S && S.inGame && S.peerNet) S.peerNet.tick();
  const t = performance.now();
  if (!force && t - netT < 250) return;   // four times a second is plenty for text
  netT = t;
  const showHud = mp && settings.showPing !== false;
  hud.classList.toggle('hidden', !showHud); document.body.classList.toggle('nethud', showHud);
  win.classList.toggle('hidden', !(mp && netWinOpen));
  if (!mp) { document.body.classList.remove('netwarn'); return; }
  const nameOf = id => (S.roster.get(id) || (S.lobby.players.find(p => p.id === id)) || { name: id }).name;
  let ping, warn;
  if (S.role === 'peer') {
    // v1.0.1: AMON never set this up on peers, and the crash here stopped the whole frame loop (stuck "PvP battle!" banner)
    const n = S.peerNet ||= new PeerNetStats(msg => S.net.send({ t: 'toHost', msg })); n.compute();
    ping = n.rtt; warn = n.warning();
    $('netPing').textContent = `${NL.on ? '⏺ ' : ''}📶 ${ping == null ? '…' : Math.round(ping) + ' ms'}`;
  } else {
    const rows = S.hostNet ? S.hostNet.rows().filter(r => r[1] >= 0) : [];
    if ((S.amon || S.rts) && S.hostNet && t - (S.netRowsT || 0) > 1000) { S.netRowsT = t; S.net.send({ t: 'toAll', msg: { k: 'netRows', ns: S.hostNet.rows() } }); }
    ping = rows.length ? Math.max(...rows.map(r => r[1])) : null;
    warn = S.hostNet ? S.hostNet.worst(nameOf) : null;
    $('netPing').textContent = `${NL.on ? '⏺ ' : ''}📶 Host${ping == null ? '' : ` · worst ${Math.round(ping)} ms`}`;
  }
  $('netPing').className = pingClass(ping);
  const w = $('netWarn');
  w.classList.toggle('hidden', !warn); document.body.classList.toggle('netwarn', !!warn);
  if (warn) { w.textContent = '⚠ ' + warn.text; w.className = warn.level >= 2 ? 'l2' : 'l1'; }
  if (!netWinOpen) return;
  // The window: one row per human player. The host reads everyone's reports; a peer gets them once a second.
  const rows = S.role === 'host' ? (S.hostNet ? S.hostNet.rows() : []) : (S.netRows || []);
  const list = [{ id: S.role === 'host' ? S.localId : 'host', host: true }];
  for (const r of rows) list.push({ id: r[0], rtt: r[1], jit: r[2], loss: r[3], fl: r[4] });
  if (S.role === 'peer') {   // your own line is live (not a second old)
    const n = S.peerNet, mine = list.find(x => x.id === S.localId) || (list.push({ id: S.localId }), list[list.length - 1]);
    Object.assign(mine, { rtt: n.rtt == null ? -1 : Math.round(n.rtt), jit: Math.round(n.jitter), loss: Math.round(n.loss * 10) / 10, fl: n.stalled() ? 1 : 0 });
  }
  const html = `<h4>📶 Network status <span style="font-weight:400;color:#9aa4b8">(${esc(codeLabel(BINDS.netstats[0] || ''))} to close)</span></h4>
    <table><tr><th>Player</th><th>Ping</th><th>Jitter</th><th>Loss</th><th>Status</th></tr>${list.map(x => {
      if (x.host) return `<tr><td><span class="dot" style="background:${esc((S.roster.get(x.id) || {}).color || '#888')}"></span>${esc(nameOf(x.id))}${x.id === S.localId ? ' (you)' : ''}</td><td class="good">host</td><td>—</td><td>—</td><td class="good">Hosting</td></tr>`;
      const pc = pingClass(x.rtt), bad = x.fl ? 'bad' : x.loss >= 2 ? (x.loss >= 8 ? 'bad' : 'ok') : x.jit >= 20 ? 'ok' : pc === 'bad' ? 'bad' : pc === 'ok' ? 'ok' : 'good';
      const st = x.fl ? (x.fl & 1 ? 'No input' : 'Stalled') : x.loss >= 2 ? 'Packet loss?' : pc === 'bad' ? 'High ping' : x.jit >= 20 ? 'Unstable' : x.rtt == null || x.rtt < 0 ? 'Measuring…' : 'Good';
      return `<tr><td><span class="dot" style="background:${esc((S.roster.get(x.id) || {}).color || '#888')}"></span>${esc(nameOf(x.id))}${x.id === S.localId ? ' (you)' : ''}</td><td class="${pc}">${x.rtt == null || x.rtt < 0 ? '…' : x.rtt + ' ms'}</td><td>${x.jit == null ? '…' : x.jit + ' ms'}</td><td class="${x.loss >= 2 ? 'bad' : ''}">${x.loss == null ? '…' : x.loss + '%'}</td><td class="${bad}">${st}</td></tr>`;
    }).join('')}</table>
    ${netDetails(nameOf)}
    <div class="foot">Ping = round trip to the host. Jitter = how unevenly updates arrive. Loss counts dropped pings and stalls.${S.role === 'peer' && settings.netPredict !== false ? ' Prediction is on.' : ''}</div>`;
  if (html !== netKey) { win.innerHTML = html; netKey = html; }
}

// v1.2.9: the network window's detail lines, so a report says where a stutter comes from: how many updates arrive (and how
// fast the host runs), this PC's frame rate, how far your own movement gets corrected, real traffic and Steam's view of it.
let netTf = null, netTfT = 0;
// traffic() counts since its last call, so the window and the network log share one reading a second
function netTraffic(t = performance.now()) { if (S && S.net && S.net.traffic && t - netTfT > 950) { netTfT = t; netTf = S.net.traffic(); } return netTf; }
function netDetails(nameOf) {
  const t = performance.now(), kb = b => (b / 1024).toFixed(1), cls = (v, ok, good) => v >= good ? 'good' : v >= ok ? 'ok' : 'bad';
  const tf = netTraffic(t), L = [], me = Math.round(NR.frame.hz());
  if (S.role === 'peer') {
    const n = S.peerNet, hz = Math.round(n.snapRate.hz()), hr = n.hostRates, c = n.corrStats();
    L.push(`Updates from host: <b class="${cls(hz, 20, 27)}">${hz}/s</b> (30 is normal)${hr ? ` · host <b class="${cls(hr[0], 25, 45)}">${hr[0]} FPS</b>, sim ${hr[1]}/s, sends ${hr[2]}/s` : ''}`);
    L.push(`This PC: <b class="${cls(me, 30, 50)}">${me} FPS</b>${c ? ` · your movement corrected by ${Math.round(c.avg * 100)} cm on average (max ${Math.round(c.max * 100)})` : ''}`);
  } else L.push(`This PC (host): <b class="${cls(me, 25, 45)}">${me} FPS</b> · sim ${Math.round(NR.sim.hz())}/s · sends <b class="${cls(NR.send.hz(), 20, 27)}">${Math.round(NR.send.hz())}</b> updates/s to each player`);
  if (S.role !== 'peer' && S.game && S.game.stat) L.push(S.game.threaded ? `Game thread: <b class="good">on</b> (${coreCount()} CPU threads on this PC) · the match comes back ${Math.round(S.game.stat.waitMs)} ms after it's sent (about ${Math.max(1, Math.round((S.game.stat.late || 0) + 0.5))} frame)` : `Game thread: off (one thread: Settings > CPU threads${coreCount() < 2 ? ', this PC has 1' : ''})`);   // v1.2.30
  if (S.role !== 'peer' && S.brainStat) { const X = S.brainStat; L.push(`Bot brain threads: <b class="good">${X.t}</b>${X.n > X.t ? ` (+${X.n - X.t} on the game thread)` : ''} · bots each: ${X.b.join(' / ')} · ms a frame: ${X.ms.join(' / ')}`); }   // v1.2.38 (brain.js)
  if (S.role !== 'peer' && S.shardStat) { const X = S.shardStat; L.push(`Arena threads: <b class="good">${X.n}</b> (${X.t} of their own, one on the game thread) · fighters each: ${X.p.join(' / ')} · ms a frame: ${X.ms.join(' / ')} · slowest ${X.behind} s behind`); }   // v1.2.37 (shard.js)
  {   // v1.2.9: hitch readout: tells a slow PC (this one or the host) from a late network
    const hc = (v, warn, bad) => v >= bad ? 'bad' : v >= warn ? 'ok' : 'good', f = HM.frame.get(), m = HM.msg.get(), ms = v => `<b class="${hc(v, 25, 50)}">${Math.round(v)} ms</b>`;
    const parts = [];
    if (f) parts.push(`this PC: frame ${ms(f.v)}${f.info ? ` (game ${f.info[0]}, drawing ${f.info[1]})` : ''}${m && S.role === 'peer' ? `, handling an update ${ms(m.v)}` : ''}`);
    if (S.role === 'peer') {
      const n = S.peerNet, gp = n.gapW.get(), hr = n.hostRates, sz = n.sizeW.stats();
      if (hr && hr.length > 4) parts.push(`host: frame ${ms(hr[3])}, longest gap between sends ${ms(hr[4])}`);
      if (gp) parts.push(`longest wait between updates <b class="${hc(gp.v, 70, 150)}">${Math.round(gp.v)} ms</b>`);
      if (sz) parts.push(`update size ${kb(sz.p95)} kB p95 (max ${kb(sz.max)})`);
    } else { const sg = HM.send.get(); if (sg) parts.push(`longest gap between sends <b class="${hc(sg.v, 50, 80)}">${Math.round(sg.v)} ms</b>`); }
    if (parts.length) L.push(`Worst in the last 5 s · ${parts.join(' · ')}`);
  }
  if (tf) {
    L.push(`Traffic${tf.json ? ' (uncompressed)' : ''}: ↓ ${kb(tf.down)} kB/s (${Math.round(tf.downP)} packets/s) · ↑ ${kb(tf.up)} kB/s (${Math.round(tf.upP)} packets/s)${tf.upM ? ` · split: ${tf.upSplit} sent${tf.downSplit || tf.downLost ? `, ${tf.downSplit} received, ${tf.downLost} lost` : ''}` : tf.downSplit || tf.downLost ? ` · split: ${tf.downSplit} received, ${tf.downLost} lost` : ''}${tf.upFail ? ` · <b class="bad">${tf.upFail} sends refused</b>` : ''}`);
    for (const p of tf.peers || []) {
      const st = p.steam || {}; if (!p.steam && p.rtt == null) continue;
      const who = S.role === 'host' ? nameOf(p.id) : 'Host';
      L.push(`Steam · ${esc(who)}: ${p.rtt != null ? `round trip <b class="${pingClass(p.rtt)}">${p.rtt} ms</b> (network only)` : ''}${p.steam ? `${p.rtt != null ? ' · ' : ''}${st.connecting ? 'connecting' : st.active ? (st.relay ? 'through Steam relay' : 'direct') : 'no session'}${st.bytesQ || st.packetsQ ? ` · <b class="${st.bytesQ > 20000 ? 'bad' : 'ok'}">${kb(st.bytesQ)} kB waiting to send</b> (${st.packetsQ})` : ''}` : ''}${S.role === 'host' ? ` · ↑ ${kb(p.up)} kB/s${p.upSz ? `, updates ${kb(p.upSz.p95)} kB p95 (max ${kb(p.upSz.max)})` : ''}` : ''}`);
    }
    const tu = tf.tune;
    if (tu) L.push(`Steam send limit: ${tu.after && tu.after.SendRateMin ? `raised to ${Math.round(tu.after.SendRateMin / 1024)} kB/s (was ${Math.round((tu.before.SendRateMin || 0) / 1024)})` : tu.before && tu.before.SendRateMin ? `${Math.round(tu.before.SendRateMin / 1024)} kB/s` : `unchanged${tu.error ? ' (' + esc(tu.error.slice(0, 80)) + ')' : ''}`}`);
  }
  return `<div class="foot" style="color:#c8d0e0">${L.join('<br>')}</div>`;
}

// ---------------------------------------------------------------- network log
// v1.2.10 (Devin): press the netlog key (F3) to start recording, press it again to save everything to a text file
// (desktop app: Documents/Blockshot3D/netlogs, opened in Explorer; browser: a download). One JSON line a second with
// what the network window shows, plus a line for every hitch (a frame over 50 ms, an update over 150 ms late).
const NL = { on: false, t0: 0, lines: [], hitches: 0, next: 0, fMax: 0, fInfo: null, sMax: 0, snapAt: 0, gMax: 0, szMax: 0, snaps: 0, frames: 0 };
const NL_MAX = 20000;
const nlT = t => Math.round(t - NL.t0) / 1000;
function nlPush(o) { if (NL.lines.length < NL_MAX) NL.lines.push(JSON.stringify(o)); }
function toggleNetLog() {
  if (!NL.on) {
    Object.assign(NL, { on: true, t0: performance.now(), lines: [], hitches: 0, next: 0, fMax: 0, fInfo: null, sMax: 0, snapAt: 0, gMax: 0, szMax: 0, snaps: 0, frames: 0 });
    nlPush({ log: 'blockshot-netlog', v: appVersion(), started: new Date().toISOString(), ua: navigator.userAgent, gpu: (() => { try { return gpuInfo(renderer).name; } catch { return null; } })(),
      quality: settings.quality, renderScale: settings.renderScale, fpsCap: settings.fpsCap, predict: settings.netPredict !== false, steam: !!(window.steamBridge && window.steamBridge.isDesktop) });
    toast(`Recording network log. Press ${codeLabel(BINDS.netlog[0] || 'F3')} again to save it.`); toastT = 4;
    return;
  }
  NL.on = false; netLogSample(performance.now());
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const name = `blockshot-netlog-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.txt`;
  const text = NL.lines.join('\n') + '\n'; NL.lines = [];
  if (window.steamBridge && window.steamBridge.saveLog) {
    window.steamBridge.saveLog(name, text).then(r => { toast(r && r.ok ? `Network log saved: ${r.path}` : `Could not save the network log${r && r.error ? ': ' + r.error : ''}`); toastT = 6; });
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Network log saved: ${name} (Downloads)`); toastT = 6;
  }
}
function netLogFrame(ms, game, draw, t) {
  NL.frames++;
  if (ms > NL.fMax) { NL.fMax = ms; NL.fInfo = [game, draw]; }
  if (ms > 50 && NL.hitches < 5000) { NL.hitches++; nlPush({ t: nlT(t), hitch: 'frame', ms: Math.round(ms), game, draw }); }
  if (t >= NL.next) netLogSample(t);
}
function netLogSnap(t, sz) {
  NL.snaps++;
  if (sz > NL.szMax) NL.szMax = sz;
  if (NL.snapAt) { const g = t - NL.snapAt; if (g > NL.gMax) NL.gMax = g; if (g > 150 && NL.hitches < 5000) { NL.hitches++; nlPush({ t: nlT(t), hitch: 'update', ms: Math.round(g) }); } }
  NL.snapAt = t;
}
function netLogSample(t) {
  NL.next = t + 1000;
  if (!S) return;
  const r = (v, k = 1) => v == null ? null : Math.round(v * k) / k, o = { t: nlT(t), role: S.role, inGame: !!S.inGame };
  if (S.inGame && S.matchSettings) {
    o.mode = S.matchSettings.mode; o.phase = S.game ? S.game.phase : undefined;
    o.players = S.lobby ? S.lobby.players.length : null; o.humans = S.lobby ? S.lobby.players.filter(p => !p.isBot).length : null;
  }
  o.fps = Math.round(NR.frame.hz()); o.frames = NL.frames; o.worstFrame = Math.round(NL.fMax); o.worstFrameSplit = NL.fInfo;
  o.mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : undefined;
  if (S.role === 'peer' && S.peerNet) {
    const n = S.peerNet, c = n.corrStats();
    Object.assign(o, { updates: NL.snaps, updHz: Math.round(n.snapRate.hz()), longestWait: Math.round(NL.gMax), biggestUpdate: NL.szMax || undefined, ping: r(n.rtt), jitter: r(n.jitter), loss: r(n.loss, 10), stalled: n.stalled() ? 1 : 0,
      host: n.hostRates || null, corrAvgCm: c ? Math.round(c.avg * 100) : null, corrMaxCm: c ? Math.round(c.max * 100) : null });
    if (S.netRows) o.everyone = S.netRows;
  } else if (S.role === 'host') {
    o.sim = Math.round(NR.sim.hz()); o.sends = Math.round(NR.send.hz());
    const sg = HM.send.get(); o.longestSendGap5s = sg ? Math.round(sg.v) : null;
    if (S.hostNet) o.everyone = S.hostNet.rows();   // [id, ping, jitter, loss, flags]
  }
  const tf = netTraffic(t);
  if (tf) {
    o.down = r(tf.down / 1024, 10); o.downP = Math.round(tf.downP); o.up = r(tf.up / 1024, 10); o.upP = Math.round(tf.upP);
    if (tf.upSplit || tf.downSplit || tf.downLost || tf.upFail) Object.assign(o, { upSplit: tf.upSplit, downSplit: tf.downSplit, downLost: tf.downLost, upFail: tf.upFail });
    if (tf.peers) o.steam = tf.peers.map(p => ({ id: p.id, rtt: p.rtt, up: r((p.up || 0) / 1024, 10), relay: p.steam ? !!p.steam.relay : undefined, active: p.steam ? !!p.steam.active : undefined,
      qBytes: p.steam ? p.steam.bytesQ : undefined, qPackets: p.steam ? p.steam.packetsQ : undefined, sz95: p.upSz ? p.upSz.p95 : undefined, szMax: p.upSz ? p.upSz.max : undefined }));
    if (tf.tune && !NL.tuned) { NL.tuned = 1; o.tune = tf.tune; }
  }
  nlPush(o);
  NL.frames = 0; NL.fMax = 0; NL.fInfo = null; NL.snaps = 0; NL.gMax = 0; NL.szMax = 0;
}

// ---------------------------------------------------------------- automatic updates (v1.2.10, desktop app only)
// electron/updater.cjs downloads changed game files from the GitHub repo in the background; this shows it on the title
// screen and offers a restart once the update is ready (it also installs itself on the next launch).
function updShow(st) {
  const el = $('updLine'); if (!el || !st) return;
  const mb = b => (b / 1048576).toFixed(1);
  let html = '';
  if (st.state === 'downloading') html = `Downloading update ${esc(st.version)}… ${st.bytes ? Math.round(100 * st.done / st.bytes) : 0}% (${mb(st.bytes)} MB)`;
  else if (st.state === 'ready') html = `Update ${esc(st.version)} is ready. <button class="btn" id="updRestart">Restart to update</button>`;
  else if (st.state === 'full') html = `Version ${esc(st.version)} is out. It needs a fresh download of the game.`;
  else if (st.state === 'error') html = `Couldn't update: ${esc(String(st.error).slice(0, 120))}`;
  el.innerHTML = html; el.classList.toggle('hidden', !html); el.classList.toggle('err', st.state === 'error');
  updScreen(st);
  const b = $('updRestart'); if (b) b.onclick = () => { if (S && S.inGame) { toast('Leave the match first, then restart to update.'); return; } b.disabled = true; window.steamBridge.updateRestart(); };
  if (st.state === 'applied' && !updShow.said) { updShow.said = 1; toast(`Updated to ${st.version}`); toastT = 4; }
}
// v1.2.16: an update found while you're still on the menus installs itself: a full-screen "Updating" card (two players
// blocking a shell back and forth), then the game restarts on its own. In a lobby or match it waits for you instead
// (the title line's Restart button), and Skip on the card does the same.
const UPD = { skip: false, restarting: false };
const updAuto = () => !S && !UPD.skip;
function updScreen(st) {
  const el = $('updScreen'); if (!el) return;
  const on = updAuto() && (st.state === 'downloading' || st.state === 'ready');
  el.classList.toggle('hidden', !on); if (!on) return;
  const pct = st.state === 'ready' ? 100 : st.bytes ? Math.round(100 * st.done / st.bytes) : 0;
  el.querySelector('.usTitle').textContent = t('Updating to {v}', { v: 'v' + st.version });
  el.querySelector('.usBar i').style.width = pct + '%';
  el.querySelector('.usNote').textContent = st.state === 'ready' ? t('Restarting…') : `${pct}% · ${(st.bytes / 1048576).toFixed(1)} MB`;
  if (st.state === 'ready' && !UPD.restarting) {
    UPD.restarting = true;
    setTimeout(() => { if (updAuto()) window.steamBridge.updateRestart(); else { UPD.restarting = false; el.classList.add('hidden'); } }, 1400);
  }
}
// v1.2.16 Patch list (title screen, bottom left): the last few updates as tabs, always opening on the newest
function showPatches(i = 0) {
  const el = $('patchList'), P = PATCHES.slice(0, 5), p = P[i] || P[0];
  el.querySelector('.plTabs').innerHTML = P.map((q, k) => `<button type="button" class="plTab${k === i ? ' on' : ''}" data-k="${k}">v${q.v}${k === 0 ? ' <i>new</i>' : ''}</button>`).join('');
  el.querySelector('.plBody').innerHTML = `<div class="plDate">Version ${esc(p.v)} · ${esc(p.date)}</div>` +
    Object.entries(p.notes).map(([h, list]) => `<h3 class="pl-${h.toLowerCase()}">${esc(h)}</h3><ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('');
  el.querySelectorAll('.plTab').forEach(b => b.onclick = () => { sound.play('ui'); showPatches(+b.dataset.k); });
  el.classList.remove('hidden');
}
$('patchBtn').onclick = () => { sound.play('ui'); showPatches(0); };
// v1.2.17 Add to Steam (desktop app): adds the game to the Steam library with its artwork (electron/steamshortcut.cjs)
if (window.steamBridge && window.steamBridge.addToSteam) {
  $('steamAddBtn').classList.remove('hidden');
  $('steamAddBtn').onclick = async () => {
    const b = $('steamAddBtn'), m = $('steamAddMsg'); sound.play('ui');
    b.disabled = true; m.classList.remove('hidden'); m.textContent = t('Adding to Steam…');
    let r; try { r = await window.steamBridge.addToSteam(); } catch (err) { r = { ok: false, error: String(err && err.message || err) }; }
    b.disabled = false;
    // v1.2.19: pressing it again checks the Steam entry and repairs it (state: added / fixed / ok)
    const head = r && r.ok ? (r.state === 'ok' ? t('Already in Steam and linked to ') + r.exe + '.' : r.state === 'fixed' ? t('Fixed the Steam entry, it now opens ') + r.exe + '.' : t('Added!')) : '';
    m.textContent = r && r.ok ? head + ' ' + (r.restarted ? t('Steam is restarting (about 10-30 seconds). Restart Blockshot 3D afterwards so multiplayer reconnects to Steam.') : t('Start Steam and Blockshot 3D is in your library.')) : t("Couldn't add it: ") + ((r && r.error) || '?');
    setTimeout(() => m.classList.add('hidden'), 20000);
  };
}
// v1.2.16 Suggestions (title screen, next to the Patch list): saved by category on this PC and uploaded to the suggestions
// repo, or a filled-in GitHub issue opens when there's no key (electron/suggest.cjs; the browser version uses the local server)
let sgCat = 'bug';
$('suggestBtn').onclick = () => { sound.play('ui'); $('sgStatus').textContent = ''; $('suggestWin').classList.remove('hidden'); setTimeout(() => $('sgTitle').focus(), 50); };
$('suggestClose').onclick = () => $('suggestWin').classList.add('hidden');
$('suggestWin').onclick = e => { if (e.target.id === 'suggestWin') $('suggestWin').classList.add('hidden'); };
document.querySelectorAll('.sgCats button').forEach(b => b.onclick = () => { sgCat = b.dataset.cat; document.querySelectorAll('.sgCats button').forEach(x => x.classList.toggle('on', x === b)); });
$('sgSend').onclick = async () => {
  const s = { cat: sgCat, title: $('sgTitle').value.trim(), text: $('sgText').value.trim(), name: settings.name || '', version: $('versionTag').textContent };
  if (!s.text && !s.title) { $('sgStatus').textContent = t('Write something first.'); return; }
  $('sgSend').disabled = true; $('sgStatus').textContent = t('Sending…');
  let r = null;
  try {
    if (window.steamBridge && window.steamBridge.suggest) r = await window.steamBridge.suggest(s);
    else r = await (await fetch('/api/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })).json();
  } catch (err) { r = { error: String(err) }; }
  $('sgSend').disabled = false;
  if (!r || r.error) { $('sgStatus').textContent = t("Couldn't save it: ") + ((r && r.error) || '?'); return; }
  if (r.url) window.open(r.url, '_blank', 'noopener');
  $('sgStatus').textContent = r.uploaded ? t('Sent. Thanks!') : t('Saved. Finish sending it on the GitHub page that just opened (needs a GitHub account). Thanks!');
  sound.play('pip'); $('sgTitle').value = ''; $('sgText').value = '';
};
$('patchClose').onclick = () => $('patchList').classList.add('hidden');
$('patchList').onclick = e => { if (e.target.id === 'patchList') $('patchList').classList.add('hidden'); };
if (window.steamBridge && window.steamBridge.onUpdate) {
  $('updSkip').onclick = () => { UPD.skip = true; $('updScreen').classList.add('hidden'); };
  window.steamBridge.onUpdate(updShow);
  window.steamBridge.updateState().then(updShow).catch(() => {});
}

// ---------------------------------------------------------------- bets
// v26: bet cash on yourself (your team / the squad) before round 1 and during every card pick phase.
// v1.0.1: a bet is on the NEXT round and is paid (or lost) as soon as that round ends, not at the end of the match.
// Each stake pays back x the number of players in it (number of teams in team modes, 2x in co-op) on a win,
// locked in when it is placed; a draw hands it back. Bets close once the round's fight starts, so the bet panel
// never sits over the fight.
let betKey = '';
function betFighters() { return [...S.roster.values()].filter(r => !r.transient && r.kind !== 'hazardTurret'); }
function betMult() {
  const m = S.matchSettings.mode;
  if (m === 'waves' || (m === 'open' && S.matchSettings.owType === 'extract')) return BET.payout;
  if (m === 'tdm' || owSquads(S.matchSettings)) return Math.max(2, new Set(betFighters().map(r => r.team)).size);
  return Math.max(2, betFighters().length);
}
function betAllowed() {
  if (!S || !S.inGame || S.matchSettings.mode === 'practice' || S.matchSettings.mode === 'amon' || S.matchSettings.core) return false;   // (v28: no bets in Core Defense)
  if (!(S.betOpen || (S.view && S.view.phase === 'picking'))) return false;
  return betFighters().length >= 2;
}
function renderBets(force) {
  const on = betAllowed(), cash = Math.floor(settings.cash || 0);
  const mult = on ? betMult() : 0;
  const key = `${on}|${S && S.bet}|${cash}|${currentScreen}|${mult}`;
  if (key === betKey && !force) return;
  betKey = key;
  const html = on ? `<div class="bethead">🎲 ${esc(t('Bet on yourself'))} <span class="hint">${t('on the next round')} · ${t('pays')} ${mult}× · ${t('paid when the round ends')}</span></div>
    <div class="betrow">${BET.chips.map(c => `<button class="chip" data-bet="${c}"${cash < c ? ' disabled' : ''}>+${c}</button>`).join('')}<button class="chip" data-bet="all"${cash <= 0 ? ' disabled' : ''}>${t('All in')}</button></div>
    <div class="betstat">${t('Your bet')}: <b>${S.bet ? '💰 ' + S.bet + ' → 💰 ' + S.betPay : '—'}</b> · ${fmtCash(cash)}</div>` : '';
  // v1.0.1: never over the fight: bets are placed on the card screen (there is one before round 1 now) or in the pause menu
  for (const id of ['pauseBet', 'pickBet']) { const el = $(id); if (!el) continue; el.innerHTML = html; el.classList.toggle('hidden', !on); }
  $('betBox').classList.add('hidden');
}
function placeBet(v) {
  if (!betAllowed()) return;
  const cash = Math.floor(settings.cash || 0), n = v === 'all' ? cash : Math.min(cash, +v || 0);
  if (n <= 0) { toast('Not enough cash'); return; }
  settings.cash -= n; S.bet += n; S.betPay = (S.betPay || 0) + n * betMult(); saveSettings(settings); sound.play('coin');
  const ev = { t: 'bet', p: S.localId, a: S.bet };
  if (isHostSide()) { if (S.role === 'host') hostEv(ev); handleEvent(ev); }
  else { S.net.send({ t: 'toHost', msg: { k: 'bet', a: S.bet } }); handleEvent(ev); }
  renderBets(true);
}
// v1.0.1: a round's bet pays out (or is lost) when that round ends; a draw gives the stake back.
function settleBet(w) {
  if (!S || !(S.bet > 0)) return;
  const stake = S.bet, pay = S.betPay || stake * BET.payout;
  S.bet = 0; S.betPay = 0;
  if (w == null) { settings.cash += stake; toast(`🎲 Draw: bet of 💰 ${stake} returned`); }
  else if (w === myKey()) { settings.cash += pay; toast(`🎲 Bet won: +💰 ${pay}`); sound.play('coin'); }
  else toast(`🎲 Bet lost: −💰 ${stake}`);
  saveSettings(settings); refreshCash(); renderBets(true);
}
// Match pay (and bet payout) when a match ends; "Keep playing" only pays for what happened since.
function payMatch(won, tally) {
  if (!S || S.matchSettings.mode === 'practice') return '';
  const me = (tally || []).find(x => x.id === S.localId) || { kills: 0, damage: 0 };
  const now = { roundsWon: (S.view.scores || {})[myKey()] || 0, kills: me.kills || 0, damage: me.damage || 0 };
  const nowT = performance.now(), mins = (nowT - (S.paidT || nowT)) / 60000;
  const pay = matchPay({ ...now, won, mins, mode: S.matchSettings.mode }, S.paid);
  S.paid = now; S.paidT = nowT;
  let betWin = 0;
  if (S.bet > 0) { betWin = won ? (S.betPay || S.bet * BET.payout) : 0; settings.cash += betWin; }
  const lost = S.bet > 0 && !won ? S.bet : 0;
  S.bet = 0; S.betPay = 0;
  settings.cash += pay.total; saveSettings(settings);
  const bits = [`+💰 ${pay.total} ${t('cash earned')}`];
  if (betWin) bits.push(`🎲 ${t('Bet won')}: +💰 ${betWin}`);
  if (lost) bits.push(`🎲 ${t('Bet lost')}: −💰 ${lost}`);
  return bits.join(' · ') + ` — ${fmtCash(settings.cash)}`;
}

// ---------------------------------------------------------------- events
const rosterOf = id => (S && S.roster.get(id)) || { name: '?', color: '#ffffff', team: 0, cards: [] };
// v1.2.26: team deathmatch, or a tournament played in teams
function teamPlay(st = S && S.matchSettings) { return !!st && (st.mode === 'tdm' || (st.mode === 'tourn' && !!st.tTeams)); }
const myKey = () => S.matchSettings.mode === 'waves' || (S.matchSettings.mode === 'open' && S.matchSettings.owType === 'extract') ? 'players'
  : teamPlay() || owSquads(S.matchSettings) ? 't' + rosterOf(S.localId).team : S.localId;
function keyLabel(k) {
  if (k === 'players') return { name: 'Squad', color: 'var(--accent)' };
  if (k === 'waves') return { name: 'Raiders', color: '#ff5f5f' };
  if (k === 'roamers') return { name: 'Roaming bots', color: '#ff5f5f' };
  if (teamPlay() || owSquads(S.matchSettings)) { const t = +k.slice(1); return { name: `${ART.teamNames[t]} team`, color: ART.teamColors[t] }; }
  const r = rosterOf(k); return { name: k === S.localId ? 'You' : r.name, color: r.color };
}
function localPos() { const me = S.view.players.find(p => p.id === S.localId); return me ? me.pos : null; }

// "Wave budget 18: 3 Raiders, 2 Critters, 1 Elite" (toast at the start of each co-op wave)
function gmText(gm) {
  const parts = Object.entries(gm.units).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${t(UNIT_NAMES[k] || k)}${n > 1 ? 's' : ''}`);
  return `${t('Wave budget')} ${gm.spent}/${gm.budget}: ${parts.join(', ')}${gm.groups > 1 ? ' · ' + t('reinforcements coming') : ''}`;
}
// Picks the music for the moment: boss music while the boss is up, the suspense track once only two fighters
// are left in a deciding round, the battle playlist otherwise. Works the same on host and peers (view data only).
function updateMusic() {
  const v = S.view, mode = S.matchSettings.mode;
  let want = 'battle';
  if (v.boss && (v.phase === 'play' || v.phase === 'countdown' || v.phase === 'roundEnd')) want = 'boss';
  else if (mode !== 'practice' && mode !== 'waves' && v.final && v.phase === 'play') {
    const alive = v.players.filter(p => p.alive && (S.roster.get(p.id) || {}).transient !== true && !S.roster.get(p.id)?.ownerId && (p.kind || 'hero') === 'hero').length;
    if (alive === 2) S.suspense = true;
    if (S.suspense) want = 'suspense';
  } else if (v.phase !== 'play' && v.phase !== 'roundEnd') S.suspense = false;
  if (S.suspense && mode !== 'waves' && (v.phase === 'play' || v.phase === 'roundEnd')) want = 'suspense';
  sound.playMusic(want);
}
// Boss banners: the Warden keeps its translated lines, the other bosses use their own name.
function bossLine(e, what) { return !e.name || e.name === 'The Warden' ? t('The Warden ' + what) : `${e.name} ${what}`; }
// v1.2.15 round-2 card effects
function ncEvent(e, me, vol) {
  const col = rosterOf(e.p).color;
  switch (e.k) {
    case 'shell': renderer.burst(e.x, e.y, e.z, '#ffd23a', 22, 6); renderer.ring(e.x, e.y - 0.6, e.z, 1.2, '#ffd23a'); sound.play('block', vol(e.x, e.z)); if (e.p === me) toast(e.n ? `Gilded Shell broke (${e.n} left)` : 'Gilded Shell broke'); break;
    case 'salvo': if (e.p === me) sound.play('reload', 0.5); break;
    case 'crush': renderer.burst(e.x, 0.2, e.z, '#b8bcc6', 26, 7); sound.play('explode', vol(e.x, e.z) * 0.7); renderer.addShake(0.35 * vol(e.x, e.z)); break;   // trap arena crusher hits the floor
    case 'pound': renderer.ring(e.x, e.y, e.z, e.r, col); renderer.burst(e.x, e.y + 0.2, e.z, '#c9b48a', 20, 6); sound.play('explode', vol(e.x, e.z) * 0.6); renderer.addShake(0.2 * vol(e.x, e.z)); break;
    case 'gamble': if (e.p === me) { toast('Gambler\'s Mag: ' + (GAMBLE_TAGS[e.r] || '').replace('🎲 ', '')); sound.play('cardDeal', 0.6); } break;
    case 'volley': renderer.burst(e.x, e.y, e.z, '#c8102e', 26, 7); sound.play('hurt', vol(e.x, e.z) * 0.6); break;
    case 'purge': renderer.ring(e.x, e.y, e.z, e.r, '#ffffff'); renderer.ring(e.x, e.y, e.z, e.r * 0.6, col); renderer.burst(e.x, e.y + 1, e.z, '#ffffff', 40, 12); sound.play('explode', vol(e.x, e.z)); renderer.addShake(0.4 * vol(e.x, e.z)); if (e.p === me) toast('Purge Pulse!'); break;
    case 'rhythm': renderer.glowSprite(e.x, e.y, e.z, col, 2.4, 0.3); sound.play('explode', vol(e.x, e.z) * 0.4); break;
    case 'rhythmReady': if (e.p === me) sound.play('pip', 0.9); break;
    case 'decoy': renderer.burst(e.x, e.y, e.z, col, 10, 3); break;
    case 'swap': renderer.line(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, col, 0.45, 0.12); renderer.burst(e.x1, e.y1, e.z1, col, 16, 5); renderer.burst(e.x2, e.y2, e.z2, col, 16, 5); sound.play('shield', vol(e.x2, e.z2)); if (e.p === me || e.q === me) toast('Swapped!'); break;
    case 'snare': renderer.ring(e.x, e.y + 0.05, e.z, 1, '#ff9a2a'); renderer.burst(e.x, e.y + 0.3, e.z, '#ff9a2a', 14, 4); sound.play('block', vol(e.x, e.z)); if (e.p === me) toast('Snared!'); break;
    case 'stand': renderer.ring(e.x, e.y - 0.6, e.z, 1.6, '#ff4f4f'); renderer.burst(e.x, e.y, e.z, '#ff4f4f', 20, 6); if (e.p === me) { toast('Last Stand!'); sound.play('reload', 0.9); } break;
    case 'spite': renderer.spiteRing(e.x, e.y, e.z, e.r, e.f); sound.play('pip', vol(e.x, e.z)); break;
    case 'overpen': renderer.line(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, col, 0.2); break;
    case 'squad': renderer.burst(e.x, e.y, e.z, col, 14, 4); if (e.p === me) sound.play('cardDeal', 0.5); break;
    case 'well': renderer.wellFx(e.x, e.y, e.z, e.r, col); break;
    case 'parry': renderer.glowSprite(e.x, e.y, e.z, '#ffffff', 2.2, 0.25); renderer.burst(e.x, e.y, e.z, '#ffffff', 18, 7); sound.play('block', vol(e.x, e.z)); if (e.p === me) { flashWhite(); sound.play('hitConfirm', 0.9); } break;
    case 'leech': renderer.burst(e.x, e.y, e.z, '#b07bff', 5, 2.5); break;
    case 'chain': renderer.floatText(e.x, e.y, e.z, `×${e.n}`, col); break;
    case 'squidOn': renderer.burst(e.x, e.y, e.z, '#c46bff', 8, 3); sound.play('hurt', vol(e.x, e.z) * 0.5); break;   // v1.2.22 squid latched
    case 'squidOff': renderer.burst(e.x, e.y, e.z, '#ffffff', 14, 5); sound.play('block', vol(e.x, e.z) * 0.7); if (e.p === me) toast('Shook it off!'); break;
  }
}
// v1.2.22 (Devin): a squid chewing on you shows how to get it off
function squidTip(on) {
  const el = $('squidTip'); if (!el) return;
  if (on && el.classList.contains('hidden')) { const B = bindsOf(settings); el.innerHTML = `🦑 ${esc(t('Squid on you!'))} <b>${esc(t('Mash'))} ${esc(codeLabel(B.jump[0] || 'Space'))}</b> ${esc(t('or'))} <b>${esc(t('Block'))} (${esc(codeLabel(B.block[0] || 'Mouse2'))})</b>`; }
  el.classList.toggle('hidden', !on);
}
function flashWhite() { const h = $('hurt'); h.style.background = 'rgba(255,255,255,.35)'; h.style.opacity = 1; setTimeout(() => { h.style.opacity = 0; setTimeout(() => { h.style.background = ''; }, 200); }, 90); }
// v1.2.26 tournament: effects from other arenas are not shown or heard (the kill feed still lists them). v1.2.37: nor
// toasted, and they no longer pause the game or move where the kill cam / round-end zoom looks; the host tags every event
// with its arena (sim.js emit e.ar), so this no longer guesses from who it names
const FX_FNS = ['burst', 'addShake', 'ring', 'line', 'holyBeam', 'punch', 'gunKick', 'deathPop', 'toxicCloud', 'slashFx', 'shotKick', 'shockArea', 'portal', 'poisonBlotch', 'napalmSplat', 'muzzleFlash', 'meteorWarn', 'lockFlash', 'healPulse', 'healField', 'cutFx', 'coreBlast', 'aoeFlash', 'angelAscend', 'reviveHold'];
const noop = () => {};
function handleEvent(e) {
  if (S && S.tn && e.t !== 'tMove' && (e.ar != null ? e.ar !== viewArena() : (e.x != null || e.p != null) && !inMyArena(e.p ?? e.by ?? e.o ?? e.src ?? e.k))) {
    const saved = FX_FNS.map(f => renderer[f]), sp = sound.play, ld = S.lastDeath, kd = KC.death;
    FX_FNS.forEach(f => { if (renderer[f]) renderer[f] = noop; }); sound.play = noop; evMuted = true;
    try { handleEvent0(e); } finally { FX_FNS.forEach((f, i) => { if (saved[i]) renderer[f] = saved[i]; }); sound.play = sp; evMuted = false; S.lastDeath = ld; KC.death = kd; }
    return;
  }
  handleEvent0(e);
}
function handleEvent0(e) {
  const me = S.localId, lp = localPos();
  const vol = (x, z) => lp ? Math.max(0.15, 1 - Math.hypot(x - lp.x, z - lp.z) / 45) : 0.7;
  switch (e.t) {
    case 'round':
      if (S.matchSettings.mode === 'practice') { banner(t('Practice range'), null, 1.2); if (currentScreen === 'pick') show('none'); break; }
      S.view.final = !!e.final; S.suspense = false;
      if (S.lootOffer) showLootPick(null);
      sound.levelChange();   // battle songs only move on between levels, every second level
      if (e.boss) banner(t('Final wave') + ' — ' + e.boss, '#ff9a4a', 2.4);
      else banner(e.wave ? t('Wave {n}', { n: e.wave }) : t('Round {n}', { n: e.n }), null, 1.4);
      sound.play('roundStart');
      if (e.gm && !e.boss) toast(gmText(e.gm));
      { const tip = { 'Crusher Hall': 'Crusher Hall: stay out from under the slabs when the red marks light up', 'Spike Garden': 'Spike Garden: spike floors flash red before they fire', 'Laser Grid': 'Laser Grid: jump the low sweeping beams, wait out the laser fences', 'Rail Yard': 'Rail Yard: ride the moving rails over the spike pit' }[e.map]; if (tip) toast(tip); }   // v1.2.15 trap arenas
      if (currentScreen === 'pick' || currentScreen === 'breakAsk') show('none');
      S.offer = null; S.breakAsk = null; S.resetYaw = true; S.lateJoined = false;
      TS.stop = TS.slow = 0; hideSplash(); S.kcWait = null; kcEnd(false);
      setRmodTag(e.rmod); if (e.rmod) setTimeout(() => modSplash(e.wave || e.n, e.rmod), 450);
      { const w = $('wipe'); w.classList.remove('hidden', 'go'); void w.offsetWidth; w.classList.add('go'); sound.play('whoosh', 0.6); clearTimeout(w._t); w._t = setTimeout(() => w.classList.add('hidden'), 700); }   // v1.2.0: wipe the new arena in
      if (e.tA) setTimeout(() => { if (S && S.inGame) tournIntro(e); }, 120);   // v1.2.28 tournament matchup screen
      break;
    case 'tGo': tournIntroEnd(); break;
    case 'fight': tournIntroEnd(); if ((S.view.round || 1) <= 1) { const lg = $('legend'); lg.classList.remove('brief'); void lg.offsetWidth; lg.classList.add('brief'); }   // the height legend fades 10 s into the first round
      banner(t('Fight!'), 'var(--accent)', 0.8); sound.play('fight'); if (S.betOpen) { S.betOpen = false; renderBets(true); } break;
    case 'modBroken': { const c = cardById.get(e.card); toast(e.p === me ? `${c ? c.name : 'Mod'} scrapped` : `${rosterOf(e.p).name} scrapped ${c ? c.name : 'a mod'}`); break; }
    case 'shoot': {
      if (S.role === 'peer' && e.p === me && !e.mod && !e.sky) {   // v1.2.6: played already when you clicked (predictShot)
        if (takePred(S.shotPred)) break;
        S.lastShotFx = performance.now();
      }
      sound.play(settings.pillow ? 'uwu' : 'shoot', e.p === me ? 0.9 : vol(e.x, e.z) * 0.6);
      if (e.mod !== 'katana') renderer.muzzleFlash(e.p, rosterOf(e.p).color);
      if (e.p === me) {
        renderer.gunKick();
        const v = S.view.players.find(q => q.id === me), a = v && (v.netAim || v.aim);
        if (a && e.mod !== 'katana') renderer.shotKick(a.x, a.z, Math.min(1.6, 0.8 + 0.2 * (e.wave || 1)));
      }
      break;
    }
    case 'hit':
      renderer.burst(e.x, e.y, e.z, rosterOf(e.p).color, 12, 7); sound.play('hit', vol(e.x, e.z));
      if (e.p === me) { sound.play('hurt'); renderer.addShake(0.3); flashHurt(); }
      else if (e.s === me && e.a > 0) { hitMarker(false); sound.play('hitConfirm', 0.8); }
      break;
    case 'impact': renderer.burst(e.x, e.y, e.z, rosterOf(e.p).color, 4, 3); break;
    case 'napalm': renderer.napalmSplat(e, rosterOf(e.p).color); break;
    case 'bounce': sound.play('bounce', vol(e.x, e.z) * 0.6); break;
    case 'block': renderer.burst(e.x, e.y, e.z, '#ffffff', 8, 5); sound.play('block', vol(e.x, e.z)); break;
    case 'blockOn': sound.play('shield', vol(e.x, e.z)); break;
    case 'boom':
      renderer.ring(e.x, e.y, e.z, e.r, rosterOf(e.p).color); renderer.burst(e.x, e.y, e.z, '#ffa040', 14, 6);
      sound.play('explode', vol(e.x, e.z)); renderer.addShake((e.p === me ? 0.06 : 0.25) * vol(e.x, e.z));   // v1.2.7: your own explosive rounds barely shake the view (rapid fire kept it rattling)
      break;
    case 'death': {
      const r = rosterOf(e.p), hero = !r.transient;
      renderer.burst(e.x, e.y, e.z, r.color, hero ? 48 : 30, hero ? 11 : 9); renderer.deathPop(e.x, e.y, e.z, r.color, hero);
      sound.play('death', vol(e.x, e.z)); killFeed(e);
      if (e.p === me && e.dl) showDeathLog(e);
      if (e.k === me && e.p !== me) { hitMarker(true); sound.play('kill', 0.9); renderer.addShake(0.22); }
      if (hero) { S.lastDeath = { x: e.x, y: e.y, z: e.z }; KC.death = { t: performance.now(), p: e.p, k: e.k, x: e.x, y: e.y, z: e.z }; if (duelMode() && (e.p === me || e.k === me || S.roster.size <= 8)) hitStop(0.075); }   // (v1.2.32: in big lobbies only your own kills and deaths pause time: 100 bots dying froze the match over and over)
      break;
    }
    // ---- co-op: Game Master, elites, boss
    case 'elite': toast(`⚔ ${e.name} — ${e.cards.slice(0, 4).join(', ')}${e.cards.length > 4 ? '…' : ''}`); break;
    case 'reinforce': toast(t('Reinforcements incoming') + ` (${e.n})`); renderer.burst(e.x, 1, e.z, '#ff5f5f', 24, 6); sound.play('fight', 0.5); break;
    case 'aoe': renderer.aoeFlash(e); sound.play('explode', vol(e.x, e.z) * (e.k === 5 ? 0.3 : 0.8)); renderer.addShake(0.18 * vol(e.x, e.z)); break;
    case 'blotch': renderer.poisonBlotch(e); break;
    case 'toxic': renderer.toxicCloud(e); sound.play('hiss', vol(e.x, e.z) * 0.5); break;
    case 'shockArea': renderer.shockArea(e); sound.play('zap', vol(e.x, e.z) * 0.8); renderer.addShake(e.p === me ? 0.08 : 0); break;
    case 'scavenge': if (e.p === me) sound.play('reload', 0.7); break;
    case 'portal': renderer.portal(e); sound.play('darkHum', vol(e.x, e.z) * 0.8); break;
    case 'lossToken': banner(t('Loss token used') + ' — ' + t('Wave {n}', { n: e.wave }) + ' ' + t('again'), '#ffd166', 2.4); toast(t('Your one free retry this run is spent. The next wipe ends the run.')); break;
    case 'bossCast': if (e.a === 'portals') toast(t('The boss opens portals!')); else if (e.a === 'brood') toast(t('Egg sacs! Clear the hatchlings')); else if (e.a === 'charge') toast(t('Charge lane — get out of the line!')); else if (e.a === 'quake') toast(t('Shockwave — jump over it!')); else if (e.a === 'inout') toast(t('Get close or get away!')); break;
    case 'bossPhase': banner(bossLine(e, e.n === 2 ? 'grows furious!' : 'is desperate!'), '#ff6a3a', 1.8); renderer.ring(e.x, e.y, e.z, 5, '#ff6a3a'); renderer.addShake(0.4); sound.play('explode'); break;
    case 'bossEnrage': banner(bossLine(e, 'is enraged!'), '#ff2a2a', 1.8); break;
    case 'bossDown': banner(bossLine(e, 'falls!'), 'var(--accent)', 2.2); renderer.burst(e.x, e.y, e.z, '#ff8a2a', 120, 12); renderer.addShake(0.6); sound.play('explode'); break;
    case 'portalSpawn': renderer.burst(e.x, e.y, e.z, '#c58bff', 14, 4); break;
    case 'extend':
      S.matchSettings.roundsToWin = e.goal; scoreKeyCache = '';
      if (currentScreen === 'over') show('none');
      if (e.tourn) { S.matchSettings.tLives = e.goal; toast(t('Tournament extended: everyone gets {n} more', { n: e.add }) + (e.add === 1 ? ' ' + t('life') : ' ' + t('lives'))); }
      else toast(e.waves ? `Keep playing: survive ${e.goal} waves` : `Match extended: first to ${e.goal}`);
      sound.playMusic('battle');
      break;
    case 'slash': renderer.slashFx(e, rosterOf(e.p).color); sound.play('slash', e.p === me ? 0.9 : vol(e.x, e.z) * 0.7); if (e.p === me) renderer.gunKick(); break;
    case 'cut': renderer.cutFx(e, rosterOf(e.p).color); sound.play('cut', vol(e.x, e.z)); break;
    case 'hairFull': renderer.burst(e.x, e.y, e.z, '#ffd23a', 30, 6); sound.play('powerUp', vol(e.x, e.z)); if (e.p === me) toast('Hair fully charged!'); break;
    case 'hairOut': renderer.burst(e.x, e.y, e.z, '#9a9a9a', 16, 4); if (e.p === me) toast('Your hair shield is drained'); break;
    case 'ritualStart': break;
    // Cursed Sacrifice hums darkly, Sacred Grove hums a soft choir, quietly, while someone charges (everyone nearby hears it)
    case 'kingHum': sound.play('opera', e.p === me ? 0.2 : vol(e.x, e.z) * 0.16); renderer.burst(e.x, e.y + 1.2, e.z, '#ffd23a', 6, 1.5); break;
    case 'kingSummon': renderer.holyBeam(e.x, e.y, e.z, 1.2); renderer.burst(e.x, e.y + 1, e.z, '#ffd23a', 50, 7); sound.play('choir', vol(e.x, e.z)); toast(e.p === me ? 'Big Brother is here!' : `${rosterOf(e.p).name} called ${e.name}!`); break;
    case 'ritualHum': sound.play(e.holy ? 'choir' : 'darkHum', (e.p === me ? 0.3 : vol(e.x, e.z) * 0.26) * (e.holy ? 0.6 : 1)); break;
    case 'ritualReady':
      if (e.holy) { renderer.burst(e.x, e.y + 0.3, e.z, '#fff1a8', 30, 3); sound.play('choir', vol(e.x, e.z)); if (e.p === me) toast('The grove is blessed: keep charging inside it'); }
      else { renderer.burst(e.x, e.y + 0.2, e.z, '#b25bff', 30, 4); sound.play('ritual', vol(e.x, e.z)); if (e.p === me) toast('Pentagram drawn: keep charging inside it'); }
      break;
    case 'ritualLevel': {
      const what = e.holy ? ['Holy shield', 'A cross descends', 'An angel answers'][e.n - 1] : ['A swarm answers', 'A brute climbs out', 'Meteors are coming!'][e.n - 1];
      if (e.holy) { renderer.holyBeam(e.x, e.y, e.z, 0.8); sound.play('choir', vol(e.x, e.z)); }
      else { renderer.burst(e.x, e.y + 0.6, e.z, e.n >= 3 ? '#ff2a2a' : '#c45bff', 30 + e.n * 10, 6); sound.play('ritual', vol(e.x, e.z)); renderer.addShake(0.12 * e.n * vol(e.x, e.z)); }
      if (e.p === me) toast(`Level ${e.n}: ${what}`);
      else if (!e.holy && e.n === 3) toast(`${rosterOf(e.p).name} calls down meteors!`);
      break;
    }
    case 'meteorWarn': renderer.meteorWarn(e); break;
    case 'angelUp': renderer.angelAscend(e.x, e.y, e.z); sound.play('choir', vol(e.x, e.z)); break;
    case 'cloneInherit': renderer.line(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, rosterOf(e.p).color, 0.5, 0.12); renderer.burst(e.x2, e.y2, e.z2, rosterOf(e.p).color, 14, 3); if (e.p === me) toast('Your clone fell: you took back its strength'); break;
    case 'ritualFizzle': renderer.burst(e.x, e.y + 0.1, e.z, '#6a4a8a', 10, 2); break;
    case 'ritualEnd': renderer.burst(e.x, e.y + 0.2, e.z, '#ff3a3a', 20, 3); break;
    case 'jump': if (S.role === 'peer' && e.p === me && takePred(S.jumpPred)) break;   // (v1.2.6: played already by your prediction)
      if (settings.pillow) sound.play('hop', e.p === me ? 0.9 : 0.45); else if (e.p === me) sound.play('jump'); break;
    case 'reload': if (e.p === me) sound.play('reload'); break;
    case 'emote': emoteEvent(e); break;   // v1.2.15
    case 'bet': {
      const r = rosterOf(e.p);
      if (e.p === me) toast(`Bet placed: 💰 ${e.a} on you winning`);
      else if (!r.isBot) toast(`${r.name} bets 💰 ${e.a} on winning`);   // v1.2.0: bots' bets no longer pop up
      break;
    }
    case 'roundEnd': {
      S.betOpen = false; settleBet(e.w);
      if (e.tw || e.tl) {   // v1.2.29 tournament: your side's result for the round (not "Draw" every time)
        const mk = myKey(), won = (e.tw || []).includes(mk), lost = (e.tl || []).includes(mk), team = teamPlay();
        const out = S.tn && (tnRow(me) || [])[3];
        if (out && !lost) banner(t('Round over'), '#cfd6e4', 1.8);
        else banner(lost ? (team ? t('Your team loses a life') : t('You lose a life')) : won ? (team ? t('Your team takes the round') : t('You won the round')) : t('Draw — nobody loses a life'), lost ? '#ff6a6a' : won ? '#6aff9a' : '#cfd6e4', 1.8);
        sound.play(lost ? 'roundLose' : 'roundWin');
        break;
      }
      if (e.w == null) { banner('Draw — nobody scores', null, 1.8); sound.play('roundLose'); break; }
      const L = keyLabel(e.w), mine = e.w === myKey();
      if (S.matchSettings.mode === 'open') {
        const ex = S.matchSettings.owType === 'extract';
        banner(ex ? (mine ? 'Extracted!' : 'The squad has fallen') : mine ? 'Victory royale!' : `${L.name} win${owSquads(S.matchSettings) || L.name === 'You' ? '' : 's'} the royale`, L.color, 2.4);
        sound.play(mine ? 'roundWin' : 'roundLose');
        break;
      }
      if (S.matchSettings.core && !mine) { banner('The core is destroyed!', '#ff6a4a', 3); sound.play('roundLose'); break; }   // v28
      if (e.kc && kcMode() && KC.death && KC.death.p === e.kc.p) { S.kcWait = { at: performance.now() + KC.lead + 60, k: e.kc.k, p: e.kc.p, v: e.kc.v, w: e.w, mine }; break; }   // v1.2.15 kill cam
      if (duelMode()) {   // v1.2.0: slow motion and a zoom on the winning kill, then the round splash in the winner's color
        slowMo(1.25); sound.play('slowmo', 0.8);
        const d = S.lastDeath; if (d) renderer.punch(d.x, d.y, d.z, 1.7);
        setTimeout(() => { sound.play(mine ? 'roundWin' : 'roundLose'); roundSplash(e.w); }, 600);
        break;
      }
      if (waveMode()) {   // co-op waves and Core Defense: the same splash, in the squad's color (or red when the squad falls)
        const d = S.lastDeath; if (d && mine) renderer.punch(d.x, d.y, d.z, 1.2);
        setTimeout(() => roundSplash(mine ? 'players' : 'waves'), 250);
        sound.play(mine ? 'roundWin' : 'roundLose');
        break;
      }
      banner(S.matchSettings.mode === 'waves' ? (mine ? 'Wave cleared!' : 'The squad has fallen') : teamPlay() ? `${L.name} takes the round` : mine ? t('You won the round') : t('{name} wins the round', { name: L.name }), L.color, 1.8);
      sound.play(mine ? 'roundWin' : 'roundLose');
      break;
    }
    case 'units': {
      for (const [id, r] of S.roster) if (r.transient) S.roster.delete(id);
      for (const u of e.units) S.roster.set(u.id, { ...u, transient: true, cards: [] });
      break;
    }
    case 'loot': {
      if (!S.game) { S.owTaken = S.owTaken || new Set(); S.owTaken.add(e.id); }
      owTake(renderer, e.id);
      if (e.p === me && !e.offer) { const c = e.card && cardById.get(e.card); toast(c ? `+ ${c.name}` : 'Nothing useful in there'); sound.play('ui'); }
      break;
    }
    case 'lootOffer': if (e.p === me) showLootPick(e.cards, e.left); break;
    case 'lootTaken': if (e.p === me) { const c = cardById.get(e.card); toast(e.discard ? 'Discarded' : c ? `+ ${c.name}` : '+ card'); sound.play(e.discard ? 'ui' : 'cardPick'); } break;
    case 'owDrop': if (e.p === me) toast('Space: open your parachute'); break;
    case 'reviving': if (e.by === me || e.p === me) { const n = Math.round(e.f * 100); $('owHud').dataset.rev = n; if (e.by === me) toast(`Reviving ${rosterOf(e.p).name}… ${n}%`); else toast(`${rosterOf(e.by).name} is reviving you… ${n}%`); } if (Math.random() < 0.5) renderer.burst(e.x, e.y + 0.4, e.z, '#6aff9a', 3, 1.5); break;
    case 'revived': renderer.burst(e.x, e.y + 0.8, e.z, '#6aff9a', 30, 4); sound.play('powerUp', vol(e.x, e.z)); toast(e.p === me ? 'You were revived!' : `${rosterOf(e.by).name} revived ${rosterOf(e.p).name}`); break;
    case 'carBoom': renderer.burst(e.x, e.y, e.z, '#ff7a1a', 60, 8); renderer.burst(e.x, e.y + 0.5, e.z, '#3a3a3a', 30, 4); sound.play('explode', vol(e.x, e.z)); renderer.addShake(0.4 * vol(e.x, e.z)); break;
    case 'owWall': toast(e.n === 0 ? 'The red wall is closing in! Touching it kills you.' : 'The red wall moves again (it kills on touch)'); break;
    case 'cards': { const r = S.roster.get(e.p); if (r) { r.cards = e.cards.slice(); if (e.s) r.stats = e.s; } renderChips(); scoreKeyCache = ''; statsKey = ''; if (e.p === me && S.matchSettings.mode === 'practice') renderPractice(); break; }
    case 'picking': for (const x of e.stats || []) { const r = S.roster.get(x.id); if (r) r.stats = x.s; } statsKey = ''; S.pickers = new Set(e.losers || []); S.giftIn = null; S.giftCard = null; if (currentScreen === 'pick') renderGiftRow(); break;
    // v1.2.26 tournament
    case 'tArena': {
      const a = tnArenaOf(me), w = e.w, mine = a === e.a;
      if (mine) { const won = w != null && w === myKey(); banner(w == null ? t('Draw') : won ? t('You won your arena') : t('You lost your arena'), w == null ? '#cfd6e4' : won ? '#6aff9a' : '#ff6a6a', 1.6); }
      else if (e.left > 0 && !(S.tn && (tnRow(me) || [])[3])) toast(t('{n} arenas still fighting', { n: e.left }));
      break;
    }
    case 'tKO': toast(e.p === me ? t("You're knocked out of the tournament") : t('{name} is knocked out', { name: rosterOf(e.p).name })); if (e.p === me) sound.play('death'); break;
    case 'tMove': if (e.p === me) { banner(t('Arena won: go help your ally!'), '#7fd8ff', 1.6); S.resetYaw = true; } else if (tnArenaOf(me) === e.a) toast(t('{name} came to help', { name: rosterOf(e.p).name })); break;
    case 'gift': if (e.to === me) { S.giftIn = { from: e.from, c: e.c }; sound.play('ui'); renderGiftRow(); } else if (e.from === me) { toast(t('Offer sent to {name}', { name: rosterOf(e.to).name })); S.giftCard = null; renderGiftRow(); } break;
    case 'giftDone': if (e.to === me || e.from === me) { S.giftIn = null; const c = cardById.get(e.to === me ? e.c : e.back); toast(t('Traded: you got {card}', { card: c ? c.name : '?' })); sound.play('cardPick'); renderGiftRow(); } break;
    case 'giftNo': if (e.to === me) { S.giftIn = null; renderGiftRow(); } else if (e.from === me) toast(t('{name} kept their cards', { name: rosterOf(e.to).name })); break;
    case 'giftFail': if (e.from === me) { toast(e.busy ? t('{name} is answering another offer', { name: rosterOf(e.to).name }) : t('{name} already picked', { name: rosterOf(e.to).name })); S.giftCard = null; renderGiftRow(); } break;
    case 'giftGone': if (e.to === me || e.from === me) { S.giftIn = null; toast(t('That trade is gone (a card was already picked)')); renderGiftRow(); } break;
    case 'respawn': break;   // v1.2.0: no toast (you can see it)
    // Core Defense (core.js)
    case 'coreWave':
      I.ready = 0;
      { const tw = e.twist && CORE_TWISTS[e.twist];   // v1.2.3: this wave's twist (coop.js CORE_TWISTS)
        banner(t('Wave {n}', { n: e.n }) + ' — ' + (tw ? tw.name + ': ' + tw.text : t('build your defenses')), tw ? '#ffb347' : '#7fd8ff', tw ? 3.2 : 2.4); }
      toast(`${e.prep} s to build. ${codeLabel(BINDS.use[0])}: pick up a block or turret (or catch it as it falls). Hold ${codeLabel(BINDS.use[0])} to see where it goes (scroll to turn it), let go to place it. Enter: ready.` + (e.upgrade ? (e.upgrade > 1 ? ` ${e.upgrade} upgrades are falling this wave!` : ' An upgrade is falling this wave!') : ''));
      break;
    case 'coreDown': renderer.coreBlast(e.x, e.y, e.z); sound.play('explode'); setTimeout(() => sound.play('explode', 0.7), 350); setTimeout(() => sound.play('explode', 0.9), 900); break;
    case 'coreGo': toast('Everyone is ready: here comes the wave!'); break;
    case 'coreIncoming': toast(e.boss ? `Here they come, with ${e.boss}!` : 'Here they come!'); sound.play('fight', 0.6); break;
    case 'coreLand': renderer.burst(e.x, 0.3, e.z, '#cfd6e4', 8, 2); break;
    case 'corePick': case 'corePlace': if (e.p === me) { sound.play('ui'); if (e.caught) toast('Caught it!'); } break;
    case 'coreNothing': if (e.p === me) toast('Nothing to pick up here'); break;
    case 'coreMoved': if (e.p === me) sound.play('ui'); toast(e.p === me ? 'Core moved: the raiders come for it here now' : `${rosterOf(e.p).name} moved the core`); break;
    case 'coreUpgrade': banner(t('Upgrade!'), '#ffd23a', 2); toast(e.p == null ? `${e.n > 1 ? e.n + ' upgrades' : 'The upgrade'} nobody reached still count${e.n > 1 ? '' : 's'}: everyone picks a card now.` : `${e.p === me ? 'You' : rosterOf(e.p).name} grabbed the upgrade: everyone picks a card after this wave.`); sound.play('powerUp'); renderer.burst(e.x, 1, e.z, '#ffd23a', 40, 6); break;
    case 'coreRespawnIn': if (e.p === me) toast(`Respawning in ${e.s} s`); break;
    case 'coreRetry': if (currentScreen === 'over') show('none'); banner(t('Wave {n}', { n: e.n }) + ' — ' + t('again'), '#ffd166', 2); break;
    case 'combo': {
      const c = cardById.get(e.card), r = rosterOf(e.p);
      if (e.p !== me) break;   // v26: only the player who made the combo sees the popup
      banner(`COMBO! ${c ? c.name : e.card}`, '#ffd166', 1.8); discover(e.card);
      sound.play('victory', 0.6);
      const v = S.view.players.find(q => q.id === e.p); if (v) renderer.burst(v.pos.x, v.pos.y + 1, v.pos.z, '#ffd166', 40, 8);
      break;
    }
    case 'reviveStart': if (e.p === me) renderer.reviveHold = performance.now() + (e.dur || 1.6) * 1000 + 600;   // v1.2.13: the camera stays on you
      renderer.holyBeam(e.x, e.y, e.z, e.dur || 1.6); sound.play('roundStart', vol(e.x, e.z)); break;
    case 'fieldSpawn': renderer.healField(e.x, e.y, e.z, e.r, 1.0); sound.play('shield', vol(e.x, e.z) * 0.6); break;
    case 'fieldPulse': renderer.healPulse(e.x, e.y, e.z, e.r); sound.play('cardPick', vol(e.x, e.z)); break;
    case 'mine': sound.play('reload', vol(e.x, e.z) * 0.7); break;
    case 'drill': renderer.burst(e.x, e.y, e.z, '#c9ced8', 8, 3); sound.play('bounce', vol(e.x, e.z)); break;
    case 'lava': renderer.burst(e.x, e.y, e.z, '#ff7a2a', 14, 6); sound.play('hurt', vol(e.x, e.z)); break;
    case 'splash': renderer.burst(e.x, e.y, e.z, '#bfe6ff', 10, 4); sound.play('bounce', vol(e.x, e.z) * 0.6); break;
    case 'repel': renderer.ring(e.x, e.y, e.z, 2.2, '#ffffff'); sound.play('block', vol(e.x, e.z)); if (e.p === me) renderer.addShake(0.2); break;
    case 'push': case 'zap': renderer.burst(e.x, e.y, e.z, '#7fe0ff', 10, 6); break;
    // 2D side view: the damaging edges and the pits
    case 'edgeHit': renderer.burst(e.x, e.y, e.z, '#ff4040', 14, 7); sound.play('hurt', vol(e.x, e.z)); if (e.p === me) renderer.addShake(0.25); break;
    case 'edgeBounce': renderer.ring(e.x, e.y, e.z, 1.6, '#7fe0ff'); renderer.burst(e.x, e.y, e.z, '#bfefff', 12, 8); sound.play('block', vol(e.x, e.z)); break;
    case 'pad': renderer.burst(e.x, e.y + 0.2, e.z, '#ffd23f', 10, 5); sound.play('jump', vol(e.x, e.z)); break;
    case 'brawlKO': {   // brawl: lost a stock past a blast zone
      const r = rosterOf(e.p); renderer.burst(e.x, e.y, e.z, r.color || '#ffffff', 60, 14); renderer.ring(e.x, e.y, e.z, 3, '#ffffff'); renderer.addShake(0.35);
      renderer.deathPop(e.x, e.y, e.z, r.color || '#ffffff', true); S.lastDeath = { x: e.x, y: e.y, z: e.z }; hitStop(0.09); sound.play('kill', 0.8);
      toast(e.stocks > 0 ? `💥 ${e.p === me ? t('You') : r.name} — ${e.pct}% (${e.stocks} left)` : `💥 ${e.p === me ? t('You') : r.name} ${t('is out!')}`);
      break;
    }
    case 'pit': renderer.burst(e.x, e.y, e.z, '#3a0a0a', 18, 5); sound.play('death', vol(e.x, e.z)); if (e.p === me) renderer.addShake(0.4); break;
    case 'budBlock': if (e.p === S.localId) S.budNoteT = performance.now() + 1200; break;
    case 'brawlItem': { const I = BITEM_INFO[e.k] || {}; renderer.burst(e.x, e.y, e.z, I.color || '#ffffff', 22, 5); renderer.ring(e.x, e.y - 0.4, e.z, 1.6, I.color || '#ffffff'); sound.play('powerUp', 0.8);
      if (e.p === me) toast(`${I.icon || ''} ${t(I.name || '')}${e.k === 'heal' ? ' −35%' : ''}`); break; }
    case 'brawlFloat': renderer.burst(e.x, e.y + 0.8, e.z, '#ffffff', 14, 3); break;
    case 'brawlDrop': case 'brawlClimb': renderer.burst(e.x, e.y + 0.3, e.z, '#dfe8ff', 8, 2); if (e.p === me) sound.play('jump', 0.7); break;
    case 'brawlHang': if (e.p === me) sound.play('ui'); break;
    case 'brawlCharge': renderer.burst(e.x, e.y + 0.8, e.z, '#7fd8ff', 10, 2); if (e.p === me) sound.play('shield', 0.6); break;
    case 'brawlDash': { const col = (S.roster.get(e.p) || {}).color || '#ffffff'; for (let i = 0; i <= 6; i++) renderer.burst(e.x + (e.x2 - e.x) * i / 6, e.y + (e.y2 - e.y) * i / 6, 0, col, 4, 1.5); sound.play('slash', e.p === me ? 0.9 : 0.5); break; }
    case 'brawlBreak': renderer.burst(e.x, e.y, e.z, '#ff6b6b', 16, 4); sound.play('hurt', 0.7); if (e.p === me) toast('Charge broken!'); break;
    case 'suddenX': banner(`Damage x${e.x}!`, '#ff6b6b', 1.2); break;   // v1.2.9
    case 'overtime': banner(e.brawl ? 'Sudden death!' : 'Overtime!', '#ff6b6b', 1.4); toast(e.brawl ? 'Sudden death: everyone\'s damage % keeps climbing, and damage doubles every 10 s.' : 'Overtime: everyone is slowly losing health, and damage doubles every 10 s.'); break;
    case 'count': banner(String(e.n), 'var(--fg)', 0.9); sound.play('ui', 1); break;
    case 'beam': renderer.line(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, rosterOf(e.p).color, 0.12); break;
    case 'chain': renderer.line(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, '#bfe9ff', 0.25, 0.5); sound.play('bounce', vol(e.x1, e.z1)); break;
    case 'charge': if (e.p === me) sound.play('reload', 0.6); break;
    case 'shieldBreak': renderer.burst(e.x, e.y, e.z, '#ff4040', 16, 5); sound.play('explode', vol(e.x, e.z) * 0.4); break;
    case 'tip': sound.play('explode', vol(e.x, e.z) * 0.25); break;
    case 'split': {
      for (const u of e.units) if (!S.roster.has(u.id)) S.roster.set(u.id, { ...u, transient: true, cards: [] });
      renderer.burst(e.x, e.y, e.z, '#7ee36b', 20, 6); break;
    }
    case 'laserWarn': toast('Laser sweep incoming — jump over it!'); sound.play('fight', 0.6); break;
    case 'hazard': toast({ laser: 'Hazard this round: sweeping laser', saws: 'Hazard this round: saw blades', turret: 'Hazard this round: rogue turret' }[e.type] || 'Hazard this round'); break;
    case 'picked': {
      const r = S.roster.get(e.p), c = cardById.get(e.card);
      if (e.p === me) { sound.play('cardPick'); if (!e.more) { S.offer = null; if (currentScreen === 'pick') { if ($('pickCards').classList.contains('done')) pickOut(); else show('none'); } } }
      else toast(`${r ? r.name : '?'} took ${c ? c.name : e.card}`);
      if (!e.more && S.pickers && S.pickers.delete(e.p) && currentScreen === 'pick') renderGiftRow();   // (v1.2.26: no more trades with them)
      renderChips();
      break;
    }
    case 'skyLock': if (e.p === me) renderer.lockFlash(e.x, e.y, e.z, rosterOf(me).color); break;
    case 'barricade': sound.play('shield', vol(e.x, e.z) * 0.8); break;
    case 'barricadeBreak': renderer.burst(e.x, e.y, e.z, e.kind === 'sandbag' ? ART.sandbagColor : ART.concreteColor, 22, 6); sound.play('explode', vol(e.x, e.z) * 0.5); break;
    // ---- cursed life drain, shield mods, units
    case 'drain': renderer.line(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, '#e0464b', 0.22, 0.25); break;
    case 'cloneSpawn': renderer.burst(e.x, e.y + 0.8, e.z, rosterOf(e.p).color, 22, 5); renderer.ring(e.x, e.y + 0.1, e.z, 1.2, rosterOf(e.p).color); sound.play('shield', vol(e.x, e.z)); break;
    case 'cloneSwap':
      renderer.line(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, rosterOf(e.p).color, 0.5, 0.15); renderer.burst(e.x2, e.y2, e.z2, rosterOf(e.p).color, 30, 6);
      sound.play('roundStart', vol(e.x2, e.z2)); if (e.p === me) toast('You took over your clone'); break;
    case 'rewind':
      renderer.line(e.x1, e.y1, e.z1, e.x2, e.y2, e.z2, '#9fe7ff', 0.35, 0.1); renderer.burst(e.x1, e.y1, e.z1, '#9fe7ff', 14, 4); renderer.burst(e.x2, e.y2, e.z2, '#9fe7ff', 14, 4);
      sound.play('shield', vol(e.x2, e.z2)); break;
    case 'slam':
      renderer.ring(e.x, e.y, e.z, e.r, rosterOf(e.p).color); renderer.burst(e.x, e.y + 0.2, e.z, '#c9b48a', 30, 7);
      sound.play('explode', vol(e.x, e.z)); sound.play('grunt', e.p === me ? 0.9 : vol(e.x, e.z) * 0.8); renderer.addShake(0.35 * vol(e.x, e.z)); break;
    case 'unitGone': renderer.burst(e.x, e.y, e.z, '#c9ced8', 12, 3); break;
    case 'leech': renderer.burst(e.x, e.y, e.z, '#5fe3a1', 6, 2.5); break;
    case 'nc': ncEvent(e, me, vol); break;
    case 'critterMax': if (e.p === S.localId) toast(`Max critters (${e.n}/${e.n}): your oldest one was replaced`); break;
    case 'revive':
      renderer.burst(e.x, e.y, e.z, '#ffb347', 30, 7); renderer.ring(e.x, e.y, e.z, 2.5, '#ffb347'); sound.play('roundWin', vol(e.x, e.z));
      toast(e.p === me ? 'Phoenix Protocol saved you!' : `${rosterOf(e.p).name} came back to life`);
      break;
    case 'over': showOver(e.w, e.tally, e.waves); break;
    case 'left': if (!e.bot) toast(`${rosterOf(e.p).name} left the match`); scoreKeyCache = ''; break;
  }
}

// ---------------------------------------------------------------- picking
function showPick(offer, rerolls, info = {}) {
  S.offer = offer; S.rerolls = rerolls; S.pickStart = performance.now(); S.pickInfo = info || {};
  const total = info.total || 1, k = total - (info.left || 1) + 1;
  $('pickTitle').textContent = info.start ? 'Pick a starting card' : info.catchUp ? 'Catch-up picks' : S.matchSettings.mode === 'waves' ? 'Wave cleared — pick an upgrade' : 'You lost the round';
  $('pickSub').textContent = (total > 1 ? t('Pick {k} of {n}', { k, n: total }) + ' · ' : '') + t('Press 1 to 5 or click a card') + ' · ' + t('B: card stats');
  const notes = [];
  if (info.speed && total > 1) notes.push(`⚡ Speed mode: you pick ${total} cards this phase, one at a time. Take one card from this hand; the hand then refreshes with new cards for your next pick.`);
  if (info.catchUp) notes.push('You joined mid-match, so you get extra picks to catch up with the lobby, and 50% more time for each one.');
  $('pickNote').textContent = notes.join(' ');
  $('pickNote').classList.toggle('hidden', !notes.length);
  const wrap = $('pickCards'); wrap.innerHTML = '';
  const mine = rosterOf(S.localId).cards || [];
  const tip = settings.recommend ? recommend(offer.map(id => cardById.get(id)).filter(Boolean), mine.map(id => cardById.get(id)).filter(Boolean)).best : null;
  offer.forEach((id, i) => {
    const c = cardById.get(id) || { id, name: id, modifiers: [], description: 'This card is missing from this computer\'s cards folder.' };
    const el = cardEl(c, { index: i, button: true });
    el.onclick = () => choosePick(i);
    const combo = S.matchSettings.combos === false ? null : CARDS.find(k => k.combo && k.combo.includes(id) && mine.includes(k.combo[0] === id ? k.combo[1] : k.combo[0]));
    if (combo) {
      const other = cardById.get(combo.combo[0] === id ? combo.combo[1] : combo.combo[0]);
      const tag = document.createElement('div'); tag.className = 'combotag';
      tag.textContent = `★ Combo with ${other ? other.name : '?'}${discovered.has(combo.id) ? ' → ' + combo.name : ' → ???'}`;
      el.appendChild(tag);
    }
    if (tip && tip.id === id && !combo) { // a light nudge, never a big banner
      const tg = document.createElement('div'); tg.className = 'tiptag';
      tg.textContent = `💡 ${t('Suggested')}: ${t('Fits {names}', { names: tip.why.join(' + ') })}`;
      el.appendChild(tg); el.classList.add('tipped');
    }
    // v1.2.0: the hand is dealt in as a fan (CSS .deal, staggered by --i); hovering lifts a card out of the fan
    const mid = (offer.length - 1) / 2;
    el.style.setProperty('--i', i); el.style.setProperty('--off', (i - mid).toFixed(2)); el.style.setProperty('--off2', ((i - mid) ** 2).toFixed(2));
    el.addEventListener('mouseenter', () => sound.play('cardHover', 0.6));
    wrap.appendChild(el);
  });
  wrap.classList.remove('done'); wrap.classList.add('fan');
  wrap.classList.remove('deal'); void wrap.offsetWidth; wrap.classList.add('deal');
  offer.forEach((_, i) => setTimeout(() => { if (currentScreen === 'pick') sound.play('cardDeal', 0.7); }, 120 + i * 70));
  hideSplash();
  const rb = $('rerollBtn');
  rb.classList.toggle('hidden', !(S.matchSettings.rerolls > 0));
  rb.textContent = `${t('Reroll')} (${rerolls})`; rb.disabled = rerolls <= 0;
  releaseMouse();
  if (document.pointerLockElement) document.exitPointerLock();
  show('pick');
  renderGiftRow();
  renderPeek(true);
  if (wrap.firstChild) wrap.firstChild.focus({ preventScroll: true });
}
function showComboAsk(comboId) {
  const C = cardById.get(comboId); if (!C) return;
  discover(comboId); S.comboAsk = comboId;
  const row = $('comboCards'); row.innerHTML = '';
  const a = cardById.get(C.combo[0]), b = cardById.get(C.combo[1]);
  for (const [c, sym] of [[a, '+'], [b, '='], [C, '']]) {
    if (!c) continue;
    row.appendChild(cardEl(c));
    if (sym) { const s2 = document.createElement('div'); s2.className = 'combosym'; s2.textContent = sym; row.appendChild(s2); }
  }
  releaseMouse();
  if (document.pointerLockElement) document.exitPointerLock();
  show('comboAsk');
}
// Scrap It: choose which held mod (weapon or shield) to destroy (asked by the match: hostsim.js, or the host).
function showBreakAsk(opts) {
  S.breakAsk = opts.slice();
  const row = $('breakCards'); row.innerHTML = '';
  opts.forEach(id => {
    const c = cardById.get(id); if (!c) return;
    const el = cardEl(c, { button: true });
    el.onclick = () => answerBreak(id);
    row.appendChild(el);
  });
  releaseMouse();
  if (document.pointerLockElement) document.exitPointerLock();
  show('breakAsk');
  if (row.firstChild) row.firstChild.focus();
}
function answerBreak(id) {
  if (!S || !S.breakAsk) return;
  S.breakAsk = null;
  show('none');   // v1.0.1: first, so the next hand (speed mode / extra picks) that the host deals at once stays on screen
  if (S.role === 'peer') S.net.send({ t: 'toHost', msg: { k: 'breakChoice', card: id } });
  else S.game.cmd({ t: 'break', from: S.localId, card: id });
}
function answerCombo(accept) {
  if (!S || !S.comboAsk) return;
  S.comboAsk = null;
  show('none');   // v1.0.1: first (the host deals the next hand right away; hiding after it locked the second pick)
  if (S.role === 'peer') S.net.send({ t: 'toHost', msg: { k: 'comboChoice', accept } });
  else S.game.cmd({ t: 'combo', from: S.localId, accept });
}
// v1.2.0: the chosen card flies up and the rest drop away before the screen closes (PICK_OUT ms)
const PICK_OUT = 420;
function pickOut() {
  S.pickOutUntil = performance.now() + PICK_OUT;
  setTimeout(() => { if (S && currentScreen === 'pick' && !S.offer) show('none'); }, PICK_OUT);
}
function choosePick(i) {
  if (!S || !S.offer || !S.offer[i]) return;
  const id = S.offer[i];
  if (S.giftIn) { S.giftIn = null; sendGift('giftAccept', { card: id }); renderGiftRow(); return; }   // v1.2.26: answering an ally's offer: this card goes to them
  const wrap = $('pickCards'), el = wrap.children[i];
  if (el && !wrap.classList.contains('done')) { el.classList.add('chosen'); wrap.classList.add('done'); }
  if (S.role === 'peer') {
    S.net.send({ t: 'toHost', msg: { k: 'pick', card: id } }); S.offer = null;
    if ((S.pickInfo && S.pickInfo.left) > 1) { setTimeout(() => { if (S && !S.offer && currentScreen === 'pick') $('pickCards').innerHTML = '<p class="hint">Dealing your next hand…</p>'; }, PICK_OUT); } else pickOut();
  }
  else S.game.cmd({ t: 'pick', from: S.localId, card: id });
}
function doReroll() {
  if (!S || !S.offer || S.rerolls <= 0) return;
  sound.play('reroll');
  if (S.role === 'peer') { S.rerolls = 0; $('rerollBtn').disabled = true; S.net.send({ t: 'toHost', msg: { k: 'reroll' } }); }
  else S.game.cmd({ t: 'reroll', from: S.localId });
}

// ---------------------------------------------------------------- match over
// v1.0.1: whoever won stands on the win screen, slowly turning (drag to turn them by hand).
let overShow = null;
function showWinners(w) {
  const canvas = $('overShow'); if (!canvas) return;
  const heroes = [...S.roster.values()].filter(r => !r.transient && !r.ownerId && r.kind !== 'hazardTurret');
  const mode = S.matchSettings.mode;
  let who = w === 'players' ? heroes : w && w[0] === 't' && (teamPlay() || owSquads(S.matchSettings)) ? heroes.filter(r => 't' + r.team === w) : heroes.filter(r => r.id === w);
  who = who.slice(0, 5);
  canvas.classList.toggle('hidden', !who.length);
  if (!who.length) return;
  if (!overShow) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(520, 300, false);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 520 / 300, 0.1, 60);
    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a4256, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85); sun.position.set(2, 4, 3); scene.add(sun);
    overShow = { r, scene, cam, items: [], drag: null, off: 0 };
    canvas.addEventListener('pointerdown', e => { overShow.drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if (overShow.drag == null) return; overShow.off += (e.clientX - overShow.drag) * 0.012; overShow.drag = e.clientX; });
    canvas.addEventListener('pointerup', () => { overShow.drag = null; });
    const loop = () => {
      if (currentScreen === 'over' && overShow.items.length) {
        const t = performance.now() / 1000;
        if (overShow.drag == null) overShow.off += 0.012;
        for (const it of overShow.items) { it.holder.rotation.y = overShow.off; if (it.model.animate) it.model.animate(t, 0); }
        overShow.r.render(overShow.scene, overShow.cam);
      }
      requestAnimationFrame(loop);
    };
    loop();
  }
  for (const it of overShow.items) overShow.scene.remove(it.holder);
  overShow.items = [];
  const gap = 1.5, n = who.length;
  who.forEach((r, i) => {
    const c = r.cosmetics || {}, m = buildPlayerModel(r.color || ART.ffaColors[0], c.gun, c.model);
    attachCosmetics(m, c);
    const holder = new THREE.Group(); holder.add(m.root); holder.position.x = (i - (n - 1) / 2) * gap;
    overShow.scene.add(holder); overShow.items.push({ holder, model: m });
  });
  const span = Math.max(1, (n - 1) * gap + 1.2);
  overShow.cam.position.set(0, 1.4, Math.max(4.2, span * 1.9)); overShow.cam.lookAt(0, 0.95, 0);
  overShow.off = -0.5;
}
function showOver(w, tally, wavesCleared) {
  if (document.pointerLockElement) document.exitPointerLock();
  releaseMouse();
  const L = keyLabel(w), won = w === myKey();
  $('overTitle').textContent = S.matchSettings.mode === 'waves'
    ? (S.matchSettings.core && !won ? `The core is destroyed — ${wavesCleared ?? (S.view.scores || {}).players ?? 0} waves cleared` : won ? `Victory — ${S.matchSettings.roundsToWin} waves survived` : `Defeat — ${wavesCleared ?? (S.view.scores || {}).players ?? 0} waves cleared`)
    : won ? 'Victory' : `${L.name} win${teamPlay() || L.name === 'You' ? '' : 's'}`;
  $('overTitle').style.color = L.color;
  const sc = S.view.scores || {};
  $('overScores').innerHTML = Object.keys(sc).sort((a, b) => sc[b] - sc[a]).map(k => {
    const l = keyLabel(k); return `<div><span style="color:${l.color}">${esc(l.name)}</span><b>${sc[k]}</b></div>`;
  }).join('');
  // v1.2.21 (Devin): one table: wins sit in the damage/kills/deaths table (the separate wins list only shows when there is no tally)
  const winsOf = x => sc[x.id] ?? sc[String(x.id)] ?? 0, teamWins = teamPlay() || waveMode();
  const t = (tally || []).slice().sort((a, b) => (teamWins ? 0 : winsOf(b) - winsOf(a)) || b.kills - a.kills || b.damage - a.damage || a.deaths - b.deaths);
  $('overScores').classList.toggle('hidden', t.length > 0 && !waveMode());
  const mostDmg = Math.max(0, ...t.map(x => x.damage)), mostK = Math.max(0, ...t.map(x => x.kills));
  const row = x => {
    const r = rosterOf(x.id);
    return `<tr><td style="color:${r.color}">${esc(x.id === S.localId ? 'You' : r.name)}</td>` +   // v1.1.5: colored name, like the wins list
      (teamWins ? '' : `<td class="wins">${winsOf(x)}</td>`) +
      `<td${x.damage === mostDmg && mostDmg > 0 ? ' style="color:var(--accent)"' : ''}>${x.damage}</td>` +
      `<td${x.kills === mostK && mostK > 0 ? ' style="color:var(--accent)"' : ''}>${x.kills}</td><td>${x.deaths}</td></tr>`;
  };
  let body = t.map(row).join('');
  // v1.0.1: team deathmatch groups each team together under a labelled header (team wins and totals), winners first
  if (teamPlay() && t.length) {
    const teams = new Map();
    for (const x of t) { const tm = rosterOf(x.id).team ?? 0; if (!teams.has(tm)) teams.set(tm, []); teams.get(tm).push(x); }
    body = [...teams.entries()].sort((a, b) => (sc['t' + b[0]] || 0) - (sc['t' + a[0]] || 0) || b[1].reduce((n, x) => n + x.kills, 0) - a[1].reduce((n, x) => n + x.kills, 0)).map(([tm, xs]) => {
      const l = keyLabel('t' + tm), sum = k => xs.reduce((n, x) => n + x[k], 0);
      return `<tr class="teamhead" style="--c:${l.color}"><td style="color:${l.color}">${esc(l.name)} <small>· ${sc['t' + tm] || 0} wins</small></td><td>${sum('damage')}</td><td>${sum('kills')}</td><td>${sum('deaths')}</td></tr>` + xs.map(row).join('');
    }).join('');
  }
  $('overTally').innerHTML = t.length ? `<tr><th>Player</th>${teamWins ? '' : '<th>Wins</th>'}<th>Damage</th><th>Kills</th><th>Deaths</th></tr>` + body : '';
  const unit = S.matchSettings.mode === 'waves' ? 'wave' : 'round';
  for (const o of $('extendN').options) o.textContent = S.matchSettings.mode === 'tourn' ? `+${o.value} ${o.value === '1' ? 'life' : 'lives'}` : `+${o.value} ${unit}${o.value === '1' ? '' : 's'}`;   // (v1.2.29 tournament: more lives)
  $('extendBtn').textContent = S.matchSettings.mode === 'waves' ? tr('Keep playing (harder, new boss)') : tr('Keep playing');
  // Co-op: more waves only after beating the boss; a wipe ends the run (the loss token was the retry).
  $('extendRow').classList.toggle('hidden', S.matchSettings.mode === 'waves' && !won);
  $('retryRow').classList.toggle('hidden', !(S.matchSettings.core && !won));   // Core Defense: play the lost wave again
  $('overHostRow').classList.toggle('hidden', !isHostSide());
  $('overPeerNote').classList.toggle('hidden', isHostSide());
  const payText = payMatch(won, tally);
  if (S.matchSettings.mode !== 'practice') { settings.lootboxes = (settings.lootboxes || 0) + 1; saveSettings(settings); }   // v26: a finished match earns a lootbox
  $('overLoot').classList.toggle('hidden', S.matchSettings.mode === 'practice');
  $('overCash').textContent = payText; $('overCash').classList.toggle('hidden', !payText);
  sound.play(won ? 'victory' : 'defeat');
  try { renderOverPeek(); } catch (err) { console.warn('over peek', err); }
  try { showWinners(w); } catch (err) { console.warn('win screen model', err); $('overShow').classList.add('hidden'); }
  show('over');
}

// ---------------------------------------------------------------- pause
// Esc pauses the whole match when you're the only human (with bots), or in Commander mode.
function canPauseAll() {
  if (!S || !S.inGame) return false;
  if (S.role === 'solo' || S.matchSettings.commander) return true;
  return [...S.roster.values()].filter(r => !r.isBot && !r.transient && r.kind !== 'hazardTurret').length <= 1;
}
function setPauseRequest(on) {
  if (!canPauseAll()) return;
  if (S.role === 'peer') S.net.send({ t: 'toHost', msg: { k: 'pause', on } });
  else { S.pausers = S.pausers || new Set(); if (on) S.pausers.add(S.localId); else S.pausers.delete(S.localId); S.paused = S.pausers.size > 0; }
}
// v28: Esc also opens the pause menu (and so Leave match) from the card pick screen; Resume goes back to it.
// (Brawl's fighter select comes before the match starts and has its own Leave match button.)
const PAUSE_FROM = new Set(['pick']);
let pauseReturn = 'none';
function togglePause() {
  if (!S || !S.inGame) return;
  if (currentScreen === 'pause') { setPauseRequest(false); show(pauseReturn === 'pick' && S.offer ? 'pick' : 'none'); pauseReturn = 'none'; return; }
  if (currentScreen === 'settings' && settingsReturn === 'pause') { show('pause'); return; }
  if (currentScreen !== 'none' && !PAUSE_FROM.has(currentScreen)) return;
  pauseReturn = currentScreen;
  setPauseRequest(true);
  $('pauseNote').textContent = canPauseAll() ? 'The match is paused for everyone.' : 'The match keeps running while this menu is open.';
  renderPauseJoin(); renderBets(true); renderPausePeek(); setLeaveLabels();
  releaseMouse();
  if (document.pointerLockElement) document.exitPointerLock();
  show('pause');
}

// Pause menu: how friends can join this match in progress.
function renderPauseJoin() {
  const box = $('pauseJoin');
  if (!S || S.role === 'solo' || !S.code) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  if (S.net && S.net.isSteam) {
    box.innerHTML = `<div class="jc"><span>${esc(t('Join code'))}</span><b class="code" data-noi18n>${esc(S.code)}</b><button class="btn ghost small" id="copyCode">Copy</button></div>
      <p class="hint">Friends can join from your Steam friends list, from their Multiplayer menu, by pasting this code into Join, or from an invite.</p>
      ${S.role === 'host' ? '<button class="btn ghost small" id="pauseInvite">Invite Steam friends</button>' : ''}`;
  } else {
    box.innerHTML = `<div class="jc"><span>${esc(t('Join code'))}</span><b class="code" data-noi18n>${esc(S.code)}</b><button class="btn ghost small" id="copyCode">Copy</button></div>
      <p class="hint">Late joiners watch until the next round. Returning players get their cards back; new players catch up at the next card screen.</p>`;
  }
  const cp = $('copyCode'); if (cp) cp.onclick = () => { try { navigator.clipboard.writeText(S.code); toast('Code copied'); } catch { /* clipboard blocked */ } };
  const inv = $('pauseInvite'); if (inv) inv.onclick = () => S.net.invite();
}

// ---------------------------------------------------------------- stats window (card screen, everyone)
let statsKey = '';
const STAT_COLS = [['hp', 'HP'], ['dmg', 'Dmg'], ['rate', 'Rate'], ['ammo', 'Ammo'], ['spd', 'Bullet spd'], ['bnc', 'Bounce'], ['regen', 'Regen'], ['ls', 'Leech %'], ['proj', 'Shots'], ['move', 'Move']];
function renderStatsWin(v) {
  const box = $('statsWin');
  const practice = S.matchSettings.mode === 'practice';
  // v1.0.1: never over the combine / Scrap It choices (or any other menu): only on the pick screen and while you wait
  const show = (v.phase === 'picking' && S.statsOpen && (currentScreen === 'pick' || currentScreen === 'none') && !(currentScreen === 'pick' && $('pick').classList.contains('peeking2'))) || (practice && !$('practice').classList.contains('hidden'));
  box.classList.toggle('hidden', !show);
  if (!show) { statsKey = ''; return; }
  const heroes = [...S.roster.values()].filter(r => !r.transient && r.stats && v.players.some(p => p.id === r.id) && (!practice || r.id === S.localId));
  const key = heroes.map(r => r.id + JSON.stringify(r.stats)).join('|') + currentScreen;
  if (key === statsKey) return;
  statsKey = key;
  box.classList.toggle('side', currentScreen === 'pick');
  box.innerHTML = `<h4>${esc(t('Card stats'))}</h4><div class="tw"><table><tr><th></th>${STAT_COLS.map(c => `<th>${c[1]}</th>`).join('')}</tr>` +
    heroes.map(r => `<tr class="${r.id === S.localId ? 'me' : ''}"><td style="color:${r.color}" data-noi18n>${esc(r.id === S.localId ? t('You') : r.name)}</td>${STAT_COLS.map(c => `<td>${r.stats[c[0]]}</td>`).join('')}</tr>`).join('') + '</table></div>';
}

// ---------------------------------------------------------------- pick phase: everyone's cards and stats
// A column of players down the left (spilling over to the right when it runs out of room). Hover a player's win
// counter to peek at their cards and stats; hover a card there to see it full size. Moving off closes it, unless you
// clicked the counter: then it stays open until you click outside it or the round starts.
let peekKey = '', peekId = null, peekPinned = false, peekCloseT = null, peekSwitchT = null;
function peekWinsOf(r, sc) {
  const mode = S.matchSettings.mode;
  const key = mode === 'waves' ? 'players' : teamPlay() ? 't' + r.team : r.id;
  return sc[key] || 0;
}
// v1.2.29 tournament: [losses, lives] for a player (teams share one count), or null outside a tournament
function tournLossOf(id) {
  const T = S && S.tn; if (!T || S.matchSettings.mode !== 'tourn') return null;
  const r = tnRow(id, T); if (!r) return null;
  return [Math.max(0, T.L - r[2]), T.L];
}
function peekHeroes() { return [...S.roster.values()].filter(r => !r.transient && !r.ownerId && r.kind !== 'hazardTurret'); }
function renderPeek(force) {
  if (!S || currentScreen !== 'pick') return;
  const sc = (S.view && S.view.scores) || {}, goal = S.matchSettings.roundsToWin;
  const heroes = peekHeroes();
  const key = heroes.map(r => r.id + ':' + (r.cards || []).length + ':' + peekWinsOf(r, sc) + ':' + (tournLossOf(r.id) || '')).join('|') + innerHeight;
  if (key === peekKey && !force) return;
  peekKey = key;
  const per = Math.max(3, Math.floor((innerHeight - 40) / 52));
  const tile = peekTile;
  // v1.2.25: more players than fit: both columns scroll (compact tiles), you first, then by wins
  const many = heroes.length > per * 2, cut = many ? Math.ceil(heroes.length / 2) : per;
  if (many) heroes.sort((a, b) => (b.id === S.localId) - (a.id === S.localId) || peekWinsOf(b, sc) - peekWinsOf(a, sc));
  for (const id of ['peekL', 'peekR']) $(id).classList.toggle('many', many);
  $('peekL').innerHTML = heroes.slice(0, cut).map(tile).join('');
  $('peekR').innerHTML = heroes.slice(cut, many ? heroes.length : per * 2).map(tile).join('');
  $('pick').classList.toggle('peeking', heroes.length > 0);
  $('pick').classList.toggle('peeking2', heroes.length > per);
  if (peekId) fillPeekWin(peekId);
}
// v1.0.1: the same player tile (hover = cards + stats window) is used on the pick screen, the pause menu and the scoreboard.
function peekTile(r) {
  const sc = (S.view && S.view.scores) || {}, goal = S.matchSettings.roundsToWin;
  const tl = tournLossOf(r.id);
  if (tl) {   // v1.2.29 tournament: red loss pips here too (pick screen, pause menu, after-match), like the scoreboard
    const [lost, L] = tl;
    const pips = L <= 10 ? Array.from({ length: L }, (_, i) => `<span class="${i < lost ? 'loss' : ''}"></span>`).join('') : '';
    return `<div class="peektile${r.id === S.localId ? ' me' : ''}${r.id === peekId ? ' open' : ''}" data-peek="${esc(r.id)}" style="--c:${r.color}">` +
      `<div class="pn" data-noi18n>${esc(r.id === S.localId ? t('You') : r.name)}</div>` +
      `<button type="button" class="tally tl" title="${esc(t('Losses'))}">${pips}<b>${lost}</b><small>${(r.cards || []).length} 🂠</small></button></div>`;
  }
  {
    const w = peekWinsOf(r, sc);
    const pips = goal <= 10 ? Array.from({ length: goal }, (_, i) => `<span class="${i < w ? 'on' : ''}"></span>`).join('') : '';
    return `<div class="peektile${r.id === S.localId ? ' me' : ''}${r.id === peekId ? ' open' : ''}" data-peek="${esc(r.id)}" style="--c:${r.color}">` +
      `<div class="pn" data-noi18n>${esc(r.id === S.localId ? t('You') : r.name)}</div>` +
      `<button type="button" class="tally" title="">${pips}<b>${w}</b><small>${(r.cards || []).length} 🂠</small></button></div>`;
  }
}
// v1.0.9: the after-match screen keeps the pick screen's player column (wins + cards, hover for their build).
function renderOverPeek() {
  const heroes = S && !S.amon && !S.rts ? peekHeroes() : [], per = Math.max(3, Math.floor((innerHeight - 40) / 52));
  $('overPeekL').innerHTML = heroes.slice(0, per).map(peekTile).join('');
  $('overPeekR').innerHTML = heroes.slice(per, per * 2).map(peekTile).join('');
}
// Pause menu: everyone's cards (hover a player, then a card; right-click a card for its details).
function renderPausePeek() {
  const box = $('pausePeek'); if (!box) return;
  const heroes = S ? peekHeroes() : [];
  box.classList.toggle('hidden', !heroes.length || !!S.amon || !!S.rts);
  box.innerHTML = `<h4>${esc(t('Cards in play'))}</h4><div class="pprow">${heroes.map(peekTile).join('')}</div><p class="hint">${esc(t('Hover a player to see their cards. Right-click a card for details.'))}</p>`;
}
function fillPeekWin(id) {
  const r = S.roster.get(id); if (!r) return closePeek(true);
  const keep = $('peekWin').dataset.pid === String(id) && $('peekWin').querySelector('.pkcard .card'); $('peekWin').dataset.pid = id;
  const sc = (S.view && S.view.scores) || {}, win = $('peekWin');
  const cards = (r.cards || []).map(cid => cardById.get(cid) || { id: cid, name: cid, rarity: 'common', modifiers: [], description: '' });
  const stats = r.stats ? `<table class="pkstats"><tr>${STAT_COLS.map(c => `<th>${c[1]}</th>`).join('')}</tr><tr>${STAT_COLS.map(c => `<td>${r.stats[c[0]] ?? '–'}</td>`).join('')}</tr></table>` : '';
  win.innerHTML = `<div class="pkhead" style="color:${r.color}" data-noi18n>${esc(id === S.localId ? t('You') : r.name)}<span>${esc(t('Wins'))}: <b>${peekWinsOf(r, sc)}</b></span>${peekPinned ? '<em>📌</em>' : ''}</div>` + stats +
    `<div class="pkicons" data-noi18n>${cards.length ? '' : `<i>${esc(t('No cards yet'))}</i>`}</div><div class="pkcard"><p class="hint">${cards.length ? 'Hover a card to see it. Right-click a card for details.' + (peekPinned ? '' : ' Right-click here to keep this open.') : ''}</p></div>`;
  const icons = win.querySelector('.pkicons');
  cards.forEach(c => {
    const b = document.createElement('div'); b.className = 'peekicon'; b._card = c;
    b.style.setProperty('--r', RARITY[rarityOf(c)].color);
    if (c.imageUrl) b.innerHTML = `<img alt="" src="${esc(c.imageUrl)}">`; else b.textContent = c.icon || '★';
    b.insertAdjacentHTML('beforeend', `<span>${esc(c.name)}</span>`);
    b.onmouseenter = () => { const slot = win.querySelector('.pkcard'); slot.innerHTML = ''; slot.appendChild(cardEl(c)); };
    icons.appendChild(b);
  });
  if (keep) { const slot = win.querySelector('.pkcard'); slot.innerHTML = ''; slot.appendChild(keep); }
}
function openPeek(id, tileEl, pin) {
  clearTimeout(peekCloseT);
  if (peekPinned && !pin && peekId !== id) return;   // a pinned window stays put while you hover others
  peekId = id; if (pin) peekPinned = true;
  fillPeekWin(id);
  const win = $('peekWin'); win.classList.remove('hidden');
  const r = tileEl.getBoundingClientRect(), right = !!tileEl.closest('#peekR, #overPeekR');
  const w = win.offsetWidth, h = win.offsetHeight;
  win.style.left = (right ? Math.max(8, r.left - w - 8) : Math.min(innerWidth - w - 8, r.right + 8)) + 'px';
  win.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top - 8)) + 'px';
  document.querySelectorAll('.peektile').forEach(el => el.classList.toggle('open', el.dataset.peek === id));
}
// v1.2.21 (Devin): the window used to vanish while the mouse was still on it (the tiles behind it get rebuilt as scores
// change, which fires mouseout); it now only closes when the mouse really is somewhere else.
const peekMouse = { x: -1, y: -1 };
function peekMaybeClose() {
  const el = peekMouse.x >= 0 && document.elementFromPoint(peekMouse.x, peekMouse.y);
  if (el && el.closest && el.closest('#peekWin, [data-peek]')) return;
  closePeek();
}
function closePeek(force) {
  if (peekPinned && !force) return;
  clearTimeout(peekCloseT);
  peekId = null; peekPinned = false;
  const w = $('peekWin'); if (w) w.classList.add('hidden');
  document.querySelectorAll('.peektile.open').forEach(el => el.classList.remove('open'));
}
function bindPeek() {
  for (const col of ['peekL', 'peekR', 'pausePeek', 'scoreboard', 'overPeekL', 'overPeekR']) {
    // v1.0.8: more forgiving on the way to the cards window: it stays up for a moment after you leave the name, and
    // brushing over other names on the way doesn't switch it (a name has to be held for a moment to switch)
    $(col).addEventListener('mouseover', e => {
      const tl = e.target.closest('[data-peek]'); if (!tl) return;
      clearTimeout(peekCloseT); clearTimeout(peekSwitchT);
      const open = !$('peekWin').classList.contains('hidden');
      if (!open || peekId === tl.dataset.peek || peekPinned) { if (!peekPinned || peekId !== tl.dataset.peek) openPeek(tl.dataset.peek, tl, false); return; }
      peekSwitchT = setTimeout(() => { if (tl.matches(':hover')) openPeek(tl.dataset.peek, tl, false); }, 260);
    });
    $(col).addEventListener('mouseout', e => { if (!peekPinned && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#peekWin, [data-peek]'))) peekCloseT = setTimeout(peekMaybeClose, 650); });
    // v1.2.21 (Devin): right-click a player to keep their window open until you click back into the game
    $(col).addEventListener('contextmenu', e => { const tl = e.target.closest('[data-peek]'); if (!tl) return; e.preventDefault(); peekPinned = false; openPeek(tl.dataset.peek, tl, true); });
    $(col).addEventListener('click', e => {
      const tl = e.target.closest('[data-peek]'); if (!tl) return;
      if (peekPinned && peekId === tl.dataset.peek) { closePeek(true); return; }
      peekPinned = false; openPeek(tl.dataset.peek, tl, true);
    });
  }
  $('peekWin').addEventListener('mouseenter', () => { clearTimeout(peekCloseT); clearTimeout(peekSwitchT); });
  $('peekWin').addEventListener('mouseleave', e => { if (!peekPinned && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-peek]'))) peekCloseT = setTimeout(peekMaybeClose, 650); });
  $('peekWin').addEventListener('contextmenu', e => { if (!peekPinned && peekId) { peekPinned = true; fillPeekWin(peekId); } if (!e.target.closest('.peekicon')) e.preventDefault(); });
  document.addEventListener('mousemove', e => { peekMouse.x = e.clientX; peekMouse.y = e.clientY; }, { passive: true });
  // Pinned: any click outside the window (and outside the player tiles) closes it.
  document.addEventListener('mousedown', e => {
    if (!peekPinned || e.button !== 0 || cardDetailOpen()) return;
    if (e.target.closest && e.target.closest('#peekWin, [data-peek], #cardDetail')) return;
    closePeek(true);
  });
}

// ---------------------------------------------------------------- hover a player: wins + cards
let hoverId = null, hoverT = 0, hoverKey = '';
function updateHover(v) {
  const tip = $('hoverTip');
  hoverT -= 1 / 60;
  if (hoverT <= 0) {
    hoverT = 0.1;
    const can = currentScreen === 'none' && (settings.view !== 'first' || locked() || altFree);
    hoverId = can ? renderer.playerAt(S.localId) : null;
  }
  const r = hoverId && S.roster.get(hoverId), pv = hoverId && v.players.find(p => p.id === hoverId);
  if (!r || !pv || !pv.alive) { tip.classList.add('hidden'); hoverKey = ''; return; }
  const owner = r.ownerId ? S.roster.get(r.ownerId) : r;
  if (!owner) { tip.classList.add('hidden'); return; }
  const sc = v.scores || {}, mode = S.matchSettings.mode;
  const key = mode === 'waves' ? 'players' : teamPlay() ? 't' + owner.team : owner.id;
  const wins = sc[key];
  const cards = owner.cards || [];
  const k2 = hoverId + '|' + wins + '|' + cards.join(',');
  if (k2 !== hoverKey) {
    hoverKey = k2;
    const chips = cards.slice(0, 10).map(id => { const c = cardById.get(id) || { name: id, rarity: 'common' }; return `<span style="--r:${RARITY[rarityOf(c)].color}">${esc(c.name)}</span>`; }).join('');
    tip.innerHTML = `<div class="hn" style="color:${r.color}" data-noi18n>${esc(r.name)}</div>` +
      (wins != null && mode !== 'practice' ? `<div class="hw">${esc(t('Wins'))}: <b>${wins}</b>${teamPlay() ? ` <small>(${esc(ART.teamNames[owner.team] || '')})</small>` : ''}</div>` : '') +
      `<div class="cl" data-noi18n>${chips || `<i>${esc(t('No cards yet'))}</i>`}${cards.length > 10 ? `<span>+${cards.length - 10}</span>` : ''}</div>`;
  }
  tip.classList.remove('hidden');
  if (settings.view === 'first' && locked()) { tip.style.left = '50%'; tip.style.top = 'calc(50% + 28px)'; tip.style.transform = 'translateX(-50%)'; }
  else { tip.style.transform = ''; tip.style.left = Math.min(innerWidth - 240, (renderer.mouse.x + 1) / 2 * innerWidth + 16) + 'px'; tip.style.top = Math.min(innerHeight - 120, (1 - renderer.mouse.y) / 2 * innerHeight + 16) + 'px'; }
}

// ---------------------------------------------------------------- practice range
let prFilter = 'all', prDmg = [], prLastTotal = 0, prBig = 0;
// (the match's mirror of you: your cards and damage dealt; hostsim.js mirror)
function practiceMe() { const m = S && S.game && S.game.mirror && S.game.mirror.me; return m ? { cards: m.cards, tally: { damage: m.dmg } } : null; }
function openPracticePanel(open) {
  const el = $('practice');
  el.classList.toggle('hidden', !open);
  if (open) {
    const st = S.game.settings;
    $('prDummies').value = String(st.dummyCount || 3); $('prDummyMode').value = st.dummyMode || 'idle';
    $('prDummyHp').value = String(st.dummyHp || 100); $('prGod').checked = st.practiceGod !== false;
    $('prRarity').innerHTML = ['all', ...Object.keys(RARITY)].map(k => `<button class="btn ghost small${prFilter === k ? ' sel' : ''}" data-prf="${k}">${k === 'all' ? t('All') : RARITY[k].label}</button>`).join('');
    renderPractice();
    if (document.pointerLockElement) { altFree = true; document.exitPointerLock(); }
  }
  statsKey = '';
}
function renderPractice() {
  const me = practiceMe(); if (!me) return;
  $('prCount').textContent = `(${me.cards.length})`;
  $('prMine').innerHTML = me.cards.length ? me.cards.map((id, i) => { const c = cardById.get(id) || { name: id }; return `<button class="chip" data-rm="${i}" style="--r:${RARITY[rarityOf(c)].color}" title="Remove">${esc(c.name)} ✕</button>`; }).join('') : `<i class="hint">${esc(t('No cards yet'))}</i>`;
  const q = $('prSearch').value.trim().toLowerCase();
  const order = Object.keys(RARITY);
  const list = CARDS.filter(c => (prFilter === 'all' || c.rarity === prFilter) && (!q || c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q)))
    .sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.name.localeCompare(b.name));
  $('prAll').innerHTML = list.map(c => `<button class="pcard" data-add="${esc(c.id)}" style="--r:${RARITY[rarityOf(c)].color}" title="${esc(cardLines(c).map(l => l[0] + ' ' + l[1]).join(', '))}"><b>${esc(c.name)}</b><small>${esc(c.description || '')}</small></button>`).join('');
}
function setPracticeCards(list) { S.practiceCards = list.slice(); S.game.cmd({ t: 'practice', list }); if (S.game.mirror && S.game.mirror.me) { S.game.mirror.me.cards = list.slice(); renderPractice(); } sound.play('cardPick', 0.6); }
function restartPractice() {
  const st = S.lobby.settings;
  st.dummyCount = +$('prDummies').value; st.dummyMode = $('prDummyMode').value; st.dummyHp = +$('prDummyHp').value; st.practiceGod = $('prGod').checked;
  const me = practiceMe(); S.practiceCards = me ? me.cards.slice() : S.practiceCards;
  startMatch();
}
function updatePracticeHud() {
  const me = practiceMe(); if (!me) return;
  const now = performance.now() / 1000, tot = me.tally.damage;
  if (tot < prLastTotal) prLastTotal = tot;
  if (tot > prLastTotal) { const d = tot - prLastTotal; prDmg.push([now, d]); prBig = Math.max(prBig, d); prLastTotal = tot; }
  while (prDmg.length && prDmg[0][0] < now - 5) prDmg.shift();
  const dps = prDmg.reduce((a, x) => a + x[1], 0) / 5;
  $('prDps').textContent = Math.round(dps); $('prTotal').textContent = Math.round(tot); $('prBig').textContent = Math.round(prBig);
}
function bindPractice() {
  $('prHide').onclick = () => openPracticePanel(false);
  $('prSearch').addEventListener('input', renderPractice);
  $('prRarity').addEventListener('click', e => { const f = e.target.dataset && e.target.dataset.prf; if (f) { prFilter = f; openPracticePanel(true); } });
  $('prAll').addEventListener('click', e => { const b = e.target.closest('[data-add]'); const me = practiceMe(); if (b && me) setPracticeCards([...me.cards, b.dataset.add]); });
  $('prMine').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); const me = practiceMe(); if (b && me) { const l = me.cards.slice(); l.splice(+b.dataset.rm, 1); setPracticeCards(l); } });
  $('prClear').onclick = () => setPracticeCards([]);
  $('prRandom').onclick = () => { const me = practiceMe(); const pool = CARDS.filter(c => c.rarity !== 'combo'); if (me && pool.length) setPracticeCards([...me.cards, pool[Math.floor(Math.random() * pool.length)].id]); };
  $('prResetDps').onclick = () => { if (S && S.game) S.game.cmd({ t: 'resetDmg' }); prDmg = []; prLastTotal = 0; prBig = 0; };
  for (const id of ['prDummies', 'prDummyMode', 'prDummyHp']) $(id).onchange = restartPractice;
  $('prGod').onchange = () => { S.lobby.settings.practiceGod = $('prGod').checked; if (S.game) S.game.cmd({ t: 'setting', k: 'practiceGod', v: $('prGod').checked }); };
  $('prNewArena').onclick = restartPractice;
}

// ---------------------------------------------------------------- Steam friends' games
let friendsTimer = null;
function refreshFriends() {
  if (!window.steamBridge || !steamStatus.available) return;
  window.steamBridge.send({ t: 'friends' });
}
function renderFriends(m) {
  const box = $('friendList');
  const list = (m.friends || []).slice().sort((a, b) => a.started - b.started || b.open - a.open);
  if (!m.ok && !list.length) { box.innerHTML = `<div class="empty">Couldn't read your Steam friends list (${esc(m.error || 'unknown error')}). Invites and "Join game" still work.</div>`; return; }
  if (!list.length) { box.innerHTML = '<div class="empty">No friends are hosting a game with a free spot right now.</div>'; return; }
  box.innerHTML = '';
  for (const f of list) {
    const d = document.createElement('div'); d.className = 'room';
    const humanFree = Math.max(0, f.open - f.bots);
    const seats = humanFree > 0 ? `${humanFree} open spot${humanFree === 1 ? '' : 's'}` : '';
    const bots = f.bots > 0 ? `${f.bots} bot${f.bots === 1 ? '' : 's'} you can replace` : '';
    d.innerHTML = `<span><b data-noi18n>${esc(f.name)}</b> · ${f.players}/${f.max} · ${[seats, bots].filter(Boolean).join(', ')}${f.started ? ' · in a match (late join)' : ' · in the lobby'}</span>`;
    const b = document.createElement('button'); b.className = 'btn small'; b.textContent = t('Join');
    b.onclick = () => joinRoom(f.lobby, 'steam');
    d.appendChild(b); box.appendChild(d);
  }
}

// ---------------------------------------------------------------- HUD
let scoreKeyCache = '', ammoKey = '';
function renderChips() {
  if (!S) return;
  const mine = rosterOf(S.localId).cards || [];
  // v1.2.0: the newest six cards, plus a "+N" chip (hover the scoreboard to see them all), so the HUD stays small
  const shown = mine.slice(-6), more = mine.length - shown.length;
  $('mycards').innerHTML = (more > 0 ? `<span class="more" title="${esc(mine.slice(0, more).map(id => (cardById.get(id) || { name: id }).name).join(', '))}">+${more}</span>` : '') +
    shown.map(id => `<span>${esc((cardById.get(id) || { name: id }).name)}</span>`).join('');
}
// Top-left: one row per player (free-for-all) or team, colored, with win pips. Hover shows cards.
function scCardsHtml(r) {
  return r.cards.length
    ? `<div class="cl">${r.cards.map(id => { const c = cardById.get(id) || { name: id, rarity: 'common' }; return `<span style="--r:${RARITY[rarityOf(c)].color}">${esc(c.name)}</span>`; }).join('')}</div>`
    : '<div class="none">No cards yet</div>';
}
// v1.2.28 tournament: the pips count losses (red) instead of wins. You first, then whoever is in your arena right now
// ("vs"), then the rest by losses left. Hover still shows cards.
function renderTournBoard() {
  const T = S.tn, L = T.L, mine = tnArenaOf(S.localId), me = S.localId;
  const rowOf = id => tnRow(id, T);
  const lost = r => Math.max(0, L - r[2]);
  const foes = T.p.filter(r => r[0] !== me && mine != null && mine >= 0 && r[1] === mine && !r[3]);
  const others = T.p.filter(r => r[0] !== me && !foes.includes(r)).sort((a, b) => a[3] - b[3] || b[2] - a[2]);
  const shown = others.slice(0, Math.max(0, 10 - foes.length)), rest = others.length - shown.length;
  const line = (r, tag) => {
    const ro = rosterOf(r[0]), nm = r[0] === me ? 'You' : ro.name;
    const pips = L <= 10 ? Array.from({ length: L }, (_, i) => `<span class="${i < lost(r) ? 'loss' : ''}"></span>`).join('') : `<b class="lossN">${lost(r)}</b>`;
    return `<div class="sc${r[0] === me ? ' me' : ''}${tag ? ' vs' : ''}${r[3] ? ' ko' : ''}" style="--c:${ro.color || '#8a93a8'}"><i></i><span>${tag ? '<em>vs</em> ' : ''}${esc(nm)}${r[3] ? ' <small>out</small>' : ''}</span><span class="wins tl" title="${esc(t('Losses'))}">${pips}</span><div class="pop"><div class="pm" data-peek="${esc(r[0])}"><div class="who" style="color:${ro.color}">${esc(nm)}</div>${scCardsHtml(ro)}</div></div></div>`;
  };
  const mr = rowOf(me);
  $('scoreboard').classList.toggle('many', T.p.length > 10);
  $('scoreboard').innerHTML = (mr ? line(mr) : '') + foes.map(r => line(r, true)).join('') + (foes.length && shown.length ? '<div class="scgap"></div>' : '') + shown.map(r => line(r)).join('') +
    (rest ? `<div class="sc scmore" style="--c:#8a93a8"><i></i><span>+${rest} more</span></div>` : '');
}
function renderScoreboard(sc) {
  if (S.tn && S.matchSettings.mode === 'tourn') { renderTournBoard(); return; }
  const mk = myKey(), goal = S.matchSettings.roundsToWin, tdm = teamPlay();
  const cardsHtml = scCardsHtml;
  $('scoreboard').classList.toggle('many', Object.keys(sc).length > 10);
  // v1.2.25: big lobbies show the top 10 and you, plus a count of the rest (100 rows filled the screen)
  let keys = Object.keys(sc).sort((a, b) => sc[b] - sc[a]), rest = 0;
  if (keys.length > 16) { const top = keys.slice(0, 10); if (sc[mk] != null && !top.includes(mk)) top.push(mk); rest = keys.length - top.length; keys = top; }
  $('scoreboard').innerHTML = keys.map(k => {
    const l = keyLabel(k);
    const heroes = [...S.roster.values()].filter(r => !r.transient);
    const members = k === 'players' ? heroes : tdm ? heroes.filter(r => 't' + r.team === k) : [S.roster.get(k)].filter(Boolean);
    const pop = members.map(r => `<div class="pm" data-peek="${esc(r.id)}"><div class="who" style="color:${r.color}">${esc(r.id === S.localId ? 'You' : r.name)}</div>${cardsHtml(r)}</div>`).join('');
    const pips = goal <= 10 ? Array.from({ length: goal }, (_, i) => `<span class="${i < sc[k] ? 'on' : ''}"></span>`).join('') : '';
    return `<div class="sc${k === mk ? ' me' : ''}" style="--c:${l.color}"><i></i><span>${esc(l.name)}</span><span class="wins">${pips}<b>${sc[k]}</b></span><div class="pop">${pop}</div></div>`;
  }).join('') + (rest ? `<div class="sc scmore" style="--c:#8a93a8"><i></i><span>+${rest} more</span></div>` : '');
}
let hudHealN = null, hudBlockFrac = 0, curAmmoKey = '';
// Small ammo pips and reload bar beside the cursor (or under the crosshair in first person).
let curBlkReady = true;
function updateCursorAmmo(me) {
  const el = $('curAmmo');
  const on = settings.cursorAmmo && me && me.alive && currentScreen === 'none' && !S.matchSettings.commander && me.maxAmmo > 0 && !(settings.view === 'first' && !locked());
  el.classList.toggle('hidden', !on);
  if (!on) return;
  const reloading = me.reloadFrac > 0;
  // v1.2.8: magazine pips like the bottom-left HUD while the mag holds 9 or fewer; bigger mags show the number
  const pips = me.maxAmmo <= 9, ck = reloading ? 'r' : `${me.ammo}/${me.maxAmmo}/${me.color}`;
  if (ck !== curAmmoKey) { curAmmoKey = ck; $('curAmmoN').innerHTML = reloading ? '' : pips ? Array.from({ length: me.maxAmmo }, (_, k) => k < me.ammo ? `<i style="background:${me.color}"></i>` : '<i class="empty"></i>').join('') : `${me.ammo}`; }
  el.classList.toggle('pips', pips);
  el.classList.toggle('reloading', reloading);
  el.classList.toggle('low', !reloading && me.ammo <= Math.max(1, Math.floor(me.maxAmmo / 4)));
  $('curAmmoBar').style.width = (reloading ? (1 - me.reloadFrac) * 100 : 0) + '%';
  {   // v1.2.13 (Devin): block ready dot next to the ammo: a ring that fills while block recharges, lit up when it's ready
    const bf = me.blockFrac || 0, b = $('curBlk'), ready = !(bf > 0);
    b.style.setProperty('--p', Math.round((1 - bf) * 100) + '%'); b.classList.toggle('ready', ready);
    if (ready && !curBlkReady) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    curBlkReady = ready;
  }
  {   // v1.2.15: round-2 card chips
    const n = me.nc, chips = [];
    if (n) {
      if (n.press > 1) chips.push(`<b class="${n.press >= 8 ? 'hot' : ''}">▲${n.press}</b>`);
      if (n.rhyReady) chips.push('<b class="hot">🥁</b>'); else if (n.rhy >= 0) chips.push(`<b class="rhy" style="--p:${Math.round(n.rhy * 100)}%">🥁</b>`);
      if (n.cold) chips.push('<b>❄</b>');
      if (n.lastRound) chips.push('<b class="hot">●</b>');
      if (n.shell) chips.push(`<b>🥚${n.shell > 1 ? n.shell : ''}</b>`);
      if (n.od) chips.push('<b class="hot">⚡</b>');
      if (n.salvo) chips.push('<b class="hot">🎺</b>');
      if (n.ascTier) chips.push(`<b>🌟${n.ascTier}</b>`);
      if (n.purge > 0) chips.push(`<b class="rhy" style="--p:${Math.round(n.purge * 100)}%">💥</b>`);
    }
    setHtml($('curNc'), chips.join(''));
  }
  if (settings.view === 'first') { el.style.left = 'calc(50% + 14px)'; el.style.top = 'calc(50% + 10px)'; }
  else { el.style.left = ((renderer.mouse.x + 1) / 2 * innerWidth + 16) + 'px'; el.style.top = ((1 - renderer.mouse.y) / 2 * innerHeight + 14) + 'px'; }
}
// Brawl (v1.2.23 revamp): Smash-style fighter cards along the bottom (badge, name, fighter, big damage % that shakes
// when it climbs, stock pips, power-up), yours with jump / dash chips, and the sudden death clock at the top.
let brawlKey = '', brawlPct = new Map();
const FIGHTER_ICON = { classic: '🥊', bolt: '⚡', mochi: '🫧', sentinel: '🛡', quack: '🦆', astro: '☄', cubert: '🧊', tiki: '🔥', shroom: '🍄', prism: '💎', gumdrop: '🍬', vanguard: '🏰', wisp: '🗡', strider: '💨', fishbowl: '🐟' };
function updateBrawlHud() {
  let el = $('brawlHud'), clock = $('brawlClock');
  const rows = S.matchSettings.brawl ? S.brawlRows : null;
  $('hud').classList.toggle('brawlmode', !!rows);
  if (!rows) { if (el) el.classList.add('hidden'); if (clock) clock.classList.add('hidden'); return; }
  if (!el) { el = document.createElement('div'); el.id = 'brawlHud'; el.className = 'brawlhud'; $('hud').appendChild(el); }
  if (!clock) { clock = document.createElement('div'); clock.id = 'brawlClock'; clock.className = 'brawlclock'; $('hud').appendChild(clock); }
  el.classList.remove('hidden');
  const st = S.brawlT;
  clock.classList.toggle('hidden', st == null || S.view.phase !== 'play');
  if (st != null) { const txt = st > 0 ? `${Math.floor(st / 60)}:${String(st % 60).padStart(2, '0')}` : '⚠ SUDDEN DEATH'; if (clock.textContent !== txt) clock.textContent = txt; clock.classList.toggle('hot', st <= 10); }
  const key = JSON.stringify(rows) + (S.view.scores ? JSON.stringify(S.view.scores) : '');
  if (key === brawlKey) return;
  brawlKey = key;
  const pc = p => `hsl(${Math.max(0, 50 - p * 0.35)}, 100%, ${Math.max(45, 95 - p * 0.3)}%)`;
  const sc = S.view.scores || {}, maxSt = Math.max(1, S.matchSettings.stocks || BRAWL.stocks);
  el.innerHTML = rows.map(([id, pct, stk, f, airJ, dash, item]) => {
    const r = rosterOf(id), mine = id === S.localId, prev = brawlPct.get(id) ?? pct;
    brawlPct.set(id, pct);
    const hit = pct > prev ? (pct - prev >= 12 ? ' hit big' : ' hit') : '';
    const it = item && BITEM_INFO[item] ? `<em class="bitem" style="--c:${BITEM_INFO[item].color}" title="${esc(BITEM_INFO[item].name)}">${BITEM_INFO[item].icon}</em>` : '';
    const pips = Array.from({ length: maxSt }, (_, i) => `<u class="${i < stk ? 'on' : ''}" style="--c:${r.color}"></u>`).join('');
    const wins = sc[id] || 0;
    const chips = mine && stk ? `<span class="bchips"><span class="${airJ > 0 ? 'on' : ''}">⤒ ${t('Jump')}</span><span class="${dash ? 'on' : ''}">➹ ${t('Dash')}</span></span>` : '';
    return `<div class="bf${stk ? '' : ' out'}${mine ? ' me' : ''}" style="--c:${r.color}">
      <div class="bbadge">${FIGHTER_ICON[f] || '🥊'}</div>
      <div class="bbody"><small>${esc(r.name || '')}${wins ? ` <span class="bwins">🏆${wins}</span>` : ''}</small><span class="bfname">${esc((FIGHTERS[f] || FIGHTERS.classic).name)}</span>
      <b class="bpct${hit}" style="color:${pc(pct)}">${stk ? pct + '<sub>%</sub>' : 'OUT'}</b><span class="bpips">${pips}</span>${chips}</div>${it}</div>`;
  }).join('');
}
// Core Defense: the respawn countdown while you're down.
function updateCoreHud() {
  // v28: build phase: who's ready (Enter readies up, again unreadies; the wave comes once everyone is ready)
  let rd = $('coreReadyHud');
  const co = S.matchSettings.core && S.view.core, building = co && S.view.phase === 'countdown';
  if (building) {
    if (!rd) { rd = document.createElement('div'); rd.id = 'coreReadyHud'; rd.style.cssText = 'position:absolute;left:50%;top:76px;transform:translateX(-50%);font:600 15px system-ui;color:#dff6ff;background:#0009;padding:5px 12px;border-radius:8px;pointer-events:none;white-space:nowrap'; $('hud').appendChild(rd); }
    const humans = [...S.roster.values()].filter(r => !r.transient && !r.isBot && r.kind !== 'hazardTurret'), ready = new Set(co.rd || []);
    const n = humans.filter(r => ready.has(r.id)).length, mine = ready.has(S.localId);
    rd.classList.remove('hidden');
    setHtml(rd, `${mine ? '✅ Ready' : '⏳ Building'} · ${n}/${humans.length} ready · <b>Enter</b> ${mine ? 'to unready' : 'to start the wave'}`);
  } else if (rd) rd.classList.add('hidden');
  { // v1.2.23: lifting / carrying the core
    let mv = $('coreMoveHud');
    const cc = co && (co.cc || []).find(r => r[0] === S.localId), me = S.view.players.find(p => p.id === S.localId);
    const cr = S.view.players.find(p => p.kind === 'core');
    const near = !cc && co && me && me.alive && cr && Math.hypot(cr.pos.x - me.pos.x, cr.pos.z - me.pos.z) < 3.2 && !(co.cr || []).some(r => r[0] === S.localId);
    const k = codeLabel((BINDS.use || [])[0] || '') || 'E';
    const txt = cc ? (cc[1] < 1 ? `Lifting the core… ${Math.round(cc[1] * 100)}%` : `Carrying the core (slowed) · ${k} to set it down`) : near ? `Hold ${k} to move the core` : '';
    if (txt && !mv) { mv = document.createElement('div'); mv.id = 'coreMoveHud'; mv.style.cssText = 'position:absolute;left:50%;bottom:150px;transform:translateX(-50%);font:600 14px system-ui;color:#bff0ff;background:#0008;padding:4px 10px;border-radius:8px;pointer-events:none'; $('hud').appendChild(mv); }
    if (mv) { mv.classList.toggle('hidden', !txt); if (txt && mv.textContent !== txt) mv.textContent = txt; }
  }
  let el = $('coreHud');
  const rs = S.matchSettings.core && S.view.core ? (S.view.core.rs || []).find(r => r[0] === S.localId) : null;
  if (!rs) { if (el) el.classList.add('hidden'); return; }
  if (!el) { el = document.createElement('div'); el.id = 'coreHud'; el.style.cssText = 'position:absolute;left:50%;top:38%;transform:translateX(-50%);font:700 26px system-ui;color:#fff;text-shadow:0 2px 6px #000;pointer-events:none'; $('hud').appendChild(el); }
  el.classList.remove('hidden'); el.textContent = `Respawning in ${rs[1]}`;
}
// v1.0.1 open world: the red wall kills on touch, so a warning shows when you get close to it (or are outside it)
function updateWallWarn() {
  let el = $('owWallWarn');
  const w = S.view && S.view.ow && S.view.ow.wall, me = S.view.players.find(p => p.id === S.localId);
  let txt = '';
  if (w && me && me.alive && currentScreen === 'none') {
    const gap = w[2] - Math.hypot(me.pos.x - w[0], me.pos.z - w[1]);
    if (gap < 12) txt = gap < 3 ? `⚠ THE RED WALL IS ${Math.max(0, gap).toFixed(0)} m AWAY: GET INSIDE OR DIE` : `⚠ Red wall close (${gap.toFixed(0)} m): touching it kills you`;
  }
  if (!el) { if (!txt) return; el = document.createElement('div'); el.id = 'owWallWarn'; el.className = 'owwallwarn'; $('hud').appendChild(el); }
  el.textContent = txt; el.classList.toggle('hidden', !txt); el.classList.toggle('hot', !!txt && txt.includes('DIE'));
}
// ---------------------------------------------------------------- v1.2.26 tournament (client side)
// Every arena is the same map in the same place; the view only keeps what's in the arena you're in (or watching).
// v1.2.35: rows looked up by id through an index made once per table (1000-player tables were searched row by row)
const tnIdx = new WeakMap(), tnTl = new WeakMap(), tnSigs = new WeakMap();
let scoreKeyT = 0;
function tnSig(T) { let k = tnSigs.get(T.p); if (k == null) tnSigs.set(T.p, k = JSON.stringify(T.p)); return k; }
function tnRow(id, T = S && S.tn) { if (!T) return null; let m = tnIdx.get(T.p); if (!m) tnIdx.set(T.p, m = new Map(T.p.map(r => [r[0], r]))); return m.get(id) || null; }
// a joiner's table from the snapshot's two halves (arenas, player rows), the same object while neither changed
let tnLast = null;
function tnJoin(tn, tp) { if (tnLast && tnLast.src === tn && tnLast.p === tp) return tnLast; tnLast = { ...tn, p: tp || [] }; Object.defineProperty(tnLast, 'src', { value: tn, enumerable: false }); return tnLast; }
function tnArenaOf(id, n = 0) {
  const T = S && S.tn; if (!T || id == null) return null;
  const row = tnRow(id, T); if (row) return row[1];
  const r = S.roster.get(id);
  return r && r.ownerId != null && r.ownerId !== id && n < 4 ? tnArenaOf(r.ownerId, n + 1) : null;
}
// the arena on screen: your own, or (knocked out, or your arena is over and you're down) the one you chose to watch
function viewArena() {
  const T = S.tn; if (!T) return null;
  const mine = tnArenaOf(S.localId), me = S.view.players.find(p => p.id === S.localId);
  const free = mine == null || mine < 0 || (T.d && T.d[mine] && !(me && me.alive));
  if (!free) { S.tWatch = null; return mine; }
  if (S.tWatch == null || S.tWatch >= T.a || (T.d && T.d[S.tWatch] && T.n > 0)) S.tWatch = T.d ? Math.max(0, T.d.findIndex(x => !x)) : 0;
  return S.tWatch;
}
function inMyArena(id) { if (id == null) return true; const a = tnArenaOf(id); return a == null || a < 0 || a === viewArena(); }
function tournWatchNext() {
  const T = S.tn; if (!T || !T.d) return false;
  const cur = viewArena(); if (cur === tnArenaOf(S.localId) && cur >= 0) { const me = S.view.players.find(p => p.id === S.localId); if (!T.d[cur] || (me && me.alive)) return false; }
  for (let k = 1; k <= T.a; k++) { const i = (cur + k) % T.a; if (!T.d[i] || T.n === 0) { S.tWatch = i; return true; } }
  return false;
}
let tvCache = null;
function tournView(v) {
  if (!S.tn || S.matchSettings.mode !== 'tourn') return v;
  const A = viewArena(), ok = id => { const a = tnArenaOf(id); return a == null || a < 0 ? id == null : a === A; };
  const okP = p => { const a = tnArenaOf(p.id); return a == null ? true : a === A; };
  if (tvCache && tvCache.v === v && tvCache.n === v.players.length && tvCache.A === A && tvCache.b === v.bullets) return tvCache.out;
  // v1.2.28: red loss pips under each name (v.tl = [losses, lives])
  let tl = tnTl.get(S.tn.p); if (!tl) tnTl.set(S.tn.p, tl = new Map(S.tn.p.map(r => [r[0], [Math.max(0, S.tn.L - r[2]), S.tn.L]])));   // (v1.2.35: once per table, not per frame)
  const out = { ...v, players: v.players.filter(okP).map(p => tl.has(p.id) ? { ...p, tl: tl.get(p.id) } : p), bullets: (v.bullets || []).filter(b => ok(b.o)), shields: (v.shields || []).filter(x => ok(x.o)), mines: (v.mines || []).filter(x => ok(x.o)), barricades: (v.barricades || []).filter(x => ok(x.o)) };
  tvCache = { v, n: v.players.length, A, b: v.bullets, out };
  return out;
}
// v1.2.28 matchup screen before each tournament round: your opponent's model turns on the left, their cards deal in on
// the right, for TOURN.intro seconds (the host's countdown waits; Enter readies you, and once every player is ready the
// round starts early). Only at the round start: a team player sent to help an ally mid-round ('tMove') never sees it.
let TI = null;
function tournIntro(e) {
  tournIntroEnd();
  const ids = (e.tA || []).find(A => A.includes(S.localId));
  if (!ids || !(e.ti > 0)) return;
  const mk = myKey(), keyOfId = id => teamPlay() ? 't' + rosterOf(id).team : id, foes = ids.filter(id => id !== S.localId && keyOfId(id) !== mk).map(id => rosterOf(id));
  if (!foes.length) return;
  let el = $('tIntro');
  if (!el) { el = document.createElement('div'); el.id = 'tIntro'; document.body.appendChild(el); }
  const row = id => tnRow(id), L = S.tn ? S.tn.L : 4;
  const pips = id => { const r = row(id), lost = r ? Math.max(0, L - r[2]) : 0; return L <= 10 ? Array.from({ length: L }, (_, i) => `<span class="${i < lost ? 'loss' : ''}"></span>`).join('') : `<b>${lost}</b>`; };
  const cardsOf = r => (r.cards || []).map(id => cardById.get(id)).filter(Boolean);
  el.innerHTML = `<div class="tiL"><canvas id="tiModel" width="460" height="560"></canvas>
    <div class="tiName">${foes.map(r => `<div style="color:${r.color}">${esc(r.name)}<div class="tiPips">${pips(r.id)}</div></div>`).join('')}</div></div>
    <div class="tiMid"><div class="tiVs">VS</div><div class="tiMe" style="color:${rosterOf(S.localId).color}">${esc(t('You'))}<div class="tiPips">${pips(S.localId)}</div></div></div>
    <div class="tiR">${foes.map(r => { const cs = cardsOf(r); return `<h3 style="color:${r.color}">${esc(r.name)}${t("'s cards")} <small>${cs.length}</small></h3><div class="tiCards${cs.length > 8 ? ' many' : ''}"></div>`; }).join('')}</div>
    <div class="tiBar"><i></i><span></span><button type="button" class="btn small tiReady">${esc(t('Ready'))}</button></div>`;
  el.querySelector('.tiReady').onclick = ev => { ev.stopPropagation(); tournReady(); };
  el.querySelectorAll('.tiCards').forEach((box, k) => {
    const cs = cardsOf(foes[k]);
    if (!cs.length) { box.innerHTML = `<div class="tiNone">${esc(t('No cards yet'))}</div>`; return; }
    cs.forEach((c, i) => { const ce = cardEl(c); ce.style.animationDelay = (0.5 + i * 0.12) + 's'; box.appendChild(ce); });
  });
  el.classList.remove('hidden', 'out'); void el.offsetWidth; el.classList.add('go');
  I.ready = 0;
  TI = { el, end: performance.now() + e.ti * 1000, dur: e.ti * 1000, round: S.view.round || e.n, foes };
  // the model view: its own small renderer (freed when the screen closes), opponents side by side
  {
    try {
      const canvas = $('tiModel'), r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(460, 560, false);
      const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 460 / 560, 0.1, 60);
      cam.position.set(0, 1.5, 5.2); cam.lookAt(0, 1.0, 0);
      scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a4256, 1.1));
      const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(2, 4, 3); scene.add(sun);
      const holder = new THREE.Group(); scene.add(holder);
      TI.gl = { r, scene, cam, holder, models: [] };
      foes.slice(0, 3).forEach((f, i, a) => {
        const c = f.cosmetics || {}, m = buildPlayerModel(f.color || '#ffffff', c.gun, c.model);
        attachCosmetics(m, c);
        m.root.position.x = (i - (a.length - 1) / 2) * 1.5; if (a.length > 1) m.root.scale.setScalar(0.8);
        holder.add(m.root); TI.gl.models.push(m);
      });
    } catch (err) { console.warn('[tournament intro] model view unavailable', err); TI.gl = null; }
  }
  const t0 = performance.now(), me = TI;
  const tick = () => {
    if (TI !== me) return;
    const now = performance.now(), left = Math.max(0, me.end - now);
    const bar = me.el.querySelector('.tiBar i'); if (bar) bar.style.width = (left / me.dur * 100) + '%';
    const txt = me.el.querySelector('.tiBar span'), sec = Math.ceil(left / 1000);
    if (txt) { const s2 = I.ready === me.round ? t('Ready! Waiting for the others · {n}', { n: sec }) : t('Match starts in {n} · Enter: ready', { n: sec }); if (txt.textContent !== s2) txt.textContent = s2; }
    if (me.gl) {
      const k = Math.min(1, (now - t0) / 700), ease = 1 - Math.pow(1 - k, 3);
      me.gl.holder.position.x = -3 * (1 - ease); me.gl.holder.rotation.y = -0.6 + (now - t0) / 1000 * 0.5;
      for (const m of me.gl.models) if (m.animate) m.animate(now / 1000, 0);
      me.gl.r.render(me.gl.scene, me.gl.cam);
    }
    if (left <= 0 || !S || !S.inGame) { tournIntroEnd(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// v1.2.29: Enter or the Ready button (from any menu) readies you; again to unready
function tournReady() {
  if (!TI) return;
  I.ready = I.ready === TI.round ? 0 : TI.round; sound.play('ui');
  const b = TI.el.querySelector('.tiReady'); if (b) { b.classList.toggle('on', I.ready === TI.round); b.textContent = I.ready === TI.round ? t('Not ready') : t('Ready'); }
}
function tournIntroEnd() {
  if (!TI) return;
  const me = TI; TI = null;
  me.el.classList.add('out');
  // (model geometry is shared through geocache: only the renderer is freed)
  setTimeout(() => { if (me.gl) { me.gl.r.dispose(); try { me.gl.r.forceContextLoss(); } catch { /* gone */ } } if (TI) return; me.el.classList.add('hidden'); me.el.innerHTML = ''; }, 450);
}
// lives, arenas still fighting, what you're watching (top middle, under the shot bar)
function updateTournHud() {
  let el = $('tournHud');
  const T = S.tn, on = !!T && S.inGame && currentScreen === 'none';
  if (!el) { if (!on) return; el = document.createElement('div'); el.id = 'tournHud'; $('hud').appendChild(el); }
  el.classList.toggle('hidden', !on); if (!on) return;
  const row = tnRow(S.localId, T), A = viewArena(), mine = row ? row[1] : -1;
  const hearts = row ? (row[3] ? t('Knocked out') : '❤'.repeat(row[2]) + '<span class="lost">' + '❤'.repeat(Math.max(0, T.L - row[2])) + '</span>') : '';
  const alive = T.p.filter(r => !r[3]).length;
  const watch = A !== mine && A != null ? ` · ${t('Watching arena {n}', { n: A + 1 })} (${codeLabel(BINDS.use[0])}: ${t('next')})` : '';
  const html = `<b>${hearts}</b> · ${t('Arenas fighting {n}/{a}', { n: T.n, a: T.a })} · ${t('{n} left', { n: alive })}${watch}`;
  if (el.innerHTML !== html) el.innerHTML = html;
}
// pick screen: offer a card to an ally who is also picking; answer an ally's offer by clicking the card you give back
function giftAllies() {
  if (!S.tn || !S.tn.T || !S.pickers) return [];
  const me = rosterOf(S.localId);
  return [...S.pickers].filter(id => id !== S.localId && (S.roster.get(id) || {}).team === me.team).map(id => S.roster.get(id)).filter(Boolean);
}
function sendGift(k, extra) {
  if (S.role === 'peer') S.net.send({ t: 'toHost', msg: { k, ...extra } });
  else if (S.game) S.game.cmd({ t: k, from: S.localId, ...extra });
}
function renderGiftRow() {
  // 🎁 on each card while an ally is picking too (the 'picking' event can land after the hand is dealt)
  const can = giftAllies().length > 0 && !!S.offer && !S.giftIn;
  [...$('pickCards').children].forEach((el, i) => {
    let gb = el.querySelector('.giftBtn');
    if (!can) { if (gb) gb.remove(); return; }
    if (gb || !S.offer[i]) return;
    gb = document.createElement('button'); gb.className = 'giftBtn'; gb.textContent = '🎁'; gb.title = t('Offer this card to an ally');
    const id = S.offer[i]; gb.onclick = ev => { ev.stopPropagation(); S.giftCard = id; renderGiftRow(); };
    el.appendChild(gb);
  });
  let row = $('giftRow');
  if (!row) { row = document.createElement('div'); row.id = 'giftRow'; $('pickCards').insertAdjacentElement('afterend', row); }
  const allies = giftAllies(), G = S.giftIn;
  row.innerHTML = ''; row.classList.toggle('hidden', !(G || (allies.length && S.offer)));
  $('pickCards').classList.toggle('giftAnswer', !!G);
  if (G) {
    const c = cardById.get(G.c);
    row.innerHTML = `<div class="giftIn"><span>🎁 <b>${rosterOf(G.from).name}</b> ${t('offers you')}</span></div>`;
    if (c) { const ce = cardEl(c); ce.classList.add('giftCard'); row.querySelector('.giftIn').appendChild(ce); }
    const tip = document.createElement('span'); tip.className = 'giftTip'; tip.textContent = t('Click one of your cards to trade it for this one'); row.querySelector('.giftIn').appendChild(tip);
    const no = document.createElement('button'); no.textContent = t('Decline'); no.onclick = () => { S.giftIn = null; sendGift('giftDecline', {}); renderGiftRow(); };
    row.querySelector('.giftIn').appendChild(no);
    return;
  }
  if (!allies.length || !S.offer) return;
  if (S.giftCard) {
    const c = cardById.get(S.giftCard);
    row.innerHTML = `<span>${t('Offer {card} to', { card: '<b>' + (c ? c.name : '?') + '</b>' })}</span>`;
    for (const a of allies) { const b = document.createElement('button'); b.textContent = a.name; b.style.borderColor = a.color; b.onclick = () => sendGift('giftOffer', { to: a.id, card: S.giftCard }); row.appendChild(b); }
    const x = document.createElement('button'); x.textContent = t('Cancel'); x.onclick = () => { S.giftCard = null; renderGiftRow(); }; row.appendChild(x);
  } else row.innerHTML = `<span class="hint">🎁 ${t('Allies picking: {names}. Use 🎁 on a card to offer it to one.', { names: allies.map(a => a.name).join(', ') })}</span>`;
}
// v1.2.25 shot budget bar (top middle) and the "can't shoot" notice
function updateBudHud(me) {
  const bar = $('budBar'), note = $('budNote');
  const v = currentScreen === 'none' && S.inGame ? budgetView(S.view.bud, S.localId) : null;
  bar.classList.toggle('hidden', !v);
  const blocked = !!v && performance.now() < (S.budNoteT || 0) && !!(me && me.alive);
  note.classList.toggle('hidden', !blocked);
  if (!v) return;
  const k = v.cap ? Math.min(1, v.total / v.cap) : 0, mk = v.share ? Math.min(1, v.mine / v.share) : 0;
  bar.querySelector('.budFill').style.width = (k * 100).toFixed(1) + '%';
  bar.querySelector('.budMine').style.width = (v.share ? mk * 100 : 0).toFixed(1) + '%';
  bar.classList.toggle('hot', k >= 0.75); bar.classList.toggle('full', !!v.share && v.mine >= v.share); bar.classList.toggle('low', k < 0.4 && !v.share);
  const t = !v.cap ? `Shots ${v.total} · no cap` : v.share ? `Shots ${v.total}/${v.cap} · yours ${v.mine}/${v.share}` : `Shots ${v.total}/${v.cap}`;
  const el = bar.querySelector('.budTxt'); if (el.textContent !== t) el.textContent = t;
}
function updateHud() {
  updateBrawlHud();
  updateCoreHud();
  const v = S.view, me = v.players.find(p => p.id === S.localId);
  updateBudHud(me);
  updateTournHud();
  updateWallWarn();
  squidTip(!!(me && me.alive && ((me.status || 0) & 32)));
  // v1.0.1 safety net: a hand waiting for you is never left hidden behind the game view (that locked the pick phase)
  if (S.offer && v.phase === 'picking' && currentScreen === 'none' && !S.comboAsk && !S.breakAsk) show('pick');
  { // v28 open world: crouching shows that you're sneaking (enemies spot you from about a third as far, never through cover)
    let sn = $('sneakHud'); const on = !!(S.matchSettings.mode === 'open' && me && me.alive && ((me.flags || 0) & 32));
    if (on && !sn) { sn = document.createElement('div'); sn.id = 'sneakHud'; sn.style.cssText = 'position:absolute;left:50%;bottom:120px;transform:translateX(-50%);font:600 14px system-ui;color:#cfe;background:#0008;padding:4px 10px;border-radius:8px;pointer-events:none'; sn.textContent = '🥷 Sneaking: harder to spot'; $('hud').appendChild(sn); }
    if (sn) sn.classList.toggle('hidden', !on);
  }
  { // v1.2.8 Gun Nest: the use key mans / leaves a turret
    let mh = $('mountHud'); const txt = mountHint(v, me);
    if (txt && !mh) { mh = document.createElement('div'); mh.id = 'mountHud'; mh.style.cssText = 'position:absolute;left:50%;bottom:150px;transform:translateX(-50%);font:600 14px system-ui;color:#ffe9b0;background:#0008;padding:4px 10px;border-radius:8px;pointer-events:none'; $('hud').appendChild(mh); }
    if (mh) { mh.classList.toggle('hidden', !txt); if (txt && mh.textContent !== txt) mh.textContent = txt; }
  }
  const sc = v.scores || {};
  // (v1.2.35: big lobbies check for scoreboard changes 4 times a second, not every frame: the check alone walked every player)
  const big = S.roster.size > 60, nowS = performance.now();
  if (!big || !(nowS - (scoreKeyT || 0) < 250)) {
    scoreKeyT = nowS;
    const key = JSON.stringify(sc) + S.matchSettings.roundsToWin + [...S.roster.values()].map(r => r.cards.length).join(',') + (S.tn ? (S.tn.p.length > 60 ? tnSig(S.tn) : JSON.stringify(S.tn.p)) : '');
    if (key !== scoreKeyCache) { scoreKeyCache = key; renderScoreboard(sc); }
  }
  if (me) {
    $('myHp').style.width = Math.max(0, me.hp / (me.maxHp || 1) * 100) + '%';
    $('myHp').style.background = me.color;
    $('myHpText').textContent = me.pct != null ? `${me.pct}%  ${'●'.repeat(me.stocks || 0)}` : `${Math.max(0, Math.ceil(me.hp))} / ${me.maxHp}`;
    if (me.pct != null) $('myHp').style.width = Math.max(0, 100 - Math.min(100, me.pct / 2)) + '%';
    $('myHpGhost').style.width = $('myHp').style.width;   // v1.2.0: trails behind (CSS delay), showing the chunk you just lost
    const hpBar = $('myHp').parentElement;
    hpBar.classList.toggle('regen', !!(me.alive && ((me.flags || 0) & 16)));
    const dot = me.alive ? (me.status || 0) & 3 : 0;   // burning / poisoned: tinted bar frame and a soft screen-edge glow
    hpBar.classList.toggle('burning', !!(dot & 1)); hpBar.classList.toggle('poisoned', !!(dot & 2) && !(dot & 1));
    $('dotVignette').className = dot & 1 ? 'burn' : dot & 2 ? 'poison' : '';
    if (hudHealN !== null && me.healN !== hudHealN) { hpBar.classList.remove('healed'); void hpBar.offsetWidth; hpBar.classList.add('healed'); }
    hudHealN = me.healN ?? 0;
    // Critter weapon mod: your own critter count (each player only sees theirs)
    const crit = me.alive && (me.critters ?? -1) >= 0;
    $('critRow').classList.toggle('hidden', !crit);
    if (crit) { $('critText').textContent = `${me.critters}`; $('critRow').classList.toggle('full', me.critters >= CRITTER_MAX); }
    const ak = me.reloadFrac > 0 ? 'r' : `${me.ammo}/${me.maxAmmo}`;
    if (ak !== ammoKey) {
      ammoKey = ak;
      $('ammo').innerHTML = me.reloadFrac > 0 ? 'Reloading…' : Array.from({ length: me.maxAmmo }, (_, k) => `<span class="${k < me.ammo ? '' : 'empty'}" style="${k < me.ammo ? `background:${me.color}` : ''}"></span>`).join('');
    }
    $('blk').style.width = (1 - (me.blockFrac || 0)) * 100 + '%';
    // Block ready again: a brief white glow around the screen edge (only you see it)
    if (settings.shieldHaze && me.alive && hudBlockFrac > 0 && !(me.blockFrac > 0)) { const hz = $('blockHaze'); hz.classList.remove('on'); void hz.offsetWidth; hz.classList.add('on'); }
    hudBlockFrac = me.alive ? (me.blockFrac || 0) : 0;
    // Riot Shield hits left / Pillar Shield health
    // Super Saiyan Hair pool, Katana charge, Pentagram ritual
    const hairOn = me.alive && (me.hairFrac ?? -1) >= 0;
    $('hairRow').classList.toggle('hidden', !hairOn);
    if (hairOn) { $('hairBar').style.width = me.hairFrac * 100 + '%'; $('hairText').textContent = `${me.hairHp}`; $('hairRow').classList.toggle('full', me.hairFrac >= 0.999); }
    const kOn = me.alive && (me.kCharge ?? -1) > 0;
    $('kRow').classList.toggle('hidden', !kOn);
    if (kOn) { $('kBar').style.width = me.kCharge * 100 + '%'; $('kRow').classList.toggle('full', me.kCharge >= 0.999); }
    const rit = (v.rituals || []).find(r => r[1] === S.localId);
    $('ritRow').classList.toggle('hidden', !(me.alive && rit));
    if (rit && me.alive) {
      const [, , , , , , draw, dep, lvl, prog] = rit;
      $('ritBar').style.width = (dep ? (lvl >= 3 ? 1 : prog) : draw) * 100 + '%';
      $('ritText').textContent = dep ? (lvl >= 3 ? 'Done' : `Lv ${lvl}/3`) : rit[12] ? 'Growing' : 'Drawing';
    }
    const rf = me.riotFrac ?? -1, pf = me.pillarFrac ?? -1, showSh = me.alive && (rf >= 0 || pf >= 0);
    $('shRow').classList.toggle('hidden', !showSh);
    if (showSh) {
      const f = rf >= 0 ? rf : pf, broken = rf === 0;
      $('shBar').style.width = (broken ? 100 : f * 100) + '%';
      $('shBar').style.background = broken ? '#ff4040' : rf >= 0 ? (f > 0.5 ? '#4fa8ff' : '#ffb347') : '#ffd27a';
      $('shLabel').textContent = rf >= 0 ? (broken ? 'Recharging' : 'Shield') : 'Pillar';
    }
  }
  renderBets();
  // co-op boss health bar (top center)
  const B = v.boss;
  $('bossBar').classList.toggle('hidden', !B);
  if (B) {
    $('bossFill').style.width = Math.max(0, B[1] / (B[2] || 1) * 100) + '%';
    $('bossName').textContent = (rosterOf(B[0]).name || 'Boss') + (B[4] ? ' — ' + t('Enraged') : '');
    $('bossPhase').textContent = '◆'.repeat(B[3]) + '◇'.repeat(Math.max(0, 3 - B[3]));
    $('bossBar').classList.toggle('enraged', !!B[4]);
  }
  const fp = settings.view === 'first', alive = me && me.alive, none = currentScreen === 'none';
  $('spectate').classList.toggle('hidden', !(me && !me.alive && (v.phase === 'play' || v.phase === 'roundEnd')));
  const pausedBy = S.role === 'peer' ? (v.pausedBy || []) : (S.paused ? [...(S.pausers || [])].map(id => rosterOf(id).name) : []);
  const waiting = (v.phase === 'picking' && !S.offer && none) || (pausedBy.length > 0 && none);
  $('waiting').classList.toggle('hidden', !waiting);
  if (waiting) $('waiting').textContent = pausedBy.length ? `Paused by ${pausedBy.join(', ')}` : t('Waiting for {n} player(s) to pick a card…', { n: v.waiting });
  const lateWait = me && !me.alive && S.lateJoined && v.phase !== 'picking';
  $('spectate').textContent = lateWait ? 'You joined mid-match. You\'ll spawn when the next round starts.' : S.matchSettings.mode === 'open' ? t("You're out. Free camera: move keys fly, Space / C up and down, Shift faster. Tab follows a player.") : t("You're out. Move keys or drag to look around, scroll to zoom, Jump to follow the fight.");
  if (lateWait) $('spectate').classList.remove('hidden');
  $('crosshair').classList.toggle('hidden', !(fp && alive && none));
  $('lockHint').classList.toggle('hidden', !(fp && alive && none && !locked()));
  $('lockHint').textContent = altFree ? 'Cursor free: hover the scoreboard to see cards. Click to aim again.' : 'Click to aim';
  if (currentScreen === 'pick') {
    const limit = S.pickInfo && S.pickInfo.time ? S.pickInfo.time : 0;
    const left = Math.max(0, Math.ceil(limit - (performance.now() - S.pickStart) / 1000));
    $('pickTimer').textContent = limit > 0 ? ` · ${left}s` : '';
    $('pickBar').classList.toggle('hidden', !(limit > 0));
    const frac = limit > 0 ? Math.max(0, 1 - (performance.now() - S.pickStart) / 1000 / limit) : 1;   // v1.2.0 timer bar
    $('pickBar').style.setProperty('--f', frac.toFixed(4)); $('pickBar').classList.toggle('low', limit > 0 && left <= 5);
    renderPeek();
  }
  renderStatsWin(v);
  updateHover(v);
  updateCursorAmmo(me);
  if (S.matchSettings.mode === 'practice') updatePracticeHud();
  updateOwHud(v, me);
}
// v1.2.6: HUD parts that are rebuilt every frame only touch the page when their text actually changed.
function setHtml(el, html) { if (el._h !== html) { el._h = html; el.innerHTML = html; } }
// Open world compass: a strip of headings around where you look, with a green marker toward the extraction.
const compassDir = new THREE.Vector3();
function updateOwCompass(ow, me) {
  const el = $('owCompass'), cam = renderer.camera;
  if (!me || !me.alive || !ow.ext) { el.classList.add('hidden'); return; }
  const f = compassDir; cam.getWorldDirection(f);
  const yaw = Math.atan2(f.x, f.z), W = 300, span = Math.PI / 2;   // +-90 degrees across the strip
  const xOf = h => { const r = Math.atan2(Math.sin(h - yaw), Math.cos(h - yaw)); return Math.abs(r) > span ? null : Math.round(W / 2 - r / span * (W / 2)); };   // (whole pixels: the text repeats while you stand still)
  const marks = [['N', Math.PI], ['NE', -Math.PI * 3 / 4], ['E', -Math.PI / 2], ['SE', -Math.PI / 4], ['S', 0], ['SW', Math.PI / 4], ['W', Math.PI / 2], ['NW', Math.PI * 3 / 4]];
  let html = '';
  for (const [n, h] of marks) { const x = xOf(h); if (x != null) html += `<span style="position:absolute;left:${x - 10}px;width:20px;text-align:center;top:3px;${n.length > 1 ? 'opacity:0.5' : ''}">${n}</span>`; }
  const ex = xOf(Math.atan2(ow.ext[0] - me.pos.x, ow.ext[1] - me.pos.z));
  if (ex != null) html += `<span style="position:absolute;left:${ex - 6}px;top:-1px;color:#6aff9a;font-size:14px">▼</span>`;
  else { const r = Math.atan2(ow.ext[0] - me.pos.x, ow.ext[1] - me.pos.z) - yaw, left = Math.atan2(Math.sin(r), Math.cos(r)) > 0; html += `<span style="position:absolute;${left ? 'left:2px' : 'right:2px'};top:2px;color:#6aff9a">${left ? '◀' : '▶'}</span>`; }
  setHtml(el, html); el.classList.remove('hidden');
}
// v1.2.8 Gun Nest prompt: near a free turret, or manning one (with its ammo).
function mountHint(v, me) {
  if (!me || !me.alive || currentScreen !== 'none') return '';
  const key = codeLabel(BINDS.use[0]);
  if (me.mount) { const u = v.players.find(p => p.id === me.mount); return t('{k}: get off the turret', { k: key }) + (u ? ` · ${u.reloadFrac > 0 ? t('reloading') : `${u.ammo}/${u.maxAmmo}`}` : ''); }
  const R = RULES.playerRadius, near = v.players.find(p => p.kind === 'mount' && p.alive && !v.players.some(q => q.mount === p.id && q.alive) && Math.abs(p.pos.y - me.pos.y) < 1.6 &&
    Math.hypot(p.pos.x - me.pos.x, p.pos.z - me.pos.z) - R * ((p.size || 1) + (me.size || 1)) < MOUNT.reach);
  return near ? t('{k}: man the turret', { k: key }) : '';
}
// Open world hints: bus / parachute controls, the red wall timer, the extraction point.
function updateOwHud(v, me) {
  const el = $('owHud'), ow = v.ow;
  if (!ow || currentScreen !== 'none') { el.classList.add('hidden'); $('owCompass').classList.add('hidden'); return; }
  updateOwCompass(ow, me);
  const st = me ? owStateOf(v, me.id) : 0, lines = [];
  if (st === 1) lines.push(v.phase === 'play' ? 'Space: jump out of the bus' : 'Get ready to drop…');
  else if (st === 2) lines.push('Space: open your parachute');
  else if (st === 3) lines.push('Steer your parachute with the move keys');
  if (ow.wall) {
    const [, , r, , t] = ow.wall, d = me ? Math.hypot(me.pos.x - ow.wall[0], me.pos.z - ow.wall[1]) : 0;
    lines.push(`<span style="color:#ff6a6a">${t > 0 ? `Red wall closes in ${Math.ceil(t)}s` : 'The red wall is closing'}${me && me.alive && d > r ? ' · you are outside it!' : ''}</span>`);
  }
  if (ow.ext && me && me.alive) {
    const dx = ow.ext[0] - me.pos.x, dz = ow.ext[1] - me.pos.z, d = Math.hypot(dx, dz);
    lines.push(`<span style="color:#6aff9a">Extraction ${Math.round(d)} m${ow.ext[3] > 0 ? ` · hold ${Math.ceil(ow.ext[3])}s` : ''}</span>`);
  }
  if (ow.ex && me && me.alive && st === 0) {
    const down = v.players.find(p => !p.alive && p.id !== me.id && (!p.kind || p.kind === 'hero') && !p.raider && Math.hypot(p.pos.x - me.pos.x, p.pos.z - me.pos.z) < 1.7);
    if (down) lines.push(`<span style="color:#6aff9a">Hold ${esc(codeLabel(BINDS.use[0]))}: revive ${esc(rosterOf(down.id).name)}</span>`);
  }
  if (ow.veh && me && me.alive && st === 0) {
    const mine = ow.veh.find(r => r[6] === me.id);
    if (mine) lines.push(VEH_KINDS[mine[1]] === 'car' ? `E: get out · <span style="color:${(mine[7] ?? 1) < 0.3 ? '#ff6a4a' : '#ffd27a'}">Car ${Math.round((mine[7] ?? 1) * 100)}%</span> (no shooting while driving)` : 'E: get off');
    else { const n = ow.veh.find(r => !r[6] && Math.hypot(r[2] - me.pos.x, r[4] - me.pos.z) < 2.6); if (n) lines.push(`E: ride the ${VEH_KINDS[n[1]]}`); }
  }
  setHtml(el, lines.join('<br>'));
  el.classList.toggle('hidden', !lines.length);
}

// ---------------------------------------------------------------- settings UI
// v1.2.16 GUI scale (Settings > Graphics): the desktop app zooms the page (the 3D view keeps its resolution: the
// renderer follows the device pixel ratio); a browser scales the page with CSS zoom
// v1.2.28: the GUI also fits the screen on its own: menus and HUD are laid out for 1920x1080 and grow or shrink with
// the window (the smaller of width/1920 and height/1080, so a 32:9 screen scales by its height like a 16:9 one of the
// same height). The slider is now a multiplier on top. It is applied at start (before, a saved GUI scale only took
// effect once any slider moved: the menus jumped in size while setting the music volume) and only when it changes.
function uiFit() {
  const z = window.steamBridge && window.steamBridge.setZoom ? (applyUiScale.z || 1) : 1;   // desktop zoom shrinks innerWidth
  const w = innerWidth * z, h = innerHeight * z;
  return Math.max(0.6, Math.min(2.5, Math.min(w / 1920, h / 1080)));
}
function applyUiScale() {
  const user = Math.max(0.7, Math.min(1.5, +settings.uiScale || 1));
  const k = Math.round(Math.max(0.5, Math.min(3, user * uiFit())) * 100) / 100;
  if (applyUiScale.k === k) return;
  applyUiScale.k = k;
  if (window.steamBridge && window.steamBridge.setZoom) { applyUiScale.z = k; window.steamBridge.setZoom(k); }
  else document.documentElement.style.setProperty('--uiz', String(k));   // (style.css: everything but the 3D canvas)
  setTimeout(() => renderer.resize(), 0);
}
addEventListener('resize', () => { clearTimeout(applyUiScale.t); applyUiScale.t = setTimeout(() => { if (renderer) applyUiScale(); }, 150); });
const AUDIO_KEYS = new Set(['master', 'music', 'sfx']);
function applySettings(key) {
  saveSettings(settings);
  if (!key || key === 'uiScale') applyUiScale();
  if (AUDIO_KEYS.has(key)) { sound.setVolumes(settings); return; }   // volume sliders touch nothing but the sound
  setSlop(settings.slop);
  renderer.applySettings(S && S.inGame && (S.matchSettings.commander || S.amon || S.rts) ? { ...settings, view: 'third' } : settings);
  if (S && S.amon && document.pointerLockElement) document.exitPointerLock();
  sound.setVolumes(settings);
}
let cbApplied = null;
function applyAccess() {
  if (cbApplied === settings.colorBlind) return;
  cbApplied = settings.colorBlind;
  applyColorBlind(settings.colorBlind);
  document.querySelectorAll('#legend [data-tier]').forEach(i => { i.style.background = ART.tierColors[+i.dataset.tier]; });
  renderer.refreshLevel();
  if (S && S.rts) S.rts.hideLevel();
  if (S && S.amon) S.amon.hideLevel();   // AMON has its own battlefield: rebuilding the arena must not show the old one
}
function applyLanguage(code) {
  settings.language = code; saveSettings(settings);
  setLanguage(code);
  $('langCorner').value = code; $('sLang').value = code;
  if (S && !S.inGame) renderLobby();
}
function bindSettings() {
  const pct = v => Math.round(v * 100) + '%';
  const binds = [
    ['sName', 'name', 'value', v => cleanName(v)],
    ['sEffects', 'effects', 'value'],
    ['sFov', 'fov', 'value', Number, v => v + '°'], ['sSens', 'sensitivity', 'value', Number, v => v.toFixed(2) + '×'],
    ['sMaster', 'master', 'value', Number, pct], ['sShakeMax', 'shakeMax', 'value', Number, pct], ['sMusic', 'music', 'value', Number, pct], ['sSfx', 'sfx', 'value', Number, pct],
    ['sShadows', 'shadows', 'checked'], ['sShake', 'screenShake', 'checked'], ['sFeel', 'feel', 'checked'], ['sKillCam', 'killCam', 'checked'], ['sRtsLock', 'rtsLock', 'checked'], ['sProps', 'props', 'checked'], ['sSlop', 'slop', 'checked'], ['sPillow', 'pillow', 'checked'],
    ['sCB', 'colorBlind', 'value'], ['sRecommend', 'recommend', 'checked'],
    ['sCurAmmo', 'cursorAmmo', 'checked'], ['sHaze', 'shieldHaze', 'checked'],
    ['sLighting', 'lighting', 'value'], ['sShadowQ', 'shadowQ', 'value'], ['sAO', 'ao', 'checked'], ['sBloom', 'bloom', 'value'],
    ['sRefl', 'reflections', 'value'], ['sAA', 'aa', 'value'], ['sScale', 'renderScale', 'value', Number, pct], ['sUiScale', 'uiScale', 'value', Number, pct],
    ['sVsync', 'vsync', 'checked'], ['sFpsCap', 'fpsCap', 'value', Number], ['sThreads', 'cpuThreads', 'value', Number], ['sShowFps', 'showFps', 'checked'], ['sShowPing', 'showPing', 'checked'], ['sNetPredict', 'netPredict', 'checked'], ['sHiModels', 'hiModels', 'checked'],
    ['sRT', 'raytracing', 'value'], ['sUpscale', 'upscaler', 'value'],
  ];
  const GFX = new Set(['shadows', 'lighting', 'shadowQ', 'ao', 'bloom', 'reflections', 'aa', 'renderScale', 'raytracing', 'upscaler', 'hiModels']);
  for (const [id, key, prop, conv, fmt] of binds) {
    const el = $(id);
    el[prop] = settings[key];
    if (fmt) $(id + 'V').textContent = fmt(settings[key]);
    el.addEventListener('input', () => {
      settings[key] = conv ? conv(el[prop]) : el[prop];
      if (fmt) $(id + 'V').textContent = fmt(settings[key]);
      if (key === 'name' && S && !S.inGame) {
        if (isHostSide()) { const p = S.lobby.players.find(q => q.id === S.localId); if (p) { p.name = settings.name; lobbyChanged(); } }
        else S.net.send({ t: 'toHost', msg: { k: 'setName', name: settings.name } });
      }
      if (key === 'view' && document.pointerLockElement) document.exitPointerLock();
      if (GFX.has(key)) { settings.gfxPreset = 'custom'; $('sPreset').value = 'custom'; }
      if (key === 'vsync') { sendGfxToApp(); if (window.steamBridge) toast('V-sync changes after restarting the game'); }
      applySettings(key);
      if (key === 'colorBlind') applyAccess();
    });
  }
  // v1.0.1: view = top-down, first person, or over the shoulder (first-person controls with the camera behind you,
  // like the open world's third person: turn with the mouse and look around the whole battlefield)
  $('sView').value = viewChoice();
  $('sView').addEventListener('input', () => { setViewChoice($('sView').value); if (document.pointerLockElement && settings.view !== 'first') document.exitPointerLock(); });
  // v26: preferred color also lives in Settings > General (same value as the Customize swatches).
  const drawPref = () => { $('sColor').innerHTML = ART.ffaColors.map(c => `<button type="button" data-pref="${c}" style="background:${c}" class="${settings.color === c ? 'cur' : ''}" title="Prefer this color"></button>`).join(''); };
  drawPref();
  $('sColor').addEventListener('click', e => { const c = e.target.dataset && e.target.dataset.pref; if (!c) return; sound.play('ui'); settings.color = c; saveSettings(settings); drawPref(); });
  $('settingsTabs').addEventListener('click', drawPref);
  $('sPreset').value = settings.gfxPreset || 'custom';
  $('sPreset').addEventListener('input', () => {
    const p = GFX_PRESETS[$('sPreset').value];
    settings.gfxPreset = $('sPreset').value;
    if (p) {
      Object.assign(settings, p);
      for (const [id, key, prop, , fmt] of binds) if (GFX.has(key)) { $(id)[prop] = settings[key]; if (fmt) $(id + 'V').textContent = fmt(settings[key]); }
    }
    applySettings();
  });
  $('recheckGfxBtn').onclick = () => { if (S && S.inGame) return; quietGfxCheck(true); };
  $('settingsBack').onclick = () => { setGfxLive(false); document.querySelectorAll('#settingsTabs .tab').forEach(x => x.classList.toggle('sel', x.dataset.tab === 'general')); $('setGeneral').classList.remove('hidden'); $('setGraphics').classList.add('hidden'); $('setControls').classList.add('hidden'); show(settingsReturn); };
  $('settingsTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    cancelBindCapture();
    document.querySelectorAll('#settingsTabs .tab').forEach(x => x.classList.toggle('sel', x === b));
    $('setGeneral').classList.toggle('hidden', b.dataset.tab !== 'general');
    $('setGraphics').classList.toggle('hidden', b.dataset.tab !== 'graphics');
    $('setControls').classList.toggle('hidden', b.dataset.tab !== 'controls');
    setGfxLive(b.dataset.tab === 'graphics');
    if (b.dataset.tab === 'controls') renderBinds();
  });
  $('bindList').addEventListener('click', e => {
    const b = e.target.closest('[data-bind]'); if (!b || performance.now() - bindSetAt < 400) return;
    e.stopPropagation();
    startBindCapture(b.dataset.bind, +b.dataset.slot);
  });
  $('bindReset').onclick = () => { cancelBindCapture(); settings.binds = null; BINDS = bindsOf(settings); saveSettings(settings); renderBinds(); renderKeysHelp(); toast('Controls reset'); };
  // v1.2.11: settings file. The desktop app also keeps Documents/Blockshot3D/settings.json up to date on its own.
  $('sFileSave').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([settingsFileText(settings)], { type: 'application/json' }));
    a.download = 'blockshot3d-settings.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('sFileLoad').onclick = () => $('sFileIn').click();
  $('sFileIn').onchange = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const got = parseSettingsFile(await f.text());
      Object.assign(settings, got); saveSettings(settings);
      toast('Settings loaded'); setTimeout(() => location.reload(), 600);
    } catch (err) { toast('That file is not a Blockshot 3D settings file'); }
  };
  if (window.steamBridge && window.steamBridge.showSettings) {
    $('sFileShow').classList.remove('hidden');
    $('sFileHint').textContent = '(saved automatically to Documents/Blockshot3D/settings.json; load one to copy your settings and key bindings from another PC)';
    $('sFileShow').onclick = () => window.steamBridge.showSettings();
  }
  renderKeysHelp();
  $('sLang').innerHTML = languageOptions(settings.language); $('langCorner').innerHTML = languageOptions(settings.language);
  $('sLang').onchange = e => applyLanguage(e.target.value);
  $('langCorner').onchange = e => applyLanguage(e.target.value);
  $('cosLoot').onclick = () => { sound.play('ui'); openLootbox(); };
  $('cosSpin').onclick = () => { settings.previewSpin = !settings.previewSpin; saveSettings(settings); $('cosSpin').textContent = settings.previewSpin ? 'Spin: on' : 'Spin: off'; };
  $('cosFields').addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.cos; if (!k) return;
    const v = e.target.value;
    if (!owns(settings, k, v)) { tryOn = { ...(tryOn || {}), [k]: v }; renderCosFields(); rebuildPreview(); return; }   // locked: add it to the try-on set
    if (tryOn) delete tryOn[k];
    settings.cosmetics = { ...myCos(), [k]: v }; saveSettings(settings); renderCosFields(); rebuildPreview(); cosChanged();
  });
  // Randomize only picks from what you own.
  $('cosRandom').onclick = () => {
    const o = {};
    for (const k of COS_SLOTS) { const have = Object.keys(COSMETICS[k]).filter(v => owns(settings, k, v)); o[k] = Math.random() < 0.6 ? have[Math.floor(Math.random() * have.length)] : have[0]; }
    settings.cosmetics = o; saveSettings(settings); tryOn = null; renderCosFields(); rebuildPreview(); cosChanged();
  };
}

// ---------------------------------------------------------------- controls (Settings → Controls)
let bindCapture = null, bindSetAt = 0;   // { action, slot } while waiting for a key
function renderBinds() {
  $('bindList').innerHTML = Object.keys(DEFAULT_BINDS).map(a => `<div class="bindrow"><span>${esc(t(BIND_LABELS[a]))}</span>` +
    [0, 1].map(i => `<button type="button" class="bindkey${bindCapture && bindCapture.action === a && bindCapture.slot === i ? ' listening' : ''}" data-bind="${a}" data-slot="${i}">${bindCapture && bindCapture.action === a && bindCapture.slot === i ? esc(t('Press a key…')) : esc(codeLabel(BINDS[a][i]))}</button>`).join('') + '</div>').join('') +
    `<div class="bindrow fixed"><span>${esc(t('Pause / settings / back'))}</span><b class="bindkey">Esc</b><span></span></div>` +
    `<div class="bindrow fixed"><span>${esc(t('Pick a card'))}</span><b class="bindkey">1 – 5</b><span></span></div>` +
    `<div class="bindrow fixed"><span>${esc(t('Card details'))}</span><b class="bindkey">${esc(t('Right-click a card'))}</b><span></span></div>`;
}
function startBindCapture(action, slot) {
  cancelBindCapture();
  bindCapture = { action, slot };
  renderBinds();
  const finish = code => {
    const cap = bindCapture; cancelBindCapture();
    if (!cap) return;
    if (code !== null) {
      // a key can only do one thing: take it off any other action first
      for (const [a, list] of Object.entries(BINDS)) list.forEach((c, i) => { if (c === code && !(a === cap.action && i === cap.slot)) list[i] = ''; });
      BINDS[cap.action][cap.slot] = code;
      settings.binds = JSON.parse(JSON.stringify(BINDS)); saveSettings(settings);
    }
    renderBinds(); renderKeysHelp();
  };
  const onKey = e => {
    e.preventDefault(); e.stopPropagation();
    if (e.code === 'Escape') return finish(null);
    if (e.code === 'Backspace' || e.code === 'Delete') { const cap = bindCapture; BINDS[cap.action][cap.slot] = ''; settings.binds = JSON.parse(JSON.stringify(BINDS)); saveSettings(settings); return finish(null); }
    if (/^Digit[1-5]$/.test(e.code)) { toast('1 to 5 are used to pick cards'); return; }
    finish(e.code);
  };
  const onMouse = e => {
    if (!e.target.closest || !e.target.closest('[data-bind]')) return finish(null);   // clicked elsewhere: cancel
    e.preventDefault(); e.stopPropagation();
    bindSetAt = performance.now();
    finish('Mouse' + e.button);
  };
  const noMenu = e => e.preventDefault();
  bindCapture.off = () => { removeEventListener('keydown', onKey, true); removeEventListener('mousedown', onMouse, true); setTimeout(() => removeEventListener('contextmenu', noMenu, true), 400); };
  addEventListener('keydown', onKey, true);
  setTimeout(() => { if (bindCapture) { addEventListener('mousedown', onMouse, true); addEventListener('contextmenu', noMenu, true); } }, 0);
}
function cancelBindCapture() { if (bindCapture && bindCapture.off) bindCapture.off(); bindCapture = null; }
// Title screen controls list, built from the current bindings.
function renderKeysHelp() {
  const k = a => BINDS[a].filter(Boolean).map(c => `<b>${esc(codeLabel(c))}</b>`).join(' / ') || '<b>—</b>';
  const move = ['up', 'left', 'down', 'right'].map(a => BINDS[a][0] ? `<b>${esc(codeLabel(BINDS[a][0]))}</b>` : '').join('');
  const rows = [[move, 'Move'], [k('jump'), 'Jump'], ['<b>Mouse</b>', 'Aim'], [k('shoot'), 'Shoot (hold)'], [k('block'), 'Block — stops bullets'],
    [k('reload'), 'Reload'], [k('view'), 'Switch first / third person'], [k('cursor'), 'First person: free the cursor to check the scoreboard'],
    ['<b>Esc</b>', 'Pause / settings / back'], ['<b>Right click</b>', 'On a card: show its details']];
  $('keysHelp').innerHTML = rows.map(([a, b]) => `<div>${a}</div><span>${esc(t(b))}</span>`).join('');
}

// ---------------------------------------------------------------- wiring
function bindUI() {
  $('quitBtn').addEventListener('click', () => {   // v26: desktop app closes; a browser tab tries to close (or says so)
    sound.play('ui');
    if (window.steamBridge && window.steamBridge.quit) window.steamBridge.quit();
    else { window.close(); setTimeout(() => toast('Close this browser tab to quit'), 200); }
  });
  for (const id of ['betBox', 'pauseBet', 'pickBet']) $(id).addEventListener('click', e => { const b = e.target.closest('[data-bet]'); if (b && !b.disabled) placeBet(b.dataset.bet); });
  document.addEventListener('click', e => {
    const go = e.target.closest && e.target.closest('[data-go]');
    if (!go) return;
    sound.play('ui');
    const t = go.dataset.go;
    if (t === 'solo') openSolo();
    else if (t === 'practice') openPractice();
    else if (t === 'browser') {
      $('mpName').value = settings.name; $('mpError').textContent = ''; show('browser'); refreshRooms(); refreshFriends();
      clearInterval(friendsTimer); friendsTimer = setInterval(() => { if (currentScreen === 'browser') refreshFriends(); else clearInterval(friendsTimer); }, 6000);
    }
    else if (t === 'directory') { renderDirectory(); show('directory'); }
    else if (t === 'gallery') openGallery(CARDS, show);
    else if (t === 'settings') { settingsReturn = currentScreen; show('settings'); const sc = $('sColor'); if (sc) sc.querySelectorAll('[data-pref]').forEach(b => b.classList.toggle('cur', b.dataset.pref === settings.color)); }
    else if (t === 'customize') openCustomize();
    else show(t);
  });
  $('hostBtn').onclick = () => openHost('lan');
  $('steamHostBtn').onclick = () => openHost('steam');
  $('inviteBtn').onclick = () => { if (S && S.net && S.net.isSteam) S.net.invite(); };
  $('testWinBtn').onclick = () => window.steamBridge && window.steamBridge.newTestWindow();
  $('joinBtn').onclick = () => joinRoom($('joinCode').value);
  $('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom($('joinCode').value); });
  $('refreshRooms').onclick = refreshRooms;
  $('refreshFriends').onclick = refreshFriends;
  $('rarityFilter').addEventListener('click', e => { const f = e.target.dataset && e.target.dataset.f; if (f) { dirFilter = f; renderDirectory(); } });
  $('reloadCards').onclick = async () => { await refreshCards(); renderDirectory(); toast(`Loaded ${CARDS.length} cards`); };
  $('cardHelpBtn').onclick = () => $('cardHelp').classList.toggle('hidden');
  $('newCard').onclick = openCreator;
  $('cName').addEventListener('input', () => { if (!creator.idTouched) $('cId').value = slug($('cName').value); updatePreview(); });
  $('cId').addEventListener('input', () => { creator.idTouched = true; updatePreview(); });
  for (const id of ['cRarity', 'cIcon', 'cDesc']) $(id).addEventListener('input', updatePreview);
  $('cMods').addEventListener('input', e => {
    const row = e.target.closest('.modrow'); if (!row) return;
    const m = creator.mods[+row.dataset.i], k = e.target.dataset.k;
    if (k === 'value') m.value = parseFloat(e.target.value); else if (k) m[k] = e.target.value;
    updatePreview();
  });
  $('cMods').addEventListener('click', e => {
    const d = e.target.dataset && e.target.dataset.del;
    if (d == null) return;
    creator.mods.splice(+d, 1); renderMods(); updatePreview();
  });
  $('cAddMod').onclick = () => { creator.mods.push({ stat: 'ammo', op: 'add', value: 1 }); renderMods(); updatePreview(); };
  $('cImage').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) { creator.imageData = null; creator.imageExt = null; updatePreview(); return; }
    if (f.size > 5e6) { $('cError').textContent = 'Pictures must be under 5 MB.'; return; }
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[f.type];
    if (!ext) { $('cError').textContent = 'Use a png, jpg or webp picture.'; return; }
    const rd = new FileReader();
    rd.onload = () => { creator.imageData = rd.result; creator.imageExt = ext; updatePreview(); };
    rd.readAsDataURL(f);
  });
  $('cSave').onclick = saveCreatedCard;
  $('cDownload').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(buildCard(), null, 2)], { type: 'application/json' }));
    a.download = 'card.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  $('rerollBtn').onclick = doReroll;
  $('comboYes').onclick = () => answerCombo(true);
  $('comboNo').onclick = () => answerCombo(false);
  $('breakNone').onclick = () => answerBreak(null);
  $('resumeBtn').onclick = () => togglePause();
  $('pauseSettings').onclick = () => { settingsReturn = 'pause'; show('settings'); };
  $('leaveMatchBtn').onclick = () => leaveMatch();
  $('rematchBtn').onclick = () => { if (isHostSide()) startMatch(); };
  $('extendBtn').onclick = () => { if (isHostSide() && S.game) S.game.cmd({ t: 'extend', n: +$('extendN').value }); };
  $('retryBtn').onclick = () => { if (isHostSide() && S.game) S.game.cmd({ t: 'retry' }); };
  $('toLobbyBtn').onclick = () => { if (S && S.role === 'host') S.net.send({ t: 'toAll', msg: { k: 'toLobby' } }); endToLobby(); };
  $('overLeave').onclick = () => leaveSession();
  document.querySelectorAll('#legend [data-tier]').forEach(i => { i.style.background = ART.tierColors[+i.dataset.tier]; });
  bindLobby(); bindCosColor(); bindSettings(); bindInput(); bindPractice(); bindCardDetail(); bindPeek();
}

// ---------------------------------------------------------------- loop
// v28: FPS counter (Settings > Graphics > Show FPS counter), averaged over half a second.
let fpsN = 0, fpsMs = 0, fpsEl = null;
function fpsTick(ms) {
  fpsEl = fpsEl || $('fpsMeter');
  const on = !!settings.showFps;
  if (fpsEl.classList.contains('hidden') === on) { fpsEl.classList.toggle('hidden', !on); fpsN = fpsMs = 0; }
  if (!on) return;
  fpsN++; fpsMs += ms;
  if (fpsMs >= 500) { fpsEl.textContent = Math.round(fpsN * 1000 / fpsMs) + ' FPS'; fpsN = fpsMs = 0; }
}
// v1.1.7: Settings > Graphics live view: the settings screen clears a window onto the running scene (the title
// orbit, or your match from the pause menu), so changes show as you make them, with frame stats under it.
const gfxT = new Float32Array(1200);   // last frame times (ms), a ring buffer
let gfxN = 0, gfxLiveOn = false, gfxDrawT = 0;
function setGfxLive(on) {
  gfxLiveOn = !!on;
  $('gfxLive').classList.toggle('hidden', !on); $('settings').classList.toggle('gfxon', !!on);
  if (on) { gfxN = 0; gfxDrawT = 0; requestAnimationFrame(gfxFrame); } else gfxFrame();
}
// Squeeze the whole camera view into the live-view frame (a camera view offset), so you see the full scene there
// instead of whatever happens to sit behind it; cleared as soon as the view closes.
let gfxRect = '';
function gfxFrame() {
  const cam = renderer && renderer.camera; if (!cam || !cam.setViewOffset) return;
  const box = gfxLiveOn && currentScreen === 'settings' && $('gfxLive').querySelector('.gfxframe').getBoundingClientRect();
  if (!box || box.width < 40) { if (cam.view && cam.view.enabled) cam.clearViewOffset(); gfxRect = ''; return; }
  const W = innerWidth, H = innerHeight, key = [box.left, box.top, box.width, box.height, W, H].map(Math.round).join();
  if (key === gfxRect && cam.view && cam.view.enabled) return;
  gfxRect = key;
  const s = Math.max(box.width / W, box.height / H), cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  cam.setViewOffset(W, H, W / 2 - cx / s, H / 2 - cy / s, W / s, H / s);
}
function gfxTick(ms) {
  if (gfxLiveOn && currentScreen !== 'settings') setGfxLive(false);   // left the settings some other way
  if (!gfxLiveOn) return;
  gfxFrame();
  gfxT[gfxN++ % gfxT.length] = ms;
  if ((gfxDrawT += ms) < 250) return;
  gfxDrawT = 0;
  const n = Math.min(gfxN, gfxT.length), all = [];
  let sum10 = 0;
  for (let i = 0; i < n; i++) { const v = gfxT[(gfxN - 1 - i) % gfxT.length]; if (sum10 > 10000) break; sum10 += v; all.push(v); }   // newest first, up to 10 s
  const last1 = []; let s1 = 0; for (const v of all) { if (s1 > 1000) break; s1 += v; last1.push(v); }
  const avg = s1 / Math.max(1, last1.length);
  const sorted = all.slice().sort((a, b) => b - a), worst = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 100)));
  const low = 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length);
  const avg10 = sum10 / Math.max(1, all.length), drops = all.filter(v => v > avg10 * 1.5 && v > 20).length;
  $('gfxFps').textContent = Math.round(1000 / avg); $('gfxAvg').textContent = avg.toFixed(1); $('gfxLow').textContent = Math.round(low); $('gfxDrops').textContent = drops;
  const cv = $('gfxGraph'), g = cv.getContext('2d'), W = cv.width, H = cv.height, bars = all.slice(0, 200).reverse(), top = Math.max(40, avg10 * 3);
  g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, H - H * 16.7 / top, W, 1);   // 60 fps line
  bars.forEach((v, i) => { const h = Math.min(H, H * v / top); g.fillStyle = v > avg10 * 1.5 && v > 20 ? '#ff5d6c' : '#6dd3ff'; g.fillRect(i * W / 200, H - h, Math.max(1, W / 200 - 0.5), h); });
}
// v1.2.6: in-match load guard. When frames stay slow (average over 24 ms for 3 s) the picture drops to a lower resolution
// for a while (0.15 at a time, down to 0.6; never saved), and comes back after 10 s under 18 ms. Most useful on the host,
// whose frame rate everyone's match depends on. Off with the Custom graphics preset; reset when the match ends.
// v1.2.17: it used to see-saw (Devin: ray tracing "drops to 40, creeps back up to 60", again and again): back at full
// resolution the frames were slow again, so it dropped again. Now it waits 20 s before trying a higher resolution, and
// a resolution that turned slow again within 15 s of coming back is not tried again this match (LG.cap).
const LG = { ema: 16.7, k: 1, hi: 0, lo: 0, at: 0, cap: 1, upAt: 0 };
function loadGuard(ms, now) {
  const on = !!(S && S.inGame) && settings.gfxPreset !== 'custom' && !document.hidden;
  if (!on) { if (LG.k !== 1) { LG.k = 1; if (renderer.setLoadScale) renderer.setLoadScale(1); } LG.hi = LG.lo = 0; LG.ema = 16.7; if (!(S && S.inGame)) { LG.cap = 1; LG.upAt = 0; } return; }
  ms = Math.min(Math.max(ms, 0), 100);
  const cap = +settings.fpsCap || 0, floor = cap ? 1000 / cap : 0;   // a frame cap is not slowness
  LG.ema += (ms - LG.ema) * (1 - Math.exp(-ms / 250));
  LG.hi = LG.ema > Math.max(24, floor + 6) ? LG.hi + ms : 0;
  LG.lo = LG.ema < Math.max(18, floor + 2) ? LG.lo + ms : 0;   // 18: a 60 Hz screen (16.7 ms frames) can recover too
  if (now - LG.at < 3000 || !renderer.setLoadScale) return;
  let k = LG.k;
  if (LG.hi >= 3000 && k > 0.6) {
    if (now - LG.upAt < 15000) LG.cap = Math.min(LG.cap, k - 0.01);   // just came up to this and it's slow again: stay below it
    k = Math.max(0.6, Math.round((k - 0.15) * 100) / 100);
  } else if (LG.lo >= 20000 && k < 1 && k + 0.15 <= LG.cap) { k = Math.min(1, Math.round((k + 0.15) * 100) / 100); LG.upAt = now; }
  if (k === LG.k) return;
  LG.k = k; LG.at = now; LG.hi = LG.lo = 0;
  renderer.setLoadScale(k);
}
let last = performance.now();
function loop(now) {
  // v1.0.1: one bad frame must never stop the game loop for good (it used to freeze the screen until a restart)
  try { frameBody(now); } catch (err) {
    console.error('frame', err); if ((loopErrs = (loopErrs || 0) + 1) < 5) toast('Something went wrong this frame (see the console); the game keeps running.');
    try { renderer.render(); } catch { /* v1.2.16: still draw the picture, so it never freezes on the last good frame */ }
  }
  requestAnimationFrame(loop);
}
let loopErrs = 0;
function frameBody(now) {
  lastRaf = performance.now();
  // frame rate limit (Settings > Graphics): skip animation frames that come too soon
  const cap = +settings.fpsCap || 0;
  if (cap && now - last < 1000 / cap - 1) return;
  fpsTick(now - last); gfxTick(now - last); loadGuard(now - last, now); NR.frame.tick();
  const gap = now - last, j0 = performance.now();
  renderNetHud();
  const rawDt = Math.min(0.25, Math.max(0, now - last) / 1000), dt = Math.min(0.035, rawDt); last = now;   // (v1.2.6: the host sim runs on rawDt; drawing, effects and joiners on dt)
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('show');
  tickDeathLog(dt);
  slopTick(dt);
  if (bannerT > 0 && (bannerT -= dt) <= 0) $('banner').classList.remove('show');
  if (splashT > 0 && (splashT -= dt) <= 0) hideSplash();
  const ts = S && S.inGame && !S.amon && !S.rts ? timeScale(dt) : 1;
  if (S && S.inGame && S.rts) {
    S.rts.frame(dt, S.paused, rawDt);
  } else if (S && S.inGame && S.amon) {
    S.amon.frame(dt, S.paused, rawDt);   // v1.2.6: the battle clock runs on real time, so a slow host doesn't slow the battle down
  } else {
    if (S && S.inGame) {
      if (S.role === 'peer') peerFrame(dt);
      else { const tn = performance.now(); hostFrame(simLast && tn - simLast < 300 ? Math.max(0, tn - simLast) / 1000 : rawDt, ts); simLast = tn; if (S) S.lastTs = ts; }
    }
  }
  const j1 = performance.now();
  if (S && S.inGame && (S.amon || S.rts)) {
    // AMON / RTS draw their own field (amonui.js, rtsui.js)
  } else if (S && S.inGame) {
    if (S.resetYaw) {
      const lp = S.view.players.find(p => p.id === S.localId);
      if (lp) { const a = lp.netAim || lp.aim; renderer.yaw = Math.atan2(a.x, a.z); renderer.pitch = 0; }
      S.resetYaw = false;
    }
    S.view.ncTag = ncTag;   // v1.2.15: words over heads (renderer.syncNcTags)
    if (S.role === 'peer') S.view.trapT = S.trapClk && S.peerLevel && S.peerLevel.traps ? S.trapClk.t + Math.min(0.5, (performance.now() - S.trapClk.at) / 1000) : null;
    kcRecord();
    if (S.kcWait && performance.now() >= S.kcWait.at) kcStart();
    if (S.killCam) kcFrame(dt);
    else renderer.update(tournView(S.view), S.localId, dt * Math.max(0.12, ts));
    updateHud(); updateMusic();
  } else {
    renderer.updateFx(dt);
    renderer.orbit(now / 1000);
  }
  renderer.render();
  if (S && S.inGame) { const j2 = performance.now(); HM.frame.add(gap, [Math.round(j1 - j0), Math.round(j2 - j1)], j2); if (NL.on) netLogFrame(gap, Math.round(j1 - j0), Math.round(j2 - j1), j2); }
}

// v30: browsers stop drawing frames in a hidden tab or minimized window, which used to freeze the match for every
// player when the host looked away. A worker timer (not throttled like the page) keeps the host's simulation and
// snapshots going at 30 a second whenever frames stop. (The desktop app also turns background throttling off.)
// v1.2.9: the same timer also runs the host's match between frames when frames come slower than ~45 a second (a host
// with heavy graphics, e.g. ray tracing, at 25 FPS sent only 25 uneven updates a second and read inputs that late, which
// joiners saw as a slideshow): the simulation and the 30 updates a second no longer wait for the picture.
let lastRaf = 0, simLast = 0;
function startBackgroundHost() {
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 8)'], { type: 'text/javascript' })));
    w.onmessage = () => {
      if (!S || !S.inGame || S.role !== 'host' || S.amon || S.rts || !S.game) return;
      const t = performance.now(), since = t - simLast;
      if (since < (t - lastRaf < 150 ? 22 : 30)) return;   // frames are keeping up (or, hidden: about 30 a second)
      hostFrame(since < 300 ? since / 1000 : 1 / 30, S.lastTs || 1); simLast = t;   // (steps of 35 ms at most inside)
    };
  } catch { /* no workers: the match pauses while hidden, as before */ }
}
// v1.1.9: the intro cinematic is gone. On a first run the graphics preset is still picked for this PC, quietly:
// a guess from the GPU's name, then the title screen's frame rate is checked and the preset steps down until it
// holds about 48 fps. Leaving the title screen (or starting a match) ends the check with what it has.
let gfxCheck = null;
function quietGfxCheck(fromSettings = false) {
  if (gfxCheck) return;
  const gi = gpuInfo(renderer), here = currentScreen;
  let i = Math.max(0, GFX_TIERS.indexOf(gi.guess)), warm = 0, samples = [], lastT = performance.now();
  const apply = () => { $('sPreset').value = GFX_TIERS[i]; $('sPreset').dispatchEvent(new Event('input')); };
  // v1.2.6: measure with a crowd on screen (8 stand-in fighters), not an empty arena, so a PC that only just holds
  // the title screen isn't handed a preset that drops into the 30s in a real fight
  const crowd = [], cols = ['#ff5d6c', '#6dd3ff', '#ffd23f', '#7cff6b', '#c38bff', '#ff9f43', '#4ef0c8', '#ffffff'];
  for (let k = 0; k < 8; k++) {
    try {
      const id = '__gfx' + k, e = renderer.makePlayer({ id, color: cols[k], cosmetics: null, ...(k % 3 === 2 ? { raider: true } : {}) });
      e.root.position.set(Math.cos(k * 0.785) * 5, 0, Math.sin(k * 0.785) * 5); e.root.rotation.y = -k * 0.785; crowd.push(id);
      if (e.bar) e.bar.visible = false; if (e.shadow) e.shadow.position.set(e.root.position.x, 0.02, e.root.position.z);
    } catch { /* skip */ }
  }
  const finish = () => {
    for (const id of crowd) renderer.removePlayer(id);
    gfxCheck = null; settings.gfxAuto = { tier: GFX_TIERS[i], gpu: gi.name }; saveSettings(settings);
    toast(`Graphics set to ${TIER_LABEL[GFX_TIERS[i]]} for this PC. Change it any time in Settings > Graphics.`);
  };
  const tick = now => {
    const ms = now - lastT; lastT = now;
    if ((S && S.inGame) || currentScreen !== here) return finish();
    if (warm++ < 20) return requestAnimationFrame(tick);   // (shader compiles)
    samples.push(ms);
    if (samples.length < 60) return requestAnimationFrame(tick);
    const s = samples.sort((a, b) => a - b).slice(0, 54), avg = s.reduce((a, b) => a + b, 0) / s.length;   // ignore the slowest 10%
    if (avg > 21 && i > 0) { i--; apply(); warm = 0; samples = []; return requestAnimationFrame(tick); }
    finish();
  };
  gfxCheck = true; apply(); requestAnimationFrame(tick);
  if (fromSettings) toast('Checking your graphics…');
}

// Desktop app: v-sync is a launch switch, so the app keeps a copy of it for the next start.
function sendGfxToApp() { if (window.steamBridge && window.steamBridge.setGfx) window.steamBridge.setGfx({ vsync: settings.vsync !== false }); }
async function boot() {
  if (window.BLOCKSHOT_NO_PHONE) return;   // phones aren't supported (notice shown by index.html)
  renderer = new Renderer(document.body, { aa: settings.aa });
  renderer.applySettings(settings);
  renderer.onLocalLand = sp => { sound.play('land', Math.min(1, sp / 14)); if (sp > 13) renderer.addShake(0.1); };
  sendGfxToApp();
  try { serverInfo = await (await fetch('/api/info', { cache: 'no-store' })).json(); } catch { /* offline */ }
  await loadArtAssets();
  await refreshCards();
  renderer.setLevel(prepareLevel(generateLevel(4, 'mixed', (Math.random() * 1e9) | 0)));
  bindUI();
  slopInit(); setSlop(settings.slop);
  applyUiScale();
  applyAccess();
  setLanguage(settings.language || 'en');
  show('title');
  welcomeAward();
  steamStatus = await SteamNet.status();
  if (steamStatus.desktop) {
    $('steamSection').classList.remove('hidden');
    $('testWinBtn').classList.remove('hidden');
    $('lanText').textContent = 'For testing: host here, then press Open a test window (or Ctrl+Shift+N) and join from the new window with the room code.';
    if (!steamStatus.available) {
      $('steamStatus').textContent = 'Steam isn\'t running or couldn\'t start' + (steamStatus.error ? ` (${steamStatus.error})` : '') + '. Start Steam, then restart the game.';
      $('steamHostBtn').disabled = true;
    } else {
      if (!settings.name || settings.name === 'Player') { settings.name = cleanName(steamStatus.name); saveSettings(settings); $('sName').value = settings.name; }
      window.steamBridge.onEvent(m => { if (m.t === '_invite') joinRoom(m.lobby, 'steam'); else if (m.t === 'friends') renderFriends(m); });
      if (steamStatus.launchLobby) joinRoom(steamStatus.launchLobby, 'steam');
    }
  }
  const autoJoin = new URLSearchParams(location.search).get('join');
  if (autoJoin && /^[A-Z]{4}$/i.test(autoJoin)) { history.replaceState(null, '', location.pathname); show('browser'); $('joinCode').value = autoJoin.toUpperCase(); joinRoom(autoJoin); }
  startBackgroundHost();
  requestAnimationFrame(loop);
  if (settings.firstRun && !autoJoin && !S) setTimeout(() => { if (!S) quietGfxCheck(); }, 1500);   // v1.1.9 (no intro)
}
// Development helper: inspect the running session from the browser console (blockshot.session).
window.blockshot = { get session() { return S; }, get cards() { return CARDS; }, get renderer() { return renderer; }, settings };
boot();
