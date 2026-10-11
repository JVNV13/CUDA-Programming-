'use strict';
// CUDA Learning Platform — zero-dependency Node server.
// Public: read the tree + notes. Editors (signed in): create / edit / move / delete.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONTENT_FILE = path.join(DATA, 'content.json');
const USERS_FILE = path.join(DATA, 'users.json');
fs.mkdirSync(DATA, { recursive: true });

const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const save = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2)); fs.renameSync(t, f); };
const uid = () => crypto.randomBytes(5).toString('hex');

/* ---------- users ---------- */
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  try {
    const [s, h] = stored.split(':');
    const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
    return crypto.timingSafeEqual(a, Buffer.from(h, 'hex'));
  } catch { return false; }
}

let users = load(USERS_FILE, {});

// CLI:  node server.js adduser <name> <password>   |   node server.js deluser <name>
if (process.argv[2] === 'adduser') {
  const [u, p] = process.argv.slice(3);
  if (!u || !p) { console.log('usage: node server.js adduser <username> <password>'); process.exit(1); }
  users[u] = hashPw(p); save(USERS_FILE, users);
  console.log(`Saved editor "${u}".`); process.exit(0);
}
if (process.argv[2] === 'deluser') {
  const u = process.argv[3];
  if (!users[u]) { console.log('No such user.'); process.exit(1); }
  delete users[u]; save(USERS_FILE, users);
  console.log(`Removed "${u}".`); process.exit(0);
}
if (!Object.keys(users).length) {
  const pw = crypto.randomBytes(6).toString('base64url');
  users.admin = hashPw(pw); save(USERS_FILE, users);
  console.log('\n  First run: created editor account\n    username: admin\n    password: ' + pw +
    '\n  Add teammates with:  node server.js adduser <name> <password>\n');
}

/* ---------- content ---------- */
const WELCOME = `## Welcome

This site is empty on purpose. Sign in as an **editor** (top right) and build the structure yourself:

- Use **Add Topic** to create a top-level folder.
- Use the **+** next to a folder to add notes or sub-folders inside it, at any depth.
- Drag items in the sidebar to reorder them or move them into other folders.

## Writing lessons

Lessons are written in Markdown, including code:

\`\`\`cuda
__global__ void add(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) c[i] = a[i] + b[i];
}
\`\`\`

You can delete this note once you have your own.
`;

let nodes = load(CONTENT_FILE, null);
if (!nodes) {
  nodes = [{ id: uid(), type: 'note', title: 'Welcome', parentId: null, order: 0, content: WELCOME, updated: Date.now() }];
  save(CONTENT_FILE, nodes);
}
const persist = () => save(CONTENT_FILE, nodes);
const find = id => nodes.find(n => n.id === id);
const kids = pid => nodes.filter(n => n.parentId === pid).sort((a, b) => a.order - b.order);
const renumber = pid => kids(pid).forEach((n, i) => (n.order = i));
// is `id` inside the subtree rooted at `root` (or equal to it)?
const inSubtree = (id, root) => { for (let n = find(id); n; n = find(n.parentId)) if (n.id === root) return true; return false; };
const pathOf = n => { const p = []; for (let c = n; c; c = find(c.parentId)) p.unshift(c.title); return p; };
const meta = n => ({ id: n.id, type: n.type, title: n.title, parentId: n.parentId, order: n.order });

/* ---------- sessions ---------- */
const sessions = new Map(); // token -> { user, exp }
const SESSION_MS = 7 * 24 * 3600 * 1000;
const attempts = new Map(); // ip -> { n, reset }

function cookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return o;
}
function sessionUser(req) {
  const t = cookies(req).sid; const s = t && sessions.get(t);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(t); return null; }
  return s.user;
}

/* ---------- helpers ---------- */
const send = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};
const fail = (res, code, msg) => send(res, code, { error: msg });
function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 2e6) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}
const cleanTitle = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 120);

/* ---------- API ---------- */
async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  const user = sessionUser(req);

  if (m === 'GET' && p === '/api/me') return send(res, 200, { user });
  if (m === 'GET' && p === '/api/tree') return send(res, 200, nodes.map(meta));
  if (m === 'GET' && p === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (q.length < 2) return send(res, 200, []);
    const out = [];
    for (const n of nodes) {
      if (n.type !== 'note') continue;
      const t = n.title.toLowerCase().indexOf(q), c = (n.content || '').toLowerCase().indexOf(q);
      if (t < 0 && c < 0) continue;
      let snippet = '';
      if (c >= 0) snippet = n.content.slice(Math.max(0, c - 40), c + 80).replace(/\s+/g, ' ');
      out.push({ id: n.id, title: n.title, path: pathOf(n).slice(0, -1).join(' / '), snippet, score: t >= 0 ? 0 : 1 });
    }
    out.sort((a, b) => a.score - b.score);
    return send(res, 200, out.slice(0, 10));
  }
  let mm;
  if (m === 'GET' && (mm = p.match(/^\/api\/nodes\/(\w+)$/))) {
    const n = find(mm[1]); if (!n) return fail(res, 404, 'Not found');
    return send(res, 200, { ...meta(n), content: n.content || '', updated: n.updated || null, path: pathOf(n) });
  }

  if (m === 'POST' && p === '/api/login') {
    const ip = req.socket.remoteAddress; const now = Date.now();
    let a = attempts.get(ip); if (!a || a.reset < now) a = { n: 0, reset: now + 15 * 60000 };
    if (a.n >= 10) return fail(res, 429, 'Too many attempts. Try again later.');
    const b = await body(req);
    const stored = users[String(b.username || '')];
    // always run a hash so timing doesn't reveal valid usernames
    const ok = stored ? checkPw(String(b.password || ''), stored) : (checkPw('x', hashPw('y')), false);
    if (!ok) { a.n++; attempts.set(ip, a); return fail(res, 401, 'Wrong username or password.'); }
    attempts.delete(ip);
    const token = crypto.randomBytes(24).toString('base64url');
    sessions.set(token, { user: b.username, exp: now + SESSION_MS });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { user: b.username },
      { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}` });
  }
  if (m === 'POST' && p === '/api/logout') {
    const t = cookies(req).sid; if (t) sessions.delete(t);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // everything below needs an editor
  if (m !== 'GET') {
    if (!user) return fail(res, 401, 'Sign in to edit.');
    if (!(req.headers['content-type'] || '').includes('application/json')) return fail(res, 415, 'JSON only.');
  }

  if (m === 'POST' && p === '/api/nodes') {
    const b = await body(req);
    const type = b.type === 'folder' ? 'folder' : 'note';
    const title = cleanTitle(b.title); if (!title) return fail(res, 400, 'Title required.');
    const parentId = b.parentId || null;
    if (parentId) { const par = find(parentId); if (!par || par.type !== 'folder') return fail(res, 400, 'Parent must be a folder.'); }
    const n = { id: uid(), type, title, parentId, order: kids(parentId).length, updated: Date.now() };
    if (type === 'note') n.content = '';
    nodes.push(n); persist();
    return send(res, 201, meta(n));
  }
  if (m === 'PUT' && (mm = p.match(/^\/api\/nodes\/(\w+)$/))) {
    const n = find(mm[1]); if (!n) return fail(res, 404, 'Not found');
    const b = await body(req);
    if (b.title !== undefined) { const t = cleanTitle(b.title); if (!t) return fail(res, 400, 'Title required.'); n.title = t; }
    if (b.content !== undefined && n.type === 'note') {
      if (typeof b.content !== 'string' || b.content.length > 500000) return fail(res, 400, 'Content too large.');
      n.content = b.content;
    }
    n.updated = Date.now(); persist();
    return send(res, 200, { ...meta(n), updated: n.updated });
  }
  if (m === 'POST' && (mm = p.match(/^\/api\/nodes\/(\w+)\/move$/))) {
    const n = find(mm[1]); if (!n) return fail(res, 404, 'Not found');
    const b = await body(req);
    let parentId = b.parentId || null; const beforeId = b.beforeId || null;
    if (beforeId) { const bn = find(beforeId); if (!bn) return fail(res, 400, 'Bad target.'); parentId = bn.parentId; }
    if (parentId) {
      const par = find(parentId);
      if (!par || par.type !== 'folder') return fail(res, 400, 'Target must be a folder.');
      if (inSubtree(parentId, n.id)) return fail(res, 400, "Can't move a folder into itself.");
    }
    const oldParent = n.parentId;
    const sibs = kids(parentId).filter(x => x.id !== n.id);
    let idx = beforeId ? sibs.findIndex(x => x.id === beforeId) : sibs.length;
    if (idx < 0) idx = sibs.length;
    sibs.splice(idx, 0, n);
    n.parentId = parentId;
    sibs.forEach((x, i) => (x.order = i));
    if (oldParent !== parentId) renumber(oldParent);
    persist();
    return send(res, 200, { ok: true });
  }
  if (m === 'DELETE' && (mm = p.match(/^\/api\/nodes\/(\w+)$/))) {
    const n = find(mm[1]); if (!n) return fail(res, 404, 'Not found');
    const doomed = new Set(nodes.filter(x => inSubtree(x.id, n.id)).map(x => x.id));
    nodes = nodes.filter(x => !doomed.has(x.id));
    renumber(n.parentId); persist();
    return send(res, 200, { removed: doomed.size });
  }
  return fail(res, 404, 'Not found');
}

/* ---------- static files ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/index.html';
  const file = path.join(PUB, path.normalize(rel));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; script-src 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else { res.writeHead(405); res.end(); }
  } catch (e) {
    if (!res.headersSent) fail(res, 400, e.message || 'Bad request');
  }
}).listen(PORT, () => console.log(`CUDA Learn running at http://localhost:${PORT}`));
