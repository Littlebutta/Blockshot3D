// v1.2.10: launch entry. Installs an update downloaded last time (electron/updater.cjs) before any game file is loaded,
// then starts the game (main.cjs).
let applied = null;
try { applied = require('./updater.cjs').applyStaged(); } catch (e) { applied = { ok: false, error: String(e && e.message || e) }; }
global.blockshotUpdateApplied = applied;
require('./main.cjs');
