// Safe bridge between the game page and the desktop app (Steam + test windows).
const { contextBridge, ipcRenderer, webFrame } = require('electron');
contextBridge.exposeInMainWorld('steamBridge', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('steam:info'),
  send: m => ipcRenderer.send('steam:send', m),
  onEvent: cb => { const f = (_e, m) => { if (m && m.t === '_batch') for (const x of m.l) cb(x); else cb(m); }; ipcRenderer.on('steam:event', f); return () => ipcRenderer.removeListener('steam:event', f); },   // v1.2.9: _batch = everything one poll read, in one message
  newTestWindow: () => ipcRenderer.send('app:newWindow'),
  quit: () => ipcRenderer.send('app:quit'),
  setGfx: g => ipcRenderer.send('app:gfx', g),
  updateState: () => ipcRenderer.invoke('app:updateState'),   // v1.2.10: automatic updates from GitHub
  updateCheck: () => ipcRenderer.send('app:updateCheck'),
  updateRestart: () => ipcRenderer.send('app:updateRestart'),
  setZoom: k => webFrame.setZoomFactor(Math.max(0.5, Math.min(2, +k || 1))),   // v1.2.16 GUI scale
  suggest: s => ipcRenderer.invoke('app:suggest', s),   // v1.2.16
  onRefocus: cb => ipcRenderer.on('app:refocus', () => cb()),   // v1.2.16
  onUpdate: cb => { const f = (_e, m) => cb(m); ipcRenderer.on('app:update', f); return () => ipcRenderer.removeListener('app:update', f); },
  readSettings: () => ipcRenderer.sendSync('app:settingsRead'),   // v1.2.11: Documents/Blockshot3D/settings.json
  writeSettings: text => ipcRenderer.send('app:settingsWrite', text),
  showSettings: () => ipcRenderer.invoke('app:settingsShow'),
  saveLog: (name, text) => ipcRenderer.invoke('app:saveLog', name, text),   // v1.2.10: network log (F3) -> Documents/Blockshot3D/netlogs   // launch-time graphics options (v-sync)
});
