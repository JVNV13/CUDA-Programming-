'use strict';
// Add / reset an editor:   node scripts/adduser.js <username> <password>
// Remove an editor:        node scripts/adduser.js --delete <username>
const fs = require('fs');
const path = require('path');
try {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
const app = require('../lib/app.js');

(async () => {
  const args = process.argv.slice(2);
  const del = args[0] === '--delete';
  const [u, p] = del ? [args[1]] : args;
  if (!u || (!del && !p)) { console.log('usage: node scripts/adduser.js <username> <password>\n       node scripts/adduser.js --delete <username>'); process.exit(1); }
  const c = await app.connect();
  if (del) { const r = await c.users.deleteOne({ _id: u }); console.log(r.deletedCount ? `Removed "${u}".` : 'No such user.'); }
  else { await c.users.updateOne({ _id: u }, { $set: { hash: app.hashPw(p) } }, { upsert: true }); console.log(`Saved editor "${u}".`); }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
