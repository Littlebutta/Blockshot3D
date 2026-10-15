// v1.2.10: puts a built game folder into the update repo (github.com/Littlebutta/Blockshot3D) for electron/updater.cjs.
//   node tools/publish-update.cjs <built resources/app folder> <repo clone>
// Mirrors the folder into <repo>/app (removing files that are gone) and writes <repo>/update/manifest.json with each
// file's SHA-256 and size. Commit and push the repo afterwards; every installed copy picks it up on its next launch.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [src, repo] = process.argv.slice(2).map(p => p && path.resolve(p));
if (!src || !repo || !fs.existsSync(path.join(src, 'package.json'))) { console.error('usage: node tools/publish-update.cjs <resources/app> <repo>'); process.exit(1); }
const SKIP = /^(\.update-|update-manifest\.json$|noupdate$)/;
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const r = rel ? rel + '/' + e.name : e.name;
  if (!rel && SKIP.test(e.name)) return [];
  return e.isDirectory() ? walk(path.join(dir, e.name), r) : e.isFile() ? [r] : [];
});
const files = walk(src).sort(), out = path.join(repo, 'app');
fs.rmSync(out, { recursive: true, force: true });
const man = { version: JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version, built: new Date().toISOString(), files: {} };
try { man.electron = JSON.parse(fs.readFileSync(path.join(src, '..', '..', 'version'), 'utf8')); } catch { try { man.electron = fs.readFileSync(path.join(src, '..', '..', 'version'), 'utf8').trim().replace(/^v/, ''); } catch { /* not next to a packaged build */ } }
if (process.env.ELECTRON_VERSION) man.electron = process.env.ELECTRON_VERSION;
let bytes = 0;
for (const r of files) {
  const buf = fs.readFileSync(path.join(src, r)), d = path.join(out, r);
  fs.mkdirSync(path.dirname(d), { recursive: true }); fs.writeFileSync(d, buf);
  man.files[r] = [crypto.createHash('sha256').update(buf).digest('hex'), buf.length]; bytes += buf.length;
}
fs.mkdirSync(path.join(repo, 'update'), { recursive: true });
fs.writeFileSync(path.join(repo, 'update', 'manifest.json'), JSON.stringify(man, null, 1));
console.log(`published ${man.version} (electron ${man.electron || '?'}): ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
