'use strict';
// CUDA Learn — API handler. Works as a Vercel serverless function and under the local dev server.
// Data lives in MongoDB (collections: nodes, users, attempts). Sessions are signed cookies (stateless).

const crypto = require('crypto');
const { MongoClient } = require('mongodb');

/* ---------- config ---------- */
const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB || 'cudalearn';
// Fixed default editor account (can be overridden with env vars if you ever want to).
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'a3r3r3r';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('cuda-learn|' + MONGODB_URI).digest('hex');
const SESSION_MS = 7 * 24 * 3600 * 1000;

/* ---------- database ---------- */
async function connect() {
  if (!MONGODB_URI) throw Object.assign(new Error('MONGODB_URI is not set.'), { status: 500 });
  if (!globalThis.__cudaDb) {
    globalThis.__cudaDb = (async () => {
      const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 });
      await client.connect();
      const db = client.db(DB_NAME);
      const c = { nodes: db.collection('nodes'), users: db.collection('users'), attempts: db.collection('attempts') };
      await c.nodes.createIndex({ parentId: 1, order: 1 });
      await c.attempts.createIndex({ reset: 1 }, { expireAfterSeconds: 0 });
      // first run: seed the editor account and a welcome note
      if (!(await c.users.estimatedDocumentCount())) {
        await c.users.updateOne({ _id: ADMIN_USER }, { $setOnInsert: { hash: hashPw(ADMIN_PASSWORD) } }, { upsert: true });
      }
      if (!(await c.nodes.estimatedDocumentCount())) {
        await c.nodes.insertOne({ _id: uid(), type: 'note', title: 'Welcome', parentId: null, order: 0, content: WELCOME, updated: Date.now() });
      }
      return c;
    })().catch(e => { globalThis.__cudaDb = null; throw e; });
  }
  return globalThis.__cudaDb;
}

const uid = () => crypto.randomBytes(5).toString('hex');
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  try {
    const [s, h] = stored.split(':');
    return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), Buffer.from(h, 'hex'));
  } catch { return false; }
}

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

/* ---------- sessions (signed cookie, no server memory) ---------- */
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeToken(user) {
  const p = Buffer.from(JSON.stringify({ u: user, e: Date.now() + SESSION_MS })).toString('base64url');
  return p + '.' + sign(p);
}
function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [p, s] = tok.split('.');
  const good = Buffer.from(sign(p)), got = Buffer.from(s || '');
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.e > Date.now() ? d.u : null; } catch { return null; }
}
function cookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return o;
}
const sessionUser = req => readToken(cookies(req).sid);

/* ---------- helpers ---------- */
const send = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};
const fail = (res, code, msg) => send(res, code, { error: msg });
async function body(req) {
  if (req.body !== undefined && req.body !== null) { // Vercel pre-parses JSON bodies
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString() : String(req.body) || '{}'); } catch { throw new Error('Bad JSON'); }
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 2e6) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('Bad JSON')); } });
    req.on('error', reject);
  });
}
const cleanTitle = t => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 120);
const metaOf = n => ({ id: n._id, type: n.type, title: n.title, parentId: n.parentId, order: n.order });
const META_PROJ = { projection: { content: 0, updated: 0 } };
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// whole tree (metadata only) — small, so structural operations are done in memory
const allMeta = c => c.nodes.find({}, META_PROJ).toArray();
const kidsOf = (all, pid) => all.filter(n => n.parentId === (pid || null)).sort((a, b) => a.order - b.order);
const byIdIn = (all, id) => all.find(n => n._id === id);
function inSubtree(all, id, root) { for (let n = byIdIn(all, id); n; n = byIdIn(all, n.parentId)) if (n._id === root) return true; return false; }
function pathOf(all, n) { const p = []; for (let x = n; x; x = byIdIn(all, x.parentId)) p.unshift(x.title); return p; }
const writeOrders = (c, list) => list.length ? c.nodes.bulkWrite(list.map((n, i) => ({ updateOne: { filter: { _id: n._id }, update: { $set: { order: i } } } }))) : null;

/* ---------- API ---------- */
async function api(req, res, url) {
  const m = req.method, p = url.pathname.replace(/\/+$/, '') || '/';
  const user = sessionUser(req);
  const c = await connect();
  let mm;

  if (m === 'GET' && p === '/api/me') return send(res, 200, { user });
  if (m === 'GET' && p === '/api/tree') return send(res, 200, (await allMeta(c)).map(metaOf));

  if (m === 'GET' && p === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) return send(res, 200, []);
    const rx = new RegExp(escRe(q), 'i');
    const found = await c.nodes.find({ type: 'note', $or: [{ title: rx }, { content: rx }] }).limit(25).toArray();
    const all = await allMeta(c);
    const out = found.map(n => {
      const ci = (n.content || '').search(rx);
      return { id: n._id, title: n.title, path: pathOf(all, n).slice(0, -1).join(' / '),
        snippet: ci >= 0 ? n.content.slice(Math.max(0, ci - 40), ci + 80).replace(/\s+/g, ' ') : '', score: rx.test(n.title) ? 0 : 1 };
    }).sort((a, b) => a.score - b.score).slice(0, 10);
    return send(res, 200, out);
  }
  if (m === 'GET' && (mm = p.match(/^\/api\/nodes\/(\w+)$/))) {
    const n = await c.nodes.findOne({ _id: mm[1] }); if (!n) return fail(res, 404, 'Not found');
    return send(res, 200, { ...metaOf(n), content: n.content || '', updated: n.updated || null, path: pathOf(await allMeta(c), n) });
  }

  if (m === 'POST' && p === '/api/login') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'x').split(',')[0].trim();
    const now = Date.now();
    let a = await c.attempts.findOne({ _id: ip });
    if (a && a.reset < new Date(now)) a = null;
    if (a && a.n >= 10) return fail(res, 429, 'Too many attempts. Try again later.');
    const b = await body(req);
    const username = String(b.username || '');
    const u = await c.users.findOne({ _id: username });
    const ok = u ? checkPw(String(b.password || ''), u.hash) : (checkPw('x', hashPw('y')), false);
    if (!ok) {
      await c.attempts.updateOne({ _id: ip }, { $inc: { n: 1 }, $setOnInsert: { reset: new Date(now + 15 * 60000) } }, { upsert: true });
      return fail(res, 401, 'Wrong username or password.');
    }
    await c.attempts.deleteOne({ _id: ip });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { user: username },
      { 'Set-Cookie': `sid=${makeToken(username)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}` });
  }
  if (m === 'POST' && p === '/api/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  // everything below needs an editor (and must exist in the users collection)
  if (m !== 'GET') {
    if (!user || !(await c.users.findOne({ _id: user }, { projection: { _id: 1 } }))) return fail(res, 401, 'Sign in to edit.');
    if (!(req.headers['content-type'] || '').includes('application/json')) return fail(res, 415, 'JSON only.');
  }

  if (m === 'POST' && p === '/api/nodes') {
    const b = await body(req);
    const type = b.type === 'folder' ? 'folder' : 'note';
    const title = cleanTitle(b.title); if (!title) return fail(res, 400, 'Title required.');
    const parentId = b.parentId || null;
    if (parentId) { const par = await c.nodes.findOne({ _id: String(parentId) }, { projection: { type: 1 } }); if (!par || par.type !== 'folder') return fail(res, 400, 'Parent must be a folder.'); }
    const n = { _id: uid(), type, title, parentId, order: await c.nodes.countDocuments({ parentId }), updated: Date.now() };
    if (type === 'note') n.content = '';
    await c.nodes.insertOne(n);
    return send(res, 201, metaOf(n));
  }
  if (m === 'PUT' && (mm = p.match(/^\/api\/nodes\/(\w+)$/))) {
    const n = await c.nodes.findOne({ _id: mm[1] }, { projection: { type: 1 } }); if (!n) return fail(res, 404, 'Not found');
    const b = await body(req); const set = { updated: Date.now() };
    if (b.title !== undefined) { const t = cleanTitle(b.title); if (!t) return fail(res, 400, 'Title required.'); set.title = t; }
    if (b.content !== undefined && n.type === 'note') {
      if (typeof b.content !== 'string' || b.content.length > 500000) return fail(res, 400, 'Content too large.');
      set.content = b.content;
    }
    await c.nodes.updateOne({ _id: mm[1] }, { $set: set });
    const f = await c.nodes.findOne({ _id: mm[1] }, META_PROJ);
    return send(res, 200, { ...metaOf(f), updated: set.updated });
  }
  if (m === 'POST' && (mm = p.match(/^\/api\/nodes\/(\w+)\/move$/))) {
    const all = await allMeta(c); const n = byIdIn(all, mm[1]); if (!n) return fail(res, 404, 'Not found');
    const b = await body(req);
    let parentId = b.parentId || null; const beforeId = b.beforeId || null;
    if (beforeId) { const bn = byIdIn(all, beforeId); if (!bn) return fail(res, 400, 'Bad target.'); parentId = bn.parentId; }
    if (parentId) {
      const par = byIdIn(all, parentId);
      if (!par || par.type !== 'folder') return fail(res, 400, 'Target must be a folder.');
      if (inSubtree(all, parentId, n._id)) return fail(res, 400, "Can't move a folder into itself.");
    }
    const oldParent = n.parentId;
    const sibs = kidsOf(all, parentId).filter(x => x._id !== n._id);
    let idx = beforeId ? sibs.findIndex(x => x._id === beforeId) : sibs.length;
    if (idx < 0) idx = sibs.length;
    sibs.splice(idx, 0, n);
    await c.nodes.updateOne({ _id: n._id }, { $set: { parentId } });
    await writeOrders(c, sibs);
    if (oldParent !== parentId) await writeOrders(c, kidsOf(all, oldParent).filter(x => x._id !== n._id));
    return send(res, 200, { ok: true });
  }
  if (m === 'DELETE' && (mm = p.match(/^\/api\/nodes\/(\w+)$/))) {
    const all = await allMeta(c); const n = byIdIn(all, mm[1]); if (!n) return fail(res, 404, 'Not found');
    const doomed = all.filter(x => inSubtree(all, x._id, n._id)).map(x => x._id);
    await c.nodes.deleteMany({ _id: { $in: doomed } });
    await writeOrders(c, kidsOf(all, n.parentId).filter(x => x._id !== n._id));
    return send(res, 200, { removed: doomed.length });
  }
  return fail(res, 404, 'Not found');
}

module.exports = async function handler(req, res) {
  try {
    await api(req, res, new URL(req.url, 'http://x'));
  } catch (e) {
    if (!res.headersSent) fail(res, e.status || (/Bad JSON|Too large/.test(e.message) ? 400 : 500),
      e.status || /Bad JSON|Too large/.test(e.message) ? e.message : 'Server error: ' + (e.message || 'unknown'));
  }
};
module.exports.connect = connect;
module.exports.hashPw = hashPw;
