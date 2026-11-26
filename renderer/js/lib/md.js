// Descripciones de mods: Markdown (Modrinth) o HTML (CurseForge) → DOM seguro.
// Todo pasa por un filtro de etiquetas/atributos permitidos: nunca se ejecuta HTML de terceros tal cual.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(t, shared) {
  const top = !shared;
  const stash = shared || [];
  const keep = html => `\u0000${stash.push(html) - 1}\u0000`;
  t = t.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  t = t.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?[^)]*\)/g, (_, alt, url) => keep(`<img alt="${esc(alt)}" src="${esc(url)}">`));
  t = t.replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?[^)]*\)/g, (_, text, url) => keep(`<a href="${esc(url)}">${inline(text, stash)}</a>`));
  t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`)
       .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
       .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
       .replace(/~~([^~]+)~~/g, '<del>$1</del>')
       .replace(/(^|[\s(])(https:\/\/[^\s<)]+)/g, (m, p, url) => `${p}<a href="${url}">${url}</a>`);
  if (!top) return t; // los marcadores se resuelven una sola vez, al final del nivel superior
  // los marcadores pueden estar anidados (imagen dentro de enlace): se resuelve hasta que no queden
  for (let n = 0; n < 6 && /\u0000\d+\u0000/.test(t); n++) t = t.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i] ?? '');
  return t;
}

export function mdToHtml(src) {
  const lines = String(src).replace(/\r/g, '').split('\n');
  const out = [];
  const isBlock = l => /^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s|\s*<)/.test(l) || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(l);
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    let m;
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`); continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l), items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
    }
    if (/^\s*</.test(l)) { // bloque HTML: pasa tal cual (luego se filtra)
      const buf = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
      out.push(buf.join('\n')); continue;
    }
    if (l.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] || '')) { // tabla
      const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(l); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(row(lines[i++]));
      out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && (!isBlock(lines[i]) || !buf.length)) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

const TAGS = new Set('p br hr h1 h2 h3 h4 h5 h6 strong b em i u s del strike code pre blockquote ul ol li a img table thead tbody tr th td div span center details summary kbd sup sub'.split(' '));
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'svg', 'video', 'audio', 'noscript', 'template']);
const httpsUrl = u => { try { const x = new URL(u, 'https://x.invalid/'); return x.protocol === 'https:' && x.host !== 'x.invalid' ? x.href : null; } catch { return null; } };

function clean(node, parent) {
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { parent.append(document.createTextNode(n.nodeValue)); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName.toLowerCase();
    if (DROP.has(tag)) continue;
    if (!TAGS.has(tag)) { clean(n, parent); continue; } // etiqueta desconocida: se queda el contenido
    const el = document.createElement(tag);
    if (tag === 'a') {
      const href = httpsUrl(n.getAttribute('href'));
      if (href) { el.dataset.href = href; el.setAttribute('role', 'link'); el.tabIndex = 0; el.title = href; }
    } else if (tag === 'img') {
      const src = httpsUrl(n.getAttribute('src'));
      if (!src) continue;
      el.src = src; el.alt = n.getAttribute('alt') || ''; el.loading = 'lazy';
      for (const a of ['width', 'height']) { const v = parseInt(n.getAttribute(a), 10); if (v > 0 && v < 4000) el.setAttribute(a, v); }
    } else if (tag === 'th' || tag === 'td') {
      for (const a of ['colspan', 'rowspan']) { const v = parseInt(n.getAttribute(a), 10); if (v > 0 && v < 50) el.setAttribute(a, v); }
    }
    clean(n, el);
    parent.append(el);
  }
}

// Devuelve un nodo listo para insertar. Los enlaces se abren en el navegador del sistema.
export function renderBody(body, format) {
  const html = format === 'markdown' ? mdToHtml(body) : String(body || '');
  const doc = new DOMParser().parseFromString(html, 'text/html'); // documento inerte: no ejecuta nada
  const box = document.createElement('div');
  box.className = 'prose';
  clean(doc.body, box);
  const open = e => {
    const a = e.target.closest('[data-href]');
    if (!a || (e.type === 'keydown' && e.key !== 'Enter')) return;
    e.preventDefault();
    window.api.openExternal(a.dataset.href).catch(() => {});
  };
  box.addEventListener('click', open);
  box.addEventListener('keydown', open);
  return box;
}
