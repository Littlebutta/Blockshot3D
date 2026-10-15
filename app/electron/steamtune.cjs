// v1.2.9: Steam networking settings and connection info that steamworks.js doesn't expose, through the Steam flat API
// (koffi + the steam_api64.dll steamworks.js already loaded into this process, like steamfriends.cjs).
// - tune(): raises Steam's send-rate limit. Steam's networking sends no faster than SendRateMin (default 128 KB/s per
//   connection, no bandwidth estimate above it) and queues the rest, so a burst (a big snapshot, the level, several
//   players) waited in that queue and every later message (snapshots, pings) arrived late. Each value is only set
//   after Steam itself names it (GetConfigValueInfo), so a different SDK numbering can't set the wrong thing.
// - session(id): ISteamNetworking::GetP2PSessionState for the network window (relay or direct, bytes/packets queued).
// Everything is best-effort: any failure leaves today's behaviour and the window just shows less.
const path = require('path');

// ESteamNetworkingConfigValue (steamnetworkingtypes.h) and the names Steam reports for them
const CFG = { SendRateMin: 10, SendRateMax: 11 };
const WANT = { SendRateMin: 512 * 1024, SendRateMax: 4 * 1024 * 1024 };
const GLOBAL = 1, INT32 = 1;   // k_ESteamNetworkingConfig_Global, k_ESteamNetworkingConfig_Int32
let api = null, loadError = '', tuned = null;

function libPath() {
  const dir = path.dirname(require.resolve('steamworks.js'));
  if (process.platform === 'win32') return path.join(dir, 'dist', 'win64', 'steam_api64.dll');
  if (process.platform === 'darwin') return path.join(dir, 'dist', 'osx', 'libsteam_api.dylib');
  return path.join(dir, 'dist', 'linux64', 'libsteam_api.so');
}
const opt = f => { try { return f(); } catch { return null; } };

function load(o = {}) {
  if (api || loadError) return api;
  try {
    const koffi = require('koffi'), lib = koffi.load(o.lib || libPath());
    // struct P2PSessionState_t { uint8 active, connecting, error, usingRelay; int32 bytesQueued, packetsQueued; uint32 ip; uint16 port; }
    const P2PState = koffi.struct('P2PSessionState_t', { active: 'uint8', connecting: 'uint8', error: 'uint8', relay: 'uint8', bytesQ: 'int32', packetsQ: 'int32', ip: 'uint32', port: 'uint16' });
    api = {
      utils: opt(() => lib.func('void *SteamAPI_SteamNetworkingUtils_SteamAPI_v004()')),
      net: opt(() => lib.func('void *SteamAPI_SteamNetworking_v006()')),
      info: opt(() => lib.func('const char *SteamAPI_ISteamNetworkingUtils_GetConfigValueInfo(void *self, int eValue, _Out_ int *type, _Out_ int *scope)')),
      get: opt(() => lib.func('int SteamAPI_ISteamNetworkingUtils_GetConfigValue(void *self, int eValue, int scope, intptr_t obj, _Out_ int *type, _Out_ int32_t *val, _Inout_ size_t *cb)')),
      set: opt(() => lib.func('bool SteamAPI_ISteamNetworkingUtils_SetGlobalConfigValueInt32(void *self, int eValue, int32_t val)')),
      relay: opt(() => lib.func('void SteamAPI_ISteamNetworkingUtils_InitRelayNetworkAccess(void *self)')),
      state: opt(() => lib.func('bool SteamAPI_ISteamNetworking_GetP2PSessionState(void *self, uint64_t id, _Out_ P2PSessionState_t *st)')),
    };
  } catch (e) { loadError = String(e && e.message || e); api = null; }
  return api;
}

function readInt(a, u, v) {
  if (!a.get) return null;
  const t = [0], val = [0], cb = [4];
  const r = a.get(u, v, GLOBAL, 0, t, val, cb);
  return r > 0 && t[0] === INT32 ? val[0] : null;   // 1 OK, 2 OK (default)
}

// Call once after Steam is up. Returns { ok, before: {name: value}, after: {...}, error } for the network window / log.
function tune(o = {}) {
  if (tuned) return tuned;
  const a = load(o), out = tuned = { ok: false, before: {}, after: {}, error: '' };
  if (!a) { out.error = loadError || 'flat API unavailable'; return out; }
  try {
    const u = a.utils && a.utils();
    if (!u) { out.error = 'no SteamNetworkingUtils'; return out; }
    if (a.relay) opt(() => a.relay(u));   // start the relay network now, not at the first connection
    for (const [name, v] of Object.entries(CFG)) {
      const t = [0], s = [0], real = a.info ? opt(() => a.info(u, v, t, s)) : null;
      if (real !== name) { out.error += `${name}: Steam calls ${v} '${real}'; `; continue; }   // not the value we think: leave it alone
      out.before[name] = readInt(a, u, v);
      if (out.before[name] != null && out.before[name] >= WANT[name]) continue;
      if (a.set && a.set(u, v, WANT[name])) out.after[name] = readInt(a, u, v) ?? WANT[name];
    }
    out.ok = Object.keys(out.after).length > 0 || Object.keys(out.before).length > 0;
  } catch (e) { out.error += String(e && e.message || e); }
  return out;
}

// { relay, connecting, active, bytesQ, packetsQ } for one remote player, or null.
function session(id) {
  const a = api; if (!a || !a.net || !a.state) return null;
  try {
    const n = a.net(); if (!n) return null;
    const st = {};
    if (!a.state(n, BigInt(id), st)) return null;
    return { active: !!st.active, connecting: !!st.connecting, relay: !!st.relay, bytesQ: st.bytesQ | 0, packetsQ: st.packetsQ | 0, error: st.error | 0 };
  } catch { return null; }
}

module.exports = { tune, session, load, CFG, WANT };
