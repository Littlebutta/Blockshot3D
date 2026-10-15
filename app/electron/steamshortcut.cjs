// v1.2.17 "Add to Steam" (title screen, top left; Devin): adds this game to the Steam library as a non-Steam game, with
// its artwork (electron/steam-art: library capsule, wide capsule, hero banner, logo, icon). Windows only.
// Steam keeps its shortcuts in userdata/<account>/config/shortcuts.vdf (binary KeyValues) and reads it only when it
// starts, and may write it back when it closes, so a running Steam has to restart.
// v1.2.17 fix (Devin: "it just closed Steam", nothing added): the game is itself connected to Steam (multiplayer), and
// when Steam went away it took the game's work with it. Now the files are written first, and a small helper process
// that does not depend on Steam (this file, run by the game's .exe as plain Node) closes Steam, writes the files again
// in case Steam overwrote them on the way out, and starts Steam back up. It logs to Documents/Blockshot3D/add-to-steam.log.
const fs = require('fs'), path = require('path'), { execFileSync, spawn } = require('child_process');
const NAME = 'Blockshot 3D';

// ---- binary KeyValues: 0 = map, 1 = string, 2 = int32, 7 = uint64, 8 = end of map
function parseVdf(buf) {
  let i = 0;
  const str = () => { const e = buf.indexOf(0, i); const s = buf.toString('utf8', i, e); i = e + 1; return s; };
  const map = () => {
    const o = {};
    for (;;) {
      const t = buf[i++];
      if (t === 8 || t === undefined) return o;
      const k = str();
      if (t === 0) o[k] = map();
      else if (t === 1) o[k] = str();
      else if (t === 2) { o[k] = { i32: buf.readInt32LE(i) }; i += 4; }
      else if (t === 7) { o[k] = { u64: buf.readBigUInt64LE(i) }; i += 8; }
      else throw new Error('unknown field type ' + t);
    }
  };
  return map();
}
function writeVdf(o) {
  const parts = [];
  const s = v => parts.push(Buffer.from(v + '\0', 'utf8'));
  const map = m => {
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === 'string') { parts.push(Buffer.from([1])); s(k); s(v); }
      else if (v && v.i32 !== undefined) { parts.push(Buffer.from([2])); s(k); const b = Buffer.alloc(4); b.writeInt32LE(v.i32 | 0); parts.push(b); }
      else if (v && v.u64 !== undefined) { parts.push(Buffer.from([7])); s(k); const b = Buffer.alloc(8); b.writeBigUInt64LE(v.u64); parts.push(b); }
      else { parts.push(Buffer.from([0])); s(k); map(v || {}); }
    }
    parts.push(Buffer.from([8]));
  };
  map(o);
  return Buffer.concat(parts);
}

// the id Steam gives a non-Steam game (also the file names of its artwork): crc32 of exe + name, top bit set
function crc32(s) {
  let c, crc = 0xffffffff;
  for (const b of Buffer.from(s, 'utf8')) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
const appIdFor = (exe, name) => (crc32(exe + name) | 0x80000000) >>> 0;

function steamDir() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', windowsHide: true });
    const m = /SteamPath\s+REG_\w+\s+(.+)/.exec(out); if (m && fs.existsSync(m[1].trim())) return path.normalize(m[1].trim());
  } catch { /* not in the registry */ }
  for (const d of ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']) if (fs.existsSync(d)) return d;
  return null;
}
function steamRunning() {
  try { return /steam\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { encoding: 'utf8', windowsHide: true })); } catch { return false; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function usersOf(dir) {
  return fs.existsSync(path.join(dir, 'userdata')) ? fs.readdirSync(path.join(dir, 'userdata')).filter(u => /^\d+$/.test(u) && u !== '0') : [];
}
// adds (or refreshes) the shortcut for every Steam account on this PC.
// opts: { exe, artDir, logFile, beforeRestart() } (beforeRestart: the game lets go of Steam before Steam closes)
async function addToSteam({ exe, artDir, logFile, beforeRestart }) {
  if (process.platform !== 'win32') return { ok: false, error: 'Adding to Steam works in the Windows version of the game.' };
  const dir = steamDir(); if (!dir) return { ok: false, error: "Couldn't find Steam on this PC." };
  const users = usersOf(dir);
  if (!users.length) return { ok: false, error: 'Sign in to Steam once on this PC first.' };
  writeAll(dir, users, exe, artDir);
  if (!steamRunning()) return { ok: true, restarted: false, accounts: users.length };
  // Steam is open: a helper outside the game restarts it (see the top of this file)
  if (beforeRestart) try { beforeRestart(); } catch { /* ignore */ }
  const { spawn: sp } = require('child_process');
  const child = sp(process.execPath, [__filename, JSON.stringify({ dir, exe, artDir, logFile })], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { ok: true, restarted: true, accounts: users.length };
}
// the helper: close Steam, write again, start Steam
async function restartHelper({ dir, exe, artDir, logFile }) {
  const log = m => { try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, `${new Date().toISOString()} ${m}\n`); } catch { /* no log */ } };
  try {
    log('closing Steam');
    const steamExe = path.join(dir, 'steam.exe');
    try { spawn(steamExe, ['-shutdown'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch (e) { log('shutdown failed: ' + e.message); }
    let t = 0; for (; t < 180 && steamRunning(); t++) await sleep(500);
    log(steamRunning() ? 'Steam did not close in 90 s' : `Steam closed after ${t / 2} s`);
    await sleep(1500);
    writeAll(dir, usersOf(dir), exe, artDir); log('shortcut and artwork written');
    spawn(steamExe, [], { detached: true, stdio: 'ignore' }).unref(); log('Steam started');
  } catch (e) { log('error: ' + (e && e.stack || e)); }
}
function writeAll(dir, users, exe, artDir) {
  const quoted = `"${exe}"`, appid = appIdFor(quoted, NAME);
  for (const u of users) {
    const cfg = path.join(dir, 'userdata', u, 'config'), file = path.join(cfg, 'shortcuts.vdf'), grid = path.join(cfg, 'grid');
    fs.mkdirSync(grid, { recursive: true });
    let root = { shortcuts: {} };
    try { if (fs.existsSync(file)) { root = parseVdf(fs.readFileSync(file)); fs.copyFileSync(file, file + '.blockshot-backup'); } } catch { root = { shortcuts: {} }; }
    const list = root.shortcuts || (root.shortcuts = {});
    const same = s => s && typeof s.Exe === 'string' && s.Exe.replace(/"/g, '').toLowerCase() === exe.toLowerCase();
    let key = Object.keys(list).find(k => same(list[k]));
    if (key == null) key = String(Object.keys(list).length ? Math.max(...Object.keys(list).map(Number).filter(Number.isFinite)) + 1 : 0);
    const icon = path.join(grid, `${appid}_icon.png`);
    list[key] = { ...(list[key] || {}), appid: { i32: appid | 0 }, AppName: NAME, Exe: quoted, StartDir: `"${path.dirname(exe)}"`, icon, ShortcutPath: '', LaunchOptions: '',
      IsHidden: { i32: 0 }, AllowDesktopConfig: { i32: 1 }, AllowOverlay: { i32: 1 }, OpenVR: { i32: 0 }, Devkit: { i32: 0 }, DevkitGameID: '', DevkitOverrideAppID: { i32: 0 },
      LastPlayTime: (list[key] && list[key].LastPlayTime) || { i32: 0 }, FlatpakAppID: '', tags: (list[key] && list[key].tags) || {} };
    fs.writeFileSync(file, writeVdf(root));
    for (const [src, dst] of [['capsule.png', `${appid}p.png`], ['wide.png', `${appid}.png`], ['hero.png', `${appid}_hero.png`], ['logo.png', `${appid}_logo.png`], ['icon.png', `${appid}_icon.png`]]) {
      try { fs.copyFileSync(path.join(artDir, src), path.join(grid, dst)); } catch { /* art missing: the shortcut still works */ }
    }
  }
}

module.exports = { addToSteam, restartHelper, parseVdf, writeVdf, appIdFor };
if (require.main === module && process.argv[2]) restartHelper(JSON.parse(process.argv[2]));
