// Blockshot 3D server
// - Serves the game (public/), card folders (cards/), sounds (sounds/) and art (art/)
// - GET  /api/cards  : scans cards/ and returns every card.json it finds
// - POST /api/cards  : saves a new card folder (only from this computer)
// - GET  /api/info   : LAN addresses so the host can share them
// - WebSocket /ws    : room relay. One browser hosts (runs the simulation), others join.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { validateCard } from './public/js/cards.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const MOUNTS = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/')],
  ['/cards/', path.join(ROOT, 'cards/')],
  ['/sounds/', path.join(ROOT, 'sounds/')],
  ['/art/', path.join(ROOT, 'art/')],
  ['/', path.join(ROOT, 'public/')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};

function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function listCards() {
  const dir = path.join(ROOT, 'cards');
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const folder = e.name;
    const file = path.join(dir, folder, 'card.json');
    try {
      const card = JSON.parse(await fsp.readFile(file, 'utf8'));
      let imageUrl = null;
      const candidates = [card.image, 'art.png', 'art.jpg', 'art.webp'].filter(Boolean);
      for (const c of candidates) {
        const p = path.join(dir, folder, path.basename(c));
        if (fs.existsSync(p)) { imageUrl = `/cards/${encodeURIComponent(folder)}/${encodeURIComponent(path.basename(c))}`; break; }
      }
      out.push({ folder, card, imageUrl });
    } catch (err) {
      out.push({ folder, error: fs.existsSync(file) ? `card.json is not valid JSON (${err.message})` : 'missing card.json' });
    }
  }
  out.sort((a, b) => a.folder.localeCompare(b.folder));
  return out;
}

async function saveCard(req, res) {
  if (!isLocal(req)) return sendJson(res, 403, { error: 'Cards can only be saved from the computer running the server.' });
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 6e6) return sendJson(res, 413, { error: 'Upload too large (6 MB max).' }); chunks.push(c); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendJson(res, 400, { error: 'Bad JSON.' }); }
  const card = body.card || {};
  if (typeof card.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(card.id)) return sendJson(res, 400, { error: 'Card id must be 2-48 lowercase letters, digits or dashes.' });
  const problems = validateCard(card);
  if (problems.length) return sendJson(res, 400, { error: problems.join('; ') });
  const folder = path.join(ROOT, 'cards', card.id);
  if (fs.existsSync(folder) && !body.overwrite) return sendJson(res, 409, { error: `A card folder named "${card.id}" already exists.` });
  await fsp.mkdir(folder, { recursive: true });
  if (body.image && typeof body.image.data === 'string') {
    const ext = ({ png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp' })[String(body.image.ext).toLowerCase()];
    if (!ext) return sendJson(res, 400, { error: 'Image must be png, jpg or webp.' });
    await fsp.writeFile(path.join(folder, `art.${ext}`), Buffer.from(body.image.data, 'base64'));
    card.image = `art.${ext}`;
  }
  await fsp.writeFile(path.join(folder, 'card.json'), JSON.stringify(card, null, 2) + '\n');
  sendJson(res, 200, { ok: true, folder: `cards/${card.id}` });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  for (const [prefix, base] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const full = path.normalize(path.join(base, urlPath.slice(prefix.length)));
    if (!full.startsWith(base)) break;
    try {
      const st = await fsp.stat(full);
      if (!st.isFile()) break;
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(full).pipe(res);
      return;
    } catch { break; }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
}

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/api/cards' && req.method === 'GET') return sendJson(res, 200, await listCards());
    if (p === '/api/cards' && req.method === 'POST') return saveCard(req, res);
    if (p === '/api/info') return sendJson(res, 200, { port: server.address().port, lan: server.address().address === '0.0.0.0' ? lanAddresses() : [], canSaveCards: isLocal(req) });
    return serveStatic(req, res);
  } catch (err) { console.error(err); sendJson(res, 500, { error: 'Server error' }); }
});

// ---------------- Room relay ----------------
const rooms = new Map(); // code -> {host, hostName, peers: Map(id->ws), meta}
let nextId = 1;
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c; do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 << 20 });
wss.on('error', () => {});   // listen errors (port in use) are handled by startServer's caller
wss.on('connection', ws => {
  ws.id = 'c' + (nextId++);
  ws.room = null; ws.isHost = false;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const room = ws.room ? rooms.get(ws.room) : null;
    switch (m.t) {
      case 'list':
        send(ws, { t: 'rooms', rooms: [...rooms.entries()].map(([code, r]) => ({ code, host: r.hostName, players: r.meta.players || 1, started: !!r.meta.started, open: r.meta.open ?? 1, bots: r.meta.bots || 0 })) });
        break;
      case 'host': {
        if (ws.room) return;
        const code = makeCode();
        rooms.set(code, { host: ws, hostName: String(m.name || 'Host').slice(0, 20), peers: new Map(), meta: {} });
        ws.room = code; ws.isHost = true;
        send(ws, { t: 'hosted', code, id: 'host' });
        break;
      }
      case 'join': {
        const code = String(m.code || '').toUpperCase().trim();
        const r = rooms.get(code);
        if (!r) return send(ws, { t: 'error', message: `No room with code ${code}.` });
        ws.room = code;
        r.peers.set(ws.id, ws);
        send(ws, { t: 'joined', code, id: ws.id });
        send(r.host, { t: 'peerJoin', id: ws.id, name: String(m.name || 'Player').slice(0, 20), token: String(m.token || '').slice(0, 40) });
        break;
      }
      case 'meta': if (room && ws.isHost) room.meta = { ...room.meta, ...m.meta }; break;
      case 'toAll': if (room && ws.isHost) { const s = JSON.stringify({ t: 'msg', from: 'host', msg: m.msg }); for (const p of room.peers.values()) if (p.readyState === 1) p.send(s); } break;
      case 'toPeer': case 'toPeerU': if (room && ws.isHost) send(room.peers.get(m.id), { t: 'msg', from: 'host', msg: m.msg }); break;
      case 'toHost': case 'toHostU': if (room && !ws.isHost) send(room.host, { t: 'msg', from: ws.id, msg: m.msg }); break;
      case 'kick': if (room && ws.isHost) { const p = room.peers.get(m.id); if (p) { send(p, { t: 'kicked', reason: m.reason || 'Removed by host.' }); room.peers.delete(m.id); p.room = null; } } break;
    }
  });
  ws.on('close', () => {
    const room = ws.room ? rooms.get(ws.room) : null;
    if (!room) return;
    if (ws.isHost) {
      for (const p of room.peers.values()) { send(p, { t: 'hostLeft' }); p.room = null; }
      rooms.delete(ws.room);
    } else if (room.peers.delete(ws.id)) {
      send(room.host, { t: 'peerLeave', id: ws.id });
    }
  });
});

// v28: stop everything so the desktop app's process can end (open sockets would otherwise keep it alive).
export function stopServer() {
  for (const c of wss.clients) { try { c.terminate(); } catch { /* already gone */ } }
  try { wss.close(); } catch { /* not running */ }
  try { server.closeAllConnections && server.closeAllConnections(); server.close(); } catch { /* not listening */ }
}

// Start the server. host '0.0.0.0' allows LAN players (the desktop app uses it too, so PCs on the same network can join in a browser).
export function startServer({ port = PORT, host = '0.0.0.0', quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const onErr = err => reject(err);
    server.once('error', onErr);
    server.listen(port, host, () => {
      server.off('error', onErr);
      const actual = server.address().port;
      if (!quiet) {
        console.log(`\nBlockshot 3D running:`);
        console.log(`  This computer:  http://localhost:${actual}`);
        if (host === '0.0.0.0') for (const a of lanAddresses()) console.log(`  Same network:   http://${a}:${actual}`);
        console.log(`\nPress Ctrl+C to stop.\n`);
      }
      resolve(actual);
    });
  });
}

// Run directly (npm start / node server.js)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(err => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Close the other copy or set PORT to another number.` : err);
    process.exit(1);
  });
}
