// Intro animada (mod Animated Mojang Logo): tarjeta de la instancia y créditos
import { h } from './dom.js';
import { switchEl } from './ui.js';
import { toastError } from './toast.js';
import { refreshInstances } from '../state.js';

export const INTRO_LINKS = {
  project: 'https://modrinth.com/mod/animated-mojang-logo',
  source: 'https://github.com/BouncingElf10/Animated-Mojang-Logo',
  license: 'https://github.com/SugarSV11/Cubic/blob/main/LICENSES/GPL-3.0.txt',
  notices: 'https://github.com/SugarSV11/Cubic/blob/main/THIRD_PARTY_NOTICES.md'
};

const WHY = {
  'no-build': 'No hay intro compatible con esta versión de Minecraft.',
  loader: 'La intro solo se aplica en instancias Vanilla o Fabric.',
  'other-mods': 'No se aplica: hay otros mods en esta instancia Vanilla y Fabric los cargaría.',
  'own-copy': 'Ya tienes tu propia copia del mod en esta instancia; Cubic no la toca.',
  pending: 'Se descargará la próxima vez que juegues (hace falta conexión una sola vez).'
};

export function introCard(inst, onChange) {
  const s = inst.intro || {};
  const set = async value => {
    try { const saved = await api.instances.intro(inst.id, value); await refreshInstances(); onChange(saved); }
    catch (e) { toastError(e); onChange(inst); }
  };
  const canToggle = s.available || s.reason === 'other-mods';
  const text = WHY[s.reason]
    || (s.removed ? 'Borraste sus archivos, así que Cubic no los vuelve a poner. Actívala para recuperarlos.'
      : !s.on ? (inst.loader === 'vanilla' ? 'Desactivada: se juega en Vanilla puro.' : 'Desactivada: el mod queda deshabilitado.')
        : inst.loader === 'vanilla' ? 'Activada: se juega con Fabric Loader. Desactívala para volver a Vanilla puro.' : 'Activada.');
  const sw = switchEl(!!s.on && s.reason !== 'other-mods', set, '');
  if (!canToggle) sw.querySelector('input').disabled = true;
  sw.querySelector('input').setAttribute('aria-label', 'Intro animada en esta instancia');
  return h('div', { class: 'intro-card card' },
    h('div', { class: 'grow' },
      h('b', {}, 'Intro animada'),
      h('div', { class: 'small muted' }, text),
      h('div', { class: 'small faint' }, s.override == null ? 'Sigue el ajuste global.' : 'Ajuste propio de esta instancia. ',
        s.override == null ? null : h('button', { class: 'link-btn', onclick: () => set(null) }, 'Usar el ajuste global'))),
    sw);
}
