import { h, clear } from '../lib/dom.js';
import { icons, instIcon } from '../lib/icons.js';
import { toast, toastError } from '../lib/toast.js';
import { openModal, confirmDialog } from '../lib/modal.js';
import { pageHeader, emptyState, switchEl, fmtSize, skeletons, ic, tileOf } from '../lib/ui.js';
import { state, refreshInstances, LOADER_NAMES } from '../state.js';
import { introCard } from '../lib/intro.js';
import { horizonPanel, HORIZON_VERSION, HORIZON_NOTE, HORIZON_NO_MODS } from '../lib/horizon.js';

const go = (id, params) => window.dispatchEvent(new CustomEvent('sugar:go', { detail: { id, params } }));
const BAD_CHARS = /[\\/:*?"<>|\x00-\x1f]/;

// ---------- crear / editar ----------
export function openInstanceEditor(inst, onDone) {
  const isNew = !inst;
  const data = inst ? { ...inst } : { name: '', version: null, loader: 'vanilla', ram: Math.min(state.settings.ram || 4, Math.max(2, state.totalRam - 2)), icon: state.icons[0] };
  let snapshots = !!state.settings.showSnapshots;

  // nombre por defecto: "1.21.1 Fabric"
  const defaultName = () => `${data.version || ''} ${LOADER_NAMES[data.loader]}`.trim();
  const nameErr = h('div', { class: 'field-err' });
  const verErr = h('div', { class: 'field-err' });
  const formErr = h('div', { class: 'form-err', role: 'alert' });
  const name = h('input', { class: 'input', value: data.name, maxlength: 60, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Nombre de la instancia',
    oninput: e => { data.name = e.target.value; clearErr(nameErr, name); } });
  const syncPlaceholder = () => { name.placeholder = defaultName() || 'Nombre de la instancia'; };
  const clearErr = (el, input) => { el.textContent = ''; input?.classList.remove('bad'); formErr.textContent = ''; };
  const fail = (el, input, msg) => { el.textContent = msg; input?.classList.add('bad'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); input?.focus?.(); };

  const iconRow = h('div', { class: 'icon-pick' });
  const paintIcons = () => { clear(iconRow).append(...state.icons.map(i => h('button', { type: 'button', class: `icon-opt${i === data.icon ? ' sel' : ''}`, 'aria-label': i, onclick: () => { data.icon = i; paintIcons(); }, html: instIcon(i) }))); };
  paintIcons();

  const verSel = h('select', { class: 'select', 'aria-label': 'Versión de Minecraft', onchange: e => { data.version = e.target.value; clearErr(verErr); syncPlaceholder(); syncIntroNote(); } }, h('option', { value: '' }, 'Cargando versiones…'));
  const snapSw = switchEl(snapshots, v => { snapshots = v; loadVersions(); }, 'Mostrar snapshots');
  async function loadVersions() {
    verSel.disabled = true;
    // Horizon solo existe para una versión
    if (data.loader === 'horizon') {
      data.version = HORIZON_VERSION;
      clear(verSel).append(h('option', { value: HORIZON_VERSION, selected: true }, HORIZON_VERSION));
      verErr.textContent = ''; syncPlaceholder(); return;
    }
    try {
      const { list, latest } = await api.versions(snapshots);
      if (data.loader === 'horizon') return; // cambió de loader mientras cargaba
      if (!data.version) data.version = latest;
      if (!list.some(v => v.id === data.version)) list.unshift({ id: data.version, type: 'release' }); // al editar, la versión actual siempre se puede elegir
      clear(verSel).append(...list.map(v => h('option', { value: v.id, ...(v.id === data.version ? { selected: true } : {}) }, v.type === 'snapshot' ? `${v.id} (snapshot)` : v.id)));
      verSel.disabled = false; syncPlaceholder(); syncIntroNote();
    } catch (e) { if (data.loader === 'horizon') return; clear(verSel).append(h('option', { value: '' }, 'Sin conexión')); verErr.textContent = `No pude cargar las versiones: ${e.message}`; }
  }
  loadVersions();

  const loaderRow = h('div', { class: 'segmented' });
  let otherVersion = data.loader === 'horizon' ? null : data.version; // para volver a ella al salir de Horizon
  let iconField, ramField, snapBox;
  const horizonNote = h('div', { class: 'warn-box small' }, h('span', {}, HORIZON_NOTE), h('span', { class: 'muted' }, HORIZON_NO_MODS));
  // aviso: con la intro activada, una instancia Vanilla se juega con Fabric Loader
  const introNote = h('span', { class: 'small muted' }, 'Intro animada activada: esta instancia se jugará con Fabric Loader y los mods de la intro. Puedes desactivarla desde la instancia para volver a Vanilla puro.');
  const syncIntroNote = () => {
    const on = data.logo ?? state.settings.animatedLogo;
    introNote.hidden = !(data.loader === 'vanilla' && on && state.intro.games.includes(data.version));
  };
  const syncLoader = () => {
    const hz = data.loader === 'horizon';
    horizonNote.hidden = !hz;
    syncIntroNote();
    iconField.hidden = hz; ramField.hidden = hz; snapBox.hidden = hz;
  };
  const pickLoader = k => {
    if (k === data.loader) return;
    const was = data.loader;
    if (k === 'horizon') otherVersion = data.version;
    data.loader = k;
    if (was === 'horizon') data.version = otherVersion;
    paintLoaders(); syncLoader(); syncPlaceholder();
    if (k === 'horizon' || was === 'horizon') loadVersions();
  };
  const paintLoaders = () => { clear(loaderRow).append(...Object.entries(LOADER_NAMES).map(([k, v]) => h('button', { type: 'button', class: k === data.loader ? 'sel' : '', onclick: () => pickLoader(k) }, v))); };
  paintLoaders(); syncPlaceholder();

  const maxRam = Math.max(2, state.totalRam - 2);
  data.ram = Math.min(data.ram, maxRam);
  const ramVal = h('b', { class: 'accent' }, `${data.ram} GB`);
  const fill = el => el.style.setProperty('--p', `${((el.value - el.min) / Math.max(1, el.max - el.min)) * 100}%`);
  const ram = h('input', { type: 'range', class: 'range', min: 2, max: maxRam, step: 1, value: data.ram, 'aria-label': 'Memoria RAM', ...(maxRam <= 2 ? { disabled: true } : {}),
    oninput: e => { data.ram = +e.target.value; ramVal.textContent = `${data.ram} GB`; fill(e.target); } });
  fill(ram);

  iconField = h('div', { class: 'field' }, 'Icono', iconRow);
  ramField = h('div', { class: 'field' }, 'Memoria RAM', h('div', { class: 'slider-row' }, ram, ramVal));
  snapBox = h('span', {}, snapSw);
  syncLoader();

  const body = h('div', { class: 'form' },
    h('div', { class: 'field' }, 'Nombre', name, nameErr, h('span', { class: 'small faint' }, 'Si lo dejas vacío se usará el nombre sugerido.')),
    iconField,
    h('div', { class: 'field' }, 'Versión de Minecraft', h('div', { class: 'row gap' }, verSel, snapBox), verErr),
    h('div', { class: 'field' }, 'Loader', loaderRow, h('span', { class: 'small' }, 'Fabric y Quilt permiten mods. Forge y NeoForge no están disponibles todavía.')),
    horizonNote,
    introNote,
    ramField,
    formErr);

  const submit = async () => {
    nameErr.textContent = verErr.textContent = formErr.textContent = ''; name.classList.remove('bad');
    const typed = data.name.trim();
    if (typed && BAD_CHARS.test(typed)) { fail(nameErr, name, 'El nombre no puede llevar estos caracteres:  \\ / : * ? " < > |'); return false; }
    if (!data.version) { fail(verErr, null, 'Elige una versión de Minecraft.'); verSel.focus(); return false; }
    const payload = { ...data, name: typed || defaultName() };
    try {
      const saved = isNew ? await api.instances.create(payload) : await api.instances.update(inst.id, payload);
      await refreshInstances();
      if (isNew) state.settings = await api.setSettings({ selectedInstance: saved.id });
      toast(isNew ? `Instancia “${saved.name}” creada` : 'Cambios guardados');
      onDone?.(saved);
      return true;
    } catch (e) {
      // el error se muestra junto al campo al que pertenece (y siempre visible)
      if (/nombre/i.test(e.message)) fail(nameErr, name, e.message);
      else if (/versi[oó]n/i.test(e.message)) fail(verErr, null, e.message);
      else { formErr.textContent = e.message; formErr.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      return false;
    }
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); modal.el.querySelector('.modal-actions .btn.primary').click(); } });

  const modal = openModal({
    title: isNew ? 'Nueva instancia' : `Editar “${inst.name}”`, content: body,
    actions: [{ label: 'Cancelar' }, { label: isNew ? 'Crear instancia' : 'Guardar', kind: 'primary', onClick: submit }]
  });
  setTimeout(() => name.focus(), 60);
}

// ---------- lista ----------
export function render(root, params) {
  if (params?.open) return renderDetail(root, params.open);
  const grid = h('div', { class: 'inst-grid' });
  function paint() {
    clear(grid);
    state.instances.forEach((i, n) => {
      grid.append(h('button', { class: 'inst-card card hoverable stagger', style: { '--i': n }, onclick: () => go('instances', { open: i.id }) },
        tileOf(i),
        h('b', {}, i.name),
        h('div', { class: 'chips' }, h('span', { class: 'chip' }, i.version), h('span', { class: 'chip' }, LOADER_NAMES[i.loader]), i.loader === 'horizon' ? null : h('span', { class: 'chip' }, `${i.ram} GB`))));
    });
    grid.append(h('button', { class: 'inst-card new hoverable stagger', style: { '--i': state.instances.length }, onclick: () => openInstanceEditor(null, paint) },
      h('div', { class: 'plus', html: icons.plus }), h('b', {}, 'Nueva instancia')));
  }
  paint();
  root.append(pageHeader('Instancias', 'Cada instancia tiene su propia versión, mods, config y mundos.'), grid);
}

// ---------- detalle de una instancia ----------
const TABS = [['mods', 'Mods', 'puzzle'], ['resourcepacks', 'Resource packs', 'palette'], ['shaderpacks', 'Shaders', 'sparkles']];

function renderDetail(root, id) {
  let inst = state.instances.find(i => i.id === id);
  if (!inst) return go('instances');
  let tab = 'mods';
  const head = h('div'), tabsEl = h('div', { class: 'tabs' }), listEl = h('div', { class: 'file-list' });

  function paintHead() {
    clear(head).append(h('div', { class: 'detail-head card' },
      h('button', { class: 'icon-btn', 'aria-label': 'Volver', onclick: () => go('instances'), html: icons.back }),
      tileOf(inst, true),
      h('div', { class: 'grow' }, h('h1', {}, inst.name),
        h('div', { class: 'chips' }, h('span', { class: 'chip' }, `Minecraft ${inst.version}`), h('span', { class: 'chip' }, LOADER_NAMES[inst.loader]), inst.loader === 'horizon' ? null : h('span', { class: 'chip' }, `${inst.ram} GB`))),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary', onclick: async () => { state.settings = await api.setSettings({ selectedInstance: inst.id }); toast(`“${inst.name}” seleccionada para jugar`); go('home'); } }, ic('play'), 'Jugar'),
        !['vanilla', 'horizon'].includes(inst.loader) ? h('button', { class: 'btn', onclick: () => go('mods', { instanceId: inst.id }) }, ic('download'), 'Añadir mods') : null,
        h('button', { class: 'btn ghost', onclick: () => api.instances.open(inst.id).catch(toastError) }, ic('folder'), 'Carpeta'),
        h('button', { class: 'icon-btn', title: 'Editar', 'aria-label': 'Editar', onclick: () => openInstanceEditor(inst, saved => { inst = saved; paintHead(); paintBody(); }), html: icons.edit }),
        h('button', { class: 'icon-btn', title: 'Duplicar', 'aria-label': 'Duplicar', onclick: dup, html: icons.copy }),
        h('button', { class: 'icon-btn danger', title: 'Borrar', 'aria-label': 'Borrar', onclick: del, html: icons.trash }))));
  }

  async function reloadInst() {
    await refreshInstances();
    inst = state.instances.find(i => i.id === inst.id) || inst;
    paintIntro();
  }
  async function dup() {
    try { const c = await api.instances.duplicate(inst.id); await refreshInstances(); toast(`Instancia duplicada como “${c.name}”`); go('instances', { open: c.id }); } catch (e) { toastError(e); }
  }
  async function del() {
    if (!await confirmDialog({ title: 'Borrar instancia', message: `Se borrará “${inst.name}” con todos sus mundos, mods y configuración. Esto no se puede deshacer.`, confirmLabel: 'Borrar para siempre', danger: true })) return;
    try { await api.instances.remove(inst.id); await refreshInstances(); state.settings = (await api.init()).settings; toast('Instancia borrada'); go('instances'); } catch (e) { toastError(e); }
  }

  function paintTabs() {
    clear(tabsEl).append(...TABS.map(([k, l]) => h('button', { class: `tab${k === tab ? ' active' : ''}`, onclick: () => { tab = k; paintTabs(); paintFiles(); } }, l)));
  }

  async function paintFiles() {
    clear(listEl).append(...skeletons(4, 'sk-row'));
    let files;
    try { files = await api.instances.files(inst.id, tab); } catch (e) { return toastError(e); }
    clear(listEl);
    const icon = TABS.find(t => t[0] === tab)[2];
    if (!files.length) {
      listEl.append(emptyState(icon, 'Nada instalado aquí todavía',
        tab === 'mods' && inst.loader === 'vanilla' ? 'Esta instancia es Vanilla. Edítala y elige Fabric o Quilt para usar mods.' : 'Instala desde la pestaña Mods o suelta archivos en la carpeta.',
        h('button', { class: 'btn primary', onclick: () => go('mods', { instanceId: inst.id, kind: tab }) }, 'Buscar para instalar')));
      return;
    }
    files.forEach((f, n) => {
      listEl.append(h('div', { class: `file-row card stagger${f.enabled ? '' : ' off'}`, style: { '--i': n } },
        h('div', { class: 'file-ic', html: icons[icon] }),
        h('div', { class: 'grow' }, h('b', {}, f.name), h('small', { class: 'muted' }, `${f.isDir ? 'Carpeta' : fmtSize(f.size)}${f.source ? ` · ${f.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}` : ''}${f.bundled ? ' · incluido por Cubic' : ''}${f.enabled ? '' : ' · desactivado'}`)),
        switchEl(f.enabled, async () => { try { await api.instances.toggle(inst.id, tab, f.file); await reloadInst(); paintFiles(); } catch (e) { toastError(e); } }),
        h('button', { class: 'icon-btn danger', 'aria-label': 'Eliminar', title: 'Eliminar', html: icons.trash, onclick: async () => {
          if (!await confirmDialog({ title: 'Eliminar archivo', message: `¿Eliminar “${f.name}” de esta instancia?`, confirmLabel: 'Eliminar', danger: true })) return;
          try { await api.instances.removeFile(inst.id, tab, f.file); toast('Eliminado'); await reloadInst(); paintFiles(); } catch (e) { toastError(e); }
        } })));
    });
  }

  // Horizon no tiene pestañas de contenido: solo su estado de instalación y la explicación
  const horizonEl = h('div', { class: 'hz-detail' });
  const introEl = h('div');
  function paintIntro() {
    clear(introEl);
    if (inst.loader !== 'horizon') introEl.append(introCard(inst, saved => { inst = saved; paintIntro(); if (tab === 'mods') paintFiles(); }));
  }
  function paintBody() {
    paintIntro();
    const hz = inst.loader === 'horizon';
    tabsEl.hidden = listEl.hidden = hz;
    clear(horizonEl);
    horizonEl.hidden = !hz;
    if (hz) horizonEl.append(horizonPanel(), emptyState('ban', 'Sin mods en Horizon', `${HORIZON_NO_MODS} ${HORIZON_NOTE}`));
    else { paintTabs(); paintFiles(); }
  }

  paintHead(); paintBody();
  root.append(head, introEl, tabsEl, listEl, horizonEl);
}
