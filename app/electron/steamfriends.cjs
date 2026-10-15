// Steam friends who are hosting Blockshot 3D with a free seat.
// steamworks.js has no friends-list API, so this calls the Steam flat API (ISteamFriends) directly
// through koffi, using the steam_api64.dll that steamworks.js already loaded into this process.
// Everything here is best-effort: if anything is missing, list() just returns [] and the menu says so.
const path = require('path');

const FLAG_IMMEDIATE = 0x04;               // k_EFriendFlagImmediate: regular friends
let api = null, loadError = '';

function libPath() {
  const dir = path.dirname(require.resolve('steamworks.js'));
  if (process.platform === 'win32') return path.join(dir, 'dist', 'win64', 'steam_api64.dll');
  if (process.platform === 'darwin') return path.join(dir, 'dist', 'osx', 'libsteam_api.dylib');
  return path.join(dir, 'dist', 'linux64', 'libsteam_api.so');
}

// opts.lib lets the headless test point at a stand-in library.
function load(opts = {}) {
  if (api) return api;
  try {
    const koffi = require('koffi');
    const lib = koffi.load(opts.lib || libPath());
    // struct FriendGameInfo_t { CGameID m_gameID; uint32 m_unGameIP; uint16 m_usGamePort; uint16 m_usQueryPort; CSteamID m_steamIDLobby; }
    const FriendGameInfo = koffi.struct('FriendGameInfo_t', { gameID: 'uint64', ip: 'uint32', port: 'uint16', queryPort: 'uint16', lobby: 'uint64' });
    let getFriends = null;
    for (const v of ['v017', 'v018', 'v016']) { // interface accessor name depends on the SDK version
      try { getFriends = lib.func(`void *SteamAPI_SteamFriends_${v}()`); break; } catch { /* try the next one */ }
    }
    if (!getFriends) throw new Error('no SteamFriends accessor in steam_api');
    api = {
      koffi, FriendGameInfo,
      self: getFriends,
      count: lib.func('int SteamAPI_ISteamFriends_GetFriendCount(void *self, int flags)'),
      byIndex: lib.func('uint64 SteamAPI_ISteamFriends_GetFriendByIndex(void *self, int i, int flags)'),
      name: lib.func('const char *SteamAPI_ISteamFriends_GetFriendPersonaName(void *self, uint64 id)'),
      game: lib.func('bool SteamAPI_ISteamFriends_GetFriendGamePlayed(void *self, uint64 id, _Out_ FriendGameInfo_t *info)'),
      rp: lib.func('const char *SteamAPI_ISteamFriends_GetFriendRichPresence(void *self, uint64 id, const char *key)'),
      reqRp: (() => { try { return lib.func('void SteamAPI_ISteamFriends_RequestFriendRichPresence(void *self, uint64 id)'); } catch { return null; } })(),
    };
  } catch (e) {
    loadError = String(e && e.message || e);
    api = null;
  }
  return api;
}

// Returns [{ id, name, lobby, open, bots, players, max, started, host }] for friends running this game
// whose host advertises at least one free seat (an empty slot or a bot a human can replace).
function list(appId, opts = {}) {
  const a = load(opts);
  if (!a) return { ok: false, error: loadError || 'Steam friends are not available', friends: [] };
  const out = [];
  try {
    const self = a.self();
    if (!self) return { ok: false, error: 'Steam friends interface is unavailable', friends: [] };
    const n = Math.min(2000, a.count(self, FLAG_IMMEDIATE));
    for (let i = 0; i < n; i++) {
      const id = BigInt(a.byIndex(self, i, FLAG_IMMEDIATE));
      const info = {};
      if (!a.game(self, id, info)) continue;
      // CGameID: the app id sits in the low 24 bits
      if (Number(BigInt(info.gameID) & 0xffffffn) !== Number(appId)) continue;
      if (a.reqRp) a.reqRp(self, id);   // keeps their rich presence fresh for the next refresh
      const rp = k => { const v = a.rp(self, id, k); return v == null ? '' : String(v); };
      const lobby = rp('bs_lobby') || (BigInt(info.lobby) ? BigInt(info.lobby).toString() : '');
      if (!lobby || !/^\d{5,20}$/.test(lobby)) continue;           // not hosting (or not Blockshot: e.g. someone playing real Spacewar)
      const open = parseInt(rp('bs_open'), 10), bots = parseInt(rp('bs_bots'), 10) || 0;
      if (!(open > 0)) continue;                                   // full, or not advertising seats
      out.push({
        id: id.toString(), name: String(a.name(self, id) || 'Friend'), lobby, open, bots,
        players: parseInt(rp('bs_players'), 10) || 0, max: parseInt(rp('bs_max'), 10) || 20,
        started: rp('bs_state') === 'match', host: rp('bs_host') || '',
      });
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), friends: out };
  }
  return { ok: true, friends: out };
}

module.exports = { list, load, _reset: () => { api = null; loadError = ''; } };
