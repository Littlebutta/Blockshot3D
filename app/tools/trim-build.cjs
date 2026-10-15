// Removes files the packaged game never uses (keeps the build small).
// Usage: node tools/trim-build.cjs dist/Blockshot3D-win32-x64
const fs = require('fs'), path = require('path');
const out = process.argv[2];
if (!out) { console.error('Pass the packaged folder, e.g. dist/Blockshot3D-win32-x64'); process.exit(1); }
const app = path.join(out, 'resources', 'app');
const nm = path.join(app, 'node_modules');
const rm = p => fs.rmSync(path.join(nm, p), { recursive: true, force: true });
// three.js: keep only the module build, the glTF loader and the post-processing passes
const three = path.join(nm, 'three');
for (const e of fs.readdirSync(three)) if (!['build', 'examples', 'package.json', 'LICENSE'].includes(e)) rm('three/' + e);
for (const e of fs.readdirSync(path.join(three, 'build'))) if (e !== 'three.module.js') rm('three/build/' + e);
for (const e of fs.readdirSync(path.join(three, 'examples'))) if (e !== 'jsm') rm('three/examples/' + e);
// (postprocessing, shaders and math/SimplexNoise are used by the graphics options in public/js/post.js)
for (const e of fs.readdirSync(path.join(three, 'examples/jsm'))) if (!['loaders', 'postprocessing', 'shaders', 'math'].includes(e)) rm('three/examples/jsm/' + e);
for (const e of fs.readdirSync(path.join(three, 'examples/jsm/math'))) if (e !== 'SimplexNoise.js') rm('three/examples/jsm/math/' + e);
for (const e of fs.readdirSync(path.join(three, 'examples/jsm/loaders'))) if (e !== 'GLTFLoader.js') rm('three/examples/jsm/loaders/' + e);
// steamworks.js: keep only the Windows binaries
for (const d of ['linux64', 'osx']) rm('steamworks.js/dist/' + d);
// koffi (reads the Steam friends list): keep only the Windows x64 binary
const kb = path.join(nm, 'koffi', 'build', 'koffi');
if (fs.existsSync(kb)) for (const e of fs.readdirSync(kb)) if (e !== 'win32_x64') rm('koffi/build/koffi/' + e);
for (const e of ['src', 'doc', 'vendor']) rm('koffi/' + e);
// type definitions and empty leftovers from dev tools
for (const e of fs.readdirSync(nm)) {
  if (['three', 'ws', 'steamworks.js', 'koffi'].includes(e)) continue;
  rm(e);
}
fs.copyFileSync(path.join(app, 'tools', 'HOW-TO-PLAY.txt'), path.join(out, 'HOW TO PLAY.txt'));
const appId = JSON.parse(fs.readFileSync(path.join(app, 'steam.config.json'), 'utf8')).appId;
fs.writeFileSync(path.join(out, 'steam_appid.txt'), String(appId));
console.log('Trimmed', out);
