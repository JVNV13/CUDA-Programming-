/* Small, safe Markdown renderer + code highlighter (no dependencies).
   Everything is HTML-escaped first; only a fixed set of tags is produced. */
(function (root) {
  'use strict';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

  function safeUrl(u) {
    u = u.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return /^(https?|mailto):/i.test(u) ? u : '#';
    return u;
  }

  /* ---------- inline ---------- */
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => `<img alt="${a}" src="${safeUrl(u)}">`);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => {
      u = safeUrl(u);
      const ext = /^https?:/i.test(u) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${u}"${ext}>${t}</a>`;
    });
    s = s.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
    s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_(?!\s)(.+?)(?<!\s)_(?![_\w])/g, '$1<em>$2</em>');
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  }

  /* ---------- code highlighting ---------- */
  const C_KW = new Set(('if else for while do return break continue switch case default struct class union enum typedef const constexpr static extern inline volatile void int float double char unsigned signed long short bool true false sizeof new delete template typename namespace using auto nullptr NULL public private protected this try catch throw include define').split(' '));
  const PY_KW = new Set(('def class return if elif else for while in not and or is import from as with try except finally raise lambda yield pass break continue None True False global nonlocal async await').split(' '));
  const JS_KW = new Set(('function const let var return if else for while do break continue switch case default new delete this class extends import from export async await try catch throw typeof instanceof null undefined true false of in').split(' '));
  const C_TYPES = /^(size_t|int8_t|int16_t|int32_t|int64_t|uint\d+_t|float[234]|int[234]|uint[234]|double[234]|half|__half|cudaError_t|cudaStream_t|cudaEvent_t|dim3|std|string|vector)$/;
  const CUDA_X = /^(__\w+__|cuda\w+|threadIdx|blockIdx|blockDim|gridDim|warpSize|atomic\w+|__syncthreads|__shfl\w*)$/;

  function highlight(code, lang) {
    lang = (lang || '').toLowerCase();
    const clike = ['c', 'cpp', 'c++', 'cc', 'cu', 'cuh', 'cuda', 'h', 'hpp', 'java'].includes(lang);
    const py = ['py', 'python'].includes(lang);
    const js = ['js', 'javascript', 'ts', 'typescript'].includes(lang);
    if (!clike && !py && !js) return esc(code);
    const kw = clike ? C_KW : py ? PY_KW : JS_KW;
    const re = clike || js
      ? /(\/\/.*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(^[ \t]*#[ \t]*\w+)|\b(\d[\w.]*)\b|\b([A-Za-z_]\w*)\b|(<<<|>>>)/gm
      : /(#.*)|("""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|()\b(\d[\w.]*)\b|\b([A-Za-z_]\w*)\b|()/gm;
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const t = m[0], e = esc(t);
      if (m[1]) out += `<span class="tk-c">${e}</span>`;
      else if (m[2]) out += `<span class="tk-s">${e}</span>`;
      else if (m[3]) out += `<span class="tk-p">${e}</span>`;
      else if (m[4]) out += `<span class="tk-n">${e}</span>`;
      else if (m[5]) {
        if (clike && CUDA_X.test(t)) out += `<span class="tk-x">${e}</span>`;
        else if (kw.has(t)) out += `<span class="tk-k">${e}</span>`;
        else if (clike && C_TYPES.test(t)) out += `<span class="tk-t">${e}</span>`;
        else out += e;
      } else if (m[6]) out += `<span class="tk-x">${e}</span>`;
      else out += e;
      last = m.index + t.length;
      if (t.length === 0) re.lastIndex++;
    }
    return out + esc(code.slice(last));
  }

  function codeBlock(code, lang) {
    const label = lang || 'text';
    return `<div class="code"><div class="code-head"><span>${esc(label)}</span><button type="button" class="copy">Copy</button></div><pre><code>${highlight(code, lang)}</code></pre></div>`;
  }

  /* ---------- lists ---------- */
  const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  function renderList(items) {
    let html = '', stack = [];
    for (const it of items) {
      while (stack.length && it.indent < stack[stack.length - 1].indent) html += '</li></' + stack.pop().tag + '>';
      const top = stack[stack.length - 1];
      if (!top || it.indent > top.indent) {
        const tag = it.ordered ? 'ol' : 'ul';
        html += `<${tag}>`; stack.push({ indent: it.indent, tag });
      } else html += '</li>';
      let text = it.text, cls = '';
      const t = text.match(/^\[( |x|X)\]\s+(.*)$/);
      if (t) { cls = ' class="task"'; text = `<input type="checkbox" disabled${t[1] !== ' ' ? ' checked' : ''}> ` + inline(t[2]); }
      else text = inline(text);
      html += `<li${cls}>${text}`;
    }
    while (stack.length) html += '</li></' + stack.pop().tag + '>';
    return html;
  }

  /* ---------- tables ---------- */
  const splitRow = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  /* ---------- blocks ---------- */
  const isBlockStart = l => /^(`{3,}|~{3,})/.test(l) || /^#{1,6}\s/.test(l) || /^>/.test(l) || LIST_RE.test(l) || /^(\s*[-*_]\s*){3,}$/.test(l);

  function md(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = []; let i = 0, m;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) { i++; continue; }

      if ((m = l.match(/^(`{3,}|~{3,})\s*([\w+#.-]*)/))) {
        const fence = m[1], lang = m[2]; const buf = []; i++;
        while (i < lines.length && !lines[i].startsWith(fence)) buf.push(lines[i++]);
        i++; out.push(codeBlock(buf.join('\n'), lang)); continue;
      }
      if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        const n = m[1].length; out.push(`<h${n} id="${esc(slug(m[2]))}">${inline(m[2])}</h${n}>`); i++; continue;
      }
      if (/^(\s*[-*_]\s*){3,}$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (/^>/.test(l)) {
        const buf = [];
        while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${md(buf.join('\n'))}</blockquote>`); continue;
      }
      if (l.includes('|') && i + 1 < lines.length && SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        const head = splitRow(l); const aligns = splitRow(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
        i += 2; const rows = [];
        while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) rows.push(splitRow(lines[i++]));
        const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c || '')}</${tag}>`;
        out.push('<table><thead><tr>' + head.map((c, k) => cell('th', c, k)).join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + head.map((_, k) => cell('td', r[k], k)).join('') + '</tr>').join('') + '</tbody></table>');
        continue;
      }
      if (LIST_RE.test(l)) {
        const items = [];
        while (i < lines.length) {
          const lm = lines[i].match(LIST_RE);
          if (lm) { items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: /\d/.test(lm[2]), text: lm[3] }); i++; }
          else if (/^\s+\S/.test(lines[i]) && items.length && !isBlockStart(lines[i])) { items[items.length - 1].text += ' ' + lines[i].trim(); i++; }
          else break;
        }
        out.push(renderList(items)); continue;
      }
      // paragraph
      const buf = [];
      while (i < lines.length && !/^\s*$/.test(lines[i]) && (buf.length === 0 || !isBlockStart(lines[i]))) buf.push(lines[i++]);
      out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, ' ')}</p>`);
    }
    return out.join('\n');
  }

  root.renderMarkdown = md;
  root.escapeHtml = esc;
  if (typeof module !== 'undefined') module.exports = { md, highlight };
})(typeof window !== 'undefined' ? window : globalThis);
