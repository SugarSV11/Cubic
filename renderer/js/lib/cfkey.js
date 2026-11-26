// Campo de la API key de CurseForge: pegar, probar y guardar. Se usa en Ajustes y en la pestaña CurseForge.
import { h } from './dom.js';
import { icons } from './icons.js';
import { toast, toastError } from './toast.js';
import { state } from '../state.js';

export function cfKeyForm({ onSaved, error = '', compact = false } = {}) {
  const input = h('input', { class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false',
    placeholder: state.settings.hasCurseforgeKey ? 'Key guardada · pega otra para cambiarla' : 'Pega aquí tu API key ($2a$10$…)', 'aria-label': 'API key de CurseForge' });
  const eye = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mostrar u ocultar la key', title: 'Mostrar/ocultar',
    onclick: () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; eye.innerHTML = show ? icons.eyeoff : icons.eye; } });
  eye.innerHTML = icons.eye;
  const result = h('div', { class: 'cf-result' });
  const say = (ok, msg) => { result.className = `cf-result ${ok ? 'ok' : 'err'}`; result.replaceChildren(h('span', { class: 'ic', html: ok ? icons.ok : icons.warn }), h('span', {}, msg)); };
  const busy = (btn, on, label) => { btn.disabled = on; btn.dataset.label ||= btn.textContent; btn.textContent = on ? label : btn.dataset.label; };

  const testBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    busy(testBtn, true, 'Probando…'); result.className = 'cf-result'; result.replaceChildren();
    try { const r = await api.curseforge.test(input.value); say(r.ok, r.message); } catch (e) { say(false, e.message); }
    busy(testBtn, false);
  } }, h('span', { class: 'ic', html: icons.shield }), 'Probar key');

  const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    if (!input.value.trim()) return say(false, 'Pega primero tu API key.');
    busy(saveBtn, true, 'Guardando…');
    try {
      state.settings = await api.setSettings({ curseforgeKey: input.value });
      input.value = ''; input.placeholder = 'Key guardada · pega otra para cambiarla';
      const r = await api.curseforge.test(''); // prueba la key ya guardada
      say(r.ok, r.ok ? 'Key guardada y válida.' : `Key guardada, pero no se pudo validar. ${r.message}`);
      if (r.ok) { toast('API key de CurseForge guardada'); onSaved?.(); }
    } catch (e) { toastError(e); }
    busy(saveBtn, false);
  } }, 'Guardar');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });

  const removeBtn = state.settings.hasCurseforgeKey ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
    state.settings = await api.setSettings({ curseforgeKey: '' }); toast('API key eliminada', 'info'); onSaved?.(true);
  } }, 'Quitar') : null;

  return h('div', { class: 'cf-key' },
    error ? h('div', { class: 'cf-result err' }, h('span', { class: 'ic', html: icons.warn }), h('span', {}, error)) : null,
    h('div', { class: 'cf-input' }, input, eye),
    h('div', { class: 'row' }, testBtn, saveBtn, removeBtn,
      h('a', { href: '#', class: 'link small', onclick: e => { e.preventDefault(); api.openExternal('https://console.curseforge.com/'); } }, 'Conseguir una key en console.curseforge.com')),
    result);
}
