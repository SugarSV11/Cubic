import { h } from '../lib/dom.js';
import { pageHeader, switchEl } from '../lib/ui.js';
import { cfKeyForm } from '../lib/cfkey.js';
import { state, refreshInstances } from '../state.js';
import { toastError } from '../lib/toast.js';
import { INTRO_LINKS } from '../lib/intro.js';

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

  const link = (text, url) => h('button', { class: 'link-btn', onclick: () => api.openExternal(url).catch(toastError) }, text);

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
        h('h3', {}, 'Intro animada'),
        h('p', { class: 'muted' }, 'Cambia la pantalla de carga de Minecraft por una animada (mod Animated Mojang Logo). En instancias Vanilla se juega con Fabric Loader mientras esté activada. No se aplica a Horizon. Cada instancia puede tener su propio ajuste.'),
        switchEl(state.settings.animatedLogo !== false, async v => {
          try { state.settings = await api.setSettings({ animatedLogo: v }); await refreshInstances(); } catch (e) { toastError(e); }
        }, 'Intro animada (Animated Mojang Logo)')),
      h('section', { class: 'card card-pad wide stagger', style: { '--i': 2 } },
        h('h3', {}, 'CurseForge'),
        h('p', { class: 'muted' }, 'Para buscar mods en CurseForge hace falta una API key gratuita. Se guarda solo en tu PC y se envía únicamente a CurseForge.'),
        cfBox),
      h('section', { class: 'card card-pad wide stagger', style: { '--i': 3 } },
        h('h3', {}, 'Acerca de'),
        h('p', { class: 'muted' }, `${state.appName || 'Cubic'} ${state.version} · Datos del juego en:`),
        h('code', { class: 'code' }, state.dataDir),
        h('p', { class: 'muted small' }, 'Aquí viven tus instancias, Java, librerías y cuentas. Tu ~/.minecraft no se toca.'),
        h('h3', { class: 'about-sub' }, 'Mods incluidos'),
        h('p', { class: 'muted small' }, `Animated Mojang Logo ${state.intro.version || ''} de BouncingElf10, bajo GPL-3.0-or-later, sin modificar. Usa YACL, Mod Menu, TimelessLib, Fabric API y Text Placeholder API, cada uno con su licencia. Según su autor, la animación y el jingle son de Minecraft Dungeons / MC Live: pertenecen a Mojang y Microsoft. Sin afiliación con ellos.`),
        h('div', { class: 'row gap wrap' },
          link('Proyecto', INTRO_LINKS.project),
          link('Código fuente', INTRO_LINKS.source),
          link('GPL-3.0', INTRO_LINKS.license),
          link('Avisos de terceros', INTRO_LINKS.notices),
          h('button', { class: 'link-btn', onclick: () => api.openLicenses().catch(toastError) }, 'Abrir carpeta de licencias')))));
}
