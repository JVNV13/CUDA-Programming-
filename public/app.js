'use strict';
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = { nodes: [], me: null, cur: null, editing: false, dirty: false, drag: null };
const open = new Set(store.get('open', []));
const byId = id => state.nodes.find(n => n.id === id);
const kids = pid => state.nodes.filter(n => n.parentId === (pid || null)).sort((a, b) => a.order - b.order);

async function api(method, url, body) {
  const write = method !== 'GET';
  const r = await fetch(url, { method, headers: write ? { 'Content-Type': 'application/json' } : {}, body: write ? JSON.stringify(body || {}) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}
const fail = e => toast(e.message || 'Something went wrong');

/* ---------- dialogs ---------- */
function ask(label, value = '') {
  return new Promise(resolve => {
    const dlg = $('#askDlg'), input = $('#askInput');
    $('#askLabel').textContent = label; input.value = value;
    let result = null;
    $('#askForm').onsubmit = e => { e.preventDefault(); result = input.value.trim() || null; dlg.close(); };
    $('#askCancel').onclick = () => dlg.close();
    dlg.onclose = () => resolve(result);
    dlg.showModal(); input.select();
  });
}
function popMenu(anchor, items) {
  document.querySelectorAll('.menu').forEach(m => m.remove());
  const m = el('div', 'menu');
  for (const [label, fn, cls] of items) {
    const b = el('button', cls || '', label); b.onclick = () => { m.remove(); fn(); }; m.append(b);
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0);
}

/* ---------- tree ---------- */
const CHEV = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function renderTree() {
  const nav = $('#tree'); nav.innerHTML = '';
  nav.classList.toggle('editing-on', !!state.me);
  nav.append(branch(null));
  if (!state.nodes.length) nav.append(el('p', 'hint', state.me ? 'Nothing here yet. Use “Add Topic”.' : 'No topics yet.'));
}
function branch(pid) {
  const ul = el('ul');
  const list = kids(pid);
  for (const n of list) ul.append(n.type === 'folder' ? folderEl(n) : noteEl(n));
  if (!list.length && pid && state.me) ul.append(el('li', 'empty', 'empty folder'));
  return ul;
}
function folderEl(n) {
  const li = el('li', 'folder' + (open.has(n.id) ? ' open' : ''));
  const row = el('div', 'pill'); row.dataset.id = n.id;
  row.innerHTML = CHEV; row.append(el('span', '', n.title));
  row.onclick = () => { open.has(n.id) ? open.delete(n.id) : open.add(n.id); store.set('open', [...open]); renderTree(); };
  if (state.me) {
    const b = el('button', 'mini', '+'); b.title = 'Add inside, rename, delete';
    b.onclick = e => { e.stopPropagation(); popMenu(b, [
      ['New note here', () => newNode('note', n.id)],
      ['New folder here', () => newNode('folder', n.id)],
      ['Rename', () => rename(n)],
      ['Delete folder', () => remove(n), 'danger'],
    ]); };
    row.append(b); dnd(row, n);
  }
  li.append(row, branch(n.id));
  return li;
}
function noteEl(n) {
  const li = el('li');
  const row = el('div', 'note-row' + (state.cur && state.cur.id === n.id ? ' active' : '')); row.dataset.id = n.id;
  row.append(el('span', '', n.title));
  row.onclick = () => { location.hash = '#/n/' + n.id; document.body.classList.remove('nav-open'); };
  if (state.me) {
    const b = el('button', 'mini', '⋯'); b.title = 'Rename or delete';
    b.onclick = e => { e.stopPropagation(); popMenu(b, [['Rename', () => rename(n)], ['Delete note', () => remove(n), 'danger']]); };
    row.append(b); dnd(row, n);
  }
  li.append(row);
  return li;
}

/* drag & drop (editors only) */
function clearDrop() { document.querySelectorAll('.drop-in,.drop-before,.drop-after').forEach(e => e.classList.remove('drop-in', 'drop-before', 'drop-after')); }
function zone(e, row, n) {
  const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  if (n.type === 'folder' && y > .25 && y < .75) return 'in';
  return y < .5 ? 'before' : 'after';
}
function dnd(row, n) {
  row.draggable = true;
  row.ondragstart = e => { state.drag = n.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.id); };
  row.ondragend = () => { state.drag = null; clearDrop(); };
  row.ondragover = e => {
    if (!state.drag || state.drag === n.id) return;
    e.preventDefault(); clearDrop(); row.classList.add('drop-' + zone(e, row, n));
  };
  row.ondrop = async e => {
    e.preventDefault(); e.stopPropagation();
    const id = state.drag; clearDrop(); if (!id || id === n.id) return;
    const z = zone(e, row, n); let body;
    if (z === 'in') { body = { parentId: n.id, beforeId: null }; open.add(n.id); store.set('open', [...open]); }
    else if (z === 'before') body = { beforeId: n.id };
    else { const sibs = kids(n.parentId); const nx = sibs[sibs.findIndex(s => s.id === n.id) + 1]; body = nx ? { beforeId: nx.id } : { parentId: n.parentId }; if (nx && nx.id === id) return; }
    try { await api('POST', `/api/nodes/${id}/move`, body); await refresh(); } catch (err) { fail(err); }
  };
}
$('#tree').ondragover = e => { if (state.drag && e.target === $('#tree')) e.preventDefault(); };
$('#tree').ondrop = async e => {
  if (e.target !== $('#tree') || !state.drag) return;
  try { await api('POST', `/api/nodes/${state.drag}/move`, { parentId: null }); await refresh(); } catch (err) { fail(err); }
};

async function refresh() { state.nodes = await api('GET', '/api/tree'); renderTree(); updatePager(); }

async function newNode(type, parentId) {
  const title = await ask(type === 'folder' ? 'Folder name' : 'Note title');
  if (!title) return;
  try {
    const n = await api('POST', '/api/nodes', { type, title, parentId });
    if (parentId) { open.add(parentId); store.set('open', [...open]); }
    await refresh();
    if (type === 'note') { state.startEditing = true; location.hash = '#/n/' + n.id; }
  } catch (e) { fail(e); }
}
async function rename(n) {
  const title = await ask('Rename', n.title);
  if (!title || title === n.title) return;
  try {
    await api('PUT', '/api/nodes/' + n.id, { title });
    if (state.cur && state.cur.id === n.id) state.cur.title = title;
    await refresh(); if (state.cur && !state.editing) paintDoc();
  } catch (e) { fail(e); }
}
async function remove(n) {
  const count = state.nodes.filter(x => { for (let c = x; c; c = byId(c.parentId)) if (c.id === n.id) return true; return false; }).length;
  const msg = n.type === 'folder' && count > 1 ? `Delete “${n.title}” and the ${count - 1} item(s) inside it? This can't be undone.` : `Delete “${n.title}”? This can't be undone.`;
  if (!confirm(msg)) return;
  try {
    await api('DELETE', '/api/nodes/' + n.id);
    const curGone = state.cur && (state.cur.id === n.id || state.nodes.some(x => x.id === state.cur.id && isInside(x, n.id)));
    await refresh();
    if (curGone) { state.cur = null; state.dirty = false; location.hash = '#/'; route(); }
  } catch (e) { fail(e); }
}
function isInside(x, rootId) { for (let c = x; c; c = byId(c.parentId)) if (c.id === rootId) return true; return false; }

/* ---------- reading / pager ---------- */
function flatNotes() {
  const out = [];
  (function walk(pid) { for (const n of kids(pid)) n.type === 'folder' ? walk(n.id) : out.push(n); })(null);
  return out;
}
function updatePager() {
  const list = flatNotes(); const i = state.cur ? list.findIndex(n => n.id === state.cur.id) : -1;
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  const set = (btn, n) => { btn.disabled = !n; btn.title = n ? n.title : ''; btn.querySelector('span').textContent = n ? n.title : ''; btn.onclick = n ? () => (location.hash = '#/n/' + n.id) : null; };
  set($('#prev'), prev); set($('#next'), next);
}
function paintDoc() {
  const n = state.cur, doc = $('#doc'); doc.innerHTML = '';
  if (!n) {
    const msg = state.nodes.some(x => x.type === 'note') ? 'Pick a topic from the sidebar.' : (state.me ? 'No notes yet. Use “Add Topic” to create a folder, then the + next to it to add notes.' : 'No lessons have been published yet.');
    doc.append(el('p', 'empty-state', msg)); document.title = 'CUDA — Learn GPU Programming'; return;
  }
  document.title = n.title + ' · CUDA';
  const head = el('div', 'doc-head'); head.append(el('h1', 'title', n.title));
  if (state.me) { const b = el('button', 'edit-btn', 'Edit'); b.onclick = () => startEdit(); head.append(b); }
  const body = el('div', 'md'); body.innerHTML = renderMarkdown(n.content);
  if (!n.content.trim()) body.innerHTML = '<p class="hint">This note is empty.' + (state.me ? ' Click Edit to write it.' : '') + '</p>';
  doc.append(head, body);
  $('#scroll').scrollTop = 0;
}
$('#doc').addEventListener('click', e => {
  const b = e.target.closest('.copy'); if (!b) return;
  const text = b.closest('.code').querySelector('code').textContent;
  navigator.clipboard.writeText(text).then(() => { b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1400); }, () => toast('Copy failed'));
});

/* ---------- routing ---------- */
function confirmLeave() {
  if (state.editing && state.dirty && !confirm('You have unsaved changes. Leave without saving?')) return false;
  if (state.editing) { state.editing = false; state.dirty = false; }
  return true;
}
let lastHash = location.hash;
async function route() {
  const m = location.hash.match(/^#\/n\/(\w+)/);
  if (m) {
    if (state.cur && state.cur.id === m[1] && !state.startEditing && !state.editing) { lastHash = location.hash; return; }
    if (!confirmLeave()) { history.replaceState(null, '', lastHash || '#/'); return; }
    try {
      state.cur = await api('GET', '/api/nodes/' + m[1]); state.editing = false;
      let p = byId(state.cur.parentId); while (p) { open.add(p.id); p = byId(p.parentId); } store.set('open', [...open]);
      renderTree(); updatePager();
      if (state.startEditing && state.me) { state.startEditing = false; startEdit(); } else paintDoc();
    } catch { state.cur = null; renderTree(); updatePager(); paintDoc(); toast('That note no longer exists.'); }
  } else {
    if (!confirmLeave()) { history.replaceState(null, '', lastHash); return; }
    if (!state.cur) { const first = flatNotes()[0]; if (first) { location.hash = '#/n/' + first.id; return; } }
    state.cur = null; renderTree(); updatePager(); paintDoc();
  }
  lastHash = location.hash;
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', e => { if (state.editing && state.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- editor ---------- */
const TOOLS = [
  ['H2', '## ', '', 'Heading'], ['H3', '### ', '', 'Subheading'],
  ['B', '**', '**', 'bold'], ['I', '*', '*', 'italic'], ['`code`', '`', '`', 'code'],
  ['Code block', '```cuda\n', '\n```\n', '// your code'], ['• List', '- ', '', 'item'], ['1. List', '1. ', '', 'item'],
  ['Link', '[', '](https://)', 'text'], ['Quote', '> ', '', 'quote'], ['Table', '| A | B |\n|---|---|\n| 1 | 2 |\n', '', ''],
];
function wrap(ta, before, after, ph) {
  const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || ph;
  ta.setRangeText(before + sel + after, s, e, 'end');
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  ta.focus(); ta.dispatchEvent(new Event('input'));
}
function startEdit() {
  if (!state.me || !state.cur) return;
  state.editing = true; state.dirty = false;
  const n = state.cur, doc = $('#doc'); doc.innerHTML = '';
  const title = el('input', 'title-input'); title.value = n.title; title.maxLength = 120; title.placeholder = 'Title';
  const bar = el('div', 'toolbar'), ta = el('textarea'), pv = el('div', 'md preview');
  ta.value = n.content; ta.spellcheck = false; ta.placeholder = 'Write Markdown here…';
  for (const [label, b, a, ph] of TOOLS) { const btn = el('button', '', label); btn.type = 'button'; btn.onclick = () => wrap(ta, b, a, ph); bar.append(btn); }
  const upd = () => { pv.innerHTML = renderMarkdown(ta.value) || '<p class="hint">Live preview appears here.</p>'; };
  ta.addEventListener('input', () => { state.dirty = true; upd(); });
  title.addEventListener('input', () => (state.dirty = true));
  ta.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
  const grid = el('div', 'edit-grid'); grid.append(ta, pv);
  const actions = el('div', 'actions');
  const saveBtn = el('button', 'primary', 'Save'), cancel = el('button', '', 'Cancel');
  const save = async () => {
    const t = title.value.trim(); if (!t) { toast('Title is required'); return; }
    saveBtn.disabled = true;
    try {
      const r = await api('PUT', '/api/nodes/' + n.id, { title: t, content: ta.value });
      state.cur = { ...n, title: r.title, content: ta.value, updated: r.updated };
      state.editing = false; state.dirty = false; await refresh(); paintDoc(); toast('Saved');
    } catch (e) { fail(e); saveBtn.disabled = false; }
  };
  saveBtn.onclick = save;
  cancel.onclick = () => { if (state.dirty && !confirm('Discard your changes?')) return; state.editing = false; state.dirty = false; paintDoc(); };
  const hint = el('span', 'hint', 'Ctrl/⌘ + S to save');
  actions.append(saveBtn, cancel, hint);
  doc.addEventListener('keydown', function h(e) {
    if (!state.editing) return doc.removeEventListener('keydown', h);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });
  doc.append(title, bar, grid, actions); upd(); ta.focus();
  $('#scroll').scrollTop = 0;
}

/* ---------- auth ---------- */
function paintAuth() {
  const b = $('#auth');
  b.innerHTML = '';
  b.append(el('b', '', state.me ? state.me : 'Sign In'), el('small', '', state.me ? 'sign out' : 'editor'));
  $('#addTopic').hidden = !state.me;
}
$('#auth').onclick = async () => {
  if (state.me) {
    if (!confirmLeave()) return;
    try { await api('POST', '/api/logout', {}); } catch {}
    state.me = null; paintAuth(); renderTree(); if (state.cur) paintDoc(); toast('Signed out');
  } else { $('#loginErr').hidden = true; $('#loginDlg').showModal(); $('#lu').focus(); }
};
$('#loginCancel').onclick = () => $('#loginDlg').close();
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  try {
    const r = await api('POST', '/api/login', { username: $('#lu').value.trim(), password: $('#lp').value });
    state.me = r.user; $('#lp').value = ''; $('#loginDlg').close();
    paintAuth(); renderTree(); if (state.cur) paintDoc(); toast('Signed in as ' + r.user);
  } catch (err) { const p = $('#loginErr'); p.textContent = err.message; p.hidden = false; }
};
$('#addTopic').onclick = () => newNode('folder', null);

/* ---------- search ---------- */
let sTimer, sel = -1;
const results = $('#results'), q = $('#q');
function closeResults() { results.hidden = true; sel = -1; }
async function doSearch() {
  const term = q.value.trim();
  if (term.length < 2) return closeResults();
  try {
    const list = await api('GET', '/api/search?q=' + encodeURIComponent(term));
    results.innerHTML = '';
    if (!list.length) results.append(el('div', 'none', 'No matches'));
    for (const r of list) {
      const b = el('button'); b.append(el('b', '', r.title));
      const sub = [r.path, r.snippet && '…' + r.snippet + '…'].filter(Boolean).join(' — ');
      if (sub) b.append(el('small', '', sub));
      b.onclick = () => { closeResults(); q.value = ''; location.hash = '#/n/' + r.id; };
      results.append(b);
    }
    results.hidden = false; sel = -1;
  } catch {}
}
q.addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(doSearch, 200); });
q.addEventListener('keydown', e => {
  const btns = [...results.querySelectorAll('button')];
  if (e.key === 'Escape') { closeResults(); q.blur(); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!btns.length) return; e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
    btns.forEach((b, i) => b.classList.toggle('sel', i === sel));
  } else if (e.key === 'Enter' && btns.length) { e.preventDefault(); (btns[sel] || btns[0]).click(); }
});
document.addEventListener('click', e => { if (!e.target.closest('.search')) closeResults(); });
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
});

/* ---------- misc UI ---------- */
$('#theme').onclick = () => {
  const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
};
$('#menu').onclick = () => document.body.classList.toggle('nav-open');
$('#scrim').onclick = () => document.body.classList.remove('nav-open');

/* ---------- boot ---------- */
(async function init() {
  try {
    const [nodes, me] = await Promise.all([api('GET', '/api/tree'), api('GET', '/api/me')]);
    state.nodes = nodes; state.me = me.user;
  } catch { toast('Could not reach the server'); }
  paintAuth(); renderTree(); await route(); updatePager();
})();
