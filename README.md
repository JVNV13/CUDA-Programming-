# CUDA Learn

A public CUDA learning site. Anyone can read; signed-in teammates (editors) write lessons in Markdown directly on the site. There is **no fixed structure**: editors build folders and notes (like an Obsidian vault) at any depth.

Stack: static frontend (`public/`) + one serverless API (`lib/app.js`) + **MongoDB**. Runs on Vercel or locally.

## Default editor login

| username | password |
|---|---|
| `admin` | `a3r3r3r` |

Created automatically the first time the site connects to an empty database. **Change it** once the site is public (see below), because this password is in the code.

## 1. Create the database (MongoDB Atlas, free)

1. Create a free cluster at https://www.mongodb.com/atlas.
2. *Database Access* → add a database user (username + password).
3. *Network Access* → add `0.0.0.0/0` (allow from anywhere), because Vercel's IP addresses change.
4. *Connect → Drivers* → copy the connection string. It looks like `mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority`.

## 2. Deploy on Vercel

1. Put this folder in a GitHub repo (`.env` and `node_modules` are already git-ignored).
2. In Vercel: *Add New → Project* → import the repo. No build settings needed (leave framework as "Other").
3. *Settings → Environment Variables*, add:
   - `MONGODB_URI` = your connection string (required)
   - `SESSION_SECRET` = any long random string (recommended; keeps logins secure)
4. Deploy. Open the site, click **Sign In**, use `admin` / `a3r3r3r`.

Everything your teammates write is saved in MongoDB, so everyone sees it immediately.

## Run locally

```bash
npm install
cp .env.example .env      # then put your MONGODB_URI in .env
npm start                 # http://localhost:3000
```

## Editors

```bash
node scripts/adduser.js alice her-password      # add, or reset a password
node scripts/adduser.js admin a-new-password    # change the admin password
node scripts/adduser.js --delete alice
```

(Needs `MONGODB_URI` set in `.env` or the environment. Works against the same database Vercel uses.)

## Using it (as an editor)

1. **Sign In** (top right).
2. **Add Topic** (bottom of the sidebar) creates a top-level folder.
3. The **+** next to a folder: new note, new folder, rename, delete. Folders nest as deep as you like.
4. **⋯** next to a note: rename / delete.
5. Drag items in the sidebar to reorder, or drop onto the middle of a folder to move inside it.
6. Open a note → **Edit** for a Markdown editor with live preview (`Ctrl/⌘ + S` saves).

Markdown supported: headings, bold/italic, nested and task lists, links, images, tables, quotes, inline code, and fenced code blocks with highlighting for `cuda`, `c`, `cpp`, `python`, `js`.

## Files

| Path | What |
|---|---|
| `public/` | the website (HTML, CSS, JS) |
| `api/[...path].js` | Vercel entry for all `/api/*` calls |
| `lib/app.js` | the API: MongoDB, login, folders and notes |
| `server.js` | local dev server |
| `scripts/adduser.js` | manage editors |
| `vercel.json` | security headers |

## Notes

- Sign-in uses a signed cookie (no server memory), so it works across Vercel's serverless instances. Signing out clears the cookie on that browser.
- All editors have the same rights, and there is no version history.
