// Blockshot 3D desktop app (Electron).
// - Runs the game server internally (players never set up a server); it listens on the local network so PCs on the same network can join in a browser
// - Connects to Steam: friends-only lobbies, invite overlay, peer-to-peer through Steam's relay
// - Ctrl+Shift+N opens a second window on the same PC for testing multiplayer alone
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

// Graphics options that only work as launch switches (saved by the game's Settings > Graphics).
const GFX_FILE = path.join(app.getPath('userData'), 'graphics.json');
try {
  const gfx = JSON.parse(fs.readFileSync(GFX_FILE, 'utf8'));
  if (gfx.vsync === false) { app.commandLine.appendSwitch('disable-gpu-vsync'); app.commandLine.appendSwitch('disable-frame-rate-limit'); }
} catch { /* first launch: v-sync on */ }
app.commandLine.appendSwitch('force_high_performance_gpu');
// v1.2.16: after alt+tab (or a screenshot overlay) Windows could leave the window marked as covered, and a GPU reset could
// block WebGL for the page: either way the picture froze while the game ran on. Keep drawing, and never block WebGL.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-domain-blocking-for-3d-apis');   // v1.2.6: hybrid laptops run the game on the dedicated GPU, not the integrated one
ipcMain.on('app:gfx', (_e, g) => {
  try { fs.mkdirSync(path.dirname(GFX_FILE), { recursive: true }); fs.writeFileSync(GFX_FILE, JSON.stringify({ vsync: !(g && g.vsync === false) })); } catch (e) { console.warn('[gfx] could not save', e && e.message); }
});
let cfg = { appId: 480 };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(path.join(ROOT, 'steam.config.json'), 'utf8')) }; } catch { /* defaults */ }

// ---------- Steam ----------
let sw = null, client = null, steamError = '';
try {
  sw = require('steamworks.js');
  client = sw.init(cfg.appId);
  sw.electronEnableSteamOverlay();
} catch (e) {
  client = null;
  steamError = String(e && e.message || e);
  console.warn('[steam] not available:', steamError);
}
const CB = (sw && sw.SteamCallback) || { LobbyChatUpdate: 5, P2PSessionRequest: 6, GameLobbyJoinRequested: 8 };
const RELIABLE = 2, LOBBY_FRIENDS_ONLY = 1, ENTERED = 0;
let friendsApi = null, tuneApi = null, tuneInfo = null;
// v1.2.9: raise Steam's send-rate limit (it queued everything over 128 KB/s per connection: late snapshots, ping spikes); see steamtune.cjs
if (client) { try { tuneApi = require('./steamtune.cjs'); tuneInfo = tuneApi.tune(); console.log('[steam] net tune', JSON.stringify(tuneInfo)); } catch (e) { console.warn('[steam] net tune failed', e && e.message); } }
try { friendsApi = require('./steamfriends.cjs'); } catch (e) { console.warn('[steam] friends list unavailable:', e && e.message); }
// Rich presence keys friends read to see our game in their Multiplayer menu (see steamfriends.cjs).
const RP_KEYS = ['bs_lobby', 'bs_open', 'bs_bots', 'bs_players', 'bs_max', 'bs_state', 'bs_host'];
function setPresence(map) {
  if (!client) return;
  for (const [k, v] of Object.entries(map)) { try { client.localplayer.setRichPresence(k, v == null ? null : String(v)); } catch { /* ignore */ } }
}

// Launched from a Steam invite while the game was closed: "+connect_lobby <id>"
let launchLobby = null;
const ci = process.argv.indexOf('+connect_lobby');
if (ci >= 0 && process.argv[ci + 1]) launchLobby = process.argv[ci + 1];

let mainWindow = null, serverPort = 0;
const relay = { lobby: null, isHost: false, owner: null, me: null, wc: null };
const emit = m => { const wc = relay.wc && !relay.wc.isDestroyed() ? relay.wc : mainWindow && mainWindow.webContents; if (wc) wc.send('steam:event', m); };
// v1.2.3: snapshots and inputs go unreliable (deflated, split into pieces when big); see p2pwire.cjs
const { packMessage, Assembler } = require('./p2pwire.cjs');
const UNRELIABLE = 0, asm = new Map();
// v1.2.9: traffic counters per remote player for the network window: [bytes, packets, messages, split messages, failed sends] each way
const traffic = new Map(), tr = id => { let t = traffic.get(id); if (!t) traffic.set(id, t = { tx: [0, 0, 0, 0, 0], rx: [0, 0], last: null, rtt: [], sz: [] }); return t; };
// v1.2.9: sizes of the unreliable messages (snapshots, AMON fields) sent to each player over the last 5 s: p95 / max in the network window
const szStats = a => { const now = Date.now(); while (a.length && now - a[0][0] > 5000) a.shift(); const v = a.map(x => x[1]).sort((x, y) => x - y); return v.length ? { p95: v[Math.floor(v.length * 0.95)], max: v[v.length - 1] } : null; };
// v1.2.9: a wire-level ping between the two desktop apps (answered here, not by the page), once a second: the round trip
// over Steam alone. The game's own ping also waits for both pages to get to the message, so a busy or slow PC inflates
// it; the network window shows both, which tells a slow connection from a slow computer.
const WPING = 5, WPONG = 6;
function wirePing(id) {
  const b = Buffer.alloc(9); b[0] = WPING; b.writeDoubleLE(performance.now(), 1);
  try { client.networking.sendP2PPacket(BigInt(id), UNRELIABLE, b); } catch { /* ignore */ }
}
function wireRtt(id) { const r = tr(id).rtt.slice().sort((a, b) => a - b); return r.length ? Math.round(r[r.length >> 1]) : null; }
const sendTo = (id, o, unreliable) => {
  try {
    const pk = packMessage(o, !unreliable), t = tr(id).tx;
    t[2]++; if (pk.length > 1) t[3]++;
    let b = 0; for (const p of pk) { b += p.buf.length; t[0] += p.buf.length; t[1]++; if (!client.networking.sendP2PPacket(BigInt(id), p.reliable ? RELIABLE : UNRELIABLE, p.buf)) t[4]++; }
    if (unreliable && relay.isHost) { const z = tr(id).sz; z.push([Date.now(), b]); if (z.length > 400) z.shift(); }
  } catch (e) { console.warn('[steam] send failed', e); }
};
// Rates since the last call (the page asks about once a second while the network window is open), plus Steam's own view
// of each connection (relay or direct, bytes waiting to be sent).
function netStats() {
  const now = Date.now(), peers = [];
  for (const [id, t] of traffic) {
    const a = asm.get(id), cur = { at: now, tx: t.tx.slice(), rx: t.rx.slice(), split: a ? a.split : 0, lost: a ? a.splitLost : 0 }, l = t.last || { at: now - 1000, tx: [0, 0, 0, 0, 0], rx: [0, 0], split: 0, lost: 0 };
    const s = Math.max(0.2, (now - l.at) / 1000); t.last = cur;
    peers.push({ id, rtt: wireRtt(id), up: (cur.tx[0] - l.tx[0]) / s, upP: (cur.tx[1] - l.tx[1]) / s, upM: (cur.tx[2] - l.tx[2]) / s, upSplit: cur.tx[3] - l.tx[3], upFail: cur.tx[4] - l.tx[4],
      down: (cur.rx[0] - l.rx[0]) / s, downP: (cur.rx[1] - l.rx[1]) / s, downSplit: cur.split - l.split, downLost: cur.lost - l.lost, secs: s, upSz: szStats(t.sz), steam: tuneApi ? tuneApi.session(id) : null });
  }
  return { t: 'netStats', tune: tuneInfo, peers };
}
const myId = () => client.localplayer.getSteamId().steamId64.toString();

function leaveLobby() {
  if (relay.lobby) { try { relay.lobby.leave(); } catch { /* already gone */ } }
  relay.lobby = null; relay.isHost = false; relay.owner = null; asm.clear(); traffic.clear();
  if (client) { try { client.localplayer.setRichPresence('connect', null); client.localplayer.setRichPresence('status', null); } catch { /* ignore */ } }
  setPresence(Object.fromEntries(RP_KEYS.map(k => [k, null])));
}

async function handle(m, sender) {
  if (!client) return emit({ t: 'error', message: 'Steam is not running. Start Steam and restart the game.' });
  relay.wc = sender;
  switch (m.t) {
    case 'host': {
      leaveLobby();
      relay.lobby = await client.matchmaking.createLobby(LOBBY_FRIENDS_ONLY, 20);
      relay.isHost = true; relay.me = myId();
      relay.lobby.setData('name', String(m.name || ''));
      client.localplayer.setRichPresence('status', 'Hosting a match');
      client.localplayer.setRichPresence('connect', '+connect_lobby ' + relay.lobby.id.toString());
      setPresence({ bs_lobby: relay.lobby.id.toString(), bs_open: 19, bs_bots: 0, bs_players: 1, bs_max: 20, bs_state: 'lobby', bs_host: String(m.name || '').slice(0, 20) });
      emit({ t: 'hosted', code: relay.lobby.id.toString(), id: 'host', steamName: client.localplayer.getName() });
      break;
    }
    case 'join': {
      leaveLobby();
      relay.lobby = await client.matchmaking.joinLobby(BigInt(m.code));
      relay.isHost = false; relay.me = myId();
      relay.owner = relay.lobby.getOwner().steamId64.toString();
      client.localplayer.setRichPresence('status', 'In a match');
      sendTo(relay.owner, { t: '_hello', name: m.name, token: m.token });
      emit({ t: 'joined', code: String(m.code), id: relay.me });
      break;
    }
    case 'toAll':
      if (relay.isHost && relay.lobby) for (const mem of relay.lobby.getMembers()) {
        const id = mem.steamId64.toString();
        if (id !== relay.me) sendTo(id, { t: 'msg', from: 'host', msg: m.msg });
      }
      break;
    case 'toPeer': case 'toPeerU': if (relay.isHost) { const o = { t: 'msg', from: 'host', msg: m.msg }; for (const id of Array.isArray(m.ids) ? m.ids : [m.id]) sendTo(id, o, m.t === 'toPeerU'); } break;   // (v1.2.9: ids: the same message to several players)
    case 'toHost': case 'toHostU': if (relay.owner) sendTo(relay.owner, { t: 'msg', msg: m.msg }, m.t === 'toHostU'); break;
    case 'kick': if (relay.isHost) sendTo(m.id, { t: 'kicked', reason: m.reason }); break;
    case 'meta': {
      if (!relay.isHost || !relay.lobby || !m.meta) break;
      const mt = m.meta;
      if ('started' in mt) { relay.lobby.setData('started', mt.started ? '1' : '0'); setPresence({ bs_state: mt.started ? 'match' : 'lobby' }); client.localplayer.setRichPresence('status', mt.started ? 'In a match' : 'Hosting a match'); }
      if ('open' in mt) setPresence({ bs_open: Math.max(0, mt.open | 0), bs_bots: Math.max(0, mt.bots | 0), bs_players: Math.max(0, mt.players | 0), bs_max: mt.max || 20 });
      break;
    }
    case 'list': emit({ t: 'rooms', rooms: [] }); break;
    case 'netStats': if (sender && !sender.isDestroyed()) sender.send('steam:event', netStats()); break;
    case 'invite': if (relay.lobby) client.overlay.activateInviteDialog(relay.lobby.id); break;
    case 'leave': leaveLobby(); break;
  }
}

let pollTimer = null, timeEndPeriod = null, lastWirePing = 0;
if (client) {
  // v1.2.6: Windows rounds timers up to its 15.6 ms system tick unless the process asks for 1 ms itself, so the poll below
  // really ran every ~16 ms (adding ~8 ms to every snapshot and input). Best-effort: if this fails, timers stay as before.
  if (process.platform === 'win32') {
    try {
      const winmm = require('koffi').load('winmm.dll');
      const begin = winmm.func('unsigned int __stdcall timeBeginPeriod(unsigned int uPeriod)'), end = winmm.func('unsigned int __stdcall timeEndPeriod(unsigned int uPeriod)');
      if (begin(1) === 0) timeEndPeriod = end;   // 0 = TIMERR_NOERROR
    } catch (e) { console.warn('[steam] timer resolution:', e && e.message); }
  }
  // Incoming packets: every poll drains everything Steam has queued and hands it to the page (v1.2.9: in one message, not one each)
  pollTimer = setInterval(() => {
    let n; const out = [];
    while ((n = client.networking.isP2PPacketAvailable()) > 0) {
      const p = client.networking.readP2PPacket(n);
      const from = p.steamId.steamId64.toString(), t = tr(from).rx; t[0] += p.data.length; t[1]++;
      if (p.data[0] === WPING && p.data.length === 9) { const b = Buffer.from(p.data); b[0] = WPONG; try { client.networking.sendP2PPacket(BigInt(from), UNRELIABLE, b); } catch { /* ignore */ } continue; }
      if (p.data[0] === WPONG && p.data.length === 9) { const r = tr(from).rtt; r.push(performance.now() - p.data.readDoubleLE(1)); if (r.length > 5) r.shift(); continue; }
      let a = asm.get(from); if (!a) asm.set(from, a = new Assembler());
      const o = a.take(p.data); if (!o) continue;
      if (o.msg && typeof o.msg === 'object' && !Array.isArray(o.msg)) o.msg._sz = a.lastSize;   // (v1.2.9: wire size, network window)
      if (!relay.lobby) continue;
      if (relay.isHost) {
        if (o.t === '_hello') out.push({ t: 'peerJoin', id: from, name: String(o.name || 'Player').slice(0, 20), token: String(o.token || '').slice(0, 40) });
        else if (o.t === 'msg') out.push({ t: 'msg', from, msg: o.msg }); // sender id comes from Steam, not the packet
      } else if (from === relay.owner && (o.t === 'msg' || o.t === 'kicked')) out.push(o);
    }
    if (out.length) emit(out.length === 1 ? out[0] : { t: '_batch', l: out });
    const now = Date.now();
    if (relay.lobby && now - lastWirePing > 1000) {
      lastWirePing = now;
      if (relay.isHost) { for (const id of traffic.keys()) if (id !== relay.me) wirePing(id); } else if (relay.owner) wirePing(relay.owner);
    }
  }, 2);
  client.callback.register(CB.P2PSessionRequest, ({ remote }) => {
    if (relay.lobby) client.networking.acceptP2PSession(remote);
  });
  client.callback.register(CB.LobbyChatUpdate, ({ lobby, user_changed, member_state_change }) => {
    if (!relay.lobby || lobby !== relay.lobby.id || member_state_change === ENTERED) return;
    const id = user_changed.toString();
    if (relay.isHost) emit({ t: 'peerLeave', id });
    else if (id === relay.owner) { emit({ t: 'hostLeft' }); leaveLobby(); }
  });
  // Friend accepted an invite (or clicked "Join game") while the game is open
  client.callback.register(CB.GameLobbyJoinRequested, ({ lobby_steam_id }) => {
    if (mainWindow) mainWindow.webContents.send('steam:event', { t: '_invite', lobby: lobby_steam_id.toString() });
  });
}

ipcMain.handle('steam:info', () => ({
  available: !!client, error: steamError, appId: cfg.appId,
  name: client ? client.localplayer.getName() : null,
  launchLobby: (() => { const l = launchLobby; launchLobby = null; return l; })(),
}));
ipcMain.on('steam:send', (e, m) => {
  if (m && m.t === 'friends') { // answered straight to the asking window; never touches the lobby relay
    const r = !client ? { ok: false, error: 'Steam is not running', friends: [] } : friendsApi ? friendsApi.list(cfg.appId) : { ok: false, error: 'friends module missing', friends: [] };
    if (!e.sender.isDestroyed()) e.sender.send('steam:event', { t: 'friends', ...r });
    return;
  }
  handle(m, e.sender).catch(err => emit({ t: 'error', message: 'Steam: ' + (err && err.message || err) })); });
ipcMain.on('app:newWindow', () => createWindow(false));
ipcMain.on('app:quit', () => shutdown());
// v1.2.10: automatic updates (electron/updater.cjs). The game window asks for the state when it loads and gets live status after.
const updater = require('./updater.cjs');
// v1.2.16 Suggestions (electron/suggest.cjs)
const suggest = require('./suggest.cjs');
ipcMain.handle('app:suggest', async (_e, s) => {
  try { const r = await suggest.submit(app.getPath('documents'), s || {}); if (r.url) await shell.openExternal(r.url); return { saved: r.saved, uploaded: !!r.uploaded, opened: !!r.url }; }
  catch (err) { return { error: String(err && err.message || err) }; }
});
let updState = global.blockshotUpdateApplied ? (global.blockshotUpdateApplied.ok ? { state: 'applied', version: global.blockshotUpdateApplied.version } : { state: 'error', error: 'install: ' + global.blockshotUpdateApplied.error }) : null;
const updSend = st => { updState = st; for (const w of BrowserWindow.getAllWindows()) { try { w.webContents.send('app:update', st); } catch { /* closing */ } } };
ipcMain.handle('app:updateState', () => ({ enabled: updater.enabled(app.isPackaged), version: updater.localVersion(), ...(updState || {}) }));
ipcMain.on('app:updateCheck', () => updater.check({ packaged: app.isPackaged, electronVersion: process.versions.electron, onStatus: updSend }));
ipcMain.on('app:updateRestart', () => { app.relaunch(); shutdown(); });
// v1.2.10: the network log (F3 in game) is saved here and shown in Explorer
ipcMain.handle('app:saveLog', (_e, name, text) => {
  try {
    const dir = path.join(app.getPath('documents'), 'Blockshot3D', 'netlogs'), file = path.join(dir, path.basename(String(name || 'netlog.txt')).replace(/[^\w.-]/g, '_'));
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, String(text || ''));
    shell.showItemInFolder(file);
    return { ok: true, path: file };
  } catch (e) { return { ok: false, error: e && e.message }; }
});

// v1.2.11: settings and key bindings are also kept in Documents/Blockshot3D/settings.json. Browser storage belongs to the
// page's address, so when port 3000 was taken and the game started on another port everything looked reset; the file
// doesn't care, and it survives reinstalls and is easy to back up or copy to another PC.
const settingsFile = () => path.join(app.getPath('documents'), 'Blockshot3D', 'settings.json');
let setPending = null, setTimer = null;
function flushSettings() {
  clearTimeout(setTimer); setTimer = null;
  if (setPending == null) return;
  const f = settingsFile(), text = setPending; setPending = null;
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', text); fs.renameSync(f + '.tmp', f); }
  catch (e) { console.warn('[settings] could not save', e && e.message); }
}
ipcMain.on('app:settingsRead', e => { flushSettings(); try { e.returnValue = fs.readFileSync(settingsFile(), 'utf8'); } catch { e.returnValue = null; } });
ipcMain.on('app:settingsWrite', (_e, text) => { setPending = String(text || ''); if (!setTimer) setTimer = setTimeout(flushSettings, 400); });
ipcMain.handle('app:settingsShow', () => { flushSettings(); const f = settingsFile(); if (fs.existsSync(f)) shell.showItemInFolder(f); return f; });

function createWindow(isMain = true) {
  const win = new BrowserWindow({
    width: 1400, height: 860, backgroundColor: '#121826', title: 'Blockshot 3D', autoHideMenuBar: true, icon: path.join(__dirname, 'icons', 'icon.png'),   // v28: the default character's face
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },   // v30: the intro plays with sound straight away   // v30: a minimized host keeps the match running
  });
  win.loadURL(`http://127.0.0.1:${serverPort}/`);
  // v1.2.16: coming back from alt+tab / minimize: repaint and tell the page, so it rechecks its size and graphics
  for (const ev of ['focus', 'restore', 'show']) win.on(ev, () => { try { win.webContents.invalidate(); win.webContents.send('app:refocus'); } catch { /* closing */ } });
  if (isMain) { mainWindow = win; win.on('closed', () => { mainWindow = null; leaveLobby(); }); }
  return win;
}

// v28: quitting (title Quit button, window X, Game > Quit, Alt+F4) ends the whole process. Steam's overlay and its timers
// (plus the built-in server's sockets) could keep the process alive with no window, which locked the game folder on Windows.
let stopServer = null, quitting = false;
function shutdown() {
  if (quitting) return;
  quitting = true;
  try { flushSettings(); } catch { /* ignore */ }
  try { leaveLobby(); } catch { /* ignore */ }
  clearInterval(pollTimer);
  try { if (timeEndPeriod) timeEndPeriod(1); } catch { /* ignore */ }
  timeEndPeriod = null;
  try { stopServer && stopServer(); } catch { /* ignore */ }
  for (const w of BrowserWindow.getAllWindows()) { try { w.destroy(); } catch { /* ignore */ } }
  app.exit(0);
  setTimeout(() => process.exit(0), 1500).unref();   // last resort if app.exit is held up
}

app.whenReady().then(async () => {
  const srv = await import(pathToFileURL(path.join(ROOT, 'server.js')).href);
  const { startServer } = srv; stopServer = srv.stopServer;
  // Listen on the local network (port 3000 if it's free) so PCs on the same network can open the game in a browser and join.
  // Windows asks once whether to allow this; if the network isn't usable we fall back to this PC only.
  for (const opt of [{ port: 3000, host: '0.0.0.0' }, { port: 0, host: '0.0.0.0' }, { port: 0, host: '127.0.0.1' }]) {
    try { serverPort = await startServer({ ...opt, quiet: true }); break; } catch { /* try the next option */ }
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Game', submenu: [
      { label: 'New test window (play multiplayer against yourself)', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow(false) },
      { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }, { role: 'quit' },
    ],
  }]));
  createWindow(true);
  setTimeout(() => updater.check({ packaged: app.isPackaged, electronVersion: process.versions.electron, onStatus: updSend }), 800);   // v1.2.10: look for an update once the game is up (v1.2.16: right away; on the menus it installs and restarts itself, main.js updScreen)
});
app.on('window-all-closed', () => shutdown());
app.on('before-quit', () => shutdown());
