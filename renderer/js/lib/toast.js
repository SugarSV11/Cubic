import { h } from './dom.js';
import { icons } from './icons.js';

export function toast(message, type = 'ok', ms = 4200) {
  const root = document.getElementById('toasts');
  const icon = { ok: icons.ok, err: icons.warn, info: icons.info }[type] || icons.info;
  const el = h('div', { class: `toast ${type}`, role: type === 'err' ? 'alert' : 'status' }, h('span', { class: 'ic', html: icon }), h('span', {}, message));
  root.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  const kill = () => { el.classList.remove('in'); el.classList.add('out'); setTimeout(() => el.remove(), 320); };
  el.addEventListener('click', kill);
  setTimeout(kill, ms);
}
export const toastError = e => toast(e?.message || String(e), 'err', 6500);
