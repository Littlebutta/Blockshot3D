// v1.2.10 (Devin): automatic updates from the game's GitHub repo (github.com/Littlebutta/Blockshot3D).
// The repo holds the whole game folder (resources/app) under app/ plus update/manifest.json, which lists every file
// with its SHA-256. The game never downloads the whole thing: it only fetches the files whose hash differs from the
// files here (usually a few hundred kB).
//
// - check(): in the background after the game opens. Downloads changed files into app/.update-staging and verifies each
//   one; when all are in, writes ready.json and tells the game window (which offers "Restart to update").
// - applyStaged(): first thing on launch (boot.cjs), before anything is loaded, so no file is in use: moves the staged
//   files into place (keeping a backup until every file is in, so a failure puts everything back).
// Turned off when running from source (not packaged), or with BLOCKSHOT_NO_UPDATE=1 / a file named "noupdate" in the app folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = 'Littlebutta/Blockshot3D', BRANCH = 'main';
const APP = path.join(__dirname, '..');
const STAGE = path.join(APP, '.update-staging'), BACKUP = path.join(APP, '.update-backup');
const LOCAL_MANIFEST = path.join(APP, 'update-manifest.json');
const SKIP = /^(\.update-|update-manifest\.json$|noupdate$)/;

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const safeRel = p => typeof p === 'string' && p && !path.isAbsolute(p) && !p.split(/[\\/]/).some(s => s === '..' || s === '') && !SKIP.test(p);
const enabled = (packaged) => packaged && process.env.BLOCKSHOT_NO_UPDATE !== '1' && !fs.existsSync(path.join(APP, 'noupdate'));
const BASE = () => process.env.BLOCKSHOT_UPDATE_URL || null;   // testing: a local folder served over http in the repo's layout

async function get(url, ms = 15000, json = false) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Blockshot3D-updater', 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`${r.status} for ${url}`);
    return json ? await r.json() : Buffer.from(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

// The newest commit on the branch (so files come from one exact version, not a cached mix), or the branch name if the API is unavailable.
async function latestRef() {
  if (BASE()) return null;
  try { const c = await get(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, 8000, true); if (c && /^[0-9a-f]{40}$/.test(c.sha)) return c.sha; } catch { /* rate limited or offline */ }
  return BRANCH;
}
const rawUrl = (ref, rel) => BASE() ? `${BASE()}/${rel}` : `https://raw.githubusercontent.com/${REPO}/${ref}/${rel.split('/').map(encodeURIComponent).join('/')}`;

function localVersion() { try { return JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version; } catch { return '?'; } }

let busy = false, readyInfo = null;
async function check({ packaged, electronVersion, onStatus = () => {} } = {}) {
  if (busy || !enabled(packaged)) return null;
  busy = true;
  try {
    if (readyInfo) { onStatus({ state: 'ready', ...readyInfo }); return readyInfo; }
    const ref = await latestRef();
    const man = JSON.parse((await get(rawUrl(ref, 'update/manifest.json'), 10000)).toString('utf8'));
    if (!man || !man.files || typeof man.files !== 'object') throw new Error('bad manifest');
    if (man.electron && electronVersion && man.electron.split('.')[0] !== electronVersion.split('.')[0]) {
      onStatus({ state: 'full', version: man.version, note: 'This update needs a fresh download of the game.' }); return null;
    }
    // what's different here
    const todo = [];
    for (const [rel, [hash, size]] of Object.entries(man.files)) {
      if (!safeRel(rel)) continue;
      let have = null; try { have = sha256(fs.readFileSync(path.join(APP, rel))); } catch { /* missing */ }
      if (have !== hash) todo.push({ rel, hash, size });
    }
    let old = {}; try { old = JSON.parse(fs.readFileSync(LOCAL_MANIFEST, 'utf8')).files || {}; } catch { /* first update */ }
    const remove = Object.keys(old).filter(rel => !(rel in man.files) && safeRel(rel) && fs.existsSync(path.join(APP, rel)));
    if (!todo.length && !remove.length) { fs.writeFileSync(LOCAL_MANIFEST, JSON.stringify(man)); onStatus({ state: 'current', version: man.version }); return null; }
    // download into staging (verified), a few at a time
    fs.rmSync(STAGE, { recursive: true, force: true }); fs.mkdirSync(STAGE, { recursive: true });
    const total = todo.reduce((s, f) => s + (f.size || 0), 0); let done = 0, i = 0;
    onStatus({ state: 'downloading', version: man.version, files: todo.length, bytes: total, done: 0 });
    const worker = async () => {
      while (i < todo.length) {
        const f = todo[i++];
        let buf = null;
        for (let a = 0; a < 3 && !buf; a++) { try { const b = await get(rawUrl(ref, 'app/' + f.rel), 60000); if (sha256(b) === f.hash) buf = b; } catch { /* retry */ } }
        if (!buf) throw new Error('could not download ' + f.rel);
        const dst = path.join(STAGE, f.rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, buf);
        done += buf.length; onStatus({ state: 'downloading', version: man.version, files: todo.length, bytes: total, done });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    readyInfo = { version: man.version, from: localVersion(), files: todo.length, bytes: total };
    fs.writeFileSync(path.join(STAGE, 'ready.json'), JSON.stringify({ ...readyInfo, files: todo.map(f => [f.rel, f.hash]), remove, manifest: man }));
    onStatus({ state: 'ready', ...readyInfo });
    return readyInfo;
  } catch (e) {
    try { fs.rmSync(STAGE, { recursive: true, force: true }); } catch { /* ignore */ }
    onStatus({ state: 'error', error: String(e && e.message || e) });
    return null;
  } finally { busy = false; }
}

// Synchronous, at launch before anything else is loaded. Returns what happened (for the log), never throws.
function applyStaged() {
  let r;
  try { r = JSON.parse(fs.readFileSync(path.join(STAGE, 'ready.json'), 'utf8')); } catch { return null; }
  const moved = [];
  const sleep = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ } };
  try {
    fs.rmSync(BACKUP, { recursive: true, force: true });
    const list = [...r.files.map(([rel, hash]) => ({ rel, hash })), ...(r.remove || []).map(rel => ({ rel, del: true }))];
    for (const f of list) {
      if (!safeRel(f.rel)) continue;
      const dst = path.join(APP, f.rel), bak = path.join(BACKUP, f.rel), src = path.join(STAGE, f.rel);
      if (!f.del && sha256(fs.readFileSync(src)) !== f.hash) throw new Error('staged file changed: ' + f.rel);
      const had = fs.existsSync(dst);
      if (had) { fs.mkdirSync(path.dirname(bak), { recursive: true }); fs.copyFileSync(dst, bak); }
      moved.push({ dst, bak, had });
      if (f.del) { fs.rmSync(dst, { force: true }); continue; }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      // the previous run of the game may still be closing and holding a file (Windows): try for a few seconds
      for (let a = 0; ; a++) { try { fs.copyFileSync(src, dst); break; } catch (e) { if (a >= 30) throw e; sleep(200); } }
    }
    fs.writeFileSync(LOCAL_MANIFEST, JSON.stringify(r.manifest));
    fs.rmSync(STAGE, { recursive: true, force: true }); fs.rmSync(BACKUP, { recursive: true, force: true });
    return { ok: true, version: r.version, files: r.files.length };
  } catch (e) {
    for (const m of moved.reverse()) { try { if (m.had) fs.copyFileSync(m.bak, m.dst); else fs.rmSync(m.dst, { force: true }); } catch { /* best effort */ } }
    try { fs.rmSync(BACKUP, { recursive: true, force: true }); } catch { /* ignore */ }
    return { ok: false, error: String(e && e.message || e) };   // staging is kept: the next launch tries again
  }
}

module.exports = { check, applyStaged, enabled, localVersion };
