// Piezas de la interfaz para instancias Horizon
import { h, clear } from './dom.js';
import { toastError } from './toast.js';
import { state, on } from '../state.js';

export const HORIZON_VERSION = '26.3';
export const HORIZON_NOTE = 'Horizon es un proyecto no oficial, no está afiliado a Mojang ni a Microsoft y requiere tu propia copia de Minecraft Java 26.3.';
export const HORIZON_NO_MODS = 'Horizon no puede usar mods de Fabric o NeoForge, y Cubic no instala en él shaders ni resource packs de Modrinth o CurseForge.';

// una sola suscripción para todos los paneles: los que ya no están en pantalla se olvidan
const panels = new Map(); // elemento -> función que lo repinta
const prune = () => { for (const box of panels.keys()) if (!box.isConnected) panels.delete(box); };
on('horizon', () => { prune(); for (const paint of panels.values()) paint(); });

// Estado de la instalación compartida: progreso, error con reintento, o nada si ya está listo
export function horizonPanel() {
  prune();
  const box = h('div', { class: 'hz-panel', 'aria-live': 'polite' });
  const run = download => api.horizon.install({ download }).catch(toastError);
  function paint() {
    const s = state.horizon;
    clear(box);
    box.hidden = !s || (s.ready && !s.running && !s.error);
    if (box.hidden) return;
    if (s.running) {
      const pct = s.progress != null ? Math.round(s.progress * 100) : null;
      box.append(
        h('div', { class: 'prog-top' }, pct != null && pct < 100 ? `${s.text} ${pct}%` : s.text),
        h('div', { class: 'prog-bar' }, h('div', { class: `prog-fill${pct == null ? ' indeterminate' : ''}`, style: { transform: pct == null ? '' : `scaleX(${s.progress})` } })));
      return;
    }
    box.append(h('div', { class: 'warn-box' },
      h('b', {}, s.error ? 'No se pudo instalar Horizon' : 'Horizon aún no está instalado'),
      s.error ? h('p', { class: 'muted hz-error' }, s.error) : null,
      h('div', { class: 'row gap wrap' },
        s.code === 'NO_JAR' ? h('button', { class: 'btn primary', onclick: () => run(true) }, 'Descargar 26.3') : null,
        h('button', { class: s.code === 'NO_JAR' ? 'btn' : 'btn primary', onclick: () => run(false) }, s.error ? 'Reintentar' : 'Instalar'))));
  }
  panels.set(box, paint);
  paint();
  return box;
}
