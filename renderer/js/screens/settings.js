import { h } from '../lib/dom.js';
import { pageHeader, switchEl } from '../lib/ui.js';
import { cfKeyForm } from '../lib/cfkey.js';
import { state } from '../state.js';

export function render(root) {
  const maxRam = Math.max(2, state.totalRam - 2);
  const cur = Math.min(state.settings.ram, maxRam);
  const ramVal = h('b', { class: 'accent' }, `${cur} GB`);
  const fill = el => el.style.setProperty('--p', `${((el.value - el.min) / Math.max(1, el.max - el.min)) * 100}%`);
  const ram = h('input', { type: 'range', class: 'range', min: 2, max: maxRam, step: 1, value: cur, ...(maxRam <= 2 ? { disabled: true } : {}), 'aria-label': 'RAM por defecto',
    oninput: e => { ramVal.textContent = `${e.target.value} GB`; fill(e.target); },
    onchange: async e => { state.settings = await api.setSettings({ ram: +e.target.value }); } });
  fill(ram);

  const cfBox = h('div');
  const paintKey = () => cfBox.replaceChildren(cfKeyForm({ onSaved: () => paintKey() }));
  paintKey();

  root.append(
    pageHeader('Ajustes', 'Personaliza el launcher.'),
    h('div', { class: 'settings-grid' },
      h('section', { class: 'card card-pad stagger', style: { '--i': 0 } },
        h('h3', {}, 'Memoria RAM por defecto'),
        h('p', { class: 'muted' }, `Se usa al crear instancias nuevas. Va de 2 GB hasta ${maxRam} GB (tu PC tiene ${state.totalRam} GB; se deja 2 GB libres para el sistema).`),
        h('div', { class: 'slider-row' }, ram, ramVal)),
      h('section', { class: 'card card-pad stagger', style: { '--i': 1 } },
        h('h3', {}, 'Versiones'),
        h('p', { class: 'muted' }, 'Por defecto solo se muestran versiones estables (releases).'),
        switchEl(!!state.settings.showSnapshots, async v => { state.settings = await api.setSettings({ showSnapshots: v }); }, 'Mostrar snapshots al crear instancias')),
      h('section', { class: 'card card-pad wide stagger', style: { '--i': 2 } },
        h('h3', {}, 'CurseForge'),
        h('p', { class: 'muted' }, 'Para buscar mods en CurseForge hace falta una API key gratuita. Se guarda solo en tu PC y se envía únicamente a CurseForge.'),
        cfBox),
      h('section', { class: 'card card-pad wide stagger', style: { '--i': 3 } },
        h('h3', {}, 'Acerca de'),
        h('p', { class: 'muted' }, `${state.appName || 'Cubic'} ${state.version} · Datos del juego en:`),
        h('code', { class: 'code' }, state.dataDir),
        h('p', { class: 'muted small' }, 'Aquí viven tus instancias, Java, librerías y cuentas. Tu ~/.minecraft no se toca.'))));
}
