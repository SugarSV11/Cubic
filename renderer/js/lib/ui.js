import { h } from './dom.js';
import { icons, instIcon } from './icons.js';

export const ic = (name, cls = '') => h('span', { class: `ic ${cls}`.trim(), html: icons[name] || '' });
export const instTile = (key, big = false) => h('div', { class: `inst-icon${big ? ' big' : ''}`, html: instIcon(key) });

// Cabeza de la skin (mc-heads.net). En cuentas offline, la de Steve.
export function avatar(acc, size = 40) {
  const key = !acc || acc.type === 'offline' ? 'MHF_Steve' : acc.uuid;
  const img = h('img', { class: 'avatar', width: size, height: size, alt: acc?.name || 'Jugador', loading: 'lazy', src: `https://mc-heads.net/avatar/${key}/${size * 2}` });
  img.addEventListener('error', () => {
    img.replaceWith(h('div', { class: 'avatar fallback', style: { width: `${size}px`, height: `${size}px`, fontSize: `${size * 0.42}px` } }, (acc?.name || '?')[0].toUpperCase()));
  });
  return img;
}

export const fmtNum = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(n);
export const fmtSize = b => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export function pageHeader(title, subtitle, ...actions) {
  return h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
    h('div', { class: 'row gap' }, actions));
}

// icon: nombre de un icono de icons.js
export function emptyState(icon, title, text, ...actions) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ic', html: icons[icon] || icons.box }), h('h3', {}, title), h('p', { class: 'muted' }, text), h('div', { class: 'row gap center' }, actions));
}

export const skeletons = (n, cls = 'sk-card') => Array.from({ length: n }, (_, i) => h('div', { class: `skeleton ${cls}`, style: { animationDelay: `${i * 60}ms` } }));

export function switchEl(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', ...(checked ? { checked: true } : {}), onchange: e => onChange(e.target.checked) });
  return h('label', { class: 'switch' }, input, h('span', { class: 'slider' }), label ? h('span', { class: 'switch-label' }, label) : null);
}
