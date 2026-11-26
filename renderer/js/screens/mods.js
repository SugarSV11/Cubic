import { h, clear } from '../lib/dom.js';
import { icons } from '../lib/icons.js';
import { toast, toastError } from '../lib/toast.js';
import { openModal } from '../lib/modal.js';
import { pageHeader, emptyState, skeletons, fmtNum, ic, go } from '../lib/ui.js';
import { cfKeyForm } from '../lib/cfkey.js';
import { tileOf } from '../lib/ui.js';
import { renderBody } from '../lib/md.js';
import { state, LOADER_NAMES } from '../state.js';

const REJECTED = 'CurseForge rechazó';
const KINDS = [['mod', 'Mods'], ['resourcepack', 'Resource packs'], ['shader', 'Shaders']];
const FOLDER_TO_KIND = { mods: 'mod', resourcepacks: 'resourcepack', shaderpacks: 'shader' };
const SORTS = [['relevance', 'Relevancia'], ['downloads', 'Más descargados'], ['newest', 'Más recientes'], ['updated', 'Recién actualizados']];
const keyOf = it => `${it.source}:${it.id}`;

export function render(root, params = {}) {
  const modable = state.instances.filter(i => i.loader !== 'horizon'); // Horizon no admite este contenido
  const inst0 = modable.find(i => i.id === (params.instanceId || state.settings.selectedInstance)) || modable[0] || null;
  const S = {
    source: 'modrinth', kind: FOLDER_TO_KIND[params.kind] || 'mod', instanceId: inst0?.id || '',
    version: inst0?.version || '', loader: inst0 && inst0.loader !== 'vanilla' ? inst0.loader : '',
    category: '', sort: 'relevance', query: '', offset: 0, loading: false, done: false, ticket: 0
  };
  const cards = new Map(); // clave -> { item, el }
  let observer = null, searchTimer = null;

  const listView = h('div', { class: 'mods-list' });
  const detailView = h('div', { class: 'mods-detail', hidden: true });
  const filters = h('div', { class: 'filters card' });
  const srcTabs = h('div', { class: 'tabs tight' });
  const kindSeg = h('div', { class: 'segmented' });
  const topBar = h('div', { class: 'mods-top' }, srcTabs, kindSeg);
  const results = h('div', { class: 'mod-grid' });
  const sentinel = h('div', { class: 'sentinel' });
  const info = h('div', { class: 'results-info muted small' });
  let versionSel, loaderSel, categorySel;

  const instance = () => state.instances.find(i => i.id === S.instanceId) || null;
  const hasKey = () => !!state.settings.hasCurseforgeKey;

  // ---------- cabecera y filtros ----------
  function paintTabs() {
    clear(srcTabs).append(...[['modrinth', 'Modrinth'], ['curseforge', 'CurseForge']].map(([k, l]) =>
      h('button', { class: `tab${S.source === k ? ' active' : ''}`, onclick: () => { S.source = k; S.category = ''; paintTabs(); loadCategories(); newSearch(); } }, l)));
    clear(kindSeg).append(...KINDS.map(([k, l]) =>
      h('button', { class: S.kind === k ? 'sel' : '', onclick: () => { S.kind = k; S.category = ''; paintTabs(); paintFilters(); loadCategories(); newSearch(); } }, l)));
  }

  function paintFilters() {
    const instSel = h('select', { class: 'select', 'aria-label': 'Instancia de destino', onchange: e => {
      S.instanceId = e.target.value; const i = instance();
      if (i) { S.version = i.version; S.loader = i.loader === 'vanilla' ? '' : i.loader; }
      paintFilters(); newSearch();
    } }, state.instances.length
      ? [S.instanceId ? null : h('option', { value: '', selected: true, disabled: true }, 'Ninguna instancia admite mods'), ...state.instances.map(i => h('option', { value: i.id, ...(i.id === S.instanceId ? { selected: true } : {}), ...(i.loader === 'horizon' ? { disabled: true } : {}) }, i.loader === 'horizon' ? `${i.name} (Horizon: sin mods)` : i.name))]
      : [h('option', { value: '' }, 'Sin instancias')]);
    const search = h('input', { class: 'input search', type: 'search', placeholder: `Buscar ${KINDS.find(k => k[0] === S.kind)[1].toLowerCase()}…`, value: S.query, 'aria-label': 'Buscar',
      oninput: e => { S.query = e.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(newSearch, 380); } });
    versionSel = h('select', { class: 'select', 'aria-label': 'Versión de Minecraft', onchange: e => { S.version = e.target.value; newSearch(); } }, h('option', { value: '' }, 'Todas las versiones'));
    loaderSel = S.kind === 'mod' ? h('select', { class: 'select', 'aria-label': 'Loader', onchange: e => { S.loader = e.target.value; newSearch(); } },
      h('option', { value: '' }, 'Todos los loaders'),
      ...['fabric', 'quilt'].map(l => h('option', { value: l, ...(S.loader === l ? { selected: true } : {}) }, LOADER_NAMES[l]))) : null;
    categorySel = h('select', { class: 'select', 'aria-label': 'Categoría', onchange: e => { S.category = e.target.value; newSearch(); } }, h('option', { value: '' }, 'Todas las categorías'));
    const sortSel = h('select', { class: 'select', 'aria-label': 'Ordenar por', onchange: e => { S.sort = e.target.value; newSearch(); } },
      SORTS.map(([k, l]) => h('option', { value: k, ...(S.sort === k ? { selected: true } : {}) }, l)));
    clear(filters).append(
      h('div', { class: 'filter-row' }, h('label', { class: 'target' }, h('small', { class: 'muted' }, 'INSTALAR EN'), instSel), search),
      h('div', { class: 'filter-row' }, versionSel, loaderSel, categorySel, sortSel));
    fillVersions(); fillCategories();
  }

  let versionsCache = null, catsCache = [];
  async function fillVersions() {
    try {
      versionsCache = versionsCache || (await api.versions(!!state.settings.showSnapshots)).list;
      const ids = versionsCache.map(v => v.id);
      if (S.version && !ids.includes(S.version)) versionsCache.unshift({ id: S.version });
      versionSel.append(...versionsCache.map(v => h('option', { value: v.id, ...(v.id === S.version ? { selected: true } : {}) }, v.id)));
    } catch { /* sin conexión: se queda "Todas" */ }
  }
  async function loadCategories() {
    catsCache = [];
    if (S.source === 'curseforge' && !hasKey()) return fillCategories();
    try { catsCache = await api.mods.categories(S.source, S.kind); } catch { /* ignorar */ }
    fillCategories();
  }
  function fillCategories() {
    if (!categorySel) return;
    clear(categorySel).append(h('option', { value: '' }, 'Todas las categorías'), ...catsCache.map(c => h('option', { value: c.id, ...(S.category === c.id ? { selected: true } : {}) }, c.name)));
  }

  // ---------- resultados ----------
  function newSearch() {
    S.ticket++; S.offset = 0; S.done = false; S.loading = false;
    cards.clear(); clear(results); info.textContent = '';
    if (S.source === 'curseforge' && !hasKey()) { clear(results).append(keyGuide()); S.done = true; return; }
    results.append(...skeletons(8, 'sk-card'));
    loadMore(true);
  }

  async function loadMore(first = false) {
    if (S.loading || S.done) return;
    S.loading = true;
    const ticket = S.ticket;
    try {
      const r = await api.mods.search({ source: S.source, kind: S.kind, query: S.query.trim(), version: S.version, loader: S.kind === 'mod' ? S.loader : '',
        category: S.category, sort: S.sort, offset: S.offset, limit: 20, instanceId: S.instanceId || undefined });
      if (ticket !== S.ticket) return; // llegó tarde una búsqueda vieja
      if (first) clear(results);
      let n = 0;
      for (const it of r.hits) { if (!cards.has(keyOf(it))) { const el = card(it, n++); cards.set(keyOf(it), { item: it, el }); results.append(el); } }
      S.offset += r.hits.length;
      S.done = !r.hits.length || S.offset >= r.total;
      info.textContent = r.total ? `${fmtNum(r.total)} resultados` : '';
      if (first && !r.hits.length) results.append(emptyState('search', 'Sin resultados', 'Prueba con otras palabras o quita algún filtro (versión, loader o categoría).'));
    } catch (e) {
      if (ticket !== S.ticket) return;
      if (first && S.source === 'curseforge' && e.message.startsWith(REJECTED)) { clear(results).append(keyGuide(e.message)); S.done = true; S.loading = false; return; }
      if (first) clear(results).append(emptyState('offline', 'No pude cargar los resultados', e.message, h('button', { class: 'btn primary', onclick: newSearch }, 'Reintentar')));
      else toastError(e);
      S.done = true;
    }
    S.loading = false;
    // en pantallas grandes el final puede seguir a la vista y el observador no vuelve a avisar
    requestAnimationFrame(() => {
      if (ticket === S.ticket && !S.done && !listView.hidden && sentinel.isConnected
        && sentinel.getBoundingClientRect().top < window.innerHeight + 500) loadMore();
    });
  }

  function card(it, n = 0) {
    const installed = !!it.installed;
    const actions = installed
      ? h('span', { class: 'chip ok' }, ic('check'), 'Instalado')
      : h('button', { class: 'btn primary sm', onclick: e => { e.stopPropagation(); openInstall(it); } }, ic('download'), 'Instalar');
    return h('article', { class: 'mod-card card hoverable stagger', style: { '--i': n }, tabindex: 0, role: 'button', 'aria-label': it.title,
      onclick: () => openDetail(it), onkeydown: e => { if (e.key === 'Enter') openDetail(it); } },
      modIcon(it.icon, 56),
      h('div', { class: 'mod-main' },
        h('b', { class: 'mod-title' }, it.title),
        h('small', { class: 'muted' }, it.author ? `por ${it.author}` : ''),
        h('p', { class: 'mod-desc' }, it.description || '')),
      h('div', { class: 'mod-foot' }, h('span', { class: 'dl' }, ic('download'), fmtNum(it.downloads || 0)), actions));
  }
  const modIcon = (url, size) => url
    ? h('img', { class: 'mod-icon', width: size, height: size, src: url, alt: '', loading: 'lazy', onerror: e => e.target.replaceWith(h('div', { class: 'mod-icon ph', style: { width: `${size}px`, height: `${size}px` }, html: icons.puzzle })) })
    : h('div', { class: 'mod-icon ph', style: { width: `${size}px`, height: `${size}px` }, html: icons.puzzle });

  // Si no hay key (o fue rechazada) se pide aquí mismo: pegar, probar, guardar y cargar al instante
  function keyGuide(error = '') {
    return h('div', { class: 'key-guide card' },
      h('div', { class: 'empty-ic', html: icons.key }),
      h('h3', {}, 'CurseForge necesita una API key'),
      h('p', { class: 'muted' }, 'Es gratis y se hace una sola vez. Cópiala desde console.curseforge.com → API keys y pégala aquí.'),
      cfKeyForm({ error, onSaved: removed => { if (removed) { newSearch(); return; } loadCategories(); newSearch(); } }));
  }

  // ---------- detalle ----------
  let detailTicket = 0;
  async function openDetail(it) {
    const mine = ++detailTicket;
    listView.hidden = true; topBar.hidden = true; detailView.hidden = false;
    root.parentElement?.scrollTo?.({ top: 0 });
    clear(detailView).append(
      h('button', { class: 'btn ghost', onclick: closeDetail }, ic('back'), 'Volver'),
      h('div', { class: 'card detail-skel' }, ...skeletons(3, 'sk-row')));
    let d;
    try { d = await api.mods.detail(it.source, it.id, S.kind); } catch (e) { if (mine === detailTicket) { toastError(e); closeDetail(); } return; }
    if (mine !== detailTicket) return; // el usuario ya volvió o abrió otro
    const cur = cards.get(keyOf(it))?.item || it;
    const author = it.author || d.author;
    clear(detailView).append(
      h('button', { class: 'btn ghost', onclick: closeDetail }, ic('back'), 'Volver'),
      h('section', { class: 'card d-head' },
        modIcon(d.icon, 88),
        h('div', { class: 'grow' }, h('h1', {}, d.title), h('p', { class: 'muted' }, author ? `por ${author} · ` : '', `${fmtNum(d.downloads || 0)} descargas`), h('p', {}, d.description || '')),
        h('div', { class: 'col gap' },
          cur.installed ? h('span', { class: 'chip ok' }, ic('check'), 'Instalado') : h('button', { class: 'btn primary lg', onclick: () => openInstall({ ...it, title: d.title, icon: d.icon }) }, ic('download'), 'Instalar'),
          d.url ? h('button', { class: 'btn ghost', onclick: () => api.openExternal(d.url).catch(toastError) }, ic('external'), 'Abrir en el navegador') : null)),
      d.gallery.length ? h('section', { class: 'gallery' }, d.gallery.slice(0, 14).map(g =>
        h('img', { src: g.url, alt: g.title || 'Captura', loading: 'lazy', title: g.title || '', tabindex: 0, onclick: () => zoom(g), onkeydown: e => { if (e.key === 'Enter') zoom(g); } }))) : null,
      h('section', { class: 'card card-pad' }, h('h3', {}, 'Descripción'), d.body ? renderBody(d.body, d.bodyFormat) : h('p', { class: 'muted' }, 'Sin descripción.')));
  }
  function closeDetail() { detailTicket++; detailView.hidden = true; listView.hidden = false; topBar.hidden = false; clear(detailView); }
  const zoom = g => openModal({ title: g.title || 'Captura', wide: true, content: h('img', { class: 'zoom', src: g.url, alt: g.title || '' }) });

  // ---------- instalar ----------
  function openInstall(it) {
    const body = h('div', { class: 'install-body' }, ...skeletons(3, 'sk-row'));
    const status = h('p', { class: 'muted small install-status' });
    let chosen = null, rows = [];
    const unsub = api.on('install-progress', p => { status.textContent = p.progress != null ? `${p.text} ${Math.round(p.progress * 100)}%` : p.text; });
    const m = openModal({
      title: `Instalar ${it.title}`, content: h('div', {}, body, status),
      actions: [{ label: 'Cancelar' }, { label: 'Instalar', kind: 'primary', onClick: go2 }],
      onClose: unsub
    });
    const installBtn = m.el.querySelector('.modal-actions .btn.primary');
    installBtn.disabled = true;

    api.mods.compat(it.source, it.id, S.kind).then(list => {
      const ok = list.filter(c => c.ok && !c.installed);
      clear(body);
      if (!state.instances.length) {
        body.append(emptyState('package', 'Aún no tienes instancias', 'Crea una instancia para poder instalar mods.', h('button', { class: 'btn primary', onclick: () => { m.close(); go('instances'); } }, 'Crear instancia')));
        return;
      }
      if (!ok.length) body.append(h('div', { class: 'warn-box' }, h('b', {}, 'Ninguna instancia puede instalarlo ahora.'),
        h('p', { class: 'muted' }, S.kind === 'mod' ? 'Hace falta una instancia con Fabric o Quilt y una versión de Minecraft que este mod soporte.' : 'Ninguna de tus versiones de Minecraft es compatible con este contenido.'),
        h('button', { class: 'btn', onclick: () => { m.close(); go('instances'); } }, 'Ir a Instancias')));
      else body.append(h('p', { class: 'muted' }, '¿En qué instancia lo instalo? Solo se pueden elegir las compatibles.'));
      const preferred = ok.find(c => c.id === S.instanceId) || ok[0];
      chosen = preferred?.id || null;
      rows = state.instances.map(i => {
        const c = list.find(x => x.id === i.id) || { ok: false, reason: 'No se pudo comprobar.' };
        const disabled = !c.ok || c.installed;
        const row = h('button', { type: 'button', class: `pick-row${disabled ? ' disabled' : ''}${chosen === i.id ? ' sel' : ''}`, ...(disabled ? { disabled: true } : {}),
          onclick: () => { chosen = i.id; rows.forEach(r => r.classList.toggle('sel', r === row)); } },
          tileOf(i),
          h('div', { class: 'grow' }, h('b', {}, i.name), h('small', { class: 'muted' }, `Minecraft ${i.version} · ${LOADER_NAMES[i.loader]}`)),
          c.installed ? h('span', { class: 'chip ok' }, ic('check'), 'Ya instalado') : !c.ok ? h('small', { class: 'why' }, c.reason) : h('span', { class: 'chip' }, c.blocked ? 'Descarga manual' : 'Compatible'));
        return row;
      });
      body.append(h('div', { class: 'pick-list' }, rows));
      installBtn.disabled = !chosen;
    }).catch(e => { clear(body).append(h('p', { class: 'form-err' }, e.message)); });

    async function go2(btn) {
      if (!chosen) return false;
      btn.disabled = true; btn.textContent = 'Instalando…';
      try {
        const r = await api.mods.install({ source: it.source, id: it.id, kind: S.kind, instanceId: chosen });
        report(it, r);
        if (r.installed.length || r.skipped.length) markInstalled(it, chosen);
        return true;
      } catch (e) { toastError(e); btn.disabled = false; btn.textContent = 'Instalar'; return false; }
    }
  }

  function report(it, r) {
    const deps = Math.max(0, r.installed.length - (r.installed.length && r.installed[0] ? 1 : 0));
    if (r.installed.length) toast(`${it.title} instalado en ${r.instanceName}${deps ? ` (+${deps} ${deps === 1 ? 'dependencia' : 'dependencias'})` : ''}`);
    else if (r.skipped.length && !r.blocked.length) toast(`${it.title} ya estaba en ${r.instanceName}`, 'info');
    if (r.missing.length) toast(`No encontré versión compatible de ${r.missing.length} ${r.missing.length === 1 ? 'dependencia' : 'dependencias'}. Puede que el mod no funcione.`, 'info', 7000);
    if (r.blocked.length) blockedDialog(r.blocked);
  }
  function blockedDialog(list) {
    openModal({
      title: 'Descarga no permitida desde apps',
      content: h('div', { class: 'form' },
        h('p', { class: 'muted' }, 'El autor de este contenido de CurseForge no permite descargarlo desde programas externos como este launcher. Puedes bajarlo a mano desde su página y ponerlo en la carpeta de la instancia:'),
        ...list.map(b => h('div', { class: 'file-row card' }, h('div', { class: 'file-ic', html: icons.lock }), h('b', { class: 'grow' }, b.title),
          b.url ? h('button', { class: 'btn', onclick: () => api.openExternal(b.url).catch(toastError) }, ic('external'), 'Abrir página') : null))),
      actions: [{ label: 'Entendido', kind: 'primary' }]
    });
  }
  function markInstalled(it, instanceId) {
    if (instanceId !== S.instanceId) return;
    const c = cards.get(keyOf(it));
    if (c) { c.item.installed = true; const el = card(c.item, 0); el.style.animation = 'none'; c.el.replaceWith(el); c.el = el; }
  }

  // ---------- montaje ----------
  root.append(
    pageHeader('Mods', 'Busca e instala mods, resource packs y shaders directamente en tus instancias.'),
    topBar,
    listView, detailView);
  listView.append(filters, info, results, sentinel);
  paintTabs(); paintFilters(); loadCategories(); newSearch();

  // scroll infinito: cuando el final de la lista entra en pantalla, se pide la siguiente página
  observer = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && !listView.hidden) loadMore(); }, { root: document.getElementById('view'), rootMargin: '500px' });
  observer.observe(sentinel);
  return () => { observer.disconnect(); clearTimeout(searchTimer); S.ticket++; };
}
