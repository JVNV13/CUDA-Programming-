# CUDA Learn

A public CUDA learning site. Anyone can read; signed-in teammates (editors) write lessons in Markdown directly on the site. There is **no fixed structure** — editors build folders and notes (like an Obsidian vault) at any depth.

No dependencies, just Node 18+.

## Run

```bash
cd cuda-learn
node server.js
# open http://localhost:3000
```

On the first run an editor account is created and its password is printed in the terminal:

```
username: admin
password: <random>
```

## Add or remove editors

```bash
node server.js adduser alice some-strong-password     # add or reset a password
node server.js deluser alice
```

Restart is not required for these.

## Using it (as an editor)

1. Click **Sign In** (top right).
2. **Add Topic** (bottom of the sidebar) creates a top-level folder.
3. The **+** next to a folder opens a menu: new note, new folder, rename, delete. Folders can nest as deep as you like.
4. **⋯** next to a note: rename / delete.
5. Drag items in the sidebar to reorder them, or drop onto the middle of a folder to move inside it.
6. Open a note and press **Edit** to write Markdown with a live preview. `Ctrl/⌘ + S` saves.

Supported Markdown: headings, bold/italic, lists (nested, tasks), links, images, tables, quotes, inline code, and fenced code blocks (with highlighting for `cuda`, `c`, `cpp`, `python`, `js`).

## Where things live

| Path | What |
|---|---|
| `server.js` | server, API, login |
| `public/` | the website (HTML, CSS, JS) |
| `data/content.json` | all folders and notes (back this up) |
| `data/users.json` | editors (passwords are salted scrypt hashes) |

Set `PORT` and `DATA_DIR` environment variables to change the port or data location.

## Deploying

Put it behind HTTPS (a reverse proxy such as Caddy or nginx that sets `X-Forwarded-Proto: https`) so the login cookie is marked `Secure`. Keep `data/` on persistent storage and out of git if the repo is public.
