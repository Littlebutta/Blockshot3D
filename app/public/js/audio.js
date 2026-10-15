// Audio. Real files listed in sounds/sounds.json are used when present;
// anything missing falls back to a built-in synthesized placeholder.
export const SFX_NAMES = ['shoot', 'hit', 'hurt', 'block', 'shield', 'bounce', 'explode', 'death', 'jump', 'reload',
  'roundStart', 'fight', 'roundWin', 'roundLose', 'cardPick', 'reroll', 'ui', 'victory', 'defeat', 'slash', 'cut', 'powerUp', 'ritual', 'coin', 'grunt', 'darkHum', 'choir', 'opera'];

// win/budget: total volume allowed within `win` seconds; voices: max copies started within `voiceWin` seconds.
const SFX_LIMITS = {
  block:   { win: 0.06, budget: 1.1, voices: 4, voiceWin: 0.25 },
  shield:  { win: 0.06, budget: 1.0, voices: 3, voiceWin: 0.25 },
  explode: { win: 0.08, budget: 1.3, voices: 4, voiceWin: 0.45 },
  uwu:     { win: 0.05, budget: 1.0, voices: 3, voiceWin: 0.2 },
  hop:     { win: 0.05, budget: 1.0, voices: 3, voiceWin: 0.2 },
  hitConfirm: { win: 0.05, budget: 1.0, voices: 2, voiceWin: 0.08 },
  cardHover:  { win: 0.04, budget: 1.0, voices: 1, voiceWin: 0.05 },
  land:       { win: 0.08, budget: 1.0, voices: 2, voiceWin: 0.15 },
};

export class Sound {
  constructor() {
    this.ctx = null; this.buffers = {}; this.map = { sfx: {}, music: {} };
    this.vol = { master: 0.8, music: 0.5, sfx: 0.8 };
    this.musicMode = null; this.musicTimer = null; this.voices = []; this.pl = {}; this.wantMusic = null;
  }

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain(); this.musicGain.connect(this.master);
    // A gentle compressor on effects as a safety net against stacking peaks.
    this.sfxComp = this.ctx.createDynamicsCompressor();
    this.sfxComp.threshold.value = -14; this.sfxComp.knee.value = 10; this.sfxComp.ratio.value = 4;
    this.sfxComp.attack.value = 0.004; this.sfxComp.release.value = 0.2;
    this.sfxComp.connect(this.master);
    this.sfxGain = this.ctx.createGain(); this.sfxGain.connect(this.sfxComp);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, len);
    const d = this.noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.setVolumes(this.vol);
    try { this.map = await (await fetch('/sounds/sounds.json', { cache: 'no-store' })).json(); } catch { /* no manifest */ }
    await Promise.all(Object.entries(this.map.sfx || {}).map(async ([name, file]) => {
      if (!file) return;
      try {
        const res = await fetch('/sounds/' + encodeURIComponent(file));
        if (!res.ok) throw new Error(res.status);
        this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      } catch (e) { console.warn(`[audio] "${file}" for ${name} could not be loaded; using placeholder.`); }
    }));
    if (this.wantMusic) { const m = this.wantMusic; this.musicMode = null; this.playMusic(m); }
  }

  setVolumes(v) {
    this.vol = { ...this.vol, ...v };
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.musicGain.gain.value = this.vol.music;
    this.sfxGain.gain.value = this.vol.sfx;
  }

  // Sounds that can fire many times in the same instant (a shotgun into a block bubble, a chain of
  // explosions) share a loudness budget over a short window and a cap on overlapping voices, so a pile-up
  // is no louder than a few of them at once.
  limit(name, vol) {
    const L = SFX_LIMITS[name];
    if (!L) return vol;
    const now = this.ctx.currentTime, st = (this.lim = this.lim || {})[name] = this.lim[name] || { hist: [] };
    st.hist = st.hist.filter(h => now - h.t < L.voiceWin);
    const recent = st.hist.filter(h => now - h.t < L.win).reduce((a, h) => a + h.v, 0);
    if (st.hist.length >= L.voices) return 0;
    const v = Math.min(vol, L.budget - recent);
    if (v < 0.05) return 0;
    st.hist.push({ t: now, v });
    return v * (1 - 0.12 * Math.min(4, st.hist.length - 1));   // each overlapping copy a bit quieter
  }

  play(name, vol = 1) {
    if (!this.ctx || vol <= 0) return;
    vol = this.limit(name, vol);
    if (vol <= 0) return;
    if (this.buffers[name]) {
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
      s.buffer = this.buffers[name]; g.gain.value = vol;
      s.connect(g); g.connect(this.sfxGain); s.start();
      return;
    }
    const f = SYNTH[name];
    if (f) f(this, this.ctx.currentTime, vol);
  }

  // --- synth building blocks ---
  tone(t, type, f0, f1, dur, vol, out = this.sfxGain) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  hiss(t, dur, vol, freq = 1200, type = 'bandpass', out = this.sfxGain, sweepTo) {
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noise; s.loop = true; f.type = type; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  // --- music ---
  // Music plays in "modes": menu, battle, boss, suspense. Each mode has a playlist (built-in synth tracks, or files
  // listed in sounds.json, a name or a list of names per mode). A song loops until something asks for a change:
  // a mode change (boss, suspense, menu) or levelChange(), which the game calls when a new level loads; the battle
  // playlist only moves on every MUSIC_LEVELS levels. Every change fades the old song out slowly, waits for
  // silence, then fades the new one in at the same rate.
  playMusic(mode, force) {
    this.wantMusic = mode;
    if (!this.ctx || (this.musicMode === mode && !force)) return;
    this.musicMode = mode;
    this.pl = this.pl || {};
    if (!force) this.levelsOnSong = 0;
    const files = [].concat((this.map.music && this.map.music[mode]) || []).filter(Boolean);
    const fade = mode === 'suspense' || mode === 'boss' ? 2.2 : 3.2;
    const busy = (this.voices || []).some(v => !v.fading);
    this.fadeOutAll(fade);
    const delay = busy ? fade + 0.25 : 0;
    if (files.length) this.startFile(mode, files, fade, delay);
    else this.startSynth(mode, fade, delay);
  }
  // Called once per new level (and safe to call again in the pick phase): counts levels on the current battle song
  // and moves to the next song after MUSIC_LEVELS of them. Boss/suspense/menu songs follow their own rules.
  levelChange() {
    this.levelsOnSong = (this.levelsOnSong || 0) + 1;
    if (this.musicMode === 'battle' && this.levelsOnSong > MUSIC_LEVELS) { this.levelsOnSong = 1; this.playMusic('battle', true); }
  }
  stopMusic() { this.fadeOutAll(0.3); this.musicMode = null; }
  fadeOutAll(sec) {
    const now = this.ctx.currentTime;
    for (const v of this.voices || []) {
      if (v.fading) continue;
      v.fading = true;
      if (v.startTimer) { clearTimeout(v.startTimer); v.startTimer = null; }
      v.gain.gain.cancelScheduledValues(now); v.gain.gain.setValueAtTime(v.gain.gain.value, now); v.gain.gain.linearRampToValueAtTime(0.0001, now + sec);
      v.endAt = now + sec + 0.1;
    }
  }
  newVoice(fadeIn, delay = 0) {
    const g = this.ctx.createGain(), now = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now); g.gain.setValueAtTime(0.0001, now + delay); g.gain.linearRampToValueAtTime(1, now + delay + fadeIn);
    g.connect(this.musicGain);
    const v = { gain: g, fading: false, bornAt: now + delay };
    (this.voices = this.voices || []).push(v);
    if (!this.musicTimer) this.musicTimer = setInterval(() => this.musicTick(), 25);
    return v;
  }
  nextIndex(mode, n) { const i = this.pl[mode] ?? -1; this.pl[mode] = (i + 1) % n; return this.pl[mode]; }
  startSynth(mode, fadeIn, delay = 0) {
    const list = PLAYLISTS[mode] || PLAYLISTS.battle, name = list[this.nextIndex(mode, list.length)], tr = TRACKS[name];
    const v = this.newVoice(fadeIn, delay);
    Object.assign(v, { mode, track: tr, name, step: 0, next: this.ctx.currentTime + delay + 0.05, stepDur: 60 / tr.bpm / 4 });
  }
  startFile(mode, files, fadeIn, delay = 0) {
    const v = this.newVoice(fadeIn, delay), file = files[this.nextIndex(mode, files.length)];
    const el = new Audio('/sounds/' + encodeURIComponent(file));
    el.loop = true; el.crossOrigin = 'anonymous';
    this.ctx.createMediaElementSource(el).connect(v.gain);
    const go = () => { v.startTimer = null; if (!v.fading) el.play().catch(() => {}); };
    if (delay > 0) v.startTimer = setTimeout(go, delay * 1000); else go();
    el.onerror = () => { if (!v.fading) { this.fadeOutAll(0.1); this.startSynth(mode, 0.5); } };
    Object.assign(v, { mode, el });
  }
  musicTick() {
    const now = this.ctx.currentTime;
    // a song that has played long enough moves on to the next one in its playlist
    const cur = this.voices.find(v => !v.fading && !v.dead);
    if (cur && (cur.mode === 'battle' || cur.mode === 'menu') && cur.mode === this.musicMode && cur.bornAt != null && now - cur.bornAt > (cur.track ? Math.min(MUSIC_MAX_SEC, cur.track.bars * 16 * cur.stepDur) : MUSIC_MAX_SEC)) {
      this.playMusic(cur.mode, true);
      return;
    }
    for (const v of this.voices) {
      if (v.endAt && now > v.endAt) { v.dead = true; if (v.el) v.el.pause(); v.gain.disconnect(); continue; }
      if (v.el) continue;   // file songs loop until levelChange()/playMusic() moves on
      while (v.next < now + 0.15) {
        const bar = Math.floor(v.step / 16), s = v.step % 16;
        v.track.play(this, v.next, bar, s, v.stepDur, v.gain);
        v.next += v.stepDur; v.step++;
      }
    }
    this.voices = this.voices.filter(v => !v.dead);
    if (!this.voices.length) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }
  // A sustained note with a soft attack and release (pads, drones).
  pad(t, type, f, dur, vol, out, attack = 0.08, detune = 0) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (detune) o.detune.setValueAtTime(detune, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - 0.15)); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
}

// ---------------------------------------------------------------- built-in music
const MUSIC_LEVELS = 2;   // battle songs last at least this many levels
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
const kick = (a, t, v, out) => a.tone(t, 'sine', 150, 45, 0.18, 0.5 * v, out);
const snare = (a, t, v, out) => a.hiss(t, 0.12, 0.18 * v, 1800, 'bandpass', out);
const hat = (a, t, v, out) => a.hiss(t, 0.04, 0.06 * v, 7000, 'highpass', out);
// Each track: bpm, bars (how long it plays before the playlist moves on) and play(audio, time, bar, 16th-step, stepDur, out).
const TRACKS = {
  // the original battle loop
  pulse: { bpm: 132, bars: 32, play(a, t, bar, s, d, out) {
    const P = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], ch = P[bar % 4];
    if (s % 4 === 0) a.tone(t, 'triangle', hz(ch[0] - 12), hz(ch[0] - 12), d * 3, 0.22, out);
    a.tone(t, 'square', hz(ch[s % 3] + (s >= 8 ? 24 : 12)), hz(ch[s % 3] + (s >= 8 ? 24 : 12)), d * 0.8, 0.035, out);
    if (s % 4 === 0) kick(a, t, 1, out); if (s % 8 === 4) snare(a, t, 1, out); if (s % 2 === 1) hat(a, t, 1, out);
  } },
  // synthwave drive: octave bass, gated arp, big backbeat
  neonDrive: { bpm: 118, bars: 32, play(a, t, bar, s, d, out) {
    const P = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], ch = P[Math.floor(bar / 2) % 4];
    if (s % 2 === 0) a.tone(t, 'sawtooth', hz(ch[0] - 24 + (s % 4 === 2 ? 12 : 0)), hz(ch[0] - 24 + (s % 4 === 2 ? 12 : 0)), d * 1.6, 0.07, out);
    const arp = [0, 1, 2, 1, 2, 0, 1, 2][s % 8]; a.tone(t, 'square', hz(ch[arp] + 12), hz(ch[arp] + 12), d * 0.7, 0.03, out);
    if (s === 0) a.pad(t, 'triangle', hz(ch[1] + 12), d * 16, 0.035, out, 0.3);
    if (s % 4 === 0) kick(a, t, 1, out); if (s === 4 || s === 12) snare(a, t, 1.2, out); if (s % 2 === 1) hat(a, t, 0.8, out);
  } },
  // half-time march: heavy stabs and toms
  ironMarch: { bpm: 96, bars: 24, play(a, t, bar, s, d, out) {
    const P = [40, 36, 43, 38], r = P[bar % 4];
    if (s === 0 || s === 6 || s === 10) { a.tone(t, 'sawtooth', hz(r), hz(r), d * 2.5, 0.08, out); a.tone(t, 'square', hz(r + 7), hz(r + 7), d * 2.5, 0.05, out); }
    if (s === 0 || s === 10) kick(a, t, 1.2, out); if (s === 8) snare(a, t, 1.4, out);
    if (s >= 12 && s % 2 === 0) a.tone(t, 'sine', 220 - (s - 12) * 25, 90, 0.2, 0.25, out);
    if (s % 4 === 2) hat(a, t, 0.7, out);
    if (s === 0 && bar % 2 === 0) a.pad(t, 'triangle', hz(r + 24), d * 30, 0.04, out, 0.4);
  } },
  // bright, fast arpeggio piece in a major key
  skyline: { bpm: 140, bars: 32, play(a, t, bar, s, d, out) {
    const P = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], ch = P[bar % 4];
    a.tone(t, 'triangle', hz(ch[s % 3] + 12 + (s % 6 === 5 ? 12 : 0)), hz(ch[s % 3] + 12), d * 0.9, 0.05, out);
    if (s % 8 === 0) a.tone(t, 'triangle', hz(ch[0] - 12), hz(ch[0] - 12), d * 6, 0.2, out);
    const mel = [12, -1, 14, 16, -1, 19, 16, -1, 14, -1, 12, -1, 11, -1, 7, -1][s];
    if (mel >= 0 && bar % 2 === 1) a.tone(t, 'sine', hz(ch[0] + mel), hz(ch[0] + mel), d * 1.8, 0.07, out);
    if (s % 4 === 0) kick(a, t, 0.9, out); if (s % 8 === 4) snare(a, t, 0.9, out); hat(a, t, s % 2 ? 0.5 : 0.9, out);
  } },
  // the original menu loop
  menuDrift: { bpm: 96, bars: 32, play(a, t, bar, s, d, out) {
    const P = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], ch = P[bar % 4];
    if (s % 8 === 0) a.tone(t, 'triangle', hz(ch[0] - 12), hz(ch[0] - 12), d * 7.5, 0.2, out);
    if (s % 2 === 0) a.tone(t, 'sine', hz(ch[(s / 2) % 3] + 12), hz(ch[(s / 2) % 3] + 12), d * 1.8, 0.07, out);
  } },
  // soft pads and plucks
  menuTide: { bpm: 80, bars: 24, play(a, t, bar, s, d, out) {
    const P = [[53, 57, 60, 64], [50, 53, 57, 60], [46, 50, 53, 57], [48, 52, 55, 59]], ch = P[bar % 4];
    if (s === 0) for (const n of ch) a.pad(t, 'triangle', hz(n), d * 16, 0.028, out, 0.6);
    if (s % 3 === 0) a.tone(t, 'sine', hz(ch[(s / 3) % 4] + 24), hz(ch[(s / 3) % 4] + 24), d * 3, 0.045, out);
    if (s === 0) a.tone(t, 'sine', hz(ch[0] - 12), hz(ch[0] - 12), d * 14, 0.16, out);
  } },
  // BOSS: driving phrygian riff, choir pad, bells
  warden: { bpm: 150, bars: 9999, play(a, t, bar, s, d, out) {
    const R = [36, 37, 36, 34][bar % 4];   // C, Db, C, Bb
    a.tone(t, 'sawtooth', hz(R + ([0, 0, 12, 0, 0, 12, 0, 13][s % 8] || 0)), hz(R), d * 0.9, 0.075, out);
    if (s === 0) { for (const n of [R + 24, R + 27, R + 31]) { a.pad(t, 'sawtooth', hz(n), d * 16, 0.016, out, 0.25, -7); a.pad(t, 'sawtooth', hz(n), d * 16, 0.016, out, 0.25, 7); } }
    if (s % 2 === 0) a.tone(t, 'square', hz(R + 36 + (s % 4 ? 3 : 0)), hz(R + 36), d * 0.6, 0.02, out);
    if (s % 4 === 0) kick(a, t, 1.2, out);
    if (s === 4 || s === 12) snare(a, t, 1.5, out); if (s === 14 && bar % 2) snare(a, t, 0.9, out);
    hat(a, t, s % 2 ? 0.6 : 1, out);
    if (s === 0 && bar % 2 === 0) { a.tone(t, 'sine', hz(R + 48), hz(R + 48), 1.6, 0.06, out); a.tone(t, 'sine', hz(R + 55), hz(R + 55), 1.2, 0.03, out); }
    if (bar % 8 === 7 && s >= 8) a.tone(t, 'sine', 120 + (s - 8) * 30, 60, 0.15, 0.3, out);   // tom fill into the next phrase
  } },
  // SUSPENSE: heartbeat, ticking clock, low drone and a slow riser
  lastStand: { bpm: 92, bars: 9999, play(a, t, bar, s, d, out) {
    const R = [45, 45, 41, 40][bar % 4];   // A, A, F, E
    if (s === 0 || s === 3) a.tone(t, 'sine', s ? 70 : 85, 38, 0.22, s ? 0.35 : 0.5, out);   // lub-dub
    if (s % 2 === 0) a.hiss(t, 0.025, s % 4 === 0 ? 0.07 : 0.04, 6000, 'highpass', out);       // tick... tock
    if (s === 0) { a.pad(t, 'sine', hz(R - 12), d * 16, 0.14, out, 0.4); a.pad(t, 'triangle', hz(R + 12), d * 16, 0.02, out, 1.0, 5); }
    if (s === 8 && bar % 2 === 1) { a.tone(t, 'sine', hz(R + 24), hz(R + 24), 1.4, 0.05, out); a.tone(t + 0.02, 'sine', hz(R + 25), hz(R + 25), 1.4, 0.035, out); }   // a dissonant ping
    if (bar % 4 === 3 && s === 0) a.hiss(t, d * 16, 0.06, 300, 'bandpass', out, 4000);       // riser into the next phrase
  } },
};
// ---- more tracks (each a different style so the rotation never sounds samey) ----
// A melody line: one entry per 16th (semitones above the root, -1 = rest).
const mel = (a, t, line, s, root, d, type, vol, out, len = 1.6) => { const n = line[s]; if (n != null && n >= 0) a.tone(t, type, hz(root + n), hz(root + n), d * len, vol, out); };
Object.assign(TRACKS, {
  // 8-bit chiptune: square lead, pulse bass, noise drums
  pixelHeart: { bpm: 150, bars: 32, play(a, t, bar, s, d, out) {
    const R = [60, 57, 53, 55][bar % 4];
    if (s % 2 === 0) a.tone(t, 'square', hz(R - 24 + (s % 4 ? 7 : 0)), hz(R - 24 + (s % 4 ? 7 : 0)), d * 0.9, 0.05, out);
    mel(a, t, bar % 2 ? [12, -1, 16, -1, 19, -1, 16, 14, 12, -1, 7, -1, 9, -1, 11, -1] : [12, 14, 16, -1, 16, -1, 14, 12, 14, -1, 16, -1, 19, -1, -1, -1], s, R, d, 'square', 0.035, out, 1.2);
    if (s % 4 === 0) a.tone(t, 'square', 110, 40, 0.06, 0.12, out); if (s % 8 === 4) a.hiss(t, 0.06, 0.12, 3000, 'highpass', out); if (s % 2) a.hiss(t, 0.02, 0.04, 9000, 'highpass', out);
  } },
  // drum and bass: fast breakbeat, deep reese bass
  breakneck: { bpm: 172, bars: 48, play(a, t, bar, s, d, out) {
    const R = [38, 38, 41, 36][Math.floor(bar / 2) % 4];
    if (s === 0 || s === 10) kick(a, t, 1.1, out); if (s === 4 || s === 12 || (s === 15 && bar % 2)) snare(a, t, 1.2, out); if (s % 2 === 0) hat(a, t, 0.6, out);
    if (s === 0 || s === 8) { a.pad(t, 'sawtooth', hz(R - 12), d * 7.5, 0.05, out, 0.02, -9); a.pad(t, 'sawtooth', hz(R - 12), d * 7.5, 0.05, out, 0.02, 9); }
    if (s === 0 && bar % 4 === 0) a.pad(t, 'triangle', hz(R + 24), d * 60, 0.03, out, 1.2);
  } },
  // funk: slap bass, offbeat chords, clap
  slapHappy: { bpm: 108, bars: 32, play(a, t, bar, s, d, out) {
    const R = [43, 43, 48, 46][bar % 4];
    mel(a, t, [0, -1, 12, 0, -1, 0, 10, -1, 0, 12, -1, 7, 10, -1, 12, -1], s, R, d, 'sawtooth', 0.06, out, 0.7);
    if (s === 2 || s === 6 || s === 10 || s === 14) for (const n of [10, 14, 17]) a.tone(t, 'square', hz(R + 12 + n), hz(R + 12 + n), d * 0.5, 0.012, out);
    if (s === 0 || s === 7 || s === 10) kick(a, t, 1, out); if (s === 4 || s === 12) { snare(a, t, 0.8, out); a.hiss(t, 0.08, 0.1, 1200, 'bandpass', out); } hat(a, t, s % 2 ? 0.4 : 0.7, out);
  } },
  // surf rock: tremolo twang, galloping drums
  wipeout: { bpm: 164, bars: 32, play(a, t, bar, s, d, out) {
    const R = [52, 52, 57, 59][bar % 4];
    a.tone(t, 'sawtooth', hz(R + [0, 0, 7, 12][s % 4]), hz(R + [0, 0, 7, 12][s % 4]), d * 0.45, 0.03, out);
    if (s % 4 === 0) a.tone(t, 'triangle', hz(R - 12), hz(R - 12), d * 2, 0.16, out);
    if (s % 8 === 0) kick(a, t, 1, out); if (s % 8 === 4) snare(a, t, 1, out); if (s % 2 === 0) a.hiss(t, 0.05, 0.05, 5000, 'highpass', out);
  } },
  // lo-fi: lazy swing, warm keys, vinyl crackle
  rainyCafe: { bpm: 78, bars: 24, play(a, t, bar, s, d, out) {
    const P = [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [53, 57, 60, 64]], ch = P[bar % 4], sw = s % 2 ? d * 0.18 : 0;
    if (s === 0 || s === 10) for (const n of ch) a.pad(t, 'triangle', hz(n), d * 6, 0.02, out, 0.05);
    if (s === 0 || s === 9) kick(a, t, 0.8, out); if (s === 4 || s === 12) a.hiss(t + sw, 0.1, 0.07, 1500, 'bandpass', out); if (s % 2 === 0 || s === 15) hat(a, t + sw, 0.4, out);
    if (s === 0) a.tone(t, 'sine', hz(ch[0] - 12), hz(ch[0] - 12), d * 7, 0.14, out);
    mel(a, t + sw, [-1, -1, 12, -1, 14, -1, -1, 12, -1, -1, 9, -1, 7, -1, -1, -1], s, ch[0], d, 'sine', 0.04, out, 2.5);
    if (Math.random() < 0.25) a.hiss(t, 0.01, 0.02, 4000, 'highpass', out);
  } },
  // taiko war drums with a shakuhachi-ish flute
  thunderDrums: { bpm: 104, bars: 32, play(a, t, bar, s, d, out) {
    const R = 50;
    if ([0, 3, 6, 8, 11, 14].includes(s)) a.tone(t, 'sine', s % 8 === 0 ? 95 : 130, 50, 0.3, s % 8 === 0 ? 0.55 : 0.32, out);
    if (s === 12 || s === 13) a.hiss(t, 0.05, 0.09, 2200, 'bandpass', out);
    if (bar % 2 === 1) mel(a, t, [0, -1, -1, 3, -1, 5, -1, -1, 7, -1, 10, -1, 7, -1, 5, -1], s, R + 12, d, 'sine', 0.06, out, 2.2);
    if (s === 0 && bar % 4 === 0) a.pad(t, 'triangle', hz(R - 12), d * 60, 0.06, out, 0.8);
  } },
  // dark trap: half-time, rolling hats, 808 slides
  nightShift: { bpm: 140, bars: 32, play(a, t, bar, s, d, out) {
    const R = [41, 41, 39, 44][bar % 4];
    if (s === 0 || s === 11) a.tone(t, 'sine', hz(R - 12) * 1.5, hz(R - 12), d * 5, 0.32, out);
    if (s === 8) snare(a, t, 1.3, out);
    const roll = bar % 2 && s >= 12; hat(a, t, 0.5, out); if (roll) hat(a, t + d / 2, 0.4, out);
    if (s === 0) a.pad(t, 'sawtooth', hz(R + 24), d * 16, 0.012, out, 0.5, 6);
    mel(a, t, [-1, -1, -1, -1, 15, -1, -1, 14, -1, -1, 12, -1, -1, -1, -1, -1], s, R + 12, d, 'triangle', 0.04, out, 2);
  } },
  // eurobeat: four on the floor, offbeat octave bass, soaring lead
  turboNight: { bpm: 156, bars: 48, play(a, t, bar, s, d, out) {
    const R = [57, 53, 55, 52][bar % 4];
    if (s % 4 === 0) kick(a, t, 1, out); if (s % 4 === 2) a.tone(t, 'sawtooth', hz(R - 12), hz(R - 12), d * 1.5, 0.08, out); if (s % 8 === 4) snare(a, t, 0.9, out); if (s % 4 === 2) hat(a, t, 0.8, out);
    mel(a, t, [12, -1, 12, 14, -1, 16, -1, 19, -1, 17, 16, -1, 14, -1, 12, -1], s, R, d, 'sawtooth', 0.03, out, 1.4);
    if (s === 0) a.pad(t, 'square', hz(R + 12), d * 16, 0.015, out, 0.2);
  } },
  // spaghetti western: whistle, twangy plucks, horse-clop percussion
  highNoon: { bpm: 100, bars: 24, play(a, t, bar, s, d, out) {
    const R = [57, 57, 52, 55][bar % 4];
    if (s % 4 === 0 || s % 4 === 3) a.tone(t, 'triangle', hz(R - 12 + (s % 8 >= 4 ? 7 : 0)), hz(R - 12), d * 1.2, 0.12, out);
    mel(a, t, bar % 2 ? [12, -1, -1, -1, 17, -1, 15, -1, 12, -1, -1, -1, 10, -1, 7, -1] : [7, -1, 12, -1, -1, -1, 15, 14, 12, -1, -1, -1, -1, -1, -1, -1], s, R, d, 'sine', 0.07, out, 2.4);
    if (s % 4 === 0 || s % 4 === 3) a.hiss(t, 0.03, 0.07, 2600, 'bandpass', out);
    if (s === 8 && bar % 4 === 3) a.tone(t, 'sawtooth', hz(R + 24), hz(R + 23), 0.9, 0.03, out);
  } },
  // arcade rush: hyper-fast chord stabs and a bouncing bass
  arcadeRush: { bpm: 176, bars: 48, play(a, t, bar, s, d, out) {
    const P = [[60, 64, 67], [62, 65, 69], [57, 60, 64], [59, 62, 67]], ch = P[bar % 4];
    if (s % 3 === 0) for (const n of ch) a.tone(t, 'square', hz(n), hz(n), d * 0.6, 0.014, out);
    a.tone(t, 'triangle', hz(ch[0] - 24 + (s % 2 ? 12 : 0)), hz(ch[0] - 24), d * 0.9, 0.12, out);
    if (s % 4 === 0) kick(a, t, 0.9, out); if (s % 8 === 4) snare(a, t, 0.9, out); hat(a, t, 0.5, out);
  } },
  // MENU: glass bells over a slow drone
  menuGlass: { bpm: 70, bars: 24, play(a, t, bar, s, d, out) {
    const P = [[64, 67, 71, 74], [62, 65, 69, 72], [60, 64, 67, 71], [59, 62, 67, 69]], ch = P[bar % 4];
    if (s === 0) a.pad(t, 'sine', hz(ch[0] - 24), d * 16, 0.12, out, 0.8);
    if (s % 4 === 0) { const n = ch[(s / 4 + bar) % 4] + 12; a.tone(t, 'sine', hz(n), hz(n), 2.2, 0.05, out); a.tone(t, 'sine', hz(n) * 2.01, hz(n) * 2.01, 1.2, 0.015, out); }
  } },
  // MENU: jazzy seventh chords, walking bass, brushed snare
  menuLounge: { bpm: 92, bars: 32, play(a, t, bar, s, d, out) {
    const P = [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [45, 48, 52, 55]], ch = P[bar % 4], sw = s % 2 ? d * 0.2 : 0;
    if (s === 0 || s === 6) for (const n of ch) a.pad(t, 'triangle', hz(n), d * 4, 0.018, out, 0.03);
    if (s % 4 === 0) { const w = [0, 4, 7, 9][s / 4]; a.tone(t, 'sine', hz(ch[0] - 12 + w), hz(ch[0] - 12 + w), d * 3.5, 0.14, out); }
    if (s % 2 === 0) a.hiss(t + sw, 0.08, 0.025, 3000, 'bandpass', out);
  } },
});
const PLAYLISTS = { menu: ['menuDrift', 'menuTide', 'menuGlass', 'menuLounge'],
  battle: ['pulse', 'neonDrive', 'pixelHeart', 'ironMarch', 'breakneck', 'skyline', 'slapHappy', 'wipeout', 'thunderDrums', 'nightShift', 'turboNight', 'rainyCafe', 'highNoon', 'arcadeRush'],
  boss: ['warden'], suspense: ['lastStand'] };
// Songs also move on after playing for a while (same slow fade as any other change): battle and menu only.
const MUSIC_MAX_SEC = 150;
export const MUSIC_TRACKS = Object.keys(TRACKS);

// Placeholder sounds. Each is replaced automatically by a file of the same name in sounds.json.
let operaN = 0;
const SYNTH = {
  slash:     (a, t, v) => { a.hiss(t, 0.16, 0.28 * v, 2600, 'bandpass', a.sfxGain, 700); a.tone(t, 'triangle', 1800, 600, 0.1, 0.05 * v); },
  cut:       (a, t, v) => { a.tone(t, 'square', 3200, 2400, 0.06, 0.06 * v); a.tone(t + 0.02, 'sine', 4200, 4000, 0.12, 0.05 * v); },
  powerUp:   (a, t, v) => { a.tone(t, 'sawtooth', 220, 880, 0.5, 0.08 * v); a.tone(t + 0.1, 'sine', 660, 1320, 0.45, 0.08 * v); },
  ritual:    (a, t, v) => { a.tone(t, 'sine', 110, 82, 0.9, 0.25 * v); a.tone(t, 'triangle', 165, 123, 0.9, 0.1 * v); a.hiss(t, 0.7, 0.08 * v, 400, 'lowpass'); },
  // Ground Slam: a short, low "hup!" (a pitched-down vocal buzz through a formant-ish bandpass)
  grunt:     (a, t, v) => { a.tone(t, 'sawtooth', 165, 95, 0.16, 0.09 * v); a.tone(t, 'square', 330, 190, 0.12, 0.025 * v); a.hiss(t, 0.13, 0.12 * v, 650, 'bandpass', a.sfxGain, 380); },
  // Cursed Sacrifice charging: a quiet low drone with a dissonant second, and a breath of filtered noise
  darkHum:   (a, t, v) => { a.pad(t, 'sine', 55, 1.5, 0.11 * v, a.sfxGain, 0.4); a.pad(t, 'triangle', 58.3, 1.5, 0.035 * v, a.sfxGain, 0.5); a.hiss(t, 1.3, 0.025 * v, 260, 'lowpass'); },
  // Sacred Grove charging: a soft "aah" chord, gently detuned so it shimmers like voices
  // Space King charging: a light operatic choir, a soprano line with vibrato over a soft chord.
  // Long through-composed phrases (about 8 s each, alternating A and B) so the charge doesn't sound like a short loop.
  opera:     (a, t, v) => {
    // v26: four phrases (about 33 s before it repeats) and quieter overall
    const ph = (operaN++) % 4;
    const chords = [[[523, 659, 784], [440, 523, 659], [349, 440, 523], [392, 494, 587]], [[440, 554, 659], [392, 494, 587], [349, 440, 523], [392, 494, 587]],
      [[349, 440, 523], [392, 494, 587], [330, 415, 494], [440, 554, 659]], [[392, 494, 587], [349, 440, 523], [330, 392, 494], [349, 440, 523]]][ph];
    chords.forEach((ch, i) => { for (const [k, f] of ch.entries()) a.pad(t + i * 2.05, 'sine', f, 2.4, 0.011 * v, a.sfxGain, 0.7, [-5, 4, -3][k]); });
    const mel = [[1047, 1175, 1319, 1175, 1047, 988, 1047, 880, 988, 1047, 988, 1047], [880, 988, 1109, 988, 880, 784, 880, 988, 880, 784, 740, 784],
      [698, 784, 880, 1047, 988, 880, 784, 698, 659, 698, 784, 880], [784, 880, 988, 880, 784, 698, 659, 587, 659, 698, 659, 698]][ph];
    mel.forEach((f, i) => { for (const d of [-12, 0, 12]) a.pad(t + 0.2 + i * 0.66, 'triangle', f, 0.85, 0.005 * v, a.sfxGain, 0.15, d); });
    a.hiss(t, 8, 0.004 * v, 1800, 'bandpass');
  },
  choir:     (a, t, v) => { for (const [f, d] of [[392, -6], [494, 5], [587, -4], [784, 7]]) a.pad(t, 'sine', f, 1.5, 0.01 * v, a.sfxGain, 0.45, d); a.hiss(t, 1.1, 0.008 * v, 1400, 'bandpass'); },
  zap:       (a, t, v) => { a.hiss(t, 0.25, 0.22 * v, 4200, 'bandpass', a.sfxGain, 1200); a.tone(t, 'square', 140, 60, 0.18, 0.06 * v); a.tone(t + 0.04, 'sawtooth', 2400, 900, 0.1, 0.03 * v); },
  hiss:      (a, t, v) => { a.hiss(t, 0.5, 0.06 * v, 900, 'bandpass', a.sfxGain, 500); },
  coin:      (a, t, v) => { a.tone(t, 'square', 990, 990, 0.07, 0.07 * v); a.tone(t + 0.07, 'square', 1320, 1320, 0.16, 0.07 * v); },
  // v1.2.0: a punchier shot (a low thump under the zap and a short crack), plus feedback sounds for the new game feel
  shoot:     (a, t, v) => { const p = 1 + (Math.random() - 0.5) * 0.12; a.tone(t, 'square', 900 * p, 170, 0.08, 0.1 * v); a.tone(t, 'sine', 160 * p, 50, 0.09, 0.22 * v); a.hiss(t, 0.045, 0.12 * v, 3600, 'bandpass', a.sfxGain, 1400); },
  hit:       (a, t, v) => { a.tone(t, 'sine', 220, 70, 0.12, 0.35 * v); a.hiss(t, 0.08, 0.15 * v, 900); },
  hitConfirm:(a, t, v) => { a.tone(t, 'square', 1900, 1500, 0.035, 0.05 * v); a.tone(t, 'sine', 3200, 2600, 0.05, 0.05 * v); a.hiss(t, 0.03, 0.06 * v, 5200); },
  kill:      (a, t, v) => { a.tone(t, 'sine', 140, 38, 0.32, 0.5 * v); a.hiss(t, 0.18, 0.22 * v, 900, 'lowpass', a.sfxGain, 120); a.tone(t + 0.02, 'triangle', 1318, 1318, 0.22, 0.07 * v); a.tone(t + 0.07, 'triangle', 1976, 1976, 0.28, 0.06 * v); },
  land:      (a, t, v) => { a.tone(t, 'sine', 110, 45, 0.09, 0.2 * v); a.hiss(t, 0.06, 0.07 * v, 500, 'lowpass'); },
  slowmo:    (a, t, v) => { a.tone(t, 'sine', 90, 30, 1.1, 0.45 * v); a.hiss(t, 1.0, 0.12 * v, 2400, 'lowpass', a.sfxGain, 200); a.tone(t, 'sawtooth', 220, 55, 0.8, 0.05 * v); },
  whoosh:    (a, t, v) => { a.hiss(t, 0.32, 0.22 * v, 400, 'bandpass', a.sfxGain, 3200); },
  cardDeal:  (a, t, v) => { a.hiss(t, 0.09, 0.12 * v, 2400, 'bandpass', a.sfxGain, 5200); a.tone(t, 'sine', 600, 900, 0.05, 0.03 * v); },
  cardHover: (a, t, v) => { a.tone(t, 'sine', 1500, 1700, 0.03, 0.035 * v); },
  pip:       (a, t, v) => { a.tone(t, 'triangle', 1047, 1047, 0.12, 0.12 * v); a.tone(t + 0.08, 'triangle', 1568, 1568, 0.25, 0.12 * v); a.hiss(t, 0.06, 0.05 * v, 6000); },
  hurt:      (a, t, v) => { a.tone(t, 'sawtooth', 300, 90, 0.18, 0.18 * v); },
  block:     (a, t, v) => { a.tone(t, 'sine', 1400, 1400, 0.18, 0.18 * v); a.tone(t, 'sine', 2100, 2100, 0.12, 0.08 * v); },
  shield:    (a, t, v) => { a.tone(t, 'sine', 500, 1100, 0.15, 0.12 * v); },
  bounce:    (a, t, v) => { a.tone(t, 'triangle', 1600, 1200, 0.04, 0.06 * v); },
  explode:   (a, t, v) => { a.hiss(t, 0.55, 0.5 * v, 1200, 'lowpass', a.sfxGain, 80); a.tone(t, 'sine', 120, 35, 0.4, 0.45 * v); },
  death:     (a, t, v) => { a.tone(t, 'sawtooth', 420, 55, 0.6, 0.2 * v); a.hiss(t, 0.4, 0.2 * v, 600, 'lowpass'); },
  nope:      (a, t, v) => { a.tone(t, 'square', 220, 200, 0.09, 0.08 * v); a.tone(t + 0.11, 'square', 180, 160, 0.12, 0.08 * v); },   // can't do that (AMON: not enough gold)
  uwu:       (a, t, v) => {   // anime mode gunshot: a little sung "uwu" (formant-ish glide down, up)
    const f = 520 + Math.random() * 120;
    a.tone(t, 'sine', f * 1.25, f, 0.09, 0.07 * v); a.tone(t, 'triangle', f * 2.5, f * 2, 0.09, 0.025 * v);
    a.tone(t + 0.1, 'sine', f * 0.9, f * 1.35, 0.13, 0.08 * v); a.tone(t + 0.1, 'triangle', f * 1.8, f * 2.7, 0.13, 0.025 * v);
  },
  hop:       (a, t, v) => { const f = 900 + Math.random() * 300; a.tone(t, 'sine', f, f * 1.7, 0.07, 0.07 * v); a.tone(t + 0.06, 'sine', f * 1.5, f * 2.2, 0.06, 0.05 * v); },
  jump:      (a, t, v) => { a.tone(t, 'sine', 300, 620, 0.1, 0.08 * v); },
  reload:    (a, t, v) => { a.hiss(t, 0.03, 0.2 * v, 2500); a.hiss(t + 0.12, 0.03, 0.2 * v, 3200); },
  roundStart:(a, t, v) => { a.tone(t, 'triangle', 523, 523, 0.18, 0.2 * v); a.tone(t + 0.2, 'triangle', 659, 659, 0.25, 0.2 * v); },
  fight:     (a, t, v) => { [523, 659, 784, 1047].forEach((f, i) => a.tone(t + i * 0.06, 'square', f, f, 0.12, 0.08 * v)); },
  roundWin:  (a, t, v) => { [523, 659, 784].forEach((f, i) => a.tone(t + i * 0.1, 'triangle', f, f, 0.3, 0.2 * v)); },
  roundLose: (a, t, v) => { [440, 370, 311].forEach((f, i) => a.tone(t + i * 0.12, 'triangle', f, f, 0.3, 0.18 * v)); },
  cardPick:  (a, t, v) => { a.tone(t, 'sine', 880, 1320, 0.15, 0.15 * v); },
  reroll:    (a, t, v) => { [660, 880, 660].forEach((f, i) => a.tone(t + i * 0.05, 'square', f, f, 0.05, 0.06 * v)); },
  ui:        (a, t, v) => { a.tone(t, 'sine', 1200, 1200, 0.04, 0.06 * v); },
  victory:   (a, t, v) => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => a.tone(t + i * 0.12, 'triangle', f, f, 0.35, 0.2 * v)); },
  defeat:    (a, t, v) => { [392, 349, 311, 262].forEach((f, i) => a.tone(t + i * 0.18, 'triangle', f, f, 0.4, 0.18 * v)); },
};
